/* A minimal XLSX reader: the zip central directory, shared strings and each sheet's cells. rows is the first sheet; meta.sheets every sheet by name.
   Cells keep their reference so a locator can say D12. zlib is injected: inflate(bytes, raw). */
"use strict";
const { utf8, unescapeXml } = require("./text");

function unzip(b, inflate) {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let e = b.length - 22;
  while (e >= 0 && v.getUint32(e, true) !== 0x06054b50) e -= 1;
  if (e < 0) throw new Error("not a zip");
  const n = v.getUint16(e + 10, true); let p = v.getUint32(e + 16, true); const out = {};
  for (let i = 0; i < n; i++) {
    const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true), nl = v.getUint16(p + 28, true), xl = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true), lo = v.getUint32(p + 42, true);
    const name = utf8(b.subarray(p + 46, p + 46 + nl));
    const ln = v.getUint16(lo + 26, true), lx = v.getUint16(lo + 28, true), start = lo + 30 + ln + lx, data = b.subarray(start, start + size);
    out[name] = method === 0 ? data : inflate(data, true);
    p += 46 + nl + xl + cl;
  }
  return out;
}

const col = (ref) => { let n = 0; for (const c of ref.replace(/\d+$/, "")) n = n * 26 + c.charCodeAt(0) - 64; return n - 1; };

function sheetRows(xml, shared) {
  const rows = []; const refs = [];
  for (const r of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const row = []; const num = /\br="(\d+)"/.exec(r[0]); const at = num ? Number(num[1]) : rows.length + 1;
    for (const c of (r[1] || "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const a = c[1], ref = /\br="([A-Z]+\d+)"/.exec(a), type = /\bt="(\w+)"/.exec(a), body = c[2] || "";
      const i = ref ? col(ref[1]) : row.length; let val = "";
      if (type && type[1] === "s") { const v = /<v>([\s\S]*?)<\/v>/.exec(body); val = v ? shared[Number(v[1])] : ""; }
      else if (type && type[1] === "inlineStr") { val = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unescapeXml(m[1])).join(""); }
      else { const v = /<v>([\s\S]*?)<\/v>/.exec(body); val = v ? unescapeXml(v[1]) : ""; }
      while (row.length < i) row.push("");
      row[i] = val;
    }
    while (rows.length < at - 1) { rows.push([]); refs.push(rows.length); }
    rows.push(row); refs.push(at);
  }
  return { rows, refs };
}

function decode(bytes, opts = {}) {
  const files = unzip(bytes, opts.inflate), text = (n) => (files[n] ? utf8(files[n]) : "");
  const shared = [...text("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => [...m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => unescapeXml(t[1])).join(""));
  const wb = text("xl/workbook.xml"), rels = text("xl/_rels/workbook.xml.rels");
  const rel = {}; for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) { const id = /\bId="([^"]+)"/.exec(m[0]), tg = /\bTarget="([^"]+)"/.exec(m[0]); if (id && tg) rel[id[1]] = tg[1]; }
  const sheets = {}; let first = null;
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const name = unescapeXml(/\bname="([^"]+)"/.exec(m[0])[1]), id = /\br:id="([^"]+)"/.exec(m[0])[1];
    const target = rel[id].replace(/^\/?(xl\/)?/, "xl/"), s = sheetRows(text(target), shared);
    sheets[name] = s.rows; if (first == null) first = name;
  }
  return { rows: first == null ? [] : sheets[first], meta: { container: "xlsx", sheets, sheet: first } };
}

module.exports = { decode, unzip };
