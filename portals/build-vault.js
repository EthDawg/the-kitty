#!/usr/bin/env node
/* The vault: every file the Davies world delivers, copied unchanged into public/vault/ and listed in public/vault.json for the portals to hand over.
   From a checkout: node standard/world/build.js && node portals/build-vault.js. The `streams` in brands.json and vault-brands.json say which portal holds
   what; a world file with no home or two homes, a stream no file uses, or a copy that fails its hash stops the build. Both outputs are gitignored. */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const TYPES = require("./lib/file-types");

const WORLD = path.resolve(__dirname, "..", "standard", ".build", "world");
const PUBLIC = path.join(__dirname, "public");
const VAULT = path.join(PUBLIC, "vault");
const INDEX = path.join(PUBLIC, "vault.json");
const stop = (lines) => { console.error(`build-vault: ${[lines].flat().join("\n  ")}`); process.exit(1); };
const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

if (!fs.existsSync(path.join(WORLD, "manifest.json"))) stop("no world to copy. Run node standard/world/build.js first.");
const manifest = read(path.join(WORLD, "manifest.json"));
const brands = [...read(path.join(PUBLIC, "brands.json")), ...read(path.join(PUBLIC, "vault-brands.json"))];

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
if (problems.length) stop(problems);

fs.rmSync(VAULT, { recursive: true, force: true });
const files = manifest.files.map((f, i) => {
  const bytes = fs.readFileSync(path.join(WORLD, f.path));
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== f.sha256) stop(`${f.path} does not match the manifest. Rebuild the world.`);
  const rel = path.join(f.stream_id, f.download_date, f.name);
  fs.mkdirSync(path.join(VAULT, path.dirname(rel)), { recursive: true });
  fs.writeFileSync(path.join(VAULT, rel), bytes);
  return { brand: homes[i].brand, stream: f.stream_id, year: f.download_date.slice(0, 4), date: f.download_date, name: f.name, size: bytes.length, type: TYPES[path.extname(f.name)], path: `vault/${rel.split(path.sep).join("/")}`, sha256 };
});

const streams = shelves.map(({ brand, id, name }) => {
  const mine = files.filter((f) => f.brand === brand && f.stream === id).map((f) => f.date).sort();
  return { brand, id, name, files: mine.length, first: mine[0], last: mine[mine.length - 1] };
});
fs.writeFileSync(INDEX, `${JSON.stringify({ world: manifest.world, streams, files })}\n`);
console.log(`${files.length} files for ${new Set(files.map((f) => f.brand)).size} portals in public/vault`);
