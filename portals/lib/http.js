// Framework-neutral request and response helpers. The functions in api/ use only these plus Node's http
// objects, so the same files run under Vercel's Node runtime and under server.js in the Playwright job.
"use strict";

const query = (req) => Object.fromEntries(new URL(req.url, "http://localhost").searchParams);

const cookies = (req) => {
  const out = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
};

const readBody = async (req) => {
  if (req.body !== undefined) {
    if (typeof req.body === "string") return parseBody(req.headers["content-type"], req.body);
    if (Buffer.isBuffer(req.body)) return parseBody(req.headers["content-type"], req.body.toString("utf8"));
    return req.body;
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return parseBody(req.headers["content-type"], Buffer.concat(chunks).toString("utf8"));
};

const parseBody = (type, text) => {
  if (!text) return {};
  if (/json/.test(type || "")) { try { return JSON.parse(text); } catch { return {}; } }
  return Object.fromEntries(new URLSearchParams(text));
};

const send = (res, status, body, headers = {}) => {
  res.statusCode = status;
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(body);
};

const json = (res, status, obj) => send(res, status, JSON.stringify(obj), { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });

const redirect = (res, to) => send(res, 303, "", { Location: to, "Cache-Control": "no-store" });

const attachment = (res, filename, body, type) => send(res, 200, Buffer.from(body), {
  "Content-Type": type, "Content-Disposition": `attachment; filename="${filename.replace(/["\\\r\n]/g, "")}"`,
  "Content-Length": String(Buffer.byteLength(body)), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
});

const wantsJson = (req) => /json/.test(req.headers["content-type"] || "") || /application\/json/.test(req.headers.accept || "");

const secure = (req) => (req.headers["x-forwarded-proto"] || "").split(",")[0] === "https";

module.exports = { query, cookies, readBody, send, json, redirect, attachment, wantsJson, secure };
