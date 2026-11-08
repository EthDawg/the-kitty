# Plan: apply Kitty sheet version 3 to the Sheet

Sheet: 1n_0ew5c0fcAsXGw9srsO9j_27O-ySCkdZAwarq6t31k ("Upgrade test: Davies, run H2-haiku")
Starting point: Kitty!B14 sheet_version = 2. No tab named Receipts, Receipt Lines, Decision Options, Goal Levers or Tax Returns exists, so there is no collision and nothing to map.

Read first: Kitty, Compliance Checks (rows 1 to 25), Settings (As-of date is Settings!B6), Goals, Decisions, Metrics, Transactions header. The Sheet's own README tab is an older text than README-tab.md; it does not describe any v3 tab, and nothing in the note conflicts with it on what this plan touches.

## What I will add or change

1. New tabs at the end of the workbook, typed headers in row 1, frozen header row:
   - Receipts (A to T), row 2 holds the formula in S2.
   - Receipt Lines (A to P), row 2 holds the formula in N2.
   - Decision Options (A to N), row 2 holds the formula in I2.
   - Goal Levers (A to J), row 2 holds G2, H2, I2.
   - Tax Returns (A to N), row 2 holds the formula in I2.
   Formulas are written exactly as the note gives them.
2. Dropdown lists (ONE_OF_LIST) on rows 2 to 1000, and checkboxes (BOOLEAN) where the note says checkbox:
   - Receipts: G Channel, M Paid with, Q Source kind.
   - Receipt Lines: F Group, G Kind, I Unit, L GST (Taxable, GST-free).
   - Decision Options: J Recommended (checkbox), L Status.
   - Goal Levers: D On (checkbox).
   - Tax Returns: C Status.
3. Compliance Checks: insert six rows at rows 24 to 29, before the blank row and the "Checks needing review" summary (which moves down, still counting E5 down to the end, so it picks up the new rows). The six rows, in the existing columns A to G:
   - Receipts that don't add up | Data | COUNTIF Receipts S "Lines*" | Review above zero.
   - Card receipts with no bank row | Data | COUNTIFS items, SUMIFS amount | Review above zero.
   - Spending outside the bank, latest month | Data | amount only, using the note's formula with the as-of date as Settings!$B$6 | Note above zero. Deviation: the note's N(+range) inside SUMPRODUCT does not work element by element, so I use SUMPRODUCT(condition, Receipts!J2:J) instead, which gives the same total.
   - Decisions with more than one pick | Data | the note's formula | Review above zero.
   - Decisions past their decide-by date | Data (the note's "(Review)" reads as the status, so the type is set to Data; see questions) | the note's formula with Settings!$B$6 | Review above zero.
   - Lodged years without a tax pack | Tax | the note's formula | Note above zero.
   Why and Where columns: short plain text written for each check, since the note gives none.
4. Kitty!B14 (sheet_version) from 2 to 3.

## What I will not touch

- No existing tab, header, formula, value or row order changes, apart from the inserted Compliance rows (which move the summary row down, and its count is unchanged because the new checks read OK or Note on an empty household) and sheet_version.
- Transactions "Receipt held" is not changed; it is a read-only goal of the note.
- No Entries, Receipts rows or Decision rows are written. The tabs are empty, as the note says.

## Tailoring and collisions

None found. Existing Decisions rows D0001 to D0005 are contract decisions and are left alone. The household has no Receipts or Tax Returns tab of its own.

## Questions for the person (not guessed)

- The note gives no type for "Spending outside the bank" or "Decisions past their decide-by date" (only a status word in brackets). I use Data for both.
- The note lists GST as "Taxable, GST-free" without saying which column; I put the list on Receipt Lines L (GST), since Receipts K (GST) is an amount.

## Verification after applying

Read back every new header and formula, the Compliance Checks new rows and the summary count (should still read 6), and Kitty!B14. Confirm the Metrics headline values are unchanged where they were before (compliance.reviews stays 6).
