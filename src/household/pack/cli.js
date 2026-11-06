#!/usr/bin/env node
/* The pack from a command line, over the Davies world or any folder shaped like it.
     node src/household/pack/cli.js tax --person JORDAN --fy FY2024 --as-of 2024-08-05 --out dir
     node src/household/pack/cli.js takeback --person JORDAN --fy FY2024 --as-of 2024-08-05 --back 2024-09-30 --out dir
     node src/household/pack/cli.js lender --people JORDAN,MIA --as-of 2026-11-30 --out dir
     node src/household/pack/cli.js kit --fy FY2026 --out dir
     node src/household/pack/cli.js examples --out docs/examples
   The world must be built first: node standard/world/build.js */
"use strict";
const fs = require("fs"), path = require("path");
const K = require("./index.js"), NH = require("./node-host.js");

const flag = (args, n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const ensure = (d) => fs.mkdirSync(d, { recursive: true });

function save(result, dir) {
  ensure(dir);
  for (const p of result.parts) fs.writeFileSync(path.join(dir, p.name), p.bytes);
  return result.parts.map((p) => `${path.join(dir, p.name)}  ${K.bundle.size(p.size)}`);
}

function taxPack(hh, host, { person, fy, asOf, limit }) {
  const L = hh.at(asOf);
  const pack = K.tax.build({ L, reference: hh.reference, person, fy, asOf });
  const result = K.bundle.render(pack, host, { limit });
  K.bundle.assertNoTfn(result, host);
  return { L, pack, result };
}

function kitBytes(hh, host, fy) {
  const pack = K.blank.build({ fy, reference: hh.reference });
  const { book } = K.workbookTax.render(pack);
  return K.xlsx.write(book, { deflateRaw: host.deflateRaw, date: pack.as_of });
}

/* Everything public under docs/examples, in one run, so a rebuild can be compared with what is committed. The tricky year is FY2024: a second rental bought mid-year in one
   name, shares and crypto sold, a prior-year amendment landing inside the year. As of 5 August 2024: every statement in, the return not yet lodged. */
function examples(hh, host, out) {
  const made = [];
  ensure(path.join(out, "tax-pack"));
  const ties = {};
  for (const person of ["JORDAN", "MIA"]) {
    const { L, pack, result } = taxPack(hh, host, { person, fy: "FY2024", asOf: "2024-08-05" });
    made.push(...save(result, path.join(out, "tax-pack")));
    const expected = L.tax.estimates.find((e) => e.person === person && e.fy === "FY2024");
    ties[person] = { ties: result.ties, zip: result.parts[0].name, taxable_income_cents: expected.taxable_income_cents, result_cents: expected.result_cents, not_found_lines: pack.lines.filter((l) => l.state === "not_found").map((l) => l.id) };
  }
  const lender = K.lender.build({ L: hh.at("2026-11-30"), people: ["JORDAN", "MIA"], asOf: "2026-11-30" });
  const lr = K.bundle.render(lender, host, { stem: "Davies-lender-pack" });
  K.bundle.assertNoTfn(lr, host);
  ensure(path.join(out, "lender-pack"));
  made.push(...save(lr, path.join(out, "lender-pack")));
  ensure(path.join(out, "tax-kit"));
  const kit = path.join(out, "tax-kit", "The-Kitty-tax-kit-FY2026.xlsx");
  fs.writeFileSync(kit, kitBytes(hh, host, "FY2026"));
  made.push(`${kit}  ${K.bundle.size(fs.statSync(kit).size)}`);
  return { made, ties };
}

function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const hh = NH.household(), host = NH.host(hh.world), out = flag(args, "out", ".");
  if (cmd === "tax") {
    const { result } = taxPack(hh, host, { person: flag(args, "person"), fy: flag(args, "fy"), asOf: flag(args, "as-of"), limit: flag(args, "limit") ? Number(flag(args, "limit")) : undefined });
    console.log(save(result, out).join("\n"));
    for (const w of result.warnings) console.log(`Warning: ${w}`);
  } else if (cmd === "takeback") {
    const { pack } = taxPack(hh, host, { person: flag(args, "person"), fy: flag(args, "fy"), asOf: flag(args, "as-of") });
    const after = hh.at(flag(args, "back"));
    const next = K.takeback.take(pack, after, hh.reference);
    if (!next) { console.log("Nothing has come back for that year."); return; }
    const result = K.bundle.render(next, host);
    K.bundle.assertNoTfn(result, host);
    console.log(save(result, out).join("\n"));
    console.log(`${next.takeback.status}: taxable income draft ${K.pack.money(next.takeback.taxable.draft)}, lodged ${K.pack.money(next.takeback.taxable.lodged)}. Version ${next.version} written; version ${pack.version} is untouched.`);
  } else if (cmd === "lender") {
    const pack = K.lender.build({ L: hh.at(flag(args, "as-of")), people: flag(args, "people").split(","), asOf: flag(args, "as-of") });
    const result = K.bundle.render(pack, host);
    K.bundle.assertNoTfn(result, host);
    console.log(save(result, out).join("\n"));
  } else if (cmd === "kit") {
    ensure(out);
    const p = path.join(out, `The-Kitty-tax-kit-${flag(args, "fy", "FY2026")}.xlsx`);
    fs.writeFileSync(p, kitBytes(hh, host, flag(args, "fy", "FY2026")));
    console.log(p);
  } else if (cmd === "examples") {
    const { made, ties } = examples(hh, host, out);
    if (flag(args, "ties")) fs.writeFileSync(flag(args, "ties"), JSON.stringify(ties, null, 1));
    console.log(made.join("\n"));
  } else {
    console.log("Commands: tax, takeback, lender, kit, examples. See the top of this file.");
    process.exitCode = 1;
  }
}

if (require.main === module) main();
module.exports = { examples, taxPack, kitBytes };
