"""The write plan: exact ranges and values for the Sheets connector, and the comparisons verify.py makes.

A plan is JSON (`write-plan.json`, schema `kitty-write-plan/1`):

    sheet          id, name, version (1 for a 1.1 sheet, 2 for the ledger), the snapshot it was planned from
    assumes        what the plan believes about the sheet now: row counts and last IDs per tab
    preconditions  ranges to read before writing, with the values they must hold (the last known row, then a blank)
    writes         in order: {id, tab, op (append or update), range, rows, columns, values, precondition?, note?}
    deferred       writes of the same shape that a person or a later phase decides on, each with `why`
    verify         how to check: re-read every write's range and run verify.py

Values are what `update_values` takes (strings, numbers, "" for a blank, null to leave a cell alone in an update).
The connector writes as a person types (USER_ENTERED), so a yyyy-mm-dd string becomes a date cell like the ones
above it, and a string that starts with = + - or @ is prefixed with an apostrophe so it stays text. Appends run in
chunks of at most CHUNK rows. Nothing here talks to a sheet.
"""
import datetime as dt
import re

SCHEMA = 'kitty-write-plan/1'
CHUNK = 500
EPOCH = dt.date(1899, 12, 30)


def col(n):
    """1 -> A, 26 -> Z, 27 -> AA."""
    s = ''
    while n:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


def col_index(letters):
    n = 0
    for ch in letters.upper():
        n = n * 26 + ord(ch) - 64
    return n


def quote_tab(tab):
    return f"'{tab}'" if re.search(r'[^A-Za-z0-9_]', tab) else tab


def a1(tab, r1, c1, r2=None, c2=None):
    cell = f'{col(c1)}{r1}'
    if r2 is not None:
        cell += f':{col(c2)}{r2}'
    return f'{quote_tab(tab)}!{cell}'


def parse_range(rng):
    """'Entries!A1084:T1583' -> ('Entries', 1084, 1, 1583, 20). A single cell gives r2 == r1, c2 == c1."""
    m = re.fullmatch(r"(?:'([^']+)'|([^!]+))!([A-Za-z]+)(\d+)(?::([A-Za-z]+)(\d+))?", rng.strip())
    if not m:
        raise ValueError(f'not an A1 range: {rng}')
    tab = m.group(1) or m.group(2)
    r1, c1 = int(m.group(4)), col_index(m.group(3))
    r2, c2 = (int(m.group(6)), col_index(m.group(5))) if m.group(5) else (r1, c1)
    return tab, r1, c1, r2, c2


def range_key(rng):
    tab, r1, c1, r2, c2 = parse_range(rng)
    return f'{tab}!{col(c1)}{r1}:{col(c2)}{r2}'


def escape(v):
    """USER_ENTERED consumes one protecting apostrophe, including before a literal source apostrophe."""
    if isinstance(v, str) and v.startswith(('=', '+', '-', '@', "'")):
        return "'" + v
    return v


def append_writes(prefix, tab, columns, rows, first_row, note=None, chunk=CHUNK):
    """Append `rows` (lists, one per sheet row) to `tab` from `first_row`, in chunks. Returns the write dicts."""
    out = []
    for i in range(0, len(rows), chunk):
        part = rows[i:i + chunk]
        r1 = first_row + i
        r2 = r1 + len(part) - 1
        w = {'id': f'{prefix}-{len(out) + 1}', 'tab': tab, 'op': 'append', 'range': a1(tab, r1, 1, r2, len(columns)), 'rows': len(part),
             'columns': columns, 'values': [[escape(v) for v in r] for r in part]}
        if note:
            w['note'] = note
        out.append(w)
    return out


def update_write(wid, tab, row, first_col, values, precondition=None, note=None):
    """Change cells on one existing row: values is one list from first_col (1-based); null leaves a cell alone."""
    w = {'id': wid, 'tab': tab, 'op': 'update', 'range': a1(tab, row, first_col, row, first_col + len(values) - 1), 'rows': 1,
         'values': [[escape(v) for v in values]]}
    if precondition:
        w['precondition'] = precondition
    if note:
        w['note'] = note
    return w


