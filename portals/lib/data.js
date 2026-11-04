// The one source the portals serve: data/months.json, built by build-data.py from the sheet and the simulator.
"use strict";
const D = require("../data/months.json");
const BRANDS = require("../public/brands.json");

const brandById = Object.fromEntries(BRANDS.map((b) => [b.id, b]));
const accountById = Object.fromEntries(D.accounts.map((a) => [a.id, a]));
const lastMonth = D.months[D.months.length - 1];
const monthEnd = (m) => { const [y, mo] = m.split("-").map(Number); return `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, "0")}`; };
const addDays = (iso, n) => new Date(Date.parse(iso) + n * 864e5).toISOString().slice(0, 10);
const today = addDays(monthEnd(lastMonth), 2); // the demo's clock: two days after the last month the portals hold
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const fmtMonth = (m) => `${MONTH_NAMES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const fmtDate = (iso) => { const [y, m, d] = iso.split("-"); return `${Number(d)} ${MONTH_NAMES[Number(m) - 1].slice(0, 3)} ${y}`; };
const fyStart = (iso) => (iso.slice(5, 7) >= "07" ? `${iso.slice(0, 4)}-07-01` : `${Number(iso.slice(0, 4)) - 1}-07-01`);

const txRows = (accountId, from, to) => D.transactions.filter((t) => t[1] === accountId && t[0] >= from && t[0] <= to);
const balanceBefore = (accountId, from) => {
  const a = accountById[accountId];
  let bal = a.opening_balance;
  for (const t of D.transactions) if (t[1] === accountId && t[0] < from) bal = round2(bal + t[3]);
  return bal;
};
const round2 = (n) => { const r = Math.round(n * 100) / 100; return Object.is(r, -0) ? 0 : r; };

// What each brand lists. Banks list the sheet's accounts at their institution (and Westpaw the loans it lends);
// the other portals list properties, employments and policies.
const accountsFor = (brandId) => {
  const b = brandById[brandId];
  if (!b) return [];
  const out = [];
  if (b.institution) {
    for (const a of D.accounts.filter((x) => x.institution === b.institution)) {
      out.push({ id: a.id, kind: "bank", name: a.name, number: a.number, type: a.type, owner: a.owner, in_sheet: a.in_sheet, note: a.note || "",
        balance: balanceBefore(a.id, addDays(monthEnd(lastMonth), 1)), formats: [["csv", `Transactions (CSV, ${b.csvName})`], ["pdf", "Statement (PDF)"]] });
    }
  }
  if (b.loans) {
    for (const [id, l] of Object.entries(D.loans)) {
      const last = l.months[lastMonth];
      out.push({ id, kind: "loan", name: l.name, number: l.number, type: `${l.repayment_type}, ${(l.rate * 100).toFixed(2)}% p.a.`, owner: "Joint", in_sheet: true,
        balance: -last.closing, formats: [["pdf", "Loan statement (PDF)"], ["csv", "Loan transactions (CSV)"]] });
    }
  }
  if (b.kind === "property") {
    for (const [id, p] of Object.entries(D.properties)) {
      out.push({ id, kind: "property", name: p.name, number: p.address, type: "Managed property", owner: "Joint", in_sheet: true,
        balance: null, formats: [["pdf", "Owner statement (PDF)"], ["csv", "Owner statement lines (CSV)"]] });
    }
  }
  if (b.kind === "payroll") {
    for (const e of D.employments) {
      out.push({ id: `${e.person}@${e.employer}`, kind: "payroll", name: `${e.person}, ${e.employer}`, number: `Employee ${e.person.toUpperCase()}-${e.employer.replace(/\W/g, "").slice(0, 4).toUpperCase()}`, type: "Fortnightly pay", owner: e.person, in_sheet: true,
        balance: null, formats: [["pdf", "Payslips (PDF)"], ["csv", "Payslips (CSV, the period-close shape)"]] });
    }
  }
  if (b.kind === "policy") {
    for (const p of D.policies) {
      out.push({ id: p.id, kind: "policy", name: `${p.name}, ${p.property_name}`, number: p.address, type: "Annual policy", owner: "Joint", in_sheet: true,
        balance: null, formats: [["renewal", "Renewal notice (PDF)"], ["certificate", "Certificate of currency (PDF)"]] });
    }
  }
  return out;
};

// Period presets: calendar months newest first, the financial year to date, and for the card the statement periods.
const presets = (brandId, kind, accountId) => {
  const b = brandById[brandId];
  const months = [...D.months].reverse();
  if (kind === "policy") {
    const p = D.policies.find((x) => x.id === accountId);
    return (p ? [...p.periods].reverse() : []).map((per) => ({ label: `Policy period ${fmtDate(per.from)} to ${fmtDate(per.to)}`, from: per.from, to: per.to }));
  }
  const out = [];
  if (b.kind === "card") {
    const closes = String(b.statementCloses).padStart(2, "0");
    for (const m of months) {
      const prev = D.months[D.months.indexOf(m) - 1];
      if (!prev) continue;
      out.push({ label: `Statement closing ${fmtDate(`${m}-${closes}`)}`, from: addDays(`${prev}-${closes}`, 1), to: `${m}-${closes}` });
    }
  }
  for (const m of months) out.push({ label: fmtMonth(m), from: `${m}-01`, to: monthEnd(m) });
  out.push({ label: "Financial year to date", from: fyStart(monthEnd(lastMonth)), to: monthEnd(lastMonth) });
  return out;
};

const validDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "") && !Number.isNaN(Date.parse(s));

module.exports = { D, BRANDS, brandById, accountById, lastMonth, today, monthEnd, addDays, fmtMonth, fmtDate, fyStart, txRows, balanceBefore, round2, accountsFor, presets, validDate };
