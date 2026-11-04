"""Turn the files a household downloaded into a verified write plan for the sheet, and nothing else.

    python3 period-close/import_month.py 2027-02                    # one month
    python3 period-close/import_month.py 2025-07..2027-03           # a backfill, every month in the range in one run
    python3 period-close/import_month.py 2027-02 --dry-run          # print the review, write nothing

Reads every file under sources/<account>/<download date>/ through the adapter the sheet's Accounts tab names for
that account (adapters.py), keeps the rows dated in the month, and plans the append. It never writes to the sheet:
the agent writes each range in `write-plan.json` with the Sheets connector and then runs verify.py over a saved
re-read (the three steps are in skills/bank-export/SKILL.md). The sheet's current rows come from a snapshot
(data/snapshot-v2.json for the ledger, data/snapshot.json for a 1.1 sheet); history for categorising is the sheet's
Rules tab and its rows, plus optionally the generator's history.

Identity and de-duplication. Every source row has an identity: account, settled date, amount, the description as
delivered (case and spacing folded), and its occurrence index among identical rows on that day. Within one run a row
that appears in more than one file counts once per identity at the most copies any single file holds, never the sum,
so a calendar-month export and a statement export of the same card give no duplicates while a genuine same-day double
charge survives. Against the sheet, rows are refused by identity and IDs are checked never to collide. The same holds
for loan statement lines, valuations (one per account per month end; a different value for the same month holds the
run) and payslips (one per pay date, person and employer).

Fail loud. An unknown account folder, a folder that is not a download date, an unrecognised shape, a header that
differs from the shape, a PDF with no adapter, a zero-byte file, a file that is not UTF-8, a date read in the wrong
order (every shape declares its order; 13 as a month fails), a day that does not exist, a row dated after the day its
file was downloaded or after --as-of, a row before the account opened: each stops the run with exit 1 and a review.md
that names the file, the row and what to do. A closing balance, an owner statement or a valuation that disagrees with
the ledger holds the run with exit 2: the rows wait in *.held.json and the plan is empty. Nothing is skipped silently:
rows outside the month, rows already in the sheet and copies repeated across overlapping files are all counted and
named in review.md. A UTF-8 byte order mark is accepted and noted.

Beyond bank files: a lender's statement on a loan account (Westpac columns) becomes interest charged as a transaction
on the loan, the repayment as the loan-side mate of the bank row that paid it (paired by transfer_id) and the closing
balance as a month-end valuation; the transactions and the pairing are planned under `deferred` until phase D makes
the loans ledger accounts (--loans now moves them into the writes), because pairing the repayment takes it out of
spending. A property manager's owner statement is a reconciliation source here: the rental account's bank rows
itemise rent and fees, so every statement line must match a bank row and a difference holds the run (if an agent
pays only the net, see adapters.py for the clearing-account path, not implemented because this data does not need
it). Payslips (the Payslips tab's own columns) plan an append to that tab. The insurer's renewal notices and
certificates of currency are read as text (pdftext.py); a renewal whose premium or period differs from the Contracts
row plans an update of that row; a PDF the reader cannot parse stops the run with "this PDF needs a person".

Each run keeps its payload under <out>/runs/<timestamp>/ (review.md, rows.json, entries.json, write-plan.json) and
also refreshes the same files at <out>/ for convenience; --out defaults to period-close/<month>/. rows.json is the
Transactions tab shape (A to J) of the new bank rows; entries.json is every Entries row the plan appends (A to T).
overrides.csv in the month folder records review decisions and wins over history; payslips.csv and valuations.csv
there (the simulator writes them; a household types them) are inputs too.
"""
import argparse
import calendar
import csv
import json
import re
import sys
import time
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import adapters as A
import writeplan as W

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
MONTHS = r'\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\b'
ENTRY_COLS = ['Entry ID', 'Kind', 'Settled at', 'Account ID', 'Raw text', 'Description', 'Amount', 'Category ID', 'Person', 'Receipt held', 'Note',
              'Status', 'Created at', 'Transfer ID', 'Transfer account', 'Foreign amount', 'Foreign currency', 'Units', 'Unit price', 'Source']
TXN_COLS = ['Txn ID', 'Date', 'Account ID', 'Bank description', 'Merchant', 'Amount', 'Category ID', 'Person', 'Receipt held', 'Note']
PAYSLIP_COLS = ['Pay date', 'Person', 'Employer', 'Gross pay', 'Tax withheld', 'Super (employer)', 'Net pay']
VALUATION_COLS = ['Month end', 'Item ID', 'Value']
TRANSFER_DAYS = 4
TOL = 0.005


def normalise(desc):
    """The loose key for categorising: month names, card numbers and REFUND stripped."""
    d = re.sub(MONTHS, '', str(desc or '').upper())
    d = re.sub(r'\bREFUND\b|\bPREMIUM ADJ\b|\*\s*\w+$|\d{3,}', '', d)
    return re.sub(r'\s+', ' ', d).strip()


def ident(desc):
    """The identity key for de-duplication: the description as delivered, case and spacing folded."""
    return ' '.join(str(desc or '').upper().split())


def cents(x):
    return int(round(float(x or 0) * 100))


def month_end(m):
    y, mo = int(m[:4]), int(m[5:7])
    return f'{m}-{calendar.monthrange(y, mo)[1]:02d}'


def months_between(a, b):
    out, y, m = [], int(a[:4]), int(a[5:7])
    while True:
        cur = f'{y}-{m:02d}'
        out.append(cur)
        if cur >= b:
            return out
        m += 1
        if m == 13:
            y, m = y + 1, 1


def days_apart(a, b):
    return abs((date.fromisoformat(a) - date.fromisoformat(b)).days)


def next_id(prefix, last):
    return f'{prefix}{last + 1:04d}'


def id_number(s, prefix):
    m = re.fullmatch(prefix + r'(\d+)', str(s or ''))
    return int(m.group(1)) if m else None


def fnum(x):
    try:
        return round(float(x), 2)
    except (TypeError, ValueError):
        return 0.0


class Stop(Exception):
    """The run is stopped by faults; carries them for review.md."""

    def __init__(self, faults):
        super().__init__(f'{len(faults)} fault(s)')
        self.faults = faults


