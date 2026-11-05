#!/usr/bin/env node
/* The host half of the parity proof: import_month.py's command line over src/core. Reads sources/ and the month inputs as a host would,
   calls the core, and writes what Python writes (review.md, write-plan.json, rows.json, entries.json, *.held.json). Reads only local
   files. `verify` mirrors verify.py. KITTY_CORE points at another copy of src/core, for the mutation check. */
"use strict";
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const ROOT = path.resolve(__dirname, "..");
const P = require(path.resolve(process.env.KITTY_CORE || path.join(ROOT, "src/core"), "period-core.js"));

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
const bool = (name) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
const dump = (v) => JSON.stringify(v, null, 1) + "\n";

function pdfLines(file) {
  const py = "import sys,json\nsys.path.insert(0,sys.argv[1])\nimport pdftext\ntry:\n    print(json.dumps({'lines':[c for _,_,c in pdftext.text(sys.argv[2])]}))\nexcept ValueError as e:\n    print(json.dumps({'error':str(e).split(': ',1)[-1]}))\n";
  return JSON.parse(execFileSync(process.env.PYTHON || "python3", ["-I", "-c", py, path.join(ROOT, "period-close"), file], { encoding: "utf8" }));
}

function walk(root) {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return null;
  const files = [];
  const visit = (abs, rel, depth) => {
    for (const name of fs.readdirSync(abs)) {
      const a = path.join(abs, name), r = rel ? `${rel}/${name}` : name, dir = fs.statSync(a).isDirectory();
      if (dir) { files.push({ path: r, is_dir: true }); if (depth < 2) visit(a, r, depth + 1); continue; }
      if (name.toLowerCase().endsWith(".pdf") && depth === 2) {
        const got = pdfLines(a);
        files.push(got.error ? { path: r, pdf_error: got.error } : { path: r, pdf_lines: got.lines });
      } else if (depth === 0) continue; // a stray file beside the account folders: see the allowlist
      else files.push({ path: r, bytes: new Uint8Array(fs.readFileSync(a)) });
    }
  };
  visit(root, "", 0);
  return files;
}

function main() {
  if (args[0] === "verify") {
    args.shift();
    const preconditions = bool("--preconditions"), include_deferred = bool("--include-deferred");
    const plan = JSON.parse(fs.readFileSync(args[0], "utf8")), reread = JSON.parse(fs.readFileSync(args[1], "utf8"));
    const r = P.verify(plan, reread, { preconditions, include_deferred });
    process.stdout.write(r.lines.join("\n") + "\n");
    process.exit(r.exit);
  }
  const shuffle = bool("--shuffle");
  const jsOut = flag("--js-out"), sheetPath = flag("--sheet"), sourcesDir = flag("--sources"), out = flag("--out"), inputsDir = flag("--inputs"), asOf = flag("--as-of"), loans = flag("--loans"), sheetId = flag("--sheet-id"), history = flag("--history");
  const floor = flag("--transaction-id-floor");
  bool("--dry-run");
  const months = args[0];
  const list = months.includes("..") ? P.adapters && require(path.resolve(process.env.KITTY_CORE || path.join(ROOT, "src/core"), "period-plan.js")).monthsOf(months) : [months];
  const dirs = inputsDir ? [inputsDir].concat(list.length > 1 ? list.map((m) => path.join(inputsDir, m)) : []) : [out];
  const shown = (p) => { const a = path.resolve(p); return a.startsWith(ROOT) ? path.relative(ROOT, a) : p; };
  const inputs = [];
  for (const kind of ["overrides", "valuations", "payslips"]) for (const d of dirs) {
    const p = path.join(d, `${kind}.csv`);
    if (fs.existsSync(p)) inputs.push({ path: p, shown: shown(p), kind, text: fs.readFileSync(p, "utf8") });
  }
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, "kitty.config.json"), "utf8"));
  const files = walk(sourcesDir);
  if (shuffle && files) files.reverse(); // input order must never matter
  const r = P.plan({ months, sheet: JSON.parse(fs.readFileSync(sheetPath, "utf8")), files, inputs, options: { as_of: asOf, loans: loans || "defer", sheet_id: sheetId, transaction_id_floor: floor === undefined ? undefined : Number(floor),
    snapshot_label: sheetPath, sources_label: sourcesDir, allow_v1: true, default_sheet_ids: { v1: config.demo_sheet, v2: config.v2_sheet }, history: history ? JSON.parse(fs.readFileSync(history, "utf8")).Transactions.slice(1) : undefined } });
  fs.mkdirSync(jsOut, { recursive: true });
  const live = r.exit === 0;
  fs.writeFileSync(path.join(jsOut, "review.md"), r.review_md);
  fs.writeFileSync(path.join(jsOut, "write-plan.json"), dump(r.plan));
  fs.writeFileSync(path.join(jsOut, "rows.json"), dump(live ? r.rows_payload : []));
  fs.writeFileSync(path.join(jsOut, "entries.json"), dump(live ? r.entries_payload : []));
  if (r.exit === 2) { fs.writeFileSync(path.join(jsOut, "rows.held.json"), dump(r.rows_payload)); fs.writeFileSync(path.join(jsOut, "entries.held.json"), dump(r.entries_payload)); }
  process.exit(r.exit);
}
main();
