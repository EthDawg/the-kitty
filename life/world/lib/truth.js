/* Truth is read from the book, never from the engine: the true balance of every account at every month end, income and spending by person, net worth, the law that was assumed,
   the traps as they fell for this family, and for each chapter what a correct household should show. */
"use strict";
const { monthRange, monthEnd, fyEnd } = require("./std");

const ymOf = (d) => d.slice(0, 7);

function accountsTruth(sim) {
  const months = monthRange(sim.start.slice(0, 7), sim.end.slice(0, 7)), out = {};
  const ids = [...new Set([...Object.keys(sim.open), ...sim.lines.map((l) => l.acct)])].filter((id) => !["ACC-BIZ", "ACC-C1-EVERY"].includes(id));
  const byAcct = {}; for (const l of sim.lines) (byAcct[l.acct] = byAcct[l.acct] || []).push(l);
  for (const id of ids) {
    let bal = sim.open[id] || 0; const flows = {}, m = {};
    for (const l of byAcct[id] || []) flows[ymOf(l.date)] = (flows[ymOf(l.date)] || 0) + l.cents;
    const first = ymOf(sim.opened[id] || sim.start);
    for (const ym of months) { bal += flows[ym] || 0; if (ym >= first) m[ym] = bal; }
    out[id] = { months: m };
  }
  for (const key of ["A", "B"]) { const f = sim.super[key], m = {}; let bal = f.open; for (const ym of months) { for (const l of f.rows.filter((x) => ymOf(x.date) === ym)) bal = l.bal; m[ym] = bal; } out[`SUPER-${key}`] = { months: m }; }
  const help = {}; let hb = -sim.cast.opening["HELP-A"]; for (const ym of months) { for (const e of sim.help.full.filter((x) => ymOf(x.date) === ym)) hb = e.balance; help[ym] = -hb; } out["HELP-A"] = { months: help };
  if (sim.loan) { const m = {}; for (const r of sim.loan.rows) m[r.ym] = -r.closing; out["LN-HOME"] = { months: m }; }
  if (sim.home) { const hm = {}, cm = {}; for (const v of sim.valuations) { hm[v.ym] = v.home; cm[v.ym] = v.car; } out.HOME = { months: hm }; out.CAR = { months: cm }; }
  return out;
}

function flows(sim) {
  const income = {}, spending = {}, name = (who) => (who === "A" ? sim.cast.A.id : who === "B" ? sim.cast.B.id : who === "C1" ? sim.kids[0].id : who === "shared" ? "joint" : who);
  const add = (t, ym, who, cat, c) => { const m = t[ym] = t[ym] || { household: 0, by_person: {}, by_category: {} }; m.household += c; m.by_person[name(who)] = (m.by_person[name(who)] || 0) + c; m.by_category[cat] = (m.by_category[cat] || 0) + c; };
  for (const l of sim.lines) {
    if (l.lens === "income") add(income, ymOf(l.date), l.who, l.cat, l.cents);
    if (l.lens === "spending") add(spending, ymOf(l.date), l.who, l.cat, -l.cents);
  }
  const economic = {};
  for (const p of sim.pays) { const m = economic[ymOf(p.date)] = economic[ymOf(p.date)] || { gross_cents: {}, tax_cents: {}, super_cents: {} }, n = name(p.person); m.gross_cents[n] = (m.gross_cents[n] || 0) + p.full_gross; m.tax_cents[n] = (m.tax_cents[n] || 0) + p.tax; m.super_cents[n] = (m.super_cents[n] || 0) + p.sup; }
  return { income, spending, economic };
}

const GROUP = (id) => (id === "HOME" ? "property" : id === "CAR" ? "vehicle" : id === "LN-HOME" ? "loans" : /^SUPER/.test(id) ? "super" : id === "HELP-A" ? "tax" : "cash");
function netWorth(sim, accts) {
  const months = monthRange(sim.start.slice(0, 7), sim.end.slice(0, 7)), out = {};
  for (const ym of months) {
    const row = { total: 0, groups: {} };
    for (const [id, a] of Object.entries(accts)) { const v = a.months[ym]; if (v == null) continue; const g = GROUP(id); if (g === "tax") continue; row.total += v; row.groups[g] = (row.groups[g] || 0) + v; }
    if (sim.rsu.held && ym >= "2026-07") { const units = sim.rsu.gain && ym >= ymOf(sim.rsu.gain.date) ? 0 : sim.cast.opening.held_units, v = sim.value(units, ym); if (v) { row.total += v; row.groups.shares = v; } }
    out[ym] = row;
  }
  return out;
}

function taxTruth(sim) {
  const out = {};
  for (const [fy, recs] of Object.entries(sim.tax)) {
    const y = out[`FY${fy}`] = {};
    for (const key of ["A", "B"]) { const r = recs[key], v = r.amended || r; y[sim.people[key].id] = { labels: v.labels, version: v.version, assessed_on: v.assessed_on, lodged_on: v.lodged_on, ...v.res, ...(r.amended ? { original: { labels: r.labels, ...r.res, assessed_on: r.assessed_on } } : {}) }; }
  }
  return out;
}

