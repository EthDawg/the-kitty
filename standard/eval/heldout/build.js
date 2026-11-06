#!/usr/bin/env node
/* The held-out household. The engine's authors tuned it on one fictional family, the Davies. This is a family it has never seen: the Okafor-Lindqvists of
   Hobart, 36 months from July 2023 to June 2026. Everything here is fictional. Written blind: from the public spec, schemas and recipes only.

   Order of work: a life is simulated first and held in cents, day by day. Only then are files rendered from it, in the shapes the public recipes read, the way
   the institutions would have issued them. Truth is written from the simulation and never from the engine. Setup is what a person would answer at onboarding:
   no rules, no decisions, no opening balances a file already states, and only the terms a person knows offhand.

   node standard/eval/heldout/build.js
   writes standard/.build/heldout/{sources,manifest.json,truth.json} and standard/eval/heldout/setup/<table>.json. Node 22, no dependencies, seeded, no clock. */
"use strict";
const fs = require("fs"), path = require("path"), zlib = require("zlib");

const STD = path.join(__dirname, "..", "..");
const LIB = path.join(STD, "world", "lib");
const { pad, fix, money, addDays, dayDiff, weekday, monthEnd, nextMonth, monthRange, fmtDate, dmy, fyOf, csvLines, Rng, MONTHS: MON } = require(path.join(LIB, "util"));
const { Doc, M: MARGIN } = require(path.join(LIB, "pdf"));
const { eml } = require(path.join(LIB, "mail"));

const OUT = path.join(STD, ".build", "heldout");
const SETUP_DIR = path.join(__dirname, "setup");
const START = "2023-07-01", END = "2026-06-30", MONTHS = monthRange("2023-07", "2026-06");
const rng = (name) => new Rng(`okafor-lindqvist:${name}`);
const deflate = (b) => new Uint8Array(zlib.deflateSync(b));

// ---------- who and what ----------
const ADA = "Ada Okafor", SVEN = "Sven Lindqvist";
const HB = "ACC-ADA", WT = "ACC-SVEN", JT = "ACC-JOINT", CC = "ACC-CARD", BK = "ACC-BROKER", SH = "ACC-SHARES", HL = "ACC-HOMELOAN", CL = "ACC-CARLOAN", SA = "ACC-SUPER-ADA", SS = "ACC-SUPER-SVEN", UN = "ACC-UNIT", CR = "ACC-CAR";
const NUM = { harbour: "732118604219", wattle: "0029174403", bark: "881207703", card: "41007", cardFull: "xxxx-xxxxxx-41007", broker: "CT-8841207", hin: "X0048812", home: "553 882 417", car: "PNG-40021877", superAda: "HST-5520917", superSven: "PUR-3381046" };
const UNIT = "4/17 Petrel Row, Lindisfarne";
const CASH = [HB, WT, JT, CC, BK];

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
const isBiz = (d) => weekday(d) !== 0 && weekday(d) !== 6;
const nextBiz = (d) => { while (!isBiz(d)) d = addDays(d, 1); return d; };
const prevBiz = (d) => { while (!isBiz(d)) d = addDays(d, -1); return d; };
const bizAfter = (d, n) => { let x = d; while (n > 0) { x = addDays(x, 1); if (isBiz(x)) n -= 1; } return x; };
const cents = (r, lo, hi) => Math.round(r.range(lo, hi) * 100);
const ymOf = (d) => d.slice(0, 7);
const lastBiz = (ym) => prevBiz(monthEnd(ym));

// ---------- trap register. A probe is a fact run.js can test against what the engine produced ----------
function trap(id, name, where, expect, probe) { B.traps.push({ id, name, where, expect, probe }); }

// ---------- merchants, all invented ----------
const MER = {
  grocer: [["BLUEGUM PANTRY", "SANDY BAY"], ["MARROWBONE FRESH", "MOONAH"], ["FENNEL AND SALT GROCER", "LINDISFARNE"]],
  cafe: [["BEANS AND BOBBIN", "HOBART"], ["THE SLOW KETTLE", "BELLERIVE"], ["NOOK AND CRANNY COFFEE", "HOBART"]],
  dine: [["LITTLE HARBOUR THAI", "HOBART"], ["SALT AND CHIP CO", "BELLERIVE"], ["THE LAMPLIGHTER BISTRO", "NORTH HOBART"], ["GINGER AND RYE KITCHEN", "HOBART"]],
  fuel: [["TIDELINE FUEL", "ROKEBY"], ["TIDELINE FUEL", "GLENORCHY"]],
  shop: [["WOOLLEN FOX", "HOBART"], ["PARCELPAW ONLINE", "SYDNEY"], ["TOOLSHED BROTHERS", "CAMBRIDGE"], ["PAPER AND TWINE", "HOBART"], ["RIVERSTONE HOMEWARES", "MOONAH"]],
  chem: [["BELLWETHER PHARMACY", "LINDISFARNE"], ["BELLWETHER PHARMACY", "HOBART"]],
  park: [["CITY PARKING METER", "HOBART"]],
  lunch: [["DOCKSIDE ROLLS", "HOBART"], ["THE GALLEY CANTEEN", "MACQUARIE WHARF"]],
};
const cardDesc = (m) => `${m[0]} ${m[1]}`;
const cardCsv = (m) => `${m[0].padEnd(26)}${m[1]}  TAS`;
const hbPos = (m) => `DEBIT CARD PURCHASE ${m[0]} ${m[1]} AUS`;
const wtPos = (m, d) => `Visa Purchase ${d.slice(8)}/${d.slice(5, 7)} ${m[0]} ${m[1]}`;

/* one card purchase. date is the day it was charged, which the statement shows; posted is the day the activity download shows. */
function card(r, date, m, c, cat, member, o = {}) {
  const lag = r.pick([0, 0, 1, 1, 1, 2]);
  const posted = o.posted || (lag ? bizAfter(date, lag) : date);
  return line(CC, date, o.desc || cardDesc(m), -c, { posted, csv: o.csv || cardCsv(m), member, lens: o.lens === undefined ? "spending" : o.lens, cat, ...o.extra });
}

// ---------- everyday life ----------
function everyday() {
  const r = rng("everyday");
  const pick = (a) => r.pick(a);
  for (let d = "2023-06-22"; d <= END; d = addDays(d, 1)) {
    const wd = weekday(d), who = () => (r.next() < 0.6 ? ADA : SVEN), inWin = d >= START;
    // the card carries the family's shopping
    if (r.next() < 0.36) { card(r, d, pick(MER.grocer), cents(r, 38, 214), "GROCERIES", who()); count("purchase"); }
    if (r.next() < 0.24) { card(r, d, pick(MER.cafe), cents(r, 5, 19), "DINING", who()); count("purchase"); }
    if ((wd === 5 || wd === 6) && r.next() < 0.45) { card(r, d, pick(MER.dine), cents(r, 28, 118), "DINING", who()); count("purchase"); }
    if (r.next() < 0.10) { card(r, d, pick(MER.fuel), cents(r, 48, 96), "TRANSPORT", who()); count("purchase"); }
    if (r.next() < 0.07) { card(r, d, pick(MER.shop), cents(r, 24, 240), "SHOPPING", who()); count("purchase"); }
    if (d.slice(8) === "09") { card(r, d, ["NORTHLIGHT STREAM", "ONLINE"], 1899, "SUBS", SVEN); count("purchase"); }
    if (d.slice(8) === "17") { card(r, d, ["TUNEBARN MUSIC", "ONLINE"], 1499, "SUBS", ADA); count("purchase"); }
    if (!inWin) continue;
    // Ada's debit card and direct debits
    if (r.next() < 0.11) { spend(HB, d, hbPos(pick(MER.chem)), cents(r, 9, 64), "HEALTH"); count("purchase"); }
    if (r.next() < 0.13 && isBiz(d)) { spend(HB, d, hbPos(pick(MER.park)), r.pick([450, 720, 900]), "TRANSPORT"); count("purchase"); }
    if (d.slice(8) === "03") { spend(HB, d, "DIRECT DEBIT MAGPIE MOBILE 88412", 3900, "TELCO"); spend(HB, d, "DIRECT DEBIT ISLANDFIBRE NBN 20771", 8900, "TELCO"); count("purchase", 2); }
    if (d.slice(8) === "01") { spend(HB, d, "ACCOUNT KEEPING FEE", 500, "FEES"); count("purchase"); }
    if (d.slice(8) === "12") { spend(HB, d, "PAY ANYONE N OKAFOR MUM", 15000, "GIFTS"); count("transfer_out_of_household"); }
    if (wd === 1 && (dayDiff("2023-07-03", d) % 14 === 0)) { spend(HB, d, "OSKO F OKAFOR-LINDQVIST POCKET MONEY", 4000, "PERSONAL"); count("transfer_out_of_household"); }
    if (wd === 3 && r.next() < 0.25) { spend(HB, d, "DIRECT DEBIT MRS ABARA CELLO STUDIO", 5500, "KIDS-ACT"); count("purchase"); }
    // Sven's card
    if (r.next() < 0.20 && isBiz(d)) { spend(WT, d, wtPos(pick(MER.lunch), d), cents(r, 9, 24), "DINING"); count("purchase"); }
    if (r.next() < 0.05) { spend(WT, d, wtPos(pick(MER.shop), d), cents(r, 18, 160), "SHOPPING"); count("purchase"); }
    if (d.slice(8) === "05") { spend(WT, d, "BUPAW HEALTH DIRECT DEBIT 7730021", d < "2025-04-01" ? 28460 : 29980, "HEALTH"); spend(WT, d, "IRONKELP GYM FORTNIGHT PACK", 5800, "PERSONAL"); count("purchase", 2); }
    // three terms of school fees, then the fourth
    if (["02-08", "04-30", "07-23", "10-15"].includes(d.slice(5))) { spend(HB, d, "BPAY MOUNTAIN RIVER COLLEGE 448120", 118000, "KIDS-ACT"); count("purchase"); }
  }
  // medicare and the health fund pay money back: lower spending, never income
  const backs = [["2023-09-14", 4120], ["2024-02-20", 8635], ["2024-11-07", 4120], ["2025-05-19", 12040], ["2026-02-11", 4385]];
  for (const [d, c] of backs) { spend(HB, addDays(d, -2), "DEBIT CARD PURCHASE RIDGELINE FAMILY MEDICAL LINDISFARNE AUS", c + 3800, "HEALTH"); line(WT, d, "MEDICARE BENEFIT 00412", c, { lens: "spending", cat: "HEALTH" }); count("purchase"); count("health_rebate"); }
  const fund = line(WT, "2025-02-06", "BUPAW CLAIM PAYMENT 7730021", 18500, { lens: "spending", cat: "HEALTH" });
  spend(HB, "2025-02-03", "DEBIT CARD PURCHASE BRIGHT BAY DENTAL ROSNY PARK AUS", 41000, "HEALTH"); count("purchase"); count("health_rebate");
  trap("T-HEALTH-REBATE", "Medicare and health-fund credits", `${WT} on ${backs.map((b) => b[0]).join(", ")} and ${fund.date}`, "A credit from a health payer lowers HEALTH spending. It is not income.",
    { kind: "lines", lines: [...backs.map(([d, c]) => ({ account: WT, date: d, cents: c, want: "spending" })), { account: WT, date: fund.date, cents: 18500, want: "spending" }] });
  // card-paid annual policies
  for (const y of [2023, 2024, 2025]) { const d = `${y}-08-16`; card(r, d, ["PURRSURE MOTOR", "ONLINE"], 104820 + (y - 2023) * 6100, "CAR", ADA); count("purchase"); }
  for (const d of ["2024-06-11", "2025-06-17"]) { card(r, d, ["KELSO AUTOCARE", "CAMBRIDGE"], cents(r, 380, 640), "CAR", SVEN); count("purchase"); }
  // birthday money, from Sven's father
  const gifts = ["2024-03-18", "2025-03-18", "2026-03-18"];
  for (const d of gifts) { earn(WT, d, "TFR FROM L LINDQVIST BIRTHDAY", 50000, "GIFT-IN"); count("gift_in"); }
  trap("T-GIFT-IN", "Birthday money from a relative outside the household", `${WT} on ${gifts.join(", ")}, "TFR FROM L LINDQVIST BIRTHDAY", shares a surname with Sven`, "A gift counts as income (GIFT-IN). It is not a transfer between own accounts.",
    { kind: "lines", lines: gifts.map((d) => ({ account: WT, date: d, cents: 50000, want: "income" })) });
  // Ada's mother, in the month the family could least afford it, and every month
  spend(HB, "2024-12-03", "PAY ANYONE N OKAFOR MEDICAL HELP", 250000, "GIFTS"); count("transfer_out_of_household");
  trap("T-RELATIVE", "Transfer to a relative outside the household", `${HB}, monthly "PAY ANYONE N OKAFOR MUM" on the 12th and one of 2,500.00 on 2024-12-03`, "Money that left the household: spending. Ada's surname is on the line, but no own account receives it.",
    { kind: "lines", lines: [{ account: HB, date: "2024-12-03", cents: -250000, want: "spending" }, { account: HB, date: "2023-08-12", cents: -15000, want: "spending" }, { account: HB, date: "2025-08-12", cents: -15000, want: "spending" }] });
  const pocket = B.lines.filter((x) => /POCKET MONEY/.test(x.desc));
  trap("T-TEEN-ACCOUNT", "Pocket money to the teenager's own bank account", `${HB}, fortnightly "OSKO F OKAFOR-LINDQVIST POCKET MONEY", a dependant whose account the family does not track`, "Spending. A household member's name does not make it an own-account transfer.",
    { kind: "lines", lines: [pocket[0], pocket[30], pocket[60]].map((x) => ({ account: HB, date: x.date, cents: x.cents, want: "spending" })) });
  return r;
}

