/* The pack's promises, run on the fictional Davies and the blind held-out families. Build the world first: node standard/world/build.js
   Run: node --test src/household/pack/test.js   The independent reader is test_independent.py. Findings run as todo tests in fixtures/findings.test.js. */
"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("fs"), path = require("path"), vm = require("vm"), zlib = require("zlib");
const K = require("./index.js"), NH = require("./node-host.js");
const { sha256 } = require("../../../standard/intake/sha256.js");
const { Doc } = require("../../../standard/world/lib/pdf.js");
const { allocate } = require("../../../standard/engine/util.js");

const heldouts = new Map();
const heldout = (dir) => { if (!heldouts.has(dir)) heldouts.set(dir, require(`../../../standard/eval/${dir}/run.js`).run()); return heldouts.get(dir); };   // a build runs once a process
const hh = NH.household(), host = NH.host(hh.world), FY = "FY2024", DAY = "2024-08-05", L = hh.at(DAY);
const PEOPLE = ["JORDAN", "MIA"];
const build = (person, ledger = L, o = {}) => K.tax.build({ L: ledger, reference: o.reference || hh.reference, person, fy: o.fy || FY, asOf: o.asOf || DAY });
const packs = Object.fromEntries(PEOPLE.map((p) => [p, build(p)]));
const zips = Object.fromEntries(PEOPLE.map((p) => [p, K.bundle.render(packs[p], host)]));
const text = (b) => new TextDecoder().decode(b);
const member = (r, name) => r.parts.flatMap((p) => p.files).find((f) => f.path === name);
const unz = (bytes) => K.zip.read(bytes, (b) => host.inflate(b, true));
const parseCsv = (s) => { const rows = []; let r = [], c = "", q = false; for (let i = 0; i < s.length; i++) { const ch = s[i]; if (q) { if (ch === '"') { if (s[i + 1] === '"') { c += '"'; i++; } else q = false; } else c += ch; } else if (ch === '"') q = true; else if (ch === ",") { r.push(c); c = ""; } else if (ch === "\n") { r.push(c.replace(/\r$/, "")); rows.push(r); r = []; c = ""; } else c += ch; } return rows; };
const sheetCells = (book) => book.sheets.flatMap((s) => s.rows.flatMap((row) => row.filter(Boolean).map((c) => ({ sheet: s.name, c }))));

// ---------- the shape ----------
test("the shape refuses a bare zero, a number on a missing value, a nil with no basis, and a link", () => {
  const base = () => ({ ...K.pack.make({ kind: "x", id: "x", question: "q", audience: "a", as_of: "2024-01-01", scope: { people: [{ party_id: "P", name: "P" }], period: { from: "2023-01-01", to: "2023-12-31" } }, lines: [], evidence: [], gaps: [] }) });
  const with1 = (o) => { const p = base(); p.lines = [K.pack.line({ id: "a", section: "s", name: "n", evidence_state: "not_needed", ...o })]; return p; };
  assert.throws(() => K.pack.validate(with1({ amount_cents: 0 })), /bare zero/);
  assert.throws(() => K.pack.validate({ ...with1({}), lines: [{ ...K.pack.line({ id: "a", section: "s", name: "n" }), amount_cents: 0, state: "not_found" }] }), /carries a number/);
  assert.throws(() => K.pack.validate(with1({ amount_cents: 0, state: "nil" })), /nil needs/);
  assert.throws(() => K.pack.validate(with1({ amount_cents: 10, note: "see https://drive.google.com/x" })), /fixed copy/);
  assert.throws(() => K.pack.validate(with1({ amount_cents: 10, evidence: [{ ref: "E9", locator: "p1" }] })), /not in the pack/);
  assert.throws(() => K.pack.validate(with1({ amount_cents: 10, basis: "stock" })), /needs the day/);
  assert.ok(K.pack.validate(with1({ amount_cents: 0, state: "nil", nil_basis: "Statements show none." })));
});

// ---------- the numbers ----------
for (const person of PEOPLE) {
  test(`${person}: every number on the Return Summary ties to the engine`, () => {
    const ties = zips[person].ties, items = new Map(L.tax.items.filter((i) => i.fy === FY && i.party_id === person).map((i) => [i.label, i]));
    assert.ok(ties.length > 30, "a real number of ties");
    for (const t of ties) assert.equal(Math.round(t.computed * 100), t.cents, `${t.what} at ${t.sheet}!${t.cell}`);
    // and those expected values are the engine's own, read directly, not the pack's copy of them
    const p = packs[person], est = L.tax.estimates.find((e) => e.person === person && e.fy === FY);
    for (const l of p.lines.filter((x) => x.section.endsWith(".summary") && x.engine && items.has(x.engine))) assert.equal(l.amount_cents, items.get(x_(l)).amount_cents, l.id);
    for (const [id, k] of [["taxable", "taxable_income_cents"], ["gross", "gross_tax_cents"], ["offsets", "offsets_cents"], ["levy", "levy_cents"], ["help", "help_cents"], ["payg", "payg_cents"], ["franking", "franking_cents"], ["result", "result_cents"]]) assert.equal((p.lines.find((l) => l.id === `estimate.${id}`) || {}).amount_cents, est[k], id);
    const front = new Set(ties.filter((t) => t.sheet === "Return Summary").map((t) => t.what));
    for (const label of ["1", "10", "21P", "21Q", "21F", "21X", "D5", "D10"]) assert.ok([...front].some((w) => w.endsWith(`, ${label}`)), `label ${label} is tied`);
    assert.ok(front.has("Return Summary, taxable income") && front.has("Return Summary, estimated result"));
  });
  test(`${person}: the loan interest difference is zero, and each loan's lender figure stands behind it`, () => {
    const r = K.workbookTax.render(packs[person]);
    assert.equal(r.valueOf("ln.diff"), 0);
    assert.equal(r.valueOf("ln.check"), "Reconciles");
    const rows = packs[person].lines.filter((l) => l.section === "loans.rows");
    assert.equal(rows.length, person === "MIA" ? 3 : 2, "every loan listed, deductible or not");
    assert.ok(rows.some((l) => l.fields.verdict === "NO"), "the home loan is listed though nothing on it is deductible");
    for (const l of rows) { assert.equal(l.evidence_state, "held"); assert.equal(l.amount_cents, l.fields.deductible_cents + l.fields.private_cents + l.fields.undrawn_cents); }
    for (const prop of packs[person].scope.properties) assert.equal(r.valueOf(`${prop.section}.agent.diff`), 0, `${prop.name}: agent money out reconciles`);
  });
}
const x_ = (l) => l.engine;

