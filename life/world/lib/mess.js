/* Real mess, as data per chapter: what is in the family's Drive, what is only in email, what is only on a portal, and what exists nowhere yet. The files land in drive/ and inbox/ so a
   harness can mount them as a Folder store and the portals can show them. A copy is the original's bytes. A scan is an image with no text layer. Nothing here changes what is true. */
"use strict";
const crypto = require("crypto");
const zlib = require("zlib");
const { addDays, fmtDate, money, eml, scan } = require("./std");

const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const deflate = (b) => new Uint8Array(zlib.deflateSync(b, { level: 6 }));

/* An image-only PDF: a scanner's output. The PNG's own compressed stream is embedded with its predictor, so there is no text layer at all. */
function scanPdf(lines, seed) {
  const png = Buffer.from(scan(lines, seed, deflate)), w = png.readUInt32BE(16), h = png.readUInt32BE(20); let at = 8; const idat = [];
  while (at < png.length) { const n = png.readUInt32BE(at), t = png.toString("latin1", at + 4, at + 8); if (t === "IDAT") idat.push(png.subarray(at + 8, at + 8 + n)); at += 12 + n; }
  const data = Buffer.concat(idat), pw = 595, ph = Math.round(pw * h / w), objs = [];
  objs.push("<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  const parts = [Buffer.from("%PDF-1.4\n", "latin1")], offs = []; let off = parts[0].length;
  const put = (b) => { parts.push(b); off += b.length; };
  objs.forEach((o, i) => { offs.push(off); put(Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`, "latin1")); });
  offs.push(off); put(Buffer.from(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /DecodeParms << /Predictor 15 /Colors 1 /BitsPerComponent 8 /Columns ${w} >> /Length ${data.length} >>\nstream\n`, "latin1")); put(data); put(Buffer.from("\nendstream\nendobj\n", "latin1"));
  const content = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`; offs.push(off); put(Buffer.from(`5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`, "latin1"));
  const xref = off; let t = `xref\n0 ${offs.length + 1}\n0000000000 65535 f \n`; for (const o of offs) t += `${String(o).padStart(10, "0")} 00000 n \n`;
  put(Buffer.from(`${t}trailer\n<< /Size ${offs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`, "latin1"));
  return new Uint8Array(Buffer.concat(parts));
}

function buildMess(script, sim, files) {
  const C = sim.cast, A = C.A, B = C.B, both = [A.id, B.id], out = [], chapters = {};
  for (const c of script.chapters) chapters[c.chapter] = { today: c.today, drive: [], inbox: [], portal_only: [], nowhere: [] };
  const agentMail = `hello@${C.agency.accountant.toLowerCase().replace(/[^a-z]/g, "")}.example`;
  const find = (stream, re) => files.find((f) => f.stream === stream && re.test(f.name));
  const add = (ch, zone, rel, bytes, o) => {
    const path = `${zone}/${rel}`, row = { path, kind: o.kind, person: o.person, visible_to: o.visible_to || [o.person], chapter: ch, of: o.of || null, sha256: sha(bytes), size: bytes.length, note: o.note };
    out.push({ path, bytes }); chapters[ch][zone].push(row); return row;
  };
  const copy = (ch, f, rel, o = {}) => { if (f) add(ch, o.zone || "drive", rel, f.bytes, { kind: o.kind || "copy", person: o.person || f.person, visible_to: o.visible_to || f.visible_to, of: f.path, note: o.note }); };
  const mail = (ch, f, who, subject, body) => { if (!f) return; const date = f.delivered_on, bytes = new TextEncoder().encode(eml({ from: `${C.agency.accountant} <${agentMail}>`, to: `${who.name} <${C.shared_mail}>`, subject, date, id: `mess-${f.sha256.slice(0, 12)}`, text: body, html: `<html><body><p>${body}</p></body></html>`, attachments: [{ name: f.name, type: "application/pdf", bytes: f.bytes }] })); add(ch, "inbox", `${who.id}/${date}-${f.name.replace(/\.[a-z]+$/, "")}.eml`, bytes, { kind: "attachment", person: who.id, of: f.path, note: "The PDF inside an email." }); };

  // chapter 0: the one file
  const first = files.find((f) => f.stream === "EVERY-A" && f.held_from === 0);
  copy(0, first, `${A.id}/Downloads/${first.name}`, { note: "What she dropped into the Kitty." });
  chapters[1].nowhere.push({ what: "Her card, her super, her HELP", why: "They exist. The Kitty has not been told, so they are not asked yet, not zero." });
  // chapter 2: half there
  const dec = find("CARD-A", /2026-12/), scanned = find("TAX-A", /FY2026/), s12 = files.find((f) => /^SUPER-A/.test(f.stream) && f.delivered_on <= "2027-02-14" && /pdf$/.test(f.name)) || find("PHI-A", /FY2026/);
  for (const f of files.filter((x) => x.stream === "CARD-A-STMT" && x.delivered_on <= "2027-02-14")) { if (/2026-11-14/.test(f.name)) { sim.note("T2-DRIVE-MISSING-MONTH", { stream: "CARD-A-STMT", missing: f.path, month: "2026-11" }); continue; } copy(2, f, `${A.id}/Bank/Card statements/${f.name}`); }
  copy(2, dec, `${A.id}/Bank/Statement.csv`); copy(2, dec, `${A.id}/Bank/Statement (1).csv`, { kind: "duplicate", note: "The same bytes, saved twice." });
  if (dec) sim.note("T2-BYTE-DUPLICATE", { files: [`drive/${A.id}/Bank/Statement.csv`, `drive/${A.id}/Bank/Statement (1).csv`], of: dec.path });
  const noa = scanned ? [`NOTICE OF ASSESSMENT FY2026`, A.name.toUpperCase(), `ISSUED ${fmtDate(sim.tax[2026].A.assessed_on).toUpperCase()}`, `TAXABLE INCOME ${money(sim.tax[2026].A.res.taxable_income_cents)}`, `RESULT ${money(Math.abs(sim.tax[2026].A.res.result_cents))}`, "FICTIONAL"] : ["BLANK"];
  add(2, "drive", `${A.id}/Tax stuff/scan0003.pdf`, scanPdf(noa, `${C.id}:noa`), { kind: "scan", person: A.id, of: scanned ? scanned.path : null, note: "Printed, signed, scanned at the hospital. No text layer." });
  const r = sim.lines.filter((l) => l.acct === "ACC-A-CARD" && l.cat === "SHOPPING" && l.date < "2027-02-01").sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  add(2, "drive", `${A.id}/Screenshot ${r.date} at 7.42.13 pm.png`, scan([r.desc, `DATE ${r.date}`, `TOTAL $${money(-r.cents)}`, "PAID BY CARD", "FICTIONAL RECEIPT"], `${C.id}:shot`, deflate), { kind: "screenshot", person: A.id, of: null, note: "A photo of a receipt for a card line. Agent tier." });
  sim.note("T2-SCAN", { scan: `drive/${A.id}/Tax stuff/scan0003.pdf`, screenshot: `drive/${A.id}/Screenshot ${r.date} at 7.42.13 pm.png`, line: { account: r.acct, date: r.date, cents: r.cents } });
  if (s12) { copy(2, s12, `${A.id}/Car/${s12.name}`, { kind: "misfiled", note: "A statement in the folder for the car." }); sim.note("T2-MISFILED", { file: `drive/${A.id}/Car/${s12.name}`, truly: s12.stream }); }
  for (const f of files.filter((x) => x.stream === "BILL-POWER" && x.delivered_on <= "2027-02-14")) copy(2, f, `${A.id}/${f.delivered_on}-${f.name}`, { zone: "inbox", kind: "email", note: "Only ever in email." });
  chapters[2].nowhere.push({ what: "January's super contributions", why: "The fund's export closes on the quarter. Nothing states them until April." }, { what: "A list of what she has and has not added", why: "Scope is what she says, and she has not been asked yet." });
  // chapter 3: his side of it
  const bFirst = find("EVERY-B", /2026-07-01-to-2027-02-28/);
  if (bFirst) { const n = C.institutions.B_every.spec.file; copy(3, bFirst, `${B.id}/Downloads/${n}`); copy(3, bFirst, `${B.id}/Downloads/${n.replace(/\.(\w+)$/, " (1).$1")}`, { kind: "duplicate", note: "Downloaded twice." }); }
  const ja = files.filter((f) => f.stream === "JOINT" && f.delivered_on <= "2027-03-31");
  for (const f of ja) copy(3, f, `shared/Joint account/${f.name}`, { person: f.person, visible_to: both, note: "Both of them saved theirs here." });
  chapters[3].nowhere.push({ what: "Which account is whose after joining", why: "They agreed it at the kitchen table. Nothing records it until a person says." }, { what: "Who owns the money in the saver", why: "It stays in one name. The couple's share of it is a conversation, not a document." });
  // chapter 4: tax time
  for (const [k, p] of [["A", A], ["B", B]]) {
    for (const st of [`IS-${k}`, `PHI-${k}`]) { const f = find(st, /FY2027/); copy(4, f, `shared/Tax 2027/${p.first}/${f ? f.name : "x"}`, { person: p.id, visible_to: [p.id] }); }
    const ret = files.find((f) => f.stream === `TAX-${k}` && /^Tax-Return-FY2027/.test(f.name));
    mail(4, ret, p, "Your return is lodged", "Lodged. A copy is attached. Keep this one for five years.");
  }
  const amended = files.find((f) => f.stream === "TAX-B" && /FY2026-amended/.test(f.name) && /^Tax-Return/.test(f.name));
  mail(4, amended, B, "Your amended FY2026 return", "The interest you forgot is in. The extra tax is on the notice.");
  add(4, "inbox", `${A.id}/2027-08-02-what-we-need.eml`, new TextEncoder().encode(eml({ from: `${C.agency.accountant} <${agentMail}>`, to: `${A.name} <${C.shared_mail}>`, subject: "What we need for your tax", date: "2027-08-02", id: "mess-checklist", text: "Please send one zip with income statements, interest, health cover, share plan statements and any receipts. No links, please.", html: "<html><body><p>Please send one zip. No links, please.</p></body></html>" })), { kind: "email", person: A.id, note: "The accountant's checklist. T4-ACCOUNTANT-ZIP." });
  sim.note("T4-ACCOUNTANT-ZIP", { checklist: `inbox/${A.id}/2027-08-02-what-we-need.eml` });
  chapters[4].portal_only.push({ what: "Market value of the plan shares at 30 June 2027", where: "the share plan portal", file: (files.find((f) => f.stream === "RSU-HOLD" && /2027-06-30/.test(f.name)) || {}).path, status: "unconfirmed", note: "T4-CGT-VALUE-30-JUNE. Nobody downloads it until they know they need it." });
  chapters[4].nowhere.push({ what: "A working out of who owns the saver's interest", why: "The accountant will ask. T4-OWNER-NOT-NAME." }, { what: "Work-from-home hours", why: "Never logged, so nothing is claimed." });
  // chapter 5: the estate
  const settle = find("SETTLEMENT", /Settlement/); copy(5, settle, `shared/Home/${settle ? settle.name : "x"}`, { person: A.id, visible_to: both });
  for (const f of files.filter((x) => x.stream === "POLICY" && x.delivered_on <= "2030-06-30" && /Home/.test(x.name) && /2029|2030/.test(x.name))) copy(5, f, `shared/Insurance/${f.name}`, { person: A.id, visible_to: both });
  for (const f of files.filter((x) => x.stream === "WILLS")) copy(5, f, `shared/Wills/${f.name}`, { person: f.person, visible_to: both, kind: "copy", note: "Held as evidence. T5-WILL-NO-KIND." });
  for (const f of files.filter((x) => x.stream === "RECEIPTS" && x.delivered_on <= "2030-06-30")) copy(5, f, `shared/Receipts/${f.name}`, { person: A.id, visible_to: both, note: "T5-WARRANTY." });
  const pram = files.find((f) => f.stream === "RECEIPTS" && /Pram/.test(f.name)), tP = sim.receipts.find((t) => t.name === "Pram");
  if (pram && tP) add(5, "drive", "shared/Receipts/IMG_2041.png", scan([tP.merchant.toUpperCase(), tP.name.toUpperCase(), `SERIAL ${tP.serial}`, `TOTAL $${money(tP.cents)}`, "FICTIONAL RECEIPT"], `${C.id}:pram`, deflate), { kind: "screenshot", person: A.id, visible_to: both, of: pram.path, note: "A photo of the same receipt." });
  chapters[5].nowhere.push({ what: "Life insurance", why: "They mean to. Nothing exists." }, { what: "The children's birth certificates", why: "In a box, not scanned." });
  // chapter 6: the family's own words
  const said = script.chapters.find((c) => c.family_intent).family_intent[0], kid = sim.kids[0];
  add(6, "drive", `shared/Kids/Pocket money.txt`, new TextEncoder().encode(`${kid.first}'s pocket money, from ${fmtDate(sim.pocketMoney)}. ${said.said}\n`), { kind: "intent", person: A.id, visible_to: both, note: "The family's words. T6-MEMO. There is no bank line and there will not be." });
  chapters[6].nowhere.push({ what: "A ledger of pocket money", why: "It lives in a jar and a parent's memory. The Kitty is the first place it will exist." });

  // only in email, as it arrived: whatever came by mail since the last chapter, in the mailbox of the person it reached
  const full = script.chapters.filter((c) => c.status === "full"), has = new Set(out.map((x) => x.path));
  for (let i = 0; i < full.length; i++) {
    const c = full[i], since = i ? full[i - 1].today : "0000";
    for (const f of files.filter((x) => x.where === "email" && x.delivered_on > since && x.delivered_on <= c.today)) {
      const rel = `${f.person}/${f.delivered_on}-${f.name}`;
      if (/\.eml$/.test(f.name)) { if (!has.has(`inbox/${rel}`)) copy(c.chapter, f, rel, { zone: "inbox", kind: "email", note: "Only ever in email." }); } else if (![...has].some((p) => p.includes(f.name.replace(/\.[a-z]+$/, "")) && p.startsWith("inbox/"))) mail(c.chapter, f, sim.people[f.stream.endsWith("-B") ? "B" : "A"], `Your ${f.name.replace(/[-.]/g, " ").replace(/ pdf$/, "")}`, "Attached, for your records.");
    }
  }
  // what is only on a portal when a chapter starts: everything that exists there and the household has not fetched
  for (const c of script.chapters) {
    if (c.status === "not_generated") continue;
    const by = {};
    for (const f of files) { if (f.where !== "portal" || f.delivered_on > c.today || (f.held_from != null && f.held_from < c.chapter)) continue; (by[f.stream] = by[f.stream] || []).push(f.delivered_on); }
    for (const [stream, d] of Object.entries(by)) chapters[c.chapter].portal_only.push({ stream, files: d.length, first: d.sort()[0], last: d[d.length - 1] });
  }
  void addDays;
  return { files: out, chapters };
}

module.exports = { buildMess, scanPdf };
