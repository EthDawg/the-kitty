/* source is keyed by content, so a dormant account's identical empty export has one row however many months it arrives. Coverage reads those arrivals
   from rebuild's `receipts` input, which no table holds. eval/run.js gets away with it because it walks a folder. A store cannot: drop receipts and
   L13 raises a false gap for an account that is simply quiet (on Davies, ACC-OFF, 14 months). Workaround: x_delivery, read back into receipts. The
   standard should say where a delivery lives: a table, or a source row per delivery. */
"use strict";
const test = require("node:test"), assert = require("node:assert");
const fs = require("fs"), path = require("path");

test("the standard has a place for a byte-identical re-delivery", { todo: "standard/schema/tables.json" }, () => {
  const t = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "standard", "schema", "tables.json"), "utf8")).tables;
  const home = Object.entries(t).some(([, d]) => d.plane === "evidence" && /deliver|receipt/i.test(JSON.stringify(d)));
  assert.ok(home, "rebuild takes receipts, and no table holds them");
});
