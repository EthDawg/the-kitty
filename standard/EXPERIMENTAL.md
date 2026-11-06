# Experimental surfaces

The data model is the job. These sit around it. Each has a real baseline and an honest list of what is undecided, so that we can
come back to them without guessing. Nothing here is presented in the product as finished; each carries an Experimental
label and says what it does today.

| Surface | Works today | Not decided |
|---|---|---|
| **Collect by computer use** | The page lists what each stream is missing (`evidence.coverage`), so the list of what to fetch is real. The button is a mock. | Skills or a Workbench-style harness? Which browser, whose session? How does a second factor reach a person? Sign-in is never automated past a person. Does Jev fit? The eval has parody portals to prove it on. |
| **Tax readiness** | Real. Per person, per year: evidence held, what is missing, what is at risk. Reads coverage and tax items. | Which evidence rule applies to which claim, by year, as dated reference data. |
| **Tax pack download** | A real pack: the lines, the evidence list and the gaps, as a file. | The accountant's preferred shape. Whether it is one generic pack (tax, insurance, lender, executor) or several. Lodgement is out of scope. |
| **Run tax return advice** | The derived draft and its ties to lodged history are real. Advice is not wired. | Connect the Australian Tax MCP as a host capability. How to show a model's reading beside the draft and keep the line between record and advice. |
| **Run reconciliation** | Real as a report: every law, by scope, with the gap. | Who confirms a close, how a lock is shown, what a person does about a gap on a phone. |
| **Two-way sheet sync** | Workbook output only, and a rule that a writer must compare the stored hash first. | The sync itself. Managed tabs, hand edits becoming proposed decisions, the dry-run update. Relaxing the exact `sheet_version` gate in `src/engine.js` and `src/hosts/native.js`, which SPEC section 13 requires once a second version exists. |
| **Forecast** | Terms roll forward by date; scenarios and assumptions exist in the schema. | Backtesting forecasts against what happened, and how far ahead a household trusts them. |
| **Sole trader** | A lodged business year reads correctly. BAS sales tie is a question, not a check. | GST as a ledger. Derivation of business income. Declined for now. |
