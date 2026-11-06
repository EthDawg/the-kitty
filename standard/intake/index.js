/* ingest: bytes in, sources and observations out. ingestFiles is pure and runs anywhere; only ingest({root}) walks a disk, and only hostInflate
   touches zlib. No per-institution code: a file finds its recipe by fingerprint. */
"use strict";
const { decode, sniff } = require("./containers");
const { fingerprint } = require("./fingerprint");
const { run, matches } = require("./recipe");
const { gate } = require("./gate");
const { sha256 } = require("./sha256");

const MIME = { pdf: "application/pdf", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ofx: "application/x-ofx", qif: "application/qif", eml: "message/rfc822", html: "text/html", json: "application/json", csv: "text/csv", tsv: "text/tab-separated-values", image: "image/png" };

function recipeIndex(recipes) {
  const by = new Map();
  for (const r of recipes) for (const fp of r.fingerprints || []) { if (!by.has(fp)) by.set(fp, []); by.get(fp).push(r); }
  return by;
}

/* files: [{ path, bytes, stream, download_date, name }]. opts: { recipes, vocab, inflate, manifest } */
function ingestFiles(files, opts) {
  const index = recipeIndex(opts.recipes), bySha = new Map(), sources = [], observations = [], faults = [], unknown = [], log = [];
  const facts = new Map(((opts.manifest && opts.manifest.files) || []).map((m) => [m.path, m]));
  const ordered = files.slice().sort((a, b) => (a.path < b.path ? -1 : 1));
  for (const f of ordered) {
    const sha = sha256(f.bytes), m = facts.get(f.path) || {};
    if (bySha.has(sha)) { const s = bySha.get(sha); log.push({ path: f.path, source_id: s.source_id, duplicate_of: s.uri, observations: 0 }); continue; }
    let d;
    try { d = decode(f.bytes, { inflate: opts.inflate }); } catch (e) { faults.push({ path: f.path, code: "undecodable", what: String(e.message) }); unknown.push({ path: f.path, reason: "undecodable" }); continue; }
    const container = (d.meta && d.meta.container) || sniff(f.bytes), source_id = `src-${sha.slice(0, 16)}`;
    const src = { source_id, sha256: sha, name: f.name, uri: f.path, origin: m.origin || (container === "eml" ? "email" : container === "image" ? "scan" : "portal"), mime: MIME[container] || "application/octet-stream", bytes: f.bytes.length, stream_id: f.stream || null, issued_on: m.issued_on || null, captured_at: `${f.download_date || "1970-01-01"}T00:00:00Z`, status: "active" };
    bySha.set(sha, src); sources.push(src);
    const fp = fingerprint(d);
    const entry = { path: f.path, source_id, fingerprint: fp, container, recipe: null, observations: 0 };
    log.push(entry);
    if (container === "image") { unknown.push({ path: f.path, reason: "agent_tier", detail: "an image with no text layer", fingerprint: fp }); continue; }
    const cand = (index.get(fp) || []).filter((r) => matches(r, d));
    if (!cand.length) { unknown.push({ path: f.path, reason: "no_recipe", fingerprint: fp, container }); continue; }
    const recipe = cand[0];
    entry.recipe = recipe.id;
    let a = run(recipe, d, { vocab: opts.vocab, stream: f.stream });
    // A bank can flip its row order. If the chain fails one way and holds the other, the file is read the way that proves.
    if (a.controls.some((c) => !c.pass) && recipe.table && recipe.table.order && recipe.table.order !== "any") {
      const flipped = { ...recipe, table: { ...recipe.table, order: recipe.table.order === "newest_first" ? "oldest_first" : "newest_first" } };
      const b = run(flipped, d, { vocab: opts.vocab, stream: f.stream });
      if (b.controls.every((c) => c.pass) && !b.faults.length) a = b;
    }
    // A file that fails its own controls, or whose dates cannot be in the order it delivered them, is refused whole. SPEC 7.2.
    const stamped = a.observations.filter((o) => o.kind === "txn_line" || o.kind === "super_line").map((o) => o.payload.posting_date).filter(Boolean);
    const up = stamped.every((x, i) => i === 0 || stamped[i - 1] <= x), down = stamped.every((x, i) => i === 0 || stamped[i - 1] >= x);
    const orderBad = stamped.length > 2 && !up && !down && !(recipe.table && recipe.table.order === "any");
    const refused = a.faults.length || a.unconsumed.length || a.controls.some((c) => !c.pass) || orderBad;
    if (orderBad) a.faults.push({ code: "date_order", what: "Dates run neither forwards nor backwards. The date format may have changed." });
    if (refused) { src.status = "quarantined"; a.refused = true; }
    else a.observations.forEach((o, i) => {
      const obs_id = `obs-${sha256(new TextEncoder().encode(`${sha}|${o.kind}|${o.locator}|${i}`)).slice(0, 20)}`;
      observations.push({ obs_id, source_id, ...o });
    });
    if (refused) faults.push({ path: f.path, code: "file_refused", what: `${f.name} failed its checks and was not imported.` });
    entry.observations = a.observations.length; entry.by_kind = {}; for (const o of a.observations) entry.by_kind[o.kind] = (entry.by_kind[o.kind] || 0) + 1;
    for (const x of a.faults) faults.push({ path: f.path, ...x });
    for (const u of a.unconsumed) faults.push({ path: f.path, code: "row_not_consumed", ...u });
    for (const c of a.controls) if (!c.pass) faults.push({ path: f.path, code: "control_failed", what: JSON.stringify(c) });
  }
  return { sources, observations, faults, unknown_files: unknown, files: log };
}

