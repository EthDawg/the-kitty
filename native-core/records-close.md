# Shared typed intake and close boundary

`sheet-contract.js`, `records.js` and `close.js` are pure ES2020 UMD modules. They perform no
network request, file write, clock read or Sheet mutation. Node uses `require`; JavaScriptCore loads
them in that order and receives the globals `SheetContract`, `Records` and `Close`. Results are fresh
JSON-compatible objects. The native app and authenticated writer run the same rules.

## Contract and authority

`SheetContract.describe(1 | 2)` describes exact raw columns, headers, formula protection, metadata
columns and the one close input. Unknown versions fail. In v1, transactions are A:J, payslips A:G,
and valuations A:C. In v2, transaction and valuation entries use Entries A:T, with T and V ID
namespaces; **Valuations is a formula view**. Payslips remain raw A:G. Payroll H, v1 valuation D:E,
Entries U and all view formulas stay protected. Reserved record metadata is `Kitty record ID` in
Payslips I and v1 Valuations F. An absent header does not authorize overwriting occupied cells.

The writer owns authentication, raw source-byte SHA-256 verification, exact Sheet header/formula
validation, metadata initialization, ID allocation, concurrency, immutable manifests, receipts,
current-row readback and post-close formula verification. These pure modules do not authenticate
files or prove that a person reviewed a document. Original-file metadata and every reviewed source
selection become part of the writer's proposal digest. See
[`import-service/CONTRACT-2.md`](../import-service/CONTRACT-2.md) for transport and lifecycle.

## Records

```js
Records.prepare({files, records, baseline, review})
// {version:2, records, issues, canCommit, counts}
```

`files` are `{id, name, mimeType, byteLength, sha256?, text?}` normalized original metadata.
`id` is the lowercase SHA-256 of original bytes; the service must independently verify it. The
native preview may also retain `bytesBase64`. Quotes in supplied original text must occur verbatim;
binary/manual review can identify a page without inventing text. Limits: 20 originals, 5 MiB each,
1,000 records per proposal. All money is a canonical signed integer minor-unit **string**, bounded
at 99,999,999,999,999 minor units. No floating currency arithmetic or currency conversion occurs.

Every record contains:

```js
{
  kind: 'payslip' | 'valuation' | 'statement_balance',
  recordId: 'stable-proposal-id',
  fields: { /* one of the typed shapes below */ },
  sourceRefs: [{id:'s1', fileId:'<raw SHA-256>', page:1,
    basis:'current-period', bbox:[0,0,1,1]}],
  extraction: {method:'manual', version:'1'},
  confirmedFields: {
    fieldName: {value:'<exact current field value>', sourceRefIds:['s1']}
  }
}
```

References may use one-based `page`, one-based `line`, a verbatim `quote`, and a normalized
`bbox:[x,y,width,height]`. At least page, line or quote is required. IDs identify immutable source
references within that record; editing any value or source selection must clear the native
confirmation. Every present field—including mappings, optional arrays and context—needs an exact
value confirmation and valid source references. A name-only acknowledgment cannot approve fields.
Extraction metadata records how a proposal arose; it is not an accuracy or OCR-verification claim.

| Kind | Required fields | Optional fields |
|---|---|---|
| payslip | payDate, person, employer, currency, valueBasis=`current-period`, grossMinor, taxMinor, superMinor, netMinor | periodStart + periodEnd, deductions, reimbursements, ytd |
| valuation | date, itemId, currency, valueMinor, valueKind=`asset` or `liability` | sourceMethod=`statement`, `appraisal`, `market` or `estimate` |
| statement_balance | accountId, periodStart, periodEnd, currency, openingMinor, closingMinor, balanceKind=`statement-close`, balanceConvention=`money-in-positive` | none |

Payslip deductions/reimbursements are arrays of `{label,amountMinor}` with nonnegative adjustment
amounts. Exact net is gross minus tax minus deductions plus reimbursements. **Employer super never
reduces net**. Current amounts and adjustments must point to references marked `current-period`.
Optional `ytd` contains explicitly named grossMinor/taxMinor/superMinor/netMinor fields and must point
to `ytd` references. It never supplies current-period values. The Sheet's raw A:G has no adjustment
columns, so the accepted source manifest retains that explanation for later verification.

Assets are nonnegative and liabilities nonpositive. Unknown person/item/account/currency, a ledger
account presented as a valuation, and a conflicting same-date valuation all block intake. Statement
balances are signed observations: held positive, owing negative. Available balance and minimum due
are not statement closing balances. Statement observations are evidence only; no Accounts balance
write is produced.

`Records.identity(record)` returns a canonical logical tuple independent of caller IDs:
pay date/person/employer; valuation date/item; or account/statement period. `Records.sheetFields`
returns exact raw financial facts. Same identity plus matching raw facts is `already-present`, and
can attach evidence without appending. A different value is a conflict; duplicate raw identities
remain unresolved. Separate payslips from one employer on the same date are intentionally ambiguous
until the Sheet contract can identify them individually. No merge or overwrite is guessed.

Outputs retain the full confirmed record with disposition `append`, `already-present` or
`evidence-only`. Counts are `new`, `evidence`, `alreadyPresent`, `payslip`, `valuation`,
`statement_balance`, `errors` and `review`. Issues use `{id,code,severity,message,recordIds}`.
`validateFields` and `validateRecord` are structural helpers; they do not confer write permission.

