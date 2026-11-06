#!/usr/bin/env node
/* Scores the engine on the seventh household it has never seen. Builds the Singh-Kaurs, ingests their files, rebuilds with only their onboarding setup and the public dictionary and
   recipes, and compares every number with the simulation's truth. No decisions, no rules. Nothing here adjusts anything to improve a score. Report shape and scorer rules from the six earlier held-out folders.

   node standard/eval/heldout7/run.js        writes BLIND-7.md beside this file, and rebuild's output to .build/heldout7/rebuild.json, once. It will not overwrite: --rerun says you mean it */
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
  const askedAny = R.asked(x.account, x.date, x.cents, x.posted, x.wide).length + R.askedOther(x, found).length;
  /* a contract's plainly regular money: right is not enough, it must be read without a question. Asked about, the line scores flagged, whatever its number */
  if (fine && x.quiet && askedAny) return { outcome: "flagged", said: `${said}, right, and asked about`, dollars: 0, right: true, asked: true };
  if (fine) return { outcome: "handled", said, dollars: 0, right: true, asked: false };
  // the dollars a wrong line moves: how far its count and treatment sit from what truth wants
  const dollars = found.length !== n ? Math.abs(x.cents) * Math.max(1, Math.abs(found.length - n)) : Math.abs(x.cents);
  const flagged = found.length > n ? R.askedDup(x.account, x.date, x.cents, x.posted).length : R.asked(x.account, x.date, x.cents, x.posted, x.wide).length + R.askedOther(x, found).length;
  return { outcome: flagged ? "flagged" : "silently wrong", said, dollars, right: false, asked: !!flagged };
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
  /* a group's line in net worth, for an asset whose account stays on the balance rows after setup closes it */
  if (p.group_total) for (const x of p.group_total) {
    const row = L.netWorth.find((n) => n.month === x.month), got = (row && row.groups && row.groups[x.group]) || 0;
    notes.push(`${x.month}: ${money(got)} in ${x.group} in net worth, truth ${money(x.want)}`);
    if (got !== x.want) { const o = lawBad(x.named) ? "flagged" : "silently wrong"; outcomes.push(o); tallyOf(o, Math.abs(got - x.want)); }
  }
  /* an account in another currency: what the group's line in net worth holds for it, in dollars, once every other cash account is taken out. Two per cent either side of the month's rate is right. */
  if (p.fx_value) for (const x of p.fx_value) {
    const row = L.netWorth.find((n) => n.month === x.month), others = [...R.cashAcct].filter((a) => a !== x.account).reduce((t, a) => t + R.balance(a, x.month), 0), got = ((row && row.groups && row.groups[x.group]) || 0) - others, off = Math.abs(got - x.want) > Math.max(100, Math.abs(x.want) * 0.02);
    notes.push(`${x.month}: ${money(got)} in net worth for ${x.account}, truth ${money(x.want)} at the month's rate`);
    if (off) {
      const o = lawBad(x.named) ? "flagged" : "silently wrong", why = [...L.checks.filter((c) => c.law !== "L7" && String(c.scope) === x.named && !["pass", "skip", "accepted"].includes(c.status)).map((c) => `${c.law} ${c.status}: ${String(c.detail || "").slice(0, 90)}`), ...L.review.filter((r) => !["uncategorised", "possible_duplicate"].includes(r.kind) && (String(r.ref) === x.named || String(r.what || "").includes(x.named) || String(r.what || "").includes(nameOf(x.named)) || String(r.question || "").includes(nameOf(x.named)))).map((r) => `${r.kind}: ${String(r.question || r.what || "").slice(0, 90)}`)];
      outcomes.push(o); tallyOf(o, Math.abs(got - x.want)); if (o === "flagged" && !notes.some((n) => n.startsWith("named by"))) notes.push(`named by ${why.slice(0, 2).join("; ")}`);
    }
  }
  /* a month's figure that a line of someone else's would swamp: the engine's income or spending must stay under it */
  if (p.cap) for (const x of p.cap) {
    const row = L.cash.find((c) => c.month === x.month), got = row ? row[x.metric] || 0 : 0, under = typeof x.under === "string" ? truth[x.metric][x.month] + Number(x.under.slice(6)) : x.under, over = got >= under;
    notes.push(`${x.month} ${x.metric} ${money(got)}, ${over ? "at or above" : "under"} ${money(under)}`);
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
  const quiet = (p.lines || []).map((x, i) => [x, lines[i]]).filter(([x]) => x.quiet).map(([, l]) => l);
  return { regular: !!trap.regular, reg: { lines: quiet.length, right_quiet: quiet.filter((l) => l.right && !l.asked).length, right_asked: quiet.filter((l) => l.right && l.asked).length, wrong_asked: quiet.filter((l) => !l.right && l.asked).length, wrong_silent: quiet.filter((l) => !l.right && !l.asked).length }, id: trap.id, name: trap.name, fresh: trap.fresh, dc: trap.dc, where: trap.where, expect: trap.expect, outcome: worstOf(outcomes), cents, flaggedCents, lines_ok: lines.filter((l) => l.outcome === "handled").length, lines_total: lines.length, notes, bad: bad.slice().sort((a, b) => (a.outcome === "silently wrong" ? -1 : 1) - (b.outcome === "silently wrong" ? -1 : 1)).map((l) => `${l.outcome}: ${l.said}`) };
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
  p("# Seventh held-out household: Singh-Kaur, a rerun, not blind");
  p();
  p(`Generated by \`node standard/eval/heldout7/run.js\`. Engine at ${head}${dirty}. Bundle ${L.bundleHash}. ${intake.sources.length} sources, ${intake.observations.length} observations, ${L.events.length} events, ${intake.unknown_files.length} unread, ${intake.faults.length} intake faults. No decisions, no rules. Public recipes and dictionary, and one family's onboarding answers.`);
  p();
  p("## Scores");
  p();
  p("| Measure | Exact months | Mean error a month | Truth, 36 months | Engine, 36 months | Worst month |");
  p("|---|---|---:|---:|---:|---|");
  for (const x of T.rows) p(`| ${x.name} | ${x.exact} of ${x.of} | ${money(x.mae)} | ${x.name === "Net worth" ? `${money(truth.networth["2026-06"])} at June 2026` : money(x.truth_total)} | ${x.name === "Net worth" ? `${money((L.netWorth.find((n) => n.month === "2026-06") || {}).total)} at June 2026` : money(x.engine_total)} | ${x.worst.m}, off by ${money(x.worst.d)} |`);
  { const ms = Object.keys(truth.income), rl = truth.cash_lines.filter((x) => x.account === "ACC-RUPEE"), lens = (l, m) => rl.filter((x) => x.lens === l && x.date.slice(0, 7) === m).reduce((t, x) => t + (x.aud || 0), 0);
    const line = (name, tr, en) => { let exact = 0, abs = 0, sw = 0, sg = 0; for (const m of ms) { const w = tr(m), g = en(m); sw += w; sg += g; abs += Math.abs(g - w); if (g === w) exact += 1; } p(`| ${name} | ${exact} of ${ms.length} | ${money(Math.round(abs / ms.length))} | ${money(sw)} | ${money(sg)} | |`); };
    const nwOf = new Map(L.netWorth.map((n) => [n.month, n])), rupeeIn = (m) => { const n = nwOf.get(m); return ((n && n.groups && n.groups.cash) || 0) - [...R.cashAcct].filter((a) => a !== "ACC-RUPEE").reduce((t, a) => t + R.balance(a, m), 0); };
    line("Cash income, rupee account out of both sides", (m) => truth.income[m] - lens("income", m), (m) => (L.cash.find((c) => c.month === m) || {}).income || 0);
    line("Spending, rupee account out of both sides", (m) => truth.spending[m] + lens("spending", m), (m) => (L.cash.find((c) => c.month === m) || {}).spending || 0);
    { let exact = 0, abs = 0; for (const m of ms) { const w = truth.networth[m] - Math.round(truth.balances["ACC-RUPEE"][m] * truth.fx[m] / 1000000), g = ((nwOf.get(m) || {}).total || 0) - rupeeIn(m); abs += Math.abs(g - w); if (Math.abs(g - w) <= 1) exact += 1; } p(`| Net worth, rupee account out of both sides | ${exact} of ${ms.length} | ${money(Math.round(abs / ms.length))} | | | |`); } }
  p(`| Balances, account-months | ${T.bal.exact} of ${T.bal.of} | | | | ${T.bal.all_exact_months} months with every account exact |`);
  p(`| Balance movements, account-months | ${T.bal.moved} of ${T.bal.moved_of} | | | | right change month on month, whatever the opening |`);
  p(`| Review items | ${L.review.length} | | | | ${Object.entries(reviewKinds).map(([k, v]) => `${k} ${v}`).join(", ")} |`);
  p(`| Traps | ${tally.handled} handled, ${tally.flagged} flagged, ${tally["silently wrong"]} silently wrong, of ${traps.length} | | | | ${traps.filter((t) => t.fresh).length} in none of the earlier lists, ${traps.filter((t) => t.dc).length} new double-count or silent-number variants |`);
  p();
  p("This is a rerun after a repair, and it is not blind. The blind result is BLIND-7.md, and the run before its worker fixed two bugs in the build is BLIND-7-first-run.md. Since then a balance in another currency stays out of the headlines until a dated rate exists, so the engine's own lines above already leave the rupee account out.");
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
  p();
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
  p("<!-- WHOLE SHAPE -->");
  p();
  const dollarsF = traps.filter((t) => t.outcome === "flagged" && t.flaggedCents > 0).sort((a, b) => b.flaggedCents - a.flaggedCents);
  p("## Wrong and flagged, the largest numbers");
  p();
  p("A flag is not a fix. These numbers stay wrong until a person answers.");
  p();
  p("| Trap | Dollars | What |\n|---|---:|---|");
  for (const t of dollarsF.slice(0, 10)) p(`| ${t.id} | ${money(t.flaggedCents)} | ${t.name} |`);
  p();
  { const regs = traps.filter((t) => t.regular), sum = (k) => regs.reduce((a, t) => a + t.reg[k], 0);
    p("## Plainly regular money");
    p();
    p("Every line of a contract's regular money, read for two things: the number the contract says, and no question. A line asked about scores flagged even when its number is right, because the new behaviour should ask more about odd lines and not about these.");
    p();
    p("| Trap | Lines | Right, no question | Right, asked about | Wrong, asked about | Wrong, silent |");
    p("|---|---:|---:|---:|---:|---:|");
    for (const t of regs) p(`| ${t.id}: ${t.name} | ${t.reg.lines} | ${t.reg.right_quiet} | ${t.reg.right_asked} | ${t.reg.wrong_asked} | ${t.reg.wrong_silent} |`);
    p(`| All | ${sum("lines")} | ${sum("right_quiet")} | ${sum("right_asked")} | ${sum("wrong_asked")} | ${sum("wrong_silent")} |`);
    p(); }
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
  p();
  p("<!-- AFTER -->");
  p();
  p("<!-- SEEN -->");
  if (o.dry) return { tally, traps, rec, T };
  const target = path.join(__dirname, "RESULT.md");
  fs.writeFileSync(target, `${out.join("\n")}\n`);
  fs.writeFileSync(path.join(require("./build").OUT, "rebuild.json"), JSON.stringify({ bundleHash: L.bundleHash, review: L.review, cash: L.cash, netWorth: L.netWorth, checks: L.checks, coverage: L.coverage, accounts: L.accounts, events: L.events.map((e) => ({ kind: e.kind, category_id: e.category_id, occurred_on: e.occurred_on, charged_on: e.charged_on, description: e.description, unexplained: e.unexplained, postings: e.postings })) }));
  console.log(`${tally.handled} handled, ${tally.flagged} flagged, ${tally["silently wrong"]} silently wrong, of ${traps.length}. Written to ${target}.`);
}
const NOTES = [
  "Blind. Written from SPEC.md, RECIPES.md, the schemas, schema-card.md, the public recipes, the intake, the world's file writers, and the build, run and blind report of the six earlier held-out folders, with answers.js. Not read: the engine, score.js, ladder.js, eval/households, the world's domains, src, merchants, reference, any RESULT.md, the scoreboard, any changelog, GOVERNANCE.md, or any diff of them. No git log, show or diff was run. run.js calls rebuild and the public dictionary loader without either being opened, and reads rebuild's output by the names the earlier run.js files use. Files were checked by running the intake alone, which is not the engine. Two slips, set down so nobody has to find them: while reading heldout6, one command printed heldout6/standin.js and heldout6/setup/*.json, and neither is on this run's allowed list by name. The stand-in is a scorer check that never reads the engine and the setup is the output of a build.js that is allowed, so nothing about the engine came with them, and standin.js here is written from the one read. BLIND-1 to BLIND-6 and SPEC.md say in words what several repairs do, and all of that was read before the traps were chosen. The traps were chosen from the shape. T7-STRAY-FILE and T7-OLD-CAR-SOLD meet repairs on purpose, as the shape repeats. T7-INR-BALANCE meets SPEC 6.6's sentence that an account in another currency counts at face value and says so.",
  "The seventh shape: a migrant family. A linehaul driver and a casual aged-care worker at two employers, a husband and wife with no surname in common, in a community where most men are Singh and most women Kaur. A daughter, a baby in November 2024, parental leave and a return to work. His parents in Moga, Punjab, and money home each month through a transfer service under a contract a person named. His brother on a student visa, boarding, his tuition paid by their father through the household's saver. A lodger. His mother on a sponsored visit against a 10,000.00 bond to Home Affairs. A rupee account in Punjab, with a flat that earns rent in rupees and a plot he sells in September 2025 and brings home. A rotating savings circle among ten women, a community collection through her account, gifts at a naming. Rent, pass-through, a bond and foreign pensions have met earlier families. BLIND-5 had one rail both ways to a flat in Iloilo, and BLIND-3 one sterling account. What is new is a whole family's money on both sides of a border, regular money under contracts with people whose surnames are everyone's, and a currency fifty-odd times the dollar.",
  "Files. New to the held-out series as a main account: Bark's headerless CSV. The saver is Harbour's CSV and Simran's account Wattle's OFX. The rupee account's file is the five columns of Wattle's public CSV, in rupees, as BLIND-3's sterling file was, because no Indian bank has a public recipe and a family's folder would hold what the bank gave them. Westpaw's statement with no download. Whiskerwire's transfer histories, the visa grant and bond receipt, the rupee account's tax certificates, the plot's sale deed and the polytechnic's fee statements have no public recipe, so they are in the household and unread, and listed below. Super, payslips, notices and bills are the earlier writers. agent-return-pdf, the work logs, the prefill, coinpurr, the registries and the gas bill are not used.",
  "Budgets read the charge date and balances read the posting date. A charge in two files is one charge. Where a statement and a download disagree on the amount, the statement is the charge, because it closes on it.",
  "Cash income and spending follow SPEC 6.5 and the treatment rule of the earlier scorers. `unexplained` on an event or a month is the money the engine says it cannot explain: neither income nor spending. Wages count at the net banked, on the day banked. Family Tax Benefit with its lumps, parental leave pay, board, the lodger's rent, gifts and interest are income, and an overpaid benefit taken back is a negative in income. Money home is spending under x_FAMILY, net of what comes back, and the surgery wire counts at the household's 12,000.00. Loan repayments and the 60,000.00 lump count at their cash amount. A fund's claim lowers the cost it pays for. An ATM withdrawal is spending when withdrawn, because no cash account is declared. A visa charge and a citizenship fee are spending.",
  "Neither: own transfers, card payments, tax refunds and payments, a spouse super contribution, the rotating circle both ways, the collection both ways, a friend's money sent home both ways, his brother's first wages and their handing on, the tuition wires and bills, the phone and its repayment, the cousin's parked 25,000.00 both ways, the cousin's 6,000.00 for the surgery on the way in, the visa bond both ways, the lodger's bond both ways, the old car and the plot sold, the own transfer through the service and the wire home across currencies. The tuition wires run a little above the bills, and all of it counts as neither: what is left stays with his next bill.",
  "The rupee. Every line on the rupee account is held in paise on the book, with its dollar value beside it at the month's rate. That rate is a seeded walk, on no file a household holds, and it is the simulation's only figure no file carries. The balance row is right at face value: an account's balance in its own currency is a true number, so truth.balances holds rupees and the balances table does not penalise it. Net worth and the two cash series are in dollars, so a rupee line read at face is wrong there. It is declared in setup as a person would: a bank account, reporting group cash, currency INR. The file reads clean because its columns are a public recipe's and its numbers are numbers, as T3-UK-BALANCE's did. A person would not find the account's numbers surprising and would not pre-empt them. This is one account with a large effect, so the score table also prints the three headline series with the rupee account taken out of both sides, so that one trap does not hide what the other sixty-six did.",
  "Net worth in truth carries money in the air between own accounts, as the earlier scorers did. It excludes the tax position. The home is at the latest estimate, the flat, the plot and the two cars at the value typed in setup, the plot and the old car leaving on the day they go. Money parked with them, the circle's pot once drawn, the lodger's bond held and the visa bond paid stand as the files show them: no person would declare a debt or an asset for them, and SPEC 4.4c keeps a receivable out of headline net worth. A reader who holds the cousin's 25,000.00 out moves eleven weeks of net worth, and nothing else.",
  "Setup gives no opening balance a file states. Categories are the public list with PASS-THROUGH, SUPER-PENSION and SELLING-COSTS, and three rows by SPEC 12: family payments, board and lodgers, and money home. A person would declare the employers, the loan, the insurance, the utilities, the after-school care, the family benefit, the money home, the gurdwara's standing gift, the brother's board and the lodger. So contracts carry them. Deliberate omissions are what a person would leave out: no word of the circle, the collection, the cousin, the friend, the tuition, the bond, the parental leave, the brother's first wages, or the visitor cover. His brother, parents and lodger are parties and not members. Nothing in setup was chosen by reading what a trap needs and then adding it, and no rule or decision is given.",
  "T7-KITTY, T7-COLLECTION, T7-SHAGUN-IN, T7-SHOW-MONEY, T7-HIS-WAGES, T7-TUITION-THROUGH, T7-INWARD-THREE, T7-BOND-VISA, T7-REMIT-COUSIN, T7-REMIT-OWN, T7-REMIT-LARGE, T7-BOARD-LOOKALIKE, T7-LODGER-BOND, T7-CASH-GIFT and T7-REIMB are facts an engine can only learn by asking, or by a person's rule. A question over the line scores flagged and is the honest best. Silence scores silently wrong, even where SPEC 8 declares the limit: a limit that is declared still leaves a wrong number.",
  "The new behaviour, tested fairly both ways. Twelve traps carry a contract's plainly regular money, every line of it, tagged regular: a wage, a casual's pay with no slip, the family benefit through a baby's step, a home loan through rate cuts, money home, board, a lodger, a standing gift, a premium, a power bill that triples in winter, a car premium up 26% in a year, and after-school care that triples in the holidays. Each reads the contract's category where it has one, and a line asked about scores flagged even when its number is right, because asking about plainly regular money is itself a defect. The other direction is held by the contract-name traps: T7-MEDICARE-SA, T7-PPL, T7-REMIT-OWN, T7-REMIT-COUSIN, T7-BOARD-LOOKALIKE, T7-LODGER-BOND, T7-DONATION-LUMP, T7-OLD-CAR-SOLD and T7-REMIT-LARGE, where a name is not proof. No trap was picked for a guess at either outcome.",
  "T7-STRAY-FILE: every line of the stray file carries a marker no other file has, and the probe reads every event for it, as in BLIND-5. No event carrying one is handled. Events all named by review are flagged. Any event carrying one and not named is silently wrong. A file left unposted is right, whether intake or the engine left it. T7-TRUNCATED and T7-STATEMENT-GAP are the two gaps nobody can fill: the most they can score is flagged. T7-OFX-OVERLAP rests on the public writer, as T5-OFX-OVERLAP did. build.js refuses to run if a trap's line sits inside the truncated file's hole, the bug BLIND-6 met twice.",
  "Scoring is BLIND-6's, in the same code: Reader, reconcile, judgeLine and judge are copied from heldout6/run.js. Three things are added. `quiet` on a line, set out above. `fx_value`, which reads what the group's line in net worth holds for one account once every other cash account is taken out, with 2% either side of the month's rate counted right, and which flags by BLIND-6's rule for a balance. And a `cap` whose figure is truth's month plus a margin. A flagged outcome needs the engine to name the line in review, or a law that fails or shows a gap on that account, or coverage that names the month. For a hole in a bank file the law must name the month. A doubled line counts as asked only if review asks whether it is doubled. A balance is flagged by any law scoped at that account, or by a review item about the account rather than one of its lines. A file refused or unread by intake is a report of the intake and does not by itself flag a number. Tax is not scored: L11 is printed as the engine reports it. A trap's probes are lines, balances and coverage: category is read only where the trap's text names one.",
  "Before the first run the scorer was tried on a perfect stand-in built from the simulation's own book, never the engine (standin.js): 65 handled, and 2 flagged, the two gaps nobody can fill (T7-TRUNCATED, T7-STATEMENT-GAP). So every other probe can pass. It matched all 2445 cash lines and paired all 95 own transfers. Lines in the hole of T7-TRUNCATED are in truth and in the stand-in, so a stand-in match says nothing about them. The changes the stand-in forced: samples of the collection and the naming gifts now draw lines alone on their day, Hardeep's gift became 351.00 so it stands alone, and the board on the day of the phone is read with the phone, as one line of each."
];
/* [this household, earlier trap, outcome at the last blind run that met the shape] */
const REPEATS = [["T7-ATM", "T6-ATM", "handled"], ["T7-KID-SAVER", "T6-UNI-RENT", "handled"], ["T7-SINGH-MERCHANT", "T3-MERCHANT-NAME", "flagged"], ["T7-PAY-STRADDLE", "T6-PAY-STRADDLE", "handled"], ["T7-REG-WAGE", "T6-WEEKLY-PAY", "handled"], ["T7-NET-PAY-SPLIT", "T6-NET-PAY-SPLIT", "handled"], ["T7-REIMB", "T6-REIMB", "flagged"], ["T7-NAME-ON-SLIP", "T5-MARRIED-NAME", "handled"], ["T7-REG-CASUAL", "T5-NO-PAYSLIP", "handled"], ["T7-REG-FTB", "T6-CARER-TWO-CREDITS", "handled"], ["T7-FTB-TOPUP", "T6-SUPPLEMENT", "handled"], ["T7-BENEFIT-DEBT", "T6-BENEFIT-DEBT", "flagged"], ["T7-MEDICARE-SA", "T6-MEDICARE-SA", "silently wrong"], ["T7-PPL", "T5-PPL", "flagged"], ["T7-REMIT-LARGE", "T6-BROTHER-SHARE", "flagged"], ["T7-STRANGER-SINGH", "T6-BOARD-SON", "flagged"], ["T7-FALSE-PAIR", "T6-FALSE-PAIR", "flagged"], ["T7-SAME-NAME", "T6-SAME-NAME", "silently wrong"], ["T7-CASH-GIFT", "T5-CASH-TAKINGS", "flagged"], ["T7-TUITION-THROUGH", "T6-BUILDER-THROUGH", "silently wrong"], ["T7-OLD-CAR-SOLD", "T6-CARAVAN-SOLD", "handled"], ["T7-LODGER-BOND", "T4-HOUSEMATE-BOND", "silently wrong"], ["T7-VISITOR-CLAIM", "T6-STORM-CLAIM", "flagged"], ["T7-INR-WIRE", "T3-UK-XFER", "flagged"], ["T7-INR-BALANCE", "T3-UK-BALANCE", "silently wrong"], ["T7-DISHONOUR", "T6-DISHONOUR", "handled"], ["T7-EXTRA-REPAY", "T6-EXTRA-REPAY", "handled"], ["T7-REG-HEALTH", "T6-HEALTH-STATEMENT", "handled"], ["T7-BILL-WITNESS", "T6-BILL-WITNESS", "handled"], ["T7-REG-CHILDCARE", "T5-CCS", "handled"], ["T7-PERSONAL-SUPER", "T6-PERSONAL-SUPER", "flagged"], ["T7-TAX-REFUND", "T6-TAX-REFUND", "handled"], ["T7-TAX-BILL", "T6-TAX-BILL", "handled"], ["T7-REFUND-STREAM", "T6-REFUND-STREAM", "handled"], ["T7-FX-REPRICE", "T6-FX-REPRICE", "silently wrong"], ["T7-HOLIDAY-LAG", "T6-HOLIDAY-LAG", "handled"], ["T7-INVOICE", "T6-INVOICE", "handled"], ["T7-STRAY-FILE", "T6-STRAY-FILE", "silently wrong"], ["T7-OFX-OVERLAP", "T6-OFX-OVERLAP", "handled"], ["T7-TRUNCATED", "T6-TRUNCATED", "flagged"], ["T7-POSTING-LAG", "T6-POSTING-LAG", "silently wrong"], ["T7-DATE-BASIS", "T6-DATE-BASIS", "handled"], ["T7-STATEMENT-GAP", "T6-STATEMENT-GAP", "flagged"]];

if (require.main === module) report(run());
module.exports = { run, report, Reader, loadSetup, NOTES };
