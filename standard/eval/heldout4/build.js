#!/usr/bin/env node
/* The fourth held-out household. Three blind families found real defects, and the engine was repaired after each. Repaired scores prove nothing. This one is the headline: the blind score
   of the engine as it ships, with no repairs planned after it.

   The Tamihana-Brandts of Melton, Victoria, 36 months from July 2023 to June 2026. Everything here is fictional. Renee Tamihana is a single parent who rents. She has a part-time job in aged
   care, Centrelink payments, child support for two children by two fathers, a mobile dog wash on an ABN with quarterly BAS, a car on a secured loan and buy-now-pay-later. Her son Kobi turns 18
   and leaves in April 2025. She moves into a share-house in September 2024 as lead tenant, and her housemate pays her half of the rent. The car is written off in February 2025. Her mother lends her
   the bond and gives her Christmas money. Written blind: from SPEC.md, RECIPES.md, the schemas, the public recipes, the intake, the world's file writers and the three earlier held-out folders'
   build, run and blind reports.

   Order of work, as in the earlier households: a life is simulated first and held in cents, day by day. Only then are files rendered from it, as each institution would hand them over.
   Truth is written from the simulation and never from the engine. Setup is what a person would answer at onboarding: no rules, no decisions, no opening balances a file states.

   node standard/eval/heldout4/build.js
   writes standard/.build/heldout4/{sources,manifest.json,truth.json} and standard/eval/heldout4/setup/<table>.json. Node 22, no dependencies, seeded, no clock. */
"use strict";
const fs = require("fs"), path = require("path"), zlib = require("zlib");

const STD = path.join(__dirname, "..", "..");
const LIB = path.join(STD, "world", "lib");
const { pad, fix, money, addDays, dayDiff, weekday, monthEnd, nextMonth, monthRange, fmtDate, dmy, fyOf, csvLines, Rng, MONTHS: MON } = require(path.join(LIB, "util"));
const { Doc, M: MARGIN } = require(path.join(LIB, "pdf"));
const { eml, page, row } = require(path.join(LIB, "mail"));
const { ofx } = require(path.join(LIB, "bankfiles"));

const OUT = path.join(STD, ".build", "heldout4");
const SETUP_DIR = path.join(__dirname, "setup");
const START = "2023-07-01", END = "2026-06-30", MONTHS = monthRange("2023-07", "2026-06");
const MOVE = "2024-09-14", BIZ_OPEN = "2025-01-20", KOBI_LEAVES = "2025-04-12", JOINT_CLOSE = "2024-02-15", CRASH = "2025-02-18", WRITE_OFF = "2025-03-12", NEW_CAR = "2025-03-29", MUM_LOAN = "2024-09-09", ROLL_OUT = "2024-11-28", ROLL_IN = "2024-12-03", PRIYA_OUT = "2026-01-31", JOB_END = "2025-01-31", JOB2 = "2025-02-20", JOB3 = "2025-03-20", GOAL_OPEN = "2024-02-01", GOAL_CLOSE = "2024-12-30", CENTREPAY_FROM = "2024-10-01";
const rng = (name) => new Rng(`tamihana-brandt:${name}`);
const deflate = (b) => new Uint8Array(zlib.deflateSync(b));

// ---------- who and what ----------
const RENEE = "Renee Tamihana", KOBI = "Kobi Tamihana", AVA = "Ava Brandt", LUKAS = "Lukas Brandt", RUTH = "Ruth Tamihana", PRIYA = "Priya Nair", SAM = "Sam Brennan";
const BLUE = "Bluegum Aged Care", BANK = "Banksia Home Care", BOWLS = "Riverbend Bowls Club", COUNCIL = "Melton City Council";
const EV = "ACC-EVERY", GS = "ACC-GOAL", SV = "ACC-SAVER", BZ = "ACC-BIZ", JT = "ACC-OLDJOINT", KB = "ACC-KOBI", CC = "ACC-CARD", SU = "ACC-SUPER", SO = "ACC-SUPER-OLD", CL = "ACC-CARLOAN", HP = "ACC-HELP", MU = "ACC-MUM", BN = "ACC-BNPL", BD = "ACC-BOND", CA = "ACC-CAR-A", CB = "ACC-CAR-B";
const NUM = { everyLast: "4220", saver: "0071930415", biz: "714220884310", card: "31907", superNew: "HST-8841207", superOld: "PUR-3360915", loan: "PNG-40117226", motorA: "PM-7711", motorB: "PM-8823" };
const CASH = [EV, GS, SV, BZ, JT, KB, CC];
const cardFull = () => `xxxx-xxxxxx-${NUM.card}`;

// ---------- the book: every line that ever touches an account, in cents, holder's sign ----------
const B = { seq: 0, lines: [], transit: [], pairs: [], counts: {}, traps: [] };
const count = (k, n = 1) => { B.counts[k] = (B.counts[k] || 0) + n; };
function line(acct, date, desc, cents, o = {}) { B.seq += 1; const r = { seq: B.seq, acct, date, desc, cents, ...o }; B.lines.push(r); return r; }
const spend = (acct, date, desc, cents, cat, o = {}) => line(acct, date, desc, -cents, { lens: "spending", cat, ...o });
const earn = (acct, date, desc, cents, cat, o = {}) => line(acct, date, desc, cents, { lens: "income", cat, ...o });
function own(from, dateOut, descOut, to, dateIn, descIn, cents, o = {}) {
  const a = line(from, dateOut, descOut, -cents, { xfer: true, ...o }), b = line(to, dateIn, descIn, cents, { xfer: true, ...o });
  if (dateIn > dateOut) B.transit.push({ from: dateOut, until: dateIn, cents });
  B.pairs.push({ from, date_out: dateOut, to, date_in: dateIn, cents, what: descOut });
  count("own_transfer");
  return [a, b];
}
const HOLIDAYS = new Set(["2023-09-29", "2023-11-07", "2023-12-25", "2023-12-26", "2024-01-01", "2024-01-26", "2024-03-11", "2024-03-29", "2024-04-01", "2024-04-25", "2024-06-10", "2024-09-27", "2024-11-05", "2024-12-25", "2024-12-26", "2025-01-01", "2025-01-27", "2025-03-10", "2025-04-18", "2025-04-21", "2025-04-25", "2025-06-09", "2025-09-26", "2025-11-04", "2025-12-25", "2025-12-26", "2026-01-01", "2026-01-26", "2026-03-09", "2026-04-03", "2026-04-06", "2026-06-08"]);
const isBiz = (d) => weekday(d) !== 0 && weekday(d) !== 6 && !HOLIDAYS.has(d);
const nextBiz = (d) => { while (!isBiz(d)) d = addDays(d, 1); return d; };
const prevBiz = (d) => { while (!isBiz(d)) d = addDays(d, -1); return d; };
const bizAfter = (d, n) => { let x = d; while (n > 0) { x = addDays(x, 1); if (isBiz(x)) n -= 1; } return x; };
const cents = (r, lo, hi) => Math.round(r.range(lo, hi) * 100);
const ymOf = (d) => d.slice(0, 7);
const posted = (x) => x.posted || x.date;
const byTime = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.seq - b.seq);
const byPost = (a, b) => (posted(a) < posted(b) ? -1 : posted(a) > posted(b) ? 1 : a.seq - b.seq);
const bizTo = (d) => (d < BIZ_OPEN ? EV : BZ);

/* trap register. fresh: in none of the three earlier lists. dc: a new variant of double counting or of a number silently wrong. A probe is a fact run.js can test against what the engine produced. */
function trap(id, name, where, expect, probe, o = {}) { B.traps.push({ id, name, where, expect, probe, fresh: !!o.fresh, dc: !!o.dc }); }
const plain = (x, want, extra = {}) => ({ account: x.acct, date: x.date, ...(x.posted && x.posted !== x.date ? { posted: x.posted } : {}), cents: x.cents, want, ...extra });

// ---------- merchants, all invented ----------
const MER = {
  grocer: [["COBBLEBANK FRESH", "MELTON"], ["TOOLERN PROVISIONS", "MELTON"], ["ARNOLDS CREEK GROCER", "MELTON WEST"]],
  cafe: [["SPLIT RAIL COFFEE", "MELTON"], ["THE LITTLE WOODGROVE", "MELTON"]],
  dine: [["KURUNJANG CHARCOAL", "MELTON"], ["BROOKFIELD PIZZA", "MELTON"]],
  fuel: [["WESTERN FWY FUEL", "ROCKBANK"], ["WESTERN FWY FUEL", "MELTON"]],
  shop: [["PAPER AND PINE", "CAROLINE SPRINGS"], ["TINY THREADS", "SUNSHINE"], ["BRIDGE ROAD HARDWARE", "MELTON"]],
  chem: [["HIGH STREET PHARMACY", "MELTON"]],
  kids: [["MELTON SPLASH POOL", "MELTON"], ["JUNIOR FOOTY CANTEEN", "MELTON"], ["MACPHERSON PARK SPORTS", "MELTON"]],
};
const cardDesc = (m) => `${m[0]} ${m[1]}`;
const cardCsv = (m) => `${m[0].padEnd(26)}${m[1]}  VIC`;
const pos = (m) => `EFTPOS ${m[0]} ${m[1]}`;

/* one card purchase. date is the day it was charged, which the statement shows; posted is the day the activity download shows. Lag is in business days. */
function card(r, date, m, c, cat, o = {}) {
  const lag = o.lag != null ? o.lag : r.pick([0, 0, 1, 1, 1, 2, 2, 3, 4, 5]);
  const post = o.posted || (lag ? bizAfter(date, lag) : date);
  return line(CC, date, o.desc || cardDesc(m), -c, { posted: post, csv: o.csv || cardCsv(m), member: RENEE, lens: o.lens === undefined ? "spending" : o.lens, cat, ...o.extra });
}

// ---------- everyday life ----------
const ROUND = { week: [] };
function debit(r, d, m, c, cat) {
  const x = spend(EV, d, pos(m), c, cat); count("purchase");
  // a Bark goal: each debit rounds up to the dollar, one line each; the goal saver takes one credit a week
  if (d >= GOAL_OPEN && d <= "2024-12-22" && c % 100) ROUND.week.push(line(EV, d, "ROUND UP TO GOAL SAVER", -(100 - c % 100), { xfer: true }));
  return x;
}
function everyday() {
  const r = rng("everyday"), pick = (a) => r.pick(a);
  for (let d = "2023-06-22"; d <= END; d = addDays(d, 1)) {
    const wd = weekday(d), inWin = d >= START;
    if (r.next() < 0.32) { card(r, d, pick(MER.grocer), cents(r, 28, 128), "GROCERIES"); count("purchase"); }
    if (r.next() < 0.10) { card(r, d, pick(MER.cafe), cents(r, 5, 16), "DINING"); count("purchase"); }
    if (wd === 6 && r.next() < 0.25) { card(r, d, pick(MER.dine), cents(r, 24, 62), "DINING"); count("purchase"); }
    if (r.next() < 0.09) { card(r, d, pick(MER.shop), cents(r, 14, 150), "SHOPPING"); count("purchase"); }
    if (r.next() < 0.05) { card(r, d, pick(MER.chem), cents(r, 8, 42), "HEALTH"); count("purchase"); }
    if (d.slice(8) === "11") { card(r, d, ["NORTHLIGHT STREAM", "ONLINE"], 1699, "SUBS"); count("purchase"); }
    if (!inWin) continue;
    if (r.next() < 0.38) debit(r, d, pick(MER.grocer), cents(r, 22, 110), "GROCERIES");
    if (r.next() < 0.15) debit(r, d, pick(MER.fuel), cents(r, 38, 78), "TRANSPORT");
    if (wd === 5 && r.next() < 0.5) debit(r, d, pick(MER.dine), cents(r, 18, 56), "DINING");
    if (wd === 6 && r.next() < 0.45) debit(r, d, pick(MER.kids), cents(r, 8, 44), "KIDS-ACT");
    if (r.next() < 0.012) debit(r, d, ["MELTON DENTAL AND ORTHO", "MELTON"], cents(r, 180, 620), "HEALTH");
    if (d.slice(8) === "03") { spend(EV, d, "DIRECT DEBIT KOALATEL MOBILE 5501", 3900, "TELCO"); spend(EV, d, "DIRECT DEBIT GOLDLINE INTERNET 77121", 6900, "TELCO"); count("purchase", 2); }
    if (d.slice(8) === "22" && ["02", "05", "08", "11"].includes(d.slice(5, 7))) { spend(EV, d, "BPAY MELTON PRIMARY FEES 4471", 8500, "KIDS-ACT"); count("purchase"); }
  }
  // the ATM, every week or so
  const a = rng("atm"); let d = "2023-07-02";
  while (d <= END) { const c = a.pick([10000, 15000, 15000, 20000, 20000]); ATM.push(spend(EV, d, "ATM WITHDRAWAL MELTON CENTRAL", c, "PERSONAL")); count("atm"); d = addDays(d, a.int(6, 9)); }
  trap("T4-ATM", "An ATM withdrawal is spending, whatever happens to the notes", `${EV}: ${ATM.length} lines reading "ATM WITHDRAWAL MELTON CENTRAL". WITHDRAWAL is a word in schema/matching.json's list, and no cash account is declared`, "Money that left the accounts for the household to spend. Spending, and not an open transfer waiting for a pair.",
    { kind: "lines", lines: [ATM[3], ATM[40], ATM[90]].map((x) => plain(x, "spending")) }, { fresh: true });
}
const ATM = [];

// ---------- pay: three employers, a payroll bureau, and a job with no payslips ----------
const PAY = { slips: [] };
const sgRate = (d) => (d < "2024-07-01" ? 11 : d < "2025-07-01" ? 11.5 : 12);
function slip(employer, payDate, from, to, gross, o = {}) {
  const tax = Math.round(gross * 0.08 / 100) * 100, sg = Math.round(gross * sgRate(payDate) / 100), net = gross - tax;
  const s = { person: RENEE, employer, payDate, from, to, gross, tax, super: sg, net, fy: fyOf(payDate), ...o };
  PAY.slips.push(s); count("payslip");
  return s;
}
function payroll() {
  const r = rng("pay"), split = [];
  // Bluegum: fortnightly on Fridays, part-time, each net less 60.00 to the Bark account and 60.00 to the saver
  let last = null;
  for (let d = "2023-07-14"; d <= "2025-01-24"; d = addDays(d, 14)) {
    const gross = cents(r, 940, 1160), s = slip(BLUE, d, addDays(d, -19), addDays(d, -6), gross, { split: true }), bank = d === "2024-06-28" ? "2024-07-01" : d;
    const a = earn(EV, bank, "BLUEGUM AGED CARE PAYROLL", s.net - 6000, "SALARY"), b = earn(SV, bank, "BLUEGUM AGED CARE SAVINGS", 6000, "SALARY"); split.push([a, b, s]); last = a;
  }
  trap("T4-NET-PAY-SPLIT", "One payslip, two bank credits", `${split.length} pays: each Bluegum net reaches ${EV} less 60.00, and ${SV} 60.00`, "Both credits clear the one payslip. Cash income is the net once, no open payroll clearing.",
    { kind: "lines", lines: [split[4], split[20], split[33]].flatMap(([a, b]) => [plain(a, "income"), plain(b, "income")]), clearing: "clearing:payroll:PTY-BLUEGUM" });
  const strad = split.find((x) => x[2].payDate === "2024-06-28");
  trap("T4-PAY-STRADDLE", "Pay dated in June, banked in July", `Bluegum's pay of ${money(strad[2].net)}: payslip 2024-06-28, ${EV} 2024-07-01`, "Cash income lands in July, when the money arrived.",
    { kind: "lines", lines: [plain(strad[0], "income", { month: "2024-07" })] });
  // the last pay, with leave paid out, a week after the job ended
  const fin = slip(BLUE, "2025-02-07", "2025-01-18", JOB_END, 268440, { final: true }), fa = earn(EV, "2025-02-07", "BLUEGUM AGED CARE PAYROLL", fin.net, "SALARY");
  // Banksia and the bowls club are both paid by one payroll bureau, whose name the household never gave
  const firsts = {}, pays = [];
  for (let d = JOB2; d <= END; d = addDays(d, 14)) {
    const gross = d === "2025-08-21" ? 124000 : cents(r, 1180, 1420), s = slip(BANK, d, addDays(d, -13), d, gross);
    const a = earn(EV, d, "EASYPAW PAYROLL 40113", s.net, "SALARY"); pays.push([d, s, a]); firsts[BANK] = firsts[BANK] || a;
    if (d >= JOB3) {
      const g2 = d === "2025-10-16" ? gross : cents(r, 180, 340), t = slip(BOWLS, d, addDays(d, -13), d, g2), b = earn(EV, d, "EASYPAW PAYROLL 40113", t.net, "SALARY"); pays.push([d, t, b]);
      if (d === "2025-10-16") {
        if (t.net !== s.net) throw new Error("the two pays should match");
        trap("T4-SAME-BUREAU", "Two employers on one payroll bureau, one day, one amount, one line of text", `${EV} ${d}: two credits of ${money(s.net)}, "EASYPAW PAYROLL 40113", one from each job`, "Two pays. Two lines in one file are two, each clears its own payslip, and neither is a repeat of the other.",
          { kind: "lines", lines: [{ account: EV, date: d, cents: s.net, want: "income", n: 2 }, plain(pays[2][2], "income"), plain(pays[3][2], "income")] }, { fresh: true, dc: true });
      }
    }
  }
  trap("T4-EMPLOYER-CHANGE", "Employer change, final pay with leave, payroll bureau on the bank line", `Last Bluegum pay ${fin.payDate} (${money(fin.net)}); Banksia from ${JOB2}, bank lines read "EASYPAW PAYROLL 40113"`, "Each bank line clears a payslip from the right employer. Salary, counted once, across the change.",
    { kind: "lines", lines: [plain(fa, "income"), plain(firsts[BANK], "income")] });
  // a payslip corrected and reissued for the same pay date: 14.00 hours were left off, and the difference paid five days later
  const orig = PAY.slips.find((s) => s.employer === BANK && s.payDate === "2025-08-21"), fixed = slip(BANK, orig.payDate, orig.from, orig.to, 138000, { reissueOf: orig, issued: "2025-08-25" }); orig.superseded = true; const top = earn(EV, "2025-08-26", "EASYPAW PAYROLL ADJ 40113", fixed.net - orig.net, "SALARY"); const oLine = pays.find((p) => p[1] === orig)[2];
  trap("T4-PAYSLIP-REISSUED", "A payslip corrected and reissued for one pay date", `Banksia pay of ${orig.payDate}: gross ${money(orig.gross)} first, reissued ${fixed.issued} at ${money(fixed.gross)}; ${EV} takes ${money(oLine.cents)} and then ${money(top.cents)}`, "SPEC 6.2: a restatement is decided by the later-issued document. One pay, gross once, and the two credits add to the corrected net.",
    { kind: "lines", lines: [plain(oLine, "income"), plain(top, "income")], clearing: "clearing:payroll:PTY-BANKSIA" }, { fresh: true, dc: true });
  // the school crossing, a monthly council pay with payslips behind a portal she never logs in to
  const cr = []; for (const ym of monthRange("2023-07", "2024-12")) cr.push(earn(EV, prevBiz(`${ym}-15`), "MELTON CITY COUNCIL PAY 7714", cents(r, 312, 380), "SALARY"));
  trap("T4-NO-PAYSLIP", "A job with a declared employer and no payslip ever held", `${EV}: ${cr.length} monthly credits, "MELTON CITY COUNCIL PAY 7714". The employment is in setup; no payslip file exists`, "Income. The bank line is the only witness, and the name is the employer's.",
    { kind: "lines", lines: [cr[1], cr[9], cr[17]].map((x) => plain(x, "income")) }, { fresh: true });
  const back = line(EV, "2025-03-04", "OSKO TO BLUEGUM AGED CARE OVERPAID LEAVE", -41230, { lens: "income", cat: "SALARY" });
  trap("T4-PAYROLL-CLAWBACK", "Overpaid leave paid back to the employer", `${EV} ${back.date} -412.30, to the old employer, who overpaid the final pay`, "A negative in income, not spending. It takes a question or a rule to know.",
    { kind: "lines", lines: [plain(back, "income")] }, { fresh: true, dc: true });
  const cl = [line(EV, "2025-07-03", "BANKSIA HOME CARE EXPENSE CLAIM", 8640, {}), line(EV, "2025-12-05", "BANKSIA HOME CARE EXPENSE CLAIM", 11220, {})];
  trap("T4-REIMB", "An employer's credit that is not pay", `${EV}: kilometres paid back by the employer, by name, with no payslip to clear`, "SPEC 4.4c: neither income nor spending, and not a wage. Only the credit is probed.",
    { kind: "lines", lines: cl.map((x) => plain(x, "neither")) });
}

