"""Turn a month's bank files into Transactions rows, categorised the way history did it.

    python3 period-close/import_month.py 2026-12

Reads every file under sources/<account>/<download date>/ through the institution's adapter
(adapters.py), keeps the rows dated in the month, and refuses any row the sheet already holds
(same date, account, description and amount, counted, so a genuine same-day double charge
survives while a file imported twice does not). The sheet's current rows come from
data/snapshot.json (run snapshot.py first); history for categorising is that plus, optionally,
the generator's history. The next Txn ID follows the last one in the sheet.

Overlapping files are safe in one run: the Nth copy of a row counts once however many files carry it, so the most
copies in any one file is how many are real. Where a file prints a running balance, its last balance in the month
must equal the sheet's opening balance plus every row to that date, the new rows included. If any file disagrees the
run holds: rows.json and entries.json are empty, the rows wait in rows.held.json and entries.held.json, and the exit
code is 2.

Each description is matched against history: exact first, then with month names, card numbers
and the word REFUND removed. A description seen with more than one category takes the most
common and says so. Anything never seen before is Uncategorised and listed for review.
overrides.csv in the month folder records the review decisions and wins over the history match.

Writes rows.json (Transactions columns A to J, ready to append), entries.json (the same rows in the
Entries tab's columns A to T for a sheet_version 2 sheet: kind transaction, status settled, created at the
settled date, transfer ids left for the review to pair) and review.md. Rows land in the sheet by an explicit
range write starting at the first empty row (T0001 is row 2), never by appending to a tab with helper columns.
--sources and --out point the run at another sources/ folder and another output folder (the portals'
end-to-end test runs against a scratch copy); the account-to-institution map comes from the sheet's
Accounts tab when the snapshot carries one, so the sheet owns which shape each account is read in.
"""
import argparse
import csv
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

import adapters as A

ROOT = Path(__file__).resolve().parent.parent
MONTHS = r'\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\b'


def normalise(desc):
    d = re.sub(MONTHS, '', desc.upper())
    d = re.sub(r'\bREFUND\b|\bPREMIUM ADJ\b|\*\s*\w+$|\d{3,}', '', d)
    return re.sub(r'\s+', ' ', d).strip()


def closing_checks(doc, sheet, rows, files):
    """Each file's last balance in the month against the sheet's opening balance plus every row to that date, the
    rows about to be appended included. Returns the review lines and whether any file disagrees."""
    opening = {a['account_id']: float(a['opening_balance'] or 0) for a in doc.get('accounts', []) if a.get('account_id')}
    book = [(t['date'], t['account_id'], float(t['amount'])) for t in sheet] + [(r[1], r[2], r[5]) for r in rows]
    lines, held = [], False
    for path, frows, closing in files:
        acct = path.split('/')[0]
        if not closing:
            if frows:
                lines.append(f'- {path}: not checked, this format prints no balance')
            continue
        if acct not in opening:
            lines.append(f'- {path}: not checked, {acct} is not on the Accounts tab')
            continue
        day, printed = closing
        worked = round(opening[acct] + sum(a for d, ac, a in book if ac == acct and d <= day), 2)
        ok = abs(worked - printed) < 0.005
        held = held or not ok
        lines.append(f'- {path}: {day} file {printed:,.2f}, ledger {worked:,.2f}, ' + ('OK' if ok else f'MISMATCH of {worked - printed:+,.2f}'))
    return lines, held


