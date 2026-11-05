#!/usr/bin/env python3
"""Prove src/core plans what period-close/ plans: same inputs through both, canonical JSON compared byte for byte.

    python3 tools/period_parity.py                # everything; exit 1 on any unexplained difference
    python3 tools/period_parity.py --only scenarios,hostile,sweep,replay,fuzz
    python3 tools/period_parity.py --mutate       # break one rule at a time in a copy of src/core; each must be caught

Nothing here reaches a sheet, a connector or the network, and no Python logic changes: the fixtures of
period-close/test_import.py are reused by wrapping `subprocess.run` inside that test module, so every import_month.py and
verify.py call those tests make also runs through tools/period_parity_run.js on the same arguments. Compared after a run:
exit code, review.md, write-plan.json, rows.json, entries.json and the *.held.json files. Only three fields are set aside,
because they cannot match by design: plan generated_at, plan importer, and the seconds figure (totals and the review line).
Canonical JSON: sorted keys, UTF-8, and a float with no fraction written as an integer (JS has one number type).

Expected differences live in tools/period_parity_allowlist.json: each is a Python bug the port does not copy, with a reason. An
allowlisted case that no longer differs is itself a failure, so the list cannot go stale. An entry may name `runs` and `only`, so
that one expected difference in a test cannot hide another.
"""
import argparse
import concurrent.futures as cf
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RUNNER = ROOT / 'tools' / 'period_parity_run.js'
IMPORT = ROOT / 'period-close' / 'import_month.py'
VERIFY = ROOT / 'period-close' / 'verify.py'
ALLOW = json.loads((ROOT / 'tools' / 'period_parity_allowlist.json').read_text())['cases']
FILES = ['review.md', 'write-plan.json', 'rows.json', 'entries.json', 'rows.held.json', 'entries.held.json']
sys.path.insert(0, str(ROOT / 'period-close'))
sys.path.insert(0, str(ROOT / 'tools'))
TEMP = tempfile.TemporaryDirectory(prefix='kitty-parity-')
REAL_RUN = subprocess.run


def canon(v):
    if isinstance(v, float) and v.is_integer():
        return int(v)
    if isinstance(v, list):
        return [canon(x) for x in v]
    if isinstance(v, dict):
        return {k: canon(x) for k, x in v.items()}
    return v


def canonical(name, raw):
    """The bytes compared for one output file."""
    if name.endswith('.md'):
        return re.sub(r'(?m)^(.*\. )\d+(?:\.\d+)? s\.$', r'\1N s.', raw)
    doc = json.loads(raw)
    if name == 'write-plan.json':
        doc.pop('generated_at', None)
        doc.pop('importer', None)
        doc.get('totals', {}).pop('seconds', None)
    return json.dumps(canon(doc), sort_keys=True, ensure_ascii=False, separators=(',', ':'))


def first_diff(a, b):
    i = next((n for n, (x, y) in enumerate(zip(a, b)) if x != y), min(len(a), len(b)))
    return f'at {i}: python {a[max(0, i - 60):i + 80]!r} / js {b[max(0, i - 60):i + 80]!r}'


def compare_dirs(py, js):
    diffs = []
    for name in FILES:
        p, j = Path(py) / name, Path(js) / name
        if p.exists() != j.exists():
            diffs.append(f'{name}: python {"has" if p.exists() else "lacks"} it, js {"has" if j.exists() else "lacks"} it')
        elif p.exists():
            a, b = canonical(name, p.read_text()), canonical(name, j.read_text())
            if a != b:
                diffs.append(f'{name} {first_diff(a, b)}')
    return diffs


def allowed(name, diffs):
    """An entry covers one test, and, with `runs` and `only`, just those runs of it and those output files: a test with an
    allowlisted import still has its other runs and files compared. A case that names neither is covered whole."""
    entry = ALLOW.get(name.split('#')[0].split('.')[-1])
    if not entry:
        return False
    seq = int(name.split('#')[1]) if '#' in name else 1
    if 'runs' in entry and seq not in entry['runs']:
        return False
    return 'only' not in entry or all(d.split(' ')[0] in entry['only'] for d in diffs)


