/* Real shapes of household, each a small life written as observations. `node --test standard/eval/households/test.js`.
   They prove the model tells the truth about the shape. They do not exercise file reading: no BAS or trust statement recipe runs here. */
"use strict";
const test = require("node:test"), assert = require("node:assert");
const { household } = require("./kit");
const { rebuild } = require("../../engine/rebuild");
const V = require("../../engine/views");
const schema = { events: require("../../schema/events.json") };
const run = (h, extra = {}) => rebuild({ setup: h.setup, sources: h.sources, observations: h.observations, decisions: h.decisions, rules: h.rules, schema, ...extra });
const status = (L, law) => L.checks.filter((c) => c.law === law).map((c) => c.status);

test("1 one account: a renter with one bank file gets a useful, honest page", () => {
  const h = household("renter").person("sam").account("BANK", "transaction", "cash", [["sam", 10000]]).scope("household", "renter", "property", "none").scope("household", "renter", "super", "unknown");
  h.rule("WOOLWORTHS", "GROCERIES").rule("ACME PAY", "SALARY").rule("RENT", "HOUSING");
  h.line("BANK", "2026-07-01", "ACME PAY", 300000, 300000).line("BANK", "2026-07-02", "RENT TO AGENT", -120000, 180000).line("BANK", "2026-07-03", "WOOLWORTHS 123", -8000, 172000);
  const L = run(h);
  assert.equal(L.cash[0].income, 300000);
  assert.equal(L.cash[0].spending, 128000);
  assert.equal(L.netWorth[0].total, 172000);
  assert.ok(!L.checks.some((c) => c.status === "fail"), JSON.stringify(L.checks.filter((c) => c.status === "fail")));
});

test("the card repayment is not spending, and a payslip and its deposit are one wage", () => {
  const h = household("pair").person("jo").org("ACME").account("BANK", "transaction", "cash", [["jo", 10000]]).account("CARD", "credit_card", "cash", [["jo", 10000]]);
  h.setup.contract.push({ contract_id: "JOB", kind: "employment", name: "Job", counterparty_party_id: "ACME", holder_party_id: "jo" });
  h.account("SUPER", "super", "super", [["jo", 10000]]);
  h.rule("TRANSFER", "CC-PAY").rule("PAYMENT RECEIVED", "CC-PAY").rule("COLES", "GROCERIES");
  h.obs("payslip", { person_ref: "jo", employer_ref: "ACME", pay_date: "2026-07-10", gross_cents: 400000, tax_cents: 100000, net_cents: 300000, super_cents: 48000 });
  h.line("BANK", "2026-07-10", "SALARY ACME", 300000);
  h.line("CARD", "2026-07-12", "COLES 1", -5000);
  h.line("BANK", "2026-07-20", "TRANSFER TO CARD", -5000).line("CARD", "2026-07-20", "PAYMENT RECEIVED", 5000);
  const L = run(h);
  assert.equal(L.cash[0].income, 300000, "salary counted once, net, in the cash lens");
  assert.equal(L.cash[0].spending, 5000, "the groceries, not the repayment");
  assert.equal(L.accrual[0].byCategory.SALARY, 400000, "gross in the accrual lens");
  assert.equal(L.balances.at("clearing:payroll:ACME", "2026-07"), 0, "payslip and deposit clear each other");
  assert.equal(L.balances.at("clearing:transfer", "2026-07") || 0, 0);
});

test("two identical charges stay two; one charge in two overlapping downloads stays one", () => {
  const h = household("dupes").person("jo").account("BANK", "transaction", "cash", [["jo", 10000]]).rule("JB", "SHOPPING");
  h.sources.push({ source_id: "s2", sha256: "x", name: "b", origin: "manual", captured_at: "2020-01-02T00:00:00Z", status: "active" });
  h.line("BANK", "2026-07-02", "JB HIFI", -1000).line("BANK", "2026-07-02", "JB HIFI", -1000);
  h.line("BANK", "2026-07-02", "JB HIFI MELBOURNE", -1000);
  h.observations[h.observations.length - 1].source_id = "s2";
  const L = run(h);
  assert.equal(L.events.filter((e) => e.kind === "purchase").length, 2);
  assert.equal(L.cash[0].spending, 2000);
});

test("3 trust: taxed this year, paid next, arriving by statement", () => {
  const h = household("trust").person("sam").account("BANK", "transaction", "cash", [["sam", 10000]]);
  h.obs("trust_statement", { person_ref: "sam", trust_ref: "FAMILY TRUST", fy: "FY2026", period_end: "2026-06-30", account_ref: "BANK", entitlement_cents: 500000 });
  h.line("BANK", "2026-09-15", "FAMILY TRUST DISTRIBUTION", 500000);
  const L = run(h);
  const june = L.accrual.find((m) => m.month === "2026-06");
  assert.equal(june.byCategory["TRUST-DIST"], 500000, "income lands when entitled");
  assert.equal(L.cash.find((m) => m.month === "2026-09").income, 500000, "cash lands when paid");
  assert.equal(L.balances.at("clearing:income:BANK", "2026-09"), 0, "and clears");
});

test("4 retiree: a pension is what they live on, and moves no net worth", () => {
  const h = household("retiree").person("pat").account("BANK", "transaction", "cash", [["pat", 10000]]).account("FUND", "super", "super", [["pat", 10000]]);
  h.term("account", "FUND", "phase", "retirement", "2020-01-01");
  h.obs("balance", { account_ref: "FUND", as_at: "2026-06-30", balance_cents: 50000000 });
  h.setup.account.find((a) => a.account_id === "FUND").opening_balance_cents = 50000000;
  h.setup.account.find((a) => a.account_id === "FUND").opening_date = "2026-07-01";
  h.obs("super_line", { account_ref: "FUND", posting_date: "2026-07-15", line_type: "pension", description: "Pension payment", amount_cents: -250000 });
  h.line("BANK", "2026-07-15", "FUND PENSION", 250000);
  const L = run(h);
  const jul = L.cash.find((m) => m.month === "2026-07");
  assert.equal(jul.income, 250000, "cash.income is true for a retiree");
  assert.equal(L.balances.at("clearing:super_out:FUND", "2026-07"), 0, "the two sides clear");
  assert.equal(L.netWorth.find((m) => m.month === "2026-07").total, 50000000, "net worth does not move");
});

test("5 separation: ownership ends on a date, and past views stay right", () => {
  const h = household("sep").person("a").person("b");
  h.account("HOUSE", "property", "property", [["a", 5000, "2010-01-01", "2026-03-01"], ["b", 5000, "2010-01-01", "2026-03-01"], ["a", 10000, "2026-03-01"]]);
  h.setup.account[0].opening_balance_cents = 100000000; h.setup.account[0].opening_date = "2020-01-01";
  h.obs("valuation", { subject_ref: "HOUSE", as_at: "2026-06-30", value_cents: 100000000, method: "appraisal" });
  const L = run(h);
  assert.deepEqual(V.netWorthByOwner(L, "2026-06"), { a: 100000000 });
  assert.ok(status(L, "L9").every((s) => s === "pass"));
  const before = V.netWorthByOwner({ ...L, balances: { ...L.balances, at: () => 100000000 } }, "2025-06");
  assert.equal(before.a, 50000000);
  assert.equal(before.b, 50000000);
});

test("6 mid-life start: a holdings statement with no history gives an unknown gain, never a full one", () => {
  const h = household("midlife").person("sam").account("BRK", "brokerage", "shares", [["sam", 10000]], { fidelity: "snapshot" });
  h.setup.instrument.push({ instrument_id: "ABC", kind: "listed_share", code: "ABC", name: "ABC", currency: "AUD" });
  h.obs("holding", { account_ref: "BRK", instrument_ref: "ABC", as_at: "2026-07-01", units: "100", price: "10.00", value_cents: 100000 });
  h.obs("contract_note", { account_ref: "BRK", instrument_ref: "ABC", side: "sell", trade_date: "2026-08-01", settlement_date: "2026-08-03", units: "100", price: "12.00", brokerage_cents: 1000, consideration_cents: 119000 });
  h.line("BRK", "2026-08-03", "SELL ABC", 119000);
  const L = run(h);
  assert.equal(L.lotMatches.length, 1);
  assert.equal(L.lotMatches[0].gain_cents, null, "unknown, not a fake full gain");
  assert.equal(L.lotMatches[0].proceeds_cents, 119000);
  assert.ok(!status(L, "L7").includes("fail"));
});

test("7 SMSF with a rental: one dollar, one level", () => {
  const h = household("smsf").person("a").org("FUND", "smsf");
  h.account("SMSF", "smsf", "super", [["a", 10000]]);
  h.account("RENTAL", "property", "property", [["FUND", 10000]]);
  for (const [id, cents] of [["SMSF", 80000000], ["RENTAL", 60000000]]) { const a = h.setup.account.find((x) => x.account_id === id); a.opening_balance_cents = cents; a.opening_date = "2026-07-01"; }
  h.line("SMSF", "2026-07-15", "MEMBER BALANCE", 0);
  const L = run(h);
  const m = L.netWorth[L.netWorth.length - 1];
  assert.equal(m.total, 80000000, "the fund's balance counts; the property inside it does not count again");
});

test("the home becomes a rental: cost base resets to market value, and a sale gives the right gain with no income in the ledger", () => {
  const h = household("reset").person("a").account("HOUSE", "property", "property", [["a", 10000]]).account("BANK", "transaction", "cash", [["a", 10000]]).account("LOAN", "loan", "loans", [["a", 10000]]);
  h.setup.asset.push({ asset_id: "HOME", kind: "property", name: "Home", account_id: "HOUSE" });
  h.term("asset", "HOME", "use", "owner_occupied", "2015-01-01", "2020-07-01").term("asset", "HOME", "use", "rental", "2020-07-01");
  h.obs("settlement", { asset_ref: "HOME", settled_on: "2015-01-01", price_cents: 50000000, duty_cents: 2000000, cash_paid_cents: 0, side: "buy", loan_drawn_cents: 52000000, loan_ref: "LOAN" });
  h.obs("valuation", { subject_ref: "HOME", as_at: "2020-07-01", value_cents: 80000000, method: "appraisal" });
  h.obs("settlement", { asset_ref: "HOME", settled_on: "2026-07-01", price_cents: 100000000, selling_costs_cents: 2000000, loan_payout_cents: 52000000, loan_ref: "LOAN", side: "sell" });
  h.line("BANK", "2026-07-01", "SETTLEMENT PROCEEDS", 46000000);
  const L = run(h);
  const m = L.lotMatches[0];
  assert.equal(m.cost_base_cents, 80000000, "market value at first income, not the 2015 price");
  assert.equal(m.gain_cents, 18000000, "proceeds less costs less reset base");
  assert.equal(m.discount_eligible, true);
  assert.equal(L.balances.at("HOUSE", "2026-07"), 0, "the asset is gone");
  assert.equal(L.balances.at("LOAN", "2026-07"), 0, "the loan is repaid from the sale");
  assert.equal(L.netWorth[L.netWorth.length - 1].total, 46000000);
  assert.equal(L.balances.at("clearing:asset:HOME", "2026-07"), 0, "the cash cleared the sale");
  assert.ok(!Object.keys(L.accrual.find((x) => x.month === "2026-07").byCategory).includes("CAPITAL-GAIN"));
});

test("a salary sacrifice pay clears, and income is not double counted", () => {
  const h = household("sacrifice").person("jo").org("ACME").account("BANK", "transaction", "cash", [["jo", 10000]]).account("SUPER", "super", "super", [["jo", 10000]]);
  h.setup.contract.push({ contract_id: "JOB", kind: "employment", name: "Job", counterparty_party_id: "ACME", holder_party_id: "jo" });
  h.setup.link.push({ relation: "contributes_to", from_type: "contract", from_id: "JOB", to_type: "account", to_id: "SUPER", valid_from: "2020-01-01", valid_to: null, recorded_at: "2020-01-01T00:00:00Z", superseded_at: null });
  h.obs("payslip", { person_ref: "jo", employer_ref: "ACME", pay_date: "2026-07-10", gross_cents: 500000, tax_cents: 110000, net_cents: 340000, super_cents: 60000, salary_sacrifice_cents: 50000 });
  h.line("BANK", "2026-07-10", "SALARY ACME", 340000);
  const L = run(h);
  assert.equal(L.balances.at("clearing:payroll:ACME", "2026-07"), 0);
  assert.equal(L.accrual[0].byCategory.SALARY, 450000, "taxable salary");
  assert.equal(L.accrual[0].byCategory["SUPER-SACRIFICE"], 50000);
  assert.equal(L.balances.at("clearing:super:SUPER", "2026-07"), 110000);
  assert.ok(!L.checks.some((c) => c.law === "L5" && c.status === "fail"));
});

test("a refinance moves the debt between lenders with no bank line, and the fee is a cost", () => {
  const h = household("refi").person("a").account("OLD", "loan", "loans", [["a", 10000]]).account("NEW", "loan", "loans", [["a", 10000]]);
  h.setup.contract.push({ contract_id: "L1", kind: "loan", name: "Old", account_id: "OLD" }, { contract_id: "L2", kind: "loan", name: "New", account_id: "NEW" });
  h.obs("loan_statement", { account_ref: "OLD", period_start: "2026-06-01", period_end: "2026-06-30", opening_cents: 50000000, interest_cents: 0, repayments_cents: 0, closing_cents: 0, payout_cents: 50000000, payout_to_ref: "NEW", discharge_fee_cents: 30000 });
  h.obs("loan_statement", { account_ref: "NEW", period_start: "2026-07-01", period_end: "2026-07-31", opening_cents: 50030000, interest_cents: 0, repayments_cents: 0, closing_cents: 50030000 });
  const L = run(h);
  assert.equal(L.balances.at("OLD", "2026-07"), 0);
  assert.equal(L.balances.at("NEW", "2026-07"), -50030000);
  assert.equal(L.accrual.find((m) => m.month === "2026-06").byCategory.FEES, -30000);
});

test("a card statement and its CSV date a charge differently; it is still one charge", () => {
  const h = household("basis").person("a").account("CARD", "credit_card", "cash", [["a", 10000]]).rule("JB", "SHOPPING");
  h.sources.push({ source_id: "s2", sha256: "x", name: "b", origin: "manual", captured_at: "2020-01-02T00:00:00Z", status: "active" });
  h.obs("txn_line", { account_ref: "CARD", posting_date: "2026-07-02", date_basis: "transaction", description: "JB HIFI COBURG", amount_cents: -9900 });
  h.obs("txn_line", { account_ref: "CARD", posting_date: "2026-07-04", date_basis: "posting", description: "JB HIFI COBURG VIC", amount_cents: -9900 });
  h.observations[1].source_id = "s2";
  const L = run(h);
  assert.equal(L.events.filter((e) => e.kind === "purchase").length, 1);
});

test("an amended return posts only the change, and the ATO position returns to zero", () => {
  const h = household("amend").person("a").org("ACME").account("BANK", "transaction", "cash", [["a", 10000]]);
  h.obs("payslip", { person_ref: "a", employer_ref: "ACME", pay_date: "2025-12-10", gross_cents: 10000000, tax_cents: 2000000, net_cents: 8000000, super_cents: 0 });
  h.line("BANK", "2025-12-10", "SALARY ACME", 8000000);
  h.obs("tax_assessment", { person_ref: "a", fy: "FY2026", assessed_on: "2026-08-01", version: 1, taxable_income_cents: 10000000, gross_tax_cents: 1900000, payg_credits_cents: 2000000, result_cents: 100000 });
  h.line("BANK", "2026-08-03", "ATO TAX REFUND", 100000);
  h.obs("tax_assessment", { person_ref: "a", fy: "FY2026", assessed_on: "2026-11-01", version: 2, taxable_income_cents: 10100000, gross_tax_cents: 1940000, payg_credits_cents: 2000000, result_cents: 60000 });
  h.line("BANK", "2026-11-20", "ATO PAYMENT", -40000);
  const L = run(h);
  assert.equal(L.balances.at("ato:a", "2026-11"), 0, "the ATO account is clear");
  assert.equal(L.accrual.find((m) => m.month === "2026-08").byCategory["INCOME-TAX"], -1900000);
  assert.equal(L.accrual.find((m) => m.month === "2026-11").byCategory["INCOME-TAX"], -40000, "only the change");
});

