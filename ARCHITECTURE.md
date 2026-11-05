# One Kitty, two hosts

The household owns its Google Sheet. It owns every financial number, source record
and reviewed decision. The Claude artifact and iOS app render the same `src/` app,
engine and UI against that Sheet. iOS is a container, not a second product. There
is no server, separate financial database, subscription or remote executable code.

`build.py` assembles the shared page. The artifact supplies its host capabilities;
iOS will load a fully bundled, offline page in `WKWebView` and supply the same
`window.claude.use()` interface: `mcp`, `sample`, `db`, `user` and `downloads`.
Unavailable capabilities return `null`; demo mode never claims a live connection.
The native host adds Files access, on-device document text/OCR, biometric locking
and Google OAuth. UI and business rules stay in `src/`. Native preferences may be
stored locally; they are not a second financial ledger.

Google access uses PKCE and `drive.file`, with an explicit user-selected Sheet.
A pasted URL grants no access. New native code accepts **sheet_version 2 only**.
Writes require current identity/schema checks, an explicit reviewed plan, durable
Drive intents/receipts and readback. An uncertain result is reconciled before a
retry. A serial queue in one app does not prove a cross-device transaction lock.
Shared JavaScript will own import, review, close and calculation logic. Python
remains the import oracle until source-by-source plan equality is demonstrated.
AI on iOS is an explicit Claude/ChatGPT handoff with a preview of the shared data;
it does not pretend an external chat is an in-process model capability.

`brand/` owns tokens, icons, mascot, app icons and motion. Hosts request semantic
names. Generated native tokens are the only place for Swift color literals; no
SF Symbols substitute for the shared icons. The dog remains a single-flag
alternative to the cat. Bundles, generated asset catalogs, local credentials and
evidence are ignored build outputs, never copied sources under `ios/`.

Repository shape is checked by `tools/check_shape.py`: only `ios/` may be added
as a top-level folder, and engine/brand copies and nongenerated Swift colors or
system symbols fail CI. No new widgets, domains, visual redesign or Android work
belongs in this implementation. The rejected SwiftUI branch is preserved as
`ios-swiftui-checkpoint`; it will never be merged. Useful logic is brought over
selectively as new changes based on main.

Each milestone has a small PR into main and green CI; the implementing agent does
not merge its own PRs. Evidence belongs in CI artifacts or release assets, with
only a short `ios/ACCEPTANCE.md` in Git. Simulator evidence, physical-device
acceptance and live provider outcomes are reported separately. The container
continues after Ethan's brief positive phone trial. His concrete feedback about
the unavailable AI action is recorded in acceptance. Live OAuth requires an
independent selection and readback on the physical device. No TestFlight upload or App Store submission
is part of this work. All validation uses the fictional Digital Davies household.
