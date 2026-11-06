/* A stable structural fingerprint of a decoded file, so recipes cache by format, not by institution: header tokens and layout, never values. Two
   files from one template get one fingerprint whatever they say; a header change gets a new one. Pure. */
"use strict";
const { sha256 } = require("./sha256");

const cls = (s) => {
  const t = String(s).trim();
  if (t === "") return "_";
  if (/^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(t) || /^\d{4}-\d{2}-\d{2}/.test(t) || /^\d{1,2} [A-Za-z]{3,9} \d{4}/.test(t) || /^[A-Za-z]{3} \d{4}$/.test(t)) return "D";
  if (/^[-+(]?(A\$|\$)?-?[\d,]*\.\d{2}\)?( ?(CR|DR))?$/.test(t) || /^-?A\$/.test(t)) return "$";
  if (/^-?[\d,.]+%?$/.test(t)) return "N";
  return "T";
};
const tokens = (s) => String(s).toLowerCase().replace(/[^a-z#]+/g, " ").trim();
const isHeader = (r) => r.length >= 2 && r.filter((c) => c.trim()).length >= 2 && r.every((c) => !/\d[\d,./-]*\d/.test(c) || /[a-z]{3}/i.test(c)) && r.some((c) => /[a-z]{3}/i.test(c));

function structure(decoded) {
  const m = decoded.meta || {}, c = m.container;
  if (c === "csv" || c === "tsv") {
    const rows = (decoded.rows || []).filter((r) => r.some((x) => x.trim()));
    const width = rows.reduce((w, r) => Math.max(w, r.length), 0), at = rows.findIndex((r) => r.length === width && isHeader(r));
    if (at >= 0 && at < 12) return { c, d: m.delimiter, head: rows[at].map(tokens), pre: at };
    const first = rows[0] || [];
    return { c, d: m.delimiter, width, classes: first.map(cls) };
  }
  if (c === "ofx") return { c, cols: (decoded.rows[0] || []), tags: Object.keys(m).filter((k) => /^[A-Z.]+$/.test(k)).sort() };
  if (c === "qif") return { c, type: m.type, cols: (decoded.rows[0] || []) };
  if (c === "json") {
    const shape = (cols) => (cols || []).map(tokens).sort();
    const norm = (k) => k.replace(/\[\d+\]/g, "[]");
    const keys = [...new Set(Object.keys(m.values).map(norm))].sort();
    const tabs = [...new Set(Object.keys(m.tables).map((k) => `${norm(k)}:${shape(m.tables[k][0]).join(",")}`))].sort();
    return { c, keys, tabs };
  }
  if (c === "xlsx") return { c, sheets: Object.keys(m.sheets).map((n) => { const rows = m.sheets[n], width = rows.reduce((w, r) => Math.max(w, r.filter((x) => x !== "").length), 0), h = rows.find((r) => r.filter((x) => x !== "").length === width && isHeader(r.filter((x) => x !== ""))); return [tokens(n), (h || []).map(tokens)]; }) };
  if (c === "image") return { c, format: m.format };
  // documents: the layout of the first page down to the first data row; cells by class, so values never reach the hash
  const lines = (decoded.lines || []).filter((l) => l.page === 1);
  const seq = []; let n = 0;
  for (const l of lines) {
    const classes = l.cells.map(cls);
    if (classes.length >= 3 && classes[0] === "D" && classes.slice(1).includes("$")) break;
    seq.push(classes.join("")); n += 1;
    if (n >= 10) break;
  }
  const out = { c, seq };
  if (c === "eml") out.parts = (m.parts || []).map((p) => p.type);
  if (c === "html") out.title = tokens(m.title || "").split(" ").slice(0, 4).join(" ");
  return out;
}

function fingerprint(decoded) { return `fp1:${sha256(new TextEncoder().encode(JSON.stringify(structure(decoded)))).slice(0, 24)}`; }

module.exports = { fingerprint, structure };
