/* Crypto, Jordan's. Coinpurr, an exchange, as a CSV a financial year, and a self-custody wallet as JSON. Buys come from ACC-OLD. A swap is a disposal, a move between
   his own wallets is not, staking rewards are income, one sale is at a loss. The holdings land on the sheet's 1,850.40 at 2027-01-31. Fictional coins. */
"use strict";
const { fix, money, addDays, fmtDate, fyOf, fyEnd, csvLines } = require("../lib/util");
const { page, row } = require("../lib/mail");
const { stream } = require("./setup");

const EXCHANGE = "CP-11820", WALLET = "0xPAW7c31e0d9a4b2f6581cd07e";
const pu = (u) => Number(u).toFixed(8).replace(/0+$/, "").replace(/\.$/, "");

function model() {
  // [iso time, type, asset, units, aud cents, quote asset, quote units, fee units, wallet]
  const T = [];
  const add = (time, type, asset, units, aud, x) => T.push({ time, type, asset, units, aud, ...(x || {}) });
  add("2023-05-02T03:12:44Z", "buy", "PAWC", 0.398, 60000, { wallet: "ex", fee: 0.002 });
  add("2023-09-11T22:40:05Z", "buy", "MEOW", 2.985, 60000, { wallet: "ex", fee: 0.015 });
  add("2024-01-20T01:05:31Z", "swap", "PAWC", 0.1, 21500, { wallet: "ex", quote_asset: "MEOW", quote_units: 0.92 });
  add("2024-03-05T07:18:02Z", "transfer_out", "MEOW", 2.5, null, { wallet: "ex", fee: 0.002, txid: "0xmove7741" });
  add("2024-03-05T07:31:47Z", "transfer_in", "MEOW", 2.5, null, { wallet: "cold", txid: "0xmove7741" });
  for (const [t, u, a] of [["2024-06-30T00:00:00Z", 0.021, 520], ["2024-09-30T00:00:00Z", 0.022, 495], ["2024-12-31T00:00:00Z", 0.023, 610], ["2025-03-31T00:00:00Z", 0.023, 540], ["2025-06-30T00:00:00Z", 0.024, 505], ["2025-09-30T00:00:00Z", 0.024, 570], ["2025-12-31T00:00:00Z", 0.025, 640], ["2026-03-31T00:00:00Z", 0.025, 655], ["2026-06-30T00:00:00Z", 0.026, 690], ["2026-09-30T00:00:00Z", 0.026, 720], ["2026-12-31T00:00:00Z", 0.027, 790]]) add(t, "stake_reward", "MEOW", u, a, { wallet: "cold", txid: `0xstake${t.slice(0, 7).replace("-", "")}` });
  add("2025-06-10T04:44:19Z", "sell", "MEOW", 0.5, 8200, { wallet: "ex", fee: 0 });
  add("2026-05-14T02:02:57Z", "buy", "PAWC", 0.1194, 38500, { wallet: "ex", fee: 0.0006 });
  T.sort((a, b) => (a.time < b.time ? -1 : 1));
  T.forEach((t, i) => { t.txid = t.txid || `cp${String(500100 + i)}`; });
  return T;
}

// first in, first out across both wallets; a move is not a disposal
function cgt(T) {
  const lots = { PAWC: [], MEOW: [] }, out = [];
  const take = (asset, units, proceeds, date) => {
    let left = units, used = 0;
    for (const l of lots[asset]) {
      if (left < 1e-9 || l.units < 1e-9) continue;
      const q = Math.min(left, l.units), p = q >= left - 1e-9 ? proceeds - used : Math.round(proceeds * q / units), cost = Math.round(l.cost * q / l.units);
      used += p; l.cost -= cost; l.units = Math.round((l.units - q) * 1e8) / 1e8; left = Math.round((left - q) * 1e8) / 1e8;
      out.push({ asset, acquired_on: l.date, disposed_on: date, units: q, proceeds_cents: p, cost_base_cents: cost, gain_cents: p - cost, discount_eligible: addDays(l.date, 365) < date && p > cost, owner: "JORDAN" });
    }
  };
  for (const t of T) {
    const d = t.time.slice(0, 10);
    if (t.type === "buy") lots[t.asset].push({ date: d, units: t.units, cost: t.aud });
    if (t.type === "stake_reward") lots[t.asset].push({ date: d, units: t.units, cost: t.aud });
    if (t.type === "sell") take(t.asset, t.units, t.aud, d);
    if (t.type === "swap") { take(t.asset, t.units, t.aud, d); lots[t.quote_asset].push({ date: d, units: t.quote_units, cost: t.aud }); }
  }
  return { gains: out, lots };
}

