/* The life, in order, through the same verbs a page and an agent use. Each chapter leaves a record: what a person read, what they were asked, what the ledger says. Scoring is elsewhere. */
"use strict";
const { K } = require("./family");
const H = require("./household");
const { drive } = require("./drive");
const { actor, writeRecipes } = require("./actor");
const { addDays } = require("../../standard/engine/util");

const first = (name) => name.split(" ")[0];
const slug = (s) => String(s).trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");
function person(F, hh, p, hid) {
  hh.ids.set(p.id.toUpperCase(), slug(p.name));
  hh.ids.set(`H-${F.C.id.toUpperCase()}`, hid);
}
function open(run, tag, who) { return H.household(run.kind, tag, run.F, who); }
async function record(run, n, hh, { step, stuck, extra } = {}) {
  const { F } = run, today = F.chapter(n).today, built = await K.rebuildAt(hh.store, { today });
  const st = await K.status(hh.store, { today, built }), nx = await K.next(hh.store, { today, built });
  run.book[n] = { n, today, hh, built, status: st, next: nx, stuck: stuck || null, questions: run.asked(n), ...extra };
  return run.book[n];
}
const drop = async (hh, files, today, opts) => { hh.files = [...(hh.files || []), ...files]; return H.addFiles(hh, files, today, opts); };

