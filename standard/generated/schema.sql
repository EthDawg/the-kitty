-- Generated from standard/schema. Do not edit.
-- household-standard/1. Money is integer cents; units and rates are decimal text, never floats.

-- setup, static. The unit this bundle describes.
CREATE TABLE "household" (
  "household_id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "jurisdiction" TEXT NOT NULL CHECK ("jurisdiction" IN ('AU')),
  "base_currency" TEXT NOT NULL,
  "fy_start_month" INTEGER NOT NULL,
  "timezone" TEXT NOT NULL,
  "standard_version" TEXT NOT NULL,
  "budget_date" TEXT CHECK ("budget_date" IN ('charged', 'posted'))
);

-- setup, static. Anyone or anything that can own, owe, pay, employ, insure or be paid. Tax file numbers and passwords never enter this table.
CREATE TABLE "party" (
  "party_id" TEXT PRIMARY KEY,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('person', 'organisation', 'government', 'trust', 'smsf', 'company', 'partnership')),
  "name" TEXT NOT NULL,
  "legal_name" TEXT,
  "birth_date" TEXT,
  "abn" TEXT,
  "note" TEXT
);

-- setup, bitemporal. A party belonging to the household for a dated range, so a baby arrives and past views stay right.
CREATE TABLE "membership" (
  "party_id" TEXT NOT NULL,
  "role" TEXT NOT NULL CHECK ("role" IN ('adult', 'dependant', 'relative', 'other')),
  "valid_from" TEXT NOT NULL,
  "valid_to" TEXT,
  "note" TEXT,
  "recorded_at" TEXT,
  "superseded_at" TEXT
);

-- setup, static. Anything with a balance. A balance is never stored; it is the sum of postings, checked against stated balances.
CREATE TABLE "account" (
  "account_id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "class" TEXT NOT NULL CHECK ("class" IN ('asset', 'liability', 'clearing', 'equity', 'memo')),
  "type" TEXT NOT NULL CHECK ("type" IN ('transaction', 'offset', 'savings', 'credit_card', 'loan', 'super', 'smsf', 'brokerage', 'holding', 'ess_plan', 'wallet', 'help_debt', 'tax_position', 'property', 'vehicle', 'device', 'receivable', 'clearing', 'equity', 'memo')),
  "reporting_group" TEXT NOT NULL CHECK ("reporting_group" IN ('cash', 'property', 'super', 'shares', 'crypto', 'vehicle', 'device', 'loans', 'tax', 'clearing', 'equity', 'memo')),
  "currency" TEXT NOT NULL,
  "institution_party_id" TEXT,
  "parent_account_id" TEXT,
  "successor_account_id" TEXT,
  "asset_id" TEXT,
  "contract_id" TEXT,
  "opened_on" TEXT,
  "closed_on" TEXT,
  "liquid" INTEGER,
  "in_scope" INTEGER,
  "fidelity" TEXT CHECK ("fidelity" IN ('ledger', 'snapshot')),
  "opening_balance_cents" INTEGER,
  "opening_date" TEXT,
  "note" TEXT
);

-- setup, bitemporal. An outside identifier for an inside thing, for a dated range. Files resolve to entities here, never by file name.
CREATE TABLE "alias" (
  "subject_type" TEXT NOT NULL CHECK ("subject_type" IN ('account', 'party', 'contract', 'instrument', 'asset')),
  "subject_id" TEXT NOT NULL,
  "scheme" TEXT NOT NULL CHECK ("scheme" IN ('account_number', 'card_last4', 'loan_number', 'member_number', 'owner_ref', 'payroll_id', 'hin', 'wallet_address', 'policy_number', 'merchant_string', 'name')),
  "value" TEXT NOT NULL,
  "valid_from" TEXT NOT NULL,
  "valid_to" TEXT,
  "recorded_at" TEXT,
  "superseded_at" TEXT
);

