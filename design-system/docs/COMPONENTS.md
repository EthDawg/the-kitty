# Kitty component and interaction contract

The lab is an executable implementation reference for the next release, not a replacement financial model. It uses fixed fictional examples and never reads or writes a bank, Sheet, Drive or Claude account.

## Run and verify

From the repository root:

```sh
python3 -m http.server 8875 --bind 127.0.0.1
# Open http://127.0.0.1:8875/design-system/lab.html
node --test design-system/tests/components.test.mjs
```

Serve over localhost: browser ES modules do not reliably load over file://. No npm install, framework or third-party component package is required. The library requests only local CSS, scripts, icons and artwork. It has no telemetry or remote logo service.

## What is usable now

| Pattern | Implementation | Inputs and meaning | Edge states / recovery |
|---|---|---|---|
| Metric | `metric()` | Label, integer minor units or null, currency, context, source, as-of and explicit status | Null says “Not available”; zero remains zero. Unsafe/fractional minor units are rejected. |
| Provenance | `provenance()` | Source, as-of text, explicit source status | Always supplied by adapter. Demo is default; do not pass “verified” merely because a render succeeded. |
| Goal ring | `goal()` / `progressModel()` | Confirmed saved value and target in same currency; user target date | Missing, negative or zero target shows unavailable. Ring reaches 100% only when saved is at least the target; rounded sub-target values cap at 99%. Text retains over-target amount. Percentage is presentation of supplied values, not a forecast. |
| Transaction | `transactionRow()` | Stable ID, original description, normalised merchant, signed minor units, account, currency, status, review, kind | Pending / transfer / refund / review words. No fuzzy merchant logo or inferred reconciliation. Details keep original text and source row. |
| Selectable activity | `lab.js` controller + native table | Stable IDs; selected set lives only in page memory | Selection resets when filtering. No financial totals are inferred from selection. Table stays a table. At phone width, category/date/status/account stack beneath merchant while the exact amount stays on the right; desktop keeps separate columns. |
| Review card & dialog | `showReview()` reference | One explicit proposed category, immutable source facts | Missing choice focuses field with error description; confirm affects demo annotation only; undo available. Production needs write+reread before “confirmed”. |
| Value reflection | `showValue()` reference | Optional user judgement of a recurring cost | “Useful”, “Not sure”, “Skip”; no shame score, automatic cancellation, task creation or model inference. Answers stay on screen only. |
| Ask answer | `showAsk()` reference | Explicit question, dated facts, cited evidence, uncertainty | Fixture answer and permission-required branch. No fake model request. Proposed action is reviewed separately. |
| Details | native `<dialog>` | Title, metadata, source evidence, exact amount | Escape closes; native modal focus containment; explicit Close button; focus returns to opener when present. |
| Canvas | `normaliseLayout()`, `moveWidget()`, `reorderWidget()` | Four known IDs and compact/wide size only | Corrupt storage sanitised; unknown widgets rejected; reset available; drag has labelled Up/Down alternatives; all cards stack on mobile. |
| Source status | `stateNotice()` | Ready / loading / first use / partial / stale / error | Missing/loading/error balances hidden; stale labelled; partial account coverage stated; no invented loading percentage. |
| Comparison chart | labelled bar specimen | Caller-supplied category amounts | Text values and equivalent data table. Bars compare amounts; goal rings communicate progress only. |
| Motion | `motion/` + one confirmation specimen | Triggered state change | Reduced motion removes animations. Confirmation does not cause a write or claim one. |

The library includes domain contracts for property, tax evidence, shares/employee equity, crypto, super/SMSF, insurance and replacement planning. These are explanatory specimen cards. They neither activate modules nor perform domain calculations. The default overview contains only cash, a small review list, activity and a goal.

## File ownership and API

- `components/kitty.mjs`: dependency-free rendering and layout helpers. It can be imported by browser modules or Node tests.
- `components/kitty.css`: prefixed `.k-*` visual primitives. It consumes semantic CSS variables supplied by the theme.
- `lab.html`, `lab.css`, `lab.js`: reference composition and demo controllers. These are separate from production `src/app.js`.
- `assets/icons/sprite.svg`: external icon sprite used by the lab. Its IDs match the earlier kit and the app's existing `i-*` conventions. `icon()` resolves the sprite with `new URL('../assets/icons/sprite.svg', import.meta.url)`, so consumers may live in another directory without broken icons.
- `tests/components.test.mjs`: pure tests for money, escaping, missingness, goal bounds, transaction states and layout corruption/reordering.

Rendering functions return HTML and escape text/attribute values. Only enumerated icon names and tones are allowed. Callers must still validate input records at the data boundary. The currency formatter uses the currency's standard minor-unit exponent; crypto units and quantities must use a separate decimal-string formatter. For aggregate sums and FX, keep computation in the owning model, not the renderer.

Semantic theme variables:

```css
--bg; --surface; --soft; --ink; --ink2; --muted; --line;
--accent; --accent-soft; --good; --good-soft;
--warn; --warn-soft; --error; --error-soft;
```

`lab.css` contains tested-direction light and dark examples. The production app uses the compatible override under `assets/tokens/calm.css`; map its `--warn` (error) and `--amber` (caution) into the component's distinct `--error` and `--warn` if reusing the component CSS. Do not blindly equate tokens with the same historical name but a different meaning.

