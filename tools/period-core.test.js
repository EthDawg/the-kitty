/* node --test tools/period-core.test.js: the period core's promises, no Python, fictional data. Parity with Python is tools/period_parity.py. */
"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("fs"), path = require("path"), vm = require("vm"), { execFileSync } = require("child_process");
const P = require("../src/core/period-core.js");
const { text: T, writeplan: W } = P;
const CORE = path.join(__dirname, "../src/core");
const SCRIPTS = ["period-text.js", "period-adapters.js", "period-writeplan.js", "period-plan.js", "period-core.js"];

const CARD = "Date,Description,Card Member,Account #,Amount\n", BANK = "Date,Description,Credit,Debit,Balance\n";
const WESTPAC = "Bank Account,Date,Narrative,Debit Amount,Credit Amount,Balance,Categories,Serial\n";
const card = (d, desc = "MYKI TOP UP", amt = "60.00", m = "02") => `${String(d).padStart(2, "0")}/${m}/2027,${desc},J,-41007,${amt}\n`;
const accounts = [
  { account_id: "ACC-CC", institution: "Southern Card", type: "Credit card", opening_balance: 0, opening_date: "2025-06-30" },
  { account_id: "ACC-SAV", institution: "Wattle Credit Union", type: "Savings", opening_balance: 100, opening_date: "2025-06-30" },
  { account_id: "ACC-EVD", institution: "Harbour Bank", type: "Transaction", opening_balance: 10000, opening_date: "2025-06-30" },
  { account_id: "LN-HOME", institution: "Harbour Bank", type: "Loan", opening_balance: -600000, opening_date: "2025-06-30" },
  { account_id: "RENTAL", institution: null, type: "Property", opening_balance: 1, opening_date: "2025-06-30" }];
const cats = [["SUBS", "Expense"], ["MORTGAGE", "Expense"], ["TRANSFER", "Transfer"], ["UNCAT", "Expense"]].map(([category_id, flow]) => ({ category_id, flow }));
const rules = [{ pattern: "TRANSFER TO SAVER", match: "normalised", merchant: "Internal", category_id: "TRANSFER" }, { pattern: "TRANSFER FROM EVERYDAY", match: "normalised", merchant: "Internal", category_id: "TRANSFER" }];
const entry = (over) => ({ entry_id: "T0001", kind: "transaction", settled_at: "2027-01-31", account_id: "ACC-SAV", raw_text: "INTEREST CREDIT", description: "Wattle", amount: 1, category_id: "SUBS", person: "Joint", ...over });
const sheet = (over) => ({ accounts, category_list: cats, rules, contracts: [], payslips: [], assets: [], loans: [], entries: [entry()], ...over });
const f = (p, text) => ({ path: p, text });
const plan = (files, over) => P.plan({ months: "2027-02", sheet: sheet(), files, ...over });
const stop = (files, code, over) => {
  const r = plan(files, over);
  assert.equal(r.status, "stopped"); assert.equal(r.exit, 1);
  assert.deepEqual(r.plan.writes, []);
  assert.ok(r.faults.some((x) => x.code === code), JSON.stringify(r.faults.map((x) => x.code)));
  return r;
};

test("cents: round half even on the exact binary value, as Python's round", () => {
  assert.equal(T.toCents(1.005), 100); // 1.005 is 1.00499999... in binary
  assert.equal(T.toCents(1.015), 101);
  assert.equal(T.toCents(0.125), 12);
  assert.equal(T.toCents(0.375), 38);
  assert.equal(T.toCents(-0.125), -12);
  assert.equal(T.toCents(1234.625), 123462);
  assert.equal(T.toCents(370.8), 37080);
  assert.equal(T.amount(37080), 370.8);
  let sum = 0; for (let i = 0; i < 1000; i++) sum += T.toCents(0.1);
  assert.equal(T.amount(sum), 100);
});

test("money renders as Python's format specs", () => {
  assert.equal(T.fmt2(-123456789), "-1,234,567.89");
  assert.equal(T.fmt2(5), "0.05");
  assert.equal(T.plus2(300000), "+3000.00");
  assert.equal(T.plus2(-5), "-0.05");
  assert.equal(T.plusGrouped2(-10000000), "-100,000.00");
  assert.equal(T.floatRepr(3090), "3090.0");
  assert.equal(T.floatRepr(370.8), "370.8");
});

test("amount cells read as Python's float does", () => {
  const m = (v) => P.adapters.money(v, "f", 2);
  assert.equal(m("$1,234.50"), 1234.5); assert.equal(m("A$5"), 5); assert.equal(m("(12.50)"), -12.5); assert.equal(m("(5.00"), 5); assert.equal(m(""), 0);
  assert.equal(m("1e3"), 1000); assert.equal(m("1_000"), 1000); assert.equal(m(".5"), 0.5); assert.equal(m("5."), 5);
  for (const bad of ["abc", "-", "1.2.3", "nan", "inf", "1e400"]) assert.throws(() => m(bad), /is not an amount/);
});

