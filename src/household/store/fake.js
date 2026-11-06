/* A fake of the connector's tool surface, and a Store over it. There is one Fake on purpose: the Store under test is the Google store, so a fake
   failure takes the same path a real one does. Google's habits are modelled from its documented behaviour: a new tab is 1,000 by 26, a write past the
   grid is refused, the book caps at 10 million cells and a cell at 50,000 characters, USER_ENTERED reads a cell the way a person's typing is read,
   and values come back as they are displayed, trailing blanks gone. This is a model of Google, not Google. */
"use strict";
const { googleStore } = require("./google");

const DEFAULT = { rowCount: 1000, columnCount: 26 };
const toIndex = (s) => s.split("").reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
function parseRange(range) {
  const m = /^(?:'([^']+)'|([^!]+))!([A-Z]+)(\d+)?(?::([A-Z]+)(\d+)?)?$/.exec(range);
  if (!m) throw { code: "tool_error", message: `Unable to parse range: ${range}` };
  return { tab: m[1] || m[2], c1: toIndex(m[3]), r1: m[4] ? +m[4] : 1, c2: m[5] ? toIndex(m[5]) : toIndex(m[3]), r2: m[6] ? +m[6] : m[5] ? null : m[4] ? +m[4] : null };
}
class FakeSheet {
  constructor({ valueInput = "USER_ENTERED", cellCap = 10000000 } = {}) {
    this.valueInput = valueInput; this.cellCap = cellCap;
    this.sheets = [{ sheetId: 0, title: "Sheet1", ...DEFAULT, hidden: false, rows: [], protected: false }];
    this.cellWrites = 0;
  }
  sheet(tab) { const s = this.sheets.find((x) => x.title === tab); if (!s) throw { code: "tool_error", message: `Unable to parse range: ${tab}` }; return s; }
  cells() { return this.sheets.reduce((n, s) => n + s.rowCount * s.columnCount, 0); }
  capped(extra) { if (this.cells() + extra > this.cellCap) throw { code: "tool_error", message: `This action would increase the number of cells in the workbook above the limit of ${this.cellCap} cells.` }; }
  // A cell as Google would hold it from a value, then show it.
  enter(v) {
    if (v === null || v === undefined) return undefined;
    if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
    if (typeof v === "number") return String(v);
    const s = String(v);
    if (this.valueInput === "RAW" || s === "") return s;
    if (s.startsWith("'")) return s.slice(1);
    if (s.startsWith("=")) return "#NAME?";
    if (/^(true|false)$/i.test(s)) return s.toUpperCase();
    if (/^-?\d[\d,]*(\.\d+)?(e[+-]?\d+)?%?$/i.test(s)) return String(Number(s.replace(/[,%]/g, "")));
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
    if (/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* \d{1,4}$/i.test(s)) return `1/01/${s.slice(-4)}`;
    return s;
  }
  get({ tab, c1, r1, c2, r2 }) {
    const s = this.sheet(tab), last = Math.min(r2 ?? s.rowCount, s.rowCount), out = [];
    for (let r = r1; r <= last; r++) { const row = Array.from((s.rows[r - 1] || []).slice(c1 - 1, c2), (c) => c ?? ""); while (row.length && row[row.length - 1] === "") row.pop(); out.push(row); }
    while (out.length && !out[out.length - 1].length) out.pop();
    return out;
  }
  set({ tab, c1, r1, c2, r2 }, values) {
    const s = this.sheet(tab), width = Math.max(...values.map((v) => v.length), 0), bottom = r1 + values.length - 1, right = c1 + width - 1;
    if (bottom > s.rowCount || right > s.columnCount || (r2 && bottom > r2)) throw { code: "tool_error", message: `Range (${tab}!${bottom}) exceeds grid limits. Max rows: ${s.rowCount}, max columns: ${s.columnCount}` };
    values.forEach((row, i) => {
      const at = (s.rows[r1 - 1 + i] = s.rows[r1 - 1 + i] || []);
      row.forEach((v, j) => {
        if (typeof v === "string" && v.length > 50000) throw { code: "tool_error", message: "Your input contains more than the maximum of 50000 characters in a single cell." };
        const shown = this.enter(v);
        if (shown !== undefined) { at[c1 - 1 + j] = shown; this.cellWrites += 1; }
      });
    });
  }
  clear({ tab, c1, r1, c2, r2 }) {
    const s = this.sheet(tab);
    for (let r = r1; r <= Math.min(r2 ?? s.rowCount, s.rowCount); r++) if (s.rows[r - 1]) for (let c = c1; c <= c2; c++) delete s.rows[r - 1][c - 1];
  }
  batch(requests) {
    const before = JSON.stringify(this.sheets);
    try {
      for (const q of requests) {
        if (q.addSheet) {
          const p = q.addSheet.properties, g = p.gridProperties || {};
          if (this.sheets.some((s) => s.title === p.title)) throw { code: "tool_error", message: `A sheet with the name "${p.title}" already exists.` };
          this.capped((g.rowCount || DEFAULT.rowCount) * (g.columnCount || DEFAULT.columnCount));
          this.sheets.push({ sheetId: p.sheetId ?? 100 + this.sheets.length, title: p.title, rowCount: g.rowCount || DEFAULT.rowCount, columnCount: g.columnCount || DEFAULT.columnCount, hidden: !!p.hidden, frozen: g.frozenRowCount || 0, rows: [], protected: false, color: p.tabColorStyle });
        } else if (q.updateCells) {
          const u = q.updateCells, s = this.sheets.find((x) => x.sheetId === u.start.sheetId);
          u.rows.forEach((r, i) => { const at = (s.rows[u.start.rowIndex + i] = s.rows[u.start.rowIndex + i] || []); r.values.forEach((v, j) => { at[u.start.columnIndex + j] = v.userEnteredValue.stringValue; }); });
        } else if (q.deleteSheet) {
          if (this.sheets.length === 1) throw { code: "tool_error", message: "You can't remove all the sheets in a document." };
          this.sheets = this.sheets.filter((s) => s.sheetId !== q.deleteSheet.sheetId);
        } else if (q.appendDimension) {
          const s = this.sheets.find((x) => x.sheetId === q.appendDimension.sheetId);
          this.capped(q.appendDimension.length * s.columnCount);
          s.rowCount += q.appendDimension.length;
        } else if (q.addProtectedRange) {
          this.sheets.find((x) => x.sheetId === q.addProtectedRange.protectedRange.range.sheetId).protected = true;
        } else throw { code: "tool_error", message: `Unknown request: ${Object.keys(q)[0]}` };
      }
      if (!this.sheets.some((s) => !s.hidden)) throw { code: "tool_error", message: "You can't hide all visible sheets in a document." };
    } catch (e) { this.sheets = JSON.parse(before); throw e; }
  }
}

