/* One call: originals in, everything derived out. Same inputs, same bytes. */
"use strict";
const { byKey, groupBy, cmp, monthOf, monthEnd, addDays, parseUnits, stableStringify, hash64 } = require("./util");
const { indexTerms } = require("./temporal");
const { Resolver } = require("./resolve");
const { post, proveTemplates } = require("./post");
const V = require("./views");
const { runLaws } = require("./laws");
const Tax = require("./tax");
const { allMetrics } = require("./metrics");

const AUTO_ACCOUNT = [
  [/^clearing:/, { class: "clearing", type: "clearing", reporting_group: "clearing" }],
  [/^ato:/, { class: "asset", type: "tax_position", reporting_group: "tax" }],
  [/^equity:/, { class: "equity", type: "equity", reporting_group: "equity" }],
  [/^memo:/, { class: "memo", type: "memo", reporting_group: "memo" }],
  [/^receivable:/, { class: "asset", type: "receivable", reporting_group: "clearing" }],
];

function rebuild(input) {
  const { setup, sources, observations, decisions = [], rules, schema, reference, asOf, extensions } = input;
  const eventSchema = withExtensions(schema.events, extensions);
  const R = new Resolver({ setup, sources, observations, decisions, rules, eventSchema });
  R.run();

  R.events.sort((a, b) => cmp(a.occurred_on, b.occurred_on) || cmp(a.event_id, b.event_id));
  const dupes = [...groupBy(R.events, (e) => e.event_id).entries()].filter(([, v]) => v.length > 1);
  if (dupes.length) throw new Error(`duplicate event keys: ${dupes.slice(0, 3).map(([, v]) => v[0].key).join("; ")}`);

  const postings = [], witnesses = [];
  for (const e of R.events) {
    if (!e.postings) e.postings = post(e, eventSchema);
    for (const p of e.postings) postings.push({ ...p, event_id: e.event_id });
    for (const w of e.witnesses) witnesses.push({ event_id: e.event_id, obs_id: w.obs_id, role: w.role, amount_cents: w.amount_cents ?? null });
  }

  const known = new Set((setup.account || []).map((a) => a.account_id));
  const auto = [];
  for (const p of postings) {
    if (!p.account_id || known.has(p.account_id)) continue;
    known.add(p.account_id);
    const spec = AUTO_ACCOUNT.find(([re]) => re.test(p.account_id));
    if (!spec) throw new Error(`posting to unknown account ${p.account_id}`);
    auto.push({ account_id: p.account_id, name: p.account_id, currency: "AUD", ...spec[1] });
  }

  const L = {
    asOf: asOf || latestDate(R),
    accounts: [...(setup.account || []), ...auto],
    categories: setup.category || [], parties: setup.party || [], contracts: setup.contract || [], assets: setup.asset || [], ownership: setup.ownership || [],
    households: setup.household || [], memberships: setup.membership || [], links: setup.link || [], streams: setup.stream || [], periods: setup.period || [], budgets: setup.budget || [], activities: setup.activity || [],
    sources: sources || [], observations: R.obs, decisions, events: R.events, postings, witnesses, terms: R.terms, termIdx: indexTerms(R.terms), lines: R.lines, linesByAccount: R.linesByAccount,
  };
  L.index = V.ledgerIndex(L);
  L.balances = V.balances(L);
  L.cash = V.cashLens(L);
  L.accrual = V.accrualLens(L);
  L.netWorth = V.netWorth(L);
  L.activityNet = V.activityNet(L);
  L.receipts = input.receipts || null;
  L.coverage = V.coverage(L);
  L.refresh = V.refreshPlan(L);
  L.lotRows = [...(R.lots ? R.lots.lots : []), ...(R.propertyLots ? R.propertyLots.lots : [])];
  L.lotMatches = [...(R.lots ? R.lots.matches : []), ...(R.propertyLots ? R.propertyLots.matches : [])];

  // Stated balances: every claim a source makes about where an account stood.
  const stated = [];
  // A file may run newest first, so which line closes a day is not known from order. The day's close is one of its stated balances.
  for (const [, rows] of groupBy(R.lines.filter((l) => l.balanceAfter != null), (l) => `${l.account}|${l.date}`)) {
    stated.push({ account: rows[0].account, date: rows[0].date, cents: rows[rows.length - 1].balanceAfter, any: rows.map((r) => r.balanceAfter) });
  }
  L.stated = stated;
  for (const o of R.obs) {
    const p = o.payload;
    if (o.kind === "statement") { const a = R.accountOf(o, p.account_ref, p.period_end); if (a) L.stated.push({ account: a, date: p.period_end, cents: p.closing_cents }); }
    if (o.kind === "loan_statement") { const a = R.accountOf(o, p.account_ref, p.period_end); if (a) L.stated.push({ account: a, date: p.period_end, cents: -p.closing_cents }); }
    if (o.kind === "super_statement") { const a = R.accountOf(o, p.account_ref, p.period_end); if (a) L.stated.push({ account: a, date: p.period_end, cents: p.closing_cents }); }
    if (o.kind === "balance" && (!p.balance_kind || p.balance_kind === "ledger")) { const a = R.accountOf(o, p.account_ref, p.as_at); if (a) L.stated.push({ account: a, date: p.as_at, cents: p.balance_cents }); }
  }
  const dailyCache = new Map();
  L.dailyBalance = (account) => {
    if (dailyCache.has(account)) return dailyCache.get(account);
    const flows = postings.filter((p) => p.account_id === account).map((p) => ({ d: V.balanceDate(L.index.events.get(p.event_id), account), c: p.amount_cents })).sort((a, b) => cmp(a.d, b.d));
    const days = []; let run = 0;
    for (const f of flows) { run += f.c; if (days.length && days[days.length - 1].d === f.d) days[days.length - 1].b = run; else days.push({ d: f.d, b: run }); }
    const at = (d) => { let lo = 0, hi = days.length - 1, ans = 0; while (lo <= hi) { const mid = (lo + hi) >> 1; if (days[mid].d <= d) { ans = days[mid].b; lo = mid + 1; } else hi = mid - 1; } return ans; };
    dailyCache.set(account, at);
    return at;
  };
  L.unitsOn = (ref, date, accountRef) => R.unitsOn(ref, date, accountRef);
  L.cashOnlyCategoryFlow = (m) => {
    let v = 0;
    for (const p of postings) if (p.category_id) {
      const c = L.index.categories.get(p.category_id);
      if (c && (c.economic_lens ?? c.accrual_lens) === false && monthOf(L.index.events.get(p.event_id).occurred_on) === m) v -= p.amount_cents;
    }
    return v;
  };
  L.decisionBound = (d) => R.decisionBound(d);
  L.isSnapshotHolding = (p) => {
    const account = R.alias("account", p.account_ref, p.as_at) || p.account_ref;
    const instrument = R.instrumentOf(p.instrument_ref, p.as_at);
    return (R.accounts.get(R.holdingOf(instrument, account)) || {}).fidelity === "snapshot";
  };
  L.excludedObs = new Set();
  L.tax = Tax.derive({ L, R, reference, setup });
  L.readiness = Tax.readiness(L, R, setup);
  L.returns = Tax.materialiseReturns(R);
  L.resolverObs = R.byKind;
  L.obsKind = new Map(R.obs.map((o) => [o.obs_id, o.kind]));

  L.reservations = setup.reservation || [];
  L.checks = runLaws(L);
  // A person can accept a result, with a reason and what would reopen it. An old lodged year does not stay red for ever.
  for (const d of decisions) if (d.verb === "accept" && d.target_type === "check" && d.status === "accepted") {
    for (const c of L.checks) if (`${c.law}|${c.scope}` === d.target_ref && c.status !== "pass") { c.status = "accepted"; c.accepted_by = d.decision_id; c.detail = `${d.reason || ""} Was: ${c.detail || ""}`.trim(); }
  }
  // An open clearing item or a gap is something a person can act on. A file the gate refused is too.
  for (const c of L.checks) if (c.law === "L2" && (c.status === "open" || c.status === "gap")) R.review.push({ kind: "open_item", ref: c.scope, amount_cents: c.gap_cents, what: `${c.scope} holds ${(c.gap_cents || 0) / 100}. ${c.detail}`, do: "It clears when the other witness arrives." });
  for (const f of input.faults || []) if (f.code === "file_refused") R.review.push({ kind: "file_refused", ref: f.path, amount_cents: null, what: f.what, do: "Its format may have changed. Fix the recipe; nothing from it is in the ledger." });
  // Reconciled means tied to a stated balance that holds, not merely that the file had a balance column.
  const shaky = new Set(L.checks.filter((c) => c.law === "L3" && (c.status === "fail" || c.status === "gap")).map((c) => c.scope));
  for (const e of R.events) if (e.grade === "reconciled" && e.line && shaky.has(e.line.account)) e.grade = "stated";
  L.review = rankReview(R.review);
  if (schema.metrics) L.metrics = allMetrics(L, schema.metrics);

  const hashInput = { events: R.events.map((e) => [e.event_id, e.kind, e.occurred_on, e.amount_cents, e.category_id]), postings: postings.map((p) => [p.event_id, p.line, p.account_id, p.category_id, p.amount_cents]) };
  L.bundleHash = hash64(stableStringify(hashInput));
  L.resolver = R;
  return L;
}

