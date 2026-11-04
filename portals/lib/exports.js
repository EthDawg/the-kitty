// Turn (brand, account, from, to, format) into a file: name, content type, bytes. Used by api/export.js.
"use strict";
const S = require("./shapes");
const P = require("./pdf");
const { D, brandById, accountById, accountsFor, presets, txRows, balanceBefore, validDate, today, monthEnd } = require("./data");

class ExportError extends Error { constructor(status, message) { super(message); this.status = status; } }
const CSV = "text/csv; charset=utf-8", PDF = "application/pdf";
const ymd = (iso) => iso.replace(/-/g, "");
const monthsBetween = (from, to) => D.months.filter((m) => `${m}-01` <= to && monthEnd(m) >= from);

async function buildExport({ brand: brandId, account: accountId, from, to, format }) {
  const brand = brandById[brandId];
  if (!brand) throw new ExportError(404, "No such portal.");
  const account = accountsFor(brandId).find((a) => a.id === accountId);
  if (!account) throw new ExportError(404, "No such account on this portal.");
  if (!account.formats.some(([f]) => f === format)) throw new ExportError(400, "That format is not offered for this account.");
  if (account.kind === "policy") {
    const policy = D.policies.find((p) => p.id === accountId);
    const per = policy.periods.find((p) => p.from === from && p.to === to) || policy.periods[policy.periods.length - 1];
    const year = per.from.slice(0, 4);
    if (format === "renewal") return { filename: `${brand.name}-RenewalNotice-${policy.property}-${year}.pdf`, type: PDF, body: await P.renewalNotice({ brand, policy, per }) };
    return { filename: `${brand.name}-CertificateOfCurrency-${policy.property}-${year}.pdf`, type: PDF, body: await P.certificate({ brand, policy, per }) };
  }
  if (!validDate(from) || !validDate(to) || from > to) throw new ExportError(400, "Pick a date range: from and to as YYYY-MM-DD, from no later than to.");
  if (to > today) throw new ExportError(400, `Nothing after ${today} yet.`);
  if (account.kind === "bank") {
    const rows = txRows(accountId, from, to).map((t) => [t[0], t[2], t[3]]);
    const opening = balanceBefore(accountId, from);
    if (format === "csv") {
      const body = brand.shape === "westpac" ? S.westpac(account.number, rows, opening) : brand.shape === "cba" ? S.cba(rows, opening) : brand.shape === "amex" ? S.amex(rows) : S.ing(rows, opening);
      return { filename: brand.csvName, type: CSV, body };
    }
    return { filename: `${brand.name}-Statement-${accountId}-${ymd(to)}.pdf`, type: PDF, body: await P.bankStatement({ brand, account, from, to, opening, rows }) };
  }
  if (account.kind === "loan") {
    const loan = D.loans[accountId];
    const months = monthsBetween(from, to).map((m) => [m, loan.months[m]]);
    if (!months.length) throw new ExportError(400, "No whole month in that range.");
    if (format === "csv") return { filename: `${brand.name}-Loan-${accountId}-${ymd(to)}.csv`, type: CSV, body: S.loanCsv(loan.number, months) };
    return { filename: `${brand.name}-LoanStatement-${accountId}-${ymd(to)}.pdf`, type: PDF, body: await P.loanStatement({ brand, loanId: accountId, loan, months, from, to }) };
  }
  if (account.kind === "property") {
    const property = D.properties[accountId];
    const months = monthsBetween(from, to).map((m) => [m, property.months[m]]);
    if (format === "csv") return { filename: `${brand.name}-OwnerStatement-${accountId}-${ymd(to)}.csv`, type: CSV, body: S.ownerCsv(months.flatMap(([, x]) => x.lines).filter((l) => l[0] >= from && l[0] <= to)) };
    return { filename: `${brand.name}-OwnerStatement-${accountId}-${ymd(to)}.pdf`, type: PDF, body: await P.ownerStatement({ brand, propertyId: accountId, property, from, to, months }) };
  }
  if (account.kind === "payroll") {
    const [person, employer] = accountId.split("@");
    const rows = D.payslips.filter((p) => p[1] === person && p[2] === employer && p[0] >= from && p[0] <= to);
    if (format === "csv") return { filename: "payslips.csv", type: CSV, body: S.payslipsCsv(rows) };
    return { filename: `${brand.name}-Payslips-${person}-${ymd(from)}-${ymd(to)}.pdf`, type: PDF, body: await P.payslips({ brand, person, employer, rows, from, to }) };
  }
  throw new ExportError(400, "Nothing to export.");
}

// A preview of the same rows for the page, so what you see is what the file holds.
function preview({ brand: brandId, account: accountId, from, to }) {
  const brand = brandById[brandId];
  const account = accountsFor(brandId).find((a) => a.id === accountId);
  if (!brand || !account) throw new ExportError(404, "No such account on this portal.");
  if (account.kind === "policy") {
    const policy = D.policies.find((p) => p.id === accountId);
    return { columns: ["Policy period", "Premium", "Paid on"], rows: policy.periods.map((p) => [`${p.from} to ${p.to}`, P.money(p.premium), p.paid_on]), summary: Object.entries(policy.cover).map(([k, v]) => [k, typeof v === "number" ? P.money(v) : String(v)]) };
  }
  if (!validDate(from) || !validDate(to) || from > to) throw new ExportError(400, "Pick a date range.");
  if (account.kind === "bank") {
    const rows = txRows(accountId, from, to); let bal = balanceBefore(accountId, from); const opening = bal;
    const out = rows.map((t) => { bal = Math.round((bal + t[3]) * 100) / 100; return [t[0], t[2], P.money(t[3]), P.money(bal)]; });
    return { columns: ["Date", "Description", "Amount", "Balance"], rows: out, summary: [["Opening balance", P.money(opening)], ["Rows", String(rows.length)], ["Closing balance", P.money(bal)]] };
  }
  if (account.kind === "loan") {
    const months = monthsBetween(from, to).map((m) => [m, D.loans[accountId].months[m]]);
    return { columns: ["Month", "Opening", "Interest charged", "Repayments", "Closing"], rows: months.map(([m, x]) => [m, P.money(x.opening), P.money(x.interest), P.money(x.repayments), P.money(x.closing)]), summary: [["Months", String(months.length)]] };
  }
  if (account.kind === "property") {
    const lines = monthsBetween(from, to).flatMap((m) => D.properties[accountId].months[m].lines).filter((l) => l[0] >= from && l[0] <= to);
    return { columns: ["Date", "Description", "Schedule line", "Amount", "By"], rows: lines.map((l) => [l[0], l[1], l[4], P.money(l[2]), l[5] ? brand.name : "Owner"]), summary: [["Lines", String(lines.length)]] };
  }
  if (account.kind === "payroll") {
    const [person, employer] = accountId.split("@");
    const rows = D.payslips.filter((p) => p[1] === person && p[2] === employer && p[0] >= from && p[0] <= to);
    return { columns: ["Pay date", "Gross", "Tax", "Super", "Net"], rows: rows.map((p) => [p[0], P.money(p[3]), P.money(p[4]), P.money(p[5]), P.money(p[6])]), summary: [["Payslips", String(rows.length)]] };
  }
  return { columns: [], rows: [], summary: [] };
}

module.exports = { buildExport, preview, ExportError };
