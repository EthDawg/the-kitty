#!/usr/bin/env node
/* The page's window on the standard: data/standard-view.json, generated from a replay. The page reads this file; it computes nothing.
   node standard/tools/view.js [--out path] */
"use strict";
const fs = require("fs"), path = require("path");
const { run } = require("../eval/run");
const V = require("../engine/views");
const { fyRange, fyOf, monthEnd, cmp } = require("../engine/util");

const root = path.join(__dirname, "..");
const checks = JSON.parse(fs.readFileSync(path.join(root, "schema", "checks.json"), "utf8")).laws;
const metrics = JSON.parse(fs.readFileSync(path.join(root, "schema", "metrics.json"), "utf8")).metrics;
const tablesDoc = JSON.parse(fs.readFileSync(path.join(root, "schema", "tables.json"), "utf8"));

const STEPS = [
  { id: "income", name: "Income statements", kinds: ["income_statement"], person: true },
  { id: "payslips", name: "Payslips", kinds: ["payslip"], person: true },
  { id: "interest", name: "Bank interest", kinds: ["txn_line"], any: true },
  { id: "dividends", name: "Dividends and tax statements", kinds: ["dividend", "distribution"], scope: "shares" },
  { id: "rental", name: "Rental statements and loan interest", kinds: ["owner_statement"], scope: "property" },
  { id: "super", name: "Super contributions", kinds: ["super_statement", "super_line"], scope: "super" },
  { id: "health", name: "Private health statement", kinds: ["health_statement"], person: true },
  { id: "prefill", name: "ATO pre-fill", kinds: ["prefill"], person: true },
  { id: "lodged", name: "Lodged and assessed", kinds: ["tax_assessment"], person: true },
];

function readiness(L, R, fy, person) {
  const { start, stop } = fyRange(fy);
  const inYear = (o) => { const p = o.payload; const d = p.fy ? null : o.occurred_on || p.period_end || p.pay_date || p.as_at || p.posting_date; return p.fy ? p.fy === fy : d >= start && d < stop; };
  const mine = (o) => { const ref = o.payload.person_ref; return !ref || R.partyOf(ref, stop) === person; };
  const steps = STEPS.map((s) => {
    const held = s.kinds.flatMap((k) => (R.byKind.get(k) || []).filter((o) => inYear(o) && (!s.person || mine(o))));
    return { id: s.id, name: s.name, state: held.length ? "held" : "missing", count: held.length };
  });
  const relevant = steps.filter((s) => s.state === "held" || !["dividends", "rental", "health", "prefill"].includes(s.id));
  const held = relevant.filter((s) => s.state === "held").length;
  return { pct: relevant.length ? Math.round((held / relevant.length) * 100) : 0, steps };
}

