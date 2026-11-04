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

AHEAD = 2
HOME_RATE = 0.0579
OFFSET_IN_THE_WALK = 32000  # the valuation walk in simulate.py charges interest on the balance less this fixed offset
INV_LOAN = 'LN-INV'
HOME_LOAN = 'LN-HOME'
SCHEDULE = {'RENT-INC': 'Gross rent', 'RENT-MGMT': 'Property agent fees and commission', 'RENT-REPAIR': 'Repairs and maintenance',
            'RENT-STRATA': 'Body corporate fees', 'RENT-INS': 'Insurance', 'RENT-INT': 'Interest on loans'}
PROPERTIES = {'RENTAL': {'name': 'Investment townhouse, Geelong', 'address': '7/41 Moorabool Lane, Geelong VIC 3220', 'account': 'ACC-RNT',
                         'loan': INV_LOAN, 'managed_from': '2025-07-01', 'rent_per_week': None}}
HOME = {'HOME': {'name': 'Family home, Brunswick', 'address': '22 Albion Crescent, Brunswick VIC 3056'}}
LOAN_NUMBERS = {HOME_LOAN: '033-142 812 006 310', INV_LOAN: '033-142 812 006 328'}
OLD_ACCOUNT = {'id': 'ACC-OLD', 'name': "Jordan's old everyday", 'institution': 'Bark Bank', 'type': 'Transaction', 'owner': 'Jordan',
               'number': '062-184 1049 7731', 'opening_balance': 1842.17, 'opening_date': '2025-06-30', 'in_sheet': False,
               'note': 'Not on the Davies sheet. A legacy account kept open with a few dollars so the CommBank shape has a real account behind it.'}


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


