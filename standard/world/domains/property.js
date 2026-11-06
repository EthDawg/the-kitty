/* The Geelong townhouse as PropertyMeow holds it: an owner statement a month, the settlement statement that witnesses the three uncategorised
   lines of 20 August 2021, and Purrsure's policies. */
"use strict";
const { toCents, money, aud, fmtDate, monthEnd, nextMonth, fyOf, fyStart, addDays } = require("../lib/util");
const { Doc, MUTED, period } = require("../lib/pdf");
const { stream } = require("./setup");

const MEOW = { name: "PropertyMeow", tagline: "Your rental, watched by cats.", color: "#6b4fa0" };
const SURE = { name: "Purrsure", tagline: "Cover for the curious.", color: "#0f766e" };
const ORDER = ["Gross rent", "Property agent fees and commission", "Interest on loans", "Council rates", "Water charges", "Body corporate fees", "Insurance", "Repairs and maintenance", "Sundry rental expenses"];

function ownerDoc(w, p, ym, x, allMonths) {
  const from = `${ym}-01`, to = monthEnd(ym);
  const d = new Doc({ brand: MEOW, title: "Owner statement", kicker: period(from, to), deflate: w.deflate });
  d.h1(p.name);
  const rent = toCents(x.rent), fees = toCents(x.fees), lines = x.lines.map(([date, desc, amt, cat, line, agent]) => ({ date, desc, cents: toCents(amt), cat, line, agent }));
  const ownerPaid = -lines.filter((l) => !l.agent && l.cents < 0).reduce((s, l) => s + l.cents, 0);
  d.kv([["Owner", "Jordan and Mia Davies"], ["Owner reference", p.owner_ref], ["Managed by", "PropertyMeow, Geelong office"], ["Rent collected", aud(rent)], ["Management fees", aud(fees)], ["Paid to owner", aud(rent - fees)], ["Owner-paid expenses in period", aud(ownerPaid)], ["Rental account", "Rental property account"]], 3);
  d.h2("Statement lines");
  d.table([{ label: "Date", w: 70 }, { label: "Description", w: 178 }, { label: "Rental schedule line", w: 125 }, { label: "Money in", w: 60, align: "right" }, { label: "Money out", w: 62, align: "right" }, { label: "By", w: 60 }],
    lines.map((l) => [fmtDate(l.date), l.desc, l.line, l.cents > 0 ? money(l.cents) : "", l.cents < 0 ? money(-l.cents) : "", l.agent ? MEOW.name : "Owner"]));
  d.para("Rent is paid to the owner's rental account in full on receipt and the management fee is debited separately, which is why both appear as their own lines in the owner's bank export.", { color: MUTED, size: 8.5 });
  const fy = fyStart(fyOf(from)), ytd = {};
  for (const [m, y] of allMonths) if (m >= fy.slice(0, 7) && m <= ym) for (const l of y.lines) ytd[l[4]] = (ytd[l[4]] || 0) + toCents(l[2]);
  d.h2(`Rental schedule, financial year to date (${fmtDate(fy)} to ${fmtDate(to)})`);
  d.table([{ label: "ATO rental schedule line", w: 300 }, { label: "Amount", w: 100, align: "right" }], ORDER.filter((k) => ytd[k] != null).map((k) => [k, money(Math.abs(ytd[k]))]));
  return { bytes: d.finish(), n: lines.length };
}

function settlementDoc(w, s) {
  const d = new Doc({ brand: s.brand, title: "Settlement statement", deflate: w.deflate, style: "plain" });
  d.h1(`Settlement statement, ${s.address}`);
  d.kv([["Matter", s.matter], ["Purchaser", s.purchaser], ["Settlement date", fmtDate(s.settled_on)], ["Property reference", s.asset_ref]], 2);
  d.h2("Statement of adjustments");
  d.table([{ label: "Item", w: 340 }, { label: "Amount", w: 100, align: "right" }], [
    ["Purchase price", money(s.price)], ["Land transfer duty", money(s.duty)], ["Legal and conveyancing", money(s.legal)], ["Adjustments, council and water", money(s.adjustments)],
    ["Loan funds drawn at settlement", money(-s.loan)], ["Cash paid by purchaser", money(s.cash)]]);
  d.para(`Loan drawn from ${s.lender}, loan number ${s.loan_number}. Prepared for the purchaser's records; a fictional document.`, { size: 8.5, color: MUTED });
  return d.finish();
}

