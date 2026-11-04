# Implementation brief: a trustworthy household money canvas

Build the next useful version of The Kitty: a calm, clear place for a household to understand its money, resolve what needs attention, and see the evidence behind the answer.

The ambition is broad. The next release must be deliberately small and complete. Success is a person getting from a realistic source document to a reconciled, understandable result without losing the original evidence or needing to trust a black box.

Use this repository's existing Sheet model, import adapters, pure engine, single-file app and tests as the starting point. Read CONTRIBUTING.md and the design-system documentation. Do not replace working foundations simply to introduce a fashionable framework.

## The next release

Prove one complete everyday-finance journey:

1. Open a clearly fictional Davies provider portal, choose the account and period, and download its source CSV.
2. Import it into a review area. Preserve the original file, its hash, provider, account, period, row identity and adapter version. Show what was accepted, rejected, already present or needs a person.
3. Resolve an unfamiliar merchant or ambiguous category with a clear before/after comparison. Keep a correction reversible and distinct from the source fact. A possible duplicate is a review item, not a guaranteed refund.
4. Commit only the confirmed rows through the established write path. Reread the destination and compare it with the expected result. A successful request is not enough. A lost response requires reconciliation before retrying.
5. Show the result in a small home canvas: cash position with its exact basis, next useful actions, recent activity and one chosen goal. Every number can drill through to its owning rows and source evidence.
6. Repeat the same import and prove nothing is added. Preserve genuine same-day identical charges and match transfers without counting them as income or expenditure twice.

The demo portal and local harness in this branch prove a bounded offline contract. They do not prove Google Sheets or Drive delivery. Extend the final leg only in an explicitly selected synthetic destination, verify the actual provider readback, and report local, attempted, written and verified states separately.

## Product principles

- Default to a small working product. Do not show empty modules for every possible financial domain.
- Import evidence may make a module available. Offer one quiet explanation of what was detected and why the module might help. Adding it is a visible, reversible choice. Never silently reorder the user's canvas or activate experimental tax conclusions.
- Keep financial facts, estimates, interpretations, intentions and completed actions separate. Missing data is not zero. Current balance is not necessarily available to spend. A goal allocation is not a separate account balance to add to net worth.
- A concise next action is more valuable than a dashboard of warnings. Prioritise actionable issues with evidence, materiality and a clear owner; let the user defer or dismiss them without shame.
- Make the transaction row excellent before adding more widgets. Show a stable merchant name or monogram, original description on drill-in, date, account, owner, category, status and exact signed amount. Merchant enrichment must never overwrite the raw description or load arbitrary tracking logos.
- Learning prompts are optional reflections, not scores. “Would you choose this again?” can offer Keep / Review later / Not useful. Do not infer value from transaction frequency, declare spending wasteful, or gamify debt and tax risk.

## Design and component contract

Use the Calm Kitty assets and semantic tokens. Preserve the distinction between brand colour and success, attention, failure or missing data. Use the existing typography with reliable system fallbacks, tabular figures, readable metadata and consistent amount alignment.

Reuse the delivered components and state contract. Each interactive component needs its data requirements, semantic HTML/ARIA, loading/empty/partial/stale/error behaviour, keyboard path, mobile layout, source drill-through and integration example. A screenshot alone is not a component.

Use bars for comparisons and trends with a labelled period. Use a ring only for genuine part-to-whole progress with a valid denominator and exact textual values. No decorative donut for an unconstrained balance or arbitrary confidence score. Preserve over-target amounts even if the visual ring is capped. Provide a text/table equivalent for charts.

Canvas layout is a preference, not money data. Support labelled move-up/down controls and compact/wide choices as well as drag where useful. Keep DOM, keyboard and visual order aligned; provide reset and undo where appropriate. Mobile reflows into a useful reading order. No surprise automatic reordering.

Motion must clarify an event. Use short entry and selection transitions, stable loading placeholders and a restrained one-time milestone effect after verification. Honour reduced motion and an in-app motion preference. Never count a balance up from zero, fake a progress percentage, or celebrate before readback.

