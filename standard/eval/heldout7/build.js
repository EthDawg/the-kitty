#!/usr/bin/env node
/* The seventh held-out household. Six blind families found real defects, and the engine was repaired after each. Repaired scores prove nothing. The last round changed how the engine reads a
   contract's name, on purpose: it should now ask more and guess less, and that change has not been tested blind. This one is the headline: the blind score of the engine as it ships.

   The Singh-Kaurs of Tarneit, Victoria, 36 months from July 2023 to June 2026. Everything here is fictional. Harpreet Singh drives linehaul trucks. Simran Kaur works casual shifts in aged care and
   home care, has a baby in November 2024, and goes back. A husband and wife with no surname in common, in a community where half the men are Singh and half the women are Kaur. His parents are in
   Moga, in Punjab, and the household sends money home each month. His brother Gurjot lives with them on a student visa and pays board. A lodger rents the fourth bedroom. His mother visits for a
   year on a sponsored visa, against a bond. He holds a rupee account, a flat in Mohali that earns rent in rupees, and a plot he sells. Simran belongs to a rotating savings circle.
   Written blind: from SPEC.md, RECIPES.md, the schemas, the public recipes, the intake, the world's file writers and the six earlier held-out folders' build, run and blind reports.

   Order of work, as in the earlier households: a life is simulated first and held in cents, day by day. Only then are files rendered from it, as each institution would hand them over. Truth is
   written from the simulation and never from the engine. Setup is what a person would answer at onboarding: no rules, no decisions, no opening balances a file states.

   node standard/eval/heldout7/build.js
   writes standard/.build/heldout7/{sources,manifest.json,truth.json} and standard/eval/heldout7/setup/<table>.json. Node 22, no dependencies, seeded, no clock. */
"use strict";
const fs = require("fs"), path = require("path"), zlib = require("zlib");

const STD = path.join(__dirname, "..", "..");
const LIB = path.join(STD, "world", "lib");
const { pad, fix, money, addDays, dayDiff, weekday, monthEnd, nextMonth, monthRange, fmtDate, dmy, fyOf, csvLines, Rng, MONTHS: MON } = require(path.join(LIB, "util"));
const { Doc, M: MARGIN } = require(path.join(LIB, "pdf"));
const { eml, page, row } = require(path.join(LIB, "mail"));
const { ofx } = require(path.join(LIB, "bankfiles"));

const OUT = path.join(STD, ".build", "heldout7");
const SETUP_DIR = path.join(__dirname, "setup");
const START = "2023-07-01", END = "2026-06-30", MONTHS = monthRange("2023-07", "2026-06");
const BABY = "2024-11-12", GURJOT_IN = "2024-02-12", GURJOT_OUT = "2026-01-30", LODGER_IN = "2024-08-05", LODGER_OUT = "2025-11-24", LAVERTON_END = "2024-09-27", LEAVE_FROM = "2024-10-16", BACK_TO_WORK = "2025-08-06", LAND_SOLD = "2025-09-10", OLDCAR_SOLD = "2025-11-14", TRUNC_FROM = "2025-10-14", TRUNC_TO = "2025-10-31";
const rng = (name) => new Rng(`singh-kaur:${name}`);
const deflate = (b) => new Uint8Array(zlib.deflateSync(b));

// ---------- who and what ----------
const HARPREET = "Harpreet Singh", SIMRAN = "Simran Kaur", SIMRANJIT = "Simranjit Kaur", ANAYA = "Anaya Kaur", REET = "Reet Kaur", GURJOT = "Gurjot Singh", BALWINDER = "Balwinder Singh", SURJIT = "Surjit Kaur", AARAV = "Aarav Patel";
const WESTGATE = "Westgate Linehaul", ARDEER = "Ardeer Aged Care", LAVERTON = "Laverton Home Support", COUNCIL = "Wyndham Plains Council", HOME = "17 Kookaburra Rise, Tarneit", SA = "Services Australia", WW = "Whiskerwire", GURDWARA = "Tarneit Gurdwara", OSHC = "Kittenhood OSHC Tarneit", POWER = "Werribee Plains Power", WATER = "Little River Water", POLY = "Wyndham Polytechnic", SATLUJ = "Satluj Valley Bank", FLAT = "Flat 3B, Sector 70, Mohali", PLOT = "Plot 114, Moga";
const JT = "ACC-JOINT", SM = "ACC-SIMRAN", SV = "ACC-SAVE", CC = "ACC-CARD", NR = "ACC-RUPEE", HL = "ACC-HOMELOAN", SH = "ACC-SUPER-H", SK = "ACC-SUPER-S", HO = "ACC-HOME", FL = "ACC-FLAT", PL = "ACC-PLOT", CR = "ACC-CAR", OC = "ACC-OLDCAR";
const NUM = { joint: "330718842", sim: "0071930877", save: "120044718806", gurjot: "120044907719", rupee: "6020", card: "42118", home: "662 041 877", superH: "HST-5519027", superS: "PUR-6620913", policyHome: "PH-71120552", policyMotor: "PM-8840", rego: "1XY2ZW", assessment: "WP-7741080" };
const CASH = [JT, SM, SV, CC, NR];
const WAGE_H = "WESTGATE LINEHAUL PAY 5521", WAGE_SAVE = "WESTGATE LINEHAUL PAY SAVE", WAGE_S = "ARDEER AGED CARE PAY 4417", WAGE_L = "LAVERTON HOME SUPPORT PAY", FTB = "SERVICES AUSTRALIA FTB 7741", PPL = "SERVICES AUSTRALIA PAID PARENTAL 7741", REMIT_B = "WHISKERWIRE 6620 B SINGH MOGA", TT_B = "INWARD TT B SINGH MOGA";
const cardFull = () => `xxxx-xxxxxx-${NUM.card}`;

/* the rupee: Australian cents per hundred rupees, times a hundred, by month. A walk, public in nature and printed on no file a household holds */
const FX = {};
function fxCurve() { const r = rng("fx"); let f = 18200; for (const ym of ["2023-06", ...MONTHS]) { f = Math.round(f * (1 + r.range(-0.011, 0.011))); FX[ym] = f; } }
const toAud = (paise, d) => Math.round(paise * FX[d.slice(0, 7)] / 1000000);

// ---------- the book: every line that ever touches an account, in cents, holder's sign. Lines on the rupee account are in paise, with their dollar value beside them ----------
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
const bizAfter = (d, n) => { let x = d; while (n > 0) { x = addDays(x, 1); if (isBiz(x)) n -= 1; } return x; };
const cents = (r, lo, hi) => Math.round(r.range(lo, hi) * 100);
const ymOf = (d) => d.slice(0, 7);
const posted = (x) => x.posted || x.date;
const byTime = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.seq - b.seq);
const byPost = (a, b) => (posted(a) < posted(b) ? -1 : posted(a) > posted(b) ? 1 : a.seq - b.seq);
const nextMonday = (d) => { let x = addDays(d, 1); while (weekday(x) !== 1) x = addDays(x, 1); return x; };

/* trap register. fresh: in none of the six earlier lists. regular: a contract's plainly regular money, which must be read without a question. dc: a new variant of double counting or of a number silently wrong. A probe is a fact run.js can test against what the engine produced. */
function trap(id, name, where, expect, probe, o = {}) { B.traps.push({ id, name, where, expect, probe, fresh: !!o.fresh, dc: !!o.dc, regular: !!o.regular }); }
const plain = (x, want, extra = {}) => ({ account: x.acct, date: x.date, ...(x.posted && x.posted !== x.date ? { posted: x.posted } : {}), cents: x.cents, want, ...extra });

/* one card purchase. date is the day it was charged, which the statement shows; posted is the day the activity download shows. Lag is in business days. */
function card(r, date, m, c, cat, o = {}) {
  const lag = o.lag != null ? o.lag : r.pick([0, 0, 1, 1, 1, 2, 2, 3, 4, 5]);
  const post = o.posted || (lag ? bizAfter(date, lag) : date);
  count("purchase");
  return line(CC, date, o.desc || cardDesc(m), -c, { posted: post, csv: o.csv || cardCsv(m), member: HARPREET, lens: o.lens === undefined ? "spending" : o.lens, cat, ...o.extra });
}

// ---------- merchants, all invented ----------
const MER = {
  grocer: [["SINGH SPICE BAZAAR", "TARNEIT"], ["HOGANS RD FRESH", "TARNEIT"], ["HOPPERS GROCER", "HOPPERS CROSSING"]],
  cafe: [["DAVIS RD CHAI", "TARNEIT"], ["WATTON ST KIOSK", "WERRIBEE"]],
  dine: [["MOGA ROAD KITCHEN", "TRUGANINA"], ["SAYERS RD PIZZA", "TARNEIT"]],
  fuel: [["LEAKES RD FUEL", "TRUGANINA"], ["SAYERS RD FUEL", "TARNEIT"]],
  shop: [["KOOKABURRA HOMEWARES", "TARNEIT"], ["WERRIBEE HARDWARE", "WERRIBEE"], ["WATTON ST CLOTHING", "WERRIBEE"]],
  chem: [["DAVIS RD CHEMIST", "TARNEIT"]],
};
const cardDesc = (m) => `${m[0]} ${m[1]}`;
const cardCsv = (m) => `${m[0].padEnd(26)}${m[1]}  VIC`;
const pos = (m) => `EFTPOS ${m[0]} ${m[1]}`;
/* a sample must be one line on its day: two of one amount on one day are found together */
const single = (xs) => xs.filter((x) => xs.filter((y) => y.date === x.date && y.cents === x.cents).length === 1);
const outsideHole = (x) => !(x.acct === JT && x.date >= TRUNC_FROM && x.date <= TRUNC_TO);
/* every line of a contract's plainly regular money. quiet: right is not enough, it must also be read without a question */
const reg = (xs, want, cat) => xs.filter(outsideHole).map((x) => plain(x, want, { quiet: true, ...(cat ? { cat } : {}) }));

// ---------- everyday life ----------
const ATM = [], SPICE = [];
function everyday() {
  const r = rng("everyday"), pick = (a) => r.pick(a);
  const debit = (acct, d, m, c, cat) => { count("purchase"); const x = spend(acct, d, pos(m), c, cat); if (m[0] === MER.grocer[0][0]) SPICE.push(x); return x; };
  for (let d = "2023-06-15"; d <= END; d = addDays(d, 1)) {
    const wd = weekday(d), inWin = d >= START;
    if (r.next() < 0.2) { const m = pick(MER.grocer), x = card(r, d, m, cents(r, 36, 150), "GROCERIES"); if (m[0] === MER.grocer[0][0] && inWin) SPICE.push(x); }
    if (r.next() < 0.09) card(r, d, pick(MER.cafe), cents(r, 5, 16), "DINING");
    if (wd === 6 && r.next() < 0.22) card(r, d, pick(MER.dine), cents(r, 30, 84), "DINING");
    if (r.next() < 0.05) card(r, d, pick(MER.shop), cents(r, 14, 170), "SHOPPING");
    if (r.next() < 0.05) card(r, d, pick(MER.chem), cents(r, 8, 48), "HEALTH");
    if (d.slice(8) === "11") card(r, d, ["NORTHLIGHT STREAM", "ONLINE"], 1699, "SUBS");
    if (!inWin) continue;
    if (r.next() < 0.22) debit(JT, d, pick(MER.grocer), cents(r, 20, 110), "GROCERIES");
    if (r.next() < 0.13) debit(JT, d, pick(MER.fuel), cents(r, 50, 92), "TRANSPORT");
    if (r.next() < 0.1) debit(SM, d, pick(MER.shop), cents(r, 12, 60), "SHOPPING");
    if (wd === 2 && r.next() < 0.5) debit(SM, d, pick(MER.cafe), cents(r, 5, 14), "DINING");
    if (d.slice(8) === "03") { spend(JT, d, "DIRECT DEBIT KOALATEL MOBILE 7102", 8900, "TELCO"); spend(JT, d, "DIRECT DEBIT REEFLINK INTERNET 44120", 7900, "TELCO"); count("purchase", 2); }
  }
  const a = rng("atm"); let d = "2023-07-04";
  while (d <= END) { const c = a.pick([10000, 10000, 15000, 20000]); ATM.push(spend(JT, d, "ATM WITHDRAWAL DAVIS RD", c, "PERSONAL")); count("atm"); d = addDays(d, a.int(8, 14)); }
  trap("T7-ATM", "An ATM withdrawal is spending, whatever happens to the notes", `${JT}: ${ATM.length} lines reading "ATM WITHDRAWAL DAVIS RD"`, "Money that left the accounts for the household to spend. Spending, and not an open transfer waiting for a pair.",
    { kind: "lines", lines: ATM.filter(outsideHole).filter((x, i) => [3, 25, 60].includes(i)).map((x) => plain(x, "spending")) });
  const kid = []; for (const ym of MONTHS) kid.push(spend(JT, nextBiz(`${ym}-12`), "OSKO TO ANAYA KAUR SAVER", 5000, "KIDS-ACT"));
  trap("T7-KID-SAVER", "Pocket money to a dependant's account nobody declared", `${JT}: ${kid.length} months of 50.00, "OSKO TO ANAYA KAUR SAVER". Anaya is a dependant in setup and no account of hers is`, "Spending. A member's name does not make it an own transfer, and no account of the household's receives it.",
    { kind: "lines", lines: [kid[2], kid[17], kid[33]].filter(outsideHole).map((x) => plain(x, "spending")) });
  const s = SPICE.filter(outsideHole).filter((x) => x.date >= START);
  trap("T7-SINGH-MERCHANT", "A grocer with a member's surname, on the card and at the till", `${SPICE.length} lines reading "SINGH SPICE BAZAAR", the household's own grocer, on ${CC} and ${JT}`, "Spending. A shop called Singh is not an own transfer and is no relative.",
    { kind: "lines", lines: [s[4], s[Math.floor(s.length / 2)], s[s.length - 6]].map((x) => plain(x, "spending", { n: 1 })) });
}

// ---------- pay: his fortnightly wage with overtime, her casual shifts at two employers, her leave, her return ----------
const PAY = { slips: [] };
const sgRate = (d) => (d < "2024-07-01" ? 11 : d < "2025-07-01" ? 11.5 : 12);
function slip(person, name, employer, payDate, from, to, gross, o = {}) {
  const rate = o.rate != null ? o.rate : person === HARPREET ? 0.23 : 0.13, tax = Math.round(gross * rate / 100) * 100, sg = Math.round(gross * sgRate(payDate) / 100), net = gross - tax;
  const s = { person, name, employer, payDate, from, to, gross, tax, super: sg, net, fy: fyOf(payDate), ...o };
  PAY.slips.push(s); count("payslip");
  return s;
}
const WAGES = { h: [], s: [], l: [] };
function harpreetPay() {
  const r = rng("harpreet"), split = [];
  const base = (d) => (d < "2024-07-01" ? 320000 : d < "2025-07-01" ? 332000 : 342000);
  for (let d = "2023-07-13"; d <= END; d = addDays(d, 14)) {
    const s = slip(HARPREET, HARPREET, WESTGATE, d, addDays(d, -13), d, base(d) + cents(r, 0, 760), { split: true, bank: JT });
    if (d === "2024-06-27") {
      const x = earn(JT, "2024-07-01", WAGE_H, s.net - 20000, "SALARY"), y = earn(SV, "2024-07-01", WAGE_SAVE, 20000, "SALARY");
      trap("T7-PAY-STRADDLE", "Pay dated in June, banked in July", `Westgate's pay of ${money(s.net)}: payslip 2024-06-27, ${JT} and ${SV} 2024-07-01`, "Cash income lands in July, when the money arrived.",
        { kind: "lines", lines: [plain(x, "income", { month: "2024-07" }), plain(y, "income", { month: "2024-07" })] });
    } else { const a = earn(JT, d, WAGE_H, s.net - 20000, "SALARY"), b = earn(SV, d, WAGE_SAVE, 20000, "SALARY"); WAGES.h.push(a); split.push([a, b]); }
  }
  trap("T7-REG-WAGE", "A fortnightly wage with overtime, a payslip for each", `${JT}: ${WAGES.h.length} Thursdays of "${WAGE_H}", each a different amount`, "Income, every fortnight, with no question. The plainest regular money there is.",
    { kind: "lines", lines: reg(WAGES.h, "income") }, { regular: true });
  trap("T7-NET-PAY-SPLIT", "One payslip, two bank credits", `${split.length} pays: each Westgate net reaches ${JT} less 200.00, and ${SV} 200.00`, "Both credits are that one pay. Cash income is the net once.",
    { kind: "lines", lines: [split[2], split[30], split[60]].flatMap(([a, b]) => [plain(a, "income"), plain(b, "income")]) });
  const cl = [line(JT, "2023-11-21", "WESTGATE LINEHAUL TRIP EXP", 18640, {}), line(JT, "2024-06-04", "WESTGATE LINEHAUL TRIP EXP", 24110, {})];
  trap("T7-REIMB", "An employer's credit that is not pay", `${JT}: trip expenses paid back by the employer, by name, with no payslip to clear`, "SPEC 4.4c: neither income nor spending, and not a wage. Only the credit is probed.",
    { kind: "lines", lines: cl.map((x) => plain(x, "neither")) });
}
function simranPay() {
  const r = rng("simran");
  for (let d = "2023-07-12"; d <= END; d = addDays(d, 14)) {
    if (d >= LEAVE_FROM && d < BACK_TO_WORK) continue;
    const s = slip(SIMRAN, SIMRANJIT, ARDEER, d, addDays(d, -13), d, cents(r, 1160, 2240), { bank: SM }); WAGES.s.push(earn(SM, d, WAGE_S, s.net, "SALARY"));
  }
  trap("T7-NAME-ON-SLIP", "Her payslips carry her full name, and setup has the one she goes by", `${SM}: ${WAGES.s.length} fortnights. Every slip reads ${SIMRANJIT}, and a person typed ${SIMRAN}`, "Income, each clearing its payslip.",
    { kind: "lines", lines: [WAGES.s[3], WAGES.s[20], WAGES.s[WAGES.s.length - 3]].map((x) => plain(x, "income")) });
  // a second casual job with no payslip ever saved: shifts when they call, so one fortnight can be five times another
  for (let d = "2023-07-07"; d <= LAVERTON_END; d = addDays(d, 14)) { const c = r.pick([18600, 24250, 31180, 47320, 58790, 66140, 79510, 91240]) + r.int(0, 40); WAGES.l.push(earn(SM, d, WAGE_L, c, "SALARY")); }
  trap("T7-REG-CASUAL", "A casual's pay with no payslip: one fortnight five times another", `${SM}: ${WAGES.l.length} fortnights of "${WAGE_L}", ${money(Math.min(...WAGES.l.map((x) => x.cents)))} to ${money(Math.max(...WAGES.l.map((x) => x.cents)))}, from an employer in setup with no slip ever held`, "Income under SALARY, with no question. Casual pay has no usual amount, and a contract that reads only amounts near the usual would ask about the shape of the job.",
    { kind: "lines", lines: reg(WAGES.l, "income", "SALARY") }, { regular: true });
}

