# The harness is the importer: notes for agents

Plain-text companion to the field note "The Harness Is the Importer" (The Kitty, November 2026).
Same facts, no layout. Everything below is about fictional households; no real person's money appears.

## The claim

A frontier model in a coding harness (Claude Code, Codex) reads a household's bank files better than an importer written for them. So a household money system should ship no importer. Ship four things:

1. One Google Sheet with a fixed shape (the Kitty template, 26 tabs).
2. Checks that prove a load (formulas on the Compliance Checks tab).
3. A page that reads the Sheet (the Kitty artifact).
4. A small skill that says where files are, which write call is safe, and when to stop.

The harness and model do everything in between: finding files, reading CSV/OFX/QIF/PDF, reconciling, categorising, writing.

## Evidence 1: one-shots on family six

Family six: fictional, 379 files in seven formats, 36 months (July 2023 to June 2026), 13 accounts, sealed truth. Traps include a mother's care money, her death and estate, a $168,000 granny-flat payment, overlapping exports, a pending card pre-authorisation, a saver export that belongs to someone else, and a $1,347.37 hole where one bank's export stops on 10 March 2025.

Each run: one shot, own folder, the files, the family's setup answers and a five-line definitions file. No repo, no skills, no repairs. Scored against sealed truth.

| Run | Balances right of 468 | 3-year income vs truth | 3-year spending vs truth | Mean monthly spending miss | Time | Cost (API list) |
|---|---|---|---|---|---|---|
| Engine alone (no model) | 389 | -35.2% | +54.2% | $8,630 | seconds | $0 |
| Haiku 5.5 | 385 | +8.17% | +3.77% | $431 | 11 min | $1.09 |
| Sonnet 5.5 | 438 | +1.78% | 0.00% | $84 | 11 min | $3.34 |
| Opus 5.5 | 468 | +0.03% | -0.02% | $136 | 15 min | $4.58 |
| Fable 5.1 | 468 | +26.2% | +44.4% | $4,919 | 12 min | $6.00 |
| Engine + Opus | 467 | +1.78% | 0.00% (36/36 months exact) | $0 | 30 min | $9.04 |

Truth: income $642,384.67, spending $378,481.57 over 36 months.

What it means:
- Reading is solved. Every model wrote throwaway Python, read the PDFs, chained every stated balance and found the same traps unprompted.
- Misses are meaning calls, and they come in lumps. Fable booked the $168,000 as income and spending (flagged in its notes); without that one call its totals equal Opus's to the cent. Sonnet's income gap is one $11,224.30 transfer; its 30 missed balances are one card-date convention (purchase date vs export date). Haiku's largest miss is $50,000 of an estate.
- Model size matters for meaning, not reading. Use the strongest model available for the first load, where most judgement calls are made and recorded.
- Score in dollars as well as months. Months-exact-to-the-cent ranked the engine (4/36) above Opus (3/36) although the engine's mean miss was 63 times larger.
- Engine + Opus was best on spending because it had a fixed target and a check it could rerun. Keep those; drop the engine.

## Evidence 2: the data model test

Question: does an established data model help the model, or does it do as well from nothing? Rules written before any run: pace-setter protocol, reproduced in the repository under evidence/data-model-test/PROTOCOL.md.

- Model: Opus 5.5. Family six. Two runs per arm. Three deliveries in arrival order (258 files / 24 months, then 60 + 1 re-sent, then 61 + 1 re-sent), a fresh agent with no memory for each delivery, then a fresh reader agent with only the finished Sheet.
- Arm A, "blank": a new Google Sheet, one empty tab. Prompt: "Set up this Google Sheet to track our money, load it all in, and build us a dashboard we can open."
- Arm B, "Kitty template": 26 tabs, 1,860 formulas, headers, a README tab, no rows. Prompt: "This Google Sheet is our Kitty. It's blank and ready. Read its README tab, then load it all in."

| | Blank 1 | Blank 2 | Kitty 1 | Kitty 2 |
|---|---|---|---|---|
| First load income vs truth | +0.08% | +0.08% | +0.08% | +0.08% |
| First load spending vs truth | -0.06% | -0.06% | -0.06% | -0.06% |
| Later loads spending vs truth | +0.02% | +0.02% | +0.02% | -54.0% |
| Rows added by two re-sent files | 0 | 0 | 0 | 0 |
| Reader: balances right of 468 | 468 | 468 | 468 | 432 |
| Reader: questions right of 9 | 8 | 7 | 8 | 7 |
| Total cost | $30.84 | $24.60 | $25.28 | $25.64 |
| Minutes | 97 | 83 | 84 | 85 |