// ---------- Centrelink, child support, Medicare ----------
function centrelink() {
  const r = rng("centrelink"), pp = [], ftb = [];
  for (let d = "2023-07-04"; d <= END; d = addDays(d, 14)) {
    const c = cents(r, 190, 320), desc = d < "2025-08-05" ? "CENTRELINK PARENTING 7741" : "CENTRELINK JOBSEEKER 7741";
    pp.push(earn(EV, d, desc, c, "x_CENTRELINK")); ftb.push(earn(EV, d, "CENTRELINK FAMILY TAX 7741", d < KOBI_LEAVES ? 62140 : 38260, "x_CENTRELINK")); count("centrelink", 2);
  }
  trap("T4-CENTRELINK", "Parenting Payment and Family Tax Benefit: two credits, one payer, one day, no payslip", `${EV}: ${pp.length} fortnights of two credits, the first a different amount each time, and renamed JOBSEEKER when Ava turns 8. A person declared the agreement in setup, with a category`, "Income. The contract says what the money is.",
    { kind: "lines", lines: [pp[2], ftb[2], pp[30], ftb[30], pp[60], ftb[60]].map((x) => plain(x, "income")) });
  const tops = [["2023-08-16", 121840], ["2024-08-14", 164035], ["2025-08-20", 98720]].map(([d, c]) => earn(EV, d, "CENTRELINK FTB TOPUP 7741", c, "x_CENTRELINK"));
  trap("T4-FTB-TOPUP", "A once-a-year balancing lump from Centrelink, beside the tax refund", `${EV}: ${tops.map((x) => `${money(x.cents)} on ${x.date}`).join(", ")}`, "Income, and not a tax refund, though it lands within days of one.",
    { kind: "lines", lines: tops.map((x) => plain(x, "income")) }, { fresh: true });
  const debt = line(EV, "2025-10-21", "SERVICES AUSTRALIA DEBT 7741", -41000, { lens: "income", cat: "x_CENTRELINK" });
  trap("T4-BENEFIT-DEBT", "An overpaid benefit taken back by a debit", `${EV} ${debt.date} -410.00: the income estimate was low and the year's overpayment comes back`, "A negative in benefit income. Not spending. It can only be learned by asking, so a question over the line is the honest best.",
    { kind: "lines", lines: [plain(debt, "income")] });
  // Medicare, under another name of the same agency
  const backs = [["2023-09-12", 4120], ["2024-02-27", 8635], ["2024-10-15", 4120], ["2025-05-20", 4385], ["2026-02-10", 4385]];
  for (const [d, c] of backs) { spend(EV, addDays(d, -2), "EFTPOS MELTON MEDICAL CENTRE", c + 3800, "HEALTH"); line(EV, d, "SERVICES AUSTRALIA MEDICARE 2291", c, { lens: "spending", cat: "HEALTH" }); count("purchase"); }
  trap("T4-MEDICARE-SA", "A Medicare refund beside a benefit from the same agency", `${EV} on ${backs.map((b) => b[0]).join(", ")}`, "Lowers HEALTH spending. Not income, whatever is done for the agency's name.",
    { kind: "lines", lines: backs.map(([d, c]) => ({ account: EV, date: d, cents: c, want: "spending" })) });
}
function childSupport() {
  const r = rng("csa"), a = [];
  for (let d = "2023-07-06"; d < KOBI_LEAVES; d = addDays(d, 14)) {
    if (d === "2024-05-09") continue;   // missed, then paid with the next
    const c = d === "2024-05-23" ? 62410 : cents(r, 240, 330); a.push(earn(EV, d, "CHILD SUPPORT PAYMENT 2291", c, "x_CHILD-SUPPORT")); count("child_support");
  }
  const big = a.find((x) => x.date === "2024-05-23");
  trap("T4-CHILD-SUPPORT", "Child support received through the agency", `${EV}: ${a.length} credits, "CHILD SUPPORT PAYMENT 2291", varying, with one catch-up. A person declared it`, "Income in the cash lens, not a refund and not unexplained.",
    { kind: "lines", lines: [a[3], big, a[30]].map((x) => plain(x, "income")) });
  const ls = [];
  for (let d = "2023-07-09"; d <= END; d = addDays(d, 14)) ls.push(earn(EV, d, "OSKO FROM L BRANDT AVA", 13000, "x_CHILD-SUPPORT"));
  trap("T4-EX-SURNAME", "Private child support from a man whose surname is a dependant's", `${EV}: ${ls.length} fortnights of 130.00, "OSKO FROM L BRANDT AVA". Ava Brandt is a member and Lukas is not. Setup has the agreement`, "Income. The surname of a member does not make it an own transfer.",
    { kind: "lines", lines: [ls[1], ls[40], ls[70]].map((x) => plain(x, "income")) }, { fresh: true, dc: true });
  const out = spend(EV, "2024-10-08", "BPAY MELTON PRIMARY CAMP 4471", 48000, "KIDS-ACT"), bk = line(EV, "2024-10-13", "OSKO FROM L BRANDT SCHOOL CAMP", 24000, { lens: "spending", cat: "KIDS-ACT" }); count("purchase");
  trap("T4-EX-CAMP", "One payer, two meanings: child support, and half a school camp", `${EV} ${bk.date} +240.00 from the same man under the same agreement, for half of ${money(-out.cents)} she paid five days before`, "Lowers spending. A contract that says child support is true of his fortnightly line and false of this one. Only a question can tell.",
    { kind: "lines", lines: [plain(bk, "spending")] }, { fresh: true, dc: true });
}

// ---------- the side business, on her personal account until January 2025 ----------
const BIZ = { q: {}, sq: [], cash: [], pp: [] };
const addQ = (d, field, c) => { const m = Number(d.slice(5, 7)), y = d.slice(0, 4), q = m <= 3 ? `${y}-03` : m <= 6 ? `${y}-06` : m <= 9 ? `${y}-09` : `${y}-12`, x = (BIZ.q[q] = BIZ.q[q] || { sales: 0, costs: 0 }); x[field] += c; };
function business() {
  const r = rng("biz");
  for (let d = "2023-07-04"; d <= END; d = addDays(d, 7)) {
    const gross = cents(r, 70, 190), fee = Math.round(gross * 0.016), net = gross - fee;
    BIZ.sq.push(earn(bizTo(d), d, "SQUAREPAW PAYOUT 88213", net, "x_BUSINESS")); addQ(d, "sales", gross); count("platform_payout");
  }
  trap("T4-SIDE-INCOME", "A side business on a payment platform, paid net in weekly batches, then to a new account", `${BIZ.sq.length} payouts, "SQUAREPAW PAYOUT 88213", to ${EV} and from ${BIZ_OPEN} to ${BZ}. An activity is in setup. The BAS and the platform's reports have no public recipe`, "Income at the net amount paid, on the bank line, the only witness a public recipe can read.",
    { kind: "lines", lines: [BIZ.sq[8], BIZ.sq[70], BIZ.sq[130]].map((x) => plain(x, "income")) });
  for (let d = "2023-07-07"; d <= END; d = addDays(d, 14)) { const c = Math.round(r.range(10, 26)) * 500; BIZ.cash.push(earn(bizTo(d), d, "CASH DEPOSIT MELTON CENTRAL", c, "x_BUSINESS")); addQ(d, "sales", c); }
  trap("T4-CASH-TAKINGS", "Cash takings banked at a branch, no payer on the line", `${BIZ.cash.length} deposits, "CASH DEPOSIT MELTON CENTRAL"`, "Income. It takes a question to know: a deposit is the word in schema/matching.json, and it has no other side.",
    { kind: "lines", lines: [BIZ.cash[5], BIZ.cash[60]].map((x) => plain(x, "income")) }, { fresh: true });
  // PayPal runs both ways: a shop she buys from, and a rail her online bookings arrive on
  for (const ym of MONTHS) {
    spend(EV, nextBiz(`${ym}-09`), "PAYPAL *PETSUPPLYHUT 4029357733", cents(r, 34, 88), "WORK-EQUIP"); count("purchase");
    const d = nextBiz(`${ym}-24`), c = cents(r, 60, 200); BIZ.pp.push(earn(bizTo(d), d, "PAYPAL TRANSFER 7741902", c, "x_BUSINESS")); addQ(d, "sales", c);
  }
  trap("T4-PAYPAL", "One rail both ways: purchases out and business takings in", `${EV}: a monthly "PAYPAL *PETSUPPLYHUT" debit; ${BIZ.pp.length} monthly credits, "PAYPAL TRANSFER 7741902"`, "The credits are income, not refunds of the debits, though the household has paid PayPal every month. If they read as refunds, income and spending both come out low.",
    { kind: "lines", lines: [BIZ.pp[4], BIZ.pp[17], BIZ.pp[30]].map((x) => plain(x, "income")) }, { fresh: true, dc: true });
  for (const ym of MONTHS) { const c = cents(r, 40, 120), d = nextBiz(`${ym}-17`); spend(bizTo(d), d, "BPAY PAWWASH WHOLESALE 71102", c, "WORK-EQUIP"); addQ(d, "costs", c); count("purchase"); }
  // a hydrobath in the June quarter of 2024 puts the BAS in credit
  const bath = spend(EV, "2024-05-21", "BPAY HYDROWASH EQUIPMENT 90133", 770000, "WORK-EQUIP"); addQ(bath.date, "costs", 770000); count("purchase");
  const bas = [];
  for (const q of Object.keys(BIZ.q).sort()) {
    const x = BIZ.q[q], gst = Math.round(x.sales / 11) - Math.round(x.costs / 11), m = Number(q.slice(5)), due = nextBiz(`${m === 12 ? `${Number(q.slice(0, 4)) + 1}-02` : `${q.slice(0, 4)}-${pad(m + 2, 2)}`}-28`);
    x.gst = gst; x.due = due; if (due > END) continue;
    if (gst >= 0) bas.push(line(bizTo(due), due, "BPAY ATO BAS 551004412339221", -gst, { bas: true }));
    else BIZ.credit = line(bizTo(due), bizAfter(due, 3), "ATO EFT REFUND 66204 BAS", -gst, { bas: true });
    count("bas");
  }
  trap("T4-BAS-PAY", "GST paid over each quarter, money that was never hers", `${bas.length} lines, "BPAY ATO BAS 551004412339221", from whichever account the business was using`, "Neither spending nor income: the tax position, schema/events.json bas_payment. The statements behind them have no public recipe.",
    { kind: "lines", lines: [bas[1], bas[6]].map((x) => plain(x, "neither")) }, { fresh: true, dc: true });
  trap("T4-BAS-REFUND", "A BAS in credit: a credit from the tax office with no notice of assessment", `${BIZ.credit.acct} ${BIZ.credit.date}: ${money(BIZ.credit.cents)}, "ATO EFT REFUND 66204 BAS", nine days after the year's notice of assessment`, "Neither. It must not clear the notice of assessment, and it is not income.",
    { kind: "lines", lines: [plain(BIZ.credit, "neither")] }, { fresh: true, dc: true });
}

