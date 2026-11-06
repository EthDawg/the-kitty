#!/usr/bin/env node
/* The fifth held-out household. Four blind families found real defects, and the engine was repaired after each. Repaired scores prove nothing. This one is the headline: the blind score of the
   engine as it ships, with no repairs planned after it.

   The Novak-Bautistas of Norman Gardens, Rockhampton, 36 months from July 2023 to June 2026. Everything here is fictional. Luka Novak is an electrician, a sole trader until 30 June 2024 and then the
   one director of Novak Electrical Pty Ltd, whose bank account is none of the household's and is in none of its files, bar one stray quarter. The company pays him when it can, pays him back when it
   can, and borrows from him when it must. Marisol Bautista was born in Iloilo: casual at a dental surgery, weekends at the council library, the company's bookkeeper, and she sends money home and
   takes rent from a flat there. A home loan with an offset, a ute on a chattel mortgage in his own name with a balloon at the end, a baby in March 2025, a back injury in October 2025. Written blind:
   from SPEC.md, RECIPES.md, the schemas, the public recipes, the intake, the world's file writers and the four earlier held-out folders' build, run and blind reports.

   Order of work, as in the earlier households: a life is simulated first and held in cents, day by day. Only then are files rendered from it, as each institution would hand them over. Truth is
   written from the simulation and never from the engine. Setup is what a person would answer at onboarding: no rules, no decisions, no opening balances a file states.

   node standard/eval/heldout5/build.js
   writes standard/.build/heldout5/{sources,manifest.json,truth.json} and standard/eval/heldout5/setup/<table>.json. Node 22, no dependencies, seeded, no clock. */
"use strict";
const fs = require("fs"), path = require("path"), zlib = require("zlib");

const STD = path.join(__dirname, "..", "..");
const LIB = path.join(STD, "world", "lib");
const { pad, fix, money, addDays, dayDiff, weekday, monthEnd, nextMonth, monthRange, fmtDate, dmy, fyOf, csvLines, Rng, MONTHS: MON } = require(path.join(LIB, "util"));
const { Doc, M: MARGIN } = require(path.join(LIB, "pdf"));
const { eml, page, row } = require(path.join(LIB, "mail"));
const { ofx, qif } = require(path.join(LIB, "bankfiles"));

const OUT = path.join(STD, ".build", "heldout5");
const SETUP_DIR = path.join(__dirname, "setup");
const START = "2023-07-01", END = "2026-06-30", MONTHS = monthRange("2023-07", "2026-06");
const INCORP = "2024-07-01", BIZ_CLOSE = "2024-09-30", BT_DAY = "2025-03-20", BABY = "2025-03-11", LEAVE_FROM = "2025-02-28", LEAVE_TO = "2025-09-01", NOSLIP_FROM = "2025-03-21", NOSLIP_TO = "2025-08-29", INJURY = "2025-10-27", BACK = "2026-03-13", BOAT_SOLD = "2025-08-22", UTE_END = "2026-03-09", HARD_FROM = "2025-11-01", HARD_TO = "2026-01-31", MILAN_DAY = "2025-01-17", TRUNC_FROM = "2024-03-11", TRUNC_TO = "2024-03-31";
const rng = (name) => new Rng(`novak-bautista:${name}`);
const deflate = (b) => new Uint8Array(zlib.deflateSync(b));

// ---------- who and what ----------
const LUKA = "Luka Novak", MARI = "Marisol Bautista", MARI_PAY = "Marisol Novak", MATEO = "Mateo Novak", INES = "Ines Novak", THEO = "Theo Novak", MILAN = "Milan Novak", CORAZON = "Corazon Bautista";
const CO = "Novak Electrical Pty Ltd", DENTAL = "Capricorn Dental", COUNCIL = "Capricorn Coast Council", HOME = "27 Mangrove Crescent, Norman Gardens";
const EV = "ACC-OFFSET", JT = "ACC-JOINT", MA = "ACC-MARI", TS = "ACC-TAXSAVE", BZ = "ACC-BIZ", CC = "ACC-CARD", C2 = "ACC-CARD2", HL = "ACC-HOMELOAN", UL = "ACC-UTELOAN", DL = "ACC-COLOAN", ML = "ACC-MILAN", SL = "ACC-SUPER-L", SM = "ACC-SUPER-M", HO = "ACC-HOME", UT = "ACC-UTE", BT = "ACC-BOAT", CR = "ACC-CAR";
const NUM = { offsetLast: "4471", joint: "0071930877", biz: "714220557102", co: "714220903388", card: "31907", card2: "77416", home: "553 220 914", ute: "PNG-88014412", superL: "PUR-5521908", superM: "HST-6620174", policyHome: "PH-61120334", policyMotor: "PM-7730", ip: "IP-4471" };
const CASH = [EV, JT, MA, TS, BZ, CC, C2];
const WAGE = "NOVAK ELECTRICAL PTY LTD PAY 1102", TOCO = "OSKO TO NOVAK ELECTRICAL PTY LTD";
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
const HOLIDAYS = new Set(["2023-10-02", "2023-12-25", "2023-12-26", "2024-01-01", "2024-01-26", "2024-03-29", "2024-04-01", "2024-04-25", "2024-05-06", "2024-10-07", "2024-12-25", "2024-12-26", "2025-01-01", "2025-01-27", "2025-04-18", "2025-04-21", "2025-04-25", "2025-05-05", "2025-10-06", "2025-12-25", "2025-12-26", "2026-01-01", "2026-01-26", "2026-04-03", "2026-04-06", "2026-05-04"]);
const isBiz = (d) => weekday(d) !== 0 && weekday(d) !== 6 && !HOLIDAYS.has(d);
const nextBiz = (d) => { while (!isBiz(d)) d = addDays(d, 1); return d; };
const prevBiz = (d) => { while (!isBiz(d)) d = addDays(d, -1); return d; };
const bizAfter = (d, n) => { let x = d; while (n > 0) { x = addDays(x, 1); if (isBiz(x)) n -= 1; } return x; };
const cents = (r, lo, hi) => Math.round(r.range(lo, hi) * 100);
const ymOf = (d) => d.slice(0, 7);
const posted = (x) => x.posted || x.date;
const byTime = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.seq - b.seq);
const byPost = (a, b) => (posted(a) < posted(b) ? -1 : posted(a) > posted(b) ? 1 : a.seq - b.seq);
const nthFri = (ym, n) => { let d = `${ym}-01`; while (weekday(d) !== 5) d = addDays(d, 1); return addDays(d, 7 * (n - 1)); };

/* trap register. fresh: in none of the four earlier lists. dc: a new variant of double counting or of a number silently wrong. A probe is a fact run.js can test against what the engine produced. */
function trap(id, name, where, expect, probe, o = {}) { B.traps.push({ id, name, where, expect, probe, fresh: !!o.fresh, dc: !!o.dc }); }
const plain = (x, want, extra = {}) => ({ account: x.acct, date: x.date, ...(x.posted && x.posted !== x.date ? { posted: x.posted } : {}), cents: x.cents, want, ...extra });

// ---------- merchants, all invented ----------
const MER = {
  grocer: [["FITZROY FRESH", "ROCKHAMPTON"], ["ALLENSTOWN PROVISIONS", "ALLENSTOWN"], ["GRACEMERE GROCER", "GRACEMERE"]],
  cafe: [["KEPPEL ST COFFEE", "ROCKHAMPTON"], ["BOLSOVER BEANS", "ROCKHAMPTON"]],
  dine: [["YEPPEN CHARCOAL", "YEPPEN"], ["BERSERKER PIZZA", "BERSERKER"]],
  fuel: [["CAPRICORN HWY FUEL", "GRACEMERE"], ["BRUCE HWY FUEL", "YEPPEN"]],
  shop: [["KALKA HOMEWARES", "NORTH ROCKHAMPTON"], ["LITTLE SPROUTS KIDS", "NORTH ROCKHAMPTON"], ["DEPOT HILL HARDWARE", "ROCKHAMPTON"]],
  chem: [["WANDAL CHEMIST", "WANDAL"]],
  kids: [["ROCKY AQUATIC CENTRE", "ROCKHAMPTON"], ["NORTHSIDE JUNIOR LEAGUE", "ROCKHAMPTON"], ["WANDAL DANCE STUDIO", "WANDAL"]],
  trade: [["VOLTMART TRADE", "PARKHURST"], ["CQ CABLE AND CONDUIT", "PARKHURST"]],
};
const cardDesc = (m) => `${m[0]} ${m[1]}`;
const cardCsv = (m) => `${m[0].padEnd(26)}${m[1]}  QLD`;
const pos = (m) => `EFTPOS ${m[0]} ${m[1]}`;

/* one card purchase. date is the day it was charged, which the statement shows; posted is the day the activity download shows. Lag is in business days. */
function card(r, date, m, c, cat, o = {}) {
  const lag = o.lag != null ? o.lag : r.pick([0, 0, 1, 1, 1, 2, 2, 3, 4, 5]);
  const post = o.posted || (lag ? bizAfter(date, lag) : date);
  count("purchase");
  return line(CC, date, o.desc || cardDesc(m), -c, { posted: post, csv: o.csv || cardCsv(m), member: LUKA, lens: o.lens === undefined ? "spending" : o.lens, cat, ...o.extra });
}

// ---------- everyday life ----------
const ATM = [];
function everyday() {
  const r = rng("everyday"), pick = (a) => r.pick(a);
  const debit = (acct, d, m, c, cat) => { count("purchase"); return spend(acct, d, pos(m), c, cat); };
  for (let d = "2023-06-15"; d <= END; d = addDays(d, 1)) {
    const wd = weekday(d), inWin = d >= START;
    if (r.next() < 0.24) card(r, d, pick(MER.grocer), cents(r, 36, 168), "GROCERIES");
    if (r.next() < 0.11) card(r, d, pick(MER.cafe), cents(r, 5, 18), "DINING");
    if (wd === 6 && r.next() < 0.3) card(r, d, pick(MER.dine), cents(r, 30, 92), "DINING");
    if (r.next() < 0.08) card(r, d, pick(MER.shop), cents(r, 14, 190), "SHOPPING");
    if (r.next() < 0.05) card(r, d, pick(MER.chem), cents(r, 8, 48), "HEALTH");
    if (d.slice(8) === "11" && d < BT_DAY) card(r, d, ["NORTHLIGHT STREAM", "ONLINE"], 1699, "SUBS");
    if (d.slice(8) === "11" && d > BT_DAY) { spend(C2, d, "NORTHLIGHT STREAM ONLINE", 1699, "SUBS"); count("purchase"); }
    if (!inWin) continue;
    if (r.next() < 0.3) debit(JT, d, pick(MER.grocer), cents(r, 20, 120), "GROCERIES");
    if (r.next() < 0.16) debit(JT, d, pick(MER.fuel), cents(r, 50, 96), "TRANSPORT");
    if (wd === 6 && r.next() < 0.5) debit(JT, d, pick(MER.kids), cents(r, 8, 60), "KIDS-ACT");
    if (r.next() < 0.14) debit(MA, d, pick(MER.shop), cents(r, 12, 70), "SHOPPING");
    if (wd === 3 && r.next() < 0.5) debit(MA, d, pick(MER.cafe), cents(r, 5, 16), "DINING");
    if (r.next() < 0.01) debit(EV, d, ["NORMAN GARDENS DENTAL", "ROCKHAMPTON"], cents(r, 160, 640), "HEALTH");
    if (d.slice(8) === "03") { spend(JT, d, "DIRECT DEBIT KOALATEL MOBILE 7102", 8900, "TELCO"); spend(JT, d, "DIRECT DEBIT REEFLINK INTERNET 44120", 8400, "TELCO"); count("purchase", 2); }
    if (d.slice(8) === "20") { spend(EV, d, `PURRSURE LIFE ${NUM.ip}`, 14860, "HEALTH"); count("purchase"); }
    if (d.slice(8) === "22" && ["01", "04", "07", "10"].includes(d.slice(5, 7))) { spend(JT, d, "BPAY NORTHSIDE CHRISTIAN COLLEGE 8812", 112000, "KIDS-ACT"); count("purchase"); }
  }
  const a = rng("atm"); let d = "2023-07-04";
  while (d <= END) { const c = a.pick([10000, 15000, 15000, 20000, 20000]); ATM.push(spend(JT, d, "ATM WITHDRAWAL GRACEMERE", c, "PERSONAL")); count("atm"); d = addDays(d, a.int(7, 12)); }
  trap("T5-ATM", "An ATM withdrawal is spending, whatever happens to the notes", `${JT}: ${ATM.length} lines reading "ATM WITHDRAWAL GRACEMERE"`, "Money that left the accounts for the household to spend. Spending, and not an open transfer waiting for a pair.",
    { kind: "lines", lines: [ATM[3], ATM[30], ATM[70]].map((x) => plain(x, "spending")) });
}

