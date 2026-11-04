# Kitty import service

A narrow, authenticated writer for the user-owned Kitty Sheet. It supports reviewed CSV transactions, source-bound payslips/valuations/statement balances, and a separate verified month-close operation while preserving the v1 and `v2-ledger` raw models. The original files, immutable proposal and write intent live in the user's Google Drive. Accepted financial records remain in their Sheet. This service has no financial database and stores no Google tokens.

**Implemented with local tests and a bounded live Google Sheets primitive test; not deployed as a service.** The local tests use a boundary fake and inspect actual generated Google batch requests. The live test used exact generated requests through the connected Google Drive tool on a new private synthetic copy. It established v1 insertion/formula behavior for populated, empty and stale-offset cases; it did not establish app OAuth consent, hosted-service execution, second-account access or complete month-end reconciliation. See [provider evidence](evidence/LIVE-ACCEPTANCE.md).

## Run

Requires Node 22+; no npm packages.

```sh
node --test import-service/*.test.mjs
node import-service/server.mjs
```

The standalone import server binds to `127.0.0.1:8787`. For the native app, use the [combined gateway](../service/README.md), which exposes imports and Ask on one URL. The standalone listener uses `KITTY_IMPORT_HOST` and `KITTY_IMPORT_PORT`. Put either service behind HTTPS; never send a Google bearer token over public plain HTTP. Configure the app's service URL at build time. Run exactly one service process/replica: its per-Sheet queue serializes app imports. Do not enable Node clustering, overlapping rolling replacements or autoscale beyond one instance without a distributed coordinator. Per-import durable write intents prevent replay; they do not serialize different imports across independent replicas.

`Dockerfile` runs the same service as the unprivileged Node user. Build from the repository root with `docker build -f import-service/Dockerfile .`. The deployment provider and domain are deliberately not selected or purchased by this package.

## Google access

The app sends its short-lived Google OAuth token as `Authorization: Bearer …`. The server uses only `drive.file`-compatible Drive and Sheets APIs. There are no service-account credentials or alternate identities. The workbook must have been created by or explicitly selected for the app's OAuth project; pasting an arbitrary Sheet ID does not grant access. Every request rechecks the selected file's MIME type and `capabilities.canEdit` using the caller's token.

The service creates a private Drive folder named `The Kitty imports · <sheet-prefix>`. Original CSV text or validated PDF/image bytes are stored once per content hash per Sheet. Each manifest retains the original filenames/hashes, mappings, source rows/pages, reviewed field confirmations, canonical write sets and baseline. It also reserves a Google Drive ID for a durable write-intent file. The `_KittyImports` hidden tab contains receipts. Five bounded `appProperties` on the Sheet file hold the active import ID, proposal digest, target-record hash, expected result-state hash and schema version. These properties belong to the same OAuth app; they require no additional scope. No access token or original file contents appear in application logs. Deployment infrastructure must likewise disable request-body and authorization-header logging.

Evidence files inherit the importing user's folder permissions. Sharing a Sheet does **not** automatically share original source files. No broad sharing change is performed by this service.

The writer also reads `Kitty.public_feed` using the known Apps Script feed's exact rule: the first
trimmed `public_feed` key enables it only when its value trims/lowercases to `yes`. Enabled feeds
block new preparation/source storage and fresh import/close commits with `public_feed_enabled`;
turn the setting off and refresh. Provenance remains readable and exposes `publicFeedEnabled` as
current metadata. Status, cancellation and uncertain-write recovery remain available. This flag
is excluded from historical receipt digests, so a later publishing change does not invalidate an
earlier write. It controls the known script feed only; it does not establish that a workbook is
private or inspect other sharing/publication routes. External edits can still race the final read;
this check does not add Google cell compare-and-swap.

For the new `au-aud-basic` profile/version `1.0.0`, the writer independently checks the Kitty markers, Settings A35:B36 (`Opening anchor date` and `History starts`) and every Accounts G date. The anchor is a common month-end input; history is the next day via `=B35+1`. Only recognized-profile import baselines include ISO `accounts[].openingDate`. Posted transactions on or before that date fail with `transaction_before_opening`, before source storage, ID reservation, a new intent or a financial write. Combined CSV/document intake reruns the same source audit even if submitted CSV rows are empty. A malformed recognized profile fails with `opening_anchor_invalid`; provenance supplies an invalid anchor that also blocks local preview.

