#!/usr/bin/env node
/* Scores the engine on the third household it has never seen. Builds the Haddad-Whitlocks, ingests their files, rebuilds with only their onboarding setup and the public dictionary and
   recipes, and compares every number with the simulation's truth. No decisions, no rules. Nothing here adjusts anything to improve a score. Report shape from the two earlier held-out folders.

   node standard/eval/heldout3/run.js        prints the table and writes RESULT.md beside this file. BLIND-3.md is the first run, kept as written */
"use strict";
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const STD = path.join(__dirname, "..", "..");
const { build, OUT, SETUP_DIR } = require("./build");
const { ingest, loadRecipes } = require("../../intake");
const { rebuild } = require("../../engine/rebuild");
const Engine = require("../../../src/engine.js");

const CARD = "ACC-CARD";
const read = (p, d) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return d; } };
const money = (c) => (c == null ? "n/a" : `${c < 0 ? "-" : ""}${(Math.abs(c) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`);
const days = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 864e5;

function loadSetup() { const out = {}; for (const f of fs.readdirSync(SETUP_DIR)) if (f.endsWith(".json")) out[f.replace(".json", "")] = read(path.join(SETUP_DIR, f), []); return out; }

function run() {
  const built = build();
  Engine.loadMerchants({ merchants: read(path.join(STD, "..", "merchants", "merchants.json")), categories: read(path.join(STD, "..", "merchants", "categories.json")) });
  const manifest = read(path.join(OUT, "manifest.json")), truth = read(path.join(OUT, "truth.json")), recipes = loadRecipes(path.join(STD, "recipes"));
  const intake = ingest({ root: OUT, recipes, manifest });
  const schema = { events: read(path.join(STD, "schema", "events.json")), metrics: read(path.join(STD, "schema", "metrics.json")) };
  const reference = read(path.join(STD, "reference", "au.json"), null);
  const receipts = (intake.files || []).map((f) => { const parts = f.path.split("/"); return { stream_id: parts[1], day: parts[2] }; });
  const once = (setup, rules = []) => rebuild({ setup, sources: intake.sources, observations: intake.observations, decisions: [], rules, schema, reference, receipts });
  const setup = loadSetup(); let L;
  const where = (e) => String(e.stack).split("\n").filter((x) => /engine\//.test(x)).map((x) => x.trim().replace(/^.*standard\//, "standard/").replace(/\)$/, ""));
  try { L = once(setup); } catch (e) { console.log(JSON.stringify({ crash: e.message, at: where(e).slice(0, 4) }, null, 1)); console.log(String(e.stack).split("\n").slice(0, 12).join("\n")); process.exit(1); }
  return { L, truth, intake, manifest, setup, crash: null, built, again: (rules) => once(setup, rules) };
}

// ---------- reading the engine's output ----------
function Reader(L, setup) {
  const cats = new Map(L.categories.map((c) => [c.category_id, c])), bal = {};
  for (const r of L.balances.rows) { const a = (bal[r.account_id] = bal[r.account_id] || {}); a[r.month_end.slice(0, 7)] = r.balance_cents; }
  const events = new Map();
  for (const e of L.events) {
    for (const p of e.postings || []) { if (!p.account_id) continue; const k = `${p.account_id}|${p.amount_cents}`; if (!events.has(k)) events.set(k, []); events.get(k).push(e); }
    // A transfer can book a line in two parts, the transfer and the fee inside it. The line is still found by its own amount.
    for (const l of e.lines || []) { const k = `${l.account}|${l.cents}`; if (!(events.get(k) || []).includes(e)) { if (!events.has(k)) events.set(k, []); events.get(k).push(e); } }
  }
  const cashAcct = new Set(L.accounts.filter((a) => a.reporting_group === "cash").map((a) => a.account_id));
  // what the cash lens does with an event: an entry that nets to nothing across cash accounts is a wash whatever its category
  const treat = (ev) => {
    const c = cats.get(ev.category_id); if (!c || ev.unexplained) return "neither";
    if ((ev.postings || []).filter((p) => cashAcct.has(p.account_id)).reduce((t, p) => t + p.amount_cents, 0) === 0) return "neither";
    if (c.kind === "income" && c.cash_lens) return "income"; if ((c.kind === "expense" || c.kind === "suspense") && c.cash_lens) return "spending"; return "neither";
  };
  // the dates an engine leg can carry for one account
  const datesOf = (e, account) => [(e.leg_dates && e.leg_dates[account]), e.occurred_on, e.charged_on].filter(Boolean);
  const gapTo = (e, account, date, post) => Math.min(...datesOf(e, account).flatMap((d) => [days(d, date), post ? days(d, post) : Infinity]));
  const find = (account, date, cents, wide, post) => { const w = wide != null ? wide : account === CARD ? 1 : 0; return (events.get(`${account}|${cents}`) || []).filter((e) => gapTo(e, account, date, post) <= w); };
  const asked = (account, date, cents, post) => { const w = account === CARD ? 3 : 0; return L.review.filter((r) => { const p = String(r.ref).split("|"); return p[0] === account && p[1] && /^\d{4}-/.test(p[1]) && Math.min(days(p[1], date), post ? days(p[1], post) : Infinity) <= w && Number(p[2]) === cents; }); };
  // a doubled line is only asked about when the question is whether it is doubled; a question about the merchant does not put the double in front of anyone
  const askedDup = (account, date, cents, post) => L.review.filter((r) => { if (r.kind !== "possible_duplicate") return false; const p = String(r.ref).split("|"); return p[0] === account && Math.abs(Number(p[2]) - cents) <= 300 && Math.min(days(p[1], date), post ? days(p[1], post) : Infinity) <= 9; });
  // review items that name a statement, an assessment or a trade rather than a line
  const askedOther = (x, found) => L.review.filter((r) => {
    const what = String(r.what || "");
    if (r.kind === "owner_statement_unmatched") { const m = /Owner statement (\d{4}-\d{2}-\d{2})/.exec(what); if (!m) return false; const gap = (Date.parse(x.date) - Date.parse(m[1])) / 864e5; return x.account === "ACC-SAVER" && ((gap >= 0 && gap <= 14) || (x.date.slice(0, 7) === m[1].slice(0, 7) && Math.abs(x.cents) !== Math.abs(r.amount_cents))); }
    if (r.kind === "restated_line") { const q = String(r.ref).split("|"); return q[0] === x.account && what.includes(money(Math.abs(x.cents))) && days(q[1], x.date) <= 14; }
    if (r.kind === "tax_result_unmatched") return found.some((e) => /\bATO\b/.test(e.description || ""));
    if (r.kind === "trade_unsettled") { const m = /on (\d{4}-\d{2}-\d{2}) has no (?:cash )?line in (\S+?)\.?$/.exec(what); if (!m) return false; const gap = (Date.parse(x.date) - Date.parse(m[1])) / 864e5; return m[2] === x.account && gap >= -2 && gap <= 14; }
    return false;
  });
  const balance = (a, m) => (bal[a] && bal[a][m] != null ? bal[a][m] : 0);
  const held = (a) => (bal[a] ? Object.keys(bal[a]) : []);
  return { treat, find, asked, askedDup, askedOther, balance, held, cats, setup, cashAcct, datesOf };
}

function scoreTable(L, truth, R) {
  const months = Object.keys(truth.income), accounts = Object.keys(truth.balances), rows = [];
  const num = (list, key) => new Map(list.map((x) => [x.month, x[key]]));
  const series = (name, want, got) => {
    let exact = 0, abs = 0, sumW = 0, sumG = 0, worst = null;
    for (const m of months) { const w = want[m], g = got(m) || 0, d = g - w; sumW += w; sumG += g; abs += Math.abs(d); if (d === 0) exact += 1; if (!worst || Math.abs(d) > Math.abs(worst.d)) worst = { m, d }; }
    rows.push({ name, exact, of: months.length, mae: Math.round(abs / months.length), truth_total: sumW, engine_total: sumG, worst });
  };
  const inc = num(L.cash, "income"), sp = num(L.cash, "spending"), nw = num(L.netWorth, "total");
  series("Cash income", truth.income, (m) => inc.get(m)); series("Spending", truth.spending, (m) => sp.get(m)); series("Net worth", truth.networth, (m) => nw.get(m));
  const perAcct = accounts.map((a) => {
    let exact = 0, moved = 0, abs = 0, prevW = null, prevG = null;
    for (const m of months) { const w = truth.balances[a][m], g = R.balance(a, m); if (w === g) exact += 1; abs += Math.abs(g - w); if (prevW != null && w - prevW === g - prevG) moved += 1; prevW = w; prevG = g; }
    return { account: a, exact, of: months.length, moved, moved_of: months.length - 1, mae: Math.round(abs / months.length), last: { truth: truth.balances[a][months[months.length - 1]], engine: R.balance(a, months[months.length - 1]) } };
  });
  const bal = { exact: perAcct.reduce((t, a) => t + a.exact, 0), of: perAcct.length * months.length, moved: perAcct.reduce((t, a) => t + a.moved, 0), moved_of: perAcct.length * (months.length - 1), all_exact_months: months.filter((m) => accounts.every((a) => truth.balances[a][m] === R.balance(a, m))).length };
  const uncat = L.cash.filter((c) => months.includes(c.month)).reduce((t, c) => t + Math.max(0, -(c.byCategory.UNCAT || 0)), 0), spent = L.cash.filter((c) => months.includes(c.month)).reduce((t, c) => t + c.spending, 0);
  const monthly = months.map((m) => ({ m, inc: [truth.income[m], inc.get(m) || 0], sp: [truth.spending[m], sp.get(m) || 0], nw: [truth.networth[m], nw.get(m) || 0] }));
  return { rows, perAcct, bal, uncategorised_share: spent ? uncat / spent : 0, uncategorised_cents: uncat, monthly };
}

// ---------- every cash line, one by one: did the engine book it once, and treat it as truth does ----------
function reconcile(L, truth, R) {
  const pool = new Map(); truth.cash_lines.forEach((x, i) => { const k = `${x.account}|${x.cents}`; if (!pool.has(k)) pool.set(k, []); pool.get(k).push({ ...x, i }); });
  const taken = new Set(), legs = [], extra = [], wrong = {};
  const foreign = new Set(truth.foreign_accounts), ukEffect = { income: 0, spending: 0 };
  for (const e of L.events) { if (e.kind === "opening_balance") continue; for (const p of e.postings || []) { if (foreign.has(p.account_id) && e.occurred_on >= truth.window[0] && e.occurred_on <= truth.window[1]) { const g = R.treat(e); if (g === "income") ukEffect.income += p.amount_cents; if (g === "spending") ukEffect.spending -= p.amount_cents; } if (R.cashAcct.has(p.account_id) && !foreign.has(p.account_id)) legs.push({ e, account: p.account_id, cents: p.amount_cents, dates: R.datesOf(e, p.account_id) }); } }
  for (const pass of [0, 1, 6, 14]) for (const v of legs) {
    if (v.t) continue;
    let best = null, gap = Infinity;
    for (const x of pool.get(`${v.account}|${v.cents}`) || []) { if (taken.has(x.i)) continue; const d = Math.min(...v.dates.flatMap((q) => [days(x.date, q), x.posted ? days(x.posted, q) : Infinity, x.alt ? days(x.alt, q) : Infinity])), rank = d + (x.lens === R.treat(v.e) ? 0 : 0.25); if (d <= pass && rank < gap && (pass <= 1 || v.account === CARD || x.own || x.alt)) { best = x; gap = rank; } }
    if (best) { taken.add(best.i); v.t = best; }
  }
  let thirdParty = 0; const effect = { income: 0, spending: 0 };   // what each class of error does to the 36-month totals, so the table adds up to the gap
  const inWin = (d) => d >= truth.window[0] && d <= truth.window[1];
  for (const v of legs) {
    if (!v.t) { extra.push(v); continue; }
    const got = R.treat(v.e), own = v.t.part != null ? v.t.part : v.cents;
    if (got === v.t.lens) { if (got === "income" && inWin(v.t.date)) thirdParty += v.cents - own; continue; }
    const k = `${v.t.lens} booked as ${got}`, w = (wrong[k] = wrong[k] || { count: 0, cents: 0, income: 0, spending: 0, examples: new Set() });
    w.count += 1; w.cents += Math.abs(v.cents); if (w.examples.size < 3) w.examples.add(v.t.what.replace(/\s+/g, " "));
    if (inWin(v.t.date)) {
      if (v.t.lens === "income") w.income -= own; if (v.t.lens === "spending") w.spending += v.cents;
      if (got === "income") w.income += v.cents; if (got === "spending") w.spending -= v.cents;
    }
  }
  const missing = truth.cash_lines.filter((x, i) => !taken.has(i) && x.date >= truth.window[0] && x.date <= truth.window[1]);
  const missedByLens = (l) => missing.filter((x) => x.lens === l).reduce((t, x) => t + (x.part != null ? x.part : x.cents), 0);
  const windowExtra = extra.filter((v) => v.dates.some(inWin));
  for (const v of windowExtra) { const got = R.treat(v.e); if (got === "income") effect.income += v.cents; if (got === "spending") effect.spending -= v.cents; }
  const dup = L.review.filter((r) => r.kind === "possible_duplicate"), cards = extra.filter((v) => v.account === CARD && R.treat(v.e) === "spending");
  const asked = cards.filter((v) => dup.some((r) => { const p = String(r.ref).split("|"); return p[0] === CARD && Number(p[2]) === v.cents && v.dates.some((d) => days(p[1], d) <= 9); })).length;
  const lagOf = (v) => { const c = (pool.get(`${CARD}|${v.cents}`) || []).find((x) => x.posted && v.dates.some((d) => days(x.date, d) <= 14 || days(x.posted, d) <= 14)); return c ? days(c.date, c.posted) : null; };
  const byLag = {}; for (const v of cards) { const l = lagOf(v); byLag[l == null ? "unmatched" : l] = (byLag[l == null ? "unmatched" : l] || 0) + 1; }
  const paired = truth.own_transfers.filter((x) => { const a = R.find(x.from, x.date_out, -(x.sent || x.cents), 6, x.date_in), b = R.find(x.to, x.date_in, x.cents, 6, x.date_out); const good = (e) => R.treat(e) === "neither" && e.kind !== "open_transfer"; return a.some(good) && b.some(good); }).length;
  const extraBy = {}; for (const v of extra) { const k = `${v.account} ${v.e.kind}`, w = (extraBy[k] = extraBy[k] || { count: 0, cents: 0, example: v.e.description || "" }); w.count += 1; w.cents += v.cents; }
  return { lines: truth.cash_lines.length, matched: taken.size, extra: extra.length, extra_cents: extra.reduce((t, v) => t + v.cents, 0), extraBy, missing: missing.length, missing_cents: missing.reduce((t, x) => t + x.cents, 0), missing_list: missing, missed: { income: -missedByLens("income"), spending: missedByLens("spending") }, effect, ukEffect, thirdParty, wrong, card_doubles: { count: cards.length, cents: cards.reduce((t, v) => t - v.cents, 0), asked, by_lag: Object.entries(byLag).map(([d, n]) => (d === "unmatched" ? `${n} with no line to match` : `${n} posted ${d} days after the charge`)).join(", ") }, own: { paired, of: truth.own_transfers.length } };
}

// ---------- each planted trap: handled, flagged, or silently wrong ----------
function judgeLine(R, x) {
  const found = R.find(x.account, x.date, x.cents, x.wide, x.posted), treatments = found.map(R.treat);
  const mixed = x.want.startsWith("mixed:"), n = x.n || 1, want = mixed ? x.want.slice(6).split(",").sort() : Array(n).fill(x.want);
  const sameTreat = JSON.stringify(treatments.slice().sort()) === JSON.stringify(want);
  const fine = sameTreat && (!x.month || found.every((e) => (e.charged_on || e.occurred_on).slice(0, 7) === x.month));
  const said = `${x.account} ${x.date} ${money(x.cents)}: want ${x.want}${n > 1 && !mixed ? ` x${n}` : ""}${x.month ? ` in ${x.month}` : ""}, got ${found.length ? found.map((e, i) => `${e.kind}/${e.category_id || "no category"}/${treatments[i]}${x.month ? ` on ${e.charged_on || e.occurred_on}` : ""}`).join(", ") : "no event"}`;
  if (fine) return { outcome: "handled", said, dollars: 0 };
  // the dollars a wrong line moves: how far its count and treatment sit from what truth wants
  const dollars = found.length !== n ? Math.abs(x.cents) * Math.max(1, Math.abs(found.length - n)) : Math.abs(x.cents);
  const flagged = found.length > n ? R.askedDup(x.account, x.date, x.cents, x.posted).length : R.asked(x.account, x.date, x.cents, x.posted).length + R.askedOther(x, found).length;
  return { outcome: flagged ? "flagged" : "silently wrong", said, dollars };
}
const worstOf = (list) => (list.includes("silently wrong") ? "silently wrong" : list.includes("flagged") ? "flagged" : "handled");

function judge(trap, ctx) {
  const { R, L, truth, intake } = ctx, p = trap.probe, notes = [], outcomes = []; let cents = 0, flaggedCents = 0;
  const HOLDINGS = ["ACC-SHARES", "ACC-SMSF-SHARES"];
  const tallyOf = (o, c) => { if (o === "silently wrong") cents += c; else if (o === "flagged") flaggedCents += c; };
  const months = Object.keys(truth.income);
  // a balance is flagged by a law that fails or shows a gap at that account, or a review item about the account itself. A question about one of its lines does not put the balance in front of anyone
  const nameOf = (a) => (L.accounts.find((x) => x.account_id === a) || {}).name || a;
  const lawBad = (a) => L.checks.some((c) => ((c.law !== "L7" && String(c.scope) === a) || (c.law === "L7" && HOLDINGS.includes(a))) && !["pass", "skip", "accepted"].includes(c.status)) || L.review.some((r) => !["uncategorised", "possible_duplicate"].includes(r.kind) && (String(r.ref) === a || String(r.what || "").includes(a) || String(r.what || "").includes(nameOf(a)) || String(r.question || "").includes(nameOf(a))));
  const lines = (p.lines || []).map((x) => judgeLine(R, x));
  for (const l of lines) { outcomes.push(l.outcome); tallyOf(l.outcome, l.dollars); }
  const bad = lines.filter((l) => l.outcome !== "handled");
  if (p.clearing) {
    const cs = L.checks.filter((x) => x.law === "L2" && String(x.scope).startsWith(p.clearing)), off = cs.filter((c) => c.status !== "pass");
    notes.push(`${p.clearing}: ${cs.length ? off.length ? off.map((c) => `${c.scope} ${c.status}${c.gap_cents != null ? ` ${money(c.gap_cents)}` : ""}`).join(", ") : "pass" : "no check"}`);
    if (off.length) outcomes.push("flagged");
  }
  const balanceList = [...(p.balances || []), ...(p.kind === "balance" ? [{ account: p.account, months: p.months }] : [])];
  for (const b of balanceList) {
    const off = b.months.filter((m) => truth.balances[b.account][m] !== R.balance(b.account, m)), worst = off.reduce((t, m) => Math.max(t, Math.abs(truth.balances[b.account][m] - R.balance(b.account, m))), 0);
    notes.push(`${b.account}: ${b.months.length - off.length} of ${b.months.length} month-ends exact${off.length ? `, worst ${money(worst)} off` : ""}`);
    if (off.length) { const o = b.strict ? "silently wrong" : lawBad(b.account) ? "flagged" : "silently wrong"; outcomes.push(o); tallyOf(o, worst); }
  }
  /* the month-on-month change, for an account that already carries another trap's error */
  for (const b of p.moves || []) {
    const prev = (m) => months[months.indexOf(m) - 1], move = (f, m) => f(m) - f(prev(m)), want = (m) => truth.balances[b.account][m], got = (m) => R.balance(b.account, m), off = b.months.filter((m) => move(want, m) !== move(got, m)), worst = off.reduce((t, m) => Math.max(t, Math.abs(move(want, m) - move(got, m))), 0);
    notes.push(`${b.account}: ${b.months.length - off.length} of ${b.months.length} monthly movements exact${off.length ? `, worst ${money(worst)} off` : ""}`);
    if (off.length) { const o = lawBad(b.account) ? "flagged" : "silently wrong"; outcomes.push(o); tallyOf(o, worst); }
  }
  if (p.zero_after) {
    const ms = months.filter((m) => m >= p.zero_after.from), off = ms.filter((m) => R.balance(p.zero_after.account, m) !== 0);
    notes.push(`${p.zero_after.account}: ${ms.length - off.length} of ${ms.length} month-ends at zero${off.length ? `, ${off[0]} shows ${money(R.balance(p.zero_after.account, off[0]))}` : ""}`);
    if (off.length) { const o = lawBad(p.zero_after.account) ? "flagged" : "silently wrong"; outcomes.push(o); tallyOf(o, Math.abs(R.balance(p.zero_after.account, off[0]))); }
  }
  if (p.zero_before) for (const a of p.zero_before.accounts) {
    const ms = months.filter((m) => m < p.zero_before.until), off = ms.filter((m) => R.balance(a, m) !== 0);
    notes.push(`${a} before ${p.zero_before.until}: ${ms.length - off.length} of ${ms.length} month-ends at zero${off.length ? `, ${off[0]} shows ${money(R.balance(a, off[0]))}` : ""}`);
    if (off.length) { const o = lawBad(a) ? "flagged" : "silently wrong"; outcomes.push(o); tallyOf(o, Math.abs(R.balance(a, off[off.length - 1]))); }
  }
  if (p.accrual) for (const x of p.accrual) {
    const row = L.accrual.find((r) => r.month === x.month), got = row ? (row.byCategory[x.category] || 0) : 0, ok = x.atLeast ? Math.abs(got) >= Math.abs(x.cents) && Math.abs(got) < Math.abs(x.cents) * 2 : got === x.cents;
    notes.push(`economic lens ${x.month} ${x.category}: want ${x.atLeast ? "about " : ""}${money(x.cents)}, got ${money(got)}`);
    if (!ok) { outcomes.push("silently wrong"); cents += Math.abs(got - x.cents); }
  }
  /* what the engine holds out of a group: the sum of the accounts' balances less the group's line in net worth. A sterling balance with no rate is left out on both sides, so its figure never reads as this trap's. */
  if (p.excluded) for (const x of p.excluded) {
    const row = L.netWorth.find((n) => n.month === x.month), accts = (x.accounts === "cash" ? [...R.cashAcct] : x.accounts).filter((a) => !["GBP"].includes((L.accounts.find((k) => k.account_id === a) || {}).currency)), sum = accts.reduce((t, a) => t + R.balance(a, x.month), 0), got = sum - ((row && row.groups && row.groups[x.group]) || 0), gap = Math.abs(got - x.want);
    notes.push(`${x.month}: ${money(got)} held out of ${x.group} in net worth, truth ${money(x.want)}`);
    if (gap > (x.tolerance || 0)) { const o = lawBad(x.named) ? "flagged" : "silently wrong"; outcomes.push(o); if (o === "flagged") flaggedCents = Math.max(flaggedCents, gap); else cents = Math.max(cents, gap); }
  }
  /* an interest seen on three lines lands in income once, wherever it lands */
  if (p.income_once) for (const q of p.income_once) {
    const evs = new Set(); for (const x of q.lines) for (const e of R.find(x.account, x.date, x.cents, 1)) evs.add(e);
    const got = [...evs].filter((e) => R.treat(e) === "income").reduce((t, e) => t + (e.postings || []).filter((a) => R.cashAcct.has(a.account_id)).reduce((s, a) => s + a.amount_cents, 0), 0);
    notes.push(`${q.lines[0].date}: ${money(got)} of income from one interest of ${money(q.cents)}`);
    if (got !== q.cents) { const o = q.lines.some((x) => R.asked(x.account, x.date, x.cents).length) ? "flagged" : "silently wrong"; outcomes.push(o); tallyOf(o, Math.abs(got - q.cents)); }
  }
  if (p.kind === "law") outcomesForLaw(p);
  function outcomesForLaw(q) {
    const cs = L.checks.filter((c) => c.law === q.law && String(c.scope).includes(q.scope)), off = cs.filter((c) => c.status !== "pass");
    notes.push(`${q.law} ${q.scope}: ${cs.length ? off.length ? `${off.length} of ${cs.length} not passing, ${off[0].status}: ${off[0].detail || ""}` : `${cs.length} pass` : "no check ran"}`);
    if (!cs.length) outcomes.push("silently wrong"); else if (off.length) outcomes.push("flagged");
    // a law that must fail: a pass is the control missing what it exists to catch
    else if (q.must_fail) { outcomes.push("silently wrong"); cents += Math.max(...cs.map((c) => Math.abs(c.gap_cents || 0))); }
  }
  if (p.absent) for (const x of p.absent) {
    const f = R.find(x.account, x.date, x.cents, x.account === CARD ? 9 : 2, x.posted);
    notes.push(`${x.account} ${money(x.cents)} near ${x.date}: ${f.length ? `booked, ${f.map((e) => `${e.kind}/${e.category_id || "no category"}`).join(", ")}` : "not booked"}`);
    if (f.length) { const o = (x.account === CARD ? R.askedDup(x.account, x.date, x.cents, x.posted) : R.asked(x.account, x.date, x.cents, x.posted)).length ? "flagged" : "silently wrong"; outcomes.push(o); tallyOf(o, Math.abs(x.cents)); }
  }
  /* what one settlement account holds in net worth, read on its own, so one trap's residue does not land on another's month */
  if (p.settle) {
    let worst = 0;
    for (const x of p.settle) { const got = R.balance(x.account, x.month); notes.push(`${x.account} at ${x.month}: ${money(x.want)} in truth, ${money(got)} in the engine's net worth`); worst = Math.max(worst, Math.abs(got - x.want)); }
    if (worst) { const named = L.review.some((r) => r.kind === "trade_unsettled") && L.checks.some((c) => c.law === "L2" && p.settle.some((x) => c.scope === x.account) && c.status !== "pass"), o = named ? "flagged" : "silently wrong"; outcomes.push(o); if (o === "flagged") flaggedCents = Math.max(flaggedCents, worst); else cents = Math.max(cents, worst); }
  }
  if (p.lots) {
    const got = L.lotRows.filter((l) => l.instrument_id === p.lots.instrument).reduce((t, l) => t + Number(l.units_open), 0);
    notes.push(`${p.lots.instrument} open lots at the end: ${got / 1e8}, truth ${p.lots.units / 1e8}`);
    if (got !== p.lots.units) outcomes.push("silently wrong");
  }
  if (p.must_name) {
    const c = L.coverage.find((x) => x.stream_id === p.must_name.stream), missing = c ? (c.missing || []).map(String) : [], said = p.must_name.months.every((m) => missing.some((x) => x.includes(m)));
    notes.push(`coverage for ${p.must_name.stream}: ${c ? `${c.have} of ${c.expected}, missing ${missing.join(", ") || "nothing"}` : "no row"}`);
    if (said) outcomes.splice(0, outcomes.length, "flagged");
  }
  if (p.kind === "gap") {
    const c = L.coverage.find((x) => x.stream_id === p.stream), missing = c ? (c.missing || []).map(String) : [], said = missing.some((x) => x.includes(p.month));
    notes.push(`coverage for ${p.stream}: ${c ? `${c.have} of ${c.expected}, missing ${missing.join(", ") || "nothing"}` : "no row"}`);
    outcomes.push(said ? "flagged" : "silently wrong");
  }
  if (p.kind === "coverage_clean") {
    const c = L.coverage.find((x) => x.stream_id === p.stream), missing = c ? (c.missing || []).map(String) : [];
    notes.push(`coverage for ${p.stream}: ${c ? `${c.have} of ${c.expected}, missing ${missing.join(", ") || "nothing"}` : "no row"}`);
    if (missing.length || (c && c.have < c.expected)) outcomes.push("flagged");
  }
  if (p.kind === "hole") {
    const l3 = L.checks.find((x) => x.law === "L3" && x.scope === p.account), c = L.coverage.find((x) => x.stream_id === p.account), re = new RegExp(p.match);
    const said = l3 && l3.status !== "pass" && re.test(String(l3.detail));
    notes.push(`L3 ${l3 ? `${l3.status}: ${l3.detail || ""}` : "absent"}; coverage ${c ? `${c.have} of ${c.expected}` : "no row"}; the ${money(p.net_cents)} that moved ${said ? "is named" : `has no month named, though L3's gap is ${l3 ? money(l3.gap_cents) : "absent"}`}`);
    { const o = said ? "flagged" : "silently wrong"; outcomes.push(o); tallyOf(o, Math.abs(p.net_cents)); }
  }
  if (p.kind === "card_lag") {
    const x = ctx.rec.card_doubles;
    notes.push(`${x.count} extra card lines, ${money(x.cents)}, ${x.by_lag}; ${x.asked} of them asked about`);
    { const o = x.count === 0 ? "handled" : x.asked === x.count ? "flagged" : "silently wrong"; outcomes.push(o); tallyOf(o, x.cents); }
  }
  if (p.no_events_before) {
    const q = p.no_events_before, re = new RegExp(q.match), found = L.events.filter((e) => e.occurred_on < q.before && (!q.kinds || e.kind.includes(q.kinds)) && re.test(JSON.stringify(e)));
    notes.push(`${found.length} ${q.kinds || ""} events before ${q.before}, ${money(found.reduce((t, e) => t + Math.abs(e.amount_cents || 0), 0))}`);
    if (found.length) { outcomes.push("silently wrong"); cents += found.reduce((t, e) => t + Math.abs(e.amount_cents || 0), 0); }
  }
  if (p.law_note) for (const c of L.checks.filter((x) => x.law === p.law_note)) notes.push(`${c.law} ${c.scope} ${c.status}: ${c.detail || ""}`);
  if (p.unread) {
    const u = intake.unknown_files.filter((f) => f.path.startsWith(p.unread));
    notes.push(`${u.length} files unread and reported by intake`);
  }
  return { id: trap.id, name: trap.name, fresh: trap.fresh, dc: trap.dc, where: trap.where, expect: trap.expect, outcome: worstOf(outcomes), cents, flaggedCents, lines_ok: lines.filter((l) => l.outcome === "handled").length, lines_total: lines.length, notes, bad: bad.slice().sort((a, b) => (a.outcome === "silently wrong" ? -1 : 1) - (b.outcome === "silently wrong" ? -1 : 1)).map((l) => `${l.outcome}: ${l.said}`) };
}

// ---------- the report ----------
function report(r) {
  const { L, truth, intake, crash } = r, R = Reader(L, r.setup), T = scoreTable(L, truth, R);
  const rec = reconcile(L, truth, R);
  const traps = truth.traps.map((t) => judge(t, { R, L, truth, intake, rec }));
  const tally = { handled: 0, flagged: 0, "silently wrong": 0 }; for (const t of traps) tally[t.outcome] += 1;
  const reviewKinds = {}; for (const x of L.review) reviewKinds[x.kind] = (reviewKinds[x.kind] || 0) + 1;
  const laws = {}; for (const c of L.checks) { const k = c.law; (laws[k] = laws[k] || {})[c.status] = (laws[k][c.status] || 0) + 1; }
  let head = "unknown", dirty = "";
  try { head = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: STD }).toString().trim(); dirty = execFileSync("git", ["status", "--porcelain", "--", "engine", "intake", "schema", "recipes", "reference"], { cwd: STD }).toString().trim() ? " with uncommitted changes under standard/" : ""; } catch (e) { /* no git, no matter */ }
  const out = [];
  const p = (s = "") => out.push(s);
  p("# Third held-out household: Haddad-Whitlock, after repairs");
  p();
  p("**This run is not blind.** The blind result is [BLIND-3.md](BLIND-3.md), kept as it was written. The engine then took one repair per shape, each with a failing fixture under `eval/households/`, and the public super recipes learned a pension line.");
  p();
  p(`Generated by \`node standard/eval/heldout3/run.js\`. Engine at ${head}${dirty}. Bundle ${L.bundleHash}. ${intake.sources.length} sources, ${intake.observations.length} observations, ${L.events.length} events, ${intake.unknown_files.length} unread, ${intake.faults.length} intake faults. No decisions, no rules. Public recipes and dictionary, and one family's onboarding answers.`);
  p();
  p("## Scores");
  p();
  p("| Measure | Exact months | Mean error a month | Truth, 36 months | Engine, 36 months | Worst month |");
  p("|---|---|---:|---:|---:|---|");
  for (const x of T.rows) p(`| ${x.name} | ${x.exact} of ${x.of} | ${money(x.mae)} | ${x.name === "Net worth" ? `${money(truth.networth["2026-06"])} at June 2026` : money(x.truth_total)} | ${x.name === "Net worth" ? `${money((L.netWorth.find((n) => n.month === "2026-06") || {}).total)} at June 2026` : money(x.engine_total)} | ${x.worst.m}, off by ${money(x.worst.d)} |`);
  p(`| Balances, account-months | ${T.bal.exact} of ${T.bal.of} | | | | ${T.bal.all_exact_months} months with every account exact |`);
  p(`| Balance movements, account-months | ${T.bal.moved} of ${T.bal.moved_of} | | | | right change month on month, whatever the opening |`);
  p(`| Review items | ${L.review.length} | | | | ${Object.entries(reviewKinds).map(([k, v]) => `${k} ${v}`).join(", ")} |`);
  p(`| Traps | ${tally.handled} handled, ${tally.flagged} flagged, ${tally["silently wrong"]} silently wrong, of ${traps.length} | | | | ${traps.filter((t) => t.fresh).length} in neither earlier list, ${traps.filter((t) => t.dc).length} new double-count or silent-number variants |`);
  p();
  { const ms = Object.keys(truth.income), un = L.cash.filter((c) => ms.includes(c.month)).reduce((t, c) => t + (c.unexplained || 0), 0), nwRow = (m) => L.netWorth.find((n) => n.month === m), pn = truth.unreadable_account, off = ms.map((m) => (nwRow(m) ? nwRow(m).total : 0) - R.balance(pn.account, m) - (truth.networth[m] - pn.balance[m])), exact = off.filter((d) => d === 0).length, mae = Math.round(off.reduce((t, d) => t + Math.abs(d), 0) / ms.length);
    p(`Money the engine says it cannot explain, neither income nor spending, across 36 months: ${money(un)}. With ${pn.account}, which no public recipe reads, taken out of both sides, net worth is exact in ${exact} of 36 months with a mean error of ${money(mae)}, against ${money(T.rows[2].mae)} with it in.`);
    p(); }
  const asks = new Map(); for (const x of L.review.filter((i) => i.kind === "uncategorised")) asks.set(x.question, (asks.get(x.question) || 0) + Math.abs(x.amount_cents));
  const byValue = [...asks.values()].sort((a, b) => b - a), total = byValue.reduce((a, b) => a + b, 0), top = byValue.slice(0, 30).reduce((a, b) => a + b, 0);
  const allAsks = new Set(L.review.map((x) => `${x.kind}|${x.question || x.what || x.ref}`));
  p(`Spending left uncategorised: ${T.uncategorised_share > 0 ? `${(T.uncategorised_share * 100).toFixed(1)}% of the dollars` : `${money(T.uncategorised_cents)}, and no share of a spending total that nets below zero`}. Every merchant is invented, so the dictionary knows few of them; uncategorised spending still counts as spending. The ${L.review.filter((i) => i.kind === "uncategorised").length} uncategorised lines are ${asks.size} questions, one per merchant, and the first 30 cover ${(top / (total || 1) * 100).toFixed(1)}% of their dollars. The whole review queue is ${L.review.length} items and ${allAsks.size} distinct questions.`);
  p();
  p("## Did round two generalise");
  p();
  p(VERDICT[0]);
  p();
  for (const v of VERDICT.slice(1)) { p(v); p(); }
  { const byId = new Map(traps.map((t) => [t.id, t])), rank = { "silently wrong": 0, flagged: 1, handled: 2 }, fresh = traps.filter((t) => t.fresh), n = (o) => fresh.filter((t) => t.outcome === o).length;
    p("Twelve shapes repeat an earlier family's, on this family's files. The rest of the traps are new.");
    p();
    p("| This household | Earlier trap | Then, first blind run | Now | Way |");
    p("|---|---|---|---|---|");
    for (const [a, b, then] of REPEATS) { const now = byId.get(a).outcome, d = rank[now] - rank[then]; p(`| ${a} | ${b} | ${then} | ${now} | ${d > 0 ? "better" : d < 0 ? "worse" : "same"} |`); }
    p();
    p(`The ${fresh.length} shapes in neither earlier list: ${n("handled")} handled, ${n("flagged")} flagged, ${n("silently wrong")} silently wrong.`);
    p(); }
  const dollarsSW = traps.filter((t) => t.outcome === "silently wrong");
  p("## Silently wrong, with the dollars");
  p();
  p("Dollars are the gross amount on the wrong lines, or the worst balance error, and they overlap: a late-posted line sits in both T3-HOLIDAY-LAG and T3-POSTING-LAG.");
  p();
  p(dollarsSW.length ? "| Trap | Dollars | What |\n|---|---:|---|" : "None.");
  for (const t of dollarsSW) p(`| ${t.id} | ${money(t.cents)} | ${t.name} |`);
  p();
  const dollarsF = traps.filter((t) => t.outcome === "flagged" && t.flaggedCents > 0).sort((a, b) => b.flaggedCents - a.flaggedCents);
  p("## Wrong and flagged, the largest numbers");
  p();
  p("A flag is not a fix. These numbers stay wrong until a person answers.");
  p();
  p("| Trap | Dollars | What |\n|---|---:|---|");
  for (const t of dollarsF.slice(0, 10)) p(`| ${t.id} | ${money(t.flaggedCents)} | ${t.name} |`);
  p();
  const curveRows = require("../heldout/answers").curve(L, truth, r.setup, r.again);
  p("## What a person's answers buy");
  p();
  p("One question per merchant, in dollar order, answered the way truth would. Truth stands in for the person, so this shows what the questions are worth.");
  p();
  p("| Answers | Share of unanswered dollars | Income exact | Spending exact | Questions left |");
  p("|---:|---:|---:|---:|---:|");
  for (const x of curveRows) p(`| ${x.answers} | ${(x.share * 100).toFixed(1)}% | ${x.income} of 36 | ${x.spending} of 36 | ${x.left} |`);
  p();
  p("## Line by line");
  p();
  p(`${rec.lines} lines on cash accounts in truth. ${rec.matched} booked by the engine. ${rec.extra} extra legs worth ${money(rec.extra_cents)}. ${rec.missing} lines never booked, net ${money(rec.missing_cents)}. Own transfers paired as transfers: ${rec.own.paired} of ${rec.own.of}.`);
  p();
  p("| Truth says | Lines | Dollars | For example |");
  p("|---|---:|---:|---|");
  for (const [k, w] of Object.entries(rec.wrong).sort((a, b) => b[1].cents - a[1].cents)) p(`| ${k} | ${w.count} | ${money(w.cents)} | ${[...w.examples].join("; ")} |`);
  p();
  if (rec.extra) {
    p("Extra legs, by account and event kind:");
    p();
    p("| Leg | Count | Dollars | For example |");
    p("|---|---:|---:|---|");
    for (const [k, w] of Object.entries(rec.extraBy).sort((a, b) => Math.abs(b[1].cents) - Math.abs(a[1].cents))) p(`| ${k} | ${w.count} | ${money(w.cents)} | ${w.example.replace(/\|/g, "/")} |`);
    p();
  }
  if (rec.missing) {
    p(`Lines never booked: ${rec.missing_list.slice(0, 12).map((x) => `${x.account} ${x.date} ${money(x.cents)} ${x.what.replace(/\s+/g, " ")}`).join("; ")}${rec.missing > 12 ? "; and more" : ""}.`);
    p();
  }
  const sumW = (f) => Object.values(rec.wrong).reduce((t, w) => t + w[f], 0);
  const gapI = T.rows[0].engine_total - T.rows[0].truth_total, gapS = T.rows[1].engine_total - T.rows[1].truth_total, ukI = rec.ukEffect.income - truth.foreign_totals.income, ukS = rec.ukEffect.spending - truth.foreign_totals.spending;
  p(`The 36-month gaps by cause. Income: engine less truth ${money(gapI)}; wrong treatment ${money(sumW("income"))}, extra legs ${money(rec.effect.income)}, lines never booked ${money(rec.missed.income)}, the sterling account ${money(ukI)}, Tariq's half inside one estate credit ${money(rec.thirdParty)}, unexplained ${money(gapI - sumW("income") - rec.effect.income - rec.missed.income - ukI - rec.thirdParty)}. Spending: engine less truth ${money(gapS)}; wrong treatment ${money(sumW("spending"))}, extra legs ${money(rec.effect.spending)}, lines never booked ${money(rec.missed.spending)}, the sterling account ${money(ukS)}, unexplained ${money(gapS - sumW("spending") - rec.effect.spending - rec.missed.spending - ukS)}. Unexplained is what crosses the window's edge or moves in a way this sum does not model.`);
  p();
  p("## Balances by account");
  p();
  p("| Account | Exact month-ends | Exact movements | Mean error | June 2026, truth | June 2026, engine |");
  p("|---|---|---|---:|---:|---:|");
  for (const a of T.perAcct) p(`| ${a.account} | ${a.exact} of ${a.of} | ${a.moved} of ${a.moved_of} | ${money(a.mae)} | ${money(a.last.truth)} | ${money(a.last.engine)} |`);
  p();
  p("## Traps");
  p();
  p("Handled: the number is right. Flagged: the number is wrong or unknowable, and the engine put that line, account or month in front of a person. Silently wrong: the number is wrong and nothing says so. New: in neither earlier list. DC: a new variant of double counting or of a number silently wrong.");
  p();
  p("| Trap | Tags | Outcome | Evidence |");
  p("|---|---|---|---|");
  for (const t of traps) p(`| ${t.id}: ${t.name} | ${[t.fresh ? "new" : "", t.dc ? "DC" : ""].filter(Boolean).join(", ")} | **${t.outcome}** | ${[t.lines_total ? `${t.lines_ok} of ${t.lines_total} lines right` : "", ...t.notes, ...t.bad.slice(0, 3)].filter(Boolean).join("; ").replace(/\|/g, "/")} |`);
  p();
  p("## Laws");
  p();
  p(Object.entries(laws).map(([k, v]) => `${k}: ${Object.entries(v).map(([s, n]) => `${n} ${s}`).join(", ")}`).join(". ") + ".");
  p();
  for (const c of L.checks.filter((x) => x.status === "fail")) p(`- ${c.law} ${c.scope}: ${c.detail || ""}${c.gap_cents != null ? ` Gap ${money(c.gap_cents)}.` : ""}`);
  p();
  p("## Files the public recipes did not read");
  p();
  const unread = {}; for (const u of intake.unknown_files) { const k = `${u.path.split("/")[1]}: ${u.reason}`; unread[k] = (unread[k] || 0) + 1; }
  const refused = {}; for (const f of intake.faults.filter((x) => x.code === "file_refused")) { const k = `${f.path.split("/")[1]}: refused by intake, a line type the recipe does not map`; refused[k] = (refused[k] || 0) + 1; }
  p([...Object.entries(unread), ...Object.entries(refused)].map(([k, v]) => `- ${k}, ${v} files`).join("\n") || "None.");
  p();
  p("## Month by month");
  p();
  p("| Month | Income, truth | Income, engine | Spending, truth | Spending, engine | Net worth, truth | Net worth, engine |");
  p("|---|---:|---:|---:|---:|---:|---:|");
  for (const x of T.monthly) p(`| ${x.m} | ${money(x.inc[0])} | ${money(x.inc[1])} | ${money(x.sp[0])} | ${money(x.sp[1])} | ${money(x.nw[0])} | ${money(x.nw[1])} |`);
  p();
  p("## Conventions, set down before the first run");
  p();
  for (const n of NOTES) p(`- ${n}`);
  if (AFTER.length) {
    p();
    p("## Changed after the first run");
    p();
    for (const n of AFTER) p(`- ${n}`);
    if (MOVES.length) { p(); p("| Trap | First run | This table | Way |"); p("|---|---|---|---|"); for (const [t, a, b, w] of MOVES) p(`| ${t} | ${a} | ${b} | ${w} |`); }
  }
  if (SEEN.length) {
    p();
    p("## Seen but not planted");
    p();
    for (const n of SEEN) p(`- ${n}`);
  }
  fs.writeFileSync(path.join(__dirname, "RESULT.md"), `${out.join("\n")}\n`);
  console.log(out.join("\n"));
}
const NOTES = [
  "Blind. Written from SPEC.md, RECIPES.md, the schemas, schema-card.md, the public recipes, the intake, the world's file writers, and the build, run and blind report of the two earlier held-out folders, with answers.js. Not read: the engine, score.js, ladder.js, eval/households, the Davies domains, src, merchants, reference, either RESULT.md, or any diff of them. run.js calls rebuild and the public dictionary loader without either being opened. The shape of rebuild's output was learned by printing its keys, and no values, on the second household, before this household existed in the engine. Files were checked by running the intake alone, which is not the engine.",
  "File layouts come from the earlier builds, or were recovered by testing against the recipes' public fingerprints. The corporate-action email was found that way. Bupaw, VicPaws, the appraisal and RentPurrfect were not recovered in reasonable time, so those documents are not in this household. New to the held-out series: Bark's QIF as a main account, the corporate-action email, and a pension-phase fund file.",
  "Budgets read the charge date and balances read the posting date. A charge in two files is one charge. Where a statement and a download disagree on the amount, the statement is the charge, because it closes on it.",
  "Cash income and spending follow SPEC 6.5 and the treatment rule of the earlier scorers. `unexplained` on an event or a month is the money the engine says it cannot explain: neither income nor spending. Super pensions are income under SUPER-PENSION. The Age Pension and the UK pension are income. An overpaid pension taken back is a negative in income. Interest on a term deposit is income the day it is credited to the deposit, wherever it is then paid; for T3-TD-INT-ELSEWHERE any one line may carry it, so long as it lands once. Rent counts at the net amount paid. An inheritance is income under the public GIFT-IN. Tax refunds, the return of capital, a commutation, the house and car sales, the deposits, the bridging loan and the loan to Karim are neither. Everything of Nadia's and Tariq's that crosses the rails is neither, by SPEC 4.4c, and the estate credit that holds Tariq's half counts for the half that is Salma's. The couple's means are set so a part Age Pension is plausible until the home is sold; SPEC 9 declines the means test and nothing here computes it.",
  "Net worth in truth carries money in the air between own accounts and trades between trade and settlement, as both earlier scorers did. It counts what members own on the day: half of the family saver from Karim leaving until it closes, by SPEC 6.6. The fund's accounts count at their own balances, once, because they are the fund and no read file states it otherwise. Headline net worth excludes the tax position. The loan to Karim is an asset the household declared.",
  "Sterling. ACC-UK is declared GBP in setup and its file has the same five columns as a public Australian recipe, which reads it. Truth holds it at the month's rate, a rate no file states. The line table leaves that account out, and the 36-month sums and the balance table keep it, in Australian dollars.",
  "Holdings are carried at the true month-end market value even for a month whose file is missing, so a stale price shows as a wrong balance. Property is the latest valuation; a purchase is at settlement cost until its first valuation, as in BLIND-1. The sold home is zero from the day it is sold. The second car's value is typed in setup, as BLIND-1's was, and it is zero from the day it is sold.",
  "The pension account's true balance is in truth whether or not it can be read, as BLIND-2 held a cold wallet. Since that single account can swamp net worth, the report also gives net worth with it taken out of both sides. That line is disclosure, not a score: the headline row keeps it in.",
  "No public recipe maps a pension line: purrannuation-csv-v1, v2 and hestabby-app-json hold only contribution, tax, fee, insurance, earnings and rollover codes, and fund-statement-pdf's equation has no pension term. So the fund's JSON, which has the public layout and a PENS code, is refused by intake, whole. The fund's own member statements and the vendor's statement of the home sale have no recipe either. Each is listed below. These are not planted against the engine. They are what a retired couple's files are, on the public recipes as they stand.",
  "Setup gives no opening balance a file states. Categories are the public list with PASS-THROUGH, SUPER-PENSION and SELLING-COSTS, which SPEC 4.4c, SPEC 6.5 and schema/events.json name, and one row by SPEC 12: Age and overseas pensions. The two pension contracts carry SUPER-PENSION and phase retirement, because a person would say so. The aged-care home's contract carries PASS-THROUGH, because a person would say that too. Three omissions are deliberate and are what a person would leave out: no offsets link on the bridging loan, because nobody thought of it; no rate for sterling, because setup has nowhere to put one; and the new bank's account number starts on the merger date, though its first file reaches back six days.",
  "The fund's three accounts have legal and tax ownership in the fund's party and beneficial ownership in Geoffrey. The family saver has Karim's half in every basis until it closes, while his membership ends 2024-03-15.",
  "T3-RAD-THROUGH, T3-ESTATE, T3-PENSION-DEBT, T3-FAMILY-LOAN, T3-BROTHER-SHARE and T3-CAR-DEALER are facts an engine can only learn by asking, or by a person's rule. A question over the line scores flagged and is the honest best. Silence scores silently wrong, as BLIND-2 scored T2-FALSE-PAIR, even where SPEC 8 declares the limit: a limit that is declared still leaves a wrong number.",
  "T3-AGENT-FALSE-SUM lands the agent's real credit 25 days after its statement closes, outside the 16-day rent window in schema/matching.json, so a true match by amount is out of reach and the false sum is the only one on offer. An honest answer is an unmatched statement. T3-CARD-LOGIN cuts one quarter's activity file down to one card member, the shape of a filtered download; the file does not say it was filtered. T3-LEAVER is exact to a cent, since the odd cent of a half falls by largest remainder.",
  "Before the first run the scorer was tried on a perfect stand-in built from the simulation's own book, never the engine: 52 handled, and 3 flagged, the three gaps nobody can fill (T3-QIF-HOLE, T3-HOLDINGS-GAP, T3-STATEMENT-GAP). So every other probe can pass. An own transfer counts as paired when a leg of its amount on each side is neither and not left open, where BLIND-2 asked every such leg, because T3-PENSION-VS-TFR puts an income line of the same amount on the same day.",
  "A flagged outcome needs the engine to name the line in review, or a law that fails or shows a gap on that account, or coverage that names the month. For a hole in a bank file the law must name the month. A doubled line counts as asked only if review asks whether it is doubled. A balance is flagged by any law scoped at that account, or by a review item about the account rather than one of its lines, which widens BLIND-2's rule of L3 alone so that a coverage gap or a currency question counts. A file refused or unread by intake is a report of the intake and does not by itself flag a number. Tax is not scored: L11 is printed as the engine reports it. A trust, SMSF or age-pension calculation is not asked for: SPEC 9 declines them, and only their cash lines are scored.",
];
const REPEATS = [["T3-MEDICARE-SA", "T2-MEDICARE-SA", "handled"], ["T3-BILL-WITNESS", "T-BILL-WITNESS", "handled"], ["T3-DIVIDEND", "T2-DIVIDEND", "handled"], ["T3-SETTLEMENT", "T-SETTLEMENT", "flagged"], ["T3-HOLIDAY-LAG", "T2-HOLIDAY-LAG", "silently wrong"], ["T3-DATE-BASIS", "T2-DATE-BASIS", "flagged"], ["T3-HOLDINGS-GAP", "T2-HOLDINGS-GAP", "flagged"], ["T3-STATEMENT-GAP", "T2-STATEMENT-GAP", "silently wrong"], ["T3-MERGER", "T2-BANK-FORMAT", "silently wrong"], ["T3-FX-REPRICE", "T2-FX-AUTH", "silently wrong"], ["T3-QIF-HOLE", "T2-OFX-HOLE", "silently wrong"], ["T3-POSTING-LAG", "T2-POSTING-LAG", "silently wrong"]];
const VERDICT = [
  "Partly. What fitted a shape held on a new layout. What fitted a family did not.",
  "Held or better: a Medicare credit under a payer that also pays a pension, five business days of lag over Christmas, a card charge dated in one month and posted in the next, a settlement behind a deposit, a balance and a loan, a merger in which no line doubled, and credits nobody can explain, which now mostly stand apart as unexplained instead of passing as spending.",
  "Did not hold: the guard against a false pair stopped one crossed pair and let another through on a shared word and a shared counterparty. Agent clearing matched none of twelve owner statements. A credit from someone the household never paid, a solicitor, landed as a refund, and so did a house sale and a car, so 36 months of spending came out at -339,108.33 against 132,359.00. Net worth kept all of a joint account after one owner left the household, kept a sold home for 14 month-ends, left out the fund's shares, and held a sterling balance as dollars.",
  "With no wage in the house, the engine finds 42,183.73 of 409,895.21 of income. All 215 pension credits it booked sit under UNCAT as unexplained, which is honest about not knowing, though both pension contracts in setup carry SUPER-PENSION and phase retirement.",
];
const AFTER = [
  "The household did not change. Bundle b824469ab1be030f, 2104 events, and every figure in the Scores table but the trap row are the first run's, to the cent, as is every table below it but the traps. What changed is the probes of four traps in build.js, what run.js counts for them, and two lines of wording. No money, no file and no setup row moved.",
  "First run: 18 handled, 26 flagged, 11 silently wrong. Now: 16 handled, 27 flagged, 12 silently wrong. Four traps moved, one up and three down, in the table below. The rebuild did not crash on either run.",
  "A scorer bug that overstated the error, which moved a trap up. T3-MERGER sampled the Harbour term deposit's interest line and wanted neither, against this household's own convention that any one of the three lines may carry that interest, which T3-TD-INT-ELSEWHERE measures and passes. Its balance probe also read the level of ACC-EVERY, which is off by exactly the T3-QIF-HOLE amount from August 2024 on, so one error landed on two traps. It now drops that line and reads the month-on-month change, which is exact in all three months. Silently wrong became flagged, and flagged only because two of its four lines are pensions the engine calls unexplained. No line doubled.",
  "Scorer bugs that understated the error, each moving a trap down. T3-OFFSET-NOT-LINKED's probe was the law probe from T2-OFFSET-INTEREST, where a pass is right. Here the trap says L6 cannot pass and it passed, with a widest gap of 364.79 against the 50.00 tolerance in schema/checks.json, so handled was wrong and it now reads silently wrong for that gap. T3-CARD-LOGIN sampled four of Geoffrey's lines and all four were fine, while the line table showed a purchase never booked. It now reads every card line of the quarter, 101 of them. One is gone: Salma's 150.82 at a grocer, which review reports as a restatement of Geoffrey's 154.33 there five days later. Only her lines are in that quarter's download. Review names it, so handled became flagged.",
  "Stricter after reading the first run, lowering a score, the same change BLIND-2 made to T2-CRYPTO-THIRD-COIN. T3-PENSION-UNREAD read flagged because this household widened the balance rule to any law at the account, and L13 shows a gap at ACC-PENSION. That gap says Missing 2023-07, and the same row appears on TAX-SALMA and STM-SMSF, whose files are all there: it would be there if every pension file had been read. It is not about the refused files, of which six count as received. Coverage must now name the refused periods, it does not, and the trap reads silently wrong for 165,277.80.",
  "Left on the stricter reading, though a looser one is arguable, and both would raise a score. T3-QIF-HOLE: L3 fails on ACC-EVERY with a gap of the hole to the cent, and L13 says Missing 2024-07 on the same account, but the interval L3 names ends 2024-11-26 and BLIND-2's rule wants the month from the law. T3-SMSF-ONE-LEVEL: L18 is open on the fund's party and states the 272,778.40, so the amount is in front of a person, but it says the money counts once, which is not true, and it does not name the account.",
  "Wording only. The uncategorised share printed -98.5%, a share of a total below zero, and now prints dollars. T3-QIF-HOLE's note said the amount was not named when L3's gap names it; it now says the month is what is missing. T3-SMSF-ONE-LEVEL now prints L18's row beside its evidence.",
  "The rerun's first line reads \"with uncommitted changes\" because another session left standard/reference/au-verified.json untracked in this worktree while this ran. It is not part of this work and is not committed with it. The bundle hash is unchanged. The scorer's perfect stand-in, run again, reads T3-OFFSET-NOT-LINKED as silently wrong only because the stand-in's L6 row says pass.",
];
const MOVES = [["T3-MERGER", "silently wrong", "flagged", "up"], ["T3-OFFSET-NOT-LINKED", "handled", "silently wrong", "down"], ["T3-CARD-LOGIN", "handled", "flagged", "down"], ["T3-PENSION-UNREAD", "flagged", "silently wrong", "down"]];
const SEEN = [
  "ACC-PENSION and ACC-KARIM have no balance rows at all. The 0.00 in the tables above is this reader's default for no row, as in the earlier scorers. The engine does not print a zero. Net worth simply leaves them out, and nothing says by how much.",
  "L18 ran for the first time in the held-out series. It is open on PTY-SMSF: 272,778.40 held inside it is left out of net worth, so it counts once. Nothing else counts it. The fund's bank and broker cash, typed smsf, stay in; its shares go. Tried once outside this table, with those two accounts typed transaction and brokerage, the law leaves out 549,217.61, the whole fund, and the super group disappears from net worth.",
  "Coverage rests on the call pattern, as BLIND-2 found. run.js passes every received file as a receipt, so ACC-PENSION reads 6 of 7 with all six refused. Tried once outside this table, passing only files that were read, it reads 0 of 5 and names 2023-07 to 2025-07.",
  "L6 for CON-BRIDGE reads 3 months checked, widest gap 364.79 in 2025-05, pass. Tried once outside this table, with the offsets link a person forgot, the widest gap is 107.69 and it still passes.",
  "ACC-EVERY stays out by 4,613.64 from August 2024 to June 2026, while the Harbour file from March 2025 states a running balance on every line. L3 reports one interval. The movements are right in 34 of 35 months.",
  "Every owner statement for the Portland unit is unmatched: one review item, 28,554.00 across twelve statements, and no rent_receipt event in 36 months, though the economic lens has each month's gross right and the reissued fee right. The agent's credits and the false sum are all unexplained. The false subset was not taken.",
  "The new bank's number has an alias starting on the merger date and its first file reaches back six days. No line was lost or doubled.",
  "ACC-KARIM has no file, so it has no balance. The 20,000.00 loan is a purchase under UNCAT and 23 repayments are unexplained, the 24th sitting in the QIF hole. L6 skips CON-KARIM: no rate history, for a rate of zero typed in setup.",
  "Six intake faults are the refused pension files and 38 are their lines. ACC-BROKER and ACC-SMSF-BROKER show coverage gaps for quarters with no activity, because this household's render writes no file for a quarter with no lines. That is a property of the render, not a trap, and it scored nothing. L3 reports those as quiet months, open.",
];

if (require.main === module) report(run());
module.exports = { run, report };
