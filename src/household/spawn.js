/* spawn: someone leaves the household's book and starts their own Kitty. A recipe over transfer, for what has no file behind it: their own row, the memo accounts and the rows of an x_ table
   that are theirs. The whole history goes with them. What stays behind closes against what left, with one entry per jar, so nothing is counted in two households. */
"use strict";
const { stableStringify, hash64, addDays } = require("../../standard/engine/util");
const { latest } = require("./clock");
const { init, ready, stamp, fail } = require("./init");
const { logRow, transferId, needConsent } = require("./transfer");
const { record } = require("./replay");

/* party: the party_id leaving. table: the x_ table, with its party, jar and cents columns. memo: their memo account ids. */
async function spawn(source, target, { party, table, columns = { party: "party_id", group: "jar", cents: "cents", date: "on", kind: "kind", key: "entry_id" }, memo = [], today, consent }) {
  if (!today) throw fail("no_today", "spawn needs today.");
  needConsent(consent);
  const m = await ready(source), who = latest("party", await source.tables.read("party")).find((p) => p.party_id === party);
  if (!who) throw fail("no_party", `There is no one called ${party} here.`);
  const made = await init(target, { name: who.name, people: [{ name: who.name, birth_date: who.birth_date }], today });
  const theirs = (await source.tables.read(table)).filter((r) => r[columns.party] === party), newId = made.people[0];
  const tableDef = (await source.manifest()).x_tables[table];
  await target.define(table, tableDef);
  const rows = theirs.map((r) => ({ ...r, [columns.party]: newId }));
  await record(target, table, rows, { today, strict: true });
  const accounts = latest("account", await source.tables.read("account")).filter((a) => memo.includes(a.account_id));
  await record(target, "account", accounts.map(({ closed_on, ...a }) => a), { strict: false });
  // The jars close where they were. Each entry is the balance leaving, dated today, so the book that stays adds to nothing for this person.
  const totals = new Map();
  for (const r of theirs) totals.set(r[columns.group], (totals.get(r[columns.group]) || 0) + r[columns.cents]);
  const closing = [...totals].filter(([, c]) => c).map(([jar, c]) => ({ [columns.key]: `E-${hash64(stableStringify(["moved", party, jar, today]))}`, [columns.date]: today, [columns.party]: party, [columns.group]: jar, [columns.kind]: "moved", [columns.cents]: -c, note: `Went with them to ${made.household_id}.` }));
  await record(source, table, closing, { today, strict: true });
  for (const a of accounts) await source.tables.change("account", { ...a, closed_on: today, note: `Moved to ${made.household_id} on ${today}.` });
  const id = transferId("spawn", m.household_id, made.household_id, today), s = { from: null, to: null, partial: [], left_behind: { sources: 0, lines: 0 } }, counts = { [table]: rows.length, account: accounts.length };
  const row = (role) => logRow({ id, role, recipe: "spawn", from: m.household_id, to: made.household_id, consent, today, slice: s, counts, times: [], shared: [] });
  await target.tables.appendNew("decision", [row("in")]);
  await source.tables.appendNew("decision", [row("out")]);
  return { transfer_id: id, household_id: made.household_id, party: newId, rows: rows.length, moved_cents: [...totals.values()].reduce((a, b) => a + b, 0), closed: accounts.map((a) => a.account_id) };
}
module.exports = { spawn };
