/* A first reading of a bank file nobody has met. It looks at a table's column names, or its contents when there is no header row, and proposes recipes: which column is
   the date and how it is written, what the money columns are, whether the file runs oldest or newest first. It claims nothing. Each proposal goes through the same gate as
   any other recipe, and only one that passes is shown, on three of its own rows, for a person to say yes to. A proposal is not saved here. addRecipe saves it, and the
   gate runs again. tryRecipe is the same check for a recipe from anyone: the page's Claude, or an agent. */
"use strict";
const { decode } = require("../../standard/intake/containers");
const { fingerprint } = require("../../standard/intake/fingerprint");
const { gate } = require("../../standard/intake/gate");
const { run, parseDate, parseCents } = require("../../standard/intake/recipe");
const { base } = require("./base");
const { dayYear, money } = require("./words");

const NAMES = { date: /^(transaction |posted |posting |value |effective )?date$|^date\b/i, text: /detail|description|narrative|memo|particular|transaction$|merchant|payee/i, credit: /money in|credit|deposit|paid in/i, debit: /money out|debit|withdrawal|paid out/i, amount: /^amount|^value$|^aud$/i, balance: /balance/i };
const DATE_SHAPE = /^(\d{4}-\d{2}-\d{2}(T.*)?|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{1,2} [A-Za-z]{3} \d{4}|\d{8})$/;
const cell = (r, i) => String(r[i] ?? "").trim();
const isDate = (s) => DATE_SHAPE.test(s);
const isMoney = (s) => s !== "" && !isDate(s) && parseCents(s) != null;
const share = (rows, i, f) => { const filled = rows.filter((r) => cell(r, i) !== ""); return filled.length ? filled.filter((r) => f(cell(r, i))).length / filled.length : 0; };

