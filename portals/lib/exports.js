// Turn (brand, account, from, to, format) into a file: name, content type, bytes. Used by api/export.js.
"use strict";
const S = require("./shapes");
const P = require("./pdf");
const { D, brandById, accountById, accountsFor, txRows, balanceBefore, validDate, today, monthEnd, fyOf, fyLabel, round2, lastDay, firstDay, fits } = require("./data");
const Clock = require("./clock");
const { OPEN } = require("./view");

class ExportError extends Error { constructor(status, message) { super(message); this.status = status; } }
const CSV = "text/csv; charset=utf-8", PDF = "application/pdf";
const ymd = (iso) => iso.replace(/-/g, "");
const monthsBetween = (from, to) => D.months.filter((m) => `${m}-01` <= to && monthEnd(m) >= from);

// What a named person's portal refuses: older than it keeps, or more than it will hand over at once.
const friction = (brand, view, from, to) => {
  const oldest = firstDay(view);
  if (oldest && to < oldest) throw new ExportError(403, `${brand.name} keeps ${view.rules.back_years} years online. Nothing before ${oldest} can be downloaded here.`);
  if (oldest && from < oldest) throw new ExportError(403, `${brand.name} keeps ${view.rules.back_years} years online. Start from ${oldest} or later.`);
  if (!fits(view, from, to)) throw new ExportError(400, `${brand.name} exports at most ${view.rules.window_days} days at a time. Pick a shorter period.`);
};

async function buildExport({ brand: brandId, account: accountId, from, to, format, view = OPEN }) {
  const brand = brandById[brandId];
  if (!brand) throw new ExportError(404, "No such portal.");
  const account = accountsFor(brandId, view).find((a) => a.id === accountId);
  if (!account) throw new ExportError(404, "No such account on this portal.");
  if (!account.formats.some(([f]) => f === format)) throw new ExportError(400, "That format is not offered for this account.");
  if (account.kind === "policy") {
    const policy = D.policies.find((p) => p.id === accountId);
    const held = policy.periods.filter((p) => p.from <= lastDay(view));
    const per = held.find((p) => p.from === from && p.to === to) || held[held.length - 1];
    const year = per.from.slice(0, 4);
    if (format === "renewal") return { filename: `${brand.name}-RenewalNotice-${policy.property}-${year}.pdf`, type: PDF, body: await P.renewalNotice({ brand, policy, per }) };
    return { filename: `${brand.name}-CertificateOfCurrency-${policy.property}-${year}.pdf`, type: PDF, body: await P.certificate({ brand, policy, per }) };
  }
  if (!validDate(from) || !validDate(to) || from > to) throw new ExportError(400, "Pick a date range: from and to as YYYY-MM-DD, from no later than to.");
  const now = Clock.upTo(view, today);
  if (to > now) throw new ExportError(400, `Nothing after ${now} yet.`);
  friction(brand, view, from, to);
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
    const months = monthsBetween(from, to).filter((m) => monthEnd(m) <= lastDay(view)).map((m) => [m, loan.months[m]]);
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
    if (format === "income") {
      const fy = fyOf(to);
      const year = D.payslips.filter((p) => p[1] === person && p[2] === employer && fyOf(p[0]) === fy && p[0] <= to);
      return { filename: `${brand.name}-IncomeStatement-${person}-${fyLabel(fy)}.pdf`, type: PDF, body: await P.incomeStatement({ brand, person, employer, rows: year, fy, to }) };
    }
    return { filename: rows.length === 1 ? `${brand.name}-Payslip-${person}-${ymd(rows[0][0])}.pdf` : `${brand.name}-Payslips-${person}-${ymd(from)}-${ymd(to)}.pdf`, type: PDF, body: await P.payslips({ brand, person, employer, rows, from, to }) };
  }
  throw new ExportError(400, "Nothing to export.");
}

