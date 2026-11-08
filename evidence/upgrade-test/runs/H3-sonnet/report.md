# Report: Sheet upgrade 2 -> 3 (Davies sheet)

Done: added Decision Options, Goal Levers and Tax Returns (headers, row-2 formulas, checkbox and list validation). Added 3 Compliance Checks rows (rows 25-27, inserted above the blank row so the "Checks needing review" total still works). Set Kitty!sheet_version to 3. Logged D0020 on Decisions.
Left out: Receipts and Receipt Lines (the household already has its own 5-column Receipts tab: Date, Shop, Amount, Who, Photo), and the three Receipts-based Compliance Checks.
Tailoring: Goals is called "Our goals" here, so Goal Levers G2/H2 read 'Our goals' (same columns A, B, E, I). Recorded on Decisions D0020.

Questions for the person:
1. Receipts: do you want your Receipts tab kept as the source and the version 3 receipt tabs left out for good, or should I add Receipts and Receipt Lines under another name, or build them as formulas over your tab? (Your tab has no line items, GST or card link, so a full mapping loses detail.)
2. Confirm 'Our goals' is the Goals tab (I assumed so; no tab is named Goals).

Compliance Checks, new rows: Decisions with more than one pick = 0 OK; Decisions past decide-by date = 0 OK; Lodged years without a tax pack = 0 OK. Existing rows unchanged (total still 6 Review). The three tabs hold no data yet. A temporary test lever row on Goal Levers worked (Date if on 01/11/2030, Date if off Never, Months moved blank because off is Never), then was cleared.

Unclear in the note: Status text for the tax check ("Note" vs "Review") and the Months moved blank when one date is Never; the Source column and Compliance "Why/Where" wording were mine. The note says the formulas "fill the column" (MAP spills); Goal Levers G2 spills into a single row only because no data yet. Receipts-based "Spending outside the bank" row's blank-month logic untested since left out.