// ---------- pay: his company, her surgery, her library job with no payslips ----------
const PAY = { slips: [] };
const sgRate = (d) => (d < "2024-07-01" ? 11 : d < "2025-07-01" ? 11.5 : 12);
function slip(person, name, employer, payDate, from, to, gross, o = {}) {
  const rate = o.rate != null ? o.rate : person === LUKA ? 0.24 : 0.1, tax = o.tax != null ? o.tax : Math.round(gross * rate / 100) * 100, sg = Math.round(gross * sgRate(payDate) / 100), net = gross - tax;
  const s = { person, name, employer, payDate, from, to, gross, tax, super: sg, net, fy: fyOf(payDate), ...o };
  PAY.slips.push(s); count("payslip");
  return s;
}
const LOAN_CO = { lent: [] };
function lukaPay() {
  const r = rng("luka"), plainPays = [], noSlip = [];
  for (let d = "2024-07-12"; d <= END; d = addDays(d, 14)) {
    if (d >= INJURY && d < BACK) continue;
    if (d === "2025-01-24") continue;                          // no work in the Wet: the pay is skipped, and nothing says so but its absence
    const slow = d >= "2024-12-01" && d <= "2025-02-28", p = prevBiz(d);
    const gross = cents(r, slow ? 2000 : 3400, slow ? 3000 : 5400), s = slip(LUKA, LUKA, CO, p, addDays(d, -13), d, gross, { noFile: p >= NOSLIP_FROM && p <= NOSLIP_TO, bank: EV });
    if (p === "2024-12-13") {
      // a customer is late, so one payslip is paid in two parts, eleven days apart
      const a = earn(EV, p, WAGE, 150000, "SALARY"), b = earn(EV, "2024-12-24", WAGE, s.net - 150000, "SALARY");
      trap("T5-PAY-IN-PARTS", "One payslip, paid in two credits eleven days apart", `${EV}: the pay of ${p}, net ${money(s.net)}, lands as 1,500.00 that day and ${money(b.cents)} on ${b.date}, beyond schema/matching.json's five-day wage window`, "Both credits are that one pay: income, net, once.",
        { kind: "lines", lines: [plain(a, "income"), plain(b, "income")] });
    } else if (p === "2025-02-07") {
      // the pay run is keyed twice; the second credit is recalled four days later
      const a = earn(EV, p, WAGE, s.net, "SALARY"), b = line(EV, p, WAGE, s.net, { dup: true }), c = line(EV, "2025-02-11", "RECALL DUPLICATE CREDIT NOVAK ELECTRICAL", -s.net, { dup: true });
      trap("T5-WAGE-RECALL", "A pay run keyed twice, the second credit recalled", `${EV} ${p}: two credits of ${money(s.net)}, one payslip. ${c.date}: the same amount back out`, "One pay. The second credit and the recall are nothing. If the second is wages and the recall a purchase, income and spending are both high by the same amount and every total still adds.",
        { kind: "lines", lines: [{ account: EV, date: p, cents: s.net, want: "mixed:income,neither", n: 2 }, plain(c, "neither")] }, { fresh: true, dc: true });
      void a; void b;
    } else {
      const x = earn(EV, p, WAGE, s.net, "SALARY");
      (s.noFile ? noSlip : plainPays).push(x);
      if (p === "2025-05-16") {
        // the same week the company is short by what it just paid him, and Marisol lends it from her own account
        const t = own(EV, "2025-05-15", "OSKO TO M BAUTISTA", MA, "2025-05-15", "OSKO FROM L NOVAK", s.net + 50000);
        const o = line(MA, "2025-05-19", `${TOCO} LOAN`, -s.net, {}); line(DL, "2025-05-19", "Marisol's loan to the company", s.net, {});
        const bk = line(MA, "2025-06-03", "NOVAK ELECTRICAL PTY LTD LOAN REPAY", s.net, {}); line(DL, "2025-06-03", "Repaid to Marisol", -s.net, {});
        trap("T5-WAGE-FALSE-PAIR", "His wage into one account and a loan to the same company out of another, same amount, three days apart", `${EV} ${p}: +${money(s.net)}, "${WAGE}", no payslip that month. ${MA} ${o.date}: -${money(s.net)}, "${o.desc}". Opposite to the cent, on two of the household's accounts, with OSKO and a member's surname`, "Income and a loan. If they pair as an own transfer, a fortnight's wage vanishes and nothing says so.",
          { kind: "lines", lines: [plain(x, "income"), plain(o, "neither"), plain(bk, "neither")] }, { fresh: true, dc: true });
        void t;
      }
      if (p === "2025-10-03") {
        const dv = earn(EV, p, "NOVAK ELECTRICAL PTY LTD DIV", s.net, "DIVIDEND");
        trap("T5-DIV-BESIDE-PAY", "A dividend and a pay from one company, one day, one amount, one payslip", `${EV} ${p}: ${money(s.net)} twice, "PAY" and "DIV"`, "Two incomes. The payslip clears one, the other is not a repeat of it.",
          { kind: "lines", lines: [{ account: EV, date: p, cents: s.net, want: "income", n: 2 }] }, { fresh: true, dc: true });
        void dv;
      }
    }
  }
  trap("T5-DIRECTOR-WAGE", "A director's pay from his own company, whose name is his surname, irregular in amount and date", `${EV}: ${plainPays.length + noSlip.length + 2} fortnights from 2024-07-12, "${WAGE}", 2,000.00 to 5,400.00 gross, a pay skipped in the Wet, none at all while he is injured. Payslips by Pawroll`, "Income, net, each clearing its payslip. A member's surname does not make it an own transfer, and an amount that moves does not make it unexplained.",
    { kind: "lines", lines: [plainPays[0], plainPays[6], plainPays[plainPays.length - 2]].map((x) => plain(x, "income")) }, { fresh: true, dc: true });
  trap("T5-IS-NO-SLIPS", "A year's income statement over months with no payslips, because the bookkeeper is having a baby", `${noSlip.length} pays from ${NOSLIP_FROM} to ${NOSLIP_TO} reach ${EV} with no payslip. The accountant's income statements list them all`, "Each credit is income, once. A statement that recognises the year's gross must not add to credits already standing as wages, and a credit must not read as anything else for want of a slip.",
    { kind: "lines", lines: [noSlip[0], noSlip[4], noSlip[noSlip.length - 1]].map((x) => plain(x, "income")) }, { fresh: true, dc: true });
  // the Christmas bonus: two people, one employer, one amount, one line of text, one account
  const b1 = slip(LUKA, LUKA, CO, "2024-12-20", "2024-12-20", "2024-12-20", 65000, { tax: 15000, bank: EV }), b2 = slip(MARI, MARI, CO, "2024-12-20", "2024-12-20", "2024-12-20", 65000, { tax: 15000, bank: EV });
  earn(EV, "2024-12-20", WAGE, b1.net, "SALARY"); earn(EV, "2024-12-20", WAGE, b2.net, "SALARY");
  trap("T5-TWO-BONUSES", "Two directors' bonuses: two people, one employer, one day, one amount, one line of text", `${EV} 2024-12-20: 500.00 twice, a payslip each. Luka's and Marisol's`, "Two pays. Two lines in one file are two.",
    { kind: "lines", lines: [{ account: EV, date: "2024-12-20", cents: 50000, want: "income", n: 2 }] });
  // dividends from his own company, paid in cash, with a minute no public recipe reads
  const divs = [["2025-06-20", 800000], ["2026-06-19", 1200000]].map(([d, c]) => earn(EV, d, "NOVAK ELECTRICAL PTY LTD DIV", c, "DIVIDEND"));
  trap("T5-OWN-DIVIDEND", "A dividend from his own company, by bank transfer", `${EV}: ${divs.map((x) => `${money(x.cents)} on ${x.date}`).join(", ")}. No registry, no holding, and a director's minute no public recipe reads`, "Income. It has no instrument to clear against and no payslip, and that does not make it unexplained.",
    { kind: "lines", lines: divs.map((x) => plain(x, "income")) }, { fresh: true });
}
function marisolPay() {
  const r = rng("marisol"), split = [], mine = [];
  for (let d = "2023-07-13"; d <= END; d = addDays(d, 14)) {
    if (d >= LEAVE_FROM && d < LEAVE_TO) continue;
    const gross = cents(r, 1280, 1880), s = slip(MARI, MARI_PAY, DENTAL, d, addDays(d, -13), d, gross, { split: true, bank: MA }), bank = d === "2024-06-27" ? "2024-07-01" : d;
    const a = earn(MA, bank, "CAPRICORN DENTAL WAGES", s.net - 10000, "SALARY"), b = earn(JT, bank, "CAPRICORN DENTAL WAGES SAVE", 10000, "SALARY"); split.push([a, b, s]); mine.push(a);
  }
  trap("T5-NET-PAY-SPLIT", "One payslip, two bank credits", `${split.length} pays: each Capricorn Dental net reaches ${MA} less 100.00, and ${JT} 100.00`, "Both credits are that one pay. Cash income is the net once.",
    { kind: "lines", lines: [split[4], split[20], split[35]].flatMap(([a, b]) => [plain(a, "income"), plain(b, "income")]) });
  const strad = split.find((x) => x[2].payDate === "2024-06-27");
  trap("T5-PAY-STRADDLE", "Pay dated in June, banked in July", `Capricorn Dental's pay of ${money(strad[2].net)}: payslip 2024-06-27, ${MA} 2024-07-01`, "Cash income lands in July, when the money arrived.",
    { kind: "lines", lines: [plain(strad[0], "income", { month: "2024-07" })] });
  trap("T5-MARRIED-NAME", "Her payslips carry her married name, and setup has the other one", `Every Capricorn Dental payslip and income statement says "${MARI_PAY}". Her fund, her notices and setup say "${MARI}". A person gave one name at onboarding`, "Income at the net. A person is one person under two names, and a name that does not resolve must not lose the pay or make it a question of who.",
    { kind: "lines", lines: [mine[6], mine[30], mine[mine.length - 3]].map((x) => plain(x, "income")) }, { fresh: true, dc: true });
  const cl = [line(MA, "2024-05-09", "CAPRICORN DENTAL UNIFORM CLAIM", 12400, {}), line(MA, "2025-11-13", "CAPRICORN DENTAL UNIFORM CLAIM", 9860, {})];
  trap("T5-REIMB", "An employer's credit that is not pay", `${MA}: uniforms paid back by the employer, by name, with no payslip to clear`, "SPEC 4.4c: neither income nor spending, and not a wage. Only the credit is probed.",
    { kind: "lines", lines: cl.map((x) => plain(x, "neither")) });
  // her pay from the company: the books, monthly, to her own account
  const books = []; for (const ym of monthRange("2024-07", "2026-06")) {
    const p = prevBiz(nthFri(ym, 4)); if (p >= "2025-03-01" && p < "2025-09-20") continue;
    const s = slip(MARI, MARI, CO, p, `${ym}-01`, monthEnd(ym), 52000, { rate: 0, bank: MA }); books.push(earn(MA, p, WAGE, s.net, "SALARY"));
  }
  trap("T5-BOOKKEEPER", "The director's wife on the same payroll, the same text, to another account", `${MA}: ${books.length} monthly credits of 520.00, "${WAGE}"`, "Income. The same employer pays two members, and each pay clears its own payslip.",
    { kind: "lines", lines: [books[1], books[6], books[books.length - 2]].map((x) => plain(x, "income")) }, { fresh: true });
  // weekends at the council library: an employer in setup, payslips behind a portal she never opens. The same council takes the rates
  const lib = []; for (const ym of monthRange("2023-07", "2024-12")) lib.push(earn(MA, prevBiz(`${ym}-15`), "CAPRICORN COAST COUNCIL PAY 7714", cents(r, 410, 620), "SALARY"));
  trap("T5-NO-PAYSLIP", "A job with a declared employer and no payslip ever held, and the same council takes the rates", `${MA}: ${lib.length} monthly credits, "CAPRICORN COAST COUNCIL PAY 7714". The employment is in setup. ${JT} pays the same council its rates`, "Income. The bank line is the only witness, and a rates-payer's refund it is not.",
    { kind: "lines", lines: lib.map((x) => plain(x, "income")) });
}

// ---------- the sole trader, until 30 June 2024 ----------
const TRADE = { q: {}, names: [], takings: [], builders: [], cash: [], bas: [] };
const addQ = (d, field, c) => { const m = Number(d.slice(5, 7)), y = d.slice(0, 4), q = m <= 3 ? `${y}-03` : m <= 6 ? `${y}-06` : m <= 9 ? `${y}-09` : `${y}-12`, x = (TRADE.q[q] = TRADE.q[q] || { sales: 0, costs: 0 }); x[field] += c; };
const PAYERS = ["J HARGREAVES", "T HEGARTY", "G TULLY", "P ROSSITER", "S PRICE", "K MCALLUM", "B FENWICK", "D TIERNEY", "L OSULLIVAN", "A DIMITRIOU", "R CLANCY", "H NGUYEN", "C MANSFIELD", "W TEMPLETON", "N FARAH", "E BROSNAN", "M QUILTY", "F STRACHAN", "V COSTELLO", "I PEMBERTON", "O LINCOLN", "Y TANAKA", "U MORCOMBE", "Q DARROCH"];
function soleTrader() {
  const r = rng("trade"); let inv = 1000;
  for (const ym of monthRange("2023-07", "2024-06")) {
    { const d = nextBiz(`${ym}-${pad(r.int(6, 12))}`), c = cents(r, 4000, 11000); TRADE.builders.push(earn(BZ, d, "DIRECT CREDIT WARLENS BUILDING GROUP 30112", c, "x_TRADE")); addQ(d, "sales", c); }
    if (Number(ym.slice(5)) % 2 === 0) { const d = nextBiz(`${ym}-${pad(r.int(16, 24))}`), c = cents(r, 3000, 8000); TRADE.builders.push(earn(BZ, d, "DIRECT CREDIT TROPICAL HOMES QLD 7741", c, "x_TRADE")); addQ(d, "sales", c); }
    for (let i = 0; i < 9; i += 1) { const d = nextBiz(`${ym}-${pad(r.int(1, 27))}`), c = cents(r, 180, 1900), who = r.pick(PAYERS); inv += 1; TRADE.takings.push(earn(BZ, d, `OSKO FROM ${who} INV ${inv}`, c, "x_TRADE")); addQ(d, "sales", c); }
    for (let i = 0; i < 2; i += 1) { const d = nextBiz(`${ym}-${pad(r.int(2, 27))}`), c = r.int(4, 18) * 2500; TRADE.cash.push(earn(BZ, d, "CASH DEPOSIT EAST ST BRANCH", c, "x_TRADE")); addQ(d, "sales", c); }
    for (const dd of ["05", "19"]) { const d = nextBiz(`${ym}-${dd}`), c = cents(r, 1500, 3800); spend(BZ, d, "BPAY VOLTMART TRADE 40021", c, "WORK-EQUIP"); addQ(d, "costs", c); count("purchase"); }
    { const d = nextBiz(`${ym}-12`), c = cents(r, 900, 2400); spend(BZ, d, "BPAY CQ CABLE AND CONDUIT 77120", c, "WORK-EQUIP"); addQ(d, "costs", c); count("purchase"); }
    { const d = nextBiz(`${ym}-26`), c = cents(r, 1800, 3400); spend(BZ, d, "OSKO TO D MOLLOY SUBCONTRACT", c, "WORK-OTHER"); addQ(d, "costs", c); count("purchase"); }
    spend(BZ, nextBiz(`${ym}-02`), "DIRECT DEBIT TRADELINE INSURANCE 9021", 21400, "WORK-OTHER"); spend(BZ, monthEnd(ym), "ACCOUNT KEEPING FEE", 1000, "FEES"); count("purchase", 2);
  }
  trap("T5-TAKINGS", "A sole trader's takings from two dozen customers, each named only by a bank line", `${BZ}: ${TRADE.takings.length} credits, "OSKO FROM <name> INV <n>", from ${PAYERS.length} different people. An activity is in setup, and no customer is`, "Income at what was paid, on the bank line. It takes a question to know each one.",
    { kind: "lines", lines: [TRADE.takings[8], TRADE.takings[50], TRADE.takings[95]].map((x) => plain(x, "income")) });
  trap("T5-BUILDER-PROGRESS", "Builders' progress claims: large direct credits on no rhythm, from a company nobody declared", `${BZ}: ${TRADE.builders.length} credits of 3,000.00 to 11,000.00, "DIRECT CREDIT ..."`, "Income. Each is a month's work for a sole trader, and none is a refund, a wage or a transfer.",
    { kind: "lines", lines: [TRADE.builders[2], TRADE.builders[9], TRADE.builders[15]].map((x) => plain(x, "income")) }, { fresh: true });
  trap("T5-CASH-TAKINGS", "Cash takings banked at a branch, no payer on the line", `${TRADE.cash.length} deposits, "CASH DEPOSIT EAST ST BRANCH"`, "Income. A deposit is a word in schema/matching.json, and it has no other side.",
    { kind: "lines", lines: [TRADE.cash[3], TRADE.cash[17]].map((x) => plain(x, "income")) });
  const g = line(BZ, "2024-02-19", "OSKO TO G TULLY REFUND INV 1113", -64000, { lens: "income", cat: "x_TRADE" }); addQ(g.date, "sales", -64000);
  trap("T5-CUSTOMER-REFUND", "A customer paid back: a debit that is less income, not a purchase", `${BZ} ${g.date}: -640.00 to a customer who paid twice`, "A negative in income. As a purchase it inflates spending and leaves the double payment in income, and every total still adds. It takes a question or a rule.",
    { kind: "lines", lines: [plain(g, "income")] }, { fresh: true, dc: true });
  const cr = line(BZ, "2024-03-07", "VOLTMART TRADE CREDIT 40021", 41250, { lens: "spending", cat: "WORK-EQUIP" }); addQ(cr.date, "costs", -41250);
  trap("T5-SUPPLIER-CREDIT", "A supplier's credit: money in that is cheaper materials", `${BZ} ${cr.date}: +412.50 from the supplier he pays every fortnight`, "Lowers WORK-EQUIP spending. Here the rule that a credit from someone paid is a refund is right.",
    { kind: "lines", lines: [plain(cr, "spending")] }, { fresh: true });
  // GST, each quarter of the sole trader's last year
  for (const q of Object.keys(TRADE.q).sort()) {
    const x = TRADE.q[q], gst = Math.round(x.sales / 11) - Math.round(x.costs / 11), m = Number(q.slice(5)), due = nextBiz(`${m === 12 ? `${Number(q.slice(0, 4)) + 1}-02` : `${q.slice(0, 4)}-${pad(m + 1, 2)}`}-28`);
    x.gst = gst; x.due = due; TRADE.bas.push(line(BZ, due, "BPAY ATO BAS 551004412339221", -gst, { bas: true })); count("bas");
  }
  trap("T5-BAS-PAY", "GST paid over each quarter, money that was never his", `${TRADE.bas.length} lines, "BPAY ATO BAS 551004412339221", from ${BZ}`, "Neither spending nor income: the tax position, schema/events.json bas_payment. The statements behind them have no public recipe.",
    { kind: "lines", lines: [TRADE.bas[1], TRADE.bas[3]].map((x) => plain(x, "neither")) });
}
function materials() {
  const r = rng("materials"), before = [], after = [], byMonth = {};
  for (let d = "2023-07-03"; d <= END; d = addDays(d, 1)) {
    if (!isBiz(d) || r.next() > 0.2) continue;
    if (d >= INJURY && d < BACK) continue;
    const m = r.pick(MER.trade), c = cents(r, 45, 780);
    if (d < INCORP) before.push(card(r, d, m, c, "WORK-EQUIP"));
    else { const x = card(r, d, m, c, null, { lens: null, extra: { company: true } }); after.push(x); const k = ymOf(d); byMonth[k] = (byMonth[k] || 0) + c; }
  }
  const backs = [];
  for (const k of Object.keys(byMonth).sort()) backs.push(line(EV, nextBiz(`${nextMonth(k)}-06`), "NOVAK ELECTRICAL PTY LTD EXP REIMB", byMonth[k], { company: true }));
  const real = backs.filter((x) => x.date <= END), tot = (a) => a.reduce((t, x) => t + Math.abs(x.cents), 0);
  trap("T5-SOLE-TRADER-COSTS", "The same supplier, while the business was his own", `${CC}: ${before.length} lines at VOLTMART TRADE and CQ CABLE AND CONDUIT before ${INCORP}, and the BPAYs from ${BZ}`, "Spending. His costs, while the takings were his income.",
    { kind: "lines", lines: [before[4], before[30], before[before.length - 3]].map((x) => plain(x, "spending", { n: 1 })) }, { fresh: true });
  trap("T5-MATERIALS", "The company's materials on his personal card, paid back each month as one lump", `${CC}: ${after.length} lines worth ${money(tot(after))} from ${INCORP}, the same two suppliers. ${EV}: ${real.length} monthly credits, "NOVAK ELECTRICAL PTY LTD EXP REIMB", each the month's sum`, "SPEC 4.4c: the company's money, neither spending nor income, on either side. If the lines are spending and the lump is wages, spending and income are both high by the whole amount and every total adds. Same merchants as the trap above, opposite truth. No line equals the lump.",
    { kind: "lines", lines: [...[after[6], after[60], after[after.length - 4]].map((x) => plain(x, "neither", { n: 1 })), ...[real[1], real[8], real[real.length - 2]].map((x) => plain(x, "neither"))] }, { fresh: true, dc: true });
}
/* the sole trader's own money: drawings to the offset, and tax put aside */
function drawings() {
  const dr = [];
  for (let d = "2023-07-07"; d < INCORP; d = addDays(d, 7)) { const p = prevBiz(d); dr.push(own(BZ, p, "OSKO TO L NOVAK DRAWINGS", EV, p, "OSKO FROM L NOVAK DRAWINGS", 155000)); }
  for (const ym of monthRange("2023-07", "2024-06")) { const p = nextBiz(`${ym}-15`); own(BZ, p, "OSKO TO TAX SAVER", TS, p, "OSKO FROM NOVAK ELECTRICAL", 90000); }
  const ps = [dr[3], dr[20], dr[44]];
  trap("T5-DRAWINGS", "Drawings from a sole trader's business account to the offset", `${dr.length} weekly transfers from ${BZ} to ${EV}, same owner, round amounts`, "Own money: neither. Income was the takings going in; a draw is not income a second time.",
    { kind: "lines", lines: ps.flatMap(([a, b]) => [plain(a, "neither"), plain(b, "neither")]) });
}

