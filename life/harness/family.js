/* A family, as the harness holds it: the generated world, who holds which file at each chapter, and how a world id reads in a household that made its own.
   The world's ids are the generator's. A blank Kitty makes its own from the first file, so an id map is the harness's only knowledge of the two. Scorers read truth; verbs never do. */
"use strict";
const { build } = require("../world/build");
const K = require("../../src/household/node.js");

const CHAPTERS = [0, 1, 2, 3, 4, 5, 6];
function loadFamily({ seed = 1, variant = false } = {}) {
  const W = build({ seed, variant, write: false }), C = W.sim.cast;
  const label = variant ? `variant-${seed}` : C.id;
  const A = C.A, B = C.B, kids = W.sim.kids;
  const chapter = (n) => W.truth.chapters[n];
  const toFile = (f) => ({ path: f.path, name: f.name, bytes: f.bytes, stream: f.stream, download_date: f.delivered_on, origin: f.origin, issued_on: f.issued_on, person: f.person, world: f });
  const heldAt = (n) => W.files.filter((f) => f.held_from === n);
  const mess = (n) => { const rows = W.mess.chapters[n] || { drive: [] }, bytes = new Map(W.mess.files.map((f) => [f.path, f.bytes])); return rows.drive.map((r) => ({ ...r, name: r.path.split("/").pop(), bytes: bytes.get(r.path) })); };
  const heldStreams = new Set(W.files.filter((f) => f.held_from != null && f.held_from <= 6).map((f) => f.stream));
  return { W, C, A, B, kids, label, seed, variant, heldStreams, truth: W.truth, setup: W.setup, answers: W.answers, sim: W.sim, chapter, heldAt, toFile, mess, trap: (id) => W.truth.traps[id] || [] };
}
/* Which store this is a person's. A world row is about one person when it names something only they hold. */
function foreignIds(F, who) {
  const other = who === F.A.id ? F.B.id : F.A.id, Other = other.toUpperCase(), ids = new Set([Other]);
  const own = F.setup.ownership.filter((o) => o.subject_type === "account" && o.basis === "legal");
  for (const a of new Set(own.map((o) => o.subject_id))) { const rows = own.filter((o) => o.subject_id === a); if (rows.every((o) => o.party_id === Other)) ids.add(a); }
  for (const c of F.setup.contract) { if (c.holder_party_id === Other) { ids.add(c.contract_id); if (c.counterparty_party_id && c.kind === "employment") ids.add(c.counterparty_party_id); } }
  for (const s of F.setup.stream) if (ids.has(s.subject_id)) ids.add(s.stream_id);
  return ids;
}
const mentions = (row, ids) => Object.values(row).some((v) => typeof v === "string" && ids.has(v));
function rewrite(row, map) {
  const out = {};
  for (const [k, v] of Object.entries(row)) out[k] = typeof v === "string" && map.has(v) ? map.get(v) : v;
  return out;
}
module.exports = { loadFamily, foreignIds, mentions, rewrite, CHAPTERS, K };
