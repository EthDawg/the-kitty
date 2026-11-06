/* The law by date, from standard/reference and nowhere else. Past the reference's coverage the last known row is used, and the read is recorded so truth can mark
   it assumed. A rate the reference does not hold never appears here: amounts it cannot supply are stated in the life script as invented. */
"use strict";
const path = require("path");
const { STD } = require("./std");

const ENGINE = require(path.join(STD, "reference", "au.json"));
const VERIFIED = require(path.join(STD, "reference", "au-verified.json"));
const COVERED_TO = "2027-07-01"; // au-verified.json: financial years 2018-19 to 2026-27

const lastOn = (ref, id, on) => {
  const rows = ref.series[id].rows.filter((r) => r.valid_from <= on).sort((a, b) => (a.valid_from < b.valid_from ? 1 : -1));
  return rows.find((r) => r.valid_to == null || on < r.valid_to) || rows[0] || ref.series[id].rows[0];
};

class Law {
  constructor() { this.assumed = {}; }
  read(ref, id, on) {
    const r = lastOn(ref, id, on);
    if (on >= COVERED_TO) { const a = this.assumed[id] = this.assumed[id] || { series: id, from: on, to: on, reason: "past the reference's coverage, last known row used" }; if (on < a.from) a.from = on; if (on > a.to) a.to = on; }
    return r.value;
  }
  brackets(on) { return this.read(ENGINE, "resident_tax_brackets", on); }
  incomeTax(on, dollars) {
    const b = this.brackets(on); let tax = 0;
    for (let i = 0; i < b.length; i++) { const lo = b[i].from, hi = i + 1 < b.length ? b[i + 1].from : Infinity; if (dollars > lo) tax += (Math.min(dollars, hi) - lo) * b[i].rate; }
    return Math.round(tax * 100);
  }
  lito(on, dollars) {
    const p = this.read(ENGINE, "lito", on); let v = p.max;
    for (const x of p.tiers || []) if (dollars > x.from) v -= (Math.min(dollars, x.to) - x.from) * x.rate;
    return Math.round(Math.max(v, 0) * 100);
  }
  medicare(on, dollars) { return Math.round(dollars * this.read(ENGINE, "medicare_levy_rate", on).rate * 100); }
  help(on, dollars) {
    const p = this.read(ENGINE, "help_repayment", on);
    if (p.marginal) { const m = p.marginal; if (dollars <= m.from) return 0; if (dollars >= m.top_from) return Math.round(dollars * m.top_rate * 100); return Math.round((dollars <= m.second_from ? (dollars - m.from) * m.rate : m.second_base + (dollars - m.second_from) * m.second_rate) * 100); }
    let r = 0; for (const b of p.bands || []) if (dollars >= b.from) r = b.rate;
    return Math.round(dollars * r * 100);
  }
  sg(on) { return this.read(ENGINE, "sg_rate", on).rate; }
  cgtDiscount(on) { return this.read(ENGINE, "cgt_discount_individual", on).rate; }
  helpIndex(on) { return this.read(VERIFIED, "help_indexation_rates", on).rate; }
  phiPct(on, tier) { return this.read(VERIFIED, "phi_rebate_percent", on).under_65[tier]; }
  phiTier(on, familyDollars, children) {
    const t = this.read(VERIFIED, "phi_rebate_income_tiers", on), lift = Math.max(0, children - 1) * t.per_child_increment_after_first, f = t.family;
    return familyDollars <= f.base_max + lift ? "base" : familyDollars <= f.tier1_max + lift ? "tier1" : familyDollars <= f.tier2_max + lift ? "tier2" : "tier3";
  }
  ccsPct(on, familyDollars) {
    const v = this.read(VERIFIED, "child_care_subsidy", on);
    for (const b of v.income_test) if (b.income_to == null || familyDollars < b.income_to) { if (!b.step) return b.rate_pct_from; return Math.max(0, b.rate_pct_from - Math.ceil((familyDollars - b.income_from) / b.step.per_dollars) * b.step.pp); }
    return 0;
  }
  cashRate(on) { return lastOn(VERIFIED, "rba_cash_rate_target", on).value; }
  cashKnownTo() { const r = VERIFIED.series.rba_cash_rate_target.rows; return r[r.length - 1].valid_from; }

  /* labels in, assessment out. Taxable income is whole dollars, label by label. */
  assess(fy, labels, x) {
    const on = `${fy}-06-30`, whole = (c) => Math.trunc(c / 100) * 100, get = (k) => labels[k] || 0;
    const income = ["1", "10", "11S", "11T", "11U", "12", "18A", "24"].reduce((s, k) => s + whole(get(k)), 0);
    const deductions = Object.keys(labels).filter((k) => /^D\d+$/.test(k)).reduce((s, k) => s + whole(labels[k]), 0);
    const taxable = Math.max(0, income - deductions), dollars = Math.round(taxable / 100);
    const gross = this.incomeTax(on, dollars), offsets = Math.min(gross, this.lito(on, dollars)), levy = this.medicare(on, dollars);
    const help = x.help_debt_cents > 0 ? Math.min(x.help_debt_cents, this.help(on, dollars + Math.round((x.add_back_cents || 0) / 100))) : 0;
    const credits = x.payg_cents, net = gross - offsets + levy + help;
    return { total_income_cents: income, deductions_cents: deductions, taxable_income_cents: taxable, gross_tax_cents: gross, offsets_cents: offsets, medicare_levy_cents: levy, help_cents: help, payg_credits_cents: credits, other_credits_cents: 0, result_cents: credits - net, tax_cents: net, assumed: on >= COVERED_TO };
  }
  /* A fortnight's PAYG, whole dollars, from the annual scale. A stand-in for the ATO's own withholding schedules, which the reference does not hold. */
  withhold(on, grossCents, opts = {}) {
    const annual = Math.round(grossCents * 26 / 100), dollars = Math.max(0, annual);
    let t = this.incomeTax(on, dollars) - Math.min(this.incomeTax(on, dollars), this.lito(on, dollars)) + this.medicare(on, dollars);
    if (opts.help) t += this.help(on, dollars);
    return Math.round(t / 26 / 100) * 100;
  }
  list() { return Object.values(this.assumed).sort((a, b) => (a.series < b.series ? -1 : 1)); }
}

module.exports = { Law, COVERED_TO };
