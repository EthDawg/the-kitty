/* A saved web page. A forgiving tag walk: a block is one line, a table row is one line whose cells are its td and th. lines for document recipes;
   rows and meta.tables for table recipes. */
"use strict";
const { utf8, stripBom, unescapeXml } = require("./text");

const BLOCK = new Set(["p", "div", "h1", "h2", "h3", "h4", "h5", "li", "dt", "dd", "section", "article", "header", "footer", "title", "br", "hr", "address", "caption", "main", "ul", "ol", "dl", "body", "html", "head"]);
const clean = (s) => unescapeXml(s).replace(/\s+/g, " ").trim();

function fromText(text) {
  const body = text.replace(/<!--[\s\S]*?-->/g, "").replace(/<!doctype[^>]*>/i, "").replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "");
  const lines = [], tables = []; let meta = {}; let buf = "", cells = null, cell = null, table = null, idx = 0;
  const flush = () => { const t = clean(buf); buf = ""; if (t) { lines.push({ text: t, cells: [t], page: 1, y: lines.length }); } };
  const re = /<\/?([a-zA-Z0-9]+)\b[^>]*>|([^<]+)/g; let m;
  while ((m = re.exec(body))) {
    if (m[2] != null) { if (cell != null) cell += m[2]; else buf += m[2]; continue; }
    const tag = m[1].toLowerCase(), close = m[0][1] === "/";
    if (tag === "table") { if (!close) { flush(); table = []; tables.push(table); } else table = null; continue; }
    if (tag === "tr") {
      if (!close) { flush(); cells = []; } else if (cells) { if (table) table.push(cells); if (cells.some((c) => c)) lines.push({ text: cells.filter((c) => c).join("  "), cells: cells.filter((c) => c), page: 1, y: lines.length }); cells = null; }
      continue;
    }
    if (tag === "td" || tag === "th") { if (!close) { cell = ""; } else if (cell != null) { if (cells) cells.push(clean(cell)); cell = null; } continue; }
    if (tag === "title" && close) { meta.title = clean(buf); }
    if (BLOCK.has(tag)) { if (cell != null) cell += " "; else flush(); }
    idx += 1;
  }
  flush();
  return { lines, tables, meta };
}

function decode(bytes) {
  const { lines, tables, meta } = fromText(stripBom(utf8(bytes)));
  return { lines, rows: tables.length ? tables.slice().sort((a, b) => b.length - a.length)[0] : [], meta: { container: "html", tables, ...meta } };
}

module.exports = { decode, fromText };
