# The Kitty

![test](https://github.com/EthDawg/the-kitty/actions/workflows/test.yml/badge.svg)

A money page for one household, built the way a neobank would build it and kept the way a spreadsheet is
kept. One Google Sheet owns every number; one published page reads it, says what needs a person, shows
where the money went, tracks goals as money ("$11k of $12k"), installs on a phone, and answers questions
as a planner's note. No server, no database, no telemetry, nothing to pay for.

**Try it:** https://claude.ai/artifact/QH2gsDP8sHZmgMVKBtkwxn (the fictional Davies household; works on a phone,
add it to your home screen). **Copy the sheet:** https://docs.google.com/spreadsheets/d/1zfiCnqO36a0YmMwC8-J6iGHUGvmLdXmhbL5aPWNlExM/copy

| | |
|---|---|
| ![Home, light](docs/screenshots/pub-home-light.png) | ![Home, dark](docs/screenshots/pub-home-dark.png) |
| ![Insights](docs/screenshots/pub-insights-dark.png) | ![Setup](docs/screenshots/pub-setup-light.png) |

## Status

Version 1.1, shipped. Verified live on 3 November 2026: live read and write through the viewer's Google Sheets
connector, the onboarding's writes, Ask the Kitty, two month-end closes through the import pipeline, light and
dark themes, phone install. See `CHANGELOG.md`; known limits are listed at the end of this file.

**2.0, phase A (the ledger), 4 November 2026, on branch `v2-ledger`:** the data model below now carries every store
of value, on a copy of the demo sheet ("Digital Davies v2", `kitty.config.json`). The published 1.1 page keeps
reading the original sheet until phase C cuts over. `python3 build.py --v2` builds a local page against the copy.


## What is in here

| Path | What it is |
|---|---|
| `src/engine.js` | Every number: parsing of connector strings and snapshot values, the model, verdict, upcoming, goals, leaks, search. Pure functions; `node --test test.js` runs them with the sheet as oracle. |
| `src/app.js` | The page: Home, Activity, Insights, Goals, Setup; onboarding; drawers; the three writes; Ask the Kitty. |
| `src/style.css`, `src/shell.html` | Tokens (light and dark, four accents), components, the SVG icon sprite. |
| `src/data-sources.json` | How a household gets bank data in, by country and institution, with the landing rules. Rendered on Setup. |
| `data/snapshot.json` | The Davies household as JSON, pulled from the sheet's bound Apps Script. Fictional, so it is bundled. `data/snapshot-v2.json` is the same household from the v2 sheet, with the ledger tabs. |
| `snapshot.py` | Refreshes `data/snapshot.json` from the Apps Script JSON feed (`apps-script/Code.js`, `?format=json`); `--v2` refreshes the v2 snapshot once the copy's script is deployed. Until then `tools/grid_to_snapshot.py` builds it from typed connector reads. |
| `kitty.config.json` | Sheet IDs, feed URLs and the page URL: the 1.1 demo sheet the public page reads, and the v2 sheet phase A migrated. |
| `build.py` | Bundles `dist/kitty.html` (publish this) and `dist/local.html` (open locally). `--no-snapshot` for a page with no data in it; `--v2` for `dist/kitty-v2.html` against the v2 sheet. |
| `test.js` | Pinned tests on a frozen month (`fixtures/snapshot-2026-11.json`) plus invariants that also run on the live snapshot: transactions add up to the Cash Flow tab every month, accounts to the Cash metric, IDs unique. |
| `test-v2.js` | The ledger's tests: the sheet's Balances tab is the oracle for every account at every month end; the transfer invariant; signals; on the live v2 snapshot and the fixtures `everyday-only` and `everyday+property` (cut by `fixtures/make-v2-fixtures.py`). |
| `skills/bank-export/SKILL.md` | The agent skill for the monthly export, country-aware, credential-free. |

## Build, test, publish

```bash
python3 snapshot.py          # after a month-end close
node --test test.js
python3 build.py             # dist/kitty.html
```

Publish `dist/kitty.html` from Claude with these capabilities: `mcp` → Google Sheets with
`get_values`, `get_spreadsheet`, `update_values`, `append_values`; `sample`; `user`; `db`; `downloads`.
Icon word: `cat`. After the first publish, set `KITTY_PAGE_URL` in `build.py` so the Setup tab's QR
code points at the page, and publish again.

Local check: `python3 -m http.server 8765 --directory dist` then open `/local.html`. The page runs
on the bundled data without any connector; connector features show as absent.

## The data model, in one paragraph

Raw tabs are append-only (Transactions, Payslips, Valuations). Input tabs are set up once (Accounts,
Categories, Goals, Loans, Assets, Subscriptions, Settings, and the Kitty tab this page owns). View tabs
are formulas only (Cash Flow, Budget, Savings Finder, Mortgage Scenarios, Tax Forecast, Compliance
Checks, Net Worth). Metrics names each headline figure once. The page draws from Metrics and the views,
derives only what a search or a window needs, and checks its derivations against the sheet in the trust
drawer. It writes three things, each to the owning tab: Kitty settings, a goal's target or date, the
safety-net target.

