#!/usr/bin/env node
/* Is this a gap in the standard or a gap in mine? Reports each difference as conformant, extension or divergence.
   node standard/tools/conform.js --bundle <dir>       a whole bundle: every row against the schema
   node standard/tools/conform.js --tabs <tabs.json>   headers only, {"Tab name": ["col", ...]}: a first look at any workbook */
"use strict";
const fs = require("fs"), path = require("path");
const S = require("../engine/schema");
const { proveTemplates } = require("../engine/post");
const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "schema", "tables.json"), "utf8"));
const T = S.tables(schema);
const args = process.argv.slice(2);
const arg = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const norm = (s) => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

function conformBundle(dir) {
  const report = { conformant: [], extension: [], divergence: [] };
  const present = new Set(fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")).map((f) => f.replace(".jsonl", "")));
  const requiredPlanes = new Set(["setup", "evidence", "judgement"]);
  for (const [name, t] of Object.entries(T)) {
    if (!present.has(name)) { if (requiredPlanes.has(t.plane)) report.divergence.push(`${name}: required table missing`); continue; }
    const rows = fs.readFileSync(path.join(dir, `${name}.jsonl`), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const errs = new Map(); const known = new Set(t.columns.map((c) => c.name));
    for (const r of rows) {
      for (const e of S.validateRow(t, r)) errs.set(e.replace(/: .*$/, ""), (errs.get(e.replace(/: .*$/, "")) || 0) + 1);
      for (const k of Object.keys(r)) if (!known.has(k)) { if (k.startsWith("x_")) report.extension.push(`${name}.${k}`); else errs.set(`${name}.${k}: unknown column`, (errs.get(`${name}.${k}: unknown column`) || 0) + 1); }
    }
    if (errs.size) for (const [e, n] of errs) report.divergence.push(`${e} (${n} rows)`);
    else report.conformant.push(`${name} (${rows.length})`);
  }
  for (const name of present) if (!T[name]) (name.startsWith("x_") ? report.extension : report.divergence).push(`${name}: table not in the standard`);
  const xev = path.join(dir, "x_events.json");
  if (fs.existsSync(xev)) { const bad = proveTemplates(JSON.parse(fs.readFileSync(xev, "utf8"))); for (const b of bad) report.divergence.push(`x_ event does not balance: ${b}`); }
  return report;
}

function conformTabs(file) {
  const tabs = JSON.parse(fs.readFileSync(file, "utf8"));
  const allCols = new Map();
  for (const t of Object.values(T)) for (const c of t.columns) { if (!allCols.has(c.name)) allCols.set(c.name, []); allCols.get(c.name).push(t.name); }
  const rows = [];
  for (const [tab, headers] of Object.entries(tabs)) {
    const name = norm(tab);
    const cols = (headers || []).map(norm).filter(Boolean);
    // A name only counts when the headers agree: a tab of logins called Accounts is not the account table.
    const direct = T[name] || T[name.replace(/s$/, "")];
    const agrees = direct && cols.filter((c) => direct.columns.some((k) => k.name === c)).length >= Math.max(2, Math.ceil(cols.length / 4));
    let best = agrees ? direct.name : null, bestScore = 0;
    if (!best) for (const t of Object.values(T)) { const have = new Set(t.columns.map((c) => c.name)); const score = cols.filter((c) => have.has(c)).length; if (score > bestScore) { best = t.name; bestScore = score; } }
    const target = best && T[best];
    const known = target ? new Set(target.columns.map((c) => c.name)) : new Set();
    const matched = cols.filter((c) => known.has(c)), extra = cols.filter((c) => !known.has(c));
    rows.push({ tab, maps_to: best, confidence: cols.length ? Math.round((matched.length / cols.length) * 100) : 0, matched, not_in_standard: extra });
  }
  return rows;
}

if (arg("bundle")) {
  const r = conformBundle(arg("bundle"));
  console.log(`Conformant: ${r.conformant.length} tables. Extensions: ${r.extension.length}. Divergences: ${r.divergence.length}.`);
  for (const e of r.extension) console.log(`  extension  ${e}`);
  for (const d of r.divergence) console.log(`  divergence ${d}`);
  process.exit(r.divergence.length ? 1 : 0);
} else if (arg("tabs")) {
  console.log(JSON.stringify(conformTabs(arg("tabs")), null, 2));
} else { console.error("Pass --bundle <dir> or --tabs <file>."); process.exit(2); }
