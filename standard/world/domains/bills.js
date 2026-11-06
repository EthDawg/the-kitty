/* What arrives for the house: council rates and water as PDFs, electricity by email, gas as a saved page, childcare from a portal, rego notices, a car logbook. Every amount
   is an existing bank line, so a bill clears a line and never makes a new cost. Issuers are parodies; the bank strings stay as the bank wrote them. */
"use strict";
const { toCents, fix, money, aud, addDays, fmtDate, fmtMonth, monthEnd, monthRange, nextMonth, prevMonth, fyOf, csvLines, pad, Rng } = require("../lib/util");
const { Doc, MUTED, M } = require("../lib/pdf");
const { eml, page, row } = require("../lib/mail");
const { workbook } = require("../lib/xlsx");
const { stream } = require("./setup");

const lines = (w, re) => w.base.transactions.filter((t) => re.test(t[2])).map(([date, acct, desc, amt]) => ({ date, acct, desc, cents: -toCents(amt) }));
const ADDR = { HOME: "22 Albion Crescent, Brunswick VIC 3056", RENTAL: "7/41 Moorabool Lane, Geelong VIC 3220", RENTAL2: "14 Lydiard Cottage Lane, Ballarat VIC 3350" };
const REF = { HOME: "RA-220419", RENTAL: "RA-774106", RENTAL2: "RA-305218" };
const WATER_REF = { HOME: "WA-6601842", RENTAL: "WA-2207713", RENTAL2: "WA-4410267" };
const quarter = (d) => { const ym = d.slice(0, 7); const end = prevMonth(ym); return [`${prevMonth(prevMonth(end))}-01`, monthEnd(end)]; };