function phiTruth(sim) {
  const out = {};
  for (const r of sim.phi) { const fy = `FY${r.month >= `${r.month.slice(0, 4)}-07` ? Number(r.month.slice(0, 4)) + 1 : r.month.slice(0, 4)}`, y = out[fy] = out[fy] || { periods: {} }, k = String(r.pct); const p = y.periods[k] = y.periods[k] || { pct: r.pct, tier: r.tier, gross_cents: 0, rebate_cents: 0, net_cents: 0, months: [] }; p.gross_cents += r.gross; p.rebate_cents += r.rebate; p.net_cents += r.net; if (!p.months.includes(r.month)) p.months.push(r.month); }
  return out;
}

function childInterest(sim) {
  const out = {};
  for (const [fy, list] of Object.entries(sim.interest)) { const c = list.filter((i) => i.acct === "ACC-C1-SAVE").reduce((t, i) => t + i.cents, 0); if (c) out[`FY${fy}`] = { interest_cents: c, owner: sim.kids[0].id, named_on_account: sim.cast.A.id, prefill_lands_on: sim.cast.A.id, under_416: c < 41600, threshold_source: "research.md Part A, 2025-26, 2026-27 unconfirmed" }; }
  return out;
}

function chapterTruth(script, sim, accts, income, spending, nw, files, setup, law) {
  const out = {}, C = sim.cast;
  const id = (r) => (r === "A" ? C.A.id : r === "B" ? C.B.id : (sim.kids.find((k) => k.role === r) || {}).id);
  for (const c of script.chapters) {
    const lastMonth = monthRange("2026-07", c.today.slice(0, 7)).filter((m) => monthEnd(m) <= c.today).pop();
    const held = files.filter((f) => f.held_from != null && f.held_from <= c.chapter);
    const streams = [...new Set(held.map((f) => f.stream))].sort();
    const accounts = [...new Set(held.map((f) => f.account).filter(Boolean))].sort();
    const row = { chapter: c.chapter, title: c.title, today: c.today, status: c.status, who: c.who, household: c.household.map(id).filter(Boolean), last_whole_month: lastMonth, streams, files_held: held.length, files_read_expected: held.filter((f) => f.family && !/^life-/.test(f.family)).length, simplified: c.simplified || null };
    if (c.status === "full") {
      row.show = { balances: Object.fromEntries(accounts.filter((a) => accts[a] && accts[a].months[lastMonth] != null).map((a) => [a, accts[a].months[lastMonth]])), income: income[lastMonth] || null, spending: spending[lastMonth] || null, net_worth: nw[lastMonth] || null, net_worth_note: "Truth across everything the family has, whether or not this chapter's household holds it yet. A correct household shows only what it holds, and says what it does not." };
    }
    out[c.chapter] = row;
  }
  void setup; void law; void fyEnd;
  return out;
}

function memoTruth(script, sim) {
  const ch = script.chapters.find((c) => c.family_intent), out = {};
  if (!ch) return out;
  for (const w of ch.family_intent) { const k = sim.kids.find((x) => x.role === w.person); out[k.id] = { said: w.said, from: sim.pocketMoney, weekly_cents: w.weekly_cents, chore_cents: w.chore_cents, chore_every_weeks: w.chore_every_weeks, as_at_chapter_today: { cents: 0, note: "The first Saturday falls after the chapter's reading. Pocket money is intent, so the memo starts at nil and nothing touches a bank account." }, account_type: "memo" }; }
  return out;
}

function buildTruth(script, sim, files, setup) {
  const accounts = accountsTruth(sim), { income, spending, economic } = flows(sim), net_worth = netWorth(sim, accounts);
  sim.note("T6-CHILD-INTEREST-OWNER", { by_fy: childInterest(sim) });
  sim.note("T6-PREFILL-WRONG-PERSON", { account: "ACC-C1-SAVE", prefill_person: sim.cast.A.id, owner: sim.kids[0].id });
  sim.note("T6-MEMO", memoTruth(script, sim));
  return {
    schema: "life-truth/1", family: sim.cast.id, seed: sim.cast.seed, variant: sim.cast.variant, window: { from: sim.start, to: sim.end },
    people: { [sim.cast.A.id]: { role: "A", name: sim.cast.A.name, born: sim.cast.A.born }, [sim.cast.B.id]: { role: "B", name: sim.cast.B.name, born: sim.cast.B.born }, ...Object.fromEntries(sim.kids.map((k) => [k.id, { role: k.role, name: k.name, born: k.born }])) },
    accounts, income, spending, economic, net_worth, tax: taxTruth(sim), health: phiTruth(sim), cgt: { value_day: sim.rsu.mv, disposal: sim.rsu.gain, status: "unconfirmed: Act 49 of 2026 read from search extracts, see research.md" },
    help: sim.help.full, loan: sim.loan ? sim.loan.rows : [], child_interest: childInterest(sim), memo: memoTruth(script, sim), assumed_law: sim.law.list(),
    chapters: chapterTruth(script, sim, accounts, income, spending, net_worth, files, setup, sim.law), traps: sim.traps,
  };
}

module.exports = { buildTruth };
