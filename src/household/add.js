/* Files in. A file goes through the standard's intake: fingerprint, recipe, controls, observations. Nothing unread is dropped: a format with no
   recipe is held and comes back as a request with sample rows, a scan as a request for an agent, a file that fails its own checks as refused.
   Everything is written in an order a failure can survive: bytes, then setup, then observations, then the source row last. The source row is the
   commit. Run it again after any failure and only what is missing is added. */
"use strict";
const { ingestFiles } = require("../../standard/intake");
const { decode } = require("../../standard/intake/containers");
const { fingerprint } = require("../../standard/intake/fingerprint");
const { gate } = require("../../standard/intake/gate");
const { sha256 } = require("../../standard/intake/sha256");
const { Resolver } = require("../../standard/engine/resolve");
const { allocate } = require("../../standard/engine/util");
const { base } = require("./base");
const { latest, dayOf } = require("./clock");
const { ready, slug, stamp, fail, SINCE } = require("./init");

const SAMPLE_ROWS = 6, SAMPLE_LINES = 14;
const STATES = { "blob:": "held", "device:": "on_device", "not-held:": "not_held" };
const bytesState = (s) => { const k = Object.keys(STATES).find((p) => String(s.uri || "").startsWith(p)); return k ? STATES[k] : "unknown"; };
const readState = (s) => (s.status === "quarantined" ? "refused" : /^unread:/.test(s.note || "") ? "unread" : /^held:/.test(s.note || "") ? "held" : "read");
const CASH_LINES = new Set(["txn_line", "statement", "balance"]);
const OTHER_LINES = { loan_statement: { class: "liability", type: "loan", reporting_group: "loans" }, super_statement: { class: "asset", type: "super", reporting_group: "super" }, super_line: { class: "asset", type: "super", reporting_group: "super" } };
const refOf = (o) => o.payload && o.payload.account_ref;
const dateOf = (o) => o.occurred_on || o.payload.posting_date || o.payload.period_end || o.payload.as_at;
const digits = (s) => String(s).replace(/[^0-9]/g, "");

function sampleOf(bytes, inflate) {
  try {
    const d = decode(bytes, { inflate });
    return { rows: (d.rows || []).slice(0, SAMPLE_ROWS), lines: (d.lines || []).slice(0, SAMPLE_LINES).map((l) => l.text) };
  } catch (e) { return { rows: [], lines: [] }; }
}
const accountKind = (found) => {
  if (found.other) return found.other;
  const card = found.card || (found.closing != null && found.closing < 0);
  return card ? { class: "liability", type: "credit_card", reporting_group: "cash" } : { class: "asset", type: "transaction", reporting_group: "cash" };
};
/* A file can name an account nobody has set up. The engine would hold its lines out and ask for an alias, which is the wrong first thing to ask someone
   who has just dropped in their bank file. So a bank, card, loan or super account comes into being here, from the file, for whoever is in the
   household, equally until someone says otherwise. Anything else stays unresolved and is asked about: a broker's holding needs a person. */
