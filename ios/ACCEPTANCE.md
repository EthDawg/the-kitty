# Native host acceptance

Milestone 2 is an offline container preview with verified physical-device runtime.
`build.py --host native` bundles the shared v2 engine, views, fictional Davies
snapshot, fonts and pinned libraries. The native host supplies local preferences,
demo identity and Files export; Google and AI capabilities are explicitly unavailable.

Verified locally on 5 November 2026: shared engine/shim (58 tests), build/shape
(34 tests), existing importer (41 tests), and all seven iPhone simulator tests.
WebKit checks cover Home, Activity, Review, Insights and Goals, bundled fonts,
blocked network fetches, route restrictions, reduced motion and largest Dynamic
Type. Touch tests cover search/keyboard, a demo category decision and Files save
and cancellation. The saved Woolworths CSV was read back: 38 records, 4,604 bytes,
matching the shared engine's export byte for byte (SHA-256
`e2f949dceb1e838544f34e793fcf943a284385e79336680fa985b57b0b7f46c9`).
Body text follows the preferred size; compact navigation and headline amounts
are capped at 140% to preserve access to every tab.

All four runtime tests also pass on Ethan's iPhone 16 Pro Max and on the narrow
iPhone SE simulator in dark mode. The generated page is byte-identical in both
device bundles. Physical touch-only follow-up was cancelled when the phone locked;
touch automation is proven on the simulator. Ethan's personal phone-feel verdict,
live Google selection/writes, import parity and end-to-end proof remain unverified.
The shared container continues on the technical evidence. No TestFlight or App
Store submission has been made.

Reproduce: `python3 ios/scripts/generate_project.py`, then
`python3 ios/scripts/prepare_resources.py`, then the test command in
`.github/workflows/ios.yml`. Full-resolution screenshots, logs and `.xcresult`
bundles stay in ignored `ios/build/` locally and CI's `ios-build-evidence`
artifact; they are not committed. The public artifact is unchanged.
