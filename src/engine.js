/* The Kitty engine: every number on the page comes through here.
   Pure functions, no DOM. Runs in the page (window.Engine) and in node tests (module.exports).
   Input is either the Apps Script snapshot (typed values) or Google Sheets connector grids
   (display strings), normalised to one shape by fromConnector(); model() parses both alike. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(); else root.Engine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const E = {};

  // ---------- parsing: tolerant of "$4,530.47", "($2,850.00)", "85.0%", "(0.8%)", "-", 46356, "30/11/2026" ----------
  E.num = (v) => {
    if (v == null || v === "") return null;
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    if (typeof v === "boolean") return v ? 1 : 0;
    let s = String(v).trim();
    if (!s || s === "-" || s === "–" || s === "—" || /^n\/?a$/i.test(s) || /^never/i.test(s) || /^not /i.test(s)) return null;
    let neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    s = s.replace(/[,\s$A-Za-z%]/g, "");
    if (s.startsWith("-") || s.startsWith("−")) { neg = !neg; s = s.slice(1); }
    if (!/^\d*\.?\d+$/.test(s) && !/^\d+\.?\d*$/.test(s)) return null;
    const n = parseFloat(s);
    return Number.isFinite(n) ? (neg ? -n : n) : null;
  };
  E.pct = (v) => {
    if (typeof v === "number") return v;
    const n = E.num(v);
    if (n == null) return null;
    return /%/.test(String(v)) ? n / 100 : n;
  };
  const pad2 = (n) => String(n).padStart(2, "0");
  const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  E.date = (v) => {
    if (v == null || v === "") return null;
    if (typeof v === "number") { const d = new Date(Math.round((v - 25569) * 86400000)); return isNaN(d) ? null : d.toISOString().slice(0, 10); }
    const s = String(v).trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (m) { const mdy = E.dateOrder === "mdy" && +m[1] <= 12; const dd = mdy ? m[2] : m[1], mm = mdy ? m[1] : m[2]; return `${m[3].length === 2 ? "20" + m[3] : m[3]}-${pad2(mm)}-${pad2(dd)}`; }
    m = s.match(/^(\d{1,2}) ([A-Za-z]{3})[a-z]* (\d{4})$/);
    if (m && MON[m[2].toLowerCase()]) return `${m[3]}-${pad2(MON[m[2].toLowerCase()])}-${pad2(m[1])}`;
    m = s.match(/^([A-Za-z]{3})[a-z]* (\d{2,4})$/);
    if (m && MON[m[1].toLowerCase()]) return `${m[2].length === 2 ? "20" + m[2] : m[2]}-${pad2(MON[m[1].toLowerCase()])}-01`;
    return null;
  };
  E.dateOrder = "dmy";   // set from the Kitty tab's country before a model is built; US and some others show month first
  E.auditDay = (instant, zone) => {
    const parts = new Intl.DateTimeFormat("en-CA", {timeZone: zone || undefined, calendar:"gregory",
      year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(instant);
    const p = Object.fromEntries(parts.map(x => [x.type,x.value])); return p.year + "-" + p.month + "-" + p.day;
  };
  E.month = (v) => { const d = E.date(v); return d ? d.slice(0, 7) + "-01" : null; };
  E.key = (h) => String(h == null ? "" : h).toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

  // ---------- dates (all 'YYYY-MM-DD', computed in UTC so no timezone drift) ----------
  const toD = (s) => new Date(s + "T00:00:00Z");
  const iso = (d) => d.toISOString().slice(0, 10);
  E.addDays = (s, n) => { const d = toD(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
  E.addMonths = (s, n) => { const d = toD(s); const day = d.getUTCDate(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n); const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); d.setUTCDate(Math.min(day, last)); return iso(d); };
  E.daysBetween = (a, b) => Math.round((toD(b) - toD(a)) / 86400000);
  E.monthStart = (s) => s.slice(0, 7) + "-01";
  E.monthEnd = (s) => { const d = toD(s); return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))); };
  E.monthsBetween = (a, b) => { const A = toD(a), B = toD(b); return (B.getUTCFullYear() - A.getUTCFullYear()) * 12 + (B.getUTCMonth() - A.getUTCMonth()); };
  E.fyOf = (s, startMonth = 7) => { const d = toD(s); return d.getUTCFullYear() + (d.getUTCMonth() + 1 >= startMonth ? 1 : 0); };

  // ---------- formatting ----------
  E.currency = "AUD"; E.locale = "en-AU";
  E.fmt = (n, o = {}) => {
    if (n == null || !Number.isFinite(n)) return "—";
    const abs = Math.abs(n), sign = n < 0 ? "−" : o.plus && n > 0 ? "+" : "";
    if (o.short && abs >= 10000) {
      const v = abs >= 1e6 ? abs / 1e6 : abs / 1e3, suf = abs >= 1e6 ? "m" : "k";
      const digits = v >= 100 ? 0 : v >= 10 ? 1 : 1;
      return sign + E.sym() + v.toFixed(digits).replace(/\.0$/, "") + suf;
    }
    const cents = o.cents != null ? o.cents : abs < 1000 && !o.whole;
    return sign + new Intl.NumberFormat(E.locale, { style: "currency", currency: E.currency, minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 }).format(abs).replace(/^[A-Z]{1,3}\s?/, (m) => (/[A-Z]{2,}/.test(m) ? "" : m));
  };
  E.sym = () => { const p = new Intl.NumberFormat(E.locale, { style: "currency", currency: E.currency }).formatToParts(1).find((x) => x.type === "currency"); return p ? p.value.replace(/^[A-Z]{1,3}(?=\W|$)/, (m) => (m.length >= 2 ? "" : m)) || "$" : "$"; };
  E.fmt0 = (n) => E.fmt(n, { cents: false });
  E.fmtS = (n) => E.fmt(n, { short: true, cents: false });
  E.fmtPct = (p, d = 0) => (p == null ? "—" : `${(p * 100).toFixed(d)}%`);
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  E.fmtMonth = (s, short) => { if (!s) return ""; const d = toD(E.date(s)); const m = MONTHS[d.getUTCMonth()]; return `${short ? m.slice(0, 3) : m} ${short ? String(d.getUTCFullYear()).slice(2) : d.getUTCFullYear()}`; };
  E.fmtDay = (s, o = {}) => { if (!s) return ""; const d = toD(s); const day = d.getUTCDate(), m = MONTHS[d.getUTCMonth()].slice(0, 3); return o.year ? `${day} ${m} ${d.getUTCFullYear()}` : `${day} ${m}`; };
  E.weekday = (s) => ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][toD(s).getUTCDay()];
  E.rel = (from, to) => { const n = E.daysBetween(from, to); if (n === 0) return "today"; if (n === 1) return "tomorrow"; if (n === -1) return "yesterday"; if (n > 0 && n < 14) return `in ${n} days`; if (n < 0 && n > -14) return `${-n} days ago`; if (n > 0 && n < 60) return `in ${Math.round(n / 7)} weeks`; if (n < 0 && n > -60) return `${Math.round(-n / 7)} weeks ago`; const m = Math.round(n / 30.4); return n > 0 ? `in ${m} months` : `${-m} months ago`; };
  E.dayLabel = (s, today) => { const n = E.daysBetween(s, today); if (n === 0) return "Today"; if (n === 1) return "Yesterday"; if (n < 7) return E.weekday(s); return E.fmtDay(s, { year: s.slice(0, 4) !== today.slice(0, 4) }); };
  E.words = (n) => ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"][n] || String(n);
  E.cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");

  // ---------- connector grids → the snapshot shape ----------
  // Each tab's table starts at the first row whose first cell is the known header word.
  const HEAD = { metrics: "Metric ID", compliance: "Check", networth: "Month end", savings: "Opportunity", budget: "Category", settings: "Setting", kitty: "Key", accounts: "Account ID", category_list: "Category ID", goals: "Goal", subscriptions: "Service", loans: "Loan ID", assets: "Item ID", transactions: "Txn ID", payslips: "Pay date",
    entries: "Entry ID", balances: "Month end", contracts: "Contract ID", decisions: "Decision ID", rules: "Rule ID" };
  const blank = (r) => !r || r.every((v) => v == null || v === "");
  // Sheets omits trailing empty rows from each values response. Place each page at its
  // requested address: Entries row numbers are also the addresses used for category writes.
  E.joinGridPages = (pages) => {
    const grid = []; let next = 1;
    for (const { first, last, rows } of pages) {
      if (first !== next || !Number.isSafeInteger(last) || last < first || !Array.isArray(rows) ||
          rows.length > last - first + 1 || rows.some(r => !Array.isArray(r))) {
        throw new Error("Sheets returned an invalid row range.");
      }
      rows.forEach((r, i) => { if (!blank(r)) grid[first - 1 + i] = r; });
      next = last + 1;
    }
    return grid;
  };
  const ledgerTables = new Set(["entries", "balances", "contracts", "decisions", "rules", "transactions"]);
  const requiredRowKeys = new Set(["entries", "decisions", "rules"]);
  const invalidLedger = message => { const e = new Error(message); e.code = "invalid_ledger"; throw e; };
  // A live v2 dashboard cannot substitute a missing ledger with an empty table or
  // address column H as "Category" when someone has moved it. Header-only ledgers are valid.
  E.checkLiveLedger = (g, requireV2) => {
    const kitty = g.kitty || [];
    const versions = kitty.filter(r => r && r[0] === "sheet_version");
    if (!requireV2 && !g.entries?.length && versions.every(r => ["1", "1.1"].includes(String(r[1])))) return;
    if (!kitty.some(r => r?.[0] === "Key" && r[1] === "Value") ||
        versions.length !== 1 || !["2", "3"].includes(String(versions[0][1]))) invalidLedger("The Kitty tab needs one sheet_version 2 or 3 setting.");   // 3 adds tabs and changes none
    for (const [k, name] of Object.entries({ accounts: "Accounts", category_list: "Categories", entries: "Entries",
                                             balances: "Balances", contracts: "Contracts", decisions: "Decisions", rules: "Rules" })) {
      if (g[k]?.[0]?.[0] !== HEAD[k]) invalidLedger(`Check the ${name} tab and its ${HEAD[k]} header.`);
    }
    if (g.entries[0][7] !== "Category ID") invalidLedger("Entries column H must be Category ID.");
    const decisions = ["Decision ID", "Ref kind", "Ref ID", "Decision", "Value", "By", "At", "Note"];
    if (decisions.some((name, i) => g.decisions[0][i] !== name)) invalidLedger("The Decisions columns do not match the v2 Sheet.");
  };
  function gridTable(grid, head, opts = {}) {
    if (!Array.isArray(grid)) return [];
    const hi = grid.findIndex((r) => r && String(r[0]).trim() === head);
    if (hi < 0) return [];
    const keys = grid[hi].map(E.key);
    const out = [];
    const seen = opts.keyed ? new Set() : null;
    for (let i = hi + 1; i < grid.length; i++) {
      const r = grid[i];
      if (blank(r)) { if (opts.all) continue; break; }
      if (r[0] == null || String(r[0]).trim() === "") {
        if (opts.keyed) invalidLedger(`Missing ${head} on row ${i + 1}.`);
        if (opts.all) continue; break;
      }
      if (seen) {
        const key = String(r[0]).trim();
        if (seen.has(key)) invalidLedger(`Repeated ${head} on row ${i + 1}.`);
        seen.add(key);
      }
      const o = {}; keys.forEach((k, j) => { if (k) o[k] = r[j] == null || r[j] === "" ? null : r[j]; }); out.push(o);
    }
    return out;
  }
  function gridPairs(grid, title) {
    const i = Array.isArray(grid) ? grid.findIndex((r) => r && r[0] === title) : -1; const out = {};
    for (let k = i + 1; i >= 0 && k < grid.length && grid[k] && grid[k][0] !== "" && grid[k][0] != null; k++) out[grid[k][0]] = grid[k][1];
    return out;
  }
  function gridAfter(grid, title, head) { const i = grid.findIndex((r) => r && r[0] === title); return i < 0 ? [] : gridTable(grid.slice(i + 1), head); }
  E.fromConnector = (g) => {
    const s = {};
    for (const [k, head] of Object.entries(HEAD)) s[k] = gridTable(g[k], head, { all: k === "budget" || ledgerTables.has(k), keyed: requiredRowKeys.has(k) });
    s.budget = s.budget.filter((r) => r.category !== "Total");
    s.compliance = s.compliance.filter((r) => r.status);
    s.savings = s.savings.filter((r) => r.type === "Recurring" || r.type === "One-off");
    const mg = g.mortgage || [];
    s.mortgage_inputs = gridPairs(mg, "Loan inputs");
    s.mortgage = gridTable(mg, "Rate change").filter((r) => E.num(r.interest_rate) != null);
    s.mortgage_extra = gridAfter(mg, "Extra repayment scenarios", "Extra per month ($)");
    const tx = g.tax || []; const ti = tx.findIndex((r) => r && r[0] === "Person");
    s.tax = ti < 0 ? [] : tx.slice(ti + 1).filter((r) => r && r[0]).map((r) => ({ label: r[0], prior_j: r[1], prior_m: r[2], cur_j: r[3], cur_m: r[4], how: r[5] }));
    // Cash Flow is wide: months across the header row
    const cf = g.cashflow || []; const hi = cf.findIndex((r) => r && r[0] === "Month");
    s.cashflow = []; s.cashflow_categories = [];
    if (hi >= 0) {
      const hdr = cf[hi]; const cols = []; hdr.forEach((h, i) => { if (i > 0 && E.month(h)) cols.push(i); });
      const lines = { "Salary and interest": "salary_interest", "Rent received": "rent", "Total income": "income", Housing: "housing", Essentials: "essentials", Lifestyle: "lifestyle", Property: "property", "Work and giving": "work_giving", Fees: "fees", Uncategorised: "uncategorised", "Total spending": "spending", "Net cash flow": "net", "Savings rate": "savings_rate" };
      s.cashflow = cols.map((i) => ({ month: E.month(hdr[i]) }));
      const catStart = cf.findIndex((r, i) => i > hi && r && r[0] === "Spending by category");
      cf.slice(hi + 1, catStart < 0 ? cf.length : catStart).forEach((r) => { const k = lines[r && r[0]]; if (k) cols.forEach((i, j) => { s.cashflow[j][k] = k === "savings_rate" ? E.pct(r[i]) : E.num(r[i]) || 0; }); });
      if (catStart >= 0) s.cashflow_categories = cf.slice(catStart + 1).filter((r) => r && r[0]).map((r) => ({ category: r[0], months: cols.map((i) => E.num(r[i]) || 0) }));
    }
    s.household = s.settings.find((r) => r.setting === "Household")?.value || null;
    return s;
  };

  // ---------- the model: typed, cross-linked ----------
  const by = (f) => (a, b) => (f(a) < f(b) ? -1 : f(a) > f(b) ? 1 : 0);
  E.model = (snap) => {
    const kitty = {}; for (const r of snap.kitty || []) if (r.key) kitty[r.key] = r.value == null ? "" : String(r.value);
    E.dateOrder = ["US", "PH", "CA"].includes(String(kitty.country || "").toUpperCase()) && kitty.date_order !== "dmy" ? "mdy" : kitty.date_order === "mdy" ? "mdy" : "dmy";
    const settings = {}; for (const r of snap.settings || []) if (r.setting) settings[r.setting] = r.value;
    E.currency = kitty.currency || "AUD"; E.locale = { AU: "en-AU", NZ: "en-NZ", GB: "en-GB", US: "en-US", CA: "en-CA", SG: "en-SG", IE: "en-IE", EU: "de-DE" }[kitty.country] || "en-AU";
    const cats = (snap.category_list || []).map((c) => ({ id: c.category_id, name: c.category, group: c.group, flow: c.flow || "Expense", budget: E.num(c.monthly_budget), essential: c.essential === "Yes", tax: c.tax_treatment || "", ato: c.ato_label || "" }));
    const catById = Object.fromEntries(cats.map((c) => [c.id, c]));
    // Accounts: every store of value. 1.1 sheets carry A–I (cash accounts only); sheet_version 2 adds class, valuation method,
    // currency, status (active | beta | closed), purpose and a linked account, and lists property, loans, super, shares and things too.
    const accounts = (snap.accounts || []).map((a) => ({ id: a.account_id, name: a.account, bank: a.institution || "", type: a.type, owner: a.owner, opening: E.num(a.opening_balance), openingDate: E.date(a.opening_date), balance: E.num(a.balance_at_as_of_date), liquid: a.liquid === "Yes",
      cls: a.class || "Cash", method: String(a.valuation_method || "ledger").toLowerCase(), currency: a.currency || kitty.currency || "AUD", status: String(a.status || "active").toLowerCase(), purpose: a.purpose || "", linked: a.linked_account || "", note: a.note || "", entries: [] })).filter((a) => a.id);
    const acctById = Object.fromEntries(accounts.map((a) => [a.id, a]));
    const txRows = (snap.transactions && snap.transactions.length) ? snap.transactions
      : (snap.entries || []).filter((e) => String(e.kind || "transaction").toLowerCase() === "transaction").map((e) => ({ txn_id: e.entry_id, date: e.settled_at || e.date, account_id: e.account_id, bank_description: e.raw_text, merchant: e.description, amount: e.amount, category_id: e.category_id, person: e.person, receipt_held: e.receipt_held, note: e.note }));
    const tx = txRows.map((t) => {
      const c = catById[t.category_id] || { name: "Uncategorised", group: "Uncategorised", flow: "Expense" };
      return { id: t.txn_id, date: E.date(t.date), acct: t.account_id, desc: t.bank_description || "", merchant: t.merchant || t.bank_description || "", amount: E.num(t.amount) || 0, cat: t.category_id || "UNCAT", catName: c.name, group: c.group, flow: c.flow, person: t.person || "Joint", receipt: t.receipt_held || "", note: t.note || "", transferId: "" };
    }).filter((t) => t.date).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? 1 : -1));
    const txById = Object.fromEntries(tx.map((t) => [t.id, t]));
    // Entries: the ledger. A transaction (money moved), a trade (units at a price) or a valuation (a value observed on a date).
    // Up's vocabulary where it fits: raw_text, description, status, created_at, settled_at, transfer_account, foreign_amount.
    // A 1.1 sheet has no Entries tab, so its transactions stand in as entries of kind transaction.
    const entries = (snap.entries && snap.entries.length ? snap.entries.map((e) => ({ id: e.entry_id, kind: String(e.kind || "transaction").toLowerCase(), date: E.date(e.settled_at || e.date), acct: e.account_id, raw: e.raw_text || "", desc: e.description || e.raw_text || "", amount: E.num(e.amount) || 0, cat: e.category_id || "", person: e.person || "", receipt: e.receipt_held || "", note: e.note || "", status: String(e.status || "settled").toLowerCase(), created: E.date(e.created_at) || E.date(e.settled_at || e.date), transferId: e.transfer_id || "", transferAcct: e.transfer_account || "", foreign: E.num(e.foreign_amount), foreignCcy: e.foreign_currency || "", units: E.num(e.units), price: E.num(e.unit_price), source: e.source || "" }))
      : tx.map((t) => ({ id: t.id, kind: "transaction", date: t.date, acct: t.acct, raw: t.desc, desc: t.merchant, amount: t.amount, cat: t.cat, person: t.person, receipt: t.receipt, note: t.note, status: "settled", created: t.date, transferId: "", transferAcct: "", foreign: null, foreignCcy: "", units: null, price: null, source: "" })))
      .filter((e) => e.id && e.date).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));
    const decisions = (snap.decisions || []).map((d) => ({ id: d.decision_id, refKind: d.ref_kind || "", ref: d.ref_id || "", decision: d.decision || "", value: /refresh|date|until|by/.test(String(d.decision)) && E.date(d.value) ? E.date(d.value) : d.value == null ? "" : String(d.value), by: d.by || "", at: E.date(d.at), note: d.note || "" })).filter((d) => d.id);
    const rules = (snap.rules || []).map((r) => ({ id: r.rule_id, pattern: r.pattern || "", match: r.match || "normalised", merchant: r.merchant || "", cat: r.category_id || "", person: r.person || "", tax: r.tax_label || "", property: r.property || "", source: r.source || "", note: r.note || "" })).filter((r) => r.id && r.pattern);
    const entryById = Object.fromEntries(entries.map((e) => [e.id, e]));
    // Decisions overlay the model on read: a categorise lands in the Entries cell too, the rest live only here, so the page
    // agrees with the sheet the moment a Decisions row is written and never remembers a judgment the sheet does not have.
    for (const d of decisions) {
      if (d.refKind !== "entry") continue; const e = entryById[d.ref]; if (!e) continue;
      (e.decisions = e.decisions || []).push(d);
      if (d.decision === "categorise" && d.value && catById[d.value]) { e.cat = d.value; e.reviewed = true; const t = txById[e.id]; if (t) { const c = catById[d.value]; t.cat = d.value; t.catName = c.name; t.group = c.group; t.flow = c.flow; } }
      else if (d.decision === "confirm") e.reviewed = true;
      else if (d.decision === "merge_duplicate") { e.dupOf = d.value; e.reviewed = true; }
      else if (d.decision === "match_transfer") { e.matchedWith = d.value; e.reviewed = true; const mate = entryById[d.value]; if (mate) mate.matchedWith = e.id; }
      else if (d.decision === "split") { e.split = E.parseSplit(d.value); e.reviewed = true; }
      else if (d.decision === "worth_it") e.worth = String(d.value || "").toLowerCase();
    }
    const firstSeen = new Set(), seenMerchant = new Set(), dupKey = new Map(), dupes = new Map();
    for (const e of entries) {
      e.flow = e.kind === "transaction" ? ((catById[e.cat] || {}).flow || "Expense") : e.kind;
      if (acctById[e.acct]) acctById[e.acct].entries.push(e);
      if (e.transferId && txById[e.id]) txById[e.id].transferId = e.transferId;
      if (e.kind === "transaction") {
        const name = e.desc || e.raw; if (name && !seenMerchant.has(name)) { seenMerchant.add(name); firstSeen.add(e.id); }
        // the sheet's own duplicate check: same merchant, amount, account and day; the later row is the suspect
        if (e.flow === "Expense") { const k = `${e.date}|${e.acct}|${name}|${e.amount}`; if (dupKey.has(k)) dupes.set(e.id, dupKey.get(k)); else dupKey.set(k, e.id); }
      }
    }
    const balances = (snap.balances || []).map((b) => ({ month: E.date(b.month_end), acct: b.account_id, balance: E.num(b.balance), cls: b.class || "", method: String(b.method || "").toLowerCase(), status: String(b.status || "active").toLowerCase() })).filter((b) => b.month && b.acct);
    const contracts = (snap.contracts || []).map((c) => ({ id: c.contract_id, kind: String(c.kind || "").toLowerCase(), name: c.name, provider: c.provider || "", owner: c.owner || "", acct: c.account_id || "", cat: c.category_id || "", cadence: c.cadence || "Monthly", amount: E.num(c.amount), rate: E.pct(c.rate), start: E.date(c.start_date), end: E.date(c.end_date), next: E.date(c.next_date), lastUsed: E.date(c.last_used), lastUsedRaw: c.last_used, cover: c.cover || "", status: String(c.status || "active").toLowerCase(), note: c.note || "" })).filter((c) => c.id);
    const sheetVersion = E.num(kitty.sheet_version) || 1;
    const asOf = E.date(settings["As-of date"]) || (tx[0] && tx[0].date) || iso(new Date());
    const goals = (snap.goals || []).map((g, i) => ({ row: i + 2, name: g.goal, target: E.num(g.target_amount), date: E.date(g.target_date), acct: g.linked_account, balance: E.num(g.balance_now), progress: E.pct(g.progress), monthsLeft: E.num(g.months_left), needPm: E.num(g.needed_per_month), savedPm: E.num(g.saved_per_month_last_3_months), status: g.status || "" })).filter((g) => g.name);
    const subs = (snap.subscriptions || []).map((s) => ({ service: s.service, merchant: s.merchant, owner: s.owner, cadence: s.cadence || "Monthly", cat: s.category_id, lastUsed: E.date(s.last_used), lastUsedRaw: s.last_used, decision: s.decision || "", lastCharged: E.date(s.last_charged), latest: E.num(s.latest_charge), lowest: E.num(s.lowest_charge_in_look_back), perYear: E.num(s.charges_per_year), annual: E.num(s.annual_cost), riseEach: E.num(s.price_rise_per_charge), riseYear: E.num(s.annual_cost_of_price_rise), daysSince: E.num(s.days_since_used), flag: s.usage_flag || "" })).filter((s) => s.service);
    const loans = (snap.loans || []).map((l) => ({ id: l.loan_id, name: l.loan, lender: l.lender, purpose: l.purpose, type: l.repayment_type, rate: E.pct(l.interest_rate), end: E.date(l.loan_end_date), offset: l.offset_account || "", balance: E.num(l.balance_at_as_of_date), monthsLeft: E.num(l.months_remaining), repayment: E.num(l.monthly_repayment_calculated) }));
    const assets = (snap.assets || []).map((a) => ({ id: a.item_id, name: a.item, cls: a.class, owner: a.owner }));
    const metrics = {}; for (const m of snap.metrics || []) if (m.metric_id) metrics[m.metric_id] = { id: m.metric_id, label: m.metric, raw: m.value, num: m.unit === "Percent" ? E.pct(m.value) : E.num(m.value), text: m.unit === "Text" ? String(m.value == null ? "" : m.value) : null, unit: m.unit, period: m.period, compRaw: m.comparison_value, comp: m.unit === "Percent" && /%/.test(String(m.comparison_value)) ? E.pct(m.comparison_value) : E.num(m.comparison_value), comparedWith: m.compared_with || "", better: m.better_when || "" };
    const checks = (snap.compliance || []).map((c) => ({ name: c.check, type: c.type, items: E.num(c.items) || 0, amount: E.num(c.amount), status: c.status, why: c.why_it_matters || "", where: c.where_to_look || "" }));
    const networth = (snap.networth || []).map((n) => ({ month: E.date(n.month_end), cash: E.num(n.cash), property: E.num(n.property), super: E.num(n.super), shares: E.num(n.shares), vehicle: E.num(n.vehicle), loans: E.num(n.loans), total: E.num(n.net_worth), change: E.num(n.change_in_month) })).filter((n) => n.month);
    const cashflow = (snap.cashflow || []).map((c) => ({ month: E.month(c.month), income: E.num(c.income) || 0, salary: E.num(c.salary_interest) || 0, rent: E.num(c.rent) || 0, spending: E.num(c.spending) || 0, net: E.num(c.net) || 0, rate: E.pct(c.savings_rate), groups: { Housing: E.num(c.housing) || 0, Essentials: E.num(c.essentials) || 0, Lifestyle: E.num(c.lifestyle) || 0, Property: E.num(c.property) || 0, "Work and giving": E.num(c.work_giving) || 0, Fees: E.num(c.fees) || 0, Uncategorised: E.num(c.uncategorised) || 0 } })).filter((c) => c.month);
    const cfcats = (snap.cashflow_categories || []).map((c) => ({ name: c.category, months: (c.months || []).map((v) => E.num(v) || 0) }));
    const budget = (snap.budget || []).map((b) => ({ name: b.category, monthly: E.num(b.monthly_budget), latest: E.num(b.latest_month), avg3: E.num(b.average_last_3_months), ytd: E.num(b.year_to_date), toDate: E.num(b.budget_to_date), left: E.num(b.left_in_budget), used: E.pct(b.budget_used), status: b.status || "" })).filter((b) => b.name && b.name !== "Total");
    const savings = (snap.savings || []).map((s) => ({ title: s.opportunity, shows: s.what_the_data_shows || "", amount: E.num(s.estimated_saving), type: s.type, effort: s.effort, where: s.where_to_look || "", rank: E.num(s.rank) || 99 })).sort(by((s) => s.rank));
    const mi = snap.mortgage_inputs || {};
    const mortgage = {
      balance: E.num(mi["Loan balance ($)"]), offset: E.num(mi["Offset balance ($)"]), rate: E.pct(mi["Current interest rate"]), monthsLeft: E.num(mi["Months remaining"]), repayment: E.num(mi["Current monthly repayment ($)"]), netPm: E.num(mi["Average monthly net cash flow, last 3 months ($)"]), step: E.pct(mi["Rate step"]),
      scenarios: (snap.mortgage || []).map((r) => ({ change: E.pct(r.rate_change), rate: E.pct(r.interest_rate), repayment: E.num(r.monthly_repayment), changePm: E.num(r.change_per_month) || 0, changePy: E.num(r.change_per_year) || 0, netAfter: E.num(r.net_cash_flow_after_change), interest: E.num(r.interest_over_remaining_term), years: E.num(r.years_to_repay_at_today_s_repayment_with_offset) })).filter((r) => r.rate != null),
      extras: (snap.mortgage_extra || []).map((r) => ({ extra: E.num(r.extra_per_month) || 0, total: E.num(r.total_monthly_repayment), years: E.num(r.years_to_repay_with_offset), saved: E.num(r.years_saved) || 0, interestSaved: E.num(r.interest_saved) || 0 })),
    };
    const tax = {}; for (const r of snap.tax || []) if (r.label) tax[r.label] = { pj: E.num(r.prior_j), pm: E.num(r.prior_m), cj: E.num(r.cur_j), cm: E.num(r.cur_m), rawPj: r.prior_j, rawCj: r.cur_j, how: r.how || "" };
    const payslips = (snap.payslips || []).map((p) => ({ date: E.date(p.pay_date), person: p.person, employer: p.employer, gross: E.num(p.gross_pay), tax: E.num(p.tax_withheld), super: E.num(p.super), net: E.num(p.net_pay) })).filter((p) => p.date).sort(by((p) => p.date));
    const people = (kitty.people || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!people.length) for (const p of payslips) if (!people.includes(p.person)) people.push(p.person);
    const householdName = kitty.household_name || (settings.Household ? String(settings.Household).replace(/\s*\(.*\)\s*$/, "") : "This household");
    const m = { asOf, settings, kitty, sheetVersion, householdName, people, cats, catById, accounts, acctById, tx, entries, entryById, balances, contracts, decisions, rules, goals, subs, loans, assets, metrics, checks, networth, cashflow, cfcats, budget, savings, mortgage, tax, payslips, firstSeen, dupes, fetchedAt: snap.fetchedAt || null };
    // every transaction carries its merchant resolution: the sheet's Rules first, then the dictionary, then a flagged fallback
    m.merMemo = new Map(); m.ruleIndex = null;
    for (const e of entries) if (e.kind === "transaction") { e.mer = E.merchant(e.raw || e.desc, m); const t = txById[e.id]; if (t) t.mer = e.mer; }
    return m;
  };

  // ---------- windows and spending ----------
  E.window = (kind, anchor) => {
    const a = E.date(anchor);
    if (kind === "month") return { from: E.monthStart(a), to: E.monthEnd(a), label: E.fmtMonth(a) };
    if (kind === "quarter") { const from = E.addMonths(E.monthStart(a), -2); return { from, to: E.monthEnd(a), label: `${E.fmtMonth(from, true)} – ${E.fmtMonth(a, true)}` }; }
    if (kind === "year") { const from = E.addMonths(E.monthStart(a), -11); return { from, to: E.monthEnd(a), label: `${E.fmtMonth(from, true)} – ${E.fmtMonth(a, true)}` }; }
    if (kind === "fy") { const y = E.fyOf(a); return { from: `${y - 1}-07-01`, to: E.monthEnd(a), label: `FY${String(y).slice(2)} so far` }; }
    return { from: a, to: a, label: E.fmtDay(a) };
  };
  E.inWin = (t, w) => t.date >= w.from && t.date <= w.to;
  // Spending mirrors the sheet: expense categories summed by sign, transfers left out, income by category.
  E.spend = (tx, w, filter) => {
    const byCat = new Map(), byGroup = new Map(), byMerchant = new Map(); let out = 0, inc = 0, count = 0;
    for (const t of tx) {
      if (!E.inWin(t, w) || (filter && !filter(t))) continue;
      if (t.flow === "Transfer") continue;
      if (t.flow === "Income") { inc += t.amount; continue; }
      out -= t.amount; count++;
      byCat.set(t.cat, (byCat.get(t.cat) || 0) - t.amount);
      byGroup.set(t.group, (byGroup.get(t.group) || 0) - t.amount);
      byMerchant.set(t.merchant, (byMerchant.get(t.merchant) || 0) - t.amount);
    }
    const sortMap = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]);
    return { out, in: inc, net: inc - out, count, byCat: sortMap(byCat), byGroup: sortMap(byGroup), byMerchant: sortMap(byMerchant) };
  };
  E.monthly = (m, n = 12) => {
    const out = []; let w = E.window("month", m.asOf);
    for (let i = 0; i < n; i++) { const s = E.spend(m.tx, w); out.unshift({ month: w.from, from: w.from, to: w.to, in: s.in, out: s.out, net: s.net }); w = E.window("month", E.addMonths(w.from, -1)); }
    return out;
  };
  E.merchantSeries = (m, merchant, n = 12) => E.monthly(m, n).map((mo) => ({ month: mo.month, v: E.spend(m.tx, mo, (t) => t.merchant === merchant).out }));
  // Where spending grew: last 3 months against the same 3 months a year earlier, per category.
  E.movers = (m, minPm) => {
    const min = minPm != null ? minPm : E.num(m.settings["Smallest monthly spend for the growth ranking ($)"]) || 100;
    const now = E.window("quarter", m.asOf), then = { from: E.addMonths(now.from, -12), to: E.addMonths(now.to, -12) };
    const a = E.spend(m.tx, now), b = E.spend(m.tx, then); const bm = new Map(b.byCat);
    const seen = new Set();
    const rows = [];
    for (const [cat, v] of a.byCat) { seen.add(cat); const prev = bm.get(cat) || 0; const nowPm = v / 3, thenPm = prev / 3; if (nowPm < min && thenPm < min) continue; rows.push({ cat, name: (m.catById[cat] || {}).name || cat, nowPm, thenPm, diff: nowPm - thenPm, pct: thenPm > 0 ? (nowPm - thenPm) / thenPm : null }); }
    for (const [cat, prev] of b.byCat) if (!seen.has(cat) && prev / 3 >= min) rows.push({ cat, name: (m.catById[cat] || {}).name || cat, nowPm: 0, thenPm: prev / 3, diff: -prev / 3, pct: -1 });
    rows.sort((x, y) => y.diff - x.diff);   // biggest dollar increase first; decreases at the end
    // the sheet's "fastest growing": the largest percentage rise among categories still above the floor
    const grown = rows.filter((r) => r.nowPm >= min && r.thenPm > 0 && r.pct > 0).sort((x, y) => y.pct - x.pct);
    rows.fastest = grown[0] || null;
    return rows;
  };

  // ---------- what's coming up ----------
  E.cadenceMonths = (c) => ({ weekly: 0.25, fortnightly: 0.5, monthly: 1, quarterly: 3, annual: 12, yearly: 12 }[String(c || "monthly").toLowerCase()] || 1);
  E.nextCharge = (s, today) => {
    if (!s.lastCharged) return null;
    const mo = E.cadenceMonths(s.cadence);
    let d = s.lastCharged, guard = 0;
    while (d <= today && guard++ < 200) d = mo < 1 ? E.addDays(d, Math.round(mo * 28)) : E.addMonths(d, mo);
    return d;
  };
  E.payday = (m) => {
    const cycle = { weekly: 7, fortnightly: 14, monthly: 30 }[String(m.kitty.pay_cycle || "fortnightly").toLowerCase()] || 14;
    const out = [];
    for (const p of m.people) {
      const mine = m.payslips.filter((x) => x.person === p); if (!mine.length) continue;
      const last = mine[mine.length - 1]; let next = last.date, guard = 0;
      while (next <= m.asOf && guard++ < 60) next = cycle === 30 ? E.addMonths(next, 1) : E.addDays(next, cycle);
      const nets = mine.slice(-3).map((x) => x.net).sort((a, b) => a - b);
      out.push({ person: p, employer: last.employer, next, net: nets[Math.floor(nets.length / 2)], days: E.daysBetween(m.asOf, next) });
    }
    return out.sort(by((p) => p.next));
  };
  // Up's "this pay cycle": spending since the household's most recent pay day
  E.sinceLastPay = (m) => {
    const last = m.payslips.filter((p) => p.date <= m.asOf).map((p) => p.date).sort().pop(); if (!last) return null;
    const sp = E.spend(m.tx, { from: last, to: m.asOf }); return { date: last, out: sp.out, days: E.daysBetween(last, m.asOf) + 1 };
  };
  E.upcoming = (m, days) => {
    if (days == null) days = E.num(m.kitty.look_ahead_days) || 35;
    const today = m.asOf, until = E.addDays(today, days), items = [];
    // A dated, unambiguous v2 contract outranks the legacy guess from past entries.
    // A refunded last charge is never forecast as income.
    const onlyTerm = predicate => { const terms = (m.contracts || []).filter(c => c.status === "active" && predicate(c)); return terms.length === 1 ? terms[0] : null; };
    for (const s of m.subs) {
      if (/cancel/i.test(s.decision) && /cancelled/i.test(s.flag)) continue;
      const term = onlyTerm(c => ["subscription","bill","insurance"].includes(c.kind) && (c.name === s.service || c.provider === s.service) && (!s.owner || !c.owner || c.owner === s.owner));
      const d = term?.next > today ? term.next : E.nextCharge(s,today);
      const amount = s.latest > 0 ? -s.latest : term?.amount > 0 ? -term.amount : null;
      if (d && d <= until) items.push({ date:d, kind:"bill", title:s.service, sub:`${E.cap(String(s.cadence).toLowerCase())}${s.owner && s.owner !== "Joint" ? ` · ${s.owner}` : ""}${/still charging/i.test(s.flag) ? " · still charging after cancel" : ""}`, amount, warn:/still charging/i.test(s.flag), ref:{type:"sub",key:s.service} });
    }
    for (const l of m.loans) {
      if (!l.repayment) continue;
      const term = onlyTerm(c => c.kind === "loan" && c.acct === l.id);
      if (m.sheetVersion >= 2 && (!term?.next || term.next <= today)) continue;
      const fallback = l.purpose === "Investment" ? (E.monthEnd(today) <= today ? E.monthEnd(E.addMonths(today,1)) : E.monthEnd(today)) : E.monthStart(E.addMonths(today,1));
      const d = term?.next > today ? term.next : fallback;
      if (d > today && d <= until) items.push({ date:d, kind:"loan", title:`${l.name} ${l.type === "Interest only" ? "interest" : "repayment"}`, sub:`${l.lender} · ${E.fmtPct(l.rate,2)}`, amount:-l.repayment, ref:{type:"loan",key:l.id} });
    }
    for (const p of E.payday(m)) if (p.next <= until) items.push({ date: p.next, kind: "pay", title: `${p.person}'s pay`, sub: p.employer, amount: p.net, ref: { type: "pay", key: p.person } });
    for (const g of m.goals) if (g.date > today && g.date <= until) items.push({ date: g.date, kind: "goal", title: `${g.name} target date`, sub: g.status === "Reached" ? "Reached" : `${E.fmt0(g.target - (g.balance || 0))} still to go`, amount: null, ref: { type: "goal", key: g.name } });
    return items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  };

  // ---------- safety net, goals, forecasts ----------
  E.safety = (m) => {
    const target = E.num(m.settings["Emergency fund target (months of essential spending)"]) || (m.metrics["emergency.months_covered"] && m.metrics["emergency.months_covered"].comp) || 6;
    const months = m.metrics["emergency.months_covered"] ? m.metrics["emergency.months_covered"].num : null;
    const liquid = m.accounts.filter((a) => a.liquid && a.type !== "Credit card").reduce((s, a) => s + (a.balance || 0), 0);
    const essentialPm = months ? liquid / months : null;
    return { months, target, liquid, essentialPm, short: months != null && essentialPm ? Math.max(0, (target - months) * essentialPm) : null, pct: months != null ? Math.min(1, months / target) : null };
  };
  E.goalEta = (g, extraPm = 0, asOf) => {
    const left = Math.max(0, (g.target || 0) - (g.balance || 0)), pace = (g.savedPm || 0) + extraPm;
    if (left <= 0) return { months: 0, date: asOf, reached: true };
    if (pace <= 0) return { months: null, date: null, reached: false };
    const months = Math.ceil(left / pace);
    return { months, date: E.addMonths(asOf, months), reached: false, late: g.date ? E.addMonths(asOf, months) > g.date : false };
  };
  E.goalIcon = (name) => { const n = String(name).toLowerCase(); if (/emergency|safety|buffer|rainy/.test(n)) return "🛟"; if (/japan|trip|holiday|travel|europe|bali|ski/.test(n)) return "✈️"; if (/offset|loan|mortgage|house|home|deposit/.test(n)) return "🏡"; if (/car|wheels/.test(n)) return "🚗"; if (/wedding|ring/.test(n)) return "💍"; if (/baby|kid|school/.test(n)) return "🧸"; if (/reno|kitchen|bath/.test(n)) return "🔨"; return "🎯"; };
  E.goalColor = (name) => { const n = String(name).toLowerCase(); if (/emergency|safety|buffer/.test(n)) return "var(--c-in)"; if (/japan|trip|holiday|travel/.test(n)) return "var(--accent)"; if (/offset|loan|mortgage|home/.test(n)) return "var(--amber)"; return "var(--c-kept)"; };

  // ---------- subscriptions and leaks ----------
  E.leaks = (m) => {
    const unused = m.subs.filter((s) => /unused|never/i.test(s.flag) && !/cancel/i.test(s.decision));
    const stillCharging = m.subs.filter((s) => /still charging/i.test(s.flag));
    const rises = m.subs.filter((s) => (s.riseYear || 0) > 0 && !/cancel/i.test(s.decision));
    const review = m.subs.filter((s) => /review/i.test(s.decision));
    const sum = (xs, f) => xs.reduce((a, x) => a + (f(x) || 0), 0);
    return { unused, stillCharging, rises, review, unusedYear: sum(unused, (s) => s.annual), stillYear: sum(stillCharging, (s) => s.annual), risesYear: sum(rises, (s) => s.riseYear), total: m.subs.filter((s) => !/cancel/i.test(s.decision) || /still charging/i.test(s.flag)).reduce((a, s) => a + (s.annual || 0), 0) };
  };

  // ---------- the verdict and the one list of what needs a person ----------
  E.needs = (m) => {
    const items = [];
    const push = (x) => items.push(x);
    const ck = (name) => m.checks.find((c) => c.name.startsWith(name));
    const close = m.metrics["close.items_missing"];
    if (close && close.num > 0) push({ em: "📥", t: `${E.words(close.num)} month-end item${close.num > 1 ? "s are" : " is"} missing`, s: "Valuations, payslips or a bank import have not landed, so some numbers are provisional.", warn: true, go: "setup", amt: null });
    const dup = ck("Possible duplicate charges");
    if (dup && dup.status === "Review" && dup.items) push({ em: "👯", t: `${E.words(dup.items)} charge${dup.items > 1 ? "s look" : " looks"} doubled`, s: "Same merchant, amount, account and day. Usually worth a dispute.", warn: true, go: "dupes", amt: dup.amount, amtNote: "to recover" });
    const lk = E.leaks(m);
    for (const s of lk.stillCharging) push({ em: "🧟", t: `${s.service} is still charging after you cancelled`, s: `Last charged ${E.fmtDay(s.lastCharged)} · ${E.fmt(s.latest)} ${String(s.cadence).toLowerCase()}`, warn: true, go: "sub:" + s.service, amt: s.annual, amtNote: "a year" });
    const taxItems = m.checks.filter((c) => c.type === "Tax" && c.status === "Review");
    const risk = m.metrics["tax.refund_at_risk.prior_year"];
    if (taxItems.length) push({ em: "🧾", t: `${E.words(taxItems.reduce((a, c) => a + c.items, 0))} tax claim${taxItems.length > 1 ? "s need" : " needs"} evidence`, s: `${E.fmt0(risk ? risk.num : null)} of the expected refund rests on them. ${taxItems[0].why}`, warn: false, go: "checks", amt: risk ? risk.num : null, amtNote: "at risk" });
    const interest = ck("Card interest charged");
    if (interest && interest.status === "Review") push({ em: "💳", t: "The card charged interest this year", s: interest.why, warn: false, go: "cat:FEES", amt: interest.amount, amtNote: "interest" });
    if (lk.unused.length) push({ em: "😴", t: `${E.words(lk.unused.length)} subscription${lk.unused.length > 1 ? "s haven't" : " hasn't"} been used in months`, s: lk.unused.map((s) => s.service).join(", "), warn: false, go: "subs", amt: lk.unusedYear, amtNote: "a year" });
    const behind = m.goals.filter((g) => /behind/i.test(g.status));
    for (const g of behind.slice(0, 2)) push({ em: E.goalIcon(g.name), t: `${g.name} is behind pace`, s: `Needs ${E.fmt0(g.needPm)} a month until ${E.fmtMonth(g.date, true)}; the last 3 months put in ${E.fmt0(g.savedPm)}.`, warn: false, go: "goal:" + g.name, amt: g.needPm - g.savedPm, amtNote: "a month short" });
    const sf = E.safety(m);
    if (sf.months != null && sf.months < sf.target) push({ em: "🛟", t: `Safety net covers ${sf.months.toFixed(1)} of ${sf.target} months`, s: `About ${E.fmtS(sf.short)} more in cash would reach the target you set.`, warn: false, go: "safety", amt: null });
    const over = m.budget.filter((b) => /over/i.test(b.status));
    if (over.length) push({ em: "📈", t: `${over.length === 1 ? over[0].name + " is" : over.length === 2 ? `${over[0].name} and ${over[1].name} are` : `${over.length} categories are`} over budget this year`, s: over.slice(0, 3).map((b) => `${b.name} ${E.fmtPct(b.used)}`).join(" · "), warn: false, go: "budget", amt: -over.reduce((a, b) => a + (b.left || 0), 0), amtNote: "over so far" });
    const uncat = ck("Uncategorised transactions");
    if (uncat && uncat.items) push({ em: "🏷️", t: `${E.words(uncat.items)} transaction${uncat.items > 1 ? "s need" : " needs"} a category`, s: "Left out of budgets and tax totals until someone names them.", warn: false, go: "cat:UNCAT", amt: uncat.amount });
    const bigAt = E.num(m.kitty.big_bill_amount) || 500;
    const big = E.upcoming(m, 14).filter((u) => u.kind === "bill" && -u.amount >= bigAt);
    for (const u of big) push({ em: "📅", t: `${u.title} is due ${E.rel(m.asOf, u.date)}`, s: u.sub, warn: false, go: "upcoming", amt: -u.amount });
    items.sort((a, b) => (b.warn === true) - (a.warn === true));
    const n = items.length;
    const verdict = items.some((i) => i.warn) ? "Worth a look." : n ? "Mostly on track." : "On track.";
    const line = !n ? "Nothing needs you today." : n === 1 ? "One thing needs you." : `${E.cap(E.words(n))} things need you.${n > 4 ? " The first four are here." : ""}`;
    return { verdict, line, items: items.slice(0, 4), all: items, more: Math.max(0, n - 4) };
  };

  // ---------- property, net worth ----------
  E.property = (m) => {
    const w = E.window("year", m.asOf); const rentIn = E.spend(m.tx, w, (t) => t.cat === "RENT-INC").in;
    const costs = E.spend(m.tx, w, (t) => /^RENT-/.test(t.cat) && t.cat !== "RENT-INC");
    const loan = m.loans.find((l) => l.purpose === "Investment");
    return { rentPm: rentIn / 12, costPm: costs.out / 12, netPm: (rentIn - costs.out) / 12, byCat: costs.byCat.map(([c, v]) => ({ cat: c, name: (m.catById[c] || {}).name || c, pm: v / 12 })), loan, asset: m.assets.find((a) => a.id === "RENTAL"), value: (m.networth[m.networth.length - 1] || {}).property };
  };
  E.ownership = (m) => { const n = m.networth[m.networth.length - 1]; if (!n) return []; return [["Property", n.property, "var(--c-loan)"], ["Super", n.super, "var(--accent)"], ["Cash", n.cash, "var(--c-in)"], ["Shares", n.shares, "var(--c-kept)"], ["Vehicle", n.vehicle, "var(--c-move)"]].filter((x) => x[1] > 0).map(([k, v, c]) => ({ k, v, c })); };

  // ---------- search ----------
  E.parseQuery = (q, m) => {
    const f = { text: [], person: null, cat: null, min: null, max: null, from: null, to: null, acct: null };
    for (const tok of String(q || "").toLowerCase().split(/\s+/).filter(Boolean)) {
      let x;
      if ((x = tok.match(/^person:(\w+)$/))) f.person = x[1];
      else if ((x = tok.match(/^(?:cat|category):([\w-]+)$/))) f.cat = x[1];
      else if ((x = tok.match(/^(?:acct|account):([\w-]+)$/))) f.acct = x[1];
      else if ((x = tok.match(/^>\$?(\d+)$/))) f.min = +x[1];
      else if ((x = tok.match(/^<\$?(\d+)$/))) f.max = +x[1];
      else if (MON[tok.slice(0, 3)] && tok.length >= 3 && /^[a-z]+$/.test(tok)) { const mo = MON[tok.slice(0, 3)]; const y = E.fyOf(m.asOf) - (mo >= 7 ? 1 : 0); const yy = `${y}-${pad2(mo)}-01` > m.asOf ? y - 1 : y; f.from = `${yy}-${pad2(mo)}-01`; f.to = E.monthEnd(f.from); }
      else if (/^\d{4}$/.test(tok)) { f.from = `${tok}-01-01`; f.to = `${tok}-12-31`; }
      else if (m.people.some((p) => p.toLowerCase() === tok)) f.person = tok;
      else f.text.push(tok);
    }
    return f;
  };
  E.match = (m, q, rows) => {
    const f = E.parseQuery(q, m);
    const catIds = f.cat ? m.cats.filter((c) => c.id.toLowerCase() === f.cat || c.name.toLowerCase().includes(f.cat) || c.group.toLowerCase() === f.cat).map((c) => c.id) : null;
    return (rows || m.tx).filter((t) => {
      if (f.person && String(t.person || "").toLowerCase() !== f.person) return false;
      if (catIds && !catIds.includes(t.cat)) return false;
      if (f.acct && String(t.acct || "").toLowerCase() !== f.acct) return false;
      if (f.min != null && Math.abs(t.amount) < f.min) return false;
      if (f.max != null && Math.abs(t.amount) > f.max) return false;
      if (f.from && (t.date < f.from || t.date > f.to)) return false;
      if (!f.text.length) return true;
      const c = m.catById[t.cat]; const acct = m.acctById[t.acct];
      const hay = `${t.merchant || ""} ${t.desc || ""} ${t.raw || ""} ${t.mer ? t.mer.name : ""} ${t.catName || (c ? c.name : "")} ${t.group || (c ? c.group : "")} ${t.note || ""} ${t.person || ""} ${acct ? acct.name : ""} ${t.kind || ""}`.toLowerCase();
      return f.text.every((w) => hay.includes(w));
    });
  };
  E.csv = (rows, cols) => { const q = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }; return [cols.map((c) => q(c.label || c.key)).join(",")].concat(rows.map((r) => cols.map((c) => q(typeof c.get === "function" ? c.get(r) : r[c.key])).join(","))).join("\n"); };

  // ---------- the ledger: balance at a date, signals, the transfer invariant ----------
  // Balance of an account on a date: the opening anchor plus every transaction up to the date for a ledger account;
  // the last valuation on or before the date, carried forward, for everything else (statement, appraisal, market, estimate).
  // Before the opening date the account did not exist; before its first valuation it is worth its anchor.
  E.balanceAt = (a, date) => {
    if (!a) return null; const d = E.date(date); if (!d) return null;
    if (a.openingDate && d < a.openingDate) return 0;
    const es = a.entries || [];
    if (a.method === "ledger") { let s = a.opening || 0; for (const e of es) if (e.kind === "transaction" && e.date <= d) s += e.amount; return s; }
    let last = null; for (const e of es) if (e.kind === "valuation" && e.date <= d && (!last || e.date >= last.date)) last = e;
    return last ? last.amount : a.opening != null ? a.opening : null;
  };
  // Signals derive from the model and nothing else; beta rows do not turn them on. A widget appears only when its signal is true.
  E.signals = (m) => {
    const act = m.accounts.filter((a) => a.status === "active"); const t = (a) => String(a.type || "").toLowerCase(); const has = (f) => act.some(f);
    return {
      has_property: has((a) => t(a) === "property"),
      has_investment_property: has((a) => t(a) === "property" && /invest|rental/i.test(a.purpose)),
      has_shares: has((a) => t(a) === "shares"),
      has_crypto: has((a) => t(a) === "crypto"),
      has_super: has((a) => t(a) === "super" || t(a) === "smsf"),
      has_smsf: has((a) => t(a) === "smsf"),
      has_contracts: m.contracts.some((c) => c.status === "active"),
      has_things: has((a) => t(a) === "vehicle" || t(a) === "device"),
    };
  };
  // A transfer is one event on two accounts, paired by transfer_id: a mate of the opposite amount, on another account, within four days.
  E.transfers = (m) => {
    const xs = m.entries.filter((e) => e.kind === "transaction" && (e.flow === "Transfer" || e.transferId));
    const groups = new Map(); for (const e of xs) if (e.transferId) { if (!groups.has(e.transferId)) groups.set(e.transferId, []); groups.get(e.transferId).push(e); }
    const orphans = xs.filter((e) => !e.transferId), pairs = [], bad = [];
    for (const [id, g] of groups) { const ok = g.length === 2 && Math.abs(g[0].amount + g[1].amount) < 0.005 && g[0].acct !== g[1].acct && Math.abs(E.daysBetween(g[0].date, g[1].date)) <= 4; (ok ? pairs : bad).push({ id, entries: g }); }
    return { count: xs.length, pairs, orphans, bad };
  };
  // Month ends covered by the ledger: the opening month through the as-of month.
  E.monthEnds = (m) => { const first = m.accounts.map((a) => a.openingDate).filter(Boolean).sort()[0] || (m.entries[0] && m.entries[0].date) || m.asOf; const out = []; let d = E.monthEnd(first); while (d <= E.monthEnd(m.asOf)) { out.push(d); d = E.monthEnd(E.addMonths(d, 1)); } return out; };
  // The invariants a ledger must keep. Each is also a Compliance Check row in the sheet, so a break shows in two places.
  E.invariants = (m) => {
    const out = []; const tr = E.transfers(m);
    out.push({ what: "Every transfer has a mate of the opposite amount, on another account, within four days", a: tr.orphans.length + tr.bad.length, b: 0, ok: tr.orphans.length + tr.bad.length === 0, count: true, detail: tr.orphans.slice(0, 5).map((e) => e.id).concat(tr.bad.slice(0, 5).map((p) => p.id)) });
    const leaked = tr.pairs.reduce((n, p) => n + p.entries.filter((e) => e.flow !== "Transfer").length, 0);
    out.push({ what: "Paired transfers are left out of spending", a: leaked, b: 0, ok: leaked === 0, count: true });
    // each month: the change across every active balance equals income less spending plus valuation changes
    const act = m.accounts.filter((a) => a.status === "active"); const ends = E.monthEnds(m); let worst = 0, worstMonth = null;
    for (let i = 1; i < ends.length; i++) {
      const p = ends[i - 1], d = ends[i]; const w = E.window("month", d);
      let dAll = 0, dVal = 0; for (const a of act) { const x = (E.balanceAt(a, d) || 0) - (E.balanceAt(a, p) || 0); dAll += x; if (a.method !== "ledger") dVal += x; }
      const s = E.spend(m.tx, w); const res = dAll - (s.in - s.out) - dVal;
      if (Math.abs(res) > Math.abs(worst)) { worst = res; worstMonth = d; }
    }
    out.push({ what: `Each month's change in total balances equals income less spending plus valuation changes${worstMonth ? ` (largest gap ${E.fmtMonth(worstMonth, true)})` : ""}`, a: worst, b: 0, ok: Math.abs(worst) < 0.05 });
    // the Net Worth tab is derived from Balances: its class columns must equal the active balances by class
    if (m.balances.length && m.networth.length) {
      let gap = 0; const cols = { cash: "Cash", property: "Property", super: "Super", shares: "Shares", vehicle: "Vehicle", loans: "Loans" };
      for (const n of m.networth) for (const [k, cls] of Object.entries(cols)) { const s = m.balances.filter((b) => b.month === n.month && b.status === "active" && b.cls === cls).reduce((t, b) => t + (b.balance || 0), 0); gap = Math.max(gap, Math.abs(s - (n[k] || 0))); }
      out.push({ what: "Net worth by class equals the Balances tab", a: gap, b: 0, ok: gap < 1 });
    }
    return out;
  };

  // ---------- consistency checks the page shows in its trust drawer ----------
  E.reconcile = (m) => {
    const out = [];
    const liquid = m.accounts.filter((a) => a.liquid).reduce((s, a) => s + (a.balance || 0), 0);
    const cashM = m.metrics["networth.cash"]; if (cashM && cashM.num != null) out.push({ what: "Accounts add up to the Cash metric", a: liquid, b: cashM.num, ok: Math.abs(liquid - cashM.num) < 1 });
    const last = m.cashflow[m.cashflow.length - 1];
    if (last) { const s = E.spend(m.tx, E.window("month", last.month)); out.push({ what: `Transactions add up to the Cash Flow tab for ${E.fmtMonth(last.month)}`, a: s.out, b: last.spending, ok: Math.abs(s.out - last.spending) < 1 }); }
    const ids = new Set(); let dupIds = 0; for (const t of m.tx) { if (ids.has(t.id)) dupIds++; ids.add(t.id); } out.push({ what: "Every transaction ID is used once", a: dupIds, b: 0, ok: dupIds === 0, count: true });
    const unknown = m.tx.filter((t) => !m.catById[t.cat]).length; out.push({ what: "Every category ID exists on the Categories tab", a: unknown, b: 0, ok: unknown === 0, count: true });
    // every account: the balance derived here against the sheet's own (the Balances tab at the as-of month end, else the Accounts tab)
    const eom = E.monthEnd(m.asOf);
    for (const a of m.accounts) {
      const mine = E.balanceAt(a, m.asOf); const row = m.balances.find((b) => b.acct === a.id && b.month === eom); const sheet = row ? row.balance : a.balance;
      out.push({ what: `${a.name}${a.status !== "active" ? ` (${a.status})` : ""}: ${a.method === "ledger" ? "opening balance plus every entry" : `last ${a.method} valuation`} agrees with the ${row ? "Balances" : "Accounts"} tab`, a: mine, b: sheet, ok: mine != null && sheet != null && Math.abs(mine - sheet) < 0.01, account: a.id });
    }
    if (m.sheetVersion >= 2) for (const inv of E.invariants(m)) out.push(inv);
    return out;
  };

  /* Add rows under a table in the sheet. The page's cached grid can be 30 minutes old and another device may have written since, so the row
     comes from a forced read of the whole table, and anything it cannot trust stops with no write: the wrong tab, a moved or missing header,
     or a session that changed during the read. A row counts as taken if any cell in it is filled, so a row with no ID is never overwritten.
     host: { sheet, call(tool, input, opts), current() }. rows(grid) builds the rows, so IDs follow the fresh read. */
  E.appendRows = async (host, { tab, last, header, rows }) => {
    const res = await host.call("get_values", { spreadsheetId: host.sheet, range: `${tab}!A1:${last}` }, { cache: { staleTime: 0, gcTime: 0, refresh: true } });
    if (!host.current()) throw { code: "stale_session" };
    let p = res && res.payload; if (typeof p === "string") { try { p = JSON.parse(p); } catch (e) { p = null; } }
    const grid = p && p.values, at = p && typeof p.range === "string" ? p.range.replace(/'/g, "").split("!") : [];
    if (at[0] !== tab || !/^A1(:|$)/.test(at[1] || "") || !Array.isArray(grid) || grid.some((r) => !Array.isArray(r))) throw { code: "invalid_response" };
    if (!header.every((h, i) => String((grid[0] || [])[i] == null ? "" : grid[0][i]).trim() === h)) throw { code: "invalid_ledger", message: `The ${tab} header is not where it should be, so nothing was saved.` };
    let used = 0; grid.forEach((r, i) => { if (r.some((c) => c !== "" && c != null)) used = i + 1; });
    const out = rows(grid), row = used + 1;
    await host.call("update_values", { spreadsheetId: host.sheet, range: `${tab}!A${row}:${last}${row + out.length - 1}`, values: out });
    return { row, rows: out };
  };

  // ---------- merchants: normalise a bank descriptor, then resolve it (Rules, then the dictionary, then a flagged fallback) ----------
  // The dictionary is a repo asset (merchants/merchants.json + categories.json); the page bundles it, node tests load it.
  const DICT = { merchants: [], byId: {}, byName: {}, categories: {}, groups: {}, kinds: {}, compiled: [] };
  E.loadMerchants = (pack) => {
    const ms = (pack && pack.merchants && pack.merchants.merchants) || (pack && pack.merchants) || [];
    const cats = (pack && pack.categories && pack.categories.categories) || {};
    DICT.merchants = Array.isArray(ms) ? ms : []; DICT.byId = {}; DICT.byName = {}; DICT.compiled = [];
    DICT.categories = cats; DICT.groups = (pack && pack.categories && pack.categories.groups) || {}; DICT.kinds = (pack && pack.categories && pack.categories.kinds) || {};
    for (const d of DICT.merchants) {
      DICT.byId[d.id] = d; DICT.byName[String(d.name).toLowerCase()] = d;
      for (const p of d.patterns || []) { try { DICT.compiled.push({ re: new RegExp(p), d, lit: p.replace(/\\b|\(\?!.*?\)|[\\^$()?:*+|\[\]]/g, "").length }); } catch (e) { /* a bad pattern never breaks the page */ } }
    }
    DICT.compiled.sort((a, b) => b.lit - a.lit);
    return DICT;
  };
  E.dictionary = () => DICT;
  const PROTECT = [[/\b7[\s-]?ELEVEN\b/g, "SEVENELEVEN"], [/\bF45\b/g, "FFORTYFIVE"], [/\b13\s?CABS\b/g, "THIRTEENCABS"]];
  const NOISE = /\b(?:VISA PURCHASE|VISA DEBIT|DEBIT CARD PURCHASE|EFTPOS PURCHASE|EFTPOS|TAP AND PAY|PAYWAVE|CONTACTLESS|MASTERCARD PURCHASE|CARD PURCHASE|POS PURCHASE|VALUE DATE|EFFECTIVE DATE|DIRECT DEBIT|DIRECT CREDIT|AUTHORISATION|PENDING|RECEIPT NO|REF NO|REFERENCE)\b/g;
  const MONTHWORD = /\b(?:JAN(?:UARY)?|FEB(?:RUARY)?|MAR(?:CH)?|APR(?:IL)?|MAY|JUNE?|JULY?|AUG(?:UST)?|SEPT?(?:EMBER)?|OCT(?:OBER)?|NOV(?:EMBER)?|DEC(?:EMBER)?)\b/g;
  const CITY = /\s+(?:SYDNEY|MELBOURNE|BRISBANE|PERTH|ADELAIDE|HOBART|DARWIN|CANBERRA|GOLD COAST|NEWCASTLE|WOLLONGONG|GEELONG|SUNSHINE COAST|TOWNSVILLE|CAIRNS)(?:\s+(?:SOUTH|NORTH|EAST|WEST|CBD|CENTRAL|CITY|AIRPORT|OLYMPIC PARK))?\s*$/;
  const STATE = /\s+(?:NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\s*$/;
  E.normalise = (raw) => {
    let s = String(raw == null ? "" : raw).toUpperCase();
    for (const [re, to] of PROTECT) s = s.replace(re, to);
    s = s.replace(/\b(?:CARD|CRD)\s*(?:X+|\*+|#)?\s*\d{2,4}\b/g, " ").replace(/\b(?:X{2,}|\*{2,})\d{2,4}\b/g, " ");   // card suffixes
    s = s.replace(/[*#_|~]+/g, " ").replace(NOISE, " ");
    s = s.replace(/\b(?:AUD|USD|EUR|GBP|NZD|JPY|SGD|CAD|HKD|INR)\s?\d[\d,]*(?:\.\d+)?\b/g, " ").replace(/\b\d[\d,]*\.\d{2}\b/g, " ").replace(/\b(?:AUD|USD|EUR|GBP|NZD|JPY|SGD|CAD|HKD|INR)\b/g, " ");   // amounts, then stray currency codes
    s = s.replace(/\b\d{1,2}[\/.-]\d{1,2}(?:[\/.-]\d{2,4})?\b/g, " ");                                        // 14/10, 14/10/2025
    s = s.replace(/\b\d{1,2}\s?(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*(?:\s?\d{2,4})?\b/g, " ");   // 14 OCT, 14OCT25
    s = s.replace(MONTHWORD, " ");
    s = s.replace(/\b(?:PTY|LTD|LIMITED|P\/L|INC|LLC|CORP)\b/g, " ").replace(/\b(?:AUS?)\b/g, " ");
    s = s.replace(/\s+/g, " ").replace(STATE, " ").replace(CITY, " ").replace(STATE, " ");
    s = s.replace(/\b[A-Z]*\d+[A-Z\d]*\b/g, " ");                                                              // store numbers and codes
    s = s.replace(/[^A-Z&' ]+/g, " ").replace(/\s+/g, " ").trim();
    return s;
  };
  const toks = (s) => s.split(" ").filter(Boolean);
  // A rule's tokens appear in order and together in the descriptor's tokens; a descriptor cut short by a bank (24 characters is common)
  // still matches when its last token is the start of the rule's next token.
  function tokensMatch(ruleT, rawT) {
    if (!ruleT.length || !rawT.length) return false;
    for (let i = 0; i < rawT.length; i++) {
      let ok = true;
      for (let j = 0; j < ruleT.length; j++) {
        const r = rawT[i + j];
        if (r === undefined) { ok = false; break; }
        if (r === ruleT[j]) continue;
        if (i + j === rawT.length - 1 && r !== ruleT[j] && ruleT[j].startsWith(r) && (r.length >= 4 || j >= 2)) continue;
        ok = false; break;
      }
      if (ok) return true;
    }
    return false;
  }
  function ruleIndex(m) {
    if (m.ruleIndex) return m.ruleIndex;
    const idx = m.rules.map((r) => { const n = E.normalise(r.pattern); return { r, kind: String(r.match || "normalised").toLowerCase(), tokens: toks(n || r.pattern.toUpperCase()), upper: r.pattern.toUpperCase(), re: null }; });
    for (const x of idx) if (x.kind === "regex") { try { x.re = new RegExp(x.r.pattern, "i"); } catch (e) { x.re = null; } }
    idx.sort((a, b) => b.tokens.length - a.tokens.length || b.upper.length - a.upper.length);
    m.ruleIndex = idx; return idx;
  }
  const hashHue = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; };
  const titleCase = (s) => s.toLowerCase().replace(/(^|[\s'&-])([a-z])/g, (m0, a, b) => a + b.toUpperCase()).replace(/\bAnd\b/g, "and");
  const PROCESSOR = /^(?:SQ|SP|TST|PP|PAYPAL|ZLR|PYR|IZ)\s+/;
  E.merchant = (raw, m) => {
    const key = raw == null ? "" : String(raw); const memo = m && m.merMemo;
    if (memo && memo.has(key)) return memo.get(key);
    const norm = E.normalise(key); const rawT = toks(norm); const up = key.toUpperCase().trim();
    let out = null;
    if (m && m.rules && m.rules.length) {
      for (const x of ruleIndex(m)) {
        const hit = x.kind === "exact" ? up === x.upper : x.kind === "contains" ? up.includes(x.upper) : x.kind === "regex" ? !!(x.re && x.re.test(key)) : tokensMatch(x.tokens, rawT);
        if (hit) { const r = x.r; const d = DICT.byName[r.merchant.toLowerCase()] || null; out = { name: r.merchant || titleCase(norm), cat: r.cat, person: r.person, tax: r.tax, property: r.property, source: "rule", rule: r, dict: d, unresolved: false }; break; }
      }
    }
    if (!out && DICT.compiled.length) {
      let best = null, bestLen = 0;
      for (const c of DICT.compiled) { const mm = c.re.exec(norm); if (mm && mm[0].length > bestLen) { best = c.d; bestLen = mm[0].length; } }
      if (best) out = { name: best.name, cat: best.category_id || "", person: "", tax: "", property: "", source: "dictionary", rule: null, dict: best, unresolved: false };
    }
    if (!out) { const clean = norm.replace(PROCESSOR, ""); out = { name: titleCase(clean || norm || key) || "Unknown", cat: "", person: "", tax: "", property: "", source: "fallback", rule: null, dict: null, unresolved: true }; }
    const d = out.dict; out.norm = norm; out.id = d ? d.id : null; out.kind = d ? d.kind || "merchant" : out.source === "fallback" ? "merchant" : /transfer/i.test(out.name) ? "transfer" : "merchant";
    out.hue = d && d.hue ? d.hue : `hsl(${hashHue(out.name)} 52% 46%)`; out.website = d ? d.website || "" : ""; out.icon = d && d.icon ? d.icon : "";
    if (memo) memo.set(key, out);
    return out;
  };
  // One rule against one descriptor, with no dictionary scan behind a miss: what a long ordered rule list needs.
  E.compileRule = (r) => ruleIndex({ rules: [r] })[0];
  E.ruleProbe = (raw) => { const key = raw == null ? "" : String(raw); return { key, up: key.toUpperCase().trim(), rawT: toks(E.normalise(key)) }; };
  E.ruleHit = (x, p) => (x.kind === "exact" ? p.up === x.upper : x.kind === "contains" ? p.up.includes(x.upper) : x.kind === "regex" ? !!(x.re && x.re.test(p.key)) : tokensMatch(x.tokens, p.rawT));
  // The dictionary's nearest entries to a descriptor, for the fortune cookie's prompt and the review card's suggestions.
  E.candidates = (raw, n = 5) => {
    const t = new Set(toks(E.normalise(raw))); if (!t.size) return [];
    const words = (d) => new Set(toks(String(d.name).toUpperCase().replace(/[^A-Z&' ]+/g, " ")).concat((d.patterns || []).flatMap((p) => toks(p.replace(/\\b|\(\?!.*?\)|[\\^$()?:*+|\[\].]/g, " ").toUpperCase()))));
    const scored = DICT.merchants.map((d) => { let sc = 0; const w = words(d); for (const a of t) for (const b of w) { if (a === b) sc += 3; else if (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a))) sc += 1; } return { d, sc }; }).filter((x) => x.sc > 0).sort((a, b) => b.sc - a.sc);
    return scored.slice(0, n).map((x) => ({ id: x.d.id, name: x.d.name, category_id: x.d.category_id, kind: x.d.kind, score: x.sc }));
  };
  E.catIcon = (cat, m) => { const c = DICT.categories[cat]; if (c && c.icon) return c.icon; const g = m && m.catById[cat] ? DICT.groups[m.catById[cat].group] : null; return g && g.icon ? g.icon : "receipt"; };
  E.catHue = (cat, m) => { const c = DICT.categories[cat]; if (c && c.hue) return c.hue; const g = m && m.catById[cat] ? DICT.groups[m.catById[cat].group] : null; return g && g.hue ? g.hue : `hsl(${hashHue(cat)} 52% 46%)`; };
  E.kindIcon = (k) => (DICT.kinds[String(k || "").toLowerCase()] || {}).icon || "stack";
  // "GROCERIES 60.00 | DINING 24.20" → parts; the sheet's Decisions value for a split
  E.parseSplit = (v) => String(v || "").split(/\s*[|;,]\s*/).map((p) => { const mm = p.trim().match(/^([A-Z0-9-]+)\s+(-?[\d.]+)$/i); return mm ? { cat: mm[1].toUpperCase(), amount: +mm[2] } : null; }).filter(Boolean);
  E.formatSplit = (parts) => parts.map((p) => `${p.cat} ${Math.abs(p.amount).toFixed(2)}`).join(" | ");

  // ---------- the review queue: what needs a person, derived from the model and the sheet's own checks ----------
  // uncategorised rows, descriptors no rule or dictionary entry knows, the sheet's possible duplicates (same merchant, amount,
  // account and day), transfers without a mate, and a first visit to a merchant above big_bill_amount in the as-of month.
  // A Decisions row (categorise, confirm, merge_duplicate, match_transfer, split) settles a row; nothing else does.
  E.review = (m) => {
    const bigAt = E.num(m.kitty.big_bill_amount) || 500; const month = E.window("month", m.asOf);
    const tr = E.transfers(m); const orphan = new Set(tr.orphans.map((e) => e.id)); for (const p of tr.bad) for (const e of p.entries) orphan.add(e.id);
    const items = []; const counts = { uncategorised: 0, unresolved: 0, duplicate: 0, unpaired: 0, first_big: 0 };
    for (const e of m.entries) {
      if (e.kind !== "transaction" || e.reviewed) continue;
      const reasons = [];
      if (!e.cat || e.cat === "UNCAT" || !m.catById[e.cat]) reasons.push("uncategorised");
      if (e.mer && e.mer.unresolved) reasons.push("unresolved");
      if (m.dupes.has(e.id)) reasons.push("duplicate");
      if (orphan.has(e.id) && !e.matchedWith) reasons.push("unpaired");
      if (m.firstSeen.has(e.id) && e.flow === "Expense" && Math.abs(e.amount) >= bigAt && E.inWin(e, month)) reasons.push("first_big");
      if (!reasons.length) continue;
      for (const r of reasons) counts[r]++;
      items.push({ id: e.id, entry: e, reasons, dupOf: m.dupes.get(e.id) || null, why: reasons.map((r) => E.reviewWhy(r, e, m)).join(" · ") });
    }
    items.sort((a, b) => (a.entry.date < b.entry.date ? 1 : a.entry.date > b.entry.date ? -1 : 0));
    return { items, counts, byId: new Set(items.map((i) => i.id)), hasRule: (e) => !!(e.mer && e.mer.source === "rule" && e.mer.cat && e.mer.cat !== "UNCAT") };
  };
  E.reviewWhy = (r, e, m) => ({ uncategorised: "needs a category", unresolved: "no rule knows this descriptor", duplicate: `looks like a double of ${m.dupes.get(e.id) || "another row"}`, unpaired: "a transfer with no mate", first_big: `first time here, over ${E.fmt0(E.num(m.kitty.big_bill_amount) || 500)}` }[r] || r);
  // mates a transfer could pair with: the opposite amount, another account, within four days, not already paired
  E.transferMates = (m, e) => m.entries.filter((x) => x.kind === "transaction" && x.id !== e.id && x.acct !== e.acct && Math.abs(x.amount + e.amount) < 0.005 && Math.abs(E.daysBetween(x.date, e.date)) <= 4 && !x.transferId && !x.matchedWith);
  // every unreviewed row whose descriptor a rule pattern would match: what "Make it a rule" applies the category to
  E.rowsForPattern = (m, pattern, excludeId) => { const t = toks(E.normalise(pattern) || String(pattern).toUpperCase()); return m.entries.filter((e) => e.kind === "transaction" && e.id !== excludeId && !e.reviewed && (!e.cat || e.cat === "UNCAT" || (e.mer && e.mer.unresolved)) && tokensMatch(t, toks(E.normalise(e.raw)))); };

  // ---------- worth it? one tap on a handful of discretionary rows a week, grounded in Dunn, Gilbert and Wilson ----------
  const DISC_GROUPS = new Set(["Housing", "Property", "Fees", "Transfers", "Uncategorised", "Income"]);
  E.discretionary = (e, m) => { const c = m.catById[e.cat]; return !!c && c.flow === "Expense" && !c.essential && !DISC_GROUPS.has(c.group) && e.kind === "transaction" && e.amount < 0; };
  E.worthCandidates = (m, min) => {
    const floor = min != null ? min : E.num(m.kitty.worth_it_min) || 40;
    const pool = m.entries.filter((e) => E.discretionary(e, m) && Math.abs(e.amount) >= floor && !e.worth && !e.dupOf);
    for (let back = 0; back < 4; back++) {   // the most recent week that has anything to ask about, within four weeks of the as-of date
      const to = E.addDays(m.asOf, -7 * back), from = E.addDays(to, -6);
      const week = pool.filter((e) => e.date >= from && e.date <= to).sort((a, b) => a.amount - b.amount).slice(0, 5);
      if (week.length) return { from, to, items: week, floor };
    }
    return { from: null, to: null, items: [], floor };
  };
  E.worthSummary = (m) => {
    const answered = m.entries.filter((e) => e.worth); const yes = answered.filter((e) => e.worth === "yes");
    const by = (xs, f) => { const mm = new Map(); for (const e of xs) mm.set(f(e), (mm.get(f(e)) || 0) - e.amount); return [...mm.entries()].sort((a, b) => b[1] - a[1]); };
    return { count: answered.length, yes: yes.length, meh: answered.filter((e) => e.worth === "meh").length, no: answered.filter((e) => e.worth === "no").length, yesTotal: -yes.reduce((a, e) => a + e.amount, 0), total: -answered.reduce((a, e) => a + e.amount, 0), byCat: by(yes, (e) => (m.catById[e.cat] || {}).name || e.cat), byMerchant: by(yes, (e) => (e.mer && e.mer.name) || e.desc), noByMerchant: by(answered.filter((e) => e.worth === "no"), (e) => (e.mer && e.mer.name) || e.desc) };
  };

  return E;
});
