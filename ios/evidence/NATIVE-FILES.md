# Native Files acceptance — 5 November 2026

The bank original is selected through the normal iOS Files picker, outside Kitty's sandbox. The fixture helper puts the exact bundled fictional CSV in `On My iPhone / Kitty QA`; it does not inject an import draft. All data in this acceptance is fictional.

## Import and repair

The native journey exposed a real defect: the automatic SwiftUI List button behavior invoked **Remove** when **Check column mapping** was tapped. The source disappeared from the local review. Its original in Files was unaffected. Giving both actions independent button styles fixes the interaction and preserves their 44-point touch targets.

The passing journey selects **Everyday joint**, chooses `fictional-bank.csv`, opens and cancels mapping, rejects a second selection of the same original, confirms the mapping and sees five proposed transactions. It then terminates and relaunches the app, reopens the retained review and checks that unresolved decisions still disable Save.

- `files-native-regular-final.xcresult`: both native Files journeys pass on iPhone 17 Pro; import takes 75.490 seconds and export 24.172 seconds.
- `files-import-se-03.xcresult`: the same import journey passes on iPhone SE, dark appearance and accessibility extra-large text, in 182.923 seconds.
- `files-export-regular-01.xcresult`: the existing practice-import and zero-row replay journey also passes after the button repair.

The earlier small-screen attempts stopped at virtualized controls before scrolling far enough. The final test reaches the complete Save button. Those harness failures do not establish another app defect.

Independent readback of the saved small-screen draft confirms one source, the selected account, all confirmed mapping fields, the demo Sheet binding and no remote receipt. The original's 460 bytes, including CRLF, match SHA-256 `b8ad615fa6c8d066adbece80e2cd0a01a306c001a072996aa137720d296b402e` exactly.

## Saved export

The Activity journey searches **Woolworths**, reviews 38 transactions and saves through the native Files destination picker using a unique filename. The actual destination file is read independently with Python's CSV parser and compared with the bundled household projection: all 14 columns, every row in order, account names, original descriptions, categories, notes, currency and exact decimal amounts match. The total is −1,240,150 minor units; the 6,086-byte UTF-8 BOM/CRLF file has SHA-256 `2b1e4633e4b3c78fd4cf6d71408260c45616af88c5fea154bcd909efa38cc841`.

The untouched [saved fictional CSV](native-files-woolworths.csv), [sanitized verification record](native-files-verification.json) and 12 full-resolution screenshots in [the inventory](screenshots/inventory.json) are retained. The refreshed local signed archive is recorded in [RELEASE.md](../RELEASE.md).

This is simulator acceptance for fictional file intake and local export. It does not establish real bank compatibility, Google OAuth, hosted writes, live receipt recovery, physical-phone saving or App Store approval. The shared import/service code did not change; broad Node and native unit suites were not repeated for this view-only repair.
