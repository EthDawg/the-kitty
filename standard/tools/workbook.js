#!/usr/bin/env node
/* The household's Sheet, generated from the bundle. Tabs are tables; view tabs are live formulas over Postings, so a person can
   read every number and a formula can be checked against the engine. Yours is blue, evidence grey, managed green.
   node standard/tools/workbook.js <out.xlsx> */
"use strict";
const fs = require("fs"), path = require("path");
const { workbook, colName } = require("./xlsx-writer");
const { monthOf, monthEnd, nextMonth } = require("../engine/util");
const V = require("../engine/views");
const { run } = require("../eval/run");

const COLOURS = { yours: "4A7FB5", evidence: "8A8A8A", managed: "4F9A6E", views: "2E7D5B", start: "C1652F" };
const tablesSchema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "schema", "tables.json"), "utf8"));
const cols = (t) => tablesSchema.tables[t].columns.map((c) => c.split(":")[0]);
const tabName = (n) => n.split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");

function tableSheet(table, rows, klass, extra = []) {
  const headers = [...cols(table), ...extra];
  const body = rows.map((r) => headers.map((h) => { const v = r[h]; return v == null ? "" : typeof v === "object" ? JSON.stringify(v) : v; }));
  return { name: tabName(table), color: COLOURS[klass], rows: [headers, ...body] };
}

// The months an account belongs to the household, for the Net Worth formulas: first and last held month ends across the book.
function heldMonths(L) {
  const held = V.heldBy(L), out = new Map();
  for (const a of L.accounts) { const ms = L.balances.months.filter((m) => held(a.account_id, monthEnd(m))); out.set(a.account_id, { from: ms[0] || "9999-12", to: ms.length ? nextMonth(ms[ms.length - 1]) : "0000-01" }); }
  return out;
}
function build(L, setup, intake) {
  const X = L.index, heldIn = heldMonths(L);
  const sheets = [];
  const postings = L.postings.map((p) => { const e = X.events.get(p.event_id); const a = p.account_id ? X.accounts.get(p.account_id) : null; const c = X.categories.get(e.category_id);
    return { ...p, month: monthOf(e.occurred_on), reporting_group: a ? a.reporting_group : "", event_category: e.category_id || "", category_kind: c ? c.kind : "", cash_lens: c ? c.cash_lens !== false : false, unexplained: !!e.unexplained, held_from: a ? heldIn.get(p.account_id).from : "", held_to: a ? heldIn.get(p.account_id).to : "" }; });
  const postSheet = tableSheet("posting", postings, "managed", ["month", "reporting_group", "event_category", "category_kind", "cash_lens", "unexplained", "held_from", "held_to"]);
  const h = postSheet.rows[0];
  const col = (n) => colName(h.indexOf(n));
  const R = (n) => `Posting!$${col(n)}$2:$${col(n)}$${postings.length + 1}`;
  const months = L.balances.months.filter((m) => m >= "2019-03");
  const groups = ["cash", "property", "super", "shares", "crypto", "vehicle", "device", "loans"];

  const nw = [["month_end", ...groups, "net_worth"]];
  months.forEach((m, i) => {
    const row = [m];
    groups.forEach((g) => row.push({ f: `SUMIFS(${R("amount_cents")},${R("reporting_group")},"${g}",${R("month")},"<="&$A${i + 2},${R("held_from")},"<="&$A${i + 2},${R("held_to")},">"&$A${i + 2})/100`, money: true }));
    row.push({ f: `SUM(B${i + 2}:${colName(groups.length)}${i + 2})`, money: true });
    nw.push(row);
  });
  const cashCats = L.categories.filter((c) => c.cash_lens !== false && (c.kind === "income" || c.kind === "expense" || c.kind === "suspense"));
  const cf = [["month", "income", "spending", "unexplained", "net"]];
  months.forEach((m, i) => {
    const r = i + 2;
    const sumKind = (kind, sign, odd = "FALSE") => `${sign}SUMIFS(${R("amount_cents")},${R("reporting_group")},"cash",${R("month")},$A${r},${R("category_kind")},"${kind}",${R("cash_lens")},TRUE,${R("unexplained")},${odd})/100`;
    cf.push([m, { f: sumKind("income", ""), money: true }, { f: `${sumKind("expense", "-")}${sumKind("suspense", "-")}`, money: true }, { f: sumKind("suspense", "", "TRUE"), money: true }, { f: `B${r}-C${r}+D${r}`, money: true }]);
  });
  const fyLabel = [...new Set(months.map((m) => { const y = +m.slice(0, 4), mo = +m.slice(5); return `FY${mo >= 7 ? y + 1 : y}`; }))];
  const rd = [["Digital Davies, the household record"], ["Generated from the bundle. Every person, account and amount here is fictional."], [], ["Tab colour", "Meaning", "Rule"], ["Blue", "Yours: Setup, Judgement, Plan", "An update writes here only through a declared migration."], ["Grey", "Evidence", "Append only."], ["Green", "Managed", "Rebuilt freely. A hand edit becomes a proposed decision."], ["Dark green", "Views", "Live formulas over Posting. Never type here."], [], ["Standard", "household-standard/1"], ["Bundle", L.bundleHash], ["As of", L.asOf]];
  sheets.push({ name: "Start here", color: COLOURS.start, header: false, rows: rd, widths: [24, 36, 60] });
  sheets.push({ name: "Net Worth", color: COLOURS.views, rows: nw, widths: [11, ...groups.map(() => 15), 16] });
  sheets.push({ name: "Cash Flow", color: COLOURS.views, rows: cf, widths: [11, 15, 15, 15, 15] });
  const checks = [["law", "scope", "status", "expected", "actual", "gap_cents", "detail"], ...L.checks.map((c) => [c.law, c.scope, c.status, c.expected, c.actual, c.gap_cents, c.detail])];
  sheets.push({ name: "Check Result", color: COLOURS.managed, rows: checks, widths: [6, 34, 9, 14, 14, 12, 70] });
  for (const [t, def] of Object.entries(tablesSchema.tables)) {
    if (["posting", "check_result", "metric_value", "run", "observation", "balance"].includes(t)) continue;
    const klass = Object.entries(tablesSchema.manifest_classes).find(([, v]) => Array.isArray(v) && v.includes(def.plane))[0];
    const rows = t === "term" ? L.terms : t === "source" ? L.sources : t === "event" ? L.events.map((e) => ({ ...e })) : t === "witness" ? L.witnesses : t === "tax_item" ? (L.tax ? L.tax.items : []) : t === "review_item" ? L.review : t === "lot_match" ? L.lotMatches.map((m) => ({ ...m, event_id: m.event_ref })) : setup[t] || [];
    sheets.push(tableSheet(t, rows, klass));
  }
  sheets.push(postSheet);
  void fyLabel; void cashCats; void intake;
  return sheets;
}

if (require.main === module) {
  const out = process.argv[2] || path.join(__dirname, "..", ".build", "digital-davies.xlsx");
  const { L } = run();
  const setup = {};
  const dir = path.join(__dirname, "..", ".build", "world", "setup");
  for (const f of fs.readdirSync(dir)) setup[f.replace(".json", "")] = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  const sheets = build(L, setup);
  fs.writeFileSync(out, workbook(sheets));
  console.log(`${sheets.length} tabs, ${fs.statSync(out).size} bytes: ${out}`);
}
module.exports = { build };