/* The surface a page's mcp object shows. revoke(tool) is a grant the person never gave. failOn(...) is quota, or a blip, on the nth call of a tool:
   applied means Google did the work and the answer was lost, which is the failure that doubles rows in a careless writer. */
function fakeConnector({ sheet = new FakeSheet(), stringPayload = false } = {}) {
  const revoked = new Set(), faults = [], files = new Map(), log = [];
  const counts = {};
  const apply = (tool, i) => {
    switch (tool) {
      case "get_spreadsheet": return { sheets: sheet.sheets.map((s) => ({ properties: { sheetId: s.sheetId, title: s.title, hidden: s.hidden, gridProperties: { rowCount: s.rowCount, columnCount: s.columnCount, frozenRowCount: s.frozen || 0 } } })) };
      case "get_values": { const v = sheet.get(parseRange(i.range)); return v.length ? { range: i.range, majorDimension: "ROWS", values: v } : { range: i.range, majorDimension: "ROWS" }; }
      case "update_values": sheet.set(parseRange(i.range), i.values); return { updatedRange: i.range, updatedRows: i.values.length };
      case "batch_clear_values": for (const r of i.ranges) sheet.clear(parseRange(r)); return { clearedRanges: i.ranges };
      case "update_spreadsheet": sheet.batch(i.requests); return { replies: [] };
      case "create_file": {
        const id = `file-${files.size + 1}`;
        if (i.contentMimeType === "application/vnd.google-apps.spreadsheet") { sheet.title = i.title; return { id, title: i.title }; }
        files.set(id, { id, title: i.title, mimeType: i.contentMimeType, parentId: i.parentId, content: i.base64Content });
        return { id, title: i.title };
      }
      case "search_files": { const t = /title = '([^']+)'/.exec(i.query); return { files: [...files.values()].filter((f) => !t || f.title === t[1]).map(({ id, title }) => ({ id, title })) }; }
      case "download_file_content": { const f = files.get(i.fileId); if (!f) throw { code: "tool_error", message: "File not found" }; return { content: f.content }; }
      default: throw { code: "tool_error", message: `No such tool: ${tool}` };
    }
  };
  return {
    sheet, files, log,
    revoke: (tool) => revoked.add(tool), allow: (tool) => revoked.delete(tool),
    failOn: (f) => faults.push({ code: "rate_limited", times: 1, at: 1, ...f }), heal: () => faults.splice(0, faults.length),
    async invalidate() {},
    async callTool(server, tool, input) {
      log.push({ server, tool, input });
      if (revoked.has(tool)) throw { code: "not_in_manifest", message: `${tool} is not declared` };
      counts[tool] = (counts[tool] || 0) + 1;
      const f = faults.find((x) => x.tool === tool && (!x.range || String(input.range || "").includes(x.range)) && counts[tool] >= (x.after ?? 0) + 1 && x.times > 0);
      if (f) { f.times -= 1; if (f.applied) apply(tool, input); throw { code: f.code, message: f.message || `429: Quota exceeded for ${tool}`, retryAfterMs: 1 }; }
      const payload = apply(tool, input);
      return { payload: stringPayload ? JSON.stringify(payload) : payload };
    },
  };
}
const noWait = async () => {};
/* A Store with a Fake behind it. handEdit(tab, row, column, value) is a person typing. drive: false is a host with no blobs. */
function fakeStore({ valueInput, cellCap, drive = true, retries = 0, stringPayload, deviceFiles } = {}) {
  const mcp = fakeConnector({ sheet: new FakeSheet({ valueInput, cellCap }), stringPayload });
  const store = googleStore({ mcp, spreadsheetId: "fake", sleep: noWait, retries, hasDrive: drive, deviceFiles });
  return Object.assign(store, {
    fake: mcp,
    handEdit(tab, row, col, value) { const s = mcp.sheet.sheet(tab); s.rows[row - 1] = s.rows[row - 1] || []; s.rows[row - 1][col - 1] = value; },
  });
}
module.exports = { FakeSheet, fakeConnector, fakeStore };
