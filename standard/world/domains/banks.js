/* The six sheeted accounts are served as delivered: the files under sources/ are copied byte for byte, and the two simulated months after
   them are written in the same shapes. Nothing here can change a line on those accounts. */
"use strict";
const fs = require("fs");
const path = require("path");
const { toCents, fix, dmy, q, csvLines, monthRange, monthEnd, nextMonth, signed, money } = require("../lib/util");

const SHEETED = ["ACC-EVD", "ACC-OFF", "ACC-SAV", "ACC-HOL", "ACC-CC", "ACC-RNT"];
const FAMILY = { "ACC-EVD": "harbour-txn-csv", "ACC-OFF": "harbour-txn-csv", "ACC-RNT": "harbour-txn-csv", "ACC-SAV": "wattle-txn-csv", "ACC-HOL": "wattle-txn-csv", "ACC-CC": "southern-activity-csv" };

// the shapes, as portals/lib/shapes.js writes them
const harbourCsv = (number, rows, opening) => {
  let bal = opening; const out = [["Bank Account", "Date", "Narrative", "Debit Amount", "Credit Amount", "Balance", "Categories", "Serial"]];
  for (const r of rows) { bal += r.cents; out.push([number, dmy(r.date), r.desc, r.cents < 0 ? fix(-r.cents) : "", r.cents > 0 ? fix(r.cents) : "", fix(bal), "", ""]); }
  return { text: csvLines(out), closing: bal };
};
const wattleCsv = (rows, opening) => {
  let bal = opening; const out = [["Date", "Description", "Credit", "Debit", "Balance"]];
  for (const r of rows) { bal += r.cents; out.push([dmy(r.date), r.desc, r.cents > 0 ? fix(r.cents) : "", r.cents < 0 ? fix(r.cents) : "", fix(bal)]); }
  return { text: csvLines(out), closing: bal };
};
const southernCsv = (rows) => ({ text: csvLines([["Date", "Description", "Card Member", "Account #", "Amount"], ...rows.map((r) => [dmy(r.date), r.desc, "JORDAN DAVIES", "-41007", fix(-r.cents)])]) });
const barkCsv = (rows, opening) => {
  let bal = opening; const out = [];
  for (const r of rows) { bal += r.cents; out.push(`${dmy(r.date)},"${signed(r.cents)}","${r.desc.replace(/"/g, '""')}","${signed(bal)}"`); }
  return { text: out.reverse().map((l) => `${l}\r\n`).join(""), closing: bal };
};

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1)).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const monthOfFile = (name) => /(\d{4}-\d{2})\.csv$/.exec(name)[1];

function run(w, repo) {
  const base = w.base;
  // base lines, in months.json order, in cents
  const lines = {};
  for (const [date, acct, desc, amt] of base.transactions) (lines[acct] = lines[acct] || []).push({ date, desc, cents: toCents(amt) });
  w.baseLines = lines;
  const opening = {};
  for (const a of base.accounts) opening[a.id] = toCents(a.opening_balance);
  w.openings = opening;

  // the files as delivered
  for (const acct of SHEETED) {
    const dir = path.join(repo, "sources", acct);
    for (const f of walk(dir)) {
      const rel = f.slice(dir.length + 1).split(path.sep), bytes = new Uint8Array(fs.readFileSync(f));
      const body = Buffer.from(bytes).toString("utf8").split(/\r?\n/).filter((l) => l !== "");
      const n = body.length - 1, family = FAMILY[acct], expect = { txn_line: n };
      if (n > 0 && family !== "southern-activity-csv") expect.statement = 1;
      const ym = monthOfFile(rel[1]);
      w.file({ stream_id: acct, download_date: rel[0], name: rel[1], bytes, family, container: "csv", expect, origin: "portal", issued_on: monthEnd(ym) });
    }
    // the two months after the sheet, same shapes, same naming
    const acctRow = base.accounts.find((a) => a.id === acct);
    let bal = opening[acct];
    for (const r of lines[acct]) if (r.date < "2027-02-01") bal += r.cents;
    for (const ym of monthRange("2027-02", "2027-03")) {
      const rows = lines[acct].filter((r) => r.date.startsWith(ym)), family = FAMILY[acct];
      const name = family === "harbour-txn-csv" ? `Harbour-Transactions-${acct}-${ym}.csv` : family === "wattle-txn-csv" ? `Transactions-${ym}.csv` : `activity-${ym}.csv`;
      const made = family === "harbour-txn-csv" ? harbourCsv(acctRow.number, rows, bal) : family === "wattle-txn-csv" ? wattleCsv(rows, bal) : southernCsv(rows);
      for (const r of rows) bal += r.cents;
      const expect = { txn_line: rows.length };
      if (rows.length && family !== "southern-activity-csv") expect.statement = 1;
      w.file({ stream_id: acct, download_date: `${nextMonth(ym)}-02`, name, text: made.text, family, container: "csv", expect, origin: "portal", issued_on: monthEnd(ym), note: "simulated month after the sheet" });
    }
  }
}

module.exports = { run, SHEETED, harbourCsv, wattleCsv, southernCsv, barkCsv, money };
