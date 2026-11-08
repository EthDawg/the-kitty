# Plan: sheet version 2 to 3

Sheet: `1hgdaXJBokA6tIYvzaLvCOBkJLqA8oO6r21QsAMhTasA` ("Upgrade test: template, run H1-opus")
Note applied: CHANGES.md, "3, 8 November 2026: receipts, choices, levers and tax years".

## What I found

- `Kitty!B14` sheet_version = 2 (a number). The 2.1 changes are in place (Accounts H branches on K, Metrics C14 reads the Emergency fund goal, public_feed = no).
- 26 tabs, all from the template. None is called Receipts, Receipt Lines, Decision Options, Goal Levers or Tax Returns, so there are no name collisions.
- No tailoring found. Entries, Accounts, Goals, Decisions, Contracts and Payslips have headers and row-2 formulas but no data. Kitty `people` is blank. Category budgets are 0. No tab of the household's own holds receipts, quotes or tax returns. The only receipt field is `Entries!J` "Receipt held" (typed Y/N), which Transactions!I reads.
- The new formulas depend on these, and all match the note: `Settings!A6` = "As-of date" (value in B6). Goals columns are A Goal, B Target, E Balance now, I Saved per month over the last 3 months.
- Compliance Checks: header in row 4, checks in rows 5 to 23 (19 checks), row 24 blank, row 25 "Checks needing review" `=COUNTIF(E5:E,"Review")`. Status colours are three conditional format rules on E5:E23. Other tabs read this one by position: `Metrics!C20` reads `'Compliance Checks'!C25`, `Metrics!F20` counts `B5:B`, `Metrics!C28` counts Type = Close in `B5:B` (row numbers corrected after the read-back; the first draft said C21, F21 and C30), and `Dashboard!H29` filters `A5:G` for Review.

## What I will add (one `update_spreadsheet` batch)

1. **Five new tabs**, added after Settings so no existing tab moves: Receipts (id 401), Receipt Lines (402), Decision Options (403), Goal Levers (404), Tax Returns (405). Header row frozen and bold, like Entries and Decisions. Each tab is as wide as its headers.
2. **Headers** written as typed string cells (`updateCells`), exactly as the note gives them.
3. **Formulas in row 2 only**, exactly as the note gives them: `Receipts!S2`, `'Receipt Lines'!N2`, `'Decision Options'!I2`, `'Goal Levers'!G2`, `H2` (G2 with `rest,need-ooo` and `rate,base+opm`) and `I2`, `'Tax Returns'!I2`.
4. **Lists as dropdowns** (data validation): Receipts Channel (G), Paid with (M), Source kind (Q); Receipt Lines Group (F), Kind (G), Unit (I), GST (L); Decision Options Status (L); Tax Returns Status (C). **Checkboxes:** Decision Options Recommended (J) and Goal Levers On (D).
5. **Cell formats** so values stay as written: plain text on Receipt ID (both tabs), Merchant ID, Pack size and Retailer code (so `0783` keeps its zero); dates on Date, Decide by, Lodged; `hh:mm` on Time; dollars on money columns; `mmm yyyy` on Goal Levers dates. Blue text on the input columns of the two input tabs (Decision Options, Goal Levers), as the README's colour rule asks.
6. **Six Compliance Checks rows** in columns A to G, the same columns as the existing ones, written in **rows 27 to 32**. Row 26 stays blank as a spacer. They go below the summary row, not above it: inserting rows would move row 25, which would make Sheets rewrite `Metrics!C20` and break the rule that every existing cell reads the same afterwards. The open ranges (`E5:E`, `B5:B`, `A5:G`) already take the new rows into the review count, the checks-run count and the Dashboard list.
   - 27 Receipts that don't add up: Type Data, Items `=COUNTIF(Receipts!S:S,"Lines*")`, Status Review when above zero.
   - 28 Card receipts with no bank row: Type Data, Items and Amount as given, Status Review when above zero.
   - 29 Spending outside the bank, latest month: Amount as given, `<as-of>` = `Settings!B6`. Status Note when the amount is above zero. Type Cash (see the unclear points).
   - 30 Decisions with more than one pick: Type Data, Items as given, Status Review when above zero.
   - 31 Decisions past their decide-by date: Items as given, `<as-of>` = `Settings!B6`. Status Review when above zero. Type Data (see the unclear points).
   - 32 Lodged years without a tax pack: Type Tax, Items as given, Status Note when above zero.
   - "Why it matters" and "Where to look" are short sentences I write from the note's own why-lines, since the note doesn't give them.
   - Formats copied by value from row 23 (Arial, a `0` format on Items, a `$` format on Amount, wrapped text in F and G). Three **new** conditional format rules (OK, Note, Review) on E27:E32 copy the existing colours. The existing rules are left alone.

## Then

7. Read back every new tab's header and formula, and Compliance Checks A4:G32. Check that each new row reads OK on this empty household, that row 25 still reads the same, and that nothing shows an error.
8. Move `Kitty!B14` sheet_version from 2 to 3, as a number, as the last write, only after step 7 passes.

## What I will not change

- Every existing tab, header, formula and row, including README, Transactions "Receipt held", Metrics and Dashboard. The README's layer table doesn't list the new tabs. I leave it as it is, because the note says nothing that exists changes. I list this as a question instead.
- No rows on Decisions: there is no tailoring to map, so the note's ask-first step doesn't come up.
- No test or sample data in any tab.

## Tailoring and collisions

None found. If there had been a household tab for receipts, quotes or returns, I would have left the version 3 tab out and asked how to map it, as the note says.
