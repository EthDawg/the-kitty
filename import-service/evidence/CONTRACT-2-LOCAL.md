# Contract-2 local acceptance — 5 November 2026

Implemented in the existing import service: combined CSV/document intake, exact original-byte
storage, reviewed typed records, raw v1/v2 targets, metadata collision refusal, accepted-evidence
provenance and explicit month close. The same per-Sheet queue, Drive hold, fixed-ID intent,
receipt and cancellation state machine govern both contracts.

Run from the repository root:

```sh
node --test import-service/*.test.mjs native-core/records.test.js native-core/close.test.js service/server.test.mjs
```

126 local tests passed: 58 prior transaction cases, 32 typed writer/reader cases, 31 shared typed
core cases and five gateway cases. HTTP tests bind temporary loopback listeners. The writer tests
use an in-memory provider boundary; request/reader tests exercise production Google request
construction and parsing with fictional responses. They do not prove hosted execution or OAuth.

Observed fixture results:

- December and January originals produce nine payslips and sixteen signed valuations, preserving
  exact amounts on v1 Payslips/Valuations and v2 Payslips/Entries. A new preparation of those same
  records has zero new financial rows.
- The real November fictional snapshot's 825 transactions project to all six recorded account
  balances, using the account opening date boundary and exact minor units.
- Valid header-only CSV plus reviewed statement evidence persists an evidence-only receipt.
  A missing statement or omitted nonempty CSV transaction is rejected.
- Generated empty-row-2 requests shift only Payslips A:G plus I, or v1 Valuations A:C plus F.
  They do not move H or D:E helper anchors; literal source text is never a formula.
- Lost write responses reconcile via receipts. An uncertain write intent is not replayed. Shared
  holds survive timeouts and release only after matching receipt/facts verification. An unrelated
  appended row does not prevent recovery, while changed inputs, IDs, formulas or holds do.
- Close writes As-of plus a receipt only after source preflight. Failed postflight counts/balances
  leave the new As-of visibly unresolved, with no rollback/replay. A successful readback must name
  `verified_close`; evidence intake never makes that claim.

No live Google mutation was performed for this slice. The prior [synthetic provider test](LIVE-ACCEPTANCE.md)
proved a v1 transaction insertion primitive only. Document metadata initialization, binary Drive
uploads, v2 valuation writes, actual formula recalculation, a real hosted close, cross-account
evidence permissions and native app OAuth still need provider acceptance. Sheets and Drive do not
provide cell/property compare-and-swap; deploy one writer process and respect the documented
external-editor limitations.
