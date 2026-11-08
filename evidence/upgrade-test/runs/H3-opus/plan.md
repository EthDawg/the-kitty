# Plan: upgrade the Sheet from version 2 to version 3

Sheet: "Upgrade test: Davies tailored, run H3-opus" (1a5yzxd-e7HyJqp61IWk7XPFaYpvxgT9nFpJWtK7hDnc). Kitty!B14 `sheet_version` reads 2, so only the "3, 8 November 2026" note applies.

## What I read first

28 tabs. Against the template, this household has tailored five things:

| Tailoring | What it is | How I treat it |
|---|---|---|
| `Receipts` tab already exists | Their own tab: Date, Shop, Amount, Who, Photo. Five grocery receipts from January 2027 | The note says a name collision is a question, not an overwrite, and that I must ask before mapping it or recording it as the source. **I leave it alone and ask.** |
| `Goals` is called `Our goals` | Same columns as the template: A Goal, B Target amount, E Balance now, I Saved per month over the last 3 months | Goal Levers formulas read `'Our goals'` in place of `Goals`. The tab is not renamed. |
| `Holiday planner` tab | Their own trip budgets (Japan, Bali) | Not touched. Nothing in version 3 uses it. |
| Compliance Checks row 24 "Ava's savings below $500" | Their own check, below the template's rows, then a blank row 25 and the "Checks needing review" total in row 26 (`=COUNTIF(E5:E,"Review")`) | Kept where it is. New rows go below the total so no existing cell moves (see below). |
| Kitty `worth_it_min` = 40, `public_feed` = yes | Their own settings | Not touched. |

## What I will add

All in one `update_spreadsheet` batch with typed cells (`updateCells`). Formula columns get one formula in row 2 only. New tabs go at the end, after `Holiday planner`, so no existing tab moves.

### New tab: Decision Options (input, grey tab)
- Row 1 headers A to N: Decision ID, Question, Ref, Option, Upfront, Per month, Months, Extra, Total, Recommended, Decide by, Status, Source, Note.
- I2: `=MAP(A2:A,E2:E,F2:F,G2:G,H2:H,LAMBDA(id,e,f,g,h,IF(id="","",N(e)+N(f)*N(g)+N(h))))`
- J2:J1000 checkbox. L2:L1000 dropdown Open, Decided, Dropped.
- Money columns E, F, H, I as dollars; G a whole number; K a date.

### New tab: Goal Levers (input, grey tab)
- Row 1 headers A to J: Lever ID, Goal, Lever, On, Per month, One-off, Date if on, Date if off, Months moved, Source.
- G2: the note's formula with `Goals!` replaced by `'Our goals'!` (same columns B, E, I).
- H2: the same with this lever left out (`rest,need-ooo` and `rate,base+opm`).
- I2: `=MAP(A2:A,G2:G,H2:H,LAMBDA(id,g,h,IF(id="","",IF(OR(g="Never",h="Never"),"",(YEAR(h)-YEAR(g))*12+MONTH(h)-MONTH(g)))))`
- D2:D1000 checkbox. E, F dollars; G, H dates; I a whole number.

### New tab: Tax Returns (raw data, blue tab)
- Row 1 headers A to N: Person, FY, Status, Taxable income, Tax on income, Medicare, Offsets, Withheld, Result, Lodged, Notice, Pack, Source, Note.
- I2: `=MAP(A2:A,E2:E,F2:F,G2:G,H2:H,LAMBDA(p,e,f,g,h,IF(p="","",ROUND(N(h)-(N(e)+N(f)-N(g)),2))))`
- C2:C1000 dropdown Estimate, Lodged, Assessed, Amended. D to I dollars; J a date.

No data rows on any new tab: the household fills them from their own quotes, levers and notices.

### Compliance Checks: three of the six new rows
Columns A to G as the existing rows (Check, Type, Items, Amount, Status, Why it matters, Where to look). `<as-of>` is `Settings!B6`, as every existing row uses. Status follows the existing pattern `=IF(Cn>0,"Review","OK")`.

| Row | Check | Type | Items | Status when above zero |
|---|---|---|---|---|
| 28 | Decisions with more than one pick | Data | the note's SUMPRODUCT over Decision Options | Review |
| 29 | Decisions past their decide-by date | Data | `=COUNTIFS('Decision Options'!L:L,"Open",'Decision Options'!K:K,"<"&Settings!B6,'Decision Options'!J:J,TRUE)` | Review |
| 30 | Lodged years without a tax pack | Tax | the note's COUNTIFS over Tax Returns | Note |

Placement: rows 28 to 30, with row 27 left blank. Inserting rows above the total would move it from C26 and rewrite `Metrics!C20` (`='Compliance Checks'!C26`), breaking "every cell that existed reads the same". Below the total, every existing cell stays put, and every reader still sees the new rows: the total counts `E5:E`, Metrics counts `B5:B` and `E5:E`, and the Dashboard filters `A5:G`. I add matching OK/Note/Review colour rules for E28:E30 only; the existing rules are not edited.

### Kitty tab
- B14 `sheet_version` becomes 3 (a number, as now). The note treats a household that keeps its own receipts tab and leaves the version 3 one out as a valid version 3 sheet.

## What I will leave out, and why

- **Receipts and Receipt Lines tabs**, and the three Compliance Checks rows that read them (Receipts that don't add up; Card receipts with no bank row; Spending outside the bank, latest month). The household already has a tab called `Receipts`. The note says a collision is a question, and that mapping their tab or recording it as the source needs their answer first. Writing the checks now would point them at the household's five-column tab and read a false OK.
- Nothing on Decisions, README or any other existing tab.

## Checks after writing
1. Read back headers and row-2 formulas on the three new tabs; confirm no errors in G2:I2 of Goal Levers (empty tab, so blanks).
2. Read Compliance Checks A1:G30: rows 5 to 26 identical to before, rows 28 to 30 read 0 and OK.
3. Metrics compliance.reviews still 6; Checks run becomes 23; close.items_missing still 0.
4. Kitty B14 reads 3; Receipts, Our goals, Holiday planner unchanged.
