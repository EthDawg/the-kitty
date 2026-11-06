#!/usr/bin/env node
/* The third held-out household. Two blind families found real defects, and the second family's first run was bad even after the first round of repairs. Scores after repair prove nothing.
   This family answers the only honest question left: did round two generalise, or did it fit two families?

   The Haddad-Whitlocks of Castlemaine, Victoria, 36 months from July 2023 to June 2026. Everything here is fictional. Salma Haddad and Geoffrey Whitlock are retired. Nobody earns a wage.
   She draws an account-based pension from an APRA fund, he draws one from their own self-managed fund, both take a part Age Pension until selling up ends it, and he has a small UK pension
   and a UK savings account in sterling. They hold term deposits, and enough to take only a small part pension. Their son Karim leaves home in March 2024, staying on a joint saver for six months, with a family loan behind his house
   deposit. Salma's mother Nadia is in aged care, and her money passes through the household: the sale of her house, the deposit to the home, the monthly fees. She dies, and an estate
   arrives in pieces through a solicitor's trust account. The couple downsize: a unit bought on a bridging loan, the family home sold four months later, a downsizer contribution to the
   fund. A holiday unit at Portland is let in summer. Their bank is merged into another in March 2025. Written blind: from SPEC.md, RECIPES.md, the schemas, the public recipes, the intake, the
   world's file writers and the two earlier held-out folders' build, run and blind reports.

   Order of work, as in the earlier households: a life is simulated first and held in cents, day by day. Only then are files rendered from it, as each institution would hand them over.
   Truth is written from the simulation and never from the engine. Setup is what a person would answer at onboarding: no rules, no decisions, no opening balances a file states.

   node standard/eval/heldout3/build.js
   writes standard/.build/heldout3/{sources,manifest.json,truth.json} and standard/eval/heldout3/setup/<table>.json. Node 22, no dependencies, seeded, no clock. */
"use strict";
const fs = require("fs"), path = require("path"), zlib = require("zlib");

const STD = path.join(__dirname, "..", "..");
const LIB = path.join(STD, "world", "lib");
const { pad, fix, money, addDays, dayDiff, weekday, monthEnd, nextMonth, monthRange, fmtDate, dmy, fyOf, csvLines, Rng, MONTHS: MON } = require(path.join(LIB, "util"));
const { Doc, M: MARGIN } = require(path.join(LIB, "pdf"));
const { eml, page, row } = require(path.join(LIB, "mail"));
const { ofx, qif } = require(path.join(LIB, "bankfiles"));

const OUT = path.join(STD, ".build", "heldout3");
const SETUP_DIR = path.join(__dirname, "setup");
const START = "2023-07-01", END = "2026-06-30", MONTHS = monthRange("2023-07", "2026-06");
const MERGER = "2025-03-17", LEAVES = "2024-03-15", FAM_CLOSE = "2024-09-30", BUY = "2025-02-14", SOLD = "2025-05-30", CAR_SOLD = "2025-08-20", CARD_NEW = "2025-01-20", TRIP_FROM = "2024-09-03", TRIP_TO = "2024-09-24";
const rng = (name) => new Rng(`haddad-whitlock:${name}`);
const deflate = (b) => new Uint8Array(zlib.deflateSync(b));

// ---------- who and what ----------
const SALMA = "Salma Haddad", GEOFF = "Geoffrey Whitlock", KARIM = "Karim Whitlock", NADIA = "Nadia Haddad", TARIQ = "Tariq Haddad";
const EV = "ACC-EVERY", SV = "ACC-SAVER", FM = "ACC-FAMILY", OD = "ACC-DORMANT", TA = "ACC-TD-A", TB = "ACC-TD-B", TC = "ACC-TD-C", TD = "ACC-TD-D", CC = "ACC-CARD", BK = "ACC-BROKER", SH = "ACC-SHARES", UK = "ACC-UK", SB = "ACC-SMSF-BANK", SK = "ACC-SMSF-BROKER", SS = "ACC-SMSF-SHARES", PN = "ACC-PENSION", BR = "ACC-BRIDGE", FL = "ACC-KARIM", HO = "ACC-HOME", UN = "ACC-UNIT", LO = "ACC-PORTLAND", CAR = "ACC-CAR";
const NUM = { harbour: "714220615522", saver: "0061930288", tdb: "714220770134", card1: "42118", card2: "42977", broker: "CT-7718240", smsfBroker: "CT-7718266", hin: "X0044120", hinSmsf: "X0051877", pension: "HST-9930127", bridge: "553 120 447", owner: "PM-88013" };
const cardFull = (d) => `xxxx-xxxxxx-${d < CARD_NEW ? NUM.card1 : NUM.card2}`, cardNo = (d) => (d < CARD_NEW ? NUM.card1 : NUM.card2);
const HOME = "26 Barker Street, Castlemaine", UNIT = "Unit 4, 18 Mostyn Street, Castlemaine", PORT = "8 Cliff Street, Portland";
const CASH = [EV, SV, FM, OD, TA, TB, TC, TD, CC, BK, UK];

// ---------- the book: every line that ever touches an account, in cents, holder's sign. ACC-UK lines are in sterling pence with their Australian value beside them ----------
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

/* trap register. fresh: in neither BLIND-1's nor BLIND-2's list. dc: a new variant of double counting or of a number silently wrong. A probe is a fact run.js can test against what the engine produced. */
function trap(id, name, where, expect, probe, o = {}) { B.traps.push({ id, name, where, expect, probe, fresh: !!o.fresh, dc: !!o.dc }); }
const plain = (x, want, extra = {}) => ({ account: x.acct, date: x.date, ...(x.posted && x.posted !== x.date ? { posted: x.posted } : {}), cents: x.cents, want, ...extra });

// ---------- merchants, all invented ----------
const MER = {
  grocer: [["CAMPBELLS CREEK GROCER", "CASTLEMAINE"], ["THE HARCOURT PROVEDORE", "HARCOURT"], ["WESLEY HILL FRESH", "CASTLEMAINE"]],
  cafe: [["SALUTE AND CRUMB", "CASTLEMAINE"], ["THE MILL ROASTERS", "CHEWTON"], ["THEATRE LANE COFFEE", "MALDON"]],
  dine: [["APOLLO DUMPLINGS", "CASTLEMAINE"], ["THE BOLD VINE BISTRO", "MALDON"], ["GOLD DIGGERS ARMS", "KYNETON"]],
  fuel: [["BOX IRONBARK FUEL", "CASTLEMAINE"], ["BOX IRONBARK FUEL", "KYNETON"]],
  shop: [["LODDON GARDEN SUPPLY", "CASTLEMAINE"], ["BOOKS AND SLATE", "CASTLEMAINE"], ["KANGAROO FLAT HARDWARE", "BENDIGO"], ["WESLEY LINENS", "BENDIGO"]],
  chem: [["FOREST STREET PHARMACY", "CASTLEMAINE"], ["FOREST STREET PHARMACY", "CAMPBELLS CK"]],
};
const cardDesc = (m) => `${m[0]} ${m[1]}`;
const cardCsv = (m) => `${m[0].padEnd(26)}${m[1]}  VIC`;
const pos = (m) => `EFTPOS ${m[0]} ${m[1]}`;

/* one card purchase. date is the day it was charged, which the statement shows; posted is the day the activity download shows. Lag is in business days. */
function card(r, date, m, c, cat, member, o = {}) {
  const lag = o.lag != null ? o.lag : r.pick([0, 0, 1, 1, 1, 2, 2, 3, 4, 5]);
  const post = o.posted || (lag ? bizAfter(date, lag) : date);
  return line(CC, date, o.desc || cardDesc(m), -c, { posted: post, csv: o.csv || cardCsv(m), member, lens: o.lens === undefined ? "spending" : o.lens, cat, ...o.extra });
}

// ---------- everyday life ----------
function everyday() {
  const r = rng("everyday"), pick = (a) => r.pick(a);
  for (let d = "2023-06-22"; d <= END; d = addDays(d, 1)) {
    const wd = weekday(d), who = () => (r.next() < 0.4 ? GEOFF : SALMA), inWin = d >= START, away = d >= TRIP_FROM && d <= TRIP_TO;
    if (!away) {
      if (r.next() < 0.42) { card(r, d, pick(MER.grocer), cents(r, 34, 172), "GROCERIES", who()); count("purchase"); }
      if (r.next() < 0.26) { card(r, d, pick(MER.cafe), cents(r, 6, 24), "DINING", who()); count("purchase"); }
      if ((wd === 5 || wd === 6) && r.next() < 0.3) { card(r, d, pick(MER.dine), cents(r, 38, 126), "DINING", who()); count("purchase"); }
      if (r.next() < 0.09) { card(r, d, pick(MER.fuel), cents(r, 44, 88), "TRANSPORT", who()); count("purchase"); }
      if (r.next() < 0.08) { card(r, d, pick(MER.shop), cents(r, 16, 240), "SHOPPING", who()); count("purchase"); }
      if (r.next() < 0.07) { card(r, d, pick(MER.chem), cents(r, 9, 66), "HEALTH", who()); count("purchase"); }
    }
    if (d.slice(8) === "11") { card(r, d, ["NORTHLIGHT STREAM", "ONLINE"], 1699, "SUBS", SALMA); count("purchase"); }
    if (!inWin) continue;
    if (d.slice(8) === "03") { spend(EV, d, "DIRECT DEBIT KOALATEL MOBILE 5501", 5800, "TELCO"); spend(EV, d, "DIRECT DEBIT GOLDLINE INTERNET 77121", 7900, "TELCO"); count("purchase", 2); }
    if (d.slice(8) === "07") { spend(EV, d, "DIRECT DEBIT BUPAW HEALTH 7712", d < "2024-04-01" ? 46420 : d < "2025-04-01" ? 48630 : 50845, "HEALTH"); count("purchase"); }
    if (d.slice(8) === "19" && Number(d.slice(5, 7)) % 3 === 0) { spend(EV, d, "BPAY HIGHLAND MUSIC SOCIETY 4410", 6500, "DONATION"); count("purchase"); }
  }
  // services at the one garage in town, the same one that buys the old car
  for (const [d, c] of [["2023-10-12", 41860], ["2024-05-09", 62410], ["2025-03-27", 38975]]) { spend(EV, d, "EFTPOS MOUNT ALEXANDER MOTORS", c, "CAR"); count("purchase"); }
}

// ---------- pensions, which are all the income there is ----------
const PENS = { fund: [], dwp: [] };
const GBP = { fx: {} };
function fxCurve() { const r = rng("fx"); let f = 19000; for (const ym of ["2023-06", ...MONTHS]) { f = Math.round(f * (1 + r.range(-0.011, 0.012))); GBP.fx[ym] = f; } }
const toAud = (pence, d) => Math.round(pence * GBP.fx[ymOf(d)] / 10000);
function pensions() {
  // Salma's account-based pension at an APRA fund, monthly, to the joint account. No public recipe reads the fund's pension files
  const hp = [];
  for (const ym of MONTHS) {
    const d = prevBiz(`${ym}-15`), c = ym < "2024-07" ? 110000 : ym < "2025-07" ? 115000 : 120000;
    hp.push(earn(EV, d, "HESTABBY PENSION PMT 7741", c, "SUPER-PENSION")); PENS.fund.push({ date: d, code: "PENS", label: "Pension payment", cents: -c }); count("pension_payment");
  }
  const top = earn(EV, "2024-06-24", "HESTABBY PENSION TOPUP 7741", 150000, "SUPER-PENSION"); PENS.fund.push({ date: top.date, code: "PENS", label: "Pension top-up to the minimum", cents: -150000 });
  trap("T3-ABP", "An account-based pension: income, with no payslip and no employer", `${EV}: ${hp.length} monthly credits and a June top-up, "HESTABBY PENSION PMT 7741". The fund's files carry a line type no public recipe maps`, "SUPER-PENSION: income in the cash lens, SPEC 6.5 and schema/metrics.json. The bank line is the only witness a public recipe can read.",
    { kind: "lines", lines: [hp[0], hp[13], top, hp[30]].map((x) => plain(x, "income")) }, { fresh: true });

  // Geoffrey's pension from their own fund: both sides are declared accounts, and it is still income
  const sm = [], tf = [];
  for (const ym of MONTHS) {
    const d = nextBiz(`${ym}-01`), c = ym < "2024-07" ? 125000 : ym < "2025-07" ? 130000 : 190000;
    const a = line(SB, d, "PENSION PAYMENT G WHITLOCK", -c, {}), b = earn(EV, d, "WHITLOCK HADDAD SF PENSION", c, "SUPER-PENSION"); sm.push([a, b]); count("pension_payment");
    // six months where the top-up from the saver is the same amount on the same day
    if (ym >= "2024-01" && ym <= "2024-06") tf.push({ d, c, x: own(SV, d, "TFR TO BARK EVERYDAY", EV, d, "TFR FROM WATTLE SAVER", c) });
  }
  const s = [sm[2], sm[14], sm[30]];
  trap("T3-SMSF-PENSION", "A pension from the household's own super fund: two declared accounts, one income", `${SB} to ${EV}, ${sm.length} payments, for example ${money(s[0][1].cents)} on ${s[0][1].date}`, "Income on the bank line, SPEC 6.5. A debit on one declared account and an equal credit on another is not an own transfer when the money crosses out of super. If they pair, the pension vanishes from income and nothing says so.",
    { kind: "lines", lines: s.flatMap(([a, b]) => [plain(a, "neither"), plain(b, "income")]) }, { fresh: true, dc: true });
  trap("T3-PENSION-VS-TFR", "A pension and an own transfer on one day at one amount", `${EV}, first working day of 2024-01 to 2024-06: 1,250.00 from the fund and 1,250.00 from the saver, on the same day, to the same account`, "One is income and one is a transfer. Pairing the fund's debit with the saver's credit, or the saver's debit with the pension, loses the income.",
    { kind: "lines", lines: tf.slice(0, 3).flatMap((t) => [{ account: EV, date: t.d, cents: t.c, want: "mixed:income,neither", n: 2 }, plain(t.x[0], "neither")]) }, { fresh: true, dc: true });

  // the Age Pension, the same amount twice on one day, for each of them, until the home is sold
  const rate = (d) => (d < "2023-09-21" ? 13620 : d < "2024-03-21" ? 14010 : d < "2024-09-20" ? 14440 : d < "2025-03-21" ? 14900 : 15360);
  const ages = [];
  for (let d = "2023-07-06"; d <= "2025-06-26"; d = addDays(d, 14)) { const c = rate(d); earn(EV, d, "SERVICES AUSTRALIA PENSION 2291", c, "x_AGE-PENSION"); earn(EV, d, "SERVICES AUSTRALIA PENSION 2291", c, "x_AGE-PENSION"); ages.push({ d, c }); count("age_pension", 2); }
  trap("T3-AGE-PENSION", "Two Age Pensions, one payer, one day, one amount, one line of text", `${EV}: ${ages.length} fortnights, two identical credits each, to 2025-06-26, and the 2025-03-13 pair sits in the overlap of the old bank's file and the new bank's`, "Both are income. Two lines in one file are two, and a second file showing them adds none.",
    { kind: "lines", lines: [ages[1], ages[20], ages.find((x) => x.d === "2025-03-13")].map((x) => ({ account: EV, date: x.d, cents: x.c, want: "income", n: 2 })) }, { fresh: true, dc: true });
  // Medicare, under the same payer's name
  const backs = [["2023-08-24", 4120], ["2023-12-05", 8635], ["2024-04-18", 4120], ["2024-11-07", 12040], ["2025-05-19", 4385], ["2026-02-11", 4385]];
  for (const [d, c] of backs) { spend(EV, addDays(d, -2), "EFTPOS MT ALEXANDER MEDICAL", c + 4200, "HEALTH"); line(EV, d, "SERVICES AUSTRALIA MEDICARE 2291", c, { lens: "spending", cat: "HEALTH" }); count("purchase"); }
  trap("T3-MEDICARE-SA", "A Medicare refund beside an Age Pension from the same payer", `${EV} on ${backs.map((b) => b[0]).join(", ")}`, "Lowers HEALTH spending. Not income, whatever a repair for the pension does to the payer's name.",
    { kind: "lines", lines: backs.map(([d, c]) => ({ account: EV, date: d, cents: c, want: "spending" })) });
  const debt = line(EV, "2025-08-07", "SERVICES AUSTRALIA DEBT RECOVERY 2291", -61440, { lens: "income", cat: "x_AGE-PENSION" });
  trap("T3-PENSION-DEBT", "An overpaid pension taken back by a debit", `${EV} ${debt.date} -614.40: selling the home ended the pension and the last four payments were too many`, "A negative in pension income. Not spending. It can only be learned by asking, so a question over the line is the honest best.",
    { kind: "lines", lines: [plain(debt, "income")] }, { fresh: true });
  // a UK state pension, frozen in sterling, every four weeks in Australian dollars at the day's rate
  for (let d = "2023-07-11"; d <= END; d = addDays(d, 28)) { const c = toAud(61240, d); PENS.dwp.push(earn(EV, d, "DWP UK PENSION GBP 612.40", c, "x_AGE-PENSION")); count("uk_pension"); }
  trap("T3-UK-PENSION", "A foreign government pension, in Australian dollars, a different amount every time", `${EV}: ${PENS.dwp.length} credits, "DWP UK PENSION GBP 612.40", every four weeks`, "Income. No contract, no payslip, no dictionary entry: the engine can ask, and may not call it a refund.",
    { kind: "lines", lines: [0, 12, 30].map((i) => plain(PENS.dwp[i], "income")) }, { fresh: true });
}

