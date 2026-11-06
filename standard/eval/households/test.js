/* Eight real shapes of household, each a small life written as observations. `node --test standard/eval/households/test.js`.
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
