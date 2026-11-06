#!/usr/bin/env node
/* Is it real in a browser? The Davies world, Davies-sized, through the same Folder-store flow in Node and in Chromium. Prints load time, size and
   rebuild time, and fails unless both hosts write the same household.
     node tools/household-bundle.js && node tools/household-browser.js
   Needs the world (node standard/world/build.js) and Playwright, from portals/node_modules or KITTY_PLAYWRIGHT. */
"use strict";
const fs = require("fs"), path = require("path"), http = require("http");
const root = path.join(__dirname, "..");
const pw = process.env.KITTY_PLAYWRIGHT || path.join(root, "portals", "node_modules", "@playwright", "test");
const { chromium } = require(pw);
const K = require("../src/household/node.js");
const { loadWorld } = require("../src/household/world");

const TODAY = "2027-04-01", CLOSE = "2027-02";
async function flow(H, world, now) {
  const store = H.folderStore({ dir: "/kitty", fs: H.memfs() });
  const t0 = now(), r = await H.replayWorld(store, world, { today: TODAY, closeMonth: CLOSE });
  const t1 = now(), again = await H.rebuildAt(store);
  const t2 = now(), status = await H.status(store, { today: TODAY }), step = await H.next(store, { today: TODAY });
  return { bundle_hash: r.bundle_hash, rebuilt_hash: again.L.bundleHash, tree_hash: await H.treeHash(store), tables: await H.tableHashes(store), closed: r.closed.status, seal: r.closed.seal_hash, step: step.say, words: status.words, files: world.files.length, observations: again.L.observations.length, postings: again.L.postings.length, replay_ms: Math.round(t1 - t0), rebuild_ms: Math.round(t2 - t1) };
}
async function main() {
  const script = fs.readFileSync(path.join(root, "dist", "kitty-household.js")), world = loadWorld(path.join(root, "standard", ".build", "world"));
  const wire = JSON.stringify({ ...world, files: world.files.map((f) => ({ ...f, bytes: Buffer.from(f.bytes).toString("base64") })) });
  const server = http.createServer((req, res) => {
    if (req.url === "/kitty-household.js") { res.setHeader("content-type", "text/javascript"); return res.end(script); }
    if (req.url === "/world.json") { res.setHeader("content-type", "application/json"); return res.end(wire); }
    res.setHeader("content-type", "text/html"); res.end("<!doctype html><title>Kitty proof</title>");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch(), page = await browser.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const web = await page.evaluate(`(async () => {
    const t0 = performance.now();
    await new Promise((ok, no) => { const s = document.createElement("script"); s.src = "/kitty-household.js"; s.onload = ok; s.onerror = no; document.head.append(s); });
    const load_ms = Math.round(performance.now() - t0);
    const w = await (await fetch("/world.json")).json();
    for (const f of w.files) { const b = atob(f.bytes), a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); f.bytes = a; }
    const H = self.KittyHousehold;
    const store = H.folderStore({ dir: "/kitty", fs: H.memfs() });
    const t1 = performance.now(), r = await H.replayWorld(store, w, { today: ${JSON.stringify(TODAY)}, closeMonth: ${JSON.stringify(CLOSE)} });
    const t2 = performance.now(), again = await H.rebuildAt(store);
    const t3 = performance.now(), status = await H.status(store, { today: ${JSON.stringify(TODAY)} }), step = await H.next(store, { today: ${JSON.stringify(TODAY)} });
    return { load_ms, ua: navigator.userAgent, node_is_absent: typeof process === "undefined" && typeof require === "undefined", bundle_hash: r.bundle_hash, rebuilt_hash: again.L.bundleHash, tree_hash: await H.treeHash(store), tables: await H.tableHashes(store), closed: r.closed.status, seal: r.closed.seal_hash, step: step.say, words: status.words, files: w.files.length, observations: again.L.observations.length, postings: again.L.postings.length, replay_ms: Math.round(t2 - t1), rebuild_ms: Math.round(t3 - t2) };
  })()`);
  await browser.close(); server.close();
  const node = await flow(K, world, () => Number(process.hrtime.bigint()) / 1e6);
  const size = { script_bytes: script.length, gzipped: require("zlib").gzipSync(script).length, world_bytes: wire.length };
  const differ = Object.keys(node.tables).filter((t) => node.tables[t] !== web.tables[t]);
  const quiet = ({ tables, ...rest }) => rest;
  console.log(JSON.stringify({ size, node: quiet(node), browser: quiet(web), tables_that_differ: differ, errors }, null, 2));
  const same = ["bundle_hash", "rebuilt_hash", "tree_hash", "closed", "seal", "step", "observations", "postings"].filter((k) => node[k] !== web[k]);
  if (same.length || JSON.stringify(node.words) !== JSON.stringify(web.words) || errors.length || !web.node_is_absent) { console.error(`Node and the browser disagree on: ${same.join(", ") || "words or errors"}`); process.exit(1); }
  console.log(`Same household in Node and Chromium: bundle ${web.bundle_hash}, tree ${web.tree_hash}. Script ${(size.script_bytes / 1024).toFixed(0)} KB, loads in ${web.load_ms} ms, full replay ${web.replay_ms} ms, rebuild ${web.rebuild_ms} ms.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
