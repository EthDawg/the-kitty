#!/usr/bin/env node
/* Does the adapter give the page what the v2 sheet gives it? The benchmark Davies world goes through modelFromStandard and is compared with E.model(data/snapshot-v2.json),
   field by field, on every field the page reads. The fields come from the source, not from a list here: a top-level read is `m.x` in src/app.js, src/kit or the page half
   of src/engine.js, and a row field is a key of a v2 row that some `.key` in that source reads. This is the path that retires src/engine.js, so a difference is
   explained or it fails: see WHY below and parity.test.js. It compares what the two hold for the same accounts and the same window, and it says when the world holds more.
     node tools/page-parity.js            print the table
     node tools/page-parity.js --write    also write src/household/PARITY.md and parity-baseline.json */
"use strict";
const fs = require("fs"), path = require("path");
const K = require("../src/household/node.js");
const { loadWorld } = require("../src/household/world");
const { modelFromStandard, UNSTATED } = require("../src/household/model");
const V = require("../standard/engine/views");
const { allMetrics } = require("../standard/engine/metrics");
const { base } = require("../src/household/base");
const E = require("../src/engine.js");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

// Text that reads the model. engine.js builds the model in E.model, and everything after it reads one.
function pageSource() {
  const engine = read("src/engine.js"), from = engine.indexOf("// ---------- windows and spending ----------");
  const kit = fs.readdirSync(path.join(root, "src/kit")).filter((f) => f.endsWith(".js")).map((f) => read(`src/kit/${f}`));
  return [read("src/app.js"), ...kit, engine.slice(from)].join("\n");
}
const ROWS = { accounts: (r) => r.id, cats: (r) => r.id, tx: (r) => `${r.date}|${r.acct}|${r.amount.toFixed(2)}|${r.desc}`, entries: (r) => `${r.kind}|${r.date}|${r.acct}|${r.amount.toFixed(2)}|${r.raw}`, balances: (r) => `${r.month}|${r.acct}`, networth: (r) => r.month, cashflow: (r) => r.month, goals: (r) => r.name, loans: (r) => r.id, contracts: (r) => r.name, payslips: (r) => `${r.date}|${r.person}|${r.net}`, rules: (r) => r.pattern, decisions: (r) => `${r.decision}|${r.value}|${r.at}`, subs: (r) => r.service, checks: (r) => r.name, budget: (r) => r.name, savings: (r) => r.title, assets: (r) => r.id, cfcats: (r) => r.name };
const SAME_AS = { acctById: "accounts", catById: "cats", entryById: "entries" };
const SKIP_TOP = new Set(["merMemo", "ruleIndex", "fetchedAt", "out", "in", "month"]);   // the memo caches, and `m.in` where m is a month row, not the model
const SKIP_ROW = new Set(["entries", "row", "mer", "decisions", "reviewed", "lastUsedRaw", "rawPj", "rawCj"]);

