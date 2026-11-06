/* Small pure helpers: dates as ISO strings, money as integer cents, units as scaled BigInt, a stable hash.
   No clock, no randomness, no file or network access anywhere in the engine. */
"use strict";

const UNIT_SCALE = 100000000n;

// ---------- dates: yyyy-mm-dd strings compare correctly as strings ----------
const monthOf = (d) => d.slice(0, 7);
function monthEnd(m) {
  const [y, mo] = m.split("-").map(Number);
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return `${m}-${String(last).padStart(2, "0")}`;
}
function addDays(d, n) {
  const t = Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) + n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}
function daysBetween(a, b) {
  const t = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
  return Math.round((t(b) - t(a)) / 86400000);
}
function nextMonth(m) {
  const [y, mo] = m.split("-").map(Number);
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
}
function monthsBetween(first, last) {
  const out = [];
  for (let m = first; m <= last; m = nextMonth(m)) out.push(m);
  return out;
}
// FY label by the year it ends: 1 Jul 2025 to 30 Jun 2026 is FY2026.
function fyOf(d, startMonth = 7) {
  const y = +d.slice(0, 4), m = +d.slice(5, 7);
  return `FY${m >= startMonth ? y + 1 : y}`;
}
function fyRange(fy, startMonth = 7) {
  const end = +fy.slice(2);
  const mm = String(startMonth).padStart(2, "0");
  return { start: `${end - 1}-${mm}-01`, end: addDays(`${end}-${mm}-01`, -1), stop: `${end}-${mm}-01` };
}

// ---------- money and units ----------
function parseUnits(s) {
  if (s == null || s === "") return 0n;
  let t = String(s).trim().replace(/,/g, "");
  const neg = t.startsWith("-");
  if (neg) t = t.slice(1);
  const [whole, frac = ""] = t.split(".");
  const v = BigInt(whole || "0") * UNIT_SCALE + BigInt((frac + "00000000").slice(0, 8));
  return neg ? -v : v;
}
function fmtUnits(v) {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const whole = a / UNIT_SCALE;
  const frac = String(a % UNIT_SCALE).padStart(8, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
}
// Units times a decimal price, to whole cents, half up. Exact: no floats.
function unitsValueCents(units, price) {
  const p = parseUnits(price);
  const num = units * p;                         // scaled 1e16 dollars
  const denom = UNIT_SCALE * UNIT_SCALE / 100n;  // 1e14 per cent
  const half = denom / 2n;
  return Number(num >= 0n ? (num + half) / denom : -((-num + half) / denom));
}
// Split cents across weights by the largest-remainder method. Ties go to the earlier key. Always sums exactly.
function allocate(cents, parts) {
  const total = parts.reduce((s, p) => s + p.weight, 0);
  if (!total) throw new Error("allocate: zero total weight");
  const sign = cents < 0 ? -1 : 1, abs = Math.abs(cents);
  const rows = parts.map((p, i) => {
    const exact = (abs * p.weight) / total;
    return { key: p.key, i, cents: Math.floor(exact), rem: exact - Math.floor(exact) };
  });
  let left = abs - rows.reduce((s, r) => s + r.cents, 0);
  for (const r of [...rows].sort((a, b) => b.rem - a.rem || String(a.key).localeCompare(String(b.key)))) {
    if (left <= 0) break;
    r.cents += 1; left -= 1;
  }
  return rows.map((r) => ({ key: r.key, cents: sign * r.cents }));
}

// ---------- identity ----------
// FNV-1a 64-bit. Enough for content-addressed row ids in one household; not a security hash.
function hash64(s) {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n, mask = 0xffffffffffffffffn;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i) & 0xff);
    h = (h * prime) & mask;
    const hi = s.charCodeAt(i) >> 8;
    if (hi) { h ^= BigInt(hi); h = (h * prime) & mask; }
  }
  return h.toString(16).padStart(16, "0");
}
function stableStringify(v) {
  if (v === undefined) return "null";
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(",")}}`;
}
const byKey = (rows, key) => { const m = new Map(); for (const r of rows) m.set(r[key], r); return m; };
function groupBy(rows, f) {
  const m = new Map();
  for (const r of rows) { const k = f(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
  return m;
}
const sum = (rows, f) => rows.reduce((s, r) => s + (f ? f(r) : r), 0);
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// Which of these lines add to the target, each counted by its size. Largest lines first, so the first few are the likely ones.
function subsetSum(lines, target) {
  const items = lines.slice(0, 16);
  for (let mask = 1; mask < 1 << items.length; mask++) {
    let s = 0;
    for (let i = 0; i < items.length; i++) if (mask & (1 << i)) s += Math.abs(items[i].cents);
    if (s === target) return items.filter((_, i) => mask & (1 << i));
  }
  return null;
}

module.exports = { subsetSum, UNIT_SCALE, monthOf, monthEnd, addDays, daysBetween, nextMonth, monthsBetween, fyOf, fyRange, parseUnits, fmtUnits, unitsValueCents, allocate, hash64, stableStringify, byKey, groupBy, sum, cmp };
