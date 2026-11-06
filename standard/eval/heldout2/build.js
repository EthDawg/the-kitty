#!/usr/bin/env node
/* The second held-out household. The first blind household found real defects and the engine was repaired against fixtures, so that household's score after repair proves
   nothing. This family answers the only honest question left: do the repairs generalise, or did they fit one family?

   The Reyes-Wolaks of Belmont, Victoria, 36 months from July 2023 to June 2026. Everything here is fictional. Imogen Reyes starts the window on parental leave, a sole parent of two
   with a split home loan, a negatively geared rental run by a managing agent, an offset account, a HELP debt, US share units from her employer and child support from her ex. Tomasz
   Wolak joins in March 2025 with his own bank, super and crypto, a drone side income and a redundancy to come. Written blind: from SPEC.md, RECIPES.md, the schemas, the public recipes,
   the intake, the world's file writers and the first held-out folder. File layouts the recipes do not spell out were recovered by searching for the recipes' public fingerprints.

   Order of work, as in the first household: a life is simulated first and held in cents, day by day. Only then are files rendered from it, as each institution would hand them over.
   Truth is written from the simulation and never from the engine. Setup is what a person would answer at onboarding: no rules, no decisions, no opening balances a file states.

   node standard/eval/heldout2/build.js
   writes standard/.build/heldout2/{sources,manifest.json,truth.json} and standard/eval/heldout2/setup/<table>.json. Node 22, no dependencies, seeded, no clock. */
"use strict";
const fs = require("fs"), path = require("path"), zlib = require("zlib");

const STD = path.join(__dirname, "..", "..");
const LIB = path.join(STD, "world", "lib");
const { pad, fix, money, addDays, dayDiff, weekday, monthEnd, nextMonth, monthRange, fmtDate, dmy, fyOf, csvLines, Rng, MONTHS: MON } = require(path.join(LIB, "util"));
const { Doc, M: MARGIN } = require(path.join(LIB, "pdf"));
const { eml, page, row } = require(path.join(LIB, "mail"));
const { ofx } = require(path.join(LIB, "bankfiles"));

const OUT = path.join(STD, ".build", "heldout2");
const SETUP_DIR = path.join(__dirname, "setup");
const START = "2023-07-01", END = "2026-06-30", MONTHS = monthRange("2023-07", "2026-06");
const JOIN = "2025-03-24", RENUM = "2025-04-01", REFI = "2025-02-14", AGENT2 = "2024-10-14";
const rng = (name) => new Rng(`reyes-wolak:${name}`);
const deflate = (b) => new Uint8Array(zlib.deflateSync(b));

// ---------- who and what ----------
const IM = "Imogen Reyes", TOM = "Tomasz Wolak", NOA = "Noa Reyes", ELIO = "Elio Reyes";
const HB = "ACC-EVERY", OF = "ACC-OFFSET", SV = "ACC-SAVER", TW = "ACC-TOM", CC = "ACC-CARD", BK = "ACC-BROKER", SH = "ACC-SHARES", PL = "ACC-PLAN", CX = "ACC-COIN", CW = "ACC-COLD", HF = "ACC-HOME-FIXED", HV = "ACC-HOME-VAR", IP = "ACC-INV-PING", IW = "ACC-INV-NEW", SI = "ACC-SUPER-IM", ST = "ACC-SUPER-TOM", HP = "ACC-HELP", HO = "ACC-HOME", RP = "ACC-RENTAL";
const NUM = { harbour: "714220938116", harbour2: "714220951077", wattle: "0061820475", card: "77132", cardFull: "xxxx-xxxxxx-77132", broker: "CT-6624190", hin: "X0031177", fixed: "553 110 881", variable: "553 110 882", ping: "PNG-30017733", invNew: "553 110 905", superIm: "HST-7731046", superTom: "PUR-5120884", plan: "ETR-5588213", wallet: "bc1qxf7k2hd9m3w0t6pzr4", ownerPm: "PM-44120", ownerRp: "RP-7710" };
const HOME = "9 Saltbush Court, Belmont", RENTAL = "14 Wattlebird Lane, Sebastopol";
const CASH = [HB, OF, SV, TW, CC, BK];

// ---------- the book: every line that ever touches an account, in cents, holder's sign ----------
const B = { seq: 0, lines: [], transit: [], pairs: [], counts: {}, traps: [] };
const count = (k, n = 1) => { B.counts[k] = (B.counts[k] || 0) + n; };
function line(acct, date, desc, cents, o = {}) { B.seq += 1; const r = { seq: B.seq, acct, date, desc, cents, ...o }; B.lines.push(r); return r; }
const spend = (acct, date, desc, cents, cat, o = {}) => line(acct, date, desc, -cents, { lens: "spending", cat, ...o });
const earn = (acct, date, desc, cents, cat, o = {}) => line(acct, date, desc, cents, { lens: "income", cat, ...o });
/* money between own accounts: out on one date, in on another. Between those dates it is still the household's; truth carries it as money in transit. */
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
const lastBiz = (ym) => prevBiz(monthEnd(ym));
const posted = (x) => x.posted || x.date;
const byTime = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.seq - b.seq);
const byPost = (a, b) => (posted(a) < posted(b) ? -1 : posted(a) > posted(b) ? 1 : a.seq - b.seq);

/* trap register. fresh: not in BLIND-1's list. dc: a new variant of double counting or of a number silently wrong. A probe is a fact run.js can test against what the engine produced. */
function trap(id, name, where, expect, probe, o = {}) { B.traps.push({ id, name, where, expect, probe, fresh: !!o.fresh, dc: !!o.dc }); }
const plain = (x, want, extra = {}) => ({ account: x.acct, date: x.date, ...(x.posted && x.posted !== x.date ? { posted: x.posted } : {}), cents: x.cents, want, ...extra });

// ---------- merchants, all invented ----------
const MER = {
  grocer: [["SALT LAGOON GROCER", "GEELONG"], ["CORIO PANTRY", "NEWTOWN"], ["BELLPOST FRESH", "BELMONT"]],
  cafe: [["TIDE AND TONIC", "GEELONG"], ["OLD PIER COFFEE", "TORQUAY"], ["THE MUSTARD SEED", "BELMONT"]],
  dine: [["BLUE HERON THAI", "GEELONG"], ["SANDBAR PIZZERIA", "OCEAN GROVE"], ["THE PAPERBARK", "BARWON HEADS"]],
  fuel: [["SURFCOAST FUEL", "GROVEDALE"], ["SURFCOAST FUEL", "WAURN PONDS"]],
  shop: [["KIDSTUFF AND CO", "GEELONG"], ["PARCELPAW ONLINE", "SYDNEY"], ["LOBSTER POT HARDWARE", "BELMONT"], ["HARDIE AND FIG", "GEELONG"], ["RIVERSTONE HOMEWARES", "WAURN PONDS"]],
  chem: [["CORIO CHEMIST", "BELMONT"], ["CORIO CHEMIST", "GEELONG"]],
  lunch: [["MARINA ROLLS", "GEELONG"], ["FITTERS CANTEEN", "NORTH SHORE"]],
};
const cardDesc = (m) => `${m[0]} ${m[1]}`;
const cardCsv = (m) => `${m[0].padEnd(26)}${m[1]}  VIC`;
const hbPos = (m) => `DEBIT CARD PURCHASE ${m[0]} ${m[1]} AUS`;
const twPos = (m, d) => `Visa Purchase ${d.slice(8)}/${d.slice(5, 7)} ${m[0]} ${m[1]}`;

/* one card purchase. date is the day it was charged, which the statement shows; posted is the day the activity download shows. Lag is in business days, and public holidays stretch it. */
function card(r, date, m, c, cat, member, o = {}) {
  const lag = o.lag != null ? o.lag : r.pick([0, 0, 1, 1, 1, 2, 2, 3, 4, 5]);
  const post = o.posted || (lag ? bizAfter(date, lag) : date);
  return line(CC, date, o.desc || cardDesc(m), -c, { posted: post, csv: o.csv || cardCsv(m), member, lens: o.lens === undefined ? "spending" : o.lens, cat, ...o.extra });
}

// ---------- everyday life ----------
function everyday() {
  const r = rng("everyday"), pick = (a) => r.pick(a);
  for (let d = "2023-06-15"; d <= END; d = addDays(d, 1)) {
    const wd = weekday(d), who = () => (d >= JOIN && r.next() < 0.35 ? TOM : IM), inWin = d >= START;
    if (r.next() < 0.34) { card(r, d, pick(MER.grocer), cents(r, 36, 198), "GROCERIES", who()); count("purchase"); }
    if (r.next() < 0.22) { card(r, d, pick(MER.cafe), cents(r, 5, 18), "DINING", who()); count("purchase"); }
    if ((wd === 5 || wd === 6) && r.next() < 0.4) { card(r, d, pick(MER.dine), cents(r, 26, 104), "DINING", who()); count("purchase"); }
    if (r.next() < 0.09) { card(r, d, pick(MER.fuel), cents(r, 46, 92), "TRANSPORT", who()); count("purchase"); }
    if (r.next() < 0.07) { card(r, d, pick(MER.shop), cents(r, 22, 210), "SHOPPING", who()); count("purchase"); }
    // two subscriptions at one price on one day, at different merchants; one stops
    if (d.slice(8) === "09") { card(r, d, ["NORTHLIGHT STREAM", "ONLINE"], 1699, "SUBS", IM); count("purchase"); if (d < "2025-03-01") { card(r, d, ["TUNEBARN MUSIC", "ONLINE"], 1699, "SUBS", IM); count("purchase"); } }
    if (!inWin) continue;
    if (r.next() < 0.1) { spend(HB, d, hbPos(pick(MER.chem)), cents(r, 9, 58), "HEALTH"); count("purchase"); }
    if (d.slice(8) === "03") { spend(HB, d, "DIRECT DEBIT TIDELINE MOBILE 22019", 4500, "TELCO"); spend(HB, d, "DIRECT DEBIT BELLNET FIBRE 80771", 8900, "TELCO"); count("purchase", 2); }
    if (d.slice(8) === "01") { spend(HB, d, "ACCOUNT KEEPING FEE", 400, "FEES"); count("purchase"); }
    if (wd === 2 && r.next() < 0.3 && d >= "2024-02-01") { spend(HB, d, "DIRECT DEBIT LITTLE FINS SWIM SCHOOL", 3400, "KIDS-ACT"); count("purchase"); }
    if (d >= JOIN) {
      if (r.next() < 0.2 && isBiz(d)) { spend(TW, d, twPos(pick(MER.lunch), d), cents(r, 9, 22), "DINING"); count("purchase"); }
      if (r.next() < 0.05) { spend(TW, d, twPos(pick(MER.shop), d), cents(r, 18, 150), "SHOPPING"); count("purchase"); }
      if (d.slice(8) === "06") { spend(TW, d, "IRONBARK GYM MONTHLY PACK", 6200, "PERSONAL"); count("purchase"); }
    }
  }
  // Medicare pays back through Services Australia, the same name as child support and parental pay. A refund of health costs, never income
  const backs = [["2023-09-14", 4120], ["2024-02-20", 8635], ["2024-11-07", 4120], ["2025-05-19", 12040], ["2026-02-11", 4385]];
  for (const [d, c] of backs) { spend(HB, addDays(d, -2), "DEBIT CARD PURCHASE BELMONT FAMILY MEDICAL AUS", c + 3800, "HEALTH"); line(HB, d, "SERVICES AUSTRALIA MEDICARE 7731", c, { lens: "spending", cat: "HEALTH" }); count("purchase"); count("health_rebate"); }
  trap("T2-MEDICARE-SA", "A Medicare refund under the Services Australia name", `${HB} on ${backs.map((b) => b[0]).join(", ")}: the same payer stem as child support and parental pay`, "Lowers HEALTH spending. It is not income.",
    { kind: "lines", lines: backs.map(([d, c]) => ({ account: HB, date: d, cents: c, want: "spending" })) });
  // a shared-care relative does not exist here; a gift from outside the household does, and a second-hand bike in the same week at the same amount
  const a = spend(HB, "2025-05-12", "OSKO TO B NOWAK SECOND HAND BIKE", 40000, "SHOPPING"), b = earn(TW, "2025-05-13", "OSKO FROM H WOLAK BIRTHDAY", 40000, "GIFT-IN"); count("purchase"); count("gift_in");
  trap("T2-FALSE-PAIR", "Two strangers' Oskos, equal and opposite, a day apart, on two own accounts", `${HB} ${a.date} -400.00 to a stranger for a bike; ${TW} ${b.date} +400.00 from his mother`, "One is spending and one is income. Neither is a transfer. If they pair, 400.00 of spending and of income vanish and nothing says so.",
    { kind: "lines", lines: [plain(a, "spending"), plain(b, "income")] }, { fresh: true, dc: true });
}

// ---------- pay ----------
const PAY = { slips: [] };
const LUMEN = "Lumen Arc Software Pty Ltd", BRIGHT = "Brightwater Civil Pty Ltd", COBALT = "Cobalt Rail Services Pty Ltd";
const sgRate = (d) => (d < "2024-07-01" ? 11 : d < "2025-07-01" ? 11.5 : 12);
function slip(person, employer, payDate, from, to, gross, taxRate, o = {}) {
  const tax = Math.round(gross * taxRate / 100) * 100, sg = Math.round((o.sgOn != null ? o.sgOn : gross) * sgRate(payDate) / 100), net = gross - tax;
  const s = { person, employer, payDate, from, to, gross, tax, super: sg, net, fy: fyOf(payDate), ...o };
  PAY.slips.push(s); if (!s.pre) count("payslip");
  return s;
}
function payroll() {
  const r = rng("payroll");
  // parental leave pay comes from the government, fortnightly, with no payslip
  const ppl = []; for (let d = "2023-07-04"; d <= "2023-09-26"; d = addDays(d, 14)) ppl.push(earn(HB, d, "SERVICES AUSTRALIA PPL 7731", 176440, "x_PARENTAL-PAY"));
  count("parental_leave_pay", ppl.length);
  trap("T2-PPL", "Parental leave pay, with no payslip", `${HB}: ${ppl.length} fortnights of 1,764.40 from ${ppl[0].date}, "SERVICES AUSTRALIA PPL 7731"`, "Income, in the cash lens, from a payer that is not an employer in setup.",
    { kind: "lines", lines: ppl.slice(0, 3).map((x) => plain(x, "income")) }, { fresh: true });
  // Imogen back at work from October 2023, fortnightly on Thursdays
  for (let d = "2023-10-05"; d <= END; d = addDays(d, 14)) {
    const base = d < "2024-07-01" ? 620000 : d < "2025-07-01" ? 645000 : 670000, bonus = d === "2024-09-12" ? 900000 : 0;
    const s = slip(IM, LUMEN, d, addDays(d, -11), addDays(d, -4), base + bonus, 0.31);
    s.acctLast = d < RENUM ? "8116" : "1077";
    s.bank = [[HB, d, "LUMEN ARC SOFTWARE PAYROLL 0091", s.net]];
    if (d >= "2024-02-01") { s.bank = [[HB, d, "LUMEN ARC SOFTWARE PAYROLL 0091", s.net - 120000], [OF, d, "LUMEN ARC SOFTWARE PAY SPLIT", 120000]]; s.split = true; }
    for (const [a, dd, desc, c] of s.bank) earn(a, dd, desc, c, "SALARY");
    count("wage_bank_line", s.bank.length);
  }
  // Tomasz: monthly on the 15th, a year of it before he joined the household, which only his year-end documents show
  for (const ym of monthRange("2024-07", "2025-10")) {
    const d = prevBiz(`${ym}-15`), pre = d < JOIN;
    const s = slip(TOM, BRIGHT, d, `${ym}-01`, monthEnd(ym), 1025000, 0.29, { pre });
    s.acctLast = "0475";
    if (!pre) { earn(TW, d, "BRIGHTWATER CIVIL WAGES", s.net, "SALARY"); count("wage_bank_line"); }
  }
  // redundancy: one payslip, leave and the redundancy together, reaching the bank as two credits three days apart
  const fin = slip(TOM, BRIGHT, "2025-11-07", "2025-11-01", "2025-11-07", 6025000, 0.16, { sgOn: 425000 });
  fin.acctLast = "0475"; fin.redundancy = true;
  const f1 = earn(TW, "2025-11-07", "BRIGHTWATER CIVIL FINAL PAY", 1200000, "SALARY"), f2 = earn(TW, "2025-11-10", "BRIGHTWATER CIVIL TERMINATION PMT", fin.net - 1200000, "SALARY"); count("wage_bank_line", 2);
  trap("T2-REDUNDANCY", "A redundancy: one large payslip, two credits on different days", `Tomasz ${fin.payDate}: gross ${money(fin.gross)}, net ${money(fin.net)}, banked as ${money(f1.cents)} and ${money(f2.cents)} on ${TW}`, "Both credits clear the one payslip. Cash income is the net once, and no payroll clearing stays open.",
    { kind: "lines", clearing: "clearing:payroll:PTY-BRIGHTWATER", lines: [plain(f1, "income"), plain(f2, "income")] }, { fresh: true, dc: true });
  // eleven weeks later, a new employer on the last working day
  for (const ym of monthRange("2026-02", "2026-06")) {
    const d = lastBiz(ym), s = slip(TOM, COBALT, d, `${ym}-01`, monthEnd(ym), 985000, 0.285);
    s.acctLast = "0475"; earn(TW, d, `COBALT RAIL SVCS SAL ${ym.replace("-", "")}`, s.net, "SALARY"); count("wage_bank_line");
  }
  const splits = PAY.slips.filter((s) => s.split);
  trap("T2-PAY-SPLIT", "One payslip, two credits, the second to an offset account", `Imogen from 2024-02-01: ${splits.length} pays, net less 1,200.00 to ${HB} and 1,200.00 to ${OF}. The account behind the first credit changes number in April 2025`, "Both credits clear the payslip across the renumbering. Salary counted once.",
    { kind: "lines", clearing: "clearing:payroll:PTY-LUMEN", lines: splits.filter((s, i) => i < 3 || (s.payDate > RENUM && s.payDate < "2025-05-15")).flatMap((s) => s.bank.map(([a, dd, , c]) => ({ account: a, date: dd, cents: c, want: "income" }))) });
  // child support, monthly, through the agency; the amount moves with each assessment
  const cs = []; for (const ym of monthRange("2023-11", "2026-06")) { const c = ym < "2024-07" ? 78211 : ym < "2025-07" ? 81240 : 84975; cs.push(earn(HB, nextBiz(`${ym}-12`), "SERVICES AUSTRALIA CHILD SUPPORT 7731", c, "x_CHILD-SUPPORT")); count("child_support"); }
  trap("T2-CHILD-SUPPORT", "Child support received", `${HB}: ${cs.length} monthly credits from ${cs[0].date}`, "Income, from outside the household.",
    { kind: "lines", lines: [cs[0], cs[12], cs[24]].map((x) => plain(x, "income")) }, { fresh: true });
  void r;
}

// ---------- the employer pays Imogen back ----------
function reimbursement() {
  const r = rng("reimbursement");
  const a = card(r, "2024-05-14", ["SKYBRIDGE AIR", "ONLINE"], 54210, null, IM, { lens: null, lag: 2 });
  const c = line(HB, "2024-06-04", "LUMEN ARC SOFTWARE EXPENSES 0091", 54210, {});
  count("employer_reimbursement");
  trap("T2-REIMB", "An employer's credit that is not pay", `${CC} ${a.date} a flight for work; ${HB} ${c.date} repaid by the employer, whose name is the same as on the payroll line, with no payslip to clear`, "SPEC 4.4c: neither income nor spending, and not a wage. Only the credit is probed: the engine cannot know the flight was for work without being told, so the outlay is not held against it.",
    { kind: "lines", lines: [plain(c, "neither")] });
}

// ---------- the home loan, split, and the rental's loan: interest-only, then refinanced ----------
const LOANS = { fixed: [], variable: [], ping: [], pingLines: [], newInv: [] };
const RATE_F = [["2023-07-01", "5.89"], ["2025-03-01", "6.19"]], RATE_V = [["2023-07-01", "6.34"], ["2024-12-03", "6.09"], ["2025-05-27", "5.84"], ["2025-08-19", "5.59"]], RATE_N = [[REFI, "5.99"], ["2025-08-19", "5.74"]], RATE_P = [["2023-07-01", "6.49"], ["2024-05-01", "6.74"]];
const rateOn = (t, d) => { let x = t[0][1]; for (const [f, v] of t) if (d >= f) x = v; return x; };
const dailyInterest = (bal, pct) => Math.abs(bal) * Number(pct) / 100 / 365;
const FIX_OPEN = -31040000, VAR_OPEN = -29612000, PING_OPEN = -41200000, CASHOUT = 1500000;