function fieldsRead(v2) {
  const src = pageSource(), tops = new Set(), names = new Set(), metrics = new Set(), settings = new Set(), kitty = new Set();
  for (const m of src.matchAll(/\b(?:S\.)?m\.([a-zA-Z_]\w*)/g)) tops.add(SAME_AS[m[1]] || m[1]);
  for (const m of src.matchAll(/\.([a-zA-Z_]\w*)/g)) names.add(m[1]);
  for (const m of src.matchAll(/metrics\[\s*"([^"]+)"\s*\]/g)) metrics.add(m[1]);
  for (const m of src.matchAll(/settings\[\s*"([^"]+)"\s*\]/g)) settings.add(m[1]);
  for (const m of src.matchAll(/kitty\.([a-zA-Z_]\w*)/g)) kitty.add(m[1]);
  const out = [];
  for (const top of [...tops].sort()) {
    if (SKIP_TOP.has(top) || !(top in v2)) continue;
    const v = v2[top];
    if (Array.isArray(v) && ROWS[top]) { const keys = new Set(v.flatMap((r) => Object.keys(r))); for (const k of [...keys].sort()) if (names.has(k) && !SKIP_ROW.has(k)) out.push({ field: `${top}[].${k}`, top, key: k }); if (!keys.size) out.push({ field: `${top}[]`, top, key: null }); continue; }
    if (top === "metrics") { for (const id of [...metrics].sort()) out.push({ field: `metrics["${id}"]`, top, metric: id }); continue; }
    if (top === "settings") { for (const id of [...settings].sort()) out.push({ field: `settings["${id}"]`, top, setting: id }); continue; }
    if (top === "kitty") { for (const id of [...kitty].sort()) out.push({ field: `kitty.${id}`, top, kitty: id }); continue; }
    if (top === "mortgage") { for (const k of Object.keys(v)) if (names.has(k)) out.push({ field: `mortgage.${k}`, top, key: k, nested: true }); continue; }
    if (v instanceof Set || v instanceof Map) { out.push({ field: top, top, set: true }); continue; }
    if (typeof v === "object" && v && !Array.isArray(v)) continue;
    out.push({ field: top, top, scalar: true });
  }
  return out;
}
const same = (a, b, key) => {
  const blank = (x) => x === null || x === undefined || x === "" || (typeof x === "number" && Number.isNaN(x));
  if (blank(a) && blank(b)) return true;
  if (key === "transferId") return blank(a) === blank(b);   // a pair on each side. The ids are minted differently.
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 0.0051;
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a)) return Object.keys(a).every((k) => same(a[k], b[k]));
  if (Array.isArray(a) || (a && typeof a === "object")) return JSON.stringify(a) === JSON.stringify(b);
  return String(a) === String(b);
};
function compare(field, v2, m) {
  const r = { field: field.field, matches: 0, differs: 0, extra: 0, sample: null };
  const miss = (w, s) => { r.differs += 1; if (!r.sample) r.sample = `${w}: v2 ${JSON.stringify(s[0])}, adapter ${JSON.stringify(s[1])}`; };
  const check = (w, a, b) => { if (same(a, b, field.key)) r.matches += 1; else miss(w, [a, b]); };
  if (field.metric) { const a = v2.metrics[field.metric], b = m.metrics[field.metric]; if (a) check(field.metric, a.num ?? a.text, b ? b.num ?? b.text : null); return r; }
  if (field.setting) { check(field.setting, v2.settings[field.setting], m.settings[field.setting]); return r; }
  if (field.kitty) { check(field.kitty, v2.kitty[field.kitty], m.kitty[field.kitty]); return r; }
  if (field.set) {
    const norm = (mm, s) => { const ids = s instanceof Map ? [...s.keys()] : [...s]; return ids.map((id) => { const e = mm.entryById[id]; return e ? `${e.date}|${e.acct}|${e.amount.toFixed(2)}|${e.raw}` : id; }); };
    const a = new Set(norm(v2, v2[field.top]).filter((k) => k >= v2.windowFrom)), b = new Set(norm(m, m[field.top]).filter((k) => k >= v2.windowFrom));
    for (const k of a) { if (b.has(k)) r.matches += 1; else miss(k, [k, null]); }
    r.extra = [...b].filter((k) => !a.has(k)).length;
    return r;
  }
  if (field.scalar) { check(field.top, v2[field.top], m[field.top]); return r; }
  if (field.nested) { const a = v2.mortgage[field.key], b = m.mortgage[field.key]; if (Array.isArray(a)) { a.forEach((x, i) => check(`${field.key}[${i}]`, x, b[i])); return r; } check(field.key, a, b); return r; }
  const keyOf = ROWS[field.top], left = v2[field.top], right = m[field.top], index = new Map();
  for (const row of right) { const k = keyOf(row); if (!index.has(k)) index.set(k, []); index.get(k).push(row); }
  const used = new Set();
  for (const row of left) {
    // Twins share a key, and which twin comes first depends on the order a disk lists files. Pair each with the twin that agrees, so the count is the same on any machine.
    const k = keyOf(row), pool = index.get(k) || [], at = field.key ? pool.findIndex((x) => same(row[field.key], x[field.key], field.key)) : 0, other = pool.splice(Math.max(at, 0), 1)[0];
    if (!other) { miss(k, ["row", "no such row"]); continue; }
    used.add(other);
    if (field.key) check(k, row[field.key], other[field.key]); else r.matches += 1;
  }
  r.extra = right.filter((x) => !used.has(x)).length;
  return r;
}

