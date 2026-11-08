# Version 3 notes: the public page audit

The public page was audited on 8 November 2026 by a cold reader (47 defects, from three severity 1 numbers to polish). This branch fixes them in the page's reading. The sheet itself is never edited from here: where one of its own formulas is wrong, the fix is written up in `CHANGES.md` under version 3, Fixes, for a household's harness to apply.

## What the page now reads from the rows, and why

| Figure | The sheet said | The page shows | Why |
|---|---|---|---|
| Safety net shortfall | (page back-solved) $63.4k | $17.2k | The metric is the Emergency fund goal over essential spending ($7,345 a month, the Essential categories over three months), not all cash. |
| Price rises to push back on | $4,718 a year | $314 a year | Bupa's "lowest charge" was a $31.20 premium adjustment. |
| Cancel unused subscriptions | $1,109 a year | $1,349 a year | Paramount+'s "latest charge" was a +$9.99 refund. |
| Doubled charges to check | $2,714 once | $296 once | Two Qantas fares, each with a receipt and a note, are two tickets. |
| Car insurance | $312, renews 15 Jan 2028 | $1,348, renews 14 Aug 2027 | The $312 row is travel insurance filed under Holidays. |
| Ways to save, a year | $11,884 | $7,720 | The sum of the ideas above, rebuilt. |

Each drawer shows the sheet's figure beside the page's, and the trust drawer lists every difference. `E.checkAgainstRows` in `src/engine.js` is the one place this happens; `test-v2.js` pins each number.

## Decisions waiting on a person

1. **Page bar line 17 says the page never changes the sheet. For an owner it does.** Every write is now listed in one place (`WRITES` in `src/app.js`, shown on Setup under "What this page writes"), and Goals, Activity and Privacy tell the same story. Either change line 17 to "The page reads the sheet; for the owner it writes only the cells it lists, each behind a click", or take the writes out. I did not edit `skills/kitty/page-bar.md`.
2. **The emergency fund has two targets.** The Goals row says $30,000 by 31 Dec 2026 (4.1 months of essentials). Settings says 6 months ($44,069). The page shows both, on one need and on the safety card. The household should pick one, or the Goals target could become a formula over the Settings months.
3. **Records is a different household.** It is now labelled "A separate dataset" with a plain explanation. Taking the tab off the public build needs a `shell.html` tab-bar change, which belongs to the v3 views branch. Wiring it to the sheet is the lasting fix.
4. **ATO item 21 letter.** The standard's world files other rental deductions under `21X` (`standard/world/domains/tax.js:22` and `:80-87`). To our reading the return's label is U. I could not verify it online today, so the page prints "item 21" without a letter. Changing the world regenerates `data/standard-view.json` and the standard's locked numbers, so it is left for that branch.
5. **Is a refunded charge "still charging"?** Paramount+ charged on 19 Jan 2027 and refunded on 24 Jan. The sheet's flag says still charging; the page keeps the flag and says "refunded 24 Jan".
6. **Old review items in a closed month.** The queue holds rows from March, July and December 2026 while January is closed. Should a month close only when its queue is settled? The page now collapses the queue to one line so it no longer buries this week's spending.
7. **Cancelled contracts.** Disney+ and Kayo carry Cancel decisions but stay `active` on Contracts. The page leaves them out of the Contracts tile; the sheet could set their status.

## Found while fixing, not in the audit

- An unsized chevron filled the sheet's checks drawer with giant arrows (it was there before; the audit's screenshot shows it). Fixed.
- Budget pace's note widened the phone layout to 432px; the audit's overflow check compared against the widened width and missed it. Fixed, and the screenshot script now checks against 390px.

## Left for other work

- Mia's FY26 forecast has no low income tax offset (about $86 at $60.9k): a Tax Forecast formula, for the v3 tax view and the sheet.
- A Records refund for Mia lands in "Jordan's old everyday": the standard's world data.
- Alex's weekly questions ("is there enough in Everyday joint for tomorrow's bills?", "this week against a usual week") are new views, not fixes.

## For the v3 views branch

- `m.contracts` arrives corrected (car insurance's amount and next date follow the CAR rows), and each contract carries its `decision` from the Decisions tab. The Contracts tile treats a Cancel decision as ended (`live` in `src/kit/widgets.js`); the Things view should use the same rule.
- "Things" on Home means vehicles and devices on the Accounts tab. Records' card is now "When things need replacing". Keep one meaning when the Things tab lands.
- Months are "Jun 2027" everywhere (`E.fmtMonth(s, true)`), never "Jun 27".

## How it was checked

- `node --test test.js test-v2.js tools/ask-skills.test.js tools/ask-routing.test.js test/kit-things-levers.test.js`: 113 pass. New tests cover the safety net, subscriptions, savings ideas, duplicates, needs order, formats and the rental one-off.
- The page's Playwright specs (`portals/test/canvas.spec.js`, `ledger-read.spec.js`, `kit.spec.js`): 25 pass locally. The canvas tests now move other widgets, since Review is a line in What needs you, and open the demo with `?signals` to exercise the "new on Home" note the public demo no longer shows.
- Every tab and 32 drawers and toggles screenshotted at 1280x900 and 390x844, light and dark: no console errors, no sideways scroll at 390px, no "Mon YY" date, no internal ID outside file names, nothing under 12px.
- Light and dark contrast: no text element below AA on any tab (colours given as `color-mix` are not measured).
- Layout shift at load: 0.0009 on desktop (was 0.032), 0.003 on a phone.
- An empty sheet and a broken sheet (Subscriptions not a list, a nameless goal, Budget a string): no errors; each tab says what it cannot show.

## Before this merges

- The kit gallery's CI baselines (`docs/screenshots/kit/ci/*.png`) must be refreshed from a CI run: list amounts now carry cents, a row with no category offers no "Looks right", and the colours changed. Fonts differ on a Mac, so they cannot be made here. The local renders in `docs/screenshots/kit/` are current.
- `tools/check_shape.py` fails on the top-level `test/` folder, which came with `v3/contract` (commit 9a30c8d), not this branch.