test("8 the tinkerer: tailors, types in a managed tab, takes an update, and keeps everything", () => {
  const { planUpdate, managedTabCheck, checkTailoring, hashTable } = require("../../engine/upgrade");
  const { sealOf } = require("../../engine/laws");
  const h = household("tinkerer").person("sam").account("BANK", "transaction", "cash", [["sam", 10000]]);
  h.rule("VET", "SHOPPING", { x_pet: "biscuit" }).rule("WOOLWORTHS", "GROCERIES");
  h.line("BANK", "2026-05-02", "WOOLWORTHS 1", -5000).line("BANK", "2026-05-03", "LOCAL VET", -9000).line("BANK", "2026-06-02", "WOOLWORTHS 2", -6000).line("BANK", "2026-07-05", "NEW MERCHANT", -2000);
  h.decisions.push({ decision_id: "d1", target_type: "line", target_ref: "BANK|2026-07-05|-2000", verb: "categorise", value: { category_id: "SHOPPING" }, by: "sam", at: "2026-07-06T00:00:00Z", status: "accepted" });
  h.setup.x_pets = [{ name: "Biscuit", x_claim_limit_cents: 500000 }];
  const tailoring = [{ tailoring_id: "t1", rung: "saved_question", name: "pet_costs", sentence: "What does the dog cost a year?", definition: { sum: "SHOPPING where VET" }, example: { result: { cents: 9000 } }, standard_version: "household-standard/1", status: "active" }];
  const before = run(h);

  const May = { period_id: "2026-05", status: "locked", start_on: "2026-05-01", end_on: "2026-05-31" };
  May.seal_hash = sealOf(before, May);
  const June = { period_id: "2026-06", status: "open", start_on: "2026-06-01", end_on: "2026-06-30" };

  // The update: better shared data re-reads the vet as HOUSING. New logic reaches a locked month.
  const originals = { before: { rule: JSON.parse(JSON.stringify(h.rules)), decision: JSON.parse(JSON.stringify(h.decisions)), x_pets: JSON.parse(JSON.stringify(h.setup.x_pets)), observation: JSON.parse(JSON.stringify(h.observations)) } };
  const updated = { ...h, rules: h.rules.map((r) => (r.pattern === "VET" ? { ...r, category_id: "HOUSING" } : r)) };
  const after = run(updated);
  originals.after = { rule: originals.before.rule, decision: h.decisions, x_pets: h.setup.x_pets, observation: h.observations };
  const plan = planUpdate({ before, after, originals, periods: [May, June] });

  assert.deepEqual(plan.originals_touched, [], "originals and x_ are byte-identical");
  assert.deepEqual(plan.unbound_decisions, [], "every decision is still bound");
  assert.equal(plan.proposals.length, 1, "a locked month raises a reopen proposal instead of moving");
  assert.equal(plan.proposals[0].period, "2026-05");
  assert.equal(plan.proposals[0].amount_cents, 9000, "a new category moves no total, and the proposal still says how much it touches");
  assert.ok(plan.summary.startsWith("Nothing you entered changes"));

  // A person types in a managed tab: the next writer stops and proposes, and overwrites nothing.
  const rows = [{ event_id: "a", amount_cents: 100 }];
  const stored = hashTable(rows);
  const edited = managedTabCheck({ table: "event", stored_hash: stored, rows: [{ event_id: "a", amount_cents: 105 }], key: "a" });
  assert.equal(edited.ok, false);
  assert.equal(edited.proposals[0].status, "proposed");
  assert.equal(managedTabCheck({ table: "event", stored_hash: stored, rows }).ok, true);

  // Tailoring carries the person's sentence and an example, so it survives or gets rewritten from the sentence.
  const pass = checkTailoring(tailoring, () => ({ cents: 9000 }));
  assert.equal(pass[0].status, "pass");
  const rewrite = checkTailoring(tailoring, () => ({ cents: 0 }));
  assert.equal(rewrite[0].status, "rewrite");
  assert.equal(rewrite[0].sentence, "What does the dog cost a year?");
});

test("8a an update shows a tax draft that moves, and a lodged year stays as lodged", () => {
  const { planUpdate } = require("../../engine/upgrade");
  const h = household("fixer").person("sam").account("BANK", "transaction", "cash", [["sam", 10000]]);
  h.setup.tax_map = [{ selector_type: "category", selector: "SALARY", label: "1", treatment: "income", basis: "ownership", valid_from: "2000-01-01" }, { selector_type: "category", selector: "FEES", label: "D10", treatment: "deduction", basis: "ownership", valid_from: "2000-01-01" }];
  h.rule("ACME PAY", "SALARY").rule("TAX AGENT", "SHOPPING");
  h.line("BANK", "2024-08-01", "ACME PAY", 6000000).line("BANK", "2024-09-01", "TAX AGENT", -50000).line("BANK", "2025-08-01", "ACME PAY", 6000000).line("BANK", "2025-09-01", "TAX AGENT", -80000);
  h.obs("tax_assessment", { person_ref: "sam", fy: "FY2025", assessed_on: "2025-09-20", version: 1, taxable_income_cents: 6000000, gross_tax_cents: 1000000, payg_credits_cents: 1000000, result_cents: 0, labels: [] });
  const before = run(h);
  const after = run({ ...h, rules: h.rules.map((r) => (r.pattern === "TAX AGENT" ? { ...r, category_id: "FEES" } : r)) });
  const plan = planUpdate({ before, after });
  const open = plan.moved.find((m) => m.metric === "tax.estimate.taxable_income");
  assert.deepEqual([open.fy, open.person, open.change], ["FY2026", "sam", -80000], "the open year's draft moves, and the diff says so");
  assert.ok(!plan.moved.some((m) => m.fy === "FY2025"), "a lodged year is never in what moves");
  const found = plan.findings.find((f) => f.metric === "tax.estimate.taxable_income");
  assert.deepEqual([found.kind, found.fy, found.person, found.amount_cents], ["lodged_year", "FY2025", "sam", -50000]);
  assert.ok(!plan.summary.includes(" 0 numbers move"));
});

test("8b a reopen proposal names every number that would move in the locked period", () => {
  const { planUpdate } = require("../../engine/upgrade");
  const { sealOf } = require("../../engine/laws");
  const h = household("reopen").person("sam").account("BANK", "transaction", "cash", [["sam", 10000]]);
  h.rule("CLIENT", "SALARY");
  h.line("BANK", "2026-05-02", "CLIENT PAYMENT", 200000);
  const before = run(h);
  const May = { period_id: "2026-05", status: "locked", start_on: "2026-05-01", end_on: "2026-05-31" };
  May.seal_hash = sealOf(before, May);
  const after = run({ ...h, rules: h.rules.map((r) => ({ ...r, category_id: "BUSINESS-INC" })) });
  const income = run({ ...h, rules: h.rules.map((r) => ({ ...r, category_id: "REIMBURSE" })) });
  assert.equal(planUpdate({ before, after, periods: [May] }).proposals[0].amount_cents, 200000, "income to income moves no total and still touches the money");
  const plan = planUpdate({ before, after: income, periods: [May] });
  assert.equal(plan.proposals[0].amount_cents, 200000, "a change to income counts, not only spending");
  assert.ok(plan.proposals[0].changes.some((m) => m.metric === "cash.income" && m.change === -200000));
  assert.ok(!plan.moved.some((m) => m.month === "2026-05"), "the locked month stays where it is");
});

test("2 shape change: a lodged business year reads by composition, and BAS net sales tie in both GST cases", () => {
  const { composition } = require("../../engine/tax");
  const h = household("sole").person("sam").account("BANK", "transaction", "cash", [["sam", 10000]]);
  h.obs("tax_assessment", { person_ref: "sam", fy: "FY2025", assessed_on: "2025-09-01", version: 1, taxable_income_cents: 9000000, gross_tax_cents: 1800000, payg_credits_cents: 1800000, result_cents: 0,
    labels: [{ line_id: "a", label: "1", section: "salary", role: "leaf", amount_cents: 3000000 }, { line_id: "b", label: "P8", section: "business", role: "leaf", amount_cents: 6000000 }, { line_id: "c", label: "15", section: "business", role: "memo", amount_cents: 6000000 }, { line_id: "d", label: null, section: "total", role: "subtotal", amount_cents: 9000000 }, { line_id: "e", label: "A", section: "spouse", role: "memo", amount_cents: 4200000 }] });
  h.obs("activity_statement", { person_ref: "sam", period_start: "2024-07-01", period_end: "2024-09-30", g1_cents: 3300000, g1_includes_gst: true, gst_collected_cents: 300000 });
  h.obs("activity_statement", { person_ref: "sam", period_start: "2024-10-01", period_end: "2024-12-31", g1_cents: 3000000, g1_includes_gst: false });
  h.obs("activity_statement", { person_ref: "sam", period_start: "2025-01-01", period_end: "2025-03-31", instalment_cents: 50000 });
  h.line("BANK", "2024-08-01", "OPENING", 100);
  const L = run(h);
  const c = composition(L, "sam", "FY2025");
  assert.equal(c.grade, "lodged");
  assert.deepEqual(c.parts, [{ section: "salary", amount_cents: 3000000 }, { section: "business", amount_cents: 6000000 }], "leaves only: the repeated net and the spouse memo do not count");
  assert.equal(L.checks.find((x) => x.law === "L19").status, "pass", "G1 less 1A where it includes GST, plain G1 where it does not, and a PAYG-only statement is skipped");
});

test("an x_ event kind is one line of data, judged by the same proof, with no code path", () => {
  const h = household("xkind").person("sam").account("BANK", "transaction", "cash", [["sam", 10000]]).account("DEBT", "loan", "loans", [["sam", 10000]]);
  h.line("BANK", "2026-07-02", "SERVICES AUSTRALIA RECOVERY", -5000);
  h.decisions.push({ decision_id: "d1", target_type: "line", target_ref: "BANK|2026-07-02|-5000", verb: "set_event_kind", value: { event_kind: "x_debt_repayment" }, by: "sam", at: "2026-07-03T00:00:00Z", status: "accepted" });
  const extensions = { events: { x_debt_repayment: { legs: [["DEBT", "+amount"], ["{account}", "-amount"]] } } };
  const L = run(h, { extensions });
  assert.equal(L.balances.at("DEBT", "2026-07"), 5000);
  assert.equal(L.cash[0].spending, 0, "repaying a debt is not spending");
  assert.throws(() => run(h, { extensions: { events: { x_bad: { legs: [["DEBT", "+amount"]] } } } }), /does not balance/);
});

test("a rental that became the home: capital works come off the base, and home days are exempt", () => {
  const h = household("mixed").person("a").account("HOUSE", "property", "property", [["a", 10000]]).account("BANK", "transaction", "cash", [["a", 10000]]);
  h.setup.asset.push({ asset_id: "HOME", kind: "property", name: "Home", account_id: "HOUSE" });
  h.term("asset", "HOME", "use", "rental", "2020-07-01", "2023-07-01").term("asset", "HOME", "use", "owner_occupied", "2023-07-01");
  h.obs("settlement", { asset_ref: "HOME", settled_on: "2020-07-01", price_cents: 50000000, duty_cents: 2000000, cash_paid_cents: 52000000, side: "buy" });
  h.line("BANK", "2020-07-01", "SETTLEMENT", -52000000, null);
  h.setup.account.find((a) => a.account_id === "BANK").opening_balance_cents = 52000000; h.setup.account.find((a) => a.account_id === "BANK").opening_date = "2020-06-01";
  h.obs("depreciation_schedule", { asset_ref: "HOME", issued_on: "2020-08-01", items: [{ name: "Capital works", division: "43", by_fy: { FY2021: 100000, FY2022: 100000, FY2023: 100000 } }] });
  h.obs("settlement", { asset_ref: "HOME", settled_on: "2026-07-01", price_cents: 70000000, cash_paid_cents: 70000000, side: "sell" });
  h.line("BANK", "2026-07-01", "SALE PROCEEDS", 70000000);
  const L = run(h);
  const m = L.lotMatches[0];
  assert.equal(m.claimed_works_cents, 300000, "claimed works come off the base");
  assert.equal(m.cost_base_cents, 51700000);
  const days = 2191, home = 1096;
  assert.equal(m.exempt_cents, Math.round(18300000 * home / days), "exempt by days as a home");
  assert.equal(m.gain_cents + m.exempt_cents, 18300000);
});

test("a dated use with a hole gives an unknown gain and a question, never a guess", () => {
  const h = household("hole").person("a").account("HOUSE", "property", "property", [["a", 10000]]).account("BANK", "transaction", "cash", [["a", 10000]]);
  h.setup.asset.push({ asset_id: "HOME", kind: "property", name: "Home", account_id: "HOUSE" });
  h.term("asset", "HOME", "use", "owner_occupied", "2022-01-01");
  h.obs("settlement", { asset_ref: "HOME", settled_on: "2020-07-01", price_cents: 50000000, cash_paid_cents: 0, side: "buy" });
  h.obs("settlement", { asset_ref: "HOME", settled_on: "2026-07-01", price_cents: 70000000, cash_paid_cents: 70000000, side: "sell" });
  h.line("BANK", "2026-07-01", "SALE PROCEEDS", 70000000);
  const L = run(h);
  assert.equal(L.lotMatches[0].gain_cents, null);
  assert.ok(L.review.some((r) => r.kind === "use_timeline_gap"));
});

test("a line on a shared card reaches a property through a rule, and tax follows the property's owners", () => {
  const h = household("shared").person("a").person("b").account("CARD", "credit_card", "cash", [["a", 10000]]).account("FLAT", "property", "property", [["b", 10000]]);
  h.setup.asset.push({ asset_id: "FLAT-A", kind: "property", name: "Flat", account_id: "FLAT" });
  for (const basis of ["legal", "beneficial", "tax"]) h.setup.ownership.push({ subject_type: "asset", subject_id: "FLAT-A", party_id: "b", basis, share_bps: 10000, valid_from: "2000-01-01", valid_to: null, recorded_at: "2000-01-01T00:00:00Z", superseded_at: null });
  h.setup.category.push({ category_id: "RENT-REPAIR2", name: "Repair", kind: "expense", cash_lens: true, economic_lens: true });
  h.setup.tax_map.push({ selector_type: "category", selector: "RENT-REPAIR2", label: "21X", treatment: "deduction", basis: "ownership", valid_from: "2000-01-01" });
  h.rule("PLUMBER", "RENT-REPAIR2", { asset_id: "FLAT-A" });
  h.line("CARD", "2026-08-01", "PLUMBER", -30000);
  const L = run(h, { reference: { series: {} } });
  const item = L.tax.items.find((i) => i.label === "21X");
  assert.equal(item.party_id, "b", "the property's owner, not the card's");
  assert.equal(item.amount_cents, 30000);
});

test("split, accept and a rule's scope and priority all change something", () => {
  const h = household("verbs").person("a").account("BANK", "transaction", "cash", [["a", 10000]]).account("BANK2", "transaction", "cash", [["a", 10000]]);
  h.rule("SHOP", "GROCERIES", { priority: 5 }).rule("BIG SHOP LONG NAME", "SHOPPING").rule("TRANSFER X", "SUBS", { account_id: "BANK2" });
  h.line("BANK", "2026-07-01", "BIG SHOP LONG NAME", -1000).line("BANK", "2026-07-02", "TRANSFER X", -700).line("BANK", "2026-07-03", "RECEIPT", -9000);
  h.decisions.push({ decision_id: "s1", target_type: "line", target_ref: "BANK|2026-07-03|-9000", verb: "split", value: { parts: [{ amount_cents: -6000, category_id: "GROCERIES" }, { amount_cents: -3000, category_id: "SHOPPING" }] }, by: "a", at: "2026-07-04T00:00:00Z", status: "accepted" });
  const L = run(h);
  assert.equal(L.cash[0].byCategory.GROCERIES, -7000, "priority beats length, and the split lands");
  assert.equal(L.cash[0].byCategory.SHOPPING, -3000);
  assert.ok(L.events.some((e) => e.description === "TRANSFER X" && e.category_id === "UNCAT"), "a rule scoped to another account does not apply");
});

test("an ESPP purchase: the discount is income, the contribution is not, and the lot's cost is market value", () => {
  const h = household("espp").person("jo").org("ACME").account("BANK", "transaction", "cash", [["jo", 10000]]).account("PLAN", "ess_plan", "shares", [["jo", 10000]]);
  h.setup.instrument.push({ instrument_id: "ACM", kind: "listed_share", code: "ACM", name: "Acme", currency: "AUD" });
  h.setup.contract.push({ contract_id: "ESPP", kind: "ess_plan", name: "ESPP", holder_party_id: "jo", account_id: "PLAN" });
  h.obs("payslip", { person_ref: "jo", employer_ref: "ACME", pay_date: "2026-07-10", gross_cents: 500000, tax_cents: 100000, net_cents: 340000, super_cents: 0, plan_contribution_cents: 60000 });
  h.line("BANK", "2026-07-10", "SALARY ACME", 340000);
  h.obs("vest", { plan_ref: "ESPP", person_ref: "jo", instrument_ref: "ACM", vest_date: "2026-08-01", units: "10", price: "7.00", currency: "AUD", taxable_value_cents: 10000, cost_paid_cents: 60000, cost_base_cents: 70000, account_ref: "PLAN" });
  const L = run(h);
  assert.equal(L.balances.at("clearing:ess:ESPP", "2026-08"), 0, "contributions meet the purchase");
  assert.equal(L.balances.at("PLAN", "2026-08"), 70000);
  assert.equal(L.accrual.find((m) => m.month === "2026-08").byCategory["ESS-INCOME"], 10000, "only the discount is income");
  assert.equal(L.lotRows[0].cost_price_cents, 70000);
});

