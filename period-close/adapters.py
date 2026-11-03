"""Bank file formats the Davies household receives, and the one shape the sheet takes.

Each institution delivers transactions its own way. An adapter turns one delivered file into
normalised rows: (date 'YYYY-MM-DD', account id, description exactly as delivered, signed amount:
money in positive, money out negative). The simulator uses the same adapters in reverse to write
files the way the bank would, so the import step has the real work to do.

Institutions here are fictional; the shapes are the real Australian ones they stand in for
(kitty/src/data-sources.json): Harbour Bank writes like Westpac (debit and credit columns, running
balance), Southern Card like American Express (charges positive, payments negative, no balance),
Wattle Credit Union like ING (credit and debit columns, debits negative, dd/mm/yyyy).
"""
import csv
from datetime import date
from pathlib import Path

# Accounts tab: institution per account id
INSTITUTION = {'ACC-EVD': 'Harbour Bank', 'ACC-OFF': 'Harbour Bank', 'ACC-RNT': 'Harbour Bank',
               'ACC-CC': 'Southern Card', 'ACC-SAV': 'Wattle Credit Union', 'ACC-HOL': 'Wattle Credit Union'}
BSB = {'ACC-EVD': '033-142 812 004 771', 'ACC-OFF': '033-142 812 004 889', 'ACC-RNT': '033-142 812 005 120',
       'ACC-SAV': '813-220 44 1177 920', 'ACC-HOL': '813-220 44 1178 004'}


def dmy(s):
    y, m, d = s.split('-')
    return f'{d}/{m}/{y}'


def ymd(s):
    s = s.strip()
    if '/' in s:
        d, m, y = s.split('/')
        return f'{y}-{m.zfill(2)}-{d.zfill(2)}'
    return s


def money(v):
    s = str(v).replace('$', '').replace(',', '').strip()
    if not s:
        return 0.0
    neg = s.startswith('(') and s.endswith(')')
    n = float(s.strip('()'))
    return -n if neg else n


# ---------- Harbour Bank: Westpac shape ----------
HARBOUR_HEAD = ['Bank Account', 'Date', 'Narrative', 'Debit Amount', 'Credit Amount', 'Balance', 'Categories', 'Serial']


def write_harbour(path, account, rows, opening):
    """rows: [(date, description, amount)] in date order. Writes the running balance like the bank."""
    bal = opening
    with open(path, 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(HARBOUR_HEAD)
        for d, desc, amt in rows:
            bal = round(bal + amt, 2)
            w.writerow([BSB[account], dmy(d), desc, f'{-amt:.2f}' if amt < 0 else '', f'{amt:.2f}' if amt > 0 else '', f'{bal:.2f}', '', ''])
    return bal


def read_harbour(path, account):
    with open(path, newline='') as f:
        r = csv.DictReader(f)
        assert r.fieldnames == HARBOUR_HEAD, f'{path}: not a Harbour Bank export ({r.fieldnames})'
        return [(ymd(row['Date']), account, row['Narrative'].strip(), round(money(row['Credit Amount']) - money(row['Debit Amount']), 2)) for row in r]


# ---------- Southern Card: American Express shape ----------
SOUTHERN_HEAD = ['Date', 'Description', 'Card Member', 'Account #', 'Amount']
CARD_MEMBER = {'Jordan': 'JORDAN DAVIES', 'Mia': 'MIA DAVIES', 'Joint': 'JORDAN DAVIES'}


def write_southern(path, account, rows, opening=None):
    with open(path, 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(SOUTHERN_HEAD)
        for d, desc, amt in rows:
            # charges positive, payments and refunds negative; the card does not say who spent, the household's rules do
            w.writerow([dmy(d), desc, 'JORDAN DAVIES', '-41007', f'{-amt:.2f}'])
    return None


def read_southern(path, account):
    with open(path, newline='') as f:
        r = csv.DictReader(f)
        assert r.fieldnames == SOUTHERN_HEAD, f'{path}: not a Southern Card export ({r.fieldnames})'
        return [(ymd(row['Date']), account, row['Description'].strip(), round(-money(row['Amount']), 2)) for row in r]


# ---------- Wattle Credit Union: ING shape ----------
WATTLE_HEAD = ['Date', 'Description', 'Credit', 'Debit', 'Balance']


def write_wattle(path, account, rows, opening):
    bal = opening
    with open(path, 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(WATTLE_HEAD)
        for d, desc, amt in rows:
            bal = round(bal + amt, 2)
            w.writerow([dmy(d), desc, f'{amt:.2f}' if amt > 0 else '', f'{amt:.2f}' if amt < 0 else '', f'{bal:.2f}'])
    return bal


def read_wattle(path, account):
    with open(path, newline='') as f:
        r = csv.DictReader(f)
        assert r.fieldnames == WATTLE_HEAD, f'{path}: not a Wattle Credit Union export ({r.fieldnames})'
        return [(ymd(row['Date']), account, row['Description'].strip(), round(money(row['Credit']) + money(row['Debit']), 2)) for row in r]


FORMATS = {'Harbour Bank': (write_harbour, read_harbour, 'Harbour-Transactions-{acct}-{month}.csv'),
           'Southern Card': (write_southern, read_southern, 'activity-{month}.csv'),
           'Wattle Credit Union': (write_wattle, read_wattle, 'Transactions-{month}.csv')}


def sniff(path):
    with open(path, newline='') as f:
        head = next(csv.reader(f))
    for name, (_, read, _) in FORMATS.items():
        if head == {'Harbour Bank': HARBOUR_HEAD, 'Southern Card': SOUTHERN_HEAD, 'Wattle Credit Union': WATTLE_HEAD}[name]:
            return name, read
    raise SystemExit(f'{path}: unknown format, header {head}')


def read_sources(root, month):
    """Every file under sources/<account>/<download date>/ whose rows fall in the month. Account from the folder."""
    out = []
    for acct_dir in sorted(Path(root).iterdir()):
        if not acct_dir.is_dir() or acct_dir.name not in INSTITUTION:
            continue
        for day_dir in sorted(acct_dir.iterdir()):
            for f in sorted(day_dir.glob('*.csv')):
                name, read = sniff(f)
                expected = INSTITUTION[acct_dir.name]
                assert name == expected, f'{f}: a {name} file in the {acct_dir.name} folder ({expected})'
                rows = [r for r in read(f, acct_dir.name) if r[0][:7] == month]
                out.append((f.relative_to(root).as_posix(), rows))
    return out
