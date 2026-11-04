// The institutions' exact export shapes, byte-for-byte what period-close/adapters.py writes and reads
// (Python's csv.writer: minimal quoting, \r\n line endings), so a closed month downloaded here is
// identical to the file the simulator put under sources/.
"use strict";
const { round2 } = require("./data");

const dmy = (iso) => { const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; };
const fix = (n) => (Math.abs(n) < 0.005 ? 0 : n).toFixed(2);
const q = (v) => { const s = String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const lines = (rows) => rows.map((r) => r.map(q).join(",")).join("\r\n") + "\r\n";
const thousands = (s) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const signed = (n) => `${n >= 0 ? "+" : "-"}${thousands(Math.abs(n).toFixed(2))}`;

// Westpac: Bank Account, Date, Narrative, Debit Amount, Credit Amount, Balance, Categories, Serial. Oldest first, running balance.
const westpac = (number, rows, opening) => {
  let bal = opening;
  const out = [["Bank Account", "Date", "Narrative", "Debit Amount", "Credit Amount", "Balance", "Categories", "Serial"]];
  for (const [d, desc, amt] of rows) { bal = round2(bal + amt); out.push([number, dmy(d), desc, amt < 0 ? fix(-amt) : "", amt > 0 ? fix(amt) : "", fix(bal), "", ""]); }
  return lines(out);
};

// CommBank: no header. Date, Amount, Description, Balance; newest first; signed amounts with thousands separators; quoted after the date.
const cba = (rows, opening) => {
  let bal = opening;
  const out = [];
  for (const [d, desc, amt] of rows) { bal = round2(bal + amt); out.push(`${dmy(d)},"${signed(amt)}","${desc.replace(/"/g, '""')}","${signed(bal)}"`); }
  return out.reverse().map((l) => l + "\r\n").join("");
};

// American Express: Date, Description, Card Member, Account #, Amount. Charges positive, payments and refunds negative, no balance.
const amex = (rows) => lines([["Date", "Description", "Card Member", "Account #", "Amount"], ...rows.map(([d, desc, amt]) => [dmy(d), desc, "JORDAN DAVIES", "-41007", fix(-amt)])]);

// ING: Date, Description, Credit, Debit, Balance. Debits negative, oldest first, running balance.
const ing = (rows, opening) => {
  let bal = opening;
  const out = [["Date", "Description", "Credit", "Debit", "Balance"]];
  for (const [d, desc, amt] of rows) { bal = round2(bal + amt); out.push([dmy(d), desc, amt > 0 ? fix(amt) : "", amt < 0 ? fix(amt) : "", fix(bal)]); }
  return lines(out);
};

// A loan account in the Westpac shape: interest debited, repayments credited, the balance owing shown negative as the bank shows it.
const loanCsv = (number, months) => {
  const out = [["Bank Account", "Date", "Narrative", "Debit Amount", "Credit Amount", "Balance", "Categories", "Serial"]];
  for (const [m, x] of months) {
    const last = `${m}-${String(new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate()).padStart(2, "0")}`;
    out.push([number, dmy(`${m}-01`), "REPAYMENT RECEIVED", "", fix(x.repayments), fix(-(x.opening - x.repayments)), "", ""]);
    out.push([number, dmy(last), "INTEREST CHARGED", fix(x.interest), "", fix(-x.closing), "", ""]);
  }
  return lines(out);
};

// The owner statement as lines: Date, Description, Schedule line, Money in, Money out, Handled by.
const ownerCsv = (lines_) => lines([["Date", "Description", "Rental schedule line", "Money in", "Money out", "Handled by"],
  ...lines_.map(([d, desc, amt, , line, agent]) => [dmy(d), desc, line, amt > 0 ? fix(amt) : "", amt < 0 ? fix(-amt) : "", agent ? "PropertyMeow" : "Owner"])]);

// Payslips in the shape period-close/<month>/payslips.csv already has, ready to append to the sheet.
const payslipsCsv = (rows) => lines([["Pay date", "Person", "Employer", "Gross pay", "Tax withheld", "Super (employer)", "Net pay"],
  ...rows.map(([d, person, employer, gross, tax, sup, net]) => [d, person, employer, fix(gross), fix(tax), fix(sup), fix(net)])]);

module.exports = { westpac, cba, amex, ing, loanCsv, ownerCsv, payslipsCsv, dmy, fix };
