/* Scope is how nothing keeps its four meanings, and domain is free text. The runtime asks about eight domains, spelt as the Davies world spells them, because
   nothing else says what a domain is. Two agents will spell super two ways, and "not asked" stops meaning anything. Terms have terms.json; scope needs one. */
"use strict";
const test = require("node:test"), assert = require("node:assert");
const tables = require("../../standard/schema/tables.json");

test("scope.domain is a closed vocabulary that opens with x_", { todo: "standard/schema/tables.json scope" }, () => {
  assert.match(tables.tables.scope.columns.find((c) => c.startsWith("domain:")), /enum=/);
});
