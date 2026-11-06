# Start here

Ten minutes, in order. After this you, or your agent, should be able to work here without guessing.

## The idea

A household's money is scattered across banks, payslips, statements and a shoebox. The Kitty gathers it in one place the
household owns, a Google Sheet, and lets an agent do the admin. A page shows what needs a person. Two ideas hold up the rest:

- **Originals are kept and everything else can be rebuilt.** What a file said, what a person decided, and who and what exists are original. Every total is derived and can be deleted.
- **Nobody forks.** A household depends on the base and never copies it, so improvements reach everyone by rebuilding, and what a person entered is never touched.

The reasons are in [`decisions/`](decisions/).

## Three names

- **The Kitty** is the app in `src/`.
- **The Standard** is the data model in `standard/`.
- **The Davies** are the fictional family. "Digital Davies" means the same family as data.

## Two worlds, not yet joined

This is the thing most likely to trip you up. There are two engines, and the page runs only the first. The two describe one
family, and the second is built on files from the first.

| | What the page reads today | The Standard |
|---|---|---|
| Engine | `src/engine.js` | `standard/engine/` |
| The household | A v2 Google Sheet, frozen as `data/snapshot-v2.json` | Files built on demand into `standard/.build/world/` |
| Files | `sources/`, served by the portals | `sources/` plus eight years of other files, served by the portals' vault |
| Importer | `period-close/`, with `src/core/` as its JavaScript port | `standard/intake/` and `standard/recipes/` |
| Tests | `test.js`, `test-v2.js`, `period-close/test_import.py` | `standard/eval/` |
| Check area | `app`, `import`, `build` | `standard` |

They touch in three places, so a change on one side can move the other:

- The Standard's world copies `sources/` byte for byte and reads `data/snapshot-v2.json`. Change those and locked numbers can move.
- `merchants/` is read by both.
- The Records tab draws `data/standard-view.json`, which `standard/tools/view.js` writes from a replay.

A household cannot start on the Standard yet. That is the next large piece of work, and [decision 6](decisions/0006-blank-household-is-standard-native.md) says how it will start.

## The family

Danny Davies (born 1985) and Daisy Davies (born 1987) have children called Salt, George and Evie.

**The data has not caught up.** The sheet, the portals and the Standard's world still call the parents Jordan and Mia and the
child Ava, until a rename. It is the same family. Use Danny, Daisy, Salt, George and Evie in new prose, and leave existing data
alone. The blind households under `standard/eval/heldout*/` are other families, each with its own invented names.

## First run

```bash
git clone https://github.com/EthDawg/the-kitty.git && cd the-kitty
python3 check.py
```

You need Python 3.9 or later and Node 22, and nothing else. It takes about two minutes and prints one line per area. `portals`
shows SKIP on a fresh clone, because its browser proof needs `npm ci && npx playwright install chromium` in `portals/`. Everything
else should say PASS. `ios` checks only that the Xcode project is deterministic; the simulator tests run in CI.

To see the page, run `python3 build.py --v2`, then `python3 -m http.server 8765 --directory dist`, and open
`http://localhost:8765/local-v2.html`. To see the Standard work, run `node standard/world/build.js && node standard/eval/all.js`.

## Where to begin, by task

| You want to | Read first | Then run |
|---|---|---|
| Add a merchant | [`merchants/README.md`](../merchants/README.md), Adding a merchant | `python3 check.py app standard` |
| Add a household the model gets wrong | [`CONTRIBUTING.md`](../CONTRIBUTING.md), From a shape to a fixture | `python3 check.py standard` |
| Read a new kind of file | [`standard/RECIPES.md`](../standard/RECIPES.md) | `python3 check.py standard` |
| Change the data model | [`standard/SPEC.md`](../standard/SPEC.md), [`standard/GOVERNANCE.md`](../standard/GOVERNANCE.md) | `python3 check.py standard` |
| Change a number on the page | [`ARCHITECTURE.md`](../ARCHITECTURE.md), `src/engine.js` | `python3 check.py app` |
| Change how the page looks | [`brand/README.md`](../brand/README.md), `src/kit/` | `python3 check.py brand app build` |
| Change the importer | [`period-close/README.md`](../period-close/README.md), `src/core/period-CONTRACT.md` | `python3 check.py import` |
| Change a portal | [`portals/README.md`](../portals/README.md) | `python3 check.py portals` |
| Work on the iPhone host | [`ARCHITECTURE.md`](../ARCHITECTURE.md), [`ios/ACCEPTANCE.md`](../ios/ACCEPTANCE.md) | `python3 check.py ios`, then CI |
| Find out what a word means | [`GLOSSARY.md`](GLOSSARY.md) | |
| Find out if a folder is still used | [`MAP.md`](MAP.md) | |

## What is proved, and what is not

Trust the check, and read its limits. `standard/eval/SCOREBOARD.md` has the Standard's numbers. The Davies score well because
the engine was built around them. The three blind households scored much worse, and those results are kept as written, because a
fixture proves a repair and only a blind run tests whether it generalises. On the page's side, a passing test on `data/` is
fictional data at rest. A live read or write has been exercised only on the fictional sheet.
