// The read-only connectors, /api/drive/<tool> and /api/mail/<tool>, and the practice, /api/tabby/<tool>, rewritten here so they share one function.
// GET /api/drive, /api/mail and /api/tabby say what is on offer. A browser's sign-in cookie works, and so does the token /api/login returns, as
// `Authorization: Bearer <token>`. Nothing here writes anything anywhere.
"use strict";
const { query, json, send, readBody } = require("../lib/http");
const { viewOf } = require("../lib/view");
const { driveFor, TOOLS: DRIVE } = require("../lib/drive");
const { mailFor, TOOLS: MAIL } = require("../lib/mail");
const Tabby = require("../lib/tabby");

const practice = (view) => ({
  checklist: () => Tabby.checklist(view.family),
  message: ({ body, attachments, driveAttachments, state }) => {
    const drive = driveFor(view);
    const files = (attachments || []).map((a) => ({ name: String(a.filename || "attachment"), bytes: Buffer.from(String(a.content || ""), "base64") }));
    for (const id of driveAttachments || []) { const i = drive.find(String(id)); files.push({ name: i.title, bytes: drive.bytesOf(i) }); }
    return Tabby.answer({ body, attachments: files, state, family: view.family, sender: view.person ? view.person.first_name : view.name });
  },
});

const SURFACE = {
  drive: { brand: "litterbox", tools: DRIVE, make: driveFor, about: "Litterbox, the family's fictional Drive. Read-only. The same tools and arguments as a real Drive connector." },
  mail: { brand: "gmeow", tools: MAIL, make: mailFor, about: "Gmeow, the family's fictional inbox. Read-only. The same shape as a real mail connector." },
  tabby: { brand: "tabbytax", tools: ["checklist", "message"], make: practice, about: "Tabby Tax, a parody practice with a script. It stores nothing: send back the `state` from its last reply." },
};
const POSTS = new Set(["message"]);

// Only types a browser will not run open in the page. Everything else downloads.
const OPENS = new Set(["application/pdf", "image/png", "image/jpeg"]);
const hand = (res, name, type, bytes, wantFile) => {
  const shown = OPENS.has(type) && !wantFile;
  return send(res, 200, bytes, { "Content-Type": shown ? type : "application/octet-stream", "Content-Disposition": `${shown ? "inline" : "attachment"}; filename="${String(name).replace(/["\\\r\n]/g, "")}"`, "Content-Length": String(bytes.length), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
};

module.exports = async (req, res) => {
  const qs = query(req), surface = SURFACE[qs.surface];
  if (!surface) return json(res, 404, { error: "No such surface." });
  const tool = qs.tool || "";
  if (!tool) return json(res, 200, { about: surface.about, tools: surface.tools, sign_in: "POST /api/login with a brand and a person. Use the token it returns as a bearer token, or keep the cookie." });
  try {
    const view = viewOf(req, surface.brand);
    if (!view.name) return json(res, 401, { error: "Sign in first." });
    const api = surface.make(view);
    if (qs.surface === "drive" && tool === "open") { const i = api.find(String(qs.fileId || "")); return hand(res, i.title, i.mimeType, api.bytesOf(i), qs.download); }
    if (qs.surface === "mail" && tool === "open") { const a = api.attachmentOf({ messageId: qs.messageId, attachmentId: qs.attachmentId }); return hand(res, a.name, a.type, a.bytes, qs.download); }
    if (!surface.tools.includes(tool)) return json(res, 404, { error: `No such tool. Try one of: ${surface.tools.join(", ")}` });
    if (POSTS.has(tool) && req.method !== "POST") return json(res, 405, { error: `${tool} takes a POST.` });
    return json(res, 200, api[tool](req.method === "POST" ? await readBody(req) : qs));
  } catch (e) {
    if (e.status) return json(res, e.status, { error: e.message });
    throw e;
  }
};
