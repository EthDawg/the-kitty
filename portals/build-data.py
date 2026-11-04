"""Build portals/data/months.json: every month the sheet holds, plus the next two from the simulator.

    python3 portals/build-data.py            # rewrite data/months.json
    python3 portals/build-data.py --check    # fail if the committed file is stale

The portals serve files that agree with the sheet, so the data comes from the same two places the
sheet does: data/snapshot.json for every month already appended (the sheet's own rows, categories and
loan balances) and period-close/simulate.py for the months not yet closed, run in a scratch copy so
nothing under sources/ or period-close/ moves. Loan statements, owner statements, payslips and
insurance renewals are derived from those rows, never invented beside them, with one exception that is
labelled in the output: ACC-OLD, a legacy everyday account at Bark Bank (the CommBank shape), which the
Davies sheet does not hold yet. Python 3.9+.
"""
import argparse
import calendar
import csv
import json
import random
import shutil
import subprocess
import sys
from collections import Counter, defaultdict
from datetime import date, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
PC = ROOT / 'period-close'
sys.path.insert(0, str(PC))
import adapters as A  # noqa: E402
from import_month import normalise  # noqa: E402
import history as H  # noqa: E402

AHEAD = 2
HOME_RATE = 0.0579
OFFSET_IN_THE_WALK = 32000  # the valuation walk in simulate.py charges interest on the balance less this fixed offset
INV_LOAN = 'LN-INV'
HOME_LOAN = 'LN-HOME'
SCHEDULE = {'RENT-INC': 'Gross rent', 'RENT-MGMT': 'Property agent fees and commission', 'RENT-REPAIR': 'Repairs and maintenance',
            'RENT-STRATA': 'Body corporate fees', 'RENT-INS': 'Insurance', 'RENT-INT': 'Interest on loans'}
PROPERTIES = {'RENTAL': {'name': 'Investment townhouse, Geelong', 'address': '7/41 Moorabool Lane, Geelong VIC 3220', 'account': 'ACC-RNT',
                         'loan': INV_LOAN, 'acquired': '2021-08-20', 'price': 640000, 'managed_from': '2021-09-01', 'owner_ref': 'OWN-4412'}}
HOME = {'HOME': {'name': 'Family home, Brunswick', 'address': '22 Albion Crescent, Brunswick VIC 3056'},
        'CAR': {'name': 'Family car', 'address': 'Subaru Forester (from November 2022; a 2012 Mazda 3 before)'}}
LOAN_NUMBERS = {HOME_LOAN: '033-142 812 006 310', INV_LOAN: '033-142 812 006 328'}
OLD_ACCOUNT = {'id': 'ACC-OLD', 'name': "Jordan's old everyday", 'institution': 'Bark Bank', 'type': 'Transaction', 'owner': 'Jordan',
               'number': '062-184 1049 7731', 'in_sheet': False,
               'note': 'Not on the Davies sheet. A legacy account kept open with a few dollars so the CommBank shape has a real account behind it.'}
LOAN_OPENED = {HOME_LOAN: '2019-03-15', INV_LOAN: '2021-08-20'}


def month_range(first, last):
    y, m = int(first[:4]), int(first[5:7])
    out = []
    while True:
        cur = f'{y}-{m:02d}'
        out.append(cur)
        if cur == last:
            return out
        m += 1
        if m == 13:
            y, m = y + 1, 1


def next_months(after, n):
    return month_range(after, after)[0:0] + month_range(step(after), step(after, n))


def step(month, n=1):
    y, m = int(month[:4]), int(month[5:7])
    m += n
    while m > 12:
        y, m = y + 1, m - 12
    return f'{y}-{m:02d}'


def month_end(month):
    y, m = int(month[:4]), int(month[5:7])
    return f'{month}-{calendar.monthrange(y, m)[1]:02d}'


