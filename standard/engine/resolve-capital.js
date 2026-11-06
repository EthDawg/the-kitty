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
      if (p.side === "sell") { this.recogniseSale(o, assetId, asset); continue; }
      (this.propertyLog = this.propertyLog || []).push({ kind: "buy", date: p.settled_on, asset: assetId, account: asset.account_id, price: p.price_cents, incidental: nz(p.duty_cents) + nz(p.legal_cents) + nz(p.other_costs_cents) + nz(p.adjustments_cents), o });
      const cost = p.price_cents + nz(p.duty_cents) + nz(p.legal_cents) + nz(p.other_costs_cents) + nz(p.adjustments_cents);
      const loanDrawn = nz(p.loan_drawn_cents);
      const loan = p.loan_ref ? this.accountOf(o, p.loan_ref, p.settled_on) : null;
      this.capitalLoans = this.capitalLoans || new Map();
      if (loan) this.capitalLoans.set(loan, (this.capitalLoans.get(loan) || 0) + loanDrawn);
      this.event({ key: `asset_purchase|${assetId}|${p.settled_on}`, kind: "asset_purchase", occurred_on: p.settled_on, description: `Purchase, ${asset.name}`, asset_id: assetId, category_id: "CAPITAL", amount_cents: cost, grade: "stated", rule: "settlement",
        witnesses: this.docWitness(o), fields: { cost, loan_drawn: loanDrawn }, refs: { asset_account: asset.account_id, loan: loan || "clearing:asset:unknown", asset: assetId } });
      const want = p.cash_paid_cents;
      if (!want) continue;
      const pool = this.lines.filter((l) => !l.claimed && l.cents < 0 && Math.abs(daysBetween(p.settled_on, l.date)) <= 5)
        .sort((a, b) => a.cents - b.cents || cmp(a.key, b.key));
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
        if (k === "asset_disposal") {
          (this.sales = this.sales || []).push({ asset: asset.account_id, date: l.date, price: l.cents, o: l.witnesses[0] });
          this.event({ key: `asset_disposal|${asset.asset_id}|${l.key}`, kind: "asset_disposal", occurred_on: l.date, description: l.desc, asset_id: asset.asset_id, category_id: "CAPITAL", amount_cents: l.cents, grade: "stated", rule: "decision",
            witnesses: this.lineWitness(l), fields: { proceeds: l.cents, selling: 0, loan_payout: 0 }, refs: { asset_account: asset.account_id, loan: "clearing:asset:unknown", asset: asset.asset_id } });
          this.event({ key: `asset_payment|${l.key}`, kind: "asset_payment", occurred_on: l.date, description: l.desc, asset_id: asset.asset_id, category_id: "CAPITAL", amount_cents: l.cents, grade: "stated", rule: "decision",
            witnesses: this.lineWitness(l, "clears"), fields: { amount: -l.cents }, refs: { account: l.account, asset: asset.asset_id }, line: l });
        } else this.event({ key: `asset_purchase|${asset.asset_id}|${l.key}`, kind: "asset_purchase", occurred_on: l.date, description: l.desc, asset_id: asset.asset_id, category_id: "CAPITAL", amount_cents: -l.cents, grade: "stated", rule: "decision",
          witnesses: this.lineWitness(l), fields: { cost: -l.cents, loan_drawn: 0 }, refs: { asset_account: asset.account_id, loan: "clearing:asset:unknown", asset: asset.asset_id }, line: l, alsoPayment: true });
      }
    }
  };

  // Selling a property: proceeds leave the asset, the payout clears the loan, costs are costs, the rest reaches the bank.
  // The gain is a tax fact, written to lot_match. It never appears in the ledger as income.
  P.recogniseSale = function (o, assetId, asset) {
    const p = o.payload;
    const loan = p.loan_ref ? this.accountOf(o, p.loan_ref, p.settled_on) : null;
    const selling = nz(p.selling_costs_cents), payout = nz(p.loan_payout_cents);
    (this.sales = this.sales || []).push({ asset: asset.account_id, date: p.settled_on, price: p.price_cents, o });
    (this.propertyLog = this.propertyLog || []).push({ kind: "sell", date: p.settled_on, asset: assetId, account: asset.account_id, proceeds: p.price_cents, selling, o });
    this.event({ key: `asset_disposal|${assetId}|${p.settled_on}`, kind: "asset_disposal", occurred_on: p.settled_on, description: `Sale, ${asset.name}`, asset_id: assetId, category_id: "CAPITAL", amount_cents: p.price_cents, grade: "stated", rule: "settlement",
      witnesses: this.docWitness(o), fields: { proceeds: p.price_cents, selling, loan_payout: payout }, refs: { asset_account: asset.account_id, loan: loan || "clearing:asset:unknown", asset: assetId } });
    const want = p.cash_paid_cents != null ? Math.abs(p.cash_paid_cents) : p.price_cents - selling - payout;
    const l = this.lines.filter((x) => !x.claimed && x.cents === want && Math.abs(daysBetween(p.settled_on, x.date)) <= 5).sort((a, b) => cmp(a.key, b.key))[0];
    if (!l) { this.fault("settlement_unmatched", o, `Sale of ${p.settled_on} should reach the bank as ${want / 100}; no line matches.`, "", want); return; }
    this.claim(l, "asset_payment");
    this.event({ key: `asset_payment|${l.key}`, kind: "asset_payment", occurred_on: l.date, description: l.desc, asset_id: assetId, category_id: "CAPITAL", amount_cents: l.cents, grade: "corroborated", rule: "settlement+bank",
      witnesses: this.lineWitness(l, "clears"), fields: { amount: -l.cents }, refs: { account: l.account, asset: assetId }, line: l });
  };

  // A home that becomes a rental after 20 August 1996 takes its market value as cost base on the day it first earns income.
  // The fact is a valuation dated the change of use; the lot takes it. Nothing moves in the ledger.
  P.buildPropertyLots = function () {
    const lots = [], matches = [];
    const log = [...(this.propertyLog || [])].sort((a, b) => cmp(a.date, b.date));
    const useChanges = (assetId) => this.terms.filter((t) => t.subject_type === "asset" && t.subject_id === assetId && t.term === "use" && t.superseded_at == null).sort((a, b) => cmp(a.valid_from, b.valid_from));
    for (const t of log) {
      if (t.kind === "buy") {
        lots.push({ lot_id: `plot_${t.asset}`, asset_id: t.asset, account_id: t.account, acquired_on: t.date, units_open: 1n, units_bought: 1n, cost_known: true, cost_price_cents: t.price, cost_incidental_cents: t.incidental, cost_ownership_cents: 0, cost_capital_cents: 0, cost_adjustment_cents: 0, reset: null });
        continue;
      }
      const lot = lots.find((l) => l.asset_id === t.asset);
      if (!lot) { this.fault("sale_without_purchase", t.o, `Sale of ${t.asset} with no purchase held; cost base is unknown.`, "Add the purchase settlement."); matches.push({ event_ref: `asset_disposal|${t.asset}|${t.date}`, lot_id: `plot_${t.asset}`, asset_id: t.asset, disposed_on: t.date, units: "1", proceeds_cents: t.proceeds - t.selling, cost_base_cents: null, gain_cents: null, discount_eligible: true, method: "specific", fy: require("./util").fyOf(t.date) }); continue; }
      const uses = useChanges(t.asset);
      const fy = require("./util").fyOf(t.date);
      const proceeds = t.proceeds - t.selling;
      let base = lot.cost_price_cents + lot.cost_incidental_cents + lot.cost_capital_cents + lot.cost_adjustment_cents;
      let acquired = lot.acquired_on, reset = false;
      const firstRental = uses.find((u) => u.value === "rental");
      const homeBefore = uses.find((u) => u.value === "owner_occupied" && firstRental && u.valid_from < firstRental.valid_from);
      const base_match = { event_ref: `asset_disposal|${t.asset}|${t.date}`, lot_id: lot.lot_id, asset_id: t.asset, party_id: null, disposed_on: t.date, units: "1", proceeds_cents: proceeds, method: "specific", fy };
      if (firstRental && homeBefore) {
        const absent = this.term("asset", t.asset, "six_year_absence_from", t.date);
        if (absent && daysBetween(absent, t.date) <= 2191) { matches.push({ ...base_match, cost_base_cents: base, gain_cents: 0, exempt_cents: proceeds - base, discount_eligible: false, exempt: "main_residence_six_year" }); lot.units_open = 0n; continue; }
        const atChange = (this.byKind.get("valuation") || []).filter((o) => this.resolveValueSubject(o.payload.subject_ref, o.payload.as_at, o) === lot.account_id && o.payload.as_at === firstRental.valid_from)[0];
        if (atChange) { base = atChange.payload.value_cents; acquired = firstRental.valid_from; reset = true; lot.reset = { on: acquired, value: base }; }
        else this.fault("market_value_reset_missing", t.o, `${t.asset} became a rental on ${firstRental.valid_from}; a valuation dated that day is needed for its cost base.`, "Add the valuation.");
      }
      // Claimed capital works come off the base. A market-value reset starts that count again.
      const claimed = this.claimedWorks(t.asset, reset ? acquired : lot.acquired_on, t.date);
      base -= claimed;
      // Days as a home are exempt, by days. A dated use with a hole cannot give a share, so the gain is unknown, never a guess.
      const span = daysBetween(acquired, t.date);
      let homeDays = 0, covered = 0;
      for (const u of uses) {
        const from = u.valid_from > acquired ? u.valid_from : acquired, to = u.valid_to && u.valid_to < t.date ? u.valid_to : t.date;
        if (to <= from) continue;
        const n = daysBetween(from, to);
        covered += n;
        if (u.value === "owner_occupied") homeDays += n;
      }
      const raw = proceeds - base;
      if (homeDays && !reset && covered < span) {
        this.fault("use_timeline_gap", t.o, `${t.asset}'s use is not dated for its whole ownership; the exempt share of the gain cannot be worked out.`, "Date its use.", raw);
        matches.push({ ...base_match, cost_base_cents: base, gain_cents: null, exempt_cents: null, discount_eligible: true });
        lot.units_open = 0n; continue;
      }
      const exempt = !reset && homeDays && span ? Math.round(raw * homeDays / span) : 0;
      const y = +acquired.slice(0, 4) + 1;
      matches.push({ ...base_match, cost_base_cents: base, gain_cents: raw - exempt, exempt_cents: exempt, claimed_works_cents: claimed, discount_eligible: `${y}${acquired.slice(4)}` < t.date });
      lot.units_open = 0n;
    }
    return { lots, matches };
  };

  P.claimedWorks = function (assetId, from, to) {
    let total = 0;
    const startFy = require("./util").fyOf(from), endFy = require("./util").fyOf(to);
    for (const o of this.byKind.get("depreciation_schedule") || []) {
      const p = o.payload;
      const a = this.assets.has(p.asset_ref) ? p.asset_ref : this.alias("asset", p.asset_ref, p.issued_on);
      if (a !== assetId) continue;
      for (const it of p.items || []) if (String(it.division) === "43") for (const [fy, cents] of Object.entries(it.by_fy || {})) if (fy >= startFy && fy < endFy) total += cents;
    }
    return total;
  };

  P.recogniseSuper = function () {
    const lineMap = {
      employer: "super_contribution", salary_sacrifice: "super_contribution", personal_deductible: "super_personal", personal_after_tax: "super_personal", spouse: "super_personal",
      rollover_in: "super_rollover", rollover_out: "super_rollover", earnings: "super_earnings", fee: "super_cost", insurance: "super_cost", contributions_tax: "super_cost",
      pension: "super_withdrawal", withdrawal: "super_withdrawal", release: "super_release",
    };
    const costCat = { fee: "SUPER-FEES", insurance: "SUPER-INS", contributions_tax: "SUPER-TAX" };
    for (const l of this.superLines || []) {
      const kind = lineMap[l.lineType];
      if (!kind) { this.fault("unknown_super_line", l.key, `Super line type ${l.lineType} is not in the vocabulary.`); continue; }
      const amount = kind === "super_cost" || kind === "super_release" ? -l.cents : l.cents;
      const refs = { account: l.account, category: costCat[l.lineType], person: this.personOfAccount(l.account, l.date) };
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
    // A pension or lump sum leaving super moves no net worth, but it is what a retiree lives on: the bank line carries SUPER-PENSION.
    for (const e of this.events.filter((x) => x.kind === "super_withdrawal")) {
      const want = e.fields.amount;
      const account = e.refs.account;
      e.fields.amount = -want;                      // lines out of the fund are negative
      const l = this.lines.filter((x) => !x.claimed && x.cents === -want && Math.abs(daysBetween(x.date, e.occurred_on)) <= 5).sort((a, b) => Math.abs(daysBetween(a.date, e.occurred_on)) - Math.abs(daysBetween(b.date, e.occurred_on)) || cmp(a.key, b.key))[0];
      if (!l) { this.fault("super_payment_unmatched", e.key, `${this.accountName(account)} paid ${(-want) / 100} and no bank line matches.`, "", -want); continue; }
      this.claim(l, "super_receipt");
      this.event({ key: `super_receipt|${l.key}`, kind: "super_receipt", occurred_on: l.date, description: l.desc, merchant: l.cls.merchant, category_id: "SUPER-PENSION", person: e.person, amount_cents: l.cents, grade: "corroborated", rule: "fund+bank",
        witnesses: this.lineWitness(l, "clears"), fields: { amount: l.cents }, refs: { account: l.account, fund: account }, line: l });
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

  // Taxed this year, paid next: the statement recognises the entitlement, the bank line clears it whenever it comes.
  P.recogniseTrusts = function () {
    for (const o of this.collapseDocs("trust_statement")) {
      const p = o.payload;
      const person = this.partyOf(p.person_ref, p.period_end);
      const cash = this.accountOf(o, p.account_ref, p.period_end);
      const key = `trust_distribution|${person}|${p.trust_ref}|${p.fy}`;
      this.event({ key, kind: "trust_distribution", occurred_on: p.period_end, description: `Distribution, ${p.trust_ref}, ${p.fy}`, category_id: "TRUST-DIST", person, amount_cents: p.entitlement_cents, grade: "stated", rule: "trust_statement",
        witnesses: this.docWitness(o), fields: { amount: p.entitlement_cents }, refs: { cash_account: cash || "unassigned" } });
      const line = this.lines.filter((l) => !l.claimed && l.cents === p.entitlement_cents && l.date >= addDays(p.period_end, -120) && (!cash || l.account === cash)).sort((a, b) => cmp(a.date, b.date) || cmp(a.key, b.key))[0];
      if (line) {
        this.claim(line, "dividend_receipt");
        this.event({ key: `dividend_receipt|${line.key}`, kind: "dividend_receipt", occurred_on: line.date, description: line.desc, category_id: "TRUST-DIST", person, amount_cents: line.cents, grade: "corroborated", rule: "statement+bank", witnesses: this.lineWitness(line, "clears"), fields: { amount: line.cents }, refs: { account: cash || line.account }, line });
      }
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
      if (!m) { (this.unmatchedTax = this.unmatchedTax || []).push({ person, cents: want, o }); this.fault("tax_result_unmatched", o, `${p.fy} assessment for ${this.name(person)} shows ${want / 100} and no bank line matches.`, "Find the refund, or the payment. It may have gone to an old account.", want); continue; }
      const kind = want > 0 ? "tax_refund" : "tax_payment";
      this.claim(m, kind);
      this.event({ key: `${kind}|${m.key}`, kind, occurred_on: m.date, description: m.desc, category_id: "TAX-REFUND", person, amount_cents: Math.abs(want), grade: "corroborated", rule: "assessment+bank",
        witnesses: this.lineWitness(m, "clears"), fields: { amount: Math.abs(want) }, refs: { account: m.account, person }, line: m });
    }
    for (const o of this.collapseDocs("super_tax_notice")) {
      const p = o.payload; const person = this.partyOf(p.person_ref, p.assessed_on);
      this.event({ key: `div293_assessed|${person}|${p.fy}`, kind: "div293_assessed", occurred_on: p.assessed_on, description: `Division 293 assessment, ${p.fy}`, category_id: "SUPER-TAX", person, amount_cents: p.amount_cents, grade: "stated", rule: "super_tax_notice", witnesses: this.docWitness(o), fields: { amount: p.amount_cents }, refs: { person } });
      if (p.election === "release") continue;
      const m = this.lines.find((l) => !l.claimed && l.cents === -p.amount_cents && l.date >= p.assessed_on && l.date <= addDays(p.due_on || p.assessed_on, 60));
      if (m) { this.claim(m, "tax_payment"); this.event({ key: `tax_payment|${m.key}`, kind: "tax_payment", occurred_on: m.date, description: m.desc, category_id: "TAX-REFUND", person, amount_cents: p.amount_cents, grade: "corroborated", rule: "notice+bank", witnesses: this.lineWitness(m, "clears"), fields: { amount: p.amount_cents }, refs: { account: m.account, person }, line: m }); }
      else this.fault("tax_result_unmatched", o, `Division 293 of ${p.amount_cents / 100} for ${p.fy} has no payment.`, "It may be released from super instead.", p.amount_cents);
    }
    // One credit can settle two assessments. Look for a bank line equal to what is still unmatched for that person.
    for (const [person, rows] of groupBy(this.unmatchedTax || [], (x) => x.person)) {
      const want = rows.reduce((s, x) => s + x.cents, 0);
      if (rows.length < 2) continue;
      const m = this.lines.find((l) => !l.claimed && l.cents === want && /ATO|TAX/i.test(l.desc));
      if (!m) continue;
      const kind = want > 0 ? "tax_refund" : "tax_payment";
      this.claim(m, kind);
      this.review = this.review.filter((r) => !(r.kind === "tax_result_unmatched" && rows.some((x) => x.o.obs_id === r.ref)));
      this.event({ key: `${kind}|${m.key}`, kind, occurred_on: m.date, description: m.desc, category_id: "TAX-REFUND", person, amount_cents: Math.abs(want), grade: "corroborated", rule: "assessments+bank", witnesses: this.lineWitness(m, "clears"), fields: { amount: Math.abs(want) }, refs: { account: m.account, person }, line: m });
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
      if (!date || !Number.isInteger(cents)) return;
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
    // A snapshot account's stated balance is its balance; the movement between statements is graded stated.
    for (const o of this.byKind.get("balance") || []) {
      const p = o.payload;
      const a = this.accountOf(o, p.account_ref, p.as_at);
      if (!a || (this.accounts.get(a) || {}).fidelity !== "snapshot") continue;
      if (!valued.has(a)) valued.set(a, new Map());
      valued.get(a).set(p.as_at, { cents: p.balance_cents, o });
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
    // A sale sets the value on the day. Anything left in the book moves through revaluation first.
    for (const s of this.sales || []) {
      if (!valued.has(s.asset)) valued.set(s.asset, new Map());
      valued.get(s.asset).set(s.date, { cents: s.price, o: s.o, saleDay: true });
    }
    for (const [account, rows] of valued) {
      const flows = (deltas.get(account) || []).sort((a, b) => cmp(a.date, b.date));
      let book = 0, i = 0;
      for (const d of [...rows.keys()].sort()) {
        const v = rows.get(d);
        if (v.after) { book = 0; while (i < flows.length && flows[i].date <= d) i += 1; continue; }
        while (i < flows.length && (v.saleDay ? flows[i].date < d : flows[i].date <= d)) { book += flows[i].cents; i += 1; }
        const amount = v.cents - book;
        if (amount) {
          const e = this.event({ key: `revaluation|${account}|${d}`, kind: "revaluation", occurred_on: d, description: `Revaluation, ${this.accountName(account)}`, amount_cents: amount, grade: "stated", rule: "valuation",
            witnesses: v.o ? this.w(v.o, v.saleDay ? "control" : "recognises") : [], fields: { amount }, refs: { account } });
          e.postings = post(e, schema);
          book = v.cents;
        }
      }
    }
    this.propertyLots = this.buildPropertyLots();
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
