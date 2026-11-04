# iOS release handoff — 5 November 2026

The Kitty is a spreadsheet-backed household budgeting app with reviewed bank CSV, payslip, valuation and statement-balance intake. The user’s Google Sheet remains the financial record; import evidence belongs in their Drive. It has no bank login, payment or trading capability. On-device PDF text/OCR, typed review, controlled month close and a clean AU/AUD household setup are implemented. Local checks do not make it a verified live artifact replacement.

## Verified evidence

| Area | Observed result and limit |
|---|---|
| Shared code and services | 314 Node checks pass across template generation, setup recovery, import core/writer, Ask, gateway, native projection and original app tests. |
| Native workflows | The full native run passes 123 tests plus the new setup journey in [household-native-final.xcresult](evidence/household-native-final.xcresult). A subsequent Australian month-boundary fix passes all seven focused draft tests, including its new regression, in [household-date-final.xcresult](evidence/household-date-final.xcresult). The setup journey also passes on the small phone at accessibility extra-large in [household-ui-se-04.xcresult](evidence/household-ui-se-04.xcresult). Earlier full and affected UI runs remain preserved below. These are simulator results. |
| Signing | The current Apple Development-signed arm64 Release archive includes clean-household setup, durable recovery, the opening-date guard and the Australian calendar correction. Strict signature verification passed: `build/TheKitty-household-date-final.xcarchive`. No upload or TestFlight acceptance is established. |
| Provider primitive | The [private synthetic Sheet test](../import-service/evidence/LIVE-ACCEPTANCE.md) preserved existing rows and 1,386 inspected formulas. It did not exercise app OAuth or the hosted service. Two clean templates also pass actual Google recalculation/readback, and a first-month formula comparison matches all 21 diagnostics; see [the bounded template evidence](../templates/evidence/GOOGLE-ACCEPTANCE.md). |
| Existing artifact | Rebuilt and tested intact. |

Reproduce the Node checks from the repository root:

```sh
node --test native-core/*.test.js import-service/*.test.mjs templates/*.test.mjs setup-service/*.test.mjs ai-service/ask.test.mjs service/server.test.mjs ios/scripts/projection.test.cjs test.js
```

Repository CI now includes these checks and a macOS simulator job for native unit tests and fictional household journeys. The workflow YAML and deterministic project generation were checked locally; the new GitHub jobs have not run because this branch has not been pushed.

The [screenshot inventory](evidence/SCREENSHOTS.md) retains 96 full-resolution originals with workflow and evidence limits, including 24 from the expanded run, 21 from the accessibility follow-up, three publication-follow-up practice captures, six Activity follow-up captures and six clean-setup captures. The paired iPhone was available with Developer Mode enabled, but installation stopped at the developer-image mount because the phone was locked; a fresh installation attempt encountered the same lock. Installation and physical-phone acceptance remain unverified; unlock the phone before retrying. Raw device logs stay local because they include device identifiers.

## Document and planning extension

The added planning views retain Sheet-provided mortgage scenarios, upcoming pay, payslip history, tax periods, safety coverage and dated rental cash flow. Earlier focused planning and document runs are retained in `planning-acceptance-01.xcresult` and `source-ui-03.xcresult`. The earlier expanded run passed 90 unit tests and 12 UI journeys; the latter completed in 530 seconds with zero failures. Its shared Node suite passed 218 checks. The current counts after clean-household setup are listed above. The original artifact also builds, all four inline scripts parse, and January reimport reports zero rows to append.

The current signed archive's app binary SHA-256 is `8eb17c6e97f0274c3412fd2a9b2b429342978e553a6c05f00cfd33061f4c8113`. The archive remains local and excluded from Git. Earlier typed, accessibility, public-feed, Activity and pre-calendar setup archives are historical.

The writer now accepts one combined CSV/document proposal, keeps binary originals, preserves raw input/helper boundaries, allows statement-only evidence receipts, and separates `verified_intake` from `verified_close`. See [the protocol](../import-service/CONTRACT-2.md) and [shared record/close rules](../native-core/records-close.md). Source-backed salary and transfer decisions are explicit; a client-supplied success flag cannot close a month.

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
- Deploy the [combined HTTPS gateway](../service/README.md) as one writer process/replica. Exercise real authentication, import recovery, same-source replay and real or sanitised bank exports through the app. Local tests and the provider primitive do not establish these outcomes.
- Configure actual AI API providers, model choices and billing limits. Validate consent, answer quality and failure behavior with approved test data before enabling provider claims.
- Publish a Kitty-specific privacy-policy URL and provide a private support contact. The in-app privacy text and collection manifest now describe processing honestly; complete store disclosures against the final hosted configuration. Finish the physical-phone run before distribution; rebuild/sign the final configured candidate and repeat its expanded small-screen and physical-device journeys.

Nothing has been published or uploaded by this handoff. App Store approval is not claimed.

## Draft metadata and reviewer narrative

**Name:** The Kitty

**Subtitle:** Your household, your Sheet

**Description draft:** Review household spending, savings goals and financial snapshots in a native app built around your own Google Sheet. Explore the fictional Davies household without an account. Review bank exports and original documents, resolve questions and duplicates, and inspect the context you choose to share with Claude or ChatGPT. Use only the live-service claims verified in the final configured candidate.

**Reviewer notes draft:** Choose **Explore the Davies demo** on first launch; no signup is required. The demo contains fictional data throughout. In Import, **Try a sample statement** opens a reviewed practice flow whose receipt stays on the device and does not write to Google. This app does not request bank credentials or execute payments or trades. Google-backed importing and embedded AI require the release service configuration; they remain unconfigured and unverified in the current candidate. Try a sample payslip to inspect the original and a persistent field review. Month-end practice shows unresolved source evidence and cannot claim a real close. Update these notes with the actual enabled routes and reviewer access after live acceptance.
