# ChatGPT plan access from an iPhone

Keep **Ask the Kitty** local for the first release. A question about spending can use the shared engine’s existing category, date and transaction functions and show the period behind its answer. Offer **Open the Kitty artifact in Claude** for deeper analysis. The artifact has its own Ask tools and Sheet selection. Opening it alone carries across neither the phone’s active household nor its question. The implemented **Share this answer** action previews the exact question and figures before opening the iOS share sheet. The operating system controls which destinations are available. [Shared Ask tools](../../src/app.js), [existing Kitty artifact](https://claude.ai/artifact/QH2gsDP8sHZmgMVKBtkwxn).

**What OpenAI supports.** Eligible Plus and Pro users can approve plan-funded requests from a locally running open-source app. This repository has an MIT license. The documented flow registers a client for the chosen user and workspace and permits direct API calls from the installation. A stable, opaque host ID and protected rotating refresh tokens allow later sessions to resume. Revocation, expiration or account changes can require sign-in again. Paid or remotely hosted products have a separate interest process. [Eligibility](https://developers.openai.com/siwc/quickstart), [overview](https://developers.openai.com/siwc/token-sharing-open-source), [accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions).

**What the phone must do.** Start an IPv4 listener on `127.0.0.1` before opening the system browser. Keep the exact HTTP callback path and port through code exchange. Each attempt needs fresh state, nonce and S256 PKCE. The first registration returns an issued client ID. Validate the ID token’s signature and claims, then check the actual plan-use grant. Store credentials in protected native storage. [Registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in).

**What was tested.** `LoopbackProbe.swift` ran successfully on macOS 26.5.1 and as a standalone arm64 process on an iPhone SE simulator with iOS 26.5. It bound only `127.0.0.1` on a kernel-assigned port and generated random state. Across real local TCP connections it rejected a wrong state, changed path, duplicate state, wrong Host header and placeholder client ID. It accepted one fictional callback and immediately closed the listener. Every request stayed within the test process’s local host. The probe never opens a browser or contacts a provider.

**What still needs a phone.** The installed iPhoneOS 26.5 SDK exposes custom-scheme and associated-HTTPS callbacks in `ASWebAuthenticationSessionCallback.h`. OpenAI requires plain HTTP loopback. A native implementation needs its independent listener to stay serviceable while the person uses the system browser. UIKit exposes an expiration handler for finite background time. Actual household devices and installed default browsers may behave differently from this simulator, particularly during MFA, a long consent screen, app switching or lock/unlock. Physical browser return, consent, refresh and provider eligibility remain untested.

Ship **Ask ChatGPT** after a consenting user has received a correct answer on their own iPhone. Use the account’s available models and a minimal, reviewed set of facts calculated on the device. The plan route requires `store: false`, streaming, and context supplied with each request. Treat the answer as complete only at `response.completed`. An interrupted stream, declined sharing or exhausted plan allowance needs a distinct outcome. The user should see the active plan and its usage controls. [Inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference), [preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations), [UI guidance](https://developers.openai.com/siwc/ui-ux-guidelines).

From the repository root on macOS with Xcode installed, run the isolated transport check:

```sh
xcrun swiftc -parse-as-library tools/ask-provider-probe/LoopbackProbe.swift -o /tmp/kitty-loopback-probe
/tmp/kitty-loopback-probe
```

For an already booted arm64 iPhone simulator, set `KITTY_PROBE_SIMULATOR` to its UDID first:

```sh
xcrun --sdk iphonesimulator swiftc -parse-as-library -target arm64-apple-ios17.0-simulator \
  -sdk "$(xcrun --sdk iphonesimulator --show-sdk-path)" \
  tools/ask-provider-probe/LoopbackProbe.swift -o /tmp/kitty-loopback-probe-sim
xcrun simctl spawn "$KITTY_PROBE_SIMULATOR" /tmp/kitty-loopback-probe-sim
```
