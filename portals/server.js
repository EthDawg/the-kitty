// A small local server that mounts the same four functions Vercel does, with the same rewrites, so the
// Playwright job and a laptop run the exact code that is deployed. `node server.js` then open :4173.
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");

const PUBLIC = path.join(__dirname, "public");
const BRANDS = new Set(require("./public/brands.json").map((b) => b.id));
const API = { login: require("./api/login"), logout: require("./api/logout"), accounts: require("./api/accounts"), export: require("./api/export") };
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8" };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (url.pathname.startsWith("/api/")) {
      const fn = API[url.pathname.slice(5).replace(/\/$/, "")];
      if (!fn) { res.statusCode = 404; return res.end("no such function"); }
      return await fn(req, res);
    }
    let p = url.pathname;
    if (BRANDS.has(p.replace(/^\/|\/$/g, ""))) p = "/portal.html"; // the rewrite in vercel.json
    if (p === "/") p = "/index.html";
    else if (!path.extname(p) && fs.existsSync(path.join(PUBLIC, p + ".html"))) p += ".html"; // cleanUrls
    const file = path.normalize(path.join(PUBLIC, p));
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; res.setHeader("Content-Type", "text/plain"); return res.end("not found"); }
    res.setHeader("Content-Type", MIME[path.extname(file)] || "application/octet-stream");
    res.setHeader("Cache-Control", "no-store");
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    console.error(e);
    res.statusCode = 500; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ error: "server error" }));
  }
});

const port = Number(process.env.PORT || 4173);
server.listen(port, "127.0.0.1", () => console.log(`portals on http://127.0.0.1:${port}`));
