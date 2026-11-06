/* RSUs. Northwind's parent is listed in USD. E*Treat vests 25 units a quarter from January 2023. Each parcel is sold the day it vests, except the January 2024
   vest, sold six weeks later, and the last vest, still held: the sheet's only RSU row. Proceeds go to ACC-OLD. */
"use strict";
const { fix, money, aud, addDays, fmtDate, fyOf, fyStart, fyEnd, csvLines, dmy, monthEnd } = require("../lib/util");
const { Doc, MUTED } = require("../lib/pdf");
const { stream } = require("./setup");

const ETREAT = { name: "E*Treat", tagline: "Stock plans, with a biscuit.", color: "#4c1d95" };
const PLAN = "ET-55120-RSU", CODE = "NWGL";
const VESTS = ["2023-01-15", "2023-04-15", "2023-07-15", "2023-10-15", "2024-01-15", "2024-04-15", "2024-07-15", "2024-10-15", "2025-01-15", "2025-04-15", "2025-07-15", "2025-10-15", "2026-01-15", "2026-04-15", "2026-07-15", "2026-10-15", "2027-01-15"];

function model(w) {
  const rng = w.rng("rsu"), vests = [], sales = [];
  // a price and a rate per vest; the last is fixed by the sheet
  let usd = 24.4, fx = 1.46;
  VESTS.forEach((d, i) => {
    usd += rng.range(-0.6, 0.95); fx += rng.range(-0.02, 0.024);
    const last = i === VESTS.length - 1, price = last ? "30.125" : usd.toFixed(3), rate = last ? "1.6000" : fx.toFixed(4);
    const cents = last ? 120500 : Math.round(25 * Number(price) * Number(rate) * 100);
    vests.push({ date: d, units: 25, price, fx: rate, cents, fy: fyOf(d) });
  });
  for (const v of vests) {
    if (v.date === "2027-01-15") continue;
    if (v.date === "2024-01-15") {
      const sold = "2024-02-26", p = (Number(v.price) * 1.043).toFixed(3), r = (Number(v.fx) - 0.0115).toFixed(4), usdGross = Math.round(25 * Number(p) * 100), cents = Math.round(25 * Number(p) * Number(r) * 100);
      sales.push({ vest: v.date, date: sold, units: 25, price: p, fx: r, usd: usdGross, cents, settle: "2024-02-29", ref: "ETS-2402-26" });
      v.taxing = v.date; v.sold = sold; continue;
    }
    sales.push({ vest: v.date, date: v.date, units: 25, price: v.price, fx: v.fx, usd: Math.round(25 * Number(v.price) * 100), cents: v.cents, settle: addDays(v.date, 3), ref: `ETS-${v.date.replace(/-/g, "").slice(2)}` });
    v.taxing = v.date; v.sold = v.date;
  }
  vests[vests.length - 1].taxing = "2027-01-15";
  return { vests, sales };
}

function saleDoc(w, s) {
  const d = new Doc({ brand: ETREAT, title: "Sale confirmation", kicker: `Confirmation ${s.ref}`, deflate: w.deflate });
  d.h1(`Sold ${s.units} ${CODE}`);
  d.kv([["Plan account", PLAN], ["Participant", "Jordan Davies"], ["Security", CODE], ["Trade date", fmtDate(s.date)], ["Settlement date", fmtDate(s.settle)], ["Reference", s.ref]], 3);
  d.h2("Trade");
  d.table([{ label: "Item", w: 320 }, { label: "Amount", w: 120, align: "right" }], [["Quantity", String(s.units)], ["Price (USD)", s.price], ["Proceeds (USD)", money(s.usd)], ["Commission (USD)", money(0)], ["Exchange rate (AUD per USD)", s.fx], ["Net proceeds (AUD)", money(s.cents)]]);
  d.para("Net proceeds were sent to your nominated bank account ending 7731. Fictional confirmation.", { size: 8.5, color: MUTED });
  return d.finish();
}
function essDoc(w, fy, vests) {
  const total = vests.reduce((s, v) => s + v.cents, 0);
  const d = new Doc({ brand: ETREAT, title: "Employee share scheme statement", kicker: `Year ended ${fmtDate(fyEnd(fy))}`, deflate: w.deflate });
  d.h1(`ESS statement, FY${fy}`);
  d.kv([["Plan account", PLAN], ["Participant", "Jordan Davies"], ["Financial year", `FY${fy}`], ["Year end", fmtDate(fyEnd(fy))], ["Provider", "Northwind Global Inc"], ["Scheme", "Restricted stock units, deferred"]], 3);
  d.h2("Discount from taxed-deferred interests");
  d.table([{ label: "Taxing point", w: 100 }, { label: "Units", w: 60, align: "right" }, { label: "Market value (USD)", w: 110, align: "right" }, { label: "AUD per USD", w: 90, align: "right" }, { label: "Discount (AUD)", w: 100, align: "right" }], vests.map((v) => [fmtDate(v.taxing), String(v.units), v.price, v.fx, money(v.cents)]), { foot: ["Total", "", "", "", money(total)] });
  d.para("Report the total at the employee share scheme item of your return. Fictional statement.", { size: 8.5, color: MUTED });
  return d.finish();
}

