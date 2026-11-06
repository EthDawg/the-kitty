// The clock. An estate grows over a life, so a chapter set in 2027 must see only what existed by then. This file is the one
// place that knows how: lib/view.js puts a clock on every request, and lib/data.js, lib/exports.js and lib/estate.js ask it
// through has() and upTo(). A row exists from its date, a statement from its issue date, an assessment from its assessed date
// (the world's `issued_on`, carried into estate/vault.json as `exists_from`). No clock means what the portals always did:
// everything they hold.
"use strict";

// The life, in order, from the programme brief. A chapter's clock stands at its last day unless a date is given.
const CHAPTERS = [
  { chapter: 0, label: "January 2027", from: "2027-01-01", to: "2027-01-31" },
  { chapter: 1, label: "January 2027", from: "2027-01-01", to: "2027-01-31" },
  { chapter: 2, label: "February 2027", from: "2027-02-01", to: "2027-02-28" },
  { chapter: 3, label: "March 2027", from: "2027-03-01", to: "2027-03-31" },
  { chapter: 4, label: "July to October 2027", from: "2027-07-01", to: "2027-10-31" },
  { chapter: 5, label: "2027 to 2028", from: "2027-11-01", to: "2028-12-31" },
  { chapter: 6, label: "2031", from: "2031-01-01", to: "2031-12-31" },
  { chapter: 7, label: "2032", from: "2032-01-01", to: "2032-12-31" },
  { chapter: 8, label: "2034", from: "2034-01-01", to: "2034-12-31" },
  { chapter: 9, label: "2039 to 2041", from: "2039-01-01", to: "2041-12-31" },
  { chapter: 10, label: "2036, a branch", from: "2036-01-01", to: "2036-12-31" },
  { chapter: 11, label: "The 2050s", from: "2050-01-01", to: "2059-12-31" },
  { chapter: 12, label: "Later", from: "2060-01-01", to: "2069-12-31" },
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
  return c ? { as_of: c.to, chapter: c.chapter } : null; // null: written, and wrong
};
const chapterAt = (iso) => { const c = CHAPTERS.find((x) => x.chapter > 0 && iso >= x.from && iso <= x.to); return c ? c.chapter : null; };
const write = (clock) => (clock.as_of ? clock.as_of : "");

// Does this date exist yet? The whole rule.
const has = (clock, date) => !clock.as_of || date <= clock.as_of;
// The earlier of this date and now.
const upTo = (clock, date) => (clock.as_of && clock.as_of < date ? clock.as_of : date);

const cookieName = "kp_as_of";
const setCookie = (clock, isSecure) => `${cookieName}=${write(clock)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clock.as_of ? 2592000 : 0}${isSecure ? "; Secure" : ""}`;

module.exports = { CHAPTERS, NONE, parse, has, upTo, write, validDate, cookieName, setCookie };