class Ledger:
    def __init__(self):
        self.cases = {}
        self.current = 'unnamed'
        self.seq = {}

    def name(self):
        self.seq[self.current] = self.seq.get(self.current, 0) + 1
        return f'{self.current}#{self.seq[self.current]}'

    def add(self, section, name, diffs, status=None):
        self.cases[name] = {'section': section, 'diffs': diffs, 'status': status}

    def verdict(self):
        """(rows of section stats, unexplained, stale)"""
        unexplained, stale, stats = [], [], {}
        for name, c in self.cases.items():
            s = stats.setdefault(c['section'], {'cases': 0, 'identical': 0, 'allowlisted': 0, 'differing': 0, 'ready': 0, 'hold': 0, 'stopped': 0, 'crash': 0})
            s['cases'] += 1
            if c['status'] in s:
                s[c['status']] += 1
            if c['diffs'] and allowed(name, c['diffs']):
                s['allowlisted'] += 1
            elif c['diffs']:
                s['differing'] += 1
                unexplained.append(name)
            else:
                s['identical'] += 1
        seen = {}
        for name, c in self.cases.items():
            k = name.split('#')[0].split('.')[-1]
            seen[k] = seen.get(k, False) or (bool(c['diffs']) and allowed(name, c['diffs']))
        stale = [k for k in ALLOW if k in seen and not seen[k]]
        return stats, unexplained, stale


L = Ledger()


def node(args):
    return REAL_RUN(['node', str(RUNNER), *args], capture_output=True, text=True)


def run_pair(section, name, py_args, out_dir, shuffle=True):
    """import_month.py already ran into out_dir, or runs here when py_args is a tuple (args,). JS runs on the same arguments."""
    js_out = Path(TEMP.name) / 'js' / re.sub(r'\W+', '_', name)
    shutil.rmtree(js_out, ignore_errors=True)
    r = REAL_RUN([sys.executable, str(IMPORT), *py_args], capture_output=True, text=True)
    j = node([*py_args, '--js-out', str(js_out)])
    return finish(section, name, r, j, out_dir, js_out, py_args, shuffle)


def finish(section, name, r, j, out_dir, js_out, py_args, shuffle):
    crash = 'Traceback' in r.stderr
    diffs = []
    if crash:
        diffs.append(f'python crashed: {r.stderr.strip().splitlines()[-1]}')
    if 'Traceback' in j.stderr or j.returncode not in (0, 1, 2) or 'Error' in j.stderr:
        diffs.append(f'js crashed: {j.stderr[-400:]}')
    else:
        if r.returncode != j.returncode and not crash:
            diffs.append(f'exit python {r.returncode}, js {j.returncode}')
        if not crash:
            diffs += compare_dirs(out_dir, js_out)
        if shuffle and not crash:
            js2 = Path(str(js_out) + '-shuffled')
            shutil.rmtree(js2, ignore_errors=True)
            s = REAL_RUN(['node', str(RUNNER), *py_args, '--js-out', str(js2), '--shuffle'], capture_output=True, text=True)
            if s.returncode != j.returncode:
                diffs.append(f'reversed input order changed the exit: {j.returncode} to {s.returncode}')
            for n in FILES:
                a, b = js_out / n, js2 / n
                if a.exists() and b.exists() and a.read_bytes() != b.read_bytes():
                    diffs.append(f'{n}: reversed input order changed the bytes')
    status = 'crash' if crash else {0: 'ready', 1: 'stopped', 2: 'hold'}.get(r.returncode)
    L.add(section, name, diffs, status)
    return diffs


