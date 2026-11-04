"""Years of history for the Davies household, chained into the sheet.

The Kitty's demo sheet starts on 1 July 2025 with an opening balance per account. This module invents the
six years before that (1 March 2019, when the home settled, to 30 June 2025) so the portals hold the
household's whole life as a bank, an agent, a payroll and an insurer would hold it: a refinance, a rental
bought in 2021, a card opened in 2020, a saver in 2022, a baby, a car, rate rises, pay rises, price rises.
The last month lands every account exactly on the sheet's opening balance, so the sheet's own rows from
July 2025 continue unchanged and an agent can rebuild the sheet from the portals alone. Fictional; the
merchant strings are the kind a bank writes. Every transfer between own accounts is written on both sides.
"""
import calendar
import random
from datetime import date, timedelta

START = date(2019, 3, 1)
SHEET_FROM = date(2025, 7, 1)
LAST = date(2025, 6, 30)

OPENED = {'ACC-EVD': date(2019, 3, 1), 'ACC-OFF': date(2019, 3, 15), 'ACC-CC': date(2020, 6, 1), 'ACC-RNT': date(2021, 8, 20),
          'ACC-SAV': date(2022, 2, 14), 'ACC-HOL': date(2025, 5, 1), 'ACC-OLD': date(2012, 9, 3)}
OPENING_2019 = {'ACC-EVD': 4120.55, 'ACC-OFF': 12000.00, 'ACC-OLD': 2480.52}  # balances when the history starts
HOME_SETTLED = date(2019, 3, 15)
REFINANCED = date(2020, 12, 15)          # new 30-year term, ends 2050-12-31 as the sheet's Loans tab says
RENTAL_SETTLED = date(2021, 8, 20)
RENTAL_PRICE, RENTAL_LOAN = 640000, 520000
RENTAL_COSTS = [('SETTLEMENT 7/41 MOORABOOL LANE GEELONG - BALANCE OF PURCHASE', RENTAL_PRICE - RENTAL_LOAN, 'UNCAT'),
                ('STATE REVENUE OFFICE VIC - LAND TRANSFER DUTY', 33070.00, 'UNCAT'), ('GEELONG CONVEYANCING PTY LTD', 1650.00, 'UNCAT'),
                ('HARBOUR BANK INVESTMENT LOAN ESTABLISHMENT FEE', 595.00, 'FEES')]
EXTRA_DATES = [date(2022, 1, 17), date(2022, 7, 18), date(2023, 1, 16), date(2023, 7, 17), date(2024, 1, 15), date(2024, 7, 15), date(2025, 1, 13), date(2025, 6, 16)]
EXTRA_BUFFER = 12000  # the offset never dips below this after a lump sum
CAR_BOUGHT = date(2022, 11, 5)
BABY = date(2022, 3, 20)
CHILDCARE_FROM = date(2023, 7, 1)

# A cash-rate-like path and the two loans' margins. The sheet's own months (from July 2025) carry the known rates.
CASH = [(date(2019, 3, 1), 1.50), (date(2019, 6, 5), 1.25), (date(2019, 7, 3), 1.00), (date(2019, 10, 2), 0.75), (date(2020, 3, 4), 0.25),
        (date(2020, 11, 4), 0.10), (date(2022, 5, 4), 0.35), (date(2022, 6, 8), 0.85), (date(2022, 7, 6), 1.35), (date(2022, 8, 3), 1.85),
        (date(2022, 9, 7), 2.35), (date(2022, 10, 5), 2.60), (date(2022, 11, 2), 2.85), (date(2022, 12, 7), 3.10), (date(2023, 2, 8), 3.35),
        (date(2023, 3, 8), 3.60), (date(2023, 5, 3), 3.85), (date(2023, 6, 7), 4.10), (date(2023, 11, 8), 4.35), (date(2025, 9, 1), 4.10)]
HOME_MARGIN, IO_MARGIN = 1.69, 1.94   # 6.04% and 6.29% at a 4.35% cash rate, 5.79% and 6.04% after the cut, as the sheet has them
HOME_REPAYMENTS = [(date(2019, 3, 1), 3420.00), (date(2019, 8, 1), 3380.00), (date(2020, 4, 1), 3290.00), (date(2021, 1, 1), 3180.00),
                   (date(2022, 6, 1), 3250.00), (date(2022, 9, 1), 3420.00), (date(2023, 1, 1), 3590.00), (date(2023, 4, 1), 3700.00),
                   (date(2023, 7, 1), 3820.00), (date(2023, 12, 1), 3912.40), (date(2025, 9, 1), 3814.75)]


def at(table, d):
    v = table[0][1]
    for when, val in table:
        if d >= when:
            v = val
    return v


def home_rate(d):
    return round(at(CASH, d) + HOME_MARGIN, 2)


def io_rate(d):
    return round(at(CASH, d) + IO_MARGIN, 2)


def home_repayment(d):
    return at(HOME_REPAYMENTS, d)


def fy(d):
    return d.year + (d.month >= 7)


# Resident tax brackets by financial year (threshold, rate), plus the 2% Medicare levy; LMITO and LITO left out.
BRACKETS = {2020: [(0, 0), (18200, .19), (37000, .325), (90000, .37), (180000, .45)],
            2021: [(0, 0), (18200, .19), (45000, .325), (120000, .37), (180000, .45)],
            2025: [(0, 0), (18200, .16), (45000, .30), (135000, .37), (190000, .45)]}