// ---------- rent, a share-house, a bond ----------
const LEASE = { rows: [] };
function housing() {
  const rent1 = [], rent2 = [], her = [], sam = [];
  for (let d = "2023-07-03"; d <= "2024-09-02"; d = addDays(d, 14)) { const c = d < "2024-01-08" ? 84000 : 88000; rent1.push(spend(EV, d, "RENTPAW MELTON REALTY 40771", c, "x_RENT-PAID")); LEASE.rows.push({ d, c }); count("rent_payment"); }
  for (let d = "2024-09-16"; d <= END; d = addDays(d, 14)) {
    const c = d < "2025-10-06" ? 132000 : 138000, half = c / 2;
    if (d === "2025-05-26") {
      // the debit bounces, comes back with a fee, and goes through four days later
      const x = spend(EV, d, "RENTPAW COBBLEBANK REALTY 51220", c, "x_RENT-PAID"), y = line(EV, "2025-05-27", "DISHONOUR REVERSAL RENTPAW COBBLEBANK REALTY 51220", c, { lens: "spending", cat: "x_RENT-PAID" }), z = spend(EV, "2025-05-27", "DISHONOUR FEE", 900, "FEES"), w = spend(EV, "2025-05-30", "RENTPAW COBBLEBANK REALTY 51220", c, "x_RENT-PAID"); LEASE.rows.push({ d, c });
      trap("T4-DISHONOUR", "A rent debit that bounces and is re-presented", `${EV}: rent ${x.date}, reversed ${y.date} with a 9.00 fee, debited again ${w.date}`, "The reversal cancels the first debit: rent counts once, the fee once, nothing is income.",
        { kind: "lines", lines: [plain(y, "spending"), plain(x, "spending"), plain(w, "spending"), plain(z, "spending")] });
    } else { rent2.push(spend(EV, d, "RENTPAW COBBLEBANK REALTY 51220", c, "x_RENT-PAID")); LEASE.rows.push({ d, c }); }
    count("rent_payment");
    const p = addDays(d, 1);
    if (d === "2024-12-09") continue;                 // Priya pays two at once at Christmas
    if (d <= PRIYA_OUT) her.push(line(EV, d === "2024-12-23" ? "2024-12-24" : p, "OSKO FROM P NAIR RENT", d === "2024-12-23" ? c : half, { lens: "spending", cat: "x_RENT-PAID" }));
    else sam.push(line(EV, p, "OSKO FROM S BRENNAN RENT", half, { lens: "spending", cat: "x_RENT-PAID" }));
  }
  trap("T4-RENT", "A tenant's rent through a payment app, and a new agent after a move", `${EV}: ${rent1.length} fortnights to Melton Realty, ${rent2.length} to Cobblebank Realty, "RENTPAW"`, "Spending, at its cash amount, under the category the lease in setup carries. A lease is not rent received.",
    { kind: "lines", lines: [rent1[3], rent1[22], rent2[5], rent2[30]].map((x) => plain(x, "spending")) }, { fresh: true });
  const dbl = her.find((x) => x.cents === 132000);
  trap("T4-HOUSEMATE-RENT", "A lead tenant pays all the rent; housemates pay her back half", `${EV}: ${her.length} credits from Priya, one of them two fortnights at once, then ${sam.length} from Sam, a day after each 1,320.00 debit. Both are in setup with the rent category, because a person would say so`, "Each credit lowers rent. Rent is what she bears, half. Read as income, unexplained or nothing, spending is double and the household looks poorer than it is.",
    { kind: "lines", lines: [her[2], dbl, her[20], sam[3]].map((x) => plain(x, "spending")) }, { fresh: true, dc: true });
  const pow = [];
  const bond1 = line(EV, MUM_LOAN, "OSKO FROM R TAMIHANA BOND LOAN", 150000, {}), bn = line(EV, "2024-09-10", "BPAY RTBA BOND 7733018", -286000, {}), bp = line(EV, "2024-09-12", "OSKO FROM P NAIR BOND", 143000, {}); line(MU, MUM_LOAN, "Loan from Mum", -150000, {});
  line(BD, bn.date, "Bond lodged", 286000, {}); line(BD, bp.date, "Priya's half is hers", -143000, {});
  const ref = line(EV, "2024-09-27", "RTBA BOND REFUND 7731902", 316000, {}); line(BD, ref.date, "Old bond returned", -316000, {}); line(BD, ref.date, "Cleaning paid to the old landlord from the bond", -20000, {});
  trap("T4-BOND", "A bond out and a bond back, less a deduction, on a declared account", `${BD}: ${money(OPEN[BD])} at the start. ${money(-bn.cents)} lodged ${bn.date}. ${money(ref.cents)} back ${ref.date}, the other 200.00 paid to the landlord with no bank line. Declared in setup as money the authority holds`, "Their own money moving: neither, both ways, and the account follows it.",
    { kind: "lines", lines: [plain(bn, "neither"), plain(ref, "neither")], balances: [{ account: BD, months: ["2024-08", "2024-09", "2025-06"] }] });
  const po = line(EV, addDays(PRIYA_OUT, 3), "OSKO TO P NAIR BOND", -143000, {}), si = line(EV, addDays(PRIYA_OUT, 2), "OSKO FROM S BRENNAN BOND", 143000, {});
  trap("T4-HOUSEMATE-BOND", "The same housemate, the same rail, and money that is not rent", `${EV}: +1,430.00 from Priya for her half of the bond, and in 2026 1,430.00 out to her and in from Sam. Her contract in setup says rent`, "Neither. If the contract's category takes them, 1,430.00 comes off rent and nothing says so. Only a question can tell.",
    { kind: "lines", lines: [plain(bp, "neither"), plain(po, "neither"), plain(si, "neither")] }, { fresh: true, dc: true });
  LEASE.pow = pow;
  // the mother's loan, her gifts, and Renee's own transfers, all reading the same on the line
  const reps = []; for (const ym of monthRange("2024-11", "2026-01")) { const d = nextBiz(`${ym}-06`); reps.push(line(EV, d, "OSKO TO R TAMIHANA LOAN", -10000, {})); line(MU, d, "Repayment", 10000, {}); }
  trap("T4-MUM-LOAN", "A loan from her mother, whose initial and surname are her own", `${EV}: +1,500.00 ${bond1.date}, then ${reps.length} repayments of 100.00. ${MU} is declared as a debt, and her own transfers read "OSKO FROM R TAMIHANA" too`, "Neither income nor spending, and she owes the balance. The mirror of a loan to a son.",
    { kind: "lines", lines: [plain(bond1, "neither"), plain(reps[0], "neither"), plain(reps[9], "neither")], balances: [{ account: MU, months: ["2024-09", "2025-06", "2026-06"] }] });
  const gifts = ["2023-12-19", "2025-12-18"].map((d) => earn(EV, d, "OSKO FROM R TAMIHANA", 30000, "GIFT-IN"));
  trap("T4-MUM-GIFT", "A gift from the same mother, on the same account as her loan", `${EV}: 300.00 at Christmas, ${gifts.map((x) => x.date).join(" and ")}. One of the Christmases falls inside the loan, and a contract that says loan is false of it`, "Income under GIFT-IN. Not a further draw on the loan, not an own transfer.",
    { kind: "lines", lines: gifts.map((x) => plain(x, "income")) }, { fresh: true, dc: true });
  const ow = own(SV, "2024-12-18", "OSKO TO R TAMIHANA", EV, "2024-12-18", "OSKO FROM R TAMIHANA", 30000), mum = earn(EV, "2024-12-19", "OSKO FROM R TAMIHANA", 30000, "GIFT-IN");
  trap("T4-SAME-NAME-MUM", "Two identical credits a day apart: her own transfer and her mother's gift", `${EV}: +300.00 on ${ow[1].date} from her own saver, +300.00 on ${mum.date} from her mother, the same words. ${SV} has one debit`, "One is a transfer and one is income, whichever pairs. If both go, 300.00 of income vanishes. If neither pairs, the saver's debit reads as spending.",
    { kind: "lines", lines: [{ account: EV, date: ow[1].date, cents: 30000, want: "mixed:income,neither", n: 2, wide: 1 }, plain(ow[0], "neither")] }, { fresh: true, dc: true });
  // the settlement of the old home with Lukas, through his solicitor
  const set = line(EV, "2024-03-14", "WESTGATE FAMILY LAWYERS TRUST SETTLEMENT", 2200000, { capital: true });
  trap("T4-PROPERTY-SETTLEMENT", "A family-law property settlement through a solicitor's trust account", `${EV} ${set.date}: ${money(set.cents)}`, "Capital: her share of something she already part-owned. Neither income nor a refund. A person can only tell it apart from an estate by saying so.",
    { kind: "lines", lines: [plain(set, "neither")] }, { fresh: true, dc: true });
}

// ---------- the car, its loan, its insurance, and the crash ----------
const LOANS = { car: [], carLines: [], payout: 0 };
const MOTOR = { policy: [] };
const dailyInterest = (bal, pct) => Math.abs(bal) * Number(pct) / 100 / 365;
function carLoan() {
  let bal = OPEN[CL], accrued = 0;
  const push = (d, desc, c) => { bal += c; LOANS.carLines.push({ date: d, desc, cents: c, balance: bal }); return line(CL, d, desc, c, {}); };
  for (const ym of monthRange("2023-07", "2025-03")) {
    const open = bal; let paid = 0, charged = 0;
    for (let d = `${ym}-01`; d <= monthEnd(ym); d = addDays(d, 1)) {
      if (d === nextBiz(`${ym}-05`) && d < WRITE_OFF) { push(d, "REPAYMENT DIRECT DEBIT", 38600); paid += 38600; spend(EV, d, "PING FINANCE LOAN REPAYMENT 40117226", 38600, "CAR"); count("loan_repayment"); }
      accrued += dailyInterest(bal, "10.95");
      if (d === WRITE_OFF) {
        const i = Math.round(accrued); accrued = 0; push(d, "INTEREST TO PAYOUT", -i); charged += i;
        const owed = -bal; push(d, "INSURANCE PAYOUT RECEIVED", owed); paid += owed; LOANS.payout = owed;
        LOANS.car.push({ ym, rate: "10.95", open, interest: charged, paid, close: bal });
        return;
      }
    }
    const i = Math.round(accrued); accrued = 0; push(monthEnd(ym), "INTEREST CHARGED", -i); charged += i;
    LOANS.car.push({ ym, rate: "10.95", open, interest: charged, paid, close: bal });
    count("loan_interest");
  }
}
function car() {
  // the insurance is an annual policy paid by the month
  const prem = [];
  for (let d = "2023-08-20"; d < WRITE_OFF; d = addDays(`${nextMonth(d.slice(0, 7))}-01`, 19)) prem.push(spend(EV, nextBiz(d), `PURRSURE MOTOR ${NUM.motorA}`, 9600, "CAR"));
  for (let d = "2025-04-20"; d <= END; d = addDays(`${nextMonth(d.slice(0, 7))}-01`, 19)) prem.push(spend(EV, nextBiz(d), `PURRSURE MOTOR ${NUM.motorB}`, 8400, "CAR"));
  count("purchase", prem.length);
  MOTOR.policy.push({ from: "2023-08-01", to: "2024-07-31", amt: 115200, paid: "2023-08-01", sum: 1450000, excess: 80000, number: NUM.motorA, situ: "Mazda hatch" }, { from: "2024-08-01", to: "2025-07-31", amt: 115200, paid: "2024-08-01", sum: 1300000, excess: 80000, number: NUM.motorA, situ: "Mazda hatch" }, { from: "2025-04-01", to: "2026-03-31", amt: 100800, paid: "2025-04-01", sum: 850000, excess: 80000, number: NUM.motorB, situ: "Toyota hatch" }, { from: "2026-04-01", to: "2027-03-31", amt: 100800, paid: "2026-04-01", sum: 800000, excess: 80000, number: NUM.motorB, situ: "Toyota hatch" });
  trap("T4-POLICY-MONTHLY", "A year's premium on a certificate, paid by the month", `${EV}: ${prem.length} debits of 96.00 and 84.00; each certificate says the year's 1,152.00 or 1,008.00 is paid`, "Spending at each debit. The certificate is a witness and adds nothing, and no line of 1,152.00 exists.",
    { kind: "lines", lines: [prem[2], prem[14], prem[24]].map((x) => plain(x, "spending", { n: 1 })), absent: [{ account: EV, date: "2023-08-01", cents: -115200 }, { account: EV, date: "2024-08-01", cents: -115200 }] }, { fresh: true, dc: true });
  spend(EV, addDays(CRASH, 7), `PURRSURE CLAIM EXCESS ${NUM.motorA}`, 80000, "CAR"); count("purchase");
  // written off at 12,000.00. The insurer pays the financier direct, with no line on any bank file, and sends her what is left
  const sur = line(EV, "2025-03-19", `PURRSURE CLAIM SETTLEMENT ${NUM.motorA}`, 1200000 - LOANS.payout, { capital: true });
  trap("T4-INSURER-PAYOUT", "A loan paid out by an insurer, with no bank line", `${CL}: ${money(LOANS.payout)} paid to the lender by Purrsure on ${WRITE_OFF}. No account of hers moves`, "The loan ends at the lender's zero. No repayment reaches spending. What cleared it has no witness but the statement, so an open item is honest.",
    { kind: "lines", clearing: "clearing:loan:ACC-CARLOAN", zero_after: { account: CL, from: "2025-03" }, balances: [{ account: CL, months: ["2024-12", "2025-02"] }] });
  trap("T4-INSURER-SURPLUS", "A credit from an insurer the household pays every month that is not a refund", `${EV} ${sur.date}: ${money(sur.cents)}, what the write-off left after the lender. The car is closed in setup on ${WRITE_OFF}`, "SPEC 6.5 calls a credit a refund only from someone the household has paid, and here that reading is wrong: it is the car turning into cash. Neither, and the car leaves net worth.",
    { kind: "lines", lines: [plain(sur, "neither")], zero_after: { account: CA, from: "2025-03" } });
  const back = line(EV, "2025-03-24", `PURRSURE PREMIUM REFUND ${NUM.motorA}`, 28800, { lens: "spending", cat: "CAR" });
  trap("T4-PREMIUM-REFUND", "Two credits from one insurer in a week: one a refund, one not", `${EV} ${back.date}: 288.00 of unused premium, five days after the claim money, with the same policy number`, "This one is a refund and lowers CAR spending. Whatever is done for the claim must not take this with it.",
    { kind: "lines", lines: [plain(back, "spending")] }, { fresh: true, dc: true });
  const nc = line(EV, NEW_CAR, "OSKO TO D VANCE CAR", -850000, { capital: true });
  trap("T4-PRIVATE-CAR", "A car bought from a stranger by Osko", `${EV} ${nc.date}: ${money(-nc.cents)} to a private seller; ${CB} is declared from that day at that value`, "Capital, neither spending. Net worth does not fall.",
    { kind: "lines", lines: [plain(nc, "neither")], balances: [{ account: CB, months: ["2025-03", "2025-12"] }], zero_before: { accounts: [CB], until: "2025-03" } }, { fresh: true });
}

// ---------- buy now, pay later, and pay day early ----------
const AFTER = { orders: [], receipts: [] };
function bnpl() {
  const inst = [];
  const order = (d, name, total, o = {}) => {
    const c = total / 4; line(BN, d, `Order ${name}`, -total, {}); count("bnpl_order");
    const ls = []; for (let i = 0; i < (o.paid || 4); i += 1) { const w = addDays(d, 14 * i); ls.push(spend(EV, w, "AFTERPAWS INSTALMENT 8841", c, o.cat || "SHOPPING")); line(BN, w, "Instalment", c, {}); }
    inst.push(...ls); AFTER.orders.push({ d, name, total, ls }); return ls;
  };
  order("2023-08-19", "PAPER AND PINE", 24000); order("2023-11-25", "TINY THREADS", 32000);
  const fr = order("2024-03-09", "POLARBEAR APPLIANCES", 124000); AFTER.receipts.push({ merchant: "Polarbear Appliances", date: "2024-03-09", item: "Polarbear 420L fridge", kind: "appliance", serial: "PB-420-77120", warranty: "2026-03-09", paid: "Afterpaws", gst: Math.round(124000 / 11), total: 124000 });
  const rt = order("2024-11-02", "TINY THREADS", 32000, { paid: 2 });
  order("2025-04-12", "BRIDGE ROAD HARDWARE", 18000); order("2025-08-30", "PAPER AND PINE", 28000); order("2025-11-22", "TINY THREADS", 36000); order("2026-03-14", "PAPER AND PINE", 20000);
  order("2026-06-13", "TINY THREADS", 24000, { paid: 2 });
  trap("T4-BNPL-RECEIPT", "One receipt for a purchase paid in four instalments", `${EV}: 310.00 four times from 2024-03-09, "AFTERPAWS INSTALMENT 8841"; a receipt for 1,240.00 that says Afterpaws`, "Spending of 1,240.00 across four lines, once. The receipt adds detail, no line carries its total, and the fridge is not a second 1,240.00.",
    { kind: "lines", lines: fr.map((x) => plain(x, "spending", { n: 1 })), absent: [{ account: EV, date: "2024-03-09", cents: -124000 }] }, { fresh: true, dc: true });
  const back = line(EV, "2024-11-20", "AFTERPAWS REFUND 8841", 16000, { lens: "spending", cat: "SHOPPING" }); line(BN, "2024-11-20", "Return, order cancelled", 32000, {}); line(BN, "2024-11-20", "Refund paid to you", -16000, {});
  trap("T4-BNPL-REFUND", "A return on a four-part purchase: two instalments back, two never taken", `${EV}: two instalments of 80.00, then +160.00 on ${back.date}, and the last two never appear`, "Lowers SHOPPING. The order nets to nothing, and the household owes nothing on it.",
    { kind: "lines", lines: [plain(back, "spending"), ...rt.map((x) => plain(x, "spending"))] }, { fresh: true, dc: true });
  const late = spend(EV, "2025-09-13", "AFTERPAWS LATE FEE 8841", 1000, "FEES"); count("purchase");
  void late;
  trap("T4-BNPL-DEBT", "What is still owed on instalments, on a declared debt with no file", `${BN}: declared in setup as a debt, and Afterpaws gives no download. At 2026-06 she owes 120.00 on an order of 240.00. Purchases never reach a bank line until an instalment is paid`, "The debt is what the app shows, whether or not it was read. A balance that climbs with each instalment paid, with no purchases to set against it, is the wrong sign of a real debt and looks like an asset.",
    { kind: "lines", balances: [{ account: BN, months: ["2023-12", "2024-03", "2026-06"] }] }, { fresh: true, dc: true });
  // a wage-advance app: a loan against payday, a repayment and a fee
  const adv = [];
  for (const [a, b] of [["2024-02-05", "2024-02-09"], ["2024-04-29", "2024-05-03"], ["2024-08-05", "2024-08-09"], ["2024-10-14", "2024-10-18"], ["2025-03-31", "2025-04-03"], ["2025-11-24", "2025-11-27"]]) {
    const x = line(EV, a, "BEFOREPAW ADVANCE 77120", 20000, {}), y = line(EV, b, "BEFOREPAW REPAYMENT 77120", -20000, {}), z = spend(EV, b, "BEFOREPAW FEE 77120", 1000, "FEES"); adv.push([x, y, z]); count("wage_advance");
  }
  trap("T4-WAGE-ADVANCE", "A wage-advance app: a credit that is a loan, and a payday debit that repays it", `${EV}: ${adv.length} times, +200.00, then -200.00 and a 10.00 fee on payday, "BEFOREPAW"`, "The fee is spending. The credit is not income, and from the second time on it is not a refund of what she has paid them. It is borrowed money.",
    { kind: "lines", lines: [adv[0], adv[2], adv[5]].flatMap(([x, y, z]) => [plain(x, "neither"), plain(y, "neither"), plain(z, "spending")]) }, { fresh: true, dc: true });
}

// ---------- the family's old accounts ----------
function oldJoint() {
  // a joint account with Lukas, who was never in this household, until it is split
  for (const d of ["2023-09-29", "2023-12-29"]) line(JT, d, "INTEREST CREDIT", 1120, { lens: "income", cat: "INTEREST" });
  const bal = OPEN[JT] + 2240, half = Math.ceil(bal / 2), rest = bal - half;
  const [a, b] = own(JT, JOINT_CLOSE, "TFR TO R TAMIHANA CLOSING", EV, JOINT_CLOSE, "TFR FROM JOINT CLOSING", half), c = line(JT, JOINT_CLOSE, "OSKO TO L BRANDT SHARE OF JOINT", -rest, { third: true });
  LEASE.jointHalf = half;
  trap("T4-EX-JOINT", "A joint account with someone who is not in the household, from the first day", `${JT}: half Lukas's by every basis in setup, and he is no member at any date. ${money(OPEN[JT])} to start, closed ${JOINT_CLOSE}`, "SPEC 6.6: a household holds what its members own. The balance stays whole and net worth takes half. The mirror of a joiner, with no join date to read.",
    { kind: "lines", excluded: ["2023-08", "2023-10", "2024-01"].map((m) => ({ group: "cash", accounts: "cash", named: JT, month: m, want: Math.ceil((OPEN[JT] + (m >= "2023-10" ? 1120 : 0) + (m >= "2024-01" ? 1120 : 0)) / 2), tolerance: 1 })), lines: [half === rest ? { account: JT, date: JOINT_CLOSE, cents: -half, want: "neither", n: 2 } : plain(a, "neither"), plain(b, "neither"), ...(half === rest ? [] : [plain(c, "neither")])] }, { fresh: true, dc: true });
}
function kobi() {
  const r = rng("kobi"), pocket = [];
  for (let d = "2023-07-02"; d < KOBI_LEAVES; d = addDays(d, 14)) pocket.push(own(EV, d, "OSKO TO K TAMIHANA POCKET MONEY", KB, d, "OSKO FROM R TAMIHANA", 4000));
  for (const ym of monthRange("2023-07", "2025-03")) spend(KB, nextBiz(`${ym}-12`), "CARD PURCHASE GAMEPAW ONLINE", cents(r, 12, 34), "KIDS-ACT");
  const w = []; for (let d = "2024-11-08"; d < KOBI_LEAVES; d = addDays(d, 14)) w.push(earn(KB, d, "BURGERPAW PAYROLL 77120", cents(r, 180, 320), "SALARY"));
  trap("T4-POCKET", "Pocket money to a teenager's account the family does track", `${EV} to ${KB}, ${pocket.length} fortnights of 40.00. Both sides are declared and he is a member`, "Own money inside the household: neither. In the first household the account was untracked and it was spending; here the other side is on file.",
    { kind: "lines", lines: [pocket[3], pocket[30]].flatMap(([a, b]) => [plain(a, "neither"), plain(b, "neither")]) });
  trap("T4-TEEN-WAGE", "A dependant's wage on his own account, no payslip, no employer in setup", `${KB}: ${w.length} credits, "BURGERPAW PAYROLL 77120", from ${w[0].date}`, "Income while he is a member: the account is in scope and in the cash group. A question is the honest best.",
    { kind: "lines", lines: [w[0], w[6]].map((x) => plain(x, "income")) }, { fresh: true });
}

