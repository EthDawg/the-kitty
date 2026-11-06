# AGENTS.md

The operating manual for any agent working here. Read all of it. It is short on purpose.

## What this is

The Kitty is a household money system: one Google Sheet, one page, an agent doing the admin, no server.
The Standard (`standard/`) is the open data model underneath it. Today the page still reads the older v2 sheet.
The Davies are the fictional family everything is tested on. Nothing real is ever in this repository.

## The map

| Path | What it is |
|---|---|
| `src/` | The app. `engine.js` works out every number, `app.js` is the page, `kit/` the components, `core/` the JavaScript importer, `hosts/` the iPhone boundary |
| `test.js`, `test-v2.js` | The app's tests, pinned to `fixtures/` and `data/` |
| `standard/` | The data model: `SPEC.md`, `schema/`, `engine/`, `recipes/`, the Davies `world/` and the benchmark in `eval/` |
| `merchants/` | The merchant dictionary. Both the page and the Standard's benchmark read it |
| `period-close/` | The Python importer for the v2 sheet, reading the bank files in `sources/` |
| `portals/` | Parody bank sites that hold the Davies' files |
| `brand/`, `ios/`, `skills/`, `tools/` | Brand sources, the iPhone shell, agent skills, checks and converters |
| `docs/` | [`START-HERE.md`](docs/START-HERE.md), [`GLOSSARY.md`](docs/GLOSSARY.md), [`MAP.md`](docs/MAP.md), [`decisions/`](docs/decisions/) |

`docs/MAP.md` says what every folder is, whether it is current or legacy, and who owns it.
`docs/START-HERE.md` tells you where to begin for a given task. `CONTRIBUTING.md` says what a pull request must carry.

## The one command

```bash
python3 check.py          # everything, about two minutes, needs Python 3.9+ and Node 22
python3 check.py app      # one area; python3 check.py --list shows them all
```

CI runs this and nothing else. Run it before you call anything done. SKIP is not PASS: say what was skipped.
A new check goes in `check.py`, never in a workflow. A check that changes the working tree fails.

## The rules

1. **Fiction only.** Every name, account, figure and file here is invented. A real household's problem arrives as a fictional twin. Only shapes flow in, never data.
2. **Nobody forks.** The sheet holds every number and owns every original. New logic goes in the engine or shared data, never in one household's copy. See [`docs/decisions/`](docs/decisions/).
3. **One app, two hosts, no server.** The Claude artifact and the iPhone shell run the same `src/`. Hosts add capabilities, never logic.
4. **The page draws, it does not decide.** A number has one owner: the sheet, or `src/engine.js`. Writes are few, narrow and read back.
5. **Every change to the Standard carries a failing case.** See [`standard/GOVERNANCE.md`](standard/GOVERNANCE.md). The schema is a public API: add, never change a meaning.
6. **Change the source, then regenerate.** `standard/generated/`, `data/`, `sources/`, `dist/` and `fixtures/everyday*.json` are outputs. `docs/MAP.md` names what writes each.
7. **Plain language.** Australian spelling, short sentences, money stated as money, estimates labelled as estimates. Experimental things say so on the page. Numbers are not tax advice.

## How a change is judged

- `python3 check.py` passes, and the pull request shows it.
- A case fails before the change and passes after it.
- It fixes the shape, not the family. A score after a repair proves only the repair.
- Nothing a person entered moves. A locked number moves only with its reason in the same commit.
- The pull request says what was proved and what was not. A fixture is not a simulator, and a simulator is not a live run.

## What never to do

- Put a real name, account, bank file, sheet link or private path in anything tracked, including commit messages.
- Touch a real household's sheet or files, or sign in as a real person.
- Type, read or store a password, PIN, card number or one-time code. `skills/bank-export/SKILL.md` has the rules.
- Add a server, a database, telemetry or a new top-level folder.
- Edit a bank file under `sources/`, a `BLIND-n.md` result or anything generated.
- Copy the engine or brand files into `ios/`.
- Imitate a real institution. Portals stay parodies, on Vercel.
- Rename, reorder or reuse a meaning in the schema.
- Present a mock as finished, or demo data as live.
- Merge your own pull request.
