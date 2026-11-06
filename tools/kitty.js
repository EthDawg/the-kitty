#!/usr/bin/env node
/* The Kitty on a folder: the same core a page uses, with no dependencies.
     node tools/kitty.js init --name "Sam" --people "Sam"
     node tools/kitty.js add statement.csv [more files] [--account ACC-1234] [--name "Everyday"] [--type credit_card]
     node tools/kitty.js status
     node tools/kitty.js next
     node tools/kitty.js decide next GROCERIES [--always]    answers the step `next` printed
     node tools/kitty.js close 2026-07
     node tools/kitty.js recipe my-recipe.json statement.csv
     node tools/kitty.js guess statement.csv [--account "Everyday"] [--yes]   read an unknown bank file by its columns; --yes keeps the reading
   --dir picks the folder, default the current one. --today sets the clock, default the date here. --json prints what an agent wants. */
"use strict";
const fs = require("fs"), path = require("path");
const K = require("../src/household/node.js");

const FLAGS = new Set(["dir", "today", "name", "people", "account", "type", "reason", "reopen-if", "by", "check", "merchant"]);
const SWITCHES = new Set(["json", "always", "help", "yes"]);
function parse(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { out._.push(a); continue; }
    const k = a.slice(2);
    if (SWITCHES.has(k)) out[k] = true;
    else if (FLAGS.has(k) && argv[i + 1] !== undefined) out[k] = argv[++i];
    else throw Object.assign(new Error(`I don't know --${k}.`), { usage: true });
  }
  return out;
}
const localDate = () => new Date().toLocaleDateString("en-CA");
const fileOf = (p) => ({ name: path.basename(p), path: `added/${path.basename(p)}`, bytes: new Uint8Array(fs.readFileSync(p)) });
function say(args, value, lines) {
  if (args.json) console.log(JSON.stringify(value, null, 2));
  else for (const l of lines) console.log(l);
}
const step = (s) => [s.say, `Why: ${s.why}`, `Do: ${s.action.label}`, ...(s.action.choices ? [`Answer: kitty decide next <${s.action.choices.map((c) => c.id).join(" | ")}>`] : [])];

