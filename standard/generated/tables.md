# Tables

Generated from `schema/tables.json`. 41 tables, version `household-standard/1`.

## Setup

Who and what exists. Original.

### `household` (static)

The unit this bundle describes.

| Column | Type | Notes |
|---|---|---|
| `household_id` | id | key |
| `name` | text | required |
| `jurisdiction` | text | required; AU |
| `base_currency` | text | required |
| `fy_start_month` | int | required |
| `timezone` | text | required |
| `standard_version` | text | required |

### `party` (static)

Anyone or anything that can own, owe, pay, employ, insure or be paid. Tax file numbers and passwords never enter this table.

| Column | Type | Notes |
|---|---|---|
| `party_id` | id | key |
| `kind` | text | required; person, organisation, government, trust, smsf, company, partnership |
| `name` | text | required |
| `legal_name` | text |  |
| `birth_date` | date |  |
| `abn` | text |  |
| `note` | text |  |

### `membership` (bitemporal)

A party belonging to the household for a dated range, so a baby arrives and past views stay right.

| Column | Type | Notes |
|---|---|---|
| `party_id` | id | required; → party |
| `role` | text | required; adult, dependant, relative, other |
| `valid_from` | date | required |
| `valid_to` | date |  |
| `note` | text |  |
| `recorded_at` | datetime |  |
| `superseded_at` | datetime |  |

### `account` (static)

Anything with a balance. A balance is never stored; it is the sum of postings, checked against stated balances.

| Column | Type | Notes |
|---|---|---|
| `account_id` | id | key |
| `name` | text | required |
| `class` | text | required; asset, liability, clearing, equity, memo |
| `type` | text | required; transaction, offset, savings, credit_card, loan, super, smsf, brokerage, holding, ess_plan, wallet, help_debt, tax_position, property, vehicle, device, receivable, clearing, equity, memo |
| `reporting_group` | text | required; cash, property, super, shares, crypto, vehicle, device, loans, tax, clearing, equity, memo |
| `currency` | text | required |
| `institution_party_id` | id | → party |
| `parent_account_id` | id | → account |
| `successor_account_id` | id | → account |
| `asset_id` | id | → asset |
| `contract_id` | id | → contract |
| `opened_on` | date |  |
| `closed_on` | date |  |
| `liquid` | bool |  |
| `in_scope` | bool |  |
| `fidelity` | text | ledger, snapshot |
| `note` | text |  |

### `alias` (bitemporal)

An outside identifier for an inside thing, for a dated range. Files resolve to entities here, never by file name.

| Column | Type | Notes |
|---|---|---|
| `subject_type` | text | required; account, party, contract, instrument, asset |
| `subject_id` | id | required |
| `scheme` | text | required; account_number, card_last4, loan_number, member_number, owner_ref, payroll_id, hin, wallet_address, policy_number, merchant_string, name |
| `value` | text | required |
| `valid_from` | date | required |
| `valid_to` | date |  |
| `recorded_at` | datetime |  |
| `superseded_at` | datetime |  |

### `ownership` (bitemporal)

Dated fractional ownership. Shares sum to 10000 per subject, basis and day.

| Column | Type | Notes |
|---|---|---|
| `subject_type` | text | required; account, asset, contract |
| `subject_id` | id | required |
| `party_id` | id | required; → party |
| `basis` | text | required; legal, beneficial, tax |
| `share_bps` | bps | required |
| `valid_from` | date | required |
| `valid_to` | date |  |
| `recorded_at` | datetime | required |
| `superseded_at` | datetime |  |
| `source_obs_id` | id |  |
| `note` | text |  |

### `link` (bitemporal)

A dated relationship between two things, with an optional share. A loan's security, its purpose by traced principal, what a policy covers, which account serves a property, who pays a subscription. These are separate facts and one facility can serve two properties.

| Column | Type | Notes |
|---|---|---|
| `relation` | text | required; secures, funds_purpose, covers, serves, paid_by, used_by, charged_to, offsets, contributes_to, split_of |
| `from_type` | text | required; contract, account, asset, party |
| `from_id` | id | required |
| `to_type` | text | required; contract, account, asset, party |
| `to_id` | id | required |
| `share_bps` | bps |  |
| `valid_from` | date | required |
| `valid_to` | date |  |
| `recorded_at` | datetime | required |
| `superseded_at` | datetime |  |
| `source_obs_id` | id |  |
| `note` | text |  |

### `category` (static)