// ---------- the company: what crosses the household's rails once it is a stranger ----------
function incorporation() {
  // customers keep paying the old account for the company's work, off an old invoice template
  const old = [["2024-07-22", "OSKO FROM P ROSSITER INV 2017", 132000], ["2024-08-13", "DIRECT CREDIT TROPICAL HOMES QLD 7741", 264000], ["2024-09-03", "OSKO FROM K MCALLUM INV 2041", 88000]].map(([d, t, c]) => line(BZ, d, t, c, {}));
  const sum = old.reduce((t, x) => t + x.cents, 0);
  const on = line(BZ, BIZ_CLOSE, `${TOCO} CUST FUNDS`, -sum, {});
  const left = (OPEN[BZ] + B.lines.filter((x) => x.acct === BZ).reduce((t, x) => t + x.cents, 0));
  const cl = line(BZ, BIZ_CLOSE, `${TOCO} CLOSING`, -left, {}); line(DL, BIZ_CLOSE, "The trading account's balance, lent to the company", left, {});
  trap("T5-OLD-ACCOUNT", "Customers pay the company's invoices into the sole trader's old account, and they are passed on", `${BZ}: ${old.length} credits worth ${money(sum)} after ${INCORP}, reading as his takings did, the same builder among them. ${on.date}: one debit of the sum, to the company`, "Neither, both ways: the company's money, on his rails for a few weeks. As income they overstate him, and as a loan to the company they overstate the debt.",
    { kind: "lines", lines: [...old.map((x) => plain(x, "neither")), plain(on, "neither")] }, { fresh: true, dc: true });
  trap("T5-INCORPORATION", "The trading account closes and its balance goes to the new company as a loan", `${BZ}: closed ${BIZ_CLOSE}. ${money(left)} goes to the company, in setup as a loan the household holds`, "Neither. The balance stops at zero, and the loan to the company stands at what went in.",
    { kind: "lines", lines: [plain(cl, "neither")], balances: [{ account: DL, months: ["2024-09", "2024-10"] }], zero_after: { account: BZ, from: "2024-09" } }, { fresh: true, dc: true });
  // the slow patch: he lends it his own money, and it pays him back
  const out = line(EV, "2024-11-18", `${TOCO} LOAN`, -3000000, {}); line(DL, out.date, "Lent in the slow patch", 3000000, {});
  const dates = ["2025-07-15", "2025-08-15", "2025-09-15", "2026-04-15", "2026-05-15"], bk = dates.map((d) => { line(DL, d, "Repaid", -500000, {}); return line(EV, d, "NOVAK ELECTRICAL PTY LTD LOAN REPAY", 500000, {}); });
  trap("T5-CO-LOAN-OUT", "Money lent to his own company in a slow patch", `${EV} ${out.date}: -30,000.00, "${out.desc}". The company is his employer in setup, and also the borrower on a declared loan`, "Neither. The loan account rises by it, and a loan to a company is not a purchase.",
    { kind: "lines", lines: [plain(out, "neither")], balances: [{ account: DL, months: ["2024-11", "2024-12"] }] }, { fresh: true, dc: true });
  trap("T5-CO-LOAN-BACK", "One payer, an employer and a borrower: the company pays its loan back", `${EV}: ${bk.length} credits of 5,000.00, "NOVAK ELECTRICAL PTY LTD LOAN REPAY". The same party pays his wages to the same account`, "Neither, and the loan falls. An employer named in setup beats a dictionary guess about money coming in; it must not make a repaid loan into wages.",
    { kind: "lines", lines: bk.slice(0, 3).map((x) => plain(x, "neither")), balances: [{ account: DL, months: ["2025-07", "2025-09", "2026-06"] }] }, { fresh: true, dc: true });
  // a customer who still has his old bank details
  const a = line(EV, "2025-01-15", "OSKO FROM T HEGARTY INV 2291", 198000, {}), b = line(EV, "2025-01-16", `${TOCO} HEGARTY`, -198000, {});
  trap("T5-CUSTOMER-IN-PERSONAL", "A customer of the company pays the household's offset by mistake", `${EV} ${a.date} +1,980.00, passed on ${b.date}. The payer is one the sole trader once billed`, "Neither, both ways. The debit names the company and is no loan to it: read as one, the loan account is 1,980.00 high.",
    { kind: "lines", lines: [plain(a, "neither"), plain(b, "neither")] }, { fresh: true, dc: true });
  // the tax office still has his bank details for the company's activity statement
  const c = line(EV, "2024-09-17", "ATO EFT REFUND 66310 BAS", 648200, {}), d = line(EV, "2024-09-18", `${TOCO} ATO REFUND`, -648200, {});
  trap("T5-COMPANY-ATO-REFUND", "The company's BAS refund lands on the director's own account, and is passed on", `${EV} ${c.date}: +6,482.00, "${c.desc}"; ${d.date}: the same out to the company. Luka's own notices sit around it`, "Neither, both ways. It is not his refund and must not clear his notice, and it is not income.",
    { kind: "lines", lines: [plain(c, "neither"), plain(d, "neither")] }, { fresh: true, dc: true });
}
/* the one stray file: a quarter of the company's own account, saved by hand into the old trading account's folder. The same bank, the same layout, another number. */
const STRAY = { lines: [] };
function strayFile() {
  const r = rng("stray"); let bal = 1184020;
  const add = (d, t, c) => { bal += c; STRAY.lines.push({ date: d, desc: t, cents: c, balance: bal }); };
  const pays = B.lines.filter((x) => x.acct === EV && x.desc === WAGE && x.date >= "2025-01-01" && x.date <= "2025-03-31" && x.cents > 0);
  for (const ym of monthRange("2025-01", "2025-03")) {
    for (let i = 0; i < 8; i += 1) { const d = nextBiz(`${ym}-${pad(r.int(1, 26))}`); add(d, `OSKO FROM ${r.pick(PAYERS)} INV C${r.int(2100, 2999)}`, cents(r, 240, 3200)); }
    add(nextBiz(`${ym}-10`), "DIRECT CREDIT WARLENS BUILDING GROUP INV C1188", cents(r, 5200, 12000));
    add(nextBiz(`${ym}-07`), "BPAY VOLTMART TRADE 40021 ACC C1188", -cents(r, 2400, 5200));
    add(nextBiz(`${ym}-21`), "BPAY CQ CABLE AND CONDUIT 77120 ACC C1188", -cents(r, 900, 2600));
  }
  for (const p of pays) add(p.date, "PAYROLL RUN C1102 L NOVAK", -p.cents);
  STRAY.lines.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  let b2 = 1184020; for (const x of STRAY.lines) { b2 += x.cents; x.balance = b2; }
  const smp = STRAY.lines.filter((x) => x.cents > 0).slice(0, 3);
  trap("T5-STRAY-FILE", "A quarter of the company's own account, saved into the old trading account's folder", `sources/${BZ}: one Harbour CSV of ${STRAY.lines.length} lines, January to March 2025, ${money(STRAY.lines.filter((x) => x.cents > 0).reduce((t, x) => t + x.cents, 0))} in, numbered ${NUM.co}. That number is in no alias. ${BZ} closed in September 2024. Its payroll debits equal his wage credits to the cent`, "None of it is the household's. A file for an account nobody declared must not reach income, spending, a balance or a pairing. Being left unposted, or held with a question, is right; being posted to the closed account because of the folder is the worst of it.",
    { kind: "lines", stray: { match: "INV C2\\d{3}|ACC C1188|INV C1188|PAYROLL RUN C1102" }, absent: smp.map((x) => ({ account: BZ, date: x.date, cents: x.cents })), zero_after: { account: BZ, from: "2024-10" } }, { fresh: true, dc: true });
}

// ---------- tax, as a person pays it ----------
const TAX = { notices: [] };
function taxes() {
  const pg = ["2023-10-30", "2024-02-28", "2024-04-29", "2024-07-29", "2024-10-28"].map((d) => line(TS, d, "BPAY ATO PAYG 551004412339221", -318000, { tax: true }));
  trap("T5-PAYG-INSTALMENT", "PAYG instalments paid each quarter from a tax saver", `${TS}: ${pg.length} lines of 3,180.00, "BPAY ATO PAYG 551004412339221", against no bill in any file. Each notice shows them only as a credit`, "Neither spending nor income: tax paid in advance into the position, schema/events.json tax_payment. Spending them and then counting the assessment double-counts the year's tax.",
    { kind: "lines", lines: [pg[0], pg[2], pg[4]].map((x) => plain(x, "neither")) }, { fresh: true, dc: true });
  const sum = (fy, who) => PAY.slips.filter((s) => s.person === who && s.fy === fy).reduce((t, s) => t + s.tax, 0);
  const note = (person, fy, version, lodged, assessed, ti, payg, result) => { const medicare = Math.round(ti * 0.02), gross = Math.max(0, payg - result - medicare); const n = { person, fy, version, lodged, assessed, ti, payg, help: 0, other: 0, gross, medicare, offsets: 0, result }; TAX.notices.push(n); count("tax_assessment"); return n; };
  note(LUKA, 2023, 1, "2023-10-10", "2023-10-24", 8840000, 1272000, 188000);
  note(LUKA, 2024, 1, "2024-10-08", "2024-10-15", 9720000, 1272000, 234000);
  note(LUKA, 2024, 2, "2025-05-13", "2025-05-20", 9410000, 1272000, 61000);
  note(LUKA, 2025, 1, "2025-10-14", "2025-10-28", 11640000, sum(2025, LUKA) + 318000, -744000);
  note(MARI, 2023, 1, "2023-08-08", "2023-08-22", 4410000, 402000, 91000);
  note(MARI, 2024, 1, "2024-08-06", "2024-08-20", 4620000, sum(2024, MARI), 112000);
  note(MARI, 2025, 1, "2025-08-05", "2025-08-19", 3180000, sum(2025, MARI), 64000);
  const a = line(EV, "2023-10-27", "ATO EFT REFUND 6620423", 188000, { tax: true }), b = line(MA, "2024-08-23", "ATO EFT REFUND 6620424", 112000, { tax: true }), c = line(MA, "2023-08-25", "ATO EFT REFUND 6620423", 91000, { tax: true }), c2 = line(MA, "2025-08-22", "ATO EFT REFUND 6620425", 64000, { tax: true });
  trap("T5-TAX-REFUND", "A tax refund", `${EV} ${a.date}, ${MA} ${c.date}, ${b.date} and ${c2.date}, each the figure on its notice`, "Neither income nor spending: TAX-REFUND is a transfer with the tax position.",
    { kind: "lines", lines: [a, b, c, c2].map((x) => plain(x, "neither")) });
  const ag = line(EV, "2024-10-22", "CAPRICORN TAX SERVICES TRUST 8841", 206000, { tax: true });
  trap("T5-REFUND-VIA-AGENT", "A refund paid through the tax agent's trust account, the fee taken off", `${EV} ${ag.date}: +2,060.00 from a tax agent's trust account. The notice says 2,340.00, and the agent kept 280.00. No line says ATO`, "Neither: it is the refund, less a fee no file states. It is not income, and the agent is not someone the household paid and got a refund from.",
    { kind: "lines", lines: [plain(ag, "neither")] }, { fresh: true, dc: true });
  const am = line(EV, "2025-05-23", "ATO EFT REFUND 6620424", 61000, { tax: true });
  trap("T5-AMENDED-NOA", "An amended notice, seven months on, with its own small refund", `${EV} ${am.date}: +610.00. FY2024 has two notices, version 1 with a result of 2,340.00 and version 2 with 610.00, and SPEC 9 says an amended assessment posts only the change`, "Neither. The second notice does not re-assess the first, and its refund clears only itself.",
    { kind: "lines", lines: [plain(am, "neither")] }, { fresh: true, dc: true });
  const plan = ["2025-12-05", "2026-01-05", "2026-02-05", "2026-03-05", "2026-04-07", "2026-05-05"].map((d) => line(EV, nextBiz(d), "ATO PAYMENT PLAN 551004412339221", -124000, { tax: true })); count("tax_payment", plan.length);
  trap("T5-TAX-BILL", "A notice with a bill on it, paid on a plan in six parts", `${EV}: ${plan.length} debits of 1,240.00 from ${plan[0].date}, against a notice of -7,440.00`, "Neither income nor spending, in any of the parts.",
    { kind: "lines", lines: [plan[0], plan[3], plan[5]].map((x) => plain(x, "neither")) });
}

// ---------- the home, the ute, the boat, the brother ----------
const LOANS = { home: [], ute: [], uteLines: [] };
const RATES = [["2023-07-01", "6.19"], ["2025-02-20", "5.94"], ["2025-05-22", "5.69"], ["2025-08-14", "5.44"]];
const rateOn = (d) => RATES.filter((x) => x[0] <= d).pop()[1];
const HOMEPAY = 169000, HOME_OPEN = 48640000;
function homeRepayments() {
  const skipped = [];
  for (let d = "2023-07-07"; d <= END; d = addDays(d, 14)) {
    if (d >= HARD_FROM && d <= HARD_TO) { skipped.push(d); continue; }
    spend(EV, d, `WESTPAW HOME LOAN ${NUM.home.replace(/ /g, "")}`, HOMEPAY, "MORTGAGE"); line(HL, d, "Repayment", HOMEPAY, {}); count("loan_repayment");
  }
  trap("T5-HARDSHIP", "A lender's hardship pause: three months with no repayment and the interest added on", `${HL}: no repayment from ${HARD_FROM} to ${HARD_TO}, while he is off work. The contract in setup still says 1,690.00 a fortnight. ${EV} shows nothing`, "No spending in those months, and the loan rises by the interest. A repayment that did not happen must not be imputed from the term.",
    { kind: "lines", absent: skipped.slice(0, 3).map((d) => ({ account: EV, date: d, cents: -HOMEPAY })), balances: [{ account: HL, months: ["2025-12", "2026-01"] }] }, { fresh: true, dc: true });
}
function homeInterest() {
  const ls = B.lines.filter((x) => x.acct === EV).sort(byTime); let i = 0, off = OPEN[EV], bal = HOME_OPEN, accrued = 0;
  const reps = new Map(); for (const x of B.lines.filter((l) => l.acct === HL)) reps.set(x.date, (reps.get(x.date) || 0) + x.cents);
  for (const ym of MONTHS) {
    const open = bal; let paid = 0;
    for (let d = `${ym}-01`; d <= monthEnd(ym); d = addDays(d, 1)) {
      while (i < ls.length && ls[i].date <= d) { off += ls[i].cents; i += 1; }
      if (reps.has(d)) { bal -= reps.get(d); paid += reps.get(d); }
      accrued += Math.max(0, bal - Math.max(0, off)) * Number(rateOn(d)) / 100 / 365;
    }
    const c = Math.round(accrued); accrued = 0; bal += c;
    line(HL, monthEnd(ym), "Interest charged", -c, {});
    LOANS.home.push({ ym, rate: rateOn(monthEnd(ym)), open: -open, interest: c, paid, close: -bal, offset: Math.max(0, off) });
  }
}
function ute() {
  let bal = OPEN[UL], accrued = 0;
  const push = (d, desc, c) => { bal += c; LOANS.uteLines.push({ date: d, desc, cents: c, balance: bal }); return line(UL, d, desc, c, {}); };
  const reps = [], reims = []; let balloon = null;
  for (const ym of monthRange("2023-07", "2026-03")) {
    const open = bal; let paid = 0, charged = 0;
    for (let d = `${ym}-01`; d <= monthEnd(ym); d = addDays(d, 1)) {
      if (d === nextBiz(`${ym}-08`) && d < UTE_END) {
        const when = d;
        if (ym === "2024-10") {
          const x = spend(JT, when, `PING ASSET FINANCE ${NUM.ute.slice(4)}`, 128640, "CAR"), y = line(JT, addDays(when, 1), `DISHONOUR REVERSAL PING ASSET FINANCE ${NUM.ute.slice(4)}`, 128640, { lens: "spending", cat: "CAR" }), z = spend(JT, addDays(when, 1), "DISHONOUR FEE", 900, "FEES"), w = spend(JT, addDays(when, 6), `PING ASSET FINANCE ${NUM.ute.slice(4)}`, 128640, "CAR");
          trap("T5-DISHONOUR-LOAN", "A chattel repayment that bounces and is re-presented", `${JT}: ${x.date}, reversed ${y.date} with a 9.00 fee, debited again ${w.date}. The lender shows one repayment`, "The reversal cancels the first debit: the repayment counts once, the fee once, nothing is income.",
            { kind: "lines", lines: [plain(y, "spending"), plain(x, "spending"), plain(w, "spending"), plain(z, "spending")] });
        } else reps.push(spend(JT, when, `PING ASSET FINANCE ${NUM.ute.slice(4)}`, 128640, "CAR"));
        const lands = ym === "2024-10" ? addDays(when, 6) : when;
        LOANS.uteMoves = LOANS.uteMoves || []; LOANS.uteMoves.push({ d: lands, ym });
        count("loan_repayment");
        if (when >= "2024-08-01" && when < INJURY) reims.push(line(EV, bizAfter(when, 1), "NOVAK ELECTRICAL PTY LTD VEHICLE", 128640, { lens: "spending", cat: "CAR" }));
      }
      if (LOANS.uteMoves && LOANS.uteMoves.some((m) => m.d === d)) { push(d, "REPAYMENT DIRECT DEBIT", 128640); paid += 128640; }
      accrued += Math.abs(bal) * 8.45 / 100 / 365;
      if (d === UTE_END) {
        const i = Math.round(accrued); accrued = 0; push(d, "INTEREST TO PAYOUT", -i); charged += i;
        const owed = -bal; balloon = spend(EV, d, `PING ASSET FINANCE BALLOON ${NUM.ute.slice(4)}`, owed, "CAR"); push(d, "BALLOON RECEIVED", owed); paid += owed;
        LOANS.ute.push({ ym, rate: "8.45", open, interest: charged, paid, close: bal });
        break;
      }
    }
    if (balloon) break;
    const i = Math.round(accrued); accrued = 0; push(monthEnd(ym), "INTEREST CHARGED", -i); charged += i;
    LOANS.ute.push({ ym, rate: "8.45", open, interest: charged, paid, close: bal });
    count("loan_interest");
  }
  trap("T5-CHATTEL", "A ute on a chattel mortgage in his own name, its repayments from the bills account", `${JT}: ${reps.length + 1} monthly debits of 1,286.40, "PING ASSET FINANCE". The lender's half-yearly statements and download witness them`, "Spending at the cash amount, once, and the loan falls by what the lender shows.",
    { kind: "lines", lines: [reps[2], reps[14], reps[24]].map((x) => plain(x, "spending", { n: 1 })), balances: [{ account: UL, months: ["2024-06", "2025-06"] }] }, { fresh: true });
  trap("T5-UTE-REIMB", "The company pays the ute's repayment back each month, to the cent, to another account", `${EV}: ${reims.length} credits of 1,286.40, "NOVAK ELECTRICAL PTY LTD VEHICLE", the working day after each debit from ${JT}`, "Lowers the car's cost. It is not wages, though the employer's name is on it, and it is not a refund from the lender.",
    { kind: "lines", lines: [reims[1], reims[7], reims[13]].map((x) => plain(x, "spending")) }, { fresh: true, dc: true });
  trap("T5-BALLOON", "A chattel mortgage ends in a balloon far above any repayment", `${EV} ${balloon.date}: ${money(-balloon.cents)}, the residual, from the offset rather than the bills account, seventeen times the repayment in setup`, "Spending at its cash amount, as a payout is (T-CAR-PAYOUT), and the loan ends at the lender's zero.",
    { kind: "lines", lines: [plain(balloon, "spending")], zero_after: { account: UL, from: "2026-03" } }, { fresh: true, dc: true });
}
const VALUES = { home: [] };
function homeValues() {
  const r = rng("values"); let v = 64000000;
  VALUES.home.push(["2023-06-30", v]);   // the estimate that opens the window: BLIND-2's list starts at June 2023 too
  for (const m of MONTHS) { if (Number(m.slice(5)) % 3 === 0) { v = Math.round(v * (1 + r.range(0.002, 0.024)) / 100000) * 100000; VALUES.home.push([monthEnd(m), v]); } }
}
const lastVal = (list, e) => { const h = list.filter((x) => x[0] <= e); return h.length ? h[h.length - 1][1] : 64000000; };
function assets() {
  const s = line(EV, BOAT_SOLD, "OSKO FROM D FARRELL BOAT", 1650000, { capital: true });
  trap("T5-BOAT-SOLD", "A boat sold to a stranger by Osko", `${EV} ${s.date}: +16,500.00. ${BT} is typed in setup at 18,000.00, closed on that day`, "Capital, neither. The boat leaves net worth on the day it goes, and the cash is not income or a refund.",
    { kind: "lines", lines: [plain(s, "neither")], zero_after: { account: BT, from: "2025-08" } });
  const bl = line(EV, MILAN_DAY, "OSKO FROM M NOVAK LOAN", 600000, {}); line(ML, MILAN_DAY, "Loan from Milan", -600000, {});
  const reps = []; for (const ym of monthRange("2025-07", "2026-06")) { const d = nextBiz(`${ym}-05`); reps.push(line(EV, d, "OSKO TO M NOVAK LOAN", -50000, {})); line(ML, d, "Repayment", 50000, {}); }
  trap("T5-BROTHER-LOAN", "A loan from his brother, whose initial and surname are his wife's married name", `${EV}: +6,000.00 ${bl.date}, then ${reps.length} repayments of 500.00. ${ML} is declared as a debt`, "Neither income nor spending, and they owe the balance.",
    { kind: "lines", lines: [plain(bl, "neither"), plain(reps[0], "neither"), plain(reps[9], "neither")], balances: [{ account: ML, months: ["2025-01", "2025-06", "2026-06"] }] });
}

