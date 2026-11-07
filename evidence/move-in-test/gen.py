"""Fictional messy household estate for the move-in test.

Sam and Ria Calder, FY26 (1 Jul 2025 to 30 Jun 2026). Parody institutions.
Writes estate/ (what the household hands over) and sealed.json (the answer key).
"""
import json, random, os, sys, datetime as dt
from pathlib import Path

OUT = Path(sys.argv[1])
random.seed(26)
E = OUT / "estate"
D = lambda *p: E.joinpath(*p)
for p in ["Drive/Money", "Drive/Presentations", "Drive/Tax/FY25", "Drive/Tax/FY26", "Drive/Statements/amewx",
          "Email/Inbox", "Email/Archive", "Phone"]:
    D(p).mkdir(parents=True, exist_ok=True)

def money(x): return round(x + 1e-9, 2)
def d(y, m, dd): return dt.date(y, m, dd)
FY0, FY1 = d(2025, 7, 1), d(2026, 6, 30)
def months():
    y, m = 2025, 7
    while (y, m) <= (2026, 6):
        yield y, m
        m += 1
        if m == 13: y, m = y + 1, 1
def eom(y, m):
    n = d(y + (m == 12), m % 12 + 1, 1)
    return n - dt.timedelta(days=1)

manifest = []
def write(rel, text, modified, place):
    p = D(rel); p.write_text(text)
    manifest.append((rel, modified, place))

# ---------- Wattle saver (joint) ----------
saver_rate = 0.041
sv = 22640.00
saver_tx = []  # (date, amount, memo)
interest = {}
for y, m in months():
    saver_tx.append((d(y, m, 2), 800.00, "TFR FROM HARBOUR JOINT"))
    sv += 800
    if (y, m) == (2025, 11):
        saver_tx.append((d(2025, 11, 18), -12000.00, "TFR TO HARBOUR JOINT"))
        sv -= 12000
    i = money(sv * saver_rate / 12)
    interest[f"{y}-{m:02d}"] = i
    saver_tx.append((eom(y, m), i, "CREDIT INTEREST"))
    sv = money(sv + i)
saver_close = money(sv)
saver_interest_total = money(sum(interest.values()))

ofx = ["OFXHEADER:100", "DATA:OFXSGML", "<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>AUD",
       "<BANKACCTFROM><BANKID>WAT<ACCTID>WS-4471-JOINT<ACCTTYPE>SAVINGS</BANKACCTFROM>",
       "<BANKTRANLIST><DTSTART>20250701<DTEND>20260630>"]
for i, (dd_, a, memo) in enumerate(saver_tx):
    ofx.append(f"<STMTTRN><TRNTYPE>{'CREDIT' if a > 0 else 'DEBIT'}<DTPOSTED>{dd_:%Y%m%d}<TRNAMT>{a:.2f}<FITID>W{i:04d}<MEMO>{memo}</STMTTRN>")
ofx.append(f"</BANKTRANLIST><LEDGERBAL><BALAMT>{saver_close:.2f}<DTASOF>20260630</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>")
write("Drive/Statements/wattle_saver_FY26.ofx", "\n".join(ofx) + "\n", "2026-07-03", "Drive")

# ---------- Amewx card (Sam) ----------
merchants = [("METRO FUEL", 55, 95), ("CAFE LUNA", 5, 18), ("PARCELPOST AU", 20, 140), ("STREAMFLIX", 22.99, 22.99),
             ("BOOKNOOK", 12, 60), ("PHARMACARE", 8, 45), ("HARDWARE HAUS", 15, 180), ("NOODLE BAR", 14, 38)]
card_bal = 0.0
card = {}
prev = 1312.40
for y, m in months():
    rows = []
    n = random.randint(14, 24)
    for _ in range(n):
        name, lo, hi = random.choice(merchants)
        amt = lo if lo == hi else money(random.uniform(lo, hi))
        rows.append((d(y, m, random.randint(1, 28)), name, amt))
    rows.sort()
    purchases = money(sum(r[2] for r in rows))
    pay = prev  # previous statement's closing is paid on the 20th
    close = money(prev + purchases - pay)
    card[f"{y}-{m:02d}"] = dict(prev=prev, purchases=purchases, payment=pay, close=close, rows=rows)
    prev = close
