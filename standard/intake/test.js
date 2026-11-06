/* The proof: node --test standard/intake/test.js. Ingests every file the world wrote and shows that each family parses, every manifest count
   matches, the gate passes every recipe, a wrong recipe fails it, and observation totals agree with truth, which the world computed on its own. */
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { ingest, gateAll, loadRecipes, walkRoot, hostInflate, loadVocab } = require("./index");
const { decode } = require("./containers");
const { fingerprint } = require("./fingerprint");
const { run, parseCents, parseDate } = require("./recipe");
const { gate } = require("./gate");
const { sha256 } = require("./sha256");

const ROOT = path.join(__dirname, "..", ".build", "world");
const REPO = path.join(__dirname, "..", "..");
if (!fs.existsSync(path.join(ROOT, "manifest.json"))) execFileSync("node", [path.join(__dirname, "..", "world", "build.js")], { stdio: "inherit" });
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
const recipes = loadRecipes(path.join(__dirname, "..", "recipes"));
const result = ingest({ root: ROOT, recipes, manifest });
const facts = new Map(manifest.files.map((f) => [f.path, f]));
const readTruth = (n) => JSON.parse(fs.readFileSync(path.join(ROOT, "truth", `${n}.json`), "utf8"));
const readSetup = (n) => JSON.parse(fs.readFileSync(path.join(ROOT, "setup", `${n}.json`), "utf8"));

const accountOf = (() => {
  const accounts = new Set(readSetup("account").map((a) => a.account_id)), alias = new Map();
  const norm = (s) => String(s).toUpperCase().replace(/[\s\-_.]/g, "");
  for (const a of readSetup("alias")) if (a.subject_type === "account") alias.set(norm(a.value), a.subject_id);
  return (ref) => (accounts.has(ref) ? ref : alias.get(norm(ref)) || null);
})();
const sourceById = new Map(result.sources.map((s) => [s.source_id, s]));

test("every file reaches a recipe, except the scans a recipe honestly cannot read", () => {
  const unknown = result.unknown_files;
  const agent = new Set(manifest.files.filter((f) => f.tier === "agent").map((f) => f.path));
  assert.deepStrictEqual(unknown.filter((u) => !agent.has(u.path)).map((u) => `${u.path}: ${u.reason}`), []);
  for (const u of unknown) assert.strictEqual(u.reason, "agent_tier");
  assert.strictEqual(unknown.length, agent.size);
});

test("each file used the recipe the manifest expected, and no fault was raised", () => {
  for (const e of result.files) { if (e.duplicate_of) continue; const f = facts.get(e.path); if (f.tier === "agent") continue; assert.strictEqual(e.recipe, f.recipe, e.path); }
  assert.deepStrictEqual(result.faults.slice(0, 5), []);
});

test("every manifest observation count matches, by kind", () => {
  const dup = new Map(result.files.filter((e) => e.duplicate_of).map((e) => [e.path, e.duplicate_of]));
  for (const e of result.files) {
    const f = facts.get(e.path);
    if (f.tier === "agent") continue;
    const of = e.duplicate_of ? { observations: facts.get(e.duplicate_of).observations, by_kind: facts.get(e.duplicate_of).by_kind } : e;
    assert.strictEqual(of.observations, f.observations, e.path);
    if (!e.duplicate_of) assert.deepStrictEqual(sorted(e.by_kind || {}), sorted(zeroless(f.by_kind)), e.path);
  }
  const want = manifest.files.filter((f) => f.tier !== "agent" && !dup.has(f.path)).reduce((s, f) => s + f.observations, 0);
  assert.strictEqual(result.observations.length, want);
});
const zeroless = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v));
const sorted = (o) => Object.fromEntries(Object.entries(o).sort());

test("the gate passes every recipe over its whole family", () => {
  const { verdicts, unknown } = gateAll({ root: ROOT, recipes });
  const failed = verdicts.filter((v) => v.status !== "pass");
  assert.deepStrictEqual(failed.map((v) => [v.recipe, v.failures.slice(0, 3)]), []);
  const used = new Set(manifest.files.filter((f) => f.tier !== "agent").map((f) => f.recipe));
  assert.deepStrictEqual([...used].filter((r) => !verdicts.some((v) => v.recipe === r)), []);
  assert.strictEqual(unknown.length, manifest.files.filter((f) => f.tier === "agent").length);
});

test("txn lines per account per month equal truth", () => {
  const truth = readTruth("txn_by_month"), got = {};
  const witness = new Set(manifest.files.filter((f) => f.witness_of).map((f) => f.path));
  for (const o of result.observations) {
    if (o.kind !== "txn_line") continue;
    const src = sourceById.get(o.source_id); if (witness.has(src.uri)) continue;
    const a = accountOf(o.payload.account_ref); assert.ok(a, `unresolved ${o.payload.account_ref}`);
    const m = o.payload.posting_date.slice(0, 7), x = ((got[a] = got[a] || {})[m] = (got[a] || {})[m] || { count: 0, sum_cents: 0 });
    x.count += 1; x.sum_cents += o.payload.amount_cents;
  }
  assert.deepStrictEqual(Object.keys(got).sort(), Object.keys(truth).sort());
  for (const a of Object.keys(truth)) for (const m of Object.keys(truth[a])) {
    assert.ok(got[a][m], `${a} ${m} missing`);
    assert.strictEqual(got[a][m].count, truth[a][m].count, `${a} ${m} count`);
    assert.strictEqual(got[a][m].sum_cents, truth[a][m].sum_cents, `${a} ${m} sum`);
  }
});

