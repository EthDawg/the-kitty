/* A household in a Google Sheet, with files in Drive, over the page's host mcp object: callTool(server, tool, input, opts) gives { payload }.
   What it needs, and it says so: Sheets get_spreadsheet, get_values, update_values, update_spreadsheet (nothing else adds a tab) and
   batch_clear_values; Drive create_file, search_files and download_file_content, for files only. No Drive, no blobs: `add` then records
   the bytes as not held. Rows go in with update_values at a named row, never append_values, whose table detection walks past a blank row. */
"use strict";
const { toCells, tooLong, normalise, hashRows, guard } = require("../codec");
const { stableStringify } = require("../../../standard/engine/util");
const { openStore } = require("./port");
const { ABOUT, TABS, tabOf, pkOf } = require("../tabs");

const NEEDS = {
  sheets: ["get_spreadsheet", "get_values", "update_values", "update_spreadsheet", "batch_clear_values"],
  drive: ["create_file", "search_files", "download_file_content"],
};
const CHUNK = 2500, WRITE_ROWS = 2000, WRITE_BYTES = 1500000, GROW = 500;
const COLOURS = { yours: { red: 0.35, green: 0.64, blue: 0.42 }, evidence: { red: 0.42, green: 0.56, blue: 0.82 }, managed: { red: 0.65, green: 0.65, blue: 0.65 } };
const TAB_ROWS = { [ABOUT]: 60 };
const quoted = (tab) => (/^[A-Za-z0-9_]+$/.test(tab) ? tab : `'${tab}'`);
const colName = (n) => { let s = ""; for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
const isQuota = (e) => e && (e.code === "rate_limited" || /429|quota|rate.?limit|RESOURCE_EXHAUSTED|too many requests/i.test(String(e.message || "")));
const isBlip = (e) => e && (e.retryable || /unavailable|\b50[234]\b|backend error|internal error|timed? ?out|deadline/i.test(String(e.message || "")));
const GRANT = new Set(["not_in_manifest", "approval_required", "consent_required", "server_not_connected", "needs_reauth", "blocked_by_policy", "selection_required"]);

const b64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function toBase64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2], n = (a << 16) | ((b || 0) << 8) | (c || 0);
    s += b64[n >> 18] + b64[(n >> 12) & 63] + (b === undefined ? "=" : b64[(n >> 6) & 63]) + (c === undefined ? "=" : b64[n & 63]);
  }
  return s;
}
function fromBase64(s) {
  const clean = String(s).replace(/[^A-Za-z0-9+/_-]/g, "").replace(/-/g, "+").replace(/_/g, "/"), out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let n = 0, bits = 0, acc = 0;
  for (const ch of clean) { acc = (acc << 6) | b64.indexOf(ch); bits += 6; if (bits >= 8) { bits -= 8; out[n++] = (acc >> bits) & 255; acc &= (1 << bits) - 1; } }
  return out.subarray(0, n);
}

