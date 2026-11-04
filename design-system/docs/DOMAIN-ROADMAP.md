# The nearest useful release, and the seams after it

Ship an everyday-money foundation that can answer: **What needs my attention, where did this amount come from, and what can I safely do next?** A schema for future records is valuable. An empty tax dashboard or fabricated confidence score is not.

The default experience has four widgets: cash, next actions, recent activity and one goal. Keep existing Insights and Setup available. Optional modules belong in an Add widget library and remain off until requested; validated imports can suggest them once. Never automatically rearrange a user's canvas.

## Coverage and evidence

“Contract” means a design/data boundary, not a working accounting engine. “Fixture” means synthetic evidence for demonstrations, not a supported real-provider import. Existing Kitty functionality remains as described by its source; this pack does not silently promote it to a broader claim.

| Domain | Next valuable slice | Minimum evidence/model additions | Widget and drill-through | Release gate / current boundary |
|---|---|---|---|---|
| Everyday | Reliable bank/card import, visible exception review, reconcile, goal progress | Account/owner/currency; raw narrative; signed amount; posting state; source hash/row; transfer/refund relationships | Cash → accounts → source; activity → transaction → original row; goal → linked account | First supported slice. Core source adapters exist; new demo uses local fixtures. Live Sheet readback still must be proven after integration. |
| Tax readiness | Evidence completeness for a selected taxpayer and financial year | Explicit checklist/version, owner, tax year, linked documents, missing/reviewed state, reviewer notes | “7 of 9 requested records collected” → missing records; never “78% tax compliant” | Experimental contract. No return lodgement, deduction decision or calculated refund. |
| Property | One PPOR plus two investment properties, with separate evidence and cashflows | Property ID; effective-dated ownership/use periods; loan IDs; gross rent, agent fees, net remittance; expenses; valuations with date/method | Per-property cashflow bridge → source statement/loan; missing evidence | Contract + synthetic examples only. Negative cashflow is not automatically a deductible rental loss. Cashflow and tax-adjusted result stay distinct. |
| Equity: RSU / ESPP / personal | Event and evidence timeline before performance analytics | Instrument ID/currency; owner; plan type; grant/vest/purchase/sale event; units; cost/proceeds; fees; FX evidence; lot relationships; employer ESS statement | Holding summary → event → statement/contract note | Contract only. Do not infer tax treatment, cost base or ESS discount from a brokerage deposit. |
| Crypto | Import and identify gaps/own-wallet transfers | Chain/asset identifier; wallet/account; event and counterparty; quantity; transaction hash where applicable; fees; timestamp; AUD valuation evidence | Positions → events → unmatched transfer/source | Contract only. No automatic CGT or fabricated zero cost basis. Never request or store wallet private keys or seed phrases in Kitty. |
| Super: retail + SMSF accumulation | Separate member balance/contribution evidence | Fund/legal entity; member; fund type; accumulation phase; dated balance; contributions; reported tax components; valuation source | Member balance → dated statement; contribution evidence | Contract only. SMSF remains its own entity; avoid double-counting fund assets and member interests in household wealth. No pension/SMSF compliance engine. |
| Insurance: health/car/home | Renewal visibility and searchable policy evidence | Policy/provider; covered people/assets; coverage period; premium frequency/currency; excess; renewal date; source schedule | Renewal timeline → policy record/document | Contract + fixture. No claim of adequacy, best cover or coverage interpretation from a summary. |
| Assets: car/laptop | Owned-item register and optional replacement plan | Asset/owner; receipt; purchase date/cost; warranty; condition; explicit desired replacement date and budget | Asset card → evidence; replacement plan → assumptions | Contract + fixture. Planned spend is labelled estimate, not depreciation, market value or a recommendation to replace. |

## Delivery sequence

1. **Now: trustworthy everyday loop.** Import bank/card fixtures, inspect raw narratives, resolve an ambiguity, view consistent account/transaction amounts, reread the local Sheet-shaped output, retry without duplicates. Apply the component library to one existing screen before broad styling. Evidence states and accessible interaction are release requirements.
2. **Validate next: tax evidence + one property.** Add document links and clear evidence gaps. Reconcile gross rent minus agent deductions to net bank remittance without counting both as independent income. Use a separately identified PPOR and investment property; test a second investment property with different cashflow. Tax-adjusted conclusions remain withheld until a reviewed method exists.
3. **After that: policy renewals and replacement plans.** These reuse documents, owners, assets, dates and goals with little new calculation risk. Validate that reminders create useful action rather than noise.
4. **Later, when justified: equity, crypto and super.** Add event/lot/entity models one at a time with domain fixtures, independent accounting oracles, precision/FX rules and specialist review. Their existence in a registry does not make them production features.

## Release gates that decide scope

A widget ships only if it has: one user question, named canonical source, explicit required inputs, all six data states, source drill-through, one useful action, small-screen and keyboard acceptance, and a testable financial oracle. Each mutation has review, precise target, write receipt and readback. Each import has duplicate/retry/correction cases. Each chart has text values, units, period and meaningful missing-data handling.

Experimental modules require the same source/privacy boundaries. “Beta” is not permission to show invented totals. If a domain cannot meet its oracle, show evidence records and missing fields only. Remove a widget if it duplicates a more direct answer, cannot explain its number, or has no action beyond admiration.

## High-value experience hypotheses

- Merchant clarity: preserve original narrative beneath a reviewed friendly name. Use deterministic monograms as fallback, not unverified remote logos. Category is editable with provenance; do not use merchant identity as a tax conclusion.
- Cleanup: a bounded review queue shows why a row needs review, source evidence, suggested change and effect. Offer Accept/Change/Skip; no bulk silent guesses. Preserve work after errors.
- Subscription usefulness: after the user opens a subscription, optionally ask “Still useful?” with Keep / Review / Not now. Store a self-reported preference, not an inferred wellbeing score. Do not label spending wasteful, gamify streaks or interrupt every transaction.
- Ask Kitty: a question has a visible context scope; answer separates observed facts, uncertainty and proposed action. It cites the relevant data period/source. Skill invocation explains what it will read/write and waits for the normal action authority. Demo answers stay labelled demo, never pretend to call Claude.
- Adaptive canvas: offer relevant modules; remember the user's layout. Dragging has move buttons, resizing has named sizes, order is keyboard-accessible, reset is reversible. A source update does not unexpectedly shuffle the page.

These are product hypotheses to test with people, not research-proven improvements or claims of measured savings.
