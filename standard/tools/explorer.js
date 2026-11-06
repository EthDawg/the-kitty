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
// Each blind run as it was written, then the first household after repairs. A column is added when its file exists.
const heldout = (f) => {
  try {
    const t = fs.readFileSync(path.join(root, "eval", f), "utf8"), row = (name) => (t.split("\n").find((l) => l.startsWith(`| ${name} |`)) || "").split("|").map((c) => c.trim());
    const said = (re) => (t.match(re) || [])[1] || null, curve = (t.split("## What a person's answers buy")[1] || "").split("\n").filter((l) => /^\| \d/.test(l)).map((l) => l.split("|").map((c) => c.trim()));
    const traps = (row("Traps")[2] || "").match(/(\d+) handled, (\d+) flagged, (\d+) silently wrong, of (\d+)/) || [];
    return { income: row("Cash income")[2], spending: row("Spending")[2], worth: row("Net worth")[3], extra: said(/(\d+) extra legs/), extraCents: said(/extra legs worth (-?[\d,.]+)/), paired: said(/Own transfers paired as transfers: (\d+ of \d+)/), handled: traps[1], flagged: traps[2], silent: traps[3], of: traps[4], crash: /crashed on the setup/.test(t), curve };
  } catch (e) { return null; }
};
const blind = [["heldout/BLIND-1.md", "First"], ["heldout2/BLIND-2.md", "Second"], ["heldout3/BLIND-3.md", "Third"], ["heldout4/BLIND-4.md", "Fourth"], ["heldout5/BLIND-5.md", "Fifth"], ["heldout6/BLIND-6.md", "Sixth"], ["heldout7/BLIND-7.md", "Seventh"]].filter(([f]) => fs.existsSync(path.join(root, "eval", f))).map(([f, name]) => ({ name, ...heldout(f) }));
const data = { blind, view, ladder, sheet: sheet.skipped ? null : sheet, cold, recipes: recipes.length, families: new Set(manifest.files.map((f) => f.family)).size, recipe: JSON.stringify(sample, null, 1).slice(0, 1500) };
const tpl = fs.readFileSync(path.join(root, "site", "explorer.template.html"), "utf8");
fs.writeFileSync(out, tpl.replace("/*DATA*/", () => `window.DD=${JSON.stringify(data).replace(/</g, "\\u003c")};`));
console.log(`${out}: ${Math.round(fs.statSync(out).size / 1024)} KB`);
