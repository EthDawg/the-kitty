/* The interpreter. A recipe is data: no eval, no functions. Table recipes map columns; document recipes find labels and row patterns over text
   lines. Both end in the same field expressions, and output observations per schema/observations.json, each with a locator. Pure: the only
   inputs are the decoded file, the recipe and the vocabulary. Same input, same output. */
"use strict";

const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12, january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
const pad = (n) => String(n).padStart(2, "0");
const dim = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const iso = (y, m, d) => (m >= 1 && m <= 12 && d >= 1 && d <= dim(y, m) ? `${y}-${pad(m)}-${pad(d)}` : null);
const year2 = (y) => (y < 70 ? 2000 + y : 1900 + y);

/* A date, strictly. Formats: dmy mdy ymd yyyymmdd dmy2 mdy2 dmony (07 Mar 2019) mony (Mar 2019, gives the first of the month) iso (a timestamp's date). */
function parseDate(v, fmt) {
  const s = String(v == null ? "" : v).trim(); let m;
  switch (fmt) {
    case "dmy": m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s); return m ? iso(+m[3], +m[2], +m[1]) : null;
    case "mdy": m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s); return m ? iso(+m[3], +m[1], +m[2]) : null;
    case "dmy2": m = /^(\d{1,2})[/.'-](\d{1,2})[/.'-](\d{2})$/.exec(s); return m ? iso(year2(+m[3]), +m[2], +m[1]) : null;
    case "mdy2": m = /^(\d{1,2})[/.'-](\d{1,2})[/.'-](\d{2})$/.exec(s); return m ? iso(year2(+m[3]), +m[1], +m[2]) : null;
    case "ymd": m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s); return m ? iso(+m[1], +m[2], +m[3]) : null;
    case "yyyymmdd": m = /^(\d{4})(\d{2})(\d{2})/.exec(s); return m ? iso(+m[1], +m[2], +m[3]) : null;
    case "iso": m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ]|$)/.exec(s); return m ? iso(+m[1], +m[2], +m[3]) : null;
    case "dmony": m = /^(\d{1,2})[ -]([A-Za-z]{3,9})[ -](\d{4})$/.exec(s); return m && MON[m[2].toLowerCase()] ? iso(+m[3], MON[m[2].toLowerCase()], +m[1]) : null;
    case "mony": m = /^([A-Za-z]{3,9})[ -](\d{4})$/.exec(s); return m && MON[m[1].toLowerCase()] ? iso(+m[2], MON[m[1].toLowerCase()], 1) : null;
    default: return null;
  }
}
const AMBIGUOUS = { dmy: "mdy", mdy: "dmy", dmy2: "mdy2", mdy2: "dmy2" };

/* Money to integer cents, from text, never through a float. Takes A$, $, thousands commas, a leading sign, (brackets) and a CR or DR suffix. */
function parseCents(v) {
  let s = String(v == null ? "" : v).trim(); if (s === "") return null;
  let sign = 1;
  if (/\bDR$/i.test(s)) { sign = -1; s = s.replace(/\s*DR$/i, ""); } else if (/\bCR$/i.test(s)) s = s.replace(/\s*CR$/i, "");
  if (/^\(.*\)$/.test(s)) { sign = -sign; s = s.slice(1, -1); }
  if (s[0] === "-" || s[0] === "−") { sign = -sign; s = s.slice(1); } else if (s[0] === "+") s = s.slice(1);
  s = s.replace(/^(A|AU|US)?\$/, "").replace(/^-/, () => { sign = -sign; return ""; }).replace(/,/g, "").trim();
  const m = /^(\d*)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m || (m[1] === "" && m[2] == null)) return null;
  return sign * (Number(m[1] || 0) * 100 + Number((m[2] || "0").padEnd(2, "0")));
}
const parseUnits = (v) => { const s = String(v == null ? "" : v).trim().replace(/,/g, ""); return /^-?\d*\.?\d+$/.test(s) ? s : null; };

const ctxText = (v) => (v == null ? "" : String(v).trim());
const metaAt = (meta, path) => {
  if (meta && meta.values && meta.values[path] != null) return meta.values[path];
  let o = meta; for (const k of String(path).split(".")) { if (o == null) return null; o = o[k]; } return o;
};
const blank = (v) => v == null || v === "";

