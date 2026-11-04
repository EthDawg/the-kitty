"""Compare a saved re-read of the sheet with the write plan, cell by cell.

    python3 period-close/verify.py period-close/2027-02/write-plan.json reread.json
    python3 period-close/verify.py write-plan.json preflight.json --preconditions     # before writing

reread.json holds what the Sheets connector's get_values returned for every range in the plan: one response
object ({"range": ..., "values": [[...]]}), a list of them, or a map {"Entries!A1084:T1583": [[...]], ...}. Ranges are
matched after normalising the A1 notation. Every planned cell must read back as planned: numbers within half a cent,
a planned yyyy-mm-dd date in any form a read returns (the ISO string, a serial, d/m/yyyy), blanks as blanks or
missing (the API trims trailing empties), text exactly. A null in an update means "left alone" and is not checked.
Exit 0 when every range agrees, 1 when any does not or is missing, and the report names the first differing cell
of each range. With --preconditions the plan's preconditions are checked instead (run it over the preflight read
before step two). --include-deferred also checks the deferred writes, once they were written.
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import writeplan as W  # noqa: E402


def load_reread(path):
    doc = json.loads(Path(path).read_text())
    out = {}
    if isinstance(doc, dict) and 'range' in doc and 'values' in doc:
        doc = [doc]
    if isinstance(doc, list):
        for item in doc:
            if not isinstance(item, dict) or 'range' not in item:
                raise SystemExit(f'{path}: each item needs "range" and "values" (what get_values returns)')
            out[W.range_key(item['range'])] = item.get('values') or []
    elif isinstance(doc, dict):
        for k, v in doc.items():
            out[W.range_key(k)] = v or []
    else:
        raise SystemExit(f'{path}: not a re-read (a get_values response, a list of them, or a map of range to values)')
    return out


def check(ranges, reread, label):
    ok_all = True
    for rng, expected, note in ranges:
        key = W.range_key(rng)
        actual = reread.get(key)
        if actual is None:
            # a single-cell read of a blank cell may come back with no "values" at all; the caller passes [] for that
            print(f'MISSING  {rng}: no re-read saved for this range' + (f' ({note})' if note else ''))
            ok_all = False
            continue
        diff = W.compare(expected, actual)
        if diff is None:
            print(f'OK       {rng}: {len(expected)} row{"s" if len(expected) != 1 else ""} agree' + (f' ({note})' if note else ''))
        else:
            i, j, pv, av = diff
            _, r1, c1, _, _ = W.parse_range(rng)
            cell = f'{W.col(c1 + j)}{r1 + i}'
            print(f'MISMATCH {rng} at {cell}: planned {W.plain(pv)!r}, sheet has {av!r}' + (f' ({note})' if note else ''))
            ok_all = False
    return ok_all


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    p.add_argument('plan')
    p.add_argument('reread')
    p.add_argument('--preconditions', action='store_true', help='check the preconditions (the preflight read) instead of the writes')
    p.add_argument('--include-deferred', action='store_true', help='also check the deferred writes')
    a = p.parse_args(argv)
    plan = json.loads(Path(a.plan).read_text())
    if plan.get('schema') != W.SCHEMA:
        raise SystemExit(f'{a.plan}: schema {plan.get("schema")!r}, this verifier reads {W.SCHEMA}')
    reread = load_reread(a.reread)
    if a.preconditions:
        pre = [(c['range'], c.get('expect', []), c.get('why')) for c in plan.get('preconditions', [])]
        if not pre:
            print('no preconditions in the plan')
            return 0
        ok = check(pre, reread, 'precondition')
        print('preconditions hold: write in the order the plan lists' if ok else 'preconditions FAIL: the sheet moved since the snapshot; refresh it and re-run the importer')
        return 0 if ok else 1
    writes = list(plan.get('writes', [])) + (list(plan.get('deferred', [])) if a.include_deferred else [])
    if plan.get('status') != 'ready':
        print(f'plan status is {plan.get("status")!r}: nothing should have been written')
        return 1
    if not writes:
        print('the plan has no writes; nothing to verify')
        return 0
    ok = check([(w['range'], w['values'], w.get('note')) for w in writes], reread, 'write')
    rows = sum(w['rows'] for w in writes)
    print(f'VERIFIED {rows} rows over {len(writes)} ranges' if ok else 'NOT VERIFIED: fix the ranges above before closing the month')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
