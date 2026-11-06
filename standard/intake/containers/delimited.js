/* CSV and TSV. One parser, the delimiter sniffed, quotes honoured, nothing thrown away: junk preamble and footer rows come back as rows, for a
   recipe to skip by name. Returns { rows, meta }. */
"use strict";
const { utf8, stripBom } = require("./text");

function parseRows(text, delim) {
  const rows = []; let row = [], cell = "", q = false, i = 0, line = 1, start = 1; const lines = [];
  const endCell = () => { row.push(cell); cell = ""; };
  const endRow = () => { endCell(); rows.push(row); lines.push(start); row = []; };
  while (i < text.length) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i += 2; continue; } q = false; i += 1; continue; }
      if (c === "\n") line += 1;
      cell += c; i += 1; continue;
    }
    if (c === '"' && cell === "") { q = true; i += 1; continue; }
    if (c === delim) { endCell(); i += 1; continue; }
    if (c === "\r") { i += text[i + 1] === "\n" ? 2 : 1; endRow(); line += 1; start = line; continue; }
    if (c === "\n") { i += 1; endRow(); line += 1; start = line; continue; }
    cell += c; i += 1;
  }
  if (cell !== "" || row.length) endRow();
  return { rows, lines };
}

function sniff(text) {
  const head = text.split(/\r?\n/).slice(0, 12); let best = ",", score = -1;
  for (const d of [",", "\t", ";", "|"]) {
    const counts = head.map((l) => { let n = 0, q = false; for (const c of l) { if (c === '"') q = !q; else if (c === d && !q) n += 1; } return n; });
    const s = Math.max(...counts);
    if (s > score) { score = s; best = d; }
  }
  return best;
}

function decode(bytes) {
  const raw = utf8(bytes), bom = raw.charCodeAt(0) === 0xfeff, text = stripBom(raw), delimiter = sniff(text);
  const { rows, lines } = parseRows(text, delimiter);
  return { rows, meta: { container: delimiter === "\t" ? "tsv" : "csv", delimiter, bom, row_lines: lines } };
}

module.exports = { decode, parseRows };