// ---------- pay. Ada fortnightly, Sven monthly with one change of employer ----------
const PAY = { slips: [] };
const GREYWATER = "Greywater Health Service", TESSELLATE = "Tessellate Marine Pty Ltd", SOUTHLIGHT = "Southlight Survey Pty Ltd";
const sgRate = (d) => (d < "2024-07-01" ? 11 : d < "2025-07-01" ? 11.5 : 12);
function slip(person, employer, payDate, from, to, gross, taxRate) {
  const tax = Math.round(gross * taxRate / 100) * 100, sg = Math.round(gross * sgRate(payDate) / 100), net = gross - tax;
  const s = { person, employer, payDate, from, to, gross, tax, super: sg, net, fy: fyOf(payDate) };
  PAY.slips.push(s); count("payslip");
  return s;
}
function payroll() {
  const r = rng("payroll");
  // Ada: a nurse, fortnightly on Thursdays, with overtime that moves every pay
  for (let d = "2023-07-06"; d <= END; d = addDays(d, 14)) {
    const base = d < "2024-07-01" ? 341840 : d < "2025-07-01" ? 353800 : 364400;
    const ot = r.pick([0, 0, 12480, 18720, 24960, 37440]);
    // the enterprise agreement's back pay lands in one pay
    const back = d === "2024-11-14" ? 214060 : 0;
    const s = slip(ADA, GREYWATER, d, addDays(d, -11), addDays(d, -4), base + ot + back, d < "2024-07-01" ? 0.262 : 0.25);
    s.bank = [[HB, d, "SALARY GREYWATER COMM HEALTH 0042118", s.net]];
    if (d >= "2024-02-01") { s.bank = [[HB, d, "SALARY GREYWATER COMM HEALTH 0042118", s.net - 40000], [JT, d, "GREYWATER COMM HEALTH SALARY SPLIT", 40000]]; s.split = true; }
    s.to = addDays(d, -4); s.acctLast = "4219";
    for (const [a, dd, desc, c] of s.bank) earn(a, dd, desc, c, "SALARY");
    count("wage_bank_line", s.bank.length);
  }
  // Sven at Tessellate, monthly on the 28th
  for (const ym of monthRange("2023-07", "2024-10")) {
    const d = prevBiz(`${ym}-28`), bonus = ym === "2023-09" ? 400000 : 0;
    const s = slip(SVEN, TESSELLATE, d, `${ym}-01`, monthEnd(ym), 925000 + bonus, 0.3);
    s.acctLast = "4403"; earn(WT, d, "TESSELLATE MARINE PAYROLL", s.net, "SALARY"); count("wage_bank_line");
  }
  // his final pay is a separate run with his leave paid out; then eleven days between jobs
  const fin = slip(SVEN, TESSELLATE, "2024-11-07", "2024-10-01", "2024-10-31", 781246, 0.33);
  fin.acctLast = "4403"; earn(WT, fin.payDate, "TESSELLATE MARINE PAYROLL FINAL", fin.net, "SALARY"); count("wage_bank_line");
  // Southlight pays on the last working day through a bureau, whose name is what the bank shows
  for (const ym of monthRange("2024-11", "2026-06")) {
    const d = lastBiz(ym), base = ym < "2025-07" ? 1010000 : 1042000, gross = ym === "2024-11" ? Math.round(1010000 * 13 / 30) : base;
    const s = slip(SVEN, SOUTHLIGHT, d, ym === "2024-11" ? "2024-11-18" : `${ym}-01`, monthEnd(ym), gross, 0.285);
    s.acctLast = "4403";
    // the June 2025 pay is dated the 30th and reaches the bank on the 1st
    const dd = d === "2025-06-30" ? "2025-07-01" : d;
    earn(WT, dd, `SOUTHPAY 77120 SALARY ${ym.replace("-", "")}`, s.net, "SALARY"); count("wage_bank_line");
  }
  const splits = PAY.slips.filter((s) => s.split);
  trap("T-NET-PAY-SPLIT", "One payslip, two bank credits", `Ada from 2024-02-01: each payslip's net reaches ${HB} less 400.00 and ${JT} 400.00, ${splits.length} pays`, "Both credits clear the one payslip. Cash income is the net once, wage not doubled, no open payroll clearing.",
    { kind: "split", employer: GREYWATER, pays: splits.length, sample: splits.slice(0, 3).map((s) => ({ pay_date: s.payDate, net: s.net })) , lines: splits.flatMap((s, i) => (i < 6 ? s.bank.map(([a, dd, , c]) => ({ account: a, date: dd, cents: c, want: "income" })) : [])) });
  trap("T-EMPLOYER-CHANGE", "Employer change, final pay with leave, payroll bureau on the bank line", `Sven: last Tessellate pay ${fin.payDate} (${money(fin.net)}); Southlight from 2024-11-29, bank lines read "SOUTHPAY 77120 SALARY", a name the household never gave`, "Each bank line clears a payslip from the right employer. Salary, counted once, across the change.",
    { kind: "lines", lines: [{ account: WT, date: fin.payDate, cents: fin.net, want: "income" }, ...PAY.slips.filter((s) => s.employer === SOUTHLIGHT).slice(0, 4).map((s) => ({ account: WT, date: s.payDate, cents: s.net, want: "income" }))] });
  const late = PAY.slips.find((s) => s.payDate === "2025-06-30");
  trap("T-PAY-STRADDLE", "Pay dated 30 June, banked 1 July", `Sven's Southlight pay of ${money(late.net)}: payslip 2025-06-30, ${WT} 2025-07-01`, "Cash income lands in July, when the money arrived.",
    { kind: "lines", lines: [{ account: WT, date: "2025-07-01", cents: late.net, want: "income", month: "2025-07" }] });
}

// ---------- the employer pays Sven back ----------
function reimbursement() {
  const r = rng("reimbursement");
  const a = card(r, "2024-03-11", ["SKYBRIDGE AIR", "ONLINE"], 68420, null, SVEN, { lens: null });
  const b = card(r, "2024-03-19", ["QUAYSIDE SUITES", "BURNIE"], 41200, null, SVEN, { lens: null });
  const c = line(WT, "2024-04-09", "TESSELLATE MARINE EXP REIMB 8841", 109620, {});
  const e = card(r, "2025-10-14", ["CITY PARKING METER", "LAUNCESTON"], 8640, null, SVEN, { lens: null });
  const f = line(WT, "2025-11-06", "SOUTHPAY 77120 EXPENSES", 8640, {});
  count("employer_reimbursement", 2);
  trap("T-REIMBURSEMENT", "Employer reimbursement by separate bank credit", `Sven paid work costs on ${CC} on ${a.date}, ${b.date}, ${e.date}; repaid to ${WT} ${c.date} (1,096.20) and ${f.date} (86.40), with the employer's or bureau's name on the line`, "SPEC 4.4c: neither income nor spending. The credit is not a wage.",
    { kind: "lines", lines: [{ account: WT, date: c.date, cents: c.cents, want: "neither" }, { account: WT, date: f.date, cents: f.cents, want: "neither" }, { account: CC, date: a.date, cents: a.cents, want: "neither" }, { account: CC, date: b.date, cents: b.cents, want: "neither" }, { account: CC, date: e.date, cents: e.cents, want: "neither" }] });
}

// ---------- rent, then a unit with a loan ----------
const HOUSE = { price: 58500000, duty: 2193500, legal: 178000, adjust: 41235, loan: 46800000, settled: "2025-01-15", depositOn: "2024-11-25", deposit: 5850000 };
HOUSE.cost = HOUSE.price + HOUSE.duty + HOUSE.legal + HOUSE.adjust; HOUSE.cash = HOUSE.cost - HOUSE.loan;
const RATES = [["2025-01-15", "6.09"], ["2025-02-25", "5.84"], ["2025-05-27", "5.59"], ["2025-08-19", "5.34"]];
const rateOn = (d) => { let x = RATES[0][1]; for (const [f, v] of RATES) if (d >= f) x = v; return x; };
const LOANS = { home: [], car: [], carLines: [] };
const dailyInterest = (bal, pct) => Math.abs(bal) * Number(pct) / 100 / 365;

function rent() {
  const dates = [];
  for (let d = "2023-07-05"; d <= "2025-01-08"; d = addDays(d, 14)) dates.push(d);
  for (const d of dates) {
    const amt = d < "2024-07-01" ? 84000 : 88000;
    if (d === "2024-05-08") {
      // the agent's debit bounces on the bank's side, comes back, costs a fee, and goes through three days later
      const x = spend(HB, d, "DIRECT DEBIT HARCOURT VALE RE RENT 00412", amt, "x_RENT-PAID");
      const y = line(HB, "2024-05-09", "DISHONOUR REVERSAL HARCOURT VALE RE RENT 00412", amt, { lens: "spending", cat: "x_RENT-PAID" });
      const z = spend(HB, "2024-05-09", "DISHONOUR FEE", 900, "FEES");
      const w = spend(HB, "2024-05-13", "DIRECT DEBIT HARCOURT VALE RE RENT 00412", amt, "x_RENT-PAID");
      count("purchase", 2);
      trap("T-DISHONOUR", "A direct debit that bounces and is re-presented", `${HB}: rent ${x.date}, reversed ${y.date} with a 9.00 fee, debited again ${w.date}`, "The reversal cancels the first debit: rent counts once in May, the fee once, nothing is income.",
        { kind: "lines", lines: [{ account: HB, date: y.date, cents: y.cents, want: "spending" }, { account: HB, date: x.date, cents: x.cents, want: "spending" }, { account: HB, date: w.date, cents: w.cents, want: "spending" }, { account: HB, date: z.date, cents: z.cents, want: "spending" }] });
      continue;
    }
    spend(HB, d, "DIRECT DEBIT HARCOURT VALE RE RENT 00412", amt, "x_RENT-PAID"); count("rent_payment");
  }
  // the last rent is a part fortnight; the bond comes back after the move
  const last = spend(HB, "2025-01-15", "DIRECT DEBIT HARCOURT VALE RE FINAL RENT", 62860, "x_RENT-PAID"); count("rent_payment");
  const bond = line(HB, "2025-01-29", "RENTAL DEPOSIT AUTHORITY BOND REFUND", 252000, {});
  count("bond_refund");
  trap("T-BOND-REFUND", "Rental bond back after the move", `${HB} ${bond.date}, 2,520.00; the bond was never declared as an asset`, "Their own deposit coming back: neither income nor a refund of spending in the window. Net worth rises with the cash because the bond was not on the balance sheet.",
    { kind: "lines", lines: [{ account: HB, date: bond.date, cents: bond.cents, want: "neither" }] });
  trap("T-RENT-TO-MORTGAGE", "Rent stops and a mortgage starts on the same account", `${HB}: final rent ${last.date}, first home-loan debit 2025-02-20`, "Rent counts as spending to the last debit, and the new loan's repayment counts at its cash amount.",
    { kind: "lines", lines: [{ account: HB, date: last.date, cents: last.cents, want: "spending" }, { account: HB, date: "2025-02-20", cents: -283300, want: "spending" }] });
}

function buyTheUnit() {
  // ten per cent on exchange, the balance the day before settlement, both from the joint saver to the conveyancer's trust account
  const a = line(JT, HOUSE.depositOn, "TFR HAWTHORN LANE TRUST DEPOSIT", -HOUSE.deposit, { capital: true });
  const b = line(JT, "2025-01-14", "TFR HAWTHORN LANE TRUST SETTLEMENT", -(HOUSE.cash - HOUSE.deposit), { capital: true });
  count("asset_purchase");
  trap("T-SETTLEMENT", "Two cash payments behind one settlement figure", `${JT}: deposit ${a.date} (${money(HOUSE.deposit)}) and balance ${b.date} (${money(HOUSE.cash - HOUSE.deposit)}); settlement statement ${HOUSE.settled} shows cash paid ${money(HOUSE.cash)}, duty and legal inside it`, "Capital, not spending. Both debits clear the one settlement. No clearing left open.",
    { kind: "lines", lines: [{ account: JT, date: a.date, cents: a.cents, want: "neither" }, { account: JT, date: b.date, cents: b.cents, want: "neither" }] });
  // the home loan: daily interest at the rate of the day, charged on the last day of the month
  let bal = -HOUSE.loan, accrued = 0; const months = monthRange("2025-01", "2026-06"), pays = [];
  for (const ym of months) { if (ym >= "2025-02") pays.push([nextBiz(`${ym}-20`), 283300, HB, "WESTPAW HOME LOAN 417 REPAYMENT"]); }
  pays.push(["2025-08-22", 1000000, JT, "TFR WESTPAW HOME LOAN 417 EXTRA"]);
  for (const ym of months) {
    const open = bal; let paid = 0; const from = ym === "2025-01" ? HOUSE.settled : `${ym}-01`;
    for (let d = from; d <= monthEnd(ym); d = addDays(d, 1)) {
      for (const [pd, c, acct, desc] of pays) if (pd === d) { bal += c; paid += c; spend(acct, d, desc, c, "MORTGAGE"); count("loan_repayment"); }
      accrued += dailyInterest(bal, rateOn(d));
    }
    const interest = Math.round(accrued); accrued = 0; bal -= interest;
    LOANS.home.push({ ym, rate: rateOn(monthEnd(ym)), open, interest, paid, close: bal });
    count("loan_interest");
  }
  count("rate_notice", RATES.length - 1);
  trap("T-EXTRA-REPAYMENT", "A lump repayment from a different account", `${JT} 2025-08-22, 10,000.00 to the home loan; the usual debit comes from ${HB}`, "Spending at its cash amount under MORTGAGE, by SPEC 6.5, and the loan falls by it.",
    { kind: "lines", lines: [{ account: JT, date: "2025-08-22", cents: -1000000, want: "spending" }] });
}