test("ownership is applied once: the workbook's share of a joint property is the engine's", () => {
  const r = K.workbookTax.render(packs.MIA), geelong = packs.MIA.scope.properties.find((p) => p.id === "RENTAL"), ballarat = packs.MIA.scope.properties.find((p) => p.id === "RENTAL2");
  assert.equal(geelong.share_bps, 5000); assert.equal(ballarat.share_bps, 10000);
  assert.equal(r.valueOf(`${geelong.section}.full.P`) / 2, r.valueOf(`${geelong.section}.mine.P`));
  const sheet = r.book.sheets.find((s) => s.name === "Property Geelong");
  const formulas = sheet.rows.flat().filter((c) => c && typeof c.f === "string" && /\*/.test(c.f));
  assert.equal(formulas.length, 4, "the share multiplies only the four result legs, nothing above them");
  const jordan = K.workbookTax.render(packs.JORDAN), sum = (key) => Math.round(jordan.valueOf(key) * 100) + Math.round(r.valueOf(key) * 100);
  assert.equal(sum(`${geelong.section}.mine.Q`), Math.round(r.valueOf(`${geelong.section}.full.Q`) * 100), "two owners' shares add to the whole loan, to the cent");
});

test("ESS is kept apart from capital gains: a same-day sale adds nothing to either twice", () => {
  const p = packs.JORDAN, ess = p.lines.filter((l) => l.section === "shares.ess"), parcels = p.lines.filter((l) => l.section === "shares.parcels");
  assert.equal(ess.reduce((s, l) => s + l.amount_cents, 0), L.tax.items.find((i) => i.fy === FY && i.party_id === "JORDAN" && i.label === "12").amount_cents);
  const sameDay = parcels.filter((l) => l.state === "nil");
  assert.ok(sameDay.length >= 2, "vest and sell on one day");
  for (const l of sameDay) { assert.equal(l.amount_cents, 0); assert.match(l.nil_basis, /ESS discount/); }
  const r = K.workbookTax.render(p);
  assert.equal(Math.round(r.valueOf("rs.18A") * 100), L.tax.items.find((i) => i.fy === FY && i.party_id === "JORDAN" && i.label === "18A").amount_cents);
  assert.equal(Math.round(r.valueOf("te.total.gains") * 100), L.tax.items.find((i) => i.fy === FY && i.party_id === "JORDAN" && i.label === "18H").amount_cents);
});

test("a payment tied to a property on the wrong category is raised, not claimed and not lost", () => {
  const lines = packs.MIA.lines.filter((l) => l.section === "property.RENTAL2.unclaimed");
  assert.equal(lines.length, 1); assert.equal(lines[0].amount_cents, 45500); assert.equal(lines[0].evidence_state, "at_risk");
  assert.ok(lines[0].evidence.length, "with the bill behind it");
  assert.ok(packs.MIA.gaps.some((g) => /rental cost, or not/.test(g.item) && g.amount_cents === 45500));
  assert.equal(Math.round(K.workbookTax.render(packs.MIA).valueOf("rs.21X") * 100), L.tax.items.find((i) => i.fy === FY && i.party_id === "MIA" && i.label === "21X").amount_cents, "and the engine's 21X is unchanged");
});

test("agent-paid and directly paid expenses are separate, and no entry is in both", () => {
  const p = packs.MIA, sec = "property.RENTAL";
  const agent = p.lines.filter((l) => l.section === `${sec}.agent`), direct = p.lines.filter((l) => l.section === `${sec}.direct` && !l.fields.from_loan && !/Div/.test(l.name));
  assert.ok(agent.length && direct.length);
  const refs = (rows) => new Set(rows.flatMap((l) => l.evidence.map((c) => `${c.ref}|${c.locator}`)));
  const a = refs(agent); for (const k of refs(direct)) assert.ok(!a.has(k), `${k} appears in both`);
});

test("every year of every Davies adult ties, so the pack is not shaped to one year", () => {
  const all = hh.at(null); let n = 0;
  for (const fy of ["FY2020", "FY2021", "FY2022", "FY2023", "FY2024", "FY2025", "FY2026", "FY2027"]) for (const person of PEOPLE) {
    const r = K.workbookTax.render(K.tax.build({ L: all, reference: hh.reference, person, fy, asOf: all.asOf }));
    for (const t of r.ties) { n += 1; assert.equal(Math.round(t.computed * 100), t.cents, `${fy} ${person} ${t.what}`); }
    assert.equal(r.valueOf("ln.diff"), 0, `${fy} ${person} loans`);
  }
  assert.ok(n > 500, `${n} ties`);
});

test("the blind held-out families tie too, and what the engine left out shows as not found", () => {
  for (const dir of ["heldout", "heldout2", "heldout3"]) {
    const { L: H } = heldout(dir), adults = [...new Set(H.memberships.filter((m) => m.role === "adult").map((m) => m.party_id))];
    for (const fy of ["FY2024", "FY2025", "FY2026"]) for (const person of adults) {
      const p = K.tax.build({ L: H, reference: hh.reference, person, fy, asOf: H.asOf }), r = K.workbookTax.render(p);
      for (const t of r.ties) assert.equal(Math.round(t.computed * 100), t.cents, `${dir} ${fy} ${person} ${t.what}`);
      assert.equal(r.valueOf("ln.diff"), 0, `${dir} ${fy} ${person}`);
    }
  }
});