const SHARED_FROM = "2025-07-01";
async function world() {
  const dir = path.join(root, "standard", ".build", "world");
  if (!fs.existsSync(dir)) throw new Error("The Davies world is not built. Run: node standard/world/build.js");
  const store = K.folderStore({ dir: "/kitty", fs: K.memfs() });
  // In path order: which witness of a line speaks first can follow the order a disk lists files, and the table has to read the same on a Mac and in CI.
  const files = loadWorld(dir);
  files.files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const { built } = await K.replayWorld(store, files, { today: "2027-02-01" });
  return built;
}
/* The world is wider than the sheet: it holds accounts and years the sheet never had, on purpose, as hard cases. Comparing a number across different scopes says nothing, so the
   adapter reads the cash and net worth lenses over the accounts the sheet holds, from the sheet's first month, and the table reports what was left out. */
function aligned(L, v2) {
  const ids = v2.accounts.map((a) => a.id);
  const narrow = { ...L, cash: V.cashLens(L, { accounts: ids }), netWorth: V.netWorth(L, { accounts: ids }) };
  narrow.metrics = allMetrics(narrow, base().schema.metrics);
  return narrow;
}
function clip(mm, from) {
  const inWindow = (d) => d >= from;
  return { ...mm, tx: mm.tx.filter((t) => inWindow(t.date)), entries: mm.entries.filter((t) => inWindow(t.date)), balances: mm.balances.filter((b) => inWindow(b.month)), networth: mm.networth.filter((n) => inWindow(n.month)), cashflow: mm.cashflow.filter((c) => inWindow(c.month)), payslips: mm.payslips.filter((p) => inWindow(p.date)) };
}
async function run() {
  const snap = JSON.parse(read("data/snapshot-v2.json")), v2 = E.model(snap), { L, view } = await world();
  const m = modelFromStandard(aligned(L, v2), view, { asOf: v2.asOf }), held = new Set(v2.accounts.map((a) => a.id));
  const clipped = clip(m, SHARED_FROM), left = clip(v2, SHARED_FROM);
  left.windowFrom = SHARED_FROM;
  const scoped = { ...clipped, tx: clipped.tx.filter((t) => held.has(t.acct)), entries: clipped.entries.filter((t) => held.has(t.acct)), balances: clipped.balances.filter((b) => held.has(b.acct)), payslips: clipped.payslips };
  const fields = fieldsRead(v2), rows = fields.map((f) => compare(f, left, f.top === "accounts" || f.top === "assets" || f.top === "contracts" || f.top === "rules" || f.top === "cats" ? m : scoped));
  return { rows, fields, worldOnly: m.accounts.filter((a) => !held.has(a.id)).map((a) => a.id), v2, m };
}
/* Why a field differs. A field with differences and no line here fails parity.test.js, so a new difference cannot slip through as old news. Keyed by field, or by the part
   before a [ or a dot. A reason says what is different and whose it is to close. */
