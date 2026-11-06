/* Blank is a state, not an error (GOAL, primitive 6). A household with no postings cannot be rebuilt once metrics are asked for: netWorthByOwner
   reads the last month and there is none. Workaround: clock.js rebuilds without metrics, then calls allMetrics only when a month exists. */
"use strict";
const test = require("node:test"), assert = require("node:assert");
const { household, run, schema, metrics } = require("./kit");

test("a household with nothing in it yet rebuilds, with metrics", { todo: "standard/engine/views.js netWorthByOwner, or metrics.js" }, () => {
  const h = household("blank").person("sam");
  const L = run(h, { schema: { ...schema, metrics } });
  assert.deepEqual(L.events, []);
});
test("so does one whose only lines are on an account nobody has set up yet", { todo: "the same fix" }, () => {
  const h = household("first-file").person("sam").line("NOT-SET-UP", "2026-07-02", "A LINE", -5000);
  const L = run(h, { schema: { ...schema, metrics } });
  assert.ok(L.review.some((r) => r.kind === "unresolved_account"));
});