These are fresh-write preconditions. Status, safe cancellation and existing-intent recovery remain reachable; a changed account/configuration can still make a prior write stale or unverified. Reserved template/setup markers or residual opening settings identify a damaged setup contract, so deleting one marker cannot silently enable legacy intake. Where present, Settings is included in the existing setup read to detect that damage. Genuine unmarked legacy Sheets receive no new account fields, historical state-digest changes or migration. These editable markers are configuration, not an access-control boundary, and external edits can race the final read.

## API

The examples below describe the unchanged contract-1 transaction path. [Contract 2](CONTRACT-2.md)
defines combined CSV/document intake, original binary envelopes, target-date provenance and explicit
month close. Both versions use the same routes, authorization, queue, shared hold, intent and receipt;
there is no parallel writer. Contract-2 success always names `verified_intake` or `verified_close`.

### Shared import baseline and provenance

`GET /v1/imports/provenance?sheetId=<sheetId>`

Returns `{sheetId, schemaVersion, records, issues, baseline, revisionDigest}`. Use `baseline` verbatim as the input to the native import core, alongside files and decisions. It contains `existing`, `accounts`, `categories`, `currency`, and `people` when available. Optional v2 Accounts Currency values are retained, so the source audit rejects mixed currencies rather than treating all accounts as the Sheet currency. The server's source audit uses the same normalizer. Dashboard projections are not a suitable substitute because they may default blank categories or omit pending entries.

An unresolved shared import hold returns `409 sheet_import_pending` before a fresh baseline or proposal can be used. After exact Sheet authorization, its nested error includes `recovery: {sheetId, importId, proposalDigest}`. A fresh device can bind a recovery-only status/cancel flow to this descriptor; it must not enable commit without the original reviewed draft. The original Google account may be needed to read private import evidence. An incomplete/changed hold returns `409 sheet_import_gate_invalid` without inventing a descriptor. These are recovery conditions; starting another batch is not a remedy. The app should show the returned message and retain any local receipt.

Each provenance record contains `transactionId` (canonical T-number), `proposalId` (stable import identity), SHA-256-bound `sourceRefs`, `sourceId`, `sourceRow`, `providerId`, `identity` and `distinctSource`. Only records with a valid manifest/receipt and matching current source facts are hydrated. A changed amount, account, date, raw narrative, kind or settlement state invalidates old identity. Corrected merchant names/categories/notes stay as the **current Sheet values**, while the unchanged source identity remains valid. Missing or inaccessible evidence produces a review limitation rather than invented identity.

Manifest retrieval uses a bounded four-request worker pool. Exact same-file replay excludes already recorded rows without another overlap question. A different file containing the same date/text/amount remains an explicit overlap question unless a provider transaction ID establishes identity. No raw source file contents are returned by this endpoint.

### Prepare

`POST /v1/imports/prepare`

```json
{
  "sheetId": "selected_google_sheet_id",
  "schemaVersion": 1,
  "files": [{
    "id": "sha256-of-the-original-file-bytes",
    "name": "bank-export.csv",
    "text": "original UTF-8 file contents",
    "sha256": "optional client hash; independently checked",
    "accountId": "ACC-EVD",
    "mapping": null
  }],
  "proposal": {
    "rows": [],
    "decisions": {},
    "review": { "acknowledged": [] }
  }
}
```

Supply the full result of `KittyImport.prepare` in `proposal`, plus the original files. Each file ID **must** equal the lowercase SHA-256 of its original UTF-8 bytes; arbitrary/reused labels are rejected. This binds replay identity to the actual evidence. For a custom bank mapping, send the reviewed mapping from `proposal.files[].mapping` on that source file. Optional `openingMinor` and `closingMinor` values are integer strings and remain part of the reviewed evidence/reconciliation check. Row `decision` objects and evidence-bound `proposal.review.acknowledged` must be retained. File-level decisions may additionally be supplied in `proposal.decisions`.

The service reads the fresh Sheet, validates the schema, checks all account/category references, reruns the shared importer on the original text, and compares normalized facts **and source references** with the proposed rows. The client's `canCommit`, amount, category, data version or claimed hash cannot bypass validation. Contract 1 imports transactions; use contract 2 for reviewed source documents and close. The server does not run OCR or infer document accuracy: each typed field must retain its exact value and explicit source-bound confirmation.

Successful response:

```json
{"importId":"google_drive_manifest_id","status":"proposed","counts":{"new":12},"issues":[],"proposalDigest":"sha256"}
```

`proposed` means the financial Sheet has not been changed. A preparation may have stored original evidence and a manifest in Drive.

