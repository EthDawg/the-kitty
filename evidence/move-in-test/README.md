# Move-in test

Question: when a household's money is spread across a Drive, an inbox and phone notes, can a model in a harness pull it together, and does it say what's missing? Is the hard part reasoning, or reach?

Everything here is fictional: Sam and Ria Calder, FY26 (1 July 2025 to 30 June 2026), parody banks, a broker, an exchange and a charity.

## Set-up

`python3 gen.py OUT` writes `OUT/estate/` (36 files) and `OUT/sealed.json` (the answer key):

- Drive: a joint bank CSV, a saver as OFX, 11 monthly card statements (February is missing), both income statements, two dividend statements (September's is missing; the payment shows in the bank file), last year's return summary, two copies of a budget that disagree, a tax working sheet that says "no capital gains", and a slide deck from January that is out of date.
- Email: 13 messages that matter (a crypto sale, a share sale, the 2019 share purchase, a donation receipt, raffle tickets that are not a donation, a health insurance statement, a "February statement is ready" notice, an employer note about logging work-from-home days) and some noise.
- Phone notes.

The key holds 18 figures, 4 planted gaps (the crypto purchase record, the September dividend statement, the work-from-home log, the February card statement), 6 items found only in odd places, 4 conflicts and 3 traps.

`python3 gen_reach.py OUT` makes the reach variant: the same files with email removed, four stray copies added to Drive, and `mail.py`, which can only search and read a 413-message mailbox held outside the run folder and logs every query.

Arms given `../../skills/kitty/coverage.md` are marked "+ checklist". The household's message, word for word: "We've done our money in bits and pieces for years and want to move into the Kitty (KITTY-README.md describes it). Everything we have is in estate/: a dump of our Drive, our email and my phone notes. Get our FY26 tax returns ready (Sam and Ria) and tell us what's missing before we can lodge." Each run wrote `fy26.json` and `move-in.md`. One shot, nobody to ask, no web, nothing outside its folder.

`python3 score.py DIR` scores every run: figures to the dollar (an equivalent cost-base treatment counts), gaps and conflicts by keyword rules, which were then read by eye.

Runs were Claude Code subagents with a model override, one run per cell, on 8 November 2026. Costs are API list prices from each run's own token counts (`costs.json`).

## Results

Everything in one folder:

| Run | Gaps of 4 | Figures of 9 | Cost |
|---|---|---|---|
| Haiku 5.5 | 4 | 9 | $0.13 |
| Haiku 5.5 + checklist | 4 | 9 | $0.14 |
| Sonnet 5.5 | 4 | 9 | $0.45 |
| Sonnet 5.5 + checklist | 4 | 9 | $0.46 |
| Opus 5.5 | 4 | 9 | $1.37 |

Email only through search:

| Run | Gaps of 4 | Figures of 9 | Searches | Cost |
|---|---|---|---|---|
| Haiku 5.5 | 3, missed the February card statement | 9 | 53 | $0.14 |
| Haiku 5.5 + checklist | 4 | 9 | 77 | $0.19 |
| Sonnet 5.5 | 3, missed the February card statement | 9 | 44 | $0.33 |
| Sonnet 5.5 + checklist | 4 | 9 | 29 | $0.36 |
| Opus 5.5 | 4, after opening all 413 emails | 9 | 61 | $1.74 |

The checklist line that made the difference: "Every account's statements run unbroken."

## Eight asks in one message

The same estate, one message from Sam with eight questions (saver balance at 30 June, December card spending, whether the raffle is a donation, where Ria's receipt is, which budget file is current, the shares' original cost, fix the capital gains line, how many pays), two of them leading ("I said probably", "I feel like it was 27"). Sent as a rambling voice note, as a numbered list, and as the voice note after the run first read 38,000 tokens of unrelated skills. Each wrote `reply.md` and `tax-working-fixed.csv`.

| Run | Answered of 8 | Cost |
|---|---|---|
| Haiku, rambling | 8 | $0.11 |
| Haiku, list | 8 | $0.09 |
| Sonnet, rambling | 8 | $0.25 |
| Sonnet, list | 8 | $0.26 |
| Sonnet, rambling, skills loaded | 7, would not say which budget file is current | $0.62 |

The Sonnet list run saved its reply inside `estate/` rather than the run folder; its answers were all right.

## What it means

Reasoning was not the gap. With everything in one place, the smallest model found every gap. Behind a search box, the runs that missed something were the ones without a checklist telling them where to look. How a person asks barely mattered; a heavily loaded setup cost more and blurred one answer. One run per cell: treat a single miss as a signal, not a rate.
