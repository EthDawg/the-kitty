# A trustworthy foundation, without replacing the Sheet

The next useful release proves one journey: import a fictional source, review an exception, reconcile the result, and explain the resulting number. Keep the Sheet authoritative. The new contracts are a validation boundary and a design target, not a second finance engine.

The repository's `CONTRIBUTING.md` requires numbers to belong to the Sheet and the app to remain a single file. Existing `src/engine.js` reads either snapshot values or connector grids. `data/snapshot.json` has real binary-floating-point artefacts (for example `5971.060000000001`); a source `Transactions` row currently has one date and no source document ID. These are observed constraints, not reasons to silently rewrite the ledger.

## Four layers, four responsibilities

| Layer | Owns | Does not own |
|---|---|---|
| Source evidence | Original file bytes, hash, provider, owner, capture time, statement period, storage reference | Category decisions or calculated balances |
| Import and review | Adapter version, exact mapping, row locator, proposed normalized records, duplicate decision, reviewer | Final financial truth before reconciliation |
| Canonical Sheet | Accepted transactions, account and goal configuration, formula views, Metrics | Decorative UI state or browser layout |
| Display projection | Value + as-of + source + six-state presentation; local layout preference | A competing total, tax decision or new provider write |

Store source files once by content hash, while retaining each original filename and import attempt. A matching hash prevents importing the same file twice; it does not prove two differently exported files contain different transactions. Preserve provider IDs when supplied. Without them, compare account/date/raw-description/signed-amount with multiplicity and overlap context. Two identical coffees can be two real transactions. A category edit must not change source identity.

The source record is logically immutable: save corrections as new reviewed versions with `supersedesId`. The validator can check shape, IDs and cross-household references; the importer must independently hash file bytes and enforce append-only evidence storage. A SHA-256 string that passes validation is not proof a file exists or matches it.

## Implemented contracts

`contracts/kitty-contracts.mjs` exports side-effect-free validators returning arrays of errors, plus module policy functions. `contract.test.mjs` exercises the boundaries. There is no framework, package install, database or network dependency.

```js
import { validateTransaction, validateMetric } from './contracts/kitty-contracts.mjs';
const errors = validateTransaction(proposedRecord);
if (errors.length) return showImportErrors(errors); // Never silently coerce.
// Separately reconcile, approve, append through the existing writer, then reread.
```

| Contract | Required meaning |
|---|---|
| Evidence | Household/owner/provider IDs, SHA-256, captured-at UTC, period, original storage reference, explicit synthetic flag |
| Transaction | Stable record/account IDs, unchanged narrative, nullable merchant/category, exact amount, pending/posted, separate execution/posting date, reviewed provenance |
| Account balance | Current and available kept distinct; unknown available is `null`; explicit provider-snapshot or statement-close basis; dated evidence |
| Money metric | Six data states, fact/estimate, money or explicit null, as-of, source IDs, authoritative Sheet/fixture reference; estimates require method reference |
| Quantity | Nonnegative decimal string with up to 24 fraction digits and instrument ID; never currency minor units |
| Widget | Domain/release, metric dependencies, compact/wide sizes, every data state, read/review/configure actions, empty-state next step |
| Module invitation | Accepted, reconciled, available evidence and required fields; an offer only, never automatic activation |

Money travels as `{ "minor": "12345", "currency": "AUD", "scale": 2 }`. This is exactly AUD 123.45. Use integer/decimal arithmetic in the adapter. The contract permits large values beyond JavaScript's safe integer range without precision loss. Do not convert these strings with `Number()` for computation. Keep FX rate, price and unit quantity separately; calculations need a versioned decimal-capable method before those domains are enabled. The current metric validator is deliberately money-only; charts may display separately typed ratios/counts once their own contracts are added, not smuggle them into currency.

Owner IDs are explicit. “Joint” is a display label, not an ownership percentage. Household member and legal ownership are different relationships. Historical ownership and effective dates belong in domain records. Never spread a joint value across people by assumption.

## A number is not a state