-- setup, bitemporal. Dated fractional ownership. Shares sum to 10000 per subject, basis and day.
CREATE TABLE "ownership" (
  "subject_type" TEXT NOT NULL CHECK ("subject_type" IN ('account', 'asset', 'contract')),
  "subject_id" TEXT NOT NULL,
  "party_id" TEXT NOT NULL,
  "basis" TEXT NOT NULL CHECK ("basis" IN ('legal', 'beneficial', 'tax')),
  "share_bps" INTEGER NOT NULL,
  "valid_from" TEXT NOT NULL,
  "valid_to" TEXT,
  "recorded_at" TEXT NOT NULL,
  "superseded_at" TEXT,
  "source_obs_id" TEXT,
  "note" TEXT
);

-- setup, bitemporal. A dated relationship between two things, with an optional share. A loan's security, its purpose by traced principal, what a policy covers, which account serves a property, who pays a subscription. These are separate facts and one facility can serve two properties.
CREATE TABLE "link" (
  "relation" TEXT NOT NULL CHECK ("relation" IN ('secures', 'funds_purpose', 'covers', 'serves', 'paid_by', 'used_by', 'charged_to', 'offsets', 'contributes_to', 'split_of')),
  "from_type" TEXT NOT NULL CHECK ("from_type" IN ('contract', 'account', 'asset', 'party')),
  "from_id" TEXT NOT NULL,
  "to_type" TEXT NOT NULL CHECK ("to_type" IN ('contract', 'account', 'asset', 'party')),
  "to_id" TEXT NOT NULL,
  "share_bps" INTEGER,
  "valid_from" TEXT NOT NULL,
  "valid_to" TEXT,
  "recorded_at" TEXT NOT NULL,
  "superseded_at" TEXT,
  "source_obs_id" TEXT,
  "note" TEXT
);

-- setup, static. The chart of income and expense. Tax relevance lives in tax_map, by date.
CREATE TABLE "category" (
  "category_id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "parent_id" TEXT,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('income', 'expense', 'capital', 'transfer', 'suspense', 'pass_through')),
  "group" TEXT,
  "essential" INTEGER,
  "cash_lens" INTEGER NOT NULL,
  "economic_lens" INTEGER NOT NULL,
  "property_twin_id" TEXT,
  "note" TEXT
);

-- setup, static. Anything held in units: a currency, a share, an ETF, an RSU, a coin.
CREATE TABLE "instrument" (
  "instrument_id" TEXT PRIMARY KEY,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('currency', 'listed_share', 'etf', 'managed_fund', 'rsu', 'crypto')),
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "issuer_party_id" TEXT,
  "note" TEXT
);

-- setup, static. A durable thing the household cares about, on the balance sheet or not. Life-cycle facts are terms.
CREATE TABLE "asset" (
  "asset_id" TEXT PRIMARY KEY,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('property', 'vehicle', 'device', 'appliance', 'furniture', 'collectible', 'other')),
  "name" TEXT NOT NULL,
  "account_id" TEXT,
  "parent_asset_id" TEXT,
  "location" TEXT,
  "serial" TEXT,
  "acquired_on" TEXT,
  "disposed_on" TEXT,
  "note" TEXT
);

-- setup, bitemporal. An income-producing activity with a start, an end and an owner. A rental and an ABN are the same shape, and a year's composition reads from here.
CREATE TABLE "activity" (
  "activity_id" TEXT PRIMARY KEY,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('rental', 'sole_trader', 'partnership', 'trust', 'investment', 'employment')),
  "name" TEXT NOT NULL,
  "asset_id" TEXT,
  "owner_party_id" TEXT,
  "valid_from" TEXT NOT NULL,
  "valid_to" TEXT,
  "note" TEXT,
  "recorded_at" TEXT,
  "superseded_at" TEXT
);

-- setup, static. A standing agreement, or an accepted one-off commitment. Everything that can change lives in term.
CREATE TABLE "contract" (
  "contract_id" TEXT PRIMARY KEY,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('loan', 'insurance', 'employment', 'lease', 'subscription', 'utility', 'childcare', 'membership', 'super_fund', 'ess_plan', 'commitment')),
  "name" TEXT NOT NULL,
  "counterparty_party_id" TEXT,
  "holder_party_id" TEXT,
  "account_id" TEXT,
  "asset_id" TEXT,
  "category_id" TEXT,
  "started_on" TEXT,
  "ended_on" TEXT,
  "note" TEXT
);

