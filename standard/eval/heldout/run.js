#!/usr/bin/env node
/* Scores the engine on a household it has never seen. Builds the Okafor-Lindqvists, ingests their files, rebuilds with only their onboarding setup and the public
   dictionary and recipes, and compares every number with the simulation's truth. No decisions, no rules. Nothing here adjusts anything to improve a score.

   node standard/eval/heldout/run.js        prints the table and writes RESULT.md beside this file */
"use strict";
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const STD = path.join(__dirname, "..", "..");
const { build, OUT, SETUP_DIR } = require("./build");
const { ingest, loadRecipes } = require("../../intake");
const { rebuild } = require("../../engine/rebuild");
const Engine = require("../../../src/engine.js");

const read = (p, d) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return d; } };
const money = (c) => (c == null ? "n/a" : `${c < 0 ? "-" : ""}${(Math.abs(c) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`);
const days = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 864e5;

function loadSetup() { const out = {}; for (const f of fs.readdirSync(SETUP_DIR)) if (f.endsWith(".json")) out[f.replace(".json", "")] = read(path.join(SETUP_DIR, f), []); return out; }

/* A person answers contributes_to by naming the fund's contract, which the schema allows. If the engine cannot read that, the same fact is restated at the fund's member account so there is anything to score. Reported, never silent. */
function restateSuperLinks(setup) {
  const acct = new Map(setup.contract.filter((c) => c.kind === "super_fund").map((c) => [c.contract_id, c.account_id]));
  return { ...setup, link: setup.link.map((l) => (l.relation === "contributes_to" && l.to_type === "contract" ? { ...l, to_type: "account", to_id: acct.get(l.to_id) } : l)) };
}

