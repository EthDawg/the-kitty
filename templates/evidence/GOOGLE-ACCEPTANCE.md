# Clean-template Google acceptance — 5 November 2026

Generated setup payloads were applied through the connected Google Sheets tools to two private fictional test workbooks. The public Davies source was read only and was not changed. Both test files read back as unshared with one owner permission.

| Case | Exact entered cells | Observed result |
| --- | ---: | --- |
| Two people, three accounts, explicit budget, emergency account and goal | 2,094 | All 24 semantic checks pass; tracked opening cash is AUD6,205.50. |
| One person, one account, no optional choices | 2,061 | Initial verifier passes; tracked opening cash is AUD1,234.56, with no invented goals, budgets or forecasts. |

The full setup verifier returned `verified` with no issues for both actual Google readbacks. It checked exact inputs/formulas and tab bounds, required number formats and validation, empty raw ledgers, public feed off, zero formula errors and the profile's opening/history checks. Google's relative custom-validation expansion and omitted custom-rule dropdown flag are handled explicitly; strict validation and referenced cells remain checked.

The sanitized effective-value snapshots are [initial-two-person.json](initial-two-person.json) and [initial-solo.json](initial-solo.json). Native projection tests consume them and confirm that absent history remains unavailable and cannot receive a green reconciliation result. Private file identities and full provider grids remain in ignored local evidence. Reads span multiple requests and are not an atomic snapshot.

The rendered Google account table was also inspected. Institution names and balance headers initially clipped; the generator now sets readable account column widths and a wrapped, bold header. Only fictional fixtures received that formatting update.

These checks exercise Google calculation and the generated workbook contract. They do **not** establish live native OAuth, the setup service's creation/recovery state machine, a hosted deployment, a second Google identity, bank-source authenticity, a verified month close or physical-phone acceptance. No test file is an actual household record.

## First inactive month

The one-person fixture was advanced from 30 June to 31 July 2026 by changing only its As-of input. The production reader/projector predicted the complete target diagnostic set before the change. Actual Google recalculation then matched all 21 scoped count/status pairs, with zero formula errors and the exact unchanged AUD1,234.56 account balance. The no-activity diagnostic is correctly one item requiring review. See [the bounded comparison](first-zero-activity-month.json).

This caught and repaired a first-close issue: reviewing a previous-period warning could leave the close unresolved after As-of advanced and the warning changed. Basic-profile closes now present target-period diagnostics before approval and compare actual target values afterwards. The test remains a formula primitive; no hosted close or verified-close receipt is claimed.