function addLines(r) {
  const out = [];
  for (const a of r.added) out.push(`Read ${a.name}: ${a.observations} lines, by ${a.recipe}.`);
  for (const a of r.already) out.push(`Already have ${a.name}. Nothing added.`);
  for (const a of r.accounts_created) out.push(`New account: ${a.name} (${a.account_id}). Rename it in account.jsonl any time.`);
  for (const a of r.needs_recipe) { out.push(`Can't read ${a.name} yet. ${a.ask}`, `  fingerprint ${a.fingerprint}`); for (const row of a.sample.rows) out.push(`  ${JSON.stringify(row)}`); for (const l of a.sample.lines) out.push(`  ${l}`); out.push(`  Then: node tools/kitty.js recipe my-recipe.json ${a.name}`); }
  for (const a of r.needs_agent) out.push(a.ask);
  for (const a of r.needs_account) out.push(`${a.ask} (--account <id>)`);
  for (const a of r.refused) out.push(`Refused ${a.name}. ${a.why}`);
  for (const a of r.unresolved) out.push(`Could not tell which account ${a.ref} is. ${a.kinds.join(", ")} lines from it wait in the store.`);
  for (const w of r.warnings) out.push(`Note: ${w}`);
  return out;
}
async function answer(store, args, today) {
  const [target, value] = args._.slice(1);
  const common = { reason: args.reason, reopen_if: args["reopen-if"], by: args.by };
  if (args.check) return K.decide(store, { check: args.check, ...common }, { today });
  if (target && target !== "next") return K.decide(store, { item: target, category_id: value, always: args.always, merchant: args.merchant, ...common }, { today });
  const s = await K.next(store, { today }), a = s.action.args || {};
  if (s.action.verb !== "decide") throw new Error(`The next step is not a question: ${s.say}`);
  if (a.item) return K.decide(store, { item: a.item, category_id: value, always: args.always, merchant: args.merchant, ...common }, { today });
  if (a.scope) return K.decide(store, { scope: { ...a.scope, state: value }, ...common }, { today });
  if (a.balance) return K.decide(store, { balance: { ...a.balance, cents: Math.round(Number(value) * 100) }, ...common }, { today });
  if (a.reopen) return K.decide(store, { reopen: a.reopen, ...common }, { today });
  if (a.hand_edit) return K.decide(store, { hand_edit: a.hand_edit, ...common }, { today });
  throw new Error("I don't know how to answer that step.");
}
async function main() {
  const args = parse(process.argv.slice(2)), [cmd, ...rest] = args._;
  const usage = fs.readFileSync(__filename, "utf8").split("*/")[0].replace("/* ", "").replace(/^#!.*\n/, "");
  if (!cmd || args.help) { console.log(usage); return cmd || args.help ? 0 : 2; }
  const store = K.folder(args.dir || process.cwd()), today = args.today || localDate();
  switch (cmd) {
    case "init": {
      const r = await K.init(store, { name: args.name, people: String(args.people || "").split(",").map((s) => s.trim()).filter(Boolean), today });
      say(args, r, r.already ? ["This folder is already a Kitty."] : [`Made a blank Kitty: ${r.household_id}. ${r.tabs.total} tables, no data.`, ...step(await K.next(store, { today }))]);
      return 0;
    }
    case "add": {
      if (!rest.length) throw Object.assign(new Error("Add what? Name a file."), { usage: true });
      const r = await K.add(store, rest.map(fileOf), { today, account: args.account, name: args.name, type: args.type });
      say(args, r, [...addLines(r), "", ...step(await K.next(store, { today }))]);
      return r.refused.length ? 1 : 0;
    }
    case "status": { const r = await K.status(store, { today }); say(args, r, r.words); return 0; }
    case "next": { const r = await K.next(store, { today }); say(args, r, step(r)); return 0; }
    case "decide": {
      const r = await answer(store, args, today);
      say(args, r, [r.added === false ? "Already decided. Nothing added." : "Noted.", "", ...step(await K.next(store, { today }))]);
      return 0;
    }
    case "close": {
      const month = rest[0] || ((await K.next(store, { today })).action.args || {}).month;
      if (!month) { console.log("No month is ready to close. Name one: close 2026-07."); return 1; }
      const r = await K.close(store, month, { today });
      say(args, r, [r.say, ...(r.rows_written ? [`Wrote ${r.rows_written} rows to ${r.tabs_written}.`] : []), "", ...step(await K.next(store, { today }))]);
      return ["locked", "closed", "already"].includes(r.status) ? 0 : 1;
    }
    case "recipe": {
      const [file, ...targets] = rest;
      if (!file) throw Object.assign(new Error("Which recipe?"), { usage: true });
      const r = await K.addRecipe(store, JSON.parse(fs.readFileSync(file, "utf8")), { today, files: targets.map(fileOf), account: args.account });
      const lines = r.status === "passed" ? ["The recipe passed the gate.", ...addLines(r.read)] : r.status === "failed" ? ["The recipe failed the gate. Nothing changed.", ...r.verdict.failures.slice(0, 8).map((x) => `  ${x.check}: ${x.what}`)] : [r.message, ...r.fingerprints_seen.map((f) => `  ${f}`)];
      say(args, r, lines);
      return r.status === "passed" ? 0 : 1;
    }
    case "guess": {
      if (!rest.length) throw Object.assign(new Error("Guess what? Name a file."), { usage: true });
      const file = fileOf(rest[0]), p = K.proposeRecipe({ ...file, stream: args.account });
      if (!p.recipe) { say(args, p, [`Couldn't read ${file.name} by its columns: ${p.why} Nothing changed.`]); return 1; }
      const out = [p.says.columns, p.says.proof, ...(p.says.dates ? [p.says.dates] : []), ...p.rows.map((r) => `  ${K.rowWords(r)}`)];
      if (!args.yes) { say(args, p, [...out, "Run it again with --yes to keep this reading."]); return 0; }
      const r = await K.addRecipe(store, p.recipe, { today, files: [file], account: args.account || "Everyday", name: args.account, author: "page" });
      say(args, r, r.status === "passed" ? [...out, ...addLines(r.read)] : ["The gate refused it. Nothing changed."]);
      return r.status === "passed" ? 0 : 1;
    }
    default: throw Object.assign(new Error(`I don't know ${cmd}.`), { usage: true });
  }
}
main().then((code) => { process.exitCode = code; }, (e) => { console.error(e && e.message ? e.message : e); process.exitCode = e && e.usage ? 2 : 1; });
