// What one request may see: which family, when (the clock), who (the person) and how (that portal's friction). Every read in lib/ takes a view.
// OPEN is the benchmark with no clock, no person and no friction, which is what the portals have always served.
"use strict";
const { query } = require("./http");
const Clock = require("./clock");
const { who, tokenOf, doorsOf } = require("./auth");
const { personOf } = require("./people");
const { BENCHMARK, familyOf } = require("./families");
const RULES = require("../data/portal-rules.json");

const NO_FRICTION = Object.freeze({ second_factor: false, back_years: null, window_days: null, gap_seconds: 0 });
const OPEN = Object.freeze({ today: null, family: BENCHMARK, name: null, person: null, rules: NO_FRICTION });

const rulesFor = (brandId) => RULES.portals[brandId] || NO_FRICTION;

const viewOf = (req, brandId) => {
  const qs = query(req), token = tokenOf(req);
  const family = familyOf(qs.family || (token && token.family));
  const tokened = token && doorsOf(token.brand).includes(brandId) && (token.family || BENCHMARK) === family ? token.name : null;
  const name = who(req, brandId, family) || tokened;
  const person = name ? personOf(name, family) : null;
  return { today: Clock.parse(qs.today), family, name, person, rules: person ? rulesFor(brandId) : NO_FRICTION };
};

module.exports = { OPEN, NO_FRICTION, viewOf, rulesFor };
