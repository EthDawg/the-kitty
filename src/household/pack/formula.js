/* The formulas this folder writes, evaluated here so a workbook carries its answers for viewers that never recalculate (a mail preview, a phone).
   A cached value is a convenience: the tests strip every one of them and let an independent spreadsheet engine work the sheet out alone. */
(function (root, name, deps, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(...deps.map((d) => require(`./${d}.js`)));
  else { const K = (root.KittyPack = root.KittyPack || {}); K[name] = factory(...deps.map((d) => K[d])); }
})(typeof self !== "undefined" ? self : this, "formula", [], function () {
  "use strict";
  const colIndex = (c) => { let n = 0; for (const ch of c) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  const colName = (i) => { let s = ""; for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };

  function tokens(src) {
    const out = []; let i = 0;
    const ref = /^(?:(?:'((?:[^']|'')+)'|([A-Za-z_][A-Za-z0-9_]*))!)?\$?([A-Z]{1,3})\$?([0-9]+)(?::\$?([A-Z]{1,3})\$?([0-9]+))?/;
    while (i < src.length) {
      const c = src[i], rest = src.slice(i);
      if (/\s/.test(c)) { i++; continue; }
      if (c === '"') { let j = i + 1, s = ""; for (;;) { if (src[j] === '"' && src[j + 1] === '"') { s += '"'; j += 2; } else if (src[j] === '"') break; else s += src[j++]; } out.push({ t: "str", v: s }); i = j + 1; continue; }
      const m = ref.exec(rest);
      if (m && !/^[A-Z]+\(/.test(rest)) { out.push({ t: "ref", sheet: m[1] ? m[1].replace(/''/g, "'") : m[2] || null, c1: m[3], r1: +m[4], c2: m[5] || null, r2: m[6] ? +m[6] : null }); i += m[0].length; continue; }
      const n = /^[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?/.exec(rest);
      if (n) { out.push({ t: "num", v: parseFloat(n[0]) }); i += n[0].length; continue; }
      const f = /^([A-Z][A-Z0-9.]*)\(/.exec(rest);
      if (f) { out.push({ t: "fn", v: f[1] }); i += f[1].length + 1; continue; }
      const b = /^(TRUE|FALSE)\b/.exec(rest);
      if (b) { out.push({ t: "bool", v: b[1] === "TRUE" }); i += b[1].length; continue; }
      const op = /^(<=|>=|<>|[-+*/^&=<>(),])/.exec(rest);
      if (op) { out.push({ t: "op", v: op[1] }); i += op[1].length; continue; }
      throw new Error(`Formula: cannot read ${rest.slice(0, 20)} in ${src}`);
    }
    return out;
  }

  const isNum = (v) => typeof v === "number";
  const num = (v) => { if (v === null || v === undefined || v === "") return 0; if (isNum(v)) return v; if (typeof v === "boolean") return v ? 1 : 0; throw new Error(`#VALUE: ${v}`); };
  const flat = (args) => args.flatMap((a) => (Array.isArray(a) ? a : [a]));
  const fix = (x) => Number(x.toPrecision(14));   // what a spreadsheet does to binary noise before it rounds
  const round = (x, d) => { const m = 10 ** d, v = fix(Math.abs(x) * m), r = Math.round(v) / m; return r === 0 ? 0 : Math.sign(x) * r; };
  const rounddown = (x, d) => { const m = 10 ** d, v = fix(Math.abs(x) * m), r = Math.floor(v) / m; return r === 0 ? 0 : Math.sign(x) * r; };
  const FN = {
    SUM: (a) => flat(a).filter(isNum).reduce((s, v) => s + v, 0),
    MIN: (a) => Math.min(...flat(a).filter(isNum)), MAX: (a) => Math.max(...flat(a).filter(isNum)),
    ABS: (a) => Math.abs(num(a[0])), ROUND: (a) => round(num(a[0]), num(a[1])), ROUNDDOWN: (a) => rounddown(num(a[0]), num(a[1])),
    COUNT: (a) => flat(a).filter(isNum).length, ISNUMBER: (a) => isNum(a[0]),
    SUMIFS: (a) => { const [vals, ...rest] = a; let s = 0; vals.forEach((v, i) => { let ok = isNum(v); for (let k = 0; k < rest.length; k += 2) if (!test(rest[k][i], rest[k + 1])) ok = false; if (ok) s += v; }); return s; },
    COUNTIF: (a) => { const c = String(a[1]).toLowerCase(); return flat([a[0]]).filter((v) => String(v ?? "").toLowerCase() === c).length; },
    AND: (a) => flat(a).every(Boolean), OR: (a) => flat(a).some(Boolean),
    LOOKUP: (a) => { const [k, keys, vals] = a; let hit = null; keys.forEach((v, i) => { if (isNum(v) && v <= k) hit = vals[i]; }); if (hit === null) throw new Error("#N/A"); return hit; },
  };
  const LAZY_IF = "IF";
  function test(v, c) { const m = /^(>=|<=|<>|>|<|=)?(.*)$/.exec(String(c)), o = m[1] || "=", t = m[2]; if (t !== "" && !Number.isNaN(Number(t)) && o !== "=") { const n = Number(t); if (!isNum(v)) return false; return o === ">" ? v > n : o === "<" ? v < n : o === ">=" ? v >= n : o === "<=" ? v <= n : v !== n; } const eq = String(v ?? "").toLowerCase() === t.toLowerCase(); return o === "<>" ? !eq : eq; }

  function evaluator(cellAt) {
    const cache = new Map();
    function cell(sheet, c, r) {
      const k = `${sheet}!${c}${r}`;
      if (cache.has(k)) { const v = cache.get(k); if (v === cache) throw new Error(`Cycle at ${k}`); return v; }
      const raw = cellAt(sheet, c, r);
      if (!raw || raw.f === undefined) { const v = raw ? raw.v ?? null : null; cache.set(k, v); return v; }
      cache.set(k, cache);
      const v = run(raw.f, sheet);
      cache.set(k, v);
      return v;
    }
    function run(f, sheet) {
      const ts = tokens(f); let p = 0;
      const peek = () => ts[p], next = () => ts[p++];
      const isOp = (...v) => peek() && peek().t === "op" && v.includes(peek().v);
      function cmp() {
        let l = cat();
        while (isOp("=", "<>", "<", ">", "<=", ">=")) {
          const o = next().v, r = cat();
          const a = typeof l === "string" ? l.toLowerCase() : l, b = typeof r === "string" ? r.toLowerCase() : r;
          l = o === "=" ? a === b : o === "<>" ? a !== b : o === "<" ? a < b : o === ">" ? a > b : o === "<=" ? a <= b : a >= b;
        }
        return l;
      }
      function cat() { let l = add(); while (isOp("&")) { next(); const r = add(); l = `${l ?? ""}${r ?? ""}`; } return l; }
      function add() { let l = mul(); while (isOp("+", "-")) { const o = next().v, r = mul(); l = o === "+" ? num(l) + num(r) : num(l) - num(r); } return l; }
      function mul() { let l = pow(); while (isOp("*", "/")) { const o = next().v, r = pow(); l = o === "*" ? num(l) * num(r) : num(l) / num(r); } return l; }
      function pow() { let l = un(); while (isOp("^")) { next(); l = num(l) ** num(un()); } return l; }
      function un() { if (isOp("-")) { next(); return -num(un()); } if (isOp("+")) { next(); return num(un()); } return atom(); }
      function skipArg() { let depth = 0; for (;;) { const t = peek(); if (!t) return; if (t.t === "fn" || (t.t === "op" && t.v === "(")) depth++; if (t.t === "op" && t.v === ")") { if (!depth) return; depth--; } if (t.t === "op" && t.v === "," && !depth) return; next(); } }
      function atom() {
        const t = next();
        if (!t) throw new Error(`Formula ended early: ${f}`);
        if (t.t === "num" || t.t === "str" || t.t === "bool") return t.v;
        if (t.t === "op" && t.v === "(") { const v = cmp(); next(); return v; }
        if (t.t === "ref") {
          const s = t.sheet || sheet;
          if (!t.c2) return cell(s, t.c1, t.r1);
          const out = [];
          for (let r = t.r1; r <= t.r2; r++) for (let c = colIndex(t.c1); c <= colIndex(t.c2); c++) out.push(cell(s, colName(c), r));
          return out;
        }
        if (t.t === "fn") {
          if (t.v === LAZY_IF) {
            const test = cmp(); next();
            let v = false;
            if (test) { v = cmp(); if (isOp(",")) { next(); skipArg(); } }
            else { skipArg(); if (isOp(",")) { next(); v = cmp(); } }
            next();
            return v;
          }
          const args = [];
          if (!isOp(")")) { args.push(cmp()); while (isOp(",")) { next(); args.push(cmp()); } }
          next();
          if (!FN[t.v]) throw new Error(`Formula: ${t.v} is not supported`);
          return FN[t.v](args);
        }
        throw new Error(`Formula: unexpected ${JSON.stringify(t)} in ${f}`);
      }
      return cmp();
    }
    return { cell };
  }

  return { evaluator, tokens, colIndex, colName };
});
