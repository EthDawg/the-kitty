/* Facts about a household, and nothing else. No score, no level, no verdict: scope counts by state, coverage, months closed, laws, and what is
   unknown. next.js turns these into one step, and a ladder, if a page wants one, is the page's opinion. */
"use strict";
const { closeStatus } = require("../../standard/engine/close");
const { monthOf, monthEnd } = require("../../standard/engine/util");
const { bytesState, readState } = require("./add");
const { rebuildAt, dayOf } = require("./clock");
const { ready } = require("./init");
const { money, monthYear, dayYear, plural, list } = require("./words");

const DOMAINS = [
  { domain: "credit_card", name: "a credit card", types: ["credit_card"], asks: "Do you have a credit card?", why: "Card spending only shows once its file is in, and the repayment from your bank looks like one big bill until then." },
  { domain: "super", name: "super", types: ["super", "smsf"], asks: "Do you have super?", why: "For most people it is one of the biggest things they own, and it is missing from what you are worth until it is here." },
  { domain: "home_loan", name: "a home loan", types: ["loan"], asks: "Do you have a home loan?", why: "A loan changes what you are worth, and part of each repayment is interest and part is yours." },
  { domain: "rental", name: "a rental property", types: [], asks: "Do you own a property you rent out?", why: "Rent, costs and tax all hang off it." },
  { domain: "shares", name: "shares or ETFs", types: ["brokerage", "holding"], asks: "Do you hold shares or ETFs?", why: "They count toward what you are worth, and their dividends and sales matter at tax time." },
  { domain: "help_debt", name: "a HELP debt", types: ["help_debt"], asks: "Do you have a HELP or HECS debt?", why: "It changes your take-home pay and your tax." },
  { domain: "insurance", name: "insurance", types: [], asks: "Do you hold insurance of your own?", why: "Renewal dates and premiums are easy to lose track of." },
  { domain: "crypto", name: "crypto", types: ["wallet"], asks: "Do you hold any crypto?", why: "It counts toward what you are worth, and each sale or swap matters at tax time." },
];
// The engine is still being tested on families it was not built around, and blind runs still find it silently wrong. Every status says so.
const CAVEAT = "The Kitty is experimental. It can read a household wrong without saying so, so check anything you act on. It is not tax advice.";
const ACCOUNT_CLASSES = new Set(["asset", "liability"]);
const scopeKey = (s) => `${s.subject_type}|${s.subject_id}|${s.domain}`;

function scopeFacts(view) {
  const last = new Map();
  for (const s of view.setup.scope) last.set(scopeKey(s), s);
  const states = { has: 0, none: 0, partial: 0, unknown: 0 }, said = new Map();
  for (const s of last.values()) { states[s.state] += 1; said.set(s.domain, s.state); }
  const types = new Set(view.setup.account.map((a) => a.type)), not_asked = [];
  for (const d of DOMAINS) {
    if (said.has(d.domain)) continue;
    if (d.types.some((t) => types.has(t))) { states.has += 1; said.set(d.domain, "has"); } else not_asked.push(d.domain);
  }
  return { ...states, not_asked, said: Object.fromEntries(said) };
}
/* How far evidence reaches for each account: its last line, or the day a file for it was downloaded, whichever is later. A file taken on 3 April speaks
   for all of March, however quiet the end of March was. If it does not, the next file's balance will not chain, and a law says so. */
