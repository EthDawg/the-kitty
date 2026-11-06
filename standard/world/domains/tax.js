/* Tax, FY2019 to FY2026, per person. The world's own calculator turns every income source into labels. The twelve ATO refunds in months.json fix FY2019 to FY2024 to the cent:
   other work-related deductions, whole dollars, are chosen so each result lands, and what is left under a dollar is a labelled credit on the assessment. FY2025 and FY2026
   fall where they fall and are paid to ACC-OLD, the old bank details. */
"use strict";
const { toCents, fix, money, aud, addDays, fmtDate, fyOf, fyStart, fyEnd, csvLines, monthRange, monthEnd, pad } = require("../lib/util");
const { Doc, MUTED, M } = require("../lib/pdf");
const { workbook } = require("../lib/xlsx");
const { page, row } = require("../lib/mail");
const T = require("../tax/tables");
const { assess, whole } = require("../tax/calc");
const broker = require("./broker");
const { stream } = require("./setup");

const FYS = [2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];
const PEOPLE = ["JORDAN", "MIA"];
const NAME = { JORDAN: "Jordan", MIA: "Mia" };
const GOV = { name: "myGuv", tagline: "Your tax, your paws on it.", color: "#1e3a8a" };
const AGENT = { name: "Paws and Claws Tax Agents" };
const add = (o, k, v) => { o[k] = (o[k] || 0) + v; };
const half = (c) => { const j = Math.ceil(c / 2), m = c - j; return [j, m]; };              // largest remainder, ties to the first party
const SECTION = { 1: "Income", 10: "Income", "11S": "Income", "11T": "Income", "11U": "Income", 12: "Income", "13U": "Income", "13C": "Income", "13Q": "Income", "18A": "Income", "20M": "Income", 24: "Income", "21P": "Rental", "21Q": "Rental", "21F": "Rental", "21X": "Rental" };
const DESC = { 1: "Salary or wages", 10: "Gross interest", "11S": "Unfranked amount", "11T": "Franked amount", "11U": "Franking credit", 12: "Employee share schemes", "13U": "Trust income, non primary production", "13C": "Trust franked distributions", "13Q": "Trust franking credit", "18A": "Net capital gain", "18H": "Total current year capital gains", "18V": "Net capital losses carried forward", "20M": "Other net foreign income", "20O": "Foreign income tax offset", 24: "Other income", "21P": "Gross rent", "21Q": "Interest deductions", "21F": "Capital works deductions", "21X": "Other rental deductions", D1: "Work-related car expenses", D3: "Work-related clothing and laundry", D4: "Work-related self-education", D5: "Other work-related expenses", D9: "Gifts or donations", D10: "Cost of managing tax affairs" };

// Who a work or donation line belongs to: the sheet says from July 2025; before that the household's rules do.
function personOf(w, date, cents, desc) {
  const e = w.sheet.entries.find((x) => x.kind === "transaction" && x.settled_at === date && toCents(x.amount) === cents);
  if (e && e.person === "Jordan") return "JORDAN"; if (e && e.person === "Mia") return "MIA";
  return /PROFESSIONAL REGISTRATION|RED CROSS/.test(desc) ? "MIA" : "JORDAN";
}

