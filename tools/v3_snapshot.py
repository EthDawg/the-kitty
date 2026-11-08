"""Add the sheet-version-3 tabs to the bundled demo snapshot (data/snapshot-v2.json). Fictional Davies rows only.

    python3 tools/v3_snapshot.py            # write the five keys into data/snapshot-v2.json
    python3 tools/v3_snapshot.py --check    # exit 1 if the snapshot's v3 keys differ from the CSVs

The rows are the ones tools/v3_apply.py --data writes to the sheet: data/v3/decision-options.csv, goal-levers.csv,
tax-returns.csv and data/groceries/receipts.csv, receipt-lines.csv. Keys and typing follow the Apps Script feed
(apps-script/Code.js getData): a header becomes its snake_case key, numbers are numbers, dates are yyyy-mm-dd, checkboxes
are booleans and a blank cell is null. Formula columns carry the value the sheet's formula gives (Total, Check, Price per
kg or L, Result, Date if on and off, Months moved), so the page reads the same shape in demo and live mode.
Everything else in the snapshot is left byte for byte as it was."""
import csv
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SNAP = ROOT / 'data' / 'snapshot-v2.json'

# key -> (csv file, {header: kind}); a header not listed is text. Order is the sheet's column order.
TABLES = {
    'receipts': ('data/groceries/receipts.csv', {'Date': 'date', 'Items': 'num', 'Total': 'num', 'GST': 'num', 'Savings': 'num'}),
    'receipt_lines': ('data/groceries/receipt-lines.csv', {'Line': 'num', 'Qty': 'num', 'Unit price': 'num', 'Amount': 'num', 'Price per kg or L': 'num'}),
    'decision_options': ('data/v3/decision-options.csv', {'Upfront': 'num', 'Per month': 'num', 'Months': 'num', 'Extra': 'num', 'Total': 'num', 'Recommended': 'bool', 'Decide by': 'date'}),
    'goal_levers': ('data/v3/goal-levers.csv', {'On': 'bool', 'Per month': 'num', 'One-off': 'num', 'Date if on': 'date_or_text', 'Date if off': 'date_or_text', 'Months moved': 'num'}),
    'tax_returns': ('data/v3/tax-returns.csv', {'Taxable income': 'num', 'Tax on income': 'num', 'Medicare': 'num', 'Offsets': 'num', 'Withheld': 'num', 'Result': 'num', 'Lodged': 'date', 'Notice': 'date'}),
}
FIRST = {'receipts': 'Receipt ID', 'receipt_lines': 'Receipt ID', 'decision_options': 'Decision ID', 'goal_levers': 'Lever ID', 'tax_returns': 'Person'}


def key(h):
    """The feed's header key: the same rule as apps-script/Code.js and Engine.key."""
    return re.sub(r'^_|_$', '', re.sub(r'[^a-z0-9]+', '_', re.sub(r'\(.*?\)', '', str(h).lower())))


def typed(v, kind):
    if v is None or v == '':
        return None
    if kind == 'num':
        n = float(v)
        return int(n) if n.is_integer() and '.' not in v else n
    if kind == 'bool':
        return v.strip().lower() in ('true', 'yes', '1')
    if kind in ('date', 'date_or_text'):
        if re.match(r'^\d{4}-\d{2}-\d{2}$', v):
            return v
        if kind == 'date':
            raise ValueError(f'not a date: {v!r}')
        return v   # "Never": the formula's own word when a goal is never reached
    return v


def rows(name):
    path, kinds = TABLES[name]
    with open(ROOT / path, newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        head = reader.fieldnames
        if not head or head[0] != FIRST[name]:
            raise SystemExit(f'{path}: first header should be {FIRST[name]!r}')
        return [{key(h): typed(r[h], kinds.get(h)) for h in head} for r in reader if r[head[0]]]


def build():
    return {name: rows(name) for name in TABLES}


def main():
    raw = SNAP.read_text(encoding='utf-8')
    snap = json.loads(raw)
    v3 = build()
    if '--check' in sys.argv:
        bad = [k for k, v in v3.items() if snap.get(k) != v]
        print('v3 keys match the CSVs' if not bad else f'v3 keys differ: {bad}')
        return 1 if bad else 0
    snap.update(v3)
    SNAP.write_text(json.dumps(snap, separators=(',', ':'), ensure_ascii=False), encoding='utf-8')
    print(f'wrote {SNAP.relative_to(ROOT)}: ' + ', '.join(f'{len(v)} {k}' for k, v in v3.items()) + f', {SNAP.stat().st_size // 1024} KB')
    return 0


if __name__ == '__main__':
    sys.exit(main())
