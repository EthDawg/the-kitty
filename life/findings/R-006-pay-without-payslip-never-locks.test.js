/* A renter with one bank file has a salary and no payslip. That event is provisional, and a month with anything provisional cannot lock, so her months
   can never lock while every number in them is final. There is no way to say "there are no payslips coming". Workaround: close.js reads
   scope payroll = none as that answer. Is that a decision verb, a scope state, or a change to what provisional means? */
"use strict";
const test = require("node:test"), assert = require("node:assert");
const { household, run } = require("./kit");
const { closeStatus } = require("../../standard/engine/close");

test("a household with no payslips to give can lock a month", { todo: "standard/engine/close.js, resolve.js wage_unmatched" }, () => {
  const h = household("renter").person("sam").account("BANK", "transaction", "cash", [["sam", 10000]]).scope("household", "renter", "payroll", "none").rule("ACME PAY", "SALARY");
  h.line("BANK", "2026-07-01", "ACME PAY", 300000, 300000);
  assert.equal(closeStatus(run(h)).find((c) => c.period_id === "2026-07").status, "lockable");
});