# ---------- scenarios: every call the existing tests make ----------
def wrapped_run(section):
    def run(cmd, **kw):
        r = REAL_RUN(cmd, **kw)
        if len(cmd) > 1 and str(cmd[1]) == str(IMPORT):
            args = [str(c) for c in cmd[2:]]
            if '--dry-run' in args:
                out_dir = None
                args2 = [a for a in args if a != '--dry-run']
                tmp = Path(TEMP.name) / 'dry' / re.sub(r'\W+', '_', L.current)
                tmp.mkdir(parents=True, exist_ok=True)
                # a dry run writes no files, so its review goes through stdout: compare by a real run into a scratch folder
                i = args2.index('--out')
                args2[i + 1] = str(tmp)
                r2 = REAL_RUN([sys.executable, str(IMPORT), *args2], capture_output=True, text=True)
                name = L.name()
                js_out = Path(TEMP.name) / 'js' / re.sub(r'\W+', '_', name)
                finish(section, name, r2, node([*args2, '--js-out', str(js_out)]), tmp, js_out, args2, False)
                return r
            name = L.name()
            out_dir = args[args.index('--out') + 1]
            js_out = Path(TEMP.name) / 'js' / re.sub(r'\W+', '_', name)
            shutil.rmtree(js_out, ignore_errors=True)
            finish(section, name, r, node([*args, '--js-out', str(js_out)]), out_dir, js_out, args, True)
        elif len(cmd) > 1 and str(cmd[1]) == str(VERIFY):
            name = L.name()
            j = node(['verify', *[str(c) for c in cmd[2:]]])
            diffs = []
            if r.returncode != j.returncode:
                diffs.append(f'verify exit python {r.returncode}, js {j.returncode}')
            if r.stdout != j.stdout:
                diffs.append(f'verify stdout {first_diff(r.stdout, j.stdout)}')
            L.add(section, name, diffs, 'ready' if r.returncode == 0 else 'stopped')
        return r
    return run


class Result(unittest.TestResult):
    def startTest(self, test):
        L.current = test.id()
        super().startTest(test)


def load_tests_module():
    spec = importlib.util.spec_from_file_location('test_import', ROOT / 'period-close' / 'test_import.py')
    mod = importlib.util.module_from_spec(spec)
    sys.modules['test_import'] = mod
    spec.loader.exec_module(mod)
    return mod


def run_suite(section, suite):
    res = Result()
    suite.run(res)
    return res


def scenarios(ti):
    ti.subprocess.run = wrapped_run('scenarios')
    tests = [unittest.defaultTestLoader.loadTestsFromTestCase(c) for c in (ti.Dedupe, ti.FailLoud, ti.Shapes, ti.Plan, ti.Range)]
    suite = unittest.TestSuite(tests)
    n = suite.countTestCases()
    res = run_suite('scenarios', suite)
    bad = [str(t[0]) + t[1][-300:] for t in res.failures + res.errors]
    if bad:
        print('period-close tests did not pass under the wrapper:', *bad, sep='\n')
    return n, bad


def hostile(ti):
    import period_parity_hostile as H
    ti.subprocess.run = wrapped_run('hostile')
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(H.Hostile)
    n = suite.countTestCases()
    res = run_suite('hostile', suite)
    bad = [str(t[0]) + t[1][-500:] for t in res.failures + res.errors]
    if bad:
        print('hostile fixtures failed:', *bad, sep='\n')
    return n, bad


# ---------- the sweep: all 417 files, month by month, against both snapshots ----------
def source_months():
    days = sorted(p.name for acct in (ROOT / 'sources').iterdir() if acct.is_dir() for p in acct.iterdir() if p.is_dir())
    a, b = days[0][:7], days[-1][:7]
    y, m = int(a[:4]), int(a[5:7])
    m -= 1
    if m == 0:
        y, m = y - 1, 12
    out = []
    while True:
        cur = f'{y}-{m:02d}'
        out.append(cur)
        if cur >= b:
            return out
        m += 1
        if m == 13:
            y, m = y + 1, 1


def sweep_one(item):
    sheet, month, extra = item
    tag = f'sweep.{Path(sheet).stem}.{month}{"." + "-".join(extra) if extra else ""}'.replace('--', '')
    out = Path(TEMP.name) / 'sweep' / re.sub(r'\W+', '_', tag)
    args = [month, '--sheet', str(sheet), '--sources', 'sources', '--out', str(out), *extra]
    first = month.split('..')[0]
    if (ROOT / 'period-close' / first).is_dir() and '..' not in month:
        args += ['--inputs', f'period-close/{first}']
    else:
        args += ['--inputs', str(out / 'none')]
    return run_pair('sweep', tag, args, out, shuffle=first in ('2027-01', '2026-11', '2025-07'))


