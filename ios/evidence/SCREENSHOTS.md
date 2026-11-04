# Native workflow evidence

Full-resolution originals, captions, workflows, results and hashes are retained in [the inventory](screenshots/inventory.json). All captures contain the fictional Davies household only. They do not establish live Google access, provider AI, physical-device acceptance or store approval.

The final small-screen run, `native-final-acceptance.xcresult`, passed 52 unit tests and seven UI journeys on iPhone SE in dark mode with accessibility extra-large text. Its 12 captures have an `se-` prefix. The regular-size final Home run also passed; its two captures have a `final-` prefix. The original complete iPhone 17 Pro run remains preserved below.

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