// ---------- bills, childcare ----------
const BILLS = { energy: [], water: [] };
const KIDS = { statements: [] };
function bills() {
  const r = rng("bills"), pows = [];
  for (const q of ["2023-09", "2023-12", "2024-03", "2024-06", "2024-09", "2024-12", "2025-03", "2025-06", "2025-09", "2025-12", "2026-03"]) {
    const billDate = `${nextMonth(q)}-06`, amt = cents(r, 240, 420), gst = Math.round(amt / 11), paid = addDays(billDate, 17);
    BILLS.energy.push({ billDate, due: addDays(billDate, 21), from: addDays(`${q}-01`, -61), to: monthEnd(q), amt, gst, account: "GP-7730915" });
    const x = spend(EV, paid, "BPAY GOLDLINE POWER 7730915", amt, "UTILITIES"); count("bill_paid"); pows.push(x);
    if (paid > "2024-09-30" && paid < PRIYA_OUT) { const c = Math.round(amt / 2); LEASE.pow.push(line(EV, addDays(paid, 2), "OSKO FROM P NAIR POWER", c, { lens: "spending", cat: "UTILITIES" })); }
  }
  trap("T4-BILL-WITNESS", "A power bill and the bank line that pays it", `${EV} ${pows[3].date}: ${money(-pows[3].cents)}`, "Spending once. The bill clears against the line.", { kind: "lines", lines: [plain(pows[3], "spending", { n: 1 })] });
  trap("T4-HOUSEMATE-POWER", "A housemate's half of the power bill", `${EV}: ${LEASE.pow.length} credits, "OSKO FROM P NAIR POWER"`, "Lowers spending. The line names someone in setup under the rent contract: the category is arguable and the lens is not.",
    { kind: "lines", lines: [LEASE.pow[0], LEASE.pow[3]].map((x) => plain(x, "spending")) }, { fresh: true, dc: true });
  // water at the first place by BPAY; at the share-house by Centrepay, taken out of the benefit before it reaches the bank
  const paidLines = [], unpaid = [];
  for (const q of ["2023-08", "2023-11", "2024-02", "2024-05", "2024-08", "2024-11", "2025-02", "2025-05", "2025-08", "2025-11", "2026-02", "2026-05"]) {
    const usage = cents(r, 38, 88), service = 0, wb = `${q}-11`, wd = `${q}-27`, b = { billDate: wb, due: wd, from: addDays(wb, -92), to: addDays(wb, -2), usage, service, amt: usage + service }; BILLS.water.push(b);
    if (wb < CENTREPAY_FROM) { paidLines.push(spend(EV, addDays(wd, -1), "BPAY WESTERN REACH WATER 60331907", usage + service, "UTILITIES")); count("bill_paid"); } else unpaid.push(b);
  }
  trap("T4-CENTREPAY", "A bill paid from a benefit before the benefit reaches the bank", `${unpaid.length} water bills from 2024-11 paid by Centrepay. Each arrives as a document, and no account of hers shows the money, in or out`, "Nothing in the cash lens. A bill is a witness and not an expense: it must not recognise a cost, and the benefit credit is the smaller amount. A bill with no payment may be asked about.",
    { kind: "lines", absent: unpaid.slice(0, 4).map((b) => ({ account: EV, date: b.due, cents: -b.amt })), lines: [plain(paidLines[1], "spending", { n: 1 })] }, { fresh: true, dc: true });
  // after-school care for Ava: a gross fee, a subsidy paid direct, a gap debited
  const kr = rng("kids"), gaps = [];
  for (const ym of monthRange("2023-07", "2024-12")) {
    if (ym.slice(5) === "01") continue;
    const days = kr.int(8, 12), gross = days * 3350, subsidy = Math.round(gross * 0.85), gap = gross - subsidy;
    KIDS.statements.push({ ym, child: AVA, days, gross, subsidy, gap }); gaps.push(spend(EV, nextBiz(`${nextMonth(ym)}-09`), "KITTENHOOD OSHC MELTON 5512", gap, "CHILDCARE")); count("childcare_gap");
  }
  trap("T4-CCS", "After-school care: gross fee, subsidy, gap", `${EV}: ${gaps.length} monthly gaps; each statement shows the gross and the subsidy, which no account sees`, "Spending is the gap, once. The subsidy is neither income nor a cash line.",
    { kind: "lines", lines: [gaps[2], gaps[9]].map((x) => plain(x, "spending", { n: 1 })) });
}

// ---------- super: two funds, a rollover, an offset, and a HELP debt ----------
const SUPER = { list: [], old: [], listo: null };
function superFunds() {
  const r = rng("super");
  const sumSuper = (emp, ym) => PAY.slips.filter((s) => s.employer === emp && ymOf(s.payDate) === ym && !s.superseded).reduce((t, s) => t + s.super, 0);
  const contrib = (d, desc, c) => { SUPER.list.push({ date: d, type: "employer", desc, cents: c }); SUPER.list.push({ date: d, type: "contributions_tax", desc: "Contributions tax", cents: -Math.round(c * 0.15) }); };
  for (const ym of MONTHS) { const prev = monthRange("2023-06", ym).slice(-2)[0]; for (const [emp, name] of [[BLUE, "Bluegum"], [BANK, "Banksia"], [BOWLS, "Riverbend"]]) { const c = sumSuper(emp, prev); if (c) contrib(`${ym}-14`, `SG contribution ${name}`, c); } }
  // the old fund, from a job years ago: earnings, a fee, and a rollover out
  { let bal = OPEN[SO]; const out = [];
    for (const ym of monthRange("2023-07", "2024-11")) { const e = ym === "2024-11" ? ROLL_OUT : monthEnd(ym), earned = Math.round(bal * r.range(-0.009, 0.015)); bal += earned; out.push({ date: e, type: "earnings", desc: "Investment earnings", cents: earned, balance: bal }); bal -= 650; out.push({ date: e, type: "fee", desc: "Administration fee", cents: -650, balance: bal }); }
    out.push({ date: ROLL_OUT, type: "rollover_out", desc: "Rollover to HESTAbby", cents: -bal, balance: 0 }); SUPER.rolled = bal; bal = 0;
    SUPER.old = out; for (const x of out) line(SO, x.date, x.desc, x.cents, { superType: x.type }); }
  SUPER.list.push({ date: ROLL_IN, type: "rollover_in", desc: "Rollover from Purrannuation", cents: SUPER.rolled });
  B.transit.push({ from: ROLL_OUT, until: ROLL_IN, cents: SUPER.rolled });
  SUPER.list.push({ date: "2025-02-19", type: "listo", desc: "Low income super tax offset", cents: 31240 });
  let bal = OPEN[SU]; const out = [];
  for (const ym of MONTHS) {
    for (const x of SUPER.list.filter((l) => ymOf(l.date) === ym).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))) { bal += x.cents; out.push({ ...x, balance: bal }); }
    const e = monthEnd(ym), earned = Math.round(bal * r.range(-0.011, 0.017)); bal += earned; out.push({ date: e, type: "earnings", desc: "Investment earnings", cents: earned, balance: bal });
    bal -= 700; out.push({ date: e, type: "fee", desc: "Administration fee", cents: -700, balance: bal }); bal -= 1420; out.push({ date: e, type: "insurance", desc: "Insurance premium", cents: -1420, balance: bal });
  }
  SUPER.lines = out; for (const x of out) line(SU, x.date, x.desc, x.cents, { superType: x.type });
  trap("T4-SUPER-ROLLOVER", "An old fund rolled into the new one, on a line type the old fund's recipe does not map", `${SO}: ${money(SUPER.rolled)} leaves ${ROLL_OUT} and reaches ${SU} ${ROLL_IN}. The new fund's ROLLIN is in the public map. The old fund's ROLL-OUT is not, so the half-year file holding it is refused whole`, "One balance, moving. If the old fund stays at its last read figure while the new fund takes the rollover, those dollars count twice in net worth, and it must be named.",
    { kind: "lines", balances: [{ account: SO, months: ["2024-12", "2025-06", "2026-06"], strict: true }], must_name: { stream: SO, months: ["2024-07"] } }, { fresh: true, dc: true });
  trap("T4-LISTO", "A government offset into super, on a line type no public recipe maps", `${SU}: +312.40 on 2025-02-19, "Low income super tax offset". She qualifies once, in the year her income was low enough. The half-year JSON holding it and the year's PDF are refused`, "The balance is the fund's. A file refused for one line leaves six months of contributions, earnings and fees unread. It must be named as not held.",
    { kind: "lines", balances: [{ account: SU, months: ["2025-03", "2025-06", "2025-09", "2026-06"], strict: true }], must_name: { stream: SU, months: ["2025-01"] } }, { fresh: true, dc: true });
}
const HELP = { rows: [], open: 1841230 };
function helpDebt() {
  let bal = HELP.open; const rows = [{ date: "2023-07-01", desc: "Opening balance", amt: null, bal }];
  for (const [d, pct] of [["2024-06-01", 40], ["2025-06-01", 32], ["2026-06-01", 29]]) { const c = Math.round(bal * pct / 1000); bal += c; rows.push({ date: d, desc: `Indexation ${(pct / 10).toFixed(1)}%`, amt: c, bal }); }
  HELP.rows = rows;
  trap("T4-HELP", "A HELP debt that only grows: indexation, no repayment", `${HP}: ${money(HELP.open)} at the start. Her income is under the threshold, so the notices carry no repayment and only the myGuv page moves`, "The debt is the tax office's figure, and it stands in net worth from the first month.",
    { kind: "lines", balances: [{ account: HP, months: ["2023-12", "2024-06", "2025-09", "2026-06"] }] });
}

// ---------- lines that look like each other ----------
function lineTraps() {
  const r = rng("traps");
  const a = line(EV, "2025-05-12", "ATM WITHDRAWAL MELTON CENTRAL", -20000, { lens: "spending", cat: "PERSONAL" }), b = earn(BZ, "2025-05-13", "CASH DEPOSIT MELTON CENTRAL", 20000, "x_BUSINESS"); addQ(b.date, "sales", 20000);
  trap("T4-CASH-FALSE-PAIR", "Notes out on one account and a customer's notes in on another, a day apart", `${EV} ${a.date} -200.00 at the ATM; ${BZ} ${b.date} +200.00, a customer's cash. Both lines carry a word from schema/matching.json, opposite to the cent, on two own accounts`, "Spending and income. They are not the same notes. If they pair, 200.00 of each vanishes.",
    { kind: "lines", lines: [plain(a, "spending"), plain(b, "income")] }, { fresh: true, dc: true });
  const [ca, cb] = own(EV, "2024-11-04", "ATM WITHDRAWAL MELTON CENTRAL", SV, "2024-11-06", "CASH DEPOSIT WATTLE MELTON", 30000);
  trap("T4-CASH-REDEPOSIT", "Notes taken out and put back in at another bank", `${EV} ${ca.date} -300.00, ${SV} ${cb.date} +300.00: she changed her mind, the same notes`, "Own money: neither. The truth here is the opposite of the trap beside it, and the lines read the same.",
    { kind: "lines", lines: [plain(ca, "neither"), plain(cb, "neither")] }, { fresh: true, dc: true });
  const c = spend(EV, "2024-07-22", "OSKO TO J MAKA FOOTY TIPS", 25000, "GIFTS"), d = earn(SV, "2024-07-23", "OSKO FROM T MAKA MARKET STALL", 25000, "x_BUSINESS"); addQ(d.date, "sales", 25000); count("purchase");
  trap("T4-FALSE-PAIR", "Two unrelated Oskos, one surname, one amount, a day apart, on two own accounts", `${EV} ${c.date} -250.00 to one man; ${SV} ${d.date} +250.00 from his brother`, "Spending and income. If they pair, 250.00 of each vanishes and nothing says so.",
    { kind: "lines", lines: [plain(c, "spending"), plain(d, "income")] });
  const e = card(r, "2024-06-04", ["CANOPY OUTDOOR", "ONLINE"], 18900, "SHOPPING", { lag: 1 }), f = line(EV, "2024-06-13", "CANOPY OUTDOOR REFUND", 18900, { lens: "spending", cat: "SHOPPING" }); count("purchase");
  trap("T4-REFUND-STREAM", "A refund that reaches a different stream from the charge", `${CC} ${e.date} -189.00; ${EV} ${f.date} +189.00`, "Lowers SHOPPING spending. Not income, and not a transfer from the card.",
    { kind: "lines", lines: [plain(e, "spending", { n: 1 }), plain(f, "spending")] });
  const g = spend(EV, "2025-09-03", "DIRECT DEBIT KOALATEL MOBILE 5501", 3900, "TELCO"), h = line(EV, "2025-09-05", "CORRECTION OF ERROR 03/09 DIRECT DEBIT", 3900, { lens: "spending", cat: "TELCO" }); count("purchase");
  trap("T4-CORRECTION", "A statement with a correction line", `${EV} 2025-09-03: the phone bill twice, the bank's own error; +39.00 "CORRECTION OF ERROR" on ${h.date}`, "One bill, net. The correction names no payee and is not income or a transfer.",
    { kind: "lines", lines: [{ account: EV, date: g.date, cents: -3900, want: "spending", n: 2 }, plain(h, "spending")] });
  spend(SV, "2025-08-06", "BPAY MELTON PRIMARY FEES 4471", 18500, "KIDS-ACT"); count("purchase");
  own(SV, "2025-08-07", "OSKO TO R TAMIHANA", EV, "2025-08-07", "OSKO FROM R TAMIHANA", 45000);
  // a waived fee, printed as a line of nothing
  const z = line(EV, "2025-04-30", "MONTHLY FEE WAIVED", 0, {});
  trap("T4-ZERO-LINE", "A line of 0.00: a monthly fee waived", `${EV} ${z.date}: "MONTHLY FEE WAIVED", 0.00, in a file with a running balance`, "No money moved. The file reads, the balance holds, and a printed 0.00 is 0.",
    { kind: "lines", balances: [{ account: EV, months: ["2025-04", "2025-05"] }] }, { fresh: true });
  // a foreign charge repriced between pending and posted, in the overlap of two downloads
  const auth = card(r, "2025-03-24", ["WISHPAW MARKET", "US"], 12240, "SHOPPING", { posted: "2025-04-02", desc: "WISHPAW MARKET US USD 78.00", csv: `${"WISHPAW MARKET".padEnd(26)}US  USD 78.00`, extra: { authCents: 12118, authFile: "2025-01-01" } }); count("purchase");
  trap("T4-FX-REPRICE", "A foreign charge whose AUD changes between authorisation and posting", `${CC} ${auth.date}: the download cut 03-31 shows 121.18 pending; the next, which overlaps, shows 122.40 posted 04-02`, "One charge of 122.40.",
    { kind: "lines", lines: [plain(auth, "spending", { n: 1 })], absent: [{ account: CC, date: auth.date, cents: -12118 }] });
  const xm = card(r, "2024-12-23", ["TINY THREADS", "SUNSHINE"], 27450, "SHOPPING", { lag: 5 }), xn = card(r, "2025-12-22", ["PAPER AND PINE", "CAROLINE SPRINGS"], 16820, "SHOPPING", { lag: 5 }); count("purchase", 2);
  trap("T4-HOLIDAY-LAG", "A charge that posts five business days later across Christmas and New Year", `${CC}: ${xm.date} posted ${xm.posted}, ${xn.date} posted ${xn.posted}`, "One purchase, in the month charged.",
    { kind: "lines", lines: [plain(xm, "spending", { n: 1, month: "2024-12" }), plain(xn, "spending", { n: 1, month: "2025-12" })] });
}

// ---------- tax ----------
const TAX = { notices: [] };
function taxes() {
  const salesOf = (fy) => Object.entries(BIZ.q).filter(([q]) => fyOf(`${q}-28`) === fy).reduce((t, [, x]) => t + x.sales - x.costs, 0);
  const lines = {};
  for (const [fy, lodged, assessed, refundOn, result] of [[2023, "2023-08-08", "2023-08-22", "2023-08-25", 61240], [2024, "2024-08-06", "2024-08-20", "2024-08-23", 141800], [2025, "2025-09-02", "2025-09-16", null, -128400]]) {
    const ss = PAY.slips.filter((s) => s.fy === fy && !s.superseded), payg = fy === 2023 ? 214000 : ss.reduce((t, s) => t + s.tax, 0), ti = fy === 2023 ? 3120000 : Math.floor((ss.reduce((t, s) => t + s.gross, 0) + Math.max(0, salesOf(fy))) / 100) * 100;
    const medicare = Math.round(ti * 0.02), gross = payg - result - medicare, n = { person: RENEE, fy, lodged, assessed, refundOn, ti, payg, help: 0, other: 0, gross, medicare, offsets: 0, result };
    TAX.notices.push(n); count("tax_assessment");
  }
  const p1 = line(EV, "2023-08-25", "ATO EFT REFUND 6620423", 61240, { refund: true }); count("tax_refund");
  trap("T4-TAX-REFUND", "A tax refund", `${EV} ${p1.date}: ${money(p1.cents)}`, "Neither income nor spending: TAX-REFUND is a transfer with the tax position.", { kind: "lines", lines: [plain(p1, "neither")] });
  // the FY2024 refund is 1,418.00 on the notice, and 500.00 of it goes to Centrelink before it reaches the bank
  const p2 = line(EV, "2024-08-23", "ATO EFT REFUND 6620424", 91800, { refund: true }); count("tax_refund");
  trap("T4-REFUND-GARNISHEE", "A tax refund the notice says is one figure and the bank says is another", `${EV} ${p2.date}: ${money(p2.cents)}. The notice says 1,418.00. 500.00 was taken for a Centrelink debt, on no file the household holds`, "Neither. The credit clears the notice as far as it goes, and the 500.00 is named as unmatched. It is not income, and the 500.00 is not a second refund.",
    { kind: "lines", lines: [plain(p2, "neither")] }, { fresh: true, dc: true });
  const b1 = line(EV, "2025-10-20", "BPAY ATO TAX 551004412339221", -70000, { refund: true }), b2 = line(EV, "2025-11-17", "BPAY ATO TAX 551004412339221", -58400, { refund: true }); count("tax_payment", 2);
  trap("T4-TAX-BILL", "A notice with a bill on it, paid in two parts, on the biller code the BAS uses", `${EV}: ${money(-b1.cents)} on ${b1.date}, ${money(-b2.cents)} on ${b2.date}, against a notice of -1,284.00`, "Neither income nor spending, in either direction.",
    { kind: "lines", lines: [plain(b1, "neither"), plain(b2, "neither")] });
  void lines;
}

