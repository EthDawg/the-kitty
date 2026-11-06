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

// ---------- the world against the schema: what the core engineer reads must be what the standard says ----------
const SCHEMA = { tables: JSON.parse(fs.readFileSync(path.join(__dirname, "..", "schema", "tables.json"), "utf8")).tables, obs: loadVocab(), terms: JSON.parse(fs.readFileSync(path.join(__dirname, "..", "schema", "terms.json"), "utf8")).terms };
const colsOf = (t) => t.columns.map((c) => { const [name, type, ...flags] = c.split(":"); return { name, type, req: flags.includes("req") || flags.includes("pk"), en: (flags.find((f) => f.startsWith("enum=")) || "").slice(5).split("|").filter(Boolean), fk: (flags.find((f) => f.startsWith("fk=")) || "").slice(3) }; });

test("setup rows conform to the schema: columns, required fields, enums, foreign keys", () => {
  const rowsOf = {}; for (const f of fs.readdirSync(path.join(ROOT, "setup"))) rowsOf[f.replace(".json", "")] = readSetup(f.replace(".json", ""));
  const bad = [];
  for (const [table, rows] of Object.entries(rowsOf)) {
    const t = SCHEMA.tables[table]; assert.ok(t, `no table ${table}`);
    const cols = colsOf(t), names = new Set(cols.map((c) => c.name));
    for (const r of rows) {
      for (const k of Object.keys(r)) if (!names.has(k) && !k.startsWith("x_")) bad.push(`${table}.${k} unknown`);
      for (const c of cols) {
        const v = r[c.name];
        if (c.req && (v == null || v === "")) bad.push(`${table}.${c.name} missing`);
        if (v != null && c.en.length && !c.en.includes(String(v))) bad.push(`${table}.${c.name}=${v}`);
        if (v != null && c.fk) { const [ft, fc] = c.fk.split("."); if (rowsOf[ft] && !rowsOf[ft].some((x) => x[fc] === v)) bad.push(`${table}.${c.name}=${v} has no ${c.fk}`); }
      }
    }
  }
  assert.deepStrictEqual([...new Set(bad)], []);
});

test("every term name is in the vocabulary for its subject", () => {
  const assets = new Map(readSetup("asset").map((a) => [a.asset_id, a.kind])), contracts = new Map(readSetup("contract").map((c) => [c.contract_id, c.kind])), bad = [];
  for (const r of readSetup("term")) {
    const section = r.subject_type === "asset" ? `asset.${assets.get(r.subject_id)}` : r.subject_type === "contract" ? `contract.${contracts.get(r.subject_id)}` : r.subject_type === "party" ? "party.person" : "account.any";
    if (!(SCHEMA.terms[section] || {})[r.term]) bad.push(`${section}.${r.term}`);
  }
  assert.deepStrictEqual([...new Set(bad)], []);
});

test("ownership shares sum to 100% per subject, basis and day", () => {
  const rows = readSetup("ownership"), groups = {};
  for (const r of rows) (groups[`${r.subject_type}|${r.subject_id}|${r.basis}`] = groups[`${r.subject_type}|${r.subject_id}|${r.basis}`] || []).push(r);
  for (const [k, g] of Object.entries(groups)) for (const d of new Set(g.map((r) => r.valid_from))) {
    const sum = g.filter((r) => r.valid_from <= d && (r.valid_to == null || d < r.valid_to)).reduce((s, r) => s + r.share_bps, 0);
    assert.strictEqual(sum, 10000, `${k} on ${d}`);
  }
});

test("observations use only the closed enums", () => {
  const en = SCHEMA.obs.enums;
  for (const o of result.observations) for (const [k, list] of Object.entries(en)) {
    const [kind, field] = k.split("."); if (o.kind !== kind || o.payload[field] == null) continue;
    assert.ok(list.includes(o.payload[field]), `${k}=${o.payload[field]} at ${o.locator}`);
  }
});

// ---------- observations against truth, domain by domain ----------
const obsOf = (kind) => result.observations.filter((o) => o.kind === kind);
const cents = (n) => Math.round(n * 100);