function cast(v, e, x) {
  const as = e.as || "text";
  if (blank(v)) return null;
  switch (as) {
    case "text": return ctxText(v);
    case "date": { const d = parseDate(v, e.format || x.dateFormat); if (d == null) x.fault("bad_date", `${v} does not read as ${e.format || x.dateFormat}`); else if (AMBIGUOUS[e.format || x.dateFormat]) x.noteDate(String(v).trim(), e.format || x.dateFormat); return d; }
    case "month_start": { const d = parseDate(v, "mony"); if (d == null) x.fault("bad_date", `${v} is not a month`); return d; }
    case "month_end": { const d = parseDate(v, "mony"); if (d == null) { x.fault("bad_date", `${v} is not a month`); return null; } const [y, m] = d.split("-").map(Number); return `${y}-${pad(m)}-${pad(dim(y, m))}`; }
    case "cents": { const c = parseCents(v); if (c == null) x.fault("bad_amount", `${v} is not money`); return c; }
    case "units": { const u = parseUnits(v); if (u == null) x.fault("bad_units", `${v} is not a number`); return u; }
    case "int": { const n = /^-?\d+$/.test(String(v).trim().replace(/,/g, "")) ? Number(String(v).trim().replace(/,/g, "")) : null; if (n == null) x.fault("bad_int", `${v} is not a whole number`); return n; }
    case "bool": return /^(true|yes|y|1)$/i.test(String(v).trim());
    case "fy": { const m = /(\d{4})/.exec(String(v)); return m ? `FY${m[1]}` : null; }
    case "json": return v;
    default: x.fault("bad_recipe", `no cast ${as}`); return null;
  }
}

/* One field expression. See RECIPES.md. */
function evalExpr(e, x) {
  if (e === null || typeof e !== "object") return e;
  let v;
  if ("const" in e) v = e.const;
  else if (e.stream) v = x.stream;
  else if ("col" in e) v = x.col(e.col);
  else if ("group" in e) v = x.group ? x.group[e.group] : null;
  else if ("cell" in e) v = x.cells ? x.cells[e.cell] : null;
  else if ("value" in e) return x.values ? x.values[e.value] : null;
  else if ("meta" in e) v = metaAt(x.meta, e.meta);
  else if ("first" in e) { for (const a of e.first) { const r = evalExpr(a, x); if (!blank(r)) return r; } return null; }
  else if ("sum" in e) {
    let t = null; for (const a of e.sum) { const c = typeof a === "object" && a.as ? evalExpr(a, x) : evalExpr({ ...a, as: "cents" }, x); if (c != null) t = (t || 0) + c; }
    v = t; if (v == null) return null; return finish(v, e);
  } else if ("credit" in e || "debit" in e) {
    const cr = e.credit ? evalExpr({ ...(typeof e.credit === "object" ? e.credit : { col: e.credit }), as: "cents" }, x) : null;
    const dr = e.debit ? evalExpr({ ...(typeof e.debit === "object" ? e.debit : { col: e.debit }), as: "cents" }, x) : null;
    if (cr == null && dr == null) return null;
    return finish((cr || 0) - Math.abs(dr || 0), e);
  } else return null;
  if (typeof v === "string" && e.regex) { const m = new RegExp(e.regex, e.flags || "").exec(v); v = m ? (m[1] != null ? m[1] : m[0]) : null; }
  if (typeof v === "string" && e.replace) v = v.replace(new RegExp(e.replace[0], "g"), e.replace[1]);
  if (e.map && v != null) v = e.map[String(v).trim()] != null ? e.map[String(v).trim()] : e.map["*"] != null ? e.map["*"] : null;
  if (blank(v) && e.default !== undefined) return e.default;
  return finish(cast(v, e, x), e);
}
function finish(v, e) {
  if (v == null) return v;
  if (e.negate && typeof v === "number") v = -v;
  if (e.abs && typeof v === "number") v = Math.abs(v);
  return v;
}

