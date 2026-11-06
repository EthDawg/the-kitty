// Tabby Tax, a parody practice. It reads what arrives the way a person at a desk would: a file it can match to the Davies' own papers it
// knows by its hash, whatever it is called; anything else by its name and its words. Then it answers from data/tabby-script.json. No model,
// no randomness: the same email gets the same reply. Nothing here is tax advice.
"use strict";
const crypto = require("crypto");
const SCRIPT = require("../data/tabby-script.json");
const Zip = require("./zip");
const { textOf } = require("./read");
const { readEstate } = require("./estate-files");

const W = SCRIPT.words, ADDRESS = SCRIPT.practice.address;
const isPractice = (a) => String(a).toLowerCase().includes(ADDRESS);
const isToPractice = (m) => m.labels.includes("SENT") && isPractice(m.to);
const CLOUD = /https?:\/\/\S*(drive\.google|docs\.google|dropbox|onedrive|sharepoint|1drv\.ms|icloud|box\.com|litterbox|\/d\/)\S*/i;

const FAMILY = { "agent-return-pdf": "full_return", "myguv-noa-pdf": "notice_of_assessment", "settlement-pdf": "settlement_statement", "qs-schedule-xlsx": "depreciation_schedule" };
const RULES = [
  [/tax[- _]?return|\breturn\b.*schedule/i, /Return labels|tax return for/i, "full_return"],
  [/notice.?of.?assessment|\bnoa\b/i, /Notice of (amended )?assessment/i, "notice_of_assessment"],
  [/contract.?of.?sale|purchase.?contract/i, /Contract of sale/i, "contract_of_sale"],
  [/settlement/i, /Settlement statement/i, "settlement_statement"],
  [/legal|conveyanc|tax.?invoice/i, /Tax invoice/i, "legal_invoice"],
  [/depreciation|qs-schedule/i, /Capital works|Depreciation/i, "depreciation_schedule"],
  [/pack|workbook|summary/i, /Tax pack|Open items/i, "tax_pack"],
];

const openZip = (buf) => { const es = Zip.entries(buf); return (es || []).filter((e) => !e.name.endsWith("/") && !/__MACOSX|\.DS_Store/.test(e.name)).map((e) => ({ name: e.name.split("/").pop(), bytes: Zip.read(buf, e) })).filter((f) => f.bytes); };
const unpack = (attachments) => attachments.flatMap((a) => { const bytes = Buffer.from(a.base64, "base64"); return /\.zip$/i.test(a.name) ? openZip(bytes) : [{ name: a.name, bytes }]; });

const read = (file) => {
  const sha = crypto.createHash("sha256").update(file.bytes).digest("hex");
  const truth = readEstate("truth.json")[sha] || {};
  const text = textOf(file.bytes, file.name) || "";
  const known = `${truth.name || ""} ${file.name}`;
  let kind = FAMILY[truth.family] || (truth.tags && truth.tags[0]) || null;
  if (!kind) { const r = RULES.find(([n, t]) => n.test(file.name) || t.test(text)); kind = r ? r[2] : /\.xlsx$/i.test(file.name) ? "tax_pack" : null; }
  const place = `${known} ${text}`;
  const fy = (known.match(/FY(20\d\d)/) || text.match(/FY(20\d\d)/) || [])[1];
  return { name: file.name, sha, kind, truth, fy: fy ? Number(fy) : null,
    property: /Moorabool|Geelong/i.test(place) ? "geelong" : /Lydiard|Ballarat/i.test(place) ? "ballarat" : null,
    person: /Jordan|Danny/.test(known) || (!/Mia|Daisy/.test(known) && /(Jordan|Danny) Davies/.test(text)) ? "danny" : /Mia|Daisy/.test(known) || /(Mia|Daisy) Davies/.test(text) ? "daisy" : null };
};

const fits = (item, f) => item.kinds.includes(f.kind) && (!item.person || item.person === f.person) && (!item.fy || item.fy === f.fy) && (!item.property || item.property === f.property);

// All that has come in so far, from every message to the practice in this run.
const stateOf = (messages) => {
  const files = messages.flatMap((m) => unpack(m.attachments).map(read));
  const said = messages.map((m) => m.body).join("\n");
  const chasing = SCRIPT.checklist.filter((i) => {
    if (i.id.startsWith("contract-") || i.id.startsWith("invoice-")) { const place = i.id.split("-")[1], what = i.id.startsWith("contract-") ? /contract/i : /invoice/i; return said.split(/[.\n]/).some((s) => new RegExp(place, "i").test(s) && what.test(s) && /can'?t find|cannot find|don'?t have|do not have|lost|missing|never (got|had)/i.test(s)); }
    return false;
  }).map((i) => i.id);
  const have = SCRIPT.checklist.filter((i) => files.some((f) => fits(i, f))).map((i) => i.id);
  return { files, have, chasing, outstanding: SCRIPT.checklist.filter((i) => !have.includes(i.id) && !chasing.includes(i.id)) };
};

