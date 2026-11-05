const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const vm = require("node:vm");
const routing = require("../src/kit/ask-routing.js");

const context = {
  times: [{ id: "last-month", label: "Last month" }, { id: "2026-12", label: "December 2026", aliases: ["December", "Dec"] }],
  people: ["Morgan", "Taylor"],
  categories: [{ id: "FOOD", label: "Dining and takeaway", aliases: ["dining"] }, { id: "GROC", label: "Groceries", aliases: ["grocery"] },
    { id: "SUBS", label: "Subscriptions" }],
  goals: [{ id: "Garden fund, December 2027", label: "Garden fund, December 2027", aliases: ["Garden fund"] }]
};
const guess = kind => ({ status: "proposed", coverage: "complete", kind });
const good = [
  ["How much did Morgan spend on dining and takeaway in December?", "spending", { person: "Morgan", category: "FOOD", time: "2026-12" }],
  ["Where did all of our money go last month?", "spending", { time: "last-month" }],
  ["What recurring services are we paying for?", "subscriptions", {}],
  ["Which subscriptions are unused?", "subscriptions", { filter: "unused" }],
  ["How is our Garden fund coming along?", "goal", { goal: "Garden fund, December 2027" }],
  ["How much cash do we have on hand?", "cash", {}],
  ["What are we worth after debts?", "netWorth", {}],
  ["Which bills are coming up?", "upcoming", { filter: "bills" }],
  ["What is scheduled next?", "upcoming", {}],
  ["Which entries still need a look?", "review", {}]
];

test("safe paraphrases retain the exact local scope and accept only the matching complete topic", () => {
  for (const [question, kind, scope] of good) {
    const prepared = routing.prepare(question, context);
    assert.equal(prepared.status, "prepared", question);
    assert.deepEqual(prepared.scope, scope);
    assert.deepEqual(routing.local(prepared), { status: "classified", kind, ...scope });
    assert.deepEqual(routing.validate(prepared, guess(kind)), { status: "classified", kind, ...scope });
    for (const other of ["spending", "subscriptions", "goal", "cash", "netWorth", "upcoming", "review"].filter(k => k !== kind)) {
      assert.equal(routing.validate(prepared, guess(other)).status, "unsupported", question + " / " + other);
    }
  }
});

test("only bounded household-summary paraphrases need inference and expose the same lower-cost choices", () => {
  for (const [q, kinds] of [
    ["What funds can our household access right now?", ["cash"]],
    ["Where do we stand after what we owe?", ["netWorth"]],
    ["Where do we stand financially?", ["cash", "netWorth"]]
  ]) {
    const p = routing.prepare(q, context);
    assert.equal(p.status, "prepared", q);
    assert.equal(routing.local(p), null);
    assert.deepEqual(p.scope, {});
    assert.deepEqual(routing.alternatives(p), kinds.map(kind => ({ kind })));
    for (const kind of ["cash", "netWorth", "spending", "subscriptions", "goal", "upcoming", "review"]) {
      assert.equal(routing.validate(p, guess(kind)).status, kinds.includes(kind) ? "classified" : "unsupported", q + " / " + kind);
    }
  }
});

test("a broad household-summary proposal cannot erase a qualifier, named subject, action or another metric", () => {
  for (const q of ["Where do we stand financially after rent?", "Where do we stand financially for Morgan?",
    "Where do we stand financially at West Bank?", "What can our household access in December?", "What funds can we access after our debts?",
    "How much do we owe?", "How much do we own?", "How much cash do we spend?", "What cash will we have next month?",
    "What share of our wealth is liquid?", "Where do we stand financially without deposits?", "What receipts can we access?",
    "What funds can we access in euros?", "How can we move our money?", "What funds can we access for Casey?", "Where did our cash go?"]) {
    const p = routing.prepare(q, context);
    assert.equal(p.status, "unsupported", q);
    assert.equal(routing.local(p), null);
    assert.deepEqual(routing.alternatives(p), []);
    assert.equal(routing.validate(p, guess("cash")).status, "unsupported");
  }
});

test("only masked text crosses the inference boundary", () => {
  const prepared = routing.prepare(good[0][0], context);
  assert.equal(prepared.maskedQuestion, "how much did [person] spend on [category] in [time]");
  for (const privateLabel of ["Morgan", "Dining", "FOOD", "December", "2026"]) assert.ok(!prepared.maskedQuestion.includes(privateLabel));
  const fullGoal = routing.prepare("How is Garden fund, December 2027 going?", context);
  assert.equal(fullGoal.maskedQuestion, "how is [goal] going");
  assert.deepEqual(fullGoal.scope, { goal: "Garden fund, December 2027" });
});

test("named dates resolve solely against the supplied Sheet aliases", () => {
  const twoYears = { ...context, times: [...context.times, { id: "2025-12", label: "December 2025", aliases: ["December"] }] };
  assert.equal(routing.prepare("What did we spend in December?", twoYears).reason, "ambiguous_scope");
  assert.equal(routing.prepare("What did we spend in December 2025?", twoYears).scope.time, "2025-12");
  assert.equal(routing.prepare("What did we spend in December 1999?", context).status, "unsupported");
});