SG = {2020: .095, 2021: .095, 2022: .10, 2023: .105, 2024: .11, 2025: .115, 2026: .12}


def annual_tax(income, year):
    b = BRACKETS[2025] if year >= 2025 else BRACKETS[2021] if year >= 2021 else BRACKETS[2020]
    tax = 0
    for i, (lo, rate) in enumerate(b):
        hi = b[i + 1][0] if i + 1 < len(b) else 10 ** 9
        if income > lo:
            tax += (min(income, hi) - lo) * rate
    return tax + income * 0.02


# Salaries: a step per July review, a promotion for Jordan in 2023, parental leave for Mia around the baby.
JORDAN = [(date(2019, 1, 1), 108000), (date(2019, 7, 1), 111000), (date(2020, 7, 1), 113000), (date(2021, 7, 1), 116500), (date(2022, 7, 1), 120000),
          (date(2023, 3, 1), 126000), (date(2024, 7, 1), 129000), (date(2025, 7, 1), 132000), (date(2026, 9, 1), 136620)]
MIA = [(date(2019, 1, 1), 64000), (date(2019, 7, 1), 66000), (date(2020, 7, 1), 67500), (date(2021, 7, 1), 69000), (date(2023, 1, 9), 72000),
       (date(2024, 7, 1), 75000), (date(2025, 7, 1), 78000), (date(2026, 7, 1), 80340)]
PEOPLE = {'Jordan': (date(2025, 7, 3), JORDAN, 'Northwind Logistics', 'ACC-EVD'), 'Mia': (date(2025, 7, 10), MIA, 'Bayview Health', 'ACC-EVD')}


def pay_dates(anchor, first, last):
    d = anchor
    while d > first:
        d -= timedelta(days=14)
    out = []
    while d <= last:
        if d >= first:
            out.append(d)
        d += timedelta(days=14)
    return out


def payslips_between(first, last):
    """[(pay date, person, employer, gross, tax, super, net)] for every pay in [first, last]."""
    out = []
    for person, (anchor, salaries, employer, _) in PEOPLE.items():
        for d in pay_dates(anchor, first, last):
            salary = at(salaries, d)
            leave = person == 'Mia' and BABY - timedelta(days=14) <= d < date(2022, 7, 1)      # paid parental leave at half pay
            back_part_time = person == 'Mia' and date(2022, 7, 1) <= d < date(2023, 1, 9)       # then three days a week
            if person == 'Mia' and d >= BABY - timedelta(days=14) and d < date(2022, 7, 1) and d >= date(2022, 5, 15):
                continue  # unpaid leave: no payslip
            factor = .5 if leave else .6 if back_part_time else 1
            gross = round(salary * factor / 26, 2)
            bonus = 6000 if person == 'Jordan' and d.month == 9 and d.day <= 14 and d.year in (2021, 2023, 2024, 2025) else 0
            tax = round(annual_tax(salary * factor, fy(d)) / 26 + 8, 0) + (round(bonus * .32) if bonus else 0)
            gross += bonus
            sup = round((salary * factor / 26 + bonus) * SG.get(fy(d), .12), 2)
            out.append((d, person, employer, round(gross, 2), tax, sup, round(gross - tax, 2)))
    return sorted(out)


def last_day(y, m):
    return date(y, m, calendar.monthrange(y, m)[1])


def months(first, last):
    d = date(first.year, first.month, 1)
    while d <= last:
        yield d
        d = date(d.year + (d.month == 12), d.month % 12 + 1, 1)


def price_index(d):
    """Roughly the CPI path, with the sheet's 2025 prices as 1.0."""
    pts = [(2019, .82), (2020, .83), (2021, .85), (2022, .91), (2023, .97), (2024, .99), (2025, 1.0), (2026, 1.03), (2027, 1.05)]
    y = d.year + (d.month - 1) / 12
    for (y0, v0), (y1, v1) in zip(pts, pts[1:]):
        if y0 <= y <= y1:
            return v0 + (v1 - v0) * (y - y0) / (y1 - y0)
    return pts[-1][1] if y > pts[-1][0] else pts[0][1]


# How each institution writes a purchase. The sheet's own months (from July 2025) keep the sheet's plain
# descriptors; the years before vary the way real exports do, so a merchant dictionary has something to chew on.
#   Harbour Bank (Westpac shape): card purchases carry a state and country token and are sometimes cut at 24
#     characters ("WOOLWORTHS 3021 BRUNSWIC"); direct debits name the biller as the biller wrote it.
#   Southern Card (Amex shape): the merchant's own string, sometimes with a city token or PTY LTD, no card suffix
#     (the Card Member column carries the person).
#   Bark Bank (CommBank shape): "<merchant> Card xx4471 Value Date: dd/mm/yyyy" on card purchases.
#   Wattle Credit Union (ING shape): transfers and interest only, as the sheet writes them.
# Store numbers move between two stores per chain; a few merchants changed trading names over the years.
STORES = {'WOOLWORTHS 3021 BRUNSWICK': ['WOOLWORTHS 3021 BRUNSWICK', 'WOOLWORTHS 1124 COBURG'], 'COLES 0457 COBURG': ['COLES 0457 COBURG', 'COLES 0433 BRUNSWICK'],
          'KMART 1127 COBURG': ['KMART 1127 COBURG', 'KMART 1066 NORTHLAND'], 'ALDI STORES COBURG': ['ALDI STORES COBURG', 'ALDI STORES - BRUNSWICK']}
