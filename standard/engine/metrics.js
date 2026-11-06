/* Every metric in schema/metrics.json is computed here, once. A surface reads these rows and never recomputes them.
   Each returns rows of { grain, value }. Grades come from the laws the metric depends on: a failing law marks the number held. */
"use strict";
const V = require("./views");
const { monthEnd, monthOf, fyOf, fyRange, monthsBetween, addDays, cmp, groupBy, fmtUnits } = require("./util");
const { activeOn, termAt, indexTerms } = require("./temporal");
const { composition } = require("./tax");

const lastMonth = (L) => L.balances.months[L.balances.months.length - 1];
const people = (L) => L.parties.filter((p) => p.kind === "person").map((p) => p.party_id);

const REGISTRY = {
  "cash.income": (L) => L.cash.map((m) => ({ grain: m.month, value: m.income })),
  "cash.spending": (L) => L.cash.flatMap((m) => Object.entries(m.byCategory).filter(([, v]) => v < 0 || L.index.categories.get(m) ).map(([c, v]) => ({ grain: `${m.month}|${c}`, value: -v }))),
  "cash.net": (L) => L.cash.map((m) => ({ grain: m.month, value: m.net })),
  "cash.savings_rate": (L) => L.cash.filter((m) => m.income).map((m) => ({ grain: m.month, value: +(m.net / m.income).toFixed(4) })),
  "budget.variance": (L) => L.balances.months.flatMap((m) => V.budgetVariance(L, m).map((b) => ({ grain: `${m}|${b.category_id}`, value: b.variance_cents }))),
  "economic.income": (L) => L.accrual.map((m) => ({ grain: m.month, value: m.income })),
  "economic.expense": (L) => L.accrual.map((m) => ({ grain: m.month, value: m.expense })),
  "income.receipts": (L) => wageByFy(L, "gross"),
  "income.total": (L) => taxField(L, "taxable_income_cents"),
  "income.taxable": (L) => taxField(L, "taxable_income_cents"),
  "income.surcharge": (L) => taxField(L, "taxable_income_cents"),
  "income.composition": (L) => { const out = []; const fys = [...new Set(L.events.map((e) => fyOf(e.occurred_on)))].sort(); for (const fy of fys) for (const p of people(L)) { const c = composition(L, p, fy); for (const part of c.parts) out.push({ grain: `${fy}|${p}|${part.section}`, value: part.amount_cents, grade: c.grade }); } return out; },
  "position.balance": (L) => L.balances.rows.filter((r) => r.balance_cents).map((r) => ({ grain: `${r.month_end}|${r.account_id}`, value: r.balance_cents })),
  "position.cash": (L) => L.netWorth.map((r) => ({ grain: r.month, value: r.groups.cash || 0 })),
  "position.net_worth": (L) => L.netWorth.map((r) => ({ grain: r.month, value: r.total })),
  "position.net_worth_by_group": (L) => L.netWorth.flatMap((r) => Object.entries(r.groups).map(([g, v]) => ({ grain: `${r.month}|${g}`, value: v }))),
  "position.net_worth_by_owner": (L) => Object.entries(V.netWorthByOwner(L, lastMonth(L))).map(([p, v]) => ({ grain: `${lastMonth(L)}|${p}`, value: v })),
  "position.free_cash": (L) => {
    const reservations = L.reservations || [];
    return L.netWorth.map((r) => { const on = monthEnd(r.month); const held = activeOn(reservations, on).reduce((s, x) => s + (x.applied_cents ?? x.requested_cents), 0); return { grain: r.month, value: (r.groups.cash || 0) - held }; });
  },
  "loan.interest": (L) => L.events.filter((e) => e.kind === "loan_interest").map((e) => ({ grain: `${monthOf(e.occurred_on)}|${e.contract_id}`, value: e.amount_cents })),
  "loan.principal_paid": (L) => { const out = []; for (const c of L.contracts.filter((k) => k.kind === "loan" && k.account_id)) { let prev = null; for (const m of L.balances.months) { const b = L.balances.at(c.account_id, m); if (prev != null && b !== prev) out.push({ grain: `${m}|${c.contract_id}`, value: b - prev }); prev = b; } } return out; },
  "loan.rate_on": (L) => L.contracts.filter((k) => k.kind === "loan").flatMap((c) => L.balances.months.map((m) => ({ grain: `${monthEnd(m)}|${c.contract_id}`, value: termAt(L.termIdx, "contract", c.contract_id, "interest_rate", monthEnd(m)) })).filter((r) => r.value != null)),
  "loan.expected_interest": (L) => L.checks.filter((c) => c.law === "L6").map((c) => ({ grain: c.scope, value: c.gap_cents })),
  "activity.net_income": (L) => L.activityNet.map((a) => ({ grain: `${a.fy}|${a.activity}`, value: a.net })),
  "property.cost_base": (L) => L.lotRows.filter((l) => l.asset_id).map((l) => ({ grain: l.asset_id, value: l.cost_price_cents + l.cost_incidental_cents + l.cost_capital_cents + l.cost_adjustment_cents })),
  "super.contributions": (L) => { const m = new Map(); for (const e of L.events) if (e.kind === "super_contribution" || e.kind === "super_personal") { const k = `${fyOf(e.occurred_on)}|${e.person}|${e.superType}`; m.set(k, (m.get(k) || 0) + e.amount_cents); } return [...m].map(([grain, value]) => ({ grain, value })); },
  "super.cap_used": (L) => (L.tax ? L.tax.caps : []).map((c) => ({ grain: `${c.fy}|${c.person}|${c.cap}`, value: +(c.used / c.limit).toFixed(4) })),
  "shares.holdings": (L) => { const m = new Map(); for (const l of L.lotRows) if (l.instrument_id && l.units_open > 0n) m.set(l.instrument_id, (m.get(l.instrument_id) || 0n) + l.units_open); return [...m].map(([k, v]) => ({ grain: k, value: fmtUnits(v) })); },
  "shares.realised_gain": (L) => (L.tax ? L.tax.items.filter((i) => i.label === "18A").map((i) => ({ grain: `${i.fy}|${i.party_id}`, value: i.amount_cents })) : []),
  "tax.item": (L) => (L.tax ? L.tax.items.map((i) => ({ grain: `${i.fy}|${i.party_id}|${i.label}`, value: i.amount_cents })) : []),
  "tax.estimate": (L) => (L.tax ? L.tax.estimates.map((e) => ({ grain: `${e.fy}|${e.person}`, value: e.result_cents })) : []),
  "tax.readiness": (L) => (L.readiness || []).map((r) => ({ grain: `${r.fy}|${r.person}`, value: r.pct })),
  "things.refresh_due": (L) => L.refresh.filter((r) => r.refresh_by).map((r) => ({ grain: `${r.fy}|${r.asset_id}`, value: r.replacement_cost_cents })),
  "bills.committed": (L) => { const b = V.billsCommitted(L, lastMonth(L)); return [{ grain: b.month, value: b.total_cents }]; },
  "evidence.coverage": (L) => L.coverage.map((c) => ({ grain: c.stream_id, value: +c.ratio.toFixed(3) })),
  "forecast.cash": (L) => forecastCash(L, "SCN-BASE", lastMonth(L), 12).map((r) => ({ grain: `SCN-BASE|${r.month}`, value: r.cash_cents, grade: "estimated" })),
  "forecast.tax": () => [],
  "advice.tax_return": () => [],
};