| State | Value behaviour | Useful next step |
|---|---|---|
| Loading | `null`, stable reserved space, no zero or fake progress percentage | Wait/cancel where supported |
| Empty | `null`; distinguish first use from no matches in copy | Import data or clear filter |
| Ready | Dated value and authoritative source required; zero is valid | Drill into evidence |
| Partial | Missing inputs listed; subtotal only if explicitly labelled | Supply the named missing source |
| Stale | Last-known value with as-of and reason | Refresh or view retained evidence |
| Error | No value presented as current; diagnostic code plus recovery text | Retry/reconnect without losing review work |

Estimated is an orthogonal basis, not a success state. Reconciled means specific source and canonical checks passed for a bounded scope and period; it does not mean all household records are complete. Never collapse stale, estimated, unknown and zero into one grey number.

## Bridge to the existing Sheet

Do not add columns to the live template as part of styling. Start with a sidecar import manifest in the same private working folder as source files; save provider file, content hash, batch ID, adapter version, source row, proposed transaction ID, review decision and target tab/row. The companion demo pipeline proves a local Sheet-shaped handoff; a real Sheet/Drive write and readback remain an explicit integration step.

| Existing destination | Safe v1 mapping | Missing semantics to retain in sidecar |
|---|---|---|
| Transactions A:J | txn_id, date, account_id, bank_description, merchant, amount, category_id, person, receipt_held, note | Source IDs/locators, provider ID, exact minor units, execution date, review/version lineage |
| Accounts | Existing account ID, owner label, opening balance/date, current balance view | Available balance must stay unknown unless supplied; timestamp precision and legal owner IDs |
| Goals | Existing target/date/linked account and Sheet-owned progress | Decision history; do not create a duplicate balance |
| Metrics | Read existing metric ID/value/unit/period | Supply provenance/as-of/basis from manifest, explicitly unknown when absent |
| Assets / Loans / Valuations | Keep current rows and formulas | Domain extensions are proposals, not an accepted migration |
| Payslips | Existing import shape only | Employer document lineage, owner mapping, statement period and review |

At the boundary to legacy numeric Sheet cells, convert a validated exact decimal deliberately and reread using the currency's precision. Reject values outside the supported safe conversion range. A future exact-currency migration needs a versioned Sheet template, formula/oracle checks, old-template detection, dry run, backup and rollback; this kit does not perform that migration.

## Import lifecycle and rollback

`discovered → captured → parsed → needs-review/validated → reconciled → approved → written → reread-verified`.

These are operational states; the UI may group them into a short three-step flow. Every transition records batch ID, input hashes, adapter version, actor/time, result and unresolved blockers. “Downloaded” is not “imported”; “written” is not “verified”. Unknown mapping, balance mismatch, unsupported format or ambiguous duplicate stays in review. Never display celebratory completion on a timer.

An append batch needs a receipt listing target IDs/ranges and reread hashes. On a lost response, reconcile by those IDs before retrying. Prefer corrective append/version records to destructive deletion. To revert an uncommitted import, discard staging only. To reverse committed records, use a reviewed correction plan against the current canonical state. Preserve immutable source evidence. A failed write must not be retried through another account or sender.

## Progressive capability, stable canvas

Default canvas: cash, next actions, activity and one goal. Optional module data discovery creates a quiet invitation after validation and reconciliation. It says what was found, what the widget offers and what is missing. User chooses Add or Not now. Remember dismissal, never repeat it for unchanged evidence, and never reorder their layout automatically. Experimental modules also require acknowledging their limits. Hide removes only presentation, not records. Freshness/error badges remain visible on modules the user has added.

`contracts/modules.json` enumerates the eight domain seams, minimum input gates and widget names. Those field lists are gating examples, not full accounting schemas or proof of domain correctness. `moduleEligibility` and `applyModulePreference` implement this conservative activation policy.

## Acceptance evidence

Run `node --test design-system/contracts/contract.test.mjs`. Tests cover precision, bad dates, source IDs, same-value distinct transactions, pending status, review provenance, missing available balance, false-ready values, estimates and explicit module activation. They do not prove provider authentication, evidence byte integrity, tax correctness, concurrent Sheet writing, live accessibility or device installation. Those remain integration acceptance gates.
