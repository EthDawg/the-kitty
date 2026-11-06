/* Separation, preview only. Research A3: since 10 June 2025 courts weigh the economic effect of family violence, controlling finances can qualify, and a shared sheet can stay visible to, or editable by, the
   other party. A store knows its tables and its bytes and nothing about who can open them. A Kitty cannot say who else holds the sheet, so a transfer out of a joint Kitty cannot warn that the other person still
   sees every line, and a safety page cannot say what to change first. Not built here. The fixture is the port: a store that can answer who can open it, and a `next` that says so before a split. */
"use strict";
const test = require("node:test"), assert = require("node:assert");
const K = require("../../src/household/node.js");

test("a store can say who can open it", { todo: "src/household/store/port.js: an access port. Drive's get_file_permissions has the facts; the Fake needs a share list" }, async () => {
  const s = K.fakeStore();
  await K.init(s, { name: "Us", people: ["A", "B"], today: "2040-06-30" });
  assert.equal(typeof s.access, "function", "a store cannot say who else can read it");
});
test("a slice leaving a joint Kitty names everyone who can still read what stays", { todo: "src/household/transfer.js, after the access port" }, async () => {
  const a = K.fakeStore(), b = K.fakeStore();
  await K.init(a, { name: "Us", people: ["A", "B"], today: "2040-06-30" }); await K.init(b, { name: "Me", people: ["A"], today: "2040-06-30" });
  const r = await K.transfer(a, b, { setup: () => false }, { today: "2040-06-30", consent: { by: "A", words: "Mine." } });
  assert.ok(r.still_visible_to, "nothing tells her the other person still has the sheet");
});