test("a scheduled tranche makes no income, and a cancelled one never does", () => {
  const h = household("tranche").person("jo").account("PLAN", "ess_plan", "shares", [["jo", 10000]]);
  h.setup.instrument.push({ instrument_id: "ACM", kind: "rsu", code: "ACM", name: "Acme", currency: "AUD" });
  h.setup.contract.push({ contract_id: "ESS", kind: "ess_plan", name: "RSU", holder_party_id: "jo", account_id: "PLAN" });
  h.obs("vest", { plan_ref: "ESS", person_ref: "jo", instrument_ref: "ACM", vest_date: "2027-08-01", units: "10", price: "7", currency: "AUD", taxable_value_cents: 7000, status: "scheduled", account_ref: "PLAN" });
  h.obs("vest", { plan_ref: "ESS", person_ref: "jo", instrument_ref: "ACM", vest_date: "2028-08-01", units: "10", price: "7", currency: "AUD", taxable_value_cents: 7000, status: "cancelled", account_ref: "PLAN" });
  const L = run(h);
  assert.equal(L.events.filter((e) => e.kind === "vest").length, 0);
});

test("an accepted quote lowers free cash until it is paid", () => {
  const V2 = require("../../engine/views");
  const h = household("quote").person("a").account("BANK", "transaction", "cash", [["a", 10000]]).rule("BUILDER", "HOUSING", { contract_id: "Q1" }).rule("ACME PAY", "SALARY");
  h.setup.contract.push({ contract_id: "Q1", kind: "commitment", name: "Bathroom", started_on: "2026-07-01" });
  h.term("contract", "Q1", "total_cents", 2000000, "2026-07-01");
  h.line("BANK", "2026-07-01", "ACME PAY", 5000000).line("BANK", "2026-07-10", "BUILDER DEPOSIT", -500000);
  const L = run(h);
  const c = V2.commitments(L, "2026-07-31")[0];
  assert.equal(c.paid_cents, 500000);
  assert.equal(c.unpaid_cents, 1500000);
});

test("Division 293 released from super moves no bank line, and one credit can settle two assessments", () => {
  const h = household("div293").person("a").org("ACME").account("BANK", "transaction", "cash", [["a", 10000]]).account("SUPER", "super", "super", [["a", 10000]]);
  h.setup.account.find((x) => x.account_id === "SUPER").opening_balance_cents = 10000000; h.setup.account.find((x) => x.account_id === "SUPER").opening_date = "2025-07-01";
  h.obs("super_tax_notice", { person_ref: "a", fy: "FY2025", assessed_on: "2026-03-01", amount_cents: 300000, due_on: "2026-04-01", election: "release" });
  h.obs("super_line", { account_ref: "SUPER", posting_date: "2026-03-15", line_type: "release", description: "Release to ATO", amount_cents: -300000 });
  h.obs("payslip", { person_ref: "a", employer_ref: "ACME", pay_date: "2024-03-10", gross_cents: 500000, tax_cents: 100000, net_cents: 400000, super_cents: 0 });
  h.line("BANK", "2024-03-10", "SALARY ACME", 400000);
  h.obs("payslip", { person_ref: "a", employer_ref: "ACME", pay_date: "2025-03-10", gross_cents: 300000, tax_cents: 50000, net_cents: 250000, super_cents: 0 });
  h.line("BANK", "2025-03-10", "SALARY ACME", 250000);
  h.obs("tax_assessment", { person_ref: "a", fy: "FY2024", assessed_on: "2026-05-01", version: 1, taxable_income_cents: 1, gross_tax_cents: 0, payg_credits_cents: 100000, result_cents: 100000 });
  h.obs("tax_assessment", { person_ref: "a", fy: "FY2025", assessed_on: "2026-05-02", version: 1, taxable_income_cents: 1, gross_tax_cents: 0, payg_credits_cents: 50000, result_cents: 50000 });
  h.line("BANK", "2026-05-20", "ATO REFUND", 150000);
  const L = run(h);
  assert.equal(L.balances.at("ato:a", "2026-05"), 0, "assessments, the release and the one credit all meet in the ATO position");
  assert.equal(L.balances.at("SUPER", "2026-05"), 9700000, "the fund paid, no bank line");
  assert.ok(!L.review.some((r) => r.kind === "tax_result_unmatched"), "one credit, two results");
  assert.ok(!L.checks.some((c) => c.status === "fail" && String(c.scope).startsWith("clearing:super_out")));
});

test("a hand correction names what it replaces, and one claim remains; an accepted law stays accepted", () => {
  const h = household("fix").person("a").account("BANK", "transaction", "cash", [["a", 10000]]).rule("SHOP", "SHOPPING");
  h.line("BANK", "2026-07-01", "SHOP", -1000);
  const first = h.observations[0].obs_id;
  h.line("BANK", "2026-07-01", "SHOP", -1100);
  h.observations[1].supersedes_obs_id = first;
  h.setup.account.find((a) => a.account_id === "BANK").opening_balance_cents = 0; h.setup.account.find((a) => a.account_id === "BANK").opening_date = "2026-06-01";
  h.obs("balance", { account_ref: "BANK", as_at: "2026-07-02", balance_cents: -5000, balance_kind: "ledger" });
  h.obs("balance", { account_ref: "BANK", as_at: "2026-07-02", balance_cents: 999999, balance_kind: "available" });
  h.decisions.push({ decision_id: "a1", target_type: "check", target_ref: "L3|BANK", verb: "accept", value: {}, by: "accountant", at: "2026-08-01T00:00:00Z", status: "accepted", reason: "Known bank error.", reopen_if: "gap above $50" });
  const L = run(h);
  assert.equal(L.events.filter((e) => e.kind === "purchase").length, 1);
  assert.equal(L.cash[0].spending, 1100);
  const c = L.checks.find((x) => x.law === "L3" && x.scope === "BANK");
  assert.equal(c.status, "accepted", "an available balance is not read as ledger, and the ledger gap was accepted with a reason");
  assert.equal(c.gap_cents, -3900);
});

test("the holes the audit found: drift without a declared basis, a held amount, split pay, and a look-alike sweep", () => {
  const two = (name) => { const h = household(name).person("a").org("ACME").account("CARD", "credit_card", "cash", [["a", 10000]]).account("BANK", "transaction", "cash", [["a", 10000]]).account("SAVE", "savings", "cash", [["a", 10000]]).rule("SHOP", "SHOPPING").rule("RENT", "HOUSING").rule("SWEEP", "TRANSFER"); h.sources.push({ source_id: "s2", sha256: "x", name: "b", origin: "manual", captured_at: "2020-01-02T00:00:00Z", status: "active" }); return h; };
  // one charge, two files, a day apart, both files covering both days, no date basis
  let h = two("drift");
  h.line("CARD", "2026-07-01", "OPEN A", -100).line("CARD", "2026-07-02", "SHOP ONE", -9900).line("CARD", "2026-07-09", "CLOSE A", -200);
  h.line("CARD", "2026-07-01", "OPEN A", -100); h.line("CARD", "2026-07-03", "SHOP ONE", -9900); h.line("CARD", "2026-07-09", "CLOSE A", -200);
  h.observations.slice(3).forEach((o) => { o.source_id = "s2"; });
  assert.equal(run(h).events.filter((e) => /SHOP ONE/.test(e.description)).length, 1, "one charge");
  // a charge a cent apart, both files covering both days, is one charge, and asks which amount
  h = two("cent");
  h.line("CARD", "2026-07-01", "OPEN A", -100).line("CARD", "2026-07-02", "SHOP FX", -9900).line("CARD", "2026-07-09", "CLOSE A", -200);
  h.line("CARD", "2026-07-01", "OPEN A", -100); h.line("CARD", "2026-07-02", "SHOP FX", -9901); h.line("CARD", "2026-07-09", "CLOSE A", -200);
  h.observations.slice(3).forEach((o) => { o.source_id = "s2"; });
  assert.ok(run(h).review.some((r) => r.kind === "restated_line"));
  assert.equal(run(h).events.filter((e) => /SHOP FX/.test(e.description)).length, 1);
  // a hold at 50 that posts at 58
  h = two("hold");
  h.obs("txn_line", { account_ref: "CARD", posting_date: "2026-07-02", description: "SHOP FUEL STATION", amount_cents: -5000, status: "pending" });
  h.line("CARD", "2026-07-03", "SHOP FUEL STATION", -5800).line("CARD", "2026-07-20", "SHOP OTHER", -100);
  assert.equal(run(h).cash[0].spending, 5900, "the hold is replaced by what posted");
  // net pay split across two accounts
  h = two("split");
  h.obs("payslip", { person_ref: "a", employer_ref: "ACME", pay_date: "2026-07-10", gross_cents: 400000, tax_cents: 100000, net_cents: 300000, super_cents: 0 });
  h.line("BANK", "2026-07-10", "SALARY ACME", 150000).line("SAVE", "2026-07-10", "SALARY ACME", 150000);
  let L = run(h);
  assert.equal(L.accrual[0].byCategory.SALARY, 400000, "gross, once");
  assert.equal(L.balances.at("clearing:payroll:ACME", "2026-07"), 0);
  // a rent payment equal to a savings sweep is not a transfer
  h = two("lookalike");
  h.line("BANK", "2026-07-01", "RENT PAYMENT", -200000).line("SAVE", "2026-07-01", "SWEEP IN", 200000);
  L = run(h);
  assert.equal(L.cash[0].spending, 200000, "rent is still spending");
  assert.ok(L.review.some((r) => r.kind === "unpaired_transfer"), "and the sweep with no partner is a question");
  // a salary deposit with no payslip is provisional and asks
  h = two("noslip").rule("ACME PAY", "SALARY");
  h.line("BANK", "2026-07-10", "ACME PAY", 300000);
  L = run(h);
  assert.equal(L.events[0].status, "provisional");
  assert.ok(L.review.some((r) => r.kind === "deposit_without_payslip"));
});

// ---------- shapes the first blind household found. Each failed before its repair. Nothing here reads that household's numbers. ----------
const stream = (h, id, name) => { h.sources.push({ source_id: id, sha256: id, name: id, origin: "manual", stream_id: name, captured_at: "2020-01-02T00:00:00Z", status: "active" }); return id; };
const from = (h, n, id) => h.observations.slice(n).forEach((o) => { o.source_id = id; });

test("a contributes_to link may name the fund's contract, and a law never stops a rebuild", () => {
  const h = household("fund").person("a").org("ACME").account("BANK", "transaction", "cash", [["a", 10000]]).account("SUPER", "super", "super", [["a", 10000]]);
  h.setup.contract.push({ contract_id: "JOB", kind: "employment", name: "Job", counterparty_party_id: "ACME", holder_party_id: "a" }, { contract_id: "FUND", kind: "super_fund", name: "Fund", holder_party_id: "a", account_id: "SUPER" });
  h.setup.link.push({ relation: "contributes_to", from_type: "contract", from_id: "JOB", to_type: "contract", to_id: "FUND", valid_from: "2000-01-01", recorded_at: "2000-01-01T00:00:00Z" });
  h.obs("payslip", { person_ref: "a", employer_ref: "ACME", pay_date: "2026-07-10", gross_cents: 400000, tax_cents: 100000, net_cents: 300000, super_cents: 46000 });
  h.line("BANK", "2026-07-10", "SALARY ACME", 300000);
  h.obs("super_line", { account_ref: "SUPER", posting_date: "2026-07-20", line_type: "employer", description: "SG", amount_cents: 46000 });
  const L = run(h);
  assert.equal(L.balances.at("SUPER", "2026-07"), 46000);
  assert.equal(L.balances.at("clearing:super:SUPER", "2026-07"), 0, "the payslip's super and the fund's line meet at the member account");
  // a contribution with no payslip behind it has nothing due: a skip, not a crash
  const g = household("orphan").person("a").account("SUPER", "super", "super", [["a", 10000]]);
  g.obs("super_line", { account_ref: "SUPER", posting_date: "2026-07-20", line_type: "employer", description: "SG", amount_cents: 46000 });
  assert.ok(run(g).checks.some((c) => c.law === "L14"));
});

test("one card in two streams: lag of days, across file edges, is one charge; a weekly charge in one stream stays weekly", () => {
  const h = household("lag").person("a").account("CARD", "credit_card", "cash", [["a", 10000]]);
  const julyCsv = stream(h, "c1", "CSV"), augCsv = stream(h, "c2", "CSV"), julyPdf = stream(h, "p1", "PDF"), augPdf = stream(h, "p2", "PDF");
  const add = (src, date, desc, cents) => { const n = h.observations.length; h.line("CARD", date, desc, cents); from(h, n, src); };
  // the statement dates by the charge; the download by the posting, up to six days later, sometimes into the next file
  add(julyPdf, "2026-07-01", "OPEN", -100); add(julyCsv, "2026-07-01", "OPEN", -100);
  add(julyPdf, "2026-07-10", "CORNER BAKERY", -1250); add(julyCsv, "2026-07-14", "CORNER BAKERY", -1250);
  add(julyPdf, "2026-07-30", "HARDWARE BARN", -7777); add(augCsv, "2026-08-05", "HARDWARE BARN", -7777);
  add(julyPdf, "2026-07-31", "END", -100); add(julyCsv, "2026-07-31", "END", -100);
  add(augPdf, "2026-08-01", "START", -100); add(augCsv, "2026-08-01", "START", -100);
  // the same coffee every seven days, in both streams
  for (const [p, c] of [["2026-08-03", "2026-08-07"], ["2026-08-10", "2026-08-14"], ["2026-08-17", "2026-08-21"]]) { add(augPdf, p, "ROAST COFFEE", -550); add(augCsv, c, "ROAST COFFEE", -550); }
  add(augPdf, "2026-08-31", "END", -100); add(augCsv, "2026-08-31", "END", -100);
  const L = run(h);
  const n = (re) => L.events.filter((e) => re.test(e.description)).length;
  assert.equal(n(/CORNER BAKERY/), 1, "four days apart");
  assert.equal(n(/HARDWARE BARN/), 1, "six days apart, in next month's download");
  assert.equal(n(/ROAST COFFEE/), 3, "three coffees, each seen twice");
  // and one stream, two monthly files, a real repeat over the edge: two charges, and no question to answer
  const g = household("edge").person("a").account("CARD", "credit_card", "cash", [["a", 10000]]);
  const a = stream(g, "a", "CSV"), b = stream(g, "b", "CSV");
  g.line("CARD", "2026-07-20", "TRAM PASS", -4000).line("CARD", "2026-07-30", "TRAM PASS", -4000);
  const k = g.observations.length; g.line("CARD", "2026-08-02", "TRAM PASS", -4000).line("CARD", "2026-08-20", "OTHER", -100);
  from(g, 0, a); from(g, k, b);
  const G = run(g);
  assert.equal(G.events.filter((e) => /TRAM/.test(e.description)).length, 3);
  assert.ok(!G.review.some((r) => r.kind === "possible_duplicate"));
});

test("coverage counts what the files speak for: a missing month shows even with neighbours, and a bulk download does not look like a gap", () => {
  const build = (months, day) => {
    const h = household("cov").person("a").account("BRK", "brokerage", "shares", [["a", 10000]], { fidelity: "snapshot" });
    h.setup.stream.push({ stream_id: "HOLD", subject_type: "account", subject_id: "BRK", cadence: "monthly", grace_days: 14, valid_from: "2026-01-01", valid_to: null });
    h.setup.instrument.push({ instrument_id: "ABC", kind: "listed_share", code: "ABC", name: "ABC", currency: "AUD" });
    for (const m of months) { const id = `f${m}`; stream(h, id, "HOLD"); const n = h.observations.length; h.obs("holding", { account_ref: "BRK", instrument_ref: "ABC", as_at: `2026-${m}-28`, units: "100", price: "10.00", value_cents: 100000 }); from(h, n, id); h.sources.find((s) => s.source_id === id).captured_at = `${day || `2026-${m}-29`}T00:00:00Z`; }
    return run(h, { asOf: "2026-07-31" });
  };
  const gap = build(["01", "02", "04", "05", "06"]).coverage.find((c) => c.stream_id === "HOLD");
  assert.deepEqual([gap.expected, gap.have, gap.missing], [6, 5, ["2026-03"]]);
  const bulk = build(["01", "02", "03", "04", "05", "06"], "2026-07-02").coverage.find((c) => c.stream_id === "HOLD");
  assert.deepEqual([bulk.expected, bulk.have], [6, 6]);
});

test("a buy between trade and settlement is owed: holdings up, cash not yet down, net worth level", () => {
  const h = household("t2").person("a").account("BRK", "brokerage", "cash", [["a", 10000]], { opening_balance_cents: 500000, opened_on: "2026-06-01" }).account("SH", "holding", "shares", [["a", 10000]], { parent_account_id: "BRK", instrument_id: "ABC" });
  h.setup.instrument.push({ instrument_id: "ABC", kind: "listed_share", code: "ABC", name: "ABC", currency: "AUD" });
  h.obs("contract_note", { account_ref: "BRK", instrument_ref: "ABC", side: "buy", trade_date: "2026-06-30", settlement_date: "2026-07-02", units: "100", price: "10.00", brokerage_cents: 0, consideration_cents: 100000 });
  h.line("BRK", "2026-07-02", "SETTLE ABC", -100000);
  const L = run(h);
  const nw = (m) => L.netWorth.find((r) => r.month === m).total;
  assert.equal(nw("2026-06"), 500000, "the buy is paid for by a debt until it settles");
  assert.equal(nw("2026-07"), 500000);
  assert.equal(L.balances.at("clearing:settle:BRK", "2026-07"), 0);
});