// ---------- insurance and government money ----------
const BILLS = { energy: [], water: [], rates: [], policy: [] };
const KIDS = { statements: [] };
function money_in() {
  const ip = ["2025-12-01", "2026-01-02", "2026-02-02", "2026-03-02"].map((d) => earn(EV, d, `PURRSURE LIFE CLAIM ${NUM.ip}`, 520000, "x_IP-BENEFIT"));
  trap("T5-IP-CLAIM", "An income protection benefit from the insurer the household pays each month", `${EV}: ${ip.length} monthly credits of 5,200.00, "PURRSURE LIFE CLAIM ${NUM.ip}", 148.60 a month going the other way under a contract in setup`, "Income: it replaces his wage. SPEC 6.5 reads a credit from someone the household has paid as a refund, and here that is wrong: as a refund, 20,800.00 of income becomes negative spending.",
    { kind: "lines", lines: ip.map((x) => plain(x, "income")) }, { fresh: true, dc: true });
  const ppl = []; for (let i = 0, d = "2025-03-27"; i < 11; i += 1, d = addDays(d, 14)) ppl.push(earn(MA, d, "SERVICES AUSTRALIA PPL 8812", 176440, "x_GOV-PAY"));
  trap("T5-PPL", "Parental leave pay, with no payslip", `${MA}: ${ppl.length} fortnights of 1,764.40 from ${ppl[0].date}, "SERVICES AUSTRALIA PPL 8812". Nothing in setup declares it`, "Income, in the cash lens, from a payer that is not an employer in setup.",
    { kind: "lines", lines: [ppl[0], ppl[5], ppl[10]].map((x) => plain(x, "income")) });
  const backs = [["2023-09-12", 4120], ["2024-02-27", 8635], ["2024-10-15", 4120], ["2025-05-20", 4385], ["2026-02-10", 4385]];
  for (const [d, c] of backs) { spend(JT, addDays(d, -2), "EFTPOS GRACEMERE MEDICAL CENTRE", c + 3800, "HEALTH"); line(JT, d, "SERVICES AUSTRALIA MEDICARE 2291", c, { lens: "spending", cat: "HEALTH" }); count("purchase"); }
  trap("T5-MEDICARE-SA", "A Medicare refund beside a benefit from the same agency", `${JT} on ${backs.map((b) => b[0]).join(", ")}`, "Lowers HEALTH spending. Not income, whatever is done for the agency's name.",
    { kind: "lines", lines: backs.map(([d, c]) => ({ account: JT, date: d, cents: c, want: "spending" })) });
  const debt = line(JT, "2025-09-23", "SERVICES AUSTRALIA DEBT 8812", -124000, { lens: "spending", cat: "CHILDCARE" });
  trap("T5-CCS-DEBT", "A childcare subsidy clawed back after an irregular year", `${JT} ${debt.date}: -1,240.00. His income ran above the estimate, and the subsidy, paid straight to the provider, is owed back`, "Spending on childcare. Unlike a benefit taken back it was never income in the cash lens, because the subsidy never touched an account.",
    { kind: "lines", lines: [plain(debt, "spending")] }, { fresh: true });
  // she sends money home each month, except while her mother is here
  const out = []; for (const ym of MONTHS) { if (ym >= "2025-02" && ym <= "2025-08") continue; out.push(spend(MA, nextBiz(`${ym}-02`), "PAWREMIT C BAUTISTA 00231", 30000, "GIFTS")); count("purchase"); }
  trap("T5-REMIT", "Money sent home each month, to a surname that is a member's", `${MA}: ${out.length} lines of 300.00, "PAWREMIT C BAUTISTA 00231". ${CORAZON} is no member, and setup does not know the service`, "Spending. A member's surname does not make it an own transfer, and no account of the household's receives it.",
    { kind: "lines", lines: [out[1], out[12], out[out.length - 2]].map((x) => plain(x, "spending")) }, { fresh: true });
  const inn = ["2023-09-26", "2023-12-27", "2024-03-26", "2024-06-25", "2024-09-24", "2024-12-27", "2025-03-25", "2025-06-24", "2025-09-23", "2025-12-23", "2026-03-24", "2026-06-23"].map((d) => earn(MA, d, "PAWREMIT INWARD R BAUTISTA 00231", 42000 + (d.charCodeAt(6) % 3) * 1500, "x_FOREIGN-RENT"));
  trap("T5-REMIT-INWARD", "One rail both ways: money sent home, and rent from her flat in Iloilo coming back", `${MA}: ${inn.length} quarterly credits, "PAWREMIT INWARD R BAUTISTA 00231", on the rail she pays every month`, "The credits are income, not refunds of the debits. Read as refunds, income and spending both come out low.",
    { kind: "lines", lines: [inn[1], inn[6], inn[10]].map((x) => plain(x, "income")) });
  spend(MA, "2025-01-22", "HOME AFFAIRS VISA 600 ONLINE", 19500, "PERSONAL"); count("purchase");
}
function bills() {
  const r = rng("bills"), pows = [];
  for (const q of ["2023-09", "2023-12", "2024-03", "2024-06", "2024-09", "2024-12", "2025-03", "2025-06", "2025-09", "2025-12", "2026-03"]) {
    const billDate = `${nextMonth(q)}-06`, amt = cents(r, 420, 780), gst = Math.round(amt / 11), paid = addDays(billDate, 17), b = { billDate, due: addDays(billDate, 21), from: addDays(`${q}-01`, -61), to: monthEnd(q), amt, gst, account: "TL-7730915" };
    BILLS.energy.push(b);
    if (q === "2025-06") { b.coPaid = paid; line(DL, paid, "The company paid the household's power bill", -amt, {}); continue; }
    pows.push(spend(JT, paid, "BPAY TROPICLINE POWER 7730915", amt, "UTILITIES")); count("bill_paid");
  }
  const cb = BILLS.energy.find((b) => b.coPaid);
  trap("T5-BILL-WITNESS", "A power bill and the bank line that pays it", `${JT} ${pows[3].date}: ${money(-pows[3].cents)}`, "Spending once. The bill clears against the line.", { kind: "lines", lines: [plain(pows[3], "spending", { n: 1 })] });
  trap("T5-CO-PAID-BILL", "A household bill the company paid by mistake", `A power bill of ${money(cb.amt)} dated ${cb.billDate} arrives by email, and no household account pays it: the company's card did, and he owes it back. No file says so`, "Nothing in the cash lens. A bill is a witness and not an expense. A bill with no payment may be asked about, and only a cost booked with no line is scored.",
    { kind: "lines", absent: [{ account: JT, date: cb.due, cents: -cb.amt }, { account: EV, date: cb.due, cents: -cb.amt }], lines: [plain(pows[5], "spending", { n: 1 })] });
  for (const q of ["2023-08", "2023-11", "2024-02", "2024-05", "2024-08", "2024-11", "2025-02", "2025-05", "2025-08", "2025-11", "2026-02", "2026-05"]) {
    const usage = cents(r, 90, 210), service = 7400, wb = `${q}-11`, wd = `${q}-27`; BILLS.water.push({ billDate: wb, due: wd, from: addDays(wb, -92), to: addDays(wb, -2), usage, service, amt: usage + service });
    spend(JT, addDays(wd, -1), "BPAY KEPPEL REACH WATER 60331907", usage + service, "UTILITIES"); count("bill_paid");
  }
  for (const [d, n] of [["2023-09-04", 1], ["2024-03-04", 2], ["2024-09-02", 3], ["2025-03-03", 4], ["2025-09-01", 5], ["2026-03-02", 6]]) {
    const amt = 118000 + n * 4100, due = addDays(d, 30), from = d < "2024" || d.slice(5, 7) === "09" ? `${d.slice(0, 4)}-07-01` : `${d.slice(0, 4)}-01-01`, to = from.slice(5, 7) === "07" ? `${d.slice(0, 4)}-12-31` : `${d.slice(0, 4)}-06-30`;
    BILLS.rates.push({ billDate: d, due, from, to, amt, reference: `RI-${d.slice(0, 4)}-${n}` });
    spend(JT, addDays(due, -3), "BPAY CAPRICORN COAST COUNCIL RATES 40112", amt, "RATES-HOME"); count("bill_paid");
  }
  for (const [y, amt] of [[2023, 214000], [2024, 236000], [2025, 251000]]) { BILLS.policy.push({ kind: "Home", number: NUM.policyHome, from: `${y}-10-01`, to: `${y + 1}-09-30`, amt, paid: `${y}-09-20`, sum: 72000000, excess: 100000, situ: HOME.split(",")[0], label: "Building sum insured" }); spend(JT, `${y}-09-20`, `BPAY PURRSURE HOME ${NUM.policyHome}`, amt, "HOME-INS"); count("purchase"); }
  for (const [y, amt] of [[2023, 96000], [2024, 102000], [2025, 108000]]) { BILLS.policy.push({ kind: "Motor", number: NUM.policyMotor, from: `${y}-08-01`, to: `${y + 1}-07-31`, amt, paid: `${y}-07-25`, sum: 2100000, excess: 80000, situ: "Kia wagon", label: "Agreed value" }); spend(JT, `${y}-07-25`, `BPAY PURRSURE MOTOR ${NUM.policyMotor}`, amt, "CAR"); count("purchase"); }
  const kr = rng("kids"), gaps = [];
  for (const ym of monthRange("2023-07", "2025-06")) {
    if (ym.slice(5) === "01") continue;
    const days = kr.int(8, 12), gross = days * 3650, subsidy = Math.round(gross * 0.55), gap = gross - subsidy;
    KIDS.statements.push({ ym, child: INES, days, gross, subsidy, gap }); gaps.push(spend(JT, nextBiz(`${nextMonth(ym)}-09`), "KITTENHOOD OSHC NORMAN GARDENS 5512", gap, "CHILDCARE")); count("childcare_gap");
  }
  trap("T5-CCS", "After-school care: gross fee, subsidy, gap", `${JT}: ${gaps.length} monthly gaps; each statement shows the gross and the subsidy, which no account sees`, "Spending is the gap, once. The subsidy is neither income nor a cash line.",
    { kind: "lines", lines: [gaps[2], gaps[13]].map((x) => plain(x, "spending", { n: 1 })) });
}

// ---------- super ----------
const SUPER = { luka: [], mari: [] };
function superFunds() {
  const r = rng("super");
  // his fund: earnings and fees, the company's guarantee a quarter behind, and the two quarters it could not pay arriving together
  const sumFor = (who, emp, from, to) => PAY.slips.filter((s) => s.person === who && s.employer === emp && s.payDate >= from && s.payDate <= to).reduce((t, s) => t + s.super, 0);
  const lk = [];
  for (const [d, from, to] of [["2024-10-26", "2024-07-01", "2024-09-30"], ["2025-01-27", "2024-10-01", "2024-12-31"], ["2025-08-26", "2025-01-01", "2025-06-30"], ["2025-10-27", "2025-07-01", "2025-09-30"], ["2026-01-27", "2025-10-01", "2025-12-31"], ["2026-04-27", "2026-01-01", "2026-03-31"]]) { const c = sumFor(LUKA, CO, from, to); if (c) { lk.push({ date: d, type: "employer", desc: "Employer contribution Novak Electrical", cents: c }); lk.push({ date: d, type: "contributions_tax", desc: "Contributions tax", cents: -Math.round(c * 0.15) }); } }
  const pers = line(TS, "2024-06-24", "BPAY PURRANNUATION 40221 PERSONAL", -1200000, {});
  lk.push({ date: "2024-06-26", type: "personal", desc: "Personal contribution, deductible", cents: 1200000 });
  B.transit.push({ from: pers.date, until: "2024-06-26", cents: 1200000 });
  let bal = OPEN[SL]; const out = [];
  for (const ym of MONTHS) {
    for (const x of lk.filter((l) => ymOf(l.date) === ym).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))) { bal += x.cents; out.push({ ...x, balance: bal }); }
    const e = monthEnd(ym), earned = Math.round(bal * r.range(-0.009, 0.015)); bal += earned; out.push({ date: e, type: "earnings", desc: "Investment earnings", cents: earned, balance: bal });
    bal -= 900; out.push({ date: e, type: "fee", desc: "Administration fee", cents: -900, balance: bal });
  }
  SUPER.luka = out; for (const x of out) line(SL, x.date, x.desc, x.cents, { superType: x.type });
  trap("T5-PERSONAL-SUPER", "A personal super contribution by BPAY, on a code no public recipe names", `${TS} ${pers.date}: -12,000.00, "${pers.desc}". ${SL}: +12,000.00 two days later, category CONTRIB-PERS, which purrannuation-csv-v2 sends to other`, "Own money moving between the tax saver and the fund. Neither spending nor income, and the fund's balance takes it once.",
    { kind: "lines", lines: [plain(pers, "neither")], balances: [{ account: SL, months: ["2024-06", "2024-12"] }] }, { fresh: true, dc: true });
  // her fund: the surgery's guarantee the month after, the company's a quarter behind
  const list = [];
  for (const ym of MONTHS) { const prev = monthRange("2023-06", ym).slice(-2)[0]; const c = sumFor(MARI, DENTAL, `${prev}-01`, monthEnd(prev)); if (c) { list.push({ date: `${ym}-14`, type: "employer", desc: "SG contribution Capricorn Dental", cents: c }); list.push({ date: `${ym}-14`, type: "contributions_tax", desc: "Contributions tax", cents: -Math.round(c * 0.15) }); } }
  let m = OPEN[SM]; const mo = [];
  for (const ym of MONTHS) {
    for (const x of list.filter((l) => ymOf(l.date) === ym)) { m += x.cents; mo.push({ ...x, balance: m }); }
    const e = monthEnd(ym), earned = Math.round(m * r.range(-0.011, 0.017)); m += earned; mo.push({ date: e, type: "earnings", desc: "Investment earnings", cents: earned, balance: m });
    m -= 620; mo.push({ date: e, type: "fee", desc: "Administration fee", cents: -620, balance: m }); m -= 1180; mo.push({ date: e, type: "insurance", desc: "Insurance premium", cents: -1180, balance: m });
  }
  SUPER.mari = mo; for (const x of mo) line(SM, x.date, x.desc, x.cents, { superType: x.type });
}

