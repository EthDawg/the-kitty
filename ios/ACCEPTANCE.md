# Native host acceptance

The offline iOS app renders the shared v2 engine, views, fictional Davies data,
fonts and brand. Home, Activity, Review, Insights and Goals work without Google
or AI access. The phone uses the same Appearance controls as the artifact;
offline Review offers manual categorisation and hides the unavailable AI cookie.

On 5 November 2026 the original bundle passed all four runtime tests on an
iPhone 16 Pro Max and a narrow iPhone SE simulator in dark mode. Ethan tried
the app, liked the clean Setup and pop-ups, and identified the misleading
“open this page in Claude” instruction. This was a brief trial, not exhaustive
physical touch validation. Continue with the shared container.

After integrating the canvas changes, 59 Node, 34 build/shape, 41 importer
and all seven iPhone 17 Pro simulator tests pass. Checks cover five views,
largest text, reduced motion, fonts, blocked network fetch, demo review,
keyboard, accessible drawer dismissal, theme and real Files save/cancel.
Simulator Files readback: 38 fictional Woolworths rows, 4,604 bytes; the CSV
matches the engine byte for byte (SHA-256
`e2f949dceb1e838544f34e793fcf943a284385e79336680fa985b57b0b7f46c9`).
Body text follows the device; compact navigation and headline amounts cap at
140%. iPhone uses portrait; iPad retains all orientations.

Reproduce with `python3 ios/scripts/generate_project.py`, then
`python3 ios/scripts/prepare_resources.py` and the test command in
`.github/workflows/ios.yml`. Full-resolution evidence stays in ignored
`ios/build/` and CI's `ios-build-evidence` artifact.

This PR does not publish an artifact. Its shared source also avoids a
snapshot-startup gate flash, stops count-up when reduced motion turns on,
and removes a closed drawer from the accessibility tree. Live selection and
writes, import parity, AI handoff and release acceptance require later proof.
No TestFlight upload or App Store submission has been made.

Milestone 3 begins with a read-only selection check. The registered public iOS
client and reversed callback are present in the signed app. In Setup, “Choose demo
Sheet” runs Google’s explicit one-file Picker, binds the returned account and
Sheet, and reads its Drive metadata and v2 marker. It reports the actual file
permission, without changing rows or labelling snapshot numbers Live. Eighteen
injected-response tests cover OAuth, secure storage, bounded HTTP, stale accounts,
wrong files and ambiguous versions. They do not prove live Google consent.
