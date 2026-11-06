/* Step 7: turn events into balanced postings by evaluating the templates in schema/events.json. No event kind posts in code. */
"use strict";

function evalAmount(expr, fields, kind) {
  let total = 0;
  const re = /([+-])([a-z_]+)/g;
  let m, seen = 0;
  while ((m = re.exec(expr))) {
    const v = fields[m[2]];
    if (v === undefined || v === null) { if (fields.__strict) throw new Error(`${kind}: no field ${m[2]}`); }
    total += (m[1] === "+" ? 1 : -1) * (Number(v) || 0);
    seen += m[0].length;
  }
  if (seen !== expr.length) throw new Error(`${kind}: bad amount expression ${expr}`);
  return total;
}

function target(tpl, refs, kind) {
  return tpl.replace(/\{([a-z_]+)\}/g, (_, k) => {
    if (refs[k] == null || refs[k] === "") throw new Error(`${kind}: no ref ${k} for ${tpl}`);
    return refs[k];
  });
}

function post(event, schema) {
  const def = schema.kinds[event.kind];
  if (!def) throw new Error(`unknown event kind ${event.kind}`);
  const out = [];
  let line = 0;
  for (const [tpl, expr] of def.legs) {
    const cents = evalAmount(expr, event.fields || {}, event.kind);
    if (!cents) continue;
    const t = target(tpl, event.refs || {}, event.kind);
    const row = { event_id: event.event_id, line: ++line, account_id: null, category_id: null, amount_cents: cents, units: null, instrument_id: null, memo: null };
    if (t.startsWith("cat:")) row.category_id = t.slice(4); else row.account_id = t;
    out.push(row);
  }
  if (event.units && event.holding) {
    const leg = out.find((p) => p.account_id === event.holding);
    if (leg) { leg.units = event.units; leg.instrument_id = event.instrument_id; }
  }
  return out;
}

// Prove every template sums to zero whatever the fields hold: each identifier's coefficient across the legs is zero.
function proveTemplates(schema) {
  const bad = [];
  for (const [kind, def] of Object.entries(schema.kinds)) {
    const coef = {};
    for (const [, expr] of def.legs) {
      const re = /([+-])([a-z_]+)/g;
      let m;
      while ((m = re.exec(expr))) coef[m[2]] = (coef[m[2]] || 0) + (m[1] === "+" ? 1 : -1);
    }
    for (const [k, v] of Object.entries(coef)) if (v) bad.push(`${kind}: ${k} sums to ${v}`);
  }
  return bad;
}

module.exports = { post, proveTemplates };