function run() {
  build();
  Engine.loadMerchants({ merchants: read(path.join(STD, "..", "merchants", "merchants.json")), categories: read(path.join(STD, "..", "merchants", "categories.json")) });
  const manifest = read(path.join(OUT, "manifest.json")), truth = read(path.join(OUT, "truth.json")), recipes = loadRecipes(path.join(STD, "recipes"));
  const intake = ingest({ root: OUT, recipes, manifest });
  const schema = { events: read(path.join(STD, "schema", "events.json")), metrics: read(path.join(STD, "schema", "metrics.json")) };
  const reference = read(path.join(STD, "reference", "au.json"), null);
  const receipts = (intake.files || []).map((f) => { const parts = f.path.split("/"); return { stream_id: parts[1], day: parts[2] }; });
  const once = (setup) => rebuild({ setup, sources: intake.sources, observations: intake.observations, decisions: [], rules: [], schema, reference, receipts });
  const setup = loadSetup(); let L, crash = null, used = setup;
  try { L = once(setup); } catch (e) {
    crash = { message: e.message, at: (String(e.stack).split("\n").find((x) => /engine\//.test(x)) || "").trim().replace(/^.*standard\//, "standard/").replace(/\)$/, ""), via: (String(e.stack).split("\n").filter((x) => /engine\//.test(x))[1] || "").trim().replace(/^.*standard\//, "standard/").replace(/\)$/, "") };
    used = restateSuperLinks(setup); L = once(used);
  }
  return { L, truth, intake, manifest, setup: used, crash };
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
  const find = (account, date, cents, wide) => { const w = wide != null ? wide : account === "ACC-CARD" ? 3 : 0; return (events.get(`${account}|${cents}`) || []).filter((e) => days(e.occurred_on, date) <= w); };
  const asked = (account, date, cents) => { const w = account === "ACC-CARD" ? 3 : 0; return L.review.filter((r) => { const p = String(r.ref).split("|"); return p[0] === account && p[1] && /^\d{4}-/.test(p[1]) && days(p[1], date) <= w && Number(p[2]) === cents; }); };
  const balance = (a, m) => (bal[a] && bal[a][m] != null ? bal[a][m] : 0);
  return { treat, find, asked, balance, cats, setup, cashAcct };
}

function scoreTable(L, truth, R) {
  const months = Object.keys(truth.income), accounts = Object.keys(truth.balances), rows = [];
  const num = (list, key) => new Map(list.map((x) => [x.month, x[key]]));
  const series = (name, want, got) => {
    let exact = 0, abs = 0, sumW = 0, sumG = 0, worst = null; const off = [];
    for (const m of months) { const w = want[m], g = got(m) || 0, d = g - w; sumW += w; sumG += g; abs += Math.abs(d); if (d === 0) exact += 1; else off.push(m); if (!worst || Math.abs(d) > Math.abs(worst.d)) worst = { m, d }; }
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
  return { rows, perAcct, bal, uncategorised_share: spent ? uncat / spent : 0 };
}

// ---------- every cash line, one by one: did the engine book it once, and treat it as truth does ----------
function reconcile(L, truth, R) {
  const pool = new Map(); truth.cash_lines.forEach((x, i) => { const k = `${x.account}|${x.cents}`; if (!pool.has(k)) pool.set(k, []); pool.get(k).push({ ...x, i }); });
  const taken = new Set(), legs = [], extra = [], wrong = {};
  for (const e of L.events) { if (e.kind === "opening_balance") continue; for (const p of e.postings || []) if (R.cashAcct.has(p.account_id)) legs.push({ e, account: p.account_id, cents: p.amount_cents }); }
  for (const pass of [0, 1, 6]) for (const v of legs) {
    if (v.t) continue;
    let best = null, gap = Infinity;
    for (const x of pool.get(`${v.account}|${v.cents}`) || []) { if (taken.has(x.i)) continue; const d = Math.min(days(x.date, v.e.occurred_on), x.posted ? days(x.posted, v.e.occurred_on) : Infinity); if (d <= pass && d < gap && (pass < 6 || v.account === "ACC-CARD" || x.own)) { best = x; gap = d; } }
    if (best) { taken.add(best.i); v.t = best; }
  }
  for (const v of legs) {
    if (!v.t) { extra.push(v); continue; }
    const got = R.treat(v.e); if (got === v.t.lens) continue;
    const k = `${v.t.lens} booked as ${got}`, w = (wrong[k] = wrong[k] || { count: 0, cents: 0, examples: new Set() });
    w.count += 1; w.cents += Math.abs(v.cents); if (w.examples.size < 3) w.examples.add(v.t.what.replace(/\s+/g, " "));
  }
  const missing = truth.cash_lines.filter((x, i) => !taken.has(i) && x.date >= truth.window[0]);
  const dup = L.review.filter((r) => r.kind === "possible_duplicate"), cards = extra.filter((v) => v.account === "ACC-CARD" && v.e.kind === "purchase");
  const asked = cards.filter((v) => dup.some((r) => { const p = String(r.ref).split("|"); return p[0] === "ACC-CARD" && Number(p[2]) === v.cents && days(p[1], v.e.occurred_on) <= 6; }) || R.asked("ACC-CARD", v.e.occurred_on, v.cents).some((r) => r.kind === "possible_duplicate")).length;
  const lagOf = (v) => { const c = (pool.get(`ACC-CARD|${v.cents}`) || []).find((x) => x.posted && days(x.date, v.e.occurred_on) <= 6); return c ? days(c.date, c.posted) : 0; };
  const byLag = {}; for (const v of cards) { const l = lagOf(v); byLag[l] = (byLag[l] || 0) + 1; }
  const paired = truth.own_transfers.filter((x) => { const a = R.find(x.from, x.date_out, -x.cents, 5), b = R.find(x.to, x.date_in, x.cents, 5); return a.length && b.length && a.every((e) => R.treat(e) === "neither") && b.every((e) => R.treat(e) === "neither") && a.concat(b).every((e) => e.kind !== "open_transfer"); }).length;
  return { lines: truth.cash_lines.length, matched: taken.size, extra: extra.length, extra_cents: extra.reduce((t, v) => t + v.cents, 0), missing: missing.length, missing_cents: missing.reduce((t, x) => t + x.cents, 0), wrong, card_doubles: { count: cards.length, cents: cards.reduce((t, v) => t - v.cents, 0), asked, by_lag: Object.entries(byLag).map(([d, n]) => `${n} posted ${d} days after the charge`).join(", ") }, own: { paired, of: truth.own_transfers.length } };
}

// ---------- each planted trap: handled, flagged, or silently wrong ----------
function judgeLine(R, x) {
  const found = R.find(x.account, x.date, x.cents), n = x.n || 1, treatments = found.map(R.treat);
  const fine = found.length === n && treatments.every((t) => t === x.want) && (!x.month || found.every((e) => (e.charged_on || e.occurred_on).slice(0, 7) === x.month));
  const said = `${x.account} ${x.date} ${money(x.cents)}: want ${x.want}${n > 1 ? ` x${n}` : ""}${x.month ? ` in ${x.month}` : ""}, got ${found.length ? found.map((e, i) => `${e.kind}/${e.category_id || "no category"}/${treatments[i]}${x.month ? ` on ${e.charged_on || e.occurred_on}` : ""}`).join(", ") : "no event"}`;
  if (fine) return { outcome: "handled", said };
  return { outcome: R.asked(x.account, x.date, x.cents).length ? "flagged" : "silently wrong", said };
}
const worstOf = (list) => (list.includes("silently wrong") ? "silently wrong" : list.includes("flagged") ? "flagged" : "handled");

function judge(trap, ctx) {
  const { R, L, truth, intake } = ctx, p = trap.probe, notes = [], outcomes = [];
  const lines = (p.lines || []).map((x) => judgeLine(R, x));
  for (const l of lines) outcomes.push(l.outcome);
  const bad = lines.filter((l) => l.outcome !== "handled");
  if (p.kind === "split") {
    const c = L.checks.find((x) => x.law === "L2" && x.scope === "clearing:payroll:PTY-GREYWATER");
    notes.push(`clearing:payroll:PTY-GREYWATER ${c ? c.status : "absent"}`);
    if (c && c.status !== "pass") outcomes.push("flagged");
  }
  if (p.kind === "balance") {
    const off = p.months.filter((m) => truth.balances[p.account][m] !== R.balance(p.account, m));
    const l3 = L.checks.find((x) => x.law === "L3" && x.scope === p.account);
    notes.push(`${p.months.length - off.length} of ${p.months.length} month-ends exact`);
    if (off.length) outcomes.push(l3 && l3.status !== "pass" ? "flagged" : "silently wrong");
    else outcomes.push("handled");
  }
  if (p.balances) for (const b of p.balances) {
    const off = b.months.filter((m) => truth.balances[b.account][m] !== R.balance(b.account, m));
    notes.push(`${b.account}: ${b.months.length - off.length} of ${b.months.length} month-ends exact`);
    if (off.length) { const l3 = L.checks.find((x) => x.law === "L3" && x.scope === b.account); outcomes.push(l3 && l3.status !== "pass" ? "flagged" : "silently wrong"); }
  }
  if (p.kind === "zero_after") {
    const ms = Object.keys(truth.income).filter((m) => m >= p.from), off = ms.filter((m) => R.balance(p.account, m) !== 0);
    notes.push(`${ms.length - off.length} of ${ms.length} month-ends at zero${off.length ? `, ${off[0]} shows ${money(R.balance(p.account, off[0]))}` : ""}`);
    if (off.length) outcomes.push("silently wrong");
  }
  if (p.kind === "networth") for (const m of p.months) {
    const sum = Object.keys(truth.balances).reduce((t, a) => t + R.balance(a, m), 0), row = L.netWorth.find((x) => x.month === m), held = row ? row.total - sum : null, want = truth.in_transit[m];
    const e = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5)), 0)).toISOString().slice(0, 10);
    if (p.legs) {
      const dates = p.legs.map((l) => { const x = R.find(l.account, l.date, l.cents, 5)[0] || {}; return (x.leg_dates && x.leg_dates[l.account]) || x.occurred_on; }), dip = dates[0] && dates[1] && dates[0] <= e && dates[1] > e && held !== want;
      notes.push(`the engine dates the two legs ${dates.join(" and ")}${held === want && want ? `, holds ${money(want)} in the air` : ""}, so at ${e} net worth ${dip ? "dips" : "does not dip"}`);
      outcomes.push(dip ? "silently wrong" : "handled");
    } else {
      notes.push(`${m}: ${money(want)} owed or owing between trade and settlement in truth, ${money(held)} in the engine's net worth`);
      outcomes.push(held === want ? "handled" : "silently wrong");
    }
  }
  if (p.kind === "gap") {
    const c = L.coverage.find((x) => x.stream_id === p.account), missing = c ? (c.missing || []).map(String) : [];
    const said = missing.some((x) => x.includes(p.month));
    notes.push(`coverage for ${p.account}: ${c ? `${c.have} of ${c.expected}, missing ${missing.join(", ") || "nothing"}` : "no row"}`);
    outcomes.push(said ? "flagged" : "silently wrong");
  }
  if (p.kind === "hole") {
    const l3 = L.checks.find((x) => x.law === "L3" && x.scope === p.account), c = L.coverage.find((x) => x.stream_id === p.account);
    const said = l3 && l3.status !== "pass" && /2026-0[45]/.test(String(l3.detail));
    notes.push(`L3 ${l3 ? `${l3.status}: ${l3.detail || ""}` : "absent"}; coverage ${c ? `${c.have} of ${c.expected}` : "no row"}; the ${money(p.net_cents)} that moved ${said ? "is named" : "is not named"}`);
    outcomes.push(said ? "flagged" : "silently wrong");
  }
  if (p.kind === "card_lag") {
    const x = ctx.rec.card_doubles;
    notes.push(`${x.count} card lines counted twice, ${money(x.cents)}, ${x.by_lag}; ${x.asked} of them asked about`);
    outcomes.push(x.count === 0 ? "handled" : x.asked === x.count ? "flagged" : "silently wrong");
  }
  if (p.kind === "duplicate") {
    const e = intake.files.find((f) => f.path === p.path);
    notes.push(e && e.duplicate_of ? "same bytes, one source" : "imported as a new source");
    outcomes.push(e && e.duplicate_of ? "handled" : "silently wrong");
  }
  const rank = { "silently wrong": 0, flagged: 1 };
  return { id: trap.id, name: trap.name, where: trap.where, expect: trap.expect, outcome: worstOf(outcomes), lines_ok: lines.filter((l) => l.outcome === "handled").length, lines_total: lines.length, notes, bad: bad.slice().sort((a, b) => rank[a.outcome] - rank[b.outcome]).map((l) => `${l.outcome}: ${l.said}`) };
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
  p("# Held-out household: Okafor-Lindqvist, after repairs");
  p();
  p("**This run is not blind.** The blind result is [BLIND-1.md](BLIND-1.md), kept as it was written. The engine then took one repair per shape, each with a failing fixture under `eval/households/`. None of them read this household's numbers, but the household is why they exist, so this table shows only that the repairs work. Whether they generalise is what a new blind household tests.");
  p();
  p(`Generated by \`node standard/eval/heldout/run.js\`. Engine at ${head}${dirty}. Bundle ${L.bundleHash}. ${intake.sources.length} sources, ${intake.observations.length} observations, ${L.events.length} events, ${intake.files.filter((f) => f.duplicate_of).length} duplicate file, ${intake.unknown_files.length} unread, ${intake.faults.length} intake faults. No decisions, no rules. Public recipes and dictionary, and one family's onboarding answers.`);
  p();
  if (crash) {
    p(`**The rebuild crashed on the setup as answered.** \`${crash.message}\` at \`${crash.at}\`, called from \`${crash.via}\`. It is schema-valid to point \`contributes_to\` at a \`super_fund\` contract, and SPEC 4.4 says it ties employment to a super fund. To get any score at all, run.js restated those three links at the funds' member accounts, the same fact in the other valid shape. Every number below is after that one change.`);
    p();
  }
  p("## Scores");
  p();
  p("| Measure | Exact months | Mean error a month | Truth, 36 months | Engine, 36 months | Worst month |");
  p("|---|---|---:|---:|---:|---|");
  for (const x of T.rows) p(`| ${x.name} | ${x.exact} of ${x.of} | ${money(x.mae)} | ${x.name === "Net worth" ? `${money(truth.networth["2026-06"])} at June 2026` : money(x.truth_total)} | ${x.name === "Net worth" ? `${money((L.netWorth.find((n) => n.month === "2026-06") || {}).total)} at June 2026` : money(x.engine_total)} | ${x.worst.m}, off by ${money(x.worst.d)} |`);
  // A card's statement closes on the posting. Truth counts a line when charged. Read on the bank's dates, what a charge not yet posted moves comes back out.
  const charged = truth.cash_lines.filter((x) => x.account === "ACC-CARD" && x.posted);
  const months = Object.keys(truth.networth), onBank = (m) => { const e = `${m}-31`; return truth.networth[m] - charged.filter((x) => x.date <= e && x.posted > e).reduce((t, x) => t + x.cents, 0); };
  const rowOf = (m) => (L.netWorth.find((x) => x.month === m) || {}).total;
  p(`| Net worth, the card on the bank's posting dates | ${months.filter((m) => rowOf(m) === onBank(m)).length} of ${months.length} | ${money(Math.round(months.reduce((t, m) => t + Math.abs(rowOf(m) - onBank(m)), 0) / months.length))} | | | |`);
  p(`| Balances, account-months | ${T.bal.exact} of ${T.bal.of} | | | | ${T.bal.all_exact_months} months with every account exact |`);
  p(`| Balance movements, account-months | ${T.bal.moved} of ${T.bal.moved_of} | | | | right change month on month, whatever the opening |`);
  p(`| Review items | ${L.review.length} | | | | ${Object.entries(reviewKinds).map(([k, v]) => `${k} ${v}`).join(", ")} |`);
  p(`| Traps | ${tally.handled} handled, ${tally.flagged} flagged, ${tally["silently wrong"]} silently wrong, of ${traps.length} | | | | |`);
  p();
  const asks = new Map(); for (const x of L.review.filter((i) => i.kind === "uncategorised")) asks.set(x.question, (asks.get(x.question) || 0) + Math.abs(x.amount_cents));
  const byValue = [...asks.values()].sort((a, b) => b - a), total = byValue.reduce((a, b) => a + b, 0), top = byValue.slice(0, 30).reduce((a, b) => a + b, 0);
  p(`Spending left uncategorised: ${(T.uncategorised_share * 100).toFixed(1)}% of the dollars. Every merchant is invented, so the dictionary knows few of them; uncategorised spending still counts as spending. The ${L.review.filter((i) => i.kind === "uncategorised").length} lines are ${asks.size} questions, one per merchant, and the first 30 cover ${(top / (total || 1) * 100).toFixed(1)}% of their dollars.`);
  p();
  p("## Line by line");
  p();
  p(`${rec.lines} lines on cash accounts in truth. ${rec.matched} booked by the engine. ${rec.extra} extra legs worth ${money(rec.extra_cents)}. ${rec.missing} lines never booked, net ${money(rec.missing_cents)}. Own transfers paired as transfers: ${rec.own.paired} of ${rec.own.of}.`);
  p();
  p("| Truth says | Lines | Dollars | For example |");
  p("|---|---:|---:|---|");
  for (const [k, w] of Object.entries(rec.wrong).sort((a, b) => b[1].cents - a[1].cents)) p(`| ${k} | ${w.count} | ${money(w.cents)} | ${[...w.examples].join("; ")} |`);
  p();
  p("## Balances by account");
  p();
  p("| Account | Exact month-ends | Exact movements | Mean error | June 2026, truth | June 2026, engine |");
  p("|---|---|---|---:|---:|---:|");
  for (const a of T.perAcct) p(`| ${a.account} | ${a.exact} of ${a.of} | ${a.moved} of ${a.moved_of} | ${money(a.mae)} | ${money(a.last.truth)} | ${money(a.last.engine)} |`);
  p();
  p("## Traps");
  p();
  p("Handled: the number is right. Flagged: the number is wrong or unknowable, and the engine put that line, account or month in front of a person. Silently wrong: the number is wrong and nothing says so.");
  p();
  p("| Trap | Outcome | Evidence |");
  p("|---|---|---|");
  for (const t of traps) p(`| ${t.id}: ${t.name} | **${t.outcome}** | ${[t.lines_total ? `${t.lines_ok} of ${t.lines_total} lines right` : "", ...t.notes, ...t.bad.slice(0, 3)].filter(Boolean).join("; ").replace(/\|/g, "/")} |`);
  p();
  p("## Laws");
  p();
  p(Object.entries(laws).map(([k, v]) => `${k}: ${Object.entries(v).map(([s, n]) => `${n} ${s}`).join(", ")}`).join(". ") + ".");
  p();
  for (const c of L.checks.filter((x) => x.status === "fail")) p(`- ${c.law} ${c.scope}: ${c.detail || ""}${c.gap_cents != null ? ` Gap ${money(c.gap_cents)}.` : ""}`);
  p();
  p("## What the table rests on");
  p();
  for (const n of NOTES) p(`- ${n}`);
  fs.writeFileSync(path.join(__dirname, "RESULT.md"), `${out.join("\n")}\n`);
  console.log(out.join("\n"));
}
const NOTES = [
  "Blind. Written from SPEC.md, RECIPES.md, the schemas, the public recipes, the world's file writers, the intake and the call pattern in eval/run.js. The engine, score.js, the Davies domains, decisions and rules were not read; only the output of `rebuild`, and one stack trace, were. File layouts were recovered by matching the recipes' public fingerprints, not by opening Davies files. The first lines of merchants/categories.json, an icon map, were seen by accident; merchants.json was not.",
  "Setup gives no opening balances where a file states one. Only the car's value is typed. So an account can fail on exact balances and pass on movements.",
  "The 53 default categories have nowhere to put rent a tenant pays, so setup adds x_RENT-PAID, by SPEC 12.",
  "Tax is not scored. L11 is printed as the engine reports it; the notices hold deductions and a capital gain the files do not show, and setup has no tax_map.",
  "Changed after the first run, none of it to raise a score. The scorer read a transfer entry filed under UNCAT as spending though it nets to nothing, and read two straddling transfers as dips though the engine dates both legs together; both overstated the engine's errors. The tax notices left out interest and dividends, a bug in this household that inflated L11. Added, which lowered the score: T-POSTING-LAG and the line-by-line table, after the sampled T-DATE-BASIS hid the doubled card lines. Each month's spending gap was then traced to its lines: all 36 explain to the cent.",
  "Truth uses SPEC 4.4c for the employer reimbursement: neither income nor spending. This household's categories were copied before PASS-THROUGH shipped, and a person never told the engine a parking fee was a work cost, so T-REIMBURSEMENT is scored against a fact it could only learn by asking.",
  "Net worth in truth carries money in the air between own accounts, and trades between trade and settlement. The engine now does too: SPEC 6.6.",
  "Card lines count on the date charged. The card's statement closes on the posting date, so a month-end card balance here and the bank's differ by what is charged and not yet posted. The engine follows the bank for balances and the charge for spending; the first net worth row reads truth's way, the second the bank's. Property is carried at settlement cost until the first dated valuation, read from asset_purchase in schema/events.json. Holdings use the true month-end market value, even for the month whose file is missing.",
  "Scorer changes for this run. It reads the month a line counts in from charged_on, the field the cash lens reads, and each transfer leg from leg_dates. Added: the second net worth row and the question count.",
];

if (require.main === module) report(run());
module.exports = { run, report };
