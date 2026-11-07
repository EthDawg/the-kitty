# The data model test

Written 7 November 2026 before any run. Rules below do not change after results. One pass, no repairs, no reruns.

## The question

Ethan's live Kitty already works, so this does not re-prove that a model can read bank files.
It answers one thing: **is the value an established data model that someone onboards into, or does a frontier model do just as well starting from nothing?** Both at the first import and at every import after it.

## The two arms

Same model (Opus 5.5), same family, same files, same definitions, same tools. Only the starting Sheet differs.

- **A, nothing established.** A blank Google Sheet. "Set it up, load it all, build us a dashboard." This is the sprawl case. It gets the definitions file, which favours it.
- **B, established model.** The existing public Sheet (Digital Davies v2), emptied, as it stands. Changes made to empty it are listed in TEMPLATE.md. No new design, no engine, no skill file.

Two runs of each arm: A1, A2, B1, B2.

## The family and the stages

Family six (Mulcahy-Bonetti, fictional): 379 files, 36 months, sealed truth. Same family as Fig. 1 of the briefing.
Files are delivered in arrival order:

- Stage 1: arrived by 15 Jul 2025, 258 files, 24 months. First import.
- Stage 2: to 15 Jan 2026, 60 files, plus one re-delivered file. Fresh agent, no memory.
- Stage 3: to the end, 61 files, plus one re-delivered file. Fresh agent, no memory.
- Reader: a fresh agent with the Sheet only, no files. Same prompt for both arms. Writes result.json and answers.json.

Re-delivered files: stage 2 gets the joint account's Apr to Jun 2025 export again under a "(1)" name. Stage 3 gets the card's Oct to Dec 2025 export again the same way. Both are byte-identical. A good system adds 0 rows.

## Measures, fixed now

1. First import: reader's totals against truth for months 1 to 24, and stage 1 cost.
2. Next imports: reader's totals against truth for months 25 to 36, and stage 2 and 3 cost.
3. Dedupe: rows added by the two re-delivered files.
4. Reader: balances right of 468, mean monthly error, and the question battery (nine questions, one is trace-to-source).
5. Sprawl: tab and header overlap between the two runs of an arm, and schema change inside a run across stages.

Dollars and months are both reported. Cost uses API list prices from the run transcripts.

## What each result means

- **Yes, the value is the established model:** B beats A on at least two of next-import cost, dedupe and reader battery, and A's two runs share under half their schema, and B's first import totals are no more than 1% worse than A's.
- **No:** A equals or beats B on next-import cost, dedupe and reader battery.
- **Partly:** anything else, naming which measures moved.

A failure caused by the existing Sheet's own shape counts against B. It is not repaired and rerun.

## Limits, stated before the run

One fictional family, two runs an arm, Claude only. Codex is not in this test. This answers the question as framed. It does not re-test Ethan's live system.
