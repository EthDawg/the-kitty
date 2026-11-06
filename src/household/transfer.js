/* transfer: a dated slice of originals, with consent, adopted in another store. One way. Move, spawn and handover are named recipes over it, and merge is a slice plus an identity map.
   Laws, each held by audit() and homes(): nothing lost, nothing counted twice, a source has one home or is explicitly shared.
   Originals keep captured_at. Adopted setup and judgement rows get recorded_at at transfer time and carry their own time in note; a table with no note carries it in the transfer's own row.
   One exception, written down in life/HARNESS-DECISIONS.md: a term keeps its recorded_at, because the engine orders a term against dated notices by that column.
   A store is written in the order `add` writes it: bytes, setup, judgement, evidence, and the source rows last, because the source row is the commit. Run it again after any failure. */
"use strict";
const { hash64, stableStringify, monthOf, addDays } = require("../../standard/engine/util");
const { sealOf } = require("../../standard/engine/laws");
const { loadOriginals, latest, dayOf, rebuildAt, ORIGINALS } = require("./clock");
const { ready, init, stamp, fail } = require("./init");
const { columnsOf, pkOf } = require("./tabs");
const { monthYear } = require("./words");

const EVIDENCE = ["observation", "x_delivery"];
const JUDGEMENT = ["recipe", "rule", "decision"];
const SETUP = ORIGINALS.filter((t) => !["source", ...EVIDENCE, ...JUDGEMENT].includes(t));
const dateOfObs = (o) => { const p = o.payload || {}; return o.occurred_on || p.posting_date || p.period_end || p.as_at || p.pay_date || null; };
const hasColumn = (table, name) => columnsOf(table).some((c) => c.name === name);
const withinOf = ({ from, to }) => (d) => !!d && (!from || d >= from) && (!to || d <= to);

/* What would cross. Nothing is written. spec: { from, to, keep(obs, source) => bool, setup(table, row) => bool, decision(row) => bool, whole: [source_id] }.
   A file that straddles the date crosses as its lines inside the window, and its bytes stay home, because those bytes hold the lines that did not cross. */
