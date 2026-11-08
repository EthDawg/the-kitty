/* The Kitty kit: What moves the date. A goal's planned date, and each lever's effect if it were switched.
   Every row answers one question a person would ask: "what happens if we change this?" The sheet computes the dates;
   this module only orders, scales and words them, and asks before a writable lever is switched.
   Runs in the page (extends window.Kit) and in node (module.exports). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Kit = Object.assign(root.Kit || {}, { Levers: factory() });
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}/.test(v);
  const mon = (iso) => (isDate(iso) ? `${MON[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}` : iso === "Never" ? "never" : "–");
  const idx = (iso) => +iso.slice(0, 4) * 12 + (+iso.slice(5, 7) - 1);
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const money = (v) => "$" + Math.round(Math.abs(v)).toLocaleString("en-AU");
  const span = (n) => (n >= 12 && n % 12 === 0 ? plural(n / 12, "year") : n >= 18 ? `${(n / 12).toFixed(1).replace(/\.0$/, "")} years` : plural(n, "month"));

  // Each lever is reduced to: its state now, the date if it were switched, and the months that switch would move.
  function model(input) {
    if (!input || !input.goal || !Array.isArray(input.levers)) return null;
    const g = input.goal, plan = g.planDate;
    const rows = input.levers.map((l) => {
      const flipped = l.on ? l.dateIfOff : l.dateIfOn;
      let moved = null; // months later (positive) or earlier (negative) if this lever were switched
      if (isDate(plan) && isDate(flipped)) moved = idx(flipped) - idx(plan);
      else if (l.monthsMoved != null && isFinite(+l.monthsMoved)) moved = l.on ? +l.monthsMoved : -(+l.monthsMoved);
      const never = flipped === "Never";
      return { ...l, flipped, moved, never, size: never ? Infinity : Math.abs(moved || 0) };
    }).sort((a, b) => b.size - a.size || String(a.lever).localeCompare(String(b.lever)));
    const finite = rows.filter((r) => isFinite(r.size));
    const maxAbs = Math.max(1, ...finite.map((r) => r.size));
    const helping = rows.filter((r) => r.on && (r.never || (r.moved || 0) > 0));
    return { goal: g, plan, rows, maxAbs, helping, extraDates: input.extraDates || [], asOf: input.asOf, allOff: g.allOffDate || null };
  }

  function sentence(r) {
    const to = r.never ? "the goal would never arrive at this pace" : r.moved === 0 ? "the date would not move" : `the date moves ${span(Math.abs(r.moved))} ${r.moved > 0 ? "later" : "earlier"}, to ${mon(r.flipped)}`;
    return `${r.on ? "On now. Switching it off" : "Off now. Switching it on"}: ${to}.`;
  }
  function row(r, m, pending, demo) {
    const W = 34; // percent of the track each side may use, leaving room for the label
    const w = r.never ? W : (r.size / m.maxAbs) * W;
    const later = r.never || (r.moved || 0) > 0;
    const effect = r.perMonth ? `${r.perMonth > 0 ? "+" : "−"}${money(r.perMonth)} a month` : r.oneOff ? `${r.oneOff > 0 ? "+" : "−"}${money(r.oneOff)} once` : "";
    const ask = pending === r.id ? `<div class="kx-lv-ask" role="alert"><span>${demo ? `${r.on ? "Switch this off" : "Switch this on"}? This is the demo household, so the date is worked out on this page and nothing is saved.` : `${r.on ? "Switch this off" : "Switch this on"} in the sheet? The plan date will be worked out again.`}</span><button type="button" class="kx-lv-yes" data-yes="${esc(r.id)}">Switch it</button><button type="button" class="kx-lv-no" data-no="${esc(r.id)}">Cancel</button></div>` : "";
    return `<li class="kx-lv-row${r.on ? " on" : ""}" data-lever="${esc(r.id)}">
      <div class="kx-lv-txt"><span class="kx-lv-name">${esc(r.lever)}</span><span class="kx-lv-say">${esc(sentence(r))}</span>${effect || r.source ? `<span class="kx-lv-src">${esc([effect, r.source].filter(Boolean).join(" · "))}</span>` : ""}</div>
      <div class="kx-lv-track" role="img" aria-label="${esc(sentence(r))}"><span class="kx-lv-zero"></span>
        ${r.moved === 0 && !r.never ? `<span class="kx-lv-dot"></span>` : `<span class="kx-lv-bar ${later ? "late" : "early"}" style="${later ? "left:50%" : `right:50%`};width:${Math.max(1.5, w).toFixed(1)}%"></span>`}
        <b class="kx-lv-amt ${later ? "late" : "early"}" style="${later ? `left:calc(50% + ${Math.max(1.5, w).toFixed(1)}% + 6px)` : `right:calc(50% + ${Math.max(1.5, w).toFixed(1)}% + 6px)`}">${r.never ? "never" : r.moved === 0 ? "" : `${later ? "+" : "−"}${Math.abs(r.moved)} mo`}</b></div>
      ${r.writable ? `<button type="button" class="kx-lv-sw" role="switch" aria-checked="${!!r.on}" data-switch="${esc(r.id)}" aria-label="${esc(r.lever)}: ${r.on ? "on" : "off"}"><i></i><span>${r.on ? "On" : "Off"}</span></button>` : `<span class="kx-lv-state">${r.on ? "On" : "Off"}</span>`}
      ${ask}</li>`;
  }
  function render(m, opts) {
    if (!m) return `<div class="card"><div class="empty">No levers recorded for this goal yet.</div></div>`;
    const g = m.goal, pend = opts && opts.pending;
    let vsT = "";
    if (isDate(m.plan) && isDate(g.targetDate)) { const d = idx(m.plan) - idx(g.targetDate); vsT = d > 0 ? `, ${span(d)} after the ${mon(g.targetDate)} target` : d < 0 ? `, ${span(-d)} ahead of the ${mon(g.targetDate)} target` : `, right on the target`; }
    const help = isDate(m.plan) ? `On plan for ${mon(m.plan)}${vsT}` : `At the current pace this goal never arrives`;
    const big = m.rows.find((r) => r.on && (r.never || (r.moved || 0) > 0));
    const off = (m.allOff ? ` Without any levers it would be ${mon(m.allOff)}.` : "") + (big ? ` The lever doing the most: ${big.lever.charAt(0).toLowerCase() + big.lever.slice(1)}.` : "");
    const marks = [{ label: g.name, date: m.plan, main: true }, ...(g.targetDate ? [{ label: "Target", date: g.targetDate }] : []), ...m.extraDates].filter((x) => isDate(x.date));
    let tl = "";
    if (marks.length > 1 || m.asOf) {
      const pts = [...marks.map((x) => idx(x.date)), ...(m.asOf ? [idx(m.asOf)] : [])], lo = Math.min(...pts), hi = Math.max(...pts, lo + 1);
      const X = (iso) => 4 + ((idx(iso) - lo) / (hi - lo)) * 92;
      const al = (x) => (x < 12 ? " left" : x > 88 ? " right" : "");
      tl = `<div class="kx-lv-tl" role="img" aria-label="${esc(marks.map((x) => `${x.label} ${mon(x.date)}`).join(", "))}"><span class="kx-lv-axis"></span>
        ${m.asOf ? `<span class="kx-lv-mk now${al(X(m.asOf))}" style="left:${X(m.asOf)}%"><i></i><b>Today</b><small>${mon(m.asOf)}</small></span>` : ""}
        ${marks.map((x, i) => `<span class="kx-lv-mk${x.main ? " main" : ""}${i % 2 ? " low" : ""}${al(X(x.date))}" style="left:${X(x.date)}%"><i></i><b>${esc(x.label)}</b><small>${mon(x.date)}</small></span>`).join("")}</div>`;
    }
    return `<div class="kx-lv">
      <div class="kx-lv-hero"><span class="kx-lv-k">${esc(g.name)}</span><span class="kx-lv-date">${mon(m.plan)}</span>
        <p class="kx-lv-lede">${g.target ? `${money(g.have || 0)} of ${money(g.target)}. ` : ""}${help}.${off}${g.recentDate ? ` At the last few months' pace alone: ${mon(g.recentDate)}.` : ""}</p></div>
      ${tl}
      <div class="kx-lv-head"><span>Lever</span><span class="kx-lv-hscale"><em>← earlier</em><em>if switched</em><em>later →</em></span><span>Now</span></div>
      <ol class="kx-lv-rows">${m.rows.map((r) => row(r, m, pend, opts && opts.demo)).join("")}</ol>
      <p class="kx-lv-foot">Bars are drawn to one scale: the longest is ${span(m.maxAbs)}. The sheet works out every date; switching a lever here changes the sheet's input and nothing else.</p>
    </div>`;
  }
  function bind(el, m, opts) {
    el.addEventListener("click", async (e) => {
      const sw = e.target.closest("[data-switch]"), yes = e.target.closest("[data-yes]"), no = e.target.closest("[data-no]");
      if (sw) { opts.pending = sw.dataset.switch; el.innerHTML = render(m, opts); const b = el.querySelector(".kx-lv-yes"); if (b) b.focus(); return; }
      if (no) { opts.pending = null; el.innerHTML = render(m, opts); const b = el.querySelector(`[data-switch="${CSS.escape(no.dataset.no)}"]`); if (b) b.focus(); return; }
      if (yes && opts.onWrite) {
        const r = m.rows.find((x) => x.id === yes.dataset.yes); yes.disabled = true; yes.textContent = "Saving…";
        try { await opts.onWrite({ id: r.id, on: !r.on, lever: r.lever }); opts.pending = null; }
        catch (err) { yes.disabled = false; yes.textContent = "Try again"; const a = yes.closest(".kx-lv-ask"); if (a) a.querySelector("span").textContent = `The sheet didn't confirm the change${err && err.message ? `: ${err.message}` : ""}. Nothing was switched.`; }
      }
    });
  }
  function renderHome(m) {
    if (!m) return "";
    const top = m.rows.find((r) => !r.on && (r.moved || 0) < 0);
    return `<div class="kx-lv-home"><span class="kx-lv-k">${esc(m.goal.name)}</span><span class="kx-lv-hd">${mon(m.plan)}</span>${top ? `<span class="kx-lv-hs">Biggest lever not used yet: ${esc(top.lever)}, ${span(Math.abs(top.moved))} sooner.</span>` : ""}</div>`;
  }
  return { model, render, renderHome, bind };
});
