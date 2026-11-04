"""Turn a month's bank files into Transactions rows, categorised the way history did it.

    python3 period-close/import_month.py 2026-12

Reads every file under sources/<account>/<download date>/ through the institution's adapter
(adapters.py), keeps the rows dated in the month, and refuses any row the sheet already holds
(same date, account, description and amount, counted, so a genuine same-day double charge
survives while a file imported twice does not). The sheet's current rows come from
data/snapshot.json (run snapshot.py first); history for categorising is that plus, optionally,
the generator's history. The next Txn ID follows the last one in the sheet.

Each description is matched against history: exact first, then with month names, card numbers
and the word REFUND removed. A description seen with more than one category takes the most
common and says so. Anything never seen before is Uncategorised and listed for review.
overrides.csv in the month folder records the review decisions and wins over the history match.

Writes rows.json (Transactions columns A to J, ready to append) and review.md.
--sources and --out point the run at another sources/ folder and another output folder (the portals'
end-to-end test runs against a scratch copy); the account-to-institution map comes from the sheet's
Accounts tab when the snapshot carries one, so the sheet owns which shape each account is read in.
"""
import argparse
import csv
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

import adapters as A

ROOT = Path(__file__).resolve().parent.parent
MONTHS = r'\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\b'


def normalise(desc):
    d = re.sub(MONTHS, '', desc.upper())
    d = re.sub(r'\bREFUND\b|\bPREMIUM ADJ\b|\*\s*\w+$|\d{3,}', '', d)
    return re.sub(r'\s+', ' ', d).strip()


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
    sheet = doc['transactions']
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
    rows, review, skipped, seen_now = [], [], [], Counter()
    for path, frows in files:
        kept = 0
        for d, acct, desc, amount in frows:
            key = (d, acct, desc, amount)
            seen_now[key] += 1
            if seen_now[key] <= existing.get(key, 0):
                skipped.append(f'{path}: {d} {desc} {amount:+.2f}')
                continue
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

    (folder / 'rows.json').write_text(json.dumps(rows, indent=1))
    body = [f'# {args.month} import review', '', f'{len(rows)} rows to append' + (f', T{last_id + 1:04d} to T{last_id + len(rows):04d}' if rows else '') + f'; {len(skipped)} already in the sheet.', '']
    body += review or ['Nothing to review.']
    if skipped:
        body += ['', '## Already in the sheet (not appended)'] + [f'- {s}' for s in skipped[:40]] + ([f'- … and {len(skipped) - 40} more'] if len(skipped) > 40 else [])
    (folder / 'review.md').write_text('\n'.join(body) + '\n')
    print((folder / 'review.md').read_text())


if __name__ == '__main__':
    main()