test("a dividend or a trade can settle through any of the household's accounts", () => {
  const h = household("linked").person("a").account("BANK", "transaction", "cash", [["a", 10000]], { opening_balance_cents: 900000, opened_on: "2026-06-01" }).account("BRK", "brokerage", "shares", [["a", 10000]]).account("SH", "holding", "shares", [["a", 10000]], { parent_account_id: "BRK", instrument_id: "ABC" });
  h.setup.instrument.push({ instrument_id: "ABC", kind: "listed_share", code: "ABC", name: "ABC", currency: "AUD" });
  h.obs("contract_note", { account_ref: "BRK", instrument_ref: "ABC", side: "buy", trade_date: "2026-07-06", settlement_date: "2026-07-08", units: "100", price: "10.00", brokerage_cents: 1950, consideration_cents: 101950 });
  h.line("BANK", "2026-07-08", "BPAY MY BROKER 99123", -101950);
  h.obs("dividend", { account_ref: "BRK", instrument_ref: "ABC", ex_date: "2026-09-01", pay_date: "2026-09-20", units: "100", franked_cents: 7500, unfranked_cents: 0, franking_credit_cents: 3214, net_cents: 7500 });
  h.line("BANK", "2026-09-20", "ABC FINAL DIV 00123", 7500);
  const L = run(h);
  assert.equal(L.review.filter((r) => /dividend_unpaid|trade_unsettled/.test(r.kind)).length, 0);
  assert.equal(L.balances.at("clearing:income:BANK", "2026-09"), 0);
  assert.equal(L.balances.at("clearing:settle:BANK", "2026-09"), 0);
  assert.equal(L.cash.find((m) => m.month === "2026-09").income, 7500, "income once");
  assert.equal(L.cash.find((m) => m.month === "2026-07").spending, 0, "a trade is not spending");
});

test("the first holdings statement of a ledger account opens what no trade explains, at unknown cost", () => {
  const h = household("firstfile").person("a").account("BRK", "brokerage", "cash", [["a", 10000]]).account("SH", "holding", "shares", [["a", 10000]], { parent_account_id: "BRK" });
  h.setup.instrument.push({ instrument_id: "ABC", kind: "listed_share", code: "ABC", name: "ABC", currency: "AUD" }, { instrument_id: "XYZ", kind: "listed_share", code: "XYZ", name: "XYZ", currency: "AUD" });
  h.obs("holding", { account_ref: "BRK", instrument_ref: "ABC", as_at: "2026-06-30", units: "500", price: "10.00", value_cents: 500000 });
  h.obs("contract_note", { account_ref: "BRK", instrument_ref: "ABC", side: "sell", trade_date: "2026-07-06", settlement_date: "2026-07-08", units: "200", price: "11.00", brokerage_cents: 0, consideration_cents: 220000 });
  h.line("BRK", "2026-07-08", "SELL ABC", 220000);
  h.obs("holding", { account_ref: "BRK", instrument_ref: "ABC", as_at: "2026-07-31", units: "300", price: "11.00", value_cents: 330000 });
  const L = run(h);
  assert.ok(!L.review.some((r) => r.kind === "oversold"));
  assert.ok(!status(L, "L7").includes("fail"), "lots equal the broker's units");
  assert.equal(L.lotMatches[0].gain_cents, null, "unknown, never a full gain");
});

test("an own transfer with no dictionary word still pairs; two strangers' lines do not", () => {
  const two = (n) => household(n).person("kim", "Kim Nguyen").person("sam", "Sam Reilly").account("A", "transaction", "cash", [["kim", 10000]]).account("B", "transaction", "cash", [["sam", 10000]]);
  let h = two("own");
  h.line("A", "2026-07-03", "OSKO TO S REILLY HOUSE SHARE", -60000).line("B", "2026-07-03", "OSKO FROM K NGUYEN HOUSE SHARE", 60000);
  h.line("A", "2026-07-20", "BPAY CEDAR 8841", -25000).line("B", "2026-07-21", "DEPOSIT 8841", 25000);
  let L = run(h);
  assert.equal(L.events.filter((e) => e.kind === "transfer").length, 2);
  assert.equal(L.cash[0].spending, 0);
  // a shop's refund to the other card, same amount, says nothing about moving money: it stays two questions
  h = two("strangers");
  h.line("A", "2026-07-03", "TILES AND MORE", -4000).line("B", "2026-07-04", "GARDEN CENTRE REFUND", 4000);
  L = run(h);
  assert.equal(L.events.filter((e) => e.kind === "transfer").length, 0);
});

test("a deposit at exchange and the balance at settlement are one purchase", () => {
  const h = household("buy").person("a").account("BANK", "transaction", "cash", [["a", 10000]], { opening_balance_cents: 30000000, opened_on: "2026-01-01" }).account("HOME", "property", "property", [["a", 10000]]).account("LOAN", "loan", "loans", [["a", 10000]]);
  h.setup.asset.push({ asset_id: "UNIT", kind: "property", name: "Unit", account_id: "HOME" });
  h.setup.contract.push({ contract_id: "L", kind: "loan", name: "Loan", account_id: "LOAN" });
  h.line("BANK", "2026-02-02", "TFR TO TRUST ACCOUNT DEPOSIT", -6000000).line("BANK", "2026-02-10", "POWER", -12000).line("BANK", "2026-04-14", "SETTLEMENT FUNDS", -8250000).line("BANK", "2026-05-01", "POWER", -12000);
  h.obs("settlement", { asset_ref: "UNIT", side: "buy", settled_on: "2026-04-15", price_cents: 60000000, duty_cents: 2000000, legal_cents: 250000, loan_ref: "LOAN", loan_drawn_cents: 48000000, cash_paid_cents: 14250000 });
  const L = run(h);
  assert.equal(L.events.filter((e) => e.kind === "asset_payment").length, 2);
  assert.equal(L.balances.at("clearing:asset:UNIT", "2026-05"), 0);
  assert.equal(L.cash.find((m) => m.month === "2026-02").spending, 12000, "the deposit is not spending");
});

test("an account opens where its stream starts, not where its first line happens to fall", () => {
  const h = household("open").person("a").account("BRK", "transaction", "cash", [["a", 10000]]);
  h.setup.stream.push({ stream_id: "S", subject_type: "account", subject_id: "BRK", cadence: "quarterly", grace_days: 14, valid_from: "2026-01-01", valid_to: null });
  h.line("BRK", "2026-03-10", "INTEREST", 500, 100500).line("BRK", "2026-04-20", "FEE", -500, 100000);
  const L = run(h);
  assert.equal(L.balances.at("BRK", "2026-01"), 100000, "it held this all along");
});

test("the uncategorised queue asks once per merchant", () => {
  const h = household("q").person("a").account("BANK", "transaction", "cash", [["a", 10000]]);
  for (const d of ["01", "08", "15"]) h.line("BANK", `2026-07-${d}`, "ZELKOVA CAFE COBURG", -1000);
  h.line("BANK", "2026-07-02", "OBSCURE THING", -500);
  const L = run(h);
  const items = L.review.filter((r) => r.kind === "uncategorised");
  assert.equal(items.length, 4, "every line is still held");
  assert.equal(new Set(items.map((r) => r.question)).size, 2, "two questions");
});

test("a transfer across a month end lands on each account on its own day, and net worth holds it in the air", () => {
  const h = household("air").person("a").account("A", "transaction", "cash", [["a", 10000]], { opening_balance_cents: 100000, opened_on: "2026-01-01" }).account("B", "savings", "cash", [["a", 10000]]).rule("TFR", "TRANSFER");
  h.line("A", "2026-06-30", "TFR TO SAVINGS", -40000, 60000).line("B", "2026-07-01", "TFR FROM EVERYDAY", 40000, 40000);
  const L = run(h);
  assert.equal(L.balances.at("A", "2026-06"), 60000);
  assert.equal(L.balances.at("B", "2026-06"), 0, "the bank says it had not arrived");
  assert.equal(L.balances.at("B", "2026-07"), 40000);
  assert.equal(L.netWorth.find((r) => r.month === "2026-06").total, 100000, "and no one lost it");
  assert.ok(!status(L, "L3").includes("fail"));
  assert.equal(L.events.filter((e) => e.kind === "transfer").length, 1);
});

test("a charge in one month that posts in the next: spending reads the charge, the balance reads the posting", () => {
  const h = household("two").person("a").account("CARD", "credit_card", "cash", [["a", 10000]]);
  h.setup.stream.push({ stream_id: "PDF", subject_type: "account", subject_id: "CARD", cadence: "monthly", valid_from: "2026-07-01" }, { stream_id: "CSV", subject_type: "account", subject_id: "CARD", cadence: "quarterly", valid_from: "2026-07-01" });
  const pdf = stream(h, "p", "PDF"), csv = stream(h, "c", "CSV");
  const n = h.observations.length;
  h.obs("txn_line", { account_ref: "CARD", posting_date: "2026-07-01", date_basis: "transaction", description: "OPENER", amount_cents: -100 });
  h.obs("txn_line", { account_ref: "CARD", posting_date: "2026-07-30", date_basis: "transaction", description: "PAPER AND TWINE", amount_cents: -9900 });
  h.obs("txn_line", { account_ref: "CARD", posting_date: "2026-08-20", date_basis: "transaction", description: "CLOSER", amount_cents: -100 });
  from(h, n, pdf);
  const k = h.observations.length;
  h.line("CARD", "2026-07-01", "OPENER", -100).line("CARD", "2026-08-02", "PAPER AND TWINE", -9900).line("CARD", "2026-08-20", "CLOSER", -100);
  from(h, k, csv);
  const L = run(h);
  assert.equal(L.events.filter((e) => /TWINE/.test(e.description)).length, 1);
  assert.equal(L.cash.find((m) => m.month === "2026-07").spending, 10000, "charged in July");
  assert.equal(L.balances.at("CARD", "2026-07"), -100, "posted in August");
  h.setup.household[0].budget_date = "posted";
  assert.equal(run(h).cash.find((m) => m.month === "2026-07").spending, 100, "a household can keep its books by the posting");
});

// ---------- shapes the second blind household found. Each failed before its repair. Nothing here reads that household's numbers. ----------
test("a line the dictionary can name but not place is asked, never parked in UNCAT in silence", () => {
  const Engine = require("../../../src/engine.js");
  Engine.loadMerchants({ merchants: require("../../../merchants/merchants.json"), categories: require("../../../merchants/categories.json") });
  try {
    const h = household("gov").person("a").account("BANK", "transaction", "cash", [["a", 10000]]);
    h.line("BANK", "2026-07-04", "SERVICES AUSTRALIA 7731", 150000);
    h.line("BANK", "2026-07-05", "BPAY NOWHERE COUNCIL 6641", -40000);
    const L = run(h);
    assert.ok(L.review.some((r) => r.kind === "uncategorised" && /SERVICES AUSTRALIA/.test(r.what)));
    assert.equal(L.cash[0].spending, 40000, "and a BPAY to a biller is still spending, not a transfer");
  } finally { Engine.loadMerchants({ merchants: { merchants: [] }, categories: {} }); }
});

test("money in that nobody has explained is not negative spending; a refund from a shop you paid is", () => {
  const h = household("in").person("a").account("BANK", "transaction", "cash", [["a", 10000]]);
  h.line("BANK", "2026-07-02", "WOOLLEN FOX HOBART", -5000).line("BANK", "2026-07-20", "WOOLLEN FOX HOBART", 2000);
  h.line("BANK", "2026-07-21", "DIRECT CREDIT 88123 QVX", 150000);
  const L = run(h), m = L.cash[0];
  assert.equal(m.spending, 3000, "the refund nets, the stranger's credit does not");
  assert.equal(m.unexplained, 150000);
  assert.equal(m.net, 147000);
  assert.ok(L.review.some((r) => /QVX/.test(r.what)));
});

test("a credit from an account that serves a rental, saying rent, is rent", () => {
  const h = household("rent").person("a").account("BANK", "offset", "cash", [["a", 10000]]).account("FLAT", "property", "property", [["a", 10000]]);
  h.setup.asset.push({ asset_id: "UNIT", kind: "property", name: "Unit", account_id: "FLAT" });
  h.setup.link.push({ relation: "serves", from_type: "account", from_id: "BANK", to_type: "asset", to_id: "UNIT", valid_from: "2000-01-01", recorded_at: "2000-01-01T00:00:00Z" });
  h.term("asset", "UNIT", "use", "rental", "2000-01-01");
  h.line("BANK", "2026-07-04", "OSKO FROM R TENANT RENT JUL", 128000);
  assert.equal(run(h).cash[0].income, 128000);
});

test("a file with bank references and a file without them still see one line; a late posting is one line; two amounts for one charge are one, and ask", () => {
  const h = household("mix").person("a").account("BANK", "transaction", "cash", [["a", 10000]]);
  const csv = stream(h, "c", "BANK-CSV"), ofx = stream(h, "o", "BANK-OFX");
  const put = (src, f) => { const n = h.observations.length; f(); from(h, n, src); };
  put(csv, () => { h.line("BANK", "2026-07-01", "OPEN", -100).line("BANK", "2026-07-18", "Visa Purchase 18/07 MARINA ROLLS GEELONG", -2057).line("BANK", "2026-07-31", "CLOSE", -100); });
  put(ofx, () => { h.obs("txn_line", { account_ref: "BANK", posting_date: "2026-07-01", description: "OPEN", amount_cents: -100, reference: "FIT1" }); h.obs("txn_line", { account_ref: "BANK", posting_date: "2026-07-18", description: "Visa Purchase 18/07 MARINA ROLLS", amount_cents: -2057, reference: "FIT2" }); h.obs("txn_line", { account_ref: "BANK", posting_date: "2026-07-31", description: "CLOSE", amount_cents: -100, reference: "FIT3" }); });
  assert.equal(run(h).events.filter((e) => /MARINA/.test(e.description)).length, 1, "a reference on one side does not make two lines");

  const g = household("late").person("a").account("CARD", "credit_card", "cash", [["a", 10000]]);
  const pdf = stream(g, "p", "PDF"), act = stream(g, "a", "ACT");
  const add = (src, d, desc, c) => { const n = g.observations.length; g.line("CARD", d, desc, c); from(g, n, src); };
  add(pdf, "2026-12-01", "OPEN", -100); add(act, "2026-12-01", "OPEN", -100);
  add(pdf, "2026-12-22", "BELLPOST FRESH BELMONT", -27450); add(act, "2027-01-04", "BELLPOST FRESH BELMONT VIC", -27450);
  add(pdf, "2026-12-20", "NORDIC WOOL OSLO USD 139.00", -21218); add(act, "2026-12-23", "NORDIC WOOL OSLO USD 139.00", -21904);
  add(pdf, "2027-01-20", "CLOSE", -100); add(act, "2027-01-20", "CLOSE", -100);
  const L = run(g);
  assert.equal(L.events.filter((e) => /BELLPOST/.test(e.description)).length, 1, "thirteen days over Christmas, both streams covering both days");
  assert.equal(L.events.filter((e) => /NORDIC/.test(e.description)).length, 1, "one foreign charge, repriced on the way through");
  assert.ok(L.review.some((r) => r.kind === "restated_line"), "and the disagreement is a question");
});

test("a stranger's name does not make a pair; a transfer with a fee taken off does", () => {
  const two = (n) => household(n).person("kim", "Kim Wolak").person("sam", "Sam Reilly").account("A", "transaction", "cash", [["kim", 10000]], { name: "Harbour Everyday" }).account("B", "transaction", "cash", [["sam", 10000]], { name: "Wattle Saver" });
  let h = two("strangers");
  h.line("A", "2026-05-12", "OSKO TO B NOWAK SECOND HAND BIKE", -40000).line("B", "2026-05-13", "OSKO FROM H WOLAK BIRTHDAY", 40000);
  let L = run(h);
  assert.equal(L.events.filter((e) => e.kind === "transfer").length, 0, "a relative with the family surname is not a member");
  assert.equal(L.cash[0].spending, 40000);
  h = two("fee");
  h.line("A", "2026-06-17", "INTERBANK TFR TO WATTLE", -800000).line("B", "2026-06-18", "TFR FROM HARBOUR", 798200);
  L = run(h);
  assert.equal(L.events.filter((e) => e.kind === "transfer").length, 1);
  assert.equal(L.cash[0].spending, 1800, "only the fee is spending");
  assert.equal(L.balances.at("A", "2026-06"), -800000);
  assert.equal(L.balances.at("B", "2026-06"), 798200);
});

