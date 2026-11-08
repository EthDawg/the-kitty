# Period core contract (stable names; additions only from here)

Shared JS port of `period-close/`. One call: `KittyPeriod.plan(input)`, then the host writes, then `KittyPeriod.verify(plan, reread, opts)`.
Pure UMD (`src/core/period-*.js`, entry `period-core.js`): `require` in Node, `window.KittyPeriod` in the page. Load order in a page:
`period-text.js, period-adapters.js, period-writeplan.js, period-plan.js, period-core.js`. No file, network, clock or randomness inside.
Same input gives the same bytes. `input.files` order never matters.

## Input
```
{ months: "2027-02" | "2025-07..2027-03",     // first > last or a non-month throws PeriodInputError (a host bug, not a fault)
  sheet: <doc>,                               // same keys as data/snapshot-v2.json; see below
  files: [ File ] | null,                     // null = no sources folder at all (Stop). [] = nothing to import (ready, empty plan)
  inputs: [ { path, shown?, kind: "overrides"|"valuations"|"payslips", text } ],  // month CSVs, in precedence order; first override per Description wins
  options: { as_of?: "yyyy-mm-dd", loans?: "defer"|"now", sheet_id?, default_sheet_ids?: {v1, v2}, snapshot_label?, sources_label?,
             generated_at?, history?: [Transactions rows], allow_v1?: false } }
```
`File`, either binding works; both reach one path `account/download_day/name`:
```
{ path: "ACC-CC/2027-03-01/activity.csv", ... }           // a tree walk; folder names are checked as Python checks them
{ name: "activity.csv", account: "ACC-CC", download_day: "2027-03-01", ... }   // a file picker
  plus one of: bytes: Uint8Array                          // preferred: BOM, NUL and non-UTF-8 are checked here
               text: string, bom?: boolean                // host decoded; a leading U+FEFF is treated as bom
               rows: string[][], bom?: boolean            // host parsed cells, body and header (line numbers are row index + 1)
               pdf_lines: string[][] | pdf_text: string | pdf_error: string  // policy PDFs only, below
  is_dir: true                                            // tree hosts only: an empty or misplaced folder, so its fault still fires
```
A path with no account folder is a stop (`file_outside_download_folder`). Folder meanings: account id (bank, loan, property via Accounts `type`), `payslips`, `POL-<property>` for insurance. Dot-names are ignored.

`sheet` needs: `accounts`, `category_list`, `rules`, `contracts`, `payslips`, `assets`, `loans`, `entries` (all rows, in sheet order, with `entry_id, kind, settled_at,
account_id, raw_text, description, amount, category_id, person, receipt_held, note, transfer_id, transfer_account`), optional `source.sheet`, `fetchedAt`.
Row numbers, opening balances, last T/V/X ids, last entry id and identity counts are all derived from these; do not pass them. **Filter or reorder nothing**: row numbers come from array position.
sheet_version 2 only. A doc without `entries` throws unless `allow_v1: true`, which exists only for the parity harness (a 1.1 `transactions` doc).

### PDFs
In scope: the insurer portal's renewal notice and certificate of currency in `POL-<property>/`, as host-extracted text. `pdf_lines` is one array of cells per line, top to
bottom, left to right. `pdf_text` is the same with lines split on `\n` and cells on 2+ spaces. `pdf_error` is a one-line host failure; it and an empty extraction stop with "this PDF needs a person".
Python-only for now: byte-level extraction (`pdftext.py`). Out everywhere: any bank, loan or card statement PDF is the `pdf_no_adapter` stop, as in Python. OCR'd layouts are unproven: parity covers text extracted by `pdftext.py` only.

## Output: `{ status, exit, plan, proposed, outcomes, faults, holds, review, checks, review_md, rows_payload, entries_payload }`
`status`/`exit`: `ready`/0, `hold`/2, `stopped`/1, same as Python's exit codes.
```
proposed:  { transactions: [Row], loan_lines: [Row], valuations: [{id, month_end, account, value_cents, value, source, raw, description, from}],
             payslips: [[date, person, employer, gross, tax, super, net]], transfers: [Pair], loan_pairs: [LoanPair], contract_updates: [Write] }
Row:       { id, date, account, raw_text, merchant, amount_cents, amount, category_id, person, receipt_held, note, transfer_id, transfer_account, source, file, line, identity }
identity:  JSON array [date, account, amount_cents, ident]; ident = upper-cased, whitespace-folded description. Occurrence is by multiset count, not stored.
Pair:      { transfer_id, a: {id, date, account, amount_cents, new}, b: {...} }     LoanPair: { transfer_id, loan_row_id, mate: {...}, deferred: bool }
outcomes:  { taken, already_in_sheet: [{file, line, date, description, amount_cents}], repeated_across_files: [...], outside_window: [{file, earlier, later, gap}] }
faults:    [{ severity: "stop", code, file, row, what, do, md }]       // what/do/md byte-equal Python's ImportFault
holds:     [{ code, file, text }]                                      // text byte-equal Python's HOLD line
review:    string[]   // the "## Review" lines (new merchant, mixed history, set by review, gaps)
checks:    { closing: [{file, day, printed, ledger, ok, gap_cents} | {file, unchecked: reason}], transfers: [line], loans: [line], valuations: [line], payslips: [line], owners: [line], policies: [line], files: [line] }
review_md: string     // byte-equal Python review.md, except the "seconds" figure is always 0.0. Show structured fields; this is the audit copy.
```
`plan` is `kitty-write-plan/1`, key for key Python's `write-plan.json`:
`schema, generated_at (options.generated_at or null), importer, months, status, sheet, assumes, preconditions, writes, deferred, verify, totals`, plus `held_writes` on hold and `not_planned` on stop.
A write is `{id, tab, op: "append"|"update", range: "Entries!A13:T512", rows, columns?, values, precondition?, note?, why?}`. Rules the host must keep:
- Read every `preconditions[]` range first, call `verify(plan, preflight, {preconditions:true})`; refuse to write unless ok. Then write `writes[]` in order by explicit range with
  `update_values` (USER_ENTERED), **never append**. Then re-read every range and `verify(plan, reread)`.
