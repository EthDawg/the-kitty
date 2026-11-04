"""Cut the two ledger fixtures from data/snapshot-v2.json.

    python3 fixtures/make-v2-fixtures.py

everyday-only: the six cash accounts and every transaction, no property, loans, super, shares or things, so every
signal but has_contracts is off. everyday+property: cash plus the home, the Geelong townhouse and both loans, with the
lease and the loan terms. Both keep the sheet's Balances rows for the accounts they keep, so the sheet stays the oracle.
Deterministic, and CI regenerates them to prove the committed files match the snapshot.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
snap = json.loads((ROOT / 'data' / 'snapshot-v2.json').read_text())


def cut(name, keep_accounts, keep_contract_kinds, note):
    s = dict(snap)
    ids = set(keep_accounts)
    s['accounts'] = [a for a in snap['accounts'] if a['account_id'] in ids]
    s['entries'] = [e for e in snap['entries'] if e['account_id'] in ids]
    s['balances'] = [b for b in snap['balances'] if b['account_id'] in ids]
    s['valuations'] = [v for v in snap['valuations'] if v['item_id'] in ids]
    s['assets'] = [a for a in snap['assets'] if a['item_id'] in ids]
    s['loans'] = [l for l in snap['loans'] if l['loan_id'] in ids]
    s['contracts'] = [c for c in snap['contracts'] if c['kind'] in keep_contract_kinds and (not c['account_id'] or c['account_id'] in ids)]
    s['decisions'] = [d for d in snap['decisions'] if d['ref_kind'] != 'account' or d['ref_id'] in ids]
    s['networth'] = []   # the Net Worth tab is derived from every active account; a subset has no tab of its own
    s['metrics'] = [m for m in snap['metrics'] if not m['metric_id'].startswith('networth.') or m['metric_id'] == 'networth.cash']
    s['fixture'] = {'name': name, 'cut_from': snap.get('fetchedAt'), 'note': note}
    out = ROOT / 'fixtures' / f'{name}.json'
    out.write_text(json.dumps(s, separators=(',', ':'), ensure_ascii=False))
    print(f'{out.name}: {len(s["accounts"])} accounts, {len(s["entries"])} entries, {len(s["balances"])} balances, {len(s["contracts"])} contracts')


CASH = ['ACC-EVD', 'ACC-OFF', 'ACC-SAV', 'ACC-HOL', 'ACC-CC', 'ACC-RNT']
cut('everyday-only', CASH, {'subscription', 'insurance'}, 'the six cash accounts and every transaction; no property, loans, super, shares or things')
cut('everyday+property', CASH + ['HOME', 'RENTAL', 'LN-HOME', 'LN-INV'], {'subscription', 'insurance', 'loan', 'lease'},
    'cash plus the home, the Geelong townhouse and both loans, with the lease and the loan terms')