// The page's view of the same rows the file holds: newest first, searchable, a page at a time.
function preview({ brand: brandId, account: accountId, from, to, q, page, size, view = OPEN }) {
  const brand = brandById[brandId];
  const account = accountsFor(brandId, view).find((a) => a.id === accountId);
  if (!brand || !account) throw new ExportError(404, "No such account on this portal.");
  if (to) to = Clock.upTo(view, to);
  const paginate = (res) => {
    const needle = String(q || "").trim().toLowerCase();
    let rows = needle ? res.rows.filter((r) => r.some((c) => String(c).toLowerCase().includes(needle))) : res.rows;
    const total = rows.length, sz = Math.min(Math.max(Number(size) || 50, 10), 500), pg = Math.max(Number(page) || 1, 1);
    rows = rows.slice((pg - 1) * sz, pg * sz);
    return { ...res, rows, total, page: pg, size: sz };
  };
  if (account.kind === "policy") {
    const policy = D.policies.find((p) => p.id === accountId);
    return paginate({ columns: ["Policy period", "Premium", "Paid on", "Paid from"], rows: [...policy.periods].reverse().filter((p) => p.from <= lastDay(view)).map((p) => [`${p.from} to ${p.to}`, P.money(p.premium), p.paid_on, accountById[p.paid_from] ? accountById[p.paid_from].name : p.paid_from]), summary: Object.entries(policy.cover).map(([k, v]) => [k, typeof v === "number" ? P.money(v) : String(v)]) });
  }
  if (!validDate(from) || !validDate(to) || from > to) throw new ExportError(400, "Pick a date range.");
  if (account.kind === "bank") {
    const rows = txRows(accountId, from, to); let bal = balanceBefore(accountId, from); const opening = bal;
    const isCard = brand.kind === "card";
    const out = rows.map((t) => { bal = round2(bal + t[3]); return isCard ? [t[0], t[2], t[3] < 0 ? P.money(-t[3]) : "", t[3] > 0 ? P.money(t[3]) : "", P.money(-bal)] : [t[0], t[2], t[3] < 0 ? P.money(-t[3]) : "", t[3] > 0 ? P.money(t[3]) : "", P.money(bal)]; }).reverse();
    const moneyIn = round2(rows.filter((t) => t[3] > 0).reduce((s, t) => s + t[3], 0)), moneyOut = round2(rows.filter((t) => t[3] < 0).reduce((s, t) => s - t[3], 0));
    return paginate({ columns: isCard ? ["Date", "Description", "Charges", "Payments and credits", "Balance owing"] : ["Date", "Description", "Debit", "Credit", "Balance"], rows: out,
      summary: isCard ? [["Previous balance", P.money(-opening)], ["New charges", P.money(moneyOut)], ["Payments and credits", P.money(moneyIn)], ["New balance", P.money(-bal)]] : [["Opening balance", P.money(opening)], ["Money in", P.money(moneyIn)], ["Money out", P.money(moneyOut)], ["Closing balance", P.money(bal)]] });
  }
  if (account.kind === "loan") {
    const months = monthsBetween(from, to).filter((m) => monthEnd(m) <= lastDay(view)).map((m) => [m, D.loans[accountId].months[m]]).filter(([, x]) => x);
    const interest = round2(months.reduce((s, [, x]) => s + x.interest, 0)), repaid = round2(months.reduce((s, [, x]) => s + x.repayments, 0));
    return paginate({ columns: ["Month", "Rate", "Opening balance", "Interest charged", "Repayments", "Closing balance"], rows: months.map(([m, x]) => [m, `${x.rate.toFixed(2)}%`, P.money(x.opening), P.money(x.interest), P.money(x.repayments), P.money(x.closing)]).reverse(),
      summary: [["Interest charged", P.money(interest)], ["Repayments", P.money(repaid)], ["Balance at end", months.length ? P.money(months[months.length - 1][1].closing) : ""]] });
  }
  if (account.kind === "property") {
    const lines = monthsBetween(from, to).flatMap((m) => (D.properties[accountId].months[m] || { lines: [] }).lines).filter((l) => l[0] >= from && l[0] <= to);
    const rent = round2(lines.filter((l) => l[3] === "RENT-INC").reduce((s, l) => s + l[2], 0)), fees = round2(-lines.filter((l) => l[3] === "RENT-MGMT").reduce((s, l) => s + l[2], 0)), owner = round2(-lines.filter((l) => !l[5] && l[2] < 0).reduce((s, l) => s + l[2], 0));
    return paginate({ columns: ["Date", "Description", "Rental schedule line", "Money in", "Money out", "Handled by"], rows: lines.map((l) => [l[0], l[1], l[4], l[2] > 0 ? P.money(l[2]) : "", l[2] < 0 ? P.money(-l[2]) : "", l[5] ? brand.name : "Owner"]).reverse(),
      summary: [["Rent collected", P.money(rent)], ["Management fees", P.money(fees)], ["Owner-paid expenses", P.money(owner)], ["Net position", P.money(rent - fees - owner)]] });
  }
  if (account.kind === "payroll") {
    const [person, employer] = accountId.split("@");
    const rows = D.payslips.filter((p) => p[1] === person && p[2] === employer && p[0] >= from && p[0] <= to);
    const sum = (i) => round2(rows.reduce((s, p) => s + p[i], 0));
    return paginate({ columns: ["Pay date", "Gross pay", "Tax withheld", "Super", "Net pay", "Payslip"], rows: [...rows].reverse().map((p) => [p[0], P.money(p[3]), P.money(p[4]), P.money(p[5]), P.money(p[6]), `pdf:${p[0]}`]),
      summary: [["Pays", String(rows.length)], ["Gross", P.money(sum(3))], ["Tax withheld", P.money(sum(4))], ["Super", P.money(sum(5))], ["Net", P.money(sum(6))]] });
  }
  return { columns: [], rows: [], summary: [], total: 0, page: 1, size: 50 };
}

module.exports = { buildExport, preview, ExportError };