**The ledger (sheet_version 2).** Every store of value is a row on Accounts with a type (transaction, savings,
offset, credit card, loan, property, vehicle, device, shares, crypto, super, smsf), an owner, an opening anchor and
date, a class, a valuation method (ledger, statement, appraisal, market, estimate) and a status (active, beta,
closed). Everything that happens is a row on Entries of one of three kinds: a transaction (money moved, with Up's
vocabulary: raw text, description, status, created at, settled at, transfer id and account, foreign amount), a
trade (units at a price) or a valuation (a value observed on a date, from a statement or an appraisal). Balances
holds the balance of every account at every month end: the anchor plus entries for a ledger account, the last
valuation carried forward for the rest; Net Worth is derived from it. Contracts holds recurring obligations
(subscriptions, insurance, the lease, loan terms) with provider, cadence, next date and cover; Decisions holds
human judgments keyed to an entry, contract or account; Rules maps descriptors to merchant, category, tax label
and property. Transactions, Valuations, Assets and Subscriptions are formula views over these, so every 1.1
formula keeps working and every existing ID is stable. A transfer is one event on two accounts paired by
`transfer_id`, and the sheet checks the invariant (a mate of the opposite amount within four days; pairs never
count as spending; each month's change in total balances equals income less spending plus valuation changes)
alongside the engine. Loan terms stay on the Loans tab (Mortgage Scenarios reads it); Contracts mirrors them by
formula. On a v2 sheet the month-end rows land on Entries (columns A to T, `entries.json` from the importer), by
explicit range at the first empty row, never by appending to a tab with helper columns.

## The month-end close, as the banks deliver it

Two months (December 2026 and January 2027) were closed this way on 3 November 2026 to prove the model.

```bash
python3 period-close/simulate.py 2027-02      # demo only: writes the month's files as each bank would
python3 snapshot.py                     # the sheet as it stands, for de-duplication and history
python3 period-close/import_month.py 2027-02  # reads sources/, refuses rows already in the sheet, categorises
# settle period-close/2027-02/review.md in overrides.csv, run the import again, then append rows.json,
# payslips.csv and valuations.csv to the sheet, move Settings → As-of date, update Last used, read Compliance Checks
```

- Files land in `sources/<account id>/<download date>/`, one per account, in the institution's own shape
  (`period-close/adapters.py`: Harbour Bank writes like Westpac with debit and credit columns and a running
  balance; Southern Card like American Express with charges positive; Wattle Credit Union like ING). The
  adapter folds each into one signed amount; the file is never edited.
- `import_month.py` refuses any row the sheet already holds (same date, account, description and amount,
  counted), so a file imported twice appends nothing while a genuine same-day double charge survives for the
  sheet's duplicate check to flag. December re-imported after it was appended: 51 rows, 0 to append.
- Txn IDs continue from the sheet's last. Helper columns on Transactions, Payslips and Valuations are
  ARRAYFORMULAs, so appended rows need nothing else. The one thing to get right by hand is the first empty
  row: the header makes T0001 row 2.
- The close is done when every Close check on Compliance Checks is OK and `close.items_missing` is 0.
- The sheet's bound Apps Script serves the JSON feed only while the Kitty tab says `public_feed = yes`. The demo sheet says yes because every number in it is fictional; a household with real money leaves it off and reads live through the connector instead.

## Make it yours

1. File → Make a copy of the demo sheet. Clear the three raw tabs; fill the input tabs.
2. Add the Google Sheets connector in claude.ai with the account that owns the copy.
3. Open the page, Setup → Make it yours → paste your sheet ID. It reads live from then on.
4. Export the last three months from each account (Setup → Getting your data in, or the skill), run
   `period-close/import_month.py`, settle the review, append, move the As-of date.
5. For real money, build with `--no-snapshot` and publish your own private copy.

## Known limits (what is still a tinker)

- English copy only; currency and date order follow the Kitty tab's country, nothing else is localised.
- One sheet shape. A household with different tab names or columns needs the sheet template, not this page.
- Bank export paths are documented from product knowledge, not yet verified on each bank's site; the skill stamps them as it verifies.
- The import pipeline is Python on a laptop; a scheduled, supervised version is the next real step.
- Tested with a 925-row sheet; reads are chunked for larger ones but not yet exercised past a few thousand rows.
- Verified on Chrome, Safari (iOS) and the Claude apps. Not tested on Firefox.

## Decisions (why this shape)

Recorded on the page's Setup tab under "Why this, not that", and in the commit history. The short
version: the sheet is the only owner of numbers; the page is disposable; writes are few, narrow and
reread; demo data is bundled because it is fictional and real data never is; charts are hand-drawn
SVG with d3 for layout maths only.
