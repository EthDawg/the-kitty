"""Demo only: invent a month's bank files, payslips and valuations for the Davies household.

    python3 period-close/simulate.py 2026-12

Writes the files the way each institution delivers them, into sources/<account>/<download date>/
(see adapters.py), plus period-close/<month>/payslips.csv and valuations.csv (the inputs no feed
provides). Starting balances and the valuation walk come from period-close/state.json, which the
run updates, so months chain. A real household downloads these; nothing here touches the sheet.
"""
import csv
import json
import random
import sys
from datetime import date, timedelta
from pathlib import Path

import adapters as A

HERE = Path(__file__).parent
ROOT = HERE.parent
month = sys.argv[1]
Y, M = int(month[:4]), int(month[5:7])
random.seed(int(month.replace('-', '')))
FIRST = date(Y, M, 1)
LAST = date(Y + (M == 12), M % 12 + 1, 1) - timedelta(days=1)
state = json.loads((HERE / 'state.json').read_text())
bal = dict(state['balances'])
assert state['as_of'] < month, f'state.json is already at {state["as_of"]}'
rows = []


def add(d, acct, desc, amount):
    rows.append((date(Y, M, min(d, LAST.day)).isoformat(), acct, desc, round(amount, 2)))
    bal[acct] = round(bal[acct] + round(amount, 2), 2)


def r(lo, hi):
    return round(random.uniform(lo, hi), 2)


# ---- pay: fortnightly from each person's first pay; a month sometimes holds three
payslips = []
for person, first, gross, tax, sup, employer in [('Jordan', date(2025, 7, 3), 5254.62, 1329, 630.55, 'Northwind Logistics'),
                                                 ('Mia', date(2025, 7, 10), 3090.00, 632, 370.80, 'Bayview Health')]:
    d = first
    while d <= LAST:
        if FIRST <= d:
            net = round(gross - tax, 2)
            payslips.append([d, person, employer, gross, tax, sup, net])
            add(d.day, 'ACC-EVD', f'SALARY {employer.upper()}', net)
        d += timedelta(days=14)

# ---- the usual month
season = {12: 1.35, 1: 1.1, 7: 0.95}.get(M, 1)
add(1, 'ACC-EVD', 'HARBOUR BANK HOME LOAN REPAYMENT', -3814.75)
add(1, 'ACC-EVD', 'BUPA HEALTH INSURANCE', -419.35)
add(1, 'ACC-CC', 'ANYTIME FITNESS COBURG', -64.95)
add(2, 'ACC-CC', 'MYKI TOP UP', -60)
for acct_to, label, amt in [('ACC-SAV', 'EMERGENCY SAVER', 600), ('ACC-HOL', 'JAPAN 2027', 500)]:
    add(2, 'ACC-EVD', f'TRANSFER TO {label}', -amt)
    add(2, acct_to, 'TRANSFER FROM EVERYDAY', amt)
for i, store in enumerate(['WOOLWORTHS 3021 BRUNSWICK', 'COLES 0457 COBURG', 'ALDI STORES COBURG', 'WOOLWORTHS 3021 BRUNSWICK']):
    add(3 + i * 7, 'ACC-CC', store, -r(240, 410) * (1.18 if M == 12 and i == 3 else 1))
add(4, 'ACC-CC', 'NETFLIX.COM', -28.99)
add(5, 'ACC-RNT', f'BAYSIDE PROPERTY MGMT RENT {FIRST:%b}'.upper(), 2470)
add(5, 'ACC-RNT', 'BAYSIDE PROPERTY MGMT FEE', -163.02)
add(6, 'ACC-CC', 'AMPOL FOODARY COBURG', -r(78, 96))
drift = 1 + max(0, (Y - 2025) * 12 + M - 12) * 0.035
for i, desc in enumerate(['UBER *EATS', 'SOCIAL CLUB BRUNSWICK', 'MENULOG']):
    add(8 + i * 6, 'ACC-CC', desc, -r(48, 120) * drift * season)
