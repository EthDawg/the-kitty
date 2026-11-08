// node --test test-v2.js — the ledger (sheet_version 2). The sheet is the oracle: every account balance the engine derives
// must equal the sheet's Balances tab, at the as-of date and at every month end, and the invariants the sheet checks must hold here too.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const E = require("./src/engine.js");
const load = (p) => JSON.parse(fs.readFileSync(path.join(__dirname, p), "utf8"));
const live = load("data/snapshot-v2.json"), everyday = load("fixtures/everyday-only.json"), property = load("fixtures/everyday+property.json");
const near = (a, b, tol = 0.01) => assert.ok(a != null && b != null && Math.abs(a - b) < tol, `${a} vs ${b}`);

test("a real decision uses the Sheet's day across UTC midnight, independently of the fictional as-of date", () => {
  const instant = new Date("2026-11-04T16:30:00Z");
  assert.equal(E.auditDay(instant,"Australia/Melbourne"),"2026-11-05");
  assert.equal(E.auditDay(instant,"America/Los_Angeles"),"2026-11-04");
});

test("a trimmed Sheets page never moves a later entry to an earlier write address", () => {
  const entries = E.joinGridPages([
    { first: 1, last: 1, rows: [["Entry ID", "Category ID"]] },
    { first: 2, last: 2501, rows: [["T0001", "FOOD"]] },
    { first: 2502, last: 5001, rows: [] },
    { first: 5002, last: 5010, rows: [[], ["T0002", "UNCAT"]] },
  ]);
  assert.equal(entries.findIndex(row => row?.[0] === "T0002") + 1, 5003);
  assert.equal(entries.length, 5003);
  const decisions = [["Decision ID", "Ref ID"], [], ["D0001", "T0002"]];
  const model = E.fromConnector({ entries, decisions });
  assert.deepEqual(model.entries.map(e => e.entry_id), ["T0001", "T0002"]);
  assert.deepEqual(model.decisions.map(d => d.ref_id), ["T0002"]);
  assert.throws(() => E.joinGridPages([{ first: 1, last: 1, rows: [["A"], ["B"]] }]));
});

test("an incomplete Entries or Decisions row cannot silently disappear", () => {
  assert.throws(() => E.fromConnector({ entries: [["Entry ID", "Amount"], ["", 0]] }), /Entry ID.*row 2/);
  assert.throws(() => E.fromConnector({ decisions: [["Decision ID", "Ref ID"], [], ["", "T0002"]] }), /Decision ID.*row 3/);
  assert.throws(() => E.fromConnector({ entries: [["Entry ID"], ["T0001"], [], ["T0001"]] }), /Repeated Entry ID.*row 4/);
});

for (const [name, sn] of [["live v2 snapshot", live], ["fixture everyday-only", everyday], ["fixture everyday+property", property]]) {
  const m = E.model(sn);
  test(`${name}: the sheet is the oracle for every account, at the as-of date and at every month end on the Balances tab`, () => {
    assert.ok(m.sheetVersion >= 2 && m.accounts.length >= 6 && m.balances.length >= m.accounts.length * 12, "a ledger with history");
    for (const a of m.accounts) near(E.balanceAt(a, m.asOf), a.balance, 0.01);
    for (const b of m.balances) { const a = m.acctById[b.acct]; assert.ok(a, `Balances names ${b.acct}`); near(E.balanceAt(a, b.month), b.balance, 0.01); }
    const rec = E.reconcile(m); assert.ok(rec.every((r) => r.ok), JSON.stringify(rec.filter((r) => !r.ok)));
    assert.equal(rec.filter((r) => r.account).length, m.accounts.length, "one trust-drawer row per account");
  });
  test(`${name}: the transfer invariant holds and paired rows never count as spending`, () => {
    const tr = E.transfers(m);
    assert.ok(tr.count >= 100, "enough transfers to mean anything"); assert.equal(tr.orphans.length, 0); assert.equal(tr.bad.length, 0); assert.equal(tr.pairs.length * 2, tr.count);
    for (const inv of E.invariants(m)) assert.ok(inv.ok, `${inv.what}: ${inv.a}`);
    const w = E.window("quarter", m.asOf); const paired = new Set(tr.pairs.flatMap((p) => p.entries.map((e) => e.id)));
    const all = E.spend(m.tx, w), without = E.spend(m.tx.filter((t) => !paired.has(t.id)), w);
    near(all.out, without.out, 0.001); near(all.in, without.in, 0.001);
  });
  test(`${name}: the 1.1 invariants still hold on the ledger (transactions add up to the Cash Flow tab, entry IDs unique)`, () => {
    for (const c of m.cashflow) { const s = E.spend(m.tx, E.window("month", c.month)); near(s.out, c.spending, 1); near(s.in, c.income, 1); }
    assert.equal(new Set(m.entries.map((e) => e.id)).size, m.entries.length);
    assert.ok(m.entries.every((e) => m.acctById[e.acct]), "every entry belongs to an account on the Accounts tab");
  });
}

test("signals derive from the model: everyday-only turns on nothing but contracts; property turns on the two property signals; the live sheet never turns on a beta row", () => {
  assert.deepEqual(E.signals(E.model(everyday)), { has_property: false, has_investment_property: false, has_shares: false, has_crypto: false, has_super: false, has_smsf: false, has_contracts: true, has_things: false });
  assert.deepEqual(E.signals(E.model(property)), { has_property: true, has_investment_property: true, has_shares: false, has_crypto: false, has_super: false, has_smsf: false, has_contracts: true, has_things: false });
  assert.deepEqual(E.signals(E.model(live)), { has_property: true, has_investment_property: true, has_shares: true, has_crypto: false, has_super: true, has_smsf: false, has_contracts: true, has_things: true });
});

test("model: entries carry Up's vocabulary and three kinds; contracts, decisions and rules are typed; beta fixtures stay beta", () => {
  const m = E.model(live);
  assert.equal(m.entries.length, 1082);
  assert.deepEqual(["transaction", "valuation", "trade"].map((k) => m.entries.filter((e) => e.kind === k).length), [925, 156, 1]);
  const t = m.entries.find((e) => e.id === "T0005");
  assert.equal(t.raw, "TRANSFER TO JAPAN 2027"); assert.equal(t.desc, "Internal transfer"); assert.equal(t.transferId, "X0001"); assert.equal(t.transferAcct, "ACC-HOL"); assert.equal(t.status, "settled"); assert.equal(t.created, "2025-07-02"); assert.equal(t.flow, "Transfer");
  const trade = m.entries.find((e) => e.kind === "trade"); assert.equal(trade.units, 25); assert.equal(trade.price, 48.2); near(trade.amount, 1205); assert.equal(trade.acct, "SHR-RSU");
  const v = m.entries.find((e) => e.id === "V0001"); assert.equal(v.acct, "HOME"); assert.equal(v.source, "appraisal"); assert.equal(v.amount, 1185000);
  assert.deepEqual(m.accounts.filter((a) => a.status === "beta").map((a) => a.id), ["CRYPTO", "SMSF", "DEV-LAPTOP", "SHR-RSU"]);
  assert.deepEqual(m.accounts.filter((a) => a.status === "active").map((a) => a.method), ["ledger", "ledger", "ledger", "ledger", "ledger", "ledger", "appraisal", "appraisal", "statement", "statement", "statement", "estimate", "statement", "statement"]);
  assert.equal(m.tx.length, 925); assert.equal(m.tx.find((x) => x.id === "T0005").transferId, "X0001");
  assert.equal(m.contracts.length, 20); assert.deepEqual([...new Set(m.contracts.map((c) => c.kind))], ["subscription", "insurance", "loan", "lease"]);
  const lease = m.contracts.find((c) => c.kind === "lease"); assert.equal(lease.acct, "RENTAL"); assert.equal(lease.amount, 2470); assert.equal(lease.next, "2027-02-05");
  const loan = m.contracts.find((c) => c.acct === "LN-HOME"); near(loan.rate, 0.0579, 0.00001); near(loan.amount, 3812.88, 0.01); assert.equal(loan.end, "2050-12-31");
  const refresh = m.decisions.find((d) => d.decision === "planned_refresh"); assert.equal(refresh.ref, "DEV-LAPTOP"); assert.equal(refresh.value, "2028-02-01");
  assert.equal(m.decisions.filter((d) => d.decision === "keep_or_cancel").length, 17);
  assert.equal(m.rules.length, 85); assert.equal(m.rules.find((r) => r.cat === "RENT-INT").property, "RENTAL");
  // the Net Worth tab is now derived from Balances and still says what 1.1 said
  const nw = m.networth[m.networth.length - 1]; near(m.metrics["networth.total"].num, nw.total, 1); near(nw.total, 1454481.87, 1);
});

