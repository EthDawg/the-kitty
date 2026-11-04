# iOS release handoff — 5 November 2026

The Kitty is a spreadsheet-backed household budgeting app with reviewed bank CSV, payslip, valuation and statement-balance intake. The user’s Google Sheet remains the financial record; import evidence belongs in their Drive. It has no bank login, payment or trading capability. On-device PDF text/OCR, typed review, controlled month close and a clean AU/AUD household setup are implemented. Local checks do not make it a verified live artifact replacement.

## Verified evidence

| Area | Observed result and limit |
|---|---|
| Shared code and services | 337 Node checks pass across template generation, setup recovery, import core/writer, goal creation, Ask, gateway, native projection and original app tests. |
| Native workflows | The broad baseline passes 165 native unit tests and 20 UI journeys. Subsequent view repairs have focused evidence: the goal-account selector passes at both sizes, and two added native Files journeys pass at regular size, with import also passing at large text on iPhone SE. These are simulator results; the broad suites were not repeated for the final button-style repair. |
| Native Files | Actual picker selection, mapping, duplicate-original detection and retained review pass. Independent readback preserves the original's exact bytes and confirmed mapping; a saved export matches all 38 filtered rows and 14 columns. See [the acceptance and retained CSV](evidence/NATIVE-FILES.md). |
| Signing | The current Apple Development-signed arm64 Release archive includes household controls, goal creation, CSV export, the recovery-alert repair, wrapping account selector and independent import-source buttons. Strict signature verification passed: `build/TheKitty-native-files-final.xcarchive`. No upload or TestFlight acceptance is established. |
| Provider primitive | The [private synthetic Sheet test](../import-service/evidence/LIVE-ACCEPTANCE.md) preserved existing rows and 1,386 inspected formulas. It did not exercise app OAuth or the hosted service. Two clean templates also pass actual Google recalculation/readback, and a first-month formula comparison matches all 21 diagnostics; see [the bounded template evidence](../templates/evidence/GOOGLE-ACCEPTANCE.md). |
| Goal append primitive | Two fictional goals calculate correctly in the private Solo QA workbook. All 2,061 pre-existing entered cells, including 1,288 formulas, were preserved. This tests production formula output through Google, not the hosted writer, OAuth or a native save; see [the exact evidence boundary](../import-service/evidence/GOAL-GOOGLE-ACCEPTANCE.md). |
| Existing artifact | Rebuilt and tested intact. |

Reproduce the Node checks from the repository root:

```sh
node --test native-core/*.test.js import-service/*.test.mjs templates/*.test.mjs setup-service/*.test.mjs ai-service/ask.test.mjs service/server.test.mjs ios/scripts/projection.test.cjs test.js
```

Repository CI now includes these checks and a macOS simulator job for native unit tests and fictional household journeys. The workflow YAML and deterministic project generation were checked locally; the new GitHub jobs have not run because this branch has not been pushed.

The [screenshot inventory](evidence/SCREENSHOTS.md) retains 167 full-resolution originals with workflow, evidence limits and verified hashes. This includes 12 native Files captures, 59 household-controls captures and the earlier 96 originals. The paired iPhone was available with Developer Mode enabled, but installation stopped at the developer-image mount because the phone was locked; a fresh installation attempt encountered the same lock. Installation and physical-phone acceptance remain unverified; unlock the phone before retrying. Raw device logs stay local because they include device identifiers.

## Document and planning extension

The added planning views retain Sheet-provided mortgage scenarios, upcoming pay, payslip history, tax periods, safety coverage and dated rental cash flow. Earlier focused planning and document runs are retained in `planning-acceptance-01.xcresult` and `source-ui-03.xcresult`. The earlier expanded run passed 90 unit tests and 12 UI journeys; the latter completed in 530 seconds with zero failures. Its shared Node suite passed 218 checks. The current counts after clean-household setup are listed above. The original artifact also builds, all four inline scripts parse, and January reimport reports zero rows to append.

The current signed archive's app binary SHA-256 is `8d760ce9077b9b28396d729d1015cf8e5e10ba670948de3981f0ee83c9490681`. The archive remains local and excluded from Git. Earlier typed, accessibility, public-feed, Activity, setup and household-controls archives are historical.

The writer now accepts one combined CSV/document proposal, keeps binary originals, preserves raw input/helper boundaries, allows statement-only evidence receipts, and separates `verified_intake` from `verified_close`. See [the protocol](../import-service/CONTRACT-2.md) and [shared record/close rules](../native-core/records-close.md). Source-backed salary and transfer decisions are explicit; a client-supplied success flag cannot close a month.

## Household controls and goal creation

