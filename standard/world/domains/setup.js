/* What a person would tell you at onboarding: who and what exists. Domains add their own accounts, contracts and streams to these. Anything a
   document can tell (rate changes, premiums, salaries on a payslip) is left for the engine to materialise from observations. */
"use strict";
const { toCents, monthRange, monthEnd, fyStart, fyEnd, pad } = require("../lib/util");

const T0 = "2019-03-01T00:00:00Z";
const HOUSEHOLD = "H-DAVIES";

// a plumber on a rental account reads as a rental repair
const TWIN = { "HOME-MAINT": "RENT-REPAIR", "RATES-HOME": "RENT-RATES", "HOME-INS": "RENT-INS", UTILITIES: "RENT-RATES" };
const cat = (category_id, name, kind, group, essential, cash_lens, economic_lens, note) => ({ category_id, name, kind, group, essential, cash_lens, economic_lens, ...(note ? { note } : {}), ...(TWIN[category_id] ? { property_twin_id: TWIN[category_id] } : {}) });

const CATEGORIES = [
  cat("SALARY", "Salary and wages", "income", "Income", null, true, true),
  cat("SALARY-ALLOW", "Allowances", "income", "Income", null, true, true),
  cat("REIMBURSE", "Employer reimbursements", "income", "Income", null, true, false, "Comes back through payroll; never income for tax."),
  cat("SUPER-EMPLOYER", "Employer super", "income", "Super", null, false, true),
  cat("SUPER-SACRIFICE", "Salary sacrificed to super", "income", "Super", null, false, true),
  cat("PAYROLL-DED", "Post-tax payroll deductions", "expense", "Income", null, true, true),
  cat("INTEREST", "Interest earned", "income", "Income", null, true, true),
  cat("DIVIDEND", "Dividends and distributions", "income", "Income", null, true, true),
  cat("TRUST-DIST", "Trust distributions", "income", "Income", null, true, true),
  cat("ESS-INCOME", "Employee share scheme income", "income", "Income", null, false, true),
  cat("CRYPTO-INCOME", "Staking and crypto income", "income", "Income", null, false, true),
  cat("SUPER-EARN", "Super fund earnings", "income", "Super", null, false, true),
  cat("SUPER-FEES", "Super fund fees", "expense", "Super", null, false, true),
  cat("SUPER-INS", "Insurance inside super", "expense", "Super", null, false, true),
  cat("SUPER-TAX", "Contributions tax", "expense", "Super", null, false, true),
  cat("GIFT-IN", "Gifts and inheritances received", "income", "Income", null, true, false, "Not income for tax. A receipt that moves net worth."),
  cat("RENT-INC", "Rent received", "income", "Property", null, true, true),
  cat("MORTGAGE", "Home loan repayments", "expense", "Housing", true, true, false, "Cash lens only. The interest inside it is HOME-INT."),
  cat("HOME-INT", "Home loan interest", "expense", "Housing", true, false, true, "Economic lens only."),
  cat("RATES-HOME", "Council rates (home)", "expense", "Housing", true, true, true),
  cat("HOME-INS", "Home and contents insurance", "expense", "Housing", true, true, true),
  cat("HOME-MAINT", "Home maintenance", "expense", "Housing", false, true, true),
  cat("GROCERIES", "Groceries", "expense", "Essentials", true, true, true),
  cat("UTILITIES", "Energy and water", "expense", "Essentials", true, true, true),
  cat("TELCO", "Internet and mobile", "expense", "Essentials", true, true, true),
  cat("TRANSPORT", "Fuel and transport", "expense", "Essentials", true, true, true),
  cat("CAR", "Car costs", "expense", "Essentials", true, true, true),
  cat("HEALTH", "Health", "expense", "Essentials", true, true, true),
  cat("CHILDCARE", "Childcare", "expense", "Essentials", true, true, true),
  cat("DINING", "Dining and takeaway", "expense", "Lifestyle", false, true, true),
  cat("SUBS", "Subscriptions", "expense", "Lifestyle", false, true, true),
  cat("SHOPPING", "Shopping", "expense", "Lifestyle", false, true, true),
  cat("KIDS-ACT", "Kids activities", "expense", "Lifestyle", false, true, true),
  cat("HOLIDAYS", "Holidays and travel", "expense", "Lifestyle", false, true, true),
  cat("GIFTS", "Gifts", "expense", "Lifestyle", false, true, true),
  cat("PERSONAL", "Personal care", "expense", "Lifestyle", false, true, true),
  cat("RENT-INT", "Investment loan interest", "expense", "Property", null, true, true, "Interest-only loans: the bank line and the interest are the same dollars."),
  cat("RENT-MGMT", "Property management fees", "expense", "Property", null, true, true),
  cat("RENT-RATES", "Rental rates and water", "expense", "Property", null, true, true),
  cat("RENT-STRATA", "Strata levies", "expense", "Property", null, true, true),
  cat("RENT-INS", "Landlord insurance", "expense", "Property", null, true, true),
  cat("RENT-REPAIR", "Rental repairs", "expense", "Property", null, true, true),
  cat("RENT-OTHER", "Other rental costs", "expense", "Property", null, true, true),
  cat("WORK-EQUIP", "Work equipment", "expense", "Work and giving", null, true, true),
  cat("WORK-OTHER", "Work registrations and courses", "expense", "Work and giving", null, true, true),
  cat("DONATION", "Donations", "expense", "Work and giving", null, true, true),
  cat("FEES", "Bank fees and card interest", "expense", "Fees", false, true, true),
  cat("INCOME-TAX", "Income tax assessed", "expense", "Tax", null, false, true),
  cat("HELP-INDEX", "HELP indexation", "expense", "Tax", null, false, true),
  cat("TAX-REFUND", "Tax refunds and payments", "transfer", "Tax", null, false, false, "Money between the household and its tax position."),
  cat("TRANSFER", "Transfers between own accounts", "transfer", "Transfers", null, false, false),
  cat("CC-PAY", "Credit card payments", "transfer", "Transfers", null, false, false),
  cat("UNCAT", "Uncategorised", "suspense", "Uncategorised", null, true, true),
];