test("balanceAt: nothing before the opening date, the anchor before the first valuation, then the last valuation carried forward; a ledger account is anchor plus entries", () => {
  const m = E.model(live); const home = m.acctById.HOME;
  assert.equal(E.balanceAt(home, "2025-06-29"), 0); assert.equal(E.balanceAt(home, "2025-06-30"), 1185000); assert.equal(E.balanceAt(home, "2025-07-31"), 1185000); assert.equal(E.balanceAt(home, "2025-08-15"), 1185000); assert.equal(E.balanceAt(home, "2025-08-31"), 1188000); assert.equal(E.balanceAt(home, "2027-01-31"), 1266000);
  near(E.balanceAt(m.acctById["ACC-EVD"], "2025-07-02"), 6200 - 398.2 - 3912.4 - 500 - 600, 0.01);
  near(E.balanceAt(m.acctById["LN-HOME"], "2026-06-30"), -599365.68, 0.01);
  assert.equal(E.balanceAt(m.acctById.CRYPTO, "2026-12-31"), 0); assert.equal(E.balanceAt(m.acctById.CRYPTO, "2027-01-31"), 1850.4);
});

test("a 1.1 snapshot still builds: transactions stand in as entries, no transfer ids, every signal off, each account reconciles to its Accounts row", () => {
  const m = E.model(load("data/snapshot.json"));
  assert.equal(m.sheetVersion, 1); assert.equal(m.entries.length, m.tx.length); assert.equal(E.transfers(m).orphans.length, 152);
  assert.ok(E.reconcile(m).every((r) => r.ok)); assert.ok(Object.values(E.signals(m)).every((v) => v === false));
});

