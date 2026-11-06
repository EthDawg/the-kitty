/* Capital events, super, tax settlement, opening balances and revaluation. Added to Resolver as methods. */
"use strict";
const { groupBy, cmp, addDays, daysBetween, monthOf } = require("./util");
const { activeOn } = require("./temporal");

const nz = (v) => (v == null ? 0 : v);

module.exports = (Resolver) => {
  const P = Resolver.prototype;

  // A settlement statement recognises the purchase. The cash lines clear it. Duty and legal are cost base, never spending.
  P.recogniseCapital = function () {
    for (const o of this.collapseDocs("settlement")) {
      const p = o.payload;
      const assetId = this.assets.has(p.asset_ref) ? p.asset_ref : this.alias("asset", p.asset_ref, p.settled_on);
      if (!assetId) { this.fault("unresolved_asset", o, `No asset for ${p.asset_ref}.`); continue; }
      const asset = this.assets.get(assetId);
      const cost = p.price_cents + nz(p.duty_cents) + nz(p.legal_cents) + nz(p.other_costs_cents) + nz(p.adjustments_cents);
      const loanDrawn = nz(p.loan_drawn_cents);
      const loan = p.loan_ref ? this.accountOf(o, p.loan_ref, p.settled_on) : null;
      this.capitalLoans = this.capitalLoans || new Map();
      if (loan) this.capitalLoans.set(loan, (this.capitalLoans.get(loan) || 0) + loanDrawn);
      this.event({ key: `asset_purchase|${assetId}|${p.settled_on}`, kind: "asset_purchase", occurred_on: p.settled_on, description: `Purchase, ${asset.name}`, asset_id: assetId, category_id: "CAPITAL", amount_cents: cost, grade: "stated", rule: "settlement",
        witnesses: this.docWitness(o), fields: { cost, loan_drawn: loanDrawn }, refs: { asset_account: asset.account_id, loan: loan || "clearing:asset:unknown", asset: assetId } });
      const want = p.cash_paid_cents;
      if (!want) continue;
      const pool = this.lines.filter((l) => !l.claimed && l.cents < 0 && Math.abs(daysBetween(p.settled_on, l.date)) <= 5 && (l.cls.category_id == null || l.cls.category_id === "UNCAT" || this.catKind(l.cls.category_id) === "capital"))
        .sort((a, b) => cmp(a.key, b.key));
      const hit = subsetSum(pool, want);
      if (!hit) { this.fault("settlement_unmatched", o, `Settlement of ${p.settled_on} paid ${want / 100} in cash and no bank lines add to it.`, "Mark which lines paid for this.", want); continue; }
      for (const l of hit) {
        this.claim(l, "asset_payment");
        this.event({ key: `asset_payment|${l.key}`, kind: "asset_payment", occurred_on: l.date, description: l.desc, merchant: l.cls.merchant, asset_id: assetId, category_id: "CAPITAL", amount_cents: -l.cents, grade: "corroborated", rule: "settlement+bank",
          witnesses: this.lineWitness(l, "clears"), fields: { amount: -l.cents }, refs: { account: l.account, asset: assetId }, line: l });
      }
    }
    // A person can say a line bought or sold an asset; the sale of a car is not income.
    for (const l of this.lines) {
      if (l.claimed) continue;
      const k = l.cls.event_kind;
      if (k === "asset_disposal" || k === "asset_purchase") {
        const assetId = l.cls.asset_id || l.cls.asset;
        const asset = this.assets.get(assetId);
        if (!asset) { this.fault("unresolved_asset", l.key, `Decision on ${l.desc} names no known asset.`); continue; }
        this.claim(l, k);
        if (k === "asset_disposal") this.disposals = (this.disposals || []).concat([{ line: l, asset }]);
        else this.event({ key: `asset_purchase|${asset.asset_id}|${l.key}`, kind: "asset_purchase", occurred_on: l.date, description: l.desc, asset_id: asset.asset_id, category_id: "CAPITAL", amount_cents: -l.cents, grade: "stated", rule: "decision",
          witnesses: this.lineWitness(l), fields: { cost: -l.cents, loan_drawn: 0 }, refs: { asset_account: asset.account_id, loan: "clearing:asset:unknown", asset: asset.asset_id }, line: l, alsoPayment: true });
      }
    }
  };

  P.recogniseSuper = function () {
    const lineMap = {
      employer: "super_contribution", salary_sacrifice: "super_contribution", personal_deductible: "super_personal", personal_after_tax: "super_personal", spouse: "super_personal",
      rollover_in: "super_rollover", rollover_out: "super_rollover", earnings: "super_earnings", fee: "super_cost", insurance: "super_cost", contributions_tax: "super_cost",
      pension: "super_withdrawal", withdrawal: "super_withdrawal",
    };
    const costCat = { fee: "SUPER-FEES", insurance: "SUPER-INS", contributions_tax: "SUPER-TAX" };
    for (const l of this.superLines || []) {
      const kind = lineMap[l.lineType];
      if (!kind) { this.fault("unknown_super_line", l.key, `Super line type ${l.lineType} is not in the vocabulary.`); continue; }
      const amount = kind === "super_cost" ? -l.cents : l.cents;
      const refs = { account: l.account, category: costCat[l.lineType] };
      const cat = costCat[l.lineType] || (kind === "super_earnings" ? "SUPER-EARN" : null);
      const ev = this.event({ key: `${kind}|${l.key}`, kind, occurred_on: l.date, description: l.desc, category_id: cat, person: this.personOfAccount(l.account, l.date), amount_cents: l.cents, grade: l.balanceAfter != null ? "reconciled" : "stated", rule: "super_line",
        witnesses: this.lineWitness(l), fields: { amount }, refs, superType: l.lineType });
      if (kind === "super_personal") {
        const m = this.lines.find((x) => !x.claimed && x.cents === -l.cents && Math.abs(daysBetween(x.date, l.date)) <= 7);
        if (m) {
          this.claim(m, "super_personal_paid");
          this.event({ key: `open_transfer|${m.key}`, kind: "open_transfer", occurred_on: m.date, description: m.desc, category_id: "TRANSFER", amount_cents: m.cents, grade: "corroborated", rule: "super+bank", witnesses: this.lineWitness(m, "clears"), fields: { amount: m.cents }, refs: { account: m.account }, line: m });
        } else this.fault("super_contribution_unpaid", l.key, `A personal contribution of ${l.cents / 100} has no bank line.`, "", l.cents);
      }
    }
    // A fund that gave only a statement: recognise from its totals.
    const covered = new Set((this.superLines || []).map((l) => `${l.account}|${monthOf(l.date)}`));
    for (const o of this.collapseDocs("super_statement")) {
      const p = o.payload;
      const account = this.accountOf(o, p.account_ref, p.period_end);
      if (!account || covered.has(`${account}|${monthOf(p.period_end)}`)) continue;
      const add = (kind, amount, category, type) => {
        if (!amount) return;
        this.event({ key: `${kind}|${account}|${p.period_end}|${type}`, kind, occurred_on: p.period_end, description: `${type}, ${this.accountName(account)}`, category_id: category, person: this.personOfAccount(account, p.period_end), amount_cents: amount, grade: "stated", rule: "super_statement",
          witnesses: this.docWitness(o), fields: { amount }, refs: { account, category }, superType: type });
      };
      add("super_contribution", nz(p.employer_cents), null, "employer");
      add("super_contribution", nz(p.salary_sacrifice_cents), null, "salary_sacrifice");
      add("super_earnings", nz(p.earnings_cents), "SUPER-EARN", "earnings");
      add("super_cost", nz(p.fees_cents), "SUPER-FEES", "fee");
      add("super_cost", nz(p.insurance_cents), "SUPER-INS", "insurance");
      add("super_cost", nz(p.tax_cents), "SUPER-TAX", "contributions_tax");
    }
  };

  // Assessment, refund and instalments are one money seen several ways. ato:{person} is the account they meet in.
  P.recogniseTax = function () {
    const assessments = this.collapseDocs("tax_assessment");
    const latest = new Map();
    for (const o of assessments) {
      const p = o.payload;
      const person = this.partyOf(p.person_ref, p.assessed_on);
      const key = `${person}|${p.fy}`;
      const prior = latest.get(key);
      const priorResult = prior ? prior.payload.result_cents : 0;
      const delta = p.result_cents - priorResult;      // an amendment moves the account by the change only
      const payg = prior ? 0 : p.payg_credits_cents;
      const netTax = payg - delta;
      const help = nz(p.help_cents) - (prior ? nz(prior.payload.help_cents) : 0);
      const helpAccount = (this.ctx.setup.account || []).find((a) => a.type === "help_debt" && this.ownersOf("account", a.account_id, p.assessed_on).some((x) => x.party_id === person));
      this.event({ key: `tax_assessed|${person}|${p.fy}|${p.version}`, kind: "tax_assessed", occurred_on: p.assessed_on, description: `${p.fy} assessment v${p.version}`, category_id: "INCOME-TAX", person, amount_cents: netTax, grade: "stated", rule: "tax_assessment",
        witnesses: this.docWitness(o), fields: { net_tax: netTax, help: helpAccount ? help : 0 }, refs: { person, help_account: helpAccount ? helpAccount.account_id : "clearing:help" } });
      latest.set(key, o);
      const want = delta;
      if (!want) continue;
      const m = this.lines.filter((l) => !l.claimed && l.cents === want && l.date >= addDays(p.assessed_on, -10) && l.date <= addDays(p.assessed_on, 60))
        .sort((a, b) => Math.abs(daysBetween(p.assessed_on, a.date)) - Math.abs(daysBetween(p.assessed_on, b.date)) || cmp(a.key, b.key))[0];
      if (!m) { this.fault("tax_result_unmatched", o, `${p.fy} assessment for ${this.name(person)} shows ${want / 100} and no bank line matches.`, "Find the refund, or the payment. It may have gone to an old account.", want); continue; }
      const kind = want > 0 ? "tax_refund" : "tax_payment";
      this.claim(m, kind);
      this.event({ key: `${kind}|${m.key}`, kind, occurred_on: m.date, description: m.desc, category_id: "TAX-REFUND", person, amount_cents: Math.abs(want), grade: "corroborated", rule: "assessment+bank",
        witnesses: this.lineWitness(m, "clears"), fields: { amount: Math.abs(want) }, refs: { account: m.account, person }, line: m });
    }
    // HELP indexation lands on the debt, not on any bank line.
    for (const o of this.byKind.get("help_balance") || []) {
      const p = o.payload;
      if (!p.indexation_cents) continue;
      const person = this.partyOf(p.person_ref, p.as_at);
      const acct = (this.ctx.setup.account || []).find((a) => a.type === "help_debt" && this.ownersOf("account", a.account_id, p.as_at).some((x) => x.party_id === person));
      if (!acct) continue;
      this.event({ key: `help_indexation|${person}|${p.as_at}`, kind: "help_indexation", occurred_on: p.as_at, description: "HELP indexation", category_id: "HELP-INDEX", person, amount_cents: p.indexation_cents, grade: "stated", rule: "help_balance",
        witnesses: this.w(o, "recognises"), fields: { amount: p.indexation_cents }, refs: { account: acct.account_id } });
    }
  };

  // Openings come from what an account's first evidence says it started at, less what the ledger already explains.
  P.finishOpenings = function () {
    const firstStated = new Map();
    const note = (account, date, cents, o) => {
      const cur = firstStated.get(account);
      if (!cur || date < cur.date) firstStated.set(account, { date, cents, o });
    };
    for (const o of this.collapseDocs("loan_statement")) {
      const p = o.payload; const a = this.accountOf(o, p.account_ref, p.period_end);
      if (a) note(a, p.period_start, -p.opening_cents, o);
    }
    for (const o of this.collapseDocs("statement")) {
      const p = o.payload; const a = this.accountOf(o, p.account_ref, p.period_end);
      if (a) note(a, p.period_start, p.opening_cents, o);
    }
    for (const o of this.collapseDocs("super_statement")) {
      const p = o.payload; const a = this.accountOf(o, p.account_ref, p.period_end);
      if (a) note(a, p.period_start, p.opening_cents, o);
    }
    for (const a of this.ctx.setup.account || []) {
      if (a.class !== "asset" && a.class !== "liability") continue;
      if (a.opening_balance_cents != null) { const d = a.opening_date || a.opened_on; if (d) { const cur = firstStated.get(a.account_id); if (!cur || d <= cur.date) firstStated.set(a.account_id, { date: d, cents: a.opening_balance_cents, setup: true }); } }
    }
    // A line that carries its running balance also tells us where the account stood before it.
    for (const [account, lines] of this.linesByAccount) {
      const first = [...lines].sort((a, b) => cmp(a.date, b.date) || a.seq - b.seq)[0];
      if (first && first.balanceAfter != null) {
        const day = lines.filter((l) => l.date === first.date);
        if (day.length === 1) note(account, first.date, first.balanceAfter - first.cents, first.witnesses[0]);
      }
    }
    for (const [account, s] of firstStated) {
      const before = (this.capitalLoans && this.capitalLoans.get(account)) ? -this.capitalLoans.get(account) : 0;
      const amount = s.cents - before;
      if (!amount) continue;
      this.event({ key: `opening|${account}`, kind: "opening_balance", occurred_on: addDays(s.date, -1), description: `Opening, ${this.accountName(account)}`, amount_cents: amount, grade: "stated", rule: s.setup ? "setup" : "first_evidence",
        witnesses: s.o ? this.w(s.o, "corroborates") : [], fields: { amount }, refs: { account } });
    }
  };

  /* Accounts carried at a value move to each dated value through a revaluation event, so net worth explains itself.
     Revaluation runs last: it needs every other posting to know the book balance on the day. */
  P.revalue = function () {
    const { post } = require("./post");
    const valued = new Map();
    for (const o of this.byKind.get("valuation") || []) {
      const p = o.payload;
      const a = this.resolveValueSubject(p.subject_ref, p.as_at, o);
      if (!a) continue;
      if (!valued.has(a)) valued.set(a, new Map());
      const cur = valued.get(a).get(p.as_at);
      if (!cur || Number(o.confidence) >= Number(cur.o.confidence)) valued.get(a).set(p.as_at, { cents: p.value_cents, o });
    }
    for (const [a, rows] of this.holdingValues ? this.holdingValues() : []) {
      if (!valued.has(a)) valued.set(a, new Map());
      for (const [d, v] of rows) if (!valued.get(a).has(d)) valued.get(a).set(d, v);
    }
    const schema = this.ctx.eventSchema;
    const deltas = new Map();
    for (const e of this.events) {
      e.postings = post(e, schema);
      for (const p of e.postings) if (p.account_id && valued.has(p.account_id)) {
        if (!deltas.has(p.account_id)) deltas.set(p.account_id, []);
        deltas.get(p.account_id).push({ date: e.occurred_on, cents: p.amount_cents });
      }
    }
    // A disposal carries the book value on the day it left.
    for (const d of this.disposals || []) {
      const a = d.asset.account_id;
      const book = [...(deltas.get(a) || [])].filter((x) => x.date <= d.line.date).reduce((s, x) => s + x.cents, 0);
      const stated = this.lastValueBefore(valued.get(a), d.line.date);
      const value = stated != null ? stated : book;
      const e = this.event({ key: `asset_disposal|${d.asset.asset_id}|${d.line.key}`, kind: "asset_disposal", occurred_on: d.line.date, description: d.line.desc, asset_id: d.asset.asset_id, category_id: "CAPITAL", amount_cents: d.line.cents, grade: "stated", rule: "decision",
        witnesses: this.lineWitness(d.line), fields: { proceeds: d.line.cents, book: value }, refs: { account: d.line.account, asset_account: a }, line: d.line });
      e.postings = post(e, schema);
      if (valued.has(a)) valued.get(a).set(d.line.date, { cents: 0, o: d.line.witnesses[0], after: true });
      void book;
    }
    for (const [account, rows] of valued) {
      const flows = (deltas.get(account) || []).sort((a, b) => cmp(a.date, b.date));
      let book = 0, i = 0;
      for (const d of [...rows.keys()].sort()) {
        const v = rows.get(d);
        if (v.after) { book = 0; while (i < flows.length && flows[i].date <= d) i += 1; continue; }
        while (i < flows.length && flows[i].date <= d) { book += flows[i].cents; i += 1; }
        const amount = v.cents - book;
        if (amount) {
          const e = this.event({ key: `revaluation|${account}|${d}`, kind: "revaluation", occurred_on: d, description: `Revaluation, ${this.accountName(account)}`, amount_cents: amount, grade: "stated", rule: "valuation",
            witnesses: v.o ? this.w(v.o, "recognises") : [], fields: { amount }, refs: { account } });
          e.postings = post(e, schema);
          book = v.cents;
        }
      }
    }
  };
  P.lastValueBefore = function (rows, date) {
    if (!rows) return null;
    const ds = [...rows.keys()].filter((d) => d <= date).sort();
    return ds.length ? rows.get(ds[ds.length - 1]).cents : null;
  };
  P.resolveValueSubject = function (ref, on, o) {
    if (this.accounts.has(ref)) return ref;
    const a = this.alias("account", ref, on);
    if (a) return a;
    const asset = this.assets.has(ref) ? ref : this.alias("asset", ref, on);
    if (asset && this.assets.get(asset).account_id) return this.assets.get(asset).account_id;
    this.fault("unresolved_value_subject", o, `No account for valuation of ${ref}.`);
    return null;
  };
};

function subsetSum(lines, target) {
  const items = lines.slice(0, 16);
  const n = items.length;
  for (let mask = 1; mask < 1 << n; mask++) {
    let s = 0;
    for (let i = 0; i < n; i++) if (mask & (1 << i)) s -= items[i].cents;
    if (s === target) return items.filter((_, i) => mask & (1 << i));
  }
  return null;
}