def sweep():
    months = source_months()
    os.chdir(ROOT)
    items = [(s, m, []) for s in ('data/snapshot-v2.json', 'data/snapshot.json') for m in months]
    items += [(s, f'{months[0]}..{months[-1]}', []) for s in ('data/snapshot-v2.json', 'data/snapshot.json')]
    items += [('data/snapshot-v2.json', '2025-07..2027-01', []), ('data/snapshot-v2.json', '2025-07..2027-01', ['--loans', 'now']), ('data/snapshot.json', '2025-07..2027-01', [])]
    with cf.ThreadPoolExecutor(8) as ex:
        list(ex.map(sweep_one, items))
    return months


# ---------- the replay: close every month from an empty ledger, applying each plan, then run it again ----------
def apply(doc, plan):
    """What a host's writes do to the sheet: every write in the plan, into the document."""
    cols = {'Entry ID': 'entry_id', 'Kind': 'kind', 'Settled at': 'settled_at', 'Account ID': 'account_id', 'Raw text': 'raw_text', 'Description': 'description', 'Amount': 'amount', 'Category ID': 'category_id', 'Person': 'person',
            'Receipt held': 'receipt_held', 'Note': 'note', 'Status': 'status', 'Created at': 'created_at', 'Transfer ID': 'transfer_id', 'Transfer account': 'transfer_account', 'Foreign amount': 'foreign_amount',
            'Foreign currency': 'foreign_currency', 'Units': 'units', 'Unit price': 'unit_price', 'Source': 'source'}
    import writeplan as W
    entry_keys = list(cols.values())
    for w in plan.get('writes', []) + plan.get('held_writes', []):
        tab, r1, c1, r2, c2 = W.parse_range(w['range'])
        vals = [[W.plain(v) for v in row] for row in w['values']]
        if w['op'] == 'append' and tab == 'Entries':
            assert r1 == len(doc['entries']) + 2, (w['range'], len(doc['entries']))
            doc['entries'] += [{cols[c]: (v if v != '' else None) for c, v in zip(w['columns'], row)} for row in vals]
        elif w['op'] == 'append' and tab == 'Payslips':
            doc['payslips'] += [dict(zip(['pay_date', 'person', 'employer', 'gross_pay', 'tax_withheld', 'super', 'net_pay'], row)) for row in vals]
        elif w['op'] == 'update' and tab == 'Entries':
            for k, v in zip(entry_keys[c1 - 1:], vals[0]):
                if v is not None:
                    doc['entries'][r1 - 2][k] = v
        elif w['op'] == 'update' and tab == 'Contracts':
            keys = list(doc['contracts'][r1 - 2].keys())
            for k, v in zip(keys[c1 - 1:], vals[0]):
                if v is not None:
                    doc['contracts'][r1 - 2][k] = v


def replay():
    os.chdir(ROOT)
    doc = json.loads((ROOT / 'data' / 'snapshot-v2.json').read_text())
    doc['entries'], doc['payslips'] = [], []
    base = Path(TEMP.name) / 'replay'
    base.mkdir()
    months = [m for m in source_months() if '2025-07' <= m <= '2027-01']
    planned, held = 0, []
    for m in months:
        for attempt in (1, 2):
            sheet = base / f'{m}-{attempt}.json'
            sheet.write_text(json.dumps(doc))
            out = base / f'{m}-{attempt}-py'
            inputs = f'period-close/{m}' if (ROOT / 'period-close' / m).is_dir() else str(base / 'none')
            args = [m, '--sheet', str(sheet), '--sources', 'sources', '--out', str(out), '--inputs', inputs]
            run_pair('replay', f'replay.{m}.run{attempt}', args, out, shuffle=False)
            plan = json.loads((out / 'write-plan.json').read_text())
            if plan['status'] == 'stopped':
                break
            if attempt == 1:
                planned += plan['totals']['transactions']
                if plan['status'] == 'hold':
                    held.append(m)
                apply(doc, plan)
            else:
                key = f'replay.{m}.second-run-plans-nothing'
                nothing = plan['status'] == 'ready' and not plan['writes'] and plan['totals']['transactions'] == 0
                L.add('replay', key, [] if nothing else [f'second run planned {plan["totals"]} ({plan["status"]})'], 'ready')
    return len(months), planned, held


