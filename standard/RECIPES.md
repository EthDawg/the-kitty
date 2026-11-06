# Writing a recipe

A recipe is JSON that reads one family of files into observations. It holds no code. One interpreter runs it, and
the gate judges it by whether money is conserved, not by who wrote it. Golden examples: [`recipes/`](recipes/).
Output contract: [`schema/observations.json`](schema/observations.json).

## 1. Look at the file

```
node standard/intake/fp.js <file>
```

This prints the fingerprint, then the decoded rows or lines: exactly what the recipe sees. Put the fingerprint in
`fingerprints`. Fingerprints come from structure, never values, so one template has one fingerprint. Two templates can
share one; then `match` (regexes that must all hit some line) decides.

Decoders: csv and tsv (delimiter sniffed), ofx, qif, xlsx, json and html give rows; pdf, eml and html give lines.
A line has `text` (cells joined by two spaces), `cells`, `xs`, `page`, `y`.
OFX and QIF rows use tag names as columns (`DTPOSTED`, `TRNAMT`, `D`, `T`, `P`), and scalar OFX tags are meta.

## 2. Shell

```json
{ "id": "harbour-txn-csv", "version": 1, "tier": "table", "container": "csv",
  "fingerprints": ["fp1:..."], "match": [],
  "defaults": { "date": "dmy", "currency": "AUD" } }
```

`tier` is `table` (rows) or `document` (lines). Date formats: `dmy mdy dmy2 mdy2 ymd yyyymmdd iso dmony` (07 Mar 2019)
`mony` (Mar 2019). Never guess: the gate tests the other reading.

## 3. Table recipe

```json
"table": { "header": 1, "order": "oldest_first" },
"emit": [{ "kind": "txn_line", "fields": {
  "account_ref": { "col": "Bank Account" },
  "posting_date": { "col": "Date", "as": "date" },
  "description": { "col": "Narrative" },
  "amount_cents": { "credit": "Credit Amount", "debit": "Debit Amount" },
  "balance_after_cents": { "col": "Balance", "as": "cents" } } }],
"statement": { "from": "chain" },
"controls": [{ "law": "balance_chain" }, { "law": "family_chain" }]
```

`table` options:

| Key | Meaning |
|---|---|
| `header` | 1-based row of the header, counted after blank rows are dropped. Rows above it are skipped. |
| `columns` | Names, when there is no header |
| `skip_tail` | Footer rows to skip |
| `skip` | `[{col, regex, capture}]`: a row skipped by name. `capture` keeps values from it, such as `{"opening_cents": {"col": "T", "as": "cents"}}` |
| `order` | `oldest_first`, `newest_first`, `any` |
| `sheet`, `path`, `html_table` | Which xlsx sheet, json array or html table |
| `collect` | Named fields kept per row with no observation |

Every row must be consumed or skipped, or the gate fails.

`values` holds file-level fields: `{"at": [row, col]}` (1-based row, negative from the end), `{"meta": "path"}`,
`{"find": regex}` for html. `emit_file` emits once per file. `statement` derives a statement from the lines: `chain`
(running balance), `opening` (a captured `opening_cents`) or `closing` (with `"closing": expr`). `period_start` and
`period_end` take expressions; otherwise the dates of the lines. For other line kinds add `"lines": "super_line"`.

## 4. Document recipe

```json
"furniture": ["^Pawroll$", "^Fictional document from"],
"drop_cells": "^DEMO$",
"values": {
  "person_ref": { "find": "^Payslip for (.+)$" },
  "pay_date": { "below": "^Pay date$", "as": "date" },
  "gross_cents": { "right": "^Ordinary hours", "as": "cents" },
  "ytd_gross_cents": { "right": "^Ordinary hours", "cell": 2, "as": "cents" } },
"emit": [{ "kind": "payslip", "from_values": true }]
```

- `furniture` drops page headers and footers everywhere, which a wrapped table needs.
- `drop_cells` removes stray cells such as a watermark.
- `find`: regex over line text; group 1 is the value.
- `below`: the cell under a label, nearest by x.
- `right`: the cell after a label, or `cell` n (negative from the end).
- `after`: the rest of the cell after a label.
- Add `nth` for a later match, `region: {"x_min": 300}` or `{"x_max": 300}` for a column of a two-column page, and
  `optional: true` when a value may be absent.
- `from_values` copies every value whose name is a field of the kind.

Tables:

