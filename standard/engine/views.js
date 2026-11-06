/* Views: pure functions over the ledger. Each metric is named in schema/metrics.json. Two lenses, one ledger (SPEC 6.5). */
"use strict";
const { groupBy, cmp, monthOf, monthEnd, nextMonth, monthsBetween, fyOf, fyRange, allocate, addDays, daysBetween } = require("./util");
const { activeOn, termAt } = require("./temporal");

function ledgerIndex(L) {
  const accounts = new Map(L.accounts.map((a) => [a.account_id, a]));
  const categories = new Map(L.categories.map((c) => [c.category_id, c]));
  const events = new Map(L.events.map((e) => [e.event_id, e]));
  return { accounts, categories, events };
}

// ---------- cash lens: what moved on cash accounts, by the meaning of the event ----------
function cashLens(L, opts = {}) {
  const X = L.index;
  const inScope = opts.accounts ? new Set(opts.accounts) : null;
  const isCash = (id) => { const a = X.accounts.get(id); return a && a.reporting_group === "cash" && (!inScope || inScope.has(id)); };
  // A purchase counts when it was charged, unless the household keeps its books by the day the bank posted it. Balances always move on the posting.
  const posted = (L.households || []).some((h) => h.budget_date === "posted");
  const when = (e) => (posted ? e.occurred_on : e.charged_on || e.occurred_on);
  // An account held wholly for someone else earns and spends nothing of the household's.
  const heldShare = heldBy(L), ours = new Map();
  const isOurs = (account, m) => { const k = `${account}|${m}`; if (!ours.has(k)) ours.set(k, heldShare(account, monthEnd(m)) > 0); return ours.get(k); };
  const months = new Map();
  const bucket = (m) => { if (!months.has(m)) months.set(m, { month: m, income: 0, spending: 0, unexplained: 0, net: 0, byCategory: {} }); return months.get(m); };
  for (const p of L.postings) {
    if (!p.account_id || !isCash(p.account_id)) continue;
    const e = X.events.get(p.event_id);
    const cat = X.categories.get(e.category_id);
    const m = bucket(monthOf(when(e)));
    if (!isOurs(p.account_id, m.month)) continue;
    // Money in that nobody has explained is neither income nor a refund. It is shown on its own until a person says.
    if (e.unexplained) { m.unexplained += p.amount_cents; continue; }
    if (!cat || cat.kind === "transfer" || cat.kind === "capital" || cat.cash_lens === false) { continue; }
    m.byCategory[e.category_id] = (m.byCategory[e.category_id] || 0) + p.amount_cents;
    if (cat.kind === "income") m.income += p.amount_cents; else m.spending -= p.amount_cents;
  }
  for (const m of months.values()) m.net = m.income - m.spending + m.unexplained;
  return [...months.values()].sort((a, b) => cmp(a.month, b.month));
}

// ---------- accrual lens: what the household earned and spent ----------
function accrualLens(L) {
  const X = L.index;
  const months = new Map();
  for (const p of L.postings) {
    if (!p.category_id) continue;
    const cat = X.categories.get(p.category_id);
    if (cat && (cat.economic_lens ?? cat.accrual_lens) === false) continue;
    const e = X.events.get(p.event_id);
    const key = monthOf(e.occurred_on);
    if (!months.has(key)) months.set(key, { month: key, income: 0, expense: 0, byCategory: {} });
    const m = months.get(key);
    m.byCategory[p.category_id] = (m.byCategory[p.category_id] || 0) - p.amount_cents;
    if (p.amount_cents < 0 || (cat && cat.kind === "income")) m.income -= p.amount_cents; else m.expense += p.amount_cents;
  }
  return [...months.values()].sort((a, b) => cmp(a.month, b.month));
}

