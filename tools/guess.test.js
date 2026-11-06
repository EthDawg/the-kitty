/* The first reading of an unknown bank file. The generated files are chapter 0's: `node life/world/build.js`, and `--variant --seed 7` for a family with another bank. */
"use strict";
const test = require("node:test"), assert = require("node:assert");
const fs = require("fs"), path = require("path"), os = require("os");
const { spawnSync } = require("child_process");
const K = require("../src/household/node.js");

const OUT = process.env.KITTY_LIFE_OUT || path.join(__dirname, "..", "life", "world", "out");
const TODAY = "2027-01-16", enc = (s) => new TextEncoder().encode(s);
const world = (rel) => { const p = path.join(OUT, rel); return fs.existsSync(p) ? { name: path.basename(p), bytes: new Uint8Array(fs.readFileSync(p)) } : null; };
const need = (t, f, what) => { if (f) return true; assert.ok(!process.env.CI, `${what} should be generated in CI`); t.skip(`${what} is not generated here`); return false; };
const blank = async () => { const s = K.fakeStore({ drive: false, deviceFiles: true }); await K.init(s, { name: "Test", people: ["Test"], today: TODAY }); return s; };
const rows = (s) => s.tables.read("recipe");
const chain = (lines, start = 100000) => { let b = start; return lines.map(([d, t, c]) => { b += c; return [d, t, c, b]; }); };