CITY = {'AMAZON MKTPLC AU': 'AMAZON MKTPLC AU SYDNEY SOUTH', 'APPLE.COM/BILL ICLOUD': 'APPLE.COM/BILL SYDNEY', 'NETFLIX.COM': 'NETFLIX.COM MELBOURNE',
        'SPOTIFY P2F4A': 'SPOTIFY P2F4A SYDNEY', 'UBER *EATS': 'UBER* EATS MELBOURNE', 'MENULOG': 'MENULOG PTY LTD', 'AUSSIE BROADBAND': 'AUSSIE BROADBAND PTY LTD',
        'LITTLE OAKS EARLY LEARNING': 'LITTLE OAKS EARLY LEARNING PTY LTD', 'SPLASH SWIM SCHOOL': 'SPLASH SWIM SCHOOL PTY LTD', 'CHEMIST WAREHOUSE': 'CHEMIST WAREHOUSE COBURG'}
CARD_LIKE = ('WOOLWORTHS', 'COLES', 'ALDI', 'KMART', 'AMAZON', 'AMPOL', 'CALTEX', 'SHELL', 'UBER', 'MENULOG', 'DOORDASH', 'SOCIAL CLUB', 'CHEMIST', 'JUST CUTS',
             'BABY BUNTING', 'BIG W', 'BUNNINGS', 'MYER', 'JB HI-FI', 'OFFICEWORKS', 'JETSTAR', 'AGODA', 'AIRBNB', 'MANTRA', 'MYCAR', 'KATHMANDU', 'DAN MURPHYS')


def decorate(desc, acct, d, rng):
    """One descriptor, written the way the account's institution writes it. Deterministic for the same inputs."""
    core = desc
    if core in STORES:
        core = STORES[core][0] if rng.random() < 0.72 else STORES[core][1]
    if core in CITY and rng.random() < 0.6:
        core = CITY[core]
    is_card = core.startswith(CARD_LIKE)
    if acct == 'ACC-EVD' and is_card:
        out = f'{core} VIC AU' if rng.random() < 0.7 else core
        return out[:24].rstrip() if rng.random() < 0.3 else out
    return core