// Which ways can these dates be written? More than one only when nothing in the column separates them, and then the first is the one Australia uses.
function dateStyles(cells) {
  const sample = cells.find(Boolean) || "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(sample)) return ["ymd"];
  if (/^\d{4}-\d{2}-\d{2}T/.test(sample)) return ["iso"];
  if (/^\d{8}$/.test(sample)) return ["yyyymmdd"];
  if (/^\d{1,2} [A-Za-z]{3} \d{4}$/.test(sample)) return ["dmony"];
  const short = /[/.-]\d{2}$/.test(sample), ways = short ? ["dmy2", "mdy2"] : ["dmy", "mdy"];
  return ways.filter((w) => cells.every((c) => !c || parseDate(c, w) != null));
}
/* What the table holds. Names first, and contents where a table has no header or a name says nothing. rows: arrays of cells, the header among them. */
function readTable(rows) {
  const width = Math.max(...rows.map((r) => r.length)), first = rows[0], named = first.some((c) => /[A-Za-z]/.test(String(c))) && !first.some((c) => isDate(String(c).trim()) || isMoney(String(c).trim()));
  const body = named ? rows.slice(1) : rows, names = named ? first.map((c) => String(c).trim()) : Array.from({ length: width }, (_, i) => `Column ${i + 1}`);
  const cols = names.map((name, i) => ({ i, name, date: share(body, i, isDate), money: share(body, i, isMoney) }));
  const byName = (re) => (named ? cols.find((c) => re.test(c.name)) : null);
  const date = byName(NAMES.date) || cols.filter((c) => c.date > 0.9)[0];
  if (!date) return null;
  const text = byName(NAMES.text) || cols.filter((c) => c !== date && c.money < 0.5).sort((a, b) => b.i - a.i).sort((a, b) => avgLength(body, b.i) - avgLength(body, a.i))[0];
  if (!text) return null;
  const figures = cols.filter((c) => c !== date && c !== text && c.money > 0.5), credit = byName(NAMES.credit), debit = byName(NAMES.debit), amount = byName(NAMES.amount), balance = byName(NAMES.balance);
  const ways = [];
  if (credit && debit) ways.push({ credit, debit, balance });
  if (amount) ways.push({ amount, balance });
  // No name to go on: every way of reading the number columns. The balance chain tells them apart.
  if (!ways.length) for (const a of figures) { const others = figures.filter((c) => c !== a); if (others.length) for (const b of others) ways.push({ amount: a, balance: b }); else ways.push({ amount: a }); }
  if (!ways.length) return null;
  // A column that says which account, the same on every row, is how a file names itself. It comes before anything a person is asked.
  const held = named ? cols.find((c) => c !== date && c !== text && /account|acct/i.test(c.name) && !/name/i.test(c.name)) : null, numbers = held ? [...new Set(body.map((r) => cell(r, held.i)))] : [];
  const account = held && numbers.length === 1 && /\d{4}/.test(numbers[0]) ? { name: held.name, number: numbers[0] } : null;
  return { named, names, body, date, text, ways, account, dates: dateStyles(body.map((r) => cell(r, date.i))) };
}
function avgLength(rows, i) { return rows.reduce((n, r) => n + cell(r, i).length, 0) / (rows.length || 1); }
function ordersOf(t, style) {
  const days = t.body.map((r) => parseDate(cell(r, t.date.i), style)).filter(Boolean);
  if (days.length < 2 || days[0] === days[days.length - 1]) return ["oldest_first", "newest_first"];
  return days[0] < days[days.length - 1] ? ["oldest_first", "newest_first"] : ["newest_first", "oldest_first"];
}
function recipeFor(t, fp, container, style, order, way) {
  const money = way.credit ? { credit: way.credit.name, debit: way.debit.name } : { col: way.amount.name, as: "cents" };
  const fields = { account_ref: t.account ? { col: t.account.name } : { stream: true }, posting_date: { col: t.date.name, as: "date" }, description: { col: t.text.name }, amount_cents: money, ...(way.balance ? { balance_after_cents: { col: way.balance.name, as: "cents" } } : {}) };
  return { id: `read-by-columns-${String(fp).slice(-8)}`, version: 1, tier: "table", container, fingerprints: [fp], defaults: { date: style }, table: { order, ...(t.named ? { header: 1 } : { columns: t.names }) }, emit: [{ kind: "txn_line", fields }], ...(way.balance ? { statement: { from: "chain" }, controls: [{ law: "balance_chain" }, { law: "family_chain" }] } : { controls: [] }) };
}
function opened(file) {
  const b = base();
  try { const decoded = decode(file.bytes, { inflate: b.inflate }); return { decoded, fp: fingerprint(decoded), container: decoded.container || String(file.name || "").split(".").pop() }; }
  catch (e) { return null; }
}
const PROVED = { pass: true };
// The gate's verdict on a recipe over one file, and what it would read, with nothing written anywhere.
function check(recipe, file, o) {
  const b = base(), stream = file.stream || "guess", verdict = gate(recipe, [{ path: file.name, stream, decoded: o.decoded }], { vocab: b.vocab });
  if (verdict.status !== "pass") return { status: "fail", verdict, why: ((verdict.failures || [])[0] || {}).what || "It did not pass." };
  const lines = run(recipe, o.decoded, { vocab: b.vocab, stream }).observations.filter((x) => x.kind === "txn_line").map((x) => ({ date: x.payload.posting_date, description: x.payload.description, amount_cents: x.payload.amount_cents, balance_cents: x.payload.balance_after_cents ?? null })).sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
  if (!lines.length) return { status: "fail", verdict, why: "It read no lines." };
  return { status: "pass", verdict, proved: !!PROVED[verdict.checks.sign], rows: lines.slice(0, 3), lines: lines.length, from: lines[0].date, to: lines[lines.length - 1].date };
}
// A recipe from anyone, checked against one file. Nothing is saved.
function tryRecipe(recipe, file) {
  const o = opened(file);
  if (!o) return { status: "unreadable", why: "We can't open this file." };
  const claimed = (recipe.fingerprints || []).includes(o.fp) ? recipe : { ...recipe, fingerprints: [...(recipe.fingerprints || []), o.fp] };
  const r = check(claimed, file, o);
  return { ...r, recipe: claimed, fingerprint: o.fp, words: r.status === "pass" ? `${r.lines} lines from ${dayYear(r.from)} to ${dayYear(r.to)}.` : null };
}
/* status: proposed, the gate passed one and its signs are proved by a running balance; unproved, it passed and nothing in the file can prove which way the money runs, so a
   person has to look; refused, a reading was tried and the gate refused every one; no_columns, this is not a table we can make sense of. */
