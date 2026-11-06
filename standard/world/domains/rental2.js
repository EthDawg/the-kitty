/* The second rental: a Ballarat cottage bought November 2023 in Mia's name, a new account and a new loan at Wattle, a different manager whose statement nets fees and a
   repair out of the rent so the bank sees one net disbursement. Three months vacant, then positively geared. Deposit from the cash hub. */
"use strict";
const { toCents, fix, money, aud, dmy, addDays, fmtDate, fmtMonth, monthEnd, monthRange, nextMonth, fyOf, fyStart, fyEnd, MONTHS, dayDiff, lastDay, mulDiv } = require("../lib/util");
const { Doc, MUTED, A4, M } = require("../lib/pdf");
const { workbook } = require("../lib/xlsx");
const { wattleCsv } = require("./banks");
const { settlementDoc, policyFiles } = require("./property");
const { stream } = require("./setup");

const LOAN_NO = "813-770 21 0044 516", ADDRESS = "14 Lydiard Cottage Lane, Ballarat VIC 3350", OWNER_REF = "GF-20931";
const SETTLE = { price: 39500000, duty: 1877000, legal: 148000, adjustments: 21240, loan: 18000000 };
const FEE_BPS = 770;
const BRAND = { name: "RentPurrfect", tagline: "Goldpaws Realty owner services.", color: "#b45309" };
const WATTLE = { name: "PING", tagline: "Wattle Credit Union online.", color: "#c2410c" };
// rent a month, repairs netted by the agent
const RENT = [["2024-03", 208000], ["2025-03", 216000], ["2026-03", 225000]];
const REPAIRS = { "2024-04": ["Plumber, kitchen tap", 28600], "2025-08": ["Hot water thermostat", 41250], "2026-01": ["Gutter clean", 16500], "2026-11": ["Fence paling repair", 23800] };
const at = (t, ym) => { let v = 0; for (const [k, x] of t) if (ym >= k) v = x; return v; };

function ownerDoc(w, x) {
  const d = new Doc({ brand: BRAND, title: "Owner statement", deflate: w.deflate, style: "plain" });
  const L = M, R = 316; let y = d.y;
  d.text(L, y, "Owner statement", { size: 16, bold: true }); d.text(R, y, fmtMonth(x.ym), { size: 12, bold: true }); y -= 26;
  const left = [["Owner", "Mia Davies"], ["Owner reference", OWNER_REF], ["Property", "14 Lydiard Cottage Lane"], ["Suburb", "Ballarat VIC 3350"], ["Period start", fmtDate(`${x.ym}-01`)], ["Period end", fmtDate(monthEnd(x.ym))]];
  const right = [["Rent collected", money(x.rent)], ["Management fee", money(x.fee)], ["Repairs paid", money(x.repair)], ["Sundry", money(0)], ["Net paid to owner", money(x.net)], ["Paid on", fmtDate(x.paid)]];
  // two columns of label and value, the left and the right read separately
  for (let i = 0; i < left.length; i++) { d.text(L, y, left[i][0], { size: 9, color: MUTED }); d.text(L + 90, y, left[i][1], { size: 9.5 }); d.text(R, y, right[i][0], { size: 9, color: MUTED }); d.text(R + 150, y, right[i][1], { size: 9.5, bold: i === 4, align: "right" }); y -= 16; }
  y -= 10; d.y = y;
  d.h2("What we did");
  d.table([{ label: "Item", w: 330 }, { label: "Amount", w: 110, align: "right" }], [["Rent received from tenant", money(x.rent)], [`Management fee at ${(FEE_BPS / 100).toFixed(2)}%`, money(-x.fee)], ...(x.repair ? [[x.repairName, money(-x.repair)]] : []), ["Disbursed to owner", money(x.net)]]);
  return d.finish();
}