test("connector grids for the ledger tabs read back the same model as the snapshot", () => {
  const money = (n) => (n == null ? "" : n < 0 ? `($${Math.abs(n).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})` : `$${n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  const dmy = (s) => (s && /^\d{4}-\d{2}-\d{2}$/.test(String(s)) ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : s == null ? "" : String(s));
  const H = {
    accounts: ["Account ID", "Account", "Institution", "Type", "Owner", "Opening balance ($)", "Opening date", "Balance at as-of date ($)", "Liquid", "Class", "Valuation method", "Currency", "Status", "Purpose", "Linked account", "Note"],
    entries: ["Entry ID", "Kind", "Settled at", "Account ID", "Raw text", "Description", "Amount", "Category ID", "Person", "Receipt held", "Note", "Status", "Created at", "Transfer ID", "Transfer account", "Foreign amount", "Foreign currency", "Units", "Unit price", "Source", "Flow"],
    balances: ["Month end", "Account ID", "Balance ($)", "Class", "Method", "Status"],
    contracts: ["Contract ID", "Kind", "Name", "Provider", "Owner", "Account ID", "Category ID", "Cadence", "Amount ($)", "Rate", "Start date", "End date", "Next date", "Last used", "Cover", "Status", "Note"],
    decisions: ["Decision ID", "Ref kind", "Ref ID", "Decision", "Value", "By", "At", "Note"],
    rules: ["Rule ID", "Pattern", "Match", "Merchant", "Category ID", "Person", "Tax label", "Property", "Source", "Note"],
  };
  const cell = (k, v) => { if (v == null) return ""; if (/date|_at$|month_end|^at$/.test(k)) return dmy(v); if (typeof v === "number") return /amount|balance|price|opening_balance|unit_price/.test(k) ? money(v) : k === "rate" ? `${(v * 100).toFixed(2)}%` : String(v); return String(v); };
  const g = {}; for (const [k, head] of Object.entries(H)) { const keys = head.map(E.key); g[k] = [head].concat(live[k].map((o) => keys.map((kk) => cell(kk, o[kk])))); }
  g.transactions = [["Txn ID", "Date", "Account ID", "Bank description", "Merchant", "Amount", "Category ID", "Person", "Receipt held", "Note"]].concat(live.transactions.map((t) => [t.txn_id, dmy(t.date), t.account_id, t.bank_description, t.merchant, money(t.amount), t.category_id, t.person, t.receipt_held || "", t.note || ""]));
  g.category_list = [["Category ID", "Category", "Group", "Flow", "Monthly budget ($)", "Essential", "Tax treatment", "ATO label"]].concat(live.category_list.map((c) => [c.category_id, c.category, c.group, c.flow, c.monthly_budget ? money(c.monthly_budget) : "-", c.essential || "", c.tax_treatment || "", c.ato_label || ""]));
  g.settings = [["Setting", "Value", "Note"]].concat(live.settings.map((s) => [s.setting, dmy(s.value), s.note || ""]));
  g.kitty = [["Key", "Value", "Note"]].concat(live.kitty.map((k) => [k.key, String(k.value), k.note || ""]));
  // clip each tab to the range the page really asks for: a short range silently drops columns the model needs
  const src = fs.readFileSync(path.join(__dirname, "src", "app.js"), "utf8"); const width = (c) => [...c].reduce((n, x) => n * 26 + x.charCodeAt(0) - 64, 0);
  for (const k of Object.keys(H)) { const r = src.match(new RegExp(`${k}: "[^!]+!A1:([A-Z]+)"`)); assert.ok(r, k); g[k] = g[k].map((row) => row.slice(0, width(r[1]))); }
  const m1 = E.model(live), m2 = E.model(E.fromConnector(g));
  assert.ok(E.reconcile(m2).filter((r) => r.account).every((r) => r.ok), "every account reconciles on a live read");
  assert.equal(m2.sheetVersion, 2); assert.equal(m2.entries.length, m1.entries.length); assert.equal(m2.balances.length, m1.balances.length); assert.equal(m2.contracts.length, m1.contracts.length); assert.equal(m2.rules.length, m1.rules.length);
  for (const a of m1.accounts) { const b = m2.acctById[a.id]; assert.ok(b, a.id); assert.equal(b.method, a.method); assert.equal(b.status, a.status); near(E.balanceAt(b, m2.asOf), E.balanceAt(a, m1.asOf), 0.01); }
  assert.deepEqual(E.signals(m2), E.signals(m1));
  assert.equal(E.transfers(m2).orphans.length, 0); assert.ok(E.invariants(m2).every((i) => i.ok), JSON.stringify(E.invariants(m2).filter((i) => !i.ok)));
  assert.equal(m2.decisions.find((d) => d.decision === "planned_refresh").value, "2028-02-01");
});

// ---------- phase B: the merchant dictionary, the row, the review queue, decisions ----------
const Kit = require("./src/kit/entry-row.js");
E.loadMerchants({ merchants: load("merchants/merchants.json"), categories: load("merchants/categories.json") });

test("normalise: card suffixes, store numbers, dates, amounts, state and city tokens, PTY LTD and AU go; the words stay", () => {
  const cases = {
    "WOOLWORTHS 3021 BRUNSWICK": "WOOLWORTHS BRUNSWICK", "WOOLWORTHS 3021 BRUNSWICK Card xx4471 Value Date: 14/10/2025": "WOOLWORTHS BRUNSWICK", "COLES 0457 COBURG VIC AU": "COLES COBURG",
    "UBER *EATS": "UBER EATS", "UBER* EATS MELBOURNE": "UBER EATS", "AMAZON MKTPLC AU SYDNEY SOUTH": "AMAZON MKTPLC", "MENULOG PTY LTD": "MENULOG", "APPLE.COM/BILL SYDNEY": "APPLE COM BILL",
    "OPENAI *CHATGPT SUBSCR USD 20.00": "OPENAI CHATGPT SUBSCR", "SPOTIFY P2F4A": "SPOTIFY", "AIRBNB * HMJK2Q": "AIRBNB", "BELONG MOBILE x2": "BELONG MOBILE", "KATHMANDU 118 MELBOURNE": "KATHMANDU",
    "JB HI-FI MELBOURNE CENTRAL": "JB HI FI", "BAYSIDE PROPERTY MGMT RENT JUL": "BAYSIDE PROPERTY MGMT RENT", "TRANSFER TO JAPAN 2027": "TRANSFER TO JAPAN", "7-ELEVEN 2231 COBURG": "SEVENELEVEN COBURG",
    "SQ *MARKET LANE": "SQ MARKET LANE", "PAYPAL *DIGITALRIVER": "PAYPAL DIGITALRIVER", "INTEREST CREDIT": "INTEREST CREDIT", "PURCHASE INTEREST CHARGED": "PURCHASE INTEREST CHARGED", "": "",
  };
  for (const [raw, want] of Object.entries(cases)) assert.equal(E.normalise(raw), want, raw);
});

test("dictionary: at least 150 Australian merchants with unique ids, real categories, hex hues and known icons; the longest pattern wins", () => {
  const D = E.dictionary(); const cats = new Set(live.category_list.map((c) => c.category_id)); const icons = new Set(Object.keys(load("brand/icons/icons.json").icons));
  assert.ok(D.merchants.length >= 150, `${D.merchants.length} merchants`);
  assert.equal(new Set(D.merchants.map((d) => d.id)).size, D.merchants.length, "ids unique");
  for (const d of D.merchants) { assert.ok(cats.has(d.category_id), `${d.id}: ${d.category_id}`); assert.match(d.hue, /^#[0-9A-Fa-f]{6}$/, d.id); assert.ok(["merchant", "transfer", "fee", "income", "government"].includes(d.kind), d.id); if (d.icon) assert.ok(icons.has(d.icon), `${d.id}: icon ${d.icon}`); assert.ok(d.patterns.length, d.id); }
  for (const c of live.category_list) assert.ok(icons.has(E.catIcon(c.category_id)), `${c.category_id} has a brand icon`);
  const m0 = { rules: [], merMemo: new Map(), ruleIndex: null };
  assert.equal(E.merchant("UBER *EATS", m0).name, "Uber Eats"); assert.equal(E.merchant("UBER TRIP HELP.UBER.COM", m0).name, "Uber");
  assert.equal(E.merchant("AMAZON PRIME AU", m0).name, "Amazon Prime"); assert.equal(E.merchant("AMAZON MKTPLC AU", m0).name, "Amazon");
  assert.equal(E.merchant("SHELL COLES EXPRESS 1234", m0).name, "Shell"); assert.equal(E.merchant("COLES 0457 COBURG", m0).name, "Coles");
  const sq = E.merchant("SQ *GOLDEN FLEECE BAKEHOUSE", m0); assert.equal(sq.unresolved, true); assert.equal(sq.name, "Golden Fleece Bakehouse"); assert.equal(sq.source, "fallback");
  assert.equal(E.merchant("GOOGLE*YOUTUBEPREMIUM", m0).name, "YouTube Premium"); assert.equal(E.merchant("WOOLWORTHS 3021 BRUNSWIC", m0).name, "Woolworths");
  assert.deepEqual(E.candidates("SQ *MARKET LANE").map((c) => c.id), ["square"]);
});

test("every historical row resolves: the sheet's Rules first (name and category as the sheet says), the dictionary alone misses at most 3%", () => {
  const m = E.model(live); const tx = m.entries.filter((e) => e.kind === "transaction");
  assert.equal(tx.length, 925);
  for (const e of tx) { assert.ok(e.mer && !e.mer.unresolved, `${e.id} ${e.raw}`); assert.equal(e.mer.source, "rule", e.raw); assert.equal(e.mer.name, e.desc, e.raw); }
  assert.equal(tx.filter((e) => e.mer.cat === e.cat).length, 924, "the rules carry the sheet's category (one refund row differs by design)");
  // a cut descriptor still finds its rule, a rule normalised the same way as the descriptor
  assert.equal(E.merchant("WOOLWORTHS 3021 BRUNSWIC", m).rule.id, "R0008"); assert.equal(E.merchant("HARBOUR BANK HOME LOAN R", m).rule.id, "R0003"); assert.equal(E.merchant("AIRBNB NOOSA", m).rule.id, "R0059"); assert.equal(E.merchant("AIRBNB * XYZ12", m).rule.id, "R0082");
  const d = E.model(Object.assign({}, live, { rules: [] })); const dt = d.entries.filter((e) => e.kind === "transaction");
  const miss = dt.filter((e) => e.mer.unresolved).length; assert.ok(miss / dt.length <= 0.03, `dictionary-only miss rate ${(miss / dt.length * 100).toFixed(1)}%`);
  assert.ok(dt.filter((e) => !e.mer.unresolved && e.mer.cat === e.cat).length >= 870, "the dictionary's category agrees with the sheet on most rows");
});

for (const [name, sn, expect] of [["fixture everyday-only", everyday, { uncategorised: 3, duplicate: 2 }], ["fixture everyday+property", property, { uncategorised: 3, duplicate: 2 }], ["live v2 snapshot", live, { uncategorised: 3, duplicate: 2 }]]) {
  test(`${name}: the review queue holds the sheet's three uncategorised rows and two possible doubles (two receipted Qantas fares are two tickets), nothing unpaired, nothing unknown`, () => {
    const m = E.model(sn); const rv = E.review(m);
    assert.deepEqual(rv.counts, { uncategorised: expect.uncategorised, unresolved: 0, duplicate: expect.duplicate, unpaired: 0, first_big: 0 });
    assert.deepEqual(rv.items.map((i) => i.id).sort(), ["T0413", "T0596", "T0687", "T0746", "T0761"]);
    assert.equal(rv.items.find((i) => i.id === "T0413").dupOf, "T0412");
    assert.equal(m.dupesExplained.get("T0858"), "T0857", "the Qantas pair is kept as explained, not dropped");
    const uncat = rv.items.find((i) => i.id === "T0761"); assert.deepEqual(uncat.reasons, ["uncategorised"]); assert.ok(/needs a category/.test(uncat.why));
    const af = m.entries.filter((e) => e.desc === "Anytime Fitness"); assert.ok(m.firstSeen.has(af[0].id) && af.slice(1).every((e) => !m.firstSeen.has(e.id)), "the first visit to a merchant is marked once");
  });
}