// ---------- lines that look like each other ----------
function lineTraps() {
  const r = rng("traps");
  const c = spend(EV, "2024-04-16", "OSKO TO R PRICE FOOTY TIPS", 25000, "GIFTS"), d = earn(BZ, "2024-04-17", "OSKO FROM S PRICE INV 1188", 25000, "x_TRADE"); addQ(d.date, "sales", 25000); count("purchase");
  trap("T5-FALSE-PAIR", "Two unrelated Oskos, one surname, one amount, a day apart, on two own accounts", `${EV} ${c.date} -250.00 to one man; ${BZ} ${d.date} +250.00 from his brother`, "Spending and income. If they pair, 250.00 of each vanishes and nothing says so.",
    { kind: "lines", lines: [plain(c, "spending"), plain(d, "income")] });
  const e = card(r, "2025-06-04", ["CANOPY OUTDOOR", "ONLINE"], 18900, "SHOPPING", { lag: 1 }), f = line(C2, "2025-06-13", "CANOPY OUTDOOR REFUND", 18900, { lens: "spending", cat: "SHOPPING" });
  trap("T5-REFUND-STREAM", "A refund that reaches a different stream from the charge", `${CC} ${e.date} -189.00; ${C2} ${f.date} +189.00`, "Lowers SHOPPING spending. Not income, and not a transfer between the cards.",
    { kind: "lines", lines: [plain(e, "spending", { n: 1 }), plain(f, "spending")] });
  const auth = card(r, "2024-09-24", ["WISHPAW MARKET", "US"], 12240, "SHOPPING", { posted: "2024-10-02", desc: "WISHPAW MARKET US USD 78.00", csv: `${"WISHPAW MARKET".padEnd(26)}US  USD 78.00`, extra: { authCents: 12118, authFile: "2024-07-01" } });
  trap("T5-FX-REPRICE", "A foreign charge whose AUD changes between authorisation and posting", `${CC} ${auth.date}: the download cut 09-30 shows 121.18 pending; the next, which overlaps, shows 122.40 posted 10-02`, "One charge of 122.40.",
    { kind: "lines", lines: [plain(auth, "spending", { n: 1 })], absent: [{ account: CC, date: auth.date, cents: -12118 }] });
  const xm = card(r, "2024-12-23", ["LITTLE SPROUTS KIDS", "NORTH ROCKHAMPTON"], 27450, "SHOPPING", { lag: 5 }), xn = card(r, "2025-12-22", ["KALKA HOMEWARES", "NORTH ROCKHAMPTON"], 16820, "SHOPPING", { lag: 5 });
  trap("T5-HOLIDAY-LAG", "A charge that posts five business days later across Christmas and New Year", `${CC}: ${xm.date} posted ${xm.posted}, ${xn.date} posted ${xn.posted}`, "One purchase, in the month charged.",
    { kind: "lines", lines: [plain(xm, "spending", { n: 1, month: "2024-12" }), plain(xn, "spending", { n: 1, month: "2025-12" })] });
}

// ---------- traps that live in how the files were downloaded ----------
const JT_WINDOWS = [], STATEMENT_MISSING = "2025-08-14";
function quarters(a, b) { const out = []; const ms = monthRange(a, b); for (let i = 0; i < ms.length; i += 3) out.push([`${ms[i]}-01`, monthEnd(ms[i + 2])]); return out; }
function windows() { for (const [from, to] of quarters("2023-07", "2026-06")) JT_WINDOWS.push(from === "2024-10-01" ? ["2024-09-10", to] : [from, to]); }
function fileTraps() {
  const over = B.lines.filter((x) => x.acct === JT && x.date >= "2024-09-10" && x.date <= "2024-09-30").sort(byTime);
  const uniq = over.filter((x) => !over.some((y) => y !== x && y.date === x.date && y.cents === x.cents));
  trap("T5-OFX-OVERLAP", "Two overlapping OFX downloads whose FITIDs are renumbered in each file", `${JT}: the file from 2024-09-10 overlaps the September quarter by ${over.length} lines, the same line under a different FITID in each`, "One line each, and the bills account follows.",
    { kind: "lines", lines: uniq.slice(0, 6).map((x) => plain(x, x.lens || "neither", { n: 1 })), balances: [{ account: JT, months: ["2024-09", "2024-10"] }] });
  const hole = B.lines.filter((x) => x.acct === EV && x.date >= TRUNC_FROM && x.date <= TRUNC_TO);
  trap("T5-TRUNCATED", "A download cut short, on an account with a running balance", `${EV}: the March quarter's file stops at 2024-03-10. ${hole.length} lines worth ${money(hole.reduce((t, x) => t + x.cents, 0))} are in no file, and the next file's brought-forward balance is honest`, "The engine cannot know the lines. It must say the balance does not chain, for that account and that month.",
    { kind: "hole", account: EV, month: "2024-03", net_cents: hole.reduce((t, x) => t + x.cents, 0), line_count: hole.length, match: /2024-0[34]/.source });
  const lagged = B.lines.filter((x) => x.acct === CC && x.cents < 0 && x.posted && x.posted !== x.date), lagDays = {};
  for (const x of lagged) { const d = dayDiff(x.date, x.posted); lagDays[d] = (lagDays[d] || 0) + 1; }
  trap("T5-POSTING-LAG", "Every card line in two files, dated differently", `${CC}: ${lagged.length} lines post after they are charged, by ${Object.entries(lagDays).map(([d, n]) => `${d} days (${n})`).join(", ")}. The monthly statement, cut on the 14th, shows the charge date; the quarterly activity file the posting date`, "One purchase, two witnesses, whatever the gap. A line the engine cannot match across files is asked about, not counted twice in silence.",
    { kind: "card_lag", account: CC, lagged: lagged.length, by_days: lagDays });
  const cross = B.lines.filter((x) => x.acct === CC && x.lens === "spending" && x.date >= START && x.cents < 0 && x.posted && ymOf(x.posted) !== ymOf(x.date)).sort(byTime);
  trap("T5-DATE-BASIS", "A card charge dated in one month, posted in the next", `${CC}: ${cross.length} lines. Budgets read the charge date. Six sampled`, "SPEC 6.5: a purchase counts when charged, and it is one line.",
    { kind: "lines", lines: [0, 1, 2, 3, 4, 5].map((i) => { let j = Math.floor(i * cross.length / 6); while (posted(cross[j]) >= "2025-07-15" && posted(cross[j]) <= STATEMENT_MISSING) j += 1; return cross[j]; }).map((x) => plain(x, "spending", { n: 1, month: ymOf(x.date) })) });
  trap("T5-STATEMENT-GAP", "A card statement never downloaded", `The statement closing ${STATEMENT_MISSING} is missing`, "The lines stay, on their posting dates. Coverage names the missing statement.",
    { kind: "gap", stream: "STM-CARD", month: STATEMENT_MISSING.slice(0, 7) });
}

// ---------- the cards ----------
const CARD = { statements: [] };
function settleCard() {
  let prev = -OPEN[CC], carried = false, moved = null;
  for (let start = "2023-06-15"; start <= "2026-06-15";) {
    const ym = nextMonth(start.slice(0, 7)), end = `${ym}-14`;
    if (carried) { const i = Math.round(prev * 0.1999 / 12); line(CC, end, "PURCHASE INTEREST CHARGED", -i, { posted: end, csv: "PURCHASE INTEREST CHARGED", member: LUKA, lens: "spending", cat: "FEES" }); }
    const inP = B.lines.filter((x) => x.acct === CC && posted(x) >= start && posted(x) <= end);
    const charges = inP.filter((x) => x.cents < 0).reduce((t, x) => t - x.cents, 0), credits = inP.filter((x) => x.cents > 0).reduce((t, x) => t + x.cents, 0), close = prev + charges - credits;
    CARD.statements.push({ start, end, prev, charges, credits, close, lines: inP.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.seq - b.seq)) });
    const due = nextBiz(addDays(end, 16)), post = bizAfter(due, 1), tight = end >= "2024-12-14" && end <= "2025-03-14", pay = tight ? Math.min(close, 80000) : close;
    if (due <= END && pay > 0) own(EV, due, `AMEWX DIRECT DEBIT ${NUM.card}`, CC, post, "PAYMENT RECEIVED - THANK YOU", pay, { posted: post, csv: "PAYMENT RECEIVED - THANK YOU", member: LUKA });
    carried = pay < close;
    if (end === "2025-03-14") {
      // the balance carried over the slow patch goes to a new card at nought per cent, less a fee, with no bank line on either side
      const x = Math.floor((close - pay) / 10000) * 10000, t = own(C2, BT_DAY, `BALANCE TRANSFER AMEWX ${NUM.card}`, CC, BT_DAY, `BALANCE TRANSFER FROM SOUTHERN ${NUM.card2}`, x, { posted: BT_DAY, csv: `BALANCE TRANSFER FROM SOUTHERN ${NUM.card2}`, member: LUKA }), fee = spend(C2, BT_DAY, "BALANCE TRANSFER FEE 1.5 PCT", Math.round(x * 0.015), "FEES");
      moved = { t, fee, x }; carried = false;
    }
    prev = close; start = addDays(end, 1);
  }
  const { t, fee, x } = moved;
  trap("T5-BALANCE-TRANSFER", "A card balance moved to a new card at nought per cent, with no bank line on either side", `${C2} ${BT_DAY}: -${money(x)}, "${t[0].desc}", and a ${money(-fee.cents)} fee. ${CC} the same day: +${money(x)}. Neither card's line is a purchase or a payment from a bank`, "Own debt moving: neither, both sides, and the fee is spending. Read as a purchase and a card payment, spending is high by the whole balance, all of it already counted when charged.",
    { kind: "lines", lines: [plain(t[0], "neither"), plain(t[1], "neither"), plain(fee, "spending")], balances: [{ account: C2, months: ["2025-03", "2025-04"] }] }, { fresh: true, dc: true });
}
function settleCard2() {
  for (const ym of monthRange("2025-04", "2026-06")) {
    const d = nextBiz(`${ym}-24`), bal = -B.lines.filter((x) => x.acct === C2 && x.date <= d).reduce((t, x) => t + x.cents, 0), c = Math.min(bal, 90000);
    if (c > 0) own(EV, d, `SOUTHERN CARD PAYMENT ${NUM.card2}`, C2, d, "PAYMENT RECEIVED - THANK YOU", c);
  }
}
/* she watches the bills account and her own: each Monday they are topped up from the offset, and when hers runs high she puts some away. */
function sweeps() {
  const lowOf = (acct, d) => { let bal = OPEN[acct], low = Infinity, now = OPEN[acct]; for (const x of B.lines.filter((l) => l.acct === acct).sort(byTime)) { bal += x.cents; if (x.date < d) now = bal; if (x.date >= d && x.date <= addDays(d, 8)) low = Math.min(low, bal); } return Math.min(low, now); };
  for (let d = "2023-07-03"; d <= END; d = addDays(d, 7)) {
    if (d === "2024-10-07") continue;  // nobody watches it that week, and the ute's debit bounces
    { const low = lowOf(JT, d); if (low < 60000) { const c = Math.ceil((160000 - low) / 10000) * 10000; own(EV, d, "OSKO TO L AND M NOVAK BILLS", JT, d, "OSKO FROM L NOVAK BILLS", c); } }
    { const low = lowOf(MA, d); if (low < 30000) { const c = Math.ceil((80000 - low) / 10000) * 10000; own(EV, d, "OSKO TO M BAUTISTA", MA, d, "OSKO FROM L NOVAK", c); } else if (low > 700000) { const c = Math.floor((low - 300000) / 10000) * 10000; own(MA, d, "OSKO TO L NOVAK SAVINGS", EV, d, "OSKO FROM M BAUTISTA SAVINGS", c); } }
  }
}
function interestCredits() {
  let bal = OPEN[TS];
  for (const ym of MONTHS) { bal += B.lines.filter((x) => x.acct === TS && ymOf(x.date) === ym).reduce((t, x) => t + x.cents, 0); const i = Math.round(bal * 0.04 / 12); if (i > 0) { earn(TS, monthEnd(ym), "INTEREST CREDIT", i, "INTEREST"); bal += i; count("interest_credit"); } }
}