function units(T) {
  const h = { ex: { PAWC: 0, MEOW: 0 }, cold: { PAWC: 0, MEOW: 0 } };
  const r = (x) => Math.round(x * 1e8) / 1e8;
  for (const t of T) {
    if (t.time > "2027-01-31T23:59:59Z") continue;
    const w = t.wallet;
    if (t.type === "buy" || t.type === "stake_reward" || t.type === "transfer_in") h[w][t.asset] = r(h[w][t.asset] + t.units);
    if (t.type === "sell" || t.type === "transfer_out") h[w][t.asset] = r(h[w][t.asset] - t.units - (t.type === "transfer_out" ? t.fee : 0));
    if (t.type === "swap") { h[w][t.asset] = r(h[w][t.asset] - t.units); h[w][t.quote_asset] = r(h[w][t.quote_asset] + t.quote_units); }
  }
  return h;
}

function exchangeCsv(rows) {
  return csvLines([["Timestamp (UTC)", "Type", "Asset", "Quantity", "Counter Asset", "Counter Quantity", "AUD Value", "Fee", "Fee Asset", "Transaction ID"], ...rows.map((t) => [t.time, t.type.toUpperCase(), t.asset, pu(t.type === "sell" || t.type === "swap" || t.type === "transfer_out" ? -t.units : t.units), t.quote_asset || "", t.quote_units ? pu(t.quote_units) : "", t.aud == null ? "" : fix(t.aud), t.fee ? pu(t.fee) : "", t.fee ? t.asset : "", t.txid])]);
}