test("decisions overlay the model on read: a categorise moves the row, a merge or confirm clears it, a match pairs for review only; the transfer invariant is unchanged", () => {
  const dec = (id, decision, value, ref = "T0761") => ({ decision_id: id, ref_kind: "entry", ref_id: ref, decision, value, by: "test", at: "2026-11-04", note: null });
  const m = E.model(Object.assign({}, live, { decisions: live.decisions.concat([dec("D0101", "categorise", "DINING"), dec("D0102", "merge_duplicate", "T0857", "T0858"), dec("D0103", "confirm", "UNCAT", "T0746"), dec("D0104", "worth_it", "yes", "T0911"), dec("D0105", "split", "GROCERIES 60.00 | DINING 19.95", "T0687")]) }));
  const e = m.entryById.T0761; assert.equal(e.cat, "DINING"); assert.equal(e.flow, "Expense"); assert.equal(e.reviewed, true);
  assert.equal(m.tx.find((t) => t.id === "T0761").catName, "Dining and takeaway");
  assert.equal(m.entryById.T0858.dupOf, "T0857"); assert.equal(m.entryById.T0911.worth, "yes"); assert.deepEqual(m.entryById.T0687.split, [{ cat: "GROCERIES", amount: 60 }, { cat: "DINING", amount: 19.95 }]);
  const rv = E.review(m); assert.deepEqual(rv.items.map((i) => i.id).sort(), ["T0413", "T0596"]);
  // the same transfers, the same pairs, before and after the overlay
  const before = E.transfers(E.model(live)), after = E.transfers(m);
  assert.equal(after.pairs.length, before.pairs.length); assert.equal(after.orphans.length, 0); assert.equal(after.bad.length, 0);
  assert.ok(E.invariants(m).every((i) => i.ok));
  // a match_transfer decision marks both rows for the queue without touching the sheet's pairing
  const m2 = E.model(Object.assign({}, live, { decisions: live.decisions.concat([dec("D0106", "match_transfer", "T0747", "T0746")]) }));
  assert.equal(m2.entryById.T0746.matchedWith, "T0747"); assert.equal(E.transfers(m2).pairs.length, before.pairs.length);
  assert.ok(!E.review(m2).byId.has("T0746"));
  // a 1.1 snapshot still builds and reviews
  assert.ok(E.review(E.model(load("data/snapshot.json"))).items.length >= 0);
});

test("worth it: discretionary rows over the floor from the latest week that has any, at most five, answered rows drop out, the summary needs five answers", () => {
  const m = E.model(live); const w = E.worthCandidates(m);
  assert.ok(w.items.length >= 1 && w.items.length <= 5); assert.equal(w.floor, 40); assert.ok(w.from <= w.to && w.to <= m.asOf);
  for (const e of w.items) { assert.ok(E.discretionary(e, m)); assert.ok(Math.abs(e.amount) >= 40); assert.ok(!m.catById[e.cat].essential); }
  assert.ok(!w.items.some((e) => ["Housing", "Property", "Fees", "Transfers"].includes(m.catById[e.cat].group)));
  const answered = E.model(Object.assign({}, live, { decisions: live.decisions.concat(w.items.map((e, i) => ({ decision_id: `D02${i}`, ref_kind: "entry", ref_id: e.id, decision: "worth_it", value: i % 2 ? "no" : "yes", by: "t", at: "2026-11-04" }))), kitty: live.kitty.concat([{ key: "worth_it_min", value: 90 }]) }));
  assert.ok(!E.worthCandidates(answered).items.some((e) => w.items.some((x) => x.id === e.id)), "answered rows are not offered again");
  assert.equal(E.worthCandidates(answered).floor, 90);
  const ws = E.worthSummary(answered); assert.equal(ws.count, w.items.length); assert.equal(ws.yes + ws.no + ws.meh, w.items.length); assert.ok(ws.byCat.length >= 1);
});

