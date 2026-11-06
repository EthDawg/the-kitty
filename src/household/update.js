/* An update. SPEC 13: a dry-run rebuild plus a metric diff. "Nothing you entered changes; these numbers move, and here is why; locked years stay as they are."
   Accepting backs up, writes a plan, applies it and reads it back. A locked month is never moved: a release's rules start at the first open month, and what they would have done
   to a locked one is a reopen proposal with its amount. A family's own x_ table is carried to a shared extension's by a declared mapping, and the old table stays as it was. */
"use strict";
const { planUpdate: engineDiff, hashTable } = require("../../standard/engine/upgrade");
const { sealOf } = require("../../standard/engine/laws");
const { stableStringify, hash64, monthOf } = require("../../standard/engine/util");
const { sha256 } = require("../../standard/intake/sha256");
const { base } = require("./base");
const { rebuildAt, loadOriginals, latest, ORIGINALS } = require("./clock");
const { ready, stamp, fail } = require("./init");
const { tailor, check, rows: tailoringRows, idFor } = require("./tailor");
const { record } = require("./replay");
const pocketMoney = require("./extensions/pocket-money.json");

const EXTENSIONS = { "pocket-money": pocketMoney };
const nextMonth = (m) => { const y = Number(m.slice(0, 4)), n = Number(m.slice(5, 7)); return n === 12 ? `${y + 1}-01` : `${y}-${String(n + 1).padStart(2, "0")}`; };
function firstOpenMonth(periods) {
  const locked = periods.filter((p) => p.status === "locked").map((p) => p.period_id).sort();
  return locked.length ? `${nextMonth(locked[locked.length - 1])}-01` : "1900-01-01";
}
// Money that moves between categories leaves the totals alone. A person still wants to see it.
function categoryMoves(before, after) {
  const out = [], rows = (L) => new Map(L.cash.map((m) => [m.month, m.byCategory]));
  const a = rows(before), b = rows(after);
  for (const m of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(m) || {}, y = b.get(m) || {};
    for (const c of new Set([...Object.keys(x), ...Object.keys(y)])) if ((x[c] || 0) !== (y[c] || 0)) out.push({ month: m, category: c, change: (y[c] || 0) - (x[c] || 0) });
  }
  return out.sort((p, q) => (p.month < q.month ? -1 : p.month > q.month ? 1 : p.category < q.category ? -1 : 1));
}
/* map: { family's column: extension's column, or { value } for a constant, or { from, values } to translate }. Pure, and it is the whole migration: a family's rows in, the extension's rows out. */
function migrateRows(rows, { key, map }) {
  return rows.map((r, i) => {
    const out = {};
    for (const [to, how] of Object.entries(map)) {
      if (typeof how === "string") out[to] = r[how];
      else if ("value" in how) out[to] = how.value;
      else out[to] = (how.values || {})[r[how.from]] ?? r[how.from];
    }
    return { ...out, [key || "entry_id"]: out[key || "entry_id"] || `E-${hash64(stableStringify(r))}-${i}` };
  });
}
const sumOf = (rows, field) => rows.reduce((n, r) => n + Number(r[field] || 0), 0);
/* The dry run. Nothing is written. migrate: { from: family's x_ table, to: extension id, map, sum: { from, to } }. */
async function planUpdate(store, release, { today, migrate = [] } = {}) {
  if (!today) throw fail("no_today", "an update needs today.");
  await ready(store);
  const originals = await loadOriginals(store), before = await rebuildAt(store, { today, originals }), periods = latest("period", originals.period);
  const rules_from = firstOpenMonth(periods), rules = release.rules || [];
  const unfenced = await rebuildAt(store, { today, originals, extraRules: rules });
  const after = await rebuildAt(store, { today, originals, extraRules: rules.map((r) => ({ ...r, valid_from: rules_from })) });
  const reach = engineDiff({ before: before.L, after: unfenced.L, periods }), diff = engineDiff({ before: before.L, after: after.L, originals: { before: originals, after: originals }, periods });
  const moved = categoryMoves(before.L, after.L), stayed = categoryMoves(before.L, unfenced.L).filter((m) => m.month < monthOf(rules_from));
  const x = [];
  for (const job of migrate) {
    const rows = await store.tables.read(job.from), ext = EXTENSIONS[job.to], out = migrateRows(rows, { key: ext.table.columns[0].split(":")[0], map: job.map });
    x.push({ from: job.from, to: ext.table.name, rows: rows.length, migrated: out.length, sum_before: sumOf(rows, job.sum.from), sum_after: sumOf(out, job.sum.to), keeps_sum: sumOf(rows, job.sum.from) === sumOf(out, job.sum.to) });
  }
  const said = `${diff.summary} ${moved.length ? `${moved.length} category amounts move, from ${monthOf(rules_from)} on.` : "No category moves."}`;
  return { dry_run: true, release: release.release_id, rules_from, summary: said, moved, totals_moved: diff.moved, proposals: reach.proposals.map((p) => ({ ...p, category_moves: stayed.filter((m) => m.month === p.period).length })), originals_touched: diff.originals_touched, unbound_decisions: diff.unbound_decisions, x, tailoring: await check(store), bundle: { before: before.L.bundleHash, after: after.L.bundleHash } };
}
const originalsHash = async (store) => { const o = await loadOriginals(store), out = {}; for (const t of ORIGINALS.filter((x) => !["decision", "tailoring"].includes(x))) out[t] = hashTable(o[t]); return out; };
/* Take it. Backs up what it will touch, writes the plan as a decision, applies, reads back, and says what held. Refuses before writing if the dry run says anything is lost. */
async function update(store, release, { today, migrate = [], by = "person", reason, plan: planned } = {}) {
  const plan = planned || (await planUpdate(store, release, { today, migrate }));
  if (plan.originals_touched.length) throw fail("touches_originals", `This update would change ${plan.originals_touched.join(", ")}. Nothing was changed.`, { plan });
  if (plan.unbound_decisions.length) throw fail("unbinds", `${plan.unbound_decisions.length} decisions would lose their line. Nothing was changed.`, { plan });
  const bad = plan.x.filter((x) => !x.keeps_sum || x.rows !== x.migrated);
  if (bad.length) throw fail("loses_rows", `${bad[0].from} would not carry across whole. Nothing was changed.`, { plan });
  const before = await originalsHash(store), periods = latest("period", await store.tables.read("period")), m = await store.manifest();
  // The backup is every row this update could reach, as bytes, kept by hash where the store holds bytes.
  const backup = {}; for (const t of [...Object.keys(m.x_tables || {}), "tailoring"]) backup[t] = await store.tables.read(t);
  const bytes = new TextEncoder().encode(stableStringify(backup)), sha = sha256(bytes);
  if (store.blobs) { try { await store.blobs.put(sha, bytes, { name: `backup-${release.release_id}.json`, mime: "application/json" }); } catch (e) { if (e.code !== "missing_grant") throw e; } }
  const planRow = { decision_id: `update-${release.release_id}`, target_type: "source", target_ref: `update:${release.release_id}`, verb: "note", by, at: stamp(today), status: "proposed", reason: reason || plan.summary, value: { backup: sha, summary: plan.summary, x: plan.x, originals: before } };
  await store.tables.appendNew("decision", [planRow]);
  for (const ext of (release.extensions || []).map((id) => EXTENSIONS[id])) await store.define(ext.table.name, ext.table.columns);
  const done = [];
  for (const job of migrate) {
    const ext = EXTENSIONS[job.to], rows = await store.tables.read(job.from), out = migrateRows(rows, { key: ext.table.columns[0].split(":")[0], map: job.map });
    await record(store, ext.table.name, out, { today, strict: true });
    done.push({ from: job.from, to: ext.table.name, rows: out.length });
  }
  // A family's own pieces hand over to the shared ones. The sentence goes with them, and the example is asked again in the new shape.
  for (const job of migrate) {
    const ext = EXTENSIONS[job.to], own = await tailoringRows(store);
    for (const t of own.filter((x) => x.status === "active" && (job.retire || []).includes(x.name))) await store.tables.change("tailoring", { ...t, status: "promoted" });
    const asked = own.find((t) => t.name === job.question), sentence = (asked || {}).sentence || ext.says, convert = job.example || ((v) => v);
    await tailor(store, { rung: "saved_question", name: ext.question.name, sentence, definition: ext.question.definition, example: asked && asked.example ? { as_of: asked.example.as_of, result: convert(asked.example.result) } : undefined }, { today });
    await tailor(store, { rung: "widget", name: ext.widget.name, sentence, definition: ext.widget.definition, example: asked && asked.example ? { as_of: asked.example.as_of, result: convert(asked.example.result) } : undefined }, { today });
  }
  await store.tables.change("decision", { ...planRow, status: "accepted", value: { ...planRow.value, release: release.release_id, rules_from: plan.rules_from } });
  // Read it back. All of this is checked, none of it assumed.
  const after = await originalsHash(store), built = await rebuildAt(store, { today });
  const changed = Object.keys(before).filter((t) => before[t] !== after[t]);
  const moved = periods.filter((p) => p.status === "locked" && p.seal_hash && sealOf(built.L, p) !== p.seal_hash).map((p) => p.period_id);
  const unbound = built.L.decisions.filter((d) => d.status === "accepted" && !built.L.decisionBound(d)).map((d) => d.decision_id);
  const carried = [];
  for (const job of plan.x) carried.push({ ...job, read_back: (await store.tables.read(job.to)).length });
  return { plan, applied: true, migrated: done, backup: sha, originals_changed: changed, locked_moved: moved, locked: periods.filter((p) => p.status === "locked").length, unbound, carried, tailoring: await check(store), bundle_hash: built.L.bundleHash };
}
module.exports = { planUpdate, update, migrateRows, firstOpenMonth, categoryMoves, EXTENSIONS };