-- setup, bitemporal. The one table for values that change: rates, premiums, salaries, property use, warranty dates. Names come from terms.json. Never a column on an entity.
CREATE TABLE "term" (
  "term_id" TEXT PRIMARY KEY,
  "subject_type" TEXT NOT NULL CHECK ("subject_type" IN ('contract', 'asset', 'party', 'account', 'instrument')),
  "subject_id" TEXT NOT NULL,
  "term" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "unit" TEXT,
  "valid_from" TEXT NOT NULL,
  "valid_to" TEXT,
  "recorded_at" TEXT NOT NULL,
  "superseded_at" TEXT,
  "source_obs_id" TEXT,
  "note" TEXT
);

-- setup, static. A month, quarter or financial year. A new year is a row, never a new workbook.
CREATE TABLE "period" (
  "period_id" TEXT PRIMARY KEY,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('month', 'quarter', 'fy')),
  "start_on" TEXT NOT NULL,
  "end_on" TEXT NOT NULL,
  "status" TEXT NOT NULL CHECK ("status" IN ('open', 'closing', 'closed', 'locked')),
  "closed_at" TEXT,
  "seal_hash" TEXT
);

-- setup, bitemporal. What should keep arriving. Coverage is expected against held.
CREATE TABLE "stream" (
  "stream_id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "doc_kind" TEXT NOT NULL,
  "subject_type" TEXT NOT NULL,
  "subject_id" TEXT NOT NULL,
  "issuer_party_id" TEXT,
  "cadence" TEXT NOT NULL CHECK ("cadence" IN ('fortnightly', 'monthly', 'quarterly', 'half_yearly', 'yearly', 'event')),
  "valid_from" TEXT NOT NULL,
  "valid_to" TEXT,
  "grace_days" INTEGER,
  "note" TEXT,
  "recorded_at" TEXT,
  "superseded_at" TEXT
);

-- setup, bitemporal. Nothing has four meanings: zero, not held, does not apply, not asked. A missing row is not asked. Signals read this; metrics report coverage.
CREATE TABLE "scope" (
  "subject_type" TEXT NOT NULL CHECK ("subject_type" IN ('household', 'party', 'account', 'asset', 'domain')),
  "subject_id" TEXT NOT NULL,
  "domain" TEXT NOT NULL,
  "state" TEXT NOT NULL CHECK ("state" IN ('none', 'has', 'partial', 'unknown')),
  "by" TEXT NOT NULL,
  "valid_from" TEXT NOT NULL,
  "valid_to" TEXT,
  "note" TEXT,
  "recorded_at" TEXT,
  "superseded_at" TEXT
);

-- setup, bitemporal. Which return label a category or event kind lands on, for a dated range. entity_kind stops SMSF rent landing on an individual's label 21.
CREATE TABLE "tax_map" (
  "selector_type" TEXT NOT NULL CHECK ("selector_type" IN ('category', 'event_kind')),
  "selector" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "treatment" TEXT NOT NULL CHECK ("treatment" IN ('income', 'deduction', 'offset', 'credit', 'cgt', 'memo')),
  "basis" TEXT NOT NULL CHECK ("basis" IN ('ownership', 'person', 'household')),
  "entity_kind" TEXT CHECK ("entity_kind" IN ('person', 'smsf', 'company', 'trust')),
  "valid_from" TEXT NOT NULL,
  "valid_to" TEXT,
  "note" TEXT,
  "recorded_at" TEXT,
  "superseded_at" TEXT
);

