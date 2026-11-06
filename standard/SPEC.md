# The Digital Davies Standard

Version `household-standard/1`, draft. Normative. The words MUST, MUST NOT and MAY mean what RFC 2119 says.

A household's money is a small accounting system run by people who are not accountants, fed by dozens of
institutions that disagree about formats, dates, signs and identity. This standard says what that system's records
are, how they relate through time, and which claims about them can be proved. It is written for Australia and built
so that a second jurisdiction is a reference file plus a tax map, not a redesign.

It has one governing idea: **a number in a table is a claim, and a claim is only as good as the law that checks it.**

Machine-readable schema: [`schema/`](schema/). Everything generated from it: [`generated/`](generated/).

---

## 1. Six rules the rest follows from

1. **Three things are original. Everything else is rebuilt.** Evidence (what sources said), Judgement (what a person
   decided) and Setup (who and what exists). Events, postings, lots, balances, tax drafts, metrics and review queues
   are derived and can be deleted at any time. Rebuilding is always safe, and is the test.
2. **Recognise once, clear everywhere.** One economic fact is usually witnessed by several documents. Exactly one
   witness recognises it (the income, the expense, the asset). Every other witness clears against it. Double counting
   is not filtered out later; it has no way in.
3. **Every balance moves through a balanced entry.** Postings on an event sum to zero. Money between your own accounts,
   and every fact witnessed on two sides, passes through a clearing account that must return to zero. An unmatched side
   shows as an open item, never as spending or income.
4. **Time has two axes.** When a thing was true (`valid_from`, `valid_to`) and when we knew it (`recorded_at`,
   `superseded_at`). No row is overwritten. Changing a rate never changes the past; correcting the past never changes
   what we believed then.
5. **Observed beats computed, and the gap is a control.** Interest the lender charged is the ledger. Interest computed
   from the daily balance and the rate table is a check on it. The two are never mixed in one column.
6. **Containers are code. Institutions are data.** The set of file formats is small and closed. The set of institutions
   is unbounded and open. No code is written per institution; a recipe is data, cheap to generate, cached by fingerprint
   and judged by conservation laws, not by who wrote it.

---

## 2. The planes

```
                      ORIGINAL                                    DERIVED (delete and rebuild)
 ┌──────────────┐  ┌───────────────┐  ┌──────────────┐     ┌──────────────┐  ┌──────────────┐  ┌───────────────┐
 │ Setup        │  │ Evidence      │  │ Judgement    │     │ Ledger       │  │ Tax          │  │ Control        │
 │ who and what │  │ what was said │  │ what we chose│ ──▶ │ what happened│  │ what is owed │  │ what is proved │
 │              │  │               │  │              │     │              │  │              │  │                │
 │ party        │  │ source        │  │ decision     │     │ event        │  │ tax_item     │  │ check_result   │
 │ membership   │  │ observation   │  │ rule         │     │ witness      │  │              │  │ review_item    │
 │ account      │  │               │  │ recipe       │     │ posting      │  │              │  │ metric_value   │
 │ alias        │  │               │  │              │     │ lot          │  │              │  │ run            │
 │ ownership    │  │               │  │              │     │ lot_match    │  │              │  │                │
 │ category     │  │ Lodged tax is │  │              │     │ balance      │  │              │  │                │
 │ instrument   │  │ evidence:     │  │              │     └──────────────┘  └──────────────┘  └────────────────┘
 │ asset        │  │ tax_return    │  │              │
 │ contract     │  │ tax_line      │  │              │     Reference (jurisdiction, public, dated)
 │ term         │  │               │  │              │     reference/au.json   tax scales, levies, caps, rates
 │ period       │  │               │  │              │
 │ stream       │  │               │  │              │     Plan (intent, never mixed with actuals)
 │ tax_map      │  │               │  │              │     budget  goal  scenario  assumption
 └──────────────┘  └───────────────┘  └──────────────┘
```

| Plane | Tables | Writer | Lifetime |
|---|---|---|---|
| Setup | `household party membership account alias ownership category instrument asset contract term period stream tax_map` | a person, or the engine materialising a dated fact from an observation | versioned, never overwritten |
| Evidence | `source observation tax_return tax_line` | importers | append only, immutable bytes |
| Judgement | `decision rule recipe` | a person; an agent MAY propose, marked `proposed` until accepted | append only |
| Plan | `budget goal scenario assumption` | a person | versioned |
| Ledger | `event witness posting lot lot_match balance` | the engine alone | rebuilt |
| Tax | `tax_item` | the engine alone | rebuilt |
| Control | `check_result review_item metric_value run` | the engine alone | rebuilt |

