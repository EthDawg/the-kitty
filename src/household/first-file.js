/* What a person is told about a file: how many lines, from when to when, which account, and where the file itself is kept. */
"use strict";
const { dayYear, plural } = require("./words");
const { bytesState } = require("./add");
const { latest } = require("./clock");
const { init, fail } = require("./init");
const { TABS } = require("./tabs");

const BYTES = { held: "The file itself is kept in your Google Drive.", on_device: "The file itself is kept on this device.", not_held: "The file itself was not kept, only what was read from it.", unknown: "" };
function fileWords({ L, view }, sourceId) {
  const lines = (L.lines || []).filter((l) => (l.witnesses || []).some((w) => w.source_id === sourceId)).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const source = view.sources.find((s) => s.source_id === sourceId);
  if (!lines.length) return { lines: 0, say: "Nothing in it became a line in your Kitty.", bytes: source ? BYTES[bytesState(source)] : "" };
  const accounts = [...new Set(lines.map((l) => l.account))].map((id) => (L.index.accounts.get(id) || {}).name || id), from = lines[0].date, to = lines[lines.length - 1].date;
  return { lines: lines.length, from, to, accounts, say: `${plural(lines.length, "line")} from ${dayYear(from)} to ${dayYear(to)}, in ${accounts.join(" and ")}.`, bytes: source ? BYTES[bytesState(source)] : "" };
}
/* From this device to a Sheet: everything a person or a file wrote, the latest row of each, into a store that is empty. Not `transfer`, which is a dated slice between two
   households with consent. This is one household changing where it lives, on day one. Managed tabs are written at the next close. */
async function moveStore(from, to, { today }) {
  const household = latest("household", await from.tables.read("household"))[0], made = await init(to, { household, today });
  if (made.already) throw fail("not_empty", "That sheet already holds a Kitty. Nothing was changed.");
  for (const t of TABS) if (t.class !== "managed") { const rows = latest(t.table, await from.tables.read(t.table)); if (rows.length) await to.tables.appendNew(t.table, rows); }
}
module.exports = { fileWords, moveStore };