- `null` in an update means leave that cell alone; `""` means blank. Leading `= + - @` text is already apostrophe-escaped. Appends are already chunked at 500 rows.
- `preconditions` cover rows on the sheet now, nothing else. A deferred pair on a row this plan appends carries none: check that row once it lands.
- A `null` in `expect` means the cell was blank and must still be. `verify` refuses preflight on any plan that is not `ready`.
- On hold or stop, `writes` and `deferred` are empty. `deferred` waits for a person or phase D and is re-planned each run; `--loans now` is `options.loans = "now"`.
- `generated_at`, `totals.seconds` (always 0) and `importer` are the only fields that differ from Python.

`verify(plan, reread, {preconditions?, include_deferred?})` returns `{ ok, exit, lines, mismatches: [{range, cell, planned, actual}] }`; `reread` is any shape verify.py loads.
A plan with status other than ready fails, as in Python. `lines` matches verify.py's stdout.

## Stop fault, hold, review item
- **Stop** (`exit 1`, nothing planned): the importer cannot trust a file or the setup. Every file is read first so all file faults show together; a later-stage stop (`id_collision`, `unknown_category`, `unlinked_property`, valuation row faults) arrives alone.
  Codes: `sources_missing unknown_account no_adapter_account not_a_download_folder file_outside_download_folder nested_folder pdf_no_adapter file_type csv_in_policy empty_file not_utf8 csv_unreadable unknown_shape header_mismatch wrong_institution wrong_loan_shape wrong_lender wrong_owner_shape wrong_payslip_shape bad_date two_digit_year bad_month no_such_day bad_amount bad_value bad_columns implausible_date after_download after_as_of before_opening out_of_order pdf_needs_person policy_wrong_folder id_collision unknown_category unlinked_property unknown_valuation_item bad_month_end`.
  Added since: `duplicate_file` (two files reach one path; neither is read), `bad_sheet_row` (a ledger date that is not yyyy-mm-dd, or an amount past safe cents; the file is the tab, the row its sheet row).
  Python has no fault codes, only text and exit 1: codes are new, the text is identical. `csv_unreadable` and `bad_value` cover inputs where Python crashes or silently writes 0.00 (see the allowlist).
- **Hold** (`exit 2`, rows retained in `proposed`, `plan.held_writes` set, `writes` empty, `rows_payload`/`entries_payload` still populated for `*.held.json`): a source and the ledger disagree and a person chooses.
  Codes: `closing_mismatch valuation_conflict payslip_conflict owner_unmatched`.
- **Review item** (`exit 0`, the run proceeds): new merchant (UNCAT), mixed history, override applied, gap in earlier months, unpaired or ambiguous transfer, unpaired repayment, no insurance row, certificate differs. An opening-date-guarded history file is counted, not a fault.
- "Pending" transactions do not exist here: Python has no pending state, every row is `settled`; `hold` above is the only waiting state. Do not add one in the UI on this plan's behalf.

## Money and numbers
`amount_cents` etc. are safe integers and all closing, dedupe and comparison arithmetic is integer. A delivered amount parses as Python's `float()` then rounds half-even on its exact binary
value, so `1.005` is 1.00 as in Python. Plan values and `amount` are `cents / 100`, the same double Python's `round(x, 2)` gives. JS prints `3090` where Python prints `3090.0`:
same JSON number, and the parity tool compares them as equal. Text renders as Python's `:,.2f`, `:+.2f` and `repr`. An amount past `Number.MAX_SAFE_INTEGER` cents is a `bad_amount` stop. Dates and amounts take ASCII digits only.
`-0.0` does not exist here: a zero card row reads `+0.00` in a review line where Python reads `-0.00`.

## Known limits: not provable without a live Sheet
USER_ENTERED may turn text that looks like a number into a number: `000123` would land as 123, `verify` would pass it (numbers compare by value), and the next run would see a new identity and plan the row again.
The same applies to text that looks like a date or a percentage. Not escaped, because no run here can show what the API does and normal rows must not change.
A description is stripped on read, but a merchant from a rule or override may start with a space: whether ` =1+1` stays text under USER_ENTERED is unproven, and it is not escaped. Both need one live check.

## Proof
`python3 tools/period_parity.py` and `node --test tools/period-core.test.js`. Every deliberate difference from Python is listed, with its reason, in `tools/period_parity_allowlist.json`.