A household's portable form is a **bundle**: one CSV or JSONL file per table plus `manifest.json` (standard version,
row counts, content hashes). A Google Sheet, a SQLite file, a DuckDB database and a document store are all projections
of that bundle. The Sheet is the household's durable, readable home; nothing in this standard requires a server.

---

## 3. Time

### 3.1 Temporal classes

Every table declares one. Generated DDL and the conformance checker enforce it.

| Class | Meaning | Examples |
|---|---|---|
| `static` | A fact about identity. Rarely changes; a change is a correction. | `party`, `category`, `instrument` |
| `effective` | True over a half-open range `[valid_from, valid_to)`. A change closes one row and opens another. | `membership`, `alias`, `budget`, `tax_map` |
| `bitemporal` | `effective`, plus `recorded_at` and `superseded_at`. A correction supersedes the row and writes a new one. | `term`, `ownership` |
| `append` | Immutable once written. A correction is a new row that names the one it replaces. | `source`, `observation`, `decision`, `tax_return` |
| `derived` | Rebuilt from the above. Never edited, carries no authority. | `event`, `posting`, `balance` |

Ranges are half-open. `valid_to` is the first day it stopped being true, so adjacent rows share a boundary and a row
with `valid_to = null` is current. Dates are local to the household's timezone. Timestamps are UTC ISO 8601.

### 3.2 The question every view answers

Every view is a function of two dates:

```
view(valid_on, known_at)
```

`valid_on` is the day the question is about. `known_at` is the day the answer is given from. The default for both is
today. Lookups resolve to the row where:

```
valid_from <= valid_on < coalesce(valid_to, +inf)
and recorded_at <= known_at < coalesce(superseded_at, +inf)
```

This is what lets a household ask *what is our rate*, *what was it in March*, and *what did we think it was in March
when we filed*, from one table.

### 3.3 The mortgage rate, worked through

A naive schema has `loan.interest_rate`. Change it from 6.04% to 5.79% and every computed interest figure in history
moves. This standard stores no rate on a loan.

```
term  subject=C-HOME  term=interest_rate  value=6.04  valid_from=2023-11-08  valid_to=2025-09-01  recorded_at=2023-11-20
term  subject=C-HOME  term=interest_rate  value=5.79  valid_from=2025-09-01  valid_to=null        recorded_at=2025-09-03
```

The rate on a past date comes from the row valid then. Now the lender backdates the cut to 25 August, and tells you on
10 September:

```
term  ...value=6.04  valid_from=2023-11-08  valid_to=2025-09-01  recorded_at=2023-11-20  superseded_at=2025-09-10
term  ...value=5.79  valid_from=2025-09-01  valid_to=null        recorded_at=2025-09-03  superseded_at=2025-09-10
term  ...value=6.04  valid_from=2023-11-08  valid_to=2025-08-25  recorded_at=2025-09-10
term  ...value=5.79  valid_from=2025-08-25  valid_to=null        recorded_at=2025-09-10
```

`view(2025-08-28, known_at=2025-09-05)` still says 6.04, because that is what was known. `view(2025-08-28)` says 5.79.
Interest actually charged never moves: it is an observation from the lender. Only the expected-interest control moves,
and the gap it shows is the lender's refund, which is a thing to chase.

The same mechanism carries every other value that changes: ownership shares, employment terms, policy premiums,
property use, budgets, tax maps. This is why `term` is one table with a controlled vocabulary
([`schema/terms.json`](schema/terms.json)) rather than a column on each entity.

### 3.4 Periods, close and seal

A `period` moves `open → closing → closed → locked`. A month is **closed** when every account it touches is confirmed
by a stated balance and its clearing accounts are zero or explained. It is **locked** when nothing in it is provisional.
A lock stores `seal_hash`, a hash over the canonical form of that period's events and postings.

A rebuild that changes a locked period MUST stop and report the difference. To change a locked period a person writes a
`decision` of verb `reopen`, or books a dated adjustment in the open period. A locked month never changes unexplained.

