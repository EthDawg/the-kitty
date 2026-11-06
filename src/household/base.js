/* What every household shares and none of them owns: schema, law, dictionary, recipes, default categories. A host hands in what it cannot
   require statically (the recipes folder, the dictionary), once. SPEC 13: shared data updates on open and reads through a household's overrides. */
"use strict";
const Engine = require("../engine.js");
const { inflate } = require("./inflate");
const events = require("../../standard/schema/events.json");
const metrics = require("../../standard/schema/metrics.json");
const observations = require("../../standard/schema/observations.json");
const tablesDoc = require("../../standard/schema/tables.json");
const reference = require("../../standard/reference/au.json");
const defaults = require("./defaults.json");

let held = null;
function setBase({ recipes, merchants, categories, inflate: hostInflate }) {
  Engine.loadMerchants({ merchants, categories });
  held = { recipes, inflate: hostInflate || inflate, schema: { events, metrics }, vocab: observations, tablesDoc, reference, defaults };
  return held;
}
function base() {
  if (!held) throw new Error("The household base is not loaded. Require src/household/node.js, or load the browser bundle.");
  return held;
}
// reference.verified_at is null in au.json; the date lives in au-verified.json, 300 KB of evidence no page should carry. Finding R-003.
const verifiedAt = () => base().reference.verified_at || base().defaults.reference_verified_at;
module.exports = { setBase, base, verifiedAt };