The chart of income and expense. Tax relevance lives in tax_map, by date.

| Column | Type | Notes |
|---|---|---|
| `category_id` | id | key |
| `name` | text | required |
| `parent_id` | id | → category |
| `kind` | text | required; income, expense, capital, transfer, suspense, pass_through |
| `group` | text |  |
| `essential` | bool |  |
| `cash_lens` | bool | required |
| `economic_lens` | bool | required |
| `note` | text |  |

### `instrument` (static)

Anything held in units: a currency, a share, an ETF, an RSU, a coin.

| Column | Type | Notes |
|---|---|---|
| `instrument_id` | id | key |
| `kind` | text | required; currency, listed_share, etf, managed_fund, rsu, crypto |
| `code` | text | required |
| `name` | text | required |
| `currency` | text | required |
| `issuer_party_id` | id | → party |
| `note` | text |  |

### `asset` (static)

A durable thing the household cares about, on the balance sheet or not. Life-cycle facts are terms.

| Column | Type | Notes |
|---|---|---|
| `asset_id` | id | key |
| `kind` | text | required; property, vehicle, device, appliance, furniture, collectible, other |
| `name` | text | required |
| `account_id` | id | → account |
| `parent_asset_id` | id | → asset |
| `location` | text |  |
| `serial` | text |  |
| `acquired_on` | date |  |
| `disposed_on` | date |  |
| `note` | text |  |

### `activity` (bitemporal)

An income-producing activity with a start, an end and an owner. A rental and an ABN are the same shape, and a year's composition reads from here.

| Column | Type | Notes |
|---|---|---|
| `activity_id` | id | key |
| `kind` | text | required; rental, sole_trader, partnership, trust, investment, employment |
| `name` | text | required |
| `asset_id` | id | → asset |
| `owner_party_id` | id | → party |
| `valid_from` | date | required |
| `valid_to` | date |  |
| `note` | text |  |
| `recorded_at` | datetime |  |
| `superseded_at` | datetime |  |

### `contract` (static)

A standing agreement. Everything that can change lives in term.

| Column | Type | Notes |
|---|---|---|
| `contract_id` | id | key |
| `kind` | text | required; loan, insurance, employment, lease, subscription, utility, childcare, membership, super_fund, ess_plan |
| `name` | text | required |
| `counterparty_party_id` | id | → party |
| `holder_party_id` | id | → party |
| `account_id` | id | → account |
| `asset_id` | id | → asset |
| `category_id` | id | → category |
| `started_on` | date |  |
| `ended_on` | date |  |
| `note` | text |  |

### `term` (bitemporal)

The one table for values that change: rates, premiums, salaries, property use, warranty dates. Names come from terms.json. Never a column on an entity.

| Column | Type | Notes |
|---|---|---|
| `term_id` | id | key |
| `subject_type` | text | required; contract, asset, party, account, instrument |
| `subject_id` | id | required |
| `term` | text | required |
| `value` | text | required |
| `unit` | text |  |
| `valid_from` | date | required |
| `valid_to` | date |  |
| `recorded_at` | datetime | required |
| `superseded_at` | datetime |  |
| `source_obs_id` | id |  |
| `note` | text |  |

### `period` (static)

A month, quarter or financial year. A new year is a row, never a new workbook.

| Column | Type | Notes |
|---|---|---|
| `period_id` | id | key |
| `kind` | text | required; month, quarter, fy |
| `start_on` | date | required |
| `end_on` | date | required |
| `status` | text | required; open, closing, closed, locked |
| `closed_at` | datetime |  |
| `seal_hash` | text |  |

### `stream` (bitemporal)

What should keep arriving. Coverage is expected against held.

| Column | Type | Notes |
|---|---|---|
| `stream_id` | id | key |
| `name` | text | required |
| `doc_kind` | text | required |
| `subject_type` | text | required |
| `subject_id` | id | required |
| `issuer_party_id` | id | → party |
| `cadence` | text | required; fortnightly, monthly, quarterly, half_yearly, yearly, event |
| `valid_from` | date | required |
| `valid_to` | date |  |
| `grace_days` | int |  |
| `note` | text |  |
| `recorded_at` | datetime |  |
| `superseded_at` | datetime |  |

### `scope` (bitemporal)

Nothing has four meanings: zero, not held, does not apply, not asked. A missing row is not asked. Signals read this; metrics report coverage.

