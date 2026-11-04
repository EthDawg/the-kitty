# Typed intake and close protocol — implementation contract

This file fixes the shared/native/writer boundary. Contract 1 transaction requests remain accepted.
Contract 2 uses the same authenticated prepare, commit, status, cancel and provenance routes and
the same per-Sheet queue, shared hold, reserved intent and receipt. No client supplies Sheet ranges.

## Prepare intake

`POST /v1/imports/prepare`

```json
{
  "protocolVersion": 2,
  "operation": "ingest",
  "sheetId": "selected-sheet-id",
  "schemaVersion": 1,
  "files": [{
    "id": "lowercase-sha256-of-original-bytes",
    "name": "payslip.pdf",
    "mimeType": "application/pdf",
    "byteLength": 12345,
    "bytesBase64": "strict-base64-original"
  }],
  "proposal": {
    "records": [{
      "kind": "payslip",
      "recordId": "client-stable-proposal-id",
      "fields": {
        "payDate": "2027-02-11",
        "person": "Jordan",
        "employer": "Fictional employer",
        "currency": "AUD",
        "valueBasis": "current-period",
        "grossMinor": "100000",
        "taxMinor": "20000",
        "superMinor": "12000",
        "netMinor": "80000"
      },
      "sourceRefs": [{
        "id": "s1", "fileId": "lowercase-sha256-of-original-bytes",
        "page": 1, "quote": "Current period gross 1000.00; tax 200.00; net 800.00",
        "basis": "current-period"
      }],
      "extraction": {"method": "human-confirmed-document", "version": "1"},
      "confirmedFields": {
        "payDate": {"value": "2027-02-11", "sourceRefIds": ["s1"]},
        "person": {"value": "Jordan", "sourceRefIds": ["s1"]},
        "employer": {"value": "Fictional employer", "sourceRefIds": ["s1"]},
        "currency": {"value": "AUD", "sourceRefIds": ["s1"]},
        "valueBasis": {"value": "current-period", "sourceRefIds": ["s1"]},
        "grossMinor": {"value": "100000", "sourceRefIds": ["s1"]},
        "taxMinor": {"value": "20000", "sourceRefIds": ["s1"]},
        "superMinor": {"value": "12000", "sourceRefIds": ["s1"]},
        "netMinor": {"value": "80000", "sourceRefIds": ["s1"]}
      }
    }],
    "review": {}
  }
}
```

Every imported field, including optional fields, must be confirmed, including
date, person/account/item, employer, currency, basis/convention and employer super. Confirmation
uses the **exact current value**, not only a field name. Edit a value/source selection and clear its
confirmation before review. `sourceRefs` supports `id`, `fileId`, `page`, `line`, `quote`, `basis`,
and optional `bbox: [x,y,width,height]`; page/line are one-based. Original hash and the complete
review are bound into the server's immutable proposal digest.

Sources use exactly one of `text` (UTF-8) or `bytesBase64` (binary). `id` must equal SHA-256 of the
decoded original bytes; `byteLength` must match. PDF signature and declared MIME must agree.
Limits remain 5 MB per original, 20 files, 1,000 records and 12 MB encoded HTTP body. Originals
are stored as bytes with the supplied validated MIME; extracted text is not a replacement original.

CSV and document records can share one intake. Send `proposal.rows`, `proposal.decisions`, and
`proposal.csvReview` from `KittyImport.prepare` alongside `proposal.records` and `proposal.review`
from `Records.prepare`. CSV originals use `text`, `accountId` and the reviewed `mapping`; binary
documents use `bytesBase64`. The service reruns CSV parsing on only the CSV account sources and
reruns typed validation independently, then persists one manifest and atomic write set. Omitted
CSV facts are refused even when a valid document is present. A valid header-only CSV is accepted
only with reviewed `statement_balance` evidence for that account; its zero activity creates no
transaction. Shared preview uses `KittyImport.prepare({...,allowEmptyFiles:true})` for this path.
The 1,000-record limit is shared by transaction and typed records in the same intake.

### Typed field shapes

- `payslip`: `payDate`, `person`, `employer`, `currency`, `valueBasis: "current-period"`,
  `grossMinor`, `taxMinor`, `superMinor`, `netMinor`; optional `deductions` and `reimbursements`
  arrays of `{label, amountMinor}`, `periodStart`, `periodEnd`, and `ytd` context. Confirm arrays as
  whole values. Net equals gross minus tax minus deductions plus reimbursements; employer super
  is excluded from that arithmetic. YTD figures never populate period values.
- `valuation`: `date`, `itemId`, `currency`, `valueMinor`, `valueKind: "asset" | "liability"`,
  optional `sourceMethod: "statement" | "appraisal" | "market" | "estimate"`.
- `statement_balance`: `accountId`, `periodStart`, `periodEnd`, `currency`,
  `balanceKind: "statement-close"`, `openingMinor`, `closingMinor`,
  `balanceConvention: "money-in-positive"`.

All money fields are canonical signed integer minor-unit strings. Target person/account/item must
exist in the current baseline. No foreign-currency conversion occurs. Liability values are negative;
asset values are non-negative. Native review converts source amount-owing conventions explicitly.
Statement balance evidence can be saved without any new financial row. It never overwrites a
calculated account balance. Document intake is labelled human-confirmed, never OCR-verified.

## Prepare close