// ---------- traps that live in how the files were downloaded ----------
const SV_WINDOWS = [];
const STATEMENT_MISSING = "2025-08-21";
function windows() {
  for (const [from, to] of quarters("2023-07", "2026-06")) {
    if (from === "2025-01-01") SV_WINDOWS.push(["2024-12-10", to]);
    else if (from === "2025-07-01") { SV_WINDOWS.push([from, "2025-08-03"]); SV_WINDOWS.push(["2025-08-11", to]); } else SV_WINDOWS.push([from, to]);
  }
}
function fileTraps() {
  const over = B.lines.filter((x) => x.acct === SV && x.date >= "2024-12-10" && x.date <= "2024-12-31").sort(byTime);
  const uniq = over.filter((x) => !over.some((y) => y !== x && y.date === x.date && y.cents === x.cents));
  trap("T4-OFX-OVERLAP", "Two overlapping OFX downloads whose FITIDs are renumbered in each file", `${SV}: the file from 2024-12-10 overlaps the December quarter by ${over.length} lines. The same line has a different FITID in each, and the recipe maps FITID to reference. SPEC 6.2 says a stable reference is the identity`, "One line each. A reference that is not stable across files is not an identity, and overlap collapses on account, date and amount as it does on a CSV.",
    { kind: "lines", lines: uniq.slice(0, 6).map((x) => plain(x, x.lens || "neither", { n: 1 })), balances: [{ account: SV, months: ["2024-12", "2025-01"] }] }, { fresh: true, dc: true });
  const hole = B.lines.filter((x) => x.acct === SV && x.date >= "2025-08-04" && x.date <= "2025-08-10");
  trap("T4-OFX-HOLE", "A week of saver lines nobody downloaded, in a format with no running balance", `${SV}: no OFX holds 2025-08-04 to 2025-08-10, ${hole.length} lines worth ${money(hole.reduce((t, x) => t + x.cents, 0))}. Each file's closing balance is honest`, "The engine cannot know the lines. It must say the balance does not chain, for that account and that month.",
    { kind: "hole", account: SV, month: "2025-08", net_cents: hole.reduce((t, x) => t + x.cents, 0), line_count: hole.length, match: /2025-0[89]/.source });
  const lagged = B.lines.filter((x) => x.acct === CC && x.cents < 0 && x.posted && x.posted !== x.date), lagDays = {};
  for (const x of lagged) { const d = dayDiff(x.date, x.posted); lagDays[d] = (lagDays[d] || 0) + 1; }
  trap("T4-POSTING-LAG", "Every card line in two files, dated differently", `${CC}: ${lagged.length} lines post after they are charged, by ${Object.entries(lagDays).map(([d, n]) => `${d} days (${n})`).join(", ")}. The monthly statement, cut on the 21st, shows the charge date; the quarterly activity file the posting date`, "One purchase, two witnesses, whatever the gap. A line the engine cannot match across files is asked about, not counted twice in silence.",
    { kind: "card_lag", account: CC, lagged: lagged.length, by_days: lagDays });
  const cross = B.lines.filter((x) => x.acct === CC && x.lens === "spending" && x.date >= START && x.cents < 0 && x.posted && ymOf(x.posted) !== ymOf(x.date)).sort(byTime);
  trap("T4-DATE-BASIS", "A card charge dated in one month, posted in the next", `${CC}: ${cross.length} lines. Budgets read the charge date. Six sampled`, "SPEC 6.5: a purchase counts when charged, and it is one line.",
    { kind: "lines", lines: [0, 1, 2, 3, 4, 5].map((i) => cross[Math.floor(i * cross.length / 6)]).map((x) => plain(x, "spending", { n: 1, month: ymOf(x.date) })) });
  trap("T4-STATEMENT-GAP", "A card statement never downloaded", `The statement closing ${STATEMENT_MISSING} is missing`, "The lines stay, on their posting dates. Coverage names the missing statement.",
    { kind: "gap", stream: "STM-CARD", month: STATEMENT_MISSING.slice(0, 7) });
  const up = ROUND.week, cr = ROUND.credits, once = (x) => up.filter((y) => y.date === x.date && y.cents === x.cents).length === 1, some = up.filter(once);
  trap("T4-ROUNDUP-SWEEP", "Many small debits, one weekly credit", `${EV}: ${up.length} round-ups from ${GOAL_OPEN}, worth ${money(-up.reduce((t, x) => t + x.cents, 0))}. ${GS}: ${cr.length} weekly credits, each the sum of a week's lines`, "Own money moving: neither, both sides. No line on one side equals a line on the other: only a sum proves it, and SPEC 6.4 says a clearing account is matched by sums where amounts prove it. Each small debit read as spending, and each credit as income or unexplained, is wrong.",
    { kind: "lines", lines: [some[5], some[120], some[260], cr[4], cr[30]].filter(Boolean).map((x) => plain(x, "neither")) }, { fresh: true, dc: true });
  const dr = B.pairs.filter((p) => p.from === BZ);
  trap("T4-DRAWINGS", "Drawings from a sole trader's business account to her own", `${dr.length} weekly transfers from ${BZ} to ${EV}, same owner, round amounts. Both are hers: no company stands between them`, "Own money: neither. Income was the takings going in; a draw is not income a second time.",
    { kind: "lines", lines: [dr[3], dr[Math.floor(dr.length / 2)], dr[dr.length - 2]].flatMap((p) => [{ account: p.from, date: p.date_out, cents: -p.cents, want: "neither" }, { account: p.to, date: p.date_in, cents: p.cents, want: "neither" }]) }, { fresh: true, dc: true });
}
function leaverTrap(balances) {
  const m = monthRange("2025-04", "2025-07");
  trap("T4-KID-LEAVES", "A dependant turns 18, leaves, and takes his own account", `${KB}: all Kobi's. He leaves ${KOBI_LEAVES} and the last file stops that day. His ${money(balances[KB]["2025-03"])} stays in his account and leaves net worth`, "A household holds what its members own on the day, SPEC 6.6. The account's balance stays what it was and net worth drops it.",
    { kind: "lines", excluded: [...m.map((x) => ({ group: "cash", accounts: "cash", named: KB, month: x, want: balances[KB][x], tolerance: 1 })), { group: "cash", accounts: "cash", named: KB, month: "2025-03", want: 0, tolerance: 0 }] });
}
function overdrawn() {
  // a school fee taken on the last working day of November 2025 puts the everyday account below zero at month-end
  const e = "2025-11-28"; let bal = OPEN[EV]; for (const x of B.lines.filter((l) => l.acct === EV && l.date <= "2025-11-30")) bal += x.cents;
  const fee = spend(EV, e, "BPAY WESTBROOK COLLEGE FEES 7120", bal + 4120, "KIDS-ACT"), f = spend(EV, "2025-12-01", "OVERDRAWN FEE", 1500, "FEES"), t = own(SV, "2025-12-02", "OSKO TO R TAMIHANA", EV, "2025-12-02", "OSKO FROM R TAMIHANA", fee.cents * -1 + 2000); count("purchase", 2);
  trap("T4-OVERDRAWN", "An asset account below zero at month-end", `${EV}: -41.20 at 2025-11-30, with a 15.00 fee on the next working day and a top-up from the saver. A transaction account, class asset, negative on its own file`, "The balance is -41.20, in net worth as it is. It is not a liability to reclassify, not a floor at zero, and not an error.",
    { kind: "lines", lines: [plain(fee, "spending"), plain(f, "spending"), plain(t[1], "neither")], balances: [{ account: EV, months: ["2025-11", "2025-12"] }] }, { fresh: true, dc: true });
}
/* a Bark goal saver takes each week's round-ups as one credit, on the Monday after */
function roundUps() {
  ROUND.credits = [];
  const byMon = {}; for (const x of ROUND.week) { let m = addDays(x.date, 1); while (weekday(m) !== 1) m = addDays(m, 1); (byMon[m] = byMon[m] || []).push(x); }
  for (const m of Object.keys(byMon).sort()) { const c = -byMon[m].reduce((t, x) => t + x.cents, 0); ROUND.credits.push(line(GS, m, `ROUND UPS WEEK TO ${addDays(m, -1)}`, c, { xfer: true })); for (const x of byMon[m]) B.transit.push({ from: x.date, until: m, cents: -x.cents }); }
  const total = OPEN[GS] + ROUND.credits.reduce((t, x) => t + x.cents, 0);
  own(GS, GOAL_CLOSE, "TFR TO BARK EVERYDAY", EV, GOAL_CLOSE, "TFR FROM GOAL SAVER", total);
}
function drawings() {
  let d = BIZ_OPEN; while (weekday(d) !== 5) d = addDays(d, 1);
  own(EV, BIZ_OPEN, "OSKO TO R TAMIHANA BUSINESS", BZ, BIZ_OPEN, "OPENING DEPOSIT", 50000);
  const ls = () => B.lines.filter((x) => x.acct === BZ).sort(byTime);
  for (; d <= END; d = addDays(d, 7)) {
    const list = ls(); let bal = 0, low = Infinity;
    for (const x of list) { bal += x.cents; if (x.date >= d && x.date <= addDays(d, 35)) low = Math.min(low, bal); else if (x.date < d) low = bal; }
    const draw = Math.floor(Math.max(0, low - 30000) / 5000) * 5000;
    if (draw >= 5000) own(BZ, d, "OSKO TO R TAMIHANA DRAWINGS", EV, d, "OSKO FROM R TAMIHANA DRAWINGS", draw);
  }
}
/* she watches the everyday account: when it runs low she tops it up from the saver, and when it runs high she puts some away. Round amounts, the same words as her mother's money. */
function sweeps() {
  const lines = () => B.lines.filter((x) => x.acct === EV).sort(byTime);
  let d = "2023-07-03";
  for (; d <= END; d = addDays(d, 7)) {
    if (d >= "2025-11-17" && d <= "2025-12-02") continue;   // she is not watching it that fortnight
    const list = lines(); let bal = OPEN[EV], low = Infinity, now = null;
    for (const x of list) { bal += x.cents; if (x.date < d) now = bal; if (x.date >= d && x.date <= addDays(d, 10)) low = Math.min(low, bal); }
    if (now == null) now = OPEN[EV];
    if (low === Infinity) low = now; low = Math.min(low, now);
    if (low < 20000) { const c = Math.ceil((30000 - low) / 5000) * 5000; own(SV, d, "OSKO TO R TAMIHANA", EV, d, "OSKO FROM R TAMIHANA", c); } else if (low > 180000) { const c = Math.floor((low - 120000) / 5000) * 5000; if (c >= 5000) own(EV, d, "OSKO TO R TAMIHANA", SV, d, "OSKO FROM R TAMIHANA", c); }
  }
}

const CARD = { statements: [] };
function settleCard() {
  let prev = -OPEN[CC];
  for (let start = "2023-06-22"; start <= "2026-06-22";) {
    const ym = nextMonth(start.slice(0, 7)), end = `${ym}-21`;
    const inP = B.lines.filter((x) => x.acct === CC && posted(x) >= start && posted(x) <= end);
    const charges = inP.filter((x) => x.cents < 0).reduce((t, x) => t - x.cents, 0), credits = inP.filter((x) => x.cents > 0).reduce((t, x) => t + x.cents, 0), close = prev + charges - credits;
    CARD.statements.push({ start, end, prev, charges, credits, close, lines: inP.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.seq - b.seq)) });
    const due = nextBiz(`${nextMonth(ym)}-05`), post = bizAfter(due, 1);
    if (due <= END && close > 0) own(EV, due, `AMEWX DIRECT DEBIT ${NUM.card}`, CC, post, "PAYMENT RECEIVED - THANK YOU", close, { posted: post, csv: "PAYMENT RECEIVED - THANK YOU", member: RENEE });
    prev = close; start = addDays(end, 1);
  }
}
function interestCredits() {
  let bal = OPEN[SV];
  for (const ym of MONTHS) { bal += B.lines.filter((x) => x.acct === SV && ymOf(x.date) === ym).reduce((t, x) => t + x.cents, 0); const i = Math.round(bal * 0.041 / 12); if (i > 0) { earn(SV, monthEnd(ym), "INTEREST CREDIT", i, "INTEREST"); bal += i; count("interest_credit"); } }
  let k = OPEN[KB];
  for (const ym of monthRange("2023-07", "2025-03")) { k += B.lines.filter((x) => x.acct === KB && ymOf(x.date) === ym).reduce((t, x) => t + x.cents, 0); const i = Math.round(k * 0.03 / 12); if (i > 0) { earn(KB, monthEnd(ym), "INTEREST CREDIT", i, "INTEREST"); k += i; } }
}

// ---------- truth, from the simulation alone ----------
const OPEN = { [EV]: 296060, [GS]: 0, [SV]: 642000, [BZ]: 0, [JT]: 324000, [KB]: 86050, [CC]: -68000, [SU]: 3120000, [SO]: 812000, [CL]: -1180000, [BD]: 336000, [MU]: 0, [BN]: 0 };
const CAR_A = 1450000, CAR_B = 850000;
function chain(acct) { let bal = OPEN[acct] || 0; return B.lines.filter((x) => x.acct === acct).sort(acct === CC ? byPost : byTime).map((x) => { bal += x.cents; x.balance = bal; return x; }); }
function truthBalances() {
  const acctsChain = [EV, GS, SV, BZ, JT, KB, CC, SU, SO, CL, MU, BN, BD];
  const chains = {}; for (const a of acctsChain) chains[a] = chain(a);
  const assets = [...acctsChain, HP, CA, CB];
  const balances = {}; for (const a of assets) balances[a] = {};
  for (const m of MONTHS) {
    const e = monthEnd(m);
    for (const a of acctsChain) { const upTo = chains[a].filter((x) => (a === CC ? posted(x) : x.date) <= e), last = upTo[upTo.length - 1]; balances[a][m] = last ? last.balance : OPEN[a] || 0; }
    { const r = HELP.rows.filter((x) => x.date <= e); balances[HP][m] = -r[r.length - 1].bal; }
    balances[CA][m] = e < WRITE_OFF ? CAR_A : 0;
    balances[CB][m] = e < NEW_CAR ? 0 : CAR_B;
  }
  return { balances, chains, assets };
}
function truth(t) {
  const { balances, chains, assets } = t;
  const income = {}, spending = {}, byCat = {}, networth = {}, transit = {}, supers = {};
  for (const m of MONTHS) { income[m] = 0; spending[m] = 0; byCat[m] = {}; }
  for (const x of B.lines) {
    const m = ymOf(x.date); if (!(m in income) || !x.lens) continue;
    if (!CASH.includes(x.acct)) throw new Error(`lens on a non-cash account ${x.acct}`);
    if (x.lens === "income") income[m] += x.cents; else { spending[m] -= x.cents; byCat[m][x.cat] = (byCat[m][x.cat] || 0) - x.cents; }
  }
  for (const m of MONTHS) {
    const e = monthEnd(m);
    transit[m] = B.transit.filter((x) => x.from <= e && x.until > e).reduce((s, x) => s + x.cents, 0);
    const lukas = e < JOINT_CLOSE ? Math.floor(balances[JT][m] / 2) : 0, gone = e >= KOBI_LEAVES ? balances[KB][m] : 0;
    networth[m] = assets.reduce((s, a) => s + balances[a][m], 0) + transit[m] - lukas - gone;
    supers[m] = balances[SU][m] + balances[SO][m];
  }
  return {
    household: "Tamihana-Brandt, fictional, Melton VIC", window: [START, END],
    definitions: {
      income: "SPEC 6.5 cash lens: money into reporting-group cash accounts in categories of kind income with cash_lens true, on the day the bank shows it. Wages at the net banked, Centrelink, child support, the business's takings at the net paid, interest, gifts. A benefit or a wage taken back is a negative in income.",
      spending: "SPEC 6.5 cash lens: money out of cash accounts in expense categories with cash_lens true, net of refunds, Medicare and what a housemate pays back. Card purchases on the charge date. Car loan repayments at their cash amount, buy-now-pay-later at each instalment, an ATM withdrawal when it is withdrawn.",
      left_out: "Own transfers, round-ups, drawings, card repayments, tax refunds and payments, BAS payments and refunds, the bond, the loan from her mother, wage advances and their repayments, the property settlement, the insurance claim money and the private car purchase, an employer's expense claim, and Lukas's half of the old joint account.",
      balances: "Month-end, holder's sign, on the posting date. Super at the fund's true balance, read or not. The bond is the part that is hers. Buy-now-pay-later at what is owed on the day. The cars at the value typed in setup. A HELP debt at the tax office's figure.",
      networth: "Sum of the accounts the household declared, each at what members own that day: half of the old joint account, and Kobi's account until he leaves. Plus money in the air between own accounts. Tax position excluded.",
      one_charge: "A charge in two files is one charge. The statement's amount is the charge where the two disagree, because the statement closes on it.",
    },
    balances, income, spending, spending_by_category: byCat, networth, in_transit: transit, super_accounts: { accounts: [SU, SO], balance: supers },
    counts: B.counts, lines_by_account: Object.fromEntries(Object.entries(chains).map(([a, l]) => [a, l.length])),
    cash_lines: B.lines.filter((x) => CASH.includes(x.acct)).sort(byTime).map((x) => ({ account: x.acct, date: x.date, ...(x.posted && x.posted !== x.date ? { posted: x.posted } : {}), cents: x.cents, what: x.desc, lens: x.lens || "neither", ...(x.cat ? { category: x.cat } : {}), ...(x.xfer ? { own: true } : {}) })),
    own_transfers: B.pairs,
    traps: B.traps,
  };
}

