/* A hand edit in a managed tab becomes a proposed decision. The row managedTabCheck proposes has no `at`, which decision requires, so it cannot be stored
   as written. It also targets `source` with a table name for a ref, for want of a better target_type. Workaround: close.js stamps `at`. */
"use strict";
const test = require("node:test"), assert = require("node:assert");
const S = require("../../standard/engine/schema");
const { managedTabCheck } = require("../../standard/engine/upgrade");
const T = S.tables(require("../../standard/schema/tables.json"));

test("what managedTabCheck proposes can be written", { todo: "standard/engine/upgrade.js managedTabCheck" }, () => {
  const { proposals } = managedTabCheck({ table: "posting", stored_hash: "x", rows: [{ a: 1 }], key: "k" });
  assert.deepEqual(S.validateRow(T.decision, proposals[0]), []);
});