function ratesDoc(w, x) {
  const d = new Doc({ brand: { name: x.issuer, tagline: "Rates and charges, one paw at a time.", color: "#365314" }, title: "Rates notice", kicker: `Instalment notice ${x.ref}`, deflate: w.deflate });
  d.h1("Your rates instalment");
  d.kv([["Assessment number", REF[x.subject]], ["Ratepayer", x.owner], ["Issue date", fmtDate(x.bill_date)], ["Due date", fmtDate(x.due_on)], ["Rating period", `${fmtDate(x.from)} to ${fmtDate(x.to)}`], ["Instalment due", aud(x.cents)]], 3);
  d.para(`Property: ${ADDR[x.subject]}. Pay by the due date. A fictional council.`, { size: 9 });
  return d.finish();
}
function waterDoc(w, x) {
  const d = new Doc({ brand: { name: x.issuer }, title: "Water bill", deflate: w.deflate, style: "plain" });
  const L = M, R = 316; let y = d.y;
  d.text(L, y, "Your water bill", { size: 16, bold: true }); d.text(R, y, "Charges", { size: 12, bold: true }); y -= 24;
  const left = [["Account", WATER_REF[x.subject]], ["Customer", x.owner], ["Bill date", fmtDate(x.bill_date)], ["Due date", fmtDate(x.due_on)], ["Period from", fmtDate(x.from)], ["Period to", fmtDate(x.to)]];
  const usage = Math.round(x.cents * 0.42), service = x.cents - usage;
  const right = [["Water usage", money(usage)], ["Service charges", money(service)], ["Concession", money(0)], ["Amount due", money(x.cents)]];
  for (let i = 0; i < left.length; i++) { d.text(L, y, left[i][0], { size: 9, color: MUTED }); d.text(L + 84, y, left[i][1], { size: 9.5 }); if (right[i]) { d.text(R, y, right[i][0], { size: 9, color: MUTED }); d.text(R + 200, y, right[i][1], { size: 9.5, align: "right", bold: i === 3 }); } y -= 16; }
  d.y = y - 8;
  d.para(`Supply address: ${ADDR[x.subject]}. A fictional water authority.`, { size: 9 });
  return d.finish();
}
function energyEmail(x) {
  const gst = Math.round(x.cents / 11);
  const text = ["Hi Jordan and Mia,", "", "Your electricity bill is ready.", "", "Account: EL-5507712", `Bill date: ${fmtDate(x.bill_date)}`, `Due date: ${fmtDate(x.due_on)}`, `Supply from: ${fmtDate(x.from)}`, `Supply to: ${fmtDate(x.to)}`, `Usage: ${Math.round(x.cents / 31)} kWh`, `GST included: ${money(gst)}`, `Amount due: ${money(x.cents)}`, "", `${x.issuer}, a fictional retailer.`].join("\n");
  const html = `<html><body><p>Your electricity bill is ready.</p><table>${row(["Account", "EL-5507712"])}${row(["Amount due", money(x.cents)])}${row(["Due date", fmtDate(x.due_on)])}</table></body></html>`;
  return eml({ from: `${x.issuer} <bills@redpaw.example>`, to: "Jordan and Mia Davies <the.davies@mail.example>", subject: `Your electricity bill for ${fmtMonth(x.to.slice(0, 7))}`, date: x.bill_date, id: `elec-${x.bill_date}`, text, html });
}
function gasPage(x) {
  const gst = Math.round(x.cents / 11);
  const body = `<h1>Gas bill</h1><table>${row(["Retailer", x.issuer])}${row(["Account", "GS-8841207"])}${row(["Supply address", ADDR.HOME])}${row(["Bill date", fmtDate(x.bill_date)])}${row(["Due date", fmtDate(x.due_on)])}${row(["Period from", fmtDate(x.from)])}${row(["Period to", fmtDate(x.to)])}${row(["GST included", money(gst)])}${row(["Amount due", money(x.cents)])}</table>`;
  return page(`Origpurr Gas bill ${fmtDate(x.bill_date)}`, body);
}
function regoDoc(w, x) {
  const d = new Doc({ brand: { name: "VicPaws", tagline: "Roads, rego and the odd dog.", color: "#1d4ed8" }, title: "Vehicle registration", kicker: `Notice ${x.ref}`, deflate: w.deflate });
  d.h1("Vehicle registration renewal");
  d.kv([["Registration number", x.plate], ["Vehicle", x.vehicle], ["Registered operator", "Jordan Davies"], ["Issue date", fmtDate(x.bill_date)], ["Due date", fmtDate(x.due_on)], ["Registered until", fmtDate(x.until)], ["Amount payable", aud(x.cents)], ["TAC charge included", "Yes"]], 3);
  d.para("Fictional notice from a parody road authority.", { size: 8.5, color: MUTED });
  return d.finish();
}
function childcarePage(x) {
  const body = `<h1>Statement of account</h1><p>Provider: Kittenhood Early Learning</p><p>Child: Ava Davies</p><table>${row(["Item", "Amount"], "th")}${row(["Period start", fmtDate(`${x.ym}-01`)])}${row(["Period end", fmtDate(monthEnd(x.ym))])}${row(["Sessions", String(x.days)])}${row(["Daily fee", money(x.daily)])}${row(["Gross fee", money(x.gross)])}${row(["Child Care Subsidy", money(-x.subsidy)])}${row(["Gap you pay", money(x.gap)])}</table>`;
  return page(`Kittenhood statement ${fmtMonth(x.ym)}`, body);
}