function pingLoan() {
  // interest-only from before the window: interest charged at month end, the same amount paid on the first working day after, and the balance does not move
  let bal = PING_OPEN, accrued = 0, due = 0;
  const push = (d, desc, c) => { bal += c; LOANS.pingLines.push({ date: d, desc, cents: c, balance: bal }); return line(IP, d, desc, c, {}); };
  for (const ym of monthRange("2023-07", "2025-02")) {
    const open = bal; let paid = 0, charged = 0, done = false;
    for (let d = `${ym}-01`; d <= monthEnd(ym) && !done; d = addDays(d, 1)) {
      if (d === nextBiz(`${ym}-01`) && due) { push(d, "REPAYMENT DIRECT DEBIT", due); paid += due; spend(OF, d, "PING FINANCE LOAN REPAYMENT 30017733", due, "RENT-INT"); count("loan_repayment"); due = 0; }
      accrued += dailyInterest(bal, rateOn(RATE_P, d));
      if (d === REFI) {
        const i = Math.round(accrued); accrued = 0; push(d, "INTEREST TO PAYOUT", -i); charged += i;
        const owed = -bal; push(d, "PAYOUT RECEIVED THANK YOU", owed); paid += owed;
        LOANS.ping.push({ ym, rate: rateOn(RATE_P, d), open, interest: charged, paid, close: bal });
        LOANS.payout = owed; done = true;
      }
    }
    if (done) break;
    const i = Math.round(accrued); accrued = 0; push(monthEnd(ym), "INTEREST CHARGED", -i); charged += i; due = i;
    LOANS.ping.push({ ym, rate: rateOn(RATE_P, monthEnd(ym)), open, interest: charged, paid, close: bal });
    count("loan_interest");
  }
  // the refinance: the new lender pays the old one directly, no bank line anywhere; the draw is larger than the payout and the difference reaches the offset; a discharge fee is paid from it
  const cash = line(OF, REFI, "WESTPAW LOAN DRAWDOWN 553110905", CASHOUT, {});
  const fee = spend(OF, "2025-02-17", "PING FINANCE DISCHARGE FEE", 35000, "FEES"); count("purchase");
  LOANS.cashout = cash; LOANS.fee = fee;
}
function homeRepayments() {
  // two splits, one lender, same day, same amount, one account, until the fixed period ends
  for (const ym of MONTHS) {
    const d = nextBiz(`${ym}-01`);
    spend(HB, d, "WESTPAW HOME LOAN 0881 REPAYMENT", d < "2025-03-01" ? 195000 : 210500, "MORTGAGE", { loan: HF });
    spend(HB, d, "WESTPAW HOME LOAN 0882 REPAYMENT", 195000, "MORTGAGE", { loan: HV });
    count("loan_repayment", 2);
  }
  for (const ym of monthRange("2025-03", "2026-06")) { const d = nextBiz(`${ym}-03`); spend(OF, d, "WESTPAW INV LOAN 0905 REPAYMENT", 295000, "RENT-INT", { loan: IW }); count("loan_repayment"); }
}
/* Interest is charged on the last day of the month on the daily balance, and the variable split nets the offset's closing balance each day. This runs after every offset line is booked. */
function chargeInterest() {
  const offsetBy = {}; { let b = OPEN[OF]; const ls = B.lines.filter((x) => x.acct === OF).sort(byTime); let i = 0; for (let d = START; d <= END; d = addDays(d, 1)) { while (i < ls.length && ls[i].date <= d) { b += ls[i].cents; i += 1; } offsetBy[d] = b; } }
  const run = (open, table, loan, list, from, useOffset) => {
    let bal = open, accrued = 0;
    for (const ym of monthRange(from.slice(0, 7), "2026-06")) {
      const mOpen = bal; let paid = 0; const s = ym === from.slice(0, 7) ? from : `${ym}-01`;
      for (let d = s; d <= monthEnd(ym); d = addDays(d, 1)) {
        for (const x of B.lines) if (x.loan === loan && x.date === d) { bal -= x.cents; paid -= x.cents; }
        const base = useOffset ? Math.max(0, -bal - offsetBy[d]) : -bal;
        accrued += dailyInterest(base, rateOn(table, d));
      }
      const i = Math.round(accrued); accrued = 0; bal -= i;
      list.push({ ym, rate: rateOn(table, monthEnd(ym)), open: mOpen, interest: i, paid, close: bal, offset: useOffset ? offsetBy[monthEnd(ym)] : null });
      count("loan_interest");
    }
  };
  run(FIX_OPEN, RATE_F, HF, LOANS.fixed, START, false);
  run(VAR_OPEN, RATE_V, HV, LOANS.variable, START, true);
  run(-(LOANS.payout + CASHOUT), RATE_N, IW, LOANS.newInv, REFI, false);
}
function loanTraps() {
  const ms = ["2024-03", "2024-08"], sample = ms.map((m) => nextBiz(`${m}-01`));
  trap("T2-SPLIT-SAME-AMOUNT", "Two loan splits, same lender, same day, same amount, same account", `${HB}: "WESTPAW HOME LOAN 0881" and "0882", 1,950.00 each, on the first working day of every month to February 2025`, "Two repayments, both spending at cash, one to each split. Neither is a duplicate and each split's balance is the lender's.",
    { kind: "lines", clearing: "clearing:loan:ACC-HOME", lines: sample.map((d) => ({ account: HB, date: d, cents: -195000, want: "spending", n: 2 })), balances: [{ account: HF, months: ["2024-03", "2024-08", "2025-03"] }, { account: HV, months: ["2024-03", "2024-08", "2025-03"] }] }, { fresh: true });
  const io = B.lines.filter((x) => x.acct === OF && /PING FINANCE LOAN REPAYMENT/.test(x.desc));
  trap("T2-INTEREST-ONLY", "An interest-only loan: the repayment is the interest", `${IP}: ${io.length} repayments on ${OF}, each last month's interest, the balance flat at ${money(-PING_OPEN)}`, "Spending once at the cash amount. The interest on the lender's file does not count again, and the balance does not move.",
    { kind: "lines", lines: [io[2], io[9]].map((x) => plain(x, "spending")), balances: [{ account: IP, months: ["2023-12", "2024-06", "2024-12"] }] }, { fresh: true, dc: true });
  trap("T2-REFINANCE", "A refinance with no bank line, and a cash-out", `${IP} paid out ${REFI} by ${IW}, ${money(LOANS.payout)}, no cash on any bank file. The new loan is drawn ${money(LOANS.payout + CASHOUT)} and ${money(CASHOUT)} reaches ${OF}`, "The old loan ends at zero, the new one is the lender's figure, and net worth does not move. The drawdown is neither income nor spending.",
    { kind: "lines", zero_after: { account: IP, from: "2025-02" }, lines: [plain(LOANS.cashout, "neither"), plain(LOANS.fee, "spending")], balances: [{ account: IW, months: ["2025-01", "2025-02", "2025-03", "2025-06"] }] }, { fresh: true, dc: true });
  trap("T2-OFFSET-INTEREST", "Interest on a split net of its offset", `${HV}: daily interest on the balance less ${OF}, at a rate that falls three times, one notice backdated`, "L6 holds for the variable split every month: the offset link is read and the rate history is the notices'.",
    { kind: "law", law: "L6", scope: "CON-HOME-VAR" }, { fresh: true });
}

// ---------- the rental, by two agents ----------
const RENT = { pm: [], rp: [], receipts: [] };
function rental() {
  const rentOn = (d) => (d < "2025-01-01" ? 128000 : 132000), receipts = [];
  for (let d = "2023-07-07"; d <= END; d = addDays(d, 14)) receipts.push({ date: d, amt: rentOn(d) });
  // PropertyMeow to the end of September 2024, seven per cent, paid three working days after month end
  for (const ym of monthRange("2023-07", "2024-09")) {
    const rows = receipts.filter((x) => ymOf(x.date) === ym), gross = rows.reduce((t, x) => t + x.amt, 0), fees = Math.round(gross * 0.07), disbursed = gross - fees, paid = bizAfter(monthEnd(ym), 3);
    RENT.pm.push({ ym, from: `${ym}-01`, to: monthEnd(ym), rows, gross, fees, disbursed, paid });
    earn(OF, paid, "PROPERTYMEOW TRUST 44120 OWNER", disbursed, "RENT-INC"); count("rent_disbursement");
  }
  // between agents the tenant paid Imogen directly, once
  const direct = earn(OF, "2024-10-04", "OSKO FROM R ACHARYA RENT OCT", 128000, "RENT-INC"); count("rent_direct");
  trap("T2-TENANT-DIRECT", "Rent paid straight to the owner between two agents", `${OF} ${direct.date}: 1,280.00 from the tenant, on no owner statement`, "Income. The first witness a rent has here is the bank line.",
    { kind: "lines", lines: [plain(direct, "income")] }, { fresh: true });
  // Goldfields Realty from 14 October 2024, six and a half per cent, on the same portal software. It takes repairs out of the rent before paying
  const repairs = { "2025-03": 61240, "2025-08": 118500 }, sundry = { "2025-08": 3300 };
  for (const ym of monthRange("2024-10", "2026-06")) {
    const from = ym === "2024-10" ? AGENT2 : `${ym}-01`, rows = receipts.filter((x) => x.date >= from && ymOf(x.date) === ym), gross = rows.reduce((t, x) => t + x.amt, 0), fees = Math.round(gross * 0.065), rep = repairs[ym] || 0, oth = sundry[ym] || 0, disbursed = gross - fees - rep - oth;
    const paid = ym === "2024-12" ? "2025-01-13" : bizAfter(monthEnd(ym), 2), o = { ym, from, to: monthEnd(ym), rows, gross, fees, repairs: rep, other: oth, disbursed, paid };
    RENT.rp.push(o);
    // from July 2025 it pays twice in each month: half on the 16th, the rest after month end
    if (ym >= "2025-07" && ym < "2026-06") { const half = Math.floor(disbursed / 2 / 100) * 100, a = nextBiz(`${ym}-16`); o.split = [[a, half], [paid, disbursed - half]]; earn(OF, a, "GOLDFIELDS REALTY TRUST 7710", half, "RENT-INC"); earn(OF, paid, "GOLDFIELDS REALTY TRUST 7710", disbursed - half, "RENT-INC"); count("rent_disbursement", 2); } else { earn(OF, paid, "GOLDFIELDS REALTY TRUST 7710", disbursed, "RENT-INC"); count("rent_disbursement"); }
  }
  const net = RENT.rp.find((x) => x.ym === "2025-03"), late = RENT.rp.find((x) => x.ym === "2024-12"), two = RENT.rp.find((x) => x.ym === "2025-10"), tail = RENT.rp.find((x) => x.ym === "2025-08");
  trap("T2-AGENT-NETS-REPAIR", "A rent receipt the agent has netted against a repair", `${OF}: March 2025 pays ${money(net.disbursed)} on gross ${money(net.gross)}, after a ${money(net.fees)} fee and a ${money(net.repairs)} plumber. The statement's box says Management fees ${money(net.fees + net.repairs)}; its lines, with a Rental schedule column, say what each part was`, "The bank line is income at the net amount in the cash lens; the repair never reaches a cash line, so it is not spending a second time; the economic lens carries gross rent, and the plumber as a repair, as the lines say.",
    { kind: "lines", lines: [{ account: OF, date: net.paid, cents: net.disbursed, want: "income" }], accrual: [{ month: "2025-03", category: "RENT-REPAIR", cents: -net.repairs }, { month: "2025-03", category: "RENT-INC", cents: net.gross }] }, { fresh: true, dc: true });
  trap("T2-AGENT-LATE", "An owner statement paid thirteen days after its month, over Christmas", `${OF} ${late.paid}: December 2024's ${money(late.disbursed)}`, "Income on the day the bank shows it, cleared against December's statement.",
    { kind: "lines", clearing: "clearing:agent:AST-RENTAL", lines: [{ account: OF, date: late.paid, cents: late.disbursed, want: "income", month: "2025-01" }] }, { fresh: true });
  trap("T2-RENT-TWO-CREDITS", "One owner statement, two bank credits", `${OF} from July 2025: October 2025 pays ${money(two.split[0][1])} on ${two.split[0][0]} and ${money(two.split[1][1])} on ${two.split[1][0]} against one statement of ${money(two.disbursed)}, and August's carries a repair and a sundry`, "Both credits are income and both clear one statement. The first credit lands before the statement closes.",
    { kind: "lines", lines: [{ account: OF, date: two.split[0][0], cents: two.split[0][1], want: "income" }, { account: OF, date: two.split[1][0], cents: two.split[1][1], want: "income" }, { account: OF, date: tail.split[1][0], cents: tail.split[1][1], want: "income" }] }, { fresh: true, dc: true });
  trap("T2-AGENT-CHANGE", "The managing agent changes, and with it the owner reference and the bank line", `The first agent, reference ${NUM.ownerPm}, to ${RENT.pm[RENT.pm.length - 1].to}; Goldfields Realty, reference ${NUM.ownerRp}, from ${AGENT2}, a new name on the bank line and a new owner reference on a statement of the same layout`, "Both references reach the same rental, and each month's rent lands once.",
    { kind: "lines", lines: [{ account: OF, date: RENT.pm[14].paid, cents: RENT.pm[14].disbursed, want: "income" }, { account: OF, date: RENT.rp[1].paid, cents: RENT.rp[1].disbursed, want: "income" }] });
}

// ---------- the bills that arrive as documents, and the bank lines that pay them ----------
const BILLS = { energy: [], rates: [], water: [], policy: [] }, KIDS = { statements: [] };
function bills() {
  const r = rng("bills");
  for (const q of ["2023-09", "2023-12", "2024-03", "2024-06", "2024-09", "2024-12", "2025-03", "2025-06", "2025-09", "2025-12", "2026-03"]) {
    const billDate = `${nextMonth(q)}-06`, amt = cents(r, 280, 590), gst = Math.round(amt / 11), paid = addDays(billDate, 17);
    BILLS.energy.push({ billDate, due: addDays(billDate, 21), from: addDays(`${q}-01`, -61), to: monthEnd(q), amt, gst, account: "CG-7704118" });
    spend(HB, paid, "BPAY COASTGLOW ENERGY 7704118", amt, "UTILITIES"); count("bill_paid");
  }
  for (const q of ["2023-08", "2023-11", "2024-02", "2024-05", "2024-08", "2024-11", "2025-02", "2025-05", "2025-08", "2025-11", "2026-02", "2026-05"]) {
    const amt = cents(r, 410, 460), billDate = `${q}-01`, due = `${q}-28`;
    BILLS.rates.push({ billDate, due, from: `${q}-01`, to: monthEnd(nextMonth(nextMonth(q))), amt, reference: `RN-${q.replace("-", "")}-6641` });
    spend(HB, addDays(due, -4), "BPAY BELLARINE COUNCIL 6641470", amt, "RATES-HOME"); count("bill_paid");
    const usage = cents(r, 42, 96), service = 9140, wb = `${q}-11`, wd = `${q}-27`;
    BILLS.water.push({ billDate: wb, due: wd, from: addDays(wb, -92), to: addDays(wb, -2), usage, service, amt: usage + service });
    spend(HB, addDays(wd, -1), "BPAY BARWON REACH WATER 40118204", usage + service, "UTILITIES"); count("bill_paid");
    spend(OF, nextBiz(`${q}-20`), "BPAY GOLDEN PLAINS SHIRE 8841", cents(r, 360, 395), "RENT-RATES"); count("bill_paid");
  }
  for (const [from, to, amt, y] of [["2023-09-02", "2024-09-01", 148760, 0], ["2024-09-02", "2025-09-01", 157240, 0], ["2025-09-02", "2026-09-01", 164380, 0]]) {
    BILLS.policy.push({ from, to, amt, paid: addDays(from, -3), sum: 72000000, excess: 75000, number: "PH-61118226", kind: "Home", situ: HOME.split(",")[0] });
    spend(HB, addDays(from, -3), "PURRSURE HOME PH-61118226", amt, "HOME-INS"); count("bill_paid"); void y;
  }
  for (const [from, to, amt] of [["2024-02-10", "2025-02-09", 89320], ["2025-02-10", "2026-02-09", 92150], ["2026-02-10", "2027-02-09", 96080]]) {
    BILLS.policy.push({ from, to, amt, paid: addDays(from, -3), sum: 48000000, excess: 100000, number: "PL-77133120", kind: "Landlord", situ: RENTAL.split(",")[0] });
    spend(OF, addDays(from, -3), "PURRSURE LANDLORD PL-77133120", amt, "RENT-INS"); count("bill_paid");
  }
  // childcare: a statement per child, one gap debit for both, the month after
  const fee = (ym) => (ym < "2024-07" ? 15600 : ym < "2025-07" ? 16400 : 17200), ccs = (ym) => (ym < "2024-07" ? 0.7 : 0.72);
  for (const ym of monthRange("2023-10", "2026-05")) {
    let gap = 0;
    for (const [child, from, days] of [[NOA, "2023-10", 12], [ELIO, "2024-07", 8]]) {
      if (ym < from) continue;
      const gross = fee(ym) * days, subsidy = Math.round(gross * ccs(ym)), g = gross - subsidy;
      KIDS.statements.push({ ym, child, days, gross, subsidy, gap: g }); gap += g;
    }
    const d = nextBiz(`${nextMonth(ym)}-08`); spend(HB, d, "KITTENHOOD ELC GAP 2291", gap, "CHILDCARE"); count("childcare_gap");
    KIDS.statements.filter((s) => s.ym === ym).forEach((s) => { s.debit = d; s.debit_cents = gap; });
  }
  const both = KIDS.statements.filter((s) => s.ym === "2025-02");
  trap("T2-CCS", "Childcare: gross fee, subsidy, gap, and one debit for two children", `${HB} ${both[0].debit}: ${money(both[0].debit_cents)} clears two statements, gross ${money(both[0].gross + both[1].gross)}, subsidy ${money(both[0].subsidy + both[1].subsidy)}`, "Spending is the gap, once. The subsidy is neither income nor a cash line, and the gross fee reaches no cash account.",
    { kind: "lines", lines: [{ account: HB, date: both[0].debit, cents: -both[0].debit_cents, want: "spending" }], absent: [{ account: HB, date: both[0].debit, cents: -(both[0].gross + both[1].gross) }, { account: HB, date: both[0].debit, cents: both[0].subsidy + both[1].subsidy }] }, { fresh: true, dc: true });
}

// ---------- super ----------
const SUPER = { im: [], tom: [] };
function superFunds() {
  const r = rng("super");
  const sumSuper = (emp, from, to) => PAY.slips.filter((s) => s.employer === emp && s.payDate >= from && s.payDate <= to).reduce((t, s) => t + s.super, 0);
  const contrib = (list, d, desc, c) => { list.push({ date: d, type: "employer", desc, cents: c }); list.push({ date: d, type: "contributions_tax", desc: "Contributions tax", cents: -Math.round(c * 0.15) }); };
  for (const ym of monthRange("2023-11", "2026-06")) { const prev = monthRange("2023-10", ym).slice(-2)[0], c = sumSuper(LUMEN, `${prev}-01`, monthEnd(prev)); if (c) contrib(SUPER.im, `${ym}-14`, "SG contribution Lumen Arc", c); }
  for (const ym of monthRange("2024-08", "2026-06")) {
    const prev = monthRange("2024-07", ym).slice(-2)[0];
    const a = sumSuper(BRIGHT, `${prev}-01`, monthEnd(prev)), b = sumSuper(COBALT, `${prev}-01`, monthEnd(prev));
    if (a) contrib(SUPER.tom, `${ym}-20`, "SG contribution Brightwater Civil", a);
    if (b) contrib(SUPER.tom, `${ym}-20`, "SG contribution Cobalt Rail", b);
  }
  const roll = (list, acc, open, fee, ins, from) => {
    let bal = open; const out = [];
    for (const ym of monthRange(from, "2026-06")) {
      for (const x of list.filter((l) => ymOf(l.date) === ym).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))) { bal += x.cents; out.push({ ...x, acct: acc, balance: bal }); }
      const e = monthEnd(ym), earned = Math.round(bal * r.range(-0.011, 0.017));
      bal += earned; out.push({ acct: acc, date: e, type: "earnings", desc: "Investment earnings", cents: earned, balance: bal });
      bal -= fee; out.push({ acct: acc, date: e, type: "fee", desc: "Administration fee", cents: -fee, balance: bal });
      bal -= ins; out.push({ acct: acc, date: e, type: "insurance", desc: "Insurance premium", cents: -ins, balance: bal });
    }
    return out;
  };
  SUPER.im = roll(SUPER.im, SI, OPEN[SI], 700, 3120, "2023-07");
  SUPER.tom = roll(SUPER.tom, ST, 16402288, 900, 5140, "2024-07");
  for (const x of SUPER.im) line(SI, x.date, x.desc, x.cents, { superType: x.type });
  for (const x of SUPER.tom) if (x.date >= JOIN) line(ST, x.date, x.desc, x.cents, { superType: x.type });
  const before = SUPER.tom.filter((x) => x.date < JOIN); OPEN[ST] = before[before.length - 1].balance;
}

