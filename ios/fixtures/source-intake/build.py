"""Build wholly fictional PDF intake fixtures from committed Davies CSVs.

Requires reportlab and Poppler. No personal files or network access.
"""
from pathlib import Path
import csv, hashlib, json, subprocess
from decimal import Decimal
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.lib.colors import HexColor

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
OUT = ROOT / "ios/Kitty/Resources"
RENDERED = HERE / "rendered"
RENDERED.mkdir(parents=True, exist_ok=True)
W, H = A4
GREEN = HexColor("#174E4A")
INK = HexColor("#182D2B")

def money(value):
    return f"{Decimal(str(value)):,.2f}"

def start(name, title, subtitle):
    c = canvas.Canvas(str(OUT / name), pagesize=A4, invariant=1)
    c.setTitle(title + " - fictional source fixture")
    c.setFillColor(GREEN)
    c.rect(0, H-118, W, 118, fill=1, stroke=0)
    c.setFillColor(HexColor("#FFFFFF"))
    c.setFont("Helvetica-Bold", 21)
    c.drawString(42, H-49, title)
    c.setFont("Helvetica", 11)
    c.drawString(42, H-73, subtitle)
    c.setFont("Helvetica-Bold", 9)
    c.drawString(42, H-99, "FICTIONAL DEMO DOCUMENT - no real account or employment")
    c.setFillColor(INK)
    return c

def line(c, y, text, bold=False, size=11):
    c.setFont("Helvetica-Bold" if bold else "Helvetica", size)
    c.drawString(42, y, text)
    return y-23

def finish(c, source):
    c.setStrokeColor(HexColor("#C8D8D0"))
    c.line(42, 63, W-42, 63)
    c.setFont("Helvetica", 8)
    c.drawString(42, 47, "Synthetic test evidence. Not a bank record, payslip, appraisal or tax document.")
    c.drawString(42, 34, source)
    c.drawRightString(W-42, 20, "Page 1 of 1")
    c.save()

source = ROOT / "sources/ACC-EVD/2027-02-02/Harbour-Transactions-ACC-EVD-2027-01.csv"
rows = list(csv.DictReader(source.open(encoding="utf-8-sig")))
net = lambda r: Decimal(r["Credit Amount"] or "0") - Decimal(r["Debit Amount"] or "0")
opening = Decimal(rows[0]["Balance"]) - net(rows[0])
closing = Decimal(rows[-1]["Balance"])
c = start("source-statement-text.pdf", "Harbour Demo Bank", "Everyday account - January 2027 statement")
y = H-149
for text in ["Account ID: ACC-EVD", "Currency: AUD", "Period start: 2027-01-01", "Period end: 2027-01-31", f"Opening balance: ${money(opening)}", f"Closing balance: ${money(closing)}"]:
    y = line(c, y, text, "balance" in text)
y -= 15
c.setFont("Helvetica-Bold", 10)
c.drawString(42, y, "Date")
c.drawString(118, y, "Original bank description")
c.drawRightString(W-42, y, "Signed AUD")
y -= 25
for r in rows:
    c.setFont("Helvetica", 8)
    c.drawString(42, y, r["Date"])
    c.drawString(118, y, r["Narrative"][:63])
    c.drawRightString(W-42, y, money(net(r)))
    y -= 18
finish(c, "Source: committed Davies ACC-EVD January CSV (12 rows).")

# Raster-only copy intentionally has no text layer. It exercises on-device OCR.
subprocess.run(["pdftoppm", "-r", "130", "-singlefile", "-png", str(OUT / "source-statement-text.pdf"), str(RENDERED / "scan-source")], check=True)
c = canvas.Canvas(str(OUT / "source-statement-scanned.pdf"), pagesize=A4, invariant=1)
c.setTitle("Fictional statement - image-only OCR fixture")
c.drawImage(str(RENDERED / "scan-source.png"), 0, 0, width=W, height=H)
c.save()

pay = list(csv.DictReader((ROOT / "demo-portals/fixtures/evidence/payslip.csv").open()))[0]
c = start("source-payslip-ytd.pdf", "Northwind Logistics - Demo", "Payslip with current-period and YTD amounts")
y = H-149
for text in [f"Person: {pay['Person']}", f"Employer: {pay['Employer']}", "Currency: AUD", f"Pay date: {pay['Pay date']}", f"Period start: {pay['Period start']}", f"Period end: {pay['Period end']}"]:
    y = line(c, y, text)
y = line(c, y-10, "CURRENT PAY PERIOD", True)
for label, key in [("Gross pay (this pay)", "Gross AUD"), ("Tax withheld (this pay)", "PAYG AUD"), ("Employer super", "Super AUD"), ("Net pay (this pay)", "Net AUD")]:
    y = line(c, y, f"{label}: ${money(pay[key])}", label.startswith("Net"))
y = line(c, y-15, "YEAR-TO-DATE TOTALS - these are not this pay", True)
for label, key in [("Gross pay (YTD)", "Gross AUD"), ("Tax withheld (YTD)", "PAYG AUD"), ("Employer super (YTD)", "Super AUD"), ("Net pay (YTD)", "Net AUD")]:
    y = line(c, y, f"{label}: ${money(Decimal(pay[key])*6)}")
finish(c, "Source: committed DEMO-PAY-001. YTD decoys are synthetic six-pay multiples.")

valuation = next(r for r in csv.DictReader((ROOT / "period-close/2027-01/valuations.csv").open()) if r["Item ID"] == "LN-HOME")
c = start("source-valuation-loan.pdf", "Harbour Demo Bank", "Home loan balance observation")
y = H-154
for text in ["Item ID: LN-HOME", "Currency: AUD", f"Valuation date: {valuation['Month end']}", "Value kind: liability", "Source method: statement", f"Observed value (amount owing): ${money(abs(Decimal(valuation['Value'])))}"]:
    y = line(c, y, text, "Observed" in text)
y = line(c, y-25, "Other figures - not the outstanding loan balance", True)
for text in ["Original facility limit: $650,000.00", "Minimum repayment: $3,814.75", "Available redraw: $0.00"]:
    y = line(c, y, text)
finish(c, "Source: committed January LN-HOME valuation. Other figures are synthetic decoys.")

names = ["source-statement-text.pdf", "source-statement-scanned.pdf", "source-payslip-ytd.pdf", "source-valuation-loan.pdf"]
manifest = {"fictional": True, "source": "committed Davies fixtures only", "expected": {
    "statement": {"accountId": "ACC-EVD", "periodStart": "2027-01-01", "periodEnd": "2027-01-31", "openingMinor": str(int(opening*100)), "closingMinor": str(int(closing*100))},
    "payslip": {"payDate": pay["Pay date"], "personOnDocument": pay["Person"], "grossMinor": "525000", "taxMinor": "125000", "superMinor": "63000", "netMinor": "400000"},
    "valuation": {"date": valuation["Month end"], "itemId": "LN-HOME", "valueMinor": str(int(Decimal(valuation["Value"])*100)), "valueKind": "liability"}}, "files": []}
for name in names:
    data = (OUT/name).read_bytes()
    manifest["files"].append({"name": name, "sha256": hashlib.sha256(data).hexdigest(), "byteLength": len(data)})
    subprocess.run(["pdftoppm", "-r", "110", "-singlefile", "-png", str(OUT/name), str(RENDERED/name.removesuffix(".pdf"))], check=True)
(HERE/"manifest.json").write_text(json.dumps(manifest, indent=2)+"\n")
print(json.dumps(manifest, indent=2))