def simulate_ahead(months):
    """Run the repo's simulator for the given months in a scratch copy; return (bank rows, payslips, valuations by month)."""
    rows, payslips, valuations = [], [], {}
    scratch = Path(HERE / '.scratch-simulate')
    if scratch.exists():
        shutil.rmtree(scratch)
    (scratch / 'period-close').mkdir(parents=True)
    (scratch / 'sources').mkdir()
    for f in ('adapters.py', 'simulate.py', 'state.json'):
        shutil.copy(PC / f, scratch / 'period-close' / f)
    try:
        for m in months:
            subprocess.run([sys.executable, str(scratch / 'period-close' / 'simulate.py'), m], check=True, capture_output=True, text=True)
            shutil.copy(scratch / 'period-close' / f'state.{m}.json', scratch / 'period-close' / 'state.json')
            for _, frows, _ in A.read_sources(scratch / 'sources', m):
                rows += frows
            with open(scratch / 'period-close' / m / 'payslips.csv', newline='') as f:
                payslips += [[r['Pay date'], r['Person'], r['Employer'], float(r['Gross pay']), float(r['Tax withheld']), float(r['Super (employer)']), float(r['Net pay'])] for r in csv.DictReader(f)]
            with open(scratch / 'period-close' / m / 'valuations.csv', newline='') as f:
                valuations[m] = {r['Item ID']: float(r['Value']) for r in csv.DictReader(f)}
    finally:
        shutil.rmtree(scratch, ignore_errors=True)
    return rows, payslips, valuations


