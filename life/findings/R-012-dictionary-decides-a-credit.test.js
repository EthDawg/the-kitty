/* A credit is a refund only from someone the household paid, or if it says so: resolve.js says exactly that, and then acts on it only for a line that saysMoved. So money in from
   anyone whose name holds a dictionary word takes that word's expense category and comes off spending, with full confidence and nothing asked. Blind run ch01, F007 to F009: pay
   from a public hospital read as a medical refund, income read $0 and spending went negative. Workaround: clock.js blanks such a line with a rule held in memory for one rebuild,
   and the same line then reaches review the way this patch would send it. A credit from a payer who repeats is never a refund, whatever was paid to them. Proposed patch: R-012.patch. */
"use strict";
const test = require("node:test"), assert = require("node:assert");
const { household, run } = require("./kit");
const Engine = require("../../src/engine.js");

const DICT = { merchants: [{ id: "medical-generic", name: "Medical", patterns: ["\\bHOSPITAL\\b"], category_id: "FEES", kind: "merchant" }] };
test("a public dictionary match does not decide money coming in", { todo: "standard/engine/resolve.js recogniseRest" }, () => {
  Engine.loadMerchants(DICT);
  const h = household("pay").person("sam").account("BANK", "transaction", "cash", [["sam", 10000]]);
  h.line("BANK", "2026-08-01", "ELMWOOD DISTRICT HOSPITAL 0042", 250000, 250000).line("BANK", "2026-08-15", "ELMWOOD DISTRICT HOSPITAL 0042", 250000, 500000);
  const L = run(h);
  assert.equal(L.review.filter((r) => r.kind === "uncategorised").length, 2, "both are asked");
  assert.equal(L.cash.find((c) => c.month === "2026-08").spending, 0, "and neither comes off spending");
});
