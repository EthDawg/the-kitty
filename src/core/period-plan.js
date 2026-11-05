/* The Kitty period core: the plan. Turns the files a household downloaded and the sheet as it stands into a verified write plan, and
   nothing else: the same decisions as period-close/import_month.py, without its file system. Identity de-duplication, fail-loud gathering,
   transfers, loans, valuations, payslips, owner statements, policies, closing checks, IDs. See period-CONTRACT.md. Money is integer cents.
   Runs in the page, in WKWebView and in node. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./period-text.js"), require("./period-adapters.js"), require("./period-writeplan.js"));
  else root.KittyPeriodPlan = factory(root.KittyPeriodText, root.KittyPeriodAdapters, root.KittyPeriodWritePlan);
})(typeof self !== "undefined" ? self : this, function (T, A, W) {
  "use strict";
  const P = {};
  const { ImportFault, Stop } = A;
  const { fmt2, plus2, ident, normalise, repr } = T;
  const ENTRY_COLS = ["Entry ID", "Kind", "Settled at", "Account ID", "Raw text", "Description", "Amount", "Category ID", "Person", "Receipt held", "Note",
    "Status", "Created at", "Transfer ID", "Transfer account", "Foreign amount", "Foreign currency", "Units", "Unit price", "Source"];
  const TXN_COLS = ["Txn ID", "Date", "Account ID", "Bank description", "Merchant", "Amount", "Category ID", "Person", "Receipt held", "Note"];
  const PAYSLIP_COLS = ["Pay date", "Person", "Employer", "Gross pay", "Tax withheld", "Super (employer)", "Net pay"];
  const VALUATION_COLS = ["Month end", "Item ID", "Value"];
  const TRANSFER_DAYS = 4;
  const TOL = 0.005;

  class PeriodInputError extends Error {}
  P.PeriodInputError = PeriodInputError;

  const nextId = (prefix, last) => `${prefix}${String(last + 1).padStart(4, "0")}`;
  const idNumber = (s, prefix) => { const m = new RegExp(`^${prefix}(\\d+)$`).exec(s === null || s === undefined ? "" : String(s)); return m ? Number(m[1]) : 0; };
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const by = (...keys) => (x, y) => { for (const k of keys) { const c = cmp(k(x), k(y)); if (c) return c; } return 0; };
  const key = (...parts) => JSON.stringify(parts);
  const lower = (v) => T.str(v).toLowerCase();
  const inc = (m, k, n = 1) => m.set(k, (m.get(k) || 0) + n);
  const plural = (n) => (n !== 1 ? "s" : "");
  const money = T.amount;

  // ---------- the sheet ----------
  const readSheet = (doc, opts) => {
    const s = { doc, version: "entries" in doc ? 2 : 1, path: opts.snapshot_label === undefined ? null : opts.snapshot_label };
    if (s.version === 1 && !opts.allow_v1) throw new PeriodInputError("sheet_version 2 only: this sheet has no Entries. allow_v1 exists for the parity harness");
    s.accounts = new Map();
    for (const a of doc.accounts || []) if (a.account_id) s.accounts.set(a.account_id, a);
    s.flow = new Map();
    for (const c of doc.category_list || []) if (c.category_id) s.flow.set(c.category_id, c.flow || "Expense");
    s.categories = new Set(s.flow.keys());
    s.contracts = (doc.contracts || []).map((c, i) => ({ ...c, row: i + 2 }));
    s.rules = doc.rules || [];
    s.payslips = (doc.payslips || []).map((p, i) => ({ ...p, row: i + 2 }));
    s.valuationItems = new Set(s.accounts.keys());
    for (const a of doc.assets || []) if (a.item_id) s.valuationItems.add(a.item_id);
    for (const l of doc.loans || []) if (l.loan_id) s.valuationItems.add(l.loan_id);
    s.id = opts.sheet_id || (doc.source || {}).sheet || (s.version === 2 ? (opts.default_sheet_ids || {}).v2 : (opts.default_sheet_ids || {}).v1) || null;
    s.fetched = doc.fetchedAt === undefined ? null : doc.fetchedAt;
    if (s.version === 2) {
      const entries = doc.entries || [];
      s.rows = entries.length;
      s.lastEntryId = entries.length ? entries[entries.length - 1].entry_id : null;
      s.tx = []; s.valuations = [];
      entries.forEach((e, i) => {
        const kind = (e.kind || "transaction").toLowerCase();
        if (kind === "transaction") s.tx.push({ id: e.entry_id, date: e.settled_at, account: e.account_id, raw: e.raw_text || "", merchant: e.description || "", amount: T.sheetCents(e.amount),
          category: e.category_id || "UNCAT", person: e.person || "Joint", transfer_id: e.transfer_id || "", row: i + 2 });
        else if (kind === "valuation") s.valuations.push({ account: e.account_id, month_end: e.settled_at, value: T.sheetCents(e.amount), row: i + 2 });
      });
      s.lastT = Math.max(0, ...entries.map((e) => idNumber(e.entry_id, "T")));
      s.lastV = Math.max(0, ...entries.map((e) => idNumber(e.entry_id, "V")));
      s.lastX = Math.max(0, ...entries.map((e) => idNumber(e.transfer_id, "X")));
      s.allIds = new Set(entries.map((e) => e.entry_id));
    } else {
      const tx = doc.transactions || [];
      s.tx = tx.map((t, i) => ({ id: t.txn_id, date: t.date, account: t.account_id, raw: t.bank_description || "", merchant: t.merchant || "", amount: T.sheetCents(t.amount),
        category: t.category_id || "UNCAT", person: t.person || "Joint", transfer_id: "", row: i + 2 }));
      s.rows = tx.length;
      s.lastEntryId = tx.length ? tx[tx.length - 1].txn_id : null;
      s.lastT = Math.max(0, ...tx.map((t) => idNumber(t.txn_id, "T")));
      s.lastV = s.lastX = 0;
      s.allIds = new Set(tx.map((t) => t.txn_id));
      s.valuations = doc.valuations === null || doc.valuations === undefined ? null
        : doc.valuations.map((v, i) => ({ account: v.item_id, month_end: v.month_end, value: T.sheetCents(v.value), row: i + 2 }));
    }
    s.institution = (acct) => (s.accounts.get(acct) || {}).institution || A.INSTITUTION[acct];
    return s;
  };

  // ---------- the sources tree ----------
  const classify = (name, sheet, folder) => {
    if (name === "payslips") return ["payslips", null];
    const a = sheet.accounts.get(name);
    if (a) {
      const t = (a.type ? String(a.type) : "").toLowerCase();
      if (t === "loan") return ["loan", a];
      if (t === "property") return ["owner", a];
      if (A.BANK_SHAPES.includes(sheet.institution(name))) return ["bank", a];
      throw new ImportFault("no_adapter_account", folder, `${name} is on the Accounts tab as type ${repr(a.type)} at ${repr(a.institution)}, which has no adapter`,
        "add the institution's shape to adapters.py, or set the account's institution on the Accounts tab to one the importer knows. Nothing in this folder was read");
    }
    if (name.startsWith("POL-") && sheet.accounts.has(name.slice(4))) return ["policy", sheet.accounts.get(name.slice(4))];
    if (name in A.INSTITUTION && !sheet.accounts.size) return ["bank", { account_id: name, institution: A.INSTITUTION[name] }];
    throw new ImportFault("unknown_account", folder, `unknown account folder ${repr(name)}: not on the Accounts tab`,
      "add the account to the Accounts tab (institution, type, opening balance and opening date) before importing its files, or rename the folder to the account id it belongs to. Nothing in this folder was read");
  };

  // The host's flat list as Python's walk sees it: account -> entries (day folders and stray files), each sorted. Input order never matters.
  const tree = (files) => {
    const accounts = new Map();
    const faults = [];
    const pathOf = (f) => {
      if (f.path !== undefined) return String(f.path);
      if (f.account === undefined || f.download_day === undefined) return String(f.name);
      return `${f.account}/${f.download_day}/${f.name}`;
    };
    for (const f of files) {
      const parts = pathOf(f).split("/").filter((p) => p !== "");
      if (parts.length === 1 && !f.is_dir) {
        if (!parts[0].startsWith(".")) faults.push(new ImportFault("file_outside_download_folder", parts[0], "a file with no account or download date", "files live in sources/<account id>/<yyyy-mm-dd>/; move it into the folder of its account, named for the day it was downloaded"));
        continue;
      }
      const acct = accounts.get(parts[0]) || new Map();
      accounts.set(parts[0], acct);
      if (parts.length === 1) continue;
      const entry = acct.get(parts[1]) || { name: parts[1], isDir: false, children: new Map() };
      acct.set(parts[1], entry);
      if (parts.length === 2) { entry.isDir = !!f.is_dir; if (!f.is_dir) entry.file = f; continue; }
      entry.isDir = true;
      const child = { name: parts[2], file: f, isDir: !!f.is_dir || parts.length > 3 };
      entry.children.set(parts[2], child);
    }
    return { accounts, faults };
  };
  const sortedKeys = (m) => Array.from(m.keys()).sort(cmp);

  const suffix = (name) => { const dot = name.lastIndexOf("."); return dot > 0 && dot < name.length - 1 ? name.slice(dot).toLowerCase() : ""; };

  const readOne = (entry, rel, kind, acct, sheet, w) => {
    if (entry.isDir) throw new ImportFault("nested_folder", rel, "a folder inside a download-date folder", "files sit directly in sources/<account>/<download date>/; nested folders are not read");
    const f = entry.file, ext = suffix(entry.name);
    const base = { path: rel, account: acct, kind, download_day: w.download_day, bom: false, shape: null, rows: [] };
    if (ext === ".pdf") {
      if (kind !== "policy") throw new ImportFault("pdf_no_adapter", rel, "a PDF with no adapter", "the importer reads bank, loan, owner-statement and payslip files as CSV; download the CSV export for this account. PDFs are read only from the insurer portal (sources/POL-<property>/)");
      const doc = A.readPolicy(f, rel);
      if (doc.property && doc.property !== acct.slice(4)) throw new ImportFault("policy_wrong_folder", rel, `a policy for ${doc.property} in the ${acct} folder`, "move the file to the folder of the property it insures");
      return { ...base, shape: "Policy PDF", rows: [doc] };
    }
    if (ext !== ".csv") throw new ImportFault("file_type", rel, `unrecognised file type ${repr(ext || entry.name)}`, "the importer reads CSV exports (and the insurer's PDFs); export again as CSV, never convert by hand");
    if (kind === "policy") throw new ImportFault("csv_in_policy", rel, "a CSV in a policy folder", "the insurer portal issues PDFs; this folder takes the renewal notice and the certificate of currency");
    const { rows: cells, bom } = A.loadCells(f, rel);
    const shape = A.sniff(cells, rel);
    let rows;
    if (kind === "bank") {
      const expected = sheet.institution(acct);
      if (shape !== expected) throw new ImportFault("wrong_institution", rel, `a ${shape} file in the ${acct} folder, whose institution is ${expected}`, "the file is in the wrong account folder, or the Accounts tab names the wrong institution for this account");
      rows = A.readRows(cells, rel, shape, w);
    } else if (kind === "loan") {
      if (!A.BANK_SHAPES.includes(shape) || !A.SHAPES[shape].balance) throw new ImportFault("wrong_loan_shape", rel, `a ${shape} file in the loan folder ${acct}`, "a loan statement comes in the lender's transaction columns with a running balance (the Westpac shape here); download the loan's CSV export");
      const expected = sheet.institution(acct);
      if (A.BANK_SHAPES.includes(expected) && shape !== expected) throw new ImportFault("wrong_lender", rel, `a ${shape} file for ${acct}, whose lender is ${expected}`, "the file is in the wrong folder, or the Accounts tab names the wrong lender");
      rows = A.readRows(cells, rel, shape, w);
    } else if (kind === "owner") {
      if (shape !== "Owner statement") throw new ImportFault("wrong_owner_shape", rel, `a ${shape} file in the property folder ${acct}`, "a property folder takes the agent's owner statement lines (Date, Description, Rental schedule line, Money in, Money out, Handled by); bank files go under the bank account");
      rows = A.readRows(cells, rel, shape, { download_day: w.download_day, as_of: w.as_of });
    } else {
      if (shape !== "Payslips") throw new ImportFault("wrong_payslip_shape", rel, `a ${shape} file in the payslips folder`, "the payslips folder takes the payroll export in the Payslips tab's columns");
      rows = A.readRows(cells, rel, shape, { download_day: w.download_day, as_of: w.as_of });
    }
    return { ...base, shape, bom, rows };
  };

  // Every file read through its adapter; a Stop with every fault found.
  const gather = (files, sheet, asOf, firstDay, sourcesLabel) => {
    if (files === null || files === undefined) throw new Stop([new ImportFault("sources_missing", sourcesLabel === undefined ? "sources" : sourcesLabel, "the sources folder does not exist", "download the month's files into sources/<account id>/<download date>/ first")]);
    const { accounts, faults } = tree(files);
    const readings = [];
    for (const name of sortedKeys(accounts)) {
      if (name.startsWith(".")) continue;
      let kind, account;
      try { [kind, account] = classify(name, sheet, name); }
      catch (e) { if (!(e instanceof ImportFault)) throw e; faults.push(e); continue; }
      const openingDate = (kind === "bank" || kind === "loan") ? (account || {}).opening_date : null;
      const acct = accounts.get(name);
      for (const dayName of sortedKeys(acct)) {
        if (dayName.startsWith(".")) continue;
        const day = acct.get(dayName), relDay = `${name}/${dayName}`;
        if (!day.isDir) { faults.push(new ImportFault("file_outside_download_folder", relDay, "a file where a download-date folder should be", "files live in sources/<account id>/<yyyy-mm-dd>/; move it into a folder named for the day it was downloaded")); continue; }
        const m = /^(\d{4}-\d{2}-\d{2})(?:$|[-_ ].*)/.exec(dayName);
        const downloadDay = m && T.isIsoDate(m[1]) ? m[1] : null;
        if (!downloadDay) { faults.push(new ImportFault("not_a_download_folder", relDay, `folder ${repr(dayName)} is not a download date`, "name the folder yyyy-mm-dd (the day the file was downloaded), optionally followed by a label, for example 2027-03-02-jordan")); continue; }
        for (const fileName of sortedKeys(day.children)) {
          if (fileName.startsWith(".")) continue;
          const rel = `${relDay}/${fileName}`;
          try { readings.push(readOne(day.children.get(fileName), rel, kind, name, sheet, { download_day: downloadDay, opening_date: openingDate, as_of: asOf, first_day: firstDay })); }
          catch (e) { if (!(e instanceof ImportFault)) throw e; faults.push(e); }
        }
      }
    }
    if (faults.length) throw new Stop(faults);
    return readings;
  };

  // ---------- de-duplication ----------
  // For each identity the run takes max(count in any one file) - count in the sheet, attributed file by file in order.
  P.dedupe = (files, existing, keyOf) => {
    const counts = [], runCount = new Map();
    for (const [rd, rows] of files) {
      const inst = new Map();
      for (const r of rows) { const k = keyOf(rd, r); if (!inst.has(k)) inst.set(k, []); inst.get(k).push(r); }
      counts.push(inst);
      for (const [k, list] of inst) runCount.set(k, Math.max(runCount.get(k) || 0, list.length));
    }
    const remaining = new Map();
    for (const [k, n] of runCount) remaining.set(k, Math.max(0, n - (existing.get(k) || 0)));
    const taken = [], skipped = [], repeated = [], kept = [];
    files.forEach(([rd], i) => {
      let nKept = 0;
      for (const [k, list] of counts[i]) {
        const n = list.length, already = Math.min(n, existing.get(k) || 0), take = Math.min(n - already, remaining.get(k));
        remaining.set(k, remaining.get(k) - take);
        list.slice(0, already).forEach((r) => skipped.push([rd, r]));
        list.slice(already, already + take).forEach((r) => taken.push([rd, r]));
        list.slice(already + take).forEach((r) => repeated.push([rd, r]));
        nKept += take;
      }
      kept.push(nKept);
    });
    return { taken, skipped, repeated, kept };
  };
  const bankKey = (rd, r) => key(r.date, rd.account, r.amount, ident(r.description));

  // ---------- categorising: overrides, then rules, then history, then new ----------
  P.Categoriser = class {
    constructor(sheet, history, overrides) {
      this.exact = new Map(); this.loose = new Map(); this.rulesExact = new Map(); this.rulesNorm = new Map();
      this.overrides = overrides || new Map();
      for (const rule of sheet.rules) {
        if (!rule.pattern || !rule.category_id) continue;
        const val = { merchant: rule.merchant || "", category: rule.category_id, person: rule.person || "Joint" };
        const [map, k] = lower(rule.match || "normalised") === "exact" ? [this.rulesExact, rule.pattern] : [this.rulesNorm, normalise(rule.pattern)];
        if (!map.has(k)) map.set(k, val);
      }
      const add = (m, k, merchant, category, person) => {
        if (!m.has(k)) m.set(k, new Map());
        const seen = m.get(k), tk = key(merchant, category, person), e = seen.get(tk);
        if (e) e.n++; else seen.set(tk, { merchant, category, person, n: 1 });
      };
      const learn = (desc, merchant, category, person) => { add(this.exact, desc, merchant, category, person); add(this.loose, normalise(desc), merchant, category, person); };
      for (const row of history || []) learn(row[3], row[4], row[6], row[7]);
      for (const t of sheet.tx) learn(t.raw, t.merchant, t.category, t.person || "Joint");
    }
    call(desc, amount) {
      if (this.overrides.has(desc)) {
        const o = this.overrides.get(desc);
        const get = (k) => (k in o ? o[k] : "");
        return { merchant: o.Merchant, category: o["Category ID"], person: o.Person, receipt: get("Receipt held"), note: get("Note"), line: `- ${desc}: set by review to ${T.str(o["Category ID"])}` };
      }
      const rule = this.rulesExact.get(desc) || this.rulesNorm.get(normalise(desc));
      if (rule) return { merchant: rule.merchant || T.title(desc), category: rule.category, person: rule.person, receipt: "", note: "", line: null };
      const seen = this.exact.get(desc) || this.loose.get(normalise(desc));
      if (seen) {
        let top = null;
        for (const e of seen.values()) if (!top || e.n > top.n) top = e;
        const byCat = new Map();
        for (const e of seen.values()) byCat.set(e.category, e.n);
        const line = byCat.size > 1 ? `- ${desc}: history has {${Array.from(byCat, ([c, n]) => `${repr(c)}: ${n}`).join(", ")}}, used ${top.category}` : null;
        return { merchant: top.merchant, category: top.category, person: top.person, receipt: "", note: "", line };
      }
      return { merchant: T.title(desc), category: "UNCAT", person: "Joint", receipt: "", note: "New merchant, check category", line: `- ${desc} (${plus2(amount)}): new merchant, left Uncategorised` };
    }
  };

  const needColumns = (table, names, file) => {
    const missing = names.filter((n) => !table.head.includes(n));
    if (missing.length) throw new ImportFault("bad_value", file, `missing column${plural(missing.length)} ${missing.join(", ")}`, "write the header row the importer expects; see skills/bank-export/SKILL.md");
  };
  const table = (input) => {
    const t = input.text.startsWith("\ufeff") ? input.text.slice(1) : input.text;
    try { return T.dictRows(t); }
    catch (e) { if (e instanceof T.CsvError) throw new ImportFault("csv_unreadable", input.path, `not a readable table: ${e.message}`, "the file is corrupt; save it again as CSV (UTF-8)"); throw e; }
  };
  // A typed input number: what Python's fnum reads, except that a value it would turn into 0.00 is a fault here (see the parity allowlist).
  const typedCents = (v, label, file, row) => {
    const n = v === null || T.strip(v) === "" ? null : T.pyFloat(v);
    if (n === null || !Number.isFinite(n)) throw new ImportFault("bad_value", file, `${label} ${repr(v)} is not a number`, "write it as plain digits, for example 1250000.00; a blank or a thousands comma would read as zero", row);
    return T.toCents(n);
  };

  // ---------- closing balances ----------
  // Each bank file's last balance in the window against the opening balance plus every row to that date, the planned rows included.
  const closingChecks = (sheet, newRows, readings, months) => {
    const opening = new Map(), book = new Map();
    for (const [k, a] of sheet.accounts) opening.set(k, T.sheetCents(a.opening_balance));
    const put = (acct, date, amount) => { if (!book.has(acct)) book.set(acct, []); book.get(acct).push([date, amount]); };
    for (const t of sheet.tx) put(t.account, t.date, t.amount);
    for (const r of newRows) put(r.acct, r.date, r.amount);
    const lines = [], checks = [], holds = [];
    let held = false;
    for (const rd of readings) {
      if (rd.kind !== "bank") continue;
      const inWindow = rd.rows.filter((r) => months.includes(r.date.slice(0, 7)));
      const shape = A.SHAPES[rd.shape];
      if (!shape.balance) {
        if (inWindow.length) { lines.push(`- ${rd.path}: not checked, this format prints no balance`); checks.push({ file: rd.path, unchecked: "no balance printed" }); }
        continue;
      }
      if (!inWindow.length) continue;
      if (!opening.has(rd.account)) { lines.push(`- ${rd.path}: not checked, ${rd.account} is not on the Accounts tab`); checks.push({ file: rd.path, unchecked: "not on the Accounts tab" }); continue; }
      const last = shape.sequence === "oldest-first" ? inWindow[inWindow.length - 1] : inWindow[0];
      const day = last.date, printed = last.balance;
      const worked = (book.get(rd.account) || []).reduce((s, [d, a]) => (d <= day ? s + a : s), opening.get(rd.account));
      const gap = money(worked) - printed, ok = Math.abs(gap) < TOL;
      held = held || !ok;
      const text = `- ${rd.path}: ${day} file ${fmt2(T.toCents(printed))}, ledger ${fmt2(worked)}, ${ok ? "OK" : `MISMATCH of ${T.plusGrouped2(T.toCents(gap))}`}`;
      lines.push(text);
      checks.push({ file: rd.path, day, printed, ledger: money(worked), ok, gap_cents: T.toCents(gap) });
      if (!ok) holds.push({ code: "closing_mismatch", file: rd.path, text });
    }
    return { lines, checks, held, holds };
  };

  const monthsOf = (spec) => {
    const parts = String(spec).split("..");
    if (parts.length > 2) throw new PeriodInputError(`${spec}: not a month (YYYY-MM)`);
    for (const m of parts) if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) throw new PeriodInputError(`${m}: not a month (YYYY-MM)`);
    if (parts.length === 1) return parts;
    if (parts[0] > parts[1]) throw new PeriodInputError(`${spec}: the first month is after the last`);
    const out = [];
    let y = Number(parts[0].slice(0, 4)), m = Number(parts[0].slice(5, 7));
    for (;;) {
      const cur = `${y}-${String(m).padStart(2, "0")}`;
      out.push(cur);
      if (cur >= parts[1]) return out;
      if (++m === 13) { y++; m = 1; }
    }
  };
  P.monthsOf = monthsOf;

  // ---------- the run ----------
  P.plan = (input) => {
    const opts = input.options || {};
    const label = input.months, months = monthsOf(label);
    const firstDay = `${months[0]}-01`, lastDay = T.monthEnd(months[months.length - 1]);
    const sheet = readSheet(input.sheet, opts);
    const loansNow = opts.loans === "now";
    const inputs = input.inputs || [];
    const ofKind = (k) => inputs.filter((i) => i.kind === k);
    const inWindow = (r) => firstDay <= r.date && r.date <= lastDay;

    const review = []; let stopLines = [], faultsOut = []; const holdLines = [], holds = [];
    let held = false;
    let rows = [], loanTx = [], valuations = [], payslips = [], pairUpdates = [], contractUpdates = [];
    const loanPairs = [], planNotes = [], pairs = [], loanPairsOut = [];
    let fileLines = [], loanLines = [], valLines = [], payLines = [], ownerLines = [], policyLines = [], balanceLines = [], transferLines = [];
    let skipped = [], repeated = [], outsideWindow = [], closing = [];
    let nextX = sheet.lastX;
    const hold = (code, file, text) => { held = true; holdLines.push(text); holds.push({ code, file, text }); };

    try {
      const overrides = new Map();
      for (const o of ofKind("overrides")) {
        const t = table(o);
        needColumns(t, ["Description", "Merchant", "Category ID", "Person"], o.path);
        for (const r of t.rows) if (!overrides.has(r.Description)) overrides.set(r.Description, r);
      }
      const cat = new P.Categoriser(sheet, opts.history, overrides);
      const readings = gather(input.files, sheet, opts.as_of, firstDay, opts.sources_label);

      // ---- bank rows: identity de-duplication, then categorising
      const bank = readings.filter((rd) => rd.kind === "bank");
      const existing = new Map();
      for (const t of sheet.tx) inc(existing, key(t.date, t.account, t.amount, ident(t.raw)));
      const d = P.dedupe(bank.map((rd) => [rd, rd.rows.filter(inWindow)]), existing, bankKey);
      skipped = d.skipped; repeated = d.repeated;
      const quiet = [], gaps = new Map();
      bank.forEach((rd, i) => {
        const inside = rd.rows.filter(inWindow), earlier = rd.rows.filter((r) => r.date < firstDay), later = rd.rows.filter((r) => r.date > lastDay);
        const gap = earlier.filter((r) => !existing.has(bankKey(rd, r)));
        let line = `- ${rd.path}: ${inside.length} rows in ${label}, ${d.kept[i]} new`;
        if (earlier.length) line += `; ${earlier.length} earlier` + (gap.length ? ` (${gap.length} not in the sheet: a month never imported, or a gap)` : " (all in the sheet)");
        if (later.length) line += `; ${later.length} later, left for their month`;
        if (!rd.rows.length) line += "; header only, no rows (fine for a dormant account; check if you expected movement)";
        if (rd.bom) line += "; UTF-8 byte order mark accepted";
        const near = firstDay <= rd.download_day && rd.download_day <= T.addDays(lastDay, 40);
        if (inside.length || gap.length || later.length || rd.bom || (!rd.rows.length && near)) fileLines.push(line);
        else quiet.push(rd.path);
        outsideWindow.push({ file: rd.path, earlier: earlier.length, later: later.length, gap: gap.length });
        if (gap.length) {
          const g = gaps.get(rd.account) || { rows: 0, files: 0, first: null };
          gaps.set(rd.account, g);
          g.rows += gap.length; g.files += 1;
          g.first = g.first === null || gap[0].date < g.first ? gap[0].date : g.first;
        }
      });
      if (quiet.length) fileLines.push(`- ${quiet.length} other file${plural(quiet.length)} hold no rows in ${label}; every row in them is earlier and in the sheet`);
      for (const [acct, g] of gaps) review.push(`- ${acct}: ${g.rows} rows before ${firstDay} in ${g.files} file${plural(g.files)} are not in the sheet (earliest ${g.first}); close those months first or they stay out`);
      for (const [rd, r] of d.taken) {
        const c = cat.call(r.description, r.amount);
        if (c.line) review.push(c.line);
        rows.push({ date: r.date, acct: rd.account, desc: r.description, merchant: c.merchant, amount: r.amount, cat: c.category, person: c.person, receipt: c.receipt, note: c.note,
          transfer_id: "", transfer_account: "", source: "bank export", file: rd.path, line: r.line });
      }
      rows.sort(by((r) => r.date, (r) => r.acct, (r) => -r.amount));
      rows.forEach((r, i) => {
        r.id = nextId("T", sheet.lastT + i);
        if (sheet.allIds.has(r.id)) throw new Stop([new ImportFault("id_collision", sheet.path, `planned ID ${r.id} already exists in the sheet`, "the snapshot is older than the sheet, or IDs were typed by hand; refresh the snapshot and re-run")]);
      });
      const unknownCats = sheet.categories.size ? Array.from(new Set(rows.map((r) => r.cat).filter((c) => !sheet.categories.has(c)))).sort(cmp) : [];
      if (unknownCats.length) throw new Stop([new ImportFault("unknown_category", "overrides.csv / Rules", `category ${unknownCats.join(", ")} is not on the Categories tab`, "use a category id from the Categories tab, or add the category there first")]);

      // ---- transfers among own accounts: a mate of the opposite amount within four days (ledger sheets only)
      if (sheet.version === 2) {
        const lo = T.addDays(firstDay, -TRANSFER_DAYS), hi = T.addDays(lastDay, TRANSFER_DAYS);
        const cands = rows.filter((r) => sheet.flow.get(r.cat) === "Transfer").map((r) => ({ ref: r, isNew: true, date: r.date, acct: r.acct, amount: r.amount, id: r.id }))
          .concat(sheet.tx.filter((t) => sheet.flow.get(t.category) === "Transfer" && !t.transfer_id && lo <= t.date && t.date <= hi).map((t) => ({ ref: t, isNew: false, date: t.date, acct: t.account, amount: t.amount, id: t.id })));
        cands.sort(by((c) => c.date, (c) => c.acct));
        const done = new Set();
        const says = (c) => `${c.id} ${c.date} ${c.acct} ${plus2(c.amount)}`;
        cands.forEach((a, i) => {
          if (done.has(i)) return;
          let matches = [];
          cands.forEach((b, j) => { if (j !== i && !done.has(j) && b.amount === -a.amount && b.acct !== a.acct && T.daysApart(a.date, b.date) <= TRANSFER_DAYS) matches.push([j, b]); });
          if (matches.length > 1) { const same = matches.filter(([, b]) => b.date === a.date); if (same.length === 1) matches = same; }
          if (matches.length === 1) {
            const [j, b] = matches[0];
            if (!a.isNew && !b.isNew) return;
            nextX += 1;
            const xid = `X${String(nextX).padStart(4, "0")}`;
            for (const [one, other] of [[a, b], [b, a]]) {
              if (one.isNew) { one.ref.transfer_id = xid; one.ref.transfer_account = other.acct; }
              else pairUpdates.push(W.updateWrite(`pair-${one.id}`, "Entries", one.ref.row, 14, [xid, other.acct], { range: W.a1("Entries", one.ref.row, 1), expect: [[one.id]] },
                `${one.id} (${one.date} ${one.acct} ${plus2(one.amount)}) gets its mate ${other.id}`));
            }
            done.add(i); done.add(j);
            transferLines.push(`- ${xid}: ${says(a)} with ${says(b)}`);
            const side = (c) => ({ id: c.id, date: c.date, account: c.acct, amount_cents: c.amount, new: c.isNew });
            pairs.push({ transfer_id: xid, a: side(a), b: side(b) });
          } else if (matches.length) transferLines.push(`- ${says(a)}: ${matches.length} possible mates (${matches.map(([, b]) => b.id).join(", ")}); left for review`);
          else if (a.isNew) transferLines.push(`- ${says(a)}: no mate in this run or the sheet; left unpaired (its mate may come with the next file)`);
        });
      }

      // ---- loan statements
      const loanReadings = readings.filter((rd) => rd.kind === "loan");
      const ld = P.dedupe(loanReadings.map((rd) => [rd, rd.rows.filter(inWindow)]), existing, bankKey);
      skipped = skipped.concat(ld.skipped); repeated = repeated.concat(ld.repeated);
      let quietLoans = 0;
      loanReadings.forEach((rd, i) => {
        const inside = rd.rows.filter(inWindow);
        if (inside.length || rd.bom) loanLines.push(`- ${rd.path}: ${inside.length} lines in ${label}, ${ld.kept[i]} new${rd.bom ? "; UTF-8 byte order mark accepted" : ""}`);
        else quietLoans += 1;
      });
      if (quietLoans) loanLines.push(`- ${quietLoans} other loan file${plural(quietLoans)} hold no lines in ${label}`);
      const usedMates = new Set(); // Python hands one bank row to every equal same-day repayment; see the parity allowlist
      for (const [rd, r] of ld.taken) {
        const loan = sheet.accounts.get(rd.account);
        const contract = sheet.contracts.find((c) => lower(c.kind) === "loan" && c.account_id === rd.account);
        const category = (contract || {}).category_id || "MORTGAGE";
        const person = (contract || {}).owner || loan.owner || "Joint";
        const lender = loan.institution || "Lender";
        const line = { date: r.date, acct: rd.account, desc: r.description, merchant: lender, amount: r.amount, cat: category, person, receipt: "", note: "", transfer_id: "", transfer_account: "", source: "loan statement", file: rd.path, line: r.line, mate: null };
        if (r.amount < 0) { loanTx.push(line); continue; }
        const pool = rows.map((x) => ({ isNew: true, ref: x, date: x.date, acct: x.acct, amount: x.amount, cat: x.cat, desc: x.desc, id: x.id }))
          .concat(sheet.tx.map((t) => ({ isNew: false, ref: t, date: t.date, acct: t.account, amount: t.amount, cat: t.category, desc: t.raw, id: t.id })));
        const mates = pool.filter((m) => m.amount === -r.amount && m.acct !== rd.account && !usedMates.has(m.id) && T.daysApart(m.date, r.date) <= TRANSFER_DAYS
          && (m.cat === category || /LOAN|REPAY|MORTGAGE/.test(m.desc.toUpperCase())));
        mates.sort(by((m) => (m.cat !== category ? 1 : 0), (m) => T.daysApart(m.date, r.date)));
        const mate = mates[0] || null;
        if (mate) usedMates.add(mate.id);
        loanTx.push({ ...line, cat: "TRANSFER", note: mate ? "" : "No bank row matches this repayment; pair by hand", transfer_account: mate ? mate.acct : "", mate });
        if (!mate) loanLines.push(`- ${rd.path} row ${r.line}: repayment ${plus2(r.amount)} on ${r.date} has no matching bank row within ${TRANSFER_DAYS} days; left unpaired`);
      }
      loanTx.sort(by((r) => r.date, (r) => r.acct, (r) => -r.amount));
      const loanVals = [];
      for (const rd of loanReadings) {
        for (const m of months) {
          const inM = rd.rows.filter((r) => r.date.slice(0, 7) === m);
          if (!inM.length) continue;
          const last = A.SHAPES[rd.shape].sequence === "oldest-first" ? inM[inM.length - 1] : inM[0];
          loanVals.push({ month_end: T.monthEnd(m), acct: rd.account, value: T.toCents(last.balance), source: "statement", raw: "Loan statement", desc: `Closing balance from ${sheet.accounts.get(rd.account).institution || "lender"} statement`, from: rd.path });
        }
      }

      // ---- valuations: the month's valuations.csv, then the loan statements' closing balances
      const existingV = new Map();
      for (const v of sheet.valuations || []) existingV.set(key(v.account, v.month_end), v.value);
      const valuationInputs = sheet.valuations === null ? [] : ofKind("valuations");
      if (sheet.valuations === null) for (const v of ofKind("valuations")) valLines.push(`- ${v.path}: not read. This 1.1 snapshot carries no Valuations tab, so its rows can be neither de-duplicated nor planned; append them by hand (Month end, Item ID, Value)`);
      const wanted = [];
      for (const vf of valuationInputs) {
        table(vf).rows.forEach((r, i) => {
          const line = i + 2, acct = T.strip("Item ID" in r ? T.str(r["Item ID"]) : ""), me = T.strip("Month end" in r ? T.str(r["Month end"]) : "");
          if (sheet.valuationItems.size && !sheet.valuationItems.has(acct)) throw new Stop([new ImportFault("unknown_valuation_item", vf.path, `${repr(acct)} is not on the Accounts tab${sheet.version === 2 ? "" : " (nor Assets or Loans)"}`, "valuations are per account id; fix the Item ID or add the account first", line)]);
          if (!T.isIsoDate(me)) throw new Stop([new ImportFault("bad_month_end", vf.path, `Month end ${repr(me)} is not yyyy-mm-dd`, "write the month end as yyyy-mm-dd", line)]);
          if (firstDay <= me && me <= lastDay) {
            const method = lower((sheet.accounts.get(acct) || {}).valuation_method || "statement");
            let value;
            try { value = typedCents("Value" in r ? r.Value : null, "Value", vf.path, line); } catch (e) { throw new Stop([e]); }
            wanted.push({ month_end: me, acct, value, source: method !== "ledger" ? method : "statement", raw: "", desc: "", from: vf.shown || vf.path });
          }
        });
      }
      const proposed = new Map();
      for (const v of wanted.concat(loanVals)) {
        const k = key(v.acct, v.month_end), value = fmt2(v.value);
        if (existingV.has(k)) {
          if (Math.abs(existingV.get(k) - v.value) >= 1) hold("valuation_conflict", v.from, `- ${v.from}: ${v.acct} at ${v.month_end} is ${value}, the sheet already holds ${fmt2(existingV.get(k))}; which is right?`);
          else valLines.push(`- ${v.acct} ${v.month_end} ${value}: already in the sheet (${v.from})`);
        } else if (proposed.has(k)) {
          const p = proposed.get(k);
          if (Math.abs(p.value - v.value) >= 1) hold("valuation_conflict", v.from, `- ${v.from} says ${v.acct} at ${v.month_end} is ${value}; ${p.from} says ${fmt2(p.value)}; which is right?`);
          else valLines.push(`- ${v.acct} ${v.month_end} ${value}: ${v.from} agrees with ${p.from}`);
        } else { proposed.set(k, v); valLines.push(`- ${v.acct} ${v.month_end} ${value}: new (${v.from})`); }
      }
      valuations = Array.from(proposed.values()).sort(by((v) => v.month_end, (v) => v.acct));

      // ---- payslips: the payroll export and the month's payslips.csv, one per pay date, person and employer
      const existingP = new Map();
      for (const p of sheet.payslips) existingP.set(key(p.pay_date, p.person, p.employer), p);
      const seenP = new Map();
      const payFiles = readings.filter((rd) => rd.kind === "payslips").map((rd) => [rd.path, rd.rows.filter(inWindow).map((r) => ({ ...r }))]);
      for (const pf of ofKind("payslips")) {
        const t = table(pf), prow = [];
        needColumns(t, PAYSLIP_COLS, pf.path);
        t.rows.forEach((r, i) => {
          const line = i + 2;
          let d0;
          try {
            d0 = A.parseDate(r["Pay date"], "ymd", pf.path, line);
            if (firstDay <= d0 && d0 <= lastDay) {
              const [gross, tax, sup, net] = PAYSLIP_COLS.slice(3).map((c) => typedCents(r[c], c, pf.path, line));
              prow.push({ date: d0, person: T.strip(T.str(r.Person)), employer: T.strip(T.str(r.Employer)), gross, tax, super: sup, net });
            }
          } catch (e) { if (e instanceof ImportFault) throw new Stop([e]); throw e; }
        });
        payFiles.push([pf.shown || pf.path, prow]);
      }
      let quietPay = 0;
      const tuple = (v) => `(${v.map((c) => T.floatRepr(money(c))).join(", ")})`;
      for (const [path, prows] of payFiles) {
        if (!prows.length) { quietPay += 1; continue; }
        let newN = 0;
        for (const r of prows) {
          const k = key(r.date, r.person, r.employer), vals = [r.gross, r.tax, r.super, r.net];
          const who = `payslip ${r.person} ${r.employer} ${r.date}`;
          if (existingP.has(k)) {
            const e = existingP.get(k), sheetVals = [e.gross_pay, e.tax_withheld, e.super, e.net_pay];
            if (vals.some((c, i) => Math.abs(c - T.sheetCents(sheetVals[i])) >= 1)) hold("payslip_conflict", path, `- ${path}: ${who} reads ${tuple(vals)}, the sheet holds (${sheetVals.map(T.str).join(", ")}); which is right?`);
            continue;
          }
          if (seenP.has(k)) {
            const prior = seenP.get(k);
            if (prior.some((c, i) => c !== vals[i])) hold("payslip_conflict", path, `- ${path}: ${who} reads ${tuple(vals)}, another file in this run reads ${tuple(prior)}; which is right?`);
            continue;
          }
          seenP.set(k, vals);
          payslips.push([r.date, r.person, r.employer, r.gross, r.tax, r.super, r.net]);
          newN += 1;
        }
        payLines.push(`- ${path}: ${prows.length} payslips in ${label}, ${newN} new`);
      }
      if (quietPay) payLines.push(`- ${quietPay} other payslip file${plural(quietPay)} hold no pay dates in ${label}`);
      payslips.sort(by((p) => p[0], (p) => p[1]));

      // ---- owner statements: every line must match a bank row on the property's account
      let quietOwner = 0;
      for (const rd of readings.filter((x) => x.kind === "owner")) {
        const prop = rd.account;
        if (!rd.rows.some(inWindow) && !rd.bom) { quietOwner += 1; continue; }
        const bankAccts = Array.from(sheet.accounts).filter(([k, a]) => a.linked_account === prop && lower(a.type || "") !== "loan" && A.BANK_SHAPES.includes(sheet.institution(k))).map(([k]) => k);
        if (!bankAccts.length) throw new Stop([new ImportFault("unlinked_property", rd.path, `no bank account on the Accounts tab is linked to ${prop}`, `set linked_account = ${prop} on the rental account's row so the statement knows which bank rows to reconcile against`)]);
        const pool = new Map(), lineKey = (date, amount, desc) => key(date, amount, ident(desc));
        for (const t of sheet.tx) if (bankAccts.includes(t.account)) inc(pool, lineKey(t.date, t.amount, t.raw));
        for (const r of rows) if (bankAccts.includes(r.acct)) inc(pool, lineKey(r.date, r.amount, r.desc));
        const linesIn = rd.rows.filter(inWindow), seenLines = new Map(), unmatched = [];
        let matched = 0;
        for (const r of linesIn) {
          const k = lineKey(r.date, r.amount, r.description);
          inc(seenLines, k);
          if (seenLines.get(k) <= (pool.get(k) || 0)) matched += 1; else unmatched.push(r);
        }
        const accts = bankAccts.join("/");
        ownerLines.push(`- ${rd.path}: ${linesIn.length} lines in ${label}, ${matched} match bank rows on ${accts}${unmatched.length ? `, ${unmatched.length} do not` : ""}${rd.bom ? "; UTF-8 byte order mark accepted" : ""}`);
        for (const r of unmatched) hold("owner_unmatched", rd.path, `- ${rd.path} row ${r.line}: ${r.date} ${r.description} ${plus2(r.amount)} (${r.schedule_line}, handled by ${r.handled_by}) has no bank row on ${accts}. If the agent nets costs out of the rent, this household needs the clearing-account path (adapters.py); otherwise the bank export has a gap`);
        if (linesIn.length) {
          const stmt = new Set(linesIn.map((r) => lineKey(r.date, r.amount, r.description)));
          const extra = sheet.tx.filter((t) => bankAccts.includes(t.account) && firstDay <= t.date && t.date <= lastDay && String(t.category).startsWith("RENT-") && !stmt.has(lineKey(t.date, t.amount, t.raw))).length
            + rows.filter((r) => bankAccts.includes(r.acct) && String(r.cat).startsWith("RENT-") && !stmt.has(lineKey(r.date, r.amount, r.desc))).length;
          if (extra) ownerLines.push(`  ${extra} property rows on the bank account are not on the statement (owner-paid costs; fine)`);
        }
      }
      if (quietOwner) ownerLines.push(`- ${quietOwner} other owner statement${plural(quietOwner)} hold no lines in ${label}`);

      // ---- insurance documents
      const policyDocs = readings.filter((rd) => rd.kind === "policy"), latest = new Map();
      for (const rd of policyDocs) {
        if (rd.rows[0].doc !== "renewal") continue;
        const cur = latest.get(rd.account);
        if (!cur || rd.rows[0].period_from > cur.rows[0].period_from) latest.set(rd.account, rd);
      }
      for (const rd of policyDocs) {
        const doc = rd.rows[0], prop = rd.account.slice(4), renewal = doc.doc === "renewal";
        if (renewal && latest.get(rd.account) !== rd) { policyLines.push(`- ${rd.path}: renewal for ${doc.period_from} to ${doc.period_to}, premium ${fmt2(doc.premium)}; superseded by ${latest.get(rd.account).path}, kept as history`); continue; }
        const contract = sheet.contracts.find((c) => lower(c.kind) === "insurance" && c.account_id === prop);
        const desc = `${doc.policy || "policy"} ${doc.policy_number}, ${doc.period_from} to ${doc.period_to}, premium ${fmt2(doc.premium)}`;
        if (!contract) { policyLines.push(`- ${rd.path}: ${renewal ? "renewal" : "certificate of currency"}, ${desc}; no insurance row for ${prop} on the Contracts tab, add one (kind insurance, account_id ${prop})`); continue; }
        const diffs = [], amount = T.sheetCents(contract.amount), id = contract.contract_id;
        if (Math.abs(amount - doc.premium) >= 1) diffs.push(`premium ${fmt2(amount)} -> ${fmt2(doc.premium)}`);
        if ((contract.start_date || "") !== doc.period_from || (contract.end_date || "") !== doc.period_to) diffs.push(`period ${contract.start_date || "blank"}..${contract.end_date || "blank"} -> ${doc.period_from}..${doc.period_to}`);
        const nextDate = (doc.status || "").toLowerCase().startsWith("paid") || !doc.due ? T.addDays(doc.period_to, 1) : doc.due;
        if (renewal && (contract.next_date || "") !== nextDate) diffs.push(`next date ${contract.next_date || "blank"} -> ${nextDate}`);
        const cover = doc.cover.map(([k, v]) => `${k} ${v}`).join("; "), said = diffs.join("; ");
        if (renewal && diffs.length) {
          contractUpdates.push(W.updateWrite(`contract-${id}-${doc.period_from}`, "Contracts", contract.row, 9, [money(doc.premium), null, doc.period_from, doc.period_to, nextDate],
            { range: W.a1("Contracts", contract.row, 1), expect: [[id]] }, `${id} ${T.str(contract.name)}: ${said} (from ${rd.path})`));
          policyLines.push(`- ${rd.path}: renewal, ${desc}; Contracts ${id} differs (${said}): update planned. Cover: ${cover}`);
        } else if (renewal) policyLines.push(`- ${rd.path}: renewal, ${desc}; agrees with Contracts ${id}. Cover: ${cover}`);
        else policyLines.push(`- ${rd.path}: certificate of currency, ${desc}; ${diffs.length ? `Contracts ${id} differs (${said}); a certificate confirms, it does not change the row: check the renewal notice` : `agrees with Contracts ${id}`}`);
      }

      // ---- closing balances
      const c = closingChecks(sheet, rows, readings, months);
      balanceLines = c.lines; closing = c.checks;
      held = held || c.held;
      holds.push(...c.holds);
    } catch (s) {
      if (s instanceof ImportFault) s = new Stop([s]);
      if (!(s instanceof Stop)) throw s;
      stopLines = s.faults.map((f) => f.md());
      faultsOut = s.faults.map((f) => f.json());
      rows = []; loanTx = []; valuations = []; payslips = []; pairUpdates = []; contractUpdates = [];
      fileLines = []; loanLines = []; valLines = []; payLines = []; ownerLines = []; policyLines = []; balanceLines = []; transferLines = [];
      skipped = []; repeated = []; outsideWindow = []; closing = []; pairs.length = 0; holds.length = 0;
      held = false;
    }

    // ---- IDs for the rest, then the plan
    const stopped = stopLines.length > 0;
    let nextT = sheet.lastT + rows.length;
    let lastV = sheet.lastV;
    for (const v of valuations) { v.id = nextId("V", lastV); lastV += 1; }
    for (const r of loanTx) { nextT += 1; r.id = `T${String(nextT).padStart(4, "0")}`; }
    const entryRow = (r) => [r.id, "transaction", r.date, r.acct, r.desc, r.merchant, money(r.amount), r.cat, r.person, r.receipt, r.note, "settled", r.date, r.transfer_id, r.transfer_account, "", "", "", "", r.source];
    const valRow = (v) => [v.id, "valuation", v.month_end, v.acct, v.raw, v.desc, money(v.value), "", "", "", "", "settled", v.month_end, "", "", "", "", "", "", v.source];
    const firstEntryRow = sheet.rows + 2, ledger = sheet.version === 2;
    const rowOf = new Map();
    const mainOf = () => rows.map(entryRow).concat(ledger ? valuations.map(valRow) : []);
    let mainRows = mainOf();
    rows.forEach((r, i) => rowOf.set(r.id, firstEntryRow + i));
    const loanRowsStart = firstEntryRow + mainRows.length;
    let loanEntryRows = [], pairsToWrite = loanPairs;
    for (const r of loanTx) {
      if (r.mate) {
        nextX += 1;
        const xid = `X${String(nextX).padStart(4, "0")}`, mate = r.mate;
        r.transfer_id = xid;
        if (mate.isNew && loansNow) { mate.ref.transfer_id = xid; mate.ref.transfer_account = r.acct; mate.ref.cat = "TRANSFER"; }
        else {
          const mrow = mate.isNew ? rowOf.get(mate.id) : mate.ref.row;
          loanPairs.push(W.updateWrite(`loan-pair-${mate.id}`, "Entries", mrow, 8, ["TRANSFER", null, null, null, null, null, xid, r.acct], { range: W.a1("Entries", mrow, 1), expect: [[mate.id]] },
            `${mate.id} (${mate.date} ${mate.acct} ${plus2(mate.amount)}) becomes the transfer that repaid ${r.acct}, category TRANSFER`));
        }
        loanLines.push(`- ${xid}: ${r.id} ${r.date} ${r.acct} ${plus2(r.amount)} repayment received, mate ${mate.id} ${mate.date} ${mate.acct} ${plus2(mate.amount)}`);
        loanPairsOut.push({ transfer_id: xid, loan_row_id: r.id, mate: { id: mate.id, date: mate.date, account: mate.acct, amount_cents: mate.amount, new: mate.isNew }, deferred: !loansNow });
      }
      loanEntryRows.push(entryRow(r));
    }
    mainRows = mainOf(); // mates may have changed
    if (loansNow) { mainRows = mainRows.concat(loanEntryRows); loanEntryRows = []; }

    const plan = { schema: W.SCHEMA, generated_at: opts.generated_at === undefined ? null : opts.generated_at, importer: "src/core/period-plan.js", months, status: stopped ? "stopped" : held ? "hold" : "ready",
      sheet: { id: sheet.id, version: sheet.version, snapshot: sheet.path, snapshot_fetched_at: sheet.fetched }, assumes: {}, preconditions: [], writes: [], deferred: [],
      verify: "read every range under writes with get_values (and the preconditions before writing), save the responses as JSON, then: python3 period-close/verify.py write-plan.json reread.json" };
    const pad4 = (n) => String(n).padStart(4, "0");
    if (ledger) {
      plan.assumes = { entries_rows: sheet.rows, last_entry_row: sheet.rows + 1, last_entry_id: sheet.lastEntryId, last_ids: { T: `T${pad4(sheet.lastT)}`, V: `V${pad4(lastV - valuations.length)}`, X: `X${pad4(sheet.lastX)}` }, payslips_rows: sheet.payslips.length };
      if (mainRows.length) {
        plan.preconditions.push(W.precondition("Entries", sheet.rows ? sheet.rows + 1 : null, sheet.lastEntryId));
        const note = `${rows.length} transactions${valuations.length ? `, ${valuations.length} valuations` : ""}${loansNow && loanTx.length ? `, ${loanTx.length} loan statement lines` : ""}`;
        plan.writes.push(...W.appendWrites("entries", "Entries", ENTRY_COLS, mainRows, firstEntryRow, note));
      }
      plan.writes.push(...pairUpdates);
      if (loansNow) plan.writes.push(...loanPairs);
      plan.writes.push(...contractUpdates);
    } else {
      plan.assumes = { transactions_rows: sheet.rows, last_transaction_row: sheet.rows + 1, last_txn_id: sheet.lastEntryId, last_ids: { T: `T${pad4(sheet.lastT)}` }, payslips_rows: sheet.payslips.length, valuations_rows: sheet.valuations === null ? null : sheet.valuations.length };
      const txnRows = rows.map((r) => [r.id, r.date, r.acct, r.desc, r.merchant, money(r.amount), r.cat, r.person, r.receipt, r.note]);
      if (txnRows.length) {
        plan.preconditions.push(W.precondition("Transactions", sheet.rows ? sheet.rows + 1 : null, sheet.lastEntryId));
        plan.writes.push(...W.appendWrites("transactions", "Transactions", TXN_COLS, txnRows, sheet.rows + 2));
      }
      if (valuations.length) {
        const vs = sheet.valuations;
        plan.preconditions.push(W.precondition("Valuations", vs.length ? vs.length + 1 : null, vs.length ? vs[vs.length - 1].month_end : null));
        plan.writes.push(...W.appendWrites("valuations", "Valuations", VALUATION_COLS, valuations.map((v) => [v.month_end, v.acct, money(v.value)]), vs.length + 2));
      }
      if (loanTx.length || loanPairs.length) {
        planNotes.push("Loan statement lines are planned only for a ledger sheet (sheet_version 2); this is a 1.1 sheet, so they are listed above and not written.");
        loanEntryRows = []; pairsToWrite = [];
      }
    }
    const payslipRows = payslips.map((p) => p.slice(0, 3).concat(p.slice(3).map(money)));
    if (payslips.length) {
      const ps = sheet.payslips;
      plan.preconditions.push(W.precondition("Payslips", ps.length ? ps.length + 1 : null, ps.length ? ps[ps.length - 1].pay_date : null));
      plan.writes.push(...W.appendWrites("payslips", "Payslips", PAYSLIP_COLS, payslipRows, ps.length + 2));
    }
    if (loanEntryRows.length && ledger) {
      const why = "Phase D decides: pairing the repayment takes it out of spending (the Cash Flow figures the oracle pins) and makes the interest charged the expense; "
        + "the loans must become ledger accounts (valuation_method ledger) in the same change. Re-run with --loans now once decided; "
        + `rows and IDs here assume the writes above landed first (first row ${loanRowsStart}).`;
      for (const w of W.appendWrites("loan-entries", "Entries", ENTRY_COLS, loanEntryRows, loanRowsStart, `${loanTx.length} loan statement lines`)) { w.why = why; plan.deferred.push(w); }
      for (const w of pairsToWrite) { w.why = "the bank row that paid the loan becomes a transfer; see the loan entries above"; plan.deferred.push(w); }
    }
    for (const w of plan.writes.concat(plan.deferred)) if (w.precondition) plan.preconditions.push(w.precondition);
    if (held || stopped) {
      plan[held ? "held_writes" : "not_planned"] = plan.writes.concat(plan.deferred);
      plan.writes = []; plan.deferred = [];
    }
    const rowsPayload = rows.map((r) => [r.id, r.date, r.acct, r.desc, r.merchant, money(r.amount), r.cat, r.person, r.receipt, r.note]);
    const totals = { transactions: rows.length, already_in_sheet: skipped.length, repeated_across_files: repeated.length, valuations: valuations.length, payslips: payslips.length, loan_lines: loanTx.length,
      pair_updates: pairUpdates.length, contract_updates: contractUpdates.length, writes: plan.writes.length, deferred: plan.deferred.length, rows_written: plan.writes.reduce((s, w) => s + w.rows, 0), seconds: 0 };
    plan.totals = totals;

    // ---- review.md
    const body = [`# ${label} import review`, ""];
    if (stopped) body.push(`**STOPPED: nothing was planned.** ${stopLines.length} file problem${plural(stopLines.length)} need${stopLines.length === 1 ? "s" : ""} a person before this run can go on.`, "", ...stopLines, "");
    else if (held) body.push("**HOLD: do not append.** The ledger and a source disagree, so the rows wait in rows.held.json and entries.held.json, the plan's writes are under held_writes, and rows.json and entries.json are empty.", "", ...holdLines, "");
    body.push(`${rows.length} rows to append${rows.length ? `, T${pad4(sheet.lastT + 1)} to T${pad4(sheet.lastT + rows.length)}` : ""}; ${skipped.length} already in the sheet`
      + (repeated.length ? `; ${repeated.length} repeated across overlapping files` : "") + (valuations.length ? `; ${valuations.length} valuations` : "") + (payslips.length ? `; ${payslips.length} payslips` : "")
      + (loanTx.length ? `; ${loanTx.length} loan statement lines` : "") + (contractUpdates.length ? `; ${contractUpdates.length} contract update${plural(contractUpdates.length)}` : "") + `. ${T.floatRepr(totals.seconds)} s.`, "");
    const named = ([rd, r]) => `- ${rd.path}: ${r.date} ${r.description} ${plus2(r.amount)}`;
    const capped = (list) => list.slice(0, 40).map(named).concat(list.length > 40 ? [`- … and ${list.length - 40} more`] : []);
    if (!stopped) {
      body.push("## Files", ...(fileLines.length ? fileLines : ["- no bank files in this window"]), "");
      body.push("## Closing balances", ...(balanceLines.length ? balanceLines : ["- No file printed a balance for this window."]), "");
      if (transferLines.length) body.push("## Transfers", ...transferLines, "");
      if (loanLines.length) body.push("## Loan statements", ...loanLines, "");
      if (valLines.length) body.push("## Valuations", ...valLines, "");
      if (payLines.length) body.push("## Payslips", ...payLines, "");
      if (ownerLines.length) body.push("## Owner statements", ...ownerLines, "");
      if (policyLines.length) body.push("## Insurance", ...policyLines, "");
      body.push("## Review", ...(review.length ? review : ["Nothing to review."]), "");
      if (skipped.length) body.push("## Already in the sheet (not appended)", ...capped(skipped), "");
      if (repeated.length) body.push("## Repeated across overlapping files (taken once)", ...capped(repeated), "");
      body.push("## Write plan", ...planNotes, ...W.summary(plan), "",
        "Three steps, never a fourth: (1) this plan; (2) the agent reads each precondition range, then writes each range under `writes` with the Sheets connector `update_values`, in order, by explicit range, never `append_values`; (3) the agent re-reads every range it wrote, saves the responses, and runs `python3 period-close/verify.py write-plan.json reread.json`. Then the snapshot is refreshed and this month is closed.");
    }
    const reviewMd = body.join("\n").replace(/\s+$/, "") + "\n";

    const rowOut = (r) => ({ id: r.id, date: r.date, account: r.acct, raw_text: r.desc, merchant: r.merchant, amount_cents: r.amount, amount: money(r.amount), category_id: r.cat, person: r.person,
      receipt_held: r.receipt, note: r.note, transfer_id: r.transfer_id, transfer_account: r.transfer_account, source: r.source, file: r.file, line: r.line, identity: [r.date, r.acct, r.amount, ident(r.desc)] });
    const named2 = ([rd, r]) => ({ file: rd.path, line: r.line, date: r.date, description: r.description, amount_cents: r.amount });
    return {
      status: plan.status, exit: stopped ? 1 : held ? 2 : 0, plan,
      proposed: { transactions: rows.map(rowOut), loan_lines: loanTx.map(rowOut),
        valuations: valuations.map((v) => ({ id: v.id, month_end: v.month_end, account: v.acct, value_cents: v.value, value: money(v.value), source: v.source, raw: v.raw, description: v.desc, from: v.from })),
        payslips: payslipRows, transfers: pairs, loan_pairs: loanPairsOut, contract_updates: contractUpdates },
      outcomes: { taken: rows.length, already_in_sheet: skipped.map(named2), repeated_across_files: repeated.map(named2), outside_window: outsideWindow },
      faults: faultsOut, holds, review: stopped ? [] : review,
      checks: { closing, transfers: transferLines, loans: loanLines, valuations: valLines, payslips: payLines, owners: ownerLines, policies: policyLines, files: fileLines },
      review_md: reviewMd, rows_payload: rowsPayload, entries_payload: mainRows,
    };
  };
  return P;
});