def precondition(tab, last_row, last_value, col_=1):
    """The last row we know of must still hold its value, and the row after it must be blank."""
    if last_row is None or last_row < 2:
        return {'range': a1(tab, 2, col_), 'expect': [], 'why': f'{tab} should hold no data rows yet'}
    return {'range': a1(tab, last_row, col_, last_row + 1, col_), 'expect': [[last_value], []],
            'why': f'the last {tab} row we planned from, then the first empty row; a different value means the sheet moved since the snapshot: re-run the importer'}


# ---------- comparing a re-read with the plan ----------
def _date_forms(s):
    """Every way a yyyy-mm-dd date comes back from a read: the ISO string, a serial, d/m/yyyy, dd/mm/yyyy, m/d/yyyy."""
    try:
        d = dt.date.fromisoformat(s)
    except (ValueError, TypeError):
        return set()
    serial = (d - EPOCH).days
    return {s, str(serial), f'{d.day}/{d.month}/{d.year}', f'{d.day:02d}/{d.month:02d}/{d.year}', f'{d.month}/{d.day}/{d.year}', f'{d.month:02d}/{d.day:02d}/{d.year}',
            f'{d.year}-{d.month:02d}-{d.day:02d}', d.strftime('%d %b %Y'), d.strftime('%-d %b %Y') if hasattr(d, 'strftime') else s}


def plain(v):
    """A planned value as the person would read it back: the escaping apostrophe removed."""
    if isinstance(v, str) and v.startswith("'") and len(v) > 1 and v[1] in "=+-@'":
        return v[1:]
    return v


def same(planned, actual, tolerance=0.005):
    """Does a cell read back as planned? Blanks match '' and missing; numbers within tolerance (numeric strings
    count); a planned date matches any form a read returns; text matches after stripping."""
    p = plain(planned)
    if p is None:
        return True  # null in an update means "leave alone"
    a = '' if actual is None else actual
    if p == '':
        return a == '' or (isinstance(a, str) and a.strip() == '')
    if isinstance(p, bool) or isinstance(a, bool):
        return str(p).upper() == str(a).upper()
    if isinstance(p, (int, float)):
        try:
            return abs(float(p) - float(str(a).replace(',', ''))) <= tolerance
        except ValueError:
            return False
    ps = str(p).strip()
    if isinstance(a, (int, float)) and not isinstance(a, bool):
        if re.fullmatch(r'\d{4}-\d{2}-\d{2}', ps):
            return str(int(a)) in _date_forms(ps) if float(a).is_integer() else False
        try:
            return abs(float(ps.replace(',', '')) - float(a)) <= tolerance
        except ValueError:
            return False
    as_ = str(a).strip()
    if ps == as_:
        return True
    if re.fullmatch(r'\d{4}-\d{2}-\d{2}', ps):
        return as_ in _date_forms(ps)
    return False


def compare(planned_values, actual_values, tolerance=0.005):
    """First mismatch as (row offset, column offset, planned, actual), or None. Trailing blank cells and rows the
    API trimmed count as blanks."""
    for i, prow in enumerate(planned_values):
        arow = actual_values[i] if i < len(actual_values) else []
        for j, pv in enumerate(prow):
            av = arow[j] if j < len(arow) else ''
            if not same(pv, av, tolerance):
                return i, j, pv, av
        if len(arow) > len(prow) and any(str(x).strip() for x in arow[len(prow):]):
            return i, len(prow), '', arow[len(prow)]
    if len(actual_values) > len(planned_values):
        for i in range(len(planned_values), len(actual_values)):
            if any(str(x).strip() for x in actual_values[i]):
                return i, 0, '', actual_values[i][0]
    return None


def summary(plan):
    """Lines for review.md: each write's range and size, then the deferred ones."""
    out = []
    for w in plan.get('writes', []):
        out.append(f'- `{w["range"]}`: {w["rows"]} row{"s" if w["rows"] != 1 else ""} ({w["op"]}, {w["tab"]})' + (f', {w["note"]}' if w.get('note') else ''))
    if not out:
        out.append('- nothing to write')
    if plan.get('deferred'):
        out.append('')
        out.append('Deferred (not written until a person or a later phase says so):')
        for w in plan['deferred']:
            out.append(f'- `{w["range"]}`: {w["rows"]} row{"s" if w["rows"] != 1 else ""} ({w["op"]}, {w["tab"]}). {w.get("why", "")}'.rstrip())
    return out