// ---------- health claims, bills and the holiday unit ----------
const BILLS = { energy: [], rates: [], water: [], policy: [] };
function bills() {
  const r = rng("bills");
  const situ = (d) => (d < SOLD ? HOME : UNIT);
  for (const [d, c] of [["2023-09-14", 8450], ["2024-02-20", 21200], ["2024-07-16", 6300], ["2025-01-30", 34775], ["2025-10-08", 12910], ["2026-04-16", 9840]]) { spend(EV, addDays(d, -3), "EFTPOS CASTLEMAINE DENTAL", c + 9000, "HEALTH"); line(EV, d, "BUPAW BENEFIT 7712", c, { lens: "spending", cat: "HEALTH" }); count("purchase"); }
  for (const q of ["2023-09", "2023-12", "2024-03", "2024-06", "2024-09", "2024-12", "2025-03", "2025-06", "2025-09", "2025-12", "2026-03"]) {
    const billDate = `${nextMonth(q)}-06`, amt = cents(r, 260, 540), gst = Math.round(amt / 11), paid = addDays(billDate, 17);
    BILLS.energy.push({ billDate, due: addDays(billDate, 21), from: addDays(`${q}-01`, -61), to: monthEnd(q), amt, gst, account: "GP-5512044" });
    spend(EV, paid, "BPAY GOLDLINE POWER 5512044", amt, "UTILITIES"); count("bill_paid");
  }
  for (const q of ["2023-08", "2023-11", "2024-02", "2024-05", "2024-08", "2024-11", "2025-02", "2025-05", "2025-08", "2025-11", "2026-02", "2026-05"]) {
    const amt = cents(r, 395, 455), billDate = `${q}-01`, due = `${q}-28`;
    BILLS.rates.push({ billDate, due, from: `${q}-01`, to: monthEnd(nextMonth(nextMonth(q))), amt, reference: `RN-${q.replace("-", "")}-7714`, situ: situ(billDate) });
    spend(EV, addDays(due, -4), "BPAY MT ALEXANDER COUNCIL 7714420", amt, "RATES-HOME"); count("bill_paid");
    const usage = cents(r, 38, 88), service = 8720, wb = `${q}-11`, wd = `${q}-27`;
    BILLS.water.push({ billDate: wb, due: wd, from: addDays(wb, -92), to: addDays(wb, -2), usage, service, amt: usage + service, situ: situ(wb) });
    spend(EV, addDays(wd, -1), "BPAY COLIBAN REACH WATER 60227104", usage + service, "UTILITIES"); count("bill_paid");
    spend(SV, nextBiz(`${q}-20`), "BPAY HENTY SHIRE 3318", cents(r, 340, 372), "RENT-RATES"); count("bill_paid");
  }
  for (const [from, to, amt, kind, num, situ_, sum, acct, cat, desc] of [
    ["2023-10-02", "2024-10-01", 171240, "Home", "PH-40771882", HOME, 76000000, EV, "HOME-INS", "PURRSURE HOME PH-40771882"], ["2024-10-02", "2025-10-01", 182950, "Home", "PH-40771882", HOME, 76000000, EV, "HOME-INS", "PURRSURE HOME PH-40771882"], ["2025-10-02", "2026-10-01", 94120, "Home", "PH-51220913", UNIT, 21000000, EV, "HOME-INS", "PURRSURE HOME PH-51220913"],
    ["2023-12-15", "2024-12-14", 98310, "Landlord", "PL-33904115", PORT, 21000000, SV, "RENT-INS", "PURRSURE LANDLORD PL-33904115"], ["2024-12-15", "2025-12-14", 101480, "Landlord", "PL-33904115", PORT, 21000000, SV, "RENT-INS", "PURRSURE LANDLORD PL-33904115"], ["2025-12-15", "2026-12-14", 106250, "Landlord", "PL-33904115", PORT, 21000000, SV, "RENT-INS", "PURRSURE LANDLORD PL-33904115"]]) {
    const paid = addDays(from, -3);
    BILLS.policy.push({ from, to, amt, paid, sum, excess: 75000, number: num, kind, situ: situ_.split(",")[0] });
    spend(acct, paid, desc, amt, cat); count("bill_paid");
  }
  const w = B.lines.filter((x) => x.acct === EV && /COUNCIL/.test(x.desc)).sort(byTime)[3];
  trap("T3-BILL-WITNESS", "A rates notice and the bank line that pays it", `${EV} ${w.date}: ${money(-w.cents)}`, "Spending once. The notice clears against the line.",
    { kind: "lines", lines: [plain(w, "spending", { n: 1 })] });
}

// Portland Bay Holiday Lets, on the same portal software as a long-term agent, a statement only for a month with a stay
const RENT = { st: [], bad: {} };
function holidayLets() {
  const stays = {
    "2023-12": [["2023-12-22", 128000], ["2023-12-29", 196000]], "2024-01": [["2024-01-05", 196000], ["2024-01-13", 164000]], "2024-02": [["2024-02-16", 92000]], "2024-03": [["2024-03-08", 118000], ["2024-03-29", 142000]],
    "2024-12": [["2024-12-20", 142000], ["2024-12-27", 212000]], "2025-01": [["2025-01-04", 212000], ["2025-01-18", 208000]], "2025-02": [["2025-02-07", 98000]], "2025-04": [["2025-04-18", 152000]],
    "2025-12": [["2025-12-19", 148000], ["2025-12-27", 224000]], "2026-01": [["2026-01-03", 224000], ["2026-01-17", 186000]], "2026-02": [["2026-02-13", 240000]], "2026-04": [["2026-04-03", 158000]],
  };
  for (const ym of Object.keys(stays).sort()) {
    const rows = stays[ym].map(([date, amt]) => ({ date, amt })), gross = rows.reduce((t, x) => t + x.amt, 0), fees = Math.round(gross * 0.12), disbursed = gross - fees, paid = ym === "2026-02" ? "2026-03-25" : bizAfter(monthEnd(ym), 3);
    const s = { ym, from: `${ym}-01`, to: monthEnd(ym), rows, gross, fees, disbursed, paid }; RENT.st.push(s);
    s.line = earn(SV, paid, "PORTLAND BAY LETS TRUST 88013 OWNER", disbursed, "RENT-INC"); count("rent_disbursement");
  }
  // the agent overcharged in January 2025 and reissued the statement, paying the difference
  const j = RENT.st.find((x) => x.ym === "2025-01"), newFees = Math.round(j.gross * 0.11);
  j.reissue = { ...j, fees: newFees, disbursed: j.gross - newFees, issued: "2025-02-20", paid: "2025-03-03" };
  const adj = earn(SV, "2025-03-03", "PORTLAND BAY LETS TRUST 88013 ADJ", j.fees - newFees, "RENT-INC"); count("rent_disbursement");
  trap("T3-REISSUED", "An owner statement reissued with a corrected fee", `January 2025: first ${money(j.fees)} of fees, reissued ${j.reissue.issued} at ${money(newFees)}, and ${money(j.fees - newFees)} paid in the difference. Same period, same property, two documents`, "SPEC 6.2: a restatement is decided by the later-issued document. Gross rent counts once in the economic lens and the fee is the corrected one.",
    { kind: "lines", lines: [plain(j.line, "income"), plain(adj, "income")], accrual: [{ month: "2025-01", category: "RENT-INC", cents: j.gross }, { month: "2025-01", category: "RENT-MGMT", cents: -newFees }] }, { fresh: true, dc: true });
  // the real payment for February 2026 comes late, past the window, and two strangers' credits inside the window add to it exactly
  const f = RENT.st.find((x) => x.ym === "2026-02"), a = line(SV, "2026-03-04", "OSKO FROM M TREVASKIS SHARED TRIP", 125000, { lens: "spending", cat: "HOLIDAYS" }), b = earn(SV, "2026-03-09", "OSKO FROM J OYELARAN GIFT", f.disbursed - 125000, "GIFT-IN"); count("purchase");
  trap("T3-AGENT-FALSE-SUM", "Two unrelated credits that add to an owner statement exactly", `${SV}: ${money(a.cents)} and ${money(b.cents)} from two friends inside sixteen days of the statement for February 2026, which pays ${money(f.disbursed)}. The agent's own credit lands ${f.paid}`, "The friends' credits are not rent. Matching by sum finds a false subset here; the statement waits for its own credit, or says it is unmatched.",
    { kind: "lines", lines: [plain(a, "spending"), plain(b, "income"), plain(f.line, "income", { month: "2026-03" })] }, { fresh: true, dc: true });
  // their own listing pays direct, no statement, no agent
  const st = [["2024-02-02", 86000], ["2024-10-07", 74000], ["2025-03-11", 91500], ["2025-11-03", 78250], ["2026-05-04", 66000]].map(([d, c]) => earn(SV, d, "STAYPAW PAYOUT 40117", c, "RENT-INC")); count("stay_payout", 5);
  trap("T3-STAY-PAYOUT", "A booking platform's payout beside an agent's statements", `${SV}: ${st.length} payouts from their own listing, on no owner statement`, "Income. The bank line is the only witness and the statement stream is not owed it.",
    { kind: "lines", lines: st.slice(0, 3).map((x) => plain(x, "income")) }, { fresh: true });
}

// ---------- shares, theirs and the fund's ----------
const SEC = { TNW: { name: "Tannin Wines Ltd", p: 6420, owner: "her" }, FLM: { name: "Flume Water Ltd", p: 1880, owner: "her" }, IBK: { name: "Ironbark Ore Ltd", p: 9140, owner: "fund" }, CMB: { name: "Coolamon Bank Ltd", p: 4410, owner: "fund" } };
const SHARES = { her: {}, fund: {}, trades: [], divs: [], action: null };
const CONSOL = { code: "FLM", d: "2025-03-12" }, ROC = { code: "TNW", d: "2025-09-15", cps: 120 };
function shares() {
  const r = rng("shares"), start = { TNW: 450000, FLM: 900000, IBK: 600000, CMB: 1000000 }, adds = [], curve = {};   // units times a hundred
  for (const c of Object.keys(SEC)) { let p = SEC[c].p; curve[c] = {}; for (const ym of ["2023-06", ...MONTHS]) { p = Math.round(p * (1 + r.range(-0.045, 0.052))); curve[c][ym] = p; } }
  for (const ym of MONTHS) if (ym >= "2025-03") curve.FLM[ym] *= 2;
  const trades = [
    { d: "2024-02-08", settle: "2024-02-12", side: "sell", code: "TNW", units: 500, ref: "CN-402118", acct: BK, num: NUM.broker },
    { d: "2024-06-11", settle: "2024-06-13", side: "sell", code: "IBK", units: 400, ref: "CN-417220", acct: SK, num: NUM.smsfBroker },
    { d: "2025-07-08", settle: "2025-07-10", side: "buy", code: "CMB", units: 30000, ref: "CN-466031", acct: SK, num: NUM.smsfBroker },
  ];
  for (const t of trades) {
    const p = Math.round(curve[t.code][ymOf(t.d)] * (1 + r.range(-0.02, 0.02))), gross = Math.round(t.units * p / 10), brokerage = 1995;
    Object.assign(t, { price: (p / 1000).toFixed(3), gross, brokerage, total: t.side === "buy" ? gross + brokerage : gross - brokerage, name: SEC[t.code].name });
    SHARES.trades.push(t); count("trade");
    if (t.side === "buy") own(SB, "2025-07-03", "BPAY CEDAR TRADE 7718266", SK, "2025-07-04", "BPAY RECEIVED", t.total + 50000, { reference: `DEP-${t.ref.slice(3)}` });
    line(t.acct, t.settle, `${t.side === "buy" ? "BUY" : "SELL"} ${t.units} ${t.code} @ ${t.price}`, t.side === "buy" ? -t.total : t.total, { reference: t.ref, trade: true });
    B.transit.push({ from: t.d, until: t.settle, cents: t.side === "buy" ? -t.total : t.total });
    adds.push({ code: t.code, d: t.d, u: (t.side === "buy" ? 1 : -1) * t.units * 100 });
  }
  own(BK, "2024-02-14", "WITHDRAWAL TO BANK", EV, "2024-02-15", "CEDAR TRADE WITHDRAWAL", SHARES.trades[0].total, { reference: "WD-402118" });
  own(SK, "2024-06-17", "WITHDRAWAL TO BANK", SB, "2024-06-18", "CEDAR TRADE WITHDRAWAL", SHARES.trades[1].total, { reference: "WD-417220" });
  const unitsOn = (code, d) => { let u = adds.filter((x) => x.code === code && x.d <= d).reduce((t, x) => t + x.u, start[code]); if (code === CONSOL.code && d >= CONSOL.d) u = Math.floor(u / 2); return u; };
  const divs = [];
  for (const y of [2023, 2024, 2025, 2026]) for (const [m, day] of [["03", "21"], ["09", "19"]]) for (const [code, ps, frank] of [["TNW", 24, 1], ["FLM", 9, 1], ["IBK", 38, 1], ["CMB", 17, 1]]) {
    const d = nextBiz(addDays(`${y}-${m}-${day}`, code === "FLM" || code === "CMB" ? 5 : 0)); if (d < START || d > END) continue;
    const units = Math.round(unitsOn(code, addDays(d, -14)) / 100), net = units * ps, franked = Math.round(net * frank), unfranked = net - franked, credit = Math.round(franked * 30 / 70), fund = SEC[code].owner === "fund";
    const v = { code, name: SEC[code].name, pay: d, units, ps, franked, unfranked, credit, net, final: m === "09", hin: fund ? NUM.hinSmsf : NUM.hin, fund }; divs.push(v); count("dividend");
    const desc = `${code} DIVIDEND ${m === "09" ? "FINAL" : "INTERIM"} ${fund ? "00051877" : "00044120"}`;
    v.line = fund ? line(SB, d, desc, net, {}) : earn(EV, d, desc, net, "DIVIDEND");
  }
  SHARES.divs = divs; SHARES.unitsOn = unitsOn;
  for (const ym of ["2023-06", ...MONTHS]) {
    const e = monthEnd(ym), of = (o) => Object.keys(SEC).filter((c) => SEC[c].owner === o).map((c) => ({ code: c, name: SEC[c].name, u: unitsOn(c, e) })).filter((x) => x.u).map((x) => { const p = curve[x.code][ym]; return { ...x, units: String(x.u / 100), price: (p / 1000).toFixed(3), value: Math.round(x.u * p / 1000) }; });
    SHARES.her[ym] = of("her"); SHARES.fund[ym] = of("fund");
  }
  // a return of capital on her wine shares: cash that looks exactly like a dividend
  const held = Math.round(unitsOn(ROC.code, ROC.d) / 100), roc = line(EV, ROC.d, "TNW CAPITAL RETURN 00044120", held * ROC.cps, { capital: true }); SHARES.action = { ...ROC, held };
  trap("T3-CAPITAL-RETURN", "A return of capital that arrives like a dividend", `${EV} ${roc.date}: ${money(roc.cents)} from the registry on ${held} TNW, with an email notice and no dividend statement`, "Neither income nor spending: it lowers the holding's cost base, SPEC 4.6.",
    { kind: "lines", lines: [plain(roc, "neither")] }, { fresh: true, dc: true });
  trap("T3-CONSOLIDATION", "A one-for-two share consolidation by email", `FLM on ${CONSOL.d}: ${Math.round(unitsOn("FLM", addDays(CONSOL.d, -1)) / 100)} units become ${Math.round(unitsOn("FLM", CONSOL.d) / 100)}, the price doubles, no cash`, "Units halve, value does not, and L7 holds across it. Not a disposal of half the holding.",
    { kind: "lines", balances: [{ account: SH, months: ["2025-03", "2025-04"] }], lots: { instrument: "INS-FLM", units: unitsOn("FLM", END) * 1e6 } }, { fresh: true });
  const fd = divs.filter((x) => x.fund), hd = divs.filter((x) => !x.fund);
  trap("T3-DIVIDEND", "A dividend seen by the registry and by the cash line", `Computerpaw notices beside ${EV} credits, ${hd.length} payments`, "Income once, at the net amount.",
    { kind: "lines", lines: [plain(hd[0].line, "income"), plain(hd[3].line, "income")] });
  trap("T3-SMSF-DIVIDEND", "A dividend paid to the fund: the same registry, another holder number, no household income", `${SB}: ${fd.length} dividends on holder ${NUM.hinSmsf}`, "The fund's income is not cash income: SPEC 6.5 reads cash accounts, and this reaches one in the super group. The registry notice clears against the fund's line.",
    { kind: "lines", clearing: "clearing:income:ACC-SMSF", lines: [plain(fd[0].line, "neither"), plain(fd[3].line, "neither")], balances: [{ account: SS, months: ["2024-06", "2025-08"] }] }, { fresh: true, dc: true });
  trap("T3-HOLDINGS-GAP", "A month's fund holdings file never downloaded", `${SS}: no file for 2025-11-30`, "Coverage names the month.", { kind: "gap", stream: SS, month: "2025-11" });
}