async function slice(store, spec = {}) {
  const o = await loadOriginals(store), m = await store.manifest(), within = withinOf(spec), whole = new Set(spec.whole || []);
  const sources = latest("source", o.source), byId = new Map(sources.map((s) => [s.source_id, s]));
  const allow = spec.keep || (() => true), lines = new Map(), left = new Map();
  for (const x of o.observation) {
    const s = byId.get(x.source_id); if (!s) continue;
    // A statement belongs to the day its period starts. Crossing on its last day, it would state an opening over lines that did not cross, and two windows side by side would both drop it.
    const d = (x.payload && x.payload.period_start) || dateOfObs(x) || dayOf(s.issued_on || s.captured_at);
    const inside = (whole.has(s.source_id) || within(d)) && allow(x, s);
    (inside ? lines : left).set(x.source_id, [...((inside ? lines : left).get(x.source_id) || []), x]);
  }
  const noLines = sources.filter((s) => !lines.has(s.source_id) && !left.has(s.source_id) && (whole.has(s.source_id) || within(dayOf(s.issued_on || s.captured_at))) && allow(null, s));
  const moving = [...sources.filter((s) => lines.has(s.source_id)), ...noLines].map((s) => s);
  const partial = moving.filter((s) => left.has(s.source_id)).map((s) => s.source_id);
  const tables = { source: moving, observation: [...lines.values()].flat(), x_delivery: o.x_delivery.filter((d) => moving.some((s) => s.source_id === d.source_id)) };
  for (const t of SETUP) tables[t] = spec.setup ? o[t].filter((r) => spec.setup(t, r)) : o[t];
  tables.period = (spec.period ? o.period.filter(spec.period) : o.period.filter((p) => within(p.start_on)));
  tables.rule = o.rule; tables.recipe = o.recipe;
  tables.decision = latest("decision", o.decision).filter(spec.decision || ((d) => {
    if (d.target_type === "line") { const [, day] = String(d.target_ref).split("|"); return within(day); }
    return d.target_type === "period" && within(`${d.target_ref}-01`);
  }));
  const blobs = moving.filter((s) => /^blob:sha256:/.test(s.uri || "") && !partial.includes(s.source_id)).map((s) => s.sha256);
  const left_behind = { sources: sources.length - moving.length, lines: [...left.values()].reduce((n, r) => n + r.length, 0) };
  return { household_id: m.household_id, from: spec.from || null, to: spec.to || null, tables, blobs, partial, left_behind };
}
const replaceIn = (row, map) => { if (!map || !map.size) return row; const out = {}; for (const [k, v] of Object.entries(row)) out[k] = typeof v === "string" && map.has(v) ? map.get(v) : v; return out; };
function rebindRef(ref, map) { const [a, ...rest] = String(ref).split("|"); return map && map.has(a) ? [map.get(a), ...rest].join("|") : ref; }
const noted = (row, words) => ({ ...row, note: [row.note, words].filter(Boolean).join(" ") });
/* Rows as the receiving Kitty holds them. Keeps its own time in a note, or in `times` where the table has no note. */
function restamp(table, row, { today, home, map, times }) {
  const r = replaceIn(row, map);
  if (table === "decision") {
    const value = { ...(r.value || {}), first_decided: { at: r.at, by: r.by, in: home } };
    return { ...r, target_ref: r.target_type === "line" ? rebindRef(r.target_ref, map) : r.target_ref, value, at: stamp(today) };
  }
  if (!hasColumn(table, "recorded_at")) return r;
  const own = r.recorded_at, said = own ? `First recorded ${dayOf(own)} in ${home}.` : null;
  if (table === "term") return noted(r, `Adopted ${today} from ${home}.`);
  const out = { ...r, recorded_at: stamp(today) };
  if (hasColumn(table, "note")) return said ? noted(out, said) : out;
  if (own) times.push({ table, row: hash64(stableStringify(out)), recorded_at: own });
  return out;
}
const decisionId = (d) => `D-${hash64(stableStringify([d.target_ref, d.verb, d.value && d.value.category_id, d.value && d.value.event_kind]))}`;
/* Put a slice in a store. map: Map of old id to new. A partial source keeps its row and loses its bytes' address. */
async function adopt(target, s, { today, map, partialNote } = {}) {
  if (!today) throw fail("no_today", "adopt needs today.");
  const home = s.household_id, times = [], counts = {};
  for (const sha of s.blobs) {
    if (!target.blobs) break;
    const bytes = await s.read(sha);
    if (bytes) await target.blobs.put(sha, bytes, {});
  }
  const carry = (table) => (s.tables[table] || []).map((r) => restamp(table, r, { today, home, map, times }));
  for (const table of SETUP) { const rows = carry(table); if (rows.length) counts[table] = await target.tables.adopt(table, rows); }
  counts.recipe = await target.tables.adopt("recipe", s.tables.recipe || []);
  counts.rule = await target.tables.adopt("rule", carry("rule"));
  // A rebound decision takes a new id, so two people's identical answers about one line are one row.
  const seen = new Set(), decisions = [];
  for (const d of carry("decision")) {
    const row = map && map.size && d.target_type === "line" && d.target_ref !== (s.tables.decision.find((x) => x.decision_id === d.decision_id) || {}).target_ref ? { ...d, decision_id: decisionId(d) } : d;
    if (seen.has(row.decision_id)) continue; seen.add(row.decision_id); decisions.push(row);
  }
  const have = new Set((await target.tables.read("decision")).map((d) => d.decision_id));
  counts.decision = await target.tables.adopt("decision", decisions.filter((d) => !have.has(d.decision_id)));
  // One file named two ways reads as two sets of lines with one id. The same bytes at the same place are one line, whoever dropped them first.
  counts.observation = await target.tables.appendNew("observation", s.tables.observation || []);
  counts.x_delivery = await target.tables.adopt("x_delivery", (s.tables.x_delivery || []).map((r) => replaceIn(r, map)));
  const sources = s.tables.source.map((r) => {
    const out = replaceIn(r, map);
    return s.partial.includes(r.source_id) ? { ...out, uri: `not-held:${r.name}`, note: partialNote || `Part of this file came across on ${today}. The file itself stayed in ${home}, because it holds lines that did not.` } : out;
  });
  const known = new Set((await target.tables.read("source")).map((r) => r.source_id));
  counts.source = await target.tables.adopt("source", sources.filter((r) => !known.has(r.source_id)));
  return { counts, times };
}
const transferId = (recipe, from, to, today) => `transfer-${hash64(stableStringify([recipe, from, to, today]))}`;
/* The record of a transfer, in both stores. A decision, because consent is one: who, when, in what words, and what crossed. It binds to nothing in the ledger. */
function logRow({ id, role, recipe, from, to, consent, today, slice: s, counts, times, shared, map }) {
  const by = Array.isArray(consent) ? consent.map((c) => c.by).join(" and ") : consent.by;
  return { decision_id: `${id}-${role}`, target_type: "source", target_ref: `transfer:${id}`, verb: "note", by, at: stamp(today), status: "accepted", reason: `${recipe}: ${role === "out" ? `to ${to}` : `from ${from}`}. ${[].concat(consent).map((c) => `${c.by} said: ${c.words}`).join(" ")}`,
    value: { transfer: id, recipe, role, from_household: from, to_household: to, window: { from: s.from, to: s.to }, consent, shared: shared || [], partial: s.partial, counts, left_behind: s.left_behind, own_times: times, ...(map && map.size ? { map: Object.fromEntries(map) } : {}) } };
}
const needConsent = (consent) => {
  const list = [].concat(consent || []);
  if (!list.length || list.some((c) => !c.by || !c.words)) throw fail("no_consent", "A transfer needs someone's yes: who said it, and their words.");
};
/* The one-way act: slice, adopt, audit, log in both stores. spec as in slice. opts: { today, consent, recipe, map, shared }. */
async function transfer(source, target, spec, opts) {
  const { today, consent, recipe = "transfer", map } = opts, shared = opts.shared;
  if (!today) throw fail("no_today", "transfer needs today.");
  needConsent(consent);
  await ready(source); await ready(target);
  const s = await slice(source, spec), to = (await target.manifest()).household_id, id = transferId(recipe, s.household_id, to, today);
  s.read = (sha) => source.blobs.get(sha);
  const { counts, times } = await adopt(target, s, { today, map });
  const audited = await audit(s, target, { map });
  const row = (role) => logRow({ id, role, recipe, from: s.household_id, to, consent, today, slice: s, counts, times: role === "in" ? times : [], shared: shared || s.tables.source.map((x) => x.source_id), map });
  await target.tables.appendNew("decision", [row("in")]);
  await source.tables.appendNew("decision", [row("out")]);
  return { transfer_id: id, recipe, slice: s, counts, audit: audited };
}
/* Nothing lost: every line and file that was to cross is there. Nothing counted twice: no line or file is there twice. */
async function audit(s, target, { map } = {}) {
  const obs = await target.tables.read("observation"), sources = latest("source", await target.tables.read("source"));
  const idsIn = new Map(); for (const o of obs) idsIn.set(o.obs_id, (idsIn.get(o.obs_id) || 0) + 1);
  const lost = s.tables.observation.filter((o) => !idsIn.has(o.obs_id)).map((o) => o.obs_id);
  const srcIds = new Set(sources.map((x) => x.source_id));
  const lostFiles = s.tables.source.filter((x) => !srcIds.has(x.source_id)).map((x) => x.source_id);
  const twice = [...idsIn].filter(([, n]) => n > 1).map(([k]) => k);
  const blobs = [];
  if (target.blobs) for (const sha of s.blobs) if (!(await target.blobs.has(sha))) blobs.push(sha);
  return { ok: !lost.length && !lostFiles.length && !twice.length && !blobs.length, lost, lost_files: lostFiles, twice, lost_bytes: blobs, map_size: map ? map.size : 0 };
}
/* A source has one home or is explicitly shared. Over any set of stores: a source held by two is fine only when a transfer named it, or it has been handed on and the first store has stopped. */
async function homes(stores) {
  const seen = new Map(), shared = new Set();
  for (const store of stores) {
    const m = await store.manifest();
    if (m.state === "moved") continue; // it stopped, so what it held has one home now
    for (const s of latest("source", await store.tables.read("source"))) seen.set(s.source_id, [...(seen.get(s.source_id) || []), m.household_id]);
    for (const d of await store.tables.read("decision")) if (d.value && d.value.transfer) for (const id of d.value.shared || []) shared.add(id);
  }
  const unnamed = [...seen].filter(([id, where]) => where.length > 1 && !shared.has(id)).map(([id, where]) => ({ source_id: id, where }));
  return { ok: !unnamed.length, sources: seen.size, in_two: [...seen.values()].filter((w) => w.length > 1).length, unnamed };
}
/* A locked month a slice lands in. It stays locked; L12 says so, `next` says so, and this says how much. */
async function proposals(target, { today, built } = {}) {
  const b = built || (await rebuildAt(target, { today })), out = [];
  for (const p of b.view.setup.period.filter((x) => x.status === "locked" && x.seal_hash)) {
    if (sealOf(b.L, p) === p.seal_hash) continue;
    const m = b.L.cash.find((x) => x.month === p.period_id);
    out.push({ kind: "reopen", period: p.period_id, spending_cents: m ? m.spending : 0, what: `${monthYear(p.period_id)} was locked, and what came across changes it. It stays as it is until someone reopens it.` });
  }
  return out;
}
/* Named recipes. */
// move: everything, to a new store. The old one stops, and the two rebuild to one bundle hash, or nothing is stopped.
async function move(source, target, { today, consent }) {
  needConsent(consent);
  const manifest = await ready(source), hh = latest("household", await source.tables.read("household"));
  await init(target, { household: hh[0], today });
  const s = await transfer(source, target, { period: () => true, setup: (t) => !["household"].includes(t), decision: () => true }, { today, consent, recipe: "move", shared: [] });
  // A household's own tables are part of what moved.
  for (const [table, columns] of Object.entries(manifest.x_tables || {})) { await target.define(table, columns); s.counts[table] = await target.tables.adopt(table, await source.tables.read(table)); }
  const before = await rebuildAt(source, { today }), after = await rebuildAt(target, { today });
  const hash = { source: before.L.bundleHash, target: after.L.bundleHash, same: before.L.bundleHash === after.L.bundleHash };
  if (!hash.same || !s.audit.ok) throw fail("move_failed", `The move did not rebuild to the same household (${hash.source}, ${hash.target}). The old Kitty is still the one in use.`, { hash, audit: s.audit });
  await target.tables.countOriginals(await loadOriginals(target));
  await source.setManifest({ ...(await source.manifest()), state: "moved", moved_to: hh[0].household_id, written_at: stamp(today) });
  return { ...s, hash };
}
// handover: one person's originals, as a copy, to someone acting for them. The first store stays, so every source crossing is shared by name.
async function handover(source, target, { today, consent, keep, setup }) {
  return transfer(source, target, { keep, setup, period: () => false, decision: () => false }, { today, consent, recipe: "handover" });
}
module.exports = { transfer, slice, adopt, audit, homes, proposals, move, handover, rebindRef, replaceIn, restamp, needConsent, logRow, transferId, dateOfObs, monthOf, addDays };