// ---------- Services Australia: one agency, several meanings ----------
const ftbOn = (d) => (d < "2024-01-02" ? 15860 : d < "2024-07-02" ? 16240 : d < "2024-11-26" ? 16880 : d < "2025-07-01" ? 38420 : d < "2026-01-01" ? 39260 : 40130);
function benefits() {
  const ftb = [];
  for (let d = "2023-07-04"; d <= END; d = addDays(d, 14)) { ftb.push(earn(JT, d, FTB, ftbOn(d), "x_FTB")); count("ftb"); }
  trap("T7-REG-FTB", "Family Tax Benefit: indexed, and more than doubled when a baby arrives", `${JT}: ${ftb.length} fortnights of "${FTB}", ${money(ftb[0].cents)} to ${money(ftb[ftb.length - 1].cents)}, under a contract a person named, with a category`, "Income under the contract's category, with no question. A step up on a birth is what the contract's money does.",
    { kind: "lines", lines: reg(ftb, "income", "x_FTB") }, { regular: true });
  const tops = [["2023-08-16", 71840, "SERVICES AUSTRALIA FTB TOPUP 7741"], ["2024-08-14", 94035, "SERVICES AUSTRALIA FTB TOPUP 7741"], ["2024-12-03", 64000, "SERVICES AUSTRALIA FTB NEWBORN 7741"], ["2025-08-20", 118720, "SERVICES AUSTRALIA FTB TOPUP 7741"]].map(([d, c, t]) => earn(JT, d, t, c, "x_FTB"));
  trap("T7-FTB-TOPUP", "A once-a-year balancing lump and a newborn payment, beside the tax refund", `${JT}: ${tops.map((x) => `${money(x.cents)} on ${x.date}`).join(", ")}`, "Income. The contract says so, and a lump the same words each August is not a refund.",
    { kind: "lines", lines: tops.map((x) => plain(x, "income")) });
  const debt = line(JT, "2025-09-23", "SERVICES AUSTRALIA DEBT 7741", -41000, { lens: "income", cat: "x_FTB" });
  trap("T7-BENEFIT-DEBT", "An overpaid benefit taken back by a debit", `${JT} ${debt.date}: -410.00. Overtime ran above the estimate`, "A negative in income, as T4-BENEFIT-DEBT read it. It takes a question or a rule.",
    { kind: "lines", lines: [plain(debt, "income")] });
  const backs = [["2023-09-12", 4120], ["2024-02-27", 8635], ["2024-10-15", 4120], ["2025-05-20", 4385], ["2026-02-10", 4385]];
  for (const [d, c] of backs) { spend(JT, addDays(d, -2), "EFTPOS TARNEIT MEDICAL CENTRE", c + 3800, "HEALTH"); line(JT, d, "SERVICES AUSTRALIA MEDICARE 2291", c, { lens: "spending", cat: "HEALTH" }); count("purchase"); }
  trap("T7-MEDICARE-SA", "A Medicare refund beside a benefit from the same agency", `${JT} on ${backs.map((b) => b[0]).join(", ")}`, "Lowers HEALTH spending. Not income, whatever is done for the agency's name.",
    { kind: "lines", lines: backs.map(([d, c]) => ({ account: JT, date: d, cents: c, want: "spending" })) });
  const pl = []; for (let i = 0, d = "2025-01-09"; i < 11; i += 1, d = addDays(d, 14)) pl.push(earn(SM, d, PPL, d < "2025-03-20" ? 158320 : 161140, "x_FTB"));
  trap("T7-PPL", "Parental leave pay, with no payslip, from the agency that pays the family benefit", `${SM}: ${pl.length} fortnights of "${PPL}". The contract in setup is the family benefit, on another account, and nobody mentioned this one`, "Income. Not the contract's money, and not an employer's.",
    { kind: "lines", lines: [pl[0], pl[5], pl[10]].map((x) => plain(x, "income")) });
}

// ---------- money home: one service, many meanings ----------
const REG_REMIT = [];
function remit() {
  const r = rng("remit");
  for (const ym of MONTHS) { const d = nextBiz(`${ym}-05`); if (ym === "2025-05") continue; REG_REMIT.push(spend(JT, d, REMIT_B, cents(r, 350, 900), "x_FAMILY")); count("remittance"); }
  trap("T7-REG-REMIT", "Money home each month, under a contract a person named", `${JT}: ${REG_REMIT.length} months of "${REMIT_B}", between 350.00 and 900.00 as his parents need it`, "Spending under the contract's category, with no question. It is the most regular debit this family has.",
    { kind: "lines", lines: reg(REG_REMIT, "spending", "x_FAMILY") }, { regular: true, fresh: true });
  // his father's heart surgery: far above the usual, and his cousin puts in a third
  const k = line(JT, "2024-08-23", "OSKO FROM K SINGH BAPU JI", 600000, {}), big = spend(JT, "2024-08-26", REMIT_B, 1800000, "x_FAMILY", { part: -1200000 });
  trap("T7-REMIT-LARGE", "A surgery at home: one wire far above the usual, a third of it a cousin's", `${JT}: +6,000.00 from a cousin on ${k.date}, -18,000.00 on ${big.date} through the same service`, "The household's spending is 12,000.00. The cousin's 6,000.00 is neither, on the way in or on the way out. A question over either line is the honest best.",
    { kind: "lines", lines: [plain(big, "spending"), plain(k, "neither")], cap: [{ month: "2024-08", metric: "spending", under: "truth+300000", account: JT, date: big.date, cents: big.cents }] });
  // sent, returned by the service, sent again at a new rate
  const a = spend(JT, "2025-05-05", REMIT_B, 64000, "x_FAMILY"), b = line(JT, "2025-05-09", "WHISKERWIRE RETURNED 6620", 64000, { lens: "spending", cat: "x_FAMILY" }), c = spend(JT, "2025-05-12", REMIT_B, 65520, "x_FAMILY");
  trap("T7-REMIT-BOUNCE", "A transfer home returned by the service and sent again at a new rate", `${JT}: -640.00 on ${a.date}, +640.00 on ${b.date}, -655.20 on ${c.date}`, "The month's support is 655.20. The return cancels the first send. It is no income, and the two sends do not stack.",
    { kind: "lines", lines: [plain(a, "spending"), plain(b, "spending"), plain(c, "spending")] }, { fresh: true, dc: true });
  // his own money to his own rupee account, by the same service, in the same range as the monthly support
  const d = "2024-05-07", paise = Math.round(200000 / FX["2024-05"] * 1000000), o = line(JT, d, "WHISKERWIRE 6620 H SINGH SATLUJ", -200000, {}), i = line(NR, addDays(d, 2), "INWARD REMITTANCE WHISKERWIRE", paise, { aud: 200000 });
  trap("T7-REMIT-OWN", "His own money to his own rupee account, by the service the contract names", `${JT} ${d}: -2,000.00, "${o.desc}". ${NR} ${i.date}: +${money(paise)} rupees. The two sides cannot agree in any unit`, "Neither. An own transfer, on a declared account. Read by the contract's name it is family support, and 2,000.00 of spending that is not.",
    { kind: "lines", lines: [plain(o, "neither"), plain(i, "neither")] }, { fresh: true, dc: true });
  // a cousin with no account for it gives him the money and he sends it with his own
  const sends = [["2024-10-02", 70000], ["2025-02-03", 90000], ["2025-11-03", 60000]].map(([x, v]) => [line(JT, x, "OSKO FROM P DHILLON SEND HOME", v, {}), line(JT, addDays(x, 2), "WHISKERWIRE 6620 P DHILLON MOGA", -v, {})]);
  trap("T7-REMIT-COUSIN", "A friend's money sent home through the household's service", `${JT}: ${sends.length} credits from a friend, each sent on two days later, in the service's usual range, to his father and not theirs`, "Neither, both ways. Read by the contract's name, the debit is family support and spending high, and the credit stands alone.",
    { kind: "lines", lines: sends.flat().map((x) => plain(x, "neither")) }, { fresh: true, dc: true });
  const cb = [["2024-02-13", 2000], ["2025-02-11", 2500]].map(([x, v]) => line(JT, x, "WHISKERWIRE CASHBACK 6620", v, { lens: "spending", cat: "x_FAMILY" }));
  trap("T7-REMIT-CASHBACK", "A small credit from the service the household pays each month", `${JT}: ${cb.map((x) => `${money(x.cents)} on ${x.date}`).join(", ")}`, "Lowers spending. A credit from someone paid every month is a refund, and it runs against the contract's direction.",
    { kind: "lines", lines: cb.map((x) => plain(x, "spending")) }, { fresh: true });
}

// ---------- community, cash and circles ----------
const NAMES = ["J GILL", "M DHILLON", "A BRAR", "P SIDHU", "R KAUR", "T SINGH", "N GREWAL", "B KAUR", "L SANDHU", "D SINGH", "G KAUR", "K BAINS", "V SINGH", "M KAUR", "J SINGH", "A KAUR", "R BRAR", "H GILL", "S DHILLON", "P KAUR"];
function kitty() {
  // ten women, 500.00 a month each, one takes the pot each month. Sukhdeep Kaur runs it, and her line reads as Simran's own name
  const out = [], inn = [];
  for (const [a, b, draw] of [["2024-03", "2024-12", "2024-09"], ["2025-03", "2025-12", "2025-05"]]) { for (const ym of monthRange(a, b)) out.push(line(SM, nextBiz(`${ym}-01`), "OSKO TO S KAUR KITTY", -50000, {})); inn.push(line(SM, nextBiz(`${draw}-08`), "OSKO FROM S KAUR KITTY", 500000, {})); }
  trap("T7-KITTY", "A rotating savings circle: 500.00 a month out, 5,000.00 once back, the organiser's line reading as her own name", `${SM}: ${out.length} debits of 500.00 and ${inn.length} credits of 5,000.00, "OSKO TO S KAUR KITTY". Sukhdeep Kaur runs it for ten women, and nobody mentioned it at onboarding`, "Neither, both ways: her own money going round. As spending and income, 10,000.00 stands on both sides. It takes a question or a rule, and silence scores silently wrong.",
    { kind: "lines", lines: [out[2], out[11], out[18], inn[0], inn[1]].map((x) => plain(x, "neither")) }, { fresh: true, dc: true });
}
function collection() {
  // a driver from the gurdwara dies, and she runs the collection for his widow through her own account
  const r = rng("collection"), inn = NAMES.slice(0, 18).map((n, i) => line(SM, addDays("2025-08-18", i % 6), `OSKO FROM ${n} FAMILY FUND`, r.pick([5100, 10100, 10100, 20100, 25100, 50100]), {}));
  const sum = inn.reduce((t, x) => t + x.cents, 0), o = line(SM, "2025-08-29", "OSKO TO R GILL FAMILY FUND", -sum, {});
  trap("T7-COLLECTION", "A community collection through her account, passed on in one payment", `${SM}: ${inn.length} credits from ${inn.length} names in six days, ${money(sum)}, and one debit of the sum on ${o.date}`, "Neither, every line. Not gifts to her, and what goes on is not spending. If the credits sit apart and the debit is spending, the household gave a sum it only carried.",
    { kind: "lines", lines: [...single(inn).slice(0, 4), o].map((x) => plain(x, "neither")) }, { fresh: true, dc: true });
}
function gifts() {
  const r = rng("shagun"), inn = [...NAMES.slice(4, 15), "H SINGH", "S KAUR", "J GILL", "A BRAR"].map((n, i) => earn(SM, addDays("2025-01-19", i % 5), `OSKO FROM ${n} SHAGUN`, n === "H SINGH" ? 35100 : r.pick([5100, 10100, 10100, 20100, 50100]), "GIFT-IN"));
  trap("T7-SHAGUN-IN", "Gifts at a baby's naming: fifteen names in five days", `${SM}: ${inn.length} credits, ${money(inn.reduce((t, x) => t + x.cents, 0))}, each ending in one dollar, the week of the naming`, "Income under GIFT-IN. It takes a question to know that, and a member's surname on one of them must not make it an own transfer.",
    { kind: "lines", lines: single(inn).slice(0, 4).map((x) => plain(x, "income")) }, { fresh: true });
  const wed = spend(SM, "2024-03-04", "OSKO TO J GILL WEDDING", 50100, "GIFTS"), pram = spend(SM, "2024-10-08", "OSKO TO H SINGH PRAM", 24000, "SHOPPING"), stranger = inn.find((x) => x.desc.includes("H SINGH"));
  trap("T7-STRANGER-SINGH", "A mate with a member's own initial and surname, on a line with no pair", `${SM}: -240.00 on ${pram.date}, "OSKO TO H SINGH PRAM", a second-hand pram from Hardeep Singh, and +351.00 from him on ${stranger.date}. Own top-ups on that account read "OSKO FROM H SINGH" and "OSKO TO H SINGH" word for word`, "Spending and income. If the name is proof of an own transfer, the pram and the gift both vanish.",
    { kind: "lines", lines: [plain(pram, "spending"), plain(stranger, "income"), plain(wed, "spending")] });
  const c = spend(JT, "2024-05-14", "OSKO TO R SINGH TOOLS", 25000, "GIFTS"), d = earn(SV, "2024-05-15", "OSKO FROM J SINGH BIRTHDAY", 25000, "GIFT-IN"); count("purchase");
  trap("T7-FALSE-PAIR", "Two unrelated Oskos, one surname, one amount, a day apart, on two own accounts", `${JT} ${c.date} -250.00 to one man; ${SV} ${d.date} +250.00 from another. Half the men they know are Singh`, "Spending and income. If they pair, 250.00 of each vanishes and nothing says so.",
    { kind: "lines", lines: [plain(c, "spending"), plain(d, "income")] });
  const [x, y] = own(SM, "2025-04-14", "OSKO TO H SINGH", JT, "2025-04-14", "OSKO FROM S KAUR", 30000), g = earn(JT, "2025-04-15", "OSKO FROM S KAUR GIFT", 30000, "GIFT-IN");
  trap("T7-SAME-NAME", "Two identical credits a day apart: her own transfer and a friend's gift, one name on both", `${JT}: +300.00 on ${y.date} from ${SM}, +300.00 on ${g.date} from Sukhdeep Kaur for Vaisakhi. ${SM} has one debit`, "One is a transfer and one is income. If both go, 300.00 of income vanishes. If neither pairs, her debit reads as spending.",
    { kind: "lines", lines: [plain(x, "neither"), plain(y, "neither"), plain(g, "income")] });
  // money parked to look good on a sponsor's statements, and handed back
  const a = line(SV, "2024-08-19", "OSKO FROM K SINGH", 2500000, {}), b = line(SV, "2024-11-04", "OSKO TO K SINGH", -2500000, {});
  trap("T7-SHOW-MONEY", "A cousin's money parked on the saver for a sponsor's bank statement, and handed back", `${SV}: +25,000.00 on ${a.date}, -25,000.00 on ${b.date}, eleven weeks apart, no words on either line`, "Neither, both ways. Not a gift and not a purchase. As income in August and spending in November, each month is 25,000.00 out.",
    { kind: "lines", lines: [plain(a, "neither"), plain(b, "neither")] }, { fresh: true, dc: true });
  const cash = earn(JT, "2024-12-19", "CASH DEPOSIT TARNEIT", 950000, "GIFT-IN");
  trap("T7-CASH-GIFT", "A mother's gift banked as cash at a branch, no payer on the line", `${JT} ${cash.date}: +9,500.00. She carried it from Punjab for the baby`, "Income under GIFT-IN. It takes a question to know that.",
    { kind: "lines", lines: [plain(cash, "income")] });
  const lump = spend(JT, "2025-01-20", "OSKO TO TARNEIT GURDWARA NAAM", 210000, "DONATION");
  trap("T7-DONATION-LUMP", "A naming-day gift to the gurdwara, far above the monthly standing amount", `${JT} ${lump.date}: -2,100.00, the party of a 100.00 monthly contract`, "Spending, and a donation. A line far above the contract's price may stay a question. It must not stop being spending.",
    { kind: "lines", lines: [plain(lump, "spending")] }, { fresh: true });
}

