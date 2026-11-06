/* A payslip for someone who is not a party stops the whole rebuild: post.js throws "no ref person for ato:{person}", the household cannot be opened, and the file that did it is
   already stored. It takes only a person who signs up as Bob and is paid as Robert. Workaround: add.js aliases the name to the household's one adult. With two adults there is
   nothing safe to guess, so that case still throws. The engine should raise a review item and hold the payslip out. */
"use strict";
const test = require("node:test"), assert = require("node:assert");
const { household, run } = require("./kit");

test("a payslip for a stranger is a question, not a crash", { todo: "standard/engine/post.js target" }, () => {
  const h = household("names").person("bob", "Bob").person("sam", "Sam").account("BANK", "transaction", "cash", [["bob", 5000], ["sam", 5000]]);
  h.obs("payslip", { person_ref: "Robert Jones", employer_ref: "Acme", pay_date: "2026-07-01", period_start: "2026-06-18", period_end: "2026-07-01", gross_cents: 400000, tax_cents: 100000, net_cents: 300000, super_cents: 40000 });
  assert.doesNotThrow(() => run(h));
});
