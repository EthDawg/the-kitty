# What the pack found in the Standard

Written while building the household pack. Each row has a fixture in [`fixtures/findings.test.js`](fixtures/findings.test.js) that states what should be
true and fails today. They run in CI as todo, so they stay visible without turning the build red. When one passes, the gap is closed: delete the row and the workaround.

`standard/schema`, `engine` and `eval` belong to the data model session, so nothing here was changed in them.

## Wrong numbers first

| # | Finding | Why it matters | What the pack does meanwhile |
|---|---|---|---|
| F1 | **A held income statement wipes out payslips from any other employer.** `tax.js` replaces label 1 with the sum of statements held. Lose one of two statements and that employer's income is gone. Fixture: Mia's agency statement removed, label 1 falls $5,688.00 with the payslips still held. | A return is understated with no warning. | Shows the payslip total, says it is not counted, and opens an item for the taxpayer. It keeps to the engine's label. |
| F2 | **A household with no `tax_map` gets no interest and no rent.** The map is written only by the Davies world, so every blind family, and any blank Kitty, has an empty one. Interest and rent reach the ledger and no label. | A blank Kitty's first draft is short, and nothing says so. | Shows `not found`, keeps out of the total, opens an item with the amount, marks the total Incomplete. |
| F3 | **A bill binds to a payment that merely has the same amount.** Ballarat's $455.00 rates bill matched a $455.00 car service on the card, and the car service took the rental activity. The real rates payment is a separate event. | Wrong activity, wrong story in any drill. It escaped the tax label only because the category is Car. | Lists it under "Linked to this property, not claimed" with the files, and asks. |
| F9 | **Binary rounding in LITO.** 700 - 375 - 290.985 is 34.015, and binary holds 34.01499, so the engine says 34.01 where the decimal rule gives 34.02. A cent, in a system that promises cents. | The workbook's own formula lands a cent away from the engine. | The workbook adds a stated one-cent adjustment and says why, so it ties and the difference is visible. It disappears when the engine is fixed. |
| F18 | **A pension reaches no label.** Retirement income on an unmapped category is in the ledger and not in the draft. | A retiree's draft is short. | Any income category the map and the engine both miss becomes an item for the accountant, with the amount. |

## What the Standard cannot state

| # | Finding | What the pack does meanwhile |
|---|---|---|
| F4 | The CGT discount is not read from the reference. `tax.js` halves the gain, whatever `cgt_discount_individual` says. | The workbook reads the rate from the reference, by date, and a test holds the two together. A doctored reference moves the sheet and not the engine. |
| F5 | The reference runs the 50% discount open-ended. Research reports cost-base indexation on gains accruing from 1 July 2027, plus a minimum tax on certain gains. **That research is unconfirmed: recheck it before anything enters a rate table.** | `LAW_WATCH` in `tax.js` holds a disposal after that date back as `not found` and asks the accountant. It holds no rate, only a date to stop assuming. |
| F6 | No Division 293 threshold in the reference. | Works out Division 293 income and concessional contributions, shows the tax as `not found`, and asks. No figure is assumed. |
| F7 | No private health rebate tiers or surcharge tiers in the reference. | Shows premiums, rebate, days, and the income for surcharge purposes the engine works out. The adjustment is `not found`. |
| F8 | The low and middle income offset's income steps are typed in `tax.js`, not held in the reference. | Takes the offset from the engine in those years, entered, and says so. |
| F13 | `rebuild` has no clock. | `node-host.js` filters originals by the day they were held. A page would have to as well. Grill item 4 again. |
| F14 | `rfba_cents` is in the schema and no recipe fills it. | IT1 reads it when it is there, and otherwise says `not found`, never nil. |
| F15 | A private health statement holds one benefit code and one rebate. Real statements have two lines a year, because rates reset on 1 April. | Shows what is held. Keeps the template's instruction to enter each line. |
| F16 | The deductions recipe drops the Description column. | A row says "worksheet row" and cites the row number. |
| F17 | No shape for interest on money borrowed and not yet used. | The template's not-yet-deductible row stays, with nil. If a real household has this, the unexplained difference will not close, which is the honest failure. |

## The engine's evidence state

| # | Finding | What the pack does meanwhile |
|---|---|---|
| F10 | `tax_item.evidence` is always `held`. `add()` returns on zero cents, so the one row that would say `missing` is thrown away, and nothing sets `at_risk`. | The pack holds its own rule: a deduction resting only on a bank line or a person's worksheet is at risk; a line with no source is missing. It is an opinion, in code, in `evidence.js`. `EXPERIMENTAL.md` already marks this undecided. |
| F11 | `tax_item.refs` stops at 40 with no sign. Mia's rental costs hit it in FY2025 and FY2026. | Walks events itself rather than trusting refs. |
| F12 | The label tie reads one way. It walks the return's lines, so a label the draft has and the return left out passes. | `takeback.js` reads both directions. |

## What the Standard already does when a return comes back

Tested in `test.js`, under "what the Standard already does".

- A lodged return and a notice of assessment enter through intake like any other file, read by recipes, and become `tax_return` and `tax_line` rows. Append only.
- An amendment is a new `version`, with `supersedes_return_id`. The earlier return and its lines stay and stay readable.
- Law L11 ties the draft's taxable income to the latest version, within a dollar. `labelTies` does it label by label.
- An amended assessment posts only the change to the tax position.

What it does not do, and the pack now does: compare a draft a person actually sent with what came back, say what changed between versions, and keep the sent draft as a version of its own.

The test that shows this working is Mia's FY2023. Her return left out a fund's tax statement she already held. The draft has it, so the return comes back different at the labels that statement touches, the pack raises it, and the amended return lands where the draft already was. Both versions stay.

## Where the pack is thin

- **Tested on fiction only.** All four families are generated, and no real accountant has opened a pack.
- **`at_risk` is one rule.** It is a judgement about documents, and it is not the tax office's.
- **Open Items B has only the questions this code knows to ask.** It is a list of rules, not a reading of the year.
- **Scanned files are held back.** A file that cannot be read cannot be cleared of a tax file number, so it stays out until a person clears it. Real packs will have many of these, and a real household will find that annoying.
- **The TFN check is a shape.** Nine digits passing the check digit, or a number labelled as one. An old eight-digit number with no label gets past it.
- **Businesses, trusts, SMSFs and companies are out.** The Standard declines them. A sole trader's income shows as `not found`, with an item for the accountant.
- **Excel itself has not opened these.** LibreOffice, openpyxl and pypdf have.
- **Names are the world's.** The pack prints `party.name`, so it says Jordan and Mia until the world is renamed, and then says the new names by itself.