test("the csv reader: quotes, doubled quotes, multiline fields, every line ending, a stray quote", () => {
  assert.deepEqual(T.readCsv('a,"b,c",d\r\n"x""y",z\n'), [["a", "b,c", "d"], ['x"y', "z"]]);
  assert.deepEqual(T.readCsv('"line\none",2\rnext,3'), [["line\none", "2"], ["next", "3"]]);
  assert.deepEqual(T.readCsv('ab"c,"d"e,\n\n'), [['ab"c', "de", ""], []]);
  assert.deepEqual(T.readCsv('a,"open'), [["a", "open"]]);
  assert.deepEqual(T.readCsv(""), []);
  assert.throws(() => T.readCsv("a\0b"), T.CsvError);
  assert.throws(() => T.readCsv("x".repeat(131073)), T.CsvError);
});

test("text folds as Python's does", () => {
  assert.equal(T.ident("  myki  top\tup "), "MYKI TOP UP");
  assert.equal(T.normalise("REFUND ALDI FEB 1234 *X1"), "ALDI");
  assert.equal(T.normalise("ÉFEB MAR"), "ÉFEB");
  assert.equal(T.title("MCDONALD'S 7-ELEVEN 123abc"), "Mcdonald'S 7-Eleven 123Abc");
  assert.equal(T.repr(["it's", 'q"', "a'b\"c", null]), `["it's", 'q"', 'a\\'b"c', None]`);
  assert.equal(T.strip("﻿x\u0085"), "﻿x");
});

test("dates: day first, validated, in calendar arithmetic", () => {
  const d = (s, o = "dmy") => P.adapters.parseDate(s, o, "f", 2);
  assert.equal(d("2/3/2027"), "2027-03-02"); assert.equal(d("2027-03-02"), "2027-03-02"); assert.equal(d("29/02/2028"), "2028-02-29");
  assert.throws(() => d("02/13/2027"), /13 is not a month/); assert.throws(() => d("30/02/2027"), /no such day/); assert.throws(() => d("02/02/27"), /two-digit year/); assert.throws(() => d("Total"), /is not a date/);
  assert.equal(T.addDays("2027-02-28", 1), "2027-03-01"); assert.equal(T.addDays("2028-02-28", 1), "2028-02-29"); assert.equal(T.daysApart("2026-12-30", "2027-01-02"), 3); assert.equal(T.monthEnd("2027-02"), "2027-02-28");
});

test("overlapping exports count by the file with the most copies, never the sum", () => {
  const r = plan([f("ACC-CC/2027-03-01/a.csv", CARD + card(2) + card(3, "ALDI", "50.00")), f("ACC-CC/2027-03-05/b.csv", CARD + card(3, "ALDI", "50.00") + card(4, "COLES", "20.00"))]);
  assert.equal(r.status, "ready");
  assert.deepEqual(r.proposed.transactions.map((t) => t.raw_text), ["MYKI TOP UP", "ALDI", "COLES"]);
  assert.equal(r.outcomes.repeated_across_files.length, 1);
  assert.deepEqual(r.proposed.transactions[0].identity, ["2027-02-02", "ACC-CC", -6000, "MYKI TOP UP"]);
});

test("a genuine repeated same-day charge survives, and the sheet counts against it", () => {
  assert.equal(plan([f("ACC-CC/2027-03-01/a.csv", CARD + card(2) + card(2))]).proposed.transactions.length, 2);
  const one = sheet({ entries: [entry(), entry({ entry_id: "T0002", settled_at: "2027-02-02", account_id: "ACC-CC", raw_text: "myki  top up", amount: -60 })] });
  const r = P.plan({ months: "2027-02", sheet: one, files: [f("ACC-CC/2027-03-01/a.csv", CARD + card(2) + card(2))] });
  assert.equal(r.proposed.transactions.length, 1);
  assert.equal(r.outcomes.already_in_sheet.length, 1);
});

test("input order, and a repeated run", () => {
  const files = [f("ACC-CC/2027-03-05/b.csv", CARD + card(2) + card(4)), f("ACC-CC/2027-03-01/a.csv", CARD + card(2) + card(3)), f("ACC-SAV/2027-03-01/t.csv", BANK + "02/02/2027,TRANSFER FROM EVERYDAY,5.00,,106.00\n")];
  const a = plan(files), b = plan(files.slice().reverse());
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  const again = sheet({ entries: [entry()].concat(a.entries_payload.map((e) => entry({ entry_id: e[0], settled_at: e[2], account_id: e[3], raw_text: e[4], description: e[5], amount: e[6], category_id: e[7], transfer_id: e[13] }))) });
  const r = P.plan({ months: "2027-02", sheet: again, files });
  assert.deepEqual(r.plan.writes, []);
  assert.equal(r.proposed.transactions.length, 0);
});

test("the opening date guard: wholly older files are history, a month before opening still stops", () => {
  const old = f("ACC-CC/2025-03-02/o.csv", CARD + "02/02/2025,OLD,J,-41007,10.00\n"), now = f("ACC-CC/2027-03-01/n.csv", CARD + card(2));
  assert.equal(plan([old, now]).status, "ready");
  stop([old], "before_opening", { months: "2025-02" });
  stop([f("ACC-CC/2027-03-01/n.csv", CARD + "02/02/2025,OLD,J,-41007,10.00\n" + card(2))], "before_opening");
});

