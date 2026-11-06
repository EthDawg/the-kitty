/* record: a validated row in a yours table, for what a person or an agent sets up by hand: an account, a contract, a loan's terms.
   replayWorld: a whole household, from setup and files, through the same verbs a person uses. The same function runs under Node and in a page,
   so the two can be held to one bundle hash. */
"use strict";
const { stableStringify, hash64 } = require("../../standard/engine/util");
const S = require("../../standard/engine/schema");
const { init, ready, stamp, fail } = require("./init");
const { add } = require("./add");
const { rebuildAt } = require("./clock");
const { close } = require("./close");
const { TABS, columnsOf, tabOf } = require("./tabs");
const { normalise } = require("./codec");

async function record(store, table, rows, { today, strict = true } = {}) {
  await ready(store);
  if (tabOf(table).class !== "yours") throw fail("not_yours", `${table} is not a table a person writes to.`);
  const dated = columnsOf(table).some((c) => c.name === "recorded_at");
  const clean = rows.map((r) => normalise(table, today && dated && !r.recorded_at ? { ...r, recorded_at: stamp(today) } : r));
  if (strict) { const errs = clean.flatMap((r) => S.validateRow({ name: table, columns: columnsOf(table) }, r)); if (errs.length) throw fail("bad_row", errs.slice(0, 5).join("; "), { errors: errs }); }
  return store.tables.appendNew(table, clean);
}
// world: { setup: {table: rows}, files: [{path, name, bytes, stream, download_date, origin, issued_on}], decisions, rules }
async function replayWorld(store, world, { today, closeMonth } = {}) {
  await init(store, { household: world.setup.household[0], today: "2019-03-01" });
  for (const t of TABS.filter((x) => x.class === "yours" && x.table !== "household" && world.setup[x.table])) await record(store, t.table, world.setup[t.table], { strict: false });
  const added = await add(store, world.files, { today });
  await record(store, "decision", world.decisions, { strict: false });
  await record(store, "rule", world.rules, { strict: false });
  const built = await rebuildAt(store);
  const closed = closeMonth ? await close(store, closeMonth, { today }) : null;
  return { built, added, closed, bundle_hash: built.L.bundleHash };
}
// One hash over everything a store holds, so two hosts can be shown to have written the same household.
async function tableHashes(store) {
  const out = {};
  for (const t of TABS) out[t.table] = hash64((await store.tables.read(t.table)).map((r) => stableStringify(r)).join("\n"));
  return out;
}
const treeHash = async (store) => hash64(stableStringify(await tableHashes(store)));
module.exports = { record, replayWorld, treeHash, tableHashes };
