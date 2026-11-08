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
  const month = (s) => (/^\d{4}-\d{2}$/.test(s) ? E.fmtMonth(`${s}-01`) : /^\d{4}-\d{2}-\d{2}$/.test(s) ? E.fmtDay(s, { year: true }) : String(s));
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
  const ROLE = { recognises: "Shows this event happened", clears: "Settles this event", corroborates: "Agrees with this event" };
  const WITNESS = { txn_line: "Bank line", payslip: "Payslip" };
  // The laws in plain words. The standard's own wording stays in the law's drawer.
  const PLAIN = {
    L1: ["Every dollar is somewhere", "Each event's money in and money out add to zero."],
    L2: ["Nothing left waiting", "Money waiting to clear, such as a pay or a refund, is matched by month end, or each open item says how old it is and what is missing."],
    L3: ["Statements join up", "Each statement's opening balance plus its lines equals its closing balance, and that closing balance opens the next statement."],
    L4: ["Each line counted once", "Every bank line, payslip line and statement line belongs to exactly one event."],
    L5: ["Payslips add up", "Gross pay less tax, salary sacrifice and deductions, plus allowances, equals the net pay that landed."],
    L6: ["Interest is right", "Interest charged matches the rate on each day's balance, after the offset."],
    L7: ["Shares match the broker", "Units held equal what the broker states, for each share and date."],
    L8: ["Net worth matches the statements", "Net worth as recorded equals net worth as the statements give it, month by month."],
    L9: ["Ownership adds to 100%", "Each thing's owners' shares add to 100% on every day."],
    L10: ["One value at a time", "A rate, a contract or a setting has one value on any day, with no gap where one is needed."],
    L11: ["The return ties to the notice", "The return worked out from the rows agrees with the lodged return and the notice of assessment, label by label."],
    L12: ["Closed months stay closed", "A month that was closed has not changed since."],
    L13: ["Nothing missing", "Every account and statement has what it should for the period."],
    L14: ["Super reaches the fund", "Super on the payslips arrives at the fund, allowing for its usual delay."],
    L15: ["Every number has a source", "Every event points to a line in a file, and every file has a fingerprint."],
    L16: ["Within the limits", "Contributions and thresholds sit within the law for that date, or raise a question."],
    L17: ["Every decision still applies", "Every recorded decision points to something that still exists after a rebuild."],
    L18: ["Counted once", "A dollar owned through a fund, trust or company is not counted again by its members."],
    L19: ["Business sales tie", "Sales on the activity statements tie to business income on the return."],
    L20: ["No wild jumps", "A value does not jump by more than a set multiple between two readings."],
  };
  const lawName = (l) => (PLAIN[l.id] || [])[0] || l.name || l.id;
  const lawClaim = (l) => (PLAIN[l.id] || [])[1] || l.claim || "";
  // A return label is shown as its ATO description. PAYG and SG are not return labels; 21X is shown as item 21 until the
  // standard's world settles its letter (the return's other rental deductions are, to our reading, label U).
  const DESC = { 1: "Salary or wages", 10: "Gross interest", "11S": "Unfranked dividends", "11T": "Franked dividends", "11U": "Franking credits", 12: "Employee share schemes", "13U": "Trust income", "13C": "Trust franked distributions", "13Q": "Trust franking credits", "18A": "Net capital gain", "18H": "Capital gains this year", "18V": "Capital losses carried forward", "20M": "Other net foreign income", "20O": "Foreign income tax offset", 24: "Other income", "21P": "Gross rent", "21Q": "Rental interest", "21F": "Capital works", "21X": "Other rental deductions", "21U": "Other rental deductions", D1: "Work car expenses", D3: "Work clothing and laundry", D4: "Self-education", D5: "Other work expenses", D9: "Gifts and donations", D10: "Managing tax affairs" };
  const NOT_LABEL = { PAYG: "Tax withheld (not a return label)", SG: "Employer super (not a return label)", "PHI-REBATE": "Private health rebate" };
  const labelShown = (l) => (l === "21X" ? "item 21" : /^\d/.test(l) ? `item ${l}` : l);

  // ---------- the year ----------
  const isReal = (y) => rows(y.people).some((p) => p.lodged || rows(p.items).length || rows(p.readiness && p.readiness.steps).some((s) => s.state === "held"));
  const yearsOf = (view) => rows(view && view.years).filter((y) => y.fy);
  // the year asked for if the view holds it; otherwise the latest with anything real in it
  K.recordsYear = (view, fy) => { const ys = yearsOf(view); return ys.find((y) => y.fy === fy) || ys.filter(isReal).pop() || ys[ys.length - 1] || null; };

  // a step that does not count toward the percentage says so, so "5 of 7" reads true beside a list of nine
  const stepper = (steps) => `<ol class="rec-steps">${steps.map((s) => { const st = stepOf(s.state); return `<li class="${st.cls}${s.counts === false ? " nc" : ""}"><span class="dot" aria-hidden="true">${st.icon ? ico(st.icon) : ""}</span><span class="nm">${esc(s.name || words(s.id))}</span><span class="st">${s.counts === false && s.state !== "held" ? "May not apply" : st.word}</span></li>`; }).join("")}</ol>`;
  const result = (c) => (isNum(c) ? `${money(Math.abs(c))}${c ? `<small>${c < 0 ? "to pay" : "refund"}</small>` : ""}` : "");
  const orNot = (html) => html || `<span class="muted">not held yet</span>`;
  // the lodged return is the record; the derived figures sit beside it as a check, and the gap is the tie's own, never worked out here
  const lodged = (p) => {
    const l = p.lodged, d = p.derived || {}, t = p.tie || {};
    return `<div class="rec-lodged">
      <div class="rec-lhead"><span class="t">Lodged${isNum(l.version) && l.version > 1 ? `, version ${esc(l.version)}` : ""}</span>${t.status ? statTag(t.status) : ""}</div>
      ${l.assessed_on ? `<p class="sub">Assessed ${esc(day(l.assessed_on))}</p>` : ""}
      <table class="t rec-tie"><thead><tr><th scope="col"><span class="sr">Figure</span></th><th class="n" scope="col">Lodged</th><th class="n" scope="col">From the rows</th><th class="n" scope="col">Difference</th></tr></thead>
        <tbody><tr><th scope="row">Taxable income</th><td class="n"><b>${orNot(money(l.taxable_income_cents))}</b></td><td class="n">${orNot(money(d.taxable_income_cents))}</td><td class="n">${t.gap === 0 ? "None" : money(t.gap, { plus: true })}</td></tr>
        <tr><th scope="row">Result</th><td class="n"><b>${orNot(result(l.result_cents))}</b></td><td class="n">${orNot(result(d.result_cents))}</td><td class="n"></td></tr></tbody></table>
      ${t.detail ? `<p class="sub">${esc(t.detail)}</p>` : ""}
      <p class="sub">The lodged figure is the record. The figure worked out from the rows is a check on it.</p>
    </div>`;
  };
  const draft = (d) => `<div class="rec-lodged"><div class="rec-lhead"><span class="t">Worked out from the rows, a draft</span></div>
      <dl class="kv"><dt>Taxable income</dt><dd class="num">${orNot(money(d.taxable_income_cents))}</dd><dt>Result</dt><dd class="num">${orNot(result(d.result_cents))}</dd></dl>
      <p class="sub">A draft. Once a return is lodged, that return is the record.</p></div>`;
  const label = (i) => (i.label == null ? "Label not held yet" : `Label ${i.label}`);
  // what a reader sees: the ATO's description first, the label second; a category ID becomes its name
  // an ID with no name to hand reads as words: CRYPTO-INCOME is "Crypto income"
  K.idWords = (id) => E.cap(String(id || "").toLowerCase().replace(/[-_]+/g, " "));
  const shown = (i) => (i.label == null ? "Label not held yet" : NOT_LABEL[i.label] || (DESC[i.label] ? `${DESC[i.label]}, ${labelShown(i.label)}` : `Label ${i.label}`));
  // o.catName(id) names a category; without one, the method keeps its words but never shows a bare ID as a name
  const how = (m, o) => String(m || "").replace(/\bcategory ([A-Z][A-Z0-9-]+)/g, (x, id) => (o && typeof o.catName === "function" ? o.catName(id) : K.idWords(id)));
  const item = (o) => (i) => { const ev = EVIDENCE[i.evidence]; return `<div class="rec-item"><span class="lab">${esc(shown(i))}</span><span class="amt num">${orNot(exact(i.amount_cents))}</span><span class="how">${esc(how(i.method, o))}</span>${ev ? `<span class="tag ${ev.cls}">${ev.word}</span>` : ""}</div>`; };
  const person = (o) => (p) => {
    const r = p.readiness || {}, steps = rows(r.steps), items = rows(p.items), pct = isNum(r.pct) && r.pct > 0 ? r.pct : null;
    return `<article class="rec-person">
      <div class="rec-phead"><h3>${esc(p.name || p.person || "Adult")}</h3>${p.status === "lodged" ? '<span class="tag good">Lodged</span>' : ""}<span class="rec-pct num">${pct == null ? '<span class="muted">Not held yet</span>' : `${esc(pct)}%<small>ready${isNum(r.held) && isNum(r.needed) ? `, ${esc(r.held)} of ${esc(r.needed)}` : ""}</small>`}</span></div>
      ${pct == null ? "" : `<span class="rec-bar"><span style="width:${esc(pct)}%"></span></span>`}
      ${steps.length ? stepper(steps) : '<p class="sub">Steps not held yet.</p>'}
      ${p.lodged ? lodged(p) : p.derived ? draft(p.derived) : ""}
      <h4 class="rec-k">Tax items</h4>
      ${items.length ? `<div class="rec-items">${items.filter((i) => !NOT_LABEL[i.label]).map(item(o)).join("")}</div>${items.some((i) => NOT_LABEL[i.label]) ? `<h4 class="rec-k">Also held</h4><div class="rec-items">${items.filter((i) => NOT_LABEL[i.label]).map(item(o)).join("")}</div>` : ""}` : '<p class="sub">Tax items not held yet.</p>'}
    </article>`;
  };
  K.RecordsYear = (view, fy, o = {}) => {
    const y = K.recordsYear(view, fy), people = rows(y && y.people);
    if (!people.length) return notHeld("This year is");
    return `<div class="rec-people">${people.map(person(o)).join("")}</div><p class="sub rec-foot">The percentage counts the steps that apply to this person. A step marked "may not apply" joins it once something is held.</p>`;
  };
  const yearPicker = (view, y) => { const ys = yearsOf(view).reverse(); return ys.length ? `<label class="rec-pick"><span>Financial year</span><select id="recfy">${ys.map((x) => `<option value="${esc(x.fy)}"${x === y ? " selected" : ""}>${esc(x.fy)}${rows(x.people).some((p) => p.status === "lodged") ? " · lodged" : ""}</option>`).join("")}</select></label>` : ""; };

  // ---------- how we know ----------
  const scoreName = (n) => words(String(n || "").replace(/^sheet oracle: /i, "agrees with the sheet: "));
  const scoreTile = (r) => { const known = isNum(r.exact) && isNum(r.checked), tone = !known ? "" : r.exact === r.checked ? "good" : r.exact === 0 ? "warn" : "amber"; return `<div class="rec-score ${tone}"><span class="nm">${esc(scoreName(r.name))}</span><span class="v num">${known ? `${count(r.exact)} of ${count(r.checked)}` : "Not held yet"}</span>${isNum(r.pct) ? `<span class="rec-bar"><span style="width:${esc(r.pct)}%"></span></span>` : ""}</div>`; };
  const lawRow = (l) => `<button type="button" class="row rec-law" data-open="law:${esc(l.id)}">${statTag(l.status)}<span class="mid"><span class="t">${esc(lawName(l))}</span><span class="s">${esc(lawClaim(l))}</span></span>${ico("chev", "chev")}</button>`;
  // worst first, then in the standard's own order
  K.lawsInOrder = (view) => Object.keys(LAW).flatMap((s) => laws(view).filter((l) => (LAW[l.status] ? l.status : "skip") === s));
  const tally = (all) => { const seen = Object.keys(LAW).map((s) => [s, all.filter((l) => (LAW[l.status] ? l.status : "skip") === s).length]).filter(([, n]) => n); return seen.length ? `<div class="rec-tally">${seen.map(([s, n]) => `<div class="rec-tile ${s}">${ico(LAW[s].icon)}<span class="w"><b class="num">${n}</b> ${esc(LAW[s].word)}</span><span class="m">${esc(LAW[s].means)}</span></div>`).join("")}</div>` : ""; };
  K.recordLaw = (view, id) => laws(view).find((l) => l.id === id) || null;
  K.RecordLaw = (l) => {
    const counted = Object.keys(LAW).filter((s) => l.counts && isNum(l.counts[s]) && l.counts[s] > 0).map((s) => `${count(l.counts[s])} ${LAW[s].word.toLowerCase()}`);
    return `<h2>${esc(lawName(l))}</h2><p class="rec-dtags">${statTag(l.status)}<span class="sub">${esc(lawOf(l.status).means)}</span></p>
      ${lawClaim(l) ? `<h3>What it checks</h3><p>${esc(lawClaim(l))}</p>` : ""}
      ${l.claim && PLAIN[l.id] ? `<h3>In the standard's words</h3><p class="sub">${esc(l.name || l.id)}: ${esc(l.claim)}</p>` : ""}
      ${l.worst ? `<h3>${l.status === "fail" || l.status === "gap" ? "Worst detail" : "Detail"}</h3><p>${esc(l.worst)}</p>` : ""}
      ${counted.length ? `<h3>Results across its scopes</h3><p>${esc(counted.join(", "))}</p>` : ""}`;
  };

  // ---------- where a number comes from: the event, its balanced postings, each witness with its file and locator ----------
  const fileLine = (w) => `<span class="rec-file">${ico("sheet")}<span class="f">${esc(w.file || "File not held yet")}</span>${w.locator ? `<span class="loc">${esc(w.locator)}</span>` : ""}</span>`;
  const traceRow = (t, i) => { const w = rows(t.witnesses)[0]; return `<button type="button" class="rec-trace" data-open="trace:${i}"><span class="nm">${esc(t.description || words(t.kind))}</span><span class="amt num">${exact(t.amount_cents) || "Not held yet"}</span><span class="s">${[day(t.date), words(t.kind)].filter(Boolean).map(esc).join(" · ")}</span>${w ? fileLine(w) : ""}</button>`; };
  const posting = (p) => `<div class="p"><span class="acc">${esc(p.target || "Not held yet")}</span><span class="amt num">${exact(p.amount_cents, { plus: true })}</span></div>`;
  const witness = (w) => `<div class="rec-witness"><div class="f">${ico("sheet")}<b>${esc(w.file || "File not held yet")}</b></div>
      <div class="m">${w.locator ? `<span class="tag accent">${esc(w.locator)}</span>` : ""}${w.kind ? `<span>${esc(WITNESS[w.kind] || words(w.kind))}</span>` : ""}${ROLE[w.role] ? `<span>${ROLE[w.role]}</span>` : ""}</div>
      ${w.sha256 ? `<details class="h"><summary>File fingerprint</summary>SHA-256 ${esc(w.sha256)}</details>` : ""}</div>`;
  K.RecordTrace = (t, view) => {
    const ps = rows(t.postings), ws = rows(t.witnesses), l1 = K.recordLaw(view, "L1");
    return `<h2>${esc(t.description || words(t.kind))}</h2><p class="rec-dtags"><span class="sub">${esc([day(t.date), words(t.kind), words(t.grade)].filter(Boolean).join(" · "))}</span></p>
      <ol class="rec-chain">
        <li><h3>The number</h3><div class="rec-big num">${exact(t.amount_cents) || "Not held yet"}</div></li>
        <li><h3>Where the money went</h3>${ps.length ? `<div class="rec-postings">${ps.map(posting).join("")}</div>` : '<p class="sub">Not held yet.</p>'}${l1 && lawClaim(l1) ? `<p class="rec-dtags">${statTag(l1.status)}<span class="sub">${esc(lawClaim(l1))}</span></p>` : ""}</li>
        <li><h3>The ${ws.length === 1 ? "source line" : "source lines"}</h3>${ws.length ? ws.map(witness).join("") : '<p class="sub">Source lines not held yet.</p>'}</li>
      </ol>
      ${ws.length ? '<p class="sub">The event is rebuilt from these lines every time the record is rebuilt. The fingerprint names the exact file.</p>' : ""}`;
  };

  // ---------- things and coverage ----------
  const thingRow = (t) => { const facts = [t.refresh_by ? `Due ${day(t.refresh_by)}` : "", t.warranty_until ? `Warranty until ${day(t.warranty_until)}` : "", t.kind ? words(t.kind) : ""].filter(Boolean); return `<div class="rec-line"><span class="mid"><span class="t">${esc(t.name || t.asset_id)}</span><span class="s">${esc(facts.join(" · "))}</span></span><span class="v num">${exact(t.replacement_cost_cents) ? esc(exact(t.replacement_cost_cents)) : '<span class="muted">Cost not held yet</span>'}</span></div>`; };
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
  // the public page shows what works today; a mock and the builders' open questions stay in the repository
  const shownAction = (a) => a && a.id && a.status !== "Mock";
  K.recordAction = (view, id) => rows(view && view.experimental).find((a) => a.id === id && shownAction(a)) || null;
  const lawLine = (l) => `<div class="rec-line"><span class="mid"><span class="t">${esc(lawName(l))}</span>${l.worst ? `<span class="s">${esc(l.worst)}</span>` : ""}</span>${statTag(l.status)}</div>`;
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
    const body = ACTION_BODY[a.id];
    return `<h2>${esc(a.title || a.button)}</h2><p class="rec-pills">${pills(a)}</p>
      ${a.status === "Mock" ? `<div class="rec-mock">${ico("warning")}<p><b>This is a mock.</b> ${esc(a.button || "This button")} runs nothing and reaches nothing.</p></div>` : ""}
      ${a.today ? `<h3>What it does today</h3><p>${esc(a.today)}</p>` : ""}
      ${body ? body(view, o) : ""}`;
  };

  // ---------- the tax pack: a real file for one person and year, the readiness steps and the items, with absent amounts left blank ----------
  const dollars = (c) => (isNum(c) ? (c / 100).toFixed(2) : "");
  K.taxPack = (view, fy, who, o = {}) => {
    const y = K.recordsYear(view, fy), p = rows(y && y.people).find((x) => x.person === who); if (!p) return null;
    const r = p.readiness || {}, l = p.lodged, name = p.name || p.person || "";
    const lines = [{ section: "About", name: "Preview of the standard on the fictional Davies household" }]
      .concat(rows(r.steps).map((s) => ({ section: "Readiness", name: s.name || words(s.id), state: stepOf(s.state).word })))
      .concat(isNum(r.pct) && r.pct > 0 ? [{ section: "Readiness", name: "Percent ready", state: `${r.pct}%` }] : [])
      .concat(l ? [{ section: "The record", name: "Taxable income", state: "Lodged", amount: dollars(l.taxable_income_cents) }, { section: "The record", name: "Result", state: "Lodged", amount: dollars(l.result_cents) }] : [])
      .concat(rows(p.items).map((i) => ({ section: NOT_LABEL[i.label] ? "Also held" : "Tax item", name: shown(i), state: (EVIDENCE[i.evidence] || {}).word || "", amount: dollars(i.amount_cents), method: how(i.method, o) })));
    const csv = E.csv(lines.map((x) => Object.assign({ fy: y.fy, person: name }, x)), [{ key: "fy", label: "Year" }, { key: "person", label: "Person" }, { key: "section", label: "Section" }, { key: "name", label: "Line" }, { key: "state", label: "State" }, { key: "amount", label: "Amount" }, { key: "method", label: "Method" }]);
    return { filename: `kitty-tax-pack-${y.fy}-${String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`, csv };
  };

  // ---------- the tab ----------
  const leadLine = (g) => {
    const facts = [isNum(g.files) ? `${count(g.files)} files` : "", isNum(g.events) ? `${count(g.events)} events` : ""].filter(Boolean).join(" and ");
    return `A record rebuilt from a fictional household's files${facts ? `: ${facts}` : ""}${g.as_of ? `, up to ${day(g.as_of)}` : ""}.`;
  };
  // o: { fy }, the year picked on the page. No view at all means this edition was built without one.
  // o: { fy, catName(id) }. No view at all means this edition was built without one.
  K.Records = (view, o = {}) => {
    if (!view || typeof view !== "object") return '<div class="card rec-top"><p class="rec-lead">The record is not available in this edition.</p></div>';
    const y = K.recordsYear(view, o.fy), sections = rows(view.proof && view.proof.sections), all = K.lawsInOrder(view), traces = rows(view.traces), things = rows(view.things);
    const cover = rows(view.coverage), xp = rows(view.experimental).filter(shownAction);
    const g = view.generated || {};
    return `<div class="card rec-top rec-apart" style="--i:0"><span class="tag warn">A separate dataset</span><p class="rec-lead">This tab is a preview of a different fictional household. Its numbers will not match the other tabs.</p><p class="sub">Home, Activity, Insights and Goals read the Davies sheet${o.asOf ? ` as of ${esc(day(o.asOf))}` : ""}. This tab draws the standard's own test world, a second generated Davies family with its own files${g.as_of ? `, up to ${esc(day(g.as_of))}` : ""}, its own lodged returns and its own things. It is not read from the sheet.</p><p class="sub">${esc(leadLine(g))}</p></div>
      <div class="card" style="--i:1"><div class="cardhead"><h2 class="q">This year</h2>${yearPicker(view, y)}</div><div id="recyear">${K.RecordsYear(view, y && y.fy, o)}</div></div>
      <div class="card" style="--i:2"><div class="cardhead"><h2 class="q">How we know</h2><span class="sub">Exact matches from the replay, and the laws that must all hold at once.</span></div>
        ${sections.length || all.length ? `${tally(all)}<div class="rec-how"><div class="rec-scores">${sections.length ? sections.map(scoreTile).join("") : notHeld("The scoreboard is")}</div><div class="rec-laws">${all.length ? all.map(lawRow).join("") : notHeld("The laws are")}</div></div>` : notHeld("Proof is")}</div>
      <div class="card hero rec-where" style="--i:3"><div class="cardhead"><h2 class="q">Where a number comes from</h2><span class="sub">Open a number. Follow it to the exact line of the exact file.</span></div>
        ${traces.length ? `<div class="rec-traces">${traces.map(traceRow).join("")}</div>` : notHeld("Examples are")}</div>
      <div class="grid rec-pair" style="--i:4">
        <div class="card span-5"><div class="cardhead"><h2 class="q">When things need replacing</h2><span class="sub">What falls due, and what it costs.</span></div>${things.length ? `<div class="rec-lines">${things.map(thingRow).join("")}</div>` : notHeld("Things are")}</div>
        <div class="card span-7"><div class="cardhead"><h2 class="q">What's missing</h2><span class="sub">Held, of what each stream should have.</span></div>${cover.length ? coverage(cover) : notHeld("Coverage is")}</div>
      </div>
      ${xp.length ? `<div class="card rec-xpwrap" style="--i:5"><div class="cardhead"><h2 class="q">Experimental</h2><span class="sub">Around the record, still being built. Each one says what it does today.</span></div><div class="rec-xps">${xp.map(actionCard).join("")}</div></div>` : ""}`;
  };
  return K;
});
