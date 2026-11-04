#!/usr/bin/env python3
"""Builds The Kitty's brand kit: mascots (cat default, dog alternate), app icons, the semantic icon set,
empty-state illustrations, motion pieces and a contact sheet. Run: python3 brand/build_brand.py
Everything is hand-drawn SVG on a 24 grid (icons) or a 160 grid (mascots). No fonts are embedded."""
import json, os, re, shutil, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

def w(path, s):
    os.makedirs(os.path.dirname(os.path.join(HERE, path)), exist_ok=True)
    with open(os.path.join(HERE, path), "w") as f: f.write(s)

# ---------------------------------------------------------------- icons: 24 grid, stroke 2, round caps and joins
S = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'
def P(d, extra=""): return f'<path {S} d="{d}"{extra}/>'
FILLC = 'fill="currentColor"'
def C(cx, cy, r, fill=False): return f'<circle cx="{cx}" cy="{cy}" r="{r}" {FILLC if fill else S}/>'
def R(x, y, wd, h, rx): return f'<rect x="{x}" y="{y}" width="{wd}" height="{h}" rx="{rx}" {S}/>'
def DOT(cx, cy, r=0.9): return f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="currentColor"/>'
HOUSE = "M3 11.5 12 4l9 7.5M5.5 10v10h13V10"
HEART = "M12 20s-7-4.4-7-9.5A4 4 0 0 1 12 8a4 4 0 0 1 7 2.5C19 15.6 12 20 12 20z"
SPARK = "M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"
ICONS = {
  # navigation and controls
  "paw": ("The Kitty's own mark; pets category", '<path fill="currentColor" d="M12 21c-3.3 0-6-1.9-6-4.3 0-1.4.9-2.4 2.1-3.4 1-.8 1.6-1.9 2.1-2.9.5-1 1.1-1.6 1.8-1.6s1.3.6 1.8 1.6c.5 1 1.1 2.1 2.1 2.9C17.1 14.3 18 15.3 18 16.7 18 19.1 15.3 21 12 21Zm-6.3-8.2c-1.2.3-2.5-.7-2.9-2.2-.4-1.5.3-3 1.5-3.3 1.2-.3 2.5.7 2.9 2.2.4 1.5-.3 3-1.5 3.3Zm12.6 0c-1.2-.3-1.9-1.8-1.5-3.3.4-1.5 1.7-2.5 2.9-2.2 1.2.3 1.9 1.8 1.5 3.3-.4 1.5-1.7 2.5-2.9 2.2ZM9 8.6c-1.3 0-2.3-1.4-2.3-3.1S7.7 2.4 9 2.4s2.3 1.4 2.3 3.1S10.3 8.6 9 8.6Zm6 0c-1.3 0-2.3-1.4-2.3-3.1s1-3.1 2.3-3.1 2.3 1.4 2.3 3.1-1 3.1-2.3 3.1Z"/>'),
  "home": ("Home tab", P(HOUSE) + P("M10 20v-6h4v6")),
  "list": ("Activity tab, a list", P("M8 6h12M8 12h12M8 18h12") + DOT(4,6,1.4) + DOT(4,12,1.4) + DOT(4,18,1.4)),
  "receipt": ("A receipt; a transaction", P("M6 3h12v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5L6 21zM9 8h6M9 12h6M9 16h3")),
  "insights": ("Trends tab; a rising line", P("M3 16l4.5-5 4 3 4.5-6L21 6M16 6h5v5")),
  "goal": ("Goals tab; a target", C(12,12,9) + C(12,12,5) + DOT(12,12,1.3)),
  "save": ("Save tab; a piggy bank", P("M5 13c0-3.5 3-6 7-6 3 0 5 1 6 2.5h2.5v3.5H19c-.3 1-1 1.8-1.8 2.3V18h-2.5l-.7-1.5h-4L9.5 18H7v-2.5C5.8 14.9 5 14 5 13zM12 7V5") + DOT(15,12,1)),
  "things": ("Things tab; a tag on an owned item", P("M3 12V4h8l10 10-8 8L3 12z") + DOT(7.5,8.5,1.3)),
  "setup": ("Setup tab; sliders", P("M4 7h9M17 7h3M4 17h3M11 17h9") + C(15,7,2) + C(9,17,2)),
  "search": ("Search", C(11,11,6.5) + P("M16 16l5 5")),
  "spark": ("Ask the Kitty", P(SPARK) + P("M19 3v3M17.5 4.5h3")),
  "x": ("Close", P("M6 6l12 12M18 6 6 18")),
  "chev": ("Forward, open", P("M9 6l6 6-6 6")),
  "back": ("Back", P("M15 6l-6 6 6 6")),
  "check": ("Done, confirmed", P("M5 12.5l4.5 4.5L19 7.5")),
  "share": ("Share", P("M12 3v12M8 7l4-4 4 4M5 13v6h14v-6")),
  "plus": ("Add", P("M12 5v14M5 12h14")),
  "refresh": ("Refresh, re-read the sheet", P("M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5")),
  "dl": ("Download", P("M12 4v11M7 10l5 5 5-5M5 20h14")),
  "filter": ("Filter", P("M4 5h16l-6 7v6l-4 2v-8z")),
  "calendar": ("A date", R(3,5,18,16,2) + P("M3 10h18M8 3v4M16 3v4")),
  "clock": ("Time, due", C(12,12,9) + P("M12 7v5l3 2")),
  "edit": ("Edit", P("M4 20h4l11-11-4-4L4 16v4zM13 7l4 4")),
  "note": ("A note on a row", P("M5 4h11l3 3v13H5zM16 4v3h3M8 11h8M8 15h5")),
  "info": ("Information", C(12,12,9) + P("M12 11v5M12 8h.01")),
  "warning": ("Needs attention", P("M12 3l10 18H2L12 3zM12 10v4M12 17h.01")),
  "lock": ("Private, read-only", R(5,11,14,10,2) + P("M8 11V8a4 4 0 0 1 8 0v3")),
  "sun": ("Light theme", C(12,12,4) + P("M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4")),
  "moon": ("Dark theme", P("M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z")),
  "eye": ("Show, look", P("M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z") + C(12,12,3)),
  "person": ("One person", C(12,8,4) + P("M4 21a8 8 0 0 1 16 0")),
  "people": ("The household", C(9,8,3.5) + P("M2 20a7 7 0 0 1 14 0M16 5a3.5 3.5 0 0 1 0 7M18 13.5a6 6 0 0 1 4 6.5")),
  "sheet": ("The Google Sheet", R(3,4,18,16,2) + P("M3 10h18M3 15h18M9 4v16M15 4v16")),
  "link": ("Connected", P("M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1")),
  "trash": ("Remove", P("M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6")),
  # money and accounts
  "cash": ("Cash, a bank note, an everyday account", R(2,6,20,12,2) + C(12,12,3) + P("M5 9h.01M19 15h.01")),
  "card": ("A credit card", R(2,5,20,14,2.5) + P("M2 10h20M6 15h4")),
  "bank": ("A bank or institution", P("M3 10l9-6 9 6H3zM5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18")),
  "wallet": ("Wallet; spending money", P("M3 7a2 2 0 0 1 2-2h13v4H5M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2z") + DOT(16,14.5,1.1)),
  "stack": ("Savings, a stack of coins", f'<ellipse cx="12" cy="6" rx="7" ry="3" {S}/>' + P("M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6")),
  "coin": ("A lucky coin; money milestones", C(12,12,9) + R(9.5,9.5,5,5,0.8)),
  "transfer": ("Transfer between your own accounts", P("M4 8h13M14 5l3 3-3 3M20 16H7M10 13l-3 3 3 3")),
  "income": ("Money in", P("M12 4v9M8 9l4 4 4-4M4 14v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3")),
  "spend": ("Money out", P("M12 13V4M8 8l4-4 4 4M4 14v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3")),
  "recurring": ("Recurring, a subscription", P("M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3M18 3v4h-4M6 21v-4h4")),
  "refund": ("A refund or reversal", P("M4 10h11a4 4 0 0 1 0 8h-3M7 7l-3 3 3 3")),
  "split": ("Split one row into parts", P("M12 4v6M12 10l-5 5v5M12 10l5 5v5")),
  "duplicate": ("Possible duplicate", R(8,8,12,12,2) + P("M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2")),
  "pending": ("Pending, not settled", f'<circle cx="12" cy="12" r="9" {S} stroke-dasharray="3 3"/>' + P("M12 8v4l2.5 1.5")),
  "new": ("First time at this merchant", P("M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.2l5.9-.9z")),
  "review": ("Review queue", R(5,4,14,17,2) + P("M9 4V3h6v2H9zM9 13l2 2 4-4")),
  "worth": ("Worth it?", P(HEART) + f'<path fill="currentColor" d="M18.5 2l.8 1.8 1.8.7-1.8.7-.8 1.8-.8-1.8-1.8-.7 1.8-.7z"/>'),
  "rule": ("A rule the Kitty proposed", P("M3 21L14 10M17 3v4M15 5h4") + f'<path fill="currentColor" d="M20 8l.7 1.6 1.6.7-1.6.7L20 12.6l-.7-1.6-1.6-.7 1.6-.7z"/>'),
  "fortune": ("Fortune cookie: Ask proposes, you decide", P("M4 14a8 6 0 0 1 16 0c0 1.5-1 2.5-2.5 2.5h-11C5 16.5 4 15.5 4 14zM12 8c-1.5 2.5-1.5 6 0 8.5M14.5 12.5H20v3h-5.5")),
  "fees": ("Fees and charges", C(12,12,9) + P("M9 15l6-6") + DOT(9.5,9.5) + DOT(14.5,14.5)),
  "interest": ("Interest earned: money that grows", P("M12 21v-7M12 14c-3.5 0-6-2.5-6-6 3.5 0 6 2.5 6 6zM12 14c3.5 0 6-2.5 6-6-3.5 0-6 2.5-6 6zM5 21h14")),
  # domains
  "property": ("Property, your home", P(HOUSE) + C(12,13,2) + P("M12 15v4")),
  "property-invest": ("Investment property, for lease", P("M3 12l7-6 7 6M5 11v8h10v-8M19 8v12M16 9h6v4h-6z")),
  "loan": ("A loan or mortgage", P(HOUSE) + P("M9.5 17l5-5") + DOT(9.8,12.6) + DOT(14.2,16.9)),
  "offset": ("Offset account against a loan", P(HOUSE) + P("M12 11v6M9.5 14.5l2.5 2.5 2.5-2.5")),
  "shares": ("Shares and ETFs", P("M3 17l5-5 4 3 5-6 4 2M17 7h4v4M3 21h18")),
  "rsu": ("Employee shares vesting over time", R(5,11,14,10,2) + P("M8 11V8a4 4 0 0 1 8 0v3M12 14v2.5l1.5 1")),
  "crypto": ("Crypto", P("M12 2.5l8 4.75v9.5L12 21.5 4 16.75v-9.5zM9 9h4.5a1.5 1.5 0 0 1 0 3H9zM9 12h5a1.5 1.5 0 0 1 0 3H9zM11 7v2M11 15v2")),
  "super": ("Superannuation, the nest egg", P("M12 4c3.3 0 5.5 3.5 5.5 7a5.5 5.5 0 0 1-11 0C6.5 7.5 8.7 4 12 4zM4 15c2 1.5 5 2 8 2s6-.5 8-2M5 18c2 1.2 4.5 1.8 7 1.8s5-.6 7-1.8")),
  "smsf": ("Self-managed super, the nest egg you hold the key to", P("M12 3c3 0 5 3.2 5 6.3a5 5 0 0 1-10 0C7 6.2 9 3 12 3zM4 14c2 1.3 5 1.8 8 1.8s6-.5 8-1.8") + C(7,20,1.8) + P("M8.8 20H16l-1.5 1.5M13.5 20l1.5-1.5")),
  "insurance": ("Insurance, cover", P("M3 12a9 9 0 0 1 18 0H3zM12 12v6a2 2 0 0 1-4 0M12 3v1")),
  "health": ("Health and medical", P(HEART) + P("M12 11v4M10 13h4")),
  "car": ("A car", P("M3 16h18M5 16l1.6-5.4A2 2 0 0 1 8.5 9h7a2 2 0 0 1 1.9 1.6L19 16M4 16v3h3v-3M17 16v3h3v-3")),
  "laptop": ("A laptop", R(4,5,16,11,1.5) + P("M2 19h20")),
  "phone": ("A phone", R(7,2.5,10,19,2.5) + P("M11 18h2")),
  "cycle": ("Planned refresh or renewal date", R(3,5,18,16,2) + P("M3 10h18M8 3v4M16 3v4M14.5 14a2.5 2.5 0 1 0 .7 2.3M15 13.5v2h-2")),
  "tax": ("Tax", P("M6 3h9l4 4v14H6zM15 3v4h4M9.5 16.5l5-5") + DOT(10,12) + DOT(14.5,16.5)),
  "folder": ("The accountant pack", P("M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z")),
  "cat": ("Cat brand", P("M4 4l4 4h8l4-4v9a8 8 0 0 1-16 0V4zM2 13h4M18 13h4") + DOT(9,12,1.1) + DOT(15,12,1.1)),
  "dog": ("Dog brand", C(12,11,6) + P("M7 8c-3 0-4 4-3 7s4 2 4 0M17 8c3 0 4 4 3 7s-4 2-4 0") + DOT(12,13,1.3) + DOT(9.8,9.5,1) + DOT(14.2,9.5,1)),
  # spending categories
  "groceries": ("Groceries", P("M4 10h16l-1.5 9h-13zM8 10l2-5M16 10l-2-5M3 10h18")),
  "dining": ("Dining out", P("M8 3v7M5 3v4a3 3 0 0 0 6 0V3M8 10v11M16 3v18M16 3c-2.5 2-2.5 8 0 10")),
  "coffee": ("Coffee", P("M4 8h12v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM16 10h2a2 2 0 0 1 0 4h-2M7 4v1M10 4v1M13 4v1")),
  "transport": ("Public transport", R(4,3,16,15,3) + P("M4 11h16M8 18v3M16 18v3") + DOT(8,14.5,1) + DOT(16,14.5,1)),
  "fuel": ("Fuel", P("M4 21V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v16M4 21h11M6 7h7M15 10h2a2 2 0 0 1 2 2v5a1.5 1.5 0 0 0 3 0V9l-3-3")),
  "utilities": ("Power, gas, water", P("M13 2L4 14h7l-1 8 9-12h-7z")),
  "shopping": ("Shopping", P("M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2")),
  "clothing": ("Clothing", P("M8 3l4 2 4-2 5 4-3 3-2-1v12H8V9L6 10 3 7z")),
  "gifts": ("Gifts", R(3,9,18,12,1.5) + P("M3 13h18M12 9v12M12 9c-2 0-5-1-5-3s3-3 5 3c2-6 5-4 5-3s-3 3-5 3")),
  "travel": ("Travel and holidays", P("M3 13l18-7-5 14-3-5-5 3 2-5z")),
  "entertainment": ("Entertainment and streaming", R(3,5,18,14,3) + '<path fill="currentColor" d="M10 9l5 3-5 3z"/>'),
  "fitness": ("Fitness and sport", P("M6 8v8M3 10v4M18 8v8M21 10v4M6 12h12")),
  "kids": ("Kids", P("M12 3a5 6 0 1 0 0 12 5 6 0 0 0 0-12zM11 15l1 2 1-2M12 17c0 2-2 2-2 4")),
  "work": ("Work expenses", R(3,7,18,13,2) + P("M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 12h18")),
  "giving": ("Giving and donations", P("M12 11s-4-2.2-4-5a2.2 2.2 0 0 1 4-1.2A2.2 2.2 0 0 1 16 6c0 2.8-4 5-4 5zM4 21v-7h3l5 3h3a1.5 1.5 0 0 1 0 3H9M14 20h4l3-4")),
  "tools": ("Home maintenance", P("M15 4l5 5-3 3-5-5zM13 7L4 16l3 3 9-9")),
  "education": ("Education", P("M4 4h7a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4zM20 4h-7a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h7z")),
  "beauty": ("Hair and beauty", C(6,6,3) + C(6,18,3) + P("M20 4L8.5 15.5M8.5 8.5 20 20")),
  "pets": ("Pets", '<use href="#i-paw"/>'),
  "salary": ("Salary", R(2,6,20,12,2) + C(12,12,3) + P("M5 9h.01M19 15h.01")),
}
ICONS["pets"] = ICONS["paw"]  # same drawing, its own name for the category map

