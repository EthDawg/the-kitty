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
  for (const e of (L.tax && L.tax.estimates) || []) {
    m.set(`tax.estimate.taxable_income|${e.fy}|${e.person}`, e.taxable_income_cents);
    if (e.result_cents != null) m.set(`tax.estimate.result|${e.fy}|${e.person}`, e.result_cents);
  }
  return m;
}

// What a reopen would touch. A new category moves no total, so totals alone would call it nothing. An event read differently gets a
// new id, so rows are compared by what they say, and the larger side is the money touched: one event replaced counts once.
function touchedCents(before, after, p) {
  const rows = (L) => L.events.filter((e) => e.occurred_on >= p.start_on && e.occurred_on <= p.end_on);
  const key = (e) => `${e.kind}|${e.amount_cents}|${e.category_id}`;
  const left = new Map();
  for (const e of rows(before)) left.set(key(e), (left.get(key(e)) || 0) + 1);
  let added = 0, removed = 0;
  for (const e of rows(after)) { const n = left.get(key(e)) || 0; if (n) left.set(key(e), n - 1); else added += Math.abs(e.amount_cents || 0); }
  for (const [k, n] of left) removed += n * Math.abs(Number(k.split("|")[1]) || 0);
  return Math.max(added, removed);
}

/* before and after are rebuilds of the same Originals under two engine or shared-data versions.
   originals: { before: {table: rows}, after: {table: rows} } when the update ran a migration. */
function planUpdate({ before, after, originals, periods = [] }) {
  const a = metricMap(before), b = metricMap(after);
  const moved = [];
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(k) ?? 0, y = b.get(k) ?? 0;
    if (x !== y) { const [metric, at, person] = k.split("|"); moved.push({ metric, ...(person ? { fy: at, person } : { month: at }), before: x, after: y, change: y - x }); }
  }
  const locked = periods.filter((p) => p.status === "locked" && p.seal_hash);
  const conflicts = [];
  for (const p of locked) {
    const now = sealOf(after, p);
    if (now !== p.seal_hash) conflicts.push(p);
  }
  const inLocked = (month) => conflicts.find((p) => month >= monthOf(p.start_on) && month <= monthOf(p.end_on));
  const proposals = conflicts.map((p) => ({ kind: "reopen", period: p.period_id, amount_cents: touchedCents(before, after, p), changes: moved.filter((m) => inLocked(m.month) === p), what: `New logic would change the locked period ${p.period_id}. It stays as it is. Reopen it to take the change.` }));
  // A lodged return is history. An update can find someone money; it cannot rewrite the year, so the difference is reported and goes no further.
  const lodged = (m) => m.fy && ((after.tax && after.tax.ties) || []).some((t) => t.person === m.person && t.fy === m.fy);
  const findings = moved.filter(lodged).map((m) => ({ kind: "lodged_year", fy: m.fy, person: m.person, metric: m.metric, amount_cents: m.change, what: `${m.fy} stays as lodged. New logic reads it differently by this amount.` }));
  const applied = moved.filter((m) => !inLocked(m.month) && !lodged(m));
  const originalsTouched = [];
  if (originals) for (const t of Object.keys(originals.before)) {
    if (t.startsWith("x_") || hashTable(originals.before[t]) !== hashTable(originals.after[t] || [])) {
      if (hashTable(originals.before[t]) !== hashTable(originals.after[t] || [])) originalsTouched.push(t);
    }
  }
  const unbound = (after.decisions || []).filter((d) => d.status === "accepted" && !after.decisionBound(d)).map((d) => d.decision_id);
  return { moved: applied.sort((x, y) => cmp(x.month || x.fy, y.month || y.fy) || cmp(x.metric, y.metric) || cmp(x.person || "", y.person || "")), proposals, findings, originals_touched: originalsTouched, unbound_decisions: unbound,
    summary: `${originalsTouched.length ? `${originalsTouched.length} tables you own changed` : "Nothing you entered changes"}. ${applied.length} numbers move. ${proposals.length ? `${proposals.length} locked periods stay as they are, with a reopen proposal` : "Locked years stay as they are"}.${findings.length ? ` ${findings.length} numbers read differently on lodged returns, which stay as lodged.` : ""}` };
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