| Column | Type | Notes |
|---|---|---|
| `subject_type` | text | required; household, party, account, asset, domain |
| `subject_id` | id | required |
| `domain` | text | required |
| `state` | text | required; none, has, partial, unknown |
| `by` | text | required |
| `valid_from` | date | required |
| `valid_to` | date |  |
| `note` | text |  |
| `recorded_at` | datetime |  |
| `superseded_at` | datetime |  |

### `tax_map` (bitemporal)

Which return label a category or event kind lands on, for a dated range. entity_kind stops SMSF rent landing on an individual's label 21.

| Column | Type | Notes |
|---|---|---|
| `selector_type` | text | required; category, event_kind |
| `selector` | text | required |
| `label` | text | required |
| `treatment` | text | required; income, deduction, offset, credit, cgt, memo |
| `basis` | text | required; ownership, person, household |
| `entity_kind` | text | person, smsf, company, trust |
| `valid_from` | date | required |
| `valid_to` | date |  |
| `note` | text |  |
| `recorded_at` | datetime |  |
| `superseded_at` | datetime |  |

## Evidence

What sources said. Original, immutable.

### `source` (append)

An immutable file. Identity is its hash. A corrected document is a new source that supersedes the old. status is a projection, computed from the supersedes chain; the row itself never changes.

| Column | Type | Notes |
|---|---|---|
| `source_id` | id | key |
| `sha256` | text | required |
| `name` | text | required |
| `uri` | text |  |
| `origin` | text | required; portal, email, scan, connector, manual, cdr |
| `mime` | text |  |
| `bytes` | int |  |
| `stream_id` | id | → stream |
| `issued_on` | date |  |
| `captured_at` | datetime | required |
| `supersedes_source_id` | id | → source |
| `status` | text | required; active, superseded, quarantined |
| `note` | text |  |

### `observation` (append)

One claim one source made, with a locator back to the place. Records what was said, including what is wrong. status is a projection, computed at rebuild. An agent-extracted observation MUST carry a quote and a locator.

| Column | Type | Notes |
|---|---|---|
| `obs_id` | id | key |
| `source_id` | id | required; → source |
| `locator` | text | required |
| `kind` | text | required |
| `occurred_on` | date |  |
| `amount_cents` | cents |  |
| `currency` | text |  |
| `subject_ref` | text |  |
| `payload` | json | required |
| `importer` | text | required |
| `recipe_id` | id |  |
| `confidence` | rate | required |
| `quote` | text |  |
| `status` | text | required; active, rejected, superseded |

### `tax_return` (append)

A return or assessment as it happened, materialised from a tax_assessment observation, or typed from a paper return. History, not calculation. An amendment is a new version.

| Column | Type | Notes |
|---|---|---|
| `return_id` | id | key |
| `party_id` | id | required; → party |
| `fy` | text | required |
| `version` | int | required |
| `status` | text | required; lodged, assessed, amended |
| `lodged_on` | date |  |
| `assessed_on` | date |  |
| `taxable_income_cents` | cents |  |
| `tax_cents` | cents |  |
| `credits_cents` | cents |  |
| `result_cents` | cents |  |
| `source_id` | id | → source |
| `supersedes_return_id` | id |  |

### `tax_line` (append)

One line on a lodged return or assessment. Labels repeat within a return and some lines have no label, so line_id is the identity and rolls_up_to names a line_id. role stops a sum multiplying a repeated net figure or reading a memo about a spouse as your own.

| Column | Type | Notes |
|---|---|---|
| `line_id` | id | key |
| `return_id` | id | required; → tax_return |
| `label` | text |  |
| `section` | text |  |
| `role` | text | required; leaf, subtotal, memo, carry |
| `rolls_up_to` | id |  |
| `amount_cents` | cents | required |
| `note` | text |  |

## Judgement

What a person decided. Original, append only.

### `decision` (append)

One thing a person chose, with the reason and what would reopen it. Survives every rebuild. status is a projection of the latest decision on the same target.

| Column | Type | Notes |
|---|---|---|
| `decision_id` | id | key |
| `target_type` | text | required; observation, line, document, source, recipe, period, contract, asset, account, check |
| `target_ref` | text | required |
| `verb` | text | required; categorise, split, link, unlink, exclude, include, assign_person, assign_claimant, choose_lot, set_event_kind, reopen, accept, reject, adjust, tag, note, worth_it, confirm |
| `value` | json | required |
| `by` | text | required |
| `at` | datetime | required |
| `status` | text | required; proposed, accepted, rejected |
| `reason` | text |  |
| `reopen_if` | text |  |

