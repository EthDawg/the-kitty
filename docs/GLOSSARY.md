# Glossary

One line each. The full meaning of a Standard term is in [`standard/SPEC.md`](../standard/SPEC.md).

## The names

| Word | Means |
|---|---|
| **The Kitty** | The app: one page, two hosts. Also the project |
| **The Standard** | The data model in `standard/`. "The Digital Davies Standard" in full |
| **The Davies** | The fictional family. See [the family](START-HERE.md#the-family) for names, including those the data still uses |
| **Digital Davies** | The Davies as data: the sheet, the world and the benchmark |
| **Household** | One set of people and their money. In the repository, always fictional |
| **Base** | What every household shares: app, shared data and the Standard. The opposite of tailoring |

## The app

| Word | Means |
|---|---|
| **Host** | What runs the page: the Claude artifact, or the iPhone shell. Each supplies the same five objects (`mcp`, `sample`, `db`, `user`, `downloads`) |
| **Artifact** | A page published on claude.ai. The public demo is one |
| **Connector** | Claude's link to a person's Google Sheets. The page reads and writes through it, with their consent |
| **Sheet** | A household's Google Sheet. It holds every number and owns every original |
| **v1, v2 sheet** | `sheet_version` 1 is the frozen 1.1 demo sheet. `sheet_version` 2 is the ledger the page reads today. The Standard's tabs will be version 3 |
| **Snapshot** | The fictional sheet saved as JSON in `data/`, bundled so the demo opens with no connector |
| **Pin** | A privately published page: the same build, unedited, rebuilt to update. Not a fork |
| **Close** | The month-end routine: bring in the files, settle the review, write, verify |
| **Review queue** | The rows that need a person, on Activity and Home |
| **Fortune cookie** | The Review button that asks Claude to propose a rule |
| **Worth it** | A one-tap question about a recent spend, kept as a decision |
| **Signal** | A fact about a household that switches a Home widget on |
| **Trust drawer** | Where the page shows its derivations checked against the sheet |
| **Portal** | A parody bank or agency site holding the Davies' files, on Vercel |
| **Vault** | The portals' copy of the Standard's world files, generated, not committed |
| **Gmeow, Litterbox** | The portals' stand-ins for the household's email inbox and shared folder |

## The Standard

| Word | Means |
|---|---|
| **Original** | Evidence (what sources said), Judgement (what a person decided) or Setup (who and what exists). Never derived |
| **Derived** | Everything else. Can be deleted and rebuilt at any time |
| **Bundle** | A household's portable form: one file per table plus a manifest |
| **Observation** | One thing a file said, with a locator and a hash |
| **Witness** | A document that shows a fact. One fact can have several |
| **Recognise once** | One witness counts a fact and every other witness clears against it, so nothing doubles |
| **Event, posting** | What happened, and its balanced ledger lines |
| **Clearing account** | Where the two sides of a fact meet. It must return to zero |
| **Law** | A named check that the numbers can all be true at once. Twenty so far |
| **Recipe** | JSON that reads one family of files into observations. No code |
| **Container** | A file format: CSV, PDF, OFX and so on. Code, and a small closed set |
| **Fingerprint** | A file's structure, ignoring values. How a recipe finds its files |
| **Gate** | What judges a recipe, by whether money is conserved |
| **Bitemporal** | Holding when a thing was true and when it was known, as separate dates |
| **Scope** | What a household has said about a domain: `none`, `has`, `partial` or `unknown`. Zero and not asked are different facts |
| **Tailoring** | What one household adds for itself, at the lowest rung that works |
| **`x_`** | The prefix for a household's own field, table or kind. An update never touches it |
| **Pack** | A handover of lines, evidence and gaps, for an accountant, say. Experimental |

## Testing

| Word | Means |
|---|---|
| **World** | The Davies' eight-year life, simulated first and then rendered as each institution would deliver it |
| **Truth** | What the world says really happened. The benchmark scores against it |
| **Replay** | Blow everything derived away, rebuild from files, and score to the cent |
| **Ladder** | Mangle the files. Presentation rungs must not change the answer, and semantic rungs must ring the right law |
| **Locked number** | A Davies figure held to the cent in `standard/eval/locked.json`. Moving one needs a reason in the same commit |
| **Household fixture** | A small life written as observations, with its truth beside it, in `standard/eval/households/test.js` |
| **App fixture** | A frozen cut of the sheet in `fixtures/`, for the page's tests. Not a household fixture |
| **Importer fixture** | Sample PDFs in `period-close/fixtures/` |
| **Blind run** | A worker that cannot read the engine invents a household with its own traps and runs it once. Also called held-out |
| **Trap** | A hard case planted in a blind household, scored handled, flagged or silently wrong |
| **Silently wrong** | A wrong number with no alarm. The worst result |
| **Failing case** | A test that fails before a change and passes after it. Every proposal to the Standard brings one |
| **Scoreboard** | `standard/eval/SCOREBOARD.md`, the current numbers, generated |
| **Experimental** | Real but unfinished, and labelled so on the page. See `standard/EXPERIMENTAL.md` |
