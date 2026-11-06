#!/usr/bin/env node
/* The life, scripted. Chapters 0 to 6 through the same verbs a page and an agent use, on the Fake store and again on a Folder store, for the Davies and for variant families.
     node life/run.js --check            the Davies on both stores and two variants. Fails per chapter. The ratchet is life/expected.json
     node life/run.js --check --all      every family on both stores
     node life/run.js --chapter 3        play to chapter 3 and show it
     node life/run.js --seed 7           one variant family
     node life/run.js --report [--out f] the plain report
     node life/run.js --accept           write life/expected.json from this run. A worse verdict then has to be argued in a diff
   A silently wrong trap is a recorded failure and stays on the page until it lands. It does not fail --check while life/findings holds a case for it; a new one does. */
"use strict";
const fs = require("fs"), path = require("path");
const { spawnSync, spawn } = require("child_process");

const EXPECTED = path.join(__dirname, "expected.json");
const DAVIES = { seed: 1, variant: false }, VARIANTS = [{ seed: 2, variant: true }, { seed: 3, variant: true }];
const STORES = ["fake", "folder"];
/* Every PR: the Davies on both stores, which must agree, and two variant families, one on each. --all puts every family on both. */
const MATRIX = [...STORES.map((store) => ({ ...DAVIES, store })), { ...VARIANTS[0], store: "fake" }, { ...VARIANTS[1], store: "folder" }];
const FULL = [DAVIES, ...VARIANTS].flatMap((f) => STORES.map((store) => ({ ...f, store })));

