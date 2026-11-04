# iOS release handoff — 5 November 2026

The Kitty is a spreadsheet-backed household budgeting app with reviewed bank CSV, payslip, valuation and statement-balance intake. The user’s Google Sheet remains the financial record; import evidence belongs in their Drive. It has no bank login, payment or trading capability. On-device PDF text/OCR, typed review and controlled month close are implemented. Local checks do not make it a verified live artifact replacement.

## Verified evidence

| Area | Observed result and limit |
|---|---|
| Shared code and services | 218 Node checks pass across import core, writer, Ask, gateway, native projection and original app tests. |
| Native workflows | The last full run passes 90 native tests and all 12 UI journeys in [typed-acceptance-final.xcresult](evidence/typed-acceptance-final.xcresult) on iPhone SE, dark mode, accessibility extra-large text. Subsequent accessibility view changes pass five affected journeys and the bounded control audit in [accessibility-se-03.xcresult](evidence/accessibility-se-03.xcresult); the regular-size control audit and new account-selection journey also pass. These are simulator results. |
| Signing | The current Apple Development-signed arm64 Release archive, including typed document intake and accessibility layout changes, succeeded and strict `codesign` verification passed: `build/TheKitty-accessibility-final.xcarchive`. No upload or TestFlight acceptance is established. |
| Provider primitive | The [private synthetic Sheet test](../import-service/evidence/LIVE-ACCEPTANCE.md) preserved existing rows and 1,386 inspected formulas. It did not exercise app OAuth or the hosted service. |
| Existing artifact | Rebuilt and tested intact. |

Reproduce the Node checks from the repository root:

```sh
node --test native-core/*.test.js import-service/*.test.mjs ai-service/ask.test.mjs service/server.test.mjs ios/scripts/projection.test.cjs test.js
```

Repository CI now includes these checks and a macOS simulator job for native unit tests and fictional household journeys. The workflow YAML and deterministic project generation were checked locally; the new GitHub jobs have not run because this branch has not been pushed.

The [screenshot inventory](evidence/SCREENSHOTS.md) retains 81 full-resolution originals with workflow and evidence limits, including 24 from the expanded run and 21 from the accessibility follow-up. The paired iPhone was available with Developer Mode enabled, but installation stopped at the developer-image mount because the phone was locked; a fresh installation attempt encountered the same lock. Installation and physical-phone acceptance remain unverified; unlock the phone before retrying. Raw device logs stay local because they include device identifiers.

## Document and planning extension

The added planning views retain Sheet-provided mortgage scenarios, upcoming pay, payslip history, tax periods, safety coverage and dated rental cash flow. Earlier focused planning and document runs are retained in `planning-acceptance-01.xcresult` and `source-ui-03.xcresult`. The final expanded run passes all 90 unit tests and 12 UI journeys; the latter completed in 530 seconds with zero failures. The shared Node suite passes all 218 checks. The original artifact also builds, all four inline scripts parse, and January reimport reports zero rows to append.

The current signed archive's app binary SHA-256 is `aefacb6546ad5359e9af84a990d9f6a60e6dc55c8f178dfd266e2114627a5ec4`. The archive remains local and excluded from Git. The earlier `TheKitty-typed-final.xcarchive` is historical; it predates the accessibility layout changes.

The writer now accepts one combined CSV/document proposal, keeps binary originals, preserves raw input/helper boundaries, allows statement-only evidence receipts, and separates `verified_intake` from `verified_close`. See [the protocol](../import-service/CONTRACT-2.md) and [shared record/close rules](../native-core/records-close.md). Source-backed salary and transfer decisions are explicit; a client-supplied success flag cannot close a month.

## Accessibility follow-up

The Ask heading, import actions and account selector now allow more room at large text sizes. Source links retain native link semantics and gain minimum touch height. Both tested simulator sizes pass the control-description, trait and hit-region check on six primary screen states. The complete visual audit still reports contrast, clipping, Dynamic Type and chart text-detection findings; these are retained in [the accessibility review](evidence/ACCESSIBILITY.md), not claimed as resolved. Actual VoiceOver use remains unverified.

## Integration before submission

`Config.local.xcconfig` currently contains Apple signing configuration only. Google client ID and service URL are blank. Read-only inspection of the available Google configuration found an older web client but no registered Kitty iOS client; no Cloud configuration was changed.

- Register/configure the native Google client and validate exact-Sheet access, onboarding, cancellation/revocation and a second user. Keep private Google project/account details out of repository documentation.
- Deploy the [combined HTTPS gateway](../service/README.md) as one writer process/replica. Exercise real authentication, import recovery, same-source replay and real or sanitised bank exports through the app. Local tests and the provider primitive do not establish these outcomes.
- Configure actual AI API providers, model choices and billing limits. Validate consent, answer quality and failure behavior with approved test data before enabling provider claims.
- Publish a Kitty-specific privacy-policy URL and provide a private support contact. The in-app privacy text and collection manifest now describe processing honestly; complete store disclosures against the final hosted configuration. Finish the physical-phone run before distribution; rebuild/sign the final configured candidate and repeat its expanded small-screen and physical-device journeys.

Nothing has been published or uploaded by this handoff. App Store approval is not claimed.

## Draft metadata and reviewer narrative

**Name:** The Kitty

**Subtitle:** Your household, your Sheet

**Description draft:** Review household spending, savings goals and financial snapshots in a native app built around your own Google Sheet. Explore the fictional Davies household without an account. Review bank exports and original documents, resolve questions and duplicates, and inspect the context you choose to share with Claude or ChatGPT. Use only the live-service claims verified in the final configured candidate.

**Reviewer notes draft:** Choose **Explore the Davies demo** on first launch; no signup is required. The demo contains fictional data throughout. In Import, **Try a sample statement** opens a reviewed practice flow whose receipt stays on the device and does not write to Google. This app does not request bank credentials or execute payments or trades. Google-backed importing and embedded AI require the release service configuration; they remain unconfigured and unverified in the current candidate. Try a sample payslip to inspect the original and a persistent field review. Month-end practice shows unresolved source evidence and cannot claim a real close. Update these notes with the actual enabled routes and reviewer access after live acceptance.