/* One sitting with `next`: answer it, then close every month that is ready in one go, and carry on until it has nothing a person can do. */
async function sitting(hh, F, today, limit) {
  const stop = (s) => s.id === "other_side" || s.id === "close" || s.id === "lock";
  for (let i = 0; ; i += 1) {
    const d = await drive(hh, actor(F), { today, limit, until: stop });
    if (d.step.id !== "close" && d.step.id !== "lock") return d;
    if (i > 3) return { ...d, stuck: "still closing" };
    const months = (await K.status(hh.store, { today, built: d.built })).readiness.months.filter((m) => m.state === "ready" || (m.state === "closed" && m.can_lock)).map((m) => m.month);
    hh.transcript.push({ day: today, id: "close_all", say: `Close ${months.length} months.` });
    await K.close(hh.store, months, { today });
  }
}
const chapters = {
  async 0(run) {
    const { F } = run, today = F.chapter(0).today, hh = (run.A = open(run, "a", F.A.id)), s = hh.store;
    H.shown(hh, await K.next(s, { today }), today);
    const made = await K.init(s, { name: first(F.A.name), people: [{ name: F.A.name, birth_date: F.A.born }], today });
    person(F, hh, F.A, made.household_id); hh.clicks += 1;
    H.shown(hh, await K.next(s, { today }), today);
    const files = F.heldAt(0).map(F.toFile), bare = files.map((f) => ({ ...f, stream: undefined }));
    let dropped = await drop(hh, bare, today), named = null;
    hh.clicks += 1;
    const asked = await K.next(s, { today }); H.shown(hh, asked, today);
    // A public recipe can read a file that does not say whose it is. The person names it, once.
    if (dropped.needs_account.length) { H.ask(hh, today, asked.say); named = "Everyday"; dropped = await H.addFiles(hh, bare, today, { account: named }); hh.clicks += 1; }
    let recipe = null, refused = null, account = null;
    if (dropped.needs_recipe.length) {
      const need = dropped.needs_recipe[0], spec = F.answers.find((r) => r.fingerprints.includes(need.fingerprint));
      refused = await K.addRecipe(s, spec, { today, author: "agent" });
      if (refused.status === "needs_account") { H.ask(hh, today, refused.ask); named = "Everyday"; }
      recipe = await K.addRecipe(s, spec, { today, author: "agent", account: named || undefined });
      hh.clicks += 1;
      account = recipe.read && recipe.read.accounts_created[0];
    } else if (dropped.refused.length) {
      recipe = await writeRecipes(F, hh, today, named || undefined); hh.clicks += 1;
      account = recipe && recipe.read.accounts_created[0];
    } else account = dropped.accounts_created[0];
    if (account) { hh.ids.set("ACC-A-EVERY", account.account_id); hh.ids.set("EVERY-A", account.account_id); hh.made.add(account.account_id); }
    return record(run, 0, hh, { extra: { dropped, recipe, refused, clicks: hh.clicks } });
  },
  async 1(run) {
    const { F, A: hh } = run, today = F.chapter(1).today, d = await drive(hh, actor(F), { today, until: (s) => ["close", "other_side", "stale"].includes(s.id) });
    return record(run, 1, hh, { stuck: d.stuck, extra: { stopped_at: d.step } });
  },
  async 2(run) {
    const { F, A: hh } = run, today = F.chapter(2).today;
    await H.tell(hh, today);
    // The Drive first, as it is: half there, one file twice, a scan, a statement in the car folder. A copy carries the day it was saved.
    const whenSaved = (m) => { const of = m.of && F.W.files.find((f) => f.path === m.of); return of ? of.delivered_on : today; };
    const mess = F.mess(2), fromDrive = await K.add(hh.store, mess.map((m) => ({ path: m.path, name: m.name, bytes: m.bytes, download_date: whenSaved(m) })), { today });
    const portal = F.heldAt(2).map(F.toFile), pool = [...portal];
    const shown = await K.status(hh.store, { today });
    await drive(hh, actor(F, { pool }), { today, until: (s) => s.id === "missing_month" });
    const gap = await K.next(hh.store, { today });
    const portalAdded = await drop(hh, pool.splice(0), today);
    const d = await drive(hh, actor(F, { pool }), { today, limit: 160, until: (s) => s.id === "other_side" });
    return record(run, 2, hh, { stuck: d.stuck, extra: { fromDrive, portalAdded, gap, drive_status: shown, stopped_at: d.step } });
  },
  async 3(run) {
    const { F, A } = run, today = F.chapter(3).today, solo = F.trap("T3-PRIVATE-HISTORY")[0], names = F.trap("T3-TWO-NAMES-ONE-ACCOUNT")[0];
    // Danny starts his own, and he calls the joint account something else, under an id of his own.
    const B = (run.B = open(run, "b", F.B.id)), made = await K.init(B.store, { name: first(F.B.name), people: [{ name: F.B.name, birth_date: F.B.born }], today });
    person(F, B, F.B, made.household_id); B.clicks += 1;
    B.ids.set("ACC-JOINT", "ACC-HOUSEHOLD"); B.ids.set("JOINT", "JOINT-HOUSEHOLD");
    for (const [hh, called] of [[A, names[F.A.id]], [B, names[F.B.id]]]) {
      await H.tell(hh, today);
      const id = hh.ids.get("ACC-JOINT") || "ACC-JOINT", row = (await hh.store.tables.read("account")).find((a) => a.account_id === id);
      if (row) await hh.store.tables.change("account", { ...row, name: called });
    }
    const files = F.heldAt(3).map(F.toFile), mine = (who) => files.filter((f) => f.person === who.id);
    const added = { a: await drop(A, mine(F.A), today), b: await drop(B, mine(F.B), today) };
    const stop = (s) => s.id === "other_side";
    const d = { a: await drive(A, actor(F), { today, limit: 80, until: stop }), b: await drive(B, actor(F), { today, limit: 80, until: stop }) };
    const before = { a: await K.rebuildAt(A.store, { today }), b: await K.rebuildAt(B.store, { today }) };
    // Joining day. What would happen is shown first, then both say yes.
    const J = (run.J = open(run, "joint", null)), people = [{ store: A.store, by: F.A.name, name: F.A.name, birth_date: F.A.born }, { store: B.store, by: F.B.name, name: F.B.name, birth_date: F.B.born }];
    const name = `${F.C.surname || F.A.name.split(" ").pop()} household`, plan = await K.merge(J.store, { people, joined_on: solo.joined_on, today, name, dry_run: true });
    const whatIf = await K.merge(J.store, { people, joined_on: solo.joined_on, today, name, dry_run: true, share: { [F.A.name]: monthBefore(solo.joined_on), [F.B.name]: monthBefore(solo.joined_on) } });
    const joined = await K.merge(J.store, { people, joined_on: solo.joined_on, today, name, consent: people.map((p) => ({ by: p.by, words: "Yes, from the first of the month." })) });
    for (const q of joined.questions) H.ask(J, today, q.say, q.who || "both");
    for (const [k, v] of [...A.ids, ...B.ids]) J.ids.set(k, joined.map[v] || v);
    J.ids.set(`H-${F.C.id.toUpperCase()}`, joined.household_id);
    J.told = new Set([...A.told, ...B.told]); J.made = new Set([...A.made, ...B.made, ...joined.joint.map((j) => j.to)]);
    J.files = [...(A.files || []), ...(B.files || [])];
    await H.tell(J, today, { foreign: new Set() });
    const dj = await drive(J, actor(F), { today, limit: 60, until: stop });
    return record(run, 3, J, { stuck: dj.stuck, extra: { added, d, solo: before, joined, plan, whatIf, stopped_at: dj.step } });
  },
  async 4(run) {
    const { F, J, A, B } = run, today = F.chapter(4).today, checklist = "2027-08-02", files = F.heldAt(4).map(F.toFile);
    const stop = (s) => s.id === "other_side";
    // March to June come in as they arrive, and the months lock.
    const early = files.filter((f) => f.download_date <= checklist), late = files.filter((f) => f.download_date > checklist);
    await H.tell(J, checklist, { foreign: new Set() });
    const addedEarly = await drop(J, early, checklist);
    const d0 = await drive(J, actor(F), { today: checklist, limit: 80, until: (s) => stop(s) || s.id === "stale" });
    for (const m of (await K.status(J.store, { today: checklist })).readiness.months.filter((x) => x.state === "ready")) await K.close(J.store, m.month, { today: checklist });
    const lockedFirst = (await K.status(J.store, { today: checklist })).readiness.months_locked;
    // The accountant asks for the whole year, for both of them, so each shares what they had kept to themselves.
    const to = J.joinedFrom ? J.joinedFrom : null, cut = addDays(run.book[3].joined.from, -1);
    const sharedA = await K.shareHistory(J.store, A.store, { to: cut, today: checklist, by: F.A.name, consent: { by: F.A.name, words: "Yes, for the tax." } });
    const sharedB = await K.shareHistory(J.store, B.store, { to: cut, today: checklist, by: F.B.name, consent: { by: F.B.name, words: "Yes, for the tax." } });
    H.ask(J, checklist, "Share what you kept to yourself, for the tax?", F.A.name); H.ask(J, checklist, "Share what you kept to yourself, for the tax?", F.B.name);
    const proposals = await K.proposals(J.store, { today: checklist });
    if (proposals.length) {
      H.ask(J, checklist, `${proposals.length} locked months change now both histories are in one place. Reopen them?`, "both");
      for (const p of proposals) await K.decide(J.store, { reopen: p.period, reason: "Both histories are in one Kitty now." }, { today: checklist });
    }
    const after = await drive(J, actor(F), { today: checklist, limit: 80, until: stop });
    await H.tell(J, today, { foreign: new Set() });
    const addedLate = await drop(J, late, today);
    const d = await sitting(J, F, today, 120);
    return record(run, 4, J, { stuck: d.stuck, extra: { addedEarly, addedLate, sharedA, sharedB, proposals, lockedFirst, d0, after, stopped_at: d.step } });
  },
  async 5(run) {
    const { F, J } = run, today = F.chapter(5).today, stop = (s) => s.id === "other_side";
    await H.tell(J, today, { foreign: new Set() });
    const added = await drop(J, F.heldAt(5).map(F.toFile), today);
    const d = await sitting(J, F, today, 160);
    return record(run, 5, J, { stuck: d.stuck, extra: { added, stopped_at: d.step } });
  },
  async 6(run) {
    const { F, J } = run, today = F.chapter(6).today, stop = (s) => s.id === "other_side";
    await H.tell(J, today, { foreign: new Set() });
    const added = await drop(J, F.heldAt(6).map(F.toFile), today);
    const d = await sitting(J, F, today, 200);
    // At the kitchen table. Her agent builds what she said, on the store, and the ledger does not move.
    const P = require("./pocket"), told = await P.build(J, F, today), base = K.base(), month = F.sim.end, later = month;
    const atToday = await K.ask(J.store, { from: P.TABLE, date: "day", group: ["child", "jar"], sum: "amount" }, { as_of: today });
    const lived = await P.run(J, F, { deal: told.deal, from: addDays(today, 1), until: later });
    const after = await K.rebuildAt(J.store, { today });
    const memoIds = new Set(told.memo), L = after.L, ledgerMemo = L.postings.filter((p) => memoIds.has(p.account_id)).reduce((n, p) => n + Math.abs(p.amount_cents), 0) + told.memo.reduce((n, id) => n + Math.abs(L.balances.at(id, L.balances.months[L.balances.months.length - 1])), 0);
    const checks = await K.checkTailoring(J.store), widgets = await K.widgets(J.store, { today: later });
    // The project promotes it. The family takes the update, dry run first.
    await H.addFiles(J, F.W.files.filter((f) => f.held_from == null && f.delivered_on <= later && F.heldStreams.has(f.stream)).map(F.toFile), later);
    await drive(J, actor(F), { today: later, limit: 40, until: (x) => ["close", "lock", "other_side", "stale"].includes(x.id) }); // the new months stay open, so a release has somewhere to land
    const release = base.releases["2036-04-pocket-money"], dry = await K.planUpdate(J.store, release, { today: later, migrate: [P.MIGRATION] });
    const taken = await K.update(J.store, release, { today: later, migrate: [P.MIGRATION], by: F.A.name, plan: dry });
    H.ask(J, later, "Take the update? Nothing you entered changes.", F.A.name);
    // Salt turns 18. The piggy history goes with him.
    const eighteen = addDays(F.kids[0].born, 0).replace(/^\d{4}/, String(Number(F.kids[0].born.slice(0, 4)) + 18)), carried = await K.ask(J.store, { from: "x_jars", date: "on", group: ["party_id", "jar"], sum: "cents" }, { as_of: later });
    const salt = F.kids[0].id.toUpperCase(), own = open(run, "salt", F.kids[0].id), memoOwn = told.memo.filter((m) => m.startsWith(`MEMO-${salt}-`));
    const spawned = await K.spawn(J.store, own.store, { party: salt, table: "x_jars", memo: memoOwn, today: eighteen, consent: { by: F.kids[0].first, words: "Yes, it's mine." } });
    const heldAfter = await K.ask(own.store, { from: "x_jars", date: "on", group: ["party_id", "jar"], sum: "cents" }, {}), leftBehind = await K.ask(J.store, { from: "x_jars", date: "on", group: ["party_id", "jar"], sum: "cents" }, {});
    const pocket = { bundle_same: told.before.L.bundleHash === L.bundleHash, ledger_memo_cents: ledgerMemo, at_today: atToday, checks, widgets, example_ok: checks.every((c) => c.status === "pass") && JSON.stringify(sortDeep(lived.expected)) === JSON.stringify(sortDeep(lived.result)), expected: lived.expected, result: lived.result, deal: told.deal, memo: told.memo, dry, taken, carried, spawned, heldAfter, leftBehind, own, salt, sentence: P.SENTENCE };
    return record(run, 6, J, { stuck: d.stuck, extra: { added, stopped_at: d.step, pocket } });
  },
};
/* The base of chapter 8. Everything moves to the other kind of store, and the two rebuild to one household. */
async function moveProof(run) {
  const { F, J } = run, today = F.chapter(8).today, other2 = H.makeStore(J.kind === "fake" ? "folder" : "fake", "moved");
  const beforeSource = await J.store.tables.read("source"), beforeObs = await J.store.tables.read("observation"), jars = await J.store.tables.read("x_jars");
  const moved = await K.move(J.store, other2, { today, consent: { by: F.A.name, words: "Yes, all of it." } });
  const said = (await K.next(J.store, { today })).id;
  let refused = null;
  try { await K.add(J.store, [{ name: "late.csv", bytes: new TextEncoder().encode("a,b\n") }], { today }); } catch (e) { refused = e.code; }
  const ids = (rows) => [...new Set(rows.map((r) => r.obs_id || r.source_id || r.entry_id))].sort(), same = async (t, was) => JSON.stringify(ids(await other2.tables.read(t))) === JSON.stringify(ids(was));
  const clear = (await K.rebuildAt(other2, { today })).L.checks.filter((c) => c.law === "L12" && c.status === "fail").length;
  return { from: J.kind, to: other2.kind, hash: moved.hash, audit_ok: moved.audit.ok, sources_same: await same("source", beforeSource), observations_same: await same("observation", beforeObs), jars_same: await same("x_jars", jars), next: said, refused, l12_fails: clear };
}
const sortDeep = (o) => (o && typeof o === "object" ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, sortDeep(o[k])])) : o);
const monthBefore = (d) => { const y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7)); return m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, "0")}-01`; };
module.exports = { chapters, record, open, person, drop, moveProof };
