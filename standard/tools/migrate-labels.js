/* A household's meaning can live on rows, not rules. Carrying rules alone loses it. This turns row labels into decisions against rebuilt lines, one label to one line,
   and says how many bound. A label that finds no line is reported, never dropped in silence. */
"use strict";
const { groupBy } = require("../engine/util");

// rows: [{ account, date, cents, category_id, merchant?, person? }]
function labelsToDecisions(L, rows, { by = "migration", at = "1970-01-01T00:00:00Z" } = {}) {
  const lines = groupBy(L.lines, (l) => `${l.account}|${l.date}|${l.cents}`);
  const decisions = [], unbound = [];
  for (const [k, labels] of groupBy(rows, (r) => `${r.account}|${r.date}|${r.cents}`)) {
    const held = lines.get(k) || [];
    labels.forEach((r, i) => {
      const line = held[i];
      if (!line) { unbound.push(r); return; }
      decisions.push({ decision_id: `label_${line.key}`, target_type: "line", target_ref: line.key, verb: "categorise", value: { category_id: r.category_id, ...(r.merchant ? { merchant: r.merchant } : {}), ...(r.person ? { person: r.person } : {}) }, by, at, status: "accepted" });
    });
  }
  return { decisions, bound: decisions.length, unbound };
}
module.exports = { labelsToDecisions };
