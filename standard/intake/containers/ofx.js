/* OFX 1.x (SGML, unclosed tags) and 2.x (XML). rows: a header row then one row per STMTTRN; meta: every scalar tag outside a transaction. */
"use strict";
const { utf8, unescapeXml } = require("./text");

function decode(bytes) {
  const text = utf8(bytes), body = text.slice(Math.max(0, text.search(/<OFX>/i)));
  const tags = [...body.matchAll(/<([A-Za-z0-9.]+)>([^<\r\n]*)/g)].map((m) => [m[1].toUpperCase(), unescapeXml(m[2].trim())]);
  const headTags = {}; for (const m of text.slice(0, text.search(/<OFX>/i) < 0 ? 0 : text.search(/<OFX>/i)).matchAll(/^([A-Z]+):(.*)$/gm)) headTags[m[1]] = m[2].trim();
  const trans = []; const meta = { container: "ofx", header: headTags }; let cur = null;
  const closed = [...body.matchAll(/<(\/?)STMTTRN>/gi)];
  // walk tags in order, a STMTTRN opens a row and the next STMTTRN or the list's end closes it
  const re = /<(\/?)([A-Za-z0-9.]+)>([^<\r\n]*)/g; let m;
  while ((m = re.exec(body))) {
    const close = m[1] === "/", tag = m[2].toUpperCase(), val = unescapeXml(m[3].trim());
    if (tag === "STMTTRN") { if (close) { trans.push(cur); cur = null; } else { if (cur) trans.push(cur); cur = {}; } continue; }
    if (tag === "BANKTRANLIST" && close) { if (cur) trans.push(cur); cur = null; continue; }
    if (close || val === "") continue;
    if (cur) cur[tag] = val; else meta[tag] = val;
  }
  if (cur) trans.push(cur);
  const cols = []; for (const t of trans) for (const k of Object.keys(t)) if (!cols.includes(k)) cols.push(k);
  cols.sort();
  const rows = [cols, ...trans.map((t) => cols.map((c) => (t[c] == null ? "" : t[c])))];
  meta.closed_tags = closed.length > 0;
  return { rows, meta };
}

module.exports = { decode };