# ---------- fuzz: seeded damage to good files, both importers on the same bytes ----------
def fuzz_one(item):
    import random
    seed, base = item
    rng = random.Random(seed)
    root = base / f's{seed}'
    src = root / 'sources'
    good = {'ACC-CC/2027-03-01/activity.csv': 'Date,Description,Card Member,Account #,Amount\r\n02/02/2027,MYKI TOP UP,JORDAN DAVIES,-41007,60.00\r\n02/02/2027,MYKI TOP UP,JORDAN DAVIES,-41007,60.00\r\n'
            '09/02/2027,"ALDI, COBURG",JORDAN DAVIES,-41007,"1,250.55"\r\n20/02/2027,REFUND KMART,JORDAN DAVIES,-41007,-19.95\r\n',
            'ACC-CC/2027-03-05/statement.csv': 'Date,Description,Card Member,Account #,Amount\n09/02/2027,"ALDI, COBURG",JORDAN DAVIES,-41007,"1,250.55"\n20/02/2027,REFUND KMART,JORDAN DAVIES,-41007,-19.95\n03/03/2027,COLES,JORDAN DAVIES,-41007,5.00\n',
            'ACC-EVD/2027-03-01/Data.csv': 'Bank Account,Date,Narrative,Debit Amount,Credit Amount,Balance,Categories,Serial\n033,02/02/2027,TRANSFER TO SAVER,500.00,,9500.00,,\n033,05/02/2027,HOME LOAN REPAYMENT,3000.00,,6500.00,,\n',
            'ACC-SAV/2027-03-01/Transactions.csv': 'Date,Description,Credit,Debit,Balance\n02/02/2027,TRANSFER FROM EVERYDAY,500.00,,601.00\n28/02/2027,INTEREST CREDIT,0.33,,601.33\n',
            'ACC-OLD/2027-03-02/CSVData.csv': '28/02/2027,"+0.05","CREDIT INTEREST","+996.05"\r\n03/02/2027,"-4.00","MONTHLY ACCOUNT FEE","+996.00"\r\n',
            'LN-HOME/2027-03-01/Loan.csv': 'Bank Account,Date,Narrative,Debit Amount,Credit Amount,Balance,Categories,Serial\n033,05/02/2027,REPAYMENT RECEIVED,,3100.00,-596900.00,,\n033,28/02/2027,INTEREST CHARGED,2500.00,,-599500.00,,\n',
            'RENTAL/2027-03-01/Owner.csv': 'Date,Description,Rental schedule line,Money in,Money out,Handled by\n05/02/2027,RENT FEB,Gross rent,2470.00,,PM\n',
            'payslips/2027-03-02/p.csv': 'Pay date,Person,Employer,Gross pay,Tax withheld,Super (employer),Net pay\n2027-02-18,Mia,Bayview Health,3090.00,632.00,370.80,2458.00\n'}
    alphabet = ['"', ',', '\n', '\r', ' ', '.', '-', '/', '(', ')', '$', 'A', '0', '9', 'e', '_', '\u00a0', 'É', '\t', '""', '\r\n']
    hit = set(rng.sample(sorted(good), rng.choice((1, 1, 2))))
    for rel, text in good.items():
        for _ in range(rng.choice((1, 1, 2, 3)) if rel in hit else 0):
            lo = text.find('\n') + 1 if rng.random() < 0.85 else 0  # mostly spare the header, so later stages run too
            i = rng.randrange(lo, len(text)) if lo < len(text) else 0
            op = rng.randrange(6)
            if op == 0:
                text = text[:i] + rng.choice(alphabet) + text[i:]
            elif op == 1:
                text = text[:i] + text[i + rng.randint(1, 6):]
            elif op == 2:
                text = text[:i] + rng.choice(alphabet) + text[i + 1:]
            elif op == 3:
                ls = text.splitlines(True)
                a, b = rng.randrange(len(ls)), rng.randrange(len(ls))
                ls[a], ls[b] = ls[b], ls[a]
                text = ''.join(ls)
            elif op == 4:
                ls = text.splitlines(True)
                a = rng.randrange(len(ls))
                ls.insert(rng.randrange(len(ls)), ls[a])
                text = ''.join(ls)
            else:
                text = text[:i]
            if not text:
                text = ' '
        p = src / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(text.encode())
    accounts = [dict(a) for a in sys.modules['test_import'].ACCOUNTS]
    t = sys.modules['test_import']
    doc = {'accounts': accounts, 'category_list': t.CATS, 'payslips': [], 'contracts': t.CONTRACTS, 'rules': t.RULES, 'entries': [t.entry(t.LAST)]}
    (root / 'sheet.json').write_text(json.dumps(doc))
    out = root / 'out'
    return run_pair('fuzz', f'fuzz.seed{seed}', ['2027-02', '--sheet', str(root / 'sheet.json'), '--sources', str(src), '--out', str(out)], out, shuffle=False)