// ---------- files ----------
const FILES = [];
function put(stream, day, name, bytes, facts = {}) {
  const b = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  FILES.push({ stream, day, name, bytes: b, path: `sources/${stream}/${day}/${name}`, ...facts });
}
const BR_ = {
  amewx: { name: "Amewx", tagline: "Don't leave home without your whiskers", color: "#1E5AA8" },
  ping: { name: "PING", tagline: "Wattle Credit Union online lending", color: "#D97A0B" },
  pawroll: { name: "Pawroll", tagline: "Payroll with claws", color: "#6A3FA0" },
  myguv: { name: "myGuv", tagline: "Your tax, your paws", color: "#0B6E99" },
  purrsure: { name: "Purrsure", tagline: "Cover for the curious", color: "#C2410C" },
  water: { name: "Western Reach Water" },
  hest: { name: "HESTAbby" },
  guvbas: { name: "myGuv" },
  centrelink: { name: "Services Australia" },
  agent: { name: "Cobblebank Realty" },
};
const span = (a, b) => `${fmtDate(a)} to ${fmtDate(b)}`;
const R = (label, w = 2) => ({ label, w, align: "right" });
const Lft = (label, w = 2) => ({ label, w });

function pdfPayslip(s, ytd, reissued) {
  const d = new Doc({ brand: BR_.pawroll, title: "Payslip", kicker: fmtDate(s.payDate), deflate });
  d.h1(`Payslip for ${s.person}`);
  d.kv([["Employer", s.employer], ["Pay date", fmtDate(s.payDate)], ["Pay period", span(s.from, s.to)]], 3);
  d.h2("This pay");
  d.para(reissued ? "Classification: reissued, replaces the payslip of the same date." : s.final ? "Classification: final pay, leave paid out." : "Classification: part-time, fortnightly in arrears.");
  d.para("All amounts are in Australian dollars.");
  const pct = sgRate(s.payDate);
  d.table([Lft("Item", 6), R("This pay"), R("Year to date")], [
    ["Ordinary hours, salary", money(s.gross), money(ytd.gross)],
    ["PAYG withholding", `-${money(s.tax)}`, `-${money(ytd.tax)}`],
    [`Superannuation guarantee (${pct}%)`, money(s.super), money(ytd.super)],
    [s.split ? `Net pay, to account ending ${NUM.everyLast} and 0415` : `Net pay, to account ending ${NUM.everyLast}`, money(s.net), ""],
  ]);
  return d.finish();
}
function pdfIncomeStatement(person, employer, fy, ss) {
  const sum = (k) => ss.reduce((t, s) => t + s[k], 0);
  const d = new Doc({ brand: BR_.pawroll, title: `Income statement FY${fy}`, kicker: `FY${fy}, 01 Jul ${fy - 1} to 30 Jun ${fy}`, deflate });
  d.h1(`Income statement for ${person}`);
  d.kv([["Employee", person], ["Payer", employer], ["Issued", fmtDate(`${fy}-07-14`)], ["Status", "Tax ready"], ["Payer ABN", { [BLUE]: "51824771203", [BANK]: "30918770445", [BOWLS]: "62771440982" }[employer]], ["Pay frequency", "Fortnightly"]], 3);
  d.h2("Year to 30 June");
  d.table([Lft("Item", 6), R("Amount")], [["Gross payments", money(sum("gross"))], ["Tax withheld", money(sum("tax"))], ["Superannuation guarantee", money(sum("super"))], ["Reportable employer super", "0.00"]]);
  d.h2("Pay by pay");
  d.table([Lft("Pay date", 3), R("Gross"), R("Tax"), R("Super"), R("Net")], ss.map((s) => [fmtDate(s.payDate), money(s.gross), money(s.tax), money(s.super), money(s.net)]), { foot: ["Total", money(sum("gross")), money(sum("tax")), money(sum("super")), money(sum("net"))] });
  return d.finish();
}
function pdfLoan(from, to, rows) {
  const t = (k) => rows.reduce((a, r) => a + r[k], 0);
  const d = new Doc({ brand: BR_.ping, title: "Car loan statement", kicker: span(from, to), deflate });
  d.h1("Car loan statement");
  d.kv([["Loan number", NUM.loan], ["Product", "Secured Car Loan"], ["Borrowers", RENEE], ["Repayments", "Monthly"], ["Opening balance", money(-rows[0].open)], ["Interest charged", money(t("interest"))], ["Repayments received", money(t("paid"))], ["Closing balance", money(-rows[rows.length - 1].close)]], 4);
  d.h2("Month by month");
  d.table([Lft("Month", 2), R("Rate", 1), R("Opening"), R("Interest"), R("Repayments"), R("Closing")], rows.map((r) => [`${MON[Number(r.ym.slice(5)) - 1]} ${r.ym.slice(0, 4)}`, `${r.rate}%`, money(-r.open), money(r.interest), money(r.paid), money(-r.close)]), { foot: ["Total", "", "", money(t("interest")), money(t("paid")), ""] });
  return d.finish();
}
function pdfCard(s) {
  const d = new Doc({ brand: BR_.amewx, title: "Card statement", kicker: span(s.start, s.end), deflate });
  d.h1("Your card statement");
  d.kv([["Account", cardFull()], ["Card member", RENEE], ["Previous balance", money(s.prev)], ["Payments and credits", money(s.credits)], ["New charges", money(s.charges)], ["New balance", money(s.close)]], 3);
  d.h2("Transactions");
  d.table([Lft("Date", 2), Lft("Description", 8), R("Amount", 2)], s.lines.map((x) => [fmtDate(x.date), x.desc, money(-x.cents)]), { foot: ["New balance", "", money(s.close)] });
  return d.finish();
}
function pdfBare(brand, title, lines) {
  const d = new Doc({ brand, style: "plain", title, kicker: title, deflate });
  d.h1(title);
  for (const l of lines) d.para(l);
  return d.finish();
}
function pdfFund(fy, lines, openBal, closeBal) {
  const sum = (t) => lines.filter((x) => x.type === t).reduce((s, x) => s + x.cents, 0);
  const from = `${fy - 1}-07-01`, to = `${fy}-06-30`;
  const d = new Doc({ brand: BR_.hest, style: "plain", title: "Annual statement", kicker: span(from, to), deflate });
  d.h1("Your annual statement");
  d.kv([["Member", RENEE], ["Member number", NUM.superNew], ["Statement period", span(from, to)], ["Balance then", money(openBal)], ["Balance now", money(closeBal)], ["Option", "Balanced growth"]], 3);
  d.h2("What moved");
  d.table([Lft("Item", 6), R("Amount")], [["Opening balance", money(openBal)], ["Employer contributions", money(sum("employer"))], ...(sum("rollover_in") ? [["Rollovers in", money(sum("rollover_in"))]] : []), ...(sum("listo") ? [["Government contributions", money(sum("listo"))]] : []), ["Investment earnings", money(sum("earnings"))], ["Contributions tax", money(-sum("contributions_tax"))], ["Administration fees", money(-sum("fee"))], ["Insurance premiums", money(-sum("insurance"))], ["Closing balance", money(closeBal)]]);
  return d.finish();
}
function pdfNoa(n) {
  const d = new Doc({ brand: BR_.myguv, title: "Notice of assessment", deflate });
  d.h1("Notice of assessment");
  const rows = [["Name", n.person, "Taxable income", money(n.ti)], ["Financial year", `FY${n.fy}`, "Gross tax", money(n.gross)], ["Date of issue", fmtDate(n.assessed), "Less offsets", money(0)], ["Return lodged", fmtDate(n.lodged), "Medicare levy", money(n.medicare)], ["Version", "1", "HELP repayment", money(n.help)], ["Assessment", `AN-${n.fy}-6620418`, "PAYG credits", money(n.payg)], ["", "", "Other credits", money(n.other)], ["", "", "Result of this notice", money(n.result)]];
  for (const r of rows) { d.text(MARGIN, d.y, r[0], { size: 9.5 }); d.text(MARGIN + 110, d.y, r[1], { size: 9.5, bold: true }); d.text(320, d.y, r[2], { size: 9.5 }); d.text(d.W - MARGIN, d.y, r[3], { size: 9.5, bold: true, align: "right" }); d.y -= 18; }
  d.para("A refund is paid to the account you nominated in your return.");
  return d.finish();
}
function pdfWater(b) {
  const d = new Doc({ brand: BR_.water, style: "plain", title: "Water bill", deflate });
  d.text(MARGIN, d.y, "Your water bill", { size: 14, bold: true }); d.text(d.W - MARGIN, d.y, `Quarter to ${fmtDate(b.to)}`, { size: 9, align: "right" }); d.y -= 26;
  const rows = [["Account", "WR-60331907", "Water usage", money(b.usage)], ["Property", "Melton", "Service charges", money(b.service)], ["Bill date", fmtDate(b.billDate), "Concession", money(0)], ["Due date", fmtDate(b.due), "Amount due", money(b.amt)], ["Period from", fmtDate(b.from), "", ""], ["Period to", fmtDate(b.to), "", ""]];
  for (const r of rows) { d.text(MARGIN, d.y, r[0], { size: 9.5 }); d.text(MARGIN + 110, d.y, r[1], { size: 9.5, bold: true }); if (r[2]) { d.text(320, d.y, r[2], { size: 9.5 }); d.text(d.W - MARGIN, d.y, r[3], { size: 9.5, bold: true, align: "right" }); } d.y -= 18; }
  d.para("Thank you for paying on time.");
  d.text(MARGIN, d.y, "Pay by", { size: 9.5 }); d.text(MARGIN + 110, d.y, "BPAY biller 60331", { size: 9.5 });
  return d.finish();
}
function pdfPolicy(p) {
  const d = new Doc({ brand: BR_.purrsure, title: "Certificate", kicker: "Motor cover", deflate });
  d.h1("Certificate of currency");
  d.kv([["Policy number", p.number], ["Policy", "Motor"], ["Situation", p.situ], ["Insured", RENEE], ["Period of insurance", span(p.from, p.to)], ["Premium paid", money(p.amt)]], 3);
  d.h2("Cover");
  d.table([Lft("Item", 6), R("Amount")], [["Agreed value", money(p.sum)], ["Excess", money(p.excess)]]);
  return d.finish();
}
function emlEnergy(b) {
  const text = ["Your electricity bill is ready", "Goldline Power, a fictional retailer", "Hello Renee,", `Account: ${b.account}`, `Bill date: ${fmtDate(b.billDate)}`, `Due date: ${fmtDate(b.due)}`, `Supply from: ${fmtDate(b.from)}`, `Supply to: ${fmtDate(b.to)}`, `GST included: ${money(b.gst)}`, `Amount due: ${money(b.amt)}`, "Pay by BPAY, biller code 5512.", "Thanks for keeping the lights on."].join("\n");
  return eml({ from: "bills@goldline.example", to: "renee@tamihana-brandt.example", subject: "Your electricity bill is ready", date: b.billDate, id: `gl-${b.billDate}`, text, html: `<p>${text.split("\n").join("</p><p>")}</p>` });
}
function emlReceipt(x) {
  const text = [`Thanks for shopping at ${x.merchant}.`, `Order date: ${fmtDate(x.date)}`, `Item: ${x.item}`, `Product type: ${x.kind}`, `Serial number: ${x.serial}`, `Warranty until: ${fmtDate(x.warranty)}`, `Paid with: ${x.paid}`, `GST included: ${money(x.gst)}`, `Total: ${money(x.total)}`, "Keep this email for your records.", "This is a fictional store."].join("\n");
  return eml({ from: "orders@store.example", to: "renee@tamihana-brandt.example", subject: `Your receipt from ${x.merchant}`, date: x.date, id: `rc-${x.date}`, text, html: `<p>${text.split("\n").join("</p><p>")}</p>` });
}
function htmlKitten(s) {
  const from = `${s.ym}-01`, to = monthEnd(s.ym), body = `<h1>Statement of account</h1>\n<p>Provider: Kittenhood OSHC Melton</p>\n<p>Child: ${s.child}</p>\n<table>${row(["Item", "Detail"], "th")}${row(["Period start", fmtDate(from)])}${row(["Period end", fmtDate(to)])}${row(["Days attended", String(s.days)])}${row(["Gross fee", money(s.gross)])}${row(["Child Care Subsidy", `-${money(s.subsidy)}`])}${row(["Gap you pay", money(s.gap)])}</table>`;
  return page(`Kittenhood statement ${MON[Number(s.ym.slice(5)) - 1]} ${s.ym.slice(0, 4)}`, body);
}
function htmlHelp(rows, closing) {
  const body = `<h1>Your HELP account</h1>\n<p>Name: ${RENEE}</p>\n<p>Closing balance: ${money(closing)}</p>\n<table>${row(["Date", "Description", "Amount", "Balance"], "th")}${rows.map((x) => row([fmtDate(x.date), x.desc, x.amt == null ? "" : (x.amt < 0 ? `-${money(-x.amt)}` : money(x.amt)), money(x.bal)])).join("")}</table>`;
  return page("myGuv HELP account", body);
}
function quarters(a, b) { const out = []; const ms = monthRange(a, b); for (let i = 0; i < ms.length; i += 3) out.push([`${ms[i]}-01`, monthEnd(ms[i + 2])]); return out; }

