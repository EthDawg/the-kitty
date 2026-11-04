# Kitty boundary contracts v1.0

These are pure JavaScript runtime validators, not a claimed full JSON Schema or production integration. They validate new staging/display envelopes. They do not replace the existing Sheet model, call a service or mutate application state.

```sh
node --test design-system/contracts/contract.test.mjs
```

- `kitty-contracts.mjs`: exported validators and explicit module-activation policy.
- `examples.json`: copyable shapes. Hashes and references are illustrative, not verified source files.
- `modules.json`: domain seams and minimum invitation gates; non-everyday modules remain experimental.
- `contract.test.mjs`: precision, provenance, dates, states, pending/posted, missing/zero, duplicate identity and opt-in tests.

Integration: validate at import staging, map accepted records to the existing Sheet through a reviewed adapter, reread, then validate a display envelope before rendering. See `../docs/DATA-FOUNDATIONS.md`. File-hash verification, referential checks against the real account registry, ownership authorisation, financial reconciliation, duplicate matching across overlapping exports, schema migration and provider writes require application/importer services beyond these shape checks.

Do not directly pass this envelope into existing Kitty component or engine functions. Adapt deliberately: they currently consume legacy numbers and fields, while this boundary uses exact monetary strings. Money-metric v1 is money-only; percentage/count charts need their own typed contracts. Validators return error strings suitable for diagnostics; production error copy should be mapped to concise field-specific messages.
