/* T6-PREFILL-WRONG-PERSON. tax.js compares pre-fill on it.amount_cents. The public myguv recipe gives it.amount in dollars, the vocabulary says neither, so `want` is undefined, the comparison is NaN and
   L.tax.prefill is empty for every household that has ever read one. Workaround: status.js compares them itself and says so. It can go when this passes. */
"use strict";
const test = require("node:test"), assert = require("node:assert");
const { household, run } = require("./kit");
const reference = require("../../standard/reference/au.json");

test("a pre-fill figure that differs from the ledger is reported", { todo: "standard/engine/tax.js prefill, against standard/recipes/myguv-prefill-json" }, () => {
  const h = household("prefill").person("sam", "Sam Lee").account("BANK", "transaction", "cash", [["sam", 10000]]);
  h.line("BANK", "2027-06-30", "CREDIT INTEREST", 5000, 105000);
  h.obs("prefill", { person_ref: "Sam Lee", fy: "FY2027", period_end: "2027-06-30", items: [{ label: "10", source: "Banks", amount: 70.0 }] });
  const L = run(h, { reference });
  assert.equal(L.tax.prefill.length, 1, "$70.00 on pre-fill, and the ledger holds $50.00");
});
