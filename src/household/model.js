/* The page reads a shape: m.tx, m.goals, m.entryById and the rest, which src/engine.js builds from a snapshot of a v2 sheet. This file writes that
   snapshot from the standard's ledger, so every tab, widget and drawer reads a household without changing, and one code path builds the shape.
   It restates what the standard states. No arithmetic on money of its own: cents become dollars, rows are filed under the names the page uses, and a
   stated row can be added to its neighbours in a group. What the standard does not state is left blank and named in UNSTATED, with the reason, so a page
   can say "not worked out yet" and a reader can see what stands between here and retiring src/engine.js. */
"use strict";
const Engine = require("../engine.js");
const { monthOf, fyOf } = require("../../standard/engine/util");
const { termAt } = require("../../standard/engine/temporal");

const dollars = (c) => (c == null ? null : c / 100);
const TYPE = { transaction: "Transaction", savings: "Savings", offset: "Offset", credit_card: "Credit card", loan: "Loan", super: "Super", smsf: "SMSF", brokerage: "Brokerage", holding: "Shares", ess_plan: "Shares", wallet: "Crypto", help_debt: "HELP debt", property: "Property", vehicle: "Vehicle", device: "Device" };
const CLASS = { cash: "Cash", property: "Property", super: "Super", shares: "Shares", crypto: "Crypto", vehicle: "Vehicle", device: "Device", loans: "Loans", tax: "Loans" };
const METHOD = { cash: "ledger", property: "appraisal", super: "statement", shares: "market", crypto: "market", vehicle: "estimate", device: "estimate", loans: "statement", tax: "statement" };
const FLOW = { income: "Income", expense: "Expense", transfer: "Transfer", pass_through: "Transfer", capital: "Transfer", suspense: "Expense" };
const KIND = { utility: "bill", childcare: "bill", membership: "subscription" };
const COLUMNS = { Housing: "housing", Essentials: "essentials", Lifestyle: "lifestyle", Property: "property", "Work and giving": "work_giving", Fees: "fees", Uncategorised: "uncategorised" };
const TRADES = new Set(["trade_buy", "trade_sell", "vest", "drp", "crypto_buy", "crypto_sell", "crypto_swap"]);

/* What the page would read and the standard does not state. Each line is a job for the data model session or a decision to drop the field from the page.
   The parity table quotes these words. */
const UNSTATED = {
  "goals.progress": "The Goals tab worked this out. The standard holds a goal's target and account, not its progress.",
  "goals.monthsLeft": "The Goals tab worked this out. No metric for it.",
  "goals.needPm": "The Goals tab worked this out. No metric for it.",
  "goals.savedPm": "The Goals tab worked this out. No metric for it.",
  "goals.status": "The Goals tab's word (on track, behind). The standard keeps active, met or dropped.",
  subs: "The Subscriptions tab works out usage, price rises and flags. The standard holds contracts, not that analysis.",
  savings: "The Savings Finder tab is the sheet's own estimate. No metric for it.",
  checks: "The Compliance Checks tab has its own vocabulary. The standard has laws and a review list instead.",
  budget: "The Budget tab's year-to-date pace. The standard states a variance by month.",
  "mortgage.scenarios": "The Mortgage Scenarios tab. The standard has no what-if yet.",
  "mortgage.extras": "The Mortgage Scenarios tab. The standard has no what-if yet.",
  "mortgage.repayment": "The sheet worked this out. No metric for it.",
  "mortgage.monthsLeft": "The sheet worked this out. No metric for it.",
  "mortgage.netPm": "The sheet worked this out. No metric for it.",
  "loans.monthsLeft": "The Loans tab worked this out. No metric for it.",
  "loans.repayment": "The Loans tab worked this out. No metric for it.",
  "contracts.next": "A next charge date. The standard holds cadence and price, not the next date.",
  "contracts.lastUsed": "A person kept this on the sheet. No table for it.",
  "tax": "The Tax Forecast tab's labels. The standard's tax items use ATO labels by person.",
  "metrics.cashflow.savings_rate.3m": "The standard states a rate by month, not over three.",
  "metrics.emergency.months_covered": "Needs essential spending, which the standard does not total.",
  "metrics.close.items_missing": "The standard says this in coverage and review, not as one number.",
  "metrics.savings.recurring_per_year": "From the Savings Finder tab.",
  "metrics.tax.refund_at_risk.prior_year": "From the Compliance Checks tab.",
  "metrics.tax.refund.corrected.prior_year": "From the Compliance Checks tab.",
};

