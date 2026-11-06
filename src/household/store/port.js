/* The Store. Two ports: tables, and optional blobs. An adapter supplies a few raw moves and declares what it can do; this file holds the rules
   every store obeys, so no adapter can skip them. Rows are normalised going in and coming out. A managed write compares the hash it stored
   before it touches anything. An append adds only what is not there, so a run cut off half way can simply be run again. */
"use strict";
const { stableStringify } = require("../../../standard/engine/util");
const { managedTabCheck } = require("../../../standard/engine/upgrade");
const { normalise, hashRows } = require("../codec");
const { TABS, pkOf, tabOf, STANDARD_VERSION, RUNTIME_VERSION, declareTable } = require("../tabs");

function blankManifest(extra = {}) {
  const tables = {};
  for (const t of TABS) tables[t.table] = { rows: 0, hash: hashRows([]), class: t.class, plane: t.plane, workbooks: [{ name: "household", partition: null }] };
  return { standard_version: STANDARD_VERSION, runtime: RUNTIME_VERSION, state: "initialising", bundle_hash: null, as_of: null, ...extra, tables };
}
const rowKey = (table, pk) => (r) => (pk ? r[pk] : stableStringify(r));

function openStore(adapter) {
  const tables = {
    async read(table) { return (await adapter.read(table)).map((r) => normalise(table, r)); },
    // rows: new rows, as many as you like. Returns how many were really added.
    async appendNew(table, rows) {
      if (!rows.length) return 0;
      const clean = rows.map((r) => normalise(table, r)), pk = pkOf(table), key = rowKey(table, pk);
      const have = new Set(pk ? await adapter.keys(table) : (await tables.read(table)).map(key));
      const fresh = [];
      for (const r of clean) { const k = key(r); if (have.has(k)) continue; have.add(k); fresh.push(r); }
      if (fresh.length) await adapter.append(table, fresh);
      return fresh.length;
    },
    /* Rows from another store, in order, as they stand. Unlike appendNew it keeps a key's later rows, because a static table reads latest-wins and its history is part of
       what moved. A row already here, byte for byte, is not written twice, so an adoption cut off half way can simply be run again. */
    async adopt(table, rows) {
      if (!rows.length) return 0;
      const clean = rows.map((r) => normalise(table, r)), have = new Set((await tables.read(table)).map((r) => stableStringify(r)));
      const fresh = [];
      for (const r of clean) { const k = stableStringify(r); if (have.has(k)) continue; have.add(k); fresh.push(r); }
      if (fresh.length) await adapter.append(table, fresh);
      return fresh.length;
    },
    // A person may correct a row in a yours tab. Static tables are read latest-wins by key, so a change is one more row, never an edit.
    async change(table, row) { const clean = normalise(table, row); await adapter.append(table, [clean]); return clean; },
    /* What did a person type? Anything that differs from the stored hash, reported and untouched. A tab whose write was cut off is ours,
       half done, and is not a hand edit. */
    async handEdits(names) {
      const m = await adapter.getManifest(), out = [];
      for (const table of names) {
        const entry = m.tables[table] || {};
        if (entry.writing) continue;
        const found = await tables.read(table), stored = entry.hash ?? hashRows([]);
        const pk = pkOf(table), key = found[0] ? (pk ? found[0][pk] : null) : null;
        const c = managedTabCheck({ table, stored_hash: stored, rows: found, key });
        if (!c.ok) out.push({ table, tab: tabOf(table).tab, stored_hash: stored, found_hash: hashRows(found), rows: found.length, proposals: c.proposals });
      }
      return out;
    },
    /* Every managed table in one go. The stored hash is compared here, in the port, so nothing can write round it, and before the first write, so a
       hand edit in the last tab leaves the first untouched. accepted: the found hashes a person has looked at. Then say what is about to be
       written, write it, say it is done. A failure in the middle leaves `writing` set, so the next run knows the tab is its own half-finished work. */
    async replaceManaged(rowsByTable, stamp, { accepted = new Set() } = {}) {
      for (const table of Object.keys(rowsByTable)) if (tabOf(table).class !== "managed") throw new Error(`${table} is not a managed table`);
      const edits = (await tables.handEdits(Object.keys(rowsByTable))).filter((e) => !accepted.has(`${e.table}|${e.found_hash}`));
      if (edits.length) throw Object.assign(new Error(`A person typed in ${edits.map((e) => e.tab).join(", ")}.`), { code: "hand_edit", edits });
      const m = await adapter.getManifest(), next = {};
      for (const [table, rows] of Object.entries(rowsByTable)) {
        const clean = rows.map((r) => normalise(table, r));
        next[table] = { rows: clean, hash: hashRows(clean) };
        m.tables[table] = { ...m.tables[table], writing: next[table].hash };
      }
      await adapter.putManifest(m);
      for (const [table, { rows }] of Object.entries(next)) await adapter.write(table, rows);
      for (const [table, { rows, hash }] of Object.entries(next)) { const { writing, ...entry } = m.tables[table]; m.tables[table] = { ...entry, rows: rows.length, hash }; }
      Object.assign(m, stamp);
      await adapter.putManifest(m);
      return Object.fromEntries(Object.entries(next).map(([t, x]) => [t, x.rows.length]));
    },
    // What the manifest says a table holds, for everything that is not managed. Taken at init and at each close, so About is true then.
    async countOriginals(rowsByTable) {
      const m = await adapter.getManifest();
      for (const [table, rows] of Object.entries(rowsByTable)) if (m.tables[table]) m.tables[table] = { ...m.tables[table], rows: rows.length, hash: hashRows(rows) };
      await adapter.putManifest(m);
    },
  };
  const known = (m) => { for (const [t, columns] of Object.entries((m && m.x_tables) || {})) declareTable(t, columns); return m; };
  return {
    kind: adapter.kind, capabilities: adapter.capabilities, tables, blobs: adapter.blobs || null,
    async probe() { const p = await adapter.probe(); known(p.manifest); return p; },
    create: (m) => adapter.create(TABS, m),
    async manifest() { return known(await adapter.getManifest()); },
    setManifest: (m) => adapter.putManifest(m),
    /* A table of the household's own. One call, and it is in the store, in the manifest and typed. Asking twice changes nothing; the same name with other columns is refused. */
    async define(table, columns) {
      const m = known(await adapter.getManifest()), had = (m.x_tables || {})[table];
      if (had) { if (JSON.stringify(had) !== JSON.stringify(columns)) throw Object.assign(new Error(`${table} already exists with other columns.`), { code: "table_exists" }); return false; }
      const tab = declareTable(table, columns);
      await adapter.addTable(tab);
      m.x_tables = { ...(m.x_tables || {}), [table]: columns };
      m.tables[table] = { rows: 0, hash: hashRows([]), class: tab.class, plane: tab.plane, workbooks: [{ name: "household", partition: null }] };
      await adapter.putManifest(m);
      return true;
    },
  };
}
module.exports = { openStore, blankManifest };
