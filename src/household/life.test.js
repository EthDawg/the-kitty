/* transfer, merge, tailor, update, spawn: the verbs that let a household change shape. On the smallest households that show each law, on both stores. `node --test src/household/life.test.js`.
   life/run.js plays them on whole families. These are the cases a change to one verb should fail first. */
"use strict";
const test = require("node:test"), assert = require("node:assert");
const K = require("./node.js");

const enc = (s) => new TextEncoder().encode(s);
const HEAD = "Bank Account,Date,Narrative,Debit Amount,Credit Amount,Balance,Categories,Serial\n";
const dmy = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
function bankFile(account, rows, opening = 100000, name = "Data.csv") {
  let bal = opening;
  const body = rows.map(([d, text, c]) => { bal += c; return `${account},${dmy(d)},${text},${c < 0 ? (-c / 100).toFixed(2) : ""},${c > 0 ? (c / 100).toFixed(2) : ""},${(bal / 100).toFixed(2)},OTHER,`; }).join("\n");
  return { name, bytes: enc(`${HEAD}${body}\n`) };
}
const SAM = "733-123 456789", ALEX = "733-999 111222", JOINT = "732-114 508221";
const folderOf = () => K.folderStore({ dir: "/kitty", fs: K.memfs() }), stores = { folder: folderOf, fake: () => K.fakeStore() };
const yes = (by, words = "Yes.") => ({ by, words });
const solo = async (make, name, today = "2026-08-05") => { const s = make(); await K.init(s, { name, people: [name], today }); return s; };
const count = async (s, t) => (await s.tables.read(t)).length;
const bal = async (s, id, m, today) => (await K.rebuildAt(s, { today })).L.balances.at(id, m);
const MAY = [["2026-05-04", "WOOLWORTHS 1 CARLTON", -5000], ["2026-05-20", "KOALATEL MOBILE", -3000]];
const JUNE = [["2026-06-04", "WOOLWORTHS 1 CARLTON", -6000], ["2026-06-20", "KOALATEL MOBILE", -3000]];
const JULY = [["2026-07-04", "WOOLWORTHS 1 CARLTON", -7000], ["2026-07-20", "KOALATEL MOBILE", -3000]];

