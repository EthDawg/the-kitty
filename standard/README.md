# The Digital Davies Standard

An open data model for a household's whole financial life, with a fictional Australian family, a benchmark, and proof.

Most household finance software stores numbers. This stores **claims**, says who made each one, and checks them against
each other. A number you can see can be opened all the way down to the exact line of the exact file it came from.

```
  Sources                 Observations            Ledger                  Views
  bank CSV, payslip PDF   what each file said     what actually happened  net worth, budget,
  owner statement, NOA ─▶ with a locator and  ─▶  one balanced entry   ─▶ tax draft, refresh plan,
  OFX, QIF, XLSX, EML     a hash                  per fact                anything else
                                 ▲                       ▲
                          recipes (data)          decisions (people)      20 laws check all of it
```

Three things are original: what sources said, what people decided, and who and what exists. Everything else is derived and
can be deleted at any time. Rebuilding is the test: blow it away, replay the files, get the same answer to the cent.

## Run it

Node 22, no dependencies.

```bash
node standard/world/build.js          # write the Davies household's files, setup and truth
node standard/eval/run.js             # blow it away and rebuild; score it
node standard/eval/ladder.js          # mangle the files; the answer must not change
node standard/eval/all.js             # everything, about ten seconds
```

The current numbers are in [`eval/SCOREBOARD.md`](eval/SCOREBOARD.md).

## Three problems it solves

### Numbers in a model are not accuracy

A payslip and its bank deposit are one salary. A CSV and its PDF statement are one month. A card repayment is on two
accounts. A rental statement, a bank line and a lender statement can all describe the same dollars. Add them up and the
household earns three times what it does.

The usual fix is a filter after the fact. Here **one fact is recognised once, by the best witness, and every other witness
clears against it.** Every two-sided fact passes through a clearing account that must return to zero, so an unmatched side
is an open item with an age and a name, not spending. Two identical coffees on one day stay two, and one coffee in two
overlapping downloads stays one, because identity is a multiset. When two witnesses cannot be proved one or two, it stays
a question for a person. The matching model is declared in [`schema/matching.json`](schema/matching.json), every window
with its reason.

