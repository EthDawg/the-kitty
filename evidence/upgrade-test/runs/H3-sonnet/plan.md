# Plan: Sheet version 2 -> 3

Found: sheet_version 2. Household tailoring: `Receipts` tab already exists (Date, Shop, Amount, Who, Photo; 5 phone-album rows), a `Holiday planner` tab, and Goals is renamed `Our goals` (same A/B/E/I columns as Goals). Compliance Checks has 19 rows, a blank row, then the "Checks needing review" total.

## Add
- Decision Options (headers, I2 formula, Recommended checkbox validation, Status list)
- Goal Levers (headers, G2/H2/I2 formulas, On checkbox). Formulas point at 'Our goals' instead of Goals (the household's name for the same tab). Recorded on Decisions as D0020.
- Tax Returns (headers, I2 formula, Status list)
- Compliance Checks: 3 new rows inserted above the blank row (the total keeps working): Decisions with more than one pick, Decisions past their decide-by date (as-of = Settings!B6), Lodged years without a tax pack.
- Kitty!sheet_version -> 3 (B14) once checks read fine.

## Leave out (questions for the person)
- Receipts and Receipt Lines: name collision with the household's own Receipts tab. The note says collision is a question, not an overwrite, and to ask before mapping. Not touched. Receipt Lines depends on Receipts, so it is left out too.
- The three Receipts-based Compliance Checks (Receipts that don't add up, Card receipts with no bank row, Spending outside the bank) are left out; they would read the household's 5-column tab and give wrong answers.

## Not touched
Every existing tab, header and formula. Holiday planner, Our goals, Receipts unchanged.
