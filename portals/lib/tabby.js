// Tabby Tax, a parody practice with a script. It reads what arrives the way a person at a desk would: a file it can match to the family's own
// papers it knows by its hash, whatever it is called; anything else by its name and its words. Then it answers from data/tabby-script.json. No
// model, no randomness, and nothing stored: the page holds the conversation and sends `state` back with each message. Not tax advice.
"use strict";
const crypto = require("crypto");
const SCRIPT = require("../data/tabby-script.json");
const Zip = require("./zip");
const { textOf } = require("./read");
const { readEstate } = require("./estate-files");
const { peopleOf } = require("./families");

const W = SCRIPT.words;
const CLOUD = /https?:\/\//i;
const MAX_BYTES = 3.4 * 1024 * 1024; // a Vercel function takes 4.5 MB, and base64 adds a third
const checklistOf = (family) => SCRIPT.checklists[family] || SCRIPT.checklists.default;

const FAMILY = { "agent-return-pdf": "full_return", "myguv-noa-pdf": "notice_of_assessment", "settlement-pdf": "settlement_statement", "qs-schedule-xlsx": "depreciation_schedule", "pawroll-income-statement-pdf": "income_statement", "bupaw-statement-pdf": "health_statement", "etreat-ess-pdf": "share_plan" };
const RULES = [
  [/tax[- _]?return|\breturn\b.*schedule/i, /Return labels|tax return for/i, "full_return"],
  [/notice.?of.?assessment|\bnoa\b/i, /Notice of (amended )?assessment/i, "notice_of_assessment"],
  [/contract.?of.?sale|purchase.?contract/i, /Contract of sale/i, "contract_of_sale"],
  [/settlement/i, /Settlement statement/i, "settlement_statement"],
  [/legal|conveyanc|tax.?invoice/i, /Tax invoice/i, "legal_invoice"],
  [/depreciation|qs-schedule/i, /Capital works|Depreciation/i, "depreciation_schedule"],
  [/income.?statement/i, /Income statement/i, "income_statement"],
  [/health|bupaw/i, /private health/i, "health_statement"],
  [/\bess\b|share.?plan/i, /share scheme/i, "share_plan"],
  [/pack|workbook|summary/i, /Tax pack|Open items/i, "tax_pack"],
];

const openZip = (buf) => (Zip.entries(buf) || []).filter((e) => !e.name.endsWith("/") && !/__MACOSX|\.DS_Store/.test(e.name)).map((e) => ({ name: e.name.split("/").pop(), bytes: Zip.read(buf, e) })).filter((f) => f.bytes);
const unpack = (files) => files.flatMap((f) => (/\.zip$/i.test(f.name) ? openZip(f.bytes) : [f]));

const read = (file, family) => {
  const sha = crypto.createHash("sha256").update(file.bytes).digest("hex");
  const truth = readEstate("truth.json", family)[sha] || {};
  const text = textOf(file.bytes, file.name) || "";
  const known = `${truth.name || ""} ${file.name}`;
  let kind = FAMILY[truth.family] || (truth.tags && truth.tags[0]) || null;
  if (!kind) { const r = RULES.find(([n, t]) => n.test(file.name) || t.test(text)); kind = r ? r[2] : /\.xlsx$/i.test(file.name) ? "tax_pack" : null; }
  const place = `${known} ${text}`;
  const fy = (known.match(/FY(20\d\d)/) || text.match(/FY(20\d\d)/) || [])[1];
  const person = peopleOf(family).find((p) => new RegExp(`\\b${p.first_name}\\b`).test(known) || text.includes(p.full_name));
  return { name: file.name, sha, kind, truth, fy: fy ? Number(fy) : null, property: /Moorabool|Geelong/i.test(place) ? "geelong" : /Lydiard|Ballarat/i.test(place) ? "ballarat" : null, person: person ? person.id : null, log: /WFH-Log-FY2025/.test(known) };
};

const fits = (item, f) => item.kinds.includes(f.kind) && (!item.person || item.person === f.person) && (!item.fy || item.fy === f.fy) && (!item.property || item.property === f.property);
const fill = (s, o) => s.replace(/\{(\w+)\}/g, (_, k) => (o[k] != null ? o[k] : ""));
const CANT = /can'?t find|cannot find|don'?t have|do not have|lost|missing|never (got|had)/i;

const noted = (state) => ({ greeted: !!(state && state.greeted), have: [...((state && state.have) || [])], chasing: [...((state && state.chasing) || [])], seen: [...((state && state.seen) || [])], returns: [...((state && state.returns) || [])] });

