/* A person's answer, in the form the standard already has. A decision on a line binds to its content and survives every rebuild; "always" also
   writes a rule with no start date, so one answer covers every line like it, in this file and in any file added later, older ones included. A locked month
   keeps what it said: each of its lines that would change gets a decision of its own first. Saying the same thing twice writes nothing. An answer
   about what a household has is a scope row. A balance read off a banking app is evidence, and a person is its source. */
"use strict";
const Engine = require("../engine.js");
const S = require("../../standard/engine/schema");
const { hash64, stableStringify, monthEnd, monthOf } = require("../../standard/engine/util");
const { sha256 } = require("../../standard/intake/sha256");
const { rebuildAt, latest } = require("./clock");
const { columnsOf } = require("./tabs");
const { normalise } = require("./codec");
const { ready, stamp, fail, slug, SINCE } = require("./init");
const { ownershipRows } = require("./add");

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
    const [account] = ref.split("|"), line = (L.linesByAccount.get(account) || []).find((l) => l.key === ref);
    const pattern = Engine.normalise(line ? line.desc : (item && item.question) || "") || (item && item.question);
    // A rule learned from money going out says nothing about money coming back: a refund from the same shop is not a purchase.
    const direction = Number(ref.split("|")[2]) < 0 ? "debit" : "credit";
    if (pattern) await remember(store, { L, view, pattern, direction, category_id: d.category_id, merchant: d.merchant }, today, by);
  }
  return out;
}
async function remember(store, { L, view, pattern, direction, category_id, merchant }, today, by) {
  const locked = new Set(view.setup.period.filter((p) => p.status === "locked").map((p) => p.period_id)), rule_id = idOf("R", pattern, category_id, direction);
  const like = (l) => (l.cents < 0) === (direction === "debit") && Engine.normalise(l.desc) === pattern;
  for (const l of L.lines || []) {
    if (!locked.has(monthOf(l.date)) || !like(l) || !l.cls.category_id || l.cls.category_id === category_id) continue;
    const value = { category_id: l.cls.category_id };
    await writeDecision(store, { decision_id: idOf("D", l.key, "categorise", value), target_type: "line", target_ref: l.key, verb: "categorise", value, by, at: stamp(today), status: "accepted", reason: "A locked month stays as it was." });
  }
  // A changed mind: the last answer for these words stops being read, and is kept.
  const rows = await store.tables.read("rule"), said = latest("rule", rows).filter((r) => r.pattern === pattern && r.direction === direction);
  for (const r of said) if (r.rule_id !== rule_id && !r.superseded_at) await store.tables.change("rule", { ...r, superseded_at: stamp(today) });
  const back = said.find((r) => r.rule_id === rule_id && r.superseded_at);
  if (back) { const { superseded_at, ...live } = back; await store.tables.change("rule", live); return; }
  await store.tables.appendNew("rule", [check("rule", { rule_id, pattern, match: "normalised", merchant, category_id, direction, provenance: `decided by ${by}`, status: "accepted", recorded_at: stamp(today) })]);
}
async function scope(store, d, today, by) {
  const m = await store.manifest();
  const row = check("scope", { subject_type: d.subject_type || "household", subject_id: d.subject_id || m.household_id, domain: d.domain, state: d.state, by, valid_from: d.valid_from || today, note: d.note, recorded_at: stamp(today) });
  return { added: (await store.tables.appendNew("scope", [row])) > 0, scope: row };
}
async function balance(store, d, today, by) {
  // A person types what they owe as a plain number. On a card or a debt it is money owed.
  const owed = latest("account", await store.tables.read("account")).some((a) => a.account_id === d.account_id && a.class === "liability"), cents = owed ? -Math.abs(d.cents) : d.cents;
  const obs = { account_ref: d.account_id, as_at: d.as_at, balance_cents: cents, balance_kind: "ledger" };
  const text = new TextEncoder().encode(stableStringify({ by, ...obs })), sha = sha256(text), source_id = `src-${sha.slice(0, 16)}`;
  const source = check("source", { source_id, sha256: sha, name: `Balance ${d.account_id} ${d.as_at}`, origin: "manual", mime: "application/json", bytes: text.length, stream_id: d.account_id, issued_on: d.as_at, captured_at: stamp(today), status: "active", note: `Said by ${by}.`, uri: `not-held:${d.account_id}` });
  await store.tables.appendNew("observation", [check("observation", { obs_id: `obs-${sha.slice(0, 20)}`, source_id, locator: "said by a person", kind: "balance", occurred_on: d.as_at, amount_cents: cents, currency: "AUD", subject_ref: d.account_id, payload: obs, importer: "person", confidence: "0.9", quote: d.quote || `${by} read it from their banking app.`, status: "active" })]);
  return { added: (await store.tables.appendNew("source", [source])) > 0, source_id };
}
/* Something with no file: a HELP debt, super, a car loan. An account the page carries at the value a person gives, dated, with that person as its source. Typing again with
   the account_id gives it a newer value. It is the Standard's own shape: an account of fidelity snapshot, a stated balance, and a scope row saying the household has it. */
