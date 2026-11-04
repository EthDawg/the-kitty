"""Build a snapshot (the Apps Script feed shape) from typed grid reads of a sheet.

    python3 tools/grid_to_snapshot.py --base data/snapshot.json --out data/snapshot-v2.json grid1.json grid2.json ...

Each grid file is a Sheets API `spreadsheets.get` response with `includeGridData` and the field mask
`sheets.data.rowData.values.effectiveValue` (what the Google Sheets connector returns for a typed read).
This is the stand-in for `snapshot.py` while a sheet's bound Apps Script is not deployed as a web app:
the same tables, the same keys (`apps-script/Code.js`, getData), the same typing (numbers as numbers,
dates as yyyy-mm-dd, blanks as null). Tabs the grids do not cover (the Cash Flow, Budget, Tax Forecast,
Savings Finder and Mortgage views, Payslips, Settings, Categories) are carried over from --base, so pass a
base whose values are known to match; the script checks Transactions and Net Worth against it and refuses
to write when they differ.
"""
import argparse
import datetime as dt
import json
import re
from pathlib import Path

DATE_KEYS = {'date', 'settled_at', 'created_at', 'month_end', 'start_date', 'end_date', 'next_date', 'at', 'opening_date',
             'pay_date', 'last_charged', 'target_date', 'last_used', 'loan_end_date'}
EPOCH = dt.date(1899, 12, 30)


def key(h):
    return re.sub(r'^_|_$', '', re.sub(r'[^a-z0-9]+', '_', re.sub(r'\(.*?\)', '', str(h).lower())))


def serial_to_iso(n):
    return (EPOCH + dt.timedelta(days=int(round(n)))).isoformat()


def load_grids(paths):
    """title -> {row_number (1-based): {col_number (1-based): value}}"""
    sheets = {}
    for p in paths:
        doc = json.loads(Path(p).read_text())
        for sh in doc['sheets']:
            title = sh['properties']['title']
            cells = sheets.setdefault(title, {})
            for blk in sh.get('data', []):
                r0, c0 = blk.get('startRow', 0), blk.get('startColumn', 0)
                for ri, row in enumerate(blk.get('rowData', [])):
                    for ci, v in enumerate(row.get('values', [])):
                        ev = v.get('effectiveValue')
                        if ev is None:
                            continue
                        val = ev.get('numberValue', ev.get('stringValue', ev.get('boolValue')))
                        if 'errorValue' in ev:
                            raise SystemExit(f'{title}!R{r0 + ri + 1}C{c0 + ci + 1} is an error cell: {ev["errorValue"]}')
                        cells.setdefault(r0 + ri + 1, {})[c0 + ci + 1] = val
    return sheets