const fill = (s, o) => s.replace(/\{(\w+)\}/g, (_, k) => (o[k] != null ? o[k] : ""));

const compose = ({ sent, earlier }) => {
  const before = earlier.filter((m) => m.id !== sent.id);
  const all = [...before, sent];
  const state = stateOf(all), mine = unpack(sent.attachments).map(read), prior = stateOf(before);
  const lines = [], names = sent.from.match(/^(\S+)/);
  const first = names ? names[1] : "there";
  if (!before.length) lines.push(W.welcome);
  const link = sent.body.match(CLOUD) || /https?:\/\//i.test(sent.body);
  if (link && !mine.length) lines.push(W.cloud);
  else if (link) lines.push(`We have your attachments. ${W.cloud}`);
  if (mine.length) lines.push(`We've received ${mine.length} ${mine.length === 1 ? "file" : "files"}:\n${mine.map((f) => `- ${f.name}`).join("\n")}`);

  const seen = new Map(prior.files.map((f) => [f.sha, f.name]));
  for (const f of mine) {
    if (seen.has(f.sha) && seen.get(f.sha) !== f.name) lines.push(fill(W.dupe, { name: f.name, other: seen.get(f.sha) }));
    else if (f.truth.tags && !f.truth.tags.length && /drawing/i.test(f.truth.what || "")) lines.push(fill(W.not_tax, { name: f.name, what: "a child's drawing of a cat" }));
    else if (!f.kind) lines.push(fill(W.unknown, { name: f.name }));
    if (!seen.has(f.sha)) seen.set(f.sha, f.name);
  }
  if (mine.some((f) => /WFH-Log/.test(f.truth.name || f.name)) && mine.concat(prior.files).filter((f) => /WFH-Log-FY2025/.test(f.truth.name || f.name)).length > 1) lines.push(W.stale);

  const noas = mine.filter((f) => f.kind === "notice_of_assessment");
  for (const n of noas) {
    const who = n.person === "danny" ? "Danny" : n.person === "daisy" ? "Daisy" : "you";
    if (!state.files.some((f) => f.kind === "full_return" && f.person === n.person && f.fy === n.fy)) lines.push(fill(W.noa_only, { who: n.fy ? `${who}, FY${n.fy}` : who }));
  }
  if (/amend/i.test(sent.body)) {
    const y = sent.body.match(/(?:FY\s?)(20\d\d)|(?:FY\s?)?20\d\d[-/](\d\d)\b|\b(20\d\d)\b/i);
    const fy = y ? Number(y[1] || (y[2] ? `20${y[2]}` : y[3])) : null;
    lines.push(fy ? fill(W.amend_known, { fy }) : W.amend_which);
  }
  for (const id of state.chasing.filter((x) => !prior.chasing.includes(x))) lines.push(fill(W.chasing, { what: SCRIPT.checklist.find((i) => i.id === id).label.toLowerCase() }));

  if (!state.outstanding.length) lines.push(W.done);
  else lines.push(`${W.still_need}\n${state.outstanding.map((i) => `- ${i.label}`).join("\n")}`);
  return { body: `Hi ${first},\n\n${lines.join("\n\n")}\n\n${SCRIPT.practice.signoff}`, state };
};

const answer = ({ sent, earlier, now }) => {
  const { body } = compose({ sent, earlier });
  const id = `m_${crypto.randomBytes(8).toString("hex")}`;
  return { id, threadId: sent.threadId, seq: Date.now() + 1, from: SCRIPT.practice.from, to: sent.from, subject: /^re:/i.test(sent.subject) ? sent.subject : `Re: ${sent.subject}`, date: now, exists_from: now, people: sent.people, labels: ["INBOX"], snippet: body.replace(/\s+/g, " ").slice(0, 120), body, attachments: [] };
};

// What the practice page shows.
const status = (messages) => {
  const s = stateOf(messages);
  return { practice: SCRIPT.practice, received: s.files.map((f) => ({ name: f.name, kind: f.kind })), items: SCRIPT.checklist.map((i) => ({ id: i.id, label: i.label, state: s.have.includes(i.id) ? "received" : s.chasing.includes(i.id) ? "chasing" : "needed" })) };
};

module.exports = { answer, status, isPractice, isToPractice, ADDRESS };