### 3.5 Lodged tax is evidence

A lodged return and a notice of assessment are history, not calculation. They are stored as `tax_return` and `tax_line`
rows, append only, as evidence. An amendment is a new `version`. The engine's draft for the same year is a separate
derived thing (`tax_item`) and the gap between them is a control. Tax scales are read from `reference/au.json` by
date, so re-deriving FY2022 uses FY2022's law forever.

---

## 4. Identity

### 4.1 Parties, not people

`party` covers people, employers, institutions, merchants, agents, tenants, government, trusts, SMSFs and companies. A
tax filer is a party. A `membership` row places a party in the household for a dated range with a role, so a baby
arrives, a partner joins, an adult child leaves, and past views stay right.

Secrets MUST NOT enter any table: no tax file numbers, no passwords, no full card numbers. Identifiers are masked to
the last four where a human needs them, and `alias.value` holds only what is needed to resolve a file to an entity.

### 4.2 Accounts

An `account` is anything with a balance: bank, offset, card, loan, super member account, broker cash, holding, wallet,
HELP debt, ATO position, property, vehicle, a device worth tracking, and the household's clearing accounts. `class`
is `asset`, `liability` or `clearing`. `reporting_group` says where it lands on a net worth statement. An account's
balance is never stored; it is the sum of its postings, checked against stated balances.

An account keeps its identity when its numbers change. A replaced card, a product migration or a bank merger adds an
`alias` row, or sets `successor_account_id`. Files are resolved to accounts through `alias`, by date. A file name is
never identity.

### 4.3 Ownership

