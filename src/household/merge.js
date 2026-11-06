/* merge: two Kitties become one. A slice from each, plus an identity map: the same account under two names is one account, by its number, and old ids stay as aliases.
   Rules and decisions rebind to the new ids, so nothing goes back to review. Each person's history before joining stays in their own Kitty unless they share it.
   What crosses for an account they bring is its position on the day: a balance, not the lines behind it. A locked month a slice lands in stays locked and raises a reopen proposal.
   The target is a new Kitty, because a sheet two people can open has no private rows. Nothing here writes until consent is in hand; dry_run plays the whole merge on a scratch store. */
"use strict";
const { monthOf, addDays, hash64, stableStringify, allocate } = require("../../standard/engine/util");
const { loadOriginals, latest, dayOf, rebuildAt } = require("./clock");
const { ready, init, stamp, fail, SINCE } = require("./init");
const { folderStore } = require("./store/folder");
const { memfs } = require("./store/memfs");
const { slice, adopt, audit, homes, proposals, logRow, transferId, needConsent, replaceIn } = require("./transfer");
const { money, day, dayYear, monthYear, list, plural } = require("./words");

const NUMBERED = new Set(["account_number", "loan_number", "member_number"]);
const norm = (s) => String(s == null ? "" : s).toUpperCase().replace(/[\s\-_.]/g, "");
const isNumber = (v) => String(v).replace(/[^0-9]/g, "").length >= 6;
const CARRIED = new Set(["transaction", "offset", "savings", "credit_card", "loan", "super", "help_debt"]);

