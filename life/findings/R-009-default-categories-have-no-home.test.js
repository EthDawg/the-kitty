/* SPEC 13: default categories and the tax map are shared data, updating on open, read through a household's overrides. They exist only as constants inside
   standard/world, the Davies generator, which a page must not load. A blank household needs them on day one. Workaround: defaults.json, with a drift test. */
"use strict";
const test = require("node:test"), assert = require("node:assert");
const fs = require("fs"), path = require("path");

test("shared data lives in the standard, outside any one family's world", { todo: "standard/reference or standard/schema" }, () => {
  const dir = path.join(__dirname, "..", "..", "standard");
  const home = [...fs.readdirSync(path.join(dir, "reference")), ...fs.readdirSync(path.join(dir, "schema"))].filter((f) => /categor|tax.?map/i.test(f));
  assert.ok(home.length, "no shared file holds the default chart or the tax map");
});