function build() {
  const { L, s } = run();
  const R = L.resolver;
  const X = L.index;
  const people = L.parties.filter((p) => p.kind === "person" && (L.resolver.ctx.setup.membership || []).some((m) => m.party_id === p.party_id && m.role === "adult"));
  const lastMonths = L.netWorth.slice(-24);
  const lawRows = Object.entries(checks).map(([id, c]) => {
    const rows = L.checks.filter((x) => x.law === id);
    const counts = rows.reduce((m, r) => { m[r.status] = (m[r.status] || 0) + 1; return m; }, {});
    const status = counts.fail ? "fail" : counts.gap ? "gap" : counts.open ? "open" : counts.pass ? "pass" : "skip";
    return { id, name: c.name, claim: c.claim, status, counts, worst: (rows.find((r) => r.status === "fail") || rows.find((r) => r.status === "gap") || rows[0] || {}).detail || null };
  });
  const fys = [...new Set(L.periods.filter((p) => p.kind === "fy").map((p) => p.period_id))].sort();
  const fyList = fys.length ? fys : [...new Set(L.events.map((e) => fyOf(e.occurred_on)))].sort();
  const years = fyList.map((fy) => ({ fy, people: people.map((p) => {
    const est = L.tax ? (L.tax.estimates || []).find((x) => x.person === p.party_id && x.fy === fy) : null;
    const tie = L.tax ? (L.tax.ties || []).find((x) => x.person === p.party_id && x.fy === fy) : null;
    const assess = (R.collapseDocs("tax_assessment") || []).filter((o) => R.partyOf(o.payload.person_ref, o.payload.assessed_on) === p.party_id && o.payload.fy === fy).sort((a, b) => b.payload.version - a.payload.version)[0];
    return { person: p.party_id, name: p.name.split(" ")[0], status: assess ? "lodged" : "open", readiness: readiness(L, R, fy, p.party_id), lodged: assess ? { version: assess.payload.version, taxable_income_cents: assess.payload.taxable_income_cents, result_cents: assess.payload.result_cents, assessed_on: assess.payload.assessed_on } : null, derived: est || null, tie: tie || null,
      items: L.tax ? (L.tax.items || []).filter((i) => i.party_id === p.party_id && i.fy === fy).map((i) => ({ label: i.label, amount_cents: i.amount_cents, method: i.method, evidence: i.evidence })) : [] };
  }) }));

  const sample = (kind, pick) => { const e = L.events.filter((x) => x.kind === kind && (!pick || pick(x))).pop(); if (!e) return null; const t = V.explain(L, e.event_id); return { kind, date: e.occurred_on, description: e.description, amount_cents: e.amount_cents, grade: e.grade, postings: t.postings.map((p) => ({ target: p.account_id || `category ${p.category_id}`, amount_cents: p.amount_cents })), witnesses: t.witnesses }; };

  return {
    generated: { standard_version: tablesDoc.version, bundle_hash: L.bundleHash, as_of: L.asOf, files: s.run.files, observations: s.run.observations, events: s.run.events, postings: s.run.postings, seconds: +(s.run.ingest_s + s.run.rebuild_s).toFixed(2), note: "Generated by standard/tools/view.js from a blow-away replay of the fictional Davies household. The page reads this file and computes nothing." },
    model: { tables: Object.keys(tablesDoc.tables).length, planes: Object.entries(tablesDoc.planes).map(([id, about]) => ({ id, about, tables: Object.entries(tablesDoc.tables).filter(([, t]) => t.plane === id).map(([n, t]) => ({ name: n, temporal: t.temporal, doc: t.doc })) })) },
    proof: { sections: s.sections.map((r) => ({ name: r.name, exact: r.exact, checked: r.checked, pct: r.pct })), laws: lawRows, review: s.review },
    years,
    net_worth: lastMonths.map((m) => ({ month: m.month, total_cents: m.total, groups: m.groups })),
    cash: L.cash.slice(-24).map((m) => ({ month: m.month, income_cents: m.income, spending_cents: m.spending, net_cents: m.net })),
    activities: L.activityNet.map((a) => ({ fy: a.fy, activity: a.activity, name: (X.accounts.get(a.activity) || L.assets.find((x) => x.asset_id === a.activity) || {}).name || a.activity, income_cents: a.income, expense_cents: a.expense, net_cents: a.net })),
    things: L.refresh,
    coverage: L.coverage.map((c) => ({ stream: c.stream_id, name: c.name, expected: c.expected, have: c.have, missing: c.missing })),
    traces: [sample("wage_receipt"), sample("loan_payment"), sample("purchase", (e) => e.category_id === "GROCERIES"), sample("transfer"), sample("dividend"), sample("vest"), sample("tax_refund")].filter(Boolean),
    metrics: Object.entries(metrics).map(([id, m]) => ({ id, doc: m.doc, lens: m.lens, stability: m.stability })),
    experimental: [
      { id: "collect", title: "Collect statements", button: "Start computer use", status: "Mock", today: "The list of what is missing is real. Nothing is fetched yet.", open: ["Skills, or a harness like Jev?", "How a second factor reaches a person", "Which browser and whose session"] },
      { id: "tax_pack", title: "Tax pack", button: "Download tax pack", status: "Baseline", today: "A real file: lines, evidence list and gaps for the year.", open: ["The accountant's preferred shape", "One generic pack, or one per audience"] },
      { id: "advice", title: "Tax return check", button: "Run tax return advice", status: "Mock", today: "The draft and its ties to lodged history are real. A model's reading is not wired.", open: ["Connect the Australian Tax MCP as a host capability", "How to keep record and advice apart on the page"] },
      { id: "reconcile", title: "Reconciliation", button: "Run reconciliation", status: "Baseline", today: "Every law, by scope, with the gap, from the last replay.", open: ["Who confirms a close", "What a person does about a gap on a phone"] },
    ],
  };
}
if (require.main === module) {
  const i = process.argv.indexOf("--out");
  const out = i > 0 ? process.argv[i + 1] : path.join(root, "..", "data", "standard-view.json");
  const v = build();
  fs.writeFileSync(out, JSON.stringify(v));
  console.log(`${out}: ${fs.statSync(out).size} bytes. ${v.proof.sections.length} proof sections, ${v.years.length} years.`);
}
module.exports = { build };
