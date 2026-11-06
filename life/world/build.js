#!/usr/bin/env node
/* The life generator. node life/world/build.js writes life/world/out/davies/. --seed N changes the noise; --variant gives a family that plays the same script with its own names,
   employers, banks and file shapes, written to life/world/out/variant-N/. Deterministic: the same seed gives the same bytes. No clock, no Math.random. */
"use strict";
const fs = require("fs"), path = require("path");
const script = require("../davies/life.json");
const { davies, variant } = require("./lib/cast");
const { Life } = require("./lib/life");
const { renderAll } = require("./lib/render");
const { buildSetup, TABLES } = require("./lib/setup");
const { buildTruth } = require("./lib/truth");
const { buildMess } = require("./lib/mess");
const { answerKey } = require("./lib/answers");

const OUT = path.join(__dirname, "out");
const CONTENT = { ".pdf": "application/pdf", ".csv": "text/csv", ".tsv": "text/tab-separated-values", ".json": "application/json", ".html": "text/html", ".eml": "message/rfc822", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".ofx": "application/x-ofx", ".qif": "application/qif", ".png": "image/png" };

/* The chapter a household first holds a file: the first chapter where its stream has begun and the file exists, unless the script says otherwise. */
function heldFrom(files) {
  const begins = {}; for (const c of script.chapters) for (const s of c.streams_begin) begins[s] = begins[s] == null ? c.chapter : begins[s];
  begins.WILLS = 5;
  const byToday = script.chapters.filter((c) => c.status !== "not_generated").map((c) => c).sort((a, b) => a.chapter - b.chapter);
  for (const f of files) {
    if (f.held_from !== undefined) continue;
    const b = begins[f.stream]; if (b == null) { f.held_from = null; continue; }
    const c = byToday.find((x) => x.chapter >= b && x.today >= f.delivered_on);
    f.held_from = c ? c.chapter : null;
  }
}

function build(opts = {}) {
  const seed = opts.seed == null ? 1 : opts.seed, cast = opts.variant ? variant(script, seed) : davies(script, seed), family = opts.family || cast.id, root = path.join(opts.out || OUT, family);
  const sim = new Life(script, cast).run();
  if (sim.notes.length) throw new Error(`${family}: the plot does not hold: ${sim.notes.slice(0, 5).join("; ")}`);
  const F = renderAll(sim), files = F.list; heldFrom(files);
  const setup = buildSetup(sim, script), truth = buildTruth(script, sim, files, setup), mess = buildMess(script, sim, files);
  truth.mess = mess.chapters;
  const answers = answerKey(cast, files);
  if (opts.write === false) return { root, sim, files, setup, truth, mess, answers };
  fs.rmSync(root, { recursive: true, force: true });
  const put = (rel, data) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); };
  const json = (v) => `${JSON.stringify(v, null, 1)}\n`;
  for (const f of files) put(f.path, f.bytes);
  for (const m of mess.files) put(m.path, m.bytes);
  const row = (f) => ({ brand: f.brand, stream: f.stream, year: f.delivered_on.slice(0, 4), date: f.delivered_on, name: f.name, size: f.size, type: CONTENT[path.extname(f.name)] || "application/octet-stream", path: f.path, sha256: f.sha256, person: f.person, visible_to: f.visible_to, delivered_on: f.delivered_on, held_from_chapter: f.held_from, where: f.where, origin: f.origin, issued_on: f.issued_on, family: f.family, container: f.container, account: f.account || null, window: f.window || null, ...(f.simplified ? { simplified: true } : {}), ...(f.note ? { note: f.note } : {}) });
  const streams = [...new Set(files.map((f) => f.stream))].sort().map((id) => { const mine = files.filter((f) => f.stream === id), d = mine.map((f) => f.delivered_on).sort(); return { id, brand: mine[0].brand, files: mine.length, first: d[0], last: d[d.length - 1], visible_to: [...new Set(mine.flatMap((f) => f.visible_to))] }; });
  put("manifest.json", json({ schema: "life-manifest/1", family, seed, variant: !!opts.variant, household: cast.household, window: { from: script.start, to: script.end }, chapters: script.chapters.map((c) => ({ chapter: c.chapter, title: c.title, today: c.today, status: c.status })), streams, files: files.map(row) }));
  put("mess.json", json({ chapters: mess.chapters }));
  put("truth.json", json(truth));
  for (const t of TABLES) put(`setup/${t}.json`, json(setup[t]));
  for (const r of answers) put(`answers/recipes/${r.id}.json`, json(r));
  return { root, family, files: files.length, mess: mess.files.length, sim, truth };
}

if (require.main === module) {
  const a = process.argv.slice(2), val = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
  const seed = val("--seed") != null ? Number(val("--seed")) : 1, v = a.includes("--variant");
  const r = build({ seed, variant: v, family: val("--family") || undefined });
  console.log(`${r.family}: ${r.files} files, ${r.mess} in drive and inbox, in ${path.relative(process.cwd(), r.root) || "."}`);
}

module.exports = { build, script, OUT };