def icon_svg(name, inner, size=24):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="{size}" height="{size}" aria-hidden="true">{inner}</svg>\n'

# ---------------------------------------------------------------- mascots: 160 grid
MASCOT_STYLE = """<style>
.k-body{fill:var(--mascot-body,#F1E6D2)}.k-head{fill:var(--mascot-head,#FBF4E6)}.k-ink{fill:var(--mascot-ink,#17122B)}
.k-s{fill:none;stroke:var(--mascot-ink,#17122B);stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
.k-patch{fill:var(--mascot-patch,#F0533D)}.k-blush{fill:var(--mascot-blush,#FF9E8C);opacity:.5}
.k-collar{fill:none;stroke:var(--mascot-collar,#5B3DF5);stroke-width:8;stroke-linecap:round}
.k-gold{fill:var(--mascot-gold,#F2B134)}.k-gold2{fill:var(--mascot-gold2,#C98A14)}
.k-paw{transform-origin:46px 104px}.k-tail{transform-origin:114px 128px}
.k-tan{fill:var(--mascot-tan,#E8B877)}.k-tan2{fill:var(--mascot-tan2,#D9A25C)}
</style>"""
COIN = ('<ellipse class="k-gold2" cx="100" cy="141" rx="20" ry="12"/><ellipse class="k-gold" cx="100" cy="138" rx="20" ry="12"/>'
        '<rect class="k-gold2" x="95.5" y="133.5" width="9" height="9" rx="1.5"/>')
