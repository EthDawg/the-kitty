/* A month is closed when every account it touches is confirmed. closeStatus asks only whether a stated balance falls anywhere in the month, so three
   days of August, downloaded on the third, is lockable. Lock it and the rest of August fails L12. Workaround: status.js decides a month is whole
   from today and how far each account's evidence reaches. closeStatus has no clock, so the fix may be a parameter. */
"use strict";
const test = require("node:test"), assert = require("node:assert");
const { household, run } = require("./kit");
const { closeStatus } = require("../../standard/engine/close");

test("three days of a month are not a closable month", { todo: "standard/engine/close.js closeStatus" }, () => {
  const h = household("short").person("sam").account("BANK", "transaction", "cash", [["sam", 10000]]).rule("WOOLWORTHS", "GROCERIES");
  h.line("BANK", "2026-08-01", "WOOLWORTHS 1", -1000, 9000).line("BANK", "2026-08-03", "WOOLWORTHS 2", -1000, 8000);
  const august = closeStatus(run(h)).find((c) => c.period_id === "2026-08");
  assert.equal(august.status, "open", "nothing proves the account from the 4th to the 31st");
});
