#!/usr/bin/env node
/* The ladder. The household did not change, so the answer must not change. Each presentation rung mangles how the same facts are
   delivered and must land on the same bundle hash. Each semantic rung breaks one thing and must raise the right alarm, in the
   right place, and nowhere else. All of it runs in memory over the world's files. `node standard/eval/ladder.js [--log]` */
"use strict";
const fs = require("fs"), path = require("path");
const { rebuild } = require("../engine/rebuild");
const I = require("../intake");
const Engine = require("../../src/engine.js");

const root = path.join(__dirname, ".."), world = path.join(root, ".build", "world");
const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return d; } };
Engine.loadMerchants({ merchants: readJson(path.join(root, "..", "merchants", "merchants.json")), categories: readJson(path.join(root, "..", "merchants", "categories.json")) });
const recipes = I.loadRecipes(path.join(root, "recipes")), vocab = I.loadVocab(), inflate = I.hostInflate();
const manifest = readJson(path.join(world, "manifest.json"));
const setup = {}; for (const f of fs.readdirSync(path.join(world, "setup"))) setup[f.replace(".json", "")] = readJson(path.join(world, "setup", f), []);
const decisions = readJson(path.join(world, "decisions", "person.json"), []), rules = readJson(path.join(world, "decisions", "rules.json"), []);
const schema = { events: readJson(path.join(root, "schema", "events.json")) };
const reference = readJson(path.join(root, "reference", "au.json"), null);
const base = I.walkRoot(world);

const text = (f) => Buffer.from(f.bytes).toString("utf8");
const withText = (f, t, patch = {}) => ({ ...f, ...patch, bytes: new Uint8Array(Buffer.from(t, "utf8")) });
const isFamily = (f, fam) => (manifestByPath.get(f.path) || {}).family === fam;
const manifestByPath = new Map(manifest.files.map((m) => [m.path, m]));
const csvFiles = (fs_) => fs_.filter((f) => /\.csv$/i.test(f.name) && /sources\/ACC-/.test(f.path) && isFamily(f, "harbour-txn-csv"));

function rebuildFiles(files, extra = {}) {
  const intake = I.ingestFiles(files, { recipes, vocab, inflate, manifest: extra.manifest ?? null });
  const receipts = (intake.files || []).map((f) => { const parts = f.path.split("/"); return { stream_id: parts[1], day: parts[2] }; });
  const L = rebuild({ setup, sources: intake.sources, observations: intake.observations, decisions: extra.decisions ?? decisions, rules, schema, reference, receipts, faults: intake.faults });
  return { L, intake };
}
const baseline = rebuildFiles(base);
const baselineIntake = baseline.intake;
const baselineReceipts = (baselineIntake.files || []).map((f) => { const parts = f.path.split("/"); return { stream_id: parts[1], day: parts[2] }; });
const cents = (L) => JSON.stringify(L.netWorth[L.netWorth.length - 1]);
const stat = (L, law, scope) => L.checks.filter((c) => c.law === law && (!scope || String(c.scope).includes(scope))).map((c) => c.status);

const presentation = [
  ["files arrive in reverse order", (fs_) => [...fs_].reverse()],
  ["every file is downloaded twice, byte-identical", (fs_) => [...fs_, ...fs_.map((f) => ({ ...f, name: f.name.replace(/(\.\w+)$/, " (1)$1"), path: f.path.replace(/(\.\w+)$/, " (1)$1") }))]],
  ["every bank CSV is delivered a second time with Windows line endings", (fs_) => [...fs_, ...csvFiles(fs_).map((f) => withText(f, text(f).replace(/\r?\n/g, "\r\n"), { name: `crlf-${f.name}`, path: f.path.replace(f.name, `crlf-${f.name}`) }))]],
  ["bank CSVs carry a byte-order mark", (fs_) => fs_.map((f) => (csvFiles([f]).length ? withText(f, `﻿${text(f)}`) : f))],
  ["bank exports overlap: each month also arrives inside a rolling quarter", (fs_) => {
    const csv = csvFiles(fs_).sort((a, b) => (a.path < b.path ? -1 : 1));
    const byStream = new Map();
    for (const f of csv) { if (!byStream.has(f.stream)) byStream.set(f.stream, []); byStream.get(f.stream).push(f); }
    const extra = [];
    for (const [, list] of byStream) for (let i = 0; i + 2 < list.length; i++) {
      const parts = list.slice(i, i + 3).map((f) => text(f).split(/\r?\n/).filter(Boolean));
      const body = [parts[0][0], ...parts.flatMap((p) => p.slice(1))].join("\n") + "\n";
      extra.push(withText(list[i + 2], body, { name: `rolling-${list[i + 2].name}`, path: list[i + 2].path.replace(list[i + 2].name, `rolling-${list[i + 2].name}`) }));
    }
    return [...fs_, ...extra];
  }],
  ["bank CSV rows run newest first", (fs_) => fs_.map((f) => { if (!csvFiles([f]).length) return f; const r = text(f).split(/\r?\n/).filter(Boolean); return withText(f, [r[0], ...r.slice(1).reverse()].join("\n") + "\n"); })],
];

