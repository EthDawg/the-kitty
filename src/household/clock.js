/* Two dates. today is the clock: what has happened yet. as_of is the evidence horizon: how far the files reach, and it never passes today.
   The engine knows neither, and takes `known_at = null` everywhere, so the clock works by what it is handed: this file reads the originals and
   filters them before rebuilding. Sources by captured_at, decisions by their time, setup by recorded_at. A row superseded after today is
   still believed today. Tax past the last day the law was read is flagged assumed. All of it outside the engine. */
"use strict";
const { rebuild } = require("../../standard/engine/rebuild");
const { allMetrics } = require("../../standard/engine/metrics");
const { fyOf, fyRange, daysBetween } = require("../../standard/engine/util");
const { base, verifiedAt } = require("./base");
const { TABS, pkOf } = require("./tabs");

const SETUP = TABS.filter((t) => ["setup", "plan"].includes(t.plane)).map((t) => t.table).concat("tailoring");
const ORIGINALS = [...SETUP, "source", "observation", "decision", "rule", "recipe", "x_delivery"];
const dayOf = (t) => (t ? String(t).slice(0, 10) : null);

async function loadOriginals(store) {
  const o = {};
  for (const t of ORIGINALS) o[t] = await store.tables.read(t);
  return o;
}
// A static table keeps its history as rows and is read latest-wins by key, because the port has no edit.
function latest(table, rows) {
  const pk = pkOf(table);
  if (!pk) return rows;
  const m = new Map();
  for (const r of rows) m.set(r[pk], r);
  return [...m.values()];
}
function knownOn(rows, today) {
  if (!today) return rows;
  const out = [];
  for (const r of rows) {
    if (r.recorded_at && dayOf(r.recorded_at) > today) continue;
    if (r.superseded_at && dayOf(r.superseded_at) > today) { const { superseded_at, ...live } = r; out.push(live); } else out.push(r);
  }
  return out;
}
// SPEC 13: default categories and the tax map are shared data, read through the household's overrides. They are never copied in.
function withDefaults(setup) {
  const d = base().defaults, have = new Set(setup.category.map((c) => c.category_id));
  const mapped = new Set(setup.tax_map.map((t) => `${t.selector_type}|${t.selector}`));
  return { ...setup,
    category: [...setup.category, ...d.categories.filter((c) => !have.has(c.category_id))],
    tax_map: [...setup.tax_map, ...d.tax_map.filter((t) => !mapped.has(`${t.selector_type}|${t.selector}`))] };
}
/* The household as it stood on today. Pure. An observation only counts once its source row is written: the source row is the commit, so
   a run cut off half way leaves rows nobody reads. */
function viewOf(o, today) {
  const setup = {};
  for (const t of SETUP) setup[t] = latest(t, knownOn(o[t], today));
  if (today) {
    setup.period = latest("period", o.period.filter((p) => !p.closed_at || dayOf(p.closed_at) <= today));
    const seen = new Set(setup.ownership.filter((w) => w.subject_type === "account").map((w) => w.subject_id));
    const dated = new Set(o.ownership.filter((w) => w.subject_type === "account").map((w) => w.subject_id));
    setup.account = setup.account.filter((a) => seen.has(a.account_id) || !dated.has(a.account_id));
  }
  const sources = latest("source", o.source).filter((s) => !today || dayOf(s.captured_at) <= today);
  const held = new Set(sources.map((s) => s.source_id));
  const observations = o.observation.filter((x) => held.has(x.source_id)).map((x) => ({ ...x }));
  const decisions = o.decision.filter((d) => !today || dayOf(d.at) <= today);
  const rules = latest("rule", knownOn(o.rule, today)).filter((r) => !r.superseded_at);   // a changed mind: the old answer is kept in the Sheet and no longer read
  const deliveries = o.x_delivery.filter((d) => !today || d.day <= today);
  const receipts = [...sources.filter((s) => s.stream_id).map((s) => ({ stream_id: s.stream_id, day: dayOf(s.captured_at) })), ...deliveries.map((d) => ({ stream_id: d.stream_id, day: d.day }))];
  const faults = sources.filter((s) => s.status === "quarantined").map((s) => ({ code: "file_refused", path: s.uri || s.name, what: String(s.note || `${s.name} failed its checks and was not imported.`).replace(/^refused: /, "") }));
  return { setup: withDefaults(setup), sources, observations, decisions, rules, receipts, faults };
}
// The same reading the engine makes when it is left to choose, so as_of means one thing everywhere.
function horizon(observations) {
  let last = null;
  for (const o of observations) for (const d of [o.payload.as_at, o.payload.posting_date, o.payload.pay_date]) if (d && (!last || d > last)) last = d;
  return last;
}
function asOfFor(today, evidence) {
  if (!today) return undefined;
  return evidence && evidence < today ? evidence : today;
}
function assumedYears(L, today) {
  const verified = verifiedAt();
  if (!verified) return [];
  const years = new Set(L.events.map((e) => fyOf(e.occurred_on)));
  if (today) years.add(fyOf(today));
  return [...years].filter((fy) => fyRange(fy).start > verified).sort();
}
/* Two things the engine gets wrong today, put right from outside it until findings R-011 and R-012 land. Each is read off a first rebuild and held in memory for a second one, so
   nothing is stored, a later file changes the answer by itself, and a household with neither, the Davies world among them, takes exactly one rebuild and keeps its hash. */