function render() {
  const view = (acct, from, to) => { let bal = OPEN[acct] || 0; const seq = B.lines.filter((x) => x.acct === acct).slice().sort(byTime), out = []; for (const x of seq) { bal += x.cents; if (x.date >= from && x.date <= to) out.push({ ...x, balance: bal }); } return out; };
  const before = (acct, d) => (OPEN[acct] || 0) + B.lines.filter((x) => x.acct === acct && x.date < d).reduce((t, x) => t + x.cents, 0);
  const bark = (x) => [dmy(x.date), `${x.cents >= 0 ? "+" : "-"}${fix(Math.abs(x.cents))}`, x.desc, fix(x.balance)];
  const w5 = (x) => [dmy(x.date), x.desc, x.cents > 0 ? fix(x.cents) : "", x.cents < 0 ? fix(x.cents) : "", fix(x.balance)], head5 = ["Date", "Description", "Credit", "Debit", "Balance"];
  const bf5 = (from, bal) => [dmy(from), "BALANCE BROUGHT FORWARD", "0.00", "", fix(bal)];
  const hbHead = ["Bank Account", "Date", "Narrative", "Debit Amount", "Credit Amount", "Balance", "Categories", "Serial"];
  // the everyday account: Bark's headerless CSV, newest first, quarterly
  for (const [from, to] of quarters("2023-07", "2026-06")) put(EV, addDays(to, 2), `bark_transactions_${from}.csv`, csvLines(view(EV, from, to).reverse().map(bark)));
  // the goal saver, the same, for its one year
  for (const [from, to] of quarters("2024-01", "2024-12")) put(GS, addDays(to, 2), `bark_goal_${from}.csv`, csvLines(view(GS, from, to).reverse().map(bark)));
  // the saver: Wattle's OFX, quarterly, with one overlap and one hole, and FITIDs the writer numbers within each file
  for (const [from, to] of SV_WINDOWS) put(SV, addDays(to, 2), `Wattle_saver_${from}.ofx`, ofx({ account: NUM.saver, bankId: "633000", from, to, rows: view(SV, from, to).map((x) => ({ date: x.date, cents: x.cents, desc: x.desc })), closing: before(SV, addDays(to, 1)), asOf: to }));
  // the business account: Harbour's CSV, quarterly from when it opened
  for (const [from, to] of quarters("2025-01", "2026-06")) { const f = from < BIZ_OPEN ? BIZ_OPEN : from; put(BZ, addDays(to, 2), `Harbour_${f}_${to}.csv`, csvLines([hbHead, ...view(BZ, f, to).map((x) => [NUM.biz, dmy(x.date), x.desc, x.cents < 0 ? fix(-x.cents) : "", x.cents > 0 ? fix(x.cents) : "", fix(x.balance), x.cents > 0 ? "DEP" : "PAYMENT", ""])])); }
  // the old joint account and Kobi's saver: Wattle's five columns with a brought-forward row
  for (const [from, to] of quarters("2023-07", "2024-03")) put(JT, addDays(to, 2), `Wattle_joint_${from}.csv`, csvLines([head5, bf5(from, before(JT, from)), ...view(JT, from, to).map(w5)]));
  for (const [from, to] of [["2023-07-01", "2023-12-31"], ["2024-01-01", "2024-06-30"], ["2024-07-01", "2024-12-31"], ["2025-01-01", KOBI_LEAVES]]) put(KB, addDays(to, 3), `Wattle_youth_${from}.csv`, csvLines([head5, bf5(from, before(KB, from)), ...view(KB, from, to).map(w5)]));
  // the card: a monthly statement dated by the charge, a quarterly activity download dated by the post
  chain(CC);
  const cc = B.lines.filter((x) => x.acct === CC).sort(byPost);
  for (const s of CARD.statements) { if (s.end === STATEMENT_MISSING) continue; put("STM-CARD", addDays(s.end, 2), `Amewx_statement_${s.end}.pdf`, pdfCard(s), { issued_on: s.end }); }
  for (const [from, to, day] of quarters("2023-07", "2026-06").map(([f, t], i) => (i === 0 ? ["2023-06-22", t, addDays(t, 3)] : f === "2025-04-01" ? ["2025-03-25", t, addDays(t, 3)] : [f, t === END ? "2026-07-10" : t, addDays(t, 3)]))) {
    const rows = cc.filter((x) => posted(x) >= from && posted(x) <= to).map((x) => ({ d: posted(x), desc: x.csv || x.desc, m: RENEE, c: x.cents, n: NUM.card }));
    if (from === "2025-01-01") { const a = cc.find((x) => x.authFile === from); rows.push({ d: a.date, desc: a.csv, m: RENEE, c: -a.authCents, n: NUM.card }); }
    rows.sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0));
    put(CC, day, `activity_${from}.csv`, csvLines([["Date", "Description", "Card Member", "Account #", "Amount"], ...rows.map((x) => [dmy(x.d), x.desc, x.m.toUpperCase(), `-${x.n}`, money(-x.c).replace(/,/g, "")])]));
  }
  // the car loan: PING's half-yearly statement and its yearly download
  for (const [a, b, from, to] of [["2023-07", "2023-12", "2023-07-01", "2023-12-31"], ["2024-01", "2024-06", "2024-01-01", "2024-06-30"], ["2024-07", "2024-12", "2024-07-01", "2024-12-31"], ["2025-01", "2025-03", "2025-01-01", "2025-03-31"]]) put("STM-CARLOAN", addDays(to, 5), `PING_statement_${to}.pdf`, pdfLoan(from, to, LOANS.car.filter((m) => m.ym >= a && m.ym <= b)), { issued_on: addDays(to, 1) });
  for (const [from, to, day] of [["2023-07-01", "2024-06-30", "2024-07-02"], ["2024-07-01", "2025-03-31", "2025-04-03"]]) { const rows = LOANS.carLines.filter((x) => x.date >= from && x.date <= to).map((x) => [dmy(x.date), x.desc, fix(x.cents), fix(-x.balance)].join("\t")); put(CL, day, `ping_loan_${from}.tsv`, `Effective Date\tDetails\tAmount\tBalance Owing\r\n${rows.join("\r\n")}\r\n`); }
  // pay
  const ytd = {};
  for (const s of PAY.slips.slice().sort((a, b) => (a.payDate < b.payDate ? -1 : a.payDate > b.payDate ? 1 : (a.reissueOf ? 1 : 0) - (b.reissueOf ? 1 : 0)))) {
    const k = `${s.employer}|${s.fy}`, y = (ytd[k] = ytd[k] || { gross: 0, tax: 0, super: 0 }), o = s.reissueOf;
    y.gross += s.gross - (o ? o.gross : 0); y.tax += s.tax - (o ? o.tax : 0); y.super += s.super - (o ? o.super : 0);
    put("PAY-RENEE", o ? s.issued : s.payDate, `Payslip_${s.employer.split(" ")[0]}_${s.payDate}${o ? "_reissued" : ""}.pdf`, pdfPayslip(s, y, !!o), { issued_on: o ? s.issued : s.payDate });
  }
  for (const fy of [2024, 2025, 2026]) for (const emp of [BLUE, BANK, BOWLS]) {
    const ss = PAY.slips.filter((s) => s.employer === emp && s.fy === fy && !s.superseded); if (!ss.length) continue;
    put("INC-RENEE", `${fy}-07-14`, `IncomeStatement_FY${fy}_${emp.split(" ")[0]}.pdf`, pdfIncomeStatement(RENEE, emp, fy, ss), { issued_on: `${fy}-07-14` });
  }
  // super
  const sh = [["2023-07-01", "2023-12-31"], ["2024-01-01", "2024-06-30"], ["2024-07-01", "2024-12-31"], ["2025-01-01", "2025-06-30"], ["2025-07-01", "2025-12-31"], ["2026-01-01", "2026-06-30"]];
  const CODE = { employer: "SG", contributions_tax: "TAX", fee: "FEE", insurance: "INS", earnings: "EARN", rollover_in: "ROLLIN", listo: "LISTO" };
  const open = (list, from, base) => { const b = list.filter((x) => x.date < from); return b.length ? b[b.length - 1].balance : base; };
  for (const [from, to] of sh) {
    const ls = SUPER.lines.filter((x) => x.date >= from && x.date <= to), opening = open(SUPER.lines, from, OPEN[SU]);
    put(SU, addDays(to, 5), `hestabby_${from}.json`, JSON.stringify({ schema: "hestabby.transactions.v2", member: { name: RENEE, number: NUM.superNew }, period: { from, to }, balance: { opening: Number(fix(opening)), closing: Number(fix(ls[ls.length - 1].balance)) }, transactions: ls.map((x) => ({ date: x.date, code: CODE[x.type], label: x.desc, amount: Number(fix(x.cents)), balanceAfter: Number(fix(x.balance)) })) }, null, 1));
  }
  const V2 = { fee: "FEE-ADMIN", earnings: "EARNINGS", rollover_out: "ROLL-OUT" };
  for (const [from, to] of sh.slice(0, 3)) { const ls = SUPER.old.filter((x) => x.date >= from && x.date <= to); put(SO, addDays(to, 6), `purrannuation_${from}.csv`, csvLines([["Effective Date", "Category", "Narrative", "Amount (AUD)", "Running Balance", "Reference"], ...ls.map((x, i) => [x.date, V2[x.type], x.desc, fix(x.cents), fix(x.balance), `TXN${from.slice(2, 4)}${pad(i + 1, 4)}`])])); }
  for (const fy of [2024, 2025, 2026]) { const from = `${fy - 1}-07-01`, to = `${fy}-06-30`, ls = SUPER.lines.filter((x) => x.date >= from && x.date <= to); put("STM-SUPER", `${fy}-07-20`, `Annual_statement_FY${fy}.pdf`, pdfFund(fy, ls, open(SUPER.lines, from, OPEN[SU]), ls[ls.length - 1].balance), { issued_on: `${fy}-07-20` }); }
  // tax, and the HELP page, one download a year
  for (const n of TAX.notices) put("TAX-RENEE", n.assessed, `NOA_FY${n.fy}.pdf`, pdfNoa(n), { issued_on: n.assessed });
  for (const fy of [2024, 2025, 2026]) { const rows = HELP.rows.filter((x) => fyOf(x.date) === fy), prior = HELP.rows.filter((x) => fyOf(x.date) < fy).pop(); const list = prior ? [{ ...prior, date: `${fy - 1}-07-01`, desc: "Opening balance", amt: null }, ...rows] : rows; put(HP, `${fy}-07-05`, `myguv_help_FY${fy}.html`, htmlHelp(list, list[list.length - 1].bal)); }
  // bills and care
  for (const b of BILLS.energy) put("BILL-POWER", b.billDate, `bill_${b.billDate}.eml`, emlEnergy(b), { issued_on: b.billDate, origin: "email" });
  for (const b of BILLS.water) put("BILL-WATER", b.billDate, `water_${b.billDate}.pdf`, pdfWater(b), { issued_on: b.billDate });
  for (const p of MOTOR.policy) put("POLICY-MOTOR", p.paid, `certificate_${p.from}.pdf`, pdfPolicy(p), { issued_on: p.paid });
  for (const s of KIDS.statements) put("CHILDCARE", `${nextMonth(s.ym)}-02`, `kittenhood_${s.ym}.html`, htmlKitten(s));
  for (const x of AFTER.receipts) put("RECEIPTS", x.date, `receipt_${x.date}.eml`, emlReceipt(x), { issued_on: x.date, origin: "email" });
  // families of files with no public recipe
  for (const [q, x] of Object.entries(BIZ.q).sort()) if (x.due && x.due <= END) put("BAS-STATEMENTS", addDays(x.due, -14), `Activity_statement_${q}.pdf`, pdfBare(BR_.guvbas, "Activity statement", [`Period to ${fmtDate(monthEnd(q))}`, `Total sales: ${money(x.sales)}`, `GST on sales: ${money(Math.round(x.sales / 11))}`, `GST on purchases: ${money(Math.round(x.costs / 11))}`, `Net amount: ${money(x.gst)}`, "Fictional."]), { issued_on: addDays(x.due, -14) });
  for (const fy of [2024, 2025]) put("CENTRELINK-STMT", `${fy}-07-25`, `Centrelink_payment_summary_FY${fy}.pdf`, pdfBare(BR_.centrelink, "Payment summary", [`Financial year FY${fy}`, `Customer: ${RENEE}`, "Parenting Payment and Family Tax Benefit paid in the year.", "Fictional."]), { issued_on: `${fy}-07-25` });
  put("RENT-LEDGER", "2026-07-02", "Tenant_ledger.pdf", pdfBare(BR_.agent, "Tenant ledger", [`Tenant: ${RENEE}`, "Rent paid to 2026-06-30, Cobblebank Realty.", "Fictional."]), { issued_on: "2026-07-01" });
}

