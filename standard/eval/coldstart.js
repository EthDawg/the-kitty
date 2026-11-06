#!/usr/bin/env node
/* Cold start. A cheap model is given one sample file per family and the recipe spec, and nothing else. It writes the recipe. The gate
   judges it over every file in the family. One repair is allowed, with the gate's complaint as feedback. Tokens are measured.
   node standard/eval/coldstart.js --model claude-haiku-5-5 [--families a,b] [--write]
   Uses the local `claude` CLI. The sample is fictional. Spends real tokens, so it is never part of CI. */
"use strict";
const fs = require("fs"), path = require("path");
const { spawnSync } = require("child_process");
const I = require("../intake");
const { fingerprint } = require("../intake/fingerprint");
const { decode } = require("../intake/containers");
const { gate } = require("../intake/gate");

const root = path.join(__dirname, ".."), world = path.join(root, ".build", "world");
const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const model = arg("model", "claude-haiku-5-5");
const only = arg("families", null);
const manifest = JSON.parse(fs.readFileSync(path.join(world, "manifest.json"), "utf8"));
const spec = fs.readFileSync(path.join(root, "RECIPES.md"), "utf8");
const card = fs.readFileSync(path.join(root, "generated", "schema-card.md"), "utf8");
const vocab = I.loadVocab(), inflate = I.hostInflate();
const golden = Object.fromEntries(I.loadRecipes(path.join(root, "recipes")).map((r) => [r.id, r]));

function sampleText(d, f) {
  if (d.rows) return `container: ${d.meta && d.meta.container}\nrows (first 14 of ${d.rows.length}), as JSON arrays:\n` + d.rows.slice(0, 14).map((r) => JSON.stringify(r)).join("\n");
  const lines = d.lines || [];
  return `container: ${d.meta && d.meta.container}\nlines (first 70 of ${lines.length}), text with double-space cell gaps:\n` + lines.slice(0, 70).map((l) => l.text).join("\n");
}
function ask(prompt) {
  // No project context, no tools, no MCP: the prompt is the whole of what the model sees, so the token count is honest.
  const r = spawnSync("claude", ["-p", "--model", model, "--output-format", "json", "--tools", "", "--strict-mcp-config", "--setting-sources", "", "--system-prompt", "You write JSON recipes. Answer with JSON only.", "--no-session-persistence"], { input: prompt, encoding: "utf8", maxBuffer: 1 << 26, cwd: require("os").tmpdir() });
  if (r.status !== 0) return { error: (r.stderr || r.stdout || "").slice(0, 300) };
  const j = JSON.parse(r.stdout);
  const u = j.usage || {};
  return { text: j.result, tokens_in: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0), tokens_out: u.output_tokens || 0, usd: j.total_cost_usd || 0 };
}
const parse = (t) => { const m = /```(?:json)?\s*([\s\S]*?)```/.exec(t); return JSON.parse((m ? m[1] : t).trim()); };

const families = [...new Set(manifest.files.filter((f) => f.tier === "recipe").map((f) => f.family))].filter((f) => !only || only.split(",").includes(f));
const results = [];
const cap = Number(arg("max-usd", "12"));
for (const family of families) {
  if (results.reduce((a, r) => a + r.usd, 0) >= cap) { console.log(`Stopped at the US$${cap} cap.`); break; }
  const files = manifest.files.filter((f) => f.family === family);
  const decoded = files.map((f) => { const bytes = new Uint8Array(fs.readFileSync(path.join(world, f.path))); const d = decode(bytes, { inflate }); return { path: f.path, stream: f.stream_id, decoded: d, bytes }; });
  // Two samples, far apart in the family: a value that only some files state shows up here, not in the gate's complaint.
  const sample = decoded[Math.floor(decoded.length / 2)], other = decoded[decoded.length - 1], third = decoded[0];
  const fp = fingerprint(sample.decoded);
  const kinds = [...new Set(files.flatMap((f) => Object.keys(f.by_kind || {})))];
  const prompt = `You write one recipe: JSON data that reads one family of financial files. No code. Answer with the JSON recipe only.\n\n# How recipes work\n${spec}\n\n# What observations look like\n${card}\n\n# This family\nid: ${family}\nfingerprint: ${fp}\nIt must emit these observation kinds: ${kinds.join(", ")}\n${files.length} files in the family. Three samples, far apart. Where a value is not in the file at all, use a stream or file-level default rather than a required field the file cannot give.\n\nSample 1:\n${sampleText(sample.decoded, sample)}\n\nSample 2:\n${sampleText(other.decoded, other).slice(0, 2500)}\n\nSample 3:\n${sampleText(third.decoded, third).slice(0, 2500)}`;
  let tries = 0, tokensIn = 0, tokensOut = 0, usd = 0, verdict = null, recipe = null, err = null, feedback = "";
  const maxTries = Number(arg("tries", "3"));
  while (tries < maxTries) {
    tries += 1;
    const a = ask(prompt + feedback);
    if (a.error) { err = a.error; break; }
    tokensIn += a.tokens_in; tokensOut += a.tokens_out; usd += a.usd;
    try {
      recipe = parse(a.text);
      recipe.id = recipe.id || family; recipe.fingerprints = recipe.fingerprints || [fp];
      verdict = gate(recipe, decoded, { vocab, inflate });
      if (verdict.status === "pass") break;
      feedback = `\n\nYour last recipe was:\n${JSON.stringify(recipe)}\n\nThe gate refused it:\n${JSON.stringify(verdict.failures.slice(0, 6))}\nFix it. Answer with the JSON recipe only.`;
    } catch (e) { feedback = `\n\nThat was not valid. ${e.message}. Answer with the JSON recipe only.`; verdict = { status: "fail", failures: [{ what: e.message }] }; }
  }
  const row = { family, files: files.length, tries, status: verdict ? verdict.status : "error", tokens_in: tokensIn, tokens_out: tokensOut, usd: +usd.toFixed(4), why: verdict && verdict.status !== "pass" ? JSON.stringify(verdict.failures.slice(0, 2)).slice(0, 240) : err };
  results.push(row);
  console.log(`${row.status.padEnd(5)} ${family.padEnd(34)} tries ${tries}  ${tokensIn}+${tokensOut} tokens  $${row.usd}${row.why ? `  ${row.why}` : ""}`);
}
const sum = (k) => results.reduce((s, r) => s + r[k], 0);
const out = { model, families: results.length, passed: results.filter((r) => r.status === "pass").length, tokens_in: sum("tokens_in"), tokens_out: sum("tokens_out"), usd: +sum("usd").toFixed(3), results };
console.log(`\n${out.passed} of ${out.families} families passed the gate. ${out.tokens_in} in, ${out.tokens_out} out, $${out.usd}.`);
if (args.includes("--write")) fs.writeFileSync(path.join(__dirname, "coldstart.json"), JSON.stringify(out, null, 1) + "\n");
void golden;
