"""The files a household receives, and the one shape the sheet takes.

Each institution delivers transactions its own way. An adapter turns one delivered file into normalised rows:
(date 'YYYY-MM-DD', account id, description exactly as delivered, signed amount: money in positive, money out
negative). The simulator uses the same adapters in reverse to write files the way the bank would, so the import
step has the real work to do, and the portals (portals/lib/shapes.js) write byte-for-byte the same bytes.

Institutions here are fictional; the shapes are the real Australian ones they stand in for (src/data-sources.json):
Harbour Bank writes like Westpac (debit and credit columns, running balance), Southern Card like American Express
(charges positive, payments negative, no balance), Wattle Credit Union like ING (credit and debit columns, debits
negative, dd/mm/yyyy), Bark Bank like CommBank (no header row: Date, Amount, Description, Balance; newest first;
signed amounts). Three more shapes come from the other portals: a lender's loan statement (the Westpac columns on a
loan account), a property manager's owner statement, and an employer's payslip export (the sheet's own Payslips
columns). Insurance renewals arrive as PDFs; `read_policy_pdf` reads the portal's pdf-lib output through pdftext.py.

Every reader fails loud. `ImportFault` names the file, the row and what a person should do; the importer turns it
into a non-zero exit and a review item, never a silent skip. Each shape declares its date order (`DATE_ORDER`: every
Australian shape is day first), so 13/02/2027 is 13 February and 02/13/2027 stops the run; a day that does not exist
stops it too, and a row dated after the day it was downloaded is a misread date or a file from the future, either
way a stop.
"""
import csv
import io
import re
from datetime import date
from pathlib import Path

# Accounts tab: institution per account id (the default; the importer reads the sheet's Accounts tab when it has one)
INSTITUTION = {'ACC-EVD': 'Harbour Bank', 'ACC-OFF': 'Harbour Bank', 'ACC-RNT': 'Harbour Bank',
               'ACC-CC': 'Southern Card', 'ACC-SAV': 'Wattle Credit Union', 'ACC-HOL': 'Wattle Credit Union'}
BSB = {'ACC-EVD': '033-142 812 004 771', 'ACC-OFF': '033-142 812 004 889', 'ACC-RNT': '033-142 812 005 120',
       'ACC-SAV': '813-220 44 1177 920', 'ACC-HOL': '813-220 44 1178 004'}
LOAN_NUMBERS = {'LN-HOME': '033-142 812 006 310', 'LN-INV': '033-142 812 006 328'}

ORDER_WORDS = {'dmy': 'day first (dd/mm/yyyy)', 'mdy': 'month first (mm/dd/yyyy)', 'ymd': 'year first (yyyy-mm-dd)'}


class ImportFault(Exception):
    """A file the importer refuses to guess about. file: path as shown to the person; row: 1-based line in the file
    (None when the fault is the whole file); what: one line on the fault; do: one line on what to do."""

    def __init__(self, file, what, do, row=None):
        super().__init__(f'{file}' + (f' row {row}' if row else '') + f': {what}')
        self.file, self.row, self.what, self.do = str(file), row, what, do

    def md(self):
        where = f'`{self.file}`' + (f', row {self.row}' if self.row else '')
        return f'- {where}: {self.what}\n  What to do: {self.do}'


def dmy(s):
    y, m, d = s.split('-')
    return f'{d}/{m}/{y}'


def parse_date(s, order='dmy', file=None, row=None):
    """A delivered date to 'YYYY-MM-DD', in the order the shape declares. Raises ImportFault for anything else:
    a month of 13, a 30th of February, a two-digit year, a blank."""
    raw = str(s).strip()
    m = re.fullmatch(r'(\d{1,4})[/\-.](\d{1,2})[/\-.](\d{1,4})', raw)
    if not m:
        raise ImportFault(file, f'"{raw}" is not a date', 'the column is not what the adapter expects; check the header and the shape', row)
    a, b, c = m.groups()
    if len(a) == 4:
        y, mo, d = a, b, c
        read_as = 'ymd'
    else:
        read_as = order
        if order == 'mdy':
            mo, d, y = a, b, c
        else:
            d, mo, y = a, b, c
    if len(y) != 4:
        raise ImportFault(file, f'"{raw}" has a two-digit year', 'export with four-digit years, or extend the adapter if the institution never does', row)
    y, mo, d = int(y), int(mo), int(d)
    if not 1 <= mo <= 12:
        raise ImportFault(file, f'"{raw}": {mo} is not a month. This shape is read {ORDER_WORDS[read_as]}',
                          'if the institution now writes month first, change its DATE_ORDER in adapters.py and say so in data-sources.json; never edit the file', row)
    try:
        return date(y, mo, d).isoformat()
    except ValueError:
        raise ImportFault(file, f'"{raw}": no such day', 'the date is corrupt or read in the wrong order; check the shape', row)


