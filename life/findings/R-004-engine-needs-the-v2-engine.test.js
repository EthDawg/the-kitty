/* One engine for the page, and src/engine.js retires when parity holds. It cannot: resolve.js requires it for merchant lookup, and the dictionary is
   module-global state set by Engine.loadMerchants, so two households in one page share it. The bundle carries 70 KB of v2 engine for one function. */
"use strict";
const test = require("node:test"), assert = require("node:assert");
const fs = require("fs"), path = require("path");

test("the standard's engine stands on its own", { todo: "standard/engine/resolve.js line 7" }, () => {
  const dir = path.join(__dirname, "..", "..", "standard", "engine");
  const out = fs.readdirSync(dir).filter((f) => /require\("\.\.\/\.\.\/src\//.test(fs.readFileSync(path.join(dir, f), "utf8")));
  assert.deepEqual(out, []);
});
