// What a run writes: uploads, new files, mail sent and received. The estate itself never changes, so two runs cannot see each other's
// writes. Each write is one object that is never changed, which suits a store with no transactions. On Vercel that store is Vercel Blob
// when BLOB_READ_WRITE_TOKEN is set; without it, and in a checkout, it is a folder. /tmp does not survive a cold start, so a deployment
// without the token forgets. Fictional data only: the pages say so.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");

const MAX_OBJECTS = 200;

const folder = () => {
  const root = process.env.KITTY_RUNS || path.join(os.tmpdir(), "kitty-portals-runs");
  return {
    name: "folder",
    put: async (key, value) => { const f = path.join(root, key); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(value)); },
    list: async (prefix) => {
      const dir = path.join(root, prefix);
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir).sort().map((n) => JSON.parse(fs.readFileSync(path.join(dir, n), "utf8")));
    },
  };
};

const blob = () => {
  const api = require("@vercel/blob");
  const seen = new Map(); // objects never change, so a read once is good for the life of the instance
  return {
    name: "blob",
    put: async (key, value) => { await api.put(key, JSON.stringify(value), { access: "public", contentType: "application/json", addRandomSuffix: false, cacheControlMaxAge: 3600 }); seen.set(key, value); },
    list: async (prefix) => {
      const { blobs } = await api.list({ prefix: `${prefix}/`, limit: 1000 });
      const out = [];
      for (const b of blobs.sort((x, y) => (x.pathname < y.pathname ? -1 : 1))) {
        if (!seen.has(b.pathname)) seen.set(b.pathname, await (await fetch(b.url)).json());
        out.push(seen.get(b.pathname));
      }
      return out;
    },
  };
};

const store = process.env.BLOB_READ_WRITE_TOKEN ? blob() : folder();
const safe = (s) => String(s).replace(/[^\w-]/g, "");

const objects = (run, kind) => store.list(`runs/${safe(run)}/${safe(kind)}`);
const add = async (run, kind, id, value) => {
  if (process.env.ESTATE_WRITES === "off") { const e = new Error("Writes are off on this deployment."); e.status = 403; throw e; }
  if (!run) { const e = new Error("Sign in again to start a run."); e.status = 401; throw e; }
  if ((await objects(run, kind)).length >= MAX_OBJECTS) { const e = new Error(`This run has reached its limit of ${MAX_OBJECTS}.`); e.status = 429; throw e; }
  const key = `runs/${safe(run)}/${safe(kind)}/${String(Date.now()).padStart(14, "0")}-${safe(id)}.json`;
  await store.put(key, value);
  return value;
};

module.exports = { objects, add, backend: store.name };
