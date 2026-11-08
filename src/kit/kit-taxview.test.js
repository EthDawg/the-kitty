// node --test test/kit-taxview.test.js: the Tax view module on the Davies data in data/v3/ and the Tax Forecast tab.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const T = require("./taxview.js");
const input = require("../../tools/kit-demo/taxview.data.js");
const snap = require("../../data/snapshot-v2.json");

const near = (a, b, msg, tol = 0.005) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} is not ${b}`);
const forecast = (label, col) => snap.tax.find((r) => r.label === label)[col];
const fresh = () => JSON.parse(JSON.stringify(input()));
const m = T.model(input());

test("a missing tab gives no model, so the page leaves the view dark", () => {
  assert.equal(T.model(null), null);
  assert.equal(T.model({}), null);
  assert.equal(T.model({ people: ["A"], returns: [] }), null);
  assert.equal(T.render(null), "");
});

test("the Davies data reads clean", () => {
  assert.deepEqual(m.people, ["Jordan", "Mia"]);
  assert.equal(m.asOf, "2027-01-31");
  assert.deepEqual(m.problems, []);
  assert.equal(m.current.fy, "FY27");
  assert.equal(m.current.monthsElapsed, 7);
  near(m.current.factor, 12 / 7, "projection factor", 1e-9);
  assert.deepEqual(m.current.period, { from: "July 2026", to: "January 2027", endYear: 2027 });
});

test("this year: each person's estimate ties to the Tax Forecast's corrected figures", () => {
  const j = m.current.who.Jordan, mi = m.current.who.Mia;
  near(j.taxable, forecast("Corrected taxable income", "cur_j"), "Jordan taxable");
  near(mi.taxable, forecast("Corrected taxable income", "cur_m"), "Mia taxable");
  near(j.result, forecast("Corrected refund (negative means tax payable)", "cur_j"), "Jordan refund");
  near(mi.result, forecast("Corrected refund (negative means tax payable)", "cur_m"), "Mia refund");
  near(j.result, 2610.86, "Jordan refund in dollars and cents");
  near(mi.result, 3041.84, "Mia refund in dollars and cents");
  for (const p of [j, mi]) {
    near(p.result, p.withheld - (p.tax + p.medicare - p.offsets), `${p.name} result is withheld less tax, Medicare and offsets`, 0.01);
    near(p.taxable, p.salary + p.otherIncome + p.rentNet - p.deductionsTotal, `${p.name} taxable income is income, rent and deductions`, 0.01);
    near(p.medicare, p.taxable * 0.02, `${p.name} Medicare is 2% of taxable income`, 0.01);
  }
  assert.equal(m.current.who.Jordan.shown.result, 2611);
  assert.equal(m.current.who.Mia.shown.result, 3042);
});

test("this year: the flagged donation is held out, and the refund at risk is what it would add", () => {
  const j = m.current.who.Jordan;
  assert.equal(j.flagged.length, 1);
  assert.equal(j.flagged[0].label, "Donations");
  assert.equal(j.flagged[0].amount, 100);
  assert.ok(!j.deductions.some((d) => d.flagged), "no flagged item counts toward taxable income");
  near(j.atRisk, forecast("Refund at risk", "cur_j"), "refund at risk");
  near(j.flagged[0].atRisk, 32, "the $100 donation carries $32 at 30% plus Medicare");
  near(j.resultIfAllowed, forecast("Estimated refund (negative means tax payable)", "cur_j"), "with the receipt, the as-recorded estimate");
  assert.equal(m.current.who.Mia.flagged.length, 0);
});

test("this year: Together sums both people", () => {
  const t = m.current.who.together, j = m.current.who.Jordan, mi = m.current.who.Mia;
  assert.equal(t.together, true);
  assert.deepEqual(t.people, ["Jordan", "Mia"]);
  for (const k of ["salary", "withheld", "otherIncome", "rentNet", "taxable", "tax", "medicare", "bill", "result", "atRisk", "deductionsTotal"]) near(t[k], j[k] + mi[k], `Together ${k}`, 1e-6);
  near(t.result, forecast("Household corrected refund", "cur_j"), "household corrected refund");
  near(t.atRisk, forecast("Household refund at risk", "cur_j"), "household refund at risk");
  assert.deepEqual(t.deductions.map((d) => [d.label, Math.round(d.amount * 100) / 100]), [["Work-related expenses", 601], ["Work from home", 528]]);
  assert.equal(t.flagged.length, 1);
  assert.equal(t.flagged[0].person, "Jordan");
  assert.equal(t.shown.result, 5653);
});

test("the waterfall chains from income to the result, and its whole dollars add up", () => {
  for (const key of ["Jordan", "Mia", "together"]) {
    const p = m.current.who[key], s = Object.fromEntries(p.steps.map((x) => [x.key, x])), sh = p.shown;
    assert.deepEqual(p.steps.map((x) => x.key), ["income", "rent", "deductions", "taxable", "tax", "medicare", "bill", "withheld", "result"]);
    near(s.rent.to, s.income.to, `${key} rental loss starts where income ends`, 1e-6);
    near(s.deductions.to, s.rent.from, `${key} deductions start where the rental loss ends`, 1e-6);
    near(s.deductions.from, s.taxable.to, `${key} deductions end at taxable income`, 0.01);
    near(s.medicare.from, s.tax.to, `${key} Medicare sits on top of tax`, 1e-6);
    near(s.medicare.to, s.bill.to, `${key} tax plus Medicare is the tax for the year`, 1e-6);
    near(s.result.to - s.result.from, Math.abs(p.result), `${key} the refund is the gap between withheld and tax`, 0.01);
    assert.equal(s.result.kind, "good");
    assert.equal(sh.income + sh.rentNet - sh.deductionsTotal, sh.taxable, `${key} income less rent and deductions = taxable`);
    assert.equal(sh.salary + sh.otherIncome, sh.income, `${key} salary and other income = income`);
    assert.equal(sh.deductions.reduce((a, b) => a + b, 0), sh.deductionsTotal, `${key} deduction lines = deductions`);
    assert.equal(sh.tax + sh.medicare - sh.offsets, sh.bill, `${key} tax + Medicare = tax for the year`);
    assert.equal(sh.withheld - sh.bill, sh.result, `${key} withheld less tax = result`);
    assert.equal(sh.result, Math.round(p.result), `${key} the result is the rounded estimate`);
    assert.ok(p.scale.lo === 0 && p.scale.hi >= p.income, `${key} one scale from $0 to the largest bar`);
  }
});

test("whole dollars that add up never move a part by more than a dollar", () => {
  assert.deepEqual(T.tie(13209, [11791.49, 1418.1]), [11791, 1418]);
  assert.deepEqual(T.tie(223352, [222060.72, 1291.53]), [222061, 1291]);
  const parts = [10.4, 10.4, 10.4], got = T.tie(31, parts);
  assert.equal(got.reduce((a, b) => a + b, 0), 31);
  got.forEach((g, i) => assert.ok(Math.abs(g - parts[i]) < 1));
  assert.deepEqual(T.tie(100, [1.2, 2.2]), [1, 2], "a real gap is left alone");
});

test("every return row: result = withheld - (tax + Medicare - offsets)", () => {
  assert.equal(m.rows.length, 10);
  for (const r of m.rows) {
    assert.ok(r.ok, `${r.person} ${r.fy} reads`);
    near(r.result, r.withheld - (r.tax + r.medicare - r.offsets), `${r.person} ${r.fy}`, 0.01);
    assert.equal(r.shown.withheld - (r.shown.tax + r.shown.medicare - r.shown.offsets), r.shown.result, `${r.person} ${r.fy} whole dollars add up`);
  }
});

test("last year is FY26 and ties to the Tax Forecast's corrected refunds to the cent", () => {
  assert.equal(m.last.fy, "FY26");
  const j = m.last.by.Jordan, mi = m.last.by.Mia;
  assert.equal(j.status, "Assessed");
  assert.equal(mi.status, "Assessed");
  near(j.result, 3691.0, "Jordan FY26");
  near(mi.result, 3682.66, "Mia FY26");
  near(j.result, forecast("Corrected refund (negative means tax payable)", "prior_j"), "Jordan ties to the Tax Forecast");
  near(mi.result, forecast("Corrected refund (negative means tax payable)", "prior_m"), "Mia ties to the Tax Forecast");
  near(j.taxable, forecast("Corrected taxable income", "prior_j"), "Jordan FY26 taxable income");
  near(mi.taxable, forecast("Corrected taxable income", "prior_m"), "Mia FY26 taxable income");
  near(m.last.together.result, forecast("Household corrected refund", "prior_j"), "household FY26");
  assert.equal(m.last.together.shown, 7374);
  assert.equal(m.last.before.Jordan.fy, "FY25");
  assert.equal(j.lodged, "2026-09-04");
  assert.equal(j.notice, "2026-09-22");
});

test("the FY27 estimate rows on Tax Returns match the year so far", () => {
  for (const p of m.people) {
    const est = m.rows.find((r) => r.person === p && r.fy === "FY27");
    assert.equal(est.status, "Estimate");
    near(est.result, m.current.who[p].result, `${p} FY27`, 0.01);
    near(est.taxable, m.current.who[p].taxable, `${p} FY27 taxable`, 0.01);
  }
});

test("history runs oldest to newest, with the amended year and its note", () => {
  const H = m.history;
  assert.deepEqual(H.years, ["FY23", "FY24", "FY25", "FY26", "FY27"]);
  for (const p of m.people) assert.deepEqual(H.by[p].map((r) => r.fy), H.years);
  const fy24 = H.by.Jordan[1];
  assert.equal(fy24.status, "Amended");
  assert.match(fy24.note, /rental repair reclassed as capital works/);
  assert.equal(H.by.Jordan[4].estimate, true);
  assert.deepEqual(H.together.map((t) => t.shown), [3, -258, 4360, 7374, 5653]);
  assert.ok(H.together.every((t) => t.complete));
  near(H.scale.lo, -818.2, "lowest result");
  near(H.scale.hi, 3691, "highest result");
  near(H.scale.taxMax, 133746.41, "tallest taxable income", 0.01);
});

test("what's missing is derived from the sheet", () => {
  const miss = m.current.missing, labels = miss.map((x) => x.label);
  assert.ok(labels.includes("Income statement from Northwind Logistics"));
  assert.ok(labels.includes("Income statement from Bayview Health"));
  assert.ok(labels.includes("Donation receipt for $100 to The Smith Family"));
  assert.ok(labels.includes("Rental statement for the year from Bayside Property Mgmt"));
  assert.ok(labels.includes("Bupa health cover statement"));
  assert.ok(labels.includes("3 transactions to sort, $268"));
  const wfh = miss.find((x) => x.label === "Work-from-home hours");
  assert.equal(wfh.person, "Jordan");
  assert.match(wfh.why, /440 hours so far, about 754 by 30 June/);
  assert.equal(miss.find((x) => /Northwind/.test(x.label)).when, "July 2027");
  assert.equal(miss[0].when, "Now");
});

test("render: controls, the Together note, the estimate wording and the footer in every view", () => {
  for (const view of ["year", "last", "history"]) for (const who of ["together", "Jordan", "Mia"]) {
    const h = T.render(m, { view, who });
    assert.ok(h.includes("Estimates use published resident rates and simple rules. Not tax advice."), `${view}/${who} footer`);
    assert.ok(h.includes(`data-tv-view="${view}" aria-pressed="true"`), `${view}/${who} view pressed`);
    assert.ok(h.includes(`data-tv-who="${who}" aria-pressed="true"`), `${view}/${who} person pressed`);
    assert.equal(h.includes("Together adds up"), who === "together", `${view}/${who} Together note`);
    assert.ok(!/—/.test(h), `${view}/${who} no em dash`);
    assert.ok(!/NaN|undefined|Infinity/.test(h), `${view}/${who} no broken numbers`);
  }
  const year = T.render(m, { view: "year", who: "Jordan" });
  assert.ok(year.includes("If the year runs like the last seven months, Jordan gets about $2,611 back."));
  assert.ok(year.includes(">Estimate<"));
  assert.ok(year.includes("$100 of donations has no receipt: about $32 of refund depends on it."));
  const both = T.render(m, { view: "year", who: "together" });
  assert.ok(both.includes("Jordan and Mia get about $5,653 back between them."));
  const last = T.render(m, { view: "last", who: "together" });
  assert.ok(last.includes("No tax pack yet. Ask your agent: build the FY26 tax pack."));
  assert.ok(last.includes("$7,374"));
  assert.ok(!T.render(m, { view: "last", who: "Mia" }).includes("Jordan's"), "one person shows only their own return");
});

test("a pack link shows a Tax pack button", () => {
  const i = fresh(); i.returns.find((r) => r.person === "Mia" && r.fy === "FY26").pack = "https://drive.example/fy26-mia";
  const h = T.render(T.model(i), { view: "last", who: "Mia" });
  assert.ok(h.includes('href="https://drive.example/fy26-mia"'));
  assert.ok(h.includes(">Tax pack<"));
});

test("the drawer shows a year's full row and checks its sum", () => {
  const d = T.drawer(m, "row:Jordan:FY24", {});
  assert.ok(d.includes("Jordan, FY24"));
  assert.ok(d.includes("Amended"));
  assert.ok(d.includes("$818.20"));
  assert.ok(d.includes("which matches the Result column"));
  assert.ok(d.includes("notice of amended assessment 18 Nov 2024"));
  const w = T.drawer(m, "working", {}, "Jordan");
  assert.ok(w.includes("$2,610.86") && w.includes("Payslips, gross pay"));
  assert.ok(T.drawer(m, "working", {}, "together").includes("Together"));
});

test("one bad row is a problem row and never blanks the view", () => {
  const i = fresh();
  i.returns.find((r) => r.person === "Jordan" && r.fy === "FY25").result = 999;
  delete i.returns.find((r) => r.person === "Mia" && r.fy === "FY23").withheld;
  i.returns.push(Object.assign({}, i.returns[0]));
  const bad = T.model(i);
  assert.equal(bad.problems.length, 3);
  assert.ok(bad.problems.some((p) => /Jordan FY25: the Result says \$999\.00/.test(p.text)));
  assert.ok(bad.problems.some((p) => /Mia FY23: no withheld/.test(p.text)));
  assert.ok(bad.problems.some((p) => /two rows for FY23/.test(p.text)));
  assert.equal(bad.history.by.Mia[0].ok, false);
  assert.equal(bad.last.fy, "FY26");
  const h = T.render(bad, { view: "history", who: "together" });
  assert.ok(h.includes("3 figures need a look on the sheet."));
  assert.ok(h.includes(">check</text>"));
  assert.ok(h.includes("FY26"));
});

test("a person's own view and a tax payable read the right way round", () => {
  const i = fresh(); const j = i.current.perPerson.Jordan;
  j.withheld = 30000; j.result = 30000 - (j.tax + j.medicare);
  const owe = T.model(i), p = owe.current.who.Jordan;
  assert.equal(p.steps[p.steps.length - 1].kind, "owe");
  const h = T.render(owe, { view: "year", who: "Jordan" });
  assert.ok(h.includes(`Jordan owes about $${(3319).toLocaleString("en-AU")}.`));
  const both = T.render(owe, { view: "year", who: "together" });
  assert.match(both, /Jordan owes about \$3,319 and Mia gets about \$3,042 back, so about \$277 to pay between them\./);
});

test("the module carries no household names", () => {
  const src = require("fs").readFileSync(path.join(__dirname, "./taxview.js"), "utf8");
  assert.ok(!/Jordan|Mia|Davies|Bupa|Northwind/.test(src));
});
