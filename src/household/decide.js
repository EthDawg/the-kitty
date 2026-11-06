/* A person's answer, in the form the standard already has. A decision on a line binds to its content and survives every rebuild; "always" also
   writes a rule, from that line on, so a rule learned today does not rewrite history. Saying the same thing twice writes nothing. An answer
   about what a household has is a scope row. A balance read off a banking app is evidence, and a person is its source. */
"use strict";
const Engine = require("../engine.js");
const S = require("../../standard/engine/schema");
const { hash64, stableStringify, monthEnd } = require("../../standard/engine/util");
const { sha256 } = require("../../standard/intake/sha256");
const { rebuildAt } = require("./clock");
const { columnsOf } = require("./tabs");
const { normalise } = require("./codec");
const { ready, stamp, fail } = require("./init");

const idOf = (prefix, ...parts) => `${prefix}-${hash64(stableStringify(parts))}`;
const check = (table, row) => {
  const clean = normalise(table, row), errs = S.validateRow({ name: table, columns: columnsOf(table) }, clean);
  if (errs.length) throw fail("bad_row", errs.join("; "), { errors: errs });
  return clean;
};
async function writeDecision(store, row) {
  const clean = check("decision", row);
  const added = await store.tables.appendNew("decision", [clean]);
  return { decision_id: clean.decision_id, added: added > 0 };
}
async function categorise(store, d, today, by) {
  const { L, view } = await rebuildAt(store, { today });
  const item = L.review.find((r) => r.item_id === d.item || r.ref === d.item);
  const ref = item ? item.ref : d.item;
  if (!view.setup.category.some((c) => c.category_id === d.category_id)) throw fail("no_category", `There is no category called ${d.category_id}.`);
  const value = { category_id: d.category_id, ...(d.merchant ? { merchant: d.merchant } : {}), ...(d.person ? { person: d.person } : {}) };
  const out = await writeDecision(store, { decision_id: idOf("D", ref, "categorise", value), target_type: "line", target_ref: ref, verb: "categorise", value, by, at: stamp(today), status: "accepted", reason: d.reason });
  if (d.always) {
    const [account, date] = ref.split("|"), line = (L.linesByAccount.get(account) || []).find((l) => l.key === ref);
    const pattern = Engine.normalise(line ? line.desc : (item && item.question) || "") || (item && item.question);
    if (pattern) await store.tables.appendNew("rule", [check("rule", { rule_id: idOf("R", pattern, d.category_id), pattern, match: "normalised", merchant: d.merchant, category_id: d.category_id, valid_from: date, provenance: `decided by ${by}`, status: "accepted", recorded_at: stamp(today) })]);
  }
  return out;
}
async function scope(store, d, today, by) {
  const m = await store.manifest();
  const row = check("scope", { subject_type: d.subject_type || "household", subject_id: d.subject_id || m.household_id, domain: d.domain, state: d.state, by, valid_from: d.valid_from || today, note: d.note, recorded_at: stamp(today) });
  return { added: (await store.tables.appendNew("scope", [row])) > 0, scope: row };
}
async function balance(store, d, today, by) {
  const obs = { account_ref: d.account_id, as_at: d.as_at, balance_cents: d.cents, balance_kind: "ledger" };
  const text = new TextEncoder().encode(stableStringify({ by, ...obs })), sha = sha256(text), source_id = `src-${sha.slice(0, 16)}`;
  const source = check("source", { source_id, sha256: sha, name: `Balance ${d.account_id} ${d.as_at}`, origin: "manual", mime: "application/json", bytes: text.length, stream_id: d.account_id, issued_on: d.as_at, captured_at: stamp(today), status: "active", note: `Said by ${by}.`, uri: `not-held:${d.account_id}` });
  await store.tables.appendNew("observation", [check("observation", { obs_id: `obs-${sha.slice(0, 20)}`, source_id, locator: "said by a person", kind: "balance", occurred_on: d.as_at, amount_cents: d.cents, currency: "AUD", subject_ref: d.account_id, payload: obs, importer: "person", confidence: "0.9", quote: d.quote || `${by} read it from their banking app.`, status: "active" })]);
  return { added: (await store.tables.appendNew("source", [source])) > 0, source_id };
}
async function reopen(store, d, today, by) {
  if (!d.reason) throw fail("no_reason", "Reopening a locked month needs a reason.");
  const out = await writeDecision(store, { decision_id: idOf("D", d.month, "reopen", today), target_type: "period", target_ref: d.month, verb: "reopen", value: { month: d.month }, by, at: stamp(today), status: "accepted", reason: d.reason, reopen_if: d.reopen_if });
  await store.tables.change("period", { period_id: d.month, kind: "month", start_on: `${d.month}-01`, end_on: monthEnd(d.month), status: "open" });
  return out;
}
async function accept(store, d, today, by) {
  if (!d.reason) throw fail("no_reason", "Accepting a check needs a reason, and what would reopen it.");
  return writeDecision(store, { decision_id: idOf("D", d.check, "accept"), target_type: "check", target_ref: d.check, verb: "accept", value: { check: d.check }, by, at: stamp(today), status: "accepted", reason: d.reason, reopen_if: d.reopen_if });
}
// A hand edit a person has looked at. The next close takes the tab back, and this row says they knew.
async function handEdit(store, d, today, by) {
  const found = (await store.tables.handEdits([d.table]))[0];
  if (!found) return { added: false, nothing: true };
  return writeDecision(store, { decision_id: idOf("edit-ok", d.table, found.found_hash), target_type: "source", target_ref: d.table, verb: "note", value: { found_hash: found.found_hash }, by, at: stamp(today), status: "accepted", reason: d.reason || "Looked at it. Rebuild the tab." });
}
async function decide(store, d, { today } = {}) {
  if (!today) throw fail("no_today", "decide needs today.");
  await ready(store);
  const by = d.by || "person";
  if (d.scope) return scope(store, d.scope, today, by);
  if (d.balance) return balance(store, d.balance, today, by);
  if (d.reopen) return reopen(store, { month: d.reopen, reason: d.reason, reopen_if: d.reopen_if }, today, by);
  if (d.hand_edit) return handEdit(store, { ...d.hand_edit, reason: d.reason }, today, by);
  if (d.check) return accept(store, d, today, by);
  if (d.item && d.category_id) return categorise(store, d, today, by);
  if (d.verb && d.target_ref) return writeDecision(store, { decision_id: idOf("D", d.target_ref, d.verb, d.value), target_type: d.target_type || "line", target_ref: d.target_ref, verb: d.verb, value: d.value || {}, by, at: stamp(today), status: "accepted", reason: d.reason, reopen_if: d.reopen_if });
  throw fail("bad_decision", "A decision names a review item and a category, a scope, a balance, a month to reopen, a check to accept, or a verb and its target.");
}
module.exports = { decide };
