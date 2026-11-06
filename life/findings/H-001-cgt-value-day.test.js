/* T4-CGT-VALUE-30-JUNE and T5-CGT-TWO-REGIMES. Act 49 of 2026, as read from search extracts and still unconfirmed, needs a market value for assets held on 30 June 2027, and one disposal after it
   spans two regimes. Nothing in the reference knows that date, so a household holding a share is never asked for the value and a later gain reads under one regime, stated plainly. Assumed tax flags a year,
   not this disposal. The runtime has no way round it: the date belongs in the reference and the gap in tax.js. Unconfirmed law, so the fixture holds the shape, not a rate. */
"use strict";
const test = require("node:test"), assert = require("node:assert");
const { household, run } = require("./kit");

const held = () => household("cgt").person("sam").account("BANK", "transaction", "cash", [["sam", 10000]]).account("PLAN", "brokerage", "shares", [["sam", 10000]]);
const buy = (h) => h.obs("contract_note", { account_ref: "PLAN", instrument_ref: "NWGL", side: "buy", trade_date: "2026-08-01", settlement_date: "2026-08-03", units: "100", price: "10", consideration_cents: 100000, brokerage_cents: 0 });

test("an asset held on the value day is asked for, by name", { todo: "standard/reference: a cgt_value_day series, then standard/engine/tax.js" }, () => {
  const h = held(); buy(h);
  h.line("BANK", "2027-07-02", "COFFEE", -500, 100);
  const L = run(h, { asOf: "2027-07-31" });
  assert.ok(L.review.some((r) => /30 June 2027|market value/i.test(r.what)), "nothing asks for the value on the day");
});
test("a disposal after the value day says it spans two regimes", { todo: "standard/engine/resolve-markets.js lot matches, once the value day exists" }, () => {
  const h = held(); buy(h);
  h.obs("contract_note", { account_ref: "PLAN", instrument_ref: "NWGL", side: "sell", trade_date: "2027-11-22", settlement_date: "2027-11-24", units: "100", price: "14", consideration_cents: 140000, brokerage_cents: 0 });
  const L = run(h, { asOf: "2027-12-31" });
  assert.ok(L.review.some((r) => /two regimes|30 June 2027/i.test(r.what)), "a single-regime gain is a wrong number stated confidently");
});
