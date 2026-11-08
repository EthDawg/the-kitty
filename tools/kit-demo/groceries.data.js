// Input for the groceries demo: { asOf, receipts, lines, people } in the shape src/kit/MODULES.md gives.
// Reads the Davies Receipts and Receipt Lines CSVs (contract v3 headers) from the first folder that holds receipts.csv and
// receipt-lines.csv: $KITTY_GROCERIES_DIR, this repo's data/groceries, then the groceries-data worktree beside it.
// Otherwise the fictional sample in test/fixtures/groceries-sample.json. KITTY_GROCERIES=sample forces the sample.
"use strict";
const fs = require("fs"), path = require("path"), os = require("os");
const ROOT = path.join(__dirname, "..", "..");
const FIXTURE = path.join(ROOT, "test", "fixtures", "groceries-sample.json");

function parseCSV(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"') q = true; else if (c === ",") { row.push(cell); cell = ""; } else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  const head = (rows.shift() || []).map((h) => h.replace(/^﻿/, "").trim());
  return rows.filter((r) => r.some((x) => x.trim() !== "")).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] || "").trim()])));
}
const n = (v) => (v === "" || v == null ? null : Number(String(v).replace(/[$,]/g, "")));
const RECEIPT = { "Receipt ID": "id", Date: "date", Time: "time", Merchant: "merchant", Store: "store", Channel: "channel", Person: "person", Items: "items", Total: "total", GST: "gst", Savings: "savings", "Paid with": "paidWith", "Entry ID": "entryId", "Account ID": "accountId", Source: "source", "Source kind": "sourceKind", Check: "check", Note: "note" };
const LINE = { "Receipt ID": "receiptId", Line: "line", "Printed text": "text", Product: "product", Brand: "brand", Group: "group", Kind: "kind", Qty: "qty", Unit: "unit", "Unit price": "unitPrice", Amount: "amount", GST: "gst", "Pack size": "pack", "Price per kg or L": "ppu", "Retailer code": "code", Note: "note" };
const NUM = new Set(["items", "total", "gst", "savings", "line", "qty", "unitPrice", "amount", "ppu"]);
const map = (rows, cols, numeric) => rows.map((r) => { const o = {}; for (const [h, k] of Object.entries(cols)) { const v = r[h] == null ? "" : r[h]; o[k] = numeric.has(k) && !(cols === LINE && k === "gst") && !(cols === RECEIPT && k === "check") ? n(v) : v; } return o; });

module.exports = function groceriesInput() {
  const dirs = [process.env.KITTY_GROCERIES_DIR, path.join(ROOT, "data", "groceries"), path.join(os.homedir(), "Developer", "the-kitty-groceries", "data", "groceries")];
  const dir = process.env.KITTY_GROCERIES === "sample" ? null : dirs.find((d) => d && fs.existsSync(path.join(d, "receipts.csv")) && fs.existsSync(path.join(d, "receipt-lines.csv")));
  if (dir) {
    const receipts = map(parseCSV(fs.readFileSync(path.join(dir, "receipts.csv"), "utf8")), RECEIPT, NUM);
    const lines = map(parseCSV(fs.readFileSync(path.join(dir, "receipt-lines.csv"), "utf8")), LINE, NUM);
    const latest = receipts.map((r) => r.date).filter(Boolean).sort().pop();
    return { asOf: process.env.KITTY_AS_OF || (latest && latest > "2027-01-31" ? latest : "2027-01-31"), receipts, lines, people: ["Jordan", "Mia"] };
  }
  const f = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
  return { asOf: f.asOf, receipts: f.receipts, lines: f.lines, people: f.people };
};
module.exports.parseCSV = parseCSV;
