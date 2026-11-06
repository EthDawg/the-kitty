#!/usr/bin/env node
/* Everything in generated/ comes from schema/. `node standard/tools/generate.js` writes it; --check fails if stale. */
"use strict";
const fs = require("fs"), path = require("path");
const S = require("../engine/schema");
const { proveTemplates } = require("../engine/post");
const root = path.join(__dirname, "..");
const read = (f) => JSON.parse(fs.readFileSync(path.join(root, "schema", f), "utf8"));
const tablesDoc = read("tables.json"), events = read("events.json"), observations = read("observations.json"), checks = read("checks.json"), metrics = read("metrics.json"), terms = read("terms.json");
const T = S.tables(tablesDoc);
const classOf = (plane) => Object.entries(tablesDoc.manifest_classes).find(([k, v]) => Array.isArray(v) && v.includes(plane))[0];
const out = {};

const bad = proveTemplates(events);
if (bad.length) { console.error("Event templates do not balance:\n" + bad.join("\n")); process.exit(1); }

// ---------- SQL: runs on SQLite and Postgres ----------
const sqlType = { id: "TEXT", text: "TEXT", date: "TEXT", datetime: "TEXT", cents: "INTEGER", int: "INTEGER", bps: "INTEGER", bool: "INTEGER", units: "TEXT", rate: "TEXT", json: "TEXT" };
const q = (n) => `"${n}"`;
let sql = `-- Generated from standard/schema. Do not edit.\n-- ${tablesDoc.version}. Money is integer cents; units and rates are decimal text, never floats.\n\n`;
for (const t of Object.values(T)) {
  sql += `-- ${t.plane}, ${t.temporal}. ${t.doc}\nCREATE TABLE ${q(t.name)} (\n`;
  const lines = t.columns.map((c) => {
    let l = `  ${q(c.name)} ${sqlType[c.type]}`;
    if (c.pk) l += " PRIMARY KEY"; else if (c.required) l += " NOT NULL";
    if (c.enum) l += ` CHECK (${q(c.name)} IN (${c.enum.map((v) => `'${v}'`).join(", ")}))`;
    return l;
  });
  sql += lines.join(",\n") + "\n);\n\n";
}
sql += `-- The two axes of time. Bind :subject_type, :subject_id, :term, :valid_on, :known_at.\n-- SELECT value FROM term WHERE subject_type = :subject_type AND subject_id = :subject_id AND term = :term\n--   AND valid_from <= :valid_on AND (valid_to IS NULL OR :valid_on < valid_to)\n--   AND substr(recorded_at, 1, 10) <= :known_at AND (superseded_at IS NULL OR :known_at < substr(superseded_at, 1, 10));\n\n`;
for (const t of Object.values(T)) for (const c of t.columns) if (c.name === "valid_from") sql += `CREATE INDEX ${q(`ix_${t.name}_valid`)} ON ${q(t.name)} (${q("valid_from")});\n`;
sql += `CREATE INDEX "ix_posting_account" ON "posting" ("account_id");\nCREATE INDEX "ix_posting_event" ON "posting" ("event_id");\nCREATE INDEX "ix_event_day" ON "event" ("occurred_on");\nCREATE INDEX "ix_observation_kind" ON "observation" ("kind", "occurred_on");\nCREATE INDEX "ix_term_subject" ON "term" ("subject_type", "subject_id", "term");\n`;
out["schema.sql"] = sql;

// ---------- MongoDB $jsonSchema validators, one per collection ----------
const bson = { id: "string", text: "string", date: "string", datetime: "string", cents: ["long", "int"], int: ["long", "int"], bps: "int", bool: "bool", units: "string", rate: "string", json: ["object", "array"] };
const mongo = {};
for (const t of Object.values(T)) {
  const props = {};
  for (const c of t.columns) { props[c.name] = { bsonType: c.required ? bson[c.type] : [].concat(bson[c.type], "null") }; if (c.enum) props[c.name].enum = c.required ? c.enum : [...c.enum, null]; }
  mongo[t.name] = { $jsonSchema: { bsonType: "object", required: t.columns.filter((c) => c.required).map((c) => c.name), properties: props, description: t.doc } };
}
out["mongodb-validators.json"] = JSON.stringify(mongo, null, 2) + "\n";