function materialise(setup, sources, observations, { today, name, type }) {
  const out = { account: [], alias: [], ownership: [], stream: [] }, unresolved = new Map(), used = new Set(setup.account.map((a) => a.account_id));
  const adults = setup.membership.filter((m) => m.role === "adult").map((m) => m.party_id).filter((id, i, a) => a.indexOf(id) === i).sort();
  const found = new Map();
  for (const o of observations) {
    const ref = refOf(o);
    if (!ref) continue;
    const f = found.get(ref) || found.set(ref, { ref, first: dateOf(o), kinds: new Set(), closing: null }).get(ref);
    f.kinds.add(o.kind);
    if (dateOf(o) && dateOf(o) < f.first) f.first = dateOf(o);
    if (o.kind === "statement") { f.closing = o.payload.closing_cents; if (o.payload.minimum_due_cents != null || o.payload.amount_due_cents != null) f.card = true; }
    if (OTHER_LINES[o.kind]) f.other = OTHER_LINES[o.kind];
  }
  for (const f of found.values()) {
    const R = new Resolver({ setup: { ...setup, account: [...setup.account, ...out.account], alias: [...setup.alias, ...out.alias], stream: [...setup.stream, ...out.stream] }, sources, observations: [], decisions: [], rules: [], eventSchema: base().schema.events });
    const src = observations.find((o) => refOf(o) === f.ref);
    if (R.accountOf(src, f.ref, f.first)) continue;
    if (![...f.kinds].some((k) => CASH_LINES.has(k) || OTHER_LINES[k])) { unresolved.set(f.ref, { ref: f.ref, kinds: [...f.kinds] }); continue; }
    const tail = digits(f.ref).slice(-4) || slug(f.ref).slice(0, 8), called = name || (digits(f.ref) ? `Account ending ${tail}` : String(f.ref));
    let id = `ACC-${tail}`;
    for (let n = 2; used.has(id); n += 1) id = `ACC-${tail}-${n}`;
    used.add(id);
    const kind = { ...accountKind(f), ...(type ? { type } : {}) };
    out.account.push({ account_id: id, name: called, ...kind, currency: "AUD", in_scope: true, fidelity: "ledger", note: "Made from the first file. Rename it any time." });
    out.alias.push({ subject_type: "account", subject_id: id, scheme: "account_number", value: f.ref, valid_from: SINCE, recorded_at: stamp(today) });
    if (adults.length) for (const basis of ["legal", "beneficial", "tax"]) for (const s of allocate(10000, adults.map((p) => ({ key: p, weight: 1 })))) out.ownership.push({ subject_type: "account", subject_id: id, party_id: s.key, basis, share_bps: s.cents, valid_from: SINCE, recorded_at: stamp(today), note: adults.length > 1 ? "Assumed equal until someone says otherwise." : null });
    out.stream.push({ stream_id: id, name: called, doc_kind: "statement", subject_type: "account", subject_id: id, cadence: "monthly", valid_from: f.first, grace_days: 14, recorded_at: stamp(today) });
  }
  return { ...out, unresolved: [...unresolved.values()] };
}
// An account can have two streams, a download and a statement. A dropped file goes to the one that matches what it is.
function streamFor(streams, source) {
  const pdf = /pdf/.test(source.mime || ""), like = (st) => /pdf|statement/i.test(st.doc_kind || "") === pdf;
  return streams.find(like) || streams[0] || null;
}
async function keepBytes(store, source, bytes, onDevice, warnings) {
  const sha = source.sha256;
  if (store.blobs) {
    try { await store.blobs.put(sha, bytes, { name: source.name, mime: source.mime }); return `blob:sha256:${sha}`; }
    catch (e) { if (e.code !== "missing_grant") throw e; warnings.push(`${source.name}: the file itself is not kept, because ${e.message}`); }
  }
  return onDevice ? `device:${source.name}` : `not-held:${source.name}`;
}
const recipesOf = (rows) => rows.filter((r) => r.gate_status === "passed").map((r) => r.spec);

