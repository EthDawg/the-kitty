#!/usr/bin/env node
/* The ladder. The household did not change, so the answer must not change. Each presentation rung mangles how the same facts are
   delivered and must land on the same bundle hash. Each semantic rung breaks one thing and must raise the right alarm, in the
   right place, and nowhere else. All of it runs in memory over the world's files. `node standard/eval/ladder.js [--log]` */
"use strict";
const fs = require("fs"), path = require("path");
const { rebuild } = require("../engine/rebuild");
const I = require("../intake");
const Engine = require("../../src/engine.js");

const root = path.join(__dirname, ".."), world = path.join(root, ".build", "world");
const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return d; } };
Engine.loadMerchants({ merchants: readJson(path.join(root, "..", "merchants", "merchants.json")), categories: readJson(path.join(root, "..", "merchants", "categories.json")) });
const recipes = I.loadRecipes(path.join(root, "recipes")), vocab = I.loadVocab(), inflate = I.hostInflate();
const manifest = readJson(path.join(world, "manifest.json"));
const setup = {}; for (const f of fs.readdirSync(path.join(world, "setup"))) setup[f.replace(".json", "")] = readJson(path.join(world, "setup", f), []);
const decisions = readJson(path.join(world, "decisions", "person.json"), []), rules = readJson(path.join(world, "decisions", "rules.json"), []);
const schema = { events: readJson(path.join(root, "schema", "events.json")) };
const reference = readJson(path.join(root, "reference", "au.json"), null);
const base = I.walkRoot(world);

const text = (f) => Buffer.from(f.bytes).toString("utf8");
const withText = (f, t, patch = {}) => ({ ...f, ...patch, bytes: new Uint8Array(Buffer.from(t, "utf8")) });
const isFamily = (f, fam) => (manifestByPath.get(f.path) || {}).family === fam;
const manifestByPath = new Map(manifest.files.map((m) => [m.path, m]));
const csvFiles = (fs_) => fs_.filter((f) => /\.csv$/i.test(f.name) && /sources\/ACC-/.test(f.path) && isFamily(f, "harbour-txn-csv"));

function rebuildFiles(files, extra = {}) {
  const intake = I.ingestFiles(files, { recipes, vocab, inflate, manifest: extra.manifest ?? null });
  const L = rebuild({ setup, sources: intake.sources, observations: intake.observations, decisions: extra.decisions ?? decisions, rules, schema, reference });
  return { L, intake };
}
const baseline = rebuildFiles(base);
const cents = (L) => JSON.stringify(L.netWorth[L.netWorth.length - 1]);
const stat = (L, law, scope) => L.checks.filter((c) => c.law === law && (!scope || String(c.scope).includes(scope))).map((c) => c.status);

const presentation = [
  ["files arrive in reverse order", (fs_) => [...fs_].reverse()],
  ["every file is downloaded twice, byte-identical", (fs_) => [...fs_, ...fs_.map((f) => ({ ...f, name: f.name.replace(/(\.\w+)$/, " (1)$1"), path: f.path.replace(/(\.\w+)$/, " (1)$1") }))]],
  ["every bank CSV is delivered a second time with Windows line endings", (fs_) => [...fs_, ...csvFiles(fs_).map((f) => withText(f, text(f).replace(/\r?\n/g, "\r\n"), { name: `crlf-${f.name}`, path: f.path.replace(f.name, `crlf-${f.name}`) }))]],
  ["bank CSVs carry a byte-order mark", (fs_) => fs_.map((f) => (csvFiles([f]).length ? withText(f, `﻿${text(f)}`) : f))],
  ["bank exports overlap: each month also arrives inside a rolling quarter", (fs_) => {
    const csv = csvFiles(fs_).sort((a, b) => (a.path < b.path ? -1 : 1));
    const byStream = new Map();
    for (const f of csv) { if (!byStream.has(f.stream)) byStream.set(f.stream, []); byStream.get(f.stream).push(f); }
    const extra = [];
    for (const [, list] of byStream) for (let i = 0; i + 2 < list.length; i++) {
      const parts = list.slice(i, i + 3).map((f) => text(f).split(/\r?\n/).filter(Boolean));
      const body = [parts[0][0], ...parts.flatMap((p) => p.slice(1))].join("\n") + "\n";
      extra.push(withText(list[i + 2], body, { name: `rolling-${list[i + 2].name}`, path: list[i + 2].path.replace(list[i + 2].name, `rolling-${list[i + 2].name}`) }));
    }
    return [...fs_, ...extra];
  }],
  ["bank CSV rows run newest first", (fs_) => fs_.map((f) => { if (!csvFiles([f]).length) return f; const r = text(f).split(/\r?\n/).filter(Boolean); return withText(f, [r[0], ...r.slice(1).reverse()].join("\n") + "\n"); })],
];

