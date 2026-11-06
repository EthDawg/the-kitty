/* Pawroll: one payslip per pay, an income statement per financial year. The 417 pays in months.json are base truth. FY2019 began before the
   household's first file, so the pays from July 2018 to February 2019 are printed on its income statement and in the payslips' year to date,
   and no payslip for them is held. */
"use strict";
const { toCents, fix, money, aud, addDays, fmtDate, fyOf, fyStart, fyEnd } = require("../lib/util");
const { Doc, MUTED } = require("../lib/pdf");

const BRAND = { name: "Pawroll", tagline: "Every pay, every paw, on time.", color: "#3b6fb5" };
const STREAM = { Jordan: "PAY-J", Mia: "PAY-M" };
const ISTREAM = { Jordan: "IS-J", Mia: "IS-M" };

// what the first pay in the window says the earlier pays of FY2019 were: the same salary, the same withholding
function prehistory(person, first) {
  const out = []; let d = addDays(first.date, -14);
  while (d >= "2018-07-01") { out.unshift({ ...first, date: d, pre: true }); d = addDays(d, -14); }
  return out;
}

function payslipDoc(w, p, ytd, employerAccount, last4 = "4771") {
  const d = new Doc({ brand: BRAND, title: "Payslip", kicker: `${fmtDate(addDays(p.date, -13))} to ${fmtDate(p.date)}`, deflate: w.deflate });
  d.h1(`Payslip for ${p.person} Davies`);
  d.kv([["Employer", p.employer], ["Pay date", fmtDate(p.date)], ["Pay period", `${fmtDate(addDays(p.date, -13))} to ${fmtDate(p.date)}`], ["Pay frequency", "Fortnightly"]], 3);
  d.h2("This pay");
  d.table([{ label: "Item", w: 300 }, { label: "This pay", w: 90, align: "right" }, { label: "Year to date", w: 90, align: "right" }], [
    ["Ordinary hours, salary", money(p.gross), money(ytd.gross)],
    ["PAYG withholding", money(-p.tax), money(-ytd.tax)],
    ["Superannuation guarantee (paid to fund quarterly)", money(p.sup), money(ytd.sup)],
  ], { foot: [`Net pay, to ${employerAccount}`, money(p.net), money(ytd.net)] });
  d.para(`Net pay of ${aud(p.net)} was paid on ${fmtDate(p.date)} to the account ending ${last4} with the description SALARY ${p.employer.toUpperCase()}. Year to date covers the financial year from ${fmtDate(fyStart(fyOf(p.date)))}.`, { color: MUTED, size: 8.5 });
  return d.finish();
}

function incomeStatementDoc(w, person, employer, rows, fy) {
  const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
  const d = new Doc({ brand: BRAND, title: "Income statement", kicker: `FY${fy}, 01 Jul ${fy - 1} to ${fmtDate(fyEnd(fy))}`, deflate: w.deflate });
  d.h1(`Income statement for ${person} Davies`);
  d.kv([["Payer", employer], ["Payee", `${person} Davies`], ["Income year", `1 July ${fy - 1} to 30 June ${fy}`], ["Status", "Tax ready"], ["Pays in the year", String(rows.length)], ["Payment basis", "Salary and wages, fortnightly"]], 3);
  d.h2("Amounts reported");
  d.table([{ label: "Item", w: 300 }, { label: "Amount", w: 100, align: "right" }], [
    ["Gross payments (salary, wages, allowances, bonuses)", money(sum("gross"))],
    ["Tax withheld (PAYG withholding)", money(sum("tax"))],
    ["Reportable employer superannuation contributions", money(0)],
    ["Superannuation guarantee paid on your behalf (for information)", money(sum("sup"))],
    ["Net pay received", money(sum("net"))],
  ]);
  d.h2("Pays in the year");
  d.table([{ label: "Pay date", w: 90 }, { label: "Gross", w: 80, align: "right" }, { label: "Tax withheld", w: 80, align: "right" }, { label: "Super", w: 80, align: "right" }, { label: "Net", w: 80, align: "right" }],
    rows.map((p) => [fmtDate(p.date), money(p.gross), money(p.tax), money(p.sup), money(p.net)]), { foot: ["Total", money(sum("gross")), money(sum("tax")), money(sum("sup")), money(sum("net"))] });
  d.para("An income statement is what an employer reports to the tax office each year through Single Touch Payroll; the figures here add up the pays above. Fictional employer, fictional employee.", { color: MUTED, size: 8.5 });
  return d.finish();
}

function run(w) {
  const pays = w.base.payslips.map(([date, person, employer, gross, tax, sup, net]) => ({ date, person, employer, gross: toCents(gross), tax: toCents(tax), sup: toCents(sup), net: toCents(net) }));
  w.pays = pays;
  const truth = [];
  for (const person of ["Jordan", "Mia"]) {
    const mine = pays.filter((p) => p.person === person);
    const pre = prehistory(person, mine[0]);
    const all = [...pre, ...mine];
    w.preHistory = w.preHistory || {}; w.preHistory[person] = pre;
    const running = {};
    for (const p of all) {
      const fy = fyOf(p.date), y = running[fy] = running[fy] || { gross: 0, tax: 0, sup: 0, net: 0 };
      y.gross += p.gross; y.tax += p.tax; y.sup += p.sup; y.net += p.net;
      if (p.pre) continue;
      const bytes = payslipDoc(w, p, y, "Everyday joint");
      w.file({ stream_id: STREAM[person], download_date: p.date, name: `Pawroll-Payslip-${person}-${p.date}.pdf`, bytes, family: "pawroll-payslip-pdf", container: "pdf", expect: { payslip: 1 }, origin: "portal", issued_on: p.date });
      truth.push({ pay_date: p.date, person, employer: p.employer, gross_cents: p.gross, tax_cents: p.tax, super_cents: p.sup, net_cents: p.net, ytd_gross_cents: y.gross, ytd_tax_cents: y.tax, ytd_super_cents: y.sup, fy });
    }
    const employer = mine[0].employer;
    for (let fy = 2019; fy <= 2026; fy++) {
      const rows = all.filter((p) => fyOf(p.date) === fy), bytes = incomeStatementDoc(w, person, employer, rows, fy);
      w.file({ stream_id: ISTREAM[person], download_date: `${fy}-07-14`, name: `Pawroll-IncomeStatement-${person}-FY${fy}.pdf`, bytes, family: "pawroll-income-statement-pdf", container: "pdf", expect: { income_statement: 1 }, origin: "portal", issued_on: `${fy}-07-14` });
      const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
      (w.truth.income_statements = w.truth.income_statements || []).push({ person, employer, fy, gross_cents: sum("gross"), tax_cents: sum("tax"), super_cents: sum("sup"), pays: rows.length, pays_held: rows.filter((r) => !r.pre).length });
    }
  }
  w.truth.payslips = truth;
}

module.exports = { run, payslipDoc, incomeStatementDoc, BRAND };
