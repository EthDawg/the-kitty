/* Things: what the household bought and has to replace. Receipts by email, as PDFs and as scans, tied to bank lines where one exists. Warranty is on the receipt; expected life,
   replacement cost, the refresh date and work use are what a person says, so they are terms. A scan has no text layer: an agent reads it and a recipe cannot. */
"use strict";
const { toCents, money, aud, addDays, fmtDate, fyOf, csvLines } = require("../lib/util");
const { Doc, MUTED } = require("../lib/pdf");
const { eml, row } = require("../lib/mail");
const { scan } = require("../lib/png");
const { stream } = require("./setup");

// id, name, kind, merchant, date, cents, account paid from (a new line if flagged), via, serial, warranty years, life months, refresh_by, replacement, work %
const THINGS = [
  { id: "DEV-DESK", name: "Standing desk", kind: "device", merchant: "Officepurr", date: "2020-04-02", cents: 68900, line: ["ACC-EVD", -68900], via: "pdf", serial: "OP-DSK-44120", wy: 5, life: 120, replacement: 89900, work: 100 },
  { id: "DEV-MONITOR", name: "27 inch monitor", kind: "device", merchant: "JB Hi-Fur", date: "2020-04-02", cents: 44900, line: ["ACC-EVD", -44900], via: "eml", serial: "JB-MON-90417", wy: 2, life: 84, refresh: "2027-04-01", replacement: 59900, work: 100 },
  { id: "DEV-COFFEE", name: "Espresso machine", kind: "appliance", merchant: "Myaw", date: "2021-12-20", cents: 44025, line: ["ACC-CC", -44025], via: "eml", serial: "MY-ESP-20771", wy: 2, life: 84, replacement: 54900 },
  { id: "DEV-PRAM", name: "Pram", kind: "appliance", merchant: "Baby Bunny", date: "2022-03-22", cents: 88603, line: ["ACC-CC", -88603], via: "pdf", serial: "BB-PRM-3310", wy: 3, life: 60, replacement: 92900 },
  { id: "DEV-VAC", name: "Robot vacuum", kind: "appliance", merchant: "Myaw", date: "2022-12-19", cents: 56534, line: ["ACC-CC", -56534], via: "eml", serial: "MY-VAC-58821", wy: 2, life: 60, refresh: "2027-12-01", replacement: 69900 },
  { id: "DEV-DISHWASHER", name: "Dishwasher", kind: "appliance", merchant: "Harvey Whiskers", date: "2023-03-14", cents: 114900, new: "HARVEY WHISKERS AUBURN Card xx4471 Value Date: 13/03/2023", via: "pdf", serial: "HW-DSH-77120", wy: 5, life: 120, replacement: 129900 },
  { id: "DEV-FRIDGE", name: "Fridge", kind: "appliance", merchant: "Good Paws Appliances", date: "2024-08-05", cents: 219900, new: "GOOD PAWS APPLIANCES Card xx4471 Value Date: 04/08/2024", via: "eml", serial: "GP-FRG-11904", wy: 3, life: 144, replacement: 249900 },
  { id: "DEV-LAPTOP", name: "Laptop", kind: "device", merchant: "Appurr Store", date: "2025-02-10", cents: 329900, new: "APPURR STORE SYDNEY Card xx4471 Value Date: 09/02/2025", via: "pdf", serial: "AP-LT-C02XK1", wy: 2, life: 36, refresh: "2028-02-01", replacement: 349900, work: 60 },
  { id: "DEV-PHONE", name: "Work phone", kind: "device", merchant: "JB Hi-Fur", date: "2025-10-18", cents: 184900, line: ["ACC-CC", -184900], via: "eml", serial: "JB-PHN-55213", wy: 2, life: 48, refresh: "2029-10-01", replacement: 189900, work: 80 },
  { id: "DEV-TV", name: "Television", kind: "device", merchant: "JB Hi-Fur", date: "2026-11-28", cents: 129900, line: ["ACC-CC", -129900], via: "eml", serial: "JB-TV-71120", wy: 2, life: 96, replacement: 149900 },
];
const SCANS = [
  { id: "DEV-BBQ", name: "Barbecue", kind: "appliance", merchant: "Bunnypaws Warehouse", date: "2019-04-06", accountLine: true, serial: "", wy: 1, life: 96, replacement: 39900, lines: (c) => ["BUNNYPAWS WAREHOUSE COBURG", "TAX INVOICE  ABN 00 000 000 000", "06/04/2019  14:22", "4 BURNER BARBECUE", `TOTAL  $${c}`, "EFTPOS  CARD 4771", "1 YEAR WARRANTY", "FICTIONAL RECEIPT"] },
  { id: "DEV-LADDER", name: "Ladder", kind: "appliance", merchant: "Bunnypaws Warehouse", date: "2025-04-12", accountLine: true, serial: "", wy: 5, life: 180, replacement: 25900, lines: (c) => ["BUNNYPAWS WAREHOUSE COBURG", "TAX INVOICE  ABN 00 000 000 000", "12/04/2025  09:51", "ALUMINIUM LADDER 2.4M", `TOTAL  $${c}`, "CREDIT CARD 1007", "FICTIONAL RECEIPT"] },
  { id: "DEV-WASHER", name: "Washing machine", kind: "appliance", merchant: "Good Paws Appliances", date: "2025-03-02", cents: 109900, new: "GOOD PAWS APPLIANCES Card xx4471 Value Date: 01/03/2025", serial: "GP-WSH-20418", wy: 2, life: 120, replacement: 119900, lines: (c) => ["GOOD PAWS APPLIANCES", "TAX INVOICE  ABN 00 000 000 000", "02/03/2025", "FRONT LOADER WASHER 8KG", "SERIAL GP-WSH-20418", `TOTAL  $${c}`, "2 YEAR WARRANTY", "FICTIONAL RECEIPT"] },
];
const pct = (c) => Math.round(c / 11);