function carLoan() {
  // owed since before the window. Repaid monthly from Sven's account, then paid out early from the saver
  let bal = -1864000, accrued = 0; const months = monthRange("2023-07", "2025-09"), payout = "2025-09-12";
  const push = (d, desc, c) => { bal += c; LOANS.carLines.push({ date: d, desc, cents: c, balance: bal }); return line(CL, d, desc, c, {}); };
  for (const ym of months) {
    const open = bal; let paid = 0, charged = 0;
    for (let d = `${ym}-01`; d <= monthEnd(ym); d = addDays(d, 1)) {
      if (d === nextBiz(`${ym}-03`) && d < payout) { push(d, "REPAYMENT DIRECT DEBIT", 41200); paid += 41200; spend(WT, d, "PING FINANCE LOAN REPAYMENT 40021877", 41200, "CAR"); count("loan_repayment"); }
      accrued += dailyInterest(bal, "7.95");
      if (d === payout) {
        const i = Math.round(accrued); accrued = 0; push(d, "INTEREST TO PAYOUT", -i); charged += i;
        const owed = -bal;
        own(JT, "2025-09-10", "TFR TO SVEN CAR PAYOUT", WT, "2025-09-11", "TFR FROM BARK BANK 7703", 900000);
        push(d, "PAYOUT RECEIVED THANK YOU", owed); paid += owed;
        const x = spend(WT, d, "PING FINANCE LOAN PAYOUT 40021877", owed, "CAR"); count("loan_repayment");
        const y = spend(WT, d, "PING FINANCE DISCHARGE FEE", 18000, "FEES"); count("purchase");
        LOANS.car.push({ ym, rate: "7.95", open, interest: charged, paid, close: bal });
        trap("T-CAR-PAYOUT", "Car loan paid out early", `${CL}: ${money(owed)} from ${WT} on ${d}, final interest the same day, a 180.00 fee as a separate debit, no statements after September 2025`, "The loan ends at exactly zero and stays there. The payout counts as spending at its cash amount (SPEC 6.5). The fee counts once.",
          { kind: "zero_after", account: CL, from: "2025-09", lines: [{ account: WT, date: x.date, cents: x.cents, want: "spending" }, { account: WT, date: y.date, cents: y.cents, want: "spending" }] });
        return;
      }
    }
    const i = Math.round(accrued); accrued = 0; push(monthEnd(ym), "INTEREST CHARGED", -i); charged += i;
    LOANS.car.push({ ym, rate: "7.95", open, interest: charged, paid, close: bal });
    count("loan_interest");
  }
}

// ---------- the bills that arrive as documents, and the bank lines that pay them ----------
const BILLS = { energy: [], rates: [], water: [], policy: [] };
function bills() {
  const r = rng("bills");
  for (const q of ["2023-09", "2023-12", "2024-03", "2024-06", "2024-09", "2024-12", "2025-03", "2025-06", "2025-09", "2025-12", "2026-03"]) {
    const billDate = `${nextMonth(q)}-04`, amt = cents(r, 260, 610), gst = Math.round(amt / 11), paid = addDays(billDate, 18);
    BILLS.energy.push({ billDate, due: addDays(billDate, 21), from: addDays(`${q}-01`, -61), to: monthEnd(q), amt, gst, account: q < "2025-02" ? "TG-5504118" : "TG-5504118" });
    spend(HB, paid, "BPAY TASGLOW ENERGY 5504118", amt, "UTILITIES"); count("bill_paid");
  }
  for (const q of ["2025-03", "2025-06", "2025-09", "2025-12", "2026-03", "2026-06"]) {
    const amt = cents(r, 395, 440), billDate = `${q}-01`, due = `${q}-28`;
    BILLS.rates.push({ billDate, due, from: `${q}-01`, to: monthEnd(nextMonth(nextMonth(q))), amt, reference: `RN-${q.replace("-", "")}-2281` });
    spend(HB, addDays(due, -4), "BPAY EASTERN SHORE COUNCIL 2281470", amt, "RATES-HOME"); count("bill_paid");
    const usage = cents(r, 42, 96), service = 8820, wb = `${q}-11`, wd = `${q}-27`;
    BILLS.water.push({ billDate: wb, due: wd, from: addDays(wb, -92), to: addDays(wb, -2), usage, service, amt: usage + service });
    spend(HB, addDays(wd, -1), "BPAY RIVERLINE WATER 70118204", usage + service, "UTILITIES"); count("bill_paid");
    spend(HB, nextBiz(`${q}-16`), "BPAY CORNERSTONE STRATA LOT 4 PETREL", 46500, "HOME-MAINT"); count("bill_paid");
  }
  for (const [d, amt] of [["2023-10-02", 62480], ["2024-10-02", 67110]]) { spend(HB, d, "PURRSURE CONTENTS RENEWAL PC-22817", amt, "HOME-INS"); count("bill_paid"); }
  for (const [from, to, amt] of [["2025-01-15", "2026-01-14", 148760], ["2026-01-15", "2027-01-14", 157240]]) {
    BILLS.policy.push({ from, to, amt, paid: addDays(from, -3), sum: 62000000, excess: 75000, number: "PH-90418226" });
    spend(HB, addDays(from, -3), "PURRSURE HOME PH-90418226", amt, "HOME-INS"); count("bill_paid");
  }
  trap("T-BILL-WITNESS", "A bill document and the bank line that pays it", `${BILLS.energy.length} electricity emails, ${BILLS.rates.length} rates notices, ${BILLS.water.length} water bills beside their BPAY lines on ${HB}`, "The bank line recognises the spending. The bill never adds a second cost.",
    { kind: "lines", lines: [{ account: HB, date: addDays(BILLS.energy[0].billDate, 18), cents: -BILLS.energy[0].amt, want: "spending", once: true }, { account: HB, date: addDays(BILLS.rates[0].due, -4), cents: -BILLS.rates[0].amt, want: "spending", once: true }] });
}

// ---------- super. Different cadence, different shape, one fund each ----------
const SUPER = { ada: [], sven: [] };
function superFunds() {
  const r = rng("super");
  const sumSuper = (emp, from, to) => PAY.slips.filter((s) => s.employer === emp && s.payDate >= from && s.payDate <= to).reduce((t, s) => t + s.super, 0);
  const contrib = (acc, list, d, desc, c) => { list.push({ acct: acc, date: d, type: "employer", desc, cents: c }); list.push({ acct: acc, date: d, type: "contributions_tax", desc: "Contributions tax", cents: -Math.round(c * 0.15) }); count("super_contribution"); };
  // Ada: her employer pays on the 10th of the next month
  for (const ym of MONTHS) {
    const prev = ym === "2023-07" ? null : monthRange("2023-07", ym).slice(-2)[0];
    const c = prev ? sumSuper(GREYWATER, `${prev}-01`, monthEnd(prev)) : 81244;
    if (c) contrib(SA, SUPER.ada, `${ym}-10`, `SG contribution ${GREYWATER}`, c);
  }
  // Sven: Tessellate pays quarterly, late in the month after the quarter, so his last contribution arrives after he has gone
  const q = [["2023-07-26", null], ["2023-10-24", ["2023-07-01", "2023-09-30"]], ["2024-01-24", ["2023-10-01", "2023-12-31"]], ["2024-04-23", ["2024-01-01", "2024-03-31"]], ["2024-07-23", ["2024-04-01", "2024-06-30"]], ["2024-10-22", ["2024-07-01", "2024-09-30"]], ["2025-01-21", ["2024-10-01", "2024-12-31"]]];
  for (const [d, range] of q) contrib(SS, SUPER.sven, d, `SG contribution ${TESSELLATE}`, range ? sumSuper(TESSELLATE, range[0], range[1]) : 305250);
  for (const ym of monthRange("2024-12", "2026-06")) {
    const prev = monthRange("2024-11", ym).slice(-2)[0], c = sumSuper(SOUTHLIGHT, `${prev}-01`, monthEnd(prev));
    if (c) contrib(SS, SUPER.sven, `${ym}-14`, "SG contribution Southpay clearing", c);
  }
  const roll = (list, acc, open, fee, ins) => {
    let bal = open; const out = [];
    for (const ym of MONTHS) {
      for (const x of list.filter((l) => ymOf(l.date) === ym).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))) { bal += x.cents; out.push({ ...x, balance: bal }); }
      const e = monthEnd(ym), earnPct = r.range(-0.011, 0.017), earned = Math.round(bal * earnPct);
      bal += earned; out.push({ acct: acc, date: e, type: "earnings", desc: "Investment earnings", cents: earned, balance: bal });
      bal -= fee; out.push({ acct: acc, date: e, type: "fee", desc: "Administration fee", cents: -fee, balance: bal });
      bal -= ins; out.push({ acct: acc, date: e, type: "insurance", desc: "Insurance premium", cents: -ins, balance: bal });
    }
    return out;
  };
  SUPER.ada = roll(SUPER.ada, SA, 14823317, 750, 3820);
  SUPER.sven = roll(SUPER.sven, SS, 21190452, 1100, 6240);
  for (const x of [...SUPER.ada, ...SUPER.sven]) line(x.acct, x.date, x.desc, x.cents, { superType: x.type });
  trap("T-SUPER-FORMAT", "The fund changes its export format mid-history", `${SS}: Purrannuation CSV v1 to December 2024, v2 after`, "Both formats read; the balance chain carries across the change.",
    { kind: "balance", account: SS, months: ["2024-12", "2025-01", "2025-02"] });
  trap("T-SG-LAG", "Super guarantee arrives after the employment ends", `${SS} 2025-01-21: Tessellate's last quarterly contribution, 11 weeks after Sven left`, "Reaches the fund; a contract that has ended still clears.",
    { kind: "balance", account: SS, months: ["2025-01"] });
}

// ---------- shares ----------
const SEC = { QZT: { name: "Quartz Tasman Ltd", p: 11420 }, KLP: { name: "Kelpie Foods Ltd", p: 6130 }, HRX: { name: "Huon Renewables Ltd", p: 2875 } };
const SHARES = { months: {}, trades: [], divs: [] };
function shares() {
  const r = rng("shares");
  const start = { QZT: 2500, KLP: 4000, HRX: 0 }, curve = {};
  for (const c of Object.keys(SEC)) { let p = SEC[c].p; curve[c] = {}; for (const ym of ["2023-06", ...MONTHS]) { p = Math.round(p * (1 + r.range(-0.055, 0.064))); curve[c][ym] = p; } }
  const trades = [
    { d: "2023-11-14", settle: "2023-11-16", side: "buy", code: "QZT", units: 400, ref: "CN-204417", fund: ["2023-11-10", 480000] },
    { d: "2024-03-04", settle: "2024-03-06", side: "buy", code: "HRX", units: 300, ref: "CN-211863", fund: ["2024-02-28", 120000] },
    { d: "2024-05-30", settle: "2024-06-03", side: "buy", code: "KLP", units: 500, ref: "CN-217740", fund: ["2024-05-24", 250000] },
    { d: "2024-10-16", settle: "2024-10-18", side: "sell", code: "KLP", units: 4500, ref: "CN-226015" },
    { d: "2025-11-05", settle: "2025-11-07", side: "buy", code: "HRX", units: 200, ref: "CN-251296", fund: ["2025-10-30", 90000] },
  ];
  for (const t of trades) {
    const p = Math.round(curve[t.code][ymOf(t.d)] * (1 + r.range(-0.02, 0.02))), gross = Math.round(t.units * p / 10), brokerage = 1995;
    Object.assign(t, { price: (p / 1000).toFixed(3), gross, brokerage, total: t.side === "buy" ? gross + brokerage : gross - brokerage, name: SEC[t.code].name });
    SHARES.trades.push(t); count("trade");
    if (t.fund) own(HB, t.fund[0], "BPAY CEDAR TRADE 8841207", BK, bizAfter(t.fund[0], 1), "BPAY RECEIVED", t.fund[1], { reference: `DEP-${t.ref.slice(3)}` });
    line(BK, t.settle, `${t.side === "buy" ? "BUY" : "SELL"} ${t.units} ${t.code} @ ${t.price}`, t.side === "buy" ? -t.total : t.total, { reference: t.ref, trade: true });
    // between trade and settlement the holding has moved and the cash has not: the household owes the broker, or the broker owes it
    B.transit.push({ from: t.d, until: t.settle, cents: t.side === "buy" ? -t.total : t.total });
  }
  own(BK, "2024-10-21", "WITHDRAWAL TO BANK", JT, "2024-10-22", "CEDAR TRADE WITHDRAWAL", 2000000, { reference: "WD-226015" });
  // dividends: Quartz pays to Sven's bank, the others to the broker's cash account
  const unitsOn = (code, d) => { let u = start[code]; for (const t of trades) if (t.code === code && t.d <= d) u += t.side === "buy" ? t.units : -t.units; return u; };
  const divs = [], shift = { QZT: 0, KLP: 5, HRX: 11 };
  for (const y of [2023, 2024, 2025, 2026]) for (const [m, day] of [["03", "21"], ["09", "19"]]) {
    for (const [code, ps, frank] of [["QZT", 31, 1], ["KLP", 18, 0.7], ["HRX", 12, 0]]) {
      const d = nextBiz(addDays(`${y}-${m}-${day}`, shift[code])); if (d < START || d > END) continue;
      const units = unitsOn(code, addDays(d, -14)); if (!units) continue;
      const net = units * ps, franked = Math.round(net * frank), unfranked = net - franked, credit = Math.round(franked * 30 / 70);
      divs.push({ code, name: SEC[code].name, pay: d, units, ps, franked, unfranked, credit, net, final: m === "09" }); count("dividend");
      if (code === "QZT") earn(WT, d, `QZT DIVIDEND ${m === "09" ? "FINAL" : "INTERIM"} 00048812`, net, "DIVIDEND");
      else earn(BK, d, `${code} DIVIDEND`, net, "DIVIDEND", { reference: `DIV-${code}-${d.replace(/-/g, "").slice(2)}` });
    }
  }
  SHARES.divs = divs;
  for (const ym of ["2023-06", ...MONTHS]) {
    const e = monthEnd(ym);
    SHARES.months[ym] = Object.keys(SEC).map((c) => ({ code: c, name: SEC[c].name, units: unitsOn(c, e) })).filter((x) => x.units).map((x) => ({ ...x, price: (curve[x.code][ym] / 1000).toFixed(3), value: Math.round(x.units * curve[x.code][ym] / 10) }));
  }
  const mid = trades[2];
  const ds = divs.filter((x) => x.code === "QZT")[0], dk = divs.filter((x) => x.code === "KLP")[0];
  trap("T-DIVIDEND", "A dividend seen by the registry and by the cash line", `Computerpaw notices beside ${WT} (QZT) and ${BK} (KLP, HRX) credits, ${divs.length} payments`, "Income once, at the net amount, whichever account it reached.",
    { kind: "lines", lines: [{ account: WT, date: ds.pay, cents: ds.net, want: "income", once: true }, { account: BK, date: dk.pay, cents: dk.net, want: "income", once: true }] });
  trap("T-TRADE-STRADDLE", "A buy that settles after month end", `${mid.units} KLP bought ${mid.d}, settles ${mid.settle}; the holding shows the units at 2024-05-31, the broker's cash does not yet show the debit`, "Buying shares does not raise net worth. At 2024-05-31 the household owes the broker the consideration.",
    { kind: "networth", months: ["2024-05"] });
  trap("T-HOLDINGS-GAP", "A month's holdings file was never downloaded", `${SH}: no file for 2025-08-31`, "Only the file for that month is missing. The stale price must be flagged, not shown as the month's value.",
    { kind: "gap", account: SH, month: "2025-08", networth: true });
}

