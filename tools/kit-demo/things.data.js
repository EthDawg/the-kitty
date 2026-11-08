// Davies input for the Things module: Contracts, Assets and Decision Options mapped onto things.
// The same mapping lives in the page (src/app.js thingsInput); keep them in step.
"use strict";
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..", "..");
function csv(p) {
  const t = fs.readFileSync(path.join(ROOT, p), "utf8").trim().split(/\r?\n/);
  const split = (l) => { const out = []; let cur = "", q = false; for (let i = 0; i < l.length; i++) { const c = l[i]; if (q) { if (c === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; } else if (c === '"') q = true; else if (c === ",") { out.push(cur); cur = ""; } else cur += c; } out.push(cur); return out; };
  const h = split(t[0]); return t.slice(1).map((l) => Object.fromEntries(split(l).map((v, i) => [h[i], v])));
}
module.exports = function () {
  const snap = JSON.parse(fs.readFileSync(path.join(ROOT, "data/snapshot-v2.json"), "utf8"));
  const input = thingsInput(snap, csv("data/v3/decision-options.csv"));
  const IMG = { HOME: "house", RENTAL: "townhouse", CAR: "car-wagon", PHONES: "sim", HEALTH: "health", STREAM: "streaming", CLOUD: "cloud", AI: "ai", ACTIVE: "active" };
  for (const t of input.things) { const f = path.join(ROOT, "src/kit/art", (IMG[t.id] || "") + ".svg"); if (IMG[t.id] && fs.existsSync(f)) t.image = "data:image/svg+xml;base64," + fs.readFileSync(f).toString("base64"); }
  return input;
};
// Which thing each contract belongs to, and the group each thing sits in. Loans and the lease live on Property and Goals.
const PLACE = {
  C0011: ["CAR", "Family car", "Wheels"], C0012: ["HOME", "Family home, Brunswick", "Home & property"], C0014: ["HOME", "Family home, Brunswick", "Home & property"],
  C0013: ["RENTAL", "Investment townhouse, Geelong", "Home & property"], C0015: ["PHONES", "Phones", "Phones & devices"], C0010: ["HEALTH", "Health cover", "Plans"],
  C0001: ["STREAM", "Streaming and music", "Plans"], C0002: ["STREAM", "Streaming and music", "Plans"], C0003: ["STREAM", "Streaming and music", "Plans"], C0004: ["STREAM", "Streaming and music", "Plans"], C0005: ["STREAM", "Streaming and music", "Plans"], C0017: ["STREAM", "Streaming and music", "Plans"],
  C0006: ["CLOUD", "Cloud storage", "Storage"], C0007: ["CLOUD", "Cloud storage", "Storage"], C0008: ["AI", "ChatGPT Plus", "Plans"],
  C0009: ["ACTIVE", "Gym and swim school", "Plans"], C0016: ["ACTIVE", "Gym and swim school", "Plans"],
};
const NEXT = { C0011: "Renews", C0012: "Renews", C0013: "Renews", C0010: "Next payment" };
const perMonth = (c) => { const a = +c.amount || 0; return /annual/i.test(c.cadence) ? a / 12 : /week/i.test(c.cadence) ? (a * 52) / 12 : a; };
function thingsInput(snap, options) {
  const asOf = snap.settings.find((r) => r.setting === "As-of date").value;
  const decided = new Map(snap.decisions.filter((d) => d.ref_kind === "contract").map((d) => [d.ref_id, d.value]));
  const things = new Map();
  for (const c of snap.contracts) {
    const p = PLACE[c.contract_id]; if (!p || c.status !== "active") continue;
    if (decided.get(c.contract_id) === "Cancel") continue; // decided and gone; the Decisions tab keeps the history
    const [id, name, group] = p;
    if (!things.has(id)) things.set(id, { id, name, group, owner: c.owner, image: null, monthly: 0, owed: 0, exit: 0, nextDate: null, nextLabel: "", confidence: "Measured", contracts: [], source: "Contracts tab" });
    const t = things.get(id), m = Math.round(perMonth(c) * 100) / 100;
    t.monthly = Math.round((t.monthly + m) * 100) / 100;
    if (t.owner !== c.owner) t.owner = "Joint";
    t.contracts.push({ id: c.contract_id, product: c.name, provider: c.provider, monthly: m, cost: +c.amount, cadence: (c.cadence || "").toLowerCase(), start: c.start_date, end: c.end_date, nextDate: c.next_date, exit: 0, decision: decided.get(c.contract_id) || "", confidence: "Measured", source: `Contracts ${c.contract_id}` });
    if (c.next_date && c.next_date >= asOf && (!t.nextDate || c.next_date < t.nextDate)) { t.nextDate = c.next_date; t.nextLabel = `${NEXT[c.contract_id] || "Next charge"}: ${c.name}`; }
  }
  // decisions: one card per Decision ID, options in sheet order; the ref is a contract, so point it at that contract's thing
  const byId = new Map();
  for (const o of options) {
    if (!byId.has(o["Decision ID"])) byId.set(o["Decision ID"], { id: o["Decision ID"], question: o.Question, ref: (PLACE[o.Ref] || [o.Ref])[0], decideBy: o["Decide by"], status: o.Status || "Open", source: "", options: [] });
    const d = byId.get(o["Decision ID"]); if (o.Question && !d.question) d.question = o.Question;
    d.options.push({ option: o.Option, upfront: +o.Upfront || 0, perMonth: +o["Per month"] || 0, months: +o.Months || 0, extra: +o.Extra || 0, total: o.Total === "" ? null : +o.Total, recommended: /^(true|yes|1)$/i.test(o.Recommended), note: o.Note, source: o.Source });
  }
  for (const d of byId.values()) d.source = [...new Set(d.options.map((o) => o.source).filter(Boolean))].join("; ");
  return { asOf, today: asOf, things: [...things.values()], decisions: [...byId.values()] };
}
module.exports.thingsInput = thingsInput;
