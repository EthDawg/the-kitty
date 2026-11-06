#!/usr/bin/env node
/* The friction ledger. Every snag has a row in life/findings/friction/*.jsonl and lands in one place: base, small-base-change, tailoring or declined. node life/friction.js prints what is unlanded. */
"use strict";
const fs = require("fs"), path = require("path");
const DIR = path.join(__dirname, "findings", "friction");
function rows() {
  if (!fs.existsSync(DIR)) return [];
  return fs.readdirSync(DIR).filter((f) => f.endsWith(".jsonl")).sort().flatMap((f) => fs.readFileSync(path.join(DIR, f), "utf8").split("\n").filter(Boolean).map((l) => ({ ...JSON.parse(l), file: f })));
}
const SCHEMA = require("./friction.schema.json");
/* The schema's own shape, checked with no dependency. A row that cannot say where it lands, or what holds it, is refused. */
function invalid(r) {
  const out = [], props = SCHEMA.properties;
  for (const k of SCHEMA.required) if (r[k] === undefined) out.push(`${k} missing`);
  for (const k of Object.keys(r)) if (k !== "file" && !props[k]) out.push(`${k} is not a field`);
  for (const [k, p] of Object.entries(props)) if (r[k] !== undefined && p.enum && !p.enum.includes(r[k])) out.push(`${k}: ${r[k]}`);
  if (r.kind !== "delight" && r.lands !== "tbd" && !r.case) out.push("no case");
  return out;
}
const LANDED = new Set(["tailoring", "declined"]);
const unlanded = (all) => all.filter((r) => r.kind !== "delight" && !(LANDED.has(r.lands) || r.state === "landed"));
if (require.main === module) {
  const all = rows(), open = unlanded(all), by = {};
  const bad = all.flatMap((r) => invalid(r).map((x) => `${r.id}: ${x}`));
  if (bad.length) { console.error(bad.join("\n")); process.exit(1); }
  for (const r of open) by[r.severity] = (by[r.severity] || 0) + 1;
  console.log(`${all.length} rows. ${open.length} unlanded. By severity: ${Object.keys(by).sort().reverse().map((k) => `${k}: ${by[k]}`).join(", ")}. Delight is recorded and never scored.`);
  for (const r of open.sort((a, b) => b.severity - a.severity)) console.log(`  S${r.severity} ${r.id} ${r.chapter} ${r.lands}: ${r.happened}${r.case ? ` [${r.case}]` : ""}`);
}
module.exports = { rows, unlanded, invalid };