// ---------- truth, from the simulation alone ----------
const OPEN = { [EV]: 9200000, [JT]: 320000, [MA]: 410000, [TS]: 1850000, [BZ]: 1140000, [CC]: -240000, [C2]: 0, [HL]: -HOME_OPEN, [UL]: -5480000, [DL]: 0, [ML]: 0, [SL]: 21400000, [SM]: 9600000 };
const UTE_VALUE = 5200000, BOAT_VALUE = 1800000, CAR_VALUE = 2100000;
function chain(acct) { let bal = OPEN[acct] || 0; return B.lines.filter((x) => x.acct === acct).sort(acct === CC ? byPost : byTime).map((x) => { bal += x.cents; x.balance = bal; return x; }); }
function truthBalances() {
  const acctsChain = [EV, JT, MA, TS, BZ, CC, C2, HL, UL, DL, ML, SL, SM];
  const chains = {}; for (const a of acctsChain) chains[a] = chain(a);
  const assets = [...acctsChain, HO, UT, BT, CR];
  const balances = {}; for (const a of assets) balances[a] = {};
  for (const m of MONTHS) {
    const e = monthEnd(m);
    for (const a of acctsChain) { const upTo = chains[a].filter((x) => (a === CC ? posted(x) : x.date) <= e), last = upTo[upTo.length - 1]; balances[a][m] = last ? last.balance : OPEN[a] || 0; }
    balances[HO][m] = lastVal(VALUES.home, e); balances[UT][m] = UTE_VALUE; balances[CR][m] = CAR_VALUE; balances[BT][m] = e < BOAT_SOLD ? BOAT_VALUE : 0;
  }
  return { balances, chains, assets };
}
function truth(t) {
  const { balances, chains, assets } = t;
  const income = {}, spending = {}, byCat = {}, networth = {}, transit = {};
  for (const m of MONTHS) { income[m] = 0; spending[m] = 0; byCat[m] = {}; }
  for (const x of B.lines) {
    const m = ymOf(x.date); if (!(m in income) || !x.lens) continue;
    if (!CASH.includes(x.acct)) throw new Error(`lens on a non-cash account ${x.acct}`);
    if (x.lens === "income") income[m] += x.cents; else { spending[m] -= x.cents; byCat[m][x.cat] = (byCat[m][x.cat] || 0) - x.cents; }
  }
  for (const m of MONTHS) {
    const e = monthEnd(m);
    transit[m] = B.transit.filter((x) => x.from <= e && x.until > e).reduce((s, x) => s + x.cents, 0);
    networth[m] = assets.reduce((s, a) => s + balances[a][m], 0) + transit[m];
  }
  return {
    household: "Novak-Bautista, fictional, Rockhampton QLD", window: [START, END],
    definitions: {
      income: "SPEC 6.5 cash lens: money into reporting-group cash accounts in categories of kind income with cash_lens true, on the day the bank shows it. Wages at the net banked, dividends from the company, the sole trader's takings at what was paid, parental leave pay, an income protection benefit, rent from Iloilo, interest. A customer refunded is a negative in income.",
      spending: "SPEC 6.5 cash lens: money out of cash accounts in expense categories with cash_lens true, net of refunds, Medicare and what the company pays back on the ute. Card purchases on the charge date. Loan repayments and the balloon at their cash amount. A sole trader's costs while the business was his own. An ATM withdrawal when it is withdrawn.",
      left_out: "Own transfers, card payments, drawings, a balance transfer, tax refunds and payments, BAS and PAYG instalments, a personal super contribution, the loans to and from the company and to and from Milan, the boat sale, and everything of the company's that crosses the household's rails: its materials on his card and the lump that pays them back, its customers' money, its BAS refund, an employer's uniform claim. The duplicate pay credit and its recall.",
      balances: "Month-end, holder's sign, on the posting date. The home at its latest estimate, the ute, boat and car at the value typed in setup, the boat leaving on the day it goes. The loan to the company at what the company owes the household, whether or not any file states it.",
      networth: "Sum of the accounts the household declared. The company is a stranger: nothing of its own is counted, and no value is held for his shares, because no one has one. Plus money in the air between own accounts. Tax position excluded.",
      one_charge: "A charge in two files is one charge. The statement's amount is the charge where the two disagree, because the statement closes on it.",
    },
    balances, income, spending, spending_by_category: byCat, networth, in_transit: transit,
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
  westpaw: { name: "Westpaw", tagline: "Banking with a wag", color: "#B4231F" },
  pawroll: { name: "Pawroll", tagline: "Payroll with claws", color: "#6A3FA0" },
  myguv: { name: "myGuv", tagline: "Your tax, your paws", color: "#0B6E99" },
  purrsure: { name: "Purrsure", tagline: "Cover for the curious", color: "#C2410C" },
  council: { name: COUNCIL, tagline: "Rates and charges, one paw at a time", color: "#2E7D6B" },
  water: { name: "Keppel Reach Water" },
  hest: { name: "HESTAbby" },
  accountant: { name: "Capricorn Tax Services" },
  guvbas: { name: "myGuv" },
  company: { name: CO },
};
const span = (a, b) => `${fmtDate(a)} to ${fmtDate(b)}`;
const R = (label, w = 2) => ({ label, w, align: "right" });
const Lft = (label, w = 2) => ({ label, w });

function pdfPayslip(s, ytd) {
  const d = new Doc({ brand: BR_.pawroll, title: "Payslip", kicker: fmtDate(s.payDate), deflate });
  d.h1(`Payslip for ${s.name}`);
  d.kv([["Employer", s.employer], ["Pay date", fmtDate(s.payDate)], ["Pay period", span(s.from, s.to)]], 3);
  d.h2("This pay");
  d.para(s.employer === CO ? "Classification: director, as work allows." : "Classification: casual, fortnightly in arrears.");
  d.para("All amounts are in Australian dollars.");
  const pct = sgRate(s.payDate);
  d.table([Lft("Item", 6), R("This pay"), R("Year to date")], [
    ["Ordinary hours, salary", money(s.gross), money(ytd.gross)],
    ["PAYG withholding", `-${money(s.tax)}`, `-${money(ytd.tax)}`],
    [`Superannuation guarantee (${pct}%)`, money(s.super), money(ytd.super)],
    [s.split ? "Net pay, to account ending 1520 and 0877" : `Net pay, to account ending ${s.bank === EV ? NUM.offsetLast : "1520"}`, money(s.net), ""],
  ]);
  return d.finish();
}
function pdfIncomeStatement(name, employer, fy, ss) {
  const sum = (k) => ss.reduce((t, s) => t + s[k], 0);
  const d = new Doc({ brand: BR_.pawroll, title: `Income statement FY${fy}`, kicker: `FY${fy}, 01 Jul ${fy - 1} to 30 Jun ${fy}`, deflate });
  d.h1(`Income statement for ${name}`);
  d.kv([["Employee", name], ["Payer", employer], ["Issued", fmtDate(`${fy}-07-14`)], ["Status", "Tax ready"], ["Payer ABN", { [CO]: "51824771203", [DENTAL]: "30918770445" }[employer]], ["Pay frequency", "Fortnightly"]], 3);
  d.h2("Year to 30 June");
  d.table([Lft("Item", 6), R("Amount")], [["Gross payments", money(sum("gross"))], ["Tax withheld", money(sum("tax"))], ["Superannuation guarantee", money(sum("super"))], ["Reportable employer super", "0.00"]]);
  d.h2("Pay by pay");
  d.table([Lft("Pay date", 3), R("Gross"), R("Tax"), R("Super"), R("Net")], ss.map((s) => [fmtDate(s.payDate), money(s.gross), money(s.tax), money(s.super), money(s.net)]), { foot: ["Total", money(sum("gross")), money(sum("tax")), money(sum("super")), money(sum("net"))] });
  return d.finish();
}
function pdfLoan(brand, title, number, product, holder, from, to, rows) {
  const t = (k) => rows.reduce((a, r) => a + r[k], 0), withOffset = rows.some((r) => r.offset != null);
  const d = new Doc({ brand, title, kicker: span(from, to), deflate });
  d.h1(title);
  d.kv([["Loan number", number], ["Product", product], ["Borrowers", holder], ["Repayments", "Fortnightly"], ["Opening balance", money(-rows[0].open)], ["Interest charged", money(t("interest"))], ["Repayments received", money(t("paid"))], ["Closing balance", money(-rows[rows.length - 1].close)]], 4);
  d.h2("Month by month");
  d.table([Lft("Month", 2), R("Rate", 1), R("Opening"), R("Interest"), R("Repayments"), R("Closing"), ...(withOffset ? [R("Offset")] : [])],
    rows.map((r) => [`${MON[Number(r.ym.slice(5)) - 1]} ${r.ym.slice(0, 4)}`, `${r.rate}%`, money(-r.open), money(r.interest), money(r.paid), money(-r.close), ...(withOffset ? [money(r.offset)] : [])]),
    { foot: ["Total", "", "", money(t("interest")), money(t("paid")), "", ...(withOffset ? [""] : [])] });
  return d.finish();
}
function pdfRateNotice(oldR, newR, effective, issued) {
  const d = new Doc({ brand: BR_.westpaw, title: "Rate change", kicker: `Issued ${fmtDate(issued)}`, deflate });
  d.h1("Your interest rate is changing");
  d.kv([["Loan number", NUM.home], ["Product", "Variable with offset"], ["Account holders", "L Novak"], ["Old rate", `${oldR}% p.a.`], ["New rate", `${newR}% p.a.`], ["Effective date", fmtDate(effective)]], 3);
  d.para("Your minimum repayment does not change unless you ask us to change it.");
  return d.finish();
}
function pdfCard(s) {
  const d = new Doc({ brand: BR_.amewx, title: "Card statement", kicker: span(s.start, s.end), deflate });
  d.h1("Your card statement");
  d.kv([["Account", cardFull()], ["Card member", LUKA], ["Previous balance", money(s.prev)], ["Payments and credits", money(s.credits)], ["New charges", money(s.charges)], ["New balance", money(s.close)]], 3);
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
  d.kv([["Member", MARI], ["Member number", NUM.superM], ["Statement period", span(from, to)], ["Balance then", money(openBal)], ["Balance now", money(closeBal)], ["Option", "Balanced growth"]], 3);
  d.h2("What moved");
  d.table([Lft("Item", 6), R("Amount")], [["Opening balance", money(openBal)], ["Employer contributions", money(sum("employer"))], ["Investment earnings", money(sum("earnings"))], ["Contributions tax", money(-sum("contributions_tax"))], ["Administration fees", money(-sum("fee"))], ["Insurance premiums", money(-sum("insurance"))], ["Closing balance", money(closeBal)]]);
  return d.finish();
}
function pdfNoa(n) {
  const d = new Doc({ brand: BR_.myguv, title: "Notice of assessment", deflate });
  d.h1(n.version > 1 ? "Notice of amended assessment" : "Notice of assessment");
  const rows = [["Name", n.person, "Taxable income", money(n.ti)], ["Financial year", `FY${n.fy}`, "Gross tax", money(n.gross)], ["Date of issue", fmtDate(n.assessed), "Less offsets", money(0)], ["Return lodged", fmtDate(n.lodged), "Medicare levy", money(n.medicare)], ["Version", String(n.version), "HELP repayment", money(n.help)], ["Assessment", `AN-${n.fy}-66204${n.person === LUKA ? "18" : "19"}`, "PAYG credits", money(n.payg)], ["", "", "Other credits", money(n.other)], ["", "", "Result of this notice", money(n.result)]];
  for (const r of rows) { d.text(MARGIN, d.y, r[0], { size: 9.5 }); d.text(MARGIN + 110, d.y, r[1], { size: 9.5, bold: true }); d.text(320, d.y, r[2], { size: 9.5 }); d.text(d.W - MARGIN, d.y, r[3], { size: 9.5, bold: true, align: "right" }); d.y -= 18; }
  d.para("A refund is paid to the account you nominated in your return.");
  return d.finish();
}
function pdfWater(b) {
  const d = new Doc({ brand: BR_.water, style: "plain", title: "Water bill", deflate });
  d.text(MARGIN, d.y, "Your water bill", { size: 14, bold: true }); d.text(d.W - MARGIN, d.y, `Quarter to ${fmtDate(b.to)}`, { size: 9, align: "right" }); d.y -= 26;
  const rows = [["Account", "KR-60331907", "Water usage", money(b.usage)], ["Property", "Norman Gardens", "Service charges", money(b.service)], ["Bill date", fmtDate(b.billDate), "Concession", money(0)], ["Due date", fmtDate(b.due), "Amount due", money(b.amt)], ["Period from", fmtDate(b.from), "", ""], ["Period to", fmtDate(b.to), "", ""]];
  for (const r of rows) { d.text(MARGIN, d.y, r[0], { size: 9.5 }); d.text(MARGIN + 110, d.y, r[1], { size: 9.5, bold: true }); if (r[2]) { d.text(320, d.y, r[2], { size: 9.5 }); d.text(d.W - MARGIN, d.y, r[3], { size: 9.5, bold: true, align: "right" }); } d.y -= 18; }
  d.para("Thank you for paying on time.");
  d.text(MARGIN, d.y, "Pay by", { size: 9.5 }); d.text(MARGIN + 110, d.y, "BPAY biller 60331", { size: 9.5 });
  return d.finish();
}
function pdfRates(b) {
  const d = new Doc({ brand: BR_.council, title: "Rates", kicker: "Notice under the Local Government Act", deflate });
  d.h1("Your rates instalment");
  d.kv([["Assessment number", "CC-6641470"], ["Property", HOME.split(",")[0]], ["Issue date", fmtDate(b.billDate)], ["Due date", fmtDate(b.due)], ["Rating period", span(b.from, b.to)], ["Instalment due", money(b.amt)]], 3);
  d.para(`Instalment notice ${b.reference}`);
  return d.finish();
}
function pdfPolicy(p) {
  const d = new Doc({ brand: BR_.purrsure, title: "Certificate", kicker: `${p.kind} cover`, deflate });
  d.h1("Certificate of currency");
  d.kv([["Policy number", p.number], ["Policy", p.kind], ["Situation", p.situ], ["Insured", LUKA], ["Period of insurance", span(p.from, p.to)], ["Premium paid", money(p.amt)]], 3);
  d.h2("Cover");
  d.table([Lft("Item", 6), R("Amount")], [[p.label, money(p.sum)], ["Excess", money(p.excess)]]);
  return d.finish();
}
function emlEnergy(b) {
  const text = ["Your electricity bill is ready", "Tropicline Power, a fictional retailer", "Hello Luka,", `Account: ${b.account}`, `Bill date: ${fmtDate(b.billDate)}`, `Due date: ${fmtDate(b.due)}`, `Supply from: ${fmtDate(b.from)}`, `Supply to: ${fmtDate(b.to)}`, `GST included: ${money(b.gst)}`, `Amount due: ${money(b.amt)}`, "Pay by BPAY, biller code 5512.", "Thanks for keeping the lights on."].join("\n");
  return eml({ from: "bills@tropicline.example", to: "luka@novak-bautista.example", subject: "Your electricity bill is ready", date: b.billDate, id: `tl-${b.billDate}`, text, html: `<p>${text.split("\n").join("</p><p>")}</p>` });
}
function emlRate(oldR, newR, effective, issued) {
  const text = ["Your interest rate is changing", "Westpaw, banking with a wag", "Hello Luka,", `Loan number: ${NUM.home}`, `Old rate: ${oldR}%`, `New rate: ${newR}%`, `Effective date: ${fmtDate(effective)}`, `Notice date: ${fmtDate(issued)}`, "Your minimum repayment does not change unless you ask us to change it."].join("\n");
  return eml({ from: "notices@westpaw.example", to: "luka@novak-bautista.example", subject: "Your interest rate is changing", date: issued, id: `wp-${issued}`, text, html: `<p>${text.split("\n").join("</p><p>")}</p>` });
}
function htmlKitten(s) {
  const from = `${s.ym}-01`, to = monthEnd(s.ym), body = `<h1>Statement of account</h1>\n<p>Provider: Kittenhood OSHC Norman Gardens</p>\n<p>Child: ${s.child}</p>\n<table>${row(["Item", "Detail"], "th")}${row(["Period start", fmtDate(from)])}${row(["Period end", fmtDate(to)])}${row(["Days attended", String(s.days)])}${row(["Gross fee", money(s.gross)])}${row(["Child Care Subsidy", `-${money(s.subsidy)}`])}${row(["Gap you pay", money(s.gap)])}</table>`;
  return page(`Kittenhood statement ${MON[Number(s.ym.slice(5)) - 1]} ${s.ym.slice(0, 4)}`, body);
}

function render() {
  const view = (acct, from, to) => { let bal = OPEN[acct] || 0; const seq = B.lines.filter((x) => x.acct === acct).slice().sort(byTime), out = []; for (const x of seq) { bal += x.cents; if (x.date >= from && x.date <= to) out.push({ ...x, balance: bal }); } return out; };
  const before = (acct, d) => (OPEN[acct] || 0) + B.lines.filter((x) => x.acct === acct && x.date < d).reduce((t, x) => t + x.cents, 0);
  const bark = (x) => [dmy(x.date), `${x.cents >= 0 ? "+" : "-"}${fix(Math.abs(x.cents))}`, x.desc, fix(x.balance)];
  const w5 = (x) => [dmy(x.date), x.desc, x.cents > 0 ? fix(x.cents) : "", x.cents < 0 ? fix(x.cents) : "", fix(x.balance)], head5 = ["Date", "Description", "Credit", "Debit", "Balance"];
  const bf5 = (from, bal) => [dmy(from), "BALANCE BROUGHT FORWARD", "0.00", "", fix(bal)];
  const hbHead = ["Bank Account", "Date", "Narrative", "Debit Amount", "Credit Amount", "Balance", "Categories", "Serial"];
  // the offset: the five-column CSV with a brought-forward row, quarterly, one file stopping three weeks short
  for (const [from, to] of quarters("2023-07", "2026-06")) { const end = from === "2024-01-01" ? addDays(TRUNC_FROM, -1) : to; put(EV, addDays(to, 2), `Westpaw_offset_${from}.csv`, csvLines([head5, bf5(from, before(EV, from)), ...view(EV, from, end).map(w5)])); }
  // the bills account: Wattle's OFX, with one overlap, FITIDs numbered within each file
  for (const [from, to] of JT_WINDOWS) put(JT, addDays(to, 2), `Wattle_bills_${from}.ofx`, ofx({ account: NUM.joint, bankId: "633000", from, to, rows: view(JT, from, to).map((x) => ({ date: x.date, cents: x.cents, desc: x.desc })), closing: before(JT, addDays(to, 1)), asOf: to }));
  // her account: Bark's QIF, no number and no running balance
  for (const [from, to] of quarters("2023-07", "2026-06")) put(MA, addDays(to, 2), `bark_${from}.qif`, qif({ rows: view(MA, from, to).map((x) => ({ date: x.date, cents: x.cents, desc: x.desc })), opening: before(MA, from), from }));
  // the tax saver: Bark's headerless CSV, newest first
  for (const [from, to] of quarters("2023-07", "2026-06")) put(TS, addDays(to, 2), `bark_taxsaver_${from}.csv`, csvLines(view(TS, from, to).reverse().map(bark)));
  // the trading account: Harbour's CSV, quarterly, until it closes
  for (const [from, to] of quarters("2023-07", "2024-09")) put(BZ, addDays(to, 2), `Harbour_${from}_${to}.csv`, csvLines([hbHead, ...view(BZ, from, to).map((x) => [NUM.biz, dmy(x.date), x.desc, x.cents < 0 ? fix(-x.cents) : "", x.cents > 0 ? fix(x.cents) : "", fix(x.balance), x.cents > 0 ? "DEP" : "PAYMENT", ""])]));
  // the stray: the company's own account, one quarter, in the same folder
  put(BZ, "2025-04-03", "Harbour_2025-01-01_2025-03-31.csv", csvLines([hbHead, ...STRAY.lines.map((x) => [NUM.co, dmy(x.date), x.desc, x.cents < 0 ? fix(-x.cents) : "", x.cents > 0 ? fix(x.cents) : "", fix(x.balance), x.cents > 0 ? "DEP" : "PAYMENT", ""])]));
  // the card: a monthly statement dated by the charge, a quarterly activity download dated by the post
  chain(CC);
  const cc = B.lines.filter((x) => x.acct === CC).sort(byPost);
  for (const s of CARD.statements) { if (s.end === STATEMENT_MISSING) continue; put("STM-CARD", addDays(s.end, 2), `Amewx_statement_${s.end}.pdf`, pdfCard(s), { issued_on: s.end }); }
  for (const [from, to, day] of quarters("2023-07", "2026-06").map(([f, t], i) => (i === 0 ? ["2023-06-15", t, addDays(t, 3)] : f === "2024-10-01" ? ["2024-09-25", t, addDays(t, 3)] : [f, t === END ? "2026-07-10" : t, addDays(t, 3)]))) {
    const rows = cc.filter((x) => posted(x) >= from && posted(x) <= to).map((x) => ({ d: posted(x), desc: x.csv || x.desc, m: LUKA, c: x.cents, n: NUM.card }));
    { const a = cc.find((x) => x.authFile === from); if (a) rows.push({ d: a.date, desc: a.csv, m: LUKA, c: -a.authCents, n: NUM.card }); }
    rows.sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0));
    put(CC, day, `activity_${from}.csv`, csvLines([["Date", "Description", "Card Member", "Account #", "Amount"], ...rows.map((x) => [dmy(x.d), x.desc, x.m.toUpperCase(), `-${x.n}`, money(-x.c).replace(/,/g, "")])]));
  }
  // the new card: the activity file alone
  for (const [from, to] of [[BT_DAY, "2025-06-30"], ...quarters("2025-07", "2026-06")]) {
    const rows = B.lines.filter((x) => x.acct === C2 && x.date >= from && x.date <= to).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.seq - a.seq));
    put(C2, addDays(to, 3), `southern_activity_${from}.csv`, csvLines([["Date", "Description", "Card Member", "Account #", "Amount"], ...rows.map((x) => [dmy(x.date), x.desc, LUKA.toUpperCase(), `-${NUM.card2}`, money(-x.cents).replace(/,/g, "")])]));
  }
  // the home loan: Westpaw's half-yearly statement, rate notices by post and by email
  const half = [["2023-07", "2023-12"], ["2024-01", "2024-06"], ["2024-07", "2024-12"], ["2025-01", "2025-06"], ["2025-07", "2025-12"], ["2026-01", "2026-06"]];
  for (const [a, b] of half) { const from = `${a}-01`, to = monthEnd(b); put("STM-HOMELOAN", addDays(to, 3), `Westpaw_loan_${to}.pdf`, pdfLoan(BR_.westpaw, "Home loan statement", NUM.home, "Variable with offset", "L Novak, M Bautista", from, to, LOANS.home.filter((m) => m.ym >= a && m.ym <= b)), { issued_on: addDays(to, 1) }); }
  RATES.slice(1).forEach(([eff, r], i) => { const issued = addDays(eff, 3); if (i < 2) put("NOTICE-HOMELOAN", issued, `Westpaw_rate_${eff}.pdf`, pdfRateNotice(RATES[i][1], r, eff, issued), { issued_on: issued }); else put("NOTICE-HOMELOAN", issued, `Westpaw_rate_${eff}.eml`, emlRate(RATES[i][1], r, eff, issued), { issued_on: issued, origin: "email" }); });
  // the ute: PING's half-yearly statement and yearly download
  for (const [a, b, from, to] of [["2023-07", "2023-12", "2023-07-01", "2023-12-31"], ["2024-01", "2024-06", "2024-01-01", "2024-06-30"], ["2024-07", "2024-12", "2024-07-01", "2024-12-31"], ["2025-01", "2025-06", "2025-01-01", "2025-06-30"], ["2025-07", "2025-12", "2025-07-01", "2025-12-31"], ["2026-01", "2026-03", "2026-01-01", "2026-03-31"]]) put("STM-UTELOAN", addDays(to, 5), `PING_statement_${to}.pdf`, pdfLoan(BR_.ping, "Chattel mortgage statement", NUM.ute, "Chattel Mortgage", LUKA, from, to, LOANS.ute.filter((m) => m.ym >= a && m.ym <= b).map((m) => ({ ...m, offset: null }))), { issued_on: addDays(to, 1) });
  for (const [from, to, day] of [["2023-07-01", "2024-06-30", "2024-07-02"], ["2024-07-01", "2025-06-30", "2025-07-02"], ["2025-07-01", "2026-03-31", "2026-04-03"]]) { const rows = LOANS.uteLines.filter((x) => x.date >= from && x.date <= to).map((x) => [dmy(x.date), x.desc, fix(x.cents), fix(-x.balance)].join("\t")); put(UL, day, `ping_loan_${from}.tsv`, `Effective Date\tDetails\tAmount\tBalance Owing\r\n${rows.join("\r\n")}\r\n`); }
  // pay
  const ytd = {};
  for (const s of PAY.slips.slice().sort((a, b) => (a.payDate < b.payDate ? -1 : a.payDate > b.payDate ? 1 : 0))) {
    const k = `${s.person}|${s.employer}|${s.fy}`, y = (ytd[k] = ytd[k] || { gross: 0, tax: 0, super: 0 });
    y.gross += s.gross; y.tax += s.tax; y.super += s.super;
    if (s.noFile) continue;
    put(s.person === LUKA ? "PAY-LUKA" : "PAY-MARI", s.payDate, `Payslip_${s.employer.split(" ")[0]}_${s.person.split(" ")[0]}_${s.payDate}.pdf`, pdfPayslip(s, y), { issued_on: s.payDate });
  }
  for (const fy of [2024, 2025, 2026]) for (const [who, name, emp] of [[LUKA, LUKA, CO], [MARI, MARI, CO], [MARI, MARI_PAY, DENTAL]]) {
    const ss = PAY.slips.filter((s) => s.person === who && s.employer === emp && s.fy === fy); if (!ss.length) continue;
    put(who === LUKA ? "INC-LUKA" : "INC-MARI", `${fy}-07-14`, `IncomeStatement_FY${fy}_${emp.split(" ")[0]}_${who.split(" ")[0]}.pdf`, pdfIncomeStatement(name, emp, fy, ss), { issued_on: `${fy}-07-14` });
  }
  // super
  const sh = [["2023-07-01", "2023-12-31"], ["2024-01-01", "2024-06-30"], ["2024-07-01", "2024-12-31"], ["2025-01-01", "2025-06-30"], ["2025-07-01", "2025-12-31"], ["2026-01-01", "2026-06-30"]];
  const open = (list, from, base) => { const b = list.filter((x) => x.date < from); return b.length ? b[b.length - 1].balance : base; };
  const V2 = { employer: "CONTRIB-SG", contributions_tax: "TAX-15", fee: "FEE-ADMIN", earnings: "EARNINGS", personal: "CONTRIB-PERS" };
  for (const [from, to] of sh) { const ls = SUPER.luka.filter((x) => x.date >= from && x.date <= to); put(SL, addDays(to, 6), `purrannuation_${from}.csv`, csvLines([["Effective Date", "Category", "Narrative", "Amount (AUD)", "Running Balance", "Reference"], ...ls.map((x, i) => [x.date, V2[x.type], x.desc, fix(x.cents), fix(x.balance), `TXN${from.slice(2, 4)}${pad(i + 1, 4)}`])])); }
  const CODE = { employer: "SG", contributions_tax: "TAX", fee: "FEE", insurance: "INS", earnings: "EARN" };
  for (const [from, to] of sh) { const ls = SUPER.mari.filter((x) => x.date >= from && x.date <= to), opening = open(SUPER.mari, from, OPEN[SM]); put(SM, addDays(to, 5), `hestabby_${from}.json`, JSON.stringify({ schema: "hestabby.transactions.v2", member: { name: MARI, number: NUM.superM }, period: { from, to }, balance: { opening: Number(fix(opening)), closing: Number(fix(ls[ls.length - 1].balance)) }, transactions: ls.map((x) => ({ date: x.date, code: CODE[x.type], label: x.desc, amount: Number(fix(x.cents)), balanceAfter: Number(fix(x.balance)) })) }, null, 1)); }
  for (const fy of [2024, 2025, 2026]) { const from = `${fy - 1}-07-01`, to = `${fy}-06-30`, ls = SUPER.mari.filter((x) => x.date >= from && x.date <= to); put("STM-SUPER-M", `${fy}-07-20`, `Annual_statement_FY${fy}.pdf`, pdfFund(fy, ls, open(SUPER.mari, from, OPEN[SM]), ls[ls.length - 1].balance), { issued_on: `${fy}-07-20` }); }
  // tax
  for (const n of TAX.notices) put(n.person === LUKA ? "TAX-LUKA" : "TAX-MARI", n.assessed, `NOA_FY${n.fy}${n.version > 1 ? `_v${n.version}` : ""}.pdf`, pdfNoa(n), { issued_on: n.assessed });
  // the home's value, bills, cover and care
  put("VALUATIONS", "2026-07-01", "pawprice_estimates.csv", csvLines([["Subject", "As At", "Estimate", "Method", "Provider"], ...VALUES.home.map(([d, c]) => [HOME, dmy(d), fix(c), "estimate", "Pawprice"])]));
  for (const b of BILLS.energy) put("BILL-POWER", b.billDate, `bill_${b.billDate}.eml`, emlEnergy(b), { issued_on: b.billDate, origin: "email" });
  for (const b of BILLS.water) put("BILL-WATER", b.billDate, `water_${b.billDate}.pdf`, pdfWater(b), { issued_on: b.billDate });
  for (const b of BILLS.rates) put("BILL-RATES", b.billDate, `rates_${b.billDate}.pdf`, pdfRates(b), { issued_on: b.billDate });
  for (const p of BILLS.policy) put(p.kind === "Home" ? "POLICY-HOME" : "POLICY-MOTOR", p.paid, `certificate_${p.from}.pdf`, pdfPolicy(p), { issued_on: p.paid });
  for (const s of KIDS.statements) put("CHILDCARE", `${nextMonth(s.ym)}-02`, `kittenhood_${s.ym}.html`, htmlKitten(s));
  // families of files with no public recipe
  for (const [q, x] of Object.entries(TRADE.q).sort()) put("BAS-STATEMENTS", addDays(x.due, -14), `Activity_statement_${q}.pdf`, pdfBare(BR_.guvbas, "Activity statement", [`Period to ${fmtDate(monthEnd(q))}`, `Total sales: ${money(x.sales)}`, `GST on sales: ${money(Math.round(x.sales / 11))}`, `GST on purchases: ${money(Math.round(x.costs / 11))}`, `Net amount: ${money(x.gst)}`, "Fictional."]), { issued_on: addDays(x.due, -14) });
  for (const [d, c] of [["2025-06-20", 800000], ["2026-06-19", 1200000]]) put("CO-MINUTES", d, `Dividend_minute_${d}.pdf`, pdfBare(BR_.company, "Director's minute", [`Dividend declared ${fmtDate(d)}`, `Paid to ${LUKA}: ${money(c)}`, "Fully franked.", "Fictional."]), { issued_on: d });
  put("CO-MINUTES", "2025-10-05", "Dividend_minute_2025-10-03.pdf", pdfBare(BR_.company, "Director's minute", ["Dividend declared 03 Oct 2025", `Paid to ${LUKA}.`, "Fully franked.", "Fictional."]), { issued_on: "2025-10-03" });
  put("CO-FINANCIALS", "2025-10-01", "Financial_statements_FY2025.pdf", pdfBare(BR_.accountant, "Financial statements", [`${CO}, year to 30 June 2025`, "Loan from director shown as a current liability.", "Fictional."]), { issued_on: "2025-10-01" });
  put("ATO-PLAN", "2025-11-20", "Payment_plan_confirmation.pdf", pdfBare(BR_.myguv, "Payment plan confirmation", ["Six instalments of 1,240.00 from 05 Dec 2025.", "Fictional."]), { issued_on: "2025-11-20" });
}