function run(w) {
  const S = w.setup, truth = [];
  const P = (party_id, name) => { if (!S.party.some((p) => p.party_id === party_id)) { S.party.push({ party_id, kind: "organisation", name }); w.alias("party", party_id, "name", name); } };
  const owner = { HOME: "Jordan and Mia Davies", RENTAL: "Jordan and Mia Davies", RENTAL2: "Mia Davies" };
  for (const k of Object.keys(REF)) { w.alias("asset", k, "name", REF[k], "2019-03-01"); w.alias("asset", k, "name", WATER_REF[k], "2019-03-01"); }
  w.alias("asset", "HOME", "name", ADDR.HOME, "2019-03-15"); w.alias("asset", "HOME", "name", "EL-5507712", "2019-03-01"); w.alias("asset", "HOME", "name", "GS-8841207", "2019-03-01");
  const bill = (kind, subject, list, issuer, party, make) => {
    P(party, issuer);
    const id = `BILL-${kind.toUpperCase()}-${subject}`;
    stream(w, id, `${issuer} ${kind}`, "bill", "asset", subject, "quarterly", list[0].date.slice(0, 7) + "-01", { issuer_party_id: party, grace_days: 21 });
    for (const l of list) {
      const [from, to] = quarter(l.date), x = { issuer, subject, owner: owner[subject], cents: l.cents, bill_date: addDays(l.date, -24), due_on: addDays(l.date, 3), from, to, ref: `${subject}-${l.date.slice(0, 7)}` };
      const f = make(x, id);
      w.file({ stream_id: id, download_date: x.bill_date, expect: { bill: 1 }, issued_on: x.bill_date, ...f });
      truth.push({ kind, subject, issuer, bill_date: x.bill_date, amount_cents: l.cents, line: [l.acct, l.date, -l.cents] });
    }
  };
  const ratesFile = (x) => ({ name: `Rates-${x.subject}-${x.bill_date}.pdf`, bytes: ratesDoc(w, x), family: "council-rates-pdf", container: "pdf", origin: "portal" });
  const waterFile = (x) => ({ name: `Water-${x.subject}-${x.bill_date}.pdf`, bytes: waterDoc(w, x), family: "water-bill-pdf", container: "pdf", origin: "portal" });
  bill("rates", "HOME", lines(w, /CITY COUNCIL RATES$/), "Merri-Purr City Council", "MERRIPURR", ratesFile);
  bill("rates", "RENTAL", lines(w, /^CITY OF GREATER GEELONG RATES$/), "City of Greater Geelclaw", "GEELCLAW", ratesFile);
  bill("rates", "RENTAL2", w.rental2.bills.filter((b) => b.kind === "rates").map((b) => ({ date: b.date, cents: b.cents, acct: "ACC-RN2" })), "City of Ballapaw", "BALLAPAW", ratesFile);
  bill("water", "HOME", lines(w, /^(YARRA VALLEY WATER|GREATER WESTERN WATER)$/), "Greater Whisker Water", "WHISKERWATER", waterFile);
  bill("water", "RENTAL", lines(w, /^BARWON WATER$/), "Barwon Purr Water", "BARWONPURR", waterFile);
  bill("water", "RENTAL2", w.rental2.bills.filter((b) => b.kind === "water").map((b) => ({ date: b.date, cents: b.cents, acct: "ACC-RN2" })), "Central Highland Paws Water", "HIGHLANDPAWS", waterFile);
  bill("power", "HOME", lines(w, /^(AGL|RED ENERGY) ELECTRICITY$/), "RedPaw Energy", "REDPAW", (x) => ({ name: `Electricity-${x.bill_date}.eml`, text: energyEmail(x), family: "energy-bill-eml", container: "eml", origin: "email" }));
  bill("gas", "HOME", lines(w, /^ORIGIN GAS$/), "Origpurr Gas", "ORIGPURR", (x) => ({ name: `Gas-${x.bill_date}.html`, text: gasPage(x), family: "gas-bill-html", container: "html", origin: "portal" }));

  // rego. The Mazda to November 2022, then the Subaru.
  P("VICPAWS", "VicPaws");
  S.asset.push({ asset_id: "MAZDA", kind: "vehicle", name: "Mazda 3, 2012", account_id: "MAZDA", acquired_on: "2015-05-02", disposed_on: "2022-11-05", note: "Sold to a neighbour for cash." });
  S.account.push({ account_id: "MAZDA", name: "Mazda 3", class: "asset", type: "vehicle", reporting_group: "vehicle", currency: "AUD", asset_id: "MAZDA", opened_on: "2015-05-02", closed_on: "2022-11-05", in_scope: false, fidelity: "ledger", opening_balance_cents: 950000, opening_date: "2019-03-01", note: "Off the sheet, carried at what it sold for." });
  for (const b of ["legal", "beneficial", "tax"]) for (const p of ["JORDAN", "MIA"]) S.ownership.push({ subject_type: "account", subject_id: "MAZDA", party_id: p, basis: b, share_bps: 5000, valid_from: "2015-05-02", valid_to: "2022-11-06", recorded_at: "2019-03-01T00:00:00Z" });
  w.alias("asset", "MAZDA", "name", "1XP-2LK", "2015-05-02", "2022-11-06"); w.alias("asset", "CAR", "name", "BCA-777", "2022-11-05");
  stream(w, "REGO", "Vehicle registration notices", "bill", "asset", "CAR", "yearly", "2019-10-01", { issuer_party_id: "VICPAWS", grace_days: 14 });
  for (const l of lines(w, /^VICROADS REGISTRATION$/)) {
    const old = l.date < "2022-11-05", x = { plate: old ? "1XP-2LK" : "BCA-777", vehicle: old ? "Mazda 3, 2012" : "Subaru Forester, 2022", cents: l.cents, bill_date: addDays(l.date, -21), due_on: addDays(l.date, 3), until: `${Number(l.date.slice(0, 4)) + 1}-10-09`, ref: `VP-${l.date.slice(0, 7)}` };
    w.file({ stream_id: "REGO", download_date: x.bill_date, name: `VicPaws-Rego-${l.date.slice(0, 4)}.pdf`, bytes: regoDoc(w, x), family: "vicpaws-rego-pdf", container: "pdf", expect: { bill: 1, term_notice: 1 }, origin: "portal", issued_on: x.bill_date });
    truth.push({ kind: "rego", subject: old ? "MAZDA" : "CAR", issuer: "VicPaws", bill_date: x.bill_date, amount_cents: l.cents, line: [l.acct, l.date, -l.cents] });
  }

  // childcare: the gap is the bank line; the fee and the subsidy come from three days a week at the day's rate
  P("KITTENHOOD", "Kittenhood Early Learning");
  S.contract.push({ contract_id: "C-CHILDCARE", kind: "childcare", name: "Kittenhood Early Learning", counterparty_party_id: "KITTENHOOD", holder_party_id: "AVA", category_id: "CHILDCARE", started_on: "2023-07-01" });
  w.alias("party", "AVA", "name", "Ava Davies");
  stream(w, "CHILDCARE", "Childcare statements", "childcare_statement", "contract", "C-CHILDCARE", "monthly", "2023-07-01", { issuer_party_id: "KITTENHOOD", grace_days: 7 });
  const ccs = [];
  for (const l of lines(w, /^LITTLE OAKS EARLY LEARNING/)) {
    const ym = l.date.slice(0, 7), pct = ym < "2024-07" ? 0.46 : ym < "2025-07" ? 0.44 : 0.42, gross = Math.round(l.cents / (1 - pct)), subsidy = gross - l.cents, days = 13, daily = Math.round(gross / days);
    const x = { ym, days, daily, gross, subsidy, gap: l.cents };
    w.file({ stream_id: "CHILDCARE", download_date: l.date, name: `Kittenhood-Statement-${ym}.html`, text: childcarePage(x), family: "kittenhood-statement-html", container: "html", expect: { childcare_statement: 1 }, origin: "portal", issued_on: l.date });
    ccs.push({ month: ym, gross_fee_cents: gross, subsidy_cents: subsidy, gap_cents: l.cents, line: [l.acct, l.date, -l.cents] });
  }

  // one 12-week car logbook
  const rows = [["Vehicle logbook, BCA-777"], ["Driver", "Jordan Davies"], ["Financial year", "FY2024"], ["Vehicle", "Subaru Forester, 2022"], [], ["Week ending", "Odometer start", "Odometer end", "Business km"]];
  let odo = 18420; const rng = new Rng("logbook"); let total = 0, drove = 0;
  for (let i = 0; i < 12; i++) { const k = rng.int(180, 340), b = rng.int(30, 90), end = addDays("2023-08-13", i * 7); rows.push([{ date: end }, odo, odo + k, b]); odo += k; total += b; drove += k; }
  rows.push([], ["Total", null, drove, total]);
  stream(w, "LOGBOOK", "Car logbook", "work_log", "asset", "CAR", "event", "2023-08-07", { note: "Good for five years." });
  w.file({ stream_id: "LOGBOOK", download_date: "2023-11-05", name: "Car-Logbook-2023.xlsx", bytes: workbook([{ name: "Logbook", rows }], w.deflateRaw), family: "logbook-xlsx", container: "xlsx", expect: { work_log: 12 }, origin: "manual", issued_on: "2023-11-05" });
  w.truth.bills = truth; w.truth.childcare = ccs; w.truth.logbook = { business_km: total, total_km: drove, weeks: 12 };
}

module.exports = { run };