// ---------- position ----------
const TRANSIT = "clearing:transit", SETTLE_DAYS = require("../schema/matching.json").windows_days.settle.days;
// A balance moves on the day its own account moved. The legs of a transfer can do that on different days.
function balanceDate(e, account) { return (e.leg_dates && e.leg_dates[account]) || e.occurred_on; }
function balances(L) {
  const X = L.index;
  const flows = new Map();
  const add = (k, m, c) => { if (!flows.has(k)) flows.set(k, new Map()); flows.get(k).set(m, (flows.get(k).get(m) || 0) + c); };
  for (const p of L.postings) {
    if (!p.account_id) continue;
    const e = X.events.get(p.event_id);
    const m = monthOf(balanceDate(e, p.account_id));
    add(p.account_id, m, p.amount_cents);
    // A transfer that crosses a month end sits on neither account at that month end. It is in the air, and still the household's.
    if (m !== monthOf(e.occurred_on)) { add(TRANSIT, monthOf(e.occurred_on), p.amount_cents); add(TRANSIT, m, -p.amount_cents); }
  }
  const allMonths = [...new Set([...flows.values()].flatMap((f) => [...f.keys()]))].sort();
  if (!allMonths.length) return { months: [], rows: [], table: new Map(), at: () => 0 };
  const lastHeld = L.asOf && monthOf(L.asOf) > allMonths[allMonths.length - 1] ? monthOf(L.asOf) : allMonths[allMonths.length - 1];
  const months = monthsBetween(allMonths[0], lastHeld);
  const rows = [], table = new Map();
  for (const [account, f] of flows) {
    let run = 0; const series = new Map();
    for (const m of months) { run += f.get(m) || 0; series.set(m, run); rows.push({ month_end: monthEnd(m), account_id: account, balance_cents: run }); }
    table.set(account, series);
  }
  const lastMonth = months[months.length - 1];
  return { months, rows, table, at: (account, month) => (table.get(account) ? table.get(account).get(month > lastMonth ? lastMonth : month) ?? 0 : 0) };
}
// A household holds what its members own on the day: the share of an account that is theirs. A joiner's account counts from the day they join, whatever their
// papers reach back to, and a joint owner who leaves takes their share with them.
function heldBy(L) {
  const owners = groupBy(L.ownership.filter((o) => o.subject_type === "account" && o.superseded_at == null), (o) => o.subject_id);
  const members = groupBy(L.memberships || [], (m) => m.party_id);
  const people = new Set(L.parties.filter((p) => p.kind === "person").map((p) => p.party_id));
  const belongs = (party, on) => (members.has(party) ? members.get(party).some((m) => m.valid_from <= on && (m.valid_to == null || on < m.valid_to)) : !people.has(party));
  const accounts = new Map(L.accounts.map((a) => [a.account_id, a]));
  return (account, on) => {
    // An account is gone from the day setup closes it, whatever it last showed.
    const a = accounts.get(account);
    if (a && a.closed_on && on >= a.closed_on) return 0;
    if (!owners.has(account)) return 1;
    const active = activeOn(owners.get(account), on), beneficial = active.filter((o) => o.basis === "beneficial"), rows = beneficial.length ? beneficial : active;
    const total = rows.reduce((s, o) => s + (o.share_bps ?? 10000), 0);
    return total ? rows.filter((o) => belongs(o.party_id, on)).reduce((s, o) => s + (o.share_bps ?? 10000), 0) / total : 0;
  };
}
function netWorthGroups(L) { return new Set(["cash", "property", "super", "shares", "crypto", "vehicle", "device", "loans"]); }
function netWorth(L, opts = {}) {
  const groups = netWorthGroups(L);
  const X = L.index;
  const inScope = opts.accounts ? new Set(opts.accounts) : null;
  const wrapped = wrappedAccounts(L);
  const heldShare = heldBy(L);
  // A trade whose cash never met it stops being a debt once settlement is well past. It is a question by then.
  const stale = L.events.filter((e) => e.unsettled);
  const out = [];
  for (const m of L.balances.months) {
    const row = { month: m, month_end: monthEnd(m), total: 0, groups: {} };
    for (const [account] of L.balances.table) {
      const a = X.accounts.get(account);
      // A trade between trade date and settlement is a real debt or receivable, and a transfer in the air is still owned. No other clearing balance is.
      const unsettled = account.startsWith("clearing:settle:") || account === TRANSIT;
      if (!unsettled && (!a || !groups.has(a.reporting_group) || wrapped.has(account))) continue;
      if (inScope && !inScope.has(account) && !unsettled) continue;
      const share = heldShare(account, row.month_end);
      if (!share) continue;
      const v = Math.round(L.balances.at(account, m) * share);
      row.total += v;
      const group = unsettled ? "unsettled" : a.reporting_group;
      row.groups[group] = (row.groups[group] || 0) + v;
    }
    for (const e of stale) {
      if (e.occurred_on > row.month_end || daysBetween(e.settled_on || e.occurred_on, row.month_end) <= SETTLE_DAYS) continue;
      const v = (e.postings || []).filter((p) => String(p.account_id).startsWith("clearing:settle:")).reduce((s, p) => s + p.amount_cents, 0);
      row.total -= v; row.groups.unsettled = (row.groups.unsettled || 0) - v;
    }
    if (!row.groups.unsettled) delete row.groups.unsettled;
    out.push(row);
  }
  return out;
}
// A dollar counts at one level. An asset owned by a wrapper is inside the wrapper's balance, not beside it.
function wrappedAccounts(L) {
  const wrappers = new Map(L.parties.filter((p) => ["smsf", "trust", "company"].includes(p.kind)).map((p) => [p.party_id, p.kind]));
  const out = new Set();
  if (!wrappers.size) return out;
  const theirs = new Set(L.ownership.filter((o) => o.subject_type === "account" && wrappers.has(o.party_id) && o.valid_to == null).map((o) => o.subject_id));
  // Only a balance held outside the wrapper can stand for what is inside it. With none, the wrapper's own accounts are the only place those dollars are.
  const standing = new Set(L.accounts.filter((a) => [...wrappers.values()].includes(a.type) && !theirs.has(a.account_id)).map((a) => a.type));
  for (const o of L.ownership) if (o.subject_type === "account" && wrappers.has(o.party_id) && o.valid_to == null) {
    const a = L.index.accounts.get(o.subject_id);
    if (a && standing.has(wrappers.get(o.party_id)) && a.type !== "smsf") out.add(o.subject_id);
  }
  return out;
}
function netWorthByOwner(L, month) {
  const X = L.index; const groups = netWorthGroups(L); const on = monthEnd(month);
  const out = {};
  for (const [account] of L.balances.table) {
    const a = X.accounts.get(account);
    if (!a || !groups.has(a.reporting_group)) continue;
    const v = L.balances.at(account, month);
    if (!v) continue;
    let owners = activeOn(L.ownership.filter((o) => o.subject_type === "account" && o.subject_id === account && o.basis === "beneficial"), on);
    if (!owners.length) owners = activeOn(L.ownership.filter((o) => o.subject_type === "account" && o.subject_id === account && o.basis === "legal"), on);
    if (!owners.length) { out.unassigned = (out.unassigned || 0) + v; continue; }
    for (const s of allocate(v, owners.map((o) => ({ key: o.party_id, weight: o.share_bps })))) out[s.key] = (out[s.key] || 0) + s.cents;
  }
  return out;
}

