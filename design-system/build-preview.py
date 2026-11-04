"""Build an opt-in themed copy of the existing app; never mutate src or Sheet."""
from pathlib import Path
import base64,json,re
ROOT=Path(__file__).resolve().parents[1]
D=ROOT/'design-system'
read=lambda p:p.read_text(encoding='utf-8')
js=lambda x:json.dumps(x,ensure_ascii=False,separators=(',',':')).replace('</','<\\/')
shell=read(ROOT/'src/shell.html')
# Fail loudly if the exact source integration point changes.
pattern=r'<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>.*?</defs></svg>'
shell,n=re.subn(pattern,lambda _:read(D/'assets/icons/sprite-inline.html'),shell,flags=re.S)
assert n==1,'Original sprite not found exactly once; inspect source before integrating'
old='<span class="paw" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20"><use href="#i-paw"/></svg></span>'
assert shell.count(old)==1,'Brand integration point changed'
icon='data:image/png;base64,'+base64.b64encode((D/'assets/app-icons/kitty-128.png').read_bytes()).decode()
shell=shell.replace(old,f'<span class="paw" aria-hidden="true"><img alt="" width="36" height="36" style="border-radius:12px" src="{icon}"></span>')
shell=shell.replace('content="#1B1530"','content="#174E4A"')
page=(shell.replace('/*STYLE*/',read(ROOT/'src/style.css')+'\n'+read(D/'assets/tokens/calm.css')+'\n'+read(D/'motion/motion.css'))
 .replace('/*SOURCES*/','window.KITTY_SOURCES='+js(json.loads(read(ROOT/'src/data-sources.json')))+';')
 .replace('/*SNAPSHOT*/','window.__LOCAL__=true;window.KITTY_SNAPSHOT='+js(json.loads(read(ROOT/'data/snapshot.json')))+';window.KITTY_PAGE_URL="";')
 .replace('/*ENGINE*/',read(ROOT/'src/engine.js')).replace('/*APP*/',read(ROOT/'src/app.js')))
# This local visual check retains original app behaviour; new component workflows live in lab.html.
skel='<!doctype html><html lang="en" data-kitty-theme="calm"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>[hidden]{display:none!important}</style></head><body>'
out=ROOT/'dist/kitty-calm-local.html';out.parent.mkdir(exist_ok=True);out.write_text(skel+page+'</body></html>',encoding='utf-8')
print(f'{out} ({out.stat().st_size:,} bytes); source unchanged, bundled fictional demo only')