Then [twenty laws](SPEC.md#8-the-laws) check that the numbers can all be true at once. They include the things that are
hard to fake: statements that chain, interest that matches the rate on each day net of the offset, units that match the
broker, a derived return that ties to the lodged one. The spec also says what no law can catch. A wrong category conserves
perfectly.

### Changing a rate must not change the past

A loan does not have an interest rate. It has a history of rates, and a history of when you knew each one. Every value
that can change lives in one bitemporal table, read as `view(valid_on, known_at)`. So a household can ask what the rate is,
what it was in March, and what it thought it was in March when it filed, from one table. When a lender backdates a
cut, the rows are added, nothing is edited, and the interest actually charged stays where it was, because that is evidence.

### Importers are a long tail

Do you need a Python adapter per bank? No. **Containers are code; institutions are data.** The set of file formats is small and
closed. The set of institutions is unbounded. A recipe is a small piece of data that says what the columns mean, cheap for a
model to write from a few rows, cached by a structural fingerprint so the second household pays nothing.

The gate does not care who wrote it, because money is conserved and misreading it breaks conservation. A recipe passes only if
every row is consumed, the date order is proved (not assumed), the sign is proved by the balance chain, and control totals tie.
That is why model-written parsers can be trusted here and why they are data instead of free-form code.

## What is in the model

Forty-one tables across seven planes. See [`generated/tables.md`](generated/tables.md).

| Plane | Holds | |
|---|---|---|
| **Setup** | People, accounts, ownership, contracts, assets, activities, dated terms and links | original |
| **Evidence** | Files by hash, observations, lodged returns | original |
| **Judgement** | Decisions, rules, recipes, tailoring | original |
| **Plan** | Budgets, goals, reservations, scenarios | original, never mixed with actuals |
| **Ledger** | Events, witnesses, postings, lots | derived |
| **Tax** | Per-person, per-label draft | derived |
| **Control** | Laws, review queue, metrics | derived |

It covers an Australian household's life, not just its accounts: everyday spending and budgets, loans with offsets and redraws
and refinances, loan purpose apart from security, rentals, a home that becomes a rental with its cost base reset, payslips with
salary sacrifice, super by contribution type and cap, ETFs with DRPs and AMIT and splits, RSUs vesting in USD, crypto swaps and
own-wallet transfers, returns as lodged and as amended, insurance, subscriptions, third-party money on household rails, and
durable things with warranties and refresh cycles. A laptop can be on the refresh plan and off the balance sheet.

Everything is generated from [`schema/`](schema/): [SQL](generated/schema.sql), [MongoDB validators](generated/mongodb-validators.json),
[an ER diagram](generated/er.mmd), [the Sheet's tabs](generated/sheet-tabs.json), and a [schema card](generated/schema-card.md) under
2,000 tokens that gives any model the whole shape. The household's portable form is a bundle of JSONL files. A Google Sheet is
its durable, readable home, and the workbook's live formulas are checked against the engine.

## The benchmark

The Davies family is an eval set. The world is truth-first: an eight-year life is simulated, then rendered the way each institution
really hands it over, then an importer tries to get back to the world. Any importer can run it. An importer is anything that writes
observations.

| Level | Asks |
|---|---|
| **Replay** | From files plus a person's setup, are the balances, income, tax and net worth right to the cent? |
| **Ladder** | Presentation rungs mangle the delivery and must land on the same bundle hash. Semantic rungs break one thing and must ring the right alarm. One rung per law, so a hollow law fails. |
| **Households** | Does the model tell the truth about a renter, a retiree, a trust, a separation, an SMSF, a mid-life start? |
| **Keep and update** | Tailor it, type in the sheet, take an update. Are originals byte-identical and every decision still bound? |
| **Cold start** | How many tokens does it cost a cheap model to read this household from scratch? |
| **Blind** | Does it work for a family it was not built around? A worker that cannot read the engine simulates another household, with its own traps, and runs it once. |

Some oracle figures were computed by Google Sheets formulas, not by this engine. The scoreboard says plainly what the eval is given and where its truth comes from.

The blind level is the one that tests what tuning cannot, and it is the one that hurt. The first blind household, under [`eval/heldout/`](eval/heldout/), crashed the rebuild, doubled 88 card lines and hid a missing month, on a model that scored 100% on the Davies. That result is [kept as it was written](eval/heldout/BLIND-1.md). Each defect became a fixture and a repair, then a new blind household tests whether the repairs generalise. A score after repair proves only that the repair works.

## Compared with

| | Keeps source evidence | Double counts structurally impossible | Bitemporal | Tax as law by date | Model-writable importers | Benchmark |
|---|---|---|---|---|---|---|
| Plaid, CDR, Open Banking schemas | no | no | no | no | n/a | no |
| Beancount, Ledger | partly | within what you enter | no | no | no | no |
| Budgeting apps | no | no | no | no | no | no |
| This | yes | where witnesses pair; otherwise a question | yes | yes | yes | yes |

Field names follow the Consumer Data Right where one applies, so a CDR feed is one more container. Double-entry bookkeeping is old
and good; this keeps it, and puts evidence, time and judgement around it.

## Keep it, tailor it, update it

Nobody forks. A household depends on the base and never copies it. New logic arrives by rebuilding, because everything derived can be.
An update is a dry run plus a metric diff: nothing you entered changes, these numbers move, and here is why. A locked period is never
moved; it raises a reopen proposal. Tailoring carries the person's sentence and an example, so it can be rewritten from the sentence
when the base moves. See [SPEC section 13](SPEC.md#13-upgrades).

## Limits

- Fictional data. Numbers here are not tax advice, and a lodged return outranks any draft.
- Australia only for now. A second jurisdiction is a reference file and a tax map.
- Company, trust and SMSF returns and sole-trader derivation are declined for now: held as evidence, shown as not modelled.
- The engine is pure and written to run in a page, but it has not been bundled for a browser or a phone yet.
- Surfaces around the model are honest about what they are. See [`EXPERIMENTAL.md`](EXPERIMENTAL.md).

## Contributing

Every change brings a failing case. See [`GOVERNANCE.md`](GOVERNANCE.md). The most useful contribution is a household shape the model
gets wrong, written as a fixture under [`eval/households/`](eval/households/). Only shapes flow in, never anyone's data.
