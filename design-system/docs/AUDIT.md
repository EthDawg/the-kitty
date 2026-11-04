# Audit of the first design kit and current app

Reviewed 4 November 2026 against the actual public source in this checkout. The original kit was a visual starter, not a complete implementation system. The v2 work keeps useful artwork and icons and adds executable contracts and scenarios.

| Finding | Why it matters | This delivery / remaining boundary |
|---|---|---|
| PNGs, tokens and icons had no executable workflow states | A developer would invent error/loading/review behaviour | Component lab, state catalogue and lifecycle helper supplied |
| No motion assets or verification gate | Animation could imply a save or reconciliation that never happened | Finite CSS/SVG motion and tested write/readback lifecycle |
| First preview was detached from the actual application | Its visual quality did not prove compatibility | `build-preview.py` applies brand, sprite and tokens to a separate build of the existing app |
| Hero's `.muted` utility inherited low-contrast text | Household name became hard to read against teal | Scoped hero-muted override in v2 tokens |
| Long goal name/amount combination widened the 390px canvas | Small-screen reading required overflow | Flexible goal header and minimum-width fix in v2 tokens |
| Source provenance was described but not a typed component contract | Unknown could become zero, stale could look current | Typed contract, tests, source drill and labelled states |
| No source portal or actual downloadable evidence | Could not rehearse a realistic onboarding/import journey | Fictional multi-brand portal plus core adapters and local readback verifier |
| “All scenarios” had no bounded definition | Easy to fill the app with incomplete domains | Executable core scenarios and an explicit contract-only roadmap |
| Generated raster icon differs slightly from editable SVG | Treating one as an exact trace would be misleading | Raster primary identity; geometric vector companion documented |
| Existing app celebrates during onboarding before Sheet writes finish (`finishOnboarding`) | Success-like feedback precedes evidence | Identified; lifecycle helper is ready to replace that behaviour in a subsequent app integration. Existing behaviour is not silently rewritten by the visual build |
| Existing source shows possible duplicates as money “to recover” | Suspicion is not an established refund | New brief requires “Review possible duplicate”; existing source copy is unchanged |
| Existing app mixes local demo edits and live writes | A showcase could overclaim provider completion | Demo labels and explicit provider acceptance boundary throughout |

## Decisions

Keep the vanilla, single-file publishing model; a design system is a collection of stable contracts and reusable components, not a framework migration. Keep the Sheet as canonical for current financial numbers. New records are versioned staging/evidence envelopes until a deliberate migration is approved and verified. Keep the detailed cat artwork out of dense ledger rows.

The first meaningful expansion is import/review/evidence quality. Broad domains get real contracts and synthetic fixtures now, and working financial views only after their adapters and reconciliation earn them. Discovery offers a module; it does not move the household's home screen without consent.

## Limits

Static contrast checks cover specified pairs, not every possible legacy style or dynamic state. Browser checks cover the included local specimens and themed copy; they are not an accessibility certification, a physical-device install test or a real household/provider run. Original source screenshots are historical evidence, not evidence of this change. See VALIDATION.md for the actual checks completed in this turn.
