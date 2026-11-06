/* The laws (schema/checks.json). Accuracy is the set of things that cannot be false at the same time.
   Each law returns check_result rows. A gap is missing evidence; a fail is evidence contradicting evidence. */
"use strict";
const { groupBy, cmp, monthOf, monthEnd, nextMonth, monthsBetween, addDays, daysBetween, fyOf, fyRange, parseUnits, fmtUnits, hash64, stableStringify } = require("./util");
const { activeOn, termAt, validOn } = require("./temporal");

const row = (law, scope, status, extra = {}) => ({ law, scope, status, expected: extra.expected ?? null, actual: extra.actual ?? null, gap_cents: extra.gap_cents ?? null, detail: extra.detail ?? null, accepted_by: null });
const money = (c) => (c == null ? "" : (c / 100).toFixed(2));

const laws = {
  L1(L) {
    const bad = [];
    for (const [id, ps] of groupBy(L.postings, (p) => p.event_id)) {
      const s = ps.reduce((a, p) => a + p.amount_cents, 0);
      if (s) bad.push(row("L1", id, "fail", { gap_cents: s, detail: "Postings do not sum to zero." }));
    }
    return bad.length ? bad : [row("L1", `${L.events.length} events`, "pass")];
  },

  L2(L) {
    const out = [];
    const last = L.balances.months[L.balances.months.length - 1];
    const maxAge = { "clearing:super": 75, "clearing:settle": 10, "clearing:income": 45, "clearing:payroll": 7, "clearing:agent": 15 };
    for (const [account, series] of L.balances.table) {
      if (!account.startsWith("clearing:")) continue;
      const bal = series.get(last) || 0;
      if (!bal) { out.push(row("L2", account, "pass")); continue; }
      const prefix = account.split(":").slice(0, 2).join(":");
      const flows = L.postings.filter((p) => p.account_id === account).map((p) => ({ p, e: L.index.events.get(p.event_id) })).sort((a, b) => cmp(a.e.occurred_on, b.e.occurred_on));
      let run = 0, since = null;
      for (const f of flows) { const was = run; run += f.p.amount_cents; if (was === 0 && run !== 0) since = f.e.occurred_on; if (run === 0) since = null; }
      const age = since ? daysBetween(since, L.asOf) : 0;
      const allowed = maxAge[prefix];
      // A fund receipt older than the first payslip held: its other witness is before the history starts. That is missing evidence, not a contradiction.
      const beforeHistory = bal < 0 && prefix === "clearing:super";
      out.push(row("L2", account, allowed && age <= allowed ? "open" : beforeHistory ? "gap" : "fail", { gap_cents: bal, detail: `Open ${age} days since ${since}.${beforeHistory ? " Its other witness is older than the history held." : ""}` }));
    }
    return out.length ? out : [row("L2", "no clearing accounts", "pass")];
  },

  L3(L) {
    const out = [];
    const X = L.index;
    // Inside held evidence: a statement's own arithmetic.
    for (const o of L.observations.filter((x) => x.kind === "statement" || x.kind === "loan_statement" || x.kind === "super_statement")) {
      const p = o.payload;
      if (o.kind === "statement" && p.credits_cents != null && p.debits_cents != null) {
        const want = p.opening_cents + p.credits_cents - p.debits_cents;
        if (want !== p.closing_cents) out.push(row("L3", `${p.account_ref} ${p.period_end}`, "fail", { gap_cents: p.closing_cents - want, detail: "Statement's own totals do not add." }));
      }
      if (o.kind === "loan_statement") {
        const want = p.opening_cents + p.interest_cents + (p.fees_cents || 0) + (p.redraws_cents || 0) - p.repayments_cents;
        if (want !== p.closing_cents) out.push(row("L3", `${p.account_ref} ${p.period_end}`, "fail", { gap_cents: p.closing_cents - want, detail: "Lender statement's walk does not add." }));
      }
    }
    // Ledger against stated closes: every stated balance is a claim the ledger must match.
    const stated = L.stated;
    for (const [account, rows] of groupBy(stated, (s) => s.account)) {
      const a = X.accounts.get(account);
      if (!a) continue;
      if (a.fidelity === "snapshot") continue;
      const series = L.dailyBalance(account);
      let bad = 0, worst = null;
      for (const s of [...rows].sort((x, y) => cmp(x.date, y.date))) {
        const b = series(s.date);
        if (s.any ? !s.any.includes(b) : b !== s.cents) { bad += 1; if (!worst) worst = { s, b }; }
      }
      // A break that follows a hole in the evidence is a gap: lines are missing, nothing contradicts. A break with no hole before it is a fail.
      const held = [...new Set((L.linesByAccount.get(account) || []).map((l) => monthOf(l.date)))].sort();
      const hole = held.length ? monthsBetween(held[0], held[held.length - 1]).find((m) => !held.includes(m)) : null;
      const afterHole = bad && hole && monthOf(worst.s.date) >= hole;
      out.push(row("L3", account, !bad ? "pass" : afterHole ? "gap" : "fail", bad ? { expected: money(worst.s.cents), actual: money(worst.b), gap_cents: worst.s.cents - worst.b, detail: afterHole ? `Lines are missing from ${hole}; ${bad} later balances are off by what they held.` : `${bad} of ${rows.length} stated balances disagree; first on ${worst.s.date}.` } : { detail: `${rows.length} stated balances tie.` }));
    }
    // Between held evidence: months with no lines on an open account are a gap, never a fail.
    for (const [account, lines] of L.linesByAccount) {
      const a = X.accounts.get(account);
      if (!a || a.fidelity === "snapshot") continue;
      const ms = [...new Set(lines.map((l) => monthOf(l.date)))].sort();
      const missing = monthsBetween(ms[0], ms[ms.length - 1]).filter((m) => !ms.includes(m));
      // A quiet month on a savings account is not a hole if a later stated balance still ties.
      if (missing.length && !a.quiet) out.push(row("L3", `${account} quiet months`, "open", { detail: `No lines in ${missing.slice(0, 6).join(", ")}${missing.length > 6 ? "…" : ""}.` }));
    }
    return out;
  },

  L4(L) {
    const roles = groupBy(L.witnesses, (w) => w.obs_id);
    const bearing = new Set(["txn_line", "super_line", "payslip", "owner_statement", "contract_note", "dividend", "vest", "crypto_txn", "tax_assessment", "settlement", "bill", "receipt", "childcare_statement"]);
    let orphans = 0, doubles = 0; const samples = [];
    const excluded = L.excludedObs || new Set();
    for (const o of L.observations) {
      if (!bearing.has(o.kind) || o.status !== "active" || excluded.has(o.obs_id)) continue;
      const w = roles.get(o.obs_id) || [];
      if (!w.length) { orphans += 1; if (samples.length < 5) samples.push(`${o.kind} ${o.locator}`); }
      const rec = new Set(w.filter((x) => x.role === "recognises").map((x) => x.event_id));
      if (o.kind !== "owner_statement" && o.kind !== "loan_statement" && o.kind !== "super_statement" && rec.size > 1) doubles += 1;
    }
    return [row("L4", "observations", orphans || doubles ? "fail" : "pass", { detail: orphans || doubles ? `${orphans} unattached, ${doubles} double-claimed. ${samples.join("; ")}` : `${L.observations.length} observations attached.` })];
  },

  L5(L) {
    const out = []; let bad = 0;
    const slips = L.observations.filter((o) => o.kind === "payslip" && o.status === "active");
    const unique = new Map();
    for (const o of slips) {
      const p = o.payload;
      unique.set(`${p.person_ref}|${p.employer_ref}|${p.pay_date}|${p.net_cents}`, o);
      const want = p.gross_cents - (p.salary_sacrifice_cents || 0) - p.tax_cents - (p.post_tax_deductions_cents || 0) + (p.allowance_cents || 0) + (p.reimbursement_cents || 0);
      if (Math.abs(want - p.net_cents) > 1) { bad += 1; out.push(row("L5", `${p.person_ref} ${p.pay_date}`, "fail", { gap_cents: want - p.net_cents, detail: "Gross less tax and deductions is not net." })); }
    }
    for (const o of L.observations.filter((x) => x.kind === "income_statement" && x.status === "active")) {
      const p = o.payload;
      const { start, stop } = fyRange(p.fy);
      const held = [...unique.values()].filter((s) => s.payload.person_ref === p.person_ref && s.payload.employer_ref === p.employer_ref && s.payload.pay_date >= start && s.payload.pay_date < stop);
      const sum = held.reduce((a, s) => a + s.payload.gross_cents, 0);
      const firstHeld = held.reduce((a, s) => (a && a < s.payload.pay_date ? a : s.payload.pay_date), null);
      if (Math.abs(sum - p.gross_cents) <= 100) continue;
      if (!firstHeld || daysBetween(start, firstHeld) > 21) { out.push(row("L5", `${p.person_ref} ${p.fy}`, "gap", { gap_cents: p.gross_cents - sum, detail: `Payslips are held from ${firstHeld}; the rest of the year is not held.` })); continue; }
      if (Math.abs(sum - p.gross_cents) > 100) out.push(row("L5", `${p.person_ref} ${p.fy}`, "fail", { expected: money(p.gross_cents), actual: money(sum), gap_cents: p.gross_cents - sum, detail: "Payslips do not sum to the income statement." }));
    }
    if (!bad && !out.length) out.push(row("L5", `${unique.size} payslips`, "pass"));
    return out;
  },

  L6(L) {
    const out = [];
    const tol = 5000;
    for (const c of L.contracts.filter((k) => k.kind === "loan" && k.account_id)) {
      const series = L.dailyBalance(c.account_id);
      const charged = groupBy(L.events.filter((e) => e.kind === "loan_interest" && e.contract_id === c.contract_id), (e) => monthOf(e.occurred_on));
      let worst = 0, worstM = null, n = 0, over = 0;
      for (const [m, evs] of charged) {
        const act = evs.reduce((s, e) => s + e.amount_cents, 0);
        const days = monthsDays(m);
        let expected = 0, have = true;
        for (const d of days) {
          const rate = termAt(L.termIdx, "contract", c.contract_id, "interest_rate", d);
          if (rate == null) { have = false; break; }
          const offsetLink = activeOn(L.links.filter((k) => k.relation === "offsets" && k.to_id === c.contract_id), d)[0];
          const offset = offsetLink ? offsetLink.from_id : termAt(L.termIdx, "contract", c.contract_id, "offset_account", d);
          const off = offset ? Math.max(L.dailyBalance(offset)(d), 0) : 0;
          const bal = Math.max(-series(addDays(d, -1)) - off, 0);
          expected += bal * (Number(rate) / 100) / 365;
        }
        if (!have) continue;
        n += 1;
        const gap = Math.round(expected) - act;
        if (Math.abs(gap) > Math.max(tol, act * 0.15)) over += 1;
        if (Math.abs(gap) > Math.abs(worst)) { worst = gap; worstM = m; }
      }
      if (!n) { out.push(row("L6", c.contract_id, "skip", { detail: "No rate history to check against." })); continue; }
      out.push(row("L6", c.contract_id, over ? "fail" : "pass", { gap_cents: worst, detail: `${n} months checked; widest gap ${money(worst)} in ${worstM}.${over ? ` ${over} months beyond the tolerance.` : ""}` }));
    }
    return out;
  },

  L7(L) {
    const out = [];
    const stated = L.observations.filter((o) => o.kind === "holding" && o.status === "active");
    const lots = L.lotState || [];
    let checked = 0, bad = 0, sample = null;
    for (const o of stated) {
      const p = o.payload;
      if (L.isSnapshotHolding(p)) continue;
      const held = L.unitsOn(p.instrument_ref, p.as_at, p.account_ref);
      checked += 1;
      if (held !== parseUnits(p.units)) { bad += 1; if (!sample) sample = `${p.instrument_ref} on ${p.as_at}: lots ${fmtUnits(held)}, stated ${p.units}`; }
    }
    void lots;
    out.push(row("L7", "holdings", !checked ? "skip" : bad ? "fail" : "pass", { detail: checked ? `${checked} stated holdings; ${bad} differ. ${sample || ""}` : "No stated holdings." }));
    return out;
  },

  // The identity holds by construction under L1, so it proves nothing alone. This tests the ledger against what sources stated, independently.
  L8(L) {
    const inner = new Set(["cash", "property", "super", "shares", "crypto", "vehicle", "device", "loans"]);
    const byAccount = groupBy(L.stated, (s) => s.account);
    let months = 0, worst = 0, worstM = null;
    for (const m of L.balances.months) {
      const end = monthEnd(m);
      let posted = 0, stated = 0, complete = true, seen = 0;
      for (const [account, series] of L.balances.table) {
        const a = L.index.accounts.get(account);
        if (!a || !inner.has(a.reporting_group) || (a.fidelity === "snapshot")) continue;
        const bal = series.get(m) || 0;
        if (!bal) continue;
        const rows = (byAccount.get(account) || []).filter((s) => s.date <= end && monthOf(s.date) === m);
        if (!rows.length) { complete = false; break; }
        const last = rows.reduce((x, y) => (y.date >= x.date ? y : x));
        const value = L.dailyBalance(account)(last.date);
        posted += value; stated += last.any && last.any.includes(value) ? value : last.cents; seen += 1;
      }
      if (!complete || !seen) continue;
      months += 1;
      if (Math.abs(posted - stated) > Math.abs(worst)) { worst = posted - stated; worstM = m; }
    }
    if (!months) return [row("L8", "household", "skip", { detail: "No month has a stated balance for every account." })];
    return [row("L8", "household", worst ? "fail" : "pass", { gap_cents: worst, detail: worst ? `Posted and stated net worth differ most in ${worstM}.` : `${months} months where posted net worth equals what sources state.` })];
  },

  L9(L) {
    const out = [];
    for (const [k, rows] of groupBy(L.ownership.filter((o) => o.superseded_at == null), (o) => `${o.subject_type}|${o.subject_id}|${o.basis}`)) {
      const dates = [...new Set(rows.flatMap((r) => [r.valid_from, r.valid_to].filter(Boolean)))].sort();
      for (const d of dates) {
        const act = rows.filter((r) => validOn(r, d));
        if (!act.length) continue;
        const s = act.reduce((a, r) => a + r.share_bps, 0);
        if (s !== 10000) out.push(row("L9", `${k} on ${d}`, "fail", { detail: `Shares sum to ${s / 100}%.` }));
      }
    }
    return out.length ? out : [row("L9", "ownership", "pass")];
  },

  L10(L) {
    const out = [];
    for (const [k, rows] of groupBy(L.terms.filter((t) => t.superseded_at == null), (t) => `${t.subject_type}|${t.subject_id}|${t.term}`)) {
      const sorted = [...rows].sort((a, b) => cmp(a.valid_from, b.valid_from));
      for (let i = 1; i < sorted.length; i++) {
        const a = sorted[i - 1], b = sorted[i];
        if (a.valid_to == null || a.valid_to > b.valid_from) out.push(row("L10", k, "fail", { detail: `Overlap at ${b.valid_from}.` }));
      }
    }
    return out.length ? out : [row("L10", `${L.terms.length} terms`, "pass")];
  },

  L11(L) {
    if (!L.tax) return [row("L11", "tax", "skip", { detail: "Tax not derived." })];
    const rows = L.tax.ties.map((t) => row("L11", `${t.person} ${t.fy}`, t.status, { expected: money(t.lodged), actual: money(t.derived), gap_cents: t.gap, detail: t.detail }));
    for (const t of L.tax.labelTies || []) if (t.bad) rows.push(row("L11", `${t.person} ${t.fy} labels`, "fail", { gap_cents: t.worst.gap, detail: `${t.bad} of ${t.labels} labels differ; widest is ${t.worst.label}.` }));
    return rows;
  },

  L12(L) {
    const out = [];
    for (const p of (L.periods || []).filter((x) => x.status === "locked" && x.seal_hash)) {
      const now = sealOf(L, p);
      if (now !== p.seal_hash) out.push(row("L12", p.period_id, "fail", { expected: p.seal_hash, actual: now, detail: "A locked period changed." }));
    }
    return out.length ? out : [row("L12", "periods", "pass")];
  },

  L13(L) {
    const rows = L.coverage || [];
    const gaps = rows.filter((r) => r.have < r.expected);
    return gaps.length ? gaps.map((r) => row("L13", r.stream_id, "gap", { expected: String(r.expected), actual: String(r.have), detail: `Missing ${r.missing.join(", ")}.` })) : [row("L13", `${rows.length} streams`, "pass")];
  },

  L14(L) {
    const out = [];
    for (const [account, series] of L.balances.table) {
      if (!account.startsWith("clearing:super:")) continue;
      const last = L.balances.months[L.balances.months.length - 1];
      const open = series.get(last) || 0;
      out.push(row("L14", account, Math.abs(open) > 2000000 ? "fail" : "pass", { gap_cents: open, detail: `Contributions on payslips not yet at the fund: ${money(open)}.` }));
    }
    return out.length ? out : [row("L14", "super", "skip")];
  },

  L15(L) {
    const cited = new Set(L.witnesses.map((w) => w.event_id));
    const bare = L.events.filter((e) => !cited.has(e.event_id) && e.rule !== "setup");
    const hashes = new Map(L.sources.map((s) => [s.source_id, s.sha256]));
    const noHash = L.observations.filter((o) => !hashes.get(o.source_id)).length;
    return [row("L15", "provenance", bare.length || noHash ? "fail" : "pass", { detail: bare.length || noHash ? `${bare.length} events with no witness, ${noHash} observations with no hashed source. ${bare.slice(0, 3).map((e) => e.kind).join(", ")}` : `${L.events.length} events cite evidence.` })];
  },

  L16(L) {
    if (!L.tax || !L.tax.caps) return [row("L16", "caps", "skip")];
    return L.tax.caps.map((c) => row("L16", `${c.person} ${c.fy} ${c.cap}`, c.used > c.limit ? "open" : "pass", { expected: money(c.limit), actual: money(c.used) }));
  },

  L17(L) {
    const out = [];
    for (const d of L.decisions) if (d.status === "accepted" && !L.decisionBound(d)) out.push(row("L17", d.decision_id, "fail", { detail: `Target ${d.target_type} ${d.target_ref} no longer exists. Sent to review.` }));
    return out.length ? out : [row("L17", `${L.decisions.length} decisions`, "pass")];
  },

  L18(L) {
    const wrappers = L.parties.filter((p) => ["smsf", "trust", "company"].includes(p.kind));
    return [row("L18", "one level", wrappers.length ? "pass" : "skip", { detail: wrappers.length ? `${wrappers.length} wrappers held as one value each.` : "No wrappers." })];
  },

  L20(L) {
    const out = [];
    for (const [subject, rows] of groupBy(L.observations.filter((o) => o.kind === "valuation" && o.status === "active"), (o) => o.payload.subject_ref)) {
      const sorted = [...rows].sort((a, b) => cmp(a.payload.as_at, b.payload.as_at));
      for (let i = 1; i < sorted.length; i++) {
        const a = sorted[i - 1].payload, b = sorted[i].payload;
        if (!a.value_cents || !b.value_cents) continue;
        const ratio = b.value_cents / a.value_cents;
        if (ratio > 2 || ratio < 0.5) out.push(row("L20", subject, "open", { expected: money(a.value_cents), actual: money(b.value_cents), detail: `Value moved ${ratio.toFixed(1)}x between ${a.as_at} and ${b.as_at}. Typo?` }));
      }
    }
    return out.length ? out : [row("L20", "valuations", "pass")];
  },

  // Net sales on the year's activity statements against business income on the return. A question, not conservation.
  L19(L) {
    const stmts = (L.resolverObs && L.resolverObs.get("activity_statement")) || [];
    const withSales = stmts.filter((o) => o.payload.g1_cents != null);
    if (!withSales.length) return [row("L19", "bas", "skip", { detail: "No activity statement states sales." })];
    const out = [];
    for (const [k, rows] of groupBy(withSales, (o) => { const p = o.payload; return `${p.person_ref}|${fyOf(p.period_end)}`; })) {
      const [person, fy] = k.split("|");
      const net = rows.reduce((s, o) => s + o.payload.g1_cents - (o.payload.g1_includes_gst ? o.payload.gst_collected_cents || 0 : 0), 0);
      const ret = (L.returns ? L.returns.returns : []).filter((r) => r.fy === fy).sort((a, b) => b.version - a.version).find((r) => String(r.party_id).toLowerCase() === String(person).toLowerCase());
      const line = ret && L.returns.lines.find((l) => l.return_id === ret.return_id && (l.section === "business" || l.label === "P8"));
      if (!line) { out.push(row("L19", `${person} ${fy}`, "skip", { detail: "No lodged business income to compare with." })); continue; }
      const gap = net - line.amount_cents;
      out.push(row("L19", `${person} ${fy}`, Math.abs(gap) <= 10000 ? "pass" : "open", { expected: money(line.amount_cents), actual: money(net), gap_cents: gap, detail: Math.abs(gap) <= 10000 ? "Net sales tie." : "Net sales differ from business income. A return can hold non-sales income." }));
    }
    return out;
  },
};

function monthsDays(m) {
  const end = monthEnd(m); const out = [];
  for (let d = `${m}-01`; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

function sealOf(L, p) {
  const evs = L.events.filter((e) => e.occurred_on >= p.start_on && e.occurred_on <= p.end_on).map((e) => [e.event_id, e.kind, e.amount_cents, e.category_id]).sort((a, b) => cmp(a[0], b[0]));
  return hash64(stableStringify(evs));
}

function runLaws(L) {
  const out = [];
  for (const k of Object.keys(laws)) {
    const rows = laws[k](L);
    out.push(...rows);
  }
  return out;
}
module.exports = { runLaws, sealOf };