test("a refinance can arrive as a final repayment on the old loan and an opening on the new one, with cash taken out", () => {
  const h = household("refi").person("a").account("BANK", "transaction", "cash", [["a", 10000]], { opening_balance_cents: 5000000, opened_on: "2026-01-01" }).account("OLD", "loan", "loans", [["a", 10000]]).account("NEW", "loan", "loans", [["a", 10000]]);
  h.setup.contract.push({ contract_id: "L1", kind: "loan", name: "Ridge loan", account_id: "OLD" }, { contract_id: "L2", kind: "loan", name: "Harbour loan", account_id: "NEW" });
  const st = (acct, s, e, open, rep, close) => h.obs("loan_statement", { account_ref: acct, period_start: s, period_end: e, opening_cents: open, interest_cents: 0, fees_cents: 0, repayments_cents: rep, redraws_cents: 0, closing_cents: close });
  st("OLD", "2026-01-01", "2026-01-31", 40000000, 200000, 39800000);
  h.line("BANK", "2026-01-15", "RIDGE LOAN REPAYMENT", -200000);
  st("OLD", "2026-02-01", "2026-02-28", 39800000, 39800000, 0);
  h.line("BANK", "2026-02-10", "RIDGE LOAN REPAYMENT", -180000);
  h.line("BANK", "2026-02-14", "WESTPAW LOAN DRAWDOWN 5531", 1500000);
  st("NEW", "2026-03-01", "2026-03-31", 41120000, 0, 41120000);
  const L = run(h);
  assert.equal(L.balances.at("NEW", "2026-01"), 0, "the new loan does not exist before it is drawn");
  assert.equal(L.balances.at("NEW", "2026-03"), -41120000);
  assert.equal(L.balances.at("clearing:loan:OLD", "2026-03"), 0);
  assert.equal(L.cash.find((m) => m.month === "2026-02").income, 0, "cash from a loan is not income");
  assert.equal(L.balances.at("OLD", "2026-03"), 0);
});

test("a HELP debt opens where its first balance says, and a bill paid in two parts clears the assessment", () => {
  const h = household("help").person("a", "Imo Reyes").account("BANK", "transaction", "cash", [["a", 10000]]).account("HELP", "help_debt", "loans", [["a", 10000]]);
  h.obs("help_balance", { person_ref: "a", as_at: "2025-07-01", balance_cents: 2000000 });
  h.obs("tax_assessment", { person_ref: "a", fy: "FY2026", version: 1, assessed_on: "2026-10-08", taxable_income_cents: 9000000, gross_tax_cents: 2000000, payg_credits_cents: 1000000, result_cents: -871153, help_cents: 0 });
  h.line("BANK", "2026-11-05", "BPAY ATO TAX 6610", -435600).line("BANK", "2026-12-03", "BPAY ATO TAX 6610", -435553).line("BANK", "2026-12-20", "SHOPS", -100);
  const L = run(h);
  assert.equal(L.balances.at("HELP", "2026-12"), -2000000);
  assert.ok(!L.review.some((r) => r.kind === "tax_result_unmatched"));
  assert.equal(L.events.filter((e) => e.kind === "tax_payment").length, 2);
  assert.equal(L.cash.find((m) => m.month === "2026-11").spending, 0, "tax paid is not a purchase");
});

test("an agent is an account: what it pays clears what it owes, however it arrives, and rent is income whatever the dictionary calls the agent", () => {
  const h = household("agent").person("a").account("BANK", "offset", "cash", [["a", 10000]]).account("FLAT", "property", "property", [["a", 10000]]).rule("GOLDFIELDS REALTY", "RENT-MGMT");
  h.setup.asset.push({ asset_id: "UNIT", kind: "property", name: "Unit", account_id: "FLAT" });
  h.setup.link.push({ relation: "serves", from_type: "account", from_id: "BANK", to_type: "asset", to_id: "UNIT", valid_from: "2000-01-01", recorded_at: "2000-01-01T00:00:00Z" });
  h.term("asset", "UNIT", "use", "rental", "2000-01-01");
  const os = (s, e, extra = {}) => h.obs("owner_statement", { property_ref: "UNIT", period_start: s, period_end: e, gross_rent_cents: 260000, fees_cents: 13600, disbursed_cents: 246400, ...extra });
  os("2026-01-01", "2026-01-31"); h.line("BANK", "2026-02-03", "GOLDFIELDS REALTY TRUST 7710", 246400);
  // paid thirteen days late
  os("2026-02-01", "2026-02-28"); h.line("BANK", "2026-03-13", "GOLDFIELDS REALTY TRUST 7710", 246400);
  // two credits for one statement, the second a month on
  os("2026-03-01", "2026-03-31"); h.line("BANK", "2026-04-02", "GOLDFIELDS REALTY TRUST 7710", 123400).line("BANK", "2026-05-02", "GOLDFIELDS REALTY TRUST 7710", 123000);
  // a repair inside the fees box, with its own line
  os("2026-04-01", "2026-04-30", { fees_cents: 74840, disbursed_cents: 185160, lines: [{ date: "2026-04-12", description: "Plumber", schedule_line: "Repairs", money_out_cents: 61240 }, { date: "2026-04-30", description: "Management fee", schedule_line: "Management", money_out_cents: 13600 }] });
  h.line("BANK", "2026-05-04", "GOLDFIELDS REALTY TRUST 7710", 185160);
  const L = run(h);
  assert.equal(L.balances.at("clearing:agent:UNIT", "2026-05"), 0, "nothing left in the agent's hands");
  assert.ok(!L.review.some((r) => r.kind === "owner_statement_unmatched"));
  assert.equal(L.cash.find((m) => m.month === "2026-02").income, 246400, "income, not a refund of fees");
  assert.equal(L.accrual.find((m) => m.month === "2026-04").byCategory["RENT-REPAIR"], -61240, "the repair is a repair");
});

test("a US sale lands as a smaller wire, days later; the gap is a cost. A trade whose cash never comes stops counting as owed", () => {
  const h = household("wire").person("a").account("BANK", "transaction", "cash", [["a", 10000]]).account("PLAN", "brokerage", "shares", [["a", 10000]], { fidelity: "snapshot", parent_account_id: "BANK" });
  h.setup.instrument.push({ instrument_id: "ABC", kind: "listed_share", code: "ABC", name: "ABC", currency: "USD" });
  h.obs("holding", { account_ref: "PLAN", instrument_ref: "ABC", as_at: "2026-02-28", units: "100", price: "300.00", value_cents: 3000000 });
  h.obs("contract_note", { account_ref: "PLAN", instrument_ref: "ABC", side: "sell", trade_date: "2026-03-12", settlement_date: "2026-03-14", units: "80", price: "300.00", brokerage_cents: 0, consideration_cents: 2404153 });
  h.line("BANK", "2026-03-20", "ETREAT WIRE USD 15583.05 REF 2026", 2385167);
  h.obs("contract_note", { account_ref: "PLAN", instrument_ref: "ABC", side: "sell", trade_date: "2026-04-28", settlement_date: "2026-04-30", units: "20", price: "300.00", brokerage_cents: 0, consideration_cents: 600000 });
  h.line("BANK", "2026-06-02", "SHOPS", -100);
  const L = run(h);
  assert.equal(L.balances.at("clearing:settle:BANK", "2026-03"), 0, "the wire and its difference clear the sale");
  assert.equal(L.cash.find((m) => m.month === "2026-03").income, 0, "a sale is not income");
  assert.equal(L.cash.find((m) => m.month === "2026-03").unexplained || 0, 0);
  const w = (m) => L.netWorth.find((r) => r.month === m);
  assert.equal(w("2026-04").groups.unsettled, 600000, "owed while settlement is near");
  assert.ok(!w("2026-06").groups.unsettled, "a question, not an asset, long after");
  assert.ok(L.review.some((r) => r.kind === "trade_unsettled"));
});

test("a coin in a wallet with no statement is worth the exchange's price; lots are read per wallet; one deposit can fund two buys", () => {
  const h = household("coin").person("a").account("BANK", "transaction", "cash", [["a", 10000]], { opening_balance_cents: 1000000, opened_on: "2026-01-01" }).account("EX", "crypto_wallet", "crypto", [["a", 10000]], { parent_account_id: "BANK" }).account("COLD", "crypto_wallet", "crypto", [["a", 10000]]);
  h.setup.instrument.push({ instrument_id: "BTC", kind: "crypto", code: "BTC", name: "Bitcoin", currency: "AUD" }, { instrument_id: "ETH", kind: "crypto", code: "ETH", name: "Ether", currency: "AUD" });
  const tx = (p) => h.obs("crypto_txn", { wallet_ref: "EX", quote_asset: "AUD", ...p });
  h.line("BANK", "2026-04-22", "COINPURR AUD DEPOSIT 8841", -400000);
  tx({ time: "2026-04-23T03:12:00Z", type: "buy", asset: "BTC", units: "0.60000000", quote_units: "2487.50", aud_value_cents: 248750, fee_asset: "AUD", fee_units: "12.50", txid: "T1" });
  tx({ time: "2026-04-24T02:41:00Z", type: "buy", asset: "ETH", units: "0.20000000", quote_units: "1492.50", aud_value_cents: 149250, fee_asset: "AUD", fee_units: "7.50", txid: "T2" });
  h.obs("crypto_txn", { wallet_ref: "EX", time: "2026-05-02T00:00:00Z", type: "transfer_out", asset: "BTC", units: "0.40000000", fee_units: "0.00010000", txid: "M1" });
  h.obs("crypto_txn", { wallet_ref: "COLD", time: "2026-05-02T00:10:00Z", type: "transfer_in", asset: "BTC", units: "0.39990000", txid: "M1" });
  h.obs("holding", { account_ref: "EX", instrument_ref: "BTC", as_at: "2026-05-31", units: "0.20000000", price: "5000.00", value_cents: 100000 });
  h.obs("holding", { account_ref: "EX", instrument_ref: "ETH", as_at: "2026-05-31", units: "0.20000000", price: "7000.00", value_cents: 140000 });
  const L = run(h);
  assert.ok(!L.review.some((r) => r.kind === "trade_unsettled"), "the deposit paid for both, fees and all");
  assert.equal(L.cash.find((m) => m.month === "2026-04").spending, 0);
  assert.equal(L.balances.at("COLD", "2026-05"), 199950, "0.3999 at the exchange's price");
  assert.ok(!status(L, "L7").includes("fail"), "each wallet against its own statement");
});

test("a member's accounts count from the day they join, whatever their year-end papers reach back to", () => {
  const h = household("join").person("a").person("tom").account("A", "transaction", "cash", [["a", 10000]], { opening_balance_cents: 100000, opened_on: "2024-01-01" }).account("S", "super", "super", [["tom", 10000]]);
  h.setup.membership.find((m) => m.party_id === "tom").valid_from = "2025-03-24";
  h.obs("super_statement", { account_ref: "S", period_start: "2024-07-01", period_end: "2025-06-30", opening_cents: 16000000, closing_cents: 17000000, employer_cents: 500000, earnings_cents: 500000 });
  h.line("A", "2025-07-02", "SHOPS", -100);
  const L = run(h);
  assert.equal(L.netWorth.find((r) => r.month === "2024-12").total, 100000, "not his yet");
  assert.equal(L.netWorth.find((r) => r.month === "2025-07").total, 100000 - 100 + 17000000);
});

test("a statement that was never downloaded shows, even when its neighbours reach into the month", () => {
  const h = household("gap").person("a").account("CARD", "credit_card", "cash", [["a", 10000]]);
  h.setup.stream.push({ stream_id: "STM", subject_type: "account", subject_id: "CARD", cadence: "monthly", grace_days: 14, valid_from: "2026-01-15", valid_to: null });
  h.setup.stream[0].valid_from = "2025-10-15";
  for (const [s, e] of [["2025-10-15", "2025-11-14"], ["2025-11-15", "2025-12-14"], ["2025-12-15", "2026-01-14"], ["2026-01-15", "2026-02-14"], ["2026-02-15", "2026-03-14"], ["2026-03-15", "2026-04-14"], ["2026-05-15", "2026-06-14"], ["2026-06-15", "2026-07-14"]]) {
    const id = `f${e}`; stream(h, id, "STM"); const n = h.observations.length;
    h.obs("statement", { account_ref: "CARD", period_start: s, period_end: e, opening_cents: -Number(s.slice(5, 7)), closing_cents: -Number(e.slice(5, 7)) }); from(h, n, id);
  }
  const c = run(h, { asOf: "2026-07-20" }).coverage.find((x) => x.stream_id === "STM");
  assert.ok(c.missing.includes("2026-05"), `named: ${c.missing}`);
  assert.ok(c.have < c.expected);
});

test("one childcare debit for two children attaches both statements", () => {
  const h = household("ccs").person("a").account("BANK", "transaction", "cash", [["a", 10000]]).rule("KITTENHOOD", "SHOPPING");
  for (const child of ["Noa", "Ari"]) h.obs("childcare_statement", { provider_ref: "Kittenhood", child_ref: child, period_start: "2026-03-01", period_end: "2026-03-31", gross_fee_cents: 187200, subsidy_cents: 131040, gap_cents: 56160 });
  h.line("BANK", "2026-04-02", "KITTENHOOD ELC", -112320);
  assert.ok(!status(run(h), "L4").includes("fail"));
});

test("a fingerprint is the layout: another row, or a price with a different number of decimals, is the same format", () => {
  const { fingerprint } = require("../../intake/fingerprint");
  const doc = (rows) => ({ meta: { container: "html", title: "Coinpurr holdings" }, lines: [{ page: 1, cells: ["Coinpurr", "Holdings"] }, { page: 1, cells: ["Asset", "Units", "Price", "Value"] }, ...rows.map((cells) => ({ page: 1, cells })) ] });
  const two = doc([["BTC", "0.5", "101,250.00", "50,625.00"], ["ETH", "2.0", "4,410.5", "8,821.00"]]);
  const three = doc([["BTC", "0.5", "101,250.5", "50,625.25"], ["ETH", "2.0", "4,410.25", "8,820.50"], ["SOL", "9.1", "211.00", "1,920.10"]]);
  assert.equal(fingerprint(two), fingerprint(three));
});

test("an asset carried at its opening value and sold leaves nothing behind", () => {
  const h = household("sold").person("a").account("BANK", "transaction", "cash", [["a", 10000]]).account("CAR", "vehicle", "vehicle", [["a", 10000]], { opening_balance_cents: 950000, opened_on: "2024-01-01" });
  h.setup.asset.push({ asset_id: "OLD", kind: "vehicle", name: "Old car", account_id: "CAR" });
  h.line("BANK", "2026-03-05", "CASH DEPOSIT SALE OF CAR", 800000);
  h.decisions.push({ decision_id: "d1", target_type: "line", target_ref: "BANK|2026-03-05|800000", verb: "set_event_kind", value: { event_kind: "asset_disposal", asset_id: "OLD" }, by: "a", at: "2026-03-06T00:00:00Z", status: "accepted" });
  const L = run(h);
  assert.equal(L.balances.at("CAR", "2026-03"), 0);
  assert.equal(L.netWorth.find((r) => r.month === "2026-03").total, 800000);
});

// ---------- shapes the third blind household found. Each failed before its repair. Nothing here reads that household's numbers. ----------
test("a contract says what its money is: a line naming the counterparty takes its category, in the direction it runs", () => {
  const h = household("pension").person("a").org("HESTAbby").account("BANK", "transaction", "cash", [["a", 10000]]);
  h.setup.party.find((p) => p.party_id === "HESTAbby").name = "HESTAbby Super";
  h.setup.contract.push({ contract_id: "ABP", kind: "super_fund", name: "Pension", counterparty_party_id: "HESTAbby", category_id: "SUPER-PENSION" });
  h.line("BANK", "2026-07-14", "HESTABBY PENSION PAYMENT", 110000).line("BANK", "2026-07-15", "HESTABBY ADVICE FEE", -5000);
  const L = run(h);
  assert.equal(L.cash[0].income, 110000, "income with no payslip and no employer");
  assert.equal(L.cash[0].spending, 5000, "a debit to the same party is not negative income");
});

test("every public super recipe reads a pension line", () => {
  for (const [f, code] of [["purrannuation-csv-v1", "Pension Payment"], ["purrannuation-csv-v2", "PENSION"], ["hestabby-app-json", "PENS"]]) {
    const r = JSON.stringify(require(`../../recipes/${f}.json`));
    assert.ok(r.includes(`"${code}":"pension"`), f);
  }
});

test("a fund's own accounts count once, at their own balances, when nothing else stands for the fund", () => {
  const h = household("own-fund").person("a").org("FUND", "smsf");
  h.account("FUNDBANK", "smsf", "super", [["FUND", 10000]]).account("FUNDSHARES", "holding", "super", [["FUND", 10000]]);
  for (const [id, cents] of [["FUNDBANK", 5000000], ["FUNDSHARES", 7000000]]) { const a = h.setup.account.find((x) => x.account_id === id); a.opening_balance_cents = cents; a.opening_date = "2026-07-01"; }
  h.line("FUNDBANK", "2026-07-15", "INTEREST", 0);
  assert.equal(run(h).netWorth.slice(-1)[0].total, 12000000);
});

