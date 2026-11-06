# Map

Every top-level folder: what it is, whether it is current, and who owns it. Owner means the area in
[`MAINTAINERS.md`](../MAINTAINERS.md). `check_shape.py` fails on a new top-level folder, so this list stays whole.

**Current** is in use and growing. **Generated** is an output: never edit it, change what writes it. **Legacy** still runs, and
nothing new should be built on it. **Unused** is read by no code.

| Folder | What it is | Status | Owner |
|---|---|---|---|
| `.github/` | CI, which runs `check.py`, plus templates and `CODEOWNERS` | Current | Project |
| `apps-script/` | The script bound to the frozen 1.1 sheet. Serves it as JSON for `snapshot.py` | **Legacy.** The v2 sheet has no deployed feed and does not need one. CI does not run it | App |
| `brand/` | Tokens, icons, mascots and motion. `build_brand.py` and `generate_tokens.py` write the outputs | Current | App |
| `data/` | The fictional household as JSON, bundled into the page | **Generated.** See below | App |
| `docs/` | These pages, decisions and screenshots | Current | Project |
| `fixtures/` | Frozen cuts of the sheet for the app's tests | Current. See below | App |
| `ios/` | The iPhone shell: a WKWebView around `src/` | Current. Not released. Its simulator tests run only in CI | iOS host |
| `merchants/` | The merchant dictionary and the category-to-icon map | Current. The Standard's benchmark reads it too | App |
| `period-close/` | The Python importer for the v2 sheet, and the records of two closes | **Current, on its way out.** See below | Importer |
| `portals/` | Parody portals on Vercel, the fictional download path | Current | Demo world |
| `skills/` | Agent skills. One so far, `bank-export` | Current | Project |
| `sources/` | The Davies' bank files as delivered, one per account per month since March 2019 | **Generated.** See below | Demo world |
| `src/` | The app: engine, page, kit, hosts, JavaScript importer | Current | App |
| `standard/` | The data model, its world and its benchmark | Current. The spec and engine are stable; surfaces in `EXPERIMENTAL.md` are not | Standard |
| `tax/` | Two dated data files, tax tables and the rental schedule | **Unused.** See below | Standard |
| `tools/` | Checks, their tests, parity runs and converters | Current | Project |

## Straight answers

**`data/`.** All three files are fictional and all three are read by code, so do not hand edit them.

| File | Written by | Read by |
|---|---|---|
| `snapshot-v2.json` | `tools/grid_to_snapshot.py`, from connector reads of the v2 sheet | The page, `test-v2.js`, `fixtures/make-v2-fixtures.py`, Ask's tests, the Standard's world |
| `snapshot.json` | `snapshot.py`, from the frozen 1.1 sheet's feed. **Legacy** | `test.js`, the importer's default, `portals/build-data.py`, `python3 build.py` |
| `standard-view.json` | `node standard/tools/view.js`. **No check holds it current** | The Records tab |

**`fixtures/`.** `snapshot-2026-11.json` is a frozen month for `test.js`. `everyday-only.json` and `everyday+property.json` are cut
from `data/snapshot-v2.json` by `make-v2-fixtures.py` for `test-v2.js`, and CI proves they are exactly what it cuts. A new household
shape does not go here. It goes in `standard/eval/households/`.

**`period-close/`.** This is the only path from bank files to a v2 sheet today, and the reference the JavaScript port in `src/core/`
is held to by `tools/period_parity.py`. The agreed end is that JavaScript replaces it, in its own PR, once the two plans are equal.
`simulate.py` and `pull_portals.py` stay as demo tools. `2026-12/` and `2027-01/` are records of the two closes run on the demo sheet, and
`check.py` repeats January from them, so keep them. `state.json` is the simulator's place in time.

**`sources/`.** These are not real bank files, and they are not free to edit. `portals/build-data.py --write-sources` and
`period-close/simulate.py` write them. The importer, its parity run and the portals' proof read them, and the Standard's world copies
them byte for byte (`standard/world/domains/banks.js`), so a change here can move a locked number. Files are kept exactly as an
institution would deliver them. A change to one is a change to the fiction, and it happens in the generator.

