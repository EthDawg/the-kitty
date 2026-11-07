/* A generated family, loaded from what the life generator writes to life/world/out/<family>/: manifest.json (vault fields plus `person` and `delivered_on`), the files
   it names, setup/party.json for names, and mess.json for what landed in the Drive and the inbox. A bad manifest stops the build rather than serving half a family.
   Nothing is generated here, and a generated family's estate is its own: no estate-plan.js, no benchmark names. */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { textOf } = require("./lib/read");
const Mime = require("./lib/mime");
const TYPES = require("./lib/file-types");

const REQUIRED = ["brand", "stream", "year", "date", "name", "size", "type", "path", "sha256", "person", "delivered_on"];
const FOLDER = "application/vnd.google-apps.folder";
const sha256 = (b) => crypto.createHash("sha256").update(b).digest("hex");
const shortId = (p, s) => `${p}_${crypto.createHash("sha1").update(s).digest("hex").slice(0, 16)}`;
const typeOf = (name) => (TYPES[path.extname(name).toLowerCase()] || "application/octet-stream").split(";")[0];
const title = (id) => id.charAt(0).toUpperCase() + id.slice(1);
const ISO = /^\d{4}-\d{2}-\d{2}$/;

const familiesIn = (root) => (fs.existsSync(root) ? fs.readdirSync(root).sort().map((d) => path.join(root, d)).filter((d) => fs.existsSync(path.join(d, "manifest.json"))) : []);