def ymd(s):
    """Lenient day-first parse kept for the simulator and the portals' data builder; the importer uses parse_date."""
    s = s.strip()
    if '/' in s:
        d, m, y = s.split('/')
        return f'{y}-{m.zfill(2)}-{d.zfill(2)}'
    return s


def money(v, file=None, row=None):
    s = str(v).replace('$', '').replace(',', '').replace('A', '').strip()
    if not s:
        return 0.0
    neg = s.startswith('(') and s.endswith(')')
    try:
        n = float(s.strip('()'))
    except ValueError:
        raise ImportFault(file, f'"{v}" is not an amount', 'the column is not what the adapter expects; check the header and the shape', row)
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
            w.writerow([BSB.get(account, LOAN_NUMBERS.get(account, '')), dmy(d), desc, f'{-amt:.2f}' if amt < 0 else '', f'{amt:.2f}' if amt > 0 else '', f'{bal:.2f}', '', ''])
    return bal


def read_harbour(path, account):
    return [(r['date'], account, r['description'], r['amount']) for r in read_rows(path, 'Harbour Bank')]


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
    return [(r['date'], account, r['description'], r['amount']) for r in read_rows(path, 'Southern Card')]


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
    return [(r['date'], account, r['description'], r['amount']) for r in read_rows(path, 'Wattle Credit Union')]


# ---------- Bark Bank: CommBank shape ----------
# No header row. Date, Amount, Description, Balance; newest first; amounts carry an explicit sign and
# thousands separators ("+2,470.00"); every field after the date is quoted.
BARK_HEAD = None
BARK_DATE = re.compile(r'\d{1,2}/\d{1,2}/\d{4}')


def signed(n):
    return f'{"+" if n >= 0 else "-"}{abs(n):,.2f}'


def write_bark(path, account, rows, opening):
    bal = opening
    lines = []
    for d, desc, amt in rows:
        bal = round(bal + amt, 2)
        lines.append(f'{dmy(d)},"{signed(amt)}","{desc.replace(chr(34), chr(34) * 2)}","{signed(bal)}"')
    with open(path, 'w', newline='') as f:
        f.write(''.join(line + '\r\n' for line in reversed(lines)))
    return bal


def read_bark(path, account):
    return [(r['date'], account, r['description'], r['amount']) for r in read_rows(path, 'Bark Bank')]


# ---------- the other portals' shapes ----------
# A lender's statement in the Westpac columns on a loan account: interest debited, repayments credited, the balance
# owing shown negative. Same header as Harbour Bank; the Accounts tab's type (Loan) says which it is.
OWNER_HEAD = ['Date', 'Description', 'Rental schedule line', 'Money in', 'Money out', 'Handled by']
PAYSLIP_HEAD = ['Pay date', 'Person', 'Employer', 'Gross pay', 'Tax withheld', 'Super (employer)', 'Net pay']

# shape name -> (header or None for headerless, date order, sequence the rows come in, prints a running balance)
SHAPES = {
    'Harbour Bank': (HARBOUR_HEAD, 'dmy', 'oldest-first', True),
    'Southern Card': (SOUTHERN_HEAD, 'dmy', 'oldest-first', False),
    'Wattle Credit Union': (WATTLE_HEAD, 'dmy', 'oldest-first', True),
    'Bark Bank': (BARK_HEAD, 'dmy', 'newest-first', True),
    'Owner statement': (OWNER_HEAD, 'dmy', 'oldest-first', False),
    'Payslips': (PAYSLIP_HEAD, 'ymd', 'oldest-first', False),
}
DATE_ORDER = {k: v[1] for k, v in SHAPES.items()}
FORMATS = {'Harbour Bank': (write_harbour, read_harbour, 'Harbour-Transactions-{acct}-{month}.csv'),
           'Southern Card': (write_southern, read_southern, 'activity-{month}.csv'),
           'Wattle Credit Union': (write_wattle, read_wattle, 'Transactions-{month}.csv'),
           'Bark Bank': (write_bark, read_bark, 'CSVData-{month}.csv')}
HEADS = {'Harbour Bank': HARBOUR_HEAD, 'Southern Card': SOUTHERN_HEAD, 'Wattle Credit Union': WATTLE_HEAD}
BANK_SHAPES = tuple(FORMATS)


