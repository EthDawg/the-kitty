#!/usr/bin/env node
/* The vault: every file a family's world delivers, copied unchanged into public/vault/ and listed in estate/<family>/vault.json for the portals to list.
   From a checkout: node standard/world/build.js && node portals/build-vault.js. The benchmark world comes first, and is the default. The `streams` in brands.json
   and vault-brands.json say which portal holds what; a world file with no home or two homes, a stream no file uses, or a copy that fails its hash stops the build.
   Each family under life/world/out/ follows: see build-family.js. --fixture adds the test family, and KITTY_FAMILIES adds a folder of families. public/vault/ and
   estate/ are gitignored. The files are static: the listings are what answer to the clock and the person. public/vault-stats.json keeps the landing page's counts. */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const TYPES = require("./lib/file-types");
const { buildEstate } = require("./build-estate");
const { buildFamily, familiesIn } = require("./build-family");
const { benchmarkPeople, BENCHMARK } = require("./lib/families");

const ROOT = path.resolve(__dirname, "..");
const WORLD = path.join(ROOT, "standard", ".build", "world");
const PUBLIC = path.join(__dirname, "public");
const ESTATE = path.join(__dirname, "estate");
const VAULT = path.join(PUBLIC, "vault");
const stop = (lines) => { console.error(`build-vault: ${[lines].flat().join("\n  ")}`); process.exit(1); };
const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

if (!fs.existsSync(path.join(WORLD, "manifest.json"))) stop("no world to copy. Run node standard/world/build.js first.");
const manifest = read(path.join(WORLD, "manifest.json"));
const brands = [...read(path.join(PUBLIC, "brands.json")), ...read(path.join(PUBLIC, "vault-brands.json"))];
const RULES = read(path.join(__dirname, "data", "portal-rules.json"));

// one row per brand and stream: a label, and the families it takes when a stream is split between two portals
const shelves = brands.flatMap((b) => Object.entries(b.streams).map(([id, s]) => ({ brand: b.id, id, name: s.name || s, families: s.families || null })));
const takes = (shelf, f) => shelf.id === f.stream_id && (!shelf.families || shelf.families.includes(f.family));

const problems = [];
const homes = manifest.files.map((f) => {
  const found = shelves.filter((s) => takes(s, f));
  if (found.length !== 1) problems.push(`${f.path} (${f.family}) has ${found.length ? `${found.length} homes: ${found.map((s) => s.brand).join(", ")}` : "no home"}`);
  if (!TYPES[path.extname(f.name)]) problems.push(`${f.path} has no content type`);
  return found[0];
});
for (const s of shelves) if (!manifest.files.some((f) => takes(s, f))) problems.push(`${s.brand} lists ${s.id}, and no file arrives there`);
for (const b of brands) if (!RULES.portals[b.id]) problems.push(`${b.id} has no row in data/portal-rules.json`);
if (problems.length) stop(problems);

fs.rmSync(ESTATE, { recursive: true, force: true });
fs.rmSync(VAULT, { recursive: true, force: true });
const OUT = path.join(ESTATE, BENCHMARK);
fs.mkdirSync(OUT, { recursive: true });

