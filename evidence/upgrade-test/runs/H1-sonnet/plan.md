# Plan: sheet version 2 to 3 (H1-sonnet)

Read first: 27 tabs, none named Receipts, Receipt Lines, Decision Options, Goal Levers or Tax Returns, so no collisions. The Sheet is an empty template: Entries, Decisions, Goals, Settings hold no household data, no tailoring found. Kitty!sheet_version = 2; Settings!B6 is the As-of date; Compliance Checks rows 5-23 are checks, row 24 blank, row 25 the "Checks needing review" total.

1. Add five tabs at the end (addSheet), headers in row 1 via typed cells, formula column in row 2 only:
   - Receipts (A1:T1; S2 check formula), Receipt Lines (A1:P1; N2), Decision Options (A1:N1; I2), Goal Levers (A1:J1; G2,H2,I2), Tax Returns (A1:N1; I2).
   - Headers bold; no data rows (nothing to record).
   - Checkbox validation on Decision Options J and Goal Levers D; list validation for Status, Channel, Paid with, Source kind, Group, Kind, Unit, GST.
2. Compliance Checks: insert 6 rows at row 24 (before the blank row) so the total row moves down and keeps its formula; write the six checks with the note's formulas, As-of = Settings!B6, Status =IF(C>0,"Review","OK") (Note type for the outside-bank check shows OK/Note by amount), and extend the OK/Note/Review conditional formats over the new rows.
3. Kitty!B14 (sheet_version) -> 3.
4. Nothing existing is renamed, reordered or rewritten. No open question in the note applies (no household tab for receipts/quotes/returns).
5. Read back all new formulas and Compliance Checks; fix if errors.