// ---------- ER diagram, one per plane plus the core ----------
const mermaidName = (n) => n.toUpperCase();
let er = "erDiagram\n";
for (const t of Object.values(T)) {
  er += `  ${mermaidName(t.name)} {\n`;
  for (const c of t.columns.filter((x) => x.pk || x.fk).slice(0, 6)) er += `    ${c.type} ${c.name}${c.pk ? " PK" : c.fk ? " FK" : ""}\n`;
  er += "  }\n";
}
for (const t of Object.values(T)) for (const c of t.columns) if (c.fk && c.fk.table !== t.name) er += `  ${mermaidName(c.fk.table)} ||--o{ ${mermaidName(t.name)} : "${c.name}"\n`;
out["er.mmd"] = er;

// ---------- reference for people ----------
let md = `# Tables\n\nGenerated from \`schema/tables.json\`. ${Object.keys(T).length} tables, version \`${tablesDoc.version}\`.\n`;
for (const [plane, about] of Object.entries(tablesDoc.planes)) {
  md += `\n## ${plane[0].toUpperCase()}${plane.slice(1)}\n\n${about}\n`;
  for (const t of Object.values(T).filter((x) => x.plane === plane)) {
    md += `\n### \`${t.name}\` (${t.temporal})\n\n${t.doc}\n\n| Column | Type | Notes |\n|---|---|---|\n`;
    for (const c of t.columns) md += `| \`${c.name}\` | ${c.type} | ${[c.pk ? "key" : c.required ? "required" : "", c.fk ? `→ ${c.fk.table}` : "", c.enum ? c.enum.join(", ") : ""].filter(Boolean).join("; ")} |\n`;
  }
}
out["tables.md"] = md;

// ---------- the sheet's tabs ----------
const tabName = (n) => n.split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
const tabs = Object.values(T).map((t, i) => ({ tab: tabName(t.name), table: t.name, class: classOf(t.plane), plane: t.plane, temporal: t.temporal, order: i, headers: t.columns.map((c) => c.name) }));
out["sheet-tabs.json"] = JSON.stringify({ version: tablesDoc.version, tabs }, null, 2) + "\n";

// ---------- the schema card: everything a model needs, on a token budget ----------
let card = `# Household standard: schema card (${tablesDoc.version})\n\n`;
card += `Three things are original (evidence, judgement, setup); everything else is rebuilt. Sign: money in is positive; a card charge is negative. Money is integer cents. Absent means not stated, never zero. One economic fact is recognised once and cleared by every other witness.\n\n## Observation kinds (what an importer emits)\n`;
for (const [k, v] of Object.entries(observations.kinds)) card += `${k}: ${v.fields.join(" ")}\n`;
card += `\n## Event kinds\n${Object.keys(events.kinds).join(" ")}\n\n## Tables\n`;
for (const [plane] of Object.entries(tablesDoc.planes)) card += `${plane}: ${Object.values(T).filter((t) => t.plane === plane).map((t) => t.name).join(" ")}\n`;
card += `\n## Metrics\n${Object.keys(metrics.metrics).join(" ")}\n\n## Laws\n${Object.entries(checks.laws).map(([k, v]) => `${k} ${v.name}`).join("; ")}\n`;
out["schema-card.md"] = card;

const dir = path.join(root, "generated");
if (process.argv.includes("--check")) {
  const stale = Object.entries(out).filter(([f, body]) => { try { return fs.readFileSync(path.join(dir, f), "utf8") !== body; } catch (e) { return true; } }).map(([f]) => f);
  if (stale.length) { console.error(`Stale, run node standard/tools/generate.js: ${stale.join(", ")}`); process.exit(1); }
  console.log(`generated/ is current (${Object.keys(out).length} files).`);
} else {
  fs.mkdirSync(dir, { recursive: true });
  for (const [f, body] of Object.entries(out)) fs.writeFileSync(path.join(dir, f), body);
  console.log(`Wrote ${Object.keys(out).length} files. Schema card: ${card.length} characters, about ${Math.round(card.length / 4)} tokens. ${Object.keys(T).length} tables, ${Object.keys(observations.kinds).length} observation kinds, ${Object.keys(events.kinds).length} event kinds, ${Object.keys(metrics.metrics).length} metrics, ${Object.keys(checks.laws).length} laws.`);
}