const HELD = {
  help_debt: { name: "HELP debt", class: "liability", type: "help_debt", reporting_group: "loans", domain: "help_debt" },
  super: { name: "Super", class: "asset", type: "super", reporting_group: "super", domain: "super" },
  car_loan: { name: "Car loan", class: "liability", type: "loan", reporting_group: "loans", domain: "car_loan" },
  home_loan: { name: "Home loan", class: "liability", type: "loan", reporting_group: "loans", domain: "home_loan" },
  other_debt: { name: "Other debt", class: "liability", type: "loan", reporting_group: "loans", domain: "other_debt" },
  other_asset: { name: "Other savings", class: "asset", type: "savings", reporting_group: "cash", domain: "other_asset" },
};
async function statedBalance(store, d, today, by) {
  const accounts = latest("account", await store.tables.read("account"));
  let row = accounts.find((a) => a.account_id === d.account_id);
  if (!row) {
    const kind = HELD[d.kind];
    if (!kind) throw fail("bad_kind", `There is no kind of record called ${d.kind}.`);
    const { name: fallback, domain, ...shape } = kind, name = String(d.name || "").trim() || fallback;
    let account_id = `HAND-${slug(name)}`;
    for (let n = 2; accounts.some((a) => a.account_id === account_id); n += 1) account_id = `HAND-${slug(name)}-${n}`;
    row = { account_id, name, ...shape, currency: "AUD", in_scope: true, fidelity: "snapshot", note: "Typed in by a person. No statement behind it." };
    const adults = [...new Set((await store.tables.read("membership")).filter((m) => m.role === "adult").map((m) => m.party_id))].sort();
    await store.tables.appendNew("account", [check("account", row)]);
    await store.tables.appendNew("ownership", ownershipRows(account_id, adults, today));
    await scope(store, { domain, state: "has" }, today, by);
  }
  const signed = row.class === "liability" ? -Math.abs(d.cents) : d.cents;
  await balance(store, { account_id: row.account_id, as_at: d.as_at, cents: signed, quote: `${by} typed this in.` }, today, by);
  return { added: true, account_id: row.account_id };
}
// A number a file gave us for an account we couldn't place. An alias, so every file with it lands there. "None of these" is a scope row, and nothing asks again.
async function attach(store, d, today, by) {
  if (!d.account_id) return scope(store, { domain: `account:${d.ref}`, state: "none" }, today, by);
  await store.tables.appendNew("alias", [check("alias", { subject_type: "account", subject_id: d.account_id, scheme: "account_number", value: d.ref, valid_from: SINCE, recorded_at: stamp(today) })]);
  return { added: true };
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
  if (d.stated) return statedBalance(store, d.stated, today, by);
  if (d.attach) return attach(store, d.attach, today, by);
  if (d.reopen) return reopen(store, { month: d.reopen, reason: d.reason, reopen_if: d.reopen_if }, today, by);
  if (d.hand_edit) return handEdit(store, { ...d.hand_edit, reason: d.reason }, today, by);
  if (d.check) return accept(store, d, today, by);
  if (d.item && d.category_id) return categorise(store, d, today, by);
  if (d.verb && d.target_ref) return writeDecision(store, { decision_id: idOf("D", d.target_ref, d.verb, d.value), target_type: d.target_type || "line", target_ref: d.target_ref, verb: d.verb, value: d.value || {}, by, at: stamp(today), status: "accepted", reason: d.reason, reopen_if: d.reopen_if });
  throw fail("bad_decision", "A decision names a review item and a category, a scope, a balance, a month to reopen, a check to accept, or a verb and its target.");
}
module.exports = { decide };
