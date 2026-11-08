// node --test test/ — the public page's sheet-version-3 views over the bundled Davies snapshot (fictional).
// The snapshot carries the five v3 tabs with the sheet's field names; the page's mapping (src/kit/v3.js) gives each view module
// the same input its demo harness gives (tools/kit-demo/*.data.js); every view renders, and stays dark without its data.
"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const E = require("../src/engine.js");
const V = require("../src/kit/v3.js");
const Things = require("../src/kit/things.js"), Levers = require("../src/kit/levers.js"), TaxView = require("../src/kit/taxview.js"), Groceries = require("../src/kit/groceries.js");
const load = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
const snap = load("data/snapshot-v2.json");
const m = E.model(snap), t = V.fromSnapshot(snap);
// null and absent are the same to a view; numbers within a cent are the same number
const same = (a, b) => JSON.stringify(a, (k, v) => (v === undefined ? null : typeof v === "number" ? Math.round(v * 100) / 100 : v));
const without = (keys) => { const s = Object.assign({}, snap); for (const k of keys) delete s[k]; return s; };

test("the bundled snapshot carries the five v3 tabs with the sheet's field names", () => {
  const heads = {
    receipts: "Receipt ID,Date,Time,Merchant,Merchant ID,Store,Channel,Person,Items,Total,GST,Savings,Paid with,Entry ID,Account ID,Source,Source kind,Read by,Check,Note",
    receipt_lines: "Receipt ID,Line,Printed text,Product,Brand,Group,Kind,Qty,Unit,Unit price,Amount,GST,Pack size,Price per kg or L,Retailer code,Note",
    decision_options: "Decision ID,Question,Ref,Option,Upfront,Per month,Months,Extra,Total,Recommended,Decide by,Status,Source,Note",
    goal_levers: "Lever ID,Goal,Lever,On,Per month,One-off,Date if on,Date if off,Months moved,Source",
    tax_returns: "Person,FY,Status,Taxable income,Tax on income,Medicare,Offsets,Withheld,Result,Lodged,Notice,Pack,Source,Note",
  };
  for (const [k, h] of Object.entries(heads)) {
    assert.ok(Array.isArray(snap[k]) && snap[k].length, `${k} is in the snapshot`);
    assert.deepEqual(Object.keys(snap[k][0]), h.split(",").map(E.key), `${k} keys follow the sheet's headers`);
  }
  assert.deepEqual(V.lit(t), V.KEYS);
  assert.equal(snap.receipts.length, 94); assert.equal(snap.receipt_lines.length, 4082);
  assert.equal(snap.decision_options.length, 6); assert.equal(snap.goal_levers.length, 8); assert.equal(snap.tax_returns.length, 10);
  assert.equal(typeof snap.goal_levers[0].on, "boolean");
  assert.equal(snap.decision_options[1].recommended, true);
  assert.equal(snap.tax_returns[2].status, "Amended");
});

test("Things: the page's input is the demo harness's input", () => {
  const demo = require("../tools/kit-demo/things.data.js")();
  const page = V.thingsInput(m, t, {});
  for (const x of demo.things) x.image = null;   // the page hands images from the bundle; the harness reads the files
  assert.equal(same(page), same(demo));
  const tm = Things.model(page);
  assert.equal(tm.decisions.length, 2);
  assert.ok(Things.render(tm, {}).includes("Home and contents renews on 3 March"));
  assert.ok(Things.renderHome(tm).includes("Decide by"));
});

test("What moves the date: Offset buffer leads, its input is the demo harness's, and the formulas give the sheet's dates", () => {
  const demo = require("../tools/kit-demo/levers.data.js")();
  const lead = (m.goals.find((g) => g.name === m.kitty.lead_goal) || {}).name;
  const goals = V.leverGoals(m, t, lead);
  assert.equal(goals[0], "Offset buffer");
  const page = V.leversInput(m, t, goals[0], { writable: true });
  assert.equal(same(page.goal), same(demo.goal));
  assert.equal(same(page.levers.map(({ row, ...l }) => l)), same(demo.levers));
  assert.equal(page.goal.planDate, "2028-05-01");
  // the sheet's Goal Levers formulas, worked out on the page for the demo: every row ties to the CSV
  const g = m.goals.find((x) => x.name === "Offset buffer");
  const again = V.leverDates(g, page.levers, m.asOf);
  assert.deepEqual(again.map((l) => [l.dateIfOn, l.dateIfOff, l.monthsMoved]), page.levers.map((l) => [l.dateIfOn, l.dateIfOff, l.monthsMoved]));
  // switch the holiday lever on: the plan comes three months earlier, as its row says
  const flipped = V.leverDates(g, page.levers.map((l) => (l.id === "GL-005" ? { ...l, on: true } : l)), m.asOf);
  assert.equal(V.planDate(flipped), "2028-02-01");
  const lm = Levers.model(page);
  assert.ok(Levers.render(lm, {}).includes("May 2028"));
});