def generate(targets):
    """targets: {account id: balance at LAST} from the sheet's Accounts tab. Returns (rows, payslips) where rows are
    (date iso, account, description, amount, category, person)."""
    rng = random.Random(20190301)
    rows = []
    bal = {k: 0.0 for k in OPENED}
    bal.update(OPENING_2019)
    opened = {k: v for k, v in OPENED.items()}

    drng = random.Random(20190302)

    def add(d, acct, desc, amt, cat, person='Joint'):
        if d < START or d > LAST or d < opened[acct]:
            return
        amt = round(amt, 2)
        if acct in ('ACC-EVD', 'ACC-CC') and cat not in ('TRANSFER', 'CC-PAY', 'SALARY', 'MORTGAGE', 'INTEREST'):
            desc = decorate(desc, acct, d, drng)
        rows.append((d.isoformat(), acct, desc, amt, cat, person))
        bal[acct] = round(bal[acct] + amt, 2)

    def transfer(d, src, dst, amt, out_desc, in_desc):
        add(d, src, out_desc, -amt, 'TRANSFER')
        add(d, dst, in_desc, amt, 'TRANSFER')

    def r(lo, hi, d):
        return round(rng.uniform(lo, hi) * price_index(d), 2)

    def spend_acct(d):
        return 'ACC-CC' if d >= OPENED['ACC-CC'] else 'ACC-EVD'

    # ---- pay
    for d, person, employer, gross, tax, sup, net in payslips_between(START, LAST):
        add(d, 'ACC-EVD', f'SALARY {employer.upper()}', net, 'SALARY', person)

    for m in months(START, LAST):
        y, mo = m.year, m.month
        covid = date(2020, 3, 23) <= m <= date(2021, 10, 31)
        lockdown = date(2020, 3, 23) <= m <= date(2020, 10, 31) or date(2021, 7, 15) <= m <= date(2021, 10, 21)
        day = lambda dd: date(y, mo, min(dd, calendar.monthrange(y, mo)[1]))
        sa = spend_acct(m)
        # home loan, health insurance, phones, internet
        add(day(1), 'ACC-EVD', 'HARBOUR BANK HOME LOAN REPAYMENT', -home_repayment(m), 'MORTGAGE')
        add(day(1), 'ACC-EVD', 'BUPA HEALTH INSURANCE', -round(398.20 * price_index(m) / price_index(date(2025, 6, 1)) * (0.88 if y < 2022 else 1), 2), 'HEALTH')
        add(day(14), sa, 'AUSSIE BROADBAND' if m >= date(2021, 2, 1) else 'TPG INTERNET', -(99 if m >= date(2023, 1, 1) else 85 if m >= date(2021, 2, 1) else 69.99), 'TELCO')
        add(day(18), sa, 'BELONG MOBILE x2' if m >= date(2020, 9, 1) else 'TELSTRA MOBILE x2', -(70 if m >= date(2020, 9, 1) else 110), 'TELCO')
        # groceries: four shops a month, more with a baby in the house
        kid = 1.12 if m >= BABY else 1
        for i, store in enumerate(['WOOLWORTHS 3021 BRUNSWICK', 'COLES 0457 COBURG', 'ALDI STORES COBURG', 'WOOLWORTHS 3021 BRUNSWICK']):
            add(day(3 + i * 7), sa, store, -r(200, 360, m) * kid * (1.18 if mo == 12 and i == 3 else 1) * (1.15 if lockdown else 1), 'GROCERIES')
        # transport
        if not lockdown:
            add(day(6), sa, 'AMPOL FOODARY COBURG' if m >= date(2020, 7, 1) else 'CALTEX COBURG', -r(62, 84, m), 'TRANSPORT', 'Jordan')
            add(day(20), sa, 'SHELL COLES EXPRESS', -r(58, 78, m), 'TRANSPORT', 'Mia')
            add(day(2), sa, 'MYKI TOP UP', -(60 if m >= date(2022, 1, 1) else 45), 'TRANSPORT', 'Jordan')
        # dining, lower in lockdowns and with a newborn
        dine = 0.35 if lockdown else 0.7 if covid else 0.8 if BABY <= m <= BABY + timedelta(days=120) else 1
        for i, desc in enumerate(['UBER *EATS', 'SOCIAL CLUB BRUNSWICK', 'MENULOG']):
            if desc == 'SOCIAL CLUB BRUNSWICK' and lockdown:
                continue
            add(day(8 + i * 6), sa, desc, -r(38, 95, m) * dine * ({12: 1.35, 1: 1.1, 7: 0.95}.get(mo, 1)), 'DINING', ['Joint', 'Jordan', 'Mia'][i])
        if lockdown:
            add(day(9), sa, 'DOORDASH', -r(30, 70, m), 'DINING')
        # subscriptions arrive over the years and creep up in price
        add(day(4), sa, 'NETFLIX.COM', -(13.99 if y < 2021 else 16.99 if y < 2023 else 22.99 if m < date(2024, 6, 1) else 25.99), 'SUBS', 'Mia')
        add(day(9), sa, 'SPOTIFY P2F4A', -(17.99 if y < 2022 else 20.99 if m < date(2024, 11, 1) else 22.99), 'SUBS')
        if m >= date(2020, 11, 1):
            add(day(12), sa, 'DISNEY PLUS', -(8.99 if y < 2022 else 11.99 if y < 2024 else 13.99 if m < date(2025, 1, 1) else 15.99), 'SUBS')
        if m >= date(2023, 3, 1):
            add(day(16), sa, 'KAYO SPORTS', -(25 if y < 2024 else 30), 'SUBS', 'Jordan')
        if m >= date(2024, 2, 1):
            add(day(7), sa, 'GOOGLE*YOUTUBEPREMIUM', -(22.99), 'SUBS')
        if m >= date(2024, 3, 1):
            fx = r(29.5, 32.6, date(2025, 6, 1))
            add(day(23), sa, 'OPENAI *CHATGPT SUBSCR USD 20.00', -fx, 'SUBS', 'Jordan')
            add(day(23), sa, 'INTERNATIONAL TRANSACTION FEE', -round(fx * .03, 2), 'FEES')
        if m >= date(2025, 2, 1):
            add(day(19), sa, 'PARAMOUNT+ AU', -9.99, 'SUBS')
        add(day(21), sa, 'APPLE.COM/BILL ICLOUD', -(4.49 if y < 2023 else 14.99 if m < date(2024, 1, 1) else 15.99), 'SUBS')
        add(day(1), sa, 'ANYTIME FITNESS COBURG', -(54.95 if y < 2023 else 59.95 if y < 2025 else 64.95), 'SUBS', 'Jordan')
        # shopping and personal
        add(day(11), sa, 'KMART 1127 COBURG', -r(35, 140, m) * (2.6 if mo == 12 else 1), 'SHOPPING')
        add(day(24), sa, 'AMAZON MKTPLC AU', -r(25, 110, m) * (2.2 if mo == 12 else 1), 'SHOPPING')
        if mo % 2 == 0:
            add(day(17), sa, 'CHEMIST WAREHOUSE', -r(22, 70, m) * (1.4 if m >= BABY else 1), 'HEALTH')
        if mo % 3 == 1:
            add(day(9), sa, 'JUST CUTS', -r(38, 62, m), 'PERSONAL', 'Mia')
        if m >= BABY and mo % 2 == 1:
            add(day(13), sa, 'BABY BUNTING COBURG' if m < date(2024, 6, 1) else 'BIG W 0233 COBURG', -r(40, 160, m), 'SHOPPING')
        # utilities, rates, water
        if mo in (1, 4, 7, 10):
            add(day(13), 'ACC-EVD', 'RED ENERGY ELECTRICITY' if m >= date(2021, 10, 1) else 'AGL ELECTRICITY', -(r(520, 600, m) if mo in (7, 10) else r(330, 390, m)), 'UTILITIES')
            add(day(19), 'ACC-EVD', 'GREATER WESTERN WATER' if m >= date(2021, 7, 1) else 'YARRA VALLEY WATER', -r(200, 240, m), 'UTILITIES')
        if mo in (2, 5, 8, 11):
            add(day(13), 'ACC-EVD', 'ORIGIN GAS', -(r(360, 440, m) if mo in (5, 8) else r(130, 180, m)), 'UTILITIES')
            add(day(20), 'ACC-EVD', 'MERRI-BEK CITY COUNCIL RATES' if m >= date(2022, 10, 1) else 'MORELAND CITY COUNCIL RATES', -(568 if y >= 2025 else 540 if y >= 2023 else 505 if y >= 2021 else 480), 'RATES-HOME')
        # kids
        if m >= CHILDCARE_FROM:
            add(day(15), 'ACC-EVD', 'LITTLE OAKS EARLY LEARNING', -r(700, 800, m) * (1.0 if m < date(2024, 7, 1) else 1.12), 'CHILDCARE')
        if m >= date(2024, 2, 1):
            add(day(22), sa, 'SPLASH SWIM SCHOOL', -(88 if y < 2025 else 96), 'KIDS-ACT')
        # the rental: rent in, agent fee, interest-only loan, the property's own bills
        if m >= date(2021, 9, 1):
            rent = 1950 if m < date(2022, 9, 1) else 2080 if m < date(2023, 9, 1) else 2210 if m < date(2024, 3, 1) else 2340
            add(day(5), 'ACC-RNT', f'BAYSIDE PROPERTY MGMT RENT {m:%b}'.upper(), rent, 'RENT-INC')
            add(day(5), 'ACC-RNT', 'BAYSIDE PROPERTY MGMT FEE', -round(rent * .066, 2), 'RENT-MGMT')
            if mo in (2, 5, 8, 11):
                add(day(10), 'ACC-RNT', 'CITY OF GREATER GEELONG RATES', -(524 if y >= 2025 else 498 if y >= 2023 else 470), 'RENT-RATES')
                add(day(12), 'ACC-RNT', 'BARWON WATER', -r(165, 200, m), 'RENT-RATES')
                add(day(25), 'ACC-RNT', 'STRATA PLUS OC LEVY', -(890 if y >= 2025 else 840 if y >= 2023 else 790), 'RENT-STRATA')
        if m >= date(2021, 9, 1):
            add(day(28), 'ACC-RNT', 'HARBOUR BANK INVESTMENT LOAN INTEREST', -round(RENTAL_LOAN * io_rate(m) / 100 / 12, 2), 'RENT-INT')
        # savers: a standing transfer, interest at month end
        if m >= date(2022, 3, 1):
            transfer(day(2), 'ACC-EVD', 'ACC-SAV', 250, 'TRANSFER TO EMERGENCY SAVER', 'TRANSFER FROM EVERYDAY')
        if m >= date(2025, 5, 1):
            transfer(day(2), 'ACC-EVD', 'ACC-HOL', 1250, 'TRANSFER TO JAPAN 2027', 'TRANSFER FROM EVERYDAY')
        if m >= date(2022, 3, 1):
            add(last_day(y, mo), 'ACC-SAV', 'INTEREST CREDIT', round(bal['ACC-SAV'] * (0.012 if y < 2023 else 0.042 if y < 2025 else 0.046) / 12, 2), 'INTEREST')
        # the old account at Bark Bank ticks over on its own
        add(day(1), 'ACC-OLD', 'MONTHLY ACCOUNT FEE', -4.0, 'FEES')
        for _ in range(rng.choice([0, 1, 1, 2])):
            dd = rng.randint(3, 27)
            add(day(dd), 'ACC-OLD', f'{rng.choice(["PAYPAL *STEAM GAMES", "JB HI-FI ONLINE", "BWS COBURG", "7-ELEVEN 2021 COBURG", "OFFICEWORKS COBURG", "COLES EXPRESS COBURG"])} Card xx4471 Value Date: {dd - 1:02d}/{mo:02d}/{y}', -r(8, 42, m), 'SHOPPING', 'Jordan')
        add(last_day(y, mo), 'ACC-OLD', 'CREDIT INTEREST', round(max(bal['ACC-OLD'], 0) * 0.0005 / 12, 2), 'INTEREST')

    # ---- the years' events
    E = [
        (date(2019, 4, 6), 'ACC-EVD', 'BUNNINGS COBURG', -r(180, 260, date(2019, 4, 6)), 'HOME-MAINT'),
        (date(2019, 8, 14), 'ACC-EVD', 'ALLIANZ CAR INSURANCE RENEWAL', -862, 'CAR'), (date(2019, 10, 7), 'ACC-EVD', 'VICROADS REGISTRATION', -812, 'CAR'),
        (date(2019, 10, 12), 'ACC-EVD', 'JETSTAR AIRWAYS', -1480, 'HOLIDAYS'), (date(2019, 10, 14), 'ACC-EVD', 'AGODA BALI VILLA', -1690, 'HOLIDAYS'),
        (date(2019, 12, 18), 'ACC-EVD', 'MYER BOURKE ST', -r(380, 520, date(2019, 12, 1)), 'GIFTS'),
        (date(2020, 3, 3), 'ACC-EVD', 'YOUI HOME AND CONTENTS', -1220, 'HOME-INS'),
        (date(2020, 4, 2), 'ACC-EVD', 'OFFICEWORKS COBURG', -689, 'WORK-EQUIP', 'Jordan'), (date(2020, 4, 2), 'ACC-EVD', 'JB HI-FI MELBOURNE CENTRAL', -449, 'WORK-EQUIP', 'Jordan'),
        (date(2020, 8, 14), 'ACC-CC', 'ALLIANZ CAR INSURANCE RENEWAL', -884, 'CAR'), (date(2020, 10, 7), 'ACC-CC', 'VICROADS REGISTRATION', -826, 'CAR'),
        (date(2020, 12, 15), 'ACC-EVD', 'HARBOUR BANK LOAN ESTABLISHMENT FEE', -395, 'FEES'), (date(2020, 12, 15), 'ACC-EVD', 'LAND VICTORIA MORTGAGE REGISTRATION', -119.70, 'FEES'),
        (date(2020, 12, 19), 'ACC-CC', 'MYER BOURKE ST', -r(420, 560, date(2020, 12, 1)), 'GIFTS'),
        (date(2021, 3, 3), 'ACC-CC', 'YOUI HOME AND CONTENTS', -1290, 'HOME-INS'),
        (date(2021, 8, 14), 'ACC-CC', 'ALLIANZ CAR INSURANCE RENEWAL', -905, 'CAR'), (date(2021, 10, 7), 'ACC-CC', 'VICROADS REGISTRATION', -845, 'CAR'),
        (date(2021, 9, 15), 'ACC-RNT', 'EBM LANDLORD INSURANCE', -1180, 'RENT-INS'),
        (date(2021, 12, 20), 'ACC-CC', 'MYER BOURKE ST', -r(450, 600, date(2021, 12, 1)), 'GIFTS'),
        (date(2022, 3, 3), 'ACC-CC', 'YOUI HOME AND CONTENTS', -1380, 'HOME-INS'),
        (date(2022, 3, 22), 'ACC-CC', 'BABY BUNTING COBURG', -r(900, 1200, date(2022, 3, 1)), 'SHOPPING'),
        (date(2022, 6, 14), 'ACC-RNT', 'GEELONG LOCKSMITHS', -265, 'RENT-REPAIR'),
        (date(2022, 8, 14), 'ACC-CC', 'ALLIANZ CAR INSURANCE RENEWAL', -948, 'CAR'), (date(2022, 9, 15), 'ACC-RNT', 'EBM LANDLORD INSURANCE', -1290, 'RENT-INS'),
        (date(2022, 10, 7), 'ACC-CC', 'VICROADS REGISTRATION', -862, 'CAR'),
        (date(2022, 11, 5), 'ACC-EVD', 'CASH DEPOSIT - SALE OF 2012 MAZDA 3', 9500, 'UNCAT'),
        (date(2022, 12, 19), 'ACC-CC', 'MYER BOURKE ST', -r(500, 650, date(2022, 12, 1)), 'GIFTS'),
        (date(2023, 3, 3), 'ACC-CC', 'YOUI HOME AND CONTENTS', -1520, 'HOME-INS'),
        (date(2023, 8, 14), 'ACC-CC', 'ALLIANZ CAR INSURANCE RENEWAL', -1065, 'CAR'), (date(2023, 9, 15), 'ACC-RNT', 'EBM LANDLORD INSURANCE', -1420, 'RENT-INS'),
        (date(2023, 10, 7), 'ACC-CC', 'VICROADS REGISTRATION', -896, 'CAR'), (date(2023, 10, 24), 'ACC-RNT', 'A1 APPLIANCE REPAIRS GEELONG', -340, 'RENT-REPAIR'),
        (date(2023, 12, 9), 'ACC-CC', 'JETSTAR AIRWAYS', -1640, 'HOLIDAYS'), (date(2024, 1, 4), 'ACC-CC', 'AIRBNB * TORQUAY', -1890, 'HOLIDAYS'),
        (date(2023, 12, 20), 'ACC-CC', 'MYER BOURKE ST', -r(560, 700, date(2023, 12, 1)), 'GIFTS'),
        (date(2024, 2, 18), 'ACC-CC', 'MYCAR SERVICE COBURG', -455, 'CAR'), (date(2024, 3, 3), 'ACC-CC', 'YOUI HOME AND CONTENTS', -1680, 'HOME-INS'),
        (date(2024, 5, 6), 'ACC-RNT', 'COASTAL PLUMBING REPAIR', -410, 'RENT-REPAIR'),
        (date(2024, 8, 14), 'ACC-CC', 'ALLIANZ CAR INSURANCE RENEWAL', -1098, 'CAR'), (date(2024, 9, 15), 'ACC-RNT', 'EBM LANDLORD INSURANCE', -1540, 'RENT-INS'),
        (date(2024, 10, 7), 'ACC-CC', 'VICROADS REGISTRATION', -918, 'CAR'),
        (date(2024, 9, 20), 'ACC-CC', 'JETSTAR AIRWAYS', -1120, 'HOLIDAYS'), (date(2024, 9, 23), 'ACC-CC', 'MANTRA GOLD COAST', -1760, 'HOLIDAYS'),
        (date(2024, 12, 19), 'ACC-CC', 'MYER BOURKE ST', -r(600, 740, date(2024, 12, 1)), 'GIFTS'),
        (date(2025, 3, 3), 'ACC-CC', 'YOUI HOME AND CONTENTS', -1760, 'HOME-INS'), (date(2025, 2, 20), 'ACC-CC', 'MYCAR SERVICE COBURG', -470, 'CAR'),
        (date(2025, 4, 12), 'ACC-CC', 'BUNNINGS COBURG', -r(200, 320, date(2025, 4, 1)), 'HOME-MAINT'),
        (date(2025, 6, 18), 'ACC-CC', 'UDEMY BUSINESS COURSE', -179, 'WORK-OTHER', 'Jordan'),
    ]
    for y in range(2019, 2025):
        E.append((date(y, 8, 4), spend_acct(date(y, 8, 4)), 'PROFESSIONAL REGISTRATION RENEWAL', -(345 + (y - 2019) * 12), 'WORK-OTHER', 'Mia'))
        E.append((date(y, 8, 22 if y % 2 else 29), 'ACC-EVD', 'ATO TAX REFUND', round(1800 + (y - 2019) * 260 + rng.uniform(-300, 300), 2), 'UNCAT', 'Jordan'))
        E.append((date(y, 9, 9), 'ACC-EVD', 'ATO TAX REFUND', round(640 + rng.uniform(-150, 250), 2), 'UNCAT', 'Mia'))
        E.append((date(y, 6, 20), 'ACC-EVD', 'AUSTRALIAN RED CROSS', -(150 if y < 2023 else 250), 'DONATION', 'Mia'))
    for e in sorted(E):
        add(*e)

    # ---- the big moves, on the offset: the rental settlement, the car, and extra loan repayments sized by the caller
    if targets.get('_settle'):
        for desc, amt, cat in RENTAL_COSTS:
            add(RENTAL_SETTLED, 'ACC-OFF', desc, -amt, cat)
    for d, amt in targets.get('_extra', []):
        add(d, 'ACC-OFF', 'HARBOUR BANK HOME LOAN EXTRA REPAYMENT', -amt, 'MORTGAGE')
    transfer(RENTAL_SETTLED, 'ACC-EVD', 'ACC-RNT', 3000, 'TRANSFER TO RENTAL ACCOUNT', 'TRANSFER FROM EVERYDAY')
    transfer(CAR_BOUGHT, 'ACC-OFF', 'ACC-EVD', 30000, 'TRANSFER TO EVERYDAY', 'TRANSFER FROM OFFSET')
    add(CAR_BOUGHT, 'ACC-EVD', 'BPAY SUBARU BRUNSWICK', -38900, 'CAR')
    transfer(date(2022, 2, 14), 'ACC-OFF', 'ACC-SAV', 2000, 'TRANSFER TO EMERGENCY SAVER', 'TRANSFER FROM OFFSET')

    # ---- month ends in date order: pay the card, keep the rental account topped up, sweep everyday to the offset
    rows.sort(key=lambda t: (t[0], t[1]))
    running = {k: OPENING_2019.get(k, 0.0) for k in OPENED}
    extra = []
    i = 0
    for m in months(START, LAST):
        end = last_day(m.year, m.month)
        while i < len(rows) and rows[i][0] <= end.isoformat():
            running[rows[i][1]] = round(running[rows[i][1]] + rows[i][3], 2)
            i += 1
        final = (end == LAST)

        def put(d, acct, desc, amt, cat):
            amt = round(amt, 2)
            extra.append((d.isoformat(), acct, desc, amt, cat, 'Joint'))
            running[acct] = round(running[acct] + amt, 2)

        if end >= OPENED['ACC-CC']:
            owing = round(-running['ACC-CC'], 2)
            if final:
                carry = round(-targets['ACC-CC'], 2)  # what the sheet opens with still owing on the card
                if owing < carry:   # June's charges fell short: one more purchase before the month ends, no payment
                    put(end - timedelta(days=2), 'ACC-CC', 'JB HI-FI MELBOURNE CENTRAL', -(carry - owing), 'SHOPPING')
                    owing = carry
                owing = round(owing - carry, 2)
            if owing > 0:
                put(end, 'ACC-EVD', 'PAYMENT TO SOUTHERN CARD', -owing, 'CC-PAY')
                put(end, 'ACC-CC', 'PAYMENT RECEIVED THANK YOU', owing, 'CC-PAY')
        if end >= OPENED['ACC-RNT']:
            if final:
                top = round(targets['ACC-RNT'] - running['ACC-RNT'], 2)
            else:
                top = round(3000 - running['ACC-RNT'], -2) if running['ACC-RNT'] < 1500 else 0
            if top > 0:
                put(end, 'ACC-EVD', 'TRANSFER TO RENTAL ACCOUNT', -top, 'TRANSFER'); put(end, 'ACC-RNT', 'TRANSFER FROM EVERYDAY', top, 'TRANSFER')
            elif top < 0:
                put(end, 'ACC-RNT', 'TRANSFER TO EVERYDAY', top, 'TRANSFER'); put(end, 'ACC-EVD', 'TRANSFER FROM RENTAL ACCOUNT', -top, 'TRANSFER')
        if final and end >= OPENED['ACC-SAV']:
            top = round(targets['ACC-SAV'] - running['ACC-SAV'], 2)
            if top > 0:
                put(end, 'ACC-EVD', 'TRANSFER TO EMERGENCY SAVER', -top, 'TRANSFER'); put(end, 'ACC-SAV', 'TRANSFER FROM EVERYDAY', top, 'TRANSFER')
            elif top < 0:
                put(end, 'ACC-SAV', 'TRANSFER TO EVERYDAY', top, 'TRANSFER'); put(end, 'ACC-EVD', 'TRANSFER FROM EMERGENCY SAVER', -top, 'TRANSFER')
        if final and end >= OPENED['ACC-HOL']:
            top = round(targets['ACC-HOL'] - running['ACC-HOL'], 2)
            if abs(top) >= 0.01:
                put(end, 'ACC-EVD', 'TRANSFER TO JAPAN 2027', -top, 'TRANSFER'); put(end, 'ACC-HOL', 'TRANSFER FROM EVERYDAY', top, 'TRANSFER')
        if final:
            sweep = round(running['ACC-EVD'] - targets['ACC-EVD'], 2)
        elif running['ACC-EVD'] > 6500:
            sweep = round(running['ACC-EVD'] - 5000, -2)
        elif running['ACC-EVD'] < 2000:
            sweep = -round(4000 - running['ACC-EVD'], -2)
        else:
            sweep = 0
        if sweep > 0:
            put(end, 'ACC-EVD', 'SWEEP TO OFFSET', -sweep, 'TRANSFER'); put(end, 'ACC-OFF', 'SWEEP FROM EVERYDAY', sweep, 'TRANSFER')
        elif sweep < 0:
            put(end, 'ACC-OFF', 'TRANSFER TO EVERYDAY', sweep, 'TRANSFER'); put(end, 'ACC-EVD', 'TRANSFER FROM OFFSET', -sweep, 'TRANSFER')
    rows += extra
    rows.sort(key=lambda t: (t[0], t[1], -t[3]))
    closing = {k: OPENING_2019.get(k, 0.0) for k in OPENED}
    for t in rows:
        closing[t[1]] = round(closing[t[1]] + t[3], 2)
    return rows, closing


