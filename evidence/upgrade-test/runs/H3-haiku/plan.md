# Plan: Kitty sheet version 2 to 3 (partial, receipts held back)

Sheet: 1WnjR7SWnF8XLWnrDHePOQnASUgPfc57AT2nJF7M-TcI (title "Upgrade test: Davies tailored, run H3-haiku").
Kitty!sheet_version is 2. Note read: CHANGES.md "3, 8 November 2026" section and README-tab.md, plus the Sheet's own README tab (the Sheet wins; its README still describes the v1 shape).

## What the Sheet already has that the note touches

- Tab `Receipts` already exists (5 columns: Date, Shop, Amount, Who, Photo; five Davies phone-album rows). The note's v3 `Receipts` has 20 different columns. This is a name collision and the tailoring rule says it is a question, not an overwrite.
- Tab `Our goals` exists, not `Goals`. Its columns match what the note's Goal Levers formulas read (B target, E balance now, I saved per month, last 3 months). Plan: point the Goal Levers references at `'Our goals'`. Nothing renamed.
- Tabs `Decision Options`, `Goal Levers`, `Tax Returns`, `Receipt Lines` do not exist. No collision.
- `Decisions` exists with contract decisions (different shape). The note does not touch it.
- Compliance Checks: 20 checks in rows 5 to 24, a blank row 25, and the "Checks needing review" total in row 26 (`=COUNTIF(E5:E,"Review")`).
- Settings!B6 is the As-of date (31/01/2027).

## Steps

1. Add `Decision Options` (headers A1:N1, Total formula in I2, frozen header row). Recommended (J) is a checkbox, Status (L) list Open, Decided, Dropped, Decide by (K) a date. No data rows; the sheet has no decision options yet.
2. Add `Goal Levers` (headers A1:J1, formulas G2, H2, I2 with `Goals` mapped to `'Our goals'`). On (D) is a checkbox. No data rows.
3. Add `Tax Returns` (headers A1:N1, Result formula in I2). Status (C) list Estimate, Lodged, Assessed, Amended. No data rows.
4. Compliance Checks: insert 3 rows at row 25 (inheriting row 24's format), which pushes the blank row and the total down, and write:
   - Decisions with more than one pick (Data, Review when above zero), items from the note's formula.
   - Decisions past their decide-by date (Data, Review), items from the note's formula against Settings!B6.
   - Lodged years without a tax pack (Tax, Note), items from the note's formula.
   Status formulas follow the existing pattern (`=IF(C25>0,"Review","OK")`; Note rows use "Note").
5. Read back all changed cells and the Compliance Checks total.
6. Kitty!sheet_version stays at 2. The upgrade is not complete until the receipts question is answered, so it must not read as done.

## Not done, and why

- `Receipts` (v3), `Receipt Lines`: held back. Existing `Receipts` tab is the household's own; tailoring rule says ask first.
- Compliance checks that read Receipts: "Receipts that don't add up", "Card receipts with no bank row", "Spending outside the bank, latest month". Left out with the tab they depend on.
- Existing tabs, headers and formulas: untouched.

## Tailoring and collisions
- Receipts collision: question.
- Goals name: mapped to `'Our goals'`, flagged in the report.
- Holiday planner: not in the note; untouched.
