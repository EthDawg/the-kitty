/* The Kitty kit: EntryRow, EntryList and ReviewCard. One row component renders anything that happened: a transaction, a trade,
   a valuation, a contract charge. Pure functions from the engine's model to HTML strings, no DOM, so node tests can render them;
   the page binds the clicks. Runs in the page (window.Kit) and in node (module.exports). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("../engine.js")); else root.Kit = factory(root.Engine);
})(typeof self !== "undefined" ? self : this, function (E) {
  "use strict";
  const K = {};
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  K.esc = esc;
  const ico = (id, cls) => `<svg class="${cls || "ic"}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
  K.ico = ico;
  // two letters: the first letters of the first two words, or the first two letters of a one-word name
  K.initials = (name) => { const w = String(name || "").replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(Boolean); if (!w.length) return "?"; return (w.length === 1 ? w[0].slice(0, 2) : w[0][0] + w[1][0]).toUpperCase(); };

  // ---------- per-render context: what every row needs that is not on the entry itself ----------
  K.context = (m, extra) => {
    // a provider can hold more than one contract (Allianz: car and travel), so a row matches on provider and category
    const providers = new Map(); for (const c of m.contracts || []) if (c.status === "active" && c.provider) { const k = String(c.provider).toLowerCase(); if (!providers.has(k)) providers.set(k, []); providers.get(k).push(c); }
    const paired = new Set(); if (m.sheetVersion >= 2) for (const p of E.transfers(m).pairs) for (const e of p.entries) paired.add(e.id);
    return Object.assign({ m, providers, paired, reviewIds: new Set(), logos: {}, today: m.asOf }, extra || {});
  };
  const nameOf = (e) => (e.kind === "transaction" ? (e.desc && e.desc !== e.raw ? e.desc : e.mer ? e.mer.name : e.desc || e.raw || "?") : e.desc || "");
  K.nameOf = nameOf;
  const contractFor = (e, ctx) => {
    if (e.kind !== "transaction") return null;
    const list = ctx.providers.get(nameOf(e).toLowerCase()) || (e.mer && ctx.providers.get(String(e.mer.name).toLowerCase())) || null;
    return (list || []).find((c) => !c.cat || !e.cat || c.cat === e.cat) || null;
  };
  K.contractFor = contractFor;
  const isRefund = (e) => e.kind === "transaction" && e.flow === "Expense" && (e.amount > 0 || /\bREFUND\b|\bREVERSAL\b|\bCREDIT ADJ\b/i.test(e.raw || ""));
  K.isRefund = isRefund;

  // ---------- the monogram: two letters on a disc tinted in the brand hue, the category icon pinned to its corner ----------
  K.monogram = (e, ctx, size) => {
    const m = ctx.m; const acct = m.acctById[e.acct];
    if (e.kind !== "transaction") {
      const kind = e.kind === "trade" ? "trade" : (acct && acct.type ? acct.type : "valuation");
      const icon = E.kindIcon(kind) || E.kindIcon(e.kind); const hue = (E.dictionary().kinds[String(kind).toLowerCase()] || {}).hue || "#5B3DF5";
      return `<span class="mono kind ${size || ""}" style="--mh:${esc(hue)}" aria-hidden="true">${ico(icon, "mic")}</span>`;
    }
    const mer = e.mer || E.merchant(e.raw || e.desc, m); const name = nameOf(e);
    const cat = e.cat || ""; const icon = mer.icon || E.catIcon(cat, m); const logo = mer.id && ctx.logos && ctx.logos[mer.id];
    const flow = e.flow === "Income" ? " in" : e.flow === "Transfer" ? " mv" : "";
    const inner = logo ? `<img src="${esc(logo)}" alt="">` : e.flow === "Transfer" && !mer.dict ? ico("transfer", "mic") : `<b>${esc(K.initials(name))}</b>`;
    return `<span class="mono${flow} ${size || ""}" style="--mh:${esc(mer.hue)}" aria-hidden="true">${inner}<span class="cic" style="--ch:${esc(E.catHue(cat, m))}">${ico(icon, "cici")}</span></span>`;
  };

  // ---------- badges that mean something ----------
  K.badges = (e, ctx) => {
    const out = []; const m = ctx.m;
    if (e.status && e.status !== "settled") out.push(["pending", "pending", "pending"]);
    const c = contractFor(e, ctx); if (c) out.push(["recurring", String(c.cadence || "recurring").toLowerCase(), "recurring"]);
    if (isRefund(e)) out.push(["refund", "refund", "refund"]);
    if (m.dupes && m.dupes.has(e.id) && !e.dupOf) out.push(["duplicate", "possible double", "dup"]);
    if (e.dupOf) out.push(["duplicate", "marked as a double", "dup"]);
    if (ctx.reviewIds && ctx.reviewIds.has(e.id)) out.push(["review", "needs review", "review"]);
    if (e.split && e.split.length) out.push(["split", `split ${e.split.length} ways`, "split"]);
    if (e.kind === "transaction" && e.flow === "Transfer") { if (e.transferId && ctx.paired.has(e.id)) { const mate = m.acctById[e.transferAcct]; out.push(["transfer", mate ? `⇄ ${mate.name}` : "paired", "pair"]); } else if (e.matchedWith) { const mate = m.entryById && m.entryById[e.matchedWith], a = mate && m.acctById[mate.acct]; out.push(["transfer", a ? `⇄ ${a.name}` : "matched", "pair"]); } else out.push(["warning", "no mate", "warn"]); }
    if (e.worth) out.push(["worth", `worth it: ${e.worth}`, "worth"]);
    return out.map(([icon, label, cls]) => `<span class="bdg ${cls}">${ico(icon)}<span>${esc(label)}</span></span>`).join("");
  };

  // ---------- the row ----------
  K.amount = (e) => {
    if (e.kind === "valuation") return `<span class="amt num val">${E.fmt0(e.amount)}</span>`;
    const v = e.amount; const cls = e.flow === "Transfer" ? "mv" : v > 0 ? "in" : "";
    return `<span class="amt num ${cls}">${v > 0 ? "+" : "−"}${E.fmt(Math.abs(v), { cents: true })}</span>`;
  };
  K.title = (e, ctx) => {
    const m = ctx.m; const acct = m.acctById[e.acct];
    if (e.kind === "trade") { const units = e.units != null ? (Number.isInteger(e.units) ? e.units : e.units.toFixed(2)) : ""; const ticker = (acct && acct.ticker) || (acct && /\b[A-Z]{2,5}\b/.test(acct.note || "") ? acct.note.match(/\b[A-Z]{2,5}\b/)[0] : "") || "units"; return e.price != null && e.units != null ? `${units} ${esc(ticker)} at ${E.fmt(e.price)}` : esc(e.desc || "Trade"); }
    if (e.kind === "valuation") return esc(acct ? acct.name : e.acct);
    return esc(nameOf(e));
  };
  // a day in a list: "5 Jan", with the year when it is not the as-of year, so two Januaries never read alike
  const day = (d, ctx) => E.fmtDay(d, { year: String(d).slice(0, 4) !== String(ctx.today || ctx.m.asOf).slice(0, 4) });
  K.day = day;
  K.subtitle = (e, ctx, o = {}) => {
    const m = ctx.m; const acct = m.acctById[e.acct]; const parts = [];
    if (e.kind === "valuation") { parts.push({ appraisal: "value from an appraisal", statement: "balance from statement", market: "market value", estimate: "an estimate" }[String(e.source || "").toLowerCase()] || (e.source ? `from ${e.source}` : "valuation")); if (o.date) parts.push(day(e.date, ctx)); return parts.join(" · "); }
    if (e.kind === "trade") { if (acct) parts.push(acct.name); if (e.source) parts.push(e.source); if (o.date) parts.push(day(e.date, ctx)); return parts.join(" · "); }
    const c = contractFor(e, ctx);
    if (o.category !== false) { const cat = m.catById[e.cat]; parts.push(cat ? cat.name : e.cat || "Uncategorised"); }
    if (c && o.cadence !== false) parts.push(`${E.cap(String(c.cadence || "").toLowerCase())}${c.name && c.name.toLowerCase() !== nameOf(e).toLowerCase() ? ` · ${c.name}` : ""}`);
    if (o.date) parts.push(day(e.date, ctx));
    if (acct && o.acct !== false) parts.push(acct.name);
    if (e.person && e.person !== "Joint") parts.push(e.person);
    if (m.firstSeen && m.firstSeen.has(e.id) && e.flow === "Expense") parts.push("first time here");
    if (e.foreign != null && e.foreignCcy) parts.push(`${e.foreignCcy} ${Math.abs(e.foreign).toFixed(2)}`);
    return parts.map(esc).join(" · ");
  };
  // o: { date, acct, category, cadence, tag (element name, default button), raw (show the raw descriptor as a third line) }
  K.EntryRow = (e, ctx, o = {}) => {
    const tag = o.tag || "button"; const badges = o.badges === false ? "" : K.badges(e, ctx);
    return `<${tag} class="erow${o.cls ? " " + o.cls : ""}" data-entry="${esc(e.id)}" data-kind="${esc(e.kind)}"${tag === "button" ? ' type="button"' : ""}>${K.monogram(e, ctx)}<span class="mid"><span class="t"><span class="nm">${K.title(e, ctx)}</span>${badges ? `<span class="bdgs">${badges}</span>` : ""}</span><span class="s">${K.subtitle(e, ctx, o)}</span>${o.raw && e.raw ? `<span class="raw">${esc(e.raw)}</span>` : ""}</span>${K.amount(e)}</${tag}>`;
  };

  // ---------- the list, grouped by day with the day's outgoings ----------
  K.EntryList = (entries, ctx, o = {}) => {
    if (!entries.length) return `<div class="empty">${o.empty || "Nothing here."}</div>`;
    const days = new Map(); for (const e of entries) { if (!days.has(e.date)) days.set(e.date, []); days.get(e.date).push(e); }
    const today = ctx.today || ctx.m.asOf;
    return `<div class="feed elist">${[...days.entries()].map(([d, es]) => { const out = es.filter((e) => e.kind === "transaction" && e.flow === "Expense").reduce((a, e) => a - e.amount, 0); const inc = es.filter((e) => e.kind === "transaction" && e.flow === "Income").reduce((a, e) => a + e.amount, 0); const tot = [out > 0 ? `<span class="out">−${E.fmt0(out)} spent</span>` : "", inc > 0 && o.showIn !== false ? `<span class="in">+${E.fmt0(inc)} in</span>` : ""].filter(Boolean).join(`<span class="sep" aria-hidden="true"> · </span>`); return `<section class="dayg" aria-label="${esc(E.fmtDay(d, { year: true }))}"><div class="day"><span>${esc(E.dayLabel(d, today))}</span><span class="tot num">${tot}</span></div>${es.map((e) => K.EntryRow(e, ctx, o)).join("")}</section>`; }).join("")}</div>`;
  };

  // ---------- the review card: one entry, why it is here, and its actions in one or two taps ----------
  K.suggestions = (item, ctx) => {
    const m = ctx.m, e = item.entry; const out = []; const seen = new Set();
    // "Transfers between own accounts" only fits when another account holds the other side; money from a person is not that
    const ownTransfer = (id) => (m.catById[id] || {}).flow === "Transfer" && !E.transferMates(m, e).length;
    const push = (id) => { if (id && m.catById[id] && !seen.has(id) && id !== "UNCAT" && !ownTransfer(id)) { seen.add(id); out.push(m.catById[id]); } };
    if (e.mer && e.mer.dict) push(e.mer.dict.category_id);
    for (const c of E.candidates(e.raw || e.desc, 3)) push(c.category_id);
    if (e.cat && e.cat !== "UNCAT") push(e.cat);
    if (out.length < 3) { const counts = new Map(); for (const t of m.tx) if (t.flow === "Expense" && t.acct === e.acct) counts.set(t.cat, (counts.get(t.cat) || 0) + 1); for (const [id] of [...counts.entries()].sort((a, b) => b[1] - a[1])) { if (out.length >= 3) break; push(id); } }
    return out.slice(0, 3);
  };
  K.ReviewCard = (item, ctx, o = {}) => {
    const m = ctx.m, e = item.entry; const r = new Set(item.reasons);
    const primary = r.has("duplicate") ? "merge" : r.has("unpaired") ? "match" : r.has("uncategorised") || r.has("unresolved") ? "cat" : "confirm";
    const sugg = r.has("duplicate") ? [] : K.suggestions(item, ctx);
    const mates = r.has("unpaired") ? E.transferMates(m, e).slice(0, 3) : [];
    const dup = item.dupOf ? m.entryById[item.dupOf] : null;
    const kbd = (k) => (o.keys === false ? "" : `<kbd>${k}</kbd>`);
    const chips = [];
    if (sugg.length) chips.push(`<span class="rsugg">${sugg.map((c, i) => `<button type="button" class="chip cat" data-ract="pick" data-cat="${esc(c.id)}" style="--ch:${esc(E.catHue(c.id, m))}">${ico(E.catIcon(c.id, m))}${esc(c.name)}${kbd(i + 1)}</button>`).join("")}</span>`);
    if (mates.length) chips.push(`<span class="rsugg">${mates.map((x, i) => { const a = m.acctById[x.acct]; return `<button type="button" class="chip" data-ract="mate" data-mate="${esc(x.id)}">${ico("transfer")}${esc(a ? a.name : x.acct)} · ${E.fmtDay(x.date)}${kbd(i + 1)}</button>`; }).join("")}</span>`);
    const acts = [];
    if (r.has("duplicate")) acts.push(`<button type="button" class="chip${primary === "merge" ? " primary" : ""}" data-ract="merge">${ico("duplicate")}Merge double${kbd("D")}</button>`);
    acts.push(`<button type="button" class="chip${primary === "cat" ? " primary" : ""}" data-ract="cat">${ico("edit")}Categorise${kbd("C")}</button>`);
    // a row with no category has nothing to confirm: "Looks right" would file it as uncategorised for good
    if (!r.has("uncategorised")) acts.push(`<button type="button" class="chip${primary === "confirm" ? " primary" : ""}" data-ract="confirm">${ico("check")}${r.has("duplicate") ? "Keep both" : r.has("unpaired") ? "Not a transfer" : "Looks right"}${kbd("↵")}</button>`);
    if (r.has("unpaired") && !mates.length) acts.push(`<span class="sub">No mate within four days.</span>`);
    acts.push(`<button type="button" class="chip" data-ract="split">${ico("split")}Split${kbd("S")}</button>`);
    // a rule that only says "uncategorised" is not a rule that knows the merchant: the cookie still offers to propose one
    const noRule = !(e.mer && e.mer.source === "rule" && e.mer.cat && e.mer.cat !== "UNCAT") && !r.has("duplicate") && !r.has("unpaired");
    return `<article class="rcard" data-rid="${esc(e.id)}" tabindex="0" aria-label="${esc(nameOf(e))}, ${esc(item.why)}">
      ${K.EntryRow(e, ctx, { date: true, raw: true, badges: false })}
      <p class="rwhy">${ico("review")}<span>${esc(E.cap(item.why))}${dup ? ` (${esc(nameOf(dup))}, ${esc(day(dup.date, ctx))}, ${esc(E.fmt(Math.abs(dup.amount), { cents: true }))})` : ""}</span></p>
      <div class="racts">${chips.join("")}<span class="rbtns">${acts.join("")}</span></div>
      ${noRule && ctx.cookie && o.cookie !== false ? `<div class="rcookie"><button type="button" class="k-fortune" data-cookie="${esc(e.id)}" aria-label="${ctx.nativeAsk ? "Check past entries for this merchant" : "Crack the cookie: the Kitty proposes a merchant and a rule for this descriptor"}">${ctx.cookie}</button><span class="cookiehint">${ctx.nativeAsk ? "Check how this household categorised matching entries." : ctx.sampleOn ? "No rule knows this one. Crack the cookie and the Kitty proposes a merchant and a rule; you decide." : "No rule knows this one. Open this page in Claude to let the Kitty propose a rule."}</span></div><div class="rslip" hidden></div>` : ""}
    </article>`;
  };

  // ---------- worth it? one tap, no score ----------
  K.WorthRow = (e, ctx) => `<div class="wrow" data-wid="${esc(e.id)}" tabindex="0">${K.EntryRow(e, ctx, { date: true, badges: false, tag: "div" })}<span class="wbtns" role="group" aria-label="Worth it?">${[["yes", "Yes", "Y"], ["meh", "Meh", "M"], ["no", "No", "N"]].map(([v, l, k]) => `<button type="button" class="chip w-${v}" data-worth="${v}">${l}<kbd>${k}</kbd></button>`).join("")}</span></div>`;

  return K;
});