# ---------- the sheet as snapshotted ----------
class Sheet:
    def __init__(self, path, sheet_id=None):
        doc = json.loads(Path(path).read_text())
        self.doc, self.path = doc, str(path)
        self.version = 2 if 'entries' in doc else 1
        self.accounts = {a['account_id']: a for a in doc.get('accounts', []) if a.get('account_id')}
        cats = {c['category_id']: c for c in doc.get('category_list', []) if c.get('category_id')}
        self.categories = set(cats)
        self.flow = {k: (v.get('flow') or 'Expense') for k, v in cats.items()}
        self.contracts = [dict(c, row=i + 2) for i, c in enumerate(doc.get('contracts', []))]
        self.rules = doc.get('rules', [])
        self.payslips = [dict(p, row=i + 2) for i, p in enumerate(doc.get('payslips', []))]
        self.valuation_items = set(self.accounts) | {a.get('item_id') for a in doc.get('assets', []) if a.get('item_id')} | {l.get('loan_id') for l in doc.get('loans', []) if l.get('loan_id')}
        src = doc.get('source') or {}
        self.id = sheet_id or src.get('sheet')
        self.fetched = doc.get('fetchedAt')
        if self.version == 2:
            entries = doc.get('entries') or []
            self.entries_rows = len(entries)
            self.last_entry_id = entries[-1]['entry_id'] if entries else None
            self.tx, self.valuations = [], []
            for i, e in enumerate(entries):
                kind = (e.get('kind') or 'transaction').lower()
                if kind == 'transaction':
                    self.tx.append({'txn_id': e['entry_id'], 'date': e['settled_at'], 'account_id': e['account_id'], 'bank_description': e.get('raw_text') or '',
                                    'merchant': e.get('description') or '', 'amount': fnum(e.get('amount')), 'category_id': e.get('category_id') or 'UNCAT',
                                    'person': e.get('person') or 'Joint', 'receipt_held': e.get('receipt_held') or '', 'note': e.get('note') or '',
                                    'transfer_id': e.get('transfer_id') or '', 'transfer_account': e.get('transfer_account') or '', 'row': i + 2})
                elif kind == 'valuation':
                    self.valuations.append({'account_id': e['account_id'], 'month_end': e['settled_at'], 'value': fnum(e.get('amount')), 'row': i + 2, 'id': e['entry_id']})
            ids = [e['entry_id'] for e in entries]
            self.last_t = max([id_number(i, 'T') or 0 for i in ids] + [0])
            self.last_v = max([id_number(i, 'V') or 0 for i in ids] + [0])
            self.last_x = max([id_number(e.get('transfer_id'), 'X') or 0 for e in entries] + [0])
            self.all_ids = set(ids)
        else:
            tx = doc.get('transactions') or []
            self.tx = [dict(t, amount=fnum(t.get('amount')), bank_description=t.get('bank_description') or '', merchant=t.get('merchant') or '',
                            category_id=t.get('category_id') or 'UNCAT', person=t.get('person') or 'Joint', receipt_held=t.get('receipt_held') or '',
                            note=t.get('note') or '', transfer_id='', transfer_account='', row=i + 2) for i, t in enumerate(tx)]
            self.entries_rows = len(tx)
            self.last_entry_id = tx[-1]['txn_id'] if tx else None
            self.last_t = max([id_number(t['txn_id'], 'T') or 0 for t in tx] + [0])
            self.last_v = self.last_x = 0
            self.all_ids = {t['txn_id'] for t in tx}
            vals = doc.get('valuations')
            self.valuations = [{'account_id': v['item_id'], 'month_end': v['month_end'], 'value': fnum(v.get('value')), 'row': i + 2, 'id': None} for i, v in enumerate(vals)] if vals is not None else None

    def institution(self, acct):
        a = self.accounts.get(acct) or {}
        return a.get('institution') or A.INSTITUTION.get(acct)


# ---------- the sources folder ----------
def classify(name, sheet, folder):
    if name == 'payslips':
        return 'payslips', None
    a = sheet.accounts.get(name)
    if a:
        t = str(a.get('type') or '').lower()
        if t == 'loan':
            return 'loan', a
        if t == 'property':
            return 'owner', a
        if sheet.institution(name) in A.BANK_SHAPES:
            return 'bank', a
        raise A.ImportFault(folder, f'{name} is on the Accounts tab as type {a.get("type")!r} at {a.get("institution")!r}, which has no adapter',
                            'add the institution\'s shape to adapters.py, or set the account\'s institution on the Accounts tab to one the importer knows. Nothing in this folder was read')
    if name.startswith('POL-') and name[4:] in sheet.accounts:
        return 'policy', sheet.accounts[name[4:]]
    if name in A.INSTITUTION and not sheet.accounts:
        return 'bank', {'account_id': name, 'institution': A.INSTITUTION[name]}
    raise A.ImportFault(folder, f'unknown account folder {name!r}: not on the Accounts tab',
                        'add the account to the Accounts tab (institution, type, opening balance and opening date) before importing its files, or rename the folder to the account id it belongs to. Nothing in this folder was read')


def gather(root, sheet, as_of=None):
    """Every file under sources/, read through its adapter, as readings; raises Stop with every fault found."""
    root = Path(root)
    if not root.is_dir():
        raise Stop([A.ImportFault(root, 'the sources folder does not exist', 'download the month\'s files into sources/<account id>/<download date>/ first')])
    readings, faults = [], []
    for acct_dir in sorted(root.iterdir()):
        if not acct_dir.is_dir() or acct_dir.name.startswith('.'):
            continue
        rel_acct = acct_dir.relative_to(root).as_posix()
        try:
            kind, account = classify(acct_dir.name, sheet, rel_acct)
        except A.ImportFault as e:
            faults.append(e)
            continue
        opening_date = (account or {}).get('opening_date') if kind in ('bank', 'loan') else None
        for day_dir in sorted(acct_dir.iterdir()):
            if day_dir.name.startswith('.'):
                continue
            rel_day = day_dir.relative_to(root).as_posix()
            if not day_dir.is_dir():
                faults.append(A.ImportFault(rel_day, 'a file where a download-date folder should be', 'files live in sources/<account id>/<yyyy-mm-dd>/; move it into a folder named for the day it was downloaded'))
                continue
            m = re.match(r'(\d{4}-\d{2}-\d{2})(?:$|[-_ ].*)', day_dir.name)
            try:
                download_day = date.fromisoformat(m.group(1)).isoformat() if m else None
            except ValueError:
                download_day = None
            if not download_day:
                faults.append(A.ImportFault(rel_day, f'folder {day_dir.name!r} is not a download date', 'name the folder yyyy-mm-dd (the day the file was downloaded), optionally followed by a label, for example 2027-03-02-jordan'))
                continue
            for f in sorted(day_dir.iterdir()):
                if f.name.startswith('.'):
                    continue
                rel = f.relative_to(root).as_posix()
                try:
                    readings.append(read_one(f, rel, kind, acct_dir.name, account, sheet, download_day, opening_date, as_of))
                except A.ImportFault as e:
                    e.file = rel if e.file in (str(f), rel) else e.file
                    faults.append(e)
    if faults:
        raise Stop(faults)
    return readings


def read_one(f, rel, kind, acct, account, sheet, download_day, opening_date, as_of):
    if f.is_dir():
        raise A.ImportFault(rel, 'a folder inside a download-date folder', 'files sit directly in sources/<account>/<download date>/; nested folders are not read')
    ext = f.suffix.lower()
    base = {'path': rel, 'file': f, 'account': acct, 'kind': kind, 'download_day': download_day, 'bom': False, 'shape': None, 'rows': []}
    if ext == '.pdf':
        if kind != 'policy':
            raise A.ImportFault(rel, 'a PDF with no adapter', 'the importer reads bank, loan, owner-statement and payslip files as CSV; download the CSV export for this account. PDFs are read only from the insurer portal (sources/POL-<property>/)')
        doc = A.read_policy_pdf(f)
        doc_prop = doc.get('property')
        if doc_prop and doc_prop != acct[4:]:
            raise A.ImportFault(rel, f'a policy for {doc_prop} in the {acct} folder', 'move the file to the folder of the property it insures')
        return dict(base, shape='Policy PDF', rows=[doc])
    if ext != '.csv':
        raise A.ImportFault(rel, f'unrecognised file type {ext or f.name!r}', 'the importer reads CSV exports (and the insurer\'s PDFs); export again as CSV, never convert by hand')
    if kind == 'policy':
        raise A.ImportFault(rel, 'a CSV in a policy folder', 'the insurer portal issues PDFs; this folder takes the renewal notice and the certificate of currency')
    shape, _ = A.sniff(f)
    _, bom = A.read_text(f)
    if kind == 'bank':
        expected = sheet.institution(acct)
        if shape != expected:
            raise A.ImportFault(rel, f'a {shape} file in the {acct} folder, whose institution is {expected}', 'the file is in the wrong account folder, or the Accounts tab names the wrong institution for this account')
        rows = A.read_rows(f, shape, download_day, opening_date, as_of)
    elif kind == 'loan':
        if shape not in A.BANK_SHAPES or not A.SHAPES[shape][3]:
            raise A.ImportFault(rel, f'a {shape} file in the loan folder {acct}', 'a loan statement comes in the lender\'s transaction columns with a running balance (the Westpac shape here); download the loan\'s CSV export')
        expected = sheet.institution(acct)
        if expected in A.BANK_SHAPES and shape != expected:
            raise A.ImportFault(rel, f'a {shape} file for {acct}, whose lender is {expected}', 'the file is in the wrong folder, or the Accounts tab names the wrong lender')
        rows = A.read_rows(f, shape, download_day, opening_date, as_of)
    elif kind == 'owner':
        if shape != 'Owner statement':
            raise A.ImportFault(rel, f'a {shape} file in the property folder {acct}', 'a property folder takes the agent\'s owner statement lines (Date, Description, Rental schedule line, Money in, Money out, Handled by); bank files go under the bank account')
        rows = A.read_rows(f, shape, download_day, None, as_of)
    else:  # payslips
        if shape != 'Payslips':
            raise A.ImportFault(rel, f'a {shape} file in the payslips folder', 'the payslips folder takes the payroll export in the Payslips tab\'s columns')
        rows = A.read_rows(f, shape, download_day, None, as_of)
    return dict(base, shape=shape, bom=bom, rows=rows)