// ---------- host level: the disk and zlib ----------
function hostInflate() { const zlib = require("zlib"); return (b, raw) => new Uint8Array(raw ? zlib.inflateRawSync(b) : zlib.inflateSync(b)); }

function walkRoot(root) {
  const fs = require("fs"), path = require("path"); const out = [];
  const base = fs.existsSync(path.join(root, "sources")) ? path.join(root, "sources") : root;
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (!e.name.startsWith(".")) out.push(p); } };
  walk(base);
  return out.map((p) => { const rel = path.relative(base, p).split(path.sep); return { path: path.relative(root, p).split(path.sep).join("/"), stream: rel.length >= 3 ? rel[0] : null, download_date: rel.length >= 3 ? rel[1] : null, name: rel[rel.length - 1], bytes: new Uint8Array(fs.readFileSync(p)) }; });
}

function loadRecipes(dir) {
  const fs = require("fs"), path = require("path");
  return fs.readdirSync(dir).filter((n) => n.endsWith(".json")).sort().map((n) => JSON.parse(fs.readFileSync(path.join(dir, n), "utf8")));
}
const loadVocab = () => require("../schema/observations.json");

function ingest({ root, recipes, manifest }) { return ingestFiles(walkRoot(root), { recipes, manifest, vocab: loadVocab(), inflate: hostInflate() }); }

/* gate every recipe over the files it claims. */
function gateAll({ root, recipes, inflate }) {
  const files = walkRoot(root), vocab = loadVocab(), inf = inflate || hostInflate(), index = recipeIndex(recipes), groups = new Map(), unknown = [];
  for (const f of files) {
    const d = decode(f.bytes, { inflate: inf }); const fp = fingerprint(d), r = (index.get(fp) || []).filter((x) => matches(x, d))[0];
    if (!r) { unknown.push(f.path); continue; }
    if (!groups.has(r.id)) groups.set(r.id, { recipe: r, files: [] });
    groups.get(r.id).files.push({ path: f.path, stream: f.stream, decoded: d });
  }
  return { verdicts: [...groups.values()].map((g) => gate(g.recipe, g.files, { vocab })), unknown };
}

module.exports = { ingest, ingestFiles, gateAll, walkRoot, loadRecipes, loadVocab, hostInflate, recipeIndex };
