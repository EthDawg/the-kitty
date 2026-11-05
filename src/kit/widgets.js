/* The Kitty kit: widgets. A widget is a manifest (id, domain, requires, sizes, data, render, drill). Signals switch widgets on; the
   model decides, never a setting, and a widget with nothing to say is left out rather than drawn empty. The layout is a per-person
   preference and never touches the sheet. Pure functions, so node tests can run them; the page mounts the canvas.
   Runs in the page (extends window.Kit) and in node (module.exports). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("../engine.js"), require("./entry-row.js"));
  else Object.assign(root.Kit, factory(root.Engine, root.Kit));
})(typeof self !== "undefined" ? self : this, function (E, Kit) {
  "use strict";
  const K = {};
  const esc = Kit.esc;
  const COLS = 12;
  const active = (m, f) => m.accounts.filter((a) => a.status === "active" && f(String(a.type || "").toLowerCase(), a));
  const held = (m, f) => { const rows = active(m, f).map((a) => ({ id: a.id, name: a.name, sub: a.purpose || a.bank || "", value: E.balanceAt(a, m.asOf) })); return rows.length ? { rows, total: rows.reduce((s, r) => s + (r.value || 0), 0) } : null; };
  const list = (rows, size) => `<div class="wlist">${rows.slice(0, size === "wide" ? 8 : 4).map((r) => `<div class="whrow"><span class="mid"><span class="t">${esc(r.name)}</span>${r.sub ? `<span class="s">${esc(r.sub)}</span>` : ""}</span><b class="num">${E.fmt0(r.value)}</b></div>`).join("")}</div>`;
  const heldCard = (q, drill) => (p, size) => `<div class="cardhead"><span class="q">${esc(q)}</span><button class="linkbtn" data-open="${esc(drill)}">Net worth →</button></div><div class="wtotal num">${E.fmt0(p.total)}</div>${list(p.rows, size)}`;
  const nextDue = (c, asOf) => (c.next && c.next >= asOf ? c.next : null);

  // The core widgets' markup needs the page (its hero, its charts), so the page hands them over with Kit.bindCore. The rest live here.
  K.WIDGETS = [
    { id: "hero", domain: "everyday", title: "Where you stand", requires: [], core: true, sizes: [{ w: 12, variant: "wide" }], drill: "trust" },
    { id: "review", domain: "everyday", title: "Review", requires: [], core: true, sizes: [{ w: 12, variant: "wide" }, { w: 6, variant: "half" }], drill: "review" },
    { id: "needs", domain: "everyday", title: "What needs you", requires: [], core: true, sizes: [{ w: 12, variant: "wide" }, { w: 6, variant: "half" }], drill: "needs" },
    { id: "upcoming", domain: "everyday", title: "What's coming up", requires: [], core: true, sizes: [{ w: 5, variant: "half" }, { w: 7, variant: "half" }, { w: 12, variant: "wide" }], drill: "upcoming" },
    { id: "months", domain: "everyday", title: "The last 12 months", requires: [], core: true, sizes: [{ w: 7, variant: "half" }, { w: 5, variant: "half" }, { w: 12, variant: "wide" }], drill: "insights" },
    { id: "goals", domain: "everyday", title: "Saving for", requires: [], core: true, sizes: [{ w: 12, variant: "wide" }, { w: 6, variant: "half" }], drill: "goals" },
    { id: "ideas", domain: "everyday", title: "Ways to get there faster", requires: [], core: true, sizes: [{ w: 12, variant: "wide" }, { w: 6, variant: "half" }], drill: "goals:save" },
    { id: "property", domain: "property", title: "Property", requires: ["has_property"], sizes: [{ w: 6, variant: "half" }, { w: 12, variant: "wide" }], drill: "networth", data: (m) => held(m, (t) => t === "property"), render: heldCard("Property", "networth") },
    { id: "super", domain: "super", title: "Super", requires: ["has_super"], sizes: [{ w: 6, variant: "half" }, { w: 12, variant: "wide" }], drill: "networth", data: (m) => held(m, (t) => t === "super" || t === "smsf"), render: heldCard("Super", "networth") },
    { id: "shares", domain: "shares", title: "Shares", requires: ["has_shares"], sizes: [{ w: 6, variant: "half" }, { w: 12, variant: "wide" }], drill: "networth", data: (m) => held(m, (t) => t === "shares"), render: heldCard("Shares", "networth") },
    { id: "crypto", domain: "crypto", title: "Crypto", requires: ["has_crypto"], sizes: [{ w: 6, variant: "half" }, { w: 12, variant: "wide" }], drill: "networth", data: (m) => held(m, (t) => t === "crypto"), render: heldCard("Crypto", "networth") },
    { id: "things", domain: "things", title: "Things", requires: ["has_things"], sizes: [{ w: 6, variant: "half" }, { w: 12, variant: "wide" }], drill: "networth", data: (m) => held(m, (t) => t === "vehicle" || t === "device"), render: heldCard("Things", "networth") },
    { id: "contracts", domain: "contracts", title: "Contracts", requires: ["has_contracts"], sizes: [{ w: 6, variant: "half" }, { w: 12, variant: "wide" }], drill: "upcoming",
      data: (m) => {
        const rows = m.contracts.filter((c) => c.status === "active"); if (!rows.length) return null;
        const due = rows.filter((c) => nextDue(c, m.asOf)).sort((a, b) => (a.next < b.next ? -1 : 1));
        return { count: rows.length, due: due.map((c) => ({ name: c.name, sub: `${c.kind} · ${E.fmtMonth(c.next, true)}`, value: c.amount })) };
      },
      render: (p, size) => `<div class="cardhead"><span class="q">Contracts</span><button class="linkbtn" data-open="upcoming">Upcoming →</button></div><div class="wtotal num">${p.count} active</div>${p.due.length ? list(p.due, size) : `<div class="empty">Nothing dated ahead of the as-of date.</div>`}` },
  ];
  const byId = new Map(K.WIDGETS.map((w) => [w.id, w]));
  K.widget = (id) => byId.get(id);
  K.bindCore = (cores) => { for (const [id, c] of Object.entries(cores)) Object.assign(byId.get(id), c); };

  // A widget shows when every signal it requires is true and its data has something to say.
  K.eligible = (m, signals, widgets) => (widgets || K.WIDGETS).filter((w) => w.requires.every((s) => signals[s]) && (!w.data || w.data(m) != null));
  // Lay items out in order, left to right, wrapping at twelve columns.
  K.pack = (items, y0) => {
    let x = 0, y = y0 || 0;
    return items.map((it) => { if (x + it.w > COLS) { x = 0; y += 1; } const out = { ...it, x, y }; x += it.w; if (x >= COLS) { x = 0; y += 1; } return out; });
  };
  K.defaultItems = (ws) => K.pack(ws.map((w) => ({ id: w.id, w: w.sizes[0].w })));
  // Snap a dragged width to the nearest size the manifest declares: a different variant, never a stretched one.
  K.snapWidth = (w, wanted) => w.sizes.reduce((best, s) => (Math.abs(s.w - wanted) < Math.abs(best.w - wanted) ? s : best), w.sizes[0]);
  K.variant = (w, width) => K.snapWidth(w, width).variant;

  /* saved: { items:[{id,x,y,w}], hidden:[id], seen:[id] }, or nothing for a first visit. Returns the items to draw and the widgets a
     signal just turned on: each signal widget is added once and recorded in seen, so hiding one (or the undo) sticks. Saved items
     whose signal has gone are skipped, not forgotten, so they come back where they were. */
  K.layout = (ws, saved) => {
    const seen = new Set((saved && saved.seen) || []), hidden = new Set((saved && saved.hidden) || []);
    const on = new Set(ws.map((w) => w.id));
    const base = saved && saved.items && saved.items.length ? saved.items : K.defaultItems(ws.filter((w) => w.core));
    const items = base.filter((i) => on.has(i.id) && !hidden.has(i.id)).map((i) => { const w = byId.get(i.id); return { ...i, w: K.snapWidth(w, i.w).w }; });
    const placed = new Set(base.map((i) => i.id));
    const added = ws.filter((w) => !w.core && !placed.has(w.id) && !seen.has(w.id) && !hidden.has(w.id));
    const coreNew = ws.filter((w) => w.core && !placed.has(w.id) && !hidden.has(w.id));
    items.push(...K.pack(coreNew.concat(added).map((w) => ({ id: w.id, w: w.sizes[0].w })), items.reduce((max, i) => Math.max(max, i.y + 1), 0)));
    items.sort((a, b) => a.y - b.y || a.x - b.x);
    return { items, added: added.map((w) => w.id), hiddenOn: ws.filter((w) => hidden.has(w.id)).map((w) => w.id) };
  };
  // Saving keeps what a lost signal took off the page, so it can come back where it was; a hidden widget was taken off on purpose.
  K.keepAbsent = (items, prior, hidden) => { const here = new Set(items.map((i) => i.id)), off = new Set(hidden || []); return items.concat((prior || []).filter((i) => !here.has(i.id) && !off.has(i.id))); };
  // Move an item up or down the reading order; the arrows land here, and the page packs the result.
  K.reorder = (items, id, delta) => {
    const a = items.slice(); const i = a.findIndex((x) => x.id === id), j = i + delta; if (i < 0 || j < 0 || j >= a.length) return items;
    [a[i], a[j]] = [a[j], a[i]]; return a;
  };
  // Small kit pieces with no home in the row file. The gallery renders them; the arrange tray is the first real user.
  K.Chip = (label, on) => `<button class="chip${on ? " on" : ""}">${esc(label)}</button>`;
  K.StatTile = (k, v, d) => `<div class="stat"><div class="k">${esc(k)}</div><div class="v num">${esc(v)}</div>${d ? `<div class="sub">${esc(d)}</div>` : ""}</div>`;
  K.EmptyState = (text) => `<div class="empty">${esc(text)}</div>`;
  K.Skeleton = (lines) => `<div class="kskel" aria-hidden="true">${Array.from({ length: lines || 3 }, (_, i) => `<span style="width:${92 - i * 14}%"></span>`).join("")}</div>`;
  K.Tray = (items) => `<div class="tray" role="group" aria-label="Hidden widgets">${items.map((i) => `<button class="chip" data-wshow="${esc(i.id)}">+ ${esc(i.title)}</button>`).join("")}</div>`;
  return K;
});