function run(w) {
  const S = w.setup;
  S.party.push({ party_id: "NORTHWINDPARENT", kind: "company", name: "Northwind Global Inc", note: "Northwind Logistics' USD-listed parent." }, { party_id: "ETREAT", kind: "organisation", name: "E*Treat" });
  S.instrument.push({ instrument_id: CODE, kind: "rsu", code: CODE, name: "Northwind Global Inc", currency: "USD", issuer_party_id: "NORTHWINDPARENT" });
  w.alias("instrument", CODE, "name", CODE, "2022-01-01");
  S.account.push({ account_id: "SHR-RSU", name: "RSUs, Northwind Logistics", class: "asset", type: "ess_plan", reporting_group: "shares", currency: "AUD", institution_party_id: "ETREAT", parent_account_id: "ACC-OLD", opened_on: "2023-01-15", in_scope: false, fidelity: "ledger", contract_id: "C-ESS", note: "Beta on the sheet: only the last vest is held." });
  ["legal", "beneficial", "tax"].forEach((basis) => S.ownership.push({ subject_type: "account", subject_id: "SHR-RSU", party_id: "JORDAN", basis, share_bps: 10000, valid_from: "2023-01-15", recorded_at: "2023-01-15T00:00:00Z" }));
  S.contract.push({ contract_id: "C-ESS", kind: "ess_plan", name: "Northwind RSU plan", counterparty_party_id: "NORTHWINDPARENT", holder_party_id: "JORDAN", account_id: "SHR-RSU", started_on: "2022-07-01" });
  w.termRow("contract", "C-ESS", "vest_schedule", "25 units on the 15th of January, April, July and October", "text", "2023-01-15");
  w.alias("account", "SHR-RSU", "member_number", PLAN, "2023-01-15"); w.alias("contract", "C-ESS", "member_number", PLAN, "2023-01-15");
  stream(w, "RSU-HIST", "E*Treat benefit history", "vest", "contract", "C-ESS", "yearly", "2023-01-15", { issuer_party_id: "ETREAT", grace_days: 30 });
  stream(w, "RSU-ESS", "ESS statement", "ess_statement", "contract", "C-ESS", "yearly", "2023-07-01", { issuer_party_id: "ETREAT", grace_days: 45 });
  stream(w, "RSU-SALE", "Sale confirmations", "contract_note", "account", "SHR-RSU", "event", "2023-01-15", { issuer_party_id: "ETREAT" });
  stream(w, "RSU-HOLD", "Plan holdings", "holding", "account", "SHR-RSU", "event", "2027-01-31", { issuer_party_id: "ETREAT" });
  const m = model(w); w.rsu = m;
  for (const s of m.sales) {
    w.line("ACC-OLD", s.settle, `ETREAT STOCK PLAN ${s.ref}`, s.cents);
    w.file({ stream_id: "RSU-SALE", download_date: s.settle, name: `ETreat-Sale-${s.ref}.pdf`, bytes: saleDoc(w, s), family: "etreat-sale-pdf", container: "pdf", expect: { contract_note: 1 }, origin: "portal", issued_on: s.date });
  }
  // the benefit history, one file a financial year, money in USD with the rate alongside
  for (let fy = 2023; fy <= 2027; fy++) {
    const vs = m.vests.filter((v) => v.fy === fy);
    const rows = [["Participant", "Plan Account", "Security", "Vest Date", "Qty Vested", "Vest FMV (USD)", "AUD per USD", "Taxable Value (AUD)", "Taxing Point", "Status"], ...vs.map((v) => ["Jordan Davies", PLAN, CODE, dmy(v.date), String(v.units), v.price, v.fx, fix(v.cents), dmy(v.taxing), v.sold ? "Sold" : "Held"])];
    w.file({ stream_id: "RSU-HIST", download_date: fy === 2027 ? "2027-02-01" : `${fy}-07-10`, name: `ETreat-BenefitHistory-FY${fy}.csv`, text: csvLines(rows), family: "etreat-benefit-csv", container: "csv", expect: { vest: vs.length, fx_rate: vs.length, price: vs.length }, origin: "portal", issued_on: fy === 2027 ? "2027-02-01" : `${fy}-07-10` });
    if (fy <= 2026) w.file({ stream_id: "RSU-ESS", download_date: `${fy}-07-14`, name: `ETreat-ESS-Statement-FY${fy}.pdf`, bytes: essDoc(w, fy, vs), family: "etreat-ess-pdf", container: "pdf", expect: { ess_statement: 1 }, origin: "portal", issued_on: `${fy}-07-14` });
  }
  // the plan's holding at the sheet's date: 25 units at 49.10 a unit in Australian dollars
  const rows = [["Plan", "Security", "Units", "Price (USD)", "AUD per USD", "Value (AUD)", "As At"], [PLAN, CODE, "25", "30.6875", "1.6000", "1227.50", "31/01/2027"]];
  w.file({ stream_id: "RSU-HOLD", download_date: "2027-02-01", name: "ETreat-Holdings-2027-01-31.csv", text: csvLines(rows), family: "etreat-holdings-csv", container: "csv", expect: { holding: 1, price: 1, fx_rate: 1 }, origin: "portal", issued_on: "2027-02-01" });
  w.truth.rsu = { vests: m.vests, sales: m.sales, held_units: 25, value_cents_2027_01_31: 122750 };
}

module.exports = { run, PLAN, CODE };