**`tax/`.** No code reads either file. Both were written for a phase of work that has not happened. The Standard's dated tax data in
`standard/reference/` covers what `tax-tables.json` was for, and the Standard's `tax_map` does the job of `rental-schedule.json`,
though nobody has compared them line by line. Treat `standard/reference/` as current and do not build on `tax/`.

**`ios/`.** Current and not abandoned. It is a thin host, so product logic does not belong in it, and `check_shape.py` rejects copied
engine or brand files. A fresh clone cannot run its simulator tests without Xcode. `python3 check.py ios` proves only that the project
file is deterministic, and `.github/workflows/ios.yml` does the rest.

## What writes what

Never edit an output by hand. Change its source, run this, and commit both. `check.py` fails if a committed output is stale, except where noted.

| Output | Written by |
|---|---|
| `standard/generated/` | `node standard/tools/generate.js` |
| `standard/eval/SCOREBOARD.md`, `locked.json`, `history.jsonl` | `node standard/eval/all.js --write`, after a Standard change. Only the locked numbers are checked |
| `data/standard-view.json` | `node standard/tools/view.js`. Not checked. A timing field changes every run, so commit it only when the rest moves |
| `data/snapshot-v2.json` | `tools/grid_to_snapshot.py`, from connector reads. Not checked |
| `fixtures/everyday*.json` | `python3 fixtures/make-v2-fixtures.py` |
| `sources/` | `portals/build-data.py --write-sources`, `period-close/simulate.py`. Not checked |
| `src/tokens.css`, `ios/Kitty/Generated/` | `python3 brand/generate_tokens.py` |
| `brand/icons/` | `python3 brand/build_brand.py --icons-only` |
| `ios/Kitty.xcodeproj` | `python3 ios/scripts/generate_project.py` |
| `dist/` | `python3 build.py`. Ignored by git |

## Files at the root

| File | What it is |
|---|---|
| `AGENTS.md`, `CLAUDE.md` | The agents' manual, and a pointer to it |
| `check.py` | The one command |
| `build.py` | Bundles the page. `--v2` builds what is published |
| `snapshot.py` | Refreshes `data/snapshot.json` from the frozen 1.1 sheet. **Legacy** |
| `test.js`, `test-v2.js` | The app's tests, on the frozen 1.1 month and on the ledger |
| `kitty.config.json` | The fictional sheets' IDs and the public page's URL |
| `ARCHITECTURE.md` | One app, two hosts, and the sheet today |

## Other things a stranger trips on

- There are three importers: `period-close/` (Python, the reference), `src/core/` (the JavaScript port) and `standard/intake/` (the Standard's, driven by recipes).
- `fixtures/`, `period-close/fixtures/` and `standard/eval/households/` are three different kinds of fixture. See the [glossary](GLOSSARY.md#testing).
- The `standard` area recalculates the workbook in LibreOffice if `soffice` is installed, and skips that step if not. With LibreOffice open, or another run at the same moment, it can fail with `Command failed: soffice`. Close it and run again.
- `src/vendor/` holds pinned third-party code. Do not edit it. `src/tokens.css` is generated from `brand/tokens.json`.
- `standard/.build/`, `dist/` and `portals/node_modules/` are ignored outputs.

## Proposed moves

Nothing here has moved. Each needs a person's agreement and its own PR, and each must keep `check.py`, the tests and iOS working.

1. **Fold `tax/` into the Standard.** Compare both files with `standard/reference/` and the `tax_map`, carry over anything missing, then remove the folder and its line in `check_shape.py`.
2. **Retire the 1.1 sheet in one PR.** Remove `apps-script/`, `snapshot.py`, `data/snapshot.json` and the v1 branch of `build.py` together. First move `test.js`, `portals/build-data.py` and the importer's default onto the v2 snapshot.
3. **Remove the Python importer once parity holds.** Keep `simulate.py` and `pull_portals.py`, perhaps under `portals/`, and keep `2027-01/` as test input.
4. **Move `test.js` and `test-v2.js` beside the code,** under `src/`, as `src/hosts/native.test.js` already is. Rename them for what they test.
5. **Name the fixtures apart.** Rename `fixtures/` to something that says it is the app's, so it stops reading as the place for a new household.
6. **Hold `data/standard-view.json` current.** Drop its timing field, then add a check to the `standard` area, or generate it at build.
7. **Trim `ARCHITECTURE.md`'s iOS milestones into `ios/`,** so the root page stays one page.
