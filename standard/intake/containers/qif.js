/* QIF. rows: a header of the single-letter codes seen, then one row per record; meta.type is the !Type line. */
"use strict";
const { utf8, stripBom } = require("./text");

function decode(bytes) {
  const lines = stripBom(utf8(bytes)).split(/\r?\n/); let type = ""; const recs = []; let cur = {};
  for (const l of lines) {
    if (l === "") continue;
    if (l[0] === "!") { type = l.slice(1).trim(); continue; }
    if (l[0] === "^") { recs.push(cur); cur = {}; continue; }
    cur[l[0]] = cur[l[0]] != null ? `${cur[l[0]]} ${l.slice(1).trim()}` : l.slice(1).trim();
  }
  if (Object.keys(cur).length) recs.push(cur);
  const cols = []; for (const r of recs) for (const k of Object.keys(r)) if (!cols.includes(k)) cols.push(k);
  cols.sort();
  return { rows: [cols, ...recs.map((r) => cols.map((c) => (r[c] == null ? "" : r[c])))], meta: { container: "qif", type } };
}

module.exports = { decode };