test("EntryRow renders every kind: monogram letters in the brand hue, the category icon from the brand sprite, tabular amount with sign, badges that mean something, a trade and a valuation as rows", () => {
  const m = E.model(live); const rv = E.review(m); const ctx = Kit.context(m, { reviewIds: rv.byId, cookie: "<svg></svg>", sampleOn: true });
  const row = Kit.EntryRow(m.entryById.T0001, ctx, { date: true });
  assert.match(row, /class="mono[^"]*" style="--mh:#6E2C91"/); assert.match(row, /<b>AF<\/b>/); assert.match(row, /#i-fitness/); assert.match(row, /class="amt num ">−\$64\.95/); assert.match(row, /bdg recurring/); assert.match(row, /first time here/);
  const t5 = Kit.EntryRow(m.entryById.T0005, ctx); assert.match(t5, /bdg pair/); assert.match(t5, /Japan 2027 saver/); assert.match(t5, /amt num mv/);
  const trade = Kit.EntryRow(m.entries.find((e) => e.kind === "trade"), ctx); assert.match(trade, /25 units at \$48\.20/); assert.match(trade, /#i-shares/); assert.match(trade, /\+\$1,205/);
  const val = Kit.EntryRow(m.entryById.V0001, ctx); assert.match(val, /Family home, Brunswick/); assert.match(val, /value from an appraisal/); assert.match(val, /#i-property/); assert.match(val, /\$1,185,000/);
  const dup = Kit.EntryRow(m.entryById.T0413, ctx); assert.match(dup, /possible double/); assert.match(dup, /needs review/);
  assert.ok(!/possible double/.test(Kit.EntryRow(m.entryById.T0858, ctx)), "a receipted second fare is not a double");
  assert.match(Kit.EntryRow(m.entryById.T0925, ctx), /#i-/);
  const refund = m.entries.find((e) => /REFUND/.test(e.raw)); assert.match(Kit.EntryRow(refund, ctx), /bdg refund/);
  const list = Kit.EntryList(m.entries.slice(-40).reverse(), ctx); assert.ok((list.match(/class="dayg"/g) || []).length >= 2); assert.match(list, /class="day"/);
  const card = Kit.ReviewCard(rv.items.find((i) => i.id === "T0761"), ctx); assert.match(card, /data-ract="pick" data-cat="DINING"/); assert.match(card, /data-ract="cat"/); assert.match(card, /k-fortune/); assert.match(card, /SQ \*MARKET LANE/);
  const dcard = Kit.ReviewCard(rv.items.find((i) => i.id === "T0413"), ctx); assert.match(dcard, /data-ract="merge"/); assert.ok(!/k-fortune/.test(dcard), "a double has a rule, so no cookie");
  for (const e of m.entries.slice(0, 200)) assert.ok(!/undefined|NaN/.test(Kit.EntryRow(e, ctx)), e.id);
});

test("5,000 entries: the model builds and the list for the first screen renders fast in node (the browser number is in the PR)", () => {
  const snap = JSON.parse(JSON.stringify(live)); const tx = snap.entries.filter((e) => e.kind === "transaction"); const more = []; let n = 0;
  for (let k = 1; snap.entries.length + more.length < 5000; k++) for (const e of tx) { if (snap.entries.length + more.length >= 5000) break; n++; const c = { ...e, entry_id: `T${9000 + n}`, settled_at: E.addDays(e.settled_at, -7 * k), created_at: E.addDays(e.settled_at, -7 * k), transfer_id: e.transfer_id ? `${e.transfer_id}-${k}` : null }; more.push(c); }
  snap.entries = snap.entries.concat(more); snap.transactions = [];
  const t0 = Date.now(); const m = E.model(snap); const built = Date.now() - t0;
  assert.ok(m.entries.length >= 5000);
  const t1 = Date.now(); const rv = E.review(m); const ctx = Kit.context(m, { reviewIds: rv.byId }); const rows = m.entries.slice().reverse().filter((e) => e.kind === "transaction" && e.flow !== "Transfer").slice(0, 80); const html = Kit.EntryList(rows, ctx); const drew = Date.now() - t1;
  assert.ok(html.length > 10000); assert.ok(drew < 200, `${drew} ms to derive and render the first screen over ${m.entries.length} entries (model ${built} ms)`);
});

// ---------- phase C: widgets, signals, the canvas ----------
const W = require("./src/kit/widgets.js");
const shown = (sn, saved) => { const m = E.model(sn); const ws = W.eligible(m, E.signals(m)); return { m, ws, l: W.layout(ws, saved) }; };
test("manifests: unique ids, every required signal exists, declared sizes fit the twelve columns, every widget says where it drills", () => {
  const signals = E.signals(E.model(live)); const ids = W.WIDGETS.map((w) => w.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const w of W.WIDGETS) {
    assert.ok(w.domain && w.title && w.drill, w.id); assert.ok(w.sizes.length && w.sizes.every((s) => s.w >= 1 && s.w <= 12 && s.variant), w.id);
    for (const r of w.requires) assert.ok(r in signals, `${w.id} requires ${r}`);
    if (!w.core) { assert.equal(typeof w.data, "function", w.id); assert.equal(typeof w.render, "function", w.id); }
  }
});
test("everyday-only shows no property widget and no empty tile; everyday+property turns the property widget on", () => {
  const e = shown(everyday); const eIds = e.ws.map((w) => w.id);
  for (const id of ["property", "super", "shares", "crypto", "things"]) assert.ok(!eIds.includes(id), id);
  for (const w of e.ws) if (w.data) { const html = w.render(w.data(e.m), "half"); assert.ok(html.length > 40 && !/undefined|NaN/.test(html), `${w.id}: ${html}`); }
  const p = shown(property); assert.ok(p.ws.some((w) => w.id === "property")); assert.ok(p.l.added.includes("property"));
  const pw = W.widget("property"), data = pw.data(p.m);
  near(data.total, p.m.accounts.filter((a) => a.type === "Property" && a.status === "active").reduce((s, a) => s + a.balance, 0), 0.01);
});
test("beta accounts never turn a widget on, and a held widget's total equals the sheet's balances", () => {
  const { m, ws } = shown(live); assert.ok(!ws.some((w) => w.id === "crypto"), "CRYPTO is beta");
  near(W.widget("super").data(m).total, m.accounts.filter((a) => a.type === "Super" && a.status === "active").reduce((s, a) => s + a.balance, 0), 0.01);
  assert.ok(!W.widget("super").data(m).rows.some((r) => r.id === "SMSF"), "SMSF is beta");
});
test("a signal's widgets are added once: a first visit adds them, then they are seen; hiding sticks; a lost signal keeps its place", () => {
  const first = shown(live); assert.ok(first.l.added.length >= 3); assert.ok(first.l.items.some((i) => i.id === "property"));
  const saved = { items: first.l.items, hidden: [], seen: first.l.added };
  assert.deepEqual(shown(live, saved).l.added, []);
  const hid = { items: first.l.items, hidden: ["property"], seen: first.l.added };
  const after = shown(live, hid); assert.ok(!after.l.items.some((i) => i.id === "property")); assert.deepEqual(after.l.added, []); assert.deepEqual(after.l.hiddenOn, ["property"]);
  const fewer = shown(everyday, saved); assert.ok(!fewer.l.items.some((i) => i.id === "property"), "no signal, no tile");
  const undone = { items: first.l.items.filter((i) => !first.l.added.includes(i.id)), hidden: first.l.added, seen: first.l.added };
  assert.deepEqual(shown(live, undone).l.added, [], "the undo sticks");
});
test("resize is a variant, not a stretch; reorder swaps neighbours and stops at the ends", () => {
  const w = W.widget("upcoming"); assert.equal(W.snapWidth(w, 4).w, 5); assert.equal(W.snapWidth(w, 10).w, 12); assert.equal(W.variant(w, 12), "wide");
  const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.deepEqual(W.reorder(items, "b", -1).map((i) => i.id), ["b", "a", "c"]); assert.equal(W.reorder(items, "a", -1), items); assert.equal(W.reorder(items, "c", 1), items);
});

test("widgets: saving keeps what a lost signal took off the page, and never what was hidden", () => {
  const prior = [{ id: "hero", x: 0, y: 0, w: 12 }, { id: "property", x: 0, y: 1, w: 6 }, { id: "super", x: 6, y: 1, w: 6 }];
  const kept = W.keepAbsent([{ id: "hero", x: 0, y: 0, w: 12 }], prior, ["super"]);
  assert.deepEqual(kept.map((i) => i.id), ["hero", "property"]);
  assert.deepEqual(kept[1], prior[1]);
  assert.deepEqual(W.keepAbsent(kept, undefined, []).map((i) => i.id), ["hero", "property"]);
});

test("widgets: fill is drawing only, so narrowing two neighbours in turn puts them side by side", () => {
  const start = [{ id: "review", x: 0, y: 0, w: 12 }, { id: "needs", x: 0, y: 1, w: 12 }, { id: "goals", x: 0, y: 2, w: 12 }];
  const narrow = (items, id) => W.order(items.map((i) => (i.id === id ? { ...i, w: W.nextSize(W.widget(id), i.w) } : i)));
  const one = narrow(start, "review");
  assert.equal(one[0].w, 6); assert.equal(W.flow(one)[0].w, 12, "drawn full while alone"); assert.equal(one[0].w, 6, "flow does not touch what was asked for");
  const two = narrow(one, "needs");
  assert.deepEqual(W.flow(two).slice(0, 2).map((i) => [i.id, i.x, i.y, i.w]), [["review", 0, 0, 6], ["needs", 6, 0, 6]]);
});

// A connector with one real table in it: answers the read, records every write, and can change the session mid-read.
const connector = (payload, opts = {}) => {
  const writes = [], reads = []; let live = true;
  return { writes, reads, host: { sheet: "SHEET-A", current: () => live,
    call: async (tool, input, o) => { if (tool === "get_values") { reads.push({ input, o }); if (opts.switch) live = false; return { payload }; } writes.push(input); return { payload: {} }; } } };
};
const HEAD = ["Decision ID", "Ref kind", "Ref ID"];
const spec = (rows) => ({ tab: "Decisions", last: "H", header: HEAD, rows: rows || ((g) => [["D" + g.length, "entry", "T1"]]) });
const refused = async (c, code, s) => { await assert.rejects(E.appendRows(c.host, s || spec()), (e) => e.code === code); assert.equal(c.writes.length, 0, "nothing written"); };

test("appendRows: a row goes under the table as it is now, on the sheet the read came from, not where a stale page thinks", async () => {
  const c = connector({ range: "Decisions!A1:H500", values: [HEAD, ["D0019", "entry", "T0687"], ["D-phone", "entry", "T0761"]] });
  const placed = await E.appendRows(c.host, spec());
  assert.equal(placed.row, 4);
  assert.deepEqual(c.writes, [{ spreadsheetId: "SHEET-A", range: "Decisions!A4:H4", values: [["D3", "entry", "T1"]] }]);
  assert.equal(c.reads[0].input.range, "Decisions!A1:H"); assert.equal(c.reads[0].input.spreadsheetId, "SHEET-A"); assert.equal(c.reads[0].o.cache.refresh, true);
  const two = connector({ range: "'Decisions'!A1:H3", values: [HEAD] });
  await E.appendRows(two.host, spec(() => [["D1", "a", "b"], ["D2", "a", "b"]])); assert.equal(two.writes[0].range, "Decisions!A2:H3");
  const str = connector(JSON.stringify({ range: "Decisions!A1:H", values: [HEAD] })); await E.appendRows(str.host, spec()); assert.equal(str.writes[0].range, "Decisions!A2:H2");
});

test("appendRows: a filled row with no ID still counts, and a gap is never used", async () => {
  const c = connector({ range: "Decisions!A1:H", values: [HEAD, ["D1", "a", "b"], ["", "", "orphan"], ["D3", "a", "b"], ["", ""]] });
  assert.equal((await E.appendRows(c.host, spec())).row, 5);
  const noId = connector({ range: "Decisions!A1:H", values: [HEAD, ["", "entry", "T9"]] });
  assert.equal((await E.appendRows(noId.host, spec())).row, 3);
});

test("appendRows: anything it cannot trust stops with no write, and never reaches the header row", async () => {
  await refused(connector({ range: "Decisions!A1:H500" }), "invalid_response");            // no values at all: row 1 otherwise
  await refused(connector({ range: "Decisions!A1:H500", values: [] }), "invalid_ledger");   // empty table: row 1 otherwise
  await refused(connector({ range: "Rules!A1:H", values: [HEAD] }), "invalid_response");    // another tab answered
  await refused(connector({ range: "Decisions!A2:H", values: [HEAD] }), "invalid_response"); // the table's top is missing
  await refused(connector({ range: "Decisions!A1:H", values: [["Key", "Value"]] }), "invalid_ledger");
  await refused(connector({ range: "Decisions!A1:H", values: [HEAD, "row"] }), "invalid_response");
  await refused(connector("{not json"), "invalid_response"); await refused(connector(null), "invalid_response");
});

test("appendRows: a sheet switched during the read writes nothing", async () => {
  await refused(connector({ range: "Decisions!A1:H", values: [HEAD] }, { switch: true }), "stale_session");
});

// ---------- Records: the standard's generated view, drawn by src/kit/records.js ----------
const Records = require("./src/kit/records.js");
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/\s+/g, " ");
const held = (id, name) => ({ id, name, state: "held", count: 4 });
const fullView = () => ({
  generated: { as_of: "2027-03-31", files: 1124, events: 4656 },
  proof: {
    sections: [{ name: "lines recovered per month", exact: 675, checked: 675, pct: 100 }, { name: "net worth by month", exact: 0, checked: 16, pct: 0 }],
    laws: [
      { id: "L1", name: "Conservation", claim: "Every event's postings sum to zero.", status: "pass", counts: { pass: 1 }, worst: null },
      { id: "L2", name: "Clearing", claim: "Clearing returns to zero.", status: "fail", counts: { pass: 4, fail: 2 }, worst: "Open 2946 days." },
      { id: "L5", name: "Payslip", claim: "Payslips sum.", status: "gap", counts: { gap: 2 }, worst: "Payslips are missing." },
      { id: "L3", name: "Continuity", claim: "Balances chain.", status: "open", counts: { open: 1 }, worst: null },
      { id: "L7", name: "Holdings", claim: "Lots tie.", status: "skip", counts: { skip: 1 }, worst: null },
    ],
  },
  years: [
    { fy: "FY2025", people: [
      { person: "JORDAN", name: "Jordan", status: "lodged", readiness: { pct: 100, steps: [held("income", "Income statements"), held("lodged", "Lodged and assessed")] },
        lodged: { version: 2, taxable_income_cents: 14523000, result_cents: -84500, assessed_on: "2025-09-12" }, derived: { taxable_income_cents: 14535300, result_cents: -60100 },
        tie: { status: "fail", gap: 12300, detail: "Derived taxable income differs from the assessment." },
        items: [{ label: "1", amount_cents: 15200000, method: "annual tax statement", evidence: "held" }, { label: "D5", amount_cents: null, method: "work log", evidence: "at_risk" }] },
      { person: "MIA", name: "Mia", status: "open", readiness: { pct: 60, steps: [held("income", "Income statements"), { id: "rental", name: "Rental statements", state: "missing", count: 0 }] }, lodged: null, derived: null, tie: null, items: [] },
    ] },
    { fy: "FY2026", people: [{ person: "JORDAN", name: "Jordan", status: "open", readiness: { pct: 0, steps: [{ id: "income", name: "Income statements", state: "missing", count: 0 }] }, lodged: null, derived: null, tie: null, items: [] }] },
  ],
  coverage: [{ stream: "ACC-EVD", name: "Everyday export", expected: 97, have: 97, missing: [] }, { stream: "ACC-OFF", name: "Offset export", expected: 97, have: 93, missing: ["2026-08", "2026-11"] }],
  things: [{ asset_id: "CAR", kind: "vehicle", name: "Family car", refresh_by: "2028-02-01", replacement_cost_cents: 3800000, warranty_until: "2027-06-30", fy: "FY2028" }, { asset_id: "FRG", kind: "appliance", name: "Fridge", refresh_by: null, replacement_cost_cents: null, warranty_until: "2029-01-31", fy: null }],
  traces: [{ kind: "wage_receipt", date: "2027-03-25", description: "SALARY <NORTHWIND>", amount_cents: 392562, grade: "corroborated", postings: [{ target: "ACC-EVD", amount_cents: 392562 }, { target: "clearing:payroll:NORTHWIND", amount_cents: -392562 }], witnesses: [{ role: "clears", kind: "txn_line", locator: "line 10", file: "Harbour-2027-03.csv", sha256: "db8ef6837d69" }] }],
  experimental: [
    { id: "collect", title: "Collect statements", button: "Start computer use", status: "Mock", today: "Nothing is fetched yet.", open: ["Which browser and whose session"] },
    { id: "tax_pack", title: "Tax pack", button: "Download tax pack", status: "Baseline", today: "A real file.", open: [] },
    { id: "advice", title: "Tax return check", button: "Run tax return advice", status: "Mock", today: "A model's reading is not wired.", open: ["Connect a tax capability"] },
    { id: "reconcile", title: "Reconciliation", button: "Run reconciliation", status: "Baseline", today: "Every law.", open: [] },
  ],
});
const clean = (html) => { assert.ok(!/undefined|NaN|\bnull\b|\[object |\$0(\.00)?(?![\d.,])|—/.test(text(html)), text(html)); };

test("Records: a full view says what it is, and names the preview and its limit", () => {
  const out = text(Records.Records(fullView()));
  assert.match(out, /A separate dataset/); assert.match(out, /Its numbers will not match the other tabs\./);
  assert.match(out, /A record rebuilt from a fictional household's files: 1,124 files and 4,656 events, up to 31 Mar 2027\./);
  assert.match(out, /It is not read from the sheet\./);
  for (const name of ["This year", "How we know", "Where a number comes from", "When things need replacing", "What's missing", "Experimental"]) assert.ok(out.includes(name), name);
  clean(Records.Records(fullView()));
});

test("Records: a lodged year calls the lodged figure the record, with the derived figure and the tie's own gap", () => {
  const out = text(Records.RecordsYear(fullView(), "FY2025"));
  assert.match(out, /Lodged From the rows Difference/);
  assert.match(out, /Taxable income \$145,230 \$145,353 \+\$123\.00/);
  assert.match(out, /Result \$845\.00 to pay \$601\.00 to pay/);
  assert.match(out, /The lodged figure is the record/);
  assert.match(out, /Salary or wages, item 1 \$152,000\.00 annual tax statement Held/);
  assert.match(out, /Other work expenses, D5 not held yet work log At risk/);
  assert.match(out, /Rental statements Yet to go/);
  assert.ok(!/advice/i.test(out));
});

test("Records: a year with nothing held shows no zero percent", () => {
  const out = text(Records.RecordsYear(fullView(), "FY2026"));
  assert.match(out, /Jordan Not held yet/); assert.ok(!/0%/.test(out));
});

test("Records: the year defaults to the latest with real data, and a picked year wins", () => {
  const v = fullView();
  assert.equal(Records.recordsYear(v).fy, "FY2025");       // FY2026 holds nothing
  assert.equal(Records.recordsYear(v, "FY2026").fy, "FY2026");
  assert.equal(Records.recordsYear(v, "FY1999").fy, "FY2025");
  assert.equal(Records.recordsYear({ years: [{ fy: "FY2026" }, { fy: "FY2027" }] }).fy, "FY2027");
  assert.equal(Records.recordsYear({}), null);
});

test("Records: a gap and a fail differ in word, shape and meaning, and the laws run worst first", () => {
  const html = Records.Records(fullView()), out = text(html);
  assert.match(out, /Fail Evidence contradicts evidence\./); assert.match(out, /Gap Evidence is missing\./);
  for (const s of ["fail", "gap", "open", "pass", "skip"]) assert.ok(html.includes(`rec-stat ${s}`), s);
  assert.deepEqual(Records.lawsInOrder(fullView()).map((l) => l.status), ["fail", "gap", "open", "pass", "skip"]);
  const v = fullView(), gap = text(Records.RecordLaw(Records.recordLaw(v, "L5"))), fail = text(Records.RecordLaw(Records.recordLaw(v, "L2")));
  assert.match(gap, /Payslips sum\./); assert.match(gap, /Evidence is missing\./); assert.match(gap, /Worst detail Payslips are missing\./);
  assert.match(fail, /Evidence contradicts evidence\./); assert.match(fail, /Open 2946 days\./); assert.match(fail, /2 fail, 4 pass/);
});

test("Records: a trace runs from the number to the exact line of the exact file, escaped", () => {
  const v = fullView(), row = Records.Records(v), drawer = Records.RecordTrace(v.traces[0], v), out = text(drawer);
  assert.ok(row.includes('data-open="trace:0"')); assert.ok(row.includes("Harbour-2027-03.csv")); assert.ok(row.includes("line 10"));
  assert.ok(drawer.includes("SALARY &lt;NORTHWIND&gt;")); assert.ok(!drawer.includes("<NORTHWIND>"));
  assert.match(out, /\$3,925\.62/); assert.match(out, /ACC-EVD \+\$3,925\.62/); assert.match(out, /clearing:payroll:NORTHWIND −\$3,925\.62/);
  assert.match(out, /Pass Each event's money in and money out add to zero\./);
  assert.match(out, /Harbour-2027-03\.csv line 10 Bank line Settles this event File fingerprint SHA-256 db8ef6837d69/);
  assert.ok(!/witness|postings|oracle/i.test(text(Records.Records(v)) + out), "no engine words");
});

test("Records: things and coverage read as held, with absent facts left out or named", () => {
  const out = text(Records.Records(fullView()));
  assert.match(out, /Family car Due 1 Feb 2028 · Warranty until 30 Jun 2027 · Vehicle \$38,000/);
  assert.match(out, /Fridge Warranty until 31 Jan 2029 · Appliance Cost not held yet/);
  assert.match(out, /Offset export Missing August 2026, November 2026 93 of 97 1 more, nothing missing Everyday export 97 of 97/);   // what is short comes first
});

test("Records: the public page shows only the experimental actions that work today, with no builders' open questions", () => {
  const v = fullView(), html = Records.Records(v), xp = html.slice(html.indexOf("rec-xpwrap"));
  assert.equal(xp.match(/rec-pill">Experimental/g).length, 2);
  for (const a of v.experimental) assert.equal(xp.includes(`data-open="xp:${a.id}"`), a.status !== "Mock", a.id);
  assert.equal(Records.recordAction(v, "collect"), null); assert.equal(Records.recordAction(v, "advice"), null);
  assert.ok(!/Which browser|Connect a tax capability|Open questions/.test(text(html)));
  // a mock handed in directly still says it is one, and carries no open questions
  const collect = text(Records.RecordAction(v.experimental[0], v)); assert.match(collect, /This is a mock\. Start computer use runs nothing/); assert.ok(!/Which browser/.test(collect));
  const pack = Records.RecordAction(Records.recordAction(v, "tax_pack"), v, { fy: "FY2025", canSave: true });
  assert.ok(pack.includes('data-pack="JORDAN"') && pack.includes('data-pack="MIA"')); assert.ok(!/This is a mock/.test(pack));
  assert.match(text(Records.RecordAction(Records.recordAction(v, "tax_pack"), v, { fy: "FY2025", canSave: false })), /Saving a file is not available in this view/);
  assert.match(text(Records.RecordAction(Records.recordAction(v, "reconcile"), v)), /Nothing left waiting Open 2946 days\. Fail Payslips add up Payslips are missing\. Gap/);
});

test("Records: the tax pack is one person's year as CSV, and an absent amount stays blank", () => {
  const v = fullView(), pack = Records.taxPack(v, "FY2025", "JORDAN"), lines = pack.csv.split("\n");
  assert.equal(pack.filename, "kitty-tax-pack-FY2025-jordan.csv");
  assert.equal(lines[0], "Year,Person,Section,Line,State,Amount,Method");
  assert.ok(lines.includes("FY2025,Jordan,Readiness,Income statements,Held,,"));
  assert.ok(lines.includes("FY2025,Jordan,The record,Taxable income,Lodged,145230.00,"));
  assert.ok(lines.includes('FY2025,Jordan,Tax item,"Salary or wages, item 1",Held,152000.00,annual tax statement'));
  assert.ok(lines.includes('FY2025,Jordan,Tax item,"Other work expenses, D5",At risk,,work log'));
  assert.ok(lines.some((l) => /fictional Davies household/.test(l)));
  assert.equal(Records.taxPack(v, "FY2025", "NOBODY"), null); assert.equal(Records.taxPack({}, "FY2025", "JORDAN"), null);
});

test("Records: an empty view keeps the preview line, says not held yet, and draws no zero", () => {
  const html = Records.Records({}), out = text(html); clean(html);
  assert.match(out, /A record rebuilt from a fictional household's files\./); assert.match(out, /A separate dataset/); assert.match(out, /Davies sheet/);
  for (const what of ["This year is", "Proof is", "Examples are", "Things are", "Coverage is"]) assert.ok(out.includes(`${what} not held yet.`), what);
  assert.ok(!html.includes("recfy"));
  assert.equal(Records.taxPack({}, null, "JORDAN"), null);
});

test("Records: no view at all says the record is not available in this edition", () => {
  for (const v of [null, undefined, "nope"]) assert.match(text(Records.Records(v)), /The record is not available in this edition\./);
});

test("Records: a view with missing or half-filled years never crashes and never invents a number", () => {
  for (const years of [undefined, null, [], "x", [null], [{}], [{ fy: "FY2026" }], [{ fy: "FY2026", people: null }], [{ fy: "FY2026", people: [null, {}] }]]) { const html = Records.Records({ years }); clean(html); clean(Records.RecordsYear({ years }, "FY2026")); }
  const half = { years: [{ fy: "FY2027", people: [{ person: "A", readiness: { steps: [{ id: "income" }] }, lodged: {}, derived: {}, tie: {}, items: [{}, null] }] }], proof: { sections: [{}], laws: [{ id: "L1" }, {}] }, traces: [{}], things: [{}], coverage: [{}], experimental: [{ id: "tax_pack" }, { id: "x", status: "Mock" }] };
  const html = Records.Records(half); clean(html);
  assert.match(text(html), /Income Yet to go/);
  clean(Records.RecordTrace(half.traces[0], half)); clean(Records.RecordLaw(half.proof.laws[0]));
  for (const a of half.experimental) clean(Records.RecordAction(a, half, { canSave: true }));
  assert.ok(!Records.taxPack(half, "FY2027", "A").csv.includes("undefined"));
});

test("Records: the generated view draws clean, every year and every trace", () => {
  const v = load("data/standard-view.json"), html = Records.Records(v); clean(html);
  for (const key of ["generated", "proof", "years", "coverage", "things", "traces", "experimental"]) assert.ok(key in v, key);
  for (const y of v.years) clean(Records.RecordsYear(v, y.fy));
  for (const t of v.traces) clean(Records.RecordTrace(t, v));
  // PAYG and SG are not return labels, 21X is never printed, and a category ID reads as its name
  const names = { "RENT-INC": "Rent received", "RENT-INT": "Investment loan interest" }, catName = (id) => names[id] || "Rental costs";
  const all = v.years.map((y) => text(Records.RecordsYear(v, y.fy, { catName }))).join(" ");
  assert.ok(!/RENT-[A-Z]+/.test(v.years.map((y) => text(Records.RecordsYear(v, y.fy))).join(" ")), "no category ID even without names");
  assert.ok(!/Label (PAYG|SG)|21X|RENT-[A-Z]+/.test(all)); assert.match(all, /Tax withheld \(not a return label\)/); assert.match(all, /Other rental deductions, item 21 /);
  const named = text(Records.Records(v, { catName: (id) => ({ "RENT-MGMT": "Property management fees" }[id] || id) }));
  assert.ok(named.includes("Property management fees"));
});

// ---------- the public page audit (8 November 2026): each engine fix, on the Davies ledger ----------
test("safety net: the Emergency fund goal over essential spending (the sheet's own metric), never all cash and offset", () => {
  const m = E.model(live), sf = E.safety(m);
  const ess = E.spend(m.tx, E.window("quarter", m.asOf), (t) => (m.catById[t.cat] || {}).essential).out / 3;
  near(sf.essentialPm, ess, 0.01); near(sf.essentialPm, 7344.91, 0.01);
  near(sf.months, m.metrics["emergency.months_covered"].num, 1e-9);
  near(sf.months * sf.essentialPm, m.goals.find((g) => g.name === "Emergency fund").balance, 1);
  assert.equal(sf.fund, "Emergency fund"); near(sf.held, 26902.84, 0.01);
  near(sf.short, (6 - sf.months) * sf.essentialPm, 0.01); near(sf.short, 17166.60, 0.05);
  assert.ok(sf.liquidMonths > 13 && sf.liquidMonths < 14, "cash and offset together cover far more than the fund alone");
  assert.ok(sf.essentialPm < m.metrics["cashflow.spending.3m_avg"].num, "essential spending is less than all spending");
});

test("subscriptions: a premium adjustment is not a price, a refund is not a charge, and a travel policy is not the car policy", () => {
  const m = E.model(live), by = (n) => m.subs.find((s) => s.service === n);
  const bupa = by("Bupa health cover");
  near(bupa.lowest, 398.2); near(bupa.latest, 419.35); near(bupa.riseEach, 21.15); near(bupa.riseYear, 253.8); assert.equal(bupa.riseCheck, false);
  assert.equal(bupa.sheet.lowest, 31.2, "the sheet's figure is kept beside the page's"); assert.ok(bupa.adjustments.some((a) => a.amount === 31.2));
  const pp = by("Paramount+");
  near(pp.latest, 9.99); assert.equal(pp.lastCharged, "2027-01-19"); assert.equal(pp.refundedOn, "2027-01-24"); near(pp.annual, 119.88);
  assert.ok(m.subs.every((s) => !(s.annual < 0) && !(s.latest < 0)), "no negative charge or annual cost anywhere");
  const car = by("Car insurance");
  near(car.latest, 1348); assert.equal(car.lastCharged, "2026-08-14"); near(car.annual, 1348);
  const c11 = m.contracts.find((c) => c.name === "Car insurance"); near(c11.amount, 1348); assert.equal(c11.next, "2027-08-14"); assert.equal(c11.sheet.next, "2028-01-15");
  const ctx = Kit.context(m), travel = m.entryById.T0903;
  assert.equal(Kit.contractFor(travel, ctx), null, "ALLIANZ TRAVEL INSURANCE under Holidays matches no contract");
  assert.equal(Kit.contractFor(m.entryById.T0654, ctx).name, "Car insurance");
  // a jump of more than half is a question, not a saving
  const jumped = E.model(Object.assign({}, live, { transactions: live.transactions.map((t) => (t.txn_id === "T0850" || /PREMIUM ADJ/.test(t.bank_description) ? { ...t, bank_description: "BUPA HEALTH INSURANCE" } : t)) }));
  const b2 = jumped.subs.find((s) => s.service === "Bupa health cover"); assert.equal(b2.riseCheck, true); assert.equal(b2.riseYear, 0);
  assert.ok(E.leaks(jumped).jumps.includes(b2) && !E.leaks(jumped).rises.includes(b2));
});

test("savings ideas: rebuilt from the checked rows, ranked by dollars, and the headline is their sum", () => {
  const m = E.model(live), by = (re) => m.savings.find((s) => re.test(s.title)), lk = E.leaks(m);
  near(by(/price rise/i).amount, 313.8); assert.equal(by(/price rise/i).sheet.amount, 4717.8);
  assert.match(by(/price rise/i).shows, /Bupa health cover \$398\.20 to \$419\.35/);
  near(by(/unused subscription/i).amount, 1349.16); near(by(/unused subscription/i).amount, lk.unusedYear + lk.stillYear);
  near(lk.unusedYear, 1229.28); near(lk.stillYear, 119.88);
  const d = by(/doubled/i); near(d.amount, 295.8); assert.equal(d.title, "Check charges that look doubled"); assert.equal(d.sheet.amount, 2713.8);
  assert.ok(m.savings.every((s, i) => i === 0 || m.savings[i - 1].amount >= s.amount), "largest first");
  near(m.savingsYear, m.savings.filter((s) => s.type === "Recurring").reduce((a, s) => a + s.amount, 0)); near(m.savingsYear, 7719.92, 0.01);
  near(m.savingsOnce, 295.8);
});

test("duplicates: a same-day pair where each row holds a receipt or a note is two purchases; the check counts only the rest", () => {
  const m = E.model(live);
  assert.ok(!m.dupes.has("T0858")); assert.equal(m.dupesExplained.get("T0858"), "T0857");
  const dc = m.checks.find((c) => /^Possible duplicate charges/.test(c.name));
  assert.equal(dc.items, 2); near(dc.amount, 295.8); assert.deepEqual(dc.sheet, { items: 3, amount: 2713.8, status: "Review" });
  assert.equal(dc.explained.length, 1); assert.equal(dc.explained[0].b.id, "T0858");
  // a pair with one receipt and no notes is still a suspect
  const one = E.model(Object.assign({}, live, { entries: live.entries.map((e) => (e.entry_id === "T0858" ? { ...e, receipt_held: null, note: null } : e)) }));
  assert.equal(one.dupes.get("T0858"), "T0857");
  assert.ok(E.review(m).items.every((i) => !/\b[TDR]\d{4}\b/.test(i.why)), "the reason names no internal ID");
});

test("needs: most serious first; a passed target date asks for no monthly amount; five distinct tax claims; the review queue is one need", () => {
  const m = E.model(live), nd = E.needs(m);
  assert.ok(nd.all.every((x, i) => i === 0 || nd.all[i - 1].rank <= x.rank));
  const fund = nd.all[0]; assert.match(fund.t, /^Emergency fund passed its Dec 2026 target date$/); assert.equal(fund.amtNote, "to go"); near(fund.amt, 3097.16);
  assert.match(fund.s, /Jun 2027/); assert.ok(!/a month until/.test(fund.s));
  assert.equal(E.goalState(m.goals[0], m.asOf).passed, true);
  const tax = nd.all.find((i) => /tax claim/.test(i.t)); assert.equal(tax.t, "Five tax claims to check before lodging");
  assert.equal(E.taxClaims(m).rows.length, 5, "the laptop is one claim, not two");
  assert.ok(nd.all.findIndex((i) => /Paramount/.test(i.t)) > 3, "a $120 leak is not in the first four");
  assert.equal(nd.all.filter((i) => i.go === "review").length, 1);
  assert.equal(nd.all.filter((i) => /safety|emergency fund covers/i.test(i.t)).length, 0, "the fund's months ride on its goal line, not a second need");
  assert.ok(!nd.all.some((i) => /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{2}\b(?!\d)/.test(i.t + i.s)), "no Mon YY date");
});

test("formats: a month reads Jun 2027, never Jun 27; millions keep two decimals; lists keep cents", () => {
  assert.equal(E.fmtMonth("2027-06-01", true), "Jun 2027"); assert.equal(E.fmtMonth("2027-06-01"), "June 2027");
  assert.equal(E.fmtS(1454481.87), "$1.45m"); assert.equal(E.fmtS(2037000), "$2.04m"); assert.equal(E.fmtS(1100000), "$1.1m"); assert.equal(E.fmtS(354433.82), "$354k"); assert.equal(E.fmtS(26902.84), "$26.9k");
  const m = E.model(live), ctx = Kit.context(m);
  assert.match(Kit.EntryRow(m.entryById.T0857, ctx), /−\$2,418\.00/);
  assert.match(Kit.EntryRow(m.entryById.T0297, ctx, { date: true }), /5 Jan 2026/, "a date outside the as-of year carries its year");
});

test("the rental: a repair at the review amount is a one-off line, not a monthly running cost", () => {
  const m = E.model(live), p = E.property(m);
  near(p.oneOffTotal, 12800); assert.equal(p.oneOffs[0].id, "T0518");
  near(p.byCat.find((c) => c.cat === "RENT-REPAIR").pm, 2150 / 12, 0.01);
  near(E.owed(m), 1111715.18); near(E.ownership(m).reduce((a, x) => a + x.v, 0) - E.owed(m), m.networth[m.networth.length - 1].total, 1);
});