Kitty 2's -54% and 432: it booked a $100,000 extra home-loan payment as a transfer (flagged as unsure) and left one account off. The template did not prevent it.

Result by the pre-written rule: Partly. The established model added nothing to the load. The blank runs share only 43% of their shape (9 of 22 tabs, 7 of 15 ledger columns); the Kitty runs share 100%. The unmodified Kitty page, fed Kitty 1's saved tabs through a stand-in connector, opened the household and lit its views. On a blank-start Sheet it found none of its tabs.

Conclusion: the value of the data model is sameness across households. It is worth exactly what plugs into it: a shared page, a shared upgrade, a shared test.

The Sheet is the memory: no agent saw the previous one, yet each carried on from the Sheet and added 0 rows for a byte-identical re-sent export.

## The Sheet

- Blank template (copy it): https://docs.google.com/spreadsheets/d/1ym0cNBMcRtkxaQIhWFccDdz210e9nanH1B0_OCDi89U/copy
- Filled example, fictional Davies household: https://docs.google.com/spreadsheets/d/16BNQv2jTt9G3Yfbkj1NwgaAxDjBibCth40wdNXWf3aA/edit

Layers, from the template's README tab:
- Inputs (set up once, changed by a person; the agent fills them at setup from the person's answers): Settings, Kitty, Accounts, Categories, Loans, Contracts, Rules, Goals.
- Raw data (append only; agents add rows here and nowhere else): Entries (write columns A to T only; U to X are helper formulas), Payslips, Decisions.
- Views (formulas only, never typed into): Transactions, Valuations, Assets, Subscriptions, Balances, Cash Flow, Budget, Savings Finder, Mortgage Scenarios, Tax Forecast, Compliance Checks, Net Worth, plus Dashboard.
- Metrics: one row per headline number with a fixed Metric ID. Anything that draws pictures reads this tab by ID.
- README: the contract an agent reads first.

Conventions: money in positive, money out negative in raw data. A transfer between own accounts is two rows sharing a Transfer ID. The As-of date in Settings drives every view. Financial year July to June, FY26 = 1 July 2025 to 30 June 2026. IDs never change once used. After a load, read Compliance Checks first.

Only three things cannot be rebuilt: what institutions sent (Entries, Payslips), what a person decided (Decisions, Rules, inputs), and the original files. Everything else is a formula.

Locks are for people. In a probe, the Google Sheets connector wrote through a protected range on a hidden tab because it acts as the owner. Guards against a bad agent write: Compliance Checks, version history, reading before writing.

Template tidied after the test: category budgets set to 0, the public-feed switch set to "no", the demo label removed from Dashboard, Budget's filter wrapped so empty budgets show nothing.

## One line, six hops

    file:   activity_2024-07-01.csv
            30/09/2024,DENNINGTON GROCER DENNINGTON VIC,PAUL MULCAHY,-42118,130.88
    hop 1:  Entries row 1044 (agent writes A-T)
            T1043 | transaction | 30/09/2024 | ACC-CARD | DENNINGTON GROCER DENNINGTON VIC | Dennington Grocer | -130.88 | GROCERIES | Paul | ... | Source: activity_2024-07-01.csv
    hop 2:  Transactions  =FILTER({Entries!A2:A, ...}, Entries!B2:B="transaction")  -> Sep 2024 | FY25 | Groceries | Essentials | Expense
    hop 3:  Cash Flow     =-SUMIFS(Transactions!$F:$F, Transactions!$K:$K, B$4, Transactions!$N:$N, $A11, Transactions!$O:$O, "Expense")
    hop 4:  Metrics       cashflow.spending.month = 'Cash Flow'!Q17
    hop 5:  Dashboard / page  =VLOOKUP("networth.total", Metrics!A:C, 3, FALSE)

The card prints the charge as +130.88; the README says money out is negative, so the agent wrote -130.88.

## What a person types

Run in the study, word for word:
- Set up: "Here's everything we've got, in sources/. what-the-family-told-us/ has our answers from a setup chat, and definitions.json says how we count income, spending and net worth. This Google Sheet is our Kitty. It's blank and ready. Read its README tab, then load it all in."
- Monthly load: "New files since last time are in sources/. This Google Sheet is our Kitty. Bring it up to date."
- Ask (reader agent, Sheet only): questions such as total home-loan repayments for FY25 ($32,240.00, all four runs right) and which file a given charge came from.

In the author's own use: "reconcile the card" (card name removed), run monthly with real files.

Designed, not scored: "It's tax time. Pull together what our accountant needs for last financial year and zip it up."

Harnesses:
- Claude Code: files in a folder on disk; Google Sheets through a connector; bank sites through a browser tool where the person signs in. Every run in this note used it.
- Codex: reads the same SKILL.md format. The author's monthly loads run in Codex. Not run on the test family.
- Claude app (web or phone): attach files to the chat; code execution reads them; the Sheets connector writes. Not tested. Fine for a month of files.

Buttons: a skill is chosen by what the person says, not by a button. A page should have buttons only for jobs it can finish alone (answer a question, change one category, open the Sheet). Anything needing files, a browser or many writes: the page hands over a sentence to say in the harness.

## The skill

    ---
    name: kitty
    description: Keep a household's Kitty Sheet up to date. Use for any bank file, statement, payslip or screenshot, and for "do the banking", "bring my Kitty up to date", "reconcile the card" or "tax time".
    ---
    The Sheet's README tab is the contract. Read it first and follow it.
    1. Read README, Accounts, Decisions and the latest Balances. Note the revision.
    2. Take the files you were given and anything in the Kitty folder's Inbox. Skip a file already filed under Sources.
    3. Read them however works: pdftotext, Python, vision. Keep no code.
    4. Chain every stated balance in scratch before writing anything.
    5. Give meaning from Rules, then history, then judgement. Ask only what you cannot settle, and record each call on Decisions. Never guess a dollar.
    6. Write with one update_spreadsheet call, typed cells, at the revision you read. Bank text can start with "=": never send it through update_values or append_values.
    7. Read Compliance Checks. If any is red, fix it and read again. After three tries, stop and say what is wrong.
    8. Move originals to Sources/<account>/<month>/. Report in three lines.

Probe facts behind step 6 (fictional scratch Sheet, 7 November 2026): update_spreadsheet is atomic (a batch with one bad request applied nothing) and refuses a stale writeControl.requiredRevisionId. Typed updateCells keeps "=1+1", "0012345" and "2026-03-04" exactly. update_values and append_values run formulas and coerce types.

## Upgrades

Pull, never push. Upstream never writes to a household's Sheet.
- The page: one published URL with no data; republishing reaches every viewer; it reads the Sheet's version and leaves dark what it cannot find.
- The skill: pulled by the person, diff read first. Never auto-updated: it holds write access to bank data.
- The Sheet: CHANGES.md holds change notes (what changed, why, what good looks like, how to treat tailoring). The person says: "Read the Kitty changes since sheet version 2 and apply them to my Sheet. Show me the plan first." Their harness plans against their own Sheet, writes one batch, runs the checks, bumps Kitty!sheet_version.
- Probed: copying a tab between Sheets in one call keeps formatting and formulas; formulas pointing at missing tabs show #REF! until rewired. Not tested: applying a change note to a tailored Sheet.

## Principles

1. The harness is the runtime. Ship a shape, checks, a page and a small skill. No importer.
2. Define the end state, not the steps.
3. The Sheet is the memory.
4. Checks decide; a writer never marks its own work.
5. Keep originals; everything else can be rebuilt.
6. Pull, never push.
7. Score in dollars, on a family the model has never seen.

## What stays hard

- Arithmetic cannot prove meaning. The $168,000 ties either way; only a definition or a question settles it.
- No stated balance, no proof. Card CSVs print none; rows wait for the statement.
- The model reads the bank lines, and whatever it reads goes to its provider. Say so at setup.
- Agents hold the owner's keys. A bad write is caught and undone, never prevented.
- Open: would a stranger choose the shared page over one a model writes for them? That needs a person.

## Limits

One fictional family. One run per model for the one-shots; two runs per arm for the data model test; Claude only in scored runs. One-shots wrote JSON, not a Sheet, and had the family's setup answers. Costs are API list prices from each run's own token counts, cache writes at 1.25x input; on a subscription the extra cost is nil. No scored run used real bank files; the author's live Kitty uses them monthly and was read as code only.

## Links

- The Kitty repository: https://github.com/EthDawg/the-kitty
- The Kitty page (fictional Davies): https://claude.ai/artifact/QH2gsDP8sHZmgMVKBtkwxn
- Reading: Necula, Proof-Carrying Code (POPL 1997). Beck, On the Hourglass Model (CACM 2019). Sutton, The Bitter Lesson (2019). Anthropic, Code execution with MCP (2025). Agent Skills, SKILL.md format. Google Sheets API, spreadsheets.batchUpdate.
