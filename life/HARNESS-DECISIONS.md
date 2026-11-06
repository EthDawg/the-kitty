# Decisions: the chapter harness and the verbs

Taken on 7 November 2026 while building, without stopping to ask. Each is a default that can be changed. Where a test holds it, it says so.

## The law that bent

**A term keeps its `recorded_at` when it moves.** GOAL says adopted setup rows get `recorded_at` at transfer time. The engine orders a term against dated notices by that column, so a loan's opening rate re-stamped in 2038 would replace every rate notice since 2028, and the household would read the wrong rate on every date since. So `term` is the one exception: it keeps its own time and its note says it was adopted. Everything else follows the rule. `H-006` shows the wrong rate on the smallest case, and holds the fix: a known-order column that is not the record's date. Then the exception goes. The Davies' bundle hash does not catch this, because their interest comes from the lender's lines: a mutation audit re-stamped terms and the hash held. `src/household/life.test.js` holds the exception instead.

## Transfer

- **The transfer's record is a decision, not a new table.** Consent is a decision: who, when, in what words. One row in each store, `target_ref: transfer:<id>`. No new tab, nothing added to the schema.
- **A decision has no `note` and an alias has neither note nor a useful time.** A decision keeps its first `at`, `by` and home in `value.first_decided`. An alias's first `recorded_at` goes in the transfer row's `own_times`.
- **A statement belongs to the day its period starts.** Crossing on its last day it would state an opening over lines that did not cross, and two windows side by side would both drop it. Found when a statement over joining day reached neither store.
- **A file that straddles the date crosses as its lines, and its bytes stay home**, because those bytes hold the lines that did not cross. Its `uri` says `not-held`.
- **Evidence crosses by id.** The same bytes at the same place are one observation, even if two Kitties named the account differently. Found by a variant: a joint file with no number doubled its lines, and the audit caught it.
- **A moved store stops.** `state: moved`, it says where, and `add` refuses. It keeps every row. Homes counts only stores that have not stopped.
- **`handover` is a copy**, so each source it crosses is shared by name, and the first store carries on.
- **`share` is a fourth recipe.** One person sends a stretch of their own past into a Kitty they have already joined. It uses the map the merge left behind.

## Merge

- **The target is a new Kitty.** A sheet two people can open has no private rows, so Daisy's history cannot sit in the joint one and stay hers. Each solo Kitty stays where it is.
- **The default slice starts on the first of the joining month**, because a month is the unit a Kitty closes. `share` moves it, per person.
- **An account they bring opens with what it held the day before.** A position, not the lines behind it, carried in `opening_balance_cents`. `status` counts that as a stated balance. Plans have no balance to carry, so RSUs are `not_carried` until the history is shared.
- **Identity is a number of at least six digits.** The first Kitty's ids stand. The second's map onto them, or step aside with `-2`. A word, like Everyday, is not identity, and two accounts both called that stop the merge with a question, because lines say only that word and lines are not rewritten.
- **Joint shares are equal until someone says otherwise**, and that is a question.
- **Two people filing a rule or a line differently is a question with a default**, the first Kitty's answer. Two answers that agree become one row.
- **Locked months travel with a slice.** A month Daisy locked stays locked in the joint Kitty. Danny's lines landing in it change its seal, L12 says so, `next` says so, and the reopen proposal has the month and its spending. One yes reopens every month one transfer touched.
- **`dry_run` plays the whole merge on a scratch Folder in memory.** Nothing is written anywhere and the answer is exact.

## Chapters

- **The solo Kitties stop at chapter 3 and the joint Kitty carries on.** At chapter 4 the accountant asks for the whole year, so each shares their past, with their yes. Before that nothing crosses, and T3-PRIVATE-HISTORY is asserted before it happens. The simulation starts on 1 July 2026, so this shares everything: there is no older history to keep back.
- **A person's sittings are driven by `next`.** The harness does what it says until it says up to date, or asks what this person cannot do. Answers come from what a person knows, read from the world. Every answer goes through a verb and is counted.
- **A world id is translated once.** A blank Kitty makes its own ids from the first file, so the harness holds a map and tells setup through it. In chapter 2 setup is told after the file, which is the path a person takes.
- **Danny has his own id and his own name for the joint account**, so the identity map is exercised. The world's setup uses one id for it, which would have proved nothing.
- **What the world's setup says about shares is told in the joint Kitty.** A share is something two people agree.
- **A copy in Drive carries the day it was saved**, read from the original's delivery. Drive has a modified date, and with today's date a Drive copy hid the month it speaks for.
- **Salary packaging is answered SALARY-ALLOW.** Pay, on top of the payslip, and it will never have a payslip of its own. Answered SALARY, it holds every month provisional and nothing ever locks.
- **Answers about lines come from the book.** Lines with no category in the book are answered CC-PAY, TAX-REFUND or TRANSFER by what they say, because a person knows what those are.
- **Variants are `seed 2` and `seed 3`.** Every PR plays the Davies on both stores, which must agree, then one variant on each. `--all` puts every family on both, and that is the run behind the ratchet and the report. Four lives keep CI near a minute.

