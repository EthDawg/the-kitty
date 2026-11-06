/* Shared by the findings. The standard, untouched, and the smallest household that shows each thing. */
"use strict";
const { household } = require("../../standard/eval/households/kit");
const { rebuild } = require("../../standard/engine/rebuild");
const schema = { events: require("../../standard/schema/events.json") };
const metrics = require("../../standard/schema/metrics.json");
const run = (h, extra = {}) => rebuild({ setup: h.setup, sources: h.sources, observations: h.observations, decisions: h.decisions, rules: h.rules, schema, ...extra });
module.exports = { household, rebuild, schema, metrics, run };
