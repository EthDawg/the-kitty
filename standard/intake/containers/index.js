/* Which container a file is, from its bytes, never its name, and its decoder. Pure. Each decoder returns { rows, meta } or { lines, meta }. */
"use strict";
const { latin1 } = require("./text");
const delimited = require("./delimited"), ofx = require("./ofx"), qif = require("./qif"), json = require("./json"), html = require("./html"), eml = require("./eml"), pdf = require("./pdf"), xlsx = require("./xlsx");

function sniff(bytes) {
  const head = latin1(bytes, 0, Math.min(bytes.length, 2048)).replace(/^\xef\xbb\xbf/, "");
  if (head.startsWith("%PDF-")) return "pdf";
  if (head.startsWith("\x89PNG")) return "image";
  if (head.startsWith("\xff\xd8\xff")) return "image";
  if (head.startsWith("PK\x03\x04")) return "xlsx";
  const t = head.trimStart();
  if (/^OFXHEADER:/.test(t) || /^<\?OFX/i.test(t) || /<\?xml[^>]*\?>\s*<\?OFX/i.test(t) || /^<OFX>/i.test(t)) return "ofx";
  if (/^!(Type|Account|Option)/.test(t)) return "qif";
  if (/^(MIME-Version|From|Return-Path|Received|Delivered-To|Message-ID|Date|Subject|To):/i.test(t)) return "eml";
  if (/^(<!doctype html|<html|<head|<body)/i.test(t)) return "html";
  if (/^[[{]/.test(t)) { try { JSON.parse(latin1(bytes).replace(/^\xef\xbb\xbf/, "")); return "json"; } catch (e) { /* a CSV that starts with a bracket */ } }
  return "delimited";
}

function decode(bytes, opts = {}) {
  const kind = sniff(bytes);
  switch (kind) {
    case "pdf": return pdf.decode(bytes, opts);
    case "xlsx": return xlsx.decode(bytes, opts);
    case "ofx": return ofx.decode(bytes);
    case "qif": return qif.decode(bytes);
    case "eml": return eml.decode(bytes);
    case "html": return html.decode(bytes);
    case "json": return json.decode(bytes);
    case "image": return { lines: [], meta: { container: "image", format: latin1(bytes, 1, 4) === "PNG" ? "png" : "jpeg" } };
    default: return delimited.decode(bytes);
  }
}

module.exports = { decode, sniff };
