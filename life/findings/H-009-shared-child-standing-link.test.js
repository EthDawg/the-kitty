/* Separation, preview only: GOAL primitive 4. After a split a child's cost is recognised in one Kitty and cleared in the other, for years. That is a standing relationship between two stores, not a slice,
   and link cannot say it: from_type and to_type stop at this household's contract, account, asset and party, and nothing names another Kitty. Child support adds the rest: not income, not deductible, reported
   for income tests (research A3). Fixture: two Kitties and one school fee, 60/40, each counting its own share and the balance between them clearing. Not built here; this holds the shape. */
"use strict";
const test = require("node:test"), assert = require("node:assert");
const { household, run } = require("./kit");
const tables = require("../../standard/schema/tables.json");

test("a link can name the other household", { todo: "standard/schema/tables.json link: a household on each end, with share_bps" }, () => {
  const types = tables.tables.link.columns.find((c) => c.startsWith("to_type:"));
  assert.match(types, /household/, "a link stops at the edge of one Kitty");
});
test("one fee, two Kitties, recognised in one and cleared in the other, for years", { todo: "standard/engine: a standing link between stores, GOAL primitive 4" }, () => {
  const mum = household("mum").person("a").account("BANK", "transaction", "cash", [["a", 10000]]).rule("SCHOOL FEES", "KIDS-ACT");
  const dad = household("dad").person("b").account("BANK", "transaction", "cash", [["b", 10000]]);
  mum.setup.link.push({ relation: "split_of", from_type: "party", from_id: "a", to_type: "party", to_id: "b", share_bps: 4000, valid_from: "2040-07-01", recorded_at: "2040-07-01T00:00:00Z" });
  mum.line("BANK", "2040-08-01", "SCHOOL FEES", -100000, 900000); dad.line("BANK", "2040-08-03", "TRANSFER TO MUM FEES", -40000, 960000);
  const A = run(mum), B = run(dad);
  assert.equal(A.cash.find((m) => m.month === "2040-08").spending, 60000, "her share, once his clears it");
  assert.equal(B.balances.at("receivable:a", "2040-08"), 0, "and nothing left owing between two stores");
});