test("the chapter 0 file: read by its column names, proved by its balances, shown on three rows, saved only when asked", async (t) => {
  const file = world("davies/sources/EVERY-A/2027-01-09/Transactions.csv");
  if (!need(t, file, "The chapter 0 file")) return;
  const s = await blank(), first = await K.add(s, [file], { today: TODAY, on_device: true });
  assert.equal(first.needs_recipe.length, 1, "no public recipe reads this bank");
  const p = K.proposeRecipe({ ...file, stream: "Everyday" });
  assert.equal(p.status, "proposed");
  assert.deepEqual([p.understood.date, p.understood.date_style, p.understood.description, p.understood.money_in, p.understood.money_out, p.understood.balance], ["Date", "dmy", "Details", "Money In", "Money Out", "Balance"]);
  assert.equal(p.rows.length, 3); assert.equal(p.lines, 45);
  assert.equal(K.rowWords(p.rows[0]), "1 October 2026: RENT PAYMENT FLAT AGENT, $1,980.00 out, leaving $1,095.67.");
  assert.equal((await rows(s)).length, 0, "a proposal saves nothing");
  const v = await K.addRecipe(s, p.recipe, { today: TODAY, files: [file], account: "Everyday", name: "Everyday", author: "page" });
  assert.equal(v.status, "passed");
  assert.equal(v.read.added[0].observations, 46);
  const st = await K.status(s, { today: TODAY });
  assert.ok(st.words.includes("$2,710.05 across the 1 account we know about."));
});
test("a variant family's bank: no header row, so the columns are told apart by what is in them", async (t) => {
  const file = world("variant-7/sources/EVERY-A/2027-01-09/CSVData.csv");
  if (!need(t, file, "The variant file")) return;
  const p = K.proposeRecipe({ ...file, stream: "Everyday" });
  assert.equal(p.status, "proposed");
  assert.deepEqual([p.understood.header, p.understood.date_style, p.understood.order], [false, "ymd", "newest_first"]);
  const s = await blank(), v = await K.addRecipe(s, p.recipe, { today: TODAY, files: [file], account: "Everyday", name: "Everyday", author: "page" });
  assert.equal(v.status, "passed");
  assert.equal(v.read.added[0].by_kind.txn_line, 43);
});
test("hostile: money in and money out are labelled the wrong way round, and the gate refuses every reading", async () => {
  const lines = chain([["01/07/2026", "RENT", -198000], ["02/07/2026", "PAY", 250000], ["15/07/2026", "SHOP", -4550]]);
  const csv = `Date,Details,Money In,Money Out,Balance\n${lines.map(([d, x, c, b]) => `${d},${x},${c < 0 ? (-c / 100).toFixed(2) : ""},${c > 0 ? (c / 100).toFixed(2) : ""},${(b / 100).toFixed(2)}`).join("\n")}\n`;
  const p = K.proposeRecipe({ name: "swapped.csv", bytes: enc(csv), stream: "Everyday" });
  assert.equal(p.status, "refused");
  assert.ok(p.tried >= 2); assert.equal(p.recipe, undefined);
});
test("hostile: a balance column that does not add up is refused, whatever the amounts say", async () => {
  const csv = "Date,Details,Amount,Balance\n01/07/2026,RENT,-1980.00,900.00\n02/07/2026,PAY,2500.00,1500.00\n15/07/2026,SHOP,-45.50,1400.00\n";
  const p = K.proposeRecipe({ name: "broken.csv", bytes: enc(csv), stream: "Everyday" });
  assert.equal(p.status, "refused");
});
test("hostile: a guess the gate refuses cannot be slipped past it by saving it anyway", async () => {
  const csv = "Date,Details,Amount,Balance\n01/07/2026,RENT,-1980.00,900.00\n02/07/2026,PAY,2500.00,1500.00\n15/07/2026,SHOP,-45.50,1400.00\n";
  const s = await blank(), file = { name: "broken.csv", bytes: enc(csv) }, r = await K.add(s, [file], { today: TODAY, on_device: true });
  const fp = r.needs_recipe[0].fingerprint;
  const wrong = { id: "by-hand", version: 1, tier: "table", container: "csv", fingerprints: [fp], defaults: { date: "dmy" }, table: { order: "oldest_first", header: 1 }, emit: [{ kind: "txn_line", fields: { account_ref: { stream: true }, posting_date: { col: "Date", as: "date" }, description: { col: "Details" }, amount_cents: { col: "Amount", as: "cents" }, balance_after_cents: { col: "Balance", as: "cents" } } }], statement: { from: "chain" }, controls: [{ law: "balance_chain" }, { law: "family_chain" }] };
  assert.equal(K.tryRecipe(wrong, { ...file, stream: "Everyday" }).status, "fail");
  assert.equal((await K.addRecipe(s, wrong, { today: TODAY, files: [file], account: "Everyday" })).status, "failed");
  assert.equal((await rows(s)).length, 0);
});
test("a signed amount with no balance proves nothing about its sign, so a person has to look", async () => {
  const csv = "Date,Description,Amount\n03/07/2026,COFFEE,4.50\n13/07/2026,LUNCH,15.50\n20/07/2026,BOOK,25.00\n";
  const p = K.proposeRecipe({ name: "card.csv", bytes: enc(csv), stream: "Card" });
  assert.equal(p.status, "unproved", "the gate passes it, and nothing here shows these are money out");
  assert.match(p.says.proof, /nothing proves which way the money runs/);
});
test("dates that read either way are flagged with the other reading alongside", async () => {
  const lines = chain([["01/07/2026", "RENT", -198000], ["02/07/2026", "PAY", 250000], ["03/07/2026", "SHOP", -4550]]);
  const csv = `Date,Details,Amount,Balance\n${lines.map(([d, x, c, b]) => `${d},${x},${(c / 100).toFixed(2)},${(b / 100).toFixed(2)}`).join("\n")}\n`;
  const p = K.proposeRecipe({ name: "short.csv", bytes: enc(csv), stream: "Everyday" });
  assert.equal(p.status, "proposed");
  assert.equal(p.ambiguous_dates, true);
  assert.equal(p.also.defaults.date, "mdy");
  assert.match(p.says.dates, /either way/);
});
test("something that is not a table says so, and nothing is guessed", () => {
  const p = K.proposeRecipe({ name: "note.txt", bytes: enc("Dear Daisy,\nHere is your statement.\n"), stream: "Everyday" });
  assert.equal(p.status, "no_columns");
  assert.equal(p.recipe, undefined);
});
test("the command line gets the same reading: look first, --yes keeps it", () => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "kitty-guess-")), csv = path.join(dir, "statement.csv"), cli = path.join(__dirname, "kitty.js");
  const lines = chain([["01/07/2026", "RENT", -198000], ["14/07/2026", "PAY", 250000], ["15/07/2026", "SHOP", -4550]]);
  fs.writeFileSync(csv, `Date,Details,Amount,Balance\n${lines.map(([d, x, c, b]) => `${d},${x},${(c / 100).toFixed(2)},${(b / 100).toFixed(2)}`).join("\n")}\n`);
  const run = (...a) => spawnSync(process.execPath, [cli, ...a, "--dir", path.join(dir, "kitty"), "--today", TODAY], { encoding: "utf8" });
  assert.equal(run("init", "--name", "Sam", "--people", "Sam").status, 0);
  const look = run("guess", csv, "--account", "Everyday");
  assert.equal(look.status, 0, look.stderr);
  assert.match(look.stdout, /Date is the date, day first/);
  assert.match(look.stdout, /1 July 2026: RENT, \$1,980\.00 out/);
  assert.match(look.stdout, /--yes/);
  const keep = run("guess", csv, "--account", "Everyday", "--yes");
  assert.equal(keep.status, 0, keep.stderr);
  assert.match(keep.stdout, /Read statement\.csv/);
});