function numbers(o) {
  const out = new Map();
  for (const a of o.alias) if (a.subject_type === "account" && NUMBERED.has(a.scheme) && isNumber(a.value)) out.set(norm(a.value), a.subject_id);
  return out;
}
/* Who is who. The first Kitty's ids stand. The second's are mapped onto them where they name the same thing, and moved out of the way where the same id means something else. */
function identity(first, second) {
  const map = new Map(), joint = [], clash = [];
  const firstNumbers = numbers(first), accounts = latest("account", first.account), secondAccounts = latest("account", second.account);
  const firstIds = new Set(accounts.map((a) => a.account_id));
  for (const [n, id] of numbers(second)) if (firstNumbers.has(n)) { const to = firstNumbers.get(n); if (id !== to) map.set(id, to); joint.push({ number: n, from: id, to }); }
  const joined = new Set(joint.map((j) => j.from));
  for (const a of secondAccounts) if (firstIds.has(a.account_id) && !joined.has(a.account_id)) map.set(a.account_id, `${a.account_id}-2`);
  const streams = latest("stream", first.stream), byAccount = new Map(streams.filter((s) => s.subject_type === "account").map((s) => [s.subject_id, s]));
  const firstStreams = new Set(streams.map((s) => s.stream_id));
  for (const s of latest("stream", second.stream)) {
    if (s.subject_type !== "account") { if (firstStreams.has(s.stream_id)) map.set(s.stream_id, `${s.stream_id}-2`); continue; }
    const to = map.get(s.subject_id) || s.subject_id, theirs = byAccount.get(to);
    if (theirs && joined.has(s.subject_id)) { if (theirs.stream_id !== s.stream_id) map.set(s.stream_id, theirs.stream_id); } else if (firstStreams.has(s.stream_id)) map.set(s.stream_id, `${s.stream_id}-2`);
  }
  const people = new Map(latest("party", first.party).map((p) => [norm(p.name), p.party_id]));
  for (const p of latest("party", second.party)) { const to = people.get(norm(p.name)); if (to && to !== p.party_id) map.set(p.party_id, to); }
  // A word used as an account's name in both, for two different accounts, would read as one. Lines carry it, and lines are not rewritten.
  const words = new Map(first.alias.filter((a) => a.subject_type === "account" && !isNumber(a.value)).map((a) => [norm(a.value), a.subject_id]));
  for (const a of second.alias) if (a.subject_type === "account" && !isNumber(a.value) && words.has(norm(a.value)) && (map.get(a.subject_id) || a.subject_id) !== words.get(norm(a.value))) clash.push(a.value);
  return { map, joint, clash: [...new Set(clash)] };
}
const nameOf = (o, id) => (latest("account", o.account).find((a) => a.account_id === id) || {}).name || id;
function conflicts(first, second, map) {
  const out = { rules: [], decisions: [] }, patterns = new Map(first.rule.map((r) => [`${r.pattern}|${r.match}|${r.account_id || ""}`, r]));
  for (const r of second.rule) { const k = `${r.pattern}|${r.match}|${map.get(r.account_id) || r.account_id || ""}`, a = patterns.get(k); if (a && a.category_id !== r.category_id) out.rules.push({ pattern: r.pattern, first: a.category_id, second: r.category_id }); }
  const told = new Map(first.decision.filter((d) => d.target_type === "line" && d.verb === "categorise").map((d) => [d.target_ref, d]));
  for (const d of second.decision.filter((x) => x.target_type === "line" && x.verb === "categorise")) {
    const [a, ...rest] = d.target_ref.split("|"), ref = [map.get(a) || a, ...rest].join("|"), other = told.get(ref);
    if (other && (other.value || {}).category_id !== (d.value || {}).category_id) out.decisions.push({ ref, first: other.value.category_id, second: d.value.category_id });
  }
  return out;
}
/* What a person is asked on joining day. Each question has a default, so a yes to the lot is one sitting. */
function questionsFor({ who, joint, o, clash, disagree, from }) {
  const qs = who.map((p) => ({ id: `consent:${p.by}`, who: p.by, say: `Join your Kitty with ${who.find((x) => x !== p).by}'s from ${dayYear(from)}? What happened before that stays in your own Kitty.`, default: "yes" }));
  for (const j of joint) {
    const a = nameOf(o[0], j.to), b = nameOf(o[1], j.from);
    if (norm(a) !== norm(b)) qs.push({ id: `name:${j.to}`, say: `One account, two names: ${a} and ${b}. Which do you want?`, default: a });
    qs.push({ id: `shares:${j.to}`, say: `Is ${a} yours in equal shares?`, default: "yes" });
  }
  for (const c of disagree.rules) qs.push({ id: `rule:${c.pattern}`, say: `You two file ${c.pattern} differently: ${c.first} and ${c.second}. Which stands?`, default: c.first });
  for (const c of disagree.decisions) qs.push({ id: `line:${c.ref}`, say: `You two filed the line ${c.ref} differently: ${c.first} and ${c.second}. Which stands?`, default: c.first });
  for (const w of clash) qs.push({ id: `clash:${w}`, say: `You both call a different account ${w}. Lines say only that name, so one has to be renamed and its file added again.`, default: null, blocks: true });
  return qs;
}
const position = (L, id, month) => L.balances.at(id, month);
async function apply(target, { people, parts, o, ident, from, joined_on, name, today, answers, consent, share = {} }) {
  const { map, joint } = ident, hhId = (await init(target, { name, people: people.map((p, i) => ({ name: p.name, birth_date: p.birth_date, since: i ? joined_on : undefined })), today })).household_id;
  const report = { household_id: hhId, positions: [], not_carried: [], counts: [], audit: [] };
  const jointIds = new Map(joint.map((j) => [j.from, j.to])), jointTo = new Set(joint.map((j) => j.to));
  for (let i = 0; i < parts.length; i += 1) {
    const s = parts[i], own = i ? map : null, built = await rebuildAt(people[i].store, { today });
    // Each account they bring opens on the day with what it held. The lines behind that number stay home.
    const openAt = addDays(s.from, -1), months = new Map();
    s.tables.account = latest("account", s.tables.account).map((a) => {
      const to = (own && own.get(a.account_id)) || a.account_id, seen = jointTo.has(to);
      if (seen) return { ...a, name: answers[`name:${to}`] || a.name };
      if (!["asset", "liability"].includes(a.class) || a.type === "property") return a;
      const held = position(built.L, a.account_id, monthOf(openAt));
      if (!CARRIED.has(a.type)) { if (held) report.not_carried.push(a.name); return a; }
      if (!held) return a;
      report.positions.push({ account_id: to, name: a.name, cents: held });
      return { ...a, opening_balance_cents: held, opening_date: s.from };
    });
    s.tables.stream = latest("stream", s.tables.stream).map((x) => (x.valid_from < s.from ? { ...x, valid_from: s.from } : x));
    s.tables.ownership = s.tables.ownership.filter((r) => !(r.subject_type === "account" && jointTo.has(own ? own.get(r.subject_id) || r.subject_id : r.subject_id)));
    s.tables.alias = s.tables.alias.filter((r) => !(r.subject_type === "account" && NUMBERED.has(r.scheme) && isNumber(r.value) && i && jointIds.has(r.subject_id)));
    if (i) {
      const firstRules = new Set(o[0].rule.map((r) => `${r.pattern}|${r.match}|${r.account_id || ""}`));
      s.tables.rule = s.tables.rule.filter((r) => !firstRules.has(`${r.pattern}|${r.match}|${map.get(r.account_id) || r.account_id || ""}`));
    }
    s.read = (sha) => people[i].store.blobs.get(sha);
    const { counts, times } = await adopt(target, s, { today, map: own, partialNote: `Part of this file came across at joining, on ${today}. The file stayed in ${s.household_id}, because it holds lines from before.` });
    report.counts.push({ by: people[i].by, ...counts });
    report.audit.push(await audit(s, target));
    const id = transferId("merge", s.household_id, hhId, today);
    const row = (role) => logRow({ id, role, recipe: "merge", from: s.household_id, to: hhId, consent: consent[i], today, slice: s, counts, times: role === "in" ? times : [], shared: s.tables.source.map((x) => x.source_id), map: own });
    await target.tables.appendNew("decision", [row("in")]);
    await people[i].store.tables.appendNew("decision", [row("out")]);
  }
  // One account, owned by both. Equal until someone says otherwise, and the second name stays as an alias, with the old id.
  const adults = (await target.tables.read("membership")).filter((m) => m.role === "adult").map((m) => m.party_id).sort(), rows = [], aliases = [];
  for (const j of joint) {
    const shares = allocate(10000, adults.map((p) => ({ key: p, weight: 1 })));
    for (const basis of ["legal", "beneficial", "tax"]) for (const x of shares) rows.push({ subject_type: "account", subject_id: j.to, party_id: x.key, basis, share_bps: x.cents, valid_from: SINCE, recorded_at: stamp(today), note: "Both said so at joining." });
    if (j.from !== j.to) aliases.push({ subject_type: "account", subject_id: j.to, scheme: "owner_ref", value: j.from, valid_from: SINCE, recorded_at: stamp(today) });
    for (const n of [nameOf(o[0], j.to), nameOf(o[1], j.from)]) aliases.push({ subject_type: "account", subject_id: j.to, scheme: "name", value: n, valid_from: SINCE, recorded_at: stamp(today) });
  }
  await target.tables.appendNew("ownership", rows);
  await target.tables.adopt("alias", aliases);
  await target.tables.countOriginals(await loadOriginals(target));
  return report;
}
/* people: [{ store, by, name, birth_date }, two of them]. consent: per person, { by, words }. joined_on: the day they joined. answers: by question id; a question left out takes its default.
   share: { [by]: from } shares that person's history back to a date. The default is the first of the joining month, because a month is the unit a Kitty closes. */
