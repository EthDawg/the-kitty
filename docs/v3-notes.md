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
