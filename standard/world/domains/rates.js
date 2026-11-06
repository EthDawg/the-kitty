/* Every home and investment loan rate change as a notice, PDF to 2021, email after. Effective on the day, notified twelve days later, as the
   lender's letters run. The 2025 cut is the honest trap: a first notice says 1 September, a correction on 10 September backdates it to 25 August.
   Interest charged in the statements never moves. */
"use strict";
const { fmtDate, addDays } = require("../lib/util");
const { Doc, MUTED } = require("../lib/pdf");
const { eml, row, htmlEsc } = require("../lib/mail");
const { BRAND } = require("./loans");
const { stream } = require("./setup");

// the cash-rate path portals/history.py carries
const CASH = [["2019-06-05", 1.25], ["2019-07-03", 1.0], ["2019-10-02", 0.75], ["2020-03-04", 0.25], ["2020-11-04", 0.1], ["2022-05-04", 0.35], ["2022-06-08", 0.85], ["2022-07-06", 1.35], ["2022-08-03", 1.85], ["2022-09-07", 2.35], ["2022-10-05", 2.6], ["2022-11-02", 2.85], ["2022-12-07", 3.1], ["2023-02-08", 3.35], ["2023-03-08", 3.6], ["2023-05-03", 3.85], ["2023-06-07", 4.1], ["2023-11-08", 4.35], ["2025-09-01", 4.1]];
const MARGIN = { "C-HOME": 1.69, "C-INV": 1.94 };
const LOAN = { "C-HOME": "LN-HOME", "C-INV": "LN-INV" };

function pdfNotice(w, n) {
  const d = new Doc({ brand: BRAND, title: "Interest rate notice", kicker: `Issued ${fmtDate(n.notified_on)}`, deflate: w.deflate });
  d.h1(n.correction ? "A correction to your interest rate notice" : "Your interest rate is changing");
  d.kv([["Loan number", n.number], ["Loan", n.loan_name], ["Borrowers", "Jordan and Mia Davies"], ["Old rate", `${n.old.toFixed(2)}% p.a.`], ["New rate", `${n.rate.toFixed(2)}% p.a.`], ["Effective date", fmtDate(n.effective_on)]], 3);
  d.para(n.correction ? `Our notice of ${fmtDate(n.correction)} gave the wrong date. The new rate took effect on ${fmtDate(n.effective_on)}. Any interest charged at the old rate after that date will be refunded.` : `Your variable rate changes on the date above. Interest is calculated daily and charged on the last day of each month. You do not need to do anything.`, { size: 9.5 });
  d.para("A fictional notice from a parody lender.", { color: MUTED, size: 8.5 });
  return d.finish();
}

function emailNotice(n) {
  const subject = n.correction ? `Correction: your ${n.loan_name} interest rate` : `Your ${n.loan_name} interest rate is changing`;
  const text = [`Dear Jordan and Mia,`, "", n.correction ? `Our earlier notice gave the wrong date. The new rate took effect earlier than we said.` : `Your variable interest rate is changing.`, "", `Loan number: ${n.number}`, `Old rate: ${n.old.toFixed(2)}% p.a.`, `New rate: ${n.rate.toFixed(2)}% p.a.`, `Effective date: ${fmtDate(n.effective_on)}`, `Notice date: ${fmtDate(n.notified_on)}`, "", "Interest is calculated daily and charged on the last day of each month.", "", "Westpaw, a fictional lender."].join("\n");
  const html = `<html><body><p>Dear Jordan and Mia,</p><table>${row(["Loan number", n.number])}${row(["Old rate", `${n.old.toFixed(2)}% p.a.`])}${row(["New rate", `${n.rate.toFixed(2)}% p.a.`])}${row(["Effective date", fmtDate(n.effective_on)])}${row(["Notice date", fmtDate(n.notified_on)])}</table><p>${htmlEsc("Westpaw, a fictional lender.")}</p></body></html>`;
  return eml({ from: "Westpaw Home Loans <notices@westpaw.example>", to: "Jordan and Mia Davies <the.davies@mail.example>", subject, date: n.notified_on, id: `rate-${n.contract}-${n.effective_on}-${n.notified_on}`, text, html });
}

function run(w) {
  const notices = [], truth = [];
  for (const contract of ["C-HOME", "C-INV"]) {
    const loan = w.base.loans[LOAN[contract]], first = contract === "C-HOME" ? "2019-03-15" : "2021-08-20", m = MARGIN[contract];
    stream(w, `RATE-${LOAN[contract]}`, `${loan.name} rate notices`, "rate_notice", "contract", contract, "event", first, { issuer_party_id: "HARBOUR" });
    let old = contract === "C-HOME" ? 3.19 : 2.04;
    for (const [date, cash] of CASH) {
      if (date <= first) continue;
      const rate = Math.round((cash + m) * 100) / 100;
      if (rate === old) continue;
      const cut = date === "2025-09-01";
      notices.push({ contract, stream: `RATE-${LOAN[contract]}`, number: loan.number, loan_name: loan.name, old, rate, effective_on: date, notified_on: cut ? "2025-09-03" : addDays(date, 12) });
      truth.push({ contract, value: rate.toFixed(2), effective_on: date, notified_on: cut ? "2025-09-03" : addDays(date, 12) });
      if (cut) { notices.push({ contract, stream: `RATE-${LOAN[contract]}`, number: loan.number, loan_name: loan.name, old, rate, effective_on: "2025-08-25", notified_on: "2025-09-10", correction: "2025-09-03" }); truth.push({ contract, value: rate.toFixed(2), effective_on: "2025-08-25", notified_on: "2025-09-10", corrects: "2025-09-01" }); }
      old = rate;
    }
  }
  for (const n of notices) {
    const email = n.effective_on >= "2022-01-01";
    if (email) w.file({ stream_id: n.stream, download_date: n.notified_on, name: `Rate-notice-${n.contract}-${n.notified_on}.eml`, text: emailNotice(n), family: "westpaw-rate-notice-eml", container: "eml", expect: { rate_notice: 1 }, origin: "email", issued_on: n.notified_on });
    else w.file({ stream_id: n.stream, download_date: n.notified_on, name: `Westpaw-RateNotice-${n.contract}-${n.notified_on}.pdf`, bytes: pdfNotice(w, n), family: "westpaw-rate-notice-pdf", container: "pdf", expect: { rate_notice: 1 }, origin: "portal", issued_on: n.notified_on });
  }
  w.truth.rate_notices = truth;
}

module.exports = { run, CASH };
