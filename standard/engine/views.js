/* Views: pure functions over the ledger. Each metric is named in schema/metrics.json. Two lenses, one ledger (SPEC 6.5). */
"use strict";
const { groupBy, cmp, monthOf, monthEnd, nextMonth, monthsBetween, fyOf, fyRange, allocate, addDays } = require("./util");
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
  const months = new Map();
  const bucket = (m) => { if (!months.has(m)) months.set(m, { month: m, income: 0, spending: 0, net: 0, byCategory: {} }); return months.get(m); };
  for (const p of L.postings) {
    if (!p.account_id || !isCash(p.account_id)) continue;
    const e = X.events.get(p.event_id);
    const cat = X.categories.get(e.category_id);
    const m = bucket(monthOf(e.occurred_on));
    if (!cat || cat.kind === "transfer" || cat.kind === "capital" || cat.cash_lens === false) { continue; }
    m.byCategory[e.category_id] = (m.byCategory[e.category_id] || 0) + p.amount_cents;
    if (cat.kind === "income") m.income += p.amount_cents; else m.spending -= p.amount_cents;
  }
  for (const m of months.values()) m.net = m.income - m.spending;
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
function balances(L) {
  const X = L.index;
  const flows = new Map();
  for (const p of L.postings) {
    if (!p.account_id) continue;
    const e = X.events.get(p.event_id);
    const m = monthOf(e.occurred_on);
    const k = p.account_id;
    if (!flows.has(k)) flows.set(k, new Map());
    flows.get(k).set(m, (flows.get(k).get(m) || 0) + p.amount_cents);
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
function netWorthGroups(L) { return new Set(["cash", "property", "super", "shares", "crypto", "vehicle", "device", "loans"]); }
function netWorth(L, opts = {}) {
  const groups = netWorthGroups(L);
  const X = L.index;
  const inScope = opts.accounts ? new Set(opts.accounts) : null;
  const wrapped = wrappedAccounts(L);
  const out = [];
  for (const m of L.balances.months) {
    const row = { month: m, month_end: monthEnd(m), total: 0, groups: {} };
    for (const [account] of L.balances.table) {
      const a = X.accounts.get(account);
      if (!a || !groups.has(a.reporting_group) || wrapped.has(account)) continue;
      if (inScope && !inScope.has(account)) continue;
      const v = L.balances.at(account, m);
      row.total += v;
      row.groups[a.reporting_group] = (row.groups[a.reporting_group] || 0) + v;
    }
    out.push(row);
  }
  return out;
}
// A dollar counts at one level. An asset owned by a wrapper is inside the wrapper's balance, not beside it.
function wrappedAccounts(L) {
  const wrappers = new Set(L.parties.filter((p) => ["smsf", "trust", "company"].includes(p.kind)).map((p) => p.party_id));
  const out = new Set();
  if (!wrappers.size) return out;
  for (const o of L.ownership) if (o.subject_type === "account" && wrappers.has(o.party_id) && o.valid_to == null) {
    const a = L.index.accounts.get(o.subject_id);
    if (a && a.type !== "smsf") out.add(o.subject_id);
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
    const monthly = cadence === "monthly" ? Number(price) : cadence === "quarterly" ? Math.round(Number(price) / 3) : cadence === "weekly" ? Math.round(Number(price) * 52 / 12) : Math.round(Number(price) / 12);
    rows.push({ contract_id: c.contract_id, name: c.name, monthly_cents: monthly });
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
function coverage(L) {
  // A period counts as held if any file arrived for it, including a byte-identical re-delivery. A period that has not ended, plus its grace, is not due yet.
  const received = L.receipts && L.receipts.length ? L.receipts : L.sources.filter((s) => s.stream_id && s.status === "active").map((s) => ({ stream_id: s.stream_id, day: s.issued_on || s.captured_at }));
  const held = groupBy(received, (s) => s.stream_id);
  const stepMonths = { fortnightly: 1, monthly: 1, quarterly: 3, half_yearly: 6, yearly: 12 };
  const rows = [];
  for (const s of L.streams) {
    const step = stepMonths[s.cadence];
    if (!step) continue;
    const start = monthOf(s.valid_from), end = monthOf(s.valid_to ? addDays(s.valid_to, -1) : L.asOf);
    const got = new Set((held.get(s.stream_id) || []).map((x) => monthOf(x.day)));
    const grace = s.grace_days ?? 45;
    let expected = 0, have = 0; const missing = [];
    const ms = monthsBetween(start, end);
    for (let i = 0; i < ms.length; i += step) {
      const window = monthsBetween(ms[i], ms[Math.min(i + step + Math.ceil(grace / 30), ms.length - 1)]);
      const closes = monthEnd(ms[Math.min(i + step - 1, ms.length - 1)]);
      if (addDays(closes, grace) > L.asOf && !window.some((m) => got.has(m))) continue;
      expected += 1;
      if (window.some((m) => got.has(m))) have += 1; else missing.push(ms[i]);
    }
    rows.push({ stream_id: s.stream_id, name: s.name, expected, have, ratio: expected ? have / expected : 1, missing: missing.slice(-6) });
  }
  return rows;
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

module.exports = { commitments, ledgerIndex, cashLens, accrualLens, balances, netWorth, netWorthByOwner, activityNet, loanTable, refreshPlan, billsCommitted, budgetVariance, coverage, explain, wrappedAccounts };