// files: [{ name, bytes }], and optionally path, stream, download_date, origin, issued_on. opts: { today, account, name, type, on_device }.
async function add(store, files, opts = {}) {
  const { today } = opts, b = base();
  if (!today) throw fail("no_today", "add needs today: the clock is the host's to give.");
  await ready(store);
  const [sourceRows, recipeRows, deliveryRows, ...setupRows] = await Promise.all(["source", "recipe", "x_delivery", "account", "alias", "stream", "membership", "party", "ownership"].map((t) => store.tables.read(t)));
  const [account, alias, stream, membership, party, ownership] = setupRows;
  const setup = { account: latest("account", account), alias, stream: latest("stream", stream), membership, party: latest("party", party), ownership };
  const known = latest("source", sourceRows), bySha = new Map(known.map((s) => [s.sha256, s]));
  const delivered = new Set(deliveryRows.map((d) => `${d.stream_id}|${d.day}|${d.source_id}`));
  const result = { added: [], already: [], needs_recipe: [], needs_agent: [], needs_account: [], refused: [], accounts_created: [], unresolved: [], warnings: [] };

  const todo = [], repeats = [];
  for (const f of files) {
    const name = f.name || String(f.path).split("/").pop(), sha = sha256(f.bytes), held = bySha.get(sha);
    const entry = { path: f.path || `added/${today}/${name}`, name, bytes: f.bytes, stream: f.stream || opts.account || null, download_date: f.download_date || today, origin: f.origin, issued_on: f.issued_on, sha };
    if (held && ["read", "held"].includes(readState(held))) repeats.push({ entry, source: held }); else todo.push(entry);
  }
  const res = ingestFiles(todo, { recipes: [...recipesOf(recipeRows), ...b.recipes], vocab: b.vocab, inflate: b.inflate, manifest: { files: todo.filter((f) => f.origin || f.issued_on).map((f) => ({ path: f.path, origin: f.origin, issued_on: f.issued_on })) } });
  const byPath = new Map(todo.map((f) => [f.path, f]));
  const unknown = new Map(res.unknown_files.map((u) => [u.path, u]));
  const logged = new Map(res.files.filter((e) => !e.duplicate_of).map((e) => [e.source_id, e]));

  for (const u of res.unknown_files.filter((x) => x.reason === "undecodable")) {
    const f = byPath.get(u.path);
    res.sources.push({ source_id: `src-${f.sha.slice(0, 16)}`, sha256: f.sha, name: f.name, uri: f.path, origin: "manual", mime: "application/octet-stream", bytes: f.bytes.length, stream_id: f.stream, captured_at: stamp(f.download_date), status: "quarantined" });
  }
  // A file with no account number of its own needs to be told whose it is.
  const faultsBy = new Map();
  for (const x of res.faults) { if (!faultsBy.has(x.path)) faultsBy.set(x.path, []); faultsBy.get(x.path).push(x); }
  for (const s of res.sources) {
    const f = byPath.get(s.uri), u = unknown.get(s.uri), faults = faultsBy.get(s.uri) || [];
    const noAccount = !f.stream && faults.some((x) => /account_ref/.test(`${x.what || ""}${x.code || ""}`));
    if (u && u.reason === "no_recipe") { s.note = `unread:no_recipe:${u.fingerprint}`; result.needs_recipe.push({ name: f.name, sha256: f.sha, fingerprint: u.fingerprint, container: u.container, sample: sampleOf(f.bytes, b.inflate), ask: `${f.name} is a ${u.container} file The Kitty has not met. Nothing from it is in your numbers yet. An agent can write a recipe for it from these sample rows; the gate decides if it reads the file right. See standard/RECIPES.md.` }); }
    else if (u && u.reason === "agent_tier") { s.note = `unread:agent_tier:${u.fingerprint}`; result.needs_agent.push({ name: f.name, sha256: f.sha, fingerprint: u.fingerprint, ask: `${f.name} is ${u.detail}. No recipe can read it. An agent can read it and write observations with a quote and a locator.` }); }
    else if (noAccount) { s.status = "quarantined"; s.note = "refused: This file does not say which account it is for."; result.needs_account.push({ name: f.name, sha256: f.sha, ask: `${f.name} does not say which account it is for. Add it again and name the account.` }); }
    else if (s.status === "quarantined") { const why = faults.find((x) => x.code !== "file_refused") || faults[0] || {}; s.note = `refused: ${f.name} failed its checks and was not imported. ${why.what || why.code || ""}`.trim(); result.refused.push({ name: f.name, sha256: f.sha, why: s.note.replace(/^refused: /, ""), faults: faults.slice(0, 5) }); }
    else delete s.note;
  }
  const made = materialise(setup, res.sources, res.observations, { today, name: opts.name, type: opts.type });
  result.unresolved = made.unresolved;
  result.accounts_created = made.account.map((a) => ({ account_id: a.account_id, name: a.name, type: a.type }));
  // A source belongs to the stream of the account it speaks for, once there is exactly one.
  const allAlias = [...setup.alias, ...made.alias], allAccounts = [...setup.account, ...made.account], allStreams = [...setup.stream, ...made.stream];
  const R = new Resolver({ setup: { ...setup, account: allAccounts, alias: allAlias, stream: allStreams }, sources: res.sources, observations: [], decisions: [], rules: [], eventSchema: b.schema.events });
  const accountsBySource = new Map();
  for (const o of res.observations) { const a = refOf(o) && R.accountOf(o, refOf(o), dateOf(o)); if (a) { if (!accountsBySource.has(o.source_id)) accountsBySource.set(o.source_id, new Set()); accountsBySource.get(o.source_id).add(a); } }
  for (const s of res.sources) {
    const accounts = [...(accountsBySource.get(s.source_id) || [])];
    const namedStream = s.stream_id && allStreams.some((x) => x.stream_id === s.stream_id);
    if (!namedStream && accounts.length === 1) { const st = streamFor(allStreams.filter((x) => x.subject_type === "account" && x.subject_id === accounts[0]), s); if (st) s.stream_id = st.stream_id; }
    s.uri = await keepBytes(store, s, byPath.get(s.uri).bytes, opts.on_device ?? store.capabilities.device_files, result.warnings);
  }
  // A byte-identical re-delivery of a quiet file is how a dormant account says "still nothing". Of any other file it is just the same file again.
  const quietIds = new Set(), counts = new Map();
  const observed = repeats.length || res.files.some((e) => e.duplicate_of) ? await store.tables.read("observation") : [];
  for (const o of [...observed, ...res.observations]) counts.set(o.source_id, (counts.get(o.source_id) || 0) + 1);
  const deliveries = [];
  const note = (f, source) => {
    const k = `${f.stream || source.stream_id}|${f.download_date}|${source.source_id}`;
    if ((counts.get(source.source_id) || 0) || !(f.stream || source.stream_id) || delivered.has(k) || f.download_date === dayOf(source.captured_at)) return;
    delivered.add(k); quietIds.add(source.source_id);
    deliveries.push({ stream_id: f.stream || source.stream_id, day: f.download_date, source_id: source.source_id });
  };
  for (const { entry, source } of repeats) { note(entry, source); result.already.push({ name: entry.name, source_id: source.source_id }); }
  const fresh = new Map(res.sources.map((s) => [s.source_id, s]));
  for (const e of res.files.filter((x) => x.duplicate_of)) { const f = byPath.get(e.path); note(f, fresh.get(e.source_id) || known.find((s) => s.source_id === e.source_id)); result.already.push({ name: f.name, source_id: e.source_id }); }

  for (const t of ["account", "alias", "ownership", "stream"]) await store.tables.appendNew(t, made[t]);
  await store.tables.appendNew("observation", res.observations);
  await store.tables.appendNew("x_delivery", deliveries);
  const before = new Map(known.map((s) => [s.source_id, s]));
  await store.tables.appendNew("source", res.sources.filter((s) => !before.has(s.source_id)));
  for (const s of res.sources.filter((x) => before.has(x.source_id))) { const was = before.get(s.source_id); if (was.status !== s.status || (was.note || "") !== (s.note || "")) await store.tables.change("source", s); }
  for (const s of res.sources) { const e = logged.get(s.source_id); if (e && e.recipe && s.status === "active") result.added.push({ name: s.name, source_id: s.source_id, recipe: e.recipe, observations: e.observations, by_kind: e.by_kind, bytes: bytesState(s) }); }
  return result;
}
/* The other half of a recipe request. A recipe from anyone goes through the gate over the files it claims. It passes, and it is stored and the
   files are read; or it fails, nothing changes and the verdict says why. files is optional when the store holds the bytes. */