function loanStatementDoc(w, rows, fy) {
  const from = `${rows[0].ym}-01`, to = monthEnd(rows[rows.length - 1].ym);
  const d = new Doc({ brand: WATTLE, title: "Loan statement", kicker: `${fmtDate(from)} to ${fmtDate(to)}`, deflate: w.deflate });
  d.h1("Investment loan, Lydiard Cottage Lane");
  const interest = rows.reduce((s, x) => s + x.interest, 0), repaid = rows.reduce((s, x) => s + x.repayments, 0);
  d.kv([["Loan number", LOAN_NO], ["Borrower", "Mia Davies"], ["Interest rate", `${rows[rows.length - 1].rate} % p.a.`], ["Repayment type", "Interest only"], ["Opening balance", aud(rows[0].opening)], ["Closing balance", aud(rows[rows.length - 1].closing)], ["Interest charged", aud(interest)], ["Repayments received", aud(repaid)]], 4);
  d.h2("Monthly summary");
  d.table([{ label: "Month", w: 80 }, { label: "Rate", w: 50, align: "right" }, { label: "Opening", w: 85, align: "right" }, { label: "Interest charged", w: 80, align: "right" }, { label: "Repayments", w: 80, align: "right" }, { label: "Closing", w: 85, align: "right" }], rows.map((x) => [fmtMonth(x.ym), `${x.rate}%`, money(x.opening), money(x.interest), money(x.repayments), money(x.closing)]), { foot: ["Total", "", "", money(interest), money(repaid), money(rows[rows.length - 1].closing)] });
  return d.finish();
}

function rateNoticeDoc(w, n) {
  const d = new Doc({ brand: WATTLE, title: "Rate change", deflate: w.deflate, style: "plain" });
  d.h1("We are changing your interest rate");
  d.table([{ label: "Detail", w: 200 }, { label: "Value", w: 240 }], [["Loan number", LOAN_NO], ["New rate", `${n.rate}% p.a.`], ["Effective from", fmtDate(n.effective_on)], ["Date of this letter", fmtDate(n.notified_on)]]);
  return d.finish();
}

function scheduleBook(w, asset, address, issued, rows, firm) {
  const head = [["Quantity surveyor's depreciation schedule"], ["Property", address], ["Issued", { date: issued }], ["Prepared by", firm], [], ["Financial year", "Division", "Item", "Deduction"]];
  const body = rows.map((r) => [`FY${r.fy}`, r.division, r.item, r.cents / 100]);
  return workbook([{ name: "Schedule", rows: [...head, ...body, [], ["Total", "", "", rows.reduce((s, r) => s + r.cents, 0) / 100]] }], w.deflateRaw);
}

