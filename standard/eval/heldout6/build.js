#!/usr/bin/env node
/* The sixth held-out household. Five blind families found real defects, and the engine was repaired after each. Repaired scores prove nothing. This one is the headline: the blind score of the
   engine as it ships.

   The Mulcahy-Bonettis of Warrnambool, Victoria, 36 months from July 2023 to June 2026. Everything here is fictional. Paul Mulcahy is a fitter at a dairy factory, paid weekly. Dee Bonetti is an
   enrolled nurse at the district health service, with part of her pay packaged to the home loan, until her mother falls in February 2024. She resigns, claims Carer Payment and Carer Allowance, and
   holds a power of attorney over her mother's accounts. Her mother, Assunta Bonetti, pays for a granny flat on their block, moves in and pays board, sells her own house, lends them money, goes
   into care in June 2025 and dies in February 2026. Her accounts are hers and never the household's: the household's job is to keep her money out of its numbers while it runs through its rails.
   Written blind: from SPEC.md, RECIPES.md, the schemas, the public recipes, the intake, the world's file writers and the five earlier held-out folders' build, run and blind reports.

   Order of work, as in the earlier households: a life is simulated first and held in cents, day by day. Only then are files rendered from it, as each institution would hand them over. Truth is
   written from the simulation and never from the engine. Setup is what a person would answer at onboarding: no rules, no decisions, no opening balances a file states.

   node standard/eval/heldout6/build.js
   writes standard/.build/heldout6/{sources,manifest.json,truth.json} and standard/eval/heldout6/setup/<table>.json. Node 22, no dependencies, seeded, no clock. */
"use strict";
const fs = require("fs"), path = require("path"), zlib = require("zlib");

const STD = path.join(__dirname, "..", "..");
const LIB = path.join(STD, "world", "lib");
const { pad, fix, money, addDays, dayDiff, weekday, monthEnd, nextMonth, monthRange, fmtDate, dmy, fyOf, csvLines, Rng, MONTHS: MON } = require(path.join(LIB, "util"));
const { Doc, M: MARGIN } = require(path.join(LIB, "pdf"));
const { eml } = require(path.join(LIB, "mail"));
const { ofx, qif } = require(path.join(LIB, "bankfiles"));

const OUT = path.join(STD, ".build", "heldout6");
const SETUP_DIR = path.join(__dirname, "setup");
const START = "2023-07-01", END = "2026-06-30", MONTHS = monthRange("2023-07", "2026-06");
const VAN_SOLD = "2024-02-03", DEE_LEFT = "2024-03-15", MOVE_IN = "2024-03-11", CARER_FROM = "2024-04-04", NOMINEE_FROM = "2024-08-08", MUM_SOLD = "2024-09-20", LOAN_DAY = "2024-10-14", POA_LOGIN = "2024-11-01", CARE_FROM = "2025-06-16", DEATH = "2026-02-09", DEE_BACK = "2026-05-07", MUM_CLOSE = "2026-04-20", MJ_CLOSE = "2026-03-02", TRUNC_FROM = "2025-03-11", TRUNC_TO = "2025-03-31";
const rng = (name) => new Rng(`mulcahy-bonetti:${name}`);
const deflate = (b) => new Uint8Array(zlib.deflateSync(b));

// ---------- who and what ----------
const PAUL = "Paul Mulcahy", DEE = "Donatella Bonetti", TESS = "Tess Mulcahy", LIAM = "Liam Mulcahy", MUM = "Assunta Bonetti", CARLO = "Carlo Bonetti";
const DAIRY = "Merri River Dairy Co", MOYNE = "Moyne Coast Health", COUNCIL = "Warrnambool Coast Council", HOME = "9 Tower Hill Road, Warrnambool", MUMHOUSE = "33 Liebig Street, Warrnambool", SA = "Services Australia", LAKESIDE = "Lakeside Aged Care", BRAUER = "Brauer Legal";
const JT = "ACC-JOINT", DE = "ACC-DEE", SV = "ACC-SAVE", CC = "ACC-CARD", HL = "ACC-HOMELOAN", ML = "ACC-MUMLOAN", MU = "ACC-MUM", MJ = "ACC-MUMJT", SP = "ACC-SUPER-P", SD = "ACC-SUPER-D", HO = "ACC-HOME", CR = "ACC-CAR", VN = "ACC-VAN";
const NUM = { joint: "733120448806", dee: "1520", save: "0071930877", mumSaver: "0093318842", card: "42118", home: "PNG-88412010", superP: "HST-5519027", superD: "PUR-6620913", policyHome: "PH-71120552", policyMotor: "PM-8840", mum: "2207", rego: "1XY2ZW", regoVan: "C84721", assessment: "CC-7741080", mumAssessment: "CC-7743129" };
const CASH = [JT, DE, SV, CC, MJ];
const WAGE_P = "MERRI RIVER DAIRY PAY 5521", WAGE_D = "MOYNE COAST HEALTH PAY 3310", WAGE_SAVE = "MOYNE COAST HEALTH PAY SAVE";
const CARER_P = "SERVICES AUSTRALIA CARER PAY 7741", CARER_A = "SERVICES AUSTRALIA CARER ALLOW 7741", AGE = "SERVICES AUSTRALIA AGE PENSION 8812";
const fromMum = (d, word) => (d < POA_LOGIN ? `OSKO FROM A BONETTI ${word}` : `OSKO FROM D BONETTI POA ${word}`);
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
const bizAfter = (d, n) => { let x = d; while (n > 0) { x = addDays(x, 1); if (isBiz(x)) n -= 1; } return x; };
const cents = (r, lo, hi) => Math.round(r.range(lo, hi) * 100);
const ymOf = (d) => d.slice(0, 7);
const posted = (x) => x.posted || x.date;
const byTime = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.seq - b.seq);
const byPost = (a, b) => (posted(a) < posted(b) ? -1 : posted(a) > posted(b) ? 1 : a.seq - b.seq);
const nextMonday = (d) => { let x = addDays(d, 1); while (weekday(x) !== 1) x = addDays(x, 1); return x; };

/* trap register. fresh: in none of the five earlier lists. dc: a new variant of double counting or of a number silently wrong. A probe is a fact run.js can test against what the engine produced. */
function trap(id, name, where, expect, probe, o = {}) { B.traps.push({ id, name, where, expect, probe, fresh: !!o.fresh, dc: !!o.dc }); }
const plain = (x, want, extra = {}) => ({ account: x.acct, date: x.date, ...(x.posted && x.posted !== x.date ? { posted: x.posted } : {}), cents: x.cents, want, ...extra });

// ---------- merchants, all invented ----------
const MER = {
  grocer: [["LIEBIG ST PROVISIONS", "WARRNAMBOOL"], ["DENNINGTON GROCER", "DENNINGTON"], ["MERRIVALE FRESH", "MERRIVALE"]],
  cafe: [["TIMOR ST COFFEE", "WARRNAMBOOL"], ["PERTOBE KIOSK", "WARRNAMBOOL"]],
  dine: [["KOROIT ROAD CHARCOAL", "KOROIT"], ["BREAKWATER PIZZA", "WARRNAMBOOL"]],
  fuel: [["PRINCES HWY FUEL", "DENNINGTON"], ["ALLANSFORD FUEL", "ALLANSFORD"]],
  shop: [["TOWER HILL HOMEWARES", "KOROIT"], ["FLAGSTAFF HARDWARE", "WARRNAMBOOL"], ["GILLES ST CLOTHING", "WARRNAMBOOL"]],
  chem: [["FAIRY ST CHEMIST", "WARRNAMBOOL"]],
  care: [["FAIRY ST CHEMIST", "WARRNAMBOOL"], ["HOPKINS PODIATRY", "WARRNAMBOOL"], ["LAKEVIEW PHYSIO", "WARRNAMBOOL"], ["MOBILITY PLUS", "WARRNAMBOOL"]],
};
const cardDesc = (m) => `${m[0]} ${m[1]}`;
const cardCsv = (m) => `${m[0].padEnd(26)}${m[1]}  VIC`;
const pos = (m) => `EFTPOS ${m[0]} ${m[1]}`;

/* one card purchase. date is the day it was charged, which the statement shows; posted is the day the activity download shows. Lag is in business days. */
function card(r, date, m, c, cat, o = {}) {
  const lag = o.lag != null ? o.lag : r.pick([0, 0, 1, 1, 1, 2, 2, 3, 4, 5]);
  const post = o.posted || (lag ? bizAfter(date, lag) : date);
  count("purchase");
  return line(CC, date, o.desc || cardDesc(m), -c, { posted: post, csv: o.csv || cardCsv(m), member: PAUL, lens: o.lens === undefined ? "spending" : o.lens, cat, ...o.extra });
}

// ---------- everyday life ----------
const ATM = [], RENT = [];
function everyday() {
  const r = rng("everyday"), pick = (a) => r.pick(a);
  const debit = (acct, d, m, c, cat) => { count("purchase"); return spend(acct, d, pos(m), c, cat); };
  for (let d = "2023-06-15"; d <= END; d = addDays(d, 1)) {
    const wd = weekday(d), inWin = d >= START;
    if (r.next() < 0.2) card(r, d, pick(MER.grocer), cents(r, 36, 150), "GROCERIES");
    if (r.next() < 0.09) card(r, d, pick(MER.cafe), cents(r, 5, 16), "DINING");
    if (wd === 6 && r.next() < 0.22) card(r, d, pick(MER.dine), cents(r, 30, 84), "DINING");
    if (r.next() < 0.05) card(r, d, pick(MER.shop), cents(r, 14, 170), "SHOPPING");
    if (r.next() < 0.05) card(r, d, pick(MER.chem), cents(r, 8, 48), "HEALTH");
    if (d.slice(8) === "11") card(r, d, ["NORTHLIGHT STREAM", "ONLINE"], 1699, "SUBS");
    if (!inWin) continue;
    if (r.next() < 0.22) debit(JT, d, pick(MER.grocer), cents(r, 20, 110), "GROCERIES");
    if (r.next() < 0.13) debit(JT, d, pick(MER.fuel), cents(r, 50, 92), "TRANSPORT");
    if (r.next() < 0.1) debit(DE, d, pick(MER.shop), cents(r, 12, 60), "SHOPPING");
    if (wd === 2 && r.next() < 0.5) debit(DE, d, pick(MER.cafe), cents(r, 5, 14), "DINING");
    if (d.slice(8) === "03") { spend(JT, d, "DIRECT DEBIT KOALATEL MOBILE 7102", 7900, "TELCO"); spend(JT, d, "DIRECT DEBIT REEFLINK INTERNET 44120", 7400, "TELCO"); count("purchase", 2); }
  }
  const a = rng("atm"); let d = "2023-07-04";
  while (d <= END) { const c = a.pick([10000, 10000, 15000, 20000]); ATM.push(spend(JT, d, "ATM WITHDRAWAL LIEBIG ST", c, "PERSONAL")); count("atm"); d = addDays(d, a.int(8, 14)); }
  trap("T6-ATM", "An ATM withdrawal is spending, whatever happens to the notes", `${JT}: ${ATM.length} lines reading "ATM WITHDRAWAL LIEBIG ST"`, "Money that left the accounts for the household to spend. Spending, and not an open transfer waiting for a pair.",
    { kind: "lines", lines: [ATM[3], ATM[25], ATM[60]].map((x) => plain(x, "spending")) });
  // Tess is a dependant at university in Melbourne, with an account nobody declared
  for (let x = "2024-02-23"; x <= END; x = addDays(x, 14)) RENT.push(spend(JT, x, "OSKO TO T MULCAHY RENT", 42000, "KIDS-ACT"));
  trap("T6-UNI-RENT", "Rent for a daughter at university, to a member's account nobody declared", `${JT}: ${RENT.length} fortnights of 420.00, "OSKO TO T MULCAHY RENT". Tess is a dependant in setup and no account of hers is`, "Spending. A member's surname does not make it an own transfer, and no account of the household's receives it.",
    { kind: "lines", lines: [RENT[2], RENT[30], RENT[RENT.length - 2]].map((x) => plain(x, "spending")) });
}

// ---------- pay: his weekly wage, her nursing pay with packaging, her return ----------
const PAY = { slips: [] };
const sgRate = (d) => (d < "2024-07-01" ? 11 : d < "2025-07-01" ? 11.5 : 12);
function slip(person, name, employer, payDate, from, to, gross, o = {}) {
  const rate = o.rate != null ? o.rate : person === PAUL ? 0.22 : 0.17, tax = o.tax != null ? o.tax : Math.round(gross * rate / 100) * 100, sg = Math.round(gross * sgRate(payDate) / 100), net = gross - tax;
  const s = { person, name, employer, payDate, from, to, gross, tax, super: sg, net, fy: fyOf(payDate), ...o };
  PAY.slips.push(s); count("payslip");
  return s;
}
const PACK = 34615, PACKS = [];
function paulPay() {
  const r = rng("paul"), plainPays = [];
  const base = (d) => (d < "2024-07-01" ? 178000 : d < "2025-07-01" ? 184000 : 190000);
  for (let d = "2023-07-06"; d <= END; d = addDays(d, 7)) {
    if (d === "2024-12-26" || d === "2025-01-02") continue;  // he is on leave, paid ahead
    const gross = d === "2024-12-19" ? base(d) * 3 : r.next() < 0.5 ? base(d) : base(d) + cents(r, 90, 620), s = slip(PAUL, PAUL, DAIRY, d, addDays(d, -6), d === "2024-12-19" ? addDays(d, 14) : d, gross, { bank: JT, noFile: d === "2025-08-14" });
    if (d === "2024-06-27") {
      const x = earn(JT, "2024-07-01", WAGE_P, s.net, "SALARY");
      trap("T6-PAY-STRADDLE", "Pay dated in June, banked in July", `Merri River Dairy's pay of ${money(s.net)}: payslip 2024-06-27, ${JT} 2024-07-01`, "Cash income lands in July, when the money arrived.",
        { kind: "lines", lines: [plain(x, "income", { month: "2024-07" })] });
    } else if (d === "2024-12-19") {
      const x = earn(JT, d, WAGE_P, s.net, "SALARY");
      trap("T6-LEAVE-AHEAD", "Three weeks' leave paid ahead in one credit, and then two Thursdays with nothing", `${JT} ${d}: ${money(s.net)}, three weeks' pay on one payslip whose period runs to ${s.to}. No credit on 2024-12-26 or 2025-01-02`, "One pay, once, in December. A slip whose period runs past its pay date is not two pays, and an empty Thursday is not a missing wage.",
        { kind: "lines", lines: [plain(x, "income", { month: "2024-12" })] }, { fresh: true });
    } else {
      const x = earn(JT, d, WAGE_P, s.net, "SALARY"); plainPays.push(x);
      if (d === "2024-11-21") {
        const b = slip(PAUL, PAUL, DAIRY, d, "2024-07-01", "2024-11-17", 264000, { rate: 0.3, bank: JT, tag: "backpay" }), y = earn(JT, d, WAGE_P, b.net, "SALARY");
        trap("T6-BACKPAY", "Back pay from a new agreement: one man, one employer, one day, one line of text, two payslips", `${JT} ${d}: ${money(s.net)} and ${money(b.net)}, the same words twice`, "Two incomes. The second payslip is not a correction of the first, and neither credit is a repeat.",
          { kind: "lines", lines: [plain(x, "income"), plain(y, "income")] }, { fresh: true, dc: true });
      }
      if (d === "2025-08-14") trap("T6-SLIP-MISSING", "One week's payslip was never saved", `${JT} ${d}: ${money(s.net)}. The employer is in setup, and 154 weeks either side have a slip`, "Income. The bank line is the only witness that week, and the income statement over it must not add a second.",
        { kind: "lines", lines: [plain(x, "income")] });
    }
  }
  trap("T6-WEEKLY-PAY", "A weekly wage: half the weeks the same to the cent, a window of five days either side", `${JT}: ${plainPays.length} Thursdays, "${WAGE_P}", half of them at one amount for the year, and a payslip for each but one`, "One income a week. With a wage window of five days and pays seven apart, a slip must clear its own week, and a same-amount week must not be read as a repeat.",
    { kind: "lines", lines: [plainPays[12], plainPays[13], plainPays[60], plainPays[100], plainPays[140]].map((x) => plain(x, "income")) }, { fresh: true, dc: true });
}
function deePay() {
  const r = rng("dee"), split = [], mine = [];
  for (let d = "2023-07-13"; d < DEE_LEFT; d = addDays(d, 14)) {
    const gross = cents(r, 2380, 2960), s = slip(DEE, DEE, MOYNE, d, addDays(d, -13), d, gross, { split: true, bank: DE, pack: PACK });
    PACKS.push({ date: nextBiz(addDays(d, 1)), cents: PACK });
    const a = earn(DE, d, WAGE_D, s.net - 15000, "SALARY"), b = earn(SV, d, WAGE_SAVE, 15000, "SALARY"); split.push([a, b, s]); mine.push(a);
  }
  trap("T6-NET-PAY-SPLIT", "One payslip, two bank credits", `${split.length} pays: each Moyne Coast Health net reaches ${DE} less 150.00, and ${SV} 150.00`, "Both credits are that one pay. Cash income is the net once.",
    { kind: "lines", lines: [split[2], split[9], split[15]].flatMap(([a, b]) => [plain(a, "income"), plain(b, "income")]) });
  const f = slip(DEE, DEE, MOYNE, "2024-03-21", "2024-03-08", DEE_LEFT, 980000, { rate: 0.3, bank: DE });
  const a = earn(DE, f.payDate, WAGE_D, 400000, "SALARY"), b = earn(DE, "2024-04-03", WAGE_D, f.net - 400000, "SALARY");
  trap("T6-PAY-IN-PARTS", "A final pay with leave, paid in two credits thirteen days apart", `${DE}: the final pay of ${f.payDate}, net ${money(f.net)}, lands as 4,000.00 that day and ${money(b.cents)} on ${b.date}, beyond schema/matching.json's five-day wage window, after the employment has ended`, "Both credits are that one pay: income, net, once.",
    { kind: "lines", lines: [plain(a, "income"), plain(b, "income")] });
  const cl = [line(DE, "2023-10-12", "MOYNE COAST HEALTH UNIFORM CLAIM", 9640, {}), line(DE, "2024-02-08", "MOYNE COAST HEALTH UNIFORM CLAIM", 12400, {})];
  trap("T6-REIMB", "An employer's credit that is not pay", `${DE}: uniforms paid back by the employer, by name, with no payslip to clear`, "SPEC 4.4c: neither income nor spending, and not a wage. Only the credit is probed.",
    { kind: "lines", lines: cl.map((x) => plain(x, "neither")) });
  // she goes back to the same hospital three months after her mother dies
  const backs = []; for (let d = DEE_BACK; d <= END; d = addDays(d, 14)) { const gross = cents(r, 2100, 2500), s = slip(DEE, DEE, MOYNE, d, addDays(d, -13), d, gross, { bank: DE }); backs.push(earn(DE, d, WAGE_D, s.net, "SALARY")); }
  trap("T6-BACK-TO-WORK", "The same employer again, two years and two months after the employment ended", `${DE}: ${backs.length} fortnights from ${DEE_BACK}, the same words as before she left. Setup holds two employments, the first ended ${DEE_LEFT}`, "Income, each clearing its payslip. The credits sit beside a Carer Payment that has stopped, not on top of it.",
    { kind: "lines", lines: [backs[0], backs[backs.length - 1]].map((x) => plain(x, "income")) }, { fresh: true });
}

