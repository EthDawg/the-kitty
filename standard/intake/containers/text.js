/* Bytes to text, shared by the text containers. Pure. */
"use strict";
const CP1252 = "€�‚ƒ„…†‡ˆ‰Š‹Œ�Ž��‘’“”•–—˜™š›œ�žŸ";
const latin1 = (b, from = 0, to = b.length) => { let s = ""; for (let i = from; i < to; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, Math.min(i + 8192, to))); return s; };
const cp1252 = (s) => { let o = ""; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); o += c >= 0x80 && c <= 0x9f ? CP1252[c - 0x80] : s[i]; } return o; };
function utf8(b) {
  try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(b); } catch (e) { return cp1252(latin1(b)); }
}
const stripBom = (s) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);
const entities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "-", mdash: "-", copy: "(c)", rsquo: "'", lsquo: "'", hellip: "..." };
const unescapeXml = (s) => s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, e) => { if (e[0] === "#") { const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return String.fromCodePoint(n); } return entities[e] != null ? entities[e] : m; });
module.exports = { latin1, cp1252, utf8, stripBom, unescapeXml };
