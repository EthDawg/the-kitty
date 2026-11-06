// An email as it arrives: headers, the plain and HTML parts, any attachments. Handles what the world writes (multipart/alternative,
// quoted-printable, base64) and what a person might send.
"use strict";

const unfold = (s) => s.replace(/\r?\n[ \t]+/g, " ");
const headers = (block) => {
  const out = {};
  for (const line of unfold(block).split(/\r?\n/)) { const i = line.indexOf(":"); if (i > 0) out[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim(); }
  return out;
};
const param = (value, key) => { const m = String(value || "").match(new RegExp(`${key}="?([^";]+)"?`, "i")); return m ? m[1] : null; };
const qp = (s) => {
  const bytes = [];
  const text = s.replace(/=\r?\n/g, "");
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(text.slice(i + 1, i + 3))) { bytes.push(parseInt(text.slice(i + 1, i + 3), 16)); i += 2; } else bytes.push(text.charCodeAt(i) & 255);
  }
  return Buffer.from(bytes);
};
const decode = (body, enc) => {
  const e = String(enc || "").toLowerCase();
  if (e === "base64") return Buffer.from(body.replace(/\s+/g, ""), "base64");
  if (e === "quoted-printable") return qp(body);
  return Buffer.from(body, "latin1");
};

const walk = (raw, out) => {
  const split = raw.search(/\r?\n\r?\n/);
  const head = headers(split < 0 ? raw : raw.slice(0, split));
  const body = split < 0 ? "" : raw.slice(raw.indexOf("\n", split + 1) + 1).replace(/^\r?\n/, "");
  const type = (head["content-type"] || "text/plain").toLowerCase();
  if (type.startsWith("multipart/")) {
    const boundary = param(head["content-type"], "boundary");
    if (boundary) for (const part of body.split(`--${boundary}`).slice(1)) { if (part.startsWith("--")) break; walk(part.replace(/^\r?\n/, ""), out); }
    return head;
  }
  const bytes = decode(body, head["content-transfer-encoding"]);
  const filename = param(head["content-disposition"], "filename") || param(head["content-type"], "name");
  if (filename) out.attachments.push({ name: filename, type: type.split(";")[0], bytes });
  else if (type.startsWith("text/html")) out.html = out.html || bytes.toString("utf8");
  else if (type.startsWith("text/")) out.text = out.text || bytes.toString("utf8");
  return head;
};

const parse = (buf) => {
  const out = { text: "", html: "", attachments: [] };
  const head = walk(buf.toString("latin1"), out);
  return { from: head.from || "", to: head.to || "", cc: head.cc || "", subject: head.subject || "", date: head.date || "", message_id: head["message-id"] || "", ...out };
};

module.exports = { parse };