// ---------- shares at the broker, a registry, a DRP ----------
const SEC = { KRL: { name: "Krill Bay Holdings Ltd", p: 8420 }, MRN: { name: "Marram Energy Ltd", p: 3160 }, OWL: { name: "Owlet Global ETF", p: 11240 } };
const SHARES = { months: {}, trades: [], divs: [], dists: [], taxst: [] };
const DRP_FROM = "2024-07-01";
function shares() {
  const r = rng("shares");
  const start = { KRL: 8000000, MRN: 15000000, OWL: 6400000 }, curve = {}, adds = [];   // units times ten thousand
  for (const c of Object.keys(SEC)) { let p = SEC[c].p; curve[c] = {}; for (const ym of ["2023-06", ...MONTHS]) { p = Math.round(p * (1 + r.range(-0.05, 0.058))); curve[c][ym] = p; } }
  const trades = [
    { d: "2024-02-28", settle: "2024-03-01", side: "buy", code: "MRN", units: 400, ref: "CN-310442", fund: ["2024-02-21", 150000] },
    { d: "2025-06-27", settle: "2025-07-01", side: "sell", code: "KRL", units: 300, ref: "CN-338120" },
    { d: "2025-09-29", settle: "2025-10-01", side: "buy", code: "OWL", units: 100, ref: "CN-344907", fund: ["2025-09-24", 200000] },
  ];
  for (const t of trades) {
    const p = Math.round(curve[t.code][ymOf(t.d)] * (1 + r.range(-0.02, 0.02))), gross = Math.round(t.units * p / 10), brokerage = 1995;
    Object.assign(t, { price: (p / 1000).toFixed(3), gross, brokerage, total: t.side === "buy" ? gross + brokerage : gross - brokerage, name: SEC[t.code].name });
    SHARES.trades.push(t); count("trade");
    if (t.fund) own(HB, t.fund[0], "BPAY CEDAR TRADE 6624190", BK, bizAfter(t.fund[0], 1), "BPAY RECEIVED", t.fund[1], { reference: `DEP-${t.ref.slice(3)}` });
    line(BK, t.settle, `${t.side === "buy" ? "BUY" : "SELL"} ${t.units} ${t.code} @ ${t.price}`, t.side === "buy" ? -t.total : t.total, { reference: t.ref, trade: true });
    B.transit.push({ from: t.d, until: t.settle, cents: t.side === "buy" ? -t.total : t.total });
    adds.push({ code: t.code, d: t.d, u: (t.side === "buy" ? 1 : -1) * t.units * 10000 });
  }
  own(BK, "2025-07-03", "WITHDRAWAL TO BANK", HB, "2025-07-04", "CEDAR TRADE WITHDRAWAL", 220000, { reference: "WD-338120" });
  const unitsOn = (code, d) => adds.filter((x) => x.code === code && x.d <= d).reduce((t, x) => t + x.u, start[code]);
  const uFix = (u) => (u / 10000).toFixed(4);
  // Krill pays to the everyday account, which Imogen shares from April 2025 though the shares stay hers; Marram pays to the broker's cash account
  const divs = [];
  for (const y of [2023, 2024, 2025, 2026]) for (const [m, day] of [["03", "20"], ["09", "18"]]) for (const [code, ps, frank] of [["KRL", 31, 1], ["MRN", 12, 0]]) {
    const d = nextBiz(addDays(`${y}-${m}-${day}`, code === "MRN" ? 6 : 0)); if (d < START || d > END) continue;
    const units = Math.round(unitsOn(code, addDays(d, -14)) / 10000); if (!units) continue;
    const net = units * ps, franked = Math.round(net * frank), unfranked = net - franked, credit = Math.round(franked * 30 / 70);
    divs.push({ code, name: SEC[code].name, pay: d, units, ps, franked, unfranked, credit, net, final: m === "09" }); count("dividend");
    if (code === "KRL") earn(HB, d, `KRL DIVIDEND ${m === "09" ? "FINAL" : "INTERIM"} 00031177`, net, "DIVIDEND");
    else earn(BK, d, `${code} DIVIDEND`, net, "DIVIDEND", { reference: `DIV-${code}-${d.replace(/-/g, "").slice(2)}` });
  }
  SHARES.divs = divs;
  // the ETF pays half-yearly: cash to the broker until the DRP is switched on, then fractional units and no cash at all
  for (const d0 of ["2023-07-14", "2024-01-15", "2024-07-15", "2025-01-15", "2025-07-15", "2026-01-15"]) {
    const d = nextBiz(d0), held = unitsOn("OWL", addDays(d, -14)), cpu = 4521, net = Math.round(held * cpu / 1000000), drp = d >= DRP_FROM;
    const v = { code: "OWL", name: SEC.OWL.name, pay: d, held, cpu, net, drp, units: uFix(held) };
    if (drp) { const pr = Math.round(curve.OWL[ymOf(d)] * 10); v.price = (pr / 10000).toFixed(4); v.allot = Math.round(net * 10000 * 10000 / 100 / pr); adds.push({ code: "OWL", d, u: v.allot }); count("drp"); } else earn(BK, d, "OWL DISTRIBUTION", net, "DIVIDEND", { reference: `DIV-OWL-${d.replace(/-/g, "").slice(2)}` });
    SHARES.dists.push(v);
  }
  for (const fy of [2024, 2025, 2026]) {
    const cash = SHARES.dists.filter((v) => fyOf(v.pay) === fy).reduce((t, v) => t + v.net, 0), interest = Math.round(cash * 0.1), franked = Math.round(cash * 0.2), credit = Math.round(franked * 30 / 70), unfranked = Math.round(cash * 0.05), foreign = Math.round(cash * 0.42), fcredit = Math.round(cash * 0.05), gain = Math.round(cash * 0.1), conc = gain, deferred = cash - interest - franked - unfranked - foreign + fcredit - gain - conc;
    SHARES.taxst.push({ fy, cash, interest, franked, credit, unfranked, foreign, fcredit, gain, conc, deferred, amitUp: 0, amitDown: deferred > 0 ? 0 : 0 });
  }
  SHARES.unitsOn = unitsOn;
  for (const ym of ["2023-06", ...MONTHS]) {
    const e = monthEnd(ym);
    SHARES.months[ym] = Object.keys(SEC).map((c) => ({ code: c, name: SEC[c].name, u: unitsOn(c, e) })).filter((x) => x.u).map((x) => ({ ...x, units: x.code === "OWL" ? uFix(x.u) : String(x.u / 10000), price: (curve[x.code][ym] / 1000).toFixed(3), value: Math.round(x.u * curve[x.code][ym] / 100000) }));
  }
  const ds = divs.filter((x) => x.code === "KRL"), dm = divs.filter((x) => x.code === "MRN")[0], after = ds.find((x) => x.pay > RENUM);
  trap("T2-DIVIDEND", "A dividend seen by the registry and by the cash line", `Computerpaw notices beside ${HB} (KRL) and ${BK} (MRN) credits, ${divs.length} payments`, "Income once, at the net amount, whichever account it reached.",
    { kind: "lines", lines: [{ account: HB, date: ds[0].pay, cents: ds[0].net, want: "income" }, { account: BK, date: dm.pay, cents: dm.net, want: "income" }] });
  trap("T2-DIV-JOINT", "A dividend paid to a joint account for one owner's shares", `${HB} ${after.pay}: ${money(after.net)} on Imogen's KRL, after the account became joint and changed number`, "Income once at the household level. The account's new owners do not change whose dividend it is.",
    { kind: "lines", lines: [{ account: HB, date: after.pay, cents: after.net, want: "income" }] }, { fresh: true });
  const sell = trades[1];
  trap("T2-SELL-STRADDLE-FY", "A sale that settles across a financial year end", `${sell.units} KRL sold ${sell.d}, settles ${sell.settle}, ${money(sell.total)}: the holding has gone at 2025-06-30, the broker's cash has not arrived`, "Selling shares does not lower net worth. At 2025-06-30 the broker owes the household the proceeds.",
    { kind: "lines", settle: [{ account: `clearing:settle:${BK}`, month: "2025-06", want: sell.total }, { account: `clearing:settle:${BK}`, month: "2025-07", want: 0 }] }, { fresh: false });
  const dr = SHARES.dists.filter((v) => v.drp);
  trap("T2-DRP", "A distribution reinvested in fractional units, with no cash line", `OWL from ${dr[0].pay}: ${dr.length} distributions as units, and an annual tax statement beside each year`, "No cash income, the units rise by the allotment and L7 holds, and the annual statement is not a second distribution.",
    { kind: "lines", balances: [{ account: SH, months: ["2024-07", "2025-01", "2025-07", "2026-01"] }], lots: { instrument: "INS-OWL", units: unitsOn("OWL", END) * 10000 }, absent: [{ account: BK, date: dr[0].pay, cents: dr[0].net }, { account: HB, date: dr[0].pay, cents: dr[0].net }], accrual: [{ month: ymOf(dr[0].pay), category: "DIVIDEND", cents: dr[0].net, atLeast: true }] }, { fresh: true, dc: true });
  trap("T2-HOLDINGS-GAP", "A month's holdings file never downloaded", `${SH}: no file for 2025-11-30`, "Only that month is missing. The stale price is flagged, not shown as the month's value.",
    { kind: "gap", stream: SH, month: "2025-11" });
}

// ---------- US share units, a plan account in another currency ----------
const PLAN = { months: {}, vests: [], sales: [], px: {}, fx: {} };
function rsu() {
  const r = rng("rsu"); let p = 6240, f = 15000; let units = 440; const flows = [];
  for (const ym of ["2023-06", ...MONTHS]) { p = Math.round(p * (1 + r.range(-0.07, 0.08))); f = Math.round(f * (1 + r.range(-0.012, 0.012))); PLAN.px[ym] = p; PLAN.fx[ym] = f; }
  for (const y of [2023, 2024, 2025, 2026]) for (const m of ["02", "05", "08", "11"]) {
    const d = nextBiz(`${y}-${m}-15`); if (d < START || d > END) continue;
    const pv = Math.round(PLAN.px[ymOf(d)] * (1 + r.range(-0.02, 0.02))), fv = PLAN.fx[ymOf(d)], value = Math.round(110 * pv * fv / 10000);
    PLAN.vests.push({ date: d, units: 110, price: fix(pv), fx: (fv / 10000).toFixed(4), value }); flows.push({ d, u: 110 }); count("vest");
  }
  for (const [d, u, settle, wire] of [["2024-03-12", 300, "2024-03-13", "2024-03-20"], ["2025-08-19", 200, "2025-08-20", "2025-08-27"], ["2026-02-24", 150, "2026-02-25", "2026-03-04"]]) {
    const ps = Math.round(PLAN.px[ymOf(d)] * (1 + r.range(-0.015, 0.015))), fxDoc = PLAN.fx[ymOf(d)], fxWire = Math.round(fxDoc * (1 + r.range(-0.008, 0.008))), usd = u * ps, comm = 1995, netUsd = usd - comm, aud = Math.round(netUsd * fxDoc / 10000), got = Math.round(netUsd * fxWire / 10000) - 2000;
    const w = line(HB, wire, `ETREAT WIRE USD ${fix(netUsd)} REF ${wire.replace(/-/g, "")}`, got, { capital: true });
    PLAN.sales.push({ d, settle, wire, units: u, price: fix(ps), usd, comm, netUsd, aud, fx: (fxDoc / 10000).toFixed(4), got, ref: `TR-${d.replace(/-/g, "").slice(2)}`, line: w });
    B.transit.push({ from: d, until: wire, cents: got }); flows.push({ d, u: -u }); count("trade");
  }
  for (const ym of ["2023-06", ...MONTHS]) {
    const e = monthEnd(ym), u = flows.filter((x) => x.d <= e).reduce((t, x) => t + x.u, units);
    PLAN.months[ym] = { units: u, price: fix(PLAN.px[ym]), fx: (PLAN.fx[ym] / 10000).toFixed(4), value: Math.round(u * PLAN.px[ym] * PLAN.fx[ym] / 10000), asAt: e };
  }
  const v = PLAN.vests.find((x) => x.date > "2024-05-01"), s = PLAN.sales[2];
  trap("T2-RSU-VEST", "A vest in US dollars: wealth, tax, and no cash", `${PL}: ${PLAN.vests.length} quarterly vests of 110 units, for example ${v.date} at USD ${v.price}, ${money(v.value)}`, "No cash income. The holding rises and the month-end balance is the plan's own AUD value.",
    { kind: "lines", balances: [{ account: PL, months: [ymOf(v.date), "2024-12", "2025-05"] }] }, { fresh: true });
  trap("T2-RSU-WIRE", "A US sale, the wire a week later, a different AUD figure and a fee taken off", `${PL} sold ${s.units} on ${s.d}: the sale note says ${money(s.aud)}; ${HB} is credited ${money(s.got)} on ${s.wire}, across a month end`, "Neither income nor spending. Net worth holds the money while it is in the air, and no residue of the gap stays in net worth after the wire.",
    { kind: "lines", lines: PLAN.sales.map((x) => plain(x.line, "neither")), settle: [{ account: `clearing:settle:${HB}`, month: "2024-04", want: 0 }, { account: `clearing:settle:${HB}`, month: "2025-09", want: 0 }, { account: `clearing:settle:${HB}`, month: "2026-02", want: s.got }, { account: `clearing:settle:${HB}`, month: "2026-03", want: 0 }] }, { fresh: true, dc: true });
  trap("T2-PLAN-GAP", "A month's plan holdings file never downloaded", `${PL}: no file for 2026-03-31`, "Coverage names the month.", { kind: "gap", stream: PL, month: "2026-03" });
}

// ---------- crypto: an exchange, a cold wallet of his own, a swap ----------
const COIN = { txs: [], wallet: [], months: {}, px: {} };
function crypto() {
  const r = rng("crypto"), ms = monthRange("2025-03", "2026-06"); const asset = ["BTC", "ETH", "SOL"];
  let p = { BTC: 1480000000, ETH: 52000000, SOL: 2400000 };   // dollars times ten thousand
  for (const ym of ms) { COIN.px[ym] = {}; for (const a of asset) { p[a] = Math.round(p[a] * (1 + r.range(-0.09, 0.1))); COIN.px[ym][a] = p[a]; } COIN.px[ym].BTC = Math.round(COIN.px[ym].BTC / 100) * 100; }
  const q = (ym, a) => COIN.px[ym][a];
  const ex = { BTC: 62000000, ETH: 320000000, SOL: 0 }, cold = { BTC: 0 }; const log = [];
  const tx = (time, type, a, units, o = {}) => { COIN.txs.push({ time, type, asset: a, units, ...o }); count("crypto_txn"); };
  const unitsFor = (cents_, ym, a) => Math.round(cents_ * 1e10 / q(ym, a));
  // one bank deposit, two buys over two days
  const dep = 400000, depLine = line(TW, "2025-04-22", "COINPURR AUD DEPOSIT 8841", -dep, { capital: true });
  const b1 = unitsFor(248750, "2025-04", "BTC"), b2 = unitsFor(149250, "2025-04", "ETH");
  log.push(["2025-04-23", { BTC: b1 }]); tx("2025-04-23T03:12:00Z", "BUY", "BTC", b1, { counter: "AUD", counterQty: "2487.50", aud: 248750, fee: "12.50", feeAsset: "AUD", id: "CP-90001" });
  log.push(["2025-04-24", { ETH: b2 }]); tx("2025-04-24T02:41:00Z", "BUY", "ETH", b2, { counter: "AUD", counterQty: "1492.50", aud: 149250, fee: "7.50", feeAsset: "AUD", id: "CP-90002" });
  B.transit.push({ from: "2025-04-22", until: "2025-04-23", cents: dep }); B.transit.push({ from: "2025-04-23", until: "2025-04-24", cents: 150000 });
  // his own hardware wallet: 0.4000 BTC leaves, 0.3999 arrives
  const hash = "f3a91c07de42b8", moved = 40000000, fee = 10000;
  log.push(["2025-06-10", { BTC: -moved - 0 }]); tx("2025-06-10T09:05:00Z", "TRANSFER_OUT", "BTC", -moved, { aud: Math.round(moved * q("2025-06", "BTC") / 1e10), fee: "0.00010000", feeAsset: "BTC", id: hash });
  COIN.wallet.push({ ts: "2025-06-10T09:31:00Z", kind: "RECEIVE", token: "BTC", units: moved - fee, value: Math.round((moved - fee) * q("2025-06", "BTC") / 1e10), hash });
  cold.BTC = moved - fee;
  const coldLog = [["2025-06-10", moved - fee]];
  // part of the ether becomes SOL in August, the rest in November, so three coins sit on the exchange for three month ends
  const e1 = 150000000, s1 = Math.round(e1 * q("2025-08", "ETH") / q("2025-08", "SOL")); log.push(["2025-08-19", { ETH: -e1 - 200000, SOL: s1 }]);
  tx("2025-08-19T04:22:00Z", "SWAP", "ETH", -e1, { counter: "SOL", counterQty: (s1 / 1e8).toFixed(8), aud: Math.round(e1 * q("2025-08", "ETH") / 1e10), fee: "0.00200000", feeAsset: "ETH", id: "CP-90113" });
  // a sale, and the cash home the day after
  const sold = 5000000, gross = Math.round(sold * q("2025-10", "BTC") / 1e10), feeA = Math.round(gross * 0.005), net = gross - feeA; log.push(["2025-10-02", { BTC: -sold }]);
  tx("2025-10-02T01:17:00Z", "SELL", "BTC", -sold, { counter: "AUD", counterQty: fix(gross), aud: gross, fee: fix(feeA), feeAsset: "AUD", id: "CP-90188" });
  const wd = line(TW, "2025-10-03", "COINPURR WITHDRAWAL 8841", net, { capital: true }); B.transit.push({ from: "2025-10-02", until: "2025-10-03", cents: net });
  let left = ex.ETH + b2 - e1 - 200000;
  const e2 = left - 200000, s2 = Math.round(e2 * q("2025-11", "ETH") / q("2025-11", "SOL")); log.push(["2025-11-18", { ETH: -left, SOL: s2 }]);
  tx("2025-11-18T05:02:00Z", "SWAP", "ETH", -e2, { counter: "SOL", counterQty: (s2 / 1e8).toFixed(8), aud: Math.round(e2 * q("2025-11", "ETH") / 1e10), fee: "0.00200000", feeAsset: "ETH", id: "CP-90240" });
  for (const ym of monthRange("2025-09", "2026-06")) { const d = `${ym}-28`, s = 35000000; log.push([d, { SOL: s }]); tx(`${d}T00:00:00Z`, "STAKE_REWARD", "SOL", s, { aud: Math.round(s * q(ym, "SOL") / 1e10), id: `CP-S${ym.replace("-", "")}` }); }
  for (const ym of ms) {
    const e = monthEnd(ym), h = { BTC: ex.BTC, ETH: ex.ETH, SOL: 0 };
    for (const [d, m] of log) if (d <= e) for (const [a, u] of Object.entries(m)) h[a] += u;
    if (e >= "2025-06-10") h.BTC -= fee;
    const coldU = coldLog.filter(([d]) => d <= e).reduce((t, [, u]) => t + u, 0);
    const rows = asset.filter((a) => h[a] > 0).map((a) => ({ asset: a, units: h[a], p: q(ym, a), value: Math.round(h[a] * q(ym, a) / 1e10) }));
    COIN.months[ym] = { rows, value: rows.reduce((t, x) => t + x.value, 0), cold: Math.round(coldU * q(ym, "BTC") / 1e10), coldUnits: coldU };
  }
  COIN.depLine = depLine; COIN.wd = wd;
  trap("T2-CRYPTO-DEPOSIT", "A bank deposit to an exchange, spent as two buys over two days", `${TW} 2025-04-22, 4,000.00; buys of 2,487.50 and 1,492.50 with fees on 04-23 and 04-24. Later a sale and a withdrawal back to the bank`, "Neither line is spending or income. It is own money moving, one bank line against two buys.",
    { kind: "lines", lines: [plain(depLine, "neither"), plain(wd, "neither")] }, { fresh: true, dc: true });
  trap("T2-CRYPTO-MOVE", "A coin moved to his own wallet, the two sides differing by the network fee", `${CX} sends 0.4000 BTC on 2025-06-10; ${CW} receives 0.3999, same hash`, "Nothing happened to net worth except the fee. Not a sale and not a gift, and each wallet's units are right.",
    { kind: "lines", balances: [{ account: CW, months: ["2025-06", "2025-07"] }, { account: CX, months: ["2025-06", "2025-07"] }] }, { fresh: true, dc: true });
  trap("T2-CRYPTO-SWAP", "One coin swapped for another, no AUD involved", `${CX} 2025-11-18: the last of the ETH to SOL`, "No cash, the units change, and the wallet's value is the new coin at market.",
    { kind: "lines", balances: [{ account: CX, months: ["2025-11", "2025-12", "2026-01"] }] }, { fresh: true });
}

// ---------- HELP, a debt only the tax office holds ----------
const HELP = { rows: [], open: 2384017 };
function helpDebt(notices) {
  let bal = HELP.open; const rows = [{ date: "2023-07-01", desc: "Opening balance", amt: null, bal }];
  const ev = [...notices.filter((n) => n.person === IM && n.help).map((n) => ({ date: n.assessed, kind: "rep", cents: n.help, fy: n.fy })), { date: "2024-06-01", kind: "idx", pct: 40 }, { date: "2025-06-01", kind: "idx", pct: 32 }].sort((a, b) => (a.date < b.date ? -1 : 1));
  for (const e of ev) { if (e.kind === "idx") { const c = Math.round(bal * e.pct / 1000); bal += c; rows.push({ date: e.date, desc: `Indexation ${(e.pct / 10).toFixed(1)}%`, amt: c, bal }); } else { bal -= e.cents; rows.push({ date: e.date, desc: `Compulsory repayment FY${e.fy}`, amt: -e.cents, bal }); } }
  HELP.rows = rows;
  trap("T2-HELP", "A HELP debt: a repayment on the notice and on the account", `${HP}: ${rows.length - 1} movements, each repayment on both the notice of assessment and the myGuv account page, indexation only on the page`, "The debt is the tax office's figure. A repayment lowers it once, not once per witness.",
    { kind: "lines", balances: [{ account: HP, months: ["2024-10", "2025-06", "2025-09", "2026-06"] }] }, { fresh: true, dc: true });
}