add(7, 'ACC-CC', 'GOOGLE*YOUTUBEPREMIUM', -22.99)
add(9, 'ACC-CC', 'SPOTIFY P2F4A', -27.99)
add(11, 'ACC-CC', 'KMART 1127 COBURG', -r(45, 180) * (2.6 if M == 12 else 1))
add(14, 'ACC-CC', 'AUSSIE BROADBAND', -99)
add(15, 'ACC-EVD', 'LITTLE OAKS EARLY LEARNING', -r(840, 960))
add(18, 'ACC-CC', 'BELONG MOBILE x2', -70)
add(19, 'ACC-CC', 'PARAMOUNT+ AU', -9.99)
add(20, 'ACC-CC', 'SHELL COLES EXPRESS', -r(74, 92))
add(21, 'ACC-CC', 'APPLE.COM/BILL ICLOUD', -15.99)
add(22, 'ACC-CC', 'SPLASH SWIM SCHOOL', -96)
fx = r(31.40, 32.60)
add(23, 'ACC-CC', 'OPENAI *CHATGPT SUBSCR USD 20.00', -fx)
add(23, 'ACC-CC', 'INTERNATIONAL TRANSACTION FEE', -round(fx * .03, 2))
add(24, 'ACC-CC', 'AMAZON MKTPLC AU', -r(30, 140) * (2.2 if M == 12 else 1))
add(25, 'ACC-RNT', 'STRATA PLUS OC LEVY', -890) if M in (2, 5, 8, 11) else None
add(28, 'ACC-RNT', 'HARBOUR BANK INVESTMENT LOAN INTEREST', -2617.00)
if M in (1, 4, 7, 10):
    add(13, 'ACC-EVD', 'RED ENERGY ELECTRICITY', -(r(610, 690) if M in (7, 10) else r(390, 460)))
    add(19, 'ACC-EVD', 'GREATER WESTERN WATER', -r(240, 285))
if M in (2, 5, 8, 11):
    add(13, 'ACC-EVD', 'ORIGIN GAS', -(r(420, 520) if M in (8, 5) else r(150, 210)))
    add(20, 'ACC-EVD', 'MERRI-BEK CITY COUNCIL RATES', -568)
    add(10, 'ACC-RNT', 'CITY OF GREATER GEELONG RATES', -524)
    add(12, 'ACC-RNT', 'BARWON WATER', -r(195, 230))
if M % 2 == 0:
    add(17, 'ACC-CC', 'CHEMIST WAREHOUSE', -r(28, 85))
if M % 3 == 1:
    add(9, 'ACC-CC', 'JUST CUTS', -r(45, 75))

# ---- what this month is built to show (each should surface somewhere on the page)
if month == '2026-12':
    add(8, 'ACC-CC', 'MYER BOURKE ST', -r(520, 760))                     # gifts, known merchant
    add(12, 'ACC-CC', 'BIG W 0233 COBURG', -r(180, 260))                 # new merchant: gifts
    add(16, 'ACC-CC', 'THE SMITH FAMILY', -100)                          # donation, no receipt
    add(19, 'ACC-CC', 'QANTAS AIRWAYS', -2418.00)                        # Japan flights: new merchant, holidays
    add(19, 'ACC-CC', 'QANTAS AIRWAYS', -2418.00)                        # charged twice: a real duplicate to dispute
    add(27, 'ACC-CC', 'DAN MURPHYS COBURG', -r(120, 190))                # new merchant
    add(29, 'ACC-CC', 'JB HI-FI MELBOURNE CENTRAL', -349.00)             # Boxing Day
    add(30, 'ACC-EVD', 'BUPA HEALTH INSURANCE PREMIUM ADJ', -31.20)      # new description, same payer
if month == '2027-01':
    add(5, 'ACC-CC', 'AIRBNB * HMJK2Q', -1860.00)                        # Japan accommodation deposit
    add(10, 'ACC-CC', 'KATHMANDU 118 MELBOURNE', -r(280, 420))           # new merchant: travel gear
    add(15, 'ACC-CC', 'ALLIANZ TRAVEL INSURANCE', -312.00)               # new merchant
    add(20, 'ACC-CC', 'LUNA PARK MELBOURNE', -r(140, 200))               # kids, school holidays
    add(24, 'ACC-CC', 'PARAMOUNT+ AU REFUND', 9.99)                      # the dispute landed
    # the Japan saver reaches its target this month; the trip itself is paid from the card in April

