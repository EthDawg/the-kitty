/* node --test life/world/test.js. The generator's promises, proved by running it, and the world's soundness, proved by the Standard's own reader. No fixture here was shaped to pass:
   every expectation comes from life.json, traps.md or truth.json, and a failure means the world or the reader moved. */
"use strict";
const test = require("node:test"), assert = require("node:assert");
const fs = require("fs"), path = require("path"), os = require("os"), crypto = require("crypto");
const { build, script } = require("./build");
const { sound } = require("./sound");
const { STD, REPO } = require("./lib/std");
const { decode } = require(path.join(STD, "intake", "containers"));
const { fingerprint } = require(path.join(STD, "intake", "fingerprint"));
const { gate } = require(path.join(STD, "intake", "gate"));
const { hostInflate, loadRecipes, loadVocab, ingestFiles } = require(path.join(STD, "intake"));
const { check: findings } = require("../findings/run");

const SEEDS = [11, 12];
const davies = sound({ seed: 1 }), variants = SEEDS.map((seed) => sound({ seed, variant: true, public: false }));
const chapter = (r, n) => r.chapters.find((c) => c.chapter === n);
const FULL = script.chapters.filter((c) => c.status === "full").map((c) => c.chapter);
const shaOf = (files) => crypto.createHash("sha256").update(files.map((f) => f.sha256).join("\n")).digest("hex");
const textOf = (f) => { if (/\.(csv|json|html|eml|ofx|qif|txt)$/.test(f.name || f.path)) return new TextDecoder().decode(f.bytes); try { return (decode(f.bytes, { inflate: hostInflate() }).lines || []).map((l) => l.text).join("\n"); } catch (e) { return ""; } };