-- evidence, append. An immutable file. Identity is its hash. A corrected document is a new source that supersedes the old. status is a projection, computed from the supersedes chain; the row itself never changes.
CREATE TABLE "source" (
  "source_id" TEXT PRIMARY KEY,
  "sha256" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "uri" TEXT,
  "origin" TEXT NOT NULL CHECK ("origin" IN ('portal', 'email', 'scan', 'connector', 'manual', 'cdr')),
  "mime" TEXT,
  "bytes" INTEGER,
  "stream_id" TEXT,
  "issued_on" TEXT,
  "captured_at" TEXT NOT NULL,
  "supersedes_source_id" TEXT,
  "status" TEXT NOT NULL CHECK ("status" IN ('active', 'superseded', 'quarantined')),
  "note" TEXT
);

-- evidence, append. One claim one source made, with a locator back to the place. Records what was said, including what is wrong. status is a projection, computed at rebuild. An agent-extracted observation MUST carry a quote and a locator.
CREATE TABLE "observation" (
  "obs_id" TEXT PRIMARY KEY,
  "source_id" TEXT NOT NULL,
  "locator" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "occurred_on" TEXT,
  "amount_cents" INTEGER,
  "currency" TEXT,
  "subject_ref" TEXT,
  "payload" TEXT NOT NULL,
  "importer" TEXT NOT NULL,
  "recipe_id" TEXT,
  "confidence" TEXT NOT NULL,
  "quote" TEXT,
  "supersedes_obs_id" TEXT,
  "status" TEXT NOT NULL CHECK ("status" IN ('active', 'rejected', 'superseded'))
);

-- evidence, append. A return or assessment as it happened, materialised from a tax_assessment observation, or typed from a paper return. History, not calculation. An amendment is a new version.
CREATE TABLE "tax_return" (
  "return_id" TEXT PRIMARY KEY,
  "party_id" TEXT NOT NULL,
  "fy" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" TEXT NOT NULL CHECK ("status" IN ('lodged', 'assessed', 'amended', 'partial')),
  "lodged_on" TEXT,
  "assessed_on" TEXT,
  "taxable_income_cents" INTEGER,
  "tax_cents" INTEGER,
  "credits_cents" INTEGER,
  "result_cents" INTEGER,
  "source_id" TEXT,
  "supersedes_return_id" TEXT
);

-- evidence, append. One line on a lodged return or assessment. Labels repeat within a return and some lines have no label, so line_id is the identity and rolls_up_to names a line_id. role stops a sum multiplying a repeated net figure or reading a memo about a spouse as your own.
CREATE TABLE "tax_line" (
  "line_id" TEXT PRIMARY KEY,
  "return_id" TEXT NOT NULL,
  "activity_id" TEXT,
  "label" TEXT,
  "section" TEXT,
  "role" TEXT NOT NULL CHECK ("role" IN ('leaf', 'subtotal', 'memo', 'carry')),
  "rolls_up_to" TEXT,
  "amount_cents" INTEGER NOT NULL,
  "gross_cents" INTEGER,
  "obs_id" TEXT,
  "note" TEXT
);

-- judgement, append. One thing a person chose, with the reason and what would reopen it. Survives every rebuild. status is a projection of the latest decision on the same target.
CREATE TABLE "decision" (
  "decision_id" TEXT PRIMARY KEY,
  "target_type" TEXT NOT NULL CHECK ("target_type" IN ('observation', 'line', 'document', 'source', 'recipe', 'period', 'contract', 'asset', 'account', 'check')),
  "target_ref" TEXT NOT NULL,
  "verb" TEXT NOT NULL CHECK ("verb" IN ('categorise', 'split', 'link', 'unlink', 'exclude', 'include', 'assign_person', 'assign_claimant', 'choose_lot', 'set_event_kind', 'reopen', 'accept', 'reject', 'adjust', 'tag', 'note', 'worth_it', 'confirm')),
  "value" TEXT NOT NULL,
  "by" TEXT NOT NULL,
  "at" TEXT NOT NULL,
  "status" TEXT NOT NULL CHECK ("status" IN ('proposed', 'accepted', 'rejected')),
  "reason" TEXT,
  "reopen_if" TEXT
);