test("the six sheeted accounts land on the sheet's balances to the cent", () => {
  const truth = readTruth("txn_by_month"), oracle = readTruth("sheet_oracle");
  for (const a of ["ACC-EVD", "ACC-OFF", "ACC-SAV", "ACC-HOL", "ACC-CC", "ACC-RNT"]) for (const b of oracle.balances.filter((x) => x.account_id === a)) {
    const m = b.month_end.slice(0, 7), ms = Object.keys(truth[a]).filter((k) => k <= m).sort(), last = truth[a][ms[ms.length - 1]];
    assert.strictEqual(last.closing_cents, Math.round(b.balance * 100), `${a} ${b.month_end}`);
  }
});

test("a wrong recipe fails the gate", () => {
  const vocab = loadVocab(), inflate = hostInflate(), byId = new Map(recipes.map((r) => [r.id, r]));
  const family = (id) => walkRoot(ROOT).filter((f) => facts.get(f.path).recipe === id).slice(0, 24).map((f) => ({ path: f.path, stream: f.stream, decoded: decode(f.bytes, { inflate }) }));
  const clone = (r) => JSON.parse(JSON.stringify(r));
  const harbour = family("harbour-txn-csv");
  assert.strictEqual(gate(byId.get("harbour-txn-csv"), harbour, { vocab }).status, "pass");
  const mdy = clone(byId.get("harbour-txn-csv")); mdy.defaults.date = "mdy";
  const v1 = gate(mdy, harbour, { vocab }); assert.strictEqual(v1.status, "fail"); assert.strictEqual(v1.checks.date_order, "fail");
  const swap = clone(byId.get("harbour-txn-csv")); swap.emit[0].fields.amount_cents = { credit: "Debit Amount", debit: "Credit Amount" };
  const v2 = gate(swap, harbour, { vocab }); assert.strictEqual(v2.status, "fail"); assert.strictEqual(v2.checks.sign, "fail");
  const order = clone(byId.get("bark-noheader-csv")); order.table.order = "oldest_first";
  assert.strictEqual(gate(order, family("bark-noheader-csv"), { vocab }).checks.sign, "fail");
  const slip = clone(byId.get("pawroll-payslip-pdf")); slip.values.net_cents = { right: "^Ordinary hours, salary$", as: "cents" };
  assert.strictEqual(gate(slip, family("pawroll-payslip-pdf"), { vocab }).checks.controls, "fail");
  const unread = clone(byId.get("pawroll-income-statement-pdf")); unread.furniture = [];
  assert.strictEqual(gate(unread, family("pawroll-income-statement-pdf"), { vocab }).checks.rows, "fail");
  const card = clone(byId.get("southern-activity-csv")); card.emit[0].fields.amount_cents = { col: "Amount", as: "cents" };
  assert.strictEqual(gate(card, family("southern-activity-csv"), { vocab }).checks.controls, "fail");
});

test("the world is deterministic: a second build gives the same bytes", () => {
  const { buildWorld } = require("../world/build");
  const w = buildWorld(), crypto = require("crypto");
  const again = new Map(w.files.map((f) => [f.path, crypto.createHash("sha256").update(f.bytes).digest("hex")]));
  assert.strictEqual(again.size, manifest.files.length);
  for (const f of manifest.files) assert.strictEqual(again.get(f.path), f.sha256, f.path);
});

test("the served files are the repo's sources, byte for byte", () => {
  for (const acct of ["ACC-EVD", "ACC-OFF", "ACC-SAV", "ACC-HOL", "ACC-CC", "ACC-RNT"]) {
    const dir = path.join(REPO, "sources", acct);
    for (const day of fs.readdirSync(dir)) for (const name of fs.readdirSync(path.join(dir, day))) {
      if (name.startsWith(".")) continue;
      const a = fs.readFileSync(path.join(dir, day, name)), b = fs.readFileSync(path.join(ROOT, "sources", acct, day, name));
      assert.ok(a.equals(b), `${acct}/${day}/${name}`);
    }
  }
});

test("the decoders read the real portal PDFs and small cases exactly", () => {
  const inflate = hostInflate();
  const d = decode(new Uint8Array(fs.readFileSync(path.join(REPO, "period-close", "fixtures", "Purrsure-RenewalNotice-RENTAL-2026.pdf"))), { inflate });
  assert.ok(d.lines.some((l) => l.text === "Policy period 15 Sep 2026 to 14 Sep 2027"));
  assert.strictEqual(parseCents("-A$1,234.50"), -123450); assert.strictEqual(parseCents("(12.30)"), -1230); assert.strictEqual(parseCents("12.30 DR"), -1230); assert.strictEqual(parseCents("1.2.3"), null);
  assert.strictEqual(parseDate("31/02/2020", "dmy"), null); assert.strictEqual(parseDate("07 Mar 2019", "dmony"), "2019-03-07");
  assert.strictEqual(sha256(new TextEncoder().encode("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  const a = decode(new TextEncoder().encode("Date,Amount\n01/02/2020,\"1,000.00\"\n")), b = decode(new TextEncoder().encode("Date,Amount\r\n09/12/2024,\"7.00\"\r\n"));
  assert.strictEqual(fingerprint(a), fingerprint(b));
});
