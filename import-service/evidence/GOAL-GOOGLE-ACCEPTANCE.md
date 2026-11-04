# Goal append primitive — 5 November 2026

Two fictional goals were appended to the existing private Solo QA workbook using the production `goalCells` output and Google Sheets `appendCells`. The first landed on row 2; the second landed on row 3. Their formulas use the actual row at calculation time.

Google recalculated both targets, linked-account balances, progress and required monthly amounts without a formula error. The existing account balance remained $1,234.56. Both goals correctly retained “Awaiting three months of history”; an unavailable savings average remained blank. The second append preserved the first goal's ten entered cells exactly.

Comparison with the prior saved Google readback found all 2,061 existing entered cells unchanged, including 1,288 formulas. The two rows introduced twelve new formulas. The [sanitized readback fixture](goal-append-google.json) retains their exact entered cells and all native projection grids. The regression checks compare production cells with those actual Google results, then exercise the native JavaScript projection.

The check also exposed the template's exact `Target amount ($)` header, correcting an overly short header expectation in the native existing-goal and featured-goal editors.

This was a provider primitive run through the connected Sheets tools. It did not exercise app OAuth, the hosted goal writer, Drive intents, a service receipt, another Google identity or a physical phone. No synthetic service receipt was inserted. The July as-of date came from the earlier formula-recalculation probe; this check does not establish a verified month close. The public Davies Sheet was not changed.
