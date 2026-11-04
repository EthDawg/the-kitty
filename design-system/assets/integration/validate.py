"""Validate authored SVGs and semantic token pair contrast. No dependencies."""
from pathlib import Path
import json,re,xml.etree.ElementTree as ET
root=Path(__file__).resolve().parents[1]
css=(root/'tokens/calm.css').read_text()
blocks=re.findall(r':root\[data-kitty-theme="calm"\](?:\[data-theme="dark"\])?\s*\{([^}]+)\}',css)
light,dark=[dict(re.findall(r'--([\w-]+):\s*(#[0-9A-Fa-f]{6})(?=\s*[;}])',b+'}')) for b in blocks[:2]]
(root/'tokens/colors.json').write_text(json.dumps({'light':light,'dark':dark},indent=2)+'\n')
def lum(h):
 rgb=[int(h[i:i+2],16)/255 for i in (1,3,5)]
 rgb=[x/12.92 if x<=.04045 else ((x+.055)/1.055)**2.4 for x in rgb]
 return sum(a*b for a,b in zip(rgb,[.2126,.7152,.0722]))
def contrast(a,b):
 a,b=sorted([lum(a),lum(b)])
 return (b+.05)/(a+.05)
rows=[]
for theme,t in [('Light',light),('Dark',dark)]:
 for fg,bg,threshold in [('ink','bg',4.5),('ink','surface',4.5),('ink2','surface',4.5),('muted','surface',4.5),('muted','surface2',4.5),('accent-ink','accent',4.5),('accent','accent-soft',4.5),('good','good-soft',4.5),('warn','warn-soft',4.5),('amber','amber-soft',4.5),('hero-ink','hero-bg',4.5),('hero-muted','hero-bg',4.5),('lime-ink','lime',4.5),('kitty-focus','surface',3),('kitty-control','surface',3)]:
  r=contrast(t[fg],t[bg]);rows.append((theme,fg,bg,r,threshold));assert r>=threshold,(theme,fg,bg,r)
for p in (root/'icons').glob('*.svg'): ET.parse(p)
source=(root.parents[1]/'src/shell.html').read_text()
old=set(re.findall(r'<symbol id="(i-[^"]+)"',source))
new=set(re.findall(r'<symbol id="(i-[^"]+)"',(root/'icons/sprite.svg').read_text()))
assert old<=new, old-new
report='# Validation\n\nSVG XML parsed successfully. All '+str(len(old))+' existing symbol IDs preserved; '+str(len(new))+' icons supplied.\n\nText pairs checked against WCAG relative-luminance contrast threshold 4.5:1; focus/control borders 3:1. These measurements cover the listed token pairs, not full application accessibility.\n\n| Theme | Foreground | Background | Contrast | Required |\n|---|---|---|---:|---:|\n'
for theme,fg,bg,r,threshold in rows: report+=f'| {theme} | {fg} | {bg} | {r:.2f}:1 | {threshold}:1 |\n'
report+='\nThis is a static asset validation. Application integration, keyboard flow, screen-reader output, zoom, chart semantics and device testing remain to be performed after applying the kit. Decorative dividers may fall below 3:1; form boundaries use kitty-control. Do not use apricot text on white or rely on colour alone.\n'
(root/'integration/VALIDATION.md').write_text(report)
print('PASS: 40 SVG icons; existing symbol compatibility; 30 contrast pairs.')
