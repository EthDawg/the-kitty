/* What the big things are worth. An appraisal PDF each June to 2024, then a month-end estimate feed from June 2025 that lands on the sheet to the cent. */
"use strict";
const { toCents, fix, aud, fmtDate, monthEnd, monthRange, addDays, dmy, csvLines, nextMonth } = require("../lib/util");
const { Doc, MUTED } = require("../lib/pdf");
const { stream } = require("./setup");

const NAMES = { HOME: "22 Albion Crescent, Brunswick VIC 3056", RENTAL: "7/41 Moorabool Lane, Geelong VIC 3220", RENTAL2: "14 Lydiard Cottage Lane, Ballarat VIC 3350", CAR: "Subaru Forester, 2022" };
const ANNUAL = { HOME: [["2019-03-15", 104500000], ["2019-06-30", 104800000], ["2020-06-30", 106000000], ["2021-06-30", 115000000], ["2022-06-30", 121000000], ["2023-06-30", 115000000], ["2024-06-30", 117000000]],
  RENTAL: [["2021-08-20", 64000000], ["2022-06-30", 69000000], ["2023-06-30", 70500000], ["2024-06-30", 72200000]],
  RENTAL2: [["2023-11-15", 39500000], ["2024-06-30", 40200000], ["2025-06-30", 41100000], ["2026-06-30", 42600000]],
  CAR: [["2022-11-05", 3890000], ["2023-06-30", 3500000], ["2024-06-30", 3150000]] };
const VALUER = { HOME: "Paws and Pillars Valuers", RENTAL: "Paws and Pillars Valuers", RENTAL2: "Goldfields Realty", CAR: "RedBook Purr" };

function appraisalDoc(w, subject, asAt, cents) {
  const d = new Doc({ brand: { name: VALUER[subject], tagline: "An opinion of value, with whiskers.", color: "#57534e" }, title: "Valuation", kicker: `As at ${fmtDate(asAt)}`, deflate: w.deflate });
  d.h1("Opinion of value");
  d.kv([["Subject", NAMES[subject]], ["Valued as at", fmtDate(asAt)], ["Basis", subject === "CAR" ? "Estimate" : "Appraisal"], ["Opinion of value", aud(cents)]], 2);
  d.para("A desktop opinion for the owner's records. Fictional.", { size: 8.5, color: MUTED });
  return d.finish();
}

function run(w) {
  const S = w.setup;
  S.party.push({ party_id: "VALUERS", kind: "organisation", name: "Paws and Pillars Valuers" }, { party_id: "REDBOOK", kind: "organisation", name: "RedBook Purr" }, { party_id: "PAWPRICE", kind: "organisation", name: "PawPrice Estimates" });
  stream(w, "APPRAISALS", "Appraisals", "valuation", "asset", "HOME", "yearly", "2019-03-15", { issuer_party_id: "VALUERS", grace_days: 30, note: "Every asset's yearly opinion." });
  stream(w, "PAWPRICE", "PawPrice monthly estimates", "valuation", "asset", "HOME", "monthly", "2025-06-30", { issuer_party_id: "PAWPRICE", grace_days: 7 });
  const truth = [];
  for (const [subject, rows] of Object.entries(ANNUAL)) for (const [asAt, cents] of rows) {
    w.file({ stream_id: "APPRAISALS", download_date: addDays(asAt, 5), name: `Valuation-${subject}-${asAt}.pdf`, bytes: appraisalDoc(w, subject, asAt, cents), family: "appraisal-pdf", container: "pdf", expect: { valuation: 1 }, origin: "email", issued_on: addDays(asAt, 5) });
    truth.push({ subject, as_at: asAt, value_cents: cents, source: "appraisal" });
  }
  const sheet = {}; for (const b of w.sheet.balances) if (["HOME", "RENTAL", "CAR"].includes(b.account_id)) (sheet[b.month_end.slice(0, 7)] = sheet[b.month_end.slice(0, 7)] || {})[b.account_id] = toCents(b.balance);
  const last = sheet["2027-01"];
  for (const ym of monthRange("2025-06", "2027-03")) {
    const v = sheet[ym] || { HOME: last.HOME + (ym === "2027-02" ? 300000 : 600000), RENTAL: last.RENTAL + (ym === "2027-02" ? 200000 : 400000), CAR: last.CAR - (ym === "2027-02" ? 30000 : 60000) };
    const end = monthEnd(ym), rows = [["Subject", "As At", "Estimate", "Method", "Provider"]];
    for (const k of ["HOME", "RENTAL", "CAR"]) { rows.push([NAMES[k], dmy(end), fix(v[k]), k === "CAR" ? "estimate" : "appraisal", "PawPrice Estimates"]); truth.push({ subject: k, as_at: end, value_cents: v[k], source: sheet[ym] ? "sheet" : "after the sheet" }); }
    if (ym === "2027-01") { rows.push(["Laptop", dmy(end), "2400.00", "estimate", "Owner"]); truth.push({ subject: "DEV-LAPTOP", as_at: end, value_cents: 240000, source: "sheet" }); }
    w.file({ stream_id: "PAWPRICE", download_date: addDays(end, 2), name: `PawPrice-Estimates-${ym}.csv`, text: csvLines(rows), family: "pawprice-estimates-csv", container: "csv", expect: { valuation: rows.length - 1 }, origin: "portal", issued_on: addDays(end, 2) });
  }
  w.truth.valuations = truth;
}

module.exports = { run };