## Verdicts and the ratchet

- **Four verdicts.** `handled`: right, and whatever a person must be told is told, with no person's help. `flagged`: a person is told, and the number is right only after their answer, or is wrong and named. `silently_wrong`: wrong, or something they must be told is not, and nothing says so. `not_run`: the verb is not on this branch. The fourth is reported and never counts as handled.
- **A probe reads only the book of each chapter, the stores and truth.** It can't see what the harness meant to do.
- **`life/expected.json` is a ratchet.** A trap can get better on its own. It cannot get worse, and a truth figure off, a law failing or a word missing that is not in the ratchet fails `--check`. Writing a worse number into it is a diff someone has to read, and `--accept` needs `--all`.
- **A silently wrong trap fails `--check` unless a friction row holds it.** Fourteen are recorded, and they stay on the report until they land.
- **Trap T4-ACCOUNTANT-ZIP is `not_run`.** `pack` is on `life/pack`, PR 28.
- **Traps are judged at the chapter their evidence reaches.** The couple's transfer is on 5 March, in files that arrive in April, so T3-COUPLE-TRANSFER is judged at chapter 4 and listed under 3.
- **The harness was audited by breaking it on purpose.** Fourteen mutations, each removing one safety: the rebind, the slice's date, the fence on a release, a spawn's closing entries and so on. Each turns the verb tests or `--check` red. Two are caught only by the verb tests, because the harness always supplies them: consent, and the term exception.
- **Tax labels are compared for years that ended 90 days before the chapter.** Label D10 is the agent's fee and label 12 the plan's statement, so neither is a figure this household derives. Labels 18A and 18H are in the ratchet under F-005.

## What `next` learned

`next` is still one ordered list. Steps moved, and all of them are in `src/household/next.js`.

- **Waiting comes after questions.** A transfer, a payslip, a tax result or a bill waiting on its other side usually arrives with the next file, so it no longer stands in front of one. Past 45 days it is asked, as `other_side`.
- **A check nobody can answer does not block.** A fund's file that stops before the deadline, and a lodged year from before the first file, step aside. `status` still counts them as failing.
- **A file with no account number gets asked which account**, not told it failed.
- **`decide` learned `hold` and `seen`.** `hold` keeps a file as evidence by its hash and stops asking. `seen` is for a review item nobody here can answer. Both need a reason.
- **`close` takes a list**, with one managed write.

## Pocket money

- **Rungs used: `x_term`, `x_table`, `saved_question`, `widget`.** A running balance needs rows, and nothing here has a file, so a term alone cannot hold it. The table is the last resort, and it is the lowest rung that works.
- **A memo account takes no postings at all.** The ledger never reads an `x_` table, so the memo cannot reach net worth or income. The bundle hash before and after is asserted equal.
- **`x_` tables are declared in the store's manifest**, and a Google store keeps them in About. Hand it to a new process and it still knows them.
- **Numbers the script does not give are the family's and invented:** jars 50, 30 and 20, 6% a year on the save jar paid at month end, George's $3 a week. Salt's $5 and the $2 chore every second week come from `life.json`.
- **The book starts on the first Saturday after she says the sentence.** Truth says nil on chapter day, and says the first Saturday falls after it, while two Saturdays passed after the 20th in the script. Starting from her sentence ties to nil and is what happens at a kitchen table. S026.
- **Bands from research: jars at 5, an account of their own at 14, a Kitty at 18.** Age is worked out from `birth_date`. Evie is 2, so she has none yet.
- **The release carries a real rule so the diff has something to show:** a phone plan reads as a utility, with a priority, so it beats a household's rule and loses to a person's decision. It names a merchant every family has, because a release tuned to the Davies moved nothing for a variant, and the check said so. It starts at the first open month. What it would have done to each locked month is a proposal.
- **A shared extension's table is a new table.** The family's `x_pocket` stays as it was, and `x_jars` gets its rows through a declared column map. A map that loses a cent is refused before anything is written.
- **`spawn` copies the whole history and closes the rest with one entry per jar.** So the book that stays adds to nil, and nothing is counted in two households.

## Not proved

- **The real connector.** `x_` tables add a tab through the same `update_spreadsheet` the Fake models. That is a model of Google, not Google.
- **A blind run.** This is level one. Nobody has played these verbs as a person.
- **`pack` with a merged Kitty.** They live on different branches.
- **Chapter 3 is one couple joining once.** Two people with a parent's Kitty, or a third store, are not tried.
- **Reading a store that moved in a later session.** The moved state is on the manifest, and only one process has read it.