test("the card statements are a second witness to the activity files, line for line", () => {
  const key = (o) => `${o.payload.posting_date}|${o.payload.amount_cents}`, count = (list) => { const m = {}; for (const o of list) m[key(o)] = (m[key(o)] || 0) + 1; return m; };
  const witness = new Set(manifest.files.filter((f) => f.witness_of === "ACC-CC").map((f) => f.path));
  const a = [], b = [];
  for (const o of obsOf("txn_line")) { const src = sourceById.get(o.source_id); if (witness.has(src.uri)) b.push(o); else if (accountOf(o.payload.account_ref) === "ACC-CC" && o.payload.posting_date <= "2027-03-14") a.push(o); }
  assert.strictEqual(a.length, b.length); assert.deepStrictEqual(count(a), count(b));
  const paged = manifest.files.filter((f) => f.family === "amewx-statement-pdf").length;
  assert.ok(paged > 70);
  const st = obsOf("statement").filter((o) => witness.has(sourceById.get(o.source_id).uri)).sort((x, y) => (x.payload.period_end < y.payload.period_end ? -1 : 1));
  for (let i = 1; i < st.length; i++) assert.strictEqual(st[i].payload.opening_cents, st[i - 1].payload.closing_cents);
});

test("at least one PDF table wraps across pages, and it still reads", () => {
  const inflate = hostInflate(); let wrapped = 0;
  for (const f of manifest.files.filter((x) => x.family === "amewx-statement-pdf")) { const d = decode(new Uint8Array(fs.readFileSync(path.join(ROOT, f.path))), { inflate }); if (d.meta.pages > 1) wrapped += 1; }
  assert.ok(wrapped > 20, `${wrapped} wrapped`);
});

test("payslips and income statements equal truth; the base payslip counts hold", () => {
  const truth = readTruth("payslips"), got = new Map(obsOf("payslip").map((o) => [`${o.payload.person_ref}|${o.payload.employer_ref}|${o.payload.pay_date}`, o.payload]));
  assert.strictEqual(truth.filter((t) => ["Northwind Logistics", "Bayview Health"].includes(t.employer)).length, 417);
  for (const t of truth) { const p = got.get(`${t.person} Davies|${t.employer}|${t.pay_date}`); assert.ok(p); for (const k of ["gross_cents", "tax_cents", "super_cents", "net_cents", "ytd_gross_cents", "ytd_tax_cents", "ytd_super_cents"]) assert.strictEqual(p[k], t[k], `${t.pay_date} ${k}`); }
  const is = new Map(obsOf("income_statement").map((o) => [`${o.payload.person_ref}|${o.payload.employer_ref}|${o.payload.fy}`, o.payload]));
  for (const t of readTruth("income_statements")) { const p = is.get(`${t.person} Davies|${t.employer}|FY${t.fy}`); assert.ok(p); assert.strictEqual(p.gross_cents, t.gross_cents); assert.strictEqual(p.tax_cents, t.tax_cents); }
});

test("loan statements carry the lender's interest as months.json has it, every month", () => {
  const truth = readTruth("loans"), got = {};
  for (const o of obsOf("loan_statement")) got[`${accountOf(o.payload.account_ref)}|${o.payload.period_start.slice(0, 7)}`] = o.payload;
  for (const [loan, rows] of Object.entries(truth)) for (const r of rows) { const p = got[`${loan}|${r.month}`]; assert.ok(p, `${loan} ${r.month}`); for (const k of ["opening_cents", "interest_cents", "repayments_cents", "closing_cents"]) assert.strictEqual(p[k], r[k], `${loan} ${r.month} ${k}`); assert.strictEqual(p.rate_pct, r.rate_pct); }
});

test("rate notices give every change, and the 2025 cut is notified twice with the backdate", () => {
  const truth = readTruth("rate_notices"), got = obsOf("rate_notice").map((o) => o.payload);
  assert.strictEqual(got.length, truth.length);
  for (const t of truth) assert.ok(got.some((p) => p.value === t.value && p.effective_on === t.effective_on && p.notified_on === t.notified_on), `${t.contract} ${t.effective_on}`);
  const cut = got.filter((p) => p.contract_ref === "033-142 812 006 310" && p.value === "5.79" && p.effective_on >= "2025-01-01").map((p) => [p.effective_on, p.notified_on]).sort();
  assert.deepStrictEqual(cut, [["2025-08-25", "2025-09-10"], ["2025-09-01", "2025-09-03"]]);
});