// ---------- the people in the house ----------
const BOARD = { all: [] };
function gurjot() {
  const r = rng("gurjot"), tuition = [], wires = [];
  for (let d = "2024-02-16"; d <= GURJOT_OUT; d = addDays(d, 7)) BOARD.all.push(earn(JT, d, "OSKO FROM G SINGH BOARD", d < "2025-02-07" ? 12000 : 15000, "x_BOARD"));
  trap("T7-REG-BOARD", "A brother's board, weekly, up a quarter after a year", `${JT}: ${BOARD.all.length} Fridays of "OSKO FROM G SINGH BOARD", 120.00 then 150.00. A person named the agreement in setup`, "Income under the contract's category, with no question. A rise is not a stranger.",
    { kind: "lines", lines: reg(BOARD.all.filter((x) => x.date !== "2025-04-04"), "income", "x_BOARD") }, { regular: true, fresh: true });
  // the first pays reach Harpreet's account, because Gurjot has no account here yet
  const pays = [["2024-03-08", 61240], ["2024-03-22", 58780], ["2024-04-05", 66410], ["2024-04-19", 52930]].map(([d, c]) => line(JT, d, "BITEPAW DELIVERY PAY G SINGH", c, {}));
  const on = line(JT, "2024-04-26", "OSKO TO G SINGH WAGES", -pays.reduce((t, x) => t + x.cents, 0), {});
  trap("T7-HIS-WAGES", "A brother's first wages, paid to the household's account and handed on", `${JT}: four credits worth ${money(-on.cents)}, "BITEPAW DELIVERY PAY G SINGH", and one debit of the sum on ${on.date}. No employer in setup and no line equal to the debit`, "Neither, all five. A pay word and a member's surname do not make it the household's wage. As income and spending, the sum stands on both sides.",
    { kind: "lines", lines: [pays[0], pays[2], on].map((x) => plain(x, "neither")) }, { fresh: true, dc: true });
  // his father pays the polytechnic through them: a wire, and a BPAY a few days on
  for (const [d, c] of [["2024-02-26", 740000], ["2024-07-22", 740000], ["2025-02-24", 765000], ["2025-07-21", 765000], ["2026-01-12", 382500]]) {
    wires.push(line(SV, addDays(d, -6), TT_B, c + cents(r, 20, 160), {})); tuition.push(line(SV, d, "BPAY WYNDHAM POLYTECHNIC 44120", -c, {}));
  }
  trap("T7-TUITION-THROUGH", "A father pays a polytechnic through the household's saver, a wire and a BPAY at a time", `${SV}: ${wires.length} wires, each followed by a bill for less. Gurjot's tuition, ${money(tuition.reduce((t, x) => t - x.cents, 0))} in all`, "SPEC 4.4c: someone else's money crossing the rails. Neither, both ways.",
    { kind: "lines", lines: [wires[0], wires[3], tuition[0], tuition[3]].map((x) => plain(x, "neither")) });
  const gift = earn(SV, "2024-12-02", TT_B, 150000, "GIFT-IN"), back = line(SV, "2024-10-14", TT_B, 90000, { lens: "spending", cat: "x_FAMILY" });
  trap("T7-INWARD-THREE", "One father, one line of words, three meanings", `${SV}: "${TT_B}" is his son's tuition, a gift of 1,500.00 for the baby on ${gift.date}, and 900.00 of the surgery money sent back on ${back.date}`, "Neither, income and lower spending, on identical words. A question over each is the honest best, and a guess from the first is wrong on the other two.",
    { kind: "lines", lines: [plain(gift, "income"), plain(back, "spending"), plain(wires[1], "neither")] }, { fresh: true, dc: true });
  // a phone on the household's card, paid back at exactly a week's board
  const ph = card(r, "2025-03-29", ["DAVIS RD MOBILES", "TARNEIT"], 15000, null, { lens: null, lag: 1 }), pb = line(JT, "2025-04-04", "OSKO FROM G SINGH PHONE", 15000, {});
  trap("T7-BOARD-LOOKALIKE", "A lodging brother pays back a phone at exactly a week's board", `${JT} ${pb.date}: +150.00, "${pb.desc}", the party, the rail and the amount of his board, on a day with his board as well. ${CC} ${ph.date}: -150.00`, "Neither, both ways. Near the contract's amounts and not the contract's money. A name is not proof: the line's own word says otherwise.",
    { kind: "lines", lines: [plain(pb, "mixed:income,neither"), plain(ph, "neither", { n: 1 })] }, { fresh: true, dc: true });
  const car = line(JT, OLDCAR_SOLD, "OSKO FROM G SINGH CAR", 650000, { capital: true });
  trap("T7-OLD-CAR-SOLD", "The old car sold to the brother, by the rail his board used", `${JT} ${car.date}: +6,500.00, far above any board and after his contract ended. ${OC} is typed in setup at 7,000.00, closed on that day`, "Capital, neither. The car leaves net worth on the day it goes, and the cash is not income or a refund.",
    { kind: "lines", lines: [plain(car, "neither")], group_total: ["2025-11", "2026-06"].map((month) => ({ month, group: "vehicle", want: CAR_VALUE, named: OC })) });
}
function lodger() {
  const rs = [];
  for (let d = LODGER_IN; d <= LODGER_OUT; d = addDays(d, 14)) rs.push(earn(JT, d, "OSKO FROM A PATEL ROOM", d < "2025-08-04" ? 38000 : 42000, "x_BOARD"));
  trap("T7-REG-LODGER", "A lodger's fortnightly rent, under an agreement in setup", `${JT}: ${rs.length} Mondays of "OSKO FROM A PATEL ROOM", 380.00 then 420.00`, "Income under the contract's category, with no question.",
    { kind: "lines", lines: reg(rs, "income", "x_BOARD") }, { regular: true, fresh: true });
  const a = line(JT, LODGER_IN, "OSKO FROM A PATEL BOND", 76000, {}), b = line(JT, LODGER_OUT, "OSKO TO A PATEL BOND REFUND", -76000, {});
  trap("T7-LODGER-BOND", "A lodger's bond at exactly two fortnights' rent, the same party, the same rail", `${JT}: +760.00 on ${a.date}, -760.00 on ${b.date}`, "Neither, both ways. A bond is held and handed back, and the party's contract says nothing about it.",
    { kind: "lines", lines: [plain(a, "neither"), plain(b, "neither")] });
}
function visit() {
  // his mother's sponsored visit: one department, a charge that is spent and a bond that comes back
  const fee = spend(SV, "2024-09-09", "HOME AFFAIRS VISA CHARGE 99120", 19500, "PERSONAL"), bond = line(SV, "2024-11-18", "HOME AFFAIRS VISA BOND 99120", -1000000, {}), cit = spend(SM, "2025-03-11", "HOME AFFAIRS CITIZENSHIP 77104", 56000, "PERSONAL"), back = line(SV, "2026-01-20", "HOME AFFAIRS BOND REFUND 99120", 1000000, {});
  trap("T7-BOND-VISA", "A visa security bond paid to a department, and returned fourteen months later", `${SV}: -10,000.00 on ${bond.date} and +10,000.00 on ${back.date}, beside a visa charge and a citizenship fee from the same department that are spent for good`, "The bond is neither, both ways, and the fees are spending. As a purchase and then a refund, spending is 10,000.00 high one month and 10,000.00 low fourteen months on, and every total nets to nothing.",
    { kind: "lines", lines: [plain(bond, "neither"), plain(back, "neither"), plain(fee, "spending"), plain(cit, "spending")] }, { fresh: true, dc: true });
  const cover = []; for (const ym of monthRange("2024-12", "2025-12")) cover.push(spend(JT, nextBiz(`${ym}-18`), "DIRECT DEBIT BUPAW VISITOR COVER 1180", 24500, "HEALTH"));
  const hosp = spend(JT, "2025-05-06", "BPAY WERRIBEE PLAINS HOSPITAL 4412", 185000, "HEALTH"), cl = line(JT, "2025-05-27", "BUPAW CLAIM OVC-7719", 164000, { lens: "spending", cat: "HEALTH" });
  trap("T7-VISITOR-CLAIM", "A health fund pays a hospital bill for a visitor: a credit above any premium ever paid", `${JT}: -1,850.00 to a hospital on ${hosp.date}, +1,640.00 from Bupaw on ${cl.date}. The largest premium is under 400.00`, "Lowers HEALTH spending. Not income, and it is a real recovery.",
    { kind: "lines", lines: [plain(hosp, "spending"), plain(cl, "spending"), plain(cover[3], "spending")] });
}

// ---------- the rupee account, in rupees ----------
const RUPEE = { rent: [], atm: [] };
function rupee() {
  const r = rng("rupee");
  for (const ym of MONTHS) if (Number(ym.slice(5)) % 3 === 0) { const d = nextBiz(`${ym}-${pad(r.int(24, 27))}`), p = 7290000 + (ym >= "2025-01" ? 405000 : 0); RUPEE.rent.push(line(NR, d, "RENT CREDIT FLAT 3B MOHALI", p, { lens: "income", cat: "RENT-INC", aud: toAud(p, d) })); count("foreign_rent"); }
  for (const d of ["2023-09-30", "2024-03-31", "2024-09-30", "2025-03-31", "2025-09-30", "2026-03-31"]) { const p = r.int(1400000, 2600000); line(NR, d, "INTEREST PAID", p, { lens: "income", cat: "INTEREST", aud: toAud(p, d) }); }
  for (const d of ["2024-02-14", "2025-02-13", "2026-02-12"]) { const p = -r.int(1200000, 1600000); line(NR, d, "BILLDESK MOHALI MC PROPERTY TAX", p, { lens: "spending", cat: "RENT-OTHER", aud: toAud(p, d) }); }
  // two trips home, one at Christmas 2023 and one in January 2026: cash from his own account, in rupees
  for (const [d, p] of [["2023-12-22", 2000000], ["2023-12-27", 2500000], ["2024-01-03", 1500000], ["2026-01-08", 3000000], ["2026-01-12", 2000000]]) RUPEE.atm.push(line(NR, d, "ATM CASH MOGA", -p, { lens: "spending", cat: "HOLIDAYS", aud: -toAud(p, d) }));
  const sale = line(NR, LAND_SOLD, "RTGS SALE PLOT 114 MOGA", 450000000, { capital: true, aud: toAud(450000000, LAND_SOLD) }), wd = "2025-09-22", p = 400000000, out = line(NR, wd, "OUTWARD REMITTANCE AUD SAVER", -p, { aud: -toAud(p, wd) }), inn = line(SV, "2025-09-25", "INWARD TT SATLUJ VALLEY BANK", toAud(p, wd) - 4500, {});
  RUPEE.sale = sale; RUPEE.out = out; RUPEE.inn = inn;
  trap("T7-INR-WIRE", "His own rupees wired home to his own saver: two amounts in two currencies", `${NR} ${wd}: -${money(p)} rupees. ${SV} ${inn.date}: +${money(inn.cents)} dollars, "${inn.desc}"`, "Neither, both ways. Own money moving. The two sides cannot agree in any unit, and it is no income on the saver.",
    { kind: "lines", lines: [plain(out, "neither"), plain(inn, "neither")] });
}

// ---------- the home loan ----------
const RATES = [["2023-07-01", "6.39"], ["2025-02-20", "6.14"], ["2025-05-22", "5.89"], ["2025-08-14", "5.64"]];
const rateOn = (d) => RATES.filter((x) => x[0] <= d).pop()[1];
const payOn = (d) => (d < "2025-03-07" ? 142000 : d < "2025-06-06" ? 138600 : d < "2025-09-05" ? 135400 : 132300);
const HOME_OPEN = 52000000, LOANS = { moves: [], rows: [] };
const HOMETEXT = `WESTPAW HOME LOAN ${NUM.home.replace(/ /g, "")}`;
function homeRepayments() {
  const reps = [];
  for (let d = "2023-07-07"; d <= END; d = addDays(d, 14)) {
    const c = payOn(d);
    if (d === "2024-08-16") {
      const x = spend(JT, d, HOMETEXT, c, "MORTGAGE"), y = line(JT, addDays(d, 3), `DISHONOUR REVERSAL ${HOMETEXT}`, c, { lens: "spending", cat: "MORTGAGE" }), z = spend(JT, addDays(d, 3), "DISHONOUR FEE", 900, "FEES"), w = spend(JT, addDays(d, 6), HOMETEXT, c, "MORTGAGE");
      trap("T7-DISHONOUR", "A home loan debit that bounces and is re-presented", `${JT}: ${x.date}, reversed ${y.date} with a 9.00 fee, debited again ${w.date}. The lender shows one repayment`, "The reversal cancels the first debit: the repayment counts once, the fee once, nothing is income.",
        { kind: "lines", lines: [plain(y, "spending"), plain(x, "spending"), plain(w, "spending"), plain(z, "spending")] });
      LOANS.moves.push({ date: addDays(d, 6), cents: c });
    } else { reps.push(spend(JT, d, HOMETEXT, c, "MORTGAGE")); LOANS.moves.push({ date: d, cents: c }); }
    count("loan_repayment");
  }
  trap("T7-REG-LOAN", "A home loan repayment that moves with each rate cut", `${JT}: ${reps.length} fortnights of "${HOMETEXT}", ${money(reps[0].cents * -1)} down to ${money(reps[reps.length - 1].cents * -1)}`, "Spending at its cash amount under MORTGAGE, by SPEC 6.5, with no question.",
    { kind: "lines", lines: reg(reps, "spending", "MORTGAGE") }, { regular: true, fresh: true });
  const lump = spend(SV, "2025-11-03", `${HOMETEXT} LUMP`, 6000000, "MORTGAGE"); LOANS.moves.push({ date: lump.date, cents: 6000000 });
  trap("T7-EXTRA-REPAY", "A lump repayment from a different account, with the plot's money", `${SV} ${lump.date}, 60,000.00 to the home loan; the usual debit comes from ${JT}`, "Spending at its cash amount under MORTGAGE, by SPEC 6.5, and the loan falls by it.",
    { kind: "lines", lines: [plain(lump, "spending")], balances: [{ account: HL, months: ["2025-12", "2026-06"] }] });
}
function homeInterest() {
  let bal = -HOME_OPEN, accrued = 0;
  const mv = new Map(); for (const m of LOANS.moves) { if (!mv.has(m.date)) mv.set(m.date, []); mv.get(m.date).push(m); }
  for (const ym of MONTHS) {
    const open = bal; let paid = 0;
    for (let d = `${ym}-01`; d <= monthEnd(ym); d = addDays(d, 1)) {
      for (const m of mv.get(d) || []) { bal += m.cents; paid += m.cents; line(HL, d, "Repayment", m.cents, {}); }
      accrued += Math.abs(bal) * Number(rateOn(d)) / 100 / 365;
    }
    const c = Math.round(accrued); accrued = 0; bal -= c; line(HL, monthEnd(ym), "Interest", -c, {});
    LOANS.rows.push({ ym, rate: rateOn(monthEnd(ym)), open, interest: c, paid, close: bal });
  }
}

// ---------- assets ----------
const VALUES = { home: [] };
function homeValues() {
  const r = rng("values"); let v = 69000000;
  VALUES.home.push(["2023-06-30", v]);
  for (const m of MONTHS) { if (Number(m.slice(5)) % 3 !== 0) continue; v = Math.round(v * (1 + r.range(-0.004, 0.016)) / 100000) * 100000; VALUES.home.push([monthEnd(m), v]); }
}
const lastVal = (list, e) => { const h = list.filter((x) => x[0] <= e); if (!h.length) throw new Error(`no estimate by ${e}`); return h[h.length - 1][1]; };

