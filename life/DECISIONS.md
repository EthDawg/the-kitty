# Decisions, life/world

Defaults taken while building the generator, for Ethan to confirm. Each is reversible. Written 7 November 2026.

## Who the family is

- **D1. The brief's family table is canon.** Danny 1993, Daisy 1995, Salt 2028, George 2030, Evie 2033. Days of birth, employers and pay are invented and live in `life/davies/life.json`.
- **D2. `life/davies/profile.json` belongs to `life/estate` and agrees with this script.** It was not on origin when the generator began, so the brief's table stood. Profile 2, now on `origin/life/estate`, was rewritten to follow this script: birth dates, employers, addresses, pay, HELP, the package and the practice all match. `life.json` stays the script, because the generator plays it, and the profile stays the biography. Change the two together. A test reads the profile once the branches meet and fails if the cast drifts.
- **D3. Roles, not names, run the script.** A is who starts, B who joins, C1 to C3 the children. Stream and account ids use roles, so a variant plays the same plot and a stream name gives nothing away.
- **D4. Daisy keeps her physio job and Danny his adviser's path.** Employers reuse the world's parody names: Bayview Health, Northwind Logistics, parent Northwind Global Inc, code NWGL.

## The world

- **D5. The story starts 1 July 2026,** so FY2027 is whole and the first joint tax time has a full year. FY2026 sits before the simulation: its assessments are stated, not simulated, because chapter 4 needs a prior year to amend.
- **D6. One bank, one export format.** Whoever downloads it, including the home loan and the later business account at the same bank. A variant that changes a bank's layout changes it for every account there.
- **D7. Chapter 0's bank has no public recipe, on purpose.** PING's 2026 export, `Date,Details,Money In,Money Out,Balance`, is read by no public recipe, because the chapter proves that her agent writes the first one through the gate. It is the only deliberate mismatch in the Davies' life. Every other file uses a shape public recipes read. The recipe an agent would write sits in `out/<family>/answers/recipes/`, which a blind actor must not read. The soundness run uses it, and says how much the public recipes read alone.
- **D8. Files live in one store and the script says who holds them.** `sources/` is every file that exists. `held_from_chapter` is the chapter a household first has it. `delivered_on` is when it exists anywhere. A file with a null chapter exists and was never fetched.
- **D9. Chapter 1's dropped file is three months in one file, and chapter 2 overlaps it by two weeks,** because that is what a person does.
- **D10. The joint account's two downloads are real downloads.** Daisy takes calendar months on the 3rd, Danny takes a ninety-day window every seven weeks, and one early window is byte-identical between them.
- **D11. A HELP page opens with `Balance brought forward`.** The first draft opened on an indexation row and the engine counted it twice. A government page shows a brought-forward row, so the generator moved and the defect is `F-004`.
- **D12. A person's rate is told on the day it starts.** Chapter 5 spans years, and a row recorded at the chapter's end beat every notice. See `F-007`, which is why this is a decision for the runtime's `init`, not just the world.

## Law and money

- **D13. Law comes from `standard/reference`, read by date through `lib/law.js`.** Past 30 June 2027 the last known row is used and truth lists it in `assumed_law`. An assessment past coverage carries `assumed: true`.
- **D14. What the reference does not hold is stated, and is not law.** Land transfer duty, the paid parental leave amount, the premium, the rent, the salary and every price are invented in `life.json` or the simulator. The 15% contributions tax and the fringe benefits gross-up on the income statement have no series in the reference, so they are written where they are used. The withholding is a stand-in for the ATO's schedules: the annual scale divided by 26.
- **D15. The cash rate past the reference is the story's.** A seeded path, not a forecast.
- **D16. The two-regime CGT numbers are marked unconfirmed everywhere.** The disposal uses the discount on the gain to 30 June 2027 and leaves indexation at nil, because the factor is not in the reference. A later read of Act 49 of 2026 may move this.
- **D17. The rebate reset uses the last real one.** No reset after 1 April 2026 is known, so `T4-PHI-1-APRIL` falls in FY2026 with verified rates. Later years keep that rate, marked assumed, while the premium still rises each April.
- **D18. Nothing goes in `src/`, `standard/` or `portals/`.** `tools/check_shape.py` gained `life` in its allowlist, because `GOAL.md` agrees the folder. The line matches the one on `life/estate`, so the two merge cleanly.

## What is simplified

| Where | What |
|---|---|
| Chapters 0 to 6 | Danny holds no credit card. One car, never replaced. Loans are always at Westpaw. No Family Tax Benefit. Merchants are invented. Everyday lines post the day they happen. Tax has labels 1, 10, 12, 18A, D5, D10 only. |
| Chapter 7 | The practice account and quarterly BAS only. No invoices, no sole-trader tax. Her other streams stop at chapter 6. |
| Chapter 8 | No files: a move creates no evidence. |
| Chapter 9 | Salt's account and weekly payslips only. Super is computed and in truth, with no fund file. |
| Chapters 10 to 12 | Listed in `life.json`, not generated. A branch needs chapter 7 onward at full depth, and the third held-out family already covers retirees. Saying so is more honest than thin streams. |

## Output layout

`node life/world/build.js [--seed N] [--variant] [--family NAME]` writes `life/world/out/<family>/`, gitignored.

| Path | Holds | Who may read it |
|---|---|---|
| `sources/<stream>/<delivered_on>/<name>` | Every file that exists. `standard/intake`'s `walkRoot` reads this folder as it is. | Portals, by `visible_to` and `delivered_on` |
| `manifest.json` | `files[]` with the vault's fields (`brand stream year date name size type path sha256`), plus `person visible_to delivered_on held_from_chapter where origin issued_on family container account window`. `streams[]` as the vault has them, plus `visible_to`. `chapters[]`. `path` is relative to the family folder. | Harness, portals |
| `drive/<person or shared>/...` | The family's Drive, as a Folder store. Copies, duplicates, a misfiled statement, scans, a screenshot. | Harness, a blind actor as themselves |
| `inbox/<person>/<date>-<name>.eml` | What only ever came by email. | Harness, a blind actor as themselves |
| `mess.json` | Per chapter: `drive inbox portal_only nowhere`. | Harness |
| `setup/<table>.json` | What each person tells a Kitty. Every row has `recorded_at`, so `setupAt(setup, today)` gives a chapter's view. | Harness, scripted runs |
| `truth.json` | `accounts[id].months`, `income`, `spending`, `economic`, `net_worth`, `tax`, `health`, `cgt`, `help`, `loan`, `child_interest`, `memo`, `assumed_law`, `chapters[n]`, `traps[id]`, `mess`. | Scorers only |
| `answers/recipes/*.json` | The recipes for layouts no public recipe reads. | Scorers only |

A blind actor must never read `truth.json`, `answers/`, `setup/` or anything under `life/`.

A chapter's household is `files.filter(f => f.held_from_chapter != null && f.held_from_chapter <= n)`. A simplified chapter holds only its own streams: `f.held_from_chapter === n`.