function model(w) {
  const L = {}, X = {}; // labels and extras by person|fy
  for (const p of PEOPLE) for (const fy of FYS) { L[`${p}|${fy}`] = {}; X[`${p}|${fy}`] = { payg_cents: 0 }; }
  const put = (person, fy, label, cents) => { if (FYS.includes(fy) && cents) add(L[`${person}|${fy}`], label, cents); };
  const joint = (fy, label, cents) => { const [j, m] = half(cents); put("JORDAN", fy, label, j); put("MIA", fy, label, m); };
  // wages, the pays before the window included
  for (const p of [...w.preHistory.Jordan, ...w.preHistory.Mia, ...w.pays, ...w.agencyPays]) { const person = p.person.toUpperCase(), fy = fyOf(p.date); put(person, fy, "1", p.gross); if (FYS.includes(fy)) X[`${person}|${fy}`].payg_cents += p.tax; }
  // interest, by dated ownership
  for (const [date, acct, , amt, cat] of w.base.transactions) {
    if (cat !== "INTEREST") continue;
    const c = toCents(amt), fy = fyOf(date);
    if (acct === "ACC-OLD") put("JORDAN", fy, "10", c);
    else if (acct === "ACC-SAV" && date >= "2024-07-01") put("MIA", fy, "10", c);
    else joint(fy, "10", c);
  }
  for (const r of w.lines["ACC-WAT"]) if (r.desc === "CREDIT INTEREST") put("MIA", fyOf(r.date), "10", r.cents);
  for (const m of broker.hub(w)) for (const r of m.rows) if (r.desc === "CASH HUB INTEREST") joint(fyOf(r.date), "10", r.cents);
  // dividends and trust income
  for (const d of w.broker.divs) { const fy = fyOf(d.date); joint(fy, "11T", d.franked); joint(fy, "11U", d.credit); }
  const gainsTrust = {};
  for (const [fy, codes] of Object.entries(w.brokerTax)) for (const [code, c] of Object.entries(codes)) {
    const y = Number(fy), skip = code === "WHSK" && y === 2023; // Mia's original FY2023 return missed this statement
    const trust = [["13U", c.interest + c.unfranked], ["13C", c.franked], ["13Q", c.credit], ["20M", c.foreign], ["20O", c.foreign_credit]];
    for (const [k, v] of trust) { const [j, m] = half(v); put("JORDAN", y, k, j); if (!skip) put("MIA", y, k, m); else { const o = (X[`MIA|${y}`].missed = X[`MIA|${y}`].missed || {}); add(o, k, m); } }
    const [gj, gm] = half(c.gain * 2);
    add(gainsTrust, `JORDAN|${y}`, gj); if (!skip) add(gainsTrust, `MIA|${y}`, gm); else X[`MIA|${y}`].missedGain = gm;
  }
  // ESS, at the taxing point
  for (const v of w.rsu.vests) put("JORDAN", fyOf(v.taxing), "12", v.cents);
  // staking rewards
  for (const t of w.crypto.income) put("JORDAN", fyOf(t.time.slice(0, 10)), "24", t.aud);
  // capital gains: each person's rows, losses first, then the discount
  const rows = {};
  const pushGain = (person, fy, g) => { (rows[`${person}|${fy}`] = rows[`${person}|${fy}`] || []).push(g); };
  for (const g of w.broker.cgt) { const fy = fyOf(g.disposed_on), [j, m] = half(g.gain_cents); pushGain("JORDAN", fy, { gain: j, disc: g.discount_eligible, src: g.instrument }); pushGain("MIA", fy, { gain: m, disc: g.discount_eligible, src: g.instrument }); }
  for (const s of w.rsu.sales) if (s.date !== s.vest) { const v = w.rsu.vests.find((x) => x.date === s.vest); pushGain("JORDAN", fyOf(s.date), { gain: s.cents - v.cents, disc: false, src: "NWGL" }); }
  for (const g of w.crypto.gains) pushGain("JORDAN", fyOf(g.disposed_on), { gain: g.gain_cents, disc: g.discount_eligible, src: g.asset });
  const cgt = {}, carry = { JORDAN: 0, MIA: 0 };
  const netGain = (person, fy, extraDisc, persist) => {
    let pool = carry[person], disc = extraDisc, other = 0, total = extraDisc;
    for (const g of rows[`${person}|${fy}`] || []) { if (g.gain < 0) pool -= g.gain; else { total += g.gain; if (g.disc) disc += g.gain; else other += g.gain; } }
    const a = Math.min(pool, other); other -= a; pool -= a; const b = Math.min(pool, disc); disc -= b; pool -= b;
    const net = Math.floor(disc / 2) + other;
    if (persist) carry[person] = pool;
    return { total, net, carried: pool };
  };
  // rentals
  for (const [, x] of Object.entries(w.base.properties.RENTAL.months)) for (const [date, , amt, cat] of x.lines) {
    const c = toCents(amt), fy = fyOf(date);
    if (cat === "RENT-INC") joint(fy, "21P", c); else if (cat === "RENT-INT") joint(fy, "21Q", -c); else joint(fy, "21X", -c);
  }
  for (const s of w.schedules.RENTAL) if (FYS.includes(s.fy)) joint(s.fy, s.division === "43" ? "21F" : "21X", s.cents);
  for (const x of w.rental2.own) { const fy = fyOf(monthEnd(x.ym)); put("MIA", fy, "21P", x.rent); put("MIA", fy, "21X", x.fee + x.repair); }
  for (const x of w.rental2.loanRows) put("MIA", fyOf(monthEnd(x.ym)), "21Q", x.interest);
  for (const b of w.rental2.bills) put("MIA", fyOf(b.date), "21X", b.cents);
  for (const p of w.rental2.premiums) put("MIA", fyOf(p.paid_on), "21X", toCents(p.premium));
  for (const s of w.schedules.RENTAL2) if (FYS.includes(s.fy)) put("MIA", s.fy, s.division === "43" ? "21F" : "21X", s.cents);
  // work and giving from the bank
  for (const [date, , desc, amt, cat] of w.base.transactions) {
    if (!["WORK-EQUIP", "WORK-OTHER", "DONATION"].includes(cat)) continue;
    const c = -toCents(amt), p = personOf(w, date, toCents(amt), desc); put(p, fyOf(date), cat === "DONATION" ? "D9" : "D5", c);
  }
  // working from home, Jordan only
  const hours = { 2020: 420, 2021: 880, 2022: 840, 2023: 780, 2024: 760, 2025: 760, 2026: 760 };
  for (const [fy, h] of Object.entries(hours)) put("JORDAN", Number(fy), "D5", Math.round(h * T.WFH[fy] * 100));
  for (const p of PEOPLE) for (const fy of FYS) put(p, fy, "D10", 19800);
  // a person's other deductible costs: fixed, then the lever
  const fixedOther = { "MIA|D3": 28500 };
  for (const fy of FYS) put("MIA", fy, "D3", fixedOther["MIA|D3"]);
  return { L, X, rows, cgt, carry, netGain, gainsTrust, hours };
}

