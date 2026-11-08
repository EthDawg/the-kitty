# The page bar

What a household money page has to do. Each line came from a real round of changes on a real Kitty page (36 published versions, then the public edition), so a new page can start where those rounds ended.

## Say the answer first
1. Open with one verdict line that answers "how are we going?" (for example "On track", "Mostly on track", "Worth a look") and the reason in a few words.
2. Under it, at most four things that need a person, most serious first: failing or review checks, a goal falling short, a bill or renewal soon, spending well over the usual pace. Nothing else competes with them.
3. State progress toward a goal as money: "$26.9k of $30k", "$3.1k to go". A bar can carry the share; words carry dollars.

## Every number can be trusted
4. Tap any headline number to see what it is made of: the rows or parts that add up to it and the tab it came from.
5. Anything estimated (tax forecasts, projections) says so beside the number. Never present an estimate as confirmed.
6. Show the as-of date of the data, and say plainly when the month is not closed or a check is failing. Say whose date a number is: "spent by 5 Nov, the latest bank rows, 3 days ago", never the last import's date as if it were today.
7. Never show internal IDs (account IDs, category IDs, metric IDs, transaction IDs) to a reader. Use the names.
8. Every percentage carries its count or its dollars beside it, and no percentage change is drawn on fewer than three items. One large row can swing a percentage; the dollars show it was one row.

## It survives bad data
9. If a tab is empty (for example no transactions yet), say so in words ("No transactions yet") instead of showing $0 as good news.
10. If one part fails to draw, that part says so and the rest of the page still works.

## It is calm on every screen
11. Works at 390px phone width with no sideways scrolling and nothing lost: lists stay lists, numbers are not cut off.
12. Light and dark themes are both designed, following the device setting.
13. Repeated items (cards, rows, chips) share the same padding, height rules and alignment. Nothing jumps or reflows after the page has loaded.
14. Money is in dollars with tabular figures so columns line up. Large figures are shortened on small tiles ($26.9k).
15. Each spending category keeps one colour everywhere it appears.
16. A drawer or pop-up is a proper dialog: focus moves into it, Escape closes it, focus returns to what opened it.
17. Motion is gentle and stops under reduced-motion settings.

## It opens fast
18. Read each workbook in one batched call (`get_spreadsheet` with `ranges`), not one range at a time, and paint from the connector's cache straight away; then check for newer rows behind it and say while it is checking. Measured on a real page: 56 calls a load became 13.

## It helps decide
19. A decision is a card, not a chart: every option costed over the same horizon, anything still owed at the end counted, the pick marked, the source named.

## It stays honest about what it is
20. The page reads the sheet. A write is one named cell, asks first in words that say what changes, and reads it back.
21. One headline per card, plain words, no tiny print.