const seededShuffle = (a, seed) => { const out = a.slice(); let s = seed >>> 0; for (let i = out.length - 1; i > 0; i--) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; const j = s % (i + 1); [out[i], out[j]] = [out[j], out[i]]; } return out; };

class Run {
  constructor(recipe, decoded, opts) {
    this.r = recipe; this.d = decoded; this.o = opts; this.vocab = opts.vocab; this.meta = decoded.meta || {};
    this.out = []; this.faults = []; this.unconsumed = []; this.consumed = 0; this.skipped = 0; this.controls = []; this.dates = [];
    this.dateFormat = (recipe.defaults && recipe.defaults.date) || "dmy";
    this.values = {}; this.tables = {}; this.locator = "file";
  }
  ctx(extra) {
    const self = this;
    return { meta: this.meta, stream: this.o.stream, dateFormat: this.dateFormat, values: this.values,
      fault(code, what) { self.faults.push({ code, what, locator: self.locator }); },
      noteDate(token, fmt) { self.dates.push({ token, fmt, locator: self.locator }); },
      col() { return null; }, ...extra };
  }
  emit(spec, x, locator, extra) {
    const kind = this.vocab.kinds[spec.kind];
    if (!kind) { this.faults.push({ code: "bad_recipe", what: `no kind ${spec.kind}`, locator }); return null; }
    if (spec.when && !this.when(spec.when, x)) return null;
    this.locator = locator;
    const payload = {};
    if (spec.from_values) for (const f of kind.fields) { const k = f.replace(/\*$/, ""); if (!blank(this.values[k])) payload[k] = this.values[k]; }
    for (const [k, e] of Object.entries(spec.fields || {})) { const v = evalExpr(e, x); if (!blank(v)) payload[k] = v; }
    if (extra) Object.assign(payload, extra);
    for (const f of kind.fields) if (f.endsWith("*") && blank(payload[f.slice(0, -1)])) this.faults.push({ code: "missing_field", what: `${spec.kind}.${f.slice(0, -1)}`, locator });
    const names = new Set(kind.fields.map((f) => f.replace(/\*$/, "")));
    for (const k of Object.keys(payload)) if (!names.has(k)) this.faults.push({ code: "unknown_field", what: `${spec.kind}.${k}`, locator });
    const occurred = kind.occurred ? String(payload[kind.occurred] == null ? "" : payload[kind.occurred]).slice(0, 10) : null;
    const amount = kind.amount ? payload[kind.amount] : null;
    const subject = Object.keys(payload).find((k) => k.endsWith("_ref"));
    const conf = spec.confidence != null ? spec.confidence : this.r.confidence != null ? this.r.confidence : this.r.tier === "table" ? 1 : 0.98;
    const o = { kind: spec.kind, locator, occurred_on: occurred || null, amount_cents: amount == null ? null : amount, currency: payload.currency || (this.r.defaults && this.r.defaults.currency) || "AUD", subject_ref: subject ? String(payload[subject]) : null, payload, importer: `recipe:${this.r.id}@${this.r.version || 1}`, recipe_id: this.r.id, confidence: conf, status: "active" };
    this.out.push(o);
    return o;
  }
  when(w, x) {
    const v = evalExpr(w, x);
    if (w.equals !== undefined) return String(v) === String(w.equals);
    if (w.in) return w.in.includes(String(v));
    if (w.not_blank) return !blank(v);
    if (w.blank) return blank(v);
    if (w.positive) return typeof v === "number" && v > 0;
    if (w.nonzero) return typeof v === "number" && v !== 0;
    if (w.matches) return new RegExp(w.matches, w.flags || "").test(String(v == null ? "" : v));
    return !blank(v);
  }
}