Ask Kitty should be a useful, evidence-linked note: the answer, relevant facts, limitations and one next step. Show the source period and disclose what is sent before requesting permission. Keep read-only questions separate from proposed writes. Capability/tool use should show understandable steps and inspected evidence. An AI answer cannot grant authority, silently edit the ledger, claim an unexecuted skill ran, or turn a draft into a completed action. Clearly label all canned demo responses.

## Foundations that can grow

Define a versioned evidence envelope and a compact widget registry. Reuse stable household, person/entity, account, source document, import batch, transaction, review decision, valuation, obligation and goal identities. Money includes currency and explicit precision; security/crypto quantities are separate. Retain effective dates, observation dates and provenance. Never silently migrate the current Sheet layout or create a second unowned ledger.

Support later modules through typed contracts, evidence requirements and acceptance gates:

- Tax readiness: evidence completeness and review workflow first; no automatic deduction eligibility, lodgement or refund promise.
- Property: one PPOR and two investment properties as fixtures. Keep ownership, debt, rent, expenses and valuations separate. A cash-flow-negative property is not automatically a tax loss; “negative gearing” needs a reviewed tax calculation and assumptions.
- Shares: personal holdings, RSUs and ESPP preserve lots, grants, vesting/acquisition/disposal events, fees, currency and tax statements. Do not merge employer income and disposal gains.
- Crypto: wallet/exchange activity, quantities, transaction IDs, fees, transfers and dated valuations. Never store private keys or seed phrases.
- Super: separate retail accounts and SMSF entities, accumulation status, contributions and dated balances. A household portfolio view is not an SMSF compliance engine.
- Insurance: policies, insured entities, cover periods, premiums, renewal evidence and source documents. Reminders are not advice that coverage is adequate.
- Personal assets: ownership, acquisition evidence, valuation basis and a user-selected refresh plan. A planned upgrade is not a liability or tax depreciation rule.

These modules stay off by default. A registry entry and a fixture do not establish an implemented feature. Each module earns activation with validated input, a useful decision, a tested drill-through and a clear fallback when evidence is incomplete.

## Demo and verification

Use synthetic Davies data only. One provider portal may switch playful fictional brands, with visibly different export shapes. Start with the three existing bank/card adapters; add other provider documents as labelled evidence-only fixtures until their adapters and domain reconciliation are tested. Keep filenames, period selection and download controls deterministic enough for a browser agent to use. No real bank credentials, copied login forms or external financial actions.

Before declaring completion, demonstrate:

- Source download matches its manifest hash.
- Bank and card sign conventions normalise correctly; amounts reconcile in cents.
- Reimport adds zero rows; legitimate repeated charges survive.
- Invalid data is blocked with a specific correction path.
- Unknown, stale, pending and zero values remain distinct.
- A proposed write is not shown as saved; readback mismatch stays unresolved.
- Navigation, dialogs, selection, rearranging and resizing work by keyboard and touch alternatives.
- Light/dark appearance, 320/390px layouts, long names, large amounts, 200% text zoom and reduced motion remain usable.
- All existing app tests and the single-file build pass.

Record screenshots with captions and limits, exact commands and results, and any remaining provider/device checks. Do not infer customer value from feature count. Validate with a person completing the journey: can they explain the balance, resolve one ambiguity and find the original evidence? Measure completion, errors and recovery before optimising delight.

## Delivery and stopping rule

Deliver working source, reusable assets, the component/state catalogue, contracts and migration notes, realistic fixtures, automated checks, a short demo script and a reviewable change set. State what is implemented, simulated, contract-only and not verified.

Stop adding features when the chosen journey meets its acceptance criteria. Put the next domain behind an explicit experiment with a hypothesis, evidence trigger and removal condition. The goal is a foundation people can trust and developers can extend, not a large collection of impressive-looking screens.
