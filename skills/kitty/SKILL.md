---
name: kitty
description: Keep a household's Kitty Sheet up to date. Use for any bank file, statement, payslip or screenshot, and for "do the banking", "bring my Kitty up to date", "reconcile the card" or "tax time".
---

The Sheet's README tab is the contract. Read it first and follow it. A text copy is in `template/README-tab.md`; the tab wins if they differ.

1. Read README, Accounts, Decisions and the latest Balances. Note the spreadsheet's revision.
2. Take the files you were given and anything in the Kitty folder's Inbox. Skip a file already filed under Sources.
3. Read them however works: pdftotext, Python, vision. Keep no code.
4. Chain every stated balance in scratch before writing anything.
5. Give meaning from Rules, then history, then judgement. Ask only what you cannot settle, and record each call on Decisions. Never guess a dollar.
6. Write with one `update_spreadsheet` call, typed cells, at the revision you read. Bank text can start with `=`: never send it through `update_values` or `append_values`, which run it as a formula and coerce `0012345` and dates.
7. Read Compliance Checks. If any is red, fix it and read again. After three tries, stop and say what is wrong.
8. Move originals to `Sources/<account>/<month>/`. Report in three lines: what landed, what ties, what needs a person.

Never move money, pay a bill, accept terms or change a bank setting. Say plainly at setup that the model reads the bank lines and that they go to its provider.