const UNPLACED = { category_id: "UNPLACED", category: "Not placed yet", group: "Uncategorised", flow: "Transfer", monthly_budget: 0, essential: "", tax_treatment: "", ato_label: "" };
const first = (s) => String(s || "").trim().split(/\s+/)[0];

function peopleOf(L) {
  const adults = new Set((L.memberships || []).filter((m) => m.role === "adult" && !m.valid_to).map((m) => m.party_id));
  const names = new Map(L.parties.map((p) => [p.party_id, p.name]));
  const people = L.parties.filter((p) => p.kind === "person" && adults.has(p.party_id));
  return { names, people, solo: people.length === 1 ? first(people[0].name) : null };
}
function ownerOf(L, id, who) {
  const rows = (L.ownership || []).filter((o) => o.subject_id === id && !o.superseded_at && !o.valid_to), named = rows.filter((o) => o.basis === "beneficial"), held = named.length ? named : rows;
  const parties = [...new Set(held.map((o) => o.party_id))];
  if (parties.length === 1) return first(who.names.get(parties[0]));
  return who.solo || (parties.length ? "Joint" : "");
}
// What a property is for, from the term that says so. The Rental and Property widgets switch on it.
function purposeOf(L, a, asOf) {
  const asset = (L.assets || []).find((x) => x.account_id === a.account_id), use = asset && asOf ? termAt(L.termIdx, "asset", asset.asset_id, "use", asOf) : null;
  return use === "owner_occupied" ? "Home" : use ? "Investment" : "";
}
function eventsByLine(L) {
  const byObs = new Map(), out = new Map();
  for (const l of L.lines || []) for (const w of l.witnesses || []) byObs.set(w.obs_id, l);
  for (const e of L.events) {
    for (const l of [...(e.lines || []), ...(e.line ? [e.line] : [])]) out.set(l.key, e);
    for (const w of e.witnesses || []) { const l = byObs.get(w.obs_id); if (l && w.role !== "corroborates" && !out.has(l.key)) out.set(l.key, e); }
  }
  return out;
}
function entriesOf(L, who, asOf) {
  const events = eventsByLine(L), out = [];
  for (const l of L.lines || []) {
    if (l.date > asOf) continue;
    if ((L.index.accounts.get(l.account) || {}).reporting_group !== "cash") continue;   // the page's Activity is money moving on bank and card accounts
    const e = events.get(l.key) || {}, cls = l.cls || {}, other = (e.lines || []).find((x) => x.account !== l.account), said = e.person || cls.person;
    const person = said ? first(who.names.get(said) || said) : who.solo || "Joint";
    // Money in that nobody has explained is neither income nor a refund, and the ledger keeps it out of both until a person says. The page's sums must too.
    const category = e.unexplained ? UNPLACED.category_id : e.category_id || cls.category_id || "UNCAT";
    out.push({ entry_id: l.key, kind: "transaction", settled_at: l.date, account_id: l.account, raw_text: l.desc, description: e.merchant || cls.merchant || "", amount: dollars(l.cents), category_id: category, person, status: "settled", created_at: l.valueDate || l.date, transfer_id: other ? e.event_id : null, transfer_account: other ? other.account : null, foreign_amount: l.foreignAmount ?? null, foreign_currency: l.foreignCurrency ?? null, source: "bank export" });
  }
  for (const e of L.events) {
    if (!TRADES.has(e.kind) || e.occurred_on > asOf) continue;
    out.push({ entry_id: e.event_id, kind: "trade", settled_at: e.occurred_on, account_id: e.holding || (e.refs || {}).holding || (e.refs || {}).account, raw_text: e.description, description: e.description, amount: dollars(e.amount_cents), person: e.person ? first(who.names.get(e.person) || e.person) : who.solo || "", units: e.units ?? null, status: "settled", source: e.rule || "" });
  }
  // A value held on a date, for everything that is not a bank account. The balance is the engine's, restated on the month it changed.
  for (const a of L.accounts) {
    if (!METHOD[a.reporting_group] || METHOD[a.reporting_group] === "ledger") continue;
    let was = null;
    for (const r of L.balances.rows.filter((x) => x.account_id === a.account_id && x.month_end <= asOf)) {
      if (r.balance_cents !== was) out.push({ entry_id: `V|${a.account_id}|${r.month_end}`, kind: "valuation", settled_at: r.month_end, account_id: a.account_id, amount: dollars(r.balance_cents), status: "settled", source: METHOD[a.reporting_group] });
      was = r.balance_cents;
    }
  }
  return out;
}
function categoryRows(L, setup, asOf) {
  const budgets = new Map();
  for (const b of setup.budget || []) if (b.valid_from <= asOf && (!b.valid_to || b.valid_to > asOf) && !b.superseded_at) budgets.set(b.category_id, b);
  const labels = new Map((setup.tax_map || []).filter((t) => t.selector_type === "category").map((t) => [t.selector, t]));
  return [...L.categories.map((c) => {
    const b = budgets.get(c.category_id), t = labels.get(c.category_id);
    return { category_id: c.category_id, category: c.name, group: c.group || "Uncategorised", flow: FLOW[c.kind] || "Expense", monthly_budget: b ? dollars(b.cadence === "yearly" ? b.amount_cents / 12 : b.amount_cents) : 0, essential: c.essential ? "Yes" : "", tax_treatment: "", ato_label: t && t.label ? `Item ${t.label}` : "" };
  }), UNPLACED];
}
function cashRows(L, metric) {
  const group = new Map(L.categories.map((c) => [c.category_id, c.group || "Uncategorised"])), income = new Set(L.categories.filter((c) => c.kind === "income").map((c) => c.category_id));
  return L.cash.filter((m) => m.income || m.spending || m.unexplained || Object.keys(m.byCategory).length).map((m) => {
    const row = { month: `${m.month}-01`, income: dollars(m.income), spending: dollars(m.spending), net: dollars(m.net), savings_rate: metric("cash.savings_rate", m.month) };
    for (const col of Object.values(COLUMNS)) row[col] = 0;
    let salary = 0, rent = 0;
    for (const [id, v] of Object.entries(m.byCategory)) {
      if (id === "SALARY" || id === "INTEREST") salary += v;
      if (id === "RENT-INC") rent += v;
      const col = COLUMNS[group.get(id)];
      if (col && v < 0 || (col && !income.has(id))) row[col] -= dollars(v);
    }
    return Object.assign(row, { salary_interest: dollars(salary), rent: dollars(rent) });
  });
}
// A rate is held in percent and the page reads a share, and an enum is read as words.
const WORDS = { principal_and_interest: "Principal and interest", interest_only: "Interest only", fortnightly: "Fortnightly", weekly: "Weekly", monthly: "Monthly", quarterly: "Quarterly", annual: "Annual", yearly: "Annual" };
const termsOf = (L, asOf) => (id, name) => { const v = termAt(L.termIdx, "contract", id, name, asOf); return v == null ? null : name === "interest_rate" ? `${v}%` : WORDS[v] || v; };
function contractRows(L, who, asOf) {
  const term = termsOf(L, asOf);
  return (L.contracts || []).map((c) => ({ contract_id: c.contract_id, kind: KIND[c.kind] || c.kind, name: c.name, provider: who.names.get(c.counterparty_party_id) || c.name, owner: c.holder_party_id ? first(who.names.get(c.holder_party_id)) : who.solo || "Joint", account_id: c.account_id || null, category_id: c.category_id || null, cadence: term(c.contract_id, "cadence") || term(c.contract_id, "pay_cadence") || "", amount: dollars(term(c.contract_id, "price_cents") == null ? null : Number(term(c.contract_id, "price_cents"))), rate: term(c.contract_id, "interest_rate"), start_date: c.started_on || null, end_date: c.ended_on || null, status: c.ended_on && c.ended_on <= asOf ? "ended" : "active", note: c.note || null }));
}
function loanRows(L, who, asOf) {
  const term = termsOf(L, asOf), at = monthOf(asOf);
  return (L.contracts || []).filter((c) => c.kind === "loan" && c.account_id && !(c.ended_on && c.ended_on <= asOf)).map((c) => {
    const asset = (L.assets || []).find((a) => a.asset_id === c.asset_id), use = asset ? termAt(L.termIdx, "asset", asset.asset_id, "use", asOf) : null;
    const offset = (L.links || []).find((x) => x.relation === "offsets" && x.to_id === c.contract_id && !x.valid_to);
    return { loan_id: c.account_id, loan: c.name, lender: who.names.get(c.counterparty_party_id) || "", purpose: use === "owner_occupied" ? "Owner-occupied" : use ? "Investment" : "", repayment_type: term(c.contract_id, "repayment_type") || "", interest_rate: term(c.contract_id, "interest_rate"), loan_end_date: term(c.contract_id, "term_end"), offset_account: offset ? offset.from_id : "", balance_at_as_of_date: dollars(Math.abs(L.balances.at(c.account_id, at))) };
  });
}
function payCycle(L, asOf) {
  const job = asOf && (L.contracts || []).find((c) => c.kind === "employment" && !(c.ended_on && c.ended_on <= asOf)), v = job ? termAt(L.termIdx, "contract", job.contract_id, "pay_cadence", asOf) : null;
  return v ? [{ key: "pay_cycle", value: WORDS[v] || v }] : [];
}
function metricRows(L, asOf) {
  const m = monthOf(asOf), row = (rows, month) => rows.find((r) => r.month === month) || null, yearAgo = `${Number(m.slice(0, 4)) - 1}${m.slice(4)}`;
  const nw = row(L.netWorth, m), then = row(L.netWorth, yearAgo), cash = row(L.cash, m), out = [];
  const add = (metric_id, metric, value, unit, comparison_value, compared_with) => { if (value != null) out.push({ metric_id, metric, value, unit, period: m, comparison_value: comparison_value ?? null, compared_with: compared_with || "" }); };
  if (nw) { add("networth.total", "Net worth", dollars(nw.total), "AUD", then ? dollars(then.total) : null, "A year ago"); add("networth.cash", "Cash", dollars(nw.groups.cash || 0), "AUD", then ? dollars(then.groups.cash || 0) : null, "A year ago"); }
  if (cash) { add("cashflow.income.month", "Income, latest month", dollars(cash.income), "AUD"); add("cashflow.spending.month", "Spending, latest month", dollars(cash.spending), "AUD"); add("cashflow.net.month", "Net, latest month", dollars(cash.net), "AUD"); }
  const estimates = (fy) => ((L.tax && L.tax.estimates) || []).filter((e) => e.fy === fy);
  const refund = (fy) => { const e = estimates(fy); return e.length ? dollars(e.reduce((n, x) => n + (x.result_cents || 0), 0)) : null; };
  const now = fyOf(asOf), before = `FY${Number(now.slice(2)) - 1}`;
  add("tax.refund.prior_year", "Refund expected", refund(before), "AUD");
  add("tax.refund.current_year", "Refund projected", refund(now), "AUD");
  return out;
}
function payslipRows(view, asOf) {
  return view.observations.filter((o) => o.kind === "payslip" && (o.payload.pay_date || o.occurred_on) <= asOf).map((o) => ({ pay_date: o.payload.pay_date || o.occurred_on, person: first(o.payload.person_ref || o.subject_ref), employer: o.payload.employer_ref || "", gross_pay: dollars(o.payload.gross_cents), tax_withheld: dollars(o.payload.tax_cents), super: dollars(o.payload.super_cents), net_pay: dollars(o.payload.net_cents) }));
}
function decisionRows(view) {
  const VERB = { categorise: (d) => (d.value || {}).category_id, worth_it: (d) => (d.value || {}).answer, confirm: (d) => (d.value || {}).category_id || "", split: (d) => (d.value || {}).parts || "" };
  return (view.decisions || []).filter((d) => d.status === "accepted" && d.target_type === "line" && VERB[d.verb]).map((d) => ({ decision_id: d.decision_id, ref_kind: "entry", ref_id: d.target_ref, decision: d.verb, value: VERB[d.verb](d), by: d.by, at: String(d.at).slice(0, 10), note: d.reason || "" }));
}
function ruleRows(view) {
  return (view.rules || []).filter((r) => r.status !== "proposed").map((r) => ({ rule_id: r.rule_id, pattern: r.pattern, match: r.match, merchant: r.merchant || "", category_id: r.category_id || "", person: r.person || "", property: r.asset_id || "", source: r.provenance || "", note: r.note || "" }));
}