test("money in the records on no label is a gap, never quietly added or dropped", () => {
  const { L: H } = heldout("heldout");
  const person = H.memberships.find((m) => m.role === "adult").party_id, p = K.tax.build({ L: H, reference: hh.reference, person, fy: "FY2024", asOf: H.asOf });
  const l = p.lines.find((x) => x.id === "summary.10");
  assert.equal(l.state, "not_found"); assert.equal(l.amount_cents, null);
  assert.ok(p.gaps.some((g) => /on no label/.test(g.item) && g.amount_cents > 0));
  const r = K.workbookTax.render(p);
  assert.equal(r.valueOf("rs.income.status"), "Incomplete");
});

// ---------- nothing missing shows as 0 ----------
const without = (test_) => hh.at(DAY, test_);
test("a missing document shows as not found, in the pack and in the sheet, and the totals say incomplete", () => {
  const ledger = without((s) => s.stream_id === "PHI-M" || s.stream_id === "QS-RENTAL2" || (s.stream_id === "DED-M" && s.captured_at >= "2024-07-01"));
  const p = build("MIA", ledger), r = K.workbookTax.render(p);
  const byId = new Map(p.lines.map((l) => [l.id, l]));
  assert.equal(byId.get("income.health.missing").state, "not_found");
  assert.equal(byId.get("income.health.missing").amount_cents, null);
  assert.equal(byId.get("property.RENTAL2.direct.sched.missing").amount_cents, null);
  for (const label of ["D3", "D10"]) assert.equal(byId.get(`summary.${label}`).state, "not_found", label);
  assert.ok(p.gaps.some((g) => /depreciation schedule/i.test(g.item)));
  assert.ok(p.gaps.some((g) => /Private health/.test(g.item) && g.owner === "taxpayer"));
  assert.equal(r.valueOf("rs.ded.status"), "Incomplete");
  assert.equal(r.valueOf("rs.taxable.status"), "Incomplete");
  assert.equal(r.valueOf("rs.D3"), "not found");
  const nf = sheetCells(r.book).filter(({ c }) => c.v === "not found" || c.cached === "not found");
  assert.ok(nf.length >= 6);
  for (const l of p.lines.filter((x) => x.state === "not_found")) assert.notEqual(l.amount_cents, 0, l.id);
});

test("confirmed nil and not found are different things", () => {
  const nil = packs.MIA.lines.find((l) => l.id === "summary.D4"), late = build("MIA", hh.at("2024-07-31"), { asOf: "2024-07-31" }).lines.find((l) => l.id === "summary.D4");
  assert.equal(nil.state, "nil"); assert.equal(nil.amount_cents, 0); assert.match(nil.nil_basis, /worksheet is held/);
  assert.equal(late.state, "not_found", "a week earlier the worksheet had not arrived, so the same label is unknown, not nil"); assert.equal(late.amount_cents, null);
  const r = K.workbookTax.render(packs.MIA);
  assert.equal(r.valueOf("rs.D4"), 0);
  assert.equal(packs.MIA.lines.find((l) => l.id === "memo.it1").state, "not_found", "a field nobody read is not nil");
  assert.equal(packs.MIA.lines.find((l) => l.id === "memo.it2").state, "nil", "a field the statement shows as none is");
});

test("a sale with no purchase held is a gap with no number, not a nil gain", () => {
  const ledger = Object.assign(Object.create(Object.getPrototypeOf(L)), L);
  ledger.lotMatches = [...L.lotMatches, { event_ref: "x", lot_id: "lot_none", instrument_id: "ZZZ", party_id: "JORDAN", disposed_on: "2024-03-01", units: "1", proceeds_cents: 1000, cost_base_cents: null, gain_cents: null, discount_eligible: true, method: "fifo", fy: FY }];
  const p = build("JORDAN", ledger), l = p.lines.find((x) => x.name.startsWith("ZZZ"));
  assert.equal(l.state, "not_found"); assert.equal(l.amount_cents, null);
  assert.ok(p.gaps.some((g) => /Purchase record for ZZZ/.test(g.item)));
});

// ---------- evidence ----------
for (const person of PEOPLE) test(`${person}: each line names its file with a page or row, and the file is in the zip`, () => {
  const r = zips[person], paths = new Set(r.parts.flatMap((p) => p.files.map((f) => f.path)));
  let cited = 0;
  for (const l of r.pack.lines) for (const c of l.evidence) {
    const e = r.pack.evidence.find((x) => x.ref === c.ref);
    assert.ok(paths.has(e.path), e.path);
    assert.ok(c.locator && c.locator.length, `${l.id} has a locator`);
    cited += 1;
  }
  assert.ok(cited > 200);
  for (const l of r.pack.lines.filter((x) => x.evidence_state === "held" && !x.section.endsWith(".summary") && x.kind !== "calculated" && !x.section.startsWith("shares.split") && x.state === "value")) assert.ok(l.evidence.length, `${l.id} says held with nothing cited`);
  const unit = r.pack.lines.filter((l) => l.evidence_state === "at_risk");
  assert.ok(unit.length, "a bank line alone is at risk");
  for (const l of unit.filter((x) => x.section === "income.work")) assert.ok(r.pack.gaps.some((g) => g.lines.includes(l.id)), `${l.id} has a gap`);
});

test("evidence is the person's own: Mia's zip has none of Jordan's payslips or worksheet, and neither carries the other's employer", () => {
  const names = (p) => zips[p].parts.flatMap((x) => x.files).map((f) => f.path).join("\n");
  assert.doesNotMatch(names("MIA"), /Jordans (income statement|deductions)/);
  assert.doesNotMatch(names("JORDAN"), /Mias (income statement|deductions)/);
  assert.ok(!packs.MIA.lines.some((l) => /Northwind/.test(l.name)));
});