// ---------- tax ----------
const TAX = { notices: [] };
function scale(fy, ti) {
  const b = fy <= 2024 ? [[18200, 0], [45000, 0.19], [120000, 0.325], [180000, 0.37], [1e12, 0.45]] : [[18200, 0], [45000, 0.16], [135000, 0.30], [190000, 0.37], [1e12, 0.45]];
  let tax = 0, lo = 0; const inc = ti / 100;
  for (const [hi, r] of b) { if (inc > lo) tax += (Math.min(inc, hi) - lo) * r; lo = hi; }
  return Math.round(tax * 100);
}
function taxes() {
  const noa = [
    { person: IM, fy: 2023, lodged: "2023-10-03", assessed: "2023-10-17", refundOn: "2023-10-20", acct: HB, ti: 8914000, payg: 2442000, help: 198000 },
    { person: IM, fy: 2024, lodged: "2024-09-24", assessed: "2024-10-08", refundOn: "2024-10-11", acct: HB },
    { person: IM, fy: 2025, lodged: "2025-08-19", assessed: "2025-09-02", refundOn: "2025-09-05", acct: OF },
    { person: TOM, fy: 2025, lodged: "2025-08-05", assessed: "2025-08-19", refundOn: "2025-08-22", acct: TW },
  ];
  const inFy = (d, fy) => fyOf(d) === fy;
  for (const n of noa) {
    n.other = 0;
    if (n.ti == null) {
      const ss = PAY.slips.filter((s) => s.person === n.person && s.fy === n.fy), gross = ss.reduce((t, s) => t + s.gross, 0);
      n.payg = ss.reduce((t, s) => t + s.tax, 0);
      let ti = gross;
      if (n.person === IM) {
        ti += PLAN.vests.filter((v) => inFy(v.date, n.fy)).reduce((t, v) => t + v.value, 0) - 1800000;
        const divs = SHARES.divs.filter((v) => inFy(v.pay, n.fy)); ti += divs.reduce((t, v) => t + v.net + v.credit, 0); n.other = divs.reduce((t, v) => t + v.credit, 0);
        n.help = Math.round(ti * 0.04 / 100) * 100;
      } else n.help = 0;
      n.ti = Math.floor(ti / 100 - 310) * 100;
    }
    n.gross = scale(n.fy, n.ti); n.medicare = Math.round(n.ti * 0.02); n.offsets = 0;
    n.result = n.payg + n.other - n.gross - n.medicare - n.help;
    TAX.notices.push(n); count("tax_assessment");
  }
  const lines = [];
  for (const n of noa) {
    const last = n.person === IM ? "6610083" : "6610291";
    if (n.result > 0) { lines.push(line(n.acct, n.refundOn, `ATO EFT REFUND ${last}${String(n.fy).slice(2)}`, n.result, { refund: true })); count("tax_refund"); }
    else {
      // a bill, paid in two parts on either side of its due date
      const part = Math.round(-n.result / 2 / 100) * 100, a = addDays(n.assessed, 28), b = addDays(n.assessed, 56);
      lines.push(line(n.acct, a, `BPAY ATO TAX ${last}${String(n.fy).slice(2)}`, -part, { refund: true })); lines.push(line(n.acct, b, `BPAY ATO TAX ${last}${String(n.fy).slice(2)}`, part + n.result, { refund: true })); count("tax_payment", 2);
    }
  }
  trap("T2-TAX-BILL", "A notice with a bill on it, paid in two parts, beside refunds to other accounts", lines.map((x) => `${x.acct} ${x.date} ${money(x.cents)}`).join("; "), "Neither income nor spending: TAX-REFUND is a transfer with the tax position (SPEC 6.5, 9), in either direction.",
    { kind: "lines", lines: lines.map((x) => plain(x, "neither")) }, { fresh: true });
  helpDebt(noa);
}

// ---------- own-account transfers, the card, the traps that sit on lines ----------
function plumbing() {
  // while on leave the offset tops up the everyday account
  for (const ym of monthRange("2023-07", "2023-10")) { const d = nextBiz(`${ym}-01`); own(OF, d, "TFR TO HARBOUR 8116", HB, d, "TFR FROM WESTPAW OFFSET", 620000); }
  for (const ym of monthRange("2023-11", "2026-06")) { const d = nextBiz(`${ym}-20`); own(HB, d, ym < "2025-04" ? "TFR TO BARK SAVER 4116" : "TFR TO BARK SAVER 4116 JT", SV, bizAfter(d, 1), "TFR FROM HARBOUR", 30000); }
  for (const ym of monthRange("2024-03", "2026-06")) { const d = nextBiz(`${ym}-25`); own(HB, d, "TFR TO WESTPAW OFFSET", OF, d, "TFR FROM HARBOUR", 80000); }
  for (const ym of monthRange("2025-04", "2026-06")) { const d = nextBiz(`${ym}-02`), c = ym >= "2025-12" && ym < "2026-03" ? 150000 : 320000; own(TW, d, "OSKO TO JOINT EVERYDAY HOUSE SHARE", HB, d, "OSKO FROM T WOLAK HOUSE SHARE", c); }
  // a repayment and an offset sweep on one day at one amount, four months running
  const sw = [];
  for (const ym of monthRange("2024-10", "2025-01")) { const d = nextBiz(`${ym}-01`); sw.push(own(HB, d, "TFR TO WESTPAW OFFSET SWEEP", OF, d, "TFR FROM HARBOUR SWEEP", 195000)); }
  trap("T2-REPAY-VS-SWEEP", "A loan repayment and an offset sweep on one day at one amount", `${HB}, first working day of 2024-10 to 2025-01: two 1,950.00 loan repayments and a 1,950.00 sweep to ${OF}, whose credit is the only opposite line`, "The sweep is own money and the repayments are spending. If the offset's credit pairs with a repayment, 1,950.00 of spending moves or vanishes.",
    { kind: "lines", lines: sw.flatMap(([a, b]) => [{ account: HB, date: a.date, cents: -195000, want: "mixed:spending,spending,neither", n: 3 }, plain(b, "neither")]) }, { fresh: true, dc: true });
  // the same amount twice in a week, and back
  const w = [own(HB, "2025-02-03", "TFR TO BARK SAVER 4116", SV, "2025-02-04", "TFR FROM HARBOUR", 100000), own(HB, "2025-02-06", "TFR TO BARK SAVER 4116", SV, "2025-02-07", "TFR FROM HARBOUR", 100000), own(SV, "2025-02-07", "TFR TO HARBOUR 8116", HB, "2025-02-07", "TFR FROM BARK SAVER", 100000)];
  trap("T2-SAME-WEEK", "The same amount moved twice in a week between the same accounts, and once back", `${HB} and ${SV}, 1,000.00 on 02-03, 02-06, and 1,000.00 back on 02-07`, "Three transfers. Nothing is income, spending or a duplicate, and both balances hold.",
    { kind: "lines", lines: w.flat().map((x) => plain(x, "neither")), balances: [{ account: HB, months: ["2025-02"] }, { account: SV, months: ["2025-02"] }] }, { fresh: true, dc: true });
  // two hops through a third account
  const h1 = own(HB, "2024-05-20", "TFR TO BARK SAVER 4116", SV, "2024-05-21", "TFR FROM HARBOUR", 600000), h2 = own(SV, "2024-05-21", "TFR TO WESTPAW OFFSET", OF, "2024-05-22", "TFR FROM BARK SAVER", 600000);
  trap("T2-TWO-HOPS", "A transfer via a third account in two hops", `${HB} to ${SV} to ${OF}, 6,000.00, over three days`, "Four legs, two transfers, no income, no spending.",
    { kind: "lines", lines: [...h1, ...h2].map((x) => plain(x, "neither")) }, { fresh: true });
  // an interbank payment that loses a fee on the way
  const fee = line(TW, "2025-06-17", "RTGS TO HARBOUR 951077", -800000, { xfer: true, fee: 1800 }), feeIn = line(HB, "2025-06-18", "RTGS FROM T WOLAK WATTLE", 798200, { xfer: true });
  B.transit.push({ from: "2025-06-17", until: "2025-06-18", cents: 798200 }); B.pairs.push({ from: TW, date_out: "2025-06-17", to: HB, date_in: "2025-06-18", cents: 798200, sent: 800000, what: "RTGS TO HARBOUR 951077" }); count("own_transfer");
  trap("T2-FEE-TRANSFER", "A transfer with a fee taken off, so the two sides differ", `${TW} ${fee.date} -8,000.00, ${HB} ${feeIn.date} +7,982.00`, "An own transfer of 7,982.00 and 18.00 of fees. Neither side is income, and nothing is 8,000.00 of spending.",
    { kind: "lines", lines: [plain(fee, "neither"), plain(feeIn, "neither")] }, { fresh: true, dc: true });
  // a refund to a different account from the charge
  const r = rng("traps");
  const ch = card(r, "2024-11-04", MER.shop[4], 38900, "SHOPPING", IM, { lag: 1 }), rf = line(HB, "2024-11-19", "RIVERSTONE HOMEWARES REFUND", 38900, { lens: "spending", cat: "SHOPPING" }); count("purchase"); count("refund");
  trap("T2-REFUND-STREAM", "A refund that reaches a different stream from the charge", `${CC} ${ch.date} -389.00; ${HB} ${rf.date} +389.00, the shop paid it back by bank transfer`, "Lowers SHOPPING spending. Not income, and not a transfer from the card.",
    { kind: "lines", lines: [plain(ch, "spending"), plain(rf, "spending")] }, { fresh: true, dc: true });
  // one receipt, two card lines either side of a statement close
  const d1 = card(r, "2024-09-12", ["OAKLEIGH APPLIANCES", "GEELONG"], 30000, "HOME-MAINT", IM, { lag: 1 }), d2 = card(r, "2024-09-16", ["OAKLEIGH APPLIANCES", "GEELONG"], 99900, "HOME-MAINT", IM, { lag: 1 }); count("purchase", 2);
  COIN.receipts = [{ merchant: "Oakleigh Appliances", date: "2024-09-16", item: "Hisense-style front loader, fictional model W120", kind: "appliance", serial: "OA-W120-2291", warranty: "2026-09-16", paid: `Amewx ending ${NUM.card}`, gst: 11809, total: 129900 }];
  trap("T2-RECEIPT-SPLIT", "One receipt for two card lines, across a statement close", `${CC} ${d1.date} 300.00 deposit and ${d2.date} 999.00 balance, one emailed receipt for 1,299.00`, "Two purchases, 1,299.00 in all. The receipt adds detail and no cost, and is not a third purchase.",
    { kind: "lines", lines: [plain(d1, "spending"), plain(d2, "spending")], absent: [{ account: CC, date: d2.date, cents: -129900 }] }, { fresh: true, dc: true });
  // a three-way witness
  const lap = card(r, "2025-07-21", ["PAPERBARK COMPUTERS", "GEELONG"], 189900, "SHOPPING", IM, { lag: 2 }); count("purchase");
  COIN.receipts.push({ merchant: "Paperbark Computers", date: "2025-07-21", item: "Laptop 14 inch, fictional model P14", kind: "device", serial: "PB-P14-7712", warranty: "2027-07-21", paid: `Amewx ending ${NUM.card}`, gst: 17264, total: 189900 });
  trap("T2-THREE-WITNESS", "One purchase on a statement, an activity download and an emailed receipt", `${CC} ${lap.date} 1,899.00, posted ${lap.posted}`, "One purchase.",
    { kind: "lines", lines: [plain(lap, "spending", { n: 1 })] }, { fresh: true, dc: true });
  // a trip: charges in US dollars, a fee on each, a charge that changes between authorisation and posting, a statement and a download that disagree by a cent
  const usd = [["2025-09-22", "CANYON OUTFITTERS", "DENVER", 12000, 18462], ["2025-09-24", "RED MESA LODGE", "SANTA FE", 41800, 64412]];
  for (const [d, n, t, us, au] of usd) { card(r, d, [n, t], au, "HOLIDAYS", TOM, { desc: `${n} ${t} USD ${fix(us)}`, csv: `${n.padEnd(26)}${t}  USD ${fix(us)}` }); card(r, d, ["FOREIGN TRANSACTION FEE", ""], Math.round(au * 0.03), "FEES", TOM, { desc: "FOREIGN TRANSACTION FEE", csv: "FOREIGN TRANSACTION FEE" }); count("purchase", 2); }
  const cent = card(r, "2025-09-25", ["LOW COUNTRY GRILL", "AUSTIN"], 8640, "HOLIDAYS", TOM, { lag: 1, desc: "LOW COUNTRY GRILL AUSTIN USD 56.25", csv: `${"LOW COUNTRY GRILL".padEnd(26)}AUSTIN  USD 56.25`, extra: { csvCents: 8641 } }); count("purchase");
  trap("T2-CENT", "A statement and a download that disagree by a cent", `${CC} ${cent.date}: 86.40 on the statement, 86.41 on the activity download`, "One charge. The statement closes on it, so 86.40. Two lines would be a double count of 86.41.",
    { kind: "lines", lines: [plain(cent, "spending", { n: 1 })], absent: [{ account: CC, date: cent.date, posted: cent.posted, cents: -8641 }] }, { fresh: true, dc: true });
  const auth = card(r, "2025-09-29", ["LOW TIDE LODGE", "HONOLULU"], 21477, "HOLIDAYS", TOM, { posted: "2025-10-01", desc: "LOW TIDE LODGE HONOLULU USD 141.20", csv: `${"LOW TIDE LODGE".padEnd(26)}HONOLULU  USD 141.20`, extra: { authCents: 21218, authFile: "2025-07-01" } }); count("purchase");
  trap("T2-FX-AUTH", "A foreign charge whose AUD changes between authorisation and posting", `${CC} ${auth.date}: the download cut 09-30 shows it pending at 212.18; the next download, which overlaps, shows it posted 10-01 at 214.77, and so does the statement`, "One charge of 214.77. A 212.18 left on the books is a charge that never happened.",
    { kind: "lines", lines: [plain(auth, "spending", { n: 1 })], absent: [{ account: CC, date: auth.date, cents: -21218 }] }, { fresh: true, dc: true });
  // two identical coffees, on a card whose files disagree on the date
  const coffee = ["TIDE AND TONIC", "GEELONG"];
  card(r, "2024-08-14", coffee, 610, "DINING", IM, { posted: "2024-08-16" }); card(r, "2024-08-14", coffee, 610, "DINING", IM, { posted: "2024-08-16" }); count("purchase", 2);
  trap("T2-IDENTICAL-CLOSE", "Two identical coffees on the day a statement closes", `${CC} 2024-08-14, 6.10 twice, posted two days later in the next statement period`, "Two purchases. Not one, not four.",
    { kind: "lines", lines: [{ account: CC, date: "2024-08-14", posted: "2024-08-16", cents: -610, want: "spending", n: 2 }] });
  // the charge that takes longest to post, charged two days before Christmas
  const xm = card(r, "2024-12-23", ["HARDIE AND FIG", "GEELONG"], 27450, "SHOPPING", IM, { lag: 5 }), xn = card(r, "2023-12-22", ["KIDSTUFF AND CO", "GEELONG"], 16820, "SHOPPING", IM, { lag: 5 }); count("purchase", 2);
  trap("T2-HOLIDAY-LAG", "A charge that posts five business days later across Christmas and New Year", `${CC}: ${xm.date} posted ${xm.posted}, ${xn.date} posted ${xn.posted}, more calendar days than the date_drift window`, "One purchase, in the month it was charged. If the two files cannot be matched it is asked about, not counted twice in silence.",
    { kind: "lines", lines: [plain(xm, "spending", { n: 1, month: "2024-12" }), plain(xn, "spending", { n: 1, month: "2023-12" })] }, { fresh: true, dc: true });
  // a line a later download dates differently, inside an overlap
  const rd = spend(HB, "2024-07-15", "BPAY HOPKINS FAMILY DAYCARE 5512", 18340, "CHILDCARE", { altDate: "2024-07-13" }); count("purchase");
  trap("T2-REDATE", "A line re-dated between two overlapping downloads", `${HB}: 183.40 dated 07-13 in the file cut 07-16, dated 07-15 in the file starting 07-11`, "One line. The later file decides the date; the balance chain holds either way.",
    { kind: "lines", lines: [plain(rd, "spending", { n: 1, wide: 3 })], balances: [{ account: HB, months: ["2024-07"] }] }, { fresh: true, dc: true });
  // a trust distribution, and the side income, whose documents no public recipe reads
  const t1 = earn(TW, "2025-08-14", "WOLAK FAMILY TRUST DISTRIBUTION", 650000, "TRUST-DIST"), t2 = earn(TW, "2026-05-20", "WOLAK FAMILY TRUST DISTRIBUTION", 480000, "TRUST-DIST"); count("trust_distribution", 2);
  trap("T2-TRUST", "A family trust distribution carrying a member's surname", `${TW} ${t1.date} and ${t2.date}; the statements are held as PDFs no public recipe reads`, "Income, not a transfer from a member. The unread statements are reported, not dropped.",
    { kind: "lines", lines: [plain(t1, "income"), plain(t2, "income")], unread: "sources/TRUST-STATEMENTS/" }, { fresh: true });
  const inv = [["2025-04-28", "OSKO FROM BELLARINE SURVEYS INV 2041", 142000], ["2025-06-30", "OSKO FROM BELLARINE SURVEYS INV 2047", 96500], ["2025-08-29", "OSKO FROM COAST HOMES INV 2052", 121000], ["2025-10-31", "STRIPE PAYOUT 8842 TW AERIAL", 88460], ["2025-12-19", "OSKO FROM BELLARINE SURVEYS INV 2066", 214000], ["2026-01-30", "STRIPE PAYOUT 8842 TW AERIAL", 104520], ["2026-03-27", "OSKO FROM COAST HOMES INV 2071", 165000], ["2026-05-29", "STRIPE PAYOUT 8842 TW AERIAL", 77310]].map(([d, desc, c]) => earn(TW, d, desc, c, "x_SIDE-INCOME"));
  const cost = [["2025-05-08", "DRONEHUB PARTS", 38900], ["2025-09-16", "DRONEHUB PARTS", 21250], ["2026-02-09", "AIRSPACE LICENCE RENEWAL", 16500]].map(([d, n, c]) => spend(TW, d, twPos([n, "ONLINE"], d), c, "WORK-EQUIP")); count("sole_trader_receipt", inv.length);
  trap("T2-SOLE-TRADER", "Side income held as evidence only", `${TW}: ${inv.length} client payments, some by Osko and some as a payment processor's payout, from ${inv[0].date}; quarterly activity statements held as PDFs no public recipe reads`, "Income in the cash lens, its costs spending. Business derivation is not modelled, and nothing says otherwise.",
    { kind: "lines", lines: [plain(inv[0], "income"), plain(inv[3], "income"), plain(cost[0], "spending")], unread: "sources/BAS-STATEMENTS/" }, { fresh: true });
}
const HB_WINDOWS = [["2023-07-01", "2023-10-13"], ["2023-10-14", "2024-01-12"], ["2024-01-13", "2024-04-12"], ["2024-04-13", "2024-07-16"], ["2024-07-11", "2024-10-11"], ["2024-10-12", "2025-01-14"], ["2025-01-15", "2025-03-31"], ["2025-04-01", "2025-07-11"], ["2025-07-12", "2025-10-14"], ["2025-10-15", "2026-01-13"], ["2026-01-14", "2026-04-14"], ["2026-04-15", "2026-06-30"]];
const STATEMENT_MISSING = "2025-05-14";
/* traps that live in how the files were downloaded and in who joined when, not in the money */
function fileTraps() {
  trap("T2-MIDCUT", "A quarterly stream whose files are cut mid-month", `${HB}: twelve files cut around the 14th, one overlapping by six days, one ending a day early on the renumbering`, "No gap is reported and no month is short. Balances hold at every month end.",
    { kind: "coverage_clean", stream: HB, balances: [{ account: HB, months: ["2023-10", "2024-01", "2024-04", "2024-07", "2025-01", "2026-01"] }] }, { fresh: true });
  trap("T2-RESAVED", "The same download re-saved by a spreadsheet: other bytes, same lines", `${HB}: January to April 2024 again, with a byte-order mark, bare line feeds and trailing zeros stripped from the amounts, three months later`, "A different source with identical lines. Nothing is added.",
    { kind: "lines", lines: B.lines.filter((x) => x.acct === HB && x.date >= "2024-02-05" && x.date <= "2024-02-09").sort(byTime).slice(0, 4).map((x) => plain(x, x.lens || "neither", { n: 1 })), balances: [{ account: HB, months: ["2024-02", "2024-03"] }] }, { fresh: true, dc: true });
  const near = B.lines.filter((x) => x.acct === HB && x.date >= "2025-03-25" && x.date <= "2025-04-04").sort(byTime);
  trap("T2-RENUMBER", "A joint account changing owners and number", `${HB}: ${NUM.harbour} to ${RENUM}, ${NUM.harbour2} after, the balance carried over, owners Imogen then Imogen and Tomasz`, "One account. The chain carries across the new number and nothing moves at household level.",
    { kind: "lines", lines: near.slice(0, 3).concat(near.slice(-3)).map((x) => plain(x, x.lens || "neither")), balances: [{ account: HB, months: ["2025-03", "2025-04", "2025-05"] }], ownership: { account: HB, on: "2025-06-30" } }, { fresh: true });
  const b1 = B.lines.filter((x) => x.acct === TW && x.date >= "2025-12-17" && x.date <= "2025-12-31").sort(byTime);
  trap("T2-BANK-FORMAT", "A bank that changes file format, the old and new files overlapping", `${TW}: monthly CSV to 2025-12-31, quarterly OFX from 2025-12-17 with bank references and descriptions cut to 32 characters; ${b1.length} lines in both`, "One line each, two witnesses. A reference on one side only is no reason to count two.",
    { kind: "lines", lines: b1.slice(0, 6).map((x) => plain(x, x.lens || "neither", { n: 1 })), balances: [{ account: TW, months: ["2025-12", "2026-01"] }] }, { fresh: true, dc: true });
  const hole = B.lines.filter((x) => x.acct === TW && x.date >= "2026-02-12" && x.date <= "2026-02-17");
  trap("T2-OFX-HOLE", "Six days of bank lines nobody downloaded, in a format with no running balance", `${TW}: no OFX holds 2026-02-12 to 2026-02-17, ${hole.length} lines worth ${money(hole.reduce((t, x) => t + x.cents, 0))}. Each file's own dates are honest`, "The engine cannot know the lines. It must say the closing does not chain, for that account and those dates.",
    { kind: "hole", account: TW, month: "2026-02", net_cents: hole.reduce((t, x) => t + x.cents, 0), line_count: hole.length, match: /2026-0[234]/.source });
  trap("T2-PARTNER-JOINS", "A partner joins mid-history with accounts that already have balances", `Tomasz joins ${JOIN}: ${TW} opens at ${money(OPEN[TW])}, ${ST} at ${money(OPEN[ST])}, two wallets besides`, "His balances enter net worth when he does. None of it is income, and nothing of his shows before March 2025.",
    { kind: "lines", zero_before: { accounts: [TW, ST, CX, CW], until: "2025-03" }, balances: [{ account: TW, months: ["2025-03", "2025-04"] }, { account: ST, months: ["2025-03", "2025-04"] }] }, { fresh: true, dc: true });
  trap("T2-PREJOIN-DOCS", "A joiner's year-end documents reach back before he joined", `Tomasz's income statement and super statement for FY2025 start 2024-07-01, nine months before ${JOIN}`, "A year of his wages and his fund's opening balance do not enter the household's past.",
    { kind: "lines", no_events_before: { match: "BRIGHTWATER|PTY-BRIGHT|Brightwater", before: JOIN, kinds: "wage" }, zero_before: { accounts: [ST], until: "2025-03" } }, { fresh: true, dc: true });
  const lagged = B.lines.filter((x) => x.acct === CC && x.cents < 0 && x.posted && x.posted !== x.date), lagDays = {};
  for (const x of lagged) { const d = dayDiff(x.date, x.posted); lagDays[d] = (lagDays[d] || 0) + 1; }
  trap("T2-POSTING-LAG", "Every card line in two files, dated differently", `${CC}: ${lagged.length} lines post after they are charged, by ${Object.entries(lagDays).map(([d, n]) => `${d} days (${n})`).join(", ")}. The monthly statement, cut on the 14th, shows the charge date; the quarterly activity file the posting date`, "One purchase, two witnesses, whatever the gap. A line the engine cannot match across files is asked about, not counted twice in silence.",
    { kind: "card_lag", account: CC, lagged: lagged.length, by_days: lagDays });
  const cross = B.lines.filter((x) => x.acct === CC && x.lens === "spending" && x.date >= START && x.posted && ymOf(x.posted) !== ymOf(x.date)).sort(byTime);
  trap("T2-DATE-BASIS", "A card charge dated in one month, posted in the next", `${CC}: ${cross.length} lines. Budgets read the charge date. Six sampled`, "SPEC 6.5: a purchase counts when charged, and it is one line.",
    { kind: "lines", lines: [0, 1, 2, 3, 4, 5].map((i) => cross[Math.floor(i * cross.length / 6)]).map((x) => plain(x, "spending", { n: 1, month: ymOf(x.date) })) });
  trap("T2-STATEMENT-GAP", "A card statement never downloaded, its lines only on the activity file", `The statement closing ${STATEMENT_MISSING} is missing`, "The lines stay, on their posting dates. Coverage names the missing statement.",
    { kind: "gap", stream: "STM-CARD", month: STATEMENT_MISSING.slice(0, 7) }, { fresh: true });
  trap("T2-CRYPTO-THIRD-COIN", "A holdings page with a third row", `${CX}: month-end pages for 2025-08 to 2025-10 list three coins and every other page two, so the page's structure changes with what is held`, "Those pages are read, or the months are named as missing. A stale price must not pass as the month's value.",
    { kind: "lines", unread: `sources/${CX}/`, must_name: { stream: CX, months: ["2025-08", "2025-09", "2025-10"] }, balances: [{ account: CX, months: ["2025-08", "2025-09", "2025-10"], strict: true }] }, { fresh: true });
}

