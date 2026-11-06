/* The last step: bank files for the accounts every domain can add lines to, the truth totals, the sheet's oracles copied as they are, and the
   few answers only a person holds. */
"use strict";
const { toCents, monthEnd, monthRange, nextMonth } = require("../lib/util");
const { barkCsv } = require("./banks");
const { qif } = require("../lib/bankfiles");
const { stream } = require("./setup");
const agency = require("./agency"), broker = require("./broker"), rental2 = require("./rental2");

// month totals per account: what any correct reading of the files must add up to
function monthTotals(rows, opening) {
  const out = {}; let bal = opening;
  const sorted = rows.slice();
  for (const r of sorted) { const m = r.date.slice(0, 7), x = out[m] = out[m] || { count: 0, sum_cents: 0, closing_cents: 0 }; x.count += 1; x.sum_cents += r.cents; bal += r.cents; x.closing_cents = bal; }
  return out;
}

function run(w) {
  const lines = w.baseLines, truth = {};
  require("./banks").cardStatements(w);
  stream(w, "ACC-CC-STMT", "Card statement", "statement", "account", "ACC-CC", "monthly", "2020-06-14", { issuer_party_id: "SOUTHERN", grace_days: 10 });
  // ACC-OLD: base lines plus anything the domains added, in date order, base lines first within a day
  const extra = (w.lines["ACC-OLD"] || []);
  const old = [...lines["ACC-OLD"].map((r, i) => ({ ...r, seq: i })), ...extra.map((r, i) => ({ ...r, seq: 100000 + i }))].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.seq - b.seq));
  let bal = w.openings["ACC-OLD"];
  stream(w, "ACC-OLD", "Jordan's old everyday, Bark Bank", "transactions", "account", "ACC-OLD", "monthly", "2019-03-01", { issuer_party_id: "BARK", grace_days: 10 });
  for (const ym of monthRange("2019-03", "2027-03")) {
    const rows = old.filter((r) => r.date.startsWith(ym)), made = barkCsv(rows, bal);
    if (ym <= "2020-06") w.file({ stream_id: "ACC-OLD", download_date: `${nextMonth(ym)}-02`, name: `CommBark-${ym}.qif`, text: qif({ rows, opening: bal, from: `${ym}-01` }), family: "bark-qif", container: "qif", expect: { txn_line: rows.length, ...(rows.length ? { statement: 1 } : {}) }, origin: "portal", issued_on: monthEnd(ym) });
    else w.file({ stream_id: "ACC-OLD", download_date: `${nextMonth(ym)}-02`, name: "CSVData.csv", text: made.text, family: "bark-noheader-csv", container: "csv", expect: { txn_line: rows.length, ...(rows.length ? { statement: 1 } : {}) }, origin: "portal", issued_on: monthEnd(ym) });
    bal = made.closing;
  }
  const hub = broker.files(w).flatMap((m) => m.rows), rn2 = rental2.files(w), wat = agency.files(w);
  truth["ACC-BRK"] = monthTotals(hub, 0); truth["ACC-RN2"] = monthTotals(rn2, 0); truth["ACC-WAT"] = monthTotals(wat, agency.OPENING);
  for (const a of Object.keys(lines)) truth[a] = monthTotals(a === "ACC-OLD" ? old : lines[a], w.openings[a]);
  for (const a of ["LN-HOME", "LN-INV", "LN-INV2"]) {
    const x = {}; for (const r of w.truth.loans[a]) { const n = (r.interest_cents ? 1 : 0) + (r.repayments_cents ? 1 : 0); if (n) x[r.month] = { count: n, sum_cents: r.repayments_cents - r.interest_cents, closing_cents: -r.closing_cents }; }
    truth[a] = x;
  }
  w.truth.txn_by_month = truth;

  // streams for the base files
  const issuers = { "ACC-EVD": "HARBOUR", "ACC-OFF": "HARBOUR", "ACC-RNT": "HARBOUR", "ACC-SAV": "WATTLE", "ACC-HOL": "WATTLE", "ACC-CC": "SOUTHERN" };
  const from = { "ACC-EVD": "2019-03-01", "ACC-OFF": "2019-03-15", "ACC-RNT": "2021-08-20", "ACC-SAV": "2022-02-14", "ACC-HOL": "2025-05-01", "ACC-CC": "2020-06-01" };
  for (const [a, inst] of Object.entries(issuers)) stream(w, a, `${a} monthly export`, "transactions", "account", a, "monthly", from[a], { issuer_party_id: inst, grace_days: 10 });
  stream(w, "PAY-J", "Jordan's payslips", "payslip", "party", "JORDAN", "fortnightly", "2019-03-07", { issuer_party_id: "NORTHWIND", grace_days: 3 });
  stream(w, "PAY-M", "Mia's payslips", "payslip", "party", "MIA", "fortnightly", "2019-03-14", { issuer_party_id: "BAYVIEW", grace_days: 3 });
  stream(w, "IS-J", "Jordan's income statement", "income_statement", "party", "JORDAN", "yearly", "2018-07-01", { issuer_party_id: "NORTHWIND", grace_days: 21 });
  stream(w, "IS-M", "Mia's income statement", "income_statement", "party", "MIA", "yearly", "2018-07-01", { issuer_party_id: "BAYVIEW", grace_days: 21 });
  for (const id of ["LN-HOME", "LN-INV"]) {
    stream(w, id, `${id} ledger export`, "transactions", "account", id, "monthly", w.base.loans[id].opened, { issuer_party_id: "HARBOUR", grace_days: 10 });
    stream(w, `${id}-STMT`, `${id} statement`, "loan_statement", "account", id, "yearly", w.base.loans[id].opened, { issuer_party_id: "HARBOUR", grace_days: 21 });
  }
  const used = new Set(w.files.map((f) => f.stream_id)), known = new Set(w.setup.stream.map((s) => s.stream_id));
  for (const s of used) if (!known.has(s)) throw new Error(`no stream row for ${s}`);

  // the sheet's own view figures: oracles from Google Sheets formulas, copied as they are, never recomputed
  w.truth.sheet_oracle = { _about: "Copied unchanged from data/snapshot-v2.json. Google Sheets formulas computed these; nothing in this repo did.", balances: w.sheet.balances, networth: w.sheet.networth, cashflow: w.sheet.cashflow, valuations: w.sheet.valuations };

  // the answers no document can give
  const d = (id, ref, verb, value, reason) => w.decisions.push({ decision_id: id, target_type: "line", target_ref: ref, verb, value, by: "Mia", at: "2027-02-02T09:00:00Z", status: "accepted", reason });
  d("D-PERSON-01", "ACC-CC|2026-09-03|-7995", "categorise", { category_id: "WORK-EQUIP", merchant: "Digital River", person: "Jordan" }, "Software licence Jordan bought for work through a reseller.");
  d("D-PERSON-02", "ACC-EVD|2026-10-12|15000", "categorise", { category_id: "GIFTS", merchant: "D Lee", event_kind: "refund" }, "Dan Lee paying back his share of a birthday present.");
  d("D-PERSON-03", "ACC-CC|2026-10-21|-3850", "categorise", { category_id: "DINING", merchant: "Market Lane" }, "Coffee and pastries at the market.");
  d("D-PERSON-04", "ACC-EVD|2022-11-05|950000", "set_event_kind", { event_kind: "asset_disposal", asset_id: "MAZDA" }, "Cash from selling the 2012 Mazda 3 to a neighbour. No document exists.");
  d("D-PERSON-05", "ACC-BRK|2020-06-22|29000000", "categorise", { category_id: "GIFT-IN", event_kind: "gift_in" }, "An inheritance from Jordan's aunt, paid straight to the cash hub. Not income.");
  const accept = (id, ref, reason, reopen_if) => w.decisions.push({ decision_id: id, target_type: "check", target_ref: ref, verb: "accept", value: {}, by: "Mia", at: "2027-02-02T09:00:00Z", status: "accepted", reason, reopen_if });
  accept("D-PERSON-06", "L6|C-HOME", "The fictional lender computes interest monthly", "interest gap above 20%");
  accept("D-PERSON-07", "L6|C-INV", "The fictional lender computes interest monthly", "interest gap above 20%");
  w.rules = w.sheet.rules.map((r) => ({ rule_id: r.rule_id, pattern: r.pattern, match: r.match, ...(r.merchant ? { merchant: r.merchant } : {}), ...(r.category_id ? { category_id: r.category_id } : {}), ...(r.person ? { person: r.person } : {}), provenance: r.source || "sheet", status: "accepted" }));
  // the new strings the household's own rules cover; the first two override the dictionary
  const rule = (rule_id, pattern, merchant, category_id, note) => w.rules.push({ rule_id, pattern, match: "contains", merchant, category_id, provenance: "household", status: "accepted", ...(note ? { note } : {}) });
  rule("R-WORLD-01", "CENTRAL HIGHLANDS WATER", "Central Highland Paws Water", "RENT-RATES");
  rule("R-WORLD-02", "HARBOUR BANK INVESTMENT LOAN ESTABLISHMENT", "Harbour Bank", "FEES", "A borrowing cost, kept as a fee. Tax does not amortise it here.");
  rule("R-WORLD-03", "GOOD PAWS APPLIANCES", "Good Paws Appliances", "SHOPPING");
  rule("R-WORLD-04", "HARVEY WHISKERS", "Harvey Whiskers", "SHOPPING");
  rule("R-WORLD-05", "APPURR STORE", "Appurr Store", "SHOPPING", "The work share is the laptop's work_use_pct, not this line.");
  rule("R-WORLD-06", "CITY OF BALLARAT RATES", "City of Ballapaw", "RENT-RATES");
  rule("R-WORLD-07", "PURRSURE LANDLORD POLICY", "Purrsure", "RENT-INS");
  rule("R-WORLD-08", "BALLARAT ROOFING", "Ballarat Roofing", "RENT-REPAIR");
}

module.exports = { run };
