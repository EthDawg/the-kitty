// The inbox, with the same shape as a real mail connector: search_threads, get_thread, send_message, plus get_attachment. The family's
// mail lives in estate/mail.json; what a run sends and receives lives in lib/runstore.js. Nothing here leaves the fictional world: mail goes
// to the household and to Tabby Tax, and anything else bounces. Every read answers to the clock and the person.
"use strict";
const crypto = require("crypto");
const { readEstate, fileBytes } = require("./estate-files");
const Runs = require("./runstore");
const { has } = require("./clock");
const { today } = require("./data");
const { driveFor } = require("./drive");
const Tabby = require("./tabby");

class MailError extends Error { constructor(status, message) { super(message); this.status = status; } }
const MAX_MESSAGE = 3.4 * 1024 * 1024;

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
  sees(m) { const v = this.view; return has(v, m.exists_from) && (!v.person || m.people.includes(v.person.id)); }
  async messages() {
    const added = this.view.run ? await Runs.objects(this.view.run, "mail") : [];
    return [...added, ...readEstate("mail.json").messages].filter((m) => this.sees(m));
  }
  row(m) { return { id: m.id, threadId: m.threadId, sender: m.from, toRecipients: [m.to], date: m.date, subject: m.subject, snippet: m.snippet, labelIds: m.labels, hasAttachment: m.attachments.length > 0 }; }
  full(m) { return { ...this.row(m), plaintextBody: m.body, attachments: m.attachments.map((a) => ({ id: a.id, filename: a.name, mimeType: a.type, size: a.size })) }; }
  async search_threads({ query, pageSize, pageToken }) {
    const words = parseWords(query);
    const looksIn = words.some((w) => (w.op === "in" || w.op === "label") && !w.neg);
    const rows = (await this.messages()).filter((m) => (looksIn || !m.labels.includes("SPAM")) && words.every((w) => matches(m, w)));
    const threads = new Map();
    for (const m of rows) { if (!threads.has(m.threadId)) threads.set(m.threadId, []); threads.get(m.threadId).push(m); }
    const list = [...threads.entries()].map(([id, ms]) => ({ id, messageCount: ms.length, ...this.row(ms[0]) }));
    const size = Math.min(Math.max(Number(pageSize) || 20, 1), 50), start = Number(pageToken) || 0;
    return { threads: list.slice(start, start + size).map((t) => ({ ...t, id: t.threadId })), total: list.length, nextPageToken: start + size < list.length ? String(start + size) : undefined };
  }
  async get_thread({ threadId }) {
    const ms = (await this.messages()).filter((m) => m.threadId === threadId);
    if (!ms.length) throw new MailError(404, "Thread not found.");
    return { id: threadId, messages: ms.sort((a, b) => (a.date === b.date ? (a.seq || 0) - (b.seq || 0) : a.date < b.date ? -1 : 1)).map((m) => this.full(m)) };
  }
  async attachmentOf({ messageId, attachmentId }) {
    const m = (await this.messages()).find((x) => x.id === messageId);
    const a = m && m.attachments.find((x) => x.id === attachmentId);
    if (!a) throw new MailError(404, "Attachment not found.");
    return { name: a.name, type: a.type, bytes: a.base64 != null ? Buffer.from(a.base64, "base64") : fileBytes(a.path) };
  }
  async get_attachment(args) { const a = await this.attachmentOf(args); return { filename: a.name, mimeType: a.type, encoding: "base64", content: a.bytes.toString("base64") }; }

  async send_message({ to, subject, body, attachments, driveAttachments, replyThreadId }) {
    const v = this.view, list = [to].flat().filter(Boolean).map(String);
    if (!list.length) throw new MailError(400, "A message needs someone to go to.");
    const files = [];
    for (const a of attachments || []) files.push({ name: String(a.filename || "attachment"), type: a.mimeType || "application/octet-stream", bytes: Buffer.from(String(a.content || ""), "base64") });
    const drive = driveFor(v);
    for (const id of driveAttachments || []) { const i = await drive.find(String(id)).catch(() => { throw new MailError(404, `No such Drive file: ${id}`); }); files.push({ name: i.title, type: i.mimeType, bytes: drive.bytesOf(i) }); }
    if (files.reduce((n, f) => n + f.bytes.length, 0) > MAX_MESSAGE) throw new MailError(413, "That message is too big for this demo. The limit is 3.4 MB: send it in parts.");
    const id = `m_${crypto.randomBytes(8).toString("hex")}`, threadId = replyThreadId ? String(replyThreadId) : `t_${id.slice(2)}`, now = v.as_of || today;
    const who = v.person ? v.person : null;
    const from = who ? `${who.full_name} <${readEstate("mail.json").mailbox}>` : `${v.name} <${readEstate("mail.json").mailbox}>`;
    const text = String(body || "");
    const sent = { id, threadId, seq: Date.now(), from, to: list.join(", "), subject: String(subject || ""), date: now, exists_from: now, people: who ? [who.id] : ["danny", "daisy"], labels: ["SENT"], snippet: text.replace(/\s+/g, " ").slice(0, 120), body: text,
      attachments: files.map((f, n) => ({ id: `${id}.${n}`, name: f.name, type: f.type, size: f.bytes.length, sha256: crypto.createHash("sha256").update(f.bytes).digest("hex"), base64: f.bytes.toString("base64") })) };
    const household = /the\.davies@|danny|daisy|jordan|mia/i;
    if (list.every((a) => household.test(a))) sent.people = ["danny", "daisy"];
    await Runs.add(v.run, "mail", id, sent);
    const reply = (m) => Runs.add(v.run, "mail", m.id, m);
    const earlier = (await Runs.objects(v.run, "mail")).filter((m) => Tabby.isToPractice(m));
    if (list.some(Tabby.isPractice)) await reply(Tabby.answer({ sent, earlier, view: v, now }));
    else if (!list.every((a) => household.test(a))) await reply(bounce(sent, now));
    return { id, threadId, labelIds: sent.labels };
  }
}

const bounce = (sent, now) => {
  const id = `m_${crypto.randomBytes(8).toString("hex")}`;
  const body = `Your message to ${sent.to} was not delivered. This is a fictional mail system: it delivers to the household and to Tabby Tax, and nothing leaves it.`;
  return { id, threadId: sent.threadId, seq: Date.now() + 1, from: "Mail Delivery <mailer-daemon@mail.example>", to: sent.from, subject: `Undeliverable: ${sent.subject}`, date: now, exists_from: now, people: sent.people, labels: ["INBOX"], snippet: body.slice(0, 120), body, attachments: [] };
};

const mailFor = (view) => new FakeMail(view);
const TOOLS = ["search_threads", "get_thread", "get_attachment", "send_message"];

module.exports = { mailFor, TOOLS, MailError };
