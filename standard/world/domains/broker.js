/* The share portfolio. A cash hub at Cedar Trade funded by an inheritance paid straight to it, two ETFs and one franked share. From June 2025 the portfolio's
   value lands on the sheet's ETF valuation through prices. All new money: no sheeted account is touched. */
"use strict";
const { toCents, fix, money, aud, addDays, fmtDate, monthEnd, monthRange, nextMonth, prevMonth, fyOf, fyStart, fyEnd, csvLines, weekday, pad } = require("../lib/util");
const { Doc, MUTED, period } = require("../lib/pdf");
const { eml, row } = require("../lib/mail");
const { stream } = require("./setup");

const CEDAR = { name: "Cedar Trade", tagline: "Deep roots. Cheap brokerage.", color: "#3f6212" };
const PAW = { name: "Computerpaw", tagline: "Investor services, nine lives.", color: "#7c2d12" };
const ACCOUNT = "CT-118204", HIN = "X0044182096";
const INST = { PAWS: { name: "Pawsitive Australian Shares ETF", kind: "etf" }, WHSK: { name: "Whisker Global Equity ETF", kind: "etf" }, KBBL: { name: "Kibble Group Ltd", kind: "listed_share" } };
const BROKERAGE = 950;
const TRADES = [["2020-07-06", "PAWS", "buy", 300, "62.10"], ["2020-07-06", "KBBL", "buy", 80, "31.25"], ["2020-09-14", "WHSK", "buy", 60, "64.40"], ["2021-02-08", "PAWS", "buy", 150, "68.40"], ["2021-03-10", "KBBL", "buy", 60, "33.40"], ["2022-02-07", "WHSK", "buy", 40, "71.15"], ["2023-08-14", "KBBL", "buy", 100, "19.10"], ["2024-05-20", "KBBL", "sell", 320, "18.60"]];
const SPLIT = { date: "2023-03-15", code: "KBBL", ratio: "2:1" };
const INHERIT = { date: "2020-06-22", cents: 29000000, desc: "ESTATE OF R M DAVIES" };

const ANCH = { PAWS: [["2020-07", 62.1], ["2021-02", 68.4], ["2021-12", 71.2], ["2022-09", 60.5], ["2023-06", 62.8], ["2024-06", 63.9], ["2025-05", 64.6], ["2027-03", 74]], WHSK: [["2020-09", 64.4], ["2022-02", 71.15], ["2022-10", 62], ["2023-12", 70.5], ["2025-06", 78], ["2027-03", 88]], KBBL: [["2020-07", 15.625], ["2021-03", 16.7], ["2023-03", 18.4], ["2023-08", 19.1], ["2024-05", 18.6], ["2025-06", 21], ["2027-03", 23.4]] };
function priceAt(code, ym, rng) {
  const a = ANCH[code]; let i = 0; while (i < a.length - 2 && ym > a[i + 1][0]) i += 1;
  const mdiff = (x, y) => (Number(y.slice(0, 4)) - Number(x.slice(0, 4))) * 12 + Number(y.slice(5)) - Number(x.slice(5));
  const t = Math.max(0, Math.min(1, mdiff(a[i][0], ym) / mdiff(a[i][0], a[i + 1][0])));
  const v = (a[i][1] + (a[i + 1][1] - a[i][1]) * t) * (1 + rng.range(-0.012, 0.012));
  return code === "KBBL" && ym < "2023-03" ? v * 2 : v;  // the anchors are post-split prices
}
const unitValue = (units, price) => Math.round(units * Number(price) * 100);

