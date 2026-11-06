/* T5-BOND-BACK. A bond leaves for $7,200 and $7,015 comes back. The $185 cleaning charge is spending, and it is the only spending. Both lines read as open transfers with no other side, so the two sit in
   clearing for ever, net worth is $185 better than the truth and no month shows the charge. There is no shape for money held by a third party that comes back short. F-010 is the first half. */
"use strict";
const test = require("node:test"), assert = require("node:assert");
const { household, run } = require("./kit");

test("a bond that comes back short leaves the charge in spending", { todo: "standard/engine/resolve.js transfers: a held deposit as a receivable, and its shortfall as an expense" }, () => {
  const h = household("bond").person("sam").account("BANK", "transaction", "cash", [["sam", 10000]]);
  h.line("BANK", "2027-03-16", "BPAY RESIDENTIAL TENANCIES BOND", -720000, 100000).line("BANK", "2028-02-14", "RESIDENTIAL TENANCIES BOND REFUND", 701500, 801500);
  h.decisions.push({ decision_id: "d1", target_type: "line", target_ref: "BANK|2027-03-16|-720000", verb: "categorise", value: { category_id: "TRANSFER" }, by: "sam", at: "2027-03-17T00:00:00Z", status: "accepted" });
  h.decisions.push({ decision_id: "d2", target_type: "line", target_ref: "BANK|2028-02-14|701500", verb: "categorise", value: { category_id: "TRANSFER" }, by: "sam", at: "2028-02-15T00:00:00Z", status: "accepted" });
  const L = run(h), feb = L.cash.find((m) => m.month === "2028-02");
  assert.equal(feb.spending, 18500, "the charge is the only spending");
});
