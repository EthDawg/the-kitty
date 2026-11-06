#!/usr/bin/env node
/* Build the explorer page from a replay: standard/.build/explorer.html. A page you can read without running anything. */
"use strict";
const fs = require("fs"), path = require("path");
const { build } = require("./view");
const root = path.join(__dirname, "..");
const out = process.argv[2] || path.join(root, ".build", "explorer.html");
const view = build();
const log = console.log; console.log = () => {};
const { main } = require("../eval/ladder");
const ladder = main().map((r) => ({ kind: r.kind, name: r.name, ok: r.ok }));
console.log = log;
const { parity } = require("../eval/sheet-parity");
const sheet = parity();
const read = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return null; } };
const cold = read(path.join(root, "eval", "coldstart.json"));
const recipes = fs.readdirSync(path.join(root, "recipes")).filter((f) => f.endsWith(".json"));
const sample = read(path.join(root, "recipes", "southern-activity-csv.json"));
const manifest = read(path.join(root, ".build", "world", "manifest.json"));
const data = { view, ladder, sheet: sheet.skipped ? null : sheet, cold, recipes: recipes.length, families: new Set(manifest.files.map((f) => f.family)).size, recipe: JSON.stringify(sample, null, 1).slice(0, 1500) };
const tpl = fs.readFileSync(path.join(root, "site", "explorer.template.html"), "utf8");
fs.writeFileSync(out, tpl.replace("/*DATA*/", () => `window.DD=${JSON.stringify(data).replace(/</g, "\\u003c")};`));
console.log(`${out}: ${Math.round(fs.statSync(out).size / 1024)} KB`);
