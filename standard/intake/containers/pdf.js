/* Text out of a simple PDF, a port of period-close/pdftext.py. Reads Flate or raw content streams and WinAnsi text in hex or literal strings, in
   the drawing model of the portals' pdf-lib documents and this world's: an absolute Tm before each Tj. Runs group into lines by baseline, left
   to right. Honest about its limits: CID fonts, encrypted files and text drawn as paths come back empty, and empty means a person looks. It is a
   reader, never a judge: every number is checked by the gate. zlib is injected: inflate(bytes, raw). */
"use strict";
const { latin1, cp1252 } = require("./text");

const TOKEN = /<([0-9A-Fa-f\s]*)>|\((?:\\[\s\S]|[^\\)])*\)|\[|\]|\/[^\s/[\]<>(]+|-?\d*\.?\d+|[A-Za-z'"*]+/g;
const NUM = /^-?\d*\.?\d+$/;

function literal(tok) {
  const s = tok.slice(1, -1), esc = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" }; let out = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && i + 1 < s.length) {
      const n = s[i + 1];
      if (esc[n] != null) { out += esc[n]; i += 1; continue; }
      const m = /^[0-7]{1,3}/.exec(s.slice(i + 1, i + 4));
      if (m) { out += String.fromCharCode(parseInt(m[0], 8) & 255); i += m[0].length; continue; }
      i += 1; continue;
    }
    out += s[i];
  }
  return out;
}

// every stream object, by object number, without being fooled by "endobj" inside compressed bytes
function streams(bytes, str, inflate) {
  const out = []; const re = /(\d+)\s+(\d+)\s+obj\b/g; let m;
  while ((m = re.exec(str))) {
    const num = Number(m[1]), from = m.index + m[0].length;
    const s = str.indexOf("stream", from), e = str.indexOf("endobj", from);
    if (s < 0 || (e >= 0 && e < s)) continue;
    const head = str.slice(from, s);
    let start = s + 6; if (str[start] === "\r") start += 1; if (str[start] === "\n") start += 1;
    const len = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(head); let end;
    if (len && str.startsWith("endstream", Number(len[1]) + start + (str[Number(len[1]) + start] === "\n" ? 1 : str[Number(len[1]) + start] === "\r" ? 2 : 0))) end = start + Number(len[1]);
    else { end = str.indexOf("endstream", start); if (end < 0) continue; if (str[end - 1] === "\n") end -= 1; if (str[end - 1] === "\r") end -= 1; }
    re.lastIndex = end;
    if (/\/ObjStm|\/XRef|\/Image|\/FontFile/.test(head)) continue;
    let raw = bytes.subarray(start, end);
    if (/\/FlateDecode/.test(head)) {
      if (!inflate) continue;
      try { raw = inflate(raw, false); } catch (x) { continue; }
    } else if (/\/Filter\s*(\/|\[)/.test(head)) continue;
    const t = latin1(raw);
    if (t.includes("BT") && (t.includes("Tj") || t.includes("TJ"))) out.push([num, t]);
  }
  return out.sort((a, b) => a[0] - b[0]).map((x) => x[1]);
}

function runs(bytes, inflate) {
  const str = latin1(bytes), out = [];
  streams(bytes, str, inflate).forEach((content, idx) => {
    const page = idx + 1; let x = 0, y = 0, tlx = 0, tly = 0, leading = 0, size = 0, stack = [];
    for (const t of content.match(TOKEN) || []) {
      if (t[0] === "<" || t[0] === "(" || t === "[" || t === "]" || t[0] === "/" || NUM.test(t)) { stack.push(t); continue; }
      const op = t, nums = stack.filter((s) => NUM.test(s)).map(Number);
      if (op === "Tf" && nums.length) size = nums[nums.length - 1];
      else if (op === "TL" && nums.length) leading = nums[nums.length - 1];
      else if (op === "Tm" && nums.length >= 6) { x = nums[nums.length - 2]; y = nums[nums.length - 1]; tlx = x; tly = y; }
      else if ((op === "Td" || op === "TD") && nums.length >= 2) { tlx += nums[nums.length - 2]; tly += nums[nums.length - 1]; x = tlx; y = tly; if (op === "TD") leading = -nums[nums.length - 1]; }
      else if (op === "T*") { tly -= leading; x = tlx; y = tly; }
      else if (op === "Tj" || op === "'" || op === '"' || op === "TJ") {
        if (op === "'" || op === '"') { tly -= leading; x = tlx; y = tly; }
        let text = "";
        for (const s of stack) {
          if (s[0] === "<") { let hx = s.slice(1, -1).replace(/\s/g, ""); if (hx.length % 2) hx += "0"; let r = ""; for (let i = 0; i < hx.length; i += 2) r += String.fromCharCode(parseInt(hx.slice(i, i + 2), 16)); text += cp1252(r); }
          else if (s[0] === "(") text += cp1252(literal(s));
        }
        if (text.trim()) out.push({ page, x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, text, size });
        x += size * 0.5 * text.length;
      }
      stack = [];
    }
  });
  return out;
}

function toLines(all, tolerance = 2.0) {
  const pages = new Map(); for (const r of all) { if (!pages.has(r.page)) pages.set(r.page, []); pages.get(r.page).push(r); }
  const lines = [];
  for (const page of [...pages.keys()].sort((a, b) => a - b)) {
    const rows = [];
    for (const r of pages.get(page).slice().sort((a, b) => b.y - a.y || a.x - b.x)) {
      const last = rows[rows.length - 1];
      if (last && Math.abs(last.y - r.y) <= tolerance) last.cells.push(r); else rows.push({ y: r.y, cells: [r] });
    }
    for (const row of rows) {
      const cells = row.cells.slice().sort((a, b) => a.x - b.x);
      lines.push({ text: cells.map((c) => c.text).join("  "), cells: cells.map((c) => c.text), xs: cells.map((c) => c.x), sizes: cells.map((c) => c.size), page, y: row.y });
    }
  }
  return lines;
}

function decode(bytes, opts = {}) {
  if (latin1(bytes, 0, 5) !== "%PDF-") throw new Error("not a PDF");
  const lines = toLines(runs(bytes, opts.inflate));
  return { lines, meta: { container: "pdf", pages: lines.reduce((m, l) => Math.max(m, l.page), 0) } };
}

module.exports = { decode, runs, toLines };