const CARD = { statements: [] };
function settleCard() {
  let prev = -OPEN[CC];
  for (let start = "2023-06-15"; start <= "2026-06-15";) {
    const ym = nextMonth(start.slice(0, 7)), end = `${ym}-14`;
    const inP = B.lines.filter((x) => x.acct === CC && posted(x) >= start && posted(x) <= end);
    const charges = inP.filter((x) => x.cents < 0).reduce((t, x) => t - x.cents, 0), credits = inP.filter((x) => x.cents > 0).reduce((t, x) => t + x.cents, 0), close = prev + charges - credits;
    CARD.statements.push({ start, end, prev, charges, credits, close, lines: inP.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.seq - b.seq)) });
    const due = nextBiz(`${nextMonth(ym)}-03`), post = bizAfter(due, 1);
    if (due <= END && close > 0) {
      if (due === nextBiz("2025-09-03")) {
        // this one month, the card is paid from two accounts, one line each on the card
        const part = 100000;
        const a = own(HB, due, "AMEWX DIRECT DEBIT 77132", CC, post, "PAYMENT RECEIVED - THANK YOU", part, { posted: post, csv: "PAYMENT RECEIVED - THANK YOU", member: IM }), b = own(TW, due, "BPAY AMEWX 77132", CC, post, "PAYMENT RECEIVED - THANK YOU", close - part, { posted: post, csv: "PAYMENT RECEIVED - THANK YOU", member: TOM });
        trap("T2-CARD-TWO-ACCOUNTS", "One card statement paid from two accounts", `${HB} ${money(part)} and ${TW} ${money(close - part)} on ${due}, two lines on the card next day, on a statement of ${money(close)}`, "Two transfers, no spending, and the card clears.",
          { kind: "lines", lines: [{ account: HB, date: due, cents: -part, want: "neither" }, { account: TW, date: due, cents: -(close - part), want: "neither" }, { account: CC, date: post, cents: part, want: "neither" }, { account: CC, date: post, cents: close - part, want: "neither" }] }, { fresh: true, dc: true });
        void a; void b;
      } else own(HB, due, "AMEWX DIRECT DEBIT 77132", CC, post, "PAYMENT RECEIVED - THANK YOU", close, { posted: post, csv: "PAYMENT RECEIVED - THANK YOU", member: IM });
    }
    prev = close; start = addDays(end, 1);
  }
}
function saverInterest() {
  let bal = OPEN[SV];
  for (const ym of MONTHS) {
    bal += B.lines.filter((x) => x.acct === SV && ymOf(x.date) === ym).reduce((t, x) => t + x.cents, 0);
    const i = Math.round(bal * 0.039 / 12); earn(SV, monthEnd(ym), "INTEREST CREDIT", i, "INTEREST"); bal += i; count("interest_credit");
  }
}