test("each stop carries a code and Python's words", () => {
  const good = CARD + card(2);
  const cases = [
    [[f("ACC-NEW/2027-03-01/a.csv", good)], "unknown_account"], [[f("ACC-CC/march/a.csv", good)], "not_a_download_folder"], [[f("ACC-CC/2027-03-01/a.txt", good)], "file_type"],
    [[f("ACC-CC/a.csv", good)], "file_outside_download_folder"], [[f("a.csv", good)], "file_outside_download_folder"], [[{ path: "ACC-CC/2027-03-01/n", is_dir: true }], "nested_folder"],
    [[{ path: "ACC-CC/2027-03-01/s.pdf", pdf_text: "x" }], "pdf_no_adapter"], [[f("ACC-CC/2027-03-01/a.csv", "")], "empty_file"], [[f("ACC-CC/2027-03-01/a.csv", "When,What\n1,2\n")], "unknown_shape"],
    [[f("ACC-CC/2027-03-01/a.csv", "Date,Description,Card Member,Amount\n")], "header_mismatch"], [[f("ACC-CC/2027-03-01/a.csv", BANK)], "wrong_institution"],
    [[f("ACC-CC/2027-03-01/a.csv", CARD + "02/13/2027,X,J,1,1.00\n")], "bad_month"], [[f("ACC-CC/2027-03-01/a.csv", CARD + "30/02/2027,X,J,1,1.00\n")], "no_such_day"],
    [[f("ACC-CC/2027-02-10/a.csv", CARD + card(15))], "after_download"], [[f("ACC-CC/2027-03-01/a.csv", CARD + card(2) + card(9) + card(4))], "out_of_order"],
    [[f("ACC-CC/2027-03-01/a.csv", CARD + "02/02/2027,X,J\n")], "bad_columns"], [[f("ACC-CC/2027-03-01/a.csv", CARD + "02/02/2027,X,J,1,abc\n")], "bad_amount"], [[f("ACC-CC/2027-03-01/a.csv", CARD + "02/02/2027,X,J,1,1e15\n")], "bad_amount"],
    [[f("ACC-CC/2027-03-01/a.csv", good + "a\0b\n")], "csv_unreadable"], [[f("POL-RENTAL/2027-03-01/a.csv", good)], "csv_in_policy"],
    [[f("ACC-CC/2027-03-01/a.csv", CARD + "02/02/2027,OVER,J,1,1.00\n")], "unknown_category", { inputs: [{ path: "o", kind: "overrides", text: "Description,Merchant,Category ID,Person\nOVER,O,NOPE,Joint\n" }] }],
  ];
  for (const [files, code, over] of cases) stop(files, code, over);
  const r = stop([f("ACC-NEW/2027-03-01/a.csv", good), f("ACC-CC/march/a.csv", good)], "unknown_account");
  assert.equal(r.faults.length, 2, "every file fault is reported together");
  assert.match(r.review_md, /STOPPED: nothing was planned/); assert.match(r.faults[0].md, /What to do: /);
  assert.equal(P.plan({ months: "2027-02", sheet: sheet(), files: null }).faults[0].code, "sources_missing");
});

test("bytes, text, rows and a native binding reach the same plan", () => {
  const raw = CARD + card(2);
  const bytes = { name: "a.csv", account: "ACC-CC", download_day: "2027-03-01", bytes: new TextEncoder().encode("﻿" + raw) };
  const asText = { path: "ACC-CC/2027-03-01/a.csv", text: "﻿" + raw }, asRows = { name: "a.csv", account: "ACC-CC", download_day: "2027-03-01", bom: true, rows: T.readCsv(raw) };
  const [a, b, c] = [bytes, asText, asRows].map((x) => JSON.stringify(plan([x]).plan));
  assert.equal(a, b); assert.equal(a, c);
  assert.match(plan([bytes]).review_md, /byte order mark accepted/);
  assert.equal(plan([{ path: "ACC-CC/2027-03-01/a.csv", bytes: new Uint8Array([0x44, 0xe9, 0x0a]) }]).faults[0].code, "not_utf8");
  assert.equal(plan([{ path: "ACC-CC/2027-03-01/a.csv", bytes: new Uint8Array([32, 10]) }]).faults[0].code, "empty_file");
});

test("a closing gap holds: rows retained, nothing to write", () => {
  const r = plan([f("ACC-SAV/2027-03-01/t.csv", BANK + "02/02/2027,TRANSFER FROM EVERYDAY,600.00,,801.00\n")]);
  assert.equal(r.status, "hold"); assert.equal(r.exit, 2);
  assert.deepEqual(r.plan.writes, []); assert.ok(r.plan.held_writes.length);
  assert.equal(r.holds[0].code, "closing_mismatch"); assert.equal(r.rows_payload.length, 1);
  assert.equal(r.checks.closing[0].gap_cents, -10000);
  assert.match(r.review_md, /MISMATCH of -100\.00/);
});