// The snapshot a v2 sheet would have given, as far as the standard states it. asOf: the day to read point-in-time rows at. The ledger's own by default.
function snapshotFromStandard(L, view, { asOf } = {}) {
  const at = asOf || L.asOf || (L.clock && L.clock.today), month = at ? monthOf(at) : null, hh = (L.households || [])[0] || {}, who = peopleOf(L), setup = view.setup;
  const stated = new Map();
  for (const r of L.metrics || []) stated.set(`${r.metric_id}|${r.grain}`, r.value);
  const metric = (id, grain) => { const v = stated.get(`${id}|${grain}`); return v === undefined ? null : Number(v); };
  const known = new Set(setup.account.map((a) => a.account_id));
  const accounts = L.accounts.filter((a) => known.has(a.account_id)).map((a) => {
    const open = L.events.find((e) => e.kind === "opening_balance" && (e.refs || {}).account === a.account_id), closed = a.closed_on && a.closed_on <= at;
    return { account_id: a.account_id, account: a.name, institution: who.names.get(a.institution_party_id) || "", type: TYPE[a.type] || a.type, owner: ownerOf(L, a.account_id, who), opening_balance: open ? dollars(open.amount_cents) : a.opening_balance_cents != null ? dollars(a.opening_balance_cents) : 0, opening_date: open ? open.occurred_on : a.opening_date || null, balance_at_as_of_date: dollars(L.balances.at(a.account_id, month)), liquid: a.liquid === true || a.reporting_group === "cash" ? "Yes" : "No", class: CLASS[a.reporting_group] || "Cash", valuation_method: METHOD[a.reporting_group] || "ledger", currency: a.currency || "AUD", status: closed ? "closed" : "active", purpose: purposeOf(L, a, at), linked_account: a.parent_account_id || null, note: a.note || null };
  });
  const money0 = (c) => dollars(c || 0);
  const snapshot = {
    household: hh.name || "This household", kitty: [{ key: "household_name", value: hh.name || "This household" }, { key: "people", value: who.people.map((p) => first(p.name)).join(", ") }, { key: "country", value: hh.jurisdiction || "AU" }, { key: "currency", value: hh.base_currency || "AUD" }, { key: "sheet_version", value: 2 }, ...payCycle(L, at)],
    settings: [...(at ? [{ setting: "As-of date", value: at }, { setting: "Current financial year", value: `FY${fyOf(at).slice(-2)}` }] : [])],
    accounts, category_list: categoryRows(L, setup, at || "9999-12-31"), entries: at ? entriesOf(L, who, at) : [], transactions: [],
    balances: L.balances.rows.filter((r) => known.has(r.account_id) && r.month_end <= (at ? `${month}-31` : "")).map((r) => { const a = L.index.accounts.get(r.account_id); return { month_end: r.month_end, account_id: r.account_id, balance: dollars(r.balance_cents), class: CLASS[a.reporting_group] || "Cash", method: METHOD[a.reporting_group] || "ledger", status: "active" }; }),
    contracts: at ? contractRows(L, who, at) : [], decisions: decisionRows(view), rules: ruleRows(view),
    goals: (setup.goal || []).map((g) => ({ goal: g.name, target_amount: dollars(g.target_cents), target_date: g.target_on || null, linked_account: g.account_id || null, balance_now: g.account_id && month ? dollars(L.balances.at(g.account_id, month)) : null, status: g.status === "met" ? "Reached" : "" })),
    subscriptions: [], loans: at ? loanRows(L, who, at) : [], assets: (L.assets || []).map((a) => ({ item_id: a.asset_id, item: a.name, class: a.kind.charAt(0).toUpperCase() + a.kind.slice(1), owner: ownerOf(L, a.account_id || a.asset_id, who) })),
    metrics: at ? metricRows(L, at) : [], compliance: [],
    networth: L.netWorth.filter((n) => !at || n.month <= month).map((n) => ({ month_end: n.month_end, cash: money0(n.groups.cash), property: money0(n.groups.property), super: money0(n.groups.super), shares: money0(n.groups.shares), vehicle: money0(n.groups.vehicle), loans: money0(n.groups.loans), net_worth: dollars(n.total) })),
    cashflow: cashRows(L, metric).filter((c) => !at || c.month.slice(0, 7) <= month), cashflow_categories: [], budget: [], savings: [], mortgage: [], mortgage_extra: [], mortgage_inputs: {},
    tax: [], payslips: at ? payslipRows(view, at) : [], fetchedAt: null,
  };
  const home = snapshot.loans.find((l) => l.purpose === "Owner-occupied");
  if (home) snapshot.mortgage_inputs = { "Loan balance ($)": home.balance_at_as_of_date, "Offset balance ($)": home.offset_account ? (accounts.find((a) => a.account_id === home.offset_account) || {}).balance_at_as_of_date ?? null : null, "Current interest rate": home.interest_rate };
  return snapshot;
}
/* The page's model for a household. E is the page's own engine, so the merchant dictionary and the money format are one; under Node it is the required one.
   built is what rebuildAt returns, or pass L and view. */