# ---------- de-duplication ----------
def dedupe(files, existing, key_of):
    """files: [(reading, rows)]. For each identity the run takes max(count in any one file) - count in the sheet rows,
    attributed file by file in order. Returns (taken [(reading, row)], skipped [(reading, row)], repeated [(reading, row)],
    kept-per-file [int])."""
    counts, instances = [], []
    run_count = Counter()
    for rd, rows in files:
        c, inst = Counter(), defaultdict(list)
        for r in rows:
            k = key_of(rd, r)
            c[k] += 1
            inst[k].append(r)
        counts.append((c, inst))
        for k, n in c.items():
            run_count[k] = max(run_count[k], n)
    remaining = {k: max(0, n - existing.get(k, 0)) for k, n in run_count.items()}
    taken, skipped, repeated, kept = [], [], [], []
    for (rd, rows), (c, inst) in zip(files, counts):
        n_kept = 0
        for k, n in c.items():
            already = min(n, existing.get(k, 0))
            take = min(n - already, remaining[k])
            remaining[k] -= take
            rows_k = inst[k]
            skipped += [(rd, r) for r in rows_k[:already]]
            taken += [(rd, r) for r in rows_k[already:already + take]]
            repeated += [(rd, r) for r in rows_k[already + take:]]
            n_kept += take
        kept.append(n_kept)
    return taken, skipped, repeated, kept


def bank_key(rd, r):
    return (r['date'], rd['account'], cents(r['amount']), ident(r['description']))


# ---------- categorising ----------
class Categoriser:
    def __init__(self, sheet, history_path=None, overrides=None):
        self.exact, self.loose = defaultdict(Counter), defaultdict(Counter)
        self.rules_exact, self.rules_norm = {}, {}
        for rule in sheet.rules:
            if not rule.get('pattern') or not rule.get('category_id'):
                continue
            val = (rule.get('merchant') or '', rule['category_id'], rule.get('person') or 'Joint', rule.get('rule_id') or 'rule')
            if str(rule.get('match') or 'normalised').lower() == 'exact':
                self.rules_exact.setdefault(rule['pattern'], val)
            else:
                self.rules_norm.setdefault(normalise(rule['pattern']), val)
        if history_path and Path(history_path).exists():
            for _, _, _, desc, merchant, _, cat, person, *_ in json.loads(Path(history_path).read_text())['Transactions'][1:]:
                self.exact[desc][(merchant, cat, person)] += 1
                self.loose[normalise(desc)][(merchant, cat, person)] += 1
        for t in sheet.tx:
            key = (t['merchant'], t['category_id'], t['person'] or 'Joint')
            self.exact[t['bank_description']][key] += 1
            self.loose[normalise(t['bank_description'])][key] += 1
        self.overrides = overrides or {}

    def __call__(self, desc, amount):
        """-> (merchant, category, person, receipt, note, review line or None)"""
        if desc in self.overrides:
            o = self.overrides[desc]
            return o['Merchant'], o['Category ID'], o['Person'], o.get('Receipt held', ''), o.get('Note', ''), f'- {desc}: set by review to {o["Category ID"]}'
        rule = self.rules_exact.get(desc) or self.rules_norm.get(normalise(desc))
        if rule:
            merchant, cat, person, rid = rule
            return merchant or desc.title(), cat, person, '', '', None
        seen = self.exact.get(desc) or self.loose.get(normalise(desc))
        if seen:
            (merchant, cat, person), _ = seen.most_common(1)[0]
            note = None
            if len({c for _, c, _ in seen}) > 1:
                note = f'- {desc}: history has {dict((c, n) for (_, c, _), n in seen.items())}, used {cat}'
            return merchant, cat, person, '', '', note
        return desc.title(), 'UNCAT', 'Joint', '', 'New merchant, check category', f'- {desc} ({amount:+.2f}): new merchant, left Uncategorised'


def load_overrides(paths):
    out = {}
    for p in paths:
        if Path(p).exists():
            with open(p, newline='', encoding='utf-8-sig') as f:
                for r in csv.DictReader(f):
                    out.setdefault(r['Description'], r)
    return out


def load_csv(p):
    with open(p, newline='', encoding='utf-8-sig') as f:
        return list(csv.DictReader(f))


# ---------- the run ----------
def closing_checks(sheet, new_rows, readings, months):
    """Each bank file's last balance in the window against the sheet's opening balance plus every row to that date,
    the rows about to be appended included. Returns (lines, held)."""
    opening = {k: fnum(a.get('opening_balance')) for k, a in sheet.accounts.items()}
    book = defaultdict(list)
    for t in sheet.tx:
        book[t['account_id']].append((t['date'], t['amount']))
    for r in new_rows:
        book[r['acct']].append((r['date'], r['amount']))
    lines, held = [], False
    for rd in readings:
        if rd['kind'] != 'bank':
            continue
        in_window = [r for r in rd['rows'] if r['date'][:7] in months]
        if not A.SHAPES[rd['shape']][3]:
            if in_window:
                lines.append(f'- {rd["path"]}: not checked, this format prints no balance')
            continue
        if not in_window:
            continue
        if rd['account'] not in opening:
            lines.append(f'- {rd["path"]}: not checked, {rd["account"]} is not on the Accounts tab')
            continue
        last = in_window[-1] if A.SHAPES[rd['shape']][2] == 'oldest-first' else in_window[0]
        day, printed = last['date'], last['balance']
        worked = round(opening[rd['account']] + sum(a for d, a in book[rd['account']] if d <= day), 2)
        ok = abs(worked - printed) < TOL
        held = held or not ok
        lines.append(f'- {rd["path"]}: {day} file {printed:,.2f}, ledger {worked:,.2f}, ' + ('OK' if ok else f'MISMATCH of {worked - printed:+,.2f}'))
    return lines, held


