"""Rebuild original Kitty UI icons; standard library only."""
from pathlib import Path
import json

root = Path(__file__).resolve().parents[1]
icons = {
 'paw': '<path d="M7 17c0-2 2-3 3-5 1-2 3-2 4 0 1 2 3 3 3 5 0 4-10 4-10 0Z"/><ellipse cx="5" cy="10" rx="2" ry="2.5"/><ellipse cx="9.5" cy="5.5" rx="2" ry="2.5"/><ellipse cx="14.5" cy="5.5" rx="2" ry="2.5"/><ellipse cx="19" cy="10" rx="2" ry="2.5"/>',
 'home': '<path d="m3 10 9-7 9 7M5 9v11h14V9M9 20v-7h6v7"/>',
 'list': '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
 'insights': '<path d="M4 4v16h16M8 15l4-5 4 3 4-7"/>',
 'goal': '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
 'setup': '<path d="M4 6h5m4 0h7M4 12h10m4 0h2M4 18h3m4 0h9"/><circle cx="11" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="9" cy="18" r="2"/>',
 'search': '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
 'spark': '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/>',
 'x': '<path d="m6 6 12 12M18 6 6 18"/>',
 'chev': '<path d="m9 5 7 7-7 7"/>',
 'back': '<path d="m15 5-7 7 7 7"/>',
 'check': '<path d="m5 12 4.5 4.5L19 7"/>',
 'share': '<path d="M12 15V3m-4 4 4-4 4 4M5 12v8h14v-8"/>',
 'plus': '<path d="M12 5v14M5 12h14"/>',
 'refresh': '<path d="M20 10a8 8 0 1 0 0 5M20 4v6h-6"/>',
 'dl': '<path d="M12 3v12m-4-4 4 4 4-4M5 17v4h14v-4"/>',
 'wallet': '<rect x="3" y="5" width="18" height="15" rx="3"/><path d="M3 8V6a2 2 0 0 1 2-2h12M21 11h-6v5h6M17.5 13.5h.01"/>',
 'card': '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18M7 15h4"/>',
 'transfer': '<path d="M4 7h15m-4-4 4 4-4 4M20 17H5m4-4-4 4 4 4"/>',
 'income': '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
 'expense': '<path d="M12 16V4M7 9l5-5 5 5M4 16v5h16v-5"/>',
 'shield': '<path d="m12 3 8 3v6c0 4-4 7-8 9-4-2-8-5-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
 'calendar': '<rect x="4" y="5" width="16" height="16" rx="3"/><path d="M8 3v4m8-4v4M4 10h16M8 14h2m4 0h2m-8 3h2"/>',
 'receipt': '<path d="M5 3h14v18l-3-2-4 2-4-2-3 2V3ZM9 7h6m-6 4h6m-6 4h3"/>',
 'groceries': '<path d="M5 9h14l-2 12H7L5 9Zm3 0 4-6 4 6M9 13v4m6-4v4M3 9h18"/>',
 'coffee': '<path d="M4 8h12v8a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8Zm12 1h2a3 3 0 0 1 0 6h-2M7 3v2m6-2v2"/>',
 'transport': '<rect x="5" y="3" width="14" height="16" rx="3"/><path d="M5 11h14M8 19l-2 3m10-3 2 3M8 15h1m6 0h1M9 6h6"/>',
 'health': '<path d="M8 3h8v5h5v8h-5v5H8v-5H3V8h5V3Z"/>',
 'travel': '<path d="m3 12 7-2 1-6c.3-2 1.7-2 2 0l1 6 7 2v2l-7-1-1 6 3 1v1l-4-1-4 1v-1l3-1-1-6-7 1v-2Z"/>',
 'gift': '<path d="M4 10h16v4H4zM6 14v7h12v-7M12 10v11"/><path d="M12 10C2 10 5 1 9 5l3 5Zm0 0c10 0 7-9 3-5l-3 5Z"/>',
 'sheet': '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 9h16M4 15h16M10 9v12"/>',
 'warning': '<path d="m12 3 10 18H2L12 3ZM12 9v5m0 3h.01"/>',
 'info': '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
 'lock': '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
 'moon': '<path d="M20 14A8.5 8.5 0 0 1 10 3a9 9 0 1 0 10 11Z"/>',
 'sun': '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
 'edit': '<path d="m4 15 12-12 5 5L9 20l-6 1 1-6Zm9-9 5 5"/>',
 'filter': '<path d="M3 5h18l-7 8v7l-4-2v-5L3 5Z"/>',
 'clock': '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
 'cat': '<path d="M4 13V4l5 4a12 12 0 0 1 6 0l5-4v9a8 8 0 0 1-16 0Z"/><path d="M8 12h.01M16 12h.01m-5 3 1 1 1-1M3 15H1m20 0h2"/>',
}
attr = 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"'
for name, body in icons.items():
 (root/'icons'/f'{name}.svg').write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" {attr}>{body}</svg>\n')
symbols = '\n'.join(f'<symbol id="i-{name}" viewBox="0 0 24 24"><g {attr}>{body}</g></symbol>' for name,body in icons.items())
(root/'icons'/'sprite.svg').write_text(f'<svg xmlns="http://www.w3.org/2000/svg"><defs>{symbols}</defs></svg>\n')
(root/'icons'/'sprite-inline.html').write_text(f'<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute" aria-hidden="true"><defs>{symbols}</defs></svg>\n')
sheet = ['<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1000" viewBox="0 0 1200 1000"><rect width="1200" height="1000" fill="#F7F5EF"/><g fill="#182D2B" font-family="Arial,sans-serif"><text x="56" y="62" font-size="28" font-weight="700">The Kitty · UI icon library</text><text x="56" y="94" font-size="16">40 original icons · 24px grid · 1.8px rounded stroke · currentColor</text></g>']
for i,(name,body) in enumerate(icons.items()):
 x=56+(i%8)*140;y=140+(i//8)*164
 sheet.append(f'<rect x="{x}" y="{y}" width="124" height="144" rx="16" fill="#FFFFFF"/><g transform="translate({x+38} {y+28}) scale(2)" color="#174E4A" {attr}>{body}</g><text x="{x+62}" y="{y+111}" text-anchor="middle" font-family="Arial,sans-serif" font-size="14" fill="#182D2B">{name}</text>')
sheet.append('</svg>')
(root/'icons'/'contact-sheet.svg').write_text(''.join(sheet))
(root/'icons'/'manifest.json').write_text(json.dumps({'grid':24,'strokeWidth':1.8,'license':'Original artwork created for The Kitty; no third-party icon dependency.','icons':[{'name':n,'symbol':'i-'+n,'file':n+'.svg'} for n in icons]},indent=2)+'\n')
print(f'Built {len(icons)} icons, inline/external sprites, contact sheet and manifest.')