async function buildFamily({ dir, ESTATE, PUBLIC, brands }) {
  const stop = (msg) => { throw new Error(`${path.basename(dir)}: ${msg}`); };
  const m = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  const id = m.family;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id || "")) stop(`family "${id}" is not a usable id`);
  if (id === "benchmark" || id === "made") stop(`family "${id}" is a reserved name`);
  if (!Array.isArray(m.files) || !m.files.length) stop("the manifest lists no files");
  const portals = new Set(brands.map((b) => b.id));
  const OUT = path.join(ESTATE, id), VAULT = path.join(PUBLIC, "vault", id);
  fs.mkdirSync(OUT, { recursive: true });

  const copy = (rel, want) => {
    const from = path.join(dir, rel);
    if (path.normalize(from) !== from || !from.startsWith(dir + path.sep)) stop(`${rel} leaves the family's folder`);
    if (!fs.existsSync(from)) stop(`${rel} is listed and is not there`);
    const bytes = fs.readFileSync(from);
    if (want && sha256(bytes) !== want) stop(`${rel} does not match its hash`);
    fs.mkdirSync(path.dirname(path.join(VAULT, rel)), { recursive: true });
    fs.writeFileSync(path.join(VAULT, rel), bytes);
    return bytes;
  };
  const served = (rel) => `vault/${id}/${rel}`;

  // ---- who
  const seen = [...new Set(m.files.flatMap((f) => [f.person, ...(f.visible_to || [])]).filter(Boolean))];
  const partyFile = path.join(dir, "setup", "party.json");
  const parties = fs.existsSync(partyFile) ? JSON.parse(fs.readFileSync(partyFile, "utf8")).filter((p) => p.kind === "person") : [];
  const people = seen.map((pid) => { const p = parties.find((x) => x.party_id.toLowerCase() === pid), full = p ? p.name : title(pid); return { id: pid, first_name: full.split(" ")[0], full_name: full }; });
  const everyone = people.map((p) => p.id);
  const seesIt = (f) => f.visible_to || (f.person ? [f.person] : everyone);

  // ---- the files, with the portal rows listed and the rest left to the Drive and the inbox
  const bytesOf = new Map(), truth = {}, texts = {}, rows = [];
  const fileText = (bytes, name, sha) => { if (texts[sha] === undefined) { const t = textOf(bytes, name); texts[sha] = t == null ? null : t; } };
  for (const f of m.files) {
    for (const k of REQUIRED) if (f[k] === undefined) stop(`${f.path || f.name}: the manifest has no ${k}`);
    if (!ISO.test(f.delivered_on)) stop(`${f.path}: delivered_on is not a date`);
    const onPortal = (f.where || "portal") === "portal";
    if (onPortal && !portals.has(f.brand)) stop(`${f.path}: no portal called ${f.brand}`);
    const bytes = copy(f.path, f.sha256);
    bytesOf.set(f.path, bytes);
    truth[f.sha256] = { name: f.name, family: f.family, stream: f.stream };
    if (onPortal) rows.push({ brand: f.brand, stream: f.stream, year: f.year, date: f.date, delivered_on: f.delivered_on, person: f.person, visible_to: seesIt(f), family: f.family, origin: f.origin, name: f.name, size: f.size, type: f.type, path: served(f.path), sha256: f.sha256 });
  }
  const told = new Map((m.streams || []).map((s) => [`${s.brand}|${s.id}`, s.name]));
  const streams = [...new Set(rows.map((f) => `${f.brand}|${f.stream}`))].map((k) => { const [brand, sid] = k.split("|"); return { brand, id: sid, name: told.get(k) || sid }; });
  const dates = m.files.map((f) => f.delivered_on).sort(), last = dates[dates.length - 1];
  const write = (name, v) => fs.writeFileSync(path.join(OUT, name), `${JSON.stringify(v)}\n`);
  write("vault.json", { world: m.world || `${id}/1`, last, streams, files: rows });

  // ---- what landed where, from mess.json
  const messFile = path.join(dir, "mess.json");
  const chapters = fs.existsSync(messFile) ? Object.values(JSON.parse(fs.readFileSync(messFile, "utf8")).chapters || {}) : [];
  const landed = chapters.flatMap((c) => (c.drive || []).map((e) => ({ ...e, on: e.delivered_on || c.today })));
  const arrived = chapters.flatMap((c) => (c.inbox || []).map((e) => ({ ...e, on: e.delivered_on || c.today })));
  const manifestRow = new Map(m.files.map((f) => [f.path, f]));

  // the Drive: the mess as it landed, then anything else the manifest keeps in a Drive, by stream
  const already = new Set(landed.map((e) => e.of).filter(Boolean));
  for (const f of m.files.filter((x) => x.where === "drive" && !already.has(x.path))) {
    const who = seesIt(f), owner = who.length > 1 ? "shared" : who[0];
    landed.push({ path: `drive/${owner}/${told.get(`${f.brand}|${f.stream}`) || f.stream}/${f.name}`, stored: f.path, person: f.person, visible_to: who, on: f.delivered_on, sha256: f.sha256, size: f.size, of: f.path });
  }
  const folders = new Map(), driveFiles = [];
  const folderFor = (parts, who, on) => {
    let parent = "root", key = "";
    parts.forEach((name, i) => {
      key += `/${name}`;
      const fid = `d_${crypto.createHash("sha1").update(`${id}${key}`).digest("hex").slice(0, 12)}`;
      const shown = i === 0 ? (name === "shared" ? "Family" : `${(people.find((p) => p.id === name) || { first_name: title(name) }).first_name}'s files`) : name;
      const row = folders.get(fid) || { id: fid, title: shown, parentId: parent, mimeType: FOLDER, people: [], owner: i === 0 && name !== "shared" ? name : everyone[0], createdTime: on };
      row.people = [...new Set([...row.people, ...who])]; if (on < row.createdTime) row.createdTime = on;
      folders.set(fid, row); parent = fid;
    });
    return parent;
  };
  for (const e of landed) {
    const parts = e.path.split("/").slice(1), name = parts.pop(), who = e.visible_to || [e.person];
    const rel = e.stored || e.path, bytes = e.stored ? bytesOf.get(e.stored) : copy(e.path, e.sha256), sha = e.sha256 || sha256(bytes);
    const parentId = folderFor(parts, who, e.on);
    driveFiles.push({ id: shortId("f", `${id}/${e.path}`), title: name, parentId, mimeType: typeOf(name), people: who, owner: e.person || who[0], createdTime: e.on, modifiedTime: e.on, delivered_on: e.on, size: bytes.length, sha256: sha, path: served(rel), source: name });
    fileText(bytes, name, sha);
    const of = e.of && manifestRow.get(e.of);
    if (!truth[sha]) truth[sha] = of ? { name: of.name, family: of.family, stream: of.stream, what: e.note } : { name, what: e.note, tags: [] };
  }

  // the inbox: every email the family received, then anything else that came by email, wrapped the way it arrived
  const messages = [];
  const brandName = (b) => (brands.find((x) => x.id === b) || { name: title(b) }).name;
  const mailbox = m.mailbox || `${id}@mail.example`;
  const addAttachment = (mid, n, a) => ({ id: `${mid}.${n}`, name: a.name, type: a.type, size: a.size, sha256: a.sha256, path: a.path, source: a.name });
  const say = ({ key, from, to, subject, date, people: who, body, attachments }) => {
    const mid = shortId("m", `${id}|${key}`);
    messages.push({ id: mid, threadId: `t_${mid.slice(2)}`, source: null, from, to, subject, date, delivered_on: date, people: who, labels: ["INBOX"], snippet: String(body || "").replace(/\s+/g, " ").slice(0, 120), body: body || "", attachments: (attachments || []).map((a, n) => addAttachment(mid, n, a)) });
  };
  const emailed = new Set();
  const asAttachment = (rel, name, bytes, sha) => ({ name, type: typeOf(name), size: bytes.length, sha256: sha, path: served(rel) });
  const sent = (bytes, name, who, on, key, extra) => { const e = Mime.parse(bytes); const when = (name.match(/^\d{4}-\d{2}-\d{2}/) || [on])[0]; say({ key, from: e.from, to: e.to, subject: e.subject, date: when, people: who, body: e.text, attachments: extra }); };
  for (const e of arrived) {
    if (!e.path.endsWith(".eml")) stop(`${e.path}: the inbox holds emails`);
    const bytes = copy(e.path, e.sha256), name = path.basename(e.path), of = e.of && manifestRow.get(e.of);
    if (e.of) emailed.add(e.of);
    const held = e.kind === "attachment" && of ? [asAttachment(e.of, of.name, bytesOf.get(e.of), of.sha256)] : [];
    for (const h of held) fileText(bytesOf.get(e.of), h.name, h.sha256);
    sent(bytes, name, e.visible_to || [e.person], e.on, name, held);
  }
  for (const f of m.files.filter((x) => x.where === "email" && !emailed.has(x.path))) {
    const bytes = bytesOf.get(f.path);
    if (f.name.endsWith(".eml")) { sent(bytes, f.name, seesIt(f), f.delivered_on, f.path); continue; }
    fileText(bytes, f.name, f.sha256);
    say({ key: f.path, from: `${brandName(f.brand)} <hello@${f.brand}.example>`, to: `${m.household || "The household"} <${mailbox}>`, subject: f.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " "), date: f.delivered_on, people: seesIt(f), body: "Attached, as promised. Fictional.", attachments: [asAttachment(f.path, f.name, bytes, f.sha256)] });
  }
  messages.sort((a, b) => (a.date === b.date ? (a.id < b.id ? -1 : 1) : a.date < b.date ? 1 : -1));

  write("drive.json", { folders: [...folders.values()], files: driveFiles });
  write("mail.json", { mailbox, messages });
  write("text.json", texts);
  write("truth.json", truth);
  return { entry: { id, label: m.household || id, people }, listed: rows.length, drive: driveFiles.length, mail: messages.length };
}

module.exports = { buildFamily, familiesIn };