// Who holds what, from the world. An account, an asset or a person says it directly; a contract says it through its holder, its account or its asset.
const setup = (name) => read(path.join(WORLD, "setup", `${name}.json`));
const ownership = setup("ownership").filter((o) => o.basis === "legal");
const contracts = Object.fromEntries(setup("contract").map((c) => [c.contract_id, c]));
const adults = setup("membership").filter((m) => m.role === "adult").map((m) => m.party_id);
const owners = (type, id) => ownership.filter((o) => o.subject_type === type && o.subject_id === id).map((o) => ({ party: o.party_id, from: o.valid_from, to: o.valid_to || null }));
const always = (party) => ({ party, from: "2000-01-01", to: null });
const holdersOf = (type, id) => {
  if (type === "party") return adults.includes(id) ? [always(id)] : [...adults, id].map(always); // a child's paper is theirs and both parents'
  if (type === "account" || type === "asset") return owners(type, id);
  const c = contracts[id];
  if (!c) return [];
  if (c.holder_party_id) return holdersOf("party", c.holder_party_id);
  if (c.account_id && owners("account", c.account_id).length) return owners("account", c.account_id);
  return c.asset_id ? owners("asset", c.asset_id) : [];
};
const subjects = {};
for (const s of setup("stream")) { const rows = holdersOf(s.subject_type, s.subject_id); if (rows.length) subjects[s.stream_id] = rows; }
for (const c of Object.keys(contracts)) { const rows = holdersOf("contract", c); if (rows.length) subjects[c] = rows; }
for (const o of ownership) subjects[o.subject_id] = owners(o.subject_type, o.subject_id);
for (const [id, parties] of Object.entries(RULES.access)) if (Array.isArray(parties)) subjects[id] = parties.map(always);
fs.writeFileSync(path.join(OUT, "access.json"), `${JSON.stringify({ subjects })}\n`);

const people = benchmarkPeople();
const soleHolder = (stream) => { const rows = subjects[stream] || [], ids = [...new Set(rows.map((r) => r.party))]; return ids.length === 1 ? (people.find((p) => p.party_id === ids[0]) || { id: null }).id : null; };

const files = manifest.files.map((f, i) => {
  const bytes = fs.readFileSync(path.join(WORLD, f.path));
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== f.sha256) stop(`${f.path} does not match the manifest. Rebuild the world.`);
  const rel = path.join(f.stream_id, f.download_date, f.name);
  fs.mkdirSync(path.join(VAULT, path.dirname(rel)), { recursive: true });
  fs.writeFileSync(path.join(VAULT, rel), bytes);
  return { brand: homes[i].brand, stream: f.stream_id, year: f.download_date.slice(0, 4), date: f.download_date, delivered_on: f.download_date, person: soleHolder(f.stream_id), family: f.family, origin: f.origin, name: f.name, size: bytes.length, type: TYPES[path.extname(f.name)], path: `vault/${rel.split(path.sep).join("/")}`, sha256 };
});

const streams = shelves.map(({ brand, id, name }) => {
  const mine = files.filter((f) => f.brand === brand && f.stream === id).map((f) => f.date).sort();
  return { brand, id, name, files: mine.length, first: mine[0], last: mine[mine.length - 1] };
});
const dates = files.map((f) => f.date).sort(), last = dates[dates.length - 1];
fs.writeFileSync(path.join(OUT, "vault.json"), `${JSON.stringify({ world: manifest.world, last, streams, files })}\n`);
fs.writeFileSync(path.join(PUBLIC, "vault-stats.json"), `${JSON.stringify({ files: files.length, first: dates[0], last })}\n`);
console.log(`${files.length} files for ${new Set(files.map((f) => f.brand)).size} portals in public/vault`);

(async () => {
  const r = await buildEstate({ ESTATE: OUT, PUBLIC, vault: { streams, files }, access: { subjects }, repoRoot: ROOT });
  console.log(`the Drive holds ${r.drive} files in ${r.folders} folders, the inbox ${r.mail} messages, and ${r.missing} things a chapter needs exist nowhere yet`);
  const families = [{ id: BENCHMARK, label: "The benchmark household, 2019 to 2027", people }];
  const roots = [path.join(ROOT, "life", "world", "out"), ...(process.argv.includes("--fixture") ? [path.join(__dirname, "test", "fixtures", "families")] : []), ...(process.env.KITTY_FAMILIES ? [path.resolve(process.env.KITTY_FAMILIES)] : [])];
  for (const dir of roots.flatMap(familiesIn)) {
    const f = await buildFamily({ dir, ESTATE, PUBLIC, brands });
    families.push(f.entry);
    console.log(`${f.entry.id}: ${f.listed} files on portals, ${f.drive} in the Drive, ${f.mail} messages, for ${f.entry.people.map((p) => p.first_name).join(", ")}`);
  }
  fs.writeFileSync(path.join(ESTATE, "families.json"), `${JSON.stringify({ families })}\n`);
})().catch((e) => stop(e.message));
