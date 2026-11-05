/* The Kitty period core: text. The small parts of Python's behaviour the importer's output depends on: whitespace, case folding,
   title case, repr, float parsing, round-half-even to cents, :,.2f rendering, the csv module's reader and ISO dates. Everything that
   is money is an integer count of cents from here on. Pure functions; runs in the page, in WKWebView and in node. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.KittyPeriodText = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const T = {};

  // str.isspace and regex \s in Python. JS \s also takes U+FEFF and misses U+001C-1F and U+0085.
  const WS = "\\t\\n\\x0b\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
  const WORD = "\\p{L}\\p{N}_"; // regex \w in Python
  const isSpace = (n) => n === 32 || (n >= 9 && n <= 13) || (n >= 0x1c && n <= 0x1f) || n === 0x85 || n === 0xa0 || n === 0x1680 || (n >= 0x2000 && n <= 0x200a) || n === 0x2028 || n === 0x2029 || n === 0x202f || n === 0x205f || n === 0x3000;
  const RUNS = new RegExp(`[${WS}]+`, "g");
  T.WS = WS; T.WORD = WORD;
  // By scanning, not a regex: an anchored [ws]+$ is quadratic on a long run of spaces inside a cell.
  T.rstrip = (v) => { const s = String(v); let b = s.length; while (b > 0 && isSpace(s.charCodeAt(b - 1))) b--; return s.slice(0, b); };
  T.strip = (v) => { const s = T.rstrip(v); let a = 0; while (a < s.length && isSpace(s.charCodeAt(a))) a++; return s.slice(a); };
  // str.strip('()')
  T.stripParens = (s) => { let a = 0, b = s.length; const paren = (c) => c === "(" || c === ")"; while (a < b && paren(s[a])) a++; while (b > a && paren(s[b - 1])) b--; return s.slice(a, b); };
  T.split = (s) => T.strip(s).split(RUNS).filter((x) => x !== "");

  const NOT_WORD_BEFORE = `(?<![${WORD}])`, NOT_WORD_AFTER = `(?![${WORD}])`;
  const MONTHS = new RegExp(`${NOT_WORD_BEFORE}(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)${NOT_WORD_AFTER}`, "gu");
  const NOISE = new RegExp(`${NOT_WORD_BEFORE}REFUND${NOT_WORD_AFTER}|${NOT_WORD_BEFORE}PREMIUM ADJ${NOT_WORD_AFTER}|\\*[${WS}]*[${WORD}]+(?=\\n?$)|\\p{Nd}{3,}`, "gu");
  const text = (v) => (v === null || v === undefined || v === "" || v === 0 || v === false ? "" : String(v));
  // The loose key for categorising: month names, card numbers and REFUND stripped.
  T.normalise = (desc) => T.strip(text(desc).toUpperCase().replace(MONTHS, "").replace(NOISE, "").replace(RUNS, " "));
  // The identity key for de-duplication: the description as delivered, case and spacing folded.
  T.ident = (desc) => T.split(text(desc).toUpperCase()).join(" ");

  // str.title: a cased character after an uncased one takes title case, the rest lower case.
  T.title = (s) => {
    let out = "", prev = false;
    for (const c of String(s)) {
      if (prev) out += c.toLowerCase();
      else { const u = Array.from(c.toUpperCase()); out += u[0] + u.slice(1).join("").toLowerCase(); }
      prev = /\p{Cased}/u.test(c);
    }
    return out;
  };

  // ---------- repr ----------
  const NOT_PRINTABLE = /[\p{C}\p{Zl}\p{Zp}\p{Zs}]/u;
  const strRepr = (s) => {
    const q = s.includes("'") && !s.includes('"') ? '"' : "'";
    let out = q;
    for (const c of s) {
      const n = c.codePointAt(0);
      if (c === "\\" || c === q) out += "\\" + c;
      else if (c === "\n") out += "\\n";
      else if (c === "\r") out += "\\r";
      else if (c === "\t") out += "\\t";
      else if (c === " " || !NOT_PRINTABLE.test(c)) out += c;
      else if (n <= 0xff) out += "\\x" + n.toString(16).padStart(2, "0");
      else if (n <= 0xffff) out += "\\u" + n.toString(16).padStart(4, "0");
      else out += "\\U" + n.toString(16).padStart(8, "0");
    }
    return out + q;
  };
  T.floatRepr = (x) => { const s = String(x); return /^-?\d+$/.test(s) ? s + ".0" : s; };
  T.repr = (v) => {
    if (v === null || v === undefined) return "None";
    if (v === true) return "True";
    if (v === false) return "False";
    if (typeof v === "string") return strRepr(v);
    if (Array.isArray(v)) return `[${v.map(T.repr).join(", ")}]`;
    return String(v);
  };
  T.str = (v) => (v === null || v === undefined ? "None" : v === true ? "True" : v === false ? "False" : String(v));

  // ---------- numbers ----------
  const FLOAT = /^[+-]?(?:\d+(?:_\d+)*(?:\.(?:\d+(?:_\d+)*)?)?|\.\d+(?:_\d+)*)(?:[eE][+-]?\d+(?:_\d+)*)?$/; // one way to read any digit run
  const NAMED = /^([+-]?)(inf(?:inity)?|nan)$/i;
  // float(str): the double, or null where Python raises ValueError. NaN and infinities come back as such; callers refuse them.
  T.pyFloat = (raw) => {
    const s = T.strip(raw);
    if (FLOAT.test(s)) return Number(s.replace(/_/g, ""));
    const m = NAMED.exec(s);
    if (!m) return null;
    return m[2].toLowerCase() === "nan" ? NaN : m[1] === "-" ? -Infinity : Infinity;
  };
  // fnum in Python: float(x), or 0.0 where float refuses. Sheet cells only; a delivered file goes through money().
  T.sheetFloat = (x) => {
    if (typeof x === "number") return x;
    if (x === true) return 1;
    if (x === false) return 0;
    if (typeof x !== "string") return 0;
    const n = T.pyFloat(x);
    return n === null ? 0 : n;
  };
  // round(x, 2) * 100 as an exact integer: half-even on the double's exact binary value. A double can only tie at an odd eighth.
  T.toCents = (x) => {
    const n = Math.abs(x), eighths = n * 8;
    let c;
    if (eighths === Math.floor(eighths) && eighths % 2 === 1) { const f = Math.floor(n * 100); c = f % 2 === 0 ? f : f + 1; }
    else c = n < 1e21 ? Number(n.toFixed(2).replace(".", "")) : Infinity;
    return x < 0 && c !== 0 ? -c : c;
  };
  T.sheetCents = (x) => { const n = T.sheetFloat(x); return Number.isFinite(n) ? T.toCents(n) : 0; };
  T.amount = (c) => c / 100; // the same double round(x, 2) gives
  const grouped = (s) => s.replace(/\B(?=(\d{3})+$)/g, ",");
  const parts = (c) => { const a = Math.abs(c); return [String(Math.floor(a / 100)), String(a % 100).padStart(2, "0")]; };
  T.fmt2 = (c) => { const [w, d] = parts(c); return `${c < 0 ? "-" : ""}${grouped(w)}.${d}`; };        // :,.2f
  T.plus2 = (c) => { const [w, d] = parts(c); return `${c < 0 ? "-" : "+"}${w}.${d}`; };                // :+.2f
  T.plusGrouped2 = (c) => { const [w, d] = parts(c); return `${c < 0 ? "-" : "+"}${grouped(w)}.${d}`; }; // :+,.2f

  // ---------- dates ----------
  const daysIn = (y, m) => [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  T.daysIn = daysIn;
  T.validDate = (y, m, d) => y >= 1 && y <= 9999 && m >= 1 && m <= 12 && d >= 1 && d <= daysIn(y, m);
  T.iso = (y, m, d) => `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  T.isIsoDate = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s)); return !!m && T.validDate(+m[1], +m[2], +m[3]); };
  // days since 1970-01-01 in the proleptic Gregorian calendar
  T.dayNumber = (iso) => {
    let y = +iso.slice(0, 4); const m = +iso.slice(5, 7), d = +iso.slice(8, 10);
    y -= m <= 2 ? 1 : 0;
    const era = Math.floor(y / 400), yoe = y - era * 400, doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
    return era * 146097 + yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy - 719468;
  };
  T.fromDayNumber = (z0) => {
    const z = z0 + 719468, era = Math.floor(z / 146097), doe = z - era * 146097;
    const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
    const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100)), mp = Math.floor((5 * doy + 2) / 153);
    const m = mp + (mp < 10 ? 3 : -9);
    return T.iso(yoe + era * 400 + (m <= 2 ? 1 : 0), m, doy - Math.floor((153 * mp + 2) / 5) + 1);
  };
  T.addDays = (iso, n) => T.fromDayNumber(T.dayNumber(iso) + n);
  T.daysApart = (a, b) => Math.abs(T.dayNumber(a) - T.dayNumber(b));
  T.monthEnd = (m) => `${m}-${String(daysIn(+m.slice(0, 4), +m.slice(5, 7))).padStart(2, "0")}`;

  // ---------- the csv module's reader, default dialect ----------
  const FIELD_LIMIT = 131072;
  class CsvError extends Error {}
  T.CsvError = CsvError;
  const LINES = /[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g;
  // One state per case of _csv.c. A line ends at \n, \r or \r\n and only ends a record outside quotes. A bare quote mid-field is a character.
  T.readCsv = (source) => {
    const START_RECORD = 0, START_FIELD = 1, IN_FIELD = 2, IN_QUOTED = 3, QUOTE_IN_QUOTED = 4, EAT_CRNL = 5;
    if (source.includes("\0")) throw new CsvError("line contains NUL");
    const rows = [];
    let fields = [], field = "", state = START_RECORD;
    const save = () => { fields.push(field); field = ""; };
    const add = (c) => { field += c; if (field.length > FIELD_LIMIT) throw new CsvError(`field larger than field limit (${FIELD_LIMIT})`); };
    const endOfLine = (c) => { save(); state = c === "" ? START_RECORD : EAT_CRNL; };
    const step = (c) => { // c === "" is the end-of-line marker
      const nl = c === "\n" || c === "\r";
      switch (state) {
        case START_RECORD:
          if (c === "") return;
          if (nl) { state = EAT_CRNL; return; }
          state = START_FIELD;
        // fallthrough
        case START_FIELD:
          if (nl || c === "") endOfLine(c);
          else if (c === '"') state = IN_QUOTED;
          else if (c === ",") save();
          else { add(c); state = IN_FIELD; }
          return;
        case IN_FIELD:
          if (nl || c === "") endOfLine(c);
          else if (c === ",") { save(); state = START_FIELD; }
          else add(c);
          return;
        case IN_QUOTED:
          if (c === "") return;
          if (c === '"') state = QUOTE_IN_QUOTED;
          else add(c);
          return;
        case QUOTE_IN_QUOTED:
          if (c === '"') { add(c); state = IN_QUOTED; }
          else if (c === ",") { save(); state = START_FIELD; }
          else if (nl || c === "") endOfLine(c);
          else { add(c); state = IN_FIELD; }
          return;
        default: // EAT_CRNL
          if (c === "") state = START_RECORD;
      }
    };
    for (const line of source.match(LINES) || []) {
      for (let i = 0; i < line.length; i++) step(line[i]);
      step("");
      if (state === START_RECORD) { rows.push(fields); fields = []; field = ""; }
    }
    if (field.length || state === IN_QUOTED) { save(); rows.push(fields); }
    return rows;
  };
  // csv.DictReader: the first row names the columns, blank rows are skipped, a short row's missing cells are null.
  T.dictRows = (source) => {
    const rows = T.readCsv(source), head = rows[0] || [];
    const out = [];
    for (const r of rows.slice(1)) {
      if (!r.length) continue;
      const d = {};
      head.forEach((h, i) => { d[h] = i < r.length ? r[i] : null; });
      out.push(d);
    }
    return { head, rows: out };
  };
  return T;
});