// ---------- activities: a rental and an ABN are the same shape ----------
function activityNet(L) {
  const X = L.index; const out = new Map();
  for (const p of L.postings) {
    if (!p.category_id) continue;
    const e = X.events.get(p.event_id);
    const id = e.activity_id || e.asset_id;
    if (!id) continue;
    const c = X.categories.get(p.category_id);
    if (!c || (c.economic_lens ?? c.accrual_lens) === false || c.kind === "capital") continue;
    const k = `${fyOf(e.occurred_on)}|${id}`;
    if (!out.has(k)) out.set(k, { fy: fyOf(e.occurred_on), activity: id, income: 0, expense: 0, net: 0, byCategory: {} });
    const r = out.get(k);
    if (c.kind === "income") r.income -= p.amount_cents; else r.expense += p.amount_cents;
    r.byCategory[p.category_id] = (r.byCategory[p.category_id] || 0) - p.amount_cents;
    r.net = r.income - r.expense;
  }
  return [...out.values()].sort((a, b) => cmp(a.fy, b.fy) || cmp(a.activity, b.activity));
}

// ---------- loans ----------
function loanTable(L) {
  const X = L.index; const rows = [];
  for (const c of L.contracts.filter((k) => k.kind === "loan")) {
    if (!c.account_id) continue;
    for (const m of L.balances.months) {
      const bal = L.balances.at(c.account_id, m);
      if (!bal) continue;
      rows.push({ month: m, loan: c.account_id, balance_cents: bal, rate: termAt(L.termIdx, "contract", c.contract_id, "interest_rate", monthEnd(m)) });
    }
  }
  void X; return rows;
}