function receiptPdf(w, t) {
  const d = new Doc({ brand: { name: t.merchant }, title: "Tax invoice", deflate: w.deflate, style: "plain" });
  d.h1("Tax invoice");
  d.kv([["Merchant", t.merchant], ["Invoice date", fmtDate(t.date)], ["Payment", t.pay], ["Product type", t.kind], ["Serial number", t.serial], ["Warranty until", fmtDate(t.warranty)]], 3);
  d.table([{ label: "Item", w: 300 }, { label: "Qty", w: 40, align: "right" }, { label: "Amount", w: 100, align: "right" }], [[t.name, "1", money(t.cents)]]);
  d.table([{ label: "Summary", w: 340 }, { label: "Amount", w: 100, align: "right" }], [["GST included", money(pct(t.cents))], ["Total paid", money(t.cents)]]);
  d.para("A fictional invoice from a parody store.", { size: 8.5, color: MUTED });
  return d.finish();
}
function receiptEml(t) {
  const text = [`Thanks for shopping at ${t.merchant}.`, "", `Order date: ${fmtDate(t.date)}`, `Item: ${t.name}`, `Product type: ${t.kind}`, `Serial number: ${t.serial}`, `Warranty until: ${fmtDate(t.warranty)}`, `Paid with: ${t.pay}`, `GST included: ${money(pct(t.cents))}`, `Total: ${money(t.cents)}`, "", "A fictional receipt from a parody store."].join("\n");
  const html = `<html><body><h2>${t.merchant}</h2><table>${row(["Item", t.name])}${row(["Total", money(t.cents)])}</table></body></html>`;
  return eml({ from: `${t.merchant} <orders@store.example>`, to: "Jordan Davies <the.davies@mail.example>", subject: `Your ${t.merchant} receipt`, date: t.date, id: `rcpt-${t.id}`, text, html });
}
function invoiceSubaru(w) {
  return receiptPdf(w, { merchant: "Subpaw Brunswick", date: "2022-11-05", pay: "BPAY", kind: "vehicle", serial: "JF1SK7KL5NG1042", warranty: "2027-11-05", name: "Subaru Forester, 2022", cents: 3890000 });
}

