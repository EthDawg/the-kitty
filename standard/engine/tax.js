/* Tax is a mapping from economic facts to labels, per person, per year, with the law read by date. This is a draft, never advice,
   and a lodged return outranks it. The gap between the two is law L11.
   Cash basis for individuals: income lands in the year it is received, by pay date. */
"use strict";
const { groupBy, cmp, fyOf, fyRange, allocate, monthOf, addDays } = require("./util");
const { activeOn } = require("./temporal");

const dollars = (c) => Math.trunc(c / 100) * 100;      // the ATO drops cents, label by label

function seriesAt(ref, id, on) {
  const s = ref.series && ref.series[id];
  if (!s) return null;
  const row = s.rows.filter((r) => r.valid_from <= on && (r.valid_to == null || on < r.valid_to)).sort((a, b) => cmp(b.valid_from, a.valid_from))[0];
  return row ? row.value : null;
}

// Resident scale. Accepts [{from, rate}] thresholds in dollars.
function scaleTax(cents, brackets) {
  const income = Math.floor(cents / 100);
  const rows = normaliseBrackets(brackets);
  let tax = 0;
  for (let i = 0; i < rows.length; i++) {
    const lo = rows[i].from, hi = i + 1 < rows.length ? rows[i + 1].from : Infinity;
    if (income > lo) tax += (Math.min(income, hi) - lo) * rows[i].rate;
  }
  return Math.round(tax * 100);
}
function normaliseBrackets(b) {
  const list = Array.isArray(b) ? b : b.brackets || b.rows || [];
  return list.map((r) => Array.isArray(r) ? { from: Math.max(r[0] - (r[0] % 100 === 1 ? 1 : 0), 0), rate: r[3] ?? r[1] } : { from: r.from ?? r.threshold ?? r.lower ?? r.min ?? 0, rate: r.rate > 1 ? r.rate / 100 : r.rate }).sort((a, b2) => a.from - b2.from);
}

function lito(cents, p) {
  if (!p) return 0;
  const inc = Math.floor(cents / 100);
  const max = p.max ?? p.maximum ?? 0;
  const t = p.tiers || p.tapers;
  if (Array.isArray(t)) {
    let v = max;
    for (const x of t) if (inc > x.from) v -= (Math.min(inc, x.to ?? Infinity) - x.from) * x.rate;
    return Math.round(Math.max(v, 0) * 100);
  }
  return Math.round(max * 100);
}

