/* A zip, written and read with no platform calls. Deflate comes from the host if it has one, otherwise files are stored; either is a valid zip.
   Same files in, same bytes out: names sorted by the caller, every timestamp the pack's own date, nothing from a clock. */
(function (root, name, deps, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(...deps.map((d) => require(`./${d}.js`)));
  else { const K = (root.KittyPack = root.KittyPack || {}); K[name] = factory(...deps.map((d) => K[d])); }
})(typeof self !== "undefined" ? self : this, "zip", [], function () {
  "use strict";
  const table = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = table[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  const utf8 = (s) => new TextEncoder().encode(s);
  const dosDate = (iso) => { const [y, m, d] = String(iso || "1980-01-01").split("-").map(Number); return ((y - 1980) << 9) | (m << 5) | d; };

  function concat(parts) { const n = parts.reduce((s, p) => s + p.length, 0), out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; }

  function write(files, { deflateRaw, date } = {}) {
    const chunks = [], central = []; let offset = 0;
    const day = dosDate(date);
    for (const [name, content] of files) {
      const data = typeof content === "string" ? utf8(content) : content, nm = utf8(name), crc = crc32(data);
      let body = data, method = 0;
      if (deflateRaw) { const d = deflateRaw(data); if (d.length < data.length) { body = d; method = 8; } }
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, method, true); h.setUint16(10, 0, true); h.setUint16(12, day, true);
      h.setUint32(14, crc, true); h.setUint32(18, body.length, true); h.setUint32(22, data.length, true); h.setUint16(26, nm.length, true); h.setUint16(28, 0, true);
      chunks.push(new Uint8Array(h.buffer), nm, body);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, method, true); c.setUint16(12, 0, true); c.setUint16(14, day, true);
      c.setUint32(16, crc, true); c.setUint32(20, body.length, true); c.setUint32(24, data.length, true); c.setUint16(28, nm.length, true); c.setUint32(42, offset, true);
      central.push(new Uint8Array(c.buffer), nm);
      offset += 30 + nm.length + body.length;
    }
    const cen = concat(central), e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cen.length, true); e.setUint32(16, offset, true);
    return concat([...chunks, cen, new Uint8Array(e.buffer)]);
  }

  /* Reads this writer's zips and ordinary ones: central directory, no zip64. */
  function read(bytes, inflateRaw) {
    const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    let i = bytes.length - 22;
    while (i >= 0 && d.getUint32(i, true) !== 0x06054b50) i--;
    if (i < 0) throw new Error("Not a zip");
    const n = d.getUint16(i + 10, true); let p = d.getUint32(i + 16, true);
    const out = [], text = new TextDecoder();
    for (let k = 0; k < n; k++) {
      const method = d.getUint16(p + 10, true), size = d.getUint32(p + 20, true), nl = d.getUint16(p + 28, true), xl = d.getUint16(p + 30, true), cl = d.getUint16(p + 32, true), off = d.getUint32(p + 42, true);
      const name = text.decode(bytes.subarray(p + 46, p + 46 + nl));
      const start = off + 30 + d.getUint16(off + 26, true) + d.getUint16(off + 28, true);
      const body = bytes.subarray(start, start + size);
      out.push({ name, bytes: method === 0 ? body : inflateRaw ? inflateRaw(body) : null });
      p += 46 + nl + xl + cl;
    }
    return out;
  }

  return { write, read, crc32, utf8, concat };
});
