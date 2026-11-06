/* Close a month. Everything derived is written to the managed tabs, the seal goes on, and the month stays as it is. A close is earned: it is
   refused while the month is still running, while a file stops short of its end, or while an account in it has no stated balance. A hand edit in a
   managed tab stops the write before anything is touched, and becomes a proposed decision. A month with something provisional in it closes but does
   not lock, unless the household has said it has no payslips to come. Close it again later and it locks. */
"use strict";
const { toBundle } = require("../../standard/engine/bundle");
const { seal } = require("../../standard/engine/close");
const { sealOf } = require("../../standard/engine/laws");
const { rebuildAt } = require("./clock");
const { readiness } = require("./status");
const { base } = require("./base");
const { MANAGED, tabOf, STANDARD_VERSION, RUNTIME_VERSION } = require("./tabs");
const { normalise } = require("./codec");
const { ready, stamp, fail } = require("./init");
const { monthYear, plural, list } = require("./words");

function refusal(m, L, month) {
  const name = (id) => (L.index.accounts.get(id) || {}).name || id;
  if (!m) return `There are no lines in ${monthYear(month)} to close.`;
  if (!m.ended) return `${monthYear(month)} is not over yet.`;
  if (m.short.length) return `The file for ${list(m.short.map(name))} stops before the end of ${monthYear(month)}.`;
  if (!m.confirmed) return `${list(m.unconfirmed.map(name))} ${m.unconfirmed.length === 1 ? "has" : "have"} no stated balance in ${monthYear(month)}.`;
  const broken = L.checks.filter((c) => c.law === "L3" && c.status === "fail" && m.touched.includes(c.scope)).map((c) => c.scope);
  if (broken.length) return `The balances for ${list(broken.map(name))} do not add up, so ${monthYear(month)} can't close.`;
  return null;
}
function rowsOf(bundle, table) { return bundle.tables[table].split("\n").filter(Boolean).map((l) => normalise(table, JSON.parse(l))); }

async function close(store, month, { today } = {}) {
  if (!today) throw fail("no_today", "close needs today.");
  if (!/^\d{4}-\d{2}$/.test(String(month))) throw fail("bad_month", "A month reads 2026-07.");
  await ready(store);
  const built = await rebuildAt(store, { today }), { L, view } = built, facts = readiness(built);
  const m = facts.months.find((x) => x.month === month), held = view.setup.period.find((p) => p.period_id === month);
  if (held && held.status === "locked" && held.seal_hash === sealOf(L, held)) return { status: "already", month, seal_hash: held.seal_hash, say: `${monthYear(month)} is already locked.` };
  const why = refusal(m, L, month);
  if (why) return { status: "refused", month, say: why };

  const [sealed] = seal(L, [month]);
  const row = { ...sealed, status: m.can_lock ? "locked" : "closed", closed_at: stamp(today) };
  const bundle = toBundle(L, { setup: view.setup, tablesSchema: base().tablesDoc, decisions: view.decisions, rules: view.rules, recipes: [], version: STANDARD_VERSION, mode: "close" });
  const rows = Object.fromEntries(MANAGED.filter((t) => bundle.tables[t] !== undefined).map((t) => [t, rowsOf(bundle, t)]));
  const accepted = new Set(view.decisions.filter((d) => d.status === "accepted" && d.target_type === "source").map((d) => `${d.target_ref}|${(d.value || {}).found_hash}`));
  let written;
  try { written = await store.tables.replaceManaged(rows, { bundle_hash: L.bundleHash, as_of: L.asOf, written_at: stamp(today), runtime: RUNTIME_VERSION }, { accepted }); }
  catch (e) {
    if (e.code !== "hand_edit") throw e;
    await store.tables.appendNew("decision", e.edits.flatMap((x) => x.proposals.map((p) => ({ ...p, value: { ...p.value, found_hash: x.found_hash }, at: stamp(today) }))));
    return { status: "stopped", month, edits: e.edits.map(({ proposals, ...x }) => x), say: `Someone typed in ${list(e.edits.map((x) => `the ${x.tab} tab`))}. Nothing was written. Say what was meant, then close again.` };
  }
  await store.tables.change("period", row);
  await store.tables.countOriginals({ ...built.originals, period: [...built.originals.period, row] });
  const left = [m.waiting ? "lines still need an answer" : null, m.provisional && !m.can_lock ? "a pay is waiting on its payslip" : null].filter(Boolean);
  return { status: row.status, month, seal_hash: row.seal_hash, written, say: m.can_lock ? `${monthYear(month)} is locked.` : `${monthYear(month)} is closed but not locked: ${list(left)}. Close it again once ${left.length === 1 ? "that is done" : "those are done"}.`, rows_written: Object.values(written).reduce((a, b) => a + b, 0), tabs_written: plural(Object.keys(written).length, "tab") };
}
module.exports = { close };
