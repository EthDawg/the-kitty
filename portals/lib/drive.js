// A Drive with the same shape as a real Drive connector: search_files, read_file_content, download_file_content, get_file_metadata and
// list_recent_files, the same arguments and the same query language. It is read-only, a browsable view of what the family kept: the writable
// fake Drive is a Folder store in the test harness, and a real demo Google or Microsoft account is a new class behind driveFor(). Every read
// answers to the clock and the person.
"use strict";
const { readEstate, fileBytes } = require("./estate-files");
const { has } = require("./clock");
const { parseQuery } = require("./drive-query");
const { peopleOf } = require("./families");

const FOLDER = "application/vnd.google-apps.folder";
class DriveError extends Error { constructor(status, message) { super(message); this.status = status; } }

const rfc = (d) => (d && d.length === 10 ? `${d}T09:00:00Z` : d);

class FakeDrive {
  constructor(view) { this.view = view; }
  sees(item) { const v = this.view; return has(v, item.delivered_on || item.createdTime) && (!v.person || item.people.includes(v.person.id)); }
  items() { const d = readEstate("drive.json", this.view.family); return [...d.folders, ...d.files].filter((i) => this.sees(i)); }
  ownerName(id) { const p = peopleOf(this.view.family).find((x) => x.id === id); return p ? p.full_name : id; }
  file(i) {
    const out = { id: i.id, title: i.title, mimeType: i.mimeType, parentId: i.parentId, createdTime: rfc(i.createdTime), modifiedTime: rfc(i.modifiedTime || i.createdTime), owner: this.ownerName(i.owner), trashed: false, viewUrl: `/litterbox#/file/${i.id}` };
    if (i.mimeType !== FOLDER) out.fileSize = i.size;
    return out;
  }
  textOfItem(i) {
    if (i.mimeType === FOLDER) return null;
    const t = readEstate("text.json", this.view.family)[i.sha256];
    return t === undefined ? null : t;
  }
  find(fileId) {
    const hit = this.items().find((i) => i.id === fileId);
    if (!hit) throw new DriveError(404, "File not found.");
    return hit;
  }
  bytesOf(i) {
    if (i.mimeType === FOLDER) throw new DriveError(400, "A folder has no content.");
    return fileBytes(i.path);
  }
  page(rows, { pageSize, pageToken }) {
    const size = Math.min(Math.max(Number(pageSize) || 20, 1), 100), start = Number(pageToken) || 0;
    return { rows: rows.slice(start, start + size), nextPageToken: start + size < rows.length ? String(start + size) : undefined };
  }
  newest(a, b) { return (a.modifiedTime || a.createdTime) < (b.modifiedTime || b.createdTime) ? 1 : -1; }
  // ---- the connector's tools
  search_files({ query, pageSize, pageToken, excludeContentSnippets }) {
    const test = parseQuery(query, this.view);
    const { rows, nextPageToken } = this.page(this.items().filter((i) => test(i, this.textOfItem(i))).sort(this.newest), { pageSize, pageToken });
    const skip = excludeContentSnippets === true || excludeContentSnippets === "true";
    return { files: rows.map((i) => { const f = this.file(i); if (!skip) { const t = this.textOfItem(i); if (t) f.contentSnippet = t.replace(/\s+/g, " ").slice(0, 1000); } return f; }), nextPageToken };
  }
  list_recent_files({ pageSize, pageToken }) {
    const { rows, nextPageToken } = this.page(this.items().filter((i) => i.mimeType !== FOLDER).sort(this.newest), { pageSize: pageSize || 10, pageToken });
    return { files: rows.map((i) => this.file(i)), nextPageToken };
  }
  get_file_metadata({ fileId }) { return this.file(this.find(fileId)); }
  read_file_content({ fileId }) {
    const i = this.find(fileId), text = this.textOfItem(i);
    return { fileId, title: i.title, mimeType: i.mimeType, content: text && text.trim() ? text : "[No text here. This file is an image or a scan with no text layer: download it and look at it.]" };
  }
  download_file_content({ fileId }) {
    const i = this.find(fileId);
    return { fileId, title: i.title, mimeType: i.mimeType, content: this.bytesOf(i).toString("base64"), encoding: "base64" };
  }
}

const driveFor = (view) => new FakeDrive(view);
const TOOLS = ["search_files", "list_recent_files", "get_file_metadata", "read_file_content", "download_file_content"];

module.exports = { driveFor, TOOLS, DriveError, FOLDER };
