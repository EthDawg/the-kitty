#!/usr/bin/env node
/* A check on the scorer, not on the engine. Builds a perfect stand-in for rebuild's output from the simulation's own book and scores it, so a trap that cannot pass even with every number right
   shows itself before the first run. Never reads the engine. node standard/eval/heldout6/standin.js */
"use strict";
const fs = require("fs"), path = require("path");
const { build, OUT } = require("./build");
const { report, loadSetup } = require("./run");

const built = build(), truth = JSON.parse(fs.readFileSync(path.join(OUT, "truth.json"), "utf8")), setup = loadSetup(), months = Object.keys(truth.income);
const code = { income: "I", spending: "S", neither: "N" };
const categories = [...setup.category, { category_id: "I", kind: "income", cash_lens: true }, { category_id: "S", kind: "expense", cash_lens: true }, { category_id: "N", kind: "transfer", cash_lens: false }];
const events = truth.cash_lines.map((x) => ({ kind: x.lens, category_id: x.category && x.lens !== "neither" ? x.category : code[x.lens], occurred_on: x.posted || x.date, charged_on: x.date, description: x.what, postings: [{ account_id: x.account, amount_cents: x.cents }], lines: [] }));
const rows = []; for (const [a, by] of Object.entries(truth.balances)) for (const m of months) rows.push({ account_id: a, month_end: `${m}-28`, balance_cents: by[m] });
const cashIds = setup.account.filter((a) => a.reporting_group === "cash").map((a) => a.account_id);
const netWorth = months.map((m) => ({ month: m, total: truth.networth[m], groups: { cash: cashIds.reduce((t, a) => t + truth.balances[a][m], 0) - truth.held_out_cash[m] } }));
const L = {
  bundleHash: "stand-in", categories, events, accounts: setup.account, balances: { rows }, netWorth, review: [],
  cash: months.map((m) => ({ month: m, income: truth.income[m], spending: truth.spending[m], unexplained: 0, byCategory: {} })),
  checks: [{ law: "L3", scope: "ACC-JOINT", status: "fail", detail: "stand-in: the interval ending 2025-03 disagrees", gap_cents: 0 }],
  coverage: [{ stream_id: "STM-CARD", have: 36, expected: 37, missing: ["2025-08"] }],
};
const r = { L, truth, intake: { sources: [], observations: [], unknown_files: [], faults: [] }, setup, built, again: () => L };
const out = report(r, { dry: true });
console.log(JSON.stringify(out.tally));
for (const t of out.traps.filter((x) => x.outcome !== "handled")) console.log(t.outcome, t.id, [...t.notes, ...t.bad].join("; ").slice(0, 240));
console.log(`lines ${out.rec.lines}, matched ${out.rec.matched}, extra ${out.rec.extra}, missing ${out.rec.missing}, own ${out.rec.own.paired} of ${out.rec.own.of}`);
