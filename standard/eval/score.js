/* Scoring: what the rebuild produced against what the world knows. The oracle has two parts: the world's own truth,
   and figures Google Sheets formulas computed independently (copied into truth/sheet_oracle.json, never recomputed). */
"use strict";
const fs = require("fs"), path = require("path");
const { monthEnd, monthOf, fyOf } = require("../engine/util");
const V = require("../engine/views");

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const tryJson = (p) => { try { return readJson(p); } catch (e) { return null; } };
const toCents = (v) => Math.round(Number(v) * 100);

function cmp(name, pairs, tolerance = 0) {
  let exact = 0; const misses = [];
  for (const [key, want, got] of pairs) {
    if (Math.abs((want || 0) - (got || 0)) <= tolerance) exact += 1;
    else misses.push({ key, want, got, gap: (got || 0) - (want || 0) });
  }
  misses.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
  return { name, checked: pairs.length, exact, pct: pairs.length ? Math.round((exact / pairs.length) * 10000) / 100 : null, worst: misses.slice(0, 5), absGap: misses.reduce((s, m) => s + Math.abs(m.gap), 0) };
}

function score(L, worldRoot) {
  const T = (f) => tryJson(path.join(worldRoot, "truth", f));
  const out = { sections: [] };
  const add = (s) => { if (s && s.checked) out.sections.push(s); };

  const txn = T("txn_by_month.json");
  if (txn) {
    const counts = [], closes = [];
    const byMonth = new Map();
    for (const l of L.lines) { const k = `${l.account}|${monthOf(l.date)}`; byMonth.set(k, (byMonth.get(k) || 0) + 1); }
    for (const [account, months] of Object.entries(txn)) for (const [m, r] of Object.entries(months)) {
      if (r.count != null) counts.push([`${account} ${m}`, r.count, byMonth.get(`${account}|${m}`) || 0]);
      if (r.closing_cents != null) closes.push([`${account} ${m}`, r.closing_cents, L.dailyBalance(account)(monthEnd(m))]);
    }
    add(cmp("lines recovered per account per month", counts));
    add(cmp("closing balance per account per month", closes));
  }
  const oracle = T("sheet_oracle.json");
  if (oracle) {
    // Beta rows on the sheet are fixtures left out of its own net worth, so they are out of this comparison too.
    const active = (oracle.balances || []).filter((b) => b.status !== "beta");
    const sheetAccounts = [...new Set(active.map((b) => b.account_id))];
    const cashAccounts = sheetAccounts.filter((a) => (L.index.accounts.get(a) || {}).reporting_group === "cash");
    const cash = new Map(V.cashLens(L, { accounts: cashAccounts }).map((r) => [r.month, r]));
    const inc = [], sp = [], nt = [];
    for (const r of oracle.cashflow || []) {
      const c = cash.get(String(r.month).slice(0, 7)) || {};
      inc.push([`income ${r.month}`, toCents(r.income), c.income]);
      sp.push([`spending ${r.month}`, toCents(r.spending), c.spending]);
      nt.push([`net ${r.month}`, toCents(r.net), c.net]);
    }
    add(cmp("sheet oracle: cash income by month", inc, 1));
    add(cmp("sheet oracle: cash spending by month", sp, 1));
    add(cmp("sheet oracle: cash net by month", nt, 1));
    const bal = [];
    for (const b of active) {
      if (!L.index.accounts.get(b.account_id)) continue;
      bal.push([`${b.account_id} ${b.month_end}`, toCents(b.balance), L.dailyBalance(b.account_id)(b.month_end)]);
    }
    add(cmp("sheet oracle: balance per account per month", bal, 1));
    const nw = new Map(V.netWorth(L, { accounts: sheetAccounts }).map((r) => [r.month_end, r]));
    add(cmp("sheet oracle: net worth by month", (oracle.networth || []).map((r) => [r.month_end, toCents(r.net_worth), (nw.get(r.month_end) || {}).total]), 1));
  }
  const loans = T("loans.json");
  if (loans) {
    const interest = [];
    const ev = new Map();
    for (const e of L.events) if (e.kind === "loan_interest") { const k = `${e.contract_id}|${monthOf(e.occurred_on)}`; ev.set(k, (ev.get(k) || 0) + e.amount_cents); }
    const contractOf = new Map(L.contracts.filter((c) => c.kind === "loan").map((c) => [c.account_id, c.contract_id]));
    for (const [loan, rows] of Object.entries(loans)) for (const r of rows) if (r.interest_cents != null) interest.push([`${loan} ${r.month}`, r.interest_cents, ev.get(`${contractOf.get(loan)}|${r.month}`) || 0]);
    add(cmp("loan interest per month", interest));
  }
  const pays = T("payslips.json");
  if (pays) {
    const wage = new Map();
    for (const e of L.events) if (e.kind === "wage") { const k = `${e.person}|${monthOf(e.occurred_on)}`; wage.set(k, (wage.get(k) || 0) + e.amount_cents); }
    const tot = new Map();
    const rows = Array.isArray(pays) ? pays : pays.rows || [];
    for (const r of rows) { const k = `${String(r.person_id || r.person).toUpperCase()}|${String(r.pay_date).slice(0, 7)}`; tot.set(k, (tot.get(k) || 0) + (r.gross_cents || 0)); }
    add(cmp("gross wages per person per month", [...tot].map(([k, v]) => [k, v, wage.get(k) || 0])));
  }
  const sup = T("super.json");
  if (sup) {
    const pairs = [];
    for (const [account, rows] of Object.entries(sup.months)) for (const r of rows) pairs.push([`${account} ${r.month}`, r.closing_cents, L.dailyBalance(account)(monthEnd(r.month))]);
    add(cmp("super: fund balance per month", pairs));
    const byType = new Map();
    for (const e of L.events) if (/^super_/.test(e.kind) && e.superType) {
      const a = e.refs.account; const fy = fyOf(e.occurred_on);
      const k = `${a}|${fy}|${e.superType}`;
      byType.set(k, (byType.get(k) || 0) + e.amount_cents);
    }
    const contrib = T("super_contributions.json") || {};
    const typed = [];
    for (const [a, years] of Object.entries(contrib)) for (const [fy, types] of Object.entries(years)) for (const [t, v] of Object.entries(types)) typed.push([`${a} ${fy} ${t}`, v, byType.get(`${a}|${fy}|${t}`) || 0]);
    add(cmp("super: contributions, earnings and costs by type by year", typed));
  }
  const holdings = T("holdings.json");
  if (holdings) {
    const pairs = [];
    for (const [date, rows] of Object.entries(holdings)) for (const [code, r] of Object.entries(rows)) pairs.push([`${code} ${date}`, Math.round(Number(r.units) * 1e4), Math.round(Number(L.resolver.unitsOn(code, date)) / 1e4)]);
    add(cmp("holdings: units per instrument per statement", pairs));
  }
  const lots = T("lots.json");
  if (lots) {
    const pairs = [];
    for (const [code, rows] of Object.entries(lots.instruments)) {
      const held = new Map();
      // Truth lists what is still held, so a parcel part-sold shows the cost left in it.
      for (const l of L.lotRows.filter((x) => x.instrument_id === code && x.units_open > 0n)) held.set(l.acquired_on, (held.get(l.acquired_on) || 0) + l.cost_price_cents + l.cost_incidental_cents);
      const want = new Map();
      for (const r of rows) want.set(r.date, (want.get(r.date) || 0) + r.cost);
      for (const [d, c] of want) pairs.push([`${code} ${d}`, c, held.get(d) || 0]);
    }
    add(cmp("lots: cost of each parcel", pairs));
  }
  const cgt = T("cgt.json");
  if (cgt && L.tax) {
    const pairs = [];
    const item = new Map(L.tax.items.map((i) => [`${i.party_id}|${i.fy}|${i.label}`, i.amount_cents]));
    for (const [p, years] of Object.entries(cgt)) for (const [fy, r] of Object.entries(years)) pairs.push([`${p} ${fy}`, r.net_capital_gain_cents, item.get(`${p}|${fy}|18A`) || 0]);
    add(cmp("capital gains: net gain per person per year", pairs, 100));
  }
  const notices = T("rate_notices.json");
  if (notices) {
    const pairs = [];
    const { termAt } = require("../engine/temporal");
    const pct = (v) => Math.round(Number(v) * 100);
    for (const n of notices) {
      // what was believed the day it was notified
      pairs.push([`${n.contract} ${n.effective_on} as known ${n.notified_on}`, pct(n.value), pct(termAt(L.termIdx, "contract", n.contract, "interest_rate", n.effective_on, n.notified_on))]);
      // and what is believed now, which a later correction can change
      const later = notices.filter((x) => x.contract === n.contract && x.effective_on <= n.effective_on).sort((a, b) => (a.notified_on < b.notified_on ? 1 : a.notified_on > b.notified_on ? -1 : a.effective_on < b.effective_on ? 1 : -1))[0];
      pairs.push([`${n.contract} ${n.effective_on} as known now`, pct(later.value), pct(termAt(L.termIdx, "contract", n.contract, "interest_rate", n.effective_on))]);
    }
    add(cmp("rates: the rate on each date, as known then and as known now", pairs));
  }
  const vals = T("valuations.json");
  if (vals) {
    const pairs = [];
    const acct = (subject) => { const a = L.assets.find((x) => x.asset_id === subject); return a ? a.account_id : subject; };
    for (const v of vals) if (L.index.accounts.get(acct(v.subject))) pairs.push([`${v.subject} ${v.as_at}`, v.value_cents, L.dailyBalance(acct(v.subject))(v.as_at)]);
    add(cmp("valuations: carried value on each dated value", pairs));
  }
  const assets = T("assets.json");
  if (assets) {
    const m = new Map();
    for (const r of L.refresh) if (r.fy && r.replacement_cost_cents != null) m.set(r.fy, (m.get(r.fy) || 0) + r.replacement_cost_cents);
    add(cmp("things: replacement cost falling due per year", Object.entries(assets.refresh_by_fy).map(([fy, r]) => [fy, r.cents, m.get(fy) || 0])));
  }
  const bills = T("bills.json");
  if (bills) {
    const seen = new Map();
    for (const e of L.events) for (const w of e.witnesses || []) if (L.obsKind && L.obsKind.get(w.obs_id) === "bill" && e.line) seen.set(`${e.line.account}|${e.line.date}|${e.line.cents}`, (seen.get(`${e.line.account}|${e.line.date}|${e.line.cents}`) || 0) + 1);
    const pairs = bills.filter((b) => b.line).map((b) => [`${b.kind} ${b.bill_date}`, 1, seen.get(b.line.join("|")) ? 1 : 0]);
    add(cmp("bills: each attached to its bank line", pairs));
  }
  const tax = T("tax.json");
  if (tax && L.tax) {
    const taxable = [], labels = [];
    const est = new Map(L.tax.estimates.map((e) => [`${e.person}|${e.fy}`, e]));
    const items = new Map(L.tax.items.map((i) => [`${i.party_id}|${i.fy}|${i.label}`, i.amount_cents]));
    for (const [person, years] of Object.entries(tax)) for (const [fy, row] of Object.entries(years)) {
      taxable.push([`${person} ${fy}`, row.taxable_income_cents, (est.get(`${person}|${fy}`) || {}).taxable_income_cents]);
      for (const [label, cents] of Object.entries(row)) if (/^(\d|D\d)/.test(label) && Number.isInteger(cents)) labels.push([`${person} ${fy} ${label}`, Math.trunc(cents / 100) * 100, Math.trunc((items.get(`${person}|${fy}|${label}`) || 0) / 100) * 100]);
    }
    add(cmp("tax: taxable income per person per year", taxable, 100));
    add(cmp("tax: every return label per person per year", labels, 100));
    const results = [];
    for (const [person, years] of Object.entries(tax)) for (const [fy, row] of Object.entries(years)) {
      const e = est.get(`${person}|${fy}`) || {};
      if (e.gross_tax_cents == null) continue;
      results.push([`gross tax ${person} ${fy}`, row.gross_tax_cents, e.gross_tax_cents]);
      results.push([`refund or payable ${person} ${fy}`, row.result_cents, e.result_cents]);
    }
    add(cmp("tax: gross tax and the result, against the assessment, within 99 cents", results, 99));
  }
  // Base truth: the category the world gave every bank line. Conservation cannot catch a wrong category, so this is where it is caught.
  const months = tryJson(path.join(worldRoot, "..", "..", "..", "portals", "data", "months.json"));
  if (months) {
    const want = new Map();
    for (const [date, account, desc, amount, category] of months.transactions) { const k = `${account}|${date}|${Math.round(amount * 100)}`; if (!want.has(k)) want.set(k, []); want.get(k).push({ desc, category }); }
    const byLine = new Map();
    for (const e of L.events) { if (e.line) byLine.set(e.line.key, e); for (const l of e.lines || []) byLine.set(l.key, e); }
    let right = 0, total = 0; const wrong = [];
    for (const l of L.lines) {
      const list = want.get(`${l.account}|${l.date}|${l.cents}`);
      const e = byLine.get(l.key);
      if (!list || !list.length || !e) continue;
      const i = Math.max(list.findIndex((x) => x.desc === l.desc), 0);
      const t = list.splice(i, 1)[0];
      if (t.category === "UNCAT") continue;                 // the world's own UNCAT lines have no true category to score
      total += 1;
      if (e.category_id === t.category) right += 1; else if (wrong.length < 8) wrong.push({ key: l.key, want: t.category, got: e.category_id, gap: 0, desc: l.desc });
    }
    out.sections.push({ name: "category of each bank line", checked: total, exact: right, pct: total ? Math.round((right / total) * 10000) / 100 : null, worst: wrong, absGap: 0 });
  }
  const laws = {};
  for (const c of L.checks) { laws[c.law] = laws[c.law] || { pass: 0, fail: 0, gap: 0, open: 0, skip: 0, accepted: 0 }; laws[c.law][c.status] += 1; }
  out.laws = laws;
  out.failures = L.checks.filter((c) => c.status === "fail").slice(0, 40);
  out.review = { items: L.review.length, byKind: L.review.reduce((m, r) => { m[r.kind] = (m[r.kind] || 0) + 1; return m; }, {}) };
  out.clearing = [...L.balances.table.entries()].filter(([a]) => a.startsWith("clearing:")).map(([a, s]) => [a, s.get(L.balances.months[L.balances.months.length - 1]) || 0]).filter(([, v]) => v);
  return out;
}

function printScore(s) {
  const pad = (x, n) => String(x).padEnd(n);
  for (const r of s.sections) {
    console.log(`${pad(r.name, 52)} ${String(r.exact).padStart(6)}/${String(r.checked).padEnd(6)} ${r.pct}%${r.absGap ? `   off by ${(r.absGap / 100).toFixed(2)}` : ""}`);
  }
  console.log("\nLaws: " + Object.entries(s.laws).map(([k, v]) => `${k} ${v.fail ? "FAIL×" + v.fail : v.gap ? "gap×" + v.gap : v.pass ? "pass" : v.open ? "open" : "skip"}`).join("  "));
  console.log(`Review items: ${s.review.items}  ${JSON.stringify(s.review.byKind)}`);
  if (s.clearing.length) console.log(`Open clearing: ${s.clearing.map(([a, v]) => `${a} ${(v / 100).toFixed(2)}`).join("; ")}`);
}
module.exports = { score, printScore, cmp };
