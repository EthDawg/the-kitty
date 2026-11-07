/* The benchmark world's Drive and inbox, built from its vault and estate-plan.js. Called by build-vault.js. Writes drive.json, mail.json, text.json and
   truth.json (kept from clients) to estate/benchmark/, puts the files it makes in public/vault/made/, and writes life/davies/ESTATE.md, what each chapter
   finds where. A generated family brings its own Drive and inbox: see build-family.js. Deterministic: the same world makes the same bytes. */
"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");
const { PDFDocument } = require("pdf-lib");
const P = require("./estate-plan");
const CAST = require("./data/cast.json");
const { textOf } = require("./lib/read");
const Mime = require("./lib/mime");
const TYPES = require("./lib/file-types");
const { Doc } = require("../standard/world/lib/pdf");
const { scan } = require("../standard/world/lib/png");

const sha256 = (b) => crypto.createHash("sha256").update(b).digest("hex");
const shortId = (p, s) => `${p}_${crypto.createHash("sha1").update(s).digest("hex").slice(0, 16)}`;
const deflate = (b) => new Uint8Array(zlib.deflateSync(Buffer.from(b)));
const typeOf = (name) => (TYPES[path.extname(name).toLowerCase()] || "application/octet-stream").split(";")[0];
const addDays = (iso, n) => new Date(Date.parse(iso) + n * 864e5).toISOString().slice(0, 10);

const scanPdf = async (lines, seed) => {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const png = await doc.embedPng(Buffer.from(scan(lines, seed, deflate)));
  const page = doc.addPage([595.28, 841.89]);
  const w = 500, h = (png.height / png.width) * w;
  page.drawImage(png, { x: 47, y: 790 - h, width: w, height: h });
  return Buffer.from(await doc.save({ useObjectStreams: false }));
};

const invoicePdf = (inv, names) => {
  const d = new Doc({ brand: { name: inv.firm }, title: "Tax invoice", deflate, style: "plain" });
  d.h1(`Tax invoice ${inv.number}`);
  d.kv([["Client", names], ["Date", inv.dated], ["Property", inv.property]], 3);
  d.table([{ label: "Item", w: 340 }, { label: "Amount", w: 120, align: "right" }], inv.lines, { foot: ["Total paid at settlement", inv.total] });
  d.para("Prepared for the client's records; a fictional document.", { size: 8.5 });
  return Buffer.from(d.finish());
};