def build():
    snap = json.loads((ROOT / 'data' / 'snapshot.json').read_text())
    state = json.loads((PC / 'state.json').read_text())
    sheet_through = max(t['date'] for t in snap['transactions'])[:7]
    assert state['as_of'] == sheet_through, f'period-close/state.json is at {state["as_of"]} but the snapshot ends {sheet_through}; close or promote first'
    sheet_from = min(t['date'] for t in snap['transactions'])[:7]
    ahead = month_range(step(sheet_through), step(sheet_through, AHEAD))

    tx = [(t['date'], t['account_id'], (t['bank_description'] or '').strip(), round(float(t['amount']), 2), t['category_id'] or 'UNCAT') for t in snap['transactions']]
    exact, loose = defaultdict(Counter), defaultdict(Counter)
    for d, a, desc, amt, cat in tx:
        exact[desc][cat] += 1
        loose[normalise(desc)][cat] += 1

    sim_rows, sim_payslips, sim_valuations = simulate_ahead(ahead)
    for d, a, desc, amt in sim_rows:
        seen = exact.get(desc) or loose.get(normalise(desc))
        tx.append((d, a, desc, amt, seen.most_common(1)[0][0] if seen else 'UNCAT'))

    # the years before the sheet, landing exactly on its opening balances, then the old account's tail
    targets = {a['account_id']: round(float(a['opening_balance']), 2) for a in snap['accounts']}
    assert all(a['opening_date'] == H.LAST.isoformat() for a in snap['accounts']), 'the sheet no longer opens on 30 June 2025; retune history.py'
    hist_rows, hist_payslips, moves = H.history(targets)
    tx += [(d, a, desc, amt, cat) for d, a, desc, amt, cat, person in hist_rows]
    old_bal = H.OPENING_2019['ACC-OLD'] + sum(r[3] for r in hist_rows if r[1] == 'ACC-OLD')
    tail, _ = H.old_account_tail(date.fromisoformat(f'{step(H.LAST.isoformat()[:7])}-01'), date.fromisoformat(month_end(ahead[-1])), round(old_bal, 2))
    tx += [(d, a, desc, amt, cat) for d, a, desc, amt, cat, person in tail]
    tx.sort(key=lambda r: (r[0], r[1], -r[3]))
    months = month_range(H.START.isoformat()[:7], ahead[-1])
    first = months[0]

    accounts = []
    for a in snap['accounts']:
        number = A.BSB.get(a['account_id']) or ('Card ending 41007' if a['institution'] == 'Southern Card' else '')
        opened = H.OPENED[a['account_id']]
        start = max(opened, H.START)
        accounts.append({'id': a['account_id'], 'name': a['account'], 'institution': a['institution'], 'type': a['type'], 'owner': a['owner'],
                         'number': number, 'opened': opened.isoformat(), 'opening_balance': H.OPENING_2019.get(a['account_id'], 0.0), 'opening_date': start.isoformat(),
                         'sheet_opening': round(float(a['opening_balance']), 2), 'in_sheet': True})
    accounts.append({**OLD_ACCOUNT, 'opened': H.OPENED['ACC-OLD'].isoformat(), 'opening_balance': H.OPENING_2019['ACC-OLD'], 'opening_date': H.START.isoformat(), 'sheet_opening': None})

    payslips = [[p['pay_date'], p['person'], p['employer'], float(p['gross_pay']), float(p['tax_withheld']), float(p['super']), float(p['net_pay'])] for p in snap['payslips']] + sim_payslips
    payslips += [[d.isoformat(), person, employer, gross, float(tax), sup, net] for d, person, employer, gross, tax, sup, net in hist_payslips]
    payslips.sort(key=lambda p: (p[0], p[1]))
    employments = sorted({(p[1], p[2]) for p in payslips})

    # ---- loans: closing balances from the sheet's Net Worth tab (loans total less the interest-only loan), then the simulator's valuations
    loans_in = {l['loan_id']: l for l in snap['loans']}
    inv_balance = round(float(loans_in[INV_LOAN]['balance_at_as_of_date']), 2)
    closing = {}
    for n in snap['networth']:
        closing[n['month_end'][:7]] = round(-float(n['loans']) - inv_balance, 2)
    for m, v in sim_valuations.items():
        closing[m] = round(-v[HOME_LOAN], 2)
    sheet_months = [m for m in months if m >= sheet_from]
    repay = {m: round(-sum(amt for d, a, desc, amt, cat in tx if d[:7] == m and cat == 'MORTGAGE'), 2) for m in months}
    known = [m for m in sheet_months if m in closing]
    for m in reversed([m for m in sheet_months if m < known[0]]):  # the sheet months before its Net Worth tab starts, with the sheet's own walk
        nxt = closing[step(m)]
        closing[m] = round((nxt + repay[step(m)] + OFFSET_IN_THE_WALK * HOME_RATE / 12) / (1 + HOME_RATE / 12), 2)
    home_months = {}
    prev = round((closing[sheet_months[0]] + repay[sheet_months[0]] + OFFSET_IN_THE_WALK * HOME_RATE / 12) / (1 + HOME_RATE / 12), 2)
    history_walk = H.home_loan_walk([(d, a, desc, amt, cat, '') for d, a, desc, amt, cat in tx if d < f'{sheet_from}-01'], [m for m in months if m < sheet_from], prev)
    home_months.update(history_walk)
    for m in sheet_months:
        interest = round(closing[m] - prev + repay[m], 2)
        home_months[m] = {'opening': prev, 'interest': interest, 'repayments': repay[m], 'closing': closing[m], 'rate': 6.04 if m < '2025-09' else 5.79, 'offset': None, 'derived': m < known[0]}
        prev = closing[m]
    inv_months = {}
    for m in months:
        if m < LOAN_OPENED[INV_LOAN][:7]:
            continue
        interest = round(-sum(amt for d, a, desc, amt, cat in tx if d[:7] == m and cat == 'RENT-INT'), 2)
        inv_months[m] = {'opening': inv_balance, 'interest': interest, 'repayments': interest, 'closing': inv_balance, 'rate': H.io_rate(date(int(m[:4]), int(m[5:7]), 1)), 'offset': None, 'derived': False}
    loans = {}
    for lid, mths in ((HOME_LOAN, home_months), (INV_LOAN, inv_months)):
        l = loans_in[lid]
        loans[lid] = {'name': l['loan'], 'lender': l['lender'], 'purpose': l['purpose'], 'repayment_type': l['repayment_type'], 'rate': l['interest_rate'],
                      'end_date': l['loan_end_date'], 'offset_account': l['offset_account'], 'number': LOAN_NUMBERS[lid], 'opened': LOAN_OPENED[lid],
                      'refinanced': H.REFINANCED.isoformat() if lid == HOME_LOAN else None, 'amount': round(mths[min(mths)]['opening'], 2) if lid == HOME_LOAN else inv_balance,
                      'repaid_from': 'ACC-EVD' if lid == HOME_LOAN else 'ACC-RNT', 'months': mths}

    # ---- properties: the owner statement is the rental account's rows by ATO schedule line
    properties = {}
    for pid, p in PROPERTIES.items():
        mths = {}
        for m in months:
            if m < p['acquired'][:7]:
                continue
            lines = []
            for d, a, desc, amt, cat in tx:
                if a != p['account'] or d[:7] != m or cat in ('TRANSFER', 'CC-PAY'):
                    continue
                line = SCHEDULE.get(cat) or ('Water charges' if cat == 'RENT-RATES' and 'WATER' in desc else 'Council rates' if cat == 'RENT-RATES' else 'Sundry rental expenses')
                lines.append([d, desc, amt, cat, line, cat in ('RENT-INC', 'RENT-MGMT')])
            mths[m] = {'rent': round(sum(l[2] for l in lines if l[3] == 'RENT-INC'), 2), 'fees': round(-sum(l[2] for l in lines if l[3] == 'RENT-MGMT'), 2), 'lines': lines}
        properties[pid] = {**p, 'months': mths}

    # ---- insurance: one policy per premium category, a period per premium paid
    policies = []
    for cat, pid, name, cover in (('RENT-INS', 'RENTAL', 'Landlord insurance', {'Building sum insured': 520000, 'Landlord contents': 20000, 'Loss of rent': '52 weeks', 'Legal liability': 20000000, 'Excess': 500}),
                                  ('HOME-INS', 'HOME', 'Home and contents insurance', {'Building sum insured': 980000, 'Contents sum insured': 110000, 'Legal liability': 20000000, 'Excess': 750}),
                                  ('CAR-INS', 'CAR', 'Comprehensive car insurance', {'Agreed value': 38900, 'Legal liability': 20000000, 'Hire car after theft': '14 days', 'Excess': 800})):
        periods = []
        for d, a, desc, amt, c in tx:
            if (c == cat) or (cat == 'CAR-INS' and c == 'CAR' and 'INSURANCE' in desc):
                paid = date.fromisoformat(d)
                to = date(paid.year + 1, paid.month, paid.day) - timedelta(days=1)
                periods.append({'from': d, 'to': to.isoformat(), 'premium': round(-amt, 2), 'paid_on': d, 'paid_from': a, 'description': desc})
        where = PROPERTIES.get(pid) or HOME.get(pid)
        policies.append({'id': f'POL-{pid}', 'name': name, 'property': pid, 'address': where['address'], 'property_name': where['name'], 'cover': cover, 'periods': periods})

    capital_works = next((float(s['value']) for s in snap['settings'] if str(s['setting']).startswith('Capital works deduction')), 0)
    return {
        '_about': 'Built by portals/build-data.py from data/snapshot.json (every month the sheet holds) and period-close/simulate.py (the next two). The portals serve this and nothing else. Fictional household; ACC-OLD exists only here.',
        'household': snap['household'], 'sheet_from': sheet_from, 'sheet_through': sheet_through, 'simulated': ahead, 'months': months,
        'history': {'from': H.START.isoformat(), 'to': H.LAST.isoformat(), 'rental_settlement': moves['settlement'], 'extra_home_loan_repayments': [[d.isoformat(), a] for d, a in moves['extra_repayments']]},
        'accounts': accounts, 'employments': [{'person': p, 'employer': e} for p, e in employments],
        'transactions': [list(r) for r in tx], 'payslips': payslips, 'loans': loans, 'properties': properties, 'policies': policies,
        'capital_works_per_year': capital_works,
    }


