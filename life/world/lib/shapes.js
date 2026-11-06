/* A bank's CSV as data: columns, date style, order, a footer. The public shapes are written byte for byte as standard/world/domains/banks.js writes them, so public recipes
   read them. A variant takes a base and changes one or two small things the way real banks do. Each shape can also say what recipe would read it, which is the answer key
   a harness uses to prove a variant is fair. A blind actor never sees it. */
"use strict";
const { fix, dmy, csvLines, fmtDate, money, signed, ofx, qif } = require("./std");

const col = (label, key) => ({ label, key });
const BASE = {
  westpaw: { family: "harbour-txn-csv", file: "Data.csv", header: true, order: "oldest_first", date: "dmy", account_col: true, columns: [col("Bank Account", "account"), col("Date", "date"), col("Narrative", "desc"), col("Debit Amount", "debit"), col("Credit Amount", "credit"), col("Balance", "balance"), col("Categories", "blank"), col("Serial", "blank")] },
  ping: { family: "wattle-txn-csv", file: "Transactions.csv", header: true, order: "oldest_first", date: "dmy", columns: [col("Date", "date"), col("Description", "desc"), col("Credit", "credit"), col("Debit", "debit_neg"), col("Balance", "balance")] },
  /* The layout the public recipes have never seen. Chapter 0's trap: the mismatch is the point. */
  ping2026: { family: null, key: "life-ping2026-csv", file: "Transactions.csv", header: true, order: "oldest_first", date: "dmy", columns: [col("Date", "date"), col("Details", "desc"), col("Money In", "credit"), col("Money Out", "debit"), col("Balance", "balance")] },
  bark: { family: "bark-noheader-csv", file: "CSVData.csv", header: false, order: "newest_first", date: "dmy", quoted: true, columns: [col("Date", "date"), col("Amount", "signed"), col("Description", "desc"), col("Balance", "signed_balance")] },
  ofx: { family: "wattle-ofx", file: "statement.ofx", special: "ofx" },
  qif: { family: "bark-qif", file: "statement.qif", special: "qif" },
};

const SYNONYM = { Narrative: "Details", Description: "Transaction Details", Details: "Particulars", Balance: "Running Balance", "Debit Amount": "Debit", "Credit Amount": "Credit", Credit: "Deposits", Debit: "Withdrawals", "Money In": "Paid In", "Money Out": "Paid Out", Date: "Transaction Date" };

function mutate(base, rng) {
  const s = JSON.parse(JSON.stringify(base));
  if (s.special) return s;
  s.family = null; s.key = null; s.changes = [];
  const kinds = rng.pick([["date"], ["rename"], ["order"], ["footer"], ["date", "footer"], ["rename", "order"], ["date", "rename"], ["preamble"]]);
  for (const k of kinds) {
    if (k === "date") { s.date = rng.pick(["iso", "dmony"]); s.changes.push(`date style ${s.date}`); }
    if (k === "rename" && s.header) { const c = rng.pick(s.columns.filter((x) => SYNONYM[x.label] && x.key !== "blank")); const was = c.label; c.label = SYNONYM[was]; s.changes.push(`header ${was} is now ${c.label}`); }
    if (k === "rename" && !s.header) { s.date = "iso"; s.changes.push("date style iso"); }
    if (k === "order") { const a = s.columns.findIndex((x) => /credit/.test(x.key)), b = s.columns.findIndex((x) => /debit/.test(x.key)); if (a >= 0 && b >= 0) { const t = s.columns[a]; s.columns[a] = s.columns[b]; s.columns[b] = t; s.changes.push("credit and debit columns swapped"); } else { s.order = s.order === "newest_first" ? "oldest_first" : "newest_first"; s.changes.push("row order flipped"); } }
    if (k === "footer" && s.header) { s.footer = true; s.changes.push("a closing balance footer row"); }
    if (k === "footer" && !s.header) { s.order = "oldest_first"; s.changes.push("row order flipped"); }
    if (k === "preamble" && s.header) { s.preamble = true; s.changes.push("an account line above the header"); }
    if (k === "preamble" && !s.header) { s.date = "dmony"; s.changes.push("date style dmony"); }
  }
  return s;
}

const stamp = (iso, style) => (style === "iso" ? iso : style === "dmony" ? fmtDate(iso) : dmy(iso));
const q = (v) => `"${String(v).replace(/"/g, '""')}"`;

function csvFile(shape, number, rows, opening) {
  let bal = opening;
  const body = rows.map((r) => {
    bal += r.cents; const b = bal;
    return shape.columns.map((c) => {
      switch (c.key) {
        case "account": return number;
        case "date": return stamp(r.date, shape.date);
        case "desc": return r.desc;
        case "debit": return r.cents < 0 ? fix(-r.cents) : "";
        case "debit_neg": return r.cents < 0 ? fix(r.cents) : "";
        case "credit": return r.cents > 0 ? fix(r.cents) : "";
        case "balance": return fix(b);
        case "signed": return signed(r.cents);
        case "signed_balance": return signed(b);
        default: return "";
      }
    });
  });
  const closing = bal;
  if (shape.order === "newest_first") body.reverse();
  if (shape.quoted) return { text: body.map((r) => `${r[0]},${q(r[1])},${q(r[2])},${q(r[3])}\r\n`).join(""), closing };
  const head = shape.header ? [shape.columns.map((c) => c.label)] : [], pre = shape.preamble ? [[`Account ${number}`, ...shape.columns.slice(1).map(() => "")]] : [];
  const foot = shape.footer ? [shape.columns.map((c) => (c.key === "date" ? "Closing balance" : c.key === "balance" ? fix(closing) : ""))] : [];
  return { text: csvLines([...pre, ...head, ...body, ...foot]), closing };
}

function bankFile(shape, a) {
  if (shape.special === "ofx") return { text: ofx({ account: a.number, bankId: a.bankId || "633000", from: a.from, to: a.to, rows: a.rows, closing: a.closing, asOf: a.to }), closing: a.closing };
  if (shape.special === "qif") return { text: qif({ rows: a.rows, opening: a.opening, from: a.from }), closing: a.closing };
  return csvFile(shape, a.number, a.rows, a.opening);
}

/* The recipe a person's agent would write, from the same spec. fingerprint is filled in by the caller from a real file. */
function recipeFor(id, shape, fingerprint, streamHasNumber) {
  const by = (k) => (shape.columns.find((c) => c.key === k) || {}).label;
  const fields = { account_ref: by("account") ? { col: by("account") } : { stream: true }, posting_date: { col: by("date"), as: "date" }, description: { col: by("desc") } };
  if (by("signed")) fields.amount_cents = { col: by("signed"), as: "cents" };
  else if (by("debit_neg")) fields.amount_cents = { sum: [{ col: by("credit") }, { col: by("debit_neg") }] };
  else fields.amount_cents = { credit: by("credit"), debit: by("debit") };
  fields.balance_after_cents = { col: by("balance") || by("signed_balance"), as: "cents" };
  const table = { order: shape.order };
  if (shape.header) table.header = shape.preamble ? 2 : 1; else table.columns = shape.columns.map((c) => c.label);
  if (shape.footer) table.skip_tail = 1;
  void streamHasNumber;
  return { id, version: 1, tier: "table", container: "csv", fingerprints: [fingerprint], defaults: { date: shape.date }, table, emit: [{ kind: "txn_line", fields }], statement: { from: "chain" }, controls: [{ law: "balance_chain" }, { law: "family_chain" }] };
}

module.exports = { BASE, mutate, bankFile, recipeFor, money };