async function buildEstate({ ESTATE, PUBLIC, vault, access, repoRoot }) {
  fs.mkdirSync(path.join(PUBLIC, "vault", "made"), { recursive: true });
  const read = (rel) => fs.readFileSync(path.join(PUBLIC, rel));
  const byName = new Map();
  for (const f of vault.files) { if (!byName.has(f.name)) byName.set(f.name, f); }
  const need = (name) => { const f = byName.get(name); if (!f) throw new Error(`estate-plan names ${name}, and the world has no such file`); return f; };

  const personIdOf = Object.fromEntries(CAST.people.map((p) => [p.party_id, p.id]));
  const adults = CAST.people.filter((p) => P.BOTH.includes(p.id));
  const worldName = Object.fromEntries(adults.map((p) => [p.id, `${p.first_name} ${CAST.family_name}`]));
  const firstName = Object.fromEntries(adults.map((p) => [p.id, p.first_name]));
  const words = { joint: `${adults[0].first_name} and ${adults[1].first_name} ${CAST.family_name}` };
  const MAILBOX = CAST.shared_mail;
  const addr = (who) => {
    if (who === "joint") return `${words.joint} <${MAILBOX}>`;
    return worldName[who] ? `${worldName[who]} <${MAILBOX}>` : who;
  };
  const fill = (s) => s.replace(/\{(\w+)\}/g, (_, k) => firstName[k] || `{${k}}`);
  const holders = (stream) => {
    const rows = access.subjects[stream];
    if (!rows) return P.BOTH;
    const ids = [...new Set(rows.map((r) => personIdOf[r.party]).filter(Boolean))];
    return ids.length ? ids : P.BOTH;
  };

  // ---- things made here
  const made = new Map(), text = {}, truth = {};
  for (const m of P.MADE) {
    let bytes;
    if (m.kind === "scan-pdf") bytes = await scanPdf(m.lines(words), m.id);
    else if (m.kind === "png") bytes = Buffer.from(scan(m.lines(words), m.id, deflate));
    else if (m.kind === "invoice") bytes = invoicePdf(m.invoice, m.invoice.client === "joint" ? words.joint : m.invoice.client);
    else if (m.kind === "edit") { const src = read(need(m.from).path).toString("utf8").split("\n"); const i = src.findIndex((l, n) => n > 0 && /\d/.test(l)); src[i] = src[i].replace(/(\d+)(\r?)$/, (_, h, cr) => `${Number(h) + 6}${cr}`); bytes = Buffer.from(src.join("\n")); }
    const rel = `vault/made/${m.title.replace(/[^\w.() -]/g, "_")}`;
    fs.writeFileSync(path.join(PUBLIC, rel), bytes);
    const row = { title: m.title, source: m.source, path: rel, size: bytes.length, sha256: sha256(bytes), type: typeOf(m.title), saved: m.saved, truth: m.truth, tags: m.tags || [] };
    made.set(m.title, { ...row, plan: m });
    truth[row.sha256] = { what: m.truth, tags: row.tags, name: m.source };
  }

  // ---- the Drive
  const folderId = (id) => (id === "root" ? "root" : `d_${id}`);
  const folders = P.FOLDERS.map(([id, name, parent, people]) => ({ id: folderId(id), title: name, parentId: folderId(parent), mimeType: "application/vnd.google-apps.folder", people, owner: people.length === 1 ? people[0] : "danny", createdTime: "2019-03-20" }));
  const peopleOf = Object.fromEntries(P.FOLDERS.map(([id, , , people]) => [id, people]));
  const driveFiles = [];
  const add = (row) => {
    const id = shortId("f", `${row.folder}/${row.title}`);
    driveFiles.push({ id, title: row.title, parentId: folderId(row.folder), mimeType: row.type, people: peopleOf[row.folder], owner: row.owner, createdTime: row.saved, modifiedTime: row.saved, delivered_on: row.saved, size: row.size, sha256: row.sha256, path: row.path, source: row.source });
    if (row.note) truth[`drive:${id}`] = row.note;
    return id;
  };
  const homed = new Set();
  for (const f of vault.files.filter((x) => x.brand === "litterbox")) {
    const home = P.HOMES.find((h) => (h.name ? h.name.test(f.name) : h.stream === f.stream));
    if (!home) throw new Error(`no home in the Drive for ${f.name}`);
    homed.add(f.path);
    add({ title: f.name, folder: home.folder, owner: home.owner, saved: f.delivered_on, size: f.size, sha256: f.sha256, path: f.path, type: f.type.split(";")[0], source: f.name });
  }
  for (const c of P.COPIES) {
    const f = need(c.from);
    if (c.saved < f.delivered_on) throw new Error(`${c.from} is saved before it exists`);
    add({ title: c.as || c.from, folder: c.folder, owner: c.owner, saved: c.saved, size: f.size, sha256: f.sha256, path: f.path, type: f.type.split(";")[0], source: c.from, note: c.truth });
  }
  for (const m of made.values()) if (m.plan.folder) add({ title: m.title, folder: m.plan.folder, owner: m.plan.owner, saved: m.saved, size: m.size, sha256: m.sha256, path: m.path, type: m.type, source: m.source, note: m.truth });

  // ---- the inbox
  const messages = [];
  const attachRow = (name) => {
    const m = made.get(name);
    if (m) return { name, type: m.type, size: m.size, sha256: m.sha256, path: m.path, source: m.source };
    const f = need(name);
    return { name, type: f.type.split(";")[0], size: f.size, sha256: f.sha256, path: f.path, source: f.name };
  };
  const send = (m) => {
    const id = shortId("m", `${m.date}|${m.subject}|${m.from}|${m.key || ""}`);
    const attachments = (m.attachments || []).map((a, i) => ({ id: `${id}.${i}`, ...a }));
    const body = m.body || "";
    messages.push({ id, threadId: m.thread ? `t_${m.thread}` : `t_${id.slice(2)}`, source: m.source || null, from: m.from, to: m.to, subject: m.subject, date: m.date, delivered_on: m.date, people: m.people, labels: m.labels || ["INBOX"], snippet: body.replace(/\s+/g, " ").slice(0, 120), body, attachments });
  };
  for (const f of vault.files) {
    if (f.name.endsWith(".eml")) {
      const e = Mime.parse(read(f.path));
      send({ key: f.path, source: f.name, from: e.from, to: e.to, subject: e.subject, date: f.delivered_on, people: holders(f.stream), body: e.text, labels: f.stream === "RECEIPTS" ? ["INBOX", "CATEGORY_PURCHASES"] : ["INBOX", "CATEGORY_UPDATES"] });
      continue;
    }
    const s = P.SENDERS[f.family];
    if (!s) continue;
    const special = !s.only || s.only.test(f.name);
    send({ key: f.path, from: s.from, to: addr(holders(f.stream).length > 1 ? "joint" : holders(f.stream)[0]), subject: s.subject(f), date: f.delivered_on, people: holders(f.stream), body: s.body(f), attachments: [attachRow(f.name), ...(special && s.attach ? s.attach.map(attachRow) : [])] });
  }
  for (const n of P.NOTICES) for (const f of vault.files.filter((x) => x.stream === n.stream)) {
    const who = holders(n.stream);
    send({ key: f.path, from: n.from, to: addr(who.length > 1 ? "joint" : who[0]), subject: n.subject, date: f.delivered_on, people: who, labels: ["INBOX", "CATEGORY_UPDATES"], body: `${n.body}\n\nA parody; fictional.` });
  }
  for (let y = 2019, i = 0; y <= 2027; y++) for (let m = 1; m <= 12; m++) {
    const date = `${y}-${String(m).padStart(2, "0")}-${String(3 + (i * 7) % 24).padStart(2, "0")}`;
    if (date < "2019-03-01" || date > "2027-03-31") continue;
    const [from, subject] = P.PROMOS[i++ % P.PROMOS.length].split("|");
    send({ key: `promo-${date}`, from, to: addr("joint"), subject, date, people: P.BOTH, labels: ["INBOX", "CATEGORY_PROMOTIONS"], body: "This month's offers. A parody catalogue; fictional." });
  }
  for (const m of P.MAIL) send({ ...m, key: m.id, from: addr(m.from), to: addr(m.to), body: fill(m.body), attachments: (m.attach || []).map(attachRow) });
  messages.sort((a, b) => (a.date === b.date ? (a.id < b.id ? -1 : 1) : a.date < b.date ? 1 : -1));

  // ---- text, for search and read_file_content. A file's text is keyed by its hash, so a duplicate reads as itself.
  const texts = {};
  const index = (rel, name, sha) => { if (texts[sha] !== undefined) return; const t = textOf(read(rel), name); texts[sha] = t == null ? null : t; };
  for (const f of driveFiles) index(f.path, f.title, f.sha256);
  for (const m of messages) for (const a of m.attachments) index(a.path, a.name, a.sha256);
  for (const f of vault.files) if (!truth[f.sha256]) truth[f.sha256] = { name: f.name, family: f.family, stream: f.stream };

  const bytesOut = (name, value) => fs.writeFileSync(path.join(ESTATE, name), `${JSON.stringify(value)}\n`);
  bytesOut("drive.json", { folders, files: driveFiles });
  bytesOut("mail.json", { mailbox: MAILBOX, messages });
  bytesOut("text.json", texts);
  bytesOut("truth.json", truth);

  // ---- what each chapter finds where
  const inDrive = (t, at) => driveFiles.filter((f) => f.delivered_on <= at && t.test(f.source)).length;
  const inMail = (t, at) => messages.filter((m) => m.delivered_on <= at && ((m.source && t.test(m.source)) || m.attachments.some((a) => t.test(a.source)))).length;
  const onPortal = (t, at) => vault.files.filter((f) => f.delivered_on <= at && !["gmeow", "litterbox"].includes(f.brand) && t.test(f.name)).length;
  const place = (t, at) => {
    if (!t) return "Nowhere yet";
    const d = inDrive(t, at), m = inMail(t, at), p = onPortal(t, at), out = [];
    if (d) out.push("Drive"); if (m) out.push("Email"); if (p) out.push("Portal");
    return !out.length ? "Nowhere yet" : out.length === 1 ? `${out[0]} only` : out.join(", ");
  };
  const chapters = P.CHAPTERS.filter((c) => P.NEEDS.some((n) => n[0] === c.chapter)).map((c) => {
    const needs = P.NEEDS.filter((n) => n[0] === c.chapter).map(([, label, t, note]) => ({ label, where: place(t, c.today), note: note || "" }));
    for (const n of needs) if (P.NEEDS.find((x) => x[1] === n.label)[2] && n.where === "Nowhere yet") throw new Error(`chapter ${c.chapter}: "${n.label}" should exist and the estate does not hold it at ${c.today}`);
    return { chapter: c.chapter, label: c.label, as_of: c.today, needs,
      drive: driveFiles.filter((f) => f.delivered_on <= c.today).length, email: messages.filter((m) => m.delivered_on <= c.today).length, portal: vault.files.filter((f) => f.delivered_on <= c.today && !["gmeow", "litterbox"].includes(f.brand)).length };
  });
  const missing = chapters.flatMap((c) => c.needs.filter((n) => n.where === "Nowhere yet").map((n) => ({ chapter: c.chapter, ...n })));
  const md = ["# What each chapter finds, and where", "",
    "Generated by `portals/build-estate.js` from `estate-plan.js` and the built estate, each line checked at that chapter's clock. A person or an agent must not read this page during a run: it describes the answers.", "",
    "**This is the estate of the benchmark world**, the 2019 to 2027 household of Jordan, Mia and Ava, read at each chapter's day. Danny and Daisy's generated life brings its own evidence and its own map, in `life/world/out/<family>/mess.json`.", "",
    `The benchmark's Drive holds ${driveFiles.length} files in ${folders.length} folders. The inbox holds ${messages.length} messages. The portals hold ${vault.files.filter((f) => !["gmeow", "litterbox"].includes(f.brand)).length} files as delivered, and the seven original portals generate more on request.`, "",
    "A note on the mess. The Drive has exact duplicates, a scan called `scan0003.pdf` that is the Geelong contract, a scan of a child's drawing, a screenshot of a receipt, a folder called `tax stuff`, four misfiled documents and a stale draft of a log. Two documents are missing altogether.", "",
    ...chapters.flatMap((c) => [`## Chapter ${c.chapter}, ${c.label}`, "", `Clock: ${c.as_of}. By then: ${c.drive} files in the Drive, ${c.email} messages, ${c.portal} files on portals.`, "", "| Needed | Where it is | Note |", "|---|---|---|", ...c.needs.map((n) => `| ${n.label} | ${n.where} | ${n.note} |`), ""]),
  ].join("\n");
  fs.writeFileSync(path.join(repoRoot, "life", "davies", "ESTATE.md"), md);
  return { drive: driveFiles.length, folders: folders.length, mail: messages.length, missing: missing.length };
}

module.exports = { buildEstate };
