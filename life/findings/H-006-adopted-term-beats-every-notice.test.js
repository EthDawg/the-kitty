/* The one law that had to bend. GOAL says adopted setup rows get recorded_at at transfer time. The engine orders a term against dated notices by recorded_at, so a loan's opening rate adopted in 2038 would
   replace every rate notice since 2028, and a Kitty that moved stores would rebuild to a different household. So transfer leaves a term's recorded_at alone and notes the adoption instead, which is the one
   exception, written down in life/HARNESS-DECISIONS.md. The fixture shows why. The fix is a known-order column that is not the record's date, and then the exception can go. See also F-007. */
"use strict";
const test = require("node:test"), assert = require("node:assert");
const { household, run } = require("./kit");
const { termAt } = require("../../standard/engine/temporal");

test("a term re-recorded at transfer time keeps its place among the notices", { todo: "standard/engine/temporal.js timeline: order by when a term was first known, not by recorded_at" }, () => {
  const h = household("moved").person("P").org("BANK");
  h.account("LN", "loan", "loans", [["P", 10000]]); h.setup.contract.push({ contract_id: "C-L", kind: "loan", name: "Loan", account_id: "LN", started_on: "2028-01-01" });
  h.setup.term.push({ term_id: "t0", subject_type: "contract", subject_id: "C-L", term: "interest_rate", value: "6.54", valid_from: "2028-01-01", recorded_at: "2038-03-31T00:00:00Z", superseded_at: null });
  h.obs("rate_notice", { contract_ref: "C-L", term: "interest_rate", value: "6.29", effective_on: "2028-03-01", notified_on: "2028-03-03" });
  const L = run(h);
  assert.equal(termAt(L.termIdx, "contract", "C-L", "interest_rate", "2028-04-01"), "6.29", "the transfer date made the opening rate the newest thing known");
});
