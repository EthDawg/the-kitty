#!/usr/bin/env node
/* Each finding is a fixture: something the Standard cannot read, or reads wrongly, shown on the smallest case. Run this to see which still reproduce.
   A finding that stops reproducing has landed, which is the good outcome: the run says so and does not fail. Nothing here edits the Standard. */
"use strict";
const fs = require("fs"), path = require("path");
const { STD } = require("../world/lib/std");
const { rebuild } = require(path.join(STD, "engine", "rebuild"));
const { household } = require(path.join(STD, "eval", "households", "kit"));
const { termAt } = require(path.join(STD, "engine", "temporal"));
const schema = { events: require(path.join(STD, "schema", "events.json")) };
const run = (h) => rebuild({ setup: h.setup, sources: h.sources, observations: h.observations, decisions: h.decisions, rules: h.rules, schema });

/* A probe returns true while the defect is there. World probes read a soundness run; kit probes build the smallest household. */
const PROBES = {
  "F-001": (w) => { const c = w.chapter(4), m = c.L.cash.find((x) => x.month === "2027-05"); return m.unexplained > 0; },
  "F-002": (w) => w.chapter(5).unread.some((u) => u.family === "life-will-pdf"),
  "F-003": (w) => w.chapter(7).unread.some((u) => u.family === "life-bas-pdf"),
  "F-004": () => {
    const h = household("help-first-row").person("P");
    h.account("HELP-P", "help_debt", "tax", [["P", 10000]]);
    h.obs("help_balance", { person_ref: "P", as_at: "2026-06-01", balance_cents: 1028000, indexation_cents: 28000 });
    const L = run(h);
    return L.balances.at("HELP-P", "2026-06") !== -1028000;
  },
  "F-005": (w) => { const L = w.chapter(6).L; return L.tax.ties.some((t) => t.status === "fail" && t.fy === "FY2027" && t.gap !== 0); },
  "F-006": (w) => { const row = w.chapter(5).L.coverage.find((x) => x.stream_id === "PAY-A"); return row.have < row.expected; },
  "F-007": () => {
    const h = household("late-rate").person("P").org("BANK");
    h.account("LN", "loan", "loans", [["P", 10000]]); h.setup.contract.push({ contract_id: "C-L", kind: "loan", name: "Loan", account_id: "LN", started_on: "2028-01-01" });
    h.setup.term.push({ term_id: "t0", subject_type: "contract", subject_id: "C-L", term: "interest_rate", value: "6.54", valid_from: "2028-01-01", recorded_at: "2030-06-30T00:00:00Z", superseded_at: null });
    h.obs("rate_notice", { contract_ref: "C-L", term: "interest_rate", value: "6.29", effective_on: "2028-03-01", notified_on: "2028-03-03" });
    const L = run(h);
    return termAt(L.termIdx, "contract", "C-L", "interest_rate", "2028-04-01") !== "6.29";
  },
  "F-008": (w) => w.chapter(6).L.tax.ties.some((t) => t.fy === "FY2026" && t.status === "fail"),
  "F-009": (w) => w.chapter(1).L.events.some((e) => /PAYMENT/.test(e.description || "") && e.kind === "purchase" && e.amount_cents < -50000),
  "F-010": (w) => w.chapter(4).L.events.some((e) => /BOND/.test(e.description || "") && e.kind === "purchase"),
};

function check(world) {
  const dir = __dirname, rows = [];
  const fixtures = fs.readdirSync(dir).filter((n) => /^F-\d+.*\.json$/.test(n)).sort().map((n) => JSON.parse(fs.readFileSync(path.join(dir, n), "utf8")));
  for (const f of fixtures) {
    const probe = PROBES[f.id]; if (!probe) throw new Error(`${f.id} has no probe`);
    rows.push({ id: f.id, title: f.title, landing: f.landing, reproduces: !!probe(world) });
  }
  return rows;
}

if (require.main === module) {
  const { sound } = require("../world/sound");
  const r = sound({ seed: 1 }), world = { chapter: (n) => r.chapters.find((c) => c.chapter === n) };
  for (const x of check(world)) console.log(`${x.id} ${x.reproduces ? "reproduces" : "LANDED"}  ${x.title}`);
}

module.exports = { check, PROBES };
