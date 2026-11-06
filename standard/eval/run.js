#!/usr/bin/env node
/* The blow-away replay. Everything derived is deleted and rebuilt from the world's sources alone, then scored.
   node standard/eval/run.js                     a returning household: keeps decisions, rules, recipes
   node standard/eval/run.js --mode new          a new household: public dictionary and public recipes only
   Same inputs give the same bundle hash. Append --log to record the run in history.jsonl. */
"use strict";
const fs = require("fs"), path = require("path");
const { rebuild } = require("../engine/rebuild");
const { score, printScore } = require("./score");
const Engine = require("../../src/engine.js");

const root = path.join(__dirname, "..");
const world = path.join(root, ".build", "world");
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] ?? true : d; };
const mode = flag("mode", "returning");

const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return d; } };
function loadSetup() {
  const out = {};
  for (const f of fs.readdirSync(path.join(world, "setup"))) out[f.replace(".json", "")] = readJson(path.join(world, "setup", f), []);
  return out;
}
function run() {
  const t0 = process.hrtime.bigint();
  Engine.loadMerchants({ merchants: readJson(path.join(root, "..", "merchants", "merchants.json")), categories: readJson(path.join(root, "..", "merchants", "categories.json")) });
  const { ingest } = require("../intake");
  const recipes = fs.readdirSync(path.join(root, "recipes")).filter((f) => f.endsWith(".json")).map((f) => readJson(path.join(root, "recipes", f)));
  const manifest = readJson(path.join(world, "manifest.json"));
  const setup = loadSetup();
  const intake = ingest({ root: world, recipes, manifest });
  const t1 = process.hrtime.bigint();
  const decisions = mode === "returning" ? readJson(path.join(world, "decisions", "person.json"), []) : [];
  const rules = mode === "returning" ? readJson(path.join(world, "decisions", "rules.json"), []) : [];
  const schema = { events: readJson(path.join(root, "schema", "events.json")), metrics: readJson(path.join(root, "schema", "metrics.json")) };
  const reference = readJson(path.join(root, "reference", "au.json"), null);
  const receipts = (intake.files || []).map((f) => { const parts = f.path.split("/"); return { stream_id: parts[1], day: parts[2] }; });
  const L = rebuild({ setup, sources: intake.sources, observations: intake.observations, decisions, rules, schema, reference, receipts, faults: intake.faults });
  const t2 = process.hrtime.bigint();
  const s = score(L, world);
  const secs = (a, b) => Number(b - a) / 1e9;
  s.run = { mode, files: intake.sources.length, observations: intake.observations.length, events: L.events.length, postings: L.postings.length, bundle_hash: L.bundleHash, ingest_s: +secs(t0, t1).toFixed(2), rebuild_s: +secs(t1, t2).toFixed(2), faults: (intake.faults || []).length, unknown_files: (intake.unknown_files || []).length };
  return { L, s, intake };
}
if (require.main === module) {
  const { s, intake } = run();
  console.log(`Replay, ${mode} household: ${s.run.files} files, ${s.run.observations} observations, ${s.run.events} events, ${s.run.postings} postings. Ingest ${s.run.ingest_s}s, rebuild ${s.run.rebuild_s}s. Bundle ${s.run.bundle_hash}\n`);
  printScore(s);
  if (intake.faults && intake.faults.length) console.log(`\nIntake faults: ${intake.faults.length}. ${JSON.stringify(intake.faults.slice(0, 3))}`);
  if (args.includes("--bundle")) {
    const { toBundle, writeBundle } = require("../engine/bundle");
    const { L } = run();
    const setup = loadSetup();
    const bundle = toBundle(L, { setup, tablesSchema: readJson(path.join(root, "schema", "tables.json")), decisions: mode === "returning" ? readJson(path.join(world, "decisions", "person.json"), []) : [], rules: mode === "returning" ? readJson(path.join(world, "decisions", "rules.json"), []) : [], recipes: fs.readdirSync(path.join(root, "recipes")).filter((f) => f.endsWith(".json")).map((f) => { const r = readJson(path.join(root, "recipes", f)); return { recipe_id: r.id, fingerprint: (r.fingerprints || [""])[0], family: r.id, spec: r, author: "golden", gate_status: "passed", created_at: "2026-11-06T00:00:00Z" }; }), version: "household-standard/1", mode });
    writeBundle(bundle, path.join(root, ".build", "bundle"), fs, path);
    console.log(`Bundle written to standard/.build/bundle.`);
  }
  if (args.includes("--failures")) console.log(JSON.stringify(s.failures, null, 1));
  if (args.includes("--worst")) for (const r of s.sections) if (r.worst.length) console.log(r.name, JSON.stringify(r.worst.slice(0, 3)));
  if (args.includes("--log")) fs.appendFileSync(path.join(__dirname, "history.jsonl"), JSON.stringify({ ...s.run, sections: s.sections.map((r) => ({ name: r.name, exact: r.exact, checked: r.checked })), review: s.review.items }) + "\n");
}
module.exports = { run };
