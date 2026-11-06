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
On iOS, Ask runs read-only skills against the household currently visible. The
shared engine supplies amounts, dates, source entries and goal projections. The shared router resolves known paraphrases. For a bounded question whose meaning
is ambiguous, the app shows the labelled alternatives immediately. Apple model inference
is a developer experiment outside the app target. Core questions
and follow-ups work without the model or a network connection. Sharing is optional:
preview the exact answer, then choose an app in the iOS share sheet. The public
Claude link is explicitly the fictional demo, never a private household session.
See [Ask behaviour, tests and provider limits](docs/ask.md).

## The sheet today

This is `sheet_version` 2, the sheet the page reads. The Standard's tabs are a later version.

Raw tabs are append-only. Input tabs are set up once (Accounts, Categories, Goals, Loans, Settings and the Kitty tab this page
owns). View tabs are formulas only (Cash Flow, Budget, Savings Finder, Mortgage Scenarios, Tax Forecast, Compliance Checks, Net
Worth). Metrics names each headline figure once. The page draws from Metrics and the views, derives only what a search or a
window needs, and checks its derivations against the sheet in the trust drawer. It writes few things, each to the owning tab.

Every store of value is a row on Accounts with a type (transaction, savings, offset, credit card, loan, property, vehicle,
device, shares, crypto, super, smsf), an owner, an opening anchor and date, a class, a valuation method (ledger, statement,
appraisal, market, estimate) and a status (active, beta, closed). Everything that happens is a row on Entries of one of three
kinds: a transaction (money moved), a trade (units at a price) or a valuation (a value observed on a date). Balances holds the
balance of every account at every month end: the anchor plus entries for a ledger account, the last valuation carried forward
for the rest. Net Worth is derived from it. Contracts holds recurring obligations, Decisions holds human judgements, and Rules
maps descriptors to merchant, category, tax label and property.

Transactions, Valuations, Assets and Subscriptions are formula views over these, so clearing one breaks it. A transfer is one
event on two accounts paired by `transfer_id`. The sheet and the engine both check the invariant: a mate of the opposite amount
within four days, pairs never count as spending, and each month's change in total balances equals income less spending plus
valuation changes. Loan terms stay on the Loans tab, and Contracts mirrors them by formula.

`brand/` owns tokens, icons, mascot, app icons and motion. Hosts request semantic
names. Generated native tokens are the only place for Swift color literals; no
SF Symbols substitute for the shared icons. The dog remains a single-flag
alternative to the cat. Bundles, generated asset catalogs, local credentials and
evidence are ignored build outputs, never copied sources under `ios/`.

`standard/` holds the household data standard, its engine and its benchmark. It is the model the Sheet and
the app move onto in stages; today the app reads it through `data/standard-view.json` on the Records tab only.

Repository shape is checked by `tools/check_shape.py`: only `ios/` and `standard/`
may be added as top-level folders, and engine/brand copies and nongenerated Swift colors or
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
