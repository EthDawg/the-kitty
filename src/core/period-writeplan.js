/* The Kitty period core: the write plan. Exact ranges and values for update_values, and the comparisons a re-read goes through. Same
   schema and same answers as period-close/writeplan.py and verify.py. Nothing here talks to a sheet. Runs in the page, in WKWebView
   and in node. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./period-text.js"));
  else root.KittyPeriodWritePlan = factory(root.KittyPeriodText);
})(typeof self !== "undefined" ? self : this, function (T) {
  "use strict";
  const W = {};
  W.SCHEMA = "kitty-write-plan/1";
  W.CHUNK = 500;
  const SERIAL_ZERO = T.dayNumber("1899-12-30");

  W.col = (n) => { let s = ""; while (n) { const r = (n - 1) % 26; n = Math.floor((n - 1) / 26); s = String.fromCharCode(65 + r) + s; } return s; };
  W.colIndex = (letters) => { let n = 0; for (const ch of letters.toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64; return n; };
  const quoteTab = (tab) => (/[^A-Za-z0-9_]/.test(tab) ? `'${tab}'` : tab);
  W.a1 = (tab, r1, c1, r2, c2) => `${quoteTab(tab)}!${W.col(c1)}${r1}${r2 !== undefined && r2 !== null ? `:${W.col(c2)}${r2}` : ""}`;
  W.parseRange = (rng) => {
    const m = /^(?:'([^']+)'|([^!]+))!([A-Za-z]+)(\d+)(?::([A-Za-z]+)(\d+))?$/.exec(T.strip(rng));
    if (!m) throw new Error(`not an A1 range: ${rng}`);
    const [r1, c1] = [Number(m[4]), W.colIndex(m[3])];
    return { tab: m[1] || m[2], r1, c1, r2: m[5] ? Number(m[6]) : r1, c2: m[5] ? W.colIndex(m[5]) : c1 };
  };
  W.rangeKey = (rng) => { const { tab, r1, c1, r2, c2 } = W.parseRange(rng); return `${tab}!${W.col(c1)}${r1}:${W.col(c2)}${r2}`; };

  // Text that would be read as a formula or a number sign gets an apostrophe, and so does text that already starts with one: USER_ENTERED
  // consumes exactly one, so what lands is the source's own text and a re-import finds it. Without this, '=X and =X land as the same cell.
  W.escape = (v) => (typeof v === "string" && /^[=+\-@']/.test(v) ? "'" + v : v);
  W.plain = (v) => (typeof v === "string" && v.length > 1 && v[0] === "'" && "=+-@'".includes(v[1]) ? v.slice(1) : v);

  W.appendWrites = (prefix, tab, columns, rows, firstRow, note) => {
    const out = [];
    for (let i = 0; i < rows.length; i += W.CHUNK) {
      const part = rows.slice(i, i + W.CHUNK), r1 = firstRow + i, r2 = r1 + part.length - 1;
      const w = { id: `${prefix}-${out.length + 1}`, tab, op: "append", range: W.a1(tab, r1, 1, r2, columns.length), rows: part.length, columns, values: part.map((r) => r.map(W.escape)) };
      if (note) w.note = note;
      out.push(w);
    }
    return out;
  };
  // Change cells on one existing row: values from firstCol (1-based); null leaves a cell alone.
  W.updateWrite = (id, tab, row, firstCol, values, precondition, note) => {
    const w = { id, tab, op: "update", range: W.a1(tab, row, firstCol, row, firstCol + values.length - 1), rows: 1, values: [values.map(W.escape)] };
    if (precondition) w.precondition = precondition;
    if (note) w.note = note;
    return w;
  };
  // The last row we know of must still hold its value, and the row after it must be blank.
  W.precondition = (tab, lastRow, lastValue) => {
    if (lastRow === null || lastRow < 2) return { range: W.a1(tab, 2, 1), expect: [], why: `${tab} should hold no data rows yet` };
    return { range: W.a1(tab, lastRow, 1, lastRow + 1, 1), expect: [[lastValue], []],
      why: `the last ${tab} row we planned from, then the first empty row; a different value means the sheet moved since the snapshot: re-run the importer` };
  };

  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dateForms = (s) => {
    if (!T.isIsoDate(s)) return new Set();
    const [y, m, d] = [Number(s.slice(0, 4)), Number(s.slice(5, 7)), Number(s.slice(8, 10))];
    const p = (n) => String(n).padStart(2, "0");
    return new Set([s, String(T.dayNumber(s) - SERIAL_ZERO), `${d}/${m}/${y}`, `${p(d)}/${p(m)}/${y}`, `${m}/${d}/${y}`, `${p(m)}/${p(d)}/${y}`, `${p(d)} ${MON[m - 1]} ${y}`, `${d} ${MON[m - 1]} ${y}`]);
  };
  const isNum = (v) => typeof v === "number";
  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  const num = (v) => T.pyFloat(String(v).replace(/,/g, ""));
  // Does a cell read back as planned? Blanks match "" and missing; numbers within tolerance; a planned date in any form a read returns.
  W.same = (planned, actual, tolerance = 0.005) => {
    const p = W.plain(planned);
    if (p === null || p === undefined) return true;
    const a = actual === null || actual === undefined ? "" : actual;
    if (p === "") return a === "" || (typeof a === "string" && T.strip(a) === "");
    if (typeof p === "boolean" || typeof a === "boolean") return T.str(p).toUpperCase() === T.str(a).toUpperCase();
    if (isNum(p)) { const n = num(a); return n !== null && Math.abs(p - n) <= tolerance; }
    const ps = T.strip(p);
    if (isNum(a)) {
      if (ISO.test(ps)) return Number.isInteger(a) && dateForms(ps).has(String(a));
      const n = num(ps);
      return n !== null && Math.abs(n - a) <= tolerance;
    }
    const as = T.strip(String(a));
    if (ps === as) return true;
    return ISO.test(ps) && dateForms(ps).has(as);
  };
  const filled = (x) => T.strip(T.str(x)) !== "";
  // First mismatch as {i, j, planned, actual}, or null. Trailing cells and rows the API trimmed count as blanks.
  W.compare = (plannedValues, actualValues, tolerance) => {
    for (let i = 0; i < plannedValues.length; i++) {
      const prow = plannedValues[i], arow = i < actualValues.length ? actualValues[i] : [];
      for (let j = 0; j < prow.length; j++) {
        const av = j < arow.length ? arow[j] : "";
        if (!W.same(prow[j], av, tolerance)) return { i, j, planned: prow[j], actual: av };
      }
      if (arow.length > prow.length && arow.slice(prow.length).some(filled)) return { i, j: prow.length, planned: "", actual: arow[prow.length] };
    }
    for (let i = plannedValues.length; i < actualValues.length; i++) {
      if (actualValues[i].some(filled)) return { i, j: 0, planned: "", actual: actualValues[i][0] };
    }
    return null;
  };

  const loadReread = (doc) => {
    const out = new Map();
    if (doc && !Array.isArray(doc) && typeof doc === "object" && "range" in doc && "values" in doc) doc = [doc];
    if (Array.isArray(doc)) {
      for (const item of doc) {
        if (!item || typeof item !== "object" || !("range" in item)) throw new Error('each re-read item needs "range" and "values" (what get_values returns)');
        out.set(W.rangeKey(item.range), item.values || []);
      }
    } else if (doc && typeof doc === "object") for (const [k, v] of Object.entries(doc)) out.set(W.rangeKey(k), v || []);
    else throw new Error("not a re-read (a get_values response, a list of them, or a map of range to values)");
    return out;
  };

  const plural = (n) => (n !== 1 ? "s" : "");
  // verify.py as a function. The planned side is money, so a number prints as a Python float; so does a number read back against it.
  const shown = (v, moneyCell) => (typeof v === "number" && moneyCell ? T.floatRepr(v) : T.repr(v));
  const check = (ranges, reread) => {
    let ok = true;
    const lines = [], mismatches = [];
    for (const [rng, expected, note] of ranges) {
      const suffix = note ? ` (${note})` : "";
      const actual = reread.get(W.rangeKey(rng));
      if (actual === undefined) { lines.push(`MISSING  ${rng}: no re-read saved for this range${suffix}`); mismatches.push({ range: rng, cell: null, planned: null, actual: null }); ok = false; continue; }
      const diff = W.compare(expected, actual);
      if (!diff) { lines.push(`OK       ${rng}: ${expected.length} row${plural(expected.length)} agree${suffix}`); continue; }
      const { r1, c1 } = W.parseRange(rng), cell = `${W.col(c1 + diff.j)}${r1 + diff.i}`, p = W.plain(diff.planned), money = typeof p === "number";
      lines.push(`MISMATCH ${rng} at ${cell}: planned ${shown(p, money)}, sheet has ${shown(diff.actual, money)}${suffix}`);
      mismatches.push({ range: rng, cell, planned: p, actual: diff.actual });
      ok = false;
    }
    return { ok, lines, mismatches };
  };

  W.verify = (plan, rereadDoc, opts) => {
    const o = opts || {};
    if (plan.schema !== W.SCHEMA) throw new Error(`plan schema ${T.repr(plan.schema)}, this verifier reads ${W.SCHEMA}`);
    const reread = loadReread(rereadDoc);
    const done = (ok, lines, mismatches) => ({ ok, exit: ok ? 0 : 1, lines, mismatches: mismatches || [] });
    if (o.preconditions) {
      const pre = (plan.preconditions || []).map((c) => [c.range, c.expect || [], c.why]);
      if (!pre.length) return done(true, ["no preconditions in the plan"]);
      const r = check(pre, reread);
      return done(r.ok, r.lines.concat(r.ok ? "preconditions hold: write in the order the plan lists" : "preconditions FAIL: the sheet moved since the snapshot; refresh it and re-run the importer"), r.mismatches);
    }
    const writes = (plan.writes || []).concat(o.include_deferred ? plan.deferred || [] : []);
    if (plan.status !== "ready") return done(false, [`plan status is ${T.repr(plan.status)}: nothing should have been written`]);
    if (!writes.length) return done(true, ["the plan has no writes; nothing to verify"]);
    const r = check(writes.map((w) => [w.range, w.values, w.note]), reread);
    const rows = writes.reduce((s, w) => s + w.rows, 0);
    return done(r.ok, r.lines.concat(r.ok ? `VERIFIED ${rows} rows over ${writes.length} ranges` : "NOT VERIFIED: fix the ranges above before closing the month"), r.mismatches);
  };

  W.summary = (plan) => {
    const out = (plan.writes || []).map((w) => `- \`${w.range}\`: ${w.rows} row${plural(w.rows)} (${w.op}, ${w.tab})${w.note ? `, ${w.note}` : ""}`);
    if (!out.length) out.push("- nothing to write");
    if ((plan.deferred || []).length) {
      out.push("", "Deferred (not written until a person or a later phase says so):");
      for (const w of plan.deferred) out.push(`- \`${w.range}\`: ${w.rows} row${plural(w.rows)} (${w.op}, ${w.tab}). ${w.why || ""}`.replace(/\s+$/, ""));
    }
    return out;
  };
  return W;
});
