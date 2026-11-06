// The built estate: portals/estate/, written by build-vault.js and never committed. JSON here is read once and kept, unless the
// file changes under it, which only a rebuild during a test run does.
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "estate");
const HOW = "The estate is not built. From the repository root: node standard/world/build.js && node portals/build-vault.js";
class NotBuilt extends Error { constructor() { super(HOW); this.status = 503; } }

const cache = new Map();
const readEstate = (name) => {
  const file = path.join(ROOT, name);
  let stat;
  try { stat = fs.statSync(file); } catch { throw new NotBuilt(); }
  const hit = cache.get(file);
  if (hit && hit.mtimeMs === stat.mtimeMs) return hit.value;
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  cache.set(file, { mtimeMs: stat.mtimeMs, value });
  return value;
};

// Bytes by a path the index gave us. Only ever under estate/files.
const fileBytes = (rel) => {
  const file = path.normalize(path.join(ROOT, "files", rel));
  if (!file.startsWith(path.join(ROOT, "files") + path.sep)) throw new NotBuilt();
  return fs.readFileSync(file);
};

module.exports = { ROOT, NotBuilt, readEstate, fileBytes };