test("super lands on the sheet each month; contributions follow the payslips with their lag", () => {
  const oracle = readTruth("sheet_oracle"), sup = readTruth("super");
  for (const id of ["SUPER-J", "SUPER-M"]) {
    const lines = obsOf("super_line").filter((o) => accountOf(o.payload.account_ref) === id).sort((a, b) => (a.payload.posting_date < b.payload.posting_date ? -1 : a.payload.posting_date > b.payload.posting_date ? 1 : 0));
    const atMonth = {}; for (const o of lines) atMonth[o.payload.posting_date.slice(0, 7)] = (atMonth[o.payload.posting_date.slice(0, 7)] || 0) + o.payload.amount_cents;
    let bal = sup.opening[id]; const closing = {}; for (const ym of Object.keys(atMonth).sort()) { bal += atMonth[ym]; closing[ym] = bal; }
    for (const b of oracle.balances.filter((x) => x.account_id === id)) assert.strictEqual(closing[b.month_end.slice(0, 7)], cents(b.balance), `${id} ${b.month_end}`);
  }
  const paid = {}; for (const o of obsOf("super_line")) if (o.payload.line_type === "employer") paid[accountOf(o.payload.account_ref)] = (paid[accountOf(o.payload.account_ref)] || 0) + o.payload.amount_cents;
  const want = {}; for (const c of sup.contributions) want[c.fund] = (want[c.fund] || 0) + c.cents;
  assert.deepStrictEqual(paid, want);
  for (const c of sup.contributions) if (c.quarter_end) { const days = (Date.parse(c.date) - Date.parse(c.quarter_end)) / 864e5; assert.ok(days > 0 && days <= 28, `${c.date}`); }
});

test("holdings land on the sheet's ETF value through prices, and RSUs and crypto on theirs", () => {
  const oracle = readTruth("sheet_oracle"), by = {};
  for (const o of obsOf("holding")) if (accountOf(o.payload.account_ref) === "ETF" || sourceById.get(o.source_id).stream_id === "BRK-HOLD") by[o.payload.as_at] = (by[o.payload.as_at] || 0) + o.payload.value_cents;
  for (const b of oracle.balances.filter((x) => x.account_id === "ETF")) assert.strictEqual(by[b.month_end], cents(b.balance), b.month_end);
  const at = (stream) => obsOf("holding").filter((o) => sourceById.get(o.source_id).stream_id === stream && o.payload.as_at === "2027-01-31").reduce((s, o) => s + o.payload.value_cents, 0);
  assert.strictEqual(at("CRYPTO-STMT"), 185040); assert.strictEqual(at("RSU-HOLD"), 122750);
  const v = obsOf("vest").find((o) => o.payload.vest_date === "2027-01-15").payload;
  assert.strictEqual(v.units, "25"); assert.strictEqual(v.price, "30.125"); assert.strictEqual(v.taxable_value_cents, 120500); assert.strictEqual(Number(v.fx_rate) * 30.125, 48.2);
});

test("valuations land on the sheet, month by month", () => {
  const oracle = readTruth("sheet_oracle"), got = {};
  for (const o of obsOf("valuation")) got[`${o.payload.subject_ref}|${o.payload.as_at}`] = o.payload.value_cents;
  const names = { HOME: "22 Albion Crescent, Brunswick VIC 3056", RENTAL: "7/41 Moorabool Lane, Geelong VIC 3220", CAR: "Subaru Forester, 2022" };
  for (const b of oracle.balances.filter((x) => names[x.account_id])) assert.strictEqual(got[`${names[b.account_id]}|${b.month_end}`], cents(b.balance), `${b.account_id} ${b.month_end}`);
  assert.strictEqual(got["Laptop|2027-01-31"], 240000);
});

test("the twelve ATO refunds fix FY2019 to FY2024 to the cent; later refunds reach ACC-OLD", () => {
  const tax = readTruth("tax"), lead = new Map();
  for (const o of obsOf("tax_assessment")) { const k = `${o.payload.person_ref}|${o.payload.fy}|${o.payload.version}`; if (!lead.has(k)) lead.set(k, []); lead.get(k).push(o.payload); }
  const refunds = obsOf("txn_line").filter((o) => o.payload.description === "ATO TAX REFUND").map((o) => [accountOf(o.payload.account_ref), o.payload.amount_cents]);
  for (const person of ["JORDAN", "MIA"]) for (const [fy, t] of Object.entries(tax[person])) {
    const name = `${person === "JORDAN" ? "Jordan" : "Mia"} Davies`, version = t.version;
    const docs = lead.get(`${name}|${fy}|${version}`); assert.strictEqual(docs.length, 2, `${name} ${fy}`);
    for (const p of docs) { assert.strictEqual(p.result_cents, t.result_cents); assert.strictEqual(p.taxable_income_cents, t.taxable_income_cents); assert.strictEqual(p.payg_credits_cents, t.payg_credits_cents); }
    const orig = t.original || t;
    assert.ok(refunds.some(([a, c]) => c === orig.result_cents && (Number(fy.slice(2)) >= 2025 ? a === "ACC-OLD" : a === "ACC-EVD")), `${name} ${fy} ${orig.result_cents}`);
    assert.ok(orig.rounding_credit_cents >= 0 && orig.rounding_credit_cents < 100);
    const labels = docs.find((p) => p.labels).labels; assert.ok(labels.some((l) => l.role === "subtotal") && labels.every((l) => l.line_id && l.role));
  }
  const extra = tax.MIA.FY2023.original.result_cents - tax.MIA.FY2023.result_cents;
  assert.ok(extra > 0 && obsOf("txn_line").some((o) => o.payload.description === "ATO AMENDED ASSESSMENT PAYMENT" && o.payload.amount_cents === -extra));
});

