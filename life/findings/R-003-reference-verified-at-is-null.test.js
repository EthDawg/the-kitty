/* Tax past reference.verified_at is flagged assumed (GOAL, primitive 5). The engine's own reference says null; the date is only in au-verified.json,
   300 KB of evidence no page should load. Workaround: defaults.json carries the date, with a drift test. */
"use strict";
const test = require("node:test"), assert = require("node:assert");

test("the reference a rebuild reads knows when it was read", { todo: "standard/reference/au.json" }, () => {
  assert.equal(require("../../standard/reference/au.json").verified_at, require("../../standard/reference/au-verified.json").verified_at);
});
