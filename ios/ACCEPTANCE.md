# iOS acceptance — active

Objective: a seamless native iOS replacement for The Kitty, with user-owned Google Sheets, reliable imports and Claude/ChatGPT access. The handover distinguishes the fictional public app from agent-operated real household work. This implementation and its retained screenshots use fictional data only.

## Required outcomes

| Outcome | Current evidence | Remaining acceptance |
|---|---|---|
| Native app installs and opens | SwiftUI app builds and runs on iPhone 17 Pro and iPhone SE simulators; development-signed arm64 archive verified. | Physical-device installation and use; final archive is signed and verified. Installation was attempted, but the paired phone was locked. |
| Sheet figures and original evidence | Native projection tests preserve exact figures, missing values, original descriptions and goal overage; unknown schemas and malformed inputs fail visibly. 52 native tests and seven iPhone SE UI journeys pass in the final run; the earlier complete iPhone 17 Pro run and final regular-size Home run also pass. | Configured live workbook and second household identity. |
| Existing artifact remains usable | Original 13 checks and build.py pass; original source is unchanged. | No new artifact acceptance is claimed. |
| Private Google access | PKCE, explicit native Picker selection, drive.file, Keychain, sign-out tombstones and permission guards implemented; 12 standalone mock HTTP checks pass. | Register the correct iOS credential, consent and test live selection, copying, revocation and another user. |
| New household onboarding | Existing-Sheet chooser and copy of the fictional template implemented. Copy is explicitly described as containing fictional records. | A clean real-household setup and actual template-copy permissions; no silent conversion of demo data. |
| CSV interpretation and review | Three fictional format adapters, explicit generic mapping, exact cents, date conventions, pending exclusions, overlap handling, duplicate decisions and original-file retention. | Sanitised real bank formats and app file-picker acceptance with those exports. PDF extraction is not implemented. |
| Durable, verified importing | Shared import/writer tests, durable native receipt identity, protected unknown outcomes and relaunch/replay tests. Small-screen practice import completed and replay offered zero rows. | Hosted service plus app OAuth; interrupted live writes, lost-device recovery and same-file replay through that path. |
| Formula preservation | Private synthetic Google write preserved 925 original transactions and 1,386 inspected formulas; details in LIVE-ACCEPTANCE.md. | This is a bounded v1 provider primitive, not hosted service or v2 live acceptance. |
| Full month close | Existing Sheet checks are displayed with their limits. Transaction import does not move the close watermark. | Native payslip/valuation ingestion, account reconciliation, transfer pairing and controlled close are not implemented. |
| Ask Claude / ChatGPT | Scoped dated preview, explicit sharing, external handoff and read-only optional provider service; mock tests and simulator preview pass. | Actual provider configuration, paid-call limits and answer quality on approved fixtures. External app receipt of a handoff remains unverified. |
| Seamless usability | Full-resolution iPhone 17 Pro screenshots retained. The final small iPhone run in dark mode and accessibility extra-large text passes all seven journeys after layout and test repairs. | VoiceOver and physical-phone acceptance. |
| Distribution | Existing Apple signing account produced a valid development-signed archive. No upload occurred. | Public privacy policy, private support contact, deployment disclosures, App Store Connect metadata, TestFlight and review. |

## Critique and repair evidence

- The handover's manual append overwrite led to a controlled writer that preserves raw records and formula columns, retains originals and reads back receipts.
- The first AI preview appeared blank. An immutable presentation item fixed it; the dated consent preview subsequently passed UI acceptance.
- Independent import review found lost drafts on cancelled authentication, non-durable practice receipts and unsafe retry ambiguity. Durable Sheet-bound proposals and recovery-only receipts now preserve the approved operation.
- Small-screen testing found horizontal transaction rows compressing merchant names. Accessibility layouts now stack names and amounts. The test harness also had to scroll before inspecting virtualised List controls.
- Final independent lifecycle review found delayed chooser completion after switching to demo, overlapping refreshes and revocation racing a fresh grant. Epoch checks and operation gates address those paths; delayed-response tests exercise the disconnect boundary.
- Goal editing now prevents cancellation/dismissal while an approved save is still being verified.

## Completion rule

This audit is not provider evidence. The goal remains active while required outcomes are missing. A passing build, local tests or a screenshot do not establish live import acceptance, complete artifact parity, a flawless app or App Store approval. See RELEASE.md for the current test artifacts and concrete next integration steps.