// the refunds that fix the first six years, read straight from the bank lines, Jordan's first each year
function targets(w) {
  const out = {}; const lines = w.base.transactions.filter((t) => t[2] === "ATO TAX REFUND").sort((a, b) => (a[0] < b[0] ? -1 : 1));
  lines.forEach((t, i) => { const y = Number(t[0].slice(0, 4)); out[`${i % 2 === 0 ? "JORDAN" : "MIA"}|${y}`] = { cents: toCents(t[3]), date: t[0], acct: t[1] }; });
  return out;
}

const HELP_EVENTS = [["2021-08-31", 228000], ["2022-03-31", 228000], ["2022-08-31", 232000], ["2023-03-31", 236000], ["2023-08-31", 240000]];
const LATE_REFUND = { "JORDAN|2025": "2025-08-21", "MIA|2025": "2025-09-09", "JORDAN|2026": "2026-08-20", "MIA|2026": "2026-09-09" };

// Lodged return lines, leaves distinct from subtotals and memos. line_id is unique inside a return.
function returnLines(labels, a) {
  const rows = [], leaf = (k, section, up) => { if (labels[k]) rows.push({ line_id: k, label: k, section, role: "leaf", rolls_up_to: up, cents: labels[k], desc: DESC[k] }); };
  for (const k of ["1", "10", "11S", "11T", "11U", "12", "13U", "13C", "13Q", "18A", "20M", "24"]) leaf(k, "Income", "TI");
  for (const k of ["21P", "21Q", "21F", "21X"]) leaf(k, "Rental", "21NET");
  rows.push({ line_id: "21NET", label: "21", section: "Rental", role: "subtotal", rolls_up_to: "TI", cents: a.rent_cents, desc: "Net rent" });
  rows.push({ line_id: "TI", label: "TI", section: "Income", role: "subtotal", cents: a.total_income_cents, desc: "Total income" });
  for (const k of ["D1", "D3", "D4", "D5", "D9", "D10"]) leaf(k, "Deductions", "TD");
  rows.push({ line_id: "TD", label: "TD", section: "Deductions", role: "subtotal", cents: a.deductions_cents, desc: "Total deductions" });
  rows.push({ line_id: "TX", label: "TX", section: "Taxable", role: "subtotal", cents: a.taxable_income_cents, desc: "Taxable income" });
  if (labels["18H"]) rows.push({ line_id: "18H", label: "18H", section: "Memo", role: "memo", cents: labels["18H"], desc: DESC["18H"] });
  if (labels["20O"]) rows.push({ line_id: "20O", label: "20O", section: "Memo", role: "memo", cents: labels["20O"], desc: DESC["20O"] });
  if (labels["18V"]) rows.push({ line_id: "18V", label: "18V", section: "Carry", role: "carry", cents: labels["18V"], desc: DESC["18V"] });
  return rows;
}

