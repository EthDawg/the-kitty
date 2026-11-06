# Rename plan: Jordan, Mia and Ava become Danny, Daisy and Salt

**Status: parked. Do not run this.** The programme brief decided there is no rename: Danny and Daisy are a new generated life, and the
2019 to 2027 benchmark world keeps Jordan, Mia and Ava. Folding them together later is the project owner's call. This page stays as the
counted cost of doing so. It would touch `standard/world`, so it could not start before PR 24 lands.

Counted on commit `db7ef3c`, branch `standard/household-model`. Count again before starting.

| Old | Canon | World id |
|---|---|---|
| Jordan Davies | Danny Davies | `JORDAN` |
| Mia Davies | Daisy Davies | `MIA` |
| Ava Davies | Salt Davies | `AVA` |

George and Evie are new. Neither appears in the benchmark world. If this ever ran, the birth years would need settling too: the benchmark has 1985, 1987 and 2022, and the profile has 1993, 1995 and 2028.

## How many

6,225 mentions in 138 tracked text files, plus 515 of the world's 2,369 generated files with a name in their file name.

| Word | Mentions |
|---|---:|
| Jordan | 2,313 |
| JORDAN | 2,034 |
| Mia | 1,727 |
| MIA | 120 |
| ava | 9 |
| Ava | 7 |
| mia | 6 |
| AVA | 5 |
| jordan | 4 |

The lowercase `ava` and `mia` rows are mostly sign-in test names and need a look by hand.

| Where | Mentions | Files | What it is | How it changes |
|---|---:|---:|---|---|
| `fixtures/` | 1,988 | 3 | The Kitty's v2 test fixtures | Regenerate, never edit |
| `sources/` | 1,916 | 80 | Bank files the simulator wrote | Regenerate |
| `data/` | 1,414 | 3 | Sheet snapshots | Regenerate from the demo sheet |
| `portals/data/months.json` | 421 | 1 | The portals' dataset | Regenerate |
| `standard/world/` | 229 | 16 | Where the names are written | **Read from the profile. The real work.** |
| `portals/history.py` | 31 | 1 | Invented history | Read from the profile |
| `standard/eval/` | 30 | 2 | `coldstart.json` and an expectation | Regenerate, then re-lock |
| `period-close/` | 27 | 6 | Importer and tests | By hand: the importer must not assume a name |
| `portals/public/` | 27 | 4 | Registries and landing page | Labels read from the profile |
| `tools/` | 51 | 5 | Period and Ask tests | By hand |
| `src/` | 20 | 4 | The page | By hand |
| `test-v2.js`, `test.js` | 25 | 2 | Page tests | By hand |
| `portals/test/` | 14 | 3 | Playwright | By hand |
| `portals/lib/` | 12 | 2 | Card member string, tests | Read from the profile |
| `portals/README.md`, `README.md`, `CHANGELOG.md`, `standard/SPEC.md` | 11 | 4 | Words | By hand. Leave the changelog's history alone. |
| `standard/intake/` | 7 | 1 | Importer tests | By hand |
| `portals/build-data.py` | 2 | 1 | Build | By hand |

## Things that are not a find and replace

1. **Names become data.** `standard/world` reads `life/davies/profile.json` and writes names from it. Doing a text replace would
   leave the next family to do this all over again.
2. **Two people start with D.** Stream ids use the first letter of the first name: `PAY-J`, `PAY-M`, `TAX-J`, `SUPER-M`,
   `HELP-M` and so on, 53 lines in all. `-J` and `-M` cannot become `-D` and `-D`. Keep the ids as they are, or move to
   `-DN` and `-DS`. Recommendation: keep them. An id is not a name, and churn here reaches recipes and locked numbers.
3. **Party ids.** `JORDAN`, `MIA` and `AVA` appear in setup, ownership, decisions and truth. Rename them in the same pass, since
   the eval is being re-locked anyway. They appear in `standard/world`, in `coldstart.json` and in generated output only.
4. **Every hash moves.** A PDF that prints a name has a new hash, so `manifest.json`, `vault.json` and `standard/eval/locked.json`
   all change. Lock the new numbers in a commit that changes nothing else, with the before and after attached.
5. **File names carry names.** 515 world files, such as `Pawroll-Payslip-Jordan-2019-03-07.pdf`. A recipe that matches on a file
   name must be checked. The portals' `streams` labels ("Jordan's payslips") move to the profile.
6. **`Card Member` is a real column.** `JORDAN DAVIES` in the card export becomes `DANNY DAVIES`. Both `lib/shapes.js` and
   `standard/world/domains/banks.js` write it, and `period-close` tests carry it.
7. **Sign-in keeps both.** `portals/data/cast.json` accepts both sets of names today, so a blind run in progress does not lose its way.

## Leave alone

- `BLIND-n.md` and every journey written by a blind run. They are kept as written.
- The held-out households. They are other families.
- `CHANGELOG.md` history.

## Outside the repo

- The Davies demo sheet and the v2 sheet in Google, and the public Kitty artifact's sample.
- The portals on Vercel: redeploy after the vault is rebuilt.
- Any notes kept outside the repository that say Jordan and Mia.

## Order

1. PR 24 lands. Count again.
2. `standard/world` reads the profile. Party ids change with it.
3. Regenerate the world, `portals/data/months.json`, `sources/`, fixtures and snapshots.
4. Fix the hand-written tests. Re-lock the eval in its own commit.
5. Rename the sheets, then redeploy the portals, then drop the old names from `portals/data/cast.json` last.
