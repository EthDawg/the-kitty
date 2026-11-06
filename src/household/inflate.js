/* Inflate with no dependency, synchronous, because the containers call it in the middle of a parse and DecompressionStream is async. RFC 1951.
   A page and a phone have no zlib. Slow-and-small on purpose: a canonical Huffman decode, bit by bit. Statements are kilobytes. */
"use strict";

const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

function table(lengths) {
  const count = new Uint16Array(16), symbol = new Uint16Array(lengths.length), offs = new Uint16Array(16);
  for (const l of lengths) count[l] += 1;
  count[0] = 0;
  for (let i = 1; i < 15; i++) offs[i + 1] = offs[i] + count[i];
  lengths.forEach((l, s) => { if (l) symbol[offs[l]++] = s; });
  return { count, symbol };
}
const FIXED_L = table([...Array(144).fill(8), ...Array(112).fill(9), ...Array(24).fill(7), ...Array(8).fill(8)]);
const FIXED_D = table(Array(30).fill(5));

function inflateRaw(src) {
  let pos = 0, bitbuf = 0, bitcnt = 0, out = new Uint8Array(Math.max(1024, src.length * 4)), n = 0;
  const need = (extra) => { if (n + extra > out.length) { const bigger = new Uint8Array(Math.max(out.length * 2, n + extra)); bigger.set(out.subarray(0, n)); out = bigger; } };
  const bits = (want) => {
    let val = bitbuf;
    while (bitcnt < want) {
      if (pos >= src.length) throw new Error("inflate: ran out of input");
      val |= src[pos++] << bitcnt; bitcnt += 8;
    }
    bitbuf = val >>> want; bitcnt -= want;
    return val & ((1 << want) - 1);
  };
  const decode = (h) => {
    let code = 0, first = 0, index = 0;
    for (let len = 1; len <= 15; len++) {
      code |= bits(1);
      const c = h.count[len];
      if (code - c < first) return h.symbol[index + (code - first)];
      index += c; first += c; first <<= 1; code <<= 1;
    }
    throw new Error("inflate: bad code");
  };
  const codes = (lit, dist) => {
    for (;;) {
      let s = decode(lit);
      if (s < 256) { need(1); out[n++] = s; continue; }
      if (s === 256) return;
      s -= 257;
      if (s >= 29) throw new Error("inflate: bad length");
      const len = LBASE[s] + bits(LEXT[s]), ds = decode(dist);
      if (ds >= 30) throw new Error("inflate: bad distance");
      const d = DBASE[ds] + bits(DEXT[ds]);
      if (d > n) throw new Error("inflate: distance too far back");
      need(len);
      for (let i = 0; i < len; i++) { out[n] = out[n - d]; n += 1; }
    }
  };
  let last = 0;
  while (!last) {
    last = bits(1);
    const type = bits(2);
    if (type === 0) {
      bitbuf = 0; bitcnt = 0;
      if (pos + 4 > src.length) throw new Error("inflate: ran out of input");
      const len = src[pos] | (src[pos + 1] << 8); pos += 4;
      if (pos + len > src.length) throw new Error("inflate: ran out of input");
      need(len); out.set(src.subarray(pos, pos + len), n); n += len; pos += len;
    } else if (type === 1) codes(FIXED_L, FIXED_D);
    else if (type === 2) {
      const nlen = bits(5) + 257, ndist = bits(5) + 1, ncode = bits(4) + 4, cl = new Array(19).fill(0);
      for (let i = 0; i < ncode; i++) cl[ORDER[i]] = bits(3);
      const lencode = table(cl), lengths = new Array(nlen + ndist).fill(0);
      let i = 0;
      while (i < nlen + ndist) {
        const s = decode(lencode);
        if (s < 16) { lengths[i++] = s; continue; }
        let prev = 0, rep;
        if (s === 16) { if (!i) throw new Error("inflate: no previous length"); prev = lengths[i - 1]; rep = 3 + bits(2); }
        else rep = s === 17 ? 3 + bits(3) : 11 + bits(7);
        if (i + rep > nlen + ndist) throw new Error("inflate: too many lengths");
        while (rep--) lengths[i++] = prev;
      }
      codes(table(lengths.slice(0, nlen)), table(lengths.slice(nlen)));
    } else throw new Error("inflate: bad block type");
  }
  return out.slice(0, n);
}
// raw: a zip entry. Otherwise a zlib stream, as a PDF holds: two header bytes, then the deflate, then a checksum nobody needs here.
function inflate(bytes, raw) {
  if (raw) return inflateRaw(bytes);
  if (bytes.length < 2 || (bytes[0] & 15) !== 8 || ((bytes[0] << 8) | bytes[1]) % 31 !== 0) throw new Error("inflate: not a zlib stream");
  return inflateRaw(bytes.subarray(2));
}
module.exports = { inflate };
