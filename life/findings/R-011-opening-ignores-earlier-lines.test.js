/* A statement's opening balance already holds everything charged before it. finishOpenings posts that opening on the day before period_start and leaves every line dated
   earlier on the ledger too, so those lines count twice. Blind run ch01, F043: a card's activity file reached back to 1 December, its oldest statement opened on 15 December,
   and the balance was out by exactly the charges from 1 to 13 December. L3 and L8 fail, so nothing is silent, but the figure a person reads is wrong.
   Workaround: clock.js rebuilds with account.opening_balance_cents set to the stated opening less those lines, dated at the first line. Proposed patch: R-011.patch. */
"use strict";
const test = require("node:test"), assert = require("node:assert");
const { household, run } = require("./kit");

test("lines older than the first statement are inside its opening, not on top of it", { todo: "standard/engine/resolve-capital.js finishOpenings" }, () => {
  const h = household("card").person("sam").account("CARD", "credit_card", "cash", [["sam", 10000]]).rule("SHOP", "GROCERIES");
  h.line("CARD", "2026-12-03", "SHOP ONE", -6000).line("CARD", "2026-12-20", "SHOP TWO", -2500);
  h.obs("statement", { account_ref: "CARD", period_start: "2026-12-15", period_end: "2027-01-14", opening_cents: -10000, closing_cents: -12500, credits_cents: 0, debits_cents: 2500 });
  const L = run(h);
  assert.equal(L.balances.at("CARD", "2027-01"), -12500, "the statement's own closing balance");
  assert.equal(L.checks.find((c) => c.law === "L3" && c.scope === "CARD").status, "pass");
});
