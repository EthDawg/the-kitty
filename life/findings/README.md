# Findings

What the household runtime could not do without changing `standard/`, which belongs to the data model session. The `R-` files are this runtime's. Each is a failing case in the
style of `standard/eval/households/test.js`, marked `todo`, so it runs in CI, shows as failing and blocks nothing. The life generator keeps its own `F-` series beside them. When a fix lands, its test passes:
take the `todo` off and it stays passed. The runtime's workaround, if any, is named in each file and can then go.

| # | What | Cost today |
|---|---|---|
| R-001 | A rebuild of a household with no postings throws when metrics are asked for | The blank state needs a guard outside the engine |
| R-002 | `source` cannot record a byte-identical re-delivery, and coverage needs it | `x_delivery`, the one table this runtime adds |
| R-003 | `reference/au.json` says `verified_at: null` | The runtime carries the date in `defaults.json` |
| R-004 | `standard/engine` needs `src/engine.js` for merchant lookup, as module-global state | `src/engine.js` cannot retire, and the bundle carries 70 KB of v2 engine |
| R-005 | A month with evidence for only three days of it reads as `lockable` | The runtime decides what a whole month is |
| R-006 | A pay with no payslip can never lock | The runtime reads `scope payroll = none` as the answer |
| R-007 | `managedTabCheck` proposes a decision row that fails the schema | The runtime stamps `at` on it |
| R-008 | `rebuild` writes on the observations it is handed | The runtime copies them first |
| R-009 | Default categories and the tax map live inside the Davies world | Copied to `defaults.json`, with a drift test |
| R-010 | `scope.domain` has no vocabulary | The runtime uses the Davies world's words |
| R-011 | An opening from a statement sits on top of lines older than it, which it already holds. Blind run F043 | `clock.js` moves the opening back in a second rebuild. Patch: `R-011.patch` |
| R-012 | A public dictionary match decides money coming in. Blind run F007 to F009 | `clock.js` blanks the line for a second rebuild, so it reaches review. Patch: `R-012.patch` |
| R-013 | A payslip for someone who is not a party stops the whole rebuild | `add.js` aliases the name to a household's one adult. Two adults still throws |

A claim here was once retracted. Lines on an unresolved account were written down as dropped in silence; the fixture passed, because the engine raises `unresolved_account` and L4 fails. The fixture is the test of the finding, not the prose.
