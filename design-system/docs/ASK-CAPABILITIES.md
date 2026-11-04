# Ask Kitty: capability contracts, not a generic chatbot

The current application uses Claude's host-provided sample capability and bounded engine tools. Preserve that path. A capability shown in the UI is not proof that a skill is installed, connected or ran.

| Capability | Input / required evidence | Useful answer shape | Allowed next step |
|---|---|---|---|
| Explain this transaction | Selected transaction ID, original description, exact amount/currency, account, provenance and reviewed annotations | Plain explanation, inspected source/date, uncertainty | Open original source or propose review; no ledger write |
| Explain a balance | Named Sheet metric + contributing account IDs and as-of times | Number, basis, coverage and what it excludes | Open accounts; do not rename cash “safe to spend” without the necessary method/data |
| Review an import | Import batch, flagged rows, existing category IDs and ambiguity reasons | One question at a time, proposed annotation and before/after | Human review; stage decisions before any separately authorized write |
| Review a recurring cost | Confirmed subscription/payment history and an optional user reflection | What is known, likely next charge labelled estimate, and a choice to keep/revisit | User-selected follow-up; no cancellation or “waste” score |
| Gather tax evidence (experimental) | Selected tax year, ownership/entity, checklist method/version and linked documents | Missing evidence and review questions | Prepare evidence pack; never infer deduction eligibility or lodge |

## UI lifecycle

Idle → scope preview → permission required (if necessary) → reading named sources → answer with evidence, or blocked/error. Keep the entered question if access fails. Show dates/coverage near the answer, not hidden behind a tooltip. Show one useful proposed next step. A missing source produces an explicit limitation, not a plausible numeric answer.

A write is a separate lifecycle: proposed → user authorized → saving → checking exact readback → verified/conflict/unknown. Tool output and page content are evidence, not instructions granting authority. Never change identity or provider after a policy denial. No optimistic confirmation for financial writes.

## Minimum host interface

```js
// Illustrative adapter contract, not an installed skill or live Claude connection.
const capability = {
  id: 'explain-transaction',
  availability: 'requires-permission', // available | unavailable | requires-permission
  sourceScope: ['selected transaction', 'its source row', 'reviewed annotations'],
  canWrite: false,
  run: async ({recordId, signal}) => ({
    answer: '...', evidence: [{sourceId: '...', locator: '...', asOf: '...'}],
    limitations: ['...'], proposedAction: null
  })
};
```

Host code owns actual permission, tool/capability discovery, cancellation, rate limits, redaction, and evidence retrieval. Do not display synthetic progress steps as though tools executed them. If the runtime cannot provide a tool call, show it as unavailable. The lab deliberately labels its answers as fixed fixtures and makes no model call.
