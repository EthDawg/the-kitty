# Sheet version 3 on the public page

What the public Kitty (the fictional Davies household) does with the five tabs CHANGES.md version 3 adds, and why it is laid out this way. Everything shown is fictional.

## The tab bar: Home, Activity, Insights, Goals, Things, Tax

Six tabs, each one word, so the phone's bottom bar stays readable at 390px (about 65px a tab, icon and label).

- **Things** is new: what the household pays for, grouped, and the decisions waiting on it (Decision Options), each option costed on one horizon.
- **Tax** is new: this year so far, last year and history, from Tax Returns and the Tax Forecast.
- **Setup** leaves the bar for the header (the sliders button, labelled "Setup" on a wide screen). It is where an owner connects a sheet and reads how the page works: something you visit once, not every day.
- **Records does not fold into Tax.** Records is the standard's preview: it rebuilds the household's record from its own copy of the Davies files (2,354 of them, to 31 Mar 2027), and its figures differ from the sheet's (its FY27 draft for Jordan is $99,869 taxable; the sheet's estimate is $133,746, projected to a full year). Putting both on one page would invite "which one is right?". So Tax ends with a card, "The record behind a return (Preview)", that says this and opens the record as a page of its own under the Tax tab, with a back link. The record's own "Things" list (appliances and warranties) stays inside the record, apart from the Things tab.

## Groceries live in Insights

The full Groceries view (lead, weekly bars by shop, where it goes, price watch, bought before, receipts) is the last section of Insights. Insights is "where the money goes", and groceries are that question answered from receipts rather than bank lines. A seventh tab would break the phone bar. Home has the "This week's shop" card; its "Groceries →" opens Insights at the section. Each receipt opens a drawer with its lines and the bank match: "Matched to the Rewards credit card charge of $403.95 on 24 Jan", or "No bank row" for a gift card, cash or points.

## Goals: what moves the date

Goals gains the lever board under the lead goal. The goal shown first is the lead goal if it has levers; otherwise the goals behind, the one whose levers move the date most first. For the Davies that is the Offset buffer (the lead goal, the Japan trip, is reached and has no levers). A segmented control switches to any other goal with levers (the Emergency fund has one).

- **Live, owner:** a switch asks first (the module's confirm step), then finds the lever's row by Lever ID on a fresh read, writes only `'Goal Levers'!D{row}` with `update_values`, and reads the tab back. The sheet's formulas move the dates; the page only redraws.
- **Live, read only:** the switches show On or Off and the board says to switch levers on the sheet.
- **Demo:** the confirm step says it is the demo household; the date is worked out on the page with the Goal Levers formulas (the same rules as columns G, H and I) and a toast says nothing was saved. test/v3-page.test.js proves the page's formulas give every date in data/v3/goal-levers.csv.

## Home

Two more cards after "What needs you": the nearest decision (its options to one scale, our pick marked) and this week's shop. Each appears only when its tab has something to say, and a card that fails to draw is left off without blanking Home.

## Data plumbing

- `src/kit/v3.js` reads the five tabs from the bundled snapshot (demo) or connector grids (live), and maps them onto each module's input over the engine's model. The mappings are the ones `tools/kit-demo/*.data.js` use; test/v3-page.test.js checks the page gives each module the same input as its demo harness.
- Live mode reads `Receipts`, `Receipt Lines` (in 2,500-row chunks, like Entries), `Decision Options`, `Goal Levers` and `Tax Returns`. All five are optional: a missing tab reads as nothing and its view stays dark. The ledger check accepts `sheet_version` 2 or 3.
- The snapshot carries the keys `receipts`, `receipt_lines`, `decision_options`, `goal_levers`, `tax_returns`, built by `tools/v3_snapshot.py` from data/v3 and data/groceries with the feed's keys and typing (`--check` runs in CI). The Apps Script feed and `tools/grid_to_snapshot.py` carry the same tabs. The snapshot's `sheet_version` stays 2 until the demo sheet itself is upgraded and snapshotted again; the page keys each view on its tab, never on the version. The ledger fixtures drop the five keys, so they stay version 2 households.
- **Dark means no tab button, no card, no section.** Things lights from Contracts alone (a version 2 household keeps its things) and shows decision cards only with Decision Options. Tax lights with Tax Returns, or with the record when one is bundled.

## Cohesion

The modules use the page's tokens, cards (22px radius), type and 16px gaps. Two seams were fixed in place:
- The brand's accent palettes (lime for the Davies) have light values only, so in dark the soft accent was light under light ink: the lever confirm step and the gift-card note were unreadable. The version 3 views carry dark accent values (`src/v3-views.css`) until brand/tokens.json gains dark accents; the older views are unchanged, so the kit gallery's screenshots still match.
- The Things illustrations are drawn for a light ground; in dark they sit on a lighter plate so their darkest parts still read.

## Open

- The Davies data says Kayo was decided "Cancel" on the Decisions tab (D0004, 3 Nov 2026) while DQ-002 still asks whether to keep, pause or cancel it, so the Kayo contract is gone from Things while its decision card stays. One of the two should change in data/v3 or the snapshot.
- `tools/check_shape.py` rejects the top-level `test/` folder that MODULES.md asks for (it fails on v3/contract already). Either the allowlist gains `test/`, or the kit tests move under `tools/`.
- Brand: dark values for the lime, teal and coral accents belong in brand/tokens.json and the generator, for every view.

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
