# Verification — 4 November 2026

## Completed

- `python3 design-system/check.py`: passed. 66 Node tests (13 original engine, 26 boundary contracts, 11 components, 8 write/motion lifecycle, 5 exact-money bridge, 3 ledger-integrity checks), plus 13 Python portal/pipeline tests. **79 tests total.**
- Existing `python3 build.py`: passed; demo build generated, source application unchanged.
- `python3 design-system/build-preview.py`: passed; theme, sprite and brand embedded in a separate local build of the actual app.
- Static SVG/compatibility checks: 40 icons parse; all 16 original app IDs retained; 30 specified text/control contrast pairs passed. This is not a whole-app accessibility audit.
- Browser downloaded the three core CSVs through the portal: harbour-2027-02.csv, southern-2027-02.csv, wattle-2027-02.csv. `verify.py --download-dir` compared them to manifest SHA-256 values and passed.
- Source-to-ledger verifier: 13 local rows; unresolved merchant blocked; explicit fixture decision accepted; balances reconciled; local write/readback equal; repeat import zero rows; duplicate file zero extra rows; two same-day identical charges preserved. Matched transfer legs net to zero. Optional evidence fixtures do not run through the financial importer.
- `result.html` verifies SHA-256 of the exact saved ledger bytes before rendering. Same-row-count changes to amount or category are rejected by regression tests. Browser rendering passed after this guard was added. `result.html` rendered the saved local ledger. Browser drill into Mystery Merchant displayed original description, source row 6, source hash and the explicit synthetic decision basis.
- Browser review flow: corrected malformed option markup discovered during testing; selected Dining and confirmed the local annotation; undo restored the original state. Original amount/description unchanged.
- Canvas move button changed DOM order, compact/wide controls and reset were exercised. Layout only is persisted. Pure tests cover constrained keyboard/drag ordering. Pointer dragging itself was not separately exercised end-to-end.
- Data states exercised in browser: loading hides amounts; first use has a single source CTA; partial shows three bank rows and no card review buttons; stale labels 4 November data as observed on 20 November and pauses actions; connection error substitutes no amounts. Ask is disabled outside Ready.
- Ask fixture answer identified source/date and its demo status. Connected-data choice disclosed unavailable connection/permission; no external request. Escape closed the dialog and returned focus to Ask.
- Motion gallery: readback mismatch yielded `conflict` with no confirmation class. Explicit motion-off yielded computed animation `none`. CSS includes OS reduced-motion handling; the OS preference itself was not toggled in this run.
- Responsive lab: same-origin frames measured viewport/document widths **320/320** and **390/390** with no document overflow. Phone transaction metadata and amount are available in stacked rows. These are real browser viewports, not physical-device tests.
- Actual themed app: measured 390/390 after fixing a long-goal overflow, and fixed low-contrast muted hero text. Its original financial calculations remain unchanged.
- Light/dark browser specimens inspected. All new lab assets are local. Static local-reference checks passed after the documentation was complete.

## Not established by this work

No Google Sheets/Drive provider write or real provider readback; no live Claude capability call; no production integration of the new review/Ask/layout workflow; no physical phone install or host manifest update; no real-bank CSV certification; no tax/CGT/SMSF calculation validation; no screen-reader audit, 200% text-zoom acceptance or human usability study. The new optional monetary bridge is tested code, not automatically wired into the legacy engine.

The guide covers these remaining gates instead of claiming that an asset pack completed them. Known source issues (including pre-write onboarding celebration) are recorded in AUDIT.md; the separate visual build does not claim to fix all legacy app behaviour.

Independent final audit: exact formatting at ±maximum-safe cents, generic state provenance and bound-ledger readback fixes were re-reviewed. All 19 targeted tests passed.
