/* One page of Helvetica, for a cover note. Standard fonts, WinAnsi text, no images, no dates or ids, so the same words make the same bytes.
   Text that will not fit is an error, not a second page: a cover note that needs two pages has too much in it. */
(function (root, name, deps, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(...deps.map((d) => require(`./${d}.js`)));
  else { const K = (root.KittyPack = root.KittyPack || {}); K[name] = factory(...deps.map((d) => K[d])); }
})(typeof self !== "undefined" ? self : this, "pdf", ["zip"], function (Z) {
  "use strict";
  const W = 595.28, H = 841.89, M = 48;
  // Helvetica advance widths, 32 to 126, from the Adobe metrics.
  const REG = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
  const BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
  const clean = (s) => String(s ?? "").replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, "...").replace(/[^\x20-\x7e]/g, "?");
  const width = (s, size, bold) => { let w = 0; const t = bold ? BOLD : REG; for (let i = 0; i < s.length; i++) w += t[s.charCodeAt(i) - 32] ?? 556; return (w * size) / 1000; };
  const n = (v) => String(Math.round(v * 100) / 100);
  const lit = (s) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

  class Page {
    constructor() { this.ops = []; this.y = H - M; }
    text(x, y, s, o = {}) { const size = o.size || 10; const c = o.color || [0.1, 0.1, 0.14]; const t = clean(s); const px = o.align === "right" ? x - width(t, size, o.bold) : x; this.ops.push(`BT /${o.bold ? "F2" : "F1"} ${n(size)} Tf ${n(c[0])} ${n(c[1])} ${n(c[2])} rg 1 0 0 1 ${n(px)} ${n(y)} Tm (${lit(t)}) Tj ET`); }
    rule(y, c = [0.8, 0.79, 0.82]) { this.ops.push(`${n(c[0])} ${n(c[1])} ${n(c[2])} RG 0.5 w ${n(M)} ${n(y)} m ${n(W - M)} ${n(y)} l S`); }
    band(y, h, c) { this.ops.push(`${n(c[0])} ${n(c[1])} ${n(c[2])} rg ${n(M)} ${n(y)} ${n(W - 2 * M)} ${n(h)} re f`); }
    wrap(s, size, bold, wide) { const out = []; let cur = ""; for (const w of clean(s).split(/\s+/)) { const t = cur ? `${cur} ${w}` : w; if (width(t, size, bold) > wide && cur) { out.push(cur); cur = w; } else cur = t; } if (cur) out.push(cur); return out; }
    para(s, o = {}) { const size = o.size || 9.5, lead = o.lead || size * 1.32, x = o.x ?? M, wide = o.wide ?? W - 2 * M - (x - M); for (const l of this.wrap(s, size, o.bold, wide)) { this.need(lead); this.text(x, this.y - size, l, o); this.y -= lead; } this.y -= o.after ?? 3; }
    need(h) { if (this.y - h < M - 6) throw new Error("The cover note does not fit on one page"); }
  }

  function finish(page) {
    const stream = page.ops.join("\n"), objs = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    ];
    let out = "%PDF-1.4\n"; const off = [];
    objs.forEach((o, i) => { off.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const start = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${off.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
    return Z.utf8(out);
  }

  return { Page, finish, W, H, M };
});
