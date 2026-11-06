/* A household as a folder: the portable bundle (one JSONL per table, manifest.json) plus files/, content-addressed. fs is injected, so the same
   code runs on a disk, in a page and on a phone. Writes land whole or not at all: a replace goes through a temporary name, and a line cut off
   by a crash is ignored on read and trimmed before the next append. */
"use strict";
const { stableStringify } = require("../../../standard/engine/util");
const { openStore } = require("./port");
const { pkOf } = require("../tabs");

function folderAdapter({ dir, fs }) {
  const file = (t) => `${dir}/${t}.jsonl`, manifestFile = `${dir}/manifest.json`, files = `${dir}/files`;
  const whole = (p, body) => { fs.writeFileSync(`${p}.tmp`, body); fs.renameSync(`${p}.tmp`, p); };
  const text = (t) => (fs.existsSync(file(t)) ? fs.readFileSync(file(t), "utf8") : "");
  const body = (rows) => rows.map((r) => `${stableStringify(r)}\n`).join("");
  const parse = (s) => { const end = s.lastIndexOf("\n"); return end < 0 ? [] : s.slice(0, end).split("\n").filter(Boolean).map((l) => JSON.parse(l)); };
  const blobs = {
    async has(sha) { return fs.existsSync(`${files}/${sha}`); },
    async put(sha, bytes) { if (!fs.existsSync(`${files}/${sha}`)) { fs.mkdirSync(files, { recursive: true }); whole(`${files}/${sha}`, bytes); } },
    async get(sha) { return fs.existsSync(`${files}/${sha}`) ? new Uint8Array(fs.readFileSync(`${files}/${sha}`)) : null; },
  };
  return {
    kind: "folder", capabilities: { tables: true, blobs: true, hides_tabs: false, needs: ["fs"] }, blobs,
    async probe() {
      if (!fs.existsSync(dir)) return { empty: true, recognised: false, found: [] };
      const found = fs.readdirSync(dir).filter((n) => !n.startsWith("."));
      if (fs.existsSync(manifestFile)) { const m = JSON.parse(fs.readFileSync(manifestFile, "utf8")); if (m.standard_version) return { empty: false, recognised: true, found, manifest: m }; }
      return { empty: !found.length, recognised: false, found };
    },
    async create(tabs, manifest) {
      fs.mkdirSync(dir, { recursive: true });
      for (const t of tabs) fs.writeFileSync(file(t.table), "");
      whole(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
    },
    async read(table) { return parse(text(table)); },
    async keys(table) { const pk = pkOf(table); return parse(text(table)).map((r) => r[pk]); },
    async append(table, rows) {
      const s = text(table);
      if (s && !s.endsWith("\n")) whole(file(table), s.slice(0, s.lastIndexOf("\n") + 1));
      fs.appendFileSync(file(table), body(rows));
    },
    async write(table, rows) { whole(file(table), body(rows)); },
    async getManifest() { return JSON.parse(fs.readFileSync(manifestFile, "utf8")); },
    async putManifest(m) { whole(manifestFile, `${JSON.stringify(m, null, 2)}\n`); },
  };
}
const folderStore = (o) => openStore(folderAdapter(o));
module.exports = { folderStore, folderAdapter };
