/* The Node host: the only file in this folder that may touch the disk, zlib or crypto. A page passes its own host with the same
   four calls (readSource, sha256, deflateRaw, inflate). Everything else in this folder is plain JavaScript. */
"use strict";
const fs = require("fs"), path = require("path"), zlib = require("zlib"), crypto = require("crypto");

const repo = path.join(__dirname, "..", "..", "..");
const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return d; } };

/* The household a pack reads. `horizon` is the clock for now: only what the household held on that day goes in, so a year can be
   packed as it stood at tax time, before the return came back. It filters originals, so the engine's answer is the engine's. */
function intakeFor(world) {
  const Engine = require(path.join(repo, "src", "engine.js"));
  const std = path.join(repo, "standard");
  Engine.loadMerchants({ merchants: readJson(path.join(repo, "merchants", "merchants.json")), categories: readJson(path.join(repo, "merchants", "categories.json")) });
  const { ingest } = require(path.join(std, "intake"));
  const recipes = fs.readdirSync(path.join(std, "recipes")).filter((f) => f.endsWith(".json")).map((f) => readJson(path.join(std, "recipes", f)));
  const manifest = readJson(path.join(world, "manifest.json"));
  return ingest({ root: world, recipes, manifest });
}

function household(opts = {}) {
  const std = path.join(repo, "standard");
  const world = opts.world || path.join(std, ".build", "world");
  const setup = {};
  for (const f of fs.readdirSync(path.join(world, "setup"))) setup[f.replace(".json", "")] = readJson(path.join(world, "setup", f), []);
  const intake = opts.intake || intakeFor(world);
  const decisions = readJson(path.join(world, "decisions", "person.json"), []), rules = readJson(path.join(world, "decisions", "rules.json"), []);
  const schema = { events: readJson(path.join(std, "schema", "events.json")), metrics: readJson(path.join(std, "schema", "metrics.json")) };
  const reference = readJson(path.join(std, "reference", "au.json"), null);
  const { rebuild } = require(path.join(std, "engine", "rebuild"));
  const at = (horizon, drop) => {
    const keep = (s) => (!horizon || String(s.captured_at).slice(0, 10) <= horizon) && !(drop && drop(s));
    const sources = intake.sources.filter(keep), ids = new Set(sources.map((s) => s.source_id));
    const observations = intake.observations.filter((o) => ids.has(o.source_id));
    const receipts = (intake.files || []).map((f) => { const p = f.path.split("/"); return { stream_id: p[1], day: p[2] }; }).filter((r) => !horizon || r.day <= horizon);
    return rebuild({ setup, sources, observations, decisions, rules, schema, reference, receipts, faults: intake.faults });
  };
  return { world, setup, intake, reference, at };
}

/* The host a renderer calls. Bytes come from the file a source names; nothing here decides what goes in a pack. */
function host(world) {
  return {
    readSource: (s) => { const p = path.join(world, s.uri); return fs.existsSync(p) ? new Uint8Array(fs.readFileSync(p)) : null; },
    sha256: (bytes) => crypto.createHash("sha256").update(bytes).digest("hex"),
    deflateRaw: (bytes) => new Uint8Array(zlib.deflateRawSync(bytes, { level: 9 })),
    inflate: (bytes, raw) => { try { return new Uint8Array(raw ? zlib.inflateRawSync(bytes) : zlib.inflateSync(bytes)); } catch (e) { return null; } },
  };
}

module.exports = { household, host, repo };