// ---------- the fund's own bank, for what is not pension or dividends ----------
function fundCosts() {
  for (const fy of [2024, 2025, 2026]) { line(SB, `${fy - 1}-11-13`, "LODDON SMSF AUDIT PTY LTD", -44000, {}); line(SB, `${fy - 1}-11-20`, "BENDIGO ACCOUNTANTS FEE", -165000, {}); line(SB, `${fy - 1}-12-04`, "ATO SUPER LEVY 8831205", -25900, {}); }
}

// ---------- term deposits ----------
const TDS = {};
function termDeposits() {
  // A rolls for twelve months at a time and the interest stays inside
  const ta = [], interest = (p, pct, days) => Math.round(p * pct / 100 * days / 365);
  let p = OPEN[TA]; for (const d of ["2023-11-15", "2024-11-15", "2025-11-17"]) { const c = interest(p, 4.85, 366); ta.push(earn(TA, d, "INTEREST CREDITED AT ROLLOVER", c, "INTEREST")); p += c; count("td_interest"); }
  trap("T3-TD-ROLL", "A term deposit that rolls over with the interest added", `${TA}: ${ta.map((x) => `${money(x.cents)} on ${x.date}`).join(", ")}. No other account moves`, "Interest is income once, on the day it is credited, and the balance rises by exactly that.",
    { kind: "lines", lines: ta.map((x) => plain(x, "income")), balances: [{ account: TA, months: ["2023-10", "2023-11", "2024-11", "2026-06"] }] }, { fresh: true, dc: true });
  // B pays its interest away every six months: shown in and out on the deposit, and in on the everyday account
  const tb = [];
  for (const d of ["2023-09-20", "2024-03-20", "2024-09-20", "2025-03-20", "2025-09-22", "2026-03-20"]) {
    const c = interest(OPEN[TB], 4.6, 182), a = earn(TB, d, "INTEREST", c, "INTEREST"), [b, e] = own(TB, d, "INTEREST PAID TO NOMINATED ACCOUNT", EV, d, "HARBOUR TD INTEREST 770134", c);
    tb.push({ c, a, b, e }); count("td_interest");
  }
  trap("T3-TD-INT-ELSEWHERE", "Interest paid into a different account from the one that earned it", `${TB}: six half-yearly interest lines, each shown as a credit and a debit on the deposit and a credit on ${EV}; the 2025-03-20 one falls in the merger overlap`, "Income once for each. Three lines, one interest: the credit on the deposit and the credit on the bank must not both land.",
    { kind: "lines", income_once: tb.filter((_, i) => i === 1 || i === 3 || i === 4).map((t) => ({ lines: [t.a, t.b, t.e].map((x) => plain(x, "any")), cents: t.c })), balances: [{ account: TB, months: ["2024-03", "2025-03"] }] }, { fresh: true, dc: true });
  // C is a three-month deposit from the saver. At maturity one debit goes to two places: most into a new deposit, the rest to the bank
  const [cIn] = own(SV, "2024-02-05", "TFR TO WATTLE TERM DEPOSIT", TC, "2024-02-05", "DEPOSIT FROM SAVER", 3000000);
  void cIn;
  const ci = earn(TC, "2024-05-06", "INTEREST", interest(3000000, 4.9, 91), "INTEREST"), total = 3000000 + ci.cents, out = line(TC, "2024-05-06", "MATURITY PROCEEDS", -total, { xfer: true }), inD = line(TD, "2024-05-06", "OPENING DEPOSIT FROM TD 8841", 2000000, { xfer: true }), inE = line(EV, "2024-05-06", "WATTLE TD MATURITY 8841", total - 2000000, { xfer: true });
  B.pairs.push({ from: TC, date_out: out.date, to: TD, date_in: out.date, cents: 2000000, sent: total, what: "MATURITY PROCEEDS" }, { from: TC, date_out: out.date, to: EV, date_in: out.date, cents: total - 2000000, sent: total, what: "MATURITY PROCEEDS" });
  trap("T3-TD-SPLIT", "One maturity, one debit, two credits", `${TC} ${out.date}: ${money(total)} out; ${TD} ${money(inD.cents)} and ${EV} ${money(inE.cents)} in`, "Own money, nothing is income or spending but the interest. A sum proves it; a one-to-one pairing leaves all three open.",
    { kind: "lines", lines: [plain(ci, "income"), plain(out, "neither"), plain(inD, "neither"), plain(inE, "neither")] }, { fresh: true, dc: true });
  // D matures to the bank, principal and interest as one credit
  const di = earn(TD, "2025-05-06", "INTEREST", interest(2000000, 4.7, 365), "INTEREST"), dt = 2000000 + di.cents, [dOut, dIn] = own(TD, "2025-05-06", "MATURITY PROCEEDS", EV, "2025-05-06", "WATTLE TD MATURITY 9012", dt);
  trap("T3-TD-MATURE", "A maturity paid as one credit, principal and interest together", `${EV} ${dIn.date}: ${money(dt)}, of which ${money(di.cents)} is interest and appears as interest only on the deposit's own file`, "The credit is not income. The interest is income once, at the deposit.",
    { kind: "lines", lines: [plain(di, "income"), plain(dOut, "neither"), plain(dIn, "neither")] }, { fresh: true, dc: true });
}

// ---------- the family: a son who leaves, a loan to him, a mother in care, an estate ----------
const CARE = { invoices: [] };
function family() {
  // the family saver is Geoffrey's and Karim's. He leaves the household on 15 March 2024 and stays on the account until it is split on 30 September
  const fmClose = (c) => [Math.ceil(c / 2), Math.floor(c / 2)];
  const loan = line(EV, "2024-03-12", "OSKO TO K WHITLOCK HOUSE LOAN", -2000000, { third: true }); line(FL, "2024-03-12", "Loan advanced", 2000000, {});
  own(SV, "2024-03-08", "TFR TO BARK EVERYDAY", EV, "2024-03-08", "TFR FROM WATTLE SAVER", 2200000);
  const reps = []; for (const ym of monthRange("2024-07", "2026-06")) { const d = nextBiz(`${ym}-05`); reps.push(line(EV, d, "OSKO FROM K WHITLOCK LOAN", 30000, { third: true })); line(FL, d, "Repayment", -30000, {}); count("family_loan_repayment"); }
  trap("T3-FAMILY-LOAN", "A loan to an adult son, whose surname is a member's", `${EV} ${loan.date} -20,000.00, then ${reps.length} repayments of 300.00, "OSKO FROM K WHITLOCK". ${FL} is declared in setup as a loan the household is owed`, "Neither income nor spending, and the household is owed the balance. A member's surname does not make it a transfer between own accounts.",
    { kind: "lines", lines: [plain(loan, "neither"), plain(reps[0], "neither"), plain(reps[12], "neither")], balances: [{ account: FL, months: ["2024-06", "2025-06", "2026-06"] }] }, { fresh: true, dc: true });
  CARE.fmClose = fmClose;
  // Nadia's house is sold while the power of attorney is still being recognised, so the proceeds land on the saver
  const inn = line(SV, "2024-01-19", "LODDON CONVEYANCING TRUST N HADDAD SALE", 61240000, { third: true }), rad = line(SV, "2024-01-24", "TFR TO ROSEWOOD AGED CARE RAD", -48000000, { third: true }), n1 = line(SV, "2024-01-25", "OSKO TO N HADDAD", -12000000, { third: true }), n2 = line(SV, "2024-02-01", "OSKO TO N HADDAD", -1240000, { third: true });
  trap("T3-RAD-THROUGH", "An aged-care deposit and a house sale passing through the household", `${SV}: ${money(inn.cents)} in on ${inn.date} from a conveyancer's trust account, ${money(-rad.cents)} out to the home, ${money(-n1.cents - n2.cents)} on to her in two parts`, "SPEC 4.4c: someone else's money crossing the rails, not income, spending or savings. It cannot be known without being told, so a question is the honest best and a large number in income or spending is the failure.",
    { kind: "lines", lines: [inn, rad, n1, n2].map((x) => plain(x, "neither")) }, { fresh: true, dc: true });
  // the monthly fee is debited from the joint account and she pays it back, a few days later; twice she pays two months at once
  const r = rng("care"), inv = [];
  for (const ym of monthRange("2023-11", "2025-01")) {
    const d = nextBiz(`${ym}-08`), c = cents(r, 3320, 3490), o = line(EV, d, "ROSEWOOD AGED CARE FEES 5521", -c, { third: true });
    inv.push({ ym, d, c, o }); CARE.invoices.push({ ym, c }); count("care_fee");
  }
  const backs = [];
  for (let i = 0; i < inv.length; i += 1) {
    const x = inv[i];
    if (x.ym === "2024-08") { const y = inv[i + 1]; backs.push(line(EV, addDays(y.d, 5), "OSKO FROM N HADDAD CARE FEES", x.c + y.c, { third: true })); i += 1; } else backs.push(line(EV, addDays(x.d, 5), "OSKO FROM N HADDAD CARE FEES", x.c, { third: true }));
  }
  const both = backs.find((b, i) => inv.findIndex((x) => x.ym === "2024-08") >= 0 && b.cents > 500000);
  trap("T3-CARE-FEES", "Fees paid for a parent, and paid back, under a surname a member shares", `${EV}: ${inv.length} debits to the aged-care home, ${backs.length} credits from her, one of them two months at once on ${both.date}. Setup says the home's contract is PASS-THROUGH`, "Neither spending nor income. The home's contract says so at onboarding; her repayments are the other side.",
    { kind: "lines", lines: [plain(inv[1].o, "neither"), plain(inv[5].o, "neither"), plain(backs[1], "neither"), plain(both, "neither")] }, { fresh: true, dc: true });
  // she dies in January 2025. The estate pays through a solicitor's trust account, in pieces, and one piece holds her brother's share too
  const e1 = earn(EV, "2025-07-18", "HARGRAVES LEGAL TRUST ACCOUNT ESTATE N HADDAD", 8500000, "GIFT-IN"), e2 = earn(EV, "2025-10-02", "HARGRAVES LEGAL TRUST ACCOUNT ESTATE N HADDAD", 12000000, "GIFT-IN", { part: 6000000 }), e3 = earn(EV, "2026-02-11", "HARGRAVES LEGAL TRUST ACCOUNT ESTATE N HADDAD", 3148216, "GIFT-IN");
  const t = line(EV, "2025-10-03", "OSKO TO T HADDAD ESTATE SHARE", -6000000, { third: true }); count("estate_distribution", 3);
  trap("T3-ESTATE", "An inheritance in pieces from a solicitor's trust account", `${EV}: ${money(e1.cents)}, ${money(e2.cents)}, ${money(e3.cents)}, "HARGRAVES LEGAL TRUST ACCOUNT ESTATE N HADDAD"`, "Income under GIFT-IN, SPEC's public category, in the cash lens. Not a trust distribution with a tax statement to chase, not rent from an agent. A person can only tell it apart by saying so, so a question counts as flagged.",
    { kind: "lines", lines: [plain(e1, "income"), plain(e3, "income")] }, { fresh: true });
  trap("T3-BROTHER-SHARE", "One estate credit holding a third party's share, passed on next day", `${EV} ${e2.date} ${money(e2.cents)}, half of it Tariq's, ${money(-t.cents)} out to him ${t.date}`, "Income is 60,000.00, not 120,000.00, and 60,000.00 is not spending.",
    { kind: "lines", lines: [plain(t, "neither")] }, { fresh: true, dc: true });
}

// ---------- the UK ----------
function ukMoney() {
  // a wire home from the sterling account eleven days after a share sale of a similar size
  const out = line(UK, "2024-02-16", "TRANSFER TO AUSTRALIA", -600000, { xfer: true, aud: toAud(-600000, "2024-02-16") }), inn = line(EV, "2024-02-20", "INTL WIRE GBP 6000.00 ALBION BS", toAud(600000, "2024-02-16") - 2500, { xfer: true });
  B.transit.push({ from: out.date, until: inn.date, cents: inn.cents });
  const sale = SHARES.trades[0];
  trap("T3-WIRE-NOT-SALE", "A wire that is not a sale's proceeds", `${EV} ${inn.date}: ${money(inn.cents)} from his sterling account, eight days after ${sale.units} TNW were sold for ${money(sale.total)} at the broker`, "His own money moving, neither income nor spending, and no sale is cleared by it. The broker's own cash line clears the sale.",
    { kind: "lines", lines: [plain(inn, "neither")], settle: [{ account: `clearing:settle:${BK}`, month: "2024-02", want: 0 }, { account: `clearing:settle:${EV}`, month: "2024-02", want: 0 }] }, { fresh: true, dc: true });
  // money sent over for a trip, spent there in sterling
  const send = line(EV, "2024-08-27", "INTL TT TO ALBION BS GBP 3000.00", -(toAud(300000, "2024-08-27") + 2200), { xfer: true }), got = line(UK, "2024-08-29", "TRANSFER FROM AUSTRALIA", 300000, { xfer: true, aud: toAud(300000, "2024-08-29") });
  B.transit.push({ from: send.date, until: got.date, cents: -send.cents });
  trap("T3-UK-XFER", "A transfer in one currency to a foreign account", `${EV} ${send.date}: ${money(-send.cents)} leaves in Australian dollars; ${UK} takes 3,000.00 in sterling two days later`, "Own money, not spending. The two sides cannot agree to the cent in any one currency, so the pair needs the rate or a question.",
    { kind: "lines", lines: [plain(send, "neither")] }, { fresh: true, dc: true });
  const r = rng("uk");
  const places = [["WHITBY HARBOUR GUESTHOUSE", 62000], ["YORK STATION BRASSERIE", 8640], ["DALES WALKING HOTEL", 91800], ["NORTH YORK MOORS RAIL", 7400], ["ALBION PLATFORM COFFEE", 1260], ["HARROGATE LINEN", 18240], ["SKIPTON MARKET", 3120], ["LEEDS AIRPORT TRANSFER", 6450]];
  places.forEach(([n, p], i) => { const d = addDays(TRIP_FROM, 2 + i * 2 + r.int(0, 1)); line(UK, d, `CARD ${n}`, -p, { lens: "spending", cat: "HOLIDAYS", aud: -toAud(p, d) }); });
  for (const d of ["2024-04-06", "2025-04-07", "2026-04-07"]) { const c = 15880 + Number(d.slice(3, 4)) * 110; line(UK, d, "GROSS INTEREST", c, { lens: "income", cat: "INTEREST", aud: toAud(c, d) }); }
  trap("T3-UK-BALANCE", "A sterling account whose file reads clean as dollars", `${UK}: a file with the same five columns as a public Australian recipe, in pounds, and account currency GBP in setup. No rate is on any file`, "Net worth holds it in Australian dollars at the month-end rate. A balance of 8,000 pounds shown as A$8,000.00 is wrong by half and looks perfect. With no rate on file, the honest answer is to say the number cannot be converted.",
    { kind: "lines", balances: [{ account: UK, months: ["2023-12", "2024-12", "2026-06"] }] }, { fresh: true, dc: true });
}

