"""Save the demo sheet's data as data/snapshot.json, the household The Kitty opens with.

    python3 snapshot.py            # from the repo root: the 1.1 demo sheet -> data/snapshot.json
    python3 snapshot.py --v2       # the v2 sheet's feed -> data/snapshot-v2.json (needs v2_feed_url in kitty.config.json)

The sheet's bound Apps Script serves every table as JSON (apps-script/Code.js, ?format=json). Run this
after each month-end close; `build.py` bundles the file into the page so the demo opens instantly and
still works for a reader who has no Google Sheets connector. Real households never bundle: they read
live through the connector (see README.md, "Start yours").

A copy of a sheet carries its bound script but not the script's web-app deployment, so a fresh copy has no
feed until someone deploys it (Extensions > Apps Script > Deploy > New deployment > Web app, execute as me,
anyone). Until then `tools/grid_to_snapshot.py` builds the same JSON from typed connector reads.
"""
import json
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
CONFIG = json.loads((HERE / 'kitty.config.json').read_text())
v2 = '--v2' in sys.argv
positional = [a for a in sys.argv[1:] if not a.startswith('--')]
url = positional[0] if positional else (CONFIG['v2_feed_url'] if v2 else CONFIG['demo_feed_url'])
OUT = HERE / 'data' / ('snapshot-v2.json' if v2 else 'snapshot.json')
REQUIRED = ['metrics', 'transactions', 'accounts', 'goals', 'subscriptions', 'category_list', 'settings', 'cashflow', 'networth'] + (['entries', 'balances', 'contracts'] if v2 else [])

if not url:
    sys.exit('the v2 sheet has no deployed feed yet: deploy the copy\'s bound Apps Script as a web app and put its /exec?format=json URL in '
             'kitty.config.json under v2_feed_url, or refresh data/snapshot-v2.json with tools/grid_to_snapshot.py from connector reads')
with urllib.request.urlopen(url, timeout=90) as r:
    data = json.load(r)
missing = [k for k in REQUIRED if not data.get(k)]
assert not missing, f'feed is missing {missing}: redeploy apps-script/Code.js'
OUT.write_text(json.dumps(data, separators=(',', ':'), ensure_ascii=False))
print(f'wrote {OUT.relative_to(HERE)}: {len(data["transactions"])} transactions, {len(data.get("entries", []))} entries, {len(data["metrics"])} metrics, '
      f'{len(data["subscriptions"])} subscriptions, read {data["fetchedAt"]}, {OUT.stat().st_size // 1024} KB')