const pick = (fs_, re) => fs_.filter((f) => re.test(f.path)).sort((a, b) => (a.path < b.path ? -1 : 1));
const editRow = (f, change) => { const r = text(f).split(/\r?\n/); const i = r.findIndex((l, n) => n > 0 && l && change.when(l)); r[i] = change.to(r[i]); return withText(f, r.join("\n")); };

const semantic = [
  ["one month of statements goes missing", (fs_) => { const g = pick(fs_, /sources\/ACC-EVD\/.*2023-05/); return fs_.filter((f) => !g.includes(f)); },
    (L) => (stat(L, "L3", "ACC-EVD").includes("gap") && !stat(L, "L3", "ACC-CC").includes("fail") ? null : "expected a gap on ACC-EVD and nothing on the card")],
  ["one amount is misread by $10", (fs_) => { const f = pick(fs_, /sources\/ACC-EVD\/.*2024-0[34]/).find((x) => /\.csv$/.test(x.name)); return fs_.map((x) => (x === f ? editRow(x, { when: (l) => /,\d+\.\d\d,,\d/.test(l), to: (l) => l.replace(/,(\d+\.\d\d),,(\d)/, (m, a, b2) => `,${(Number(a) + 10).toFixed(2)},,${b2}`) }) : x)); },
    (L, B, intake) => (intake.faults.some((f) => f.code === "file_refused") && stat(L, "L3", "ACC-EVD").some((x) => x === "fail" || x === "gap") ? null : "expected the file refused and the account marked")],
  ["a row is repeated inside one file", (fs_) => { const f = pick(fs_, /sources\/ACC-EVD\/.*2024-0[56]/).find((x) => /\.csv$/.test(x.name)); return fs_.map((x) => { if (x !== f) return x; const r = text(x).split(/\r?\n/).filter(Boolean); r.splice(3, 0, r[2]); return withText(x, r.join("\n") + "\n"); }); },
    (L, B, intake) => (intake.faults.some((f) => f.code === "file_refused") ? null : "expected the file refused")],
  ["a payslip goes missing", (fs_) => { const f = pick(fs_, /sources\/PAY-J\/.*Payslip/)[40]; return fs_.filter((x) => x !== f); },
    (L, B) => {
      if (JSON.stringify(L.cash.map((m) => m.net)) !== JSON.stringify(B.cash.map((m) => m.net))) return "the cash lens should not move";
      if (!L.review.some((r) => r.kind === "deposit_without_payslip")) return "expected a question about the deposit";
      if (!L.events.some((e) => e.kind === "wage_unmatched" && e.status === "provisional")) return "expected provisional income";
      if (!stat(L, "L13").includes("gap")) return "expected a coverage gap";
      return null;
    }],
  ["a bank moves a date column to US order", (fs_) => { const f = pick(fs_, /sources\/ACC-EVD\/.*2024-0[78]/).find((x) => /\.csv$/.test(x.name)); return fs_.map((x) => (x === f ? withText(x, text(x).replace(/\b(\d{2})\/(\d{2})\/(\d{4})\b/g, "$2/$1/$3")) : x)); },
    (L, B, intake) => (intake.faults.some((f) => f.code === "file_refused") && L.events.length < B.events.length ? null : "expected the whole file refused, with none of it in the ledger")],
  ["a card export loses a row its statement still shows, on an account with no running balance", (fs_) => { const f = pick(fs_, /sources\/ACC-CC\/.*2024-0[34]/).find((x) => /\.csv$/.test(x.name)); return fs_.map((x) => { if (x !== f) return x; const r = text(x).split(/\r?\n/).filter(Boolean); r.splice(3, 1); return withText(x, r.join("\n") + "\n"); }); },
    (L, B) => (L.bundleHash === B.bundleHash ? null : "the statement still witnesses the line, so nothing should move")],
  ["a bank renames a column", (fs_) => { const list = csvFiles(fs_); const f = list[50]; return fs_.map((x) => (x === f ? withText(x, text(x).replace("Narrative", "Details")) : x)); },
    (L, B, intake) => (intake.unknown_files.some((u) => u.reason === "no_recipe") ? null : "expected an unknown file, never a guess")],
];