function run(w) {
  const S = w.setup;
  S.party.push({ party_id: "GOLDPAWS", kind: "organisation", name: "Goldpaws Realty", note: "Reached through the parody portal RentPurrfect." }, { party_id: "BALLARATCONV", kind: "organisation", name: "Whisker Lane Conveyancing" }, { party_id: "QSFIRM", kind: "organisation", name: "Tabby and Tom Quantity Surveyors" });
  S.account.push({ account_id: "ACC-RN2", name: "Ballarat rental account", class: "asset", type: "transaction", reporting_group: "cash", currency: "AUD", institution_party_id: "WATTLE", opened_on: "2023-11-01", liquid: true, in_scope: false, fidelity: "ledger", opening_balance_cents: 0, opening_date: "2023-11-01" },
    { account_id: "RENTAL2", name: "Ballarat cottage", class: "asset", type: "property", reporting_group: "property", currency: "AUD", asset_id: "RENTAL2", opened_on: "2023-11-15", in_scope: false, fidelity: "ledger" },
    { account_id: "LN-INV2", name: "Ballarat investment loan", class: "liability", type: "loan", reporting_group: "loans", currency: "AUD", institution_party_id: "WATTLE", contract_id: "C-INV2", opened_on: "2023-11-15", in_scope: false, fidelity: "ledger" });
  S.asset.push({ asset_id: "RENTAL2", kind: "property", name: "Ballarat cottage", account_id: "RENTAL2", location: ADDRESS, acquired_on: "2023-11-15" });
  S.activity.push({ activity_id: "ACT-RENTAL2", kind: "rental", name: "Ballarat cottage", asset_id: "RENTAL2", owner_party_id: "MIA", valid_from: "2023-11-15" });
  for (const [type, id] of [["account", "ACC-RN2"], ["account", "RENTAL2"], ["account", "LN-INV2"], ["asset", "RENTAL2"]]) ["legal", "beneficial", "tax"].forEach((basis) => S.ownership.push({ subject_type: type, subject_id: id, party_id: "MIA", basis, share_bps: 10000, valid_from: "2023-11-01", recorded_at: "2023-11-01T00:00:00Z" }));
  S.contract.push({ contract_id: "C-INV2", kind: "loan", name: "Ballarat investment loan", counterparty_party_id: "WATTLE", holder_party_id: "MIA", account_id: "LN-INV2", asset_id: "RENTAL2", category_id: "RENT-INT", started_on: "2023-11-15" },
    { contract_id: "C-LEASE2", kind: "lease", name: "Lease, Ballarat cottage", counterparty_party_id: "GOLDPAWS", asset_id: "RENTAL2", category_id: "RENT-INC", started_on: "2024-03-01" },
    { contract_id: "POL-RENTAL2", kind: "insurance", name: "Landlord insurance, Ballarat", counterparty_party_id: "PURRSURE", asset_id: "RENTAL2", category_id: "RENT-INS", started_on: "2023-11-15" });
  w.linkRow("funds_purpose", "contract", "C-INV2", "asset", "RENTAL2", "2023-11-15", 10000); w.linkRow("secures", "contract", "C-INV2", "asset", "RENTAL2", "2023-11-15"); w.linkRow("serves", "account", "ACC-RN2", "asset", "RENTAL2", "2023-11-01"); w.linkRow("covers", "contract", "POL-RENTAL2", "asset", "RENTAL2", "2023-11-15");
  w.termRow("asset", "RENTAL2", "use", "rental", "enum", "2023-11-15"); w.termRow("contract", "C-INV2", "repayment_type", "interest_only", "enum", "2023-11-15"); w.termRow("contract", "C-INV2", "interest_rate", "6.39", "pct", "2023-11-15", { note: "The rate at settlement." });
  w.alias("account", "ACC-RN2", "name", "ACC-RN2", "2023-11-01"); w.alias("account", "LN-INV2", "loan_number", LOAN_NO, "2023-11-15"); w.alias("contract", "C-INV2", "loan_number", LOAN_NO, "2023-11-15"); w.alias("asset", "RENTAL2", "owner_ref", OWNER_REF, "2024-03-01"); w.alias("asset", "RENTAL", "name", "RENTAL", "2021-08-20"); w.alias("asset", "RENTAL2", "name", "RENTAL2", "2023-11-15"); w.alias("asset", "RENTAL2", "name", ADDRESS, "2023-11-15");
  stream(w, "ACC-RN2", "Ballarat rental account", "transactions", "account", "ACC-RN2", "monthly", "2023-11-01", { issuer_party_id: "WATTLE", grace_days: 10 });
  stream(w, "LN-INV2", "Ballarat loan activity", "transactions", "account", "LN-INV2", "monthly", "2023-11-15", { issuer_party_id: "WATTLE", grace_days: 10 });
  stream(w, "LN-INV2-STMT", "Ballarat loan statement", "loan_statement", "account", "LN-INV2", "yearly", "2023-11-15", { issuer_party_id: "WATTLE", grace_days: 21 });
  stream(w, "OWN-RENTAL2", "Ballarat owner statements", "owner_statement", "asset", "RENTAL2", "monthly", "2024-03-01", { issuer_party_id: "GOLDPAWS", grace_days: 10 });
  stream(w, "SETTLE-RENTAL2", "Settlement statement, Ballarat", "settlement", "asset", "RENTAL2", "event", "2023-11-15", { issuer_party_id: "BALLARATCONV" });
  stream(w, "QS-RENTAL", "Depreciation schedule, Geelong", "depreciation_schedule", "asset", "RENTAL", "event", "2021-10-11", { issuer_party_id: "QSFIRM" });
  stream(w, "QS-RENTAL2", "Depreciation schedule, Ballarat", "depreciation_schedule", "asset", "RENTAL2", "event", "2024-02-05", { issuer_party_id: "QSFIRM" });
  stream(w, "RATE-LN-INV2", "Ballarat loan rate notices", "rate_notice", "contract", "C-INV2", "event", "2023-11-15", { issuer_party_id: "WATTLE" });
  stream(w, "STM-POL-RENTAL2", "Ballarat landlord policy documents", "policy", "contract", "POL-RENTAL2", "yearly", "2023-11-15", { issuer_party_id: "PURRSURE", grace_days: 21 });

  // settlement, from the cash hub
  const cash = SETTLE.price - SETTLE.loan + SETTLE.duty + SETTLE.legal + SETTLE.adjustments;
  w.line("ACC-BRK", "2023-11-14", "TRANSFER TO WHISKER LANE CONVEYANCING TRUST", -cash, { ref: "TFR" });
  w.line("ACC-BRK", "2023-11-15", "TRANSFER TO WATTLE RENTAL ACCOUNT", -800000, { ref: "TFR" });
  w.line("ACC-RN2", "2023-11-15", "TRANSFER FROM CEDAR TRADE", 800000);
  const s = { brand: { name: "Whisker Lane Conveyancing" }, address: ADDRESS, matter: "LSC-23-1142", purchaser: "Mia Davies", settled_on: "2023-11-15", asset_ref: "RENTAL2", price: SETTLE.price, duty: SETTLE.duty, legal: SETTLE.legal, adjustments: SETTLE.adjustments, loan: SETTLE.loan, cash, lender: "Wattle Credit Union", loan_number: LOAN_NO };
  w.file({ stream_id: "SETTLE-RENTAL2", download_date: "2023-11-22", name: "Settlement-Statement-Lydiard-Cottage.pdf", bytes: settlementDoc(w, s), family: "settlement-pdf", container: "pdf", expect: { settlement: 1 }, origin: "email", issued_on: "2023-11-15" });
  w.truth.settlements.push({ asset: "RENTAL2", settled_on: s.settled_on, price_cents: s.price, duty_cents: s.duty, legal_cents: s.legal, adjustments_cents: s.adjustments, loan_drawn_cents: s.loan, cash_paid_cents: cash, witnesses: [["ACC-BRK", "2023-11-14", -cash]] });

  // the loan: interest only, daily on the full balance, debited from the rental account on the last day
  const months = monthRange("2023-11", "2027-03"), rows = [], rate = (d) => (d < "2025-09-15" ? 639 : 614);
  for (const ym of months) {
    const start = ym === "2023-11" ? "2023-11-15" : `${ym}-01`, end = monthEnd(ym); let interest = 0;
    for (let d = start; d <= end; d = addDays(d, 1)) interest += SETTLE.loan * rate(d) / 10000 / 365;
    interest = Math.round(interest);
    rows.push({ ym, opening: SETTLE.loan, interest, repayments: interest, closing: SETTLE.loan, rate: (rate(`${ym}-01`) / 100).toFixed(2) });
    w.line("ACC-RN2", end, "WATTLE LOAN INTEREST 0044516", -interest);
  }
  w.truth.loans["LN-INV2"] = rows.map((x) => ({ month: x.ym, opening_cents: x.opening, interest_cents: x.interest, repayments_cents: x.repayments, closing_cents: x.closing, rate_pct: x.rate }));
  for (const fy of [...new Set(rows.map((x) => fyOf(`${x.ym}-01`)))]) {
    const r = rows.filter((x) => fyOf(`${x.ym}-01`) === fy);
    w.file({ stream_id: "LN-INV2-STMT", download_date: fy >= 2027 ? "2027-04-05" : `${fy}-07-05`, name: `PING-LoanStatement-LN-INV2-FY${fy}.pdf`, bytes: loanStatementDoc(w, r, fy), family: "ping-loan-statement-pdf", container: "pdf", expect: { loan_statement: r.length }, origin: "portal", issued_on: monthEnd(r[r.length - 1].ym) });
  }
  // the loan's activity export is tab separated, charges negative, balance positive as the credit union shows what is owed
  for (const x of rows) {
    const last = monthEnd(x.ym), t = `Effective Date\tDetails\tAmount\tBalance Owing\r\n${dmy(last)}\tInterest charged\t${fix(-x.interest)}\t${fix(x.closing + x.interest)}\r\n${dmy(last)}\tInterest payment received\t${fix(x.repayments)}\t${fix(x.closing)}\r\n`;
    w.file({ stream_id: "LN-INV2", download_date: `${nextMonth(x.ym)}-03`, name: `PING-Loan-Activity-${x.ym}.tsv`, text: t, family: "ping-loan-tsv", container: "tsv", expect: { txn_line: 2, statement: 1 }, origin: "portal", issued_on: last });
  }
  w.file({ stream_id: "RATE-LN-INV2", download_date: "2025-09-20", name: "PING-Rate-Change-LN-INV2-2025-09.pdf", bytes: rateNoticeDoc(w, { rate: "6.14", effective_on: "2025-09-15", notified_on: "2025-09-20" }), family: "ping-rate-notice-pdf", container: "pdf", expect: { rate_notice: 1 }, origin: "portal", issued_on: "2025-09-20" });
  w.truth.rate_notices.push({ contract: "C-INV2", value: "6.14", effective_on: "2025-09-15", notified_on: "2025-09-20" });

  // rent, netted. Vacant from settlement until a tenant on 1 March 2024, a little over three months.
  const own = [];
  for (const ym of monthRange("2024-03", "2027-03")) {
    const rent = at(RENT, ym), fee = mulDiv(rent, FEE_BPS, 10000), rep = REPAIRS[ym] || null, repair = rep ? rep[1] : 0, net = rent - fee - repair, paid = `${nextMonth(ym)}-03`;
    const x = { ym, rent, fee, repair, repairName: rep ? rep[0] : "", net, paid };
    own.push(x);
    w.file({ stream_id: "OWN-RENTAL2", download_date: paid, name: `RentPurrfect-Owner-${ym}.pdf`, bytes: ownerDoc(w, x), family: "rentpurrfect-owner-pdf", container: "pdf", expect: { owner_statement: 1 }, origin: "portal", issued_on: monthEnd(ym) });
    if (paid <= w.END) w.line("ACC-RN2", paid, `GOLDPAWS REALTY DISB ${ym.slice(5)}${ym.slice(2, 4)}`, net);
  }
  w.truth.owner_statements.push(...own.map((x) => ({ property: "RENTAL2", month: x.ym, gross_rent_cents: x.rent, fees_cents: x.fee, repairs_cents: x.repair, disbursed_cents: x.net })));
  w.rental2 = { own, loanRows: rows };

  // the property's own bills, from the rental account
  const rng = w.rng("rental2");
  const bills = [];
  for (const ym of monthRange("2024-02", "2027-03")) {
    const mo = Number(ym.slice(5));
    if ([2, 5, 8, 11].includes(mo)) { const c = ym < "2025-07" ? 45500 : 47800; w.line("ACC-RN2", `${ym}-12`, "CITY OF BALLAPAW RATES", -c); bills.push({ kind: "rates", date: `${ym}-12`, cents: c }); }
    if ([1, 4, 7, 10].includes(mo)) { const c = 19000 + rng.int(-1800, 2600); w.line("ACC-RN2", `${ym}-19`, "HIGHLAND PAWS WATER", -c); bills.push({ kind: "water", date: `${ym}-19`, cents: c }); }
  }
  w.line("ACC-RN2", "2025-04-08", "TABBY ROOFING PTY LTD", -418000); bills.push({ kind: "repair", date: "2025-04-08", cents: 418000 });
  w.rental2.bills = bills;
  const periods = [["2023-11-15", "2024-11-14", 96800], ["2024-11-15", "2025-11-14", 104400], ["2025-11-15", "2026-11-14", 109900], ["2026-11-15", "2027-11-14", 114200]].map(([from, to, c]) => ({ from, to, premium: c / 100, paid_on: from, paid_from: "ACC-RN2", description: "PURRSURE LANDLORD POLICY" }));
  for (const p of periods) w.line("ACC-RN2", p.from, "PURRSURE LANDLORD POLICY", -toCents(p.premium));
  policyFiles(w, { id: "POL-RENTAL2", name: "Landlord insurance", property: "RENTAL2", address: ADDRESS, cover: { "Building sum insured": 310000, "Landlord contents": 12000, "Loss of rent": "52 weeks", "Legal liability": 20000000, "Excess": 500 } }, periods, "STM-POL-RENTAL2");
  w.truth.policies.push(...periods.map((x) => ({ contract: "POL-RENTAL2", period_start: x.from, period_end: x.to, premium_cents: toCents(x.premium) })));
  w.rental2.premiums = periods;

  // quantity surveyor's schedules. Geelong as the sheet's settings have it, pro rata in its first year.
  const geelong = [], ballarat = [];
  for (let fy = 2022; fy <= 2030; fy++) { const f = fy === 2022 ? 10 / 12 : 1; geelong.push({ fy, division: "43", item: "Capital works, construction", cents: Math.round(420000 * f) }, { fy, division: "40", item: "Plant and equipment", cents: Math.round(115000 * f) }); }
  for (let fy = 2024; fy <= 2030; fy++) { const f = fy === 2024 ? 228 / 365 : 1; ballarat.push({ fy, division: "43", item: "Capital works, 2011 extension", cents: Math.round(236000 * f) }); }
  w.schedules = { RENTAL: geelong, RENTAL2: ballarat };
  w.file({ stream_id: "QS-RENTAL", download_date: "2021-10-11", name: "QS-Schedule-Moorabool-Lane.xlsx", bytes: scheduleBook(w, "RENTAL", w.base.properties.RENTAL.address, "2021-10-11", geelong, "Tabby and Tom Quantity Surveyors"), family: "qs-schedule-xlsx", container: "xlsx", expect: { depreciation_schedule: 1 }, origin: "email", issued_on: "2021-10-11" });
  w.file({ stream_id: "QS-RENTAL2", download_date: "2024-02-05", name: "QS-Schedule-Lydiard-Cottage.xlsx", bytes: scheduleBook(w, "RENTAL2", ADDRESS, "2024-02-05", ballarat, "Tabby and Tom Quantity Surveyors"), family: "qs-schedule-xlsx", container: "xlsx", expect: { depreciation_schedule: 1 }, origin: "email", issued_on: "2024-02-05" });
}

function files(w) {
  const rows = (w.lines["ACC-RN2"] || []).slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.seq - b.seq));
  let bal = 0;
  for (const ym of monthRange("2023-11", "2027-03")) {
    const m = rows.filter((r) => r.date.startsWith(ym)), made = wattleCsv(m, bal); bal = made.closing;
    w.file({ stream_id: "ACC-RN2", download_date: `${nextMonth(ym)}-02`, name: `Transactions-${ym}.csv`, text: made.text, family: "wattle-txn-csv", container: "csv", expect: { txn_line: m.length, statement: m.length ? 1 : 0 }, origin: "portal", issued_on: monthEnd(ym) });
  }
  return rows;
}

module.exports = { run, files, LOAN_NO, ADDRESS };
