// The one source the portals serve: data/months.json, built by build-data.py from history.py, the sheet and the simulator.
"use strict";
const D = require("../data/months.json");
const BRANDS = [...require("../public/brands.json"), ...require("../public/vault-brands.json")];

const brandById = Object.fromEntries(BRANDS.map((b) => [b.id, b]));
const accountById = Object.fromEntries(D.accounts.map((a) => [a.id, a]));
const lastMonth = D.months[D.months.length - 1];
const monthEnd = (m) => { const [y, mo] = m.split("-").map(Number); return `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, "0")}`; };
const addDays = (iso, n) => new Date(Date.parse(iso) + n * 864e5).toISOString().slice(0, 10);
const today = addDays(monthEnd(lastMonth), 2); // the demo's clock: two days after the last month the portals hold
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const fmtMonth = (m) => `${MONTH_NAMES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const fmtDate = (iso) => { const [y, m, d] = iso.split("-"); return `${Number(d)} ${MONTH_NAMES[Number(m) - 1].slice(0, 3)} ${y}`; };
const fyOf = (iso) => Number(iso.slice(0, 4)) + (iso.slice(5, 7) >= "07" ? 1 : 0); // FY2025 = 1 Jul 2024 to 30 Jun 2025
const fyStart = (iso) => `${fyOf(iso) - 1}-07-01`;
const fyEnd = (iso) => `${fyOf(iso)}-06-30`;
const fyLabel = (fy) => `FY${fy - 1}-${String(fy).slice(2)}`;
const round2 = (n) => { const r = Math.round(n * 100) / 100; return Object.is(r, -0) ? 0 : r; };

// per-account indexes, built once
const byAccount = {};
for (const t of D.transactions) (byAccount[t[1]] = byAccount[t[1]] || []).push(t);
const txRows = (accountId, from, to) => (byAccount[accountId] || []).filter((t) => t[0] >= from && t[0] <= to);
const balanceBefore = (accountId, from) => {
  const a = accountById[accountId];
  let bal = a.opening_balance;
  for (const t of byAccount[accountId] || []) if (t[0] < from) bal = round2(bal + t[3]);
  return bal;
};
const balanceAt = (accountId, to) => balanceBefore(accountId, addDays(to, 1));
const monthsOf = (first, last) => D.months.filter((m) => m >= first && m <= last);
const fysBetween = (fromIso, toIso) => { const out = []; for (let fy = fyOf(toIso); fy >= fyOf(fromIso); fy--) out.push(fy); return out; };

// What each brand lists. Banks list the sheet's accounts at their institution (and Westpaw the loans it lends);
// the other portals list properties, employments and policies.
const accountsFor = (brandId) => {
  const b = brandById[brandId];
  if (!b) return [];
  const out = [];
  const asAt = monthEnd(lastMonth);
  if (b.institution) {
    for (const a of D.accounts.filter((x) => x.institution === b.institution)) {
      out.push({ id: a.id, kind: "bank", name: a.name, number: a.number, type: a.type, owner: a.owner, opened: a.opened, from: a.opening_date, in_sheet: a.in_sheet, note: a.note || "",
        balance: balanceAt(a.id, asAt), as_at: asAt, formats: [["csv", `Transactions (CSV, ${b.csvName})`], ["pdf", "Statement (PDF)"]] });
    }
  }
  if (b.loans) {
    for (const [id, l] of Object.entries(D.loans)) {
      const last = l.months[lastMonth];
      out.push({ id, kind: "loan", name: l.name, number: l.number, type: `${l.repayment_type}, ${last.rate.toFixed(2)}% p.a.`, owner: "Joint", opened: l.opened, from: `${Object.keys(l.months).sort()[0]}-01`, in_sheet: true,
        balance: -last.closing, as_at: asAt, formats: [["pdf", "Loan statement (PDF)"], ["csv", "Loan transactions (CSV)"]] });
    }
  }
  if (b.kind === "property") {
    for (const [id, p] of Object.entries(D.properties)) {
      out.push({ id, kind: "property", name: p.name, number: p.address, type: `Managed since ${fmtDate(p.managed_from)} · owner ref ${p.owner_ref}`, owner: "Joint", opened: p.acquired, from: p.acquired, in_sheet: true,
        balance: null, as_at: asAt, formats: [["pdf", "Owner statement (PDF)"], ["csv", "Owner statement lines (CSV)"]] });
    }
  }
  if (b.kind === "payroll") {
    for (const e of D.employments) {
      const mine = D.payslips.filter((p) => p[1] === e.person && p[2] === e.employer);
      out.push({ id: `${e.person}@${e.employer}`, kind: "payroll", name: `${e.person} Davies`, number: e.employer, type: `Employee ${e.person.toUpperCase().slice(0, 3)}-${String(1000 + mine.length)} · fortnightly`, owner: e.person, opened: mine[0][0], from: mine[0][0], in_sheet: true,
        balance: null, as_at: asAt, formats: [["pdf", "Payslips (PDF)"], ["csv", "Payslips (CSV, the period-close shape)"], ["income", "Income statement for the financial year (PDF)"]] });
    }
  }
  if (b.kind === "policy") {
    for (const p of D.policies) {
      out.push({ id: p.id, kind: "policy", name: `${p.name}`, number: p.address, type: `${p.property_name} · since ${fmtDate(p.periods[0].from)}`, owner: "Joint", opened: p.periods[0].from, from: p.periods[0].from, in_sheet: true,
        balance: null, as_at: asAt, formats: [["renewal", "Renewal notice (PDF)"], ["certificate", "Certificate of currency (PDF)"]] });
    }
  }
  return out;
};

// Period presets: every financial year, the last two years of months, the card's statement periods, all history.
const presets = (brandId, kind, accountId) => {
  const b = brandById[brandId];
  const acct = accountsFor(brandId).find((a) => a.id === accountId);
  if (!acct) return [];
  if (kind === "policy") {
    const p = D.policies.find((x) => x.id === accountId);
    return [...p.periods].reverse().map((per) => ({ label: `Policy period ${fmtDate(per.from)} to ${fmtDate(per.to)}`, from: per.from, to: per.to }));
  }
  const first = acct.from, last = monthEnd(lastMonth);
  const out = [];
  out.push({ label: `Last 90 days`, from: addDays(last, -89), to: last });
  for (const fy of fysBetween(first, last)) out.push({ label: `Financial year ${fyLabel(fy)}`, from: `${fy - 1}-07-01` < first ? first : `${fy - 1}-07-01`, to: `${fy}-06-30` > last ? last : `${fy}-06-30`, fy });
  if (b.kind === "card") {
    const closes = String(b.statementCloses).padStart(2, "0");
    for (const m of [...monthsOf(first.slice(0, 7), lastMonth)].reverse()) {
      const prev = D.months[D.months.indexOf(m) - 1];
      if (!prev || `${m}-${closes}` < first) continue;
      out.push({ label: `Statement closing ${fmtDate(`${m}-${closes}`)}`, from: addDays(`${prev}-${closes}`, 1), to: `${m}-${closes}`, statement: true });
    }
  }
  for (const m of [...monthsOf(first.slice(0, 7), lastMonth)].reverse().slice(0, 24)) out.push({ label: fmtMonth(m), from: `${m}-01` < first ? first : `${m}-01`, to: monthEnd(m), month: m });
  out.push({ label: `Everything since ${fmtDate(first)}`, from: first, to: last });
  return out;
};

// The documents a portal keeps: statements by month, summaries by financial year, payslips by pay date, renewals by period.
const documents = (brandId, accountId) => {
  const b = brandById[brandId];
  const acct = accountsFor(brandId).find((a) => a.id === accountId);
  if (!acct) return [];
  const last = monthEnd(lastMonth);
  const groups = {};
  const put = (iso, doc) => { const k = fyLabel(fyOf(iso)); (groups[k] = groups[k] || []).push(doc); };
  if (acct.kind === "bank" || acct.kind === "loan") {
    for (const m of [...monthsOf(acct.from.slice(0, 7), lastMonth)].reverse()) {
      const from = `${m}-01` < acct.from ? acct.from : `${m}-01`;
      put(from, { label: `${fmtMonth(m)} statement`, kind: "statement", from, to: monthEnd(m), formats: [["pdf", "PDF"], ["csv", "CSV"]] });
    }
    if (acct.kind === "loan") for (const fy of fysBetween(acct.from, last)) put(`${fy}-06-30` > last ? last : `${fy}-06-30`, { label: `Interest summary ${fyLabel(fy)}`, kind: "summary", from: `${fy - 1}-07-01` < acct.from ? acct.from : `${fy - 1}-07-01`, to: `${fy}-06-30` > last ? last : `${fy}-06-30`, formats: [["pdf", "PDF"]] });
  }
  if (acct.kind === "property") {
    for (const fy of fysBetween(acct.from, last)) put(`${fy}-06-30` > last ? last : `${fy}-06-30`, { label: `End of financial year statement ${fyLabel(fy)}`, kind: "summary", from: `${fy - 1}-07-01` < acct.from ? acct.from : `${fy - 1}-07-01`, to: `${fy}-06-30` > last ? last : `${fy}-06-30`, formats: [["pdf", "PDF"], ["csv", "CSV"]] });
    for (const m of [...monthsOf(acct.from.slice(0, 7), lastMonth)].reverse()) put(`${m}-01` < acct.from ? acct.from : `${m}-01`, { label: `${fmtMonth(m)} owner statement`, kind: "statement", from: `${m}-01` < acct.from ? acct.from : `${m}-01`, to: monthEnd(m), formats: [["pdf", "PDF"], ["csv", "CSV"]] });
  }
  if (acct.kind === "payroll") {
    const [person, employer] = accountId.split("@");
    const mine = D.payslips.filter((p) => p[1] === person && p[2] === employer);
    for (const fy of fysBetween(mine[0][0], last)) {
      const to = `${fy}-06-30` > last ? last : `${fy}-06-30`;
      put(to, { label: `Income statement ${fyLabel(fy)}${to < `${fy}-06-30` ? " (year to date)" : ""}`, kind: "summary", from: `${fy - 1}-07-01`, to, formats: [["income", "PDF"], ["csv", "payslips.csv"]] });
    }
    for (const p of [...mine].reverse()) put(p[0], { label: `Payslip ${fmtDate(p[0])}`, kind: "payslip", from: p[0], to: p[0], formats: [["pdf", "PDF"]] });
  }
  if (acct.kind === "policy") {
    const p = D.policies.find((x) => x.id === accountId);
    for (const per of [...p.periods].reverse()) {
      put(per.from, { label: `Renewal notice, period from ${fmtDate(per.from)}`, kind: "renewal", from: per.from, to: per.to, formats: [["renewal", "PDF"]] });
      put(per.from, { label: `Certificate of currency, period from ${fmtDate(per.from)}`, kind: "certificate", from: per.from, to: per.to, formats: [["certificate", "PDF"]] });
    }
  }
  return Object.entries(groups).sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([group, docs]) => ({ group, docs }));
};

const validDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "") && !Number.isNaN(Date.parse(s));

module.exports = { D, BRANDS, brandById, accountById, lastMonth, today, monthEnd, addDays, fmtMonth, fmtDate, fyOf, fyStart, fyEnd, fyLabel, txRows, balanceBefore, balanceAt, round2, accountsFor, presets, documents, validDate };