for k, c in card.items():
    if k == "2026-02":
        continue  # the missing statement
    y, m = map(int, k.split("-"))
    lines = [f"Amewx Platinum Edge statement {k}", "Card ending 3007, cardholder SAM CALDER",
             f"Previous balance,{c['prev']:.2f}", "",
             '"Transaction Date","Details","Amount"']
    allrows = c["rows"] + [(d(y, m, 20), "PAYMENT RECEIVED - THANK YOU", -c["payment"])]
    for r in sorted(allrows):
        lines.append(f'"{r[0]:%d/%m/%Y}","{r[1]}","{r[2]:.2f}"')
    lines += ["", f"Closing balance,{c['close']:.2f}"]
    write(f"Drive/Statements/amewx/amewx_{k}.csv", "\n".join(lines) + "\n", f"{eom(y, m) + dt.timedelta(days=4)}", "Drive")

# ---------- Harbour joint everyday ----------
H = []  # (date, desc, amount)
pay = d(2025, 7, 3)
sam_pays = 0
while pay <= FY1:
    H.append((pay, "PAYROLL TIDEWATER ENGINEERING", 3142.18)); sam_pays += 1
    pay += dt.timedelta(days=14)
for y, m in months():
    H.append((d(y, m, 15), "SALARY NORTHSHORE COUNCIL", 4388.40))
    H.append((d(y, m, 1), "HOME LOAN REPAYMENT LN-88", -2950.00))
    H.append((d(y, m, 2), "TFR TO WATTLE SAVER", -800.00))
    H.append((d(y, m, 5), "HEALTHY FUND PREMIUM", -312.60))
    H.append((d(y, m, 9), "KOALATEL MOBILE", -79.00))
    H.append((d(y, m, 11), "REEFLINK INTERNET", -74.00))
    H.append((d(y, m, 20), "AMEWX PAYMENT", -card[f"{y}-{m:02d}"]["payment"]))
    for wk in range(4):
        H.append((d(y, m, 3 + wk * 7), "MERRIVALE FRESH", -money(random.uniform(140, 260))))
DIV = {"KMN_SEP": (d(2025, 9, 18), "KMN DIVIDEND SEP25 REF 0012", 192.00),
       "RFT_OCT": (d(2025, 10, 15), "RFT DIV OCT25 REF 7781", 102.00),
       "KMN_MAR": (d(2026, 3, 20), "KMN DIVIDEND MAR26 REF 0019", 174.00)}
for v in DIV.values(): H.append(v)
H += [(d(2025, 11, 3), "NORTHSHORE PS P&C RAFFLE", -50.00),
      (d(2025, 11, 17), "COINJUG WITHDRAWAL", 4706.27),
      (d(2025, 11, 18), "TFR FROM WATTLE SAVER", 12000.00),
      (d(2025, 11, 20), "OAKS MOTORS DEPOSIT", -16000.00),
      (d(2025, 12, 9), "HARBOUR FOOD BANK DONATION", -250.00),
      (d(2026, 3, 12), "BROKERBEE SETTLEMENT RFT", 4934.50)]
H.sort(key=lambda r: (r[0], -r[2]))
bal = 6210.55
csv = ["Date,Description,Debit,Credit,Balance"]
for dd_, desc, a in H:
    bal = money(bal + a)
    deb, cre = (f"{-a:.2f}", "") if a < 0 else ("", f"{a:.2f}")
    csv.append(f"{dd_:%d/%m/%Y},{desc},{deb},{cre},{bal:.2f}")
fixed = csv
write("Drive/Statements/harbour_joint_FY26.csv", "\n".join(fixed) + "\n", "2026-07-02", "Drive")
harbour_close = bal