function modelFromStandard(L, view, { E = Engine, asOf } = {}) {
  const m = E.model(snapshotFromStandard(L, view, { asOf }));
  m.unstated = UNSTATED;
  m.reviewQueue = reviewFrom(L, m);
  return m;
}
/* The review queue the page draws, from the standard's own list, not from the sheet-era rules in E.review: the standard already asked its dictionary, and says what it
   could not place. Only lines the page can show go here. The rest of the list, open items and refused files, is what next.js speaks. */
function reviewFrom(L, m) {
  delete m.catById.UNPLACED;   // a name for what the ledger holds out, not an answer a person can pick
  m.cats = m.cats.filter((c) => c.id !== "UNPLACED");
  const items = [], counts = { uncategorised: 0, unresolved: 0, duplicate: 0, unpaired: 0, first_big: 0 };
  for (const r of L.review || []) {
    const e = r.kind === "uncategorised" ? m.entryById[r.ref] : null;   // an unexplained credit is asked as uncategorised too
    if (!e) continue;
    counts.uncategorised += 1;
    items.push({ id: e.id, entry: e, item_id: r.item_id, reasons: ["uncategorised"], dupOf: null, why: "needs a category" });
  }
  items.sort((a, b) => (a.entry.date < b.entry.date ? 1 : a.entry.date > b.entry.date ? -1 : 0));
  return { items, counts, byId: new Set(items.map((i) => i.id)), hasRule: () => false };
}
module.exports = { modelFromStandard, snapshotFromStandard, UNSTATED };
