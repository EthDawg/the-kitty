# New household setup

This module creates a new user-owned workbook from the pinned `au-aud-basic` v1 generator in `templates/build.mjs`. It does not copy the public Davies workbook, change an existing household, or seed fictional financial records. Opening balances are signed, explicit inputs; the generator defines the supported domains and unavailable views.

Run through `node service/server.mjs` on Node 22 or newer. The gateway and Docker image include setup, imports and Ask under one configured HTTPS origin. Keep **one process/replica**, retain the pinned template version for pending setups, and use the app's existing Google `drive.file` authorization. No setup secret, database, refresh-token store or service account is needed. The bearer token is used only during its request. There are no body/token logs or browser CORS endpoints. Hosting access logs must not record credentials or request bodies; operation IDs and digests are private recovery data too.

## Native API

All routes require `Authorization: Bearer <Google access token>`; POST requests are JSON objects, limited to 64 KiB. The app must persist the exact reservation and approved input **before** calling `begin`, including across disconnects. It must not allocate a replacement reservation to resolve an unknown result.

| Route | Input |
| --- | --- |
| `POST /v1/setup/reserve` | `{input}`; validates the deterministic template and allocates three Drive JSON-file IDs, without creating files |
| `POST /v1/setup/:setupId/begin` | `{proposalDigest,createIntentId,initializeIntentId,input,approval:true}` |
| `POST /v1/setup/:setupId/continue` | `{proposalDigest,approval:true}`; uses an existing verified manifest |
| `GET /v1/setup/:setupId/status` | Query `proposalDigest`; reads only |
| `POST /v1/setup/:setupId/cancel` | `{proposalDigest,createIntentId,initializeIntentId,ownerPermissionId,input}`; use the immutable reservation's normalized input |

`reserve` returns `setupId`, `createIntentId`, `initializeIntentId`, `proposalDigest`, `ownerPermissionId`, `sourceSha256`, `inputSha256`, `normalizedInput`, `reviewSummary`, `status:"reserved"` and `phase:"manifest"`. The owner is the authenticated Drive permission ID, not an email address. The input SHA is SHA-256 of recursively key-sorted canonical JSON; array order is retained. The proposal SHA commits to the entire versioned manifest, including all three IDs, owner, normalized input and exact generated plan.

Every lifecycle result echoes `setupId`, `proposalDigest` and `ownerPermissionId`, plus `status`, `phase`, `canContinue`, `canCancel`, optional `sheetId`, and `issues:[{code,message}]`.

| Status | Meaning / permitted next step |
| --- | --- |
| `prepared` | Manifest is present, no create intent exists; continue or cancel |
| `created` | One matching owned blank workbook exists, no initialization intent; continue |
| `unknown` | A read, creation, initialization or recalculation outcome is not verified; retain the reservation and check again |
| `conflict` | Identity, content, structure or access differs, or multiple workbooks match; retain evidence and resolve the conflict |
| `verified` | Exact inputs/formulas, required formats/validation, empty raw tables, current access and recalculated opening checks passed; `phase:"complete"` and `sheetId` are required |
| `cancelled` | A competing cancellation tombstone was read back before any creation intent; no workbook is deleted |

`canContinue` is true only for `prepared`/`created`, and `canCancel` only for `prepared`. The app can also **attempt** bound cancellation when it has only a local reservation or an unknown outcome: the service remains authoritative and returns `unknown` if creation might have started. Before the manifest exists, cancel rebuilds the approved plan to prove that the supplied intent IDs belong to its proposal digest. This request does not store the household input. A missing-manifest GET remains 404; repeating the same cancel request safely reads back a tombstone after a lost response. Never interpret 404 as permission to forget an uncertain reservation.

## Durable recovery and verification

The immutable manifest and two immutable intent bodies are JSON files in the user's My Drive. Omitted `parents` place new files in My Drive; `ignoreDefaultVisibility=true` is requested. Every record and workbook must read back as editable, owned by the authenticated user, outside a shared drive, with the expected marker and a complete owner-only permission list. This new-household rule does not change collaborative access for existing-household imports.

Google supports generated IDs for JSON files but not new Workspace spreadsheets. The service first creates a known-ID creation intent. **Only the request that receives and verifies that intent's successful creation may POST a workbook.** A 409, timeout, existing intent or zero-result search never authorizes another workbook POST. Complete paginated marker searches reconcile the result; multiple or incomplete results remain unresolved. A definite returned workbook ID is retained as `kittySheet` recovery metadata on the create-intent file, without changing its body/digest. That exact ID still requires current ownership, marker and permission verification.

Initialization follows the same one-shot rule with its separate intent. The service reads the entire new workbook, refuses existing content or tab identity collisions, then uses one Sheets batch to add the generated tabs and finally remove only the observed empty default tabs. A lost batch response is reconciled against exact expected cells and formulas; the `addSheet` batch is never blindly replayed. Calculation errors and wrong/missing effective opening balances are not success. The known `Kitty.public_feed` setting must read explicitly `no`; this is not a claim about every possible sharing or script mechanism.

Full reads are bounded to 50 tabs / one million cells and recheck workbook shape after reading. They are not a Sheets compare-and-swap lock. Do not edit/share the new workbook or delete/modify its setup records while setup is pending. A process crash after the one-shot intent but before dispatch can leave an unresolved operation with no workbook; the service deliberately does not guess that replay is safe. Template upgrades must retain the original supported generator for pending manifests, or those setups remain blocked rather than executing a changed plan.

## Evidence limits

`node --test setup-service/*.test.mjs service/server.test.mjs` covers mocked crashes/timeouts, lost responses, wrong identities/digests, cancellation before begin, late begin, marker pagination, permission changes, tampered plans, initialization content and gateway isolation. The real pinned generator is validated against setup bounds. These checks do **not** prove live Google creation, native OAuth, actual Sheets recalculation or a hosted service deployment. No live provider write was used for this implementation.

Google references: [generated IDs and retry-safe file creation](https://developers.google.com/workspace/drive/api/guides/create-file), [Drive file creation and visibility](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/create), [authenticated user metadata](https://developers.google.com/workspace/drive/api/reference/rest/v3/about/get).
