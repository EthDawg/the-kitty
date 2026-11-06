// Reading a zip, no dependency: the central directory, then each entry. Enough for an accountant to see what is in a pack and for
// the Drive to read an xlsx. Refuses anything that would inflate past a limit.
"use strict";
const zlib = require("zlib");

const MAX_ENTRY = 32 * 1024 * 1024;

const entries = (buf) => {
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0) return null;
  const count = buf.readUInt16LE(end + 10), out = [];
  let p = buf.readUInt32LE(end + 16);
  for (let i = 0; i < count && p + 46 <= buf.length && buf.readUInt32LE(p) === 0x02014b50; i++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), size = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), at = buf.readUInt32LE(p + 42);
    out.push({ name: buf.subarray(p + 46, p + 46 + nlen).toString("utf8"), method, csize, size, at });
    p += 46 + nlen + xlen + clen;
  }
  return out;
};

const read = (buf, e) => {
  if (e.size > MAX_ENTRY) return null;
  const nlen = buf.readUInt16LE(e.at + 26), xlen = buf.readUInt16LE(e.at + 28), start = e.at + 30 + nlen + xlen, body = buf.subarray(start, start + e.csize);
  if (e.method === 0) return Buffer.from(body);
  if (e.method === 8) { try { return zlib.inflateRawSync(body, { maxOutputLength: MAX_ENTRY }); } catch { return null; } }
  return null;
};

module.exports = { entries, read };
