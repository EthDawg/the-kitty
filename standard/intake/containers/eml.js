/* An email. MIME multipart walked; the first text/plain body becomes lines, or the first text/html through the html decoder. meta carries the
   headers, the part list and any attachments as bytes. */
"use strict";
const { utf8, latin1 } = require("./text");
const html = require("./html");

function splitHead(s) {
  const m = /\r?\n\r?\n/.exec(s); if (!m) return { head: s, body: "" };
  return { head: s.slice(0, m.index), body: s.slice(m.index + m[0].length) };
}
function headers(head) {
  const out = {}; const unfolded = head.replace(/\r?\n[ \t]+/g, " ");
  for (const l of unfolded.split(/\r?\n/)) { const i = l.indexOf(":"); if (i > 0) out[l.slice(0, i).toLowerCase()] = l.slice(i + 1).trim(); }
  return out;
}
const param = (v, name) => { const m = new RegExp(`${name}="?([^";]+)"?`, "i").exec(v || ""); return m ? m[1] : null; };
function b64(s) {
  const T = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"; const c = s.replace(/[^A-Za-z0-9+/]/g, ""); const out = new Uint8Array(Math.floor(c.length * 3 / 4)); let o = 0, buf = 0, bits = 0;
  for (let i = 0; i < c.length; i++) { buf = (buf << 6) | T.indexOf(c[i]); bits += 6; if (bits >= 8) { bits -= 8; out[o++] = (buf >> bits) & 255; buf &= (1 << bits) - 1; } }
  return out.subarray(0, o);
}
function qp(s) {
  const t = s.replace(/=\r?\n/g, ""); const out = []; for (let i = 0; i < t.length; i++) { if (t[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(t.slice(i + 1, i + 3))) { out.push(parseInt(t.slice(i + 1, i + 3), 16)); i += 2; } else out.push(t.charCodeAt(i) & 255); }
  return new Uint8Array(out);
}
function partBytes(body, enc) {
  const e = (enc || "").toLowerCase();
  if (e === "base64") return b64(body);
  if (e === "quoted-printable") return qp(body);
  const u = new Uint8Array(body.length); for (let i = 0; i < body.length; i++) u[i] = body.charCodeAt(i) & 255; return u;
}
function walk(s, parts) {
  const { head, body } = splitHead(s), h = headers(head), type = (h["content-type"] || "text/plain").split(";")[0].trim().toLowerCase();
  if (type.startsWith("multipart/")) {
    const b = param(h["content-type"], "boundary");
    if (!b) return h;
    for (const piece of body.split(`--${b}`).slice(1)) { if (piece.startsWith("--")) break; walk(piece.replace(/^\r?\n/, "").replace(/\r?\n$/, ""), parts); }
    return h;
  }
  parts.push({ type, name: param(h["content-disposition"], "filename") || param(h["content-type"], "name"), disposition: (h["content-disposition"] || "").split(";")[0].trim().toLowerCase(), bytes: partBytes(body, h["content-transfer-encoding"]) });
  return h;
}

function decode(bytes) {
  const parts = [], h = walk(latin1(bytes), parts);
  const inline = parts.filter((p) => p.disposition !== "attachment");
  const plain = inline.find((p) => p.type === "text/plain"), rich = inline.find((p) => p.type === "text/html");
  let lines = [], rows = [];
  if (plain) lines = utf8(plain.bytes).split(/\r?\n/).map((t) => t.trim()).filter((t) => t).map((t, i) => ({ text: t.replace(/\s{2,}/g, "  "), cells: t.split(/\s{2,}/), page: 1, y: i }));
  else if (rich) { const d = html.fromText(utf8(rich.bytes)); lines = d.lines; rows = d.tables[0] || []; }
  const hd = { from: h.from || "", to: h.to || "", subject: h.subject || "", date: h.date || "", message_id: h["message-id"] || "" };
  return { lines, rows, meta: { container: "eml", ...hd, parts: parts.map((p) => ({ type: p.type, name: p.name, disposition: p.disposition, size: p.bytes.length })), attachments: parts.filter((p) => p.disposition === "attachment").map((p) => ({ name: p.name, type: p.type, bytes: p.bytes })) } };
}

module.exports = { decode };
