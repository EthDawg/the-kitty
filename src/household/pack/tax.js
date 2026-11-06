/* The tax instance of a pack: one person, one year, for an accountant. Everything here reads the engine's result. It never computes tax, it arranges what
   the engine worked out, walks each figure back to its files, and says plainly what is held, what is at risk and what nobody can find. */
(function (root, name, deps, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(...deps.map((d) => require(`./${d}.js`)));
  else { const K = (root.KittyPack = root.KittyPack || {}); K[name] = factory(...deps.map((d) => K[d])); }
})(typeof self !== "undefined" ? self : this, "tax", ["pack", "evidence"], function (P, E) {
  "use strict";
  const { line } = P;
  const fyDates = (fy) => { const y = Number(fy.slice(2)); return { y, start: `${y - 1}-07-01`, end: `${y}-06-30`, stop: `${y}-07-01`, label: `FY ${y - 1}-${String(y).slice(2)}`, long: `1 Jul ${y - 1} - 30 Jun ${y}` }; };
  const seriesRow = (ref, id, on) => { const s = ref && ref.series && ref.series[id]; if (!s) return null; return s.rows.filter((r) => r.valid_from <= on && (r.valid_to == null || on < r.valid_to)).sort((a, b) => (a.valid_from < b.valid_from ? 1 : -1))[0] || null; };
  const sum = (a, f) => a.reduce((s, x) => s + (f ? f(x) : x), 0);

  // The engine splits each entry by largest remainder, ties to the lower key. A share has to be worked out the same way to land on the same cent.
  function allocate(cents, parts) {
    const total = parts.reduce((s, p) => s + p.weight, 0), sign = cents < 0 ? -1 : 1, abs = Math.abs(cents);
    const rows = parts.map((p) => { const exact = (abs * p.weight) / total; return { key: p.key, cents: Math.floor(exact), rem: exact - Math.floor(exact) }; });
    let left = abs - rows.reduce((s, r) => s + r.cents, 0);
    for (const r of [...rows].sort((a, b) => b.rem - a.rem || String(a.key).localeCompare(String(b.key)))) { if (left <= 0) break; r.cents += 1; left -= 1; }
    return new Map(rows.map((r) => [r.key, r.cents * sign]));
  }

  const NAMES = { 1: "Salary or wages - gross", 2: "Allowances, earnings, tips", 10: "Gross interest", "11S": "Dividends - unfranked", "11T": "Dividends - franked", "11U": "Dividends - franking credit", 12: "ESS discount - deferral schemes", "13U": "Trust income, non primary production", "13C": "Trust franked distributions", "13Q": "Trust franking credit", 18: "Net capital gain", "18A": "Net capital gain", "20M": "Other net foreign source income", 21: "Net rent - your share", 24: "Other income", D1: "Work-related car expenses", D2: "Work-related travel expenses", D3: "Work-related clothing, laundry", D4: "Work-related self-education", D5: "Other work-related expenses", D7: "Interest deductions", D8: "Dividend deductions", D9: "Gifts or donations", D10: "Cost of managing tax affairs", D12: "Personal super contributions", D15: "Other deductions" };
  const ATO = { 12: "12F", "18A": "18A" };
  const INCOME_ORDER = ["1", "2", "10", "11S", "11T", "11U", "12", "13U", "13C", "13Q", "18A", "20M", "24"];
  const BOUNDARY = ["Preparation complete is not lodged. The accountant prepares and lodges the return.", "Estimates are indicative. This is not tax advice.", "No tax file number is in this pack. Give it to your accountant by phone or through their portal, not by email."];

  /* Dated cautions about law the reference cannot yet state. A row here never changes a number: it stops the pack assuming one. The date comes from research
     marked unconfirmed, so it holds a figure back until a person rechecks it. Remove a row when the Standard's reference states the rule. */
  const LAW_WATCH = [{ id: "cgt-method-2027", series: "cgt_discount_individual", from: "2027-07-01", confirmed: false, note: "Research says the 50% discount gives way to cost-base indexation on gains accruing from 1 July 2027, plus a minimum tax on certain gains. Unconfirmed. The Standard's reference still runs the discount open-ended." }];

  function cgtMethod(reference, on) {
    const row = seriesRow(reference, "cgt_discount_individual", on), watch = LAW_WATCH.find((w) => w.series === "cgt_discount_individual" && on >= w.from) || null;
    return { rate: row && !watch ? row.value.rate : null, valid_from: row ? row.valid_from : null, confidence: row ? row.confidence : null, watch };
  }

  /* Every rate the pack leans on, read by date from the Standard's reference, with how far that row has been checked. Nothing in this folder types a rate. */
  function parametersFor(reference, on) {
    const params = [];
    const add = (id, nm, row, value) => { if (row) params.push({ id, name: nm, value, valid_from: row.valid_from, valid_to: row.valid_to ?? null, confidence: row.confidence || null, note: row.note ?? null, source: "standard/reference/au.json" }); else params.push({ id, name: nm, value: null, valid_from: null, valid_to: null, confidence: null, note: "Not in the Standard's reference for this date.", source: null }); };
    const row = (id) => seriesRow(reference, id, on);
    add("brackets", "Resident tax rates", row("resident_tax_brackets"), row("resident_tax_brackets") ? row("resident_tax_brackets").value : null);
    const levy = row("medicare_levy_rate");
    add("medicare", "Medicare levy", levy, levy ? levy.value.rate ?? levy.value : null);
    add("lito", "Low income tax offset", row("lito"), row("lito") ? row("lito").value : null);
    add("lmito", "Low and middle income tax offset", row("lmito"), row("lmito") ? row("lmito").value : null);
    add("help", "HELP repayment", row("help_repayment"), row("help_repayment") ? row("help_repayment").value : null);
    const cap = row("concessional_cap");
    add("concessional_cap", "Concessional cap", cap, cap ? cap.value.amount ?? cap.value : null);
    add("cgt_discount", "CGT method for disposals in this year", row("cgt_discount_individual"), cgtMethod(reference, on).rate);
    add("div293", "Division 293 threshold", null, null);
    add("phi_tiers", "Private health rebate and surcharge tiers", null, null);
    return params;
  }

  function build({ L, reference, person, fy, asOf, version = 1, supersedes = null }) {
    const R = L.resolver, D = fyDates(fy), X = L.index, book = new E.Book(L);
    const party = L.parties.find((p) => p.party_id === person);
    if (!party) throw new Error(`No party ${person}`);
    const events = [...X.events.values()].filter((e) => e.occurred_on >= D.start && e.occurred_on < D.stop);
    const items = new Map(L.tax.items.filter((i) => i.fy === fy && i.party_id === person).map((i) => [i.label, i]));
    const prior = new Map(L.tax.items.filter((i) => i.fy === `FY${D.y - 1}` && i.party_id === person).map((i) => [i.label, i]));
    const cents = (l) => (items.get(l) ? items.get(l).amount_cents : null);
    const est = L.tax.estimates.find((e) => e.person === person && e.fy === fy) || null;
    const lines = [], gaps = [], notes = [];
    const push = (o) => { const l = line(o); lines.push(l); return l; };
    const gap = (o) => gaps.push({ id: `G${gaps.length + 1}`, status: "Open", amount_cents: null, lines: [], ...o });
    const mine = (o) => { const ref = o.payload.person_ref; return !!ref && R.partyOf(ref, o.payload.period_end || D.end) === person; };
    const docs = (k) => R.collapseDocs(k).filter((o) => o.payload.fy === fy);
    const missingIn = (id) => { const c = L.coverage.find((x) => x.stream_id === id); return c ? c.missing.filter((m) => String(m) >= D.start.slice(0, 7) && String(m) < D.stop.slice(0, 7)) : []; };
    const stateOf = (cites, need = "strong") => {
      if (!cites.length) return "missing";
      if (need === "any") return "held";
      return cites.some((c) => c.strength === "strong") ? "held" : "at_risk";
    };
    const ownersOn = (type, id, on) => R.ownersOf(type, id, on, "tax").filter((o) => { const p = L.parties.find((q) => q.party_id === o.party_id); return !p || !["smsf", "trust", "company"].includes(p.kind); });
    const shareOn = (type, id, on) => { const rows = ownersOn(type, id, on); return (rows.find((o) => o.party_id === person) || { share_bps: 0 }).share_bps; };
    const prefill = docs("prefill").filter(mine);

    // ---------- employment ----------
    const f1 = book.folder("Employment");
    const statements = docs("income_statement").filter(mine).sort((a, b) => (a.payload.employer_ref < b.payload.employer_ref ? -1 : 1));
    const payslips = (R.byKind.get("payslip") || []).filter((o) => { const d = o.payload.pay_date; return mine(o) && d >= D.start && d < D.stop; });
    statements.forEach((o, i) => {
      const p = o.payload;
      push({ id: `income.employment.${i}`, section: "income.employment", label: "1", engine: "1", name: p.employer_ref, amount_cents: p.gross_cents, fields: { period: D.long, payg_cents: p.tax_cents, super_cents: p.super_cents, resc_cents: p.resc_cents ?? null, finalised: p.finalised }, evidence: [book.cite(o, f1)], evidence_state: p.finalised === false ? "at_risk" : "held", note: p.finalised === false ? "Not yet marked tax ready." : null });
    });
    const haveFrom = new Set(statements.map((o) => o.payload.employer_ref));
    const slipBy = new Map();
    for (const o of payslips) { const k = o.payload.employer_ref; if (!haveFrom.has(k)) { if (!slipBy.has(k)) slipBy.set(k, []); slipBy.get(k).push(o); } }
    let slipRow = 0;
    for (const [employer, rows] of [...slipBy].sort()) {
      const gross = sum(rows, (o) => o.payload.gross_cents), tax = sum(rows, (o) => o.payload.tax_cents);
      gap({ owner: "taxpayer", item: `Income statement, ${employer}`, why: statements.length ? `Payslips from ${employer} total ${P.money(gross)}, but with another employer's statement held the engine counts statements only, so this income is not in label 1.` : "Salary and tax withheld. Payslips are not the final word.", where: "myGov income statement, once it says Tax ready", amount_cents: gross, lines: [`income.employment.slips.${slipRow}`] });
      if (!statements.length) push({ id: `income.employment.slips.${slipRow}`, section: "income.employment", label: "1", engine: "1", name: `${employer} (payslips only)`, amount_cents: gross, fields: { period: `${rows.length} payslips`, payg_cents: tax }, evidence: rows.slice(0, 40).map((o) => book.cite(o, f1)), evidence_state: "at_risk", note: "Payslips only. The income statement is not held." });
      else push({ id: `income.employment.slips.${slipRow}`, section: "income.employment", label: "1", engine: null, name: `${employer} (payslips only, not counted)`, amount_cents: null, state: "not_found", fields: { period: `${rows.length} payslips`, payg_cents: null, payslip_gross_cents: gross }, evidence: rows.slice(0, 40).map((o) => book.cite(o, f1)), evidence_state: "at_risk", note: `Payslips show ${P.money(gross)}. The income statement is what is missing.` });
      slipRow += 1;
    }
    for (const st of L.streams.filter((s) => s.doc_kind === "income_statement" && s.subject_id === person)) {
      const gone = missingIn(st.stream_id);
      if (gone.length && !statements.some((o) => { const src = book.src.get(o.source_id); return src && src.stream_id === st.stream_id; }) && !slipBy.size) {
        const id = `income.employment.missing.${st.stream_id}`;
        push({ id, section: "income.employment", label: "1", name: st.name, state: "not_found", fields: { period: D.long, payg_cents: null }, evidence_state: "missing", note: "Expected for this year. Not held." });
        gap({ owner: "taxpayer", item: st.name, why: "Salary and tax withheld.", where: "myGov income statement, once it says Tax ready", lines: [id] });
      }
    }
    if (cents("2")) push({ id: "income.employment.allowances", section: "income.employment", label: "2", engine: "2", name: "Allowances shown at label 2", amount_cents: cents("2"), fields: { period: D.long }, evidence: statements.slice(0, 1).map((o) => book.cite(o, f1)), evidence_state: "held" });
    push({ id: "income.payg", section: "income.totals", engine: "PAYG", name: "PAYG withheld", amount_cents: cents("PAYG"), kind: "calculated", evidence: statements.map((o) => book.cite(o, f1)), evidence_state: statements.length ? "held" : "at_risk" });

    // ---------- memo ----------
    const resc = cents("RESC");
    const statementSaysResc = statements.length > 0 && statements.every((o) => o.payload.resc_cents !== undefined && o.payload.resc_cents !== null);
    const rescFromStatements = statementSaysResc ? sum(statements, (o) => o.payload.resc_cents) : null;
    const it2 = rescFromStatements ?? resc;
    const it2Evidence = statements.map((o) => book.cite(o, f1));
    push({ id: "memo.it1", section: "memo.items", label: "IT1", name: "Reportable fringe benefits", state: "not_found", evidence_state: "missing", note: "From the income statement. The Standard does not read this field yet, so the pack cannot say it is nil." });
    gap({ owner: "taxpayer", item: "Reportable fringe benefits (IT1)", why: "Reported, not taxed, and it feeds several income tests.", where: "Income statement, field Reportable fringe benefits. Zero if none shown.", lines: ["memo.it1"] });
    push(it2 === null ? { id: "memo.it2", section: "memo.items", label: "IT2", name: "Reportable employer super (salary sacrifice only, not compulsory SG)", state: "not_found", evidence_state: "missing" }
      : it2 === 0 ? { id: "memo.it2", section: "memo.items", label: "IT2", name: "Reportable employer super (salary sacrifice only, not compulsory SG)", amount_cents: 0, state: "nil", nil_basis: "Every income statement held shows none.", evidence: it2Evidence, evidence_state: "held" }
        : { id: "memo.it2", section: "memo.items", label: "IT2", name: "Reportable employer super (salary sacrifice only, not compulsory SG)", amount_cents: it2, engine: "RESC", evidence: it2Evidence, evidence_state: statements.length ? "held" : "at_risk" });
    const cap = L.tax.caps.find((c) => c.person === person && c.fy === fy && c.cap === "concessional");
    push(cap ? { id: "memo.concessional", section: "memo.items", label: null, name: "Concessional super contributions (SG plus salary sacrifice)", amount_cents: cap.used, kind: "calculated", fields: { cap_cents: cap.limit }, evidence: [], evidence_state: "held", note: `Used for the Division 293 test. Cap for the year ${P.money(cap.limit)}.` } : { id: "memo.concessional", section: "memo.items", name: "Concessional super contributions (SG plus salary sacrifice)", state: "not_found", evidence_state: "missing" });

    // ---------- interest ----------
    const f2 = book.folder("Interest");
    const interest = events.filter((e) => e.category_id === "INTEREST");
    const byAcct = new Map();
    for (const e of interest) {
      const acct = e.ownerAccount || (e.refs && e.refs.account) || (e.line && e.line.account);
      const owners = ownersOn("account", acct, e.occurred_on);
      const mineCents = owners.length ? allocate(e.amount_cents, owners.map((o) => ({ key: o.party_id, weight: o.share_bps }))).get(person) || 0 : e.person === person ? e.amount_cents : 0;
      if (!owners.some((o) => o.party_id === person) && e.person !== person) continue;
      const r = byAcct.get(acct) || { acct, full: 0, share: 0, cites: [], bps: new Set() };
      r.full += e.amount_cents; r.share += mineCents; r.bps.add((owners.find((o) => o.party_id === person) || { share_bps: 10000 }).share_bps);
      r.cites.push(...book.ofEvent(e.event_id, f2));
      byAcct.set(acct, r);
    }
    [...byAcct.values()].sort((a, b) => (a.acct < b.acct ? -1 : 1)).forEach((r, i) => {
      const a = X.accounts.get(r.acct);
      push({ id: `income.interest.${i}`, section: "income.interest", label: "10", engine: "10", name: a ? a.name : r.acct, amount_cents: r.share, state: r.share ? "value" : "nil", nil_basis: r.share ? null : "Your share of a few cents, split entry by entry, comes to nothing.", fields: { full_cents: r.full, share_bps: r.bps.size === 1 ? [...r.bps][0] : null }, evidence: r.cites, evidence_state: stateOf(r.cites, "any") });
    });

    // ---------- per-label income: dividends, funds, other. One row a label, every statement behind it ----------
    const f3 = book.folder("Dividends and funds"), f4 = book.folder("Shares and crypto");
    const divEv = events.filter((e) => (e.kind === "dividend" || e.kind === "drp") && e.tax && Object.values(e.tax).some(Boolean));
    const divCites = (e) => book.ofEvent(e.event_id, f3);
    for (const label of ["11S", "11T", "11U"]) if (items.get(label)) {
      const cites = divEv.filter((e) => { const owners = ownersOn("account", e.ownerAccount || e.holding, e.occurred_on); return !owners.length || owners.some((o) => o.party_id === person); }).flatMap(divCites);
      push({ id: `income.dividends.${label}`, section: "income.dividends", label, engine: label, name: NAMES[label], amount_cents: cents(label), evidence: cites, evidence_state: stateOf(cites, "any") });
    }
    const distDocs = docs("distribution");
    for (const label of ["13U", "13C", "13Q", "20M"]) if (items.get(label)) {
      const cites = distDocs.map((o) => book.cite(o, f3));
      push({ id: `income.trusts.${label}`, section: "income.trusts", label, engine: label, name: NAMES[label], amount_cents: cents(label), evidence: cites, evidence_state: stateOf(cites, "any") });
    }
    if (items.get("24")) {
      const cites = events.filter((e) => e.kind === "crypto_income" && e.person === person).flatMap((e) => book.ofEvent(e.event_id, f4));
      push({ id: "income.other.24", section: "income.other", label: "24", engine: "24", name: "Staking rewards and other income", amount_cents: cents("24"), evidence: cites, evidence_state: stateOf(cites, "any") });
    }

    // ---------- deductions ----------
    const f8 = "Deductions";
    const tmap = (L.resolver.ctx.setup.tax_map || []).filter((m) => m.selector_type === "category");
    const dLabels = [...new Set([...items.keys(), ...prior.keys()].filter((l) => /^D\d+$/.test(l)))].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
    const logs = (R.byKind.get("work_log") || []).filter((o) => o.payload.fy === fy && mine(o));
    for (const label of dLabels) {
      const rows = [], target = cents(label);
      const cats = tmap.filter((m) => m.label === label).map((m) => m.selector);
      for (const e of events) {
        if (!e.category_id || !cats.includes(e.category_id)) continue;
        const who = e.claimant || e.person;
        if (who !== person) continue;
        book.folder(f8);
        const cites = book.ofEvent(e.event_id, f8);
        rows.push({ name: `${e.merchant || e.description} (${P.longDate(e.occurred_on)})`, amount: Math.abs(e.amount_cents), cites, basis: "Paid from a household account" });
      }
      for (const o of logs) {
        const p = o.payload;
        if (p.log_kind === "expense" && p.label === label) { book.folder(f8); rows.push({ name: `${NAMES[label] || label}, worksheet row`, amount: p.amount_cents, cites: [book.cite(o, f8)], basis: "The household's own worksheet" }); }
      }
      if (label === "D5") {
        const hours = logs.filter((o) => o.payload.log_kind === "wfh" && o.payload.hours != null);
        if (hours.length) {
          const total = sum(hours, (o) => Number(o.payload.hours)), rateRow = seriesRow(reference, "wfh_fixed_rate", D.end), rate = rateRow ? Number(rateRow.value.rate) : null;
          const amount = sum(hours, (o) => Math.round(Number(o.payload.hours) * rate * 100));
          book.folder(f8);
          rows.push({ name: "Working from home - fixed rate", amount, cites: hours.map((o) => book.cite(o, f8)), basis: `${total} hours x $${rate}`, log: true, hours: total, rate });
        }
      }
      const got = sum(rows, (r) => r.amount);
      rows.forEach((r, i) => {
        const st = r.log ? "held" : stateOf(r.cites), id = `income.work.${label}.${i}`;
        push({ id, section: "income.work", label, engine: label, name: r.name, amount_cents: r.amount, fields: { basis: r.basis, hours: r.hours ?? null, rate: r.rate ?? null }, evidence: r.cites, evidence_state: st, note: st === "at_risk" ? "A bank line or the household's own worksheet, with no receipt or invoice held." : null });
        if (st === "at_risk") gap({ owner: "taxpayer", item: `Receipt or invoice: ${r.name}`, why: "A deduction resting only on a bank line or a worksheet can be disallowed. Keep the document for five years from lodging.", where: "The supplier's receipt, invoice or email", amount_cents: r.amount, lines: [id] });
      });
      if (target === null && !rows.length) {
        const id = `income.work.${label}.missing`, sheet = logs.filter((o) => o.payload.log_kind === "expense");
        if (sheet.length) push({ id, section: "income.work", label, engine: label, name: NAMES[label] || label, amount_cents: 0, state: "nil", nil_basis: "This year's deductions worksheet is held and lists none.", fields: { basis: "Claimed last year, none this year" }, evidence: [book.cite(sheet[0], f8)], evidence_state: "held" });
        else {
          push({ id, section: "income.work", label, engine: label, name: NAMES[label] || label, state: "not_found", fields: {}, evidence_state: "missing", note: `Claimed last year (${P.money(prior.get(label).amount_cents)}). Nothing held this year.` });
          gap({ owner: "taxpayer", item: NAMES[label] || label, why: "Claimed last year and nothing is held this year. Either it did not recur or the worksheet has not arrived.", where: "This year's deductions worksheet, or say there were none", lines: [id] });
        }
      } else if (target !== null && got !== target) {
        const id = `income.work.${label}.rest`;
        push({ id, section: "income.work", label, engine: label, name: "Not itemised here", amount_cents: target - got, fields: { basis: "The engine holds this and the pack could not trace it" }, evidence_state: "at_risk", note: "In the engine's figure, not traced to a row." });
        gap({ owner: "accountant", item: `${label}: part not traced to a row`, why: "The engine's figure is higher than the rows the pack can trace.", where: "This is a pack limit", amount_cents: target - got, lines: [id] });
      }
    }

    // ---------- private health and spouse ----------
    const f9 = book.folder("Health cover");
    const health = docs("health_statement").filter(mine);
    if (health.length) health.forEach((o, i) => {
      const p = o.payload, cite = book.cite(o, f9);
      push({ id: `income.health.${i}`, section: "income.health", label: "M1", name: `${p.insurer_ref}, year to ${P.longDate(p.period_end)}`, amount_cents: p.premium_cents, fields: { benefit_code: p.benefit_code, rebate_cents: p.rebate_cents, days: p.days_covered }, evidence: [cite], evidence_state: "held" });
    });
    else if (prior.has("PHI-REBATE") || L.streams.some((s) => s.doc_kind === "health_statement" && s.subject_id === person)) {
      push({ id: "income.health.missing", section: "income.health", label: "M1", name: "Private health statement", state: "not_found", fields: { benefit_code: null, rebate_cents: null, days: null }, evidence_state: "missing", note: "Expected. Not held." });
      gap({ owner: "taxpayer", item: "Private health statement", why: "Rebate reconciliation and the surcharge test.", where: "Health fund or the tax office's pre-fill", lines: ["income.health.missing"] });
    }
    const adults = (L.memberships || []).filter((m) => m.role === "adult" && m.valid_from <= D.end && (!m.valid_to || m.valid_to > D.start)).map((m) => m.party_id).filter((id) => id !== person);
    const spouse = adults[0] ? L.tax.estimates.find((e) => e.person === adults[0] && e.fy === fy) : null;
    if (adults[0]) push(spouse ? { id: "income.spouse", section: "income.spouse", label: "Spouse", name: `Spouse taxable income, ${(L.parties.find((p) => p.party_id === adults[0]) || {}).name}`, amount_cents: spouse.taxable_income_cents, state: spouse.taxable_income_cents ? "value" : "nil", nil_basis: spouse.taxable_income_cents ? null : "The draft for the spouse's own return comes to nothing.", kind: "calculated", indicative: true, evidence_state: "not_needed", note: "From the draft for the spouse's own return." } : { id: "income.spouse", section: "income.spouse", label: "Spouse", name: "Spouse taxable income", state: "not_found", evidence_state: "missing" });

    // ---------- shares: ESS and capital gains are two items, never one ----------
    const vests = events.filter((e) => e.kind === "vest" && e.person === person).sort((a, b) => (a.occurred_on < b.occurred_on ? -1 : 1));
    vests.forEach((e, i) => {
      const cites = book.ofEvent(e.event_id, f4);
      push({ id: `shares.ess.${i}`, section: "shares.ess", label: "12F", engine: "12", name: `${(X.contracts && X.contracts.get && X.contracts.get("C-ESS") || {}).name || "Employee plan"}, vest ${P.longDate(e.occurred_on)}`, amount_cents: e.amount_cents, fields: { units: e.units, taxing_point: e.occurred_on }, evidence: cites, evidence_state: stateOf(cites, "any") });
    });
    const essDocs = docs("ess_statement").filter(mine);
    if (items.get("12")) {
      const got = sum(vests, (e) => e.amount_cents), cites = essDocs.map((o) => book.cite(o, f4));
      if (got !== cents("12")) push({ id: "shares.ess.statement", section: "shares.ess", label: "12F", engine: "12", name: "Difference to the plan's annual statement", amount_cents: cents("12") - got, fields: {}, evidence: cites, evidence_state: stateOf(cites, "any"), note: "The plan's statement outranks a sum of vests." });
      else if (cites.length) lines[lines.length - 1].evidence.push(...cites);
    }
    const lotsAll = [...(R.lots ? R.lots.lots : []), ...(R.propertyLots ? R.propertyLots.lots : []), ...(R.cryptoLots ? R.cryptoLots.lots : [])];
    const lotOf = new Map(lotsAll.map((l) => [l.lot_id, l]));
    const byKeyEnd = new Map();
    for (const e of X.events.values()) { const i = e.key ? e.key.indexOf("|") : -1; if (i > 0) byKeyEnd.set(e.key.slice(i + 1), e); }
    const matches = (L.lotMatches || []).filter((m) => m.fy === fy);
    const parcels = [];
    for (const m of matches) {
      if (m.party_id && m.party_id !== person) continue;
      const lot = lotOf.get(m.lot_id);
      const subject = !m.party_id && lot ? ["account", lot.account_id] : null;
      const owners = subject ? ownersOn(subject[0], subject[1], m.disposed_on) : [];
      if (!m.party_id && !owners.some((o) => o.party_id === person)) continue;
      const bps = m.party_id ? 10000 : owners.find((o) => o.party_id === person).share_bps;
      const shareGain = m.gain_cents === null || m.gain_cents === undefined ? null : m.party_id ? m.gain_cents : allocate(m.gain_cents, owners.map((o) => ({ key: o.party_id, weight: o.share_bps }))).get(person);
      parcels.push({ m, lot, bps, shareGain });
    }
    parcels.sort((a, b) => (a.m.disposed_on < b.m.disposed_on ? -1 : a.m.disposed_on > b.m.disposed_on ? 1 : (a.m.lot_id < b.m.lot_id ? -1 : 1)));
    const method = cgtMethod(reference, D.end);
    const watchHit = LAW_WATCH.find((w) => w.series === "cgt_discount_individual" && parcels.some((x) => x.m.disposed_on >= w.from));
    parcels.forEach((x, i) => {
      const { m, lot } = x, sold = byKeyEnd.get(m.event_ref), bought = lot && lot.ref ? byKeyEnd.get(lot.ref) : null;
      const cites = [...(sold ? book.ofEvent(sold.event_id, f4) : []), ...(bought ? book.ofEvent(bought.event_id, f4).map((c) => ({ ...c, role: "cost base" })) : [])];
      const foreign = sold && (book.wit.get(sold.event_id) || []).map((w) => book.obs.get(w.obs_id)).find((o) => o && o.currency && o.currency !== "AUD");
      const known = x.shareGain !== null;
      const id = `shares.parcel.${i}`;
      const zero = known && x.shareGain === 0;
      push({ id, section: "shares.parcels", label: "18", rolls: "18A", name: `${m.instrument_id}, lot ${String(m.lot_id).replace(/^lot_/, "")}`, amount_cents: known ? x.shareGain : null, state: !known ? "not_found" : zero ? "nil" : "value", nil_basis: zero ? "Cost base equals proceeds: sold the day it vested, so the gain was taxed as the ESS discount." : null, kind: "calculated",
        fields: { rolls: "18A", units: m.units, acquired_on: lot ? lot.acquired_on : null, sold_on: m.disposed_on, cost_cents: m.cost_base_cents ?? null, proceeds_cents: m.proceeds_cents ?? null, gain_cents: m.gain_cents ?? null, share_bps: x.bps, discount_eligible: !!m.discount_eligible, foreign: foreign ? `${foreign.currency} ${(foreign.amount_cents / 100).toFixed(2)} at an implied ${(m.proceeds_cents / foreign.amount_cents).toFixed(4)}` : null }, evidence: cites, evidence_state: !known ? "missing" : cites.some((c) => c.role === "cost base") || (lot && lot.ess) ? "held" : stateOf(cites, "any") === "held" ? "at_risk" : "missing", note: !known ? "Sold with no purchase held, so the cost base is unknown. Not treated as nil." : !bought && !(lot && lot.ess) ? "The sale is held. The purchase behind this parcel's cost base is not." : null });
      if (!known) gap({ owner: "taxpayer", item: `Purchase record for ${m.instrument_id} sold ${P.longDate(m.disposed_on)}`, why: "Every sale must be declared, and a gain cannot be worked out without its cost base.", where: "Broker contract note or settlement statement", lines: [id] });
    });
    if (parcels.some((x) => x.shareGain === null) && items.get("18A")) notes.push("Net capital gain leaves out at least one sale with an unknown cost base.");
    const trustGain = cents("18H-DIST");
    if (trustGain) push({ id: "shares.fundgains", section: "shares.split", label: "18H", engine: "18H-DIST", name: "Capital gains from managed funds, grossed up", amount_cents: trustGain, evidence: distDocs.map((o) => book.cite(o, f3)), evidence_state: "held", fields: { rolls: "18A", eligible: true } });
    const eligible = sum(parcels.filter((x) => x.shareGain > 0 && x.m.discount_eligible), (x) => x.shareGain) + (trustGain || 0);
    const ineligible = sum(parcels.filter((x) => x.shareGain > 0 && !x.m.discount_eligible), (x) => x.shareGain);
    const lossNow = -sum(parcels.filter((x) => x.shareGain < 0), (x) => x.shareGain);
    const carryIn = prior.get("18V") ? prior.get("18V").amount_cents : 0;
    push({ id: "shares.split.eligible", section: "shares.split", name: "Gains held at least 12 months", amount_cents: eligible, state: eligible ? "value" : "nil", nil_basis: eligible ? null : "No such gain in the sales held.", kind: "calculated", evidence_state: "not_needed" });
    push({ id: "shares.split.ineligible", section: "shares.split", name: "Gains held under 12 months", amount_cents: ineligible, state: ineligible ? "value" : "nil", nil_basis: ineligible ? null : "No such gain in the sales held.", kind: "calculated", evidence_state: "not_needed" });
    push({ id: "shares.split.losses", section: "shares.split", name: "Capital losses this year", amount_cents: lossNow, state: lossNow ? "value" : "nil", nil_basis: lossNow ? null : "No loss in the sales held.", kind: "calculated", evidence_state: "not_needed" });
    push({ id: "shares.split.carry", section: "shares.split", name: "Capital losses carried in from last year", amount_cents: carryIn, state: carryIn ? "value" : "nil", nil_basis: carryIn ? null : "Label 18V was empty last year.", kind: "entered", evidence_state: "not_needed" });

    // ---------- loans: every loan the person owes on, deductible or not, so the total can be checked ----------
    const f7 = "Loans";
    const loanContracts = L.contracts.filter((c) => c.kind === "loan" && c.account_id && ownersOn("account", c.account_id, D.end).some((o) => o.party_id === person));
    const loanRows = [];
    loanContracts.forEach((c, i) => {
      const a = X.accounts.get(c.account_id);
      if (a && a.opened_on && a.opened_on > D.end) return;
      book.folder(f7);
      const st = (R.byKind.get("loan_statement") || []).filter((o) => { const q = o.payload; return (R.alias("contract", q.account_ref, q.period_end) === c.contract_id || R.alias("account", q.account_ref, q.period_end) === c.account_id) && q.period_end >= D.start && q.period_start < D.stop; });
      const lenderRow = L.parties.find((p) => p.party_id === (a && a.institution_party_id));
      const ev = events.filter((e) => e.kind === "loan_interest" && e.contract_id === c.contract_id);
      const charged = st.length ? sum(st, (o) => o.payload.interest_cents || 0) : ev.length ? sum(ev, (e) => e.amount_cents) : null;
      const deductible = sum(ev.filter((e) => e.category_id === "RENT-INT"), (e) => e.amount_cents);
      const privateUse = sum(ev.filter((e) => e.category_id !== "RENT-INT"), (e) => e.amount_cents);
      const secures = (L.links || []).filter((k) => k.relation === "secures" && k.from_id === c.contract_id).map((k) => (L.assets.find((x) => x.asset_id === k.to_id) || {}).name).filter(Boolean).join(", ");
      const purpose = (L.links || []).filter((k) => k.relation === "funds_purpose" && k.from_id === c.contract_id && (!k.valid_to || k.valid_to > D.start));
      const used = purpose.map((k) => { const as = L.assets.find((x) => x.asset_id === k.to_id); const use = R.term("asset", k.to_id, "use", D.end); return `${(k.share_bps || 10000) / 100}% ${as ? as.name : k.to_id}${use ? ` (${use})` : ""}`; }).join("; ") || "Not recorded";
      const cites = st.map((o) => book.cite(o, f7));
      const id = `loans.row.${i}`;
      const kept = charged === null ? null : charged;
      push({ id, section: "loans.rows", name: c.name, amount_cents: kept, state: kept === null ? "not_found" : "value", fields: { lender: lenderRow ? lenderRow.name : "", secured_on: secures, used_for: used, deductible_cents: deductible, private_cents: privateUse, undrawn_cents: 0, asset_ids: purpose.map((k) => k.to_id), contract_id: c.contract_id, verdict: deductible && privateUse ? "PART" : deductible ? "YES" : "NO", share_bps: shareOn("account", c.account_id, D.end) }, evidence: cites, evidence_state: st.length ? "held" : ev.length ? "at_risk" : "missing", note: !st.length ? "No lender statement held for this loan in the year." : null });
      if (!st.length) gap({ owner: "taxpayer", item: `Lender's interest statement, ${c.name}`, why: "The interest reconciliation needs the lender's own figure for every loan, closed accounts included.", where: `${lenderRow ? lenderRow.name : "The lender"}: annual interest statement, or closing statement if the account closed`, lines: [id] });
      loanRows.push({ c, id, deductible, ev });
    });

    // ---------- property: full-property figures, the owner's share applied once, at the bottom ----------
    const activities = (L.activities || []).filter((a) => a.kind === "rental" && ((a.valid_from || "") <= D.end) && ownersOn("asset", a.asset_id, D.end).some((o) => o.party_id === person));
    const props = [];
    const allFor = (k) => L.tax.items.filter((i) => i.fy === fy).reduce((s, i) => (i.label === k.label ? s + (i.by_activity[k.key] || 0) : s), 0);
    const CAT = { "RENT-MGMT": "Management and admin fees", "RENT-RATES": "Council and water rates", "RENT-STRATA": "Strata levies", "RENT-INS": "Landlord insurance", "RENT-REPAIR": "Repairs and maintenance", "RENT-OTHER": "Other rental costs" };
    activities.forEach((act) => {
      const asset = L.assets.find((x) => x.asset_id === act.asset_id), folder = book.folder(asset.name), sec = `property.${act.asset_id}`;
      const inProp = events.filter((e) => e.activity_id === act.activity_id);
      const groups = new Map();
      const stray = [];
      for (const e of inProp) for (const p of L.postings.filter((q) => q.event_id === e.event_id && q.category_id)) {
        if (p.category_id === "RENT-INT" || p.category_id === "CAPITAL") continue;
        if (p.category_id !== "RENT-INC" && !CAT[p.category_id]) { stray.push({ e, p }); continue; }
        const channel = e.kind === "rent_statement" ? "agent" : "direct", k = `${p.category_id}|${channel}`;
        const g = groups.get(k) || { cat: p.category_id, channel, cents: 0, cites: [], n: 0 };
        g.cents += p.category_id === "RENT-INC" ? -p.amount_cents : p.amount_cents; g.n += 1;
        for (const c of book.ofEvent(e.event_id, folder)) if (!g.cites.some((x) => x.ref === c.ref && x.locator === c.locator)) g.cites.push(c);
        groups.set(k, g);
      }
      const addRow = (id, section, name, g, extra = {}) => { const st = g ? stateOf(g.cites, section.endsWith(".income") || section.endsWith(".agent") ? "any" : "strong") : "missing"; const l = push({ id, section, label: extra.label ?? null, name, amount_cents: g ? g.cents : null, state: g ? "value" : "not_found", fields: { rolls: section.endsWith(".income") ? "21P" : "21X", period: extra.period ?? `${D.label}`, ...(extra.fields || {}) }, evidence: g ? g.cites : [], evidence_state: extra.evidence_state || st, note: extra.note ?? null }); if (st === "at_risk" && !extra.evidence_state) gap({ owner: "taxpayer", item: `${name}, ${asset.name}: invoice or notice`, why: "Paid directly and only a bank line is held. Rental deductions need the document.", where: "The supplier, or the property file", amount_cents: g.cents, lines: [id] }); return l; };
      const rentAgent = groups.get("RENT-INC|agent"), rentDirect = groups.get("RENT-INC|direct");
      const stmts = (R.byKind.get("owner_statement") || []).filter((o) => { const a = R.alias("asset", o.payload.property_ref, o.payload.period_end); return (a === act.asset_id || o.payload.property_ref === act.asset_id) && o.payload.period_end >= D.start && o.payload.period_end < D.stop; });
      const ownerStreams = L.streams.filter((s) => s.doc_kind === "owner_statement" && s.subject_id === act.asset_id);
      const holes = ownerStreams.flatMap((s) => missingIn(s.stream_id));
      addRow(`${sec}.rent.agent`, `${sec}.income`, "Rent received via managing agent", rentAgent, { period: `${stmts.length} owner statements`, evidence_state: holes.length ? "at_risk" : undefined, note: holes.length ? `Missing owner statements: ${holes.join(", ")}.` : null });
      if (holes.length) gap({ owner: "taxpayer", item: `Owner statements, ${asset.name}: ${holes.join(", ")}`, why: "Rent and agent-paid expenses come from these. The total is short without them.", where: "The managing agent", lines: [`${sec}.rent.agent`] });
      const rentAccounts = (L.links || []).filter((k) => k.relation === "serves" && k.to_id === act.asset_id).map((k) => k.from_id);
      const accountHoles = rentAccounts.flatMap((id) => missingIn(id));
      if (rentDirect) addRow(`${sec}.rent.direct`, `${sec}.income`, "Rent received directly", rentDirect);
      else push({ id: `${sec}.rent.direct`, section: `${sec}.income`, name: "Rent received directly", amount_cents: accountHoles.length || !rentAccounts.length ? null : 0, state: accountHoles.length || !rentAccounts.length ? "not_found" : "nil", nil_basis: accountHoles.length || !rentAccounts.length ? null : "The property's bank statements are held for the year and show no rent outside the agent.", fields: { period: D.label }, evidence_state: accountHoles.length || !rentAccounts.length ? "missing" : "held" });
      for (const cat of Object.keys(CAT)) { const g = groups.get(`${cat}|agent`); if (g) addRow(`${sec}.agent.${cat}`, `${sec}.agent`, CAT[cat], g, { period: `${g.n} statement lines` }); }
      const agentTotal = sum([...groups.values()].filter((g) => g.channel === "agent" && g.cat !== "RENT-INC"), (g) => g.cents);
      const statedOut = sum(stmts, (o) => { const p = o.payload; return p.gross_rent_cents - p.disbursed_cents; });
      push({ id: `${sec}.agent.stated`, section: `${sec}.check`, name: "Money out, as the agent's statements add it", amount_cents: stmts.length ? statedOut : null, state: statedOut ? "value" : stmts.length ? "nil" : "not_found", nil_basis: statedOut ? null : stmts.length ? "The agent's statements show nothing paid out." : null, evidence: stmts.map((o) => book.cite(o, folder)), evidence_state: stmts.length ? "held" : "missing", fields: { agent_total_cents: agentTotal } });
      for (const cat of Object.keys(CAT)) { const g = groups.get(`${cat}|direct`); if (g) addRow(`${sec}.direct.${cat}`, `${sec}.direct`, CAT[cat], g, { period: `${g.n} payments` }); }
      const myLoans = loanRows.filter((r) => { const row = lines.find((l) => l.id === r.id); return row.fields.asset_ids.includes(act.asset_id) && r.deductible; });
      myLoans.forEach((r, i) => push({ id: `${sec}.direct.interest.${i}`, section: `${sec}.direct`, label: "21Q", name: `Loan interest - deductible, ${r.c.name}`, amount_cents: r.deductible, kind: "calculated", fields: { rolls: "21Q", period: D.label, from_loan: r.id }, evidence: lines.find((l) => l.id === r.id).evidence, evidence_state: lines.find((l) => l.id === r.id).evidence_state }));
      const sched = (R.byKind.get("depreciation_schedule") || []).filter((o) => { const p = o.payload; return (R.assets && R.assets.has(p.asset_ref) ? p.asset_ref : R.alias("asset", p.asset_ref, p.issued_on)) === act.asset_id; });
      const sItems = sched.flatMap((o) => (o.payload.items || []).filter((it) => it.by_fy && it.by_fy[fy]).map((it) => ({ o, it })));
      sItems.forEach((s, i) => push({ id: `${sec}.direct.sched.${i}`, section: `${sec}.direct`, label: s.it.division === "43" ? "21F" : "21X", name: `${s.it.division === "43" ? "Capital works (Div 43)" : "Decline in value (Div 40)"}: ${s.it.name}`, amount_cents: s.it.by_fy[fy], fields: { rolls: s.it.division === "43" ? "21F" : "21X", period: D.label, sched: s.it.division === "43" ? "F" : "X" }, evidence: [book.cite(s.o, folder)], evidence_state: "held" }));
      if (!sItems.length) {
        const id = `${sec}.direct.sched.missing`;
        push({ id, section: `${sec}.direct`, label: "21F", name: "Depreciation - Div 40 and Div 43", state: "not_found", fields: { rolls: "21F", period: D.label }, evidence_state: "missing", note: "No schedule held. Not treated as nil." });
        gap({ owner: "taxpayer", item: `Quantity surveyor's depreciation schedule, ${asset.name}`, why: "Capital works and decline in value are claimed from it.", where: "Quantity surveyor, or the prior accountant", lines: [id] });
      }
      // The Kitty ties this payment to the property, on a category that is not a rental cost. It is not claimed; somebody should look.
      stray.forEach(({ e, p }, i) => {
        const id = `${sec}.unclaimed.${i}`, cat = (L.categories.find((c) => c.category_id === p.category_id) || {}).name || p.category_id, amount = Math.abs(p.amount_cents);
        push({ id, section: `${sec}.unclaimed`, name: `${e.merchant || e.description} (${P.longDate(e.occurred_on)})`, amount_cents: amount, fields: { period: `Category: ${cat}` }, evidence: book.ofEvent(e.event_id, folder), evidence_state: "at_risk", note: "Linked to this property, on a category that is not a rental cost. Not claimed." });
        gap({ owner: "taxpayer", item: `${e.merchant || e.description}, ${asset.name}: rental cost, or not?`, why: `This payment is linked to ${asset.name}, but its category is ${cat}, so it is not claimed. If it was for the property, recategorise it in the Kitty.`, where: "The bill or card statement in the evidence folder", amount_cents: amount, lines: [id] });
      });
      const settle = (R.byKind.get("settlement") || []).filter((o) => o.payload.asset_ref === act.asset_id && o.payload.settled_on >= D.start && o.payload.settled_on < D.stop);
      settle.forEach((o, si) => {
        const p = o.payload, cite = [book.cite(o, folder)];
        const rows = [["Purchase price", p.price_cents, "Cost base, not deductible."], ["Stamp duty", p.duty_cents, "Cost base, not deductible."], ["Legal and conveyancing", p.legal_cents, "Cost base, not deductible."]];
        rows.forEach(([nm, c, why], k) => { if (c) push({ id: `${sec}.capital.${si}.${k}`, section: `${sec}.capital`, name: nm, amount_cents: c, fields: { period: P.longDate(p.settled_on), why }, evidence: cite, evidence_state: "held" }); });
        if (p.adjustments_cents) gap({ owner: "accountant", item: `Settlement adjustments, ${asset.name}`, why: "Adjustments for rates and similar at settlement: deductible, or part of the cost base?", where: "Settlement statement", amount_cents: p.adjustments_cents, lines: [] });
      });
      const legs = { P: { key: act.activity_id, label: "21P" }, Q: { key: act.activity_id, label: "21Q" }, X: { key: act.activity_id, label: "21X" }, XA: { key: act.asset_id, label: "21X" }, F: { key: act.asset_id, label: "21F" } };
      const leg = (k) => (items.get(legs[k].label) ? items.get(legs[k].label).by_activity[legs[k].key] || 0 : 0);
      const share = (name, full, mineC, label, id) => push({ id: `${sec}.result.${id}`, section: `${sec}.result`, label, engine: label, name, amount_cents: mineC, state: mineC ? "value" : "nil", nil_basis: mineC ? null : "Nothing at this leg for this property.", kind: "calculated", fields: { full_cents: full }, evidence_state: "not_needed" });
      const full = (k) => allFor(legs[k]);
      share("Rent and other rental income", full("P"), leg("P"), "21P", "P");
      share("Interest deductions", full("Q"), leg("Q"), "21Q", "Q");
      share("Capital works deductions", full("F"), leg("F"), "21F", "F");
      share("Other rental deductions", full("X") + full("XA"), leg("X") + leg("XA"), "21X", "X");
      const bps = shareOn("asset", act.asset_id, D.end);
      const lease = (L.contracts || []).find((c) => c.kind === "lease" && c.asset_id === act.asset_id);
      const acquired = asset.acquired_on;
      props.push({ id: act.asset_id, activity: act.activity_id, name: asset.name, section: sec, share_bps: bps, location: asset.location || "", acquired_on: acquired, lease_from: lease ? lease.started_on : null });
      if (acquired >= D.start && lease && lease.started_on > acquired) gap({ owner: "accountant", item: `First rent came after purchase, ${asset.name}`, why: `Bought ${P.longDate(acquired)}, lease from ${P.longDate(lease.started_on)}. Interest and holding costs in between are claimed only if it was genuinely available for rent. Was it?`, where: "Agent's listing date, or your notes", lines: [] });
      const repairs = inProp.filter((e) => acquired && (e.occurred_on < `${Number(acquired.slice(0, 4)) + 1}${acquired.slice(4)}`) && L.postings.some((p) => p.event_id === e.event_id && p.category_id === "RENT-REPAIR"));
      const early = sum(repairs, (e) => sum(L.postings.filter((p) => p.event_id === e.event_id && p.category_id === "RENT-REPAIR"), (p) => p.amount_cents));
      if (early) gap({ owner: "accountant", item: `Repair shortly after purchase, ${asset.name}`, why: "Initial repairs are usually capital, not deductible. Which applies here?", where: "Agent's statement", amount_cents: early, lines: [] });
      const direct = groups.get("RENT-REPAIR|direct");
      if (direct) gap({ owner: "accountant", item: `Repair or replacement, ${asset.name}`, why: "Replacing a whole asset is depreciated; fixing one is deductible.", where: "The invoice", amount_cents: direct.cents, lines: [] });
    });

    // ---------- the labels on the front page ----------
    const groupLines = (tag) => lines.filter((l) => (l.engine === tag || l.fields.rolls === tag) && !l.section.endsWith(".summary"));
    const evidenceFor = (tag) => { const rows = groupLines(tag); return { state: rows.length ? P.worst(rows.map((l) => l.evidence_state)) : "missing", cites: rows.flatMap((l) => l.evidence) }; };
    const prefillFor = (label) => { const got = prefill.flatMap((o) => o.payload.items || []).filter((i) => i.label === label); return got.length ? Math.round(sum(got, (i) => i.amount) * 100) : null; };
    const summary = (o) => push({ kind: "calculated", section: o.section, fields: { tab: o.tab, prefill_cents: prefillFor(o.engine), ...(o.fields || {}) }, ...o });
    const summaryFor = (label, section, tab) => {
      const c = cents(label), ev = evidenceFor(label);
      if (c !== null) return summary({ id: `summary.${label}`, section, label: ATO[label] || label, engine: label, name: NAMES[label] || label, amount_cents: c, tab, evidence: ev.cites, evidence_state: ev.state });
      if (!prior.has(label)) return null;
      const id = `summary.${label}`, detail = lines.find((l) => l.id === `income.work.${label}.missing`);
      if (detail && detail.state === "nil") return summary({ id, section, label: ATO[label] || label, engine: label, name: NAMES[label] || label, amount_cents: 0, state: "nil", nil_basis: detail.nil_basis, tab, evidence: detail.evidence, evidence_state: "held" });
      summary({ id, section, label: ATO[label] || label, engine: label, name: NAMES[label] || label, state: "not_found", tab, evidence_state: "missing", note: `Claimed or declared last year (${P.money(prior.get(label).amount_cents)}). Nothing held this year.` });
      if (!gaps.some((g) => (g.lines || []).some((x) => x.includes(`.${label}.`)))) gap({ owner: "taxpayer", item: NAMES[label] || label, why: "On last year's return and nothing held this year.", where: "The usual statement for this label, or confirm it no longer applies", lines: [id] });
      return null;
    };
    const tabFor = (l) => (["12", "18A"].includes(l) ? "Shares" : "Income");
    /* The records show money and the engine put it on no label. The pack keeps to the engine's total, says the words "not found", and raises it. Quietly adding it would
       break the tie; quietly dropping it would understate the return. Today this is what an empty tax_map does to any household. */
    const unmapped = (label, name, amount, tab) => {
      const id = `summary.${label}`;
      summary({ id, section: label.startsWith("21") ? "rent.summary" : "income.summary", label, engine: label, name, state: "not_found", tab, evidence_state: "missing", note: `The records show ${P.money(amount)} and no tax label holds it.` });
      gap({ owner: "taxpayer", item: `${name}: in the records, on no label`, why: `The records show ${P.money(amount)}, but the household's tax map sends nothing to label ${label}, so the draft leaves it out. Left out, the return is understated.`, where: "Add the mapping in the Kitty, or tell your accountant", amount_cents: amount || null, lines: [id] });
    };
    for (const label of INCOME_ORDER) {
      if (label === "10" && cents("10") === null && interest.length) { unmapped("10", NAMES["10"], sum([...byAcct.values()], (r) => r.share), "Income"); continue; }
      if (label === "10" && cents("10") === null && !prior.has("10")) {
        const banks = L.streams.filter((s) => s.cadence === "monthly" && X.accounts.get(s.subject_id) && ["transaction", "savings", "offset"].includes(X.accounts.get(s.subject_id).type) && ownersOn("account", s.subject_id, D.end).some((o) => o.party_id === person));
        const holes = banks.flatMap((s) => missingIn(s.stream_id));
        summary({ id: "summary.10", section: "income.summary", label: "10", engine: "10", name: NAMES["10"], amount_cents: !banks.length || holes.length ? null : 0, state: !banks.length || holes.length ? "not_found" : "nil", nil_basis: !banks.length || holes.length ? null : `Statements held for ${banks.length} accounts, all year. None pays interest.`, tab: "Income", evidence_state: !banks.length || holes.length ? "missing" : "held" });
        continue;
      }
      if (label === "18A" && method.rate === null && (cents("18A") !== null || parcels.length)) {
        summary({ id: "summary.18A", section: "income.summary", label: "18A", name: NAMES["18A"], state: "not_found", tab: "Shares", evidence_state: "missing", note: `Held back: the method for this year is not settled. The engine's figure was ${P.money(cents("18A"))}, on the old rule.` });
        continue;
      }
      summaryFor(label, "income.summary", tabFor(label));
    }
    const rentLabels = ["21P", "21Q", "21F", "21X"];
    if (props.length || rentLabels.some((l) => prior.has(l))) for (const l of rentLabels) {
      const rows = lines.filter((x) => x.engine === l && x.section.endsWith(".result")), c = cents(l), ev = evidenceFor(l);
      const recorded = sum(lines.filter((x) => x.section.startsWith("property.") && x.fields.rolls === l && x.amount_cents && !x.fields.from_loan), (x) => x.amount_cents) + (l === "21Q" ? sum(loanRows, (r) => r.deductible) : 0);
      if (c === null && recorded) { unmapped(l, { "21P": "Gross rent", "21Q": "Interest deductions", "21F": "Capital works deductions", "21X": "Other rental deductions" }[l], recorded, "Property"); for (const x of rows) { x.state = "not_found"; x.amount_cents = null; x.nil_basis = null; } continue; }
      const anyMissing = lines.some((x) => x.section.startsWith("property.") && x.state === "not_found" && x.fields.rolls === l);
      summary({ id: `summary.${l}`, section: "rent.summary", label: l, engine: l, name: { "21P": "Gross rent", "21Q": "Interest deductions", "21F": "Capital works deductions", "21X": "Other rental deductions" }[l], amount_cents: c ?? (anyMissing || !props.length ? null : 0), state: c !== null ? "value" : anyMissing || !props.length ? "not_found" : "nil", nil_basis: c !== null || anyMissing || !props.length ? null : "No such amount in the property's records.", tab: "Property", evidence: ev.cites, evidence_state: anyMissing ? "missing" : ev.state === "missing" ? "held" : ev.state, fields: { props: rows.map((x) => x.id) } });
    }
    for (const a of (L.activities || []).filter((x) => x.kind === "sole_trader" && x.owner_party_id === person && (x.valid_from || "") <= D.end)) {
      const id = `summary.15.${a.activity_id}`;
      summary({ id, section: "income.summary", label: "15", name: `Net business income, ${a.name}`, state: "not_found", tab: "Income", evidence_state: "missing", note: "Business income is held as evidence and not modelled by the Standard. Not treated as nil." });
      gap({ owner: "accountant", item: `Business income, ${a.name}`, why: "The Standard declines to derive business income, so it is not in this draft or its total. The bank and invoice files are held.", where: "Prepare from the business records", lines: [id] });
    }
    for (const label of dLabels) summaryFor(label, "deductions.summary", "Income");
    const memoNames = { "18H": "Total current year capital gains", "20O": "Foreign income tax offset", "18V": "Net capital losses carried forward" };
    for (const l of ["18H", "20O", "18V"]) if (items.get(l)) summary({ id: `summary.${l}`, section: "memo.summary", label: l, engine: l, name: memoNames[l], amount_cents: cents(l), tab: l === "20O" ? "Income" : "Shares", evidence_state: "held" });

    // ---------- estimate: the engine's own numbers; the workbook re-derives them in live formulas and a test holds the two together ----------
    const params = parametersFor(reference, D.end);
    const estLine = (id, nm, c, o = {}) => push({ id: `estimate.${id}`, section: "estimate.outcome", name: nm, amount_cents: c, state: c === null || c === undefined ? "not_found" : c === 0 ? "nil" : "value", nil_basis: c === 0 ? "Worked out to nothing." : null, kind: "calculated", indicative: true, evidence_state: "not_needed", ...o });
    if (est) {
      estLine("taxable", "Taxable income", est.taxable_income_cents);
      estLine("gross", "Income tax", est.gross_tax_cents);
      estLine("offsets", "Offsets", est.offsets_cents);
      estLine("levy", "Medicare levy", est.levy_cents);
      estLine("help", "HELP repayment", est.help_cents);
      estLine("payg", "PAYG withheld", est.payg_cents);
      estLine("franking", "Franking credits", est.franking_cents);
      estLine("result", "Estimated refund / (payable)", est.result_cents);
    }
    const hasHelp = (L.resolver.ctx.setup.account || []).some((a) => a.type === "help_debt" && R.ownersOf("account", a.account_id, D.end).some((x) => x.party_id === person));
    const helpSeen = (R.byKind.get("help_balance") || []).filter((o) => mine({ payload: { ...o.payload, period_end: o.payload.as_at } }) && o.payload.as_at >= D.start && o.payload.as_at < D.stop).sort((a, b) => (a.payload.as_at < b.payload.as_at ? 1 : -1))[0];
    if (hasHelp) push(helpSeen ? { id: "memo.help", section: "memo.items", label: null, name: `HELP balance at ${P.longDate(helpSeen.payload.as_at)}`, amount_cents: helpSeen.payload.balance_cents, evidence: [book.cite(helpSeen, book.folder("Tax office"))], evidence_state: "held", note: "Repayment is worked out on income with rental losses added back." } : { id: "memo.help", section: "memo.items", name: "HELP balance", state: "not_found", evidence_state: "missing" });

    // ---------- prior years, the tax office, and what comes back later ----------
    const fP = "Prior year", fT = book.folder("Tax office");
    prefill.forEach((o) => { book.cite(o, fT); book.entries.get(o.source_id).supports.add("ATO pre-fill column"); });
    if (!prefill.length) gap({ owner: "taxpayer", item: "ATO pre-fill for the year", why: "The tax office's own view of the year. Compare before lodging.", where: "myGov, usually ready by late July", lines: [] });
    const allReturns = (L.returns ? L.returns.returns : []).filter((r) => r.party_id === person).sort((a, b) => (a.fy < b.fy ? -1 : a.fy > b.fy ? 1 : a.version - b.version));
    const lastFy = `FY${D.y - 1}`;
    const show = allReturns.filter((r) => r.fy === lastFy || (r.assessed_on >= D.start && r.assessed_on < D.stop) || r.fy === fy);
    show.forEach((r, i) => {
      const tax = R.collapseDocs("tax_assessment").filter((o) => o.payload.fy === r.fy && o.payload.version === r.version && R.partyOf(o.payload.person_ref, o.payload.assessed_on) === person);
      const srcs = new Map(); for (const o of tax) { srcs.set(o.source_id, o); for (const a of o.alsoSeen || []) srcs.set(a.source_id, a); }
      const cites = [...srcs.values()].map((o) => book.cite(o, r.fy === fy ? "Lodged" : fP));
      const superseded = allReturns.some((x) => x.supersedes_return_id === r.return_id);
      push({ id: `prior.${i}`, section: "prior.returns", name: `${r.fy} return, version ${r.version}`, amount_cents: r.taxable_income_cents, fields: { fy: r.fy, version: r.version, lodged_on: r.lodged_on, assessed_on: r.assessed_on, result_cents: r.result_cents, status: superseded ? "Superseded, kept" : r.status === "amended" ? "Amended" : "Assessed", supersedes: r.supersedes_return_id, return_id: r.return_id }, evidence: cites, evidence_state: cites.length ? "held" : "missing" });
    });
    if (!allReturns.some((r) => r.fy === lastFy) && D.y > 2019) gap({ owner: "taxpayer", item: `Last year's return, ${lastFy}`, why: "An accountant taking on a return asks for the full prior year with its schedules.", where: "Prior accountant, or the tax office's copy", lines: [] });
    const amended = allReturns.filter((r) => r.version > 1 && r.assessed_on >= D.start && r.assessed_on < D.stop);
    amended.forEach((r) => gap({ owner: "accountant", item: `${r.fy} was amended during this year`, why: `Version ${r.version} replaced an earlier assessment on ${P.longDate(r.assessed_on)}. Both are kept. Does anything carry into this year?`, where: "Prior Years tab", lines: [] }));

    /* Money that came in, on an income category nothing maps and the engine does not place: a pension, a side job. It is not in the draft, so it has to be somewhere a person will see it. */
    const placedByEngine = new Set(["SALARY", "SALARY-ALLOW", "REIMBURSE", "SUPER-EMPLOYER", "SUPER-SACRIFICE", "SUPER-EARN", "GIFT-IN", "DIVIDEND", "TRUST-DIST", "ESS-INCOME"]);
    const mapped = new Set((L.resolver.ctx.setup.tax_map || []).filter((m) => m.selector_type === "category").map((m) => m.selector));
    const incomeCats = new Map(L.categories.filter((c) => c.kind === "income" && !placedByEngine.has(c.category_id) && !mapped.has(c.category_id)).map((c) => [c.category_id, c]));
    const seenIncome = new Map();
    for (const e of events) {
      if (!incomeCats.has(e.category_id) || e.category_id === "INTEREST" || e.category_id === "RENT-INC") continue;
      const acct = e.ownerAccount || (e.refs && e.refs.account) || (e.line && e.line.account);
      const owners = acct ? ownersOn("account", acct, e.occurred_on) : [];
      if (e.person ? e.person !== person : !owners.some((o) => o.party_id === person)) continue;
      seenIncome.set(e.category_id, (seenIncome.get(e.category_id) || 0) + Math.abs(e.amount_cents));
    }
    for (const [cat, amount] of seenIncome) gap({ owner: "accountant", item: `Money in with no tax label: ${incomeCats.get(cat).name}`, why: "It reached a household account on an income category, and neither the tax map nor the engine places it. It is not in the draft. Is it assessable?", where: "The Kitty's ledger, category " + incomeCats.get(cat).name, amount_cents: amount });

    // ---------- the rest of Open Items ----------
    if (parcels.some((x) => x.m.event_ref.startsWith("SHR-RSU"))) gap({ owner: "accountant", item: "Foreign currency convention", why: "Employee shares are priced in US dollars. Actual conversion rate used, or the official rate on the date?", where: "Shares tab", lines: [] });
    const swaps = events.filter((e) => e.kind === "crypto_swap" && e.person === person);
    if (swaps.length) gap({ owner: "accountant", item: "Crypto swapped for crypto", why: "Treated here as a disposal at market value on the day. Agree?", where: "Shares tab", amount_cents: sum(swaps, (e) => e.amount_cents), lines: [] });
    if (cents("18V")) gap({ owner: "accountant", item: "Capital losses carried forward", why: "Carried to next year. Confirm the balance.", where: "Shares tab", amount_cents: cents("18V"), lines: [] });
    gap({ owner: "accountant", item: "Private health rebate tier and surcharge", why: "The tiers are not in the Standard's reference, so no adjustment is estimated. Which tier applies at the family's income?", where: "Income tab", lines: [] });
    gap({ owner: "accountant", item: "Division 293", why: "The threshold is not in the Standard's reference, so it is not worked out here. Does it apply?", where: "Tax Estimate tab", lines: [] });
    if (method.watch || watchHit) gap({ owner: "accountant", item: "CGT method for this year", why: `${(method.watch || watchHit).note} The pack holds the net gain back rather than assume a rate.`, where: "Shares tab", lines: [] });
    for (const p of L.tax.prefill.filter((x) => x.person === person && x.fy === fy)) gap({ owner: "accountant", item: `Pre-fill differs at label ${p.label}`, why: `The tax office shows ${P.money(p.want)}, the draft ${P.money(p.got)}. A difference is a question to answer before lodging.`, where: "Return Summary", amount_cents: p.want - p.got, lines: [] });
    const dated = (t) => { const m = /\d{4}-\d{2}-\d{2}/.exec(t || ""); return m ? m[0] : null; };
    for (const r of L.review || []) {
      const d = dated(r.ref) || dated(r.what);
      if (r.kind === "open_item" || r.kind === "payslip_without_deposit" || !d || d < D.start || d >= D.stop) continue;
      gap({ owner: "taxpayer", item: `Unanswered in the Kitty: ${r.question || r.what}`, why: "A person has not answered this, so a figure may be wrong.", where: "The Kitty's review list", amount_cents: r.amount_cents ? Math.abs(r.amount_cents) : null, lines: [] });
    }
    for (const c of (L.checks || []).filter((x) => (x.status === "fail" || x.status === "gap") && String(x.scope).includes(fy) && String(x.scope).includes(party.name))) gap({ owner: "taxpayer", item: `Check ${c.law}: ${c.scope}`, why: c.detail, where: "The Kitty's reconciliation", lines: [] });

    // ---------- seal: number the files, count what supports what ----------
    const { list, map } = book.seal();
    for (const l of lines) l.evidence = l.evidence.filter(Boolean).map((c) => ({ ...c, ref: map.get(c.ref) }));
    const byRef = new Map(list.map((e) => [e.ref, e]));
    for (const l of lines) for (const c of l.evidence) byRef.get(c.ref).supports.add(l.label || l.name);
    const evidence = list.map((e) => ({ ...e, supports: [...e.supports] }));
    const headline = [];
    if (est) headline.push({ name: "Taxable income", cents: est.taxable_income_cents }, { name: "PAYG withheld", cents: est.payg_cents }, { name: "Estimated refund / (payable), indicative", cents: est.result_cents });
    return P.validate(P.make({
      kind: "tax", id: `tax-${person}-${fy}`, version, supersedes, state: "draft", audience: "accountant",
      question: `What belongs on ${party.name}'s ${D.label} return, and what stands behind each number?`,
      scope: { people: [{ party_id: person, name: party.name }], period: { from: D.start, to: D.end, label: D.label, long: D.long, fy }, subject: "individual_return", properties: props, spouse: adults[0] || null, has_help: hasHelp },
      as_of: asOf || L.asOf, boundary: BOUNDARY, headline, parameters: params, lines, evidence, gaps, notes,
    }));
  }

  return { build, fyDates, seriesRow, cgtMethod, parametersFor, LAW_WATCH, BOUNDARY, NAMES, allocate };
});
