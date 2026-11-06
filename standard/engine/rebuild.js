/* One call: originals in, everything derived out. Same inputs, same bytes. */
"use strict";
const { byKey, groupBy, cmp, monthOf, monthEnd, addDays, parseUnits, stableStringify, hash64 } = require("./util");
const { indexTerms } = require("./temporal");
const { Resolver } = require("./resolve");
const { post } = require("./post");
const V = require("./views");
const { runLaws } = require("./laws");
const Tax = require("./tax");

const AUTO_ACCOUNT = [
  [/^clearing:/, { class: "clearing", type: "clearing", reporting_group: "clearing" }],
  [/^ato:/, { class: "asset", type: "tax_position", reporting_group: "tax" }],
  [/^equity:/, { class: "equity", type: "equity", reporting_group: "equity" }],
  [/^memo:/, { class: "memo", type: "memo", reporting_group: "memo" }],
  [/^receivable:/, { class: "asset", type: "receivable", reporting_group: "clearing" }],
];

function rebuild(input) {
  const { setup, sources, observations, decisions = [], rules, schema, reference, asOf } = input;
  const R = new Resolver({ setup, sources, observations, decisions, rules, eventSchema: schema.events });
  R.run();

  R.events.sort((a, b) => cmp(a.occurred_on, b.occurred_on) || cmp(a.event_id, b.event_id));
  const dupes = [...groupBy(R.events, (e) => e.event_id).entries()].filter(([, v]) => v.length > 1);
  if (dupes.length) throw new Error(`duplicate event keys: ${dupes.slice(0, 3).map(([, v]) => v[0].key).join("; ")}`);

  const postings = [], witnesses = [];
  for (const e of R.events) {
    if (!e.postings) e.postings = post(e, schema.events);
    for (const p of e.postings) postings.push({ ...p, event_id: e.event_id });
    for (const w of e.witnesses) witnesses.push({ event_id: e.event_id, obs_id: w.obs_id, role: w.role });
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
    asOf: asOf || (R.events.length ? R.events[R.events.length - 1].occurred_on : null),
    accounts: [...(setup.account || []), ...auto],
    categories: setup.category || [], parties: setup.party || [], contracts: setup.contract || [], assets: setup.asset || [], ownership: setup.ownership || [],
    streams: setup.stream || [], periods: setup.period || [], budgets: setup.budget || [], activities: setup.activity || [],
    sources: sources || [], observations: R.obs, decisions, events: R.events, postings, witnesses, terms: R.terms, termIdx: indexTerms(R.terms), lines: R.lines, linesByAccount: R.linesByAccount,
  };
  L.index = V.ledgerIndex(L);
  L.balances = V.balances(L);
  L.cash = V.cashLens(L);
  L.accrual = V.accrualLens(L);
  L.netWorth = V.netWorth(L);
  L.activityNet = V.activityNet(L);
  L.coverage = V.coverage(L);
  L.refresh = V.refreshPlan(L);
  L.lotRows = R.lots ? R.lots.lots : [];
  L.lotMatches = R.lots ? R.lots.matches : [];

  // Stated balances: every claim a source makes about where an account stood.
  const stated = [];
  for (const l of R.lines) if (l.balanceAfter != null) stated.push({ account: l.account, date: l.date, cents: l.balanceAfter, seq: l.seq, intraday: true });
  const lastPerDay = new Map();
  for (const s of stated) { const k = `${s.account}|${s.date}`; const cur = lastPerDay.get(k); if (!cur || s.seq > cur.seq) lastPerDay.set(k, s); }
  L.stated = [...lastPerDay.values()].filter((s) => !isIntradayAmbiguous(R, s));
  for (const o of R.obs) {
    const p = o.payload;
    if (o.kind === "statement") { const a = R.accountOf(o, p.account_ref, p.period_end); if (a) L.stated.push({ account: a, date: p.period_end, cents: p.closing_cents }); }
    if (o.kind === "loan_statement") { const a = R.accountOf(o, p.account_ref, p.period_end); if (a) L.stated.push({ account: a, date: p.period_end, cents: -p.closing_cents }); }
    if (o.kind === "super_statement") { const a = R.accountOf(o, p.account_ref, p.period_end); if (a) L.stated.push({ account: a, date: p.period_end, cents: p.closing_cents }); }
    if (o.kind === "balance") { const a = R.accountOf(o, p.account_ref, p.as_at); if (a) L.stated.push({ account: a, date: p.as_at, cents: p.balance_cents }); }
  }
  const dailyCache = new Map();
  L.dailyBalance = (account) => {
    if (dailyCache.has(account)) return dailyCache.get(account);
    const flows = postings.filter((p) => p.account_id === account).map((p) => ({ d: L.index.events.get(p.event_id).occurred_on, c: p.amount_cents })).sort((a, b) => cmp(a.d, b.d));
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
      if (c && c.accrual_lens === false && monthOf(L.index.events.get(p.event_id).occurred_on) === m) v -= p.amount_cents;
    }
    return v;
  };
  L.decisionBound = (d) => R.decisionBound(d);
  L.excludedObs = new Set();
  L.tax = reference ? Tax.derive({ L, R, reference, setup }) : null;

  L.checks = runLaws(L);
  L.review = rankReview(R.review);

  const hashInput = { events: R.events.map((e) => [e.event_id, e.kind, e.occurred_on, e.amount_cents, e.category_id]), postings: postings.map((p) => [p.event_id, p.line, p.account_id, p.category_id, p.amount_cents]) };
  L.bundleHash = hash64(stableStringify(hashInput));
  L.resolver = R;
  return L;
}

function isIntradayAmbiguous() { return false; }
function rankReview(items) {
  const seen = new Set(); const out = [];
  for (const r of items) { const k = `${r.kind}|${r.ref}`; if (seen.has(k)) continue; seen.add(k); out.push({ item_id: `rv_${hash64(k)}`, ...r }); }
  return out.sort((a, b) => Math.abs(b.amount_cents || 0) - Math.abs(a.amount_cents || 0) || cmp(a.item_id, b.item_id));
}

module.exports = { rebuild };
