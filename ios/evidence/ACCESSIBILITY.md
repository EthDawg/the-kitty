# Accessibility review — 5 November 2026

The six checked screen states pass the platform audit for control hit regions, descriptions and traits on both tested simulators. This is a bounded control check, not full accessibility acceptance. The [diagnostic record](accessibility-audit.json) retains every visual finding, including findings still reported after the layout changes. VoiceOver and physical-device review remain outstanding.

## Changes and verification

- The Ask heading can grow vertically, and its decorative cat yields its space at accessibility text sizes.
- Import account selection has its own full-width control with a persistent label and accessible selected value. A UI journey verifies that CSV choice stays disabled until an account is selected. It does not prove a real file's account binding.
- Import actions and source links have a 44-point minimum label height; import labels and the practice badge can wrap. Import section headings have explicit scalable text and foreground colors.
- Activity uses a shorter search prompt. Searching still reaches the original transaction evidence.

`accessibility-repair-02.xcresult` passes the six-screen control audit and account-selection journey on iPhone 17 Pro with default text and light appearance. `accessibility-se-03.xcresult` passes the audit and five affected journeys on iPhone SE with accessibility extra-large text and dark appearance: activity search, AI consent preview, document confirmation/relaunch, account selection, and unresolved-import save blocking. The latter six tests completed with zero failures in 169 seconds. They supplement the earlier full 90-unit/12-journey run; the entire suite was not repeated for these view changes.

The [test](../KittyUITests/KittyAccessibilityTests.swift) collects all platform findings, retains JSON and screenshots, and asserts that control findings are absent. Contrast, text clipping, Dynamic Type and text-detection findings are diagnostics requiring review. They are not silently counted as passed checks.

## Remaining visual findings

| Screen state | Regular size | Small screen, large text |
|---|---:|---:|
| Home | 2 | 2 |
| Activity | 8 | 2 |
| Insights | 11 | 1 |
| Goals | 0 | 2 |
| Ask | 3 | 2 |
| Import | 10 | 4 |

These counts describe different visible viewports; they are not a measure of improvement. The initial regular-size diagnostic had 35 findings; the later regular run has 34 and the small-screen run has 13. All three records are retained.

Several contrast reports identify text beneath the floating tab bar or beyond the viewport. The disabled Ask button is also reported. The regular-size Insights audit reports five potential text-detection issues without identifying an element; the chart has an exact-value text alternative, but that does not establish VoiceOver usability. Dynamic Type/text-clipping findings remain for native controls, the Ask heading and import labels. They remain open for review, even where the inspected screenshot shows the complete text at the tested size.

Inspected originals show the complete [large-text Ask heading](screenshots/accessibility-se-ask.png), [wrapped practice badge](screenshots/accessibility-se-import.png), and [selected account and CSV action](screenshots/accessibility-se-25-import-account-selected.png). The screenshots preserve the viewport; content below it requires scrolling. The [inventory](screenshots/inventory.json) includes their hashes, workflow, result and evidence limits.

Before accessibility acceptance, check VoiceOver focus order and spoken financial values, chart navigation and exact figures, original-document review, all supported large text sizes, and live Sheet links on a physical phone. No result here establishes live Google access, hosted writes, AI-provider delivery or store approval.