// ---------- setup: what a person answers at onboarding, in July 2026 ----------
const ON = "2026-07-20T00:00:00Z";
/* The public default categories, as the earlier households listed them, with PASS-THROUGH and SUPER-PENSION and SELLING-COSTS. Four rows by the SPEC 12 rung, because a person would need them, as BLIND-1 and BLIND-2 added: rent a tenant pays, Centrelink, child support, the business's takings. */
const CATS = `SALARY|Salary and wages|income|Income|1|1;SALARY-ALLOW|Allowances|income|Income|1|1;REIMBURSE|Employer reimbursements|income|Income|1|0;SUPER-EMPLOYER|Employer super|income|Super|0|1;SUPER-SACRIFICE|Salary sacrificed to super|income|Super|0|1;PAYROLL-DED|Post-tax payroll deductions|expense|Income|1|1;INTEREST|Interest earned|income|Income|1|1;DIVIDEND|Dividends and distributions|income|Income|1|1;TRUST-DIST|Trust distributions|income|Income|1|1;ESS-INCOME|Employee share scheme income|income|Income|0|1;CRYPTO-INCOME|Staking and crypto income|income|Income|0|1;SUPER-EARN|Super fund earnings|income|Super|0|1;SUPER-FEES|Super fund fees|expense|Super|0|1;SUPER-INS|Insurance inside super|expense|Super|0|1;SUPER-TAX|Contributions tax|expense|Super|0|1;GIFT-IN|Gifts and inheritances received|income|Income|1|0;RENT-INC|Rent received|income|Property|1|1;MORTGAGE|Home loan repayments|expense|Housing|1|0;HOME-INT|Home loan interest|expense|Housing|0|1;RATES-HOME|Council rates (home)|expense|Housing|1|1;HOME-INS|Home and contents insurance|expense|Housing|1|1;HOME-MAINT|Home maintenance|expense|Housing|1|1;GROCERIES|Groceries|expense|Essentials|1|1;UTILITIES|Energy and water|expense|Essentials|1|1;TELCO|Internet and mobile|expense|Essentials|1|1;TRANSPORT|Fuel and transport|expense|Essentials|1|1;CAR|Car costs|expense|Essentials|1|1;HEALTH|Health|expense|Essentials|1|1;CHILDCARE|Childcare|expense|Essentials|1|1;DINING|Dining and takeaway|expense|Lifestyle|1|1;SUBS|Subscriptions|expense|Lifestyle|1|1;SHOPPING|Shopping|expense|Lifestyle|1|1;KIDS-ACT|Kids activities|expense|Lifestyle|1|1;HOLIDAYS|Holidays and travel|expense|Lifestyle|1|1;GIFTS|Gifts|expense|Lifestyle|1|1;PERSONAL|Personal care|expense|Lifestyle|1|1;RENT-INT|Investment loan interest|expense|Property|1|1;RENT-MGMT|Property management fees|expense|Property|1|1;RENT-RATES|Rental rates and water|expense|Property|1|1;RENT-STRATA|Strata levies|expense|Property|1|1;RENT-INS|Landlord insurance|expense|Property|1|1;RENT-REPAIR|Rental repairs|expense|Property|1|1;RENT-OTHER|Other rental costs|expense|Property|1|1;WORK-EQUIP|Work equipment|expense|Work and giving|1|1;WORK-OTHER|Work registrations and courses|expense|Work and giving|1|1;DONATION|Donations|expense|Work and giving|1|1;FEES|Bank fees and card interest|expense|Fees|1|1;INCOME-TAX|Income tax assessed|expense|Tax|0|1;HELP-INDEX|HELP indexation|expense|Tax|0|1;TAX-REFUND|Tax refunds and payments|transfer|Tax|0|0;TRANSFER|Transfers between own accounts|transfer|Transfers|0|0;CC-PAY|Credit card payments|transfer|Transfers|0|0;UNCAT|Uncategorised|suspense|Uncategorised|1|1;PASS-THROUGH|Money that is someone else's|pass_through|Transfers|0|0;SUPER-PENSION|Super pension|income|Income|1|0;SELLING-COSTS|Selling costs|capital|Capital|0|0;x_RENT-PAID|Rent we pay|expense|Housing|1|1;x_CENTRELINK|Centrelink payments|income|Income|1|1;x_CHILD-SUPPORT|Child support received|income|Income|1|0;x_BUSINESS|Side business takings|income|Income|1|1`;
function setup() {
  const person = (id, name, birth) => ({ party_id: id, kind: "person", name, birth_date: birth });
  const org = (id, name, kind = "organisation") => ({ party_id: id, kind, name });
  const party = [person("PTY-RENEE", RENEE, "1986-05-17"), person("PTY-KOBI", KOBI, "2007-04-12"), person("PTY-AVA", AVA, "2017-08-03"), person("PTY-LUKAS", LUKAS, "1984-01-29"), person("PTY-RUTH", RUTH, "1958-10-02"), person("PTY-PRIYA", PRIYA, "1989-03-11"), person("PTY-SAM", SAM, "1992-07-25"),
    org("PTY-BLUEGUM", BLUE), org("PTY-BANKSIA", BANK), org("PTY-RIVERBEND", BOWLS), org("PTY-COUNCIL", COUNCIL, "government"), org("PTY-BARK", "Bark Bank"), org("PTY-WATTLE", "Wattle Credit Union"), org("PTY-HARBOUR", "Harbour Bank"), org("PTY-AMEWX", "Amewx"), org("PTY-PING", "PING"), org("PTY-HESTABBY", "HESTAbby"), org("PTY-PURRANNUATION", "Purrannuation"),
    org("PTY-TAX", "myGuv", "government"), org("PTY-CENTRELINK", "Centrelink", "government"), org("PTY-CSA", "Child Support", "government"), org("PTY-RTBA", "RTBA", "government"), org("PTY-MELREALTY", "Melton Realty"), org("PTY-COBREALTY", "Cobblebank Realty"), org("PTY-AFTERPAWS", "Afterpaws"), org("PTY-PURRSURE", "Purrsure"), org("PTY-GOLDLINE", "Goldline Power"), org("PTY-WATER", "Western Reach Water"), org("PTY-KITTEN", "Kittenhood OSHC Melton")];
  const membership = [["PTY-RENEE", "adult", "1986-05-17"], ["PTY-KOBI", "dependant", "2007-04-12", KOBI_LEAVES], ["PTY-AVA", "dependant", "2017-08-03"]].map(([party_id, role, valid_from, valid_to]) => ({ party_id, role, valid_from, ...(valid_to ? { valid_to } : {}), recorded_at: ON }));
  const acct = (account_id, name, cls, type, group, inst, extra = {}) => ({ account_id, name, class: cls, type, reporting_group: group, currency: "AUD", ...(inst ? { institution_party_id: inst } : {}), in_scope: true, liquid: group === "cash", fidelity: "ledger", ...extra });
  const account = [
    acct(EV, "Everyday, Bark", "asset", "transaction", "cash", "PTY-BARK"), acct(GS, "Goal saver, Bark", "asset", "savings", "cash", "PTY-BARK", { opened_on: GOAL_OPEN, closed_on: GOAL_CLOSE }), acct(SV, "Saver, Wattle", "asset", "savings", "cash", "PTY-WATTLE"), acct(BZ, "Business account, Harbour", "asset", "transaction", "cash", "PTY-HARBOUR", { opened_on: BIZ_OPEN }),
    acct(JT, "Old joint account, Wattle", "asset", "transaction", "cash", "PTY-WATTLE", { closed_on: JOINT_CLOSE }), acct(KB, "Kobi's youth saver, Wattle", "asset", "savings", "cash", "PTY-WATTLE"), acct(CC, "Amewx card", "liability", "credit_card", "cash", "PTY-AMEWX"),
    acct(SU, "Super, HESTAbby", "asset", "super", "super", "PTY-HESTABBY", { contract_id: "CON-SUPER", liquid: false }), acct(SO, "Old super, Purrannuation", "asset", "super", "super", "PTY-PURRANNUATION", { contract_id: "CON-SUPER-OLD", closed_on: ROLL_OUT, liquid: false }),
    acct(CL, "Car loan, PING", "liability", "loan", "loans", "PTY-PING", { contract_id: "CON-CARLOAN", closed_on: WRITE_OFF, liquid: false }), acct(HP, "HELP debt", "liability", "help_debt", "loans", "PTY-TAX", { liquid: false }), acct(MU, "Loan from Mum", "liability", "loan", "loans", null, { contract_id: "CON-MUM", opened_on: MUM_LOAN, liquid: false }), acct(BN, "Afterpaws", "liability", "loan", "loans", "PTY-AFTERPAWS", { contract_id: "CON-BNPL", liquid: false }),
    acct(BD, "Rental bond held by the RTBA", "asset", "receivable", "loans", "PTY-RTBA", { contract_id: "CON-BOND", liquid: false, opening_balance_cents: OPEN[BD], opening_date: START, note: "What we lodged, less Priya's half." }),
    acct(CA, "The Mazda", "asset", "vehicle", "vehicle", null, { asset_id: "AST-CAR-A", fidelity: "snapshot", closed_on: WRITE_OFF, liquid: false, opening_balance_cents: CAR_A, opening_date: START, note: "What we think it is worth." }),
    acct(CB, "The Toyota", "asset", "vehicle", "vehicle", null, { asset_id: "AST-CAR-B", fidelity: "snapshot", opened_on: NEW_CAR, liquid: false, opening_balance_cents: CAR_B, opening_date: NEW_CAR, note: "What we paid." }),
  ];
  const asset = [{ asset_id: "AST-CAR-A", kind: "vehicle", name: "The Mazda", account_id: CA, disposed_on: WRITE_OFF }, { asset_id: "AST-CAR-B", kind: "vehicle", name: "The Toyota", account_id: CB, acquired_on: NEW_CAR }];
  const al = (subject_type, subject_id, scheme, value, o = {}) => ({ subject_type, subject_id, scheme, value, valid_from: "2000-01-01", recorded_at: ON, ...o });
  const alias = [al("account", EV, "account_number", NUM.everyLast), al("account", SV, "account_number", NUM.saver), al("account", BZ, "account_number", NUM.biz), al("account", CC, "card_last4", NUM.card), al("account", SU, "member_number", NUM.superNew), al("account", SO, "member_number", NUM.superOld), al("account", CL, "loan_number", NUM.loan),
    ...[["PTY-RENEE", RENEE], ["PTY-KOBI", KOBI], ["PTY-AVA", AVA], ["PTY-LUKAS", LUKAS], ["PTY-RUTH", RUTH], ["PTY-PRIYA", PRIYA], ["PTY-SAM", SAM], ["PTY-BLUEGUM", BLUE], ["PTY-BANKSIA", BANK], ["PTY-RIVERBEND", BOWLS], ["PTY-COUNCIL", COUNCIL], ["PTY-CENTRELINK", "Centrelink"], ["PTY-CSA", "Child Support"], ["PTY-RTBA", "RTBA"], ["PTY-MELREALTY", "Melton Realty"], ["PTY-COBREALTY", "Cobblebank Realty"], ["PTY-AFTERPAWS", "Afterpaws"], ["PTY-KITTEN", "Kittenhood OSHC Melton"]].map(([id, name]) => al("party", id, "name", name)),
    al("contract", "CON-CARLOAN", "loan_number", NUM.loan), al("contract", "CON-MOTOR", "policy_number", NUM.motorA, { valid_to: "2025-04-01" }), al("contract", "CON-MOTOR", "policy_number", NUM.motorB, { valid_from: "2025-04-01" })];
  const own_ = (subject_type, subject_id, split, o = {}) => ["legal", "beneficial", "tax"].flatMap((basis) => split.map(([party_id, share_bps]) => ({ subject_type, subject_id, party_id, basis, share_bps, valid_from: "2000-01-01", recorded_at: ON, ...o })));
  const her = [["PTY-RENEE", 10000]], son = [["PTY-KOBI", 10000]], split = [["PTY-RENEE", 5000], ["PTY-LUKAS", 5000]];
  const ownership = [...[EV, GS, SV, BZ, CC, SU, SO, CL, HP, MU, BN, BD, CA, CB].flatMap((a) => own_("account", a, her)), ...own_("account", JT, split), ...own_("account", KB, son), ...own_("asset", "AST-CAR-A", her), ...own_("asset", "AST-CAR-B", her)];
  const category = CATS.split(";").map((r) => { const [category_id, name, kind, group, c, e] = r.split("|"); return { category_id, name, kind, group, cash_lens: c === "1", economic_lens: e === "1" }; });
  const con = (contract_id, kind, name, counterparty_party_id, holder_party_id, extra = {}) => ({ contract_id, kind, name, counterparty_party_id, holder_party_id, ...extra });
  const contract = [
    con("CON-BLUEGUM", "employment", "Renee at Bluegum", "PTY-BLUEGUM", "PTY-RENEE", { category_id: "SALARY", started_on: "2019-03-04", ended_on: JOB_END }), con("CON-BANKSIA", "employment", "Renee at Banksia", "PTY-BANKSIA", "PTY-RENEE", { category_id: "SALARY", started_on: "2025-02-10" }), con("CON-RIVERBEND", "employment", "Renee at the bowls club", "PTY-RIVERBEND", "PTY-RENEE", { category_id: "SALARY", started_on: "2025-03-10" }), con("CON-COUNCIL", "employment", "School crossing", "PTY-COUNCIL", "PTY-RENEE", { category_id: "SALARY", started_on: "2022-02-01", ended_on: "2024-12-20" }),
    con("CON-SUPER", "super_fund", "Renee's super", "PTY-HESTABBY", "PTY-RENEE", { account_id: SU }), con("CON-SUPER-OLD", "super_fund", "Renee's old super", "PTY-PURRANNUATION", "PTY-RENEE", { account_id: SO, ended_on: ROLL_OUT }),
    con("CON-CARLOAN", "loan", "Car loan", "PTY-PING", "PTY-RENEE", { account_id: CL, asset_id: "AST-CAR-A", category_id: "CAR", started_on: "2021-11-15", ended_on: WRITE_OFF }), con("CON-MUM", "loan", "Loan from Mum", "PTY-RUTH", "PTY-RENEE", { account_id: MU, started_on: MUM_LOAN }), con("CON-BNPL", "loan", "Afterpaws", "PTY-AFTERPAWS", "PTY-RENEE", { account_id: BN, category_id: "SHOPPING" }),
    con("CON-BOND", "commitment", "Rental bond at the RTBA", "PTY-RTBA", "PTY-RENEE", { account_id: BD }),
    con("CON-RENT-1", "lease", "The Melton unit", "PTY-MELREALTY", "PTY-RENEE", { category_id: "x_RENT-PAID", started_on: "2021-02-01", ended_on: MOVE }), con("CON-RENT-2", "lease", "The Cobblebank house", "PTY-COBREALTY", "PTY-RENEE", { category_id: "x_RENT-PAID", started_on: MOVE }), con("CON-PRIYA", "commitment", "Priya's half of the rent", "PTY-PRIYA", "PTY-RENEE", { category_id: "x_RENT-PAID", started_on: MOVE, ended_on: PRIYA_OUT }), con("CON-SAM", "commitment", "Sam's half of the rent", "PTY-SAM", "PTY-RENEE", { category_id: "x_RENT-PAID", started_on: "2026-02-01" }),
    con("CON-CENTRELINK", "commitment", "Centrelink payments", "PTY-CENTRELINK", "PTY-RENEE", { category_id: "x_CENTRELINK" }), con("CON-CSA", "commitment", "Child support for Kobi", "PTY-CSA", "PTY-RENEE", { category_id: "x_CHILD-SUPPORT", ended_on: KOBI_LEAVES }), con("CON-LUKAS", "commitment", "Child support for Ava", "PTY-LUKAS", "PTY-RENEE", { category_id: "x_CHILD-SUPPORT" }),
    con("CON-MOTOR", "insurance", "Motor insurance", "PTY-PURRSURE", "PTY-RENEE", { asset_id: "AST-CAR-A", category_id: "CAR" }), con("CON-POWER", "utility", "Electricity", "PTY-GOLDLINE", "PTY-RENEE", { category_id: "UTILITIES" }), con("CON-KIDS", "childcare", "Kittenhood OSHC", "PTY-KITTEN", "PTY-RENEE", { category_id: "CHILDCARE", ended_on: "2025-01-31" }),
  ];
  const lk = (relation, from_type, from_id, to_type, to_id, extra = {}) => ({ relation, from_type, from_id, to_type, to_id, valid_from: "2000-01-01", recorded_at: ON, ...extra });
  const link = [lk("contributes_to", "contract", "CON-BLUEGUM", "contract", "CON-SUPER"), lk("contributes_to", "contract", "CON-BANKSIA", "contract", "CON-SUPER"), lk("contributes_to", "contract", "CON-RIVERBEND", "contract", "CON-SUPER"),
    lk("secures", "contract", "CON-CARLOAN", "asset", "AST-CAR-A", { valid_to: WRITE_OFF }), lk("funds_purpose", "contract", "CON-CARLOAN", "asset", "AST-CAR-A", { share_bps: 10000, valid_to: WRITE_OFF }), lk("charged_to", "account", CC, "account", EV), lk("covers", "contract", "CON-MOTOR", "asset", "AST-CAR-A", { valid_to: WRITE_OFF }), lk("covers", "contract", "CON-MOTOR", "asset", "AST-CAR-B", { valid_from: "2025-04-01" })];
  const st = (stream_id, name, doc_kind, subject_type, subject_id, issuer_party_id, cadence, extra = {}) => ({ stream_id, name, doc_kind, subject_type, subject_id, issuer_party_id, cadence, valid_from: START, grace_days: 14, recorded_at: ON, ...extra });
  const stream = [
    st(EV, "Everyday download", "txn_csv", "account", EV, "PTY-BARK", "quarterly"), st(GS, "Goal saver download", "txn_csv", "account", GS, "PTY-BARK", "quarterly", { valid_from: GOAL_OPEN, valid_to: GOAL_CLOSE }), st(SV, "Saver download", "txn_ofx", "account", SV, "PTY-WATTLE", "quarterly"), st(BZ, "Business download", "txn_csv", "account", BZ, "PTY-HARBOUR", "quarterly", { valid_from: BIZ_OPEN }),
    st(JT, "Joint download", "txn_csv", "account", JT, "PTY-WATTLE", "quarterly", { valid_to: JOINT_CLOSE }), st(KB, "Kobi's download", "txn_csv", "account", KB, "PTY-WATTLE", "half_yearly", { valid_to: KOBI_LEAVES }), st(CC, "Amewx activity", "txn_csv", "account", CC, "PTY-AMEWX", "quarterly"), st("STM-CARD", "Amewx statement", "statement", "account", CC, "PTY-AMEWX", "monthly"),
    st(SU, "Super transactions", "super_lines", "account", SU, "PTY-HESTABBY", "half_yearly"), st(SO, "Old super transactions", "super_lines", "account", SO, "PTY-PURRANNUATION", "half_yearly", { valid_to: ROLL_OUT }), st("STM-SUPER", "Super statement", "super_statement", "account", SU, "PTY-HESTABBY", "yearly"),
    st("STM-CARLOAN", "PING statement", "loan_statement", "account", CL, "PTY-PING", "half_yearly", { valid_to: WRITE_OFF }), st(CL, "PING download", "txn_tsv", "account", CL, "PTY-PING", "yearly", { valid_to: WRITE_OFF }), st(HP, "HELP account", "help_balance", "account", HP, "PTY-TAX", "yearly"), st(BN, "Afterpaws app", "txn_csv", "account", BN, "PTY-AFTERPAWS", "event"),
    st("PAY-RENEE", "Payslips", "payslip", "party", "PTY-RENEE", "PTY-BLUEGUM", "fortnightly"), st("INC-RENEE", "Income statements", "income_statement", "party", "PTY-RENEE", "PTY-BLUEGUM", "yearly"), st("TAX-RENEE", "Notices of assessment", "tax_assessment", "party", "PTY-RENEE", "PTY-TAX", "yearly"),
    st("BILL-POWER", "Electricity bills", "bill", "contract", "CON-POWER", "PTY-GOLDLINE", "quarterly"), st("BILL-WATER", "Water bills", "bill", "party", "PTY-RENEE", "PTY-WATER", "quarterly"), st("POLICY-MOTOR", "Motor certificate", "policy", "contract", "CON-MOTOR", "PTY-PURRSURE", "yearly"), st("CHILDCARE", "Kittenhood statements", "childcare_statement", "contract", "CON-KIDS", "PTY-KITTEN", "monthly", { valid_to: "2025-01-31" }), st("RECEIPTS", "Receipts", "receipt", "party", "PTY-RENEE", null, "event"),
    st("BAS-STATEMENTS", "Activity statements", "activity_statement", "party", "PTY-RENEE", "PTY-TAX", "quarterly"), st("CENTRELINK-STMT", "Centrelink payment summaries", "statement", "party", "PTY-RENEE", "PTY-CENTRELINK", "yearly"), st("RENT-LEDGER", "Tenant ledger", "statement", "contract", "CON-RENT-2", "PTY-COBREALTY", "event"),
  ];
  let t = 0;
  const tm = (subject_type, subject_id, term, value, unit, valid_from, o = {}) => { t += 1; return { term_id: `TERM-${pad(t, 3)}`, subject_type, subject_id, term, value, unit, valid_from, recorded_at: ON, ...o }; };
  // only what a person knows offhand: the rate she signed, what the rent is, what the jobs pay
  const term = [tm("contract", "CON-CARLOAN", "interest_rate", "10.95", "pct", START), tm("contract", "CON-CARLOAN", "repayment_type", "principal_and_interest", null, START), tm("contract", "CON-CARLOAN", "repayment_cents", "38600", "cents", START), tm("contract", "CON-CARLOAN", "repayment_cadence", "monthly", null, START),
    tm("contract", "CON-MUM", "interest_rate", "0", "pct", MUM_LOAN), tm("contract", "CON-MUM", "repayment_type", "principal_and_interest", null, MUM_LOAN), tm("contract", "CON-MUM", "repayment_cents", "10000", "cents", "2024-11-01"), tm("contract", "CON-MUM", "repayment_cadence", "monthly", null, "2024-11-01"),
    tm("contract", "CON-BNPL", "interest_rate", "0", "pct", START), tm("contract", "CON-BNPL", "repayment_type", "principal_and_interest", null, START),
    tm("contract", "CON-RENT-1", "rent_cents", "84000", "cents", START, { valid_to: "2024-01-08" }), tm("contract", "CON-RENT-1", "rent_cents", "88000", "cents", "2024-01-08"), tm("contract", "CON-RENT-1", "rent_cadence", "fortnightly", null, START), tm("contract", "CON-RENT-2", "rent_cents", "132000", "cents", MOVE, { valid_to: "2025-10-06" }), tm("contract", "CON-RENT-2", "rent_cents", "138000", "cents", "2025-10-06"), tm("contract", "CON-RENT-2", "rent_cadence", "fortnightly", null, MOVE),
    tm("contract", "CON-BLUEGUM", "base_salary_cents", "3000000", "cents", START), tm("contract", "CON-BLUEGUM", "pay_cadence", "fortnightly", null, START), tm("contract", "CON-BANKSIA", "base_salary_cents", "3400000", "cents", "2025-02-10"), tm("contract", "CON-BANKSIA", "pay_cadence", "fortnightly", null, "2025-02-10"), tm("contract", "CON-RIVERBEND", "base_salary_cents", "680000", "cents", "2025-03-10"), tm("contract", "CON-RIVERBEND", "pay_cadence", "fortnightly", null, "2025-03-10"), tm("contract", "CON-COUNCIL", "base_salary_cents", "420000", "cents", START), tm("contract", "CON-COUNCIL", "pay_cadence", "monthly", null, START),
    tm("contract", "CON-MOTOR", "premium_cents", "9600", "cents", START, { valid_to: "2025-04-01" }), tm("contract", "CON-MOTOR", "premium_cents", "8400", "cents", "2025-04-01"), tm("contract", "CON-MOTOR", "premium_cadence", "monthly", null, START)];
  const activity = [{ activity_id: "ACT-WASH", kind: "sole_trader", name: "Suds on Wheels, mobile dog wash", owner_party_id: "PTY-RENEE", valid_from: "2021-08-01", recorded_at: ON }];
  const household = [{ household_id: "HH-TB", name: "Tamihana-Brandt", jurisdiction: "AU", base_currency: "AUD", fy_start_month: 7, timezone: "Australia/Melbourne", standard_version: "household-standard/1" }];
  return { household, party, membership, account, alias, ownership, category, contract, link, stream, asset, term, activity };
}

// ---------- build ----------
function build() {
  windows();
  carLoan(); everyday(); payroll(); centrelink(); childSupport(); business(); housing(); car(); bnpl(); oldJoint(); kobi(); bills(); lineTraps(); taxes(); roundUps(); drawings(); settleCard(); sweeps(); overdrawn(); superFunds(); helpDebt(); interestCredits();
  fileTraps();
  { const near = B.lines.filter((x) => x.acct === EV && x.cents === 30000 && x.date >= "2024-12-16" && x.date <= "2024-12-21"); if (near.length !== 2) throw new Error(`T4-SAME-NAME-MUM wants two credits, has ${near.length}`); }
  const tb = truthBalances();
  leaverTrap(tb.balances);
  const t = truth(tb);
  const lows = {}; for (const a of [EV, GS, SV, BZ, JT, KB]) lows[a] = Math.min(...chain(a).map((x) => x.balance));
  for (const [a, v] of Object.entries(lows)) if (v < (a === EV ? -50000 : 0)) throw new Error(`${a} goes overdrawn: ${money(v)}`);
  render();
  const tSetup = setup();
  fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
  const manifest = { household: "HH-TB", files: FILES.map((f) => ({ path: f.path, stream_id: f.stream, download_date: f.day, name: f.name, origin: f.origin || "portal", issued_on: f.issued_on || null })) };
  for (const f of FILES) { const p = path.join(OUT, f.path); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, f.bytes); }
  fs.writeFileSync(path.join(OUT, "manifest.json"), `${JSON.stringify(manifest, null, 1)}\n`);
  fs.writeFileSync(path.join(OUT, "truth.json"), `${JSON.stringify(t, null, 1)}\n`);
  fs.mkdirSync(SETUP_DIR, { recursive: true });
  for (const n of fs.readdirSync(SETUP_DIR)) fs.rmSync(path.join(SETUP_DIR, n));
  for (const [k, v] of Object.entries(tSetup)) fs.writeFileSync(path.join(SETUP_DIR, `${k}.json`), `${JSON.stringify(v, null, 1)}\n`);
  return { files: FILES.length, lines: B.lines.length, traps: B.traps.length, fresh: B.traps.filter((x) => x.fresh).length, dc: B.traps.filter((x) => x.dc).length, lows };
}

if (require.main === module) { const r = build(); console.log(`Held-out household 4: ${r.files} files, ${r.lines} lines, ${r.traps} traps (${r.fresh} in none of the earlier lists, ${r.dc} new double-count or silent-number variants). Lowest balances: ${Object.entries(r.lows).map(([a, v]) => `${a} ${money(v)}`).join(", ")}.`); }
module.exports = { build, OUT, SETUP_DIR, book: B };
