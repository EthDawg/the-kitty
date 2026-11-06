// The clock. An estate grows over a life, so a chapter set in 2027 must see only what existed by then. This file is the one
// place that knows how: lib/view.js puts a clock on every request, and lib/data.js, lib/exports.js, lib/vault.js, lib/drive.js and
// lib/mail.js ask it through has() and upTo(). A row exists from its date, a statement from its issue date, an assessment from its
// assessed date (the world's `issued_on`, carried into estate/vault.json as `exists_from`). No clock means what the portals always
// did: everything they hold. In the brief's words this is `today`, the clock, per request. The as_of a household rebuilds to is a
// separate date that never passes it, and belongs to the runtime. Here the two are one, so ?as_of= still works.
"use strict";

// The life, in order: each chapter's today, the same days life/davies/life.json plays.
const CHAPTERS = [
  { chapter: 0, label: "Hears about it", today: "2027-01-09" },
  { chapter: 1, label: "Blank Kitty", today: "2027-01-16" },
  { chapter: 2, label: "First close", today: "2027-02-14" },
  { chapter: 3, label: "They join", today: "2027-03-31" },
  { chapter: 4, label: "First joint tax time", today: "2027-10-31" },
  { chapter: 5, label: "Home, Salt, the estate", today: "2030-06-30" },
  { chapter: 6, label: "Pocket money", today: "2036-03-31" },
  { chapter: 7, label: "Goes out alone", today: "2037-09-30" },
  { chapter: 8, label: "Move from Google to Microsoft", today: "2038-03-31" },
  { chapter: 9, label: "Salt's first job", today: "2046-03-31" },
  { chapter: 10, label: "A branch: they separate", today: "2040-06-30" },
  { chapter: 11, label: "Retire", today: "2058-06-30" },
  { chapter: 12, label: "Salt as executor", today: "2070-06-30" },
];

const NONE = Object.freeze({ as_of: null, chapter: null });
const validDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "") && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;

// `2027-01-31` or `chapter-4`, the two ways a clock is written down in a cookie, a token or a query string.
const parse = (value) => {
  const s = String(value || "").trim();
  if (!s) return NONE;
  if (validDate(s)) return { as_of: s, chapter: chapterAt(s) };
  const m = s.match(/^chapter-?(\d+)$/i);
  const c = m && CHAPTERS.find((x) => x.chapter === Number(m[1]));
  return c ? { as_of: c.today, chapter: c.chapter } : null; // null: written, and wrong
};
const chapterAt = (iso) => { const c = CHAPTERS.find((x) => x.chapter > 0 && x.today === iso); return c ? c.chapter : null; };
const write = (clock) => (clock.as_of ? clock.as_of : "");

// Does this date exist yet? The whole rule.
const has = (clock, date) => !clock.as_of || date <= clock.as_of;
// The earlier of this date and now.
const upTo = (clock, date) => (clock.as_of && clock.as_of < date ? clock.as_of : date);

const cookieName = "kp_as_of";
const setCookie = (clock, isSecure) => `${cookieName}=${write(clock)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clock.as_of ? 2592000 : 0}${isSecure ? "; Secure" : ""}`;

module.exports = { CHAPTERS, NONE, parse, has, upTo, write, validDate, cookieName, setCookie };
