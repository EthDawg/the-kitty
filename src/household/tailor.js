/* Tailoring on a store. SPEC 12: answer at the lowest rung that works, and every piece has a row: the person's sentence, the definition, an example result, and the standard version it was
   written against. None of this reaches the engine: an x_ table is not an original the ledger reads, a memo account never takes a posting, and a saved question only reads.
   On an update the example runs. If it no longer holds, an agent rewrites it from the sentence. */
"use strict";
const { stableStringify, hash64, monthOf } = require("../../standard/engine/util");
const S = require("../../standard/engine/schema");
const { checkTailoring } = require("../../standard/engine/upgrade");
const { base } = require("./base");
const { latest, dayOf } = require("./clock");
const { ready, stamp, fail, slug } = require("./init");
const { columnsOf, STANDARD_VERSION } = require("./tabs");
const { normalise } = require("./codec");
const { record } = require("./replay");

const RUNGS = ["tag", "rule", "saved_question", "widget", "x_term", "x_column", "x_event_kind", "x_observation_kind", "x_table"];
const idFor = (name) => `T-${slug(name)}`;

async function rows(store) { return latest("tailoring", await store.tables.read("tailoring")); }
/* item: { rung, name, sentence, definition, example }. definition.columns on an x_table rung makes the table. */
async function tailor(store, item, { today } = {}) {
  if (!today) throw fail("no_today", "tailor needs today.");
  await ready(store);
  if (!RUNGS.includes(item.rung)) throw fail("bad_rung", `There is no rung called ${item.rung}.`);
  if (!item.sentence) throw fail("no_sentence", "Tailoring keeps the person's own sentence, so it can be rebuilt from it.");
  if (item.rung === "x_table") await store.define(item.name, item.definition.columns);
  const row = { tailoring_id: idFor(item.name), rung: item.rung, name: item.name, sentence: item.sentence, definition: item.definition, example: item.example, standard_version: STANDARD_VERSION, status: item.status || "active" };
  const clean = normalise("tailoring", row), errs = S.validateRow({ name: "tailoring", columns: columnsOf("tailoring") }, clean);
  if (errs.length) throw fail("bad_row", errs.join("; "));
  await store.tables.change("tailoring", clean);
  return clean;
}
/* Rows in an x_ table. The table's own key, if it has one, makes this safe to run twice. */
async function write(store, table, entries, { today } = {}) {
  await ready(store);
  if (!table.startsWith("x_")) throw fail("not_extension", `${table} is not a household's own table.`);
  return record(store, table, entries, { today, strict: true });
}
/* A saved question: { from, date, where, group: [..], sum }. Read-only and disposable. Over a household's own table, up to a date. */
async function ask(store, definition, { as_of } = {}) {
  await ready(store);
  const { from, date, where = {}, group = [], sum } = definition;
  const out = {};
  for (const r of await store.tables.read(from)) {
    if (as_of && date && r[date] > as_of) continue;
    if (Object.entries(where).some(([k, v]) => r[k] !== v)) continue;
    let at = out;
    group.forEach((g, i) => { const key = r[g]; if (i === group.length - 1) at[key] = (at[key] || 0) + (r[sum] || 0); else { at[key] = at[key] || {}; at = at[key]; } });
  }
  return out;
}
const questionOf = async (store, name) => (await rows(store)).find((t) => t.name === name);
async function evaluate(store, t) {
  const d = t.rung === "widget" ? (await questionOf(store, t.definition.question) || {}).definition : t.definition;
  if (!d || !d.from) return null;
  return ask(store, d, { as_of: t.example && t.example.as_of });
}
/* Every example, run. SPEC 12. Saved questions and widgets; a table or a term has nothing to run. */
async function check(store, { names } = {}) {
  const live = (await rows(store)).filter((t) => t.status === "active" && ["saved_question", "widget"].includes(t.rung) && (!names || names.includes(t.name)));
  const got = new Map();
  for (const t of live) got.set(t.name, await evaluate(store, t));
  return checkTailoring(live, (t) => got.get(t.name));
}
/* What the Home tab pins: each widget's title and its answer today. */
async function widgets(store, { today } = {}) {
  const live = (await rows(store)).filter((t) => t.status === "active" && t.rung === "widget"), out = [];
  for (const w of live) { const q = await questionOf(store, w.definition.question); out.push({ name: w.name, title: w.definition.title, place: w.definition.place, answer: q ? await ask(store, q.definition, { as_of: today }) : null }); }
  return out;
}
/* Where a child stands today by age, from a shared extension's bands. Age comes from birth_date, never a stored number. */
function ageOn(birth, today) {
  const y = Number(today.slice(0, 4)) - Number(birth.slice(0, 4));
  return today.slice(5) < birth.slice(5) ? y - 1 : y;
}
function stageOf(ext, birth, today) {
  const age = ageOn(birth, today);
  let stage = { stage: "too_young", says: `Not yet. Jars start at ${ext.stages[0].from_age}.` };
  for (const s of ext.stages) if (age >= s.from_age) stage = s;
  return { age, ...stage };
}
module.exports = { tailor, write, ask, check, widgets, stageOf, ageOn, rows, questionOf, RUNGS, idFor };
