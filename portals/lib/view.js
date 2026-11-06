// What one request may see: when (the clock), who (the person) and how (that portal's friction). Every read in lib/ takes a view.
// OPEN is the view with no clock, no person and no friction, which is what the portals have always served.
"use strict";
const crypto = require("crypto");
const { query, cookies } = require("./http");
const Clock = require("./clock");
const { who, tokenOf, doorsOf } = require("./auth");
const { personOf } = require("./people");
const RULES = require("../data/portal-rules.json");

const NO_FRICTION = Object.freeze({ second_factor: false, back_years: null, window_days: null, gap_seconds: 0 });
const OPEN = Object.freeze({ as_of: null, chapter: null, name: null, person: null, run: null, rules: NO_FRICTION });

const rulesFor = (brandId) => RULES.portals[brandId] || NO_FRICTION;

// the clock a request carries: the query wins, then a token, then the cookie. A clock written wrongly is refused, not ignored.
const clockOf = (req, token) => {
  const qs = query(req);
  const raw = qs.today || qs.as_of || (qs.chapter != null && qs.chapter !== "" ? `chapter-${qs.chapter}` : "") || (token && token.as_of) || cookies(req)[Clock.cookieName];
  const clock = Clock.parse(raw);
  if (!clock) { const e = new Error("A clock is a date, YYYY-MM-DD, or a chapter number."); e.status = 400; throw e; }
  return clock;
};

const viewOf = (req, brandId) => {
  const token = tokenOf(req);
  const name = who(req, brandId) || (token && doorsOf(token.brand).includes(brandId) ? token.name : null);
  const clock = clockOf(req, token);
  const person = name ? personOf(name) : null;
  return { ...clock, name, person, run: (token && token.run) || cookies(req).kp_run || null, rules: person ? rulesFor(brandId) : NO_FRICTION };
};

const newRun = () => crypto.randomBytes(8).toString("hex");
const runCookie = (run, isSecure) => `kp_run=${run}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${isSecure ? "; Secure" : ""}`;

module.exports = { OPEN, NO_FRICTION, viewOf, clockOf, rulesFor, newRun, runCookie };
