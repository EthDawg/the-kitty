/* Mia's old Wattle saver, before she moved everything to the joint accounts: OFX to the end of 2021, her casual agency shifts paid into it, and its
   closing balance swept to the broker's cash hub. Nothing here touches a sheeted account. */
"use strict";
const { money, aud, fmtDate, addDays, monthRange, monthEnd, fyOf, fyStart, fix, nextMonth, weekday } = require("../lib/util");
const { payslipDoc, incomeStatementDoc } = require("./payroll");
const { ofx } = require("../lib/bankfiles");
const { stream } = require("./setup");

const NUMBER = "813-220 44 1166 301", OPENING = 418025;
// the shifts, gross cents per month, chosen once so the year's return lands; never above the $450 a month that would bring super with it
const SHIFTS = { 2019: [["2019-04-11", 31200], ["2019-05-16", 28800], ["2019-06-13", 33600]],
  2020: [["2019-08-08", 38400], ["2019-09-12", 36000], ["2019-10-10", 40800], ["2019-11-14", 38400], ["2019-12-12", 43200], ["2020-01-16", 18000], ["2020-02-13", 36000], ["2020-03-12", 40800], ["2020-05-14", 38400], ["2020-06-11", 36000]],
  2021: [["2020-07-16", 40800], ["2020-08-13", 43200], ["2020-09-10", 40800], ["2020-10-15", 43200], ["2020-11-12", 44400], ["2021-01-14", 43200], ["2021-02-11", 42000], ["2021-03-11", 44400], ["2021-04-15", 43200], ["2021-05-13", 44400], ["2021-06-10", 42000]],
  2022: [["2021-08-12", 42000], ["2021-09-09", 40800], ["2021-10-14", 42000]],
  2023: [["2022-10-13", 46800], ["2022-11-10", 48000], ["2022-12-08", 46800], ["2023-01-12", 48000], ["2023-02-09", 46800], ["2023-03-09", 48000], ["2023-04-13", 46800], ["2023-05-11", 48000], ["2023-06-08", 46800]],
  2024: [["2023-07-13", 48000], ["2023-08-10", 46800], ["2023-09-14", 48000], ["2023-10-12", 46800], ["2023-11-09", 48000], ["2023-12-14", 46800], ["2024-01-11", 48000], ["2024-02-08", 46800], ["2024-03-14", 48000], ["2024-04-11", 46800], ["2024-05-09", 48000], ["2024-06-13", 46800]] };
const EMPLOYER = "Nightpaw Agency Nursing", PPL = "Services Pawstralia";
// Government paid parental leave: 18 weeks at the minimum wage, fortnightly from Ava's birth
const PPL_PAYS = [["2022-04-04", 154500], ["2022-04-18", 154500], ["2022-05-02", 154500], ["2022-05-16", 154500], ["2022-05-30", 154500], ["2022-06-13", 154500], ["2022-06-27", 154500], ["2022-07-11", 154500], ["2022-07-25", 154500]];

