#!/usr/bin/env node
/* Does the Sheet agree with the engine? Builds the workbook, recalculates its live formulas in LibreOffice, and compares every month.
   Two independent evaluators of one ledger. Skips with a note if soffice is not installed. `node standard/eval/sheet-parity.js` */
"use strict";
const fs = require("fs"), path = require("path"), os = require("os");
const { execFileSync, spawnSync } = require("child_process");
const { workbook } = require("../tools/xlsx-writer");
const { build } = require("../tools/workbook");
const { run } = require("./run");

function parity() {
  if (spawnSync("soffice", ["--version"]).status !== 0) return { skipped: "soffice not installed" };
  const { L } = run();
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "dd-parity-"));
  const setup = {}; const sd = path.join(__dirname, "..", ".build", "world", "setup");
  for (const f of fs.readdirSync(sd)) setup[f.replace(".json", "")] = JSON.parse(fs.readFileSync(path.join(sd, f), "utf8"));
  const xlsx = path.join(dir, "dd.xlsx");
  fs.writeFileSync(xlsx, workbook(build(L, setup)));
  execFileSync("soffice", ["--headless", "--convert-to", "csv:Text - txt - csv (StarCalc):44,34,76,1,,0,false,true,false,false,false,-1", "--outdir", dir, xlsx], { stdio: "ignore" });
  const table = (name) => fs.readFileSync(path.join(dir, `dd-${name}.csv`), "utf8").trim().split("\n").map((l) => l.split(","));
  const cents = (s) => Math.round(Number(s) * 100);
  let checked = 0; const miss = [];
  const nw = new Map(L.netWorth.map((r) => [r.month, r]));
  const [nh, ...nrows] = table("Net Worth");
  for (const r of nrows) {
    const e = nw.get(r[0]);
    if (!e) continue;
    nh.slice(1, -1).forEach((g, i) => { checked += 1; if (cents(r[i + 1]) !== (e.groups[g] || 0)) miss.push([r[0], g, r[i + 1], e.groups[g]]); });
    // The workbook sums what sits on accounts. Money in the air between two places is the engine's own line.
    const onAccounts = e.total - (e.groups.unsettled || 0);
    checked += 1; if (cents(r[r.length - 1]) !== onAccounts) miss.push([r[0], "total", r[r.length - 1], onAccounts]);
  }
  const cash = new Map(L.cash.map((r) => [r.month, r]));
  const [, ...crows] = table("Cash Flow");
  for (const r of crows) {
    const e = cash.get(r[0]) || { income: 0, spending: 0, unexplained: 0, net: 0 };
    for (const [i, k] of [[1, "income"], [2, "spending"], [3, "unexplained"], [4, "net"]]) { checked += 1; if (cents(r[i]) !== e[k]) miss.push([r[0], k, r[i], e[k]]); }
  }
  fs.rmSync(dir, { recursive: true, force: true });
  return { checked, exact: checked - miss.length, misses: miss.slice(0, 6) };
}
if (require.main === module) { const r = parity(); console.log(r.skipped ? `Skipped: ${r.skipped}` : `Sheet formulas against the engine: ${r.exact} of ${r.checked} exact.${r.misses.length ? ` ${JSON.stringify(r.misses)}` : ""}`); process.exitCode = r.misses && r.misses.length ? 1 : 0; }
module.exports = { parity };