function run(w) {
  const S = w.setup, assets = [];
  const term = w.termRow;
  stream(w, "RECEIPTS", "Receipts", "receipt", "party", "JORDAN", "event", "2019-04-06");
  S.party.push({ party_id: "SUBPAW", kind: "organisation", name: "Subpaw Brunswick" });
  const merchants = new Set();
  for (const t of [...THINGS, ...SCANS]) {
    let cents = t.cents;
    if (t.accountLine) { const b = w.base.transactions.find((x) => x[0] === t.date && /BUNNINGS/.test(x[2])); cents = -toCents(b[3]); t.cents = cents; t.line = [b[1], -cents]; }
    if (t.new) { w.line("ACC-OLD", t.date, t.new, -cents); t.line = ["ACC-OLD", -cents]; }
    t.warranty = `${Number(t.date.slice(0, 4)) + t.wy}${t.date.slice(4)}`;
    t.pay = t.line && t.line[0] === "ACC-CC" ? "Card ending 1007" : t.line && t.line[0] === "ACC-OLD" ? "Card ending 4471" : "Card ending 4771";
    if (!merchants.has(t.merchant)) { merchants.add(t.merchant); const id = t.merchant.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 16); S.party.push({ party_id: id, kind: "organisation", name: t.merchant }); w.alias("party", id, "name", t.merchant); }
    const account = t.id === "DEV-LAPTOP" ? "DEV-LAPTOP" : undefined;
    S.asset.push({ asset_id: t.id, kind: t.kind, name: t.name, ...(account ? { account_id: account } : {}), ...(t.serial ? { serial: t.serial } : {}), acquired_on: t.date });
    w.alias("asset", t.id, "name", t.name, t.date);
    term("asset", t.id, "warranty_until", t.warranty, "date", t.date);
    term("asset", t.id, "expected_life_months", t.life, "int", t.date);
    const refresh = t.refresh || `${Number(t.date.slice(0, 4)) + Math.floor(t.life / 12)}${t.date.slice(4, 7)}-01`;
    term("asset", t.id, "refresh_by", refresh, "date", t.date); term("asset", t.id, "replacement_cost_cents", t.replacement, "cents", t.date);
    if (t.work && t.kind === "device") term("asset", t.id, "work_use_pct", t.work, "pct", t.date);
    assets.push({ asset_id: t.id, name: t.name, kind: t.kind, merchant: t.merchant, acquired_on: t.date, cost_cents: cents, warranty_until: t.warranty, expected_life_months: t.life, refresh_by: refresh, refresh_fy: `FY${fyOf(refresh)}`, replacement_cost_cents: t.replacement, ...(t.work ? { work_use_pct: t.work } : {}), witness: t.line ? [t.line[0], t.date, t.line[1]] : null });
  }
  S.account.push({ account_id: "DEV-LAPTOP", name: "Laptop", class: "asset", type: "device", reporting_group: "device", currency: "AUD", asset_id: "DEV-LAPTOP", opened_on: "2025-02-10", in_scope: false, fidelity: "ledger", note: "Beta on the sheet: a thing with a refresh date." });
  for (const b of ["legal", "beneficial", "tax"]) S.ownership.push({ subject_type: "account", subject_id: "DEV-LAPTOP", party_id: "JORDAN", basis: b, share_bps: 10000, valid_from: "2025-02-10", recorded_at: "2025-02-10T00:00:00Z" });
  for (const t of THINGS) {
    if (t.via === "pdf") w.file({ stream_id: "RECEIPTS", download_date: t.date, name: `Invoice-${t.id}.pdf`, bytes: receiptPdf(w, t), family: "receipt-pdf", container: "pdf", expect: { receipt: 1, asset_fact: 1 }, origin: "email", issued_on: t.date });
    else w.file({ stream_id: "RECEIPTS", download_date: t.date, name: `Receipt-${t.id}.eml`, text: receiptEml(t), family: "receipt-eml", container: "eml", expect: { receipt: 1, asset_fact: 1 }, origin: "email", issued_on: t.date });
  }
  // the car: the dealer's invoice, the BPAY of 5 November 2022 is its witness
  w.alias("asset", "CAR", "name", "Subaru Forester, 2022", "2022-11-05"); w.alias("party", "SUBPAW", "name", "Subpaw Brunswick");
  w.file({ stream_id: "RECEIPTS", download_date: "2022-11-05", name: "Invoice-Subaru-Forester.pdf", bytes: invoiceSubaru(w), family: "receipt-pdf", container: "pdf", expect: { receipt: 1, asset_fact: 1 }, origin: "email", issued_on: "2022-11-05" });
  assets.push({ asset_id: "CAR", name: "Subaru Forester, 2022", kind: "vehicle", merchant: "Subpaw Brunswick", acquired_on: "2022-11-05", cost_cents: 3890000, warranty_until: "2027-11-05", expected_life_months: 120, refresh_by: "2032-11-01", refresh_fy: "FY2033", replacement_cost_cents: 4490000, witness: ["ACC-EVD", "2022-11-05", -3890000] });
  term("asset", "CAR", "expected_life_months", 120, "int", "2022-11-05"); term("asset", "CAR", "refresh_by", "2032-11-01", "date", "2022-11-05"); term("asset", "CAR", "replacement_cost_cents", 4490000, "cents", "2022-11-05"); term("asset", "CAR", "work_use_pct", 18, "pct", "2023-08-07");
  // the scans
  const agent = [];
  for (const t of SCANS) {
    const dollars = money(t.cents), lines = t.lines(dollars), bytes = scan(lines, t.id, w.deflate);
    w.file({ stream_id: "RECEIPTS", download_date: t.date, name: `Scan-${t.id}.png`, bytes, family: "receipt-scan", container: "image", recipe: null, tier: "agent", expect: {}, origin: "scan", issued_on: t.date, note: "An image with no text layer. An agent reads it; no recipe can." });
    agent.push({ path: `sources/RECEIPTS/${t.date}/Scan-${t.id}.png`, kind: "receipt", expected: { merchant_ref: t.merchant, date: t.date, total_cents: t.cents }, quote: lines.join(" | "), witness: t.line ? [t.line[0], t.date, t.line[1]] : null });
  }
  const invoice = ["BALLARAT ROOFING PTY LTD", "TAX INVOICE 2204", "08/04/2025", "ROOF REPAIR AND RIDGE CAPS", "14 LYDIARD COTTAGE LANE", "TOTAL  $4,180.00", "PAID BY TRANSFER", "FICTIONAL INVOICE"];
  w.file({ stream_id: "RECEIPTS", download_date: "2025-04-09", name: "Scan-Ballarat-Roof-Invoice.png", bytes: scan(invoice, "roof", w.deflate), family: "receipt-scan", container: "image", recipe: null, tier: "agent", expect: {}, origin: "scan", issued_on: "2025-04-08", note: "An image with no text layer. An agent reads it; no recipe can." });
  agent.push({ path: "sources/RECEIPTS/2025-04-09/Scan-Ballarat-Roof-Invoice.png", kind: "receipt", expected: { merchant_ref: "Ballarat Roofing Pty Ltd", date: "2025-04-08", total_cents: 418000 }, quote: invoice.join(" | "), witness: ["ACC-RN2", "2025-04-08", -418000] });
  const plan = {}; for (const a of assets) { (plan[a.refresh_fy] = plan[a.refresh_fy] || { cents: 0, assets: [] }); plan[a.refresh_fy].cents += a.replacement_cost_cents; plan[a.refresh_fy].assets.push(a.asset_id); }
  w.truth.assets = { assets, refresh_by_fy: plan };
  w.truth.agent_scans = agent;
}

module.exports = { run };