# ---------- Income statements, dividend statements, last year ----------
write("Drive/Tax/FY26/Sam income statement FY26.txt", """ATO online services - Income statement (tax ready)
Name: SAM CALDER    Financial year: 2025-26
Payer: TIDEWATER ENGINEERING PTY LTD
Gross payments: 112,450.00
Tax withheld: 27,118.00
Reportable employer super contributions: 0.00
Allowances: 0.00
Status: Tax ready
""", "2026-07-22", "Drive")
write("Drive/Tax/FY26/Ria income statement FY26.txt", """ATO online services - Income statement (tax ready)
Name: RIA CALDER    Financial year: 2025-26
Payer: NORTHSHORE COUNCIL
Gross payments: 74,880.00
Tax withheld: 13,602.00
Reportable employer super contributions: 0.00
Status: Tax ready
""", "2026-07-22", "Drive")
write("Drive/Tax/FY26/RFT dividend statement Oct 2025.txt", """Reef Telecom Ltd (RFT) - Dividend statement
Holder: SAM CALDER   HIN ending 4410
Payment date: 15 October 2025   Record date: 18 September 2025
Shares held: 1,200   Dividend per share: $0.085
Franked amount: $102.00   Unfranked amount: $0.00
Franking credit: $43.71
Net payment: $102.00 paid to HARBOUR BANK ***221
""", "2025-10-16", "Drive")
write("Drive/Tax/FY26/KMN dividend statement Mar 2026.txt", """Koala Mining Ltd (KMN) - Interim dividend statement
Holder: SAM CALDER   HIN ending 4410
Payment date: 20 March 2026
Shares held: 300   Dividend per share: $0.58
Franked amount: $174.00   Unfranked amount: $0.00
Franking credit: $74.57
Net payment: $174.00 paid to HARBOUR BANK ***221
""", "2026-03-21", "Drive")
write("Drive/Tax/FY25/FY25 return summary.txt", """Our FY25 returns, as lodged (summary we kept)

SAM
- Salary: Tidewater Engineering (income statement)
- Interest: Wattle saver, half each
- Dividends: KMN (final Sep 2024, interim Mar 2025), RFT (Oct 2024). All fully franked.
- Capital gains: none
- Work from home: fixed rate method, 412 hours (from my diary)
- Private health: family policy statement, Healthy Fund

RIA
- Salary: Northshore Council (income statement)
- Interest: Wattle saver, half each
- Donation: Harbour Food Bank, receipt by email
- Private health: on Sam's family policy statement
""", "2025-08-30", "Drive")

# ---------- Their own system ----------
cats = ["Groceries", "Fuel", "Eating out", "Bills", "Home loan", "Health cover", "Shopping", "Savings"]
def budget(upto, jitter_seed):
    r = random.Random(jitter_seed)
    rows = ["Category," + ",".join(f"{dt.date(y, m, 1):%b %Y}" for y, m in months() if (y, m) <= upto)]
    for c in cats:
        vals = []
        for y, m in months():
            if (y, m) > upto: break
            base = {"Groceries": 820, "Fuel": 260, "Eating out": 140, "Bills": 153, "Home loan": 2950, "Health cover": 312.6, "Shopping": 410, "Savings": 800}[c]
            vals.append(f"{base * r.uniform(0.85, 1.15):.0f}" if c not in ("Home loan", "Savings", "Health cover", "Bills") else f"{base:.2f}")
        rows.append(c + "," + ",".join(vals))
    return "\n".join(rows) + "\n"
write("Drive/Money/Budget 2025.csv", budget((2026, 3), 1), "2026-04-03", "Drive")
write("Drive/Money/Budget 2025 (1).csv", budget((2026, 1), 2), "2026-02-11", "Drive")
write("Drive/Money/Copy of Tax FY26 working.csv", """Item,Sam,Ria,Notes
Salary,income statement,income statement,
Interest,Wattle half,Wattle half,
Dividends,KMN + RFT,,KMN Sep and Mar; RFT Oct
Capital gains,None this year,None,
Donations,,ask Ria,
Work from home,same as last year?,,
Private health,statement comes in July,,
""", "2026-06-28", "Drive")
write("Drive/Presentations/Money plan 2026 (slides).txt", """[Exported outline of "Money plan 2026.pptx", 6 slides]
Slide 1  Money plan 2026 - Sam and Ria
Slide 2  Where we are: home loan on track, car bought in November
Slide 3  Emergency fund: $25,000 in the Wattle saver. Done, do not touch.
Slide 4  Investing: KMN and RFT shares. Selling RFT in March to top up the car fund.
Slide 5  Crypto: still holding 0.8 ETH, leave it alone
Slide 6  2026 goals: one budget we both use, taxes done by August
""", "2026-01-10", "Drive")
write("Phone/tax notes.txt", """Tax notes (phone)
- WFH 2 days most weeks. Did I log it anywhere this year? Tidewater portal?
- Ria gave to the food bank again before Xmas
- ETH - did I sell? check CoinJug
- Ask Ria if she wants to use the same accountant
""", "2026-07-05", "Phone")

