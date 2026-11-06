/* Step 2 of resolution: collapse witnesses of account lines into one line each.
   Two identical coffees on one day are two purchases. One coffee in two overlapping downloads is one purchase.
   So identity is a multiset: within (account, date, cents), the true count is the largest count any single source
   shows, and lines across sources pair one to one by description. See SPEC 6.2. */
"use strict";
const { groupBy, cmp, daysBetween } = require("./util");

const PENDING_DAYS = 7;

const words = (s) => new Set(String(s || "").toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 1));
function similarity(a, b) {
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const w of A) if (B.has(w)) n += 1;
  return n / Math.max(A.size, B.size);
}

// obs: resolved observations, each { obs, account, date, cents, desc, ref, status, sourceId, seq }
function collapse(items) {
  const posted = items.filter((x) => x.status !== "pending");
  const pending = items.filter((x) => x.status === "pending");
  const lines = [];
  const faults = [];

  // A bank's stable reference is identity. A same-reference pair with different amounts is a restatement, not two lines.
  const withRef = groupBy(posted.filter((x) => x.ref), (x) => `${x.account}|${x.ref}`);
  const taken = new Set();
  for (const [, group] of withRef) {
    const amounts = new Set(group.map((x) => x.cents));
    if (amounts.size > 1) faults.push({ kind: "restated_line", ref: group[0].ref, account: group[0].account, what: `Reference ${group[0].ref} carries ${amounts.size} amounts.` });
    // Latest source wins a restatement; the rest stay as witnesses.
    const best = [...group].sort((a, b) => cmp(b.capturedAt || "", a.capturedAt || "") || cmp(a.obs.obs_id, b.obs.obs_id))[0];
    lines.push(makeLine(best, group));
    for (const x of group) taken.add(x);
  }

  const rest = posted.filter((x) => !taken.has(x));
  for (const [, group] of groupBy(rest, (x) => `${x.account}|${x.date}|${x.cents}`)) {
    const perSource = [...groupBy(group, (x) => x.sourceId).values()].sort((a, b) => b.length - a.length || cmp(a[0].sourceId, b[0].sourceId));
    const anchors = [...perSource[0]].sort((a, b) => a.seq - b.seq);
    const buckets = anchors.map((a) => [a]);
    for (const other of perSource.slice(1)) {
      const free = new Set(buckets.map((_, i) => i));
      const list = [...other].sort((a, b) => a.seq - b.seq);
      for (const x of list) {
        let best = -1, score = -1;
        for (const i of free) {
          const s = similarity(x.desc, buckets[i][0].desc);
          if (s > score) { score = s; best = i; }
        }
        buckets[best].push(x); free.delete(best);
      }
    }
    for (const b of buckets) lines.push(makeLine(b[0], b));
  }

  // A pending line is a witness that expires: replaced by its posted form, kept only while nothing later has covered its date.
  const coverage = new Map();
  for (const l of lines) coverage.set(l.account, l.date > (coverage.get(l.account) || "") ? l.date : coverage.get(l.account));
  for (const p of pending) {
    const match = lines.find((l) => l.account === p.account && l.cents === p.cents && !l.pendingMatched && daysBetween(p.date, l.date) >= -1 && daysBetween(p.date, l.date) <= PENDING_DAYS);
    if (match) { match.pendingMatched = true; match.witnesses.push(p.obs); continue; }
    if ((coverage.get(p.account) || "") > p.date && daysBetween(p.date, coverage.get(p.account)) > PENDING_DAYS) { faults.push({ kind: "pending_dropped", ref: p.obs.obs_id, account: p.account, what: `Pending ${p.desc} never posted; dropped.` }); continue; }
    const line = makeLine(p, [p]); line.provisional = true; lines.push(line);
  }

  const seen = new Map();
  lines.sort((a, b) => cmp(a.account, b.account) || cmp(a.date, b.date) || a.seq - b.seq || cmp(a.desc, b.desc));
  for (const l of lines) {
    const base = `${l.account}|${l.date}|${l.cents}`;
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    l.key = `${base}|${n}`;
  }
  return { lines, faults };
}

function makeLine(best, group) {
  const longest = group.reduce((a, x) => (String(x.desc).length > String(a).length ? x.desc : a), best.desc);
  return {
    account: best.account, date: best.date, valueDate: best.valueDate || null, cents: best.cents, desc: longest, ref: best.ref || null,
    seq: best.seq, balanceAfter: group.map((x) => x.balanceAfter).find((v) => v != null) ?? null, cardMember: best.cardMember || null,
    foreignAmount: best.foreignAmount || null, foreignCurrency: best.foreignCurrency || null,
    witnesses: group.map((x) => x.obs), claimed: null, cls: null,
  };
}

module.exports = { collapse, similarity };