def main():
    p = argparse.ArgumentParser()
    p.add_argument('month', help='YYYY-MM')
    p.add_argument('--sheet', default=ROOT / 'data' / 'snapshot.json', help='the sheet as last snapshotted')
    p.add_argument('--history', default=None, help='optional older history (the generator\'s data.json) for categorising')
    p.add_argument('--sources', default=ROOT / 'sources', help='the sources/ folder to read (default: the repo\'s)')
    p.add_argument('--out', default=None, help='where rows.json and review.md go (default: period-close/<month>/)')
    args = p.parse_args()
    folder = Path(args.out) if args.out else Path(__file__).parent / args.month
    folder.mkdir(parents=True, exist_ok=True)

    doc = json.loads(Path(args.sheet).read_text())
    # a 1.1 snapshot carries Transactions; a sheet_version 2 one carries the same rows as Entries of kind transaction
    sheet = doc.get('transactions') or [
        {'txn_id': e['entry_id'], 'date': e['settled_at'], 'account_id': e['account_id'], 'bank_description': e['raw_text'], 'merchant': e['description'],
         'amount': e['amount'], 'category_id': e['category_id'], 'person': e['person'], 'receipt_held': e.get('receipt_held'), 'note': e.get('note')}
        for e in doc.get('entries', []) if (e.get('kind') or 'transaction') == 'transaction']
    institutions = dict(A.INSTITUTION)
    institutions.update({a['account_id']: a['institution'] for a in doc.get('accounts', []) if a.get('account_id') and a.get('institution') in A.FORMATS})
    existing = Counter((t['date'], t['account_id'], (t['bank_description'] or '').strip(), round(float(t['amount']), 2)) for t in sheet)
    last_id = max(int(t['txn_id'][1:]) for t in sheet)
    exact, loose = defaultdict(Counter), defaultdict(Counter)
    if args.history and Path(args.history).exists():
        for _, _, _, desc, merchant, _, cat, person, *_ in json.loads(Path(args.history).read_text())['Transactions'][1:]:
            exact[desc][(merchant, cat, person)] += 1
            loose[normalise(desc)][(merchant, cat, person)] += 1
    for t in sheet:
        key = (t['merchant'], t['category_id'], t['person'] or 'Joint')
        exact[t['bank_description']][key] += 1
        loose[normalise(t['bank_description'])][key] += 1

    overrides = {}
    if (folder / 'overrides.csv').exists():
        with open(folder / 'overrides.csv') as f:
            overrides = {r['Description']: r for r in csv.DictReader(f)}

    files = A.read_sources(Path(args.sources), args.month, institutions)
    rows, review, skipped, repeated, taken = [], [], [], [], Counter()
    for path, frows, _ in files:
        kept = 0
        occurrence = Counter()
        for d, acct, desc, amount in frows:
            key = (d, acct, desc, amount)
            occurrence[key] += 1
            if occurrence[key] <= existing.get(key, 0):
                skipped.append(f'{path}: {d} {desc} {amount:+.2f}')
                continue
            if occurrence[key] <= taken[key]:
                repeated.append(f'{path}: {d} {desc} {amount:+.2f}')
                continue
            taken[key] = occurrence[key]
            receipt = note = ''
            if desc in overrides:
                o = overrides[desc]
                merchant, cat, person, receipt, note = o['Merchant'], o['Category ID'], o['Person'], o['Receipt held'], o['Note']
                review.append(f'- {desc}: set by review to {cat}')
            else:
                seen = exact.get(desc) or loose.get(normalise(desc))
                if seen:
                    (merchant, cat, person), _ = seen.most_common(1)[0]
                    if len({c for _, c, _ in seen}) > 1:
                        review.append(f'- {desc}: history has {dict((c, n) for (_, c, _), n in seen.items())}, used {cat}')
                else:
                    merchant, cat, person = desc.title(), 'UNCAT', 'Joint'
                    note = 'New merchant, check category'
                    review.append(f'- {desc} ({amount:+.2f}): new merchant, left Uncategorised')
            rows.append([None, d, acct, desc, merchant, amount, cat, person, receipt, note])
            kept += 1
        review.insert(0, f'- {path}: {len(frows)} rows in {args.month}, {kept} new')
    rows.sort(key=lambda r: (r[1], r[2], -r[5]))
    for i, r in enumerate(rows):
        r[0] = f'T{last_id + 1 + i:04d}'

    balance, held = closing_checks(doc, sheet, rows, files)
    entries = [[r[0], 'transaction', r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9], 'settled', r[1], '', '', '', '', '', '', 'bank export'] for r in rows]
    for name, payload in (('rows', rows), ('entries', entries)):
        (folder / f'{name}.json').write_text(json.dumps([] if held else payload, indent=1))
        (folder / f'{name}.held.json').unlink(missing_ok=True)
        if held:
            (folder / f'{name}.held.json').write_text(json.dumps(payload, indent=1))
    body = [f'# {args.month} import review', '']
    if held:
        body += ['**HOLD: do not append.** A closing balance disagrees, so the rows wait in rows.held.json and entries.held.json, and rows.json and entries.json are empty.', '']
    body += [f'{len(rows)} rows to append' + (f', T{last_id + 1:04d} to T{last_id + len(rows):04d}' if rows else '') + f'; {len(skipped)} already in the sheet' + (f'; {len(repeated)} repeated across overlapping files' if repeated else '') + '.', '']
    body += ['## Closing balances'] + (balance or ['- No file printed a balance for this month.']) + ['']
    body += review or ['Nothing to review.']
    if skipped:
        body += ['', '## Already in the sheet (not appended)'] + [f'- {s}' for s in skipped[:40]] + ([f'- … and {len(skipped) - 40} more'] if len(skipped) > 40 else [])
    if repeated:
        body += ['', '## Repeated across overlapping files (taken once)'] + [f'- {s}' for s in repeated[:40]] + ([f'- … and {len(repeated) - 40} more'] if len(repeated) > 40 else [])
    (folder / 'review.md').write_text('\n'.join(body) + '\n')
    print((folder / 'review.md').read_text())
    if held:
        sys.exit(2)


if __name__ == '__main__':
    main()
