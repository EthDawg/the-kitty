"""Render every Davies receipt as the file a household would have.

    python3 evidence/receipts-test/render.py            # all 95 files
    python3 evidence/receipts-test/render.py R0071 ...  # just these receipts

Reads data/groceries/sealed/key.json (made by data/groceries/generate.py) and writes evidence/receipts-test/files/:
  in-store dockets   photo-like JPEGs: thermal font on narrow paper, slight rotation and keystone, shadow, uneven light,
                     a few crumpled; one smudged and shot sideways; one docket photographed twice
  online orders      PDF tax invoices (HTML printed by headless Chrome)
  e-receipts         PDFs of the email
Every file says FICTIONAL TEST RECEIPT at top and bottom, uses ABN 00 000 000 000 and no logos.
Needs Pillow and Google Chrome. Deterministic: each receipt seeds its own random stream.
"""
import json, math, random, subprocess, sys, tempfile, html, datetime as dt
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops, ImageOps

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
KEY = json.loads((REPO / "data/groceries/sealed/key.json").read_text())
OUT = HERE / "files"
OUT.mkdir(exist_ok=True)
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
FONT = "/System/Library/Fonts/Menlo.ttc"
W = 42  # characters per docket line (80 mm paper)
FICT = "FICTIONAL TEST RECEIPT"
D = dt.date.fromisoformat


def money(x):
    return f"{x:.2f}"


def lr(left, right, width=W):
    gap = width - len(left) - len(right)
    if gap < 1:
        left = left[: width - len(right) - 1]
        gap = 1
    return left + " " * gap + right


def center(s, width=W):
    return s.center(width).rstrip()


def dmy(iso):
    return D(iso).strftime("%d/%m/%Y")


# ---------------------------------------------------------------------------------------------------------------
# Docket text: a list of (text, style); style n normal, b bold, big double size, c centred
def tender_lines(rc, width=W):
    out = []
    for kind, last4, amt, extra in rc["tender"] or []:
        if kind == "CASH":
            out += [(lr("CASH", money(amt / 100), width), "n"), (lr("CHANGE", money(extra / 100), width), "n")]
        elif kind == "GIFT CARD":
            out += [(lr(f"GIFT CARD ****{last4}", money(amt / 100), width), "n"),
                    (lr("GIFT CARD BALANCE", money(extra / 100), width), "n")]
        elif kind == "MASTERCARD REFUND":
            out += [(lr(f"MASTERCARD REFUND ****{last4}", money(amt / 100), width), "n")]
        else:
            out += [(lr(f"MASTERCARD ****{last4}", money(amt / 100), width), "n")]
    return out


def eftpos_slip(rc, r, width=W):
    cards = [t for t in rc["tender"] or [] if t[0].startswith("MASTERCARD")]
    if not cards:
        return []
    kind, last4, amt, _ = cards[0]
    refund = "REFUND" in kind
    return [("", "n"), (center("CUSTOMER COPY", width), "n"), (center("MASTERCARD CREDIT", width), "n"),
            (lr("CARD", "************" + last4, width), "n"),
            (lr("REFUND AUD" if refund else "PURCHASE AUD", "$" + money(amt / 100), width), "b"),
            (lr("APPROVED 00", f"AUTH {r.randint(100000, 999999)}", width), "n")]