// An x_ event kind is a line of data: it joins the vocabulary when its legs pass the same proof as the standard's. No code path.
function withExtensions(events, extensions) {
  const kinds = extensions && extensions.events;
  if (!kinds) return events;
  const named = Object.keys(kinds).filter((k) => !k.startsWith("x_"));
  if (named.length) throw new Error(`extension kinds must start x_: ${named.join(", ")}`);
  const bad = proveTemplates({ kinds });
  if (bad.length) throw new Error(`extension does not balance: ${bad.join("; ")}`);
  return { ...events, kinds: { ...events.kinds, ...kinds } };
}
function latestDate(R) {
  // The last day anything actually happened. A policy's end date or a renewal is the future, not evidence of today.
  let last = null;
  for (const o of R.obs) {
    const p = o.payload;
    for (const d of [p.as_at, p.posting_date, p.pay_date]) if (d && (!last || d > last)) last = d;
  }
  return last || (R.events.length ? R.events[R.events.length - 1].occurred_on : null);
}
function rankReview(items) {
  const seen = new Set(); const out = [];
  for (const r of items) { const k = `${r.kind}|${r.ref}`; if (seen.has(k)) continue; seen.add(k); out.push({ item_id: `rv_${hash64(k)}`, ...r }); }
  return out.sort((a, b) => Math.abs(b.amount_cents || 0) - Math.abs(a.amount_cents || 0) || cmp(a.item_id, b.item_id));
}

module.exports = { rebuild };
