#!/usr/bin/env node
/* Scores the engine on the sixth household it has never seen. Builds the Mulcahy-Bonettis, ingests their files, rebuilds with only their onboarding setup and the public dictionary and
   recipes, and compares every number with the simulation's truth. No decisions, no rules. Nothing here adjusts anything to improve a score. Report shape and scorer rules from the five earlier held-out folders.

   node standard/eval/heldout6/run.js        prints the report and writes BLIND-6.md beside this file */
"use strict";
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const STD = path.join(__dirname, "..", "..");
const { build, OUT, SETUP_DIR } = require("./build");

const CARD = "ACC-CARD";
const read = (p, d) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return d; } };
const money = (c) => (c == null ? "n/a" : `${c < 0 ? "-" : ""}${(Math.abs(c) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`);
const days = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 864e5;

function loadSetup() { const out = {}; for (const f of fs.readdirSync(SETUP_DIR)) if (f.endsWith(".json")) out[f.replace(".json", "")] = read(path.join(SETUP_DIR, f), []); return out; }

function run() {
  const { ingest, loadRecipes } = require("../../intake");
  const { rebuild } = require("../../engine/rebuild");
  const Engine = require("../../../src/engine.js");
  const built = build();
  Engine.loadMerchants({ merchants: read(path.join(STD, "..", "merchants", "merchants.json")), categories: read(path.join(STD, "..", "merchants", "categories.json")) });
  const manifest = read(path.join(OUT, "manifest.json")), truth = read(path.join(OUT, "truth.json")), recipes = loadRecipes(path.join(STD, "recipes"));
  const intake = ingest({ root: OUT, recipes, manifest });
  const schema = { events: read(path.join(STD, "schema", "events.json")), metrics: read(path.join(STD, "schema", "metrics.json")) };
  const reference = read(path.join(STD, "reference", "au.json"), null);
  const receipts = (intake.files || []).map((f) => { const parts = f.path.split("/"); return { stream_id: parts[1], day: parts[2] }; });
  const once = (setup, rules = []) => rebuild({ setup, sources: intake.sources, observations: intake.observations, decisions: [], rules, schema, reference, receipts });
  const setup = loadSetup(); let L, crash = null;
  const where = (e) => String(e.stack).split("\n").filter((x) => /engine\//.test(x)).map((x) => x.trim().replace(/^.*standard\//, "standard/").replace(/\)$/, ""));
  try { L = once(setup); } catch (e) { crash = { message: e.message, at: where(e).slice(0, 4) }; console.log(JSON.stringify({ crash }, null, 1)); console.log(String(e.stack).split("\n").slice(0, 12).join("\n")); process.exit(1); }
  return { L, truth, intake, manifest, setup, crash, built, again: (rules) => once(setup, rules) };
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
  const asked = (account, date, cents, post, wide) => { const w = Math.max(account === CARD ? 3 : 0, wide || 0); return L.review.filter((r) => { const p = String(r.ref).split("|"); return p[0] === account && p[1] && /^\d{4}-/.test(p[1]) && Math.min(days(p[1], date), post ? days(p[1], post) : Infinity) <= w && Number(p[2]) === cents; }); };
  // a doubled line is only asked about when the question is whether it is doubled; a question about the merchant does not put the double in front of anyone
  const askedDup = (account, date, cents, post) => L.review.filter((r) => { if (r.kind !== "possible_duplicate") return false; const p = String(r.ref).split("|"); return p[0] === account && Math.abs(Number(p[2]) - cents) <= 300 && Math.min(days(p[1], date), post ? days(p[1], post) : Infinity) <= 9; });
  // review items that name a statement or an assessment rather than a line
  const askedOther = (x, found) => L.review.filter((r) => {
    const what = String(r.what || "");
    if (r.kind === "restated_line") { const q = String(r.ref).split("|"); return q[0] === x.account && what.includes(money(Math.abs(x.cents))) && days(q[1], x.date) <= 14; }
    if (r.kind === "tax_result_unmatched") return found.some((e) => /^(BPAY )?ATO\b/.test(e.description || ""));
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
  const uncat = L.cash.filter((c) => months.includes(c.month)).reduce((t, c) => t + Math.max(0, -((c.byCategory || {}).UNCAT || 0)), 0), spent = L.cash.filter((c) => months.includes(c.month)).reduce((t, c) => t + c.spending, 0);
  const monthly = months.map((m) => ({ m, inc: [truth.income[m], inc.get(m) || 0], sp: [truth.spending[m], sp.get(m) || 0], nw: [truth.networth[m], nw.get(m) || 0] }));
  return { rows, perAcct, bal, uncategorised_share: spent > 0 ? uncat / spent : 0, uncategorised_cents: uncat, monthly };
}

// ---------- every cash line, one by one: did the engine book it once, and treat it as truth does ----------
function reconcile(L, truth, R) {
  const pool = new Map(); truth.cash_lines.forEach((x, i) => { const k = `${x.account}|${x.cents}`; if (!pool.has(k)) pool.set(k, []); pool.get(k).push({ ...x, i }); });
  const taken = new Set(), legs = [], extra = [], wrong = {};
  for (const e of L.events) { if (e.kind === "opening_balance") continue; for (const p of e.postings || []) { if (R.cashAcct.has(p.account_id)) legs.push({ e, account: p.account_id, cents: p.amount_cents, dates: R.datesOf(e, p.account_id) }); } }
  for (const pass of [0, 1, 6, 14]) for (const v of legs) {
    if (v.t) continue;
    let best = null, gap = Infinity;
    for (const x of pool.get(`${v.account}|${v.cents}`) || []) { if (taken.has(x.i)) continue; const d = Math.min(...v.dates.flatMap((q) => [days(x.date, q), x.posted ? days(x.posted, q) : Infinity])), rank = d + (x.lens === R.treat(v.e) ? 0 : 0.25); if (d <= pass && rank < gap && (pass <= 1 || v.account === CARD || x.own)) { best = x; gap = rank; } }
    if (best) { taken.add(best.i); v.t = best; }
  }
  const effect = { income: 0, spending: 0 };   // what each class of error does to the 36-month totals, so the table adds up to the gap
  const inWin = (d) => d >= truth.window[0] && d <= truth.window[1];
  for (const v of legs) {
    if (!v.t) { extra.push(v); continue; }
    const got = R.treat(v.e);
    if (got === v.t.lens) continue;
    const k = `${v.t.lens} booked as ${got}`, w = (wrong[k] = wrong[k] || { count: 0, cents: 0, income: 0, spending: 0, examples: new Set() });
    w.count += 1; w.cents += Math.abs(v.cents); if (w.examples.size < 3) w.examples.add(v.t.what.replace(/\s+/g, " "));
    if (inWin(v.t.date)) {
      if (v.t.lens === "income") w.income -= v.cents; if (v.t.lens === "spending") w.spending += v.cents;
      if (got === "income") w.income += v.cents; if (got === "spending") w.spending -= v.cents;
    }
  }
  const missing = truth.cash_lines.filter((x, i) => !taken.has(i) && x.cents !== 0 && x.date >= truth.window[0] && x.date <= truth.window[1]);
  const missedByLens = (l) => missing.filter((x) => x.lens === l).reduce((t, x) => t + x.cents, 0);
  const windowExtra = extra.filter((v) => v.dates.some(inWin));
  for (const v of windowExtra) { const got = R.treat(v.e); if (got === "income") effect.income += v.cents; if (got === "spending") effect.spending -= v.cents; }
  const dup = L.review.filter((r) => r.kind === "possible_duplicate"), cards = extra.filter((v) => v.account === CARD && R.treat(v.e) === "spending");
  const asked = cards.filter((v) => dup.some((r) => { const p = String(r.ref).split("|"); return p[0] === CARD && Number(p[2]) === v.cents && v.dates.some((d) => days(p[1], d) <= 9); })).length;
  const lagOf = (v) => { const c = (pool.get(`${CARD}|${v.cents}`) || []).find((x) => x.posted && v.dates.some((d) => days(x.date, d) <= 14 || days(x.posted, d) <= 14)); return c ? days(c.date, c.posted) : null; };
  const byLag = {}; for (const v of cards) { const l = lagOf(v); byLag[l == null ? "unmatched" : l] = (byLag[l == null ? "unmatched" : l] || 0) + 1; }
  const paired = truth.own_transfers.filter((x) => { const a = R.find(x.from, x.date_out, -(x.sent || x.cents), 6, x.date_in), b = R.find(x.to, x.date_in, x.cents, 6, x.date_out); const good = (e) => R.treat(e) === "neither" && e.kind !== "open_transfer"; return a.some(good) && b.some(good); }).length;
  const extraBy = {}; for (const v of extra) { const k = `${v.account} ${v.e.kind}`, w = (extraBy[k] = extraBy[k] || { count: 0, cents: 0, example: v.e.description || "" }); w.count += 1; w.cents += v.cents; }
  return { lines: truth.cash_lines.length, matched: taken.size, extra: extra.length, extra_cents: extra.reduce((t, v) => t + v.cents, 0), extraBy, missing: missing.length, missing_cents: missing.reduce((t, x) => t + x.cents, 0), missing_list: missing, missed: { income: -missedByLens("income"), spending: missedByLens("spending") }, effect, wrong, card_doubles: { count: cards.length, cents: cards.reduce((t, v) => t - v.cents, 0), asked, by_lag: Object.entries(byLag).map(([d, n]) => (d === "unmatched" ? `${n} with no line to match` : `${n} posted ${d} days after the charge`)).join(", ") }, own: { paired, of: truth.own_transfers.length } };
}

// ---------- each planted trap: handled, flagged, or silently wrong ----------
function judgeLine(R, x) {
  const found = R.find(x.account, x.date, x.cents, x.wide, x.posted), treatments = found.map(R.treat);
  const mixed = x.want.startsWith("mixed:"), n = x.n || 1, want = mixed ? x.want.slice(6).split(",").sort() : Array(n).fill(x.want);
  const sameTreat = JSON.stringify(treatments.slice().sort()) === JSON.stringify(want);
  const fine = sameTreat && (!x.month || found.every((e) => (e.charged_on || e.occurred_on).slice(0, 7) === x.month)) && (!x.cat || found.every((e) => e.category_id === x.cat));
  const said = `${x.account} ${x.date} ${money(x.cents)}: want ${x.want}${n > 1 && !mixed ? ` x${n}` : ""}${x.month ? ` in ${x.month}` : ""}${x.cat ? ` under ${x.cat}` : ""}, got ${found.length ? found.map((e, i) => `${e.kind}/${e.category_id || "no category"}/${treatments[i]}${x.month ? ` on ${e.charged_on || e.occurred_on}` : ""}`).join(", ") : "no event"}`;
  if (fine) return { outcome: "handled", said, dollars: 0 };
  // the dollars a wrong line moves: how far its count and treatment sit from what truth wants
  const dollars = found.length !== n ? Math.abs(x.cents) * Math.max(1, Math.abs(found.length - n)) : Math.abs(x.cents);
  const flagged = found.length > n ? R.askedDup(x.account, x.date, x.cents, x.posted).length : R.asked(x.account, x.date, x.cents, x.posted, x.wide).length + R.askedOther(x, found).length;
  return { outcome: flagged ? "flagged" : "silently wrong", said, dollars };
}
const worstOf = (list) => (list.includes("silently wrong") ? "silently wrong" : list.includes("flagged") ? "flagged" : "handled");

function judge(trap, ctx) {
  const { R, L, truth, intake } = ctx, p = trap.probe, notes = [], outcomes = []; let cents = 0, flaggedCents = 0;
  const tallyOf = (o, c) => { if (o === "silently wrong") cents += c; else if (o === "flagged") flaggedCents += c; };
  const months = Object.keys(truth.income);
  // a balance is flagged by a law that fails or shows a gap at that account, or a review item about the account itself. A question about one of its lines does not put the balance in front of anyone
  const nameOf = (a) => (L.accounts.find((x) => x.account_id === a) || {}).name || a;
  const lawBad = (a) => L.checks.some((c) => c.law !== "L7" && String(c.scope) === a && !["pass", "skip", "accepted"].includes(c.status)) || L.review.some((r) => !["uncategorised", "possible_duplicate"].includes(r.kind) && (String(r.ref) === a || String(r.what || "").includes(a) || String(r.what || "").includes(nameOf(a)) || String(r.question || "").includes(nameOf(a))));
  const lines = (p.lines || []).map((x) => judgeLine(R, x));
  for (const l of lines) { outcomes.push(l.outcome); tallyOf(l.outcome, l.dollars); }
  const bad = lines.filter((l) => l.outcome !== "handled");
  if (p.clearing) {
    const cs = L.checks.filter((x) => x.law === "L2" && String(x.scope).startsWith(p.clearing)), off = cs.filter((c) => c.status !== "pass");
    notes.push(`${p.clearing}: ${cs.length ? off.length ? off.map((c) => `${c.scope} ${c.status}${c.gap_cents != null ? ` ${money(c.gap_cents)}` : ""}`).join(", ") : "pass" : "no check"}`);
    if (off.length) outcomes.push("flagged");
  }
  for (const b of p.balances || []) {
    const off = b.months.filter((m) => truth.balances[b.account][m] !== R.balance(b.account, m)), worst = off.reduce((t, m) => Math.max(t, Math.abs(truth.balances[b.account][m] - R.balance(b.account, m))), 0);
    notes.push(`${b.account}: ${b.months.length - off.length} of ${b.months.length} month-ends exact${off.length ? `, worst ${money(worst)} off` : ""}`);
    if (off.length) { const o = b.strict ? "silently wrong" : lawBad(b.account) ? "flagged" : "silently wrong"; outcomes.push(o); tallyOf(o, worst); }
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
  /* what the engine holds out of a group: the sum of the accounts' balances less the group's line in net worth */
  if (p.excluded) for (const x of p.excluded) {
    const row = L.netWorth.find((n) => n.month === x.month), accts = x.accounts === "cash" ? [...R.cashAcct] : x.accounts, sum = accts.reduce((t, a) => t + R.balance(a, x.month), 0), got = sum - ((row && row.groups && row.groups[x.group]) || 0), gap = Math.abs(got - x.want);
    notes.push(`${x.month}: ${money(got)} held out of ${x.group} in net worth, truth ${money(x.want)}`);
    if (gap > (x.tolerance || 0)) { const o = lawBad(x.named) ? "flagged" : "silently wrong"; outcomes.push(o); if (o === "flagged") flaggedCents = Math.max(flaggedCents, gap); else cents = Math.max(cents, gap); }
  }
  if (p.absent) for (const x of p.absent) {
    const f = R.find(x.account, x.date, x.cents, x.account === CARD ? 9 : 2, x.posted);
    notes.push(`${x.account} ${money(x.cents)} near ${x.date}: ${f.length ? `booked, ${f.map((e) => `${e.kind}/${e.category_id || "no category"}`).join(", ")}` : "not booked"}`);
    if (f.length) { const o = (x.account === CARD ? R.askedDup(x.account, x.date, x.cents, x.posted) : R.asked(x.account, x.date, x.cents, x.posted)).length ? "flagged" : "silently wrong"; outcomes.push(o); tallyOf(o, Math.abs(x.cents)); }
  }
  /* a file nobody declared: any event at all that carries one of its lines. Asked about means review names that line. */
  if (p.stray) {
    const re = new RegExp(p.stray.match), hits = L.events.filter((e) => re.test(JSON.stringify(e)));
    const cashOf = (e) => (e.postings || []).filter((q) => q.account_id && !/^(cat|clearing|equity|ato|memo|receivable):/.test(q.account_id));
    const asked = (e) => cashOf(e).some((q) => R.asked(q.account_id, e.occurred_on, q.amount_cents).length);
    const unasked = hits.filter((e) => !asked(e)), dollars = hits.reduce((t, e) => t + cashOf(e).reduce((u, q) => u + Math.abs(q.amount_cents), 0), 0);
    notes.push(`${hits.length} events carry its lines, ${money(dollars)}, ${hits.length - unasked.length} of them asked about`);
    if (hits.length) { const o = unasked.length ? "silently wrong" : "flagged"; outcomes.push(o); tallyOf(o, dollars); }
  }
  /* a month's figure that a line of someone else's would swamp: the engine's income or spending must stay under it */
  if (p.cap) for (const x of p.cap) {
    const row = L.cash.find((c) => c.month === x.month), got = row ? row[x.metric] || 0 : 0, over = got >= x.under;
    notes.push(`${x.month} ${x.metric} ${money(got)}, ${over ? "at or above" : "under"} ${money(x.under)}`);
    if (over) { const o = R.asked(x.account, x.date, x.cents).length ? "flagged" : "silently wrong"; outcomes.push(o); tallyOf(o, Math.abs(x.cents)); }
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
  if (p.unread) {
    const u = intake.unknown_files.filter((f) => f.path.startsWith(p.unread));
    notes.push(`${u.length} files unread and reported by intake`);
  }
  return { id: trap.id, name: trap.name, fresh: trap.fresh, dc: trap.dc, where: trap.where, expect: trap.expect, outcome: worstOf(outcomes), cents, flaggedCents, lines_ok: lines.filter((l) => l.outcome === "handled").length, lines_total: lines.length, notes, bad: bad.slice().sort((a, b) => (a.outcome === "silently wrong" ? -1 : 1) - (b.outcome === "silently wrong" ? -1 : 1)).map((l) => `${l.outcome}: ${l.said}`) };
}

// ---------- the report ----------
function report(r, o = {}) {
  const { L, truth, intake } = r, R = Reader(L, r.setup), T = scoreTable(L, truth, R);
  const rec = reconcile(L, truth, R);
  const traps = truth.traps.map((t) => judge(t, { R, L, truth, intake, rec }));
  const tally = { handled: 0, flagged: 0, "silently wrong": 0 }; for (const t of traps) tally[t.outcome] += 1;
  const reviewKinds = {}; for (const x of L.review) reviewKinds[x.kind] = (reviewKinds[x.kind] || 0) + 1;
  const laws = {}; for (const c of L.checks) { const k = c.law; (laws[k] = laws[k] || {})[c.status] = (laws[k][c.status] || 0) + 1; }
  let head = "unknown", dirty = "";
  try { head = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: STD }).toString().trim(); dirty = execFileSync("git", ["status", "--porcelain", "--", "engine", "intake", "schema", "recipes", "reference"], { cwd: STD }).toString().trim() ? " with uncommitted changes under standard/" : ""; } catch (e) { /* no git, no matter */ }
  const out = [];
  const p = (s = "") => out.push(s);
  p("# Sixth held-out household: Mulcahy-Bonetti");
  p();
  p(`Generated by \`node standard/eval/heldout6/run.js\`. Engine at ${head}${dirty}. Bundle ${L.bundleHash}. ${intake.sources.length} sources, ${intake.observations.length} observations, ${L.events.length} events, ${intake.unknown_files.length} unread, ${intake.faults.length} intake faults. No decisions, no rules. Public recipes and dictionary, and one family's onboarding answers.`);
  p();
  p("## Scores");
  p();
  p("| Measure | Exact months | Mean error a month | Truth, 36 months | Engine, 36 months | Worst month |");
  p("|---|---|---:|---:|---:|---|");
  for (const x of T.rows) p(`| ${x.name} | ${x.exact} of ${x.of} | ${money(x.mae)} | ${x.name === "Net worth" ? `${money(truth.networth["2026-06"])} at June 2026` : money(x.truth_total)} | ${x.name === "Net worth" ? `${money((L.netWorth.find((n) => n.month === "2026-06") || {}).total)} at June 2026` : money(x.engine_total)} | ${x.worst.m}, off by ${money(x.worst.d)} |`);
  p(`| Balances, account-months | ${T.bal.exact} of ${T.bal.of} | | | | ${T.bal.all_exact_months} months with every account exact |`);
  p(`| Balance movements, account-months | ${T.bal.moved} of ${T.bal.moved_of} | | | | right change month on month, whatever the opening |`);
  p(`| Review items | ${L.review.length} | | | | ${Object.entries(reviewKinds).map(([k, v]) => `${k} ${v}`).join(", ")} |`);
  p(`| Traps | ${tally.handled} handled, ${tally.flagged} flagged, ${tally["silently wrong"]} silently wrong, of ${traps.length} | | | | ${traps.filter((t) => t.fresh).length} in none of the earlier lists, ${traps.filter((t) => t.dc).length} new double-count or silent-number variants |`);
  p();
  { const ms = Object.keys(truth.income), un = L.cash.filter((c) => ms.includes(c.month)).reduce((t, c) => t + (c.unexplained || 0), 0);
    p(`Money the engine says it cannot explain, neither income nor spending, across 36 months: ${money(un)}.`);
    p(); }
  const asks = new Map(); for (const x of L.review.filter((i) => i.kind === "uncategorised")) asks.set(x.question, (asks.get(x.question) || 0) + Math.abs(x.amount_cents));
  const byValue = [...asks.values()].sort((a, b) => b - a), total = byValue.reduce((a, b) => a + b, 0), top = byValue.slice(0, 30).reduce((a, b) => a + b, 0);
  const allAsks = new Set(L.review.map((x) => `${x.kind}|${x.question || x.what || x.ref}`));
  p(`Spending left uncategorised: ${T.uncategorised_share > 0 ? `${(T.uncategorised_share * 100).toFixed(1)}% of the dollars` : `${money(T.uncategorised_cents)}, and no share of a spending total that nets below zero`}. Every merchant is invented, so the dictionary knows few of them; uncategorised spending still counts as spending. The ${L.review.filter((i) => i.kind === "uncategorised").length} uncategorised lines are ${asks.size} questions, one per merchant, and the first 30 cover ${(top / (total || 1) * 100).toFixed(1)}% of their dollars. The whole review queue is ${L.review.length} items and ${allAsks.size} distinct questions.`);
  p();
  p("## Did the repairs hold");
  p();
  for (const v of VERDICT) { p(v); p(); }
  { const byId = new Map(traps.map((t) => [t.id, t])), rank = { "silently wrong": 0, flagged: 1, handled: 2 }, fresh = traps.filter((t) => t.fresh), n = (o2) => fresh.filter((t) => t.outcome === o2).length, way = { better: 0, same: 0, worse: 0 };
    p(`${REPEATS.length} shapes repeat an earlier family's, on this family's files. "Then" is the last blind run that met the shape. The rest of the traps are new.`);
    p();
    p("| This household | Earlier trap | Then, last blind run | Now | Way |");
    p("|---|---|---|---|---|");
    for (const [a, b, then] of REPEATS) { const now = byId.get(a).outcome, d = rank[now] - rank[then], w = d > 0 ? "better" : d < 0 ? "worse" : "same"; way[w] += 1; p(`| ${a} | ${b} | ${then} | ${now} | ${w} |`); }
    p();
    p(`Of the ${REPEATS.length}: ${way.better} better, ${way.same} the same, ${way.worse} worse. The ${fresh.length} shapes in none of the earlier lists: ${n("handled")} handled, ${n("flagged")} flagged, ${n("silently wrong")} silently wrong.`);
    p(); }
  const dollarsSW = traps.filter((t) => t.outcome === "silently wrong");
  p("## Silently wrong, with the dollars");
  p();
  p("Dollars are the gross amount on the wrong lines, or the worst balance error, and they overlap.");
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
  const gapI = T.rows[0].engine_total - T.rows[0].truth_total, gapS = T.rows[1].engine_total - T.rows[1].truth_total;
  p(`The 36-month gaps by cause. Income: engine less truth ${money(gapI)}; wrong treatment ${money(sumW("income"))}, extra legs ${money(rec.effect.income)}, lines never booked ${money(rec.missed.income)}, unexplained ${money(gapI - sumW("income") - rec.effect.income - rec.missed.income)}. Spending: engine less truth ${money(gapS)}; wrong treatment ${money(sumW("spending"))}, extra legs ${money(rec.effect.spending)}, lines never booked ${money(rec.missed.spending)}, unexplained ${money(gapS - sumW("spending") - rec.effect.spending - rec.missed.spending)}. Unexplained is what crosses the window's edge or moves in a way this sum does not model.`);
  p();
  p("## Balances by account");
  p();
  p("| Account | Exact month-ends | Exact movements | Mean error | June 2026, truth | June 2026, engine |");
  p("|---|---|---|---:|---:|---:|");
  for (const a of T.perAcct) p(`| ${a.account} | ${a.exact} of ${a.of} | ${a.moved} of ${a.moved_of} | ${money(a.mae)} | ${money(a.last.truth)} | ${money(a.last.engine)} |`);
  p();
  p("## Traps");
  p();
  p("Handled: the number is right. Flagged: the number is wrong or unknowable, and the engine put that line, account or month in front of a person. Silently wrong: the number is wrong and nothing says so. New: in none of the earlier lists. DC: a new variant of double counting or of a number silently wrong.");
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
  const refused = {}; for (const f of intake.faults.filter((x) => x.code === "file_refused")) { const k = `${f.path.split("/")[1]}: refused by intake`; refused[k] = (refused[k] || 0) + 1; }
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
  if (!o.dry) fs.writeFileSync(path.join(__dirname, "BLIND-6.md"), `${out.join("\n")}\n`);
  if (o.dry) return { tally, traps, rec, T };
  console.log(out.join("\n"));
}
const NOTES = [
  "Blind. Written from SPEC.md, RECIPES.md, the schemas, schema-card.md, the public recipes, the intake, the world's file writers, and the build, run and blind report of the five earlier held-out folders, with answers.js and heldout5/standin.js. Not read: the engine, score.js, ladder.js, eval/households, the Davies domains, src, merchants, reference, any RESULT.md, the scoreboard, any changelog, GOVERNANCE.md, or any diff of them. No git log, show or diff was run. run.js calls rebuild and the public dictionary loader without either being opened, and reads rebuild's output by the names the earlier run.js files use. Files were checked by running the intake alone, which is not the engine, and the intake was also run over the five earlier households' built files to see which recipes each had used. One thing a reader should know: heldout5/run.js as it stands is the script after BLIND-5's repairs, and BLIND-5.md and SPEC.md say in words what several repairs do: a lender who is also a relative is read as a loan only where the line says so, a credit larger than the most ever paid to a payee is not a refund, lines well after an account closed are held out as evidence, an asset carried at a value is gone from the day setup closes it. All of that is public and in the allowed list, and it was read before the traps were chosen. The traps were chosen from the shape. Three sit close to those sentences and should be weighed knowing it: T6-STORM-CLAIM, where a credit above any payment really is a recovery; T6-STRAY-FILE, where the account in the folder is open and not closed; and T6-CARAVAN-SOLD, which is that repair met again on purpose, as the shape repeats.",
  "The sixth shape: a couple caring for a parent. A fitter paid weekly at a dairy factory. An enrolled nurse with part of her pay packaged to the home loan, who resigns in March 2024 to care for her mother and claims Carer Payment and Carer Allowance, holds a power of attorney over her mother's accounts, becomes her Age Pension nominee in August 2024, and goes back to the same hospital in May 2026. Her mother pays for a granny flat through their account, moves into it and pays board, sells her house, lends them 30,000.00, goes into care in June 2025, and dies on 9 February 2026. Her will forgives the loan and a joint saver passes to Dee by survivorship. An adult son boards, a daughter at university is sent rent, a caravan is sold. No rental, no shares, no business. BLIND-3 met some of this from the side of a retired couple: a deposit through the household, fees paid back, an estate in pieces, a brother's share. Those shapes are marked as repeats. What is new is a declared account that is someone else's, on the other side of many of the household's lines.",
  "Files. New to the held-out series: Harbour's CSV as the main account; PING as a home lender, with its rate notice; Purrannuation's v1 layout as a running fund; Purrsure's renewal; Bupaw's statement; VicPaws' rego notice; the valuer's opinion of value; and a PDF tax invoice. Their fingerprints were recovered by searching line layouts against each recipe's public hash. gas-bill-html's could not be, because its page title is inside the hash and nothing public says what it is, so there is no gas bill. agent-return-pdf, the work logs and the prefill are not used. Centrelink payment summaries, the power of attorney, the residential agreement, the grant of probate and the funeral account have no public recipe, so they are in the household and unread, and listed below. The public income statement recipe refuses Paul's three statements: a weekly pay list runs to a second page, whose band tagline the recipe does not hold as furniture, and the gate fails the file. That was found by running the intake. The layout is the earlier households' with 52 rows in it, the files stay as they are, and they are listed below as refused. stream.cadence has no weekly, so his payslips are declared as an event stream, and the contract's pay_cadence says weekly.",
  "Budgets read the charge date and balances read the posting date. A charge in two files is one charge. Where a statement and a download disagree on the amount, the statement is the charge, because it closes on it.",
  "Cash income and spending follow SPEC 6.5 and the treatment rule of the earlier scorers. `unexplained` on an event or a month is the money the engine says it cannot explain: neither income nor spending. Wages count at the net banked, on the day banked. Carer Payment, Carer Allowance, the Carer Supplement, the bereavement lump, board from her mother and from Liam, gifts, the inheritance under GIFT-IN and interest on the household's own saver are income. An overpaid benefit taken back is a negative in income. Loan repayments and the 100,000.00 lump count at their cash amount, as T-EXTRA-REPAYMENT and T-CAR-PAYOUT did. An insurer's claim lowers the cost it pays for. An ATM withdrawal is spending when withdrawn, because no cash account is declared.",
  "Neither: own transfers, card payments, tax refunds and payments, a spouse super contribution, the redraw, the loan from her mother and its repayments, the caravan sale, and every dollar of hers that crosses the household's rails. That is the flat's money and the builder's claims, the nominee pension and its forwarding, what she buys on the household's card and the lumps that repay it, the Medicare refunds on her claims, her aged-care fees, her rates, the top-ups of her account and their repayment, Carlo's share, the funeral and the estate's repayment of it, the half of an estate credit that is Carlo's, and a pension paid after her death and its recovery. The one line of hers that is the household's cost is T6-WRONG-LOGIN: the debit that repays her for their water bill is spending under UTILITIES, because it is the only line that pays that bill.",
  "Her accounts. A person would not leave her account out of onboarding: Dee runs it and holds the files, and the attorney's duty is to keep them. So it is declared, owned 100% by her on every basis, no membership row, reporting group memo, in_scope false, with a note. The cash lens reads the cash group by SPEC 6.5, and a household holds what its members own by SPEC 6.6, so this is the strongest declaration the vocabulary offers, and it is made so that no one choice in setup sets the whole score, as BLIND-5 said of the company. Whether her money reaches income or spending by way of a pairing with that account is then the engine's to answer. Her second account, a term saver, is declared nowhere, and only its one stray quarter reaches any folder. The joint saver is the other way: it has Dee's name on it, so a person lists it as a bank account in the cash group with the ownership rows by basis (legal half each, beneficial and tax all hers, all Dee's from the day she dies). Truth takes the beneficial basis: SPEC 4.3 names exactly this case. If a reader prefers the legal basis, T6-BENEFICIAL-JOINT scores differently, and only that trap and net worth by half its balance move.",
  "Net worth in truth carries money in the air between own accounts, as the earlier scorers did: card payments a day out, and a spouse contribution four days out, which crosses no month-end. It excludes the tax position. The home is at the latest estimate or opinion, the car and caravan at the value typed in setup, the caravan leaving on the day it goes. What she owes the household between a purchase and the lump is a receivable, which stays out of headline net worth by SPEC 4.4c, so truth's cash and card simply stand as the files show them. The flat shows only in the home's next estimate, and no debt to her is held for it. The debt to her stands until the day of her death and the will forgives it. It is declared closed that day, with no bank line, as the caravan is.",
  "Setup gives no opening balance a file states. Categories are the public list with PASS-THROUGH, SUPER-PENSION and SELLING-COSTS, and two rows by SPEC 12: carer payments and board received. A person would declare the employers, the loans, the insurance, the utilities, the carer payments and the aged-care fees paid for her (PASS-THROUGH, as T3-CARE-FEES did), and her board. So contracts carry them, and her party holds two: the board and the loan. Deliberate omissions are what a person would leave out: no word of the nominee arrangement, the packaging, the builder, the reimbursements, Liam's board, Carlo's share, the storm claim or the solicitor. Her house is not declared as anything. Nothing in setup was chosen by reading what a trap needs and then adding it, and no rule or decision is given.",
  "T6-NOMINEE-PENSION, T6-MUM-ON-CARD, T6-MUM-RATES, T6-MUM-MEDICARE, T6-BUILDER-THROUGH, T6-HOUSE-TOPUP, T6-FUNERAL, T6-SIBLING-SHARE, T6-PENSION-RECALL, T6-BOARD-SON, T6-ESTATE, T6-BROTHER-SHARE and T6-REIMB are facts an engine can only learn by asking, or by a person's rule. A question over the line scores flagged and is the honest best. Silence scores silently wrong, even where SPEC 8 declares the limit: a limit that is declared still leaves a wrong number.",
  "T6-STRAY-FILE: every line of the stray file carries a marker no other file has, and the probe reads every event for it, as in BLIND-5. No event carrying one is handled. Events all named by review are flagged. Any event carrying one and not named is silently wrong. A file left unposted is right, whether intake or the engine left it. T6-TRUNCATED and T6-STATEMENT-GAP are the two gaps nobody can fill: the most they can score is flagged. T6-REGO-AFTER-SALE lets a bill with no payment be asked about and scores only a cost booked with no line, as T5-CO-PAID-BILL did. T6-OFX-OVERLAP rests on the public writer, as T5-OFX-OVERLAP did. T6-PACKAGED-PAY and T6-REDRAW read the lender's download and statement, and PING's statement has no redraw column, so that month's repayments are printed net of it. The redraw is 3,500.00 in a month of three debits for that reason: the public recipe cannot read a negative repayment.",
  "Scoring is BLIND-5's, in the same code: Reader, reconcile, judgeLine and judge are copied from heldout5/run.js, with its fix to askedOther. One probe is added, `cap`: a month's income or spending must stay under a figure a line of hers would swamp, because her account is not read line by line. It scores silently wrong over the figure unless review names the line. A flagged outcome needs the engine to name the line in review, or a law that fails or shows a gap on that account, or coverage that names the month. For a hole in a bank file the law must name the month. A doubled line counts as asked only if review asks whether it is doubled. A balance is flagged by any law scoped at that account, or by a review item about the account rather than one of its lines. A file refused or unread by intake is a report of the intake and does not by itself flag a number. Tax is not scored: L11 is printed as the engine reports it. A trap's probes are lines, balances and coverage: category is read only where the trap's text names one.",
  "Before the first run the scorer was tried on a perfect stand-in built from the simulation's own book, never the engine (standin.js): 63 handled, and 2 flagged, the two gaps nobody can fill (T6-TRUNCATED, T6-STATEMENT-GAP). So every other probe can pass. It matched all the cash lines and paired all the own transfers. Lines in the hole of T6-TRUNCATED are in truth and in the stand-in, so a stand-in match says nothing about them. The one change the stand-in forced: the net worth it builds reads a held-out series from truth, because her saver is held out of the cash group by month."
];
/* [this household, earlier trap, outcome at the last blind run that met the shape] */
const REPEATS = [["T6-ATM", "T5-ATM", "handled"], ["T6-UNI-RENT", "T-TEEN-ACCOUNT", "handled"], ["T6-PAY-STRADDLE", "T5-PAY-STRADDLE", "handled"], ["T6-SLIP-MISSING", "T5-NO-PAYSLIP", "handled"], ["T6-NET-PAY-SPLIT", "T5-NET-PAY-SPLIT", "handled"], ["T6-PAY-IN-PARTS", "T5-PAY-IN-PARTS", "handled"], ["T6-REIMB", "T5-REIMB", "flagged"], ["T6-CARER-TWO-CREDITS", "T4-CENTRELINK", "handled"], ["T6-SUPPLEMENT", "T4-FTB-TOPUP", "handled"], ["T6-BENEFIT-DEBT", "T4-BENEFIT-DEBT", "flagged"], ["T6-MEDICARE-SA", "T5-MEDICARE-SA", "handled"], ["T6-BUILDER-THROUGH", "T3-RAD-THROUGH", "flagged"], ["T6-MUM-GIFT", "T4-MUM-GIFT", "flagged"], ["T6-SAME-NAME", "T4-SAME-NAME-MUM", "flagged"], ["T6-MUM-LOAN", "T5-BROTHER-LOAN", "silently wrong"], ["T6-DISHONOUR", "T5-DISHONOUR-LOAN", "handled"], ["T6-EXTRA-REPAY", "T-EXTRA-REPAYMENT", "handled"], ["T6-CARAVAN-SOLD", "T5-BOAT-SOLD", "silently wrong"], ["T6-BILL-WITNESS", "T5-BILL-WITNESS", "handled"], ["T6-MUM-ON-CARD", "T5-MATERIALS", "flagged"], ["T6-CARE-FEES", "T3-CARE-FEES", "flagged"], ["T6-ESTATE", "T3-ESTATE", "flagged"], ["T6-BROTHER-SHARE", "T3-BROTHER-SHARE", "flagged"], ["T6-PERSONAL-SUPER", "T5-PERSONAL-SUPER", "flagged"], ["T6-TAX-REFUND", "T5-TAX-REFUND", "handled"], ["T6-TAX-BILL", "T5-TAX-BILL", "flagged"], ["T6-FALSE-PAIR", "T5-FALSE-PAIR", "flagged"], ["T6-REFUND-STREAM", "T5-REFUND-STREAM", "handled"], ["T6-FX-REPRICE", "T5-FX-REPRICE", "silently wrong"], ["T6-HOLIDAY-LAG", "T5-HOLIDAY-LAG", "handled"], ["T6-INVOICE", "T2-THREE-WITNESS", "handled"], ["T6-STRAY-FILE", "T5-STRAY-FILE", "silently wrong"], ["T6-OFX-OVERLAP", "T5-OFX-OVERLAP", "handled"], ["T6-TRUNCATED", "T5-TRUNCATED", "flagged"], ["T6-POSTING-LAG", "T5-POSTING-LAG", "silently wrong"], ["T6-DATE-BASIS", "T5-DATE-BASIS", "handled"], ["T6-STATEMENT-GAP", "T5-STATEMENT-GAP", "flagged"]];
const VERDICT = [];
const AFTER = [];
const MOVES = [];
const SEEN = [];
if (require.main === module) report(run());
module.exports = { run, report, Reader, loadSetup, NOTES };