// ---------- bills, cover, care ----------
const BILLS = { energy: [], water: [], rates: [], policy: [], renewal: [], rego: [], health: [] };
const KIDS = { statements: [] };
function bills() {
  const r = rng("bills"), pows = [];
  for (const q of ["2023-09", "2023-12", "2024-03", "2024-06", "2024-09", "2024-12", "2025-03", "2025-06", "2025-09", "2025-12", "2026-03"]) {
    const winter = ["06", "09"].includes(q.slice(5)), billDate = `${nextMonth(q)}-06`, amt = winter ? cents(r, 640, 980) : cents(r, 260, 430), gst = Math.round(amt / 11), paid = addDays(billDate, 17), b = { billDate, due: addDays(billDate, 21), from: addDays(`${q}-01`, -61), to: monthEnd(q), amt, gst, account: "WP-7730915" };
    BILLS.energy.push(b); pows.push(spend(JT, paid, "BPAY WERRIBEE PLAINS POWER 7730915", amt, "UTILITIES")); count("bill_paid");
  }
  trap("T7-REG-POWER", "A power bill that triples in winter, each one under the contract", `${JT}: ${pows.length} quarters of "BPAY WERRIBEE PLAINS POWER 7730915", ${money(Math.min(...pows.map((x) => -x.cents)))} to ${money(Math.max(...pows.map((x) => -x.cents)))}, and an emailed bill for each`, "Spending under UTILITIES, with no question. Winter is not a stranger.",
    { kind: "lines", lines: reg(pows, "spending", "UTILITIES") }, { regular: true, fresh: true });
  const wat = [];
  for (const q of ["2023-08", "2023-11", "2024-02", "2024-05", "2024-08", "2024-11", "2025-02", "2025-05", "2025-08", "2025-11", "2026-02", "2026-05"]) {
    const usage = cents(r, 90, 210), service = 7400, wb = `${q}-11`, wd = `${q}-27`, b = { billDate: wb, due: wd, from: addDays(wb, -92), to: addDays(wb, -2), usage, service, amt: usage + service };
    BILLS.water.push(b); wat.push(spend(JT, addDays(wd, -1), "BPAY LITTLE RIVER WATER 60331907", b.amt, "UTILITIES")); count("bill_paid");
  }
  for (const [d, n] of [["2023-09-04", 1], ["2024-03-04", 2], ["2024-09-02", 3], ["2025-03-03", 4], ["2025-09-01", 5], ["2026-03-02", 6]]) {
    const amt = 92000 + n * 3100, due = addDays(d, 30), from = d < "2024" || d.slice(5, 7) === "09" ? `${d.slice(0, 4)}-07-01` : `${d.slice(0, 4)}-01-01`, to = from.slice(5, 7) === "07" ? `${d.slice(0, 4)}-12-31` : `${d.slice(0, 4)}-06-30`;
    BILLS.rates.push({ billDate: d, due, from, to, amt, reference: `RI-${d.slice(0, 4)}-${n}`, assessment: NUM.assessment, property: HOME });
    spend(JT, addDays(due, -3), "BPAY WYNDHAM PLAINS RATES 40112", amt, "RATES-HOME"); count("bill_paid");
  }
  for (const [y, amt] of [[2023, 168000], [2024, 184000], [2025, 197000]]) { BILLS.policy.push({ kind: "Home", number: NUM.policyHome, from: `${y}-11-01`, to: `${y + 1}-10-31`, amt, paid: `${y}-10-20`, sum: 62000000, excess: 100000, situ: HOME.split(",")[0], label: "Building sum insured" }); spend(JT, `${y}-10-20`, `BPAY PURRSURE HOME ${NUM.policyHome}`, amt, "HOME-INS"); count("purchase"); }
  const mot = []; for (const [y, amt] of [[2023, 98000], [2024, 124000], [2025, 131000]]) { BILLS.renewal.push({ kind: "Motor", number: NUM.policyMotor, from: `${y}-08-01`, to: `${y + 1}-07-31`, amt, paid: `${y}-07-25`, sum: 2600000, excess: 80000, situ: "The Hyundai", label: "Agreed value" }); mot.push(spend(JT, `${y}-07-25`, `BPAY PURRSURE MOTOR ${NUM.policyMotor}`, amt, "CAR")); count("purchase"); }
  trap("T7-REG-MOTOR", "A car premium up by a quarter in a year, as every household's was", `${JT}: ${mot.map((x) => money(-x.cents)).join(", ")}, once a year, each with a renewal notice`, "Spending under the contract's category, with no question. A premium rise is what insurers did.",
    { kind: "lines", lines: reg(mot, "spending", "CAR") }, { regular: true, fresh: true });
  const prem = (d) => (d < "2024-04-01" ? 32400 : d < "2025-04-01" ? 33500 : 34600), hl = [];
  for (const ym of MONTHS) { const d = nextBiz(`${ym}-16`), x = spend(JT, d, "DIRECT DEBIT BUPAW HEALTH 7741", prem(d), "HEALTH"); hl.push(x); count("purchase"); }
  for (const fy of [2024, 2025, 2026]) { const ls = hl.filter((x) => fyOf(x.date) === fy); BILLS.health.push({ fy, premium: ls.reduce((t, x) => t - x.cents, 0), rebate: Math.round(ls.reduce((t, x) => t - x.cents, 0) * 0.2) }); }
  trap("T7-REG-HEALTH", "A private health premium by the month, and a statement of the year over it", `${JT}: ${hl.length} debits of about 330.00, up each April, beside the visitor cover from the same fund`, "Spending at each debit under the contract's category, with no question. The statement is a witness and adds nothing.",
    { kind: "lines", lines: reg(hl, "spending", "HEALTH") }, { regular: true });
  const reg_ = []; for (const y of [2023, 2024, 2025]) { const issue = `${y}-08-12`, due = `${y}-09-09`, amt = 84400 + (y - 2023) * 2600; BILLS.rego.push({ number: NUM.rego, vehicle: "Hyundai wagon", issue, due, until: `${y + 1}-09-09`, amt, ref: `RN-${y}-1102` }); reg_.push(spend(JT, addDays(due, -4), `BPAY VICPAWS REGO ${NUM.rego}`, amt, "CAR")); count("bill_paid"); }
  trap("T7-BILL-WITNESS", "A water bill, a rego notice and the bank lines that pay them", `${JT}: ${money(-wat[3].cents)} on ${wat[3].date}, ${money(-reg_[1].cents)} on ${reg_[1].date}`, "Spending once. Each bill clears against its line.", { kind: "lines", lines: [plain(wat[3], "spending", { n: 1 }), plain(reg_[1], "spending", { n: 1 })] });
  const dn = []; for (const ym of MONTHS) { const d = nextBiz(`${ym}-02`); dn.push(spend(JT, d, "DIRECT DEBIT TARNEIT GURDWARA 5518", d < "2025-01-01" ? 10000 : 12000, "DONATION")); }
  trap("T7-REG-DONATION", "A standing monthly gift to the gurdwara, under a subscription in setup", `${JT}: ${dn.length} months of "DIRECT DEBIT TARNEIT GURDWARA 5518"`, "Spending under DONATION, with no question.",
    { kind: "lines", lines: reg(dn, "spending", "DONATION") }, { regular: true, fresh: true });
  // after-school care: a little in term, three times as much in the school holidays
  const kr = rng("kids"), gaps = [];
  for (const ym of MONTHS) {
    if (ym.slice(5) === "01") continue;
    const hols = ["04", "07", "09", "10"].includes(ym.slice(5)), days = hols ? kr.int(12, 16) : kr.int(5, 9), gross = days * (hols ? 7200 : 3650), subsidy = Math.round(gross * 0.6), gap = gross - subsidy;
    KIDS.statements.push({ ym, child: ANAYA, days, gross, subsidy, gap }); gaps.push(spend(JT, nextBiz(`${nextMonth(ym)}-09`), "KITTENHOOD OSHC TARNEIT 5512", gap, "CHILDCARE")); count("childcare_gap");
  }
  trap("T7-REG-CHILDCARE", "After-school care: the gap moves with the school term", `${JT}: ${gaps.length} monthly gaps, ${money(Math.min(...gaps.map((x) => -x.cents)))} to ${money(Math.max(...gaps.map((x) => -x.cents)))}; each statement shows the gross and the subsidy, which no account sees`, "Spending is the gap, once, under CHILDCARE, with no question. The subsidy is neither income nor a cash line.",
    { kind: "lines", lines: reg(gaps, "spending", "CHILDCARE") }, { regular: true });
}

// ---------- super ----------
const SUPER = { paul: [], dee: [] };
function superFunds() {
  const r = rng("super");
  const sumFor = (who, emp, from, to) => PAY.slips.filter((s) => s.person === who && s.employer === emp && s.payDate >= from && s.payDate <= to).reduce((t, s) => t + s.super, 0);
  // his fund: the guarantee a quarter behind, and the annual statement over it
  const list = [];
  for (const [d, from, to] of [["2023-10-24", "2023-07-01", "2023-09-30"], ["2024-01-25", "2023-10-01", "2023-12-31"], ["2024-04-24", "2024-01-01", "2024-03-31"], ["2024-07-24", "2024-04-01", "2024-06-30"], ["2024-10-24", "2024-07-01", "2024-09-30"], ["2025-01-24", "2024-10-01", "2024-12-31"], ["2025-04-24", "2025-01-01", "2025-03-31"], ["2025-07-24", "2025-04-01", "2025-06-30"], ["2025-10-24", "2025-07-01", "2025-09-30"], ["2026-01-23", "2025-10-01", "2025-12-31"], ["2026-04-24", "2026-01-01", "2026-03-31"]]) { const c = sumFor(HARPREET, WESTGATE, from, to); list.push({ date: d, type: "employer", desc: "SG contribution Westgate Linehaul", cents: c }); list.push({ date: d, type: "contributions_tax", desc: "Contributions tax", cents: -Math.round(c * 0.15) }); }
  let bal = OPEN[SH]; const out = [];
  for (const ym of MONTHS) {
    for (const x of list.filter((l) => ymOf(l.date) === ym)) { bal += x.cents; out.push({ ...x, balance: bal }); }
    const e = monthEnd(ym), earned = Math.round(bal * r.range(-0.009, 0.015)); bal += earned; out.push({ date: e, type: "earnings", desc: "Investment earnings", cents: earned, balance: bal });
    bal -= 840; out.push({ date: e, type: "fee", desc: "Administration fee", cents: -840, balance: bal }); bal -= 1460; out.push({ date: e, type: "insurance", desc: "Insurance premium", cents: -1460, balance: bal });
  }
  SUPER.paul = out; for (const x of out) line(SH, x.date, x.desc, x.cents, { superType: x.type });
  // her fund: monthly while she worked, nothing while she cared for her mother, and a spouse contribution from the savings account
  const dl = [];
  for (const ym of MONTHS) { const prev = monthRange("2023-06", ym).slice(-2)[0]; const c = sumFor(SIMRAN, ARDEER, `${prev}-01`, monthEnd(prev)) + WAGES.l.filter((x) => ymOf(x.date) === prev).reduce((t, x) => t + Math.round(x.cents * 0.12), 0); if (c) { dl.push({ date: `${ym}-14`, type: "employer", desc: "SG contribution Ardeer and Laverton", cents: c }); dl.push({ date: `${ym}-14`, type: "contributions_tax", desc: "Contributions tax", cents: -Math.round(c * 0.15) }); } }
  const sp = line(SV, "2025-06-20", "BPAY PURRANNUATION SPOUSE 40221", -300000, {});
  dl.push({ date: "2025-06-24", type: "spouse", desc: "Spouse contribution", cents: 300000 });
  B.transit.push({ from: sp.date, until: "2025-06-24", cents: 300000 });
  let m = OPEN[SK]; const mo = [];
  for (const ym of MONTHS) {
    for (const x of dl.filter((l) => ymOf(l.date) === ym).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))) { m += x.cents; mo.push({ ...x, balance: m }); }
    const e = monthEnd(ym), earned = Math.round(m * r.range(-0.011, 0.017)); m += earned; mo.push({ date: e, type: "earnings", desc: "Investment earnings", cents: earned, balance: m });
    m -= 620; mo.push({ date: e, type: "fee", desc: "Administration fee", cents: -620, balance: m });
  }
  SUPER.dee = mo; for (const x of mo) line(SK, x.date, x.desc, x.cents, { superType: x.type });
  trap("T7-PERSONAL-SUPER", "A spouse contribution to super by BPAY, on a line type no public recipe names", `${SV} ${sp.date}: -3,000.00, "${sp.desc}". ${SK}: +3,000.00 four days later, transaction type "Spouse Contribution", which purrannuation-csv-v1 sends to other`, "Own money moving between savings and the fund. Neither spending nor income, and the fund's balance takes it once.",
    { kind: "lines", lines: [plain(sp, "neither")], balances: [{ account: SK, months: ["2025-06", "2025-12"] }] });
}

// ---------- tax, as a person pays it ----------
const TAX = { notices: [] };
function taxes() {
  const sum = (fy, who) => PAY.slips.filter((s) => s.person === who && s.fy === fy).reduce((t, s) => t + s.tax, 0);
  const note = (person, fy, version, lodged, assessed, ti, payg, result) => { const medicare = Math.round(ti * 0.02), gross = Math.max(0, payg - result - medicare); const n = { person, fy, version, lodged, assessed, ti, payg, help: 0, other: 0, gross, medicare, offsets: 0, result }; TAX.notices.push(n); count("tax_assessment"); return n; };
  note(HARPREET, 2023, 1, "2023-10-03", "2023-10-17", 8740000, 1712000, 142000);
  note(HARPREET, 2024, 1, "2024-10-08", "2024-10-22", 8920000, sum(2024, HARPREET), 88000);
  note(HARPREET, 2025, 1, "2025-10-07", "2025-10-21", 9380000, sum(2025, HARPREET), -186000);
  note(SIMRAN, 2023, 1, "2023-08-01", "2023-08-15", 4210000, 506000, 91000);
  note(SIMRAN, 2024, 1, "2024-08-06", "2024-08-20", 4340000, sum(2024, SIMRAN), 64000);
  note(SIMRAN, 2025, 1, "2025-09-02", "2025-09-16", 2960000, sum(2025, SIMRAN), 37000);
  const a = line(JT, "2023-10-20", "ATO EFT REFUND 7720423", 142000, { tax: true }), b = line(SM, "2023-08-18", "ATO EFT REFUND 7720423", 91000, { tax: true }), c = line(SM, "2024-08-23", "ATO EFT REFUND 7720424", 64000, { tax: true }), e = line(JT, "2024-10-25", "ATO EFT REFUND 7720424", 88000, { tax: true }), f = line(SM, "2025-09-19", "ATO EFT REFUND 7720425", 37000, { tax: true });
  trap("T7-TAX-REFUND", "A tax refund", `${JT} ${a.date}, ${e.date} and ${SM} ${b.date}, ${c.date}, ${f.date}, each the figure on its notice`, "Neither income nor spending: TAX-REFUND is a transfer with the tax position.",
    { kind: "lines", lines: [a, b, c, e, f].map((x) => plain(x, "neither")) });
  const plan = ["2025-11-14", "2025-12-12"].map((d) => line(JT, d, "BPAY ATO 551004412339221", -93000, { tax: true })); count("tax_payment", plan.length);
  trap("T7-TAX-BILL", "A notice with a bill on it, paid in two parts", `${JT}: ${plan.length} debits of 930.00 from ${plan[0].date}, against a notice of -1,860.00: rent from the flat is taxable here and nothing was withheld`, "Neither income nor spending, in either part.",
    { kind: "lines", lines: plan.map((x) => plain(x, "neither")) });
}

// ---------- lines that look like each other ----------
function lineTraps() {
  const r = rng("traps");
  const e = card(r, "2025-06-04", ["CANOPY OUTDOOR", "ONLINE"], 18900, "SHOPPING", { lag: 1 }), f = line(SM, "2025-06-13", "CANOPY OUTDOOR REFUND", 18900, { lens: "spending", cat: "SHOPPING" });
  trap("T7-REFUND-STREAM", "A refund that reaches a different stream from the charge", `${CC} ${e.date} -189.00; ${SM} ${f.date} +189.00`, "Lowers SHOPPING spending. Not income, and not a transfer.",
    { kind: "lines", lines: [plain(e, "spending", { n: 1 }), plain(f, "spending")] });
  const auth = card(r, "2024-09-24", ["AIRLINK DELHI", "IN"], 62640, "HOLIDAYS", { posted: "2024-10-02", desc: "AIRLINK DELHI IN USD 412.00", csv: `${"AIRLINK DELHI".padEnd(26)}IN  USD 412.00`, extra: { authCents: 62018, authFile: "2024-07-01" } });
  trap("T7-FX-REPRICE", "A foreign charge whose AUD changes between authorisation and posting", `${CC} ${auth.date}: the download cut 09-30 shows 620.18 pending; the next, which overlaps, shows 626.40 posted 10-02`, "One charge of 626.40.",
    { kind: "lines", lines: [plain(auth, "spending", { n: 1 })], absent: [{ account: CC, date: auth.date, cents: -62018 }] });
  const xm = card(r, "2024-12-23", ["WATTON ST CLOTHING", "WERRIBEE"], 27450, "SHOPPING", { lag: 5 }), xn = card(r, "2025-12-22", ["KOOKABURRA HOMEWARES", "TARNEIT"], 16820, "SHOPPING", { lag: 5 });
  trap("T7-HOLIDAY-LAG", "A charge that posts five business days later across Christmas and New Year", `${CC}: ${xm.date} posted ${xm.posted}, ${xn.date} posted ${xn.posted}`, "One purchase, in the month charged.",
    { kind: "lines", lines: [plain(xm, "spending", { n: 1, month: "2024-12" }), plain(xn, "spending", { n: 1, month: "2025-12" })] });
  const wash = card(r, "2024-04-16", ["WERRIBEE WHITEGOODS", "WERRIBEE"], 142800, "SHOPPING", { lag: 2 }); count("purchase");
  BILLS.invoice = { merchant: "Werribee Whitegoods", date: wash.date, item: "Washing machine, 10 kg", cents: 142800, gst: 12982, serial: "WM-22094", until: "2029-04-16", payment: `Card ending ${NUM.card}` };
  trap("T7-INVOICE", "One purchase on a statement, an activity download and a tax invoice", `${CC} ${wash.date}: -1,428.00, a washing machine, posted two business days later, with a PDF tax invoice`, "One purchase. The invoice adds detail and no cost.",
    { kind: "lines", lines: [plain(wash, "spending", { n: 1 })] });
}

