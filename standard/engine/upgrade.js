/* Keep it, tailor it, update it. An update is a dry-run rebuild plus a metric diff. Originals are never touched, a locked period is
   never moved, and a hand edit in a managed tab becomes a proposed decision. SPEC section 13. Pure: the host does the writing. */
"use strict";
const { hash64, stableStringify, cmp, monthOf } = require("./util");
const { sealOf } = require("./laws");

const hashTable = (rows) => hash64(rows.map((r) => stableStringify(r)).join("\n"));

function metricMap(L) {
  const m = new Map();
  for (const r of L.netWorth) m.set(`position.net_worth|${r.month}`, r.total);
  for (const r of L.cash) { m.set(`cash.income|${r.month}`, r.income); m.set(`cash.spending|${r.month}`, r.spending); }
  for (const r of L.accrual) { m.set(`economic.income|${r.month}`, r.income); m.set(`economic.expense|${r.month}`, r.expense); }
  return m;
}

/* before and after are rebuilds of the same Originals under two engine or shared-data versions.
   originals: { before: {table: rows}, after: {table: rows} } when the update ran a migration. */
function planUpdate({ before, after, originals, periods = [] }) {
  const a = metricMap(before), b = metricMap(after);
  const moved = [];
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(k) ?? 0, y = b.get(k) ?? 0;
    if (x !== y) { const [metric, month] = k.split("|"); moved.push({ metric, month, before: x, after: y, change: y - x }); }
  }
  const locked = periods.filter((p) => p.status === "locked" && p.seal_hash);
  const conflicts = [];
  for (const p of locked) {
    const now = sealOf(after, p);
    if (now !== p.seal_hash) conflicts.push(p);
  }
  const inLocked = (month) => conflicts.find((p) => month >= monthOf(p.start_on) && month <= monthOf(p.end_on));
  const proposals = conflicts.map((p) => ({ kind: "reopen", period: p.period_id, amount_cents: moved.filter((m) => inLocked(m.month) === p && m.metric === "cash.spending").reduce((s, m) => s + m.change, 0), what: `New logic would change the locked period ${p.period_id}. It stays as it is. Reopen it to take the change.` }));
  const applied = moved.filter((m) => !inLocked(m.month));
  const originalsTouched = [];
  if (originals) for (const t of Object.keys(originals.before)) {
    if (t.startsWith("x_") || hashTable(originals.before[t]) !== hashTable(originals.after[t] || [])) {
      if (hashTable(originals.before[t]) !== hashTable(originals.after[t] || [])) originalsTouched.push(t);
    }
  }
  const unbound = (after.decisions || []).filter((d) => d.status === "accepted" && !after.decisionBound(d)).map((d) => d.decision_id);
  return { moved: applied.sort((x, y) => cmp(x.month, y.month) || cmp(x.metric, y.metric)), proposals, originals_touched: originalsTouched, unbound_decisions: unbound,
    summary: `${originalsTouched.length ? `${originalsTouched.length} tables you own changed` : "Nothing you entered changes"}. ${applied.length} numbers move. ${proposals.length ? `${proposals.length} locked periods stay as they are, with a reopen proposal` : "Locked years stay as they are"}.` };
}

// Anything that writes a managed tab first compares what it finds with the hash it stored. A difference is a person typing.
function managedTabCheck({ table, stored_hash, rows, key }) {
  const now = hashTable(rows);
  if (now === stored_hash) return { ok: true, proposals: [] };
  return { ok: false, proposals: [{ decision_id: `edit_${hash64(`${table}|${now}`)}`, target_type: "source", target_ref: `${table}`, verb: "note", value: { key }, by: "sheet", status: "proposed", reason: `The ${table} tab was edited by hand. What did you mean?` }] };
}

// A tailoring row's example runs on every update. If it fails, an agent rewrites it from the person's sentence.
function checkTailoring(tailoring, evaluate) {
  return tailoring.filter((t) => t.status === "active").map((t) => {
    if (!t.example) return { name: t.name, status: "no_example" };
    const got = evaluate(t);
    const pass = stableStringify(got) === stableStringify(t.example.result);
    return { name: t.name, status: pass ? "pass" : "rewrite", sentence: t.sentence, got };
  });
}
module.exports = { planUpdate, managedTabCheck, checkTailoring, hashTable };
