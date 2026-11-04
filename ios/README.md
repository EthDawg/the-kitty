# The Kitty for iOS

A native SwiftUI household finance app with reviewed CSV and document intake, built around a user-owned Google Sheet. It supports iOS 17+, uses SwiftUI, Charts and JavaScriptCore, and has no external package dependencies. The bundled Davies household is entirely fictional and needs no signup.

The current build includes on-device PDF text/OCR, known payslip/valuation CSVs, source-bound field review, explicit transfer/salary matching, controlled month close, saved clean-household setup, household preferences, recoverable goal creation and filtered Activity CSV export. These paths have local and simulator evidence; the app is not yet a verified live replacement for the artifact. The existing public artifact has been rebuilt and tested intact. See [RELEASE.md](RELEASE.md) for current evidence, configuration and release work; [ACCEPTANCE.md](ACCEPTANCE.md) records the broader acceptance scope.

Work is paused at the requested review checkpoint. [The Claude alignment guide](CLAUDE-REVIEW.md) maps this implementation to the artifact and identifies the most useful review questions.

## Run

```sh
python3 ios/scripts/generate_project.py
xcodebuild -project ios/Kitty.xcodeproj -scheme Kitty -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath ios/build CODE_SIGNING_ALLOWED=NO build
open ios/Kitty.xcodeproj
```

Choose **Explore the Davies demo** on first launch. `--demo` opens fictional data directly; `--uitest-reset` resets only demo preferences and review state, never live Sheet records.

The native Files UI tests select a fictional bank export from the simulator's normal document provider. Before running the full UI suite, prepare the selected simulator:

```sh
python3 ios/scripts/prepare_files_fixture.py '<SIMULATOR_UUID>'
```

This boots that simulator and adds only `Kitty QA / fictional-bank.csv` under **On My iPhone** or **On My iPad**, preserving the bundled original bytes. It refuses to replace a different existing file. The test then uses the regular account chooser, Files picker, column mapping and saved review. CI prepares the same fixture. For a focused run, select `KittyUITests/FilePickerUITests` in Xcode or with `xcodebuild -only-testing:KittyUITests/FilePickerUITests test` and the same simulator destination. Export tests use unique filenames so repeated runs do not replace an earlier export.

The household-switch UI test uses a Debug-only fictional cached household and the normal Settings action to open the Davies demo. The fixture supplies no Sheet ID or Google identity, so it cannot exercise provider reads or authorization. It checks that a goal selected in the first household does not become an unrelated detail in the second household. Release builds exclude the fixture hook.

Real Google access requires an iOS OAuth client for `com.ethdawg.kitty`, its reversed-client URL scheme and `drive.file` permission. Set public client identifiers and the HTTPS service URL in ignored `Config.local.xcconfig`; never bundle provider secrets. Currently that local file contains Apple signing configuration only: the native Google client ID and service URL remain blank. See [Google access notes](IntegrationNotes/GOOGLE-ACCESS.md).

## Architecture

- `Kitty/Views` and `Kitty/Models`: native financial views, source drill-through, import review, AI consent, protected cache and durable Sheet-bound recovery.
- `Kitty/Services`: OAuth PKCE and Keychain, Sheet reads, the shared calculation/import bridge, and authenticated service clients.
- [`native-core`](../native-core): CSV interpretation, exact minor units, mapping, typed payslip/valuation/statement records, evidence-bound close checks and duplicate identity.
- [`service`](../service/README.md): one HTTPS gateway for setup, imports and Ask. Deploy exactly one writer process/replica; the service retains no Google tokens or separate household ledger.
- [`templates`](../templates/README.md) and [`setup-service`](../setup-service/README.md): versioned clean AU/AUD workbooks, durable creation recovery and exact Google readback.
- [`import-service`](../import-service/README.md) and [`ai-service`](../ai-service/README.md): user-owned Drive evidence and verified Sheet writes; optional provider answers from explicitly approved context.

The calculation engine is pinned from upstream `v2-ledger` commit `3b5b917`; original `src/engine.js` remains untouched. Native reads accept documented v1/v2 Sheets and reject unknown versions. No automatic Sheet migration is performed.

Current shared checks include 337 passing Node tests and 165 native unit tests. Simulator journeys cover financial views, original PDF review, persistence, practice imports and replay; see the dated evidence in RELEASE.md. A focused accessibility follow-up passes account selection, five affected small-screen journeys and bounded control checks; [visual findings remain open](evidence/ACCESSIBILITY.md). Activity title/search separation and the original-record journey also pass at regular and large text sizes. New writes now require the known public-feed switch to be off, while receipt recovery remains available. The [template boundary](IntegrationNotes/TEMPLATE-BOUNDARY.md) records the implemented clean-household profile and remaining live acceptance. Actual Google recalculation/readback passes for one- and two-person fictional workbooks, and two goal append primitives preserve all existing inputs and formulas. The current development-signed arm64 Release archive includes these changes and passes strict signature verification. Device installation is waiting for the paired phone to be unlocked. These results do not establish live OAuth, deployed imports, AI provider quality, TestFlight acceptance or App Store approval.