def old_account_rows(months):
    rng = random.Random(20250630)
    shops = ['PAYPAL *STEAM GAMES', 'JB HI-FI ONLINE', 'BWS COBURG', '7-ELEVEN 2021 COBURG', 'OFFICEWORKS COBURG', 'COLES EXPRESS COBURG']
    bal = OLD_ACCOUNT['opening_balance']
    out = []
    for m in months:
        y, mo = int(m[:4]), int(m[5:7])
        last = calendar.monthrange(y, mo)[1]
        rows = [(f'{m}-01', 'MONTHLY ACCOUNT FEE', -4.0)]
        for _ in range(rng.choice([0, 1, 1, 2])):
            day = rng.randint(3, last - 1)
            rows.append((f'{m}-{day:02d}', f'{rng.choice(shops)} Card xx4471 Value Date: {day - 1:02d}/{mo:02d}/{y}', -round(rng.uniform(8, 42), 2)))
        for d, desc, amt in rows:
            bal = round(bal + amt, 2)
        interest = round(bal * 0.0005 / 12, 2)
        rows.append((f'{m}-{last:02d}', 'CREDIT INTEREST', interest))
        bal = round(bal + interest, 2)
        out += [(d, 'ACC-OLD', desc, amt, 'FEES' if 'FEE' in desc else 'INTEREST' if 'INTEREST' in desc else 'SHOPPING') for d, desc, amt in rows]
    return out


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
            for _, frows in A.read_sources(scratch / 'sources', m):
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
    first = min(t['date'] for t in snap['transactions'])[:7]
    ahead = month_range(step(sheet_through), step(sheet_through, AHEAD))
    months = month_range(first, ahead[-1])

    tx = [(t['date'], t['account_id'], (t['bank_description'] or '').strip(), round(float(t['amount']), 2), t['category_id'] or 'UNCAT') for t in snap['transactions']]
    exact, loose = defaultdict(Counter), defaultdict(Counter)
    for d, a, desc, amt, cat in tx:
        exact[desc][cat] += 1
        loose[normalise(desc)][cat] += 1

    sim_rows, sim_payslips, sim_valuations = simulate_ahead(ahead)
    for d, a, desc, amt in sim_rows:
        seen = exact.get(desc) or loose.get(normalise(desc))
        tx.append((d, a, desc, amt, seen.most_common(1)[0][0] if seen else 'UNCAT'))
    tx += old_account_rows(months)
    tx.sort(key=lambda r: (r[0], r[1], -r[3]))

    accounts = []
    for a in snap['accounts']:
        number = A.BSB.get(a['account_id']) or ('Card ending 41007' if a['institution'] == 'Southern Card' else '')
        accounts.append({'id': a['account_id'], 'name': a['account'], 'institution': a['institution'], 'type': a['type'], 'owner': a['owner'],
                         'number': number, 'opening_balance': round(float(a['opening_balance']), 2), 'opening_date': a['opening_date'], 'in_sheet': True})
    accounts.append(dict(OLD_ACCOUNT))

    payslips = [[p['pay_date'], p['person'], p['employer'], float(p['gross_pay']), float(p['tax_withheld']), float(p['super']), float(p['net_pay'])] for p in snap['payslips']] + sim_payslips
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
    repay = {m: round(-sum(amt for d, a, desc, amt, cat in tx if d[:7] == m and cat == 'MORTGAGE'), 2) for m in months}
    known = [m for m in months if m in closing]
    for m in reversed([m for m in months if m < known[0]]):  # back-solve the months before the Net Worth tab starts, with the walk's own formula
        nxt = closing[step(m)]
        opening_next = (nxt + repay[step(m)] + OFFSET_IN_THE_WALK * HOME_RATE / 12) / (1 + HOME_RATE / 12)
        closing[m] = round(opening_next, 2)
    home_months, prev = {}, None
    for m in months:
        if prev is None:
            prev = round((closing[m] + repay[m] + OFFSET_IN_THE_WALK * HOME_RATE / 12) / (1 + HOME_RATE / 12), 2)
        interest = round(closing[m] - prev + repay[m], 2)
        home_months[m] = {'opening': prev, 'interest': interest, 'repayments': repay[m], 'closing': closing[m], 'derived': m < known[0]}
        prev = closing[m]
    inv_months = {}
    for m in months:
        interest = round(-sum(amt for d, a, desc, amt, cat in tx if d[:7] == m and cat == 'RENT-INT'), 2)
        inv_months[m] = {'opening': inv_balance, 'interest': interest, 'repayments': interest, 'closing': inv_balance, 'derived': False}
    loans = {}
    for lid, mths in ((HOME_LOAN, home_months), (INV_LOAN, inv_months)):
        l = loans_in[lid]
        loans[lid] = {'name': l['loan'], 'lender': l['lender'], 'purpose': l['purpose'], 'repayment_type': l['repayment_type'], 'rate': l['interest_rate'],
                      'end_date': l['loan_end_date'], 'offset_account': l['offset_account'], 'number': LOAN_NUMBERS[lid],
                      'repaid_from': 'ACC-EVD' if lid == HOME_LOAN else 'ACC-RNT', 'months': mths}

    # ---- properties: the owner statement is the rental account's rows by ATO schedule line
    properties = {}
    for pid, p in PROPERTIES.items():
        mths = {}
        for m in months:
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
                                  ('HOME-INS', 'HOME', 'Home and contents insurance', {'Building sum insured': 980000, 'Contents sum insured': 110000, 'Legal liability': 20000000, 'Excess': 750})):
        periods = []
        for d, a, desc, amt, c in tx:
            if c == cat:
                paid = date.fromisoformat(d)
                to = date(paid.year + 1, paid.month, paid.day) - timedelta(days=1)
                periods.append({'from': d, 'to': to.isoformat(), 'premium': round(-amt, 2), 'paid_on': d, 'paid_from': a, 'description': desc})
        where = PROPERTIES.get(pid) or HOME.get(pid)
        policies.append({'id': f'POL-{pid}', 'name': name, 'property': pid, 'address': where['address'], 'property_name': where['name'], 'cover': cover, 'periods': periods})

    capital_works = next((float(s['value']) for s in snap['settings'] if str(s['setting']).startswith('Capital works deduction')), 0)
    return {
        '_about': 'Built by portals/build-data.py from data/snapshot.json (every month the sheet holds) and period-close/simulate.py (the next two). The portals serve this and nothing else. Fictional household; ACC-OLD exists only here.',
        'household': snap['household'], 'sheet_through': sheet_through, 'simulated': ahead, 'months': months,
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


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--check', action='store_true', help='rebuild and compare with the committed file')
    p.add_argument('--out', default=HERE / 'data' / 'months.json')
    args = p.parse_args()
    data = build()
    text = dumps(data) + '\n'
    out = Path(args.out)
    if args.check:
        if not out.exists() or out.read_text() != text:
            raise SystemExit(f'{out} is stale: run python3 portals/build-data.py')
        print(f'{out} is current: {len(data["transactions"])} rows over {len(data["months"])} months')
        return
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text)
    print(f'{out}: {len(data["transactions"])} rows, {len(data["payslips"])} payslips, {len(data["months"])} months ({data["months"][0]} to {data["months"][-1]}; sheet through {data["sheet_through"]}, simulated {", ".join(data["simulated"])})')


if __name__ == '__main__':
    main()