CAT = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" width="160" height="160" role="img" aria-label="The Kitty: a lucky cat with one paw raised, resting the other on a coin">
{MASCOT_STYLE}
<defs><clipPath id="kc-head"><circle cx="80" cy="62" r="40"/></clipPath><clipPath id="kc-body"><path d="M48 150C40 112 54 90 80 90s40 22 32 60Z"/></clipPath></defs>
<path class="k-body" style="fill:none;stroke:var(--mascot-body,#F1E6D2);stroke-width:11;stroke-linecap:round" d="M116 134c14-2 22-10 18-26"/>
<path class="k-body" d="M48 150C40 112 54 90 80 90s40 22 32 60Z"/>
<g clip-path="url(#kc-body)"><path class="k-patch" d="M104 102c10 6 12 22 8 44-6 2-11 0-15-5 1-14 2-26 7-39z"/></g>
{COIN}
<rect class="k-head" x="80" y="128" width="24" height="15" rx="7.5"/><path class="k-s" style="stroke-width:2" d="M88 130v4M96 130v4"/>
<path class="k-patch" d="M44 48L40 14q0-4 4-2l27 21z"/><path class="k-blush" style="opacity:.8" d="M48 42l-2-20 17 14z"/>
<path class="k-head" d="M116 48l4-34q0-4-4-2L89 33z"/><path class="k-blush" style="opacity:.8" d="M112 42l2-20-17 14z"/>
<circle class="k-head" cx="80" cy="62" r="40"/>
<g clip-path="url(#kc-head)"><path class="k-patch" d="M38 46c8-16 24-20 40-12-6 12-18 18-32 20z"/></g>
<path class="k-s" style="stroke-width:3.5" d="M60 64q7-8 14 0M86 64q7-8 14 0"/>
<path class="k-ink" d="M76 72h8l-4 4.5z"/><path class="k-s" style="stroke-width:2.5" d="M72 78q4 5 8 0q4 5 8 0"/>
<path class="k-s" style="stroke-width:2" d="M50 68h-14M50 75l-13 3M110 68h14M110 75l13 3"/>
<circle class="k-blush" cx="58" cy="76" r="6"/><circle class="k-blush" cx="102" cy="76" r="6"/>
<path class="k-collar" d="M54 96q26 12 52 0"/><circle class="k-gold" cx="80" cy="104" r="7"/><path class="k-s" style="stroke-width:2" d="M76 105h8M80 105v3"/>
<g class="k-paw"><path style="fill:none;stroke:var(--mascot-head,#FBF4E6);stroke-width:20;stroke-linecap:round" d="M46 104C32 100 26 80 32 60"/><circle class="k-head" cx="32" cy="56" r="13"/><path class="k-s" style="stroke-width:2" d="M25 51v6M32 48v6M39 51v6"/></g>
</svg>
'''
DOG = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" width="160" height="160" role="img" aria-label="The Kitty's dog: a shiba resting both paws on a coin, tail up">
{MASCOT_STYLE}
<defs><clipPath id="kd-head"><circle cx="80" cy="62" r="40"/></clipPath><clipPath id="kd-body"><path d="M48 150C40 112 54 90 80 90s40 22 32 60Z"/></clipPath></defs>
<g class="k-tail"><path style="fill:none;stroke:var(--mascot-tan,#E8B877);stroke-width:12;stroke-linecap:round" d="M114 128c16 0 22-14 12-24"/><path style="fill:none;stroke:var(--mascot-head,#FBF4E6);stroke-width:5;stroke-linecap:round" d="M121 124c8-2 11-8 8-14"/></g>
<path class="k-tan" d="M48 150C40 112 54 90 80 90s40 22 32 60Z"/>
<g clip-path="url(#kd-body)"><path class="k-head" d="M62 96c10-4 26-4 36 0 2 14 0 28-6 40-8 2-16 2-24 0-6-12-8-26-6-40z"/></g>
{COIN}
<rect class="k-head" x="58" y="128" width="24" height="15" rx="7.5"/><path class="k-s" style="stroke-width:2" d="M66 130v4M74 130v4"/>
<rect class="k-head" x="84" y="128" width="24" height="15" rx="7.5"/><path class="k-s" style="stroke-width:2" d="M92 130v4M100 130v4"/>
<path class="k-tan" d="M46 50L42 14q0-4 4-2l26 24z"/><path class="k-blush" style="opacity:.8" d="M50 44l-2-20 16 16z"/>
<path class="k-tan" d="M114 50l4-36q0-4-4-2L88 36z"/><path class="k-blush" style="opacity:.8" d="M110 44l2-20-16 16z"/>
<circle class="k-tan" cx="80" cy="62" r="40"/>
<g clip-path="url(#kd-head)"><path class="k-head" d="M48 70c0-14 64-14 64 0 0 20-12 34-32 34S48 90 48 70z"/></g>
<circle class="k-head" cx="62" cy="50" r="4"/><circle class="k-head" cx="98" cy="50" r="4"/>
<path class="k-s" style="stroke-width:3.5" d="M58 60q7-8 14 0M88 60q7-8 14 0"/>
<path class="k-ink" d="M72 72q8-4 16 0 2 1 0 3l-6 6q-2 2-4 0l-6-6q-2-2 0-3z"/><path class="k-s" style="stroke-width:2.5" d="M72 84q4 5 8 0q4 5 8 0"/>
<circle class="k-blush" cx="56" cy="76" r="6"/><circle class="k-blush" cx="104" cy="76" r="6"/>
<path class="k-collar" d="M54 96q26 12 52 0"/><circle class="k-gold" cx="80" cy="106" r="7"/><circle class="k-gold2" cx="80" cy="106" r="2.5"/>
</svg>
'''
# app icons: 1024 grid, the glow gradient and the head
def app_icon(kind):
    if kind == "cat":
        head = '''<path fill="#F0533D" d="M296 420L270 170q0-26 26-13l170 142z"/><path fill="#FFB8A8" d="M322 380l-12-130 108 92z"/>
<path fill="#FBF4E6" d="M728 420l26-250q0-26-26-13L558 299z"/><path fill="#FFB8A8" d="M702 380l12-130-108 92z"/>
<circle fill="#FBF4E6" cx="512" cy="540" r="270"/>
<path fill="#F0533D" d="M258 470c40-100 150-130 250-90-36 76-110 116-200 126z" clip-path="url(#ic)"/>
<path fill="none" stroke="#17122B" stroke-width="24" stroke-linecap="round" d="M382 548q48-56 96 0M546 548q48-56 96 0"/>
<path fill="#17122B" d="M484 600h56l-28 32z"/><path fill="none" stroke="#17122B" stroke-width="18" stroke-linecap="round" d="M456 646q28 36 56 0q28 36 56 0"/>
<path fill="none" stroke="#17122B" stroke-width="14" stroke-linecap="round" d="M306 580h-70M308 630l-68 16M718 580h70M716 630l68 16"/>
<circle fill="#FF9E8C" opacity=".5" cx="360" cy="640" r="40"/><circle fill="#FF9E8C" opacity=".5" cx="664" cy="640" r="40"/>'''
        clip = '<clipPath id="ic"><circle cx="512" cy="540" r="270"/></clipPath>'
    else:
        head = '''<path fill="#E8B877" d="M300 440L272 190q0-26 26-13l168 160z"/><path fill="#FFB8A8" d="M326 396l-14-130 104 100z"/>
<path fill="#E8B877" d="M724 440l28-250q0-26-26-13L558 337z"/><path fill="#FFB8A8" d="M698 396l14-130-104 100z"/>
<circle fill="#E8B877" cx="512" cy="540" r="270"/>
<path fill="#FBF4E6" d="M300 600c0-100 424-100 424 0 0 140-80 230-212 230S300 740 300 600z" clip-path="url(#ic)"/>
<circle fill="#FBF4E6" cx="392" cy="470" r="28"/><circle fill="#FBF4E6" cx="632" cy="470" r="28"/>
<path fill="none" stroke="#17122B" stroke-width="24" stroke-linecap="round" d="M364 540q48-56 96 0M564 540q48-56 96 0"/>
<path fill="#17122B" d="M456 610q56-28 112 0 14 8 0 22l-42 42q-14 14-28 0l-42-42q-14-14 0-22z"/><path fill="none" stroke="#17122B" stroke-width="18" stroke-linecap="round" d="M456 700q28 36 56 0q28 36 56 0"/>
<circle fill="#FF9E8C" opacity=".5" cx="350" cy="640" r="40"/><circle fill="#FF9E8C" opacity=".5" cx="674" cy="640" r="40"/>'''
        clip = '<clipPath id="ic"><circle cx="512" cy="540" r="270"/></clipPath>'
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024" role="img" aria-label="The Kitty app icon">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5B3DF5"/><stop offset=".48" stop-color="#8E45FF"/><stop offset="1" stop-color="#FF5CC8"/></linearGradient>{clip}</defs>
<rect width="1024" height="1024" rx="224" fill="url(#g)"/>
{head}
</svg>
'''

# ---------------------------------------------------------------- motion pieces
COOKIE = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 110" width="160" height="110" aria-hidden="true">
<style>.c{fill:var(--cookie,#E9B96E)}.c2{fill:var(--cookie2,#C98A3E)}.half{transition:transform .7s cubic-bezier(.2,.8,.2,1)}.hl{transform-origin:40px 70px}.hr{transform-origin:120px 70px}
.open .hl{transform:translate(-26px,6px) rotate(-16deg)}.open .hr{transform:translate(26px,6px) rotate(16deg)}
.slip{fill:#fff;stroke:#D9D2C4;stroke-width:1.5;transform:scaleX(0);transform-origin:80px 66px;transition:transform .5s .35s cubic-bezier(.2,.8,.2,1)}.open .slip{transform:scaleX(1)}
@media (prefers-reduced-motion:reduce){.half,.slip{transition:none}}</style>
<rect class="slip" x="30" y="56" width="100" height="22" rx="4"/>
<g class="half hl"><path class="c" d="M80 30C56 30 34 44 24 66c-4 8 0 14 8 14h48c-6-16-6-34 0-50z"/><path class="c2" d="M48 48c-6 6-10 14-12 22h8c2-8 6-14 10-20z"/></g>
<g class="half hr"><path class="c" d="M80 30c24 0 46 14 56 36 4 8 0 14-8 14H80c6-16 6-34 0-50z"/><path class="c2" d="M112 48c6 6 10 14 12 22h-8c-2-8-6-14-10-20z"/></g>
</svg>
'''
BISCUIT = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 110" width="160" height="110" aria-hidden="true">
<style>.b{fill:var(--cookie,#E9B96E)}.b2{fill:var(--cookie2,#C98A3E)}.half{transition:transform .7s cubic-bezier(.2,.8,.2,1)}.hl{transform-origin:40px 60px}.hr{transform-origin:120px 60px}
.open .hl{transform:translate(-26px,6px) rotate(-12deg)}.open .hr{transform:translate(26px,6px) rotate(12deg)}
.slip{fill:#fff;stroke:#D9D2C4;stroke-width:1.5;transform:scaleX(0);transform-origin:80px 60px;transition:transform .5s .35s cubic-bezier(.2,.8,.2,1)}.open .slip{transform:scaleX(1)}
@media (prefers-reduced-motion:reduce){.half,.slip{transition:none}}</style>
<rect class="slip" x="30" y="50" width="100" height="22" rx="4"/>
<g class="half hl"><path class="b" d="M80 46H46a14 14 0 1 0-12 22 14 14 0 1 0 12 22h34z"/><circle class="b2" cx="52" cy="60" r="3"/></g>
<g class="half hr"><path class="b" d="M80 46h34a14 14 0 1 1 12 22 14 14 0 1 1-12 22H80z"/><circle class="b2" cx="108" cy="60" r="3"/></g>
</svg>
'''
COIN_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#C98A14"/><circle cx="12" cy="11" r="10" fill="#F2B134"/><rect x="8.5" y="7.5" width="7" height="7" rx="1.2" fill="#C98A14"/></svg>\n'
NOTE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 20" width="36" height="20" aria-hidden="true"><rect width="36" height="20" rx="3" fill="#8DE3C8"/><rect x="2" y="2" width="32" height="16" rx="2" fill="none" stroke="#0E8F8E" stroke-width="1.5"/><circle cx="18" cy="10" r="4.5" fill="none" stroke="#0E8F8E" stroke-width="1.5"/></svg>\n'
MOTION_CSS = """/* The Kitty motion: finite, meaningful, off under reduced motion. Classes are added by motion.js on an event, never on load. */
@keyframes k-beckon{0%{transform:rotate(0)}25%{transform:rotate(-12deg)}50%{transform:rotate(9deg)}75%{transform:rotate(-7deg)}100%{transform:rotate(0)}}
@keyframes k-wag{0%,100%{transform:rotate(0)}25%{transform:rotate(-16deg)}75%{transform:rotate(14deg)}}
@keyframes k-fall{0%{transform:translateY(-10vh) rotate(0) scale(.9);opacity:0}10%{opacity:1}100%{transform:translateY(110vh) rotate(var(--spin,360deg)) scale(1);opacity:.9}}
@keyframes k-pop{0%{transform:scale(.6);opacity:0}60%{transform:scale(1.08);opacity:1}100%{transform:scale(1)}}
.beckon .k-paw{animation:k-beckon 1.6s cubic-bezier(.34,1.4,.4,1) 1}
.wag .k-tail{animation:k-wag .9s ease-in-out 2}
.k-rain{position:fixed;inset:0;pointer-events:none;z-index:90;overflow:hidden}
.k-rain>span{position:absolute;top:0;left:var(--x);width:var(--w,24px);animation:k-fall var(--t,1.6s) cubic-bezier(.3,.1,.7,1) var(--d,0s) 1 forwards;opacity:0}
.k-rain>span svg{width:100%;height:auto;display:block;filter:drop-shadow(0 2px 2px rgba(0,0,0,.15))}
.k-fortune{position:relative;display:grid;place-items:center;width:200px;max-width:100%;margin:0 auto;cursor:pointer;border:0;background:none;padding:0}
.k-fortune svg{width:100%;height:auto}
.k-fortune .k-slip{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) scaleX(0);transform-origin:50% 50%;width:62%;font:600 13px/1.25 var(--body,system-ui);color:#17122B;text-align:center;opacity:0;transition:transform .5s .35s cubic-bezier(.2,.8,.2,1),opacity .2s .4s}
.k-fortune.open .k-slip{transform:translate(-50%,-50%) scaleX(1);opacity:1}
.k-fortune:focus-visible{outline:2px solid var(--accent,#5B3DF5);outline-offset:4px;border-radius:12px}
.k-mascot{display:block;width:120px;height:120px}
@media (prefers-reduced-motion:reduce){.beckon .k-paw,.wag .k-tail,.k-rain>span{animation:none}.k-rain>span{display:none}.k-fortune .k-slip,.k-fortune svg .half,.k-fortune svg .slip{transition:none}}
"""
MOTION_JS = """// The Kitty motion helpers. Dependency-free. Each one is finite, fires on an event, and is a no-op under reduced motion
// except the fortune slip, which still shows its text. Usage: KittyMotion.beckon(el); KittyMotion.rain(); KittyMotion.fortune(btn, text).
(function (root) {
  const reduced = () => root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const once = (el, cls, ms) => { if (!el || reduced()) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); setTimeout(() => el.classList.remove(cls), ms); };
  const COIN = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#C98A14"/><circle cx="12" cy="11" r="10" fill="#F2B134"/><rect x="8.5" y="7.5" width="7" height="7" rx="1.2" fill="#C98A14"/></svg>';
  const NOTE = '<svg viewBox="0 0 36 20" aria-hidden="true"><rect width="36" height="20" rx="3" fill="#8DE3C8"/><rect x="2" y="2" width="32" height="16" rx="2" fill="none" stroke="#0E8F8E" stroke-width="1.5"/><circle cx="18" cy="10" r="4.5" fill="none" stroke="#0E8F8E" stroke-width="1.5"/></svg>';
  const K = {
    // The lucky cat beckons once: good news only (goal reached, month closed, import done). Never on load.
    beckon(el) { once(el, "beckon", 1700); },
    // The dog wags twice: the dog brand's equivalent.
    wag(el) { once(el, "wag", 1900); },
    // Coins and notes fall for about two seconds: money milestones only. Returns a promise that resolves when done.
    rain(opts = {}) {
      if (reduced()) return Promise.resolve();
      const n = opts.count || 18, notes = opts.notes !== false, host = opts.host || document.body;
      const box = document.createElement("div"); box.className = "k-rain"; box.setAttribute("aria-hidden", "true");
      for (let i = 0; i < n; i++) {
        const s = document.createElement("span"); const isNote = notes && i % 3 === 0;
        s.innerHTML = isNote ? NOTE : COIN;
        s.style.setProperty("--x", (4 + Math.random() * 92) + "%");
        s.style.setProperty("--w", (isNote ? 30 + Math.random() * 14 : 16 + Math.random() * 14) + "px");
        s.style.setProperty("--t", (1.4 + Math.random() * 1.1) + "s");
        s.style.setProperty("--d", (Math.random() * .6) + "s");
        s.style.setProperty("--spin", (Math.random() < .5 ? "-" : "") + (180 + Math.random() * 540) + "deg");
        box.appendChild(s);
      }
      host.appendChild(box);
      return new Promise((res) => setTimeout(() => { box.remove(); res(); }, 3400));
    },
    // A fortune cookie (or the dog's biscuit) that cracks to reveal one line: the Kitty's proposal or insight.
    // `btn` is a button.k-fortune holding the cookie svg; `text` is the line. The cookie opens on click; `onOpen` fires once.
    fortune(btn, text, onOpen) {
      if (!btn) return; let slip = btn.querySelector(".k-slip");
      if (!slip) { slip = document.createElement("span"); slip.className = "k-slip"; btn.appendChild(slip); }
      slip.textContent = text; btn.classList.remove("open"); const svg = btn.querySelector("svg"); if (svg) svg.classList.remove("open");
      btn.setAttribute("aria-label", "Crack the cookie to read the Kitty's suggestion");
      const open = () => { if (btn.classList.contains("open")) return; btn.classList.add("open"); if (svg) svg.classList.add("open"); btn.setAttribute("aria-label", text); if (onOpen) onOpen(); };
      btn.onclick = open; if (reduced()) open();
      return open;
    },
  };
  root.KittyMotion = K;
})(window);
"""

# ---------------------------------------------------------------- illustrations: 320x200 scenes with the mascot
def mascot_inline(kind, x, y, scale):
    src = CAT if kind == "cat" else DOG
    inner = re.sub(r"^<svg[^>]*>", "", src.strip()); inner = inner[: inner.rfind("</svg>")]
    inner = inner.replace("kc-", f"{kind}{x}-").replace("kd-", f"{kind}{x}-")
    return f'<g transform="translate({x} {y}) scale({scale})">{inner}</g>'
def illustration(kind, scene):
    m = mascot_inline(kind, 20, 20, 1)
    ink = 'fill="none" stroke="var(--ink2,#443D5C)" stroke-width="3" stroke-linecap="round" stroke-dasharray="1 8"'
    muted = 'stroke="var(--muted,#6E6785)"'
    scenes = {
      "empty-activity": ("Nothing here yet: the first import fills this list.", f'{m}<g {ink}><path d="M200 60h90M200 90h70M200 120h90M200 150h60"/></g><g transform="translate(176 48)"><rect width="18" height="18" rx="5" fill="var(--surface2,#F1EDE5)"/></g><g transform="translate(176 78)"><rect width="18" height="18" rx="5" fill="var(--surface2,#F1EDE5)"/></g><g transform="translate(176 108)"><rect width="18" height="18" rx="5" fill="var(--surface2,#F1EDE5)"/></g><g transform="translate(176 138)"><rect width="18" height="18" rx="5" fill="var(--surface2,#F1EDE5)"/></g>'),
      "all-reviewed": ("Everything is reviewed.", f'{m}<circle cx="246" cy="98" r="44" fill="var(--good-soft,#DFF5E9)"/><path d="M226 100l13 13 28-30" fill="none" stroke="var(--good,#17986A)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>'),
      "empty-goals": ("No goal yet: name one and the ring starts filling.", f'{m}<g fill="none" {muted} stroke-width="3"><circle cx="246" cy="100" r="46" stroke-dasharray="4 10"/><circle cx="246" cy="100" r="26" stroke-dasharray="4 10"/></g><circle cx="246" cy="100" r="6" fill="var(--accent,#5B3DF5)"/>'),
      "connect-sheet": ("Connect a sheet and the page comes alive.", f'{m}<g transform="translate(196 50)"><rect width="100" height="96" rx="12" fill="var(--surface,#fff)" stroke="var(--line,#E5DFD4)" stroke-width="2"/><g stroke="var(--line,#E5DFD4)" stroke-width="2"><path d="M0 32h100M0 64h100M34 0v96M67 0v96"/></g><rect x="4" y="4" width="92" height="22" rx="6" fill="var(--good-soft,#DFF5E9)"/></g><path d="M150 112c20-10 30-10 46-4" fill="none" stroke="var(--accent,#5B3DF5)" stroke-width="3" stroke-dasharray="2 7" stroke-linecap="round"/>'),
    }
    cap, body = scenes[scene]
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" width="320" height="200" role="img" aria-label="{cap}">{body}</svg>\n'

# ---------------------------------------------------------------- write everything
def build():
    for d in ["icons", "cat", "dog", "motion", "illustrations"]:
        shutil.rmtree(os.path.join(HERE, d), ignore_errors=True)
    sprite = ['<svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">']
    meta = {}
    for name, (sem, inner) in ICONS.items():
        w(f"icons/{name}.svg", icon_svg(name, inner))
        sprite.append(f'<symbol id="i-{name}" viewBox="0 0 24 24">{inner}</symbol>')
        meta[name] = sem
    sprite.append("</svg>")
    w("icons/sprite.svg", "\n".join(sprite) + "\n")
    w("icons/icons.json", json.dumps({"grid": 24, "stroke": 2, "caps": "round", "fill": "none unless the icon is a solid mark", "use": "<svg><use href=\"#i-name\"/></svg> after inlining sprite.svg, or the file itself", "icons": meta}, indent=1) + "\n")
    w("cat/mascot.svg", CAT); w("dog/mascot.svg", DOG)
    w("cat/app-icon.svg", app_icon("cat")); w("dog/app-icon.svg", app_icon("dog"))
    w("motion/motion.css", MOTION_CSS); w("motion/motion.js", MOTION_JS)
    w("motion/fortune-cookie.svg", COOKIE); w("motion/biscuit.svg", BISCUIT); w("motion/coin.svg", COIN_SVG); w("motion/note.svg", NOTE_SVG)
    for kind in ["cat", "dog"]:
        for scene in ["empty-activity", "all-reviewed", "empty-goals", "connect-sheet"]:
            w(f"illustrations/{kind}-{scene}.svg", illustration(kind, scene))
    w("index.html", contact_sheet(meta))
    pngs()

def pngs():
    if not os.path.exists(CHROME): print("Chrome not found; PNG app icons skipped"); return
    for kind in ["cat", "dog"]:
        html = os.path.join(HERE, f"{kind}/_icon.html")
        w(f"{kind}/_icon.html", f'<!doctype html><meta charset="utf-8"><style>html,body{{margin:0;background:transparent}}</style><img src="app-icon.svg" width="1024" height="1024" style="display:block">')
        out = os.path.join(HERE, f"{kind}/app-icon-1024.png")
        subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--default-background-color=00000000", f"--screenshot={out}", "--window-size=1024,1024", f"file://{html}"], capture_output=True, timeout=60)
        os.remove(html)
        if os.path.exists(out):
            for s in [512, 256, 192, 180, 128, 64, 48, 32, 16]:
                subprocess.run(["sips", "-z", str(s), str(s), out, "--out", os.path.join(HERE, f"{kind}/app-icon-{s}.png")], capture_output=True)
            print(f"{kind}: app icon PNGs written")

def contact_sheet(meta):
    groups = [("Navigation and controls", ["paw","home","list","receipt","insights","goal","save","things","setup","search","spark","x","chev","back","check","share","plus","refresh","dl","filter","calendar","clock","edit","note","info","warning","lock","sun","moon","eye","person","people","sheet","link","trash"]),
              ("Money and rows", ["cash","card","bank","wallet","stack","coin","transfer","income","spend","recurring","refund","split","duplicate","pending","new","review","worth","rule","fortune","fees","interest"]),
              ("Domains", ["property","property-invest","loan","offset","shares","rsu","crypto","super","smsf","insurance","health","car","laptop","phone","cycle","tax","folder","cat","dog"]),
              ("Spending categories", ["groceries","dining","coffee","transport","fuel","utilities","shopping","clothing","gifts","travel","entertainment","fitness","kids","work","giving","tools","education","beauty","pets","salary"])]
    cells = ""
    for title, names in groups:
        cells += f'<h2>{title}</h2><div class="grid">' + "".join(f'<div class="cell" title="{meta[n]}"><svg width="24" height="24"><use href="#i-{n}"/></svg><span>{n}</span><small>{meta[n]}</small></div>' for n in names) + "</div>"
    sprite = open(os.path.join(HERE, "icons/sprite.svg")).read()
    ill = "".join(f'<figure><img src="illustrations/{k}-{s}.svg" alt=""><figcaption>{k}: {s}</figcaption></figure>' for k in ["cat","dog"] for s in ["empty-activity","all-reviewed","empty-goals","connect-sheet"])
    return f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>The Kitty brand kit</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&family=DM+Sans:opsz,wght@9..40,400;9..40,600&display=swap">
<link rel="stylesheet" href="motion/motion.css">
<style>
:root{{--bg:#F7F4EE;--surface:#fff;--surface2:#F1EDE5;--ink:#17122B;--ink2:#443D5C;--muted:#6E6785;--line:#E5DFD4;--accent:#5B3DF5;--good:#17986A;--good-soft:#DFF5E9;--display:"Bricolage Grotesque",system-ui,sans-serif;--body:"DM Sans",system-ui,sans-serif}}
[data-theme=dark]{{--bg:#0F0C1B;--surface:#1A1530;--surface2:#231D3C;--ink:#F3F0FF;--ink2:#CBC4E3;--muted:#9F97BE;--line:#2C2546;--accent:#8F7BFF;--good:#3BCB8F;--good-soft:#15362A;color-scheme:dark}}
body{{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 var(--body);padding:24px max(16px,env(safe-area-inset-left)) 64px}}
h1{{font:800 34px/1.1 var(--display);margin:0 0 4px}}h2{{font:700 20px/1.2 var(--display);margin:36px 0 12px}}p.lede{{color:var(--ink2);max-width:62ch;margin:0 0 16px}}
.bar{{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:12px 0 20px}}button{{font:600 14px var(--body);padding:8px 14px;border-radius:999px;border:1px solid var(--line);background:var(--surface);color:var(--ink);cursor:pointer}}button:hover{{border-color:var(--accent)}}
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}}.cell{{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:12px;display:grid;gap:4px;justify-items:start}}.cell span{{font-weight:600;font-size:13px}}.cell small{{color:var(--muted);font-size:11.5px;line-height:1.3}}
.row{{display:flex;gap:24px;flex-wrap:wrap;align-items:flex-end}}.card{{background:var(--surface);border:1px solid var(--line);border-radius:22px;padding:20px;display:grid;gap:10px;justify-items:center}}
.sizes img{{vertical-align:bottom;margin-right:10px}}figure{{margin:0;background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:10px}}figure img{{width:100%;height:auto;display:block}}figcaption{{font-size:12px;color:var(--muted);padding:6px 4px 0}}
.ill{{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px}}
.tok{{display:flex;gap:8px;flex-wrap:wrap}}.tok i{{display:inline-grid;place-items:end start;width:96px;height:64px;border-radius:12px;font:11px var(--body);padding:6px;color:#fff;font-style:normal}}
</style></head><body>
{sprite}
<h1>The Kitty brand kit</h1><p class="lede">Cat is the default; the dog set swaps in with one build flag. Motion is finite and only ever follows good news. No real bank marks anywhere.</p>
<div class="bar"><button onclick="document.documentElement.toggleAttribute('data-theme')||document.documentElement.setAttribute('data-theme','dark')">Toggle dark</button>
<button onclick="KittyMotion.beckon(document.getElementById('cat'))">Beckon</button><button onclick="KittyMotion.wag(document.getElementById('dog'))">Wag</button><button onclick="KittyMotion.rain()">Coins and notes</button></div>
<h2>Mascots</h2><div class="row">
<div class="card"><div id="cat" style="width:200px"><img src="cat/mascot.svg" alt="" width="200" height="200" style="display:none">{CAT.replace('width="160" height="160"','width="200" height="200"')}</div><span>Cat, the lucky one (default)</span></div>
<div class="card"><div id="dog" style="width:200px">{DOG.replace('width="160" height="160"','width="200" height="200"')}</div><span>Dog, the loyal one</span></div>
<div class="card"><button class="k-fortune" id="fc" aria-label="Crack the cookie">{COOKIE}</button><span>Fortune cookie: the Kitty's proposal</span></div>
<div class="card"><button class="k-fortune" id="fb" aria-label="Crack the biscuit">{BISCUIT}</button><span>Biscuit: the dog set's cookie</span></div>
</div>
<h2>App icons</h2><div class="row"><div class="card sizes"><div><img src="cat/app-icon.svg" width="128" height="128"><img src="cat/app-icon.svg" width="64" height="64"><img src="cat/app-icon.svg" width="32" height="32"><img src="cat/app-icon.svg" width="16" height="16"></div><span>cat</span></div>
<div class="card sizes"><div><img src="dog/app-icon.svg" width="128" height="128"><img src="dog/app-icon.svg" width="64" height="64"><img src="dog/app-icon.svg" width="32" height="32"><img src="dog/app-icon.svg" width="16" height="16"></div><span>dog</span></div></div>
<h2>Mascot tokens</h2><div class="tok"><i style="background:#FBF4E6;color:#17122B">head</i><i style="background:#F1E6D2;color:#17122B">body</i><i style="background:#F0533D">patch</i><i style="background:#5B3DF5">collar</i><i style="background:#F2B134;color:#17122B">gold</i><i style="background:#E8B877;color:#17122B">tan (dog)</i><i style="background:#FF9E8C;color:#17122B">blush</i><i style="background:#17122B">ink</i></div>
{cells}
<h2>Empty states</h2><div class="ill">{ill}</div>
<script src="motion/motion.js"></script>
<script>KittyMotion.fortune(document.getElementById('fc'), 'WOOLWORTHS METRO 1234 looks like Groceries. Make it a rule?'); KittyMotion.fortune(document.getElementById('fb'), 'Your Japan saver reached its target three months early.');</script>
</body></html>
'''

if __name__ == "__main__":
    build(); print("brand kit built:", len(ICONS), "icons")
