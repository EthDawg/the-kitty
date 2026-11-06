---
name: kitty-tax-pack
description: Prepare a person's tax pack for their accountant, from their own files, then take the lodged return back in. One zip of a workbook, the actual evidence, a cover note and a manifest. Use at tax time, when an accountant asks for documents, or when a notice of assessment arrives. It prepares; it does not lodge, and it is not tax advice.
---

# Tax pack, the agent's part of tax time

The job: hand an accountant something they can work from offline, where every figure traces to a file and everything missing is said out loud. Then take what comes back and hold it beside what was sent.

## What this is not

- **Preparation complete is not lodged.** Only the person's registered tax agent, or the person, lodges. You do not lodge, and you never sign in to the tax office.
- **This is not tax advice.** The pack states what the records show. Estimates are indicative. A question of treatment goes on Open Items for the accountant, and stays out of the numbers.
- **You do not send it.** The person sends the zip. You never email a pack, post it anywhere, or upload it to a portal.

## The rules that do not bend

1. **A pack never carries a tax file number.** Not in a cell, a note, a file name or an evidence file. Accountants are advised not to take them by email. If a file might carry one, it stays out and goes on Open Items, and the person redacts it. The person gives the number by phone or through the accountant's portal. You never ask for it, type it or store it.
2. **Never turn a missing value into zero.** A value is a number, nil with a stated reason, or `not found`. "No file says so" is `not found`. "This statement shows none" is nil.
3. **The files stay as they arrived.** Rename the copy in the pack if you must. Never edit a file, and keep the hash in the manifest true.
4. **No cloud links in the pack.** A link can change after lodgement, and an accountant must keep records for five years. The pack is a fixed copy.
5. **Rates come from the Standard's dated reference.** Never type a rate. If the reference has none for that date, say so. The law changes: check the method for a capital gain by the date of the sale.
6. **A deduction on a bank line alone is at risk.** Say so. Do not upgrade it.
7. **Estimates are labelled indicative, everywhere they appear.**

## With a Kitty

From the repository, once the household's files are in:

```bash
node src/household/pack/cli.js tax --person <id> --fy FY2026 --as-of <today> --out <folder>
```

That gives one zip per person. Read back to the person, in order: the indicative outcome, what is at risk, then section A of Open Items, which is theirs to clear. Section B is for the accountant, so leave it alone. Ask them to clear A before sending, and do not hold the pack hostage to it: an honest gap is a good result.

## Without a Kitty

Use `docs/examples/tax-kit/The-Kitty-tax-kit-FY2026.xlsx`. It is the same workbook, empty, with live formulas.

1. Ask the person for a folder of the year's documents. Read what is there. Do not ask for what you can read.
2. Fill the blue cells from the documents, one figure one document, with the file name and the page or row beside it. An empty cell says `not found`, and that is correct until a document says otherwise.
3. Full-property figures on each property tab. The ownership share goes in once, at the top, and is applied once, at the bottom.
4. Every loan on Loan Interest, the private ones too. The unexplained difference must be zero. If it is not, a statement is missing: most often a closed account after a refinance.
5. Put the documents in a folder beside the workbook, in numbered folders, named by date. Zip it. Show the person the size. If it is over about 15 MB, split it and say so: the same folder, in parts.

## What an accountant usually asks for

Income statements, bank interest, dividend and fund statements, employee share and broker statements, private health statement. For a rental: the agent's year-end statement, loan interest statements, the depreciation schedule, rates, insurance, land tax, the ownership split, weeks rented, and the purchase contract and settlement statement in the year of purchase. Last year's return with its schedules, and the notice of assessment. These are checklists from accounting firms, not rules. Ask this accountant what they want.

## When it comes back

A lodged return and a notice of assessment are evidence. Add them like any other file.

```bash
node src/household/pack/cli.js takeback --person <id> --fy FY2026 --as-of <day of the draft> --back <today> --out <folder>
```

That sets what was lodged beside the draft, label by label, as a new version. Say what differs in one line each. A lodged return outranks the draft, so a difference is a question, not an error: sometimes the draft was wrong, and sometimes the return missed something. If it missed something, the person raises it with their accountant.

An amendment is a new version. Never overwrite the earlier one: the year has to be readable as it stood on any day. Keep the records for five years from lodging, and longer for anything with a capital gain to come.
