// What a file says, as text. The Drive's fullText search and read_file_content use this, and so does the accountant. A scan has no
// text layer, so an image reads as nothing, the way it does until someone looks at it.
"use strict";
const zlib = require("zlib");
const Zip = require("./zip");
const Mime = require("./mime");

const latin = (buf) => buf.toString("latin1");

// Streams, inflated. Text runs in the order the page draws them, grouped into lines by their baseline.
const pdf = (buf) => {
  const raw = latin(buf), runs = [];
  const add = (x, y, s) => { if (s.trim()) runs.push({ x, y, s, page: runs.page || 0 }); };
  let page = 0;
  for (const m of raw.matchAll(/<<[^>]*?>>\s*stream\r?\n/g)) {
    const start = m.index + m[0].length, end = raw.indexOf("endstream", start);
    if (end < 0) continue;
    let body = buf.subarray(start, end);
    if (/FlateDecode/.test(m[0])) { try { body = zlib.inflateSync(body); } catch { continue; } }
    const ops = latin(body);
    if (!/\bTj\b|\bTJ\b/.test(ops)) continue;
    page += 1; runs.page = page;
    for (const t of ops.matchAll(/(-?[\d.]+)\s+(-?[\d.]+)\s+Tm\s*(?:\[?\s*)(?:<([0-9A-Fa-f]*)>|\(((?:\\.|[^\\)])*)\))\s*(?:\]\s*)?T[jJ]/g)) {
      const s = t[3] != null ? Buffer.from(t[3], "hex").toString("latin1") : t[4].replace(/\\([\\()])/g, "$1");
      add(Number(t[1]), Number(t[2]), s);
    }
  }
  const lines = [];
  const sorted = runs.filter((r) => !/^DEMO$/.test(r.s));
  const keys = new Map();
  for (const r of sorted) { const k = `${String(r.page).padStart(4, "0")}|${String(10000 - Math.round(r.y)).padStart(6, "0")}`; (keys.get(k) || keys.set(k, []).get(k)).push(r); }
  for (const k of [...keys.keys()].sort()) lines.push(keys.get(k).sort((a, b) => a.x - b.x).map((r) => r.s).join("  "));
  return lines.join("\n");
};

const xmlText = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const xlsx = (buf) => {
  const es = Zip.entries(buf);
  if (!es) return null;
  const get = (name) => { const e = es.find((x) => x.name === name); const b = e && Zip.read(buf, e); return b ? b.toString("utf8") : ""; };
  const shared = [...get("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => xmlText([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")));
  const sheets = es.filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name)).sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
  return sheets.map((e) => [...get(e.name).matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((r) => [...r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map((c) => {
    const v = (c[2] || "").match(/<v>([\s\S]*?)<\/v>/);
    if (!v) return "";
    return /t="s"/.test(c[1]) ? shared[Number(v[1])] || "" : xmlText(v[1]);
  }).join("\t")).join("\n")).join("\n\n");
};

const html = (s) => xmlText(s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<\/(tr|p|h\d|div|li)>/gi, "\n").replace(/<\/t[dh]>/gi, "\t").replace(/<[^>]+>/g, " ")).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

const eml = (buf) => { const m = Mime.parse(buf); return `From: ${m.from}\nTo: ${m.to}\nSubject: ${m.subject}\nDate: ${m.date}\n\n${m.text || html(m.html)}`; };

const textOf = (buf, name) => {
  const ext = String(name).toLowerCase().split(".").pop();
  if (ext === "pdf") return pdf(buf);
  if (ext === "xlsx") return xlsx(buf);
  if (ext === "html" || ext === "htm") return html(buf.toString("utf8"));
  if (ext === "eml") return eml(buf);
  if (ext === "zip") { const es = Zip.entries(buf); return es ? es.map((e) => e.name).join("\n") : null; }
  if (["png", "jpg", "jpeg", "gif", "heic"].includes(ext)) return null;
  if (["csv", "tsv", "json", "txt", "md", "qif", "ofx"].includes(ext)) return buf.toString("utf8");
  return null;
};

module.exports = { textOf };
