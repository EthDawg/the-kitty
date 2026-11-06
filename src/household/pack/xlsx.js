/* A workbook writer with what a tax pack needs and nothing else: styles, live formulas with their answers cached, links to files and tabs,
   frozen panes, merged notes, print setup. Plain JavaScript over the zip writer, so a page can make the same file. */
(function (root, name, deps, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(...deps.map((d) => require(`./${d}.js`)));
  else { const K = (root.KittyPack = root.KittyPack || {}); K[name] = factory(...deps.map((d) => K[d])); }
})(typeof self !== "undefined" ? self : this, "xlsx", ["zip", "formula"], function (Z, F) {
  "use strict";
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, " ");
  const INK = "FF1B1A22", BLUE = "FF1F4FBF", MUTED = "FF6B6875", HEAD = "FFEDEAE3", BAND = "FF23304A", WHITE = "FFFFFFFF", AMBER = "FFFFF1CC", RED = "FFFBDAD7", GREEN = "FFE2F2E4", INPUT = "FFF3F6FD", LINK = "FF0B57D0";
  const WHOLE = '"$"#,##0;("$"#,##0);"nil"', MONEY = '"$"#,##0.00;("$"#,##0.00);"nil"', ZERO = '"$"#,##0.00;("$"#,##0.00);"$"0.00', PCT = "0.0%", UNITS = "#,##0.####", RATE = "0.0000";

  // One name per look. Blue is typed from a document, black is worked out here: the template's rule.
  const STYLES = {
    default: {}, title: { b: 1, sz: 13, color: WHITE, fill: BAND, v: "center" }, note: { color: MUTED, wrap: 1, v: "top" }, section: { b: 1, color: WHITE, fill: BAND },
    head: { b: 1, fill: HEAD, wrap: 1, v: "center" }, headR: { b: 1, fill: HEAD, wrap: 1, v: "center", h: "right" }, text: { v: "top" }, wrap: { wrap: 1, v: "top" }, muted: { color: MUTED, wrap: 1, v: "top" }, bold: { b: 1 },
    input: { color: BLUE, fmt: MONEY, v: "top" }, calc: { fmt: MONEY, v: "top" }, wholeMoney: { fmt: WHOLE, v: "top" }, totalWhole: { b: 1, fmt: WHOLE, top: 1 }, total: { b: 1, fmt: MONEY, top: 1 }, totalText: { b: 1, top: 1 }, zero: { b: 1, fmt: ZERO, top: 1, fill: GREEN },
    blank: { color: BLUE, fmt: MONEY, fill: INPUT, v: "top" }, blankText: { color: BLUE, fill: INPUT, wrap: 1, v: "top" }, pctIn: { color: BLUE, fmt: PCT, v: "top" }, pctCalc: { fmt: PCT, v: "top" }, rate: { color: BLUE, fmt: "0.000", v: "top" }, fx: { color: BLUE, fmt: RATE, v: "top" },
    units: { color: BLUE, fmt: UNITS, v: "top" }, unitsCalc: { fmt: UNITS, v: "top" }, whole: { color: BLUE, fmt: "#,##0", v: "top" }, wholeCalc: { fmt: "#,##0", v: "top" }, date: { color: BLUE, v: "top" },
    ok: { fill: GREEN, v: "top" }, warn: { fill: AMBER, v: "top", wrap: 1 }, stop: { fill: RED, b: 1, v: "top", wrap: 1 }, indicative: { fill: AMBER, i: 1, v: "top" }, link: { color: LINK, u: 1, v: "top" }, notFound: { fill: RED, b: 1, h: "right", v: "top" },
  };
  const NAMES = Object.keys(STYLES);

  function stylesXml() {
    const fonts = [], fills = ["none", "gray125"], fmts = [], borders = [0, 1], xfs = [];
    const font = (s) => { const x = `<font>${s.b ? "<b/>" : ""}${s.i ? "<i/>" : ""}${s.u ? "<u/>" : ""}<sz val="${s.sz || 10}"/><color rgb="${s.color || INK}"/><name val="Arial"/></font>`; let i = fonts.indexOf(x); if (i < 0) i = fonts.push(x) - 1; return i; };
    const fill = (c) => { if (!c) return 0; let i = fills.indexOf(c); if (i < 0) i = fills.push(c) - 1; return i; };
    const fmt = (f) => { if (!f) return 0; let i = fmts.indexOf(f); if (i < 0) i = fmts.push(f) - 1; return 164 + i; };
    for (const n of NAMES) {
      const s = STYLES[n], a = s.wrap || s.h || s.v ? `<alignment${s.h ? ` horizontal="${s.h}"` : ""}${s.v ? ` vertical="${s.v}"` : ""}${s.wrap ? ' wrapText="1"' : ""}/>` : "";
      xfs.push(`<xf numFmtId="${fmt(s.fmt)}" fontId="${font(s)}" fillId="${fill(s.fill)}" borderId="${s.top ? 1 : 0}" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1" applyBorder="1"${a ? ' applyAlignment="1"' : ""}>${a}</xf>`);
    }
    const fillXml = fills.map((f) => (f === "none" || f === "gray125" ? `<fill><patternFill patternType="${f}"/></fill>` : `<fill><patternFill patternType="solid"><fgColor rgb="${f}"/></patternFill></fill>`)).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="${fmts.length}">${fmts.map((f, i) => `<numFmt numFmtId="${164 + i}" formatCode="${esc(f)}"/>`).join("")}</numFmts><fonts count="${fonts.length}">${fonts.join("")}</fonts><fills count="${fills.length}">${fillXml}</fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top style="thin"><color rgb="${INK}"/></top><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join("")}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  }

  // A sheet is built top to bottom. Keys name cells, and a formula says {key} wherever it wants one, so tabs can point at each other in any order.
  class Sheet {
    constructor(name, o = {}) { this.name = name; this.cols = o.cols || []; this.color = o.color || null; this.rows = []; this.merges = []; this.heights = {}; this.keys = new Map(); this.freeze = o.freeze || 0; this.columns = this.cols.length; }
    get next() { return this.rows.length + 1; }
    row(cells, o = {}) {
      const r = this.rows.length + 1;
      this.rows.push(cells.map((c) => (c === null || c === undefined || typeof c !== "object" ? (c === null || c === undefined ? null : { v: c }) : c)));
      this.rows[r - 1].forEach((c, i) => { if (c && c.key) this.keys.set(c.key, `${F.colName(i)}${r}`); });
      if (o.ht) this.heights[r] = o.ht;
      return r;
    }
    span(text, s, o = {}) {   // a line across the sheet, tall enough for its words because merged cells never grow by themselves
      const r = this.row([{ v: text, s }]);
      this.merges.push(`A${r}:${F.colName(this.columns - 1)}${r}`);
      const wide = this.cols.reduce((a, b) => a + b, 0), lines = Math.ceil(String(text).length * 1.05 / wide);
      this.heights[r] = o.ht || Math.max(15, lines * 13.5 + 2);
      return r;
    }
    gap() { return this.row([]); }
    ref(key) { return `${this.quoted}!$${this.keys.get(key).replace(/([0-9]+)/, "$$$1")}`; }
    get quoted() { return /[^A-Za-z0-9_]/.test(this.name) ? `'${this.name.replace(/'/g, "''")}'` : this.name; }
  }

  function resolve(book) {
    const where = new Map();
    for (const s of book.sheets) for (const [k, a] of s.keys) where.set(k, { sheet: s, addr: a });
    const subst = (f, sheet) => f.replace(/\{([^}]+)\}/g, (_, k) => {
      const w = where.get(k);
      if (!w) throw new Error(`Formula names ${k}, which no tab has`);
      return w.sheet === sheet ? w.addr : `${w.sheet.quoted}!${w.addr}`;
    });
    const byName = new Map(book.sheets.map((s) => [s.name, s]));
    for (const s of book.sheets) for (const row of s.rows) for (const c of row) {
      if (c && c.f !== undefined) c.f = subst(c.f, s);
      if (c && c.go) { const w = where.get(c.go); if (!w) throw new Error(`Link names ${c.go}`); c.loc = `${w.sheet.quoted}!${w.addr}`; }
    }
    const ev = F.evaluator((name, col, r) => { const s = byName.get(name); return s && s.rows[r - 1] ? s.rows[r - 1][F.colIndex(col)] || null : null; });
    for (const s of book.sheets) s.rows.forEach((row, r) => row.forEach((c, i) => { if (c && c.f !== undefined) c.cached = ev.cell(s.name, F.colName(i), r + 1); }));
    return { valueOf: (key) => { const w = where.get(key); return ev.cell(w.sheet.name, w.addr.replace(/[0-9]+/, ""), Number(w.addr.replace(/[A-Z]+/, ""))); }, where };
  }

  const encodePath = (p) => p.split("/").map(encodeURIComponent).join("/");

  function sheetXml(s) {
    const links = [], rels = [];
    const rows = s.rows.map((row, r) => {
      const cells = row.map((c, i) => {
        if (!c) return "";
        const ref = `${F.colName(i)}${r + 1}`, st = ` s="${NAMES.indexOf(c.s || "default")}"`;
        if (c.file) { rels.push(`<Relationship Id="rId${rels.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${esc(encodePath(c.file))}" TargetMode="External"/>`); links.push(`<hyperlink ref="${ref}" r:id="rId${rels.length}"/>`); }
        if (c.loc) links.push(`<hyperlink ref="${ref}" location="${esc(c.loc)}"/>`);
        if (c.f !== undefined) {
          const v = c.cached;
          if (typeof v === "number") return `<c r="${ref}"${st}><f>${esc(c.f)}</f><v>${v}</v></c>`;
          if (typeof v === "boolean") return `<c r="${ref}"${st} t="b"><f>${esc(c.f)}</f><v>${v ? 1 : 0}</v></c>`;
          return `<c r="${ref}"${st} t="str"><f>${esc(c.f)}</f><v>${esc(v ?? "")}</v></c>`;
        }
        if (c.v === null || c.v === undefined) return `<c r="${ref}"${st}/>`;
        if (typeof c.v === "number") return `<c r="${ref}"${st}><v>${c.v}</v></c>`;
        return `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${esc(c.v)}</t></is></c>`;
      }).join("");
      const ht = s.heights[r + 1] ? ` ht="${s.heights[r + 1]}" customHeight="1"` : "";
      return `<row r="${r + 1}"${ht}>${cells}</row>`;
    }).join("");
    const pane = s.freeze ? `<pane ySplit="${s.freeze}" topLeftCell="A${s.freeze + 1}" activePane="bottomLeft" state="frozen"/>` : "";
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetPr>${s.color ? `<tabColor rgb="FF${s.color}"/>` : ""}<pageSetUpPr fitToPage="1"/></sheetPr><sheetViews><sheetView showGridLines="0" workbookViewId="0">${pane}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="14"/>${s.cols.length ? `<cols>${s.cols.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` : ""}<sheetData>${rows}</sheetData>${s.merges.length ? `<mergeCells count="${s.merges.length}">${s.merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>` : ""}${links.length ? `<hyperlinks>${links.join("")}</hyperlinks>` : ""}<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`;
    return { xml, rels };
  }

  function write(book, { deflateRaw, date } = {}) {
    const sheets = book.sheets;
    const files = [
      ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`],
      ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
      ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets><calcPr calcId="0" fullCalcOnLoad="1"/></workbook>`],
      ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
      ["xl/styles.xml", stylesXml()],
    ];
    sheets.forEach((s, i) => {
      const { xml, rels } = sheetXml(s);
      files.push([`xl/worksheets/sheet${i + 1}.xml`, xml]);
      if (rels.length) files.push([`xl/worksheets/_rels/sheet${i + 1}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join("")}</Relationships>`]);
    });
    return Z.write(files, { deflateRaw, date });
  }

  return { Sheet, resolve, write };
});
