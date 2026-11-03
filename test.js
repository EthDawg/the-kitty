// node --test kitty/test.js — the sheet is the oracle: every derived number must agree with a tab the sheet already computes.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const E = require("./src/engine.js");
// Pinned behaviour runs on a frozen month (fixtures/snapshot-2026-11.json). The invariants below also run on the
// live snapshot (data/snapshot.json), which moves forward with every month-end close.
const snap = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "snapshot-2026-11.json"), "utf8"));
const live = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "snapshot.json"), "utf8"));
const m = E.model(snap);
const near = (a, b, tol = 1) => assert.ok(Math.abs(a - b) < tol, `${a} vs ${b}`);

for (const [name, sn] of [["fixture 2026-11", snap], ["live snapshot", live]]) {
  const mm = E.model(sn);
  test(`invariants on the ${name} (as of ${mm.asOf}): transactions add up to the Cash Flow tab, accounts to the Cash metric, IDs unique`, () => {
    assert.ok(mm.tx.length > 800 && mm.cashflow.length >= 16, "enough rows to mean anything");
    for (const c of mm.cashflow) { const s = E.spend(mm.tx, E.window("month", c.month)); near(s.out, c.spending, 1); near(s.in, c.income, 1); }
    assert.ok(E.reconcile(mm).every((r) => r.ok), JSON.stringify(E.reconcile(mm)));
    assert.ok(mm.tx.every((t) => t.date <= mm.asOf), "no rows after the as-of date");
    assert.ok(mm.goals.length >= 3 && mm.goals.every((g) => g.target > 0 && g.date), "goals are whole");
    const nd = E.needs(mm); assert.ok(["On track.", "Mostly on track.", "Worth a look."].includes(nd.verdict));
    const up = E.upcoming(mm); assert.ok(up.length > 3 && up.every((u, i) => i === 0 || up[i - 1].date <= u.date), "upcoming is sorted and populated");
    assert.ok(E.payday(mm).every((p) => p.next > mm.asOf), "pay days are ahead of the as-of date");
    assert.ok(E.sinceLastPay(mm) && E.sinceLastPay(mm).days >= 1 && E.sinceLastPay(mm).days <= 16, "since-last-pay is within a fortnight");
  });
}

