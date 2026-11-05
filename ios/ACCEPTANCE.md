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

On 5 November at 15:26 Sydney time, the signed build on Ethan's iPhone verified
the existing **Digital Davies v2** Sheet as an editor. Its protected device
receipt matched the expected file and the installed page (SHA-256 `100cea52…f7418`).
The probe read Drive metadata, tab names and the version marker; it wrote no cells.
This establishes selection separately from reading the dashboard.

At 16:00 Sydney time the same physical iPhone reopened its saved grant without
another login. The shared dashboard showed **Live · demo sheet**, **$99,388**
cash and offset, **1,082 entries** and **5 entries needing review**. The test
made a second uncached request for the Sheet's `networth.cash` metric and compared
it against the rendered Home value. They matched. The physical XCTest bundle
holds the JSON receipt and 1320 × 2868 screenshot. This was read-only.

The shared ledger reader preserves physical row numbers across empty Sheets
pages. A fictional regression places an entry on row 5,003 and finds it at that
exact address; a populated Entries or Decisions row without its ID fails the
read. These checks do not enable native ledger writes.

Opening a v2 Sheet now leaves its settings untouched; the existing “Worth it?”
default of 40 still applies when no threshold is set. A missing ledger tab or
moved category/decision column prevents a Live result.

The iPhone's ordinary category picker saved the fictional $38.50 Market Lane
entry (T0761) as Dining. The first write used a text date; the Sheet's own
Latest formula rejected it despite the dashboard dropping from five to four
reviews. At 16:28 Sydney the corrected signed build changed only that record's
date, then passed a fresh physical test: Entries!H762 = DINING, Decisions row 21
contains the same unique decision, G21 is numeric 46331, I21 = TRUE, and J21 =
T0761|categorise. Prior row 20 is intact. The iPhone showed four reviews,
1,082 entries and $99,388; the [published artifact check](https://github.com/EthDawg/the-kitty/pull/16#issuecomment-6650396347)
also found four and $99,388. A biometric or passcode lock is optional. Simulated
unlock outcomes are tested; a physical Face ID acceptance was not recorded.

The brand drill changes the page background, Offset drawing and mascot in a
temporary checkout. Both built pages use the changed tokens, sprite and art.
The generated Swift colours and Xcode launch assets match, and the app icons
exchange places. A local iOS 26.5 simulator also opened Appearance and read the
registered primary/alternate icon state. No Home Screen preference on Ethan’s
phone was changed for this proof.

Native Ask was exercised in the real bundled WKWebView on an iPhone 17 Pro
simulator (iOS 26.5). The test opened the emergency-fund scenario and its two
eligible subscriptions, typed a groceries question, opened its ledger row,
compared the previous month, previewed the exact answer and opened the system
share sheet without sending. The merchant check opened the ordinary category
picker. Full-resolution screenshots accompany the XCTest result. A signed update
installed on the paired physical iPhone; its lock prevented an automated launch.
That installation establishes neither physical Ask usability nor local model inference.

The local Apple model classified five ordinary fictional questions correctly on
the first Mac probe, declined two more and returned one service error; three
additional safety cases were correctly refused. A repeat probe declined those
same three safety cases but the model service failed on all eight other prompts,
and an independent one-word control also failed. Core answers need no model.

A read-only check on the published Davies v2 Sheet found exactly four December
2026 grocery entries (T0834, T0844, T0853, T0866), totalling $1,429.05. The
two subscription decisions eligible for the emergency-fund scenario total
$449.88 a year, or $37.49/month. Goals showed $26,902.84 of $30,000, a target
date of 31 December 2026, and a recorded pace of about $700.05/month. The June
2027 estimate and the original deadline are displayed separately.