def dumps(obj, indent=0):
    pad = ' ' * indent
    if isinstance(obj, dict):
        if not obj:
            return '{}'
        return '{\n' + ',\n'.join(f'{pad} {json.dumps(k)}: {dumps(v, indent + 1)}' for k, v in obj.items()) + '\n' + pad + '}'
    if isinstance(obj, list):
        if obj and all(isinstance(x, list) for x in obj):
            return '[\n' + ',\n'.join(pad + ' ' + json.dumps(x) for x in obj) + '\n' + pad + ']'
        if obj and all(isinstance(x, dict) for x in obj):
            return '[\n' + ',\n'.join(pad + ' ' + dumps(x, indent + 1) for x in obj) + '\n' + pad + ']'
        return json.dumps(obj)
    return json.dumps(obj)


def write_sources(data, root):
    """The history as the banks delivered it: one file per account per month under sources/<account>/<download date>/,
    in the institution's shape, through the sheet's last closed month. Files already there are left alone (the
    simulator wrote the closed months and they must stay byte-identical). ACC-OLD is not written: it is not on the
    sheet's Accounts tab, and an importer that fails loud on unknown accounts would stop on it."""
    written = skipped = 0
    by_acct = {a['id']: a for a in data['accounts'] if a['in_sheet']}
    for m in data['months']:
        if m > data['sheet_through']:
            break
        download = (date.fromisoformat(month_end(m)) + timedelta(days=2)).isoformat()
        for acct_id, a in by_acct.items():
            if m < a['opening_date'][:7]:
                continue
            mine = [(d, desc, amt) for d, acc, desc, amt, cat in data['transactions'] if acc == acct_id and d[:7] == m]
            if not mine and acct_id != 'ACC-OFF':
                continue
            write, _, pattern = A.FORMATS[a['institution']]
            folder = root / acct_id / download
            path = folder / pattern.format(acct=acct_id, month=m)
            if path.exists():
                skipped += 1
                continue
            opening = a['opening_balance'] + sum(amt for d, acc, desc, amt, cat in data['transactions'] if acc == acct_id and d < f'{m}-01')
            folder.mkdir(parents=True, exist_ok=True)
            write(path, acct_id, mine, round(opening, 2))
            written += 1
    return written, skipped


