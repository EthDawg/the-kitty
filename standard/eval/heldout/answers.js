/* What a person's answers buy. The review queue is one question per merchant. Answer them in dollar order, the way the simulation's truth would, rebuild, and read the months.
   This is the onboarding curve: how far the numbers come for how many answers. Truth stands in for the person, so it shows what the questions are worth, not how well anyone answers them. */
"use strict";
const days = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 864e5;

function questions(L) {
  const by = new Map();
  for (const r of L.review.filter((x) => x.kind === "uncategorised")) {
    const q = by.get(r.question) || { question: r.question, cents: 0, refs: [] };
    q.cents += Math.abs(r.amount_cents); q.refs.push(r.ref); by.set(r.question, q);
  }
  return [...by.values()].sort((a, b) => b.cents - a.cents);
}
// What truth says one question's lines are.
function answer(q, truth, setup) {
  const cats = new Set(setup.category.map((c) => c.category_id)), votes = new Map();
  for (const ref of q.refs) {
    const [account, date, cents] = ref.split("|");
    const t = truth.cash_lines.find((x) => x.account === account && x.cents === Number(cents) && days(x.date, date) <= 6) || null;
    if (!t) continue;
    const pick = t.category && cats.has(t.category) ? t.category : t.lens === "income" ? "GIFT-IN" : t.lens === "spending" ? "OTHER" : "TRANSFER";
    votes.set(pick, (votes.get(pick) || 0) + 1);
  }
  return [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}
const exact = (L, truth, key) => Object.keys(truth[key]).filter((m) => ((L.cash.find((x) => x.month === m) || {})[key] || 0) === truth[key][m]).length;
function curve(L, truth, setup, again, steps = [10, 20, 30]) {
  const qs = questions(L), rows = [{ answers: 0, income: exact(L, truth, "income"), spending: exact(L, truth, "spending"), left: qs.length, share: 0 }];
  const total = qs.reduce((s, q) => s + q.cents, 0) || 1;
  for (const n of [...steps.filter((x) => x < qs.length), qs.length]) {
    const rules = qs.slice(0, n).map((q, i) => ({ q, i, cat: answer(q, truth, setup) })).filter((x) => x.cat).map(({ q, i, cat }) => ({ rule_id: `a${i}`, pattern: q.question, match: "contains", category_id: cat, provenance: "person" }));
    const A = again(rules);
    rows.push({ answers: n, income: exact(A, truth, "income"), spending: exact(A, truth, "spending"), left: questions(A).length, share: qs.slice(0, n).reduce((s, q) => s + q.cents, 0) / total });
  }
  return rows;
}
module.exports = { curve, questions };