/* One rung per law. Each breaks exactly what that law guards and must make it ring, so a hollow law fails this eval. */
const sealed = () => require("../engine/close").seal(baseline.L, ["2024-05"]);
const editObs = (kind, pick2, edit) => (obs) => { const i = obs.findIndex((o) => o.kind === kind && pick2(o)); const o = JSON.parse(JSON.stringify(obs[i])); edit(o.payload); return obs.map((x, n) => (n === i ? o : x)); };
const lawRungs = [
  ["L1", "a template that does not balance is refused before it can post", (input) => ({ ...input, extensions: { events: { x_bad: { legs: [["ACC-EVD", "+amount"]] } } } }), "throws"],
  ["L2", "a salary line vanishes, so a payslip cannot clear", (input) => ({ ...input, obs: (o) => { const i = o.findIndex((x) => x.kind === "txn_line" && /SALARY NORTHWIND/.test(x.payload.description) && x.payload.posting_date > "2024-01-01"); return o.filter((_, n) => n !== i); } }), "fail"],
  ["L3", "a statement's closing balance is changed", (input) => ({ ...input, obs: editObs("statement", (o) => o.payload.period_end > "2024-01-01", (p) => { p.closing_cents += 500; }) }), "fail"],
  ["L4", "a bill arrives that nothing can claim", (input) => ({ ...input, obs: editObs("bill", () => true, (p) => { p.amount_cents = 123456; }) }), "fail"],
  ["L5", "a payslip's net does not follow from its gross", (input) => ({ ...input, obs: editObs("payslip", (o) => o.payload.pay_date > "2024-01-01", (p) => { p.net_cents += 700; }) }), "fail"],
  ["L6", "a rate history is wrong by two points", (input) => ({ ...input, setup: { ...input.setup, term: input.setup.term.map((t) => (t.subject_id === "C-INV2" && t.term === "interest_rate" ? { ...t, value: String(Number(t.value) + 2) } : t)) }, obs: (o) => o.filter((x) => !(x.kind === "rate_notice" && /INV2|0044516/.test(JSON.stringify(x.payload)))) }), "fail"],
  ["L7", "a contract note goes missing", (input) => ({ ...input, obs: (o) => { const i = o.findIndex((x) => x.kind === "contract_note"); return o.filter((_, n) => n !== i); } }), "fail"],
  ["L8", "sources state a balance the ledger does not hold", (input) => ({ ...input, obs: editObs("statement", (o) => o.payload.period_end > "2024-01-01", (p) => { p.closing_cents += 500; }) }), "fail"],
  ["L9", "ownership adds to 90%", (input) => ({ ...input, setup: { ...input.setup, ownership: input.setup.ownership.map((o, i) => (i === 0 ? { ...o, share_bps: o.share_bps - 1000 } : o)) } }), "fail"],
  ["L10", "two rates on one day", (input) => ({ ...input, setup: { ...input.setup, term: [...input.setup.term, { term_id: "x", subject_type: "asset", subject_id: "HOME", term: "use", value: "rental", valid_from: "2019-06-01", valid_to: null, recorded_at: "2019-06-01T00:00:00Z", superseded_at: null }] } }), "fail"],
  ["L11", "an income source goes missing from the draft", (input) => ({ ...input, obs: (o) => o.filter((x) => x.kind !== "distribution") }), "fail"],
  ["L12", "a locked month changes", (input) => ({ ...input, setup: { ...input.setup, period: [...input.setup.period.filter((p) => p.period_id !== "2024-05"), ...sealed()] }, obs: (o) => { const i = o.findIndex((x) => x.kind === "txn_line" && x.payload.posting_date >= "2024-05-01" && x.payload.posting_date <= "2024-05-31"); return o.filter((_, n) => n !== i); } }), "fail"],
  ["L13", "a stream stops arriving", (input) => ({ ...input, receipts: (r) => r.filter((x) => !(x.stream_id === "PHI-M" && x.day > "2022-01-01")), obs: (o) => { const gone = new Set(baselineIntake.sources.filter((s) => s.stream_id === "PHI-M" && s.captured_at > "2022-01-01").map((s) => s.source_id)); return o.filter((x) => !gone.has(x.source_id)); } }), "gap"],
  ["L14", "an employer stops paying into the fund", (input) => ({ ...input, obs: (o) => o.filter((x) => !(x.kind === "super_line" && x.payload.line_type === "employer" && x.payload.posting_date > "2024-01-01")) }), "fail"],
  ["L15", "an event with no evidence", (input) => ({ ...input, decisions: [...input.decisions, { decision_id: "x", target_type: "account", target_ref: "ACC-EVD", verb: "adjust", value: { date: "2024-01-01", account_id: "ACC-EVD", category_id: "GIFTS", amount_cents: 100 }, by: "a", at: "2024-01-01T00:00:00Z", status: "accepted" }], stripRule: true }), "fail"],
  ["L16", "contributions run past the cap", (input) => ({ ...input, setup: { ...input.setup }, capOverride: 1 }), "open"],
  ["L17", "a decision points at nothing", (input) => ({ ...input, decisions: [...input.decisions, { decision_id: "y", target_type: "line", target_ref: "ACC-EVD|2099-01-01|-1", verb: "categorise", value: { category_id: "GIFTS" }, by: "a", at: "2024-01-01T00:00:00Z", status: "accepted" }] }), "fail"],
  ["L18", "a wrapper owns an account", (input) => ({ ...input, setup: { ...input.setup, party: [...input.setup.party, { party_id: "W-SMSF", kind: "smsf", name: "Fund" }], ownership: [...input.setup.ownership, { subject_type: "account", subject_id: "CAR", party_id: "W-SMSF", basis: "beneficial", share_bps: 10000, valid_from: "2019-01-01", valid_to: null, recorded_at: "2019-01-01T00:00:00Z", superseded_at: null }] } }), "open"],
  ["L20", "a valuation typo, ten times too big", (input) => ({ ...input, obs: editObs("valuation", (o) => o.payload.as_at > "2024-01-01", (p) => { p.value_cents *= 10; }) }), "open"],
];