def read_text(path):
    """The file as text, and whether it carried a UTF-8 byte order mark (accepted, noted). Faults: zero bytes, not UTF-8."""
    data = Path(path).read_bytes()
    if not data.strip():
        raise ImportFault(path, 'empty file (zero bytes)',
                          'download it again. A dormant account still exports its header row; the CommBank shape has none, so if this account truly had no movement, delete the file and say so in the close note')
    bom = data.startswith(b'\xef\xbb\xbf')
    try:
        return data.decode('utf-8-sig'), bom
    except UnicodeDecodeError:
        raise ImportFault(path, 'not UTF-8 text', 'this is a binary or UTF-16 file; export as CSV (UTF-8), do not convert it by hand')


def cells(text):
    return [r for r in csv.reader(io.StringIO(text, newline=''))]


def sniff(path):
    """(shape name, reader) from the first line. Raises ImportFault when no shape matches."""
    text, _ = read_text(path)
    rows = cells(text)
    head = [h.strip() for h in rows[0]] if rows else []
    for name, (expected, *_rest) in SHAPES.items():
        if expected is not None and head == expected:
            read = FORMATS[name][1] if name in FORMATS else None
            return name, read
    if len(head) == 4 and BARK_DATE.fullmatch(head[0]):
        return 'Bark Bank', read_bark
    near = [(name, expected) for name, (expected, *_r) in SHAPES.items() if expected and len(set(head) & set(expected)) >= max(2, len(expected) // 2)]
    if near:
        name, expected = near[0]
        missing = [h for h in expected if h not in head]
        extra = [h for h in head if h not in expected]
        raise ImportFault(path, f'header mismatch: looks like {name} but {"misses " + str(missing) if missing else ""}{" and " if missing and extra else ""}{"adds " + str(extra) if extra else ""}; got {head}',
                          f'the institution changed its export. Update the {name} shape in adapters.py (and data-sources.json) in the same change as this import; never edit the file')
    raise ImportFault(path, f'unrecognised shape, first line {head[:8]}', 'no adapter reads this file. Add one to adapters.py or export in a format the importer knows (see data-sources.json)')


def read_rows(path, shape, download_day=None, opening_date=None, as_of=None):
    """Every row of a delivered file as a dict: date, description, amount, balance (None when the shape prints none),
    line (1-based). Checks the header, the date order, the sequence, the window; faults instead of guessing.
    download_day / as_of: no row may be dated after them. opening_date: no row may be dated before it."""
    text, bom = read_text(path)
    rows = cells(text)
    expected, order, sequence, has_balance = SHAPES[shape]
    if expected is not None:
        head = [h.strip() for h in rows[0]] if rows else []
        if head != expected:
            raise ImportFault(path, f'header mismatch for {shape}: got {head}, expected {expected}',
                              'the institution changed its export, or this file is another shape; update the adapter in the same change as the import, never the file')
        body, first_line = rows[1:], 2
    else:
        body, first_line = rows, 1
    out = []
    for i, r in enumerate(body):
        line = first_line + i
        if not r or not any(c.strip() for c in r):
            continue
        if shape == 'Harbour Bank':
            if len(r) != 8:
                raise ImportFault(path, f'{len(r)} columns, expected 8', 'a comma inside an unquoted narrative, or a truncated download; download again', line)
            d = parse_date(r[1], order, path, line)
            out.append({'date': d, 'description': r[2].strip(), 'amount': round(money(r[4], path, line) - money(r[3], path, line), 2), 'balance': money(r[5], path, line), 'line': line, 'account_number': r[0].strip()})
        elif shape == 'Southern Card':
            if len(r) != 5:
                raise ImportFault(path, f'{len(r)} columns, expected 5', 'a truncated or hand-edited download; download again', line)
            out.append({'date': parse_date(r[0], order, path, line), 'description': r[1].strip(), 'amount': round(-money(r[4], path, line), 2), 'balance': None, 'line': line})
        elif shape == 'Wattle Credit Union':
            if len(r) != 5:
                raise ImportFault(path, f'{len(r)} columns, expected 5', 'a truncated or hand-edited download; download again', line)
            out.append({'date': parse_date(r[0], order, path, line), 'description': r[1].strip(), 'amount': round(money(r[2], path, line) + money(r[3], path, line), 2), 'balance': money(r[4], path, line), 'line': line})
        elif shape == 'Bark Bank':
            if len(r) != 4 or not BARK_DATE.fullmatch(r[0].strip()):
                raise ImportFault(path, f'not a CommBank line: {r[:4]}', 'the headerless shape is Date, Amount, Description, Balance; download again', line)
            out.append({'date': parse_date(r[0], order, path, line), 'description': r[2].strip(), 'amount': round(money(r[1], path, line), 2), 'balance': money(r[3], path, line), 'line': line})
        elif shape == 'Owner statement':
            if len(r) != 6:
                raise ImportFault(path, f'{len(r)} columns, expected 6', 'a truncated download; download again', line)
            amt = round(money(r[3], path, line) - money(r[4], path, line), 2)
            out.append({'date': parse_date(r[0], order, path, line), 'description': r[1].strip(), 'amount': amt, 'balance': None, 'line': line,
                        'schedule_line': r[2].strip(), 'handled_by': r[5].strip()})
        elif shape == 'Payslips':
            if len(r) != 7:
                raise ImportFault(path, f'{len(r)} columns, expected 7', 'a truncated download; download again', line)
            out.append({'date': parse_date(r[0], order, path, line), 'person': r[1].strip(), 'employer': r[2].strip(), 'gross': round(money(r[3], path, line), 2),
                        'tax': round(money(r[4], path, line), 2), 'super': round(money(r[5], path, line), 2), 'net': round(money(r[6], path, line), 2),
                        'description': f'{r[1].strip()} {r[2].strip()}', 'amount': round(money(r[6], path, line), 2), 'balance': None, 'line': line})
    check_window(path, out, download_day, opening_date, as_of)
    check_sequence(path, out, sequence)
    return out


def check_window(path, rows, download_day=None, opening_date=None, as_of=None):
    for r in rows:
        y = int(r['date'][:4])
        if y < 2000 or y > 2100:
            raise ImportFault(path, f'{r["date"]} is outside any plausible window', 'a misread date; check the shape', r['line'])
        if download_day and r['date'] > download_day:
            raise ImportFault(path, f'row dated {r["date"]} in a file downloaded on {download_day}',
                              'a file cannot hold a row from after the day it was downloaded: either the folder is misnamed (it must be the download date, yyyy-mm-dd) or the dates are read in the wrong order (month first). Fix the folder name or the adapter; never edit the file', r['line'])
        if as_of and r['date'] > as_of:
            raise ImportFault(path, f'row dated {r["date"]}, after the as-of date {as_of}', 'the as-of date is the last day the ledger covers; close the later month separately, or move --as-of', r['line'])
        if opening_date and r['date'] < opening_date:
            raise ImportFault(path, f'row dated {r["date"]}, before the account opened on {opening_date}',
                              'either the Accounts tab opening date is wrong or this file belongs to another account; a row before the opening anchor would break the balance', r['line'])


def check_sequence(path, rows, sequence):
    """Rows must run one way (either way is accepted, the shape says which is usual); a zigzag is what month-first dates look like."""
    dates = [r['date'] for r in rows]
    if len(dates) < 3:
        return
    asc = all(a <= b for a, b in zip(dates, dates[1:]))
    desc = all(a >= b for a, b in zip(dates, dates[1:]))
    if not (asc or desc):
        up = dates[0] <= dates[1]
        bad = next(i for i, (a, b) in enumerate(zip(dates, dates[1:])) if ((a > b) if up else (a < b)))
        raise ImportFault(path, f'dates run out of order (row {rows[bad]["line"]} is {dates[bad]}, the next is {dates[bad + 1]}); this shape is {sequence}',
                          'a month-first file reads like this when days pass 12, and a hand-sorted file does too. Check the institution\'s date order in adapters.py; never edit the file', rows[bad + 1]['line'])


def balances(path, name):
    """(date, running balance) for each row, oldest first. Empty for a format that prints no balance."""
    rows = read_rows(path, name)
    if not SHAPES[name][3]:
        return []
    out = [(r['date'], r['balance']) for r in rows]
    return list(reversed(out)) if SHAPES[name][2] == 'newest-first' else out


def read_sources(root, month, institutions=None):
    """Every bank file under sources/<account>/<download date>/ whose rows fall in the month, as (path, rows, closing).
    Account from the folder. closing is the file's last (date, balance) in the month, or None when it has none.
    institutions: account id -> institution name; the sheet's Accounts tab when the caller has it, else INSTITUTION.
    Kept for the simulator and the portals' data builder; the importer walks sources itself (import_month.gather)."""
    institutions = institutions or INSTITUTION
    out = []
    for acct_dir in sorted(Path(root).iterdir()):
        if not acct_dir.is_dir() or acct_dir.name not in institutions:
            continue
        for day_dir in sorted(acct_dir.iterdir()):
            if not day_dir.is_dir():
                continue
            for f in sorted(day_dir.glob('*.csv')):
                name, read = sniff(f)
                expected = institutions[acct_dir.name]
                if name != expected:
                    raise ImportFault(f, f'a {name} file in the {acct_dir.name} folder ({expected})', 'the file is in the wrong account folder, or the Accounts tab names the wrong institution')
                rows = [r for r in read(f, acct_dir.name) if r[0][:7] == month]
                closing = [b for b in balances(f, name) if b[0][:7] == month]
                out.append((f.relative_to(root).as_posix(), rows, closing[-1] if closing else None))
    return out


# ---------- insurance documents: the portal's PDFs through pdftext ----------
MONTHS3 = {m: i for i, m in enumerate(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], 1)}
LONG_DATE = re.compile(r'(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4})')


def long_date(s):
    m = LONG_DATE.search(s or '')
    return date(int(m.group(3)), MONTHS3[m.group(2)], int(m.group(1))).isoformat() if m else None


def read_policy_pdf(path):
    """A renewal notice or certificate of currency from the insurer portal, as a dict: doc ('renewal' or 'certificate'),
    policy_number, policy (name), property (RENTAL, HOME: from the policy number), period_from, period_to, premium, due,
    cover [(what, value)]. Raises ImportFault with "this PDF needs a person" when the text does not carry those fields."""
    import pdftext
    try:
        lines = pdftext.text(path)
    except ValueError as e:
        raise ImportFault(path, str(e).split(': ', 1)[-1], 'this PDF needs a person: read the premium, the period and the cover from it and update the Contracts row by hand')
    texts = [cells_ for _, _, cells_ in lines]
    flat = ['  '.join(c) for c in texts]
    if not flat:
        raise ImportFault(path, 'no text could be read from this PDF', 'this PDF needs a person: pdftext.py reads only simple text PDFs (standard fonts, Flate streams); read the premium, period and cover from it and update the Contracts row by hand')
    joined = '\n'.join(flat)
    doc = 'renewal' if re.search(r'renewal', joined, re.I) else 'certificate' if re.search(r'certificate of currency', joined, re.I) else None
    out = {'doc': doc, 'policy_number': None, 'policy': None, 'property': None, 'period_from': None, 'period_to': None, 'premium': None, 'due': None, 'status': None, 'cover': []}
    # label rows are followed by value rows with the same number of cells (the portal's kv layout)
    for i, row in enumerate(texts[:-1]):
        nxt = texts[i + 1]
        if len(row) == len(nxt) and all(re.fullmatch(r'[A-Za-z ,/()]+', c.strip()) for c in row):
            for label, value in zip(row, nxt):
                k = label.strip().lower()
                if k == 'policy number':
                    out['policy_number'] = value.strip()
                elif k == 'policy':
                    out['policy'] = value.strip()
                elif k == 'period of insurance':
                    ds = LONG_DATE.findall(value)
                    if len(ds) == 2 or ('to' in value and len(ds) >= 1):
                        out['period_from'] = long_date(value)
                        out['period_to'] = long_date(value.split(' to ', 1)[1]) if ' to ' in value else None
                elif k in ('total premium', 'premium paid', 'premium'):
                    out['premium'] = money(re.sub(r'[^\d.,()-]', '', value))
                elif k == 'payment due':
                    out['due'] = long_date(value)
                elif k == 'status':
                    out['status'] = value.strip()
                elif k == 'sum insured or limit':
                    pass
        if len(row) == 2 and row[0].strip().lower() == 'cover' and row[1].strip().lower().startswith('sum insured'):
            for r in texts[i + 1:]:
                if len(r) != 2:
                    break
                out['cover'].append((r[0].strip(), r[1].strip()))
    # the one-line period and the heading carry what the kv table may have truncated
    for s in flat:
        m = re.search(r'Policy period (\d{1,2} \w{3} \d{4}) to (\d{1,2} \w{3} \d{4})', s)
        if m:
            out['period_from'], out['period_to'] = long_date(m.group(1)), long_date(m.group(2))
    if not out['policy']:
        head = next((s for s in flat if re.search(r'insurance', s, re.I) and len(s) < 60), None)
        if head:
            out['policy'] = re.sub(r'\s+renewal$', '', head.strip(), flags=re.I)
    if out['policy_number']:
        m = re.match(r'PS-([A-Z]+)-\d{4}', out['policy_number'])
        out['property'] = m.group(1) if m else None
    missing = [k for k in ('doc', 'policy_number', 'period_from', 'period_to', 'premium') if not out[k]]
    if missing:
        raise ImportFault(path, f'this PDF needs a person: could not read {", ".join(missing)} from its text',
                          'read the premium, the period and the cover from the document and update the Contracts row by hand; then note in data-sources.json that this insurer\'s PDF is not machine-readable')
    return out