-- judgement, bitemporal. The household's accumulated taste: what a descriptor means. Priority beats length; a rule can be scoped to one account; a rule can name the property a line belongs to.
CREATE TABLE "rule" (
  "rule_id" TEXT PRIMARY KEY,
  "pattern" TEXT NOT NULL,
  "match" TEXT NOT NULL CHECK ("match" IN ('normalised', 'exact', 'contains', 'regex')),
  "merchant" TEXT,
  "category_id" TEXT,
  "person" TEXT,
  "event_kind" TEXT,
  "priority" INTEGER,
  "direction" TEXT CHECK ("direction" IN ('credit', 'debit')),
  "account_id" TEXT,
  "activity_id" TEXT,
  "asset_id" TEXT,
  "contract_id" TEXT,
  "valid_from" TEXT,
  "valid_to" TEXT,
  "provenance" TEXT NOT NULL,
  "status" TEXT NOT NULL CHECK ("status" IN ('proposed', 'accepted')),
  "note" TEXT,
  "recorded_at" TEXT,
  "superseded_at" TEXT
);

-- judgement, append. Data that reads one family of files. Written once, cached by fingerprint, judged by the gate.
CREATE TABLE "recipe" (
  "recipe_id" TEXT PRIMARY KEY,
  "fingerprint" TEXT NOT NULL,
  "family" TEXT NOT NULL,
  "spec" TEXT NOT NULL,
  "author" TEXT NOT NULL,
  "tokens_in" INTEGER,
  "tokens_out" INTEGER,
  "gate_status" TEXT NOT NULL CHECK ("gate_status" IN ('proposed', 'passed', 'failed')),
  "created_at" TEXT NOT NULL
);

-- judgement, append. One row per piece of household tailoring: the person's sentence, the definition, an example result and the standard version it was written against. On an update the example runs; if it fails an agent rewrites from the sentence.
CREATE TABLE "tailoring" (
  "tailoring_id" TEXT PRIMARY KEY,
  "rung" TEXT NOT NULL CHECK ("rung" IN ('tag', 'rule', 'saved_question', 'widget', 'x_term', 'x_column', 'x_event_kind', 'x_observation_kind', 'x_table')),
  "name" TEXT NOT NULL,
  "sentence" TEXT NOT NULL,
  "definition" TEXT NOT NULL,
  "example" TEXT,
  "standard_version" TEXT NOT NULL,
  "status" TEXT NOT NULL CHECK ("status" IN ('active', 'retired', 'promoted'))
);

-- plan, bitemporal. Monthly intent per category, versioned, so last year is judged against last year's budget.
CREATE TABLE "budget" (
  "category_id" TEXT NOT NULL,
  "amount_cents" INTEGER NOT NULL,
  "cadence" TEXT NOT NULL CHECK ("cadence" IN ('monthly', 'yearly')),
  "valid_from" TEXT NOT NULL,
  "valid_to" TEXT,
  "note" TEXT,
  "recorded_at" TEXT,
  "superseded_at" TEXT
);

-- plan, static. A named target. A refresh cycle can back one through asset_id.
CREATE TABLE "goal" (
  "goal_id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "target_cents" INTEGER NOT NULL,
  "target_on" TEXT,
  "account_id" TEXT,
  "asset_id" TEXT,
  "status" TEXT NOT NULL CHECK ("status" IN ('active', 'met', 'dropped')),
  "note" TEXT
);

-- plan, effective. Money earmarked inside an account. A reservation is an intention, not segregation; the balance does not move. Requested and applied differ, and a release names what ended it.
CREATE TABLE "reservation" (
  "reservation_id" TEXT PRIMARY KEY,
  "account_id" TEXT NOT NULL,
  "goal_id" TEXT,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('floor', 'sinking_fund', 'tax', 'bill', 'other')),
  "requested_cents" INTEGER NOT NULL,
  "applied_cents" INTEGER,
  "valid_from" TEXT NOT NULL,
  "valid_to" TEXT,
  "release_ref" TEXT,
  "note" TEXT
);