// ---------- tax. A refund each year, for each adult, reaching different accounts ----------
const TAX = { notices: [] };
function scale(fy, ti) {
  const b = fy <= 2024 ? [[18200, 0], [45000, 0.19], [120000, 0.325], [180000, 0.37], [1e12, 0.45]] : [[18200, 0], [45000, 0.16], [135000, 0.30], [190000, 0.37], [1e12, 0.45]];
  let tax = 0, lo = 0; const inc = ti / 100;
  for (const [hi, r] of b) { if (inc > lo) tax += (Math.min(inc, hi) - lo) * r; lo = hi; }
  return Math.round(tax * 100);
}
function taxes() {
  const noa = [
    { person: ADA, fy: 2023, lodged: "2023-08-16", assessed: "2023-08-29", refundOn: "2023-09-01", acct: HB, ti: 9214000, payg: 2268000 },
    { person: SVEN, fy: 2023, lodged: "2023-09-05", assessed: "2023-09-19", refundOn: "2023-09-22", acct: WT, ti: 12860000, payg: 3618000 },
    { person: ADA, fy: 2024, lodged: "2024-07-30", assessed: "2024-08-13", refundOn: "2024-08-16", acct: JT },
    { person: SVEN, fy: 2024, lodged: "2024-08-20", assessed: "2024-09-03", refundOn: "2024-09-06", acct: WT },
    { person: ADA, fy: 2025, lodged: "2025-08-05", assessed: "2025-08-19", refundOn: "2025-08-22", acct: JT },
    { person: SVEN, fy: 2025, lodged: "2025-09-16", assessed: "2025-10-02", refundOn: "2025-10-07", acct: WT },
  ];
  const inFy = (d, fy) => fyOf(d) === fy;
  for (const fy of [2023, 2024, 2025]) {
    interestThrough(`${fy}-06`);
    for (const n of noa.filter((x) => x.fy === fy)) {
      n.other = 0;
      if (n.ti == null) {
        const ss = PAY.slips.filter((s) => s.person === n.person && s.fy === fy), half = (c) => Math.round(c / 2);
        const interest = B.lines.filter((x) => x.acct === JT && x.cat === "INTEREST" && inFy(x.date, fy)).reduce((t, x) => t + x.cents, 0);
        const divs = SHARES.divs.filter((v) => inFy(v.pay, fy)), net = divs.reduce((t, v) => t + v.net, 0), frank = divs.reduce((t, v) => t + v.credit, 0);
        const sold = SHARES.trades.find((t) => t.side === "sell"), gain = fy === 2025 ? Math.max(0, Math.round((sold.total - 4000 * 520 - SHARES.trades[2].total) / 2)) : 0;
        n.ti = Math.floor((ss.reduce((t, s) => t + s.gross, 0) + half(interest) + half(net) + half(frank) + half(gain)) / 100 - 410) * 100;
        n.payg = ss.reduce((t, s) => t + s.tax, 0); n.other = half(frank);
      }
      n.gross = scale(n.fy, n.ti); n.medicare = Math.round(n.ti * 0.02); n.offsets = 0; n.help = 0;
      n.result = n.payg + n.other - n.gross - n.medicare;
      if (n.result <= 0) throw new Error(`no refund for ${n.person} FY${n.fy}: ${n.result}`);
      const last = n.person === ADA ? "5510083" : "5510291";
      line(n.acct, n.refundOn, `ATO EFT REFUND ${last}${String(n.fy).slice(2)}`, n.result, { refund: true });
      count("tax_refund"); TAX.notices.push(n);
    }
  }
  interestThrough("2026-06");
  trap("T-TAX-REFUND", "A refund a year each, reaching different accounts", `${noa.map((n) => `${n.person.split(" ")[0]} FY${n.fy} ${n.refundOn} to ${n.acct}`).join("; ")}`, "Neither income nor spending: TAX-REFUND is a transfer with the tax position (SPEC 6.5, 9). Ada's later refunds land in the joint saver.",
    { kind: "lines", lines: noa.map((n) => ({ account: n.acct, date: n.refundOn, cents: n.result, want: "neither" })) });
}

// ---------- own-account transfers, the card, the traps that sit on card lines ----------
function plumbing() {
  // Sven pays Ada his share of the housing on the first business day
  for (const ym of MONTHS) { const d = nextBiz(`${ym}-01`), c = ym < "2025-02" ? 240000 : 300000; own(WT, d, "OSKO TO A OKAFOR HOUSE SHARE", HB, d, "OSKO FROM S LINDQVIST HOUSE SHARE", c); }
  // both sweep to the joint saver mid month, in the same amount some months
  for (const ym of MONTHS) {
    const d = nextBiz(`${ym}-16`), a = ym < "2025-02" ? 100000 : 60000, b = 200000;
    own(HB, d, "TFR TO JOINT SAVER 7703", JT, bizAfter(d, 1), "TFR FROM A OKAFOR HARBOUR", a);
    own(WT, d, "TFR TO BARK 881207703", JT, bizAfter(d, 1), "TFR FROM S LINDQVIST WATTLE", b);
  }
  // a top-up on the last day of February reaches the saver in March
  own(WT, "2024-02-29", "TFR TO BARK 881207703", JT, "2024-03-01", "TFR FROM S LINDQVIST WATTLE Value Date: 29/02/2024", 75000);
  trap("T-TRANSFER-STRADDLE", "A transfer between own accounts across a month end", `${WT} 2024-02-29 to ${JT} 2024-03-01, 750.00`, "Each account's balance is as its bank says. The money is the household's while it is in the air, so net worth does not dip at 2024-02-29.",
    { kind: "networth", months: ["2024-02"], legs: [{ account: WT, date: "2024-02-29", cents: -75000 }, { account: JT, date: "2024-03-01", cents: 75000 }] });
  const r = rng("traps");
  const coffee = ["BEANS AND BOBBIN", "HOBART"];
  card(r, "2025-03-14", coffee, 580, "DINING", ADA, { posted: "2025-03-17" }); card(r, "2025-03-14", coffee, 580, "DINING", ADA, { posted: "2025-03-17" }); count("purchase", 2);
  trap("T-IDENTICAL-CARD", "Two identical coffees on one day", `${CC} 2025-03-14, BEANS AND BOBBIN 5.80 twice, on the statement and on the activity download`, "Two purchases. Not one, not four.",
    { kind: "lines", lines: [{ account: CC, date: "2025-03-14", cents: -580, want: "spending", n: 2 }] });
  for (let i = 0; i < 3; i++) spend(HB, "2024-06-27", hbPos(MER.park[0]), 450, "TRANSPORT"); count("purchase", 3);
  trap("T-IDENTICAL-OVERLAP", "Three identical parking meters inside an overlap", `${HB} 2024-06-27, 4.50 three times, in both the April to June and the June to September downloads`, "Three purchases: the largest count one source shows, not six.",
    { kind: "lines", lines: [{ account: HB, date: "2024-06-27", cents: -450, want: "spending", n: 3 }] });
  card(r, "2024-02-27", MER.shop[0], 18900, "SHOPPING", ADA, { posted: "2024-02-28" }); count("purchase");
  line(CC, "2024-03-04", "WOOLLEN FOX HOBART REFUND", 18900, { posted: "2024-03-05", csv: "WOOLLEN FOX               HOBART  TAS CREDIT", member: ADA, lens: "spending", cat: "SHOPPING" }); count("refund");
  trap("T-REFUND-MONTH", "A refund crossing a month", `${CC}: WOOLLEN FOX 189.00 charged 2024-02-27, credited 2024-03-04`, "February spending carries the charge. March spending falls by the refund. It is not income.",
    { kind: "lines", lines: [{ account: CC, date: "2024-03-04", cents: 18900, want: "spending" }, { account: CC, date: "2024-02-27", cents: -18900, want: "spending" }] });
  // a trip, in US dollars, with the fee the issuer adds
  const usd = [["2025-09-20", "CANYON OUTFITTERS", "DENVER", 12000, 18462], ["2025-09-22", "LOW COUNTRY GRILL", "AUSTIN", 6450, 9934], ["2025-09-24", "RED MESA LODGE", "SANTA FE", 41800, 64412]];
  for (const [d, n, t, us, au] of usd) {
    const desc = `${n} ${t} USD ${fix(us)}`;
    card(r, d, [n, t], au, "HOLIDAYS", SVEN, { desc, csv: `${n.padEnd(26)}${t}  USD ${fix(us)}` }); card(r, d, ["FOREIGN TRANSACTION FEE", ""], Math.round(au * 0.03), "FEES", SVEN, { desc: "FOREIGN TRANSACTION FEE", csv: "FOREIGN TRANSACTION FEE" }); count("purchase", 2);
  }
  card(r, "2024-01-08", ["SKYBRIDGE AIR", "ONLINE"], 92640, "HOLIDAYS", ADA); card(r, "2024-01-15", ["STRAHAN VILLAGE CABINS", "STRAHAN"], 118000, "HOLIDAYS", ADA); count("purchase", 2);
  trap("T-FOREIGN", "Foreign purchases with a separate fee", `${CC} 2025-09-20 to 2025-09-24, three USD purchases, each with a fee line`, "Spending in AUD as charged; the fee is its own line.",
    { kind: "lines", lines: [{ account: CC, date: usd[2][0], cents: -usd[2][4], want: "spending" }] });
  // a manual card payment from Sven at month end, which the card shows on the Monday
  own(WT, "2024-08-30", "BPAY AMEWX 41007", CC, "2024-09-02", "PAYMENT RECEIVED - THANK YOU", 60000, { posted: "2024-09-02", csv: "PAYMENT RECEIVED - THANK YOU", member: SVEN });
  trap("T-CARD-STRADDLE", "A card payment across a month end", `${WT} 2024-08-30, card ${CC} 2024-09-02, 600.00`, "A transfer, not spending, and net worth does not dip at 2024-08-31.",
    { kind: "networth", months: ["2024-08"], legs: [{ account: WT, date: "2024-08-30", cents: -60000 }, { account: CC, date: "2024-09-02", cents: 60000 }] });
}
const HB_WINDOWS = [["2023-07-01", "2023-09-30", "2023-10-02"], ["2023-09-24", "2023-12-31", "2024-01-03"], ["2024-01-01", "2024-03-31", "2024-04-02"], ["2024-03-28", "2024-06-30", "2024-07-01"], ["2024-06-22", "2024-09-30", "2024-10-01"], ["2024-10-01", "2024-12-31", "2025-01-02"], ["2025-01-01", "2025-03-31", "2025-04-01"], ["2025-04-01", "2025-06-30", "2025-07-01"], ["2025-07-01", "2025-09-30", "2025-10-01"], ["2025-10-01", "2025-12-31", "2026-01-02"], ["2026-01-01", "2026-03-31", "2026-04-01"], ["2026-04-01", "2026-06-30", "2026-07-01"]];
/* traps that live in how the files were downloaded, not in the money */
function fileTraps() {
  const plain = (x, want) => ({ account: x.acct, date: x.date, cents: x.cents, want });
  const kindOf = (x) => (x.lens ? x.lens : "neither");
  const inOverlap = (a, from, to) => B.lines.filter((x) => x.acct === a && x.date >= from && x.date <= to && !/PARKING METER/.test(x.desc)).sort(byTime);
  const samples = [...inOverlap(HB, "2023-09-24", "2023-09-30").slice(0, 3), ...inOverlap(HB, "2024-03-28", "2024-03-31").slice(0, 2), ...inOverlap(HB, "2024-06-22", "2024-06-30").slice(0, 2), ...inOverlap(JT, "2024-12-20", "2024-12-31").slice(0, 3)];
  trap("T-OVERLAP", "Overlapping downloads", `${HB}: 2023-09-24 to 09-30, 2024-03-28 to 03-31, 2024-06-22 to 06-30 are in two files each. ${JT}: 2024-12-20 to 12-31. ${CC}: activity from 2024-09-25`, "One line, two witnesses. No line counted twice, and the balance chain holds.",
    { kind: "lines", lines: samples.map((x) => ({ ...plain(x, kindOf(x)), n: 1 })), balances: [{ account: HB, months: ["2023-09", "2023-10", "2024-03", "2024-04", "2024-06", "2024-07"] }, { account: JT, months: ["2024-12", "2025-01"] }] });
  trap("T-REDOWNLOAD", "The same file saved again under another name", `${HB}: January to March 2024, again in the folder for 2024-07-01 with " (1)" in its name`, "Same bytes, same source. Nothing added.",
    { kind: "duplicate", path: `sources/${HB}/2024-07-01/Harbour_2024-01-01_2024-03-31 (1).csv` });
  const hole = B.lines.filter((x) => x.acct === WT && x.date >= "2026-04-12" && x.date <= "2026-04-20");
  trap("T-MISSING-STRETCH", "Nine days of bank lines nobody downloaded", `${WT}: no file holds 2026-04-12 to 2026-04-20, ${hole.length} lines worth ${money(hole.reduce((t, x) => t + x.cents, 0))}. The April file stops short, the May file starts late, and neither says so`, "The engine cannot know the lines. It must say the balance does not chain, for that account and those dates.",
    { kind: "hole", account: WT, month: "2026-04", net_cents: hole.reduce((t, x) => t + x.cents, 0), line_count: hole.length });
  const lagged = B.lines.filter((x) => x.acct === CC && x.cents < 0 && x.posted && x.posted !== x.date), lagDays = {};
  for (const x of lagged) { const d = dayDiff(x.date, x.posted); lagDays[d] = (lagDays[d] || 0) + 1; }
  trap("T-POSTING-LAG", "Every card line in two files, dated differently", `${CC}: ${lagged.length} lines post after they are charged, by ${Object.entries(lagDays).map(([d, n]) => `${d} days (${n})`).join(", ")}. The monthly statement shows the charge date, the quarterly activity file the posting date`, "One purchase, two witnesses, whatever the gap. A line the engine cannot match across files is asked about, not counted twice in silence.",
    { kind: "card_lag", account: CC, lagged: lagged.length, by_days: lagDays });
  const cross = B.lines.filter((x) => x.acct === CC && x.lens === "spending" && x.date >= START && x.posted && ymOf(x.posted) !== ymOf(x.date)).sort(byTime);
  trap("T-DATE-BASIS", "A card charge dated in one month, posted in the next", `${CC}: ${cross.length} lines. The statement dates by transaction, the activity download by posting. Six sampled`, "SPEC 6.5: a purchase counts when charged. The line belongs to the month of its transaction date, and is one line.",
    { kind: "lines", lines: [0, 1, 2, 3, 4, 5].map((i) => cross[Math.floor(i * cross.length / 6)]).map((x) => ({ ...plain(x, "spending"), n: 1, month: ymOf(x.date), posted: x.posted })) });
}
const CARD = { statements: [] };
function settleCard() {
  let prev = 184250;
  for (let start = "2023-06-22"; start <= "2026-05-22"; ) {
    const ym = nextMonth(start.slice(0, 7)), end = `${ym}-21`;
    const inP = B.lines.filter((x) => x.acct === CC && (x.posted || x.date) >= start && (x.posted || x.date) <= end);
    const charges = inP.filter((x) => x.cents < 0).reduce((t, x) => t - x.cents, 0), credits = inP.filter((x) => x.cents > 0).reduce((t, x) => t + x.cents, 0);
    const close = prev + charges - credits;
    CARD.statements.push({ start, end, prev, charges, credits, close, lines: inP.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.seq - b.seq)) });
    const due = nextBiz(`${nextMonth(ym)}-14`), extra = B.lines.filter((x) => x.acct === CC && x.cents > 0 && x.xfer && (x.posted || x.date) > end && (x.posted || x.date) <= due).reduce((t, x) => t + x.cents, 0);
    if (due <= END) {
      const pay = close - extra, posted = bizAfter(due, 1);
      if (pay > 0) own(HB, due, "AMEWX DIRECT DEBIT 41007", CC, posted, "PAYMENT RECEIVED - THANK YOU", pay, { posted, csv: "PAYMENT RECEIVED - THANK YOU", member: ADA });
    }
    prev = close; start = addDays(end, 1);
  }
}
const SAVER = { bal: 9825000, done: new Set() };
function interestThrough(last) {
  for (const ym of MONTHS) {
    if (ym > last || SAVER.done.has(ym)) continue;
    SAVER.bal += B.lines.filter((x) => x.acct === JT && ymOf(x.date) === ym).reduce((t, x) => t + x.cents, 0);
    const i = Math.round(SAVER.bal * 0.041 / 12);
    earn(JT, monthEnd(ym), "INTEREST CREDIT", i, "INTEREST"); SAVER.bal += i; SAVER.done.add(ym); count("interest_credit");
  }
}

