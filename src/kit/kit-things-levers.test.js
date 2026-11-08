"use strict";
const test = require("node:test"), assert = require("node:assert");
const Things = require("./things.js"), Levers = require("./levers.js");
const thingsIn = require("../../tools/kit-demo/things.data.js")(), leversIn = require("../../tools/kit-demo/levers.data.js")();

test("things: decisions are costed on one horizon and compared with the pick", () => {
  const m = Things.model(thingsIn);
  assert.equal(m.decisions.length, 2);
  const home = m.decisions.find((d) => d.id === "DQ-001");
  assert.equal(home.rec.option, "Renew with Youi, $1,000 excess");
  assert.deepEqual(home.options.map((o) => o.total), [1980, 1760, 1640]);
  assert.deepEqual(home.options.map((o) => o.delta), [220, 0, -120]);
  const box = m.decisions.find((d) => d.id === "DQ-002");
  assert.equal(box.horizon, 12);
  assert.deepEqual(box.options.map((o) => o.total), [174, 0, 0]);
  assert.equal(box.rec.option, "Move the files to iCloud and cancel");
  assert.ok(Things.render(m, {}).includes("over the next 12 months"));
});
test("things: cancelled contracts are gone, monthly sums tie to the contracts", () => {
  const m = Things.model(thingsIn);
  const all = m.things.flatMap((t) => t.contracts);
  assert.ok(!all.some((c) => c.id === "C0003"), "Disney+ was decided Cancel");
  const sum = Math.round(all.reduce((s, c) => s + c.monthly, 0) * 100) / 100;
  assert.equal(Math.round(m.monthly * 100) / 100, sum);
  const home = m.byId.HOME;
  assert.match(home.nextLabel, /^Renews: Home and contents/); // a renewal beats the monthly internet charge
  assert.ok(m.decisionsByRef.HOME.includes("DQ-001"));
});
test("things: a missing record leaves the view dark, and the drawer draws", () => {
  assert.equal(Things.model(null), null);
  const m = Things.model(thingsIn);
  assert.ok(Things.renderThing(m, "HOME").includes("Home and contents insurance"));
});
test("levers: rows sorted by months moved, signs say which way", () => {
  const m = Levers.model(leversIn);
  assert.equal(m.plan, "2028-05-01");
  assert.equal(m.rows[0].id, "GL-001");
  assert.equal(m.rows[0].moved, 36);
  const holiday = m.rows.find((r) => r.id === "GL-005");
  assert.equal(holiday.on, false); assert.equal(holiday.moved, -3);
  const html = Levers.render(m, {});
  assert.ok(html.includes("5 months after the Dec 2027 target"));
  assert.ok(html.includes("Switching it on: the date moves 3 months earlier, to Feb 2028."));
});
test("levers: a 'Never' flip is the largest effect and is worded plainly", () => {
  const m = Levers.model({ goal: { name: "G", planDate: "2028-01-01" }, levers: [{ id: "a", lever: "Keep saving", on: true, dateIfOn: "2028-01-01", dateIfOff: "Never" }, { id: "b", lever: "Small", on: false, dateIfOn: "2027-12-01", dateIfOff: "2028-01-01" }] });
  assert.equal(m.rows[0].id, "a");
  assert.ok(Levers.render(m, {}).includes("the goal would never arrive at this pace"));
});