```css
/* Scoped bridge inside the production app; do not replace root tokens. */
.k-component-scope {
  --soft: var(--surface2);
  --error: var(--kitty-error);
  --error-soft: var(--kitty-error-soft);
  --warn: var(--kitty-caution);
  --warn-soft: var(--kitty-caution-soft);
}
```

Capture the original production semantic values into `--kitty-error: var(--warn)` and `--kitty-caution: var(--amber)` on the parent before introducing the scope, or use concrete token values from the theme. Avoid recursive custom-property aliases. For a production integration prefer a deliberate single semantic token mapping instead of carrying two independent root themes.

## Integrating without a framework migration

1. Keep `src/engine.js`, the Sheet schema and every existing financial invariant unchanged in the visual change.
2. Apply `assets/tokens/calm.css` using its explicit opt-in attribute and replace the existing hidden icon sprite with `assets/icons/sprite-inline.html`. Keep existing IDs.
3. Introduce one primitive at a time behind the opt-in theme. Start with transaction rows and provenance, then review states. Map existing source records to renderer arguments at a single boundary. Do not rename or mutate original descriptions.
4. The existing artifact is a single HTML file. At build time inline the component source (remove `export` keywords or bundle its named functions into an explicit namespace), CSS and selected assets. Replace the module-relative `SPRITE_URL` constant and its external sprite reference with the existing inline `#i-*` form. When flattening to a non-module script, remove that `import.meta.url` expression entirely; do not leave module-only syntax in the published script. Do not deploy ES-module references to local files into Claude's artifact. This kit does not silently modify `build.py` or the live publication.
5. Wire controller callbacks to the app's current access checks. A review should progress through proposed → user-confirmed → write attempted → reread-confirmed; rejected/failed/unknown outcomes must remain visible and recoverable. A local click is not persistence.
6. Replace fixture questions with the existing supported Claude call path. Supply only the stated data scope. No permission means no call. Answers cite the owning metrics or records, show their dates, and propose edits separately. The lab disables Ask outside the Ready fixture; it never answers from a source-gap or stale scenario.
7. Layout is a separate preference document: version, ordered known widget IDs and allowed sizes. Never save transaction data alongside it. New widgets may be suggested after evidence appears; do not reshuffle a user's saved canvas without a chosen action. Hidden is not disconnected.

The lab persists only `kitty:design-lab:layout:v2`, holding an ordered array of `{id,size}`. It does not persist review choices, selected rows, reflection responses, questions, money values or source details. The Reset layout control restores the default ordering. If storage is blocked, layout remains usable for the current visit.

## State rules that must survive implementation

- **Ready:** show amount, currency, source timestamp and coverage. “Ready to display” is not tax ready or reconciled.
- **Loading:** hold the layout while hiding unavailable values. No animated number count-up or fake completion percentage.
- **First use:** one next step: import and review a source. Avoid blank dashboards for every possible domain. The specimen offers one primary source-import CTA, with the remaining cards explanatory.
- **Partial:** preserve confirmed values, name missing coverage, suppress totals dependent on missing sources. The lab's partial activity list excludes missing-card rows and card-specific actions. Only the available bank fixture contributes rows; dependent totals are suppressed.
- **Stale:** show the exact last-confirmed date; never label cached balance “available now”. The stale fixture is observed 20 November with records as at 4 November; future-bill estimates and review actions are paused.
- **Error:** say what could not be read and give a supported recovery action; retain source records. Do not infer zero, retry via another identity, or show success artwork.
- **Pending:** source lifecycle state, excluded from posted totals until reconciled with posted record identity.
- **Review:** user interpretation required. Keep immutable raw record plus versioned annotation and confidence evidence.
- **Saved:** only after the owning provider has confirmed the result. The lab's confirmation says “demo” because no write happens.

## Acceptance before shipping

The pure tests pass locally. Browser inspection should check actual interactions; the test suite does not claim full accessibility certification.

Check desktop and 390px/320px layouts, 200% text zoom, light/dark/system appearance, keyboard order and visible focus, Escape and focus return, all six source states, pending/refund/transfer semantics, review validation/undo, filter and checkbox feedback, empty filtered results, corrupted layout storage, move/resize/reset, drag and non-drag alternatives, and reduced-motion preference. Check no private values appear in URLs, local storage or third-party requests. Run the repository's original tests and build after integrating.

For actual phone acceptance, test touch targets, horizontal transaction-table scrolling, native modal behaviour and home-screen icon masks on a physical device. Those outcomes cannot be inferred from a screenshot or passing unit tests.

## Exact-envelope bridge and tokens

`components/theme.css` owns the specimen's portable light/dark tokens and is imported by `kitty.css`. `lab.css` is showcase layout, not required by a host using the renderers. For a single-file artifact, inline theme CSS, component CSS and the sprite at build time; remove CSS imports and replace the module-relative icon URL with `#i-...` references.

`components/boundary.mjs` is a tested optional adapter from `contracts/kitty-contracts.mjs` monetary metric envelopes. `renderMetricEnvelope(envelope)` validates first, preserves missing/stale/error states, escapes source text, and refuses unsafe numeric conversion. `uiMinor()` checks both precision scale and safe-integer range. The underlying contract can preserve values larger than the legacy UI renderer supports; it must never round them just to make a widget render. The adapter gives an explicit unavailable-format message in that case.

The real end-to-end local consumer is `demo-portals/result.html`: it reads the verifier's saved ledger/report and uses these transaction/metric primitives. The component lab has separate illustrative fixtures and deliberately does not claim to be that ledger.
