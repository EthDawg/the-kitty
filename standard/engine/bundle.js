/* The portable form: one JSONL file per table plus a manifest. A Sheet, SQLite and a document store are projections of this.
   toBundle is pure. writeBundle takes fs from the host. */
"use strict";
const { hash64, stableStringify, fmtUnits } = require("./util");

function toBundle(L, { setup, tablesSchema, decisions = [], rules = [], recipes = [], version, mode }) {
  const pick = (name, cols) => (row) => { const out = {}; for (const c of cols) if (row[c] !== undefined) out[c] = row[c]; return out; };
  const columns = (t) => tablesSchema.tables[t].columns.map((c) => c.split(":")[0]);
  const events = L.events.map((e) => ({ ...e, witnesses: undefined, postings: undefined, fields: undefined, refs: undefined, line: undefined, lines: undefined }));
  const tables = {
    ...setup, term: L.terms, source: L.sources, observation: L.observations, decision: decisions, rule: rules, recipe: recipes,
    event: events, witness: L.witnesses, posting: L.postings,
    lot: L.lotRows.map((l) => ({ ...l, units: l.units_bought == null ? null : fmtUnits(l.units_bought), units_open: l.units_open == null ? null : fmtUnits(l.units_open), event_id: l.ref || l.lot_id })),
    lot_match: L.lotMatches.map((m) => ({ ...m, event_id: m.event_ref })),
    balance: L.balances.rows.map((b) => ({ ...b, grade: "derived" })),
    tax_return: L.returns ? L.returns.returns : [], tax_line: L.returns ? L.returns.lines : [],
    tax_item: L.tax ? L.tax.items : [], check_result: L.checks, review_item: L.review, metric_value: L.metrics || [],
    run: [{ run_id: L.bundleHash, mode: mode || "rebuild", sources: L.sources.length, observations: L.observations.length, events: L.events.length, review_items: L.review.length, tokens_in: 0, tokens_out: 0, bundle_hash: L.bundleHash }],
  };
  const out = { tables: {}, manifest: { standard_version: version, bundle_hash: L.bundleHash, as_of: L.asOf, tables: {} } };
  const classOf = (plane) => Object.entries(tablesSchema.manifest_classes).find(([, v]) => Array.isArray(v) && v.includes(plane))[0];
  for (const [t, def] of Object.entries(tablesSchema.tables)) {
    const cols = columns(t);
    const rows = (tables[t] || []).map(pick(t, cols));
    const body = rows.map((r) => stableStringify(r)).join("\n");
    out.tables[t] = body ? `${body}\n` : "";
    out.manifest.tables[t] = { rows: rows.length, hash: hash64(body), class: classOf(def.plane), plane: def.plane, workbook: "household" };
  }
  return out;
}
function writeBundle(bundle, dir, fs, path) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [t, body] of Object.entries(bundle.tables)) fs.writeFileSync(path.join(dir, `${t}.jsonl`), body);
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(bundle.manifest, null, 2) + "\n");
}
module.exports = { toBundle, writeBundle };