// ---------- truth, from the simulation alone ----------
const OPEN = { [HB]: 842260, [OF]: 6480014, [SV]: 3184250, [TW]: 1248033, [CC]: -153040, [BK]: 322118, [SI]: 11264180, [IP]: PING_OPEN };
function chain(acct) { let bal = OPEN[acct] || 0; return B.lines.filter((x) => x.acct === acct).sort(acct === CC ? byPost : byTime).map((x) => { bal += x.cents; x.balance = bal; return x; }); }
const VALUES = { home: [], rental: [] };
function valuations() {
  const r = rng("valuations"); let h = 88000000, q = 56500000;
  for (const m of monthRange("2023-06", "2026-06").filter((x) => ["03", "06", "09", "12"].includes(x.slice(5)))) {
    h = Math.round(h * (1 + r.range(-0.006, 0.019)) / 100000) * 100000; q = Math.round(q * (1 + r.range(-0.008, 0.016)) / 100000) * 100000;
    VALUES.home.push([monthEnd(m), h]); VALUES.rental.push([monthEnd(m), q]);
  }
}
function truth() {
  const acctsChain = [HB, OF, SV, TW, CC, BK, SI, ST, IP];
  const chains = {}; for (const a of acctsChain) chains[a] = chain(a);
  const assets = [HB, OF, SV, TW, CC, BK, SH, PL, CX, CW, HF, HV, IP, IW, SI, ST, HP, HO, RP];
  const balances = {}; for (const a of assets) balances[a] = {};
  const income = {}, spending = {}, byCat = {}, networth = {}, transit = {};
  for (const m of MONTHS) { income[m] = 0; spending[m] = 0; byCat[m] = {}; }
  for (const x of B.lines) {
    const m = ymOf(x.date); if (!(m in income)) continue;
    if (x.fee) { spending[m] += x.fee; byCat[m].FEES = (byCat[m].FEES || 0) - x.fee; }
    if (!x.lens) continue;
    if (!CASH.includes(x.acct)) throw new Error(`lens on a non-cash account ${x.acct}`);
    if (x.lens === "income") income[m] += x.cents; else { spending[m] -= x.cents; byCat[m][x.cat] = (byCat[m][x.cat] || 0) - x.cents; }
  }
  const lastVal = (list, e) => { const v = list.filter(([d]) => d <= e); return v.length ? v[v.length - 1][1] : 0; };
  for (const m of MONTHS) {
    const e = monthEnd(m);
    for (const a of acctsChain) {
      const upTo = chains[a].filter((x) => (a === CC ? posted(x) : x.date) <= e), last = upTo[upTo.length - 1];
      const joined = (a !== TW && a !== ST) || e >= JOIN;
      balances[a][m] = !joined ? 0 : last ? last.balance : (a === ST || a === TW ? OPEN[a] : OPEN[a] || 0);
    }
    balances[SH][m] = SHARES.months[m].reduce((t, h) => t + h.value, 0);
    balances[PL][m] = PLAN.months[m].value;
    balances[CX][m] = COIN.months[m] ? COIN.months[m].value : 0;
    balances[CW][m] = COIN.months[m] ? COIN.months[m].cold : 0;
    for (const [a, list] of [[HF, LOANS.fixed], [HV, LOANS.variable], [IW, LOANS.newInv]]) { const r = list.find((x) => x.ym === m); balances[a][m] = r ? r.close : 0; }
    { const rows = HELP.rows.filter((x) => x.date <= e); balances[HP][m] = -rows[rows.length - 1].bal; }
    balances[HO][m] = lastVal(VALUES.home, e); balances[RP][m] = lastVal(VALUES.rental, e);
    transit[m] = B.transit.filter((t) => t.from <= e && t.until > e).reduce((s, t) => s + t.cents, 0);
    networth[m] = assets.reduce((s, a) => s + balances[a][m], 0) + transit[m];
  }
  return {
    household: "Reyes-Wolak, fictional, Belmont VIC", window: [START, END],
    definitions: {
      income: "SPEC 6.5 cash lens: money into reporting-group cash accounts in categories of kind income with cash_lens true, on the day the bank shows it. Net pay, parental leave pay, child support, trust distributions, side income, interest, dividends at the net paid, gifts. Rent at the net amount the agent pays, because the cash lens reads cash accounts; gross rent, fees and repairs are the economic lens.",
      spending: "SPEC 6.5 cash lens: money out of cash accounts in expense categories with cash_lens true, net of refunds and Medicare. Card purchases on the charge date. Loan repayments at their cash amount, interest-only repayments included. The childcare gap, never the gross fee. The 18.00 lost on an interbank transfer counts as fees.",
      left_out: "Own transfers, card repayments, money to and from the broker, the exchange and the share plan's wire, tax refunds and tax payments (TAX-REFUND, kind transfer), the refinance drawdown, and the employer-reimbursed flight with its reimbursement (SPEC 4.4c).",
      balances: "Month-end, holder's sign, on the posting date: a card balance moves when the line posts, not when it is charged. Loans negative. HELP negative, at the myGuv figure. Holdings, plan and coins at the true month-end market value, whether or not the file was downloaded or read. The cold wallet at the exchange's month-end BTC price. Property at the latest valuation.",
      networth: "Sum of the accounts the household declared, each from when it belongs to the household: Tomasz's accounts enter at 2025-03-24, his membership date. Plus money in the air between own accounts, trades between trade and settlement, the plan's sale until the wire lands, and AUD on the exchange between deposit and buy, because all of it is the household's whichever side of a month end it falls. Tax position excluded.",
      one_charge: "A charge in two files is one charge. The statement's amount is the charge where the two disagree, because the statement closes on it.",
    },
    balances, income, spending, spending_by_category: byCat, networth, in_transit: transit,
    counts: B.counts, lines_by_account: Object.fromEntries(Object.entries(chains).map(([a, l]) => [a, l.length])),
    cash_lines: B.lines.filter((x) => CASH.includes(x.acct)).sort(byTime).map((x) => ({ account: x.acct, date: x.date, ...(x.posted && x.posted !== x.date ? { posted: x.posted } : {}), cents: x.cents, what: x.desc, lens: x.lens || "neither", ...(x.cat ? { category: x.cat } : {}), ...(x.xfer ? { own: true } : {}), ...(x.fee ? { fee: x.fee } : {}), ...(x.altDate ? { alt: x.altDate } : {}) })),
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
const BR = {
  pawroll: { name: "Pawroll", tagline: "Every pay, every paw, on time", color: "#2F6F5E" },
  westpaw: { name: "Westpaw", tagline: "Banking with a wag", color: "#B4231F" },
  ping: { name: "PING", tagline: "Wattle Credit Union online lending", color: "#D97A0B" },
  amewx: { name: "Amewx", tagline: "Don't leave home without your whiskers", color: "#1E5AA8" },
  cedar: { name: "Cedar Trade", tagline: "Deep roots, low brokerage", color: "#3C6E47" },
  computerpaw: { name: "Computerpaw" },
  computerpawBand: { name: "Computerpaw", tagline: "Investor services", color: "#44506B" },
  etreat: { name: "E*Treat", tagline: "Stock plans", color: "#5B2E91" },
  purr: { name: "Purrannuation", tagline: "Nine lives for your retirement", color: "#6A3FA0" },
  hest: { name: "HESTAbby" },
  myguv: { name: "myGuv", tagline: "Your tax, your paws", color: "#0B6E99" },
  purrsure: { name: "Purrsure", tagline: "Cover for the curious", color: "#C2410C" },
  council: { name: "Bellarine Council", tagline: "Rates and charges, one paw at a time", color: "#2E7D6B" },
  water: { name: "Barwon Reach Water" },
  meow: { name: "PropertyMeow", tagline: "Your rental, looked after", color: "#8A5A00" },
  trust: { name: "Wolak Family Trust" },
  guvbas: { name: "myGuv business", tagline: "Activity statements", color: "#0B6E99" },
};
const span = (a, b) => `${fmtDate(a)} to ${fmtDate(b)}`;
const R = (label, w = 2) => ({ label, w, align: "right" });
const Lft = (label, w = 2) => ({ label, w });

function pdfPayslip(s, ytd) {
  const d = new Doc({ brand: BR.pawroll, title: "Payslip", kicker: fmtDate(s.payDate), deflate });
  d.h1(`Payslip for ${s.person}`);
  d.kv([["Employer", s.employer], ["Pay date", fmtDate(s.payDate)], ["Pay period", span(s.from, s.to)]], 3);
  d.h2("This pay");
  d.para(s.person === IM ? "Classification: Account Executive, salaried." : s.redundancy ? "Classification: final pay, leave paid out, redundancy." : "Classification: salaried staff, monthly in arrears.");
  d.para("All amounts are in Australian dollars.");
  const pct = sgRate(s.payDate);
  d.table([Lft("Item", 6), R("This pay"), R("Year to date")], [
    ["Ordinary hours, salary", money(s.gross), money(ytd.gross)],
    ["PAYG withholding", `-${money(s.tax)}`, `-${money(ytd.tax)}`],
    [`Superannuation guarantee (${pct}%)`, money(s.super), money(ytd.super)],
    [s.split ? `Net pay, to account ending ${s.acctLast} and 0884` : `Net pay, to account ending ${s.acctLast}`, money(s.net), ""],
  ]);
  return d.finish();
}
function pdfIncomeStatement(person, employer, fy, ss) {
  const sum = (k) => ss.reduce((t, s) => t + s[k], 0);
  const d = new Doc({ brand: BR.pawroll, title: `Income statement FY${fy}`, kicker: `FY${fy}, 01 Jul ${fy - 1} to 30 Jun ${fy}`, deflate });
  d.h1(`Income statement for ${person}`);
  d.kv([["Employee", person], ["Payer", employer], ["Issued", fmtDate(`${fy}-07-14`)], ["Status", "Tax ready"], ["Payer ABN", { [LUMEN]: "41824753556", [BRIGHT]: "30918244207", [COBALT]: "62771095448" }[employer]], ["Pay frequency", person === IM ? "Fortnightly" : "Monthly"]], 3);
  d.h2("Year to 30 June");
  d.table([Lft("Item", 6), R("Amount")], [["Gross payments", money(sum("gross"))], ["Tax withheld", money(sum("tax"))], ["Superannuation guarantee", money(sum("super"))], ["Reportable employer super", "0.00"]]);
  d.h2("Pay by pay");
  d.table([Lft("Pay date", 3), R("Gross"), R("Tax"), R("Super"), R("Net")], ss.map((s) => [fmtDate(s.payDate), money(s.gross), money(s.tax), money(s.super), money(s.net)]), { foot: ["Total", money(sum("gross")), money(sum("tax")), money(sum("super")), money(sum("net"))] });
  return d.finish();
}
function pdfLoan(brand, title, number, product, holder, from, to, rows) {
  const t = (k) => rows.reduce((s, r) => s + r[k], 0), withOffset = rows.some((r) => r.offset != null);
  const d = new Doc({ brand, title, kicker: span(from, to), deflate });
  d.h1(title);
  d.kv([["Loan number", number], ["Product", product], ["Borrowers", holder], ["Repayments", "Monthly"], ["Opening balance", money(-rows[0].open)], ["Interest charged", money(t("interest"))], ["Repayments received", money(t("paid"))], ["Closing balance", money(-rows[rows.length - 1].close)]], 4);
  d.h2("Month by month");
  d.table([Lft("Month", 2), R("Rate", 1), R("Opening"), R("Interest"), R("Repayments"), R("Closing"), ...(withOffset ? [R("Offset")] : [])],
    rows.map((r) => [`${MON[Number(r.ym.slice(5)) - 1]} ${r.ym.slice(0, 4)}`, `${r.rate}%`, money(-r.open), money(r.interest), money(r.paid), money(-r.close), ...(withOffset ? [money(r.offset)] : [])]),
    { foot: ["Total", "", "", money(t("interest")), money(t("paid")), "", ...(withOffset ? [""] : [])] });
  return d.finish();
}
function pdfRateNotice(number, product, oldR, newR, effective, issued) {
  const d = new Doc({ brand: BR.westpaw, title: "Rate change", kicker: `Issued ${fmtDate(issued)}`, deflate });
  d.h1("Your interest rate is changing");
  d.kv([["Loan number", number], ["Product", product], ["Account holders", "I Reyes"], ["Old rate", `${oldR}% p.a.`], ["New rate", `${newR}% p.a.`], ["Effective date", fmtDate(effective)]], 3);
  d.para("Your minimum repayment does not change unless you ask us to change it.");
  return d.finish();
}
function pdfCard(s) {
  const d = new Doc({ brand: BR.amewx, title: "Card statement", kicker: span(s.start, s.end), deflate });
  d.h1("Your card statement");
  d.kv([["Account", NUM.cardFull], ["Card member", IM], ["Previous balance", money(s.prev)], ["Payments and credits", money(s.credits)], ["New charges", money(s.charges)], ["New balance", money(s.close)]], 3);
  d.h2("Transactions");
  d.table([Lft("Date", 2), Lft("Description", 8), R("Amount", 2)], s.lines.map((x) => [fmtDate(x.date), x.desc, money(-x.cents)]), { foot: ["New balance", "", money(s.close)] });
  return d.finish();
}
function pdfContractNote(t) {
  const d = new Doc({ brand: BR.cedar, title: "Contract note", kicker: "Contract note", deflate });
  d.h1(`${t.side === "buy" ? "Bought" : "Sold"} ${t.units} ${t.code} at ${t.price}`);
  d.kv([["Account", NUM.broker], ["Security code", t.code], ["Security", t.name], ["Trade date", fmtDate(t.d)], ["Settlement date", fmtDate(t.settle)], ["Reference", t.ref]], 3);
  d.h2("Trade details");
  d.table([Lft("Item", 6), R("Amount")], [["Quantity", String(t.units)], ["Price", t.price], ["Consideration", money(t.gross)], ["Brokerage", money(t.brokerage)], [t.side === "buy" ? "Total payable" : "Net proceeds", money(t.total)]]);
  return d.finish();
}
function pdfEtreatSale(s) {
  const d = new Doc({ brand: BR.etreat, title: "Trade confirmation", kicker: "Trade confirmation", deflate });
  d.h1(`Sold ${s.units} LUMA at ${s.price}`);
  d.kv([["Plan account", NUM.plan], ["Security", "LUMA"], ["Participant", IM], ["Trade date", fmtDate(s.d)], ["Settlement date", fmtDate(s.settle)], ["Reference", s.ref]], 3);
  d.h2("Trade details");
  d.table([Lft("Item", 6), R("Amount")], [["Quantity", String(s.units)], ["Price (USD)", s.price], ["Proceeds (USD)", money(s.usd)], ["Commission (USD)", money(s.comm)], ["Exchange rate (AUD per USD)", s.fx], ["Net proceeds (AUD)", money(s.aud)]]);
  return d.finish();
}
function pdfEss(fy, vests) {
  const total = vests.reduce((t, v) => t + v.value, 0), d = new Doc({ brand: BR.etreat, title: "ESS statement", kicker: `Year to 30 Jun ${fy}`, deflate });
  d.h1(`ESS statement FY${fy}`);
  d.kv([["Participant", IM], ["Plan account", NUM.plan], ["Employer", "Lumen Arc Inc"], ["Year end", fmtDate(`${fy}-06-30`)], ["Financial year", `FY${fy}`], ["Scheme", "Deferred RSU"]], 3);
  d.h2("Taxing points");
  d.table([Lft("Taxing point", 3), R("Units"), R("FMV USD"), R("AUD per USD"), R("Discount")], vests.map((v) => [fmtDate(v.date), String(v.units), v.price, v.fx, money(v.value)]), { foot: ["Total", "", "", "", money(total)] });
  return d.finish();
}
function pdfDividend(v) {
  const d = new Doc({ brand: BR.computerpaw, style: "plain", title: "Dividend", kicker: v.name, deflate });
  d.h1(`${v.final ? "Final" : "Interim"} dividend`);
  d.kv([["Holder number", NUM.hin], ["Security code", v.code], ["Shares held", String(v.units)], ["Rate per share", (v.ps / 100).toFixed(4)], ["Payment date", fmtDate(v.pay)], ["Franked percent", String(Math.round(v.franked / v.net * 100))]], 3);
  d.h2("Payment");
  d.table([Lft("Item", 6), R("Amount")], [["Franked amount", money(v.franked)], ["Unfranked amount", money(v.unfranked)], ["Franking credit", money(v.credit)], ["Net payment", money(v.net)]]);
  return d.finish();
}
function pdfDistribution(v) {
  const d = new Doc({ brand: BR.computerpawBand, title: "Distribution", kicker: v.name, deflate });
  d.h1("Half-yearly distribution");
  d.kv([["Holder number", NUM.hin], ["Security code", v.code], ["Units held", v.units], ["Rate per unit", (v.cpu / 10000).toFixed(4)], ["Payment date", fmtDate(v.pay)], ["Reinvestment", v.drp ? "Full DRP" : "Cash"]], 3);
  d.h2("Payment");
  const rows = [["Gross distribution", money(v.net)], ["Tax withheld", "0.00"], ["Net distribution", money(v.net)]];
  if (v.drp) rows.push(["Units allotted", (v.allot / 10000).toFixed(4)], ["Allotment price", v.price]);
  d.table([Lft("Item", 6), R("Amount")], rows);
  return d.finish();
}
function pdfTaxStatement(t) {
  const d = new Doc({ brand: BR.computerpawBand, title: "Tax statement", kicker: SEC.OWL.name, deflate });
  d.h1("Annual attribution tax statement");
  d.kv([["Holder number", NUM.hin], ["Security code", "OWL"], ["Security", SEC.OWL.name], ["Year end", fmtDate(`${t.fy}-06-30`)], ["Financial year", `FY${t.fy}`], ["Trust type", "AMIT"]], 3);
  d.h2("Components");
  d.table([Lft("Item", 6), R("Amount")], [["Cash distributions", money(t.cash)], ["Interest", money(t.interest)], ["Franked distributions", money(t.franked)], ["Franking credits", money(t.credit)], ["Unfranked distributions", money(t.unfranked)], ["Foreign income", money(t.foreign)], ["Foreign tax credits", money(t.fcredit)], ["Discounted capital gains", money(t.gain)], ["CGT concession", money(t.conc)], ["Tax deferred", money(t.deferred)], ["AMIT cost base increase", money(t.amitUp)], ["AMIT cost base decrease", money(t.amitDown)]]);
  return d.finish();
}
/* PropertyMeow's table: the recipe reads columns by x, and a date in the writer's table would be clipped, so this one is drawn by hand. */
function meowTable(d, rows) {
  const X = [48, 104, 266, 436, 492, 500], put_ = (y, cells, bold) => cells.forEach((c, i) => { if (c) d.text(X[i], y, c, { size: 8.5, bold, align: i === 3 || i === 4 ? "right" : undefined }); });
  put_(d.y, ["Date", "Description", "Rental schedule", "Money in", "Money out", "By"], true); d.y -= 15;
  for (const r of rows) { put_(d.y, r, false); d.y -= 15; }
  d.y -= 6;
}
function pdfOwnerMeow(s) {
  const d = new Doc({ brand: BR.meow, title: "Owner statement", kicker: span(s.from, s.to), deflate });
  d.h1("Owner statement");
  d.kv([["Owner reference", NUM.ownerPm], ["Property", RENTAL.split(",")[0]], ["Tenant", "R Acharya"], ["Rent collected", money(s.gross)], ["Management fees", money(s.fees)], ["Paid to owner", money(s.disbursed)]], 3);
  d.text(MARGIN, d.y, "Rent and costs", { size: 12, bold: true }); d.text(d.W - MARGIN, d.y, "Amounts in Australian dollars", { size: 8, align: "right" }); d.y -= 22;
  const rows = [...s.rows.map((x) => [fmtDate(x.date), "Rent received", "Rent", money(x.amt), "", "Tenant"]), [fmtDate(s.to), "Management fee, 7%", "Property agent fees", "", money(s.fees), "PropertyMeow"]];
  meowTable(d, rows);
  d.para(`Rent is paid to the owner by ${fmtDate(s.paid)}.`);
  return d.finish();
}
function pdfOwnerRent(s) {
  // the new agent runs the same portal software: the box headed Management fees is everything taken out, and the lines say what each thing was
  const taken = s.fees + s.repairs + s.other;
  const d = new Doc({ brand: BR.meow, title: "Owner statement", kicker: span(s.from, s.to), deflate });
  d.h1("Owner statement");
  d.kv([["Owner reference", NUM.ownerRp], ["Property", RENTAL.split(",")[0]], ["Tenant", "R Acharya"], ["Rent collected", money(s.gross)], ["Management fees", money(taken)], ["Paid to owner", money(s.disbursed)]], 3);
  d.text(MARGIN, d.y, "Rent and costs", { size: 12, bold: true }); d.text(d.W - MARGIN, d.y, "Amounts in Australian dollars", { size: 8, align: "right" }); d.y -= 22;
  const rows = [...s.rows.map((x) => [fmtDate(x.date), "Rent received", "Rent", money(x.amt), "", "Tenant"]), [fmtDate(s.to), "Management fee, 6.5%", "Property agent fees", "", money(s.fees), "Goldfields Realty"]];
  if (s.repairs) rows.push([fmtDate(s.to), "Plumber, paid for the owner", "Repairs and maintenance", "", money(s.repairs), "Goldfields Realty"]);
  if (s.other) rows.push([fmtDate(s.to), "Statement fee", "Sundry rental expenses", "", money(s.other), "Goldfields Realty"]);
  meowTable(d, rows);
  d.para(s.split ? `Rent is paid to the owner in two parts, ${money(s.split[0][1])} by ${fmtDate(s.split[0][0])} and ${money(s.split[1][1])} by ${fmtDate(s.split[1][0])}.` : `Rent is paid to the owner by ${fmtDate(s.paid)}.`);
  return d.finish();
}
function pdfBare(brand, title, lines) {
  const d = new Doc({ brand, style: "plain", title, kicker: title, deflate });
  d.h1(title);
  for (const l of lines) d.para(l);
  return d.finish();
}
function pdfFund(brand, style, name, member, fy, lines, openBal, closeBal) {
  const sum = (t) => lines.filter((x) => x.type === t).reduce((s, x) => s + x.cents, 0);
  const from = `${fy - 1}-07-01`, to = `${fy}-06-30`;
  const d = new Doc({ brand, style, title: "Annual statement", kicker: span(from, to), deflate });
  d.h1("Your annual statement");
  d.kv([["Member", name], ["Member number", member], ["Statement period", span(from, to)], ["Balance then", money(openBal)], ["Balance now", money(closeBal)], ["Option", "Balanced growth"]], 3);
  d.h2("What moved");
  d.table([Lft("Item", 6), R("Amount")], [["Opening balance", money(openBal)], ["Employer contributions", money(sum("employer"))], ["Investment earnings", money(sum("earnings"))], ["Contributions tax", money(-sum("contributions_tax"))], ["Administration fees", money(-sum("fee"))], ["Insurance premiums", money(-sum("insurance"))], ["Closing balance", money(closeBal)]]);
  return d.finish();
}
function pdfNoa(n) {
  const d = new Doc({ brand: BR.myguv, title: "Notice of assessment", deflate });
  d.h1("Notice of assessment");
  const rows = [["Name", n.person, "Taxable income", money(n.ti)], ["Financial year", `FY${n.fy}`, "Gross tax", money(n.gross)], ["Date of issue", fmtDate(n.assessed), "Less offsets", money(0)], ["Return lodged", fmtDate(n.lodged), "Medicare levy", money(n.medicare)], ["Version", "1", "HELP repayment", money(n.help)], ["Assessment", `AN-${n.fy}-${n.person === IM ? "6610083" : "6610291"}`, "PAYG credits", money(n.payg)], ["", "", "Other credits", money(n.other)], ["", "", "Result of this notice", money(n.result)]];
  for (const r of rows) { d.text(MARGIN, d.y, r[0], { size: 9.5 }); d.text(MARGIN + 110, d.y, r[1], { size: 9.5, bold: true }); d.text(320, d.y, r[2], { size: 9.5 }); d.text(d.W - MARGIN, d.y, r[3], { size: 9.5, bold: true, align: "right" }); d.y -= 18; }
  d.para("A refund is paid to the account you nominated in your return.");
  return d.finish();
}
function pdfRates(b) {
  const d = new Doc({ brand: BR.council, title: "Rates", kicker: "Notice under the Local Government Act", deflate });
  d.h1("Your rates instalment");
  d.kv([["Assessment number", "BC-6641470"], ["Property", HOME.split(",")[0]], ["Issue date", fmtDate(b.billDate)], ["Due date", fmtDate(b.due)], ["Rating period", span(b.from, b.to)], ["Instalment due", money(b.amt)]], 3);
  d.para(`Instalment notice ${b.reference}`);
  return d.finish();
}
function pdfWater(b) {
  const d = new Doc({ brand: BR.water, style: "plain", title: "Water bill", deflate });
  d.text(MARGIN, d.y, "Your water bill", { size: 14, bold: true }); d.text(d.W - MARGIN, d.y, `Quarter to ${fmtDate(b.to)}`, { size: 9, align: "right" }); d.y -= 26;
  const rows = [["Account", "WA-40118204", "Water usage", money(b.usage)], ["Property", HOME.split(",")[0], "Service charges", money(b.service)], ["Bill date", fmtDate(b.billDate), "Concession", money(0)], ["Due date", fmtDate(b.due), "Amount due", money(b.amt)], ["Period from", fmtDate(b.from), "", ""], ["Period to", fmtDate(b.to), "", ""]];
  for (const r of rows) { d.text(MARGIN, d.y, r[0], { size: 9.5 }); d.text(MARGIN + 110, d.y, r[1], { size: 9.5, bold: true }); if (r[2]) { d.text(320, d.y, r[2], { size: 9.5 }); d.text(d.W - MARGIN, d.y, r[3], { size: 9.5, bold: true, align: "right" }); } d.y -= 18; }
  d.para("Thank you for paying on time.");
  d.text(MARGIN, d.y, "Pay by", { size: 9.5 }); d.text(MARGIN + 110, d.y, "BPAY biller 40118", { size: 9.5 });
  return d.finish();
}
function pdfPolicy(p) {
  const d = new Doc({ brand: BR.purrsure, title: "Certificate", kicker: `${p.kind} cover`, deflate });
  d.h1("Certificate of currency");
  d.kv([["Policy number", p.number], ["Policy", p.kind], ["Situation", p.situ], ["Insured", IM], ["Period of insurance", span(p.from, p.to)], ["Premium paid", money(p.amt)]], 3);
  d.h2("Cover");
  d.table([Lft("Item", 6), R("Amount")], [["Building sum insured", money(p.sum)], ["Excess", money(p.excess)]]);
  return d.finish();
}
function emlEnergy(b) {
  const text = ["Your electricity bill is ready", "CoastGlow Energy, a fictional retailer", "Hello Imogen,", `Account: ${b.account}`, `Bill date: ${fmtDate(b.billDate)}`, `Due date: ${fmtDate(b.due)}`, `Supply from: ${fmtDate(b.from)}`, `Supply to: ${fmtDate(b.to)}`, `GST included: ${money(b.gst)}`, `Amount due: ${money(b.amt)}`, "Pay by BPAY, biller code 7704.", "Thanks for keeping the lights on."].join("\n");
  return eml({ from: "bills@coastglow.example", to: "imogen@reyes-wolak.example", subject: "Your electricity bill is ready", date: b.billDate, id: `cg-${b.billDate}`, text, html: `<p>${text.split("\n").join("</p><p>")}</p>` });
}
function emlReceipt(x) {
  const text = [`Thanks for shopping at ${x.merchant}.`, `Order date: ${fmtDate(x.date)}`, `Item: ${x.item}`, `Product type: ${x.kind}`, `Serial number: ${x.serial}`, `Warranty until: ${fmtDate(x.warranty)}`, `Paid with: ${x.paid}`, `GST included: ${money(x.gst)}`, `Total: ${money(x.total)}`, "Keep this email for your records.", "This is a fictional store."].join("\n");
  return eml({ from: "orders@store.example", to: "imogen@reyes-wolak.example", subject: `Your receipt from ${x.merchant}`, date: x.date, id: `rc-${x.date}`, text, html: `<p>${text.split("\n").join("</p><p>")}</p>` });
}
function htmlKitten(s) {
  const from = `${s.ym}-01`, to = monthEnd(s.ym), body = `<h1>Statement of account</h1>\n<p>Provider: Kittenhood ELC Belmont</p>\n<p>Child: ${s.child}</p>\n<table>${row(["Item", "Detail"], "th")}${row(["Period start", fmtDate(from)])}${row(["Period end", fmtDate(to)])}${row(["Days attended", String(s.days)])}${row(["Gross fee", money(s.gross)])}${row(["Child Care Subsidy", `-${money(s.subsidy)}`])}${row(["Gap you pay", money(s.gap)])}</table>`;
  return page(`Kittenhood statement ${MON[Number(s.ym.slice(5)) - 1]} ${s.ym.slice(0, 4)}`, body);
}
function htmlHelp(rows, closing) {
  const body = `<h1>Your HELP account</h1>\n<p>Name: ${IM}</p>\n<p>Closing balance: ${money(closing)}</p>\n<table>${row(["Date", "Description", "Amount", "Balance"], "th")}${rows.map((x) => row([fmtDate(x.date), x.desc, x.amt == null ? "" : (x.amt < 0 ? `-${money(-x.amt)}` : money(x.amt)), money(x.bal)])).join("")}</table>`;
  return page("myGuv HELP account", body);
}
const p4 = (x, a) => (a === "BTC" ? (x / 10000).toFixed(2) : (x / 10000).toFixed(4));
function htmlCoin(ym, m) {
  const body = `<h1>Your Coinpurr statement</h1>\n<p>As at ${fmtDate(monthEnd(ym))}</p>\n<p>Held for ${TOM}</p>\n<table>${row(["Asset", "Units", "Price (AUD)", "Value (AUD)"], "th")}${m.rows.map((x) => row([x.asset, (x.units / 1e8).toFixed(8), p4(x.p, x.asset), fix(x.value)])).join("")}${row(["Total", "", "", fix(m.value)])}</table>`;
  return page(`Coinpurr statement ${MON[Number(ym.slice(5)) - 1]} ${ym.slice(0, 4)}`, body);
}

function render() {
  // the everyday account: quarterly downloads cut mid-month, one overlap in which a line moves, a new number from April 2025
  const hbNum = (d) => (d < RENUM ? NUM.harbour : NUM.harbour2);
  const view = (acct, from, to, alt) => { let bal = OPEN[acct] || 0; const seq = B.lines.filter((x) => x.acct === acct).map((x) => ({ ...x, date: alt && x.altDate ? x.altDate : x.date })).sort(byTime), out = []; for (const x of seq) { bal += x.cents; if (x.date >= from && x.date <= to) out.push({ ...x, balance: bal }); } return out; };
  const hbRows = (ls) => ls.map((x) => [hbNum(x.date), dmy(x.date), x.desc, x.cents < 0 ? fix(-x.cents) : "", x.cents > 0 ? fix(x.cents) : "", fix(x.balance), x.cents > 0 ? "DEP" : "PAYMENT", ""]);
  const hbHead = ["Bank Account", "Date", "Narrative", "Debit Amount", "Credit Amount", "Balance", "Categories", "Serial"];
  HB_WINDOWS.forEach(([from, to], i) => put(HB, addDays(to, 1), `Harbour_${from}_${to}.csv`, csvLines([hbHead, ...hbRows(view(HB, from, to, i === 3))])));
  // the January to April 2024 file opened in a spreadsheet and saved again
  { const [from, to] = HB_WINDOWS[2], rows = hbRows(view(HB, from, to, false)).map((r) => r.map((c, i) => (i >= 3 && i <= 5 && c !== "" ? String(Number(c)) : c))); put(HB, "2024-07-02", `Harbour_${from}_${to} copy.csv`, `﻿${csvLines([hbHead, ...rows]).replace(/\r\n/g, "\n")}`); }
  // the offset: quarterly, Wattle-shaped CSV, no account number in the file
  for (const [from, to] of quarters("2023-07", "2026-06")) {
    const rows = view(OF, from, to).map((x) => [dmy(x.date), x.desc, x.cents > 0 ? fix(x.cents) : "", x.cents < 0 ? fix(x.cents) : "", fix(x.balance)]);
    put(OF, addDays(to, 2), `Westpaw_offset_${from}.csv`, csvLines([["Date", "Description", "Credit", "Debit", "Balance"], ...rows]));
  }
  // the saver: no header, newest first, quarterly
  for (const [from, to] of quarters("2023-07", "2026-06")) {
    const rows = view(SV, from, to).reverse().map((x) => [dmy(x.date), `${x.cents >= 0 ? "+" : "-"}${fix(Math.abs(x.cents))}`, x.desc, fix(x.balance)]);
    put(SV, addDays(to, 2), `bark_transactions_${from}.csv`, csvLines(rows));
  }
  // Tomasz: monthly CSV from the day he joined, then OFX, with an overlap, and six days nobody downloaded
  for (const ym of monthRange("2025-03", "2025-12")) {
    const from = ym === "2025-03" ? JOIN : `${ym}-01`, to = monthEnd(ym), rows = view(TW, from, to).map((x) => [dmy(x.date), x.desc, x.cents > 0 ? fix(x.cents) : "", x.cents < 0 ? fix(x.cents) : "", fix(x.balance)]);
    put(TW, addDays(to, 2), `Wattle_${ym}.csv`, csvLines([["Date", "Description", "Credit", "Debit", "Balance"], ...rows]));
  }
  for (const [from, to] of [["2025-12-17", "2026-02-11"], ["2026-02-18", "2026-04-30"], ["2026-05-01", "2026-06-30"]]) {
    const ls = view(TW, from, to), closing = view(TW, "2000-01-01", to).pop().balance;
    put(TW, addDays(to, 2), `Wattle_${from}.ofx`, ofx({ account: NUM.wattle, bankId: "633000", from, to, rows: ls.map((x) => ({ date: x.date, cents: x.cents, desc: x.desc })), closing, asOf: to }));
  }
  // the card: a monthly statement dated by the charge, a quarterly activity download dated by the post
  chain(CC);
  const cc = B.lines.filter((x) => x.acct === CC).sort(byPost);
  for (const s of CARD.statements) { if (s.end === STATEMENT_MISSING) continue; put("STM-CARD", addDays(s.end, 2), `Amewx_statement_${s.end}.pdf`, pdfCard(s), { issued_on: s.end }); }
  for (const [from, to, day] of quarters("2023-07", "2026-06").map(([f, t], i) => (i === 0 ? ["2023-06-15", t, addDays(t, 3)] : f === "2025-10-01" ? ["2025-09-25", t, addDays(t, 3)] : [f, t === END ? "2026-07-14" : t, addDays(t, 3)]))) {
    const rows = cc.filter((x) => posted(x) >= from && posted(x) <= to).map((x) => ({ d: posted(x), desc: x.csv || x.desc, m: x.member || IM, c: x.csvCents != null ? -x.csvCents : x.cents }));
    if (from === "2025-07-01") { const a = cc.find((x) => x.authFile === from); rows.push({ d: a.date, desc: a.csv, m: a.member, c: -a.authCents }); }
    rows.sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0));
    put(CC, day, `activity_${from}.csv`, csvLines([["Date", "Description", "Card Member", "Account #", "Amount"], ...rows.map((x) => [dmy(x.d), x.desc, x.m.toUpperCase(), `-${NUM.card}`, money(-x.c).replace(/,/g, "")])]));
  }
  // the broker: cash, holdings and a note for every trade
  const bk = chain(BK);
  for (const [from, to] of quarters("2023-07", "2026-06")) {
    const rows = bk.filter((x) => x.date >= from && x.date <= to).map((x) => [fmtDate(x.date), x.reference || `TX-${x.seq}`, x.desc, x.cents < 0 ? fix(-x.cents) : "", x.cents > 0 ? fix(x.cents) : "", fix(x.balance)]);
    if (!rows.length) continue;
    const closing = rows[rows.length - 1][5];
    put(BK, addDays(to, 4), `CedarTrade_cash_${from}.csv`, csvLines([["Cedar Trade cash account"], [`Account: ${NUM.broker}`], [`Period: ${span(from, to)}`], ["Date", "Reference", "Details", "Debit", "Credit", "Balance"], ...rows, ["Closing balance", "", "", "", "", closing], ["End of statement"]]));
  }
  for (const ym of ["2023-06", ...MONTHS]) {
    if (ym === "2025-11") continue;
    const e = monthEnd(ym), rows = SHARES.months[ym].map((h) => [h.code, h.name, h.units, h.price, fix(h.value), e].join("\t"));
    put(SH, addDays(e, 1), `holdings_${e}.tsv`, `${["Security", "Description", "Units", "Price", "Market Value", "As At"].join("\t")}\r\n${rows.join("\r\n")}\r\n`);
  }
  for (const t of SHARES.trades) put("NOTES-CEDAR", t.d, `ContractNote_${t.ref}.pdf`, pdfContractNote(t), { issued_on: t.d });
  for (const v of SHARES.divs) put("DIV-COMPUTERPAW", v.pay, `Dividend_${v.code}_${v.pay}.pdf`, pdfDividend(v), { issued_on: v.pay });
  for (const v of SHARES.dists) put("DIV-COMPUTERPAW", v.pay, `Distribution_${v.code}_${v.pay}.pdf`, pdfDistribution(v), { issued_on: v.pay });
  for (const t of SHARES.taxst) put("TAXST-COMPUTERPAW", `${t.fy}-07-20`, `Tax_statement_OWL_FY${t.fy}.pdf`, pdfTaxStatement(t), { issued_on: `${t.fy}-07-20` });
  // the plan
  const head = ["Plan", "Security", "Units", "Price (USD)", "AUD per USD", "Value (AUD)", "As At"];
  for (const ym of ["2023-06", ...MONTHS]) {
    if (ym === "2026-03") continue;
    const m = PLAN.months[ym]; put(PL, addDays(m.asAt, 1), `etreat_holdings_${m.asAt}.csv`, csvLines([head, [NUM.plan, "LUMA", String(m.units), m.price, m.fx, fix(m.value), dmy(m.asAt)]]));
  }
  for (const fy of [2024, 2025, 2026]) {
    const vs = PLAN.vests.filter((v) => fyOf(v.date) === fy);
    put("VEST-ETREAT", `${fy}-07-03`, `etreat_benefit_FY${fy}.csv`, csvLines([["Participant", "Plan Account", "Security", "Vest Date", "Qty Vested", "Vest FMV (USD)", "AUD per USD", "Taxable Value (AUD)", "Taxing Point", "Status"], ...vs.map((v) => [IM, NUM.plan, "LUMA", dmy(v.date), String(v.units), v.price, v.fx, fix(v.value), dmy(v.date), "Released"])]));
    put("ESS-ETREAT", `${fy}-07-14`, `ESS_statement_FY${fy}.pdf`, pdfEss(fy, vs), { issued_on: `${fy}-07-14` });
  }
  for (const s of PLAN.sales) put("NOTES-ETREAT", s.d, `Trade_${s.ref}.pdf`, pdfEtreatSale(s), { issued_on: s.d });
  // the exchange and the cold wallet
  const coinHead = ["Timestamp (UTC)", "Type", "Asset", "Quantity", "Counter Asset", "Counter Quantity", "AUD Value", "Fee", "Fee Asset", "Transaction ID"];
  for (const [from, to] of [["2025-04-01", "2025-06-30"], ["2025-07-01", "2025-09-30"], ["2025-10-01", "2025-12-31"], ["2026-01-01", "2026-03-31"], ["2026-04-01", "2026-06-30"]]) {
    const rows = COIN.txs.filter((x) => x.time.slice(0, 10) >= from && x.time.slice(0, 10) <= to).map((x) => [x.time, x.type, x.asset, (x.units / 1e8).toFixed(8), x.counter || "", x.counterQty || "", x.aud != null ? fix(x.aud) : "", x.fee || "", x.feeAsset || "", x.id || ""]);
    put(CX, addDays(to, 2), `coinpurr_${from}.csv`, csvLines([coinHead, ...rows]));
  }
  for (const ym of monthRange("2025-03", "2026-06")) { const m = COIN.months[ym]; put(CX, addDays(monthEnd(ym), 1), `coinpurr_statement_${ym}.html`, htmlCoin(ym, m), { origin: "portal" }); }
  put(CW, "2026-07-01", "cold_wallet_export.json", JSON.stringify({ address: NUM.wallet, network: "bitcoin", exported: "2026-07-01T00:00:00Z", transfers: COIN.wallet.map((x) => ({ ts: x.ts, kind: x.kind, token: x.token, qty: (x.units / 1e8).toFixed(8), valueAud: fix(x.value), hash: x.hash })) }, null, 1));
  // loans
  const half = [["2023-07", "2023-12", "2023-07-01", "2023-12-31"], ["2024-01", "2024-06", "2024-01-01", "2024-06-30"], ["2024-07", "2024-12", "2024-07-01", "2024-12-31"], ["2025-01", "2025-06", "2025-01-01", "2025-06-30"], ["2025-07", "2025-12", "2025-07-01", "2025-12-31"], ["2026-01", "2026-06", "2026-01-01", "2026-06-30"]];
  for (const [a, b, from, to] of half) {
    put("STM-HOME-FIXED", addDays(to, 3), `Westpaw_fixed_${to}.pdf`, pdfLoan(BR.westpaw, "Home loan statement", NUM.fixed, "Fixed split", IM, from, to, LOANS.fixed.filter((m) => m.ym >= a && m.ym <= b)), { issued_on: addDays(to, 1) });
    put("STM-HOME-VAR", addDays(to, 3), `Westpaw_variable_${to}.pdf`, pdfLoan(BR.westpaw, "Home loan statement", NUM.variable, "Variable split with offset", IM, from, to, LOANS.variable.filter((m) => m.ym >= a && m.ym <= b)), { issued_on: addDays(to, 1) });
    const inv = LOANS.newInv.filter((m) => m.ym >= a && m.ym <= b);
    if (inv.length) put("STM-INV-NEW", addDays(to, 3), `Westpaw_investment_${to}.pdf`, pdfLoan(BR.westpaw, "Investment loan statement", NUM.invNew, "Investment loan", IM, from < REFI ? REFI : from, to, inv), { issued_on: addDays(to, 1) });
    const pg = LOANS.ping.filter((m) => m.ym >= a && m.ym <= b);
    if (pg.length) put("STM-INV-PING", addDays(to, 5), `PING_statement_${to}.pdf`, pdfLoan(BR.ping, "Investment loan statement", NUM.ping, "Interest Only Investor", IM, from, a === "2025-01" ? REFI : to, pg), { issued_on: addDays(to, 1) });
  }
  for (const [from, to, day] of [["2023-07-01", "2024-06-30", "2024-07-02"], ["2024-07-01", "2025-02-28", "2025-03-03"]]) {
    const rows = LOANS.pingLines.filter((x) => x.date >= from && x.date <= to).map((x) => [dmy(x.date), x.desc, fix(x.cents), fix(-x.balance)].join("\t"));
    put(IP, day, `ping_loan_${from}.tsv`, `Effective Date\tDetails\tAmount\tBalance Owing\r\n${rows.join("\r\n")}\r\n`);
  }
  const notices = [[NUM.fixed, "Fixed split", RATE_F, 0], [NUM.variable, "Variable split with offset", RATE_V, 3], [NUM.invNew, "Investment loan", RATE_N, 0]];
  for (const [num, product, table, lag] of notices) for (let i = 1; i < table.length; i += 1) {
    const eff = table[i][0], issued = addDays(eff, eff === "2025-08-19" && num === NUM.variable ? 14 : lag), tag = num.slice(-3);
    put("NOTICE-WESTPAW", issued, `Westpaw_rate_${tag}_${eff}.pdf`, pdfRateNotice(num, product, table[i - 1][1], table[i][1], eff, issued), { issued_on: issued });
  }
  // pay. Tomasz's pays before he joined stay in his year-end statement and nowhere else
  const ytd = {};
  for (const s of PAY.slips.slice().sort((a, b) => (a.payDate < b.payDate ? -1 : a.payDate > b.payDate ? 1 : 0))) {
    const k = `${s.person}|${s.employer}|${s.fy}`, y = (ytd[k] = ytd[k] || { gross: 0, tax: 0, super: 0 });
    y.gross += s.gross; y.tax += s.tax; y.super += s.super;
    if (s.pre) continue;
    put(s.person === IM ? "PAY-IM" : "PAY-TOM", s.payDate, `Payslip_${s.payDate}.pdf`, pdfPayslip(s, y), { issued_on: s.payDate });
  }
  for (const [person, stream, employers] of [[IM, "INC-IM", [LUMEN]], [TOM, "INC-TOM", [BRIGHT, COBALT]]]) for (const fy of [2024, 2025, 2026]) for (const emp of employers) {
    const ss = PAY.slips.filter((s) => s.person === person && s.employer === emp && s.fy === fy); if (!ss.length) continue;
    put(stream, `${fy}-07-14`, `IncomeStatement_FY${fy}_${emp.split(" ")[0]}.pdf`, pdfIncomeStatement(person, emp, fy, ss), { issued_on: `${fy}-07-14` });
  }
  // super
  const sh = [["2023-07-01", "2023-12-31"], ["2024-01-01", "2024-06-30"], ["2024-07-01", "2024-12-31"], ["2025-01-01", "2025-06-30"], ["2025-07-01", "2025-12-31"], ["2026-01-01", "2026-06-30"]];
  const CODE = { employer: "SG", contributions_tax: "TAX", fee: "FEE", insurance: "INS", earnings: "EARN" };
  const open = (list, from, base) => { const before = list.filter((x) => x.date < from); return before.length ? before[before.length - 1].balance : base; };
  for (const [from, to] of sh) {
    const ls = SUPER.im.filter((x) => x.date >= from && x.date <= to), opening = open(SUPER.im, from, OPEN[SI]);
    put(SI, addDays(to, 5), `hestabby_${from}.json`, JSON.stringify({ schema: "hestabby.transactions.v2", member: { name: IM, number: NUM.superIm }, period: { from, to }, balance: { opening: Number(fix(opening)), closing: Number(fix(ls[ls.length - 1].balance)) }, transactions: ls.map((x) => ({ date: x.date, code: CODE[x.type], label: x.desc, amount: Number(fix(x.cents)), balanceAfter: Number(fix(x.balance)) })) }, null, 1));
  }
  const V2 = { employer: "CONTRIB-SG", contributions_tax: "TAX-15", fee: "FEE-ADMIN", insurance: "INS-DTPD", earnings: "EARNINGS" };
  for (const [from, to] of sh.slice(3)) {
    const f = from < JOIN ? JOIN : from, ls = SUPER.tom.filter((x) => x.date >= f && x.date <= to);
    put(ST, addDays(to, 6), `purrannuation_${f}.csv`, csvLines([["Effective Date", "Category", "Narrative", "Amount (AUD)", "Running Balance", "Reference"], ...ls.map((x, i) => [x.date, V2[x.type], x.desc, fix(x.cents), fix(x.balance), `TXN${f.slice(2, 4)}${pad(i + 1, 4)}`])]));
  }
  for (const fy of [2024, 2025, 2026]) {
    const from = `${fy - 1}-07-01`, to = `${fy}-06-30`, lsI = SUPER.im.filter((x) => x.date >= from && x.date <= to);
    put("STM-SUPER-IM", `${fy}-07-20`, `Annual_statement_FY${fy}.pdf`, pdfFund(BR.hest, "plain", IM, NUM.superIm, fy, lsI, open(SUPER.im, from, OPEN[SI]), lsI[lsI.length - 1].balance), { issued_on: `${fy}-07-20` });
    if (fy >= 2025) { const lsT = SUPER.tom.filter((x) => x.date >= from && x.date <= to); put("STM-SUPER-TOM", `${fy}-07-20`, `Annual_statement_FY${fy}.pdf`, pdfFund(BR.purr, "band", TOM, NUM.superTom, fy, lsT, open(SUPER.tom, from, 16402288), lsT[lsT.length - 1].balance), { issued_on: `${fy}-07-20` }); }
  }
  // tax, and the HELP page, one download a year
  for (const n of TAX.notices) put(n.person === IM ? "TAX-IM" : "TAX-TOM", n.assessed, `NOA_FY${n.fy}.pdf`, pdfNoa(n), { issued_on: n.assessed });
  for (const fy of [2024, 2025, 2026]) { const rows = HELP.rows.filter((x) => fyOf(x.date) === fy), before = HELP.rows.filter((x) => fyOf(x.date) < fy).pop(); const list = before ? [{ ...before, date: `${fy - 1}-07-01`, desc: "Opening balance", amt: null }, ...rows] : rows; put(HP, `${fy}-07-05`, `myguv_help_FY${fy}.html`, htmlHelp(list, list[list.length - 1].bal)); }
  // the rental
  RENT.pm.forEach((s) => put("OWNER-MEOW", s.paid, `PropertyMeow_${s.ym}.pdf`, pdfOwnerMeow(s), { issued_on: s.paid }));
  RENT.rp.forEach((s) => put("OWNER-GOLD", s.paid, `Goldfields_${s.ym}.pdf`, pdfOwnerRent(s), { issued_on: s.paid }));
  // valuations
  put("VALUATIONS", "2026-07-01", "pawprice_estimates.csv", csvLines([["Subject", "As At", "Estimate", "Method", "Provider"], ...VALUES.home.map(([d, c]) => [HOME, dmy(d), fix(c), "estimate", "Pawprice"]), ...VALUES.rental.map(([d, c]) => [RENTAL, dmy(d), fix(c), "estimate", "Pawprice"])]));
  // bills
  for (const b of BILLS.energy) put("BILL-POWER", b.billDate, `bill_${b.billDate}.eml`, emlEnergy(b), { issued_on: b.billDate, origin: "email" });
  for (const b of BILLS.rates) put("BILL-RATES", b.billDate, `rates_${b.billDate}.pdf`, pdfRates(b), { issued_on: b.billDate });
  for (const b of BILLS.water) put("BILL-WATER", b.billDate, `water_${b.billDate}.pdf`, pdfWater(b), { issued_on: b.billDate });
  for (const p of BILLS.policy) put(p.kind === "Home" ? "POLICY-HOME" : "POLICY-LANDLORD", p.paid, `certificate_${p.from}.pdf`, pdfPolicy(p), { issued_on: p.paid });
  for (const x of COIN.receipts) put("RECEIPTS", x.date, `receipt_${x.date}.eml`, emlReceipt(x), { issued_on: x.date, origin: "email" });
  for (const s of KIDS.statements) put("CHILDCARE", nextMonth(s.ym) + "-02", `kittenhood_${s.child.split(" ")[0]}_${s.ym}.html`, htmlKitten(s));
  // documents no public recipe reads: evidence only
  for (const [fy, c, d] of [[2025, 650000, "2025-08-14"], [2026, 480000, "2026-05-20"]]) put("TRUST-STATEMENTS", d, `Trust_distribution_FY${fy}.pdf`, pdfBare(BR.trust, `Beneficiary statement FY${fy}`, [`Beneficiary: ${TOM}`, `Distribution paid: ${money(c)}`, "Prepared by the trustee. Fictional."]));
  for (const q of ["2025-06", "2025-09", "2025-12", "2026-03"]) put("BAS-STATEMENTS", addDays(monthEnd(q), 28), `Activity_statement_${q}.pdf`, pdfBare(BR.guvbas, "Activity statement", [`Period to ${fmtDate(monthEnd(q))}`, `Taxpayer: ${TOM}, trading as TW Aerial`, "PAYG instalment: not varied. Fictional."]));
}
function quarters(a, b) { const out = []; const ms = monthRange(a, b); for (let i = 0; i < ms.length; i += 3) out.push([`${ms[i]}-01`, monthEnd(ms[i + 2])]); return out; }