test("the zip: workbook, evidence folder in order, one page cover note, manifest with every hash and what it supports", () => {
  const r = zips.MIA, part = r.parts[0], files = unz(part.bytes), names = files.map((f) => f.name);
  assert.ok(names.includes("Tax pack.xlsx") && names.includes("Cover note.pdf") && names.includes("manifest.csv"));
  const dirs = [...new Set(names.filter((n) => n.startsWith("evidence/")).map((n) => n.split("/")[1]))];
  assert.deepEqual(dirs, [...dirs].sort(), "folders are numbered in reading order");
  for (const n of names.filter((x) => x.startsWith("evidence/"))) assert.match(n.split("/")[2], /^\d{4}-\d{2}-\d{2} [A-Za-z0-9 .,()-]+\.[a-z0-9]+$/, n);
  const rows = parseCsv(text(files.find((f) => f.name === "manifest.csv").bytes)), head = rows[0], idx = (k) => head.indexOf(k);
  const listed = new Map(rows.slice(1).map((c) => [c[idx("path")], c]));
  for (const f of files.filter((x) => x.name !== "manifest.csv")) {
    const m = listed.get(f.name);
    assert.ok(m, `${f.name} is listed`);
    assert.equal(m[idx("sha256")], sha256(f.bytes), `${f.name} hash`);
    assert.equal(Number(m[idx("bytes")]), f.bytes.length);
    assert.ok(m[idx("supports")].length, `${f.name} says what it supports`);
  }
  const cover = text(files.find((f) => f.name === "Cover note.pdf").bytes);
  assert.equal((cover.match(/\/Type \/Page\b/g) || []).length, 1);
  assert.ok(part.size < 15e6);
  assert.match(cover, new RegExp(`Size: ${K.bundle.size(part.size).replace(".", "\\.")}`), "the note states the zip's real size");
});

