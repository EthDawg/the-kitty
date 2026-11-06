/* A pack never carries a tax file number. Agents are advised not to take them by email, and a zip is an email attachment.
   This reads text out of what a pack is about to send, the words inside PDFs and spreadsheets included, and says what it finds and what it could not read.
   It flags a shape. A nine-digit number that passes the tax office's check digit is treated as a TFN until a person says otherwise, because a false
   alarm costs one file held back and a miss cannot be taken back. */
(function (root, name, deps, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(...deps.map((d) => require(`./${d}.js`)));
  else { const K = (root.KittyPack = root.KittyPack || {}); K[name] = factory(...deps.map((d) => K[d])); }
})(typeof self !== "undefined" ? self : this, "tfn", ["zip"], function (Z) {
  "use strict";
  const W9 = [1, 4, 3, 7, 5, 8, 6, 9, 10], W8 = [10, 7, 8, 4, 6, 3, 5, 1];
  const check = (d) => { const w = d.length === 9 ? W9 : W8; let s = 0; for (let i = 0; i < d.length; i++) s += Number(d[i]) * w[i]; return s % 11 === 0; };

  function scanText(text) {
    const hits = [], t = String(text).replace(/\b[0-9a-f]{64}\b/gi, " ");    // a sha-256 in a manifest is a hash, not a number
    for (const m of t.matchAll(/(?<![\d.,/-])(\d{3})[ -]?(\d{3})[ -]?(\d{3})(?![\d.,]*\d)/g)) { const d = m[1] + m[2] + m[3]; if (check(d)) hits.push({ kind: "check digit", at: m.index }); }
    for (const m of t.matchAll(/(?:\btfn\b|tax\s*file\s*(?:no|number)\b)[\s:#.-]*(\d{3}[ -]?\d{3}[ -]?\d{2,3})(?![\d-])/gi)) hits.push({ kind: "labelled", at: m.index });
    return hits;
  }

  const latin = (b) => { let s = ""; for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, i + 8192)); return s; };
  const bytesOf = (s) => { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255; return b; };

  // The strings a PDF draws, from literal and hex operands, after inflating its streams. Good enough to see digits; not a text extractor.
  function pdfText(bytes, inflate) {
    const raw = latin(bytes); let out = "", opaque = 0;
    const take = (content) => {
      for (const m of content.matchAll(/\(((?:\\.|[^\\)])*)\)\s*(?:Tj|'|")/g)) out += `${m[1].replace(/\\([\\()])/g, "$1")}\n`;
      for (const m of content.matchAll(/<([0-9A-Fa-f\s]+)>\s*Tj/g)) out += `${m[1].replace(/\s/g, "").replace(/../g, (h) => String.fromCharCode(parseInt(h, 16)))}\n`;
      for (const m of content.matchAll(/\[((?:\\.|[^\]])*)\]\s*TJ/g)) { let row = ""; for (const p of m[1].matchAll(/\(((?:\\.|[^\\)])*)\)|<([0-9A-Fa-f]+)>/g)) row += p[1] ?? p[2].replace(/../g, (h) => String.fromCharCode(parseInt(h, 16))); out += `${row}\n`; }
    };
    for (const m of raw.matchAll(/<<(.*?)>>\s*stream\r?\n/gs)) {
      const start = m.index + m[0].length, end = raw.indexOf("endstream", start), dict = m[1];
      if (end < 0) continue;
      if (/\/Subtype\s*\/Image/.test(dict)) { opaque++; continue; }
      if (/\/FlateDecode/.test(dict)) {
        const b = inflate ? inflate(bytes.subarray(start, end).slice(), false) : null;
        if (b) take(latin(b)); else opaque++;
      } else take(raw.slice(start, end));
    }
    return { text: out, opaque };
  }

  /* What a file says, or null when it cannot be read here. `opaque` counts parts that could not be looked into: a scanned page has no text to test. */
  function textOf(name, bytes, inflate) {
    const ext = (/\.([a-z0-9]+)$/i.exec(name) || [])[1];
    const e = (ext || "").toLowerCase();
    if (["csv", "tsv", "txt", "json", "html", "htm", "eml", "ofx", "qif", "xml", "qfx"].includes(e)) return { text: new TextDecoder().decode(bytes), opaque: 0 };
    if (e === "pdf") return pdfText(bytes, inflate);
    if (e === "xlsx") {
      let parts; try { parts = Z.read(bytes, inflate ? (b) => inflate(b, true) : null); } catch (x) { return { text: "", opaque: 1 }; }
      let text = "", opaque = 0;
      for (const p of parts) { if (!p.bytes) { opaque++; continue; } if (/\.xml$/.test(p.name)) text += `${new TextDecoder().decode(p.bytes).replace(/<[^>]+>/g, " ")}\n`; }
      return { text, opaque };
    }
    return { text: "", opaque: 1 };
  }

  function scanFile(name, bytes, inflate) {
    const { text, opaque } = textOf(name, bytes, inflate);
    return { hits: scanText(text), opaque };
  }

  return { scanText, scanFile, textOf, check, bytesOf };
});