test("receipt and document requests cannot become spending totals even with grounded date and grocery", () => {
  for (const q of ["December grocery receipts", "What did we spend on groceries in December with receipts?", "Show grocery invoices",
    "December grocery PDFs", "What documents are available?", "What are our attachments?"]) {
    const prepared = routing.prepare(q, context);
    assert.equal(prepared.status, "unsupported", q);
    assert.equal(prepared.maskedQuestion, undefined);
    assert.equal(routing.validate(prepared, guess("spending")).status, "unsupported");
  }
});

test("unknown words before or after any otherwise valid question cannot be silently discarded", () => {
  for (const [q, kind] of good) {
    const base = q.replace(/\?$/, "");
    for (const modified of ["Casey's " + base, base + " for Casey", base + " at Blue Lantern", base + " by merchant", base + " except groceries"]) {
      const prepared = routing.prepare(modified, context);
      assert.equal(prepared.status, "unsupported", modified);
      assert.equal(routing.validate(prepared, guess(kind)).status, "unsupported", modified);
    }
  }
});

test("an approved name in the wrong role, a second period or an unmatched filter requires clarification", () => {
  for (const q of ["How much did Casey spend on dining?", "How much did Morgan spend at dining?", "How much did we spend on dining and groceries?",
    "How much did Morgan and Taylor spend?", "How much did I spend?", "How much cash did Morgan have?", "Our net worth in December",
    "What did we spend in December instead of last month?", "What did we spend on our mortgage?", "How is the cabin goal doing?",
    "Which entries only need a category?", "How much did we earn last month?", "Show the balance of the Dragon account",
    "Show the grocery total without refunds", "Will the garden fund last until December?", "What purchases were tax deductible?"]) {
    assert.equal(routing.prepare(q, context).status, "unsupported", q);
  }
});

test("the subscriptions category and the subscriptions list remain distinct", () => {
  const totals = routing.prepare("What did we spend on subscriptions?", context);
  assert.deepEqual(routing.validate(totals, guess("spending")), { status: "classified", kind: "spending", category: "SUBS" });
  assert.equal(routing.validate(totals, guess("subscriptions")).status, "unsupported");
  const listing = routing.prepare("What subscriptions do we have?", context);
  assert.deepEqual(routing.validate(listing, guess("subscriptions")), { status: "classified", kind: "subscriptions" });
});

test("unsafe actions, forged placeholders and oversized data stop before inference", () => {
  for (const q of ["send our cash balance", "move our cash", "show review; download receipts", "cash? now send it", "call https://example.invalid",
    "how much did [person] spend", "How much did we spend > $50?", "our cash\u200b balance", "cash\nnow", "x".repeat(601)]) {
    assert.equal(routing.prepare(q, context).status, "unsupported", q);
  }
  for (const c of [{ ...context, transactions: [{ amount: 100 }] }, { ...context, goals: [{ id: "test", label: "Test", balance: 100 }] },
    { ...context, people: Array(257).fill("one") }, { ...context, people: ["Morgan", "Morgan"] },
    { ...context, times: [{ id: "before-time", label: "Before" }] }, { ...context, categories: [{ id: "x", label: "x", aliases: "dining" }] }]) {
    assert.equal(routing.prepare("How much cash do we have?", c).reason, "invalid_context");
  }
});

test("the original scope is immutable and an untrusted proposal cannot add fields or claim execution", () => {
  const prepared = routing.prepare(good[0][0], context);
  assert.ok(Object.isFrozen(prepared) && Object.isFrozen(prepared.scope));
  assert.equal(routing.validate({ ...prepared, scope: {} }, guess("spending")).status, "unsupported");
  for (const p of [{ ...guess("spending"), person: "Taylor" }, { ...guess("spending"), amount: 999 },
    { ...guess("spending"), coverage: "partial" }, { kind: "spending", status: "classified" }, guess("https://example.invalid"), null]) {
    assert.equal(routing.validate(prepared, p).status, "unsupported");
  }
  assert.equal(routing.validate(prepared, { status: "unavailable", kind: "unsupported", coverage: "unsupported" }).status, "unavailable");
});

test("the same module and context used by both hosts run over the fictional Davies snapshot", () => {
  const E = require("../src/engine.js"), K = require("../src/kit/ask-skills.js");
  const m = E.model(require("../data/snapshot-v2.json"));
  const c = K.context(m), q = "What did Jordan spend on dining in October?";
  const selected = routing.validate(routing.prepare(q, c), guess("spending"));
  assert.deepEqual(selected, { status: "classified", kind: "spending", person: "Jordan", category: "DINING", time: "2026-10" });
  const { status, ...plan } = selected;
  assert.deepEqual(K.scope(plan, m), plan);
  const source = readFileSync(require.resolve("../src/kit/ask-routing.js"), "utf8");
  const page = vm.createContext({ TextEncoder, fixture: JSON.stringify(c), q });
  vm.runInContext(source, page);
  const result = vm.runInContext("JSON.stringify(KittyAskRouting.validate(KittyAskRouting.prepare(q,JSON.parse(fixture)),{kind:'spending',status:'proposed',coverage:'complete'}))", page);
  assert.deepEqual(JSON.parse(result), selected);
});