`ownership` is dated, fractional and has a basis: `legal`, `beneficial` or `tax`. They often differ (a property held
99/1 for tax, a joint account beneficially one person's). Shares are basis points and MUST sum to 10,000 per subject,
basis and day. Allocation of an amount across owners MUST conserve cents using the largest-remainder method, ties
broken by `party_id`. A half of 100.01 is 50.01 and 50.00, never 50.005 twice.

### 4.4 Contracts and terms

A `contract` is a standing agreement with a counterparty: loan, insurance policy, employment, lease, subscription,
utility, childcare, super fund membership. It has identity and little else. Everything that can change lives in `term`.

### 4.5 Assets are not just accounts

`asset` is any durable thing the household cares about, whether or not it sits on the balance sheet: a house, a car, a
laptop, a dishwasher. `kind` distinguishes them. Life-cycle facts are terms: `warranty_until`, `expected_life_months`,
`refresh_by`, `replacement_cost_cents`, `work_use_pct`, `rego_until`, `use`. An asset MAY link to an `account` when it is
worth carrying at value; a laptop can be on the refresh plan and off the balance sheet. A refresh cycle becomes a dated
future cost, which a sinking fund goal can target. Accounting is one reader of this table, not its owner.

### 4.6 Instruments and lots

`instrument` covers currencies, listed shares, ETFs, RSUs and crypto. A holding is units in lots. A `lot` has an
acquisition date, units, a five-element cost base and an owner. A disposal produces `lot_match` rows that record parcel
selection, proceeds, cost base, gain, and discount eligibility. Prices are observations.

Cost base is not one number. Purchase price, incidental costs, non-capital ownership costs, capital improvements, and
AMIT or return-of-capital adjustments are separate, because they are treated differently by the law.

---

## 5. Evidence

### 5.1 Sources

A `source` is an immutable file identified by `sha256`. Its location can change. A re-download with identical bytes is
the same source. A corrected or reissued document is a new source with `supersedes_source_id`.

### 5.2 Observations

An `observation` is one claim a source made, with a `locator` that gets a human back to the exact place (`line 14`,
`page 2 row 7`, `cell D12`). It has a `kind` from a closed vocabulary ([`schema/observations.json`](schema/observations.json))
and a typed payload. It records what the source said, including what is wrong. An observation is never edited. An
importer that was wrong writes a new observation under a new recipe version; the old one is marked superseded by the run.

Field names follow the Consumer Data Right `BankingTransaction` shape where one applies (`description`, `reference`,
`posting_date`, `value_date`, `merchant_name`), so that a CDR feed is one more container.

Each observation carries `confidence`. Parsed from a structured file by a recipe is `1.0`. Extracted from text is lower.
Read from a scan is lower again. Observations below the threshold for their kind land in review.

### 5.3 Grades

Every metric carries the grade of its weakest input.

| Grade | Meaning |
|---|---|
| `reconciled` | Tied to a stated balance or an independent total. |
| `corroborated` | Two or more independent witnesses agree. |
| `stated` | One source said so and nothing checks it. |
| `derived` | Computed from dated inputs by a declared method. |
| `estimated` | A person's or a model's estimate. |
| `missing` | Expected and not held. Shown, never treated as zero. |

### 5.4 Coverage

A `stream` declares what should keep arriving: this account's monthly statement, this fund's quarterly statement, this
person's fortnightly payslip. Coverage is a view: expected against held, per stream and period. Completeness is a
property that can be computed, and a missing document is a first-class fact. "Zero" and "not held" MUST NOT render the
same way.

---

## 6. The ledger

### 6.1 Resolution is a pipeline with one output

```
observations  ─▶  1 resolve to entities      account, party, contract, by alias and date
              ─▶  2 collapse witnesses       same line seen twice is one line
              ─▶  3 recognise                highest-authority witness creates the event
              ─▶  4 clear                    other witnesses attach to it
              ─▶  5 pair                     own-account transfers, by amount, date and text
              ─▶  6 classify                 decision > rule > contract > dictionary > history > review
              ─▶  7 post                     event kind and template give balanced postings
              ─▶  8 lot                      acquisitions and disposals match to parcels
              ─▶  9 check                    the laws in section 8 run over the result
```

The pipeline is deterministic. Same inputs, same bytes out, in any file order. It uses no clock and no randomness. LLMs
sit outside it: they write recipes, propose rules and propose decisions. Nothing an LLM writes reaches the ledger
without passing through recipe validation or a decision.

### 6.2 Collapsing witnesses

Two identical coffees on one day are two purchases. The same coffee in two overlapping downloads is one. Identity is
therefore a **multiset**, never a hash set:

- Group lines by `(account, posting_date, amount_cents)`.
- If the bank gave a stable `reference`, that is the identity.
- Otherwise, within a group, the true count is the **largest count any single source shows**. A source can repeat a
  charge; two sources cannot add one.
- Assign lines across sources one-to-one by description similarity. Each set is one line with several witnesses.
- A `pending` line is a witness that expires. It is replaced by its posted form, or dropped when its window closes.

### 6.3 Recognition authority

Each event family declares which witness recognises it. Higher authority wins. Lower witnesses clear. If the best
witness has not arrived, the next one recognises provisionally and the event carries `status = provisional`. When the
better witness arrives, a rebuild upgrades it without changing the count of events.

| Family | Authority, highest first |
|---|---|
| Wages | payslip, income statement, bank line |
| Rental | owner statement, bank line |
| Loan interest and principal | lender statement, bank line |
| Dividends and distributions | registry statement or annual tax statement, broker cash line, bank line |
| Super contributions | fund statement, payslip |
| Trades | contract note, broker activity |
| Vesting | plan statement, payslip note |
| Tax | notice of assessment, lodged return, bank line |
| Everyday purchases | bank or card line, receipt |

Everyday purchases are the exception that proves the rule: the card line recognises the cost, and the receipt adds
detail (items, warranty, GST) without changing it.

### 6.4 Clearing

For each two-witness family there is a clearing account, per counterparty. The recogniser posts to it. The other
witness posts out of it.

```
Payslip  gross 4,153.85  tax 1,147.00  net 3,006.85
  Cr  income:SALARY                      4,153.85
  Dr  ato:JORDAN  (tax paid in advance)  1,147.00
  Dr  clearing:payroll:NORTHWIND         3,006.85

Bank line  +3,006.85  SALARY NORTHWIND LOGISTICS
  Dr  ACC-EVD                            3,006.85
  Cr  clearing:payroll:NORTHWIND         3,006.85
```

Salary is counted once, from the document that knows the gross. If the bank line arrives and no payslip does, or the
reverse, `clearing:payroll:NORTHWIND` is non-zero, it has an age, and it names the missing witness. The same shape
covers card repayments, own-account transfers, rental disbursements, loan repayments, dividends, super contributions,
broker settlements, tax refunds and reimbursements.

### 6.5 Two lenses, one ledger

Budgets and tax disagree about a mortgage repayment, and both are right. Cash lens: $3,912 left the bank for housing.
Accrual lens: $2,943 was an expense and $969 turned a liability into equity. A model that stores one number per
transaction has to pick, and then one of the two views is wrong for ever.

Both are read from postings. Each `category` declares `lens`, and a repayment posts cash to the loan account, with the
interest event separate:

- **Cash lens** answers *where did the money go*: spending, budgets, savings rate. Loan repayments count at their cash
  amount under the loan's category. Interest charged on the loan does not count again.
- **Accrual lens** answers *what did we earn and spend*: tax, net worth, property profit. Interest counts. Principal
  does not.

Each metric declares its lens in [`schema/metrics.json`](schema/metrics.json). A metric without a declared lens is a
schema error.

### 6.6 Net worth has to explain itself

```
net_worth(end) - net_worth(start) = income - expenses + revaluation
```

This holds to the cent for any window, for the whole household and per owner. Anything that moves net worth without an
event is, by construction, a failure of law `L8`. Revaluation is an event, posted from a dated valuation, to an equity
account. Headline net worth excludes `clearing` and the assessed-but-unpaid `tax` position, and the identity accounts
for both.

---

## 7. Importers

### 7.1 Are adapters needed?

No per-institution code is needed. An importer is anything that produces valid observations. There are three tiers.

| Tier | What it is | Runs on | Cost after the first time |
|---|---|---|---|
| **Recipe, table** | Data: which columns mean what, the date format, the sign rule. Interpreted by one small engine over CSV, TSV, OFX, QIF, XLSX, JSON and HTML tables. | anything, including a phone | zero tokens |
| **Recipe, document** | Data: anchors and row patterns over extracted text lines. Same engine, over PDF, HTML and email. | anything | zero tokens |
| **Agent extraction** | A model reads a scan or a one-off and emits observations directly, with a locator and a quote for each. | a harness | tokens, every time |

A recipe is usually written by a model in under a kilobyte of output, from a header and a few rows, once per format,
and cached by a **fingerprint** of the file's structure. The second household to meet that format pays nothing. This is
the "cheap code gen in a harness" idea made durable: instead of generating a throwaway parser, generate data that an
audited interpreter runs and that the gate can judge.

### 7.2 The gate

The gate does not care who wrote the recipe. A recipe is accepted for a file family only if, over every file in it:

1. Every row is consumed or explicitly skipped. Nothing silently falls through.
2. Every required field parses, including dates that could be read two ways. A recipe MUST prove its date order on the
   file: a day above 12 somewhere, or a balance chain that only works one way.
3. The sign rule is proved by the balance chain where the file has one.
4. Stated control totals tie: opening + movements = closing; gross - tax - deductions = net; the sum of lines = total.
5. The output is the same on a byte-shuffled row order and on a repeated run.

A wrong recipe fails 2, 3 or 4 almost every time, because money is conserved and misreading it breaks conservation. This
is why LLM-written parsers can be trusted here, and why they are not in free-form code.

### 7.3 Decision and rule memory

Rules are the household's accumulated taste; decisions are its accumulated answers. They persist across a rebuild, so
a person is never asked twice. On a blow-away replay, a returning household keeps `decision`, `rule` and `recipe`.
A new household starts with the public dictionary and public recipes. The eval measures both.

---

## 8. The laws

Accuracy is not having numbers in a model. It is the set of things that cannot be false at the same time. Each law is a
named check with a scope, a tolerance and a meaning. A view is not trusted while a law it depends on fails; the UI says
so rather than rounding it away. Full definitions: [`schema/checks.json`](schema/checks.json).

| Law | Claim | Catches |
|---|---|---|
| `L1 Conservation` | Every event's postings sum to zero. | Half-recorded facts. |
| `L2 Clearing` | Every clearing account is zero at close, or each open item has an age and a named missing witness. | Double counts, missing payslips, unmatched transfers. |
| `L3 Continuity` | For every statement, opening + movements = closing, and each closing is the next opening. | Missing, repeated or misread lines; wrong sign; wrong account. |
| `L4 One claim` | Every observation is attached to exactly one event, or explicitly excluded. | Orphans and double claims. |
| `L5 Payslip` | gross - tax - deductions = net; YTD chains; the year's payslips sum to the income statement. | Misread or missing payslips. |
| `L6 Interest` | Interest charged is within tolerance of the computed daily interest at the rate valid each day, net of offset. | Wrong rate history, lender errors, a missed offset. |
| `L7 Holdings` | Open lots = units stated by the broker, per instrument and date. | Missed trades, splits, DRPs. |
| `L8 Roll-forward` | Change in net worth = income - expenses + revaluation, to the cent. | Anything that moved without an event. |
| `L9 Ownership` | Shares sum to 100% per subject, basis and day. | Gaps in a dated split. |
| `L10 Timeline` | No overlapping valid ranges for one subject and term; required terms have no gaps. | Two rates on one day. |
| `L11 Tax tie` | The derived return agrees with the lodged return and notice of assessment, label by label, within $1. | A missing income source, a wrong map, a wrong scale. |
| `L12 Seal` | A locked period's hash has not changed. | Unexplained history. |
| `L13 Coverage` | Every stream has what it should for the period. | Silent gaps. |
| `L14 Super tie` | Contributions on payslips reach the fund, allowing for its lag. | Unpaid SG, misclassified contributions. |
| `L15 Provenance` | Every event cites an observation, and every observation a source with a hash. | Numbers from nowhere. |
| `L16 Cap` | Contributions, offsets and thresholds sit within the law for that date, or raise an item. | Excess contributions, MLS exposure. |

---

## 9. Tax

Tax is a mapping from economic facts to labels, per person, per year, with law read by date.

- `tax_map` maps a category or event kind to a label (`1`, `10`, `11`, `18`, `21`, `D1`–`D15`, `T`, `M`) for a dated
  range, because labels and rules change. A return for FY2022 reads the map valid in FY2022.
- `ownership` (tax basis, on the date of the event) splits items across people.
- `tax_item` is the derived per-person, per-year, per-label row, with its method and evidence state: `held`, `missing`,
  `at_risk`.
- Some deductions have no bank line. Work-from-home hours are a `work_log` observation. Decline in value comes from a
  schedule on an asset. Both are items with a method, not transactions.
- Cash basis for individuals: income lands in the year it is received. A pay period that straddles 30 June lands by pay
  date.

The engine produces a draft. It never claims to be advice, and a lodged return outranks it. The readiness of a year is a
view over coverage and items, and it is a real number even though the surfaces built on it are experimental.

---

## 10. Plans are not facts

`budget`, `goal`, `scenario` and `assumption` hold intent. A forecast is `(scenario, as_of, horizon)` and is stored with
its `as_of` so it can be scored later against what happened. Forecast rows never enter the ledger, and a metric never
blends forecast and actual without saying so in its name.

Budgets are versioned by effective date, so last year's overspend is judged against last year's budget.

---

## 11. Views and metrics

A metric is a named contract ([`schema/metrics.json`](schema/metrics.json)): id, unit, grain, lens, dependencies on laws,
stability (`stable` or `experimental`), and the view that computes it. Any surface reads metrics and never recomputes
them: a Sheet tab, the page, an agent, a phone. The page's canvas is a composition of metrics, so a new widget needs no
new model.

Every metric value can be opened: metric → postings → events → witnesses → observations → the exact line of the exact
file. A number that cannot be opened is not shown.

---

## 12. Extensions and tailoring

A household MAY add columns prefixed `x_`, tables prefixed `x_`, categories, term names prefixed `x_`, and rules. It
MUST NOT change the meaning of a standard field. `standard/tools/conform.js` reports three classes of difference:

- **Conformant**: a standard table, as specified.
- **Extension**: `x_` material. Fine, and listed, because a recurring extension is a candidate for the standard.
- **Divergence**: a standard name used differently, a missing required table, a law that cannot be evaluated.

That is the answer to *is this a gap in Digital Davies or a gap in mine*: a divergence in your bundle is yours to fix;
an extension several households need is a gap in the standard, and it is proposed under [`GOVERNANCE.md`](GOVERNANCE.md).

---

## 13. Conformance

A conformant implementation:

1. reads and writes bundles that pass `schema` validation,
2. evaluates laws L1 to L16, or declares which it does not,
3. reproduces the reference eval's locked numbers for the Davies household to the cent,
4. preserves every metamorphic relation in the ladder ([`eval/`](eval/)).
