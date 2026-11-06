/* What the Standard could not answer, each as a test of what it should do. They fail today, and they run as todo so CI stays green and they stay visible:
   node --test src/household/pack/fixtures/findings.test.js
   A fixture that starts passing means the gap is closed: take the row out of FINDINGS.md and turn the pack's workaround off. Numbers in FINDINGS.md. */
"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("fs"), path = require("path");
const NH = require("../node-host.js"), K = require("../index.js");
const repo = NH.repo, std = (...p) => path.join(repo, "standard", ...p), read = (...p) => JSON.parse(fs.readFileSync(std(...p), "utf8"));
const hh = NH.household(), L = hh.at("2024-08-05"), all = hh.at(null), FY = "FY2024";
const item = (ledger, person, fy, label) => ledger.tax.items.find((i) => i.party_id === person && i.fy === fy && i.label === label);
const todo = (name, fn) => test(name, { todo: true }, fn);

todo("F1 a missing income statement must not remove income the payslips show", () => {
  const dropped = hh.at("2024-08-05", (s) => s.stream_id === "IS-M2" && s.captured_at >= "2024-07-01");
  const slips = (dropped.resolver.byKind.get("payslip") || []).filter((o) => o.payload.employer_ref === "Nightpaw Agency Nursing" && o.payload.pay_date >= "2023-07-01" && o.payload.pay_date < "2024-07-01").reduce((s, o) => s + o.payload.gross_cents, 0);
  assert.ok(slips > 0);
  assert.equal(item(dropped, "MIA", FY, "1").amount_cents, item(L, "MIA", FY, "1").amount_cents, "label 1 falls by the agency's income, though its payslips are held");
});
todo("F2 a household with no tax_map still gets its interest and rent on a label", () => {
  const { L: H } = require("../../../../standard/eval/heldout2/run.js").run();
  const person = "PTY-IM";
  assert.ok(H.events.some((e) => e.category_id === "RENT-INC"), "rent is in the ledger");
  assert.ok(item(H, person, FY, "21P"), "a blank household has no default map, so the draft silently leaves rent out");
});
todo("F3 a bill must not bind to a payment of the same amount with nothing else in common", () => {
  const wrong = [...all.index.events.values()].filter((e) => e.category_id === "CAR" && e.activity_id === "ACT-RENTAL2");
  assert.equal(wrong.length, 0, `a car service took the Ballarat rates bill and the rental activity: ${wrong.map((e) => e.description).join(", ")}`);
});
todo("F4 the CGT rate comes from the reference, by date", () => {
  const doctored = JSON.parse(JSON.stringify(hh.reference)); doctored.series.cgt_discount_individual.rows[0].value.rate = 0.4;
  const { rebuild } = require(std("engine", "rebuild"));
  const setup = {}; for (const f of fs.readdirSync(path.join(hh.world, "setup"))) setup[f.replace(".json", "")] = JSON.parse(fs.readFileSync(path.join(hh.world, "setup", f), "utf8"));
  const L2 = rebuild({ setup, sources: hh.intake.sources, observations: hh.intake.observations, decisions: [], rules: [], schema: { events: read("schema", "events.json"), metrics: read("schema", "metrics.json") }, reference: doctored, receipts: [], faults: [] });
  assert.notEqual(item(L2, "JORDAN", "FY2025", "18A").amount_cents, item(all, "JORDAN", "FY2025", "18A").amount_cents, "tax.js halves the gain whatever the reference says");
});
todo("F5 the reference says what happens to the CGT discount from 1 July 2027", () => {
  const rows = read("reference", "au.json").series.cgt_discount_individual.rows;
  assert.ok(rows.some((r) => r.valid_to || r.valid_from >= "2027-07-01"), "the 50% row runs open-ended past a change research reports, unconfirmed");
});
todo("F6 the reference holds the Division 293 threshold", () => { assert.ok(read("reference", "au.json").series.division_293_threshold); });
todo("F7 the reference holds the private health rebate and surcharge tiers", () => { const s = read("reference", "au.json").series; assert.ok(s.phi_rebate_tiers && s.medicare_levy_surcharge); });
todo("F8 the low and middle income offset's steps are data, not code", () => { const v = read("reference", "au.json").series.lmito.rows[0].value; assert.ok(v.steps || v.from, "37000, 48000 and 90000 are typed in tax.js"); });
todo("F9 decimal money rounds the decimal way: LITO on 64,399 is 34.02, not 34.01", () => {
  const e = L.tax.estimates.find((x) => x.person === "MIA" && x.fy === FY);
  assert.equal(e.offsets_cents - item(L, "MIA", FY, "20O").amount_cents, 3402, "700 - 375 - 290.985 = 34.015; binary holds 34.01499...");
});
todo("F10 a tax item with no evidence can say so", () => {
  const dropped = hh.at(null, (s) => s.stream_id === "BRK-NOTES" && s.captured_at < "2021-01-01");
  const every = dropped.tax.items.map((i) => i.evidence);
  assert.ok(every.some((e) => e !== "held"), "evidence is always held: add() returns on zero cents, so the 18A row for an unknown cost base is thrown away, and nothing ever sets at_risk");
});
todo("F11 a tax item's refs are complete", () => {
  const capped = all.tax.items.filter((i) => i.refs.length === 40);
  assert.equal(capped.length, 0, `refs stop at 40 with no sign: ${capped.map((i) => `${i.party_id} ${i.fy} ${i.label}`).join(", ")}`);
});
todo("F12 the label tie reads both ways: a label on the draft and not on the return is a difference", () => {
  const intake = JSON.parse(JSON.stringify({ o: hh.intake.observations.filter((o) => o.kind === "tax_assessment") }));
  const doctored = intake.o.find((o) => o.payload.fy === FY && o.payload.person_ref === "Jordan Davies" && Array.isArray(o.payload.labels));
  doctored.payload.labels = doctored.payload.labels.filter((l) => l.label !== "10");
  const swap = new Map(intake.o.map((o) => [o.obs_id, o]));
  const NHh = NH.household({ intake: { ...hh.intake, observations: hh.intake.observations.map((o) => swap.get(o.obs_id) || o) } });
  const tie = NHh.at(null).tax.labelTies.find((t) => t.person === "JORDAN" && t.fy === FY);
  assert.ok(tie.bad > 0, "out.labelTies walks the return's lines, so what the return left out passes");
});
todo("F13 rebuild takes a clock", () => {
  const { rebuild } = require(std("engine", "rebuild"));
  const setup = {}; for (const f of fs.readdirSync(path.join(hh.world, "setup"))) setup[f.replace(".json", "")] = JSON.parse(fs.readFileSync(path.join(hh.world, "setup", f), "utf8"));
  const L2 = rebuild({ setup, sources: hh.intake.sources, observations: hh.intake.observations, decisions: [], rules: [], schema: { events: read("schema", "events.json"), metrics: read("schema", "metrics.json") }, reference: hh.reference, receipts: [], faults: [], today: "2024-08-05" });
  assert.ok(L2.sources.every((s) => s.captured_at.slice(0, 10) <= "2024-08-05"), "the pack filters originals itself; a page would have to as well");
});
todo("F14 the income statement recipes read reportable fringe benefits", () => {
  assert.ok(all.resolver.collapseDocs("income_statement").some((o) => o.payload.rfba_cents !== undefined), "rfba_cents is in the schema and no recipe fills it");
});
todo("F15 a private health statement can have more than one line", () => {
  const o = read("schema", "observations.json").kinds.health_statement;
  assert.ok(o.fields.some((f) => /lines/.test(f)), "benefit code and rebate change on 1 April, so one statement has two lines, and the shape holds one");
});
todo("F16 a deductions worksheet keeps what each row was for", () => {
  const o = (all.resolver.byKind.get("work_log") || []).find((x) => x.payload.log_kind === "expense");
  assert.ok(o.payload.description, "the recipe reads Label and Amount and drops Description, so a pack row says only worksheet row");
});
todo("F17 interest on money borrowed but not yet used has somewhere to go", () => {
  const terms = JSON.stringify(read("schema", "terms.json")), tables = JSON.stringify(read("schema", "tables.json"));
  assert.ok(/undrawn|not_yet_used/.test(terms + tables), "the template's not-yet-deductible row has no Standard shape, so the pack writes nil for it");
});
todo("F18 a pension reaches a tax label", () => {
  const { L: H } = require("../../../../standard/eval/heldout3/run.js").run();
  const incomeNoLabel = H.events.filter((e) => e.occurred_on >= "2023-07-01" && e.occurred_on < "2024-07-01" && /PENSION|AGE/i.test(`${e.category_id} ${e.description}`));
  const person = H.memberships.find((m) => m.role === "adult").party_id;
  assert.ok(!incomeNoLabel.length || item(H, person, FY, "5") || item(H, person, FY, "6"), "pension income reaches no label, so a retiree's draft is short");
});
void K;
