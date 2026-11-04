# Goal creation contract

The existing import gateway accepts one extra operation. It uses the same `ImportService` instance, queue, app-property hold, known-ID Drive intent and `_KittyImports` receipt. There is no second writer and no added OAuth scope.

```json
{
  "protocolVersion": 3,
  "operation": "goal-create",
  "sheetId": "selected_sheet_id",
  "schemaVersion": 1,
  "goal": {
    "name": "A quieter summer",
    "targetMinor": "123456",
    "targetDate": "2027-06-30",
    "accountId": "ACC-SAVER",
    "currency": "AUD"
  }
}
```

POST this body to `/v1/imports/prepare`. The response echoes `sheetId`, `protocolVersion:3`, `operation`, exact approved `goal`, `importId`, `proposalDigest`, `status:"proposed"`, counts and issues. Persist that exact binding before showing confirmation. POST `/v1/imports/:id/commit` with `{sheetId,proposalDigest,approval:true}` once. Status and cancel use the existing routes. Every result keeps the same identity and goal. `verified` also includes the actual `goalRow`; `unknown` and `conflict` are not success. Never retry a dispatched create. Cancellation competes for the same pre-reserved intent ID, so a late commit cannot override a recorded cancellation.

Preparation and new commit read the actual editable Sheet, its explicit version, Goals A:J headers, Accounts headers/type/liquidity (plus v2 active Cash/ledger/currency), As-of input and recognized setup metadata. Amounts are positive exact integer cents within the current two-decimal currency limit. Names are unique after normalization; the date is after the Sheet As-of. Sparse or custom Goals layouts are refused. Current public-feed permission is checked before new evidence storage or a new Sheet write; it is excluded from historical receipt digests.

The financial batch uses Google's typed [AppendCellsRequest](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/request#appendcellsrequest), which chooses the row after the last data row. It appends a full new goal and its receipt atomically. The six formulas come directly from the pinned legacy or `au-aud-basic` template, replacing only references to their own row with `INDEX(column,ROW())`. This retains the basic profile's unavailable-history behavior and makes formulas independent of an assumed append position. No existing inputs or formulas are rewritten. The full bounded goal grid is inspected, including trailing notes and out-of-table data; blank formatting alone is allowed.

While the matching hold is live, verification requires the exact receipt, raw goal values/formulas, no goal formula errors, effective target/date/account, linked balance and unchanged pre-existing input/formula baseline. Only a matching verified hold is cleared. A later status call after the hold has cleared verifies the exact original goal and receipt against its current linked balance; later unrelated goals/imports do not invalidate that historical recovery. A different operation's hold is never cleared. Altered original goal facts remain a conflict.

An authenticated `sheet_import_pending` error identifies goal holds only after validating the immutable goal manifest against the hold, and includes `protocolVersion`, `operation`, `schemaVersion` and `goal` for recovery. Native code stores this as recovery-only approval: it can check or cancel, never commit. Ordinary CSV and typed-source provenance skip only correctly bound goal receipts; a goal receipt cannot establish transaction/source identity.

The native review is stored with file protection, excluded from backup, and hidden on disconnect or when another Sheet is selected. Unresolved receipts survive disconnect; missing/corrupt local recovery blocks new creation. The configured hosted service is required for native saving. The Goals tab remains directly accessible when this development build has no service URL.

Single-process serialization governs this writer's clients. Google Sheets and Drive properties provide no compare-and-swap isolation against manual edits, other AI writers or another server replica. Readback detects conflicting changes; it does not claim to prevent outside edits. Do not deploy multiple writer replicas. Do not treat primitive or mocked tests as deployed service, second-user or app OAuth acceptance.