// ---------- Services Australia: her own money and her mother's, on one account ----------
const cpOn = (d) => (d < "2024-09-20" ? 96420 : d < "2025-03-20" ? 98260 : d < "2025-09-20" ? 99640 : 101180), caOn = (d) => (d < "2024-09-20" ? 15350 : d < "2025-09-20" ? 15770 : 16030), ageOn = (d) => (d < "2024-09-20" ? 114160 : d < "2025-03-20" ? 116680 : d < "2025-09-20" ? 118420 : 120310);
function carer() {
  const cp = [], ca = [];
  for (let d = CARER_FROM; d <= "2026-02-05"; d = addDays(d, 14)) { cp.push(earn(DE, d, CARER_P, cpOn(d), "x_CARER")); ca.push(earn(DE, d, CARER_A, caOn(d), "x_CARER")); count("carer", 2); }
  trap("T6-CARER-TWO-CREDITS", "Carer Payment and Carer Allowance: two credits, one payer, one day, no payslip", `${DE}: ${cp.length} fortnights of two credits, indexed each March and September. A person declared the agreement in setup, with a category`, "Income. The contract says what the money is.",
    { kind: "lines", lines: [cp[3], ca[3], cp[20], ca[33]].map((x) => plain(x, "income")) });
  const sup = [["2024-07-05", 60000], ["2025-07-04", 60000]].map(([d, c]) => earn(DE, d, "SERVICES AUSTRALIA CARER SUPPLEMENT 7741", c, "x_CARER"));
  trap("T6-SUPPLEMENT", "A once-a-year Carer Supplement, beside the tax refund", `${DE}: ${sup.map((x) => `${money(x.cents)} on ${x.date}`).join(", ")}`, "Income. The contract says so, and a lump the same size each July is not a refund.",
    { kind: "lines", lines: sup.map((x) => plain(x, "income")) });
  const debt = line(DE, "2025-09-23", "SERVICES AUSTRALIA DEBT 7741", -62000, { lens: "income", cat: "x_CARER" });
  trap("T6-BENEFIT-DEBT", "An overpaid Carer Payment taken back by a debit", `${DE} ${debt.date}: -620.00. Paul's overtime ran above the estimate`, "A negative in income, as T4-BENEFIT-DEBT read it. It takes a question or a rule.",
    { kind: "lines", lines: [plain(debt, "income")] });
  const be = earn(DE, "2026-02-26", "SERVICES AUSTRALIA BEREAVEMENT 7741", 391240, "x_CARER");
  trap("T6-BEREAVEMENT", "A bereavement lump sum, seventeen days after the death, on the contract that has just ended", `${DE} ${be.date}: +3,912.40, four fortnights' Carer Payment in one credit, on a line no earlier credit has`, "Income. A contract's end date is when the fortnights stopped, not when the payer stopped meaning what it meant.",
    { kind: "lines", lines: [plain(be, "income")] }, { fresh: true });
  // Dee is her mother's payment nominee: from August 2024 the Age Pension lands on Dee's account, on the same Thursday as her own, and she sends it on the next Monday
  const pens = [], onward = [];
  for (let d = NOMINEE_FROM; d <= "2026-02-05"; d = addDays(d, 14)) {
    const c = ageOn(d), n = nextMonday(d);
    pens.push(line(DE, d, AGE, c, {})); onward.push(line(DE, n, "OSKO TO A BONETTI PENSION", -c, {})); line(MU, n, "OSKO FROM D BONETTI PENSION", c, {}); count("nominee");
  }
  trap("T6-NOMINEE-PENSION", "Her mother's Age Pension lands on Dee's account as nominee: one payer, one Thursday, one contract's name", `${DE}: ${pens.length} fortnights of ${money(pens[0].cents)} and up, "${AGE}", the day her own two payments land, ${money(pens.reduce((t, x) => t + x.cents, 0))} in all, and the same out to ${MU} the next Monday`, "Neither, both ways. Not one dollar is the household's. If the credit is carer income and the debit is spending, income and spending are both high by the whole amount and every total adds.",
    { kind: "lines", lines: [pens[0], pens[20], pens[pens.length - 1], onward[0], onward[20]].map((x) => plain(x, "neither")) }, { fresh: true, dc: true });
  const after = line(DE, "2026-02-19", AGE, ageOn("2026-02-19"), {}), rec = line(DE, "2026-03-03", "SERVICES AUSTRALIA RECOVERY 8812", -ageOn("2026-02-19"), {});
  trap("T6-PENSION-RECALL", "A pension paid ten days after she died, and taken back twelve days later", `${DE}: ${money(after.cents)} on ${after.date}, the same out on ${rec.date}, "SERVICES AUSTRALIA RECOVERY 8812"`, "Neither, both ways. Read as carer income and a debt taken back, a dead woman's pension sits in two months of income.",
    { kind: "lines", lines: [plain(after, "neither"), plain(rec, "neither")] }, { fresh: true, dc: true });
  // Medicare: the household's own, and two of her mother's claims that reach the same account
  const backs = [["2023-09-12", 4120], ["2024-02-27", 8635], ["2024-10-15", 4120], ["2025-05-20", 4385], ["2026-02-10", 4385]];
  for (const [d, c] of backs) { spend(JT, addDays(d, -2), "EFTPOS DENNINGTON MEDICAL CENTRE", c + 3800, "HEALTH"); line(JT, d, "SERVICES AUSTRALIA MEDICARE 2291", c, { lens: "spending", cat: "HEALTH" }); count("purchase"); }
  trap("T6-MEDICARE-SA", "A Medicare refund beside a benefit from the same agency", `${JT} on ${backs.map((b) => b[0]).join(", ")}`, "Lowers HEALTH spending. Not income, whatever is done for the agency's name.",
    { kind: "lines", lines: backs.map(([d, c]) => ({ account: JT, date: d, cents: c, want: "spending" })) });
}

// ---------- her mother's money: what crosses the rails and what never does ----------
const MUMCO = { reimb: [], board: [], boardPoa: [], stage: [] };
function mumAccount() {
  const r = rng("mum");
  // the pension reached her own account until Dee became nominee, her own costs, and Dee's name beside hers on a small saver
  for (let d = "2023-07-13"; d < NOMINEE_FROM; d = addDays(d, 14)) line(MU, d, AGE, ageOn(d), {});
  for (const ym of monthRange("2023-07", "2026-01")) {
    line(MU, nextBiz(`${ym}-09`), "DIRECT DEBIT OTWAY HOME CARE 7712", -cents(r, 48, 96), {});
    if (ym < "2024-04") { line(MU, nextBiz(`${ym}-17`), "BPAY SHIPWRECK COAST POWER 8810", -cents(r, 90, 160), {}); line(MU, nextBiz(`${ym}-21`), "EFTPOS LIEBIG ST PROVISIONS", -cents(r, 60, 150), {}); }
    line(MU, monthEnd(ym), "INTEREST", cents(r, 2, 40), {});
    line(MU, nextBiz(`${ym}-14`), "ATM WITHDRAWAL FAIRY ST", -r.pick([10000, 10000, 20000]), {});
  }
  const qs = ["2023-09-29", "2023-12-29", "2024-03-28", "2024-06-28", "2024-09-30", "2024-12-31", "2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31"], ints = qs.map((d) => line(MJ, d, "INTEREST", 8000 + (d.charCodeAt(9) % 5) * 90, {}));
  const wd = line(MJ, "2025-03-18", "OSKO TO A BONETTI", -200000, {}); line(MU, "2025-03-18", "OSKO FROM A AND D BONETTI", 200000, {});
  MUMCO.ints = ints; MUMCO.jwd = wd;
  // the house she sold, on an account the household does not hold
  const sale = line(MU, MUM_SOLD, "HAMPDEN CONVEYANCING TRUST SALE 33 LIEBIG", 61234018, {}), onward = line(MU, "2024-09-30", "TFR TO TERM SAVER 3318842", -50000000, {});
  MUMCO.sale = sale; MUMCO.onward = onward;
}
function flat() {
  // the granny flat on their block, built on a fixed price: her money arrives the day before each claim, and they pay the builder
  const claims = [["2023-09-18", "DEPOSIT", 1680000], ["2023-11-06", "STAGE 2", 5040000], ["2024-01-15", "STAGE 3", 5040000], ["2024-03-04", "FINAL", 5040000]];
  const ins = [], outs = [];
  for (const [d, word, c] of claims) {
    line(MU, addDays(d, -1), "TFR FROM TERM SAVER 3318842", c, {}); line(MU, addDays(d, -1), `OSKO TO P MULCAHY FLAT ${word}`, -c, {});
    ins.push(line(JT, addDays(d, -1), `OSKO FROM A BONETTI FLAT ${word}`, c, {})); outs.push(line(JT, d, "BPAY OTWAY GRANNY FLATS 77120", -c, {}));
  }
  trap("T6-BUILDER-THROUGH", "A parent pays a builder for a granny flat through the household's account, a day at a time", `${JT}: four credits of ${money(claims.reduce((t, x) => t + x[2], 0))} in all from ${MU}, each followed the next day by the same to a builder nobody declared`, "SPEC 4.4c: someone else's money crossing the rails. Neither, both ways. The home's value rises at its next estimate, and that is the only place the flat shows.",
    { kind: "lines", lines: [ins[0], ins[2], outs[0], outs[2]].map((x) => plain(x, "neither")) });
}
function board() {
  for (let d = "2024-03-14"; d <= "2025-06-12"; d = addDays(d, 7)) {
    const x = earn(JT, d, fromMum(d, "BOARD"), 18000, "x_BOARD"); line(MU, d, "OSKO TO P MULCAHY BOARD", -18000, {}); (d < POA_LOGIN ? MUMCO.board : MUMCO.boardPoa).push(x); count("board");
  }
  trap("T6-BOARD-MUM", "Board from a parent whose own account is declared, opposite to the cent the same day", `${JT}: ${MUMCO.board.length} Thursdays of 180.00, "OSKO FROM A BONETTI BOARD". ${MU} is declared and shows each one going out. A person named the agreement in setup`, "Income, under the agreement. Two sides of one line on two declared accounts is not an own transfer when one account is not the household's. Paired, 180.00 a week of income vanishes.",
    { kind: "lines", lines: [MUMCO.board[2], MUMCO.board[15], MUMCO.board[30]].map((x) => plain(x, "income")) }, { fresh: true, dc: true });
  trap("T6-BOARD-ATTORNEY", "The same board once Dee logs on as attorney: the credit now carries a member's own name", `${JT}: ${MUMCO.boardPoa.length} Thursdays from ${POA_LOGIN}, "OSKO FROM D BONETTI POA BOARD". The money is still her mother's`, "Income. A bank line reading a member's name is not the member's money, and it is not her own transfer.",
    { kind: "lines", lines: [MUMCO.boardPoa[1], MUMCO.boardPoa[15], MUMCO.boardPoa[MUMCO.boardPoa.length - 2]].map((x) => plain(x, "income")) }, { fresh: true, dc: true });
  const son = []; for (let d = "2023-07-07"; d <= "2025-01-31"; d = addDays(d, 7)) son.push(earn(JT, d, "OSKO FROM L MULCAHY BOARD", 12000, "x_BOARD"));
  trap("T6-BOARD-SON", "Board from an adult son who is no member, whose surname is one", `${JT}: ${son.length} Fridays of 120.00, "OSKO FROM L MULCAHY BOARD". Liam is a party in setup and nothing else, and a person did not think to mention it`, "Income. It takes a question to know that, and a surname must not make it an own transfer in silence.",
    { kind: "lines", lines: [son[3], son[40], son[80]].map((x) => plain(x, "income")) }, { fresh: true });
}
function gifts() {
  // Christmas money from her, one Christmas inside the loan, and an own transfer of the same amount the day before
  const g = [["2023-12-21", "OSKO FROM A BONETTI XMAS"], ["2024-12-20", "OSKO FROM D BONETTI POA XMAS"], ["2025-12-19", "OSKO FROM D BONETTI POA XMAS"]].map(([d, t]) => { line(MU, d, "OSKO TO P MULCAHY XMAS", -50000, {}); return earn(JT, d, t, 50000, "GIFT-IN"); });
  trap("T6-MUM-GIFT", "A gift from the same mother, on the same account as her loan and her board", `${JT}: 500.00 at Christmas, ${g.map((x) => x.date).join(", ")}, one Christmas inside the loan`, "Income under GIFT-IN. Not a further draw on the loan, not board, not an own transfer.",
    { kind: "lines", lines: g.map((x) => plain(x, "income")) });
  const [a, b] = own(SV, "2024-12-19", "OSKO TO JOINT 8806", JT, "2024-12-19", "OSKO FROM D BONETTI SAVINGS", 50000);
  trap("T6-SAME-NAME", "Two identical credits a day apart: her own transfer and her mother's gift, one member's name on both", `${JT}: +500.00 on ${b.date} from their own saver, +500.00 on ${g[1].date} from her mother, under Dee's name both times. ${SV} has one debit`, "One is a transfer and one is income, whichever pairs. If both go, 500.00 of income vanishes. If neither pairs, the saver's debit reads as spending.",
    { kind: "lines", lines: [plain(a, "neither"), plain(b, "neither"), plain(g[1], "income")] });
}
function topup() {
  const t = [["2024-05-20", 150000], ["2024-07-15", 200000], ["2024-08-26", 150000]].map(([d, c]) => { line(MU, d, "OSKO FROM D BONETTI TOPUP", c, {}); return line(DE, d, "OSKO TO A BONETTI TOPUP", -c, {}); });
  line(MU, "2024-09-24", "OSKO TO D BONETTI TOPUP REPAID", -500000, {});
  const back = line(DE, "2024-09-24", fromMum("2024-09-24", "TOPUP REPAID"), 500000, {});
  trap("T6-HOUSE-TOPUP", "The household keeps her account afloat until her house sells, and is paid back at once", `${DE}: three debits worth 5,000.00, "OSKO TO A BONETTI TOPUP", and one credit of the sum four days after ${MUM_SOLD}. Nothing in setup says so`, "Neither, all four. No line equals the credit, and it is a loan in all but name that no contract holds. As spending and income, 5,000.00 stands on both sides.",
    { kind: "lines", lines: [...t.slice(0, 2).map((x) => plain(x, "neither")), plain(back, "neither")] }, { fresh: true, dc: true });
}
const LOANMUM = { reps: [] };
function mumLoan() {
  line(MU, LOAN_DAY, "OSKO TO P MULCAHY LOAN", -3000000, {});
  const inn = line(JT, LOAN_DAY, "OSKO FROM A BONETTI LOAN", 3000000, {}); line(ML, LOAN_DAY, "Loan from Assunta", -3000000, {});
  spend(JT, "2024-10-21", "BPAY WARRNAMBOOL BATHROOMS 5521", 2640000, "HOME-MAINT"); count("purchase");
  for (const ym of monthRange("2025-01", "2026-02")) { const d = nextBiz(`${ym}-05`); LOANMUM.reps.push(line(JT, d, "OSKO TO A BONETTI LOAN", -50000, {})); line(ML, d, "Repayment", 50000, {}); line(MU, d, "OSKO FROM P MULCAHY LOAN", 50000, {}); }
  trap("T6-MUM-LOAN", "A loan from her mother, whose own account is declared on the other side of every line", `${JT}: +30,000.00 ${inn.date}, then ${LOANMUM.reps.length} repayments of 500.00. ${ML} is declared as a debt, and each line also has a mirror on ${MU}`, "Neither income nor spending, and they owe the balance. The mirror on her account must not take the line away from the debt.",
    { kind: "lines", lines: [plain(inn, "neither"), plain(LOANMUM.reps[0], "neither"), plain(LOANMUM.reps[9], "neither")], balances: [{ account: ML, months: ["2024-10", "2025-06", "2026-01"] }] });
  const owed = 3000000 - LOANMUM.reps.reduce((t, x) => t - x.cents, 0);
  line(ML, DEATH, "Forgiven in her will", owed, {});
  trap("T6-LOAN-FORGIVEN", "A debt forgiven in a will: no bank line, closed in setup", `${ML}: ${money(owed)} owed at ${DEATH}. Her will forgives it and setup closes the account that day`, "The debt is gone from the day it closes, as an asset carried at a value is. Net worth rises and no income or spending moves.",
    { kind: "lines", zero_after: { account: ML, from: "2026-02" } }, { fresh: true, dc: true });
}

