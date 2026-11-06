/* L14 judges a quarter at L.asOf, and a fund's export can stop before the deadline it is judged by. Daisy's fund closes on the quarter, the next file comes in April, so in February her Kitty says super did not
   reach the fund when the money is there. A gap in evidence is not a broken law. Workaround: next.js steps past it while the fund's last line is before the deadline, and status still counts it as failing. */
"use strict";
const test = require("node:test"), assert = require("node:assert");
const { household, run } = require("./kit");

test("super past the fund's last line is a gap, not a failure", { todo: "standard/engine/laws.js L14: stop at the fund's own evidence" }, () => {
  const h = household("fund").person("jo").org("ACME").account("BANK", "transaction", "cash", [["jo", 10000]]).account("FUND", "super", "super", [["jo", 10000]]);
  h.obs("payslip", { person_ref: "jo", employer_ref: "ACME", pay_date: "2026-12-10", gross_cents: 400000, tax_cents: 100000, net_cents: 300000, super_cents: 48000 });
  h.obs("payslip", { person_ref: "jo", employer_ref: "ACME", pay_date: "2026-11-10", gross_cents: 400000, tax_cents: 100000, net_cents: 300000, super_cents: 48000 });
  h.obs("super_line", { account_ref: "FUND", posting_date: "2026-11-20", line_type: "employer", description: "SG", amount_cents: 48000, balance_after_cents: 48000 });
  const L = run(h, { asOf: "2027-02-14" }), c = L.checks.find((x) => x.law === "L14");
  assert.notEqual(c.status, "fail", "the fund's file stops on 20 November, and nothing it could say about December was asked");
});
