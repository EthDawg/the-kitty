/* A small PDF writer. Same drawing model as the portals' pdf-lib documents (Helvetica, WinAnsi, one text run per BT, an absolute Tm
   before each Tj) with no dependency, so the world's documents read exactly as a portal's do. Deterministic: no dates, no ids. */
"use strict";
const { fmtDate } = require("./util");

const A4 = [595.28, 841.89];
const M = 44;
const W_REG = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const W_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];

const clean = (s) => String(s == null ? "" : s).replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, "...").replace(/[^\x20-\x7e\xa0-\xff]/g, "?");
const widthOf = (s, size, bold) => { let w = 0; const t = bold ? W_BOLD : W_REG; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); w += t[c - 32] == null ? 556 : t[c - 32]; } return w * size / 1000; };
const hexRgb = (h) => { const n = parseInt(h.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
const n2 = (v) => { const r = Math.round(v * 100) / 100; return Number.isInteger(r) ? String(r) : r.toFixed(2); };
const INK = [0.09, 0.08, 0.14], MUTED = [0.42, 0.4, 0.5], LINE = [0.86, 0.85, 0.88], SOFT = [0.95, 0.945, 0.93], WHITE = [1, 1, 1];
const hex2 = (s) => { let o = ""; for (let i = 0; i < s.length; i++) o += (s.charCodeAt(i) & 255).toString(16).padStart(2, "0"); return o.toUpperCase(); };
const lit = (s) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

class Doc {
  /* opts: brand {name, tagline, color}, title, kicker, deflate (bytes => bytes, null writes raw streams), literal (string form), style band|plain, footer */
  constructor(opts) {
    Object.assign(this, { brand: opts.brand, title: opts.title, kicker: opts.kicker || "", deflate: opts.deflate || null, literal: !!opts.literal, style: opts.style || "band",
      foot: opts.footer || null, rowH: opts.rowH || 15, y: 0 });
    this.pages = [];
    this.newPage();
  }
  get W() { return A4[0]; }
  get H() { return A4[1]; }
  op(s) { this.ops.push(s); }
  rect(x, y, w, h, c) { this.op(`${n2(c[0])} ${n2(c[1])} ${n2(c[2])} rg ${n2(x)} ${n2(y)} ${n2(w)} ${n2(h)} re f`); }
  line(x1, y1, x2, y2, c, t = 0.5) { this.op(`${n2(c[0])} ${n2(c[1])} ${n2(c[2])} RG ${n2(t)} w ${n2(x1)} ${n2(y1)} m ${n2(x2)} ${n2(y2)} l S`); }
  run(x, y, s, size, bold, c, rot) {
    const m = rot ? `${n2(Math.cos(rot))} ${n2(Math.sin(rot))} ${n2(-Math.sin(rot))} ${n2(Math.cos(rot))}` : "1 0 0 1";
    const str = this.literal ? `(${lit(s)})` : `<${hex2(s)}>`;
    this.op(`BT /${bold ? "F2" : "F1"} ${n2(size)} Tf ${n2(c[0])} ${n2(c[1])} ${n2(c[2])} rg ${m} ${n2(x)} ${n2(y)} Tm ${str} Tj ET`);
  }
  newPage() {
    this.ops = []; this.pages.push(this.ops);
    if (this.style === "band") {
      const col = hexRgb(this.brand.color);
      this.rect(0, this.H - 64, this.W, 64, col);
      this.run(M + 28, this.H - 40, clean(this.brand.name), 20, true, WHITE);
      this.run(M + 28, this.H - 54, clean(this.brand.tagline || ""), 8, false, WHITE);
      const tag = "DEMO  -  fictional document", tw = widthOf(tag, 9, true);
      this.run(this.W - M - tw - 8, this.H - 37, tag, 9, true, WHITE);
      this.run(110, 230, "DEMO", 150, true, [0.93, 0.93, 0.95], 32 * Math.PI / 180);
      this.y = this.H - 64 - 36;
    } else {
      this.run(M, this.H - 50, clean(this.brand.name), 14, true, INK);
      this.run(this.W - M - widthOf("DEMO, fictional", 8, false), this.H - 50, "DEMO, fictional", 8, false, MUTED);
      this.line(M, this.H - 58, this.W - M, this.H - 58, INK, 1);
      this.y = this.H - 80;
    }
    if (this.pages.length > 1) { this.text(M, this.y, `${this.title} (continued)`, { size: 10, color: MUTED }); this.y -= 20; }
  }
  ensure(h) { if (this.y - h < 70) this.newPage(); }
  text(x, y, str, o = {}) {
    let s = clean(str); const size = o.size || 10; const bold = !!o.bold;
    if (!s) return 0;
    let w = widthOf(s, size, bold);
    if (o.maxWidth && w > o.maxWidth) { while (s.length > 1 && widthOf(s + "...", size, bold) > o.maxWidth) s = s.slice(0, -1); s += "..."; w = widthOf(s, size, bold); }
    this.run(o.align === "right" ? x - w : x, y, s, size, bold, o.color || INK);
    return w;
  }
  h1(s) { this.ensure(40); if (this.kicker) { this.text(M, this.y, this.kicker, { size: 9, color: MUTED }); this.y -= 18; } this.text(M, this.y, s, { size: 18, bold: true }); this.y -= 22; }
  h2(s) { this.ensure(30); this.y -= 6; this.text(M, this.y, s, { size: 12, bold: true }); this.y -= 8; this.line(M, this.y, this.W - M, this.y, this.style === "band" ? hexRgb(this.brand.color) : INK, 0.8); this.y -= 14; }
  para(s, o = {}) {
    const words = clean(s).split(/\s+/), size = o.size || 9.5, maxW = this.W - 2 * M; let line = "";
    const flush = () => { this.ensure(14); this.text(M, this.y, line, { size, color: o.color || INK }); this.y -= size + 4; line = ""; };
    for (const w of words) { const t = line ? `${line} ${w}` : w; if (widthOf(t, size) > maxW) flush(); line = line ? `${line} ${w}` : w; }
    if (line) flush();
    this.y -= 4;
  }
  kv(pairs, cols = 2) {
    const colW = (this.W - 2 * M) / cols, rows = Math.ceil(pairs.length / cols);
    this.ensure(rows * 26 + 6);
    pairs.forEach(([k, v], i) => { const x = M + (i % cols) * colW, y = this.y - Math.floor(i / cols) * 26; this.text(x, y, k, { size: 8, color: MUTED }); this.text(x, y - 12, v, { size: 10.5, bold: true, maxWidth: colW - 10 }); });
    this.y -= rows * 26 + 8;
  }
  table(cols, rows, opts = {}) {
    const total = cols.reduce((s, c) => s + c.w, 0), scale = (this.W - 2 * M) / total, rowH = this.rowH;
    const head = () => {
      this.ensure(rowH + 4);
      this.rect(M, this.y - 4, this.W - 2 * M, rowH, SOFT);
      let x = M; for (const c of cols) { const w = c.w * scale; this.text(c.align === "right" ? x + w - 4 : x + 4, this.y, c.label, { size: 8, bold: true, color: MUTED, align: c.align }); x += w; }
      this.y -= rowH;
    };
    head();
    for (const r of rows) {
      if (this.y - rowH < 70) { this.newPage(); head(); }
      let x = M; r.forEach((v, i) => { const c = cols[i], w = c.w * scale; this.text(c.align === "right" ? x + w - 4 : x + 4, this.y, v, { size: 8.5, align: c.align, maxWidth: w - 8, bold: c.bold }); x += w; });
      this.line(M, this.y - 4, this.W - M, this.y - 4, LINE, 0.4);
      this.y -= rowH;
    }
    if (opts.foot) {
      if (this.y - rowH < 70) this.newPage();
      let x = M; opts.foot.forEach((v, i) => { const c = cols[i], w = c.w * scale; this.text(c.align === "right" ? x + w - 4 : x + 4, this.y, v, { size: 8.5, bold: true, align: c.align }); x += w; });
      this.y -= rowH;
    }
    this.y -= 6;
  }
  footer() {
    const n = this.pages.length;
    const f = this.foot || `Fictional document from The Kitty's Davies world (github.com/EthDawg/the-kitty). ${this.brand.name} is a parody; not a real institution. Nothing here is advice.`;
    this.pages.forEach((ops, i) => {
      this.ops = ops;
      this.line(M, 50, this.W - M, 50, LINE, 0.5);
      // wrap the notice to two lines the way pdf-lib's maxWidth does
      const words = clean(f).split(" "), maxW = this.W - 2 * M - 60; let line = "", y = 38; const out = [];
      for (const w of words) { const t = line ? `${line} ${w}` : w; if (widthOf(t, 7) > maxW) { out.push(line); line = w; } else line = t; }
      if (line) out.push(line);
      for (const l of out) { this.run(M, y, l, 7, false, MUTED); y -= 9; }
      const pg = `Page ${i + 1} of ${n}`;
      this.run(this.W - M - widthOf(pg, 7), 38, pg, 7, false, MUTED);
    });
  }
  finish() {
    this.footer();
    const te = new TextEncoder();
    const chunks = []; let off = 0; const xref = [];
    const put = (b) => { const u = typeof b === "string" ? te.encode(b) : b; chunks.push(u); off += u.length; };
    const raw = (s) => { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255; return u; };
    put("%PDF-1.4\n%\xC2\xB5\xC2\xB6\n");
    const obj = (n, body) => { xref[n] = off; put(`${n} 0 obj\n${body}\nendobj\n`); };
    const stream = (n, content) => {
      let data = raw(content), filter = "";
      if (this.deflate) { data = this.deflate(data); filter = " /Filter /FlateDecode"; }
      xref[n] = off; put(`${n} 0 obj\n<< /Length ${data.length}${filter} >>\nstream\n`); put(data); put("\nendstream\nendobj\n");
    };
    const count = this.pages.length, kids = this.pages.map((_, i) => `${5 + i * 2} 0 R`).join(" ");
    obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
    obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${count} >>`);
    obj(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    obj(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    this.pages.forEach((ops, i) => {
      const p = 5 + i * 2;
      obj(p, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4[0]} ${A4[1]}] /Contents ${p + 1} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> >>`);
      stream(p + 1, ops.join("\n"));
    });
    const info = 5 + count * 2;
    obj(info, `<< /Title (${lit(clean(`${this.brand.name} - ${this.title}`))}) /Author (A parody from The Kitty) /Subject (Fictional demo document) >>`);
    const start = off;
    let x = `xref\n0 ${info + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= info; i++) x += `${String(xref[i]).padStart(10, "0")} 00000 n \n`;
    put(`${x}trailer\n<< /Size ${info + 1} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${start}\n%%EOF\n`);
    const out = new Uint8Array(off); let p = 0; for (const c of chunks) { out.set(c, p); p += c.length; }
    return out;
  }
}

const period = (from, to) => `${fmtDate(from)} to ${fmtDate(to)}`;

module.exports = { Doc, A4, M, MUTED, INK, widthOf, clean, period };