def stats(data):
    accounts = [a for a in data['accounts']]
    docs = 0
    for a in accounts:
        months_open = [m for m in data['months'] if m >= a['opening_date'][:7]]
        docs += len(months_open)
    for lid, l in data['loans'].items():
        docs += len(l['months']) + len({int(m[:4]) + (m[5:7] >= '07') for m in l['months']})
    for pid, p in data['properties'].items():
        docs += len(p['months']) + len({int(m[:4]) + (m[5:7] >= '07') for m in p['months']})
    docs += len(data['payslips']) + len({int(p[0][:4]) + (p[0][5:7] >= '07') for p in data['payslips']}) * len(data['employments'])
    docs += sum(2 * len(p['periods']) for p in data['policies'])
    first, last = data['months'][0], data['months'][-1]
    return {'years': round((int(last[:4]) * 12 + int(last[5:7]) - int(first[:4]) * 12 - int(first[5:7]) + 1) / 12, 1), 'from': f'{calendar.month_abbr[int(first[5:7])]} {first[:4]}', 'to': f'{calendar.month_abbr[int(last[5:7])]} {last[:4]}',
            'transactions': len(data['transactions']), 'accounts': len(accounts), 'payslips': len(data['payslips']), 'documents': docs, 'sheet_from': data['sheet_from'], 'sheet_through': data['sheet_through']}


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--check', action='store_true', help='rebuild and compare with the committed file')
    p.add_argument('--out', default=HERE / 'data' / 'months.json')
    p.add_argument('--write-sources', action='store_true', help='also write the history as bank files under sources/ (files already there are kept)')
    args = p.parse_args()
    data = build()
    text = dumps(data) + '\n'
    out = Path(args.out)
    if args.write_sources:
        written, skipped = write_sources(data, ROOT / 'sources')
        print(f'sources/: {written} files written, {skipped} already there')
    if args.check:
        if not out.exists() or out.read_text() != text:
            raise SystemExit(f'{out} is stale: run python3 portals/build-data.py')
        print(f'{out} is current: {len(data["transactions"])} rows over {len(data["months"])} months')
        return
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text)
    if out == HERE / 'data' / 'months.json':
        (HERE / 'public' / 'stats.json').write_text(json.dumps(stats(data)) + '\n')
    print(f'{out}: {len(data["transactions"])} rows, {len(data["payslips"])} payslips, {len(data["months"])} months ({data["months"][0]} to {data["months"][-1]}; sheet through {data["sheet_through"]}, simulated {", ".join(data["simulated"])})')


if __name__ == '__main__':
    main()
