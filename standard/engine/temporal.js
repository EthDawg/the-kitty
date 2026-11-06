/* The two axes of time. A row is true on valid_on, as known at known_at, when
   valid_from <= valid_on < valid_to and recorded_at <= known_at < superseded_at. Ranges are half-open.
   Pass known_at = null for "as we know it now". */
"use strict";

const dateOf = (t) => (t ? String(t).slice(0, 10) : null);

function validOn(row, on) {
  return row.valid_from <= on && (row.valid_to == null || on < row.valid_to);
}
function knownAt(row, at) {
  if (at == null) return row.superseded_at == null;
  return (row.recorded_at == null || dateOf(row.recorded_at) <= at) && (row.superseded_at == null || at < dateOf(row.superseded_at));
}
const activeOn = (rows, on, at = null) => rows.filter((r) => validOn(r, on) && knownAt(r, at));

// term index: subject_type|subject_id|term -> rows
function indexTerms(rows) {
  const idx = new Map();
  for (const r of rows) {
    const k = `${r.subject_type}|${r.subject_id}|${r.term}`;
    if (!idx.has(k)) idx.set(k, []);
    idx.get(k).push(r);
  }
  return idx;
}
function termAt(idx, subjectType, subjectId, term, on, at = null) {
  const rows = idx.get(`${subjectType}|${subjectId}|${term}`) || [];
  const hit = rows.filter((r) => validOn(r, on) && knownAt(r, at));
  if (hit.length > 1) hit.sort((a, b) => (a.valid_from < b.valid_from ? 1 : -1));
  return hit.length ? hit[0].value : null;
}

/* Build a bitemporal timeline from dated notices, in the order they became known. Each notice {value, valid_from,
   recorded_at, source_obs_id} says "from valid_from the value is value", and replaces whatever was believed from that
   date on. Strict: nothing is ever rewritten. A row whose range changes is superseded and rewritten, so asking
   "what did we believe on that day" returns exactly what we believed. */
function timeline(subject, notices) {
  const out = [];
  let live = [];                              // rows currently believed
  let n = 0;
  const write = (r, recorded_at) => {
    const row = { ...subject, ...r, recorded_at, superseded_at: null };
    row.term_id = `${subject.subject_id}:${subject.term}:${++n}`;
    out.push(row); return row;
  };
  const ordered = [...notices].sort((a, b) => (a.recorded_at < b.recorded_at ? -1 : a.recorded_at > b.recorded_at ? 1 : a.valid_from < b.valid_from ? -1 : a.valid_from > b.valid_from ? 1 : 0));
  for (const k of ordered) {
    const keep = [];
    for (const r of live) {
      if (r.valid_from >= k.valid_from) { r.superseded_at = k.recorded_at; continue; }      // wholly replaced
      if (r.valid_to == null || r.valid_to > k.valid_from) {                                // truncated
        r.superseded_at = k.recorded_at;
        keep.push(write({ value: r.value, unit: r.unit, valid_from: r.valid_from, valid_to: k.valid_from, source_obs_id: r.source_obs_id, note: r.note }, k.recorded_at));
      } else keep.push(r);
    }
    keep.push(write({ value: k.value, unit: k.unit, valid_from: k.valid_from, valid_to: k.valid_to ?? null, source_obs_id: k.source_obs_id, note: k.note }, k.recorded_at));
    live = keep;
  }
  return out;
}

module.exports = { validOn, knownAt, activeOn, indexTerms, termAt, timeline };