function derive({ L, R, reference, setup }) {
  const people = (setup.party || []).filter((p) => p.kind === "person" && (setup.membership || []).some((m) => m.party_id === p.party_id && m.role === "adult"));
  const items = new Map();
  const add = (person, fy, label, cents, method, evidence = "held", ref, activity) => {
    if (!cents) return;
    const k = `${person}|${fy}|${label}`;
    const r = items.get(k) || { party_id: person, fy, label, amount_cents: 0, method, evidence, refs: [], by_activity: {} };
    if (activity) r.by_activity[activity] = (r.by_activity[activity] || 0) + cents;
    r.amount_cents += cents;
    if (ref && r.refs.length < 40) r.refs.push(ref);
    if (evidence === "missing" || (evidence === "at_risk" && r.evidence === "held")) r.evidence = evidence;
    items.set(k, r);
  };
  const tmap = setup.tax_map || [];
  const mapFor = (type, sel, on) => activeOn(tmap.filter((m) => m.selector_type === type && m.selector === sel && (m.entity_kind == null || m.entity_kind === "person")), on);
  const taxOwners = (e, on) => {
    const asset = e.asset_id;
    const account = e.ownerAccount || (e.refs && e.refs.account) || (e.line && e.line.account);
    const subject = asset ? ["asset", asset] : account ? ["account", account] : null;
    if (!subject) return null;
    const rows = R.ownersOf(subject[0], subject[1], on, "tax");
    return rows.length ? rows : null;
  };
  const wrapper = (id) => { const p = (setup.party || []).find((x) => x.party_id === id); return p && ["smsf", "trust", "company"].includes(p.kind); };

  const spread = (e, on, label, cents, method, evidence) => {
    const owners = taxOwners(e, on);
    const fy = fyOf(on);
    if (owners) {
      const humans = owners.filter((o) => !wrapper(o.party_id));
      if (!humans.length) return;
      for (const s of allocate(cents, humans.map((o) => ({ key: o.party_id, weight: o.share_bps })))) add(s.key, fy, label, s.cents, method, evidence, e.event_id, e.activity_id || e.asset_id);
    } else if (e.person) add(e.person, fy, label, cents, method, evidence, e.event_id, e.activity_id || e.asset_id);
  };

  const byEmployerYear = new Map();
  // ---------- wages ----------
  for (const e of L.events) {
    if (e.kind === "wage") {
      const fy = fyOf(e.occurred_on);
      add(e.person, fy, "1", e.fields.gross - e.fields.sacrifice, "payslips", "held", e.event_id);
      add(e.person, fy, "2", e.fields.allowance, "payslips", "held", e.event_id);
      add(e.person, fy, "PAYG", e.fields.tax, "payslips", "held", e.event_id);
      add(e.person, fy, "SG", e.fields.super, "payslips", "held", e.event_id);
      add(e.person, fy, "RESC", e.fields.sacrifice, "payslips", "held", e.event_id);
    }
    if (e.kind === "dividend" || e.kind === "drp") {
      const t = e.tax || {};
      spread(e, e.occurred_on, "11S", t.unfranked || 0, "registry statement");
      spread(e, e.occurred_on, "11T", t.franked || 0, "registry statement");
      spread(e, e.occurred_on, "11U", t.franking || 0, "registry statement");
    }
    if (e.kind === "vest") add(e.person, fyOf(e.occurred_on), "12", e.amount_cents, "plan statement", "held", e.event_id);
  }

  // An employer's income statement outranks a sum of payslips, and holds the pays from before the history starts.
  for (const o of R.collapseDocs("income_statement")) {
    const p = o.payload;
    const person = R.partyOf(p.person_ref, p.period_end);
    (byEmployerYear.get(`${person}|${p.fy}`) || byEmployerYear.set(`${person}|${p.fy}`, []).get(`${person}|${p.fy}`)).push(p);
  }
  for (const [k, rows] of byEmployerYear) {
    const [person, fy] = k.split("|");
    const gross = rows.reduce((s, r) => s + r.gross_cents, 0), tax = rows.reduce((s, r) => s + r.tax_cents, 0);
    const label1 = items.get(`${person}|${fy}|1`), payg = items.get(`${person}|${fy}|PAYG`);
    if (label1) { label1.amount_cents = gross - (items.get(`${person}|${fy}|2`) || { amount_cents: 0 }).amount_cents; label1.method = "income statement"; } else add(person, fy, "1", gross, "income statement");
    if (payg) { payg.amount_cents = tax; payg.method = "income statement"; } else add(person, fy, "PAYG", tax, "income statement");
  }

  // ---------- anything the map names, by category or event kind, on the event's date ----------
  const postingsByEvent = groupBy(L.postings.filter((p) => p.category_id), (p) => p.event_id);
  for (const e of L.events) {
    const legs = postingsByEvent.get(e.event_id) || [];
    for (const p of legs) {
      if (["wage", "dividend", "drp", "vest"].includes(e.kind)) continue;
      for (const m of mapFor("category", p.category_id, e.occurred_on)) {
        const cents = m.treatment === "income" ? -p.amount_cents : p.amount_cents;
        if (m.basis === "person" && (e.claimant || e.person) && !["household"].includes(e.person)) add(e.claimant || e.person, fyOf(e.occurred_on), m.label, cents, `category ${p.category_id}`, "held", e.event_id);
        else spread(e, e.occurred_on, m.label, cents, `category ${p.category_id}`);
      }
    }
    for (const m of mapFor("event_kind", e.kind, e.occurred_on)) spread(e, e.occurred_on, m.label, e.amount_cents, `event ${e.kind}`);
  }

  // ---------- annual tax statements ----------
  for (const d of R.distributions || []) {
    const p = d.p; const on = p.period_end;
    const e = { asset_id: null, refs: { account: d.holding }, person: d.person, event_id: `dist|${d.instrument}|${p.fy}` };
    const put = (label, v, m = "annual tax statement") => spread(e, on, label, v || 0, m);
    put("13U", (p.interest_cents || 0) + (p.unfranked_cents || 0));
    put("13C", p.franked_cents);
    put("13Q", p.franking_credit_cents);
    put("18H-DIST", (p.discount_gain_cents || 0) * 2);
    put("20M", p.foreign_income_cents);
    put("20O", p.foreign_credit_cents);
  }

  // ---------- capital gains: losses first, then the discount ----------
  const carry = new Map();
  const fys = [...new Set(L.lotMatches.map((m) => m.fy))].sort();
  const allFys = [...new Set([...fys, ...[...items.values()].map((i) => i.fy)])].sort();
  for (const fy of allFys) {
    for (const person of people.map((p) => p.party_id)) {
      const rows = shareMatches(L.lotMatches, R, wrapper).filter((m) => m.fy === fy && m.party_id === person);
      const unknown = rows.filter((m) => m.gain_cents == null).length;
      if (unknown) add(person, fy, "18A", 0, "sales with unknown cost base", "missing");
      let lossPool = carry.get(person) || 0;
      let disc = 0, other = 0;
      const fromTrusts = (items.get(`${person}|${fy}|18H-DIST`) || { amount_cents: 0 }).amount_cents;
      disc += fromTrusts;
      for (const m of rows) {
        if (m.gain_cents == null) continue;
        if (m.gain_cents < 0) lossPool -= m.gain_cents;
        else if (m.discount_eligible) disc += m.gain_cents; else other += m.gain_cents;
      }
      const total = disc + other;
      const useOther = Math.min(lossPool, other); other -= useOther; lossPool -= useOther;
      const useDisc = Math.min(lossPool, disc); disc -= useDisc; lossPool -= useDisc;
      carry.set(person, lossPool);
      add(person, fy, "18H", total + 0, "lot matches and trust gains");
      add(person, fy, "18A", Math.floor(disc / 2) + other, "lot matches, losses first, then the discount");
      if (lossPool) add(person, fy, "18V", lossPool, "losses carried forward");
    }
  }

  // ---------- work logs: deductions with no bank line ----------
  for (const o of R.byKind.get("work_log") || []) {
    const p = o.payload;
    const person = R.partyOf(p.person_ref, p.period_end);
    const fy = p.fy;
    if (p.log_kind === "expense" && p.label) add(person, fy, p.label, p.amount_cents, "a person's worksheet");
    if (p.log_kind === "wfh" && p.hours != null) {
      const rate = reference ? seriesAt(reference, "wfh_fixed_rate", p.period_end) : null;
      const r = rate && typeof rate === "object" ? rate.rate ?? rate.value ?? rate.cents_per_hour / 100 : rate;
      if (r != null) add(person, fy, "D5", Math.round(p.hours * Number(r > 5 ? r / 100 : r) * 100), `work from home: ${p.hours} hours at the rate for that year`);
    }
  }

  // The plan's annual statement outranks a sum of vests.
  for (const o of R.collapseDocs("ess_statement")) {
    const p = o.payload; const person = R.partyOf(p.person_ref, p.period_end);
    const it = items.get(`${person}|${p.fy}|12`);
    if (it) { it.amount_cents = p.discount_cents; it.method = "plan statement"; } else add(person, p.fy, "12", p.discount_cents, "plan statement");
  }
  // Borrowing costs spread over years and follow the loan's purpose. What is left falls due when the loan is refinanced.
  for (const o of R.byKind.get("amortisation_schedule") || []) {
    const p = o.payload;
    const contract = R.alias("contract", p.contract_ref, p.issued_on) || (R.contracts.has(p.contract_ref) ? p.contract_ref : null);
    if (!contract) continue;
    const c = R.contracts.get(contract);
    const payout = L.events.find((e) => e.kind === "loan_payout" && e.contract_id === contract);
    const purposes = (setup.link || []).filter((k) => k.relation === "funds_purpose" && k.from_id === contract);
    for (const it of p.items || []) for (const [fy, cents] of Object.entries(it.by_fy || {})) {
      const payoutFy = payout ? fyOf(payout.occurred_on) : null;
      const year = payoutFy && fy > payoutFy ? payoutFy : fy;
      for (const k of purposes.length ? purposes : [{ to_id: c.asset_id, share_bps: 10000 }]) {
        const share = Math.round(cents * (k.share_bps || 10000) / 10000);
        if (R.term("asset", k.to_id, "use", fyRange(year).end) !== "rental") continue;
        spread({ asset_id: k.to_id, event_id: `amort|${contract}|${it.name}`, refs: {} }, fyRange(year).end, "21X", share, `borrowing cost: ${it.name}`);
      }
    }
  }
  // Private health: days covered and the rebate are memo facts on the return. They decide the surcharge; they are not income.
  for (const o of R.byKind.get("health_statement") || []) {
    const p = o.payload; const person = R.partyOf(p.person_ref, p.period_end);
    add(person, p.fy, "M2-DAYS", p.days_covered, "insurer's statement"); add(person, p.fy, "PHI-REBATE", p.rebate_cents, "insurer's statement");
  }

  // ---------- decline in value and capital works: schedules, not transactions ----------
  for (const o of R.byKind.get("depreciation_schedule") || []) {
    const p = o.payload;
    const asset = R.assets.has(p.asset_ref) ? p.asset_ref : R.alias("asset", p.asset_ref, p.issued_on);
    if (!asset) continue;
    for (const it of p.items || []) for (const [fy, cents] of Object.entries(it.by_fy || {})) {
      const on = fyRange(fy).end;
      spread({ asset_id: asset, event_id: `sched|${asset}|${it.name}`, refs: {} }, on, it.division === "43" ? "21F" : "21X", cents, `schedule: ${it.name}`);
    }
  }

  const list = [...items.values()].map((r) => ({ ...r, refs: r.refs })).sort((a, b) => cmp(a.fy, b.fy) || cmp(a.party_id, b.party_id) || cmp(a.label, b.label));
  const out = { items: list, ties: [], caps: [], estimates: [] };

  // ---------- estimate: taxable income, the scale, offsets, levies, credits ----------
  const byPersonFy = groupBy(list, (r) => `${r.party_id}|${r.fy}`);
  const incomeLabels = new Set(["1", "2", "7", "10", "11S", "11T", "11U", "12", "13U", "13C", "13Q", "18A", "20M", "21P", "24"]);
  const notDeductions = new Set(["21P", "21Q", "21F", "21X"]);
  for (const [key, rows] of byPersonFy) {
    const [person, fy] = key.split("|");
    const get = (l) => (rows.find((r) => r.label === l) || {}).amount_cents || 0;
    let income = 0, deductions = 0;
    for (const r of rows) {
      if (incomeLabels.has(r.label)) income += dollars(r.amount_cents);
      else if (/^D\d+/.test(r.label)) deductions += dollars(r.amount_cents);
    }
    const rentNet = dollars(get("21P")) - dollars(get("21Q")) - dollars(get("21F")) - dollars(get("21X"));
    income += rentNet - dollars(get("21P"));
    void notDeductions;
    const taxable = Math.max(income - deductions, 0);
    const { end } = fyRange(fy);
    const brackets = reference ? seriesAt(reference, "resident_tax_brackets", end) : null;
    if (!brackets) { out.estimates.push({ person, fy, taxable_income_cents: taxable, gross_tax_cents: null, offsets_cents: null, levy_cents: null, payg_cents: get("PAYG"), franking_cents: get("11U") + get("13Q"), result_cents: null }); continue; }
    const gross = scaleTax(taxable, brackets);
    const litoParams = seriesAt(reference, "lito", end);
    const offsets = lito(taxable, litoParams);
    const levyRate = seriesAt(reference, "medicare_levy_rate", end);
    const levy = levyRate == null ? 0 : Math.round(taxable * (Number(typeof levyRate === "object" ? levyRate.rate : levyRate) > 1 ? 0.02 : Number(typeof levyRate === "object" ? levyRate.rate : levyRate)));
    const payg = get("PAYG");
    const franking = get("11U") + get("13Q");
    const result = payg + franking - Math.max(gross - offsets, 0) - levy;
    out.estimates.push({ person, fy, taxable_income_cents: taxable, gross_tax_cents: gross, offsets_cents: offsets, levy_cents: levy, payg_cents: payg, franking_cents: franking, result_cents: result });
  }

  // ---------- L11: the draft against what was lodged. A lodged year is history; the gap is the finding ----------
  const lodged = new Map();
  for (const o of R.collapseDocs("tax_assessment")) { const p = o.payload; const person = R.partyOf(p.person_ref, p.assessed_on); const k = `${person}|${p.fy}`; const cur = lodged.get(k); if (!cur || p.version > cur.version) lodged.set(k, p); }
  for (const [k, p] of lodged) {
    const [person, fy] = k.split("|");
    const est = out.estimates.find((x) => x.person === person && x.fy === fy);
    if (!est) { out.ties.push({ person, fy, status: "gap", lodged: p.taxable_income_cents, derived: null, gap: null, result_gap: null, detail: "No derived draft for this year." }); continue; }
    const gap = est.taxable_income_cents - p.taxable_income_cents;
    out.ties.push({ person, fy, status: Math.abs(gap) <= 100 ? "pass" : "fail", lodged: p.taxable_income_cents, derived: est.taxable_income_cents, gap, lodged_result: p.result_cents, derived_result: est.result_cents, result_gap: est.result_cents - p.result_cents, detail: Math.abs(gap) <= 100 ? "Taxable income ties." : "Derived taxable income differs from the assessment." });
  }

  // Label by label: an offsetting pair of errors passes on the total and fails here. A lodged year's lines are the record.
  const labelLines = new Map();
  for (const l of (materialiseReturns(R)).lines) if (l.role === "leaf" && l.label) labelLines.set(`${l.return_id}|${l.label}`, l);
  out.labelTies = [];
  for (const [k, p] of lodged) {
    const [person, fy] = k.split("|");
    const rid = `ret_${person}_${fy}_v${p.version}`;
    const lines = (Array.isArray(p.labels) ? p.labels : []).filter((l) => l.role === "leaf" && l.label);
    let bad = 0, worst = null;
    for (const l of lines) {
      const got = (items.get(`${person}|${fy}|${l.label}`) || { amount_cents: 0 }).amount_cents;
      const gap = Math.trunc(got / 100) * 100 - Math.trunc(l.amount_cents / 100) * 100;
      if (Math.abs(gap) > 100) { bad += 1; if (!worst || Math.abs(gap) > Math.abs(worst.gap)) worst = { label: l.label, gap }; }
    }
    if (lines.length) out.labelTies.push({ person, fy, labels: lines.length, bad, worst, rid });
  }
  // Pre-fill is the tax office's own view of the year. A difference is a question to answer before lodging, either way.
  out.prefill = [];
  for (const o of R.collapseDocs("prefill")) {
    const p = o.payload; const person = R.partyOf(p.person_ref, p.period_end);
    for (const it of p.items || []) {
      const label = it.label, want = it.amount_cents;
      const got = (items.get(`${person}|${p.fy}|${label}`) || { amount_cents: 0 }).amount_cents;
      if (label && Math.abs(got - want) > 100) out.prefill.push({ person, fy: p.fy, label, want, got });
    }
  }

  // ---------- caps ----------
  const conc = new Map();
  for (const e of L.events) if (e.kind === "super_contribution" || e.kind === "super_personal") {
    const type = e.superType;
    if (!["employer", "salary_sacrifice", "personal_deductible"].includes(type)) continue;
    const k = `${e.person}|${fyOf(e.occurred_on)}`;
    conc.set(k, (conc.get(k) || 0) + e.amount_cents);
  }
  for (const [k, used] of conc) {
    const [person, fy] = k.split("|");
    const cap = reference ? seriesAt(reference, "concessional_cap", fyRange(fy).end) : null;
    const limit = cap == null ? null : Math.round(Number(typeof cap === "object" ? cap.amount ?? cap.value : cap) * 100);
    if (limit != null) out.caps.push({ person, fy, cap: "concessional", used, limit });
  }
  return out;
}

