/* The Kitty kit: Things. What the household owns and is tied to, and the choices waiting on it.
   One module, two pages: the public Kitty maps Contracts, Assets and Decision Options onto the input; a household page
   maps its own record. The module never knows whose household it draws. Pure model, string render, delegated events.
   Runs in the page (extends window.Kit) and in node (module.exports). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Kit = Object.assign(root.Kit || {}, { Things: factory() });
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (v) => (v == null || v === "" || !isFinite(+v) ? null : +v);
  const money = (v, cents) => (v == null ? "–" : (v < 0 ? "−" : "") + "$" + Math.abs(v).toLocaleString("en-AU", { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 }));
  const smart = (v) => money(v, v != null && Math.abs(v) < 1000 && Math.round(v) !== v);
  const whole = (v) => money(v == null ? null : Math.round(v), false);
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const day = (iso) => { if (!iso) return ""; const [y, m, d] = iso.split("-").map(Number); return `${d} ${MON[m - 1]} ${y}`; };
  const dayShort = (iso, ref) => { if (!iso) return ""; const [y, m, d] = iso.split("-").map(Number); return `${d} ${MON[m - 1]}${ref && ref.slice(0, 4) === String(y) ? "" : " " + y}`; };
  const toDate = (iso) => new Date(iso + "T00:00:00Z");
  const days = (a, b) => Math.round((toDate(b) - toDate(a)) / 864e5);
  const monthsBetween = (a, b) => { const A = toDate(a), B = toDate(b); return (B.getUTCFullYear() - A.getUTCFullYear()) * 12 + (B.getUTCMonth() - A.getUTCMonth()) - (B.getUTCDate() < A.getUTCDate() ? 1 : 0); };
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const GROUP_ORDER = ["Home & property", "Wheels", "Phones & devices", "Plans", "Storage", "Insurance", "Subscriptions"];
  // What a confidence word means, so a chip can explain itself. Records use their own words; unknown words pass through.
  const CONF = {
    measured: ["From the bill", "Read from a bill, statement or the provider's own page."],
    derived: ["Worked out", "Calculated from other figures on the record."],
    stated: ["Told us", "Said by a person, not yet seen on a document."],
    "stated by ethan": ["Told us", "Said by a person, not yet seen on a document."],
    estimate: ["Estimate", "A best guess until a document confirms it."],
    "not read": ["Not read", "Nobody has read the document behind this yet."],
    quote: ["Quoted", "From a written quote; it can change."],
  };
  const chip = (c) => { if (!c) return ""; const k = CONF[String(c).toLowerCase()] || [String(c), ""]; return `<span class="kx-th-chip" title="${esc(k[1])}">${esc(k[0])}</span>`; };

  function model(input) {
    if (!input || (!Array.isArray(input.things) && !Array.isArray(input.decisions))) return null;
    const today = input.today || input.asOf;
    const things = (input.things || []).map((t) => ({ ...t, monthly: num(t.monthly), owed: num(t.owed), exit: num(t.exit), contracts: (t.contracts || []).map((c) => ({ ...c, monthly: num(c.monthly), cost: num(c.cost), exit: num(c.exit) })) }));
    const byGroup = new Map();
    for (const t of things) { const g = t.group || "Other"; if (!byGroup.has(g)) byGroup.set(g, []); byGroup.get(g).push(t); }
    const groups = [...byGroup.entries()].map(([group, list]) => ({ group, monthly: list.reduce((s, t) => s + (t.monthly || 0), 0), things: list.sort((a, b) => (b.monthly || 0) - (a.monthly || 0)) }))
      .sort((a, b) => { const ia = GROUP_ORDER.indexOf(a.group), ib = GROUP_ORDER.indexOf(b.group); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || b.monthly - a.monthly; });
    for (const t of things) pickNext(t, today);
    const dated = things.filter((t) => t.nextDate && t.nextDate >= today);
    const upcoming = (dated.some((t) => t.renewal) ? dated.filter((t) => t.renewal) : dated).sort((a, b) => (a.nextDate < b.nextDate ? -1 : 1));
    const decisions = (input.decisions || []).filter((d) => (d.status || "Open") === "Open" && (d.options || []).length).map((d) => {
      const options = d.options.map((o, i) => {
        const up = num(o.upfront) || 0, pm = num(o.perMonth) || 0, mo = num(o.months) || 0, ex = num(o.extra) || 0;
        return { ...o, i, upfront: up, perMonth: pm, months: mo, extra: ex, total: num(o.total) != null ? num(o.total) : Math.round((up + pm * mo + ex) * 100) / 100 };
      });
      const rec = options.find((o) => o.recommended) || null;
      const cheapest = options.reduce((a, o) => (o.total < a.total ? o : a), options[0]);
      const base = rec || cheapest;
      for (const o of options) o.delta = Math.round((o.total - base.total) * 100) / 100;
      const horizon = Math.max(0, ...options.map((o) => o.months || 0));
      const left = d.decideBy ? days(today, d.decideBy) : null;
      return { ...d, options, rec, cheapest, base, horizon, max: Math.max(...options.map((o) => o.total), 1), daysLeft: left };
    }).sort((a, b) => String(a.decideBy || "9") < String(b.decideBy || "9") ? -1 : 1);
    return {
      today, things, groups, decisions,
      monthly: things.reduce((s, t) => s + (t.monthly || 0), 0),
      owed: things.reduce((s, t) => s + (t.owed || 0), 0),
      next: upcoming[0] || null,
      byId: Object.fromEntries(things.map((t) => [t.id, t])),
      decisionsByRef: decisionsIndex(input.decisions || []),
    };
  }
  function pickNext(t, today) {
    const cs = t.contracts.map((c) => ({ c, d: c.end && c.end >= today && (!c.nextDate || c.end < c.nextDate) ? c.end : c.nextDate, ren: /annual|year/i.test(c.cadence || "") || !!c.end }))
      .filter((x) => x.d && x.d >= today);
    const pool = cs.some((x) => x.ren) ? cs.filter((x) => x.ren) : cs;
    const best = pool.sort((a, b) => (a.d < b.d ? -1 : 1))[0];
    if (best) { t.nextDate = best.d; t.renewal = best.ren; t.nextLabel = best.ren ? `${best.c.end && best.d === best.c.end ? "Ends" : "Renews"}: ${best.c.product}` : `Next charge: ${best.c.product}`; }
  }
  function decisionsIndex(list) { const out = {}; for (const d of list) if (d.ref) (out[d.ref] = out[d.ref] || []).push(d.id); return out; }

  // ---------- decision cards ----------
  function dueChip(d) {
    if (d.daysLeft == null) return `<span class="kx-th-due">No date set</span>`;
    const late = d.daysLeft < 0, soon = d.daysLeft <= 14;
    const when = late ? `${plural(-d.daysLeft, "day")} past` : d.daysLeft === 0 ? "today" : d.daysLeft === 1 ? "tomorrow" : `in ${plural(d.daysLeft, "day")}`;
    return `<span class="kx-th-due${late ? " late" : soon ? " soon" : ""}">Decide by ${esc(dayShort(d.decideBy))} · ${when}</span>`;
  }
  function optionDetail(d, o) {
    const parts = [];
    if (o.upfront) parts.push(`<span><b class="num">${smart(o.upfront)}</b> now</span>`);
    if (o.perMonth && o.months) parts.push(`<span><b class="num">${smart(o.perMonth)}</b> a month for ${plural(o.months, "month")}</span>`);
    if (o.extra) parts.push(`<span><b class="num">${smart(o.extra)}</b> other costs</span>`);
    if (!parts.length) parts.push(`<span>Nothing to pay</span>`);
    const vs = d.base && o !== d.base ? (o.delta > 0 ? `<b class="num">${smart(o.delta)}</b> more than ${esc(d.base.option.toLowerCase())}` : o.delta < 0 ? `<b class="num">${smart(-o.delta)}</b> less than ${esc(d.base.option.toLowerCase())}` : `the same as ${esc(d.base.option.toLowerCase())}`) : d.rec === o ? "our pick" : "the cheapest";
    return `<div class="kx-th-odetail" aria-live="polite">
      <div class="kx-th-ototal"><b class="num">${smart(o.total)}</b><span>${d.horizon ? `over the next ${plural(d.horizon, "month")}` : "in total"} · ${vs}</span></div>
      <div class="kx-th-oparts">${parts.join("")}</div>
      ${o.note ? `<p class="kx-th-onote">${esc(o.note)}</p>` : ""}
      ${o.source ? `<p class="kx-th-src">Source: ${esc(o.source)}</p>` : ""}</div>`;
  }
  function decisionCard(d, pick) {
    const sel = d.options[pick == null ? (d.rec || d.cheapest).i : pick] || d.options[0];
    const bars = d.options.map((o) => `<div class="kx-th-bar${o === sel ? " on" : ""}"><span class="kx-th-bl">${esc(o.option)}${o === d.rec ? ` <em>our pick</em>` : ""}</span><span class="kx-th-bt"><i style="width:${Math.max(2, (o.total / d.max) * 100).toFixed(1)}%"></i></span><b class="num">${smart(o.total)}</b></div>`).join("");
    return `<article class="card kx-th-dec" data-dec="${esc(d.id)}">
      <div class="kx-th-dhead"><h3>${esc(d.question)}</h3>${dueChip(d)}</div>
      <div class="kx-th-opts" role="radiogroup" aria-label="Options">${d.options.map((o) => `<button type="button" role="radio" class="kx-th-opt${o === sel ? " on" : ""}" aria-checked="${o === sel}" data-opt="${o.i}"><span>${esc(o.option)}</span><b class="num">${smart(o.total)}</b></button>`).join("")}</div>
      ${optionDetail(d, sel)}
      <div class="kx-th-bars" role="img" aria-label="${esc(d.options.map((o) => `${o.option} ${smart(o.total)}`).join("; "))}">${bars}</div>
      ${d.source ? `<p class="kx-th-src">Costs from ${esc(d.source)}. Totals use the same horizon so the options compare.</p>` : `<p class="kx-th-src">Totals use the same horizon so the options compare.</p>`}
    </article>`;
  }

  // ---------- things ----------
  const img = (t, cls) => (t.image ? `<img class="${cls}" src="${esc(t.image)}" alt="" loading="lazy">` : `<span class="${cls} kx-th-mono" aria-hidden="true">${esc((t.name || "?").trim().slice(0, 1).toUpperCase())}</span>`);
  function nextText(t, today) {
    if (!t.nextDate) return t.nextLabel || "";
    const n = days(today, t.nextDate);
    const when = n < 0 ? `${dayShort(t.nextDate, today)}, ${plural(-n, "day")} ago` : n <= 60 ? `${dayShort(t.nextDate, today)} · ${n === 0 ? "today" : `in ${plural(n, "day")}`}` : dayShort(t.nextDate, today);
    return `${esc(t.nextLabel || "Next")} ${when}`;
  }
  function thingCard(t, m) {
    const dq = m.decisionsByRef[t.id] || [];
    return `<button type="button" class="kx-th-thing" data-thing="${esc(t.id)}" aria-label="${esc(t.name)}, ${t.monthly != null ? whole(t.monthly) + " a month" : "no running cost"}. Open details">
      ${img(t, "kx-th-img")}
      <span class="kx-th-tmid"><span class="kx-th-tn">${esc(t.name)}</span><span class="kx-th-tnext">${nextText(t, m.today)}</span>
        ${t.owed ? `<span class="kx-th-towed"><b class="num">${smart(t.owed)}</b> to pay out today</span>` : ""}
        ${dq.length ? `<span class="kx-th-flag">Decision waiting</span>` : ""}</span>
      <span class="kx-th-tamt"><b class="num">${t.monthly != null ? whole(t.monthly) : "–"}</b><small>a month</small></span>
    </button>`;
  }
  function render(m, opts) {
    if (!m) return `<div class="card"><div class="empty">Nothing recorded yet. Add things to the record and they appear here.</div></div>`;
    const st = (opts && opts.state) || {};
    const facts = `<div class="kx-th-facts">
      <div class="kx-th-fact"><b class="num">${whole(m.monthly)}</b><span>a month to run everything below, about ${whole(m.monthly * 12)} a year</span></div>
      ${m.owed > 0 ? `<div class="kx-th-fact"><b class="num">${whole(m.owed)}</b><span>still owed on plans if all were paid out today</span></div>` : `<div class="kx-th-fact"><b class="num">${m.things.reduce((n, t) => n + t.contracts.length, 0)}</b><span>contracts across ${plural(m.things.length, "thing")}</span></div>`}
      <div class="kx-th-fact">${m.next ? `<b>${esc(m.next.name)}</b><span>${nextText(m.next, m.today)}</span>` : `<b>Nothing dated</b><span>no renewals ahead on the record</span>`}</div>
    </div>`;
    const dec = m.decisions.length ? `<section class="kx-th-sec"><div class="kx-th-sh"><h2>${m.decisions.length === 1 ? "A decision waiting" : `${m.decisions.length} decisions waiting`}</h2><p class="sub">Each option is costed from the quotes on the record. Choose one to see what it costs against our pick.</p></div>
      <div class="kx-th-decs">${m.decisions.map((d) => decisionCard(d, st[d.id])).join("")}</div></section>` : "";
    const groups = m.groups.map((g) => `<section class="kx-th-grp"><div class="kx-th-gh"><h3>${esc(g.group)}</h3><span class="num">${whole(g.monthly)} a month</span></div>
      <div class="kx-th-grid">${g.things.map((t) => thingCard(t, m)).join("")}</div></section>`).join("");
    return `<div class="kx-th">${facts}${dec}<section class="kx-th-sec"><div class="kx-th-sh"><h2>What we own and pay for</h2><p class="sub">Tap a thing for every contract behind it, its timeline and what leaving today would cost.</p></div>${groups || `<div class="empty">No things on the record yet.</div>`}</section></div>`;
  }

  // ---------- drawer ----------
  function timeline(t, today) {
    const cs = t.contracts.filter((c) => c.start && c.end && c.end > c.start);
    if (!cs.length) return "";
    const lo = cs.reduce((a, c) => (c.start < a ? c.start : a), cs[0].start), hi = cs.reduce((a, c) => (c.end > a ? c.end : a), cs[0].end);
    const span = Math.max(1, days(lo, hi)), W = 520, x = (iso) => 8 + (Math.min(Math.max(days(lo, iso), 0), span) / span) * (W - 16);
    const rows = cs.map((c, i) => {
      const y = 22 + i * 30, past = today > c.start ? Math.min(x(today), x(c.end)) : x(c.start);
      const left = c.end >= today ? monthsBetween(today, c.end) : 0;
      return `<rect x="${x(c.start)}" y="${y}" width="${Math.max(2, x(c.end) - x(c.start))}" height="10" rx="5" fill="var(--accent-soft)"/>
        <rect x="${x(c.start)}" y="${y}" width="${Math.max(0, past - x(c.start))}" height="10" rx="5" fill="var(--accent)"/>
        <text x="${x(c.start)}" y="${y - 5}" font-size="11" fill="currentColor">${esc(c.product)}${c.end >= today ? ` · ${plural(left, "month")} left` : " · ended"}</text>`;
    }).join("");
    const H = 22 + cs.length * 30 + 18;
    const tx = x(today);
    return `<figure class="kx-th-tl"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Contract timeline from ${esc(day(lo))} to ${esc(day(hi))}, today marked">${rows}
      <line x1="${tx}" x2="${tx}" y1="8" y2="${H - 16}" stroke="var(--warn)" stroke-width="1.5" stroke-dasharray="3 3"/>
      <text x="${Math.min(W - 30, Math.max(30, tx))}" y="${H - 3}" font-size="11" text-anchor="middle" fill="var(--warn)">today</text>
      <text x="8" y="${H - 3}" font-size="11" fill="var(--muted)">${esc(dayShort(lo))}</text><text x="${W - 8}" y="${H - 3}" font-size="11" text-anchor="end" fill="var(--muted)">${esc(dayShort(hi))}</text></svg></figure>`;
  }
  function renderThing(m, id) {
    const t = m.byId[id]; if (!t) return "";
    const exitNow = t.contracts.reduce((s, c) => s + (c.exit || 0), 0) || t.exit || 0;
    const dq = (m.decisionsByRef[t.id] || []).map((k) => m.decisions.find((d) => d.id === k)).filter(Boolean);
    const rows = t.contracts.map((c) => `<div class="kx-th-crow"><div class="kx-th-cmain"><b>${esc(c.product)}</b> ${chip(c.confidence)}<span class="sub">${esc(c.provider || "")}${c.cost != null ? ` · ${smart(c.cost)} ${esc(c.cadence || "")}` : ""}${c.decision ? ` · ${esc(c.decision)}` : ""}</span>${c.source ? `<span class="kx-th-src">${/^https?:/.test(c.source) ? `<a href="${esc(c.source)}" target="_blank" rel="noopener">Source</a>` : esc(c.source)}</span>` : ""}</div>
      <div class="kx-th-cnum"><span><b class="num">${c.monthly != null ? smart(c.monthly) : "–"}</b><small>a month</small></span><span>${c.end ? `ends ${esc(dayShort(c.end, m.today))}` : c.nextDate ? `next ${esc(dayShort(c.nextDate, m.today))}` : ""}</span>${c.exit ? `<span><b class="num">${smart(c.exit)}</b><small>to exit</small></span>` : ""}</div></div>`).join("");
    return `<div class="kx-th-drawer">
      <div class="kx-th-dtop">${img(t, "kx-th-dimg")}<div><h2>${esc(t.name)}</h2><p class="sub">${esc([t.group, t.owner].filter(Boolean).join(" · "))} ${chip(t.confidence)}</p></div></div>
      <div class="kx-th-facts small">
        <div class="kx-th-fact"><b class="num">${t.monthly != null ? smart(t.monthly) : "–"}</b><span>a month</span></div>
        <div class="kx-th-fact"><b class="num">${smart(t.owed || 0)}</b><span>owed today</span></div>
        <div class="kx-th-fact"><b>${t.nextDate ? esc(dayShort(t.nextDate, m.today)) : "–"}</b><span>${esc(t.nextLabel || "next date")}</span></div>
      </div>
      ${timeline(t, m.today)}
      ${exitNow ? `<p class="kx-th-exit">If we left today: pay <b class="num">${smart(exitNow)}</b> now and stop <b class="num">${smart(t.monthly || 0)}</b> a month.</p>` : ""}
      ${dq.map((d) => `<div class="kx-th-dlink"><span>Decision waiting: <b>${esc(d.question)}</b></span>${dueChip(d)}</div>`).join("")}
      <h3 class="kx-th-h3">${t.contracts.length ? plural(t.contracts.length, "contract") + " behind it" : "No contracts recorded"}</h3>
      <div class="kx-th-clist">${rows}</div>
      ${t.notes ? `<p class="sub">${esc(t.notes)}</p>` : ""}
      ${t.source ? `<p class="kx-th-src">${/^https?:/.test(t.source) ? `<a href="${esc(t.source)}" target="_blank" rel="noopener">Open the row in the sheet</a>` : esc(t.source)}</p>` : ""}
    </div>`;
  }

  // ---------- events ----------
  function bind(el, m, opts) {
    const state = (opts.state = opts.state || {});
    el.addEventListener("click", (e) => {
      const opt = e.target.closest(".kx-th-opt");
      if (opt) {
        const card = opt.closest("[data-dec]"), d = m.decisions.find((x) => x.id === card.dataset.dec); if (!d) return;
        state[d.id] = +opt.dataset.opt;
        card.outerHTML = decisionCard(d, state[d.id]);
        const again = el.querySelector(`[data-dec="${CSS.escape(d.id)}"] .kx-th-opt[data-opt="${state[d.id]}"]`); if (again) again.focus();
        return;
      }
      const th = e.target.closest("[data-thing]");
      if (th && opts.onOpen) opts.onOpen(renderThing(m, th.dataset.thing));
    });
    // arrow keys move between options, as a radio group should
    el.addEventListener("keydown", (e) => {
      const opt = e.target.closest(".kx-th-opt"); if (!opt || !/^Arrow(Left|Right|Up|Down)$/.test(e.key)) return;
      const all = [...opt.parentElement.querySelectorAll(".kx-th-opt")], i = all.indexOf(opt), n = all[(i + (/Right|Down/.test(e.key) ? 1 : all.length - 1)) % all.length];
      e.preventDefault(); n.click();
    });
  }
  // A short card for Home: the nearest decision, or the next renewal.
  function renderHome(m) {
    if (!m) return "";
    const d = m.decisions[0];
    if (d) return `<button type="button" class="kx-th-home" data-go="things"><span class="kx-th-hk">${m.decisions.length === 1 ? "Decision waiting" : `${m.decisions.length} decisions waiting`}</span><span class="kx-th-hq">${esc(d.question)}</span>${dueChip(d)}<span class="kx-th-hs">${d.rec ? `Our pick: ${esc(d.rec.option)}, ${smart(d.rec.total)}` : `Cheapest: ${esc(d.cheapest.option)}, ${smart(d.cheapest.total)}`}</span></button>`;
    return m.next ? `<button type="button" class="kx-th-home" data-go="things"><span class="kx-th-hk">Next renewal</span><span class="kx-th-hq">${esc(m.next.name)}</span><span class="kx-th-hs">${nextText(m.next, m.today)}</span></button>` : "";
  }
  return { model, render, renderHome, renderThing, bind, _: { days, monthsBetween } };
});
