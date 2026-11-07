// The clock is one request parameter: ?today=2027-01-31. A listing shows what had been delivered by then, and a page of accounts stops
// at that day. This file is the one place that knows how: lib/data.js, lib/exports.js, lib/vault.js, lib/drive.js and lib/mail.js ask it
// through has() and upTo(). No today means everything the portals hold. It filters what is listed. It does not hide a file whose address
// you already have, and llms.txt says so.
"use strict";

const validDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "") && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;

// Null for no clock. A today written wrongly is refused, not ignored.
const parse = (value) => {
  const s = String(value == null ? "" : value).trim();
  if (!s) return null;
  if (validDate(s)) return s;
  const e = new Error("today is a date, YYYY-MM-DD."); e.status = 400; throw e;
};

// Had this been delivered yet? The whole rule.
const has = (view, date) => !view.today || date <= view.today;
// The earlier of this date and today.
const upTo = (view, date) => (view.today && view.today < date ? view.today : date);

module.exports = { parse, has, upTo, validDate };
