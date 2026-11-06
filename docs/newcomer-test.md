# The newcomer test

Can a stranger's agent pick this repository up cold? We test it the way it will be used: a fresh agent gets only a clone and a small
real task, and it reports everything it had to guess. It sees no brief and no conversation. Each guess is a gap in the docs, so each gets
fixed, and then a new agent tries again, because a fix to the docs proves only the fix.

Rerun this whenever the first pages change. Keep the results as written.

## Round 1, 7 November 2026

Two agents (Claude Sonnet 5.5), one clone each. Both finished, and both ran `python3 check.py` to PASS, with `portals` skipped as the
docs predict.

| Task | Reads to the right place | What it did |
|---|---|---|
| Add a merchant, with its test | 3 files | Added `bakers-delight` and a test, after watching it fail |
| Add a share house as a household fixture | 6 files | Added two fixtures, and they failed. It found a real gap in the model |

**What they had to guess, and what changed.**

| Guess | Fix |
|---|---|
| Where a merchant's test goes, and whether one is wanted. `merchants/README.md` never said | It says so now, with the commands |
| Whether a real brand and suburb may appear in a test, given "fiction only" | The dictionary is named as the one exception |
| How to choose a hue with no way to confirm it | Pick a close one and say so in the pull request |
| Whether `python3 check.py app standard` was enough to stop | `START-HERE` separates the quick loop from the final run |
| Branch names, commit titles, whether a changelog line is wanted | `CONTRIBUTING` says |
| What else to commit after a repair: scoreboard, history, locked numbers | `CONTRIBUTING` step 6, and a new table in `MAP`: what writes what |
| How to add someone outside the household to a fixture | `CONTRIBUTING` step 2 |
| That `kit.js` lists every category, and a missing one fails quietly. This produced a false pass in a first draft | `CONTRIBUTING` step 2 |
| What to do if you cannot repair a failing fixture | Open an issue. Do not merge a failing test |
| Which identity to commit with, with no GitHub account | A no-reply address, never a machine's default |

**What was wrong.** `CONTRIBUTING` said "the next section" and pointed at the wrong one. `merchants/README.md` named a branch that is
long merged, and called `website` a plain domain when some entries have paths. "About two minutes" was closer to two and a half. All
are fixed. One report was itself wrong: the agent said `portals/data/months.json` has no `transactions` array, and it does. A report is
not proof.

**What the fixture agent found.** One leaseholder, two flatmates paying their shares. With rules and a split on every rent line the
headline numbers are right, but each flatmate's receivable is wrong and no law rings. With no split, cash net and net worth disagree
silently. That is a gap in the base, and it goes to the Standard as a failing case under [`GOVERNANCE.md`](../standard/GOVERNANCE.md).

**What worked.** The task table in `START-HERE`. `MAP` stopped a wrong turn into `fixtures/`. A single command with a plain result, and a
standard area quick enough to loop on. "A score after repair proves only the repair" made the agent state its limits.