# ---------- Email ----------
def eml(folder, name, date, frm, to, subj, body):
    write(f"Email/{folder}/{name}.eml", f"From: {frm}\nTo: {to}\nDate: {date}\nSubject: {subj}\n\n{body}\n", date[:10], "Email")
eth_px, eth_qty = 5912.40, 0.8
eth_gross = money(eth_px * eth_qty); eth_fee = money(eth_gross * 0.005); eth_net = money(eth_gross - eth_fee)
assert abs(eth_net - 4706.27) < 0.01, eth_net
eml("Inbox", "coinjug-sell", "2025-11-14 09:12", "orders@coinjug.example", "sam.calder@example.com", "Order filled: you sold 0.8 ETH",
    f"Hi Sam,\nYour sell order has filled.\nAsset: Ether (ETH)  Quantity: 0.8\nPrice: A${eth_px:,.2f}\nGross: A${eth_gross:,.2f}  Fee: A${eth_fee:,.2f}\nNet proceeds: A${eth_net:,.2f}\nYou can withdraw to your linked bank account at any time.\nFull history and tax reports are under Account > Reports.")
eml("Inbox", "coinjug-withdraw", "2025-11-17 14:03", "no-reply@coinjug.example", "sam.calder@example.com", "Withdrawal complete",
    f"A${eth_net:,.2f} has been sent to HARBOUR BANK ***221.")
eml("Inbox", "coinjug-alert", "2025-10-02 07:30", "alerts@coinjug.example", "sam.calder@example.com", "Price alert: ETH is up 5% today",
    "ETH is trading at A$5,640.10. Tap to trade.")
rft_sell_px, rft_qty, brok = 4.12, 1200, 9.50
rft_net = money(rft_sell_px * rft_qty - brok)
assert abs(rft_net - 4934.50) < 0.01
eml("Inbox", "brokerbee-sell", "2026-03-10 16:40", "confirmations@brokerbee.example", "sam.calder@example.com", "Contract note: SELL 1,200 RFT",
    f"CONTRACT NOTE\nTrade date: 10/03/2026  Settlement: 12/03/2026\nSELL 1,200 REEF TELECOM LTD (RFT) @ $4.12\nConsideration: $4,944.00  Brokerage: $9.50\nNet proceeds: ${rft_net:,.2f}\nHolder: SAM CALDER HIN ending 4410")
rft_buy_px, rft_buy_brok = 3.05, 19.95
rft_cost = money(rft_buy_px * rft_qty + rft_buy_brok)
eml("Archive", "brokerbee-buy-2019", "2019-08-14 11:02", "confirmations@brokerbee.example", "sam.calder@example.com", "Contract note: BUY 1,200 RFT",
    f"CONTRACT NOTE\nTrade date: 14/08/2019  Settlement: 16/08/2019\nBUY 1,200 REEF TELECOM LTD (RFT) @ $3.05\nConsideration: $3,660.00  Brokerage: $19.95\nTotal cost: ${rft_cost:,.2f}\nHolder: SAM CALDER HIN ending 4410")
eml("Inbox", "foodbank-receipt", "2025-12-09 18:21", "receipts@harbourfoodbank.example", "ria.calder@example.com", "Thank you Ria - your tax receipt",
    "Thank you for your gift of $250.00 on 9 December 2025.\nHarbour Food Bank is a deductible gift recipient. Keep this receipt for your tax return.\nReceipt no. HFB-25-88213")
eml("Inbox", "pandc-raffle", "2025-11-03 20:10", "pandc@northshoreps.example", "ria.calder@example.com", "Your raffle tickets",
    "Thanks for buying 10 raffle tickets ($50.00) for the Northshore PS spring raffle. Draw on 28 November. Good luck!")
