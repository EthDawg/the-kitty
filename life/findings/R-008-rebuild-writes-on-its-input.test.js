/* Same inputs, same bytes, and the pipeline is deterministic. rebuild still writes on the objects it is handed: resolve.js sets alsoSeen on a lead
   observation, so a second rebuild from the same array starts from different input. Workaround: clock.js copies every observation first. */
"use strict";
const test = require("node:test"), assert = require("node:assert");
const { household, run } = require("./kit");

test("a rebuild leaves its input as it found it", { todo: "standard/engine/resolve.js collapseDocs" }, () => {
  const h = household("twice").person("sam").account("BANK", "transaction", "cash", [["sam", 10000]]);
  const statement = { account_ref: "BANK", period_start: "2026-07-01", period_end: "2026-07-31", opening_cents: 0, closing_cents: 0 };
  h.obs("statement", statement); h.obs("statement", statement);
  h.sources.push({ source_id: "s2", sha256: "y", name: "b", origin: "manual", captured_at: "2020-01-02T00:00:00Z", status: "active" });
  h.observations[1].source_id = "s2";
  h.line("BANK", "2026-07-02", "X", -100);
  const before = JSON.stringify(h.observations);
  run(h);
  assert.equal(JSON.stringify(h.observations), before);
});
