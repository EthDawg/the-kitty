"""Bundle The Kitty into one page.

    python3 build.py                 # dist/kitty.html, demo data bundled (the Davies, fictional), reading the 1.1 demo sheet
    python3 build.py --no-snapshot   # dist/kitty.html, no data bundled: the page reads your sheet live
    python3 build.py --v2            # dist/kitty-v2.html against the v2 sheet (the ledger model), from data/snapshot-v2.json

Also writes dist/local.html (or dist/local-v2.html), the same page wrapped in the viewer's document skeleton,
for local checks (serve dist/ with `python3 -m http.server`; the page runs without any connector on the bundled
data). Sheet IDs and the page URL come from kitty.config.json; the published 1.1 page keeps reading the 1.1
demo sheet until phase C cuts the artifact over to v2.
"""
import json
import os
import sys

K = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(K, 'src')
OUT = os.path.join(K, 'dist')
read = lambda *p: open(os.path.join(*p), encoding='utf-8').read()
CONFIG = json.load(open(os.path.join(K, 'kitty.config.json')))
no_snapshot = '--no-snapshot' in sys.argv
v2 = '--v2' in sys.argv
sources = json.load(open(os.path.join(SRC, 'data-sources.json')))
snapshot_file = 'snapshot-v2.json' if v2 else 'snapshot.json'
snapshot = None if no_snapshot else json.load(open(os.path.join(K, 'data', snapshot_file)))
sheet_id = CONFIG['v2_sheet'] if v2 else CONFIG['demo_sheet']
# the published page's own address (set after the first publish); the Setup tab's QR code points here
PAGE_URL = CONFIG['page_url']
js = lambda v: json.dumps(v, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
page = (read(SRC, 'shell.html')
        .replace('/*STYLE*/', read(SRC, 'style.css'))
        .replace('/*SOURCES*/', 'window.KITTY_SOURCES=' + js(sources) + ';')
        .replace('/*SNAPSHOT*/', 'window.KITTY_SNAPSHOT=' + js(snapshot) + ';window.KITTY_PAGE_URL=' + js(PAGE_URL) + ';window.KITTY_SHEET=' + js(sheet_id) + ';')
        .replace('/*ENGINE*/', read(SRC, 'engine.js'))
        .replace('/*APP*/', read(SRC, 'app.js')))
os.makedirs(OUT, exist_ok=True)
suffix = '-v2' if v2 else ''
open(os.path.join(OUT, f'kitty{suffix}.html'), 'w', encoding='utf-8').write(page)
skel = ('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
        '<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}body{margin:0;font:14px system-ui}img{max-width:100%}[hidden]{display:none!important}</style></head><body>')
open(os.path.join(OUT, f'local{suffix}.html'), 'w', encoding='utf-8').write(skel + page + '</body></html>')
print(f"dist/kitty{suffix}.html: {len(page.encode()) // 1024} KB page; snapshot {'omitted' if no_snapshot else snapshot_file + ' bundled'}; sheet {sheet_id}")
