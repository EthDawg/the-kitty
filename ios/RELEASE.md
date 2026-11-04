# iOS release handoff — 4 November 2026

The Kitty is a spreadsheet-backed household budgeting viewer with a reviewed CSV importer. The user’s Google Sheet remains the financial record; import evidence belongs in their Drive. It has no bank login, payment or trading capability. Native PDF extraction and full payslip/valuation month-close workflows remain outside this build; do not describe it as a complete artifact replacement.

## Verified evidence

| Area | Observed result and limit |
|---|---|
| Shared code and services | 149 Node checks pass across import core, writer, Ask, gateway, native projection and original app tests. |
| Native workflows | 52 native tests and seven UI journeys pass in [native-final-acceptance.xcresult](evidence/native-final-acceptance.xcresult) on iPhone SE, dark mode, accessibility extra-large text. Practice import, relaunch and zero-row replay pass. Final regular-size Home also passes. These are simulator results. |
| Signing | The final Apple Development-signed arm64 Release archive succeeded and strict `codesign` verification passed: `build/TheKitty-final.xcarchive`. No upload or TestFlight acceptance is established. |
| Provider primitive | The [private synthetic Sheet test](../import-service/evidence/LIVE-ACCEPTANCE.md) preserved existing rows and 1,386 inspected formulas. It did not exercise app OAuth or the hosted service. |
| Existing artifact | Rebuilt and tested intact. |

Reproduce the Node checks from the repository root:

```sh
node --test native-core/import.test.js import-service/core.test.mjs ai-service/ask.test.mjs service/server.test.mjs ios/scripts/projection.test.cjs test.js
```

The [screenshot inventory](evidence/SCREENSHOTS.md) retains 26 full-resolution originals with workflow and evidence limits. The paired iPhone was available with Developer Mode enabled, but installation stopped at the developer-image mount because the phone was locked. Installation and physical-phone acceptance remain unverified; unlock the phone before retrying. Raw device logs stay local because they include device identifiers.

## Integration before submission

`Config.local.xcconfig` currently contains Apple signing configuration only. Google client ID and service URL are blank. Read-only inspection of the available Google configuration found an older web client but no registered Kitty iOS client; no Cloud configuration was changed.

- Register/configure the native Google client and validate exact-Sheet access, onboarding, cancellation/revocation and a second user. Keep private Google project/account details out of repository documentation.
- Deploy the [combined HTTPS gateway](../service/README.md) as one writer process/replica. Exercise real authentication, import recovery, same-source replay and real or sanitised bank exports through the app. Local tests and the provider primitive do not establish these outcomes.
- Configure actual AI API providers, model choices and billing limits. Validate consent, answer quality and failure behavior with approved test data before enabling provider claims.
- Publish a Kitty-specific privacy-policy URL and provide a private support contact. The in-app privacy text and collection manifest now describe processing honestly; complete store disclosures against the final hosted configuration. Finish the physical-phone run before distribution; the final archive and small-screen checks are complete.

Nothing has been published or uploaded by this handoff. App Store approval is not claimed.

## Draft metadata and reviewer narrative

**Name:** The Kitty

**Subtitle:** Your household, your Sheet

**Description draft:** Review household spending, savings goals and financial snapshots in a native app built around your own Google Sheet. Explore the fictional Davies household without an account. Preview CSV imports, resolve questions and duplicates, and inspect the context you choose to share with Claude or ChatGPT. Use only the live-service claims verified in the final configured candidate.

**Reviewer notes draft:** Choose **Explore the Davies demo** on first launch; no signup is required. The demo contains fictional data throughout. In Import, **Try a sample statement** opens a reviewed practice flow whose receipt stays on the device and does not write to Google. This app does not request bank credentials or execute payments or trades. Google-backed importing and embedded AI require the release service configuration; they remain unconfigured and unverified in the current candidate. Update these notes with the actual enabled routes and reviewer access after live acceptance.