function run(w) {
  const S = w.setup, T = model(), c = cgt(T), h = units(T);
  S.party.push({ party_id: "COINPURR", kind: "organisation", name: "Coinpurr" });
  S.instrument.push({ instrument_id: "PAWC", kind: "crypto", code: "PAWC", name: "Pawcoin", currency: "AUD" }, { instrument_id: "MEOW", kind: "crypto", code: "MEOW", name: "Meowchain", currency: "AUD" });
  w.alias("instrument", "PAWC", "name", "PAWC", "2023-01-01"); w.alias("instrument", "MEOW", "name", "MEOW", "2023-01-01");
  S.account.push({ account_id: "CRYPTO", name: "Crypto wallet", class: "asset", type: "wallet", reporting_group: "crypto", currency: "AUD", institution_party_id: "COINPURR", parent_account_id: "ACC-OLD", opened_on: "2023-05-02", in_scope: false, fidelity: "ledger", note: "Beta on the sheet. The exchange account and the self-custody wallet are one account here, so a move between them nets to nothing." });
  ["legal", "beneficial", "tax"].forEach((basis) => S.ownership.push({ subject_type: "account", subject_id: "CRYPTO", party_id: "JORDAN", basis, share_bps: 10000, valid_from: "2023-05-02", recorded_at: "2023-05-02T00:00:00Z" }));
  w.alias("account", "CRYPTO", "wallet_address", EXCHANGE, "2023-05-02"); w.alias("account", "CRYPTO", "wallet_address", WALLET, "2024-03-05");
  stream(w, "CRYPTO-EX", "Coinpurr activity", "crypto_txn", "account", "CRYPTO", "yearly", "2023-05-02", { issuer_party_id: "COINPURR", grace_days: 30 });
  stream(w, "CRYPTO-COLD", "Self-custody wallet export", "crypto_txn", "account", "CRYPTO", "yearly", "2024-03-05", { grace_days: 30 });
  stream(w, "CRYPTO-STMT", "Coinpurr statement", "holding", "account", "CRYPTO", "event", "2027-01-31", { issuer_party_id: "COINPURR" });
  for (const t of T) {
    const d = t.time.slice(0, 10);
    if (t.type === "buy") w.line("ACC-OLD", d, `COINPURR PTY LTD BUY ${t.txid}`, -t.aud);
    if (t.type === "sell") w.line("ACC-OLD", d, `COINPURR PTY LTD WITHDRAWAL ${t.txid}`, t.aud);
  }
  for (let fy = 2023; fy <= 2027; fy++) {
    const rows = T.filter((t) => t.wallet === "ex" && fyOf(t.time.slice(0, 10)) === fy);
    if (rows.length) w.file({ stream_id: "CRYPTO-EX", download_date: fy === 2027 ? "2027-02-01" : `${fy}-07-03`, name: `Coinpurr-Activity-FY${fy}.csv`, text: exchangeCsv(rows), family: "coinpurr-csv", container: "csv", expect: { crypto_txn: rows.length }, origin: "portal", issued_on: fy === 2027 ? "2027-02-01" : `${fy}-07-03` });
    const cold = T.filter((t) => t.wallet === "cold" && fyOf(t.time.slice(0, 10)) === fy);
    if (cold.length) {
      const doc = { address: WALLET, network: "meowchain-mainnet", exported: fy === 2027 ? "2027-02-01" : `${fy}-07-03`, transfers: cold.map((t) => ({ hash: t.txid, ts: t.time, kind: t.type === "stake_reward" ? "STAKING_REWARD" : "RECEIVE", token: t.asset, qty: pu(t.units), valueAud: t.aud == null ? null : t.aud / 100 })) };
      w.file({ stream_id: "CRYPTO-COLD", download_date: doc.exported, name: `wallet-export-FY${fy}.json`, text: `${JSON.stringify(doc, null, 2)}\n`, family: "wallet-json", container: "json", expect: { crypto_txn: cold.length }, origin: "connector", issued_on: doc.exported });
    }
  }
  // the statement that lands: PAWC at a market price, MEOW the rest
  const pawc = h.ex.PAWC + h.cold.PAWC, meow = h.ex.MEOW + h.cold.MEOW, pPaw = "2810.00", vPaw = Math.round(pawc * 2810 * 100), vMeow = 185040 - vPaw, pMeow = (vMeow / 100 / meow).toFixed(6);
  if (vMeow <= 0 || Math.round(meow * Number(pMeow) * 100) !== vMeow) throw new Error("crypto does not land");
  const body = `<h1>Coinpurr statement</h1><p>Account ${EXCHANGE}</p><p>As at 31 Jan 2027</p><table>${row(["Asset", "Units", "Price (AUD)", "Value (AUD)"], "th")}${row(["PAWC", pu(pawc), pPaw, fix(vPaw)])}${row(["MEOW", pu(meow), pMeow, fix(vMeow)])}${row(["Total", "", "", fix(185040)])}</table>`;
  w.file({ stream_id: "CRYPTO-STMT", download_date: "2027-02-01", name: "Coinpurr-Statement-2027-01-31.html", text: page("Coinpurr statement", body), family: "coinpurr-statement-html", container: "html", expect: { holding: 2, price: 2 }, origin: "portal", issued_on: "2027-02-01", note: "Units include the self-custody wallet, as the holder's own tracker sums them." });
  w.crypto = { txns: T, gains: c.gains, income: T.filter((t) => t.type === "stake_reward"), units: h };
  w.truth.crypto = { units: h, value_cents_2027_01_31: 185040, gains: c.gains, txns: T.length };
}

module.exports = { run };
