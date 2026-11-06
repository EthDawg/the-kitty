#!/usr/bin/env node
/* Scores the engine on the second household it has never seen. Builds the Reyes-Wolaks, ingests their files, rebuilds with only their onboarding setup and the public dictionary and
   recipes, and compares every number with the simulation's truth. No decisions, no rules. Nothing here adjusts anything to improve a score. Report shape from eval/heldout/run.js.

   node standard/eval/heldout2/run.js        prints the table and writes BLIND-2.md beside this file */
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

/* A person answers contributes_to by naming the fund's contract, which the schema and SPEC 4.4 allow. It crashed the first household. If it still does, the same fact is restated at the fund's member account so there is anything to score. Reported, never silent. */
function restateSuperLinks(setup) {
  const acct = new Map(setup.contract.filter((c) => c.kind === "super_fund").map((c) => [c.contract_id, c.account_id]));
  return { ...setup, link: setup.link.map((l) => (l.relation === "contributes_to" && l.to_type === "contract" ? { ...l, to_type: "account", to_id: acct.get(l.to_id) } : l)) };
}

function run() {
  const built = build();
  Engine.loadMerchants({ merchants: read(path.join(STD, "..", "merchants", "merchants.json")), categories: read(path.join(STD, "..", "merchants", "categories.json")) });
  const manifest = read(path.join(OUT, "manifest.json")), truth = read(path.join(OUT, "truth.json")), recipes = loadRecipes(path.join(STD, "recipes"));
  const intake = ingest({ root: OUT, recipes, manifest });
  const schema = { events: read(path.join(STD, "schema", "events.json")), metrics: read(path.join(STD, "schema", "metrics.json")) };
  const reference = read(path.join(STD, "reference", "au.json"), null);
  const receipts = (intake.files || []).map((f) => { const parts = f.path.split("/"); return { stream_id: parts[1], day: parts[2] }; });
  const once = (setup) => rebuild({ setup, sources: intake.sources, observations: intake.observations, decisions: [], rules: [], schema, reference, receipts });
  const setup = loadSetup(); let L, crash = null, used = setup;
  const where = (e) => { const ls = String(e.stack).split("\n").filter((x) => /engine\//.test(x)).map((x) => x.trim().replace(/^.*standard\//, "standard/").replace(/\)$/, "")); return { at: ls[0] || "", via: ls[1] || "" }; };
  try { L = once(setup); } catch (e) {
    crash = { message: e.message, ...where(e) };
    used = restateSuperLinks(setup);
    try { L = once(used); crash.recovered = true; } catch (e2) { crash.second = { message: e2.message, ...where(e2) }; console.log(JSON.stringify(crash, null, 1)); console.log(String(e2.stack).split("\n").slice(0, 12).join("\n")); process.exit(1); }
  }
  return { L, truth, intake, manifest, setup: used, crash, built };
}

// ---------- reading the engine's output ----------
function Reader(L, setup) {
  const cats = new Map(L.categories.map((c) => [c.category_id, c])), bal = {};
  for (const r of L.balances.rows) { const a = (bal[r.account_id] = bal[r.account_id] || {}); a[r.month_end.slice(0, 7)] = r.balance_cents; }
  const events = new Map();
  for (const e of L.events) for (const p of e.postings || []) { if (!p.account_id) continue; const k = `${p.account_id}|${p.amount_cents}`; if (!events.has(k)) events.set(k, []); events.get(k).push(e); }
  const cashAcct = new Set(L.accounts.filter((a) => a.reporting_group === "cash").map((a) => a.account_id));
  // what the cash lens does with an event: an entry that nets to nothing across cash accounts is a wash whatever its category
  const treat = (ev) => {
    const c = cats.get(ev.category_id); if (!c) return "neither";
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
    if (r.kind === "owner_statement_unmatched") { const m = /Owner statement (\d{4}-\d{2}-\d{2})/.exec(what); if (!m) return false; const gap = (Date.parse(x.date) - Date.parse(m[1])) / 864e5; return x.account === "ACC-OFFSET" && ((gap >= 0 && gap <= 14) || (x.date.slice(0, 7) === m[1].slice(0, 7) && Math.abs(x.cents) !== Math.abs(r.amount_cents))); }
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
  return { rows, perAcct, bal, uncategorised_share: spent ? uncat / spent : 0, monthly };
}

// ---------- every cash line, one by one: did the engine book it once, and treat it as truth does ----------
function reconcile(L, truth, R) {
  const pool = new Map(); truth.cash_lines.forEach((x, i) => { const k = `${x.account}|${x.cents}`; if (!pool.has(k)) pool.set(k, []); pool.get(k).push({ ...x, i }); });
  const taken = new Set(), legs = [], extra = [], wrong = {};
  for (const e of L.events) { if (e.kind === "opening_balance") continue; for (const p of e.postings || []) if (R.cashAcct.has(p.account_id)) legs.push({ e, account: p.account_id, cents: p.amount_cents, dates: R.datesOf(e, p.account_id) }); }
  for (const pass of [0, 1, 6, 14]) for (const v of legs) {
    if (v.t) continue;
    let best = null, gap = Infinity;
    for (const x of pool.get(`${v.account}|${v.cents}`) || []) { if (taken.has(x.i)) continue; const d = Math.min(...v.dates.flatMap((q) => [days(x.date, q), x.posted ? days(x.posted, q) : Infinity, x.alt ? days(x.alt, q) : Infinity])), rank = d + (x.lens === R.treat(v.e) ? 0 : 0.25); if (d <= pass && rank < gap && (pass <= 1 || v.account === CARD || x.own || x.alt)) { best = x; gap = rank; } }
    if (best) { taken.add(best.i); v.t = best; }
  }
  const effect = { income: 0, spending: 0 };   // what each class of error does to the 36-month totals, so the table adds up to the gap
  const inWin = (d) => d >= truth.window[0] && d <= truth.window[1];
  for (const v of legs) {
    if (!v.t) { extra.push(v); continue; }
    const got = R.treat(v.e); if (got === v.t.lens) continue;
    const k = `${v.t.lens} booked as ${got}`, w = (wrong[k] = wrong[k] || { count: 0, cents: 0, income: 0, spending: 0, examples: new Set() });
    w.count += 1; w.cents += Math.abs(v.cents); if (w.examples.size < 3) w.examples.add(v.t.what.replace(/\s+/g, " "));
    if (inWin(v.t.date)) {
      if (v.t.lens === "income") w.income -= v.cents; if (v.t.lens === "spending") w.spending += v.cents;
      if (got === "income") w.income += v.cents; if (got === "spending") w.spending -= v.cents;
    }
  }
  const missing = truth.cash_lines.filter((x, i) => !taken.has(i) && x.date >= truth.window[0] && x.date <= truth.window[1]);
  const missedByLens = (l) => missing.filter((x) => x.lens === l).reduce((t, x) => t + x.cents, 0);
  const windowExtra = extra.filter((v) => v.dates.some(inWin));
  for (const v of windowExtra) { const got = R.treat(v.e); if (got === "income") effect.income += v.cents; if (got === "spending") effect.spending -= v.cents; }
  const dup = L.review.filter((r) => r.kind === "possible_duplicate"), cards = extra.filter((v) => v.account === CARD && R.treat(v.e) === "spending");
  const asked = cards.filter((v) => dup.some((r) => { const p = String(r.ref).split("|"); return p[0] === CARD && Number(p[2]) === v.cents && v.dates.some((d) => days(p[1], d) <= 9); })).length;
  const lagOf = (v) => { const c = (pool.get(`${CARD}|${v.cents}`) || []).find((x) => x.posted && v.dates.some((d) => days(x.date, d) <= 14 || days(x.posted, d) <= 14)); return c ? days(c.date, c.posted) : null; };
  const byLag = {}; for (const v of cards) { const l = lagOf(v); byLag[l == null ? "unmatched" : l] = (byLag[l == null ? "unmatched" : l] || 0) + 1; }
  const paired = truth.own_transfers.filter((x) => { const a = R.find(x.from, x.date_out, -(x.sent || x.cents), 6, x.date_in), b = R.find(x.to, x.date_in, x.cents, 6, x.date_out); return a.length && b.length && a.every((e) => R.treat(e) === "neither") && b.every((e) => R.treat(e) === "neither") && a.concat(b).every((e) => e.kind !== "open_transfer"); }).length;
  const extraBy = {}; for (const v of extra) { const k = `${v.account} ${v.e.kind}`, w = (extraBy[k] = extraBy[k] || { count: 0, cents: 0, example: v.e.description || "" }); w.count += 1; w.cents += v.cents; }
  return { lines: truth.cash_lines.length, matched: taken.size, extra: extra.length, extra_cents: extra.reduce((t, v) => t + v.cents, 0), extraBy, missing: missing.length, missing_cents: missing.reduce((t, x) => t + x.cents, 0), missing_list: missing, missed: { income: -missedByLens("income"), spending: missedByLens("spending") }, effect, wrong, card_doubles: { count: cards.length, cents: cards.reduce((t, v) => t - v.cents, 0), asked, by_lag: Object.entries(byLag).map(([d, n]) => (d === "unmatched" ? `${n} with no line to match` : `${n} posted ${d} days after the charge`)).join(", ") }, own: { paired, of: truth.own_transfers.length } };
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
  const HOLDINGS = ["ACC-SHARES", "ACC-PLAN", "ACC-COIN", "ACC-COLD"];
  const tallyOf = (o, c) => { if (o === "silently wrong") cents += c; else if (o === "flagged") flaggedCents += c; };
  const months = Object.keys(truth.income);
  const lawBad = (a) => L.checks.some((c) => (c.law === "L3" && String(c.scope) === a || (c.law === "L7" && HOLDINGS.includes(a))) && !["pass", "skip", "accepted"].includes(c.status));
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
  if (p.zero_after) {
    const ms = months.filter((m) => m >= p.zero_after.from), off = ms.filter((m) => R.balance(p.zero_after.account, m) !== 0);
    notes.push(`${p.zero_after.account}: ${ms.length - off.length} of ${ms.length} month-ends at zero${off.length ? `, ${off[0]} shows ${money(R.balance(p.zero_after.account, off[0]))}` : ""}`);
    if (off.length) { outcomes.push("silently wrong"); cents += Math.abs(R.balance(p.zero_after.account, off[0])); }
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
  if (p.kind === "law") outcomesForLaw(p);
  function outcomesForLaw(q) {
    const cs = L.checks.filter((c) => c.law === q.law && String(c.scope).includes(q.scope)), off = cs.filter((c) => c.status !== "pass");
    notes.push(`${q.law} ${q.scope}: ${cs.length ? off.length ? `${off.length} of ${cs.length} not passing, ${off[0].status}: ${off[0].detail || ""}` : `${cs.length} pass` : "no check ran"}`);
    if (!cs.length) outcomes.push("silently wrong"); else if (off.length) outcomes.push("flagged");
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
    notes.push(`L3 ${l3 ? `${l3.status}: ${l3.detail || ""}` : "absent"}; coverage ${c ? `${c.have} of ${c.expected}` : "no row"}; the ${money(p.net_cents)} that moved ${said ? "is named" : "is not named"}`);
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
  p("# Second held-out household: Reyes-Wolak");
  p();
  p(`Generated by \`node standard/eval/heldout2/run.js\`. Engine at ${head}${dirty}. Bundle ${L.bundleHash}. ${intake.sources.length} sources, ${intake.observations.length} observations, ${L.events.length} events, ${intake.unknown_files.length} unread, ${intake.faults.length} intake faults. No decisions, no rules. Public recipes and dictionary, and one family's onboarding answers.`);
  p();
  if (crash) {
    p(`**The rebuild crashed on the setup as answered.** \`${crash.message}\` at \`${crash.at}\`, called from \`${crash.via}\`. To get any score at all, run.js restated the \`contributes_to\` links at the funds' member accounts, the same fact in the other valid shape. Every number below is after that one change.`);
    p();
  }
  p("## Scores");
  p();
  p("| Measure | Exact months | Mean error a month | Truth, 36 months | Engine, 36 months | Worst month |");
  p("|---|---|---:|---:|---:|---|");
  for (const x of T.rows) p(`| ${x.name} | ${x.exact} of ${x.of} | ${money(x.mae)} | ${x.name === "Net worth" ? `${money(truth.networth["2026-06"])} at June 2026` : money(x.truth_total)} | ${x.name === "Net worth" ? `${money((L.netWorth.find((n) => n.month === "2026-06") || {}).total)} at June 2026` : money(x.engine_total)} | ${x.worst.m}, off by ${money(x.worst.d)} |`);
  p(`| Balances, account-months | ${T.bal.exact} of ${T.bal.of} | | | | ${T.bal.all_exact_months} months with every account exact |`);
  p(`| Balance movements, account-months | ${T.bal.moved} of ${T.bal.moved_of} | | | | right change month on month, whatever the opening |`);
  p(`| Review items | ${L.review.length} | | | | ${Object.entries(reviewKinds).map(([k, v]) => `${k} ${v}`).join(", ")} |`);
  p(`| Traps | ${tally.handled} handled, ${tally.flagged} flagged, ${tally["silently wrong"]} silently wrong, of ${traps.length} | | | | ${traps.filter((t) => t.fresh).length} not in BLIND-1's list, ${traps.filter((t) => t.dc).length} new double-count or silent-number variants |`);
  p();
  const asks = new Map(); for (const x of L.review.filter((i) => i.kind === "uncategorised")) asks.set(x.question, (asks.get(x.question) || 0) + Math.abs(x.amount_cents));
  const byValue = [...asks.values()].sort((a, b) => b - a), total = byValue.reduce((a, b) => a + b, 0), top = byValue.slice(0, 30).reduce((a, b) => a + b, 0);
  const allAsks = new Set(L.review.map((x) => `${x.kind}|${x.question || x.what || x.ref}`));
  p(`Spending left uncategorised: ${(T.uncategorised_share * 100).toFixed(1)}% of the dollars. Every merchant is invented, so the dictionary knows few of them; uncategorised spending still counts as spending. The ${L.review.filter((i) => i.kind === "uncategorised").length} uncategorised lines are ${asks.size} questions, one per merchant, and the first 30 cover ${(top / (total || 1) * 100).toFixed(1)}% of their dollars. The whole review queue is ${L.review.length} items and ${allAsks.size} distinct questions.`);
  p();
  const dollarsSW = traps.filter((t) => t.outcome === "silently wrong");
  p("## Silently wrong, with the dollars");
  p();
  p("Dollars are the gross amount on the wrong lines, or the worst balance error, and they overlap: a late-posted line sits in both T2-HOLIDAY-LAG and T2-POSTING-LAG.");
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
  const gapI = T.rows[0].engine_total - T.rows[0].truth_total, gapS = T.rows[1].engine_total - T.rows[1].truth_total, fee = truth.cash_lines.reduce((t, x) => t + (x.fee || 0), 0);
  p(`The 36-month gaps by cause. Income: engine less truth ${money(gapI)}; wrong treatment ${money(sumW("income"))}, extra legs ${money(rec.effect.income)}, lines never booked ${money(rec.missed.income)}, unexplained ${money(gapI - sumW("income") - rec.effect.income - rec.missed.income)}. Spending: engine less truth ${money(gapS)}; wrong treatment ${money(sumW("spending"))}, extra legs ${money(rec.effect.spending)}, lines never booked ${money(rec.missed.spending)}, the fee inside the interbank transfer ${money(-fee)}, unexplained ${money(gapS - sumW("spending") - rec.effect.spending - rec.missed.spending + fee)}. Unexplained is what crosses the window's edge or moves in a way this sum does not model.`);
  p();
  p("## Balances by account");
  p();
  p("| Account | Exact month-ends | Exact movements | Mean error | June 2026, truth | June 2026, engine |");
  p("|---|---|---|---:|---:|---:|");
  for (const a of T.perAcct) p(`| ${a.account} | ${a.exact} of ${a.of} | ${a.moved} of ${a.moved_of} | ${money(a.mae)} | ${money(a.last.truth)} | ${money(a.last.engine)} |`);
  p();
  p("## Traps");
  p();
  p("Handled: the number is right. Flagged: the number is wrong or unknowable, and the engine put that line, account or month in front of a person. Silently wrong: the number is wrong and nothing says so. New: not in BLIND-1's list. DC: a new variant of double counting or of a number silently wrong.");
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
  p(Object.entries(unread).map(([k, v]) => `- ${k}, ${v} files`).join("\n") || "None.");
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
    p();
    p("| Trap | First run | This table | Way |");
    p("|---|---|---|---|");
    for (const [t, a, b, w] of MOVES) p(`| ${t} | ${a} | ${b} | ${w} |`);
  }
  p();
  p("## Seen but not planted");
  p();
  for (const n of SEEN) p(`- ${n}`);
  fs.writeFileSync(path.join(__dirname, "BLIND-2.md"), `${out.join("\n")}\n`);
  console.log(out.join("\n"));
}
const NOTES = [
  "Blind. Written from SPEC.md, RECIPES.md, the schemas, the public recipes, the intake, the world's file writers and the first held-out folder's build.js, run.js and BLIND-1.md. Not read: engine, score.js, ladder.js, eval/households, the Davies domains, src, merchants, or any diff of them. run.js calls rebuild and the public dictionary loader without either being opened. File layouts were recovered by searching the recipes' public fingerprints, never by opening Davies files. The shape of rebuild's output was learned by printing its keys on the first household, before this household existed in the engine.",
  "Budgets read the charge date and balances read the posting date. A charge in two files is one charge. Where a statement and a download disagree on the amount, the statement is the charge, because it closes on it.",
  "Cash income and spending follow SPEC 6.5 and the same treatment rule as BLIND-1's scorer. Rent counts at the net amount the agent pays, because the cash lens reads cash accounts; gross rent and repairs are probed separately in the economic lens. A loan repayment counts at its cash amount, interest-only ones included. Tax refunds and tax payments are neither. The refinance drawdown is neither. The wire from the share plan is neither.",
  "Net worth in truth carries money in the air between own accounts, trades between trade and settlement, the plan's sale until its wire lands, and AUD on the exchange between deposit and buy. Tomasz's accounts count from his membership date, 2025-03-24, because SPEC 4.1 says a membership row keeps past views right. HELP counts as a debt in loans; the setup says so, and a person would.",
  "Holdings, plan and coins are carried at the true month-end market value even for a month whose file is missing or unread, so a stale price shows as a wrong balance. The cold wallet is priced at the exchange's month-end BTC price, the only price a person holds. Property is the latest valuation; the first is dated 2023-06-30.",
  "Setup gives no opening balance a file states. Three categories are added by SPEC 12 because a person would need them: child support, parental pay, side income. PASS-THROUGH is added because SPEC 4.4c says it ships and the first household's list predates it. `contributes_to` points at the fund's contract, as SPEC 4.4 says, the shape that crashed the first household.",
  "T2-REIMB is scored on the employer's credit only. The engine cannot know a flight was for work unless told, so the outlay stays in truth as neither, moves the spending total, and is not held against it as a trap. T2-FALSE-PAIR is fair even though SPEC 8 says no law catches a crossed pair: a limit that is declared still leaves a wrong number.",
  "The RentPurrfect recipe's fingerprint could not be recovered in reasonable search time, so the second managing agent uses the PropertyMeow layout, and a netted repair sits in that layout's Management fees box with its own line in the table. A wrong economic split there is scored as silently wrong even though the cash is right; the dollars say how much. Tax is not scored: L11 is printed as the engine reports it. Salary packaging is left out because the public payslip recipe has no line for it.",
  "A flagged outcome needs the engine to name the line in review, or a law that fails or shows a gap on that account, or coverage that names the month; for a hole in a bank file the law must name the month, as BLIND-1 required. A file listed as unread by intake is a report of the intake, and does not by itself flag a number.",
];
const AFTER = [
  "The household did not change. Bundle a7003e9321dc340c, 2766 events, and every figure in the Scores table down to the review queue are the first run's, to the cent. What changed is how traps were read, the probes of the traps named below in build.js, and a date field on the one re-dated truth line. No money, no file and no setup row moved. The last convention above gained its clause about holes after the first run, to say what the code already did.",
  "First run: 21 handled, 17 flagged, 18 silently wrong. Now: 24 handled, 15 flagged, 17 silently wrong. Thirteen traps moved, eight up and five down, in the table below.",
  "Scorer bugs, which overstated the engine's errors and moved a trap up. T2-OFFSET-INTEREST looked for L6 at the account when it sits at the contract, and called the law check twice, so it read \"no check ran\". T2-SPLIT-SAME-AMOUNT's clearing test caught the PING loan's clearing by prefix. T2-DRP took a failing L7 as its own, when L7 names BTC and its ten differences match the ten BTC month-ends read after the move to the cold wallet; it now compares open OWL lots with truth. T2-SELL-STRADDLE-FY read all of the unsettled group, so the share plan's residue landed on it; it now reads the broker's settlement account alone, which is exactly right in both months. Review items that name a statement, an assessment or a trade rather than a bank line were invisible to the line matcher, so T2-AGENT-LATE, T2-RSU-WIRE, T2-CRYPTO-DEPOSIT and T2-TAX-BILL read as unasked when the engine had asked.",
  "Scorer bugs, which understated the errors and moved a trap down. A failing L7 anywhere flagged every account's balance probe. Limited to holding accounts, T2-HELP falls to silently wrong: nothing says the debt has no opening.",
  "Stricter after reading the first run, each lowering a score. A doubled line now counts as asked only if review asks whether it is doubled; a question about the merchant does not put the double in front of anyone. BLIND-1 let that stand as flagged, so on its rule T2-FX-AUTH and T2-HOLIDAY-LAG would read flagged. T2-CRYPTO-THIRD-COIN must be named by coverage, because the L7 failure beside it is about BTC units and not about a stale price; it also now measures the exchange alone, since the cold wallet's zero belongs to T2-CRYPTO-MOVE. T2-REFINANCE gained January 2025 after the balance table showed the new loan a month before it was drawn.",
  "Line table only, no total moved. Equal lines on one day now pair with the truth line of the same treatment, which took T2-REPAY-VS-SWEEP's false pairs out of the table; a re-dated line no longer shows as both extra and never booked; June's rent, banked 2 July, is no longer counted as never booked.",
];
const MOVES = [["T2-SELL-STRADDLE-FY", "silently wrong", "handled", "up"], ["T2-DRP", "flagged", "handled", "up"], ["T2-SPLIT-SAME-AMOUNT", "flagged", "handled", "up"], ["T2-AGENT-LATE", "silently wrong", "flagged", "up"], ["T2-RSU-WIRE", "silently wrong", "flagged", "up"], ["T2-CRYPTO-DEPOSIT", "silently wrong", "flagged", "up"], ["T2-TAX-BILL", "silently wrong", "flagged", "up"], ["T2-OFFSET-INTEREST", "silently wrong", "flagged", "up"], ["T2-HELP", "flagged", "silently wrong", "down"], ["T2-REFINANCE", "flagged", "silently wrong", "down"], ["T2-FX-AUTH", "flagged", "silently wrong", "down"], ["T2-HOLIDAY-LAG", "flagged", "silently wrong", "down"], ["T2-CRYPTO-THIRD-COIN", "flagged", "silently wrong", "down"]];
const SEEN = [
  "An ownership_change event: SPEC 4.3 says one records a change of owners. The everyday account changes owners in setup and the ledger holds none. position.net_worth_by_owner reports, and was not scored.",
  "Coverage for T2-CRYPTO-THIRD-COIN rests on the call pattern. run.js passes every received file as a receipt, as the first household did, so ACC-COIN shows 17 of 17 with three pages unread. Passing only read files, tried once outside this table, names 2025-08 and 2025-09 and not 2025-10, which a quarterly CSV fills. STM-CARD shows 37 of 37 either way, with 36 files in its folder and none dated May 2025.",
  "A fingerprint moved with the values. RECIPES.md says fingerprints come from structure, never values, but the seq in fingerprint.js runs through table rows that do not open with a date. The Coinpurr page's fingerprint is two coins, the first priced to two decimals and the second not: a third coin is a new format, so is a BTC price ending in a single decimal.",
  "L4 reports 47 observations unattached, and the ones it lists are childcare statements. Spending on those debits was right; the statements explain nothing.",
  "L5 said Tomasz's FY2025 payslips are held only from 2025-04-15, and no wage entered before he joined. That is the right answer to a year-end document reaching back.",
  "clearing:super:ACC-SUPER-IM's 1,608.00 is June 2026's two contributions, which land in July, outside the window. Not an error.",
];

if (require.main === module) report(run());
module.exports = { run, report };
