# Motion and trustworthy feedback

Motion is a state transition aid, not an ornament quota. Open `motion/index.html` through the local server to exercise every delivered effect and the save lifecycle.

## Delivered assets

- `motion/motion.css`: named timing tokens, entry, change highlight, press feedback, welcome blink, review tilt, confirmed tick and small sparkle. All finite; no idle loop or moving loading shimmer.
- `motion/kitty-status.svg`: editable 240×200 vector character with named groups. Inline it to target `.k-head`, `.k-eyes`, `.k-check` and `.k-spark`. At 120–160 CSS px it supports onboarding and milestone surfaces; never place it in transaction rows.
- `motion/feedback.mjs`: host-neutral `performVerifiedWrite` and `feedbackClass`. It does not own authority, data, connectors or business logic.

The static PNG illustrations remain the detailed editorial artwork. Do not animate their pixels by moving the entire page or repeatedly bouncing them.

## Trigger contract

| Situation | Visual behaviour | Meaning / stopping rule |
|---|---|---|
| First onboarding reveal | 240ms entrance, optional one blink | Orientation only; once per explicit start |
| Open drawer | At most 240ms entrance | Focus enters dialog; Escape and Close restore it |
| Filter / selected chip | 120ms colour change | Selection also expressed by text/ARIA state |
| Loading / source unavailable | Static placeholder and readable status | No fabricated percentage; never replace unknown with zero |
| Data-review decision | 180ms highlight after local state changes | Label whether pending write or verified |
| Write acknowledged | Still “Checking” | No tick or celebration until readback matches |
| Confirmed milestone | 240ms check, 420ms small sparkle once | Triggered by verified milestone transition, never page load |
| Unknown write result | Static “Outcome unknown” | Reconcile before retry; a timed-out response may have committed |
| Rearrange / resize | Immediate at reduced motion, otherwise ≤180ms | User initiated; no autonomous reorder while reading |
| Error | Static, specific message and recovery action | No shaking input, red flash, sad mascot or punitive language |

Do not animate monetary amounts from zero. Do not announce every frame or each tool token. `role="status"` should announce a meaningful state change once. A small success toast must not steal focus; a blocked flow may need an error summary with focus and links to fields.

## Wiring

```js
import {performVerifiedWrite} from './motion/feedback.mjs';
const state = await performVerifiedWrite({
  authorize: () => showExactChangeAndAwaitUserChoice(), // resolves literal true only
  write: () => existingConnectorWrite(exactRange, exactValues),
  readback: () => rereadExactRangeWithoutStaleCache(exactRange),
  matches: actual => valuesEqual(actual, exactValues),
  onState: state => renderSaveState(state)
});
// Only state === 'verified' can render confirmed feedback.
// The caller owns range identity, concurrency/version checks, cancellation and authority.
```

The helper never retries. Failed authorization prevents writing; a failed write response is classified as unknown because committing before network failure is possible. Receipt/readback failures remain distinct. Authorization to preview is not authorization to write. For changes to the original Kitty app, use existing capability boundaries and supported reconciliation.

Apply `data-motion="off"` on an ancestor for the explicit application preference. The CSS independently honours `prefers-reduced-motion: reduce`. Do not turn motion back on against the OS preference. A finite animation still needs a reduced-motion alternative. A stale value remains stale regardless of visual feedback.

## Research basis

Read 4 November 2026. W3C's [animation-from-interactions guidance](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html) supports disabling nonessential motion (AAA); this kit adopts that product rule without claiming blanket WCAG conformance. The [dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) establishes focus/escape behaviour. These sources constrain implementation; the exact 120/180/240/420ms values are design decisions to validate with users, not scientifically optimal constants.
