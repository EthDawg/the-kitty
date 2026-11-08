"""The Davies household's sheet-version-3 rows: Decision Options, Goal Levers, Tax Returns.
Fictional. Deterministic. Tax uses each year's published resident rates and a 2% Medicare levy, so
lodged years tie to the cent with the FY26 columns already on the Tax Forecast tab.
Run: python3 tools/v3_davies.py  (writes data/v3/*.csv)"""
import csv, json, math, os
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "data", "v3"); os.makedirs(OUT, exist_ok=True)
snap = json.load(open(os.path.join(ROOT, "data", "snapshot-v2.json")))
AS_OF = next(r["value"] for r in snap["settings"] if r["setting"] == "As-of date")

# ---- tax tables (resident, excluding the Medicare levy) ----
RATES = {
    # FY23 and FY24: 19 / 32.5 / 37 / 45
    "FY23": [(18200, 0.19), (45000, 0.325), (120000, 0.37), (180000, 0.45)],
    "FY24": [(18200, 0.19), (45000, 0.325), (120000, 0.37), (180000, 0.45)],
    # FY25 and FY26: stage 3, 16 / 30 / 37 / 45
    "FY25": [(18200, 0.16), (45000, 0.30), (135000, 0.37), (190000, 0.45)],
    "FY26": [(18200, 0.16), (45000, 0.30), (135000, 0.37), (190000, 0.45)],
    # FY27: first bracket 15%
    "FY27": [(18200, 0.15), (45000, 0.30), (135000, 0.37), (190000, 0.45)],
}
def income_tax(ti, fy):
    t, b = 0.0, RATES[fy]
    for i, (lo, r) in enumerate(b):
        hi = b[i + 1][0] if i + 1 < len(b) else float("inf")
        if ti > lo: t += (min(ti, hi) - lo) * r
    return round(t, 2)
def lito(ti):
    if ti <= 37500: return 700.0
    if ti <= 45000: return round(700 - (ti - 37500) * 0.05, 2)
    if ti <= 66667: return round(max(0.0, 325 - (ti - 45000) * 0.015), 2)
    return 0.0

# lodged history; FY26 matches the Tax Forecast tab's corrected figures (prior-year columns)
tf = {r["label"]: r for r in snap["tax"]}
HIST = [
    # person, fy, status, taxable, withheld, lodged, notice, note
    ("Jordan", "FY23", "Assessed", 108_340.00, 27_120.00, "2023-08-14", "2023-08-29", ""),
    ("Mia",    "FY23", "Assessed",  58_910.00, 11_402.00, "2023-08-14", "2023-08-30", ""),
    ("Jordan", "FY24", "Amended",  114_960.00, 29_310.00, "2024-09-02", "2024-11-18", "Amended 18 Nov 2024: a $1,100 rental repair reclassed as capital works."),
    ("Mia",    "FY24", "Assessed",  61_480.00, 12_160.00, "2024-09-02", "2024-09-20", ""),
    ("Jordan", "FY25", "Assessed", 121_420.00, 31_880.00, "2025-08-26", "2025-09-09", ""),
    ("Mia",    "FY25", "Assessed",  64_210.00, 13_420.00, "2025-08-26", "2025-09-10", ""),
    ("Jordan", "FY26", "Assessed", round(tf["Corrected taxable income"]["prior_j"], 2), tf["Tax withheld (PAYG)"]["prior_j"], "2026-09-04", "2026-09-22", "Lodged on the corrected figures: large repairs and receipt-less items taken out."),
    ("Mia",    "FY26", "Assessed", round(tf["Corrected taxable income"]["prior_m"], 2), tf["Tax withheld (PAYG)"]["prior_m"], "2026-09-04", "2026-09-23", ""),
]
rows = []
for p, fy, st, ti, wh, lodged, notice, note in HIST:
    tax = income_tax(ti, fy); med = round(ti * 0.02, 2); off = lito(ti)
    res = round(wh - (tax + med - off), 2)
    rows.append([p, fy, st, ti, tax, med, off, wh, res, lodged, notice, "", "", note])
# FY27 estimate from the Tax Forecast's current-year columns (projected full year)
for p, k in (("Jordan", "cur_j"), ("Mia", "cur_m")):
    ti = round(tf["Corrected taxable income"][k], 2); wh = round(tf["Tax withheld (PAYG)"][k], 2)
    tax = income_tax(ti, "FY27"); med = round(ti * 0.02, 2); off = lito(ti)
    rows.append([p, "FY27", "Estimate", ti, tax, med, off, wh, round(wh - (tax + med - off), 2), "", "", "", "", f"Projected from the year to {AS_OF}; the Tax Forecast tab owns it."])
# ties: FY26 must equal the forecast tab's corrected refunds to the cent
for r in rows:
    if r[1] == "FY26":
        want = tf["Corrected refund (negative means tax payable)"]["prior_j" if r[0] == "Jordan" else "prior_m"]
        assert abs(r[8] - want) < 0.01, (r, want)
H_TAX = ["Person", "FY", "Status", "Taxable income", "Tax on income", "Medicare", "Offsets", "Withheld", "Result", "Lodged", "Notice", "Pack", "Source", "Note"]