def offset_path(rows):
    """The offset's balance after every row, in date order: [(date iso, balance)]."""
    bal, out = OPENING_2019['ACC-OFF'], []
    for t in rows:
        if t[1] == 'ACC-OFF':
            bal = round(bal + t[3], 2)
            out.append((t[0], bal))
    return out


def history(targets):
    """Pass one measures what the household saves into the offset. The rental's deposit and costs come out of it in
    August 2021; whatever surplus is left over by June 2025 goes into extra home-loan repayments at the dates a
    household makes them, each sized so the offset never dips below a buffer, so the offset lands exactly on the
    sheet's opening balance. Pass two writes it all."""
    rows, closing = generate({**targets, '_settle': True})
    extra_total = round(closing['ACC-OFF'] - targets['ACC-OFF'], 2)
    assert extra_total >= 0, f'the household spends more than it earns by {extra_total}; retune'
    path = offset_path(rows)
    extras, remaining = [], extra_total
    for i, d in enumerate(EXTRA_DATES):
        iso = d.isoformat()
        floor_after = min(b for dt, b in path if dt >= iso)
        room = max(0.0, floor_after - EXTRA_BUFFER)
        lump = remaining if i == len(EXTRA_DATES) - 1 else min(remaining, (room // 1000) * 1000)
        if lump <= 0:
            continue
        assert lump <= room + 0.01, f'the last lump sum {lump} does not fit in the offset (room {room})'
        extras.append((d, round(lump, 2)))
        path = [(dt, b - lump if dt >= iso else b) for dt, b in path]
        remaining = round(remaining - lump, 2)
    assert remaining < 0.01, f'{remaining} of surplus left over'
    rows, closing = generate({**targets, '_settle': True, '_extra': extras})
    for k, v in targets.items():
        if k.startswith('ACC-') and k in closing:
            assert abs(closing[k] - v) < 0.005, f'{k} lands on {closing[k]}, sheet opens at {v}'
    assert min(b for _, b in offset_path(rows)) >= 0, 'the offset went negative'
    return rows, payslips_between(START, LAST), {'settlement': sum(a for _, a, _ in RENTAL_COSTS), 'extra_repayments': extras}


def old_account_tail(first, last, balance):
    """Rows for the old Bark Bank account after the history ends, same habits, chained from its balance."""
    rng = random.Random(20250701)
    out = []
    for m in months(first, last):
        y, mo = m.year, m.month
        rows = [(date(y, mo, 1), 'MONTHLY ACCOUNT FEE', -4.0, 'FEES')]
        for _ in range(rng.choice([0, 1, 1, 2])):
            dd = rng.randint(3, 27)
            rows.append((date(y, mo, dd), f'{rng.choice(["PAYPAL *STEAM GAMES", "JB HI-FI ONLINE", "BWS COBURG", "7-ELEVEN 2021 COBURG", "OFFICEWORKS COBURG", "COLES EXPRESS COBURG"])} Card xx4471 Value Date: {dd - 1:02d}/{mo:02d}/{y}', -round(rng.uniform(8, 42), 2), 'SHOPPING'))
        for d, desc, amt, cat in rows:
            balance = round(balance + amt, 2)
        interest = round(max(balance, 0) * 0.0005 / 12, 2)
        rows.append((last_day(y, mo), 'CREDIT INTEREST', interest, 'INTEREST'))
        balance = round(balance + interest, 2)
        out += [(d.isoformat(), 'ACC-OLD', desc, amt, cat, 'Jordan') for d, desc, amt, cat in rows]
    return out, balance


def home_loan_walk(rows, months_list, closing_2025_06):
    """Back-solve the home loan from the sheet's first balance: interest on (balance less the offset at the start
    of the month) at the month's rate, less the repayments actually made. Returns {month: {...}} and the 2019 opening."""
    offset = {}
    bal = OPENING_2019['ACC-OFF']
    by_month = {}
    for t in rows:
        if t[1] == 'ACC-OFF':
            by_month.setdefault(t[0][:7], []).append(t[3])
    for m in months_list:
        offset[m] = bal  # at the start of the month
        bal = round(bal + sum(by_month.get(m, [])), 2)
    repay = {}
    for t in rows:
        if t[4] == 'MORTGAGE':  # the monthly repayment from everyday and any extra repayment from the offset
            repay[t[0][:7]] = round(repay.get(t[0][:7], 0) - t[3], 2)
    out = {}
    closing = closing_2025_06
    for m in reversed(months_list):
        d = date(int(m[:4]), int(m[5:7]), 1)
        rate = home_rate(d) / 100
        opening = round((closing + repay.get(m, 0) + offset[m] * rate / 12) / (1 + rate / 12), 2)
        interest = round(closing - opening + repay.get(m, 0), 2)
        out[m] = {'opening': opening, 'interest': interest, 'repayments': repay.get(m, 0), 'closing': closing, 'rate': round(rate * 100, 2), 'offset': offset[m], 'derived': True}
        closing = opening
    return out
