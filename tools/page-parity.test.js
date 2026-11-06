/* The adapter against the v2 sheet. It cannot be made to pass by weakening it: a field that differs needs a written reason, a reason for a field that no longer differs is
   stale, and no field may match fewer rows than the baseline says. To move the baseline: node tools/page-parity.js --write, and the diff shows what moved. */
"use strict";
const test = require("node:test"), assert = require("node:assert");
const fs = require("fs"), path = require("path");
const { run, whyOf, table } = require("./page-parity");

let r; const result = async () => (r = r || (await run()));
const baseline = () => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "src", "household", "parity-baseline.json"), "utf8"));
test("the fields come from the page: the big reads are all there, and there are enough of them to mean it", async () => {
  const fields = new Set((await result()).rows.map((x) => x.field));
  assert.ok(fields.size > 150, `only ${fields.size} fields`);
  for (const f of ["tx[].amount", "tx[].cat", "entries[].raw", "goals[].target", "accounts[].balance", "cashflow[].income", "networth[].total", 'metrics["networth.total"]', "asOf", "people"]) assert.ok(fields.has(f), `${f} is read by the page`);
});
test("every difference is explained", async () => {
  const bad = (await result()).rows.filter((x) => x.differs && !whyOf(x.field)).map((x) => `${x.field}: ${x.sample}`);
  assert.deepEqual(bad, []);
});
test("what must match, matches, row for row: the money itself", async () => {
  const by = new Map((await result()).rows.map((x) => [x.field, x]));
  for (const f of ["tx[].date", "tx[].acct", "tx[].amount", "tx[].desc", "tx[].flow", "cashflow[].income", "cashflow[].spending", "cashflow[].net", "networth[].cash", "networth[].property", "networth[].super", "networth[].loans", "networth[].vehicle", "goals[].balance", "goals[].target", "payslips[].net", "payslips[].gross", "payslips[].tax", "dupes", "asOf"]) {
    const x = by.get(f);
    assert.ok(x, `${f} is compared`);
    assert.equal(x.differs, 0, `${f}: ${x.sample}`);
    assert.ok(x.matches > 0, `${f} compared nothing`);
  }
});
test("no field matches fewer rows than it did", async () => {
  const base = baseline(), worse = (await result()).rows.filter((x) => base[x.field] !== undefined && x.matches < base[x.field]).map((x) => `${x.field}: ${x.matches}, was ${base[x.field]}`);
  assert.deepEqual(worse, []);
});
test("PARITY.md is current", async () => {
  assert.equal(fs.readFileSync(path.join(__dirname, "..", "src", "household", "PARITY.md"), "utf8"), table(await result()));
});