// A joint holding's gain splits by tax ownership on the day of sale, conserving cents.
function shareMatches(matches, R, wrapper) {
  const out = [];
  for (const m of matches) {
    if (m.party_id) { out.push(m); continue; }
    const lot = R.lots && R.lots.lots.find((l) => l.lot_id === m.lot_id);
    const propertyLot = R.propertyLots && R.propertyLots.lots.find((l) => l.lot_id === m.lot_id);
    const subject = propertyLot ? ["asset", propertyLot.asset_id] : lot ? ["account", lot.account_id] : null;
    const owners = subject ? R.ownersOf(subject[0], subject[1], m.disposed_on, "tax").filter((o) => !wrapper(o.party_id)) : [];
    if (!owners.length) { out.push(m); continue; }
    if (m.gain_cents == null) { for (const o of owners) out.push({ ...m, party_id: o.party_id }); continue; }
    const shares = allocate(m.gain_cents, owners.map((o) => ({ key: o.party_id, weight: o.share_bps })));
    for (const x of shares) out.push({ ...m, party_id: x.key, gain_cents: x.cents });
  }
  return out;
}

// Lodged returns are history. Labels repeat and some lines have no label, so each line has an identity and a role.
function materialiseReturns(R) {
  const returns = [], lines = [];
  for (const o of R.collapseDocs("tax_assessment")) {
    const p = o.payload;
    const party_id = R.partyOf(p.person_ref, p.assessed_on);
    const return_id = `ret_${party_id}_${p.fy}_v${p.version}`;
    returns.push({ return_id, party_id, fy: p.fy, version: p.version, status: p.version > 1 ? "amended" : "assessed", lodged_on: p.lodged_on || null, assessed_on: p.assessed_on, taxable_income_cents: p.taxable_income_cents, tax_cents: p.gross_tax_cents, credits_cents: p.payg_credits_cents, result_cents: p.result_cents, source_id: o.source_id, supersedes_return_id: p.version > 1 ? `ret_${party_id}_${p.fy}_v${p.version - 1}` : null });
    const rows = Array.isArray(p.labels) ? p.labels : Object.entries(p.labels || {}).map(([label, amount_cents]) => ({ label, amount_cents, role: "leaf" }));
    rows.forEach((r, i) => lines.push({ line_id: r.line_id || `${return_id}_${i + 1}`, return_id, label: r.label ?? null, section: r.section ?? null, role: r.role || "leaf", rolls_up_to: r.rolls_up_to ?? null, amount_cents: r.amount_cents, note: r.note ?? null }));
  }
  return { returns, lines };
}

/* A year's composition. Lodged-first: a lodged year reads the return's leaf lines by section, so a business year or a parental-leave
   year is not one low bar. An open year reads derived items by activity. The grade says which. */
function composition(L, person, fy) {
  const R = L.returns || { returns: [], lines: [] };
  const latest = R.returns.filter((r) => r.party_id === person && r.fy === fy).sort((a, b) => b.version - a.version)[0];
  if (latest) {
    const parts = new Map();
    for (const l of R.lines.filter((x) => x.return_id === latest.return_id && x.role === "leaf")) {
      const k = l.section || l.label || "other";
      parts.set(k, (parts.get(k) || 0) + l.amount_cents);
    }
    return { fy, person, grade: "lodged", parts: [...parts].map(([section, amount_cents]) => ({ section, amount_cents })) };
  }
  const items = (L.tax ? L.tax.items : []).filter((i) => i.party_id === person && i.fy === fy && /^(1|2|10|11|12|13|18A|20|21P)/.test(i.label));
  return { fy, person, grade: "derived", parts: items.map((i) => ({ section: i.label, amount_cents: i.amount_cents })) };
}

module.exports = { derive, scaleTax, seriesAt, materialiseReturns, composition };
