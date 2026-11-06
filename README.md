# The Kitty

![test](https://github.com/EthDawg/the-kitty/actions/workflows/test.yml/badge.svg)

A money page for one household, built the way a neobank would build it and kept the way a spreadsheet is kept. One Google
Sheet holds every number. One page reads it, says what needs a person, shows where the money went, tracks goals as money
("$11k of $12k"), installs on a phone and answers questions as a planner's note. An agent does the admin. No server, no
database, no telemetry, nothing to pay for.

| | |
|---|---|
| ![Home, light](docs/screenshots/pub-home-light.png) | ![Home, dark](docs/screenshots/pub-home-dark.png) |
| ![Insights](docs/screenshots/pub-insights-dark.png) | ![Setup](docs/screenshots/pub-setup-light.png) |

Three names, one project:

- **The Kitty** is the app: one page that runs in Claude or in an iPhone shell and reads a household's Google Sheet.
- **The Standard** is the data model underneath: an open schema for a household's whole financial life, with a benchmark that proves it.
- **The Davies** are the fictional family everything is built and tested on, so no real household's data is ever here.

## Try it

Open **[the Davies household](https://claude.ai/artifact/QH2gsDP8sHZmgMVKBtkwxn)**. It works on a phone, and you can add it to
your home screen. Everything you see is invented.

The family's bank, payroll and insurance files sit behind parody portals at
**[the-kitty-portals.vercel.app](https://the-kitty-portals.vercel.app)**. Sign in with any name and the password `demo`.

To run the page from a clone, with no connector and no account:

```bash
python3 build.py --v2
python3 -m http.server 8765 --directory dist   # then open http://localhost:8765/local-v2.html
```

## Start yours

**A blank start is coming, and it is not here yet.** A new household will begin empty, with no Davies data in it. Until then
the only path copies the Davies sheet. That is a stopgap: your copy carries the demo's formulas and has no way to take
updates. Use it to try the idea with your own numbers, knowing you may have to move later.

1. [Make a copy of the Davies sheet](https://docs.google.com/spreadsheets/d/16BNQv2jTt9G3Yfbkj1NwgaAxDjBibCth40wdNXWf3aA/copy). Clear `Entries` and `Payslips`, then fill the input tabs (Accounts, Categories, Goals, Settings). Leave `Transactions` and `Valuations` alone, whatever the page's Setup tab says: on this sheet they are formulas over `Entries`.
2. Add the Google Sheets connector in claude.ai, with the account that owns the copy.
3. Open the page, go to Setup, then Make it yours, and paste your sheet ID. It reads live from then on.
4. Export the last three months from each account (Setup, Getting your data in, or [the agent skill](skills/bank-export/SKILL.md)). Close the month as [`period-close/README.md`](period-close/README.md) describes.
5. For real money, build with `python3 build.py --no-snapshot` and publish it privately. That page is a pin: the same build, unedited, rebuilt to update.

Your data stays in your own Google account. See [`SECURITY.md`](SECURITY.md).

## Contribute

This project is built by agents, with people reviewing. Point yours at the repository and tell it to read
[`AGENTS.md`](AGENTS.md). If you are reading along, [`docs/START-HERE.md`](docs/START-HERE.md) takes ten minutes.

```bash
python3 check.py    # checks everything from a fresh clone, about two minutes, needs Python 3.9+ and Node 22
```

The most useful contribution is [a household shape the model gets wrong](https://github.com/EthDawg/the-kitty/issues/new?template=household-shape.yml).
[`CONTRIBUTING.md`](CONTRIBUTING.md) says what a pull request must carry.

## Where it stands

The published page is version 2.0, reading the fictional "Digital Davies v2" sheet, and its live reads and writes through
the Google Sheets connector have been exercised on that sheet. The Standard is real and tested, but a household cannot reach
it yet: the page shows it only on the Records tab, as a preview, and its engine has never run in a page. The iPhone app has
run on a real device and is not on the App Store. [`CHANGELOG.md`](CHANGELOG.md) has the history, and
[`standard/EXPERIMENTAL.md`](standard/EXPERIMENTAL.md) lists what is real but unfinished.

## Known limits

- English copy only. Currency and date order follow the Kitty tab's country, and nothing else is localised.
- The Standard covers Australia only. A second country is a reference file and a tax map.
- One sheet shape. A household with different tabs or columns needs the sheet template, not this page.
- Bank export paths for real banks come from product knowledge and are not yet verified on each bank's site. The skill stamps them as it verifies. The parody portals' paths are the first verified entries.
- The import pipeline is Python on a laptop.
- Tested with a 925-row sheet. Reads are chunked for larger ones but not yet exercised past a few thousand rows.
- Verified on Chrome, Safari on iOS and the Claude apps. Not tested on Firefox. The canvas is verified in Chromium only, and on phones by emulation.
- The numbers here are not tax advice, and a lodged return outranks any draft.

## Why this shape

The sheet owns the originals. The page is disposable. Writes are few, narrow and read back. Demo data is bundled because it
is fictional, and real data never is. Charts are hand-drawn SVG, with d3 for layout maths only. The decisions and their
reasons are in [`docs/decisions/`](docs/decisions/).

Released under the [MIT licence](LICENSE).