test("categorising: override, then rule, then history, then new", () => {
  const s = sheet({ rules: rules.concat({ pattern: "RULED", merchant: "Ruled Co", category_id: "SUBS", person: "Mia" }),
    entries: [entry(), entry({ entry_id: "T0002", raw_text: "SEEN", description: "Seen Co", category_id: "MORTGAGE" }), entry({ entry_id: "T0003", raw_text: "RULED", description: "History loses", category_id: "MORTGAGE" }), entry({ entry_id: "T0004", raw_text: "OVER", description: "History loses" })] });
  const r = P.plan({ months: "2027-02", sheet: s, files: [f("ACC-CC/2027-03-01/a.csv", CARD + card(2, "OVER") + card(3, "RULED") + card(4, "SEEN") + card(5, "SOME NEW PLACE"))],
    inputs: [{ path: "o", kind: "overrides", text: "Description,Merchant,Category ID,Person,Note\nOVER,Over Co,SUBS,Mia,kept\n" }] });
  assert.deepEqual(r.proposed.transactions.map((t) => [t.merchant, t.category_id]), [["Over Co", "SUBS"], ["Ruled Co", "SUBS"], ["Seen Co", "MORTGAGE"], ["Some New Place", "UNCAT"]]);
  assert.ok(r.review.some((l) => /new merchant/.test(l)));
});

test("transfers pair, loans defer, and --loans now writes them", () => {
  const files = [f("ACC-EVD/2027-03-01/d.csv", WESTPAC + "033,02/02/2027,TRANSFER TO SAVER,500.00,,9500.00,,\n033,03/02/2027,HOME LOAN REPAYMENT,3000.00,,6500.00,,\n"), f("ACC-SAV/2027-03-01/t.csv", BANK + "02/02/2027,TRANSFER FROM EVERYDAY,500.00,,601.00\n"),
    f("LN-HOME/2027-03-01/l.csv", WESTPAC + "033,03/02/2027,REPAYMENT RECEIVED,,3000.00,-597000.00,,\n033,28/02/2027,INTEREST,2500.00,,-599500.00,,\n")];
  const r = plan(files);
  assert.equal(r.status, "ready");
  assert.equal(r.proposed.transfers[0].transfer_id, "X0001");
  assert.equal(r.proposed.loan_pairs[0].transfer_id, "X0002"); assert.equal(r.proposed.loan_pairs[0].deferred, true);
  assert.equal(r.plan.deferred.length, 2); assert.equal(r.proposed.valuations[0].value_cents, -59950000);
  assert.ok(r.plan.deferred[0].why.startsWith("Phase D decides"));
  const now = plan(files, { options: { loans: "now" } });
  assert.deepEqual(now.plan.deferred, []); assert.equal(now.entries_payload.length, 6);
  assert.equal(now.entries_payload.find((e) => e[4] === "HOME LOAN REPAYMENT")[7], "TRANSFER");
});

test("two equal repayments take two bank rows, not one twice", () => {
  const r = plan([f("ACC-EVD/2027-03-01/d.csv", WESTPAC + "033,03/02/2027,HOME LOAN REPAYMENT,3000.00,,7000.00,,\n033,03/02/2027,HOME LOAN REPAYMENT,3000.00,,4000.00,,\n"),
    f("LN-HOME/2027-03-01/l.csv", WESTPAC + "033,03/02/2027,R,,3000.00,-597000.00,,\n033,03/02/2027,R,,3000.00,-594000.00,,\n")]);
  assert.deepEqual(r.proposed.loan_pairs.map((p) => p.mate.id), ["T0002", "T0003"]);
});

test("typed inputs that Python would write as 0.00 stop instead", () => {
  const v = (text) => ({ months: "2027-02", inputs: [{ path: "v.csv", kind: "valuations", text }] });
  for (const body of ['2027-02-28,RENTAL,"771,000"\n', "2027-02-28,RENTAL,\n"]) assert.equal(plan([], v("Month end,Item ID,Value\n" + body)).faults[0].code, "bad_value");
  assert.equal(plan([], v("Month end,Item ID,Value\n2027-02-30,RENTAL,1\n")).faults[0].code, "bad_month_end");
  assert.equal(plan([], v("Month end,Item ID,Value\n2027-02-28,BOAT,1\n")).faults[0].code, "unknown_valuation_item");
  assert.equal(plan([], v("Month end,Item ID,Value\n2027-02-28,RENTAL,771000.5\n")).proposed.valuations[0].value_cents, 77100050);
});

test("policy text from the host: lines of cells or plain text", () => {
  const lines = [["Rental insurance renewal"], ["Policy number", "Period of insurance"], ["PS-RENTAL-2027", "15 Sep 2027 to 14 Sep 2028"], ["Total premium", "Payment due"], ["A$1,802.50", "1 Sep 2027"]];
  const s = sheet({ contracts: [{ contract_id: "C1", kind: "insurance", name: "L", account_id: "RENTAL", amount: 1702, start_date: null, end_date: null, next_date: null }] });
  const go = (x) => P.plan({ months: "2027-02", sheet: s, files: [{ path: "POL-RENTAL/2027-02-16/r.pdf", ...x }] });
  const a = go({ pdf_lines: lines }), b = go({ pdf_text: lines.map((l) => l.join("  ")).join("\n") });
  assert.equal(a.status, "ready");
  assert.equal(a.plan.writes[0].range, "Contracts!I2:M2");
  assert.deepEqual(a.plan.writes[0].values[0], [1802.5, null, "2027-09-15", "2028-09-14", "2027-09-01"]);
  assert.equal(JSON.stringify(a.plan), JSON.stringify(b.plan));
  for (const bad of [{ pdf_lines: [] }, { pdf_error: "not a PDF" }, { pdf_lines: [["Renewal"], ["nothing"]] }]) assert.equal(go(bad).faults[0].code, "pdf_needs_person");
  assert.equal(P.plan({ months: "2027-02", sheet: s, files: [{ path: "POL-HOME/2027-02-16/r.pdf", pdf_lines: lines }] }).faults[0].code, "unknown_account");
});

