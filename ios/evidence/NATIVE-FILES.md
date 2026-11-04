# Native Files acceptance — 5 November 2026

The bank original is selected through the normal iOS Files picker, outside Kitty's sandbox. The fixture helper puts the exact bundled fictional CSV in `Kitty QA` under **On My iPhone** or **On My iPad**; it does not inject an import draft. All data in this acceptance is fictional.

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

The untouched [saved fictional CSV](native-files-woolworths.csv), [sanitized verification record](native-files-verification.json) and original screenshots in [the inventory](screenshots/inventory.json) are retained. The refreshed local signed archive is recorded in [RELEASE.md](../RELEASE.md).

## iPad follow-up

The import journey passes on iPad mini (A17 Pro), iOS 26.5, in `ipad-acceptance-final.xcresult` (73.045 seconds). It selects the original through the native Files sidebar, reviews mapping, rejects the repeated file, rotates the five-row review and retains its unresolved decisions after relaunch. This individual journey passes; that bundle's two separate toolbar failures are repaired and superseded by `ipad-toolbar-final.xcresult`.

The final tablet export journey passes in 35.849 seconds. Independent readback of its actual Files destination matches the retained CSV byte-for-byte: 38 rows, 14 columns and the same 6,086-byte SHA-256 above. The verification record adds this result without replacing the earlier iPhone verification. The corresponding [destination picker](screenshots/ipad-47-native-csv-save-destination.png) shows the native tablet workflow; the CSV comparison establishes the saved contents.

The current regular iPhone import regression also passes in `tablet-regression-iphone-final.xcresult` (90.068 seconds). These follow-ups change the Activity menu and UI harness, not financial parsing or service writes. Tablet import persistence is verified through the UI; the earlier independent draft-byte inspection belongs to the small-screen run.

This is simulator acceptance for fictional file intake and local export. It does not establish real bank compatibility, Google OAuth, hosted writes, live receipt recovery, physical-phone saving or App Store approval. The shared import/service code did not change; broad Node and native unit suites were not repeated for this view-only repair.
