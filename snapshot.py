"""Save the demo sheet's data as data/snapshot.json, the household The Kitty opens with.

    python3 snapshot.py            # from the repo root

The sheet's bound Apps Script serves every table as JSON (apps-script/Code.js, ?format=json). Run this
after each month-end close; `build.py` bundles the file into the page so the demo opens instantly and
still works for a reader who has no Google Sheets connector. Real households never bundle: they read
live through the connector (see README.md, "Make it yours").
"""
import json
import sys
import urllib.request
from pathlib import Path

URL = ('https://script.google.com/macros/s/AKfycbxxNxJcjdBFLZIKoqrfn3DTpzX5mVdWtQclJ2Wzsp9xsRTrOFWhEHQBExHoRU2XxTN7Sw'
       '/exec?format=json')
OUT = Path(__file__).resolve().parent / 'data' / 'snapshot.json'
REQUIRED = ['metrics', 'transactions', 'accounts', 'goals', 'subscriptions', 'category_list', 'settings', 'cashflow', 'networth']

url = sys.argv[1] if len(sys.argv) > 1 else URL
with urllib.request.urlopen(url, timeout=90) as r:
    data = json.load(r)
missing = [k for k in REQUIRED if not data.get(k)]
assert not missing, f'feed is missing {missing}: redeploy apps-script/Code.js'
OUT.write_text(json.dumps(data, separators=(',', ':'), ensure_ascii=False))
print(f'wrote {OUT.relative_to(OUT.parents[2])}: {len(data["transactions"])} transactions, {len(data["metrics"])} metrics, '
      f'{len(data["subscriptions"])} subscriptions, read {data["fetchedAt"]}, {OUT.stat().st_size // 1024} KB')