function googleAdapter({ mcp, spreadsheetId, sheets = "Google Sheets", drive = "Google Drive", folderId, sleep, retries = 3, hasDrive = true, deviceFiles = false }) {
  const wait = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  let grid = null, mode = null;
  async function call(server, tool, input) {
    for (let attempt = 0; ; attempt += 1) {
      let res;
      try { res = await mcp.callTool(server, tool, input, { cache: { staleTime: 0, gcTime: 0, refresh: true } }); }
      catch (e) {
        if (e && GRANT.has(e.code)) throw { code: "missing_grant", tool, server, reason: e.code, message: `This needs ${server} ${tool}, and the connector has not granted it (${e.code}).` };
        const quota = isQuota(e), blip = !quota && isBlip(e);
        if ((quota || blip) && attempt < retries) { await wait((e.retryAfterMs || (quota ? 15000 : 1500) * (attempt + 1)) + 200); continue; }
        if (quota) throw { ...e, code: "rate_limited", tool, retryable: true, message: e.message || "Google is limiting this account." };
        throw e;
      }
      let p = res && typeof res === "object" && "payload" in res ? res.payload : res;
      if (typeof p === "string") { try { p = JSON.parse(p); } catch (e) { throw { code: "invalid_response", tool }; } }
      return p;
    }
  }
  const sheetsCall = (tool, input) => call(sheets, tool, { spreadsheetId, ...input });
  async function refreshGrid() {
    const meta = await sheetsCall("get_spreadsheet", { fields: ["sheets.properties.sheetId", "sheets.properties.title", "sheets.properties.gridProperties"] });
    grid = new Map(((meta && meta.sheets) || []).map((s) => [s.properties.title, { sheetId: s.properties.sheetId, rowCount: s.properties.gridProperties.rowCount, columnCount: s.properties.gridProperties.columnCount }]));
    return grid;
  }
  const gridOf = async (tab) => { const g = (grid || (await refreshGrid())).get(tab) || (await refreshGrid()).get(tab); if (!g) throw { code: "missing_tab", tab, message: `The ${tab} tab is not in this sheet.` }; return g; };
  const values = async (range) => { const p = await sheetsCall("get_values", { range }); const v = p && p.values; if (v !== undefined && !Array.isArray(v)) throw { code: "invalid_response", tool: "get_values" }; return v || []; };
  const row = (headers, cells) => { const r = {}; headers.forEach((h, i) => { r[h] = cells[i]; }); return r; };
  const blank = (cells) => !cells.some((c) => c !== "" && c != null);

  async function readGrid(tab, last) {
    const g = await gridOf(tab);
    if (g.rowCount <= CHUNK) return values(`${quoted(tab)}!A1:${last}`);
    const out = [];
    for (let first = 1; first <= g.rowCount; first += CHUNK) {
      const end = Math.min(g.rowCount, first + CHUNK - 1), part = await values(`${quoted(tab)}!A${first}:${last}${end}`);
      for (let i = 0; i < end - first + 1; i++) out.push(part[i] || []);
    }
    while (out.length && blank(out[out.length - 1])) out.pop();
    return out;
  }
  async function read(table) {
    const t = tabOf(table), grid2 = await readGrid(t.tab, colName(t.headers.length));
    if (!t.headers.every((h, i) => String((grid2[0] || [])[i] ?? "").trim() === h)) throw { code: "header_changed", table, tab: t.tab, message: `The ${t.tab} header is not where it should be, so nothing was read or written.` };
    return grid2.slice(1).filter((c) => !blank(c)).map((c) => row(t.headers, c));
  }
  async function usedRows(tab) {
    const col = await readGrid(tab, "A");
    let used = 0;
    col.forEach((r, i) => { if (!blank(r)) used = i + 1; });
    return used;
  }
  async function ensureGrid(tab, rows) {
    const g = await gridOf(tab);
    if (g.rowCount >= rows) return;
    const length = Math.max(rows - g.rowCount, GROW);
    await sheetsCall("update_spreadsheet", { requests: [{ appendDimension: { sheetId: g.sheetId, dimension: "ROWS", length } }] });
    g.rowCount += length;
  }
  async function valueInput() {
    if (mode) return mode;
    const v = (await values(`${ABOUT}!A1:F`)).find((r) => r[0] === "value_input");
    mode = (v && v[4]) || "USER_ENTERED";
    return mode;
  }
  // Write rows at a named row, in chunks, then read each chunk back. What Google holds is what we meant, or the write is reported.
  async function writeRows(table, rows, startRow) {
    const t = tabOf(table), last = colName(t.headers.length), how = await valueInput();
    const cells = rows.map((r) => { const c = toCells(table, r, how), long = tooLong(table, c); if (long) throw { code: "cell_too_long", table, column: long, message: `A value in ${t.tab} ${long} is too long for one Sheet cell.` }; return c; });
    await ensureGrid(t.tab, startRow + rows.length - 1);
    for (let i = 0, at = startRow; i < cells.length;) {
      let n = 0, size = 0;
      while (i + n < cells.length && n < WRITE_ROWS && size < WRITE_BYTES) { size += JSON.stringify(cells[i + n]).length; n += 1; }
      const range = `${quoted(t.tab)}!A${at}:${last}${at + n - 1}`;
      await sheetsCall("update_values", { range, values: cells.slice(i, i + n) });
      const back = await values(range);
      for (let j = 0; j < n; j++) {
        const want = stableStringify(normalise(table, rows[i + j])), got = stableStringify(normalise(table, row(t.headers, back[j] || [])));
        if (want !== got) throw { code: "readback_mismatch", table, row: at + j, message: `Row ${at + j} of ${t.tab} did not read back as written.`, want, got };
      }
      i += n; at += n;
    }
    try { await mcp.invalidate(sheets, "get_values"); } catch (e) { /* an older host */ }
  }
  // The About tab is the manifest, as a person reads it. Its hashes are text, and an all-digit one must stay text.
  const aboutRows = (m, how) => {
    const meta = ["standard_version", "runtime", "state", "household_id", "bundle_hash", "as_of", "written_at", "value_input"];
    const rows = [["name", "class", "rows", "hash", "value", "about"],
      ...meta.map((k) => [k, "meta", "", "", m[k] == null ? "" : String(m[k]), ""]),
      ...TABS.map((t) => { const e = m.tables[t.table] || {}; return [t.tab, t.class, e.rows ?? 0, e.hash || "", e.writing || "", t.about]; })];
    return rows.map((r) => r.map((c) => (typeof c === "string" && c ? guard(c, how) : c)));
  };
  function parseAbout(rows) {
    const m = { tables: {} }, tabs = new Map(TABS.map((t) => [t.tab, t]));
    for (const r of rows.slice(1)) {
      if (r[1] === "meta") { if (r[4]) m[r[0]] = r[4]; continue; }
      const t = tabs.get(r[0]);
      if (t) m.tables[t.table] = { rows: Number(r[2]) || 0, hash: r[3] || hashRows([]), class: t.class, plane: t.plane, workbooks: [{ name: "household", partition: null }], ...(r[4] ? { writing: r[4] } : {}) };
    }
    return m;
  }
  const blobs = hasDrive ? {
    title: (sha) => `kitty-${sha}`,
    async find(sha) {
      const p = await call(drive, "search_files", { query: `title = '${blobs.title(sha)}' and trashed = false`, excludeContentSnippets: true });
      const list = (p && (p.files || p.results || p.items)) || (Array.isArray(p) ? p : []);
      return list[0] || null;
    },
    async has(sha) { return !!(await blobs.find(sha)); },
    async put(sha, bytes, meta = {}) {
      if (await blobs.find(sha)) return;
      await call(drive, "create_file", { title: blobs.title(sha), base64Content: toBase64(bytes), contentMimeType: meta.mime || "application/octet-stream", disableConversionToGoogleType: true, ...(folderId ? { parentId: folderId } : {}) });
    },
    async get(sha) {
      const f = await blobs.find(sha);
      if (!f) return null;
      const p = await call(drive, "download_file_content", { fileId: f.id });
      const content = p && (p.content || p.base64Content || p.data || (typeof p === "string" ? p : null));
      return content ? new Uint8Array(fromBase64(content)) : null;
    },
  } : null;
  return {
    kind: "google", blobs,
    capabilities: { tables: true, blobs: !!blobs, hides_tabs: true, device_files: deviceFiles, needs: { [sheets]: NEEDS.sheets, ...(blobs ? { [drive]: NEEDS.drive } : {}) } },
    async probe() {
      const titles = [...(await refreshGrid()).keys()];
      if (titles.includes(ABOUT)) {
        const m = parseAbout(await values(`${ABOUT}!A1:F`));
        if (m.standard_version) return { empty: false, recognised: true, found: titles, manifest: m };
      }
      const looksV2 = titles.includes("Kitty") || titles.includes("Entries");
      if (titles.length === 1 && !looksV2 && !(await values(`${quoted(titles[0])}!A1:Z20`)).some((r) => !blank(r))) return { empty: true, recognised: false, found: titles, stray: titles[0] };
      return { empty: false, recognised: false, found: titles, looks_like: looksV2 ? "an older Kitty sheet" : null };
    },
    /* One atomic call makes every tab, sized, hidden or shown, headed, coloured and warned, and removes the default Sheet1. Either a whole
       Kitty exists afterwards or nothing changed. */
    async create(tabs, manifest) {
      const g = await refreshGrid(), stray = [...g.values()].map((s) => s.sheetId);
      const free = new Set(stray); let id = 1000;
      const nextId = () => { while (free.has(++id)); return id; };
      const about = nextId(), requests = [{ addSheet: { properties: { sheetId: about, title: ABOUT, index: 0, gridProperties: { rowCount: TAB_ROWS[ABOUT], columnCount: 8, frozenRowCount: 1 } } } }];
      tabs.forEach((t, i) => {
        const sheetId = nextId();
        requests.push({ addSheet: { properties: { sheetId, title: t.tab, index: i + 1, hidden: !t.visible, gridProperties: { rowCount: t.rows, columnCount: t.headers.length, frozenRowCount: 1 }, tabColorStyle: { rgbColor: COLOURS[t.class] } } } });
        requests.push({ updateCells: { start: { sheetId, rowIndex: 0, columnIndex: 0 }, rows: [{ values: t.headers.map((h) => ({ userEnteredValue: { stringValue: h } })) }], fields: "userEnteredValue" } });
        if (t.class !== "yours") requests.push({ addProtectedRange: { protectedRange: { range: { sheetId }, description: t.about, warningOnly: true } } });
      });
      for (const sheetId of stray) requests.push({ deleteSheet: { sheetId } });
      await sheetsCall("update_spreadsheet", { requests });
      grid = null;
      // Which rules does this connector write by? One cell tells us, once, and it is kept in the manifest.
      await sheetsCall("update_values", { range: `${ABOUT}!H1`, values: [["'kitty"]] });
      const probe = await values(`${ABOUT}!H1`);
      mode = probe[0] && probe[0][0] === "kitty" ? "USER_ENTERED" : "RAW";
      await sheetsCall("update_values", { range: `${ABOUT}!H1`, values: [[""]] });
      await this.putManifest({ ...manifest, value_input: mode });
    },
    read,
    async keys(table) { const t = tabOf(table), pk = pkOf(table), col = await readGrid(t.tab, "A"); if (t.headers[0] !== pk) throw new Error(`${table}: the key is not in the first column`); return col.slice(1).map((r) => normalise(table, row(t.headers, r))[pk]).filter((k) => k !== undefined); },
    async append(table, rows) { const t = tabOf(table); await writeRows(table, rows, (await usedRows(t.tab)) + 1); },
    async write(table, rows) {
      const t = tabOf(table), g = await gridOf(t.tab);
      await sheetsCall("batch_clear_values", { ranges: [`${quoted(t.tab)}!A2:${colName(t.headers.length)}${g.rowCount}`] });
      if (rows.length) await writeRows(table, rows, 2);
    },
    async getManifest() { const m = parseAbout(await values(`${ABOUT}!A1:F`)); if (m.value_input) mode = m.value_input; return m; },
    async putManifest(m) { const how = m.value_input || mode || (await valueInput()), rows = aboutRows({ ...m, value_input: how }, how); await sheetsCall("update_values", { range: `${ABOUT}!A1:F${rows.length}`, values: rows }); },
  };
}
const googleStore = (o) => openStore(googleAdapter(o));
// Nothing makes a spreadsheet but Drive. A second server, and a second grant, used once.
async function createSpreadsheet({ mcp, title, drive = "Google Drive" }) {
  const res = await mcp.callTool(drive, "create_file", { title, contentMimeType: "application/vnd.google-apps.spreadsheet" }, {});
  let p = res && "payload" in res ? res.payload : res;
  if (typeof p === "string") p = JSON.parse(p);
  return p.id || (p.file && p.file.id);
}
module.exports = { googleStore, googleAdapter, createSpreadsheet, NEEDS, toBase64, fromBase64 };
