/* Chapter 6's kitchen table. Daisy says a sentence. Her agent builds it at the lowest rung that works, on the store, and everything it makes is what any agent could make through the
   verbs: terms for the deal, memo accounts, one x_ table for what actually happens, a saved question, a widget. Nothing here is in the base until the project promotes it. */
"use strict";
const { K } = require("./family");
const { allocate, addDays, monthEnd, hash64, stableStringify } = require("../../standard/engine/util");

const SENTENCE = "I want the kids to have pocket money, three jars, spend, save, give, with chores, and we pay interest on the save jar";
const JARS = { spend: 5000, save: 3000, give: 2000 }, SAVE_RATE_PCT = 6;
const TABLE = "x_pocket", COLUMNS = ["line:id:pk", "day:date:req", "child:id:req", "jar:text:req", "what:text:req", "amount:cents:req", "note:text"];
const weekday = (d) => new Date(`${d}T00:00:00Z`).getUTCDay();
const nextSaturday = (d) => { let x = addDays(d, 1); while (weekday(x) !== 6) x = addDays(x, 1); return x; };
const split = (cents) => allocate(cents, Object.entries(JARS).map(([key, weight]) => ({ key, weight })));

/* What each child's deal says. The script speaks for the eldest. A younger child's figure is the family's own, and invented. */
function dealFor(F, today) {
  const ext = K.SHARED_EXTENSIONS["pocket-money"], said = Object.values(F.truth.memo)[0], out = [];
  F.kids.forEach((k, i) => {
    const stage = K.stageOf(ext, k.born, today);
    out.push({ id: k.id.toUpperCase(), name: k.first, born: k.born, stage, weekly: i ? 300 : said.weekly_cents, chore: said.chore_cents, every: said.chore_every_weeks });
  });
  return out;
}
const lineId = (...parts) => `P-${hash64(stableStringify(parts))}`;
/* Rows from one Saturday to another, and interest at each month end. The agent's own small program, and it could as well be a person with a pencil. */
function entries(deal, from, until, balances = new Map(), { table = "family" } = {}) {
  const rows = [], put = (day, child, jar, what, amount) => { if (!amount) return; rows.push({ line: lineId(day, child, jar, what), day, child, jar, what, amount }); const k = `${child}|${jar}`; balances.set(k, (balances.get(k) || 0) + amount); };
  const kids = deal.filter((d) => d.stage.stage === "jars");
  let week = 0;
  for (let d = nextSaturday(addDays(from, -1)); d <= until; d = addDays(d, 7), week += 1) {
    for (const k of kids) {
      for (const s of split(k.weekly)) put(d, k.id, s.key, "allowance", s.cents);
      if (week % k.every === 1) for (const s of split(k.chore)) put(d, k.id, s.key, "chore", s.cents);
    }
    // Month end falls in the week ahead: the bank of mum and dad pays on the save jar's balance that day.
    const end = monthEnd(d.slice(0, 7));
    if (end > d && addDays(d, 7) > end) for (const k of kids) { const bal = balances.get(`${k.id}|save`) || 0; put(end <= until ? end : d, k.id, "save", "interest", Math.round((bal * SAVE_RATE_PCT) / 1200)); }
  }
  return { rows, balances };
}
const jarsOf = (balances) => { const out = {}; for (const [k, c] of balances) { const [child, jar] = k.split("|"); (out[child] = out[child] || {})[jar] = c; } return out; };

async function build(hh, F, today) {
  const { store } = hh, before = await K.rebuildAt(store, { today }), deal = dealFor(F, today), kids = deal.filter((d) => d.stage.stage === "jars");
  await K.tailor(store, { rung: "x_table", name: TABLE, sentence: SENTENCE, definition: { columns: COLUMNS, why: "A running balance needs rows, and nothing here has a file. A term holds the deal, not what happened." } }, { today });
  // The deal: terms on each child, x_ named, valid from today.
  const terms = kids.flatMap((k) => [["x_pocket_weekly_cents", k.weekly, "cents"], ["x_pocket_chore_cents", k.chore, "cents"], ["x_jar_split_bps", Object.values(JARS).join("/"), "bps"], ["x_save_jar_rate_pct", SAVE_RATE_PCT, "pct"]].map(([term, value, unit], i) => ({ term_id: `TERM-${k.id}-${i}`, subject_type: "party", subject_id: k.id, term, value: String(value), unit, valid_from: today })));
  await K.record(store, "term", terms, { today, strict: false });
  await K.tailor(store, { rung: "x_term", name: "pocket_money_deal", sentence: SENTENCE, definition: { terms: terms.map((t) => t.term).filter((x, i, a) => a.indexOf(x) === i), bands: deal.map((d) => ({ child: d.id, age: d.stage.age, stage: d.stage.stage })) } }, { today });
  // Three memo accounts each. They never take a posting, so they can never reach net worth or anyone's income.
  const memo = kids.flatMap((k) => Object.keys(JARS).map((jar) => ({ account_id: `MEMO-${k.id}-${jar.toUpperCase()}`, name: `${k.name}'s ${jar} jar`, class: "memo", type: "memo", reporting_group: "memo", currency: "AUD", in_scope: false, note: "Family money in a book. Not a bank account." })));
  await K.record(store, "account", memo, { strict: false });
  await K.tailor(store, { rung: "saved_question", name: "pocket_money_jars", sentence: SENTENCE, definition: { from: TABLE, date: "day", group: ["child", "jar"], sum: "amount" } }, { today });
  await K.tailor(store, { rung: "widget", name: "pocket_money_home", sentence: SENTENCE, definition: { widget: "figures", place: "home", title: "Pocket money", question: "pocket_money_jars" } }, { today });
  return { deal, kids, memo: memo.map((m) => m.account_id), before };
}
/* Time passes on the kitchen table, then the example is written down from what happened, in the row the sentence is in. */
async function run(hh, F, { deal, from, until }) {
  const { rows, balances } = entries(deal, from, until);
  await K.writeOwn(hh.store, TABLE, rows, { today: until });
  const result = await K.ask(hh.store, { from: TABLE, date: "day", group: ["child", "jar"], sum: "amount" }, { as_of: until });
  await K.tailor(hh.store, { rung: "saved_question", name: "pocket_money_jars", sentence: SENTENCE, definition: { from: TABLE, date: "day", group: ["child", "jar"], sum: "amount" }, example: { as_of: until, result } }, { today: until });
  await K.tailor(hh.store, { rung: "widget", name: "pocket_money_home", sentence: SENTENCE, definition: { widget: "figures", place: "home", title: "Pocket money", question: "pocket_money_jars" }, example: { as_of: until, result } }, { today: until });
  return { rows, balances, result, expected: jarsOf(balances) };
}
const MIGRATION = { from: TABLE, to: "pocket-money", sum: { from: "amount", to: "cents" }, map: { entry_id: "line", on: "day", party_id: "child", jar: "jar", kind: "what", cents: "amount", note: "note" }, retire: [TABLE, "pocket_money_jars", "pocket_money_home"], question: "pocket_money_jars" };

module.exports = { SENTENCE, JARS, TABLE, build, run, entries, dealFor, jarsOf, MIGRATION };
