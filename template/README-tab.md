# The README tab

This is the text of the blank template's README tab, so an agent without Sheets access can read the contract. The Sheet itself is the authority: if the two ever differ, the tab wins.

Copy the template: https://docs.google.com/spreadsheets/d/1ym0cNBMcRtkxaQIhWFccDdz210e9nanH1B0_OCDi89U/copy

---

## Household Finance

Blank household workbook. Data runs from the earliest date on Entries to the As-of date in Settings, one month closed at a time.

## How the workbook is organised

| Layer | Tabs | Rule |
|---|---|---|
| Inputs | Settings, Kitty, Accounts, Categories, Loans, Contracts, Rules, Goals | Set up once, changed by a person. Blue text marks the cells you can change. |
| Raw data | Entries, Payslips, Decisions | One row per real-world event, append only. Imports or an AI agent add rows here and nowhere else. Correct a mistake with a new row, not by editing history. On Entries write columns A to T only; U to X are helper formulas. |
| Views | Transactions, Valuations, Assets, Subscriptions, Balances, Cash Flow, Budget, Savings Finder, Mortgage Scenarios, Tax Forecast, Compliance Checks, Net Worth | Formulas only. Each tab answers one question. Never type into them. |
| Metrics (purple tab) | Metrics | The contract for anything that draws pictures: one row per headline number with a fixed Metric ID, value, unit, period and comparison. |

## How data flows

1. Bank, payslip and valuation records land in the raw data tabs.
2. Transactions and Valuations filter Entries by Kind. Helper columns add the month, financial year, category, group and tax treatment by looking up the input tabs.
3. Each view summarises the raw data for one question.
4. Metrics pulls the headline numbers from the views.
5. Charts, emails, Claude artifacts or a phone widget read Metrics and the views. They never need to know how a number was worked out.

## Conventions

| | |
|---|---|
| Signs | Money in is positive and money out is negative in the raw data. Views show spending as positive numbers. |
| Transfers | Moves between the household's own accounts (including card payments) have Flow = Transfer and are left out of income and spending. |
| Dates | The As-of date in Settings drives every view. Change it and the months, financial year and comparisons roll forward. |
| Financial year | July to June, labelled by the year it ends: FY26 is 1 July 2025 to 30 June 2026. |
| IDs | Accounts start ACC-, loans LN-, transactions T0001 onwards. Views look rows up by ID, so IDs never change once used. |
| Colours | Blue text: inputs. Black text: formulas. Green text: links to another tab. |
| People | Person 1 and Person 2 on Tax Forecast are the first two names under people on the Kitty tab. Person on Entries and Payslips must match those names, or be Joint. |
| Emergency fund | Emergency cover on Metrics reads the balance of the Goals row named Emergency fund, so that goal must exist and link an account. |

## Working with AI

| | |
|---|---|
| Writing | An agent appends rows to Entries (columns A to T) or Payslips using IDs that exist in the input tabs. It does not edit views or Metrics. |
| Transaction rows | On Entries, Kind = transaction. Fill Settled at, Account ID, Amount (money in positive, money out negative) and Category ID. The row shows on the Transactions view. A move between own accounts is two rows, one on each account, sharing a Transfer ID. |
| Valuation rows | On Entries, Kind = valuation. One row per item on Assets dated the month end: Settled at, Account ID, and the whole balance as Amount, negative for a loan. The row shows on the Valuations view. |
| Adding an account | Write it into the first Accounts row where column A is empty, filling A to G and I to P and leaving column H alone. Do not append: column H holds a formula in rows 2 to 19, so an append lands below them. Past row 19, copy H down from the row above. Valuation method ledger balances from transaction rows; any other method balances from valuation rows and puts the account on Assets. Status must be active and Class must be a Net Worth column: Cash, Property, Super, Shares, Vehicle or Loans. |
| Reading | For a summary, read Metrics first, then the view behind any number that needs explaining. |
| Checking | Compliance Checks is the first place to look after an import. Unknown categories, duplicates and one-sided transfers show up there. |
| Closing a month | Append the month's bank rows and one valuation per item in Assets dated the month end to Entries, and the month's payslips to Payslips. Update Last used on Contracts and work-from-home hours in Settings. Then move the As-of date. The month is closed when every Close check in Compliance Checks is OK; until then Metrics close.items_missing is above zero and dashboards should say so. |

## Limits

| | |
|---|---|
| Tax | Estimates using published resident rates and simple rules. Not tax advice. Check current rates at ato.gov.au. |
| Projections | The current-year tax forecast scales the year to date to a full year. One-off deductions are not scaled. |
| Valuations | Property, super and share values are the month-end figures entered on Entries, not market data. |
