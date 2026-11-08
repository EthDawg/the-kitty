# Plan: Kitty sheet version 2 to 3 (Sheet 1SE6k3gr...)

Read first: 26 tabs, Kitty!sheet_version = 2, As-of 31/01/2027. None of Receipts, Receipt Lines, Decision Options, Goal Levers, Tax Returns exists, and no household tab keeps receipts, quotes or returns (Decisions holds contract/entry/account decisions only, which is a different thing). So no collision and no mapping question.

## Add (nothing existing is edited)
1. Five new tabs appended at the end: Receipts (A:T), Receipt Lines (A:P), Decision Options (A:N), Goal Levers (A:J), Tax Returns (A:N). Headers exactly as the note, written as typed cells; row-2 formulas only in Receipts!S2, Receipt Lines!N2, Decision Options!I2, Goal Levers!G2:I2, Tax Returns!I2. Frozen header row, dropdown lists for the listed columns (Channel, Paid with, Source kind, Group, Kind, Unit, GST, Status), checkboxes for Recommended and On. No data rows (the household has supplied no receipts, options, levers or notices).
2. Compliance Checks: six rows. Rows 24-29 are the blank spacer and the summary row, so I insert six rows at row 24 (the summary and its open-ended COUNTIF(E5:E) move down; no other cell changes), write the six checks in the existing columns A-G using the note's formulas (as-of = Settings!B6), status formula =IF(C>0,"Review"/"Note","OK") per the note's types, and extend the three status conditional-format rules over the new rows.
3. Kitty!B14 (sheet_version) 2 -> 3, last.

## Tailoring
Leave all existing tabs, headers, formulas, the Davies names and public_feed = yes untouched. Any formula that fails on the empty new tabs is fixed in the new rows only and reported.

## Questions
Note raises none that block; any ambiguity goes in the report.
