# Plan: sheet version 2 to 3 on "Upgrade test: Davies, run H2-opus"

Sheet: 1Fo0-USlKj3xIO_5WzE-rGP6L9B3ssEDcqM29pzSj3ws. Note applied: "3, 8 November 2026: receipts, choices, levers and tax years".

## What the Sheet looks like now

- `Kitty!B14` sheet_version = 2 (a number). 26 tabs, Dashboard first and Settings last.
- No tab is called Receipts, Receipt Lines, Decision Options, Goal Levers or Tax Returns. Nothing collides.
- The household keeps no receipts, quotes or tax returns in a tab of its own. What comes close, and why it is not one:
  - `Entries!J` / `Transactions!I` "Receipt held" is a Y flag on a bank row, not a receipt record. It stays as it is.
  - `Mortgage Scenarios` is a view that compares a refinance; it holds no quotes.
  - `Tax Forecast` is this year's and last year's estimate, not lodged notices.
  - So there is nothing to map, and no question to ask before adding the tabs.
- Tailoring I found and will leave alone: the Kitty key `worth_it_min` (no note), the README tab (older Davies text, different from README-tab.md; the tab wins and the note does not ask for a README change), Decisions rows written by the page and the iPhone app, the beta fixture accounts, and the Dashboard, which reads Compliance Checks through `FILTER('Compliance Checks'!A5:G, E5:E="Review")`.
- What the new formulas need, checked against this Sheet:
  - `Settings!A6` reads "As-of date" (`B6` = 31/01/2027). The note's `<as-of>` becomes `Settings!$B$6`, the cell every existing check uses.
  - Goals: A Goal, B Target amount, E Balance now, I Saved per month over the last 3 months. These are the columns the Goal Levers formula reads, so it goes in as written.
  - Compliance Checks: header in row 4 (A Check, B Type, C Items, D Amount, E Status, F Why it matters, G Where to look). Checks in rows 5 to 23, row 24 blank, row 25 "Checks needing review" with `C25 =COUNTIF(E5:E,"Review")`. `Metrics!C20` (compliance.reviews) reads `'Compliance Checks'!C25`. Metrics close.items_missing and "Checks run" count `B5:B` and `E5:E`, which are open-ended ranges.

## What I will add (one batch, `update_spreadsheet`, typed cells)

Five new tabs go at the end (positions 27 to 31), so no existing tab moves. Each has its headers in row 1 exactly as the note gives them, bold and frozen. The formula columns go in row 2 only, as `formulaValue`. Grid width equals the header count, with 1,000 rows. No data rows are written: the person gave no receipts, options, levers or returns.

| Tab | Headers | Row 2 formula | Lists and checkboxes (warn, not reject) | Formats |
|---|---|---|---|---|
| Receipts | A to T, as in the note | S2 Check, verbatim | G Channel, M Paid with, Q Source kind | A, E, N, O plain text; B date dd/mm/yyyy; C time; J to L money |
| Receipt Lines | A to P, as in the note | N2 Price per kg or L, verbatim | F Group, G Kind, I Unit, L GST (Taxable, GST-free) | A, O plain text; J, K, N money |
| Decision Options | A to N, as in the note | I2 Total, verbatim | J Recommended checkbox; L Status (Open, Decided, Dropped) | E, F, H, I money; K date |
| Goal Levers | A to J, as in the note | G2 Date if on (verbatim); H2 Date if off (G2 with `rest,need-ooo` and `rate,base+opm`); I2 Months moved (verbatim) | D On checkbox | E, F money; G, H date |
| Tax Returns | A to N, as in the note | I2 Result, verbatim | C Status (Estimate, Lodged, Assessed, Amended) | D to I money; J date |

The input tabs (Decision Options, Goal Levers) get the grey tab colour the other inputs use. The raw data tabs stay uncoloured, as Entries and Decisions are.

### Compliance Checks: six rows at 27 to 32

They go below the summary row, with row 26 left blank. No existing cell moves: inserting rows above row 25 would move "Checks needing review" and rewrite `Metrics!C20`. `C25`, the Dashboard filter and Metrics all read open-ended ranges, so they pick the new rows up. Formats copy row 23. Three new conditional-format rules on E27:E32 copy the existing OK, Note and Review colours. The existing rules stay as they are.

| Row | Check | Type | Items (C) | Amount (D) | Status (E) |
|---|---|---|---|---|---|
| 27 | Receipts that don't add up | Data | `=COUNTIF(Receipts!S:S,"Lines*")` | (none) | `=IF(C27>0,"Review","OK")` |
| 28 | Card receipts with no bank row | Data | note's COUNTIFS | note's SUMIFS | `=IF(C28>0,"Review","OK")` |
| 29 | Spending outside the bank, latest month | Cash (see below) | (none; the note gives none) | note's SUMPRODUCT, `<as-of>` = `Settings!$B$6` | `=IF(D29>0,"Note","OK")` |
| 30 | Decisions with more than one pick | Data | note's SUMPRODUCT | (none) | `=IF(C30>0,"Review","OK")` |
| 31 | Decisions past their decide-by date | Cash (see below) | note's COUNTIFS, `<as-of>` = `Settings!$B$6` | (none) | `=IF(C31>0,"Review","OK")` |
| 32 | Lodged years without a tax pack | Tax | note's COUNTIFS | (none) | `=IF(C32>0,"Note","OK")` |

F and G ("Why it matters", "Where to look") get one plain sentence each, taken from the note's "Why" lines. The note gives no wording for them.

The note's brackets mix Types (Data, Tax) and Statuses (Note, Review). For the two rows that name only a status, I use the existing Type that fits best, Cash, and report it as unclear. Neither is Close, so close.items_missing is unaffected.

## After the batch

1. Read back all five tabs' row 1 and 2 (values and formulas), the validations, and Compliance Checks A4:G32. Check that row 2 formulas show no errors and the six new checks read OK on empty tabs.
2. Check `N(+range)` inside SUMPRODUCT (row 29). I use one temporary cell in the new, empty Receipts tab, then clear it.
3. Re-read the cells that existed before: Metrics C, Compliance Checks C5:E25, Goals E:J and Kitty, and compare them with the values above.
4. Only then set `Kitty!B14` to 3 (a number, like the 2 it replaces), as the last write.

## Expected knock-ons

- `Metrics` compliance.reviews comparison ("Checks run", `COUNTA('Compliance Checks'!B5:B)`) goes from 19 to 25. It follows from the six new rows and is not an edit.
- `C25` and compliance.reviews stay at 6, because every new check reads OK while the new tabs are empty.

## Left out

- Nothing in the note needs the person's answer for this Sheet: there is no collision and no own tab to map.
- No README text, no data rows, no change to any existing header, formula, tab name or order.