const POLICY_NO = (id, from) => `${id.replace("POL-", "PS-")}-${from.slice(0, 4)}`;
function coverRows(policy) { return Object.entries(policy.cover).map(([k, v]) => [k, typeof v === "number" ? aud(toCents(v)) : String(v)]); }

function renewalDoc(w, policy, per, paidFromName) {
  const d = new Doc({ brand: SURE, title: "Renewal notice", kicker: `Policy period ${period(per.from, per.to)}`, deflate: w.deflate });
  d.h1(`${policy.name} renewal`);
  d.kv([["Policy number", POLICY_NO(policy.id, per.from)], ["Insured", "Jordan and Mia Davies"], ["Situation", policy.address], ["Period of insurance", `${fmtDate(per.from)} to ${fmtDate(per.to)}, 4pm`],
    ["Total premium", aud(toCents(per.premium))], ["Payment due", fmtDate(per.from)], ["Status", `Paid ${fmtDate(per.paid_on)} from ${paidFromName}`], ["Premium includes", "GST, stamp duty and levies"]], 4);
  d.h2("Your cover");
  d.table([{ label: "Cover", w: 260 }, { label: "Sum insured or limit", w: 140, align: "right" }], coverRows(policy));
  d.para("Your policy renews automatically when the premium is paid by the due date. Read the Product Disclosure Statement for what is and is not covered. This notice was generated for a fictional household; no policy exists.", { color: MUTED, size: 8.5 });
  return d.finish();
}
function certificateDoc(w, policy, per) {
  const issued = per.to < "2027-03-31" ? per.to : "2027-03-31";
  const d = new Doc({ brand: SURE, title: "Certificate of currency", kicker: `Issued ${fmtDate(issued)}`, deflate: w.deflate });
  d.h1("Certificate of currency");
  d.kv([["Policy number", POLICY_NO(policy.id, per.from)], ["Policy", policy.name], ["Insured", "Jordan and Mia Davies"], ["Situation", policy.address], ["Period of insurance", `${fmtDate(per.from)} to ${fmtDate(per.to)}`], ["Premium paid", aud(toCents(per.premium))]], 3);
  d.h2("Cover in force");
  d.table([{ label: "Cover", w: 260 }, { label: "Sum insured or limit", w: 140, align: "right" }], coverRows(policy));
  d.para("This certificate confirms that the policy described is current for the period shown. It is a summary only and does not alter the policy. Fictional, for a demo.", { color: MUTED, size: 8.5 });
  return { bytes: d.finish(), issued };
}

function policyFiles(w, policy, periods, streamId) {
  const names = Object.fromEntries(w.base.accounts.map((a) => [a.id, a.name]));
  for (const per of periods) {
    w.alias("contract", policy.id, "policy_number", POLICY_NO(policy.id, per.from), per.from);
    w.file({ stream_id: streamId, download_date: per.from, name: `Purrsure-RenewalNotice-${policy.property}-${per.from.slice(0, 4)}.pdf`, bytes: renewalDoc(w, policy, per, names[per.paid_from] || per.paid_from), family: "purrsure-renewal-pdf", container: "pdf", expect: { policy: 1 }, origin: "portal", issued_on: per.from });
    const c = certificateDoc(w, policy, per);
    w.file({ stream_id: streamId, download_date: c.issued, name: `Purrsure-CertificateOfCurrency-${policy.property}-${per.from.slice(0, 4)}.pdf`, bytes: c.bytes, family: "purrsure-certificate-pdf", container: "pdf", expect: { policy: 1 }, origin: "portal", issued_on: c.issued });
  }
}

