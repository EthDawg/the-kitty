# AGENTS.md

The operating manual for any agent here. Read all of it.

## What this is

The Kitty is a household money system: one Google Sheet, one page, an agent doing the admin, no server.
The Standard (`standard/`) is the open data model underneath it. The page still reads the older v2 sheet.
The Davies are the fictional family everything is tested on. Nothing real is ever in this repository.

## The map

| Path | What it is |
|---|---|
| `src/` | The app. `engine.js` works out every number, `app.js` is the page, `kit/` the components, `core/` the JavaScript importer |
| `test.js`, `test-v2.js`, `fixtures/` | The app's tests and their frozen data. A new household does not go here |
| `standard/` | The data model: `SPEC.md`, `schema/`, `engine/`, `recipes/`, the Davies `world/`, the benchmark in `eval/` |
| `merchants/` | The merchant dictionary. The page and the Standard's benchmark both read it |
| `period-close/`, `sources/` | The Python importer for the v2 sheet, and the fictional bank files it reads |
| `portals/`, `brand/`, `ios/`, `skills/`, `tools/` | Parody bank sites, brand sources, the iPhone shell, agent skills, checks |

Begin at [`docs/START-HERE.md`](docs/START-HERE.md), which says what to read for your task. [`docs/MAP.md`](docs/MAP.md) covers every
folder, [`docs/GLOSSARY.md`](docs/GLOSSARY.md) every word, and [`CONTRIBUTING.md`](CONTRIBUTING.md) what a pull request carries.

## The one command

```bash
python3 check.py          # everything, under three minutes, needs Python 3.9+ and Node 22
python3 check.py app      # one area while you work; --list shows them all
```

CI runs this. Run all of it before you call anything done. SKIP is not PASS: say what was skipped. New checks go in `check.py`, never in a workflow.

## The rules

1. **Fiction only.** A real household's problem arrives as a fictional twin. Only shapes flow in, never data. Real brands in `merchants/` are the one exception.
2. **Nobody forks.** The sheet holds every number and owns every original. New logic goes in the engine or shared data, never in one household's copy.
3. **One app, two hosts, no server.** The Claude artifact and the iPhone shell run the same `src/`.
4. **A number has one owner:** the sheet, or `src/engine.js`. The page draws. Writes are few, narrow and read back.
5. **The Standard is a public API.** A change carries a failing case and follows [`standard/GOVERNANCE.md`](standard/GOVERNANCE.md). Add, never change a meaning.
6. **Change the source, then regenerate.** `docs/MAP.md` lists every output and what writes it.
7. **Plain language.** Australian spelling, short sentences, money as money, estimates labelled. Experimental things say so. Numbers are not tax advice.

## How a change is judged

- `python3 check.py` passes, and the pull request shows it.
- A case fails before the change and passes after it.
- It fixes the shape, not the family. A score after a repair proves only the repair.
- Nothing a person entered moves. A locked number moves only with its reason in the same commit.
- The pull request says what was proved: fixture, simulator, device or live.

## What never to do

- Put a real name, account, bank file, sheet link or private path in anything tracked or in a commit message.
- Touch a real household's sheet, or sign in as a real person. Type, read or store a password, PIN, card number or one-time code.
- Add a server, a database, telemetry or a new top-level folder.
- Edit a file in `sources/`, a `BLIND-n.md` result or anything generated.
- Copy the engine or brand files into `ios/`.
- Imitate a real institution. Portals stay parodies.
- Present a mock as finished, or demo data as live.
- Merge your own pull request.
