/* The handful of fs calls a Folder store uses, in memory. A browser has no disk; this lets the same Folder flow run there. */
"use strict";
function memfs() {
  const files = new Map(), dirs = new Set(["/"]);
  const enc = new TextEncoder(), dec = new TextDecoder();
  const toBytes = (d) => (typeof d === "string" ? enc.encode(d) : new Uint8Array(d));
  const missing = (p) => Object.assign(new Error(`ENOENT: ${p}`), { code: "ENOENT" });
  return {
    existsSync: (p) => files.has(p) || dirs.has(p),
    mkdirSync(p) { const parts = p.split("/"); for (let i = 1; i <= parts.length; i++) dirs.add(parts.slice(0, i).join("/") || "/"); },
    readdirSync(p) { const prefix = p.endsWith("/") ? p : `${p}/`; const out = new Set(); for (const k of [...files.keys(), ...dirs]) if (k.startsWith(prefix) && k.length > prefix.length) out.add(k.slice(prefix.length).split("/")[0]); return [...out].sort(); },
    readFileSync(p, how) { if (!files.has(p)) throw missing(p); const b = files.get(p); return how ? dec.decode(b) : b; },
    writeFileSync(p, d) { files.set(p, toBytes(d)); },
    appendFileSync(p, d) { const a = files.get(p) || new Uint8Array(0), b = toBytes(d), c = new Uint8Array(a.length + b.length); c.set(a); c.set(b, a.length); files.set(p, c); },
    renameSync(a, b) { if (!files.has(a)) throw missing(a); files.set(b, files.get(a)); files.delete(a); },
  };
}
module.exports = { memfs };