function run(w) {
  const p = w.base.properties.RENTAL, months = Object.entries(p.months).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  w.setup.party.push({ party_id: "PROPERTYMEOW", kind: "organisation", name: "PropertyMeow", note: "Owner portal for Bayside Property Mgmt." }, { party_id: "GEELONGCONV", kind: "organisation", name: "Geelong Conveyancing Pty Ltd" });
  w.alias("asset", "RENTAL", "owner_ref", p.owner_ref, "2021-08-20"); w.alias("asset", "RENTAL", "name", p.address, "2021-08-20");
  stream(w, "OWN-RENTAL", "Geelong owner statements", "owner_statement", "asset", "RENTAL", "monthly", "2021-09-01", { issuer_party_id: "BAYSIDE", grace_days: 10 });
  const truth = [];
  for (const [ym, x] of months) {
    if (!x.lines.length) continue;
    const r = ownerDoc(w, p, ym, x, months);
    w.file({ stream_id: "OWN-RENTAL", download_date: `${nextMonth(ym)}-02`, name: `PropertyMeow-Owner-RENTAL-${ym}.pdf`, bytes: r.bytes, family: "propertymeow-owner-pdf", container: "pdf", expect: { owner_statement: 1 }, origin: "portal", issued_on: monthEnd(ym) });
    truth.push({ property: "RENTAL", month: ym, gross_rent_cents: toCents(x.rent), fees_cents: toCents(x.fees), disbursed_cents: toCents(x.rent) - toCents(x.fees) });
  }
  w.truth.owner_statements = truth;

  // the settlement that explains ACC-OFF's three lines of 2021-08-20
  const s = { brand: { name: "Geelong Conveyancing Pty Ltd" }, address: p.address, matter: "GC-21-0817", purchaser: "Jordan and Mia Davies", settled_on: "2021-08-20", asset_ref: "RENTAL", price: 64000000, duty: 3307000, legal: 165000, adjustments: 0, loan: 52000000, cash: 12000000 + 3307000 + 165000, lender: "Harbour Bank", loan_number: w.base.loans["LN-INV"].number };
  stream(w, "SETTLE-RENTAL", "Settlement statement, Geelong", "settlement", "asset", "RENTAL", "event", "2021-08-20", { issuer_party_id: "GEELONGCONV" });
  w.file({ stream_id: "SETTLE-RENTAL", download_date: "2021-08-27", name: "Settlement-Statement-Moorabool-Lane.pdf", bytes: settlementDoc(w, s), family: "settlement-pdf", container: "pdf", expect: { settlement: 1 }, origin: "email", issued_on: "2021-08-20" });
  w.truth.settlements = [{ asset: "RENTAL", settled_on: s.settled_on, price_cents: s.price, duty_cents: s.duty, legal_cents: s.legal, loan_drawn_cents: s.loan, cash_paid_cents: s.cash, witnesses: [["ACC-OFF", "2021-08-20", -12000000], ["ACC-OFF", "2021-08-20", -3307000], ["ACC-OFF", "2021-08-20", -165000]] }];

  for (const policy of w.base.policies) {
    const id = `STM-${policy.id}`;
    stream(w, id, `${policy.name} documents`, "policy", "contract", policy.id, "yearly", policy.periods[0].from, { issuer_party_id: "PURRSURE", grace_days: 21 });
    policyFiles(w, policy, policy.periods, id);
  }
  w.truth.policies = w.base.policies.flatMap((pl) => pl.periods.map((x) => ({ contract: pl.id, period_start: x.from, period_end: x.to, premium_cents: toCents(x.premium) })));
}

module.exports = { run, settlementDoc, policyFiles, POLICY_NO, MEOW, SURE };