eml("Inbox", "healthyfund-tax", "2026-07-15 08:00", "statements@healthyfund.example", "sam.calder@example.com", "Your 2025-26 private health insurance tax statement",
    "Policy: Family Hospital and Extras  Members: Sam Calder, Ria Calder\nPeriod: 1 July 2025 to 30 June 2026, covered every day\nPremiums paid: $3,751.20\nAustralian Government rebate received as a premium reduction (tier 0)\nUse this statement for both members' returns.")
eml("Inbox", "amewx-feb", "2026-03-04 06:00", "no-reply@amewx.example", "sam.calder@example.com", "Your February statement is ready",
    "Your Amewx Platinum Edge statement for February 2026 is ready. Log in to view and download it.")
eml("Inbox", "tidewater-wfh", "2025-08-01 09:00", "hr@tidewater.example", "sam.calder@example.com", "Reminder: log your WFH days",
    "From this year, log your work-from-home days in the Tidewater people portal (My time > Locations). You can export the log at year end.")
eml("Inbox", "koalatel-bill", "2026-06-09 05:00", "billing@koalatel.example", "sam.calder@example.com", "Your Koalatel bill", "Amount due $79.00 on 9 June.")
eml("Inbox", "newsletter-1", "2026-05-02 07:00", "news@reefnews.example", "sam.calder@example.com", "Five shares to watch", "Our picks this month include KMN and RFT.")
eml("Inbox", "newsletter-2", "2026-02-14 07:00", "deals@parcelpost.example", "ria.calder@example.com", "Valentine's sale", "20% off.")
man = ["path,modified,where"] + [f"{p},{m},{w}" for p, m, w in sorted(manifest)]
(E / "MANIFEST.csv").write_text("\n".join(man) + "\n")

sealed = {
    "numbers": {
        "saver_interest_total_fy26": saver_interest_total,
        "saver_balance_2026_06_30": saver_close,
        "harbour_balance_2026_06_30": harbour_close,
        "sam_dividends_cash_fy26": 192.00 + 102.00 + 174.00,
        "sam_franking_known": 43.71 + 74.57,
        "rft_proceeds_net": rft_net, "rft_cost_base": rft_cost, "rft_gain_gross": money(rft_net - rft_cost), "rft_held_over_12m": True,
        "eth_proceeds_net": eth_net, "eth_cost_base": None,
        "ria_donation_deductible": 250.00,
        "sam_salary_gross": 112450.00, "sam_tax_withheld": 27118.00,
        "ria_salary_gross": 74880.00, "ria_tax_withheld": 13602.00,
        "card_spend_2025_12": card["2025-12"]["purchases"],
        "sam_pays_fy26": sam_pays,
    },
    "missing": {
        "G1": "CoinJug purchase history for the 0.8 ETH (cost base); the sale has no purchase record",
        "G2": "KMN September 2025 dividend statement (franking credit unknown; only the bank deposit exists)",
        "G3": "Sam's work-from-home hours record for FY26 (Tidewater portal export)",
        "G4": "Amewx February 2026 statement (card months not unbroken)",
    },
    "found_elsewhere": {
        "F1": "ETH sale only in email (CoinJug order filled)",
        "F2": "RFT sale only in email (contract note)",
        "F3": "RFT purchase cost only in an archived 2019 email",
        "F4": "Ria's donation receipt only in email",
        "F5": "Private health statement only in email, covers both",
        "F6": "KMN September dividend amount only in the bank file",
    },
    "conflicts": {
        "C1": "Tax working sheet says no capital gains; there are two disposals (RFT, ETH)",
        "C2": "Slides say $25,000 emergency fund; saver holds less",
        "C3": "Slides say still holding ETH; sold 14 Nov 2025",
        "C4": "Two budget copies disagree; Budget 2025.csv (Apr 2026, runs to Mar) is newer than (1) (Feb 2026, runs to Jan)",
    },
    "traps": {
        "X1": "School P&C raffle tickets are not a deductible gift",
        "X2": "CoinJug price alert is not a trade",
        "X3": "Saver to joint transfer is not income",
    },
    "card": {k: {kk: vv for kk, vv in v.items() if kk != "rows"} for k, v in card.items()},
}
(OUT / "sealed.json").write_text(json.dumps(sealed, indent=1))
print(json.dumps(sealed["numbers"], indent=1))
print(len(manifest), "files")