// ---------- traps that live in how the files were downloaded ----------
const SM_WINDOWS = [], STATEMENT_MISSING = "2025-08-14";
function quarters(a, b) { const out = []; const ms = monthRange(a, b); for (let i = 0; i < ms.length; i += 3) out.push([`${ms[i]}-01`, monthEnd(ms[i + 2])]); return out; }
function windows() { for (const [from, to] of quarters("2023-07", "2026-06")) SM_WINDOWS.push(from === "2024-10-01" ? ["2024-08-12", to] : [from, to]); }
const STRAY = { lines: [] };
function strayFile() {
  let bal = 141060;
  const add = (d, t, c) => { bal += c; STRAY.lines.push({ date: d, desc: t, cents: c, balance: bal }); };
  add("2025-07-04", "BITEPAW DELIVERY PAY GJ7719", 71240); add("2025-07-11", "OSKO TO H SINGH BOARD GJ7719", -15000); add("2025-07-18", "BITEPAW DELIVERY PAY GJ7719", 68350); add("2025-07-21", "WYNDHAM POLYTECHNIC BOOKS GJ7719", -48000); add("2025-08-01", "BITEPAW DELIVERY PAY GJ7719", 70410); add("2025-08-08", "OSKO TO G SINGH CAR FUND GJ7719", -100000); add("2025-08-29", "HARBOUR INTEREST GJ7719", 1120); add("2025-09-12", "BITEPAW DELIVERY PAY GJ7719", 69830);
  trap("T7-STRAY-FILE", "A quarter of his brother's bank file, saved under the household's saver with the same bank and the same layout", `sources/${SV}: one Harbour CSV of ${STRAY.lines.length} lines, July to September 2025, on account ${NUM.gurjot}. That number is in no alias. ${SV} is open and takes a file of its own that quarter, under the same name with (1) after it`, "None of it is the household's. A file for an account nobody declared must not reach income, spending, a balance or a pairing. Being left unposted, or held with a question, is right.",
    { kind: "lines", stray: { match: "GJ7719" }, absent: [{ account: SV, date: "2025-07-21", cents: -48000 }], balances: [{ account: SV, months: ["2025-07", "2025-09"] }] }, { dc: true });
}
function fileTraps() {
  const over = B.lines.filter((x) => x.acct === SM && x.date >= "2024-08-12" && x.date <= "2024-09-30").sort(byTime);
  const uniq = over.filter((x) => !over.some((y) => y !== x && y.date === x.date && y.cents === x.cents));
  trap("T7-OFX-OVERLAP", "Two overlapping OFX downloads whose FITIDs are renumbered in each file", `${SM}: the file from 2024-08-12 overlaps the September quarter by ${over.length} lines, the same line under a different FITID in each`, "One line each, and the account follows.",
    { kind: "lines", lines: uniq.slice(0, 6).map((x) => plain(x, x.lens || "neither", { n: 1 })), balances: [{ account: SM, months: ["2024-09", "2024-10"] }] });
  const hole = B.lines.filter((x) => x.acct === JT && x.date >= TRUNC_FROM && x.date <= TRUNC_TO);
  trap("T7-TRUNCATED", "A download cut short, on an account with a running balance", `${JT}: the December quarter's file stops at 2025-10-13. ${hole.length} lines worth ${money(hole.reduce((t, x) => t + x.cents, 0))} are in no file, and the next file's first running balance is honest`, "The engine cannot know the lines. It must say the balance does not chain, for that account and that month.",
    { kind: "hole", account: JT, month: "2025-10", net_cents: hole.reduce((t, x) => t + x.cents, 0), line_count: hole.length, match: /2025-1[01]|2026-01/.source });
  const lagged = B.lines.filter((x) => x.acct === CC && x.cents < 0 && x.posted && x.posted !== x.date), lagDays = {};
  for (const x of lagged) { const d = dayDiff(x.date, x.posted); lagDays[d] = (lagDays[d] || 0) + 1; }
  trap("T7-POSTING-LAG", "Every card line in two files, dated differently", `${CC}: ${lagged.length} lines post after they are charged, by ${Object.entries(lagDays).map(([d, n]) => `${d} days (${n})`).join(", ")}. The monthly statement, cut on the 14th, shows the charge date; the quarterly activity file the posting date`, "One purchase, two witnesses, whatever the gap. A line the engine cannot match across files is asked about, not counted twice in silence.",
    { kind: "card_lag", account: CC, lagged: lagged.length, by_days: lagDays });
  const cross = B.lines.filter((x) => x.acct === CC && x.lens === "spending" && x.date >= START && x.cents < 0 && x.posted && ymOf(x.posted) !== ymOf(x.date)).sort(byTime);
  trap("T7-DATE-BASIS", "A card charge dated in one month, posted in the next", `${CC}: ${cross.length} lines. Budgets read the charge date. Six sampled`, "SPEC 6.5: a purchase counts when charged, and it is one line.",
    { kind: "lines", lines: [0, 1, 2, 3, 4, 5].map((i) => { let j = Math.floor(i * cross.length / 6); while (posted(cross[j]) >= "2025-07-15" && posted(cross[j]) <= STATEMENT_MISSING) j += 1; return cross[j]; }).map((x) => plain(x, "spending", { n: 1, month: ymOf(x.date) })) });
  trap("T7-STATEMENT-GAP", "A card statement never downloaded", `The statement closing ${STATEMENT_MISSING} is missing`, "The lines stay, on their posting dates. Coverage names the missing statement.",
    { kind: "gap", stream: "STM-CARD", month: STATEMENT_MISSING.slice(0, 7) });
  // a husband and wife with no surname in common: only the word OSKO and the amount join these
  const pairs = B.pairs.filter((p) => (p.from === JT && p.to === SM) || (p.from === SM && p.to === JT)), byFrom = (a) => pairs.filter((p) => p.from === a), ok = (p) => !(p.date_out >= TRUNC_FROM && p.date_out <= TRUNC_TO), lines = [...byFrom(JT).filter(ok).filter((p, i) => [1, 12, 30].includes(i)), ...byFrom(SM).filter(ok).slice(0, 2)].flatMap((p) => [{ account: p.from, date: p.date_out, cents: -p.cents, want: "neither" }, { account: p.to, date: p.date_in, cents: p.cents, want: "neither" }]);
  trap("T7-SINGH-KAUR", "A husband and wife with no surname in common, moving money between them", `${pairs.length} own transfers between ${JT} and ${SM}, "OSKO TO S KAUR" against "OSKO FROM H SINGH", and back. No name on one side is the name on the other`, "Own transfers: neither income nor spending. Lines that name a member, on two accounts the household owns, opposite to the cent the same day.",
    { kind: "lines", lines }, { fresh: true, dc: true });
}

// ---------- the card ----------
const CARD = { statements: [] };
function settleCard() {
  let prev = -OPEN[CC];
  for (let start = "2023-06-15"; start <= "2026-06-15";) {
    const ym = nextMonth(start.slice(0, 7)), end = `${ym}-14`;
    const inP = B.lines.filter((x) => x.acct === CC && posted(x) >= start && posted(x) <= end);
    const charges = inP.filter((x) => x.cents < 0).reduce((t, x) => t - x.cents, 0), credits = inP.filter((x) => x.cents > 0).reduce((t, x) => t + x.cents, 0), close = prev + charges - credits;
    CARD.statements.push({ start, end, prev, charges, credits, close, lines: inP.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.seq - b.seq)) });
    const due = nextBiz(addDays(end, 16)), post = bizAfter(due, 1);
    if (due <= END && close > 0) own(JT, due, `AMEWX DIRECT DEBIT ${NUM.card}`, CC, post, "PAYMENT RECEIVED - THANK YOU", close, { posted: post, csv: "PAYMENT RECEIVED - THANK YOU", member: HARPREET });
    prev = close; start = addDays(end, 1);
  }
}
/* each Monday the joint is topped up from the saver or sweeps back to it, and Simran's is topped up from the joint or sweeps into it */
function sweeps() {
  const lowOf = (acct, d) => { let bal = OPEN[acct], low = Infinity, now = OPEN[acct]; for (const x of B.lines.filter((l) => l.acct === acct).sort(byTime)) { bal += x.cents; if (x.date < d) now = bal; if (x.date >= d && x.date <= addDays(d, 8)) low = Math.min(low, bal); } return Math.min(low, now); };
  for (let d = "2023-07-03"; d <= END; d = addDays(d, 7)) {
    if (d === "2024-08-12") continue;  // nobody watches it that week, and the home loan's debit bounces
    { const low = lowOf(JT, d); if (low < 150000) { const c = Math.ceil((400000 - low) / 10000) * 10000; own(SV, d, "OSKO TO EVERYDAY 8842", JT, d, "OSKO FROM H SINGH SAVER", c); } else if (low > 1200000) { const c = Math.floor((low - 700000) / 10000) * 10000; own(JT, d, "OSKO TO SAVER 8806", SV, d, "OSKO FROM EVERYDAY 8842", c); } }
    { const low = lowOf(SM, d); if (low < 60000) { const c = Math.ceil((180000 - low) / 10000) * 10000; own(JT, d, "OSKO TO S KAUR", SM, d, "OSKO FROM H SINGH", c); } else if (low > 400000) { const c = Math.floor((low - 200000) / 10000) * 10000; own(SM, d, "OSKO TO H SINGH", JT, d, "OSKO FROM S KAUR", c); } }
  }
}
function interestCredits() {
  let bal = OPEN[SV];
  for (const ym of MONTHS) { bal += B.lines.filter((x) => x.acct === SV && ymOf(x.date) === ym).reduce((t, x) => t + x.cents, 0); const i = Math.round(bal * 0.04 / 12); if (i > 0) { earn(SV, monthEnd(ym), "INTEREST CREDIT", i, "INTEREST"); bal += i; count("interest_credit"); } }
}

