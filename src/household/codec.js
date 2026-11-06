/* One row, three forms. A store holds exactly what a Sheet can hold, so a Folder and a Sheet cannot disagree: blank is absent, whole numbers
   are numbers, flags are flags, json is an object, and everything else is text. normalise is the only door. Hashes are taken over its output,
   with the standard's own hashTable, so a row reads back the same from any store. */
"use strict";
const { stableStringify } = require("../../standard/engine/util");
const { hashTable } = require("../../standard/engine/upgrade");
const { columnsOf, tabOf } = require("./tabs");

const isBlank = (v) => v === null || v === undefined || v === "";
const WHOLE = new Set(["cents", "int", "bps"]);

function readNumber(v) {
  if (typeof v === "number") return v;
  const s = String(v).replace(/[,\s]/g, "");
  return /^-?\d+(\.\d+)?(E\+?\d+)?$/i.test(s) ? Number(s) : v;
}
function readJson(v) {
  if (typeof v !== "string") return v;
  try { return JSON.parse(v); } catch (e) { return v; }
}
function normalise(table, row) {
  const out = {};
  for (const c of columnsOf(table)) {
    const v = row[c.name];
    if (isBlank(v)) continue;
    if (WHOLE.has(c.type)) out[c.name] = readNumber(v);
    else if (c.type === "bool") out[c.name] = v === true || /^true$/i.test(String(v));
    else if (c.type === "json") out[c.name] = readJson(v);
    else out[c.name] = String(v);
  }
  return out;
}
const hashRows = (rows) => hashTable(rows);

/* Google reads back what it shows. USER_ENTERED turns 2026-07-01 and Mar 2026 into dates, 007 into 7, 12e5 into 1200000 and =IMPORTXML(...) into a live
   formula, and a bank narrative is someone else's text. No list of patterns is safe, so every string goes in with the leading apostrophe that says
   "this is text", which Google keeps out of the value. RAW keeps every string exactly, so nothing is guarded. A store finds out which it has with
   one probe, once. */
const guard = (s, mode) => (mode === "USER_ENTERED" ? `'${s}` : s);

function toCells(table, row, mode) {
  return tabOf(table).headers.map((name, i) => {
    const c = columnsOf(table)[i], v = row[name];
    if (isBlank(v)) return "";
    if (WHOLE.has(c.type) || c.type === "bool") return v;
    if (c.type === "json") return guard(stableStringify(v), mode);
    return guard(String(v), mode);
  });
}
const CELL_LIMIT = 50000;
function tooLong(table, cells) {
  const i = cells.findIndex((c) => typeof c === "string" && c.length > CELL_LIMIT);
  return i < 0 ? null : tabOf(table).headers[i];
}
module.exports = { normalise, hashRows, toCells, guard, tooLong, isBlank };