function model(w) {
  const rng = w.rng("broker"), hold = { PAWS: 0, WHSK: 0, KBBL: 0 }, parcels = { PAWS: [], WHSK: [], KBBL: [] }, price = {}, events = [], months = monthRange("2020-06", "2027-03");
  for (const code of Object.keys(hold)) { price[code] = {}; for (const ym of months) price[code][ym] = priceAt(code, ym, rng); }
  const cash = (date, desc, cents, ref) => { w.line("ACC-BRK", date, desc, cents, { ref: ref || "" }); };
  cash(INHERIT.date, INHERIT.desc, INHERIT.cents, "DEP");
  const notes = [], dists = [], divs = [], cgt = [];
  const todo = [];
  TRADES.forEach((t, i) => todo.push({ date: t[0], order: 1, fn: () => {
    const [date, code, side, units, p] = t, gross = unitValue(units, p), settle = settleDate(date), ref = `CN${900100 + i}`;
    if (side === "buy") {
      const consideration = gross + BROKERAGE;
      hold[code] += units; parcels[code].push({ date, units, cost: consideration, ref });
      notes.push({ date, settle, code, side, units, price: p, brokerage: BROKERAGE, gross, consideration, ref });
      cash(settle, `BUY ${units} ${code} ${ref}`, -consideration, ref);
    } else {
      const consideration = gross - BROKERAGE; hold[code] -= units;
      notes.push({ date, settle, code, side, units, price: p, brokerage: BROKERAGE, gross, consideration, ref });
      cash(settle, `SELL ${units} ${code} ${ref}`, consideration, ref);
      // first in, first out, proceeds spread by units with the last parcel taking the odd cent
      let left = units, used = 0;
      for (const q of parcels[code]) {
        if (!left || !q.units) continue;
        const take = Math.min(left, q.units), proceeds = left === take ? consideration - used : Math.round(consideration * take / units), cost = Math.round(q.cost * take / q.units);
        used += proceeds; q.cost -= cost; q.units -= take; left -= take;
        const held = q.date, gain = proceeds - cost, longTerm = addDays(held, 365) < date;
        cgt.push({ instrument: code, acquired_on: held, disposed_on: date, units: take, proceeds_cents: proceeds, cost_base_cents: cost, gain_cents: gain, discount_eligible: longTerm && gain > 0, owner: "joint" });
      }
    }
  } }));
  todo.push({ date: SPLIT.date, order: 0, fn: () => { hold.KBBL *= 2; for (const q of parcels.KBBL) q.units *= 2; } });
  // distributions and dividends, on holdings at the record date
  const q = []; for (let y = 2020; y <= 2027; y++) for (const m of ["01", "04", "07", "10"]) q.push(`${y}-${m}-16`);
  for (const d of q) if (d > "2020-07-10" && d < "2027-04-01") todo.push({ date: d, order: 2, fn: () => {
    const ym = d.slice(0, 7), units = hold.PAWS; if (!units) return;
    const dpu = 0.56 + rng.range(-0.05, 0.1) + (d.endsWith("07-16") ? 0.18 : 0), net = Math.round(units * dpu * 100), mkt = price.PAWS[ym], n = Math.max(1, Math.floor(net / (mkt * 100))), drp = (net / 100 / n).toFixed(6);
    hold.PAWS += n; parcels.PAWS.push({ date: d, units: n, cost: net, ref: "DRP" });
    dists.push({ code: "PAWS", date: d, units, cash: net, dpu: dpu.toFixed(4), drp_units: n, drp_price: drp });
  } });
  for (let y = 2021; y <= 2027; y++) for (const m of ["01", "07"]) { const d = `${y}-${m}-20`; if (d > "2020-12-31" && d < "2027-04-01") todo.push({ date: d, order: 2, fn: () => {
    const units = hold.WHSK; if (!units) return;
    const dpu = 0.74 + rng.range(-0.08, 0.14), net = Math.round(units * dpu * 100);
    dists.push({ code: "WHSK", date: d, units, cash: net, dpu: dpu.toFixed(4) }); cash(d, `DISTRIBUTION WHSK`, net, "DIST");
  } }); }
  for (let y = 2020; y <= 2026; y++) for (const m of ["03-24", "09-22"]) { const d = `${y}-${m}`; if (d > "2020-08-01" && d <= "2026-09-30") todo.push({ date: d, order: 2, fn: () => {
    const units = hold.KBBL; if (!units) return;
    const dps = (d < SPLIT.date ? 0.62 : 0.33) + rng.range(0, 0.04), amount = Math.round(units * dps * 100), credit = Math.round(amount * 30 / 70);
    divs.push({ code: "KBBL", date: d, units, dps: dps.toFixed(4), franked: amount, unfranked: 0, credit, net: amount }); cash(d, "DIVIDEND KBBL", amount, "DIV");
  } }); }
  todo.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.order - b.order));
  const holdings = {};
  let i = 0;
  for (const ym of months) { const end = monthEnd(ym); while (i < todo.length && todo[i].date <= end) todo[i++].fn(); holdings[ym] = { ...hold }; }
  while (i < todo.length) todo[i++].fn();
  return { price, notes, dists, divs, cgt, holdings, parcels };
}
const settleDate = (d) => { let x = addDays(d, 2); while ([0, 6].includes(weekday(x))) x = addDays(x, 1); return x; };

