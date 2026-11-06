#!/usr/bin/env node
/* dist/ over http, for the page tests. A page opened from a file has no real origin, and a person's page has one. */
"use strict";
const http = require("http"), fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..", "..", "dist"), port = Number(process.env.PORT || 4188);
http.createServer((req, res) => {
  const file = path.join(root, path.normalize(decodeURIComponent(req.url.split("?")[0])));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end("not found"); }
  res.setHeader("content-type", file.endsWith(".html") ? "text/html; charset=utf-8" : "text/plain"); fs.createReadStream(file).pipe(res);
}).listen(port, "127.0.0.1");