// ---------- setup: what a person answers at onboarding, in July 2026 ----------
const ON = "2026-07-20T00:00:00Z";
/* The public default categories, as the earlier households listed them, with PASS-THROUGH, SUPER-PENSION and SELLING-COSTS. Four rows by the SPEC 12 rung, because a person would need them: a tradie's takings, government payments, an income protection benefit, rent from overseas. */
const CATS = `SALARY|Salary and wages|income|Income|1|1;SALARY-ALLOW|Allowances|income|Income|1|1;REIMBURSE|Employer reimbursements|income|Income|1|0;SUPER-EMPLOYER|Employer super|income|Super|0|1;SUPER-SACRIFICE|Salary sacrificed to super|income|Super|0|1;PAYROLL-DED|Post-tax payroll deductions|expense|Income|1|1;INTEREST|Interest earned|income|Income|1|1;DIVIDEND|Dividends and distributions|income|Income|1|1;TRUST-DIST|Trust distributions|income|Income|1|1;ESS-INCOME|Employee share scheme income|income|Income|0|1;CRYPTO-INCOME|Staking and crypto income|income|Income|0|1;SUPER-EARN|Super fund earnings|income|Super|0|1;SUPER-FEES|Super fund fees|expense|Super|0|1;SUPER-INS|Insurance inside super|expense|Super|0|1;SUPER-TAX|Contributions tax|expense|Super|0|1;GIFT-IN|Gifts and inheritances received|income|Income|1|0;RENT-INC|Rent received|income|Property|1|1;MORTGAGE|Home loan repayments|expense|Housing|1|0;HOME-INT|Home loan interest|expense|Housing|0|1;RATES-HOME|Council rates (home)|expense|Housing|1|1;HOME-INS|Home and contents insurance|expense|Housing|1|1;HOME-MAINT|Home maintenance|expense|Housing|1|1;GROCERIES|Groceries|expense|Essentials|1|1;UTILITIES|Energy and water|expense|Essentials|1|1;TELCO|Internet and mobile|expense|Essentials|1|1;TRANSPORT|Fuel and transport|expense|Essentials|1|1;CAR|Car costs|expense|Essentials|1|1;HEALTH|Health|expense|Essentials|1|1;CHILDCARE|Childcare|expense|Essentials|1|1;DINING|Dining and takeaway|expense|Lifestyle|1|1;SUBS|Subscriptions|expense|Lifestyle|1|1;SHOPPING|Shopping|expense|Lifestyle|1|1;KIDS-ACT|Kids activities|expense|Lifestyle|1|1;HOLIDAYS|Holidays and travel|expense|Lifestyle|1|1;GIFTS|Gifts|expense|Lifestyle|1|1;PERSONAL|Personal care|expense|Lifestyle|1|1;RENT-INT|Investment loan interest|expense|Property|1|1;RENT-MGMT|Property management fees|expense|Property|1|1;RENT-RATES|Rental rates and water|expense|Property|1|1;RENT-STRATA|Strata levies|expense|Property|1|1;RENT-INS|Landlord insurance|expense|Property|1|1;RENT-REPAIR|Rental repairs|expense|Property|1|1;RENT-OTHER|Other rental costs|expense|Property|1|1;WORK-EQUIP|Work equipment|expense|Work and giving|1|1;WORK-OTHER|Work registrations and courses|expense|Work and giving|1|1;DONATION|Donations|expense|Work and giving|1|1;FEES|Bank fees and card interest|expense|Fees|1|1;INCOME-TAX|Income tax assessed|expense|Tax|0|1;HELP-INDEX|HELP indexation|expense|Tax|0|1;TAX-REFUND|Tax refunds and payments|transfer|Tax|0|0;TRANSFER|Transfers between own accounts|transfer|Transfers|0|0;CC-PAY|Credit card payments|transfer|Transfers|0|0;UNCAT|Uncategorised|suspense|Uncategorised|1|1;PASS-THROUGH|Money that is someone else's|pass_through|Transfers|0|0;SUPER-PENSION|Super pension|income|Income|1|0;SELLING-COSTS|Selling costs|capital|Capital|0|0;x_TRADE|Electrical work takings|income|Income|1|1;x_GOV-PAY|Government payments|income|Income|1|1;x_IP-BENEFIT|Income protection benefits|income|Income|1|1;x_FOREIGN-RENT|Rent from overseas|income|Income|1|1`;
function setup() {
  const person = (id, name, birth) => ({ party_id: id, kind: "person", name, birth_date: birth });
  const org = (id, name, kind = "organisation") => ({ party_id: id, kind, name });
  const party = [person("PTY-LUKA", LUKA, "1981-02-14"), person("PTY-MARI", MARI, "1984-09-02"), person("PTY-MATEO", MATEO, "2011-05-20"), person("PTY-INES", INES, "2016-10-02"), person("PTY-THEO", THEO, BABY), person("PTY-MILAN", MILAN, "1978-11-06"), person("PTY-CORAZON", CORAZON, "1957-03-30"),
    org("PTY-CO", CO, "company"), org("PTY-DENTAL", DENTAL), org("PTY-COUNCIL", COUNCIL, "government"), org("PTY-WESTPAW", "Westpaw"), org("PTY-WATTLE", "Wattle Credit Union"), org("PTY-BARK", "Bark Bank"), org("PTY-HARBOUR", "Harbour Bank"), org("PTY-AMEWX", "Amewx"), org("PTY-SOUTHERN", "Southern Card"), org("PTY-PING", "PING"), org("PTY-PURRANNUATION", "Purrannuation"), org("PTY-HESTABBY", "HESTAbby"),
    org("PTY-TAX", "myGuv", "government"), org("PTY-PURRSURE", "Purrsure"), org("PTY-TROPICLINE", "Tropicline Power"), org("PTY-WATER", "Keppel Reach Water"), org("PTY-KITTEN", "Kittenhood OSHC Norman Gardens")];
  const membership = [["PTY-LUKA", "adult", "1981-02-14"], ["PTY-MARI", "adult", "2009-04-11"], ["PTY-MATEO", "dependant", "2011-05-20"], ["PTY-INES", "dependant", "2016-10-02"], ["PTY-THEO", "dependant", BABY]].map(([party_id, role, valid_from]) => ({ party_id, role, valid_from, recorded_at: ON }));
  const acct = (account_id, name, cls, type, group, inst, extra = {}) => ({ account_id, name, class: cls, type, reporting_group: group, currency: "AUD", ...(inst ? { institution_party_id: inst } : {}), in_scope: true, liquid: group === "cash", fidelity: "ledger", ...extra });
  const account = [
    acct(EV, "Offset, Westpaw", "asset", "offset", "cash", "PTY-WESTPAW"), acct(JT, "Bills, Wattle", "asset", "transaction", "cash", "PTY-WATTLE"), acct(MA, "Marisol's everyday, Bark", "asset", "transaction", "cash", "PTY-BARK"), acct(TS, "Tax saver, Bark", "asset", "savings", "cash", "PTY-BARK"), acct(BZ, "Trading account, Harbour", "asset", "transaction", "cash", "PTY-HARBOUR", { closed_on: BIZ_CLOSE }),
    acct(CC, "Amewx card", "liability", "credit_card", "cash", "PTY-AMEWX"), acct(C2, "Southern card", "liability", "credit_card", "cash", "PTY-SOUTHERN", { opened_on: BT_DAY }),
    acct(HL, "Home loan, Westpaw", "liability", "loan", "loans", "PTY-WESTPAW", { contract_id: "CON-HOME", liquid: false }), acct(UL, "Ute chattel mortgage, PING", "liability", "loan", "loans", "PTY-PING", { contract_id: "CON-UTE", closed_on: UTE_END, liquid: false }),
    acct(DL, "Loan to the company", "asset", "receivable", "loans", null, { contract_id: "CON-COLOAN", opened_on: BIZ_CLOSE, liquid: false }), acct(ML, "Loan from Milan", "liability", "loan", "loans", null, { contract_id: "CON-MILAN", opened_on: MILAN_DAY, liquid: false }),
    acct(SL, "Luka's super, Purrannuation", "asset", "super", "super", "PTY-PURRANNUATION", { contract_id: "CON-SUPER-L", liquid: false }), acct(SM, "Marisol's super, HESTAbby", "asset", "super", "super", "PTY-HESTABBY", { contract_id: "CON-SUPER-M", liquid: false }),
    acct(HO, "The home", "asset", "property", "property", null, { asset_id: "AST-HOME", fidelity: "snapshot", liquid: false }),
    acct(UT, "The ute", "asset", "vehicle", "vehicle", null, { asset_id: "AST-UTE", fidelity: "snapshot", liquid: false, opening_balance_cents: UTE_VALUE, opening_date: START, note: "What we think it is worth." }),
    acct(BT, "The boat", "asset", "vehicle", "vehicle", null, { asset_id: "AST-BOAT", fidelity: "snapshot", closed_on: BOAT_SOLD, liquid: false, opening_balance_cents: BOAT_VALUE, opening_date: START, note: "What we think it is worth." }),
    acct(CR, "The Kia", "asset", "vehicle", "vehicle", null, { asset_id: "AST-CAR", fidelity: "snapshot", liquid: false, opening_balance_cents: CAR_VALUE, opening_date: START, note: "What we think it is worth." }),
  ];
  const asset = [{ asset_id: "AST-HOME", kind: "property", name: HOME, account_id: HO, location: "Norman Gardens QLD", acquired_on: "2018-05-14" }, { asset_id: "AST-UTE", kind: "vehicle", name: "The ute", account_id: UT }, { asset_id: "AST-BOAT", kind: "vehicle", name: "The boat", account_id: BT, disposed_on: BOAT_SOLD }, { asset_id: "AST-CAR", kind: "vehicle", name: "The Kia", account_id: CR }];
  const al = (subject_type, subject_id, scheme, value, o = {}) => ({ subject_type, subject_id, scheme, value, valid_from: "2000-01-01", recorded_at: ON, ...o });
  const alias = [al("account", EV, "account_number", NUM.offsetLast), al("account", JT, "account_number", NUM.joint), al("account", MA, "account_number", "1520"), al("account", BZ, "account_number", NUM.biz), al("account", CC, "card_last4", NUM.card), al("account", C2, "card_last4", NUM.card2), al("account", SL, "member_number", NUM.superL), al("account", SM, "member_number", NUM.superM), al("account", HL, "loan_number", NUM.home), al("account", UL, "loan_number", NUM.ute),
    ...[["PTY-LUKA", LUKA], ["PTY-MARI", MARI], ["PTY-MATEO", MATEO], ["PTY-INES", INES], ["PTY-THEO", THEO], ["PTY-MILAN", MILAN], ["PTY-CORAZON", CORAZON], ["PTY-CO", CO], ["PTY-DENTAL", DENTAL], ["PTY-COUNCIL", COUNCIL], ["PTY-KITTEN", "Kittenhood OSHC Norman Gardens"]].map(([id, name]) => al("party", id, "name", name)),
    al("asset", "AST-HOME", "name", HOME), al("contract", "CON-HOME", "loan_number", NUM.home), al("contract", "CON-UTE", "loan_number", NUM.ute), al("contract", "CON-HOME-INS", "policy_number", NUM.policyHome), al("contract", "CON-MOTOR", "policy_number", NUM.policyMotor)];
  const own_ = (subject_type, subject_id, split, o = {}) => ["legal", "beneficial", "tax"].flatMap((basis) => split.map(([party_id, share_bps]) => ({ subject_type, subject_id, party_id, basis, share_bps, valid_from: "2000-01-01", recorded_at: ON, ...o })));
  const him = [["PTY-LUKA", 10000]], her = [["PTY-MARI", 10000]], both = [["PTY-LUKA", 5000], ["PTY-MARI", 5000]];
  const ownership = [...[EV, JT, HL, HO].flatMap((a) => own_("account", a, both)), ...[TS, BZ, CC, C2, UL, DL, ML, SL, UT, BT].flatMap((a) => own_("account", a, him)), ...[MA, SM, CR].flatMap((a) => own_("account", a, her)), ...own_("asset", "AST-HOME", both), ...own_("asset", "AST-UTE", him), ...own_("asset", "AST-BOAT", him), ...own_("asset", "AST-CAR", her)];
  const category = CATS.split(";").map((r) => { const [category_id, name, kind, group, c, e] = r.split("|"); return { category_id, name, kind, group, cash_lens: c === "1", economic_lens: e === "1" }; });
  const con = (contract_id, kind, name, counterparty_party_id, holder_party_id, extra = {}) => ({ contract_id, kind, name, counterparty_party_id, holder_party_id, ...extra });
  const contract = [
    con("CON-LUKA-CO", "employment", "Luka at the company", "PTY-CO", "PTY-LUKA", { category_id: "SALARY", started_on: INCORP }), con("CON-MARI-CO", "employment", "Marisol does the company's books", "PTY-CO", "PTY-MARI", { category_id: "SALARY", started_on: INCORP }), con("CON-DENTAL", "employment", "Marisol at the surgery", "PTY-DENTAL", "PTY-MARI", { category_id: "SALARY", started_on: "2017-02-06" }), con("CON-LIBRARY", "employment", "Weekends at the library", "PTY-COUNCIL", "PTY-MARI", { category_id: "SALARY", started_on: "2021-03-01", ended_on: "2024-12-20" }),
    con("CON-SUPER-L", "super_fund", "Luka's super", "PTY-PURRANNUATION", "PTY-LUKA", { account_id: SL }), con("CON-SUPER-M", "super_fund", "Marisol's super", "PTY-HESTABBY", "PTY-MARI", { account_id: SM }),
    con("CON-HOME", "loan", "Home loan", "PTY-WESTPAW", "PTY-LUKA", { account_id: HL, asset_id: "AST-HOME", category_id: "MORTGAGE", started_on: "2018-05-14" }), con("CON-UTE", "loan", "Ute chattel mortgage", "PTY-PING", "PTY-LUKA", { account_id: UL, asset_id: "AST-UTE", category_id: "CAR", started_on: "2021-03-08", ended_on: UTE_END }),
    con("CON-COLOAN", "loan", "Loan to the company", "PTY-CO", "PTY-LUKA", { account_id: DL, started_on: BIZ_CLOSE }), con("CON-MILAN", "loan", "Loan from Milan", "PTY-MILAN", "PTY-LUKA", { account_id: ML, started_on: MILAN_DAY }),
    con("CON-HOME-INS", "insurance", "Home insurance", "PTY-PURRSURE", "PTY-LUKA", { asset_id: "AST-HOME", category_id: "HOME-INS" }), con("CON-MOTOR", "insurance", "Kia insurance", "PTY-PURRSURE", "PTY-MARI", { asset_id: "AST-CAR", category_id: "CAR" }), con("CON-IP", "insurance", "Income protection", "PTY-PURRSURE", "PTY-LUKA", { category_id: "HEALTH" }),
    con("CON-POWER", "utility", "Electricity", "PTY-TROPICLINE", "PTY-LUKA", { category_id: "UTILITIES" }), con("CON-KIDS", "childcare", "Kittenhood OSHC", "PTY-KITTEN", "PTY-MARI", { category_id: "CHILDCARE", ended_on: "2025-06-30" }),
  ];
  const lk = (relation, from_type, from_id, to_type, to_id, extra = {}) => ({ relation, from_type, from_id, to_type, to_id, valid_from: "2000-01-01", recorded_at: ON, ...extra });
  const link = [lk("contributes_to", "contract", "CON-LUKA-CO", "contract", "CON-SUPER-L"), lk("contributes_to", "contract", "CON-MARI-CO", "contract", "CON-SUPER-M"), lk("contributes_to", "contract", "CON-DENTAL", "contract", "CON-SUPER-M"),
    lk("secures", "contract", "CON-HOME", "asset", "AST-HOME"), lk("funds_purpose", "contract", "CON-HOME", "asset", "AST-HOME", { share_bps: 10000 }), lk("offsets", "account", EV, "contract", "CON-HOME"), lk("paid_by", "contract", "CON-HOME", "account", EV),
    lk("secures", "contract", "CON-UTE", "asset", "AST-UTE", { valid_to: UTE_END }), lk("funds_purpose", "contract", "CON-UTE", "asset", "AST-UTE", { share_bps: 10000, valid_to: UTE_END }), lk("paid_by", "contract", "CON-UTE", "account", JT, { valid_to: UTE_END }),
    lk("charged_to", "account", CC, "account", EV), lk("charged_to", "account", C2, "account", EV, { valid_from: BT_DAY }), lk("covers", "contract", "CON-HOME-INS", "asset", "AST-HOME"), lk("covers", "contract", "CON-MOTOR", "asset", "AST-CAR")];
  const st = (stream_id, name, doc_kind, subject_type, subject_id, issuer_party_id, cadence, extra = {}) => ({ stream_id, name, doc_kind, subject_type, subject_id, issuer_party_id, cadence, valid_from: START, grace_days: 14, recorded_at: ON, ...extra });
  const stream = [
    st(EV, "Offset download", "txn_csv", "account", EV, "PTY-WESTPAW", "quarterly"), st(JT, "Bills download", "txn_ofx", "account", JT, "PTY-WATTLE", "quarterly"), st(MA, "Marisol's download", "txn_qif", "account", MA, "PTY-BARK", "quarterly"), st(TS, "Tax saver download", "txn_csv", "account", TS, "PTY-BARK", "quarterly"), st(BZ, "Trading account download", "txn_csv", "account", BZ, "PTY-HARBOUR", "quarterly", { valid_to: BIZ_CLOSE }),
    st(CC, "Amewx activity", "txn_csv", "account", CC, "PTY-AMEWX", "quarterly"), st("STM-CARD", "Amewx statement", "statement", "account", CC, "PTY-AMEWX", "monthly"), st(C2, "Southern activity", "txn_csv", "account", C2, "PTY-SOUTHERN", "quarterly", { valid_from: BT_DAY }),
    st("STM-HOMELOAN", "Westpaw statement", "loan_statement", "account", HL, "PTY-WESTPAW", "half_yearly"), st("NOTICE-HOMELOAN", "Rate notices", "rate_notice", "contract", "CON-HOME", "PTY-WESTPAW", "event"), st("STM-UTELOAN", "PING statement", "loan_statement", "account", UL, "PTY-PING", "half_yearly", { valid_to: UTE_END }), st(UL, "PING download", "txn_tsv", "account", UL, "PTY-PING", "yearly", { valid_to: UTE_END }),
    st(SL, "Luka's super transactions", "super_lines", "account", SL, "PTY-PURRANNUATION", "half_yearly"), st(SM, "Marisol's super transactions", "super_lines", "account", SM, "PTY-HESTABBY", "half_yearly"), st("STM-SUPER-M", "Marisol's super statement", "super_statement", "account", SM, "PTY-HESTABBY", "yearly"),
    st("PAY-LUKA", "Luka's payslips", "payslip", "party", "PTY-LUKA", "PTY-CO", "fortnightly", { valid_from: INCORP }), st("PAY-MARI", "Marisol's payslips", "payslip", "party", "PTY-MARI", "PTY-DENTAL", "fortnightly"), st("INC-LUKA", "Luka's income statements", "income_statement", "party", "PTY-LUKA", "PTY-CO", "yearly", { valid_from: INCORP }), st("INC-MARI", "Marisol's income statements", "income_statement", "party", "PTY-MARI", "PTY-DENTAL", "yearly"), st("TAX-LUKA", "Luka's notices", "tax_assessment", "party", "PTY-LUKA", "PTY-TAX", "yearly"), st("TAX-MARI", "Marisol's notices", "tax_assessment", "party", "PTY-MARI", "PTY-TAX", "yearly"),
    st("VALUATIONS", "Home estimates", "valuation", "asset", "AST-HOME", null, "quarterly"), st("BILL-POWER", "Electricity bills", "bill", "contract", "CON-POWER", "PTY-TROPICLINE", "quarterly"), st("BILL-WATER", "Water bills", "bill", "asset", "AST-HOME", "PTY-WATER", "quarterly"), st("BILL-RATES", "Rates notices", "bill", "asset", "AST-HOME", "PTY-COUNCIL", "half_yearly"), st("POLICY-HOME", "Home certificate", "policy", "contract", "CON-HOME-INS", "PTY-PURRSURE", "yearly"), st("POLICY-MOTOR", "Motor certificate", "policy", "contract", "CON-MOTOR", "PTY-PURRSURE", "yearly"), st("CHILDCARE", "Kittenhood statements", "childcare_statement", "contract", "CON-KIDS", "PTY-KITTEN", "monthly", { valid_to: "2025-06-30" }),
    st("BAS-STATEMENTS", "Activity statements", "activity_statement", "party", "PTY-LUKA", "PTY-TAX", "quarterly", { valid_to: BIZ_CLOSE }), st("CO-MINUTES", "Director's minutes", "statement", "party", "PTY-LUKA", "PTY-CO", "event"), st("CO-FINANCIALS", "Company financials", "statement", "party", "PTY-LUKA", "PTY-CO", "yearly"), st("ATO-PLAN", "Payment plan letter", "statement", "party", "PTY-LUKA", "PTY-TAX", "event"),
  ];
  let t = 0;
  const tm = (subject_type, subject_id, term, value, unit, valid_from, o = {}) => { t += 1; return { term_id: `TERM-${pad(t, 3)}`, subject_type, subject_id, term, value, unit, valid_from, recorded_at: ON, ...o }; };
  // only what a person knows offhand
  const term = [tm("contract", "CON-HOME", "interest_rate", "6.19", "pct", START), tm("contract", "CON-HOME", "rate_type", "variable", null, START), tm("contract", "CON-HOME", "repayment_type", "principal_and_interest", null, START), tm("contract", "CON-HOME", "repayment_cents", String(HOMEPAY), "cents", START), tm("contract", "CON-HOME", "repayment_cadence", "fortnightly", null, START),
    tm("contract", "CON-UTE", "interest_rate", "8.45", "pct", START), tm("contract", "CON-UTE", "rate_type", "fixed", null, START), tm("contract", "CON-UTE", "repayment_type", "principal_and_interest", null, START), tm("contract", "CON-UTE", "repayment_cents", "128640", "cents", START), tm("contract", "CON-UTE", "repayment_cadence", "monthly", null, START), tm("contract", "CON-UTE", "term_end", UTE_END, "date", START),
    tm("contract", "CON-COLOAN", "interest_rate", "0", "pct", BIZ_CLOSE), tm("contract", "CON-COLOAN", "repayment_type", "principal_and_interest", null, BIZ_CLOSE), tm("contract", "CON-MILAN", "interest_rate", "0", "pct", MILAN_DAY), tm("contract", "CON-MILAN", "repayment_type", "principal_and_interest", null, MILAN_DAY), tm("contract", "CON-MILAN", "repayment_cents", "50000", "cents", "2025-07-01"), tm("contract", "CON-MILAN", "repayment_cadence", "monthly", null, "2025-07-01"),
    tm("contract", "CON-DENTAL", "base_salary_cents", "4000000", "cents", START), tm("contract", "CON-DENTAL", "pay_cadence", "fortnightly", null, START), tm("contract", "CON-LIBRARY", "base_salary_cents", "620000", "cents", START), tm("contract", "CON-LIBRARY", "pay_cadence", "monthly", null, START), tm("contract", "CON-LUKA-CO", "base_salary_cents", "11000000", "cents", INCORP), tm("contract", "CON-LUKA-CO", "pay_cadence", "fortnightly", null, INCORP), tm("contract", "CON-MARI-CO", "base_salary_cents", "624000", "cents", INCORP), tm("contract", "CON-MARI-CO", "pay_cadence", "monthly", null, INCORP),
    tm("contract", "CON-IP", "premium_cents", "14860", "cents", START), tm("contract", "CON-IP", "premium_cadence", "monthly", null, START), tm("asset", "AST-HOME", "use", "owner_occupied", null, "2018-05-14")];
  const activity = [{ activity_id: "ACT-TRADE", kind: "sole_trader", name: "Novak Electrical, sole trader", owner_party_id: "PTY-LUKA", valid_from: "2012-07-01", valid_to: INCORP, recorded_at: ON }];
  const household = [{ household_id: "HH-NB", name: "Novak-Bautista", jurisdiction: "AU", base_currency: "AUD", fy_start_month: 7, timezone: "Australia/Brisbane", standard_version: "household-standard/1" }];
  return { household, party, membership, account, alias, ownership, category, contract, link, stream, asset, term, activity };
}