const pick = (fs_, re) => fs_.filter((f) => re.test(f.path)).sort((a, b) => (a.path < b.path ? -1 : 1));
const editRow = (f, change) => { const r = text(f).split(/\r?\n/); const i = r.findIndex((l, n) => n > 0 && l && change.when(l)); r[i] = change.to(r[i]); return withText(f, r.join("\n")); };

const semantic = [
  ["one month of statements goes missing", (fs_) => { const g = pick(fs_, /sources\/ACC-EVD\/.*2023-05/); return fs_.filter((f) => !g.includes(f)); },
    (L) => (stat(L, "L3", "ACC-EVD").includes("gap") && !stat(L, "L3", "ACC-CC").includes("fail") ? null : "expected a gap on ACC-EVD and nothing on the card")],
  ["one amount is misread by $10", (fs_) => { const f = pick(fs_, /sources\/ACC-EVD\/.*2024-0[34]/).find((x) => /\.csv$/.test(x.name)); return fs_.map((x) => (x === f ? editRow(x, { when: (l) => /,\d+\.\d\d,,\d/.test(l), to: (l) => l.replace(/,(\d+\.\d\d),,(\d)/, (m, a, b2) => `,${(Number(a) + 10).toFixed(2)},,${b2}`) }) : x)); },
    (L) => (stat(L, "L3", "ACC-EVD").includes("fail") ? null : "expected L3 to fail on ACC-EVD")],
  ["a row is repeated inside one file", (fs_) => { const f = pick(fs_, /sources\/ACC-EVD\/.*2024-0[56]/).find((x) => /\.csv$/.test(x.name)); return fs_.map((x) => { if (x !== f) return x; const r = text(x).split(/\r?\n/).filter(Boolean); r.splice(3, 0, r[2]); return withText(x, r.join("\n") + "\n"); }); },
    (L) => (stat(L, "L3", "ACC-EVD").includes("fail") ? null : "expected L3 to fail on ACC-EVD")],
  ["a payslip goes missing", (fs_) => { const f = pick(fs_, /sources\/PAY-J\/.*Payslip/)[40]; return fs_.filter((x) => x !== f); },
    (L, B) => (L.cash.find((m) => m.month === "2022-08") && JSON.stringify(L.cash.map((m) => m.net)) === JSON.stringify(B.cash.map((m) => m.net)) ? null : "cash lens should not move when a payslip is missing")],
  ["a bank moves a date column to US order", (fs_) => { const f = csvFiles(fs_)[100]; return fs_.map((x) => (x === f ? withText(x, text(x).replace(/\b(\d{2})\/(\d{2})\/(\d{4})\b/g, "$2/$1/$3")) : x)); },
    (L, B, intake) => (intake.faults.length ? null : "expected the recipe to refuse a date it cannot read")],
  ["a bank renames a column", (fs_) => { const list = csvFiles(fs_); const f = list[50]; return fs_.map((x) => (x === f ? withText(x, text(x).replace("Narrative", "Details")) : x)); },
    (L, B, intake) => (intake.unknown_files.some((u) => u.reason === "no_recipe") ? null : "expected an unknown file, never a guess")],
];

function main() {
  const out = [];
  const b = baseline.L;
  console.log(`Baseline bundle ${b.bundleHash}: ${b.events.length} events.\n\nPresentation: the household did not change, so the hash must not.`);
  for (const [name, mutate] of presentation) {
    const t = process.hrtime.bigint();
    const { L } = rebuildFiles(mutate(base));
    const ok = L.bundleHash === b.bundleHash;
    out.push({ kind: "presentation", name, ok });
    console.log(`  ${ok ? "same" : "DIFF"}  ${name}  (${(Number(process.hrtime.bigint() - t) / 1e9).toFixed(1)}s)${ok ? "" : `  ${L.events.length} events, ${cents(L)}`}`);
  }
  console.log(`\nSemantic: one thing breaks; the right alarm rings in the right place.`);
  for (const [name, mutate, verdict] of semantic) {
    const { L, intake } = rebuildFiles(mutate(base));
    const why = verdict(L, b, intake);
    out.push({ kind: "semantic", name, ok: !why, why });
    console.log(`  ${why ? "MISS" : "rang"}  ${name}${why ? `: ${why}` : ""}`);
  }
  const pass = out.filter((r) => r.ok).length;
  console.log(`\n${pass} of ${out.length} rungs hold.`);
  return out;
}
if (require.main === module) { const r = main(); process.exitCode = r.every((x) => x.ok) ? 0 : 1; }
module.exports = { main };
