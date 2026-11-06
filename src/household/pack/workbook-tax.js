/* The tax pack as a workbook, in the template's shape: Return Summary, Income, Shares, one tab per property, Loan Interest, Tax Estimate, Open Items.
   Better than the template in one way that matters: every line names the file behind it, with the page or row, and says whether that file is held.
   Blue is typed from a document, black is worked out in a live formula. A value nobody can find is the words "not found", never 0. */
(function (root, name, deps, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(...deps.map((d) => require(`./${d}.js`)));
  else { const K = (root.KittyPack = root.KittyPack || {}); K[name] = factory(...deps.map((d) => K[d])); }
})(typeof self !== "undefined" ? self : this, "workbookTax", ["pack", "xlsx", "formula"], function (P, X, F) {
  "use strict";
  const { Sheet } = X;
  const NF = "not found";
  const dollars = (c) => (c === null || c === undefined ? null : c / 100);
  const half = (x) => (x < 0 ? -1 : 1) * Math.round(Math.abs(x));        // what ROUND does in a spreadsheet
  const HELD = { held: ["Held", "ok"], at_risk: ["At risk", "warn"], missing: ["Missing", "stop"], not_needed: ["-", "muted"] };

  function shortName(name) { const parts = String(name).split(","); return (parts.length > 1 ? parts[parts.length - 1] : parts[0].split(" ")[0]).trim().slice(0, 20); }

  /* The workbook works the tax out for itself. Where the engine lands a cent away, the difference gets its own visible row rather than a quiet fudge:
     so a first pass measures, and a second writes the row. An empty adjustment writes nothing. */
  function render(pack) {
    const first = draw(pack, {});
    if (pack.blank) return first;
    const adj = {}, line = (id) => pack.lines.find((l) => l.id === `estimate.${id}`);
    for (const [id, key] of [["gross", "te.gross"], ["levy", "te.levy"], ["help", "te.help"], ["offsets", "te.offsets"]]) {
      const l = line(id); if (!l || l.amount_cents === null) continue;
      const d = l.amount_cents - Math.round(first.valueOf(key) * 100);
      if (d) adj[id] = d;
    }
    return Object.keys(adj).length ? draw(pack, adj) : first;
  }

  function draw(pack, adj) {
    const blank = !!pack.blank;
    const lines = pack.lines, of = (s) => lines.filter((l) => l.section === s), byId = new Map(lines.map((l) => [l.id, l]));
    const files = new Map(pack.evidence.map((e) => [e.ref, e]));
    const D = pack.scope.period, who = pack.scope.people[0].name, ties = [];
    const tie = (key, cents, what) => ties.push({ key, cents, what });
    const usable = (c) => { const e = files.get(c.ref); return e && !e.withheld; };

    const stateCells = (l) => { const [t, s] = HELD[l.evidence_state] || ["-", "muted"]; return { v: t, s }; };
    // The file behind a line: a link when there is one file, otherwise a link to its rows on the Evidence tab.
    function evCells(l) {
      if (blank) return [{ v: null, s: "blankText" }, { v: null, s: "blankText" }, { f: `IF(ISNUMBER(C${"{R}"}),"Entered","${NF}")`, s: "muted", row: true }];
      const list = (l.evidence || []).filter(usable), uniq = [...new Set(list.map((c) => c.ref))];
      const st = stateCells(l);
      if (!uniq.length) return [{ v: l.evidence_state === "not_needed" ? "Worked out here" : "None held", s: "muted" }, null, st];
      if (uniq.length === 1) { const e = files.get(uniq[0]), locs = [...new Set(list.map((c) => c.locator))]; return [{ v: e.path.split("/").pop(), file: e.path, s: "link" }, { v: locs.length > 3 ? `${locs.length} places` : locs.join(", "), s: "muted" }, st]; }
      return [{ v: `${uniq.length} files`, go: `ev.${l.id}`, s: "link" }, { v: "see Evidence", s: "muted" }, st];
    }
    const noteCell = (l) => ({ v: l.state === "nil" ? `Nil: ${l.nil_basis}` : l.note || null, s: "muted" });
    function amount(l, key, sOverride) {
      if (l.state === "not_found") return { v: NF, s: "notFound", key };
      if (l.state === "not_asked") return { v: null, s: "blank", key };
      return { v: dollars(l.amount_cents), s: sOverride || (l.kind === "calculated" ? "calc" : "input"), key };
    }
    const fixRow = (cells, r) => cells.map((c) => (c && c.row ? { ...c, f: c.f.replace("{R}", r), row: undefined } : c));
    const put = (s, cells, o) => { const r = s.next; return s.row(fixRow(cells, r), o); };
    const group = (a, b, col = "C") => `IF(COUNT(${col}${a}:${col}${b})=0,"${NF}",SUM(${col}${a}:${col}${b}))`;

    const titleOf = (s, t, n) => { s.span(t, "title", { ht: 24 }); if (n) s.span(n, "note"); s.gap(); };

    // ---------- Income ----------
    const inc = new Sheet("Income", { cols: [40, 26, 15, 15, 38, 15, 9, 46], color: "2E7D5B" });
    titleOf(inc, `INCOME & PERSONAL DEDUCTIONS | ${who} | ${D.label}`, "Blue figures are entered from the document named on the same row. Black figures are worked out here. Open the file by clicking its name, with the evidence folder beside this workbook.");
    const head = (s, cols) => s.row(cols.map((c, i) => ({ v: c, s: i >= 2 && i <= 3 ? "headR" : "head" })), { ht: 28 });
    inc.span("1. EMPLOYMENT INCOME (from the income statement, once it says Tax ready)", "section");
    head(inc, ["Employer", "Period", "Gross income", "PAYG withheld", "Evidence", "Page or row", "Held?", "Note"]);
    const emp = of("income.employment").filter((l) => l.label === "1" && l.engine !== "2");
    const empCounted = emp;
    const e0 = inc.next;
    for (const l of empCounted) put(inc, [{ v: l.name, s: "wrap" }, { v: l.fields.period, s: "muted" }, amount(l), l.state === "not_asked" ? { v: null, s: "blank" } : l.fields.payg_cents === null || l.fields.payg_cents === undefined ? { v: NF, s: "notFound" } : { v: dollars(l.fields.payg_cents), s: "input" }, ...evCells(l), noteCell(l)]);
    const e1 = inc.next - 1;
    if (empCounted.length) inc.row([{ v: "Total", s: "totalText" }, { v: null, s: "totalText" }, { f: group(e0, e1), s: "total", key: "emp.gross" }, { f: group(e0, e1, "D"), s: "total", key: "emp.payg" }]);
    else inc.row([{ v: "No employer held for this year", s: "totalText" }, { v: null, s: "totalText" }, { v: 0, s: "total", key: "emp.gross" }, { v: 0, s: "total", key: "emp.payg" }]);
    const allowance = byId.get("income.employment.allowances");
    if (allowance) put(inc, [{ v: "Less allowances, shown at label 2", s: "wrap" }, null, { v: dollars(allowance.amount_cents), s: "input", key: "label.2" }, null, ...evCells(allowance)]);
    inc.row([{ v: "Label 1, salary or wages", s: "bold" }, null, { f: allowance ? `IF(ISNUMBER({emp.gross}),{emp.gross}-{label.2},"${NF}")` : "{emp.gross}", s: "calc", key: "label.1" }]);
    inc.gap();
    inc.span("MEMO ITEMS, reported, not taxed", "section");
    head(inc, ["Item", "", "Amount", "", "Evidence", "Page or row", "Held?", "Note"]);
    for (const l of of("memo.items")) put(inc, [{ v: l.label ? `${l.name} (${l.label})` : l.name, s: "wrap" }, null, amount(l, `memo.${l.id.split(".")[1]}`), null, ...evCells(l), noteCell(l)]);
    inc.gap();
    inc.span("2. INTEREST INCOME. Joint accounts: your share only. An offset balance is not income; only credit interest is.", "section");
    head(inc, ["Account", "Your share of the account", "Your share AUD", "Whole account AUD", "Evidence", "Page or row", "Held?", "Note"]);
    const i0 = inc.next, intr = of("income.interest");
    for (const l of intr) put(inc, [{ v: l.name, s: "wrap" }, l.fields.share_bps ? { v: l.fields.share_bps / 10000, s: "pctIn" } : { v: blank ? null : "Varied in the year", s: blank ? "blank" : "muted" }, amount(l), l.state === "not_asked" ? { v: null, s: "blank" } : { v: dollars(l.fields.full_cents), s: "input" }, ...evCells(l), noteCell(l)]);
    const sum10 = byId.get("summary.10");
    if (!intr.length && sum10) put(inc, [{ v: "All accounts", s: "wrap" }, null, amount({ ...sum10, kind: "entered" }), null, ...evCells(sum10), noteCell(sum10)]);
    const i1 = inc.next - 1;
    inc.row([{ v: "Total, label 10", s: "totalText" }, { v: null, s: "totalText" }, { f: group(i0, Math.max(i0, i1)), s: "total", key: "label.10" }]);
    inc.gap();
    const perLabel = (title, sections) => {
      const rows = sections.flatMap(of);
      if (!rows.length) return;
      inc.span(title, "section");
      head(inc, ["Item", "ATO label", "Amount AUD", "", "Evidence", "Page or row", "Held?", "Note"]);
      for (const l of rows) put(inc, [{ v: l.name, s: "wrap" }, { v: l.label, s: "text" }, amount(l, `label.${l.engine}`), null, ...evCells(l), noteCell(l)]);
      inc.gap();
    };
    perLabel("3. DIVIDENDS AND MANAGED FUNDS", ["income.dividends", "income.trusts"]);
    perLabel("4. OTHER INCOME", ["income.other"]);
    const work = of("income.work"), dl = [...new Set(work.map((l) => l.label))];
    let sect = 5;
    if (dl.length) {
      inc.span(`${sect++}. DEDUCTIONS, by label. A bank line shows a payment, not what it bought, so a claim resting on one alone is marked at risk.`, "section");
      head(inc, ["Item", "Basis", "Claimable AUD", "", "Evidence", "Page or row", "Held?", "Note"]);
      for (const label of dl) {
        const a = inc.next, rows = work.filter((l) => l.label === label);
        for (const l of rows) put(inc, [{ v: l.name, s: "wrap" }, { v: l.fields.basis || null, s: "muted" }, amount(l), null, ...evCells(l), noteCell(l)]);
        inc.row([{ v: `Total ${label}`, s: "totalText" }, { v: null, s: "totalText" }, { f: group(a, inc.next - 1), s: "total", key: `label.${label}` }]);
      }
      inc.gap();
    }
    inc.span(`${sect++}. PRIVATE HEALTH INSURANCE AND SPOUSE`, "section");
    head(inc, ["Item", "Benefit code", "Premiums eligible (J)", "Rebate received (K)", "Evidence", "Page or row", "Held?", "Note"]);
    const h0 = inc.next, health = of("income.health");
    for (const l of health) put(inc, [{ v: l.name, s: "wrap" }, l.state === "not_asked" ? { v: null, s: "blankText" } : { v: l.fields.benefit_code ?? NF, s: "text" }, amount(l), l.state === "not_asked" ? { v: null, s: "blank" } : l.fields.rebate_cents === null || l.fields.rebate_cents === undefined ? { v: NF, s: "notFound" } : { v: dollars(l.fields.rebate_cents), s: "input" }, ...evCells(l), noteCell(l)]);
    const h1 = inc.next - 1;
    const hasHealth = health.length > 0;
    if (hasHealth) {
      inc.row([{ v: "Total (memo only, enter each line of the statement on the return)", s: "totalText" }, { v: null, s: "totalText" }, { f: group(h0, h1), s: "total", key: "phi.j" }, { f: group(h0, h1, "D"), s: "total", key: "phi.k" }]);
      const days = health.map((l) => l.fields.days).find((d) => d !== null && d !== undefined);
      inc.row([{ v: "Days of hospital cover", s: "wrap" }, null, days === undefined ? { v: blank ? null : NF, s: blank ? "blank" : "notFound", key: "phi.days" } : { v: days, s: "whole", key: "phi.days" }]);
    }
    for (const l of of("income.spouse")) put(inc, [{ v: l.name, s: "wrap" }, null, amount(l, "spouse.ti"), null, ...evCells(l), noteCell(l)]);

    // ---------- Shares ----------
    const sh = new Sheet("Shares", { cols: [24, 12, 12, 12, 13, 13, 13, 8, 13, 9, 36, 13, 9, 40], color: "6B4FBB" });
    titleOf(sh, `EMPLOYEE SHARES AND CAPITAL GAINS | ${who} | ${D.label}`, "Two separate tax items. The ESS discount is employment income at your marginal rate. A gain or loss on selling is a capital item. They are not alternatives, and nothing here counts the same dollar in both.");
    const shHead = (cols) => sh.row(cols.map((c) => ({ v: c, s: "head" })), { ht: 40 });
    sh.span("A. ESS DISCOUNT (label 12F), should agree to the tax office's pre-fill", "section");
    shHead(["Plan / vest", "Taxing point", "Units", "", "Discount AUD", "", "", "", "", "", "Evidence", "Page or row", "Held?", "Note"]);
    const s0 = sh.next, ess = of("shares.ess");
    for (const l of ess) put(sh, [{ v: l.name, s: "wrap" }, { v: l.fields.taxing_point || null, s: l.state === "not_asked" ? "blankText" : "date" }, { v: l.fields.units ? Number(l.fields.units) : null, s: l.state === "not_asked" ? "blank" : "units" }, null, amount(l), null, null, null, null, null, ...evCellsAt(l, "E"), noteCell(l)]);
    const s1 = sh.next - 1;
    sh.row([{ v: "Total, label 12F", s: "totalText" }, null, null, null, ess.length ? { f: group(s0, s1, "E"), s: "total", key: "label.12" } : { v: 0, s: "total", key: "label.12" }]);
    sh.gap();
    sh.span("B. CAPITAL GAINS, every parcel sold in the year. List every disposal: a sale with no gain still has to be declared.", "section");
    shHead(["Parcel", "Bought or vested", "Sold", "Units", "Cost base A$", "Proceeds A$", "Gain or (loss), whole parcel", "Your share", "Your gain or (loss)", "Held 12 months?", "Evidence", "Page or row", "Held?", "Note"]);
    const p0 = sh.next, parcels = of("shares.parcels");
    for (const l of parcels) {
      const f = l.fields, r = sh.next, askable = l.state === "not_asked";
      const moneyIn = (v) => (askable ? { v: null, s: "blank" } : v === null || v === undefined ? { v: NF, s: "notFound" } : { v: dollars(v), s: "input" });
      const gain = askable ? { f: `IF(AND(ISNUMBER(E${r}),ISNUMBER(F${r})),F${r}-E${r},"${NF}")`, s: "calc" } : f.gain_cents === null ? { v: NF, s: "notFound" } : { f: `F${r}-E${r}`, s: "calc" };
      const off = l.state === "value" || l.state === "nil" ? l.amount_cents - half(f.gain_cents * (f.share_bps / 10000)) : 0;
      const mine = askable ? { f: `IF(ISNUMBER(G${r}),ROUND(G${r}*H${r},2),"${NF}")`, s: "calc" } : l.state === "not_found" ? { v: NF, s: "notFound" } : { f: `ROUND(G${r}*H${r},2)${off ? `${off > 0 ? "+" : "-"}${Math.abs(off) / 100}` : ""}`, s: "calc" };
      put(sh, [{ v: l.name, s: "wrap" }, { v: f.acquired_on ?? (askable ? null : NF), s: askable ? "blankText" : f.acquired_on ? "date" : "notFound" }, { v: f.sold_on ?? null, s: askable ? "blankText" : "date" }, { v: f.units ? Number(f.units) : null, s: askable ? "blank" : "units" }, moneyIn(f.cost_cents), moneyIn(f.proceeds_cents), gain, { v: f.share_bps ? f.share_bps / 10000 : askable ? 1 : null, s: "pctIn" }, mine, { v: askable ? null : f.discount_eligible ? "Yes" : "No", s: askable ? "blankText" : "text" }, ...evCellsAt(l, "I"), { v: [f.foreign, l.note, l.state === "nil" ? l.nil_basis : null].filter(Boolean).join(" ") || null, s: "muted" }]);
    }
    const p1 = sh.next - 1;
    const pa = parcels.length ? `I${p0}:I${p1}` : null, pk = parcels.length ? `J${p0}:J${p1}` : null;
    sh.row([{ v: "Total", s: "totalText" }, null, null, null, parcels.length ? { f: `SUM(E${p0}:E${p1})`, s: "total" } : null, parcels.length ? { f: `SUM(F${p0}:F${p1})`, s: "total" } : null, parcels.length ? { f: `SUM(G${p0}:G${p1})`, s: "total" } : null, null, parcels.length ? { f: `SUM(I${p0}:I${p1})`, s: "total" } : null]);
    sh.gap();
    sh.span("SPLIT OF THE TOTAL ABOVE BY HOLDING PERIOD (feeds the Tax Estimate tab)", "section");
    const fund = byId.get("shares.fundgains");
    if (fund) put(sh, [{ v: fund.name, s: "wrap" }, null, null, null, { v: dollars(fund.amount_cents), s: "input", key: "cg.fund" }, null, null, null, null, null, ...evCellsAt(fund, "E"), noteCell(fund)]);
    const fundRef = fund ? "+{cg.fund}" : "";
    sh.row([{ v: "Gains held at least 12 months", s: "wrap" }, null, null, null, { f: pa ? `SUMIFS(${pa},${pa},">0",${pk},"Yes")${fundRef}` : `0${fundRef}`, s: "calc", key: "cg.eligible" }]);
    sh.row([{ v: "Gains held under 12 months", s: "wrap" }, null, null, null, { f: pa ? `SUMIFS(${pa},${pa},">0",${pk},"No")` : "0", s: "calc", key: "cg.other" }]);
    sh.row([{ v: "Capital losses this year", s: "wrap" }, null, null, null, { f: pa ? `-SUMIFS(${pa},${pa},"<0")` : "0", s: "calc", key: "cg.loss" }]);
    const carry = byId.get("shares.split.carry");
    sh.row([{ v: "Capital losses carried in from last year (label 18V last year)", s: "wrap" }, null, null, null, carry && carry.state === "value" ? { v: dollars(carry.amount_cents), s: "input", key: "cg.carry" } : { v: blank ? null : 0, s: blank ? "blank" : "input", key: "cg.carry" }]);
    sh.gap();
    sh.span("NOTES", "section");
    for (const n of ["The ESS discount is the market value at vesting less what you paid. That same value becomes the cost base, which is why a same-day sale shows no gain.", "Cost base is converted at the rate on the acquisition date, proceeds at the rate on the sale date. Never one rate for both.", "Vesting date is the acquisition date for employee shares, not the grant date.", "Broker proceeds are usually already net of commission. Check before deducting it again."]) sh.span(n, "note");
    function evCellsAt(l, col) { return evCells(l).map((c) => (c && c.row ? { ...c, f: c.f.replace(`C{R}`, `${col}{R}`) } : c)); }

    // ---------- Loan Interest ----------
    const ln = new Sheet("Loan Interest", { cols: [24, 16, 22, 30, 14, 14, 14, 13, 11, 36, 13, 9, 34], color: "B5541C" });
    titleOf(ln, `LOAN INTEREST, WHAT IS DEDUCTIBLE AND WHY | ${who} | ${D.label}`, "Deductibility follows the USE of the borrowed money, not the property securing it. Every loan is listed, including the ones that are not deductible, so the total reconciles. Figures are for the whole loan; each property tab applies your share once.");
    ln.row(["Loan / facility", "Lender", "Secured on", "What the money was used for", "Interest charged AUD", "Deductible AUD", "Not deductible, private AUD", "Not yet deductible AUD", "Deductible?", "Evidence", "Page or row", "Held?", "Note"].map((c) => ({ v: c, s: "head" })), { ht: 40 });
    const l0 = ln.next, loans = of("loans.rows");
    loans.forEach((l, i) => {
      const f = l.fields, q = l.state === "not_asked";
      const r = ln.next;
      put(ln, [{ v: l.name, s: q ? "blankText" : "wrap" }, { v: f.lender || null, s: q ? "blankText" : "wrap" }, { v: f.secured_on || null, s: q ? "blankText" : "wrap" }, { v: f.used_for || null, s: q ? "blankText" : "wrap" }, amount(l), q ? { v: null, s: "blank" } : { v: dollars(f.deductible_cents), s: "input", key: `loan.ded.${l.id}` }, q ? { v: null, s: "blank" } : { v: dollars(f.private_cents), s: "input" }, q ? { v: null, s: "blank" } : { v: dollars(f.undrawn_cents), s: "input" }, q ? { v: null, s: "blankText" } : { v: f.verdict, s: "text" }, ...evCellsAt(l, "E"), noteCell(l)]);
      void r; void i;
    });
    const l1 = ln.next - 1;
    ln.gap();
    ln.span("RECONCILIATION, this is what lets the accountant confirm nothing is missing", "section");
    const hasLoans = loans.length > 0;
    const rangeSum = (c) => (hasLoans ? `SUM(${c}${l0}:${c}${l1})` : "0");
    const rec = (name, f, s, key, note) => ln.row([{ v: name, s: s === "zero" ? "totalText" : "wrap" }, null, { f, s, key }, { v: note, s: "muted" }]);
    ln.merges.push();
    rec("Total interest charged across all loans", rangeSum("E"), "calc", "ln.total", "Should equal the sum of every lender statement");
    rec("Less: deductible", rangeSum("F"), "calc", "ln.ded", "Flows to the property tabs");
    rec("Less: not deductible, private use", rangeSum("G"), "calc", "ln.priv", "Home, car, personal");
    rec("Less: not yet deductible, undrawn", rangeSum("H"), "calc", "ln.undrawn", "Becomes deductible once the funds are used");
    rec("Unexplained difference, must be zero", "ROUND({ln.total}-{ln.ded}-{ln.priv}-{ln.undrawn},2)", "zero", "ln.diff", "If this is not zero, a loan is missing or a statement is short");
    ln.row([{ v: "Check", s: "wrap" }, null, { f: `IF(AND(COUNTIF(E${l0}:E${Math.max(l0, l1)},"${NF}")=0,{ln.diff}=0),"Reconciles","STOP: not reconciled")`, s: "bold", key: "ln.check" }]);
    ln.gap();
    ln.span("NOTES", "section");
    for (const n of ["Use of funds decides deductibility. A loan secured on your home but used to buy an investment is deductible. A loan secured on an investment but used privately is not.", "If a facility was used for more than one purpose, apportion it by the amount drawn for each and show the percentage.", "If you refinanced mid-year, the old lender's closed accounts still hold interest. Most lenders' annual reports only list open accounts.", "Money sitting in an offset account has not been used yet, so its interest is not deductible until it is drawn."]) ln.span(n, "note");

    // ---------- property ----------
    const propSheets = (pack.scope.properties || []).map((p) => {
      const s = new Sheet((p.tab || `Property ${shortName(p.name)}`).slice(0, 31), { cols: [46, 20, 15, 15, 38, 14, 9, 44], color: "1F6FB2" }), sec = p.section;
      titleOf(s, `INVESTMENT PROPERTY | ${p.location || p.name} | ${D.label}`, "These are FULL-PROPERTY figures. The ownership share is applied once, at the bottom. There is one tab for each property.");
      s.row([{ v: "Your ownership share", s: "bold" }, null, p.share_bps === null ? { v: null, s: "blank", key: `${sec}.share` } : { v: p.share_bps / 10000, s: "pctIn", key: `${sec}.share` }, null, { v: "Tax ownership on the last day of the year", s: "muted" }]);
      if (p.lease_from || p.acquired_on) s.row([{ v: "Bought / first lease", s: "wrap" }, null, null, null, { v: [p.acquired_on ? `Bought ${P.longDate(p.acquired_on)}` : null, p.lease_from ? `lease from ${P.longDate(p.lease_from)}` : null].filter(Boolean).join(", "), s: "muted" }]);
      s.gap();
      const pHead = (cols) => s.row(cols.map((c, i) => ({ v: c, s: i >= 2 && i <= 3 ? "headR" : "head" })), { ht: 28 });
      const block = (title, sections, totalName, key, hint) => {
        s.span(title, "section");
        pHead(["Item", "Period", "Amount AUD", "", "Evidence", "Page or row", "Held?", "Note"]);
        const a = s.next, rows = sections.flatMap(of);
        for (const l of rows) {
          if (l.fields.from_loan) put(s, [{ v: l.name, s: "wrap" }, { v: l.fields.period, s: "muted" }, { f: `{loan.ded.${l.fields.from_loan}}`, s: "calc", key: `${l.id}.v` }, null, ...evCells(l), { v: "From the Loan Interest tab", s: "muted" }]);
          else put(s, [{ v: l.name, s: "wrap" }, { v: l.fields.period || null, s: "muted" }, amount(l, `${l.id}.v`), null, ...evCells(l), noteCell(l)]);
        }
        const b = Math.max(a, s.next - 1);
        s.row([{ v: totalName, s: "totalText" }, { v: null, s: "totalText" }, rows.length ? { f: `SUM(C${a}:C${b})`, s: "total", key } : { v: 0, s: "total", key }, { v: null, s: "totalText" }, { v: hint || null, s: "muted" }]);
        s.gap();
        return rows;
      };
      block("1. RENTAL INCOME", [`${sec}.income`], "Total income", `${sec}.income.total`);
      const agent = block("2. EXPENSES PAID BY THE AGENT (must reconcile to the agent's statements)", [`${sec}.agent`], "Subtotal, agent paid", `${sec}.agent.total`, "Must equal money out on the agent's statements");
      const stated = byId.get(`${sec}.agent.stated`);
      if (stated) {
        put(s, [{ v: stated.name, s: "wrap" }, null, amount(stated, `${sec}.agent.statedv`), null, ...evCells(stated), noteCell(stated)]);
        s.row([{ v: "Difference, must be zero", s: "totalText" }, { v: null, s: "totalText" }, { f: `IF(ISNUMBER({${sec}.agent.statedv}),ROUND({${sec}.agent.total}-{${sec}.agent.statedv},2),"${NF}")`, s: "zero", key: `${sec}.agent.diff` }]);
        s.gap();
      }
      const direct = block("3. EXPENSES PAID DIRECTLY (never also in the agent list above)", [`${sec}.direct`], "Subtotal, paid directly", `${sec}.direct.total`);
      block("4. CAPITAL ITEMS, not claimed as an expense", [`${sec}.capital`], "Subtotal, capital (left out of the result below)", `${sec}.capital.total`);
      let step = 5;
      if (of(`${sec}.unclaimed`).length) block(`${step++}. LINKED TO THIS PROPERTY, NOT CLAIMED`, [`${sec}.unclaimed`], "Subtotal, not claimed (left out of the result below)", `${sec}.unclaimed.total`);
      s.span(`${step}. RESULT, your share applied once, here and nowhere else`, "section");
      s.row([{ v: "Leg", s: "head" }, { v: "ATO label", s: "head" }, { v: "Full property", s: "headR" }, { v: "Your share", s: "headR" }, { v: "Working", s: "head" }, { v: "", s: "head" }, { v: "", s: "head" }, { v: "", s: "head" }], { ht: 28 });
      const refs = (test) => direct.filter(test).map((l) => `{${l.id}.v}`).filter((k) => !/missing/.test(k));
      const dirSum = (rows) => (rows.length ? rows.join("+") : "0");
      const fullQ = dirSum(refs((l) => l.fields.rolls === "21Q")), fullF = dirSum(refs((l) => l.fields.rolls === "21F" && l.state !== "not_found"));
      const fullX = `{${sec}.agent.total}+{${sec}.direct.total}-(${fullQ})-(${fullF})`;
      const legRow = (name, label, full, id) => {
        const l = byId.get(`${sec}.result.${id}`), r = s.next, share = `{${sec}.share}`;
        const engine = l ? l.amount_cents : 0, fullCents = l ? l.fields.full_cents : 0;
        const off = l && l.state !== "not_found" ? engine - half(fullCents * (p.share_bps / 10000)) : 0;
        const extra = off ? `${off > 0 ? "+" : "-"}${Math.abs(off) / 100}` : "";
        s.row([{ v: name, s: "wrap" }, { v: label, s: "text" }, { f: full, s: "calc", key: `${sec}.full.${id}` }, { f: `ROUND(C${r}*${share},2)${extra}`, s: "calc", key: `${sec}.mine.${id}` }, { v: off ? `Share of the full figure, plus ${Math.abs(off)}c from splitting each entry separately` : "Share of the full figure", s: "muted" }]);
        if (l && !blank && l.state !== "not_found") { tie(`${sec}.mine.${id}`, engine, `${p.name}, your share, ${label}`); tie(`${sec}.full.${id}`, fullCents, `${p.name}, full property, ${label}`); }
      };
      legRow("Rent and other rental income", "21P", `{${sec}.income.total}`, "P");
      legRow("Interest deductions", "21Q", fullQ, "Q");
      legRow("Capital works deductions", "21F", fullF, "F");
      legRow("Other rental deductions", "21X", fullX, "X");
      s.row([{ v: "Net rent", s: "totalText" }, { v: "21", s: "totalText" }, { f: `{${sec}.full.P}-{${sec}.full.Q}-{${sec}.full.F}-{${sec}.full.X}`, s: "total", key: `${sec}.net.full` }, { f: `{${sec}.mine.P}-{${sec}.mine.Q}-{${sec}.mine.F}-{${sec}.mine.X}`, s: "total", key: `${sec}.net.mine` }, { v: "Flows to label 21 on the Return Summary", s: "muted" }]);
      void agent;
      return { s, sec };
    });

    // ---------- Return Summary ----------
    const rs = new Sheet("Return Summary", { cols: [9, 46, 15, 14, 17, 11, 38, 14, 13], color: "23304A", freeze: 0 });
    titleOf(rs, `TAX PACK | ${who} | ${D.label} (${D.long})`, `Every figure below comes from the tab named in Source, and the file behind it is named beside it. Blue text is entered from a document. Black is worked out. Prepared from what was held on ${P.longDate(pack.as_of)}. Preparation complete is not lodged. Not tax advice.`);
    const rsHead = () => rs.row(["ATO label", "Item", "Amount AUD", "Whole dollars on the return", "Source tab", "Status", "Evidence", "Page or row", "ATO pre-fill"].map((c, i) => ({ v: c, s: i === 2 || i === 3 || i === 8 ? "headR" : "head" })), { ht: 40 });
    const statusText = (l) => (l.state === "not_found" ? ["Not found", "stop"] : l.state === "nil" ? ["Nil", "ok"] : l.indicative ? ["Indicative", "indicative"] : l.evidence_state === "at_risk" ? ["At risk", "warn"] : l.evidence_state === "missing" ? ["No file", "warn"] : ["Confirmed", "ok"]);
    const tabName = (tab) => (tab === "Property" ? (propSheets[0] ? propSheets[0].s.name : "Return Summary") : tab);
    const statusCell = (l, r) => { if (blank) return { f: `IF(ISNUMBER(C${r}),"Entered","${NF}")`, s: "muted" }; const [t, st] = statusText(l); return { v: t, s: st }; };
    const summaryEv = (l) => {
      if (blank) return [null, null];
      const list = (l.evidence || []).filter(usable), uniq = [...new Set(list.map((c) => c.ref))];
      if (!uniq.length) return [{ v: l.state === "not_found" ? "None held" : "See the tab", s: "muted" }, null];
      if (uniq.length === 1) { const e = files.get(uniq[0]), locs = [...new Set(list.map((c) => c.locator))]; return [{ v: e.path.split("/").pop(), file: e.path, s: "link" }, { v: locs.length > 2 ? `${locs.length} places` : locs.join(", "), s: "muted" }]; }
      const first = lines.find((x) => !x.section.endsWith(".summary") && x.evidence.length && (x.engine === l.engine || x.fields.rolls === l.engine));
      return [{ v: `${uniq.length} files`, go: first ? `ev.${first.id}` : undefined, s: "link" }, { v: "see Evidence", s: "muted" }];
    };
    const rsRow = (l, formula, s) => {
      const r = rs.next, key = `rs.${l.id.replace("summary.", "")}`, amountF = formula;
      const c = l.state === "not_found" && !amountF ? { v: NF, s: "notFound", key } : { f: amountF, s: s || "calc", key };
      const pre = l.fields.prefill_cents;
      rs.row([{ v: l.label || "", s: "text" }, { v: l.name, s: "wrap" }, c, { f: `IF(ISNUMBER(C${r}),ROUNDDOWN(C${r},0),"${NF}")`, s: "wholeMoney", key: `${key}.whole` }, { v: l.fields.tab ? tabName(l.fields.tab) : "", go: keyForTab(l.fields.tab), s: "link" }, statusCell(l, r), ...summaryEv(l), pre === null || pre === undefined ? { v: null } : { v: pre / 100, s: "input" }]);
      if (l.amount_cents !== null && !blank) tie(key, l.amount_cents, `Return Summary, ${l.label || l.name}`);
      return r;
    };
    function keyForTab(tab) { return { Income: "emp.gross", Shares: "label.12", Property: propSheets[0] ? `${propSheets[0].sec}.share` : "emp.gross" }[tab] || "emp.gross"; }
    const lf = (l) => { const k = `label.${l.engine}`; return k; };
    const sumLine = (id) => byId.get(id);
    rs.span("INCOME", "section");
    rsHead();
    const incRows = of("income.summary");
    const a0 = rs.next;
    for (const l of incRows) {
      let f;
      if (l.state === "not_found") f = null;
      else if (l.engine === "18A") f = "{te.net.gain}";
      else f = `{${lf(l)}}`;
      rsRow(l, f);
    }
    const hasRent = of("rent.summary").length > 0;
    let rentRow = null;
    if (hasRent) {
      const r = rs.next;
      rs.row([{ v: "21", s: "text" }, { v: "Net rent, your share", s: "wrap" }, { f: `IF(COUNT({rs.21P},{rs.21Q},{rs.21F},{rs.21X})=4,${propSheets.map((p) => `{${p.sec}.net.mine}`).join("+") || "0"},"${NF}")`, s: "calc", key: "rs.21" }, { f: `IF(COUNT({rs.21P},{rs.21Q},{rs.21F},{rs.21X})=4,{rs.21P.whole}-{rs.21Q.whole}-{rs.21F.whole}-{rs.21X.whole},"${NF}")`, s: "wholeMoney", key: "rs.21.whole" }, { v: tabName("Property"), go: keyForTab("Property"), s: "link" }, { v: blank ? null : "Calculated", s: "muted" }, { v: "See item 21 below", s: "muted" }]);
      rentRow = r;
    }
    const a1 = rs.next - 1;
    rs.row([{ v: null, s: "totalText" }, { v: "TOTAL INCOME", s: "totalText" }, { v: null, s: "totalText" }, { f: `SUM(D${a0}:D${a1})`, s: "totalWhole", key: "rs.income" }, { v: null, s: "totalText" }, { f: `IF(COUNTIF(D${a0}:D${a1},"${NF}")>0,"Incomplete","Calculated")`, s: "totalText", key: "rs.income.status" }]);
    rs.gap();
    rs.span("DEDUCTIONS", "section");
    rsHead();
    const b0 = rs.next, dedRows = of("deductions.summary");
    for (const l of dedRows) rsRow(l, inc.keys.has(lf(l)) ? `{${lf(l)}}` : null);
    if (!dedRows.length) rs.row([{ v: "", s: "text" }, { v: "No deductions held", s: "muted" }]);
    const b1 = rs.next - 1;
    rs.row([{ v: null, s: "totalText" }, { v: "TOTAL DEDUCTIONS", s: "totalText" }, { v: null, s: "totalText" }, { f: `SUM(D${b0}:D${b1})`, s: "totalWhole", key: "rs.ded" }, { v: null, s: "totalText" }, { f: `IF(COUNTIF(D${b0}:D${b1},"${NF}")>0,"Incomplete","Calculated")`, s: "totalText", key: "rs.ded.status" }]);
    rs.row([{ v: null, s: "totalText" }, { v: "TAXABLE INCOME", s: "totalText" }, { v: null, s: "totalText" }, { f: "MAX({rs.income}-{rs.ded},0)", s: "totalWhole", key: "rs.taxable" }, { v: null, s: "totalText" }, { f: `IF(OR({rs.income.status}="Incomplete",{rs.ded.status}="Incomplete"),"Incomplete","Indicative")`, s: "totalText", key: "rs.taxable.status" }]);
    const est = sumLine("estimate.taxable");
    if (est && !blank) tie("rs.taxable", est.amount_cents, "Return Summary, taxable income");
    rs.gap();
    if (hasRent) {
      rs.span("ITEM 21, LEG BY LEG (the return asks for each)", "section");
      rsHead();
      for (const l of of("rent.summary")) {
        const id = l.id.split(".")[1].slice(2);
        rsRow(l, l.state === "not_found" ? null : propSheets.map((p) => `{${p.sec}.mine.${id}}`).join("+") || "0");
      }
      rs.gap();
    }
    rs.span("MEMO ITEMS, REPORTED, NOT TAXED", "section");
    rsHead();
    for (const l of of("memo.items")) { if (/^HELP/.test(l.name)) continue; const r = rs.next, key = `memo.${l.id.split(".")[1]}`; rs.row([{ v: l.label || "-", s: "text" }, { v: l.name, s: "wrap" }, { f: `{${key}}`, s: "calc" }, null, { v: "Income", go: key, s: "link" }, statusCell(l, r), ...summaryEv(l)]); }
    if (hasHealth) {
      const h = of("income.health")[0];
      rs.row([{ v: "M1", s: "text" }, { v: "Private health, premiums eligible (J)", s: "wrap" }, { f: "{phi.j}", s: "calc" }, null, { v: "Income", go: "phi.j", s: "link" }, statusCell(h, rs.next), ...summaryEv(h)]);
      rs.row([{ v: "M1", s: "text" }, { v: "Private health, rebate received (K)", s: "wrap" }, { f: "{phi.k}", s: "calc" }, null, { v: "Income", go: "phi.j", s: "link" }, statusCell(h, rs.next), ...summaryEv(h)]);
      rs.row([{ v: "M2", s: "text" }, { v: "Days of hospital cover", s: "wrap" }, { f: "{phi.days}", s: "wholeCalc" }, null, { v: "Income", go: "phi.j", s: "link" }, statusCell(h, rs.next)]);
    }
    for (const l of of("income.spouse")) rs.row([{ v: "-", s: "text" }, { v: l.name, s: "wrap" }, { f: "{spouse.ti}", s: "calc" }, null, { v: "Income", go: "spouse.ti", s: "link" }, statusCell(l, rs.next)]);
    for (const l of of("memo.summary")) { const k = { "summary.18H": "te.total.gains", "summary.18V": "te.carry.out" }[l.id]; rsRow(l, k ? `{${k}}` : `{income.20O}`); }
    rs.gap();
    rs.span("ESTIMATED OUTCOME, INDICATIVE ONLY", "section");
    rs.row(["", "Item", "Amount AUD", "", "Source tab", "Status"].map((c, i) => ({ v: c, s: i === 2 ? "headR" : "head" })), { ht: 20 });
    rs.row([{ v: "", s: "text" }, { v: "Estimated refund / (payable)", s: "bold" }, { f: "{te.result}", s: "calc", key: "rs.result" }, null, { v: "Tax Estimate", go: "te.result", s: "link" }, { f: `IF({rs.taxable.status}="Incomplete","Incomplete","Indicative")`, s: "indicative" }]);
    const resultLine = sumLine("estimate.result");
    if (resultLine && !blank) tie("rs.result", resultLine.amount_cents, "Return Summary, estimated result");
    rs.row([{ v: "", s: "text" }, { v: "Division 293, a separate ATO notice", s: "wrap" }, { v: NF, s: "notFound" }, null, { v: "Tax Estimate", go: "te.div293", s: "link" }, { v: "Open", s: "warn" }, { v: "The threshold is not in the Standard's reference", s: "muted" }]);
    rs.gap();
    rs.span("HOW TO READ THIS PACK", "section");
    const how = [["Return Summary", "This page. Every return input, by ATO label. Start and finish here."], ["Income", "Salary, interest, dividends, funds, deductions, donations, tax affairs, private health."], ["Shares", "ESS discount by vest, and the parcel schedule for anything sold."], [propSheets.length > 1 ? "Property tabs" : "Property", "Rental income and expenses, split agent-paid against paid directly, share applied once."], ["Loan Interest", "Which loan funded what, how much is deductible, and a difference that must be zero."], ["Tax Estimate", "Indicative outcome, from rates in the Standard's reference. Not a lodgement figure."], ["Open Items", "What is still missing, and the decisions left to the accountant."], ["Evidence", "Every line against its file, with the page or row and whether it is held."], ["Prior Years", "Earlier returns, every version kept. An amendment never overwrites."]];
    for (const [t, d] of how) rs.row([null, { v: t, s: "bold" }, { v: d, s: "muted" }]), rs.merges.push(`C${rs.rows.length}:I${rs.rows.length}`);

    // ---------- Tax Estimate ----------
    const te = new Sheet("Tax Estimate", { cols: [52, 16, 16, 60], color: "8A6D1B" });
    titleOf(te, `ESTIMATED TAX POSITION | ${who} | ${D.label} | INDICATIVE ONLY`, "A reconciliation check, not a lodgement figure. The accountant prepares the final return. Rates come from the Standard's dated reference and are shown here so every step can be followed.");
    const pm = (id) => pack.parameters.find((p) => p.id === id) || {};
    const conf = (p) => (p.valid_from ? `From the Standard's reference, in force from ${P.longDate(p.valid_from)}${p.confidence ? `, ${p.confidence}` : ""}.` : "Not in the Standard's reference.");
    te.span("RESIDENT TAX RATES", "section");
    te.row(["Income over", "Marginal rate", "Tax in this band", "Reference"].map((c) => ({ v: c, s: "head" })));
    const brackets = (pm("brackets").value || []).map((b) => (Array.isArray(b) ? { from: b[0], rate: b[1] } : b));
    const t0 = te.next;
    brackets.forEach((b, i) => {
      const r = te.next, nextFrom = brackets[i + 1] ? `A${r + 1}` : null;
      te.row([{ v: b.from, s: "whole" }, { v: b.rate, s: "pctIn" }, { f: nextFrom ? `MAX(0,MIN({te.ti},${nextFrom})-A${r})*B${r}` : `MAX(0,{te.ti}-A${r})*B${r}`, s: "calc" }, i === 0 ? { v: conf(pm("brackets")), s: "muted" } : null]);
    });
    const t1 = te.next - 1;
    te.row([{ v: "Medicare levy", s: "wrap" }, { v: pm("medicare").value ?? null, s: "pctIn", key: "te.levy.rate" }, null, { v: conf(pm("medicare")), s: "muted" }]);
    te.gap();
    te.span("TAXABLE INCOME", "section");
    te.row([{ v: "Total income", s: "wrap" }, { f: "{rs.income}", s: "calc" }]);
    te.row([{ v: "Less total deductions", s: "wrap" }, { f: "-{rs.ded}", s: "calc" }]);
    te.row([{ v: "Taxable income", s: "bold" }, { f: "{rs.taxable}", s: "total", key: "te.ti" }, null, { v: "Labels are whole dollars, each rounded down, as on the return", s: "muted" }]);
    te.gap();
    te.span("TAX PAYABLE", "section");
    const row = (name, f, key, note, s = "calc") => te.row([{ v: name, s: "wrap" }, f === null ? null : { f, s, key }, null, note ? { v: note, s: "muted" } : null]);
    const plus = (id) => (adj[id] ? `${adj[id] > 0 ? "+" : "-"}${Math.abs(adj[id]) / 100}` : "");
    const lmitoInForce = !!pm("lmito").value;
    const adjNote = (id) => (adj[id] && !(id === "offsets" && lmitoInForce) ? ` Includes ${adj[id] > 0 ? "+" : ""}${adj[id]}c so the sheet lands on the engine, which rounds binary noise: see FINDINGS.md.` : "");
    row("Income tax", `ROUND(SUM(C${t0}:C${t1}),2)${plus("gross")}`, "te.gross", `Works at any income; no bracket is typed into the formula.${adjNote("gross")}`);
    const lito = pm("lito").value, lmito = pm("lmito").value;
    let litoF = "0";
    if (lito) {
      const tiers = lito.tiers || lito.tapers || [];
      litoF = `ROUND(MAX(0,${lito.max ?? lito.maximum ?? 0}${tiers.map((x) => `-MAX(0,MIN({te.ti},${x.to ?? 1e12})-${x.from})*${x.rate}`).join("")}),2)`;
    }
    row("Low income tax offset", litoF, "te.lito", conf(pm("lito")));
    te.row([{ v: "Low and middle income tax offset", s: "wrap" }, lmito ? { v: (adj.offsets || 0) / 100, s: "input", key: "te.lmito" } : { v: 0, s: "input", key: "te.lmito" }, null, { v: lmito ? "From the engine: its income steps are in code, not in the reference. See FINDINGS.md." : "Not in force this year", s: "muted" }]);
    const foreign = lines.find((l) => l.id === "summary.20O");
    te.row([{ v: "Foreign income tax offset", s: "wrap" }, foreign ? { v: dollars(foreign.amount_cents), s: "input", key: "income.20O" } : { v: blank ? null : 0, s: blank ? "blank" : "input", key: "income.20O" }, null, { v: "From the annual tax statements", s: "muted" }]);
    row("Offsets, limited to the tax", `MIN({te.gross},{te.lito}+{te.lmito}+{income.20O})${lmitoInForce ? "" : plus("offsets")}`, "te.offsets", `Offsets cannot take income tax below zero.${adjNote("offsets")}`);
    row("Medicare levy", `ROUND({te.ti}*{te.levy.rate},2)${plus("levy")}`, "te.levy", adjNote("levy").trim() || null);
    const rentLoss = hasRent ? `IF(ISNUMBER({rs.21.whole}),MAX(0,-{rs.21.whole}),0)` : "0";
    row("Repayment income for HELP", `{te.ti}+${rentLoss}`, "te.repay", "Rental losses are added back");
    const helpV = pm("help").value, hasHelp = pack.scope.has_help;
    let helpF = "0", helpNote = hasHelp ? "" : "No HELP debt held";
    let helpTable = null;
    if (hasHelp && helpV && helpV.bands) { helpTable = helpV.bands; helpF = "ROUND({te.repay}*LOOKUP({te.repay},{help.a}:{help.b},{help.c}:{help.d}),2)"; helpNote = conf(pm("help")); }
    else if (hasHelp && helpV && helpV.marginal) { const m = helpV.marginal; helpNote = conf(pm("help")); helpF = `IF({te.repay}<=${m.from},0,IF({te.repay}>=${m.top_from ?? 1e12},ROUND({te.repay}*${m.top_rate ?? 0},2),IF({te.repay}<=${m.second_from},ROUND(({te.repay}-${m.from})*${m.rate},2),ROUND(${m.second_base}+({te.repay}-${m.second_from})*${m.second_rate},2))))`; }
    if (blank) { te.row([{ v: "Do you have a HELP debt? Yes or No", s: "wrap" }, { v: "No", s: "blankText", key: "te.hashelp" }]); helpF = `IF({te.hashelp}="Yes",${helpF},0)`; }
    row("HELP repayment", `${helpF}${plus("help")}`, "te.help", `${helpNote}${adjNote("help")}`.trim());
    row("Total tax and Medicare", "{te.gross}-{te.offsets}+{te.levy}+{te.help}", "te.total", null, "total");
    te.gap();
    te.span("OUTCOME", "section");
    te.row([{ v: "PAYG withheld", s: "wrap" }, { f: "{emp.payg}", s: "calc", key: "te.payg" }, null, { v: "From the income statements", s: "muted" }]);
    const fr = ["11U", "13Q"].map((l) => (inc.keys.has(`label.${l}`) ? `{label.${l}}` : null)).filter(Boolean);
    te.row([{ v: "Franking credits", s: "wrap" }, { f: fr.length ? `${fr.join("+")}` : "0", s: "calc", key: "te.franking" }, null, { v: "Refundable, through the result", s: "muted" }]);
    te.row([{ v: "Less total tax and Medicare", s: "wrap" }, { f: "-{te.total}", s: "calc" }]);
    te.row([{ v: "Private health rebate adjustment", s: "wrap" }, { v: NF, s: "notFound" }, null, { v: "Rebate tiers are not in the Standard's reference. Left to the accountant; see Open Items.", s: "muted" }]);
    te.row([{ v: "Estimated refund / (payable)", s: "bold" }, { f: `IF(ISNUMBER({te.payg}),{te.payg}+{te.franking}-{te.total},"${NF}")`, s: "total", key: "te.result" }, null, { v: "Before any private health adjustment. Indicative.", s: "indicative" }]);
    te.gap();
    te.span("DIVISION 293, a separate ATO notice, not part of the refund above", "section");
    te.row([{ v: "Taxable income", s: "wrap" }, { f: "{te.ti}", s: "calc" }]);
    te.row([{ v: "Add back: net rental loss", s: "wrap" }, { f: rentLoss, s: "calc", key: "te.addback" }, null, { v: "Rental losses are added back for this test", s: "muted" }]);
    te.row([{ v: "Add back: reportable fringe benefits", s: "wrap" }, { v: NF, s: "notFound" }, null, { v: "Not read from the income statement yet", s: "muted" }]);
    te.row([{ v: "Division 293 income, before fringe benefits", s: "wrap" }, { f: "{te.ti}+{te.addback}", s: "calc" }]);
    te.row([{ v: "Concessional super contributions", s: "wrap" }, { f: "{memo.concessional}", s: "calc" }, null, { v: "Actual contributions, not the cap", s: "muted" }]);
    te.row([{ v: "Division 293 tax", s: "wrap" }, { v: NF, s: "notFound", key: "te.div293" }, null, { v: "The threshold is not in the Standard's reference, so this is not worked out. No figure is assumed.", s: "muted" }]);
    te.gap();
    const cgParam = pm("cgt_discount");
    te.span("NET CAPITAL GAIN (label 18). Losses are applied BEFORE the discount", "section");
    te.row([{ v: "Gains held at least 12 months", s: "wrap" }, { f: "{cg.eligible}", s: "calc" }]);
    te.row([{ v: "Gains held under 12 months", s: "wrap" }, { f: "{cg.other}", s: "calc" }]);
    te.row([{ v: "Total current year capital gains (18H)", s: "wrap" }, { f: "{cg.eligible}+{cg.other}", s: "calc", key: "te.total.gains" }]);
    te.row([{ v: "Less capital losses, this year and prior years", s: "wrap" }, { f: "{cg.loss}+{cg.carry}", s: "calc", key: "te.losses" }]);
    te.row([{ v: "Losses used against gains held under 12 months", s: "wrap" }, { f: "MIN({te.losses},{cg.other})", s: "calc", key: "te.used.other" }]);
    te.row([{ v: "Losses used against gains held at least 12 months", s: "wrap" }, { f: "MIN({te.losses}-{te.used.other},{cg.eligible})", s: "calc", key: "te.used.disc" }]);
    te.row([{ v: "Rate kept after the discount, on eligible gains", s: "wrap" }, cgParam.value === null || cgParam.value === undefined ? { v: blank ? null : NF, s: blank ? "blank" : "notFound", key: "te.cgt.rate" } : { v: cgParam.value, s: "pctIn", key: "te.cgt.rate" }, null, { v: cgParam.value === null || cgParam.value === undefined ? "Method not settled for this year. See Open Items." : `Read by date. ${conf(cgParam)}`, s: "muted" }]);
    te.row([{ v: "Net capital gain", s: "bold" }, { f: `IF(ISNUMBER({te.cgt.rate}),ROUNDDOWN(ROUND(({cg.eligible}-{te.used.disc})*{te.cgt.rate},6),2)+{cg.other}-{te.used.other},"${NF}")`, s: "total", key: "te.net.gain" }]);
    te.row([{ v: "Capital losses carried forward (18V)", s: "wrap" }, { f: "{te.losses}-{te.used.other}-{te.used.disc}", s: "calc", key: "te.carry.out" }]);
    if (helpTable) {
      te.gap();
      te.span("HELP REPAYMENT BANDS", "section");
      te.row(["Repayment income from", "Rate", "", ""].map((c) => ({ v: c, s: "head" })));
      const rows = [[0, 0], ...helpTable];
      rows.forEach(([from, rate], i) => te.row([{ v: from, s: "whole", key: i === 0 ? "help.a" : i === rows.length - 1 ? "help.b" : undefined }, { v: rate, s: "pctIn", key: i === 0 ? "help.c" : i === rows.length - 1 ? "help.d" : undefined }]));
    }
    for (const [id, k] of [["gross", "te.gross"], ["offsets", "te.offsets"], ["levy", "te.levy"], ["help", "te.help"], ["payg", "te.payg"], ["franking", "te.franking"], ["result", "te.result"]]) { const l = sumLine(`estimate.${id}`); if (l && !blank) tie(k, l.amount_cents ?? 0, `Tax Estimate, ${l.name}`); }

    // ---------- Open Items ----------
    const oi = new Sheet("Open Items", { cols: [46, 54, 40, 15, 10], color: "B3261E" });
    titleOf(oi, `OPEN ITEMS | ${who} | ${D.label}`, "Everything not yet resolved, in one place. Clear section A before sending. Section B is for the accountant. Nothing here was turned into a number anywhere else.");
    oi.span("A. MISSING INFORMATION, owner: the taxpayer", "section");
    oi.row(["Item", "Why it is needed", "Where to get it", "Estimated amount", "Status"].map((c, i) => ({ v: c, s: i === 3 ? "headR" : "head" })), { ht: 28 });
    const A = pack.gaps.filter((g) => g.owner === "taxpayer"), B = pack.gaps.filter((g) => g.owner === "accountant");
    for (const g of A) oi.row([{ v: g.item, s: "wrap" }, { v: g.why, s: "wrap" }, { v: g.where, s: "wrap" }, g.amount_cents === null ? { v: "unknown", s: "muted" } : { v: g.amount_cents / 100, s: "input" }, { v: g.status, s: "warn" }]);
    if (!A.length) oi.row([{ v: blank ? "Add a row for anything you cannot find." : "Nothing missing.", s: "muted" }]);
    oi.gap();
    oi.span("B. DECISIONS FOR THE ACCOUNTANT, deliberately not claimed anywhere else", "section");
    oi.row(["Item", "The question", "Where to look", "Amount", "Status"].map((c, i) => ({ v: c, s: i === 3 ? "headR" : "head" })), { ht: 28 });
    for (const g of B) oi.row([{ v: g.item, s: "wrap" }, { v: g.why, s: "wrap" }, { v: g.where, s: "wrap" }, g.amount_cents === null ? { v: "unknown", s: "muted" } : { v: g.amount_cents / 100, s: "input" }, { v: g.status, s: "warn" }]);
    oi.gap();
    oi.span("Delete any row that does not apply. An empty section is a good result; a hidden one is not.", "note");
    oi.span(pack.boundary.join(" "), "note");

    // ---------- Evidence ----------
    const ev = new Sheet("Evidence", { cols: [46, 9, 62, 16, 13, 10, 12], color: "4A4A55", freeze: 4 });
    titleOf(ev, `EVIDENCE | ${who} | ${D.label}`, "Every line against the file behind it. Files sit in the evidence folder beside this workbook, named by date. Hashes are in manifest.csv.");
    ev.row(["Line", "ATO label", "File", "Page or row", "Role", "Held?", "File ref"].map((c) => ({ v: c, s: "head" })));
    if (!blank) for (const l of lines) {
      if (l.section.endsWith(".summary") || !l.evidence.length) continue;
      const seen = new Set(); let first = true;
      for (const c of l.evidence) {
        const k = `${c.ref}|${c.locator}`; if (seen.has(k)) continue; seen.add(k);
        const e = files.get(c.ref);
        ev.row([{ v: l.name, s: "wrap", key: first ? `ev.${l.id}` : undefined }, { v: l.label || "", s: "text" }, e.withheld ? { v: `${e.path.split("/").pop()} (held back: see Open Items)`, s: "warn" } : { v: e.path.replace(/^evidence\//, ""), file: e.path, s: "link" }, { v: c.locator, s: "muted" }, { v: c.role, s: "muted" }, stateCells(l), { v: e.ref, s: "muted" }]);
        first = false;
      }
    }
    if (blank) ev.row([{ v: "Your agent fills this from your files. By hand, list each document here.", s: "muted" }]);

    // ---------- Prior years ----------
    const pr = new Sheet("Prior Years", { cols: [12, 9, 14, 14, 16, 16, 18, 38, 13], color: "4A4A55" });
    titleOf(pr, `PRIOR YEARS | ${who}`, "Lodged returns are history. An amendment is a new version and the earlier one stays. Nothing here feeds the draft: it is here so the accountant does not have to ask.");
    pr.row(["Year", "Version", "Lodged", "Assessed", "Taxable income", "Result", "Status", "Evidence", "Page or row"].map((c, i) => ({ v: c, s: i === 4 || i === 5 ? "headR" : "head" })), { ht: 28 });
    for (const l of of("prior.returns")) {
      const f = l.fields, [e1, e2] = evCells(l);
      pr.row([{ v: f.fy, s: "text" }, { v: f.version, s: "whole" }, { v: f.lodged_on, s: "date" }, { v: f.assessed_on, s: "date" }, { v: dollars(l.amount_cents), s: "input" }, { v: dollars(f.result_cents), s: "input" }, { v: f.status, s: "wrap" }, e1, e2]);
    }
    if (!of("prior.returns").length) pr.row([{ v: blank ? "Add last year's return and notice of assessment." : "No earlier return is held.", s: "muted" }]);
    const taken = pack.takeback;
    let tb = null;
    if (taken) {
      tb = new Sheet("Lodged", { cols: [10, 44, 15, 15, 13, 12, 44], color: "23304A" });
      titleOf(tb, `WHAT CAME BACK | ${who} | ${D.label}`, `Version ${taken.return.version} assessed ${P.longDate(taken.return.assessed_on)}. The draft stays as it was; this tab sets it beside what was lodged. A lodged return outranks the draft.`);
      tb.row(["ATO label", "Item", "Draft AUD", "Lodged AUD", "Gap AUD", "Status", "Note"].map((c, i) => ({ v: c, s: i >= 2 && i <= 4 ? "headR" : "head" })), { ht: 28 });
      for (const r of taken.lines) { const n = tb.next; tb.row([{ v: r.label, s: "text" }, { v: r.name, s: "wrap" }, r.draft_cents === null ? { v: NF, s: "notFound" } : { v: r.draft_cents / 100, s: "input" }, r.lodged_cents === null ? { v: "not on the return", s: "muted" } : { v: r.lodged_cents / 100, s: "input" }, r.draft_cents === null || r.lodged_cents === null ? { v: "-", s: "muted" } : { f: `D${n}-C${n}`, s: "calc" }, { v: r.status === "ties" ? "Ties" : "Differs", s: r.status === "ties" ? "ok" : "warn" }, { v: r.note || null, s: "muted" }]); }
    }

    const book = { sheets: [rs, inc, sh, ...propSheets.map((p) => p.s), ln, te, oi, ev, pr, ...(tb ? [tb] : [])] };
    const solved = X.resolve(book);
    const cells = ties.map((t) => { const w = solved.where.get(t.key); if (!w) throw new Error(`Tie names ${t.key}`); return { sheet: w.sheet.name, cell: w.addr, cents: t.cents, what: t.what, computed: solved.valueOf(t.key) }; });
    return { book, ties: cells, valueOf: solved.valueOf, rentRow };
  }

  return { render, shortName };
});