// ---------- the home loan: a fortnightly debit, packaged pay with no bank line, a redraw, a dishonour, a lump ----------
const RATES = [["2023-07-01", "6.39"], ["2025-02-20", "6.14"], ["2025-05-22", "5.89"], ["2025-08-14", "5.64"]];
const rateOn = (d) => RATES.filter((x) => x[0] <= d).pop()[1];
const HOMEPAY = 124000, HOME_OPEN = 41240000, LOANS = { moves: [], rows: [], lines: [] };
const HOMETEXT = `PING HOME LOAN ${NUM.home.slice(4)}`;
function homeRepayments() {
  const reps = [];
  for (let d = "2023-07-07"; d <= END; d = addDays(d, 14)) {
    if (d === "2024-08-16") {
      const x = spend(JT, d, HOMETEXT, HOMEPAY, "MORTGAGE"), y = line(JT, addDays(d, 3), `DISHONOUR REVERSAL ${HOMETEXT}`, HOMEPAY, { lens: "spending", cat: "MORTGAGE" }), z = spend(JT, addDays(d, 3), "DISHONOUR FEE", 900, "FEES"), w = spend(JT, addDays(d, 6), HOMETEXT, HOMEPAY, "MORTGAGE");
      trap("T6-DISHONOUR", "A home loan debit that bounces and is re-presented", `${JT}: ${x.date}, reversed ${y.date} with a 9.00 fee, debited again ${w.date}. The lender shows one repayment`, "The reversal cancels the first debit: the repayment counts once, the fee once, nothing is income.",
        { kind: "lines", lines: [plain(y, "spending"), plain(x, "spending"), plain(w, "spending"), plain(z, "spending")] });
      LOANS.moves.push({ date: addDays(d, 6), cents: HOMEPAY, desc: "REPAYMENT DIRECT DEBIT" });
    } else { reps.push(spend(JT, d, HOMETEXT, HOMEPAY, "MORTGAGE")); LOANS.moves.push({ date: d, cents: HOMEPAY, desc: "REPAYMENT DIRECT DEBIT" }); }
    count("loan_repayment");
  }
  for (const p of PACKS) LOANS.moves.push({ date: p.date, cents: p.cents, desc: "PAWPACK SALARY PACKAGING" });
  trap("T6-PACKAGED-PAY", "Salary packaging: part of her pay reaches the home loan before it reaches any bank account", `${HL}: ${PACKS.length} credits of ${money(PACK)}, "PAWPACK SALARY PACKAGING", on the lender's download and inside its statement. No bank line anywhere pays them, and the payslip shows the pay already reduced`, "The loan falls by what the lender shows. No line on a cash account is imputed for it, and no income or spending moves: the money never reached a cash account.",
    { kind: "lines", absent: [{ account: JT, date: PACKS[3].date, cents: -PACK }, { account: DE, date: PACKS[3].date, cents: -PACK }], balances: [{ account: HL, months: ["2023-09", "2024-02"] }] }, { fresh: true, dc: true });
  // a redraw for the stairlift deposit, in a month of three debits so that the statement's repayments net above nothing
  const threes = {}; for (const m of LOANS.moves) { const k = ymOf(m.date); threes[k] = (threes[k] || 0) + 1; }
  const month = Object.keys(threes).sort().find((k) => k >= "2025-01" && threes[k] >= 3), d = nextBiz(`${month}-20`);
  const rd = line(JT, d, `${HOMETEXT} REDRAW`, 350000, {}); LOANS.moves.push({ date: d, cents: -350000, desc: "REDRAW" });
  trap("T6-REDRAW", "A redraw: a credit from the lender the household pays every fortnight", `${JT} ${d}: +3,500.00, "${rd.desc}". The lender's download shows it, and its statement only nets it from the month's repayments`, "SPEC 6.5: a redraw has no category. Neither, and the loan rises. As a refund from someone paid, it is 3,500.00 of negative spending.",
    { kind: "lines", lines: [plain(rd, "neither")], balances: [{ account: HL, months: [month, nextMonth(month)] }] }, { fresh: true, dc: true });
  const lump = spend(SV, "2026-06-23", `${HOMETEXT} LUMP`, 10000000, "MORTGAGE"); LOANS.moves.push({ date: lump.date, cents: 10000000, desc: "ADDITIONAL REPAYMENT" });
  trap("T6-EXTRA-REPAY", "A lump repayment from a different account", `${SV} ${lump.date}, 100,000.00 to the home loan; the usual debit comes from ${JT}`, "Spending at its cash amount under MORTGAGE, by SPEC 6.5, and the loan falls by it.",
    { kind: "lines", lines: [plain(lump, "spending")], balances: [{ account: HL, months: ["2026-06"] }] });
  void reps;
}
function homeInterest() {
  let bal = -HOME_OPEN, accrued = 0;
  const mv = new Map(); for (const m of LOANS.moves) { if (!mv.has(m.date)) mv.set(m.date, []); mv.get(m.date).push(m); }
  const push = (d, desc, c) => { bal += c; LOANS.lines.push({ date: d, desc, cents: c, balance: bal }); line(HL, d, desc, c, {}); };
  for (const ym of MONTHS) {
    const open = bal; let paid = 0;
    for (let d = `${ym}-01`; d <= monthEnd(ym); d = addDays(d, 1)) {
      for (const m of mv.get(d) || []) { push(d, m.desc, m.cents); paid += m.cents; }
      accrued += Math.abs(bal) * Number(rateOn(d)) / 100 / 365;
    }
    const c = Math.round(accrued); accrued = 0; push(monthEnd(ym), "INTEREST CHARGED", -c);
    if (paid < 0) throw new Error(`a month of the PING statement nets below nothing: ${ym}`);
    LOANS.rows.push({ ym, rate: rateOn(monthEnd(ym)), open, interest: c, paid, close: bal });
  }
}

// ---------- assets ----------
const VALUES = { home: [], appraisal: null, mum: null };
function homeValues() {
  const r = rng("values"); let v = 78000000;
  VALUES.home.push(["2023-06-30", v]);
  for (const m of MONTHS) {
    if (Number(m.slice(5)) % 3 !== 0) continue;
    v = Math.round(v * (1 + r.range(0.002, 0.02)) / 100000) * 100000;
    if (m === "2024-03") v += 9000000;   // the flat
    VALUES.home.push([monthEnd(m), v]);
    if (m === "2024-03") { v += 1500000; VALUES.appraisal = ["2024-04-30", v]; VALUES.home.push(VALUES.appraisal); }
  }
  VALUES.home.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  VALUES.mum = ["2024-07-12", 62500000];
}
const lastVal = (list, e) => { const h = list.filter((x) => x[0] <= e); if (!h.length) throw new Error(`no estimate by ${e}`); return h[h.length - 1][1]; };
function assets() {
  const s = line(JT, VAN_SOLD, "OSKO FROM T HOWARD CARAVAN", 3150000, { capital: true });
  trap("T6-CARAVAN-SOLD", "A caravan sold to a stranger by Osko, to pay for the move", `${JT} ${s.date}: +31,500.00. ${VN} is typed in setup at 34,000.00, closed on that day`, "Capital, neither. The caravan leaves net worth on the day it goes, and the cash is not income or a refund.",
    { kind: "lines", lines: [plain(s, "neither")], zero_after: { account: VN, from: "2024-02" } });
}

// ---------- bills, cover, care ----------
const BILLS = { energy: [], water: [], rates: [], mumRates: [], policy: [], renewal: [], rego: [], health: [] };
function bills() {
  const r = rng("bills"), pows = [];
  for (const q of ["2023-09", "2023-12", "2024-03", "2024-06", "2024-09", "2024-12", "2025-03", "2025-06", "2025-09", "2025-12", "2026-03"]) {
    const billDate = `${nextMonth(q)}-06`, amt = cents(r, 390, 720), gst = Math.round(amt / 11), paid = addDays(billDate, 17), b = { billDate, due: addDays(billDate, 21), from: addDays(`${q}-01`, -61), to: monthEnd(q), amt, gst, account: "SC-7730915" };
    BILLS.energy.push(b); pows.push(spend(JT, paid, "BPAY SHIPWRECK COAST POWER 7730915", amt, "UTILITIES")); count("bill_paid");
  }
  let wrong = null;
  for (const q of ["2023-08", "2023-11", "2024-02", "2024-05", "2024-08", "2024-11", "2025-02", "2025-05", "2025-08", "2025-11", "2026-02", "2026-05"]) {
    const usage = cents(r, 90, 210), service = 7400, wb = `${q}-11`, wd = `${q}-27`, b = { billDate: wb, due: wd, from: addDays(wb, -92), to: addDays(wb, -2), usage, service, amt: usage + service };
    BILLS.water.push(b);
    if (q === "2025-05") {
      // she is logged on to the wrong profile: the household's water bill goes out of her mother's account, and she repays it nine days later
      line(MU, addDays(wd, -1), "BPAY WANNON REACH WATER 60331907", -b.amt, {}); line(MU, addDays(wd, 8), "OSKO FROM D BONETTI WATER", b.amt, {});
      wrong = spend(DE, addDays(wd, 8), "OSKO TO A BONETTI WATER", b.amt, "UTILITIES");
    } else { spend(JT, addDays(wd, -1), "BPAY WANNON REACH WATER 60331907", b.amt, "UTILITIES"); count("bill_paid"); }
  }
  trap("T6-WRONG-LOGIN", "The household's bill paid from her mother's account by mistake, and repaid", `A water bill of ${money(-wrong.cents)} due 2025-05-27 goes out of ${MU}. ${DE} ${wrong.date}: the same to "A BONETTI", opposite to the cent on two declared accounts, and the money is the household's own bill`, "Spending under UTILITIES: this is the only line that pays the household's water. Paired with her account as a transfer, the bill vanishes from spending.",
    { kind: "lines", lines: [plain(wrong, "spending")] }, { fresh: true, dc: true });
  for (const [d, n] of [["2023-09-04", 1], ["2024-03-04", 2], ["2024-09-02", 3], ["2025-03-03", 4], ["2025-09-01", 5], ["2026-03-02", 6]]) {
    const amt = 112000 + n * 3900, due = addDays(d, 30), from = d < "2024" || d.slice(5, 7) === "09" ? `${d.slice(0, 4)}-07-01` : `${d.slice(0, 4)}-01-01`, to = from.slice(5, 7) === "07" ? `${d.slice(0, 4)}-12-31` : `${d.slice(0, 4)}-06-30`;
    BILLS.rates.push({ billDate: d, due, from, to, amt, reference: `RI-${d.slice(0, 4)}-${n}`, assessment: NUM.assessment, property: HOME });
    spend(JT, addDays(due, -3), "BPAY WARRNAMBOOL COAST RATES 40112", amt, "RATES-HOME"); count("bill_paid");
  }
  // her old house's rates: the same council, the same biller, another assessment. Paid from the joint account and paid back that week
  const mr = [];
  for (const [d, n] of [["2023-09-04", 1], ["2024-03-04", 2]]) {
    const amt = 83400 + n * 2100, due = addDays(d, 30), from = n === 1 ? "2023-07-01" : "2024-01-01", to = n === 1 ? "2023-12-31" : "2024-06-30";
    BILLS.mumRates.push({ billDate: d, due, from, to, amt, reference: `RI-${d.slice(0, 4)}-M${n}`, assessment: NUM.mumAssessment, property: MUMHOUSE });
    const x = line(JT, addDays(due, -3), "BPAY WARRNAMBOOL COAST RATES 40877", -amt, {}), y = line(JT, addDays(due, 2), `OSKO FROM A BONETTI RATES`, amt, {}); line(MU, addDays(due, 2), "OSKO TO P MULCAHY RATES", -amt, {}); mr.push([x, y]);
  }
  trap("T6-MUM-RATES", "Her old house's rates: the same council, the same biller, one digit of reference apart, and someone else's", `${JT}: ${mr.map(([x]) => `${money(-x.cents)} on ${x.date}`).join(", ")}, "BPAY WARRNAMBOOL COAST RATES 40877", each paid back within the week. A notice with another assessment number sits in her folder`, "Neither, both ways. A contract or a dictionary sure of the council is sure of the wrong house. It takes a question or a rule, and silence scores silently wrong.",
    { kind: "lines", lines: mr.flatMap(([x, y]) => [plain(x, "neither"), plain(y, "neither")]) }, { fresh: true, dc: true });
  for (const [y, amt] of [[2023, 198000], [2024, 214000], [2025, 229000]]) { BILLS.policy.push({ kind: "Home", number: NUM.policyHome, from: `${y}-11-01`, to: `${y + 1}-10-31`, amt, paid: `${y}-10-20`, sum: 76000000, excess: 100000, situ: HOME.split(",")[0], label: "Building sum insured" }); spend(JT, `${y}-10-20`, `BPAY PURRSURE HOME ${NUM.policyHome}`, amt, "HOME-INS"); count("purchase"); }
  for (const [y, amt] of [[2023, 88000], [2024, 93000], [2025, 99000]]) { BILLS.renewal.push({ kind: "Motor", number: NUM.policyMotor, from: `${y}-08-01`, to: `${y + 1}-07-31`, amt, paid: `${y}-07-25`, sum: 1900000, excess: 80000, situ: "The Subaru", label: "Agreed value" }); spend(JT, `${y}-07-25`, `BPAY PURRSURE MOTOR ${NUM.policyMotor}`, amt, "CAR"); count("purchase"); }
  // the storm: a roof, an excess, and the insurer's cheque arrives after the roofer's bill
  const rf = spend(JT, "2025-02-03", "BPAY WARRNAMBOOL ROOFING 41120", 830000, "HOME-MAINT"), cl = line(JT, "2025-02-14", "PURRSURE CLAIM HC-88412", 730000, { lens: "spending", cat: "HOME-MAINT" });
  trap("T6-STORM-CLAIM", "An insurer pays a storm claim: the credit is a real recovery, in another category from its contract, above any premium ever paid", `${JT}: -8,300.00 to a roofer on ${rf.date}, +7,300.00 from Purrsure on ${cl.date}. The home policy's contract says HOME-INS, and the largest premium is ${money(229000)}`, "Lowers HOME-MAINT spending: the household's cost was the 1,000.00 excess. Not income, and it is not a refund of a premium. A rule that a credit above any payment is no refund is wrong here.",
    { kind: "lines", lines: [plain(rf, "spending"), plain(cl, "spending")] }, { fresh: true, dc: true });
  // the same district that was her employer sends Paul's day surgery bill, and refunds part of it
  const ps = spend(JT, "2025-02-11", "BPAY MOYNE COAST HEALTH PATIENT 4412", 64000, "HEALTH"), pr = line(JT, "2025-03-18", "MOYNE COAST HEALTH PATIENT REFUND", 21500, { lens: "spending", cat: "HEALTH" });
  trap("T6-PATIENT-REFUND", "A credit from a former employer that is a refund of a hospital bill", `${JT} ${pr.date}: +215.00, "${pr.desc}", from the party that was Dee's employer and took ${money(64000)} of patient fees the month before`, "Lowers HEALTH spending. An employer named in setup must not make a refund into wages.",
    { kind: "lines", lines: [plain(ps, "spending"), plain(pr, "spending")] }, { fresh: true, dc: true });
  // private health by the month, and a statement of the year that repeats it
  const prem = (d) => (d < "2024-04-01" ? 29400 : d < "2025-04-01" ? 30500 : 31600), hl = [];
  for (const ym of MONTHS) { const d = nextBiz(`${ym}-16`), x = spend(JT, d, "DIRECT DEBIT BUPAW HEALTH 7741", prem(d), "HEALTH"); hl.push(x); count("purchase"); }
  for (const fy of [2024, 2025, 2026]) { const ls = hl.filter((x) => fyOf(x.date) === fy); BILLS.health.push({ fy, premium: ls.reduce((t, x) => t - x.cents, 0), rebate: Math.round(ls.reduce((t, x) => t - x.cents, 0) * 0.2) }); }
  trap("T6-HEALTH-STATEMENT", "A health fund's statement of the year, over twelve monthly debits", `${JT}: ${hl.length} debits of about 300.00. Each Bupaw statement says what the year's premiums were, and there is no line of that amount`, "Spending at each debit. The statement is a witness and adds nothing.",
    { kind: "lines", lines: [hl[3], hl[17], hl[30]].map((x) => plain(x, "spending", { n: 1 })) }, { fresh: true, dc: true });
  // the car's rego, and a notice for the caravan after it was sold
  const reg = []; for (const y of [2023, 2024, 2025]) { const issue = `${y}-08-12`, due = `${y}-09-09`, amt = 81400 + (y - 2023) * 2600; BILLS.rego.push({ number: NUM.rego, vehicle: "Subaru wagon", issue, due, until: `${y + 1}-09-09`, amt, ref: `RN-${y}-1102` }); reg.push(spend(JT, addDays(due, -4), `BPAY VICPAWS REGO ${NUM.rego}`, amt, "CAR")); count("bill_paid"); }
  const vr = { number: NUM.regoVan, vehicle: "Jayco caravan", issue: "2024-03-19", due: "2024-04-16", until: "2025-04-16", amt: 22800, ref: "RN-2024-4721" }; BILLS.rego.push(vr);
  trap("T6-BILL-WITNESS", "A power bill, a rego notice and the bank lines that pay them", `${JT}: ${money(-pows[3].cents)} on ${pows[3].date}, ${money(-reg[1].cents)} on ${reg[1].date}`, "Spending once. Each bill clears against its line.", { kind: "lines", lines: [plain(pows[3], "spending", { n: 1 }), plain(reg[1], "spending", { n: 1 })] });
  trap("T6-REGO-AFTER-SALE", "A rego notice for a caravan sold six weeks before", `A notice of ${money(vr.amt)} dated ${vr.issue} for ${vr.number}. No account pays it: the registration has gone with the van`, "Nothing in the cash lens. A bill is a witness and not an expense. A bill with no payment may be asked about, and only a cost booked with no line is scored.",
    { kind: "lines", absent: [{ account: JT, date: vr.due, cents: -vr.amt }] }, { fresh: true });
}
function mumOnCard() {
  // from the day she moves in, what she needs goes on the household's card, and once a month she pays it back as one lump to Dee's account
  const r = rng("mumcard"), after = [], byMonth = {}, feeLines = [], fees = {};
  for (let d = MOVE_IN; d <= "2026-01-31"; d = addDays(d, 1)) {
    if (r.next() > 0.2) continue;
    const m = r.pick(MER.care), c = cents(r, 12, 160), x = card(r, d, m, c, null, { lens: null, extra: { mum: true } }); after.push(x); const k = ymOf(d); byMonth[k] = (byMonth[k] || 0) + c;
  }
  // her specialist goes on the card too, and Medicare's refund for it reaches Dee's own account
  const sp = [["2024-06-11", 28000, 13240], ["2025-04-08", 31000, 14785]].map(([d, c, back]) => { const x = card(r, d, ["DR NAIR SPECIALIST ROOMS", "WARRNAMBOOL"], c, null, { lens: null, lag: 1, extra: { mum: true } }), y = line(DE, addDays(d, 3), "SERVICES AUSTRALIA MEDICARE 3318", back, {}); const k = ymOf(d); byMonth[k] = (byMonth[k] || 0) + c - back; return [x, y]; });
  trap("T6-MUM-MEDICARE", "A Medicare refund for her mother's claim, on Dee's own account, beside the household's own", `${DE}: ${sp.map(([, y]) => `${money(y.cents)} on ${y.date}`).join(", ")}, "SERVICES AUSTRALIA MEDICARE 3318". ${JT} takes the household's own under 2291`, "Neither, as the specialist's bill on the card is. As a refund of HEALTH, spending comes out low for money that was never the household's cost.",
    { kind: "lines", lines: sp.flatMap(([x, y]) => [plain(x, "neither", { n: 1 }), plain(y, "neither")]) }, { fresh: true, dc: true });
  // the aged-care home's monthly fee: Dee set it up on her own account at admission, and said so at onboarding
  for (const ym of monthRange("2025-07", "2026-01")) { const d = nextBiz(`${ym}-08`), c = cents(r, 1580, 1660), o = line(DE, d, "BPAY LAKESIDE AGED CARE 5521", -c, {}); feeLines.push(o); fees[ym] = c; byMonth[ym] = (byMonth[ym] || 0) + c; count("care_fee"); }
  const backs = [];
  for (const k of Object.keys(byMonth).sort()) { const d = nextBiz(`${nextMonth(k)}-06`); if (d > DEATH) throw new Error(`a lump after her death: ${d}`); line(MU, d, "OSKO TO D BONETTI REIMB", -byMonth[k], {}); backs.push(line(DE, d, fromMum(d, "REIMB"), byMonth[k], {})); count("reimb"); }
  const tot = (a) => a.reduce((t, x) => t + Math.abs(x.cents), 0);
  trap("T6-MUM-ON-CARD", "Her chemist and her podiatrist on the household's card, paid back each month as one lump", `${CC}: ${after.length} lines worth ${money(tot(after))} from ${MOVE_IN}, one merchant the household uses too. ${DE}: ${backs.length} monthly credits, each the month's sum, under her name and then under Dee's`, "SPEC 4.4c: her money, neither spending nor income, on either side. If the lines are spending and the lump is a refund or a transfer, spending is high by the whole amount and every total adds. Same chemist as the household's own, opposite truth. No line equals the lump.",
    { kind: "lines", lines: [...[after[6], after[60], after[after.length - 4]].map((x) => plain(x, "neither", { n: 1 })), ...[backs[1], backs[12], backs[backs.length - 2]].map((x) => plain(x, "neither"))] });
  trap("T6-CARE-FEES", "Fees paid for a parent, and paid back, under a surname a member shares", `${DE}: ${feeLines.length} debits to the aged-care home, inside the monthly lumps. Setup says the home's contract is PASS-THROUGH`, "Neither spending nor income. The home's contract says so at onboarding; her repayments are the other side.",
    { kind: "lines", lines: [plain(feeLines[1], "neither"), plain(feeLines[5], "neither")] });
  // Carlo in Perth sends his share to Dee, and she passes it on each quarter
  const cs = [], sends = []; let held = 0, n = 0;
  for (const ym of monthRange("2024-04", "2026-01")) {
    cs.push(line(DE, nextBiz(`${ym}-15`), "OSKO FROM C BONETTI MUM CARE", 25000, {})); held += 25000; n += 1;
    if (n % 3 === 0) { const d = nextBiz(`${nextMonth(ym)}-02`); sends.push(line(DE, d, "OSKO TO A BONETTI CARLO SHARE", -held, {})); line(MU, d, "OSKO FROM D BONETTI CARLO SHARE", held, {}); held = 0; }
  }
  if (held) { const d = "2026-02-02"; sends.push(line(DE, d, "OSKO TO A BONETTI CARLO SHARE", -held, {})); line(MU, d, "OSKO FROM D BONETTI CARLO SHARE", held, {}); }
  trap("T6-SIBLING-SHARE", "A brother's monthly share of their mother's care, through Dee's account", `${DE}: ${cs.length} credits of 250.00 from ${CARLO}, ${sends.length} debits of the quarter's sum to ${MU}`, "Neither, both ways. Not a gift to Dee, and what goes on is not spending.",
    { kind: "lines", lines: [plain(cs[2], "neither"), plain(cs[12], "neither"), plain(sends[1], "neither"), plain(sends[4], "neither")] }, { fresh: true, dc: true });
}
function estate() {
  // the funeral on the card, paid back by the estate; two estate payments, one half her brother's; the joint saver passes to her by survivorship
  const r = rng("estate"), f = card(r, "2026-02-16", ["TOWER HILL FUNERALS", "WARRNAMBOOL"], 948000, null, { lens: null, lag: 1, extra: { mum: true } }), fb = line(JT, "2026-03-24", "BRAUER LEGAL TRUST FUNERAL A BONETTI", 948000, {});
  trap("T6-FUNERAL", "A funeral on the card, paid back by the solicitor who also pays the inheritance", `${CC} ${f.date}: -9,480.00. ${JT} ${fb.date}: +9,480.00 from the trust account`, "Neither, both ways: the estate's cost. On one trust account, one credit is a repayment and two are an inheritance.",
    { kind: "lines", lines: [plain(f, "neither", { n: 1 }), plain(fb, "neither")] }, { fresh: true, dc: true });
  const e1 = earn(SV, "2026-04-28", "BRAUER LEGAL ESTATE A BONETTI", 10000000, "GIFT-IN", { part: 5000000 }), e2 = earn(SV, "2026-06-16", "BRAUER LEGAL ESTATE A BONETTI", 18640000, "GIFT-IN");
  const t = line(SV, "2026-04-29", "OSKO TO C BONETTI ESTATE SHARE", -5000000, {}); count("estate_distribution", 2);
  trap("T6-ESTATE", "An inheritance from a solicitor's trust account", `${SV} ${e2.date}: ${money(e2.cents)}, "BRAUER LEGAL ESTATE A BONETTI"`, "Income under GIFT-IN, SPEC's public category, in the cash lens. A person can only tell it apart by saying so, so a question counts as flagged.",
    { kind: "lines", lines: [plain(e2, "income")] });
  trap("T6-BROTHER-SHARE", "One estate credit holding a third party's share, passed on next day", `${SV} ${e1.date} ${money(e1.cents)}, half of it Carlo's, ${money(-t.cents)} out to him ${t.date}`, "Income is 50,000.00, not 100,000.00, and 50,000.00 is not spending.",
    { kind: "lines", lines: [plain(t, "neither")] });
  line(MU, MUM_CLOSE, "BRAUER LEGAL TRUST ESTATE TRANSFER", 0, { closeMum: true });
}