// the sheet's value lands: WHSK and KBBL at their market, PAWS the balance, its price to six places
function landing(w, m) {
  const out = {}, targets = {};
  for (const b of w.sheet.balances) if (b.account_id === "ETF") targets[b.month_end.slice(0, 7)] = toCents(b.balance);
  for (const ym of monthRange("2020-06", "2027-03")) {
    const h = m.holdings[ym], rows = {};
    const pW = m.price.WHSK[ym].toFixed(4), pK = m.price.KBBL[ym].toFixed(4);
    rows.WHSK = { units: h.WHSK, price: pW, value: unitValue(h.WHSK, pW) }; rows.KBBL = { units: h.KBBL, price: pK, value: unitValue(h.KBBL, pK) };
    if (targets[ym] != null) { const v = targets[ym] - rows.WHSK.value - rows.KBBL.value, p = (v / 100 / h.PAWS).toFixed(6); rows.PAWS = { units: h.PAWS, price: p, value: unitValue(h.PAWS, p) }; if (rows.PAWS.value !== v) throw new Error(`PAWS does not land ${ym}`); }
    else { const p = m.price.PAWS[ym].toFixed(4); rows.PAWS = { units: h.PAWS, price: p, value: unitValue(h.PAWS, p) }; }
    out[ym] = rows;
  }
  return out;
}

function noteDoc(w, n) {
  const d = new Doc({ brand: CEDAR, title: "Contract note", kicker: `Confirmation ${n.ref}`, deflate: w.deflate });
  d.h1(`${n.side === "buy" ? "Bought" : "Sold"} ${INST[n.code].name}`);
  d.kv([["Account", ACCOUNT], ["Holder", "Jordan and Mia Davies"], ["Security code", n.code], ["Trade date", fmtDate(n.date)], ["Settlement date", fmtDate(n.settle)], ["Reference", n.ref]], 3);
  d.h2("Trade");
  d.table([{ label: "Item", w: 320 }, { label: "Amount", w: 120, align: "right" }], [["Quantity", String(n.units)], ["Price", n.price], ["Consideration", money(n.gross)], ["Brokerage", money(n.brokerage)], [n.side === "buy" ? "Total payable" : "Net proceeds", money(n.consideration)]]);
  d.para("Fictional contract note. Cedar Trade is a parody broker; no trade took place.", { size: 8.5, color: MUTED });
  return d.finish();
}

function distDoc(w, x, cedarName) {
  const d = new Doc({ brand: PAW, title: "Distribution statement", kicker: `Payment date ${fmtDate(x.date)}`, deflate: w.deflate });
  d.h1(`${INST[x.code].name} distribution`);
  d.kv([["Holder number", HIN], ["Security code", x.code], ["Units held", String(x.units)], ["Cash per unit", x.dpu], ["Payment date", fmtDate(x.date)], ["Reinvestment plan", x.drp_units ? "Full participation" : "Not participating"]], 3);
  d.h2("Payment");
  const rows = [["Gross distribution", money(x.cash)], ["Tax withheld", money(0)], ["Net distribution", money(x.cash)]];
  if (x.drp_units) { rows.push(["Units allotted", String(x.drp_units)], ["Allotment price", x.drp_price]); }
  d.table([{ label: "Item", w: 320 }, { label: "Amount", w: 120, align: "right" }], rows);
  d.para("The tax character of this payment is on the annual tax statement. Fictional statement.", { size: 8.5, color: MUTED });
  return d.finish();
}

