#!/usr/bin/env node
/* Is the world sound by the Standard's own reader? Each chapter's files go through standard/intake and the engine, and the balances come back to truth at every month end the files speak for.
   Nothing here adjusts a file or a number to improve the result. node life/world/sound.js prints a table; --check fails if a chapter's expectation breaks. */
"use strict";
const fs = require("fs"), path = require("path");
const { build, script, OUT } = require("./build");
const { STD, monthRange, monthEnd } = require("./lib/std");
const { setupAt } = require("./lib/setup");
const { ingestFiles, loadRecipes, loadVocab, hostInflate } = require(path.join(STD, "intake"));
const { rebuild } = require(path.join(STD, "engine", "rebuild"));

const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const SCHEMA = { events: read(path.join(STD, "schema", "events.json")), metrics: read(path.join(STD, "schema", "metrics.json")) };
const REFERENCE = read(path.join(STD, "reference", "au.json"));
const money = (c) => (c == null ? "n/a" : (c / 100).toFixed(2));

function coverage(files) {
  const spoke = {};
  for (const f of files) { if (!f.account || !f.window) continue; (spoke[f.account] = spoke[f.account] || []).push(f.window); }
  return spoke;
}
/* The month ends a set of windows speak for. A month end inside any window counts. */
function monthsSpoken(windows, today) {
  const out = new Set();
  for (const w of windows) for (const ym of monthRange(w.from.slice(0, 7), w.to.slice(0, 7))) { const e = monthEnd(ym); if (e <= today && e <= w.to && e >= w.from) out.add(ym); }
  return [...out].sort();
}
const upTo = (dates) => { const last = dates.slice().sort().pop(); return monthRange("2026-07", last.slice(0, 7)).filter((m) => monthEnd(m) <= last); };

function chapterRun(world, intake, ch) {
  const c = script.chapters.find((x) => x.chapter === ch), files = world.files.filter((f) => f.held_from != null && f.held_from <= ch);
  const ids = new Set(), byPath = new Map(intake.files.map((e) => [e.path, e]));
  for (const f of files) { const e = byPath.get(f.path); if (e && e.source_id) ids.add(e.source_id); }
  const sources = intake.sources.filter((s) => ids.has(s.source_id)), observations = intake.observations.filter((o) => ids.has(o.source_id));
  const setup = setupAt(world.setup, c.today), receipts = files.map((f) => ({ stream_id: f.stream, day: f.delivered_on }));
  let L, crash = null;
  try { L = rebuild({ setup, sources, observations, decisions: [], rules: [], schema: SCHEMA, reference: REFERENCE, receipts, asOf: c.today }); } catch (e) { crash = String(e.stack).split("\n").slice(0, 5).join(" | "); }
  const active = new Set(intake.sources.filter((s) => s.status === "active").map((s) => s.source_id));
  const isRead = (f) => { const e = byPath.get(f.path); return !!(e && active.has(e.source_id) && (e.observations > 0 || e.duplicate_of)); };
  const unread = files.filter((f) => !isRead(f)).map((f) => { const u = intake.unknown_files.find((x) => x.path === f.path), g = intake.faults.filter((x) => x.path === f.path).slice(0, 2).map((x) => `${x.code}: ${x.what || ""}`.slice(0, 160)); return { path: f.path, family: f.family, reason: u ? u.reason : g.length ? "refused" : "no observations", detail: g }; });
  const res = { chapter: ch, title: c.title, today: c.today, files: files.length, read: files.filter(isRead).length, unread, crash, ties: 0, off: 0, off_examples: [], by_account: {}, L };
  if (!L) return res;
  const accts = {}, spoke = coverage(files.filter((f) => f.stream !== "CARD-A"));
  for (const id of Object.keys(spoke)) accts[id] = monthsSpoken(spoke[id], c.today);
  const issued = (stream) => files.filter((f) => f.stream === stream).map((f) => f.issued_on);
  if (files.some((f) => f.stream === "CARD-A")) accts["ACC-A-CARD"] = upTo(issued("CARD-A"));
  for (const k of ["A", "B"]) { const mine = files.filter((f) => f.stream === `SUPER-${k}`); if (mine.length) accts[`SUPER-${k}`] = upTo(mine.map((f) => { const m = /(\d{4}-\d{2}-\d{2})\.json$/.exec(f.name); return m ? m[1] : f.issued_on; })); }
  if (files.some((f) => f.stream === "LOAN")) accts["LN-HOME"] = upTo(issued("LOAN"));
  if (files.some((f) => f.stream === "HELP-A")) accts["HELP-A"] = upTo(issued("HELP-A"));
  if (files.some((f) => f.stream === "VALUE")) { const m = upTo(files.filter((f) => f.stream === "VALUE").map((f) => monthEnd(/(\d{4}-\d{2})\.csv/.exec(f.name)[1]))); accts.HOME = m; accts.CAR = m; }
  for (const [id, months] of Object.entries(accts)) {
    const t = world.truth.accounts[id]; if (!t) continue;
    let tie = 0, off = 0;
    for (const m of months) {
      if (t.months[m] == null) continue;
      const got = L.balances.at(id, m), want = t.months[m];
      if (got === want) tie += 1; else { off += 1; if (res.off_examples.length < 16) res.off_examples.push({ account: id, month: m, want, got }); }
    }
    res.ties += tie; res.off += off; res.by_account[id] = { tie, off };
  }
  res.review = (L.review || []).length;
  return res;
}

function sound(opts = {}) {
  const world = build({ ...opts, write: false });
  const pubRecipes = loadRecipes(path.join(STD, "recipes")), recipes = [...world.answers, ...pubRecipes];
  const list = world.files.map((f) => ({ path: f.path, bytes: f.bytes, stream: f.stream, download_date: f.delivered_on, name: f.name }));
  const manifest = { files: world.files.map((f) => ({ path: f.path, origin: f.origin, issued_on: f.issued_on })) };
  const intake = ingestFiles(list, { recipes, manifest, vocab: loadVocab(), inflate: hostInflate() });
  const pub = ingestFiles(list, { recipes: pubRecipes, manifest, vocab: loadVocab(), inflate: hostInflate() });
  const chapters = (opts.chapters || script.chapters.filter((c) => c.status === "full").map((c) => c.chapter)).map((ch) => chapterRun(world, intake, ch));
  return { family: world.root.split(path.sep).pop(), world, intake, pub, chapters, answers: world.answers };
}

if (require.main === module) {
  const a = process.argv.slice(2), val = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
  const t0 = Date.now(), r = sound({ seed: val("--seed") != null ? Number(val("--seed")) : 1, variant: a.includes("--variant") });
  console.log(`${r.family}: ${r.world.files.length} files. Unknown ${r.intake.unknown_files.length}, faults ${r.intake.faults.length}. Public recipes alone leave ${r.pub.unknown_files.length} unknown.`);
  for (const c of r.chapters) {
    console.log(`ch${c.chapter} ${c.today} files ${c.files} read ${c.read} unread ${c.unread.length} | balances tie ${c.ties} off ${c.off} | review ${c.review}${c.crash ? ` CRASH ${c.crash}` : ""}`);
    if (a.includes("-v")) { console.log(JSON.stringify(c.by_account)); for (const o of c.off_examples) console.log("  ", o.account, o.month, "want", money(o.want), "got", money(o.got)); const by = {}; for (const u of c.unread) { const k = `${u.family} ${u.reason} ${(u.detail[0] || "").slice(0, 90)}`; by[k] = (by[k] || 0) + 1; } console.log(by); }
  }
  console.log(`${Date.now() - t0} ms`);
}

module.exports = { sound };
