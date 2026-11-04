# Google access: implementation and acceptance

The native client uses Google's installed-app OAuth flow with S256 PKCE, a random verified state,
ASWebAuthenticationSession, a registered reverse-client-ID callback and Keychain storage restricted
to this unlocked device. There is no client secret. Refresh requests are coalesced; disconnect cancels
in-flight authentication and refresh, clears the Keychain and attempts Google-side revocation. A failed
revocation is reported separately from local disconnection.

## Configuration

Register an **iOS** OAuth client for the actual signed bundle ID in the project's Google Cloud account.
Enable the Google Drive and Google Sheets APIs; configure the external consent screen and testing
users or complete the relevant production verification. These are provider actions, not performed by
adding a plist entry.

In the app Info.plist, populate `GoogleClientID` with that registered client ID. Under
`CFBundleURLTypes → CFBundleURLSchemes`, register its exact reverse, for example a client ID ending
`.apps.googleusercontent.com` reverses to a scheme beginning `com.googleusercontent.apps.`.
The redirect URI used by the implementation is `<reversed-client-id>:/oauthredirect`.
Missing or unresolved configuration produces a typed failure before opening Google sign-in.

Only `https://www.googleapis.com/auth/drive.file` is requested. The file list therefore shows files
created or explicitly granted to this app, **not** every Sheet in the person's Drive. Pasting a URL
cannot grant the app access. There is no hidden fallback to broader scopes.

`copyTemplate(name:)` calls Drive files.copy on the original public fictional Davies template. The
copy remains a **demo copy containing fictional rows**; this call does not empty it, deploy its bound
script, widen sharing, or turn it into real household records. The app requests explicit selection of
that template using Google's native Picker before copying. Both existing-Sheet selection and copying
must still be proven with the actual OAuth client. There is no fallback to all-Drive access.

Disconnect hides household data, clears ordinary caches and blocks saved credentials before cleanup.
A durable receipt for an uncertain write is retained separately and can only be resumed after fresh
authorization to its exact Sheet. A failed local cleanup cannot silently restore a connection on launch.
No Google profile identity is requested by this minimal connection.

## Read and write boundaries

`batchGet` reads unformatted cells with numeric date serials. It does not use the public anonymous
Apps Script feed, connector caches or a proxy identity.

`writeAndVerify` permits only bounded existing input cells:

- Goals target/date in B:C, with the existing goal name in A as a checked identity.
- Known Kitty preference values in B; no schema or public-feed switch.
- The existing emergency-fund target setting in B.
- A v1 Subscriptions decision in G; v2 Subscriptions is a formula view and cannot be written.

Before writing, the method rereads the cell value, row identity and known sheet_version. It then writes
using RAW, followed by an independent readback of values and row identity. Native date inputs must be
converted to a Google date serial with `GoogleSheets.dateSerial` so Sheets formula arithmetic works.
No arbitrary import append, raw Transactions write, helper-column overwrite or formula entry is exposed.

If a mutation response is lost, the client rereads before reporting a result. It does not retry that
mutation. An exact final match returns a receipt with `responseWasLost = true`; an unverifiable result
stays unresolved. Template copies also are never automatically retried after an uncertain response.

This is **conflict detection, not transaction isolation**. Google values.update has no compare-and-swap
parameter; another writer can act between preflight and write. A multiwriter import requires its own
server-side serialisation and idempotency protocol. The small native writer is not that protocol.

## Verification performed

2026-11-04: iOS 17 arm64 simulator typecheck, Swift 5 mode, passed for both service files.
Twelve local mock-HTTP checks passed: authorised-file listing, permission inspection and denial,
write allowlist, stale values, unsupported schema, exact readback, lost-response reconciliation without
retry, row movement and strict cell types. Native tests also cover failed credential cleanup,
persisted sign-out, explicit Picker selection and protected drafts.

Run the checks from the repository root:

```sh
swiftc -swift-version 5 -module-cache-path /private/tmp/kitty-google-swift-module-cache -parse-as-library ios/Kitty/Services/GoogleSheets.swift ios/IntegrationNotes/GoogleSheetsTests.swift -o /private/tmp/kitty-google-checks
/private/tmp/kitty-google-checks
```

These checks do **not** establish a successful Google login, copied workbook, real Sheet write,
revocation, second household identity, or release approval. Those need the registered app configuration,
actual account consent and provider readback.

## Official references checked

- [Installed-app OAuth and PKCE](https://developers.google.com/identity/protocols/oauth2/native-app)
- [Drive file scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Drive files.copy](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/copy)
- [Drive files.list](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list)
- [Sheets values.batchGet](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/batchGet)

## Native Picker update, 4 November 2026

Google's current desktop/mobile Picker integrates with the system OAuth browser using `trigger_onepick=true`, `prompt=consent`, `mimetypes=application/vnd.google-apps.spreadsheet`, and callback `picked_file_ids`. The app now uses this path with PKCE and state validation, then validates the selected workbook before showing it. It does not embed Google sign-in or Picker in a WebView or request access to every Sheet. Template-copy onboarding requests selection of the known public fictional template before copying it into the user's Drive.

Source: https://developers.google.com/workspace/drive/picker/guides/desktop-mobile-picker (updated 2026-10-12). Google Picker API must be enabled on the same Cloud project. Provider execution remains unverified until the actual client is configured.
