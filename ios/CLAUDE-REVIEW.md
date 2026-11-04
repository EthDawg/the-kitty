# The Kitty: native iOS review checkpoint

This branch is ready for an alignment review with the existing Claude artifact. It is a working native implementation with local test evidence, not a completed live replacement or an App Store release. Work is paused at the user's requested checkpoint. No Android app has been built; the shared JavaScript finance and import core is reusable by a future client.

Repository: [EthDawg/the-kitty, codex/kitty-ios](https://github.com/EthDawg/the-kitty/tree/codex/kitty-ios). The existing artifact source remains under `src/`; the native app is under `ios/`. Start with [the native README](README.md), [release evidence](RELEASE.md) and [acceptance matrix](ACCEPTANCE.md).

**Review the newer artifact changes explicitly.** This branch started from `487559b` and preserves that artifact source. A final fetch on 5 November found `main` at `e1f1f42`, including v2 ledger, row/review, importer, brand and portal work. The native calculation engine was deliberately pinned from `3b5b917`, but the newer artifact/app/importer commits have not been merged into this branch. Compare the native implementation with current `main` as well as the original artifact; preserving the starting source does not establish parity with those newer features. The review branch is not a replacement for `main`.

## The intended product

One household owns its Google Sheet and original evidence. The native app provides everyday financial views, reliable intake and useful AI explanations. The same Sheet remains readable and usable from the artifact, directly in Sheets, or by a separately authorised AI. A server does not become a second financial ledger.

The public Davies artifact and the full Claude/ChatGPT agent environment are different capability surfaces. A native app does not inherit an agent's browser, connectors, files, reasoning tools or existing subscription. The important replacement work is interpreting imports, obtaining the correct Sheet access, preserving formulas and records, and verifying what was saved.

## Compare these boundaries

| Area | Native implementation | Review focus |
|---|---|---|
| Sheet calculations | Original artifact source preserved; native engine pinned from upstream `v2-ledger` commit `3b5b917`; documented v1/v2 reads; no automatic migration. | Do the same fields, periods, signs, missing values and formulas mean the same thing in the artifact? |
| Daily views | Home, account evidence, searchable Activity, original transaction fields, Insights, exact monthly figures, goals, recurring costs and planning views. | Identify a missing high-value artifact journey or a misleading financial label, with a concrete example. |
| Bank imports | Native Files picker, explicit account binding, three fictional format adapters, generic column mapping, exact minor units, pending/overlap handling, duplicate review and retained original bytes. | Challenge bank/date/sign conventions and legitimate repeated transactions. Sanitised real bank exports still need acceptance. |
| Documents and month close | On-device PDF text/OCR, confirmed payslip/valuation/statement fields, explicit salary/transfer decisions and evidence-backed close checks. | Check current-period versus YTD values, liability signs, no-activity statements, incomplete months and original-source traceability. Extraction does not approve a field. |
| Writes and recovery | Server-side revalidation, one writer process, durable Drive intents/receipts, readback and protected unknown outcomes. Small existing input edits have bounded native writes. | Inspect lost responses, replay, stale reviews, formula preservation and other Sheet editors. Outside editors are not covered by database-style transaction isolation. |
| New households | Clean, versioned basic AU/AUD setup with one/two people, cash accounts and optional goal; broader existing Sheets can still be read. | Is this useful enough to start? Tax, property and other optional-domain setup are explicitly unconfigured in a new basic household. |
| Ask Claude / ChatGPT | Dated summary preview and explicit external handoff; optional read-only provider service with a fresh, approved Sheet-derived context. | Is the context enough to answer the useful questions? Check evidence, stale figures and truthfulness about capabilities. External handoff does not grant Sheet access; API calls require separate hosting/provider configuration. |
| Ownership and access | Selected-file Google access, protected local cache, user-owned Sheet and Drive evidence, explicit disconnect and household-scoped recovery. | Verify the actual native OAuth/Picker flow and a second identity before live acceptance. A pasted Sheet URL alone grants no access. |

Key implementation references: [import core](../native-core/import.md), [typed records and close rules](../native-core/records-close.md), [writer contract](../import-service/CONTRACT-2.md), [goal writes](../import-service/GOALS.md), [Google access](IntegrationNotes/GOOGLE-ACCESS.md), [clean template boundary](IntegrationNotes/TEMPLATE-BOUNDARY.md), [Ask protocol](../ai-service/README.md), and [service deployment constraints](../service/README.md).

## Evidence to inspect

- [Release handoff](RELEASE.md): exact completed checks, focused repairs and signed local archive. Broad baseline and later focused tests are distinguished.
- [Native Files evidence](evidence/NATIVE-FILES.md): actual simulator picker journeys, retained source-byte checks and independent readback of the 38-row, 14-column export.
- [Screenshot inventory](evidence/SCREENSHOTS.md): full-resolution originals with workflow, observed result and limits. All retained financial examples are fictional.
- [Accessibility review](evidence/ACCESSIBILITY.md): control checks and exact financial labels, with unresolved visual findings and physical VoiceOver acceptance stated separately.
- [Google primitive evidence](../import-service/evidence/LIVE-ACCEPTANCE.md) and [clean-template evidence](../templates/evidence/GOOGLE-ACCEPTANCE.md): bounded actual provider readback. These do not establish the native OAuth-to-hosted-service journey.

## What would make the review useful

Return a prioritised list of concrete alignment defects. For each, name the artifact behavior, the relevant native file/workflow, the financial or usability consequence, and the smallest acceptance case that would settle it. Separate a demonstrated defect from an untested integration and from an optional product idea.

Give particular attention to the importer: can a household reliably move from an untouched bank export to correctly mapped, reviewed, duplicate-safe and verified Sheet records without relying on powers available only to a general AI agent? Do not treat a passing demo or screenshot as proof of that live outcome.

Start the upstream comparison with `src/engine.js`, `src/app.js`, `src/kit/entry-row.js`, `period-close/adapters.py`, `period-close/import_month.py` and the newer write-plan/verification code on `main`. Their changes may affect the parity requirements and should be reconciled before merging this native branch.

## Still required before release

Native Google client and hosted service configuration are blank. Native OAuth, hosted setup/import/goal writes, interrupted live recovery, a second identity, actual AI-provider answers, sanitised real bank fixtures, physical-phone/VoiceOver acceptance, privacy/support publication, TestFlight and App Store review remain unfinished. Apple Development signing works; the app has not been uploaded. These are the next acceptance steps, not evidence that Apple will approve the app.
