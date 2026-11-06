/* Do what `next` says, as this family would, until it says up to date or asks something this person cannot do. Every step is what a person read. */
"use strict";
const { K } = require("./family");
const { shown } = require("./household");

async function drive(hh, actor, { today, limit = 120, until } = {}) {
  const seen = new Map();
  for (let i = 0; i < limit; i += 1) {
    const built = await K.rebuildAt(hh.store, { today }), step = await K.next(hh.store, { today, built });
    shown(hh, step, today);
    const key = `${step.id}|${step.say}|${JSON.stringify(step.action.args || {})}`; seen.set(key, (seen.get(key) || 0) + 1);
    if (step.id === "clear" || (until && until(step))) return { step, built, stuck: null };
    if (seen.get(key) > 2) return { step, built, stuck: `${step.id}: asked the same thing three times` };
    const done = await actor(step, { hh, today, built });
    if (!done) return { step, built, stuck: step.id };
  }
  const built = await K.rebuildAt(hh.store, { today });
  return { step: await K.next(hh.store, { today, built }), built, stuck: "limit" };
}
module.exports = { drive };