test("a joint owner who leaves the household takes their share of the account with them", () => {
  const h = household("leaver").person("a").person("b").account("JOINT", "savings", "cash", [["a", 5000], ["b", 5000]], { opening_balance_cents: 1000000, opened_on: "2024-01-01" });
  h.setup.membership.find((m) => m.party_id === "b").valid_to = "2026-03-15";
  h.line("JOINT", "2026-06-01", "SHOPS", -100);
  const L = run(h), at = (m) => L.netWorth.find((r) => r.month === m).total;
  assert.equal(at("2026-02"), 1000000);
  assert.equal(at("2026-04"), 500000);
});

test("a credit larger than anything paid to that merchant is not a refund", () => {
  const h = household("dealer").person("a").account("BANK", "transaction", "cash", [["a", 10000]]);
  h.line("BANK", "2026-03-01", "RIDGE MOTORS SERVICE", -45000).line("BANK", "2026-06-10", "RIDGE MOTORS TRADE IN", 2350000).line("BANK", "2026-06-12", "RIDGE MOTORS SERVICE CREDIT", 5000);
  const m = run(h).cash.find((x) => x.month === "2026-06");
  assert.equal(m.unexplained, 2350000, "a car sold back, not a refund");
  assert.equal(m.spending, -5000, "the small one is");
});

test("a shared word is not evidence of an own transfer; a shared number is", () => {
  const two = (n) => household(n).person("a").account("A", "transaction", "cash", [["a", 10000]]).account("B", "savings", "cash", [["a", 10000]]);
  let h = two("word");
  h.line("A", "2026-04-08", "EFT TO CASTLEMAINE BOWLS CLUB SUBS", -18000).line("B", "2026-04-09", "EFT FROM CASTLEMAINE REALTY TRUST", 18000);
  assert.equal(run(h).events.filter((e) => e.kind === "transfer").length, 0);
  h = two("number");
  h.line("A", "2026-04-08", "BPAY 8841207 BROKER", -18000).line("B", "2026-04-09", "DEPOSIT 8841207", 18000);
  assert.equal(run(h).events.filter((e) => e.kind === "transfer").length, 1);
});

test("interest that an undeclared offset explains fails the rate law, whatever its size", () => {
  const h = household("offset").person("a").account("BANK", "offset", "cash", [["a", 10000]], { opening_balance_cents: 20000000, opened_on: "2026-01-01" }).account("LOAN", "loan", "loans", [["a", 10000]]);
  h.setup.contract.push({ contract_id: "L", kind: "loan", name: "Loan", account_id: "LOAN" });
  h.term("contract", "L", "interest_rate", "6", "2026-01-01");
  h.obs("loan_statement", { account_ref: "LOAN", period_start: "2026-03-01", period_end: "2026-03-31", opening_cents: 30000000, interest_cents: 135000, fees_cents: 0, repayments_cents: 0, redraws_cents: 0, closing_cents: 30135000 });
  assert.ok(status(run(h), "L6").includes("fail"));
});

test("an account in another currency says so; a large credit that reads like a sale asks about the asset", () => {
  const h = household("fx").person("a").account("BANK", "transaction", "cash", [["a", 10000]]).account("UK", "savings", "cash", [["a", 10000]], { currency: "GBP" }).account("HOME", "property", "property", [["a", 10000]], { fidelity: "snapshot" });
  h.setup.asset.push({ asset_id: "H", kind: "property", name: "Home", account_id: "HOME" });
  h.line("UK", "2026-06-01", "INTEREST", 100, 1000000);
  h.line("BANK", "2026-06-02", "LODDON CONVEYANCING TRUST SALE PROCEEDS", 53520586);
  h.obs("valuation", { subject_ref: "HOME", as_at: "2026-01-01", value_cents: 112000000 });
  const L = run(h);
  assert.ok(L.review.some((r) => r.kind === "foreign_currency" && String(r.ref).includes("UK")));
  assert.ok(L.review.some((r) => r.kind === "possible_sale" && String(r.ref).includes("HOME")));
});

test("a dividend paid to a fund's bank account clears there", () => {
  const h = household("fund-div").person("a").org("FUND", "smsf").account("FB", "smsf", "super", [["FUND", 10000]]).account("FBRK", "smsf", "super", [["FUND", 10000]]).account("FSH", "holding", "super", [["FUND", 10000]], { parent_account_id: "FBRK", instrument_id: "ABC" });
  h.setup.instrument.push({ instrument_id: "ABC", kind: "listed_share", code: "ABC", name: "ABC", currency: "AUD" });
  h.obs("dividend", { account_ref: "FBRK", instrument_ref: "ABC", pay_date: "2026-09-20", units: "100", franked_cents: 7500, unfranked_cents: 0, franking_credit_cents: 3214, net_cents: 7500 });
  h.line("FB", "2026-09-20", "ABC FINAL DIV", 7500);
  const L = run(h);
  assert.equal(L.balances.at("clearing:income:FB", "2026-09"), 0);
  assert.ok(!L.review.some((r) => r.kind === "dividend_unpaid"));
});

test("a week of silence on a busy account is named, even with no balance to test it", () => {
  const h = household("silence").person("a").account("BANK", "transaction", "cash", [["a", 10000]]);
  h.setup.stream.push({ stream_id: "BANK", subject_type: "account", subject_id: "BANK", cadence: "monthly", grace_days: 14, valid_from: "2026-05-01", valid_to: null });
  const id = stream(h, "f", "BANK");
  for (let d = 1; d <= 30; d++) { if (d >= 10 && d <= 18) continue; h.line("BANK", `2026-06-${String(d).padStart(2, "0")}`, "SHOPS", -100); }
  from(h, 0, id);
  const c = run(h, { asOf: "2026-08-20" }).coverage.find((x) => x.stream_id === "BANK");
  assert.ok(c.missing.some((m) => /2026-06-09/.test(m)), `named: ${c.missing}`);
  assert.ok(c.have < c.expected);
});

test("money lent to someone goes to the account that holds the debt, and comes back the same way", () => {
  const h = household("lent").person("a", "Sal Whitlock").person("kid", "Karim Whitlock").account("BANK", "transaction", "cash", [["a", 10000]]).account("LOANOUT", "receivable", "loans", [["a", 10000]]);
  h.setup.membership = h.setup.membership.filter((m) => m.party_id !== "kid");
  h.setup.contract.push({ contract_id: "K", kind: "loan", name: "Loan to Karim", counterparty_party_id: "kid", account_id: "LOANOUT" });
  h.line("BANK", "2026-03-12", "OSKO TO K WHITLOCK HOUSE LOAN", -2000000).line("BANK", "2026-04-12", "OSKO FROM K WHITLOCK LOAN", 30000);
  const L = run(h);
  assert.equal(L.balances.at("LOANOUT", "2026-04"), 1970000);
  assert.equal(L.cash.find((m) => m.month === "2026-03").spending, 0);
  assert.equal(L.cash.find((m) => m.month === "2026-04").income, 0);
});

// ---------- a share house: one lease, two flatmates who pay the leaseholder their share ----------
// Sam is the only name on the lease and pays the agent $2,400 a fortnight. Robin and Alex each pay Sam $800 a fortnight. Their money crosses Sam's rails (SPEC 4.4c):
// it is not Sam's income, and it is not Sam's rent. Sam's own cost is one third. A person says so with a rule for each flatmate and a split of each rent line.
const shareHouse = (alexPays) => {
  const h = household("sharehouse").person("sam").account("BANK", "transaction", "cash", [["sam", 10000]]);
  h.setup.party.push({ party_id: "robin", kind: "person", name: "Robin" }, { party_id: "alex", kind: "person", name: "Alex" });
  h.rule("RENT TO AGENT", "HOUSING").rule("ROBIN RENT SHARE", "PASS-THROUGH", { person: "robin" }).rule("ALEX RENT SHARE", "PASS-THROUGH", { person: "alex" });
  ["2026-07-02", "2026-07-16", "2026-07-30"].forEach((day, i) => {
    h.line("BANK", day, "RENT TO AGENT", -240000).line("BANK", day, "ROBIN RENT SHARE", 80000);
    if (alexPays > i) h.line("BANK", day, "ALEX RENT SHARE", 80000);
    h.decisions.push({ decision_id: `split${i}`, target_type: "line", target_ref: `BANK|${day}|-240000`, verb: "split", by: "sam", at: "2026-08-01T00:00:00Z", status: "accepted",
      value: { parts: [{ amount_cents: -80000, category_id: "HOUSING" }, { amount_cents: -80000, category_id: "PASS-THROUGH", person: "robin" }, { amount_cents: -80000, category_id: "PASS-THROUGH", person: "alex" }] } });
  });
  return h;
};

test("a share house: the flatmates' fortnightly share is not income, and the rent costs the leaseholder only their own third", () => {
  const L = run(shareHouse(3));
  assert.equal(L.cash[0].income, 0, "a flatmate's money is not income");
  assert.equal(L.cash[0].spending, 240000, "three rents of 2,400 cost Sam three shares of 800, not 7,200");
  assert.equal(L.cash[0].net, -240000, "and the net says what the bank did");
  assert.equal(L.cash[0].unexplained, 0);
  assert.deepEqual(L.accrual[0].byCategory, { HOUSING: -240000 }, "the economic lens holds Sam's third and nothing else");
  assert.equal(L.balances.at("receivable:robin", "2026-07"), 0, "what Sam paid for Robin, and what Robin paid back, meet");
  assert.equal(L.balances.at("receivable:alex", "2026-07"), 0);
  assert.equal(L.netWorth[0].total, -240000, "net worth fell by what the rent cost Sam");
  assert.equal(L.review.length, 0);
  assert.ok(!L.checks.some((c) => c.status === "fail"), JSON.stringify(L.checks.filter((c) => c.status === "fail")));
});

test("a flatmate who has not paid yet owes the leaseholder by name; it is not rent and not income", () => {
  const L = run(shareHouse(2));
  assert.equal(L.cash[0].spending, 240000, "Sam's cost is still his third of each rent");
  assert.equal(L.cash[0].income, 0);
  assert.equal(L.balances.at("receivable:alex", "2026-07"), 80000, "Alex owes one fortnight");
  assert.equal(L.balances.at("receivable:robin", "2026-07"), 0);
});

// ---------- round four: what the fourth blind household left, and shapes from a read-only rehearsal on a real household. Fictional cases, no real data. ----------
test("a long ordered rule list stays cheap, and changes nothing", () => {
  const build = (rules) => {
    const h = household("rules").person("a").account("BANK", "transaction", "cash", [["a", 10000]]);
    for (let i = 0; i < rules; i++) h.rule(`NOT THIS ONE ${i}`, "SHOPPING", { priority: 200 - i });
    h.rule("CORNER STORE", "GROCERIES", { priority: 1 });
    for (let i = 0; i < 13000; i++) { const d = String(1 + (i % 28)).padStart(2, "0"), m = String(1 + (i % 12)).padStart(2, "0"); h.line("BANK", `2025-${m}-${d}`, `CORNER STORE ${i % 400}`, -100 - (i % 50)); }
    return h;
  };
  const timed = (h) => { const t0 = Date.now(), L = run(h); return { L, ms: Date.now() - t0 }; };
  const few = timed(build(0)), many = timed(build(150));
  assert.ok(many.ms < few.ms * 3 + 500, `150 rules ${many.ms}ms against ${few.ms}ms with one: a long list used to cost 26 times over`);
  assert.equal(many.L.bundleHash, few.L.bundleHash, "same answer");
});

test("a rule can read one direction: the same word is a refund as a credit and a purchase as a debit", () => {
  const h = household("dir").person("a").account("BANK", "transaction", "cash", [["a", 10000]]).rule("ACME", "SHOPPING", { direction: "debit" }).rule("ACME", "INTEREST", { direction: "credit" });
  h.line("BANK", "2026-07-01", "ACME STORE", -5000).line("BANK", "2026-07-02", "ACME STORE", 700);
  const L = run(h);
  assert.equal(L.cash[0].spending, 5000);
  assert.equal(L.cash[0].income, 700);
});

test("a lodged year known only by taxable income and result is stored, shown partial, and asks nothing", () => {
  const h = household("old").person("a").account("BANK", "transaction", "cash", [["a", 10000]]);
  h.line("BANK", "2026-07-02", "SHOPS", -100);
  h.obs("tax_assessment", { person_ref: "a", fy: "FY2015", version: 1, assessed_on: "2015-10-01", taxable_income_cents: 7000000, result_cents: 120000 });
  const L = run(h);
  assert.ok(!L.review.some((r) => /unreadable|tax_result/.test(r.kind)), JSON.stringify(L.review.map((r) => r.kind)));
  assert.equal(L.returns.returns[0].status, "partial");
  assert.ok(!status(L, "L4").includes("fail"));
});

test("a vest table with units only and cancelled tranches is held, posts no income, and fails no law", () => {
  const h = household("units").person("a").account("PLAN", "brokerage", "shares", [["a", 10000]]);
  h.setup.instrument.push({ instrument_id: "ACM", kind: "rsu", code: "ACM", name: "Acme", currency: "USD" });
  h.setup.contract.push({ contract_id: "G", kind: "ess_plan", name: "Grant", holder_party_id: "a", account_id: "PLAN" });
  for (let i = 0; i < 10; i++) h.obs("vest", { plan_ref: "G", person_ref: "a", instrument_ref: "ACM", vest_date: `2026-0${(i % 9) + 1}-15`, units: "10", ...(i < 4 ? { status: "cancelled" } : {}) });
  const L = run(h);
  assert.ok(!L.review.some((r) => r.kind === "unreadable_observation"));
  assert.equal(L.events.filter((e) => e.kind === "vest").length, 0, "no income without a value");
  assert.ok(!status(L, "L4").includes("fail"));
  assert.equal(L.review.filter((r) => r.kind === "vest_without_value").length, 1, "one question, for the grant");
});

test("one return label on two properties ties by property, and a move between them fails both", () => {
  const build = (a, b) => {
    const h = household("two-rentals").person("a").org("AG").account("BANK", "offset", "cash", [["a", 10000]]).account("F1", "property", "property", [["a", 10000]]).account("F2", "property", "property", [["a", 10000]]);
    h.setup.asset.push({ asset_id: "A1", kind: "property", name: "One", account_id: "F1" }, { asset_id: "A2", kind: "property", name: "Two", account_id: "F2" });
    h.setup.tax_map.push({ selector_type: "category", selector: "RENT-INC", label: "21P", treatment: "income", basis: "ownership", valid_from: "2000-01-01" });
    h.term("asset", "A1", "use", "rental", "2000-01-01"); h.term("asset", "A2", "use", "rental", "2000-01-01");
    for (const id of ["A1", "A2"]) for (const basis of ["legal", "beneficial", "tax"]) h.setup.ownership.push({ subject_type: "asset", subject_id: id, party_id: "a", basis, share_bps: 10000, valid_from: "2000-01-01", valid_to: null, recorded_at: "2000-01-01T00:00:00Z", superseded_at: null });
    for (const [id, gross] of [["A1", 1000000], ["A2", 500000]]) h.obs("owner_statement", { property_ref: id, period_start: "2025-07-01", period_end: "2026-06-30", gross_rent_cents: gross, fees_cents: 0, disbursed_cents: 0 });
    h.obs("tax_assessment", { person_ref: "a", fy: "FY2026", version: 1, assessed_on: "2026-09-20", taxable_income_cents: 1500000, gross_tax_cents: 0, payg_credits_cents: 0, result_cents: 0, labels: [{ label: "21P", amount_cents: a, role: "leaf", asset_ref: "A1" }, { label: "21P", amount_cents: b, role: "leaf", asset_ref: "A2" }] });
    return run(h).checks.filter((c) => c.law === "L11" && /labels/.test(c.scope));
  };
  assert.equal(build(1000000, 500000).length, 0, "both right");
  assert.equal(build(800000, 700000)[0].status, "fail", "the total still ties, and the split does not");
});

test("a card's posted reading and total reading each tie, and a payment counts once", () => {
  const h = household("card-basis").person("a").account("CARD", "credit_card", "cash", [["a", 10000]], { opening_balance_cents: -100000, opened_on: "2026-07-01" }).rule("PAYMENT", "TRANSFER");
  h.line("CARD", "2026-07-03", "SHOPS", -2000).line("CARD", "2026-07-10", "PAYMENT RECEIVED", 50000).line("CARD", "2026-07-20", "SHOPS", -2000);
  h.obs("balance", { account_ref: "CARD", as_at: "2026-07-05", balance_cents: -102000 });
  h.obs("balance", { account_ref: "CARD", as_at: "2026-07-11", balance_cents: -102000, balance_kind: "ledger" });
  h.obs("balance", { account_ref: "CARD", as_at: "2026-07-11", balance_cents: -52000, balance_kind: "total" });
  h.obs("balance", { account_ref: "CARD", as_at: "2026-07-25", balance_cents: -54000 });
  assert.ok(!status(run(h), "L3").includes("fail"));
});