// ---------- truth, from the simulation alone ----------
const OPEN = { [HB]: 341277, [WT]: 523014, [JT]: 9825000, [CC]: -184250, [BK]: 120433, [CL]: -1864000, [SA]: 14823317, [SS]: 21190452 };
const byTime = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.seq - b.seq);
function chain(acct) { let bal = OPEN[acct]; return B.lines.filter((x) => x.acct === acct).sort(byTime).map((x) => { bal += x.cents; x.balance = bal; return x; }); }
const VALUATIONS = [["2025-03-31", 59100000], ["2025-06-30", 59400000], ["2025-09-30", 60250000], ["2025-12-31", 60800000], ["2026-03-31", 61900000], ["2026-06-30", 62300000]];
const CAR_VALUE = 2400000;
function truth() {
  const chains = {}; for (const a of [HB, WT, JT, CC, BK, CL, SA, SS]) chains[a] = chain(a);
  const balances = {}, assets = [HB, WT, JT, CC, BK, SH, HL, CL, SA, SS, UN, CR];
  for (const a of assets) balances[a] = {};
  const income = {}, spending = {}, byCat = {}, networth = {}, transit = {};
  for (const m of MONTHS) { income[m] = 0; spending[m] = 0; byCat[m] = {}; }
  for (const x of B.lines) {
    const m = ymOf(x.date); if (!x.lens || !(m in income)) continue;
    if (!CASH.includes(x.acct)) throw new Error(`lens on a non-cash account ${x.acct}`);
    if (x.lens === "income") income[m] += x.cents; else { spending[m] -= x.cents; byCat[m][x.cat] = (byCat[m][x.cat] || 0) - x.cents; }
  }
  for (const m of MONTHS) {
    const e = monthEnd(m);
    for (const a of Object.keys(chains)) { const upTo = chains[a].filter((x) => x.date <= e), last = upTo[upTo.length - 1]; balances[a][m] = last ? last.balance : OPEN[a]; }
    balances[SH][m] = SHARES.months[m].reduce((t, h) => t + h.value, 0);
    const hl = LOANS.home.find((x) => x.ym === m); balances[HL][m] = hl ? hl.close : 0;
    const vals = VALUATIONS.filter(([d]) => d <= e);
    balances[UN][m] = e < HOUSE.settled ? 0 : vals.length ? vals[vals.length - 1][1] : HOUSE.cost;
    balances[CR][m] = CAR_VALUE;
    transit[m] = B.transit.filter((t) => t.from <= e && t.until > e).reduce((s, t) => s + t.cents, 0);
    networth[m] = assets.reduce((s, a) => s + balances[a][m], 0) + transit[m];
  }
  return {
    household: "Okafor-Lindqvist, fictional, Hobart", window: [START, END],
    definitions: {
      income: "SPEC 6.5 cash lens: money into reporting-group cash accounts in categories of kind income with cash_lens true. Net pay on the day the bank shows it. Interest, dividends at the net paid, gifts.",
      spending: "SPEC 6.5 cash lens: money out of cash accounts in expense categories with cash_lens true, net of refunds, Medicare and health-fund credits and reversals. Card purchases on the day charged (statement date). Loan repayments at their cash amount, lump sums and the car payout included.",
      left_out: "Own transfers, card repayments, tax refunds (TAX-REFUND, kind transfer), the settlement (capital), the bond refund, and employer-reimbursed outlays with their reimbursement (SPEC 4.4c).",
      balances: "Month-end, holder's sign. The card by date charged. Loans negative. Holdings at the month-end market value, true whether or not the file was downloaded. Property at cost (price, duty, legal, adjustments, as the settlement statement adds them, per asset_purchase in schema/events.json) until the first dated valuation, then the latest valuation. Vehicle at the value the household gave.",
      networth: "Sum of the accounts the household declared, plus money in the air between own accounts and trades between trade and settlement, because those are the household's whichever side of a month end they fall. The bond is undeclared, so it enters when the cash does. Tax position excluded.",
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
const BR = {
  pawroll: { name: "Pawroll", tagline: "Every pay, every paw, on time", color: "#2F6F5E" },
  westpaw: { name: "Westpaw", tagline: "Banking with a wag", color: "#B4231F" },
  ping: { name: "PING", tagline: "Wattle Credit Union online lending", color: "#D97A0B" },
  amewx: { name: "Amewx", tagline: "Don't leave home without your whiskers", color: "#1E5AA8" },
  cedar: { name: "Cedar Trade", tagline: "Deep roots, low brokerage", color: "#3C6E47" },
  computerpaw: { name: "Computerpaw" },
  purr: { name: "Purrannuation", tagline: "Nine lives for your retirement", color: "#6A3FA0" },
  hest: { name: "HESTAbby" },
  myguv: { name: "myGuv", tagline: "Your tax, your paws", color: "#0B6E99" },
  purrsure: { name: "Purrsure", tagline: "Cover for the curious", color: "#C2410C" },
  council: { name: "Eastern Shore Council", tagline: "Rates and charges, one paw at a time", color: "#2E7D6B" },
  water: { name: "Riverline Water" },
  conveyancer: { name: "Hawthorn Lane Conveyancing" },
};
const span = (a, b) => `${fmtDate(a)} to ${fmtDate(b)}`;
const R = (label, w = 2) => ({ label, w, align: "right" });
const Lft = (label, w = 2) => ({ label, w });

function pdfPayslip(s, ytd) {
  const d = new Doc({ brand: BR.pawroll, title: "Payslip", kicker: fmtDate(s.payDate), deflate });
  d.h1(`Payslip for ${s.person}`);
  d.kv([["Employer", s.employer], ["Pay date", fmtDate(s.payDate)], ["Pay period", span(s.from, s.to)]], 3);
  d.h2("This pay");
  d.para(s.person === ADA ? "Classification: Registered Nurse Grade 3, rotating roster." : "Classification: salaried staff, monthly in arrears.");
  d.para("All amounts are in Australian dollars.");
  const pct = sgRate(s.payDate);
  d.table([Lft("Item", 6), R("This pay"), R("Year to date")], [
    ["Ordinary hours, salary", money(s.gross), money(ytd.gross)],
    ["PAYG withholding", `-${money(s.tax)}`, `-${money(ytd.tax)}`],
    [`Superannuation guarantee (${pct}%)`, money(s.super), money(ytd.super)],
    [s.split ? `Net pay, to account ending ${s.acctLast} and 7703` : `Net pay, to account ending ${s.acctLast}`, money(s.net), ""],
  ]);
  return d.finish();
}
function pdfIncomeStatement(person, employer, fy, ss) {
  const sum = (k) => ss.reduce((t, s) => t + s[k], 0);
  const d = new Doc({ brand: BR.pawroll, title: `Income statement FY${fy}`, kicker: `FY${fy}, 01 Jul ${fy - 1} to 30 Jun ${fy}`, deflate });
  d.h1(`Income statement for ${person}`);
  d.kv([["Employee", person], ["Payer", employer], ["Issued", fmtDate(`${fy}-07-14`)], ["Status", "Tax ready"], ["Payer ABN", { [GREYWATER]: "51824753556", [TESSELLATE]: "30918244107", [SOUTHLIGHT]: "62771095338" }[employer]], ["Pay frequency", person === ADA ? "Fortnightly" : "Monthly"]], 3);
  d.h2("Year to 30 June");
  d.table([Lft("Item", 6), R("Amount")], [["Gross payments", money(sum("gross"))], ["Tax withheld", money(sum("tax"))], ["Superannuation guarantee", money(sum("super"))], ["Reportable employer super", "0.00"]]);
  d.h2("Pay by pay");
  d.table([Lft("Pay date", 3), R("Gross"), R("Tax"), R("Super"), R("Net")], ss.map((s) => [fmtDate(s.payDate), money(s.gross), money(s.tax), money(s.super), money(s.net)]), { foot: ["Total", money(sum("gross")), money(sum("tax")), money(sum("super")), money(sum("net"))] });
  return d.finish();
}
function pdfLoan(brand, title, number, product, holder, from, to, rows) {
  const t = (k) => rows.reduce((s, r) => s + r[k], 0);
  const d = new Doc({ brand, title, kicker: span(from, to), deflate });
  d.h1(title);
  d.kv([["Loan number", number], ["Product", product], ["Borrowers", holder], ["Repayments", "Monthly"], ["Opening balance", money(-rows[0].open)], ["Interest charged", money(t("interest"))], ["Repayments received", money(t("paid"))], ["Closing balance", money(-rows[rows.length - 1].close)]], 4);
  d.h2("Month by month");
  d.table([Lft("Month", 2), R("Rate", 1), R("Opening"), R("Interest"), R("Repayments"), R("Closing")],
    rows.map((r) => [`${MON[Number(r.ym.slice(5)) - 1]} ${r.ym.slice(0, 4)}`, `${r.rate}%`, money(-r.open), money(r.interest), money(r.paid), money(-r.close)]),
    { foot: ["Total", "", "", money(t("interest")), money(t("paid")), ""] });
  return d.finish();
}
function pdfRateNotice(oldR, newR, effective, issued) {
  const d = new Doc({ brand: BR.westpaw, title: "Rate change", kicker: `Issued ${fmtDate(issued)}`, deflate });
  d.h1("Your interest rate is changing");
  d.kv([["Loan number", NUM.home], ["Product", "Basic Home Loan"], ["Account holders", "A Okafor, S Lindqvist"], ["Old rate", `${oldR}% p.a.`], ["New rate", `${newR}% p.a.`], ["Effective date", fmtDate(effective)]], 3);
  d.para("Your minimum repayment does not change unless you ask us to change it.");
  return d.finish();
}
function pdfCard(s) {
  const d = new Doc({ brand: BR.amewx, title: "Card statement", kicker: span(s.start, s.end), deflate });
  d.h1("Your card statement");
  d.kv([["Account", NUM.cardFull], ["Card member", ADA], ["Previous balance", money(s.prev)], ["Payments and credits", money(s.credits)], ["New charges", money(s.charges)], ["New balance", money(s.close)]], 3);
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
function pdfDividend(v) {
  const d = new Doc({ brand: BR.computerpaw, style: "plain", title: "Dividend", kicker: v.name, deflate });
  d.h1(`${v.final ? "Final" : "Interim"} dividend`);
  d.kv([["Holder number", NUM.hin], ["Security code", v.code], ["Shares held", String(v.units)], ["Rate per share", (v.ps / 100).toFixed(4)], ["Payment date", fmtDate(v.pay)], ["Franked percent", String(Math.round(v.franked / v.net * 100))]], 3);
  d.h2("Payment");
  d.table([Lft("Item", 6), R("Amount")], [["Franked amount", money(v.franked)], ["Unfranked amount", money(v.unfranked)], ["Franking credit", money(v.credit)], ["Net payment", money(v.net)]]);
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
  const rows = [["Name", n.person, "Taxable income", money(n.ti)], ["Financial year", `FY${n.fy}`, "Gross tax", money(n.gross)], ["Date of issue", fmtDate(n.assessed), "Less offsets", money(0)], ["Return lodged", fmtDate(n.lodged), "Medicare levy", money(n.medicare)], ["Version", "1", "HELP repayment", money(0)], ["Assessment", `AN-${n.fy}-${n.person === ADA ? "5510083" : "5510291"}`, "PAYG credits", money(n.payg)], ["", "", "Other credits", money(n.other)], ["", "", "Result of this notice", money(n.result)]];
  for (const r of rows) { d.text(MARGIN, d.y, r[0], { size: 9.5 }); d.text(MARGIN + 110, d.y, r[1], { size: 9.5, bold: true }); d.text(320, d.y, r[2], { size: 9.5 }); d.text(d.W - MARGIN, d.y, r[3], { size: 9.5, bold: true, align: "right" }); d.y -= 18; }
  d.para("A refund is paid to the account you nominated in your return.");
  return d.finish();
}
function pdfSettlement() {
  const d = new Doc({ brand: BR.conveyancer, style: "plain", title: "Settlement statement", deflate });
  d.h1(`Settlement statement, ${UNIT.split(",")[0]}`);
  d.kv([["Property reference", UNIT], ["Purchaser", "A Okafor and S Lindqvist"], ["Settlement date", fmtDate(HOUSE.settled)], ["Matter", "HL-24-3381"]], 2);
  d.h2("Statement");
  d.table([Lft("Item", 6), R("Amount")], [["Purchase price", money(HOUSE.price)], ["Land transfer duty", money(HOUSE.duty)], ["Legal and conveyancing", money(HOUSE.legal)], ["Adjustments at settlement", money(HOUSE.adjust)], ["Loan funds drawn", `-${money(HOUSE.loan)}`], ["Cash paid by purchaser", money(HOUSE.cash)]]);
  d.para(`Loan funds came from Westpaw loan number ${NUM.home}.`);
  return d.finish();
}
function pdfRates(b) {
  const d = new Doc({ brand: BR.council, title: "Rates", kicker: "Notice under the Local Government Act", deflate });
  d.h1("Your rates instalment");
  d.kv([["Assessment number", "EC-2281470"], ["Property", UNIT.split(",")[0]], ["Issue date", fmtDate(b.billDate)], ["Due date", fmtDate(b.due)], ["Rating period", span(b.from, b.to)], ["Instalment due", money(b.amt)]], 3);
  d.para(`Instalment notice ${b.reference}`);
  return d.finish();
}
function pdfWater(b) {
  const d = new Doc({ brand: BR.water, style: "plain", title: "Water bill", deflate });
  d.text(MARGIN, d.y, "Your water bill", { size: 14, bold: true }); d.text(d.W - MARGIN, d.y, `Quarter to ${fmtDate(b.to)}`, { size: 9, align: "right" }); d.y -= 26;
  const rows = [["Account", "WA-118204", "Water usage", money(b.usage)], ["Property", UNIT.split(",")[0], "Service charges", money(b.service)], ["Bill date", fmtDate(b.billDate), "Concession", money(0)], ["Due date", fmtDate(b.due), "Amount due", money(b.amt)], ["Period from", fmtDate(b.from), "", ""], ["Period to", fmtDate(b.to), "", ""]];
  for (const r of rows) { d.text(MARGIN, d.y, r[0], { size: 9.5 }); d.text(MARGIN + 110, d.y, r[1], { size: 9.5, bold: true }); if (r[2]) { d.text(320, d.y, r[2], { size: 9.5 }); d.text(d.W - MARGIN, d.y, r[3], { size: 9.5, bold: true, align: "right" }); } d.y -= 18; }
  d.para("Thank you for paying on time.");
  d.text(MARGIN, d.y, "Pay by", { size: 9.5 }); d.text(MARGIN + 110, d.y, "BPAY biller 70118", { size: 9.5 });
  return d.finish();
}
function pdfPolicy(p) {
  const d = new Doc({ brand: BR.purrsure, title: "Certificate", kicker: "Home and contents", deflate });
  d.h1("Certificate of currency");
  d.kv([["Policy number", p.number], ["Policy", "Home"], ["Situation", UNIT.split(",")[0]], ["Insured", "A Okafor and S Lindqvist"], ["Period of insurance", span(p.from, p.to)], ["Premium paid", money(p.amt)]], 3);
  d.h2("Cover");
  d.table([Lft("Item", 6), R("Amount")], [["Building sum insured", money(p.sum)], ["Excess", money(p.excess)]]);
  return d.finish();
}
function emlEnergy(b) {
  const text = ["Your electricity bill is ready", "TasGlow Energy, a fictional retailer", "Hello Ada and Sven,", `Account: ${b.account}`, `Bill date: ${fmtDate(b.billDate)}`, `Due date: ${fmtDate(b.due)}`, `Supply from: ${fmtDate(b.from)}`, `Supply to: ${fmtDate(b.to)}`, `GST included: ${money(b.gst)}`, `Amount due: ${money(b.amt)}`, "Pay by BPAY, biller code 5504.", "Thanks for keeping the lights on."].join("\n");
  return eml({ from: "bills@tasglow.example", to: "ada@okafor-lindqvist.example", subject: "Your electricity bill is ready", date: b.billDate, id: `tg-${b.billDate}`, text, html: `<p>${text.split("\n").join("</p><p>")}</p>` });
}

function render() {
  // Ada's bank: quarterly downloads, overlapping when she did not trust the last one
  const hb = chain(HB);
  for (const [from, to, day] of HB_WINDOWS) {
    const rows = hb.filter((x) => x.date >= from && x.date <= to).map((x) => [NUM.harbour, dmy(x.date), x.desc, x.cents < 0 ? fix(-x.cents) : "", x.cents > 0 ? fix(x.cents) : "", fix(x.balance), x.cents > 0 ? "DEP" : "PAYMENT", ""]);
    put(HB, day, `Harbour_${from}_${to}.csv`, csvLines([["Bank Account", "Date", "Narrative", "Debit Amount", "Credit Amount", "Balance", "Categories", "Serial"], ...rows]));
  }
  // the same January to March file, saved again under another name three months later
  const dupe = FILES.find((f) => f.name === "Harbour_2024-01-01_2024-03-31.csv");
  put(HB, "2024-07-01", "Harbour_2024-01-01_2024-03-31 (1).csv", dupe.bytes);
  // Sven's bank: monthly, with a stretch in April 2026 that was never downloaded
  const wt = chain(WT);
  for (const ym of MONTHS) {
    const from = ym === "2026-05" ? "2026-04-21" : `${ym}-01`, to = ym === "2026-04" ? "2026-04-11" : monthEnd(ym);
    const rows = wt.filter((x) => x.date >= from && x.date <= to).map((x) => [dmy(x.date), x.desc, x.cents > 0 ? fix(x.cents) : "", x.cents < 0 ? fix(x.cents) : "", fix(x.balance)]);
    put(WT, addDays(to, 2), `Wattle_${ym}.csv`, csvLines([["Date", "Description", "Credit", "Debit", "Balance"], ...rows]));
  }
  // the joint saver: no header, newest first, quarterly, with one overlap
  const jt = chain(JT);
  for (const [from, to, day] of quarters("2023-07", "2026-06").map(([f, t]) => (f === "2025-01-01" ? ["2024-12-20", t, addDays(t, 2)] : [f, t, addDays(t, 2)]))) {
    const rows = jt.filter((x) => x.date >= from && x.date <= to).reverse().map((x) => [dmy(x.date), `${x.cents >= 0 ? "+" : "-"}${fix(Math.abs(x.cents))}`, x.desc, fix(x.balance)]);
    put(JT, day, `bark_transactions_${from}.csv`, csvLines(rows));
  }
  // the card: a monthly statement dated by transaction, and a quarterly activity download dated by posting
  chain(CC);
  const cc = B.lines.filter((x) => x.acct === CC).sort((a, b) => ((a.posted || a.date) < (b.posted || b.date) ? -1 : (a.posted || a.date) > (b.posted || b.date) ? 1 : a.seq - b.seq));
  for (const s of CARD.statements) put("STM-CARD", addDays(s.end, 2), `Amewx_statement_${s.end}.pdf`, pdfCard(s), { issued_on: s.end });
  for (const [from, to, day] of quarters("2023-07", "2026-06").map(([f, t], i) => (i === 0 ? ["2023-06-22", t, addDays(t, 3)] : f === "2024-10-01" ? ["2024-09-25", t, addDays(t, 3)] : [f, t === END ? "2026-07-03" : t, addDays(t, 3)]))) {
    const rows = cc.filter((x) => (x.posted || x.date) >= from && (x.posted || x.date) <= to).reverse().map((x) => [dmy(x.posted || x.date), x.csv || x.desc, (x.member || ADA).toUpperCase(), `-${NUM.card}`, money(-x.cents).replace(/,/g, "")]);
    put(CC, day, `activity_${from}.csv`, csvLines([["Date", "Description", "Card Member", "Account #", "Amount"], ...rows]));
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
    if (ym === "2025-08") continue;
    const e = monthEnd(ym), rows = SHARES.months[ym].map((h) => [h.code, h.name, h.units, h.price, fix(h.value), e].join("\t"));
    put(SH, addDays(e, 1), `holdings_${e}.tsv`, `${["Security", "Description", "Units", "Price", "Market Value", "As At"].join("\t")}\r\n${rows.join("\r\n")}\r\n`);
  }
  for (const t of SHARES.trades) put("NOTES-CEDAR", t.d, `ContractNote_${t.ref}.pdf`, pdfContractNote(t), { issued_on: t.d });
  for (const v of SHARES.divs) put("DIV-COMPUTERPAW", v.pay, `Dividend_${v.code}_${v.pay}.pdf`, pdfDividend(v), { issued_on: v.pay });
  // loans
  const homeH = [["2025-01", "2025-06", HOUSE.settled, "2025-06-30"], ["2025-07", "2025-12", "2025-07-01", "2025-12-31"], ["2026-01", "2026-06", "2026-01-01", "2026-06-30"]];
  for (const [a, b, from, to] of homeH) put("STM-HOMELOAN", addDays(to, 3), `Westpaw_loan_${to}.pdf`, pdfLoan(BR.westpaw, "Home loan statement", NUM.home, "Basic Home Loan", "A Okafor, S Lindqvist", from, to, LOANS.home.filter((m) => m.ym >= a && m.ym <= b)), { issued_on: addDays(to, 1) });
  for (const [i, [, newR]] of RATES.slice(1).entries()) { const eff = RATES[i + 1][0], issued = addDays(eff, 3); put("NOTICE-HOMELOAN", issued, `Westpaw_rate_${eff}.pdf`, pdfRateNotice(RATES[i][1], newR, eff, issued), { issued_on: issued }); }
  const carH = [["2023-07", "2023-12", "2023-07-01", "2023-12-31"], ["2024-01", "2024-06", "2024-01-01", "2024-06-30"], ["2024-07", "2024-12", "2024-07-01", "2024-12-31"], ["2025-01", "2025-06", "2025-01-01", "2025-06-30"], ["2025-07", "2025-09", "2025-07-01", "2025-09-12"]];
  for (const [a, b, from, to] of carH) put("STM-CARLOAN", addDays(to, 5), `PING_statement_${to}.pdf`, pdfLoan(BR.ping, "Car loan statement", NUM.car, "Fixed Car Loan", SVEN, from, to, LOANS.car.filter((m) => m.ym >= a && m.ym <= b)), { issued_on: addDays(to, 1) });
  const clc = LOANS.carLines;
  for (const [from, to, day] of [["2023-07-01", "2024-06-30", "2024-07-02"], ["2024-07-01", "2025-09-30", "2025-10-03"]]) {
    const rows = clc.filter((x) => x.date >= from && x.date <= to).map((x) => [dmy(x.date), x.desc, fix(x.cents), fix(-x.balance)].join("\t"));
    put(CL, day, `ping_loan_${from}.tsv`, `Effective Date\tDetails\tAmount\tBalance Owing\r\n${rows.join("\r\n")}\r\n`);
  }
  // pay
  const ytd = {};
  for (const s of PAY.slips.slice().sort((a, b) => (a.payDate < b.payDate ? -1 : a.payDate > b.payDate ? 1 : 0))) {
    const k = `${s.person}|${s.employer}|${s.fy}`, y = (ytd[k] = ytd[k] || { gross: 0, tax: 0, super: 0 });
    y.gross += s.gross; y.tax += s.tax; y.super += s.super;
    put(s.person === ADA ? "PAY-ADA" : "PAY-SVEN", s.payDate, `Payslip_${s.payDate}.pdf`, pdfPayslip(s, y), { issued_on: s.payDate });
  }
  for (const [person, stream, employers] of [[ADA, "INC-ADA", [GREYWATER]], [SVEN, "INC-SVEN", [TESSELLATE, SOUTHLIGHT]]]) for (const fy of [2024, 2025]) for (const emp of employers) {
    const ss = PAY.slips.filter((s) => s.person === person && s.employer === emp && s.fy === fy); if (!ss.length) continue;
    put(stream, `${fy}-07-14`, `IncomeStatement_FY${fy}_${emp.split(" ")[0]}.pdf`, pdfIncomeStatement(person, emp, fy, ss), { issued_on: `${fy}-07-14` });
  }
  // super
  const half = [["2023-07-01", "2023-12-31"], ["2024-01-01", "2024-06-30"], ["2024-07-01", "2024-12-31"], ["2025-01-01", "2025-06-30"], ["2025-07-01", "2025-12-31"], ["2026-01-01", "2026-06-30"]];
  const CODE = { employer: "SG", contributions_tax: "TAX", fee: "FEE", insurance: "INS", earnings: "EARN" };
  const open = (list, from, base) => { const before = list.filter((x) => x.date < from); return before.length ? before[before.length - 1].balance : base; };
  for (const [from, to] of half) {
    const ls = SUPER.ada.filter((x) => x.date >= from && x.date <= to), opening = open(SUPER.ada, from, OPEN[SA]);
    put(SA, addDays(to, 5), `hestabby_${from}.json`, JSON.stringify({ schema: "hestabby.transactions.v2", member: { name: ADA, number: NUM.superAda }, period: { from, to }, balance: { opening: Number(fix(opening)), closing: Number(fix(ls[ls.length - 1].balance)) }, transactions: ls.map((x) => ({ date: x.date, code: CODE[x.type], label: x.desc, amount: Number(fix(x.cents)), balanceAfter: Number(fix(x.balance)) })) }, null, 1));
  }
  const V1 = { employer: "Employer Contribution", contributions_tax: "Contributions Tax", fee: "Administration Fee", insurance: "Insurance Premium", earnings: "Investment Earnings" };
  const V2 = { employer: "CONTRIB-SG", contributions_tax: "TAX-15", fee: "FEE-ADMIN", insurance: "INS-DTPD", earnings: "EARNINGS" };
  for (const [from, to] of half) {
    const ls = SUPER.sven.filter((x) => x.date >= from && x.date <= to);
    if (from < "2025-01-01") put(SS, addDays(to, 6), `purrannuation_${from}.csv`, csvLines([["Date", "Transaction Type", "Description", "Amount", "Balance"], ...ls.map((x) => [dmy(x.date), V1[x.type], x.desc, fix(x.cents), fix(x.balance)])]));
    else put(SS, addDays(to, 6), `purrannuation_${from}.csv`, csvLines([["Effective Date", "Category", "Narrative", "Amount (AUD)", "Running Balance", "Reference"], ...ls.map((x, i) => [x.date, V2[x.type], x.desc, fix(x.cents), fix(x.balance), `TXN${from.slice(2, 4)}${pad(i + 1, 4)}`])]));
  }
  for (const fy of [2024, 2025, 2026]) {
    const from = `${fy - 1}-07-01`, to = `${fy}-06-30`;
    for (const [stream, list, base, brand, style, name, member] of [["STM-SUPER-ADA", SUPER.ada, OPEN[SA], BR.hest, "plain", ADA, NUM.superAda], ["STM-SUPER-SVEN", SUPER.sven, OPEN[SS], BR.purr, "band", SVEN, NUM.superSven]]) {
      const ls = list.filter((x) => x.date >= from && x.date <= to);
      put(stream, `${fy}-07-20`, `Annual_statement_FY${fy}.pdf`, pdfFund(brand, style, name, member, fy, ls, open(list, from, base), ls[ls.length - 1].balance), { issued_on: `${fy}-07-20` });
    }
  }
  // tax
  for (const n of TAX.notices) put(n.person === ADA ? "TAX-ADA" : "TAX-SVEN", n.assessed, `NOA_FY${n.fy}.pdf`, pdfNoa(n), { issued_on: n.assessed });
  // the unit
  put("SETTLEMENT", HOUSE.settled, "Settlement_statement.pdf", pdfSettlement(), { issued_on: HOUSE.settled });
  put("VALUATIONS", "2026-07-01", "pawprice_estimates.csv", csvLines([["Subject", "As At", "Estimate", "Method", "Provider"], ...VALUATIONS.map(([d, c]) => [UNIT, dmy(d), fix(c), "estimate", "Pawprice"])]));
  for (const b of BILLS.energy) put("BILL-POWER", b.billDate, `bill_${b.billDate}.eml`, emlEnergy(b), { issued_on: b.billDate, origin: "email" });
  for (const b of BILLS.rates) put("BILL-RATES", b.billDate, `rates_${b.billDate}.pdf`, pdfRates(b), { issued_on: b.billDate });
  for (const b of BILLS.water) put("BILL-WATER", b.billDate, `water_${b.billDate}.pdf`, pdfWater(b), { issued_on: b.billDate });
  for (const p of BILLS.policy) put("POLICY-HOME", p.paid, `certificate_${p.from}.pdf`, pdfPolicy(p), { issued_on: p.paid });
}
function quarters(a, b) { const out = []; const ms = monthRange(a, b); for (let i = 0; i < ms.length; i += 3) out.push([`${ms[i]}-01`, monthEnd(ms[i + 2])]); return out; }

// ---------- setup: what a person answers at onboarding, in July 2026 ----------
const ON = "2026-07-06T00:00:00Z";
/* The public default categories, by id, as the dictionary knows them. One addition: the standard has no category for rent a household pays, so a tenant adds one, by the SPEC 12 rung. */
const CATS = `SALARY|Salary and wages|income|Income|1|1;SALARY-ALLOW|Allowances|income|Income|1|1;REIMBURSE|Employer reimbursements|income|Income|1|0;SUPER-EMPLOYER|Employer super|income|Super|0|1;SUPER-SACRIFICE|Salary sacrificed to super|income|Super|0|1;PAYROLL-DED|Post-tax payroll deductions|expense|Income|1|1;INTEREST|Interest earned|income|Income|1|1;DIVIDEND|Dividends and distributions|income|Income|1|1;TRUST-DIST|Trust distributions|income|Income|1|1;ESS-INCOME|Employee share scheme income|income|Income|0|1;CRYPTO-INCOME|Staking and crypto income|income|Income|0|1;SUPER-EARN|Super fund earnings|income|Super|0|1;SUPER-FEES|Super fund fees|expense|Super|0|1;SUPER-INS|Insurance inside super|expense|Super|0|1;SUPER-TAX|Contributions tax|expense|Super|0|1;GIFT-IN|Gifts and inheritances received|income|Income|1|0;RENT-INC|Rent received|income|Property|1|1;MORTGAGE|Home loan repayments|expense|Housing|1|0;HOME-INT|Home loan interest|expense|Housing|0|1;RATES-HOME|Council rates (home)|expense|Housing|1|1;HOME-INS|Home and contents insurance|expense|Housing|1|1;HOME-MAINT|Home maintenance|expense|Housing|1|1;GROCERIES|Groceries|expense|Essentials|1|1;UTILITIES|Energy and water|expense|Essentials|1|1;TELCO|Internet and mobile|expense|Essentials|1|1;TRANSPORT|Fuel and transport|expense|Essentials|1|1;CAR|Car costs|expense|Essentials|1|1;HEALTH|Health|expense|Essentials|1|1;CHILDCARE|Childcare|expense|Essentials|1|1;DINING|Dining and takeaway|expense|Lifestyle|1|1;SUBS|Subscriptions|expense|Lifestyle|1|1;SHOPPING|Shopping|expense|Lifestyle|1|1;KIDS-ACT|Kids activities|expense|Lifestyle|1|1;HOLIDAYS|Holidays and travel|expense|Lifestyle|1|1;GIFTS|Gifts|expense|Lifestyle|1|1;PERSONAL|Personal care|expense|Lifestyle|1|1;RENT-INT|Investment loan interest|expense|Property|1|1;RENT-MGMT|Property management fees|expense|Property|1|1;RENT-RATES|Rental rates and water|expense|Property|1|1;RENT-STRATA|Strata levies|expense|Property|1|1;RENT-INS|Landlord insurance|expense|Property|1|1;RENT-REPAIR|Rental repairs|expense|Property|1|1;RENT-OTHER|Other rental costs|expense|Property|1|1;WORK-EQUIP|Work equipment|expense|Work and giving|1|1;WORK-OTHER|Work registrations and courses|expense|Work and giving|1|1;DONATION|Donations|expense|Work and giving|1|1;FEES|Bank fees and card interest|expense|Fees|1|1;INCOME-TAX|Income tax assessed|expense|Tax|0|1;HELP-INDEX|HELP indexation|expense|Tax|0|1;TAX-REFUND|Tax refunds and payments|transfer|Tax|0|0;TRANSFER|Transfers between own accounts|transfer|Transfers|0|0;CC-PAY|Credit card payments|transfer|Transfers|0|0;UNCAT|Uncategorised|suspense|Uncategorised|1|1;x_RENT-PAID|Rent we pay|expense|Housing|1|1`;
function setup() {
  const person = (id, name, birth, note) => ({ party_id: id, kind: "person", name, birth_date: birth, ...(note ? { note } : {}) });
  const org = (id, name, kind = "organisation") => ({ party_id: id, kind, name });
  const party = [person("PTY-ADA", ADA, "1984-04-17"), person("PTY-SVEN", SVEN, "1981-11-02"), person("PTY-FREYA", "Freya Okafor-Lindqvist", "2009-08-23"),
    org("PTY-GREYWATER", GREYWATER), org("PTY-TESSELLATE", TESSELLATE), org("PTY-SOUTHLIGHT", SOUTHLIGHT), org("PTY-HARBOUR", "Harbour Bank"), org("PTY-WATTLE", "Wattle Credit Union"), org("PTY-BARK", "Bark Bank"),
    org("PTY-AMEWX", "Amewx"), org("PTY-CEDAR", "Cedar Trade"), org("PTY-COMPUTERPAW", "Computerpaw"), org("PTY-WESTPAW", "Westpaw"), org("PTY-PING", "PING"), org("PTY-HESTABBY", "HESTAbby"), org("PTY-PURRANNUATION", "Purrannuation"),
    org("PTY-TAX", "myGuv", "government"), org("PTY-AGENT", "Harcourt and Vale Real Estate"), org("PTY-TASGLOW", "TasGlow Energy"), org("PTY-COUNCIL", "Eastern Shore Council", "government"), org("PTY-RIVERLINE", "Riverline Water"), org("PTY-PURRSURE", "Purrsure"), org("PTY-BUPAW", "Bupaw")];
  const membership = [["PTY-ADA", "adult"], ["PTY-SVEN", "adult"], ["PTY-FREYA", "dependant"]].map(([party_id, role]) => ({ party_id, role, valid_from: "2009-08-23", recorded_at: ON }));
  const acct = (account_id, name, cls, type, group, inst, extra = {}) => ({ account_id, name, class: cls, type, reporting_group: group, currency: "AUD", ...(inst ? { institution_party_id: inst } : {}), in_scope: true, liquid: group === "cash", fidelity: "ledger", ...extra });
  const account = [
    acct(HB, "Ada's everyday, Harbour", "asset", "transaction", "cash", "PTY-HARBOUR"), acct(WT, "Sven's everyday, Wattle", "asset", "transaction", "cash", "PTY-WATTLE"), acct(JT, "Joint saver, Bark", "asset", "savings", "cash", "PTY-BARK"),
    acct(CC, "Amewx card", "liability", "credit_card", "cash", "PTY-AMEWX"), acct(BK, "Cedar Trade cash", "asset", "brokerage", "cash", "PTY-CEDAR"), acct(SH, "Shares at Cedar Trade", "asset", "holding", "shares", "PTY-CEDAR", { parent_account_id: BK, liquid: false }),
    acct(HL, "Home loan", "liability", "loan", "loans", "PTY-WESTPAW", { contract_id: "CON-HOMELOAN", opened_on: HOUSE.settled, liquid: false }), acct(CL, "Car loan", "liability", "loan", "loans", "PTY-PING", { contract_id: "CON-CARLOAN", closed_on: "2025-09-12", liquid: false }),
    acct(SA, "Ada's super", "asset", "super", "super", "PTY-HESTABBY", { contract_id: "CON-SUPER-ADA", liquid: false }), acct(SS, "Sven's super", "asset", "super", "super", "PTY-PURRANNUATION", { contract_id: "CON-SUPER-SVEN", liquid: false }),
    acct(UN, "The unit", "asset", "property", "property", null, { asset_id: "AST-UNIT", opened_on: HOUSE.settled, fidelity: "snapshot", liquid: false }),
    acct(CR, "The car", "asset", "vehicle", "vehicle", null, { asset_id: "AST-CAR", fidelity: "snapshot", liquid: false, opening_balance_cents: CAR_VALUE, opening_date: START, note: "What we think it is worth." }),
  ];
  const asset = [{ asset_id: "AST-UNIT", kind: "property", name: UNIT, account_id: UN, location: "Lindisfarne TAS", acquired_on: HOUSE.settled }, { asset_id: "AST-CAR", kind: "vehicle", name: "The Subaru", account_id: CR, acquired_on: "2021-05-14" }];
  const al = (subject_type, subject_id, scheme, value) => ({ subject_type, subject_id, scheme, value, valid_from: "2000-01-01", recorded_at: ON });
  const alias = [al("account", HB, "account_number", NUM.harbour), al("account", WT, "account_number", NUM.wattle), al("account", JT, "account_number", NUM.bark), al("account", CC, "card_last4", NUM.card), al("account", BK, "account_number", NUM.broker), al("account", SH, "hin", NUM.hin), al("account", HL, "loan_number", NUM.home), al("account", CL, "loan_number", NUM.car), al("account", SA, "member_number", NUM.superAda), al("account", SS, "member_number", NUM.superSven),
    al("party", "PTY-ADA", "name", ADA), al("party", "PTY-SVEN", "name", SVEN), al("party", "PTY-GREYWATER", "name", GREYWATER), al("party", "PTY-TESSELLATE", "name", TESSELLATE), al("party", "PTY-SOUTHLIGHT", "name", SOUTHLIGHT), al("asset", "AST-UNIT", "name", UNIT), al("contract", "CON-HOMELOAN", "loan_number", NUM.home), al("contract", "CON-CARLOAN", "loan_number", NUM.car), al("contract", "CON-HOME-INS", "policy_number", "PH-90418226")];
  const own_ = (subject_type, subject_id, split) => ["legal", "beneficial", "tax"].flatMap((basis) => split.map(([party_id, share_bps]) => ({ subject_type, subject_id, party_id, basis, share_bps, valid_from: "2000-01-01", recorded_at: ON })));
  const both = [["PTY-ADA", 5000], ["PTY-SVEN", 5000]], ada = [["PTY-ADA", 10000]], sven = [["PTY-SVEN", 10000]];
  const ownership = [...own_("account", HB, ada), ...own_("account", WT, sven), ...own_("account", JT, both), ...own_("account", CC, ada), ...own_("account", BK, both), ...own_("account", SH, both), ...own_("account", SA, ada), ...own_("account", SS, sven), ...own_("account", HL, both), ...own_("account", CL, sven), ...own_("account", UN, both), ...own_("account", CR, sven), ...own_("asset", "AST-UNIT", both), ...own_("asset", "AST-CAR", sven)];
  const category = CATS.split(";").map((r) => { const [category_id, name, kind, group, c, e] = r.split("|"); return { category_id, name, kind, group, cash_lens: c === "1", economic_lens: e === "1" }; });
  const con = (contract_id, kind, name, counterparty_party_id, holder_party_id, extra = {}) => ({ contract_id, kind, name, counterparty_party_id, holder_party_id, ...extra });
  const contract = [
    con("CON-ADA-EMP", "employment", "Ada at Greywater", "PTY-GREYWATER", "PTY-ADA", { category_id: "SALARY", started_on: "2019-02-04" }), con("CON-SVEN-EMP1", "employment", "Sven at Tessellate", "PTY-TESSELLATE", "PTY-SVEN", { category_id: "SALARY", started_on: "2020-06-15", ended_on: "2024-10-31" }), con("CON-SVEN-EMP2", "employment", "Sven at Southlight", "PTY-SOUTHLIGHT", "PTY-SVEN", { category_id: "SALARY", started_on: "2024-11-18" }),
    con("CON-LEASE", "lease", "The rental at Bellerive", "PTY-AGENT", "PTY-ADA", { category_id: "x_RENT-PAID", started_on: "2022-03-01", ended_on: "2025-01-15" }),
    con("CON-HOMELOAN", "loan", "Home loan", "PTY-WESTPAW", "PTY-ADA", { account_id: HL, asset_id: "AST-UNIT", category_id: "MORTGAGE", started_on: HOUSE.settled }), con("CON-CARLOAN", "loan", "Car loan", "PTY-PING", "PTY-SVEN", { account_id: CL, asset_id: "AST-CAR", category_id: "CAR", started_on: "2021-05-14", ended_on: "2025-09-12" }),
    con("CON-SUPER-ADA", "super_fund", "Ada's super", "PTY-HESTABBY", "PTY-ADA", { account_id: SA }), con("CON-SUPER-SVEN", "super_fund", "Sven's super", "PTY-PURRANNUATION", "PTY-SVEN", { account_id: SS }),
    con("CON-HEALTH", "insurance", "Family hospital and extras", "PTY-BUPAW", "PTY-SVEN", { category_id: "HEALTH" }), con("CON-HOME-INS", "insurance", "Home insurance", "PTY-PURRSURE", "PTY-ADA", { asset_id: "AST-UNIT", category_id: "HOME-INS", started_on: "2025-01-15" }), con("CON-MOTOR", "insurance", "Car insurance", "PTY-PURRSURE", "PTY-ADA", { asset_id: "AST-CAR", category_id: "CAR" }),
    con("CON-POWER", "utility", "Electricity", "PTY-TASGLOW", "PTY-ADA", { category_id: "UTILITIES" }),
  ];
  const lk = (relation, from_type, from_id, to_type, to_id, extra = {}) => ({ relation, from_type, from_id, to_type, to_id, valid_from: "2000-01-01", recorded_at: ON, ...extra });
  const link = [lk("contributes_to", "contract", "CON-ADA-EMP", "contract", "CON-SUPER-ADA"), lk("contributes_to", "contract", "CON-SVEN-EMP1", "contract", "CON-SUPER-SVEN"), lk("contributes_to", "contract", "CON-SVEN-EMP2", "contract", "CON-SUPER-SVEN"),
    lk("secures", "contract", "CON-HOMELOAN", "asset", "AST-UNIT", { valid_from: HOUSE.settled }), lk("funds_purpose", "contract", "CON-HOMELOAN", "asset", "AST-UNIT", { share_bps: 10000, valid_from: HOUSE.settled }), lk("secures", "contract", "CON-CARLOAN", "asset", "AST-CAR"), lk("paid_by", "contract", "CON-HOMELOAN", "account", HB, { valid_from: HOUSE.settled }), lk("paid_by", "contract", "CON-CARLOAN", "account", WT), lk("paid_by", "contract", "CON-LEASE", "account", HB), lk("charged_to", "account", CC, "account", HB), lk("covers", "contract", "CON-HOME-INS", "asset", "AST-UNIT", { valid_from: HOUSE.settled })];
  const st = (stream_id, name, doc_kind, subject_type, subject_id, issuer_party_id, cadence, extra = {}) => ({ stream_id, name, doc_kind, subject_type, subject_id, issuer_party_id, cadence, valid_from: START, grace_days: 14, recorded_at: ON, ...extra });
  const stream = [
    st(HB, "Harbour download", "txn_csv", "account", HB, "PTY-HARBOUR", "quarterly"), st(WT, "Wattle download", "txn_csv", "account", WT, "PTY-WATTLE", "monthly"), st(JT, "Bark download", "txn_csv", "account", JT, "PTY-BARK", "quarterly"), st(CC, "Amewx activity", "txn_csv", "account", CC, "PTY-AMEWX", "quarterly"), st("STM-CARD", "Amewx statement", "statement", "account", CC, "PTY-AMEWX", "monthly"),
    st(BK, "Cedar cash", "txn_csv", "account", BK, "PTY-CEDAR", "quarterly"), st(SH, "Cedar holdings", "holdings", "account", SH, "PTY-CEDAR", "monthly"), st("NOTES-CEDAR", "Contract notes", "contract_note", "account", SH, "PTY-CEDAR", "event"), st("DIV-COMPUTERPAW", "Dividend notices", "dividend", "account", SH, "PTY-COMPUTERPAW", "event"),
    st("STM-HOMELOAN", "Home loan statement", "loan_statement", "account", HL, "PTY-WESTPAW", "half_yearly", { valid_from: HOUSE.settled }), st("NOTICE-HOMELOAN", "Rate notices", "rate_notice", "contract", "CON-HOMELOAN", "PTY-WESTPAW", "event", { valid_from: HOUSE.settled }), st(CL, "Car loan download", "txn_tsv", "account", CL, "PTY-PING", "yearly", { valid_to: "2025-10-01" }), st("STM-CARLOAN", "Car loan statement", "loan_statement", "account", CL, "PTY-PING", "half_yearly", { valid_to: "2025-10-01" }),
    st("PAY-ADA", "Ada's payslips", "payslip", "party", "PTY-ADA", "PTY-GREYWATER", "fortnightly"), st("PAY-SVEN", "Sven's payslips", "payslip", "party", "PTY-SVEN", "PTY-SOUTHLIGHT", "monthly"), st("INC-ADA", "Ada's income statement", "income_statement", "party", "PTY-ADA", "PTY-GREYWATER", "yearly"), st("INC-SVEN", "Sven's income statements", "income_statement", "party", "PTY-SVEN", "PTY-SOUTHLIGHT", "yearly"),
    st(SA, "Ada's super transactions", "super_lines", "account", SA, "PTY-HESTABBY", "half_yearly"), st(SS, "Sven's super transactions", "super_lines", "account", SS, "PTY-PURRANNUATION", "half_yearly"), st("STM-SUPER-ADA", "Ada's super statement", "super_statement", "account", SA, "PTY-HESTABBY", "yearly"), st("STM-SUPER-SVEN", "Sven's super statement", "super_statement", "account", SS, "PTY-PURRANNUATION", "yearly"),
    st("TAX-ADA", "Ada's notices", "tax_assessment", "party", "PTY-ADA", "PTY-TAX", "yearly"), st("TAX-SVEN", "Sven's notices", "tax_assessment", "party", "PTY-SVEN", "PTY-TAX", "yearly"),
    st("SETTLEMENT", "Settlement", "settlement", "asset", "AST-UNIT", null, "event", { valid_from: HOUSE.settled }), st("VALUATIONS", "Pawprice estimates", "valuation", "asset", "AST-UNIT", null, "quarterly", { valid_from: HOUSE.settled }), st("BILL-POWER", "Electricity bills", "bill", "contract", "CON-POWER", "PTY-TASGLOW", "quarterly"), st("BILL-RATES", "Rates notices", "bill", "asset", "AST-UNIT", "PTY-COUNCIL", "quarterly", { valid_from: HOUSE.settled }), st("BILL-WATER", "Water bills", "bill", "asset", "AST-UNIT", "PTY-RIVERLINE", "quarterly", { valid_from: HOUSE.settled }), st("POLICY-HOME", "Home insurance certificate", "policy", "contract", "CON-HOME-INS", "PTY-PURRSURE", "yearly", { valid_from: HOUSE.settled }),
  ];
  const instrument = Object.entries(SEC).map(([code, s]) => ({ instrument_id: `INS-${code}`, kind: "listed_share", code, name: s.name, currency: "AUD" }));
  let t = 0;
  const tm = (subject_type, subject_id, term, value, unit, valid_from) => { t += 1; return { term_id: `TERM-${pad(t, 3)}`, subject_type, subject_id, term, value, unit, valid_from, recorded_at: ON }; };
  // only what a person knows offhand: the rate they signed, the salary, what the rent was, what the place is for
  const term = [tm("contract", "CON-HOMELOAN", "interest_rate", "6.09", "pct", HOUSE.settled), tm("contract", "CON-HOMELOAN", "repayment_type", "principal_and_interest", null, HOUSE.settled), tm("contract", "CON-CARLOAN", "interest_rate", "7.95", "pct", START), tm("contract", "CON-CARLOAN", "repayment_type", "principal_and_interest", null, START),
    tm("contract", "CON-ADA-EMP", "base_salary_cents", "9400000", "cents", START), tm("contract", "CON-ADA-EMP", "pay_cadence", "fortnightly", null, START), tm("contract", "CON-SVEN-EMP1", "base_salary_cents", "11100000", "cents", START), tm("contract", "CON-SVEN-EMP1", "pay_cadence", "monthly", null, START), tm("contract", "CON-SVEN-EMP2", "base_salary_cents", "12400000", "cents", "2024-11-18"), tm("contract", "CON-SVEN-EMP2", "pay_cadence", "monthly", null, "2024-11-18"),
    tm("contract", "CON-LEASE", "rent_cents", "88000", "cents", "2024-07-01"), tm("contract", "CON-LEASE", "rent_cadence", "fortnightly", null, "2024-07-01"), tm("asset", "AST-UNIT", "use", "owner_occupied", null, HOUSE.settled)];
  const household = [{ household_id: "HH-OL", name: "Okafor-Lindqvist", jurisdiction: "AU", base_currency: "AUD", fy_start_month: 7, timezone: "Australia/Hobart", standard_version: "household-standard/1" }];
  return { household, party, membership, account, alias, ownership, category, contract, link, stream, asset, instrument, term };
}

// ---------- build ----------
function build() {
  everyday(); payroll(); reimbursement(); rent(); buyTheUnit(); carLoan(); bills(); superFunds(); shares(); plumbing(); settleCard(); taxes(); fileTraps();
  const t = truth();
  const lows = {}; for (const a of [HB, WT, JT, BK]) lows[a] = Math.min(...chain(a).map((x) => x.balance));
  for (const [a, v] of Object.entries(lows)) if (v < 0) throw new Error(`${a} goes overdrawn: ${money(v)}`);
  render();
  const tSetup = setup();
  fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
  const manifest = { household: "HH-OL", files: FILES.map((f) => ({ path: f.path, stream_id: f.stream, download_date: f.day, name: f.name, origin: f.origin || "portal", issued_on: f.issued_on || null })) };
  for (const f of FILES) { const p = path.join(OUT, f.path); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, f.bytes); }
  fs.writeFileSync(path.join(OUT, "manifest.json"), `${JSON.stringify(manifest, null, 1)}\n`);
  fs.writeFileSync(path.join(OUT, "truth.json"), `${JSON.stringify(t, null, 1)}\n`);
  fs.mkdirSync(SETUP_DIR, { recursive: true });
  for (const n of fs.readdirSync(SETUP_DIR)) fs.rmSync(path.join(SETUP_DIR, n));
  for (const [k, v] of Object.entries(tSetup)) fs.writeFileSync(path.join(SETUP_DIR, `${k}.json`), `${JSON.stringify(v, null, 1)}\n`);
  return { files: FILES.length, lines: B.lines.length, traps: B.traps.length, lows };
}

if (require.main === module) { const r = build(); console.log(`Held-out household: ${r.files} files, ${r.lines} lines, ${r.traps} traps. Lowest balances: ${Object.entries(r.lows).map(([a, v]) => `${a} ${money(v)}`).join(", ")}.`); }
module.exports = { build, OUT, SETUP_DIR, book: B };
