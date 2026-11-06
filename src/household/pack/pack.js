/* A pack answers one question from one audience with lines, the evidence behind each line, and the gaps. One data shape, however it
   renders. Tax is the first instance; lender.js is the second, and it is why scope holds people and a period rather than one person and a year.
   Money is whole cents. A value that is not known is null, never 0: `nil` means someone can show it is nothing, `not_found` means nobody can yet. */
(function (root, name, deps, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(...deps.map((d) => require(`./${d}.js`)));
  else { const K = (root.KittyPack = root.KittyPack || {}); K[name] = factory(...deps.map((d) => K[d])); }
})(typeof self !== "undefined" ? self : this, "pack", [], function () {
  "use strict";
  const STANDARD = "household-pack/1";
  const STATES = ["value", "nil", "not_found", "not_asked"];       // what is known about the number
  const EVIDENCE = ["held", "at_risk", "missing", "not_needed"];   // what stands behind it
  const OWNERS = ["taxpayer", "accountant", "household", "lender"];

  // A line in one call. Anything an instance needs beyond this goes in `fields`, so a renderer can add a column without a new shape.
  function line(o) {
    const known = o.amount_cents !== null && o.amount_cents !== undefined;
    return {
      id: o.id, section: o.section, label: o.label ?? null, engine: o.engine ?? null, name: o.name,
      amount_cents: known ? o.amount_cents : null, unit: o.unit || "aud", basis: o.basis || "flow", as_at: o.as_at ?? null,
      state: o.state || (known ? "value" : "not_found"), nil_basis: o.nil_basis ?? null,
      kind: o.kind || "entered", indicative: !!o.indicative,
      fields: o.fields || {}, evidence: o.evidence || [],
      evidence_state: o.evidence_state || (o.evidence && o.evidence.length ? "held" : "missing"), note: o.note ?? null,
    };
  }

  const rank = { missing: 3, at_risk: 2, held: 1, not_needed: 0 };
  const worst = (states) => states.reduce((w, s) => (rank[s] > rank[w] ? s : w), "not_needed");

  function make(o) {
    return {
      standard: STANDARD, kind: o.kind, id: o.id, version: o.version || 1, supersedes: o.supersedes || null,
      state: o.state || "draft", question: o.question, audience: o.audience, scope: o.scope, as_of: o.as_of,
      boundary: o.boundary || [], headline: o.headline || [], parameters: o.parameters || [], lines: o.lines, evidence: o.evidence, gaps: o.gaps, notes: o.notes || [],
    };
  }

  // Keys sorted, so the same pack is the same text wherever it is built.
  function canonical(v) {
    if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
    if (v && typeof v === "object") return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
    return JSON.stringify(v ?? null);
  }

  /* The promises of the shape, checked on every pack of every kind. A failure is a bug in the instance, so it throws. */
  function validate(p) {
    const bad = [];
    if (p.standard !== STANDARD) bad.push(`standard is ${p.standard}`);
    for (const k of ["question", "audience", "as_of"]) if (!p[k]) bad.push(`no ${k}`);
    if (!p.scope || !Array.isArray(p.scope.people) || !p.scope.people.length) bad.push("scope needs people");
    if (!p.scope || !p.scope.period || !p.scope.period.from || !p.scope.period.to) bad.push("scope needs a period");
    const ids = new Set(), refs = new Set((p.evidence || []).map((e) => e.ref));
    for (const l of p.lines || []) {
      if (ids.has(l.id)) bad.push(`${l.id}: line id repeats`);
      ids.add(l.id);
      if (!STATES.includes(l.state)) bad.push(`${l.id}: state ${l.state}`);
      if (!EVIDENCE.includes(l.evidence_state)) bad.push(`${l.id}: evidence ${l.evidence_state}`);
      if ((l.state === "not_found" || l.state === "not_asked") && l.amount_cents !== null) bad.push(`${l.id}: ${l.state} carries a number`);
      if (l.state === "nil" && (l.amount_cents !== 0 || !l.nil_basis)) bad.push(`${l.id}: nil needs 0 and a stated basis`);
      if (l.state === "value" && !Number.isInteger(l.amount_cents)) bad.push(`${l.id}: value is not whole cents`);
      if (l.state === "value" && l.amount_cents === 0 && l.unit === "aud") bad.push(`${l.id}: a bare zero; say nil with a basis, or not_found`);
      if (l.basis === "stock" && !l.as_at) bad.push(`${l.id}: a balance needs the day it was true`);
      for (const c of l.evidence) if (!refs.has(c.ref)) bad.push(`${l.id}: cites ${c.ref}, which is not in the pack`);
    }
    for (const g of p.gaps || []) {
      if (!OWNERS.includes(g.owner)) bad.push(`${g.id}: owner ${g.owner}`);
      if (g.amount_cents === 0) bad.push(`${g.id}: a gap's amount is unknown or real, never 0`);
    }
    const text = canonical({ q: p.question, l: p.lines, e: (p.evidence || []).map((e) => ({ ...e, source_id: null })), g: p.gaps, n: p.notes });
    if (/[a-z]+:\/\/|drive\.google|docs\.google|onedrive|sharepoint|dropbox\.com/i.test(text)) bad.push("a link to somewhere else: a pack is a fixed copy");
    if (bad.length) throw new Error(`Pack ${p.id} breaks its shape:\n  ${bad.join("\n  ")}`);
    return p;
  }

  const money = (c) => { if (c === null || c === undefined) return "not found"; const a = Math.abs(c), s = `$${String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+$)/g, ",")}.${String(a % 100).padStart(2, "0")}`; return c < 0 ? `(${s})` : s; };
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const longDate = (d) => { const [y, m, x] = String(d).split("-"); return `${Number(x)} ${MONTHS[Number(m) - 1]} ${y}`; };
  const counts = (p) => { const n = { held: 0, at_risk: 0, missing: 0 }; for (const l of p.lines) if (l.section.endsWith(".summary") || l.fields.counted) if (n[l.evidence_state] !== undefined) n[l.evidence_state]++; return n; };

  return { STANDARD, STATES, EVIDENCE, line, make, validate, canonical, worst, money, longDate, counts };
});