for (const [kind, make] of Object.entries(stores)) {
  test(`transfer on ${kind}: consent, a dated slice, originals keep their dates and judgement takes the day`, async () => {
    const a = await solo(make, "Sam"), b = await solo(make, "Sam");
    await K.add(a, [{ ...bankFile(SAM, MAY), download_date: "2026-06-01" }], { today: "2026-06-01" });
    await K.add(a, [{ ...bankFile(SAM, JUNE, 92000), name: "June.csv", download_date: "2026-07-01" }], { today: "2026-07-01" });
    await K.record(a, "rule", [{ rule_id: "r1", pattern: "KOALATEL MOBILE", match: "normalised", category_id: "TELCO", provenance: "said", status: "accepted", recorded_at: "2026-06-01T00:00:00Z" }], {});
    await K.record(a, "term", [{ term_id: "t1", subject_type: "account", subject_id: "ACC-6789", term: "interest_rate", value: "6.54", valid_from: "2026-05-01", recorded_at: "2026-05-02T00:00:00Z" }], {});
    await assert.rejects(K.transfer(a, b, { from: "2026-06-01" }, { today: "2026-08-05" }), /needs someone's yes/);
    const r = await K.transfer(a, b, { from: "2026-06-01", setup: (t) => ["account", "alias", "ownership", "stream", "term"].includes(t) }, { today: "2026-08-05", consent: yes("Sam") });
    assert.ok(r.audit.ok);
    const term = (await b.tables.read("term"))[0];
    assert.equal(term.recorded_at, "2026-05-02T00:00:00Z", "the one exception: the engine orders a term against notices by this column. H-006");
    assert.match(term.note, /Adopted 2026-08-05/);
    const obs = await b.tables.read("observation");
    assert.ok(obs.every((o) => !o.payload.posting_date || o.payload.posting_date >= "2026-06-01"), "nothing from before the window crossed");
    const src = await b.tables.read("source");
    assert.deepEqual(src.map((s) => s.captured_at), ["2026-07-01T00:00:00Z"], "an original keeps captured_at");
    const rule = (await b.tables.read("rule"))[0];
    assert.equal(rule.recorded_at, "2026-08-05T00:00:00Z", "adopted judgement is recorded at transfer time");
    assert.match(rule.note, /First recorded 2026-06-01/);
    const alias = (await b.tables.read("alias"))[0], log = (await b.tables.read("decision")).find((d) => d.value && d.value.transfer);
    assert.equal(alias.recorded_at, "2026-08-05T00:00:00Z");
    assert.ok(log.value.own_times.some((t) => t.table === "alias"), "a table with no note carries its own time in the transfer's row");
    assert.deepEqual(log.value.consent, { by: "Sam", words: "Yes." });
    assert.ok((await a.tables.read("decision")).some((d) => d.value && d.value.role === "out"), "the source store records it too");
    const again = await K.transfer(a, b, { from: "2026-06-01", setup: () => false }, { today: "2026-08-05", consent: yes("Sam") });
    assert.equal(again.counts.observation, 0, "run it again and nothing lands twice");
  });

  test(`a file that straddles the date crosses as its lines, and its bytes stay home, on ${kind}`, async () => {
    const a = await solo(make, "Sam"), b = await solo(make, "Sam");
    await K.add(a, [{ ...bankFile(SAM, [...MAY, ...JUNE]), download_date: "2026-07-01" }], { today: "2026-07-01" });
    const r = await K.transfer(a, b, { from: "2026-06-01", setup: (t) => ["account", "alias", "ownership", "stream"].includes(t) }, { today: "2026-08-05", consent: yes("Sam") });
    assert.equal(r.slice.partial.length, 1);
    const s = (await b.tables.read("source"))[0];
    assert.match(s.uri, /^not-held:/, "the bytes hold lines that did not cross");
    assert.match(s.note, /Part of this file came across/);
    assert.ok(r.slice.left_behind.lines >= 2);
  });

  test(`move on ${kind}: nothing lost, the old store stops, one bundle hash`, async () => {
    const a = await solo(make, "Sam", "2026-07-01"), other = kind === "fake" ? folderOf() : K.fakeStore();
    await K.add(a, [{ ...bankFile(SAM, [...MAY, ...JUNE]), download_date: "2026-07-01" }], { today: "2026-07-01" });
    await K.decide(a, { verb: "note", target_type: "account", target_ref: "ACC-6789", value: { kept: true } }, { today: "2026-07-01" });
    await K.tailor(a, { rung: "x_table", name: "x_notes", sentence: "Keep notes", definition: { columns: ["id:id:pk", "text:text:req"] } }, { today: "2026-07-01" });
    await K.writeOwn(a, "x_notes", [{ id: "n1", text: "a line of my own" }], { today: "2026-07-01" });
    const before = await K.rebuildAt(a, { today: "2026-08-05" }), m = await K.move(a, other, { today: "2026-08-05", consent: yes("Sam") });
    assert.equal(m.hash.source, before.L.bundleHash);
    assert.ok(m.hash.same, "the same household, rebuilt");
    assert.equal(await count(other, "observation"), await count(a, "observation"));
    assert.deepEqual(await other.tables.read("x_notes"), await a.tables.read("x_notes"), "a household's own table comes too");
    assert.equal((await K.next(a, { today: "2026-08-05" })).say, "This Kitty has moved.");
    await assert.rejects(K.add(a, [bankFile(SAM, JULY)], { today: "2026-08-05" }), /moved/);
    assert.ok((await K.homes([a, other])).ok, "one home: the old store has stopped");
  });

  test(`two stores holding one source with no transfer between them break the law, on ${kind}`, async () => {
    const a = await solo(make, "Sam"), b = await solo(make, "Alex"), f = bankFile(SAM, MAY);
    await K.add(a, [f], { today: "2026-06-01" }); await K.add(b, [f], { today: "2026-06-01" });
    const h = await K.homes([a, b]);
    assert.equal(h.ok, false); assert.equal(h.unnamed.length, 1);
  });
}

test("handover: a copy to someone acting for them, each source shared by name", async () => {
  const a = await solo(folderOf, "Sam"), b = await solo(folderOf, "Executor");
  await K.add(a, [bankFile(SAM, MAY)], { today: "2026-06-01" });
  await K.handover(a, b, { today: "2026-08-05", consent: yes("Executor", "Letters of administration."), setup: (t) => ["account", "alias", "stream"].includes(t) });
  assert.equal(await count(b, "observation"), await count(a, "observation"));
  assert.equal((await K.next(a, { today: "2026-08-05" })).id !== "moved", true, "the first store stays");
  assert.ok((await K.homes([a, b])).ok);
});

/* Two people, one joint account they each named. Sam files it under an account of his own making, Alex under hers. */
async function couple(make) {
  const TODAY = "2026-08-05", A = await solo(make, "Sam", TODAY), B = await solo(make, "Alex", TODAY);
  await K.add(A, [{ ...bankFile(SAM, [...MAY, ...JUNE]), download_date: "2026-07-01" }, { ...bankFile(JOINT, JULY, 50000, "Joint A.csv"), download_date: "2026-08-02" }], { today: TODAY });
  await K.record(B, "account", [{ account_id: "ACC-HOUSE", name: "Household", class: "asset", type: "transaction", reporting_group: "cash", currency: "AUD", in_scope: true }], {});
  await K.record(B, "alias", [{ subject_type: "account", subject_id: "ACC-HOUSE", scheme: "account_number", value: JOINT, valid_from: "1900-01-01" }], { today: TODAY });
  await K.record(B, "stream", [{ stream_id: "HOUSE", name: "Household download", doc_kind: "txn_csv", subject_type: "account", subject_id: "ACC-HOUSE", cadence: "monthly", valid_from: "2026-07-01" }], { today: TODAY });
  await K.add(B, [{ ...bankFile(ALEX, [...MAY, ...JUNE], 200000), name: "Alex.csv", download_date: "2026-07-01" }, { ...bankFile(JOINT, JULY, 50000, "Joint B.csv"), name: "Joint B.csv", download_date: "2026-08-03" }, { ...bankFile(JOINT, JULY.slice(0, 1), 50000, "Joint early.csv"), name: "Joint early.csv", download_date: "2026-07-10" }], { today: TODAY });
  await K.decide(B, { verb: "categorise", target_type: "line", target_ref: "ACC-HOUSE|2026-07-20|-3000", value: { category_id: "TELCO" } }, { today: TODAY });
  const people = [{ store: A, by: "Sam", name: "Sam" }, { store: B, by: "Alex", name: "Alex" }];
  return { A, B, people, TODAY };
}
for (const [kind, make] of Object.entries(stores)) {
  test(`merge on ${kind}: one account by its number, counted once, decisions rebound, each history stays home`, async () => {
    const { people, TODAY, A, B } = await couple(make), J = make(), before = await count(A, "source");
    const dry = await K.merge(J, { people, joined_on: "2026-07-08", today: TODAY, name: "Us", dry_run: true });
    assert.equal((await J.probe()).empty, true, "a dry run writes nothing");
    assert.equal(dry.questions.length, 4, "two yeses, one name and the shares");
    await assert.rejects(K.merge(J, { people, joined_on: "2026-07-08", today: TODAY, name: "Us", consent: [yes("Sam")] }), /Both people/);
    const r = await K.merge(J, { people, joined_on: "2026-07-08", today: TODAY, name: "Us", consent: [yes("Sam"), yes("Alex")], answers: { "name:ACC-2221": "Joint" } });
    assert.deepEqual(r.map, { "ACC-HOUSE": "ACC-8221", HOUSE: "ACC-8221" });
    assert.equal(r.rebound_decisions, 1); assert.deepEqual(r.unbound, []);
    assert.ok(r.audit.every((a) => a.ok));
    assert.ok(r.homes.ok);
    const { L } = await K.rebuildAt(J, { today: TODAY });
    assert.equal(L.lines.filter((l) => l.account === "ACC-8221").length, 2, "two lines, from three files");
    assert.equal(L.balances.at("ACC-8221", "2026-07"), 40000);
    assert.equal(L.lines.filter((l) => l.date < "2026-07-01").length, 0, "nothing from before the joining month");
    const sam = L.parties.find((p) => p.name === "Sam");
    assert.ok(L.accounts.some((a) => a.account_id === "ACC-6789" && a.opening_balance_cents === 83000), "an account they bring opens on what it held");
    assert.ok(sam);
    assert.ok((await J.tables.read("alias")).some((x) => x.scheme === "owner_ref" && x.value === "ACC-HOUSE"), "the old id is an alias");
    assert.ok((await J.tables.read("alias")).some((x) => x.scheme === "name" && x.value === "Household"), "so is the second name");
    const owners = (await J.tables.read("ownership")).filter((o) => o.subject_id === "ACC-8221" && o.basis === "beneficial");
    assert.deepEqual(owners.map((o) => o.share_bps).sort(), [5000, 5000]);
    assert.equal(L.review.filter((x) => x.kind === "uncategorised" && /TELCO/.test(x.what)).length, 0);
    assert.ok(!L.checks.some((c) => c.law === "L17" && c.status === "fail"), "no decision lost its line");
    assert.equal(await count(A, "source"), before, "her Kitty keeps what it had");
    assert.ok((await B.tables.read("decision")).some((d) => d.value && d.value.recipe === "merge" && d.value.role === "out"));
  });

  test(`one file with no account number, named two ways, is one set of lines after a merge, on ${kind}`, async () => {
    const TODAY = "2026-08-05", A = await solo(make, "Sam", TODAY), B = await solo(make, "Alex", TODAY), J = make(), n = "ACCOUNT 7321 145082";
    const csv = enc('"02/07/2026","-70.00","WOOLWORTHS 1 CARLTON","+930.00"\n"03/07/2026","-30.00","KOALATEL MOBILE","+900.00"\n');
    const told = async (s, id, stream) => {
      await K.record(s, "account", [{ account_id: id, name: id, class: "asset", type: "transaction", reporting_group: "cash", currency: "AUD", in_scope: true }], {});
      await K.record(s, "alias", [{ subject_type: "account", subject_id: id, scheme: "account_number", value: n, valid_from: "1900-01-01" }], { today: TODAY });
      await K.record(s, "stream", [{ stream_id: stream, name: id, doc_kind: "txn_csv", subject_type: "account", subject_id: id, cadence: "monthly", valid_from: "2026-07-01" }], { today: TODAY });
      const r = await K.add(s, [{ name: "CSVData.csv", bytes: csv, stream, download_date: "2026-07-05" }], { today: TODAY });
      assert.equal(r.added.length, 1);
    };
    await told(A, "ACC-OURS", "OURS"); await told(B, "ACC-US", "US");
    const r = await K.merge(J, { people: [{ store: A, by: "Sam", name: "Sam" }, { store: B, by: "Alex", name: "Alex" }], joined_on: "2026-07-01", today: TODAY, name: "Us", consent: [yes("Sam"), yes("Alex")] });
    assert.ok(r.audit.every((a) => a.ok), "the same bytes at the same place are one line");
    const { L } = await K.rebuildAt(J, { today: TODAY });
    assert.equal(L.lines.filter((l) => l.account === "ACC-OURS").length, 2);
    assert.equal(L.balances.at("ACC-OURS", "2026-07"), 90000);
  });

  test(`a locked month a merge lands in stays locked and raises a proposal, on ${kind}`, async () => {
    const { people, TODAY, A } = await couple(make), J = make();
    await K.decide(A, { scope: { domain: "payroll", state: "none" } }, { today: TODAY });
    await K.record(A, "rule", [{ rule_id: "r1", pattern: "WOOLWORTHS", match: "contains", category_id: "GROCERIES", provenance: "said", status: "accepted" }, { rule_id: "r2", pattern: "KOALATEL MOBILE", match: "contains", category_id: "TELCO", provenance: "said", status: "accepted" }], { today: TODAY });
    const closed = await K.close(A, "2026-06", { today: TODAY });
    assert.equal(closed.status, "locked");
    const r = await K.merge(J, { people, joined_on: "2026-06-08", today: TODAY, name: "Us", consent: [yes("Sam"), yes("Alex")] });
    assert.equal(r.proposals.length, 1); assert.equal(r.proposals[0].period, "2026-06");
    const step = await K.next(J, { today: TODAY });
    assert.equal(step.say, "June 2026 was locked, and something now changes it.");
  });

  test(`two people who filed a line differently get one question, with a default, on ${kind}`, async () => {
    const { people, TODAY, A } = await couple(make), J = make();
    await K.decide(A, { verb: "categorise", target_type: "line", target_ref: "ACC-8221|2026-07-20|-3000", value: { category_id: "SUBS" } }, { today: TODAY });
    const dry = await K.merge(J, { people, joined_on: "2026-07-08", today: TODAY, name: "Us", dry_run: true });
    assert.ok(dry.questions.some((q) => q.id.startsWith("line:") && q.default === "SUBS"));
  });

  test(`the same word for two accounts stops a merge, because lines say only that word, on ${kind}`, async () => {
    const TODAY = "2026-08-05", A = await solo(make, "Sam", TODAY), B = await solo(make, "Alex", TODAY), J = make();
    const named = (s, id) => K.record(s, "alias", [{ subject_type: "account", subject_id: id, scheme: "name", value: "Everyday", valid_from: "1900-01-01" }], { today: TODAY });
    await K.add(A, [bankFile(SAM, MAY)], { today: TODAY }); await K.add(B, [bankFile(ALEX, MAY)], { today: TODAY });
    await named(A, "ACC-6789"); await named(B, "ACC-1222");
    const people = [{ store: A, by: "Sam", name: "Sam" }, { store: B, by: "Alex", name: "Alex" }];
    await assert.rejects(K.merge(J, { people, joined_on: "2026-07-08", today: TODAY, name: "Us", consent: [yes("Sam"), yes("Alex")] }), /You both call a different account Everyday/);
  });

  test(`sharing history after joining rebinds through the same map, and needs that person's yes, on ${kind}`, async () => {
    const { people, TODAY, B } = await couple(make), J = make();
    await K.merge(J, { people, joined_on: "2026-07-08", today: TODAY, name: "Us", consent: [yes("Sam"), yes("Alex")] });
    await assert.rejects(K.shareHistory(J, B, { to: "2026-06-30", today: TODAY }), /needs someone's yes/);
    const r = await K.shareHistory(J, B, { to: "2026-06-30", today: TODAY, by: "Alex", consent: yes("Alex", "For the tax.") });
    assert.ok(r.audit.ok);
    const { L } = await K.rebuildAt(J, { today: TODAY });
    assert.ok(L.lines.some((l) => l.account === "ACC-1222" && l.date < "2026-07-01"), "her past is here now, by her choice");
  });

  test(`tailoring on ${kind}: an x_ table is typed and in the store, a memo account never moves the ledger, the example runs`, async () => {
    const s = await solo(make, "Sam", "2026-07-01");
    await K.add(s, [bankFile(SAM, [...MAY, ...JUNE])], { today: "2026-07-01" });
    const before = (await K.rebuildAt(s, { today: "2026-07-01" })).L;
    const sentence = "Keep what the dog costs";
    await assert.rejects(K.tailor(s, { rung: "x_table", name: "pets", sentence, definition: { columns: ["id:id:pk"] } }, { today: "2026-07-01" }), /x_/);
    await assert.rejects(K.tailor(s, { rung: "x_table", name: "x_pets", definition: { columns: ["id:id:pk"] } }, { today: "2026-07-01" }), /own sentence/);
    await K.tailor(s, { rung: "x_table", name: "x_pets", sentence, definition: { columns: ["id:id:pk", "on:date:req", "who:text:req", "cents:cents:req"] } }, { today: "2026-07-01" });
    await assert.rejects(K.writeOwn(s, "x_pets", [{ id: "a", who: "Biscuit", cents: 100 }], { today: "2026-07-01" }), /on/, "a required column is required");
    await K.writeOwn(s, "x_pets", [{ id: "a", on: "2026-06-01", who: "Biscuit", cents: 12000 }, { id: "b", on: "2026-06-20", who: "Biscuit", cents: 3000 }, { id: "c", on: "2026-06-20", who: "Rex", cents: 500 }], { today: "2026-07-01" });
    await K.record(s, "account", [{ account_id: "MEMO-DOG", name: "The dog jar", class: "memo", type: "memo", reporting_group: "memo", currency: "AUD", in_scope: false }], {});
    const question = { from: "x_pets", date: "on", group: ["who"], sum: "cents" };
    await K.tailor(s, { rung: "saved_question", name: "dog_cost", sentence, definition: question, example: { as_of: "2026-06-30", result: { Biscuit: 15000, Rex: 500 } } }, { today: "2026-07-01" });
    await K.tailor(s, { rung: "widget", name: "dog_home", sentence, definition: { widget: "figures", place: "home", title: "The dog", question: "dog_cost" }, example: { as_of: "2026-06-30", result: { Biscuit: 15000, Rex: 500 } } }, { today: "2026-07-01" });
    assert.deepEqual((await K.checkTailoring(s)).map((c) => c.status), ["pass", "pass"]);
    assert.deepEqual((await K.widgets(s, { today: "2026-06-01" }))[0].answer, { Biscuit: 12000 });
    const after = (await K.rebuildAt(s, { today: "2026-07-01" })).L;
    assert.equal(after.bundleHash, before.bundleHash, "the ledger does not know");
    assert.equal(after.netWorth[after.netWorth.length - 1].total, before.netWorth[before.netWorth.length - 1].total);
    await K.writeOwn(s, "x_pets", [{ id: "d", on: "2026-06-21", who: "Rex", cents: 1 }], { today: "2026-07-01" });
    assert.equal((await K.checkTailoring(s))[0].status, "rewrite", "an example that no longer holds asks for a rewrite, from the sentence");
    assert.equal((await K.checkTailoring(s))[0].sentence, sentence);
  });

  test(`an update on ${kind}: dry run, a metric diff, originals untouched, x_ carried, locked months stay`, async () => {
    const today = "2026-08-05", s = await solo(make, "Sam", today);
    await K.add(s, [bankFile(SAM, [...MAY, ...JUNE, ["2026-07-02", "KOALATEL MOBILE", -4100], ...JULY])], { today });
    await K.decide(s, { scope: { domain: "payroll", state: "none" } }, { today });
    await K.decide(s, { verb: "categorise", target_type: "line", target_ref: "ACC-6789|2026-07-02|-4100", value: { category_id: "TELCO" } }, { today });
    await K.record(s, "rule", [{ rule_id: "r1", pattern: "WOOLWORTHS", match: "contains", category_id: "GROCERIES", provenance: "said", status: "accepted" }, { rule_id: "r2", pattern: "KOALATEL MOBILE", match: "contains", category_id: "TELCO", provenance: "said", status: "accepted" }], { today });
    assert.equal((await K.close(s, "2026-06", { today })).status, "locked");
    await K.tailor(s, { rung: "x_table", name: "x_pocket", sentence: "Jars", definition: { columns: ["line:id:pk", "day:date:req", "child:id:req", "jar:text:req", "what:text:req", "amount:cents:req"] } }, { today });
    await K.writeOwn(s, "x_pocket", [{ line: "1", day: "2026-07-04", child: "KID", jar: "save", what: "allowance", amount: 150 }, { line: "2", day: "2026-07-04", child: "KID", jar: "spend", what: "allowance", amount: 350 }], { today });
    const question = { from: "x_pocket", date: "day", group: ["child", "jar"], sum: "amount" }, example = { as_of: today, result: { KID: { save: 150, spend: 350 } } };
    await K.tailor(s, { rung: "saved_question", name: "jars", sentence: "Jars", definition: question, example }, { today });
    const job = { from: "x_pocket", to: "pocket-money", sum: { from: "amount", to: "cents" }, map: { entry_id: "line", on: "day", party_id: "child", jar: "jar", kind: "what", cents: "amount" }, retire: ["x_pocket", "jars"], question: "jars" };
    const release = K.base().releases["2036-04-pocket-money"], tables = async () => JSON.stringify(await s.tables.read("x_pocket")), was = await tables(), before = await s.tables.read("observation");
    const dry = await K.planUpdate(s, release, { today, migrate: [job] });
    assert.ok(dry.dry_run); assert.match(dry.summary, /^Nothing you entered changes\./);
    assert.equal(dry.rules_from, "2026-07-01", "a rule starts after the last locked month");
    assert.ok(dry.moved.some((m) => m.category === "UTILITIES" && m.month === "2026-07"), "the phone moves in the open month");
    assert.ok(dry.proposals.some((p) => p.period === "2026-06"), "and the locked month is a proposal");
    await assert.rejects(K.update(s, release, { today, migrate: [{ ...job, map: { ...job.map, cents: { value: 0 } } }] }), /would not carry across whole/, "a migration that loses money is refused, and writes nothing");
    assert.equal((await s.tables.read("decision")).filter((d) => /^update-/.test(d.decision_id)).length, 0);
    const t = await K.update(s, release, { today, migrate: [job], by: "Sam" });
    assert.deepEqual(t.originals_changed, []); assert.deepEqual(t.locked_moved, []); assert.deepEqual(t.unbound, []);
    assert.equal(await tables(), was, "the family's own table stays as it was");
    assert.deepEqual((await s.tables.read("observation")).length, before.length);
    assert.equal(t.carried[0].read_back, 2);
    assert.deepEqual(await K.ask(s, { from: "x_jars", date: "on", group: ["party_id", "jar"], sum: "cents" }, {}), example.result);
    assert.deepEqual(t.tailoring.map((c) => c.status), ["pass", "pass"]);
    const row = (await s.tables.read("tailoring")).reverse().find((r) => r.name === "jars");
    assert.equal(row.status, "promoted");
    assert.ok(store_backup_ok(t));
    const { L: after } = await K.rebuildAt(s, { today });
    const july = after.cash.find((m) => m.month === "2026-07"), june = after.cash.find((m) => m.month === "2026-06");
    assert.equal(july.byCategory.UTILITIES, -3000, "the rule moves what no person decided"); assert.equal(july.byCategory.TELCO, -4100, "and a person's own answer stands");
    assert.equal(june.byCategory.UTILITIES, undefined, "June stays as it was locked");
    assert.equal(after.checks.filter((c) => c.law === "L12" && c.status === "fail").length, 0);
  });

  test(`spawn on ${kind}: the jars go with them, and what stays adds to nothing`, async () => {
    const today = "2046-03-20", s = make(), own = make();
    await K.init(s, { name: "Home", people: [{ name: "Sam" }, { name: "Salt", role: "dependant", birth_date: "2028-03-20" }], today: "2036-01-01" });
    const ext = K.SHARED_EXTENSIONS["pocket-money"];
    await s.define(ext.table.name, ext.table.columns);
    await K.record(s, "account", [{ account_id: "MEMO-SALT-SAVE", name: "Save jar", class: "memo", type: "memo", reporting_group: "memo", currency: "AUD", in_scope: false }], {});
    await K.writeOwn(s, "x_jars", [{ entry_id: "a", on: "2036-04-05", party_id: "SALT", jar: "save", kind: "allowance", cents: 150 }, { entry_id: "b", on: "2036-04-12", party_id: "SALT", jar: "save", kind: "allowance", cents: 150 }, { entry_id: "c", on: "2036-04-12", party_id: "SAM", jar: "spend", kind: "allowance", cents: 99 }], { today });
    await assert.rejects(K.spawn(s, own, { party: "SALT", table: "x_jars", today }), /needs someone's yes/);
    const r = await K.spawn(s, own, { party: "SALT", table: "x_jars", memo: ["MEMO-SALT-SAVE"], today, consent: yes("Salt", "It's mine.") });
    assert.equal(r.moved_cents, 300); assert.equal(r.rows, 2);
    const q = { from: "x_jars", date: "on", group: ["party_id", "jar"], sum: "cents" };
    assert.deepEqual(await K.ask(own, q, {}), { "SALT": { save: 300 } });
    assert.deepEqual((await K.ask(s, q, {})).SALT, { save: 0 }, "nothing counted in two households");
    assert.deepEqual((await K.ask(s, q, {})).SAM, { spend: 99 }, "and nobody else's jar moved");
    assert.ok((await s.tables.read("account")).reverse().find((a) => a.account_id === "MEMO-SALT-SAVE").closed_on === today);
    assert.equal((await own.tables.read("party"))[0].birth_date, "2028-03-20");
  });
}
const store_backup_ok = (t) => /^[0-9a-f]{64}$/.test(t.backup);

test("age bands come from birth_date and the shared extension: jars at 5, an account at 14, a Kitty at 18", () => {
  const ext = K.SHARED_EXTENSIONS["pocket-money"], on = "2036-03-31";
  assert.equal(K.stageOf(ext, "2031-04-01", on).stage, "too_young");
  assert.equal(K.stageOf(ext, "2031-03-31", on).stage, "jars");
  assert.equal(K.stageOf(ext, "2022-04-01", on).stage, "jars");
  assert.equal(K.stageOf(ext, "2022-03-31", on).stage, "own_account");
  assert.equal(K.stageOf(ext, "2018-03-31", on).stage, "own_kitty");
  assert.equal(K.ageOn("2028-03-20", "2036-03-31"), 8);
});