// ---------- super ----------
const SUPER = { paul: [], dee: [] };
function superFunds() {
  const r = rng("super");
  const sumFor = (who, emp, from, to) => PAY.slips.filter((s) => s.person === who && s.employer === emp && s.payDate >= from && s.payDate <= to).reduce((t, s) => t + s.super, 0);
  // his fund: the guarantee a quarter behind, and the annual statement over it
  const list = [];
  for (const [d, from, to] of [["2023-10-24", "2023-07-01", "2023-09-30"], ["2024-01-25", "2023-10-01", "2023-12-31"], ["2024-04-24", "2024-01-01", "2024-03-31"], ["2024-07-24", "2024-04-01", "2024-06-30"], ["2024-10-24", "2024-07-01", "2024-09-30"], ["2025-01-24", "2024-10-01", "2024-12-31"], ["2025-04-24", "2025-01-01", "2025-03-31"], ["2025-07-24", "2025-04-01", "2025-06-30"], ["2025-10-24", "2025-07-01", "2025-09-30"], ["2026-01-23", "2025-10-01", "2025-12-31"], ["2026-04-24", "2026-01-01", "2026-03-31"]]) { const c = sumFor(PAUL, DAIRY, from, to); list.push({ date: d, type: "employer", desc: "SG contribution Merri River Dairy", cents: c }); list.push({ date: d, type: "contributions_tax", desc: "Contributions tax", cents: -Math.round(c * 0.15) }); }
  let bal = OPEN[SP]; const out = [];
  for (const ym of MONTHS) {
    for (const x of list.filter((l) => ymOf(l.date) === ym)) { bal += x.cents; out.push({ ...x, balance: bal }); }
    const e = monthEnd(ym), earned = Math.round(bal * r.range(-0.009, 0.015)); bal += earned; out.push({ date: e, type: "earnings", desc: "Investment earnings", cents: earned, balance: bal });
    bal -= 840; out.push({ date: e, type: "fee", desc: "Administration fee", cents: -840, balance: bal }); bal -= 1460; out.push({ date: e, type: "insurance", desc: "Insurance premium", cents: -1460, balance: bal });
  }
  SUPER.paul = out; for (const x of out) line(SP, x.date, x.desc, x.cents, { superType: x.type });
  // her fund: monthly while she worked, nothing while she cared for her mother, and a spouse contribution from the savings account
  const dl = [];
  for (const ym of MONTHS) { const prev = monthRange("2023-06", ym).slice(-2)[0]; const c = sumFor(DEE, MOYNE, `${prev}-01`, monthEnd(prev)); if (c) { dl.push({ date: `${ym}-14`, type: "employer", desc: "SG contribution Moyne Coast Health", cents: c }); dl.push({ date: `${ym}-14`, type: "contributions_tax", desc: "Contributions tax", cents: -Math.round(c * 0.15) }); } }
  const sp = line(SV, "2025-06-20", "BPAY PURRANNUATION SPOUSE 40221", -300000, {});
  dl.push({ date: "2025-06-24", type: "spouse", desc: "Spouse contribution", cents: 300000 });
  B.transit.push({ from: sp.date, until: "2025-06-24", cents: 300000 });
  let m = OPEN[SD]; const mo = [];
  for (const ym of MONTHS) {
    for (const x of dl.filter((l) => ymOf(l.date) === ym).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))) { m += x.cents; mo.push({ ...x, balance: m }); }
    const e = monthEnd(ym), earned = Math.round(m * r.range(-0.011, 0.017)); m += earned; mo.push({ date: e, type: "earnings", desc: "Investment earnings", cents: earned, balance: m });
    m -= 620; mo.push({ date: e, type: "fee", desc: "Administration fee", cents: -620, balance: m });
  }
  SUPER.dee = mo; for (const x of mo) line(SD, x.date, x.desc, x.cents, { superType: x.type });
  trap("T6-PERSONAL-SUPER", "A spouse contribution to super by BPAY, on a line type no public recipe names", `${SV} ${sp.date}: -3,000.00, "${sp.desc}". ${SD}: +3,000.00 four days later, transaction type "Spouse Contribution", which purrannuation-csv-v1 sends to other`, "Own money moving between savings and the fund. Neither spending nor income, and the fund's balance takes it once.",
    { kind: "lines", lines: [plain(sp, "neither")], balances: [{ account: SD, months: ["2025-06", "2025-12"] }] });
}

// ---------- tax, as a person pays it ----------
const TAX = { notices: [] };
function taxes() {
  const sum = (fy, who) => PAY.slips.filter((s) => s.person === who && s.fy === fy).reduce((t, s) => t + s.tax, 0);
  const note = (person, fy, version, lodged, assessed, ti, payg, result) => { const medicare = Math.round(ti * 0.02), gross = Math.max(0, payg - result - medicare); const n = { person, fy, version, lodged, assessed, ti, payg, help: 0, other: 0, gross, medicare, offsets: 0, result }; TAX.notices.push(n); count("tax_assessment"); return n; };
  note(PAUL, 2023, 1, "2023-10-03", "2023-10-17", 9140000, 1912000, 142000);
  note(PAUL, 2024, 1, "2024-10-08", "2024-10-22", 9620000, sum(2024, PAUL), 188000);
  note(PAUL, 2025, 1, "2025-10-07", "2025-10-21", 9980000, sum(2025, PAUL), 124000);
  note(DEE, 2023, 1, "2023-08-01", "2023-08-15", 6210000, 1006000, 91000);
  note(DEE, 2024, 1, "2024-08-06", "2024-08-20", 5140000, sum(2024, DEE), 64000);
  note(DEE, 2025, 1, "2025-09-30", "2025-10-14", 2960000, sum(2025, DEE), -186000);
  const a = line(JT, "2023-10-20", "ATO EFT REFUND 7720423", 142000, { tax: true }), b = line(DE, "2023-08-18", "ATO EFT REFUND 7720423", 91000, { tax: true }), c = line(DE, "2024-08-23", "ATO EFT REFUND 7720424", 64000, { tax: true }), e = line(JT, "2024-10-25", "ATO EFT REFUND 7720424", 188000, { tax: true }), f = line(JT, "2025-10-24", "ATO EFT REFUND 7720425", 124000, { tax: true });
  trap("T6-TAX-REFUND", "A tax refund", `${JT} ${a.date}, ${e.date}, ${f.date} and ${DE} ${b.date}, ${c.date}, each the figure on its notice`, "Neither income nor spending: TAX-REFUND is a transfer with the tax position.",
    { kind: "lines", lines: [a, b, c, e, f].map((x) => plain(x, "neither")) });
  const plan = ["2025-11-14", "2025-12-12"].map((d) => line(JT, d, "BPAY ATO 551004412339221", -93000, { tax: true })); count("tax_payment", plan.length);
  trap("T6-TAX-BILL", "A notice with a bill on it, paid in two parts", `${JT}: ${plan.length} debits of 930.00 from ${plan[0].date}, against a notice of -1,860.00: Carer Payment is taxable and nothing was withheld`, "Neither income nor spending, in either part.",
    { kind: "lines", lines: plan.map((x) => plain(x, "neither")) });
}

// ---------- lines that look like each other ----------
function lineTraps() {
  const r = rng("traps");
  const c = spend(JT, "2024-05-14", "OSKO TO R MULCAHY FOOTY TIPS", 25000, "GIFTS"), d = earn(SV, "2024-05-15", "OSKO FROM S MULCAHY BIRTHDAY", 25000, "GIFT-IN"); count("purchase");
  trap("T6-FALSE-PAIR", "Two unrelated Oskos, one surname, one amount, a day apart, on two own accounts", `${JT} ${c.date} -250.00 to one man; ${SV} ${d.date} +250.00 from his cousin`, "Spending and income. If they pair, 250.00 of each vanishes and nothing says so.",
    { kind: "lines", lines: [plain(c, "spending"), plain(d, "income")] });
  const e = card(r, "2025-06-04", ["CANOPY OUTDOOR", "ONLINE"], 18900, "SHOPPING", { lag: 1 }), f = line(DE, "2025-06-13", "CANOPY OUTDOOR REFUND", 18900, { lens: "spending", cat: "SHOPPING" });
  trap("T6-REFUND-STREAM", "A refund that reaches a different stream from the charge", `${CC} ${e.date} -189.00; ${DE} ${f.date} +189.00`, "Lowers SHOPPING spending. Not income, and not a transfer.",
    { kind: "lines", lines: [plain(e, "spending", { n: 1 }), plain(f, "spending")] });
  const auth = card(r, "2024-09-24", ["REEF STAY DENPASAR", "ID"], 62640, "HOLIDAYS", { posted: "2024-10-02", desc: "REEF STAY DENPASAR ID USD 412.00", csv: `${"REEF STAY DENPASAR".padEnd(26)}ID  USD 412.00`, extra: { authCents: 62018, authFile: "2024-07-01" } });
  trap("T6-FX-REPRICE", "A foreign charge whose AUD changes between authorisation and posting", `${CC} ${auth.date}: the download cut 09-30 shows 620.18 pending; the next, which overlaps, shows 626.40 posted 10-02`, "One charge of 626.40.",
    { kind: "lines", lines: [plain(auth, "spending", { n: 1 })], absent: [{ account: CC, date: auth.date, cents: -62018 }] });
  const xm = card(r, "2024-12-23", ["GILLES ST CLOTHING", "WARRNAMBOOL"], 27450, "SHOPPING", { lag: 5 }), xn = card(r, "2025-12-22", ["TOWER HILL HOMEWARES", "KOROIT"], 16820, "SHOPPING", { lag: 5 });
  trap("T6-HOLIDAY-LAG", "A charge that posts five business days later across Christmas and New Year", `${CC}: ${xm.date} posted ${xm.posted}, ${xn.date} posted ${xn.posted}`, "One purchase, in the month charged.",
    { kind: "lines", lines: [plain(xm, "spending", { n: 1, month: "2024-12" }), plain(xn, "spending", { n: 1, month: "2025-12" })] });
  const lift = card(r, "2024-04-16", ["ACORN ACCESS LIFTS", "GEELONG"], 428000, "HOME-MAINT", { lag: 2 }); count("purchase");
  BILLS.invoice = { merchant: "Acorn Access Lifts", date: lift.date, item: "Stairlift, straight rail", cents: 428000, gst: 38909, serial: "AL-22094", until: "2029-04-16", payment: `Card ending ${NUM.card}` };
  trap("T6-INVOICE", "One purchase on a statement, an activity download and a tax invoice", `${CC} ${lift.date}: -4,280.00, a stairlift, posted two business days later, with a PDF tax invoice`, "One purchase. The invoice adds detail and no cost.",
    { kind: "lines", lines: [plain(lift, "spending", { n: 1 })] });
}

