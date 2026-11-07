"""Score a one-shot result.json against a family's sealed truth.

truth.json holds amounts in cents: {"income": {"2023-07": c, ...}, "spending": {...}, "networth": {...},
"balances": {"ACC-JOINT": {"2023-07": c, ...}, ...}}. result.json holds dollars:
{"months": {"2023-07": {"income": n, "spending": n, "net_worth": n}, ...}, "balances": {"ACC-JOINT": {"2023-07": n}}}.
Usage: python3 score.py truth.json result.json
"""
import json, sys

truth = json.load(open(sys.argv[1])); res = json.load(open(sys.argv[2]))
M = res["months"]; months = sorted(truth["income"]); d = lambda c: c / 100
for tk, rk in (("income", "income"), ("spending", "spending"), ("networth", "net_worth")):
    tv = {m: d(truth[tk][m]) for m in months}
    exact = sum(abs(M[m][rk] - tv[m]) < 0.01 for m in months)
    mean = sum(abs(M[m][rk] - tv[m]) for m in months) / len(months)
    t, g = sum(tv.values()), sum(M[m][rk] for m in months)
    print(f"{tk:9} exact {exact}/{len(months)}  mean monthly miss ${mean:,.2f}  total {100 * (g - t) / t:+.2f}%")
hit = tot = 0
for acct, by in truth["balances"].items():
    for m, v in by.items():
        tot += 1
        got = res.get("balances", {}).get(acct, {}).get(m)
        hit += got is not None and abs(abs(got) - abs(d(v))) < 0.01
print(f"balances  {hit} of {tot}")
