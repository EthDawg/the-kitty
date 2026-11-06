/* Scoring reads truth and the rebuilt ledger. It never writes, and a verb never reads it. */
"use strict";
const { monthRange, monthEnd } = require("../world/lib/std");
const { money, dayYear, monthYear } = require("../../src/household/words");
const { addDays } = require("../../standard/engine/util");

// Two yeses, one name, one split. Every other thing on joining day is a default or a rebind. More than this is a regression, and it fails.
const JOINING_DAY_QUESTIONS = 4;
function monthsSpoken(windows, today) {
  const out = new Set();
  for (const w of windows) for (const ym of monthRange(w.from.slice(0, 7), w.to.slice(0, 7))) { const e = monthEnd(ym); if (e <= today && e <= w.to && e >= w.from) out.add(ym); }
  return [...out].sort();
}
const upTo = (dates, first = "2026-07") => { const last = dates.slice().sort().pop(); return last ? monthRange(first, last.slice(0, 7)).filter((m) => monthEnd(m) <= last) : []; };
/* Which month ends this household's own files can answer for. The same reading the world's soundness run makes. */
function spoken(hh, today) {
  const files = (hh.files || []).filter((f) => f.world).map((f) => f.world), out = {}, push = (id, months) => { out[id] = [...new Set([...(out[id] || []), ...months])].sort(); };
  const windows = {};
  for (const f of files) if (f.account && f.window && f.stream !== "CARD-A") (windows[f.account] = windows[f.account] || []).push(f.window);
  for (const [id, w] of Object.entries(windows)) push(id, monthsSpoken(w, today));
  const issued = (stream) => files.filter((f) => f.stream === stream).map((f) => f.issued_on).filter(Boolean);
  if (issued("CARD-A").length) push("ACC-A-CARD", upTo(issued("CARD-A")));
  for (const k of ["A", "B"]) { const mine = files.filter((f) => f.stream === `SUPER-${k}`); if (mine.length) push(`SUPER-${k}`, upTo(mine.map((f) => { const m = /(\d{4}-\d{2}-\d{2})\.json$/.exec(f.name); return m ? m[1] : f.issued_on; }).filter(Boolean))); }
  if (issued("LOAN").length) push("LN-HOME", upTo(issued("LOAN"), "2028-02"));
  if (issued("HELP-A").length) push("HELP-A", upTo(issued("HELP-A")));
  return out;
}
/* The truth a chapter stands on, to the cent: each balance it names, every month end the household's files speak for, money in and out by month, net worth, each lodged year's labels. */
function ties(hh, built, F, { today, chapter, accounts, flows = true }) {
  const { L } = built, c = F.chapter(chapter), show = c.show, out = { tied: 0, off: [], by: {} };
  const check = (kind, what, want, got) => { out.by[kind] = (out.by[kind] || 0) + 1; if (want === got) out.tied += 1; else out.off.push({ kind, what, want, got }); };
  const mine = accounts ? new Set(accounts) : null, id = (x) => hh.ids.get(x) || x;
  for (const [a, x] of Object.entries(show.balances)) if (!mine || mine.has(a)) check("balance", `${a} ${x.month}`, x.cents, L.balances.at(id(a), x.month));
  for (const [a, months] of Object.entries(spoken(hh, today))) {
    if (mine && !mine.has(a)) continue;
    const t = F.truth.accounts[a]; if (!t) continue;
    for (const m of months) if (t.months[m] != null) check("month_end", `${a} ${m}`, t.months[m], L.balances.at(id(a), m));
  }
  if (flows) {
    const row = L.cash.find((x) => x.month === show.month) || { income: 0, unexplained: 0, spending: 0 };
    check("income", `income ${show.month}`, show.income_cents, row.income + row.unexplained);
    check("spending", `spending ${show.month}`, show.spending_cents, row.spending);
    if (chapter >= 4) for (const m of L.cash.map((x) => x.month).filter((x) => x >= "2026-07" && x < show.month)) {
      const r = L.cash.find((x) => x.month === m), i = (F.truth.income[m] || {}).household || 0, s = (F.truth.spending[m] || {}).household || 0;
      check("income", `income ${m}`, i, r.income + r.unexplained); check("spending", `spending ${m}`, s, r.spending);
    }
  }
  if (chapter >= 4) for (const [fy, people] of Object.entries(F.truth.tax)) {
    if (fy === "FY2026" || addDays(`${fy.slice(2)}-06-30`, 90) > today) continue; // a year is whole when its last statements have had time to arrive
    for (const [who, t] of Object.entries(people)) for (const [label, want] of Object.entries(t.labels || {})) {
      if (label === "D10" || label === "12") continue; // D10 is the agent's fee and 12 the plan statement: neither is a figure this household derives, and F-005 owns the second
      const got = L.tax.items.filter((i) => i.label === label && i.fy === fy && i.party_id === id(who.toUpperCase())).reduce((n, i) => n + i.amount_cents, 0);
      check("tax_label", `${fy} ${who} label ${label}`, want, got);
    }
  }
  return out;
}
/* What a person must read, built from truth so a variant is held to the same sentences with its own numbers. */
function words(run, n) {
  const { F, book } = run, b = book[n], show = F.chapter(n).show, s = b.status.words, say = b.hh.transcript.map((t) => t.say), want = [];
  const has = (what, text) => want.push({ what, want: text, ok: s.includes(text) || say.includes(text) || (b.next && b.next.say === text) });
  const line = (what, text) => want.push({ what, want: text, ok: s.includes(text) });
  const flow = () => `${monthYear(show.month)}: ${money(show.income_cents)} in, ${money(show.spending_cents)} out.`;
  if (n === 0) {
    const file = F.trap("T0-NO-RECIPE")[0].file, reads = b.dropped.needs_recipe.length;
    has("the first thing she reads", "Start your Kitty."); has("the second", "Add your first bank file.");
    if (reads) has("a file with no recipe", `We can't read ${file} yet.`);
    const end = Object.values(show.balances)[0];
    line("first value", `${money(end.cents)} across the 1 account we know about.`);
  }
  if (n === 1) { line("first month in words", flow()); has("nothing in the way of a close", `Close ${monthYear(b.status.readiness.months[0].month)}.`); }
  if (n === 2) {
    line("what she is worth", `${money(show.net_worth_cents)} across the ${Object.keys(show.balances).length + 1} accounts we know about.`); line("the month", flow());
    const t = F.trap("T2-DRIVE-MISSING-MONTH")[0]; want.push({ what: "the Drive's gap is named", want: t.month, ok: b.drive_status.readiness.coverage.streams.some((x) => x.stream_id === t.stream && x.missing.includes(t.month)) });
    want.push({ what: "the sitting ends with nothing left to do", want: "up to date or waiting", ok: ["clear", "other_side"].includes(b.next.id) });
  }
  if (n === 3) {
    const j = b.joined, c = F.trap("T3-TWO-NAMES-ONE-ACCOUNT")[0];
    want.push({ what: "each person is asked", want: "consent from both", ok: j.questions.filter((q) => q.id.startsWith("consent:")).length === 2 });
    want.push({ what: "two names are named", want: `One account, two names: ${c[F.A.id]} and ${c[F.B.id]}. Which do you want?`, ok: j.questions.some((q) => q.say === `One account, two names: ${c[F.A.id]} and ${c[F.B.id]}. Which do you want?`) });
    line("the joint Kitty reaches joining day", `${b.status.household.name}. Your files reach ${dayYear(b.today)}.`);
    want.push({ what: "the sitting ends with nothing left to do", want: "up to date or waiting", ok: ["clear", "other_side"].includes(b.next.id) });
    const asked = b.hh.questions.filter((q) => q.day === b.today).length;
    want.push({ what: "questions on joining day", want: String(JOINING_DAY_QUESTIONS), ok: asked === JOINING_DAY_QUESTIONS });
  }
  if (n >= 4) { line("the month", flow()); }
  if (n === 4) want.push({ what: "locked months say so when both histories arrive", want: "a reopen proposal", ok: b.proposals.length > 0 });
  if (n >= 4) want.push({ what: "the sitting ends with nothing left to do", want: "up to date or waiting", ok: ["clear", "other_side", "stale"].includes(b.next.id) });
  if (n === 6) {
    want.push({ what: "her sentence is kept", want: "the sentence", ok: b.pocket.checks.every((c) => c.sentence === b.pocket.sentence) });
    want.push({ what: "the update says nothing she entered changes", want: "Nothing you entered changes.", ok: /^Nothing you entered changes\./.test(b.pocket.dry.summary) });
  }
  return want;
}
module.exports = { ties, words, spoken, monthsSpoken };