function dividendDoc(w, x) {
  const d = new Doc({ brand: PAW, title: "Dividend statement", kicker: `Payment date ${fmtDate(x.date)}`, deflate: w.deflate, style: "plain" });
  d.h1("Kibble Group Ltd dividend");
  d.kv([["Holder number", HIN], ["Security code", x.code], ["Shares held", String(x.units)], ["Dividend per share", x.dps], ["Payment date", fmtDate(x.date)], ["Franking percentage", "100%"]], 3);
  d.h2("Payment");
  d.table([{ label: "Item", w: 320 }, { label: "Amount", w: 120, align: "right" }], [["Franked amount", money(x.franked)], ["Unfranked amount", money(x.unfranked)], ["Franking credit", money(x.credit)], ["Net payment", money(x.net)]]);
  d.para("Paid to the Cedar Trade cash hub. Fictional statement.", { size: 8.5, color: MUTED });
  return d.finish();
}

function taxStatementDoc(w, code, fy, c) {
  const d = new Doc({ brand: PAW, title: "Annual tax statement", kicker: `Year ended ${fmtDate(fyEnd(fy))}`, deflate: w.deflate });
  d.h1(`${INST[code].name}, FY${fy} tax statement`);
  d.kv([["Holder number", HIN], ["Security code", code], ["Financial year", `FY${fy}`], ["Year end", fmtDate(fyEnd(fy))], ["Holder", "Jordan and Mia Davies"], ["Statement type", "AMMA"]], 3);
  d.h2("Attribution components");
  d.table([{ label: "Component", w: 320 }, { label: "Amount", w: 120, align: "right" }], [["Cash distributions", money(c.cash)], ["Interest", money(c.interest)], ["Franked distributions", money(c.franked)], ["Franking credits", money(c.credit)], ["Unfranked distributions", money(c.unfranked)], ["Foreign income", money(c.foreign)], ["Foreign tax credits", money(c.foreign_credit)], ["Discounted capital gains", money(c.gain)], ["CGT concession", money(c.concession)], ["Tax deferred", money(c.deferred)], ["AMIT cost base increase", money(c.up)], ["AMIT cost base decrease", money(c.down)]]);
  d.para("Your tax agent decides how these amounts apply. Fictional statement.", { size: 8.5, color: MUTED });
  return d.finish();
}

// Attribution: a share of the year's cash to each component, the rest tax deferred, or an AMIT increase in a year attribution passes cash.
function components(code, fy, cash, rng) {
  const interest = Math.round(cash * (code === "PAWS" ? 0.04 : 0.02));
  const franked = code === "PAWS" ? Math.round(cash * 0.62) : 0, credit = Math.round(franked * 30 / 70);
  const unfranked = code === "PAWS" ? Math.round(cash * 0.08) : 0;
  const foreignNet = code === "PAWS" ? Math.round(cash * 0.04) : Math.round(cash * 0.78), foreign_credit = Math.round(foreignNet * 0.15 / 0.85), foreign = foreignNet + foreign_credit;
  const gain = Math.round(cash * (fy >= 2022 && fy <= 2025 ? 0.06 : 0.03)), concession = gain;
  const attributed = interest + franked + unfranked + foreignNet + gain + concession;
  const gap = cash - attributed;
  return { cash, interest, franked, credit, unfranked, foreign, foreign_credit, gain, concession, deferred: gap > 0 ? gap : 0, up: gap < 0 ? -gap : 0, down: gap > 0 ? gap : 0 };
}

function holdingsTsv(rows, asAt) {
  const lines = [["Security", "Description", "Units", "Price", "Market Value", "As At"].join("\t")];
  for (const code of ["KBBL", "PAWS", "WHSK"]) { const r = rows[code]; if (r.units) lines.push([code, INST[code].name, String(r.units), r.price, fix(r.value), asAt].join("\t")); }
  return `${lines.join("\r\n")}\r\n`;
}