test("no cloud links anywhere inside", () => {
  for (const person of PEOPLE) for (const part of zips[person].parts) for (const f of part.files) {
    if (f.path.startsWith("evidence/")) continue;
    const inner = f.path.endsWith(".xlsx") ? unz(f.bytes).map((x) => text(x.bytes)).join("\n") : text(f.bytes);
    const s = inner.replace(/xmlns(:\w+)?="[^"]+"/g, "").replace(/(Type|PartName)="[^"]+"/g, "");
    assert.doesNotMatch(s, /https?:\/\/|drive\.google|docs\.google|onedrive|sharepoint|dropbox/i, f.path);
  }
  const xml = unz(member(zips.MIA, "Tax pack.xlsx").bytes).filter((x) => /\.rels$/.test(x.name) && /worksheets/.test(x.name)).map((x) => text(x.bytes)).join("");
  const targets = [...xml.matchAll(/Target="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(targets.length > 20);
  for (const t of targets) assert.match(t, /^evidence\//, "a link in the workbook goes to a file beside it");
});

test("a rebuilt pack from the same input is byte-identical, however it was reached", () => {
  const again = K.bundle.render(K.tax.build({ L: hh.at(DAY), reference: JSON.parse(JSON.stringify(hh.reference)), person: "MIA", fy: FY, asOf: DAY }), NH.host(hh.world));
  assert.equal(again.parts[0].sha256, zips.MIA.parts[0].sha256);
  const fresh = NH.household();
  const third = K.bundle.render(K.tax.build({ L: fresh.at(DAY), reference: fresh.reference, person: "MIA", fy: FY, asOf: DAY }), NH.host(fresh.world));
  assert.deepEqual(Buffer.from(third.parts[0].bytes), Buffer.from(zips.MIA.parts[0].bytes));
});

test("too big for an email: it splits, warns, says so, and loses nothing", () => {
  const whole = zips.MIA.parts[0], limit = 90 * 1000, r = K.bundle.render(packs.MIA, host, { limit });
  assert.ok(r.parts.length >= 2, `${r.parts.length} parts`);
  assert.ok(r.warnings.some((w) => /Too big for one email/.test(w)));
  assert.match(text(member(r, "Cover note.pdf").bytes), /in \d+ parts/);
  r.parts.forEach((p, i) => {
    assert.match(p.name, new RegExp(`part-${i + 1}-of-${r.parts.length}\\.zip$`));
    assert.ok(unz(p.bytes).some((f) => f.name === "manifest.csv"), "each part carries the manifest");
    assert.ok(p.size <= limit, `${p.name} is ${p.size}`);
  });
  const got = r.parts.flatMap((p) => unz(p.bytes).map((f) => f.name)).filter((n) => n.startsWith("evidence/")).sort(), want = unz(whole.bytes).map((f) => f.name).filter((n) => n.startsWith("evidence/")).sort();
  assert.deepEqual(got, want);
  const fat = K.bundle.render(packs.MIA, { ...host, deflateRaw: null, readSource: (e) => (e.ref === "E003" ? new Uint8Array(3000) : host.readSource(e)), sha256: (b) => (b.length === 3000 ? packs.MIA.evidence.find((e) => e.ref === "E003").sha256 : host.sha256(b)) }, { limit: 2000 });
  assert.ok(fat.warnings.some((w) => /part of its own|Too big/.test(w)));
});

// ---------- tax file numbers ----------
const TFN = "123 456 782";            // the check digit passes; it is the classic made-up test number
test("the gate knows a TFN and leaves amounts, account numbers and hashes alone", () => {
  assert.ok(K.tfn.check("123456782")); assert.ok(!K.tfn.check("123456789"));
  assert.ok(K.tfn.scanText(`TFN ${TFN}`).length); assert.ok(K.tfn.scanText("Tax file number: 12345678").length);
  for (const fine of ["$123,456,782.00", "123456789", "033-142 812 006 310", `a${"1".repeat(63)}`]) assert.equal(K.tfn.scanText(fine).length, 0, fine);
});
test("every generated file of every kind carries no tax file number", () => {
  const kit = K.xlsx.write(K.workbookTax.render(K.blank.build({ fy: "FY2026", reference: hh.reference })).book, { deflateRaw: host.deflateRaw, date: "2026-06-30" });
  const lender = K.bundle.render(K.lender.build({ L: hh.at("2026-11-30"), people: PEOPLE, asOf: "2026-11-30" }), host);
  const back = K.bundle.render(K.takeback.take(packs.JORDAN, hh.at("2024-09-30"), hh.reference), host);
  for (const r of [zips.JORDAN, zips.MIA, lender, back]) { assert.ok(K.bundle.assertNoTfn(r, host)); for (const f of r.parts.flatMap((p) => p.files)) { const { hits, opaque } = K.tfn.scanFile(f.path, f.bytes, host.inflate); assert.equal(hits.length, 0, f.path); assert.equal(opaque, 0, `${f.path} could not be read, so it was not checked`); } }
  assert.equal(K.tfn.scanFile("kit.xlsx", kit, host.inflate).hits.length, 0);
  assert.ok(K.tfn.textOf("Tax pack.xlsx", member(zips.MIA, "Tax pack.xlsx").bytes, host.inflate).text.length > 2000, "the scan really reads the workbook");
  const pdf = K.tfn.textOf("x.pdf", member(zips.MIA, "Cover note.pdf").bytes, host.inflate).text;
  assert.match(pdf, /Mia Davies/, "and the cover note");
  const world = zips.MIA.pack.evidence.find((e) => /\.pdf$/.test(e.path));
  assert.match(K.tfn.textOf(world.path, host.readSource(world), host.inflate).text, /[A-Za-z]{4}/, "and an evidence PDF, deflated and hex encoded as it is");
});
test("a generated file with a TFN in it stops the run", () => {
  const r = K.bundle.render(packs.MIA, host), f = member(r, "manifest.csv");
  f.bytes = new TextEncoder().encode(`${text(f.bytes)}\n${TFN}`);
  assert.throws(() => K.bundle.assertNoTfn(r, host), /tax file number/);
});
const plantIn = (fmt) => {
  if (fmt === "csv") return new TextEncoder().encode(`Date,Note\n2024-01-01,Member ${TFN}\n`);
  if (fmt === "pdf") { const d = new Doc({ brand: { name: "X", color: "#112233" }, title: "T", deflate: (b) => zlib.deflateSync(b) }); d.h1("Notice"); d.para(`Tax file number ${TFN}`); return new Uint8Array(d.finish()); }
  return K.zip.write([["xl/sharedStrings.xml", `<sst><si><t>TFN ${TFN}</t></si></sst>`]], { deflateRaw: host.deflateRaw });
};
for (const fmt of ["csv", "pdf", "xlsx"]) test(`evidence with a TFN stays out of the zip and becomes an open item: ${fmt}`, () => {
  const p = JSON.parse(JSON.stringify(packs.MIA)), victim = p.evidence.find((e) => e.ref === "E002"), planted = plantIn(fmt);
  victim.original_name = `statement.${fmt}`;
  const h = { ...host, readSource: (e) => (e.ref === "E002" ? planted : host.readSource(e)), sha256: (b) => (b === planted ? victim.sha256 : host.sha256(b)) };
  const r = K.bundle.render(p, h);
  assert.ok(!r.parts.flatMap((x) => x.files).some((f) => f.path === victim.path), "the file is not in the zip");
  assert.ok(r.pack.gaps.some((g) => /possible tax file number/.test(g.item) && g.owner === "taxpayer"));
  assert.ok(r.pack.lines.filter((l) => l.evidence.some((c) => c.ref === "E002")).every((l) => l.evidence_state === "at_risk" || l.evidence_state === "missing"));
  assert.ok(K.bundle.assertNoTfn(r, h));
  assert.match(text(member(r, "manifest.csv").bytes), /held back/);
});
test("a file that cannot be read is held back until a person clears it", () => {
  const p = JSON.parse(JSON.stringify(packs.MIA)), victim = p.evidence.find((e) => e.ref === "E002");
  victim.original_name = "scan.png";
  const held = K.bundle.render(p, host);
  assert.ok(held.pack.gaps.some((g) => /not checked/.test(g.item)));
  assert.ok(!held.parts.flatMap((x) => x.files).some((f) => f.path === victim.path));
  const ok = K.bundle.render(p, host, { clear: [victim.sha256] });
  assert.ok(ok.parts.flatMap((x) => x.files).some((f) => f.path === victim.path));
});
test("a file whose bytes changed, or are not here, cannot stand behind a number", () => {
  const h = { ...host, readSource: (e) => (e.ref === "E001" ? new Uint8Array([1, 2, 3]) : e.ref === "E002" ? null : host.readSource(e)) };
  const r = K.bundle.render(packs.MIA, h);
  assert.ok(r.pack.gaps.some((g) => /has changed/.test(g.item))); assert.ok(r.pack.gaps.some((g) => /not to hand/.test(g.item)));
});

// ---------- dated law ----------
test("the CGT method is read by date and never assumed", () => {
  assert.equal(K.tax.cgtMethod(hh.reference, "2024-06-30").rate, hh.reference.series.cgt_discount_individual.rows[0].value.rate);
  const after = K.tax.cgtMethod(hh.reference, "2028-06-30");
  assert.equal(after.rate, null, "past the date in the watch list the pack holds the rate back");
  assert.ok(after.watch && after.watch.confirmed === false, "and says the date is unconfirmed");
  const doctored = JSON.parse(JSON.stringify(hh.reference)); doctored.series.cgt_discount_individual.rows[0].value.rate = 0.4;
  const p = build("JORDAN", L, { reference: doctored }), r = K.workbookTax.render(p);
  assert.equal(r.valueOf("te.cgt.rate"), 0.4, "the sheet takes the rate from the reference");
  const elig = r.valueOf("cg.eligible") - r.valueOf("te.used.disc");
  assert.equal(r.valueOf("te.net.gain"), Math.round((Math.floor(elig * 0.4 * 100 + 1e-6) / 100 + r.valueOf("cg.other") - r.valueOf("te.used.other")) * 100) / 100);
});
test("a disposal past the watch date holds the net gain back and asks", () => {
  const ledger = Object.assign(Object.create(Object.getPrototypeOf(L)), L), all = hh.at(null);
  Object.assign(ledger, all);
  ledger.lotMatches = [...all.lotMatches, { event_ref: "x", lot_id: "lot_1", instrument_id: "KBBL", party_id: "JORDAN", disposed_on: "2027-09-01", units: "1", proceeds_cents: 200000, cost_base_cents: 100000, gain_cents: 100000, discount_eligible: true, method: "fifo", fy: "FY2028" }];
  const p = build("JORDAN", ledger, { fy: "FY2028", asOf: "2028-08-01" });
  const l = p.lines.find((x) => x.id === "summary.18A");
  assert.equal(l.state, "not_found"); assert.equal(l.amount_cents, null);
  assert.ok(p.gaps.some((g) => g.owner === "accountant" && /CGT method/.test(g.item)));
  const r = K.workbookTax.render(p);
  assert.equal(r.valueOf("te.net.gain"), "not found");
});
test("tax tables come from the reference: change it and the sheet follows, and no rate is typed in this folder", () => {
  const doctored = JSON.parse(JSON.stringify(hh.reference));
  for (const row of doctored.series.resident_tax_brackets.rows) row.value = row.value.map((b) => (Array.isArray(b) ? [b[0], b[1] / 2, b[2], (b[3] ?? b[1]) / 2] : { ...b, rate: b.rate / 2 }));
  const r0 = K.workbookTax.render(packs.MIA), p = build("MIA", L, { reference: doctored }), pSame = JSON.parse(JSON.stringify(p));
  for (const l of pSame.lines) if (l.id === "estimate.gross") l.amount_cents = null;
  const r1 = K.workbookTax.render({ ...pSame, lines: pSame.lines.filter((l) => !l.section.startsWith("estimate.")) });
  assert.ok(Math.abs(r1.valueOf("te.gross") - r0.valueOf("te.gross") / 2) < 1, "halve the rates, halve the tax");
  const src = fs.readdirSync(__dirname).filter((f) => /\.js$/.test(f) && !/test/.test(f)).map((f) => fs.readFileSync(path.join(__dirname, f), "utf8")).join("\n").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const typed of ["18200", "45000", "135000", "190000", "0.325", "250000", "0.02,", "0.67"]) assert.ok(!src.includes(typed), `${typed} is typed in the source`);
});

test("estimates are labelled indicative wherever they appear", () => {
  const r = K.workbookTax.render(packs.MIA), te = r.book.sheets.find((s) => s.name === "Tax Estimate"), rs = r.book.sheets.find((s) => s.name === "Return Summary");
  assert.match(te.rows[0][0].v, /INDICATIVE ONLY/);
  assert.ok(rs.rows.flat().some((c) => c && /INDICATIVE ONLY/.test(c.v || "")));
  assert.equal(r.valueOf("rs.taxable.status"), "Indicative");
  assert.match(text(member(zips.MIA, "Cover note.pdf").bytes), /indicative/);
  assert.match(text(member(zips.MIA, "Cover note.pdf").bytes), /not lodged/);
});

// ---------- open items ----------
test("open items split what the taxpayer owes from what is left to the accountant, and name the year's real questions", () => {
  const m = packs.MIA.gaps, j = packs.JORDAN.gaps;
  for (const g of [...m, ...j]) assert.ok(["taxpayer", "accountant"].includes(g.owner));
  assert.ok(m.some((g) => g.owner === "accountant" && /First rent came after purchase, Ballarat/.test(g.item)));
  assert.ok(m.some((g) => g.owner === "accountant" && /Repair shortly after purchase, Ballarat/.test(g.item) && g.amount_cents === 28600));
  assert.ok(m.some((g) => g.owner === "accountant" && /FY2023 was amended/.test(g.item)));
  assert.ok(m.some((g) => g.owner === "taxpayer" && /Strata levies/.test(g.item)));
  assert.ok(j.some((g) => g.owner === "accountant" && /Crypto swapped/.test(g.item)));
  assert.ok(j.some((g) => g.owner === "accountant" && /Foreign currency/.test(g.item)));
  const r = K.workbookTax.render(packs.MIA), oi = r.book.sheets.find((s) => s.name === "Open Items").rows.flat().map((c) => c && c.v).join("\n");
  for (const g of m) assert.ok(oi.includes(g.item), g.item);
});

// ---------- take it back ----------
test("what the Standard already does: lodged returns stay evidence, versions append, the tie reads the latest", () => {
  const all = hh.at(null), rs = all.returns.returns.filter((r) => r.party_id === "MIA" && r.fy === "FY2023").sort((a, b) => a.version - b.version);
  assert.deepEqual(rs.map((r) => r.version), [1, 2]);
  assert.equal(rs[1].supersedes_return_id, rs[0].return_id);
  assert.notEqual(rs[0].taxable_income_cents, rs[1].taxable_income_cents);
  assert.ok(all.returns.lines.some((l) => l.return_id === rs[0].return_id), "the earlier lines are still there");
  const tie = all.tax.ties.find((t) => t.person === "MIA" && t.fy === "FY2023");
  assert.equal(tie.status, "pass"); assert.equal(tie.lodged, rs[1].taxable_income_cents);
  const payment = all.events.filter((e) => e.kind === "tax_assessed" && e.person === "MIA" && e.occurred_on.startsWith("2024-03"));
  assert.equal(payment.length, 1, "the amended assessment posts once");
  assert.ok(Math.abs(payment[0].amount_cents) <= Math.abs(rs[0].result_cents - rs[1].result_cents) + 100, "and only the change");
});
test("a return that comes back reconciles against the draft, label by label, and the draft is untouched", () => {
  const before = K.pack.canonical(packs.JORDAN), after = hh.at("2024-09-30");
  const rec = K.takeback.reconcile(packs.JORDAN, after);
  assert.equal(rec.status, "ties"); assert.equal(rec.taxable.gap, 0); assert.ok(Math.abs(rec.result.gap) < 100, "within the assessment's rounding credit");
  assert.equal(rec.return.version, 1);
  assert.ok(rec.lines.length > 15);
  for (const l of rec.lines) assert.equal(l.status, "ties", l.label);
  const next = K.takeback.take(packs.JORDAN, after, hh.reference);
  assert.equal(next.version, 2); assert.equal(next.supersedes, "tax-JORDAN-FY2024 version 1"); assert.equal(next.state, "assessed");
  assert.equal(K.pack.canonical(packs.JORDAN), before, "version 1 is not changed by taking version 2");
  assert.ok(next.evidence.some((e) => /Notice-of-Assessment-Jordan-FY2024/.test(e.original_name)), "the notice comes back as evidence");
  assert.ok(next.evidence.some((e) => /Tax-Return-Jordan-FY2024/.test(e.original_name)), "and the return");
  const r = K.bundle.render(next, host), wb = r.parts[0].files.find((f) => f.path === "Tax pack.xlsx");
  assert.ok(text(unz(wb.bytes).find((f) => f.name === "xl/workbook.xml").bytes).includes('name="Lodged"'));
  assert.match(r.parts[0].name, /-v2\.zip$/, "a new file, not the same name");
  assert.equal(K.takeback.reconcile(packs.JORDAN, L), null, "nothing has come back on the day of the draft");
});
test("a prior-year amendment: the draft catches what the first return missed, version 2 is held beside version 1", () => {
  const draft = K.tax.build({ L: hh.at("2023-08-05"), reference: hh.reference, person: "MIA", fy: "FY2023", asOf: "2023-08-05" });
  const firstBack = hh.at("2023-10-01"), rec1 = K.takeback.reconcile(draft, firstBack);
  assert.equal(rec1.return.version, 1);
  assert.equal(rec1.status, "differs", "the return left out a tax statement the household already held");
  assert.ok(rec1.taxable.gap < 0, "lodged taxable income is below the draft");
  assert.ok(rec1.lines.filter((l) => l.status === "differs").some((l) => l.label === "13U" || l.label === "20M"));
  const v2pack = K.takeback.take(draft, firstBack, hh.reference);
  assert.ok(v2pack.gaps.some((g) => /differs from the draft/.test(g.item) && g.owner === "accountant"));
  const amended = hh.at("2024-03-31"), rec2 = K.takeback.reconcile(v2pack, amended);
  assert.equal(rec2.return.version, 2); assert.equal(rec2.return.status, "amended");
  assert.equal(rec2.status, "ties", "the amended return lands where the draft already was");
  assert.deepEqual(rec2.versions.map((v) => [v.version, v.status]), [[1, "superseded, kept"], [2, "amended"]]);
  assert.notEqual(rec2.versions[0].taxable_income_cents, rec2.versions[1].taxable_income_cents, "the earlier figures are still readable");
  const v3 = K.takeback.take(v2pack, amended, hh.reference);
  assert.equal(v3.version, 3); assert.equal(v3.state, "amended");
  assert.equal(v3.lines.filter((l) => l.section === "prior.returns" && l.fields.fy === "FY2023").length, 2, "both versions in the pack");
  assert.ok(v3.lines.some((l) => l.section === "prior.returns" && l.fields.status === "Superseded, kept"));
  const r = K.bundle.render(v3, host);
  for (const n of ["Tax-Return-Mia-FY2023.pdf", "Tax-Return-Mia-FY2023-amended.pdf"]) assert.ok(r.pack.evidence.some((e) => e.original_name === n), n);
});
test("the next year's pack shows the amendment and hands over the prior year", () => {
  const prior = packs.MIA.lines.filter((l) => l.section === "prior.returns");
  assert.deepEqual(prior.map((l) => [l.fields.fy, l.fields.version, l.fields.status]), [["FY2023", 1, "Superseded, kept"], ["FY2023", 2, "Amended"]]);
  for (const l of prior) assert.equal(l.evidence_state, "held");
});

// ---------- the second instance ----------
const lender = K.lender.build({ L: hh.at("2026-11-30"), people: PEOPLE, asOf: "2026-11-30" });
test("a lender's pack uses the same shape and the same zip, with no tax code", () => {
  assert.equal(lender.standard, K.pack.STANDARD);
  assert.equal(lender.scope.people.length, 2, "two people, one pack");
  assert.ok(lender.lines.some((l) => l.basis === "stock" && l.as_at), "a balance on a date");
  assert.ok(lender.lines.some((l) => l.basis === "flow"), "and income over a period");
  const limit = lender.lines.find((l) => /limit$/.test(l.name));
  assert.equal(limit.state, "not_found", "a limit nobody recorded is unknown, not 0");
  assert.equal(limit.amount_cents, null);
  assert.ok(lender.gaps.some((g) => /Credit limit/.test(g.item)));
  const r = K.bundle.render(lender, host, { stem: "lender" });
  const names = unz(r.parts[0].bytes).map((f) => f.name);
  assert.ok(names.includes("Pack.xlsx") && names.includes("manifest.csv") && names.includes("Cover note.pdf") && names.some((n) => n.startsWith("evidence/")));
  assert.equal(r.parts[0].sha256, K.bundle.render(lender, host, { stem: "lender" }).parts[0].sha256);
  const sheets = K.workbookGeneric.render(lender).book.sheets.map((s) => s.name);
  assert.deepEqual(sheets, ["Summary", "Lines", "Evidence", "Open Items"]);
  const debts = lender.lines.filter((l) => l.section === "liabilities.summary" && l.state === "value");
  for (const d of debts) assert.equal(d.basis, "stock");
  assert.ok(lender.lines.filter((l) => l.id.startsWith("debt.")).every((l) => l.evidence_state === "held"));
});

// ---------- the blank kit ----------
test("the blank kit is the same workbook, with live formulas, and an empty cell is not found, never 0", () => {
  const p = K.blank.build({ fy: "FY2026", reference: hh.reference }), r = K.workbookTax.render(p);
  const names = r.book.sheets.map((s) => s.name);
  for (const n of ["Return Summary", "Income", "Shares", "Property 1", "Loan Interest", "Tax Estimate", "Open Items"]) assert.ok(names.includes(n), n);
  assert.equal(r.valueOf("rs.1"), "not found");
  assert.equal(r.valueOf("rs.income.status"), "Incomplete");
  assert.equal(r.valueOf("te.result"), "not found");
  const text_ = sheetCells(r.book).map(({ c }) => c.v).filter((v) => typeof v === "string").join(" ");
  assert.doesNotMatch(text_, /Davies|Jordan|Mia\b|Person A/);
  assert.equal(sheetCells(r.book).filter(({ sheet, c }) => sheet !== "Tax Estimate" && c.v === 0 && !c.key).length, 0, "the only zeros typed anywhere are thresholds in the rate tables");
  // fill it in and the answer comes out: the kit's arithmetic is the pack's arithmetic
  const filled = JSON.parse(JSON.stringify(p));
  const set = (id, cents, fields) => { const l = filled.lines.find((x) => x.id === id); l.amount_cents = cents; l.state = "value"; Object.assign(l.fields, fields || {}); };
  set("income.employment.0", 10000000, { payg_cents: 2000000 });
  const w = K.workbookTax.render(filled);
  assert.equal(w.valueOf("rs.1"), 100000);
  assert.equal(typeof w.valueOf("te.gross"), "number");
  const year = hh.reference.series.resident_tax_brackets.rows.find((x) => x.valid_from <= "2026-06-30" && (!x.valid_to || "2026-06-30" < x.valid_to)).value.map((b) => (Array.isArray(b) ? { from: b[0], rate: b[1] } : b));
  let tax = 0; year.forEach((b, i) => { const hi = year[i + 1] ? year[i + 1].from : Infinity; if (100000 > b.from) tax += (Math.min(100000, hi) - b.from) * b.rate; });
  assert.ok(Math.abs(w.valueOf("te.gross") - tax) < 0.01);
  assert.equal(w.valueOf("te.payg"), 20000);
});

// ---------- one core, two hosts ----------
test("the same code runs with no Node: same bytes in a bare context, through a host", () => {
  const ctx = vm.createContext({ TextEncoder, TextDecoder, Uint8Array, DataView, ArrayBuffer, Math, JSON, Map, Set, Number, String, Array, Object, RegExp, Error, Date: undefined });
  vm.runInContext("var self = this;", ctx);
  const order = K.ORDER.map((m) => `${K.FILE[m] || m}.js`);
  for (const f of ["pack.js", "formula.js", "zip.js", "xlsx.js", "pdf.js", "tfn.js", "evidence.js", "tax.js", "workbook-tax.js", "workbook-generic.js", "bundle.js", "takeback.js", "lender.js", "blank.js"]) assert.ok(order.includes(f));
  for (const f of order) vm.runInContext(fs.readFileSync(path.join(__dirname, f), "utf8"), ctx, { filename: f });
  assert.ok(!vm.runInContext("typeof require + typeof process + typeof Buffer + typeof module", ctx).includes("function"));
  const pure = { readSource: host.readSource, sha256: (b) => sha256(b), deflateRaw: null, inflate: host.inflate };
  const inPage = vm.runInContext("(function (L, reference, host, K) { const p = K.tax.build({ L, reference, person: 'MIA', fy: 'FY2024', asOf: '2024-08-05' }); return K.bundle.render(p, host); })", ctx)(L, hh.reference, pure, vm.runInContext("self.KittyPack", ctx));
  const inNode = K.bundle.render(packs.MIA, pure);
  assert.equal(Buffer.compare(Buffer.from(inPage.parts[0].bytes), Buffer.from(inNode.parts[0].bytes)), 0);
  assert.ok(inPage.parts[0].size > 0);
  assert.ok(unz(inPage.parts[0].bytes).length > 90, "a stored zip is still a zip");
});
test("only the Node host touches Node", () => {
  for (const f of fs.readdirSync(__dirname).filter((x) => /\.js$/.test(x) && !/^(test|node-host|cli)/.test(x))) {
    const s = fs.readFileSync(path.join(__dirname, f), "utf8");
    assert.doesNotMatch(s, /require\(["'](fs|path|zlib|crypto|os|child_process)["']\)|process\.|Buffer\.|__dirname/, f);
    assert.doesNotMatch(s, /Date\.now|new Date\(|Math\.random/, `${f} must not read a clock or dice`);
  }
});

// ---------- public files ----------
test("the examples in docs are what this code makes, and they are fiction", { skip: !fs.existsSync(path.join(NH.repo, "docs", "examples", "tax-pack")) }, () => {
  const { examples } = require("./cli.js"), os = require("os"), tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pack-"));
  examples(hh, host, tmp);
  const open = (bytes) => { const out = new Map(); for (const f of unz(bytes)) { if (f.name.endsWith(".xlsx")) for (const g of unz(f.bytes)) out.set(`${f.name}!${g.name}`, sha256(g.bytes)); else out.set(f.name, sha256(f.bytes)); } return out; };
  for (const dir of ["tax-pack", "lender-pack"]) for (const f of fs.readdirSync(path.join(tmp, dir))) {
    const made = open(new Uint8Array(fs.readFileSync(path.join(tmp, dir, f)))), kept = open(new Uint8Array(fs.readFileSync(path.join(NH.repo, "docs", "examples", dir, f))));
    assert.deepEqual([...kept.keys()].sort(), [...made.keys()].sort(), f);
    for (const [k, v] of made) assert.equal(kept.get(k), v, `${f}: ${k}`);
  }
  fs.rmSync(tmp, { recursive: true });
});

void allocate;