## Canonical baseline

The writer supplies this from the selected, authorized Sheet. The app can supply a fictional
equivalent for preview, but a client baseline never authorizes a server write.

```js
{
  schemaVersion: 1, currency:'AUD', asOf:'2027-01-31', people:['Alex'],
  accounts:[{id:'A', currency:'AUD', ledger:true, openingMinor:'100000',
    openingDate:'2026-06-30', status:'active', balanceMinor:'...'}],
  items:[{id:'HOME', currency:'AUD', kind:'asset', method:'estimate', valuationRequired:true}],
  transactions:[{id:'T1', date:'2027-02-10', accountId:'A', amountMinor:'80000',
    categoryId:'SALARY', person:'Alex', status:'posted', transferGroup:''}],
  payslips:[{kind:'payslip',recordId:'raw-id',fields:{/* canonical fields */}}],
  valuations:[{kind:'valuation',recordId:'raw-id',fields:{/* canonical fields */}}],
  projectedBalances:[{accountId:'A',date:'2027-02-28',amountMinor:'180000'}],
  checks:[{id:'recorded-check',type:'Close',status:'OK',items:0,message:'...'}],
  unresolvedReviews:[], categories:[{id:'SALARY'}]
}
```

The opening anchor is end of the opening date. Posted movement must come after it; overlapping
anchor history is unresolved. Status is explicit: posted/settled count; pending/cancelled do not.
Every non-ledger account must have a corresponding valuation item. Relevant ledger accounts include
ones with no activity and closed accounts without a known earlier closure date. Required valuations
default to all items unless the authoritative baseline explicitly marks `valuationRequired:false`.
Arrays and missing values are never silently replaced by a successful empty close. A current
Accounts balance is not a substitute for a target-date projection.

## Close preflight

```js
Close.prepare({periodEnd, baseline, evidence:{imports:[
  {importId,proposalDigest,receiptVerified:true,records:[/* accepted typed records */]}
]}, review})
```

Only the service constructs this evidence envelope, after loading immutable manifests, verifying
their accepted receipts and original files. `receiptVerified` is an assertion by that trusted
adapter, not a client credential. Accepted payslips and valuations must still match exact current
Sheet facts. Conflicting evidence, missing origins or changed fields cannot be waived.

This version preflights the immediately next full calendar month after a known month-end As-of.
Skipping periods or closing from a midmonth As-of returns unresolved; it does not assume a missing
opening period. Every relevant ledger account needs a source-backed statement covering that exact
period. Four independent comparisons are retained: canonical opening vs statement opening,
statement opening plus posted movement vs closing, canonical closing vs statement closing, and
target-date projected balance vs that canonical closing.

Every period payslip needs accepted evidence and salary matching; every salary deposit needs an
evidenced payslip. A unique same-person, same-day, exact-net deposit can match automatically.
Splits and timing differences require explicit groups:

```js
review.salaryMatches = [{payslipRecordIds:['pay-1'], transactionIds:['T1','T2'],
  reason:'This payslip was split across these two deposits.', allowTiming:false}];
review.transferPairs = [{transactionIds:['T3','T4'],
  reason:'Reviewed the two sides of this bank transfer.'}];
```

Groups cannot reuse records. Pay net must exactly equal the deposit sum. Timing differences require
`allowTiming:true`; person conflicts still block. Transfer groups require two nonzero, opposite
amounts on distinct accounts in the same currency. A pre-existing transfer ID can establish the
pair; conflicting IDs cannot be overridden by an opposite amount. V1 has no pairing IDs, so it
needs explicit pair review. A global zero net is never sufficient.

Specific uncategorised transactions, baseline reviews and noncritical recorded Sheet reviews
produce stable issue IDs plus an `evidenceKey` containing the exact canonical facts. To acknowledge:

```js
review.decisions[issue.id] = {action:'acknowledge', reason:'Why this exact item is deliberate.',
  recordIds:issue.recordIds, evidenceKey:issue.evidenceKey};
```

A blanket acknowledged list has no effect. Changed facts invalidate the decision. Missing sources,
failed reconciliation, unknown/repeated IDs and failing recorded Close checks remain errors.

The result is `{version:2,periodEnd,periodStart,expectedAsOf,targetAsOf,postCloseRequired:true,
checks,issues,canClose}`. Checks use `{id,code,status:'pass'|'unresolved',message,recordIds}` and may
include expectedMinor/actualMinor. `canClose` means this preflight permits the writer's proposed
As-of change. It **does not mean the month is closed**. The writer must prove the exact write,
preserve formulas, reread target-period balances/Close checks and `close.items_missing`, then issue
a verified close receipt. Intake alone never changes As-of.

## Evidence and limits

Run `node --test native-core/records.test.js native-core/close.test.js`.
Tests cover exact cents, source confirmation, current/YTD separation, employer super, evidenced
deductions, valuation conflicts, no-activity accounts, statement equations, split/timing salary,
actual transfer pairs, stale reviews, invalid inputs and non-Node UMD execution.

The existing fictional December 2026 / January 2027 CSVs verify 9 payslips and 16 signed valuations
without changing their values. A reconstruction using their current ledger and raw records still
returns missing statement and transfer-pair evidence; the old global-net/checks-OK result cannot
be promoted to a verified close. Synthetic complete evidence covers the success path. These tests
are not hosted-service, live-provider, real-document extraction or physical-device acceptance.
