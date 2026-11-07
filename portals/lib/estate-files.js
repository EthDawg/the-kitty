// The built estate. Per family, estate/<family>/ holds the listings (vault, Drive, inbox, text, truth), never committed. The files themselves
// are static, in public/vault/. JSON here is read once and kept, unless the file changes under it, which only a rebuild during a test run does.
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "estate");
const PUBLIC = path.join(__dirname, "..", "public");
const HOW = "The estate is not built. From the repository root: node standard/world/build.js && node portals/build-vault.js";
class NotBuilt extends Error { constructor() { super(HOW); this.status = 503; } }

const cache = new Map();
// A family's file, or a file about all of them.
const readEstate = (name, family) => {
  const file = family ? path.join(ROOT, family, name) : path.join(ROOT, name);
  let stat;
  try { stat = fs.statSync(file); } catch { throw new NotBuilt(); }
  const hit = cache.get(file);
  if (hit && hit.mtimeMs === stat.mtimeMs) return hit.value;
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  cache.set(file, { mtimeMs: stat.mtimeMs, value });
  return value;
};

// Bytes by a path an index gave us. Only ever under public/vault.
const fileBytes = (rel) => {
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(path.join(PUBLIC, "vault") + path.sep)) throw new NotBuilt();
  return fs.readFileSync(file);
};

module.exports = { ROOT, NotBuilt, readEstate, fileBytes };