const WHY = {
  "accounts[].balance": "SMSF: on the sheet, and the world has no such account. Every other balance matches.",
  "accounts[].id": "SMSF only, as above.", "accounts[].cls": "SMSF only, as above.", "accounts[].currency": "SMSF only, as above.", "accounts[].liquid": "SMSF only, as above.", "accounts[].name": "SMSF only, as above.", "accounts[].type": "SMSF only, as above.",
  "accounts[].bank": "The world names the super fund's institution and the sheet leaves it blank. The adapter has more.",
  "accounts[].method": "SMSF, and ETF: the sheet said statement and the adapter says market. A label.",
  "accounts[].note": "A person's note on the sheet. The world holds fewer.",
  "accounts[].opening": "The world starts in 2019 and the sheet in June 2025, so the opening differs and the balance does not.",
  "accounts[].openingDate": "As above.",
  "accounts[].owner": "ACC-SAV: the sheet said Joint and the world's ownership rows name one person. The standard is the better record. SMSF as above.",
  "accounts[].purpose": "A word a person typed on the sheet. The standard only knows what a property is for.",
  "accounts[].status": "beta is the sheet's own idea, for rows that switch nothing on. The standard has no such state.",
  assets: "The sheet's Assets tab also lists super, shares and crypto. The standard's asset table is physical things, and those are accounts.",
  balances: "SMSF has no row. CRYPTO and SHR-RSU are priced differently (below). LN-HOME differs in the sheet's first two months only. A beta state is not modelled.",
  "budget": UNSTATED.budget, "checks": UNSTATED.checks, "subs": UNSTATED.subs, "savings": UNSTATED.savings,
  "cats[].ato": "The standard's tax map has 13 selectors against the sheet's 34 labels. Tax is carried by tax items by person instead.",
  "cats[].tax": "As above.",
  contracts: "Different vocabularies: 4 contracts carry other names, 14 more exist only in the world, and the provider is a party. next and lastUsed are unstated: " + UNSTATED["contracts.next"],
  "cashflow[].groups": "Two months where a person's decision moves a line out of Uncategorised, as tx[].cat. Every other group in every month matches.",
  decisions: "The sheet's Decisions tab holds keep or cancel and the like. The standard's decisions are a different set, for the same household.",
  entries: "33 valuation rows: the adapter states a value in the months it changed, and the sheet also lists months when it did not. The balance on the day agrees.",
  "entries[].id": "Ids are the standard's line keys, not sheet row numbers. Nothing the page shows depends on the form.",
  "entries[].person": "As accounts[].owner: the world names one person where the sheet said Joint.",
  firstSeen: "The world has six more years of history, so a merchant new on the sheet in 2025 was first seen earlier.",
  "goals[].monthsLeft": UNSTATED["goals.monthsLeft"], "goals[].needPm": UNSTATED["goals.needPm"], "goals[].progress": UNSTATED["goals.progress"], "goals[].savedPm": UNSTATED["goals.savedPm"], "goals[].status": UNSTATED["goals.status"],
  householdName: "The household's name in the world's setup is worded differently. A household's own words.",
  kitty: "The sheet's Kitty tab holds a viewer's preferences and thresholds. They live in the page's prefs, or take the page's defaults.",
  "loans[].monthsLeft": UNSTATED["loans.monthsLeft"], "loans[].repayment": UNSTATED["loans.repayment"],
  'metrics["cashflow.savings_rate.3m"]': UNSTATED["metrics.cashflow.savings_rate.3m"], 'metrics["close.items_missing"]': UNSTATED["metrics.close.items_missing"], 'metrics["emergency.months_covered"]': UNSTATED["metrics.emergency.months_covered"], 'metrics["savings.recurring_per_year"]': UNSTATED["metrics.savings.recurring_per_year"], 'metrics["tax.refund.corrected.prior_year"]': UNSTATED["metrics.tax.refund.corrected.prior_year"], 'metrics["tax.refund_at_risk.prior_year"]': UNSTATED["metrics.tax.refund_at_risk.prior_year"],
  'metrics["networth.total"]': "Follows networth[].total.",
  'metrics["tax.refund.current_year"]': "The sheet's Tax Forecast and the standard's full calculation are two different estimates, and they have not been reconciled.",
  'metrics["tax.refund.prior_year"]': "As above. The standard's is the one tied to lodged returns.",
  "mortgage.monthsLeft": UNSTATED["mortgage.monthsLeft"], "mortgage.netPm": UNSTATED["mortgage.netPm"], "mortgage.repayment": UNSTATED["mortgage.repayment"], "mortgage.scenarios": UNSTATED["mortgage.scenarios"], "mortgage.extras": UNSTATED["mortgage.extras"],
  "mortgage.step": "The sheet's slider step. A page setting, not a fact.",
  "networth[].change": "Not read by any render. The page's scan sees the word .change on scenarios. No metric for it.",
  "networth[].shares": "SHR-RSU: the sheet's beta row is $33.61 off the world's vest price.",
  "networth[].total": "Shares as above, and CRYPTO: the world values the wallet from its own statements, about $1,100 to $1,600 above the sheet's beta row.",
  "rules[].note": "A person's note on one rule. The world holds fewer.",
  "rules[].property": "The sheet tags rules with a property. The world's rule rows carry it on some.",
  "settings[\"Emergency fund target (months of essential spending)\"]": "A person's setting. The page defaults to 6, and a household's Home shows no safety net until the engine states one.",
  "settings[\"Smallest monthly spend for the growth ranking ($)\"]": "A page threshold. The page has its own default.",
  "tx[].cat": "3 lines a person has decided in the world and not on the sheet. The standard's answer stands.",
  "tx[].catName": "As above.", "tx[].group": "As above.", "tx[].merchant": "As above.",
  "tx[].id": "Ids are the standard's line keys, as entries[].id.",
  "tx[].note": "A person's note on the sheet. The standard keeps decisions and their reasons, not free notes on a line.",
  "tx[].person": "As accounts[].owner.",
  "tx[].receipt": "A person's mark on the sheet. The standard holds evidence as documents, not a flag.",
};
/* These four follow which witness of a line is read first, and that follows a hash of the file's bytes. The world's PDFs are deflated, and deflate's output differs between an
   arm Mac and an x64 runner, so the count moves by machine, by tens of cells. Changing the compression level moves it the same way. A finding for the data model session:
   a line's person and foreign amount should not depend on the order of two witnesses. Until then they stay out of the totals, the ratchet and the currency test. */