// ---------- truth, from the simulation alone ----------
const OPEN = { [JT]: 420000, [SM]: 180000, [SV]: 5200000, [CC]: -190000, [HL]: -HOME_OPEN, [NR]: 124000000, [SH]: 15800000, [SK]: 3400000 };
const CAR_VALUE = 2600000, OLDCAR_VALUE = 700000, FLAT_VALUE = 12000000, PLOT_VALUE = 6500000;
function chain(acct) { let bal = OPEN[acct] || 0; return B.lines.filter((x) => x.acct === acct).sort(acct === CC ? byPost : byTime).map((x) => { bal += x.cents; x.balance = bal; return x; }); }
function truthBalances() {
  const acctsChain = [JT, SM, SV, CC, NR, HL, SH, SK];
  const chains = {}; for (const a of acctsChain) chains[a] = chain(a);
  const assets = [...acctsChain, HO, FL, PL, CR, OC];
  const balances = {}; for (const a of assets) balances[a] = {};
  for (const m of MONTHS) {
    const e = monthEnd(m);
    for (const a of acctsChain) { const upTo = chains[a].filter((x) => (a === CC ? posted(x) : x.date) <= e), last = upTo[upTo.length - 1]; balances[a][m] = last ? last.balance : OPEN[a] || 0; }
    balances[HO][m] = lastVal(VALUES.home, e); balances[FL][m] = FLAT_VALUE; balances[PL][m] = e < LAND_SOLD ? PLOT_VALUE : 0; balances[CR][m] = CAR_VALUE; balances[OC][m] = e < OLDCAR_SOLD ? OLDCAR_VALUE : 0;
  }
  return { balances, chains, assets };
}
/* traps whose probes read a truth figure, set once the truth is known */
function lateTraps({ balances }, t) {
  const fxMonths = ["2023-12", "2024-12", "2026-06"], over = (m, metric, by) => t[metric][m] + by;
  trap("T7-INR-BALANCE", "A rupee account whose file reads clean as dollars", `${NR}: a file with the same five columns as a public Australian recipe, in rupees, and account currency INR in setup. ₹${money(balances[NR]["2023-12"])} at December 2023 is about A$${money(toAud(balances[NR]["2023-12"], "2023-12-31"))}. No rate is on any file`, "SPEC 6.6: it counts at face value and says so until a dated rate exists. Its balance in rupees is right. Net worth in dollars is not, and a face value fifty-odd times too large must be said out loud.",
    { kind: "lines", fx_value: fxMonths.map((m) => ({ month: m, account: NR, group: "cash", want: toAud(balances[NR][m], monthEnd(m)), named: NR })) });
  const rent = RUPEE.rent, picks = [rent[0], rent[5], rent[rent.length - 1]];
  trap("T7-INR-RENT", "Rent in rupees on a cash account: ₹72,900 a quarter, about A$1,330", `${NR}: ${rent.length} quarters of "RENT CREDIT FLAT 3B MOHALI", in rupees, on an account in the cash group`, "Income at its dollar value. Read at face, one quarter's rent is more than the household's income for the quarter, and the income line is wrong by fifty-odd times.",
    { kind: "lines", lines: picks.map((x) => plain(x, "income")), cap: picks.map((x) => ({ month: ymOf(x.date), metric: "income", under: over(ymOf(x.date), "income", 1000000), account: NR, date: x.date, cents: x.cents })) }, { fresh: true, dc: true });
  const atm = RUPEE.atm;
  trap("T7-INR-SPEND", "Cash drawn in rupees on a trip home", `${NR}: ${atm.length} lines of "ATM CASH MOGA", ₹15,000 to ₹30,000 each`, "Spending at its dollar value. Read at face, a week at home costs a year's groceries.",
    { kind: "lines", lines: atm.slice(0, 3).map((x) => plain(x, "spending")), cap: [atm[0], atm[3]].map((x) => ({ month: ymOf(x.date), metric: "spending", under: over(ymOf(x.date), "spending", 1000000), account: NR, date: x.date, cents: x.cents })) }, { fresh: true, dc: true });
  const s = RUPEE.sale;
  trap("T7-INR-LAND", "A plot in Punjab sold: ₹45,00,000 lands on the rupee account", `${NR} ${s.date}: +₹${money(s.cents)}, "${s.desc}", about A$${money(s.aud)}. ${PL} is typed in setup at ${money(PLOT_VALUE)}, closed that day`, "Capital, neither. Read at face it is four and a half million dollars of income in one month.",
    { kind: "lines", lines: [plain(s, "neither")], cap: [{ month: ymOf(s.date), metric: "income", under: over(ymOf(s.date), "income", 2000000), account: NR, date: s.date, cents: s.cents }], group_total: ["2025-09", "2026-06"].map((month) => ({ month, group: "property", want: balances[HO][month] + FLAT_VALUE, named: PL })) }, { fresh: true, dc: true });
}
function truth(t) {
  const { balances, chains, assets } = t;
  const income = {}, spending = {}, byCat = {}, networth = {}, transit = {};
  for (const m of MONTHS) { income[m] = 0; spending[m] = 0; byCat[m] = {}; }
  for (const x of B.lines) {
    const m = ymOf(x.date); if (!(m in income) || !x.lens) continue;
    if (!CASH.includes(x.acct)) throw new Error(`lens on a non-cash account ${x.acct}`);
    const c = x.part != null ? x.part : x.aud != null ? x.aud : x.cents;
    if (x.lens === "income") income[m] += c; else { spending[m] -= c; byCat[m][x.cat] = (byCat[m][x.cat] || 0) - c; }
  }
  const aud = (a, m) => (a === NR ? toAud(balances[NR][m], monthEnd(m)) : balances[a][m]);
  for (const m of MONTHS) {
    const e = monthEnd(m);
    transit[m] = B.transit.filter((x) => x.from <= e && x.until > e).reduce((s, x) => s + x.cents, 0);
    networth[m] = assets.reduce((s, a) => s + aud(a, m), 0) + transit[m];
  }
  return {
    household: "Singh-Kaur, fictional, Tarneit VIC", window: [START, END],
    definitions: {
      income: "SPEC 6.5 cash lens: money into reporting-group cash accounts in categories of kind income with cash_lens true, on the day the bank shows it. Wages at the net banked, Family Tax Benefit, parental leave pay, board and lodger's rent, gifts, interest, and rent and interest on the rupee account at the month's rate. An overpayment taken back is a negative in income.",
      spending: "SPEC 6.5 cash lens: money out of cash accounts in expense categories with cash_lens true, net of refunds, Medicare and a fund's claim. Card purchases on the charge date. Loan repayments at their cash amount, the lump included. An ATM withdrawal when it is withdrawn. Rupee lines at the month's rate. Money home is spending, net of what comes back, and the surgery wire counts at the household's two thirds.",
      left_out: "Own transfers, card payments, tax refunds and payments, a spouse super contribution, the rotating savings circle, the community collection, a friend's money sent home, his brother's wages and tuition and phone, the cousin's parked money and his share of the surgery, the visa bond, the lodger's bond, the old car and the plot sold, and every own transfer across currencies.",
      balances: "Month-end, holder's sign, on the posting date, each account in its own currency: the rupee account's balance is in rupees. The home at its latest estimate, the flat, the plot and the cars at the value typed in setup, the plot and the old car leaving on the day they go.",
      networth: "Sum of what members own, in dollars. The rupee account counts at the month's rate, which no household file carries. Plus money in the air between own accounts. Tax position excluded. Money parked with them, the circle's pot and a bond held stand as the files show them: no person would declare a debt for them.",
      one_charge: "A charge in two files is one charge. The statement's amount is the charge where the two disagree, because the statement closes on it.",
    },
    balances, income, spending, spending_by_category: byCat, networth, in_transit: transit, fx: FX,
    counts: B.counts, lines_by_account: Object.fromEntries(Object.entries(chains).map(([a, l]) => [a, l.length])),
    cash_lines: B.lines.filter((x) => CASH.includes(x.acct)).sort(byTime).map((x) => ({ account: x.acct, date: x.date, ...(x.posted && x.posted !== x.date ? { posted: x.posted } : {}), cents: x.cents, what: x.desc, lens: x.lens || "neither", ...(x.cat ? { category: x.cat } : {}), ...(x.xfer ? { own: true } : {}), ...(x.aud != null ? { aud: x.aud } : {}) })),
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
  westpaw: { name: "Westpaw", tagline: "Banking with a wag", color: "#B4231F" },
  pawroll: { name: "Pawroll", tagline: "Payroll with claws", color: "#6A3FA0" },
  myguv: { name: "myGuv", tagline: "Your tax, your paws", color: "#0B6E99" },
  purrsure: { name: "Purrsure", tagline: "Cover for the curious", color: "#C2410C" },
  bupaw: { name: "Bupaw", tagline: "Health cover for the whole family", color: "#0E7C66" },
  vicpaws: { name: "VicPaws", tagline: "Roads, rego and everything with wheels", color: "#23408E" },
  council: { name: COUNCIL, tagline: "Rates and charges, one paw at a time", color: "#2E7D6B" },
  water: { name: WATER },
  hest: { name: "HESTAbby" },
  merchant: { name: "Werribee Whitegoods" },
  guv: { name: "Home Affairs" },
  ww: { name: WW },
  satluj: { name: SATLUJ },
  poly: { name: POLY },
};
const span = (a, b) => `${fmtDate(a)} to ${fmtDate(b)}`;
const R = (label, w = 2) => ({ label, w, align: "right" });
const Lft = (label, w = 2) => ({ label, w });

function pdfPayslip(s, ytd) {
  const d = new Doc({ brand: BR_.pawroll, title: "Payslip", kicker: fmtDate(s.payDate), deflate });
  d.h1(`Payslip for ${s.name}`);
  d.kv([["Employer", s.employer], ["Pay date", fmtDate(s.payDate)], ["Pay period", span(s.from, s.to)]], 3);
  d.h2("This pay");
  d.para(s.employer === WESTGATE ? "Classification: linehaul driver, fortnightly in arrears." : "Classification: personal care worker, casual, fortnightly in arrears.");
  d.para("All amounts are in Australian dollars.");
  const pct = sgRate(s.payDate), rows = [["Ordinary hours, salary", money(s.gross), money(ytd.gross)]];
  if (s.pack) rows.push(["Salary packaged to Pawpack before this figure, to the home loan", money(s.pack), ""]);
  rows.push(["PAYG withholding", `-${money(s.tax)}`, `-${money(ytd.tax)}`], [`Superannuation guarantee (${pct}%)`, money(s.super), money(ytd.super)], [s.split ? `Net pay, to account ending ${NUM.joint.slice(-4)} and ${NUM.save.slice(-4)}` : `Net pay, to account ending ${NUM.sim.slice(-4)}`, money(s.net), ""]);
  d.table([Lft("Item", 6), R("This pay"), R("Year to date")], rows);
  return d.finish();
}
function pdfIncomeStatement(name, employer, fy, ss) {
  const sum = (k) => ss.reduce((t, s) => t + s[k], 0);
  const d = new Doc({ brand: BR_.pawroll, title: `Income statement FY${fy}`, kicker: `FY${fy}, 01 Jul ${fy - 1} to 30 Jun ${fy}`, deflate });
  d.h1(`Income statement for ${name}`);
  d.kv([["Employee", name], ["Payer", employer], ["Issued", fmtDate(`${fy}-07-14`)], ["Status", "Tax ready"], ["Payer ABN", { [WESTGATE]: "61840221907", [ARDEER]: "42718330156" }[employer]], ["Pay frequency", "Fortnightly"]], 3);
  d.h2("Year to 30 June");
  d.table([Lft("Item", 6), R("Amount")], [["Gross payments", money(sum("gross"))], ["Tax withheld", money(sum("tax"))], ["Superannuation guarantee", money(sum("super"))], ["Reportable employer super", "0.00"]]);
  d.h2("Pay by pay");
  d.table([Lft("Pay date", 3), R("Gross"), R("Tax"), R("Super"), R("Net")], ss.map((s) => [fmtDate(s.payDate), money(s.gross), money(s.tax), money(s.super), money(s.net)]), { foot: ["Total", money(sum("gross")), money(sum("tax")), money(sum("super")), money(sum("net"))] });
  return d.finish();
}
function pdfLoan(brand, title, number, product, holder, from, to, rows) {
  const t = (k) => rows.reduce((a, r) => a + r[k], 0);
  const d = new Doc({ brand, title, kicker: span(from, to), deflate });
  d.h1(title);
  d.kv([["Loan number", number], ["Product", product], ["Borrowers", holder], ["Repayments", "Fortnightly"], ["Opening balance", money(-rows[0].open)], ["Interest charged", money(t("interest"))], ["Repayments received", money(t("paid"))], ["Closing balance", money(-rows[rows.length - 1].close)]], 4);
  d.h2("Month by month");
  d.table([Lft("Month", 2), R("Rate", 1), R("Opening"), R("Interest"), R("Repayments"), R("Closing")],
    rows.map((r) => [`${MON[Number(r.ym.slice(5)) - 1]} ${r.ym.slice(0, 4)}`, `${r.rate}%`, money(-r.open), money(r.interest), money(r.paid), money(-r.close)]),
    { foot: ["Total", "", "", money(t("interest")), money(t("paid")), ""] });
  return d.finish();
}
function pdfRateNotice(oldR, newR, effective, issued) {
  const d = new Doc({ brand: BR_.westpaw, title: "Rate change", kicker: `Issued ${fmtDate(issued)}`, deflate });
  d.h1("Your interest rate is changing");
  d.kv([["Loan number", NUM.home], ["Product", "Variable"], ["Account holders", "H Singh"], ["Old rate", `${oldR}% p.a.`], ["New rate", `${newR}% p.a.`], ["Effective date", fmtDate(effective)]], 3);
  d.para("Your minimum repayment does not change unless you ask us to change it.");
  return d.finish();
}
function emlRate(oldR, newR, effective, issued) {
  const text = ["Your interest rate is changing", "Westpaw, banking with a wag", "Hello Harpreet,", `Loan number: ${NUM.home}`, `Old rate: ${oldR}%`, `New rate: ${newR}%`, `Effective date: ${fmtDate(effective)}`, `Notice date: ${fmtDate(issued)}`, "Your minimum repayment does not change unless you ask us to change it."].join("\n");
  return eml({ from: "notices@westpaw.example", to: "harpreet@singh-kaur.example", subject: "Your interest rate is changing", date: issued, id: `wp-${issued}`, text, html: `<p>${text.split("\n").join("</p><p>")}</p>` });
}
function htmlKitten(s) {
  const from = `${s.ym}-01`, to = monthEnd(s.ym), body = `<h1>Statement of account</h1>\n<p>Provider: Kittenhood OSHC Tarneit</p>\n<p>Child: ${s.child}</p>\n<table>${row(["Item", "Detail"], "th")}${row(["Period start", fmtDate(from)])}${row(["Period end", fmtDate(to)])}${row(["Days attended", String(s.days)])}${row(["Gross fee", money(s.gross)])}${row(["Child Care Subsidy", `-${money(s.subsidy)}`])}${row(["Gap you pay", money(s.gap)])}</table>`;
  return page(`Kittenhood statement ${MON[Number(s.ym.slice(5)) - 1]} ${s.ym.slice(0, 4)}`, body);
}
function pdfCard(s) {
  const d = new Doc({ brand: BR_.amewx, title: "Card statement", kicker: span(s.start, s.end), deflate });
  d.h1("Your card statement");
  d.kv([["Account", cardFull()], ["Card member", HARPREET], ["Previous balance", money(s.prev)], ["Payments and credits", money(s.credits)], ["New charges", money(s.charges)], ["New balance", money(s.close)]], 3);
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
  d.kv([["Member", HARPREET], ["Member number", NUM.superH], ["Statement period", span(from, to)], ["Balance then", money(openBal)], ["Balance now", money(closeBal)], ["Option", "Balanced growth"]], 3);
  d.h2("What moved");
  d.table([Lft("Item", 6), R("Amount")], [["Opening balance", money(openBal)], ["Employer contributions", money(sum("employer"))], ["Investment earnings", money(sum("earnings"))], ["Contributions tax", money(-sum("contributions_tax"))], ["Administration fees", money(-sum("fee"))], ["Insurance premiums", money(-sum("insurance"))], ["Closing balance", money(closeBal)]]);
  return d.finish();
}
function pdfNoa(n) {
  const d = new Doc({ brand: BR_.myguv, title: "Notice of assessment", deflate });
  d.h1(n.version > 1 ? "Notice of amended assessment" : "Notice of assessment");
  const rows = [["Name", n.person, "Taxable income", money(n.ti)], ["Financial year", `FY${n.fy}`, "Gross tax", money(n.gross)], ["Date of issue", fmtDate(n.assessed), "Less offsets", money(0)], ["Return lodged", fmtDate(n.lodged), "Medicare levy", money(n.medicare)], ["Version", String(n.version), "HELP repayment", money(n.help)], ["Assessment", `AN-${n.fy}-77204${n.person === HARPREET ? "18" : "19"}`, "PAYG credits", money(n.payg)], ["", "", "Other credits", money(n.other)], ["", "", "Result of this notice", money(n.result)]];
  for (const r of rows) { d.text(MARGIN, d.y, r[0], { size: 9.5 }); d.text(MARGIN + 110, d.y, r[1], { size: 9.5, bold: true }); d.text(320, d.y, r[2], { size: 9.5 }); d.text(d.W - MARGIN, d.y, r[3], { size: 9.5, bold: true, align: "right" }); d.y -= 18; }
  d.para("A refund is paid to the account you nominated in your return.");
  return d.finish();
}
function pdfWater(b) {
  const d = new Doc({ brand: BR_.water, style: "plain", title: "Water bill", deflate });
  d.text(MARGIN, d.y, "Your water bill", { size: 14, bold: true }); d.text(d.W - MARGIN, d.y, `Quarter to ${fmtDate(b.to)}`, { size: 9, align: "right" }); d.y -= 26;
  const rows = [["Account", "LR-60331907", "Water usage", money(b.usage)], ["Property", "Kookaburra Rise", "Service charges", money(b.service)], ["Bill date", fmtDate(b.billDate), "Concession", money(0)], ["Due date", fmtDate(b.due), "Amount due", money(b.amt)], ["Period from", fmtDate(b.from), "", ""], ["Period to", fmtDate(b.to), "", ""]];
  for (const r of rows) { d.text(MARGIN, d.y, r[0], { size: 9.5 }); d.text(MARGIN + 110, d.y, r[1], { size: 9.5, bold: true }); if (r[2]) { d.text(320, d.y, r[2], { size: 9.5 }); d.text(d.W - MARGIN, d.y, r[3], { size: 9.5, bold: true, align: "right" }); } d.y -= 18; }
  d.para("Thank you for paying on time.");
  d.text(MARGIN, d.y, "Pay by", { size: 9.5 }); d.text(MARGIN + 110, d.y, "BPAY biller 60331", { size: 9.5 });
  return d.finish();
}
function pdfRates(b) {
  const d = new Doc({ brand: BR_.council, title: "Rates", kicker: "Notice under the Local Government Act", deflate });
  d.h1("Your rates instalment");
  d.kv([["Assessment number", b.assessment], ["Property", b.property.split(",")[0]], ["Issue date", fmtDate(b.billDate)], ["Due date", fmtDate(b.due)], ["Rating period", span(b.from, b.to)], ["Instalment due", money(b.amt)]], 3);
  d.para(`Instalment notice ${b.reference}`);
  return d.finish();
}
function pdfPolicy(p) {
  const d = new Doc({ brand: BR_.purrsure, title: "Certificate", kicker: `${p.kind} cover`, deflate });
  d.h1("Certificate of currency");
  d.kv([["Policy number", p.number], ["Policy", p.kind], ["Situation", p.situ], ["Insured", HARPREET], ["Period of insurance", span(p.from, p.to)], ["Premium paid", money(p.amt)]], 3);
  d.h2("Cover");
  d.table([Lft("Item", 6), R("Amount")], [[p.label, money(p.sum)], ["Excess", money(p.excess)]]);
  return d.finish();
}
function pdfRenewal(p) {
  const d = new Doc({ brand: BR_.purrsure, title: "Renewal", kicker: `Policy period ${span(p.from, p.to)}`, deflate });
  d.h1(`${p.kind} renewal`);
  d.kv([["Policy number", p.number], ["Insured", "H Singh"], ["Situation", p.situ], ["Issued", fmtDate(addDays(p.paid, -21))], ["Total premium", money(p.amt)], ["Due date", fmtDate(p.paid)], ["Status", `Paid ${fmtDate(p.paid)}`], ["Paid by", "BPAY"]], 4);
  d.h2("Cover");
  d.table([Lft("Item", 6), R("Amount")], [[p.label, money(p.sum)], ["Excess", money(p.excess)]]);
  return d.finish();
}
function pdfBupaw(h) {
  const d = new Doc({ brand: BR_.bupaw, title: "Tax statement", kicker: `Statement for the tax year`, deflate });
  d.h1("Private health insurance statement");
  d.kv([["Member", HARPREET], ["Membership", "BP-7741"], ["Financial year", `FY${h.fy}`], ["Year end", fmtDate(`${h.fy}-06-30`)], ["Rebate tier", "Base tier"], ["Benefit code", "30"]], 3);
  d.h2("Your year");
  d.table([Lft("Item", 6), R("Amount")], [["Your share of premiums paid", money(h.premium)], ["Australian Government rebate received", money(h.rebate)], ["Days covered", "365"]]);
  return d.finish();
}
function pdfRego(x) {
  const d = new Doc({ brand: BR_.vicpaws, title: "Registration renewal", kicker: "Registration renewal notice", deflate });
  d.h1("Your registration is due");
  d.kv([["Registration number", x.number], ["Vehicle", x.vehicle], ["Registered owner", "H Singh"], ["Issue date", fmtDate(x.issue)], ["Due date", fmtDate(x.due)], ["Registered until", fmtDate(x.until)], ["Amount payable", money(x.amt)], ["Pay by", "BPAY"]], 3);
  d.para(`Notice ${x.ref}`);
  return d.finish();
}
function pdfInvoice(x) {
  const d = new Doc({ brand: BR_.merchant, style: "plain", title: "Tax invoice", deflate });
  d.h1("Tax invoice");
  d.kv([["Merchant", x.merchant], ["Invoice date", fmtDate(x.date)], ["Payment", x.payment], ["Product type", "Appliance"], ["Serial number", x.serial], ["Warranty until", fmtDate(x.until)]], 3);
  d.table([Lft("Item", 6), R("Qty", 1), R("Amount", 2)], [[x.item, "1", money(x.cents)]]);
  d.table([Lft("Summary", 6), R("Amount", 2)], [["GST included", money(x.gst)], ["Total paid", money(x.cents)]]);
  return d.finish();
}
function emlEnergy(b) {
  const text = ["Your electricity bill is ready", "Werribee Plains Power, a fictional retailer", "Hello Harpreet,", `Account: ${b.account}`, `Bill date: ${fmtDate(b.billDate)}`, `Due date: ${fmtDate(b.due)}`, `Supply from: ${fmtDate(b.from)}`, `Supply to: ${fmtDate(b.to)}`, `GST included: ${money(b.gst)}`, `Amount due: ${money(b.amt)}`, "Pay by BPAY, biller code 5512.", "Thanks for keeping the lights on."].join("\n");
  return eml({ from: "bills@werribeeplains.example", to: "harpreet@singh-kaur.example", subject: "Your electricity bill is ready", date: b.billDate, id: `wp-${b.billDate}`, text, html: `<p>${text.split("\n").join("</p><p>")}</p>` });
}

function render() {
  const view = (acct, from, to) => { let bal = OPEN[acct] || 0; const seq = B.lines.filter((x) => x.acct === acct).slice().sort(byTime), out = []; for (const x of seq) { bal += x.cents; if (x.date >= from && x.date <= to) out.push({ ...x, balance: bal }); } return out; };
  const before = (acct, d) => (OPEN[acct] || 0) + B.lines.filter((x) => x.acct === acct && x.date < d).reduce((t, x) => t + x.cents, 0);
  const bark = (x) => [dmy(x.date), `${x.cents >= 0 ? "+" : "-"}${fix(Math.abs(x.cents))}`, x.desc, fix(x.balance)];
  const w5 = (x) => [dmy(x.date), x.desc, x.cents > 0 ? fix(x.cents) : "", x.cents < 0 ? fix(x.cents) : "", fix(x.balance)], head5 = ["Date", "Description", "Credit", "Debit", "Balance"];
  const bf5 = (from, bal) => [dmy(from), "BALANCE BROUGHT FORWARD", "0.00", "", fix(bal)];
  const hbHead = ["Bank Account", "Date", "Narrative", "Debit Amount", "Credit Amount", "Balance", "Categories", "Serial"];
  const hbRow = (acct) => (x) => [acct, dmy(x.date), x.desc, x.cents < 0 ? fix(-x.cents) : "", x.cents > 0 ? fix(x.cents) : "", fix(x.balance), x.cents > 0 ? "DEP" : "PAYMENT", ""];
  // the everyday account: Bark's headerless CSV, newest first, quarterly, one file stopping short
  for (const [from, to] of quarters("2023-07", "2026-06")) { const end = from === "2025-10-01" ? addDays(TRUNC_FROM, -1) : to; put(JT, addDays(to, 2), `bark_${from}.csv`, csvLines(view(JT, from, end).reverse().map(bark))); }
  // Simran's account: Wattle's OFX, with one overlap, FITIDs numbered within each file
  for (const [from, to] of SM_WINDOWS) put(SM, addDays(to, 2), `Wattle_${from}.ofx`, ofx({ account: NUM.sim, bankId: "633000", from, to, rows: view(SM, from, to).map((x) => ({ date: x.date, cents: x.cents, desc: x.desc })), closing: before(SM, addDays(to, 1)), asOf: to }));
  // the saver: Harbour's CSV, and his brother's file in its folder under the same name with a browser's (1)
  for (const [from, to] of quarters("2023-07", "2026-06")) put(SV, addDays(to, 2), `Harbour_${from}_${to}.csv`, csvLines([hbHead, ...view(SV, from, to).map(hbRow(NUM.save))]));
  put(SV, "2025-10-02", "Harbour_2025-07-01_2025-09-30 (1).csv", csvLines([hbHead, ...STRAY.lines.map(hbRow(NUM.gurjot))]));
  // the rupee account: the five columns of a public recipe, in rupees, with a brought-forward row
  for (const [from, to] of quarters("2023-07", "2026-06")) put(NR, addDays(to, 3), `Satluj_${from}.csv`, csvLines([head5, bf5(from, before(NR, from)), ...view(NR, from, to).map(w5)]));
  // the card: a monthly statement dated by the charge, a quarterly activity download dated by the post
  chain(CC);
  const cc = B.lines.filter((x) => x.acct === CC).sort(byPost);
  for (const s of CARD.statements) { if (s.end === STATEMENT_MISSING) continue; put("STM-CARD", addDays(s.end, 2), `Amewx_statement_${s.end}.pdf`, pdfCard(s), { issued_on: s.end }); }
  for (const [from, to, day] of quarters("2023-07", "2026-06").map(([f, t], i) => (i === 0 ? ["2023-06-15", t, addDays(t, 3)] : f === "2024-10-01" ? ["2024-09-25", t, addDays(t, 3)] : [f, t === END ? "2026-07-10" : t, addDays(t, 3)]))) {
    const rows = cc.filter((x) => posted(x) >= from && posted(x) <= to).map((x) => ({ d: posted(x), desc: x.csv || x.desc, m: HARPREET, c: x.cents, n: NUM.card }));
    { const a = cc.find((x) => x.authFile === from); if (a) rows.push({ d: a.date, desc: a.csv, m: HARPREET, c: -a.authCents, n: NUM.card }); }
    rows.sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0));
    put(CC, day, `activity_${from}.csv`, csvLines([["Date", "Description", "Card Member", "Account #", "Amount"], ...rows.map((x) => [dmy(x.d), x.desc, x.m.toUpperCase(), `-${x.n}`, money(-x.c).replace(/,/g, "")])]));
  }
  // the home loan: Westpaw's half-yearly statement, rate notices by post and by email
  for (const [a, b] of [["2023-07", "2023-12"], ["2024-01", "2024-06"], ["2024-07", "2024-12"], ["2025-01", "2025-06"], ["2025-07", "2025-12"], ["2026-01", "2026-06"]]) { const from = `${a}-01`, to = monthEnd(b); put("STM-HOMELOAN", addDays(to, 3), `Westpaw_loan_${to}.pdf`, pdfLoan(BR_.westpaw, "Home loan statement", NUM.home, "Variable", "H Singh, S Kaur", from, to, LOANS.rows.filter((m) => m.ym >= a && m.ym <= b)), { issued_on: addDays(to, 1) }); }
  RATES.slice(1).forEach(([eff, r], i) => { const issued = addDays(eff, 3); if (i < 2) put("NOTICE-HOMELOAN", issued, `Westpaw_rate_${eff}.pdf`, pdfRateNotice(RATES[i][1], r, eff, issued), { issued_on: issued }); else put("NOTICE-HOMELOAN", issued, `Westpaw_rate_${eff}.eml`, emlRate(RATES[i][1], r, eff, issued), { issued_on: issued, origin: "email" }); });
  // pay
  const ytd = {};
  for (const s of PAY.slips.slice().sort((a, b) => (a.payDate < b.payDate ? -1 : a.payDate > b.payDate ? 1 : 0))) {
    const k = `${s.person}|${s.employer}|${s.fy}`, y = (ytd[k] = ytd[k] || { gross: 0, tax: 0, super: 0 });
    y.gross += s.gross; y.tax += s.tax; y.super += s.super;
    put(s.person === HARPREET ? "PAY-H" : "PAY-S", s.payDate, `Payslip_${s.employer.split(" ")[0]}_${s.person.split(" ")[0]}_${s.payDate}.pdf`, pdfPayslip(s, y), { issued_on: s.payDate });
  }
  for (const fy of [2024, 2025, 2026]) for (const [who, name, emp] of [[HARPREET, HARPREET, WESTGATE], [SIMRAN, SIMRANJIT, ARDEER]]) {
    const ss = PAY.slips.filter((s) => s.person === who && s.employer === emp && s.fy === fy); if (!ss.length) continue;
    put(who === HARPREET ? "INC-H" : "INC-S", `${fy}-07-14`, `IncomeStatement_FY${fy}_${emp.split(" ")[0]}_${who.split(" ")[0]}.pdf`, pdfIncomeStatement(name, emp, fy, ss), { issued_on: `${fy}-07-14` });
  }
  // super
  const sh = [["2023-07-01", "2023-12-31"], ["2024-01-01", "2024-06-30"], ["2024-07-01", "2024-12-31"], ["2025-01-01", "2025-06-30"], ["2025-07-01", "2025-12-31"], ["2026-01-01", "2026-06-30"]];
  const open = (list, from, base) => { const b = list.filter((x) => x.date < from); return b.length ? b[b.length - 1].balance : base; };
  const V1 = { employer: "Employer Contribution", contributions_tax: "Contributions Tax", fee: "Administration Fee", earnings: "Investment Earnings", spouse: "Spouse Contribution" };
  for (const [from, to] of sh) { const ls = SUPER.dee.filter((x) => x.date >= from && x.date <= to); put(SK, addDays(to, 6), `purrannuation_${from}.csv`, csvLines([["Date", "Transaction Type", "Description", "Amount", "Balance"], ...ls.map((x) => [dmy(x.date), V1[x.type], x.desc, fix(x.cents), fix(x.balance)])])); }
  const CODE = { employer: "SG", contributions_tax: "TAX", fee: "FEE", insurance: "INS", earnings: "EARN" };
  for (const [from, to] of sh) { const ls = SUPER.paul.filter((x) => x.date >= from && x.date <= to), opening = open(SUPER.paul, from, OPEN[SH]); put(SH, addDays(to, 5), `hestabby_${from}.json`, JSON.stringify({ schema: "hestabby.transactions.v2", member: { name: HARPREET, number: NUM.superH }, period: { from, to }, balance: { opening: Number(fix(opening)), closing: Number(fix(ls[ls.length - 1].balance)) }, transactions: ls.map((x) => ({ date: x.date, code: CODE[x.type], label: x.desc, amount: Number(fix(x.cents)), balanceAfter: Number(fix(x.balance)) })) }, null, 1)); }
  for (const fy of [2024, 2025, 2026]) { const from = `${fy - 1}-07-01`, to = `${fy}-06-30`, ls = SUPER.paul.filter((x) => x.date >= from && x.date <= to); put("STM-SUPER-H", `${fy}-07-20`, `Annual_statement_FY${fy}.pdf`, pdfFund(fy, ls, open(SUPER.paul, from, OPEN[SH]), ls[ls.length - 1].balance), { issued_on: `${fy}-07-20` }); }
  // tax
  for (const n of TAX.notices) put(n.person === HARPREET ? "TAX-H" : "TAX-S", n.assessed, `NOA_FY${n.fy}.pdf`, pdfNoa(n), { issued_on: n.assessed });
  // the home's value, bills, cover, health, rego, care
  put("VALUATIONS", "2026-07-01", "pawprice_estimates.csv", csvLines([["Subject", "As At", "Estimate", "Method", "Provider"], ...VALUES.home.map(([d, c]) => [HOME, dmy(d), fix(c), "estimate", "Pawprice"])]));
  for (const b of BILLS.energy) put("BILL-POWER", b.billDate, `bill_${b.billDate}.eml`, emlEnergy(b), { issued_on: b.billDate, origin: "email" });
  for (const b of BILLS.water) put("BILL-WATER", b.billDate, `water_${b.billDate}.pdf`, pdfWater(b), { issued_on: b.billDate });
  for (const b of BILLS.rates) put("BILL-RATES", b.billDate, `rates_${b.billDate}.pdf`, pdfRates(b), { issued_on: b.billDate });
  for (const p of BILLS.policy) put("POLICY-HOME", p.paid, `certificate_${p.from}.pdf`, pdfPolicy(p), { issued_on: p.paid });
  for (const p of BILLS.renewal) put("POLICY-MOTOR", addDays(p.paid, -21), `renewal_${p.from}.pdf`, pdfRenewal(p), { issued_on: addDays(p.paid, -21) });
  for (const h of BILLS.health) put("HEALTH-FUND", `${h.fy}-07-22`, `Bupaw_statement_FY${h.fy}.pdf`, pdfBupaw(h), { issued_on: `${h.fy}-07-22` });
  for (const x of BILLS.rego) put("REGO", x.issue, `rego_${x.number}_${x.issue}.pdf`, pdfRego(x), { issued_on: x.issue });
  put("RECEIPTS", BILLS.invoice.date, "Whitegoods_tax_invoice.pdf", pdfInvoice(BILLS.invoice), { issued_on: BILLS.invoice.date });
  for (const s of KIDS.statements) put("CHILDCARE", `${nextMonth(s.ym)}-02`, `kittenhood_${s.ym}.html`, htmlKitten(s));
  // families of files with no public recipe
  put("VISA-PAPERS", "2024-09-30", "Visa_grant_notice.pdf", pdfBare(BR_.guv, "Visa grant notice", [`Visitor: ${SURJIT}`, "Subclass 600, sponsored family stream, twelve months.", `Sponsor: ${HARPREET}`, "Fictional."]), { issued_on: "2024-09-30" });
  put("VISA-PAPERS", "2024-11-18", "Security_bond_receipt.pdf", pdfBare(BR_.guv, "Security bond receipt", [`Bond of 10,000.00 lodged by ${HARPREET}`, "Refundable when the visitor departs.", "Fictional."]), { issued_on: "2024-11-18" });
  for (const fy of [2024, 2025, 2026]) { put("REMIT-PAPERS", `${fy}-07-10`, `Whiskerwire_year_FY${fy}.pdf`, pdfBare(BR_.ww, "Transfer history", [`Sender: ${HARPREET}`, `Financial year FY${fy}`, "Fictional."]), { issued_on: `${fy}-07-10` }); put("RUPEE-PAPERS", `${fy}-07-12`, `TDS_certificate_FY${fy}.pdf`, pdfBare(BR_.satluj, "Tax deducted at source", [`Account holder: ${HARPREET}`, `Financial year FY${fy}`, "Rent and interest, net of tax deducted.", "Fictional."]), { issued_on: `${fy}-07-12` }); }
  put("RUPEE-PAPERS", LAND_SOLD, "Sale_deed_plot_114.pdf", pdfBare(BR_.satluj, "Sale deed extract", [PLOT, "Consideration paid by RTGS.", "Fictional."]), { issued_on: LAND_SOLD });
  for (const d of ["2024-02-20", "2024-07-16", "2025-02-18", "2025-07-15", "2026-01-06"]) put("TUITION", d, `Fee_statement_${d}.pdf`, pdfBare(BR_.poly, "Fee statement", [`Student: ${GURJOT}`, `Issued ${fmtDate(d)}`, "Semester fees due.", "Fictional."]), { issued_on: d });
}