// ---------- downsizing: a unit bought on a bridging loan, the home sold after, a contribution ----------
const CAPITAL = { price: 64000000, duty: 3272000, legal: 185000, adjust: 118640, loan: 61000000, deposit: 3200000, sale: 118000000, commission: 1888000, marketing: 290000, saleLegal: 165000 };
CAPITAL.cost = CAPITAL.price + CAPITAL.duty + CAPITAL.legal + CAPITAL.adjust; CAPITAL.cash = CAPITAL.cost - CAPITAL.loan;
const RATE_BRIDGE = "6.85";
function downsizing() {
  // a holding deposit on a place they lost, refunded through an agent's trust account
  const hold = line(EV, "2024-08-19", "TFR TO CASTLEMAINE REALTY TRUST HOLDING DEP", -500000, { lens: "spending", cat: "HOME-MAINT" }), back = line(EV, "2024-09-03", "CASTLEMAINE REALTY TRUST DEPOSIT REFUND", 500000, { lens: "spending", cat: "HOME-MAINT" });
  trap("T3-AGENT-LIKE", "An agent-like description that is not an agent", `${EV} ${back.date}: 5,000.00 from "CASTLEMAINE REALTY TRUST", a holding deposit coming back. They do own a let property, under a different agent`, "A refund of what they paid. Not rent, not an owner disbursement.",
    { kind: "lines", lines: [plain(hold, "spending"), plain(back, "spending")] }, { fresh: true, dc: true });
  // the money to complete
  own(SV, "2024-11-12", "TFR TO BARK EVERYDAY", EV, "2024-11-12", "TFR FROM WATTLE SAVER", 3300000);
  const dep = line(EV, "2024-11-15", "TFR TO LODDON CONVEYANCING TRUST DEPOSIT UNIT 4", -CAPITAL.deposit, { capital: true });
  const lump = line(EV, "2025-02-07", "HESTABBY LUMP SUM 7741", 3000000, { capital: true }); PENS.fund.push({ date: lump.date, code: "COMMUT", label: "Commutation to a lump sum", cents: -3000000 });
  own(SV, "2025-02-10", "TFR TO BARK EVERYDAY", EV, "2025-02-10", "TFR FROM WATTLE SAVER", 500000);
  const bal = line(EV, BUY, "TFR TO LODDON CONVEYANCING TRUST SETTLEMENT", -(CAPITAL.cash - CAPITAL.deposit), { capital: true });
  trap("T3-COMMUTATION", "A lump sum out of the pension account", `${EV} ${lump.date}: ${money(lump.cents)}, the same fund and the same reference as the monthly pension`, "Capital, not income. Net worth does not move. If a rule for the fund's name calls it SUPER-PENSION, income is out by all of it.",
    { kind: "lines", lines: [plain(lump, "neither")] }, { fresh: true, dc: true });
  trap("T3-SETTLEMENT", "A purchase settled by a deposit, a balance and a bridging loan", `${EV}: ${money(CAPITAL.deposit)} on ${dep.date} and ${money(-bal.cents)} on ${bal.date}; the statement shows cash paid ${money(CAPITAL.cash)} and ${money(CAPITAL.loan)} of loan funds`, "Capital, neither spending. The two payments clear the one statement, the unit opens at cost, and the loan opens at the draw.",
    { kind: "lines", lines: [plain(dep, "neither"), plain(bal, "neither")], balances: [{ account: UN, months: ["2025-02", "2025-03"] }] });
  // after the sale: the fund and the saver
  const [dn, dnIn] = own(EV, "2025-06-17", "TFR TO WHITLOCK HADDAD SF DOWNSIZER", SB, "2025-06-17", "TFR FROM HARBOUR DOWNSIZER", 30000000);
  own(EV, "2025-06-03", "TFR TO WATTLE SAVER", SV, "2025-06-03", "TFR FROM HARBOUR", 15000000);
  trap("T3-DOWNSIZER", "A downsizer contribution to their own fund", `${EV} to ${SB}, ${money(-dn.cents)} on ${dn.date}`, "Own money, neither income nor spending. Net worth does not move, whichever group it lands in.",
    { kind: "lines", lines: [plain(dn, "neither"), plain(dnIn, "neither")] }, { fresh: true, dc: true });
  // the second car goes to the garage that services it
  const car = line(EV, CAR_SOLD, "MOUNT ALEXANDER MOTORS", 950000, { capital: true });
  trap("T3-CAR-DEALER", "A credit from a merchant the household once paid that is not a refund", `${EV} ${car.date}: 9,500.00 from the garage, for the second car. Three service bills went the other way`, "SPEC 6.5 calls a credit a refund only from someone the household has paid, or if it says so, and here it would be wrong: spending must not fall by 9,500.00. The car leaves net worth.",
    { kind: "lines", lines: [plain(car, "neither")], zero_after: { account: CAR, from: "2025-08" } }, { fresh: true, dc: true });
}
/* The bridging loan charges interest on the balance less the saver, an offset the household never mentioned, and capitalises it. No repayment until the sale. */
function bridge() {
  const svBy = {}; { let b = OPEN[SV]; const ls = B.lines.filter((x) => x.acct === SV).sort(byTime); let i = 0; for (let d = START; d <= END; d = addDays(d, 1)) { while (i < ls.length && ls[i].date <= d) { b += ls[i].cents; i += 1; } svBy[d] = b; } }
  let bal = -CAPITAL.loan, accrued = 0; const rows = [];
  for (const ym of monthRange("2025-02", "2025-05")) {
    const open = bal; let d = ym === "2025-02" ? BUY : `${ym}-01`; const last = ym === "2025-05" ? SOLD : monthEnd(ym);
    for (; d <= last; d = addDays(d, 1)) accrued += Math.max(0, -bal - svBy[d]) * Number(RATE_BRIDGE) / 100 / 365;
    const i = Math.round(accrued); accrued = 0; bal -= i; let paid = 0;
    if (ym === "2025-05") { paid = -bal; bal = 0; }
    rows.push({ ym, rate: RATE_BRIDGE, open, interest: i, paid, close: bal, offset: null });
  }
  LOANS.bridge = rows; LOANS.payout = rows[rows.length - 1].paid;
  CAPITAL.net = CAPITAL.sale - CAPITAL.commission - CAPITAL.marketing - CAPITAL.saleLegal - LOANS.payout;
  const p = line(EV, SOLD, "LODDON CONVEYANCING TRUST SALE PROCEEDS", CAPITAL.net, { capital: true });
  trap("T3-HOME-SALE", "A home sold, with a vendor's statement no public recipe reads", `${HO} sold ${SOLD} for ${money(CAPITAL.sale)}. The bridging loan and the costs come out at the table; ${money(CAPITAL.net)} reaches ${EV}. Setup gives the date it was disposed of`, "The home leaves net worth the day the proceeds arrive. The credit is neither income nor a refund. If both stay, net worth holds the house twice.",
    { kind: "lines", lines: [plain(p, "neither")], zero_after: { account: HO, from: "2025-05" } }, { fresh: true, dc: true });
  trap("T3-BRIDGE", "A bridging loan repaid at the table, with no bank line", `${BR}: drawn ${money(CAPITAL.loan)} at the purchase, interest capitalised monthly, ${money(LOANS.payout)} paid from the sale`, "The loan ends at the lender's zero. No repayment reaches spending, and the capitalised interest counts only in the economic lens.",
    { kind: "lines", clearing: "clearing:loan:ACC-BRIDGE", zero_after: { account: BR, from: "2025-05" }, balances: [{ account: BR, months: ["2025-02", "2025-03", "2025-04"] }] }, { fresh: true, dc: true });
  trap("T3-OFFSET-NOT-LINKED", "A loan offset the household never declared", `${BR}: interest is charged net of ${SV}, and setup has no offsets link, because nobody said`, "L6 cannot pass: interest charged falls short of the rate on the full balance. The gap in front of a person is the right answer.",
    { kind: "law", law: "L6", scope: "CON-BRIDGE" }, { fresh: true });
}

// ---------- lines the bank gets wrong, and lines that look like each other ----------
function lineTraps() {
  const r = rng("traps");
  // a plumber with the household's surname, and a cousin's gift the next day
  const a = spend(EV, "2024-10-14", "BPAY WHITLOCK PLUMBING 88213", 145000, "HOME-MAINT"), b = earn(SV, "2024-10-15", "OSKO FROM H WHITLOCK BIRTHDAY", 145000, "GIFT-IN"); count("purchase");
  trap("T3-MERCHANT-NAME", "A merchant with a member's surname, and a relative's gift of the same amount next day", `${EV} ${a.date} -1,450.00 to Whitlock Plumbing; ${SV} ${b.date} +1,450.00 from a cousin`, "One is spending and one is income. A member's name in both lines does not make them a transfer. If they pair, 1,450.00 of each vanishes.",
    { kind: "lines", lines: [plain(a, "spending"), plain(b, "income")] }, { fresh: true, dc: true });
  // one club, a subscription and a win, same amount, a day apart, on two accounts
  const c = spend(EV, "2024-04-08", "EFT TO CASTLEMAINE BOWLS CLUB SUBS", 18000, "DONATION"), d = earn(SV, "2024-04-09", "EFT FROM CASTLEMAINE BOWLS CLUB WINNINGS", 18000, "GIFT-IN"); count("purchase");
  trap("T3-SHARED-WORD", "Two unrelated lines that share a transfer word, a counterparty and an amount", `${EV} ${c.date} -180.00 subscription; ${SV} ${d.date} +180.00 tournament winnings`, "Spending and income. The word EFT and the club's name are what they share; neither makes a transfer.",
    { kind: "lines", lines: [plain(c, "spending"), plain(d, "income")] }, { fresh: true, dc: true });
  // a chargeback the merchant wins
  const ch = card(r, "2024-03-05", ["CANOPY OUTDOOR", "ONLINE"], 38900, "SHOPPING", SALMA, { lag: 1 }), cb = line(CC, "2024-03-12", "CHARGEBACK CANOPY OUTDOOR ONLINE", 38900, { posted: "2024-03-12", csv: "CHARGEBACK CANOPY OUTDOOR ONLINE", member: SALMA, lens: "spending", cat: "SHOPPING" }), re = card(r, "2024-03-14", ["CANOPY OUTDOOR", "ONLINE"], 38900, "SHOPPING", SALMA, { lag: 1 }); count("purchase", 2);
  trap("T3-CHARGEBACK", "A chargeback and then a re-charge", `${CC}: -389.00 on ${ch.date}, +389.00 chargeback on ${cb.date}, -389.00 again on ${re.date}, all within nine days`, "389.00 of spending, once, net. The two charges are not a duplicate, and the credit is not income.",
    { kind: "lines", lines: [plain(ch, "spending", { n: 1 }), plain(cb, "spending"), plain(re, "spending", { n: 1 })] }, { fresh: true, dc: true });
  // a reversal and a re-post on different days, on the new bank
  const r1 = spend(EV, "2025-08-11", "BPAY CASTLEMAINE FLOORING 4471", 61240, "HOME-MAINT"), r2 = line(EV, "2025-08-13", "REVERSAL BPAY CASTLEMAINE FLOORING 4471", 61240, { lens: "spending", cat: "HOME-MAINT" }), r3 = spend(EV, "2025-08-18", "BPAY CASTLEMAINE FLOORING 4471", 61240, "HOME-MAINT"); count("purchase", 2);
  trap("T3-REVERSAL", "A payment reversed and posted again on different days", `${EV}: -612.40 ${r1.date}, +612.40 reversal ${r2.date}, -612.40 ${r3.date}`, "612.40 of spending, once, net. The re-post is not a duplicate and the reversal is not unexplained money.",
    { kind: "lines", lines: [plain(r1, "spending"), plain(r2, "spending"), plain(r3, "spending")] }, { fresh: true, dc: true });
  // the bank debits the health premium twice and corrects it
  const dbl = spend(EV, "2025-11-07", "DIRECT DEBIT BUPAW HEALTH 7712", 50845, "HEALTH"), fix_ = line(EV, "2025-11-10", "CORRECTION OF ERROR 07/11 DIRECT DEBIT", 50845, { lens: "spending", cat: "HEALTH" }); count("purchase");
  trap("T3-CORRECTION", "A statement with a correction line", `${EV} 2025-11-07: the premium twice, the bank's own error; +508.45 "CORRECTION OF ERROR" on ${fix_.date}`, "One premium, net. The correction names no payee and is not income or a transfer.",
    { kind: "lines", lines: [{ account: EV, date: dbl.date, cents: -50845, want: "spending", n: 2 }, plain(fix_, "spending")] }, { fresh: true, dc: true });
  // fraud on the card, reversed, and the card replaced
  const fr = card(r, "2025-01-16", ["GADGET WORLD", "LAGOS"], 128400, "SHOPPING", GEOFF, { lag: 1 }), fb = line(CC, "2025-01-21", "FRAUD CLAIM CREDIT GADGET WORLD", 128400, { posted: "2025-01-21", csv: "FRAUD CLAIM CREDIT GADGET WORLD", member: GEOFF, lens: "spending", cat: "SHOPPING" });
  trap("T3-CARD-REPLACED", "A card replaced after fraud, its number changing mid-statement", `${CC}: -1,284.00 fraud on ${fr.date}, the card number moves from ${NUM.card1} to ${NUM.card2} on ${CARD_NEW}, the credit lands ${fb.date}, on the new number`, "One account across both numbers. The charge and the credit net to nothing.",
    { kind: "lines", lines: [plain(fr, "spending", { n: 1 }), plain(fb, "spending")] }, { fresh: true, dc: true });
  // the trip home: a foreign charge repriced between authorisation and posting
  const auth = card(r, "2024-09-23", ["HARROGATE TEAROOMS", "UK"], 12240, "HOLIDAYS", SALMA, { posted: "2024-10-01", desc: "HARROGATE TEAROOMS UK GBP 62.00", csv: `${"HARROGATE TEAROOMS".padEnd(26)}UK  GBP 62.00`, extra: { authCents: 12118, authFile: "2024-07-01" } }); count("purchase");
  trap("T3-FX-REPRICE", "A foreign charge whose AUD changes between authorisation and posting", `${CC} ${auth.date}: the download cut 09-30 shows 121.18 pending; the next, which overlaps, shows 122.40 posted 10-01`, "One charge of 122.40.",
    { kind: "lines", lines: [plain(auth, "spending", { n: 1 })], absent: [{ account: CC, date: auth.date, cents: -12118 }] });
  const xm = card(r, "2024-12-23", ["WESLEY LINENS", "BENDIGO"], 27450, "SHOPPING", SALMA, { lag: 5 }), xn = card(r, "2025-12-22", ["BOOKS AND SLATE", "CASTLEMAINE"], 16820, "SHOPPING", GEOFF, { lag: 5 }); count("purchase", 2);
  trap("T3-HOLIDAY-LAG", "A charge that posts five business days later across Christmas and New Year", `${CC}: ${xm.date} posted ${xm.posted}, ${xn.date} posted ${xn.posted}`, "One purchase, in the month charged.",
    { kind: "lines", lines: [plain(xm, "spending", { n: 1, month: "2024-12" }), plain(xn, "spending", { n: 1, month: "2025-12" })] });
}

// ---------- tax: a franking refund, with no wage and no PAYG ----------
const TAX = { notices: [] };
function scale(fy, ti) {
  const b = fy <= 2024 ? [[18200, 0], [45000, 0.19], [120000, 0.325], [180000, 0.37], [1e12, 0.45]] : [[18200, 0], [45000, 0.16], [135000, 0.30], [190000, 0.37], [1e12, 0.45]];
  let tax = 0, lo = 0; const inc = ti / 100;
  for (const [hi, r] of b) { if (inc > lo) tax += (Math.min(inc, hi) - lo) * r; lo = hi; }
  return Math.round(tax * 100);
}
function taxes() {
  const lines = [];
  for (const [fy, lodged, assessed, refundOn] of [[2024, "2024-08-13", "2024-08-27", "2024-08-30"], [2025, "2025-08-12", "2025-08-26", "2025-08-29"]]) {
    const ds = SHARES.divs.filter((v) => !v.fund && fyOf(v.pay) === fy), credit = ds.reduce((t, v) => t + v.credit, 0), ti = Math.floor(ds.reduce((t, v) => t + v.net + v.credit, 0) / 100) * 100;
    const n = { person: SALMA, fy, lodged, assessed, refundOn, ti, payg: 0, help: 0, other: credit, gross: scale(fy, ti), medicare: 0, offsets: 0 };
    n.result = n.other - n.gross; TAX.notices.push(n); count("tax_assessment");
    lines.push(line(EV, refundOn, `ATO EFT REFUND 66204${String(fy).slice(2)}`, n.result, { refund: true })); count("tax_refund");
  }
  trap("T3-FRANKING-REFUND", "A tax refund with no wage behind it", lines.map((x) => `${EV} ${x.date} ${money(x.cents)}`).join("; "), "Neither income nor spending: TAX-REFUND is a transfer with the tax position, and the credit behind it is a franking credit, SPEC 9.",
    { kind: "lines", lines: lines.map((x) => plain(x, "neither")) }, { fresh: true });
}