function reachOf(L, view) {
  const reach = new Map();
  const stretch = (a, d) => { if (d && (!reach.has(a) || d > reach.get(a))) reach.set(a, d); };
  for (const l of L.lines || []) stretch(l.account, l.date);
  for (const s of view.sources) { const st = view.setup.stream.find((x) => x.stream_id === s.stream_id); if (st && st.subject_type === "account") stretch(st.subject_id, dayOf(s.captured_at)); }
  return reach;
}
function monthFacts(L, view, today, scope, reach) {
  const lines = L.lines || [], seen = [...new Set(lines.map((l) => monthOf(l.date)))].sort();
  const status = new Map(closeStatus(L).map((c) => [c.period_id, c])), periods = new Map(view.setup.period.map((p) => [p.period_id, p]));
  const provisional = new Set(L.events.filter((e) => e.status === "provisional").map((e) => monthOf(e.occurred_on)));
  const otherThanPay = new Set(L.events.filter((e) => e.status === "provisional" && e.kind !== "wage_unmatched").map((e) => monthOf(e.occurred_on)));
  const waiting = new Set(L.review.filter((r) => r.kind === "uncategorised").map((r) => monthOf(r.ref.split("|")[1])));
  return seen.map((month) => {
    const end = monthEnd(month), c = status.get(month) || { status: "open", unconfirmed: [] }, p = periods.get(month);
    const touched = [...new Set(lines.filter((l) => monthOf(l.date) === month).map((l) => l.account))];
    const short = touched.filter((a) => (reach.get(a) || "") < end);
    const ended = !today || today > end, whole = ended && !short.length, confirmed = !c.unconfirmed.length;
    const state = p && ["closed", "locked"].includes(p.status) ? p.status : whole && confirmed ? "ready" : "open";
    // A pay with no payslip keeps a month provisional. A household that says it has none has answered that.
    const can_lock = whole && confirmed && !waiting.has(month) && (c.status === "lockable" || (provisional.has(month) && !otherThanPay.has(month) && scope.said.payroll === "none"));
    return { month, end, state, ended, whole, confirmed, unconfirmed: c.unconfirmed, touched, short, provisional: provisional.has(month), waiting: waiting.has(month), can_lock };
  });
}
function lawFacts(L) {
  const counts = { pass: 0, fail: 0, gap: 0, open: 0, skip: 0, accepted: 0 };
  for (const c of L.checks) counts[c.status] += 1;
  return { ...counts, ran: L.checks.length - counts.skip, failing: L.checks.filter((c) => c.status === "fail").map((c) => ({ law: c.law, scope: c.scope, detail: c.detail })) };
}
function readiness({ L, view, clock }) {
  const today = clock.today, accounts = view.setup.account.filter((a) => ACCOUNT_CLASSES.has(a.class) && a.in_scope !== false);
  const scope = scopeFacts(view), reach = reachOf(L, view), months = monthFacts(L, view, today, scope, reach), laws = lawFacts(L);
  const coverage = { expected: L.coverage.reduce((n, c) => n + c.expected, 0), held: L.coverage.reduce((n, c) => n + c.have, 0), streams: L.coverage.map((c) => ({ stream_id: c.stream_id, name: c.name, expected: c.expected, held: c.have, missing: c.missing })) };
  const hasObs = new Set(view.observations.map((o) => o.source_id));
  const sources = { held: view.sources.length, read: 0, unread: 0, refused: 0, quiet: 0, bytes: { held: 0, on_device: 0, not_held: 0, unknown: 0 } };
  for (const s of view.sources) { const st = readState(s); sources[st] += 1; if (st === "read" && !hasObs.has(s.source_id)) sources.quiet += 1; sources.bytes[bytesState(s)] += 1; }
  const open = L.review.filter((r) => r.kind === "uncategorised");
  const review = { items: L.review.length, uncategorised: open.length, uncategorised_cents: open.reduce((n, r) => n + Math.abs(r.amount_cents || 0), 0), by_kind: L.review.reduce((m, r) => { m[r.kind] = (m[r.kind] || 0) + 1; return m; }, {}) };
  const noBalance = accounts.filter((a) => !L.stated.some((s) => s.account === a.account_id) && (L.linesByAccount.get(a.account_id) || []).length).map((a) => a.account_id);
  const nw = L.netWorth[L.netWorth.length - 1] || null, cash = L.cash.filter((c) => months.some((m) => m.month === c.month));
  const lastWhole = [...months].reverse().find((m) => m.whole), shown = (lastWhole && cash.find((c) => c.month === lastWhole.month)) || cash[cash.length - 1] || null;
  const unknown = [];
  if (scope.not_asked.length) unknown.push(`Not asked yet: ${list(scope.not_asked.map((d) => DOMAINS.find((x) => x.domain === d).name))}.`);
  if (review.uncategorised) unknown.push(`${plural(review.uncategorised, "line")} worth ${money(review.uncategorised_cents)} ${review.uncategorised === 1 ? "has" : "have"} no category.`);
  if (sources.unread) unknown.push(`${plural(sources.unread, "file")} held but not read.`);
  if (sources.refused) unknown.push(`${plural(sources.refused, "file")} refused.`);
  if (noBalance.length) unknown.push(`${plural(noBalance.length, "account")} with no stated balance.`);
  const missing = coverage.streams.reduce((n, s) => n + s.missing.length, 0);
  if (missing) unknown.push(`${plural(missing, "period")} expected and not held.`);
  if (clock.tax_assumed_years.length) unknown.push(`Tax for ${list(clock.tax_assumed_years)} uses the last law read, ${dayYear(clock.tax_verified_at)}, and is assumed.`);
  return {
    accounts_known: accounts.length, people: view.setup.party.filter((p) => p.kind === "person").length, scope, coverage, months, months_closed: months.filter((m) => ["closed", "locked"].includes(m.state)).length, months_locked: months.filter((m) => m.state === "locked").length, laws, review, sources, no_balance: noBalance, reach: Object.fromEntries(reach), unknown,
    net_worth: nw && { cents: nw.total, month: nw.month, of_accounts: accounts.length }, cash: shown && { month: shown.month, income_cents: shown.income, spending_cents: shown.spending, unexplained_cents: shown.unexplained, unplaced_cents: Math.abs(shown.byCategory.UNCAT || 0) },
  };
}
function words(s) {
  const r = s.readiness, out = [`${s.household.name}. ${s.clock.as_of ? `Your files reach ${dayYear(s.clock.as_of)}.` : "No files yet."}`];
  if (r.net_worth) out.push(`${money(r.net_worth.cents)} across the ${plural(r.accounts_known, "account")} we know about.`);
  if (r.cash) out.push(`${monthYear(r.cash.month)}: ${money(r.cash.income_cents)} in, ${money(r.cash.spending_cents)} out${r.cash.unplaced_cents ? `, ${money(r.cash.unplaced_cents)} of it not placed yet` : ""}${r.cash.unexplained_cents ? `, and ${money(r.cash.unexplained_cents)} came in that nobody has explained` : ""}.`);
  if (r.months.length) out.push(`${plural(r.months_closed, "month")} closed of ${r.months.length}. ${r.laws.pass} of the ${r.laws.ran} checks that could run pass.`);
  if (r.coverage.expected) out.push(`${r.coverage.held} of the ${plural(r.coverage.expected, "period")} we expected ${r.coverage.expected === 1 ? "is" : "are"} covered.`);
  return [...out, ...r.unknown, CAVEAT];
}
async function status(store, { today, built } = {}) {
  const m = await ready(store), b = built || (await rebuildAt(store, { today })), hh = b.view.setup.household[0] || {};
  const r = readiness(b);
  const out = { household: { id: hh.household_id, name: hh.name, standard_version: m.standard_version }, clock: b.clock, bundle_hash: b.L.bundleHash, readiness: r };
  return { ...out, words: words(out) };
}
module.exports = { status, readiness, DOMAINS };