### Commit

`POST /v1/imports/<importId>/commit`

```json
{"sheetId":"selected_google_sheet_id","approval":true}
```

The exact Sheet and manifest are checked again. If the baseline changed, `stale_proposal` rejects the commit before the write intent. Otherwise:

1. Verify original Drive bytes against their hashes.
2. Persist the shared hold on the Sheet's Drive metadata, then read it back. An uncertain hold never proceeds to a financial write.
3. Persist a write intent at its previously reserved Drive ID.
4. Send one atomic Sheets `batchUpdate`: grow the grid at its end, insert space in **input cells only**, fill only A:J (v1) or A:T (v2), add a receipt.
5. Read back the actual Sheet and compare every approved input cell, every pre-existing input row, IDs, receipt digest and formula fingerprint.
6. Clear only this import's matching shared hold after its exact receipt, target-row hash and expected state hash agree. A failed cleanup remains `unknown` until checked again, even when the imported rows themselves have been verified.

The writer never uses `values.append` or writes helper formula columns. Text uses `stringValue` rather than `USER_ENTERED`, so a bank narrative beginning with `=` is not executed as a formula. Dates are numeric Sheets dates with explicit date display formatting. Money is validated in integer cents before deliberate numeric conversion at the Sheets boundary.

Every lifecycle response includes `proposalDigest`; the app must bind it to the persisted preparation receipt.

Response statuses:

- `verified`: the named imported input rows, original input rows and formula fingerprint passed readback.
- `conflict`: content, IDs, receipt or formulas differ. The app must show the issue and stop; it must not celebrate or replay.
- `unknown`: the provider outcome cannot be established. Poll status; never submit a new batch automatically.

Contract-1 `verified` and contract-2 `verified_intake` establish intake only. The separate contract-2
close reconciles accepted source evidence before changing As-of, then checks actual raw facts,
formula fingerprints, calculated balances, Close counts/statuses and the missing-items metric.
Only `status:verified` with `verificationScope:verified_close` represents a completed close. A failed
or unknown check after the atomic As-of/receipt write remains visibly unresolved; it never triggers
an automatic rollback or second financial write.

### Status/recovery

`GET /v1/imports/<importId>/status?sheetId=<sheetId>`

Use after a network interruption or app restart. A matching receipt is verified against current rows. A write intent without a receipt yields `unknown` or `conflict`, never an automatic second write. The original import ID must be persisted on the phone before commit.

The shared hold blocks fresh prepares and new commits from another device even when the underlying ledger is unchanged. A completed receipt with matching current rows/state can release the hold without access to the original importer's private source files; this grants no source identity to unrelated rows. With the original immutable manifest available, status/cancel recovery also permits unrelated new rows: it verifies the exact original and approved rows, globally unique IDs, and unchanged schema, currency, people, accounts, categories and formulas before clearing the matching hold. Changed or missing original/approved rows stay held. An old receipt never releases a newer import's hold. Without access to the manifest, automatic shared-hold recovery still requires the exact recorded post-write state; the recovery descriptor routes the original account to status/cancel.

If a metadata or intent creation response was lost **before** any intent exists, status may still show `proposed`. The app may cancel through the reserved-ID tombstone protocol; it must not discard the receipt locally. A late metadata response can leave a harmless hold after cancellation; checking the original cancelled receipt clears it safely. An observed writing intent always stays held unless the financial receipt can be verified.

### Safe cancellation

`POST /v1/imports/<importId>/cancel` with `{ "sheetId": "…" }`.

Cancellation and writing compete for the **same pre-reserved Drive file ID**. A confirmed cancellation persists a tombstone, clears only its own matching shared hold, and returns `cancelled`; a delayed commit then cannot execute. Cancellation is only possible before any write intent or receipt. An unknown write remains `unknown`/`conflict` and is not unlocked by cancellation. A completed import returns its verified/conflict result rather than pretending to cancel accepted rows.

Persist the ID and digest before commit. Freeze edits after preparation. A stale proposal can be replaced only after confirmed cancellation; a locally dismissed screen is not a cancellation.

A missing response is not evidence of a failed write. A prepared import may remain unresolved until a person reconciles an externally altered Sheet; the service has no unsafe administrative reset endpoint.

## Important limits and release gates