const REFUND_WORDS = /REFUND|REVERSAL|CHARGEBACK|RETURN/i;
const payeeOf = (l) => String(l.cls.merchant || l.desc).toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean).slice(0, 2).join(" ");
// R-012. Money in that a public dictionary filed under an expense, with nothing from the household behind it, goes to review. A payer who repeats is never a refund.
function creditsToAsk(L) {
  const guessed = L.events.filter((e) => e.kind === "refund" && e.rule === "dictionary" && e.line).map((e) => e.line);
  if (!guessed.length) return [];
  const times = new Map();
  for (const l of guessed) times.set(l.cls.norm, (times.get(l.cls.norm) || 0) + 1);
  const paid = (l) => (L.lines || []).filter((x) => x.cents < 0 && x.date <= l.date && payeeOf(x) === payeeOf(l) && daysBetween(x.date, l.date) <= 365).reduce((n, x) => n - x.cents, 0);
  const evidence = (l) => times.get(l.cls.norm) === 1 && (REFUND_WORDS.test(l.desc) || paid(l) >= l.cents);
  return [...new Set(guessed.filter((l) => !evidence(l)).map((l) => l.cls.norm))].map((norm) => ({ rule_id: `ask-${norm}`, pattern: norm, match: "normalised", direction: "credit", provenance: "asked of a person", status: "accepted" }));
}
// R-011. An opening states where an account stood on its day, so lines from before that day are already in it. The opening moves back to the first line, and takes them out.
function openingsToMove(L) {
  const out = new Map();
  for (const e of L.events) {
    if (e.kind !== "opening_balance" || e.rule !== "first_evidence") continue;
    const earlier = (L.linesByAccount.get(e.refs.account) || []).filter((l) => l.date <= e.occurred_on);
    if (earlier.length) out.set(e.refs.account, { opening_balance_cents: e.amount_cents - earlier.reduce((n, l) => n + l.cents, 0), opening_date: earlier.map((l) => l.date).sort()[0] });
  }
  return out;
}
async function rebuildAt(store, { today, originals } = {}) {
  const o = originals || (await loadOriginals(store)), b = base();
  let view = viewOf(o, today);
  const evidence = horizon(view.observations), asOf = asOfFor(today, evidence);
  const read = (setup, rules) => rebuild({ setup, sources: view.sources, observations: view.observations, decisions: view.decisions, rules, schema: { events: b.schema.events }, reference: b.reference, receipts: view.receipts, faults: view.faults, asOf });
  let L = read(view.setup, view.rules);
  const asked = creditsToAsk(L), moved = openingsToMove(L);
  if (asked.length || moved.size) {
    view = viewOf(o, today);   // rebuild writes on what it is handed. Finding R-008.
    L = read({ ...view.setup, account: view.setup.account.map((a) => (moved.has(a.account_id) ? { ...a, ...moved.get(a.account_id) } : a)) }, [...view.rules, ...asked]);
  }
  // Metrics need a month to read. A household with nothing in it yet has none, and that is a state, not an error. Finding R-001.
  if (L.balances.months.length) L.metrics = allMetrics(L, b.schema.metrics);
  const assumed = assumedYears(L, today);
  for (const e of (L.tax && L.tax.estimates) || []) if (assumed.includes(e.fy)) e.assumed = true;
  const clock = { today: today || null, as_of: evidence ? L.asOf : null, tax_verified_at: verifiedAt() || null, tax_assumed_years: assumed };
  L.clock = clock;
  return { L, clock, originals: o, view };
}
module.exports = { rebuildAt, loadOriginals, viewOf, latest, horizon, dayOf, ORIGINALS };