function proposeRecipe(file) {
  const o = opened(file);
  if (!o) return { status: "no_columns", why: "We can't open this file." };
  const meta = { fingerprint: o.fp, container: o.container, sample: { rows: (o.decoded.rows || []).slice(0, 6), lines: (o.decoded.lines || []).slice(0, 14).map((l) => l.text) } };
  const rows = (o.decoded.rows || []).filter((r) => Array.isArray(r) && r.some((c) => String(c).trim() !== ""));
  if (rows.length < 2) return { ...meta, status: "no_columns", why: "It isn't laid out as rows and columns." };
  const t = readTable(rows);
  if (!t || !t.dates.length) return { ...meta, status: "no_columns", why: "We can't tell which column is which." };
  const passed = []; let tried = 0, why = null;
  for (const way of t.ways) for (const style of t.dates) for (const order of ordersOf(t, style)) {
    tried += 1;
    const recipe = recipeFor(t, o.fp, o.container, style, order, way), r = check(recipe, file, o);
    if (r.status === "pass") passed.push({ ...r, recipe, way, style, order }); else why = why || r.why;
  }
  if (!passed.length) return { ...meta, status: "refused", tried, why: why || "No reading passed." };
  const best = passed.find((p) => p.proved) || passed[0], rival = passed.find((p) => p.style !== best.style && p.proved === best.proved);
  const understood = { date: t.date.name, date_style: best.style, description: t.text.name, ...(best.way.credit ? { money_in: best.way.credit.name, money_out: best.way.debit.name } : { amount: best.way.amount.name }), balance: best.way.balance ? best.way.balance.name : null, order: best.order, header: t.named };
  return { ...meta, status: best.proved ? "proposed" : "unproved", recipe: best.recipe, number: t.account ? t.account.number : null, understood, rows: best.rows, lines: best.lines, from: best.from, to: best.to, tried, ambiguous_dates: !!rival, also: rival ? rival.recipe : null, says: saysOf(understood, best, !!rival) };
}
const STYLE = { dmy: "day first", dmy2: "day first", mdy: "month first", mdy2: "month first", ymd: "year first", iso: "year first", yyyymmdd: "year first", dmony: "written out" };
function saysOf(u, best, ambiguous) {
  const money = u.amount ? `${u.amount} is the money, in or out by its sign` : `${u.money_in} is money in and ${u.money_out} is money out`;
  const proof = u.balance ? `${u.balance} adds up on every one of the ${best.lines} lines, which is how we know.` : "This file has no running balance, so nothing proves which way the money runs. Check these rows.";
  return { columns: `${u.date} is the date, ${STYLE[u.date_style] || u.date_style}. ${u.description} says what it was. ${money}.`, proof, dates: ambiguous ? "Every date in this file could be read either way. We read them day first. If that's wrong, say so." : null };
}
const rowWords = (r) => `${dayYear(r.date)}: ${r.description}, ${r.amount_cents < 0 ? `${money(-r.amount_cents)} out` : `${money(r.amount_cents)} in`}${r.balance_cents != null ? `, leaving ${money(r.balance_cents)}` : ""}.`;
module.exports = { proposeRecipe, tryRecipe, rowWords };