const EV_QIF = [["2023-07-01", "2023-09-30"], ["2023-10-01", "2023-12-31"], ["2024-01-01", "2024-03-31"], ["2024-04-01", "2024-06-30"], ["2024-07-01", "2024-08-04"], ["2024-08-13", "2024-11-30"], ["2024-12-01", "2025-03-21"]];
const EV_CSV = [["2025-03-11", "2025-06-30"], ["2025-07-01", "2025-09-30"], ["2025-10-01", "2025-12-31"], ["2026-01-01", "2026-03-31"], ["2026-04-01", "2026-06-30"]];
const STATEMENT_MISSING = "2024-12-21";
/* traps that live in how the files were downloaded, not in the money */
function fileTraps() {
  const over = B.lines.filter((x) => x.acct === EV && x.date >= "2025-03-11" && x.date <= "2025-03-21").sort(byTime), seen = new Set(), uniq = over.filter((x) => { const k = `${x.date}|${x.cents}`; if (seen.has(k)) return false; seen.add(k); return !over.some((y) => y !== x && y.date === x.date && y.cents === x.cents); });
  trap("T3-MERGER", "A bank merger: a new account number and a new file format, overlapping, on one account", `${EV}: Bark QIF to 2025-03-21, no number and no running balance; Harbour CSV from 2025-03-11, a new number from ${MERGER} and the same lines reworded (BPAY becomes BILL PAYMENT); ${over.length} lines in both, and a number whose alias starts after the file does`, "One account, one line each, two witnesses, and the balance chain carries across.",
    { kind: "lines", lines: uniq.slice(0, 6).map((x) => plain(x, x.lens || "neither", { n: 1 })), balances: [{ account: EV, months: ["2025-03", "2025-04", "2025-05"] }] });
  const hole = B.lines.filter((x) => x.acct === EV && x.date >= "2024-08-05" && x.date <= "2024-08-12");
  trap("T3-QIF-HOLE", "Eight days of bank lines nobody downloaded, in a format with no running balance", `${EV}: no QIF holds 2024-08-05 to 2024-08-12, ${hole.length} lines worth ${money(hole.reduce((t, x) => t + x.cents, 0))}. Each file's opening record is honest`, "The engine cannot know the lines. It must say the opening does not chain, for that account and those dates.",
    { kind: "hole", account: EV, month: "2024-08", net_cents: hole.reduce((t, x) => t + x.cents, 0), line_count: hole.length, match: /2024-0[89]/.source });
  trap("T3-DORMANT", "A period with no activity: quarters of files with nothing in them", `${OD}: a passbook with one interest line a year, and quarterly files that hold a header and no rows`, "No gap, no zero. The balance carries through the empty quarters at the last figure.",
    { kind: "coverage_clean", stream: OD, balances: [{ account: OD, months: ["2023-09", "2024-03", "2024-12", "2025-03", "2026-03"] }] }, { fresh: true, dc: true });
  const lagged = B.lines.filter((x) => x.acct === CC && x.cents < 0 && x.posted && x.posted !== x.date), lagDays = {};
  for (const x of lagged) { const d = dayDiff(x.date, x.posted); lagDays[d] = (lagDays[d] || 0) + 1; }
  trap("T3-POSTING-LAG", "Every card line in two files, dated differently, for two card members", `${CC}: ${lagged.length} lines post after they are charged, by ${Object.entries(lagDays).map(([d, n]) => `${d} days (${n})`).join(", ")}. The monthly statement, cut on the 21st, shows the charge date; the quarterly activity file the posting date`, "One purchase, two witnesses, whatever the gap. A line the engine cannot match across files is asked about, not counted twice in silence.",
    { kind: "card_lag", account: CC, lagged: lagged.length, by_days: lagDays });
  const cross = B.lines.filter((x) => x.acct === CC && x.lens === "spending" && x.date >= START && x.cents < 0 && x.posted && ymOf(x.posted) !== ymOf(x.date)).sort(byTime);
  trap("T3-DATE-BASIS", "A card charge dated in one month, posted in the next", `${CC}: ${cross.length} lines. Budgets read the charge date. Six sampled`, "SPEC 6.5: a purchase counts when charged, and it is one line.",
    { kind: "lines", lines: [0, 1, 2, 3, 4, 5].map((i) => cross[Math.floor(i * cross.length / 6)]).map((x) => plain(x, "spending", { n: 1, month: ymOf(x.date) })) });
  const f = B.lines.filter((x) => x.acct === CC && x.member === GEOFF && x.cents < 0 && x.date >= "2025-07-10" && x.date <= "2025-09-10").sort(byTime), pick = f.filter((x, i) => i % Math.floor(f.length / 4) === 0 && !B.lines.some((y) => y !== x && y.acct === CC && y.cents === x.cents)).slice(0, 4);
  trap("T3-CARD-LOGIN", "An activity download that shows only one card member", `${CC}: the quarterly file for 2025-07 to 2025-09 was downloaded from Salma's login, and holds only her lines. ${f.length} of Geoffrey's lines in those dates are on the statements alone`, "A filtered download is not a statement of what did not happen. SPEC 6.2 reads a side that covers a day and does not show a line as saying so; here that reading would delete real purchases.",
    { kind: "lines", lines: pick.map((x) => plain(x, "spending", { n: 1 })) }, { fresh: true, dc: true });
  trap("T3-STATEMENT-GAP", "A card statement never downloaded", `The statement closing ${STATEMENT_MISSING} is missing`, "The lines stay, on their posting dates. Coverage names the missing statement.",
    { kind: "gap", stream: "STM-CARD", month: STATEMENT_MISSING.slice(0, 7) });
  trap("T3-PENSION-UNREAD", "A pension account no public recipe can read", `${PN}: the fund's half-yearly JSON has the layout of a public recipe and carries a pension line type its map does not hold, so the file is refused. ${money(OPEN[PN])} at the start`, "The balance cannot be known. It must be named as not held, never shown as zero, because a printed zero is a claim, SPEC 4.4b and 5.4.",
    { kind: "lines", balances: [{ account: PN, months: ["2023-12", "2024-12", "2025-12", "2026-06"] }] }, { fresh: true, dc: true });
  trap("T3-SMSF-ONE-LEVEL", "The fund's accounts, whose legal owner is not a member", `${SB}, ${SK} and ${SS} are the fund's by law and Geoffrey's beneficially. Nothing else states the fund's balance`, "They count once in net worth, SPEC 6.6. A household holds what its members own, and they own this beneficially.",
    { kind: "lines", excluded: [{ group: "super", accounts: [SB, SK, SS, PN], named: SB, month: "2024-12", want: 0 }, { group: "super", accounts: [SB, SK, SS, PN], named: SB, month: "2026-06", want: 0 }], balances: [{ account: SB, months: ["2024-12", "2025-12"] }, { account: SS, months: ["2024-12", "2025-12"] }] }, { fresh: true, dc: true });
}
function leaverTrap(balances) {
  const ms = monthRange("2024-03", "2024-08"), excl = [...ms.map((m) => ({ group: "cash", accounts: "cash", named: FM, month: m, want: Math.floor(balances[FM][m] / 2), tolerance: 1 })), { group: "cash", accounts: "cash", named: FM, month: "2024-02", want: 0, tolerance: 0 }];
  trap("T3-LEAVER", "A joint owner leaves the household and stays on the account", `${FM}: half Karim's. He leaves ${LEAVES}; the account stays open and joint until ${FAM_CLOSE}. His half of ${money(balances[FM]["2024-03"])} leaves net worth while the balance does not move`, "A household holds what its members own on the day, SPEC 6.6, the mirror of a joiner. The account's balance stays whole and net worth takes half of it.",
    { kind: "lines", excluded: excl, balances: [{ account: FM, months: ["2024-03", "2024-08"] }], lines: [plain(CARE.karimOut, "neither", CARE.evenSplit ? { n: 2 } : {})] }, { fresh: true, dc: true });
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
    if (due <= END && close > 0) own(EV, due, `AMEWX DIRECT DEBIT ${cardNo(due)}`, CC, post, "PAYMENT RECEIVED - THANK YOU", close, { posted: post, csv: "PAYMENT RECEIVED - THANK YOU", member: SALMA });
    prev = close; start = addDays(end, 1);
  }
}
function interestCredits() {
  const run = (acct, pct, cat) => { let bal = OPEN[acct] || 0; for (const ym of MONTHS) { bal += B.lines.filter((x) => x.acct === acct && ymOf(x.date) === ym).reduce((t, x) => t + x.cents, 0); if (acct === FM && ym > ymOf(FAM_CLOSE)) continue; if (acct === FM && ym === ymOf(FAM_CLOSE)) continue; const i = Math.round(bal * pct / 12); if (cat) earn(acct, monthEnd(ym), "INTEREST CREDIT", i, cat); else line(acct, monthEnd(ym), "INTEREST CREDIT", i, {}); bal += i; count("interest_credit"); } };
  run(SV, 0.042, "INTEREST"); run(FM, 0.031, "INTEREST"); run(SB, 0.038, null);
  for (const d of ["2024-06-28", "2025-06-30", "2026-06-30"]) earn(OD, d, "INTEREST CREDIT", 1294 + Number(d.slice(2, 4)), "INTEREST");
  // the family saver is split on the last day, after the month's interest
  const bal = OPEN[FM] + B.lines.filter((x) => x.acct === FM).reduce((t, x) => t + x.cents, 0), i = Math.round(bal * 0.031 / 12), full = bal + i, [g, k] = CARE.fmClose(full); earn(FM, FAM_CLOSE, "INTEREST CREDIT", i, "INTEREST");
  own(FM, FAM_CLOSE, "TFR TO BARK EVERYDAY CLOSING", EV, FAM_CLOSE, "TFR FROM FAMILY SAVER CLOSING", g);
  CARE.karimOut = line(FM, FAM_CLOSE, "TFR TO K WHITLOCK SHARE OF SAVER", -k, { third: true }); CARE.evenSplit = g === k;
}
function pensionFund() {
  const r = rng("fund"); let bal = OPEN[PN]; const out = [], list = PENS.fund.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  for (const ym of MONTHS) {
    for (const x of list.filter((l) => ymOf(l.date) === ym)) { bal += x.cents; out.push({ ...x, balance: bal }); }
    const e = monthEnd(ym), earned = Math.round(bal * r.range(-0.008, 0.013)); bal += earned; out.push({ date: e, code: "EARN", label: "Investment earnings", cents: earned, balance: bal }); bal -= 4200; out.push({ date: e, code: "FEE", label: "Administration fee", cents: -4200, balance: bal });
  }
  PENS.lines = out; for (const x of out) line(PN, x.date, x.label, x.cents, { superType: x.code });
}

