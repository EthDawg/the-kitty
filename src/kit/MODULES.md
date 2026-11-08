# Shared view modules (the-kitty `src/kit/`)

Each module is written once. Two pages use it: the public Kitty, which reads the Davies sheet in v3 shape, and the Harley Kitty, which maps its own workbooks onto the same input through an adapter. A module must not know which household it is drawing.

## Conventions (all modules)
- **Wrapper.** UMD like `src/kit/widgets.js`. In node: `module.exports = factory()`. In the page: `root.Kit = Object.assign(root.Kit || {}, { <Name>: factory() })`. No imports from engine.js. Each module carries its own small formatters, and the page may pass `opts.fmt` (money) and `opts.fmtDate`.
- **API.** `model(input) -> model`, which is pure and node-tested. `render(model, opts) -> HTML string`. `bind(el, model, opts)` uses event delegation, keeps no global state, and calls back to the page through `opts.onOpen(html)` (the page's drawer), `opts.onWrite(...)` (optional sheet writes) and `opts.onGo(target)`.
- **Styling.** Use only these shared tokens: `--bg --surface --surface2 --ink --ink2 --muted --line --accent --accent-soft --accent-ink --good --good-soft --warn --warn-soft --amber --amber-soft --r --r-sm --display --body --ease`. Both pages define them in light and dark. Class prefix `kx-<module>-`. You may compose the shared classes `card cardhead q sub say linkbtn num empty`. CSS lives in `src/kit/<module>.css`.
- **Phone width (390px).** Rows stack. No data is dropped, and nothing turns into pills that lose numbers. Tap targets are at least 40px.
- **Accessibility.** Use real buttons. `aria-pressed` on toggles, visible focus, `prefers-reduced-motion` respected. SVGs get `role="img"` and an aria-label that states the claim.
- **Charts.** Hand-drawn SVG to one scale. Every label names a value the chart reaches. Colours come from tokens only.
- **Copy.**
  - Plain words a parent understands. One word, one meaning. No em dashes, no jargon, no "not X but Y".
  - Money is `$1,234` and months are `May 2028`.
  - Every number a reader might doubt carries its source and its date, in a sub-line or the drawer.
  - Estimates say "about" and carry a chip.
- **Empty and partial data.** A module whose tab is missing returns `null` from `model` and the page leaves the view dark. One bad row is shown as a problem row; it never blanks the view.
- **Tests.**
  - `test/kit-<module>.test.js` uses the node test runner and asserts model numbers on the Davies data in `data/v3/`.
  - A demo harness `tools/kit-demo/<module>.html` is built by `tools/kit-demo/build.js <module>`. It inlines `src/tokens.css`, the module CSS and JS, and the Davies data, so Playwright can screenshot it at 1280x900 and 390x844 in light and dark.

## things.js — Things and decisions waiting (Claude writes this one)
Input `{ asOf, today, things:[...], decisions:[...] }`.
- Thing: `{id, name, group, owner, image, monthly, owed, exit, nextDate, nextLabel, confidence, contracts:[{id, product, provider, monthly, cost, cadence, start, end, exit, decision, confidence, source}], source}`.
- Decision: `{id, question, ref, decideBy, status, source, options:[{option, upfront, perMonth, months, extra, total, recommended, note, source}]}`.

The view shows decision cards first. Each is a question with a decide-by chip. Its options are a segmented choice, and choosing one shows the money for that option against the recommended one, with bars to one scale. Then come things grouped, each with its illustration, a cost a month, a next line and an exit cost. Tapping a thing opens a drawer with a contract timeline (start, today, end), every contract and its source, and "if we exit today".

## levers.js — What moves the date (Claude writes this one)
Input `{ goal:{name, target, have, planDate, recentDate, unit}, levers:[{id, lever, on, perMonth, oneOff, dateIfOn, dateIfOff, monthsMoved, source, writable}], extraDates:[{label, date}] }`.

The hero line gives the plan date. A diverging bar board follows: one row per lever, sorted by months moved. Earlier is to the left in `--good`, later to the right in `--amber`. Each row has a switch showing On or Off, and a writable lever asks before it writes. A summary line says how far the levers that are on move the date together. An optional timeline shows the extra dates (move-in and the like).

## groceries.js — Groceries from receipts (builder agent)
Input `{ asOf, receipts:[...], lines:[...], people }`. Shapes follow `CONTRACT-v3.md` Receipts and Receipt Lines, camelCased:
- Receipt: `{id, date, time, merchant, store, channel, person, items, total, gst, savings, paidWith, entryId, accountId, source, sourceKind, check, note}`.
- Line: `{receiptId, line, text, product, brand, group, kind, qty, unit, unitPrice, amount, gst, pack, ppu, code, note}`.

The model holds:
- weeks (the last 26 ISO weeks: total by merchant);
- thisWeek (total, items, receipts, against the median of the 12 weeks before);
- groups (the last 13 weeks: dollars and share by Group);
- priceWatch: products bought at least 3 times whose latest unit price (ppu where comparable, else unit price) moved 8% or more against the median 6 to 12 months before. Each carries a dollars-a-year effect at the household's buying rate and a series of points;
- outsideBank (this month: receipts with no Entry ID, by Paid with);
- receiptsList (latest first);
- boughtBefore(query), a function returning the last bought date, price, store and count;
- problems (receipts whose Check is not OK, lines with no group).

Render two things:
- A home card, "This week's shop": the total, against usual, the outside-bank note, and a sparkline of 12 weeks.
- A full view: weekly bars stacked by merchant, group shares as one horizontal bar plus a ranked list, price watch rows with sparklines, a bought-before search box, and the receipts list. Each receipt opens a drawer with its lines, GST, savings, the bank match ("Matched to T0123 on 3 Jul" or "Paid by gift card, so no bank row") and a link to the source file.

## taxview.js — Tax: this year so far, last year, history (builder agent)
Input `{ people:[a,b], asOf, current:{fy, monthsElapsed, perPerson:{name:{salary, withheld, otherIncome, rentNet, deductions:[{label, amount, flagged, why}], taxable, tax, medicare, offsets, result, atRisk}}, missing:[{label, why, when}]}, returns:[{person, fy, status, taxable, tax, medicare, offsets, withheld, result, lodged, notice, pack, source, note}] }`.

Controls: "This year so far | Last year | History" and "Together | <person a> | <person b>"; Together sums both people.
- **This year.** A big result (refund or payable) marked "about", with an Estimate chip. Below it, a waterfall to one scale (income, then deductions, then taxable, then tax and Medicare, then withheld, then the result), the flagged items showing the refund at risk, and a "what's missing before you can lodge" checklist.
- **Last year.** The lodged result per person with its status chip (Lodged, Assessed or Amended), the lodged and notice dates, and a tax pack button when `pack` is set. If there is no pack, show a line saying how to make one.
- **History.** Small multiples per person, by year: taxable income bars and result bars, amended years marked. Tapping a year opens a drawer with that year's row.

Always shown: "Estimates use published resident rates. Not tax advice."

## v3.js — the public page's adapter (not a view)
`Kit.V3` reads the five version-3 tabs from the snapshot (`fromSnapshot`) or connector grids (`fromGrids`, rows keep `_row` for writes) and maps them onto the inputs above over the engine's model: `thingsInput`, `leverGoals` and `leversInput`, `taxInput`, `groceriesInput`. A missing or empty tab maps to null. `leverDates` is the Goal Levers formulas, for a demo switch. `test/v3-page.test.js` checks each mapping gives the same input as its demo harness. Decisions behind the page layout are in `docs/v3-notes.md`.