The native app now exposes the Sheet's greeting, featured goal, look-ahead days, safety target and v1 subscription decisions. Edits are reviewed against freshly read headers, unique keys and exact old values. The app persists the approved intent immediately before dispatch and verifies the full target context afterwards. Unknown results are retained for read-only recovery. An explicit resolution can archive the original unverified intent alongside a freshly rechecked observation; it cannot cancel a request already dispatched. New imports, setup and goals respect these recovery holds.

Adding a goal uses the existing writer, one-shot Drive intent and atomic goal/receipt append. Its formulas use the actual appended row and preserve unavailable history. Later legitimate imports or goals do not invalidate recovery of the original verified goal. Disconnect hides unresolved records, a different Sheet cannot reveal them, and a recovery-only hold cannot create another goal. The [goal contract](../import-service/GOALS.md) records the single-writer and outside-editor limits. Native saving still requires the unconfigured hosted service.

Activity exports the exact filtered rows shown in the review, with exact cents, original descriptions and spreadsheet-safe text. Export remains accessible during search. The native Files destination picker can be cancelled without losing the review or claiming a saved file. The app creates no persistent export cache. A subsequent native save journey now has independent destination readback: all 38 selected fictional transactions and 14 columns match, including order and exact cents. The [retained CSV and verification record](evidence/NATIVE-FILES.md) establish a simulator save; physical-phone saving remains unverified.

Actual clean-Sheet readback exposed a loading defect: the period for a nonexistent largest transaction is blank. The native model now accepts that absence, and Home shows the new household's $1,234.56 opening balance with empty Activity rather than fictional transactions. Completed setup can start another household; unreadable recovery keeps its hold and offers retry. Error alerts now belong to the frontmost sheet, preserving its review after dismissal. Debug-only fixtures exercise these lifecycle states without representing them as live OAuth or hosted setup.

## Current simulator acceptance

- `parity-regular-final.xcresult`: all 165 unit tests and 20 UI journeys pass. The UI run completed in 363 seconds and includes the existing import, original-document, transfer, planning and AI-preview workflows after the shared feedback changes.
- `parity-se-recovery-export-03.xcresult`: all six setup/recovery, original-transaction and CSV-export journeys pass on iPhone SE with accessibility extra-large text and dark appearance. `parity-se-preferences-goals-02.xcresult` adds passing preference and goal-form journeys.
- Screenshot review then found a truncated goal-account picker. The wrapping labelled menu and actual account selection pass in `parity-goal-account-regular-04.xcresult` (two focused journeys, including preferences) and `parity-goal-account-se-04.xcresult` (goal entry and selection). The underlying financial/service code did not change for this layout repair; the broad suites were not repeated.
- `parity-home-visible-se-05.xcresult` passes the clean-household journey with a stricter screenshot assertion: the full opening amount must sit above the floating tab bar. This improves the evidence capture, without changing the app.
- `files-native-regular-final.xcresult` passes both native Files journeys in 99.662 seconds. `files-import-se-03.xcresult` passes the import journey at accessibility extra-large size in 182.923 seconds. Actual file selection exposed and repaired a source-row interaction where opening mapping also invoked Remove. The original, account and confirmed mapping survive relaunch; repeat selection is rejected and unresolved decisions still block Save.
- The affected practice-import/replay journey also passes in `files-export-regular-01.xcresult`. The final file-picker tests prepare a fictional provider file outside the app sandbox; CI uses the same fixture helper. The source/service logic did not change.

The earlier small-screen attempt checked a virtualized Settings row before scrolling to it. The test now scrolls before asserting reachability. That interrupted attempt has no readable completed result bundle; the successful completed runs above supply the retained evidence. Earlier export attempts also incorrectly expected a Cancel button inside the iOS 26 Files folder picker; the passing journey uses its normal sheet-dismiss gesture. These harness failures are distinct from the repaired app defects.

## Accessibility follow-up

The Ask heading, import actions and account selector now allow more room at large text sizes. Source links retain native link semantics and gain minimum touch height. Both tested simulator sizes pass the control-description, trait and hit-region check on six primary screen states. The complete visual audit still reports contrast, clipping, Dynamic Type and chart text-detection findings; these are retained in [the accessibility review](evidence/ACCESSIBILITY.md), not claimed as resolved. Actual VoiceOver use remains unverified. Independent screenshot review identified an Activity title/search collision on the small screen; an inline title at accessibility sizes repairs it. Transaction detail labels also stack at those sizes. The search-to-original-record journey passes at regular size in `activity-layout-regular-01.xcresult` and after the final large-text changes in `activity-layout-se-02.xcresult`; it asserts separate title/search frames and a hittable original transaction identifier. The broad audit was not repeated for this targeted change.

## Template and publication follow-up

