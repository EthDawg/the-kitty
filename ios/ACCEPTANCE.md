# iOS acceptance — active

Objective: a seamless native iOS replacement for The Kitty, with user-owned Google Sheets, reliable imports and Claude/ChatGPT access. The handover distinguishes the fictional public app from agent-operated real household work. This implementation and its retained screenshots use fictional data only.

## Required outcomes

| Outcome | Current evidence | Remaining acceptance |
|---|---|---|
| Native app installs and opens | SwiftUI app builds and runs on iPhone 17 Pro and iPhone SE simulators; the current clean-household setup build has a verified development-signed arm64 archive. | Physical-device installation and use. Installation was attempted, but the paired phone was locked. |
| Sheet figures and original evidence | All 165 native unit tests pass. Native projection preserves exact figures, absent metric periods, original descriptions and goal overage; unknown schemas and malformed inputs fail visibly. Coverage includes scanned PDF OCR, exact field confirmations, typed receipts, close decisions, setup recovery, publication guards and cross-workflow write holds. UI runs are tracked in RELEASE.md. | Configured live workbook and second household identity. |
| Existing artifact remains usable | Original 13 checks and build.py pass; original source is unchanged. | No new artifact acceptance is claimed. |
| Private Google access | PKCE, explicit native Picker selection, drive.file, Keychain, sign-out tombstones and permission guards implemented; 12 standalone mock HTTP checks pass. | Register the correct iOS credential, consent and test live selection, copying, revocation and another user. |
| New household onboarding | Native saved draft, exact review, versioned basic AU/AUD generator and one-shot setup service implemented. Two private fictional workbooks pass full actual Google readback. Local setup/relaunch journeys pass at regular and large text sizes. | Native OAuth to the hosted setup service, creation/cancellation/recovery with another Google identity; optional-domain setup beyond the supported basic profile. |
| CSV interpretation and review | Three fictional format adapters, explicit generic mapping, exact cents, date conventions, pending exclusions, overlap handling, duplicate decisions and original-file retention. | Sanitised real bank formats and app file-picker acceptance with those exports. On-device PDF text/OCR and exact known payslip/valuation CSV suggestions are implemented and tested with fictional originals; extraction never approves fields. |
| Durable, verified importing | Shared import/writer tests, durable native receipt identity, protected unknown outcomes and relaunch/replay tests. Small-screen practice import completed and replay offered zero rows. | Hosted service plus app OAuth; interrupted live writes, lost-device recovery and same-file replay through that path. |
| Formula preservation | Private synthetic Google write preserved 925 original transactions and 1,386 inspected formulas; details in LIVE-ACCEPTANCE.md. | This is a bounded v1 provider primitive, not hosted service or v2 live acceptance. |
| Full month close | Typed records, all-account statement reconciliation (including no activity), valuation and payslip evidence, explicit transfer/salary decisions, controlled As-of and post-write checks are implemented. Shared and mocked writer tests exercise v1/v2 and refuse incomplete evidence. | Full app-to-hosted-service acceptance against private v1/v2 copies; real source formats and post-close formulas. A fictional first-month Google formula primitive matches all 21 projected diagnostics; no hosted verified month close is claimed. |
| Ask Claude / ChatGPT | Scoped dated preview, explicit sharing, external handoff and read-only optional provider service; mock tests and simulator preview pass. | Actual provider configuration, paid-call limits and answer quality on approved fixtures. External app receipt of a handoff remains unverified. |
| Household controls and goals | Native preferences, safety target, v1 subscription decisions, reviewed goal creation and durable read-only recovery implemented. Two actual Google goal appends preserve all 2,061 existing entered cells and calculate correctly; shared/native tests cover stale reviews, uncertainty, replay, later edits and wrong-Sheet hiding. | Native OAuth and deployed goal writes, preference readback and recovery with another user; v2 subscription decisions remain a Sheet operation. |
| Filtered CSV export | Exact visible rows are snapshotted for review, encoded with exact cents and protected text, and handed to the native Files picker. Cancellation retains the review and search without claiming success. | Physical-phone destination save and opened-file verification. |
| Seamless usability | Full-resolution regular-size and small-screen screenshots retained. The full iPhone SE run passes all 12 journeys; subsequent view changes pass five affected journeys and a bounded control audit. Account selection now has its own tested journey. Activity title/search overlap is repaired and the affected journey passes at both sizes, including the original-record identifier. | Remaining [visual audit findings](evidence/ACCESSIBILITY.md), VoiceOver and physical-phone acceptance. |
| Distribution | Existing Apple signing account produced a valid development-signed archive. No upload occurred. | Public privacy policy, private support contact, deployment disclosures, App Store Connect metadata, TestFlight and review. |