### `rule` (bitemporal)

The household's accumulated taste: what a descriptor means.

| Column | Type | Notes |
|---|---|---|
| `rule_id` | id | key |
| `pattern` | text | required |
| `match` | text | required; normalised, exact, contains, regex |
| `merchant` | text |  |
| `category_id` | id | → category |
| `person` | text |  |
| `event_kind` | text |  |
| `contract_id` | id | → contract |
| `valid_from` | date |  |
| `valid_to` | date |  |
| `provenance` | text | required |
| `status` | text | required; proposed, accepted |
| `note` | text |  |
| `recorded_at` | datetime |  |
| `superseded_at` | datetime |  |

### `recipe` (append)

Data that reads one family of files. Written once, cached by fingerprint, judged by the gate.

| Column | Type | Notes |
|---|---|---|
| `recipe_id` | id | key |
| `fingerprint` | text | required |
| `family` | text | required |
| `spec` | json | required |
| `author` | text | required |
| `tokens_in` | int |  |
| `tokens_out` | int |  |
| `gate_status` | text | required; proposed, passed, failed |
| `created_at` | datetime | required |

### `tailoring` (append)

One row per piece of household tailoring: the person's sentence, the definition, an example result and the standard version it was written against. On an update the example runs; if it fails an agent rewrites from the sentence.

| Column | Type | Notes |
|---|---|---|
| `tailoring_id` | id | key |
| `rung` | text | required; tag, rule, saved_question, widget, x_term, x_column, x_event_kind, x_observation_kind, x_table |
| `name` | text | required |
| `sentence` | text | required |
| `definition` | json | required |
| `example` | json |  |
| `standard_version` | text | required |
| `status` | text | required; active, retired, promoted |

## Plan

Intent. Original, versioned, never mixed with actuals.

### `budget` (bitemporal)

Monthly intent per category, versioned, so last year is judged against last year's budget.

| Column | Type | Notes |
|---|---|---|
| `category_id` | id | required; → category |
| `amount_cents` | cents | required |
| `cadence` | text | required; monthly, yearly |
| `valid_from` | date | required |
| `valid_to` | date |  |
| `note` | text |  |
| `recorded_at` | datetime |  |
| `superseded_at` | datetime |  |

### `goal` (static)

A named target. A refresh cycle can back one through asset_id.

| Column | Type | Notes |
|---|---|---|
| `goal_id` | id | key |
| `name` | text | required |
| `target_cents` | cents | required |
| `target_on` | date |  |
| `account_id` | id | → account |
| `asset_id` | id | → asset |
| `status` | text | required; active, met, dropped |
| `note` | text |  |

### `reservation` (effective)

Money earmarked inside an account. A reservation is an intention, not segregation; the balance does not move. Requested and applied differ, and a release names what ended it.

| Column | Type | Notes |
|---|---|---|
| `reservation_id` | id | key |
| `account_id` | id | required; → account |
| `goal_id` | id | → goal |
| `kind` | text | required; floor, sinking_fund, tax, bill, other |
| `requested_cents` | cents | required |
| `applied_cents` | cents |  |
| `valid_from` | date | required |
| `valid_to` | date |  |
| `release_ref` | text |  |
| `note` | text |  |

### `scenario` (static)

A named what-if. A forecast is (scenario, as_of, horizon).

| Column | Type | Notes |
|---|---|---|
| `scenario_id` | id | key |
| `name` | text | required |
| `base_on` | date | required |
| `note` | text |  |

### `assumption` (effective)

A dated overlay on terms and rates for one scenario.

| Column | Type | Notes |
|---|---|---|
| `scenario_id` | id | required; → scenario |
| `key` | text | required |
| `value` | text | required |
| `valid_from` | date | required |
| `valid_to` | date |  |
| `note` | text |  |

## Ledger

What happened. Derived.

### `event` (derived)

One economic fact, recognised once.

| Column | Type | Notes |
|---|---|---|
| `event_id` | id | key |
| `kind` | text | required |
| `occurred_on` | date | required |
| `settled_on` | date |  |
| `description` | text | required |
| `merchant` | text |  |
| `category_id` | id | → category |
| `person` | id | → party |
| `asset_id` | id | → asset |
| `activity_id` | id | → activity |
| `contract_id` | id |  |
| `amount_cents` | cents |  |
| `status` | text | required; recognised, provisional, open |
| `grade` | text | required; reconciled, corroborated, stated, derived, estimated |
| `rule` | text |  |