// ---------- things: replacement costs falling due ----------
function refreshPlan(L) {
  const rows = [];
  for (const a of L.assets) {
    if (a.disposed_on) continue;
    const at = "2100-01-01";
    const refresh = termAt(L.termIdx, "asset", a.asset_id, "refresh_by", at);
    const cost = termAt(L.termIdx, "asset", a.asset_id, "replacement_cost_cents", at);
    const warranty = termAt(L.termIdx, "asset", a.asset_id, "warranty_until", at);
    if (refresh == null && warranty == null) continue;
    rows.push({ asset_id: a.asset_id, kind: a.kind, name: a.name, refresh_by: refresh, replacement_cost_cents: cost == null ? null : Number(cost), warranty_until: warranty, fy: refresh ? fyOf(refresh) : null });
  }
  return rows.sort((a, b) => cmp(a.refresh_by || "9999", b.refresh_by || "9999"));
}

// ---------- commitments: a contract's price on any date ----------
function billsCommitted(L, month) {
  const on = monthEnd(month); let total = 0; const rows = [];
  for (const c of L.contracts) {
    if (c.ended_on && c.ended_on <= on) continue;
    const price = termAt(L.termIdx, "contract", c.contract_id, "price_cents", on) ?? termAt(L.termIdx, "contract", c.contract_id, "premium_cents", on);
    if (price == null) continue;
    const cadence = termAt(L.termIdx, "contract", c.contract_id, "cadence", on) || termAt(L.termIdx, "contract", c.contract_id, "premium_cadence", on) || "yearly";
    // Every 4, 8, 15 or 26 weeks is said in billing_months; a cadence named nowhere is a guess, and says so.
    const months = Number(termAt(L.termIdx, "contract", c.contract_id, "billing_months", on)) || null;
    const known = { monthly: 1, quarterly: 3, half_yearly: 6, yearly: 12, fortnightly: 12 / 26 }[cadence];
    const monthly = months ? Math.round(Number(price) / months) : cadence === "weekly" ? Math.round(Number(price) * 52 / 12) : Math.round(Number(price) / (known || 12));
    rows.push({ contract_id: c.contract_id, name: c.name, monthly_cents: monthly, ...(months || known || cadence === "weekly" ? {} : { guessed: true }) });
    total += monthly;
  }
  return { month, total_cents: total, rows };
}

// ---------- commitments: an accepted quote, part paid ----------
function commitments(L, on) {
  const rows = [];
  for (const c of L.contracts.filter((k) => k.kind === "commitment")) {
    const total = termAt(L.termIdx, "contract", c.contract_id, "total_cents", on);
    if (total == null || (c.started_on && c.started_on > on)) continue;
    const paid = L.events.filter((e) => e.contract_id === c.contract_id && e.occurred_on <= on).reduce((s, e) => s + Math.abs(e.amount_cents), 0);
    rows.push({ contract_id: c.contract_id, name: c.name, total_cents: Number(total), paid_cents: paid, unpaid_cents: Math.max(Number(total) - paid, 0) });
  }
  return rows;
}

// ---------- budgets: judged against the budget valid that month ----------
function budgetVariance(L, month) {
  const on = monthEnd(month);
  const cash = (L.cash || []).find((m) => m.month === month) || { byCategory: {} };
  const rows = [];
  for (const b of activeOn(L.budgets || [], on)) {
    const spent = -(cash.byCategory[b.category_id] || 0);
    const budget = b.cadence === "yearly" ? Math.round(b.amount_cents / 12) : b.amount_cents;
    rows.push({ category_id: b.category_id, budget_cents: budget, spent_cents: spent, variance_cents: budget - spent });
  }
  return rows;
}