def docket_lines(rc, r):
    s = rc["store_code"]
    lines = rc["lines"]
    refund = any(l["qty"] == -1 for l in lines) and float(rc["Total"]) < 0
    out = [(center(FICT), "b"), ("", "n")]
    if s == "M":
        width = 32
        out = [(center(FICT, width), "b"), ("", "n"), (center("Merri Growers Market", width), "b"),
               (center(rc["Store"], width), "b"), (center("ABN 00 000 000 000", width), "n"),
               (center("Tax invoice", width), "n"), (center(f"{dmy(rc['Date'])} {rc['Time']}", width), "n"),
               ("-" * width, "n")]
        for l in lines:
            if l["unit"] == "kg":
                out += [(l["printed"], "n"),
                        (lr(f"  {l['qty']:.3f}kg @ ${money(l['unit_price'])}/kg", money(l["amount"]), width), "n")]
            elif l["qty"] > 1:
                out += [(l["printed"], "n"), (lr(f"  {l['qty']} @ ${money(l['unit_price'])}", money(l["amount"]), width), "n")]
            else:
                out += [(lr(l["printed"], money(l["amount"]), width), "n")]
        out += [("-" * width, "n"), (lr("TOTAL", "$" + rc["Total"], width // 2), "big")]
        out += tender_lines(rc, width)
        out += [(lr("GST incl.", rc["GST"], width), "n"), ("", "n"), (center("Thank you, see you Saturday", width), "n"),
                ("", "n"), (center(FICT, width), "b")]
        return out, width
    head = {"W": ["Woolworths Brunswick"], "C": ["Coles Supermarkets", "Coburg"], "A": ["ALDI Stores", "Coburg"]}[s]
    for i, h in enumerate(head):
        out.append((center(h, W // 2), "big") if i == 0 else (center(h), "b"))
    out += [(center("ABN 00 000 000 000"), "n")]
    if s in "WC":
        out += [(center(f"Store {rc['store_no']}  Ph (03) 0000 0000"), "n")]
    out += [(center("TAX INVOICE"), "b")]
    if refund:
        out += [(center("*** REFUND ***", W // 2), "big")]
    out += [("-" * W, "n")]
    for l in lines:
        tax = l["gst"] == "Taxable"
        amt = money(l["amount"])
        if s == "W":
            mark = "#" if tax else " "
            name = mark + l["printed"]
            if l["kind"] == "Discount":
                out.append((lr("   " + l["printed"], amt), "n"))
            elif l["kind"] == "Fee" and l["qty"] > 1:
                out += [(name, "n"), (lr(f"   {l['qty']} @ ${money(l['unit_price'])} EACH", amt), "n")]
            elif l["unit"] == "kg" and l.get("tare_kg"):
                out += [(name, "n"), (f"   GROSS {l['gross_kg']:.3f} kg  TARE {l['tare_kg']:.3f} kg", "n"),
                        (lr(f"   {l['qty']:.3f} kg NET @ ${money(l['unit_price'])}/kg", amt), "n")]
            elif l["unit"] == "kg":
                out += [(name, "n"), (lr(f"   {l['qty']:.3f} kg NET @ ${money(l['unit_price'])}/kg", amt), "n")]
            elif l["qty"] != 1:
                out += [(name, "n"), (lr(f"   {l['qty']} @ ${money(l['unit_price'])} EACH", amt), "n")]
            else:
                out.append((lr(name, amt), "n"))
        elif s == "C":
            right = amt + (" %" if tax else "  ")
            if l["kind"] == "Discount":
                out.append((lr("   " + l["printed"], right), "n"))
            elif l["kind"] == "Fee" and l["qty"] > 1:
                out += [(l["printed"], "n"), (lr(f"   {l['qty']} @ ${money(l['unit_price'])}", right), "n")]
            elif l["unit"] == "kg" and l.get("tare_kg"):
                out += [(l["printed"], "n"), (f"   GROSS {l['gross_kg']:.3f}kg TARE {l['tare_kg']:.3f}kg", "n"),
                        (lr(f"   NET {l['qty']:.3f}kg @ ${money(l['unit_price'])}/kg", right), "n")]
            elif l["unit"] == "kg":
                out += [(l["printed"], "n"), (lr(f"   {l['qty']:.3f}kg NET @ ${money(l['unit_price'])}/kg", right), "n")]
            elif l["qty"] != 1:
                out += [(l["printed"], "n"), (lr(f"   {l['qty']} @ ${money(l['unit_price'])}", right), "n")]
            else:
                out.append((lr(l["printed"], right), "n"))
        else:  # ALDI: article code, A = GST 10%, B = GST free
            right = amt + (" A" if tax else " B")
            name = f"{l['code']} {l['printed']}"
            if l["unit"] == "kg":
                out += [(name, "n"), (lr(f"   {l['qty']:.3f} kg x {money(l['unit_price'])} /kg", right), "n")]
            elif l["qty"] != 1:
                out += [(name, "n"), (lr(f"   {l['qty']} x {money(l['unit_price'])}", right), "n")]
            else:
                out.append((lr(name, right), "n"))
    out.append(("-" * W, "n"))
    if not refund:
        out.append((lr(f"{rc['Items']} ITEMS", ""), "n") if s != "W" else (f"TOTAL FOR {rc['Items']} ITEMS", "n"))
        out.append((lr("TOTAL", "$" + rc["Total"], W // 2), "big"))
    else:
        out.append((lr("TOTAL REFUND", "-$" + money(-float(rc["Total"])), W // 2), "big"))
    out += tender_lines(rc)
    if s == "A":
        lines_t = sum(l["amount"] for l in lines if l["gst"] == "Taxable")
        lines_f = sum(l["amount"] for l in lines if l["gst"] != "Taxable")
        gst = float(rc["GST"])
        out += [("", "n"), (lr("     GST%", "NET      GST    GROSS"), "n"),
                (lr("A    10%", f"{money(lines_t - gst):>7} {money(gst):>7} {money(lines_t):>8}"), "n"),
                (lr("B     0%", f"{money(lines_f):>7} {'0.00':>7} {money(lines_f):>8}"), "n")]
    else:
        out.append((lr("GST INCLUDED IN TOTAL", ("-" if refund else "") + money(abs(float(rc["GST"])))), "n"))
        if float(rc["Savings"]) > 0:
            out.append((lr("TOTAL SAVINGS", rc["Savings"]), "b"))
        out.append((("# Denotes taxable item, GST included" if s == "W" else "% Denotes item includes GST"), "n"))
    if refund:
        out += [("", "n"), (f"Original purchase {dmy(rc['refund_of_date'])}", "n"), ("Reason: unopened, changed mind", "n")]
    out += [("-" * W, "n")]
    if s == "W":
        out.append((f"REWARDS CARD ****8823", "n"))
        if not refund:
            pts = int(float(rc["Total"]))
            out.append((lr("POINTS EARNED THIS SHOP", str(pts)), "n"))
    out += [(lr(f"{dmy(rc['Date'])} {rc['Time']}", f"LANE {r.randint(1, 9)}  OP {r.randint(100, 499)}"), "n"),
            (lr("TRANS " + str(r.randint(1000, 9999)).zfill(6), ""), "n")]
    out += eftpos_slip(rc, r)
    out += [("", "n"), (center("Thank you for shopping with us"), "n"), ("", "n"), (center(FICT), "b")]
    return out, W


# ---------------------------------------------------------------------------------------------------------------
# Paper and photo
def font(size, bold=False):
    return ImageFont.truetype(FONT, size, index=1 if bold else 0)


def draw_paper(text_lines, width_chars, r, fade=1.0):
    fs = 13
    f, fb, fbig = font(fs), font(fs, True), font(fs * 2 - 3, True)
    cw = f.getlength("M")
    lh = 16
    margin = 14
    pw = int(width_chars * cw + 2 * margin)
    heights = [lh * 2 if st == "big" else lh for _, st in text_lines]
    ph = sum(heights) + 2 * margin + 30
    ink = Image.new("L", (pw, ph), 0)
    dr = ImageDraw.Draw(ink)
    y = margin + 10
    for (t, st), h in zip(text_lines, heights):
        level = int(255 * fade * r.uniform(0.82, 1.0))
        if st == "big":
            # double-width, double-height like a thermal printer's emphasised mode; the text is laid out at half width
            tmp = Image.new("L", (int(width_chars / 2 * cw) + 2, lh), 0)
            ImageDraw.Draw(tmp).text((0, 0), t, font=fb, fill=level)
            tmp = tmp.resize((tmp.width * 2, lh * 2), Image.NEAREST)
            ink.paste(tmp, (margin, y), tmp)
        else:
            dr.text((margin, y), t, font=fb if st == "b" else f, fill=level)
        y += h
    # thermal dots: down then up with nearest, then soften
    small = ink.resize((pw // 2 * 2, ph // 2 * 2))
    ink = small.resize((pw * 2, ph * 2), Image.NEAREST).filter(ImageFilter.GaussianBlur(0.9))
    # uneven head heat: faint vertical streaks
    streak = Image.effect_noise((ink.width // 6, 1), 40).resize(ink.size, Image.BILINEAR)
    streak = streak.point(lambda v: 200 + int(v / 255 * 55))
    ink = ImageChops.multiply(ink, streak)
    paper_rgb = (r.randint(244, 251), r.randint(242, 248), r.randint(234, 242))
    ink_rgb = (r.randint(28, 50), r.randint(28, 48), r.randint(34, 58))
    paper = Image.new("RGB", ink.size, paper_rgb)
    inkc = Image.new("RGB", ink.size, ink_rgb)
    paper = Image.composite(inkc, paper, ink)
    grain = Image.effect_noise(ink.size, 18).convert("RGB")
    paper = Image.blend(paper, ImageChops.multiply(paper, ImageOps.autocontrast(grain).point(lambda v: 225 + v // 9)), 0.5)
    return paper


def crumple(paper, r, strength=1.0):
    w, h = paper.size
    # smooth light and dark patches
    sw, sh = max(2, w // 70), max(2, h // 70)
    low = Image.new("L", (sw, sh))
    low.putdata([int(r.uniform(150, 255)) for _ in range(sw * sh)])
    shade = low.resize((w, h), Image.BICUBIC).filter(ImageFilter.GaussianBlur(10))
    shade = shade.point(lambda v: int(205 + (v - 150) / 105 * 50 * strength) if v > 150 else 205)
    # a few creases
    dr = ImageDraw.Draw(shade)
    for _ in range(r.randint(3, 7)):
        y0 = r.randint(0, h)
        y1 = y0 + r.randint(-h // 8, h // 8)
        dr.line([(0, y0), (w, y1)], fill=r.randint(150, 190), width=r.randint(2, 4))
    for _ in range(r.randint(1, 3)):
        x0 = r.randint(w // 5, 4 * w // 5)
        dr.line([(x0, 0), (x0 + r.randint(-w // 5, w // 5), h)], fill=r.randint(160, 200), width=2)
    shade = shade.filter(ImageFilter.GaussianBlur(2.2))
    paper = ImageChops.multiply(paper, Image.merge("RGB", [shade] * 3))
    # mesh warp
    gx, gy = 6, max(8, h // 160)
    cw, ch = w / gx, h / gy
    jit = {}
    for i in range(gx + 1):
        for j in range(gy + 1):
            edge = i in (0, gx)
            jit[(i, j)] = (i * cw + (0 if edge else r.uniform(-4, 4) * strength), j * ch + r.uniform(-4, 4) * strength)
    mesh = []
    for i in range(gx):
        for j in range(gy):
            box = (int(i * cw), int(j * ch), int((i + 1) * cw), int((j + 1) * ch))
            q = jit[(i, j)] + jit[(i, j + 1)] + jit[(i + 1, j + 1)] + jit[(i + 1, j)]
            mesh.append((box, q))
    return paper.transform(paper.size, Image.MESH, mesh, Image.BICUBIC)


def smudge(paper, r):
    w, h = paper.size
    # a wet-thumb smear across the middle third, plus a tea ring; total and dates stay readable
    y0 = int(h * r.uniform(0.33, 0.42))
    band = paper.crop((0, y0, w, y0 + int(h * 0.09))).filter(ImageFilter.GaussianBlur(3.2))
    band = Image.blend(band, Image.new("RGB", band.size, (232, 226, 210)), 0.35)
    mask = Image.new("L", band.size, 0)
    ImageDraw.Draw(mask).ellipse((-w * 0.1, 0, w * 1.05, band.height), fill=230)
    paper.paste(band, (0, y0), mask.filter(ImageFilter.GaussianBlur(14)))
    ring = Image.new("L", paper.size, 0)
    cx, cy, rad = int(w * 0.62), int(h * 0.22), int(w * 0.23)
    ImageDraw.Draw(ring).ellipse((cx - rad, cy - rad, cx + rad, cy + rad), outline=110, width=9)
    ring = ring.filter(ImageFilter.GaussianBlur(4))
    stain = Image.new("RGB", paper.size, (170, 120, 70))
    return Image.composite(stain, paper, ring.point(lambda v: v // 2))


def solve8(src, dst):
    """Perspective coefficients mapping output (dst) to input (src) points."""
    A, b = [], []
    for (x, y), (u, v) in zip(dst, src):
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.append(u)
        A.append([0, 0, 0, x, y, 1, -v * x, -v * y]); b.append(v)
    n = 8
    M = [row + [bb] for row, bb in zip(A, b)]
    for c in range(n):
        p = max(range(c, n), key=lambda i: abs(M[i][c]))
        M[c], M[p] = M[p], M[c]
        for i in range(n):
            if i != c:
                f = M[i][c] / M[c][c]
                M[i] = [a - f * bb for a, bb in zip(M[i], M[c])]
    return [M[i][n] / M[i][i] for i in range(n)]


def background(size, r):
    w, h = size
    kind = r.choice(["bench", "wood", "dark", "bench"])
    base = {"bench": (r.randint(150, 180), r.randint(150, 175), r.randint(148, 170)),
            "wood": (r.randint(120, 150), r.randint(82, 100), r.randint(52, 66)),
            "dark": (r.randint(40, 60), r.randint(42, 58), r.randint(46, 64))}[kind]
    img = Image.new("RGB", size, base)
    if kind == "wood":
        g = Image.effect_noise((w // 40 + 2, h), 60).resize((w, h), Image.BICUBIC).filter(ImageFilter.GaussianBlur(1.5))
    else:
        g = Image.effect_noise((w // 25 + 2, h // 25 + 2), 50).resize((w, h), Image.BICUBIC)
    g = g.point(lambda v: 200 + v // 5)
    img = ImageChops.multiply(img, Image.merge("RGB", [g] * 3))
    fine = Image.effect_noise(size, 30).point(lambda v: 225 + v // 9)
    return ImageChops.multiply(img, Image.merge("RGB", [fine] * 3))


def photograph(paper, r, angle=None, sideways=False, tight=None):
    w, h = paper.size
    # keystone: the phone was a little closer to the bottom of the docket
    k = r.uniform(0.0, 0.035) * w
    sk = r.uniform(-0.02, 0.02) * w
    dst = [(0, 0), (w, 0), (w, h), (0, h)]
    src = [(-k + sk, 0), (w + k + sk, 0), (w, h), (0, h)]
    coeffs = solve8(src, dst)
    alpha = Image.new("L", paper.size, 255)
    paper = paper.transform(paper.size, Image.PERSPECTIVE, coeffs, Image.BICUBIC, fillcolor=(0, 0, 0))
    alpha = alpha.transform(paper.size, Image.PERSPECTIVE, coeffs, Image.BICUBIC, fillcolor=0)
    a = angle if angle is not None else r.uniform(-2.5, 2.5)
    paper = paper.rotate(a, Image.BICUBIC, expand=True)
    alpha = alpha.rotate(a, Image.BICUBIC, expand=True)
    pad = tight if tight is not None else r.uniform(0.07, 0.16)
    bw, bh = int(paper.width * (1 + 2 * pad)) + 40, int(paper.height * (1 + pad)) + 60
    bg = background((bw, bh), r)
    ox, oy = (bw - paper.width) // 2 + r.randint(-15, 15), (bh - paper.height) // 2 + r.randint(-10, 10)
    shadow = Image.new("L", (bw, bh), 0)
    shadow.paste(alpha, (ox + r.randint(8, 22), oy + r.randint(10, 26)))
    shadow = shadow.filter(ImageFilter.GaussianBlur(18)).point(lambda v: int(v * 0.55))
    bg = Image.composite(Image.new("RGB", bg.size, (15, 15, 18)), bg, shadow)
    bg.paste(paper, (ox, oy), alpha)
    # light falls off from one corner
    lw, lhh = 4, 6
    low = Image.new("L", (lw, lhh))
    cx, cy = r.uniform(0, lw), r.uniform(0, lhh)
    low.putdata([int(255 - min(110, 26 * math.hypot(x - cx, y - cy))) for y in range(lhh) for x in range(lw)])
    light = low.resize(bg.size, Image.BICUBIC).filter(ImageFilter.GaussianBlur(40))
    bg = ImageChops.multiply(bg, Image.merge("RGB", [light] * 3))
    if sideways:
        bg = bg.rotate(90, expand=True)
    noise = Image.effect_noise(bg.size, 14).point(lambda v: 232 + v // 11)
    bg = ImageChops.multiply(bg, Image.merge("RGB", [noise] * 3)).filter(ImageFilter.GaussianBlur(0.5))
    # phone cameras sharpen a little
    bg = bg.filter(ImageFilter.UnsharpMask(radius=1.2, percent=60, threshold=2))
    scale = min(1.0, 3200 / max(bg.size))
    if scale < 1:
        bg = bg.resize((int(bg.width * scale), int(bg.height * scale)), Image.LANCZOS)
    return bg


def render_docket(rc):
    r = random.Random(f"render-{rc['Receipt ID']}")
    text, width = docket_lines(rc, random.Random(f"slip-{rc['Receipt ID']}"))
    hints = rc.get("render") or {}
    fade = r.uniform(0.78, 1.0)
    paper = draw_paper(text, width, r, fade=fade)
    crumpled = hints.get("crumple") or r.random() < 0.22
    if crumpled:
        paper = crumple(paper, r, strength=r.uniform(0.7, 1.2))
    if hints.get("smudge"):
        paper = smudge(paper, r)
    files = rc["files"]
    img = photograph(paper, r, angle=r.uniform(4, 7) if hints.get("sideways") else None, sideways=hints.get("sideways", False))
    img.save(OUT / files[0], "JPEG", quality=r.randint(80, 88), optimize=True)
    if len(files) > 1:  # the same docket photographed again, a moment later, from another angle
        r2 = random.Random(f"render2-{rc['Receipt ID']}")
        img2 = photograph(paper, r2, angle=r2.uniform(-8, -5), tight=0.05)
        img2 = img2.point(lambda v: int(v * 0.93))
        img2.save(OUT / files[1], "JPEG", quality=83, optimize=True)
    return crumpled


# ---------------------------------------------------------------------------------------------------------------
# PDFs
CSS = """
@page { size: A4; margin: 14mm 14mm 16mm 14mm; }
body { font-family: Helvetica, Arial, sans-serif; font-size: 9.5pt; color: #1b1b1b; }
.fict { text-align: center; font-weight: bold; letter-spacing: .2em; border: 1.5px solid #222; padding: 4px; margin: 0 0 10px; }
h1 { font-size: 15pt; margin: 6px 0 2px; } h2 { font-size: 10.5pt; margin: 14px 0 4px; }
.meta { display: flex; gap: 30px; margin: 8px 0 10px; } .meta div { line-height: 1.45; }
table { width: 100%; border-collapse: collapse; } th { text-align: left; border-bottom: 1px solid #555; font-size: 8.5pt; padding: 3px 4px; }
td { padding: 2.5px 4px; border-bottom: .5px solid #ddd; vertical-align: top; } td.n, th.n { text-align: right; white-space: nowrap; }
.sub { color: #555; font-size: 8.5pt; } .grp td { font-weight: bold; background: #f1f1f1; border-bottom: none; padding-top: 6px; }
.tot td { border: none; padding: 2px 4px; } .tot .big td { font-size: 12pt; font-weight: bold; border-top: 1.5px solid #222; }
.small { font-size: 8pt; color: #444; margin-top: 10px; } pre { font-family: Menlo, monospace; font-size: 9pt; line-height: 1.32; }
.mail { border-bottom: 1px solid #bbb; padding-bottom: 8px; margin-bottom: 10px; font-size: 9pt; line-height: 1.5; }
"""


def h(s):
    return html.escape(str(s))


def invoice_html(rc, r):
    s = rc["store_code"]
    name = "Woolworths" if s == "W" else "Coles Supermarkets"
    inv_date = D(rc["Date"])
    placed = inv_date - dt.timedelta(days=r.randint(1, 3))
    deliver = rc["Channel"] == "Online delivery"
    hour = int(rc["Time"][:2])
    window = f"{max(7, hour - 1)}:00 to {max(7, hour - 1) + 2}:00" if deliver else f"after {max(8, hour - 1)}:00"
    lines = rc["lines"]
    star = "*" if s == "W" else "Y"
    rows, last_group = [], None
    for l in lines:
        if l["kind"] == "Item" and l["qty"] == 0:
            continue
        if l["kind"] == "Fee":
            continue
        if l["kind"] == "Item" and l["group"] != last_group:
            rows.append(f'<tr class="grp"><td colspan="6">{h(l["group"])}</td></tr>')
            last_group = l["group"]
        gst = (star if s == "W" else "Yes") if l["gst"] == "Taxable" else ("" if s == "W" else "No")
        if l["kind"] == "Discount":
            rows.append(f'<tr><td></td><td class="sub">{h(l["printed"])}</td><td class="n"></td><td class="n"></td>'
                        f'<td class="n">{money(l["amount"])}</td><td class="n">{gst}</td></tr>')
            continue
        if l["unit"] == "kg":
            qty = f'{l["qty"]:.3f} kg'
            price = f'${money(l["unit_price"])}/kg'
        else:
            qty = str(l["qty"])
            price = f'${money(l["unit_price"])}'
        extra = f'<div class="sub">Substitute supplied for: {h(l["sub_for"])}</div>' if l.get("sub_for") else ""
        rows.append(f'<tr><td>{h(l["code"])}</td><td>{h(l["printed"])}{extra}</td><td class="n">{qty}</td>'
                    f'<td class="n">{price}</td><td class="n">{money(l["amount"])}</td><td class="n">{gst}</td></tr>')
    oos = [l for l in lines if l["kind"] == "Item" and l["qty"] == 0]
    unavailable = ""
    if oos:
        unavailable = "<h2>Unavailable items (not supplied, not charged)</h2><table><tr><th>Code</th><th>Item</th><th class='n'>Ordered</th><th class='n'>Supplied</th><th class='n'>Amount</th></tr>" + "".join(
            f'<tr><td>{h(l["code"])}</td><td>{h(l["printed"])}</td><td class="n">1</td><td class="n">0</td><td class="n">0.00</td></tr>' for l in oos) + "</table>"
    fees = [l for l in lines if l["kind"] == "Fee"]
    items_total = sum(l["amount"] for l in lines if l["kind"] != "Fee")
    fee_rows = "".join(f'<tr><td>{h(l["printed"].title())}</td><td class="n">{money(l["amount"])} {star if s == "W" else ""}</td></tr>' for l in fees)
    legend = "* GST applies to this item. Prices include GST." if s == "W" else "GST column: Yes means the item includes GST."
    who = "Jordan Davies" if r.random() < 0.5 else "Mia Davies"
    return f"""<title>Tax invoice {rc['order_no']}</title><style>{CSS}</style>
<div class="fict">{FICT}</div>
<h1>{name} Online &mdash; Tax invoice</h1>
<div>ABN 00 000 000 000 &middot; Fulfilled by store {h(rc['store_no'])}, Brunswick</div>
<div class="meta"><div><b>Invoice date</b> {inv_date.strftime('%d/%m/%Y')} {rc['Time']}<br><b>Order number</b> {rc['order_no']}<br><b>Order placed</b> {placed.strftime('%d/%m/%Y')}</div>
<div><b>{'Delivered to' if deliver else 'Picked up by'}</b> {who}<br>{'Brunswick VIC (address withheld)' if deliver else 'Pick up desk, store ' + h(rc['store_no'])}<br><b>{'Delivery window' if deliver else 'Pick up'}</b> {inv_date.strftime('%a %d %b %Y')}, {window}</div></div>
<table><tr><th>Code</th><th>Item</th><th class="n">Qty</th><th class="n">Price</th><th class="n">Amount</th><th class="n">GST</th></tr>
{''.join(rows)}</table>
{unavailable}
<h2>Summary</h2>
<table class="tot" style="width:55%;margin-left:45%">
<tr><td>Items supplied ({rc['Items']})</td><td class="n">{money(items_total)}</td></tr>
{fee_rows}
<tr class="big"><td>Total (incl. GST)</td><td class="n">${rc['Total']}</td></tr>
<tr><td>GST included in total</td><td class="n">{rc['GST']}</td></tr>
{'<tr><td>Your savings</td><td class="n">' + rc['Savings'] + '</td></tr>' if float(rc['Savings']) > 0 else ''}
<tr><td>Charged to Mastercard ****4417</td><td class="n">{rc['Total']}</td></tr>
</table>
<p class="small">{legend} Weighed items are charged on the weight supplied. This is a fictional document made for software testing; the business details are placeholders.</p>
<div class="fict" style="margin-top:16px">{FICT}</div>"""


def ereceipt_html(rc, r):
    text, width = docket_lines(rc, random.Random(f"slip-{rc['Receipt ID']}"))
    body = "\n".join(t for t, _ in text)
    store = "Woolworths Brunswick" if rc["store_code"] == "W" else "Coles Supermarkets Coburg"
    d = D(rc["Date"])
    hh, mm = map(int, rc["Time"].split(":"))
    sent = dt.datetime(d.year, d.month, d.day, hh, mm) + dt.timedelta(minutes=r.randint(1, 9))
    to = "jordan.davies@example.com" if r.random() < 0.5 else "mia.davies@example.com"
    return f"""<title>eReceipt</title><style>{CSS}</style>
<div class="fict">{FICT}</div>
<div class="mail"><b>From:</b> eReceipts &lt;ereceipts@example.com&gt;<br><b>To:</b> {to}<br>
<b>Sent:</b> {sent.strftime('%a %d %b %Y %H:%M')}<br><b>Subject:</b> Your eReceipt from {store}</div>
<p>Thanks for shopping with us. Your receipt is below.</p>
<pre>{h(body)}</pre>
<div class="fict" style="margin-top:16px">{FICT}</div>"""


def print_pdf(html_text, out):
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "page.html"
        p.write_text("<!doctype html><meta charset='utf-8'>" + html_text)
        subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--no-pdf-header-footer", "--no-first-run",
                        f"--user-data-dir={td}/profile", f"--print-to-pdf={out}", p.as_uri()],
                       check=True, capture_output=True, timeout=120)


def render(rc):
    r = random.Random(f"pdf-{rc['Receipt ID']}")
    if rc["fmt"] == "docket":
        return "photo, crumpled" if render_docket(rc) else "photo"
    if rc["fmt"] == "ereceipt":
        print_pdf(ereceipt_html(rc, r), OUT / rc["files"][0])
        return "e-receipt pdf"
    print_pdf(invoice_html(rc, r), OUT / rc["files"][0])
    return "invoice pdf"


if __name__ == "__main__":
    want = set(sys.argv[1:])
    manifest = []
    for rc in KEY["receipts"]:
        if want and rc["Receipt ID"] not in want:
            continue
        how = render(rc)
        manifest.append({"receipt": rc["Receipt ID"], "files": rc["files"], "how": how})
        print(rc["Receipt ID"], how, rc["files"])
    if not want:
        (HERE / "files-manifest.json").write_text(json.dumps({"_about": "Which file is which receipt. Sealed: part of the answer key, never shown to a reader.", "files": manifest}, indent=1) + "\n")