test("Tax: the page's input is the demo harness's input, and FY26 ties to the Tax Forecast", () => {
  const demo = require("../tools/kit-demo/taxview.data.js")();
  const page = V.taxInput(m, t);
  assert.equal(same(page), same(demo));
  const tm = TaxView.model(page);
  assert.deepEqual(tm.problems, []);
  const html = TaxView.render(tm, {});
  assert.ok(html.includes("Not tax advice"));
});

test("Groceries: every receipt and line reaches the view, and a card receipt names its bank charge", () => {
  const page = V.groceriesInput(m, t);
  assert.equal(page.receipts.length, 94); assert.equal(page.lines.length, 4082);
  const r = page.receipts.find((x) => x.id === "R0001");
  assert.equal(r.entryId, "T0009"); assert.equal(r.entryAccount, "Rewards credit card"); assert.equal(r.entryAmount, -336.31); assert.equal(r.entryDate, "2025-07-03");   // the bank settled it the next day
  const gm = Groceries.model(page);
  assert.ok(gm);
  assert.ok(Groceries.render(gm, {}).length > 1000);
  assert.ok(Groceries.renderHome(gm, {}).length > 100);
});

test("each view stays dark without its data", () => {
  const bare = without(V.KEYS), mb = E.model(bare), tb = V.fromSnapshot(bare);
  assert.deepEqual(V.lit(tb), []);
  assert.equal(V.leversInput(mb, tb, "Offset buffer"), null);
  assert.deepEqual(V.leverGoals(mb, tb), []);
  assert.equal(V.taxInput(mb, tb), null);
  assert.equal(V.groceriesInput(mb, tb), null);
  // Things lights from Contracts alone (a version 2 household keeps its things); with neither contracts nor decisions it is dark
  const things = V.thingsInput(mb, tb, {});
  assert.ok(things && things.things.length && !things.decisions.length);
  const none = without(V.KEYS.concat(["contracts"]));
  assert.equal(V.thingsInput(E.model(none), V.fromSnapshot(none), {}), null);
  // the ledger fixtures are version 2 households: no v3 tab at all
  for (const f of ["fixtures/everyday-only.json", "fixtures/everyday+property.json"]) assert.deepEqual(V.lit(V.fromSnapshot(load(f))), [], f);
});

test("live grids map to the same rows, with the sheet row kept for writes, and a missing tab stays dark", () => {
  const grid = [["Lever ID", "Goal", "Lever", "On", "Per month", "One-off", "Date if on", "Date if off", "Months moved", "Source"],
    ["GL-001", "Offset buffer", "The $800 monthly transfer", "TRUE", "$800.00", "$0.00", "May 2028", "May 2031", "36", "Standing transfer"],
    [], ["GL-005", "Offset buffer", "Halve the holiday budget", "FALSE", "$300.00", "$0.00", "Feb 2028", "May 2028", "3", "Budget tab"]];
  const tl = V.fromGrids({ goal_levers: grid, tax_returns: [] });
  assert.equal(tl.goal_levers.length, 2); assert.equal(tl.goal_levers[1]._row, 4);
  assert.equal(tl.tax_returns, null); assert.equal(tl.receipts, null);
  const page = V.leversInput(m, tl, "Offset buffer", { writable: true });
  assert.deepEqual(page.levers.map((l) => [l.on, l.perMonth, l.dateIfOn, l.dateIfOff, l.monthsMoved, l.row]), [[true, 800, "2028-05-01", "2031-05-01", 36, 2], [false, 300, "2028-02-01", "2028-05-01", 3, 4]]);
  assert.equal(page.goal.planDate, "2028-05-01");
});