// ---------- setup: what a person answers at onboarding, in July 2026 ----------
const ON = "2026-07-20T00:00:00Z";
/* The public default categories, as the first household listed them, with PASS-THROUGH which SPEC 4.4c says ships. Added by the SPEC 12 rung, because a person would: rows for child support, parental pay and a side income, which the defaults have nowhere to put. */
const CATS = `SALARY|Salary and wages|income|Income|1|1;SALARY-ALLOW|Allowances|income|Income|1|1;REIMBURSE|Employer reimbursements|income|Income|1|0;SUPER-EMPLOYER|Employer super|income|Super|0|1;SUPER-SACRIFICE|Salary sacrificed to super|income|Super|0|1;PAYROLL-DED|Post-tax payroll deductions|expense|Income|1|1;INTEREST|Interest earned|income|Income|1|1;DIVIDEND|Dividends and distributions|income|Income|1|1;TRUST-DIST|Trust distributions|income|Income|1|1;ESS-INCOME|Employee share scheme income|income|Income|0|1;CRYPTO-INCOME|Staking and crypto income|income|Income|0|1;SUPER-EARN|Super fund earnings|income|Super|0|1;SUPER-FEES|Super fund fees|expense|Super|0|1;SUPER-INS|Insurance inside super|expense|Super|0|1;SUPER-TAX|Contributions tax|expense|Super|0|1;GIFT-IN|Gifts and inheritances received|income|Income|1|0;RENT-INC|Rent received|income|Property|1|1;MORTGAGE|Home loan repayments|expense|Housing|1|0;HOME-INT|Home loan interest|expense|Housing|0|1;RATES-HOME|Council rates (home)|expense|Housing|1|1;HOME-INS|Home and contents insurance|expense|Housing|1|1;HOME-MAINT|Home maintenance|expense|Housing|1|1;GROCERIES|Groceries|expense|Essentials|1|1;UTILITIES|Energy and water|expense|Essentials|1|1;TELCO|Internet and mobile|expense|Essentials|1|1;TRANSPORT|Fuel and transport|expense|Essentials|1|1;CAR|Car costs|expense|Essentials|1|1;HEALTH|Health|expense|Essentials|1|1;CHILDCARE|Childcare|expense|Essentials|1|1;DINING|Dining and takeaway|expense|Lifestyle|1|1;SUBS|Subscriptions|expense|Lifestyle|1|1;SHOPPING|Shopping|expense|Lifestyle|1|1;KIDS-ACT|Kids activities|expense|Lifestyle|1|1;HOLIDAYS|Holidays and travel|expense|Lifestyle|1|1;GIFTS|Gifts|expense|Lifestyle|1|1;PERSONAL|Personal care|expense|Lifestyle|1|1;RENT-INT|Investment loan interest|expense|Property|1|1;RENT-MGMT|Property management fees|expense|Property|1|1;RENT-RATES|Rental rates and water|expense|Property|1|1;RENT-STRATA|Strata levies|expense|Property|1|1;RENT-INS|Landlord insurance|expense|Property|1|1;RENT-REPAIR|Rental repairs|expense|Property|1|1;RENT-OTHER|Other rental costs|expense|Property|1|1;WORK-EQUIP|Work equipment|expense|Work and giving|1|1;WORK-OTHER|Work registrations and courses|expense|Work and giving|1|1;DONATION|Donations|expense|Work and giving|1|1;FEES|Bank fees and card interest|expense|Fees|1|1;INCOME-TAX|Income tax assessed|expense|Tax|0|1;HELP-INDEX|HELP indexation|expense|Tax|0|1;TAX-REFUND|Tax refunds and payments|transfer|Tax|0|0;TRANSFER|Transfers between own accounts|transfer|Transfers|0|0;CC-PAY|Credit card payments|transfer|Transfers|0|0;UNCAT|Uncategorised|suspense|Uncategorised|1|1;PASS-THROUGH|Money that is someone else's|pass_through|Transfers|0|0;x_CHILD-SUPPORT|Child support received|income|Income|1|0;x_PARENTAL-PAY|Parental leave pay|income|Income|1|1;x_SIDE-INCOME|Side income|income|Income|1|1`;
function setup() {
  const person = (id, name, birth) => ({ party_id: id, kind: "person", name, birth_date: birth });
  const org = (id, name, kind = "organisation") => ({ party_id: id, kind, name });
  const party = [person("PTY-IM", IM, "1986-02-11"), person("PTY-TOM", TOM, "1983-09-30"), person("PTY-NOA", NOA, "2020-03-05"), person("PTY-ELIO", ELIO, "2023-04-19"),
    org("PTY-LUMEN", LUMEN), org("PTY-BRIGHTWATER", BRIGHT), org("PTY-COBALT", COBALT), org("PTY-HARBOUR", "Harbour Bank"), org("PTY-WATTLE", "Wattle Credit Union"), org("PTY-BARK", "Bark Bank"),
    org("PTY-AMEWX", "Amewx"), org("PTY-CEDAR", "Cedar Trade"), org("PTY-COMPUTERPAW", "Computerpaw"), org("PTY-WESTPAW", "Westpaw"), org("PTY-PING", "PING"), org("PTY-HESTABBY", "HESTAbby"), org("PTY-PURRANNUATION", "Purrannuation"),
    org("PTY-ETREAT", "E*Treat"), org("PTY-COINPURR", "Coinpurr"), org("PTY-TAX", "myGuv", "government"), org("PTY-MEOW", "PropertyMeow"), org("PTY-GOLD", "Goldfields Realty"), org("PTY-COASTGLOW", "CoastGlow Energy"), org("PTY-COUNCIL", "Bellarine Council", "government"), org("PTY-WATER", "Barwon Reach Water"), org("PTY-PURRSURE", "Purrsure"), org("PTY-KITTEN", "Kittenhood ELC Belmont"), org("PTY-OAKLEIGH", "Oakleigh Appliances"), org("PTY-PAPERBARK", "Paperbark Computers")];
  const membership = [["PTY-IM", "adult", "1986-02-11"], ["PTY-NOA", "dependant", "2020-03-05"], ["PTY-ELIO", "dependant", "2023-04-19"], ["PTY-TOM", "adult", JOIN]].map(([party_id, role, valid_from]) => ({ party_id, role, valid_from, recorded_at: ON }));
  const acct = (account_id, name, cls, type, group, inst, extra = {}) => ({ account_id, name, class: cls, type, reporting_group: group, currency: "AUD", ...(inst ? { institution_party_id: inst } : {}), in_scope: true, liquid: group === "cash", fidelity: "ledger", ...extra });
  const account = [
    acct(HB, "Everyday, Harbour", "asset", "transaction", "cash", "PTY-HARBOUR"), acct(OF, "Offset, Westpaw", "asset", "offset", "cash", "PTY-WESTPAW"), acct(SV, "Kids' saver, Bark", "asset", "savings", "cash", "PTY-BARK"), acct(TW, "Tomasz's everyday, Wattle", "asset", "transaction", "cash", "PTY-WATTLE"),
    acct(CC, "Amewx card", "liability", "credit_card", "cash", "PTY-AMEWX"), acct(BK, "Cedar Trade cash", "asset", "brokerage", "cash", "PTY-CEDAR"), acct(SH, "Shares at Cedar Trade", "asset", "holding", "shares", "PTY-CEDAR", { parent_account_id: BK, liquid: false }),
    acct(PL, "Lumen Arc stock plan", "asset", "ess_plan", "shares", "PTY-ETREAT", { parent_account_id: HB, contract_id: "CON-ESS", liquid: false }),
    acct(CX, "Coinpurr exchange", "asset", "wallet", "crypto", "PTY-COINPURR", { parent_account_id: TW, liquid: false }), acct(CW, "Tomasz's hardware wallet", "asset", "wallet", "crypto", null, { parent_account_id: TW, liquid: false }),
    acct(HF, "Home loan, fixed split", "liability", "loan", "loans", "PTY-WESTPAW", { contract_id: "CON-HOME-FIXED", liquid: false }), acct(HV, "Home loan, variable split", "liability", "loan", "loans", "PTY-WESTPAW", { contract_id: "CON-HOME-VAR", liquid: false }),
    acct(IP, "Investment loan, PING", "liability", "loan", "loans", "PTY-PING", { contract_id: "CON-INV-PING", closed_on: REFI, successor_account_id: IW, liquid: false }), acct(IW, "Investment loan, Westpaw", "liability", "loan", "loans", "PTY-WESTPAW", { contract_id: "CON-INV-NEW", opened_on: REFI, liquid: false }),
    acct(SI, "Imogen's super", "asset", "super", "super", "PTY-HESTABBY", { contract_id: "CON-SUPER-IM", liquid: false }), acct(ST, "Tomasz's super", "asset", "super", "super", "PTY-PURRANNUATION", { contract_id: "CON-SUPER-TOM", liquid: false }),
    acct(HP, "Imogen's HELP debt", "liability", "help_debt", "loans", "PTY-TAX", { liquid: false }),
    acct(HO, "The home", "asset", "property", "property", null, { asset_id: "AST-HOME", fidelity: "snapshot", liquid: false }), acct(RP, "The rental", "asset", "property", "property", null, { asset_id: "AST-RENTAL", fidelity: "snapshot", liquid: false }),
  ];
  const asset = [{ asset_id: "AST-HOME", kind: "property", name: HOME, account_id: HO, location: "Belmont VIC", acquired_on: "2019-11-22" }, { asset_id: "AST-RENTAL", kind: "property", name: RENTAL, account_id: RP, location: "Sebastopol VIC", acquired_on: "2021-03-16" }];
  const al = (subject_type, subject_id, scheme, value, o = {}) => ({ subject_type, subject_id, scheme, value, valid_from: "2000-01-01", recorded_at: ON, ...o });
  const alias = [al("account", HB, "account_number", NUM.harbour, { valid_to: RENUM }), al("account", HB, "account_number", NUM.harbour2, { valid_from: RENUM }), al("account", TW, "account_number", NUM.wattle), al("account", CC, "card_last4", NUM.card), al("account", BK, "account_number", NUM.broker), al("account", SH, "hin", NUM.hin),
    al("account", HF, "loan_number", NUM.fixed), al("account", HV, "loan_number", NUM.variable), al("account", IP, "loan_number", NUM.ping), al("account", IW, "loan_number", NUM.invNew), al("account", SI, "member_number", NUM.superIm), al("account", ST, "member_number", NUM.superTom), al("account", PL, "account_number", NUM.plan), al("account", CW, "wallet_address", NUM.wallet),
    al("party", "PTY-IM", "name", IM), al("party", "PTY-TOM", "name", TOM), al("party", "PTY-LUMEN", "name", LUMEN), al("party", "PTY-BRIGHTWATER", "name", BRIGHT), al("party", "PTY-COBALT", "name", COBALT), al("party", "PTY-KITTEN", "name", "Kittenhood ELC Belmont"),
    al("asset", "AST-HOME", "name", HOME), al("asset", "AST-RENTAL", "name", RENTAL), al("asset", "AST-RENTAL", "owner_ref", NUM.ownerPm, { valid_to: AGENT2 }), al("asset", "AST-RENTAL", "owner_ref", NUM.ownerRp, { valid_from: AGENT2 }),
    al("contract", "CON-HOME-FIXED", "loan_number", NUM.fixed), al("contract", "CON-HOME-VAR", "loan_number", NUM.variable), al("contract", "CON-INV-PING", "loan_number", NUM.ping), al("contract", "CON-INV-NEW", "loan_number", NUM.invNew), al("contract", "CON-HOME-INS", "policy_number", "PH-61118226"), al("contract", "CON-LANDLORD", "policy_number", "PL-77133120"), al("contract", "CON-ESS", "account_number", NUM.plan)];
  const own_ = (subject_type, subject_id, split, o = {}) => ["legal", "beneficial", "tax"].flatMap((basis) => split.map(([party_id, share_bps]) => ({ subject_type, subject_id, party_id, basis, share_bps, valid_from: "2000-01-01", recorded_at: ON, ...o })));
  const im = [["PTY-IM", 10000]], tom = [["PTY-TOM", 10000]], both = [["PTY-IM", 5000], ["PTY-TOM", 5000]];
  const ownership = [...own_("account", HB, im, { valid_to: RENUM }), ...own_("account", HB, both, { valid_from: RENUM }), ...[OF, SV, CC, BK, SH, PL, HF, HV, IP, IW, SI, HP, HO, RP].flatMap((a) => own_("account", a, im)), ...[TW, CX, CW, ST].flatMap((a) => own_("account", a, tom)), ...own_("asset", "AST-HOME", im), ...own_("asset", "AST-RENTAL", im)];
  const category = CATS.split(";").map((r) => { const [category_id, name, kind, group, c, e] = r.split("|"); return { category_id, name, kind, group, cash_lens: c === "1", economic_lens: e === "1" }; });
  const con = (contract_id, kind, name, counterparty_party_id, holder_party_id, extra = {}) => ({ contract_id, kind, name, counterparty_party_id, holder_party_id, ...extra });
  const contract = [
    con("CON-IM-EMP", "employment", "Imogen at Lumen Arc", "PTY-LUMEN", "PTY-IM", { category_id: "SALARY", started_on: "2018-05-07" }), con("CON-TOM-EMP1", "employment", "Tomasz at Brightwater", "PTY-BRIGHTWATER", "PTY-TOM", { category_id: "SALARY", started_on: "2017-02-13", ended_on: "2025-11-07" }), con("CON-TOM-EMP2", "employment", "Tomasz at Cobalt Rail", "PTY-COBALT", "PTY-TOM", { category_id: "SALARY", started_on: "2026-02-02" }),
    con("CON-HOME-FIXED", "loan", "Home loan, fixed split", "PTY-WESTPAW", "PTY-IM", { account_id: HF, asset_id: "AST-HOME", category_id: "MORTGAGE", started_on: "2019-11-22" }), con("CON-HOME-VAR", "loan", "Home loan, variable split", "PTY-WESTPAW", "PTY-IM", { account_id: HV, asset_id: "AST-HOME", category_id: "MORTGAGE", started_on: "2019-11-22" }),
    con("CON-INV-PING", "loan", "Investment loan, PING", "PTY-PING", "PTY-IM", { account_id: IP, asset_id: "AST-RENTAL", category_id: "RENT-INT", started_on: "2021-03-16", ended_on: REFI }), con("CON-INV-NEW", "loan", "Investment loan, Westpaw", "PTY-WESTPAW", "PTY-IM", { account_id: IW, asset_id: "AST-RENTAL", category_id: "RENT-INT", started_on: REFI }),
    con("CON-SUPER-IM", "super_fund", "Imogen's super", "PTY-HESTABBY", "PTY-IM", { account_id: SI }), con("CON-SUPER-TOM", "super_fund", "Tomasz's super", "PTY-PURRANNUATION", "PTY-TOM", { account_id: ST }),
    con("CON-ESS", "ess_plan", "Lumen Arc share units", "PTY-ETREAT", "PTY-IM", { account_id: PL }), con("CON-HOME-INS", "insurance", "Home insurance", "PTY-PURRSURE", "PTY-IM", { asset_id: "AST-HOME", category_id: "HOME-INS" }), con("CON-LANDLORD", "insurance", "Landlord insurance", "PTY-PURRSURE", "PTY-IM", { asset_id: "AST-RENTAL", category_id: "RENT-INS" }),
    con("CON-POWER", "utility", "Electricity", "PTY-COASTGLOW", "PTY-IM", { category_id: "UTILITIES" }), con("CON-KIDS", "childcare", "Kittenhood", "PTY-KITTEN", "PTY-IM", { category_id: "CHILDCARE" }),
    con("CON-AGENT1", "lease", "The rental, PropertyMeow managing", "PTY-MEOW", "PTY-IM", { asset_id: "AST-RENTAL", category_id: "RENT-INC", started_on: "2021-04-01", ended_on: "2024-09-30" }), con("CON-AGENT2", "lease", "The rental, Goldfields managing", "PTY-GOLD", "PTY-IM", { asset_id: "AST-RENTAL", category_id: "RENT-INC", started_on: AGENT2 }),
  ];
  const lk = (relation, from_type, from_id, to_type, to_id, extra = {}) => ({ relation, from_type, from_id, to_type, to_id, valid_from: "2000-01-01", recorded_at: ON, ...extra });
  const link = [lk("contributes_to", "contract", "CON-IM-EMP", "contract", "CON-SUPER-IM"), lk("contributes_to", "contract", "CON-TOM-EMP1", "contract", "CON-SUPER-TOM"), lk("contributes_to", "contract", "CON-TOM-EMP2", "contract", "CON-SUPER-TOM"),
    lk("secures", "contract", "CON-HOME-FIXED", "asset", "AST-HOME"), lk("secures", "contract", "CON-HOME-VAR", "asset", "AST-HOME"), lk("funds_purpose", "contract", "CON-HOME-FIXED", "asset", "AST-HOME", { share_bps: 10000 }), lk("funds_purpose", "contract", "CON-HOME-VAR", "asset", "AST-HOME", { share_bps: 10000 }), lk("split_of", "contract", "CON-HOME-VAR", "contract", "CON-HOME-FIXED"),
    lk("secures", "contract", "CON-INV-PING", "asset", "AST-RENTAL", { valid_to: REFI }), lk("funds_purpose", "contract", "CON-INV-PING", "asset", "AST-RENTAL", { share_bps: 10000, valid_to: REFI }), lk("secures", "contract", "CON-INV-NEW", "asset", "AST-RENTAL", { valid_from: REFI }), lk("funds_purpose", "contract", "CON-INV-NEW", "asset", "AST-RENTAL", { share_bps: 10000, valid_from: REFI }),
    lk("offsets", "account", OF, "contract", "CON-HOME-VAR"), lk("serves", "account", OF, "asset", "AST-RENTAL"), lk("paid_by", "contract", "CON-HOME-FIXED", "account", HB), lk("paid_by", "contract", "CON-HOME-VAR", "account", HB), lk("paid_by", "contract", "CON-INV-PING", "account", OF, { valid_to: REFI }), lk("paid_by", "contract", "CON-INV-NEW", "account", OF, { valid_from: REFI }),
    lk("charged_to", "account", CC, "account", HB), lk("covers", "contract", "CON-HOME-INS", "asset", "AST-HOME"), lk("covers", "contract", "CON-LANDLORD", "asset", "AST-RENTAL")];
  const st = (stream_id, name, doc_kind, subject_type, subject_id, issuer_party_id, cadence, extra = {}) => ({ stream_id, name, doc_kind, subject_type, subject_id, issuer_party_id, cadence, valid_from: START, grace_days: 14, recorded_at: ON, ...extra });
  const stream = [
    st(HB, "Harbour download", "txn_csv", "account", HB, "PTY-HARBOUR", "quarterly"), st(OF, "Offset download", "txn_csv", "account", OF, "PTY-WESTPAW", "quarterly"), st(SV, "Bark download", "txn_csv", "account", SV, "PTY-BARK", "quarterly"), st(TW, "Wattle download", "txn_csv", "account", TW, "PTY-WATTLE", "monthly", { valid_from: JOIN }), st(CC, "Amewx activity", "txn_csv", "account", CC, "PTY-AMEWX", "quarterly"), st("STM-CARD", "Amewx statement", "statement", "account", CC, "PTY-AMEWX", "monthly"),
    st(BK, "Cedar cash", "txn_csv", "account", BK, "PTY-CEDAR", "quarterly"), st(SH, "Cedar holdings", "holdings", "account", SH, "PTY-CEDAR", "monthly"), st("NOTES-CEDAR", "Contract notes", "contract_note", "account", SH, "PTY-CEDAR", "event"), st("DIV-COMPUTERPAW", "Dividend notices", "dividend", "account", SH, "PTY-COMPUTERPAW", "event"), st("TAXST-COMPUTERPAW", "ETF tax statements", "distribution", "account", SH, "PTY-COMPUTERPAW", "yearly"),
    st(PL, "Plan holdings", "holdings", "account", PL, "PTY-ETREAT", "monthly"), st("VEST-ETREAT", "Vest report", "vest", "account", PL, "PTY-ETREAT", "yearly"), st("ESS-ETREAT", "ESS statement", "ess_statement", "account", PL, "PTY-ETREAT", "yearly"), st("NOTES-ETREAT", "Plan trade confirmations", "contract_note", "account", PL, "PTY-ETREAT", "event"),
    st(CX, "Coinpurr", "crypto", "account", CX, "PTY-COINPURR", "monthly", { valid_from: JOIN }), st(CW, "Cold wallet export", "crypto", "account", CW, null, "yearly", { valid_from: JOIN }),
    st("STM-HOME-FIXED", "Fixed split statement", "loan_statement", "account", HF, "PTY-WESTPAW", "half_yearly"), st("STM-HOME-VAR", "Variable split statement", "loan_statement", "account", HV, "PTY-WESTPAW", "half_yearly"), st("STM-INV-PING", "PING statement", "loan_statement", "account", IP, "PTY-PING", "half_yearly", { valid_to: "2025-03-01" }), st(IP, "PING download", "txn_tsv", "account", IP, "PTY-PING", "yearly", { valid_to: "2025-03-01" }), st("STM-INV-NEW", "Investment loan statement", "loan_statement", "account", IW, "PTY-WESTPAW", "half_yearly", { valid_from: REFI }), st("NOTICE-WESTPAW", "Rate notices", "rate_notice", "contract", "CON-HOME-VAR", "PTY-WESTPAW", "event"),
    st("PAY-IM", "Imogen's payslips", "payslip", "party", "PTY-IM", "PTY-LUMEN", "fortnightly", { valid_from: "2023-10-05" }), st("PAY-TOM", "Tomasz's payslips", "payslip", "party", "PTY-TOM", "PTY-COBALT", "monthly", { valid_from: JOIN }), st("INC-IM", "Imogen's income statement", "income_statement", "party", "PTY-IM", "PTY-LUMEN", "yearly"), st("INC-TOM", "Tomasz's income statements", "income_statement", "party", "PTY-TOM", "PTY-COBALT", "yearly", { valid_from: JOIN }),
    st(SI, "Imogen's super transactions", "super_lines", "account", SI, "PTY-HESTABBY", "half_yearly"), st(ST, "Tomasz's super transactions", "super_lines", "account", ST, "PTY-PURRANNUATION", "half_yearly", { valid_from: JOIN }), st("STM-SUPER-IM", "Imogen's super statement", "super_statement", "account", SI, "PTY-HESTABBY", "yearly"), st("STM-SUPER-TOM", "Tomasz's super statement", "super_statement", "account", ST, "PTY-PURRANNUATION", "yearly", { valid_from: JOIN }),
    st("TAX-IM", "Imogen's notices", "tax_assessment", "party", "PTY-IM", "PTY-TAX", "yearly"), st("TAX-TOM", "Tomasz's notices", "tax_assessment", "party", "PTY-TOM", "PTY-TAX", "yearly", { valid_from: JOIN }), st(HP, "HELP account", "help_balance", "account", HP, "PTY-TAX", "yearly"),
    st("OWNER-MEOW", "PropertyMeow statements", "owner_statement", "asset", "AST-RENTAL", "PTY-MEOW", "monthly", { valid_to: "2024-10-14" }), st("OWNER-GOLD", "Goldfields statements", "owner_statement", "asset", "AST-RENTAL", "PTY-GOLD", "monthly", { valid_from: AGENT2 }), st("VALUATIONS", "Pawprice estimates", "valuation", "asset", "AST-RENTAL", null, "quarterly"),
    st("BILL-POWER", "Electricity bills", "bill", "contract", "CON-POWER", "PTY-COASTGLOW", "quarterly"), st("BILL-RATES", "Rates notices", "bill", "asset", "AST-HOME", "PTY-COUNCIL", "quarterly"), st("BILL-WATER", "Water bills", "bill", "asset", "AST-HOME", "PTY-WATER", "quarterly"), st("POLICY-HOME", "Home insurance certificate", "policy", "contract", "CON-HOME-INS", "PTY-PURRSURE", "yearly"), st("POLICY-LANDLORD", "Landlord certificate", "policy", "contract", "CON-LANDLORD", "PTY-PURRSURE", "yearly"), st("CHILDCARE", "Kittenhood statements", "childcare_statement", "contract", "CON-KIDS", "PTY-KITTEN", "monthly", { valid_from: "2023-10-01" }), st("RECEIPTS", "Receipts", "receipt", "party", "PTY-IM", null, "event"),
    st("TRUST-STATEMENTS", "Family trust statements", "trust_statement", "party", "PTY-TOM", null, "yearly", { valid_from: JOIN }), st("BAS-STATEMENTS", "Activity statements", "activity_statement", "party", "PTY-TOM", "PTY-TAX", "quarterly", { valid_from: JOIN }),
  ];
  const instrument = [...Object.entries(SEC).map(([code, s]) => ({ instrument_id: `INS-${code}`, kind: code === "OWL" ? "etf" : "listed_share", code, name: s.name, currency: "AUD" })), { instrument_id: "INS-LUMA", kind: "rsu", code: "LUMA", name: "Lumen Arc Inc", currency: "USD" }, ...["BTC", "ETH", "SOL"].map((code) => ({ instrument_id: `INS-${code}`, kind: "crypto", code, name: code, currency: "AUD" }))];
  let t = 0;
  const tm = (subject_type, subject_id, term, value, unit, valid_from, o = {}) => { t += 1; return { term_id: `TERM-${pad(t, 3)}`, subject_type, subject_id, term, value, unit, valid_from, recorded_at: ON, ...o }; };
  // only what a person knows offhand: the rates they signed, fixed or variable, the salaries, what the place is for
  const term = [tm("contract", "CON-HOME-FIXED", "interest_rate", "5.89", "pct", START), tm("contract", "CON-HOME-FIXED", "rate_type", "fixed", null, START, { valid_to: "2025-03-01" }), tm("contract", "CON-HOME-FIXED", "fixed_until", "2025-03-01", "date", START), tm("contract", "CON-HOME-FIXED", "rate_type", "variable", null, "2025-03-01"), tm("contract", "CON-HOME-FIXED", "repayment_type", "principal_and_interest", null, START),
    tm("contract", "CON-HOME-VAR", "interest_rate", "6.34", "pct", START), tm("contract", "CON-HOME-VAR", "rate_type", "variable", null, START), tm("contract", "CON-HOME-VAR", "repayment_type", "principal_and_interest", null, START),
    tm("contract", "CON-INV-PING", "interest_rate", "6.49", "pct", START), tm("contract", "CON-INV-PING", "repayment_type", "interest_only", null, START), tm("contract", "CON-INV-NEW", "interest_rate", "5.99", "pct", REFI), tm("contract", "CON-INV-NEW", "repayment_type", "principal_and_interest", null, REFI),
    tm("contract", "CON-IM-EMP", "base_salary_cents", "16100000", "cents", START), tm("contract", "CON-IM-EMP", "pay_cadence", "fortnightly", null, START), tm("contract", "CON-IM-EMP", "leave_status", "parental_leave", null, START, { valid_to: "2023-10-02" }), tm("contract", "CON-TOM-EMP1", "base_salary_cents", "12300000", "cents", JOIN), tm("contract", "CON-TOM-EMP1", "pay_cadence", "monthly", null, JOIN), tm("contract", "CON-TOM-EMP2", "base_salary_cents", "11800000", "cents", "2026-02-02"), tm("contract", "CON-TOM-EMP2", "pay_cadence", "monthly", null, "2026-02-02"),
    tm("contract", "CON-AGENT1", "agent_fee_pct", "7", "pct", START), tm("contract", "CON-AGENT2", "agent_fee_pct", "6.5", "pct", AGENT2), tm("asset", "AST-HOME", "use", "owner_occupied", null, "2019-11-22"), tm("asset", "AST-RENTAL", "use", "rental", null, "2021-03-16")];
  const activity = [{ activity_id: "ACT-RENTAL", kind: "rental", name: "The Sebastopol rental", asset_id: "AST-RENTAL", owner_party_id: "PTY-IM", valid_from: "2021-03-16", recorded_at: ON }, { activity_id: "ACT-AERIAL", kind: "sole_trader", name: "TW Aerial", owner_party_id: "PTY-TOM", valid_from: "2022-07-01", recorded_at: ON }];
  const household = [{ household_id: "HH-RW", name: "Reyes-Wolak", jurisdiction: "AU", base_currency: "AUD", fy_start_month: 7, timezone: "Australia/Melbourne", standard_version: "household-standard/1" }];
  return { household, party, membership, account, alias, ownership, category, contract, link, stream, asset, instrument, term, activity };
}

