# Changelog

## 2.0, in progress

- Importer: overlapping exports in one run take each row once (a card calendar export plus a statement export gave 38 rows for 25), and a closing balance that disagrees with the ledger holds the run. Tests in `period-close/test_import_month.py`.
- Portals on Vercel (phase E): https://the-kitty-portals.vercel.app. Seven parody portals with original wordmarks and a DEMO banner (Westpaw, CommBark, Amewx, PING, PropertyMeow, Pawroll, Purrsure) sign in with any name and the password `demo` and return server-generated downloads in the real institutions' column shapes, PDFs through pdf-lib. `portals/build-data.py` builds the data from the sheet's snapshot and the simulator, so a closed month downloaded there is byte-identical to the file under `sources/`. The CommBank headerless shape joins `period-close/adapters.py`; `import_month.py` takes `--sources` and `--out` and reads each account's institution from the sheet's Accounts tab. A Playwright job in CI downloads every shape, imports, reconciles, and shows a repeated month appends nothing. Jordan's old everyday at CommBark exists only in the portals, labelled.

## 1.1 — 3 November 2026
- Theme switch (match device, light, dark) in Setup and in the tour; remembered with the other preferences.
- Large sheets: Transactions is read in chunks of 2,500 rows past the first 2,500, three at a time.
- Slash dates follow the sheet's country (US and Canada read month first); `date_order` on the Kitty tab overrides.
- An empty Transactions tab shows a first-run page instead of failing; a card that cannot draw says so and the other tabs stay up.
- Drawers return focus where it came from, trap Tab while open, and hide the page behind from screen readers.
- Privacy stated plainly on Setup; "report a problem" and "source on GitHub" links.
- Month-end close as the banks deliver it: three file formats, a chained simulator, a de-duplicating importer; December 2026 and January 2027 closed on the demo sheet.
- Progress stated as money everywhere ("$11k of $12k"); a reached lead goal offers the next one.
- Ask the Kitty answers as a planner's note (facts, findings, actions, a novel point, receipts), every button validated against the data.
- Entrance animations run only while the tab is visible.

## 1.0 — 3 November 2026
- First publish: Home, Activity, Insights, Goals, Setup; five-screen onboarding; live Google Sheets read through the viewer's connector with a bundled fictional snapshot as the no-connector fallback; three narrow writes; install to home screen; country data-source guide and the bank-export skill.