const cr = (c) => `${money(Math.abs(c))} ${c >= 0 ? "CR" : "DR"}`;
function returnDoc(w, person, fy, r) {
  const a = r.res, d = new Doc({ brand: AGENT, title: "Tax return", kicker: `Year ended ${fmtDate(fyEnd(fy))}`, deflate: w.deflate, style: "plain" });
  d.h1(`FY${fy} tax return for ${NAME[person]} Davies`);
  d.kv([["Taxpayer", `${NAME[person]} Davies`], ["Financial year", `FY${fy}`], ["Version", String(r.version)], ["Lodged on", fmtDate(r.lodged_on)], ["Assessed on", fmtDate(r.assessed_on)], ["Prepared by", AGENT.name]], 3);
  d.h2("Return labels");
  d.table([{ label: "Section", w: 70 }, { label: "Label", w: 50 }, { label: "Description", w: 240 }, { label: "Amount", w: 90, align: "right" }], returnLines(r.labels, a).map((x) => [x.section, x.line_id, x.desc, money(x.cents)]));
  d.h2("Assessment");
  const rows = [["Gross tax", money(a.gross_tax_cents)], ["Offsets", money(a.offsets_cents)], ["Medicare levy", money(a.medicare_levy_cents)], ["HELP repayment", money(a.help_cents)], ["PAYG credits", money(a.payg_credits_cents)], ["Other credits", money(a.other_credits_cents)]];
  if (a.rounding_cents) rows.push(["Of which rounding credit", money(a.rounding_cents)]);
  rows.push(["Result", cr(a.result_cents)]);
  d.table([{ label: "Item", w: 300 }, { label: "Amount", w: 120, align: "right" }], rows);
  d.para("A copy of the return as lodged, with the assessment, kept by your tax agent. Fictional, and not advice.", { size: 8.5, color: MUTED });
  return d.finish();
}
function noaDoc(w, person, fy, r) {
  const a = r.res, d = new Doc({ brand: GOV, title: "Notice of assessment", deflate: w.deflate });
  const L = M, R = 316; let y = d.y;
  d.text(L, y, r.version > 1 ? "Notice of amended assessment" : "Notice of assessment", { size: 16, bold: true }); y -= 26;
  const left = [["Name", `${NAME[person]} Davies`], ["Financial year", `FY${fy}`], ["Date of issue", fmtDate(r.assessed_on)], ["Return lodged", fmtDate(r.lodged_on)], ["Version", String(r.version)], ["Reference", `NOA-${person.slice(0, 1)}-${fy}-${r.version}`]];
  const right = [["Taxable income", money(a.taxable_income_cents)], ["Gross tax", money(a.gross_tax_cents)], ["Less offsets", money(a.offsets_cents)], ["Medicare levy", money(a.medicare_levy_cents)], ["HELP repayment", money(a.help_cents)], ["PAYG credits", money(a.payg_credits_cents)], ["Other credits", money(a.other_credits_cents)], ...(a.rounding_cents ? [["Rounding credit included", money(a.rounding_cents)]] : []), ["Result of this notice", cr(a.result_cents)]];
  const n = Math.max(left.length, right.length);
  for (let i = 0; i < n; i++) { if (left[i]) { d.text(L, y, left[i][0], { size: 9, color: MUTED }); d.text(L + 84, y, left[i][1], { size: 9.5 }); } if (right[i]) { d.text(R, y, right[i][0], { size: 9, color: MUTED }); d.text(R + 220, y, right[i][1], { size: 9.5, align: "right", bold: i === right.length - 1 }); } y -= 16; }
  d.y = y - 10;
  d.para(`${a.result_cents >= 0 ? `Your refund goes to the bank account we hold for you.` : `Pay by the date on your statement of account.`} A parody of a government notice. Fictional, and not advice.`, { size: 8.5, color: MUTED });
  return d.finish();
}

function prefill(w, person, fy, labels, x) {
  const items = [];
  const wages = {}; for (const p of [...w.preHistory.Jordan, ...w.preHistory.Mia, ...w.pays, ...w.agencyPays]) if (p.person.toUpperCase() === person && fyOf(p.date) === fy) { const k = wages[p.employer] = wages[p.employer] || { gross: 0, tax: 0 }; k.gross += p.gross; k.tax += p.tax; }
  for (const [payer, v] of Object.entries(wages)) items.push({ label: "1", source: payer, amount: Number(fix(v.gross)), withheld: Number(fix(v.tax)) });
  if (labels["10"]) items.push({ label: "10", source: "Banks and financial institutions", amount: Number(fix(labels["10"])) });
  if (labels["11T"]) items.push({ label: "11T", source: "Computerpaw", amount: Number(fix(labels["11T"])) });
  if (labels["11U"]) items.push({ label: "11U", source: "Computerpaw", amount: Number(fix(labels["11U"])) });
  if (labels["12"]) items.push({ label: "12", source: "E*Treat", amount: Number(fix(labels["12"])) });
  return { service: "myGuv", person: `${NAME[person]} Davies`, financialYear: `${fy - 1}-${String(fy).slice(2)}`, periodEnd: fyEnd(fy), status: "Pre-fill ready", items };
}