async function merge(target, { people, joined_on, today, name, consent, answers = {}, share = {}, dry_run = false }) {
  if (!today) throw fail("no_today", "merge needs today.");
  if (people.length !== 2) throw fail("two_people", "A merge joins two Kitties.");
  const start = `${monthOf(joined_on)}-01`;
  for (const p of people) await ready(p.store);
  const o = await Promise.all(people.map((p) => loadOriginals(p.store))), ident = identity(o[0], o[1]), disagree = conflicts(o[0], o[1], ident.map);
  const questions = questionsFor({ who: people, joint: ident.joint, o, clash: ident.clash, disagree, from: start });
  const said = Object.fromEntries(questions.map((q) => [q.id, answers[q.id] ?? q.default]));
  const blocked = questions.filter((q) => q.blocks);
  if (dry_run || !consent) {
    const scratch = folderStore({ dir: "/merge", fs: memfs() });
    const out = { dry_run: true, questions, map: Object.fromEntries(ident.map), blocked: blocked.map((q) => q.say) };
    if (blocked.length) return out;
    const parts = await Promise.all(people.map((p) => cut(p, share, start)));
    const r = await apply(scratch, { people, parts, o, ident, from: start, joined_on, name, today, answers: said, consent: people.map((p) => ({ by: p.by, words: "dry run" })) });
    return { ...out, ...r, proposals: await proposals(scratch, { today }), private: parts.map((s, i) => ({ by: people[i].by, ...s.left_behind })) };
  }
  [...consent].forEach(needConsent);
  if (consent.length !== 2) throw fail("no_consent", "Both people have to say yes.");
  if (blocked.length) throw fail("name_clash", blocked[0].say, { questions });
  const parts = await Promise.all(people.map((p) => cut(p, share, start)));
  const r = await apply(target, { people, parts, o, ident, from: start, joined_on, name, today, answers: said, consent });
  const built = await rebuildAt(target, { today }), unbound = built.L.decisions.filter((d) => d.status === "accepted" && !built.L.decisionBound(d)).map((d) => d.decision_id);
  const rebound = o[1].decision.filter((d) => d.target_type === "line" && ident.map.has(String(d.target_ref).split("|")[0])).length;
  return { ...r, from: start, joined_on, questions, asked: questions.length, map: Object.fromEntries(ident.map), joint: ident.joint, rebound_decisions: rebound, unbound, proposals: await proposals(target, { today, built }), homes: await homes([target, ...people.map((p) => p.store)]), private: parts.map((s, i) => ({ by: people[i].by, ...s.left_behind })) };
}
const cut = (p, share, start) => slice(p.store, { from: share[p.by] || start, setup: (t) => !["household", "period", "membership"].includes(t) });
/* After joining, one person shares a stretch of their own past into the joint Kitty. The identity map stands. Locked months travel with it, so a month two histories now share is a proposal, not a silent change. */
async function shareHistory(target, source, { to, from, today, consent, by }) {
  if (!today) throw fail("no_today", "shareHistory needs today.");
  needConsent(consent);
  await ready(source); await ready(target);
  const home = (await source.manifest()).household_id, joined = (await target.tables.read("decision")).filter((d) => d.value && d.value.recipe === "merge" && d.value.role === "in" && d.value.from_household === home).pop();
  if (!joined) throw fail("not_joined", "This Kitty has not joined that one.");
  const map = new Map(Object.entries(joined.value.map || {})), s = await slice(source, { from, to, setup: () => false, period: (p) => p.end_on <= to && (!from || p.start_on >= from) });
  s.read = (sha) => source.blobs.get(sha);
  const hhId = (await target.manifest()).household_id, { counts, times } = await adopt(target, s, { today, map });
  const audited = await audit(s, target), id = transferId("share", home, hhId, today);
  const row = (role) => logRow({ id, role, recipe: "share", from: home, to: hhId, consent, today, slice: s, counts, times: role === "in" ? times : [], shared: s.tables.source.map((x) => x.source_id), map });
  await target.tables.appendNew("decision", [row("in")]);
  await source.tables.appendNew("decision", [row("out")]);
  await target.tables.countOriginals(await loadOriginals(target));
  return { transfer_id: id, by, counts, audit: audited, proposals: await proposals(target, { today }), homes: await homes([target, source]) };
}
module.exports = { merge, shareHistory, identity };