// ---------- table recipes ----------
function runTable(R) {
  const r = R.r, d = R.d, t = r.table || {};
  let rows = d.rows || [], locRow = (i) => `line ${(R.meta.row_lines && R.meta.row_lines[i]) || i + 1}`;
  if (t.sheet) { rows = (R.meta.sheets && R.meta.sheets[t.sheet]) || []; locRow = (i) => `${t.sheet} row ${i + 1}`; }
  else if (t.path) { rows = (R.meta.tables && R.meta.tables[t.path]) || []; locRow = (i) => `${t.path}[${i - 1}]`; }
  else if (t.html_table != null) { rows = (R.meta.tables && R.meta.tables[t.html_table]) || []; locRow = (i) => `table ${t.html_table} row ${i + 1}`; }
  else if (R.meta.container === "ofx") locRow = (i) => `STMTTRN ${i}`;
  else if (R.meta.container === "qif") locRow = (i) => `record ${i}`;
  rows = rows.map((c, i) => ({ cells: c, i })).filter((x) => !(x.cells.length === 0 || (x.cells.length === 1 && x.cells[0] === "")));
  const headerAt = t.header || 0;
  let header = t.columns || null, start = 0;
  if (headerAt) { const h = rows[headerAt - 1]; if (!h) { R.faults.push({ code: "no_header", what: "header row missing", locator: "file" }); return; } header = h.cells.map((c) => c.trim()); start = headerAt; R.skipped += headerAt; }
  if (t.skip_head) { start = Math.max(start, t.skip_head); }
  const end = rows.length - (t.skip_tail || 0);
  R.skipped += rows.length - end;
  let body = rows.slice(start, end);
  if (R.o.shuffle != null) body = seededShuffle(body, R.o.shuffle);
  const idx = {}; (header || []).forEach((h, i) => { if (idx[h] == null) idx[h] = i; });
  const col = (cells) => (name) => { if (typeof name === "number") return cells[name]; if (idx[name] == null) { R.faults.push({ code: "no_column", what: name, locator: "header" }); return null; } return cells[idx[name]]; };
  const skips = (t.skip || []).map((s) => ({ ...s, re: new RegExp(s.regex, s.flags || "") }));
  const captured = {};
  const done = [];
  for (const row of body) {
    R.locator = locRow(row.i);
    const x = R.ctx({ col: col(row.cells), cells: row.cells });
    const sk = skips.find((s) => s.re.test(String(s.col == null ? row.cells.join(",") : (col(row.cells)(s.col) ?? ""))));
    if (sk) { R.skipped += 1; if (sk.capture) for (const [k, e] of Object.entries(sk.capture)) captured[k] = evalExpr(e, x); continue; }
    let hit = 0;
    for (const spec of r.emit) { const o = R.emit(spec, x, locRow(row.i)); if (o) { hit += 1; done.push(o); } }
    if (hit) R.consumed += 1; else R.unconsumed.push({ locator: locRow(row.i), text: row.cells.join(" | ").slice(0, 120) });
  }
  statementFrom(R, r.statement, done, captured);
}

/* a statement the file implies. chain: from the running balance on the first and last rows. opening: captured opening plus the movements.
   closing: a stated closing less the movements. */
function statementFrom(R, spec, done, captured) {
  if (!spec || R.o.shuffle != null) return;
  const lines = done.filter((o) => o.kind === "txn_line");
  if (!lines.length) return;
  const order = (R.r.table && R.r.table.order) || "oldest_first";
  const seq = order === "newest_first" ? lines.slice().reverse() : lines;
  const sum = lines.reduce((s, o) => s + o.payload.amount_cents, 0);
  const credits = lines.filter((o) => o.payload.amount_cents > 0).reduce((s, o) => s + o.payload.amount_cents, 0), debits = sum - credits;
  let opening, closing;
  if (spec.from === "chain") { closing = seq[seq.length - 1].payload.balance_after_cents; opening = seq[0].payload.balance_after_cents - seq[0].payload.amount_cents; }
  else if (spec.from === "opening") { opening = captured[spec.opening || "opening_cents"]; closing = opening == null ? null : opening + sum; }
  else if (spec.from === "closing") { closing = evalExpr(spec.closing, R.ctx({})); opening = closing == null ? null : closing - sum; }
  if (opening == null || closing == null) { R.faults.push({ code: "no_statement", what: "cannot state the file's opening and closing", locator: "file" }); return; }
  const dates = lines.map((o) => o.payload.posting_date).sort();
  const account_ref = seq[0].payload.account_ref;
  const period_start = spec.period_start ? evalExpr(spec.period_start, R.ctx({})) : dates[0], period_end = spec.period_end ? evalExpr(spec.period_end, R.ctx({})) : dates[dates.length - 1];
  R.emit({ kind: "statement", fields: {}, confidence: 1 }, R.ctx({}), "file", { account_ref, period_start, period_end, opening_cents: opening, closing_cents: closing, credits_cents: credits, debits_cents: -debits });
}

