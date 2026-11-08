/* The Kitty kit: Tax view. This year so far, last year, and history, for each person or both together.
   Input { people, asOf, current:{fy, monthsElapsed, perPerson:{name:{salary, withheld, otherIncome, rentNet, deductions, taxable,
   tax, medicare, offsets, result, atRisk}}, missing}, returns:[{person, fy, status, taxable, tax, medicare, offsets, withheld,
   result, lodged, notice, pack, source, note}] } (src/kit/MODULES.md). A flagged deduction is held out of taxable income and the
   result; atRisk is the refund that rests on it. model() is pure; render() returns HTML; bind() wires the controls and the drawer.
   Runs in the page (window.Kit.TaxView) and in node (module.exports). It never knows which household it is drawing. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Kit = Object.assign(root.Kit || {}, { TaxView: factory() });
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const T = {};
  const STATUSES = ["Estimate", "Lodged", "Assessed", "Amended"];
  const MEANS = {
    Estimate: "Worked out from the year so far. Nothing has been lodged.",
    Lodged: "Sent to the ATO. The notice of assessment has not come yet.",
    Assessed: "The ATO has issued its notice of assessment.",
    Amended: "Changed after the first notice of assessment.",
  };
  const TOL = 1; // a dollar either way is rounding, not a problem
  const MINUS = "−";
  const LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
  const FOOT = "Estimates use published resident rates and simple rules. Not tax advice.";

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (v) => { if (v == null || v === "") return null; const x = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, "")); return Number.isFinite(x) ? x : null; };
  const sum = (a) => a.reduce((s, x) => s + (x || 0), 0);
  const comma = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fyNo = (fy) => { const m = /^FY(\d{2})$/i.exec(String(fy == null ? "" : fy).trim()); return m ? Number(m[1]) : null; };
  const fyLabel = (n) => "FY" + String(n).padStart(2, "0");
  const names = (list) => (list.length < 2 ? list.join("") : list.slice(0, -1).join(", ") + " and " + list[list.length - 1]);
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + "s"}`;
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const pct = (x) => (Math.round(x * 1000) / 10).toFixed(1) + "%";

  // Formatters. The page may pass opts.fmt (whole-dollar money) and opts.fmtDate (an ISO date).
  const fmts = (opts) => {
    const o = opts || {};
    const whole = (a) => (o.fmt ? String(o.fmt(a)) : "$" + comma(a));
    const money = (x) => { const r = Math.round(x); return (r < 0 ? MINUS : "") + whole(Math.abs(r)); };
    const abs = (x) => whole(Math.abs(Math.round(x)));
    const exact = (x) => { const c = Math.round(x * 100), a = Math.abs(c); return (c < 0 ? MINUS : "") + "$" + comma(Math.floor(a / 100)) + "." + String(a % 100).padStart(2, "0"); };
    const short = (x) => { const a = Math.abs(x), s = x < 0 ? MINUS : ""; if (a < 1000) return s + "$" + Math.round(a); if (a < 99950) return s + "$" + (a / 1000).toFixed(1) + "k"; return s + "$" + Math.round(a / 1000) + "k"; };
    const date = (iso) => { if (!iso) return ""; if (o.fmtDate) return o.fmtDate(iso); const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso)); return m ? `${Number(m[3])} ${SHORT[Number(m[2]) - 1]} ${m[1]}` : String(iso); };
    return { money, abs, exact, short, date };
  };
  const F0 = fmts();

  // Whole dollars that add up: round each part, then move single dollars to the parts that lost most in rounding until the parts
  // meet the target. A gap wider than the number of parts is a real difference, so the plain rounding stands.
  T.tie = (target, parts) => {
    const r = parts.map((p) => Math.round(p));
    let diff = target - sum(r);
    if (!parts.length || Math.abs(diff) > parts.length) return r;
    const err = parts.map((p, i) => ({ i, e: p - r[i] }));
    for (let guard = 0; diff !== 0 && guard < 50; guard++) {
      const up = diff > 0;
      err.sort((a, b) => (up ? b.e - a.e : a.e - b.e));
      const x = err[0]; r[x.i] += up ? 1 : -1; x.e += up ? -1 : 1; diff += up ? -1 : 1;
    }
    return r;
  };

  // ---------- model ----------
  const FIELD = { taxable: "taxable income", tax: "tax on income", medicare: "Medicare", withheld: "withheld" };

  function readRows(list, people, problems) {
    const seen = new Set(), out = [];
    list.forEach((r, i) => {
      if (!r || typeof r !== "object") { problems.push({ text: `Tax Returns row ${i + 2} could not be read, so it is left out.` }); return; }
      const person = String(r.person == null ? "" : r.person).trim(), n = fyNo(r.fy);
      if (!person || n == null) { problems.push({ person: person || null, text: `Tax Returns row ${i + 2} has no ${person ? "financial year like FY26" : "person"}, so it is left out.` }); return; }
      const fy = fyLabel(n), key = person + "|" + fy;
      if (seen.has(key)) { problems.push({ person, fy, text: `${person} has two rows for ${fy}. The first is used.` }); return; }
      seen.add(key);
      const row = { person, fy, fyNo: n, status: String(r.status == null ? "" : r.status).trim(), taxable: num(r.taxable), tax: num(r.tax), medicare: num(r.medicare), offsets: num(r.offsets) || 0, withheld: num(r.withheld), result: num(r.result), lodged: r.lodged || null, notice: r.notice || null, pack: r.pack || null, source: r.source || null, note: r.note || null, ok: true, problem: null };
      const gaps = Object.keys(FIELD).filter((k) => row[k] == null);
      if (gaps.length) { row.ok = false; row.problem = `no ${names(gaps.map((k) => FIELD[k]))}, so this year cannot be drawn.`; }
      else {
        row.bill = row.tax + row.medicare - row.offsets;
        row.worked = row.withheld - row.bill;
        if (row.result == null) row.result = row.worked;
        else if (Math.abs(row.result - row.worked) > TOL) row.problem = `the Result says ${F0.exact(row.result)}, but withheld less tax, Medicare and offsets comes to ${F0.exact(row.worked)}.`;
        row.shown = shownReturn(row);
      }
      if (!row.problem && !STATUSES.includes(row.status)) row.problem = `the status "${row.status || "blank"}" is not Estimate, Lodged, Assessed or Amended.`;
      if (row.problem) problems.push({ person, fy, text: `${person} ${fy}: ${row.problem}` });
      row.estimate = row.status === "Estimate";
      out.push(row);
    });
    out.sort((a, b) => a.fyNo - b.fyNo || people.indexOf(a.person) - people.indexOf(b.person));
    return out;
  }

  // Whole-dollar figures for a return that still add up: the result and withheld stay as rounded, tax and Medicare take the slack.
  function shownReturn(r) {
    const result = Math.round(r.result), withheld = Math.round(r.withheld), bill = withheld - result;
    const [tax, medicare, off] = T.tie(bill, [r.tax, r.medicare, -r.offsets]);
    return { result, withheld, bill, tax, medicare, offsets: -off, taxable: Math.round(r.taxable) };
  }

  function readPerson(name, x, fy, problems) {
    const v = (k) => num(x[k]) || 0;
    const deds = (Array.isArray(x.deductions) ? x.deductions : []).filter((d) => d && typeof d === "object").map((d) => ({
      person: name, label: String(d.label || "Deduction"), amount: Math.abs(num(d.amount) || 0), flagged: !!d.flagged,
      flag: d.flag ? String(d.flag) : "", why: d.why ? String(d.why) : "", source: d.source ? String(d.source) : "", atRisk: num(d.atRisk),
    })).filter((d) => d.amount > 0);
    const counted = deds.filter((d) => !d.flagged), flagged = deds.filter((d) => d.flagged);
    const salary = v("salary"), otherIncome = v("otherIncome"), rentNet = v("rentNet"), withheld = v("withheld");
    const deductionsTotal = sum(counted.map((d) => d.amount)), income = salary + otherIncome;
    const worked = income + rentNet - deductionsTotal;
    const taxable = num(x.taxable) != null ? num(x.taxable) : worked;
    if (Math.abs(taxable - worked) > TOL) problems.push({ person: name, fy, text: `${name} ${fy}: taxable income is ${F0.exact(taxable)}, but income, the rental result and deductions come to ${F0.exact(worked)}.` });
    const tax = v("tax"), medicare = v("medicare"), offsets = v("offsets"), bill = tax + medicare - offsets;
    const result = num(x.result) != null ? num(x.result) : withheld - bill;
    if (Math.abs(result - (withheld - bill)) > TOL) problems.push({ person: name, fy, text: `${name} ${fy}: the estimate says ${F0.exact(result)}, but withheld less tax and Medicare comes to ${F0.exact(withheld - bill)}.` });
    // The person's refund at risk, shared across flagged items without a figure of their own in proportion to their amounts.
    const own = flagged.filter((d) => d.atRisk != null), rest = flagged.filter((d) => d.atRisk == null);
    let atRisk = num(x.atRisk); if (atRisk == null) atRisk = sum(own.map((d) => d.atRisk));
    const left = Math.max(0, atRisk - sum(own.map((d) => d.atRisk))), restAmt = sum(rest.map((d) => d.amount));
    rest.forEach((d) => { d.atRisk = restAmt ? (left * d.amount) / restAmt : 0; });
    const rp = x.rentParts && typeof x.rentParts === "object" ? { gross: num(x.rentParts.gross) || 0, costs: Math.abs(num(x.rentParts.costs) || 0), capital: Math.abs(num(x.rentParts.capital) || 0) } : null;
    const p = { name, people: [name], together: false, salary, otherIncome, income, rentNet, rentParts: rp, withheld, deductions: counted, flagged, deductionsTotal, flaggedTotal: sum(flagged.map((d) => d.amount)), taxable, tax, medicare, offsets, bill, result, atRisk, resultIfAllowed: result + atRisk, sources: x.sources && typeof x.sources === "object" ? x.sources : {} };
    return finish(p);
  }

  function combine(list) {
    const s = (k) => sum(list.map((p) => p[k]));
    const byLabel = new Map();
    for (const p of list) for (const d of p.deductions) {
      const g = byLabel.get(d.label) || { label: d.label, amount: 0, parts: [], source: "" };
      g.amount += d.amount; g.parts.push({ person: p.name, amount: d.amount }); byLabel.set(d.label, g);
    }
    const rp = list.every((p) => p.rentParts) ? { gross: sum(list.map((p) => p.rentParts.gross)), costs: sum(list.map((p) => p.rentParts.costs)), capital: sum(list.map((p) => p.rentParts.capital)) } : null;
    const p = { name: "Together", people: list.map((x) => x.name), together: true, salary: s("salary"), otherIncome: s("otherIncome"), income: s("income"), rentNet: s("rentNet"), rentParts: rp, withheld: s("withheld"), deductions: [...byLabel.values()], flagged: list.flatMap((x) => x.flagged), deductionsTotal: s("deductionsTotal"), flaggedTotal: s("flaggedTotal"), taxable: s("taxable"), tax: s("tax"), medicare: s("medicare"), offsets: s("offsets"), bill: s("bill"), result: s("result"), atRisk: s("atRisk"), resultIfAllowed: s("resultIfAllowed"), each: list.map((x) => ({ name: x.name, result: x.result, shown: x.shown.result })), sources: {} };
    return finish(p);
  }

  // Whole-dollar figures that add up on the page, then the waterfall steps.
  function finish(p) {
    const result = Math.round(p.result), withheld = Math.round(p.withheld), bill = withheld - result;
    const [tax, medicare, off] = T.tie(bill, [p.tax, p.medicare, -p.offsets]);
    const taxable = Math.round(p.taxable);
    const [income, rentNet, ded] = T.tie(taxable, [p.income, p.rentNet, -p.deductionsTotal]);
    const [salary, otherIncome] = T.tie(income, [p.salary, p.otherIncome]);
    const deductions = T.tie(-ded, p.deductions.map((d) => d.amount));
    const rent = p.rentParts ? T.tie(rentNet, [p.rentParts.gross, -p.rentParts.costs, -p.rentParts.capital]) : null;
    p.shown = { result, withheld, bill, tax, medicare, offsets: -off, taxable, income, rentNet, deductionsTotal: -ded, salary, otherIncome, deductions, rentParts: rent && { gross: rent[0], costs: -rent[1], capital: -rent[2] } };
    p.steps = steps(p);
    p.scale = { lo: Math.min(0, ...p.steps.map((s) => s.from)), hi: Math.max(1, ...p.steps.map((s) => s.to)) };
    return p;
  }

  function steps(p) {
    const sh = p.shown, out = [];
    out.push({ key: "income", label: "Income", kind: "add", from: Math.min(0, p.income), to: Math.max(0, p.income), value: p.income, shown: sh.income, part: "taxable" });
    let run = p.income;
    if (Math.abs(p.rentNet) >= 0.5) { const to = run + p.rentNet; out.push({ key: "rent", label: p.rentNet < 0 ? "Rental loss" : "Rental profit", kind: p.rentNet < 0 ? "less" : "add", from: Math.min(run, to), to: Math.max(run, to), value: p.rentNet, shown: sh.rentNet, part: "taxable" }); run = to; }
    if (p.deductionsTotal >= 0.5) { out.push({ key: "deductions", label: "Deductions", kind: "less", from: run - p.deductionsTotal, to: run, value: -p.deductionsTotal, shown: -sh.deductionsTotal, part: "taxable" }); run -= p.deductionsTotal; }
    out.push({ key: "taxable", label: "Taxable income", kind: "total", from: Math.min(0, p.taxable), to: Math.max(0, p.taxable), value: p.taxable, shown: sh.taxable, part: "taxable" });
    out.push({ key: "tax", label: "Tax on income", kind: "add", from: 0, to: p.tax, value: p.tax, shown: sh.tax, part: "tax" });
    if (Math.abs(p.medicare) >= 0.5) out.push({ key: "medicare", label: "Medicare levy", kind: "add", from: p.tax, to: p.tax + p.medicare, value: p.medicare, shown: sh.medicare, part: "tax" });
    if (Math.abs(p.offsets) >= 0.5) out.push({ key: "offsets", label: "Tax offsets", kind: "less", from: p.tax + p.medicare - p.offsets, to: p.tax + p.medicare, value: -p.offsets, shown: -sh.offsets, part: "tax" });
    out.push({ key: "bill", label: "Tax for the year", kind: "total", from: 0, to: p.bill, value: p.bill, shown: sh.bill, part: "tax" });
    out.push({ key: "withheld", label: "Withheld from pay", kind: "paid", from: 0, to: p.withheld, value: p.withheld, shown: sh.withheld, part: "tax" });
    const refund = p.result >= 0;
    out.push({ key: "result", label: refund ? "Refund" : "Tax to pay", kind: refund ? "good" : "owe", from: Math.min(p.bill, p.withheld), to: Math.max(p.bill, p.withheld), value: p.result, shown: sh.result, part: "tax" });
    return out;
  }

  function period(n, months) {
    if (n == null) return null;
    const startYear = 2000 + n - 1, last = 6 + months - 1;
    return { from: `July ${startYear}`, to: `${LONG[last % 12]} ${startYear + (last >= 12 ? 1 : 0)}`, endYear: startYear + 1 };
  }

  function readCurrent(c, people, problems) {
    const n = fyNo(c.fy), fy = n != null ? fyLabel(n) : String(c.fy || "This year");
    const monthsElapsed = Math.max(1, Math.min(12, Math.round(num(c.monthsElapsed) || 12)));
    const who = {}, present = [];
    for (const p of people) { const x = c.perPerson[p]; if (x && typeof x === "object") { who[p] = readPerson(p, x, fy, problems); present.push(p); } }
    if (!present.length) return null;
    if (present.length > 1) who.together = combine(present.map((p) => who[p]));
    const missing = (Array.isArray(c.missing) ? c.missing : []).filter((m) => m && m.label).map((m) => ({ label: String(m.label), why: m.why ? String(m.why) : "", when: m.when ? String(m.when) : "", person: m.person ? String(m.person) : null }));
    return { fy, fyNo: n, monthsElapsed, factor: 12 / monthsElapsed, period: period(n, monthsElapsed), source: c.source ? String(c.source) : null, who, people: present, missing };
  }

  function readLast(rows, people) {
    const done = rows.filter((r) => r.ok && !r.estimate && STATUSES.includes(r.status));
    if (!done.length) return null;
    const n = Math.max(...done.map((r) => r.fyNo)), by = {}, before = {};
    for (const p of people) {
      const r = done.find((x) => x.person === p && x.fyNo === n); if (r) by[p] = r;
      const b = rows.find((x) => x.person === p && x.fyNo === n - 1 && x.ok); if (b) before[p] = b;
    }
    const list = people.filter((p) => by[p]).map((p) => by[p]);
    const together = list.length > 1 ? { result: sum(list.map((r) => r.result)), shown: sum(list.map((r) => r.shown.result)), people: list.map((r) => r.person), missing: people.filter((p) => !by[p]) } : null;
    return { fy: fyLabel(n), fyNo: n, by, before, together };
  }

  function readHistory(rows, people) {
    const years = [...new Set(rows.map((r) => r.fyNo))].sort((a, b) => a - b).map(fyLabel);
    const by = {};
    for (const p of people) by[p] = years.map((fy) => rows.find((r) => r.person === p && r.fy === fy) || null);
    const ok = rows.filter((r) => r.ok);
    const scale = { taxMax: Math.max(1, ...ok.map((r) => r.taxable)), lo: Math.min(0, ...ok.map((r) => r.result)), hi: Math.max(0, ...ok.map((r) => r.result)) };
    if (scale.hi - scale.lo < 1) scale.hi = scale.lo + 1;
    const together = years.map((fy) => {
      const rs = people.map((p) => rows.find((r) => r.person === p && r.fy === fy && r.ok)).filter(Boolean);
      return { fy, result: sum(rs.map((r) => r.result)), shown: sum(rs.map((r) => r.shown.result)), complete: rs.length === people.length, estimate: rs.some((r) => r.estimate), count: rs.length };
    });
    return { years, by, scale, together };
  }

  T.model = (input) => {
    if (!input || typeof input !== "object") return null;
    const returns = Array.isArray(input.returns) ? input.returns : [];
    const cur = input.current && typeof input.current === "object" && input.current.perPerson && typeof input.current.perPerson === "object" ? input.current : null;
    if (!returns.length && !cur) return null;
    const problems = [];
    const named = Array.isArray(input.people) && input.people.length ? input.people : [...new Set(returns.map((r) => r && r.person).concat(Object.keys((cur && cur.perPerson) || {})).filter(Boolean))];
    const people = named.map((p) => String(p).trim()).filter(Boolean);
    const rows = readRows(returns, people, problems);
    const current = cur ? readCurrent(cur, people, problems) : null;
    if (current) for (const p of current.people) {
      const est = rows.find((r) => r.person === p && r.fy === current.fy && r.estimate && r.ok);
      if (est && Math.abs(est.result - current.who[p].result) > TOL) problems.push({ person: p, fy: current.fy, text: `${p} ${current.fy}: the Tax Returns estimate says ${F0.exact(est.result)}, but the year so far comes to ${F0.exact(current.who[p].result)}.` });
    }
    return { asOf: input.asOf || null, people, rows, current, last: readLast(rows, people), history: readHistory(rows, people), problems };
  };

  // ---------- render ----------
  const VIEWS = [["year", "This year so far"], ["last", "Last year"], ["history", "History"]];
  const chip = (text, cls) => `<span class="kx-taxview-chip${cls ? " " + cls : ""}">${esc(text)}</span>`;
  const statusChip = (s) => chip(s, "st-" + String(s || "none").toLowerCase());
  const empty = (text) => `<div class="card"><p class="empty">${esc(text)}</p></div>`;
  const whoKey = (m, who) => (who === "together" || m.people.includes(who) ? who : "together");
  const dirWord = (x) => (Math.round(x) >= 0 ? "back" : "to pay");

  function seg(label, attr, items, on) {
    return `<div class="kx-taxview-seg" role="group" aria-label="${esc(label)}">${items.map(([k, t]) => `<button type="button" data-tv-${attr}="${esc(k)}" aria-pressed="${k === on}">${esc(t)}</button>`).join("")}</div>`;
  }

  T.render = (m, opts) => {
    if (!m) return "";
    const o = opts || {}, f = fmts(o);
    const view = VIEWS.some(([k]) => k === o.view) ? o.view : m.current ? "year" : "last";
    const multi = m.people.length > 1;
    const who = multi ? whoKey(m, o.who) : m.people[0];
    const span = m.history.years.length ? (m.history.years.length > 1 ? `${m.history.years[0]} to ${m.history.years[m.history.years.length - 1]}` : m.history.years[0]) : "";
    const whos = (multi ? [["together", "Together"]] : []).concat(m.people.map((p) => [p, p]));
    const body = view === "year" ? yearView(m, who, f) : view === "last" ? lastView(m, who, f) : historyView(m, who, f);
    const probs = m.problems.filter((p) => who === "together" || !p.person || p.person === who);
    return `<section class="kx-taxview" data-view="${esc(view)}" data-who="${esc(who)}" aria-label="Tax">
  <div class="kx-taxview-top">
    <div class="kx-taxview-titles"><h2 class="kx-taxview-title">Tax</h2><p class="sub">${esc(names(m.people))}${span ? `, ${esc(span)}` : ""}${m.asOf ? `. As of ${esc(f.date(m.asOf))}.` : "."}</p></div>
    <div class="kx-taxview-controls">${seg("Which year", "view", VIEWS, view)}${whos.length > 1 ? seg("Whose tax", "who", whos, who) : ""}</div>
  </div>
  ${who === "together" && multi ? `<p class="kx-taxview-whonote">Together adds up ${esc(names(m.people.map((p) => p + "'s")))} returns. Each of you still lodges your own.</p>` : ""}
  ${probs.length ? `<div class="kx-taxview-problems" role="status"><b>${plural(probs.length, "figure needs", "figures need")} a look on the sheet.</b><ul>${probs.map((p) => `<li>${esc(p.text)}</li>`).join("")}</ul></div>` : ""}
  <div class="kx-taxview-body">${body}</div>
  <p class="kx-taxview-foot">${esc(FOOT)}</p>
</section>`;
  };

  // ---------- this year ----------
  function yearSentence(c, p, f) {
    const lead = c.monthsElapsed >= 12 ? "With the whole year in, " : c.monthsElapsed === 1 ? "If the year runs like its first month, " : `If the year runs like the last ${WORDS[c.monthsElapsed]} months, `;
    const say = (name, x, plural) => (Math.round(x) >= 0 ? `${name} ${plural ? "get" : "gets"} about ${f.abs(x)} back` : `${name} ${plural ? "owe" : "owes"} about ${f.abs(x)}`);
    if (!p.together) return lead + say(p.name, p.result) + ".";
    const signs = new Set(p.each.map((e) => e.shown >= 0));
    if (signs.size === 1) return lead + say(names(p.people), p.result, true) + " between them.";
    return lead + p.each.map((e) => say(e.name, e.result)).join(" and ") + `, so about ${f.abs(p.result)} ${dirWord(p.result)} between them.`;
  }

  function yearView(m, who, f) {
    const c = m.current;
    if (!c) return empty("No estimate for this year yet. The sheet has no figures for the current year.");
    const p = c.who[who];
    if (!p) return empty(`No estimate for ${who} this year yet.`);
    const sh = p.shown, refund = sh.result >= 0;
    const period = c.period ? `${c.period.from} to ${c.period.to}` : "";
    const missing = c.missing.filter((x) => who === "together" || !x.person || x.person === who);
    const soon = missing.filter((x) => !/\b(January|February|March|April|May|June|July|August|September|October|November|December) \d{4}$/.test(x.when)).length;
    const hero = `<div class="card kx-taxview-hero">
  <div class="kx-taxview-hero-main">
    <div class="kx-taxview-eyebrow">${chip("Estimate", "est")}<span>${esc(p.together ? "Together" : p.name)}, ${esc(c.fy)} so far${period ? `: ${esc(period)}` : ""}</span></div>
    <button type="button" class="kx-taxview-big num" data-tv-open="working" aria-label="About ${esc(f.abs(sh.result))} ${refund ? "refund" : "to pay"}. See how it is worked out."><span class="kx-taxview-about">about</span>${esc(f.abs(sh.result))}<span class="kx-taxview-dir${refund ? "" : " owe"}">${refund ? "back" : "to pay"}</span></button>
    <p class="say">${esc(yearSentence(c, p, f))}</p>
    <p class="sub">${esc(c.source || "The sheet")}, ${c.monthsElapsed < 12 ? `${c.monthsElapsed} of 12 months${m.asOf ? ` to ${esc(f.date(m.asOf))}` : ""}, scaled to a full year` : "the whole year"}.</p>
    <button type="button" class="linkbtn" data-tv-open="working">See the working →</button>
  </div>
  <div class="kx-taxview-facts">
    <button type="button" class="kx-taxview-fact" data-tv-jump="flagged"><span class="k">Refund at risk</span><b class="num">${p.atRisk >= 0.5 ? `about ${esc(f.abs(p.atRisk))}` : "None"}</b><span class="d">${p.flagged.length ? plural(p.flagged.length, "flagged claim") : "Nothing flagged"}</span></button>
    <button type="button" class="kx-taxview-fact" data-tv-jump="missing"><span class="k">Before you can lodge</span><b class="num">${missing.length ? plural(missing.length, "thing") : "Nothing"}</b><span class="d">${missing.length ? (soon ? `${soon} to do now` : "All arrive later") : "missing"}</span></button>
  </div>
</div>`;
    return `${hero}
<div class="card kx-taxview-wfcard">
  <div class="cardhead"><span class="q">How it adds up</span><span class="sub">Every bar uses the same scale. Rounded to the dollar.</span></div>
  ${waterfall(p, c, f)}
</div>
<div class="kx-taxview-pair">${flaggedCard(p, f)}${missingCard(missing, who, f)}</div>`;
  }

  function stepSub(s, p, c, f) {
    const sh = p.shown;
    if (s.key === "income") { const bits = []; if (sh.salary) bits.push(`Salary ${f.abs(sh.salary)}`); if (sh.otherIncome) bits.push(`other income ${f.abs(sh.otherIncome)}`); return bits.join(", "); }
    if (s.key === "rent") return p.rentParts ? `Rent ${f.abs(sh.rentParts.gross)}, less ${f.abs(sh.rentParts.costs)} of costs and ${f.abs(sh.rentParts.capital)} of depreciation and capital works${p.together ? ", both halves" : ""}` : "Your share, after costs";
    if (s.key === "deductions") return p.deductions.map((d, i) => `${i ? d.label.toLowerCase() : d.label} ${f.abs(sh.deductions[i])}`).join(", ");
    if (s.key === "taxable") return "What the tax is worked out on";
    if (s.key === "tax") return `Resident rates for ${c.fy}${p.together ? ", on each return" : ""}`;
    if (s.key === "medicare") return p.taxable > 0 && Math.abs(p.medicare / p.taxable - 0.02) < 0.0005 ? "2% of taxable income" : "Levy and any surcharge";
    if (s.key === "offsets") return "Offsets taken off the tax";
    if (s.key === "withheld") return c.monthsElapsed < 12 ? "Tax taken out of pay, scaled to a full year" : "Tax taken out of pay";
    if (s.key === "result") return s.kind === "good" ? "Withheld from pay, less the tax for the year" : "Tax for the year, less what was withheld";
    return "";
  }

  function waterfall(p, c, f) {
    const { lo, hi } = p.scale, span = hi - lo || 1;
    const x = (v) => ((v - lo) / span) * 100;
    const billX = x(p.bill);
    const row = (s) => {
      const left = x(s.from), width = Math.max(0, x(s.to) - left);
      const guide = s.key === "withheld" || s.key === "result" ? `<line class="guide" x1="${billX.toFixed(3)}%" x2="${billX.toFixed(3)}%" y1="0" y2="22"/>` : "";
      const zero = lo < 0 ? `<line class="zero" x1="${x(0).toFixed(3)}%" x2="${x(0).toFixed(3)}%" y1="0" y2="22"/>` : "";
      const val = s.kind === "less" ? (s.shown < 0 ? MINUS : "") + f.abs(s.shown) : s.key === "rent" ? (s.shown < 0 ? MINUS : "+") + f.abs(s.shown) : s.key === "medicare" ? "+" + f.abs(s.shown) : f.abs(s.shown);
      const sub = stepSub(s, p, c, f);
      return `<div class="kx-taxview-wfrow is-${s.kind}">
  <div class="kx-taxview-wflabel"><span class="t">${esc(s.label)}</span>${sub ? `<span class="s">${esc(sub)}</span>` : ""}</div>
  <svg class="kx-taxview-wfbar" width="100%" height="22" aria-hidden="true" focusable="false"><rect class="trk" x="0" y="4" width="100%" height="14" rx="4"/>${zero}<rect class="bar" x="${left.toFixed(3)}%" y="4" width="${width.toFixed(3)}%" height="14" rx="3"/>${guide}</svg>
  <div class="kx-taxview-wfval num">${esc(val)}</div>
</div>`;
    };
    const a = p.steps.filter((s) => s.part === "taxable"), b = p.steps.filter((s) => s.part === "tax");
    const sh = p.shown;
    const claim = `${p.together ? "Together" : p.name}: income of ${f.abs(sh.income)}${sh.rentNet ? `, ${sh.rentNet < 0 ? "less a rental loss of " : "plus rental profit of "}${f.abs(sh.rentNet)}` : ""}${sh.deductionsTotal ? ` and deductions of ${f.abs(sh.deductionsTotal)}` : ""}, gives taxable income of ${f.abs(sh.taxable)}. Tax and Medicare of ${f.abs(sh.bill)} against ${f.abs(sh.withheld)} withheld leaves about ${f.abs(sh.result)} ${sh.result >= 0 ? "to come back" : "to pay"}.`;
    return `<figure class="kx-taxview-wf" role="group" aria-label="${esc(claim)}">
  <div class="kx-taxview-wfgroup">From income to taxable income</div>${a.map(row).join("")}
  <div class="kx-taxview-wfgroup">From tax to the ${sh.result >= 0 ? "refund" : "amount to pay"}</div>${b.map(row).join("")}
  <figcaption class="kx-taxview-wfkey"><span><i class="sw add"></i>Adds</span><span><i class="sw less"></i>Takes off</span><span><i class="sw total"></i>Total</span><span><i class="sw paid"></i>Already paid</span><span><i class="sw ${sh.result >= 0 ? "good" : "owe"}"></i>${sh.result >= 0 ? "Refund" : "To pay"}</span><span><i class="sw guide"></i>Tax for the year</span></figcaption>
</figure>`;
  }

  function flaggedCard(p, f) {
    const items = p.flagged;
    const head = `<div class="cardhead"><span class="q">Flagged claims</span>${items.length ? chip(`about ${f.abs(p.atRisk)} of refund at risk`, "amber") : ""}</div>`;
    if (!items.length) return `<div class="card kx-taxview-flagcard" data-tv-section="flagged" tabindex="-1">${head}<p class="kx-taxview-calm">Nothing is flagged${p.together ? "" : ` for ${esc(p.name)}`} this year. Every claim so far has its record.</p></div>`;
    const rows = items.map((d) => {
      const allowed = p.together ? null : p.resultIfAllowed;
      return `<li class="kx-taxview-flag">
  <div class="t">${p.together ? `<span class="kx-taxview-who">${esc(d.person)}</span>` : ""}${esc(f.abs(d.amount))} of ${esc(d.label.toLowerCase())} ${esc(d.flag || "is flagged")}: about ${esc(f.abs(d.atRisk))} of refund depends on it.</div>
  <div class="s">${d.why ? esc(d.why) + " " : ""}The estimate above leaves it out.${allowed != null && items.length === 1 ? ` If the claim is backed up, ${esc(p.name)}'s refund is about ${esc(f.abs(allowed))}.` : ""}</div>
  ${d.source ? `<div class="src">${esc(d.source)}</div>` : ""}
</li>`;
    }).join("");
    return `<div class="card kx-taxview-flagcard" data-tv-section="flagged" tabindex="-1">${head}<ul class="kx-taxview-flags">${rows}</ul></div>`;
  }

  function whenClass(w) { return w === "Now" ? "now" : /before/i.test(w) ? "soon" : /^until/i.test(w) ? "ongoing" : "later"; }

  function missingCard(list, who, f) {
    const head = `<div class="cardhead"><span class="q">What's missing before you can lodge</span>${list.length ? `<span class="sub">${plural(list.length, "thing")}</span>` : ""}</div>`;
    if (!list.length) return `<div class="card kx-taxview-misscard" data-tv-section="missing" tabindex="-1">${head}<p class="kx-taxview-calm">Nothing the sheet can see is missing.</p></div>`;
    return `<div class="card kx-taxview-misscard" data-tv-section="missing" tabindex="-1">${head}<ul class="kx-taxview-checks">${list.map((x) => `<li>
  <span class="box" aria-hidden="true"></span>
  <div class="mid"><div class="t"><span class="kx-taxview-vh">To do: </span>${who === "together" && x.person ? `<span class="kx-taxview-who">${esc(x.person)}</span>` : ""}${esc(x.label)}</div>${x.why ? `<div class="s">${esc(x.why)}</div>` : ""}</div>
  ${x.when ? `<span class="kx-taxview-when ${whenClass(x.when)}">${esc(x.when)}</span>` : ""}
</li>`).join("")}</ul></div>`;
  }

  // ---------- last year ----------
  function kvReturn(r, f) {
    const sh = r.shown, refund = sh.result >= 0;
    return `<dl class="kx-taxview-kv">
  <dt>Taxable income</dt><dd class="num">${esc(f.abs(sh.taxable))}</dd>
  <dt>Tax on income</dt><dd class="num">${esc(f.abs(sh.tax))}</dd>
  <dt>Medicare levy</dt><dd class="num">${esc(f.abs(sh.medicare))}</dd>
  ${Math.round(r.offsets) ? `<dt>Tax offsets</dt><dd class="num">${MINUS}${esc(f.abs(sh.offsets))}</dd>` : ""}
  <dt>Withheld from pay</dt><dd class="num">${esc(f.abs(sh.withheld))}</dd>
  <dt class="tot">${refund ? "Refund" : "Tax to pay"}</dt><dd class="tot num">${esc(f.abs(sh.result))}</dd>
</dl>`;
  }
  const dates = (r, f) => [r.lodged ? `Lodged ${f.date(r.lodged)}` : r.status === "Estimate" ? "" : "Lodged date not recorded", r.notice ? `notice of ${r.status === "Amended" ? "amended " : ""}assessment ${f.date(r.notice)}` : ""].filter(Boolean).join(", ");
  const packLine = (r) => (r.pack ? `<a class="kx-taxview-btn" href="${esc(r.pack)}" target="_blank" rel="noopener">Tax pack</a>` : `<p class="kx-taxview-quiet">No tax pack yet. Ask your agent: build the ${esc(r.fy)} tax pack.</p>`);

  function returnCard(r, before, f, showBefore) {
    const sh = r.shown;
    return `<div class="card kx-taxview-ret">
  <div class="cardhead"><span class="q">${esc(r.person)}</span>${statusChip(r.status)}</div>
  <div class="kx-taxview-mid num">${esc(f.abs(sh.result))}<span class="kx-taxview-dir${sh.result < 0 ? " owe" : ""}">${dirWord(sh.result)}</span></div>
  <p class="sub">${esc(r.fy)} return. ${esc(cap(dates(r, f)))}.</p>
  ${kvReturn(r, f)}
  ${r.note ? `<p class="kx-taxview-note">${esc(r.note)}</p>` : ""}
  ${before && showBefore ? `<p class="sub">${esc(before.fy)}: ${esc(f.abs(before.shown.result))} ${dirWord(before.shown.result)}${before.estimate ? ", estimated" : ""}.</p>` : ""}
  <div class="kx-taxview-actions">${packLine(r)}<button type="button" class="linkbtn" data-tv-open="row:${esc(r.person)}:${esc(r.fy)}">The full row →</button></div>
</div>`;
  }

  // One person's last return against the year before: what moved the result.
  function compareCard(r, b, f) {
    const signed = (x) => (x > 0 ? "+" : x < 0 ? MINUS : "") + f.abs(x);
    const res = (x) => (x < 0 ? MINUS : "") + f.abs(x);
    const rows = [["Taxable income", b.shown.taxable, r.shown.taxable, signed], ["Tax and Medicare", b.shown.bill, r.shown.bill, signed], ["Withheld from pay", b.shown.withheld, r.shown.withheld, signed], ["Result", b.shown.result, r.shown.result, signed, "tot"]];
    const dRes = r.shown.result - b.shown.result, dW = r.shown.withheld - b.shown.withheld, dB = r.shown.bill - b.shown.bill;
    const moved = (x, up, down) => (x === 0 ? "stayed the same" : `${x > 0 ? up : down} ${f.abs(x)}`);
    const say = dRes === 0 ? "The result was the same both years." : `The result ${dRes > 0 ? "improved" : "fell"} by ${f.abs(dRes)}: tax taken from pay ${moved(dW, "rose", "fell")}, and tax and Medicare ${moved(dB, "rose", "fell")}.`;
    return `<div class="card kx-taxview-cmp">
  <div class="cardhead"><span class="q">Against ${esc(b.fy)}</span><span class="sub">Minus means tax to pay</span></div>
  <div class="kx-taxview-tablewrap"><table class="kx-taxview-table"><thead><tr><th></th><th class="n">${esc(b.fy)}${b.estimate ? " (about)" : ""}</th><th class="n">${esc(r.fy)}</th><th class="n">Change</th></tr></thead><tbody>${rows.map(([l, x, y, fn, cls]) => `<tr${cls ? ` class="${cls}"` : ""}><th scope="row">${esc(l)}</th><td class="n num">${esc(cls ? res(x) : f.abs(x))}</td><td class="n num">${esc(cls ? res(y) : f.abs(y))}</td><td class="n num">${esc(fn(y - x))}</td></tr>`).join("")}</tbody></table></div>
  <p class="sub kx-taxview-cmpsay">${esc(say)}</p>
</div>`;
  }

  function lastView(m, who, f) {
    const L = m.last;
    if (!L) return empty("No lodged return on the sheet yet.");
    const ppl = who === "together" ? m.people : [who];
    const cards = ppl.map((p) => (L.by[p] ? returnCard(L.by[p], L.before[p], f, ppl.length > 1) : `<div class="card"><div class="cardhead"><span class="q">${esc(p)}</span></div><p class="empty">No ${esc(L.fy)} return for ${esc(p)} on the sheet yet.</p></div>`)).join("");
    let top = "";
    if (who === "together" && L.together) {
      const t = L.together, rs = t.people.map((p) => L.by[p]);
      const each = rs.map((r) => `${r.person} ${Math.round(r.result) >= 0 ? "got" : "paid"} ${f.abs(r.shown.result)}${Math.round(r.result) >= 0 ? " back" : ""}`).join(" and ");
      const statuses = [...new Set(rs.map((r) => r.status))];
      top = `<div class="card kx-taxview-hero is-last">
  <div class="kx-taxview-hero-main">
    <div class="kx-taxview-eyebrow"><span>Together, ${esc(L.fy)}</span></div>
    <div class="kx-taxview-big num"><span>${esc(f.abs(t.shown))}</span><span class="kx-taxview-dir${t.shown < 0 ? " owe" : ""}">${dirWord(t.shown)}</span></div>
    <p class="say">${esc(each)}${t.missing.length ? `. ${esc(names(t.missing))} ${t.missing.length === 1 ? "has" : "have"} no ${esc(L.fy)} return yet` : ""}.</p>
    <p class="sub">Tax Returns tab. ${statuses.length === 1 ? `${rs.length === 2 ? "Both" : "All"} returns ${statuses[0] === "Lodged" ? "lodged, waiting on the notice" : statuses[0].toLowerCase()}.` : rs.map((r) => `${r.person}: ${r.status.toLowerCase()}`).join(", ") + "."}</p>
  </div>
</div>`;
    }
    const cmp = ppl.length === 1 && L.by[who] && L.before[who] ? compareCard(L.by[who], L.before[who], f) : "";
    return `${top}<div class="kx-taxview-rets${ppl.length > 1 || cmp ? " two" : ""}">${cards}${cmp}</div>`;
  }

  // ---------- history ----------
  const TH = 112, RH = 104, PAD = 18; // taxable chart height, result chart height, label room above and below

  function histCell(r, fy, H, f, chart) {
    if (!r) return `<span class="kx-taxview-hcell is-none"><svg width="100%" height="${chart === "t" ? TH : RH}" aria-hidden="true" focusable="false">${chart === "r" ? zeroLine(H) : ""}<text class="lbl muted" x="50%" y="${chart === "t" ? TH - 6 : zeroY(H) - 6}" text-anchor="middle">none</text></svg></span>`;
    if (!r.ok) return `<span class="kx-taxview-hcell is-bad"><svg width="100%" height="${chart === "t" ? TH : RH}" aria-hidden="true" focusable="false">${chart === "r" ? zeroLine(H) : ""}<text class="lbl" x="50%" y="${chart === "t" ? TH - 6 : zeroY(H) - 6}" text-anchor="middle">check</text></svg></span>`;
    const est = r.estimate ? " is-est" : "";
    if (chart === "t") {
      const h = Math.max(2, (r.taxable / H.scale.taxMax) * (TH - PAD)), y = TH - h;
      return `<span class="kx-taxview-hcell${est}"><svg width="100%" height="${TH}" aria-hidden="true" focusable="false"><rect class="tbar" x="22%" y="${y.toFixed(1)}" width="56%" height="${h.toFixed(1)}" rx="3"/><text class="lbl" x="50%" y="${(y - 5).toFixed(1)}" text-anchor="middle">${esc(f.short(r.taxable))}</text></svg></span>`;
    }
    const z = zeroY(H), per = (RH - 2 * PAD) / (H.scale.hi - H.scale.lo), h = Math.max(2, Math.abs(r.result) * per), up = r.result >= 0;
    const y = up ? z - h : z;
    const ly = up ? y - 5 : y + h + 13;
    return `<span class="kx-taxview-hcell${est}"><svg width="100%" height="${RH}" aria-hidden="true" focusable="false">${zeroLine(H)}<rect class="rbar ${up ? "good" : "owe"}" x="22%" y="${y.toFixed(1)}" width="56%" height="${h.toFixed(1)}" rx="3"/><text class="lbl ${up ? "" : "owe"}" x="50%" y="${ly.toFixed(1)}" text-anchor="middle">${up ? "" : MINUS}${esc(f.abs(r.result))}</text></svg></span>`;
  }
  const zeroY = (H) => PAD + (H.scale.hi / (H.scale.hi - H.scale.lo)) * (RH - 2 * PAD);
  const zeroLine = (H) => `<line class="zero" x1="0" x2="100%" y1="${zeroY(H).toFixed(1)}" y2="${zeroY(H).toFixed(1)}"/>`;

  function yearLabel(r, f) {
    if (!r) return "no row";
    if (!r.ok) return "row needs a look";
    return `${r.status ? r.status.toLowerCase() + ", " : ""}taxable income ${r.estimate ? "about " : ""}${f.abs(r.shown.taxable)}, ${r.estimate ? "about " : ""}${f.abs(r.shown.result)} ${dirWord(r.shown.result)}`;
  }

  function histPanel(p, rows, H, f) {
    const years = H.years;
    const okRows = rows.filter((r) => r && r.ok && !r.estimate);
    const first = okRows[0], lastR = okRows[okRows.length - 1];
    const claim = first && lastR && first !== lastR ? `${p}: taxable income went from ${f.abs(first.shown.taxable)} in ${first.fy} to ${f.abs(lastR.shown.taxable)} in ${lastR.fy}. ${okRows.filter((r) => r.result >= 0).length} of ${okRows.length} lodged years ended in a refund.` : `${p}: taxable income and result by year.`;
    const cells = (chart) => years.map((fy, i) => {
      const r = rows[i];
      const cls = r && r.status === "Amended" ? " is-amended" : "";
      const inner = histCell(r, fy, H, f, chart);
      if (!r) return `<div class="kx-taxview-hcol${cls}">${inner}</div>`;
      const label = `${fy}, ${yearLabel(r, f)}. Open the row.`;
      return chart === "t"
        ? `<button type="button" class="kx-taxview-hcol${cls}" data-tv-open="row:${esc(p)}:${esc(fy)}" tabindex="-1" aria-hidden="true">${inner}</button>`
        : `<button type="button" class="kx-taxview-hcol${cls}" data-tv-open="row:${esc(p)}:${esc(fy)}" aria-label="${esc(label)}">${inner}</button>`;
    }).join("");
    const axis = years.map((fy, i) => { const r = rows[i], am = r && r.status === "Amended"; return `<span class="kx-taxview-fy"><b>${esc(fy)}${am ? `<i class="dot"></i>` : ""}</b>${r && r.estimate ? `<small>about</small>` : am ? `<small>amended</small>` : ""}</span>`; }).join("");
    const notes = rows.filter((r) => r && (r.status === "Amended" || r.estimate)).map((r) => r.status === "Amended"
      ? `<li><i class="dot" aria-hidden="true"></i><span>${/^amended\b/i.test(r.note || "") ? `<b>${esc(r.fy)},</b> ${esc(r.note.charAt(0).toLowerCase() + r.note.slice(1))}` : `<b>${esc(r.fy)}, amended.</b> ${esc(r.note || "Changed after the first notice of assessment.")}`}</span></li>`
      : `<li><i class="sw est" aria-hidden="true"></i><span><b>${esc(r.fy)} is an estimate</b> from the year so far, not a lodged return.</span></li>`).join("");
    const cols = `style="--n:${years.length}"`;
    return `<div class="card kx-taxview-hist">
  <div class="cardhead"><span class="q">${esc(p)}</span><span class="sub">Tap a year for its full row.</span></div>
  <div role="group" aria-label="${esc(claim)}">
    <div class="kx-taxview-ctitle">Taxable income</div>
    <div class="kx-taxview-hgrid" ${cols}>${cells("t")}</div>
    <div class="kx-taxview-ctitle">Result<span>refund above the line, tax to pay below</span></div>
    <div class="kx-taxview-hgrid" ${cols}>${cells("r")}</div>
    <div class="kx-taxview-hgrid kx-taxview-axis" ${cols} aria-hidden="true">${axis}</div>
  </div>
  ${notes ? `<ul class="kx-taxview-hnotes">${notes}</ul>` : ""}
</div>`;
  }

  function historyTable(m, who, f) {
    const H = m.history, ppl = who === "together" ? m.people : [who];
    const cell = (r) => (!r ? `<td class="n muted">none</td>` : !r.ok ? `<td class="n muted">check</td>` : `<td class="n num${Math.round(r.result) < 0 ? " owe" : ""}">${Math.round(r.result) < 0 ? MINUS : ""}${esc(f.abs(r.shown.result))}</td>`);
    const fyHead = (fy, est, link) => `<th scope="row">${link ? `<button type="button" class="linkbtn" data-tv-open="${esc(link)}">${esc(fy)}</button>` : esc(fy)}${est ? `<small>about</small>` : ""}</th>`;
    const head = who === "together" ? `<tr><th>Year</th>${ppl.map((p) => `<th class="n">${esc(p)}</th>`).join("")}<th class="n">Together</th></tr>` : `<tr><th>Year</th><th>Status</th><th class="n">Taxable income</th><th class="n">Result</th></tr>`;
    const body = H.years.slice().reverse().map((fy) => {
      const i = H.years.indexOf(fy);
      if (who === "together") {
        const t = H.together[i];
        return `<tr>${fyHead(fy, t.estimate)}${ppl.map((p) => cell(H.by[p][i])).join("")}<td class="n num tot${t.shown < 0 ? " owe" : ""}">${t.count ? `${t.shown < 0 ? MINUS : ""}${esc(f.abs(t.shown))}${t.complete ? "" : "*"}` : "none"}</td></tr>`;
      }
      const r = H.by[who][i];
      return `<tr>${fyHead(fy, r && r.estimate, r ? `row:${who}:${fy}` : null)}<td>${r ? statusChip(r.status) : ""}</td><td class="n num">${r && r.ok ? esc(f.abs(r.shown.taxable)) : ""}</td>${cell(r)}</tr>`;
    }).join("");
    const partial = who === "together" && H.together.some((t) => t.count && !t.complete);
    return `<div class="card kx-taxview-tablecard">
  <div class="cardhead"><span class="q">Year by year</span><span class="sub">${who === "together" ? "Results, with both returns added up" : "From the Tax Returns tab"}. Minus means tax to pay.</span></div>
  <div class="kx-taxview-tablewrap"><table class="kx-taxview-table"><thead>${head}</thead><tbody>${body}</tbody></table></div>
  ${partial ? `<p class="sub">* One return is missing for that year, so the total is part of the picture.</p>` : ""}
</div>`;
  }

  function historyView(m, who, f) {
    const H = m.history;
    if (!H.years.length) return empty("No returns on the sheet yet.");
    const ppl = who === "together" ? m.people : [who];
    return `<div class="kx-taxview-hists${ppl.length > 1 ? " two" : ""}">${ppl.map((p) => histPanel(p, H.by[p] || [], H, f)).join("")}${ppl.length > 1 ? "" : historyTable(m, who, f)}</div>${ppl.length > 1 ? historyTable(m, who, f) : ""}`;
  }

  // ---------- drawers ----------
  T.drawer = (m, key, opts, who) => {
    const f = fmts(opts);
    const [kind, a, b] = String(key || "").split(":");
    if (kind === "row") return rowDrawer(m, a, b, f);
    if (kind === "working") return workingDrawer(m, who, f);
    return "";
  };

  function rowDrawer(m, person, fy, f) {
    const r = m.rows.find((x) => x.person === person && x.fy === fy);
    if (!r) return `<h2 class="kx-taxview-dtitle">${esc(person)}, ${esc(fy)}</h2><p class="empty">No row for this year.</p>`;
    const head = `<h2 class="kx-taxview-dtitle">${esc(person)}, ${esc(fy)}</h2><div class="kx-taxview-dmeta">${statusChip(r.status)}<span>${esc(MEANS[r.status] || "")}</span></div>`;
    if (!r.ok) return `${head}<div class="kx-taxview-problems"><b>This row needs a look.</b><ul><li>${esc(cap(r.problem || ""))}</li></ul></div>${src(r)}`;
    const refund = r.result >= 0, sumOk = Math.abs(r.result - r.worked) <= TOL;
    const rate = r.taxable > 0 ? (r.tax + r.medicare - r.offsets) / r.taxable : null;
    return `${head}
<p class="sub">${esc(cap(dates(r, f) || "Not lodged"))}.${r.estimate ? " An estimate, so every figure is about." : ""}</p>
<dl class="kx-taxview-kv exact">
  <dt>Taxable income</dt><dd class="num">${esc(f.exact(r.taxable))}</dd>
  <dt>Tax on income</dt><dd class="num">${esc(f.exact(r.tax))}</dd>
  <dt>Medicare levy</dt><dd class="num">${esc(f.exact(r.medicare))}</dd>
  <dt>Tax offsets</dt><dd class="num">${r.offsets ? MINUS : ""}${esc(f.exact(Math.abs(r.offsets)))}</dd>
  <dt>Tax for the year</dt><dd class="num">${esc(f.exact(r.bill))}</dd>
  <dt>Withheld from pay</dt><dd class="num">${esc(f.exact(r.withheld))}</dd>
  <dt class="tot">${refund ? "Refund" : "Tax to pay"}</dt><dd class="tot num">${esc(f.exact(Math.abs(r.result)))}</dd>
</dl>
<p class="kx-taxview-check${sumOk ? "" : " bad"}">${esc(f.exact(r.withheld))} withheld less ${esc(f.exact(r.bill))} tax for the year ${refund ? "leaves" : "is short by"} ${esc(f.exact(Math.abs(r.worked)))}${sumOk ? ", which matches the Result column." : `, but the Result column says ${esc(f.exact(r.result))}.`}</p>
${rate != null ? `<p class="sub">Tax and Medicare came to ${esc(pct(rate))} of taxable income.</p>` : ""}
${r.note ? `<p class="kx-taxview-note">${esc(r.note)}</p>` : ""}
${src(r)}
<div class="kx-taxview-actions">${packLine(r)}</div>`;
  }
  const src = (r) => `<p class="sub">From the Tax Returns tab, ${esc(r.person)}'s ${esc(r.fy)} row.${r.source ? ` <a href="${esc(r.source)}" target="_blank" rel="noopener">The return or notice</a>.` : ""}</p>`;

  function workingDrawer(m, who, f) {
    const c = m.current; if (!c) return "";
    const key = c.who[who] ? who : c.who.together ? "together" : c.people[0];
    const p = c.who[key];
    const cols = p.together ? c.people.map((n) => c.who[n]).concat([p]) : [p];
    const val = (x, neg) => `${neg && Math.abs(x) >= 0.005 ? MINUS : ""}${f.exact(Math.abs(x))}`;
    const labels = [...new Set(cols.flatMap((x) => x.deductions.map((d) => d.label)))];
    const ded = (x, label) => sum(x.deductions.filter((d) => d.label === label).map((d) => d.amount));
    const how = (k) => (p.together ? "" : p.sources[k] || "");
    const lines = [
      ["Salary and wages", (x) => val(x.salary), how("salary")],
      ["Other income", (x) => val(x.otherIncome), how("otherIncome")],
      [p.rentNet < 0 ? "Rental loss" : "Rental result", (x) => val(x.rentNet, x.rentNet < 0), how("rentNet")],
      ...labels.map((l) => [l, (x) => val(ded(x, l), true), p.together ? "" : (p.deductions.find((d) => d.label === l) || {}).source || ""]),
      ["Taxable income", (x) => val(x.taxable), "", "tot"],
      ["Tax on income", (x) => val(x.tax), how("tax")],
      ["Medicare levy", (x) => val(x.medicare), how("medicare")],
      ...(cols.some((x) => x.offsets) ? [["Tax offsets", (x) => val(x.offsets, true), how("offsets")]] : []),
      ["Tax for the year", (x) => val(x.bill), "", "tot"],
      ["Withheld from pay", (x) => val(x.withheld), how("withheld")],
      [p.result >= 0 ? "Refund" : "Tax to pay", (x) => (x.result < 0 ? MINUS : "") + f.exact(Math.abs(x.result)), "", "tot"],
    ];
    const thead = `<tr><th></th>${cols.map((x) => `<th class="n">${esc(x.together ? "Together" : x.name)}</th>`).join("")}${p.together ? "" : "<th>Where it comes from</th>"}</tr>`;
    const tbody = lines.map(([label, fn, h, cls]) => `<tr${cls ? ` class="${cls}"` : ""}><th scope="row">${esc(label)}</th>${cols.map((x) => `<td class="n num">${esc(fn(x))}</td>`).join("")}${p.together ? "" : `<td class="how">${esc(h)}</td>`}</tr>`).join("");
    const left = p.flagged.length ? `<h3 class="kx-taxview-dh">Left out of the estimate</h3><ul class="kx-taxview-dlist">${p.flagged.map((d) => `<li><b>${p.together ? esc(d.person) + ": " : ""}${esc(d.label)} ${esc(f.exact(d.amount))}</b> ${esc(d.flag || "flagged")}. About ${esc(f.abs(d.atRisk))} of refund depends on it.${d.source ? ` <span class="sub">${esc(d.source)}.</span>` : ""}</li>`).join("")}</ul>` : "";
    return `<h2 class="kx-taxview-dtitle">How the ${esc(c.fy)} estimate is worked out</h2>
<div class="kx-taxview-dmeta">${chip("Estimate", "est")}<span>${esc(p.together ? "Together" : p.name)}. ${esc(c.source || "The sheet")}${c.period ? `, ${esc(c.period.from)} to ${esc(c.period.to)}` : ""}${m.asOf ? `, as of ${esc(f.date(m.asOf))}` : ""}.</span></div>
<div class="kx-taxview-tablewrap"><table class="kx-taxview-table working">${`<thead>${thead}</thead>`}<tbody>${tbody}</tbody></table></div>
<p class="kx-taxview-check">${esc(f.exact(p.withheld))} withheld less ${esc(f.exact(p.bill))} tax for the year leaves ${esc(f.exact(Math.abs(p.withheld - p.bill)))} ${p.withheld - p.bill >= 0 ? "to come back" : "to pay"}.</p>
${c.monthsElapsed < 12 && !p.together ? `<p class="sub">Lines marked × 12/${c.monthsElapsed} are scaled from ${WORDS[c.monthsElapsed]} months to a full year. The rest count only what is recorded so far.</p>` : ""}
${p.together ? `<p class="sub">Together adds up the ${cols.length === 3 ? "first two" : "other"} columns. Tax is worked out on each return on its own, so choose a person to see where each line comes from.</p>` : ""}
${left}
<p class="sub">${esc(FOOT)}</p>`;
  }

  // ---------- bind ----------
  T.bind = (el, model, opts) => {
    if (!el || !model) return;
    // The latest model and options live on the element, so binding again after a refresh swaps them in without a second listener.
    const had = !!el.__kxTaxview;
    el.__kxTaxview = { model, opts: opts || {} };
    if (had) return;
    const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.addEventListener("click", (ev) => {
      const { model, opts: o } = el.__kxTaxview;
      const b = ev.target.closest("[data-tv-view],[data-tv-who],[data-tv-open],[data-tv-jump]");
      const root = b && b.closest(".kx-taxview");
      if (!b || !root || !el.contains(root)) return;
      const d = b.dataset;
      if (d.tvView != null || d.tvWho != null) {
        const view = d.tvView != null ? d.tvView : root.dataset.view, who = d.tvWho != null ? d.tvWho : root.dataset.who;
        if (view === root.dataset.view && who === root.dataset.who) return;
        const wrap = document.createElement("div");
        wrap.innerHTML = T.render(model, Object.assign({}, o, { view, who }));
        const next = wrap.firstElementChild; root.replaceWith(next);
        const sel = d.tvView != null ? `[data-tv-view="${view}"]` : `[data-tv-who="${(window.CSS && CSS.escape ? CSS.escape(who) : who)}"]`;
        const again = next.querySelector(sel); if (again) again.focus();
        if (o.onView) o.onView({ view, who });
        return;
      }
      if (d.tvJump) {
        const t = root.querySelector(`[data-tv-section="${d.tvJump}"]`);
        if (t) { t.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "start" }); t.focus({ preventScroll: true }); }
        return;
      }
      if (d.tvOpen && o.onOpen) o.onOpen(T.drawer(model, d.tvOpen, o, root.dataset.who));
    });
  };

  T.FOOT = FOOT;
  return T;
});
