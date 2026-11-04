# Kitty implementation foundations v2

A reusable design system and a complete **local** source-to-ledger demonstration. This branch does not deploy a new app or migrate the live Sheet. It makes the next implementation concrete and testable.

## Start here

```sh
python3 design-system/check.py
python3 -m http.server 8875 --bind 127.0.0.1
```

Open `http://127.0.0.1:8875/design-system/` for the entry page. ES modules and JSON reads need HTTP; double-clicking lab.html via file:// is not supported. No package install or new application framework is required. The existing app preview retains its existing CDN dependencies; the new lab, motion gallery and source portal use local assets.

| Need | Open / use |
|---|---|
| Give another agent a focused, researched implementation brief | [IMPLEMENTATION-BRIEF.md](docs/IMPLEMENTATION-BRIEF.md) |
| Understand what the first kit lacked | [AUDIT.md](docs/AUDIT.md) |
| Try the components, states, review, Ask and arrangement | [lab.html](lab.html) |
| Try actual motion and failed/verified write feedback | [motion/index.html](motion/index.html) |
| Download realistic fictional source files | [demo portal](../demo-portals/index.html) |
| Inspect the resulting saved ledger and source lineage | [local readback](../demo-portals/result.html) |
| See this theme on the actual existing application | `python3 design-system/build-preview.py`, then [themed app](../dist/kitty-calm-local.html?noonb&noanim) |
| Inspect exact phone layouts | [responsive.html](responsive.html) |
| Apply components and data adapters | [INTEGRATION-MAP.md](docs/INTEGRATION-MAP.md), [COMPONENTS.md](docs/COMPONENTS.md), [DATA-FOUNDATIONS.md](docs/DATA-FOUNDATIONS.md) |
| Decide what to build next and what stays optional | [DOMAIN-ROADMAP.md](docs/DOMAIN-ROADMAP.md), [RESEARCH.md](docs/RESEARCH.md) |
| Check evidence and remaining acceptance work | [VALIDATION.md](docs/VALIDATION.md), [screenshot inventory](evidence/INVENTORY.md) |

## What ships

**Reusable implementation code:** semantic renderers, light/dark tokens, exact-money boundary adapter, provenance/transaction/metric/goal/state components, native-dialog examples, constrained canvas layout, pure data contracts, opt-in module policy, finite motion and a verified-write lifecycle helper. Source ownership and adapter/authority checks still belong to the host app. These are building blocks, not a replacement financial engine.

**Design assets:** 40 independent SVG icons with inline/external sprites and contact sheet; app PNGs from 16 to 1024px; editable cat marks; three transparent illustrations with source prompts; editable motion SVG. The files in assets/ supersede the first kit where the integration audit corrected mobile layout and contrast.

**Executable specimens:** four-widget overview, six data states, transaction drill-through, selection/filtering, reviewed category/undo, optional value reflection, Ask permission boundary and evidence-linked answer, arrangement/resize/reset, charts with text, optional domain catalogue and a motion gallery. Specimen financial figures are explicitly fixed demo values. They are not represented as live data.

**Source lifecycle:** three switchable fictional Australian-style bank/card portals with actual CSV downloads; core formats use the repository's existing adapters. The verifier blocks unresolved review, reconciles balances, emits the existing ten-column Transactions shape, reads back the local ledger, preserves repeated charges and rejects reimport. result.html renders those actual output files and source references. Eight additional domain CSVs and three printable HTML statements are supplied; the optional files are evidence-only, not working domain importers.

## A short demo

1. Start with the component overview. Keep only cash, a useful action, activity and one goal.
2. Change Ready to Loading, Partial, Stale and Error. Notice that missing money never becomes zero and unavailable evidence disables actions.
3. Return to Ready. Review Paper Moon, confirm Dining, and undo. Open a transaction and press Escape to return to its invoker. Try Ask's fixture answer and unavailable-connection case.
4. Arrange the overview with Move up/down, make a card compact/wide, then reset. Financial data is never persisted by layout controls.
5. Open the portal. Download all three core CSVs into a folder. Run `python3 demo-portals/verify.py --download-dir /path/to/folder`. Open result.html, drill into Mystery Merchant and inspect its source file/row/hash. Repeat import is zero new rows.
6. Open the motion gallery. Select Write response lost or Readback differs. Notice no success animation. Disable motion and replay an animation specimen.

## Integration order

First apply the opt-in tokens/sprite using the provided builder and existing app tests. Then integrate source/status/transaction primitives behind existing render functions. Add the exact-money envelope bridge at the import/display boundary, with explicit range/currency checks. Introduce reviewed-write feedback only with real provider authorization and cache-bypassing readback. Finally add one optional module when its required sources, reconciliation, useful decision and recovery path pass. Do not silently create new live Sheet tabs or write authority.

For the Claude single-file app, inline CSS, SVG sprites and selected raster data URLs in build.py; do not ship relative local asset paths or import.meta URLs. The provided build-preview.py demonstrates the existing-app theme/sprite/brand integration with exact source anchors and fails if those anchors drift. The generic module renderers require the documented bundling adapter. The Claude host owns its install manifest/listing icon; PNG availability alone does not establish that the published host icon changed.

## Scope and quality bar

The full vision is represented by extension contracts, not a claim of full implementation. Tax readiness starts with evidence; property cash flow is distinct from tax loss; equity/crypto lots and quantities are distinct from balances; super and SMSF retain entity boundaries; insurance and asset refresh plans remain documented facts and intentions. See the roadmap for gates.

Measured checks and local screenshots are supplied. Real Google Sheets/Drive readback, Claude capability wiring, physical phone install, screen-reader testing and a human usability study remain acceptance work. Do not treat the kit or a passing local test as proof of those outcomes.