// ---------- document recipes ----------
function findValue(R, spec, lines) {
  const rx = new RegExp(spec.below || spec.right || spec.find || spec.after, spec.flags || "");
  let pool = lines;
  if (spec.page) pool = pool.filter((l) => l.page === spec.page);
  if (spec.region) pool = regionLines(pool, spec.region);
  const nth = spec.nth || 0; let n = 0;
  for (let i = 0; i < pool.length; i++) {
    const l = pool[i];
    if (spec.find) { const m = rx.exec(l.text); if (m) { if (n++ === nth) return m[1] != null ? m[1] : m[0]; } continue; }
    for (let c = 0; c < l.cells.length; c++) {
      const m = rx.exec(l.cells[c]); if (!m) continue;
      if (n++ !== nth) continue;
      if (spec.after) return l.cells[c].slice(m.index + m[0].length).trim() || l.cells[c + 1] || null;
      if (spec.right) return l.cells[spec.cell != null ? spec.cell : c + 1];
      // below: the next line's cell nearest this label's x
      const next = pool[i + 1]; if (!next) return null;
      if (!l.xs || !next.xs) return next.cells[c] != null ? next.cells[c] : null;
      let best = null, gap = 1e9;
      next.xs.forEach((x, j) => { const g = Math.abs(x - l.xs[c]); if (g < gap) { gap = g; best = j; } });
      return gap <= (spec.x_tolerance || 12) ? next.cells[best] : null;
    }
  }
  return null;
}
function regionLines(lines, reg) {
  const out = [];
  for (const l of lines) {
    if (reg.page && l.page !== reg.page) continue;
    if (!l.xs) { out.push(l); continue; }
    const keep = l.xs.map((x, i) => (x >= (reg.x_min == null ? -1e9 : reg.x_min) && x < (reg.x_max == null ? 1e9 : reg.x_max) ? i : -1)).filter((i) => i >= 0);
    if (!keep.length) continue;
    out.push({ ...l, cells: keep.map((i) => l.cells[i]), xs: keep.map((i) => l.xs[i]), text: keep.map((i) => l.cells[i]).join("  ") });
  }
  return out;
}

function runDocument(R) {
  const r = R.r; let lines = (R.d.lines || []);
  if (r.drop_cells) {
    const re = new RegExp(r.drop_cells);
    lines = lines.map((l) => { if (!l.cells.some((c) => re.test(c))) return l; const keep = l.cells.map((c, i) => (re.test(c) ? -1 : i)).filter((i) => i >= 0); return { ...l, cells: keep.map((i) => l.cells[i]), xs: l.xs ? keep.map((i) => l.xs[i]) : l.xs, text: keep.map((i) => l.cells[i]).join("  ") }; }).filter((l) => l.cells.length);
  }
  const furniture = (r.furniture || []).map((s) => new RegExp(s));
  const body = lines.filter((l) => !furniture.some((f) => f.test(l.text)));
  R.skipped += lines.length - body.length;
  for (const [name, spec] of Object.entries(r.values || {})) {
    R.locator = `value ${name}`;
    const x = R.ctx({});
    const raw = spec.meta ? metaAt(R.meta, spec.meta) : spec.const !== undefined ? spec.const : spec.stream ? R.o.stream : findValue(R, spec, body);
    let v = raw;
    if (typeof v === "string" && spec.regex) { const m = new RegExp(spec.regex, spec.flags || "").exec(v); v = m ? (m[1] != null ? m[1] : m[0]) : null; }
    if (typeof v === "string" && spec.replace) v = v.replace(new RegExp(spec.replace[0], "g"), spec.replace[1]);
    if (spec.map && v != null) v = spec.map[String(v).trim()] != null ? spec.map[String(v).trim()] : spec.map["*"] != null ? spec.map["*"] : null;
    if (blank(v) && spec.default !== undefined) { R.values[name] = spec.default; continue; }
    R.values[name] = v == null ? null : finish(cast(v, spec, x), spec);
    if (R.values[name] == null && !spec.optional) R.faults.push({ code: "missing_value", what: name, locator: `value ${name}` });
  }
  for (const t of r.tables || []) runDocTable(R, t, body);
  for (const spec of r.emit || []) { const o = R.emit(spec, R.ctx({}), spec.locator || "page 1"); if (o) R.consumed += 1; }
}

