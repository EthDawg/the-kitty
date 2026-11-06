# How this changes

The schema is a public API. Households depend on it, so the rules below are the same rules any API keeps.

## What can change, and how

| Change | Rule |
|---|---|
| A new column, table, term, observation kind, event kind or metric | Additive. Goes on the right. Readers ignore what they do not know. Minor version. |
| A new law | Starts at `hold` for one release, so an update cannot turn a working page red. |
| A changed meaning | Never. Deprecate the old name and add a new one. |
| Removing or renaming anything | Major version, a pure migration over Originals, and a run on every test household. |
| A change to a locked number | Never silently. It raises a reopen proposal with the amount. |

## Every proposal carries a failing case

A change to the standard is accepted when it comes with one of these, failing before and passing after:

- a fixture under `eval/households/`, a small life written as observations with its truth stated beside it;
- a rung on the ladder under `eval/`, for something about files and formats;
- a line in the Davies world, when the shape deserves a place in the long history.

A real household's problem reaches the base as a fictional twin. Only shapes flow back up, never data. If a case can be held
by tailoring (`x_`, a rule, a saved question), it stays tailoring until several households need it.

## What belongs in the base

Something goes in the base only if one of these is true:

1. **It cannot be recreated later.** Original bytes, a person's decision, who owned what when, what we knew when.
2. **Getting it wrong moves money or double counts.** That makes it a law.
3. **Two surfaces must agree on it.** That makes it a named metric.

Everything else is tailoring, at the lowest rung that works. Interpretation moves out to the fringe as models improve and
stays re-runnable. Evidence and judgement never move.

## Every number is locked

`eval/locked.json` holds the Davies household's figures to the cent. A change that moves one must say why in the same commit.
An unexplained move fails CI. Replay runs are appended to `eval/history.jsonl`, so accuracy, review load, tokens and time
are a trend, not an impression.

## Stable and experimental

Every metric and every surface is one or the other, and the page says which. Experimental means real but unfinished: it
has a strong baseline, and an open question listed in [`EXPERIMENTAL.md`](EXPERIMENTAL.md). Nothing is half-built and
presented as finished. Something moves to stable when it has a locked number or an eval that would catch it breaking.

## Generated files

`generated/` comes from `schema/`. Never edit it. `node standard/tools/generate.js --check` fails CI if it is stale, and the
same tool proves every event template balances.