// ---------- coverage: expected against held ----------
// What a file speaks for: the days its own contents cover, whenever it was downloaded.
const SPOKEN_DAYS = ["posting_date", "as_at", "period_start", "period_end", "pay_date", "bill_date", "assessed_on", "trade_date", "vest_date", "issued_on"];
function spokenSpans(L) {
  const byStream = new Map(), source = new Map(L.sources.map((s) => [s.source_id, s]));
  const span = new Map();
  for (const o of L.observations) {
    const src = source.get(o.source_id), st = src && src.stream_id;
    if (!st) continue;
    const r = span.get(o.source_id) || { stream: st, lo: null, hi: null, closes: null, delivered: L.receipts && L.receipts.length ? src.captured_at : src.issued_on || src.captured_at };
    if (o.kind === "statement") r.closes = { lo: o.payload.period_start, hi: o.payload.period_end, opens: o.payload.opening_cents, ends: o.payload.closing_cents };
    for (const f of SPOKEN_DAYS) { const d = o.payload && o.payload[f]; if (typeof d !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(d)) continue; if (!r.lo || d < r.lo) r.lo = d; if (!r.hi || d > r.hi) r.hi = d; }
    span.set(o.source_id, r);
  }
  for (const r of span.values()) if (r.lo) { if (!byStream.has(r.stream)) byStream.set(r.stream, []); byStream.get(r.stream).push(r); }
  return byStream;
}
// Statements chain: each opens where the last closed. Where one does not, and days are missing between them, a statement is missing, named by the month it would have closed in, even when its neighbours reach into that month.
function statementHoles(rows) {
  const chain = rows.map((r) => r.closes).filter((c) => c && c.lo && c.hi).sort((a, b) => cmp(a.lo, b.lo)), holes = new Set();
  chain.slice(1).forEach((c, i) => { if (daysBetween(chain[i].hi, c.lo) > 7 && c.opens !== chain[i].ends) holes.add(monthOf(addDays(c.lo, -1))); });
  return holes;
}
function coverage(L) {
  /* A period is held if a file speaks for it, whenever the file was downloaded. In a stream whose files say nothing about their dates, each delivery
     answers for one period, so a late file next door cannot hide a missing month. A period that has not ended, plus its grace, is not due yet. */
  const received = L.receipts && L.receipts.length ? L.receipts : L.sources.filter((s) => s.stream_id && s.status === "active").map((s) => ({ stream_id: s.stream_id, day: s.issued_on || s.captured_at }));
  const held = groupBy(received, (s) => s.stream_id), spoken = spokenSpans(L);
  // A delivery whose own contents already speak has nothing more to say. What is left is a quiet file: an empty month, a byte-identical re-delivery.
  const spent = new Map();
  for (const rows of spoken.values()) for (const r of rows) { const k = `${r.stream}|${String(r.delivered).slice(0, 10)}`; spent.set(k, (spent.get(k) || 0) + 1); }
  const quiet = (id) => (held.get(id) || []).filter((x) => { const k = `${id}|${String(x.day).slice(0, 10)}`, n = spent.get(k) || 0; if (!n) return true; spent.set(k, n - 1); return false; });
  const stepMonths = { fortnightly: 1, monthly: 1, quarterly: 3, half_yearly: 6, yearly: 12 };
  const rows = [];
  for (const s of L.streams) {
    const step = stepMonths[s.cadence];
    if (!step) continue;
    const start = monthOf(s.valid_from), end = monthOf(s.valid_to ? addDays(s.valid_to, -1) : L.asOf);
    const grace = s.grace_days ?? 45;
    let expected = 0, have = 0; const missing = [];
    const ms = monthsBetween(start, end);
    const holes = statementHoles(spoken.get(s.stream_id) || []);
    const speaks = (i) => !ms.slice(i, i + step).some((m) => holes.has(m)) && (spoken.get(s.stream_id) || []).some((r) => r.lo <= monthEnd(ms[Math.min(i + step - 1, ms.length - 1)]) && r.hi >= `${ms[i]}-01`);
    const silent = []; for (let i = 0; i < ms.length; i += step) if (!speaks(i)) silent.push(i);
    const answered = answerPeriods(ms, silent, step + Math.ceil(grace / 30), quiet(s.stream_id).map((x) => monthOf(x.day)));
    if (s.cadence === "fortnightly") {
      // A fortnightly stream is counted in fortnights, so one missing payslip shows.
      const days = (held.get(s.stream_id) || []).map((x) => x.day).filter(Boolean).sort();
      const stop = s.valid_to && s.valid_to < L.asOf ? s.valid_to : L.asOf;
      let exp = 0, got2 = 0; const miss = [];
      for (let d = s.valid_from; addDays(d, 14 + grace) <= stop; d = addDays(d, 14)) {
        exp += 1;
        if (days.some((x) => x >= d && x < addDays(d, 14 + 3))) got2 += 1; else miss.push(d);
      }
      rows.push({ stream_id: s.stream_id, name: s.name, expected: exp, have: got2, ratio: exp ? got2 / exp : 1, missing: miss.slice(-6) });
      continue;
    }
    for (let i = 0; i < ms.length; i += step) {
      const closes = monthEnd(ms[Math.min(i + step - 1, ms.length - 1)]);
      const isHeld = speaks(i) || answered.has(i);
      if (addDays(closes, grace) > L.asOf && !isHeld) continue;
      // A stream that starts mid-period, or ends mid-period, owes nothing for the stub.
      const stub = (i === 0 && s.valid_from.slice(8) !== "01") || i + step > ms.length;
      if (stub && !isHeld) continue;
      expected += 1;
      if (isHeld) have += 1; else missing.push(ms[i]);
    }
    // A busy account that goes quiet for a week has lost lines, whatever its files say. No balance is needed to see it.
    const quietRuns = s.subject_type === "account" ? silences(L.linesByAccount && L.linesByAccount.get(s.subject_id)) : [];
    missing.push(...quietRuns);
    if (quietRuns.length && have === expected) have -= 1;
    rows.push({ stream_id: s.stream_id, name: s.name, expected, have, ratio: expected ? have / expected : 1, missing: missing.slice(-6) });
  }
  return rows;
}
function silences(lines) {
  const days = [...new Set((lines || []).map((l) => l.date))].sort();
  if (days.length < 20) return [];
  const gaps = days.slice(1).map((d, i) => daysBetween(days[i], d)), sorted = [...gaps].sort((a, b) => a - b), usual = sorted[Math.floor(gaps.length / 2)], wide = sorted[Math.floor(gaps.length * 0.9)];
  if (usual > 2) return [];
  // One or two is a hole. Many is how this account behaves.
  const runs = gaps.flatMap((g, i) => (g >= 6 && g > 2 * wide ? [`${days[i]} to ${days[i + 1]}`] : []));
  return runs.length <= 3 ? runs : [];
}
// Which periods the deliveries answer, one delivery each. The commonest lag explains most of them; a late one then fills the period it is near.
function answerPeriods(ms, periods, span, months) {
  const left = new Map();
  for (const m of months) left.set(m, (left.get(m) || 0) + 1);
  const lastIndex = ms.length - 1;
  const take = (i) => { const n = left.get(ms[i]); if (!n) return false; left.set(ms[i], n - 1); return true; };
  let best = 0, bestScore = -1;
  for (let lag = 0; lag <= span; lag++) { const score = periods.filter((p) => p + lag <= lastIndex && left.get(ms[p + lag])).length; if (score > bestScore) { bestScore = score; best = lag; } }
  const out = new Set();
  for (const p of periods) if (p + best <= lastIndex && take(p + best)) out.add(p);
  for (const p of periods) { if (out.has(p)) continue; for (let i = p; i <= Math.min(p + span, lastIndex); i++) if (take(i)) { out.add(p); break; } }
  return out;
}

// Open any number: metric -> postings -> events -> witnesses -> observations -> the line of the file.
function explain(L, eventId) {
  const e = L.index.events.get(eventId);
  if (!e) return null;
  const obs = new Map(L.observations.map((o) => [o.obs_id, o]));
  const sources = new Map(L.sources.map((s) => [s.source_id, s]));
  return { event: e, postings: L.postings.filter((p) => p.event_id === eventId), witnesses: L.witnesses.filter((w) => w.event_id === eventId).map((w) => {
    const o = obs.get(w.obs_id); const s = o && sources.get(o.source_id);
    return { role: w.role, kind: o && o.kind, locator: o && o.locator, file: s && s.name, sha256: s && s.sha256 };
  }) };
}

module.exports = { balanceDate, heldBy, commitments, ledgerIndex, cashLens, accrualLens, balances, netWorth, netWorthByOwner, activityNet, loanTable, refreshPlan, billsCommitted, budgetVariance, coverage, explain, wrappedAccounts };