-- plan, static. A named what-if. A forecast is (scenario, as_of, horizon).
CREATE TABLE "scenario" (
  "scenario_id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "base_on" TEXT NOT NULL,
  "note" TEXT
);

-- plan, effective. A dated overlay on terms and rates for one scenario.
CREATE TABLE "assumption" (
  "scenario_id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "valid_from" TEXT NOT NULL,
  "valid_to" TEXT,
  "note" TEXT
);

-- ledger, derived. One economic fact, recognised once.
CREATE TABLE "event" (
  "event_id" TEXT PRIMARY KEY,
  "kind" TEXT NOT NULL,
  "occurred_on" TEXT NOT NULL,
  "settled_on" TEXT,
  "description" TEXT NOT NULL,
  "merchant" TEXT,
  "category_id" TEXT,
  "person" TEXT,
  "asset_id" TEXT,
  "activity_id" TEXT,
  "contract_id" TEXT,
  "amount_cents" INTEGER,
  "status" TEXT NOT NULL CHECK ("status" IN ('recognised', 'provisional', 'open')),
  "grade" TEXT NOT NULL CHECK ("grade" IN ('reconciled', 'corroborated', 'stated', 'derived', 'estimated')),
  "rule" TEXT
);

-- ledger, derived. Which observation supports which event, and how.
CREATE TABLE "witness" (
  "event_id" TEXT NOT NULL,
  "obs_id" TEXT NOT NULL,
  "role" TEXT NOT NULL CHECK ("role" IN ('recognises', 'clears', 'corroborates', 'contradicts', 'control')),
  "amount_cents" INTEGER
);

-- ledger, derived. One side of a balanced entry. Exactly one of account_id and category_id. amount_cents is base currency and sums to zero per event; native_cents is what the account's own statement says, and L3 runs on it.
CREATE TABLE "posting" (
  "event_id" TEXT NOT NULL,
  "line" INTEGER NOT NULL,
  "account_id" TEXT,
  "category_id" TEXT,
  "amount_cents" INTEGER NOT NULL,
  "units" TEXT,
  "instrument_id" TEXT,
  "memo" TEXT,
  "native_cents" INTEGER,
  "native_currency" TEXT
);

-- ledger, derived. A parcel: units and a date, or a whole property. Five-element cost base. An unknown cost is a value: cost_known false, cost null, and a sale reports an unknown gain.
CREATE TABLE "lot" (
  "lot_id" TEXT PRIMARY KEY,
  "instrument_id" TEXT,
  "asset_id" TEXT,
  "account_id" TEXT NOT NULL,
  "party_id" TEXT,
  "acquired_on" TEXT NOT NULL,
  "units" TEXT NOT NULL,
  "units_open" TEXT NOT NULL,
  "cost_known" INTEGER NOT NULL,
  "cost_price_cents" INTEGER,
  "cost_incidental_cents" INTEGER NOT NULL,
  "cost_ownership_cents" INTEGER,
  "cost_capital_cents" INTEGER,
  "cost_adjustment_cents" INTEGER,
  "event_id" TEXT NOT NULL
);

-- ledger, derived. One parcel meeting one disposal. Each row is one CGT event line.
CREATE TABLE "lot_match" (
  "event_id" TEXT NOT NULL,
  "lot_id" TEXT NOT NULL,
  "disposed_on" TEXT NOT NULL,
  "units" TEXT NOT NULL,
  "proceeds_cents" INTEGER NOT NULL,
  "cost_base_cents" INTEGER,
  "gain_cents" INTEGER,
  "exempt_cents" INTEGER,
  "discount_eligible" INTEGER NOT NULL,
  "method" TEXT NOT NULL CHECK ("method" IN ('fifo', 'lifo', 'specific', 'hifo'))
);

-- ledger, derived. A materialised view: month-end balance per account, summed from postings, with how it is confirmed.
CREATE TABLE "balance" (
  "month_end" TEXT NOT NULL,
  "account_id" TEXT NOT NULL,
  "balance_cents" INTEGER NOT NULL,
  "units" TEXT,
  "grade" TEXT NOT NULL
);

