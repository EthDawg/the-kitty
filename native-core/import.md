# Shared import boundary

`import.js` is a pure UMD module. Load with `require('./import.js')` in Node or as `KittyImport` in JavaScriptCore. It reads no files, makes no network calls, writes no Sheet cells and supplies no authority. The host retains original bytes and computes SHA-256; the service must authenticate the user, select the Sheet, rerun preparation against fresh records, commit narrowly and verify readback.

```js
const proposal = KittyImport.prepare({
  files: [{id: sha256, name: 'export.csv', text, accountId: 'ACC-EVD'}],
  accounts: [{id: 'ACC-EVD', name: 'Everyday', owner: 'Joint', currency: 'AUD'}],
  categories: [{id: 'FOOD', name: 'Groceries'}, {id: 'UNCAT', name: 'Uncategorised'}],
  existing: [{id: 'T0001', date: '2027-01-02', accountId: 'ACC-EVD',
    description: 'GROCER', amountMinor: '-8640', categoryId: 'FOOD'}],
  decisions: {}
});
```

`rows` contain proposed financial records, not committed records. `amountMinor` is an exact integer string; `decimalAmount` is a two-decimal string for a deliberate Sheet boundary conversion. Original `description` is preserved. `merchant`, `categoryId` and `person` are reviewed annotations. `identity` is the complete identity tuple and `id` its stable display identifier. The identifier hash is **not** cryptographic evidence; the writer must retain and compare the full identity and source SHA-256.

`canCommit` is true only with at least one proposed row and no unresolved errors or reviews. It proves local validation for the supplied input only. A zero-row reimport is a no-op, not an error and not a write. `counts.existing` means source/provider identity established; `counts.possibleExisting` means a tuple match still requiring review. `files[].balanceBasis` distinguishes checked source arithmetic from unavailable evidence. Neither establishes completeness of the household or reconciliation of the destination Sheet.

## CSV and mapping

Three exact synthetic bank formats from the existing project are recognised. Their real-world bank counterparts remain unverified. BOM, quotes, multiline fields and CRLF are supported. Invalid rows block the whole proposal; unsupported files fail visibly.

Typed source intake may opt into `prepare({allowEmptyFiles:true, ...})` for a header-only bank export. It still checks the account, supported currency and recognized or confirmed mapping; generic mappings require a date order. `files[].empty:true` distinguishes these sources. A header-only file does not establish account identity or prove no activity. The typed writer must separately require matching reviewed statement-balance evidence. An empty-only proposal still has `canCommit:false`. The lower-level equivalent is `parseCSV(text, {allowEmpty:true})`; defaults continue to reject heading-only files, and entirely empty/malformed files always fail.

For an unfamiliar format, supply a **user-confirmed** mapping:

```js
file.mapping = {
  confirmed: true,
  date: 'Date', description: 'Description', amount: 'Amount',
  sign: 'money-in-positive', // or charges-positive
  dateOrder: 'dmy'           // mdy; ISO YYYY-MM-DD is unambiguous
};
```

Separate amount columns use `debit`, `credit`, `debitSign: 'positive'|'negative'` instead of `amount` and `sign`. Optional columns: `status`, `providerId`, `balance`, `account`. Optional `file.openingMinor` and `closingMinor` permit statement arithmetic checks. `accounts[].numberSuffix` validates source account identifiers where supplied. Every mapped column must exist and have a single role. The app must not silently default a generic date/sign mapping before confirmation.

A supplied `Status`, `Posting status` or `Transaction status` header must be mapped. Pending rows are excluded and counted; unfamiliar status values block the import. Native UTF-8 decoding preserves the BOM so the source ID and service SHA-256 refer to exactly the same original bytes.

For a recognized new-household profile, the trusted service baseline adds `accounts[].openingDate` as an ISO date. Posted CSV rows on or before it fail with `transaction-before-opening`; pending rows remain excluded. An invalid supplied date fails with `opening-anchor-invalid`. Use an export beginning the following day: the opening balance already represents earlier activity. The dates also bind review acknowledgements. Legacy baselines omit this key and retain their prior behavior and review keys. The service must derive these dates from the actual Sheet, not a client-supplied account object.

## Decisions and acknowledgements

Per-row decisions are keyed by `row.id` (or exact description for an explicitly chosen rule): `{categoryId, merchant?, person?, acceptUncategorised?}`. Unknown category IDs always block. `duplicate:'skip'` deliberately excludes a candidate; `duplicate:'keep'` explicitly treats a legacy tuple match as an extra real charge and creates a source-bound identity. A provider ID already in the Sheet cannot be forced in a second time.

Review acknowledgements use exact evidence-bound keys:

```js
decisions.$review = {acknowledge: [issue.reviewKey]};
```

Never persist a row ID as blanket approval or regenerate the accepted keys from whatever issues appear next. Naked issue codes grant no approval. Source bytes/mapping, the current baseline and the issue's proposed meaning bind each key. A change invalidates the prior approval. Output `review.acknowledged` contains active accepted keys; `review.pending` lists unresolved keys. Save exact keys with the draft. Server preparation must use the same original files, decisions and fresh normalized baseline; stale approval requires renewed review.

Issues marked `requiresDecision` cannot be resolved by acknowledgements, even an exact current key. Classification requires a category or explicit uncategorised choice. Possible duplicates require `duplicate:'keep'|'skip'`. After an additional-charge decision changes a proposal ID, subsequent category choices use `row.originalProposalID`. An unclassified `duplicates[].candidate` may omit `merchant`, `categoryId` and `person`.

Without provider IDs, overlapping exports use maximum tuple multiplicity. One file with one identical charge and another with two yields two candidate charges, with explicit overlap/repeat review—not three. Distinct identical charges in disjoint sources cannot be inferred. A user can preserve a particular source row independently:

```js
decisions.$sourceRows = {'FILE_SHA256:2': {duplicate: 'distinct'}};
```

That creates a distinct source-bound identity and another review explaining the consequence. Persist this decision and source provenance for replay. Existing legacy tuples lacking provenance produce `existing-overlap`; `duplicates[].candidate` supplies the excluded candidate for comparison or an explicit additional-charge decision. Equal text/date/amount is not proof of identity.

Exact persisted source-row provenance is checked across every matching ledger occurrence, so replay stays idempotent after local decisions reset or identical ledger rows reorder. Native review uses the service's `/v1/imports/provenance` baseline verbatim to keep source facts and review keys aligned with independent server validation.

## Boundaries still owned elsewhere

- PDF/OCR and general AI extraction are unsupported here; they must produce a reviewed mapping/source that passes this boundary.
- Bank download and sign-in are outside the importer.
- Review of a possible transfer or refund does not establish a transfer pair or original-purchase link.
- The service owns Sheet schema v1/v2 placement, formula protection, IDs, atomicity, concurrency, receipts and interrupted-write recovery.
- Source text must enter Sheets using `RAW` or typed string cells, never formula evaluation.
- Money is bounded to ±999,999,999,999.99. Supported two-decimal currencies are AUD, USD, NZD, GBP, EUR, CAD, CHF, SGD and HKD. Other scales (including JPY/KWD), mixed Sheet/account currencies, quantities and FX are refused.

Run `node --test native-core/import.test.js test.js`. The tests cover synthetic source and adversarial inputs. They do not establish real-bank acceptance, Google delivery, iOS runtime or physical-device behaviour. The native resource copy is `ios/Kitty/Resources/import.js`; regenerate it from this source when building.
