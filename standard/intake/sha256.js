/* SHA-256 with no dependency, so a phone can identify a source. */
"use strict";
const K = new Uint32Array(64);
{ let n = 0, c = 2; const frac = (x) => ((x - Math.floor(x)) * 4294967296) >>> 0; while (n < 64) { let p = true; for (let i = 2; i * i <= c; i++) if (c % i === 0) { p = false; break; } if (p) K[n++] = frac(Math.cbrt(c)); c += 1; } }

function sha256(bytes) {
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const n = bytes.length, total = ((n + 9 + 63) >> 6) << 6, m = new Uint8Array(total);
  m.set(bytes); m[n] = 0x80;
  const hi = Math.floor(n / 536870912), lo = (n << 3) >>> 0;
  m[total - 8] = hi >>> 24; m[total - 7] = hi >>> 16; m[total - 6] = hi >>> 8; m[total - 5] = hi; m[total - 4] = lo >>> 24; m[total - 3] = lo >>> 16; m[total - 2] = lo >>> 8; m[total - 1] = lo;
  const w = new Uint32Array(64);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) { const j = off + i * 4; w[i] = (m[j] << 24) | (m[j + 1] << 16) | (m[j + 2] << 8) | m[j + 3]; }
    for (let i = 16; i < 64; i++) { const a = w[i - 15], b = w[i - 2]; const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3), s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10); w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0; }
    let [a, b, c, d, e, f, g, x] = h;
    for (let i = 0; i < 64; i++) {
      const s1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7)), ch = (e & f) ^ (~e & g), t1 = (x + s1 + ch + K[i] + w[i]) | 0;
      const s0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10)), mj = (a & b) ^ (a & c) ^ (b & c), t2 = (s0 + mj) | 0;
      x = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += x;
  }
  let out = ""; for (const v of h) out += v.toString(16).padStart(8, "0");
  return out;
}

module.exports = { sha256 };