function wageByFy(L, field) {
  const m = new Map();
  for (const e of L.events) if (e.kind === "wage") { const k = `${fyOf(e.occurred_on)}|${e.person}`; m.set(k, (m.get(k) || 0) + e.fields[field]); }
  return [...m].map(([grain, value]) => ({ grain, value }));
}
const taxField = (L, f) => (L.tax ? L.tax.estimates.map((e) => ({ grain: `${e.fy}|${e.person}`, value: e[f] })) : []);

/* The experimental baseline: from a month, roll cash forward by the last three months' average net. Stored with its as_of so it can
   be scored against what happened, which is the only thing that would make it stable. */
function forecastCash(L, scenario, asOf, horizon) {
  const hist = L.cash.filter((m) => m.month <= asOf).slice(-3);
  const avg = hist.length ? Math.round(hist.reduce((s, m) => s + m.net, 0) / hist.length) : 0;
  const start = (L.netWorth.find((r) => r.month === asOf) || { groups: {} }).groups.cash || 0;
  const months = []; let m = asOf, cash = start;
  for (let i = 0; i < horizon; i++) { const [y, mo] = m.split("-").map(Number); m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`; cash += avg; months.push({ scenario, as_of: asOf, month: m, cash_cents: cash }); }
  return months;
}
function backtest(L, asOf, horizon = 12) {
  const fc = forecastCash(L, "backtest", asOf, horizon);
  const actual = new Map(L.netWorth.map((r) => [r.month, r.groups.cash || 0]));
  const rows = fc.filter((r) => actual.has(r.month)).map((r) => ({ month: r.month, forecast: r.cash_cents, actual: actual.get(r.month), error: r.cash_cents - actual.get(r.month) }));
  return { as_of: asOf, rows, mean_abs_error_cents: rows.length ? Math.round(rows.reduce((s, r) => s + Math.abs(r.error), 0) / rows.length) : null };
}

function allMetrics(L, schema) {
  const lawFailed = new Set(L.checks.filter((c) => c.status === "fail").map((c) => c.law));
  const rows = [];
  for (const [id, def] of Object.entries(schema.metrics)) {
    const f = REGISTRY[id];
    if (!f) throw new Error(`metric ${id} has no implementation`);
    const held = (def.laws || []).some((x) => lawFailed.has(x));
    for (const r of f(L)) {
      const grade = r.grade || (def.stability === "experimental" ? "estimated" : held ? "held" : "derived");
      rows.push({ metric_id: id, grain: r.grain, value: String(r.value), grade, valid_on: L.asOf, known_at: L.asOf });
    }
  }
  return rows;
}
module.exports = { REGISTRY, allMetrics, forecastCash, backtest };