// ---------- setup: what a person answers at onboarding, in July 2026 ----------
const ON = "2026-07-20T00:00:00Z";
/* The public default categories, as the earlier households listed them, with PASS-THROUGH, SUPER-PENSION and SELLING-COSTS. Three rows by the SPEC 12 rung, because a person would need them: the family benefit, board received, and money home. */
const CATS = `SALARY|Salary and wages|income|Income|1|1;SALARY-ALLOW|Allowances|income|Income|1|1;REIMBURSE|Employer reimbursements|income|Income|1|0;SUPER-EMPLOYER|Employer super|income|Super|0|1;SUPER-SACRIFICE|Salary sacrificed to super|income|Super|0|1;PAYROLL-DED|Post-tax payroll deductions|expense|Income|1|1;INTEREST|Interest earned|income|Income|1|1;DIVIDEND|Dividends and distributions|income|Income|1|1;TRUST-DIST|Trust distributions|income|Income|1|1;ESS-INCOME|Employee share scheme income|income|Income|0|1;CRYPTO-INCOME|Staking and crypto income|income|Income|0|1;SUPER-EARN|Super fund earnings|income|Super|0|1;SUPER-FEES|Super fund fees|expense|Super|0|1;SUPER-INS|Insurance inside super|expense|Super|0|1;SUPER-TAX|Contributions tax|expense|Super|0|1;GIFT-IN|Gifts and inheritances received|income|Income|1|0;RENT-INC|Rent received|income|Property|1|1;MORTGAGE|Home loan repayments|expense|Housing|1|0;HOME-INT|Home loan interest|expense|Housing|0|1;RATES-HOME|Council rates (home)|expense|Housing|1|1;HOME-INS|Home and contents insurance|expense|Housing|1|1;HOME-MAINT|Home maintenance|expense|Housing|1|1;GROCERIES|Groceries|expense|Essentials|1|1;UTILITIES|Energy and water|expense|Essentials|1|1;TELCO|Internet and mobile|expense|Essentials|1|1;TRANSPORT|Fuel and transport|expense|Essentials|1|1;CAR|Car costs|expense|Essentials|1|1;HEALTH|Health|expense|Essentials|1|1;CHILDCARE|Childcare|expense|Essentials|1|1;DINING|Dining and takeaway|expense|Lifestyle|1|1;SUBS|Subscriptions|expense|Lifestyle|1|1;SHOPPING|Shopping|expense|Lifestyle|1|1;KIDS-ACT|Kids activities|expense|Lifestyle|1|1;HOLIDAYS|Holidays and travel|expense|Lifestyle|1|1;GIFTS|Gifts|expense|Lifestyle|1|1;PERSONAL|Personal care|expense|Lifestyle|1|1;RENT-INT|Investment loan interest|expense|Property|1|1;RENT-MGMT|Property management fees|expense|Property|1|1;RENT-RATES|Rental rates and water|expense|Property|1|1;RENT-STRATA|Strata levies|expense|Property|1|1;RENT-INS|Landlord insurance|expense|Property|1|1;RENT-REPAIR|Rental repairs|expense|Property|1|1;RENT-OTHER|Other rental costs|expense|Property|1|1;WORK-EQUIP|Work equipment|expense|Work and giving|1|1;WORK-OTHER|Work registrations and courses|expense|Work and giving|1|1;DONATION|Donations|expense|Work and giving|1|1;FEES|Bank fees and card interest|expense|Fees|1|1;INCOME-TAX|Income tax assessed|expense|Tax|0|1;HELP-INDEX|HELP indexation|expense|Tax|0|1;TAX-REFUND|Tax refunds and payments|transfer|Tax|0|0;TRANSFER|Transfers between own accounts|transfer|Transfers|0|0;CC-PAY|Credit card payments|transfer|Transfers|0|0;UNCAT|Uncategorised|suspense|Uncategorised|1|1;PASS-THROUGH|Money that is someone else's|pass_through|Transfers|0|0;SUPER-PENSION|Super pension|income|Income|1|0;SELLING-COSTS|Selling costs|capital|Capital|0|0;x_FTB|Family payments|income|Income|1|1;x_BOARD|Board and lodgers|income|Income|1|0;x_FAMILY|Money home to family|expense|Family|1|1`;
function setup() {
  const person = (id, name, birth) => ({ party_id: id, kind: "person", name, birth_date: birth });
  const org = (id, name, kind = "organisation") => ({ party_id: id, kind, name });
  const party = [person("PTY-HARPREET", HARPREET, "1986-03-11"), person("PTY-SIMRAN", SIMRAN, "1989-08-21"), person("PTY-ANAYA", ANAYA, "2017-04-19"), person("PTY-REET", REET, BABY), person("PTY-GURJOT", GURJOT, "2001-12-02"), person("PTY-BALWINDER", BALWINDER, "1955-01-30"), person("PTY-SURJIT", SURJIT, "1959-06-03"), person("PTY-AARAV", AARAV, "2002-09-14"),
    org("PTY-WESTGATE", WESTGATE), org("PTY-ARDEER", ARDEER), org("PTY-LAVERTON", LAVERTON), org("PTY-COUNCIL", COUNCIL, "government"), org("PTY-BARK", "Bark Bank"), org("PTY-WATTLE", "Wattle Credit Union"), org("PTY-HARBOUR", "Harbour Bank"), org("PTY-SATLUJ", SATLUJ), org("PTY-AMEWX", "Amewx"), org("PTY-WESTPAW", "Westpaw"), org("PTY-PURRANNUATION", "Purrannuation"), org("PTY-HESTABBY", "HESTAbby"),
    org("PTY-TAX", "myGuv", "government"), org("PTY-SA", SA, "government"), org("PTY-HOMEAFFAIRS", "Home Affairs", "government"), org("PTY-PURRSURE", "Purrsure"), org("PTY-BUPAW", "Bupaw"), org("PTY-VICPAWS", "VicPaws", "government"), org("PTY-POWER", POWER), org("PTY-WATER", WATER), org("PTY-KITTEN", OSHC), org("PTY-WW", WW), org("PTY-GURDWARA", GURDWARA)];
  const membership = [["PTY-HARPREET", "adult", "2014-02-12"], ["PTY-SIMRAN", "adult", "2014-02-12"], ["PTY-ANAYA", "dependant", "2017-04-19"], ["PTY-REET", "dependant", BABY]].map(([party_id, role, valid_from]) => ({ party_id, role, valid_from, recorded_at: ON }));
  const acct = (account_id, name, cls, type, group, inst, extra = {}) => ({ account_id, name, class: cls, type, reporting_group: group, currency: "AUD", ...(inst ? { institution_party_id: inst } : {}), in_scope: true, liquid: group === "cash", fidelity: "ledger", ...extra });
  const account = [
    acct(JT, "Everyday, Bark", "asset", "transaction", "cash", "PTY-BARK"), acct(SM, "Simran's account, Wattle", "asset", "transaction", "cash", "PTY-WATTLE"), acct(SV, "Saver, Harbour", "asset", "savings", "cash", "PTY-HARBOUR"), acct(CC, "Amewx card", "liability", "credit_card", "cash", "PTY-AMEWX"),
    acct(NR, "Rupee account, Satluj Valley Bank", "asset", "savings", "cash", "PTY-SATLUJ", { currency: "INR", liquid: false, note: "In rupees, in Punjab. Rent from the flat lands here." }),
    acct(HL, "Home loan, Westpaw", "liability", "loan", "loans", "PTY-WESTPAW", { contract_id: "CON-HOME", liquid: false }),
    acct(SH, "Harpreet's super, HESTAbby", "asset", "super", "super", "PTY-HESTABBY", { contract_id: "CON-SUPER-H", liquid: false }), acct(SK, "Simran's super, Purrannuation", "asset", "super", "super", "PTY-PURRANNUATION", { contract_id: "CON-SUPER-S", liquid: false }),
    acct(HO, "The home", "asset", "property", "property", null, { asset_id: "AST-HOME", fidelity: "snapshot", liquid: false }),
    acct(FL, "The flat in Mohali", "asset", "property", "property", null, { asset_id: "AST-FLAT", fidelity: "snapshot", liquid: false, opening_balance_cents: FLAT_VALUE, opening_date: START, note: "What we think it is worth, in dollars." }),
    acct(PL, "The plot at Moga", "asset", "property", "property", null, { asset_id: "AST-PLOT", fidelity: "snapshot", closed_on: LAND_SOLD, liquid: false, opening_balance_cents: PLOT_VALUE, opening_date: START, note: "What we think it is worth, in dollars." }),
    acct(CR, "The Hyundai", "asset", "vehicle", "vehicle", null, { asset_id: "AST-CAR", fidelity: "snapshot", liquid: false, opening_balance_cents: CAR_VALUE, opening_date: START, note: "What we think it is worth." }),
    acct(OC, "The old Corolla", "asset", "vehicle", "vehicle", null, { asset_id: "AST-OLDCAR", fidelity: "snapshot", closed_on: OLDCAR_SOLD, liquid: false, opening_balance_cents: OLDCAR_VALUE, opening_date: START, note: "What we think it is worth." }),
  ];
  const asset = [{ asset_id: "AST-HOME", kind: "property", name: HOME, account_id: HO, location: "Tarneit VIC", acquired_on: "2019-03-14" }, { asset_id: "AST-FLAT", kind: "property", name: FLAT, account_id: FL, location: "Mohali, Punjab", acquired_on: "2015-11-02" }, { asset_id: "AST-PLOT", kind: "property", name: PLOT, account_id: PL, location: "Moga, Punjab", acquired_on: "2012-05-20", disposed_on: LAND_SOLD }, { asset_id: "AST-CAR", kind: "vehicle", name: "The Hyundai", account_id: CR }, { asset_id: "AST-OLDCAR", kind: "vehicle", name: "The old Corolla", account_id: OC, disposed_on: OLDCAR_SOLD }];
  const al = (subject_type, subject_id, scheme, value, o = {}) => ({ subject_type, subject_id, scheme, value, valid_from: "2000-01-01", recorded_at: ON, ...o });
  const alias = [al("account", JT, "account_number", NUM.joint), al("account", SM, "account_number", NUM.sim), al("account", SV, "account_number", NUM.save), al("account", NR, "account_number", NUM.rupee), al("account", CC, "card_last4", NUM.card), al("account", SH, "member_number", NUM.superH), al("account", SK, "member_number", NUM.superS), al("account", HL, "loan_number", NUM.home),
    ...[["PTY-HARPREET", HARPREET], ["PTY-SIMRAN", SIMRAN], ["PTY-ANAYA", ANAYA], ["PTY-REET", REET], ["PTY-GURJOT", GURJOT], ["PTY-BALWINDER", BALWINDER], ["PTY-SURJIT", SURJIT], ["PTY-AARAV", AARAV], ["PTY-WESTGATE", WESTGATE], ["PTY-ARDEER", ARDEER], ["PTY-LAVERTON", LAVERTON], ["PTY-COUNCIL", COUNCIL], ["PTY-SA", SA], ["PTY-HOMEAFFAIRS", "Home Affairs"], ["PTY-WW", WW], ["PTY-GURDWARA", GURDWARA], ["PTY-KITTEN", OSHC], ["PTY-POWER", POWER]].map(([id, name]) => al("party", id, "name", name)),
    al("asset", "AST-HOME", "name", HOME), al("asset", "AST-CAR", "name", NUM.rego), al("contract", "CON-HOME", "loan_number", NUM.home), al("contract", "CON-HOME-INS", "policy_number", NUM.policyHome), al("contract", "CON-MOTOR", "policy_number", NUM.policyMotor)];
  const own_ = (subject_type, subject_id, split, o = {}) => ["legal", "beneficial", "tax"].flatMap((basis) => split.map(([party_id, share_bps]) => ({ subject_type, subject_id, party_id, basis, share_bps, valid_from: "2000-01-01", recorded_at: ON, ...o })));
  const him = [["PTY-HARPREET", 10000]], her = [["PTY-SIMRAN", 10000]], both = [["PTY-HARPREET", 5000], ["PTY-SIMRAN", 5000]];
  const ownership = [...[JT, SV, HL, HO].flatMap((a) => own_("account", a, both)), ...[CC, NR, SH, CR, FL, PL].flatMap((a) => own_("account", a, him)), ...[SM, SK, OC].flatMap((a) => own_("account", a, her)), ...own_("asset", "AST-HOME", both), ...own_("asset", "AST-FLAT", him), ...own_("asset", "AST-PLOT", him), ...own_("asset", "AST-CAR", him), ...own_("asset", "AST-OLDCAR", her)];
  const category = CATS.split(";").map((r) => { const [category_id, name, kind, group, c, e] = r.split("|"); return { category_id, name, kind, group, cash_lens: c === "1", economic_lens: e === "1" }; });
  const con = (contract_id, kind, name, counterparty_party_id, holder_party_id, extra = {}) => ({ contract_id, kind, name, counterparty_party_id, holder_party_id, ...extra });
  const contract = [
    con("CON-WESTGATE", "employment", "Harpreet driving for Westgate", "PTY-WESTGATE", "PTY-HARPREET", { category_id: "SALARY", started_on: "2018-05-04" }), con("CON-ARDEER", "employment", "Simran at Ardeer", "PTY-ARDEER", "PTY-SIMRAN", { category_id: "SALARY", started_on: "2021-02-07" }), con("CON-LAVERTON", "employment", "Simran's home care shifts", "PTY-LAVERTON", "PTY-SIMRAN", { category_id: "SALARY", started_on: "2022-02-07", ended_on: LAVERTON_END }),
    con("CON-SUPER-H", "super_fund", "Harpreet's super", "PTY-HESTABBY", "PTY-HARPREET", { account_id: SH }), con("CON-SUPER-S", "super_fund", "Simran's super", "PTY-PURRANNUATION", "PTY-SIMRAN", { account_id: SK }),
    con("CON-HOME", "loan", "Home loan", "PTY-WESTPAW", "PTY-HARPREET", { account_id: HL, asset_id: "AST-HOME", category_id: "MORTGAGE", started_on: "2019-03-14" }),
    con("CON-HOME-INS", "insurance", "Home insurance", "PTY-PURRSURE", "PTY-HARPREET", { asset_id: "AST-HOME", category_id: "HOME-INS" }), con("CON-MOTOR", "insurance", "Car insurance", "PTY-PURRSURE", "PTY-HARPREET", { asset_id: "AST-CAR", category_id: "CAR" }), con("CON-HEALTH", "insurance", "Private health", "PTY-BUPAW", "PTY-HARPREET", { category_id: "HEALTH" }),
    con("CON-POWER", "utility", "Electricity", "PTY-POWER", "PTY-HARPREET", { category_id: "UTILITIES" }), con("CON-OSHC", "childcare", "Kittenhood after-school care", "PTY-KITTEN", "PTY-SIMRAN", { category_id: "CHILDCARE" }),
    con("CON-FTB", "commitment", "Family Tax Benefit", "PTY-SA", "PTY-SIMRAN", { category_id: "x_FTB", started_on: "2017-09-01" }), con("CON-REMIT", "commitment", "Money home to Harpreet's parents", "PTY-WW", "PTY-HARPREET", { category_id: "x_FAMILY", started_on: "2016-01-01" }),
    con("CON-GURDWARA", "subscription", "Monthly gift to the gurdwara", "PTY-GURDWARA", "PTY-HARPREET", { category_id: "DONATION" }), con("CON-BOARD", "commitment", "Gurjot's board", "PTY-GURJOT", "PTY-HARPREET", { category_id: "x_BOARD", started_on: GURJOT_IN, ended_on: GURJOT_OUT }), con("CON-LODGER", "commitment", "Aarav's room", "PTY-AARAV", "PTY-HARPREET", { category_id: "x_BOARD", started_on: LODGER_IN, ended_on: LODGER_OUT }),
  ];
  const lk = (relation, from_type, from_id, to_type, to_id, extra = {}) => ({ relation, from_type, from_id, to_type, to_id, valid_from: "2000-01-01", recorded_at: ON, ...extra });
  const link = [lk("contributes_to", "contract", "CON-WESTGATE", "contract", "CON-SUPER-H"), lk("contributes_to", "contract", "CON-ARDEER", "contract", "CON-SUPER-S"), lk("contributes_to", "contract", "CON-LAVERTON", "contract", "CON-SUPER-S"),
    lk("secures", "contract", "CON-HOME", "asset", "AST-HOME"), lk("funds_purpose", "contract", "CON-HOME", "asset", "AST-HOME", { share_bps: 10000 }), lk("paid_by", "contract", "CON-HOME", "account", JT),
    lk("charged_to", "account", CC, "account", JT), lk("covers", "contract", "CON-HOME-INS", "asset", "AST-HOME"), lk("covers", "contract", "CON-MOTOR", "asset", "AST-CAR")];
  const st = (stream_id, name, doc_kind, subject_type, subject_id, issuer_party_id, cadence, extra = {}) => ({ stream_id, name, doc_kind, subject_type, subject_id, issuer_party_id, cadence, valid_from: START, grace_days: 14, recorded_at: ON, ...extra });
  const stream = [
    st(JT, "Everyday download", "txn_csv", "account", JT, "PTY-BARK", "quarterly"), st(SM, "Simran's download", "txn_ofx", "account", SM, "PTY-WATTLE", "quarterly"), st(SV, "Saver download", "txn_csv", "account", SV, "PTY-HARBOUR", "quarterly"), st(NR, "Rupee account download", "txn_csv", "account", NR, "PTY-SATLUJ", "quarterly"),
    st(CC, "Amewx activity", "txn_csv", "account", CC, "PTY-AMEWX", "quarterly"), st("STM-CARD", "Amewx statement", "statement", "account", CC, "PTY-AMEWX", "monthly"),
    st("STM-HOMELOAN", "Westpaw statement", "loan_statement", "account", HL, "PTY-WESTPAW", "half_yearly"), st("NOTICE-HOMELOAN", "Rate notices", "rate_notice", "contract", "CON-HOME", "PTY-WESTPAW", "event"),
    st(SH, "Harpreet's super transactions", "super_lines", "account", SH, "PTY-HESTABBY", "half_yearly"), st(SK, "Simran's super transactions", "super_lines", "account", SK, "PTY-PURRANNUATION", "half_yearly"), st("STM-SUPER-H", "Harpreet's super statement", "super_statement", "account", SH, "PTY-HESTABBY", "yearly"),
    st("PAY-H", "Harpreet's payslips", "payslip", "party", "PTY-HARPREET", "PTY-WESTGATE", "fortnightly"), st("PAY-S", "Simran's payslips", "payslip", "party", "PTY-SIMRAN", "PTY-ARDEER", "event"), st("INC-H", "Harpreet's income statements", "income_statement", "party", "PTY-HARPREET", "PTY-WESTGATE", "yearly"), st("INC-S", "Simran's income statements", "income_statement", "party", "PTY-SIMRAN", "PTY-ARDEER", "yearly"), st("TAX-H", "Harpreet's notices", "tax_assessment", "party", "PTY-HARPREET", "PTY-TAX", "yearly"), st("TAX-S", "Simran's notices", "tax_assessment", "party", "PTY-SIMRAN", "PTY-TAX", "yearly"),
    st("VALUATIONS", "Home estimates", "valuation", "asset", "AST-HOME", null, "quarterly"), st("BILL-POWER", "Electricity bills", "bill", "contract", "CON-POWER", "PTY-POWER", "quarterly"), st("BILL-WATER", "Water bills", "bill", "asset", "AST-HOME", "PTY-WATER", "quarterly"), st("BILL-RATES", "Rates notices", "bill", "asset", "AST-HOME", "PTY-COUNCIL", "half_yearly"), st("POLICY-HOME", "Home certificate", "policy", "contract", "CON-HOME-INS", "PTY-PURRSURE", "yearly"), st("POLICY-MOTOR", "Motor renewal", "policy", "contract", "CON-MOTOR", "PTY-PURRSURE", "yearly"), st("HEALTH-FUND", "Bupaw statements", "health_statement", "contract", "CON-HEALTH", "PTY-BUPAW", "yearly"), st("REGO", "Rego notices", "bill", "asset", "AST-CAR", "PTY-VICPAWS", "yearly"), st("RECEIPTS", "Receipts", "receipt", "party", "PTY-HARPREET", null, "event"), st("CHILDCARE", "Kittenhood statements", "childcare_statement", "contract", "CON-OSHC", "PTY-KITTEN", "monthly"),
    st("VISA-PAPERS", "Visa papers", "statement", "party", "PTY-SURJIT", "PTY-HOMEAFFAIRS", "event"), st("REMIT-PAPERS", "Whiskerwire history", "statement", "contract", "CON-REMIT", "PTY-WW", "yearly"), st("RUPEE-PAPERS", "Rupee account papers", "statement", "account", NR, "PTY-SATLUJ", "event"), st("TUITION", "Gurjot's fee statements", "statement", "party", "PTY-GURJOT", null, "event"),
  ];
  let t = 0;
  const tm = (subject_type, subject_id, term, value, unit, valid_from, o = {}) => { t += 1; return { term_id: `TERM-${pad(t, 3)}`, subject_type, subject_id, term, value, unit, valid_from, recorded_at: ON, ...o }; };
  // only what a person knows offhand
  const term = [tm("contract", "CON-HOME", "interest_rate", "6.39", "pct", START), tm("contract", "CON-HOME", "rate_type", "variable", null, START), tm("contract", "CON-HOME", "repayment_type", "principal_and_interest", null, START), tm("contract", "CON-HOME", "repayment_cents", "142000", "cents", START), tm("contract", "CON-HOME", "repayment_cadence", "fortnightly", null, START),
    tm("contract", "CON-WESTGATE", "base_salary_cents", "8400000", "cents", START), tm("contract", "CON-WESTGATE", "pay_cadence", "fortnightly", null, START), tm("contract", "CON-ARDEER", "pay_cadence", "fortnightly", null, START), tm("contract", "CON-LAVERTON", "pay_cadence", "fortnightly", null, START),
    tm("contract", "CON-HEALTH", "premium_cents", "32400", "cents", START), tm("contract", "CON-HEALTH", "premium_cadence", "monthly", null, START), tm("contract", "CON-GURDWARA", "price_cents", "10000", "cents", START), tm("contract", "CON-GURDWARA", "cadence", "monthly", null, START), tm("asset", "AST-HOME", "use", "owner_occupied", null, "2019-03-14")];
  const household = [{ household_id: "HH-SK", name: "Singh-Kaur", jurisdiction: "AU", base_currency: "AUD", fy_start_month: 7, timezone: "Australia/Melbourne", standard_version: "household-standard/1" }];
  return { household, party, membership, account, alias, ownership, category, contract, link, stream, asset, term };
}

