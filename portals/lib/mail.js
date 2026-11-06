// The inbox, with the same shape as a real mail connector: search_threads and get_thread, plus get_attachment. It is read-only, a browsable view
// of what arrived. Every read answers to the clock and the person.
"use strict";
const { readEstate, fileBytes } = require("./estate-files");
const { has } = require("./clock");

class MailError extends Error { constructor(status, message) { super(message); this.status = status; } }

const lower = (s) => String(s || "").toLowerCase();
const parseWords = (query) => {
  const out = [];
  for (const m of String(query || "").matchAll(/(-?)(?:(\w+):)?(?:"([^"]*)"|(\S+))/g)) out.push({ neg: m[1] === "-", op: m[2] ? lower(m[2]) : null, value: lower(m[3] != null ? m[3] : m[4]) });
  return out;
};
const dateOf = (v) => v.replace(/\//g, "-");
const matches = (m, w) => {
  const all = `${m.subject} ${m.body} ${m.from} ${m.to}`.toLowerCase();
  let hit;
  switch (w.op) {
    case null: hit = all.includes(w.value); break;
    case "from": hit = lower(m.from).includes(w.value); break;
    case "to": hit = lower(m.to).includes(w.value); break;
    case "subject": hit = lower(m.subject).includes(w.value); break;
    case "filename": hit = m.attachments.some((a) => lower(a.name).includes(w.value)); break;
    case "has": hit = w.value === "attachment" ? m.attachments.length > 0 : false; break;
    case "before": case "older": hit = m.date < dateOf(w.value); break;
    case "after": case "newer": hit = m.date >= dateOf(w.value); break;
    case "in": case "label": hit = w.value === "anywhere" || m.labels.map(lower).includes(w.value); break;
    case "category": hit = m.labels.map(lower).includes(`category_${w.value}`); break;
    default: throw new MailError(400, `Unknown search term: ${w.op}:`);
  }
  return w.neg ? !hit : hit;
};

class FakeMail {
  constructor(view) { this.view = view; }
  sees(m) { const v = this.view; return has(v, m.delivered_on) && (!v.person || m.people.includes(v.person.id)); }
  messages() { return readEstate("mail.json", this.view.family).messages.filter((m) => this.sees(m)); }
  row(m) { return { id: m.id, threadId: m.threadId, sender: m.from, toRecipients: [m.to], date: m.date, subject: m.subject, snippet: m.snippet, labelIds: m.labels, hasAttachment: m.attachments.length > 0 }; }
  full(m) { return { ...this.row(m), plaintextBody: m.body, attachments: m.attachments.map((a) => ({ id: a.id, filename: a.name, mimeType: a.type, size: a.size })) }; }
  search_threads({ query, pageSize, pageToken }) {
    const words = parseWords(query);
    const looksIn = words.some((w) => (w.op === "in" || w.op === "label") && !w.neg);
    const threads = new Map();
    for (const m of this.messages().filter((x) => (looksIn || !x.labels.includes("SPAM")) && words.every((w) => matches(x, w)))) { if (!threads.has(m.threadId)) threads.set(m.threadId, []); threads.get(m.threadId).push(m); }
    const list = [...threads.entries()].map(([, ms]) => ({ messageCount: ms.length, ...this.row(ms[0]) }));
    const size = Math.min(Math.max(Number(pageSize) || 20, 1), 50), start = Number(pageToken) || 0;
    return { threads: list.slice(start, start + size).map((t) => ({ ...t, id: t.threadId })), total: list.length, nextPageToken: start + size < list.length ? String(start + size) : undefined };
  }
  get_thread({ threadId }) {
    const ms = this.messages().filter((m) => m.threadId === threadId);
    if (!ms.length) throw new MailError(404, "Thread not found.");
    return { id: threadId, messages: ms.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).map((m) => this.full(m)) };
  }
  attachmentOf({ messageId, attachmentId }) {
    const m = this.messages().find((x) => x.id === messageId), a = m && m.attachments.find((x) => x.id === attachmentId);
    if (!a) throw new MailError(404, "Attachment not found.");
    return { name: a.name, type: a.type, bytes: fileBytes(a.path) };
  }
  get_attachment(args) { const a = this.attachmentOf(args); return { filename: a.name, mimeType: a.type, encoding: "base64", content: a.bytes.toString("base64") }; }
}

const mailFor = (view) => new FakeMail(view);
const TOOLS = ["search_threads", "get_thread", "get_attachment"];

module.exports = { mailFor, TOOLS, MailError };
