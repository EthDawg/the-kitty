# The Kitty for iOS

A native SwiftUI household finance viewer and reviewed CSV importer built around a user-owned Google Sheet. It supports iOS 17+, uses SwiftUI, Charts and JavaScriptCore, and has no external package dependencies. The bundled Davies household is entirely fictional and needs no signup.

The current build is not yet a verified live replacement for the artifact. PDF extraction and full payslip/valuation month-close workflows are not implemented. The existing public artifact has been rebuilt and tested intact. See [RELEASE.md](RELEASE.md) for current evidence, configuration and release work; [ACCEPTANCE.md](ACCEPTANCE.md) records the broader acceptance scope.

## Run

```sh
python3 ios/scripts/generate_project.py
xcodebuild -project ios/Kitty.xcodeproj -scheme Kitty -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath ios/build CODE_SIGNING_ALLOWED=NO build
open ios/Kitty.xcodeproj
```

Choose **Explore the Davies demo** on first launch. `--demo` opens fictional data directly; `--uitest-reset` resets only demo preferences and review state, never live Sheet records.

Real Google access requires an iOS OAuth client for `com.ethdawg.kitty`, its reversed-client URL scheme and `drive.file` permission. Set public client identifiers and the HTTPS service URL in ignored `Config.local.xcconfig`; never bundle provider secrets. Currently that local file contains Apple signing configuration only: the native Google client ID and service URL remain blank. See [Google access notes](IntegrationNotes/GOOGLE-ACCESS.md).

## Architecture

- `Kitty/Views` and `Kitty/Models`: native financial views, source drill-through, import review, AI consent, protected cache and durable Sheet-bound recovery.
- `Kitty/Services`: OAuth PKCE and Keychain, Sheet reads, the shared calculation/import bridge, and authenticated service clients.
- [`native-core`](../native-core): CSV interpretation, exact minor units, mapping, explicit review and duplicate identity.
- [`service`](../service/README.md): one HTTPS gateway for imports and Ask. Deploy exactly one writer process/replica; the service retains no Google tokens or separate household ledger.
- [`import-service`](../import-service/README.md) and [`ai-service`](../ai-service/README.md): user-owned Drive evidence and verified Sheet writes; optional provider answers from explicitly approved context.

The calculation engine is pinned from upstream `v2-ledger` commit `3b5b917`; original `src/engine.js` remains untouched. Native reads accept documented v1/v2 Sheets and reject unknown versions. No automatic Sheet migration is performed.

Verified evidence includes 149 Node checks, 52 native tests and seven UI journeys, including practice import, relaunch and zero-row replay. The final development-signed arm64 Release archive passed strict signature verification. Device installation is waiting for the paired phone to be unlocked. These results do not establish live OAuth, deployed imports, AI provider quality, TestFlight acceptance or App Store approval.