function runDocTable(R, t, all) {
  const lines = t.region ? regionLines(all, t.region) : all;
  const start = new RegExp(t.start), end = t.end ? new RegExp(t.end) : null, skip = (t.skip || []).map((s) => new RegExp(s));
  const rowRe = t.row ? new RegExp(t.row) : null, wrapRe = t.wrap ? new RegExp(t.wrap) : null;
  const rows = []; const collected = []; let inside = false, seen = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!inside) { if (start.test(l.text) && (!seen || t.repeat_header !== false)) { inside = true; seen = true; R.skipped += 1; } continue; }
    if (end && end.test(l.text)) {
      inside = false; R.consumed += 1;
      if (t.foot) { const m = new RegExp(t.foot).exec(l.text); if (m) R.tables[`${t.name}.foot`] = m; }
      if (!t.repeat_header) break;
      continue;
    }
    if (start.test(l.text) || skip.some((s) => s.test(l.text))) { R.skipped += 1; continue; }
    const m = rowRe ? rowRe.exec(l.text) : null;
    if (rowRe && m) { rows.push({ l, m }); continue; }
    if (!rowRe && t.columns) { const c = byColumn(l, t.columns); if (c) { rows.push({ l, c }); continue; } }
    if (wrapRe && wrapRe.test(l.text) && rows.length) { rows[rows.length - 1].more = `${rows[rows.length - 1].more ? `${rows[rows.length - 1].more} ` : ""}${l.text}`; R.skipped += 1; continue; }
    R.unconsumed.push({ locator: `page ${l.page} y ${l.y}`, text: l.text.slice(0, 120) });
  }
  if (seen === false && !t.optional) R.faults.push({ code: "no_table", what: t.name, locator: "file" });
  const order = R.o.shuffle != null ? seededShuffle(rows, R.o.shuffle) : rows;
  order.forEach((row) => {
    const loc = `page ${row.l.page} y ${row.l.y}`;
    R.locator = loc;
    const x = R.ctx({ group: row.m || null, cells: row.l.cells, col: (n) => (row.c ? row.c[n] : null), more: row.more });
    const rec = {};
    for (const [k, e] of Object.entries(t.collect || {})) rec[k] = evalExpr(e, x);
    collected.push(rec);
    let hit = 0;
    for (const spec of t.emit || []) { const o = R.emit(spec, x, loc); if (o) hit += 1; }
    if (hit || t.collect) R.consumed += 1; else R.unconsumed.push({ locator: loc, text: row.l.text.slice(0, 120) });
  });
  R.tables[t.name] = collected;
}
function byColumn(l, cols) {
  const c = {}; let any = 0;
  if (!l.xs) return null;
  l.cells.forEach((text, i) => { const h = cols.find((k) => l.xs[i] >= k.x[0] && l.xs[i] < k.x[1]); if (h) { c[h.name] = c[h.name] ? `${c[h.name]} ${text}` : text; any += 1; } });
  return any === l.cells.length ? c : null;
}