```json
"tables": [{ "name": "pays", "start": "^Pay date  Gross", "end": "^Total  ", "skip": ["\\(continued\\)$"],
  "row": "^(\\d{2} \\w{3} \\d{4})  ([\\d,.]+)$",
  "collect": { "gross": { "group": 2, "as": "cents" } },
  "emit": [{ "kind": "...", "fields": { "posting_date": { "group": 1, "as": "date" } } }] }]
```

Use `columns: [{"name", "x": [from, to]}]` instead of `row` when a blank cell decides meaning, such as withdrawals
against deposits. `wrap` joins continuation lines. A repeated header is skipped. Every line between `start` and `end`
must match `row`, `skip` or `wrap`.

## 5. Field expressions

A source, then modifiers.

| Source | Value |
|---|---|
| `{"col": "Name"}` | Table cell, by name or index |
| `{"group": 1}` | Regex group of the row |
| `{"value": "name"}` | A file-level value |
| `{"meta": "a.b"}` | Decoder meta; json paths; `doc.items` is the raw array |
| `{"stream": true}` | The folder's stream id: for a file with no account number in it |
| `{"const": "x"}` | A literal |
| `{"credit": "Cr", "debit": "Dr"}` | Credit minus the debit's absolute value |
| `{"sum": [e, e]}` | Sum as cents |
| `{"first": [e, e]}` | First that is not blank |
| `{"table": "name"}` | A table's collected rows |
| `{"pivot": {"group": [...], "key": "fy", "value": "cents", "into": "by_fy"}}` | Rows into items |

Modifiers: `as` is `text date cents units int bool month_start month_end fy fy_of ym_end excel_date json`.
Also `format` (date), `regex` (group 1), `replace` `[from, to]`, `map` (with `"*"`), `default`, `negate`, `abs`,
`if` (`{"col": "X", "matches": "..."}`, otherwise the field is left out). `cents` reads `A$1,234.50`, `(12.30)`, `-5.00`,
`12.30 DR` as integers, never through a float.

Add `when` to an `emit` to choose rows: an expression with `equals`, `in`, `matches`, `positive`, `nonzero` or `blank`.

## 6. Rules the output must keep

- Holder's sign: money in is positive. A card charge is negative whatever the file does. `negate` is how.
- Refs stay raw: the account number, name or address as printed. Setup's `alias` resolves them. Never map to internal
  ids in a recipe. Use `{"stream": true}` only when the file itself has no reference.
- Leave out what the source did not state. Absent is not zero. A printed 0.00 is 0.
- Use only fields and enums in `observations.json`; the rest fail. Required fields end in `*`.
- `_cents` is cents. Units, prices and rates stay decimal strings.
- `confidence` defaults to 1.0 for tables and 0.98 for documents.

## 7. Controls

| Law | Proves |
|---|---|
| `balance_chain` (`kind` for non-`txn_line`) | Sign, order, date reading |
| `family_chain` | Each statement's closing is the next opening, across files |
| `closing_ties` `{"equals": "stated_closing"}` | The file's stated closing |
| `equation` `{"kind", "terms": ["+gross_cents", "-tax_cents", "-net_cents"], "optional": []}` | Terms sum to zero |
| `either` `{"terms": [[...], [...]]}` | One of two equations holds |
| `table_sum` `{"table", "field", "equals"}` or `equals_sum` | Rows add to a stated total |
| `kind_sum` `{"kind", "field", "equals"}` or `equals_sum` | Observations add to a stated total |
| `product` `{"a", "b", "equals", "tolerance"}` | Units times price |
| `sign_anchor` `{"field", "regex", "sign"}` | A line known to be a credit, where no chain exists |
| `last_equals` `{"kind", "field", "equals"}` | The last row lands on a stated closing |

Add every control the file allows. A recipe with no control over its money is a recipe nobody can trust.

## 8. The gate

For every file in the family:

1. Every row is consumed or skipped.
2. Every required field parses, and the date order is proved by a day above 12 or a chain.
3. The sign is proved where a chain or equation exists.
4. Controls tie.
5. Output is the same on a shuffled row order and a repeat run.

A wrong recipe fails 2, 3 or 4. Read the failure, fix the recipe, never the file.

```
node standard/intake/check.js my-recipe.json <file or folder>...
```

This prints the verdict, each failure with its locator, and any fingerprint the recipe does not list.
`node --test standard/intake/test.js` runs every golden recipe, and proves wrong recipes fail.

## 9. What a recipe cannot do

Scans have no text layer. They are unknown to every recipe and go to agent tier: a model reads the image and emits
observations with a `quote` and a `locator`. Do not write a recipe for an image.

A header change is a new format: it gets a new fingerprint and a new recipe. Old files keep the old one.
