/* Which tabs a household has, and which a person sees. The list is standard/generated/sheet-tabs.json. The classes come from the manifest:
   yours, evidence, managed. Forty-one tabs are all made on day one, because one atomic call is safer than growing a sheet later, and a table
   always has a home. Eight are visible. The rest are hidden, not missing. See DECISIONS.md. */
"use strict";
const sheetTabs = require("../../standard/generated/sheet-tabs.json");
const tablesDoc = require("../../standard/schema/tables.json");
const { parseColumn } = require("../../standard/engine/schema");

const STANDARD_VERSION = tablesDoc.version;
const RUNTIME_VERSION = "kitty-household/1";
const ABOUT = "About";

// Extensions follow SPEC 12: x_ prefixed, declared here, reported by conform.js as extensions. Each is a finding for the data model session.
const EXTENSIONS = {
  x_delivery: {
    plane: "evidence", temporal: "append",
    doc: "A byte-identical re-delivery of a quiet file. source is keyed by content, so this is the only record that a dormant account's empty export arrived again.",
    columns: ["stream_id:id:req", "day:date:req", "source_id:id:req", "note:text"],
  },
};

const VISIBLE = new Set(["household", "party", "account", "rule", "decision", "scope", "source"]);
const GRID_ROWS = { source: 200, observation: 1000, x_delivery: 50 };
const DEFAULT_ROWS = 20;

const WORDS = {
  yours: "Yours. Add rows or edit them.",
  evidence: "Evidence. The Kitty adds to this. Leave it as it is.",
  managed: "Rebuilt at every close. Anything typed here stops the next close.",
};

const standardTabs = sheetTabs.tabs.map((t) => ({ ...t }));
const extensionTabs = Object.entries(EXTENSIONS).map(([table, x], i) => ({
  tab: table, table, class: "evidence", plane: x.plane, temporal: x.temporal, order: standardTabs.length + i, headers: x.columns.map((c) => c.split(":")[0]), extension: true,
}));
const TABS = [...standardTabs, ...extensionTabs].map((t) => ({ ...t, visible: VISIBLE.has(t.table), rows: GRID_ROWS[t.table] || DEFAULT_ROWS, about: WORDS[t.class] }));
const BY_TABLE = new Map(TABS.map((t) => [t.table, t]));

const docColumns = (name) => {
  if (EXTENSIONS[name]) return EXTENSIONS[name].columns.map(parseColumn);
  const t = tablesDoc.tables[name];
  if (!t) throw new Error(`no such table: ${name}`);
  return t.columns.map(parseColumn);
};
const COLUMNS = new Map(TABS.map((t) => [t.table, docColumns(t.table)]));
const columnsOf = (table) => { const c = COLUMNS.get(table); if (!c) throw new Error(`no such table: ${table}`); return c; };
const pkOf = (table) => (columnsOf(table).find((c) => c.pk) || {}).name || null;
const tabOf = (table) => { const t = BY_TABLE.get(table); if (!t) throw new Error(`no such table: ${table}`); return t; };
const tablesOfClass = (cls) => TABS.filter((t) => t.class === cls).map((t) => t.table);
const MANAGED = tablesOfClass("managed");

module.exports = { TABS, ABOUT, STANDARD_VERSION, RUNTIME_VERSION, EXTENSIONS, MANAGED, columnsOf, pkOf, tabOf, tablesOfClass };
