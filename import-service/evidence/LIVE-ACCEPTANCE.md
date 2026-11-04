# Live Google Sheets writer primitive acceptance — 4 November 2026

**Result:** the generated v1 writer batch preserved existing data and formulas in all three bounded synthetic cases. No write-strategy correction was required. This is a provider-primitive result, not proof that the mobile app's OAuth or hosted service works.

## Destination and authority

- A whole-workbook copy of the user-supplied public fictional Davies template was created for this test.
- Test workbook: [The Kitty iOS — synthetic writer acceptance 2026-11-04](https://docs.google.com/spreadsheets/d/1dqaHThXz07fCL-rfIzC0Y6rk1uMiSGaO1N6P6WpipWg/edit).
- Original source: `1zfiCnqO36a0YmMwC8-J6iGHUGvmLdXmhbL5aPWNlExM`; read-only throughout.
- Copy ID differs from the original. Initial and final metadata show `shared: false`, owner-only permission, and the private ChatGPT parent folder.
- No original workbook, real household data, sharing permission or financial account was changed. Test tabs and synthetic records remain in the copy for inspection; nothing was deleted.

## Method

`GoogleDriver.atomicInsert` was invoked locally with a fetch capture. Its **actual generated request body** was then sent through `google_drive.batch_update_spreadsheet`, and authoritative `get_spreadsheet_cells` reads retrieved typed values and formula strings. Requests and readbacks are retained beside this note. This bypassed the service's HTTP and OAuth paths; it did not substitute a fake for the Google write itself.

The batch grows the grid, inserts space in raw input cells only, writes those cells with typed values, formats dates and creates a receipt in the same Google `batchUpdate`. It does not use `values.append`, whole-row insertion, or overwrite helper columns.

The formula comparison inspected these exact ranges before and after the populated append: `Transactions!K2:Q2`, `Accounts!H2:H7`, `Goals!E2:J10`, `Metrics!A1:H70`, `'Compliance Checks'!A1:G50`, `'Cash Flow'!A1:T35`, `Budget!A1:I50`, `'Savings Finder'!A1:G30`, `'Mortgage Scenarios'!A1:H40`, `'Tax Forecast'!A1:F45`, and `'Net Worth'!A1:I35`. Full original-row comparison used `Transactions!A1:J928` against the untouched duplicate `'Test — existing rows'!A1:J928` before that duplicate's separate stale-offset test.

Empty-test reads covered `'Test — empty first import'!A1:Q4` and `'Test — assertions'!A1:B2`; stale-offset readback covered `'Test — existing rows'!A925:Q930` and `K2:Q2`. Receipt inspection covered `'_KittyImports'!A1:E5`.

## Observations

| Case | Scope and observed result |
|---|---|
| Populated template append | Exact request wrote T0926 and T0927 to `Transactions!A927:J928`; amounts -10.00 and -5.00. The first 926 rows including the header matched the untouched duplicate exactly: **0 changed original rows**. |
| Formula preservation | All **1,386 inspected formula cells** across the existing helpers and selected account, goal, metric, check and view ranges were byte-for-byte unchanged. New rows' seven helper outputs populated correctly, including Groceries / Essentials / Expense and duplicate count 1. |
| Empty first import | A new 17-column test tab used the actual template header and its seven actual ARRAYFORMULAs anchored at K2:Q2. The generated batch wrote T0001 at row 2 with -12.34. All seven formula strings remained unchanged and produced valid outputs. |
| Cross-tab references | External `SUM('Test — empty first import'!F2:F)` and `COUNTA(...!A2:A)` formulas remained unchanged, returning -12.34 and 1. |
| Stale row offset | A simulated other editor placed `EXT0001` at row 927 after the assumed preflight. The writer inserted at that stale position. App record T0926 occupied row 927; EXT0001 shifted intact to row 928, retaining -7.00 and its original narrative/note. No overwrite occurred. |
| Ownership | Final Drive metadata retained `shared: false`, one owner permission and the private ChatGPT parent. |

The populated and empty tests do not prove all possible concurrent edits. The stale-offset case deliberately models one late inserted row, not two simultaneous authenticated users. A source receipt is a synthetic test marker; its manifest ID is intentionally synthetic because the Drive upload path was not under test.

## Evidence files

- `live-before.json`: selected typed source cells, headers, helper formulas, allowed category/account examples and local neighbours.
- `live-formulas-before.json`: all 1,386 inspected pre-write formula strings and addresses.
- `live-end-request.json`, `live-end-readback.json`: generated append request and Google response data.
- `live-original-rows-comparison.json`: complete original-row comparison (925 transactions plus header); no changes.
- `live-empty-request.json`, `live-empty-before.json`, `live-empty-after.json`: first-row insertion, helpers and dependent SUM/COUNTA.
- `live-stale-offset-request.json`, `live-stale-offset-readback.json`: externally placed row preserved across stale offset.
- `live-metadata-final.json`: final private-copy metadata.

The financial records are fictional. No credentials, account tokens or private financial records are included. Raw provider JSON is retained locally and excluded from version control because response metadata can identify the authorised Google account.

## Limits that remain

- Hosted service, app Google OAuth/drive.file consent and actual Drive evidence uploads were not exercised.
- The later shared recovery hold on Drive appProperties is locally tested only; this run did not exercise its cross-account/client visibility or hosted lifecycle.
- v2 Entries writes remain covered by local tests, not this v1 provider run.
- No real-bank source file, PDF extraction, month-end close, statement reconciliation, transfer-pair correctness, second identity, background delivery or consumer usability claim follows from these results.
- No native Google-rendered visual QA was performed; the purpose was typed values/formula behavior. UI quality belongs to the mobile acceptance work.
- The service must remain single-replica unless it gains a distributed write coordinator. Sheets does not provide full isolation from human editors.
