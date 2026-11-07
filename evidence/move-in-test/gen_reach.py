"""Reach test: same household, but email is search-only inside a noisy mailbox, and Drive holds stray copies."""
import json, random, sys, shutil, datetime as dt
from pathlib import Path
S = Path(sys.argv[1]); random.seed(7)
src = S / "build/estate"
mails = []
for f in sorted((src / "Email").rglob("*.eml")):
    head, body = f.read_text().split("\n\n", 1)
    h = dict(l.split(": ", 1) for l in head.splitlines())
    mails.append(dict(date=h["Date"], frm=h["From"], to=h["To"], subject=h["Subject"], body=body.strip(), real=f.stem))
def day(): return dt.date(2025, 7, 1) + dt.timedelta(days=random.randint(0, 410))
noise = []
for m in range(1, 13):
    y = 2025 + (m <= 6) + (m > 6) * 0
    mm = (m + 5) % 12 + 1
    yy = 2025 if mm >= 7 else 2026
    nm = dt.date(yy + (mm == 12), mm % 12 + 1, 4)
    if (yy, mm) != (2026, 2):
        noise.append(dict(date=f"{nm} 06:00", frm="no-reply@amewx.example", to="sam.calder@example.com", subject=f"Your {dt.date(yy, mm, 1):%B} statement is ready", body=f"Your Amewx Platinum Edge statement for {dt.date(yy, mm, 1):%B %Y} is ready. Log in to view and download it."))
    noise.append(dict(date=f"{dt.date(yy, mm, 9)} 07:30", frm="alerts@coinjug.example", to="sam.calder@example.com", subject="Price alert: ETH moved 5%", body=f"ETH is trading at A${random.uniform(4200, 6400):,.2f}. Tap to trade."))
    noise.append(dict(date=f"{dt.date(yy, mm, 3)} 17:00", frm="news@brokerbee.example", to="sam.calder@example.com", subject=f"Market wrap: {dt.date(yy, mm, 1):%B}", body="ASX closed higher this month. Miners led; telcos lagged. Your watchlist: KMN, RFT."))
    noise.append(dict(date=f"{dt.date(yy, mm, 12)} 08:00", frm="news@harbourfoodbank.example", to="ria.calder@example.com", subject="This month at Harbour Food Bank", body="Thanks to supporters like you we served 4,200 meals. Volunteer days are open."))
    noise.append(dict(date=f"{dt.date(yy, mm, 6)} 09:00", frm="claims@healthyfund.example", to="sam.calder@example.com", subject="Your extras claim was paid", body=f"We paid ${random.uniform(40, 180):.2f} for a physio claim to your nominated account."))
    noise.append(dict(date=f"{dt.date(yy, mm, 25)} 12:00", frm="payroll@tidewater.example", to="sam.calder@example.com", subject="Your payslips are available", body="Your payslips for this month are in the people portal."))
senders = [("deals@parcelpost.example", "Sale"), ("news@reefnews.example", "Five shares to watch"), ("hello@noodlebar.example", "Order received"),
           ("office@northshoreps.example", "School newsletter"), ("billing@koalatel.example", "Your Koalatel bill"), ("billing@reeflink.example", "Your Reeflink bill"),
           ("info@oaksmotors.example", "Your service is due"), ("team@streamflix.example", "New this week"), ("orders@booknook.example", "Your order has shipped"),
           ("council@northshore.example", "Rates notice reminder"), ("hello@metrofuel.example", "Fuel rewards"), ("news@wattle.example", "Rates update")]
while len(noise) < 400:
    fr, sj = random.choice(senders)
    noise.append(dict(date=f"{day()} {random.randint(6, 21):02d}:{random.randint(0, 59):02d}", frm=fr, to=random.choice(["sam.calder@example.com", "ria.calder@example.com"]), subject=sj, body="(marketing or routine notice)"))
allm = mails + noise
random.shuffle(allm)
for i, m in enumerate(allm): m["id"] = f"m{i:04d}"
hidden = S / "mailstore"; hidden.mkdir(exist_ok=True)
(hidden / "mailbox.json").write_text(json.dumps(allm))
(hidden / "real_ids.json").write_text(json.dumps({m["real"]: m["id"] for m in allm if "real" in m}))
MAILPY = f'''import json, sys, datetime
STORE = {str(hidden / "mailbox.json")!r}; import os; LOG = {str(hidden)!r} + "/queries-" + os.path.basename(os.path.dirname(os.path.abspath(__file__))) + ".log"
box = json.load(open(STORE))
cmd = sys.argv[1] if len(sys.argv) > 1 else ""
open(LOG, "a").write(datetime.datetime.now().isoformat() + " " + " ".join(sys.argv[1:]) + "\\n")
if cmd == "search":
    words = " ".join(sys.argv[2:]).lower().split()
    hits = [m for m in box if all(w in (m["frm"] + " " + m["subject"] + " " + m["body"]).lower() for w in words)]
    hits.sort(key=lambda m: m["date"], reverse=True)
    print(f"{{len(hits)}} matches" + (", showing 10 newest" if len(hits) > 10 else ""))
    for m in hits[:10]: print(m["id"], m["date"][:10], m["frm"], "|", m["subject"])
elif cmd == "read":
    m = next((m for m in box if m["id"] == sys.argv[2]), None)
    print("not found" if not m else f"From: {{m['frm']}}\\nTo: {{m['to']}}\\nDate: {{m['date']}}\\nSubject: {{m['subject']}}\\n\\n{{m['body']}}")
else:
    print("usage: python3 mail.py search WORDS...  |  python3 mail.py read ID")
'''
strays = {
    "Drive/Money/Copy of Budget 2025.csv": ("2025-09-02", "Category,Jul 2025,Aug 2025\nGroceries,790,845\n"),
    "Drive/Money/Budget 2025 v2 FINAL.csv": ("2025-12-01", "Category,Jul 2025,Aug 2025,Sep 2025,Oct 2025,Nov 2025\nGroceries,801,812,850,833,866\n"),
    "Drive/Money/kitty test import.csv": ("2026-05-19", "Date,Description,Amount\n01/07/2025,TEST ROW,1.00\n"),
    "Drive/Tax/FY26/Tax FY26 working (Ria's copy).csv": ("2026-06-30", "Item,Ria,Notes\nSalary,income statement,\nDonations,food bank,receipt in my email\n"),
}
for arm in ["reach-haiku-plain", "reach-haiku-cov", "reach-sonnet-plain", "reach-sonnet-cov", "reach-opus-plain"]:
    d = S / "runs" / arm
    if d.exists(): shutil.rmtree(d)
    shutil.copytree(src, d / "estate", ignore=shutil.ignore_patterns("Email"))
    for rel, (mod, txt) in strays.items(): (d / "estate" / rel).write_text(txt)
    man = [l for l in (d / "estate/MANIFEST.csv").read_text().splitlines() if not l.startswith("Email/")]
    man += [f"{rel},{mod},Drive" for rel, (mod, txt) in strays.items()]
    (d / "estate/MANIFEST.csv").write_text("\n".join(man) + "\n")
    (d / "mail.py").write_text(MAILPY)
    shutil.copy(S / "runs/haiku-plain/KITTY-README.md", d / "KITTY-README.md")
    if arm.endswith("cov"): shutil.copy(S / "COVERAGE.md", d / "COVERAGE.md")
print(len(allm), "emails;", len(mails), "real")