const items = (list, s) => list.map((i) => ({ id: i.id, label: i.label, state: s.have.includes(i.id) ? "received" : s.chasing.includes(i.id) ? "chasing" : "needed" }));

// One message in, one reply out. `state` is what the last reply said; the practice remembers nothing else.
const answer = ({ body, attachments, state, family, sender }) => {
  const total = attachments.reduce((n, f) => n + f.bytes.length, 0);
  if (total > MAX_BYTES) { const e = new Error("That is too big for this demo. The limit is 3.4 MB a message: send it in parts."); e.status = 413; throw e; }
  const list = checklistOf(family), s = noted(state), text = String(body || ""), lines = [];
  const mine = unpack(attachments).map((f) => read(f, family));
  if (!s.greeted) lines.push(W.welcome);
  const link = CLOUD.test(text);
  if (link && !mine.length) lines.push(W.cloud);
  else if (link) lines.push(`We have your attachments. ${W.cloud}`);
  if (mine.length) lines.push(`We've received ${mine.length} ${mine.length === 1 ? "file" : "files"}:\n${mine.map((f) => `- ${f.name}`).join("\n")}`);

  const seen = new Map(s.seen.map((f) => [f.sha, f.name]));
  for (const f of mine) {
    if (seen.has(f.sha) && seen.get(f.sha) !== f.name) lines.push(fill(W.dupe, { name: f.name, other: seen.get(f.sha) }));
    else if (f.truth.tags && !f.truth.tags.length && /drawing/i.test(f.truth.what || "")) lines.push(fill(W.not_tax, { name: f.name, what: "a child's drawing of a cat" }));
    else if (!f.kind) lines.push(fill(W.unknown, { name: f.name }));
    if (!seen.has(f.sha)) seen.set(f.sha, f.name);
  }
  const logs = new Set([...mine.filter((f) => f.log).map((f) => f.sha), ...s.seen.filter((f) => f.log).map((f) => f.sha)]);
  if (mine.some((f) => f.log) && logs.size > 1) lines.push(W.stale);

  const returns = new Set(s.returns);
  for (const f of mine.filter((x) => x.kind === "full_return")) returns.add(`${f.person}|${f.fy}`);
  for (const n of mine.filter((x) => x.kind === "notice_of_assessment")) {
    const who = (peopleOf(family).find((p) => p.id === n.person) || { first_name: "you" }).first_name;
    if (!returns.has(`${n.person}|${n.fy}`)) lines.push(fill(W.noa_only, { who: n.fy ? `${who}, FY${n.fy}` : who }));
  }
  if (/amend/i.test(text)) {
    const y = text.match(/(?:FY\s?)(20\d\d)|(?:FY\s?)?20\d\d[-/](\d\d)\b|\b(20\d\d)\b/i);
    const fy = y ? Number(y[1] || (y[2] ? `20${y[2]}` : y[3])) : null;
    lines.push(fy ? fill(W.amend_known, { fy }) : W.amend_which);
  }
  for (const i of list.filter((x) => !s.chasing.includes(x.id) && (x.id.startsWith("contract-") || x.id.startsWith("invoice-")))) {
    const place = i.id.split("-")[1], what = i.id.startsWith("contract-") ? /contract/i : /invoice/i;
    if (text.split(/[.\n]/).some((t) => new RegExp(place, "i").test(t) && what.test(t) && CANT.test(t))) { s.chasing.push(i.id); lines.push(fill(W.chasing, { what: i.label.toLowerCase() })); }
  }
  for (const i of list) if (!s.have.includes(i.id) && mine.some((f) => fits(i, f))) s.have.push(i.id);
  const outstanding = list.filter((i) => !s.have.includes(i.id) && !s.chasing.includes(i.id));
  lines.push(outstanding.length ? `${W.still_need}\n${outstanding.map((i) => `- ${i.label}`).join("\n")}` : W.done);

  const next = { greeted: true, have: s.have, chasing: s.chasing, seen: [...s.seen.filter((f) => !mine.some((m) => m.sha === f.sha)), ...mine.map((f) => ({ sha: f.sha, name: seen.get(f.sha), log: f.log }))], returns: [...returns] };
  return { from: SCRIPT.practice.from, reply: `Hi ${sender},\n\n${lines.join("\n\n")}\n\n${SCRIPT.practice.signoff}`, items: items(list, next), state: next };
};

const checklist = (family) => ({ practice: SCRIPT.practice, items: items(checklistOf(family), noted()) });

module.exports = { answer, checklist };