# ---- decisions with costed options ----
H_DEC = ["Decision ID", "Question", "Ref", "Option", "Upfront", "Per month", "Months", "Extra", "Total", "Recommended", "Decide by", "Status", "Source", "Note"]
DEC = [
    ["DQ-001", "Home and contents renews on 3 March. Stay with Youi or switch?", "C0012", "Renew with Youi as quoted", 1980, 0, 12, 0, None, False, "2027-02-24", "Open", "Youi renewal notice, 20 Jan 2027", "Up $160 (8.8%) on last year. $500 excess."],
    ["DQ-001", "", "C0012", "Renew with Youi, $1,000 excess", 1760, 0, 12, 0, None, True, "2027-02-24", "Open", "Youi online quote, 27 Jan 2027", "Same cover; pay the first $1,000 of a claim instead of $500."],
    ["DQ-001", "", "C0012", "Switch to Budget Direct", 1640, 0, 12, 0, None, False, "2027-02-24", "Open", "Budget Direct quote, 28 Jan 2027", "$750 excess; contents sum insured $20,000 lower. Check before choosing."],
    ["DQ-002", "Kayo Sports: keep it, pause it for winter, or cancel?", "C0004", "Keep all year", 0, 35, 12, 0, None, False, "2027-03-01", "Open", "Kayo price list, Jan 2027", "Used 6 of the last 12 months, all in the cricket season."],
    ["DQ-002", "", "C0004", "Pause April to October", 0, 35, 5, 0, None, True, "2027-03-01", "Open", "Kayo pause terms", "Pays for the five cricket months only."],
    ["DQ-002", "", "C0004", "Cancel now", 0, 0, 12, 0, None, False, "2027-03-01", "Open", "", "Rejoin at the full price if wanted later."],
]
for d in DEC: d[8] = round(d[4] + d[5] * d[6] + d[7], 2)

# ---- goal levers (what moves the date) ----
H_LEV = ["Lever ID", "Goal", "Lever", "On", "Per month", "One-off", "Date if on", "Date if off", "Months moved", "Source"]
goals = {g["goal"]: g for g in snap["goals"]}
LEV = [
    ["GL-001", "Offset buffer", "The $800 monthly transfer to the offset, starting February", True, 800, 0, "Standing transfer set up 28 Jan 2027"],
    ["GL-008", "Offset buffer", "Tax refunds go to the offset each October", True, 0, 5684.70, "Tax Forecast: household refund, FY27"],
    ["GL-002", "Offset buffer", "Mia's pay rise from March (about $4,200 a year)", True, 245, 0, "Mia's offer letter, Dec 2026"],
    ["GL-003", "Offset buffer", "Pause Kayo and cancel Paramount+", False, 34.58, 0, "Decision DQ-002 and Subscriptions"],
    ["GL-004", "Offset buffer", "Geelong rent review to $2,560 in March", True, 90, 0, "Property manager's market note"],
    ["GL-005", "Offset buffer", "Halve the holiday budget for a year", False, 300, 0, "Budget tab, Holidays"],
    ["GL-006", "Offset buffer", "Sweep the Japan saver's leftover after the trip", True, 0, 90.25, "Goals: Japan trip balance less target"],
    ["GL-007", "Emergency fund", "Keep the $700 a month going", True, 0, 0, "Last three months"],
]
def add_months(iso, n):
    y, m, d = map(int, iso.split("-")); m0 = m - 1 + n; y += m0 // 12; m = m0 % 12 + 1
    return f"{y:04d}-{m:02d}-01"
def goal_date(goal, on_set):
    g = goals[goal]; need = g["target_amount"] - g["balance_now"]
    rate = g["saved_per_month_last_3_months"] or 0
    for l in LEV:
        if l[1] == goal and l[0] in on_set: rate += l[4]; need -= l[5]
    if need <= 0: return AS_OF[:8] + "01"
    if rate <= 0: return "Never"
    return add_months(AS_OF, math.ceil(need / rate))
on_now = {l[0] for l in LEV if l[3]}
lev_rows = []
for l in LEV:
    lid, goal = l[0], l[1]
    d_on = goal_date(goal, on_now | {lid}); d_off = goal_date(goal, on_now - {lid})
    def mi(a, b):
        if a == "Never" and b == "Never": return 0
        if a == "Never": return None
        if b == "Never": return None
        ya, ma = int(a[:4]), int(a[5:7]); yb, mb = int(b[:4]), int(b[5:7]); return (yb - ya) * 12 + (mb - ma)
    lev_rows.append([lid, goal, l[2], l[3], l[4], l[5], d_on, d_off, mi(d_on, d_off), l[6]])

for name, h, rs in (("tax-returns", H_TAX, rows), ("decision-options", H_DEC, DEC), ("goal-levers", H_LEV, lev_rows)):
    with open(os.path.join(OUT, name + ".csv"), "w", newline="") as f:
        w = csv.writer(f); w.writerow(h); w.writerows([["" if v is None else v for v in r] for r in rs])
    print(name, len(rs))
for r in lev_rows: print(r)