def run(args):
    t0 = time.time()
    months = months_between(*args.months.split('..')) if '..' in args.months else [args.months]
    for m in months:
        if not re.fullmatch(r'\d{4}-(0[1-9]|1[0-2])', m):
            raise SystemExit(f'{m}: not a month (YYYY-MM)')
    first_day, last_day = f'{months[0]}-01', month_end(months[-1])
    label = args.months
    folder = Path(args.out) if args.out else HERE / label
    sheet = Sheet(args.sheet, args.sheet_id)
    if not sheet.id:
        try:
            cfg = json.loads((ROOT / 'kitty.config.json').read_text())
            sheet.id = cfg.get('v2_sheet') if sheet.version == 2 else cfg.get('demo_sheet')
        except (OSError, ValueError):
            pass
    # where overrides.csv, payslips.csv and valuations.csv are looked for: --inputs (DIR, and DIR/<month>/ on a range);
    # else the run folder, and on the default layout also period-close/<month>/ for each month
    if args.inputs:
        inputs = [Path(args.inputs)] + ([Path(args.inputs) / m for m in months] if len(months) > 1 else [])
    elif args.out:
        inputs = [folder]
    else:
        inputs = [folder] + [HERE / m for m in months]
    inputs = [p for i, p in enumerate(inputs) if p not in inputs[:i]]
    cat = Categoriser(sheet, args.history, load_overrides([p / 'overrides.csv' for p in inputs]))

    review, stop_lines, hold_lines = [], [], []
    held = False
    rows, loan_tx, loan_pairs, valuations, payslips, pair_updates, contract_updates = [], [], [], [], [], [], []
    plan_notes = []
    try:
        readings = gather(args.sources, sheet, args.as_of)
        in_window = lambda r: first_day <= r['date'] <= last_day  # noqa: E731

        # ---- bank rows: identity de-duplication, then categorising
        bank = [rd for rd in readings if rd['kind'] == 'bank']
        existing = Counter((t['date'], t['account_id'], cents(t['amount']), ident(t['bank_description'])) for t in sheet.tx)
        taken, skipped, repeated, kept = dedupe([(rd, [r for r in rd['rows'] if in_window(r)]) for rd in bank], existing, bank_key)
        file_lines, quiet, gaps = [], [], {}
        for rd, n_kept in zip(bank, kept):
            inside = [r for r in rd['rows'] if in_window(r)]
            earlier = [r for r in rd['rows'] if r['date'] < first_day]
            later = [r for r in rd['rows'] if r['date'] > last_day]
            gap = [r for r in earlier if bank_key(rd, r) not in existing]
            line = f'- {rd["path"]}: {len(inside)} rows in {label}, {n_kept} new'
            if earlier:
                line += f'; {len(earlier)} earlier' + (f' ({len(gap)} not in the sheet: a month never imported, or a gap)' if gap else ' (all in the sheet)')
            if later:
                line += f'; {len(later)} later, left for their month'
            if not rd['rows']:
                line += '; header only, no rows (fine for a dormant account; check if you expected movement)'
            if rd['bom']:
                line += '; UTF-8 byte order mark accepted'
            near = first_day <= rd['download_day'] <= (date.fromisoformat(last_day) + timedelta(days=40)).isoformat()
            if inside or gap or later or rd['bom'] or (not rd['rows'] and near):
                file_lines.append(line)
            else:
                quiet.append(rd['path'])
            if gap:
                g = gaps.setdefault(rd['account'], {'rows': 0, 'files': 0, 'first': None})
                g['rows'] += len(gap)
                g['files'] += 1
                g['first'] = min(g['first'] or gap[0]['date'], gap[0]['date'])
        if quiet:
            file_lines.append(f'- {len(quiet)} other file{"s" if len(quiet) != 1 else ""} hold no rows in {label}; every row in them is earlier and in the sheet')
        for acct, g in gaps.items():
            review.append(f'- {acct}: {g["rows"]} rows before {first_day} in {g["files"]} file{"s" if g["files"] != 1 else ""} are not in the sheet (earliest {g["first"]}); close those months first or they stay out')
        for rd, r in taken:
            merchant, category, person, receipt, note, line = cat(r['description'], r['amount'])
            if line:
                review.append(line)
            rows.append({'date': r['date'], 'acct': rd['account'], 'desc': r['description'], 'merchant': merchant, 'amount': r['amount'], 'cat': category,
                         'person': person, 'receipt': receipt, 'note': note, 'transfer_id': '', 'transfer_account': '', 'source': 'bank export', 'file': rd['path'], 'line': r['line']})
        rows.sort(key=lambda r: (r['date'], r['acct'], -r['amount']))
        for i, r in enumerate(rows):
            r['id'] = next_id('T', sheet.last_t + i)
            if r['id'] in sheet.all_ids:
                raise Stop([A.ImportFault(sheet.path, f'planned ID {r["id"]} already exists in the sheet', 'the snapshot is older than the sheet, or IDs were typed by hand; refresh the snapshot and re-run')])
        unknown_cats = sorted({r['cat'] for r in rows if sheet.categories and r['cat'] not in sheet.categories})
        if unknown_cats:
            raise Stop([A.ImportFault('overrides.csv / Rules', f'category {", ".join(unknown_cats)} is not on the Categories tab', 'use a category id from the Categories tab, or add the category there first')])

        # ---- transfers among own accounts: a mate of the opposite amount within four days (ledger sheets only)
        next_x = sheet.last_x
        transfer_lines = []
        if sheet.version == 2:
            lo, hi = (date.fromisoformat(first_day) - timedelta(days=TRANSFER_DAYS)).isoformat(), (date.fromisoformat(last_day) + timedelta(days=TRANSFER_DAYS)).isoformat()
            cands = [{'ref': r, 'new': True, 'date': r['date'], 'acct': r['acct'], 'amount': r['amount'], 'id': r['id']} for r in rows if sheet.flow.get(r['cat']) == 'Transfer']
            cands += [{'ref': t, 'new': False, 'date': t['date'], 'acct': t['account_id'], 'amount': t['amount'], 'id': t['txn_id']}
                      for t in sheet.tx if sheet.flow.get(t['category_id']) == 'Transfer' and not t['transfer_id'] and lo <= t['date'] <= hi]
            cands.sort(key=lambda c: (c['date'], c['acct']))
            done = set()
            for i, a in enumerate(cands):
                if i in done:
                    continue
                matches = [(j, b) for j, b in enumerate(cands) if j != i and j not in done and cents(b['amount']) == -cents(a['amount']) and b['acct'] != a['acct'] and days_apart(a['date'], b['date']) <= TRANSFER_DAYS]
                if len(matches) > 1:
                    same_day = [(j, b) for j, b in matches if b['date'] == a['date']]
                    matches = same_day if len(same_day) == 1 else matches
                if len(matches) == 1:
                    j, b = matches[0]
                    if not a['new'] and not b['new']:
                        continue
                    next_x += 1
                    xid = f'X{next_x:04d}'
                    for one, other in ((a, b), (b, a)):
                        if one['new']:
                            one['ref']['transfer_id'], one['ref']['transfer_account'] = xid, other['acct']
                        else:
                            pair_updates.append(W.update_write(f'pair-{one["id"]}', 'Entries', one['ref']['row'], 14, [xid, other['acct']],
                                                               {'range': W.a1('Entries', one['ref']['row'], 1), 'expect': [[one['id']]]},
                                                               f'{one["id"]} ({one["date"]} {one["acct"]} {one["amount"]:+.2f}) gets its mate {other["id"]}'))
                    done.update({i, j})
                    transfer_lines.append(f'- {xid}: {a["id"]} {a["date"]} {a["acct"]} {a["amount"]:+.2f} with {b["id"]} {b["date"]} {b["acct"]} {b["amount"]:+.2f}')
                elif matches:
                    transfer_lines.append(f'- {a["id"]} {a["date"]} {a["acct"]} {a["amount"]:+.2f}: {len(matches)} possible mates ({", ".join(b["id"] for _, b in matches)}); left for review')
                elif a['new']:
                    transfer_lines.append(f'- {a["id"]} {a["date"]} {a["acct"]} {a["amount"]:+.2f}: no mate in this run or the sheet; left unpaired (its mate may come with the next file)')

        # ---- loan statements
        loan_readings = [rd for rd in readings if rd['kind'] == 'loan']
        loan_lines = []
        existing_loans = Counter((t['date'], t['account_id'], cents(t['amount']), ident(t['bank_description'])) for t in sheet.tx)
        ltaken, lskipped, lrepeated, lkept = dedupe([(rd, [r for r in rd['rows'] if in_window(r)]) for rd in loan_readings], existing_loans, bank_key)
        skipped += lskipped
        repeated += lrepeated
        quiet_loans = 0
        for rd, n_kept in zip(loan_readings, lkept):
            inside = [r for r in rd['rows'] if in_window(r)]
            if inside or rd['bom']:
                loan_lines.append(f'- {rd["path"]}: {len(inside)} lines in {label}, {n_kept} new' + ('; UTF-8 byte order mark accepted' if rd['bom'] else ''))
            else:
                quiet_loans += 1
        if quiet_loans:
            loan_lines.append(f'- {quiet_loans} other loan file{"s" if quiet_loans != 1 else ""} hold no lines in {label}')
        for rd, r in ltaken:
            loan = sheet.accounts[rd['account']]
            contract = next((c for c in sheet.contracts if str(c.get('kind')).lower() == 'loan' and c.get('account_id') == rd['account']), None)
            category = (contract or {}).get('category_id') or 'MORTGAGE'
            person = (contract or {}).get('owner') or loan.get('owner') or 'Joint'
            lender = loan.get('institution') or 'Lender'
            if r['amount'] < 0:
                loan_tx.append({'date': r['date'], 'acct': rd['account'], 'desc': r['description'], 'merchant': lender, 'amount': r['amount'], 'cat': category, 'person': person,
                                'receipt': '', 'note': '', 'transfer_id': '', 'transfer_account': '', 'source': 'loan statement', 'file': rd['path'], 'line': r['line'], 'mate': None})
            else:
                pool = [{'new': True, 'ref': x, 'date': x['date'], 'acct': x['acct'], 'amount': x['amount'], 'cat': x['cat'], 'desc': x['desc'], 'id': x['id']} for x in rows] + \
                       [{'new': False, 'ref': t, 'date': t['date'], 'acct': t['account_id'], 'amount': t['amount'], 'cat': t['category_id'], 'desc': t['bank_description'], 'id': t['txn_id']} for t in sheet.tx]
                mates = [m for m in pool if cents(m['amount']) == -cents(r['amount']) and m['acct'] != rd['account'] and days_apart(m['date'], r['date']) <= TRANSFER_DAYS
                         and (m['cat'] == category or re.search(r'LOAN|REPAY|MORTGAGE', m['desc'].upper()))]
                mates.sort(key=lambda m: (m['cat'] != category, days_apart(m['date'], r['date'])))
                mate = mates[0] if mates else None
                loan_tx.append({'date': r['date'], 'acct': rd['account'], 'desc': r['description'], 'merchant': lender, 'amount': r['amount'], 'cat': 'TRANSFER', 'person': person,
                                'receipt': '', 'note': '' if mate else 'No bank row matches this repayment; pair by hand', 'transfer_id': '', 'transfer_account': mate['acct'] if mate else '',
                                'source': 'loan statement', 'file': rd['path'], 'line': r['line'], 'mate': mate})
                if not mate:
                    loan_lines.append(f'- {rd["path"]} row {r["line"]}: repayment {r["amount"]:+.2f} on {r["date"]} has no matching bank row within {TRANSFER_DAYS} days; left unpaired')
        loan_tx.sort(key=lambda r: (r['date'], r['acct'], -r['amount']))
        # closing balances: the last printed balance in each month becomes a month-end valuation on the loan account
        loan_vals = []
        for rd in loan_readings:
            for m in months:
                in_m = [r for r in rd['rows'] if r['date'][:7] == m]
                if in_m:
                    last = in_m[-1] if A.SHAPES[rd['shape']][2] == 'oldest-first' else in_m[0]
                    loan_vals.append({'month_end': month_end(m), 'acct': rd['account'], 'value': round(last['balance'], 2), 'source': 'statement', 'raw': 'Loan statement', 'desc': f'Closing balance from {sheet.accounts[rd["account"]].get("institution") or "lender"} statement', 'from': rd['path']})

        # ---- valuations: the month folder's valuations.csv, then the loan statements' closing balances
        val_lines = []
        existing_v = {(v['account_id'], v['month_end']): v['value'] for v in (sheet.valuations or [])}
        if sheet.valuations is None:
            for p in inputs:
                if (p / 'valuations.csv').exists():
                    val_lines.append(f'- {p / "valuations.csv"}: not read. This 1.1 snapshot carries no Valuations tab, so its rows can be neither de-duplicated nor planned; append them by hand (Month end, Item ID, Value)')
            inputs_for_valuations = []
        else:
            inputs_for_valuations = inputs
        proposed = {}
        wanted = []
        for p in inputs_for_valuations:
            vf = p / 'valuations.csv'
            if vf.exists():
                for i, r in enumerate(load_csv(vf), 2):
                    acct = r.get('Item ID', '').strip()
                    me = r.get('Month end', '').strip()
                    if sheet.valuation_items and acct not in sheet.valuation_items:
                        raise Stop([A.ImportFault(vf, f'{acct!r} is not on the Accounts tab' + ('' if sheet.version == 2 else ' (nor Assets or Loans)'), 'valuations are per account id; fix the Item ID or add the account first', i)])
                    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', me):
                        raise Stop([A.ImportFault(vf, f'Month end {me!r} is not yyyy-mm-dd', 'write the month end as yyyy-mm-dd', i)])
                    if first_day <= me <= last_day:
                        method = str((sheet.accounts.get(acct) or {}).get('valuation_method') or 'statement').lower()
                        wanted.append({'month_end': me, 'acct': acct, 'value': fnum(r.get('Value')), 'source': method if method != 'ledger' else 'statement', 'raw': '', 'desc': '', 'from': str(vf.relative_to(ROOT)) if str(vf).startswith(str(ROOT)) else str(vf)})
        wanted += loan_vals
        for v in wanted:
            k = (v['acct'], v['month_end'])
            if k in existing_v:
                if abs(existing_v[k] - v['value']) > TOL:
                    held = True
                    hold_lines.append(f'- {v["from"]}: {v["acct"]} at {v["month_end"]} is {v["value"]:,.2f}, the sheet already holds {existing_v[k]:,.2f}; which is right?')
                else:
                    val_lines.append(f'- {v["acct"]} {v["month_end"]} {v["value"]:,.2f}: already in the sheet ({v["from"]})')
            elif k in proposed:
                if abs(proposed[k]['value'] - v['value']) > TOL:
                    held = True
                    hold_lines.append(f'- {v["from"]} says {v["acct"]} at {v["month_end"]} is {v["value"]:,.2f}; {proposed[k]["from"]} says {proposed[k]["value"]:,.2f}; which is right?')
                else:
                    val_lines.append(f'- {v["acct"]} {v["month_end"]} {v["value"]:,.2f}: {v["from"]} agrees with {proposed[k]["from"]}')
            else:
                proposed[k] = v
                val_lines.append(f'- {v["acct"]} {v["month_end"]} {v["value"]:,.2f}: new ({v["from"]})')
        valuations = sorted(proposed.values(), key=lambda v: (v['month_end'], v['acct']))

        # ---- payslips: the payroll export and the month folder's payslips.csv, one per pay date, person and employer
        pay_lines = []
        existing_p = {(p['pay_date'], p['person'], p['employer']): p for p in sheet.payslips}
        seen_p = {}
        pay_files = [(rd['path'], [dict(r) for r in rd['rows'] if in_window(r)]) for rd in readings if rd['kind'] == 'payslips']
        for p in inputs:
            pf = p / 'payslips.csv'
            if pf.exists():
                prow = []
                for i, r in enumerate(load_csv(pf), 2):
                    try:
                        d = A.parse_date(r['Pay date'], 'ymd', pf, i)
                    except A.ImportFault as e:
                        raise Stop([e])
                    if first_day <= d <= last_day:
                        prow.append({'date': d, 'person': r['Person'].strip(), 'employer': r['Employer'].strip(), 'gross': fnum(r['Gross pay']), 'tax': fnum(r['Tax withheld']), 'super': fnum(r['Super (employer)']), 'net': fnum(r['Net pay'])})
                pay_files.append((str(pf.relative_to(ROOT)) if str(pf).startswith(str(ROOT)) else str(pf), prow))
        quiet_pay = 0
        for path, prows in pay_files:
            if not prows:
                quiet_pay += 1
                continue
            new_n = 0
            for r in prows:
                k = (r['date'], r['person'], r['employer'])
                vals = (r['gross'], r['tax'], r['super'], r['net'])
                if k in existing_p:
                    e = existing_p[k]
                    if any(abs(a - fnum(b)) > TOL for a, b in zip(vals, (e.get('gross_pay'), e.get('tax_withheld'), e.get('super'), e.get('net_pay')))):
                        held = True
                        hold_lines.append(f'- {path}: payslip {k[1]} {k[2]} {k[0]} reads {vals}, the sheet holds ({e.get("gross_pay")}, {e.get("tax_withheld")}, {e.get("super")}, {e.get("net_pay")}); which is right?')
                    continue
                if k in seen_p:
                    if seen_p[k] != vals:
                        held = True
                        hold_lines.append(f'- {path}: payslip {k[1]} {k[2]} {k[0]} reads {vals}, another file in this run reads {seen_p[k]}; which is right?')
                    continue
                seen_p[k] = vals
                payslips.append([r['date'], r['person'], r['employer'], r['gross'], r['tax'], r['super'], r['net']])
                new_n += 1
            pay_lines.append(f'- {path}: {len(prows)} payslips in {label}, {new_n} new')
        if quiet_pay:
            pay_lines.append(f'- {quiet_pay} other payslip file{"s" if quiet_pay != 1 else ""} hold no pay dates in {label}')
        payslips.sort(key=lambda p: (p[0], p[1]))

        # ---- owner statements: every line must match a bank row on the property's account
        owner_lines = []
        quiet_owner = 0
        for rd in [rd for rd in readings if rd['kind'] == 'owner']:
            prop = rd['account']
            if not any(in_window(r) for r in rd['rows']) and not rd['bom']:
                quiet_owner += 1
                continue
            bank_accts = [k for k, a in sheet.accounts.items() if a.get('linked_account') == prop and str(a.get('type') or '').lower() != 'loan' and sheet.institution(k) in A.BANK_SHAPES]
            if not bank_accts:
                raise Stop([A.ImportFault(rd['path'], f'no bank account on the Accounts tab is linked to {prop}', f'set linked_account = {prop} on the rental account\'s row so the statement knows which bank rows to reconcile against')])
            pool = Counter()
            for t in sheet.tx:
                if t['account_id'] in bank_accts:
                    pool[(t['date'], cents(t['amount']), ident(t['bank_description']))] += 1
            for r in rows:
                if r['acct'] in bank_accts:
                    pool[(r['date'], cents(r['amount']), ident(r['desc']))] += 1
            lines_in = [r for r in rd['rows'] if in_window(r)]
            matched, unmatched = 0, []
            seen_lines = Counter()
            for r in lines_in:
                k = (r['date'], cents(r['amount']), ident(r['description']))
                seen_lines[k] += 1
                if seen_lines[k] <= pool.get(k, 0):
                    matched += 1
                else:
                    unmatched.append(r)
            owner_lines.append(f'- {rd["path"]}: {len(lines_in)} lines in {label}, {matched} match bank rows on {"/".join(bank_accts)}' + (f', {len(unmatched)} do not' if unmatched else '') + ('; UTF-8 byte order mark accepted' if rd['bom'] else ''))
            for r in unmatched:
                held = True
                hold_lines.append(f'- {rd["path"]} row {r["line"]}: {r["date"]} {r["description"]} {r["amount"]:+.2f} ({r["schedule_line"]}, handled by {r["handled_by"]}) has no bank row on {"/".join(bank_accts)}. '
                                  'If the agent nets costs out of the rent, this household needs the clearing-account path (adapters.py); otherwise the bank export has a gap')
            if lines_in:
                stmt_keys = Counter((r['date'], cents(r['amount']), ident(r['description'])) for r in lines_in)
                extra = [t for t in sheet.tx if t['account_id'] in bank_accts and first_day <= t['date'] <= last_day and str(t['category_id']).startswith('RENT-') and not stmt_keys.get((t['date'], cents(t['amount']), ident(t['bank_description'])))]
                extra += [r for r in rows if r['acct'] in bank_accts and str(r['cat']).startswith('RENT-') and not stmt_keys.get((r['date'], cents(r['amount']), ident(r['desc'])))]
                if extra:
                    owner_lines.append(f'  {len(extra)} property rows on the bank account are not on the statement (owner-paid costs; fine)')
        if quiet_owner:
            owner_lines.append(f'- {quiet_owner} other owner statement{"s" if quiet_owner != 1 else ""} hold no lines in {label}')

        # ---- insurance documents
        policy_lines = []
        policy_docs = [rd for rd in readings if rd['kind'] == 'policy']
        latest = {}
        for rd in policy_docs:
            if rd['rows'][0]['doc'] == 'renewal':
                k = rd['account']
                if k not in latest or rd['rows'][0]['period_from'] > latest[k]['rows'][0]['period_from']:
                    latest[k] = rd
        for rd in policy_docs:
            doc = rd['rows'][0]
            prop = rd['account'][4:]
            if doc['doc'] == 'renewal' and latest.get(rd['account']) is not rd:
                policy_lines.append(f'- {rd["path"]}: renewal for {doc["period_from"]} to {doc["period_to"]}, premium {doc["premium"]:,.2f}; superseded by {latest[rd["account"]]["path"]}, kept as history')
                continue
            contract = next((c for c in sheet.contracts if str(c.get('kind')).lower() == 'insurance' and c.get('account_id') == prop), None)
            desc = f'{doc["policy"] or "policy"} {doc["policy_number"]}, {doc["period_from"]} to {doc["period_to"]}, premium {doc["premium"]:,.2f}'
            if not contract:
                policy_lines.append(f'- {rd["path"]}: {"renewal" if doc["doc"] == "renewal" else "certificate of currency"}, {desc}; no insurance row for {prop} on the Contracts tab, add one (kind insurance, account_id {prop})')
                continue
            diffs = []
            if abs(fnum(contract.get('amount')) - doc['premium']) > TOL:
                diffs.append(f'premium {fnum(contract.get("amount")):,.2f} -> {doc["premium"]:,.2f}')
            if (contract.get('start_date') or '') != doc['period_from'] or (contract.get('end_date') or '') != doc['period_to']:
                diffs.append(f'period {contract.get("start_date") or "blank"}..{contract.get("end_date") or "blank"} -> {doc["period_from"]}..{doc["period_to"]}')
            next_date = (date.fromisoformat(doc['period_to']) + timedelta(days=1)).isoformat() if (doc.get('status') or '').lower().startswith('paid') or not doc.get('due') else doc['due']
            if doc['doc'] == 'renewal' and (contract.get('next_date') or '') != next_date:
                diffs.append(f'next date {contract.get("next_date") or "blank"} -> {next_date}')
            cover = '; '.join(f'{k} {v}' for k, v in doc['cover'])
            if doc['doc'] == 'renewal' and diffs:
                contract_updates.append(W.update_write(f'contract-{contract["contract_id"]}-{doc["period_from"]}', 'Contracts', contract['row'], 9,
                                                       [doc['premium'], None, doc['period_from'], doc['period_to'], next_date],
                                                       {'range': W.a1('Contracts', contract['row'], 1), 'expect': [[contract['contract_id']]]},
                                                       f'{contract["contract_id"]} {contract.get("name")}: {"; ".join(diffs)} (from {rd["path"]})'))
                policy_lines.append(f'- {rd["path"]}: renewal, {desc}; Contracts {contract["contract_id"]} differs ({"; ".join(diffs)}): update planned. Cover: {cover}')
            elif doc['doc'] == 'renewal':
                policy_lines.append(f'- {rd["path"]}: renewal, {desc}; agrees with Contracts {contract["contract_id"]}. Cover: {cover}')
            else:
                policy_lines.append(f'- {rd["path"]}: certificate of currency, {desc}; ' + (f'Contracts {contract["contract_id"]} differs ({"; ".join(diffs)}); a certificate confirms, it does not change the row: check the renewal notice' if diffs else f'agrees with Contracts {contract["contract_id"]}'))

        # ---- closing balances
        balance_lines, bal_held = closing_checks(sheet, rows, readings, months)
        held = held or bal_held
    except Stop as s:
        stop_lines = [f.md() for f in s.faults]
        rows, loan_tx, valuations, payslips, pair_updates, contract_updates = [], [], [], [], [], []
        file_lines = loan_lines = val_lines = pay_lines = owner_lines = policy_lines = balance_lines = transfer_lines = []
        skipped = repeated = []
        held = False

    # ---- IDs for the rest, then the plan
    stopped = bool(stop_lines)
    next_t = sheet.last_t + len(rows)
    for v in valuations:
        v['id'] = next_id('V', sheet.last_v)
        sheet.last_v += 1
    loans_now = args.loans == 'now'
    for r in loan_tx:
        next_t += 1
        r['id'] = f'T{next_t:04d}'
    entries, deferred_entries = [], []

    def entry_row(r):
        return [r['id'], 'transaction', r['date'], r['acct'], r['desc'], r['merchant'], r['amount'], r['cat'], r['person'], r['receipt'], r['note'], 'settled', r['date'],
                r['transfer_id'], r['transfer_account'], '', '', '', '', r['source']]

    def val_row(v):
        return [v['id'], 'valuation', v['month_end'], v['acct'], v['raw'], v['desc'], v['value'], '', '', '', '', 'settled', v['month_end'], '', '', '', '', '', '', v['source']]

    # loan repayments pair with the bank row that paid them; the bank row gets the transfer id and category TRANSFER
    first_entry_row = sheet.entries_rows + 2
    row_of = {}
    main_rows = [entry_row(r) for r in rows] + ([val_row(v) for v in valuations] if sheet.version == 2 else [])
    for i, r in enumerate(rows):
        row_of[r['id']] = first_entry_row + i
    loan_rows_start = first_entry_row + len(main_rows)
    loan_entries_rows = []
    for r in loan_tx:
        if r.get('mate'):
            next_x += 1
            xid = f'X{next_x:04d}'
            r['transfer_id'] = xid
            mate = r['mate']
            if mate['new'] and loans_now:
                mate['ref']['transfer_id'], mate['ref']['transfer_account'], mate['ref']['cat'] = xid, r['acct'], 'TRANSFER'
            else:
                mrow = mate['ref']['row'] if not mate['new'] else row_of[mate['id']]
                loan_pairs.append(W.update_write(f'loan-pair-{mate["id"]}', 'Entries', mrow, 8, ['TRANSFER', None, None, None, None, None, xid, r['acct']],
                                                 {'range': W.a1('Entries', mrow, 1), 'expect': [[mate['id']]]},
                                                 f'{mate["id"]} ({mate["date"]} {mate["acct"]} {mate["amount"]:+.2f}) becomes the transfer that repaid {r["acct"]}, category TRANSFER'))
            loan_lines.append(f'- {xid}: {r["id"]} {r["date"]} {r["acct"]} {r["amount"]:+.2f} repayment received, mate {mate["id"]} {mate["date"]} {mate["acct"]} {mate["amount"]:+.2f}')
        loan_entries_rows.append(entry_row(r))
    main_rows = [entry_row(r) for r in rows] + ([val_row(v) for v in valuations] if sheet.version == 2 else [])  # mates may have changed
    if loans_now:
        main_rows += loan_entries_rows
        loan_entries_rows = []

    plan = {'schema': W.SCHEMA, 'generated_at': datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z'), 'importer': 'period-close/import_month.py', 'months': months,
            'status': 'stopped' if stopped else 'hold' if held else 'ready',
            'sheet': {'id': sheet.id, 'version': sheet.version, 'snapshot': sheet.path, 'snapshot_fetched_at': sheet.fetched},
            'assumes': {}, 'preconditions': [], 'writes': [], 'deferred': [],
            'verify': 'read every range under writes with get_values (and the preconditions before writing), save the responses as JSON, then: python3 period-close/verify.py write-plan.json reread.json'}
    if sheet.version == 2:
        plan['assumes'] = {'entries_rows': sheet.entries_rows, 'last_entry_row': sheet.entries_rows + 1, 'last_entry_id': sheet.last_entry_id, 'last_ids': {'T': f'T{sheet.last_t:04d}', 'V': f'V{sheet.last_v - len(valuations):04d}', 'X': f'X{sheet.last_x:04d}'}, 'payslips_rows': len(sheet.payslips)}
        if main_rows:
            plan['preconditions'].append(W.precondition('Entries', sheet.entries_rows + 1 if sheet.entries_rows else None, sheet.last_entry_id))
            plan['writes'] += W.append_writes('entries', 'Entries', ENTRY_COLS, main_rows, first_entry_row, note=f'{len(rows)} transactions' + (f', {len(valuations)} valuations' if valuations else '') + (f', {len(loan_tx)} loan statement lines' if loans_now and loan_tx else ''))
        plan['writes'] += pair_updates
        if loans_now:
            plan['writes'] += loan_pairs
        plan['writes'] += contract_updates
    else:
        plan['assumes'] = {'transactions_rows': sheet.entries_rows, 'last_transaction_row': sheet.entries_rows + 1, 'last_txn_id': sheet.last_entry_id, 'last_ids': {'T': f'T{sheet.last_t:04d}'}, 'payslips_rows': len(sheet.payslips),
                           'valuations_rows': len(sheet.valuations) if sheet.valuations is not None else None}
        txn_rows = [[r['id'], r['date'], r['acct'], r['desc'], r['merchant'], r['amount'], r['cat'], r['person'], r['receipt'], r['note']] for r in rows]
        if txn_rows:
            plan['preconditions'].append(W.precondition('Transactions', sheet.entries_rows + 1 if sheet.entries_rows else None, sheet.last_entry_id))
            plan['writes'] += W.append_writes('transactions', 'Transactions', TXN_COLS, txn_rows, sheet.entries_rows + 2)
        if valuations:
            if True:
                plan['preconditions'].append(W.precondition('Valuations', len(sheet.valuations) + 1 if sheet.valuations else None, sheet.valuations[-1]['month_end'] if sheet.valuations else None))
                plan['writes'] += W.append_writes('valuations', 'Valuations', VALUATION_COLS, [[v['month_end'], v['acct'], v['value']] for v in valuations], len(sheet.valuations) + 2)
        if loan_tx or loan_pairs:
            plan_notes.append('Loan statement lines are planned only for a ledger sheet (sheet_version 2); this is a 1.1 sheet, so they are listed above and not written.')
            loan_entries_rows, loan_pairs = [], []
    if payslips:
        plan['preconditions'].append(W.precondition('Payslips', len(sheet.payslips) + 1 if sheet.payslips else None, sheet.payslips[-1]['pay_date'] if sheet.payslips else None))
        plan['writes'] += W.append_writes('payslips', 'Payslips', PAYSLIP_COLS, payslips, len(sheet.payslips) + 2)
    if loan_entries_rows and sheet.version == 2:
        why = ('Phase D decides: pairing the repayment takes it out of spending (the Cash Flow figures the oracle pins) and makes the interest charged the expense; '
               'the loans must become ledger accounts (valuation_method ledger) in the same change. Re-run with --loans now once decided; '
               f'rows and IDs here assume the writes above landed first (first row {loan_rows_start}).')
        for w in W.append_writes('loan-entries', 'Entries', ENTRY_COLS, loan_entries_rows, loan_rows_start, note=f'{len(loan_tx)} loan statement lines'):
            w['why'] = why
            plan['deferred'].append(w)
        for w in loan_pairs:
            w['why'] = 'the bank row that paid the loan becomes a transfer; see the loan entries above'
            plan['deferred'].append(w)
    for w in plan['writes'] + plan['deferred']:
        if w.get('precondition'):
            plan['preconditions'].append(w['precondition'])
    if held or stopped:
        plan['held_writes' if held else 'not_planned'] = plan['writes'] + plan['deferred']
        plan['writes'], plan['deferred'] = [], []
    txn_payload = [[r['id'], r['date'], r['acct'], r['desc'], r['merchant'], r['amount'], r['cat'], r['person'], r['receipt'], r['note']] for r in rows]
    entries_payload = main_rows
    totals = {'transactions': len(rows), 'already_in_sheet': len(skipped), 'repeated_across_files': len(repeated), 'valuations': len(valuations), 'payslips': len(payslips),
              'loan_lines': len(loan_tx), 'pair_updates': len(pair_updates), 'contract_updates': len(contract_updates), 'writes': len(plan['writes']), 'deferred': len(plan['deferred']),
              'rows_written': sum(w['rows'] for w in plan['writes']), 'seconds': round(time.time() - t0, 2)}
    plan['totals'] = totals

    # ---- review.md
    body = [f'# {label} import review', '']
    if stopped:
        body += [f'**STOPPED: nothing was planned.** {len(stop_lines)} file problem{"s" if len(stop_lines) != 1 else ""} need{"s" if len(stop_lines) == 1 else ""} a person before this run can go on.', ''] + stop_lines + ['']
    elif held:
        body += ['**HOLD: do not append.** The ledger and a source disagree, so the rows wait in rows.held.json and entries.held.json, the plan\'s writes are under held_writes, and rows.json and entries.json are empty.', ''] + hold_lines + ['']
    body += [f'{len(rows)} rows to append' + (f', T{sheet.last_t + 1:04d} to T{sheet.last_t + len(rows):04d}' if rows else '') + f'; {len(skipped)} already in the sheet'
             + (f'; {len(repeated)} repeated across overlapping files' if repeated else '')
             + (f'; {len(valuations)} valuations' if valuations else '') + (f'; {len(payslips)} payslips' if payslips else '') + (f'; {len(loan_tx)} loan statement lines' if loan_tx else '')
             + (f'; {len(contract_updates)} contract update{"s" if len(contract_updates) != 1 else ""}' if contract_updates else '') + f'. {totals["seconds"]} s.', '']
    if not stopped:
        body += ['## Files'] + (file_lines or ['- no bank files in this window']) + ['']
        body += ['## Closing balances'] + (balance_lines or ['- No file printed a balance for this window.']) + ['']
        if transfer_lines:
            body += ['## Transfers'] + transfer_lines + ['']
        if loan_lines:
            body += ['## Loan statements'] + loan_lines + ['']
        if val_lines:
            body += ['## Valuations'] + val_lines + ['']
        if pay_lines:
            body += ['## Payslips'] + pay_lines + ['']
        if owner_lines:
            body += ['## Owner statements'] + owner_lines + ['']
        if policy_lines:
            body += ['## Insurance'] + policy_lines + ['']
        body += ['## Review'] + (review or ['Nothing to review.']) + ['']
        if skipped:
            body += ['## Already in the sheet (not appended)'] + [f'- {rd["path"]}: {r["date"]} {r["description"]} {r["amount"]:+.2f}' for rd, r in skipped[:40]] + ([f'- … and {len(skipped) - 40} more'] if len(skipped) > 40 else []) + ['']
        if repeated:
            body += ['## Repeated across overlapping files (taken once)'] + [f'- {rd["path"]}: {r["date"]} {r["description"]} {r["amount"]:+.2f}' for rd, r in repeated[:40]] + ([f'- … and {len(repeated) - 40} more'] if len(repeated) > 40 else []) + ['']
        body += ['## Write plan'] + plan_notes + W.summary(plan) + ['',
                 'Three steps, never a fourth: (1) this plan; (2) the agent reads each precondition range, then writes each range under `writes` with the Sheets connector `update_values`, in order, by explicit range, never `append_values`; (3) the agent re-reads every range it wrote, saves the responses, and runs `python3 period-close/verify.py write-plan.json reread.json`. Then the snapshot is refreshed and this month is closed.']
    text = '\n'.join(body).rstrip() + '\n'

    # ---- outputs
    if not args.dry_run:
        stamp = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H-%M-%SZ')
        run_dir = folder / 'runs' / stamp
        n = 1
        while run_dir.exists():
            n += 1
            run_dir = folder / 'runs' / f'{stamp}-{n}'
        run_dir.mkdir(parents=True)
        files = {'review.md': text, 'write-plan.json': json.dumps(plan, indent=1, ensure_ascii=False) + '\n',
                 'rows.json': json.dumps([] if (held or stopped) else txn_payload, indent=1, ensure_ascii=False) + '\n',
                 'entries.json': json.dumps([] if (held or stopped) else entries_payload, indent=1, ensure_ascii=False) + '\n'}
        if held:
            files['rows.held.json'] = json.dumps(txn_payload, indent=1, ensure_ascii=False) + '\n'
            files['entries.held.json'] = json.dumps(entries_payload, indent=1, ensure_ascii=False) + '\n'
        for name, content in files.items():
            (run_dir / name).write_text(content)
            (folder / name).write_text(content)
        for name in ('rows.held.json', 'entries.held.json'):
            if name not in files:
                (folder / name).unlink(missing_ok=True)
    print(text, end='')
    if not args.dry_run:
        print(f'\n(run kept under {run_dir.relative_to(ROOT) if str(run_dir).startswith(str(ROOT)) else run_dir})')
    return 1 if stopped else 2 if held else 0


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    p.add_argument('months', help='YYYY-MM, or YYYY-MM..YYYY-MM for a backfill in one run')
    p.add_argument('--sheet', default=ROOT / 'data' / 'snapshot.json', help='the sheet as last snapshotted (data/snapshot-v2.json for the ledger)')
    p.add_argument('--sheet-id', default=None, help='the spreadsheet id to write in the plan (default: the snapshot\'s, else kitty.config.json)')
    p.add_argument('--history', default=None, help='optional older history (the generator\'s data.json) for categorising')
    p.add_argument('--sources', default=ROOT / 'sources', help='the sources/ folder to read (default: the repo\'s)')
    p.add_argument('--out', default=None, help='where the run lands (default: period-close/<month>/; runs are kept under runs/<timestamp>/)')
    p.add_argument('--inputs', default=None, help='folder holding overrides.csv, payslips.csv and valuations.csv, plus <month>/ subfolders on a range (default: the run folder; on the default layout also period-close/<month>/)')
    p.add_argument('--as-of', default=None, help='no row may be dated after this day (yyyy-mm-dd); the download-date folder already caps each file')
    p.add_argument('--loans', choices=['defer', 'now'], default='defer', help='loan statement transactions and pairing: deferred for phase D (default) or written now')
    p.add_argument('--dry-run', action='store_true', help='print the review and write nothing to disk')
    args = p.parse_args(argv)
    if args.as_of:
        try:
            date.fromisoformat(args.as_of)
        except ValueError:
            raise SystemExit(f'--as-of {args.as_of}: not yyyy-mm-dd')
    code = run(args)
    sys.exit(code)


if __name__ == '__main__':
    main()
