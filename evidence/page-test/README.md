# Page test

Question: a real Kitty page took 35 published versions of asks (padding, drill-downs, empty tabs, dark mode, verdicts) to get right. Can those rounds be written down once, so a one-shot page meets them?

## Set-up

The bar is `../../skills/kitty/page-bar.md`: 18 lines distilled from those versions. Each run got the fictional Davies export (`data/snapshot.json`, every tab) and this message, word for word: "Here's everything in our Kitty sheet, exported as kitty.json (every tab). Make us one page, index.html, that we can open on our phones and laptops to see how we're going." The "+ bar" arms added: "PAGE-BAR.md is our bar for the page: meet every line." One arm also got `check.js`, which renders the page at laptop and phone sizes in light and dark and saves screenshots, and was asked to look and fix for up to three rounds. Every page had to keep its data in one `<script type="application/json" id="kitty-data">` block, so a scorer can swap in other data.

Scoring (`npm i playwright`, then `node score.js RUN...`, `node more.js RUN...`, `node drawer.js RUN...`, with each run's page at `runs/RUN/index.html`): 16 of the 18 lines are scored. 13 are checked by script: phone sideways scroll, script errors, dark theme, internal IDs shown, progress as money, estimates labelled, as-of date, an empty Transactions tab, missing tabs, tabular figures, the smallest font at phone width, reduced motion, and a drawer that takes focus and closes on Escape. 3 are judged by eye from screenshots: a one-line verdict, at most four needs in order, and consistent cards. Lines 14 (category colours) and 17 (read-only) are not scored. A page with no pop-ups passes line 15 by default.

Runs were Claude Code subagents with a model override, one run per cell, on 8 November 2026. Costs are API list prices from each run's own token counts.

## Results

| Run | Lines met of 16 | Cost | Minutes |
|---|---|---|---|
| Sonnet 5.5 | 10 | $0.33 | 1 |
| Opus 5.5 | 12 | $5.94 | 19 |
| Sonnet 5.5 + bar | 16 | $0.68 | 3 |
| Sonnet 5.5 + bar + screenshot loop (2 rounds) | 16 | $0.73 | 4 |
| Haiku 5.5 + bar | 16 | $0.25 | 5 |
| Opus 5.5 + bar | 16 | $8.73 | 27 |

`scores.json` holds the scripted checks for each page.

## What it means

Opus with no bar wrote the most insightful page: it flagged four figures in the Sheet that disagree with the transactions. It still wasn't this household's page: no one-line verdict, seven asks instead of four, and no way to tap a number to see what it's made of. With the bar, every model met every scored line, and Haiku did it for $0.25. The bar keeps the value of those 35 rounds; the page code is cheap to remake.

Two pages read the same numbers and gave different verdicts ("Worth a look", "Mostly on track"). A verdict belongs on the Metrics tab, worked out once.
