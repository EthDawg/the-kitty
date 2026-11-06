/* A tiny way to write a whole household by hand. Each fixture is a small life, written as observations, with the
   truth stated beside it. These prove the model tells the truth; they do not exercise file reading. */
"use strict";
const CATS = [
  ["SALARY", "income", 1, 1], ["SALARY-ALLOW", "income", 0, 1], ["REIMBURSE", "pass_through", 0, 1], ["SUPER-EMPLOYER", "income", 0, 1], ["SUPER-SACRIFICE", "income", 0, 1], ["PAYROLL-DED", "expense", 0, 1],
  ["INTEREST", "income", 1, 1], ["DIVIDEND", "income", 1, 1], ["TRUST-DIST", "income", 1, 1], ["RENT-INC", "income", 1, 1], ["ESS-INCOME", "income", 0, 1], ["CRYPTO-INCOME", "income", 0, 1], ["GIFT-IN", "income", 0, 1], ["SUPER-PENSION", "income", 1, 0], ["SUPER-EARN", "income", 0, 1],
  ["BUSINESS-INC", "income", 1, 1], ["TAX-REFUND", "transfer", 0, 0], ["INCOME-TAX", "expense", 0, 1], ["HELP-INDEX", "expense", 0, 1],
  ["MORTGAGE", "expense", 1, 0], ["HOME-INT", "expense", 0, 1], ["RENT-INT", "expense", 1, 1], ["RENT-MGMT", "expense", 1, 1], ["RENT-REPAIR", "expense", 1, 1], ["RENT-OTHER", "expense", 1, 1],
  ["SUPER-FEES", "expense", 0, 1], ["SUPER-INS", "expense", 0, 1], ["SUPER-TAX", "expense", 0, 1], ["FEES", "expense", 1, 1], ["GROCERIES", "expense", 1, 1], ["SUBS", "expense", 1, 1], ["SHOPPING", "expense", 1, 1], ["HOUSING", "expense", 1, 1], ["CAPITAL", "capital", 0, 0], ["PASS-THROUGH", "pass_through", 0, 0], ["TRANSFER", "transfer", 0, 0], ["CC-PAY", "transfer", 0, 0], ["UNCAT", "suspense", 1, 1],
];
function household(name) {
  const h = {
    name, setup: { household: [{ household_id: name, name, jurisdiction: "AU", base_currency: "AUD", fy_start_month: 7, timezone: "Australia/Melbourne", standard_version: "household-standard/1" }], party: [], membership: [], account: [], alias: [], ownership: [], asset: [], contract: [], term: [], stream: [], link: [], activity: [], scope: [], instrument: [], tax_map: [], budget: [], period: [],
      category: CATS.map(([category_id, kind, cash, accrual]) => ({ category_id, name: category_id, kind, cash_lens: !!cash, economic_lens: !!accrual })) },
    sources: [{ source_id: "s1", sha256: "fixture", name: `${name}.json`, origin: "manual", captured_at: "2020-01-01T00:00:00Z", status: "active" }], observations: [], decisions: [], rules: [], n: 0,
    person(id, name_) { this.setup.party.push({ party_id: id, kind: "person", name: name_ || id }); this.setup.membership.push({ party_id: id, role: "adult", valid_from: "2000-01-01", valid_to: null }); return this; },
    org(id, kind = "organisation") { this.setup.party.push({ party_id: id, kind, name: id }); return this; },
    account(id, type, group, owners, extra = {}) {
      const cls = ["credit_card", "loan", "help_debt"].includes(type) ? "liability" : "asset";
      this.setup.account.push({ account_id: id, name: id, class: cls, type, reporting_group: group, currency: "AUD", ...extra });
      for (const [party, bps, from = "2000-01-01", to = null] of owners) for (const basis of ["legal", "beneficial", "tax"]) this.setup.ownership.push({ subject_type: "account", subject_id: id, party_id: party, basis, share_bps: bps, valid_from: from, valid_to: to, recorded_at: `${from}T00:00:00Z`, superseded_at: null });
      return this;
    },
    obs(kind, payload, amount) { this.n += 1; const obs_id = `o${this.n}`; this.observations.push({ obs_id, source_id: "s1", locator: `row ${this.n}`, kind, occurred_on: null, amount_cents: amount ?? null, payload, importer: "fixture", confidence: "1", status: "active" }); return obs_id; },
    line(account, date, description, cents, balance) { this.obs("txn_line", { account_ref: account, posting_date: date, description, amount_cents: cents, balance_after_cents: balance }); return this; },
    rule(pattern, category_id, extra = {}) { this.rules.push({ rule_id: `r${this.rules.length}`, pattern, match: "contains", category_id, provenance: "fixture", ...extra }); return this; },
    term(subject_type, subject_id, term, value, valid_from, valid_to = null) { this.setup.term.push({ term_id: `t${this.setup.term.length}`, subject_type, subject_id, term, value: String(value), valid_from, valid_to, recorded_at: `${valid_from}T00:00:00Z`, superseded_at: null }); return this; },
    scope(subject_type, subject_id, domain, state) { this.setup.scope.push({ subject_type, subject_id, domain, state, by: "person", valid_from: "2000-01-01" }); return this; },
  };
  return h;
}
module.exports = { household };