```json
{
  "protocolVersion": 2,
  "operation": "close",
  "sheetId": "selected-sheet-id",
  "schemaVersion": 1,
  "proposal": {
    "periodEnd": "2027-02-28",
    "evidenceImportIds": ["accepted-manifest-file-id"],
    "review": {}
  }
}
```

The service loads accepted evidence from receipts and manifests; caller-supplied balances or pass
booleans are not close evidence. It preflights the target period from raw records before changing
As-of. Commit explicitly advances only the exact As-of input plus a close receipt. No Settings B16,
subscription Last used, balance view or helper formula write is permitted. A successful intake
does not advance As-of. A failed/unknown post-check never reports a verified close and never causes
blind rollback or retry.

Close proceeds exactly one calendar month from the current month-end As-of. Source checks cover
each relevant ledger account (including no activity), current-period pay against actual salary
deposits, required dated valuations, actual transfer pairs and unresolved recorded checks. A
blank amount/date/status is not converted into zero or an active/posted assumption.

Review decisions use precise shared-core issues: `review.decisions[issue.id] = {action:"acknowledge",
reason,recordIds,evidenceKey}`. Copy the issue's exact `evidenceKey`; a changed fact invalidates it.
`salaryMatches` names `{payslipRecordIds,transactionIds,reason,allowTiming?}` groups;
`transferPairs` names `{transactionIds:[a,b],reason}`. Reasons must contain at least eight characters
after trimming. Blanket acknowledged lists cannot pass reconciliation. Explicit links remain evidence
in the receipt; close does not modify existing transaction rows or v2 transfer columns.

## Lifecycle responses and native behavior

Prepare returns `{importId, proposalDigest, status:"proposed", operation, counts, issues}`.
Commit/status/cancel keep statuses `proposed`, `stale`, `unknown`, `conflict`, `verified`, `cancelled`.
Contract-2 responses also contain `protocolVersion:2`, `operation`, and `verificationScope`:

- `verified_intake`: exact approved rows/evidence and preserved original inputs verified.
- `verified_close`: target-period source reconciliation and actual post-close Sheet checks verified.
- `unverified`: no successful verification claim; show issues and retain recovery binding.

Only `status:"verified"` **and** `verificationScope:"verified_close"` permits a completed-close UI.
Counts include `new` (financial rows), `evidence` (statement records), and per-kind counts. An evidence-only
success can have `new:0`. Persist/bind `importId` and `proposalDigest` before commit; all existing freeze,
cancellation and recovery-descriptor rules apply. A stale proposal requires cancellation before replacement.

## Canonical reads and shared core

Contract-2 native review requests
`GET /v1/imports/provenance?sheetId=...&protocolVersion=2&periodEnd=2027-02-28`.
`periodEnd` is optional for intake and required for a useful target-month close projection.
Response keeps `sheetId`, `schemaVersion`, `baseline`, `revisionDigest`, `issues` and `records`,
and adds `evidence:{imports:[{importId,proposalDigest,receiptVerified:true,records}]}` plus
`evidenceImportIds`. These are service-verified evidence claims, never a client request parameter.
Unavailable/private/changed source evidence is reported in `issues`; no old manifest overrides
an edited current Sheet row.
The import-only baseline is:

`{schemaVersion,currency,asOf,people,accounts,categories,items,transactions,payslips,valuations,projectedBalances,checks,unresolvedReviews}`.

Accounts expose `id,name,currency,ledger,openingMinor,openingDate,balanceMinor,status,type`;
items expose `id,name,kind,currency,method,status,valuationRequired`. Transactions expose
`id,date,accountId,description,bankDescription,merchant,amountMinor,categoryId,person,status,transferGroup`.
`description`/`bankDescription` retain v1 bank-description D or v2 raw-text E; `merchant` retains the
reviewed merchant/description column. Payslips/valuations expose
canonical typed fields and stable record identity when available. Native uses this baseline verbatim.
`projectedBalances` contains `{accountId,date,amountMinor}` at the requested target date. Projection
uses a verified opening date and only posted/settled movements strictly after that anchor. Close
independently checks overlapping earlier transactions rather than silently excluding ambiguity.

Shared UMD exports:

- `SheetContract.describe(schemaVersion)`
- `Records.prepare({files,records,baseline,review}) -> {records,issues,canCommit,counts,...}`
- `Close.prepare({periodEnd,baseline,evidence,review}) -> {checks,issues,canClose,...}`

Server validation reruns these functions. `writeSets` exist only in the immutable server manifest.
Payslips target A:G (metadata ID reserved in I, H preserved); v1 valuations target A:C (metadata ID
reserved in F, D:E preserved); v2 valuations target Entries A:T with a V-number and U preserved.
Reserved metadata columns must be unused or carry the recognized Kitty ID contract. Legacy ID-less
rows retain multiplicity; valuation corrections never append blindly over an existing same-date value.
The exact reserved header is `Kitty record ID` (Payslips I; v1 Valuations F). Existing custom content
or formulas in those columns block intake. Only a required new typed row initializes a missing ID
column; helper H or D:E stays in place. The Sheet retains raw financial facts, and its receipt points
to the user-owned manifest holding source pages, confirmations, deductions and other evidence.

This contract is implemented and locally tested. Its generated Google requests and recovery state
machine have not yet run through deployed app OAuth on a live typed-intake/close Sheet. The older
live v1 transaction primitive test is not proof of this new document/close path. See
[local acceptance](evidence/CONTRACT-2-LOCAL.md) and [deployment limits](README.md).
