#!/usr/bin/env node
/* Is the world sound by the Standard's own reader? Each chapter's files go through standard/intake and the engine, and the balances come back to truth at every month end the files speak for.
   Nothing here adjusts a file or a number to improve the result. node life/world/sound.js prints a table; --check fails if a chapter's expectation breaks. */
"use strict";
const fs = require("fs"), path = require("path");
const { build, script, OUT } = require("./build");
const { STD, REPO, monthRange, monthEnd } = require("./lib/std");
const { setupAt } = require("./lib/setup");
const { ingestFiles, loadRecipes, loadVocab, hostInflate } = require(path.join(STD, "intake"));
const { rebuild } = require(path.join(STD, "engine", "rebuild"));

const Engine = require(path.join(REPO, "src", "engine.js"));
const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
Engine.loadMerchants({ merchants: read(path.join(REPO, "merchants", "merchants.json")), categories: read(path.join(REPO, "merchants", "categories.json")) });
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
  const c = script.chapters.find((x) => x.chapter === ch), own = c.status !== "full", files = world.files.filter((f) => f.held_from != null && (own ? f.held_from === ch : f.held_from <= ch));
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
  // Each line once: the count of lines the engine holds for a month against the book. This is what a double import would break first, and a balance alone can hide it.
  const book = {}; for (const l of world.sim.lines) { const k = `${l.acct}|${l.date.slice(0, 7)}`; book[k] = (book[k] || 0) + 1; }
  const seen = {}; for (const l of L.lines || []) { const k = `${l.account}|${l.date.slice(0, 7)}`; seen[k] = (seen[k] || 0) + 1; }
  res.lines = { tie: 0, off: 0, off_examples: [] };
  for (const [id, months] of Object.entries(accts)) { if (!/^ACC-/.test(id)) continue; for (const m of months) { const a = book[`${id}|${m}`] || 0, b = seen[`${id}|${m}`] || 0; if (a === b) res.lines.tie += 1; else { res.lines.off += 1; if (res.lines.off_examples.length < 8) res.lines.off_examples.push({ account: id, month: m, want: a, got: b }); } } }
  // Income and spending by month against the book, over the cash accounts this chapter holds. Reported, not gated: a person's decisions would settle what is still a question.
  const cash = new Set(Object.keys(accts).filter((a) => /^ACC-/.test(a) && a !== "SHR-RSU"));
  if (!own && cash.size) {
    const months = [...cash].map((a) => accts[a]).reduce((x, y) => x.filter((m) => y.includes(m)));
    let spend = 0, spendOff = 0, inc = 0, incOff = 0; const worst = [];
    for (const m of months) {
      const row = L.cash.find((x) => x.month === m) || { income: 0, spending: 0, unexplained: 0 }, in_ = world.sim.lines.filter((l) => cash.has(l.acct) && l.date.slice(0, 7) === m);
      const a = in_.filter((l) => l.lens === "income").reduce((t, l) => t + l.cents, 0), b = -in_.filter((l) => l.lens === "spending").reduce((t, l) => t + l.cents, 0);
      if (row.income + row.unexplained === a) inc += 1; else { incOff += 1; if (worst.length < 4) worst.push({ month: m, income_gap: row.income + row.unexplained - a }); }
      if (row.spending === b) spend += 1; else { spendOff += 1; if (worst.length < 4) worst.push({ month: m, spending_gap: row.spending - b }); }
    }
    res.flows = { income_months_tie: inc, income_months_off: incOff, spending_months_tie: spend, spending_months_off: spendOff, worst };
  }
  const lawRows = L.checks || []; res.laws = {}; for (const k of lawRows) if (k.status === "fail") res.laws[k.law] = (res.laws[k.law] || 0) + 1;
  res.review = (L.review || []).length;
  return res;
}

function sound(opts = {}) {
  const world = build({ ...opts, write: false });
  if (opts.tamper) opts.tamper(world);
  const pubRecipes = loadRecipes(path.join(STD, "recipes")), recipes = [...world.answers, ...pubRecipes];
  const list = world.files.map((f) => ({ path: f.path, bytes: f.bytes, stream: f.stream, download_date: f.delivered_on, name: f.name }));
  const manifest = { files: world.files.map((f) => ({ path: f.path, origin: f.origin, issued_on: f.issued_on })) };
  const intake = ingestFiles(list, { recipes, manifest, vocab: loadVocab(), inflate: hostInflate() });
  const pub = opts.public === false ? { unknown_files: [] } : ingestFiles(list, { recipes: pubRecipes, manifest, vocab: loadVocab(), inflate: hostInflate() });
  const chapters = (opts.chapters || script.chapters.filter((c) => ["full", "simplified"].includes(c.status)).map((c) => c.chapter)).map((ch) => chapterRun(world, intake, ch));
  return { family: world.root.split(path.sep).pop(), world, intake, pub, chapters, answers: world.answers };
}

if (require.main === module) {
  const a = process.argv.slice(2), val = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
  const t0 = Date.now(), r = sound({ seed: val("--seed") != null ? Number(val("--seed")) : 1, variant: a.includes("--variant") });
  console.log(`${r.family}: ${r.world.files.length} files. Unknown ${r.intake.unknown_files.length}, faults ${r.intake.faults.length}. Public recipes alone leave ${r.pub.unknown_files.length} unknown.`);
  for (const c of r.chapters) {
    console.log(`ch${c.chapter} ${c.today} files ${c.files} read ${c.read} unread ${c.unread.length} | balances tie ${c.ties} off ${c.off} | line counts tie ${c.lines ? c.lines.tie : 0} off ${c.lines ? c.lines.off : 0}${c.flows ? ` | spending months ${c.flows.spending_months_tie}/${c.flows.spending_months_tie + c.flows.spending_months_off} income months ${c.flows.income_months_tie}/${c.flows.income_months_tie + c.flows.income_months_off}` : ""} | review ${c.review}${c.crash ? ` CRASH ${c.crash}` : ""}`);
    if (a.includes("-v")) { console.log(JSON.stringify(c.by_account)); for (const o of c.off_examples) console.log("  ", o.account, o.month, "want", money(o.want), "got", money(o.got)); if (c.lines) for (const o of c.lines.off_examples) console.log("  lines", o.account, o.month, "want", o.want, "got", o.got); if (c.flows) console.log("  flows", JSON.stringify(c.flows.worst)); const by = {}; for (const u of c.unread) { const k = `${u.family} ${u.reason} ${(u.detail[0] || "").slice(0, 90)}`; by[k] = (by[k] || 0) + 1; } console.log(by); }
  }
  console.log(`${Date.now() - t0} ms`);
  if (a.includes("--check")) {
    const bad = r.chapters.filter((c) => c.crash || c.off || (c.lines && c.lines.off) || c.unread.some((u) => !/^life-(will|bas)-pdf$/.test(u.family)));
    if (bad.length) { console.error(`not sound: chapters ${bad.map((c) => c.chapter).join(", ")}`); process.exit(1); }
    console.log("sound");
  }
}

module.exports = { sound };
