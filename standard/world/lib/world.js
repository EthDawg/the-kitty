/* What the domains write into: files with their manifest facts, setup rows, truth, decisions, and bank lines added to accounts
   whose files are written last so every domain can add money to them. */
"use strict";
const { Rng } = require("./util");

const TABLES = ["household", "party", "membership", "account", "alias", "ownership", "link", "category", "instrument", "asset", "activity", "contract", "term", "period", "stream", "scope", "tax_map",
  "budget", "goal", "reservation", "scenario", "assumption"];

class World {
  constructor(opts) {
    this.deflate = opts.deflate; this.deflateRaw = opts.deflateRaw; this.base = opts.base; this.sheet = opts.sheet;
    this.files = []; this.decisions = []; this.truth = {}; this.setup = {};
    for (const t of TABLES) this.setup[t] = [];
    this.lines = {};      // account -> [{date, desc, cents, seq}] for the accounts whose files the world writes
    this.termSeq = 0;
    this.END = "2027-03-31";
    this.SHEET_END = "2027-01-31";
  }
  rng(name) { return new Rng(name); }
  /* one delivered file. expect is {kind: count}, computed by the domain from what it wrote, never by a recipe. */
  file(f) {
    for (const k of ["stream_id", "download_date", "name", "family", "container"]) if (f[k] == null) throw new Error(`file missing ${k}: ${f.name}`);
    if (f.text != null) f.bytes = new TextEncoder().encode(f.text);
    if (!(f.bytes instanceof Uint8Array)) f.bytes = new Uint8Array(f.bytes);
    delete f.text;
    if (f.recipe === undefined) f.recipe = f.family;
    f.tier = f.tier || "recipe";
    f.path = `sources/${f.stream_id}/${f.download_date}/${f.name}`;
    this.files.push(f);
    return f;
  }
  // a bank line on an account the world writes the files for. order keeps base lines first within a day.
  line(account, date, desc, cents, extra) {
    if (!this.lines[account]) this.lines[account] = [];
    this.lines[account].push({ date, desc, cents, seq: this.lines[account].length, ...(extra || {}) });
  }
  term(row) {
    this.termSeq += 1;
    this.setup.term.push({ term_id: `TERM-${String(this.termSeq).padStart(4, "0")}`, recorded_at: `${row.valid_from}T00:00:00Z`, ...row });
  }
}

module.exports = { World, TABLES };