## Critique and repair evidence

- The handover's manual append overwrite led to a controlled writer that preserves raw records and formula columns, retains originals and reads back receipts.
- The first AI preview appeared blank. An immutable presentation item fixed it; the dated consent preview subsequently passed UI acceptance.
- Independent import review found lost drafts on cancelled authentication, non-durable practice receipts and unsafe retry ambiguity. Durable Sheet-bound proposals and recovery-only receipts now preserve the approved operation.
- Small-screen testing found horizontal transaction rows compressing merchant names. Accessibility layouts now stack names and amounts. The test harness also had to scroll before inspecting virtualised List controls.
- Final independent lifecycle review found delayed chooser completion after switching to demo, overlapping refreshes and revocation racing a fresh grant. Epoch checks and operation gates address those paths; delayed-response tests exercise the disconnect boundary.
- Goal editing now prevents cancellation/dismissal while an approved save is still being verified.
- Document review testing found an employer/super label collision and a SwiftUI row that also invoked its Remove action. Exact text-label matching and independent button actions repaired them; the original/confirmation/relaunch journey then passed.
- Source uploads now deduplicate one original used in multiple roles and refuse HTTP redirects. Typed receipts distinguish saved input from a verified month close. Missing balances and check counts remain unresolved.
- Month-end review shows unresolved checks first and keeps passed checks collapsed; explicit matching never infers a transfer merely from a zero total.
- Combined uploads preserve the preview's CSV order, so overlapping exports keep the exact review decision when the service reruns the parser. A regression exercises the reviewed proposal with both bank originals and a payslip.
- Document confirmation actions have 44-point minimum touch targets. Transfer search stays within its editor, and review explanation fields have a keyboard Done control. Small-screen tests use controlled scrolling for tall accessibility rows and verify date-filter state explicitly.
- Disconnecting removes completed local source receipts while retaining only unresolved recovery records; the lifecycle test checks both outcomes.
- Ask and import text can grow vertically at large sizes; account selection has a full-width labelled control. The selected-account and CSV-enable transition passes on both simulator sizes. Automated control checks pass on six screen states, while visual audit findings remain explicitly open.
- The known public JSON feed now blocks new imports and close writes while enabled. Native checks preserve the review/originals; both service protocols enforce the current setting before new writes. Existing receipt recovery, cancellation and provenance remain available. Tests cover a publishing change after preparation without invalidating past receipts.

- Full-resolution review found an overlapping Activity title/search field at large text size. An inline title fixes the collision; transaction detail labels also stack at that size. Focused UI checks verify non-overlapping title/search frames and scroll to a hittable original transaction identifier.

- New-household review found corrupted saved-result bindings and a pre-begin cancellation gap. Complete reservation/approval/result validation and an input-bound durable cancellation tombstone repair those paths.
- Failed sign-out cleanup now hides local setup fields immediately and records a cleanup marker so relaunch cannot restore them before removal.
- Actual Google readback exposed relative custom-validation rewriting. Verification now checks the expanded references and strictness instead of comparing an unexpanded anchor rule.
- Partial template-marker deletion no longer enables legacy pre-anchor intake. Target-period diagnostics are reviewed before close and verified against actual recalculation afterwards.
- Missing historical values cannot receive a green reconciliation check. Completed-month defaults use the template's Australian timezone, including the first hours of a new month.
- Actual clean-Sheet projection exposed a blank metric-period decoding failure; the native model now preserves that absence and displays the opening balance without demo activity.
- A recovery alert initially dismissed the underlying setup sheet. Presenting shared feedback from the frontmost sheet preserves recovery and its write hold.
- Native search hides Activity toolbar actions. Filtered results now include an export button, and cancelling Files leaves the exact search intact.
- Goal creation uses typed row-independent formulas, a one-shot intent and an atomic goal/receipt append. Review corrected the exact target header, historical receipt recovery after later legitimate goals, and goal-hold routing away from CSV recovery.
- Screenshot review exposed a truncated new-goal account picker at large text size. A wrapping labelled menu now preserves the complete choice; actual account selection passes on both simulator sizes.

## Completion rule

This audit is not provider evidence. The goal remains active while required outcomes are missing. A passing build, local tests or a screenshot do not establish live import acceptance, complete artifact parity, a flawless app or App Store approval. See RELEASE.md for the current test artifacts and concrete next integration steps.