test("the write plan is explicit ranges and chunks, never an append call", () => {
  const rows = Array.from({ length: 1200 }, (_, i) => card(1 + (i % 28), `S${i}`, "1.00")).sort((a, b) => a.slice(0, 2).localeCompare(b.slice(0, 2)));
  const r = plan([f("ACC-CC/2027-03-01/a.csv", CARD + rows.join(""))]);
  assert.deepEqual(r.plan.writes.map((w) => [w.range, w.rows]), [["Entries!A3:T502", 500], ["Entries!A503:T1002", 500], ["Entries!A1003:T1202", 200]]);
  assert.deepEqual(r.plan.preconditions[0].expect, [["T0001"], []]);
  assert.equal(plan([f("ACC-CC/2027-03-01/a.csv", CARD + card(2, "=SUM(A1)"))]).plan.writes[0].values[0][4], "'=SUM(A1)");
  assert.equal(W.col(27), "AA"); assert.equal(W.rangeKey("'My Tab'!A1"), "My Tab!A1:A1");
});

test("verify: faithful re-read, changed cell, moved sheet, a plan on hold", () => {
  const { plan: p } = plan([f("ACC-CC/2027-03-01/a.csv", CARD + card(2) + card(3, "ALDI", "50.00"))]);
  const w = p.writes[0], read = w.values.map((row) => { const r = row.map((v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? T.dayNumber(v) - T.dayNumber("1899-12-30") : v)); while (r[r.length - 1] === "") r.pop(); return r; });
  assert.equal(P.verify(p, [{ range: w.range, values: read }]).exit, 0);
  const bad = JSON.parse(JSON.stringify(read)); bad[1][6] = -51;
  const v = P.verify(p, { [w.range]: bad });
  assert.equal(v.exit, 1); assert.equal(v.mismatches[0].cell, "G4"); assert.match(v.lines[0], /planned -50\.0, sheet has -51\.0/);
  assert.equal(P.verify(p, []).exit, 1);
  assert.equal(P.verify(p, [{ range: "Entries!A2:A3", values: [["T0001"]] }], { preconditions: true }).exit, 0);
  assert.equal(P.verify(p, [{ range: "Entries!A2:A3", values: [["T0001"], ["T0002"]] }], { preconditions: true }).exit, 1);
  const held = plan([f("ACC-SAV/2027-03-01/t.csv", BANK + "02/02/2027,A,1.00,,999.00\n")]).plan;
  assert.equal(P.verify(held, []).exit, 1);
  assert.ok(W.same("2027-02-03", "3/2/2027")); assert.ok(W.same(-50, "-50.00")); assert.ok(!W.same(-50, "-50.01")); assert.ok(W.same("", null)); assert.ok(W.same(null, "anything"));
});

test("host mistakes throw, faults do not", () => {
  assert.throws(() => P.plan({ months: "2027-13", sheet: sheet(), files: [] }), P.PeriodInputError);
  assert.throws(() => P.plan({ months: "2027-02..2027-01", sheet: sheet(), files: [] }), P.PeriodInputError);
  assert.throws(() => P.plan({ months: "2027-02", sheet: { accounts, transactions: [] }, files: [] }), /sheet_version 2 only/);
  assert.equal(P.plan({ months: "2027-02", sheet: { accounts, transactions: [] }, files: [], options: { allow_v1: true } }).plan.sheet.version, 1);
});

test("deterministic: no clock, no randomness, generated_at comes from the host", () => {
  const files = [f("ACC-CC/2027-03-01/a.csv", CARD + card(2))];
  assert.equal(JSON.stringify(plan(files)), JSON.stringify(plan(files)));
  assert.equal(plan(files).plan.generated_at, null);
  assert.equal(plan(files, { options: { generated_at: "2027-03-01T00:00:00Z" } }).plan.generated_at, "2027-03-01T00:00:00Z");
});

