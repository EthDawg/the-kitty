// Davies input for the Tax view module (src/kit/taxview.js), in the shape MODULES.md gives.
// Reads data/v3/tax-returns.csv (one row per person per year) and the Tax Forecast, Settings, Payslips, Transactions,
// Compliance Checks and Subscriptions tabs from data/snapshot-v2.json. Everything here is fictional.
"use strict";
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..", "..");

// Quoted CSV with commas inside quotes and "" for a quote.
function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  const head = rows.shift();
  return rows.filter((r) => r.some((c) => c !== "")).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] == null ? "" : r[i]])));
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WORDS = ["no", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"];
const money = (x) => "$" + String(Math.round(Math.abs(x))).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const day = (iso) => { const [y, m, d] = iso.split("-").map(Number); return `${d} ${SHORT[m - 1]} ${y}`; };
const n = (v) => (v === "" || v == null ? null : Number(v));

module.exports = function taxviewInput() {
  const snap = JSON.parse(fs.readFileSync(path.join(ROOT, "data/snapshot-v2.json"), "utf8"));
  const csv = parseCsv(fs.readFileSync(path.join(ROOT, "data/v3/tax-returns.csv"), "utf8"));
  const setting = (name) => { const s = snap.settings.find((x) => x.setting === name); return s ? s.value : null; };
  const asOf = setting("As-of date");
  const fy = setting("Current financial year");
  const monthsElapsed = Number(setting("Months elapsed in current financial year"));
  const fyEnd = 2000 + Number(fy.slice(2));
  const fyStart = `${fyEnd - 1}-07-01`;
  const lodgeMonth = `July ${fyEnd}`;
  const people = [...new Set(csv.map((r) => r.Person))];

  // The Tax Forecast tab keeps the prior year in prior_<initial> and the current year in cur_<initial>.
  const col = (p) => "cur_" + p[0].toLowerCase();
  const line = (label, p) => { const r = snap.tax.find((x) => x.label === label); return r ? Number(r[col(p)]) || 0 : 0; };
  const medicareRate = Number(setting("Medicare levy rate")) || 0.02;
  const wfhRate = Number(setting("Work-from-home rate per hour ($)")) || 0;
  const factor = 12 / monthsElapsed;
  const inYear = (t) => t.date >= fyStart && t.date <= asOf;
  const cats = new Map(snap.category_list.map((c) => [c.category_id, c]));
  const compliance = (name) => snap.compliance.find((c) => c.check === name) || {};
  const firstSentence = (t) => (t ? String(t).split(/(?<=\.)\s/)[0] : "");
  const donationWhy = firstSentence(compliance("Donations without a receipt").why_it_matters) || "Only gifts to registered charities, with a receipt, can be claimed.";
  const workWhy = compliance("Work expenses without a receipt").why_it_matters || "A claim can be denied without written evidence.";
  const repairWhy = compliance("Large rental repairs").why_it_matters || "";

  const perPerson = {}, missing = [];
  for (const p of people) {
    const gross = line("Gross rent (share)", p), costs = -line("Rental expenses paid (share)", p), capital = -line("Depreciation and capital works (share)", p);
    // Large repairs held out as a flagged claim: the counted rental result is the corrected one.
    const repairsBack = line("Add back large rental repairs (share)", p) + line("Less capital works on those improvements", p);
    const rentNet = line("Net rental income or loss", p) + repairsBack;
    const work = -line("Work-related expenses", p), workNoReceipt = line("Add back work expenses without a receipt", p);
    const gifts = -line("Gifts and donations", p), giftsNoReceipt = line("Add back donations without a receipt", p);
    const wfh = -line("Work-from-home deduction", p);
    const hoursSoFar = Number(setting(`Work-from-home hours, ${p}, current year to date`)) || 0;
    const deductions = [];
    if (work - workNoReceipt > 0) deductions.push({ label: "Work-related expenses", amount: work - workNoReceipt, flagged: false, why: "", source: "Transactions, as recorded so far, not projected" });
    if (wfh > 0) deductions.push({ label: "Work from home", amount: wfh, flagged: false, why: "", source: `${hoursSoFar} hours so far, about ${Math.round(hoursSoFar * factor)} by June, at ${Math.round(wfhRate * 100)}c an hour` });
    if (gifts - giftsNoReceipt > 0) deductions.push({ label: "Donations", amount: gifts - giftsNoReceipt, flagged: false, why: "", source: "Transactions, as recorded so far" });
    if (workNoReceipt > 0) deductions.push({ label: "Work-related expenses", amount: workNoReceipt, flagged: true, flag: "has no receipt", why: workWhy, source: "Transactions, Receipt held is N" });
    if (repairsBack > 0) deductions.push({ label: "Rental repairs", amount: repairsBack, flagged: true, flag: "looks like an improvement", why: repairWhy, source: "Transactions, category RENT-REPAIR" });
    if (giftsNoReceipt > 0) {
      const gifts = snap.transactions.filter((t) => inYear(t) && t.category_id === "DONATION" && t.person === p && t.receipt_held !== "Y");
      const who = gifts.map((t) => `${money(t.amount)} to ${t.merchant} on ${day(t.date)}`).join(", ");
      deductions.push({ label: "Donations", amount: giftsNoReceipt, flagged: true, flag: "has no receipt", why: donationWhy, source: who ? `${who}, no receipt recorded` : "Transactions, no receipt recorded" });
      missing.push({ label: `Donation receipt for ${gifts.length ? gifts.map((t) => `${money(t.amount)} to ${t.merchant}`).join(", ") : money(giftsNoReceipt)}`, why: `${money(giftsNoReceipt)} is claimed without a receipt, so the estimate leaves it out until one is found.`, when: "Before you lodge", person: p });
    }
    if (hoursSoFar > 0) missing.push({ label: "Work-from-home hours", why: `Keep logging: ${hoursSoFar} hours so far, about ${Math.round(hoursSoFar * factor)} by 30 June at this pace. The fixed rate needs a record of every hour.`, when: `Until 30 June ${fyEnd}`, person: p });

    const taxable = line("Corrected taxable income", p);
    const medicare = Math.round(taxable * medicareRate * 100) / 100;
    perPerson[p] = {
      salary: line("Salary and wages", p),
      withheld: line("Tax withheld (PAYG)", p),
      otherIncome: line("Interest income (share)", p),
      rentNet,
      rentParts: { gross, costs, capital },
      deductions,
      taxable,
      tax: Math.round((line("Corrected total tax", p) - medicare) * 100) / 100,
      medicare,
      offsets: 0,
      result: line("Corrected refund (negative means tax payable)", p),
      atRisk: line("Refund at risk", p),
      sources: {
        salary: `Payslips, gross pay, July to ${MONTHS[(6 + monthsElapsed - 1) % 12]} × 12/${monthsElapsed}`,
        withheld: `Payslips, tax withheld, × 12/${monthsElapsed}`,
        otherIncome: `Transactions, interest, ${p}'s half, × 12/${monthsElapsed}`,
        rentNet: `Rent ${money(gross)}, less ${money(costs)} of costs and ${money(capital)} of depreciation and capital works, ${p}'s half; rent and costs × 12/${monthsElapsed}`,
        tax: `Resident rates for ${fy}`,
        medicare: `${Math.round(medicareRate * 100)}% of taxable income`,
      },
    };
  }

  // Income statements: employers finalise them in myGov by 14 July while the year still has months to run.
  if (monthsElapsed < 12) {
    for (const p of people) {
      const emp = [...new Set(snap.payslips.filter((s) => s.person === p && s.pay_date >= fyStart).map((s) => s.employer))];
      if (emp.length) missing.push({ label: `Income statement from ${emp.join(" and ")}`, why: `${WORDS[12 - monthsElapsed] || 12 - monthsElapsed} month${12 - monthsElapsed === 1 ? "" : "s"} of pay ${12 - monthsElapsed === 1 ? "is" : "are"} still to come. Employers mark income statements tax ready in myGov by 14 July.`, when: lodgeMonth, person: p });
    }
  }
  const agent = snap.transactions.filter((t) => inYear(t) && t.category_id === "RENT-MGMT").map((t) => t.merchant)[0];
  if (agent) missing.push({ label: `Rental statement for the year from ${agent}`, why: "It lists the year's rent, the agent's fees and anything the agent paid on your behalf.", when: lodgeMonth });
  const cover = (snap.subscriptions || []).find((s) => /health cover/i.test(s.service || ""));
  if (cover) missing.push({ label: `${cover.service} statement`, why: `${cover.merchant} reports your cover to the ATO and it shows in myGov. It settles the private health rebate and the Medicare levy surcharge, which this estimate leaves out.`, when: lodgeMonth });
  const uncat = snap.transactions.filter((t) => inYear(t) && t.category_id === "UNCAT");
  if (uncat.length) missing.push({ label: `${uncat.length} transaction${uncat.length === 1 ? "" : "s"} to sort, ${money(uncat.reduce((s, t) => s + Math.abs(t.amount), 0))}`, why: "They are left out of the tax totals until they have a category.", when: "Now" });
  const order = (m) => (m.when === "Now" ? 0 : m.when === "Before you lodge" ? 1 : /^Until/.test(m.when) ? 2 : 3);
  missing.sort((a, b) => order(a) - order(b));

  const returns = csv.map((r) => ({
    person: r.Person, fy: r.FY, status: r.Status,
    taxable: n(r["Taxable income"]), tax: n(r["Tax on income"]), medicare: n(r.Medicare), offsets: n(r.Offsets), withheld: n(r.Withheld), result: n(r.Result),
    lodged: r.Lodged || null, notice: r.Notice || null, pack: r.Pack || null, source: r.Source || null, note: r.Note || null,
  }));

  return {
    people, asOf,
    current: { fy, monthsElapsed, source: "Tax Forecast tab", perPerson, missing },
    returns,
  };
};

module.exports.parseCsv = parseCsv;