The native setup flow now saves a local draft, reviews exact opening balances and requests a clean, user-owned AU/AUD workbook. The [versioned generator](../templates/README.md) uses the pinned public formula capture while replacing fictional configuration. One/two people, cash accounts and an optional savings goal are supported; tax, mortgage, assets and other optional domains remain explicitly unconfigured. Existing supported Sheets retain their broader views.

The [setup service](../setup-service/README.md) persists immutable approved settings and one-shot creation/initialization intents in the user's Drive. It verifies ownership, private access, exact cells/formulas, formats, validation and actual opening calculations. Unknown creation results cannot silently request another Sheet. Native recovery verifies the saved reservation, original approval and result binding; a failed sign-out cleanup hides the draft and retries before restoration.

Two private fictional workbooks pass full Google readback. A first inactive-month recalculation matches all 21 target-period diagnostics and the account balance. These provider primitives do not exercise hosted setup, app OAuth or a verified-close receipt. Review also repaired Google's custom-validation expansion, pre-anchor CSV intake, damaged-marker fallback, missing-value reconciliation and target-period warning changes. Setup review/relaunch passes on both simulator sizes with full-resolution screenshots. See [the template boundary](IntegrationNotes/TEMPLATE-BOUNDARY.md) and [Google evidence](../templates/evidence/GOOGLE-ACCEPTANCE.md).

New source storage and new import/close writes now require the known `public_feed` switch to be off. The app explains the setting and preserves staged originals; the service checks it independently against the current Sheet. Changing the setting after preparation is tested. Provenance, cancellation and existing receipt/unknown-outcome recovery remain available; publication is not added to historical receipt digests. The earlier publication follow-up passed 227 Node and 94 native checks; the expanded current counts are above. Two affected small-screen practice UI journeys also pass; the final raw-grid projection correction is covered by the current Node and native checks. An independent review also found that the app’s table parser could omit a feed key above its header or after a blank row; the final projection reads the complete raw grid and tests both cases. The initial native attempt used an incorrect assumption that the bundled snapshot included the live template's feed key; the fixture was corrected explicitly before the passing run. The publication-guard work did not edit a live Sheet, and the connected-state warning has not been exercised through actual OAuth. This guard does not establish private Drive sharing or eliminate races with outside editors.

## Integration before submission

`Config.local.xcconfig` currently contains Apple signing configuration only. Google client ID and service URL are blank. Read-only inspection of the available Google configuration found an older web client but no registered Kitty iOS client; no Cloud configuration was changed.

- Register/configure the native Google client and validate exact-Sheet access, onboarding, cancellation/revocation and a second user. Keep private Google project/account details out of repository documentation.
- Exercise the implemented clean-household setup through native OAuth and the hosted service, including interrupted creation, cancellation/recovery and a second Google identity. Expand optional-domain configuration only with its own evidence; the AU/AUD basic profile leaves those domains unavailable.
- Verify native preference changes and goal creation/recovery against a private supported Sheet through that configured path. A provider formula primitive or mock receipt cannot substitute for this acceptance.
- Deploy the [combined HTTPS gateway](../service/README.md) as one writer process/replica. Exercise real authentication, import recovery, same-source replay and real or sanitised bank exports through the app. Local tests and the provider primitive do not establish these outcomes.
- Configure actual AI API providers, model choices and billing limits. Validate consent, answer quality and failure behavior with approved test data before enabling provider claims.
- Publish a Kitty-specific privacy-policy URL and provide a private support contact. The in-app privacy text and collection manifest now describe processing honestly; complete store disclosures against the final hosted configuration. Finish the physical-phone run before distribution; rebuild/sign the final configured candidate and repeat its expanded small-screen and physical-device journeys.

Nothing has been published or uploaded by this handoff. App Store approval is not claimed.

## Draft metadata and reviewer narrative

**Name:** The Kitty

**Subtitle:** Your household, your Sheet

**Description draft:** Review household spending, savings goals and financial snapshots in a native app built around your own Google Sheet. Explore the fictional Davies household without an account. Review bank exports and original documents, resolve questions and duplicates, and inspect the context you choose to share with Claude or ChatGPT. Use only the live-service claims verified in the final configured candidate.

**Reviewer notes draft:** Choose **Explore the Davies demo** on first launch; no signup is required. The demo contains fictional data throughout. In Import, **Try a sample statement** opens a reviewed practice flow whose receipt stays on the device and does not write to Google. This app does not request bank credentials or execute payments or trades. Google-backed importing and embedded AI require the release service configuration; they remain unconfigured and unverified in the current candidate. Try a sample payslip to inspect the original and a persistent field review. Month-end practice shows unresolved source evidence and cannot claim a real close. Update these notes with the actual enabled routes and reviewer access after live acceptance.