const party = (party_id, kind, name, extra) => ({ party_id, kind, name, ...(extra || {}) });
const org = (id, name, extra) => party(id, "organisation", name, extra);

function run(w) {
  const S = w.setup, sheet = w.sheet;
  S.household.push({ household_id: HOUSEHOLD, name: "Davies household (fictional)", jurisdiction: "AU", base_currency: "AUD", fy_start_month: 7, timezone: "Australia/Melbourne", standard_version: "household-standard/1" });
  S.party.push(
    party("JORDAN", "person", "Jordan Davies", { birth_date: "1985-06-12" }), party("MIA", "person", "Mia Davies", { birth_date: "1987-02-03" }), party("AVA", "person", "Ava Davies", { birth_date: "2022-03-20" }),
    org("NORTHWIND", "Northwind Logistics"), org("BAYVIEW", "Bayview Health"), org("HARBOUR", "Harbour Bank"), org("SOUTHERN", "Southern Card"), org("WATTLE", "Wattle Credit Union"), org("BARK", "Bark Bank"),
    org("BAYSIDE", "Bayside Property Mgmt"), org("PURRSURE", "Purrsure"), party("ATO", "government", "Australian Taxation Office", { note: "Reached through the parody portal myGuv." }));
  S.membership.push({ party_id: "JORDAN", role: "adult", valid_from: "2019-03-01" }, { party_id: "MIA", role: "adult", valid_from: "2019-03-01" }, { party_id: "AVA", role: "dependant", valid_from: "2022-03-20" });

  const acct = (a) => S.account.push({ currency: "AUD", in_scope: false, fidelity: "ledger", ...a });
  const bank = (id, name, type, inst, opened, opening, extra) => acct({ account_id: id, name, class: "asset", type, reporting_group: "cash", institution_party_id: inst, opened_on: opened, liquid: true, opening_balance_cents: opening, opening_date: opened, ...(extra || {}) });
  const b = Object.fromEntries(w.base.accounts.map((a) => [a.id, a]));
  bank("ACC-EVD", b["ACC-EVD"].name, "transaction", "HARBOUR", "2019-03-01", toCents(b["ACC-EVD"].opening_balance), { in_scope: true });
  bank("ACC-OFF", b["ACC-OFF"].name, "offset", "HARBOUR", "2019-03-15", toCents(b["ACC-OFF"].opening_balance), { in_scope: true });
  bank("ACC-SAV", b["ACC-SAV"].name, "savings", "WATTLE", "2022-02-14", 0, { in_scope: true });
  bank("ACC-HOL", b["ACC-HOL"].name, "savings", "WATTLE", "2025-05-01", 0, { in_scope: true });
  acct({ account_id: "ACC-CC", name: b["ACC-CC"].name, class: "liability", type: "credit_card", reporting_group: "cash", institution_party_id: "SOUTHERN", opened_on: "2020-06-01", liquid: true, in_scope: true, opening_balance_cents: 0, opening_date: "2020-06-01", note: "Sits in the cash group as the sheet has it." });
  bank("ACC-RNT", b["ACC-RNT"].name, "transaction", "HARBOUR", "2021-08-20", 0, { in_scope: true });
  bank("ACC-OLD", b["ACC-OLD"].name, "transaction", "BARK", "2012-09-03", toCents(b["ACC-OLD"].opening_balance), { opening_date: "2019-03-01", note: "Not on the sheet. New money that must not touch the sheet lands here." });
  const prop = (id, name, opened, asset) => acct({ account_id: id, name, class: "asset", type: "property", reporting_group: "property", opened_on: opened, asset_id: asset, in_scope: id !== "RENTAL2", fidelity: "ledger" });
  prop("HOME", "Family home, Brunswick", "2019-03-15", "HOME"); prop("RENTAL", "Investment townhouse, Geelong", "2021-08-20", "RENTAL");
  acct({ account_id: "CAR", name: "Family car", class: "asset", type: "vehicle", reporting_group: "vehicle", asset_id: "CAR", in_scope: true, opened_on: "2022-11-05" });
  const loan = (id, name, inst, opened, contract, scope) => acct({ account_id: id, name, class: "liability", type: "loan", reporting_group: "loans", institution_party_id: inst, contract_id: contract, opened_on: opened, in_scope: scope });
  loan("LN-HOME", "Home loan", "HARBOUR", "2019-03-15", "C-HOME", true); loan("LN-INV", "Investment loan", "HARBOUR", "2021-08-20", "C-INV", true);

  S.asset.push({ asset_id: "HOME", kind: "property", name: "Family home, Brunswick", account_id: "HOME", location: "22 Albion Crescent, Brunswick VIC 3056", acquired_on: "2019-03-15" },
    { asset_id: "RENTAL", kind: "property", name: "Investment townhouse, Geelong", account_id: "RENTAL", location: "7/41 Moorabool Lane, Geelong VIC 3220", acquired_on: "2021-08-20" },
    { asset_id: "CAR", kind: "vehicle", name: "Subaru Forester", account_id: "CAR", acquired_on: "2022-11-05" });
  S.activity.push({ activity_id: "ACT-RENTAL", kind: "rental", name: "Geelong townhouse", asset_id: "RENTAL", valid_from: "2021-08-20", note: "Owned 50/50." });

  const tenth = (subject_type, subject_id, party_id, share_bps, valid_from, valid_to, note) => ["legal", "beneficial", "tax"].forEach((basis) => S.ownership.push({ subject_type, subject_id, party_id, basis, share_bps, valid_from, ...(valid_to ? { valid_to } : {}), recorded_at: `${valid_from}T00:00:00Z`, ...(note ? { note } : {}) }));
  const joint = (type, id, from) => { tenth(type, id, "JORDAN", 5000, from); tenth(type, id, "MIA", 5000, from); };
  for (const id of ["ACC-EVD", "ACC-OFF", "ACC-HOL", "ACC-CC", "ACC-RNT", "LN-HOME", "LN-INV", "HOME", "RENTAL", "CAR"]) joint("account", id, S.account.find((a) => a.account_id === id).opened_on);
  joint("asset", "HOME", "2019-03-15"); joint("asset", "RENTAL", "2021-08-20"); joint("asset", "CAR", "2022-11-05");
  tenth("account", "ACC-OLD", "JORDAN", 10000, "2012-09-03");
  // the saver: joint until 1 July 2024, then interest is Mia's
  tenth("account", "ACC-SAV", "JORDAN", 5000, "2022-02-14", "2024-07-01"); tenth("account", "ACC-SAV", "MIA", 5000, "2022-02-14", "2024-07-01");
  tenth("account", "ACC-SAV", "MIA", 10000, "2024-07-01", null, "From 1 July 2024 the saver's interest is Mia's alone.");

  const con = (c) => S.contract.push(c);
  con({ contract_id: "C-HOME", kind: "loan", name: "Home loan", counterparty_party_id: "HARBOUR", account_id: "LN-HOME", asset_id: "HOME", category_id: "MORTGAGE", started_on: "2019-03-15" });
  con({ contract_id: "C-INV", kind: "loan", name: "Investment loan", counterparty_party_id: "HARBOUR", account_id: "LN-INV", asset_id: "RENTAL", category_id: "RENT-INT", started_on: "2021-08-20" });
  con({ contract_id: "C-EMP-J", kind: "employment", name: "Northwind Logistics", counterparty_party_id: "NORTHWIND", holder_party_id: "JORDAN", category_id: "SALARY", started_on: "2017-02-06" });
  con({ contract_id: "C-EMP-M", kind: "employment", name: "Bayview Health", counterparty_party_id: "BAYVIEW", holder_party_id: "MIA", category_id: "SALARY", started_on: "2015-01-19" });
  con({ contract_id: "C-LEASE", kind: "lease", name: "Lease, Geelong townhouse", counterparty_party_id: "BAYSIDE", asset_id: "RENTAL", category_id: "RENT-INC", started_on: "2021-09-01" });
  con({ contract_id: "POL-RENTAL", kind: "insurance", name: "Landlord insurance", counterparty_party_id: "PURRSURE", asset_id: "RENTAL", category_id: "RENT-INS", started_on: "2021-09-15" });
  con({ contract_id: "POL-HOME", kind: "insurance", name: "Home and contents insurance", counterparty_party_id: "PURRSURE", asset_id: "HOME", category_id: "HOME-INS", started_on: "2020-03-03" });
  con({ contract_id: "POL-CAR", kind: "insurance", name: "Comprehensive car insurance", counterparty_party_id: "PURRSURE", asset_id: "CAR", category_id: "CAR", started_on: "2019-08-14" });

  const lk = (relation, from_type, from_id, to_type, to_id, valid_from, share_bps, note) => S.link.push({ relation, from_type, from_id, to_type, to_id, ...(share_bps != null ? { share_bps } : {}), valid_from, recorded_at: `${valid_from}T00:00:00Z`, ...(note ? { note } : {}) });
  w.linkRow = lk;
  lk("funds_purpose", "contract", "C-HOME", "asset", "HOME", "2019-03-15", 10000); lk("secures", "contract", "C-HOME", "asset", "HOME", "2019-03-15");
  lk("funds_purpose", "contract", "C-INV", "asset", "RENTAL", "2021-08-20", 10000); lk("secures", "contract", "C-INV", "asset", "RENTAL", "2021-08-20");
  lk("serves", "account", "ACC-RNT", "asset", "RENTAL", "2021-08-20");
  lk("offsets", "account", "ACC-OFF", "contract", "C-HOME", "2019-03-15");
  lk("covers", "contract", "POL-RENTAL", "asset", "RENTAL", "2021-09-15"); lk("covers", "contract", "POL-HOME", "asset", "HOME", "2020-03-03"); lk("covers", "contract", "POL-CAR", "asset", "CAR", "2019-08-14");

  const t = (subject_type, subject_id, term, value, unit, valid_from, extra) => w.term({ subject_type, subject_id, term, value: String(value), unit, valid_from, ...(extra || {}) });
  w.termRow = t;
  t("asset", "HOME", "use", "owner_occupied", "enum", "2019-03-15"); t("asset", "RENTAL", "use", "rental", "enum", "2021-08-20");
  t("asset", "HOME", "main_residence", "true", "bool", "2019-03-15");
  t("contract", "C-HOME", "repayment_type", "principal_and_interest", "enum", "2019-03-15"); t("contract", "C-HOME", "term_end", "2050-12-31", "date", "2020-12-15");
  t("contract", "C-HOME", "interest_rate", "3.19", "pct", "2019-03-15", { note: "The rate at settlement. Every later change arrives as a notice." });
  t("contract", "C-INV", "repayment_type", "interest_only", "enum", "2021-08-20"); t("contract", "C-INV", "term_end", "2053-03-31", "date", "2021-08-20");
  t("contract", "C-INV", "interest_rate", "2.04", "pct", "2021-08-20", { note: "The rate at settlement. Every later change arrives as a notice." });
  t("contract", "C-EMP-J", "pay_cadence", "fortnightly", "enum", "2019-03-01"); t("contract", "C-EMP-M", "pay_cadence", "fortnightly", "enum", "2019-03-01");
  t("party", "JORDAN", "tax_resident", "true", "bool", "2019-03-01"); t("party", "MIA", "tax_resident", "true", "bool", "2019-03-01");

  const al = (subject_type, subject_id, scheme, value, valid_from, valid_to) => S.alias.push({ subject_type, subject_id, scheme, value, valid_from: valid_from || "2012-01-01", ...(valid_to ? { valid_to } : {}) });
  w.alias = al;
  for (const a of w.base.accounts) if (/^\d/.test(a.number)) al("account", a.id, "account_number", a.number, a.opened);
  al("account", "ACC-CC", "card_last4", "41007", "2020-06-01");
  for (const id of ["ACC-SAV", "ACC-HOL", "ACC-OLD"]) al("account", id, "name", id, "2012-01-01");
  for (const id of ["LN-HOME", "LN-INV"]) { al("account", id, "loan_number", w.base.loans[id].number, w.base.loans[id].opened); al("contract", id === "LN-HOME" ? "C-HOME" : "C-INV", "loan_number", w.base.loans[id].number, w.base.loans[id].opened); }
  al("party", "JORDAN", "name", "Jordan Davies"); al("party", "MIA", "name", "Mia Davies"); al("party", "AVA", "name", "Ava Davies");
  al("party", "NORTHWIND", "name", "Northwind Logistics"); al("party", "BAYVIEW", "name", "Bayview Health");

  S.category.push(...CATEGORIES);

  // periods from 2019-03: months, quarters, financial years
  for (const ym of monthRange("2019-03", "2027-03")) S.period.push({ period_id: ym, kind: "month", start_on: `${ym}-01`, end_on: monthEnd(ym), status: "open" });
  for (let fy = 2019; fy <= 2027; fy++) {
    S.period.push({ period_id: `FY${fy}`, kind: "fy", start_on: fyStart(fy), end_on: fyEnd(fy), status: "open" });
    [["Q1", 7, fy - 1], ["Q2", 10, fy - 1], ["Q3", 1, fy], ["Q4", 4, fy]].forEach(([q, m, y]) => S.period.push({ period_id: `FY${fy}${q}`, kind: "quarter", start_on: `${y}-${pad(m)}-01`, end_on: monthEnd(`${y}-${pad(m + 2)}`), status: "open" }));
  }

  // plans, as the sheet holds them
  for (const c of sheet.category_list) if (c.monthly_budget) S.budget.push({ category_id: c.category_id, amount_cents: toCents(c.monthly_budget), cadence: "monthly", valid_from: "2025-07-01" });
  sheet.goals.forEach((g, i) => S.goal.push({ goal_id: `G${i + 1}`, name: g.goal, target_cents: toCents(g.target_amount), target_on: g.target_date, account_id: g.linked_account, status: "active" }));
  S.reservation.push({ reservation_id: "RES-OFFSET", account_id: "ACC-OFF", goal_id: "G3", kind: "floor", requested_cents: 1200000, applied_cents: 1200000, valid_from: "2025-07-01", note: "The offset never dips below this after a lump sum." });
  S.scenario.push({ scenario_id: "SCN-BASE", name: "As things stand", base_on: "2027-01-31" }, { scenario_id: "SCN-RATE-UP", name: "Rates up a quarter point", base_on: "2027-01-31" });
  S.assumption.push({ scenario_id: "SCN-RATE-UP", key: "interest_rate_step_pct", value: "0.25", valid_from: "2027-02-01" });
  sheet.contracts.filter((c) => c.kind === "subscription").forEach((c) => {
    const id = c.contract_id;
    con({ contract_id: id, kind: "subscription", name: c.name, category_id: c.category_id, holder_party_id: c.owner === "Jordan" ? "JORDAN" : c.owner === "Mia" ? "MIA" : undefined, note: c.provider });
    t("contract", id, "price_cents", toCents(c.amount), "cents", "2025-07-01"); t("contract", id, "cadence", c.cadence === "Annual" ? "yearly" : "monthly", "enum", "2025-07-01");
  });
}

function stream(w, stream_id, name, doc_kind, subject_type, subject_id, cadence, valid_from, extra) {
  if (w.setup.stream.some((s) => s.stream_id === stream_id)) return;
  w.setup.stream.push({ stream_id, name, doc_kind, subject_type, subject_id, cadence, valid_from, ...(extra || {}) });
}

module.exports = { run, stream, T0, HOUSEHOLD, CATEGORIES };
