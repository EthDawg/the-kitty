/* The gate, SPEC 7.2. It does not care who wrote a recipe. A recipe passes for a file family only if, over every file: every row is consumed or
   explicitly skipped; every required field parses and the date order is proved; the sign rule is proved by the balance chain where there is one;
   stated control totals tie; and the output is the same on a shuffled row order and on a repeated run. Returns a structured verdict. Pure. */
"use strict";
const { run, parseDate, AMBIGUOUS } = require("./recipe");

// order-free: keys sorted, and arrays inside a payload compared as sets of rows
const stable = (v) => { if (Array.isArray(v)) return `[${v.map(stable).sort().join(",")}]`; if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`; return JSON.stringify(v); };
const canon = (o) => stable([o.kind, o.payload]);
const bag = (obs) => obs.map(canon).sort();
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

function gate(recipe, files, opts) {
  const v = { recipe: recipe.id, version: recipe.version || 1, family: recipe.family || recipe.id, files: files.length, observations: 0, status: "pass", checks: { rows: "pass", fields: "pass", date_order: "not_applicable", sign: "no_chain", controls: "pass", stable: "pass" }, failures: [], proofs: {} };
  const fail = (check, file, what) => { v.checks[check] = "fail"; v.status = "fail"; if (v.failures.length < 40) v.failures.push({ check, file, what }); };
  const dateTokens = []; const statements = []; let signProof = null, dateByChain = false, anyAmounts = false;
  for (const f of files) {
    const o = { vocab: opts.vocab, stream: f.stream };
    const a = run(recipe, f.decoded, o);
    v.observations += a.observations.length;
    for (const u of a.unconsumed) fail("rows", f.path, `${u.locator}: not consumed: ${u.text}`);
    for (const x of a.faults) fail(/^bad_date/.test(x.code) ? "date_order" : "fields", f.path, `${x.locator}: ${x.code} ${x.what}`);
    for (const c of a.controls) {
      if (!c.pass) fail((c.proves || []).includes("sign") && c.law === "balance_chain" ? "sign" : "controls", f.path, `${c.law}${c.name ? ` ${c.name}` : ""} failed ${JSON.stringify({ bad: c.bad, gap: c.gap, got: c.got, want: c.want })}`);
      else if ((c.proves || []).includes("sign") && c.checked) { signProof = signProof || c.law; if (c.law === "balance_chain") dateByChain = true; }
    }
    if (a.observations.some((x) => x.kind === "txn_line")) anyAmounts = true;
    dateTokens.push(...a.dates);
    statements.push(...a.observations.filter((x) => x.kind === "statement").map((x) => ({ ...x.payload, file: f.path })));
    // repeated run, and a shuffled row order
    const b = run(recipe, f.decoded, o);
    if (!same(bag(a.observations), bag(b.observations))) fail("stable", f.path, "a repeat run differs");
    const plain = a.observations.filter((x) => !(x.kind === "statement" && recipe.statement));
    const s = run(recipe, f.decoded, { ...o, shuffle: opts.seed || 20190301 });
    if (!same(bag(plain), bag(s.observations.filter((x) => !(x.kind === "statement" && recipe.statement))))) fail("stable", f.path, "a shuffled row order differs");
  }
  // date order: a day above 12 somewhere, or a balance chain that held
  if (dateTokens.length) {
    const fmts = [...new Set(dateTokens.map((t) => t.fmt))];
    for (const fmt of fmts) {
      const toks = dateTokens.filter((t) => t.fmt === fmt), other = AMBIGUOUS[fmt];
      const breaking = toks.find((t) => parseDate(t.token, other) == null);
      if (breaking) v.proofs.date_order = `${breaking.token} cannot be read as ${other}`;
      else if (dateByChain) v.proofs.date_order = "balance chain holds in file order";
      else { fail("date_order", null, `nothing in the family separates ${fmt} from ${other}`); continue; }
    }
    if (v.checks.date_order !== "fail") v.checks.date_order = "pass";
  } else if (v.checks.date_order !== "fail") v.checks.date_order = "unambiguous";
  // statements chain across the family: each closing is the next opening
  const fam = (recipe.controls || []).find((c) => c.law === "family_chain");
  if (fam) {
    const byAcct = {}; for (const s of statements) (byAcct[s.account_ref] = byAcct[s.account_ref] || []).push(s);
    let checked = 0;
    for (const list of Object.values(byAcct)) {
      list.sort((a, b) => (a.period_end < b.period_end ? -1 : a.period_end > b.period_end ? 1 : 0));
      for (let i = 1; i < list.length; i++) { checked += 1; if (list[i - 1].closing_cents !== list[i].opening_cents) fail("controls", list[i].file, `family chain: ${list[i - 1].closing_cents} then ${list[i].opening_cents}`); }
    }
    if (checked) signProof = signProof || "family_chain";
  }
  if (v.checks.sign !== "fail") { if (signProof) { v.checks.sign = "pass"; v.proofs.sign = signProof; } else if (!anyAmounts) v.checks.sign = "not_applicable"; }
  return v;
}

module.exports = { gate };