### `witness` (derived)

Which observation supports which event, and how.

| Column | Type | Notes |
|---|---|---|
| `event_id` | id | required; → event |
| `obs_id` | id | required; → observation |
| `role` | text | required; recognises, clears, corroborates, contradicts, control |
| `amount_cents` | cents |  |

### `posting` (derived)

One side of a balanced entry. Exactly one of account_id and category_id. amount_cents is base currency and sums to zero per event; native_cents is what the account's own statement says, and L3 runs on it.

| Column | Type | Notes |
|---|---|---|
| `event_id` | id | required; → event |
| `line` | int | required |
| `account_id` | id | → account |
| `category_id` | id | → category |
| `amount_cents` | cents | required |
| `units` | units |  |
| `instrument_id` | id | → instrument |
| `memo` | text |  |
| `native_cents` | cents |  |
| `native_currency` | text |  |

### `lot` (derived)

A parcel: units and a date, or a whole property. Five-element cost base. An unknown cost is a value: cost_known false, cost null, and a sale reports an unknown gain.

| Column | Type | Notes |
|---|---|---|
| `lot_id` | id | key |
| `instrument_id` | id | → instrument |
| `asset_id` | id | → asset |
| `account_id` | id | required; → account |
| `party_id` | id |  |
| `acquired_on` | date | required |
| `units` | units | required |
| `units_open` | units | required |
| `cost_known` | bool | required |
| `cost_price_cents` | cents |  |
| `cost_incidental_cents` | cents | required |
| `cost_ownership_cents` | cents |  |
| `cost_capital_cents` | cents |  |
| `cost_adjustment_cents` | cents |  |
| `event_id` | id | required; → event |

### `lot_match` (derived)

One parcel meeting one disposal. Each row is one CGT event line.

| Column | Type | Notes |
|---|---|---|
| `event_id` | id | required; → event |
| `lot_id` | id | required; → lot |
| `disposed_on` | date | required |
| `units` | units | required |
| `proceeds_cents` | cents | required |
| `cost_base_cents` | cents |  |
| `gain_cents` | cents |  |
| `discount_eligible` | bool | required |
| `method` | text | required; fifo, lifo, specific, hifo |

### `balance` (derived)

A materialised view: month-end balance per account, summed from postings, with how it is confirmed.

| Column | Type | Notes |
|---|---|---|
| `month_end` | date | required |
| `account_id` | id | required; → account |
| `balance_cents` | cents | required |
| `units` | units |  |
| `grade` | text | required |

## Tax

What is owed. Derived.

### `tax_item` (derived)

A derived per-person, per-year, per-label amount, with its method and evidence state. A draft, never advice.

| Column | Type | Notes |
|---|---|---|
| `party_id` | id | required; → party |
| `fy` | text | required |
| `label` | text | required |
| `amount_cents` | cents | required |
| `method` | text | required |
| `evidence` | text | required; held, missing, at_risk |
| `refs` | json |  |

## Control

What is proved. Derived.

### `check_result` (derived)

One law, one scope, one result.

| Column | Type | Notes |
|---|---|---|
| `law` | text | required |
| `scope` | text | required |
| `status` | text | required; pass, fail, gap, open, skip, accepted |
| `expected` | text |  |
| `actual` | text |  |
| `gap_cents` | cents |  |
| `detail` | text |  |
| `accepted_by` | id |  |

### `review_item` (derived)

Something that needs a person, ranked by money at stake.

| Column | Type | Notes |
|---|---|---|
| `item_id` | id | key |
| `kind` | text | required |
| `ref` | text | required |
| `amount_cents` | cents |  |
| `what` | text | required |
| `do` | text |  |

### `metric_value` (derived)

A materialised view: one metric, one grain, one value, with its grade and dates.

| Column | Type | Notes |
|---|---|---|
| `metric_id` | id | required |
| `grain` | text | required |
| `value` | text | required |
| `grade` | text | required |
| `valid_on` | date | required |
| `known_at` | date | required |

### `run` (derived)

One rebuild: what went in, what came out, what it cost.

| Column | Type | Notes |
|---|---|---|
| `run_id` | id | key |
| `mode` | text | required |
| `sources` | int |  |
| `observations` | int |  |
| `events` | int |  |
| `review_items` | int |  |
| `tokens_in` | int |  |
| `tokens_out` | int |  |
| `bundle_hash` | text |  |