// ---------- build ----------
function build() {
  windows();
  everyday(); soleTrader(); lineTraps(); materials(); drawings(); lukaPay(); marisolPay(); incorporation(); taxes(); homeRepayments(); ute(); homeValues(); assets(); money_in(); bills(); superFunds();
  settleCard(); settleCard2(); strayFile(); sweeps(); interestCredits(); homeInterest();
  fileTraps();
  const tb = truthBalances();
  const t = truth(tb);
  const lows = {}; for (const a of [EV, JT, MA, TS, BZ]) lows[a] = Math.min(...chain(a).map((x) => x.balance));
  render();
  const tSetup = setup();
  fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
  const manifest = { household: "HH-NB", files: FILES.map((f) => ({ path: f.path, stream_id: f.stream, download_date: f.day, name: f.name, origin: f.origin || "portal", issued_on: f.issued_on || null })) };
  for (const f of FILES) { const p = path.join(OUT, f.path); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, f.bytes); }
  fs.writeFileSync(path.join(OUT, "manifest.json"), `${JSON.stringify(manifest, null, 1)}\n`);
  fs.writeFileSync(path.join(OUT, "truth.json"), `${JSON.stringify(t, null, 1)}\n`);
  fs.mkdirSync(SETUP_DIR, { recursive: true });
  for (const n of fs.readdirSync(SETUP_DIR)) fs.rmSync(path.join(SETUP_DIR, n));
  for (const [k, v] of Object.entries(tSetup)) fs.writeFileSync(path.join(SETUP_DIR, `${k}.json`), `${JSON.stringify(v, null, 1)}\n`);
  return { files: FILES.length, lines: B.lines.length, traps: B.traps.length, fresh: B.traps.filter((x) => x.fresh).length, dc: B.traps.filter((x) => x.dc).length, lows, tb };
}

if (require.main === module) { const r = build(); console.log(`Held-out household 5: ${r.files} files, ${r.lines} lines, ${r.traps} traps (${r.fresh} in none of the earlier lists, ${r.dc} new double-count or silent-number variants). Lowest balances: ${Object.entries(r.lows).map(([a, v]) => `${a} ${money(v)}`).join(", ")}.`); }
module.exports = { build, OUT, SETUP_DIR, book: B };