// ---------- controls: a recipe states what must tie, the gate reads the results ----------
function checkControls(R) {
  const vals = (o) => ({ ...R.values, ...(o ? o.payload : {}) });
  for (const c of R.r.controls || []) {
    if (c.law === "balance_chain") {
      const order = (R.r.table && R.r.table.order) || "oldest_first";
      let lines = R.out.filter((o) => o.kind === "txn_line");
      if (order === "newest_first") lines = lines.slice().reverse();
      let bad = 0, checked = 0;
      for (let i = 1; i < lines.length; i++) { const p = lines[i - 1].payload, q = lines[i].payload; if (p.balance_after_cents == null || q.balance_after_cents == null) continue; checked += 1; if (p.balance_after_cents + q.amount_cents !== q.balance_after_cents) bad += 1; }
      R.controls.push({ law: c.law, pass: bad === 0, checked, bad, proves: ["sign", "date_order"] });
    } else if (c.law === "equation") {
      let bad = 0, checked = 0, gap = 0;
      const objs = c.kind ? R.out.filter((o) => o.kind === c.kind) : [null];
      for (const o of objs) {
        const v = vals(o); let t = 0, ok = true;
        for (const term of c.terms) { const neg = term[0] === "-", n = term.replace(/^[+-]/, ""); const val = /^\d+$/.test(n) ? Number(n) : v[n]; if (val == null) { if (c.optional && c.optional.includes(n)) continue; ok = false; continue; } t += neg ? -val : val; }
        if (!ok) { bad += 1; continue; }
        checked += 1; if (Math.abs(t) > (c.tolerance || 0)) { bad += 1; gap = t; }
      }
      R.controls.push({ law: c.law, name: c.name, pass: bad === 0, checked, bad, gap, proves: c.proves || ["sign"] });
    } else if (c.law === "table_sum") {
      const rows = R.tables[c.table] || []; const t = rows.reduce((s, r) => s + (r[c.field] || 0), 0);
      const want = c.equals_sum ? c.equals_sum.reduce((s, n) => s + (R.values[n] || 0), 0) : R.values[c.equals];
      R.controls.push({ law: c.law, name: `${c.table}.${c.field}`, pass: want != null && t === want, checked: rows.length, got: t, want, proves: ["rows"] });
    } else if (c.law === "kind_sum") {
      const objs = R.out.filter((o) => o.kind === c.kind); const t = objs.reduce((s, o) => s + (o.payload[c.field] || 0), 0);
      const want = c.equals_sum ? c.equals_sum.reduce((s, n) => { const neg = n[0] === "-", k = n.replace(/^[+-]/, ""); return s + (neg ? -1 : 1) * (R.values[k] || 0); }, 0) : R.values[c.equals];
      R.controls.push({ law: c.law, name: `${c.kind}.${c.field}`, pass: want != null && t === want, checked: objs.length, got: t, want, proves: ["rows", "sign"] });
    } else if (c.law === "sign_anchor") {
      const objs = R.out.filter((o) => o.kind === (c.kind || "txn_line") && new RegExp(c.regex).test(String(o.payload[c.field || "description"])));
      const bad = objs.filter((o) => (c.sign === "+" ? o.payload[c.amount || "amount_cents"] <= 0 : o.payload[c.amount || "amount_cents"] >= 0)).length;
      R.controls.push({ law: c.law, pass: bad === 0, checked: objs.length, bad, proves: objs.length ? ["sign"] : [] });
    } else if (c.law === "family_chain" || c.law === "ytd_chain") { R.controls.push({ law: c.law, family: true, pass: true, checked: 0 }); }
    else R.faults.push({ code: "bad_recipe", what: `no control ${c.law}`, locator: "file" });
  }
}

/* run(recipe, decoded, { vocab, stream, shuffle }) gives { observations, consumed, skipped, unconsumed, faults, controls, dates } */
function run(recipe, decoded, opts) {
  const R = new Run(recipe, decoded, opts);
  try {
    if (recipe.tier === "table") runTable(R); else runDocument(R);
    checkControls(R);
  } catch (e) { R.faults.push({ code: "recipe_error", what: String(e && e.message), locator: R.locator }); }
  return { observations: R.out, consumed: R.consumed, skipped: R.skipped, unconsumed: R.unconsumed, faults: R.faults, controls: R.controls, dates: R.dates };
}

const matches = (recipe, decoded) => {
  const m = recipe.match; if (!m || !m.length) return true;
  const hay = decoded.lines ? decoded.lines.map((l) => l.text) : (decoded.rows || []).slice(0, 6).map((r) => r.join(" "));
  if (decoded.meta && decoded.meta.subject) hay.push(decoded.meta.subject);
  if (decoded.meta && decoded.meta.title) hay.push(decoded.meta.title);
  return m.every((p) => { const re = new RegExp(p); return hay.some((t) => re.test(t)); });
};

module.exports = { run, matches, parseDate, parseCents, parseUnits, AMBIGUOUS };