// ---------- build ----------
function build() {
  fxCurve(); windows();
  everyday(); harpreetPay(); simranPay(); benefits(); remit(); kitty(); collection(); gifts(); gurjot(); lodger(); visit(); rupee(); homeRepayments(); homeValues(); bills(); lineTraps(); superFunds(); taxes();
  strayFile(); settleCard(); sweeps(); interestCredits(); homeInterest();
  fileTraps();
  const tb = truthBalances(), t = truth(tb); lateTraps(tb, t);
  // a planted line must never sit in a hole no engine can read: the bug BLIND-6 met twice
  for (const x of B.traps) for (const l of (x.probe.lines || [])) if (l.account === JT && l.date >= TRUNC_FROM && l.date <= TRUNC_TO) throw new Error(`${x.id} probes a line in the truncated file's hole: ${l.date}`);
  const lows = {}; for (const a of [JT, SM, SV, NR]) lows[a] = Math.min(...chain(a).map((x) => x.balance));
  render();
  const tSetup = setup();
  fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
  const manifest = { household: "HH-SK", files: FILES.map((f) => ({ path: f.path, stream_id: f.stream, download_date: f.day, name: f.name, origin: f.origin || "portal", issued_on: f.issued_on || null })) };
  for (const f of FILES) { const p = path.join(OUT, f.path); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, f.bytes); }
  fs.writeFileSync(path.join(OUT, "manifest.json"), `${JSON.stringify(manifest, null, 1)}\n`);
  fs.writeFileSync(path.join(OUT, "truth.json"), `${JSON.stringify(t, null, 1)}\n`);
  fs.mkdirSync(SETUP_DIR, { recursive: true });
  for (const n of fs.readdirSync(SETUP_DIR)) fs.rmSync(path.join(SETUP_DIR, n));
  for (const [k, v] of Object.entries(tSetup)) fs.writeFileSync(path.join(SETUP_DIR, `${k}.json`), `${JSON.stringify(v, null, 1)}\n`);
  return { files: FILES.length, lines: B.lines.length, traps: B.traps.length, fresh: B.traps.filter((x) => x.fresh).length, dc: B.traps.filter((x) => x.dc).length, regular: B.traps.filter((x) => x.regular).length, lows, tb, totals: { income: Object.values(t.income).reduce((a, b) => a + b, 0), spending: Object.values(t.spending).reduce((a, b) => a + b, 0), nw: t.networth["2026-06"] } };
}

if (require.main === module) { const r = build(); console.log(`Held-out household 7: ${r.files} files, ${r.lines} lines, ${r.traps} traps (${r.fresh} in none of the earlier lists, ${r.dc} new double-count or silent-number variants, ${r.regular} regular money). Lowest balances: ${Object.entries(r.lows).map(([a, v]) => `${a} ${money(v)}`).join(", ")}. Income ${money(r.totals.income)}, spending ${money(r.totals.spending)}, net worth June 2026 ${money(r.totals.nw)}.`); }
module.exports = { build, OUT, SETUP_DIR, book: B };
