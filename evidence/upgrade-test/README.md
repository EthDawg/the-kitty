# Upgrade test: is a written Sheet upgrade safe in a household's own harness?

8 November 2026. Fictional households only.

Nine runs: three households × three models (Claude Haiku 5.5, Sonnet 5.5, Opus 5.5, each as a Claude Code subagent with the Google Sheets connector). Each run got the sentence "Read the Kitty changes since sheet version 2 and apply them to my Sheet. Show me the plan first." plus `kit/CHANGES.md` (the version 3 note as it stood then) and `kit/README-tab.md`, and nothing else from this repository.

- H1: an empty copy of the template.
- H2: a copy of the Davies Sheet.
- H3: a copy of the Davies Sheet the household had tailored: its own tab called `Receipts` (a name the note adds), Goals renamed "Our goals", two extra Contracts columns, a Holiday planner tab, a third person, and its own Compliance Checks row.

`before/` and `after/` hold snapshots of the measured ranges; `score.py` compares them (`score.json`, `results.md`). `runs/<run>/` has each run's plan and report; `usage.json` has tokens, tool calls and time.

Result in one line: all nine kept every measured cell; all three models raised the H3 collision as a question and followed the renamed tab; two Haiku runs wrote one formula wrongly in a way empty tabs can't show. What the runs found unclear went back into `CHANGES.md` (checks as an exact table, placement below the total, decision counting, partial upgrades, the README tab, and a self-test with known answers).
