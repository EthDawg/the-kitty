// A Drive with the same shape as a real Drive connector: search_files, read_file_content, download_file_content, create_file,
// get_file_metadata and list_recent_files, the same arguments and the same query language. An agent uses it the way it would use the
// real thing, and a real demo Google or Microsoft account is a new class behind driveFor(), nothing else. The family's files live in
// estate/drive.json; what a run adds lives in lib/runstore.js. Every read answers to the clock and the person.
"use strict";
const crypto = require("crypto");
const { readEstate, fileBytes } = require("./estate-files");
const Runs = require("./runstore");
const { has } = require("./clock");
const { textOf } = require("./read");
const { parseQuery } = require("./drive-query");
const { today } = require("./data");

const FOLDER = "application/vnd.google-apps.folder";
const MAX_BYTES = 3.4 * 1024 * 1024; // a Vercel function takes 4.5 MB, and base64 adds a third
class DriveError extends Error { constructor(status, message) { super(message); this.status = status; } }

const rfc = (d) => (d && d.length === 10 ? `${d}T09:00:00Z` : d);
const fullName = (id) => { const p = readEstate("people.json").people.find((x) => x.id === id); return p ? `${p.first_name} ${p.family_name}` : id; };

class FakeDrive {
  constructor(view) { this.view = view; }
  sees(item) { const v = this.view; return has(v, item.exists_from || item.createdTime) && (!v.person || item.people.includes(v.person.id)); }
  async items() {
    const d = readEstate("drive.json");
    const added = this.view.run ? await Runs.objects(this.view.run, "drive") : [];
    return [...d.folders, ...d.files, ...added].filter((i) => this.sees(i));
  }
  file(i) {
    const out = { id: i.id, title: i.title, mimeType: i.mimeType, parentId: i.parentId, createdTime: rfc(i.createdTime), modifiedTime: rfc(i.modifiedTime || i.createdTime), owner: fullName(i.owner), trashed: false, viewUrl: `/litterbox#/file/${i.id}` };
    if (i.mimeType !== FOLDER) out.fileSize = i.size;
    return out;
  }
  textOfItem(i) {
    if (i.mimeType === FOLDER) return null;
    if (i.base64 != null) return textOf(Buffer.from(i.base64, "base64"), i.title);
    const t = readEstate("text.json")[i.sha256];
    return t === undefined ? null : t;
  }
  async find(fileId) {
    const hit = (await this.items()).find((i) => i.id === fileId);
    if (!hit) throw new DriveError(404, "File not found.");
    return hit;
  }
  bytesOf(i) {
    if (i.mimeType === FOLDER) throw new DriveError(400, "A folder has no content.");
    return i.base64 != null ? Buffer.from(i.base64, "base64") : fileBytes(i.path);
  }
  page(rows, { pageSize, pageToken }) {
    const size = Math.min(Math.max(Number(pageSize) || 20, 1), 100), start = Number(pageToken) || 0;
    const slice = rows.slice(start, start + size);
    return { rows: slice, nextPageToken: start + size < rows.length ? String(start + size) : undefined };
  }
  // ---- the connector's tools
  async search_files({ query, pageSize, pageToken, excludeContentSnippets }) {
    const test = parseQuery(query, this.view);
    const hits = (await this.items()).filter((i) => test(i, this.textOfItem(i))).sort((a, b) => ((a.modifiedTime || a.createdTime) < (b.modifiedTime || b.createdTime) ? 1 : -1));
    const { rows, nextPageToken } = this.page(hits, { pageSize, pageToken });
    return { files: rows.map((i) => { const f = this.file(i); if (!excludeContentSnippets) { const t = this.textOfItem(i); if (t) f.contentSnippet = t.replace(/\s+/g, " ").slice(0, 1000); } return f; }), nextPageToken };
  }
  async list_recent_files({ pageSize, pageToken }) {
    const hits = (await this.items()).filter((i) => i.mimeType !== FOLDER).sort((a, b) => ((a.modifiedTime || a.createdTime) < (b.modifiedTime || b.createdTime) ? 1 : -1));
    const { rows, nextPageToken } = this.page(hits, { pageSize: pageSize || 10, pageToken });
    return { files: rows.map((i) => this.file(i)), nextPageToken };
  }
  async get_file_metadata({ fileId }) { return this.file(await this.find(fileId)); }
  async read_file_content({ fileId }) {
    const i = await this.find(fileId);
    const text = this.textOfItem(i);
    return { fileId, title: i.title, mimeType: i.mimeType, content: text && text.trim() ? text : "[No text here. This file is an image or a scan with no text layer: download it and look at it.]" };
  }
  async download_file_content({ fileId }) {
    const i = await this.find(fileId);
    return { fileId, title: i.title, mimeType: i.mimeType, content: this.bytesOf(i).toString("base64"), encoding: "base64" };
  }
  async create_file({ title, parentId, textContent, base64Content, contentMimeType, mimeType }) {
    const name = String(title || "").trim().slice(0, 200);
    if (!name) throw new DriveError(400, "A file needs a title.");
    if (textContent != null && base64Content != null) throw new DriveError(400, "Send textContent or base64Content, not both.");
    const isFolder = (contentMimeType || mimeType) === FOLDER;
    const parent = String(parentId || "root");
    const within = parent === "root" ? null : (await this.items()).find((i) => i.id === parent && i.mimeType === FOLDER);
    if (parent !== "root" && !within) throw new DriveError(404, "That folder was not found.");
    const bytes = isFolder ? Buffer.alloc(0) : base64Content != null ? Buffer.from(String(base64Content), "base64") : Buffer.from(String(textContent == null ? "" : textContent), "utf8");
    if (bytes.length > MAX_BYTES) throw new DriveError(413, "That file is too big for this demo. The limit is 3.4 MB.");
    const v = this.view, now = v.as_of || today;
    const row = { id: `f_${crypto.randomBytes(8).toString("hex")}`, title: name, parentId: parent, mimeType: isFolder ? FOLDER : contentMimeType || mimeType || "application/octet-stream", people: within ? within.people : v.person ? [v.person.id] : ["danny", "daisy"], owner: v.person ? v.person.id : "daisy", createdTime: now, modifiedTime: now, exists_from: now, size: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex"), base64: isFolder ? undefined : bytes.toString("base64"), source: name };
    await Runs.add(v.run, "drive", row.id, row);
    return this.file(row);
  }
}

const driveFor = (view) => new FakeDrive(view);
const TOOLS = ["search_files", "list_recent_files", "get_file_metadata", "read_file_content", "download_file_content", "create_file"];

module.exports = { driveFor, TOOLS, DriveError, FOLDER };
