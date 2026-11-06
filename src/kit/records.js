/* The Kitty kit: Records. The household's record as the standard rebuilds it. standard/tools/view.js writes data/standard-view.json and
   these functions draw it: the view in, HTML out, no DOM, so node tests can render them; the page binds the clicks. Nothing here computes
   a number. The view is still filling in, so any field may be absent, and absent reads "not held yet" or is left out, never a zero.
   Runs in the page (extends window.Kit) and in node (module.exports). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("../engine.js"), require("./entry-row.js"));
  else Object.assign(root.Kit, factory(root.Engine, root.Kit));
})(typeof self !== "undefined" ? self : this, function (E, Kit) {
  "use strict";
  const K = {};
  const esc = Kit.esc, ico = Kit.ico;
  const rows = (x) => (Array.isArray(x) ? x.filter((r) => r && typeof r === "object") : []);
  const isNum = (n) => typeof n === "number" && Number.isFinite(n);
  const count = (n) => new Intl.NumberFormat(E.locale).format(n);
  const words = (s) => E.cap(String(s == null ? "" : s).replace(/_/g, " "));
  // money is cents in the view. Absent stays absent: E.fmt would draw a dash, and a 0 would claim a fact.
  const money = (c, o) => (isNum(c) ? E.fmt(c / 100, o) : "");
  const exact = (c, o) => money(c, Object.assign({ cents: true }, o));
  const day = (s) => (/^\d{4}-\d{2}-\d{2}/.test(s) ? E.fmtDay(String(s).slice(0, 10), { year: true }) : s ? String(s) : "");
  const month = (s) => (/^\d{4}-\d{2}$/.test(s) ? E.fmtMonth(`${s}-01`) : String(s));
  const notHeld = (what) => `<div class="empty">${esc(what)} not held yet.</div>`;
  const laws = (view) => rows(view && view.proof && view.proof.laws);

  // ---------- a law's result: a word, a shape and a colour, so no one of them carries it alone. Worst first. ----------
  const LAW = {
    fail: { word: "Fail", icon: "warning", means: "Evidence contradicts evidence." },
    gap: { word: "Gap", icon: "pending", means: "Evidence is missing." },
    open: { word: "Open", icon: "clock", means: "An item is open, inside its allowed age." },
    accepted: { word: "Accepted", icon: "edit", means: "A person accepted this result, with a reason." },
    pass: { word: "Pass", icon: "check", means: "The law holds." },
    skip: { word: "Not run", icon: "info", means: "Nothing to check yet." },
  };
  const lawOf = (s) => LAW[s] || LAW.skip;
  const statTag = (s) => `<span class="rec-stat ${LAW[s] ? s : "skip"}">${ico(lawOf(s).icon)}<span>${esc(lawOf(s).word)}</span></span>`;
  const STEP = { held: { word: "Held", cls: "held", icon: "check" }, at_risk: { word: "At risk", cls: "risk", icon: "warning" }, missing: { word: "Yet to go", cls: "togo", icon: "" } };
  const stepOf = (s) => STEP[s] || STEP.missing;
  const EVIDENCE = { held: { word: "Held", cls: "good" }, at_risk: { word: "At risk", cls: "amber" }, missing: { word: "Missing", cls: "warn" } };
  const ROLE = { recognises: "Recognises this event", clears: "Clears against this event" };
  const WITNESS = { txn_line: "Transaction line" };

  // ---------- the year ----------
  const isReal = (y) => rows(y.people).some((p) => p.lodged || rows(p.items).length || rows(p.readiness && p.readiness.steps).some((s) => s.state === "held"));
  const yearsOf = (view) => rows(view && view.years).filter((y) => y.fy);
  // the year asked for if the view holds it; otherwise the latest with anything real in it
  K.recordsYear = (view, fy) => { const ys = yearsOf(view); return ys.find((y) => y.fy === fy) || ys.filter(isReal).pop() || ys[ys.length - 1] || null; };

  const stepper = (steps) => `<ol class="rec-steps">${steps.map((s) => { const st = stepOf(s.state); return `<li class="${st.cls}"><span class="dot" aria-hidden="true">${st.icon ? ico(st.icon) : ""}</span><span class="nm">${esc(s.name || words(s.id))}</span><span class="st">${st.word}</span></li>`; }).join("")}</ol>`;
  const result = (c) => (isNum(c) ? `${money(Math.abs(c))}${c ? `<small>${c < 0 ? "to pay" : "refund"}</small>` : ""}` : "");
  const orNot = (html) => html || `<span class="muted">not held yet</span>`;
  // the lodged return is the record; the derived figures sit beside it as a check, and the gap is the tie's own, never worked out here
  const lodged = (p) => {
    const l = p.lodged, d = p.derived || {}, t = p.tie || {};
    return `<div class="rec-lodged">
      <div class="rec-lhead"><span class="t">Lodged${isNum(l.version) && l.version > 1 ? `, version ${esc(l.version)}` : ""}</span>${t.status ? statTag(t.status) : ""}</div>
      ${l.assessed_on ? `<p class="sub">Assessed ${esc(day(l.assessed_on))}</p>` : ""}
      <table class="t rec-tie"><thead><tr><th scope="col"><span class="sr">Figure</span></th><th class="n" scope="col">The record</th><th class="n" scope="col">Derived</th><th class="n" scope="col">Gap</th></tr></thead>
        <tbody><tr><th scope="row">Taxable income</th><td class="n"><b>${orNot(money(l.taxable_income_cents))}</b></td><td class="n">${orNot(money(d.taxable_income_cents))}</td><td class="n">${t.gap === 0 ? "None" : money(t.gap, { plus: true })}</td></tr>
        <tr><th scope="row">Result</th><td class="n"><b>${orNot(result(l.result_cents))}</b></td><td class="n">${orNot(result(d.result_cents))}</td><td class="n"></td></tr></tbody></table>
      ${t.detail ? `<p class="sub">${esc(t.detail)}</p>` : ""}
      <p class="sub">The lodged figure is the record. The derived figure is a check on it.</p>
    </div>`;
  };
  const draft = (d) => `<div class="rec-lodged"><div class="rec-lhead"><span class="t">Derived draft</span></div>
      <dl class="kv"><dt>Taxable income</dt><dd class="num">${orNot(money(d.taxable_income_cents))}</dd><dt>Result</dt><dd class="num">${orNot(result(d.result_cents))}</dd></dl>
      <p class="sub">A draft. Once a return is lodged, that return is the record.</p></div>`;
  const label = (i) => (i.label == null ? "Label not held yet" : `Label ${i.label}`);
  const item = (i) => { const ev = EVIDENCE[i.evidence]; return `<div class="rec-item"><span class="lab">${esc(label(i))}</span><span class="amt num">${orNot(exact(i.amount_cents))}</span><span class="how">${esc(i.method || "")}</span>${ev ? `<span class="tag ${ev.cls}">${ev.word}</span>` : ""}</div>`; };
  const person = (p) => {
    const r = p.readiness || {}, steps = rows(r.steps), items = rows(p.items), pct = isNum(r.pct) && r.pct > 0 ? r.pct : null;
    return `<article class="rec-person">
      <div class="rec-phead"><h3>${esc(p.name || p.person || "Adult")}</h3>${p.status === "lodged" ? '<span class="tag good">Lodged</span>' : ""}<span class="rec-pct num">${pct == null ? '<span class="muted">Not held yet</span>' : `${esc(pct)}%<small>ready${isNum(r.held) && isNum(r.needed) ? `, ${esc(r.held)} of ${esc(r.needed)}` : ""}</small>`}</span></div>
      ${pct == null ? "" : `<span class="rec-bar"><span style="width:${esc(pct)}%"></span></span>`}
      ${steps.length ? stepper(steps) : '<p class="sub">Steps not held yet.</p>'}
      ${p.lodged ? lodged(p) : p.derived ? draft(p.derived) : ""}
      <h4 class="rec-k">Tax items</h4>
      ${items.length ? `<div class="rec-items">${items.map(item).join("")}</div>` : '<p class="sub">Tax items not held yet.</p>'}
    </article>`;
  };
  K.RecordsYear = (view, fy) => {
    const y = K.recordsYear(view, fy), people = rows(y && y.people);
    if (!people.length) return notHeld("This year is");
    return `<div class="rec-people">${people.map(person).join("")}</div><p class="sub rec-foot">Steps that may not apply, such as dividends, join the percentage once something is held.</p>`;
  };
  const yearPicker = (view, y) => { const ys = yearsOf(view).reverse(); return ys.length ? `<label class="rec-pick"><span>Financial year</span><select id="recfy">${ys.map((x) => `<option value="${esc(x.fy)}"${x === y ? " selected" : ""}>${esc(x.fy)}${rows(x.people).some((p) => p.status === "lodged") ? " · lodged" : ""}</option>`).join("")}</select></label>` : ""; };

  // ---------- how we know ----------
  const scoreTile = (r) => { const known = isNum(r.exact) && isNum(r.checked), tone = !known ? "" : r.exact === r.checked ? "good" : r.exact === 0 ? "warn" : "amber"; return `<div class="rec-score ${tone}"><span class="nm">${esc(words(r.name))}</span><span class="v num">${known ? `${count(r.exact)} of ${count(r.checked)}` : "Not held yet"}</span>${isNum(r.pct) ? `<span class="rec-bar"><span style="width:${esc(r.pct)}%"></span></span>` : ""}</div>`; };
  const lawRow = (l) => `<button type="button" class="row rec-law" data-open="law:${esc(l.id)}">${statTag(l.status)}<span class="mid"><span class="t">${esc(l.name || l.id)}</span><span class="s">${esc(l.claim || "")}</span></span>${ico("chev", "chev")}</button>`;
  // worst first, then in the standard's own order
  K.lawsInOrder = (view) => Object.keys(LAW).flatMap((s) => laws(view).filter((l) => (LAW[l.status] ? l.status : "skip") === s));
  const tally = (all) => { const seen = Object.keys(LAW).map((s) => [s, all.filter((l) => (LAW[l.status] ? l.status : "skip") === s).length]).filter(([, n]) => n); return seen.length ? `<div class="rec-tally">${seen.map(([s, n]) => `<div class="rec-tile ${s}">${ico(LAW[s].icon)}<span class="w"><b class="num">${n}</b> ${esc(LAW[s].word)}</span><span class="m">${esc(LAW[s].means)}</span></div>`).join("")}</div>` : ""; };
  K.recordLaw = (view, id) => laws(view).find((l) => l.id === id) || null;
  K.RecordLaw = (l) => {
    const counted = Object.keys(LAW).filter((s) => l.counts && isNum(l.counts[s]) && l.counts[s] > 0).map((s) => `${count(l.counts[s])} ${LAW[s].word.toLowerCase()}`);
    return `<h2>${esc(l.name || l.id)}</h2><p class="rec-dtags">${statTag(l.status)}<span class="sub">${esc(lawOf(l.status).means)}</span></p>
      ${l.claim ? `<h3>The claim</h3><p>${esc(l.claim)}</p>` : ""}
      ${l.worst ? `<h3>${l.status === "fail" || l.status === "gap" ? "Worst detail" : "Detail"}</h3><p>${esc(l.worst)}</p>` : ""}
      ${counted.length ? `<h3>Results across its scopes</h3><p>${esc(counted.join(", "))}</p>` : ""}`;
  };

  // ---------- where a number comes from: the event, its balanced postings, each witness with its file and locator ----------
  const fileLine = (w) => `<span class="rec-file">${ico("sheet")}<span class="f">${esc(w.file || "File not held yet")}</span>${w.locator ? `<span class="loc">${esc(w.locator)}</span>` : ""}</span>`;
  const traceRow = (t, i) => { const w = rows(t.witnesses)[0]; return `<button type="button" class="rec-trace" data-open="trace:${i}"><span class="nm">${esc(t.description || words(t.kind))}</span><span class="amt num">${exact(t.amount_cents) || "Not held yet"}</span><span class="s">${[day(t.date), words(t.kind)].filter(Boolean).map(esc).join(" · ")}</span>${w ? fileLine(w) : ""}</button>`; };
  const posting = (p) => `<div class="p"><span class="acc">${esc(p.target || "Not held yet")}</span><span class="amt num">${exact(p.amount_cents, { plus: true })}</span></div>`;
  const witness = (w) => `<div class="rec-witness"><div class="f">${ico("sheet")}<b>${esc(w.file || "File not held yet")}</b></div>
      <div class="m">${w.locator ? `<span class="tag accent">${esc(w.locator)}</span>` : ""}${w.kind ? `<span>${esc(WITNESS[w.kind] || words(w.kind))}</span>` : ""}${ROLE[w.role] ? `<span>${ROLE[w.role]}</span>` : ""}</div>
      ${w.sha256 ? `<div class="h">sha256 ${esc(w.sha256)}</div>` : ""}</div>`;
  K.RecordTrace = (t, view) => {
    const ps = rows(t.postings), ws = rows(t.witnesses), l1 = K.recordLaw(view, "L1");
    return `<h2>${esc(t.description || words(t.kind))}</h2><p class="rec-dtags"><span class="sub">${esc([day(t.date), words(t.kind), words(t.grade)].filter(Boolean).join(" · "))}</span></p>
      <ol class="rec-chain">
        <li><h3>The number</h3><div class="rec-big num">${exact(t.amount_cents) || "Not held yet"}</div></li>
        <li><h3>The event and its postings</h3>${ps.length ? `<div class="rec-postings">${ps.map(posting).join("")}</div>` : '<p class="sub">Postings not held yet.</p>'}${l1 && l1.claim ? `<p class="rec-dtags">${statTag(l1.status)}<span class="sub">${esc(l1.claim)}</span></p>` : ""}</li>
        <li><h3>The ${ws.length === 1 ? "witness" : "witnesses"}</h3>${ws.length ? ws.map(witness).join("") : '<p class="sub">Witnesses not held yet.</p>'}</li>
      </ol>
      ${ws.length ? '<p class="sub">The event is rebuilt from these lines on every replay. The hash names the exact file.</p>' : ""}`;
  };

  // ---------- things and coverage ----------
  const thingRow = (t) => { const facts = [t.refresh_by ? `Due ${day(t.refresh_by)}` : "", t.warranty_until ? `Warranty until ${day(t.warranty_until)}` : "", t.kind ? words(t.kind) : ""].filter(Boolean); return `<div class="rec-line"><span class="mid"><span class="t">${esc(t.name || t.asset_id)}</span><span class="s">${esc(facts.join(" · "))}</span></span><span class="v num">${money(t.replacement_cost_cents) ? esc(money(t.replacement_cost_cents)) : '<span class="muted">Cost not held yet</span>'}</span></div>`; };
  const coverRow = (c) => { const gaps = Array.isArray(c.missing) ? c.missing : [], known = isNum(c.have) && isNum(c.expected), shown = gaps.slice(0, 6).map(month).join(", "), more = gaps.length - 6; return `<div class="rec-line${gaps.length ? " short" : ""}"><span class="mid"><span class="t">${esc(c.name || c.stream)}</span>${gaps.length ? `<span class="s">Missing ${esc(shown)}${more > 0 ? ` and ${more} more` : ""}</span>` : ""}</span><span class="v num">${known ? `${count(c.have)} of ${count(c.expected)}` : '<span class="muted">Not held yet</span>'}</span></div>`; };
  const hasGaps = (c) => Array.isArray(c.missing) && c.missing.length > 0;
  // what is short stays in view; the streams with nothing missing fold away once the list has both
  const coverage = (all) => {
    const short = all.filter(hasGaps), whole = all.filter((c) => !hasGaps(c)), list = (xs) => `<div class="rec-lines">${xs.map(coverRow).join("")}</div>`;
    return short.length && whole.length ? `${list(short)}<details class="rec-more"><summary>${count(whole.length)} more, nothing missing</summary>${list(whole)}</details>` : list(all);
  };

  // ---------- experimental: each says what it does today, and a mock says it is one ----------
  const pills = (a) => `<span class="rec-pill">Experimental</span>${a.status ? `<span class="rec-pill ${a.status === "Mock" ? "mock" : "base"}">${esc(a.status)}</span>` : ""}`;
  const actionCard = (a) => `<div class="rec-xp"><div class="rec-pills">${pills(a)}</div><h3>${esc(a.title || a.button)}</h3>${a.today ? `<p class="sub">${esc(a.today)}</p>` : ""}<button type="button" class="btn ghost sm rec-xpbtn" data-open="xp:${esc(a.id)}">${esc(a.button || "Open")}${a.status === "Mock" ? ' <span class="rec-pill mock">Mock</span>' : ""}</button></div>`;
  K.recordAction = (view, id) => rows(view && view.experimental).find((a) => a.id === id) || null;
  const lawLine = (l) => `<div class="rec-line"><span class="mid"><span class="t">${esc(l.name || l.id)}</span>${l.worst ? `<span class="s">${esc(l.worst)}</span>` : ""}</span>${statTag(l.status)}</div>`;
  const ACTION_BODY = {
    collect: (view) => { const short = rows(view.coverage).filter(hasGaps); return short.length ? `<h3>What it would fetch</h3><div class="rec-lines">${short.map(coverRow).join("")}</div>` : ""; },
    reconcile: (view) => { const all = K.lawsInOrder(view); return `<h3>The laws, from the last replay</h3>${all.length ? `<div class="rec-lines">${all.map(lawLine).join("")}</div>` : '<p class="sub">Laws not held yet.</p>'}`; },
    tax_pack: (view, o) => {
      const y = K.recordsYear(view, o.fy), people = rows(y && y.people);
      if (!people.length) return '<p class="sub">This year is not held yet, so there is nothing to save.</p>';
      if (!o.canSave) return `<h3>${esc(y.fy)}</h3><p class="sub">Saving a file is not available in this view.</p>`;
      return `<h3>${esc(y.fy)}, the year picked under This year</h3><div class="dacts">${people.map((p) => `<button type="button" class="btn ghost sm" data-pack="${esc(p.person)}">${ico("dl")}Save ${esc(p.name || p.person)}'s pack</button>`).join("")}</div>`;
    },
  };
  // o: { fy (the year picked on the page), canSave (the host can save a file) }
  K.RecordAction = (a, view, o = {}) => {
    const body = ACTION_BODY[a.id], open = Array.isArray(a.open) ? a.open : [];
    return `<h2>${esc(a.title || a.button)}</h2><p class="rec-pills">${pills(a)}</p>
      ${a.status === "Mock" ? `<div class="rec-mock">${ico("warning")}<p><b>This is a mock.</b> ${esc(a.button || "This button")} runs nothing and reaches nothing.</p></div>` : ""}
      ${a.today ? `<h3>What it does today</h3><p>${esc(a.today)}</p>` : ""}
      ${body ? body(view, o) : ""}
      ${open.length ? `<h3>Open questions</h3><ul class="rec-open">${open.map((q) => `<li>${esc(q)}</li>`).join("")}</ul>` : ""}`;
  };

  // ---------- the tax pack: a real file for one person and year, the readiness steps and the items, with absent amounts left blank ----------
  const dollars = (c) => (isNum(c) ? (c / 100).toFixed(2) : "");
  K.taxPack = (view, fy, who) => {
    const y = K.recordsYear(view, fy), p = rows(y && y.people).find((x) => x.person === who); if (!p) return null;
    const r = p.readiness || {}, l = p.lodged, name = p.name || p.person || "";
    const lines = [{ section: "About", name: "Preview of the standard on the fictional Davies household" }]
      .concat(rows(r.steps).map((s) => ({ section: "Readiness", name: s.name || words(s.id), state: stepOf(s.state).word })))
      .concat(isNum(r.pct) && r.pct > 0 ? [{ section: "Readiness", name: "Percent ready", state: `${r.pct}%` }] : [])
      .concat(l ? [{ section: "The record", name: "Taxable income", state: "Lodged", amount: dollars(l.taxable_income_cents) }, { section: "The record", name: "Result", state: "Lodged", amount: dollars(l.result_cents) }] : [])
      .concat(rows(p.items).map((i) => ({ section: "Tax item", name: label(i), state: (EVIDENCE[i.evidence] || {}).word || "", amount: dollars(i.amount_cents), method: i.method })));
    const csv = E.csv(lines.map((x) => Object.assign({ fy: y.fy, person: name }, x)), [{ key: "fy", label: "Year" }, { key: "person", label: "Person" }, { key: "section", label: "Section" }, { key: "name", label: "Line" }, { key: "state", label: "State" }, { key: "amount", label: "Amount" }, { key: "method", label: "Method" }]);
    return { filename: `kitty-tax-pack-${y.fy}-${String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`, csv };
  };

  // ---------- the tab ----------
  const leadLine = (g) => {
    const facts = [isNum(g.files) ? `${count(g.files)} files` : "", isNum(g.events) ? `${count(g.events)} events` : ""].filter(Boolean).join(" and ");
    return `The household's record, rebuilt from its files${facts ? `: ${facts}` : ""}${g.as_of ? `, up to ${day(g.as_of)}` : ""}.`;
  };
  // o: { fy }, the year picked on the page. No view at all means this edition was built without one.
  K.Records = (view, o = {}) => {
    if (!view || typeof view !== "object") return '<div class="card rec-top"><p class="rec-lead">The record is not available in this edition.</p></div>';
    const y = K.recordsYear(view, o.fy), sections = rows(view.proof && view.proof.sections), all = K.lawsInOrder(view), traces = rows(view.traces), things = rows(view.things);
    const cover = rows(view.coverage), xp = rows(view.experimental).filter((a) => a.id);
    return `<div class="card rec-top" style="--i:0"><span class="tag accent">Preview</span><p class="rec-lead">${esc(leadLine(view.generated || {}))}</p><p class="sub">This edition is a preview of the standard running on the fictional Davies household. It is not read from the sheet yet.</p></div>
      <div class="card" style="--i:1"><div class="cardhead"><h2 class="q">This year</h2>${yearPicker(view, y)}</div><div id="recyear">${K.RecordsYear(view, y && y.fy)}</div></div>
      <div class="card" style="--i:2"><div class="cardhead"><h2 class="q">How we know</h2><span class="sub">Exact matches from the replay, and the laws that must all hold at once.</span></div>
        ${sections.length || all.length ? `${tally(all)}<div class="rec-how"><div class="rec-scores">${sections.length ? sections.map(scoreTile).join("") : notHeld("The scoreboard is")}</div><div class="rec-laws">${all.length ? all.map(lawRow).join("") : notHeld("The laws are")}</div></div>` : notHeld("Proof is")}</div>
      <div class="card hero rec-where" style="--i:3"><div class="cardhead"><h2 class="q">Where a number comes from</h2><span class="sub">Open a number. Follow it to the exact line of the exact file.</span></div>
        ${traces.length ? `<div class="rec-traces">${traces.map(traceRow).join("")}</div>` : notHeld("Examples are")}</div>
      <div class="grid rec-pair" style="--i:4">
        <div class="card span-5"><div class="cardhead"><h2 class="q">Things</h2><span class="sub">What falls due, and what it costs.</span></div>${things.length ? `<div class="rec-lines">${things.map(thingRow).join("")}</div>` : notHeld("Things are")}</div>
        <div class="card span-7"><div class="cardhead"><h2 class="q">What's missing</h2><span class="sub">Held, of what each stream should have.</span></div>${cover.length ? coverage(cover) : notHeld("Coverage is")}</div>
      </div>
      ${xp.length ? `<div class="card rec-xpwrap" style="--i:5"><div class="cardhead"><h2 class="q">Experimental</h2><span class="sub">Around the record, still being built. Each one says what it does today.</span></div><div class="rec-xps">${xp.map(actionCard).join("")}</div></div>` : ""}`;
  };
  return K;
});