// ---------- traps that live in how the files were downloaded ----------
const SV_WINDOWS = [], STATEMENT_MISSING = "2025-08-14";
function quarters(a, b) { const out = []; const ms = monthRange(a, b); for (let i = 0; i < ms.length; i += 3) out.push([`${ms[i]}-01`, monthEnd(ms[i + 2])]); return out; }
function windows() { for (const [from, to] of quarters("2023-07", "2026-06")) SV_WINDOWS.push(from === "2024-10-01" ? ["2024-08-12", to] : [from, to]); }
const STRAY = { lines: [] };
function strayFile() {
  const d0 = "2025-07-01"; let bal = 51244019;
  const add = (d, t, c) => { bal += c; STRAY.lines.push({ date: d, desc: t, cents: c, balance: bal }); };
  add("2025-07-10", "TFR LAKESIDE CARE RAD TS3318842", -42000000);
  add("2025-07-31", "INTEREST CREDIT TS3318842", 58112);
  add("2025-08-05", "TFR A BONETTI TS3318842", -600000);
  add("2025-08-29", "INTEREST CREDIT TS3318842", 31090);
  add("2025-09-30", "INTEREST CREDIT TS3318842", 29845);
  trap("T6-STRAY-FILE", "A quarter of her term saver, saved under the household's saver with the same bank and the same layout", `sources/${SV}: one Wattle OFX of ${STRAY.lines.length} lines, July to September 2025, ${money(-STRAY.lines[0].cents)} out to the aged-care home, numbered ${NUM.mumSaver}. That number is in no alias. ${SV} is open and takes a file of its own that quarter, under the same name with (1) after it`, "None of it is the household's. A file for an account nobody declared must not reach income, spending, a balance or a pairing. Being left unposted, or held with a question, is right. Being posted to the open saver because of the folder is the worst of it.",
    { kind: "lines", stray: { match: "TS3318842" }, absent: [{ account: SV, date: "2025-07-10", cents: -42000000 }], balances: [{ account: SV, months: ["2025-07", "2025-09"] }], cap: [{ month: "2025-07", metric: "spending", under: 42000000, account: SV, date: "2025-07-10", cents: -42000000 }] }, { dc: true });
  void d0;
}
function fileTraps() {
  const over = B.lines.filter((x) => x.acct === SV && x.date >= "2024-08-12" && x.date <= "2024-09-30").sort(byTime);
  const uniq = over.filter((x) => !over.some((y) => y !== x && y.date === x.date && y.cents === x.cents));
  trap("T6-OFX-OVERLAP", "Two overlapping OFX downloads whose FITIDs are renumbered in each file", `${SV}: the file from 2024-08-12 overlaps the September quarter by ${over.length} lines, the same line under a different FITID in each`, "One line each, and the saver follows.",
    { kind: "lines", lines: uniq.slice(0, 6).map((x) => plain(x, x.lens || "neither", { n: 1 })), balances: [{ account: SV, months: ["2024-09", "2024-10"] }] });
  const hole = B.lines.filter((x) => x.acct === JT && x.date >= TRUNC_FROM && x.date <= TRUNC_TO);
  trap("T6-TRUNCATED", "A download cut short, on an account with a running balance", `${JT}: the March quarter's file stops at 2025-03-10. ${hole.length} lines worth ${money(hole.reduce((t, x) => t + x.cents, 0))} are in no file, and the next file's first running balance is honest`, "The engine cannot know the lines. It must say the balance does not chain, for that account and that month.",
    { kind: "hole", account: JT, month: "2025-03", net_cents: hole.reduce((t, x) => t + x.cents, 0), line_count: hole.length, match: /2025-0[34]/.source });
  const lagged = B.lines.filter((x) => x.acct === CC && x.cents < 0 && x.posted && x.posted !== x.date), lagDays = {};
  for (const x of lagged) { const d = dayDiff(x.date, x.posted); lagDays[d] = (lagDays[d] || 0) + 1; }
  trap("T6-POSTING-LAG", "Every card line in two files, dated differently", `${CC}: ${lagged.length} lines post after they are charged, by ${Object.entries(lagDays).map(([d, n]) => `${d} days (${n})`).join(", ")}. The monthly statement, cut on the 14th, shows the charge date; the quarterly activity file the posting date`, "One purchase, two witnesses, whatever the gap. A line the engine cannot match across files is asked about, not counted twice in silence.",
    { kind: "card_lag", account: CC, lagged: lagged.length, by_days: lagDays });
  const cross = B.lines.filter((x) => x.acct === CC && x.lens === "spending" && x.date >= START && x.cents < 0 && x.posted && ymOf(x.posted) !== ymOf(x.date)).sort(byTime);
  trap("T6-DATE-BASIS", "A card charge dated in one month, posted in the next", `${CC}: ${cross.length} lines. Budgets read the charge date. Six sampled`, "SPEC 6.5: a purchase counts when charged, and it is one line.",
    { kind: "lines", lines: [0, 1, 2, 3, 4, 5].map((i) => { let j = Math.floor(i * cross.length / 6); while (posted(cross[j]) >= "2025-07-15" && posted(cross[j]) <= STATEMENT_MISSING) j += 1; return cross[j]; }).map((x) => plain(x, "spending", { n: 1, month: ymOf(x.date) })) });
  trap("T6-STATEMENT-GAP", "A card statement never downloaded", `The statement closing ${STATEMENT_MISSING} is missing`, "The lines stay, on their posting dates. Coverage names the missing statement.",
    { kind: "gap", stream: "STM-CARD", month: STATEMENT_MISSING.slice(0, 7) });
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
    if (due <= END && close > 0) own(JT, due, `AMEWX DIRECT DEBIT ${NUM.card}`, CC, post, "PAYMENT RECEIVED - THANK YOU", close, { posted: post, csv: "PAYMENT RECEIVED - THANK YOU", member: PAUL });
    prev = close; start = addDays(end, 1);
  }
}
/* the household watches two accounts: each Monday the joint is topped up from the saver or sweeps back to it, and Dee's is topped up from the joint or sweeps into it */
function sweeps() {
  const lowOf = (acct, d) => { let bal = OPEN[acct], low = Infinity, now = OPEN[acct]; for (const x of B.lines.filter((l) => l.acct === acct).sort(byTime)) { bal += x.cents; if (x.date < d) now = bal; if (x.date >= d && x.date <= addDays(d, 8)) low = Math.min(low, bal); } return Math.min(low, now); };
  for (let d = "2023-07-03"; d <= END; d = addDays(d, 7)) {
    if (d === "2024-08-12") continue;  // nobody watches it that week, and the home loan's debit bounces
    { const low = lowOf(JT, d); if (low < 80000) { const c = Math.ceil((250000 - low) / 10000) * 10000; own(SV, d, "OSKO TO JOINT 8806", JT, d, "OSKO FROM D BONETTI SAVINGS", c); } else if (low > 900000) { const c = Math.floor((low - 500000) / 10000) * 10000; own(JT, d, "OSKO TO SAVINGS 0877", SV, d, "OSKO FROM JOINT 8806", c); } }
    { const low = lowOf(DE, d); if (low < 40000) { const c = Math.ceil((120000 - low) / 10000) * 10000; own(JT, d, "OSKO TO D BONETTI", DE, d, "OSKO FROM P MULCAHY", c); } else if (low > 300000) { const c = Math.floor((low - 150000) / 10000) * 10000; own(DE, d, "OSKO TO JOINT 8806", JT, d, "OSKO FROM D BONETTI", c); } }
  }
}
function interestCredits() {
  let bal = OPEN[SV];
  for (const ym of MONTHS) { bal += B.lines.filter((x) => x.acct === SV && ymOf(x.date) === ym).reduce((t, x) => t + x.cents, 0); const i = Math.round(bal * 0.04 / 12); if (i > 0) { earn(SV, monthEnd(ym), "INTEREST CREDIT", i, "INTEREST"); bal += i; count("interest_credit"); } }
}
function closeMum() {
  const x = B.lines.find((l) => l.closeMum), left = OPEN[MU] + B.lines.filter((l) => l.acct === MU && l !== x).reduce((t, l) => t + l.cents, 0);
  if (left < 0) throw new Error("her account closes overdrawn");
  x.cents = -left;
  const [a, b] = own(MJ, MJ_CLOSE, "OSKO TO SAVINGS 0877", SV, MJ_CLOSE, "OSKO FROM A AND D BONETTI", OPEN[MJ] + B.lines.filter((l) => l.acct === MJ).reduce((t, l) => t + l.cents, 0));
  MUMCO.jclose = [a, b];
}

