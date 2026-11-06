/* T1-SALARY-NO-PAYSLIP, found by a variant family, never by the Davies. "SALARY KINGFISHER DISTRICT HOSPITAL" reaches the dictionary, which knows a hospital is health. A credit on a health merchant is a
   refund, so before any payslip a nurse's pay lowers her spending: December reads $530.00 in, -$4,840.00 out. Nothing asks. The word SALARY in the line should beat a merchant guess about a credit. */
"use strict";
const test = require("node:test"), assert = require("node:assert");
require("../../src/household/node.js");
const { household, run } = require("./kit");

test("a credit that says SALARY is pay, whatever the dictionary makes of the employer's name", { todo: "standard/engine/resolve.js classify: a credit's SALARY word before the dictionary's category" }, () => {
  const h = household("nurse").person("sam").account("BANK", "transaction", "cash", [["sam", 10000]]);
  h.line("BANK", "2026-12-17", "SALARY KINGFISHER DISTRICT HOSPITAL", 240654, 340654);
  const L = run(h), dec = L.cash.find((m) => m.month === "2026-12");
  assert.equal(dec.income, 240654, "it is read as a refund on health");
  assert.equal(dec.spending, 0);
});