test("the same seed gives the same bytes, with no clock and no Math.random", () => {
  assert.strictEqual(shaOf(build({ seed: 1, write: false }).files), shaOf(davies.world.files));
  assert.strictEqual(shaOf(build({ seed: 11, variant: true, write: false }).files), shaOf(variants[0].world.files));
  for (const n of ["build.js", ...fs.readdirSync(path.join(__dirname, "lib")).map((x) => `lib/${x}`)]) assert.ok(!/Math\.random\(|Date\.now\(|new Date\(\)/.test(fs.readFileSync(path.join(__dirname, n), "utf8")), `${n} uses a clock or Math.random`);
});

for (const [name, r] of [["the Davies", davies], ...variants.map((v, i) => [`variant ${SEEDS[i]}`, v])]) {
  test(`${name}: every chapter reads and every balance ties`, () => {
    for (const n of [...FULL, 7, 9]) {
      const c = chapter(r, n);
      assert.strictEqual(c.crash, null, `chapter ${n} crashed: ${c.crash}`);
      assert.strictEqual(c.off, 0, `chapter ${n} balances off: ${JSON.stringify(c.off_examples.slice(0, 4))}`);
      assert.strictEqual(c.lines.off, 0, `chapter ${n} lines doubled or lost: ${JSON.stringify(c.lines.off_examples.slice(0, 4))}`);
      assert.ok(c.unread.every((u) => /^life-(will|bas)-pdf$/.test(u.family)), `chapter ${n} left something unread that nobody declared: ${JSON.stringify(c.unread.slice(0, 2))}`);
      if (n <= 6) assert.ok(c.ties > 0, `chapter ${n} tied nothing, which proves nothing`);
    }
  });
  test(`${name}: the joint account is imported twice and counts once`, () => {
    const c = chapter(r, 3);
    assert.ok(c.by_account["ACC-JOINT"].tie >= 1, "the chapter that tests the joint account must tie a month end on it");
    const files = r.world.files.filter((f) => f.stream === "JOINT" && f.held_from === 3), people = new Set(files.map((f) => f.person));
    assert.strictEqual(people.size, 2);
    const trap = r.world.truth.traps["T3-JOINT-TWICE"][0];
    assert.ok(trap.lines > 3, "the two downloads must overlap");
    const same = r.world.truth.traps["T3-JOINT-SAME-FILE"][0], twins = r.world.files.filter((f) => same.paths.includes(f.path));
    assert.strictEqual(new Set(twins.map((f) => f.sha256)).size, 1, "one month is byte identical between them");
    assert.strictEqual(new Set(twins.map((f) => f.person)).size, 2);
  });
  test(`${name}: who can see a file is explicit, and private history stays private`, () => {
    const { A, B } = r.world.sim.cast;
    for (const f of r.world.files) { assert.ok(f.person, f.path); assert.ok(Array.isArray(f.visible_to) && f.visible_to.includes(f.person), f.path); }
    const solo = (s, p, o) => r.world.files.filter((f) => f.stream === s).forEach((f) => { assert.deepStrictEqual(f.visible_to, [p]); assert.ok(!f.visible_to.includes(o)); });
    for (const s of ["PAY-A", "EVERY-A", "SAVE-A", "CARD-A", "SUPER-A", "HELP-A"]) solo(s, A.id, B.id);
    for (const s of ["PAY-B", "EVERY-B", "SAVE-B", "SUPER-B", "RSU-SALE"]) solo(s, B.id, A.id);
    r.world.files.filter((f) => f.stream === "JOINT").forEach((f) => assert.deepStrictEqual([...f.visible_to].sort(), [A.id, B.id].sort()));
  });
  test(`${name}: truth adds up and marks what it assumed`, () => {
    const T = r.world.truth;
    for (const c of script.chapters) assert.ok(T.chapters[c.chapter], `chapter ${c.chapter}`);
    assert.deepStrictEqual(Object.keys(T.chapters[1].show.balances), ["ACC-A-EVERY"], "chapter 1 shows the one account she holds");
    assert.strictEqual(T.chapters[1].show.month, "2026-12");
    assert.ok(T.chapters[3].show.balances["ACC-JOINT"], "chapter 3 shows the joint account");
    assert.ok(T.assumed_law.some((a) => a.series === "resident_tax_brackets" && a.to >= "2035-01-01"));
    assert.strictEqual(T.tax.FY2030[r.world.sim.cast.A.id].assumed, true);
    assert.strictEqual(T.tax.FY2027[r.world.sim.cast.A.id].assumed, false);
    const m = "2030-06", nw = T.net_worth[m], sum = Object.values(nw.groups).reduce((a, b) => a + b, 0);
    assert.strictEqual(nw.total, sum);
    for (const [id, a] of Object.entries(T.accounts)) for (const v of Object.values(a.months)) assert.ok(Number.isInteger(v), `${id} holds a non-integer`);
    const ages = T.people[r.world.sim.cast.children[0].id]; assert.ok(ages.born >= "2027-10-01" && ages.born <= "2028-08-01");
  });
  test(`${name}: every trap in traps.md has an instance`, () => {
    const ids = [...fs.readFileSync(path.join(__dirname, "traps.md"), "utf8").matchAll(/^\| (T\d-[A-Z0-9-]+) \|/gm)].map((x) => x[1]);
    assert.ok(ids.length >= 45, `only ${ids.length} traps`);
    const listed = new Set(script.chapters.flatMap((c) => c.traps));
    for (const id of ids) { assert.ok(r.world.truth.traps[id] && r.world.truth.traps[id].length, `${id} has no instance in truth`); assert.ok(listed.has(id), `${id} is not in the life script`); }
  });
  test(`${name}: the coordinator's five traps are real numbers`, () => {
    const T = r.world.truth, tr = T.traps;
    assert.strictEqual(tr["T4-CGT-VALUE-30-JUNE"][0].date, "2027-06-30"); assert.strictEqual(tr["T4-CGT-VALUE-30-JUNE"][0].status, "unconfirmed"); assert.ok(tr["T4-CGT-VALUE-30-JUNE"][0].value_cents > 0);
    assert.strictEqual(tr["T5-CGT-TWO-REGIMES"][0].status, "unconfirmed");
    const hold = r.world.files.find((f) => f.stream === "RSU-HOLD" && /2027-06-30/.test(f.name)); assert.ok(hold && hold.held_from > 4, "the mid-2027 value must not be in anything the household holds at chapter 4");
    assert.strictEqual(tr["T4-OWNER-NOT-NAME"][0].beneficial.A, 5000);
    assert.notStrictEqual(tr["T4-PHI-1-APRIL"][0].old_pct, tr["T4-PHI-1-APRIL"][0].new_pct); assert.ok(Object.keys(T.health.FY2026.periods).length === 2, "FY2026 has two rebate rates");
    const under = tr["T9-UNDER-18-SUPER"][0]; assert.ok(under.weeks_over_30_hours > 0 && under.weeks_over_30_hours < under.weeks_under_18 && under.super_cents < under.wrong_if_12_percent_cents);
    const fy = Object.values(T.child_interest)[3]; assert.notStrictEqual(fy.owner, fy.prefill_lands_on);
    const pre = JSON.parse(new TextDecoder().decode(r.world.files.find((f) => f.stream === "PREFILL-A" && /FY2032/.test(f.name)).bytes)), bank = pre.items.find((i) => i.label === "10").amount, ret = r.world.truth.tax.FY2032[r.world.sim.cast.A.id].labels["10"] / 100;
    assert.ok(bank > ret, "pre-fill carries the child's interest and the return does not");
  });
  test(`${name}: the mess is real and each piece is what it says`, () => {
    const ms = r.world.mess, byPath = new Map(r.world.files.map((f) => [f.path, f])), all = Object.values(ms.chapters).flatMap((c) => [...c.drive, ...c.inbox]), bytes = new Map(ms.files.map((f) => [f.path, f.bytes]));
    assert.ok(all.length >= 30);
    for (const m of all.filter((x) => ["copy", "duplicate", "misfiled"].includes(x.kind))) assert.strictEqual(m.sha256, byPath.get(m.of).sha256, m.path);
    const kinds = new Set(all.map((m) => m.kind)); for (const k of ["copy", "duplicate", "misfiled", "scan", "screenshot", "email", "attachment", "intent"]) assert.ok(kinds.has(k), `no ${k}`);
    const list = all.filter((m) => ["scan", "screenshot"].includes(m.kind)).map((m) => ({ path: m.path, bytes: bytes.get(m.path), stream: null, download_date: null, name: path.basename(m.path) }));
    const got = ingestFiles(list, { recipes: loadRecipes(path.join(STD, "recipes")), vocab: loadVocab(), inflate: hostInflate() });
    assert.strictEqual(got.observations.length, 0, "a scan has no text layer and no recipe may claim it");
    const missing = r.world.truth.traps["T2-DRIVE-MISSING-MONTH"][0]; assert.ok(!all.some((m) => m.of === missing.missing), "the missing month is not in the Drive"); assert.ok(byPath.has(missing.missing), "and the portal still has it");
    const c4 = ms.chapters[4]; assert.ok(c4.portal_only.some((x) => x.status === "unconfirmed")); for (const n of [2, 3, 4, 5, 6]) assert.ok(ms.chapters[n].nowhere.length >= 1, `chapter ${n} has nothing that exists nowhere`);
  });
}

test("chapter 0: no public recipe reads her bank, and the recipe an agent would write passes the gate", () => {
  const first = davies.world.files.find((f) => f.held_from === 0), pub = davies.pub.unknown_files.find((u) => u.path === first.path);
  assert.strictEqual(pub.reason, "no_recipe");
  const recipe = davies.answers[0], d = decode(first.bytes, { inflate: hostInflate() }), v = gate(recipe, [{ path: first.path, stream: first.stream, decoded: d }], { vocab: loadVocab() });
  assert.ok(v.pass !== false && !(v.failures || []).length, JSON.stringify(v).slice(0, 300));
  // the saver at the same bank costs nothing: same fingerprint, no second recipe
  const saver = davies.world.files.find((f) => f.stream === "SAVE-A");
  assert.strictEqual(fingerprint(decode(saver.bytes, { inflate: hostInflate() })), recipe.fingerprints[0]);
  assert.strictEqual(davies.answers.length, 1, "only one layout in the Davies' life is outside the public recipes");
});

test("every answer recipe, for every family, passes the gate on every file it claims", () => {
  for (const r of [davies, ...variants]) for (const recipe of r.answers) {
    const mine = r.world.files.filter((f) => { const e = r.intake.files.find((x) => x.path === f.path); return e && e.recipe === recipe.id; }).slice(0, 12).map((f) => ({ path: f.path, stream: f.stream, decoded: decode(f.bytes, { inflate: hostInflate() }) }));
    assert.ok(mine.length > 0, recipe.id);
    const v = gate(recipe, mine, { vocab: loadVocab() }); assert.ok(v.pass !== false, `${recipe.id}: ${JSON.stringify(v).slice(0, 300)}`);
  }
});

test("the check can fail: a tampered world is caught", () => {
  // a month's file gone: the lines are short, so the count breaks even where the next file's running balance carries the total
  const gone = sound({ seed: 1, chapters: [5], public: false, tamper: (w) => { w.files = w.files.filter((f) => !(f.stream === "EVERY-A" && /2028-03-01-to-2028-03-31/.test(f.name))); } }).chapters[0];
  assert.ok(gone.off > 0 || gone.lines.off > 0, "a missing month went unnoticed");
  // one cent on one line: the file fails its own chain and is refused, and the refusal is named
  const cent = sound({ seed: 1, chapters: [3], public: false, tamper: (w) => { const f = w.files.find((x) => x.stream === "JOINT" && x.held_from === 3 && /Joint-.*2027-03-31/.test(x.name)), rows = new TextDecoder().decode(f.bytes).split("\r\n"); rows[3] = rows[3].replace(/(\d)\.(\d)(\d)/, (m, a, b, c) => `${a}.${b}${c === "9" ? 0 : Number(c) + 1}`); f.bytes = new TextEncoder().encode(rows.join("\r\n")); } }).chapters[0];
  assert.ok(cent.unread.some((u) => u.reason === "refused"), "a one cent change was read");
  // truth moved by a cent: the tie breaks
  const moved = sound({ seed: 1, chapters: [2], public: false, tamper: (w) => { w.truth.accounts["ACC-A-SAVE"].months["2026-12"] += 1; } }).chapters[0];
  assert.strictEqual(moved.off, 1);
});

test("two seeds differ in bytes and names, each has its own truth, and neither is the Davies", () => {
  const [a, b] = variants, ca = a.world.sim.cast, cb = b.world.sim.cast;
  assert.notStrictEqual(shaOf(a.world.files), shaOf(b.world.files));
  assert.notStrictEqual(ca.A.name, cb.A.name);
  assert.notStrictEqual(ca.surname, cb.surname);
  assert.notDeepStrictEqual(a.world.truth.accounts["ACC-A-EVERY"].months, b.world.truth.accounts["ACC-A-EVERY"].months);
  assert.notStrictEqual(a.world.truth.net_worth["2030-06"].total, b.world.truth.net_worth["2030-06"].total);
  const banned = /Davies|Daisy|Danny|\bSalt\b|\bGeorge\b|\bEvie\b|Bayview|Northwind|NWGL|Wren Street|Thornbury|Tabby Tax|the\.davies/;
  for (const r of variants) {
    const hits = [];
    for (const f of [...r.world.files, ...r.world.mess.files]) { const t = textOf(f); if (banned.test(t)) hits.push(`${f.path}: ${banned.exec(t)[0]}`); if (hits.length > 4) break; }
    assert.deepStrictEqual(hits, [], "a variant must not be recognisable as the Davies");
    assert.ok(!banned.test(JSON.stringify({ truth: r.world.truth, setup: r.world.setup })), "nor in truth or setup");
  }
});

test("a variant's mix and formats differ from the Davies'", () => {
  const seen = new Set(), banks = new Set();
  for (let seed = 1; seed <= 24; seed++) { const c = require("./lib/cast").variant(script, seed); for (const [role, i] of Object.entries(c.institutions)) { banks.add(`${role}:${i.brand}`); for (const x of (i.spec && i.spec.changes) || []) seen.add(x.split(" ").slice(0, 2).join(" ")); } }
  for (const k of ["date style", "credit and", "a closing"]) assert.ok(seen.has(k), `no format change of kind ${k}: ${[...seen]}`);
  assert.ok([...seen].some((x) => /^header /.test(x)), "a renamed header");
  assert.ok(banks.has("joint:westpaw") && banks.has("joint:ping") && banks.has("joint:commbark"), "the joint account moves between banks");
});

test("output layout: the manifest carries the vault's fields, plus person and delivered_on", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "life-")), r = build({ seed: 1, out: dir }), root = r.root;
  const m = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  for (const k of ["brand", "stream", "year", "date", "name", "size", "type", "path", "sha256", "person", "delivered_on", "visible_to", "held_from_chapter"]) assert.ok(k in m.files[0], k);
  for (const k of ["brand", "id", "name", "files", "first", "last"]) assert.ok(k in m.streams[0], k);
  assert.strictEqual(typeof m.world, "string");
  for (const d of ["sources", "drive", "inbox", "setup", "answers"]) assert.ok(fs.existsSync(path.join(root, d)), d);
  for (const f of ["truth.json", "mess.json"]) assert.ok(fs.existsSync(path.join(root, f)), f);
  const one = m.files.find((f) => f.stream === "PAY-A"), b = fs.readFileSync(path.join(root, one.path));
  assert.strictEqual(crypto.createHash("sha256").update(b).digest("hex"), one.sha256);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("fiction only: no real institution in any file, and tax figures trace to the reference", () => {
  const banned = /\b(Westpac|Commonwealth Bank|ING Direct|American Express|AMEX|HESTA|Bupa|Medibank|Computershare|E\*TRADE|Woolworths|Coles|Centrelink)\b/i;
  for (const f of davies.world.files) { const t = textOf(f); assert.ok(!banned.test(t), `${f.path}: ${banned.exec(t)}`); }
  const src = ["law.js", "life.js", "sim.js"].map((n) => fs.readFileSync(path.join(__dirname, "lib", n), "utf8")).join("\n");
  assert.ok(!/18200|0\.325|69528|\b45000\b/.test(src), "a tax scale is hard coded");
});

test("the cast agrees with life/davies/profile.json, once that file is on this branch", (t) => {
  const file = path.join(REPO, "life", "davies", "profile.json");
  if (!fs.existsSync(file)) return t.skip("the profile lands from life/estate");
  const p = JSON.parse(fs.readFileSync(file, "utf8")), c = script.cast, who = (id) => p.people.find((x) => x.id === id);
  for (const [id, x] of [[c.A.id, c.A], [c.B.id, c.B], ...c.children.map((k) => [k.id, k])]) { assert.strictEqual(who(id).first_name, x.first); assert.strictEqual(who(id).born, x.born, `${id}'s birthday`); assert.strictEqual(who(id).family_name, c.surname); }
  for (const x of [c.A, c.B]) { assert.strictEqual(who(x.id).super.member, x.member); assert.ok(who(x.id).jobs.some((j) => j.employer === x.employer), x.employer); }
  const homes = p.household.homes.map((h) => h.address); for (const a of Object.values(c.addresses)) assert.ok(homes.includes(a), a);
  assert.strictEqual(p.household.shared_mail, c.shared_mail);
});

test("findings are fixtures: each is well formed, with a probe that runs", () => {
  const rows = findings({ chapter: (n) => chapter(davies, n) });
  assert.ok(rows.length >= 3);
  for (const r of rows) { assert.ok(r.title && r.landing, r.id); assert.strictEqual(typeof r.reproduces, "boolean"); }
  assert.ok(fs.existsSync(path.join(REPO, "life", "findings", "F-003-bas-no-recipe.json")));
});