function worksheet(w, person, fy, rows) {
  const data = [[`Deductions worksheet, ${NAME[person]} Davies`], ["Financial year", `FY${fy}`], ["Year end", { date: fyEnd(fy) }], [], ["Label", "Description", "Amount"], ...rows.map((r) => [r.label, r.desc, r.cents / 100]), [], ["Total", "", rows.reduce((s, r) => s + r.cents, 0) / 100]];
  return workbook([{ name: "Worksheet", rows: data }], w.deflateRaw);
}

function healthDoc(w, person, fy, h) {
  const d = new Doc({ brand: { name: "Bupaw", tagline: "Health cover for the whole litter.", color: "#0369a1" }, title: "Private health insurance statement", kicker: `Year ended ${fmtDate(fyEnd(fy))}`, deflate: w.deflate });
  d.h1(`Tax statement for ${NAME[person]} Davies`);
  d.kv([["Member", `${NAME[person]} Davies`], ["Policy", "BW-7701342"], ["Financial year", `FY${fy}`], ["Year end", fmtDate(fyEnd(fy))], ["Rebate tier", h.tier], ["Benefit code", h.code]], 3);
  d.h2("Statement details");
  d.table([{ label: "Item", w: 320 }, { label: "Amount", w: 120, align: "right" }], [["Your share of premiums paid", money(h.premium)], ["Australian Government rebate received", money(h.rebate)], ["Days covered", String(h.days)]]);
  d.para("Use these figures for the private health insurance policy details on your tax return. Fictional, a parody insurer.", { size: 8.5, color: MUTED });
  return d.finish();
}

function helpPage(fy, rows, closing) {
  const body = `<h1>HELP account</h1><p>Name: Mia Davies</p><p>Financial year: FY${fy}</p><table>${row(["Date", "Description", "Amount", "Balance"], "th")}${rows.map((r) => row([fmtDate(r.date), r.desc, fix(r.cents), fix(r.balance)])).join("")}</table><p>Closing balance: ${fix(closing)}</p>`;
  return page(`myGuv HELP account FY${fy}`, body);
}

