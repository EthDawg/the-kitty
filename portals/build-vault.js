#!/usr/bin/env node
/* The vault: every file the Davies world delivers, copied unchanged into estate/files/vault/ and listed in estate/vault.json for the portals to hand over.
   From a checkout: node standard/world/build.js && node portals/build-vault.js. The `streams` in brands.json and vault-brands.json say which portal holds
   what; a world file with no home or two homes, a stream no file uses, or a copy that fails its hash stops the build. It also writes estate/access.json,
   who holds what from the world's ownership tables, and estate/people.json, the family profile. estate/ is gitignored, and sits outside public/ so a file
   is only ever handed over by api/files.js, which asks the clock and the person first. public/vault-stats.json keeps the landing page's counts. */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const TYPES = require("./lib/file-types");

const WORLD = path.resolve(__dirname, "..", "standard", ".build", "world");
const PUBLIC = path.join(__dirname, "public");
const ESTATE = path.join(__dirname, "estate");
const VAULT = path.join(ESTATE, "files", "vault");
const INDEX = path.join(ESTATE, "vault.json");
const PROFILE = path.resolve(__dirname, "..", "life", "davies", "profile.json");
const { buildEstate } = require("./build-estate");
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
for (const stale of ["vault", "vault.json"]) fs.rmSync(path.join(PUBLIC, stale), { recursive: true, force: true }); // where the vault used to live, and must never be served from again
fs.mkdirSync(ESTATE, { recursive: true });
const files = manifest.files.map((f, i) => {
  const bytes = fs.readFileSync(path.join(WORLD, f.path));
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== f.sha256) stop(`${f.path} does not match the manifest. Rebuild the world.`);
  const rel = path.join(f.stream_id, f.download_date, f.name);
  fs.mkdirSync(path.join(VAULT, path.dirname(rel)), { recursive: true });
  fs.writeFileSync(path.join(VAULT, rel), bytes);
  return { brand: homes[i].brand, stream: f.stream_id, year: f.download_date.slice(0, 4), date: f.download_date, exists_from: f.issued_on || f.download_date, family: f.family, origin: f.origin, name: f.name, size: bytes.length, type: TYPES[path.extname(f.name)], path: `vault/${rel.split(path.sep).join("/")}`, sha256 };
});

const streams = shelves.map(({ brand, id, name }) => {
  const mine = files.filter((f) => f.brand === brand && f.stream === id).map((f) => f.date).sort();
  return { brand, id, name, files: mine.length, first: mine[0], last: mine[mine.length - 1] };
});
fs.writeFileSync(INDEX, `${JSON.stringify({ world: manifest.world, streams, files })}\n`);
fs.writeFileSync(path.join(PUBLIC, "vault-stats.json"), `${JSON.stringify({ files: files.length, first: files.map((f) => f.date).sort()[0], last: files.map((f) => f.date).sort().pop() })}\n`);

// Who holds what, from the world. An account, an asset or a person says it directly; a contract says it through its holder, its account or its asset.
const setup = (name) => read(path.join(WORLD, "setup", `${name}.json`));
const ownership = setup("ownership").filter((o) => o.basis === "legal");
const contracts = Object.fromEntries(setup("contract").map((c) => [c.contract_id, c]));
const adults = setup("membership").filter((m) => m.role === "adult").map((m) => m.party_id);
const owners = (type, id) => ownership.filter((o) => o.subject_type === type && o.subject_id === id).map((o) => ({ party: o.party_id, from: o.valid_from, to: o.valid_to || null }));
const always = (party) => ({ party, from: "2000-01-01", to: null });
const holdersOf = (type, id) => {
  if (type === "party") return adults.includes(id) ? [always(id)] : adults.map(always); // a child's paper is both parents'
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
fs.writeFileSync(path.join(ESTATE, "access.json"), `${JSON.stringify({ subjects })}\n`);
fs.copyFileSync(PROFILE, path.join(ESTATE, "people.json"));

console.log(`${files.length} files for ${new Set(files.map((f) => f.brand)).size} portals in estate/files/vault`);

buildEstate({ ESTATE, vault: { streams, files }, access: { subjects }, profile: read(PROFILE), repoRoot: path.resolve(__dirname, "..") }).then((r) => {
  console.log(`the Drive holds ${r.drive} files in ${r.folders} folders, the inbox ${r.mail} messages, and ${r.missing} things a chapter needs exist nowhere yet`);
}).catch((e) => stop(e.message));