function run(w) {
  const S = w.setup;
  S.party.push({ party_id: "CEDAR", kind: "organisation", name: "Cedar Trade" }, { party_id: "COMPUTERPAW", kind: "organisation", name: "Computerpaw" });
  S.account.push({ account_id: "ACC-BRK", name: "Cedar Trade cash hub", class: "asset", type: "brokerage", reporting_group: "cash", currency: "AUD", institution_party_id: "CEDAR", opened_on: "2020-06-15", liquid: true, in_scope: false, fidelity: "ledger", opening_balance_cents: 0, opening_date: "2020-06-15", note: "Not on the sheet. Funded by an inheritance paid straight to it." },
    { account_id: "ETF", name: "Share portfolio (ETFs)", class: "asset", type: "holding", reporting_group: "shares", currency: "AUD", parent_account_id: "ACC-BRK", opened_on: "2020-07-06", in_scope: true, fidelity: "ledger" });
  const pct = (id) => { ["legal", "beneficial", "tax"].forEach((basis) => { for (const p of ["JORDAN", "MIA"]) S.ownership.push({ subject_type: "account", subject_id: id, party_id: p, basis, share_bps: 5000, valid_from: "2020-06-15", recorded_at: "2020-06-15T00:00:00Z" }); }); };
  pct("ACC-BRK"); pct("ETF");
  for (const [code, i] of Object.entries(INST)) { S.instrument.push({ instrument_id: code, kind: i.kind, code, name: i.name, currency: "AUD" }); w.alias("instrument", code, "name", code, "2020-01-01"); }
  w.alias("account", "ACC-BRK", "account_number", ACCOUNT, "2020-06-15"); w.alias("account", "ETF", "hin", HIN, "2020-06-15");
  stream(w, "ACC-BRK", "Cedar Trade cash statement", "transactions", "account", "ACC-BRK", "monthly", "2020-06-15", { issuer_party_id: "CEDAR", grace_days: 10 });
  stream(w, "BRK-NOTES", "Contract notes", "contract_note", "account", "ACC-BRK", "event", "2020-07-06", { issuer_party_id: "CEDAR" });
  stream(w, "BRK-HOLD", "Holdings statements", "holding", "account", "ETF", "yearly", "2020-06-30", { issuer_party_id: "CEDAR", grace_days: 10, note: "Yearly to June 2025, then monthly." });
  stream(w, "REG-DIST", "Distribution and dividend statements", "dividend", "account", "ETF", "event", "2020-08-01", { issuer_party_id: "COMPUTERPAW" });
  stream(w, "REG-TAX", "Annual tax statements", "distribution", "account", "ETF", "yearly", "2021-06-30", { issuer_party_id: "COMPUTERPAW", grace_days: 60 });
  const m = model(w), land = landing(w, m); w.broker = m; w.brokerLand = land;

  for (const n of m.notes) w.file({ stream_id: "BRK-NOTES", download_date: n.date, name: `Cedar-ContractNote-${n.ref}.pdf`, bytes: noteDoc(w, n), family: "cedar-contract-note-pdf", container: "pdf", expect: { contract_note: 1 }, origin: "email", issued_on: n.date });
  for (const x of m.dists) w.file({ stream_id: "REG-DIST", download_date: x.date, name: `Computerpaw-Distribution-${x.code}-${x.date}.pdf`, bytes: distDoc(w, x), family: "computerpaw-distribution-pdf", container: "pdf", expect: { dividend: 1 }, origin: "portal", issued_on: x.date });
  for (const x of m.divs) w.file({ stream_id: "REG-DIST", download_date: x.date, name: `Computerpaw-Dividend-${x.code}-${x.date}.pdf`, bytes: dividendDoc(w, x), family: "computerpaw-dividend-pdf", container: "pdf", expect: { dividend: 1 }, origin: "portal", issued_on: x.date });

  // the split, by email from the registry
  const subject = "Kibble Group Ltd: share split effective 15 March 2023";
  const text = ["Dear shareholder,", "", `Holder number: ${HIN}`, "Security code: KBBL", "Corporate action: split", "Ratio: 2:1", `Effective date: ${fmtDate(SPLIT.date)}`, "", "Each share you hold became two. Your cost base is spread over the new shares.", "", "Computerpaw, a fictional registry."].join("\n");
  w.file({ stream_id: "REG-DIST", download_date: "2023-02-20", name: "Kibble-share-split-notice.eml", text: eml({ from: "Computerpaw Registry <registry@computerpaw.example>", to: "Jordan and Mia Davies <the.davies@mail.example>", subject, date: "2023-02-20", id: "kbbl-split-2023", text, html: `<html><body><table>${row(["Security code", "KBBL"])}${row(["Corporate action", "split"])}${row(["Ratio", "2:1"])}${row(["Effective date", fmtDate(SPLIT.date)])}</table></body></html>` }), family: "computerpaw-action-eml", container: "eml", expect: { corporate_action: 1 }, origin: "email", issued_on: "2023-02-20" });

  // annual tax statements, cash by the year it was paid
  const rng = w.rng("broker:tax"), comps = {};
  for (const code of ["PAWS", "WHSK"]) for (let fy = 2021; fy <= 2026; fy++) {
    const cash = m.dists.filter((x) => x.code === code && fyOf(x.date) === fy).reduce((s, x) => s + x.cash, 0); if (!cash) continue;
    const c = components(code, fy, cash, rng); (comps[fy] = comps[fy] || {})[code] = c;
    w.file({ stream_id: "REG-TAX", download_date: `${fy}-07-25`, name: `Computerpaw-TaxStatement-${code}-FY${fy}.pdf`, bytes: taxStatementDoc(w, code, fy, c), family: "computerpaw-tax-statement-pdf", container: "pdf", expect: { distribution: 1 }, origin: "portal", issued_on: `${fy}-07-25` });
  }
  w.brokerTax = comps;

  // holdings, each 30 June to 2024, then every month from June 2025
  const asAts = [...monthRange("2020-06", "2024-06").filter((ym) => ym.endsWith("-06")), ...monthRange("2025-06", "2027-03")];
  for (const ym of asAts) {
    const end = monthEnd(ym), rows = land[ym], n = Object.values(rows).filter((r) => r.units).length;
    if (!n) continue;
    w.file({ stream_id: "BRK-HOLD", download_date: addDays(end, 3), name: `Cedar-Holdings-${end}.tsv`, text: holdingsTsv(rows, end), family: "cedar-holdings-tsv", container: "tsv", expect: { holding: n, price: n }, origin: "portal", issued_on: addDays(end, 3) });
  }
  w.truth.holdings = Object.fromEntries(asAts.map((ym) => [monthEnd(ym), land[ym]]));
  w.truth.lots = { instruments: m.parcels };
}