# ---- month end: interest, pay the card, keep the everyday account between $2,000 and $6,500
add(LAST.day, 'ACC-SAV', 'INTEREST CREDIT', round(bal['ACC-SAV'] * .046 / 12, 2))
add(LAST.day, 'ACC-HOL', 'INTEREST CREDIT', round(bal['ACC-HOL'] * .046 / 12, 2)) if M >= 1 and month >= '2026-12' else None
owing = round(-bal['ACC-CC'], 2)
if owing > 0:
    add(LAST.day, 'ACC-EVD', 'PAYMENT TO SOUTHERN CARD', -owing)
    add(LAST.day, 'ACC-CC', 'PAYMENT RECEIVED THANK YOU', owing)
if bal['ACC-RNT'] < 1500:
    top = round(3000 - bal['ACC-RNT'], -2)
    add(LAST.day, 'ACC-EVD', 'TRANSFER TO RENTAL ACCOUNT', -top)
    add(LAST.day, 'ACC-RNT', 'TRANSFER FROM EVERYDAY', top)
if bal['ACC-EVD'] > 6500:
    sweep = round(bal['ACC-EVD'] - 5000, -2)
    add(LAST.day, 'ACC-EVD', 'SWEEP TO OFFSET', -sweep)
    add(LAST.day, 'ACC-OFF', 'SWEEP FROM EVERYDAY', sweep)
elif bal['ACC-EVD'] < 2000:
    pull = round(4000 - bal['ACC-EVD'], -2)
    add(LAST.day, 'ACC-OFF', 'TRANSFER TO EVERYDAY', -pull)
    add(LAST.day, 'ACC-EVD', 'TRANSFER FROM OFFSET', pull)

# ---- valuations: continue the walk from last month's rows
v = dict(state['valuations'])
home_loan = round(-v['LN-HOME'] + (-v['LN-HOME'] - 32000) * .0579 / 12 - 3814.75, 2)
mkt = random.uniform(-.025, .03)
v = {'HOME': round(v['HOME'] * (1 + random.uniform(.001, .006)), -3), 'RENTAL': round(v['RENTAL'] * (1 + random.uniform(0, .005)), -3),
     'SUPER-J': round(v['SUPER-J'] * (1 + mkt * .8) + 136620 / 12 * .12 * .85, 2), 'SUPER-M': round(v['SUPER-M'] * (1 + mkt * .8) + 80340 / 12 * .12 * .85, 2),
     'ETF': round(v['ETF'] * (1 + mkt), 2), 'CAR': round(v['CAR'] * .988, -2), 'LN-HOME': -home_loan, 'LN-INV': v['LN-INV']}

# ---- write the files the way each institution delivers them
download = (LAST + timedelta(days=2)).isoformat()
rows.sort(key=lambda x: (x[0], x[1], -x[3]))
written = []
for acct, inst in A.INSTITUTION.items():
    mine = [(d, desc, amt) for d, a, desc, amt in rows if a == acct]
    if not mine and acct != 'ACC-OFF':
        continue
    write, _, pattern = A.FORMATS[inst]
    folder = ROOT / 'sources' / acct / download
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / pattern.format(acct=acct, month=month)
    write(path, acct, mine, state['balances'][acct])
    written.append((path.relative_to(ROOT).as_posix(), len(mine)))

out = HERE / month
out.mkdir(exist_ok=True)
with open(out / 'payslips.csv', 'w', newline='') as f:
    w = csv.writer(f)
    w.writerow(['Pay date', 'Person', 'Employer', 'Gross pay', 'Tax withheld', 'Super (employer)', 'Net pay'])
    w.writerows([[p[0].isoformat()] + p[1:] for p in sorted(payslips)])
with open(out / 'valuations.csv', 'w', newline='') as f:
    w = csv.writer(f)
    w.writerow(['Month end', 'Item ID', 'Value'])
    w.writerows([[LAST.isoformat(), item, val] for item, val in v.items()])
(HERE / f'state.{month}.json').write_text(json.dumps({'as_of': month, 'balances': bal, 'valuations': v}, indent=1))
for p, n in written:
    print(f'{n:3d} rows  {p}')
print(len(rows), 'bank rows,', len(payslips), 'payslips,', len(v), 'valuations; closing', {k: round(b, 2) for k, b in bal.items()})
print(f'state written to period-close/state.{month}.json (promote to state.json once the month is appended)')
