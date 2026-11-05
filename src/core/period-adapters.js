/* The Kitty period core: adapters. The files a household receives, as normalised rows. Every reader fails loud with the same words as
   period-close/adapters.py and a stable code. A row's amount is integer cents, money in positive. balance stays the printed double,
   so a closing check compares what the file said, not a rounding of it. Runs in the page, in WKWebView and in node. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./period-text.js"));
  else root.KittyPeriodAdapters = factory(root.KittyPeriodText);
})(typeof self !== "undefined" ? self : this, function (T) {
  "use strict";
  const A = {};
  const { repr, strip } = T;

  class ImportFault extends Error {
    // file: path as shown to the person; row: 1-based record in the file (null for the whole file); what: the fault; todo: what to do
    constructor(code, file, what, todo, row) {
      super(`${file}${row ? ` row ${row}` : ""}: ${what}`);
      this.code = code; this.file = file === null || file === undefined ? "None" : String(file); this.row = row || null; this.what = what; this.todo = todo;
    }
    md() { return `- \`${this.file}\`${this.row ? `, row ${this.row}` : ""}: ${this.what}\n  What to do: ${this.todo}`; }
    json() { return { severity: "stop", code: this.code, file: this.file, row: this.row, what: this.what, do: this.todo, md: this.md() }; }
  }
  class Stop extends Error { constructor(faults) { super(`${faults.length} fault(s)`); this.faults = faults; } }
  A.ImportFault = ImportFault; A.Stop = Stop;

  A.INSTITUTION = { "ACC-EVD": "Harbour Bank", "ACC-OFF": "Harbour Bank", "ACC-RNT": "Harbour Bank", "ACC-CC": "Southern Card", "ACC-SAV": "Wattle Credit Union", "ACC-HOL": "Wattle Credit Union" };
  const ORDER_WORDS = { dmy: "day first (dd/mm/yyyy)", mdy: "month first (mm/dd/yyyy)", ymd: "year first (yyyy-mm-dd)" };

  // A delivered date to yyyy-mm-dd, in the order the shape declares. Faults for anything else.
  A.parseDate = (s, order, file, row) => {
    const raw = strip(T.str(s));
    const m = /^(\d{1,4})[/\-.](\d{1,2})[/\-.](\d{1,4})$/.exec(raw);
    if (!m) throw new ImportFault("bad_date", file, `"${raw}" is not a date`, "the column is not what the adapter expects; check the header and the shape", row);
    const [, a, b, c] = m;
    let y, mo, d, readAs;
    if (a.length === 4) { [y, mo, d] = [a, b, c]; readAs = "ymd"; }
    else { readAs = order; if (order === "mdy") [mo, d, y] = [a, b, c]; else [d, mo, y] = [a, b, c]; }
    if (y.length !== 4) throw new ImportFault("two_digit_year", file, `"${raw}" has a two-digit year`, "export with four-digit years, or extend the adapter if the institution never does", row);
    const [yn, mn, dn] = [Number(y), Number(mo), Number(d)];
    if (mn < 1 || mn > 12) throw new ImportFault("bad_month", file, `"${raw}": ${mn} is not a month. This shape is read ${ORDER_WORDS[readAs]}`,
      "if the institution now writes month first, change its DATE_ORDER in adapters.py and say so in data-sources.json; never edit the file", row);
    if (!T.validDate(yn, mn, dn)) throw new ImportFault("no_such_day", file, `"${raw}": no such day`, "the date is corrupt or read in the wrong order; check the shape", row);
    return T.iso(yn, mn, dn);
  };

  // The cell as Python's money() reads it, a double. Unlike Python, NaN and infinity are not amounts (see the parity allowlist).
  A.money = (v, file, row) => {
    const s = strip(T.str(v).replace(/\$/g, "").replace(/,/g, "").replace(/A/g, ""));
    if (!s) return 0;
    const neg = s.startsWith("(") && s.endsWith(")");
    const n = T.pyFloat(s.replace(/^[()]+|[()]+$/g, ""));
    if (n === null || !Number.isFinite(n)) throw new ImportFault("bad_amount", file, `"${v}" is not an amount`, "the column is not what the adapter expects; check the header and the shape", row);
    return neg ? -n : n;
  };
  const cents = (x, cell, file, row) => {
    const c = T.toCents(x);
    if (!Number.isSafeInteger(c)) throw new ImportFault("bad_amount", file, `"${cell}" is not an amount`, "the column is not what the adapter expects; check the header and the shape", row);
    return c;
  };

  const HARBOUR_HEAD = ["Bank Account", "Date", "Narrative", "Debit Amount", "Credit Amount", "Balance", "Categories", "Serial"];
  const SOUTHERN_HEAD = ["Date", "Description", "Card Member", "Account #", "Amount"];
  const WATTLE_HEAD = ["Date", "Description", "Credit", "Debit", "Balance"];
  const OWNER_HEAD = ["Date", "Description", "Rental schedule line", "Money in", "Money out", "Handled by"];
  const PAYSLIP_HEAD = ["Pay date", "Person", "Employer", "Gross pay", "Tax withheld", "Super (employer)", "Net pay"];
  const BARK_DATE = /^\d{1,2}\/\d{1,2}\/\d{4}$/;
  // shape name: header (null when headerless), date order, the sequence rows come in, whether it prints a running balance. Order matters to sniffing.
  A.SHAPES = {
    "Harbour Bank": { head: HARBOUR_HEAD, order: "dmy", sequence: "oldest-first", balance: true },
    "Southern Card": { head: SOUTHERN_HEAD, order: "dmy", sequence: "oldest-first", balance: false },
    "Wattle Credit Union": { head: WATTLE_HEAD, order: "dmy", sequence: "oldest-first", balance: true },
    "Bark Bank": { head: null, order: "dmy", sequence: "newest-first", balance: true },
    "Owner statement": { head: OWNER_HEAD, order: "dmy", sequence: "oldest-first", balance: false },
    "Payslips": { head: PAYSLIP_HEAD, order: "ymd", sequence: "oldest-first", balance: false },
  };
  A.BANK_SHAPES = ["Harbour Bank", "Southern Card", "Wattle Credit Union", "Bark Bank"];

  const ASCII_SPACE = new Set([9, 10, 11, 12, 13, 32]);
  // The file's cells once, and whether it carried a byte order mark. Faults: nothing in it, not UTF-8, a table the csv reader refuses.
  A.loadCells = (file, rel) => {
    if (file._cells) return file._cells;
    const empty = () => new ImportFault("empty_file", rel, "empty file (zero bytes)",
      "download it again. A dormant account still exports its header row; the CommBank shape has none, so if this account truly had no movement, delete the file and say so in the close note");
    let text, bom = !!file.bom;
    if (file.rows) {
      Object.defineProperty(file, "_cells", { value: { rows: file.rows, bom }, enumerable: false, configurable: true });
      return file._cells;
    }
    if (file.bytes) {
      const b = file.bytes;
      if (b.every((x) => ASCII_SPACE.has(x))) throw empty();
      bom = b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf;
      try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(b); }
      catch (e) { throw new ImportFault("not_utf8", rel, "not UTF-8 text", "this is a binary or UTF-16 file; export as CSV (UTF-8), do not convert it by hand"); }
    } else {
      text = String(file.text === null || file.text === undefined ? "" : file.text);
      if (!/[^\t\n\x0b\f\r ]/.test(text)) throw empty();
      bom = bom || text.startsWith("﻿");
    }
    if (text.startsWith("﻿")) text = text.slice(1);
    let rows;
    try { rows = T.readCsv(text); }
    catch (e) {
      if (!(e instanceof T.CsvError)) throw e;
      throw new ImportFault("csv_unreadable", rel, `not a readable table: ${e.message}`, "the download is corrupt or truncated; download it again, never edit the file");
    }
    Object.defineProperty(file, "_cells", { value: { rows, bom }, enumerable: false, configurable: true });
    return file._cells;
  };

  // The shape name from the first line. Faults when no shape matches.
  A.sniff = (rows, path) => {
    const head = rows.length ? rows[0].map(strip) : [];
    const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
    for (const [name, shape] of Object.entries(A.SHAPES)) if (shape.head && same(head, shape.head)) return name;
    if (head.length === 4 && BARK_DATE.test(head[0])) return "Bark Bank";
    const have = new Set(head);
    const near = Object.entries(A.SHAPES).filter(([, s]) => s.head && new Set(s.head.filter((h) => have.has(h))).size >= Math.max(2, Math.floor(s.head.length / 2)));
    if (near.length) {
      const [name, { head: expected }] = near[0];
      const missing = expected.filter((h) => !head.includes(h)), extra = head.filter((h) => !expected.includes(h));
      throw new ImportFault("header_mismatch", path, `header mismatch: looks like ${name} but ${missing.length ? "misses " + repr(missing) : ""}${missing.length && extra.length ? " and " : ""}${extra.length ? "adds " + repr(extra) : ""}; got ${repr(head)}`,
        `the institution changed its export. Update the ${name} shape in adapters.py (and data-sources.json) in the same change as this import; never edit the file`);
    }
    throw new ImportFault("unknown_shape", path, `unrecognised shape, first line ${repr(head.slice(0, 8))}`, "no adapter reads this file. Add one to adapters.py or export in a format the importer knows (see data-sources.json)");
  };

  const columns = (r, n, path, line, todo) => { if (r.length !== n) throw new ImportFault("bad_columns", path, `${r.length} columns, expected ${n}`, todo, line); };
  const TRUNCATED = "a truncated or hand-edited download; download again";

  // Every row of a delivered file: date, description, amount (cents), balance (printed double or null), line. Checks the header, the
  // date order, the sequence and the window. opening date: a file ending by it, before the months imported, is history, not a fault.
  A.readRows = (rows, path, shape, w) => {
    const { head: expected, order, sequence } = A.SHAPES[shape];
    let body = rows, firstLine = 1;
    if (expected) {
      const head = rows.length ? rows[0].map(strip) : [];
      if (head.length !== expected.length || head.some((h, i) => h !== expected[i])) throw new ImportFault("header_mismatch", path, `header mismatch for ${shape}: got ${repr(head)}, expected ${repr(expected)}`,
        "the institution changed its export, or this file is another shape; update the adapter in the same change as the import, never the file");
      body = rows.slice(1); firstLine = 2;
    }
    const out = [];
    const money = (cell, line) => A.money(cell, path, line);
    body.forEach((r, i) => {
      const line = firstLine + i;
      if (!r.length || !r.some((c) => strip(c))) return;
      if (shape === "Harbour Bank") {
        columns(r, 8, path, line, "a comma inside an unquoted narrative, or a truncated download; download again");
        const date = A.parseDate(r[1], order, path, line);
        const amount = cents(money(r[4], line) - money(r[3], line), r[4] || r[3], path, line);
        out.push({ date, description: strip(r[2]), amount, balance: money(r[5], line), line, account_number: strip(r[0]) });
      } else if (shape === "Southern Card") {
        columns(r, 5, path, line, TRUNCATED);
        const date = A.parseDate(r[0], order, path, line);
        out.push({ date, description: strip(r[1]), amount: cents(-money(r[4], line), r[4], path, line), balance: null, line });
      } else if (shape === "Wattle Credit Union") {
        columns(r, 5, path, line, TRUNCATED);
        const date = A.parseDate(r[0], order, path, line);
        const amount = cents(money(r[2], line) + money(r[3], line), r[2] || r[3], path, line);
        out.push({ date, description: strip(r[1]), amount, balance: money(r[4], line), line });
      } else if (shape === "Bark Bank") {
        if (r.length !== 4 || !BARK_DATE.test(strip(r[0]))) throw new ImportFault("bad_columns", path, `not a CommBank line: ${repr(r.slice(0, 4))}`, "the headerless shape is Date, Amount, Description, Balance; download again", line);
        const date = A.parseDate(r[0], order, path, line);
        const amount = cents(money(r[1], line), r[1], path, line);
        out.push({ date, description: strip(r[2]), amount, balance: money(r[3], line), line });
      } else if (shape === "Owner statement") {
        columns(r, 6, path, line, "a truncated download; download again");
        const amount = cents(money(r[3], line) - money(r[4], line), r[3] || r[4], path, line);
        out.push({ date: A.parseDate(r[0], order, path, line), description: strip(r[1]), amount, balance: null, line, schedule_line: strip(r[2]), handled_by: strip(r[5]) });
      } else {
        columns(r, 7, path, line, "a truncated download; download again");
        const date = A.parseDate(r[0], order, path, line);
        const [gross, tax, sup, net] = [3, 4, 5, 6].map((c) => cents(money(r[c], line), r[c], path, line));
        out.push({ date, person: strip(r[1]), employer: strip(r[2]), gross, tax, super: sup, net, description: `${strip(r[1])} ${strip(r[2])}`, amount: net, balance: null, line });
      }
    });
    A.checkWindow(path, out, w || {});
    A.checkSequence(path, out, sequence);
    return out;
  };

  A.checkWindow = (path, rows, w) => {
    const last = rows.reduce((m, r) => (m === null || r.date > m ? r.date : m), null);
    let opening = w.opening_date;
    if (last && opening && w.first_day && last <= opening && last < w.first_day) opening = null;
    for (const r of rows) {
      const y = Number(r.date.slice(0, 4));
      if (y < 2000 || y > 2100) throw new ImportFault("implausible_date", path, `${r.date} is outside any plausible window`, "a misread date; check the shape", r.line);
      if (w.download_day && r.date > w.download_day) throw new ImportFault("after_download", path, `row dated ${r.date} in a file downloaded on ${w.download_day}`,
        "a file cannot hold a row from after the day it was downloaded: either the folder is misnamed (it must be the download date, yyyy-mm-dd) or the dates are read in the wrong order (month first). Fix the folder name or the adapter; never edit the file", r.line);
      if (w.as_of && r.date > w.as_of) throw new ImportFault("after_as_of", path, `row dated ${r.date}, after the as-of date ${w.as_of}`, "the as-of date is the last day the ledger covers; close the later month separately, or move --as-of", r.line);
      if (opening && r.date < opening) throw new ImportFault("before_opening", path, `row dated ${r.date}, before the account opened on ${opening}`,
        "either the Accounts tab opening date is wrong or this file belongs to another account; a row before the opening anchor would break the balance", r.line);
    }
  };

  // Rows must run one way, either way; a zigzag is what month-first dates look like.
  A.checkSequence = (path, rows, sequence) => {
    const d = rows.map((r) => r.date);
    if (d.length < 3) return;
    const asc = d.every((x, i) => i === 0 || d[i - 1] <= x), desc = d.every((x, i) => i === 0 || d[i - 1] >= x);
    if (asc || desc) return;
    const up = d[0] <= d[1];
    let bad = 0;
    while (!(up ? d[bad] > d[bad + 1] : d[bad] < d[bad + 1])) bad++;
    throw new ImportFault("out_of_order", path, `dates run out of order (row ${rows[bad].line} is ${d[bad]}, the next is ${d[bad + 1]}); this shape is ${sequence}`,
      "a month-first file reads like this when days pass 12, and a hand-sorted file does too. Check the institution's date order in adapters.py; never edit the file", rows[bad + 1].line);
  };

  // ---------- insurance documents: text the host extracted ----------
  const MONTHS3 = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
  const LONG_DATE = "(\\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\\d{4})";
  const longDate = (s) => {
    const m = new RegExp(LONG_DATE).exec(s || "");
    if (!m) return null;
    const [y, mo, d] = [Number(m[3]), MONTHS3[m[2]], Number(m[1])];
    return T.validDate(y, mo, d) ? T.iso(y, mo, d) : null; // Python crashes on 31 Feb here; a period it cannot read needs a person
  };
  const PERSON = "this PDF needs a person";

  // The file's lines as cells: pdf_lines as given, or pdf_text with lines on \n and cells on two or more spaces.
  const pdfLines = (file) => {
    if (file.pdf_lines) return file.pdf_lines;
    if (file.pdf_text === null || file.pdf_text === undefined) return [];
    return String(file.pdf_text).split("\n").map((l) => strip(l).split(/ {2,}/)).filter((c) => c.length > 1 || c[0]);
  };

  // A renewal notice or certificate of currency: doc, policy_number, policy, property, period_from, period_to, premium (cents), due, status, cover.
  A.readPolicy = (file, path) => {
    if (file.pdf_error) throw new ImportFault("pdf_needs_person", path, file.pdf_error, `${PERSON}: read the premium, the period and the cover from it and update the Contracts row by hand`);
    const texts = pdfLines(file), flat = texts.map((c) => c.join("  "));
    if (!flat.length) throw new ImportFault("pdf_needs_person", path, "no text could be read from this PDF", `${PERSON}: pdftext.py reads only simple text PDFs (standard fonts, Flate streams); read the premium, period and cover from it and update the Contracts row by hand`);
    const joined = flat.join("\n");
    const out = { doc: /renewal/i.test(joined) ? "renewal" : /certificate of currency/i.test(joined) ? "certificate" : null, policy_number: null, policy: null, property: null,
      period_from: null, period_to: null, premium: null, due: null, status: null, cover: [] };
    texts.slice(0, -1).forEach((row, i) => {
      const nxt = texts[i + 1];
      if (row.length === nxt.length && row.every((c) => /^[A-Za-z ,/()]+$/.test(strip(c)))) {
        row.forEach((label, n) => {
          const k = strip(label).toLowerCase(), value = nxt[n];
          if (k === "policy number") out.policy_number = strip(value);
          else if (k === "policy") out.policy = strip(value);
          else if (k === "period of insurance") {
            const ds = value.match(new RegExp(LONG_DATE, "g")) || [];
            if (ds.length === 2 || (value.includes("to") && ds.length >= 1)) {
              out.period_from = longDate(value);
              out.period_to = value.includes(" to ") ? longDate(value.slice(value.indexOf(" to ") + 4)) : null;
            }
          } else if (k === "total premium" || k === "premium paid" || k === "premium") {
            const cell = value.replace(/[^\p{Nd}.,()-]/gu, "");
            out.premium = cents(A.money(cell, path, null), cell, path, null);
          } else if (k === "payment due") out.due = longDate(value);
          else if (k === "status") out.status = strip(value);
        });
      }
      if (row.length === 2 && strip(row[0]).toLowerCase() === "cover" && strip(row[1]).toLowerCase().startsWith("sum insured")) {
        for (const r of texts.slice(i + 1)) {
          if (r.length !== 2) break;
          out.cover.push([strip(r[0]), strip(r[1])]);
        }
      }
    });
    const onePeriod = new RegExp(`Policy period (\\d{1,2} [${T.WORD}]{3} \\d{4}) to (\\d{1,2} [${T.WORD}]{3} \\d{4})`, "u");
    for (const s of flat) { const m = onePeriod.exec(s); if (m) { out.period_from = longDate(m[1]); out.period_to = longDate(m[2]); } }
    if (!out.policy) {
      const head = flat.find((s) => /insurance/i.test(s) && Array.from(s).length < 60);
      if (head) out.policy = strip(head).replace(new RegExp(`[${T.WS}]+renewal(?=\\n?$)`, "i"), "");
    }
    if (out.policy_number) { const m = /^PS-([A-Z]+)-\d{4}/.exec(out.policy_number); out.property = m ? m[1] : null; }
    const missing = ["doc", "policy_number", "period_from", "period_to", "premium"].filter((k) => !out[k]);
    if (missing.length) throw new ImportFault("pdf_needs_person", path, `${PERSON}: could not read ${missing.join(", ")} from its text`,
      "read the premium, the period and the cover from the document and update the Contracts row by hand; then note in data-sources.json that this insurer's PDF is not machine-readable");
    return out;
  };
  return A;
});