test("a reading taken partway through a day ties to the ledger before the afternoon's lines; a blank closing balance is not a contradiction", () => {
  const h = household("midday").person("a").account("BANK", "transaction", "cash", [["a", 10000]], { opening_balance_cents: 100000, opened_on: "2026-07-01" });
  h.line("BANK", "2026-07-05", "SHOPS", -1000).line("BANK", "2026-07-10", "CAFE", -500).line("BANK", "2026-07-10", "DINNER", -700).line("BANK", "2026-07-20", "SHOPS", -1000);
  h.obs("balance", { account_ref: "BANK", as_at: "2026-07-05", balance_cents: 99000 });
  h.obs("balance", { account_ref: "BANK", as_at: "2026-07-10", balance_cents: 99000, sequence: 1 });
  h.obs("balance", { account_ref: "BANK", as_at: "2026-07-25", balance_cents: 96800 });
  assert.ok(!status(run(h), "L3").includes("fail"));
  const g = household("sweep").person("a").account("BANK", "transaction", "cash", [["a", 10000]], { opening_balance_cents: 50000, opened_on: "2026-07-01" });
  g.line("BANK", "2026-07-05", "SHOPS", -1000, 49000).line("BANK", "2026-07-30", "FEE", -500, 48500).line("BANK", "2026-07-30", "CLOSING SWEEP", -48500);
  g.obs("balance", { account_ref: "BANK", as_at: "2026-07-31", balance_cents: 0 });
  assert.ok(!status(run(g), "L3").includes("fail"));
});

test("a loan advance paid straight to a seller moves the loan, and asks", () => {
  const h = household("advance").person("a").account("LOAN", "loan", "loans", [["a", 10000]]);
  h.setup.contract.push({ contract_id: "L", kind: "loan", name: "Loan", account_id: "LOAN" });
  h.obs("loan_statement", { account_ref: "LOAN", period_start: "2026-07-01", period_end: "2026-07-31", opening_cents: 0, interest_cents: 0, fees_cents: 0, repayments_cents: 0, redraws_cents: 50000000, closing_cents: 50000000 });
  const L = run(h);
  assert.equal(L.balances.at("LOAN", "2026-07"), -50000000);
  assert.ok(!status(L, "L3").includes("fail"));
  assert.ok(L.review.some((r) => r.kind === "loan_redraw_unmatched"));
});

test("a card paid from outside the household's accounts settles with one rule, and the clearing account clears", () => {
  const h = household("outside").person("a").person("b", "Bo Reid").account("CARD", "credit_card", "cash", [["a", 10000]]);
  h.setup.membership = h.setup.membership.filter((m) => m.party_id !== "b");
  for (const d of ["01", "08", "15"]) h.line("CARD", `2026-07-${d}`, "PAYMENT RECEIVED THANK YOU", 20000);
  h.line("CARD", "2026-07-02", "SHOPS", -60000).rule("PAYMENT RECEIVED", "PASS-THROUGH", { person: "b" }).rule("SHOPS", "SHOPPING");
  const L = run(h);
  assert.ok(!L.checks.some((c) => c.law === "L2" && c.status === "fail"));
  assert.equal(L.cash[0].income, 0);
});

test("a row with no amount is evidence, not an orphan; an odd billing cycle annualises", () => {
  const h = household("small").person("a").account("BANK", "transaction", "cash", [["a", 10000]], { opening_balance_cents: 100000, opened_on: "2026-01-01" });
  h.line("BANK", "2026-07-01", "SHOPS", -100).line("BANK", "2026-07-01", "NARRATIVE: DISBURSAL TO VENDOR", 0);
  h.setup.contract.push({ contract_id: "S", kind: "utility", name: "Water", started_on: "2026-01-01" });
  h.term("contract", "S", "price_cents", "15000", "2026-01-01"); h.term("contract", "S", "billing_months", "3.5", "2026-01-01");
  const L = run(h);
  assert.ok(!status(L, "L4").includes("fail"));
  assert.equal(V.billsCommitted(L, "2026-07").rows.find((r) => r.contract_id === "S").monthly_cents, Math.round(15000 / 3.5));
});

test("an employer in setup beats a dictionary guess, and a contract is not the only meaning of its counterparty", () => {
  const Engine = require("../../../src/engine.js");
  Engine.loadMerchants({ merchants: require("../../../merchants/merchants.json"), categories: require("../../../merchants/categories.json") });
  try {
    const h = household("job").person("a").org("WYNDHAM CITY COUNCIL").account("BANK", "transaction", "cash", [["a", 10000]]);
    h.setup.category.push({ category_id: "RATES-HOME", name: "Rates", kind: "expense", cash_lens: true, economic_lens: true });
    h.setup.contract.push({ contract_id: "J", kind: "employment", name: "Crossing", counterparty_party_id: "WYNDHAM CITY COUNCIL", holder_party_id: "a", category_id: "SALARY" });
    h.line("BANK", "2026-07-14", "WYNDHAM CITY COUNCIL PAY", 35476);
    assert.equal(run(h).events[0].category_id, "SALARY");
  } finally { Engine.loadMerchants({ merchants: { merchants: [] }, categories: {} }); }
  const g = household("bond").person("a").org("Lee Agency").account("BANK", "transaction", "cash", [["a", 10000]]);
  g.setup.contract.push({ contract_id: "R", kind: "lease", name: "Rent", counterparty_party_id: "Lee Agency", category_id: "HOUSING" });
  g.term("contract", "R", "price_cents", "84000", "2020-01-01");
  g.line("BANK", "2026-07-03", "LEE AGENCY RENT", -84000).line("BANK", "2026-07-04", "LEE AGENCY BOND", -286000);
  const L = run(g);
  assert.equal(L.events.filter((e) => e.category_id === "HOUSING").length, 1, "rent is rent");
  assert.ok(L.review.some((r) => r.kind === "uncategorised" && /BOND/.test(r.what)), "a bond is a question");
});

test("a fee is small: a line a quarter away is not a transfer with a fee", () => {
  const h = household("feecap").person("a", "Ren Tam").account("A", "transaction", "cash", [["a", 10000]]).account("B", "savings", "cash", [["a", 10000]]);
  h.line("A", "2026-07-02", "OSKO TO R TAM LOAN", -10000).line("B", "2026-07-03", "OSKO FROM CUSTOMER 88", 7604);
  const L = run(h);
  assert.equal(L.events.filter((e) => e.kind === "transfer").length, 0);
});

test("two prices at one shop are two purchases; a repriced line needs a foreign charge or a rounding", () => {
  const h = household("shop").person("a").account("CARD", "credit_card", "cash", [["a", 10000]]);
  const pdf = stream(h, "p", "PDF"), csv = stream(h, "c", "CSV");
  const add = (src, d, desc, c) => { const n = h.observations.length; h.line("CARD", d, desc, c); from(h, n, src); };
  add(pdf, "2026-07-01", "OPEN", -100); add(csv, "2026-07-01", "OPEN", -100);
  add(pdf, "2026-07-03", "TOOLERN PROVISIONS", -12140); add(csv, "2026-07-12", "TOOLERN PROVISIONS", -11795);
  add(pdf, "2026-07-30", "CLOSE", -100); add(csv, "2026-07-30", "CLOSE", -100);
  assert.equal(run(h).events.filter((e) => /TOOLERN/.test(e.description)).length, 2);
});

test("money borrowed from a person sits on the account that holds the debt, and a joint owner who was never a member was never ours", () => {
  const h = household("mum").person("a", "Ren Tam").account("BANK", "transaction", "cash", [["a", 10000]]).account("MUM", "loan", "loans", [["a", 10000]]);
  h.setup.party.push({ party_id: "m", kind: "person", name: "Rua Tam" });
  h.setup.contract.push({ contract_id: "M", kind: "loan", name: "From Mum", counterparty_party_id: "m", account_id: "MUM" });
  h.line("BANK", "2026-03-01", "OSKO FROM R TAM LOAN", 500000).line("BANK", "2026-04-01", "OSKO TO R TAM LOAN", -10000);
  let L = run(h);
  assert.equal(L.balances.at("MUM", "2026-04"), -490000);
  assert.equal(L.cash.find((m) => m.month === "2026-04").spending, 0);
  const g = household("ex").person("a").account("J", "savings", "cash", [["a", 5000], ["x", 5000]], { opening_balance_cents: 200000, opened_on: "2026-01-01" });
  g.setup.party.push({ party_id: "x", kind: "person", name: "Former Partner" });
  g.line("J", "2026-02-01", "INTEREST", 0);
  L = run(g);
  assert.equal(L.netWorth.slice(-1)[0].total, 100000);
});

test("a super line no recipe maps is still read: the file is not refused, and the balance moves with a question", () => {
  for (const f of ["purrannuation-csv-v1", "purrannuation-csv-v2", "hestabby-app-json"]) assert.ok(JSON.stringify(require(`../../recipes/${f}.json`)).includes('"*":"other"'), f);
  const h = household("listo").person("a").account("S", "super", "super", [["a", 10000]], { opening_balance_cents: 100000, opened_on: "2026-01-01" });
  h.obs("super_line", { account_ref: "S", posting_date: "2026-03-01", line_type: "government", description: "LISTO", amount_cents: 41250 });
  h.obs("super_line", { account_ref: "S", posting_date: "2026-04-01", line_type: "other", description: "ZZ-CODE", amount_cents: 5000 });
  const L = run(h);
  assert.equal(L.balances.at("S", "2026-04"), 146250);
  assert.equal(L.review.filter((r) => r.kind === "unknown_super_line").length, 1, "only the unknown one asks");
});

test("what a flatmate owes rings as an open item with a name", () => {
  const L = run(shareHouse(2));
  const c = L.checks.find((x) => x.law === "L2" && x.scope === "receivable:alex");
  assert.equal(c.status, "open");
  assert.ok(L.review.some((r) => r.ref === "receivable:alex"));
});

test("a tab that only shares words like date and amount reads as unknown, not as a table", () => {
  const { conformTabs } = require("../../tools/conform");
  const rows = conformTabs({ Reservations: ["Date", "Amount", "Notes", "Who for"], People: ["Name", "Email", "Notes", "Source"], Accounts: ["account_id", "name", "class", "type", "currency"] });
  const by = Object.fromEntries(rows.map((r) => [r.tab, r]));
  assert.equal(by.Reservations.maps_to, null);
  assert.equal(by.People.maps_to, null);
  assert.equal(by.Accounts.maps_to, "account");
});

test("a household can project across two workbooks: the manifest lists both and the answer does not move", () => {
  const { toBundle } = require("../../engine/bundle");
  const h = household("two-books").person("a").account("BANK", "transaction", "cash", [["a", 10000]]).rule("SHOPS", "SHOPPING");
  h.line("BANK", "2026-07-01", "SHOPS", -100);
  const L = run(h), tablesSchema = require("../../schema/tables.json");
  const one = toBundle(L, { setup: h.setup, tablesSchema });
  const two = toBundle(L, { setup: h.setup, tablesSchema, workbooks: [{ name: "household", tables: ["account", "party"] }, { name: "ledger", tables: ["event", "posting"] }] });
  assert.equal(two.manifest.bundle_hash, one.manifest.bundle_hash);
  assert.deepEqual(two.manifest.tables.event.workbooks.map((w) => w.name), ["ledger"]);
  assert.deepEqual(two.manifest.tables.account.workbooks.map((w) => w.name), ["household"]);
  assert.deepEqual(two.manifest.tables.rule.workbooks.map((w) => w.name), ["household"], "a table no workbook names stays in the first");
  assert.equal(two.tables.event, one.tables.event);
});

test("labels that sit on rows migrate as decisions, and the tool says how many bound", () => {
  const { labelsToDecisions } = require("../../tools/migrate-labels");
  const h = household("labelled").person("a").account("BANK", "transaction", "cash", [["a", 10000]]);
  h.line("BANK", "2026-07-01", "TFR 1188", -50000).line("BANK", "2026-07-02", "CAFE", -700).line("BANK", "2026-07-02", "CAFE", -700).line("BANK", "2026-07-03", "THE WEIRD ONE", -1200);
  const before = run(h);
  assert.equal(before.cash[0].spending, 52600, "with no labels every line reads as spending");
  const { decisions, bound, unbound } = labelsToDecisions(before, [
    { account: "BANK", date: "2026-07-01", cents: -50000, category_id: "TRANSFER" },
    { account: "BANK", date: "2026-07-02", cents: -700, category_id: "SHOPPING" },
    { account: "BANK", date: "2026-07-02", cents: -700, category_id: "GROCERIES" },
    { account: "BANK", date: "2026-07-03", cents: -1200, category_id: "SHOPPING" },
    { account: "BANK", date: "2026-07-09", cents: -999, category_id: "SHOPPING" },
  ]);
  assert.deepEqual([bound, unbound.length], [4, 1], "one label finds no line, and it is counted");
  const after = run({ ...h, decisions });
  assert.equal(after.cash[0].spending, 2600, "the transfer leaves spending");
  assert.equal(after.cash[0].byCategory.GROCERIES, -700, "two equal lines keep their own labels");
  assert.equal(after.review.filter((r) => r.kind === "uncategorised").length, 0);
});

// ---------- the company: what the fifth blind household found. No new table: party, contract and account hold it. ----------
const company = () => {
  const h = household("company").person("l", "Luka Novak").person("m", "Marisol Bautista").org("CO", "company").account("BANK", "offset", "cash", [["l", 10000]]).account("LENT", "receivable", "loans", [["l", 10000]]);
  h.setup.party.find((p) => p.party_id === "CO").name = "Novak Electrical Pty Ltd";
  h.setup.contract.push({ contract_id: "JOB", kind: "employment", name: "At the company", counterparty_party_id: "CO", holder_party_id: "l", category_id: "SALARY" }, { contract_id: "LOAN", kind: "loan", name: "Loan to the company", counterparty_party_id: "CO", account_id: "LENT" });
  return h;
};

test("the household's own company is not a tradesman: a dictionary guess gives way to a question", () => {
  const Engine = require("../../../src/engine.js");
  Engine.loadMerchants({ merchants: require("../../../merchants/merchants.json"), categories: require("../../../merchants/categories.json") });
  try {
    const h = company();
    h.setup.category.push({ category_id: "HOME-MAINT", name: "Home maintenance", kind: "expense", cash_lens: true, economic_lens: true });
    h.line("BANK", "2026-03-11", "NOVAK ELECTRICAL PTY LTD RECALL", -185293);
    const L = run(h);
    assert.ok(!L.events.some((e) => e.category_id === "HOME-MAINT"), "not a quiet repair");
    assert.ok(L.review.some((r) => r.kind === "uncategorised" && /RECALL/.test(r.what)));
  } finally { Engine.loadMerchants({ merchants: { merchants: [] }, categories: {} }); }
});

test("one payer, an employer and a borrower: a line saying loan moves the loan, and pay stays pay", () => {
  const h = company();
  h.line("BANK", "2026-01-18", "TFR TO NOVAK ELECTRICAL LOAN", -3000000).line("BANK", "2026-02-15", "NOVAK ELECTRICAL LOAN REPAYMENT", 500000).line("BANK", "2026-02-28", "NOVAK ELECTRICAL WAGES", 300000);
  const L = run(h);
  assert.equal(L.balances.at("LENT", "2026-02"), 2500000);
  assert.equal(L.cash.find((m) => m.month === "2026-01").spending, 0);
  assert.equal(L.cash.find((m) => m.month === "2026-02").income, 300000, "only the pay is income");
});

test("a lender's name inside two people's names is not a loan payment", () => {
  const h = household("names").person("l", "Luka Novak").account("BANK", "transaction", "cash", [["l", 10000]]).account("BROTHER", "loan", "loans", [["l", 10000]]);
  h.setup.party.push({ party_id: "b", kind: "person", name: "Milan Novak" });
  h.setup.contract.push({ contract_id: "B", kind: "loan", name: "Loan from Milan", counterparty_party_id: "b", account_id: "BROTHER" });
  h.line("BANK", "2026-03-01", "OSKO TO L AND M NOVAK BILLS", -40000).line("BANK", "2026-03-02", "OSKO FROM M NOVAK LOAN", 500000);
  const L = run(h);
  assert.equal(L.balances.at("BROTHER", "2026-03"), -500000, "the top-up is not on the loan");
});

test("an asset closed in setup is gone from its closing day; lines long after an account closed are held out and asked about", () => {
  const h = household("closed").person("a").account("BANK", "transaction", "cash", [["a", 10000]], { opening_balance_cents: 100000, opened_on: "2026-01-01" }).account("BOAT", "vehicle", "vehicle", [["a", 10000]], { fidelity: "snapshot", closed_on: "2026-05-20" }).account("OLD", "transaction", "cash", [["a", 10000]], { closed_on: "2026-03-31" });
  h.setup.asset.push({ asset_id: "B", kind: "vehicle", name: "Boat", account_id: "BOAT" });
  h.obs("valuation", { subject_ref: "BOAT", as_at: "2026-01-31", value_cents: 1800000, method: "estimate" });
  h.line("BANK", "2026-06-01", "SHOPS", -100).line("OLD", "2026-03-30", "LAST FEE", -500);
  stream(h, "stray", "OLD");
  const n = h.observations.length;
  h.line("OLD", "2026-06-02", "CUSTOMER PAYMENT 1", 96283).line("OLD", "2026-06-10", "CUSTOMER PAYMENT 2", 241185);
  from(h, n, "stray");
  const L = run(h), at = (m) => L.netWorth.find((r) => r.month === m).total;
  assert.equal(L.balances.at("OLD", "2026-06"), -500, "the stray lines are not posted");
  assert.equal(L.review.filter((r) => r.kind === "lines_after_close").length, 1, "one question for the file");
  assert.ok(!status(L, "L4").includes("fail"));
  assert.equal(at("2026-04") - at("2026-06"), 1800000 + 100, "the boat leaves net worth");
});

