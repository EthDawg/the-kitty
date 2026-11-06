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

The `H-` files are the harness's, from playing the whole life on the runtime. Same rule: a `todo` test that fails today and blocks nothing. Each was run with its `todo` removed to check it fails for the reason it gives. `H-009` and `H-010` are a preview of separation, which is not built.

| # | What | Holds | Cost today |
|---|---|---|---|
| H-001 | Nothing knows the value day of 30 June 2027, or that one disposal spans two regimes. Unconfirmed law | T4-CGT-VALUE-30-JUNE, T5-CGT-TWO-REGIMES | Silently wrong |
| H-002 | A bond that comes back short loses the charge | T5-BOND-BACK | Silently wrong |
| H-003 | `asset_fact` is in the vocabulary and nothing reads it | T5-WARRANTY | Silently wrong |
| H-004 | `tax.js` reads pre-fill in cents and the public recipe gives dollars, so it never fires | T6-PREFILL-WRONG-PERSON | `status.js` compares them itself |
| H-005 | A credit saying SALARY reaches the dictionary first, so a hospital's pay reads as a health refund. Found only by variants | T1-SALARY-NO-PAYSLIP | Silently wrong until the payslip arrives |
| H-006 | Adopted setup takes `recorded_at` at transfer time, except a term, which the engine orders against notices by that column | GOAL primitive 2 | The one exception to the law |
| H-007 | L14 judges a quarter past the fund's own evidence | | `next` steps past it, status still counts it |
| H-008 | L4 fails a bill whose bank line has not arrived | | `next` treats it as waiting |
| H-009 | A shared child is a standing link, and `link` stops at the edge of one Kitty | GOAL primitive 4 | Not built |
| H-010 | A store cannot say who can open it, so a split cannot warn that the other person still sees the sheet | research A3 | Not built |

`friction/` is the ledger: `ch00-baseline.jsonl` as the blind run left it, `scripted.jsonl` from the harness. `node life/friction.js` prints what is unlanded.

A claim here was once retracted. Lines on an unresolved account were written down as dropped in silence; the fixture passed, because the engine raises `unresolved_account` and L4 fails. The fixture is the test of the finding, not the prose.
