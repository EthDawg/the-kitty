"""Bundle The Kitty into one page.

    python3 build.py                 # dist/kitty.html, demo data bundled (the Davies, fictional), reading the 1.1 demo sheet
    python3 build.py --no-snapshot   # dist/kitty.html, no data bundled: the page reads your sheet live
    python3 build.py --v2            # dist/kitty-v2.html against the v2 sheet (the ledger model), from data/snapshot-v2.json

Also writes dist/local.html (or dist/local-v2.html), the same page wrapped in the viewer's document skeleton,
for local checks (serve dist/ with `python3 -m http.server`; the page runs without any connector on the bundled
data). Sheet IDs and the page URL come from kitty.config.json; the published 1.1 page keeps reading the 1.1
demo sheet until phase C cuts the artifact over to v2 (the v2 build's QR points at staging_url while it exists).

Bundled at build time: the brand icon sprite (brand/icons/sprite.svg replaces the shell's inline symbols, same ids),
the motion helpers (brand/motion), the merchant dictionary (merchants/), the fortune cookie, the empty-state
illustrations, every component under src/kit/, and a household's own logo pack if a gitignored logos/ folder holds
<merchant id>.svg or .png files (the public demo ships monograms only).
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
PAGE_URL = (CONFIG.get('staging_url') or CONFIG['page_url']) if v2 else CONFIG['page_url']
js = lambda v: json.dumps(v, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
BRAND = os.path.join(K, 'brand')
# the brand sprite: its <symbol>s go where the shell's hand-drawn sprite used to be, under the same ids
sprite = read(BRAND, 'icons', 'sprite.svg')
symbols = sprite[sprite.index('<symbol'):sprite.rindex('</symbol>') + len('</symbol>')]
merchants = {'merchants': json.load(open(os.path.join(K, 'merchants', 'merchants.json'))), 'categories': json.load(open(os.path.join(K, 'merchants', 'categories.json')))}
svg_body = lambda name: read(BRAND, *name)  # a whole SVG document, inlined where the page needs it
art = {'cookie': svg_body(('motion', 'fortune-cookie.svg')), 'allReviewed': svg_body(('illustrations', 'cat-all-reviewed.svg')), 'emptyActivity': svg_body(('illustrations', 'cat-empty-activity.svg'))}
# a household's own logos (gitignored): logos/<merchant id>.svg|png become data URIs; none in the public repo
logos = {}
logo_dir = os.path.join(K, 'logos')
if os.path.isdir(logo_dir):
    import base64
    for f in sorted(os.listdir(logo_dir)):
        stem, ext = os.path.splitext(f)
        if ext.lower() in ('.svg', '.png'):
            mime = 'image/svg+xml' if ext.lower() == '.svg' else 'image/png'
            logos[stem] = f'data:{mime};base64,' + base64.b64encode(open(os.path.join(logo_dir, f), 'rb').read()).decode()
kit = '\n'.join(read(SRC, 'kit', f) for f in sorted(os.listdir(os.path.join(SRC, 'kit'))) if f.endswith('.js'))
shell = read(SRC, 'shell.html')
sprite_start = shell.index('<svg width="0" height="0"')
sprite_end = shell.index('</svg>', sprite_start) + len('</svg>')
shell = shell[:sprite_start] + '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>' + symbols + '</defs></svg>' + shell[sprite_end:]
page = (shell
        .replace('/*STYLE*/', read(SRC, 'vendor', 'gridstack-14.0.0.min.css') + '\n' + read(SRC, 'style.css') + '\n' + read(BRAND, 'motion', 'motion.css'))
        .replace('/*SOURCES*/', 'window.KITTY_SOURCES=' + js(sources) + ';window.KITTY_MERCHANTS=' + js(merchants) + ';window.KITTY_ART=' + js(art) + ';window.KITTY_LOGOS=' + js(logos) + ';')
        .replace('/*SNAPSHOT*/', 'window.KITTY_SNAPSHOT=' + js(snapshot) + ';window.KITTY_PAGE_URL=' + js(PAGE_URL) + ';window.KITTY_SHEET=' + js(sheet_id) + ';')
        .replace('/*MOTION*/', read(BRAND, 'motion', 'motion.js'))
        .replace('/*ENGINE*/', read(SRC, 'engine.js'))
        .replace('/*KIT*/', kit)
        .replace('/*APP*/', read(SRC, 'app.js')))
os.makedirs(OUT, exist_ok=True)
suffix = '-v2' if v2 else ''
open(os.path.join(OUT, f'kitty{suffix}.html'), 'w', encoding='utf-8').write(page)
skel = ('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
        '<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}body{margin:0;font:14px system-ui}img{max-width:100%}[hidden]{display:none!important}</style></head><body>')
open(os.path.join(OUT, f'local{suffix}.html'), 'w', encoding='utf-8').write(skel + page + '</body></html>')
print(f"dist/kitty{suffix}.html: {len(page.encode()) // 1024} KB page; snapshot {'omitted' if no_snapshot else snapshot_file + ' bundled'}; sheet {sheet_id}; {len(merchants['merchants']['merchants'])} merchants; {len(logos)} logos")