test("bills, gaps and rents clear real bank lines; nothing a document says is a new cost", () => {
  const has = new Set(obsOf("txn_line").map((o) => `${accountOf(o.payload.account_ref)}|${o.payload.posting_date}|${o.payload.amount_cents}`));
  for (const b of readTruth("bills")) assert.ok(has.has(b.line.join("|")), `${b.kind} ${b.line}`);
  for (const c of readTruth("childcare")) assert.ok(has.has(c.line.join("|")), c.month);
  const ccs = obsOf("childcare_statement"); assert.strictEqual(ccs.length, readTruth("childcare").length);
  const own = obsOf("owner_statement").filter((o) => o.payload.property_ref === "GF-20931");
  for (const o of own) { if (o.payload.period_end > "2027-02-28") continue; const paid = obsOf("txn_line").find((t) => accountOf(t.payload.account_ref) === "ACC-RN2" && t.payload.amount_cents === o.payload.disbursed_cents && /GOLDPAWS/.test(t.payload.description)); assert.ok(paid, o.payload.period_end); }
  for (const a of readTruth("assets").assets) if (a.witness) assert.ok(has.has(a.witness.join("|")), a.asset_id);
  for (const s of readTruth("settlements")) for (const l of s.witnesses) assert.ok(has.has(l.join("|")), l.join());
});

test("the portal's own PDFs read through the world's recipes, byte for byte the same shape", () => {
  const inflate = hostInflate(), vocab = loadVocab(), byId = new Map(recipes.map((r) => [r.id, r]));
  const read = (name, id) => { const d = decode(new Uint8Array(fs.readFileSync(path.join(REPO, "period-close", "fixtures", name))), { inflate }), r = byId.get(id); assert.ok(r.fingerprints.includes(fingerprint(d)), `${name} fingerprint`); return run(r, d, { vocab, stream: "POL" }); };
  const a = read("Purrsure-RenewalNotice-RENTAL-2026.pdf", "purrsure-renewal-pdf");
  assert.deepStrictEqual(a.faults, []); assert.strictEqual(a.observations[0].payload.premium_cents, 170200); assert.strictEqual(a.observations[0].payload.period_end, "2027-09-14");
  const b = read("Purrsure-CertificateOfCurrency-HOME-2026.pdf", "purrsure-certificate-pdf");
  assert.deepStrictEqual(b.faults, []); assert.strictEqual(b.observations[0].payload.premium_cents, 182000);
});

test("a recipe is under a kilobyte's worth of ideas: no code anywhere in it", () => {
  for (const r of recipes) { const s = JSON.stringify(r); assert.ok(!/function\s*\(|=>|require\(|eval\(/.test(s), r.id); assert.ok(r.fingerprints.length >= 1, r.id); }
  const md = path.join(__dirname, "..", "RECIPES.md");
  if (fs.existsSync(md)) assert.ok(fs.readFileSync(md, "utf8").split(/\s+/).length < 1500);
});

test("the world's tax tables agree with the reference file, once it exists", { skip: !fs.existsSync(path.join(__dirname, "..", "reference", "au.json")) }, () => {
  const ref = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "reference", "au.json"), "utf8")), T = require("../world/tax/tables");
  const s = ref.series.resident_tax_brackets.rows;
  for (const fy of [2019, 2020, 2021, 2024, 2025, 2026]) {
    const row = s.filter((r) => r.valid_from <= `${fy}-06-30` && (r.valid_to == null || `${fy}-06-30` < r.valid_to))[0]; if (!row) continue;
    const list = JSON.stringify(row.value), ours = T.brackets(fy);
    for (const [from] of ours) if (from) assert.ok(list.includes(String(from)), `FY${fy} ${from}`);
  }
});