function parse(argv) {
  const out = { jobs: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--check") out.check = true; else if (a === "--report") out.report = true; else if (a === "--accept") out.accept = true; else if (a === "--json") out.json = true;
    else if (a === "--all") out.jobs = FULL;
    else if (a === "--chapter") out.chapter = Number(argv[++i]); else if (a === "--seed") out.family = { seed: Number(argv[++i]), variant: true };
    else if (a === "--davies") out.family = DAVIES; else if (a === "--store") out.store = argv[++i]; else if (a === "--out") out.out = argv[++i]; else if (a === "--one") out.one = JSON.parse(argv[++i]);
    else throw new Error(`I don't know ${a}.`);
  }
  return out;
}
/* One family on one store, in this process. */
async function play({ seed, variant, store, upto = 6 }) {
  const { loadFamily, K } = require("./harness/family");
  const { chapters, moveProof } = require("./harness/chapters");
  const { judge } = require("./harness/traps");
  const { ties, words } = require("./harness/score");
  const F = loadFamily({ seed, variant }), run = { F, kind: store, book: {}, asked: () => 0 }, started = Date.now(), counts = {};
  const allQuestions = () => [run.A, run.B, run.J].filter(Boolean).reduce((n, h) => n + h.questions.length, 0);
  const chaptersOut = [];
  let asked = 0;
  for (const n of [0, 1, 2, 3, 4, 5, 6].filter((x) => x <= upto)) {
    const t0 = Date.now(), b = await chapters[n](run), hh = b.hh, questions = allQuestions() - asked;
    asked += questions;
    const solo = n === 3 ? [[run.A, F.A.id], [run.B, F.B.id]] : [];
    let truth = ties(hh, b.built, F, { today: b.today, chapter: n, accounts: n === 3 ? ["ACC-JOINT"] : null, flows: n !== 3 && n !== 0 });
    for (const [h, who] of solo) {
      const built = await K.rebuildAt(h.store, { today: b.today }), t = ties(h, built, F, { today: b.today, chapter: n, accounts: Object.keys(F.chapter(n).show.balances).filter((a) => a !== "ACC-JOINT" && (who === F.A.id ? /-A(-|$)/.test(a) : /-B(-|$)/.test(a))), flows: false });
      truth = { tied: truth.tied + t.tied, off: [...truth.off, ...t.off], by: { ...truth.by } };
    }
    counts[n] = { questions, ms: Date.now() - t0 };
    chaptersOut.push({ chapter: n, title: F.chapter(n).title, today: b.today, ms: Date.now() - t0, questions, status: b.status.words, next: { id: b.next.id, say: b.next.say }, bundle_hash: b.status.bundle_hash, laws: b.status.readiness.laws, stuck: b.stuck, truth, words: words(run, n), transcript: hh.transcript.map((x) => `${x.id}: ${x.say}`), clicks: b.clicks });
  }
  const traps = await judge(run, upto);
  const book = run.book, extra = {};
  if (book[3]) { const j = book[3].joined; extra.join = { questions: book[3].hh.questions.filter((q) => q.day === book[3].today).map((q) => q.what), asked: book[3].hh.questions.filter((q) => q.day === book[3].today).length, after_merge: chaptersOut[3].transcript.length, rebound_decisions: j.rebound_decisions, unbound: j.unbound.length, private: j.private, positions: j.positions.length, not_carried: j.not_carried, what_if: book[3].whatIf.proposals.map((p) => p.period), homes: { ok: j.homes.ok, in_two: j.homes.in_two }, audit_ok: j.audit.every((a) => a.ok) }; }
  if (book[4]) extra.share = { proposals: book[4].proposals.map((p) => p.period), locked_first: book[4].lockedFirst, audit_ok: book[4].sharedA.audit.ok && book[4].sharedB.audit.ok };
  if (book[6]) { const p = book[6].pocket; extra.pocket = { bundle_same: p.bundle_same, ledger_memo_cents: p.ledger_memo_cents, at_today: p.at_today, expected: p.expected, result: p.result, example_ok: p.example_ok, stages: p.deal.map((d) => `${d.name} ${d.stage.age}: ${d.stage.stage}`), dry: { summary: p.dry.summary, moved: p.dry.moved.length, proposals: p.dry.proposals.length, x: p.dry.x }, taken: { originals_changed: p.taken.originals_changed, locked: p.taken.locked, locked_moved: p.taken.locked_moved, unbound: p.taken.unbound.length, carried: p.taken.carried, tailoring: p.taken.tailoring.map((t) => `${t.name}: ${t.status}`) }, spawned: { rows: p.spawned.rows, moved_cents: p.spawned.moved_cents, closed: p.spawned.closed.length, left_behind: p.leftBehind[p.salt], held_after: p.heldAfter } }; }
  if (book[6]) extra.move = await moveProof(run);
  return { family: F.label, seed, variant, store, ms: Date.now() - started, chapters: chaptersOut, traps, ...extra };
}
function digest(r) { return r.chapters.map((c) => ({ chapter: c.chapter, bundle_hash: c.bundle_hash, status: c.status, next: c.next, transcript: c.transcript, tied: c.truth.tied, questions: c.questions })); }
async function all(args) {
  const picked = args.family ? (args.store ? [args.store] : STORES).map((store) => ({ ...args.family, store })) : args.jobs || (args.store ? FULL.filter((j) => j.store === args.store) : MATRIX);
  const jobs = picked.map((j) => ({ ...j, upto: args.chapter ?? 6 }));
  const cores = Math.max(1, Math.min(jobs.length, require("os").availableParallelism ? require("os").availableParallelism() : 4));
  const results = [], queue = [...jobs];
  await Promise.all(Array.from({ length: cores }, async () => {
    while (queue.length) {
      const job = queue.shift();
      results.push(await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [__filename, "--one", JSON.stringify(job)], { stdio: ["ignore", "pipe", "inherit"] }), out = [];
        child.stdout.on("data", (d) => out.push(d));
        child.on("close", (code) => { if (code) return reject(new Error(`${job.seed}/${job.store} exited ${code}`)); resolve(JSON.parse(Buffer.concat(out).toString())); });
      }));
    }
  }));
  return results.sort((a, b) => a.seed - b.seed || a.store.localeCompare(b.store));
}
const RANK = { handled: 3, flagged: 2, not_run: 1, silently_wrong: 0, pending: 3 };
function compare(results, expected, frictionCases) {
  const fails = [], improved = [], byFamily = new Map();
  for (const r of results) byFamily.set(r.family, [...(byFamily.get(r.family) || []), r]);
  for (const [family, runs] of byFamily) {
    const want = expected[family];
    if (runs.length > 1) for (let i = 0; i < digest(runs[0]).length; i += 1) {
      const a = JSON.stringify(digest(runs[0])[i]), b = JSON.stringify(digest(runs[1])[i]);
      if (a !== b) fails.push(`${family} ch${i}: ${runs[0].store} and ${runs[1].store} disagree.`);
    }
    for (const r of runs) {
      for (const c of r.chapters) {
        const known = (want && want.words_off[c.chapter]) || [];
        for (const w of c.words) if (!w.ok && !known.includes(w.what)) fails.push(`${family}/${r.store} ch${c.chapter} words: ${w.what}: want "${w.want}"`);
        const off = {}; for (const o of c.truth.off) off[o.kind] = (off[o.kind] || 0) + 1;
        for (const [kind, n] of Object.entries(off)) {
          const had = ((want && want.truth_off[c.chapter]) || {})[kind] || 0;
          if (n > had) { fails.push(`${family}/${r.store} ch${c.chapter} truth: ${n} ${kind} off, the ratchet allows ${had}.`); for (const o of c.truth.off.filter((x) => x.kind === kind).slice(0, 3)) fails.push(`    ${o.what} want ${o.want} got ${o.got}`); }
        }
        if (c.stuck) fails.push(`${family}/${r.store} ch${c.chapter} stuck at ${c.stuck}: ${c.next.say}`);
        if (want) for (const f of c.laws.failing) if (!(want.laws[c.chapter] || []).includes(f.law)) fails.push(`${family}/${r.store} ch${c.chapter} law ${f.law} ${f.scope}: ${f.detail}`);
        if (want && want.questions[c.chapter] != null && c.chapter === 3 && r.join.asked !== want.join_questions) fails.push(`${family}/${r.store} ch3: ${r.join.asked} questions on joining day, the chapter holds ${want.join_questions}.`);
      }
      if (r.join && (!r.join.audit_ok || !r.join.homes.ok || r.join.unbound)) fails.push(`${family}/${r.store} ch3: a merge law broke: ${JSON.stringify(r.join)}`);
      if (r.pocket && (!r.pocket.bundle_same || r.pocket.ledger_memo_cents || !r.pocket.example_ok || r.pocket.taken.originals_changed.length || r.pocket.taken.locked_moved.length || r.pocket.taken.unbound)) fails.push(`${family}/${r.store} ch6: tailoring broke a law: ${JSON.stringify({ b: r.pocket.bundle_same, m: r.pocket.ledger_memo_cents, e: r.pocket.example_ok, o: r.pocket.taken.originals_changed, l: r.pocket.taken.locked_moved.length, u: r.pocket.taken.unbound })}`);
      if (r.move && !(r.move.hash.same && r.move.audit_ok && r.move.sources_same && r.move.observations_same && r.move.jars_same && r.move.next === "moved" && r.move.refused === "moved" && !r.move.l12_fails)) fails.push(`${family}/${r.store}: the move did not hold: ${JSON.stringify(r.move)}`);
      for (const [id, t] of Object.entries(r.traps)) {
        if (t.verdict === "silently_wrong" && !frictionCases.has(id)) fails.push(`${family}/${r.store} ${id} is silently wrong and no friction row holds it: ${t.note}`);
        const had = t.verdict !== "pending" && want && want.traps[id];
        if (had && RANK[t.verdict] < RANK[had]) fails.push(`${family}/${r.store} ${id} got worse: was ${had}, now ${t.verdict}. ${t.note}`);
        if (had && RANK[t.verdict] > RANK[had]) improved.push(`${family} ${id}: ${had} to ${t.verdict}`);
      }
    }
  }
  return { fails, improved: [...new Set(improved)] };
}
function frictionHolds() {
  const { rows } = require("./friction");
  return new Set(rows().map((r) => r.trap).filter(Boolean));
}
function baseline(results) {
  const out = {};
  for (const r of results) {
    const e = out[r.family] || (out[r.family] = { traps: {}, laws: {}, questions: {}, truth_off: {}, words_off: {}, join_questions: r.join ? r.join.asked : null });
    for (const [id, t] of Object.entries(r.traps)) e.traps[id] = t.verdict;
    for (const c of r.chapters) {
      e.laws[c.chapter] = [...new Set([...(e.laws[c.chapter] || []), ...c.laws.failing.map((f) => f.law)])].sort(); e.questions[c.chapter] = c.questions;
      const off = {}; for (const o of c.truth.off) off[o.kind] = (off[o.kind] || 0) + 1;
      if (Object.keys(off).length) e.truth_off[c.chapter] = off;
      const words = c.words.filter((w) => !w.ok).map((w) => w.what); if (words.length) e.words_off[c.chapter] = words;
    }
  }
  return out;
}
async function main() {
  const args = parse(process.argv.slice(2));
  if (args.one) { process.stdout.write(JSON.stringify(await play(args.one))); return; }
  const results = await all(args), { report, table } = require("./harness/report");
  if (args.accept && !args.jobs) throw new Error("--accept needs --all, so the ratchet covers every family on both stores.");
  if (args.accept) { fs.writeFileSync(EXPECTED, `${JSON.stringify(baseline(results), null, 1)}\n`); console.log(`Wrote ${path.relative(process.cwd(), EXPECTED)}.`); return; }
  const expected = fs.existsSync(EXPECTED) ? JSON.parse(fs.readFileSync(EXPECTED, "utf8")) : {}, { fails, improved } = compare(results, expected, frictionHolds());
  const text = report(results, { fails, improved });
  if (args.out) fs.writeFileSync(args.out, text);
  if (args.json) console.log(JSON.stringify(results, null, 1));
  else if (args.report && !args.out) console.log(text);
  else console.log(table(results, { fails, improved }));
  if (args.check && fails.length) process.exit(1);
}
if (require.main === module) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
module.exports = { play, all, compare, baseline };