// ---------- truth, from the simulation alone ----------
const OPEN = { [JT]: 420000, [DE]: 180000, [SV]: 5800000, [CC]: -190000, [HL]: -HOME_OPEN, [ML]: 0, [MU]: 1100000, [MJ]: 1240000, [SP]: 31800000, [SD]: 18400000 };
const CAR_VALUE = 1900000, VAN_VALUE = 3400000;
function chain(acct) { let bal = OPEN[acct] || 0; return B.lines.filter((x) => x.acct === acct).sort(acct === CC ? byPost : byTime).map((x) => { bal += x.cents; x.balance = bal; return x; }); }
function truthBalances() {
  const acctsChain = [JT, DE, SV, CC, HL, ML, MU, MJ, SP, SD];
  const chains = {}; for (const a of acctsChain) chains[a] = chain(a);
  const assets = [...acctsChain, HO, CR, VN];
  const balances = {}; for (const a of assets) balances[a] = {};
  for (const m of MONTHS) {
    const e = monthEnd(m);
    for (const a of acctsChain) { const upTo = chains[a].filter((x) => (a === CC ? posted(x) : x.date) <= e), last = upTo[upTo.length - 1]; balances[a][m] = last ? last.balance : OPEN[a] || 0; }
    balances[HO][m] = lastVal(VALUES.home, e); balances[CR][m] = CAR_VALUE; balances[VN][m] = e < VAN_SOLD ? VAN_VALUE : 0;
  }
  return { balances, chains, assets };
}
/* traps whose probes read a balance, set once the chains are known */
function lateTraps({ balances }) {
  const a = MUMCO.sale;
  trap("T6-NOT-OURS", "Her own account, declared and owned by her alone: a house sale, a pension, a term saver, none of it the household's", `${MU}: declared in setup as hers, in the memo group and out of scope, because Dee runs it and holds its files. ${money(a.cents)} lands on ${a.date} and ${money(-MUMCO.onward.cents)} goes out on ${MUMCO.onward.date}`, "SPEC 6.5 and 6.6: the cash lens reads the cash group, and a household holds what its members own. No line of it is income or spending, and it stands outside net worth whole.",
    { kind: "lines", cap: [{ month: "2024-09", metric: "income", under: 50000000, account: MU, date: a.date, cents: a.cents }, { month: "2024-09", metric: "spending", under: 45000000, account: MU, date: MUMCO.onward.date, cents: MUMCO.onward.cents }], excluded: ["2024-06", "2024-09", "2025-06"].map((m) => ({ group: "memo", accounts: [MU], named: MU, month: m, want: balances[MU][m] })) }, { fresh: true, dc: true });
  trap("T6-BENEFICIAL-JOINT", "A saver with Dee's name on it and all of it her mother's", `${MJ}: legally half Dee's, beneficially and for tax all her mother's, in setup by basis. ${money(OPEN[MJ])} to start, in the cash group because it is a bank account with a member's name on it`, "SPEC 4.3 and 6.6: a joint account can be beneficially one person's, and she is no member. Net worth counts none of it, and its interest and withdrawals are neither.",
    { kind: "lines", lines: [plain(MUMCO.ints[3], "neither"), plain(MUMCO.ints[7], "neither"), plain(MUMCO.jwd, "neither")], excluded: ["2023-09", "2024-12", "2025-12"].map((m) => ({ group: "cash", accounts: "cash", named: MJ, month: m, want: balances[MJ][m], tolerance: 1 })) }, { fresh: true, dc: true });
  trap("T6-SURVIVORSHIP", "When her mother dies the joint saver is Dee's by survivorship, with no line on any account", `${MJ}: on ${DEATH} setup moves it to Dee on every basis. ${money(balances[MJ]["2026-02"])} enters net worth with no cash line, and on ${MJ_CLOSE} it moves to ${SV}`, "Net worth counts it whole from that day, and the transfer that empties it is neither. It is no income: nothing in the cash lens moved.",
    { kind: "lines", lines: MUMCO.jclose.map((x) => plain(x, "neither")), excluded: [{ group: "cash", accounts: "cash", named: MJ, month: "2026-02", want: 0, tolerance: 1 }] }, { fresh: true, dc: true });
  trap("T6-MUM-SETTLEMENT", "The settlement statement for her house, in the template the public recipe reads, for a property nobody declared", `sources/MUM-PAPERS: "Settlement statement, ${MUMHOUSE}", reading as a purchase of ${money(65200000)}, cash paid ${money(15530000)} and a loan drawn from a lender the household has never met`, "Her buyer's figures, and nothing of the household's. No asset, no cash, no loan moves, whatever the file reads as.",
    { kind: "lines", balances: [{ account: HO, months: ["2024-09", "2024-12"] }], absent: [{ account: JT, date: MUM_SOLD, cents: -15530000 }, { account: SV, date: MUM_SOLD, cents: -15530000 }], cap: [{ month: "2024-09", metric: "spending", under: 15000000, account: JT, date: MUM_SOLD, cents: -15530000 }] }, { fresh: true, dc: true });
  trap("T6-MUM-APPRAISAL", "A valuer's opinion of her house, in the same template as the valuer's opinion of theirs", `sources/MUM-PAPERS: an opinion of ${money(VALUES.mum[1])} on ${MUMHOUSE} dated ${VALUES.mum[0]}, for the means test. ${HO} holds an opinion from the same valuer dated ${VALUES.appraisal[0]}. The household owns one property and one is named in the alias table`, "It moves nothing. A valuation of a subject no alias holds is not a valuation of the only property in the book. If it lands on the home, net worth falls by about 300,000.00 until the next estimate.",
    { kind: "lines", balances: [{ account: HO, months: ["2024-07", "2024-08", "2024-09"] }] }, { fresh: true, dc: true });
}
function truth(t) {
  const { balances, chains, assets } = t;
  const income = {}, spending = {}, byCat = {}, networth = {}, transit = {}, heldOut = {};
  for (const m of MONTHS) { income[m] = 0; spending[m] = 0; byCat[m] = {}; }
  for (const x of B.lines) {
    const m = ymOf(x.date); if (!(m in income) || !x.lens) continue;
    if (!CASH.includes(x.acct)) throw new Error(`lens on a non-cash account ${x.acct}`);
    const c = x.part != null ? x.part : x.cents;
    if (x.lens === "income") income[m] += c; else { spending[m] -= c; byCat[m][x.cat] = (byCat[m][x.cat] || 0) - c; }
  }
  const skip = (a, m) => a === MU || (a === MJ && monthEnd(m) < DEATH);
  for (const m of MONTHS) {
    const e = monthEnd(m);
    transit[m] = B.transit.filter((x) => x.from <= e && x.until > e).reduce((s, x) => s + x.cents, 0);
    networth[m] = assets.filter((a) => !skip(a, m)).reduce((s, a) => s + balances[a][m], 0) + transit[m];
    heldOut[m] = monthEnd(m) < DEATH ? balances[MJ][m] : 0;
  }
  return {
    household: "Mulcahy-Bonetti, fictional, Warrnambool VIC", window: [START, END],
    definitions: {
      income: "SPEC 6.5 cash lens: money into reporting-group cash accounts in categories of kind income with cash_lens true, on the day the bank shows it. Wages at the net banked, Carer Payment, Carer Allowance, the Carer Supplement and the bereavement lump, board from her mother and from Liam, gifts and the inheritance under GIFT-IN, interest on the household's saver. An overpayment taken back is a negative in income.",
      spending: "SPEC 6.5 cash lens: money out of cash accounts in expense categories with cash_lens true, net of refunds, Medicare and an insurer's claim. Card purchases on the charge date. Loan repayments at their cash amount, the lump included. An ATM withdrawal when it is withdrawn.",
      left_out: "Own transfers, card payments, tax refunds and payments, a spouse super contribution, the redraw, the loan from her mother and its repayments, the caravan sale, and every dollar of hers that crosses the household's rails: the flat's money and the builder's claims, the nominee pension and its forwarding, her purchases on the card and the lumps that repay them, her Medicare, the aged-care fees, her rates, the top-ups, Carlo's share, the funeral and its repayment. Nothing on her account or her term saver.",
      balances: "Month-end, holder's sign, on the posting date. The home at its latest estimate, the car and caravan at the value typed in setup, the caravan leaving on the day it goes. The debt to her mother until the will forgives it.",
      networth: "Sum of what members own: her account is out, the joint saver is out until the day she dies and whole after it. Plus money in the air between own accounts. A receivable from her stays out of headline net worth, by SPEC 4.4c. Tax position excluded.",
      one_charge: "A charge in two files is one charge. The statement's amount is the charge where the two disagree, because the statement closes on it.",
    },
    balances, income, spending, spending_by_category: byCat, networth, in_transit: transit, held_out_cash: heldOut,
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
  pingPlain: { name: "PING" },
  pawroll: { name: "Pawroll", tagline: "Payroll with claws", color: "#6A3FA0" },
  myguv: { name: "myGuv", tagline: "Your tax, your paws", color: "#0B6E99" },
  purrsure: { name: "Purrsure", tagline: "Cover for the curious", color: "#C2410C" },
  bupaw: { name: "Bupaw", tagline: "Health cover for the whole family", color: "#0E7C66" },
  vicpaws: { name: "VicPaws", tagline: "Roads, rego and everything with wheels", color: "#23408E" },
  valuer: { name: "Hopkins River Valuers", tagline: "An opinion of value, with paws on the ground", color: "#5B4636" },
  council: { name: COUNCIL, tagline: "Rates and charges, one paw at a time", color: "#2E7D6B" },
  water: { name: "Wannon Reach Water" },
  hest: { name: "HESTAbby" },
  conveyancer: { name: "Hampden Conveyancing" },
  merchant: { name: "Acorn Access Lifts" },
  guv: { name: "Services Australia" },
  lakeside: { name: LAKESIDE },
  solicitor: { name: BRAUER },
};
const span = (a, b) => `${fmtDate(a)} to ${fmtDate(b)}`;
const R = (label, w = 2) => ({ label, w, align: "right" });
const Lft = (label, w = 2) => ({ label, w });

function pdfPayslip(s, ytd) {
  const d = new Doc({ brand: BR_.pawroll, title: "Payslip", kicker: fmtDate(s.payDate), deflate });
  d.h1(`Payslip for ${s.name}`);
  d.kv([["Employer", s.employer], ["Pay date", fmtDate(s.payDate)], ["Pay period", span(s.from, s.to)]], 3);
  d.h2("This pay");
  d.para(s.employer === DAIRY ? "Classification: maintenance fitter, weekly in arrears." : "Classification: enrolled nurse, fortnightly in arrears.");
  d.para("All amounts are in Australian dollars.");
  const pct = sgRate(s.payDate), rows = [["Ordinary hours, salary", money(s.gross), money(ytd.gross)]];
  if (s.pack) rows.push(["Salary packaged to Pawpack before this figure, to the home loan", money(s.pack), ""]);
  rows.push(["PAYG withholding", `-${money(s.tax)}`, `-${money(ytd.tax)}`], [`Superannuation guarantee (${pct}%)`, money(s.super), money(ytd.super)], [s.split ? `Net pay, to account ending ${NUM.dee} and 0877` : `Net pay, to account ending ${s.bank === JT ? NUM.joint.slice(-4) : NUM.dee}`, money(s.net), ""]);
  d.table([Lft("Item", 6), R("This pay"), R("Year to date")], rows);
  return d.finish();
}
function pdfIncomeStatement(name, employer, fy, ss) {
  const sum = (k) => ss.reduce((t, s) => t + s[k], 0);
  const d = new Doc({ brand: BR_.pawroll, title: `Income statement FY${fy}`, kicker: `FY${fy}, 01 Jul ${fy - 1} to 30 Jun ${fy}`, deflate });
  d.h1(`Income statement for ${name}`);
  d.kv([["Employee", name], ["Payer", employer], ["Issued", fmtDate(`${fy}-07-14`)], ["Status", "Tax ready"], ["Payer ABN", { [DAIRY]: "61840221907", [MOYNE]: "42718330156" }[employer]], ["Pay frequency", employer === DAIRY ? "Weekly" : "Fortnightly"]], 3);
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
function pdfPingRate(oldR, newR, effective, issued) {
  const d = new Doc({ brand: BR_.pingPlain, style: "plain", title: "Rate change", deflate });
  d.h1("Your interest rate is changing");
  for (const [k, v] of [["Loan number", NUM.home], ["Old rate", `${oldR}% p.a.`], ["New rate", `${newR}% p.a.`], ["Effective from", fmtDate(effective)], ["Date of this letter", fmtDate(issued)]]) { d.text(MARGIN, d.y, k, { size: 9.5 }); d.text(MARGIN + 160, d.y, v, { size: 9.5, bold: true }); d.y -= 18; }
  return d.finish();
}
function pdfCard(s) {
  const d = new Doc({ brand: BR_.amewx, title: "Card statement", kicker: span(s.start, s.end), deflate });
  d.h1("Your card statement");
  d.kv([["Account", cardFull()], ["Card member", PAUL], ["Previous balance", money(s.prev)], ["Payments and credits", money(s.credits)], ["New charges", money(s.charges)], ["New balance", money(s.close)]], 3);
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
  d.kv([["Member", PAUL], ["Member number", NUM.superP], ["Statement period", span(from, to)], ["Balance then", money(openBal)], ["Balance now", money(closeBal)], ["Option", "Balanced growth"]], 3);
  d.h2("What moved");
  d.table([Lft("Item", 6), R("Amount")], [["Opening balance", money(openBal)], ["Employer contributions", money(sum("employer"))], ["Investment earnings", money(sum("earnings"))], ["Contributions tax", money(-sum("contributions_tax"))], ["Administration fees", money(-sum("fee"))], ["Insurance premiums", money(-sum("insurance"))], ["Closing balance", money(closeBal)]]);
  return d.finish();
}
function pdfNoa(n) {
  const d = new Doc({ brand: BR_.myguv, title: "Notice of assessment", deflate });
  d.h1(n.version > 1 ? "Notice of amended assessment" : "Notice of assessment");
  const rows = [["Name", n.person, "Taxable income", money(n.ti)], ["Financial year", `FY${n.fy}`, "Gross tax", money(n.gross)], ["Date of issue", fmtDate(n.assessed), "Less offsets", money(0)], ["Return lodged", fmtDate(n.lodged), "Medicare levy", money(n.medicare)], ["Version", String(n.version), "HELP repayment", money(n.help)], ["Assessment", `AN-${n.fy}-77204${n.person === PAUL ? "18" : "19"}`, "PAYG credits", money(n.payg)], ["", "", "Other credits", money(n.other)], ["", "", "Result of this notice", money(n.result)]];
  for (const r of rows) { d.text(MARGIN, d.y, r[0], { size: 9.5 }); d.text(MARGIN + 110, d.y, r[1], { size: 9.5, bold: true }); d.text(320, d.y, r[2], { size: 9.5 }); d.text(d.W - MARGIN, d.y, r[3], { size: 9.5, bold: true, align: "right" }); d.y -= 18; }
  d.para("A refund is paid to the account you nominated in your return.");
  return d.finish();
}
function pdfWater(b) {
  const d = new Doc({ brand: BR_.water, style: "plain", title: "Water bill", deflate });
  d.text(MARGIN, d.y, "Your water bill", { size: 14, bold: true }); d.text(d.W - MARGIN, d.y, `Quarter to ${fmtDate(b.to)}`, { size: 9, align: "right" }); d.y -= 26;
  const rows = [["Account", "WR-60331907", "Water usage", money(b.usage)], ["Property", "Tower Hill Road", "Service charges", money(b.service)], ["Bill date", fmtDate(b.billDate), "Concession", money(0)], ["Due date", fmtDate(b.due), "Amount due", money(b.amt)], ["Period from", fmtDate(b.from), "", ""], ["Period to", fmtDate(b.to), "", ""]];
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
  d.kv([["Policy number", p.number], ["Policy", p.kind], ["Situation", p.situ], ["Insured", PAUL], ["Period of insurance", span(p.from, p.to)], ["Premium paid", money(p.amt)]], 3);
  d.h2("Cover");
  d.table([Lft("Item", 6), R("Amount")], [[p.label, money(p.sum)], ["Excess", money(p.excess)]]);
  return d.finish();
}
function pdfRenewal(p) {
  const d = new Doc({ brand: BR_.purrsure, title: "Renewal", kicker: `Policy period ${span(p.from, p.to)}`, deflate });
  d.h1(`${p.kind} renewal`);
  d.kv([["Policy number", p.number], ["Insured", "P Mulcahy"], ["Situation", p.situ], ["Issued", fmtDate(addDays(p.paid, -21))], ["Total premium", money(p.amt)], ["Due date", fmtDate(p.paid)], ["Status", `Paid ${fmtDate(p.paid)}`], ["Paid by", "BPAY"]], 4);
  d.h2("Cover");
  d.table([Lft("Item", 6), R("Amount")], [[p.label, money(p.sum)], ["Excess", money(p.excess)]]);
  return d.finish();
}
function pdfBupaw(h) {
  const d = new Doc({ brand: BR_.bupaw, title: "Tax statement", kicker: `Statement for the tax year`, deflate });
  d.h1("Private health insurance statement");
  d.kv([["Member", PAUL], ["Membership", "BP-7741"], ["Financial year", `FY${h.fy}`], ["Year end", fmtDate(`${h.fy}-06-30`)], ["Rebate tier", "Base tier"], ["Benefit code", "30"]], 3);
  d.h2("Your year");
  d.table([Lft("Item", 6), R("Amount")], [["Your share of premiums paid", money(h.premium)], ["Australian Government rebate received", money(h.rebate)], ["Days covered", "365"]]);
  return d.finish();
}
function pdfRego(x) {
  const d = new Doc({ brand: BR_.vicpaws, title: "Registration renewal", kicker: "Registration renewal notice", deflate });
  d.h1("Your registration is due");
  d.kv([["Registration number", x.number], ["Vehicle", x.vehicle], ["Registered owner", "P Mulcahy"], ["Issue date", fmtDate(x.issue)], ["Due date", fmtDate(x.due)], ["Registered until", fmtDate(x.until)], ["Amount payable", money(x.amt)], ["Pay by", "BPAY"]], 3);
  d.para(`Notice ${x.ref}`);
  return d.finish();
}
function pdfAppraisal(subject, asAt, value) {
  const d = new Doc({ brand: BR_.valuer, title: "Opinion of value", kicker: "Prepared for D Bonetti", deflate });
  d.h1("Opinion of value");
  d.kv([["Subject", subject], ["Valued as at", fmtDate(asAt)], ["Basis", "Appraisal"], ["Opinion of value", money(value)]], 2);
  d.para("An inspection was made on the date shown.");
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
function pdfMumSettlement() {
  const d = new Doc({ brand: BR_.conveyancer, style: "plain", title: "Settlement statement", deflate });
  d.h1(`Settlement statement, ${MUMHOUSE.split(",")[0]}`);
  d.kv([["Property reference", MUMHOUSE], ["Purchaser", "R and K Hartnett"], ["Settlement date", fmtDate(MUM_SOLD)], ["Matter", "HC-24-0931"]], 2);
  d.h2("Statement");
  d.table([Lft("Item", 6), R("Amount")], [["Purchase price", money(65200000)], ["Land transfer duty", money(3456000)], ["Legal and conveyancing", money(187000)], ["Adjustments at settlement", money(87000)], ["Loan funds drawn", `-${money(53400000)}`], ["Cash paid by purchaser", money(15530000)]]);
  d.para("Loan funds came from Westpaw loan number 553 771 902.");
  return d.finish();
}
function emlEnergy(b) {
  const text = ["Your electricity bill is ready", "Shipwreck Coast Power, a fictional retailer", "Hello Paul,", `Account: ${b.account}`, `Bill date: ${fmtDate(b.billDate)}`, `Due date: ${fmtDate(b.due)}`, `Supply from: ${fmtDate(b.from)}`, `Supply to: ${fmtDate(b.to)}`, `GST included: ${money(b.gst)}`, `Amount due: ${money(b.amt)}`, "Pay by BPAY, biller code 5512.", "Thanks for keeping the lights on."].join("\n");
  return eml({ from: "bills@shipwreckcoast.example", to: "paul@mulcahy-bonetti.example", subject: "Your electricity bill is ready", date: b.billDate, id: `sc-${b.billDate}`, text, html: `<p>${text.split("\n").join("</p><p>")}</p>` });
}

function render() {
  const view = (acct, from, to) => { let bal = OPEN[acct] || 0; const seq = B.lines.filter((x) => x.acct === acct).slice().sort(byTime), out = []; for (const x of seq) { bal += x.cents; if (x.date >= from && x.date <= to) out.push({ ...x, balance: bal }); } return out; };
  const before = (acct, d) => (OPEN[acct] || 0) + B.lines.filter((x) => x.acct === acct && x.date < d).reduce((t, x) => t + x.cents, 0);
  const bark = (x) => [dmy(x.date), `${x.cents >= 0 ? "+" : "-"}${fix(Math.abs(x.cents))}`, x.desc, fix(x.balance)];
  const w5 = (x) => [dmy(x.date), x.desc, x.cents > 0 ? fix(x.cents) : "", x.cents < 0 ? fix(x.cents) : "", fix(x.balance)], head5 = ["Date", "Description", "Credit", "Debit", "Balance"];
  const bf5 = (from, bal) => [dmy(from), "BALANCE BROUGHT FORWARD", "0.00", "", fix(bal)];
  const hbHead = ["Bank Account", "Date", "Narrative", "Debit Amount", "Credit Amount", "Balance", "Categories", "Serial"];
  // the joint account: Harbour's CSV, quarterly, one file stopping three weeks short
  for (const [from, to] of quarters("2023-07", "2026-06")) { const end = from === "2025-01-01" ? addDays(TRUNC_FROM, -1) : to; put(JT, addDays(to, 2), `Harbour_${from}_${to}.csv`, csvLines([hbHead, ...view(JT, from, end).map((x) => [NUM.joint, dmy(x.date), x.desc, x.cents < 0 ? fix(-x.cents) : "", x.cents > 0 ? fix(x.cents) : "", fix(x.balance), x.cents > 0 ? "DEP" : "PAYMENT", ""])])); }
  // Dee's account: Bark's QIF, no number and no running balance
  for (const [from, to] of quarters("2023-07", "2026-06")) put(DE, addDays(to, 2), `bark_${from}.qif`, qif({ rows: view(DE, from, to).map((x) => ({ date: x.date, cents: x.cents, desc: x.desc })), opening: before(DE, from), from }));
  // the saver: Wattle's OFX, with one overlap, FITIDs numbered within each file
  for (const [from, to] of SV_WINDOWS) put(SV, addDays(to, 2), `Wattle_saver_${from}.ofx`, ofx({ account: NUM.save, bankId: "633000", from, to, rows: view(SV, from, to).map((x) => ({ date: x.date, cents: x.cents, desc: x.desc })), closing: before(SV, addDays(to, 1)), asOf: to }));
  // the stray: her term saver, the same bank, the same layout, the same folder and the same name with a browser's (1)
  put(SV, "2025-10-02", "Wattle_saver_2025-07-01 (1).ofx", ofx({ account: NUM.mumSaver, bankId: "633000", from: "2025-07-01", to: "2025-09-30", rows: STRAY.lines.map((x) => ({ date: x.date, cents: x.cents, desc: x.desc })), closing: STRAY.lines[STRAY.lines.length - 1].balance, asOf: "2025-09-30" }));
  // her account: Wattle's five-column CSV with a brought-forward row, quarterly, until it closes
  for (const [from, to] of quarters("2023-07", "2026-06")) { if (from > MUM_CLOSE) continue; put(MU, addDays(to, 2), `Wattle_AB_${from}.csv`, csvLines([head5, bf5(from, before(MU, from)), ...view(MU, from, to).map(w5)])); }
  // the joint saver with her name first: Bark's headerless CSV, newest first, until it closes
  for (const [from, to] of quarters("2023-07", "2026-03")) put(MJ, addDays(to, 2), `bark_AB_${from}.csv`, csvLines(view(MJ, from, to).reverse().map(bark)));
  // the card: a monthly statement dated by the charge, a quarterly activity download dated by the post
  chain(CC);
  const cc = B.lines.filter((x) => x.acct === CC).sort(byPost);
  for (const s of CARD.statements) { if (s.end === STATEMENT_MISSING) continue; put("STM-CARD", addDays(s.end, 2), `Amewx_statement_${s.end}.pdf`, pdfCard(s), { issued_on: s.end }); }
  for (const [from, to, day] of quarters("2023-07", "2026-06").map(([f, t], i) => (i === 0 ? ["2023-06-15", t, addDays(t, 3)] : f === "2024-10-01" ? ["2024-09-25", t, addDays(t, 3)] : [f, t === END ? "2026-07-10" : t, addDays(t, 3)]))) {
    const rows = cc.filter((x) => posted(x) >= from && posted(x) <= to).map((x) => ({ d: posted(x), desc: x.csv || x.desc, m: PAUL, c: x.cents, n: NUM.card }));
    { const a = cc.find((x) => x.authFile === from); if (a) rows.push({ d: a.date, desc: a.csv, m: PAUL, c: -a.authCents, n: NUM.card }); }
    rows.sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0));
    put(CC, day, `activity_${from}.csv`, csvLines([["Date", "Description", "Card Member", "Account #", "Amount"], ...rows.map((x) => [dmy(x.d), x.desc, x.m.toUpperCase(), `-${x.n}`, money(-x.c).replace(/,/g, "")])]));
  }
  // the home loan: PING's half-yearly statement and yearly download, and rate notices in its own layout
  for (const [a, b] of [["2023-07", "2023-12"], ["2024-01", "2024-06"], ["2024-07", "2024-12"], ["2025-01", "2025-06"], ["2025-07", "2025-12"], ["2026-01", "2026-06"]]) { const from = `${a}-01`, to = monthEnd(b); put("STM-HOMELOAN", addDays(to, 5), `PING_statement_${to}.pdf`, pdfLoan(BR_.ping, "Home loan statement", NUM.home, "Variable", "P Mulcahy, D Bonetti", from, to, LOANS.rows.filter((m) => m.ym >= a && m.ym <= b)), { issued_on: addDays(to, 1) }); }
  for (const [from, to, day] of [["2023-07-01", "2024-06-30", "2024-07-02"], ["2024-07-01", "2025-06-30", "2025-07-02"], ["2025-07-01", "2026-06-30", "2026-07-03"]]) { const rows = LOANS.lines.filter((x) => x.date >= from && x.date <= to).map((x) => [dmy(x.date), x.desc, fix(x.cents), fix(-x.balance)].join("\t")); put(HL, day, `ping_loan_${from}.tsv`, `Effective Date\tDetails\tAmount\tBalance Owing\r\n${rows.join("\r\n")}\r\n`); }
  RATES.slice(1).forEach(([eff, r], i) => { const issued = addDays(eff, 3); put("NOTICE-HOMELOAN", issued, `PING_rate_${eff}.pdf`, pdfPingRate(RATES[i][1], r, eff, issued), { issued_on: issued }); });
  // pay
  const ytd = {};
  for (const s of PAY.slips.slice().sort((a, b) => (a.payDate < b.payDate ? -1 : a.payDate > b.payDate ? 1 : (a.tag ? 1 : 0) - (b.tag ? 1 : 0)))) {
    const k = `${s.person}|${s.employer}|${s.fy}`, y = (ytd[k] = ytd[k] || { gross: 0, tax: 0, super: 0 });
    y.gross += s.gross; y.tax += s.tax; y.super += s.super;
    if (s.noFile) continue;
    put(s.person === PAUL ? "PAY-PAUL" : "PAY-DEE", s.payDate, `Payslip_${s.employer.split(" ")[0]}_${s.person.split(" ")[0]}_${s.payDate}${s.tag ? `_${s.tag}` : ""}.pdf`, pdfPayslip(s, y), { issued_on: s.payDate });
  }
  for (const fy of [2024, 2025, 2026]) for (const [who, emp] of [[PAUL, DAIRY], [DEE, MOYNE]]) {
    const ss = PAY.slips.filter((s) => s.person === who && s.employer === emp && s.fy === fy); if (!ss.length) continue;
    put(who === PAUL ? "INC-PAUL" : "INC-DEE", `${fy}-07-14`, `IncomeStatement_FY${fy}_${emp.split(" ")[0]}_${who.split(" ")[0]}.pdf`, pdfIncomeStatement(who, emp, fy, ss), { issued_on: `${fy}-07-14` });
  }
  // super
  const sh = [["2023-07-01", "2023-12-31"], ["2024-01-01", "2024-06-30"], ["2024-07-01", "2024-12-31"], ["2025-01-01", "2025-06-30"], ["2025-07-01", "2025-12-31"], ["2026-01-01", "2026-06-30"]];
  const open = (list, from, base) => { const b = list.filter((x) => x.date < from); return b.length ? b[b.length - 1].balance : base; };
  const V1 = { employer: "Employer Contribution", contributions_tax: "Contributions Tax", fee: "Administration Fee", earnings: "Investment Earnings", spouse: "Spouse Contribution" };
  for (const [from, to] of sh) { const ls = SUPER.dee.filter((x) => x.date >= from && x.date <= to); put(SD, addDays(to, 6), `purrannuation_${from}.csv`, csvLines([["Date", "Transaction Type", "Description", "Amount", "Balance"], ...ls.map((x) => [dmy(x.date), V1[x.type], x.desc, fix(x.cents), fix(x.balance)])])); }
  const CODE = { employer: "SG", contributions_tax: "TAX", fee: "FEE", insurance: "INS", earnings: "EARN" };
  for (const [from, to] of sh) { const ls = SUPER.paul.filter((x) => x.date >= from && x.date <= to), opening = open(SUPER.paul, from, OPEN[SP]); put(SP, addDays(to, 5), `hestabby_${from}.json`, JSON.stringify({ schema: "hestabby.transactions.v2", member: { name: PAUL, number: NUM.superP }, period: { from, to }, balance: { opening: Number(fix(opening)), closing: Number(fix(ls[ls.length - 1].balance)) }, transactions: ls.map((x) => ({ date: x.date, code: CODE[x.type], label: x.desc, amount: Number(fix(x.cents)), balanceAfter: Number(fix(x.balance)) })) }, null, 1)); }
  for (const fy of [2024, 2025, 2026]) { const from = `${fy - 1}-07-01`, to = `${fy}-06-30`, ls = SUPER.paul.filter((x) => x.date >= from && x.date <= to); put("STM-SUPER-P", `${fy}-07-20`, `Annual_statement_FY${fy}.pdf`, pdfFund(fy, ls, open(SUPER.paul, from, OPEN[SP]), ls[ls.length - 1].balance), { issued_on: `${fy}-07-20` }); }
  // tax
  for (const n of TAX.notices) put(n.person === PAUL ? "TAX-PAUL" : "TAX-DEE", n.assessed, `NOA_FY${n.fy}.pdf`, pdfNoa(n), { issued_on: n.assessed });
  // the home's value, bills, cover, health, rego
  put("VALUATIONS", "2026-07-01", "pawprice_estimates.csv", csvLines([["Subject", "As At", "Estimate", "Method", "Provider"], ...VALUES.home.filter((x) => x !== VALUES.appraisal).map(([d, c]) => [HOME, dmy(d), fix(c), "estimate", "Pawprice"])]));
  put("VALUATIONS-OPINION", VALUES.appraisal[0], "Opinion_of_value_home.pdf", pdfAppraisal(HOME, VALUES.appraisal[0], VALUES.appraisal[1]), { issued_on: VALUES.appraisal[0] });
  for (const b of BILLS.energy) put("BILL-POWER", b.billDate, `bill_${b.billDate}.eml`, emlEnergy(b), { issued_on: b.billDate, origin: "email" });
  for (const b of BILLS.water) put("BILL-WATER", b.billDate, `water_${b.billDate}.pdf`, pdfWater(b), { issued_on: b.billDate });
  for (const b of BILLS.rates) put("BILL-RATES", b.billDate, `rates_${b.billDate}.pdf`, pdfRates(b), { issued_on: b.billDate });
  for (const p of BILLS.policy) put("POLICY-HOME", p.paid, `certificate_${p.from}.pdf`, pdfPolicy(p), { issued_on: p.paid });
  for (const p of BILLS.renewal) put("POLICY-MOTOR", addDays(p.paid, -21), `renewal_${p.from}.pdf`, pdfRenewal(p), { issued_on: addDays(p.paid, -21) });
  for (const h of BILLS.health) put("HEALTH-FUND", `${h.fy}-07-22`, `Bupaw_statement_FY${h.fy}.pdf`, pdfBupaw(h), { issued_on: `${h.fy}-07-22` });
  for (const x of BILLS.rego) put("REGO", x.issue, `rego_${x.number}_${x.issue}.pdf`, pdfRego(x), { issued_on: x.issue });
  put("RECEIPTS", BILLS.invoice.date, "Acorn_tax_invoice.pdf", pdfInvoice(BILLS.invoice), { issued_on: BILLS.invoice.date });
  // her papers, which Dee keeps with theirs. Some of them a public recipe reads
  put("MUM-PAPERS", VALUES.mum[0], "Opinion_of_value_33_Liebig.pdf", pdfAppraisal(MUMHOUSE, VALUES.mum[0], VALUES.mum[1]), { issued_on: VALUES.mum[0] });
  put("MUM-PAPERS", MUM_SOLD, "Settlement_33_Liebig.pdf", pdfMumSettlement(), { issued_on: MUM_SOLD });
  for (const b of BILLS.mumRates) put("MUM-PAPERS", b.billDate, `rates_33_Liebig_${b.billDate}.pdf`, pdfRates(b), { issued_on: b.billDate });
  // families of files with no public recipe
  for (const fy of [2024, 2025, 2026]) put("CARER-STMT", `${fy}-07-25`, `Payment_summary_FY${fy}.pdf`, pdfBare(BR_.guv, "Payment summary", [`Financial year FY${fy}`, `Customer: ${DEE}`, "Carer Payment and Carer Allowance paid in the year.", "Fictional."]), { issued_on: `${fy}-07-25` });
  put("MUM-LEGAL", "2024-02-20", "Enduring_power_of_attorney.pdf", pdfBare(BR_.solicitor, "Enduring power of attorney", [`Principal: ${MUM}`, `Attorney: ${DEE}`, "Takes effect at once for financial matters.", "Fictional."]), { issued_on: "2024-02-20" });
  put("MUM-LEGAL", "2025-06-16", "Residential_agreement.pdf", pdfBare(BR_.lakeside, "Residential agreement", [`Resident: ${MUM}`, "Refundable accommodation deposit 420,000.00.", "Basic daily fee by direct debit from the nominated account.", "Fictional."]), { issued_on: "2025-06-16" });
  put("MUM-LEGAL", "2026-04-14", "Grant_of_probate.pdf", pdfBare(BR_.solicitor, "Grant of probate", [`Estate of ${MUM}, died ${fmtDate(DEATH)}`, `Executors: ${DEE}, ${CARLO}.`, "The loan to P Mulcahy and D Bonetti is forgiven by clause 7 of the will.", "Fictional."]), { issued_on: "2026-04-14" });
  put("MUM-LEGAL", "2026-02-17", "Funeral_account.pdf", pdfBare({ name: "Tower Hill Funerals" }, "Funeral account", [`For the late ${MUM}`, "Total 9,480.00, paid by card.", "Fictional."]), { issued_on: "2026-02-17" });
}

// ---------- setup: what a person answers at onboarding, in July 2026 ----------
const ON = "2026-07-20T00:00:00Z";
/* The public default categories, as the earlier households listed them, with PASS-THROUGH, SUPER-PENSION and SELLING-COSTS. Two rows by the SPEC 12 rung, because a person would need them: carer payments, and board received. */
const CATS = `SALARY|Salary and wages|income|Income|1|1;SALARY-ALLOW|Allowances|income|Income|1|1;REIMBURSE|Employer reimbursements|income|Income|1|0;SUPER-EMPLOYER|Employer super|income|Super|0|1;SUPER-SACRIFICE|Salary sacrificed to super|income|Super|0|1;PAYROLL-DED|Post-tax payroll deductions|expense|Income|1|1;INTEREST|Interest earned|income|Income|1|1;DIVIDEND|Dividends and distributions|income|Income|1|1;TRUST-DIST|Trust distributions|income|Income|1|1;ESS-INCOME|Employee share scheme income|income|Income|0|1;CRYPTO-INCOME|Staking and crypto income|income|Income|0|1;SUPER-EARN|Super fund earnings|income|Super|0|1;SUPER-FEES|Super fund fees|expense|Super|0|1;SUPER-INS|Insurance inside super|expense|Super|0|1;SUPER-TAX|Contributions tax|expense|Super|0|1;GIFT-IN|Gifts and inheritances received|income|Income|1|0;RENT-INC|Rent received|income|Property|1|1;MORTGAGE|Home loan repayments|expense|Housing|1|0;HOME-INT|Home loan interest|expense|Housing|0|1;RATES-HOME|Council rates (home)|expense|Housing|1|1;HOME-INS|Home and contents insurance|expense|Housing|1|1;HOME-MAINT|Home maintenance|expense|Housing|1|1;GROCERIES|Groceries|expense|Essentials|1|1;UTILITIES|Energy and water|expense|Essentials|1|1;TELCO|Internet and mobile|expense|Essentials|1|1;TRANSPORT|Fuel and transport|expense|Essentials|1|1;CAR|Car costs|expense|Essentials|1|1;HEALTH|Health|expense|Essentials|1|1;CHILDCARE|Childcare|expense|Essentials|1|1;DINING|Dining and takeaway|expense|Lifestyle|1|1;SUBS|Subscriptions|expense|Lifestyle|1|1;SHOPPING|Shopping|expense|Lifestyle|1|1;KIDS-ACT|Kids activities|expense|Lifestyle|1|1;HOLIDAYS|Holidays and travel|expense|Lifestyle|1|1;GIFTS|Gifts|expense|Lifestyle|1|1;PERSONAL|Personal care|expense|Lifestyle|1|1;RENT-INT|Investment loan interest|expense|Property|1|1;RENT-MGMT|Property management fees|expense|Property|1|1;RENT-RATES|Rental rates and water|expense|Property|1|1;RENT-STRATA|Strata levies|expense|Property|1|1;RENT-INS|Landlord insurance|expense|Property|1|1;RENT-REPAIR|Rental repairs|expense|Property|1|1;RENT-OTHER|Other rental costs|expense|Property|1|1;WORK-EQUIP|Work equipment|expense|Work and giving|1|1;WORK-OTHER|Work registrations and courses|expense|Work and giving|1|1;DONATION|Donations|expense|Work and giving|1|1;FEES|Bank fees and card interest|expense|Fees|1|1;INCOME-TAX|Income tax assessed|expense|Tax|0|1;HELP-INDEX|HELP indexation|expense|Tax|0|1;TAX-REFUND|Tax refunds and payments|transfer|Tax|0|0;TRANSFER|Transfers between own accounts|transfer|Transfers|0|0;CC-PAY|Credit card payments|transfer|Transfers|0|0;UNCAT|Uncategorised|suspense|Uncategorised|1|1;PASS-THROUGH|Money that is someone else's|pass_through|Transfers|0|0;SUPER-PENSION|Super pension|income|Income|1|0;SELLING-COSTS|Selling costs|capital|Capital|0|0;x_CARER|Carer payments|income|Income|1|1;x_BOARD|Board received|income|Income|1|0`;
function setup() {
  const person = (id, name, birth) => ({ party_id: id, kind: "person", name, birth_date: birth });
  const org = (id, name, kind = "organisation") => ({ party_id: id, kind, name });
  const party = [person("PTY-PAUL", PAUL, "1967-03-11"), person("PTY-DEE", DEE, "1969-08-21"), person("PTY-TESS", TESS, "2005-04-19"), person("PTY-LIAM", LIAM, "2000-12-02"), person("PTY-MUM", MUM, "1940-01-30"), person("PTY-CARLO", CARLO, "1966-06-03"),
    org("PTY-DAIRY", DAIRY), org("PTY-MOYNE", MOYNE), org("PTY-COUNCIL", COUNCIL, "government"), org("PTY-HARBOUR", "Harbour Bank"), org("PTY-BARK", "Bark Bank"), org("PTY-WATTLE", "Wattle Credit Union"), org("PTY-AMEWX", "Amewx"), org("PTY-PING", "PING"), org("PTY-PURRANNUATION", "Purrannuation"), org("PTY-HESTABBY", "HESTAbby"),
    org("PTY-TAX", "myGuv", "government"), org("PTY-SA", SA, "government"), org("PTY-PURRSURE", "Purrsure"), org("PTY-BUPAW", "Bupaw"), org("PTY-VICPAWS", "VicPaws", "government"), org("PTY-POWER", "Shipwreck Coast Power"), org("PTY-WATER", "Wannon Reach Water"), org("PTY-LAKESIDE", LAKESIDE)];
  const membership = [["PTY-PAUL", "adult", "1994-02-12"], ["PTY-DEE", "adult", "1994-02-12"], ["PTY-TESS", "dependant", "2005-04-19"]].map(([party_id, role, valid_from]) => ({ party_id, role, valid_from, recorded_at: ON }));
  const acct = (account_id, name, cls, type, group, inst, extra = {}) => ({ account_id, name, class: cls, type, reporting_group: group, currency: "AUD", ...(inst ? { institution_party_id: inst } : {}), in_scope: true, liquid: group === "cash", fidelity: "ledger", ...extra });
  const account = [
    acct(JT, "Joint everyday, Harbour", "asset", "transaction", "cash", "PTY-HARBOUR"), acct(DE, "Dee's account, Bark", "asset", "transaction", "cash", "PTY-BARK"), acct(SV, "Saver, Wattle", "asset", "savings", "cash", "PTY-WATTLE"),
    acct(CC, "Amewx card", "liability", "credit_card", "cash", "PTY-AMEWX"), acct(MJ, "Mum's saver with Dee's name on it, Bark", "asset", "savings", "cash", "PTY-BARK", { closed_on: MJ_CLOSE, note: "All Mum's money. It has Dee's name on it in case something happens." }),
    acct(MU, "Mum's account, Wattle (power of attorney)", "asset", "transaction", "memo", "PTY-WATTLE", { in_scope: false, liquid: false, closed_on: MUM_CLOSE, note: "Hers, not ours. Dee runs it under a power of attorney and keeps the files." }),
    acct(HL, "Home loan, PING", "liability", "loan", "loans", "PTY-PING", { contract_id: "CON-HOME", liquid: false }), acct(ML, "Loan from Mum", "liability", "loan", "loans", null, { contract_id: "CON-MUMLOAN", opened_on: LOAN_DAY, closed_on: DEATH, liquid: false, note: "Forgiven in her will." }),
    acct(SP, "Paul's super, HESTAbby", "asset", "super", "super", "PTY-HESTABBY", { contract_id: "CON-SUPER-P", liquid: false }), acct(SD, "Dee's super, Purrannuation", "asset", "super", "super", "PTY-PURRANNUATION", { contract_id: "CON-SUPER-D", liquid: false }),
    acct(HO, "The home", "asset", "property", "property", null, { asset_id: "AST-HOME", fidelity: "snapshot", liquid: false }),
    acct(CR, "The Subaru", "asset", "vehicle", "vehicle", null, { asset_id: "AST-CAR", fidelity: "snapshot", liquid: false, opening_balance_cents: CAR_VALUE, opening_date: START, note: "What we think it is worth." }),
    acct(VN, "The caravan", "asset", "vehicle", "vehicle", null, { asset_id: "AST-VAN", fidelity: "snapshot", closed_on: VAN_SOLD, liquid: false, opening_balance_cents: VAN_VALUE, opening_date: START, note: "What we think it is worth." }),
  ];
  const asset = [{ asset_id: "AST-HOME", kind: "property", name: HOME, account_id: HO, location: "Warrnambool VIC", acquired_on: "2016-03-14" }, { asset_id: "AST-CAR", kind: "vehicle", name: "The Subaru", account_id: CR }, { asset_id: "AST-VAN", kind: "vehicle", name: "The caravan", account_id: VN, disposed_on: VAN_SOLD }];
  const al = (subject_type, subject_id, scheme, value, o = {}) => ({ subject_type, subject_id, scheme, value, valid_from: "2000-01-01", recorded_at: ON, ...o });
  const alias = [al("account", JT, "account_number", NUM.joint), al("account", DE, "account_number", NUM.dee), al("account", SV, "account_number", NUM.save), al("account", CC, "card_last4", NUM.card), al("account", SP, "member_number", NUM.superP), al("account", SD, "member_number", NUM.superD), al("account", HL, "loan_number", NUM.home),
    ...[["PTY-PAUL", PAUL], ["PTY-DEE", DEE], ["PTY-TESS", TESS], ["PTY-LIAM", LIAM], ["PTY-MUM", MUM], ["PTY-CARLO", CARLO], ["PTY-DAIRY", DAIRY], ["PTY-MOYNE", MOYNE], ["PTY-COUNCIL", COUNCIL], ["PTY-SA", SA], ["PTY-LAKESIDE", LAKESIDE]].map(([id, name]) => al("party", id, "name", name)),
    al("asset", "AST-HOME", "name", HOME), al("asset", "AST-CAR", "name", NUM.rego), al("contract", "CON-HOME", "loan_number", NUM.home), al("contract", "CON-HOME-INS", "policy_number", NUM.policyHome), al("contract", "CON-MOTOR", "policy_number", NUM.policyMotor)];
  const own_ = (subject_type, subject_id, split, o = {}) => ["legal", "beneficial", "tax"].flatMap((basis) => split.map(([party_id, share_bps]) => ({ subject_type, subject_id, party_id, basis, share_bps, valid_from: "2000-01-01", recorded_at: ON, ...o })));
  const him = [["PTY-PAUL", 10000]], her = [["PTY-DEE", 10000]], both = [["PTY-PAUL", 5000], ["PTY-DEE", 5000]], mum = [["PTY-MUM", 10000]];
  const row = (subject_id, basis, party_id, share_bps, o = {}) => ({ subject_type: "account", subject_id, party_id, basis, share_bps, valid_from: "2000-01-01", recorded_at: ON, ...o });
  const ownership = [...[JT, SV, HL, ML, HO].flatMap((a) => own_("account", a, both)), ...[CC, SP, CR, VN].flatMap((a) => own_("account", a, him)), ...[DE, SD].flatMap((a) => own_("account", a, her)), ...own_("account", MU, mum), ...own_("asset", "AST-HOME", both), ...own_("asset", "AST-CAR", him), ...own_("asset", "AST-VAN", him),
    row(MJ, "legal", "PTY-MUM", 5000, { valid_to: DEATH }), row(MJ, "legal", "PTY-DEE", 5000, { valid_to: DEATH }), row(MJ, "beneficial", "PTY-MUM", 10000, { valid_to: DEATH }), row(MJ, "tax", "PTY-MUM", 10000, { valid_to: DEATH }),
    ...["legal", "beneficial", "tax"].map((b) => row(MJ, b, "PTY-DEE", 10000, { valid_from: DEATH }))];
  const category = CATS.split(";").map((r) => { const [category_id, name, kind, group, c, e] = r.split("|"); return { category_id, name, kind, group, cash_lens: c === "1", economic_lens: e === "1" }; });
  const con = (contract_id, kind, name, counterparty_party_id, holder_party_id, extra = {}) => ({ contract_id, kind, name, counterparty_party_id, holder_party_id, ...extra });
  const contract = [
    con("CON-DAIRY", "employment", "Paul at the dairy", "PTY-DAIRY", "PTY-PAUL", { category_id: "SALARY", started_on: "2009-05-04" }), con("CON-MOYNE", "employment", "Dee at the hospital", "PTY-MOYNE", "PTY-DEE", { category_id: "SALARY", started_on: "2011-02-07", ended_on: DEE_LEFT }), con("CON-MOYNE-2", "employment", "Dee back at the hospital", "PTY-MOYNE", "PTY-DEE", { category_id: "SALARY", started_on: "2026-05-04" }),
    con("CON-SUPER-P", "super_fund", "Paul's super", "PTY-HESTABBY", "PTY-PAUL", { account_id: SP }), con("CON-SUPER-D", "super_fund", "Dee's super", "PTY-PURRANNUATION", "PTY-DEE", { account_id: SD }),
    con("CON-HOME", "loan", "Home loan", "PTY-PING", "PTY-PAUL", { account_id: HL, asset_id: "AST-HOME", category_id: "MORTGAGE", started_on: "2016-03-14" }), con("CON-MUMLOAN", "loan", "Loan from Mum", "PTY-MUM", "PTY-PAUL", { account_id: ML, started_on: LOAN_DAY, ended_on: DEATH }),
    con("CON-HOME-INS", "insurance", "Home insurance", "PTY-PURRSURE", "PTY-PAUL", { asset_id: "AST-HOME", category_id: "HOME-INS" }), con("CON-MOTOR", "insurance", "Car insurance", "PTY-PURRSURE", "PTY-PAUL", { asset_id: "AST-CAR", category_id: "CAR" }), con("CON-HEALTH", "insurance", "Private health", "PTY-BUPAW", "PTY-PAUL", { category_id: "HEALTH" }),
    con("CON-POWER", "utility", "Electricity", "PTY-POWER", "PTY-PAUL", { category_id: "UTILITIES" }),
    con("CON-CARER", "commitment", "Dee's Carer Payment and Carer Allowance", "PTY-SA", "PTY-DEE", { category_id: "x_CARER", started_on: CARER_FROM, ended_on: "2026-02-26" }), con("CON-BOARD", "commitment", "Mum's board while she was in the flat", "PTY-MUM", "PTY-PAUL", { category_id: "x_BOARD", started_on: "2024-03-14", ended_on: "2025-06-12" }),
    con("CON-CARE", "subscription", "Mum's aged-care fees, paid for her", "PTY-LAKESIDE", "PTY-DEE", { category_id: "PASS-THROUGH", started_on: "2025-07-01", ended_on: DEATH }),
  ];
  const lk = (relation, from_type, from_id, to_type, to_id, extra = {}) => ({ relation, from_type, from_id, to_type, to_id, valid_from: "2000-01-01", recorded_at: ON, ...extra });
  const link = [lk("contributes_to", "contract", "CON-DAIRY", "contract", "CON-SUPER-P"), lk("contributes_to", "contract", "CON-MOYNE", "contract", "CON-SUPER-D"), lk("contributes_to", "contract", "CON-MOYNE-2", "contract", "CON-SUPER-D"),
    lk("secures", "contract", "CON-HOME", "asset", "AST-HOME"), lk("funds_purpose", "contract", "CON-HOME", "asset", "AST-HOME", { share_bps: 10000 }), lk("paid_by", "contract", "CON-HOME", "account", JT),
    lk("charged_to", "account", CC, "account", JT), lk("covers", "contract", "CON-HOME-INS", "asset", "AST-HOME"), lk("covers", "contract", "CON-MOTOR", "asset", "AST-CAR")];
  const st = (stream_id, name, doc_kind, subject_type, subject_id, issuer_party_id, cadence, extra = {}) => ({ stream_id, name, doc_kind, subject_type, subject_id, issuer_party_id, cadence, valid_from: START, grace_days: 14, recorded_at: ON, ...extra });
  const stream = [
    st(JT, "Joint download", "txn_csv", "account", JT, "PTY-HARBOUR", "quarterly"), st(DE, "Dee's download", "txn_qif", "account", DE, "PTY-BARK", "quarterly"), st(SV, "Saver download", "txn_ofx", "account", SV, "PTY-WATTLE", "quarterly"),
    st(MU, "Mum's download", "txn_csv", "account", MU, "PTY-WATTLE", "quarterly", { valid_to: MUM_CLOSE }), st(MJ, "Mum's saver download", "txn_csv", "account", MJ, "PTY-BARK", "quarterly", { valid_to: MJ_CLOSE }),
    st(CC, "Amewx activity", "txn_csv", "account", CC, "PTY-AMEWX", "quarterly"), st("STM-CARD", "Amewx statement", "statement", "account", CC, "PTY-AMEWX", "monthly"),
    st("STM-HOMELOAN", "PING statement", "loan_statement", "account", HL, "PTY-PING", "half_yearly"), st(HL, "PING download", "txn_tsv", "account", HL, "PTY-PING", "yearly"), st("NOTICE-HOMELOAN", "Rate notices", "rate_notice", "contract", "CON-HOME", "PTY-PING", "event"),
    st(SP, "Paul's super transactions", "super_lines", "account", SP, "PTY-HESTABBY", "half_yearly"), st(SD, "Dee's super transactions", "super_lines", "account", SD, "PTY-PURRANNUATION", "half_yearly"), st("STM-SUPER-P", "Paul's super statement", "super_statement", "account", SP, "PTY-HESTABBY", "yearly"),
    st("PAY-PAUL", "Paul's payslips", "payslip", "party", "PTY-PAUL", "PTY-DAIRY", "event"), st("PAY-DEE", "Dee's payslips", "payslip", "party", "PTY-DEE", "PTY-MOYNE", "fortnightly", { valid_to: DEE_LEFT }), st("INC-PAUL", "Paul's income statements", "income_statement", "party", "PTY-PAUL", "PTY-DAIRY", "yearly"), st("INC-DEE", "Dee's income statements", "income_statement", "party", "PTY-DEE", "PTY-MOYNE", "yearly"), st("TAX-PAUL", "Paul's notices", "tax_assessment", "party", "PTY-PAUL", "PTY-TAX", "yearly"), st("TAX-DEE", "Dee's notices", "tax_assessment", "party", "PTY-DEE", "PTY-TAX", "yearly"),
    st("VALUATIONS", "Home estimates", "valuation", "asset", "AST-HOME", null, "quarterly"), st("VALUATIONS-OPINION", "Valuer's opinion", "valuation", "asset", "AST-HOME", null, "event"), st("BILL-POWER", "Electricity bills", "bill", "contract", "CON-POWER", "PTY-POWER", "quarterly"), st("BILL-WATER", "Water bills", "bill", "asset", "AST-HOME", "PTY-WATER", "quarterly"), st("BILL-RATES", "Rates notices", "bill", "asset", "AST-HOME", "PTY-COUNCIL", "half_yearly"), st("POLICY-HOME", "Home certificate", "policy", "contract", "CON-HOME-INS", "PTY-PURRSURE", "yearly"), st("POLICY-MOTOR", "Motor renewal", "policy", "contract", "CON-MOTOR", "PTY-PURRSURE", "yearly"), st("HEALTH-FUND", "Bupaw statements", "health_statement", "contract", "CON-HEALTH", "PTY-BUPAW", "yearly"), st("REGO", "Rego notices", "bill", "asset", "AST-CAR", "PTY-VICPAWS", "yearly"), st("RECEIPTS", "Receipts", "receipt", "party", "PTY-PAUL", null, "event"),
    st("MUM-PAPERS", "Mum's papers", "statement", "party", "PTY-MUM", null, "event"), st("MUM-LEGAL", "Mum's legal papers", "statement", "party", "PTY-MUM", null, "event"), st("CARER-STMT", "Payment summaries", "statement", "party", "PTY-DEE", "PTY-SA", "yearly", { valid_from: CARER_FROM }),
  ];
  let t = 0;
  const tm = (subject_type, subject_id, term, value, unit, valid_from, o = {}) => { t += 1; return { term_id: `TERM-${pad(t, 3)}`, subject_type, subject_id, term, value, unit, valid_from, recorded_at: ON, ...o }; };
  // only what a person knows offhand
  const term = [tm("contract", "CON-HOME", "interest_rate", "6.39", "pct", START), tm("contract", "CON-HOME", "rate_type", "variable", null, START), tm("contract", "CON-HOME", "repayment_type", "principal_and_interest", null, START), tm("contract", "CON-HOME", "repayment_cents", String(HOMEPAY), "cents", START), tm("contract", "CON-HOME", "repayment_cadence", "fortnightly", null, START),
    tm("contract", "CON-MUMLOAN", "interest_rate", "0", "pct", LOAN_DAY), tm("contract", "CON-MUMLOAN", "repayment_type", "principal_and_interest", null, LOAN_DAY), tm("contract", "CON-MUMLOAN", "repayment_cents", "50000", "cents", "2025-01-01"), tm("contract", "CON-MUMLOAN", "repayment_cadence", "monthly", null, "2025-01-01"),
    tm("contract", "CON-DAIRY", "base_salary_cents", "9300000", "cents", START), tm("contract", "CON-DAIRY", "pay_cadence", "weekly", null, START), tm("contract", "CON-MOYNE", "base_salary_cents", "7000000", "cents", START), tm("contract", "CON-MOYNE", "pay_cadence", "fortnightly", null, START), tm("contract", "CON-MOYNE-2", "base_salary_cents", "6000000", "cents", "2026-05-04"), tm("contract", "CON-MOYNE-2", "pay_cadence", "fortnightly", null, "2026-05-04"),
    tm("contract", "CON-HEALTH", "premium_cents", "29400", "cents", START), tm("contract", "CON-HEALTH", "premium_cadence", "monthly", null, START), tm("asset", "AST-HOME", "use", "owner_occupied", null, "2016-03-14")];
  const household = [{ household_id: "HH-MB", name: "Mulcahy-Bonetti", jurisdiction: "AU", base_currency: "AUD", fy_start_month: 7, timezone: "Australia/Melbourne", standard_version: "household-standard/1" }];
  return { household, party, membership, account, alias, ownership, category, contract, link, stream, asset, term };
}

// ---------- build ----------
function build() {
  windows();
  everyday(); paulPay(); deePay(); carer(); mumAccount(); flat(); board(); gifts(); topup(); mumLoan(); homeRepayments(); homeValues(); assets(); bills(); lineTraps(); mumOnCard(); estate(); superFunds(); taxes();
  strayFile(); settleCard(); sweeps(); interestCredits(); closeMum(); homeInterest();
  fileTraps();
  const tb = truthBalances(); lateTraps(tb);
  const t = truth(tb);
  const lows = {}; for (const a of [JT, DE, SV, MU, MJ]) lows[a] = Math.min(...chain(a).map((x) => x.balance));
  render();
  const tSetup = setup();
  fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
  const manifest = { household: "HH-MB", files: FILES.map((f) => ({ path: f.path, stream_id: f.stream, download_date: f.day, name: f.name, origin: f.origin || "portal", issued_on: f.issued_on || null })) };
  for (const f of FILES) { const p = path.join(OUT, f.path); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, f.bytes); }
  fs.writeFileSync(path.join(OUT, "manifest.json"), `${JSON.stringify(manifest, null, 1)}\n`);
  fs.writeFileSync(path.join(OUT, "truth.json"), `${JSON.stringify(t, null, 1)}\n`);
  fs.mkdirSync(SETUP_DIR, { recursive: true });
  for (const n of fs.readdirSync(SETUP_DIR)) fs.rmSync(path.join(SETUP_DIR, n));
  for (const [k, v] of Object.entries(tSetup)) fs.writeFileSync(path.join(SETUP_DIR, `${k}.json`), `${JSON.stringify(v, null, 1)}\n`);
  return { files: FILES.length, lines: B.lines.length, traps: B.traps.length, fresh: B.traps.filter((x) => x.fresh).length, dc: B.traps.filter((x) => x.dc).length, lows, tb };
}

if (require.main === module) { const r = build(); console.log(`Held-out household 6: ${r.files} files, ${r.lines} lines, ${r.traps} traps (${r.fresh} in none of the earlier lists, ${r.dc} new double-count or silent-number variants). Lowest balances: ${Object.entries(r.lows).map(([a, v]) => `${a} ${money(v)}`).join(", ")}.`); }
module.exports = { build, OUT, SETUP_DIR, book: B };
