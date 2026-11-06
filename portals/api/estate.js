// The two connectors: /api/drive/<tool> and /api/mail/<tool>, rewritten here so they share one function. GET /api/drive and GET /api/mail say
// what is on offer. A browser's sign-in cookie works, and so does the token /api/login returns, as `Authorization: Bearer <token>`.
"use strict";
const { query, json, send, readBody } = require("../lib/http");
const { viewOf } = require("../lib/view");
const { driveFor, TOOLS: DRIVE } = require("../lib/drive");
const { mailFor, TOOLS: MAIL } = require("../lib/mail");
const Runs = require("../lib/runstore");
const Tabby = require("../lib/tabby");

const SURFACE = {
  drive: { brand: "litterbox", tools: DRIVE, make: driveFor, about: "Litterbox, the Davies family's fictional Drive. The same tools and arguments as a real Drive connector." },
  mail: { brand: "gmeow", tools: MAIL, make: mailFor, about: "Gmeow, the Davies family's fictional inbox. The same shape as a real mail connector. Mail reaches the household and Tabby Tax, and nothing leaves." },
};
const WRITES = new Set(["create_file", "send_message"]);

// Anyone can upload here, so only types a browser will not run open in the page. Everything else downloads.
const OPENS = new Set(["application/pdf", "image/png", "image/jpeg"]);
const hand = (res, name, type, bytes, wantFile) => {
  const shown = OPENS.has(type) && !wantFile;
  return send(res, 200, bytes, { "Content-Type": shown ? type : "application/octet-stream", "Content-Disposition": `${shown ? "inline" : "attachment"}; filename="${String(name).replace(/["\\\r\n]/g, "")}"`, "Content-Length": String(bytes.length), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
};

module.exports = async (req, res) => {
  const qs = query(req), surface = SURFACE[qs.surface];
  if (!surface) return json(res, 404, { error: "No such surface." });
  const tool = qs.tool || "";
  if (!tool) return json(res, 200, { about: surface.about, tools: surface.tools, sign_in: "POST /api/login with brand, name and password demo. Use the token it returns as a bearer token, or keep the cookie." });
  try {
    const view = viewOf(req, surface.brand);
    if (!view.name) return json(res, 401, { error: "Sign in first." });
    const api = surface.make(view);
    if (qs.surface === "drive" && tool === "open") { const i = await api.find(String(qs.fileId || "")); return hand(res, i.title, i.mimeType, api.bytesOf(i), qs.download); }
    if (qs.surface === "mail" && tool === "open") { const a = await api.attachmentOf({ messageId: qs.messageId, attachmentId: qs.attachmentId }); return hand(res, a.name, a.type, a.bytes, qs.download); }
    if (qs.surface === "mail" && tool === "practice_status") return json(res, 200, Tabby.status((await Runs.objects(view.run || "none", "mail")).filter(Tabby.isToPractice)));
    if (!surface.tools.includes(tool)) return json(res, 404, { error: `No such tool. Try one of: ${surface.tools.join(", ")}` });
    if (WRITES.has(tool) && req.method !== "POST") return json(res, 405, { error: `${tool} takes a POST.` });
    const args = req.method === "POST" ? await readBody(req) : qs;
    return json(res, 200, await api[tool](args));
  } catch (e) {
    if (e.status) return json(res, e.status, { error: e.message });
    throw e;
  }
};