- Google Sheets has no documented compare-and-swap revision field for this writer. The single service queue serializes its own imports. Human edits and other clients are not locked. Input-cell insertion prevents a stale row offset from overwriting an existing row, and readback detects changed pre-existing records/duplicate IDs. These safeguards are not full database transaction isolation.
- Reserved metadata headers and the explicitly approved As-of input are checked immediately before the batch. They still have the same external-editor race limit: Google offers no conditional cell write. Do not coordinate a close or reserved-column initialization concurrently with a manual editor.
- Drive `appProperties` uses read/patch/read, with **no compare-and-swap**. The shared hold provides recovery across devices and process restarts under the single-writer deployment contract; it is not a cross-replica atomic lock. Property removal/corruption outside the service can defeat or block recovery. A future distributed writer needs a separate coordination design and acceptance tests.
- All native clients must belong to the same configured Google OAuth application/project for app-scoped metadata. Cross-account/client visibility still needs live acceptance. The hold does not constrain an editor deliberately using a different OAuth app or directly editing their Sheet/metadata.
- **Formula preservation:** the live v1 synthetic test preserved all seven helper anchors on a first row-2 import, plus external SUM/COUNTA references. Populated append preserved 1,386 inspected formulas. Keep formula fingerprint checks: these observations do not prove every template/version or future Google behavior. The v2 writer is locally tested but still needs a live v2 template run.
- User-owned Drive evidence is application-immutable, not tamper-proof. Users retain control and can edit/delete their records. Changed/missing original bytes block commit; changed manifests are rejected.
- The server accepts UTF-8 CSV/text and signature-checked original PDF/PNG/JPEG files: at most 20 files, 5 MB each, 12 MB encoded HTTP payload and 1,000 combined proposed records. These are explicit bounded release limits, not silent truncation.
- Intake preserves As-of and calculated balances. Close changes only the reviewed As-of input and its receipt. The writer does not migrate schemas, perform payments, download bank data, overwrite prior valuation corrections, change Settings B16/subscription Last used or infer tax treatment. Existing v2 transfer link columns are preserved; explicit pair decisions live in the close receipt.
- Hosted HTTPS, rate-limit/proxy configuration, user-visible privacy policy, app OAuth configuration, revocation, second-identity access and provider acceptance remain deployment work.

## Verification evidence

For the recognized `au-aud-basic` profile, close preview projects the pinned diagnostic checks at the requested month end from current raw records. This avoids approving the previous As-of month's flags and discovering different flags only after the close writes. The service first verifies the exact generated diagnostic/helper inputs; custom or incomplete rules remain unresolved. Review keys bind the projected counts, and postflight requires every actual diagnostic count/status to match them, alongside the existing source, balance and nonwaivable Close checks. Subscription merchant inputs participate in the unchanged-configuration check. Legacy and v2 close behavior is unchanged.

`inspect-basic-close.mjs <saved-provider-state.json> <YYYY-MM-DD>` is an offline reader/comparator for normalized provider captures. It makes no network calls. A fictional, one-account July zero-activity provider primitive matched all 21 projected diagnostic counts/statuses and the opening balance; this proves that calculation case, not a hosted service or app `verified_close` receipt.

The 58 contract-1 cases remain passing. They cover v1/v2 writes, exact cents/dates, source validation,
provenance replay, readback, stale proposals, durable cancellation and shared-hold recovery. Contract 2
adds 32 writer/reader cases for binary originals, multi-tab writes, ID-less multiplicity, metadata
collisions, exact replay, empty activity, combined CSV/documents, source evidence reads, and close
preflight/postflight/unknown outcomes. Real fictional fixtures retain all nine payslips and sixteen
valuations on both schema targets; all 825 November transactions reproduce the six recorded account
balances. [Local acceptance](evidence/CONTRACT-2-LOCAL.md) distinguishes these checks from provider
acceptance. Five combined-gateway cases check routing, body ownership, authentication and bindings.

Provider contract references:

- [Sheets batchUpdate atomic request semantics](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/batchUpdate)
- [Sheets insertRange/updateCells requests](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/request)
- [Drive original-file uploads](https://developers.google.com/workspace/drive/api/guides/manage-uploads)
- [Drive custom properties and size limits](https://developers.google.com/workspace/drive/api/guides/properties)
- [Drive files.update metadata API](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/update)

The first provider primitive run used a new private copy, retained before/after formulas and raw rows, and tested populated append, an isolated empty input tab with actual template helpers, and a stale offset with a separately placed external row. The next acceptance run must exercise the deployed service and app OAuth, including response loss, duplicate import, a second identity and an external cell edit. Passing the local suite or primitive test does not replace those checks.
