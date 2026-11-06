/* A scanned receipt: a grey image of printed text with a little noise and no text layer. Deterministic: the noise is seeded. A 5x7 font is enough
   for a model to read it and for a recipe to get nothing. */
"use strict";
const { Rng } = require("./util");

const F = { " ": "00000000000000", A: "0E11111F111111", B: "1E11111E11111E", C: "0E11101010110E", D: "1E11111111111E", E: "1F10101E10101F", F: "1F10101E101010", G: "0E11101713110F", H: "1111111F111111", I: "0E04040404040E", J: "0702020202120C", K: "11121418141211", L: "1010101010101F", M: "111B1515111111", N: "11191513111111", O: "0E11111111110E", P: "1E11111E101010", Q: "0E11111115120D", R: "1E11111E141211", S: "0F10100E01011E", T: "1F040404040404", U: "1111111111110E", V: "11111111110A04", W: "11111115151B11", X: "11110A040A1111", Y: "11110A04040404", Z: "1F01020408101F",
  0: "0E11131519110E", 1: "040C040404040E", 2: "0E11010204081F", 3: "1F02040201110E", 4: "02060A121F0202", 5: "1F101E0101110E", 6: "0608101E11110E", 7: "1F010204080808", 8: "0E11110E11110E", 9: "0E11110F01020C", ".": "00000000000C0C", ",": "00000000000C04", ":": "000C0C000C0C00", "-": "0000001F000000", "/": "01010204081010", "$": "040F140E051E04", "%": "18190204081303", "#": "0A0A1F0A1F0A0A", "(": "02040808080402", ")": "08040202020408", "*": "00150E1F0E1500", "&": "0C12120C15120D", "+": "0004041F040400" };

function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) { c ^= b[i]; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; } return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const u32 = (v) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
  const body = new Uint8Array(4 + data.length); for (let i = 0; i < 4; i++) body[i] = type.charCodeAt(i); body.set(data, 4);
  const out = new Uint8Array(12 + data.length); out.set(u32(data.length), 0); out.set(body, 4); out.set(u32(crc32(body)), 8 + data.length);
  return out;
}

function scan(lines, seed, deflate) {
  const scale = 2, cw = 6 * scale, ch = 9 * scale, width = Math.max(...lines.map((l) => l.length)) * cw + 40, height = lines.length * (ch + 4) + 40;
  const px = new Uint8Array(width * height).fill(235), rng = new Rng(`scan:${seed}`);
  lines.forEach((line, row) => {
    [...line.toUpperCase()].forEach((c, col) => {
      const g = F[c] || F[" "];
      for (let y = 0; y < 7; y++) { const bits = parseInt(g.slice(y * 2, y * 2 + 2), 16); for (let x = 0; x < 5; x++) if (bits & (1 << (4 - x))) for (let a = 0; a < scale; a++) for (let b = 0; b < scale; b++) px[(20 + row * (ch + 4) + y * scale + a) * width + 20 + col * cw + x * scale + b] = 40; }
    });
  });
  for (let i = 0; i < px.length; i += 1) if (rng.next() < 0.04) px[i] = Math.max(0, Math.min(255, px[i] + (rng.next() < 0.5 ? -60 : 40)));
  const raw = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (width + 1)] = 0; raw.set(px.subarray(y * width, (y + 1) * width), y * (width + 1) + 1); }
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], u32 = (v) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
  const parts = [new Uint8Array(sig), chunk("IHDR", new Uint8Array([...u32(width), ...u32(height), 8, 0, 0, 0, 0])), chunk("IDAT", deflate(raw)), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0)); let p = 0; for (const x of parts) { out.set(x, p); p += x.length; }
  return out;
}

module.exports = { scan };