// ---------- build ----------
function build() {
  valuations(); everyday(); payroll(); reimbursement(); pingLoan(); homeRepayments(); rental(); bills(); superFunds(); shares(); rsu(); crypto(); plumbing(); settleCard(); taxes(); saverInterest(); chargeInterest(); loanTraps(); fileTraps();
  const t = truth();
  const lows = {}; for (const a of [HB, OF, SV, TW, BK]) lows[a] = Math.min(...chain(a).map((x) => x.balance));
  for (const [a, v] of Object.entries(lows)) if (v < 0) throw new Error(`${a} goes overdrawn: ${money(v)}`);
  render();
  const tSetup = setup();
  fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
  const manifest = { household: "HH-RW", files: FILES.map((f) => ({ path: f.path, stream_id: f.stream, download_date: f.day, name: f.name, origin: f.origin || "portal", issued_on: f.issued_on || null })) };
  for (const f of FILES) { const p = path.join(OUT, f.path); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, f.bytes); }
  fs.writeFileSync(path.join(OUT, "manifest.json"), `${JSON.stringify(manifest, null, 1)}\n`);
  fs.writeFileSync(path.join(OUT, "truth.json"), `${JSON.stringify(t, null, 1)}\n`);
  fs.mkdirSync(SETUP_DIR, { recursive: true });
  for (const n of fs.readdirSync(SETUP_DIR)) fs.rmSync(path.join(SETUP_DIR, n));
  for (const [k, v] of Object.entries(tSetup)) fs.writeFileSync(path.join(SETUP_DIR, `${k}.json`), `${JSON.stringify(v, null, 1)}\n`);
  return { files: FILES.length, lines: B.lines.length, traps: B.traps.length, fresh: B.traps.filter((x) => x.fresh).length, dc: B.traps.filter((x) => x.dc).length, lows };
}

if (require.main === module) { const r = build(); console.log(`Held-out household 2: ${r.files} files, ${r.lines} lines, ${r.traps} traps (${r.fresh} not in BLIND-1, ${r.dc} new double-count variants). Lowest balances: ${Object.entries(r.lows).map(([a, v]) => `${a} ${money(v)}`).join(", ")}.`); }
module.exports = { build, OUT, SETUP_DIR, book: B };