async function addRecipe(store, recipe, opts = {}) {
  const { today, author = "agent", tokens_in, tokens_out } = opts, b = base();
  if (!today) throw fail("no_today", "addRecipe needs today.");
  await ready(store);
  const known = latest("source", await store.tables.read("source")), waiting = known.filter((s) => readState(s) !== "read");
  let pool = (opts.files || []).map((f) => ({ name: f.name || String(f.path).split("/").pop(), bytes: f.bytes, stream: f.stream || opts.account || null }));
  if (!pool.length && store.blobs) for (const s of waiting) { const bytes = await store.blobs.get(s.sha256); if (bytes) pool.push({ name: s.name, bytes, stream: s.stream_id || opts.account || null, download_date: dayOf(s.captured_at) }); }
  pool = pool.map((f) => { let decoded = null; try { decoded = decode(f.bytes, { inflate: b.inflate }); } catch (e) { /* stays out of the family */ } return { ...f, decoded, fingerprint: decoded && fingerprint(decoded) }; });
  const family = pool.filter((f) => (recipe.fingerprints || []).includes(f.fingerprint));
  if (!family.length) return { status: "no_files", message: "This recipe does not claim any file held here. Its fingerprints must include the file's.", fingerprints_seen: [...new Set(pool.map((f) => f.fingerprint).filter(Boolean))] };
  const verdict = gate(recipe, family.map((f) => ({ path: f.name, stream: f.stream, decoded: f.decoded })), { vocab: b.vocab });
  if (verdict.status !== "pass") {
    const lacksAccount = verdict.failures.length && verdict.failures.every((x) => /account_ref/.test(x.what)) && !family.some((f) => f.stream);
    if (lacksAccount) return { status: "needs_account", verdict, ask: `${family[0].name} does not say which account it is for, so the recipe has nothing to fill it with. Name the account and run it again.` };
    return { status: "failed", verdict };
  }
  await store.tables.appendNew("recipe", [{ recipe_id: recipe.id, fingerprint: recipe.fingerprints[0], family: recipe.family || recipe.id, spec: recipe, author, tokens_in, tokens_out, gate_status: "passed", created_at: stamp(today) }]);
  return { status: "passed", verdict, read: await add(store, family.map(({ name, bytes, stream, download_date }) => ({ name, bytes, stream, download_date })), { today, account: opts.account }) };
}
module.exports = { add, addRecipe, bytesState, readState };
