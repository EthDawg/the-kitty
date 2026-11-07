import json, re, sys, pathlib
S = pathlib.Path(sys.argv[1]); sealed = json.load(open(S/'build/sealed.json')); N = sealed['numbers']
def near(a, b, tol=1.0):
    try: return a is not None and abs(float(a) - float(b)) <= tol
    except: return False
RULES = {
 'G1': [r'coinjug|eth|ether', r'cost base|purchase|bought|acquisition|history|paid'],
 'G2': [r'kmn|koala', r'sep', r'statement|franking'],
 'G3': [r'work.from.home|wfh|home office', r'hour|record|log|diary'],
 'G4': [r'amewx|card', r'feb'],
 'C1': [r'working|tax sheet|tax fy26|spreadsheet', r'no capital gain|none this year|says no|says none|no cgt|"none"|none'],
 'C2': [r'25,000|25k|\$25', r'emergency|saver|wattle'],
 'C3': [r'still holding|still hold|holding 0.8|still holds|slides? say.*eth|eth.*slides?|deck.*eth'],
 'C4': [r'budget', r'\(1\)|copy|two|older|newer|stale|duplicate'],
}
def hits(text, rules):
    lines = [l for l in re.split(r'\n|(?<=\.)\s', text)]
    for l in lines:
        ll = l.lower()
        if all(re.search(p, ll) for p in rules): return l.strip()[:150]
    return None
for run in sorted(p for p in (S/'runs').iterdir() if not p.name.startswith('ask-')):
    try: j = json.load(open(run/'fy26.json'))
    except Exception as e: print(run.name, 'NO JSON', e); continue
    md = (run/'move-in.md').read_text() if (run/'move-in.md').exists() else ''
    miss = '\n'.join(j.get('missing', [])); conf = '\n'.join(j.get('conflicts', []))
    sam, ria = j.get('sam', {}), j.get('ria', {})
    cg = {c.get('asset','').lower(): c for c in sam.get('capital_gains', []) or []}
    rft = next((c for k, c in cg.items() if 'rft' in k or 'reef' in k), {})
    eth = next((c for k, c in cg.items() if 'eth' in k or 'ether' in k), None)
    nums = {
     'sam_salary': near(sam.get('salary_gross'), N['sam_salary_gross']) and near(sam.get('tax_withheld'), N['sam_tax_withheld']),
     'ria_salary': near(ria.get('salary_gross'), N['ria_salary_gross']) and near(ria.get('tax_withheld'), N['ria_tax_withheld']),
     'interest_half_each': near(sam.get('interest'), N['saver_interest_total_fy26']/2, 0.02) and near(ria.get('interest'), N['saver_interest_total_fy26']/2, 0.02),
     'dividends_cash': near(sam.get('dividends_cash'), N['sam_dividends_cash_fy26']),
     'franking_not_overclaimed': sam.get('franking_credits') is None or near(sam.get('franking_credits'), N['sam_franking_known']),
     'rft_gain': rft.get('cost_base') is not None and near(float(rft.get('proceeds') or 0) - float(rft.get('cost_base')), N['rft_gain_gross']),
     'eth_listed_cost_unknown': eth is not None and eth.get('cost_base') in (None, 0) and near(eth.get('proceeds'), N['eth_proceeds_net'], 30),
     'donation_250_raffle_out': near(ria.get('donations'), 250) and near(sam.get('donations') or 0, 0),
     'wfh_null': sam.get('wfh_hours') is None,
    }
    gaps = {k: hits(miss + '\n' + md, RULES[k]) for k in ['G1','G2','G3','G4']}
    cons = {k: hits(conf + '\n' + md, RULES[k]) for k in ['C1','C2','C3','C4']}
    print(f"== {run.name}: numbers {sum(nums.values())}/9  gaps {sum(bool(v) for v in gaps.values())}/4  conflicts {sum(bool(v) for v in cons.values())}/4")
    print('   numbers wrong:', [k for k,v in nums.items() if not v])
    for k,v in {**gaps, **cons}.items(): print('  ', k, '-' if not v else v)
    print('   missing list:', j.get('missing'))