function run(w) {
  const S = w.setup;
  S.party.push({ party_id: "NIGHTPAW", kind: "organisation", name: EMPLOYER, note: "Casual shifts for Mia." }, { party_id: "SERVICESP", kind: "government", name: PPL, note: "Pays parental leave." });
  w.alias("party", "SERVICESP", "name", PPL);
  S.account.push({ account_id: "ACC-WAT", name: "Mia's old Wattle saver", class: "asset", type: "savings", reporting_group: "cash", currency: "AUD", institution_party_id: "WATTLE", opened_on: "2016-02-01", closed_on: "2021-12-20", liquid: true, in_scope: false, fidelity: "ledger", opening_balance_cents: OPENING, opening_date: "2019-03-01", note: "Not on the sheet. Closed into the broker's cash hub." });
  ["legal", "beneficial", "tax"].forEach((basis) => S.ownership.push({ subject_type: "account", subject_id: "ACC-WAT", party_id: "MIA", basis, share_bps: 10000, valid_from: "2016-02-01", valid_to: "2021-12-21", recorded_at: "2019-03-01T00:00:00Z" }));
  w.alias("account", "ACC-WAT", "account_number", NUMBER.replace(/\s/g, ""), "2016-02-01"); w.alias("party", "NIGHTPAW", "name", EMPLOYER);
  S.contract.push({ contract_id: "C-EMP-M2", kind: "employment", name: EMPLOYER, counterparty_party_id: "NIGHTPAW", holder_party_id: "MIA", category_id: "SALARY", started_on: "2019-04-01", ended_on: "2024-06-30" });
  S.contract.push({ contract_id: "C-PPL", kind: "employment", name: "Paid parental leave", counterparty_party_id: "SERVICESP", holder_party_id: "MIA", category_id: "SALARY", started_on: "2022-03-21", ended_on: "2022-07-25" });
  stream(w, "PAY-M2", "Mia's agency payslips", "payslip", "party", "MIA", "event", "2019-04-11", { issuer_party_id: "NIGHTPAW", valid_to: "2024-07-01" });
  stream(w, "IS-M2", "Mia's agency income statement", "income_statement", "party", "MIA", "yearly", "2018-07-01", { issuer_party_id: "NIGHTPAW", valid_to: "2024-08-01" });
  stream(w, "PAY-M3", "Paid parental leave statements", "payslip", "party", "MIA", "event", "2022-04-04", { issuer_party_id: "SERVICESP", valid_to: "2022-08-01" });
  stream(w, "IS-M3", "Paid parental leave income statement", "income_statement", "party", "MIA", "yearly", "2022-07-01", { issuer_party_id: "SERVICESP", valid_to: "2023-08-01" });
  stream(w, "ACC-WAT", "Mia's old Wattle saver", "transactions", "account", "ACC-WAT", "monthly", "2019-03-01", { issuer_party_id: "WATTLE", valid_to: "2022-01-01", grace_days: 10 });

  const pays = [];
  for (const [fy, list] of Object.entries(SHIFTS)) {
    const ytd = { gross: 0, tax: 0, sup: 0, net: 0 }, rows = [];
    for (const [date, gross] of list) {
      const y0 = Number(fy), sg = y0 >= 2024 ? 0.11 : y0 === 2023 ? 0.105 : 0; // the $450 a month floor went on 1 July 2022
      const tax = Math.round(gross * 0.1 / 100) * 100, p = { date, person: "Mia", employer: EMPLOYER, gross, tax, sup: Math.round(gross * sg), net: gross - tax };
      ytd.gross += gross; ytd.tax += tax; ytd.net += p.net; ytd.sup += p.sup; rows.push(p); pays.push(p);
      const saver = date < "2022-01-01", bytes = payslipDoc(w, p, { ...ytd }, saver ? "Wattle saver" : "Bark everyday", saver ? "6301" : "7731");
      w.file({ stream_id: "PAY-M2", download_date: date, name: `Pawroll-Payslip-Agency-${date}.pdf`, bytes, family: "pawroll-payslip-pdf", container: "pdf", expect: { payslip: 1 }, origin: "portal", issued_on: date });
      w.truth.payslips.push({ pay_date: date, person: "Mia", employer: EMPLOYER, gross_cents: gross, tax_cents: tax, super_cents: p.sup, net_cents: p.net, ytd_gross_cents: ytd.gross, ytd_tax_cents: ytd.tax, ytd_super_cents: ytd.sup, fy: Number(fy) });
      w.line(saver ? "ACC-WAT" : "ACC-OLD", date, "NIGHTPAW AGENCY PAY", p.net);
    }
    const y = Number(fy);
    w.file({ stream_id: "IS-M2", download_date: `${y}-07-14`, name: `Pawroll-IncomeStatement-Agency-FY${y}.pdf`, bytes: incomeStatementDoc(w, "Mia", EMPLOYER, rows, y), family: "pawroll-income-statement-pdf", container: "pdf", expect: { income_statement: 1 }, origin: "portal", issued_on: `${y}-07-14` });
    w.truth.income_statements.push({ person: "Mia", employer: EMPLOYER, fy: y, gross_cents: ytd.gross, tax_cents: ytd.tax, super_cents: ytd.sup, pays: rows.length, pays_held: rows.length });
  }
  // the government's paid parental leave, at the same label as a wage
  const byFy = {};
  for (const [date, gross] of PPL_PAYS) {
    const fy = fyOf(date), tax = 23200, p = { date, person: "Mia", employer: PPL, gross, tax, sup: 0, net: gross - tax }, y = byFy[fy] = byFy[fy] || { gross: 0, tax: 0, sup: 0, net: 0, rows: [] };
    y.gross += gross; y.tax += tax; y.net += p.net; y.rows.push(p); pays.push(p);
    w.file({ stream_id: "PAY-M3", download_date: date, name: `Paid-Parental-Leave-${date}.pdf`, bytes: payslipDoc(w, p, { gross: y.gross, tax: y.tax, sup: 0, net: y.net }, "Bark everyday", "7731"), family: "pawroll-payslip-pdf", container: "pdf", expect: { payslip: 1 }, origin: "portal", issued_on: date });
    w.truth.payslips.push({ pay_date: date, person: "Mia", employer: PPL, gross_cents: gross, tax_cents: tax, super_cents: 0, net_cents: p.net, ytd_gross_cents: y.gross, ytd_tax_cents: y.tax, ytd_super_cents: 0, fy });
    w.line("ACC-OLD", date, "SERVICES PAWSTRALIA PPL", p.net);
  }
  for (const [fy, y] of Object.entries(byFy)) {
    w.file({ stream_id: "IS-M3", download_date: `${fy}-07-14`, name: `Paid-Parental-Leave-IncomeStatement-FY${fy}.pdf`, bytes: incomeStatementDoc(w, "Mia", PPL, y.rows, Number(fy)), family: "pawroll-income-statement-pdf", container: "pdf", expect: { income_statement: 1 }, origin: "portal", issued_on: `${fy}-07-14` });
    w.truth.income_statements.push({ person: "Mia", employer: PPL, fy: Number(fy), gross_cents: y.gross, tax_cents: y.tax, super_cents: 0, pays: y.rows.length, pays_held: y.rows.length });
  }
  w.agencyPays = pays;

  // interest on the running balance, a low rate that falls with the cash rate, then the sweep out
  const rate = (ym) => (ym < "2020-01" ? 0.012 : ym < "2020-07" ? 0.008 : 0.004);
  let bal = OPENING; const byMonth = {};
  for (const ym of monthRange("2019-03", "2021-12")) {
    const shifts = pays.filter((p) => p.employer === EMPLOYER && p.date.startsWith(ym)), rows = [];
    for (const p of shifts) { bal += p.net; }
    if (ym === "2021-12") {
      const interest = Math.round(bal * rate(ym) / 12 * 20 / 31);
      w.line("ACC-WAT", "2021-12-20", "CREDIT INTEREST", interest); bal += interest;
      w.line("ACC-WAT", "2021-12-20", "TRANSFER TO CEDAR TRADE CASH HUB", -bal);
      w.line("ACC-BRK", "2021-12-21", "TRANSFER FROM WATTLE SAVER", bal, { ref: "TFR" });
      w.watSweep = bal; bal = 0;
    } else { const interest = Math.round(bal * rate(ym) / 12); w.line("ACC-WAT", monthEnd(ym), "CREDIT INTEREST", interest); bal += interest; }
    byMonth[ym] = rows;
  }
}

/* ACC-WAT's files, written once every line is in */
function files(w) {
  const rows = (w.lines["ACC-WAT"] || []).slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.seq - b.seq));
  let bal = OPENING;
  for (const ym of monthRange("2019-03", "2021-12")) {
    const m = rows.filter((r) => r.date.startsWith(ym));
    for (const r of m) bal += r.cents;
    const text = ofx({ account: NUMBER.replace(/\s/g, ""), bankId: "813220", from: `${ym}-01`, to: monthEnd(ym), rows: m, closing: bal });
    w.file({ stream_id: "ACC-WAT", download_date: `${nextMonth(ym)}-03`, name: `WattleCU-${ym}.ofx`, text, family: "wattle-ofx", container: "ofx", expect: { txn_line: m.length, statement: m.length ? 1 : 0 }, origin: "portal", issued_on: monthEnd(ym) });
  }
  return rows;
}

module.exports = { run, files, NUMBER, OPENING, SHIFTS };
