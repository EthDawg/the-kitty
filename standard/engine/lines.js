/* Step 2 of resolution: collapse witnesses of account lines into one line each.
   Two identical coffees on one day are two purchases. One coffee in two overlapping downloads is one purchase.
   So identity is a multiset: within (account, date, cents), the true count is the largest count any single source
   shows, and lines across sources pair one to one by description. See SPEC 6.2. */
"use strict";
const { groupBy, cmp, daysBetween } = require("./util");
const MATCH = require("../schema/matching.json");

const PENDING_DAYS = MATCH.windows_days.pending.days, DRIFT_DAYS = MATCH.windows_days.date_drift.days, SIMILAR = MATCH.similarity.minimum;

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
  // A reference that repeats inside one file is a label ("DIV", "INT"), not an identity.
  const repeats = new Set();
  for (const [k, g] of groupBy(posted.filter((x) => x.ref), (x) => `${x.sourceId}|${x.account}|${x.ref}`)) if (g.length > 1) repeats.add(k.split("|").slice(1).join("|"));
  for (const [k, g] of groupBy(posted.filter((x) => x.ref), (x) => `${x.account}|${x.ref}`)) {
    const dates = g.map((x) => x.date).sort();
    if (daysBetween(dates[0], dates[dates.length - 1]) > 10) repeats.add(k);
  }
  const withRef = groupBy(posted.filter((x) => x.ref && !repeats.has(`${x.account}|${x.ref}`)), (x) => `${x.account}|${x.ref}`);
  const taken = new Set();
  for (const [, group] of withRef) {
    const amounts = new Set(group.map((x) => x.cents));
    if (amounts.size > 1) faults.push({ kind: "restated_line", ref: group[0].ref, account: group[0].account, what: `Reference ${group[0].ref} carries ${amounts.size} amounts.` });
    // The later-issued document wins a restatement, not the later download; the rest stay as witnesses.
    const best = [...group].sort((a, b) => cmp(b.issuedOn || b.capturedAt || "", a.issuedOn || a.capturedAt || "") || cmp(a.obs.obs_id, b.obs.obs_id))[0];
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

  /* A statement dates a charge by the transaction, its CSV by the posting. Same charge, two dates. If each source covers both days and
     shows the line only on its own day, it is one line: a source that covers a day and does not show the line there is saying so.
     Declared date bases are a hint, never a requirement. */
  const span = new Map();
  for (const x of posted) { const k = `${x.sourceId}|${x.account}`; const r = span.get(k) || { lo: x.date, hi: x.date }; if (x.date < r.lo) r.lo = x.date; if (x.date > r.hi) r.hi = x.date; span.set(k, r); }
  const sourcesOf = (l) => new Set(l.witnesses.map((o) => o.source_id));
  const covers = (l, day) => [...sourcesOf(l)].every((src) => { const r = span.get(`${src}|${l.account}`); return r && r.lo <= day && day <= r.hi; });
  const merged = new Set();
  for (const [, group] of groupBy(lines, (l) => `${l.account}|${l.cents}`)) {
    const sorted = [...group].sort((a, b) => cmp(a.date, b.date) || a.seq - b.seq);
    for (let i = 0; i < sorted.length; i++) {
      const a = sorted[i];
      if (merged.has(a)) continue;
      for (let j = i + 1; j < sorted.length; j++) {
        const b = sorted[j];
        if (merged.has(b) || daysBetween(a.date, b.date) > DRIFT_DAYS || a.date === b.date) continue;
        const A = sourcesOf(a), B = sourcesOf(b);
        if ([...A].some((x) => B.has(x))) continue;                         // one source showing both means two charges
        const declared = a.dateBasis && b.dateBasis && a.dateBasis !== b.dateBasis;
        if (similarity(a.desc, b.desc) < SIMILAR) continue;
        if (!declared && !(covers(a, b.date) && covers(b, a.date))) {
          // Neither file covers the other's day, so nothing proves it one charge or two. It stays two and becomes a question.
          if (similarity(a.desc, b.desc) >= 0.5) faults.push({ kind: "possible_duplicate", ref: `${a.account}|${a.date}|${a.cents}`, account: a.account, cents: a.cents, what: `${a.desc} on ${a.date} and ${b.date} in two files. One charge or two?` });
          continue;
        }
        const keep = a.dateBasis === "posting" ? a : b.dateBasis === "posting" ? b : a, drop = keep === a ? b : a;
        keep.witnesses.push(...drop.witnesses); merged.add(drop);
        break;
      }
    }
  }
  if (merged.size) { const live = lines.filter((l) => !merged.has(l)); lines.length = 0; lines.push(...live); }

  // The same charge a cent apart, from two sources covering both days, cannot be proved one or two. It stays two and becomes a question.
  for (const [, group] of groupBy(lines, (l) => l.account)) {
    const sorted = [...group].sort((a, b) => cmp(a.date, b.date) || a.cents - b.cents);
    for (let i = 0; i < sorted.length; i++) for (let j = i + 1; j < sorted.length && daysBetween(sorted[i].date, sorted[j].date) <= DRIFT_DAYS; j++) {
      const a = sorted[i], b = sorted[j];
      if (a.cents === b.cents || Math.abs(a.cents - b.cents) > Math.max(5, Math.abs(a.cents) * 0.01)) continue;
      const A = sourcesOf(a), B = sourcesOf(b);
      if ([...A].some((x) => B.has(x)) || similarity(a.desc, b.desc) < 0.5) continue;
      faults.push({ kind: "possible_duplicate", ref: `${a.account}|${a.date}|${a.cents}`, account: a.account, cents: a.cents, what: `${a.desc} appears as ${a.cents / 100} and ${b.cents / 100} in two files. One charge or two?` });
    }
  }

  // A pending line is a witness that expires: replaced by its posted form, kept only while nothing later has covered its date.
  const coverage = new Map();
  for (const l of lines) coverage.set(l.account, l.date > (coverage.get(l.account) || "") ? l.date : coverage.get(l.account));
  for (const p of pending) {
    // A hold can post at a different amount: a tip, a fuel pre-authorisation. Same merchant inside the window is the same charge.
    const inWindow = (l) => l.account === p.account && !l.pendingMatched && daysBetween(p.date, l.date) >= -1 && daysBetween(p.date, l.date) <= PENDING_DAYS;
    const match = lines.find((l) => inWindow(l) && l.cents === p.cents) || lines.find((l) => inWindow(l) && similarity(l.desc, p.desc) >= 0.5);
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
    seq: best.seq, dateBasis: best.dateBasis || null, balanceAfter: group.map((x) => x.balanceAfter).find((v) => v != null) ?? null, cardMember: best.cardMember || null,
    foreignAmount: best.foreignAmount || null, foreignCurrency: best.foreignCurrency || null,
    witnesses: group.map((x) => x.obs), claimed: null, cls: null,
  };
}

module.exports = { collapse, similarity };
