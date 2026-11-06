/* The two Harbour Bank loans, as months.json has them: a monthly ledger export in the bank's shape and a statement per financial year whose
   table is one row a month. Interest charged is the lender's and never moves. */
"use strict";
const { toCents, fix, dmy, csvLines, monthEnd, nextMonth, fmtDate, fmtMonth, money, aud, fyOf, fyStart, fyEnd, monthRange } = require("../lib/util");
const { Doc, MUTED, period } = require("../lib/pdf");

const BRAND = { name: "Westpaw", tagline: "Banking with a wag.", color: "#b5243a" };

function months(loan) {
  return Object.keys(loan.months).sort().map((m) => { const x = loan.months[m]; return { ym: m, opening: toCents(x.opening), interest: toCents(x.interest), repayments: toCents(x.repayments), closing: toCents(x.closing), rate: x.rate, offset: x.offset == null ? null : toCents(x.offset) }; });
}

// the Westpac shape for a loan: interest debited, repayments credited, the balance owing negative as the bank shows it
function ledgerCsv(number, x) {
  const out = [["Bank Account", "Date", "Narrative", "Debit Amount", "Credit Amount", "Balance", "Categories", "Serial"]];
  let n = 0;
  if (x.repayments) { out.push([number, dmy(`${x.ym}-01`), "REPAYMENT RECEIVED", "", fix(x.repayments), fix(-(x.opening - x.repayments)), "", ""]); n += 1; }
  if (x.interest) { out.push([number, dmy(monthEnd(x.ym)), "INTEREST CHARGED", fix(x.interest), "", fix(-x.closing), "", ""]); n += 1; }
  return { text: csvLines(out), n };
}

function statementDoc(w, id, loan, rows, fy) {
  const from = `${rows[0].ym}-01`, to = monthEnd(rows[rows.length - 1].ym);
  const d = new Doc({ brand: BRAND, title: "Loan statement", kicker: period(from, to), deflate: w.deflate });
  d.h1(loan.name);
  const interest = rows.reduce((s, x) => s + x.interest, 0), repaid = rows.reduce((s, x) => s + x.repayments, 0);
  d.kv([["Loan number", loan.number], ["Borrowers", "Jordan and Mia Davies"], ["Interest rate", `${rows[rows.length - 1].rate.toFixed(2)}% p.a. variable`], ["Repayment type", loan.repayment_type],
    ["Opening balance", aud(rows[0].opening)], ["Closing balance", aud(rows[rows.length - 1].closing)], ["Interest charged", aud(interest)], ["Repayments received", aud(repaid)]], 4);
  d.h2("Monthly summary");
  d.table([{ label: "Month", w: 80 }, { label: "Rate", w: 50, align: "right" }, { label: "Opening", w: 85, align: "right" }, { label: "Interest charged", w: 80, align: "right" }, { label: "Repayments", w: 80, align: "right" }, { label: "Closing", w: 85, align: "right" }, { label: "Offset", w: 75, align: "right" }],
    rows.map((x) => [fmtMonth(x.ym), `${x.rate.toFixed(2)}%`, money(x.opening), money(x.interest), money(x.repayments), money(x.closing), x.offset == null ? "" : money(x.offset)]),
    { foot: ["Total", "", "", money(interest), money(repaid), money(rows[rows.length - 1].closing), ""] });
  d.para("Interest is calculated daily on the balance less any linked offset and charged on the last day of the month. The rate column shows the variable rate that applied at the start of each month.", { color: MUTED, size: 8.5 });
  return d.finish();
}

function run(w) {
  const truth = {};
  for (const id of ["LN-HOME", "LN-INV"]) {
    const loan = w.base.loans[id], rows = months(loan);
    truth[id] = rows.map((x) => ({ month: x.ym, opening_cents: x.opening, interest_cents: x.interest, repayments_cents: x.repayments, closing_cents: x.closing, rate_pct: x.rate.toFixed(2) }));
    for (const x of rows) {
      const c = ledgerCsv(loan.number, x);
      const expect = { txn_line: c.n }; if (c.n) expect.statement = 1;
      w.file({ stream_id: id, download_date: `${nextMonth(x.ym)}-03`, name: `Westpaw-Loan-${id}-${x.ym}.csv`, text: c.text, family: "harbour-txn-csv", container: "csv", expect, origin: "portal", issued_on: monthEnd(x.ym) });
    }
    const fys = [...new Set(rows.map((x) => fyOf(`${x.ym}-01`)))];
    for (const fy of fys) {
      const r = rows.filter((x) => fyOf(`${x.ym}-01`) === fy), last = monthEnd(r[r.length - 1].ym);
      const bytes = statementDoc(w, id, loan, r, fy);
      w.file({ stream_id: `${id}-STMT`, download_date: fy >= 2027 ? "2027-04-05" : `${fy}-07-05`, name: `Westpaw-LoanStatement-${id}-FY${fy}.pdf`, bytes, family: "westpaw-loan-statement-pdf", container: "pdf", expect: { loan_statement: r.length }, origin: "portal", issued_on: last });
    }
  }
  w.truth.loans = truth;
}

module.exports = { run, BRAND, months };
