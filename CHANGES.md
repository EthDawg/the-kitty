# Changes to the Sheet

Each heading is a sheet version. A household's own harness reads the notes since its `Kitty!sheet_version`, plans against the Sheet in front of it, writes one batch, reads Compliance Checks and moves `sheet_version` on. Say: "Read the Kitty changes since sheet version 2 and apply them to my Sheet. Show me the plan first."

Each note says why, what changes, what good looks like, and how to treat a household's own tailoring.

## 2.1, 7 November 2026: the blank template

The v2 Sheet was emptied into a blank template and tested from it. These changes let a household that is not the Davies use it.

### Accounts balance follows the account's method
- Why: Accounts H2:H19 held two position-dependent formulas, so listing accounts in another order gave silently wrong balances.
- Change: one formula in H that branches on K: `IF($K2="ledger", <ledger balance>, <valuation balance>)`.
- Good is: every account's H matches Balances for the As-of month, in any row order.
- Tailoring: keep the household's row order.

### Emergency cover reads a goal
- Why: Metrics C14 read a fixed account id, so a household without that account saw zero months of cover.
- Change: `Metrics!C14 = SUMIFS(Goals!E:E, Goals!A:A, "Emergency fund")`.
- Good is: emergency cover equals the balance of the Goals row named Emergency fund; with no such row it reads 0.
- Tailoring: if the household renamed that goal, use their name and record it on Decisions.

### Tax Forecast names come from the Kitty tab
- Why: B4:E4 and the comparisons in rows 7 and 16 were typed Davies names.
- Change: B4 and C4 take the first two names under `people` on the Kitty tab, falling back to Person 1 and Person 2; the comparisons use `$B$4`.
- Good is: Tax Forecast shows the household's own two people.

### Empty lists show nothing
- Why: with no subscription contract, or only ledger accounts, `FILTER` returned `#N/A` and it ran through Savings Finder, Metrics and the Dashboard; a month could never close.
- Change: `Subscriptions!A2`, `Assets!A2` and `Budget!A7` wrapped in `IFERROR(…, "")`; `Savings Finder!C10` wrapped in `MAX(0, …)`.
- Good is: an empty household shows blanks, not errors, and Compliance Checks can reach OK.

### Neutral starting values
- Why: the template still carried one family's budgets, names and a public-feed switch.
- Change: category budgets set to 0; Payslips and Transactions person dropdowns removed; the Dashboard's demo label removed; `Kitty!public_feed` set to `no`.
- Good is: nothing in a new copy names another household, and the bound script's feed refuses until the owner turns it on.
- Tailoring: a household that set its own budgets keeps them.

## 2, 4 November 2026: the ledger

The baseline. One Entries tab holds every bank line and valuation; Transactions, Valuations, Balances and the reports are formulas over it.