function run(w) {
  const S = w.setup, m = model(w), tg = targets(w), results = {};
  S.account.push({ account_id: "HELP-M", name: "HELP debt, Mia", class: "liability", type: "help_debt", reporting_group: "tax", currency: "AUD", opened_on: "2021-08-31", in_scope: false, fidelity: "ledger" });
  ["legal", "beneficial", "tax"].forEach((basis) => S.ownership.push({ subject_type: "account", subject_id: "HELP-M", party_id: "MIA", basis, share_bps: 10000, valid_from: "2021-08-31", recorded_at: "2021-08-31T00:00:00Z" }));
  S.party.push({ party_id: "AGENT", kind: "organisation", name: AGENT.name }, { party_id: "BUPAW", kind: "organisation", name: "Bupaw" });
  for (const [sel, label, treatment, basis] of [["INTEREST", "10", "income", "ownership"], ["RENT-INC", "21P", "income", "ownership"], ["RENT-INT", "21Q", "deduction", "ownership"], ["RENT-MGMT", "21X", "deduction", "ownership"], ["RENT-RATES", "21X", "deduction", "ownership"], ["RENT-STRATA", "21X", "deduction", "ownership"], ["RENT-INS", "21X", "deduction", "ownership"], ["RENT-REPAIR", "21X", "deduction", "ownership"], ["RENT-OTHER", "21X", "deduction", "ownership"], ["WORK-EQUIP", "D5", "deduction", "person"], ["WORK-OTHER", "D5", "deduction", "person"], ["DONATION", "D9", "deduction", "person"], ["CRYPTO-INCOME", "24", "income", "person"]])
    S.tax_map.push({ selector_type: "category", selector: sel, label, treatment, basis, valid_from: "2018-07-01" });
  for (const p of ["J", "M"]) {
    const person = p === "J" ? "JORDAN" : "MIA";
    stream(w, `TAX-${p}`, `${NAME[person]}'s return and assessment`, "tax_assessment", "party", person, "yearly", "2019-07-01", { issuer_party_id: "ATO", grace_days: 120 });
    stream(w, `PREFILL-${p}`, `${NAME[person]}'s pre-fill`, "prefill", "party", person, "yearly", "2019-07-01", { issuer_party_id: "ATO", grace_days: 45 });
    stream(w, `DED-${p}`, `${NAME[person]}'s deductions worksheet`, "work_log", "party", person, "yearly", "2019-07-01", { grace_days: 60 });
    stream(w, `PHI-${p}`, `${NAME[person]}'s health insurance statement`, "health_statement", "party", person, "yearly", "2019-07-01", { issuer_party_id: "BUPAW", grace_days: 30 });
  }
  stream(w, "WFH-J", "Jordan's work-from-home log", "work_log", "party", "JORDAN", "yearly", "2020-03-01", { grace_days: 60 });
  stream(w, "HELP-M", "Mia's HELP account", "help_balance", "party", "MIA", "yearly", "2021-08-31", { issuer_party_id: "ATO", grace_days: 60 });

  for (const fy of FYS) for (const person of PEOPLE) {
    const key = `${person}|${fy}`, labels = { ...m.L[key] }, x = m.X[key];
    const net = m.netGain(person, fy, m.gainsTrust[key] || 0, true);
    if (net.net) labels["18A"] = net.net; if (net.total) labels["18H"] = net.total; if (net.carried) labels["18V"] = net.carried;
    const extra = { payg_cents: x.payg_cents, help_debt_cents: person === "MIA" && fy >= 2022 ? 2000000 : 0 };
    const target = tg[key];
    const withLever = (l) => assess(fy, { ...labels, D5: (labels.D5 || 0) + l * 100 }, extra);
    let lever = 0, rounding = 0;
    if (target) {
      if (withLever(0).result_cents > target.cents) throw new Error(`${key} cannot reach its refund: over by ${withLever(0).result_cents - target.cents}`);
      let lo = 0, hi = 40000;
      while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (withLever(mid).result_cents <= target.cents) lo = mid; else hi = mid - 1; }
      lever = lo; rounding = target.cents - withLever(lever).result_cents;
      if (rounding < 0 || rounding >= 100) throw new Error(`${key} leaves ${rounding} cents`);
    }
    // the lever, on the labels a person would use
    const parts = [];
    if (person === "JORDAN") { const car = Math.min(lever, 1500); if (car) parts.push({ label: "D1", desc: "Car, cents per kilometre, client visits", cents: car * 100 }); if (lever > car) parts.push({ label: "D5", desc: "Home office, phone and subscriptions", cents: (lever - car) * 100 }); }
    else { const other = Math.min(lever, 1000); if (other) parts.push({ label: "D5", desc: "Union fees, phone, registrations", cents: other * 100 }); if (lever > other) parts.push({ label: "D4", desc: "Graduate certificate, books and travel", cents: (lever - other) * 100 }); }
    for (const q of parts) labels[q.label] = (labels[q.label] || 0) + q.cents;
    const res = assess(fy, labels, { ...extra, rounding_cents: rounding });
    if (target && res.result_cents !== target.cents) throw new Error(`${key} lands on ${res.result_cents}, wants ${target.cents}`);
    const date = target ? target.date : LATE_REFUND[key];
    const rec = { labels, res, lever, rounding, parts, version: 1, assessed_on: addDays(date, -3), lodged_on: addDays(date, -12), paid_on: date };
    results[key] = rec;
    if (!target) { if (res.result_cents <= 0) throw new Error(`${key} is not a refund: ${res.result_cents}`); w.line("ACC-OLD", date, "ATO TAX REFUND", res.result_cents); }
  }

  // Mia's amendment: FY2023 missed the WHSK statement. The extra tax is paid from ACC-OLD.
  const r = results["MIA|2023"], x = m.X["MIA|2023"], v2 = { ...r.labels };
  for (const [k, v] of Object.entries(x.missed || {})) v2[k] = (v2[k] || 0) + v;
  const gain = m.gainsTrust["MIA|2023"] || 0, total = gain + (x.missedGain || 0);
  v2["18H"] = (v2["18H"] || 0) + (x.missedGain || 0); v2["18A"] = (v2["18A"] || 0) - Math.floor(gain / 2) + Math.floor(total / 2);
  const res2 = assess(2023, v2, { payg_cents: x.payg_cents, help_debt_cents: 2000000, rounding_cents: r.rounding });
  const amended = { labels: v2, res: res2, version: 2, assessed_on: "2024-03-18", lodged_on: "2024-03-06", parts: r.parts, rounding: r.rounding, lever: r.lever };
  const extraTax = r.res.result_cents - res2.result_cents;
  if (extraTax <= 0) throw new Error("the amendment must cost tax");
  w.line("ACC-OLD", "2024-04-08", "ATO AMENDED ASSESSMENT PAYMENT", -extraTax);

  // files
  const wfhRate = (fy) => T.WFH[fy];
  const truth = {}, cgtTruth = {}; 
  for (const fy of FYS) for (const person of PEOPLE) {
    const key = `${person}|${fy}`, rec = results[key], p = person === "JORDAN" ? "J" : "M", n = NAME[person], next = `${fy}-08-01`;
    for (const v of (key === "MIA|2023" ? [rec, amended] : [rec])) {
      const tag = v.version > 1 ? "-amended" : "";
      w.file({ stream_id: `TAX-${p}`, download_date: v.assessed_on, name: `Tax-Return-${n}-FY${fy}${tag}.pdf`, bytes: returnDoc(w, person, fy, v), family: "agent-return-pdf", container: "pdf", expect: { tax_assessment: 1 }, origin: "email", issued_on: v.assessed_on });
      w.file({ stream_id: `TAX-${p}`, download_date: v.assessed_on, name: `Notice-of-Assessment-${n}-FY${fy}${tag}.pdf`, bytes: noaDoc(w, person, fy, v), family: "myguv-noa-pdf", container: "pdf", expect: { tax_assessment: 1 }, origin: "portal", issued_on: v.assessed_on });
    }
    w.file({ stream_id: `PREFILL-${p}`, download_date: next, name: `myGuv-prefill-${n}-FY${fy}.json`, text: `${JSON.stringify(prefill(w, person, fy, rec.labels), null, 2)}\n`, family: "myguv-prefill-json", container: "json", expect: { prefill: 1 }, origin: "connector", issued_on: next });
    const ded = [{ label: "D10", desc: "Tax agent's fee", cents: 19800 }, ...(person === "MIA" ? [{ label: "D3", desc: "Uniform and laundry", cents: 28500 }] : []), ...rec.parts];
    w.file({ stream_id: `DED-${p}`, download_date: next, name: `Deductions-Worksheet-${n}-FY${fy}.xlsx`, bytes: worksheet(w, person, fy, ded), family: "deductions-xlsx", container: "xlsx", expect: { work_log: ded.length }, origin: "manual", issued_on: next });
    truth[person] = truth[person] || {};
    const flat = (v) => ({ ...v.labels, taxable_income_cents: v.res.taxable_income_cents, total_income_cents: v.res.total_income_cents, deductions_cents: v.res.deductions_cents, gross_tax_cents: v.res.gross_tax_cents, offsets_cents: v.res.offsets_cents, medicare_levy_cents: v.res.medicare_levy_cents, help_cents: v.res.help_cents, payg_credits_cents: v.res.payg_credits_cents, other_credits_cents: v.res.other_credits_cents, rounding_credit_cents: v.res.rounding_cents, tax_cents: v.res.gross_tax_cents - v.res.offsets_cents + v.res.medicare_levy_cents + v.res.help_cents, result_cents: v.res.result_cents, lever_dollars: v.lever, assessed_on: v.assessed_on, lodged_on: v.lodged_on, version: v.version });
    truth[person][`FY${fy}`] = flat(key === "MIA|2023" ? amended : rec);
    if (key === "MIA|2023") truth[person][`FY${fy}`].original = flat(rec);
    cgtTruth[person] = cgtTruth[person] || {};
    const rows = m.rows[key] || [];
    cgtTruth[person][`FY${fy}`] = { total_gains_cents: (key === "MIA|2023" ? amended : rec).labels["18H"] || 0, net_capital_gain_cents: (key === "MIA|2023" ? amended : rec).labels["18A"] || 0, carried_loss_cents: rec.labels["18V"] || 0, rows };
  }
  for (const [fy, hours] of Object.entries(m.hours)) {
    const y = Number(fy), months = y === 2020 ? monthRange("2020-03", "2020-06") : monthRange(`${y - 1}-07`, `${y}-06`), each = Math.floor(hours / months.length);
    const rows = months.map((ym, i) => [ym, "Jordan Davies", String(i === months.length - 1 ? hours - each * (months.length - 1) : each)]);
    w.file({ stream_id: "WFH-J", download_date: `${y}-07-20`, name: `WFH-Log-FY${y}.csv`, text: csvLines([["Month", "Person", "Hours worked at home"], ...rows, ["Total", "", String(hours)]]), family: "wfh-log-csv", container: "csv", expect: { work_log: months.length }, origin: "manual", issued_on: `${y}-07-20` });
  }

  // private health, by the family's income tier for the year
  const prem = {}; for (const [date, , desc, amt] of w.base.transactions) if (desc === "BUPA HEALTH INSURANCE") add(prem, fyOf(date), -toCents(amt));
  const first = -toCents(w.base.transactions.find((t) => t[2] === "BUPA HEALTH INSURANCE")[3]);
  prem[2019] += first * 8; // July 2018 to February 2019, before the first file
  const healthTruth = [];
  for (const fy of FYS) {
    const family = (results[`JORDAN|${fy}`].res.taxable_income_cents + results[`MIA|${fy}`].res.taxable_income_cents) / 100, t = T.PHI_TIER(fy), tier = family <= t[0] ? 0 : family <= t[1] ? 1 : family <= t[2] ? 2 : 3;
    const rate = tier === 3 ? 0 : T.PHI_RATE[fy][tier], days = fy % 4 === 0 ? 366 : 365, gross = Math.round(prem[fy] / (1 - rate)), rebate = gross - prem[fy];
    const shareP = [Math.ceil(prem[fy] / 2), Math.floor(prem[fy] / 2)], shareR = [Math.ceil(rebate / 2), Math.floor(rebate / 2)];
    PEOPLE.forEach((person, i) => {
      const p = i === 0 ? "J" : "M", h = { premium: shareP[i], rebate: shareR[i], days, tier: ["Base", "Tier 1", "Tier 2", "Tier 3"][tier], code: "30" };
      w.file({ stream_id: `PHI-${p}`, download_date: `${fy}-07-12`, name: `Bupaw-Tax-Statement-${NAME[person]}-FY${fy}.pdf`, bytes: healthDoc(w, person, fy, h), family: "bupaw-statement-pdf", container: "pdf", expect: { health_statement: 1 }, origin: "portal", issued_on: `${fy}-07-12` });
      healthTruth.push({ person, fy: `FY${fy}`, premium_cents: h.premium, rebate_cents: h.rebate, days_covered: days, tier: h.tier });
    });
  }

  // HELP, in date order: debts at census, indexation each 1 June, repayments at assessment
  const ev = HELP_EVENTS.map(([date, c]) => ({ date, kind: "debt", desc: "Debt incurred, census date", cents: c, ord: 1 }));
  for (const fy of Object.keys(T.HELP_INDEX).map(Number)) if (fy >= 2022) ev.push({ date: `${fy}-06-01`, kind: "index", desc: "Indexation, 1 June", rate: T.HELP_INDEX[fy], ord: 0 });
  for (const fy of FYS) { const v = results[`MIA|${fy}`]; if (v.res.help_cents) ev.push({ date: v.assessed_on, kind: "repay", desc: "Compulsory repayment on assessment", cents: -v.res.help_cents, ord: 2 }); }
  if (amended.res.help_cents !== r.res.help_cents) ev.push({ date: amended.assessed_on, kind: "repay", desc: "Compulsory repayment, amended assessment", cents: r.res.help_cents - amended.res.help_cents, ord: 2 });
  ev.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.ord - b.ord));
  let bal = 0; const ledger = [];
  for (const e of ev) { const c = e.kind === "index" ? Math.round(bal * e.rate) : e.cents; bal += c; if (bal < 0) throw new Error("HELP went negative"); ledger.push({ ...e, cents: c, balance: bal }); }
  for (let fy = 2022; fy <= 2026; fy++) {
    const rows = ledger.filter((e) => fyOf(e.date) === fy && e.kind !== "debt0"); if (!rows.length) continue;
    w.file({ stream_id: "HELP-M", download_date: `${fy}-07-15`, name: `myGuv-HELP-account-FY${fy}.html`, text: helpPage(fy, rows, rows[rows.length - 1].balance), family: "myguv-help-html", container: "html", expect: { help_balance: rows.length }, origin: "portal", issued_on: `${fy}-07-15` });
  }
  w.truth.tax = truth;
  w.truth.cgt = cgtTruth;
  w.truth.help = ledger.map(({ date, kind, cents, balance }) => ({ date, kind, cents, balance_cents: balance }));
  w.truth.health = healthTruth;
  w.truth.super_contributions = w.truth.super.by_type_fy;
  w.taxResults = results;
}

module.exports = { run, model, targets, FYS, PEOPLE };