test("runs as browser scripts, with no require, process or Buffer", () => {
  const box = { TextDecoder, console };
  box.self = box;
  vm.createContext(box);
  for (const s of SCRIPTS) vm.runInContext(fs.readFileSync(path.join(CORE, s), "utf8"), box, { filename: s });
  const r = vm.runInContext(`self.KittyPeriod.plan({ months: "2027-02", sheet: ${JSON.stringify(sheet())}, files: [{ path: "ACC-CC/2027-03-01/a.csv", bytes: new Uint8Array([${[...Buffer.from(CARD + card(2))].join(",")}]) }] }).status`, box);
  assert.equal(r, "ready");
  for (const s of SCRIPTS) {
    const src = fs.readFileSync(path.join(CORE, s), "utf8").replace(/if \(typeof module[^\n]*\n/, "");
    assert.doesNotMatch(src, /\b(require|process|Buffer|__dirname|fetch|XMLHttpRequest|Date\.now|new Date|Math\.random)\b/, s);
  }
});

// ---------- line review fixes ----------
const repay = [f("ACC-EVD/2027-03-01/d.csv", WESTPAC + "033,03/02/2027,HOME LOAN REPAYMENT,3000.00,,7000.00,,\n"), f("LN-HOME/2027-03-01/l.csv", WESTPAC + "033,03/02/2027,R,,3000.00,-597000.00,,\n")];

test("1: a deferred pair on a planned row has no precondition, so preflight can pass", () => {
  const r = plan(repay);
  assert.deepEqual(r.plan.preconditions.map((c) => c.range), ["Entries!A2:A3"]);
  assert.equal(P.verify(r.plan, [{ range: "Entries!A2:A3", values: [["T0001"]] }], { preconditions: true }).exit, 0);
  const inSheet = sheet({ entries: [entry(), entry({ entry_id: "T0002", settled_at: "2027-02-03", account_id: "ACC-EVD", raw_text: "HOME LOAN REPAYMENT", amount: -3000, category_id: "MORTGAGE" })] });
  const existing = P.plan({ months: "2027-02", sheet: inSheet, files: [repay[1]] });
  assert.ok(existing.plan.preconditions.some((c) => c.range === "Entries!A3" && c.expect[0][0] === "T0002"), "a row on the sheet keeps its check");
});

test("2: duplicate files stop, whichever comes first, and tree faults do not depend on input order", () => {
  const a = f("ACC-CC/2027-03-01/a.csv", CARD + card(2)), b = f("ACC-CC/2027-03-01/a.csv", CARD + card(3)), c = { name: "a.csv", account: "ACC-CC", download_day: "2027-03-01", text: "not even a table" };
  assert.equal(stop([a, b], "duplicate_file").faults[0].file, "ACC-CC/2027-03-01/a.csv");
  const x = plan([a, c, f("z.csv", "x"), f("b.csv", "x")]), y = plan([f("b.csv", "x"), f("z.csv", "x"), c, a]);
  assert.equal(JSON.stringify(x), JSON.stringify(y));
  assert.deepEqual(x.faults.map((q) => q.code), ["duplicate_file", "file_outside_download_folder", "file_outside_download_folder"]);
  assert.equal(plan([a, f("ACC-CC/2027-03-01/b.csv", CARD + card(2))]).status, "ready", "same day, different names, is an overlap");
});

test("3: the closing balance is the latest date's, whichever way the file runs", () => {
  const loan = plan([f("LN-HOME/2027-03-01/l.csv", WESTPAC + "033,28/02/2027,I,2500.00,,-599500.00,,\n033,03/02/2027,R,,3000.00,-597000.00,,\n")]);
  assert.equal(loan.proposed.valuations[0].value, -599500);
  const bank = plan([f("ACC-EVD/2027-03-01/d.csv", WESTPAC + "033,20/02/2027,B,5.00,,8000.00,,\n033,03/02/2027,A,5.00,,9995.00,,\n")]);
  assert.equal(bank.status, "hold"); assert.equal(bank.checks.closing[0].day, "2027-02-20");
  const rows = [{ date: "2027-02-01", balance: 1 }, { date: "2027-02-01", balance: 2 }];
  assert.equal(P.adapters.latestRow(rows, "Harbour Bank").balance, 2); assert.equal(P.adapters.latestRow(rows, "Bark Bank").balance, 1);
});

test("4: a blank loan balance or payslip cell is a fault, an explicit 0.00 is not", () => {
  stop([f("LN-HOME/2027-03-01/l.csv", WESTPAC + "033,28/02/2027,I,2500.00,,,,\n")], "bad_amount");
  const pay = (cells) => f("payslips/2027-03-02/p.csv", `Pay date,Person,Employer,Gross pay,Tax withheld,Super (employer),Net pay\n2027-02-18,Mia,B,${cells}\n`);
  stop([pay(",,,")], "bad_amount"); stop([pay("100.00,0.00,,90.00")], "bad_amount");
  assert.equal(plan([pay("100.00,0.00,0.00,100.00")]).status, "ready");
  assert.equal(plan([f("LN-HOME/2027-03-01/l.csv", WESTPAC + "033,28/02/2027,I,2500.00,,0.00,,\n")]).status, "ready");
});

test("5: 1e21 is refused, never a null in the plan", () => {
  assert.equal(plan([], { inputs: [{ path: "v", kind: "valuations", text: "Month end,Item ID,Value\n2027-02-28,RENTAL,1e21\n" }] }).faults[0].code, "bad_value");
  stop([f("LN-HOME/2027-03-01/l.csv", WESTPAC + "033,28/02/2027,I,2500.00,,1e21,,\n")], "bad_amount");
  stop([f("ACC-SAV/2027-03-01/t.csv", BANK + "02/02/2027,A,1.00,,1e21\n")], "bad_amount");
});

test("6: long runs stay linear", () => {
  const started = process.hrtime.bigint();
  const spaced = "a" + " ".repeat(600000) + "b";
  assert.equal(T.strip(spaced), spaced); assert.equal(T.ident(spaced), "A B");
  assert.equal(T.pyFloat("1".repeat(600000) + "x"), null); assert.equal(T.pyFloat("1_".repeat(300000) + "x"), null);
  assert.equal(P.adapters.money("(".repeat(600000) + "5", "f", 2), 5);
  const r = plan([f("ACC-CC/2027-03-01/a.csv", CARD + card(2, "a" + " ".repeat(100000) + "b"))]);
  assert.equal(r.status, "ready");
  assert.ok(Number(process.hrtime.bigint() - started) / 1e9 < 2, "quadratic scans would take minutes here");
  assert.equal(T.pyFloat("1_000.5e1"), 10005); assert.equal(T.pyFloat("1__0"), null); assert.equal(T.pyFloat("1_"), null); assert.equal(T.pyFloat("12.34.5"), null);
});

test("7: nothing long or nameless escapes as an exception", () => {
  const n = 200000, cells = [["Date", "Description", "Card Member", "Account #", "Amount"]];
  for (let i = 0; i < n; i++) cells.push([`${String(1 + Math.floor((i / n) * 28)).padStart(2, "0")}/02/2027`, `S${i}`, "J", "-41007", "1.00"]);
  const r = plan([{ path: "ACC-CC/2027-03-01/a.csv", rows: cells }]);
  assert.equal(r.status, "ready"); assert.equal(r.proposed.transactions.length, n); assert.equal(r.review.length, n);
  for (const bad of [f("", "x"), { path: "///", text: "x" }, {}, null, { name: null }]) assert.equal(plan([bad]).faults[0].code, "file_outside_download_folder");
});

test("8: the input stays pure: frozen, edited, or planned twice", () => {
  const frozen = (o) => { if (o && typeof o === "object") { Object.values(o).forEach(frozen); Object.freeze(o); } return o; };
  const input = frozen({ months: "2027-02", sheet: sheet(), files: [f("ACC-CC/2027-03-01/a.csv", CARD + card(2)), { path: "ACC-SAV/2027-03-01/t.csv", rows: T.readCsv(BANK + "02/02/2027,A,1.00,,102.00\n") }] });
  assert.equal(P.plan(input).status, "ready");
  const live = f("ACC-CC/2027-03-01/a.csv", CARD + card(2)), keys = Object.getOwnPropertyNames(live).join();
  assert.equal(plan([live]).proposed.transactions[0].date, "2027-02-02");
  live.text = CARD + card(3);
  assert.equal(plan([live]).proposed.transactions[0].date, "2027-02-03");
  assert.equal(Object.getOwnPropertyNames(live).join(), keys);
});

test("9: a loan repayment never takes a bank row already in a transfer", () => {
  const s = sheet({ entries: [entry(), entry({ entry_id: "T0002", settled_at: "2027-02-03", account_id: "ACC-EVD", raw_text: "HOME LOAN REPAYMENT", amount: -3000, category_id: "MORTGAGE", transfer_id: "X0007", transfer_account: "ACC-SAV" })] });
  const r = P.plan({ months: "2027-02", sheet: s, files: [repay[1]] });
  assert.deepEqual(r.proposed.loan_pairs, []);
  assert.ok(r.checks.loans.some((l) => /left unpaired/.test(l)));
});

test("10: a row left for review is not paired on its mate's turn", () => {
  const r = plan([f("ACC-EVD/2027-03-01/d.csv", WESTPAC + "033,02/02/2027,TRANSFER TO SAVER,500.00,,9500.00,,\n"), f("ACC-SAV/2027-03-01/t.csv", BANK + "03/02/2027,TRANSFER FROM EVERYDAY,500.00,,601.00\n04/02/2027,TRANSFER FROM EVERYDAY,500.00,,1101.00\n")]);
  assert.deepEqual(r.proposed.transfers, []);
  assert.ok(r.checks.transfers[0].endsWith("left for review") && /2 possible mates/.test(r.checks.transfers[0])); // period-plan's ambiguous branch
  assert.match(r.checks.transfers[1], /its only mate T\d+ is left for review/);
  assert.ok(r.entries_payload.every((e) => e[13] === ""));
});

test("11: verify refuses a changed cell where the last ID was blank, and any preflight on a plan that is not ready", () => {
  const s = sheet({ entries: [entry({ entry_id: null })] });
  const { plan: p } = P.plan({ months: "2027-02", sheet: s, files: [f("ACC-CC/2027-03-01/a.csv", CARD + card(2))] });
  assert.deepEqual(p.preconditions[0].expect, [[null], []]);
  assert.equal(P.verify(p, [{ range: "Entries!A2:A3", values: [["ZZZ"]] }], { preconditions: true }).exit, 1);
  assert.equal(P.verify(p, [{ range: "Entries!A2:A3", values: [[""]] }], { preconditions: true }).exit, 0);
  const held = plan([f("ACC-SAV/2027-03-01/t.csv", BANK + "02/02/2027,A,1.00,,999.00\n")]).plan;
  const v = P.verify(held, [{ range: "Entries!A2:A3", values: [["T0001"]] }], { preconditions: true });
  assert.equal(v.exit, 1); assert.match(v.lines[0], /plan status is 'hold'/);
  const stopped = stop([f("ACC-NEW/2027-03-01/a.csv", "x")], "unknown_account").plan;
  assert.equal(P.verify(stopped, [], { preconditions: true }).exit, 1);
});

test("12: an untyped sheet cell is a fault, not a TypeError", () => {
  const go = (e) => P.plan({ months: "2027-02", sheet: sheet({ entries: [entry(), entry({ entry_id: "T0002", settled_at: "2027-02-03", account_id: "ACC-EVD", amount: -3000, ...e })] }), files: [repay[1]] });
  assert.equal(go({ raw_text: 12345 }).status, "ready");
  const repayment = go({ raw_text: 700123, category_id: "MORTGAGE" });
  assert.equal(repayment.proposed.loan_pairs[0].mate.id, "T0002", "numeric text reads as text");
  for (const settled_at of [46421, null, undefined, "2027-02-30", "03/02/2027"]) {
    const r = go({ settled_at });
    assert.equal(r.faults[0].code, "bad_sheet_row"); assert.equal(r.faults[0].row, 3); assert.equal(r.faults[0].file, "Entries");
  }
  assert.equal(go({ amount: 1e21 }).faults[0].code, "bad_sheet_row");
  assert.equal(P.plan({ months: "2027-02", sheet: { accounts, transactions: [{ txn_id: "T1", date: 5, amount: 1 }] }, files: [], options: { allow_v1: true } }).faults[0].file, "Transactions");
});

test("verify: numbers read against planned text, and rows the plan does not know", () => {
  assert.ok(W.same("2027-02-03", T.dayNumber("2027-02-03") - T.dayNumber("1899-12-30")), "a serial reads back as the planned date");
  assert.ok(!W.same("2027-02-03", 46421.5)); assert.ok(!W.same("2027-02-03", 1));
  assert.ok(W.same("1,250.50", 1250.5)); assert.ok(!W.same("1,250.50", 1250.6)); assert.ok(!W.same("SHOP", 5));
  assert.deepEqual(W.compare([["a"]], [["a"], ["", ""], ["extra"]]), { i: 2, j: 0, planned: "", actual: "extra" });
  assert.equal(W.compare([["a"]], [["a"], ["", ""]]), null);
});

const JSC = "/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc";
test("runs on JavaScriptCore, the engine under Safari", { skip: !fs.existsSync(JSC) }, () => {
  const load = SCRIPTS.map((s) => path.join(CORE, s));
  const script = `var self = this;\n${load.map((p) => `load(${JSON.stringify(p)});`).join("\n")}\nvar r = self.KittyPeriod.plan({ months: "2027-02", sheet: ${JSON.stringify(sheet())}, files: [{ path: "ACC-CC/2027-03-01/a.csv", text: ${JSON.stringify(CARD + card(2, "CAFÉ MAR 1234"))} }] });\nprint(JSON.stringify([r.status, r.proposed.transactions[0].amount_cents, r.proposed.transactions[0].merchant]));`;
  const file = path.join(require("os").tmpdir(), `kitty-jsc-${process.pid}.js`);
  fs.writeFileSync(file, script);
  try { assert.equal(execFileSync(JSC, [file], { encoding: "utf8" }).trim(), '["ready",-6000,"Café Mar 1234"]'); }
  finally { fs.unlinkSync(file); }
});

// What the connector's USER_ENTERED does to a text cell: one leading apostrophe goes, and the rest is the cell.
const landed = (v) => (typeof v === "string" && v[0] === "'" ? v.slice(1) : v);
test("a leading apostrophe survives the write, and the same file replays to nothing", () => {
  for (const raw of ["'=LITERAL", "'+CARD", "=LITERAL", "+CARD", "'PLAIN WORD", "''=TWICE"]) {
    const files = [f("ACC-CC/2027-03-01/a.csv", CARD + card(2, raw))];
    const a = plan(files); assert.equal(a.status, "ready", raw);
    const w = a.plan.writes.find((x) => x.tab === "Entries"), row = w.values[0];
    assert.equal(landed(row[4]), raw, `${raw} lands as itself`);
    const again = sheet({ entries: [entry(), entry({ entry_id: row[0], settled_at: "2027-02-02", account_id: "ACC-CC", raw_text: landed(row[4]), description: landed(row[5]), amount: -60 })] });
    const r = P.plan({ months: "2027-02", sheet: again, files });
    assert.equal(r.proposed.transactions.length, 0, `${raw} replays to nothing`); assert.deepEqual(r.plan.writes, []);
  }
  assert.ok(W.same("''=X", "'=X")); assert.ok(W.same("'=X", "=X")); assert.ok(!W.same("''=X", "=X"));
  assert.equal(W.escape("'=X"), "''=X"); assert.equal(W.escape("=X"), "'=X"); assert.equal(W.escape("plain"), "plain");
});

test("a blank amount stops, and an explicit zero is still a row", () => {
  stop([f("ACC-CC/2027-03-01/a.csv", CARD + card(2, "MYKI", ""))], "bad_amount");
  stop([f("ACC-CC/2027-03-01/a.csv", CARD + card(2, "MYKI", "   "))], "bad_amount");
  stop([f("ACC-SAV/2027-03-01/t.csv", BANK + "02/02/2027,TRANSFER FROM EVERYDAY,,,106.00\n")], "bad_amount");
  const zero = plan([f("ACC-CC/2027-03-01/a.csv", CARD + card(2, "MYKI", "0.00"))]);
  assert.equal(zero.status, "ready"); assert.equal(zero.proposed.transactions[0].amount_cents, 0);
});
