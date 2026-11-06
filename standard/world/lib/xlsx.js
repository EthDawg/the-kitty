/* A minimal XLSX writer: a real zip with deflated parts, shared strings, numbers as numbers and dates as Excel serials the way a spreadsheet saves
   them. Fixed timestamps, so the bytes never change. */
"use strict";
const { toDays } = require("./util");

const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function zip(entries, deflateRaw) {
  const te = new TextEncoder(), chunks = [], central = []; let off = 0;
  const u16 = (v) => [v & 255, (v >> 8) & 255], u32 = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
  const put = (b) => { const u = b instanceof Uint8Array ? b : new Uint8Array(b); chunks.push(u); off += u.length; };
  const DOS_DATE = 0x5021, DOS_TIME = 0; // 1 Jan 2020
  for (const [name, text] of entries) {
    const raw = te.encode(text), body = deflateRaw(raw), nm = te.encode(name), crc = crc32(raw), at = off;
    put([0x50, 0x4b, 3, 4, ...u16(20), ...u16(0), ...u16(8), ...u16(DOS_TIME), ...u16(DOS_DATE), ...u32(crc), ...u32(body.length), ...u32(raw.length), ...u16(nm.length), ...u16(0)]); put(nm); put(body);
    central.push({ nm, crc, c: body.length, u: raw.length, at });
  }
  const cd = off;
  for (const e of central) { put([0x50, 0x4b, 1, 2, ...u16(20), ...u16(20), ...u16(0), ...u16(8), ...u16(DOS_TIME), ...u16(DOS_DATE), ...u32(e.crc), ...u32(e.c), ...u32(e.u), ...u16(e.nm.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(e.at)]); put(e.nm); }
  const size = off - cd;
  put([0x50, 0x4b, 5, 6, ...u16(0), ...u16(0), ...u16(central.length), ...u16(central.length), ...u32(size), ...u32(cd), ...u16(0)]);
  const out = new Uint8Array(off); let p = 0; for (const c of chunks) { out.set(c, p); p += c.length; }
  return out;
}

const colName = (i) => { let s = ""; i += 1; while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; };
const serial = (iso) => toDays(iso) + 25569;

/* sheets: [{ name, rows: [[cell]] }]. A cell is a string, a number, null, or { date: iso }. */
function workbook(sheets, deflateRaw) {
  const shared = [], at = new Map();
  const sid = (s) => { if (!at.has(s)) { at.set(s, shared.length); shared.push(s); } return at.get(s); };
  const sheetXml = sheets.map((sh) => {
    const rows = sh.rows.map((r, ri) => {
      const cells = r.map((c, ci) => {
        const ref = `${colName(ci)}${ri + 1}`;
        if (c == null || c === "") return "";
        if (typeof c === "number") return `<c r="${ref}"><v>${c}</v></c>`;
        if (c.date) return `<c r="${ref}" s="1"><v>${serial(c.date)}</v></c>`;
        return `<c r="${ref}" t="s"><v>${sid(String(c))}</v></c>`;
      }).join("");
      return `<row r="${ri + 1}">${cells}</row>`;
    }).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
  });
  const ss = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">${shared.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join("")}</sst>`;
  const entries = [
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="rId${sheets.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ["xl/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/><xf numFmtId="14" applyNumberFormat="1"/></cellXfs></styleSheet>`],
    ["xl/sharedStrings.xml", ss],
    ...sheetXml.map((x, i) => [`xl/worksheets/sheet${i + 1}.xml`, x]),
  ];
  return zip(entries, deflateRaw);
}

module.exports = { workbook, zip, serial };
