# One Kitty, one host

The household owns its Google Sheet. It owns every financial number, source record
and reviewed decision. The Kitty is one product with one host: the Claude artifact
page, built from `src/` by `build.py`, renders the app, engine and UI against that
Sheet. There is no server, separate financial database, subscription or remote
executable code. On a phone, the same page is added to the Home Screen.

`build.py` assembles the page. The artifact supplies its host capabilities through
`window.claude.use()`: `mcp`, `sample`, `db`, `user` and `downloads`. Unavailable
capabilities return `null`; demo mode never claims a live connection. UI and business
rules stay in `src/`. Display preferences may be kept on the device and in the
viewer's Claude account; they are not a second financial ledger.

The page reads the Sheet through the viewer's own Google Sheets connector, with their
consent. A pasted URL grants no access. The page writes only the cells listed in
`WRITES` in `src/app.js` (Setup shows the same list), only for the owner of a live
Sheet, each behind a click and each read back after. Imports and month-end closes
belong to the harness: Claude or Codex reads the household's files, writes one typed
batch at the revision it read, and reads the Sheet's checks (`skills/kitty/SKILL.md`).

Ask on the page is Claude, through `sample`, with read-only tools over the numbers
the page already shows. The model-free skills and paraphrase router in `src/kit/`
are kept and tested against the Sheet's rows. See [Ask the Kitty](docs/ask.md).

`brand/` owns tokens, icons, mascot, app icons and motion. The page requests semantic
names: `src/tokens.css` is generated from `brand/tokens.json`, and icons come from the
brand sprite. The dog remains a single-flag alternative to the cat. Built pages are
ignored outputs in `dist/`, never copied sources.

`standard/` holds the household data standard, its engine and its benchmark. It is the model the Sheet and
the app move onto in stages; today the app reads it through `data/standard-view.json` on the Records tab only.

Repository shape is checked by `tools/check_shape.py`: the top-level folders are an
agreed list, so an `ios/` folder fails, and a copy of the engine's or a brand asset's
bytes outside its source fails CI. The iOS app (a WebKit container for this page) and
its native host were retired on 8 Nov 2026. That work stays in git history, and the
earlier SwiftUI branch on the `ios-swiftui-checkpoint` tag; neither will be merged.

Each change is a small PR into main with green CI; the implementing agent does not
merge its own PRs. Evidence belongs in CI artifacts, release assets or `evidence/`.
All validation uses fictional households.