function runLaw(rung) {
  const [law, name, mutate, want] = rung;
  const intake = baselineIntake;
  const base = { setup, decisions, obs: (o) => o, receipts: (r) => r };
  const input = mutate(base);
  const r2 = input.capOverride ? { ...reference, series: { ...reference.series, concessional_cap: { rows: [{ valid_from: "2000-01-01", valid_to: null, value: { amount: 1 } }] } } } : reference;
  let L;
  try {
    L = rebuild({ setup: input.setup, sources: intake.sources, observations: input.obs(intake.observations), decisions: input.decisions, rules, schema, reference: r2, receipts: input.receipts(baselineReceipts), extensions: input.extensions });
    if (input.stripRule) for (const e of L.events) if (e.kind === "adjustment") e.rule = "manual";
    if (input.stripRule) L.checks = require("../engine/laws").runLaws(L);
  } catch (e) { return { kind: "law", law, name, ok: want === "throws", why: want === "throws" ? null : e.message }; }
  if (want === "throws") return { kind: "law", law, name, ok: false, why: "expected a refusal" };
  const statuses = L.checks.filter((c) => c.law === law).map((c) => c.status);
  const baseStatuses = baseline.L.checks.filter((c) => c.law === law).map((c) => c.status);
  const rang = statuses.filter((s) => s === want).length > baseStatuses.filter((s) => s === want).length;
  return { kind: "law", law, name, ok: rang, why: rang ? null : `${law} stayed ${[...new Set(statuses)].join(",")}` };
}

function main() {
  const out = [];
  const b = baseline.L;
  console.log(`Baseline bundle ${b.bundleHash}: ${b.events.length} events.\n\nPresentation: the household did not change, so the hash must not.`);
  for (const [name, mutate] of presentation) {
    const t = process.hrtime.bigint();
    const { L } = rebuildFiles(mutate(base));
    const ok = L.bundleHash === b.bundleHash;
    out.push({ kind: "presentation", name, ok });
    console.log(`  ${ok ? "same" : "DIFF"}  ${name}  (${(Number(process.hrtime.bigint() - t) / 1e9).toFixed(1)}s)${ok ? "" : `  ${L.events.length} events, ${cents(L)}`}`);
  }
  console.log(`\nSemantic: one thing breaks; the right alarm rings in the right place.`);
  for (const [name, mutate, verdict] of semantic) {
    const { L, intake } = rebuildFiles(mutate(base));
    const why = verdict(L, b, intake);
    out.push({ kind: "semantic", name, ok: !why, why });
    console.log(`  ${why ? "MISS" : "rang"}  ${name}${why ? `: ${why}` : ""}`);
  }
  console.log(`\nLaws: each breaks what it guards and must ring.`);
  for (const rung of lawRungs) {
    const r = runLaw(rung);
    out.push(r);
    console.log(`  ${r.ok ? "rang" : "MISS"}  ${r.law}  ${r.name}${r.ok ? "" : `: ${r.why}`}`);
  }
  const pass = out.filter((r) => r.ok).length;
  console.log(`\n${pass} of ${out.length} rungs hold.`);
  return out;
}
if (require.main === module) { const r = main(); process.exitCode = r.every((x) => x.ok) ? 0 : 1; }
module.exports = { main };