test("a credit far above anything paid to that payee is not a refund, whatever a contract says", () => {
  const h = household("insurer").person("a").org("Purrsure").account("BANK", "transaction", "cash", [["a", 10000]]);
  h.setup.contract.push({ contract_id: "I", kind: "insurance", name: "Car", counterparty_party_id: "Purrsure", category_id: "SHOPPING" });
  for (const m of ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"]) h.line("BANK", `2025-${m}-05`, "PURRSURE PREMIUM", -10000);
  h.line("BANK", "2025-12-19", "PURRSURE CLAIM PAYOUT", 670417);
  const m = run(h).cash.find((x) => x.month === "2025-12");
  assert.equal(m.unexplained, 670417);
  assert.equal(m.spending, 10000);
});

test("two contracts with one insurer: its name alone does not say which", () => {
  const h = household("two-policies").person("a").org("Purrsure").account("BANK", "transaction", "cash", [["a", 10000]]);
  h.setup.contract.push({ contract_id: "C", kind: "insurance", name: "Home", counterparty_party_id: "Purrsure", category_id: "HOUSING" }, { contract_id: "D", kind: "insurance", name: "Income protection", counterparty_party_id: "Purrsure", category_id: "SHOPPING" });
  h.line("BANK", "2025-12-01", "PURRSURE DIRECT DEBIT", -9000);
  const L = run(h);
  assert.ok(L.review.some((r) => r.kind === "uncategorised"), "a question, not the first contract's category");
});

// ---------- what the household pack found in the tax draft, written as fictional cases ----------
const payslip = (h, who, employer, date, gross) => h.obs("payslip", { person_ref: who, employer_ref: employer, pay_date: date, gross_cents: gross, tax_cents: Math.round(gross / 5), net_cents: gross - Math.round(gross / 5), super_cents: 0 });
test("a held income statement replaces only its own employer's payslips", () => {
  const h = household("two-jobs").person("a").org("BIG").org("AGENCY").account("BANK", "transaction", "cash", [["a", 10000]]);
  payslip(h, "a", "BIG", "2025-09-10", 500000); payslip(h, "a", "AGENCY", "2025-10-10", 200000); payslip(h, "a", "AGENCY", "2025-11-10", 368800);
  h.obs("income_statement", { person_ref: "a", employer_ref: "BIG", fy: "FY2026", period_end: "2026-06-30", gross_cents: 520000, tax_cents: 104000, finalised: true });
  const item = run(h).tax.items.find((i) => i.party_id === "a" && i.fy === "FY2026" && i.label === "1");
  assert.equal(item.amount_cents, 520000 + 568800, "the agency's payslips stay");
});

test("a household with no tax map still reaches the labels the standard knows", () => {
  const h = household("no-map").person("a").account("BANK", "transaction", "cash", [["a", 10000]]).rule("BANK INTEREST", "INTEREST").rule("PENSION", "SUPER-PENSION");
  h.line("BANK", "2025-09-01", "BANK INTEREST", 12300).line("BANK", "2025-09-02", "PENSION PAYMENT", 100000);
  const items = run(h).tax.items.filter((i) => i.fy === "FY2026");
  assert.equal((items.find((i) => i.label === "10") || {}).amount_cents, 12300, "interest");
  assert.equal((items.find((i) => i.label === "7") || {}).amount_cents, 100000, "a pension reaches a label");
});

test("a bill binds to a payment that names its issuer, not to one that merely shares the amount", () => {
  const h = household("bill").person("a").account("BANK", "transaction", "cash", [["a", 10000]]).account("FLAT", "property", "property", [["a", 10000]]).rule("MECHANIC", "SHOPPING").rule("BALLARAT", "HOUSING");
  h.setup.asset.push({ asset_id: "U", kind: "property", name: "Unit", account_id: "FLAT" });
  h.line("BANK", "2026-03-01", "MECHANIC SERVICE", -45500).line("BANK", "2026-03-03", "BPAY BALLARAT COUNCIL", -45500);
  h.obs("bill", { issuer_ref: "Ballarat Council", bill_date: "2026-02-10", due_on: "2026-03-05", amount_cents: 45500, subject_ref: "U" });
  const L = run(h);
  assert.equal(L.events.find((e) => /MECHANIC/.test(e.description)).asset_id, null, "the car service stays where it was");
  assert.equal(L.events.find((e) => /BALLARAT/.test(e.description)).asset_id, "U");
});

test("an offset rounds by the decimal rule, not by binary", () => {
  const { lito } = require("../../engine/tax");
  assert.equal(lito(6439900, { max: 700, tiers: [{ from: 37500, to: 45000, rate: 0.05 }, { from: 45000, to: 66667, rate: 0.015 }] }), 3402, "34.015 rounds to 34.02");
});

test("the CGT discount is read from the reference, and a label the draft has and the return left out does not pass", () => {
  const h = household("gain").person("a").account("BRK", "brokerage", "shares", [["a", 10000]]).account("BANK", "transaction", "cash", [["a", 10000]]).rule("BANK INTEREST", "INTEREST");
  h.setup.instrument.push({ instrument_id: "ABC", kind: "listed_share", code: "ABC", name: "ABC", currency: "AUD" });
  h.setup.tax_map.push({ selector_type: "category", selector: "INTEREST", label: "10", treatment: "income", basis: "ownership", valid_from: "2000-01-01" });
  h.obs("contract_note", { account_ref: "BRK", instrument_ref: "ABC", side: "buy", trade_date: "2023-08-01", settlement_date: "2023-08-03", units: "100", price: "10.00", brokerage_cents: 0, consideration_cents: 100000 });
  h.obs("contract_note", { account_ref: "BRK", instrument_ref: "ABC", side: "sell", trade_date: "2025-08-01", settlement_date: "2025-08-03", units: "100", price: "20.00", brokerage_cents: 0, consideration_cents: 200000 });
  h.line("BRK", "2023-08-03", "BUY", -100000).line("BRK", "2025-08-03", "SELL", 200000).line("BANK", "2025-09-01", "BANK INTEREST", 5000);
  h.obs("tax_assessment", { person_ref: "a", fy: "FY2026", version: 1, assessed_on: "2026-09-20", taxable_income_cents: 80000, gross_tax_cents: 0, payg_credits_cents: 0, result_cents: 0, labels: [{ label: "18A", amount_cents: 75000, role: "leaf" }] });
  const reference = { series: { cgt_discount_individual: { rows: [{ valid_from: "1999-09-21", valid_to: null, value: { rate: 0.25 } }] } } };
  const L = run(h, { reference });
  assert.equal(L.tax.items.find((i) => i.label === "18A" && i.fy === "FY2026").amount_cents, 75000, "a quarter off, as the reference says");
  const tie = L.checks.find((c) => c.law === "L11" && /labels/.test(c.scope));
  assert.ok(tie && /10/.test(tie.detail), "interest of 50.00 is on the draft and not on the return");
});

// ---------- round six: a crash from a real shape, and what the sixth blind household found. Fictional cases. ----------
test("two equal advances on one day, or a row with no amount on a loan, never stop a rebuild", () => {
  const h = household("twins").person("a").account("LOAN", "loan", "loans", [["a", 10000]]);
  h.setup.contract.push({ contract_id: "L", kind: "loan", name: "Loan", account_id: "LOAN" });
  h.line("LOAN", "2026-07-01", "ADVANCE TO VENDOR", -2500000).line("LOAN", "2026-07-01", "ADVANCE TO VENDOR", -2500000).line("LOAN", "2026-07-01", "NARRATIVE: DISBURSAL", 0).line("LOAN", "2026-07-01", "NARRATIVE: DISBURSAL", 0);
  h.line("LOAN", "2026-07-02", "FEE", -5000).line("LOAN", "2026-07-02", "FEE", -5000);
  const L = run(h);
  assert.equal(L.balances.at("LOAN", "2026-07"), -5010000, "both advances and both fees count");
});

test("a partial lodged year conforms to its own enum", () => {
  const def = require("../../schema/tables.json").tables.tax_return.columns.find((c) => c.startsWith("status"));
  assert.ok(/partial/.test(def), def);
});

test("a mid-day reading ties to a run of the day's lines, not to any subset that happens to add up", () => {
  const build = (reading) => {
    const h = household("subset").person("a").account("BANK", "transaction", "cash", [["a", 10000]], { opening_balance_cents: 100000, opened_on: "2026-07-01" });
    h.line("BANK", "2026-07-02", "START", -100).line("BANK", "2026-07-10", "ONE", -1000).line("BANK", "2026-07-10", "TWO", -300).line("BANK", "2026-07-10", "THREE", -700).line("BANK", "2026-07-20", "END", -100);
    h.obs("balance", { account_ref: "BANK", as_at: "2026-07-02", balance_cents: 99900 });
    h.obs("balance", { account_ref: "BANK", as_at: "2026-07-10", balance_cents: reading, sequence: 1 });
    h.obs("balance", { account_ref: "BANK", as_at: "2026-07-25", balance_cents: 97800 });
    return status(run(h), "L3");
  };
  assert.ok(!build(98900).includes("fail"), "after the first line");
  assert.ok(!build(98600).includes("fail"), "after the first two");
  assert.ok(build(98200).includes("fail"), "ONE and THREE add to it but are not a run: a coincidence is not a tie");
});

const carer = () => {
  const h = household("carer").person("d", "Dee Bonetti").org("Services Australia").account("BANK", "transaction", "cash", [["d", 10000]]);
  h.setup.category.push({ category_id: "x_CARER", name: "Carer payments", kind: "income", cash_lens: true, economic_lens: true });
  h.setup.contract.push({ contract_id: "C", kind: "benefit", name: "Carer Payment", counterparty_party_id: "Services Australia", category_id: "x_CARER", started_on: "2026-01-01", ended_on: "2026-12-31" });
  return h;
};
test("a contract's name is not proof: an amount far from its pattern, or a date outside it, stays a question", () => {
  const h = carer();
  for (const d of ["02-05", "02-19", "03-05", "03-19", "04-02"]) h.line("BANK", `2026-${d}`, "SERVICES AUSTRALIA PAYMENT", 90000 + Number(d.slice(3)));
  h.line("BANK", "2026-03-10", "SERVICES AUSTRALIA MEDICARE 41", 4120);
  h.line("BANK", "2026-03-12", "SERVICES AUSTRALIA LUMP", 1512000);
  h.line("BANK", "2025-06-01", "SERVICES AUSTRALIA PAYMENT", 90000);
  const L = run(h), carerLines = L.events.filter((e) => e.category_id === "x_CARER");
  assert.equal(carerLines.length, 5, "the five that fit");
  assert.ok(L.review.some((r) => /LUMP/.test(r.what)), "the lump asks");
  assert.equal(L.review.filter((r) => r.kind === "uncategorised" && r.amount_cents === 90000).length, 1, "the one before the contract asks");
});

test("a person's money stays theirs: an account in the memo group is no own transfer, is not asked about, and asks about no house", () => {
  const h = household("poa").person("d", "Dee Bonetti").account("BANK", "transaction", "cash", [["d", 10000]]).account("MUM", "transaction", "memo", [["d", 10000]]).account("HOME", "property", "property", [["d", 10000]], { fidelity: "snapshot" });
  h.setup.asset.push({ asset_id: "H", kind: "property", name: "Home", account_id: "HOME" });
  h.line("MUM", "2026-03-01", "OSKO TO D BONETTI BOARD", -18000).line("BANK", "2026-03-01", "OSKO FROM D BONETTI POA", 18000);
  h.line("MUM", "2026-03-05", "CHEMIST", -2000).line("MUM", "2026-03-06", "CONVEYANCING SALE PROCEEDS", 61234000);
  const L = run(h);
  assert.equal(L.events.filter((e) => e.kind === "transfer").length, 0, "crossing the boundary is not a transfer");
  assert.ok(!L.review.some((r) => /CHEMIST/.test(r.what)), "her lines are not the household's questions");
  assert.ok(!L.review.some((r) => r.kind === "possible_sale"), "and her sale is not the household's house");
  assert.ok(L.review.some((r) => /POA/.test(r.what)), "the credit that reached the household asks");
});

test("an account held wholly for someone else earns the household nothing", () => {
  const h = household("held-for").person("d", "Dee Bonetti").account("JT", "savings", "cash", [["d", 10000]], { opening_balance_cents: 1200000, opened_on: "2026-01-01" }).rule("INTEREST", "INTEREST");
  h.setup.party.push({ party_id: "m", kind: "person", name: "Assunta Bonetti" });
  h.setup.ownership = h.setup.ownership.filter((o) => !(o.basis === "beneficial"));
  h.setup.ownership.push({ subject_type: "account", subject_id: "JT", party_id: "m", basis: "beneficial", share_bps: 10000, valid_from: "2000-01-01", valid_to: null, recorded_at: "2000-01-01T00:00:00Z", superseded_at: null });
  h.line("JT", "2026-06-28", "INTEREST PAID", 8090);
  assert.equal(run(h).cash.find((m) => m.month === "2026-06").income, 0);
});

test("any account closed in setup leaves net worth, and a balance left at closing asks", () => {
  const h = household("forgiven").person("a").account("BANK", "transaction", "cash", [["a", 10000]], { opening_balance_cents: 100000, opened_on: "2026-01-01" }).account("OWED", "loan", "loans", [["a", 10000]], { opening_balance_cents: -2300000, opened_on: "2026-01-01", closed_on: "2026-02-20" });
  h.line("BANK", "2026-04-01", "SHOPS", -100);
  const L = run(h);
  assert.equal(L.netWorth.find((r) => r.month === "2026-01").total, 100000 - 2300000);
  assert.equal(L.netWorth.find((r) => r.month === "2026-03").total, 100000, "a debt forgiven in a will is gone");
  assert.ok(L.review.some((r) => r.kind === "closed_with_balance" && r.ref === "OWED"));
});

test("a file naming a number the account does not hold is held out and asked about, even on an open account", () => {
  const h = household("number").person("a").account("SAVE", "savings", "cash", [["a", 10000]], { opening_balance_cents: 100000, opened_on: "2026-01-01" });
  h.setup.alias.push({ subject_type: "account", subject_id: "SAVE", value: "114455", valid_from: "2000-01-01", valid_to: null });
  h.setup.stream.push({ stream_id: "SAVE", subject_type: "account", subject_id: "SAVE", cadence: "quarterly", valid_from: "2026-01-01" });
  const a = stream(h, "a", "SAVE"), b = stream(h, "b", "SAVE");
  let n = h.observations.length;
  h.obs("txn_line", { account_ref: "114455", posting_date: "2026-03-01", description: "SHOPS", amount_cents: -100 }); from(h, n, a);
  n = h.observations.length;
  h.obs("txn_line", { account_ref: "998877", posting_date: "2026-05-10", description: "TERM DEPOSIT WITHDRAWAL", amount_cents: -42000000 }); from(h, n, b);
  const L = run(h);
  assert.equal(L.balances.at("SAVE", "2026-05"), 99900);
  assert.equal(L.review.filter((r) => r.kind === "lines_for_another_account").length, 1);
  assert.ok(!status(L, "L4").includes("fail"));
});

test("an authorisation in an early download gives way to the posting when a later file covers its day, even when a statement shares that stream's line", () => {
  const h = household("auth").person("a").account("CARD", "credit_card", "cash", [["a", 10000]]);
  const early = stream(h, "e", "CSV"), late = stream(h, "l", "CSV"), pdf = stream(h, "p", "PDF");
  const add = (src, d, desc, c) => { const n = h.observations.length; h.line("CARD", d, desc, c); from(h, n, src); };
  add(early, "2026-03-20", "OPEN", -100); add(early, "2026-03-24", "WISHPAW MARKET US USD 78.00", -12118); add(early, "2026-03-31", "MID", -100);
  add(pdf, "2026-03-20", "OPEN", -100); add(pdf, "2026-03-24", "WISHPAW MARKET US USD 78.00", -12240); add(pdf, "2026-03-31", "MID", -100); add(pdf, "2026-04-10", "CLOSE", -100);
  add(late, "2026-03-22", "OTHER", -100); add(pdf, "2026-03-22", "OTHER", -100); add(late, "2026-03-31", "MID", -100); add(late, "2026-04-02", "WISHPAW MARKET US USD 78.00", -12240); add(late, "2026-04-10", "CLOSE", -100);
  assert.equal(run(h).events.filter((e) => /WISHPAW/.test(e.description)).length, 1);
});