def table(sheets, name, header_row, last_col, stop_at_blank=True):
    cells = sheets.get(name)
    if cells is None:
        raise SystemExit(f'no grid covers the {name} tab')
    head = [key(cells.get(header_row, {}).get(c, '')) for c in range(1, last_col + 1)]
    out = []
    r = header_row + 1
    last = max(cells) if cells else header_row
    while r <= last:
        row = cells.get(r, {})
        first = row.get(1)
        if first is None or first == '':
            if stop_at_blank:
                break
            r += 1
            continue
        o = {}
        for i, k in enumerate(head):
            if not k:
                continue
            v = row.get(i + 1)
            if v == '':
                v = None
            if v is not None and k in DATE_KEYS and isinstance(v, (int, float)) and not isinstance(v, bool):
                v = serial_to_iso(v)
            o[k] = v
        out.append(o)
        r += 1
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('grids', nargs='+')
    ap.add_argument('--base', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--sheet-id', default=None)
    a = ap.parse_args()
    base = json.loads(Path(a.base).read_text())
    g = load_grids(a.grids)
    snap = dict(base)
    snap['fetchedAt'] = dt.datetime.now(dt.timezone.utc).isoformat().replace('+00:00', 'Z')
    snap['source'] = {'kind': 'connector grid read', 'sheet': a.sheet_id, 'base': str(a.base),
                      'note': 'typed cell values read through the Google Sheets connector; the same tables the bound Apps Script serves'}
    snap['metrics'] = table(g, 'Metrics', 4, 8)
    snap['compliance'] = [r for r in table(g, 'Compliance Checks', 4, 7) if r.get('status')]
    snap['networth'] = table(g, 'Net Worth', 4, 9)
    snap['subscriptions'] = table(g, 'Subscriptions', 1, 17)
    snap['goals'] = table(g, 'Goals', 1, 10)
    snap['accounts'] = table(g, 'Accounts', 1, 16)
    snap['loans'] = table(g, 'Loans', 1, 11)
    snap['assets'] = table(g, 'Assets', 1, 4)
    snap['transactions'] = table(g, 'Transactions', 1, 10)
    snap['kitty'] = table(g, 'Kitty', 4, 3)
    # the ledger tabs (sheet_version 2)
    snap['entries'] = table(g, 'Entries', 1, 21)
    snap['balances'] = table(g, 'Balances', 1, 6)
    snap['contracts'] = table(g, 'Contracts', 1, 17)
    snap['decisions'] = table(g, 'Decisions', 1, 8)
    for d in snap['decisions']:   # a date typed into Value is a date cell; the Apps Script would serve it as yyyy-mm-dd too
        if isinstance(d.get('value'), (int, float)) and not isinstance(d['value'], bool) and re.search(r'refresh|date|until|by', str(d.get('decision'))):
            d['value'] = serial_to_iso(d['value'])
    snap['rules'] = table(g, 'Rules', 1, 10)
    snap['valuations'] = table(g, 'Valuations', 1, 5)

    # the oracle for this script: tabs whose values must not have moved
    def same(a_, b_, keys, tol=0.005):
        if len(a_) != len(b_):
            return f'{len(a_)} vs {len(b_)} rows'
        for i, (x, y) in enumerate(zip(a_, b_)):
            for k in keys:
                xv, yv = x.get(k), y.get(k)
                if isinstance(xv, (int, float)) and isinstance(yv, (int, float)):
                    if abs(xv - yv) > tol:
                        return f'row {i}: {k} {xv} vs {yv}'
                elif (xv or None) != (yv or None):
                    return f'row {i}: {k} {xv!r} vs {yv!r}'
        return None
    checks = {
        'transactions': same(snap['transactions'], base['transactions'], ['txn_id', 'date', 'account_id', 'bank_description', 'merchant', 'amount', 'category_id', 'person', 'receipt_held', 'note']),
        'networth': same(snap['networth'], base['networth'], ['month_end', 'cash', 'property', 'super', 'shares', 'vehicle', 'loans', 'net_worth']),
        'subscriptions': same(snap['subscriptions'], base['subscriptions'], ['service', 'merchant', 'owner', 'cadence', 'category_id', 'last_used', 'decision', 'last_charged', 'latest_charge', 'lowest_charge_in_look_back', 'charges_per_year', 'annual_cost', 'price_rise_per_charge', 'annual_cost_of_price_rise', 'days_since_used', 'usage_flag', 'saving_if_cancelled']),
        'goals': same(snap['goals'], base['goals'], ['goal', 'target_amount', 'target_date', 'linked_account', 'balance_now', 'progress', 'status']),
        'loans': same(snap['loans'], base['loans'], ['loan_id', 'interest_rate', 'loan_end_date', 'balance_at_as_of_date', 'monthly_repayment_calculated']),
        'assets': same(snap['assets'], base['assets'], ['item_id', 'item', 'class', 'owner']),
        'accounts (first six)': same(snap['accounts'][:6], base['accounts'], ['account_id', 'account', 'institution', 'type', 'owner', 'opening_balance', 'opening_date', 'balance_at_as_of_date', 'liquid']),
    }
    bad = {k: v for k, v in checks.items() if v}
    for k in checks:
        print(f'  {k}: {"same as base" if not checks[k] else "DIFFERS: " + checks[k]}')
    mb = {m['metric_id']: m['value'] for m in base['metrics']}
    for m in snap['metrics']:
        b = mb.get(m['metric_id'])
        v = m['value']
        moved = (abs(v - b) > 0.005) if isinstance(v, (int, float)) and isinstance(b, (int, float)) else v != b
        if moved:
            print(f'  metric {m["metric_id"]}: {b!r} -> {v!r}')
    if bad:
        raise SystemExit(f'refusing to write {a.out}: {bad}')
    Path(a.out).write_text(json.dumps(snap, separators=(',', ':'), ensure_ascii=False))
    print(f'wrote {a.out}: {len(snap["entries"])} entries, {len(snap["balances"])} balances, {len(snap["accounts"])} accounts, '
          f'{len(snap["contracts"])} contracts, {len(snap["rules"])} rules, {Path(a.out).stat().st_size // 1024} KB')


if __name__ == '__main__':
    main()
