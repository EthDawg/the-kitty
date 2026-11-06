# The month-end close, as the banks deliver it

This is how bank files reach a v2 sheet today. It is the Python importer, and it stays the reference until the JavaScript
port in `src/core/` replaces it. `tools/period_parity.py` holds the two to the same plan. December 2026 and January 2027 were
closed this way on 3 November 2026 to prove the model. Their folders are kept, and `python3 check.py import` repeats January.

```bash
python3 period-close/simulate.py 2027-02      # demo only: writes the month's files as each bank would
python3 snapshot.py                           # the sheet as it stands, for de-duplication and history
python3 period-close/import_month.py 2027-02  # reads sources/, refuses rows already in the sheet, categorises
```

Settle `period-close/2027-02/review.md` in `overrides.csv` and run the import again. On a v2 sheet the importer writes a
`write-plan.json`: follow the three steps it prints, and verify with `period-close/verify.py`. Then move Settings, As-of date,
update Last used and read Compliance Checks. `skills/bank-export/SKILL.md` is the agent's version.

- Files land in `sources/<account id>/<download date>/`, one per account, in the institution's own shape. `adapters.py` folds each into one signed amount (Harbour Bank writes like Westpac, with debit and credit columns and a running balance; Southern Card like American Express, with charges positive; Wattle Credit Union like ING). The file is never edited.
- Overlapping exports are safe in one run. Each row is taken once, and a genuine double charge survives, because the most copies in any one file is how many are real.
- Where a file prints a running balance, its last balance in the month must equal the sheet's opening balance plus every row to that date. If not, the run exits 2, `rows.json` is empty and the rows wait in `rows.held.json`. Card files print no balance, so they carry no such check.
- A row the sheet already holds is refused (same date, account, description and amount, counted), so a file imported twice appends nothing.
- Txn IDs continue from the sheet's last.
- On a v2 sheet the rows land on Entries, columns A to T, by explicit range at the first empty row. Never append to a tab with helper columns.
- The close is done when every Close check on Compliance Checks is OK and `close.items_missing` is 0.
- The sheet's bound Apps Script serves the JSON feed only while the Kitty tab says `public_feed = yes`. The demo sheet says yes because every number in it is fictional. A household with real money leaves it off and reads live through the connector.

`--sources`, `--out` and `--inputs` run the importer away from the repository's own folders, which is how `check.py` repeats a
month without writing here. `python3 period-close/import_month.py --help` lists the rest.