/* the cash hub's monthly statement: a junk preamble, the table, a footer. Written last, once every line is in. */
function files(w) {
  const out = hub(w);
  let prev = 0;
  for (const m of out) {
    let b = prev; const t = [["Cedar Trade Pty Ltd - Cash Hub statement"], [`Account: ${ACCOUNT}`], [`Period: ${fmtDate(`${m.ym}-01`)} to ${fmtDate(monthEnd(m.ym))}`], [], ["Date", "Reference", "Details", "Debit", "Credit", "Balance"]];
    for (const r of m.rows) { b += r.cents; t.push([fmtDate(r.date), r.ref || "", r.desc, r.cents < 0 ? fix(-r.cents) : "", r.cents > 0 ? fix(r.cents) : "", fix(b)]); }
    t.push(["Closing balance", "", "", "", "", fix(b)], ["Fictional statement. Cedar Trade is a parody broker."]);
    prev = b;
    w.file({ stream_id: "ACC-BRK", download_date: `${nextMonth(m.ym)}-03`, name: `Cedar-CashHub-${m.ym}.csv`, text: t.map((r) => r.map((c) => (/[",]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\r\n") + "\r\n", family: "cedar-cash-csv", container: "csv", expect: { txn_line: m.rows.length, statement: m.rows.length ? 1 : 0 }, origin: "portal", issued_on: monthEnd(m.ym) });
  }
  return out;
}

/* the hub's lines by month: interest on the month-end balance, low by design, credited on the last day. Safe to call twice. */
function hub(w) {
  if (w.hubMonths) return w.hubMonths;
  const rows = (w.lines["ACC-BRK"] || []).slice();
  const rate = (ym) => (ym < "2022-07" ? 0.0005 : ym < "2023-07" ? 0.0025 : 0.0075);
  const out = [], sorted = rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.seq - b.seq));
  let bal = 0, j = 0; const months = monthRange("2020-06", "2027-03");
  for (const ym of months) {
    const inMonth = []; while (j < sorted.length && sorted[j].date <= monthEnd(ym)) { inMonth.push(sorted[j]); bal += sorted[j].cents; j += 1; }
    const interest = Math.round(bal * rate(ym) / 12);
    if (interest) { inMonth.push({ date: monthEnd(ym), desc: "CASH HUB INTEREST", cents: interest, ref: "INT" }); bal += interest; }
    out.push({ ym, rows: inMonth, closing: bal });
  }
  w.hubMonths = out;
  return out;
}

module.exports = { run, files, hub, ACCOUNT, HIN, INST };