-- tax, derived. A derived per-person, per-year, per-label amount, by activity where one applies, so a schedule can be produced per property. A draft, never advice.
CREATE TABLE "tax_item" (
  "party_id" TEXT NOT NULL,
  "fy" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "activity_id" TEXT,
  "amount_cents" INTEGER NOT NULL,
  "method" TEXT NOT NULL,
  "evidence" TEXT NOT NULL CHECK ("evidence" IN ('held', 'missing', 'at_risk')),
  "refs" TEXT
);

-- control, derived. One law, one scope, one result.
CREATE TABLE "check_result" (
  "law" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "status" TEXT NOT NULL CHECK ("status" IN ('pass', 'fail', 'gap', 'open', 'skip', 'accepted')),
  "expected" TEXT,
  "actual" TEXT,
  "gap_cents" INTEGER,
  "detail" TEXT,
  "accepted_by" TEXT
);

-- control, derived. Something that needs a person, ranked by money at stake.
CREATE TABLE "review_item" (
  "item_id" TEXT PRIMARY KEY,
  "kind" TEXT NOT NULL,
  "ref" TEXT NOT NULL,
  "amount_cents" INTEGER,
  "what" TEXT NOT NULL,
  "do" TEXT
);

-- control, derived. A materialised view: one metric, one grain, one value, with its grade and dates.
CREATE TABLE "metric_value" (
  "metric_id" TEXT NOT NULL,
  "grain" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "grade" TEXT NOT NULL,
  "valid_on" TEXT NOT NULL,
  "known_at" TEXT NOT NULL
);

-- control, derived. One rebuild: what went in, what came out, what it cost.
CREATE TABLE "run" (
  "run_id" TEXT PRIMARY KEY,
  "mode" TEXT NOT NULL,
  "sources" INTEGER,
  "observations" INTEGER,
  "events" INTEGER,
  "review_items" INTEGER,
  "tokens_in" INTEGER,
  "tokens_out" INTEGER,
  "bundle_hash" TEXT
);

-- The two axes of time. Bind :subject_type, :subject_id, :term, :valid_on, :known_at.
-- SELECT value FROM term WHERE subject_type = :subject_type AND subject_id = :subject_id AND term = :term
--   AND valid_from <= :valid_on AND (valid_to IS NULL OR :valid_on < valid_to)
--   AND substr(recorded_at, 1, 10) <= :known_at AND (superseded_at IS NULL OR :known_at < substr(superseded_at, 1, 10));

CREATE INDEX "ix_membership_valid" ON "membership" ("valid_from");
CREATE INDEX "ix_alias_valid" ON "alias" ("valid_from");
CREATE INDEX "ix_ownership_valid" ON "ownership" ("valid_from");
CREATE INDEX "ix_link_valid" ON "link" ("valid_from");
CREATE INDEX "ix_activity_valid" ON "activity" ("valid_from");
CREATE INDEX "ix_term_valid" ON "term" ("valid_from");
CREATE INDEX "ix_stream_valid" ON "stream" ("valid_from");
CREATE INDEX "ix_scope_valid" ON "scope" ("valid_from");
CREATE INDEX "ix_tax_map_valid" ON "tax_map" ("valid_from");
CREATE INDEX "ix_rule_valid" ON "rule" ("valid_from");
CREATE INDEX "ix_budget_valid" ON "budget" ("valid_from");
CREATE INDEX "ix_reservation_valid" ON "reservation" ("valid_from");
CREATE INDEX "ix_assumption_valid" ON "assumption" ("valid_from");
CREATE INDEX "ix_posting_account" ON "posting" ("account_id");
CREATE INDEX "ix_posting_event" ON "posting" ("event_id");
CREATE INDEX "ix_event_day" ON "event" ("occurred_on");
CREATE INDEX "ix_observation_kind" ON "observation" ("kind", "occurred_on");
CREATE INDEX "ix_term_subject" ON "term" ("subject_type", "subject_id", "term");
