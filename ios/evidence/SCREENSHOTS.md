# Native workflow evidence

Full-resolution originals, captions, workflows, results and hashes are retained in [the inventory](screenshots/inventory.json). All captures contain the fictional Davies household only. They do not establish live Google access, provider AI, physical-device acceptance or store approval.

The expanded run, `typed-acceptance-final.xcresult`, passes 90 native tests and all 12 UI journeys on iPhone SE in dark mode with accessibility extra-large text. Its 24 untouched 750×1334 captures have a `typed-se-` prefix. The later accessibility follow-up retains another 21 originals with an `accessibility-regular-` or `accessibility-se-` prefix, bringing the inventory to 81. Large-text captures preserve the visible viewport of a scrollable section; the complete assertions and interactions remain in the result bundle.

The follow-up passes five affected small-screen journeys and a bounded control audit; the regular-size audit and account-selection journey also pass. See the [accessibility review](ACCESSIBILITY.md) for the remaining visual findings and limits. Representative current captures show [Ask at large text](screenshots/accessibility-se-ask.png), [wrapped import text](screenshots/accessibility-se-import.png), and [account selection](screenshots/accessibility-se-25-import-account-selected.png). These are not full accessibility acceptance.

- [Current Home](screenshots/typed-se-01-home-cash-and-demo-status.png), [practice receipt](screenshots/typed-se-11-practice-import-verified-local-receipt.png) and [zero-row replay](screenshots/typed-se-12-relaunched-import-adds-zero.png).
- [Mortgage estimate](screenshots/typed-se-13-mortgage-recorded-rate-scenario.png), [original payslip](screenshots/typed-se-19-retained-original-payslip.png) and [pay-date source review](screenshots/typed-se-20-document-field-confirmation.png).
- [Month-end practice status](screenshots/typed-se-22-month-end-missing-evidence.png), [transfer explanation](screenshots/typed-se-23-explicit-transfer-pair-review.png) and [retained decision](screenshots/typed-se-24-retained-transfer-decision.png).

The earlier small-screen run, `native-final-acceptance.xcresult`, passed 52 unit tests and seven UI journeys on iPhone SE in dark mode with accessibility extra-large text. Its 12 captures have an `se-` prefix. The regular-size final Home run also passed; its two captures have a `final-` prefix. The original complete iPhone 17 Pro run remains preserved below.

- [Final Home](screenshots/final-01-home-cash-and-demo-status.png) and [account basis](screenshots/final-02-cash-account-evidence.png).
- [Small-screen Home](screenshots/se-01-home-cash-and-demo-status.png), [practice receipt](screenshots/se-11-practice-import-verified-local-receipt.png) and [relaunch/replay](screenshots/se-12-relaunched-import-adds-zero.png).

| Capture | Workflow and observed outcome |
|---|---|
| [Home](screenshots/01-home-cash-and-demo-status.png) | Exact cash value, dated fictional status, income/spending and navigation are present. |
| [Accounts](screenshots/02-cash-account-evidence.png) | Cash opens its account basis, including the distinction from available-to-spend money. |
| [Transaction](screenshots/03-transaction-original-evidence.png) | Searching Woolworths reaches T0919 and its unchanged original description. |
| [Goal](screenshots/04-goal-plan-and-money-basis.png) | The over-target goal retains its actual saved amount and avoids adding the allocation as a new asset. |
| [Demo edit boundary](screenshots/05-demo-goal-edit-boundary.png) | Demo goal editing cannot claim a Google write. |
| [Exact chart values](screenshots/06-insights-exact-figures.png) | Monthly chart has a text equivalent with exact figures. |
| [Checks](screenshots/07-recorded-reconciliation-checks.png) | Recorded checks have source context; they do not prove a newly imported period is closed. |
| [AI preview](screenshots/08-ai-summary-consent-preview.png) | A dated, bounded summary is visible before any external handoff. No AI request was sent. |
| [Import review](screenshots/09-import-unresolved-source-review.png) | Unfamiliar merchants reach explicit review. |
| [Save held](screenshots/10-import-save-held-until-review.png) | Unresolved review cannot be saved. |
| [Practice receipt](screenshots/11-practice-import-verified-local-receipt.png) | Five approved synthetic rows and their original file were written and read back locally. This is explicitly labelled practice. |
| [Relaunch and repeat](screenshots/12-relaunched-import-adds-zero.png) | The durable local receipt survives a fresh launch; replay offers zero new rows. |

Raw `.xcresult` bundles and exported attachments remain locally available under `ios/evidence/` and are excluded from Git. The selected originals above are retained with the code.

## Added planning and source review

The inventory also retains the earlier regular-size captures 13–18 from the passing planning journeys and 19–22 from the passing original-document/confirmation/relaunch and month-end preview journeys. The latter month-end layout was subsequently simplified to surface unresolved checks first; its earlier screenshot remains historical evidence. All are full-resolution fictional simulator captures.
