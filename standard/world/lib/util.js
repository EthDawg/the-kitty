/* The world's small tools: integer cents, ISO dates, a seeded generator, delimited-text writers. No clock, no Math.random:
   the same inputs give the same bytes. */
"use strict";

const pad = (n, w = 2) => String(n).padStart(w, "0");

// ---------- money ----------
const toCents = (n) => Math.round(Number(n) * 100);
const fix = (c) => { const s = Math.abs(c); const v = `${Math.floor(s / 100)}.${pad(s % 100)}`; return c < 0 ? `-${v}` : v; };
const commas = (s) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const money = (c) => { const s = Math.abs(c); const v = `${commas(String(Math.floor(s / 100)))}.${pad(s % 100)}`; return c < 0 ? `-${v}` : v; };
const aud = (c) => `${c < 0 ? "-" : ""}A$${money(Math.abs(c))}`;
const signed = (c) => `${c >= 0 ? "+" : "-"}${money(Math.abs(c))}`;
// Rational rounding, half away from zero, for a cents value times num/den. BigInt so large balances stay exact.
const mulDiv = (a, num, den) => {
  const n = BigInt(a) * BigInt(num), d = BigInt(den);
  const neg = (n < 0n) !== (d < 0n);
  const an = n < 0n ? -n : n, ad = d < 0n ? -d : d;
  const q = (an * 2n + ad) / (ad * 2n);
  return Number(neg ? -q : q);
};
const pct = (c, p) => Math.round(c * p); // a double rate on an amount; only ever used where the rounded cents are then fixed as data

// ---------- dates, all ISO text ----------
const parts = (iso) => iso.split("-").map(Number);
const toDays = (iso) => { const [y, m, d] = parts(iso); return Math.round(Date.UTC(y, m - 1, d) / 864e5); };
const fromDays = (n) => new Date(n * 864e5).toISOString().slice(0, 10);
const addDays = (iso, n) => fromDays(toDays(iso) + n);
const dayDiff = (a, b) => toDays(b) - toDays(a);
const weekday = (iso) => new Date(toDays(iso) * 864e5).getUTCDay();
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const monthEnd = (ym) => { const [y, m] = ym.split("-").map(Number); return `${ym}-${pad(lastDay(y, m))}`; };
const nextMonth = (ym) => { let [y, m] = ym.split("-").map(Number); m += 1; if (m > 12) { m = 1; y += 1; } return `${y}-${pad(m)}`; };
const prevMonth = (ym) => { let [y, m] = ym.split("-").map(Number); m -= 1; if (m < 1) { m = 12; y -= 1; } return `${y}-${pad(m)}`; };
const monthRange = (a, b) => { const out = []; for (let m = a; m <= b; m = nextMonth(m)) out.push(m); return out; };
const fyOf = (iso) => { const [y, m] = parts(iso); return m >= 7 ? y + 1 : y; };
const fyStart = (fy) => `${fy - 1}-07-01`;
const fyEnd = (fy) => `${fy}-06-30`;
const fyLabel = (fy) => `FY${fy}`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dmy = (iso) => { const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; };
const fmtDate = (iso) => { const [y, m, d] = parts(iso); return `${pad(d)} ${MONTHS[m - 1]} ${y}`; };
const fmtMonth = (ym) => { const [y, m] = ym.split("-").map(Number); return `${MONTHS[m - 1]} ${y}`; };
const longMonth = (ym) => { const L = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]; const [y, m] = ym.split("-").map(Number); return `${L[m - 1]} ${y}`; };

// ---------- a seeded generator (mulberry32); a stream per purpose so adding one domain never moves another ----------
const hashStr = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
class Rng {
  constructor(name) { this.s = hashStr(`davies:${name}`); }
  next() { this.s = (this.s + 0x6d2b79f5) | 0; let t = Math.imul(this.s ^ (this.s >>> 15), 1 | this.s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
  range(lo, hi) { return lo + (hi - lo) * this.next(); }
  int(lo, hi) { return lo + Math.floor(this.next() * (hi - lo + 1)); }
  pick(a) { return a[Math.floor(this.next() * a.length)]; }
}

// ---------- delimited text, as Python's csv.writer writes it ----------
const q = (v) => { const s = String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const csvLines = (rows) => rows.map((r) => r.map(q).join(",")).join("\r\n") + "\r\n";

module.exports = { pad, toCents, fix, commas, money, aud, signed, mulDiv, pct, parts, toDays, fromDays, addDays, dayDiff, weekday, lastDay, monthEnd, nextMonth, prevMonth,
  monthRange, fyOf, fyStart, fyEnd, fyLabel, MONTHS, dmy, fmtDate, fmtMonth, longMonth, Rng, hashStr, q, csvLines };