// ---------- truth, from the simulation alone ----------
const OPEN = { [EV]: 1984060, [SV]: 11800000, [FM]: 1600000, [OD]: 431277, [TA]: 6000000, [TB]: 4000000, [CC]: -214070, [BK]: 824190, [UK]: 1422018, [SB]: 10000000, [SK]: 1200000, [PN]: 16800000 };
const CAR_VALUE = 1400000;
const LOANS = { bridge: [], payout: 0 };
function chain(acct) { let bal = OPEN[acct] || 0; return B.lines.filter((x) => x.acct === acct).sort(acct === CC ? byPost : byTime).map((x) => { bal += x.cents; x.balance = bal; return x; }); }
const VALUES = { home: [], unit: [], port: [] };
function valuations() {
  const r = rng("valuations"); let h = 108000000, u = 66000000, l = 26000000;
  for (const m of monthRange("2023-06", "2026-06").filter((x) => ["03", "06", "09", "12"].includes(x.slice(5)))) {
    h = Math.round(h * (1 + r.range(-0.006, 0.016)) / 100000) * 100000; u = Math.round(u * (1 + r.range(-0.006, 0.013)) / 100000) * 100000; l = Math.round(l * (1 + r.range(-0.008, 0.016)) / 100000) * 100000;
    if (monthEnd(m) < SOLD) VALUES.home.push([monthEnd(m), h]);
    if (monthEnd(m) > BUY) VALUES.unit.push([monthEnd(m), u]);
    VALUES.port.push([monthEnd(m), l]);
  }
}
function truthBalances() {
  const acctsChain = [EV, SV, FM, OD, TA, TB, TC, TD, CC, BK, UK, SB, SK, PN, FL];
  const chains = {}; for (const a of acctsChain) chains[a] = chain(a);
  const assets = [...acctsChain, SH, SS, BR, HO, UN, LO, CAR];
  const balances = {}; for (const a of assets) balances[a] = {};
  const lastVal = (list, e) => { const v = list.filter(([d]) => d <= e); return v.length ? v[v.length - 1][1] : 0; };
  for (const m of MONTHS) {
    const e = monthEnd(m);
    for (const a of acctsChain) {
      const upTo = chains[a].filter((x) => (a === CC ? posted(x) : x.date) <= e), last = upTo[upTo.length - 1], b = last ? last.balance : OPEN[a] || 0;
      balances[a][m] = a === UK ? Math.round(b * GBP.fx[m] / 10000) : b;
    }
    balances[SH][m] = SHARES.her[m].reduce((t, h) => t + h.value, 0);
    balances[SS][m] = SHARES.fund[m].reduce((t, h) => t + h.value, 0);
    { const r = LOANS.bridge.find((x) => x.ym === m); balances[BR][m] = r ? r.close : 0; }
    balances[HO][m] = e < SOLD ? lastVal(VALUES.home, e) : 0;
    { const v = VALUES.unit.filter(([d]) => d <= e); balances[UN][m] = e < BUY ? 0 : v.length ? v[v.length - 1][1] : CAPITAL.cost; }
    balances[LO][m] = lastVal(VALUES.port, e);
    balances[CAR][m] = e < CAR_SOLD ? CAR_VALUE : 0;
  }
  return { balances, chains, assets };
}
function truth(t) {
  const { balances, chains, assets } = t;
  const income = {}, spending = {}, byCat = {}, networth = {}, transit = {}, unreadable = {}, foreign_totals = { income: 0, spending: 0 };
  for (const m of MONTHS) { income[m] = 0; spending[m] = 0; byCat[m] = {}; }
  for (const x of B.lines) if (x.acct === UK && x.lens && ymOf(x.date) in income) { if (x.lens === "income") foreign_totals.income += x.aud; else foreign_totals.spending -= x.aud; }
  for (const x of B.lines) {
    const m = ymOf(x.date); if (!(m in income) || !x.lens) continue;
    if (!CASH.includes(x.acct)) throw new Error(`lens on a non-cash account ${x.acct}`);
    const c = x.aud != null ? x.aud : x.part != null ? x.part : x.cents;
    if (x.lens === "income") income[m] += c; else { spending[m] -= c; byCat[m][x.cat] = (byCat[m][x.cat] || 0) - c; }
  }
  for (const m of MONTHS) {
    const e = monthEnd(m);
    transit[m] = B.transit.filter((x) => x.from <= e && x.until > e).reduce((s, x) => s + x.cents, 0);
    const karim = e >= LEAVES && e < FAM_CLOSE ? Math.floor(balances[FM][m] / 2) : 0;
    networth[m] = assets.reduce((s, a) => s + balances[a][m], 0) + transit[m] - karim;
    unreadable[m] = balances[PN][m];
  }
  return {
    household: "Haddad-Whitlock, fictional, Castlemaine VIC", window: [START, END],
    definitions: {
      income: "SPEC 6.5 cash lens: money into reporting-group cash accounts in categories of kind income with cash_lens true, on the day the bank shows it. Super pensions under SUPER-PENSION, Age and overseas pensions, interest, dividends at the net paid, rent at the net amount paid, gifts and inheritances. Interest on a term deposit counts on the deposit, the day it is credited, wherever it is then paid.",
      spending: "SPEC 6.5 cash lens: money out of cash accounts in expense categories with cash_lens true, net of refunds and Medicare. Card purchases on the charge date. Spending in sterling at the month's rate.",
      left_out: "Own transfers, card repayments, money to and from the broker, the fund, the sterling account and the deposits, tax refunds (TAX-REFUND, kind transfer), the purchase and the sale of the home (capital), the car, the return of capital, the commutation, the loan to Karim and its repayments, and everything of Nadia's and Tariq's that crosses the rails (SPEC 4.4c).",
      balances: "Month-end, holder's sign, on the posting date. Sterling at the month's rate. Holdings at the true month-end market value, whether or not the file was downloaded. Property at the latest valuation, a purchase at cost until its first. The pension account at its true balance, read or not.",
      networth: "Sum of the accounts the household declared, each at what members own that day: half of the family saver between Karim leaving and the saver closing. Plus money in the air between own accounts and trades between trade and settlement. Tax position excluded. The fund's accounts count once, at their own balances: they are the fund, and nothing else states it.",
      one_charge: "A charge in two files is one charge. The statement's amount is the charge where the two disagree, because the statement closes on it.",
    },
    balances, income, spending, spending_by_category: byCat, networth, in_transit: transit, unreadable_account: { account: PN, balance: unreadable },
    counts: B.counts, lines_by_account: Object.fromEntries(Object.entries(chains).map(([a, l]) => [a, l.length])), foreign_accounts: [UK], foreign_totals,
    cash_lines: B.lines.filter((x) => CASH.includes(x.acct) && x.acct !== UK).sort(byTime).map((x) => ({ account: x.acct, date: x.date, ...(x.posted && x.posted !== x.date ? { posted: x.posted } : {}), cents: x.cents, what: x.desc, lens: x.lens || "neither", ...(x.cat ? { category: x.cat } : {}), ...(x.xfer ? { own: true } : {}), ...(x.part != null ? { part: x.part } : {}) })),
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
  westpaw: { name: "Westpaw", tagline: "Banking with a wag", color: "#B4231F" },
  amewx: { name: "Amewx", tagline: "Don't leave home without your whiskers", color: "#1E5AA8" },
  cedar: { name: "Cedar Trade", tagline: "Deep roots, low brokerage", color: "#3C6E47" },
  computerpaw: { name: "Computerpaw" },
  myguv: { name: "myGuv", tagline: "Your tax, your paws", color: "#0B6E99" },
  purrsure: { name: "Purrsure", tagline: "Cover for the curious", color: "#C2410C" },
  council: { name: "Mt Alexander Council", tagline: "Rates and charges, one paw at a time", color: "#2E7D6B" },
  water: { name: "Coliban Reach Water" },
  meow: { name: "PropertyMeow", tagline: "Your rental, looked after", color: "#8A5A00" },
  conveyancer: { name: "Loddon Conveyancing" },
  hest: { name: "HESTAbby" },
  smsf: { name: "Bendigo Accountants" },
};
const span = (a, b) => `${fmtDate(a)} to ${fmtDate(b)}`;
const R = (label, w = 2) => ({ label, w, align: "right" });
const Lft = (label, w = 2) => ({ label, w });

function pdfLoan(s) {
  const rows = s.rows, t = (k) => rows.reduce((a, r) => a + r[k], 0);
  const d = new Doc({ brand: BR_.westpaw, title: "Bridging loan statement", kicker: span(s.from, s.to), deflate });
  d.h1("Bridging loan statement");
  d.kv([["Loan number", NUM.bridge], ["Product", "Bridging, interest capitalised"], ["Borrowers", "S Haddad and G Whitlock"], ["Repayments", "At sale"], ["Opening balance", money(-rows[0].open)], ["Interest charged", money(t("interest"))], ["Repayments received", money(t("paid"))], ["Closing balance", money(-rows[rows.length - 1].close)]], 4);
  d.h2("Month by month");
  d.table([Lft("Month", 2), R("Rate", 1), R("Opening"), R("Interest"), R("Repayments"), R("Closing")], rows.map((r) => [`${MON[Number(r.ym.slice(5)) - 1]} ${r.ym.slice(0, 4)}`, `${r.rate}%`, money(-r.open), money(r.interest), money(r.paid), money(-r.close)]), { foot: ["Total", "", "", money(t("interest")), money(t("paid")), ""] });
  return d.finish();
}
function pdfCard(s) {
  const d = new Doc({ brand: BR_.amewx, title: "Card statement", kicker: span(s.start, s.end), deflate });
  d.h1("Your card statement");
  d.kv([["Account", cardFull(s.end)], ["Card member", SALMA], ["Previous balance", money(s.prev)], ["Payments and credits", money(s.credits)], ["New charges", money(s.charges)], ["New balance", money(s.close)]], 3);
  d.h2("Transactions");
  d.table([Lft("Date", 2), Lft("Description", 8), R("Amount", 2)], s.lines.map((x) => [fmtDate(x.date), x.desc, money(-x.cents)]), { foot: ["New balance", "", money(s.close)] });
  return d.finish();
}
function pdfContractNote(t) {
  const d = new Doc({ brand: BR_.cedar, title: "Contract note", kicker: "Contract note", deflate });
  d.h1(`${t.side === "buy" ? "Bought" : "Sold"} ${t.units} ${t.code} at ${t.price}`);
  d.kv([["Account", t.num], ["Security code", t.code], ["Security", t.name], ["Trade date", fmtDate(t.d)], ["Settlement date", fmtDate(t.settle)], ["Reference", t.ref]], 3);
  d.h2("Trade details");
  d.table([Lft("Item", 6), R("Amount")], [["Quantity", String(t.units)], ["Price", t.price], ["Consideration", money(t.gross)], ["Brokerage", money(t.brokerage)], [t.side === "buy" ? "Total payable" : "Net proceeds", money(t.total)]]);
  return d.finish();
}
function pdfDividend(v) {
  const d = new Doc({ brand: BR_.computerpaw, style: "plain", title: "Dividend", kicker: v.name, deflate });
  d.h1(`${v.final ? "Final" : "Interim"} dividend`);
  d.kv([["Holder number", v.hin], ["Security code", v.code], ["Shares held", String(v.units)], ["Rate per share", (v.ps / 100).toFixed(4)], ["Payment date", fmtDate(v.pay)], ["Franked percent", String(Math.round(v.franked / v.net * 100))]], 3);
  d.h2("Payment");
  d.table([Lft("Item", 6), R("Amount")], [["Franked amount", money(v.franked)], ["Unfranked amount", money(v.unfranked)], ["Franking credit", money(v.credit)], ["Net payment", money(v.net)]]);
  return d.finish();
}
function meowTable(d, rows) {
  const X = [48, 104, 266, 436, 492, 500], put_ = (y, cells, bold) => cells.forEach((c, i) => { if (c) d.text(X[i], y, c, { size: 8.5, bold, align: i === 3 || i === 4 ? "right" : undefined }); });
  put_(d.y, ["Date", "Description", "Rental schedule", "Money in", "Money out", "By"], true); d.y -= 15;
  for (const r of rows) { put_(d.y, r, false); d.y -= 15; }
  d.y -= 6;
}
function pdfOwner(s) {
  const d = new Doc({ brand: BR_.meow, title: "Owner statement", kicker: span(s.from, s.to), deflate });
  d.h1("Owner statement");
  d.kv([["Owner reference", NUM.owner], ["Property", PORT.split(",")[0]], ["Tenant", "Short stays"], ["Rent collected", money(s.gross)], ["Management fees", money(s.fees)], ["Paid to owner", money(s.disbursed)]], 3);
  d.text(MARGIN, d.y, "Rent and costs", { size: 12, bold: true }); d.text(d.W - MARGIN, d.y, "Amounts in Australian dollars", { size: 8, align: "right" }); d.y -= 22;
  meowTable(d, [...s.rows.map((x) => [fmtDate(x.date), "Stay received", "Rent", money(x.amt), "", "Guest"]), [fmtDate(s.to), "Letting fee", "Property agent fees", "", money(s.fees), "Portland Bay Holiday Lets"]]);
  d.para(`Rent is paid to the owner by ${fmtDate(s.paid)}.`);
  return d.finish();
}
function pdfBare(brand, title, lines) {
  const d = new Doc({ brand, style: "plain", title, kicker: title, deflate });
  d.h1(title);
  for (const l of lines) d.para(l);
  return d.finish();
}
function pdfSettlement() {
  const d = new Doc({ brand: BR_.conveyancer, style: "plain", title: "Settlement statement", deflate });
  d.h1(`Settlement statement, ${UNIT.split(",").slice(0, 2).join(",")}`);
  d.kv([["Property reference", UNIT], ["Purchaser", "S Haddad and G Whitlock"], ["Settlement date", fmtDate(BUY)], ["Matter", "LC-25-0417"]], 2);
  d.h2("Statement");
  d.table([Lft("Item", 6), R("Amount")], [["Purchase price", money(CAPITAL.price)], ["Land transfer duty", money(CAPITAL.duty)], ["Legal and conveyancing", money(CAPITAL.legal)], ["Adjustments at settlement", money(CAPITAL.adjust)], ["Loan funds drawn", `-${money(CAPITAL.loan)}`], ["Cash paid by purchaser", money(CAPITAL.cash)]]);
  d.para(`Loan funds came from Westpaw loan number ${NUM.bridge}.`);
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
function pdfRates(b) {
  const d = new Doc({ brand: BR_.council, title: "Rates", kicker: "Notice under the Local Government Act", deflate });
  d.h1("Your rates instalment");
  d.kv([["Assessment number", "MA-7714420"], ["Property", b.situ.split(",")[0]], ["Issue date", fmtDate(b.billDate)], ["Due date", fmtDate(b.due)], ["Rating period", span(b.from, b.to)], ["Instalment due", money(b.amt)]], 3);
  d.para(`Instalment notice ${b.reference}`);
  return d.finish();
}
function pdfWater(b) {
  const d = new Doc({ brand: BR_.water, style: "plain", title: "Water bill", deflate });
  d.text(MARGIN, d.y, "Your water bill", { size: 14, bold: true }); d.text(d.W - MARGIN, d.y, `Quarter to ${fmtDate(b.to)}`, { size: 9, align: "right" }); d.y -= 26;
  const rows = [["Account", "CR-60227104", "Water usage", money(b.usage)], ["Property", b.situ.split(",")[0], "Service charges", money(b.service)], ["Bill date", fmtDate(b.billDate), "Concession", money(0)], ["Due date", fmtDate(b.due), "Amount due", money(b.amt)], ["Period from", fmtDate(b.from), "", ""], ["Period to", fmtDate(b.to), "", ""]];
  for (const r of rows) { d.text(MARGIN, d.y, r[0], { size: 9.5 }); d.text(MARGIN + 110, d.y, r[1], { size: 9.5, bold: true }); if (r[2]) { d.text(320, d.y, r[2], { size: 9.5 }); d.text(d.W - MARGIN, d.y, r[3], { size: 9.5, bold: true, align: "right" }); } d.y -= 18; }
  d.para("Thank you for paying on time.");
  d.text(MARGIN, d.y, "Pay by", { size: 9.5 }); d.text(MARGIN + 110, d.y, "BPAY biller 60227", { size: 9.5 });
  return d.finish();
}
function pdfPolicy(p) {
  const d = new Doc({ brand: BR_.purrsure, title: "Certificate", kicker: `${p.kind} cover`, deflate });
  d.h1("Certificate of currency");
  d.kv([["Policy number", p.number], ["Policy", p.kind], ["Situation", p.situ], ["Insured", SALMA], ["Period of insurance", span(p.from, p.to)], ["Premium paid", money(p.amt)]], 3);
  d.h2("Cover");
  d.table([Lft("Item", 6), R("Amount")], [["Building sum insured", money(p.sum)], ["Excess", money(p.excess)]]);
  return d.finish();
}
function emlEnergy(b) {
  const text = ["Your electricity bill is ready", "Goldline Power, a fictional retailer", "Hello Salma,", `Account: ${b.account}`, `Bill date: ${fmtDate(b.billDate)}`, `Due date: ${fmtDate(b.due)}`, `Supply from: ${fmtDate(b.from)}`, `Supply to: ${fmtDate(b.to)}`, `GST included: ${money(b.gst)}`, `Amount due: ${money(b.amt)}`, "Pay by BPAY, biller code 5512.", "Thanks for keeping the lights on."].join("\n");
  return eml({ from: "bills@goldline.example", to: "salma@haddad-whitlock.example", subject: "Your electricity bill is ready", date: b.billDate, id: `gl-${b.billDate}`, text, html: `<p>${text.split("\n").join("</p><p>")}</p>` });
}
function emlAction(a) {
  const text = a.lines.join("\n");
  return eml({ from: "notices@computerpaw.example", to: "salma@haddad-whitlock.example", subject: "Corporate action notice", date: a.date, id: `cp-${a.date}`, text, html: `<p>${text.split("\n").join("</p><p>")}</p>` });
}

function render() {
  const view = (acct, from, to) => { let bal = OPEN[acct] || 0; const seq = B.lines.filter((x) => x.acct === acct).slice().sort(byTime), out = []; for (const x of seq) { bal += x.cents; if (x.date >= from && x.date <= to) out.push({ ...x, balance: bal }); } return out; };
  const before = (acct, d) => (OPEN[acct] || 0) + B.lines.filter((x) => x.acct === acct && x.date < d).reduce((t, x) => t + x.cents, 0);
  const newStyle = (s) => s.replace(/^BPAY /, "BILL PAYMENT ").replace(/^TFR TO /, "FUNDS TRANSFER TO ").replace(/^TFR FROM /, "FUNDS TRANSFER FROM ").replace(/^OSKO FROM /, "NPP CREDIT ").replace(/^OSKO TO /, "NPP PAYMENT ").replace(/^DIRECT DEBIT /, "DD ").replace(/^EFTPOS /, "CARD PURCHASE ");
  const hbHead = ["Bank Account", "Date", "Narrative", "Debit Amount", "Credit Amount", "Balance", "Categories", "Serial"];
  const w5 = (x) => [dmy(x.date), x.desc, x.cents > 0 ? fix(x.cents) : "", x.cents < 0 ? fix(x.cents) : "", fix(x.balance)], head5 = ["Date", "Description", "Credit", "Debit", "Balance"];
  const bf5 = (from, bal) => [dmy(from), "BALANCE BROUGHT FORWARD", "0.00", "", fix(bal)];
  // the everyday account: Bark's QIF, with an opening record and no running balance, to the merger; then Harbour's CSV, overlapping, from a new number
  for (const [from, to] of EV_QIF) put(EV, addDays(to, 2), `bark_${from}.qif`, qif({ rows: view(EV, from, to).map((x) => ({ date: x.date, cents: x.cents, desc: x.desc })), opening: before(EV, from), from }));
  for (const [from, to] of EV_CSV) put(EV, addDays(to, 2), `Harbour_${from}_${to}.csv`, csvLines([hbHead, ...view(EV, from, to).map((x) => [NUM.harbour, dmy(x.date), x.date < "2025-03-22" ? newStyle(x.desc) : x.desc, x.cents < 0 ? fix(-x.cents) : "", x.cents > 0 ? fix(x.cents) : "", fix(x.balance), x.cents > 0 ? "DEP" : "PAYMENT", ""])]));
  // the saver: Wattle's OFX, quarterly
  for (const [from, to] of quarters("2023-07", "2026-06")) put(SV, addDays(to, 2), `Wattle_saver_${from}.ofx`, ofx({ account: NUM.saver, bankId: "633000", from, to, rows: view(SV, from, to).map((x) => ({ date: x.date, cents: x.cents, desc: x.desc })), closing: before(SV, addDays(to, 1)), asOf: to }));
  // the family saver: Bark's headerless CSV, newest first, quarterly, to its close
  for (const [from, to] of quarters("2023-07", "2024-09")) put(FM, addDays(to, 2), `bark_transactions_${from}.csv`, csvLines(view(FM, from, to).reverse().map((x) => [dmy(x.date), `${x.cents >= 0 ? "+" : "-"}${fix(Math.abs(x.cents))}`, x.desc, fix(x.balance)])));
  // the passbook: a brought-forward row to open, then quarters with nothing in them
  quarters("2023-07", "2026-06").forEach(([from, to], i) => { const rows = view(OD, from, to).map(w5); put(OD, addDays(to, 2), `Wattle_passbook_${from}.csv`, csvLines([head5, ...(i === 0 ? [bf5(from, OPEN[OD])] : []), ...rows])); });
  // term deposits: half-yearly statements with a brought-forward row. B is at the new bank's sister, Harbour's layout
  const half = [["2023-07-01", "2023-12-31"], ["2024-01-01", "2024-06-30"], ["2024-07-01", "2024-12-31"], ["2025-01-01", "2025-06-30"], ["2025-07-01", "2025-12-31"], ["2026-01-01", "2026-06-30"]];
  for (const [from, to] of half) {
    put(TA, addDays(to, 3), `Wattle_TD_A_${from}.csv`, csvLines([head5, bf5(from, before(TA, from)), ...view(TA, from, to).map(w5)]));
    put(TB, addDays(to, 3), `Harbour_TD_${from}.csv`, csvLines([hbHead, [NUM.tdb, dmy(from), "BALANCE BROUGHT FORWARD", "", "0.00", fix(before(TB, from)), "", ""], ...view(TB, from, to).map((x) => [NUM.tdb, dmy(x.date), x.desc, x.cents < 0 ? fix(-x.cents) : "", x.cents > 0 ? fix(x.cents) : "", fix(x.balance), x.cents > 0 ? "DEP" : "PAYMENT", ""])]));
    if (to >= "2024-02-05" && from <= "2024-05-06") put(TC, addDays(to, 3), `Wattle_TD_C_${from}.csv`, csvLines([head5, bf5(from, before(TC, from)), ...view(TC, from, to).map(w5)]));
    if (to >= "2024-05-06" && from <= "2025-05-06") put(TD, addDays(to, 3), `Wattle_TD_D_${from}.csv`, csvLines([head5, bf5(from, before(TD, from)), ...view(TD, from, to).map(w5)]));
  }
  // the sterling account: the same five columns, in pounds
  for (const [from, to] of half) put(UK, addDays(to, 5), `Albion_${from}.csv`, csvLines([head5, bf5(from, before(UK, from)), ...view(UK, from, to).map(w5)]));
  // the fund's bank: monthly
  for (const ym of MONTHS) { const from = `${ym}-01`, to = monthEnd(ym); put(SB, addDays(to, 2), `Wattle_SMSF_${ym}.csv`, csvLines([head5, bf5(from, before(SB, from)), ...view(SB, from, to).map(w5)])); }
  // the card: a monthly statement dated by the charge, a quarterly activity download dated by the post
  chain(CC);
  const cc = B.lines.filter((x) => x.acct === CC).sort(byPost);
  for (const s of CARD.statements) { if (s.end === STATEMENT_MISSING) continue; put("STM-CARD", addDays(s.end, 2), `Amewx_statement_${s.end}.pdf`, pdfCard(s), { issued_on: s.end }); }
  for (const [from, to, day] of quarters("2023-07", "2026-06").map(([f, t], i) => (i === 0 ? ["2023-06-22", t, addDays(t, 3)] : f === "2024-10-01" ? ["2024-09-25", t, addDays(t, 3)] : [f, t === END ? "2026-07-10" : t, addDays(t, 3)]))) {
    let rows = cc.filter((x) => posted(x) >= from && posted(x) <= to).map((x) => ({ d: posted(x), desc: x.csv || x.desc, m: x.member || SALMA, c: x.cents, n: cardNo(posted(x)) }));
    if (from === "2024-07-01") { const a = cc.find((x) => x.authFile === from); rows.push({ d: a.date, desc: a.csv, m: a.member, c: -a.authCents, n: NUM.card1 }); }
    if (from === "2025-07-01") rows = rows.filter((x) => x.m === SALMA);
    rows.sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0));
    put(CC, day, `activity_${from}.csv`, csvLines([["Date", "Description", "Card Member", "Account #", "Amount"], ...rows.map((x) => [dmy(x.d), x.desc, x.m.toUpperCase(), `-${x.n}`, money(-x.c).replace(/,/g, "")])]));
  }
  // the brokers: cash and holdings for her and for the fund, a note for every trade
  for (const [acct, stream, num] of [[BK, BK, NUM.broker], [SK, SK, NUM.smsfBroker]]) {
    const bk = chain(acct);
    quarters("2023-07", "2026-06").forEach(([from, to], i) => {
      const rows = bk.filter((x) => x.date >= from && x.date <= to).map((x) => [fmtDate(x.date), x.reference || `TX-${x.seq}`, x.desc, x.cents < 0 ? fix(-x.cents) : "", x.cents > 0 ? fix(x.cents) : "", fix(x.balance)]);
      if (i === 0) rows.unshift([fmtDate(from), "OPEN", "BALANCE BROUGHT FORWARD", "", "0.00", fix(OPEN[acct])]);
      if (!rows.length) return;
      const closing = rows[rows.length - 1][5];
      put(stream, addDays(to, 4), `CedarTrade_cash_${from}.csv`, csvLines([["Cedar Trade cash account"], [`Account: ${num}`], [`Period: ${span(from, to)}`], ["Date", "Reference", "Details", "Debit", "Credit", "Balance"], ...rows, ["Closing balance", "", "", "", "", closing], ["End of statement"]]));
    });
  }
  for (const [stream, side] of [[SH, "her"], [SS, "fund"]]) for (const ym of ["2023-06", ...MONTHS]) {
    if (stream === SS && ym === "2025-11") continue;
    const e = monthEnd(ym), rows = SHARES[side][ym].map((h) => [h.code, h.name, h.units, h.price, fix(h.value), e].join("\t"));
    put(stream, addDays(e, 1), `holdings_${e}.tsv`, `${["Security", "Description", "Units", "Price", "Market Value", "As At"].join("\t")}\r\n${rows.join("\r\n")}\r\n`);
  }
  for (const t of SHARES.trades) put("NOTES-CEDAR", t.d, `ContractNote_${t.ref}.pdf`, pdfContractNote(t), { issued_on: t.d });
  for (const v of SHARES.divs) put("DIV-COMPUTERPAW", v.pay, `Dividend_${v.code}_${v.pay}.pdf`, pdfDividend(v), { issued_on: v.pay });
  put("ACTIONS-COMPUTERPAW", CONSOL.d, `Action_${CONSOL.code}_${CONSOL.d}.eml`, emlAction({ date: CONSOL.d, lines: [`Security code: ${CONSOL.code}`, "Corporate action: consolidation", "Ratio: 1:2", `Effective date: ${fmtDate(CONSOL.d)}`, "Every two shares become one.", "No cash changes hands.", "Holder statements follow.", "Fictional notice."] }), { issued_on: CONSOL.d, origin: "email" });
  put("ACTIONS-COMPUTERPAW", ROC.d, `Action_${ROC.code}_${ROC.d}.eml`, emlAction({ date: ROC.d, lines: [`Security code: ${ROC.code}`, "Corporate action: return_of_capital", "Ratio: 1.20 per share", `Effective date: ${fmtDate(ROC.d)}`, "The payment is capital, not a dividend.", "It lowers your cost base.", "Holder statements follow.", "Fictional notice."] }), { issued_on: ROC.d, origin: "email" });
  // the pension fund: the public layout, with pension lines the recipe's map does not hold, and a yearly statement no recipe balances
  const CODE_OPEN = (from) => { const b = PENS.lines.filter((x) => x.date < from); return b.length ? b[b.length - 1].balance : OPEN[PN]; };
  for (const [from, to] of half) {
    const ls = PENS.lines.filter((x) => x.date >= from && x.date <= to);
    put(PN, addDays(to, 5), `hestabby_${from}.json`, JSON.stringify({ schema: "hestabby.transactions.v2", member: { name: SALMA, number: NUM.pension }, period: { from, to }, balance: { opening: Number(fix(CODE_OPEN(from))), closing: Number(fix(ls[ls.length - 1].balance)) }, transactions: ls.map((x) => ({ date: x.date, code: x.code, label: x.label, amount: Number(fix(x.cents)), balanceAfter: Number(fix(x.balance)) })) }, null, 1));
  }
  // the bridging loan: one statement for its four months
  put("STM-BRIDGE", addDays(SOLD, 5), `Westpaw_bridge_${SOLD}.pdf`, pdfLoan({ from: BUY, to: SOLD, rows: LOANS.bridge }), { issued_on: addDays(SOLD, 3) });
  put("SETTLEMENT", BUY, "Settlement_statement_unit.pdf", pdfSettlement(), { issued_on: BUY });
  put("SALE-HOME", SOLD, "Vendor_statement_home.pdf", pdfBare(BR_.conveyancer, "Vendor statement", [`Property: ${HOME}`, `Sale price: ${money(CAPITAL.sale)}`, `Commission and marketing: ${money(CAPITAL.commission + CAPITAL.marketing)}`, `Legal: ${money(CAPITAL.saleLegal)}`, `Loan discharged, Westpaw ${NUM.bridge}: ${money(LOANS.payout)}`, `Paid to vendors: ${money(CAPITAL.net)}`, "Prepared by the conveyancer. Fictional."]), { issued_on: SOLD });
  for (const fy of [2024, 2025]) put("STM-SMSF", `${fy}-11-30`, `Member_statement_FY${fy}.pdf`, pdfBare(BR_.smsf, `Member benefit statement FY${fy}`, [`Fund: Whitlock Haddad Super Fund`, `Member: ${GEOFF}`, "Prepared by the fund's accountants. Fictional."]), { issued_on: `${fy}-11-30` });
  // tax
  for (const n of TAX.notices) put("TAX-SALMA", n.assessed, `NOA_FY${n.fy}.pdf`, pdfNoa(n), { issued_on: n.assessed });
  // the holiday house
  for (const s of RENT.st) { put("OWNER-PORTLAND", s.paid, `PortlandBay_${s.ym}.pdf`, pdfOwner(s), { issued_on: bizAfter(monthEnd(s.ym), 2) }); if (s.reissue) put("OWNER-PORTLAND", s.reissue.issued, `PortlandBay_${s.ym}_reissued.pdf`, pdfOwner(s.reissue), { issued_on: s.reissue.issued }); }
  // valuations
  put("VALUATIONS", "2026-07-01", "pawprice_estimates.csv", csvLines([["Subject", "As At", "Estimate", "Method", "Provider"], ...VALUES.home.map(([d, c]) => [HOME, dmy(d), fix(c), "estimate", "Pawprice"]), ...VALUES.unit.map(([d, c]) => [UNIT, dmy(d), fix(c), "estimate", "Pawprice"]), ...VALUES.port.map(([d, c]) => [PORT, dmy(d), fix(c), "estimate", "Pawprice"])]));
  // bills
  for (const b of BILLS.energy) put("BILL-POWER", b.billDate, `bill_${b.billDate}.eml`, emlEnergy(b), { issued_on: b.billDate, origin: "email" });
  for (const b of BILLS.rates) put("BILL-RATES", b.billDate, `rates_${b.billDate}.pdf`, pdfRates(b), { issued_on: b.billDate });
  for (const b of BILLS.water) put("BILL-WATER", b.billDate, `water_${b.billDate}.pdf`, pdfWater(b), { issued_on: b.billDate });
  for (const p of BILLS.policy) put(p.kind === "Home" ? "POLICY-HOME" : "POLICY-PORTLAND", p.paid, `certificate_${p.from}.pdf`, pdfPolicy(p), { issued_on: p.paid });
}
function quarters(a, b) { const out = []; const ms = monthRange(a, b); for (let i = 0; i < ms.length; i += 3) out.push([`${ms[i]}-01`, monthEnd(ms[i + 2])]); return out; }

