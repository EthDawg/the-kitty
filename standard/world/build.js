#!/usr/bin/env node
/* Builds the Davies world: node standard/world/build.js writes standard/.build/world/. Deterministic: no clock, no Math.random, the same inputs
   give the same bytes. Truth is computed here, from the base data and the generators, and never imports standard/engine. */
"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");
const { World, TABLES } = require("./lib/world");

const REPO = path.resolve(__dirname, "..", "..");
const OUT = path.join(REPO, "standard", ".build", "world");

const DOMAINS = ["setup", "banks", "payroll", "loans", "property", "rates", "agency", "super", "broker", "rsu", "crypto", "rental2", "tax", "bills", "things", "valuations"];

function buildWorld() {
  const base = JSON.parse(fs.readFileSync(path.join(REPO, "portals", "data", "months.json"), "utf8"));
  const sheet = JSON.parse(fs.readFileSync(path.join(REPO, "data", "snapshot-v2.json"), "utf8"));
  const w = new World({ base, sheet, deflate: (b) => new Uint8Array(zlib.deflateSync(b, { level: 6 })), deflateRaw: (b) => new Uint8Array(zlib.deflateRawSync(b, { level: 6 })) });
  w.repo = REPO;
  for (const d of DOMAINS) require(`./domains/${d}`).run(w, REPO);
  require("./domains/finish").run(w);
  return w;
}

function write(w) {
  fs.rmSync(OUT, { recursive: true, force: true });
  const put = (rel, data) => { const p = path.join(OUT, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); };
  const json = (v) => `${JSON.stringify(v, null, 1)}\n`;
  const manifest = [];
  for (const f of w.files) {
    put(f.path, f.bytes);
    const total = Object.values(f.expect || {}).reduce((s, n) => s + n, 0);
    manifest.push({ path: f.path, stream_id: f.stream_id, download_date: f.download_date, name: f.name, family: f.family, container: f.container, recipe: f.tier === "agent" ? null : f.recipe, tier: f.tier,
      observations: total, by_kind: f.expect || {}, origin: f.origin || "portal", issued_on: f.issued_on || null, bytes: f.bytes.length, sha256: crypto.createHash("sha256").update(f.bytes).digest("hex"),
      ...(f.supersedes ? { supersedes: f.supersedes } : {}), ...(f.witness_of ? { witness_of: f.witness_of } : {}), ...(f.note ? { note: f.note } : {}) });
  }
  manifest.sort((a, b) => (a.path < b.path ? -1 : 1));
  put("manifest.json", json({ standard_version: "household-standard/1", world: "davies/1", window: { from: "2019-03-01", to: w.END, sheet_to: w.SHEET_END }, files: manifest }));
  for (const t of TABLES) put(`setup/${t}.json`, json(w.setup[t]));
  put("setup/tailoring.json", json([]));
  put("decisions/person.json", json(w.decisions));
  put("decisions/rules.json", json(w.rules || []));
  for (const [k, v] of Object.entries(w.truth)) put(`truth/${k}.json`, json(v));
  return manifest;
}

if (require.main === module) {
  const w = buildWorld();
  const m = write(w);
  const fams = new Set(m.map((f) => f.family)), cont = new Set(m.map((f) => f.container));
  console.log(`${m.length} files, ${fams.size} families, ${cont.size} containers, ${m.reduce((s, f) => s + f.observations, 0)} expected observations`);
}

module.exports = { buildWorld, write, OUT, REPO };