test("parsers read connector display strings and typed values alike", () => {
  assert.equal(E.num("($2,850.00)"), -2850);
  assert.equal(E.num("$4,530.47"), 4530.47);
  assert.equal(E.num("-"), null);
  assert.equal(E.num("n/a"), null);
  assert.equal(E.num("Never used"), null);
  assert.equal(E.num(1234.5), 1234.5);
  assert.equal(E.pct("85.0%"), 0.85);
  assert.equal(E.pct("(0.8%)"), -0.008);
  assert.equal(E.pct(0.194), 0.194);
  assert.equal(E.date("30/11/2026"), "2026-11-30");
  assert.equal(E.date(46356), "2026-11-30");
  assert.equal(E.date("2026-11-30"), "2026-11-30");
  assert.equal(E.month("Aug 25"), "2025-08-01");
  assert.equal(E.month("Nov 2026"), "2026-11-01");
  assert.equal(E.addMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(E.monthEnd("2026-02-10"), "2026-02-28");
});

test("model: the household, its clock and its rows", () => {
  assert.equal(m.asOf, "2026-11-30");
  assert.equal(m.householdName, "The Davies");
  assert.deepEqual(m.people, ["Jordan", "Mia"]);
  assert.equal(m.tx.length, 825);
  assert.equal(m.tx[0].date, "2026-11-30", "newest first");
  assert.equal(m.accounts.length, 6);
  assert.equal(m.goals.length, 3);
  assert.equal(m.subs.length, 17);
  assert.equal(m.cats.length, 34);
  assert.ok(m.metrics["networth.total"].num > 1.4e6);
  assert.equal(m.metrics["cashflow.savings_rate.3m"].num.toFixed(3), "0.194");
  assert.equal(m.metrics["spending.fastest_growing.3m"].text, "Shopping");
});

test("oracle: movers rank Shopping first with the sheet's growth figure", () => {
  const mv = E.movers(m);
  assert.equal(mv.fastest.name, "Shopping");
  near(mv.fastest.pct, 2.289, 0.02);
  assert.ok(mv[0].diff > 0 && mv[mv.length - 1].diff < 0, "increases first, decreases last");
});

test("verdict: the planted findings make it 'Worth a look.' with warnings first", () => {
  const nd = E.needs(m);
  assert.equal(nd.verdict, "Worth a look.");
  assert.ok(nd.items[0].warn);
  assert.ok(nd.all.some((i) => /doubled/.test(i.t)));
  assert.ok(nd.all.some((i) => /Paramount\+ is still charging/.test(i.t)));
  assert.ok(nd.all.some((i) => /tax claim/.test(i.t)));
  assert.ok(nd.all.some((i) => /Emergency fund is behind/.test(i.t)));
  assert.equal(nd.items.length, 4);
});

test("upcoming: next charges roll forward from the last charge; pay day from the last payslip", () => {
  const up = E.upcoming(m, 35);
  const netflix = up.find((u) => u.title === "Netflix");
  assert.equal(netflix.date, "2026-12-04");
  const loan = up.find((u) => /Home loan/.test(u.title));
  assert.equal(loan.date, "2026-12-01");
  const pay = E.payday(m);
  assert.equal(pay.length, 2);
  assert.ok(pay.every((p) => p.next > m.asOf && p.days > 0 && p.days <= 14));
  assert.ok(up.every((u, i) => i === 0 || up[i - 1].date <= u.date), "sorted");
});

test("goals: eta at current pace, and with extra", () => {
  const japan = m.goals.find((g) => /Japan/.test(g.name));
  const eta = E.goalEta(japan, 0, m.asOf);
  assert.equal(eta.months, 2);
  assert.equal(eta.late, false);
  const ef = m.goals.find((g) => /Emergency/.test(g.name));
  assert.ok(E.goalEta(ef, 0, m.asOf).late);
  assert.ok(E.goalEta(ef, 3800, m.asOf).months <= 1);
});

test("leaks and safety net", () => {
  const lk = E.leaks(m);
  assert.deepEqual(lk.stillCharging.map((s) => s.service), ["Paramount+"]);
  assert.equal(lk.unused.length, 3);
  const sf = E.safety(m);
  assert.equal(sf.target, 6);
  near(sf.months, 3.3, 0.06);
  assert.ok(sf.short > 0);
});

test("search understands people, months, amounts and categories", () => {
  assert.ok(E.match(m, "woolworths").length > 10);
  assert.ok(E.match(m, "mia dining").every((t) => t.person === "Mia" && t.cat === "DINING"));
  assert.ok(E.match(m, ">1000 october").every((t) => Math.abs(t.amount) >= 1000 && t.date.startsWith("2026-10")));
  assert.ok(E.match(m, "cat:subs").every((t) => t.cat === "SUBS"));
});

test("connector grids (display strings) produce the same model as the snapshot", () => {
  const money = (n) => (n == null ? "" : n < 0 ? `($${Math.abs(n).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})` : `$${n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  const dmy = (s) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : "");
  const g = {};
  const grid = (rows, head, cols) => [head.map((h) => h[0])].concat(rows.map((r) => cols.map((c, i) => (typeof c === "function" ? c(r) : r[c] == null ? "" : r[c]))));
  g.transactions = [["", ""], ["Txn ID", "Date", "Account ID", "Bank description", "Merchant", "Amount", "Category ID", "Person", "Receipt held", "Note"]].slice(1).concat(snap.transactions.map((t) => [t.txn_id, dmy(t.date), t.account_id, t.bank_description, t.merchant, money(t.amount), t.category_id, t.person, t.receipt_held || "", t.note || ""]));
  g.accounts = [["Account ID", "Account", "Institution", "Type", "Owner", "Opening balance ($)", "Opening date", "Balance at as-of date ($)", "Liquid"]].concat(snap.accounts.map((a) => [a.account_id, a.account, a.institution, a.type, a.owner, money(a.opening_balance), dmy(a.opening_date), money(a.balance_at_as_of_date), a.liquid]));
  g.category_list = [["Category ID", "Category", "Group", "Flow", "Monthly budget ($)", "Essential", "Tax treatment", "ATO label"]].concat(snap.category_list.map((c) => [c.category_id, c.category, c.group, c.flow, c.monthly_budget ? money(c.monthly_budget) : "-", c.essential || "", c.tax_treatment || "", c.ato_label || ""]));
  g.settings = [["Settings and assumptions"], ["Blue values are inputs."], [], ["Setting", "Value", "Note"]].concat(snap.settings.map((s) => [s.setting, /^\d{4}-\d{2}-\d{2}$/.test(String(s.value)) ? dmy(s.value) : s.value == null ? "" : s.value, s.note || ""]));
  g.goals = [["Goal", "Target amount ($)", "Target date", "Linked account", "Balance now ($)", "Progress", "Months left", "Needed per month ($)", "Saved per month, last 3 months ($)", "Status"]].concat(snap.goals.map((x) => [x.goal, money(x.target_amount), dmy(x.target_date), x.linked_account, money(x.balance_now), `${(x.progress * 100).toFixed(1)}%`, String(x.months_left), money(x.needed_per_month), money(x.saved_per_month_last_3_months), x.status]));
  g.metrics = [["Headline metrics"], ["One row per metric."], [], ["Metric ID", "Metric", "Value", "Unit", "Period", "Comparison value", "Compared with", "Better when"]].concat(snap.metrics.map((x) => [x.metric_id, x.metric, x.unit === "Percent" ? `${(x.value * 100).toFixed(1)}%` : x.unit === "AUD" || /AUD/.test(x.unit) ? money(x.value) : String(x.value), x.unit, x.period, x.comparison_value == null ? "" : x.unit === "Percent" && typeof x.comparison_value === "number" ? `${(x.comparison_value * 100).toFixed(1)}%` : typeof x.comparison_value === "number" && /AUD/.test(x.unit) ? money(x.comparison_value) : String(x.comparison_value), x.compared_with || "", x.better_when || ""]));
  g.cashflow = [["Monthly cash flow"], ["Money in and out by month."], [], ["Month"].concat(snap.cashflow.map((c) => E.fmtMonth(c.month, true))).concat(["Average, last 3 months", "Same 3 months last year"])]
    .concat([["Total income"].concat(snap.cashflow.map((c) => money(c.income))), ["Total spending"].concat(snap.cashflow.map((c) => money(c.spending))), ["Net cash flow"].concat(snap.cashflow.map((c) => money(c.net))), ["Savings rate"].concat(snap.cashflow.map((c) => `${(c.savings_rate * 100).toFixed(1)}%`)), [], ["Spending by category"]].concat(snap.cashflow_categories.map((c) => [c.category].concat(c.months.map(money)))));
  const s2 = E.fromConnector(g);
  const m2 = E.model({ ...snap, ...s2, kitty: snap.kitty, subscriptions: snap.subscriptions, loans: snap.loans });
  assert.equal(m2.asOf, m.asOf);
  assert.equal(m2.tx.length, m.tx.length);
  near(m2.accounts[1].balance, m.accounts[1].balance, 0.01);
  near(m2.metrics["networth.total"].num, m.metrics["networth.total"].num, 1);
  near(m2.metrics["cashflow.savings_rate.3m"].num, m.metrics["cashflow.savings_rate.3m"].num, 0.001);
  assert.equal(m2.cashflow.length, m.cashflow.length);
  near(m2.cashflow[m2.cashflow.length - 1].spending, m.cashflow[m.cashflow.length - 1].spending, 1);
  assert.equal(m2.cfcats.length, m.cfcats.length);
  near(E.spend(m2.tx, E.window("month", m2.asOf)).out, E.spend(m.tx, E.window("month", m.asOf)).out, 0.01);
  assert.equal(m2.goals[0].status, "Behind");
  near(m2.goals[0].progress, m.goals[0].progress, 0.001);
});

test("csv escapes commas and quotes", () => {
  const out = E.csv([{ a: 'He said "hi"', b: "x,y" }], [{ key: "a" }, { key: "b" }]);
  assert.equal(out.split("\n")[1], '"He said ""hi""","x,y"');
});

test("connector path: every tab rebuilt as a display-string grid reads back the same", () => {
  const money = (n) => (n == null ? "" : n < 0 ? `($${Math.abs(n).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})` : `$${n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  const dmy = (s) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : "");
  const pct = (p) => (p == null ? "" : `${(p * 100).toFixed(2)}%`);
  const cell = (k, v) => { if (v == null) return ""; if (/date|charged|used|end|month_end|pay_date/.test(k) && /^\d{4}-\d{2}-\d{2}$/.test(String(v))) return dmy(v); if (typeof v === "number") { if (/rate|progress|used|share|change$/.test(k) && Math.abs(v) < 1.5 && k !== "change_in_month" && k !== "change_per_month") return pct(v); if (/months|items|count|rank|charges_per_year|days/.test(k)) return String(v); return money(v); } return String(v); };
  const H = {
    accounts: ["Account ID", "Account", "Institution", "Type", "Owner", "Opening balance ($)", "Opening date", "Balance at as-of date ($)", "Liquid"],
    category_list: ["Category ID", "Category", "Group", "Flow", "Monthly budget ($)", "Essential", "Tax treatment", "ATO label"],
    goals: ["Goal", "Target amount ($)", "Target date", "Linked account", "Balance now ($)", "Progress", "Months left", "Needed per month ($)", "Saved per month, last 3 months ($)", "Status"],
    subscriptions: ["Service", "Merchant", "Owner", "Cadence", "Category ID", "Last used", "Decision", "Last charged", "Latest charge ($)", "Lowest charge in look-back ($)", "Charges per year", "Annual cost ($)", "Price rise per charge ($)", "Annual cost of price rise ($)", "Days since used", "Usage flag", "Saving if cancelled ($)"],
    loans: ["Loan ID", "Loan", "Lender", "Purpose", "Repayment type", "Interest rate", "Loan end date", "Offset account", "Balance at as-of date ($)", "Months remaining", "Monthly repayment, calculated ($)"],
    assets: ["Item ID", "Item", "Class", "Owner"],
    compliance: ["Check", "Type", "Items", "Amount ($)", "Status", "Why it matters", "Where to look"],
    networth: ["Month end", "Cash", "Property", "Super", "Shares", "Vehicle", "Loans", "Net worth", "Change in month"],
    budget: ["Category", "Monthly budget", "Latest month", "Average, last 3 months", "Year to date", "Budget to date", "Left in budget", "Budget used", "Status"],
    savings: ["Opportunity", "What the data shows", "Estimated saving ($)", "Type", "Effort", "Where to look", "Rank"],
    payslips: ["Pay date", "Person", "Employer", "Gross pay", "Tax withheld", "Super (employer)", "Net pay"],
    kitty: ["Key", "Value", "Note"],
  };
  const g = {};
  for (const [k, head] of Object.entries(H)) { const keys = head.map(E.key); g[k] = [["title"], [], head].concat(snap[k].map((o) => keys.map((kk) => cell(kk, o[kk])))); }
  // tabs with special shapes
  g.transactions = [["Txn ID", "Date", "Account ID", "Bank description", "Merchant", "Amount", "Category ID", "Person", "Receipt held", "Note"]].concat(snap.transactions.map((t) => [t.txn_id, dmy(t.date), t.account_id, t.bank_description, t.merchant, money(t.amount), t.category_id, t.person, t.receipt_held || "", t.note || ""]));
  g.settings = [["Settings"], [], ["Setting", "Value", "Note"]].concat(snap.settings.map((x) => [x.setting, /^\d{4}-\d{2}-\d{2}$/.test(String(x.value)) ? dmy(x.value) : typeof x.value === "number" && Math.abs(x.value) < 1.5 && /rate|share|tolerance|change/i.test(x.setting) ? pct(x.value) : x.value == null ? "" : String(x.value), x.note || ""]));
  g.metrics = [["Headline metrics"], [], ["Metric ID", "Metric", "Value", "Unit", "Period", "Comparison value", "Compared with", "Better when"]].concat(snap.metrics.map((x) => [x.metric_id, x.metric, x.unit === "Percent" ? pct(x.value) : /AUD/.test(x.unit) ? money(x.value) : String(x.value), x.unit, x.period, x.comparison_value == null ? "" : x.unit === "Percent" && typeof x.comparison_value === "number" ? pct(x.comparison_value) : typeof x.comparison_value === "number" && /AUD/.test(x.unit) ? money(x.comparison_value) : String(x.comparison_value), x.compared_with || "", x.better_when || ""]));
  g.mortgage = [["Mortgage scenarios"], [], ["Loan inputs"]].concat(Object.entries(snap.mortgage_inputs).map(([k, v]) => [k, /rate|step/i.test(k) ? pct(v) : /Months/.test(k) ? String(v) : money(v)])).concat([[], ["Interest rate scenarios"], ["Rate change", "Interest rate", "Monthly repayment ($)", "Change per month ($)", "Change per year ($)", "Net cash flow after change ($ per month)", "Interest over remaining term ($)", "Years to repay at today's repayment, with offset"]]).concat(snap.mortgage.map((r) => [pct(r.rate_change), pct(r.interest_rate), money(r.monthly_repayment), money(r.change_per_month), money(r.change_per_year), money(r.net_cash_flow_after_change), money(r.interest_over_remaining_term), String(r.years_to_repay_at_today_s_repayment_with_offset)])).concat([[], ["Extra repayment scenarios"], ["Extra per month ($)", "Total monthly repayment ($)", "Years to repay, with offset", "Years saved", "Interest saved ($)"]]).concat(snap.mortgage_extra.map((r) => [money(r.extra_per_month), money(r.total_monthly_repayment), String(r.years_to_repay_with_offset), String(r.years_saved), money(r.interest_saved)]));
  g.tax = [["Tax forecast"], [], ["Person", "Jordan", "Mia", "Jordan", "Mia", "How it is calculated"]].concat(snap.tax.map((r) => [r.label, typeof r.prior_j === "number" ? money(r.prior_j) : r.prior_j || "", typeof r.prior_m === "number" ? money(r.prior_m) : r.prior_m || "", typeof r.cur_j === "number" ? money(r.cur_j) : r.cur_j || "", typeof r.cur_m === "number" ? money(r.cur_m) : r.cur_m || "", r.how || ""]));
  g.cashflow = [["Monthly cash flow"], [], ["Month"].concat(snap.cashflow.map((c) => E.fmtMonth(c.month, true)))].concat([["Total income"].concat(snap.cashflow.map((c) => money(c.income))), ["Total spending"].concat(snap.cashflow.map((c) => money(c.spending))), ["Net cash flow"].concat(snap.cashflow.map((c) => money(c.net))), ["Savings rate"].concat(snap.cashflow.map((c) => pct(c.savings_rate))), [], ["Spending by category"]].concat(snap.cashflow_categories.map((c) => [c.category].concat(c.months.map(money)))));
  const m2 = E.model(E.fromConnector(g));
  assert.equal(m2.subs.length, m.subs.length); assert.equal(m2.loans.length, 2); assert.equal(m2.checks.length, m.checks.length); assert.equal(m2.networth.length, m.networth.length);
  assert.equal(m2.budget.length, m.budget.length); assert.equal(m2.savings.length, m.savings.length); assert.equal(m2.payslips.length, m.payslips.length); assert.equal(m2.kitty.household_name, "The Davies");
  near(m2.mortgage.balance, m.mortgage.balance, 1); assert.equal(m2.mortgage.scenarios.length, m.mortgage.scenarios.length); assert.equal(m2.mortgage.extras.length, m.mortgage.extras.length);
  near(m2.mortgage.scenarios[8].repayment, m.mortgage.scenarios[8].repayment, 1); near(m2.tax["Refund at risk"].pj, m.tax["Refund at risk"].pj, 1);
  near(m2.loans[0].rate, m.loans[0].rate, 0.0001); near(m2.subs[0].annual, m.subs[0].annual, 0.01); assert.equal(m2.subs[4].flag, "Still charging");
  assert.deepEqual(E.needs(m2).all.map((i) => i.t), E.needs(m).all.map((i) => i.t));
  assert.deepEqual(E.upcoming(m2, 35).map((u) => u.date + u.title), E.upcoming(m, 35).map((u) => u.date + u.title));
  near(E.safety(m2).months, E.safety(m).months, 0.001); near(E.leaks(m2).total, E.leaks(m).total, 0.5);
  assert.equal(E.sinceLastPay(m2).date, E.sinceLastPay(m).date);
});