// ---------- setup: what a person answers at onboarding, in July 2026 ----------
const ON = "2026-07-20T00:00:00Z";
/* The public default categories, as the earlier households listed them, with PASS-THROUGH which SPEC 4.4c says ships. SUPER-PENSION is added because SPEC 6.5 and schema/events.json name it, and SELLING-COSTS because schema/events.json posts to it. One row by the SPEC 12 rung, because a person would need it: the Age and overseas pensions the defaults have nowhere to put. */
const CATS = `SALARY|Salary and wages|income|Income|1|1;SALARY-ALLOW|Allowances|income|Income|1|1;REIMBURSE|Employer reimbursements|income|Income|1|0;SUPER-EMPLOYER|Employer super|income|Super|0|1;SUPER-SACRIFICE|Salary sacrificed to super|income|Super|0|1;PAYROLL-DED|Post-tax payroll deductions|expense|Income|1|1;INTEREST|Interest earned|income|Income|1|1;DIVIDEND|Dividends and distributions|income|Income|1|1;TRUST-DIST|Trust distributions|income|Income|1|1;ESS-INCOME|Employee share scheme income|income|Income|0|1;CRYPTO-INCOME|Staking and crypto income|income|Income|0|1;SUPER-EARN|Super fund earnings|income|Super|0|1;SUPER-FEES|Super fund fees|expense|Super|0|1;SUPER-INS|Insurance inside super|expense|Super|0|1;SUPER-TAX|Contributions tax|expense|Super|0|1;GIFT-IN|Gifts and inheritances received|income|Income|1|0;RENT-INC|Rent received|income|Property|1|1;MORTGAGE|Home loan repayments|expense|Housing|1|0;HOME-INT|Home loan interest|expense|Housing|0|1;RATES-HOME|Council rates (home)|expense|Housing|1|1;HOME-INS|Home and contents insurance|expense|Housing|1|1;HOME-MAINT|Home maintenance|expense|Housing|1|1;GROCERIES|Groceries|expense|Essentials|1|1;UTILITIES|Energy and water|expense|Essentials|1|1;TELCO|Internet and mobile|expense|Essentials|1|1;TRANSPORT|Fuel and transport|expense|Essentials|1|1;CAR|Car costs|expense|Essentials|1|1;HEALTH|Health|expense|Essentials|1|1;CHILDCARE|Childcare|expense|Essentials|1|1;DINING|Dining and takeaway|expense|Lifestyle|1|1;SUBS|Subscriptions|expense|Lifestyle|1|1;SHOPPING|Shopping|expense|Lifestyle|1|1;KIDS-ACT|Kids activities|expense|Lifestyle|1|1;HOLIDAYS|Holidays and travel|expense|Lifestyle|1|1;GIFTS|Gifts|expense|Lifestyle|1|1;PERSONAL|Personal care|expense|Lifestyle|1|1;RENT-INT|Investment loan interest|expense|Property|1|1;RENT-MGMT|Property management fees|expense|Property|1|1;RENT-RATES|Rental rates and water|expense|Property|1|1;RENT-STRATA|Strata levies|expense|Property|1|1;RENT-INS|Landlord insurance|expense|Property|1|1;RENT-REPAIR|Rental repairs|expense|Property|1|1;RENT-OTHER|Other rental costs|expense|Property|1|1;WORK-EQUIP|Work equipment|expense|Work and giving|1|1;WORK-OTHER|Work registrations and courses|expense|Work and giving|1|1;DONATION|Donations|expense|Work and giving|1|1;FEES|Bank fees and card interest|expense|Fees|1|1;INCOME-TAX|Income tax assessed|expense|Tax|0|1;HELP-INDEX|HELP indexation|expense|Tax|0|1;TAX-REFUND|Tax refunds and payments|transfer|Tax|0|0;TRANSFER|Transfers between own accounts|transfer|Transfers|0|0;CC-PAY|Credit card payments|transfer|Transfers|0|0;UNCAT|Uncategorised|suspense|Uncategorised|1|1;PASS-THROUGH|Money that is someone else's|pass_through|Transfers|0|0;SUPER-PENSION|Super pension|income|Income|1|0;SELLING-COSTS|Selling costs|capital|Capital|0|0;x_AGE-PENSION|Age and overseas pensions|income|Income|1|1`;
function setup() {
  const person = (id, name, birth) => ({ party_id: id, kind: "person", name, birth_date: birth });
  const org = (id, name, kind = "organisation") => ({ party_id: id, kind, name });
  const party = [person("PTY-SALMA", SALMA, "1955-04-02"), person("PTY-GEOFF", GEOFF, "1951-11-19"), person("PTY-KARIM", KARIM, "1985-08-30"), person("PTY-NADIA", NADIA, "1931-02-14"), person("PTY-TARIQ", TARIQ, "1958-06-23"),
    org("PTY-SMSF", "Whitlock Haddad Super Fund", "smsf"), org("PTY-BARK", "Bark Bank"), org("PTY-HARBOUR", "Harbour Bank"), org("PTY-WATTLE", "Wattle Credit Union"), org("PTY-ALBION", "Albion Building Society"), org("PTY-AMEWX", "Amewx"), org("PTY-CEDAR", "Cedar Trade"), org("PTY-COMPUTERPAW", "Computerpaw"), org("PTY-WESTPAW", "Westpaw"), org("PTY-HESTABBY", "HESTAbby"),
    org("PTY-TAX", "myGuv", "government"), org("PTY-SERVICES", "Services Australia", "government"), org("PTY-DWP", "UK Department for Work and Pensions", "government"), org("PTY-ROSEWOOD", "Rosewood Aged Care"), org("PTY-HARGRAVES", "Hargraves Legal"), org("PTY-LODDON", "Loddon Conveyancing"), org("PTY-PORTBAY", "Portland Bay Holiday Lets"), org("PTY-GOLDLINE", "Goldline Power"), org("PTY-COUNCIL", "Mt Alexander Council", "government"), org("PTY-WATER", "Coliban Reach Water"), org("PTY-PURRSURE", "Purrsure"), org("PTY-BUPAW", "Bupaw")];
  const membership = [["PTY-SALMA", "adult", "1955-04-02"], ["PTY-GEOFF", "adult", "1951-11-19"], ["PTY-KARIM", "adult", "1985-08-30", LEAVES]].map(([party_id, role, valid_from, valid_to]) => ({ party_id, role, valid_from, ...(valid_to ? { valid_to } : {}), recorded_at: ON }));
  const acct = (account_id, name, cls, type, group, inst, extra = {}) => ({ account_id, name, class: cls, type, reporting_group: group, currency: "AUD", ...(inst ? { institution_party_id: inst } : {}), in_scope: true, liquid: group === "cash", fidelity: "ledger", ...extra });
  const account = [
    acct(EV, "Everyday, Bark then Harbour", "asset", "transaction", "cash", "PTY-HARBOUR"), acct(SV, "Saver, Wattle", "asset", "savings", "cash", "PTY-WATTLE"), acct(FM, "Family saver, Bark", "asset", "savings", "cash", "PTY-BARK", { closed_on: FAM_CLOSE }), acct(OD, "Old passbook, Wattle", "asset", "savings", "cash", "PTY-WATTLE"),
    acct(TA, "Term deposit A, Wattle", "asset", "savings", "cash", "PTY-WATTLE", { liquid: false }), acct(TB, "Term deposit B, Harbour", "asset", "savings", "cash", "PTY-HARBOUR", { liquid: false }), acct(TC, "Term deposit C, Wattle", "asset", "savings", "cash", "PTY-WATTLE", { liquid: false, opened_on: "2024-02-05", closed_on: "2024-05-06" }), acct(TD, "Term deposit D, Wattle", "asset", "savings", "cash", "PTY-WATTLE", { liquid: false, opened_on: "2024-05-06", closed_on: "2025-05-06" }),
    acct(CC, "Amewx card", "liability", "credit_card", "cash", "PTY-AMEWX"), acct(BK, "Cedar Trade cash", "asset", "brokerage", "cash", "PTY-CEDAR"), acct(SH, "Shares at Cedar Trade", "asset", "holding", "shares", "PTY-CEDAR", { parent_account_id: BK, liquid: false }),
    acct(UK, "Albion savings, sterling", "asset", "savings", "cash", "PTY-ALBION", { currency: "GBP" }),
    acct(SB, "The fund's bank, Wattle", "asset", "smsf", "super", "PTY-WATTLE", { contract_id: "CON-SMSF", liquid: false }), acct(SK, "The fund's Cedar Trade cash", "asset", "smsf", "super", "PTY-CEDAR", { liquid: false }), acct(SS, "The fund's shares at Cedar Trade", "asset", "holding", "super", "PTY-CEDAR", { parent_account_id: SK, liquid: false }),
    acct(PN, "Salma's pension account", "asset", "super", "super", "PTY-HESTABBY", { contract_id: "CON-PENSION", liquid: false }),
    acct(BR, "Bridging loan", "liability", "loan", "loans", "PTY-WESTPAW", { contract_id: "CON-BRIDGE", opened_on: BUY, closed_on: SOLD, liquid: false }), acct(FL, "Loan to Karim", "asset", "receivable", "loans", null, { contract_id: "CON-KARIM", liquid: false }),
    acct(HO, "The home", "asset", "property", "property", null, { asset_id: "AST-HOME", fidelity: "snapshot", closed_on: SOLD, liquid: false }), acct(UN, "The unit", "asset", "property", "property", null, { asset_id: "AST-UNIT", fidelity: "snapshot", opened_on: BUY, liquid: false }), acct(LO, "The Portland unit", "asset", "property", "property", null, { asset_id: "AST-PORTLAND", fidelity: "snapshot", liquid: false }),
    acct(CAR, "The second car", "asset", "vehicle", "vehicle", null, { asset_id: "AST-CAR", fidelity: "snapshot", closed_on: CAR_SOLD, liquid: false, opening_balance_cents: CAR_VALUE, opening_date: START, note: "What we think it is worth." }),
  ];
  const asset = [{ asset_id: "AST-HOME", kind: "property", name: HOME, account_id: HO, location: "Castlemaine VIC", acquired_on: "1994-03-11", disposed_on: SOLD }, { asset_id: "AST-UNIT", kind: "property", name: UNIT, account_id: UN, location: "Castlemaine VIC", acquired_on: BUY }, { asset_id: "AST-PORTLAND", kind: "property", name: PORT, account_id: LO, location: "Portland VIC", acquired_on: "2006-01-20" }, { asset_id: "AST-CAR", kind: "vehicle", name: "The second car", account_id: CAR, disposed_on: CAR_SOLD }];
  const al = (subject_type, subject_id, scheme, value, o = {}) => ({ subject_type, subject_id, scheme, value, valid_from: "2000-01-01", recorded_at: ON, ...o });
  const alias = [al("account", EV, "account_number", NUM.harbour, { valid_from: MERGER }), al("account", SV, "account_number", NUM.saver), al("account", TB, "account_number", NUM.tdb), al("account", CC, "card_last4", NUM.card1, { valid_to: CARD_NEW }), al("account", CC, "card_last4", NUM.card2, { valid_from: CARD_NEW }), al("account", BK, "account_number", NUM.broker), al("account", SK, "account_number", NUM.smsfBroker), al("account", SH, "hin", NUM.hin), al("account", SS, "hin", NUM.hinSmsf), al("account", PN, "member_number", NUM.pension), al("account", BR, "loan_number", NUM.bridge),
    al("party", "PTY-SALMA", "name", SALMA), al("party", "PTY-GEOFF", "name", GEOFF), al("party", "PTY-KARIM", "name", KARIM), al("party", "PTY-NADIA", "name", NADIA), al("party", "PTY-TARIQ", "name", TARIQ), al("party", "PTY-SMSF", "name", "Whitlock Haddad Super Fund"), al("party", "PTY-ROSEWOOD", "name", "Rosewood Aged Care"), al("party", "PTY-HARGRAVES", "name", "Hargraves Legal"), al("party", "PTY-LODDON", "name", "Loddon Conveyancing"), al("party", "PTY-PORTBAY", "name", "Portland Bay Holiday Lets"),
    al("asset", "AST-HOME", "name", HOME), al("asset", "AST-UNIT", "name", UNIT), al("asset", "AST-PORTLAND", "name", PORT), al("asset", "AST-PORTLAND", "owner_ref", NUM.owner),
    al("contract", "CON-BRIDGE", "loan_number", NUM.bridge), al("contract", "CON-HOME-INS", "policy_number", "PH-40771882", { valid_to: "2025-10-02" }), al("contract", "CON-HOME-INS", "policy_number", "PH-51220913", { valid_from: "2025-10-02" }), al("contract", "CON-PORTLAND-INS", "policy_number", "PL-33904115")];
  const own_ = (subject_type, subject_id, split, o = {}) => ["legal", "beneficial", "tax"].flatMap((basis) => split.map(([party_id, share_bps]) => ({ subject_type, subject_id, party_id, basis, share_bps, valid_from: "2000-01-01", recorded_at: ON, ...o })));
  const her = [["PTY-SALMA", 10000]], him = [["PTY-GEOFF", 10000]], both = [["PTY-SALMA", 5000], ["PTY-GEOFF", 5000]], son = [["PTY-GEOFF", 5000], ["PTY-KARIM", 5000]];
  const fund = (a) => ["legal", "beneficial", "tax"].map((basis) => ({ subject_type: "account", subject_id: a, party_id: basis === "beneficial" ? "PTY-GEOFF" : "PTY-SMSF", basis, share_bps: 10000, valid_from: "2000-01-01", recorded_at: ON }));
  const ownership = [...[EV, SV, TA, TB, TC, TD, CC, HO, UN, CAR, FL, BR].flatMap((a) => own_("account", a, both)), ...own_("account", FM, son), ...[OD, UK].flatMap((a) => own_("account", a, him)), ...[BK, SH, PN, LO].flatMap((a) => own_("account", a, her)), ...[SB, SK, SS].flatMap(fund), ...own_("asset", "AST-HOME", both), ...own_("asset", "AST-UNIT", both), ...own_("asset", "AST-PORTLAND", her), ...own_("asset", "AST-CAR", both)];
  const category = CATS.split(";").map((r) => { const [category_id, name, kind, group, c, e] = r.split("|"); return { category_id, name, kind, group, cash_lens: c === "1", economic_lens: e === "1" }; });
  const con = (contract_id, kind, name, counterparty_party_id, holder_party_id, extra = {}) => ({ contract_id, kind, name, counterparty_party_id, holder_party_id, ...extra });
  const contract = [
    con("CON-PENSION", "super_fund", "Salma's account-based pension", "PTY-HESTABBY", "PTY-SALMA", { account_id: PN, category_id: "SUPER-PENSION", started_on: "2019-07-01" }), con("CON-SMSF", "super_fund", "Geoffrey's pension from the fund", "PTY-SMSF", "PTY-GEOFF", { account_id: SB, category_id: "SUPER-PENSION", started_on: "2016-07-01" }),
    con("CON-BRIDGE", "loan", "Bridging loan", "PTY-WESTPAW", "PTY-SALMA", { account_id: BR, asset_id: "AST-UNIT", category_id: "HOME-INT", started_on: BUY, ended_on: SOLD }), con("CON-KARIM", "loan", "Loan to Karim", "PTY-KARIM", "PTY-GEOFF", { account_id: FL, started_on: "2024-03-12" }),
    con("CON-CARE", "subscription", "Nadia's aged-care fees, paid for her", "PTY-ROSEWOOD", "PTY-SALMA", { category_id: "PASS-THROUGH", started_on: "2023-11-01", ended_on: "2025-01-31" }),
    con("CON-HOME-INS", "insurance", "Home insurance", "PTY-PURRSURE", "PTY-SALMA", { asset_id: "AST-HOME", category_id: "HOME-INS" }), con("CON-PORTLAND-INS", "insurance", "Landlord insurance, Portland", "PTY-PURRSURE", "PTY-SALMA", { asset_id: "AST-PORTLAND", category_id: "RENT-INS" }),
    con("CON-POWER", "utility", "Electricity", "PTY-GOLDLINE", "PTY-SALMA", { category_id: "UTILITIES" }), con("CON-HEALTH", "insurance", "Hospital and extras", "PTY-BUPAW", "PTY-SALMA", { category_id: "HEALTH" }),
    con("CON-AGENT", "lease", "The Portland unit, Portland Bay managing", "PTY-PORTBAY", "PTY-SALMA", { asset_id: "AST-PORTLAND", category_id: "RENT-INC", started_on: "2019-01-01" }),
  ];
  const lk = (relation, from_type, from_id, to_type, to_id, extra = {}) => ({ relation, from_type, from_id, to_type, to_id, valid_from: "2000-01-01", recorded_at: ON, ...extra });
  const link = [lk("secures", "contract", "CON-BRIDGE", "asset", "AST-UNIT", { valid_from: BUY, valid_to: SOLD }), lk("funds_purpose", "contract", "CON-BRIDGE", "asset", "AST-UNIT", { share_bps: 10000, valid_from: BUY, valid_to: SOLD }), lk("serves", "account", SV, "asset", "AST-PORTLAND"), lk("charged_to", "account", CC, "account", EV), lk("covers", "contract", "CON-HOME-INS", "asset", "AST-HOME", { valid_to: SOLD }), lk("covers", "contract", "CON-HOME-INS", "asset", "AST-UNIT", { valid_from: SOLD }), lk("covers", "contract", "CON-PORTLAND-INS", "asset", "AST-PORTLAND")];
  const st = (stream_id, name, doc_kind, subject_type, subject_id, issuer_party_id, cadence, extra = {}) => ({ stream_id, name, doc_kind, subject_type, subject_id, issuer_party_id, cadence, valid_from: START, grace_days: 14, recorded_at: ON, ...extra });
  const stream = [
    st(EV, "Everyday download", "txn_csv", "account", EV, "PTY-HARBOUR", "quarterly"), st(SV, "Saver download", "txn_ofx", "account", SV, "PTY-WATTLE", "quarterly"), st(FM, "Family saver download", "txn_csv", "account", FM, "PTY-BARK", "quarterly", { valid_to: FAM_CLOSE }), st(OD, "Passbook download", "txn_csv", "account", OD, "PTY-WATTLE", "quarterly"),
    st(TA, "Deposit A statement", "txn_csv", "account", TA, "PTY-WATTLE", "half_yearly"), st(TB, "Deposit B statement", "txn_csv", "account", TB, "PTY-HARBOUR", "half_yearly"), st(TC, "Deposit C statement", "txn_csv", "account", TC, "PTY-WATTLE", "event"), st(TD, "Deposit D statement", "txn_csv", "account", TD, "PTY-WATTLE", "event"),
    st(UK, "Albion download", "txn_csv", "account", UK, "PTY-ALBION", "half_yearly"), st(CC, "Amewx activity", "txn_csv", "account", CC, "PTY-AMEWX", "quarterly"), st("STM-CARD", "Amewx statement", "statement", "account", CC, "PTY-AMEWX", "monthly"),
    st(BK, "Cedar cash", "txn_csv", "account", BK, "PTY-CEDAR", "quarterly"), st(SH, "Cedar holdings", "holdings", "account", SH, "PTY-CEDAR", "monthly"), st(SK, "The fund's Cedar cash", "txn_csv", "account", SK, "PTY-CEDAR", "quarterly"), st(SS, "The fund's Cedar holdings", "holdings", "account", SS, "PTY-CEDAR", "monthly"), st("NOTES-CEDAR", "Contract notes", "contract_note", "account", SH, "PTY-CEDAR", "event"), st("DIV-COMPUTERPAW", "Dividend notices", "dividend", "account", SH, "PTY-COMPUTERPAW", "event"), st("ACTIONS-COMPUTERPAW", "Corporate actions", "corporate_action", "account", SH, "PTY-COMPUTERPAW", "event"),
    st(SB, "The fund's bank", "txn_csv", "account", SB, "PTY-WATTLE", "monthly"), st("STM-SMSF", "Member statements", "smsf_statement", "account", SB, "PTY-SMSF", "yearly"), st(PN, "Pension transactions", "super_lines", "account", PN, "PTY-HESTABBY", "half_yearly"),
    st("STM-BRIDGE", "Bridging statement", "loan_statement", "account", BR, "PTY-WESTPAW", "event", { valid_from: BUY, valid_to: SOLD }), st("SETTLEMENT", "Purchase settlement", "settlement", "asset", "AST-UNIT", "PTY-LODDON", "event"), st("SALE-HOME", "Vendor statement", "settlement", "asset", "AST-HOME", "PTY-LODDON", "event"),
    st("TAX-SALMA", "Salma's notices", "tax_assessment", "party", "PTY-SALMA", "PTY-TAX", "yearly"), st("OWNER-PORTLAND", "Portland Bay statements", "owner_statement", "asset", "AST-PORTLAND", "PTY-PORTBAY", "event"), st("VALUATIONS", "Pawprice estimates", "valuation", "asset", "AST-PORTLAND", null, "quarterly"),
    st("BILL-POWER", "Electricity bills", "bill", "contract", "CON-POWER", "PTY-GOLDLINE", "quarterly"), st("BILL-RATES", "Rates notices", "bill", "asset", "AST-HOME", "PTY-COUNCIL", "quarterly"), st("BILL-WATER", "Water bills", "bill", "asset", "AST-HOME", "PTY-WATER", "quarterly"), st("POLICY-HOME", "Home insurance certificate", "policy", "contract", "CON-HOME-INS", "PTY-PURRSURE", "yearly"), st("POLICY-PORTLAND", "Landlord certificate", "policy", "contract", "CON-PORTLAND-INS", "PTY-PURRSURE", "yearly"),
  ];
  const instrument = Object.entries(SEC).map(([code, s]) => ({ instrument_id: `INS-${code}`, kind: "listed_share", code, name: s.name, currency: "AUD" }));
  let t = 0;
  const tm = (subject_type, subject_id, term, value, unit, valid_from, o = {}) => { t += 1; return { term_id: `TERM-${pad(t, 3)}`, subject_type, subject_id, term, value, unit, valid_from, recorded_at: ON, ...o }; };
  // only what a person knows offhand: the rates they signed, what each place is for, which fund is paying a pension
  const term = [tm("contract", "CON-BRIDGE", "interest_rate", RATE_BRIDGE, "pct", BUY), tm("contract", "CON-BRIDGE", "rate_type", "variable", null, BUY), tm("contract", "CON-BRIDGE", "repayment_type", "interest_only", null, BUY),
    tm("contract", "CON-KARIM", "interest_rate", "0", "pct", "2024-03-12"), tm("contract", "CON-KARIM", "repayment_type", "principal_and_interest", null, "2024-03-12"), tm("contract", "CON-KARIM", "repayment_cents", "30000", "cents", "2024-07-01"), tm("contract", "CON-KARIM", "repayment_cadence", "monthly", null, "2024-07-01"),
    tm("contract", "CON-PENSION", "phase", "retirement", null, START), tm("contract", "CON-PENSION", "minimum_drawdown_pct", "5", "pct", START), tm("contract", "CON-SMSF", "phase", "retirement", null, START), tm("contract", "CON-SMSF", "minimum_drawdown_pct", "6", "pct", START),
    tm("contract", "CON-CARE", "price_cents", "340000", "cents", "2023-11-01"), tm("contract", "CON-CARE", "cadence", "monthly", null, "2023-11-01"), tm("contract", "CON-AGENT", "agent_fee_pct", "12", "pct", START), tm("contract", "CON-AGENT", "rent_cadence", "weekly", null, START), tm("contract", "CON-AGENT", "rent_cents", "0", "cents", START),
    tm("account", TA, "interest_rate", "4.85", "pct", START), tm("account", TB, "interest_rate", "4.60", "pct", START), tm("account", TC, "interest_rate", "4.90", "pct", "2024-02-05"), tm("account", TD, "interest_rate", "4.70", "pct", "2024-05-06"),
    tm("asset", "AST-HOME", "use", "owner_occupied", null, "1994-03-11"), tm("asset", "AST-HOME", "main_residence", "true", null, "1994-03-11"), tm("asset", "AST-UNIT", "use", "owner_occupied", null, BUY), tm("asset", "AST-PORTLAND", "use", "holiday", null, "2006-01-20")];
  const activity = [{ activity_id: "ACT-PORTLAND", kind: "rental", name: "The Portland lets", asset_id: "AST-PORTLAND", owner_party_id: "PTY-SALMA", valid_from: "2019-01-01", recorded_at: ON }];
  const household = [{ household_id: "HH-HW", name: "Haddad-Whitlock", jurisdiction: "AU", base_currency: "AUD", fy_start_month: 7, timezone: "Australia/Melbourne", standard_version: "household-standard/1" }];
  return { household, party, membership, account, alias, ownership, category, contract, link, stream, asset, instrument, term, activity };
}

