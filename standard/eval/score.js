/* Scoring: what the rebuild produced against what the world knows. The oracle has two parts: the world's own truth,
   and figures Google Sheets formulas computed independently (copied into truth/sheet_oracle.json, never recomputed). */
"use strict";
const fs = require("fs"), path = require("path");
const { monthEnd, monthOf } = require("../engine/util");
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
    const sheetAccounts = [...new Set((oracle.balances || []).map((b) => b.account_id))];
    const cashAccounts = sheetAccounts.filter((a) => (L.index.accounts.get(a) || {}).reporting_group === "cash");
    const cash = new Map(V.cashLens(L, { accounts: cashAccounts }).map((r) => [r.month, r]));
    const inc = [], sp = [], nt = [];
    for (const r of oracle.cashflow || []) {
      const c = cash.get(r.month) || {};
      inc.push([`income ${r.month}`, toCents(r.income), c.income]);
      sp.push([`spending ${r.month}`, toCents(r.spending), c.spending]);
      nt.push([`net ${r.month}`, toCents(r.net), c.net]);
    }
    add(cmp("sheet oracle: cash income by month", inc, 1));
    add(cmp("sheet oracle: cash spending by month", sp, 1));
    add(cmp("sheet oracle: cash net by month", nt, 1));
    const bal = [];
    for (const b of oracle.balances || []) {
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
  const cats = T("categories.json");
  if (cats) {
    let right = 0, total = 0; const wrong = [];
    const byKey = new Map(L.lines.map((l) => [`${l.account}|${l.date}|${l.cents}|${l.key.split("|")[3]}`, l]));
    for (const t of cats) {
      const l = byKey.get(`${t.account}|${t.date}|${t.cents}|${t.n || 1}`);
      if (!l) continue;
      total += 1;
      const ev = L.lineEvent ? L.lineEvent(l) : null;
      const got = ev ? ev.category_id : l.cls.category_id;
      if (got === t.category_id) right += 1; else if (wrong.length < 8) wrong.push({ key: l.key, want: t.category_id, got, desc: l.desc });
    }
    out.sections.push({ name: "category of each line", checked: total, exact: right, pct: total ? Math.round((right / total) * 10000) / 100 : null, worst: wrong, absGap: 0 });
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
