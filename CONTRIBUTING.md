# Contributing

This project is written by agents and reviewed by people. A person can contribute the same way, to the same bar. Read
[`AGENTS.md`](AGENTS.md) first. This page covers what that one leaves out.

## What a pull request must carry

The [template](.github/pull_request_template.md) asks for all of it.

1. **The result of `python3 check.py`.** Paste the final block. Name anything skipped.
2. **The failing case.** Which test failed before the change and passes after it. For copy or docs, say so instead.
3. **What moved.** Any number, and why. A move in `standard/eval/locked.json` needs its reason in the same commit.
4. **What was proved and what was not.** Fixture, simulator, device or live are four different claims. Say which one you are making.
5. **Who wrote it.** Name the agent and model, and anything it had to guess.

Keep a pull request to one change. Agents write large diffs cheaply, and people review them expensively.

## The failing-case rule

A change to the Standard is accepted when it brings a case that fails before and passes after: a household fixture, a rung on the
ladder, or a line in the Davies world. [`standard/GOVERNANCE.md`](standard/GOVERNANCE.md) owns that rule and the rules for what may
change. The app works the same way: add the test to `test.js` or `test-v2.js`, and see it fail first.

## From a shape to a fixture

A shape is a kind of household life: a retiree with no wage, a separation, a mid-life start. The most useful contribution is one the
model gets wrong.

1. **Write it in words,** with invented people. An [issue](https://github.com/EthDawg/the-kitty/issues/new?template=household-shape.yml) is a good place. Say what should be true.
2. **Add a test** to `standard/eval/households/test.js`. `household()` in `kit.js` writes a small life as observations, and the test states the truth beside it. The first test in that file is the simplest example. Use whole cents, and invent the merchants.
3. **Watch it fail:** `node --test --test-name-pattern="your test name" standard/eval/households/test.js`.
4. **Decide where it lands,** using the next section.
5. **Make it pass** and run `python3 check.py standard`. If a locked number moves, explain it.

A problem with files and formats belongs on the ladder in `standard/eval/ladder.js` instead. A shape worth a place in the long history
is a line in the Davies world.

## Blind runs

A fixture proves a repair. It cannot prove the model is honest about a family it has not met, so we run blind.

A blind run is a worker that cannot read the engine. It simulates a new family with its own traps, and it runs once against public
recipes and that family's onboarding answers. The results live in `standard/eval/heldout*/`:

- `BLIND-n.md` is the first run, and it is kept as written. Never edit it, and never regenerate it after a repair.
- `RESULT.md` is the same family after repairs, and it says at the top that it is not blind.
- Every defect becomes a household fixture and a repair. Then a new family tests whether the repairs generalise.

A score after repair proves only the repair. A blind actor never reads the code it is testing, signs in as a real person or clicks a
consent dialog.

## Keeping fictional data fictional

- Nothing real goes in, including a real family's shape copied closely enough to recognise. Change the people, the places, the amounts and the order of events until only the shape is left.
- Invent names. Institutions are parodies, like Westpaw and Amewx, with original wordmarks. The real thing's column shape is fine, and its branding is not.
- Addresses use the reserved `.example` domain. Google links go only to the fictional sheets in `kitty.config.json`.
- Screenshots come from the Davies, and issue reports use them too.
- Git keeps an address on every commit, and a public repository publishes it. Commit with your GitHub no-reply address.
- `python3 check.py public` catches private paths, addresses and document links. It cannot prove anything is fictional, so that stays your job.
- Maintainers keep a private list of real names outside the repository and point `KITTY_PRIVATE_TERMS` at it before a push.

## A gap in the base, or a gap in tailoring

Every case lands in one of four places: the base holds it, one small base change holds it, tailoring holds it, or we honestly decline it.

Something goes in the base only if it cannot be recreated later, or getting it wrong moves money or double counts, or two surfaces
must agree on it. [`standard/GOVERNANCE.md`](standard/GOVERNANCE.md) says that in full. Everything else is tailoring, at the lowest
rung that works: a tag, a rule, a saved question, a widget, then `x_` material ([`SPEC` section 12](standard/SPEC.md#12-extensions-and-tailoring)).

`node standard/tools/conform.js --bundle <dir>` answers the question for a real bundle. A divergence is that household's to fix. An
extension several households need is a gap in the base, and it comes here as a fictional twin. Declining is a real answer: held as
evidence, shown as not modelled, and never calculated badly.

## Working on the page

- A new number goes in its owning tab or in `src/engine.js`. Do not work it out in `src/app.js`.
- The page stays one file. No build step beyond `build.py`, and no framework. Libraries are vendored in `src/vendor/` at exact versions.
- Copy is short, with no jargon. Money is stated as money ("$11k of $12k"), and estimates are labelled.
- Bank paths in `src/data-sources.json` carry `documented` and `verified` dates. If you confirm a path on a bank's own site, stamp `verified`. If you add one from memory, leave it `null`.
