/* L4 fails an observation with nothing to attach to. A bill dated the 20th, with a bank file that stops on the 15th, is waiting, the same as a payslip L2 already calls open. A person reads "Two things in your
   files disagree". Workaround: next.js treats an unattached count with no double claims as waiting. */
"use strict";
const test = require("node:test"), assert = require("node:assert");
const { household, run } = require("./kit");

test("a bill newer than the bank's last line is waiting, not wrong", { todo: "standard/engine/laws.js L4: past the bank's reach, open" }, () => {
  const h = household("bill").person("jo").account("BANK", "transaction", "cash", [["jo", 10000]]);
  h.line("BANK", "2036-03-15", "COFFEE", -500, 99500);
  h.obs("bill", { issuer_ref: "POWER", bill_date: "2036-03-20", due_on: "2036-04-10", amount_cents: 30000 });
  const L = run(h, { asOf: "2036-03-31" });
  assert.notEqual(L.checks.find((x) => x.law === "L4").status, "fail");
});