const BY_MACHINE = new Set(["tx[].person", "entries[].person", "entries[].foreign", "entries[].foreignCcy"]);
const whyOf = (field) => { const top = field.split(/[[.]/)[0]; return WHY[field] ?? WHY[top]; };
const sum = (rows, k) => rows.reduce((n, r) => n + r[k], 0);
function table(r) {
  const fields = r.rows.length, clean = r.rows.filter((x) => !x.differs).length, steady = r.rows.filter((x) => !BY_MACHINE.has(x.field));
  const lines = [`# Parity: the adapter against the v2 sheet`, ``, `Generated by \`node tools/page-parity.js --write\`. The benchmark Davies world through \`modelFromStandard\`, compared with \`E.model(data/snapshot-v2.json)\`, on the ${fields} fields the page reads, enumerated from \`src/app.js\`, \`src/kit\` and the page half of \`src/engine.js\`. Same accounts and same window on both sides: the world also holds ${r.worldOnly.length} accounts the sheet does not (${r.worldOnly.join(", ")}), and years before July 2025.`, ``, `**${clean} of ${fields} fields match on every row. ${sum(steady, "matches")} cells match, ${sum(steady, "differs")} differ,** not counting ${[...BY_MACHINE].map((f) => `\`${f}\``).join(", ")}, whose counts move by machine: they follow which witness of a line is read first, and that follows a hash of the file's bytes. The public demo stays on v2 until this is closed.`, ``, `| Field | Matches | Differs | Why |`, `|---|---:|---:|---|`];
  for (const x of steady) lines.push(`| \`${x.field}\` | ${x.matches} | ${x.differs} | ${x.differs ? String(whyOf(x.field) || "NOT EXPLAINED").replace(/\|/g, "/") : ""} |`);
  return `${lines.join("\n")}\n`;
}
module.exports = { run, fieldsRead, pageSource, whyOf, table, BY_MACHINE };
if (require.main === module) run().then((r) => {
  const w = Math.max(...r.rows.map((x) => x.field.length));
  console.log(`${r.fields.length} fields read by the page. World accounts the sheet does not hold: ${r.worldOnly.join(", ")}`);
  console.log(`${"field".padEnd(w)}  matches  differs  why`);
  for (const x of r.rows) console.log(`${x.field.padEnd(w)}  ${String(x.matches).padStart(7)}  ${String(x.differs).padStart(7)}  ${x.differs ? String(whyOf(x.field) || "NOT EXPLAINED").slice(0, 110) : ""}`);
  const clean = r.rows.filter((x) => !x.differs).length;
  const steady = r.rows.filter((x) => !BY_MACHINE.has(x.field));
  console.log(`${clean} of ${r.rows.length} fields match on every row. ${sum(steady, "matches")} cells match, ${sum(steady, "differs")} differ, leaving out the ${BY_MACHINE.size} fields that move by machine.`);
  if (process.argv.includes("--write")) {
    fs.writeFileSync(path.join(root, "src/household/PARITY.md"), table(r));
    fs.writeFileSync(path.join(root, "src/household/parity-baseline.json"), `${JSON.stringify(Object.fromEntries(steady.map((x) => [x.field, x.matches])), null, 0).replace(/,"/g, ',\n"')}\n`);
  }
}).catch((e) => { console.error(e); process.exit(1); });
