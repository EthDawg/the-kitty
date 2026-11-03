"""Bundle The Kitty into one page.

    python3 build.py                 # dist/kitty.html, demo data bundled (the Davies, fictional)
    python3 build.py --no-snapshot   # dist/kitty.html, no data bundled: the page reads your sheet live

Also writes dist/local.html, the same page wrapped in the viewer's document skeleton, for local checks
(serve dist/ with `python3 -m http.server`; the page runs without any connector on the bundled data).
"""
import json
import os
import sys

K = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(K, 'src')
OUT = os.path.join(K, 'dist')
read = lambda *p: open(os.path.join(*p), encoding='utf-8').read()
no_snapshot = '--no-snapshot' in sys.argv
sources = json.load(open(os.path.join(SRC, 'data-sources.json')))
snapshot = None if no_snapshot else json.load(open(os.path.join(K, 'data', 'snapshot.json')))
# the published page's own address (set after the first publish); the Setup tab's QR code points here
PAGE_URL = 'https://claude.ai/artifact/QH2gsDP8sHZmgMVKBtkwxn'
js = lambda v: json.dumps(v, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
page = (read(SRC, 'shell.html')
        .replace('/*STYLE*/', read(SRC, 'style.css'))
        .replace('/*SOURCES*/', 'window.KITTY_SOURCES=' + js(sources) + ';')
        .replace('/*SNAPSHOT*/', 'window.KITTY_SNAPSHOT=' + js(snapshot) + ';window.KITTY_PAGE_URL=' + js(PAGE_URL) + ';')
        .replace('/*ENGINE*/', read(SRC, 'engine.js'))
        .replace('/*APP*/', read(SRC, 'app.js')))
os.makedirs(OUT, exist_ok=True)
open(os.path.join(OUT, 'kitty.html'), 'w', encoding='utf-8').write(page)
skel = ('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
        '<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}body{margin:0;font:14px system-ui}img{max-width:100%}[hidden]{display:none!important}</style></head><body>')
open(os.path.join(OUT, 'local.html'), 'w', encoding='utf-8').write(skel + page + '</body></html>')
print(f"{len(page.encode()) // 1024} KB page; snapshot {'omitted' if no_snapshot else 'bundled'}")