def fuzz(n):
    base = Path(TEMP.name) / 'fuzz'
    base.mkdir()
    with cf.ThreadPoolExecutor(8) as ex:
        list(ex.map(fuzz_one, [(s, base) for s in range(n)]))
    return n


# ---------- the mutation check: a harness that cannot fail proves nothing ----------
MUTATIONS = [
    ('dedupe takes the sum, not the most copies', 'period-plan.js', 'runCount.set(k, Math.max(runCount.get(k) || 0, list.length))', 'runCount.set(k, (runCount.get(k) || 0) + list.length)'),
    ('half-even rounding becomes half-up', 'period-text.js', 'c = f % 2 === 0 ? f : f + 1;', 'c = f + 1;'),
    ('the opening-date guard goes', 'period-adapters.js', 'if (last && opening && w.first_day && last <= opening && last < w.first_day) opening = null;', ''),
    ('a closing gap no longer holds', 'period-plan.js', 'held = held || !ok;', ''),
    ('identity stops folding case', 'period-text.js', 'T.ident = (desc) => T.split(text(desc).toUpperCase()).join(" ");', 'T.ident = (desc) => T.split(text(desc)).join(" ");'),
    ('rules lose to history', 'period-plan.js', 'if (rule) return {', 'if (rule && !this.exact.get(desc)) return {'),
    ('transfer window narrows by a day', 'period-plan.js', 'const TRANSFER_DAYS = 4;', 'const TRANSFER_DAYS = 3;'),
    ('IDs start one too high', 'period-plan.js', 'r.id = nextId("T", sheet.lastT + i);', 'r.id = nextId("T", sheet.lastT + i + 1);'),
    ('the csv reader stops honouring a doubled quote', 'period-text.js', 'if (c === \'"\') { add(c); state = IN_QUOTED; }', 'if (c === \'"\') { state = IN_QUOTED; }'),
    ('verify accepts a one-cent difference', 'period-writeplan.js', 'W.same = (planned, actual, tolerance = 0.005)', 'W.same = (planned, actual, tolerance = 0.02)'),
    ('a deferred pair on a planned row checks it at preflight', 'period-plan.js', 'mate.isNew ? null : { range: W.a1("Entries", mrow, 1), expect: [[mate.id]] },', '{ range: W.a1("Entries", mrow, 1), expect: [[mate.id]] },'),
    ('the closing row is by position again', 'period-adapters.js', 'return first.date > last.date || (first.date === last.date && A.SHAPES[shape].sequence === "newest-first") ? first : last;', 'return A.SHAPES[shape].sequence === "newest-first" ? first : last;'),
    ('preflight runs on a held plan', 'period-writeplan.js', '    if (plan.status !== "ready") return done(false, [`plan status is ${T.repr(plan.status)}: nothing should have been written`]);\n    if (o.preconditions) {', '    if (!o.preconditions && plan.status !== "ready") return done(false, [`plan status is ${T.repr(plan.status)}: nothing should have been written`]);\n    if (o.preconditions) {'),
    ('a blank expected cell passes anything', 'period-writeplan.js', 'row.map((v) => (v === null ? "" : v))', 'row'),
    ('a fault word changes', 'period-adapters.js', 'is not a month. This shape', 'is no month. This shape'),
]


