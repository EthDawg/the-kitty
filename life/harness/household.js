/* One household in a run: its store, its ids, what it has been told, and a transcript of what a person was shown and asked. */
"use strict";
const { K, foreignIds, mentions, rewrite } = require("./family");
const { TABLES } = require("../world/lib/setup");

const NEVER_TOLD = new Set(["household", "category", "period"]); // the first is init's, the others are shared data and the close's
const cutOf = (today) => `${today}T23:59:59Z`;

function makeStore(kind, tag) {
  if (kind === "fake") return K.fakeStore();
  if (kind === "folder") return K.folderStore({ dir: `/kitty/${tag}`, fs: K.memfs() });
  throw new Error(`no such store: ${kind}`);
}
function household(kind, tag, F, who) {
  const store = makeStore(kind, tag);
  return { store, kind, tag, F, who, ids: new Map(), told: new Set(), made: new Set(), transcript: [], questions: [], clicks: 0, moved: false };
}
const ask = (hh, day, what, by = "person") => { hh.questions.push({ day, what, by }); };
const shown = (hh, step, day) => { hh.transcript.push({ day, id: step.id, say: step.say }); };
/* What a person tells a Kitty by this date, in this household's ids. A row naming only the other person belongs in their Kitty. */
async function tell(hh, today, { foreign } = {}) {
  const { F, store } = hh, skip = foreign || (hh.who ? foreignIds(F, hh.who) : null), written = {};
  for (const table of TABLES) {
    if (NEVER_TOLD.has(table)) continue;
    const rows = [];
    for (const [i, row] of F.setup[table].entries()) {
      const key = `${table}:${i}`;
      if (hh.told.has(key) || (row.recorded_at || "") > cutOf(today) || (skip && mentions(row, skip))) continue;
      if (hh.who && table === "ownership" && row.subject_type === "account" && row.share_bps < 10000) continue; // a share is something two people agree, so it is told in the joint Kitty
      hh.told.add(key); rows.push(rewrite(row, hh.ids));
    }
    if (!rows.length) continue;
    const have = table === "party" || table === "account" || table === "stream" ? new Set((await store.tables.read(table)).map((r) => r[`${table}_id`])) : null;
    const fresh = [];
    for (const r of rows) {
      const id = have && r[`${table}_id`];
      if (id && have.has(id)) {
        // An account made from a file gets its real name now. Nothing else moves.
        if (table !== "party") await store.tables.change(table, r);
        continue;
      }
      if (hh.made.has(r.subject_id) && table === "ownership") continue; // the account was made from a file, with its owners
      if (table === "membership" && (await store.tables.read("membership")).some((m) => m.party_id === r.party_id)) continue;
      fresh.push(r);
    }
    if (fresh.length) written[table] = await K.record(store, table, fresh, { strict: false });
  }
  return written;
}
const addFiles = (hh, files, today, opts = {}) => K.add(hh.store, files.map((f) => ({ path: f.path, name: f.name, bytes: f.bytes, stream: f.stream ? hh.ids.get(f.stream) || f.stream : undefined, download_date: f.download_date, origin: f.origin, issued_on: f.issued_on })), { today, ...opts });
module.exports = { household, tell, addFiles, ask, shown, makeStore };