// ---------- build ----------
function build() {
  fxCurve(); valuations(); everyday(); pensions(); bills(); holidayLets(); shares(); fundCosts(); termDeposits(); family(); ukMoney(); downsizing(); lineTraps(); settleCard(); taxes(); interestCredits(); bridge(); pensionFund();
  const tb = truthBalances();
  fileTraps(); leaverTrap(tb.balances);
  const t = truth(tb);
  const lows = {}; for (const a of [EV, SV, FM, OD, TA, TB, TC, TD, BK, UK, SB, SK, PN]) lows[a] = Math.min(...chain(a).map((x) => x.balance));
  for (const [a, v] of Object.entries(lows)) if (v < 0) throw new Error(`${a} goes overdrawn: ${money(v)}`);
  render();
  const tSetup = setup();
  fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
  const manifest = { household: "HH-HW", files: FILES.map((f) => ({ path: f.path, stream_id: f.stream, download_date: f.day, name: f.name, origin: f.origin || "portal", issued_on: f.issued_on || null })) };
  for (const f of FILES) { const p = path.join(OUT, f.path); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, f.bytes); }
  fs.writeFileSync(path.join(OUT, "manifest.json"), `${JSON.stringify(manifest, null, 1)}\n`);
  fs.writeFileSync(path.join(OUT, "truth.json"), `${JSON.stringify(t, null, 1)}\n`);
  fs.mkdirSync(SETUP_DIR, { recursive: true });
  for (const n of fs.readdirSync(SETUP_DIR)) fs.rmSync(path.join(SETUP_DIR, n));
  for (const [k, v] of Object.entries(tSetup)) fs.writeFileSync(path.join(SETUP_DIR, `${k}.json`), `${JSON.stringify(v, null, 1)}\n`);
  return { files: FILES.length, lines: B.lines.length, traps: B.traps.length, fresh: B.traps.filter((x) => x.fresh).length, dc: B.traps.filter((x) => x.dc).length, lows };
}

if (require.main === module) { const r = build(); console.log(`Held-out household 3: ${r.files} files, ${r.lines} lines, ${r.traps} traps (${r.fresh} in neither earlier list, ${r.dc} new double-count or silent-number variants). Lowest balances: ${Object.entries(r.lows).map(([a, v]) => `${a} ${money(v)}`).join(", ")}.`); }
module.exports = { build, OUT, SETUP_DIR, book: B };
