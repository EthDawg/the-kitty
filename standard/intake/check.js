#!/usr/bin/env node
/* node standard/intake/check.js <recipe.json> <file or folder>...: run the gate over files, whoever wrote the recipe. Prints the verdict; exits 1 when it fails. */
"use strict";
const fs = require("fs");
const path = require("path");
const { decode } = require("./containers");
const { fingerprint } = require("./fingerprint");
const { gate } = require("./gate");
const { hostInflate, loadVocab } = require("./index");

const [recipePath, ...targets] = process.argv.slice(2);
if (!recipePath || !targets.length) { console.error("usage: node standard/intake/check.js <recipe.json> <file or folder>..."); process.exit(2); }
const recipe = JSON.parse(fs.readFileSync(recipePath, "utf8")), inflate = hostInflate(), files = [];
const walk = (p) => { if (fs.statSync(p).isDirectory()) for (const n of fs.readdirSync(p).sort()) { if (!n.startsWith(".")) walk(path.join(p, n)); } else files.push(p); };
targets.forEach(walk);
const decoded = files.map((p) => { const parts = p.split(path.sep), at = parts.lastIndexOf("sources"); return { path: p, stream: at >= 0 ? parts[at + 1] : path.basename(path.dirname(p)), decoded: decode(new Uint8Array(fs.readFileSync(p)), { inflate }) }; });
const v = gate(recipe, decoded, { vocab: loadVocab() });
const seen = [...new Set(decoded.map((f) => fingerprint(f.decoded)))], missing = seen.filter((f) => !(recipe.fingerprints || []).includes(f));
console.log(JSON.stringify({ ...v, fingerprints_seen: seen, fingerprints_missing: missing }, null, 1));
process.exit(v.status === "pass" ? 0 : 1);