def mutate():
    results = []
    for what, file, old, new in MUTATIONS:
        d = Path(TEMP.name) / 'mutant'
        shutil.rmtree(d, ignore_errors=True)
        shutil.copytree(ROOT / 'src' / 'core', d)
        text = (d / file).read_text()
        if old not in text:
            results.append((what, 'MUTATION DID NOT APPLY', 0))
            continue
        (d / file).write_text(text.replace(old, new))
        env = dict(os.environ, KITTY_CORE=str(d))
        r = REAL_RUN([sys.executable, __file__, '--only', 'scenarios,hostile', '--quiet'], capture_output=True, text=True, env=env)  # a crash prints no sections: n stays 0, NOT CAUGHT
        n = sum(int(x) for x in re.findall(r'differing (\d+)', r.stdout)) + r.stdout.count('STALE allowlist')  # undoing a fix brings Python's answer back: its case goes stale
        results.append((what, 'caught' if r.returncode != 0 and n > 0 else 'NOT CAUGHT', n))
    return results


def main():
    p = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    p.add_argument('--only', default='scenarios,hostile,sweep,replay,fuzz')
    p.add_argument('--fuzz', type=int, default=400)
    p.add_argument('--mutate', action='store_true')
    p.add_argument('--quiet', action='store_true')
    p.add_argument('--report', default=None)
    a = p.parse_args()
    if a.mutate:
        res = mutate()
        for what, verdict, n in res:
            print(f'{verdict:12} {n:4} differing  {what}')
        ok = all(r[1] == 'caught' for r in res)
        print(f'{sum(1 for r in res if r[1] == "caught")}/{len(res)} mutations caught')
        return 0 if ok else 1
    only = a.only.split(',')
    extra, bad = {}, []
    ti = load_tests_module()
    if 'scenarios' in only:
        extra['scenario tests'], b = scenarios(ti)
        bad += b
    if 'hostile' in only:
        extra['hostile tests'], b = hostile(ti)
        bad += b
    if 'sweep' in only:
        extra['sweep months'] = len(sweep())
        extra['source files'] = sum(1 for f in (ROOT / 'sources').rglob('*') if f.is_file() and not f.name.startswith('.'))
    if 'fuzz' in only:
        extra['fuzz seeds'] = fuzz(a.fuzz)
    if 'replay' in only:
        extra['replay months'], extra['replay rows planned'], extra['replay held'] = replay()
    stats, unexplained, stale = L.verdict()
    for section, s in stats.items():
        print(f'{section}: {s["cases"]} runs, identical {s["identical"]}, allowlisted {s["allowlisted"]}, differing {s["differing"]} (python: {s["ready"]} ready, {s["hold"]} hold, {s["stopped"]} stopped, {s["crash"]} crash)')
    print(extra)
    if not a.quiet:
        for name in unexplained[:40]:
            print('DIFF', name, *L.cases[name]['diffs'][:3], sep='\n   ')
    for k in stale:
        print('STALE allowlist entry, the case no longer differs:', k)
    if a.report:
        Path(a.report).write_text(json.dumps({'stats': stats, 'extra': extra, 'unexplained': unexplained, 'stale': stale, 'cases': L.cases}, indent=1))
    return 1 if unexplained or stale or bad else 0


if __name__ == '__main__':
    sys.exit(main())
