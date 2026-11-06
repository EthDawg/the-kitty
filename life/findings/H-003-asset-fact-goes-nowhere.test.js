/* T5-WARRANTY. The vocabulary has asset_fact, with warranty_until, and a receipt's fact is read and held. Nothing in the engine reads the kind: no asset row, no term, and refreshPlan never sees it, so a warranty
   date in the household's own evidence is shown to nobody. The runtime could list the observations, but a thing on no table cannot be closed, moved or insured. */
"use strict";
const test = require("node:test"), assert = require("node:assert");
const { household, run } = require("./kit");

test("an asset_fact makes a durable thing, off the balance sheet, with its warranty date", { todo: "standard/engine/resolve.js: materialise asset_fact into an asset and a warranty_until term" }, () => {
  const h = household("fridge").person("sam").account("BANK", "transaction", "cash", [["sam", 10000]]);
  h.obs("asset_fact", { asset_ref: "FRIDGE", name: "Fridge", asset_kind: "appliance", acquired_on: "2028-02-02", cost_cents: 219900, warranty_until: "2031-02-02" });
  const L = run(h);
  assert.ok(L.refresh.some((r) => r.warranty_until === "2031-02-02"), "the warranty date reaches nothing");
});
