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
  const m1 = E.model(live), m2 = E.model(E.fromConnector(g));
  assert.equal(m2.sheetVersion, 2); assert.equal(m2.entries.length, m1.entries.length); assert.equal(m2.balances.length, m1.balances.length); assert.equal(m2.contracts.length, m1.contracts.length); assert.equal(m2.rules.length, m1.rules.length);
  for (const a of m1.accounts) { const b = m2.acctById[a.id]; assert.ok(b, a.id); assert.equal(b.method, a.method); assert.equal(b.status, a.status); near(E.balanceAt(b, m2.asOf), E.balanceAt(a, m1.asOf), 0.01); }
  assert.deepEqual(E.signals(m2), E.signals(m1));
  assert.equal(E.transfers(m2).orphans.length, 0); assert.ok(E.invariants(m2).every((i) => i.ok), JSON.stringify(E.invariants(m2).filter((i) => !i.ok)));
  assert.equal(m2.decisions.find((d) => d.decision === "planned_refresh").value, "2028-02-01");
});
