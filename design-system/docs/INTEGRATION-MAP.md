# Existing app → new foundations

Integrate incrementally. The source app remains the owner of rendering orchestration and provider capabilities; its Sheet/engine remains the owner of financial meaning.

| Existing source seam | Supplied implementation | Adapter / acceptance obligation |
|---|---|---|
| src/style.css + shell.html inline sprite | assets/tokens/calm.css; assets/icons/sprite-inline.html; build-preview.py | Explicit theme opt-in; replace rather than duplicate symbols; inspect mobile and dark |
| app.js avatar and transaction rows / openTx | components/kitty.mjs transactionRow + native dialog in lab.js | Map legacy amount to exact cents; preserve raw description and row ID; avoid invented merchant/logo enrichment |
| renderHome / goalTile | metric, goal and provenance renderers | Caller supplies owning metric, currency, date and state; valid denominator only |
| openDrawer / closeDrawer | native dialog specimen | Focus in, Escape, focus return; preserve original opener when replacing content |
| openCheck / openDupes | review/undo specimen, source-lineage result page | Existing app only directs category correction to Sheet. Do not silently add live category-write authority; stage changes first |
| writeCells and live editors | motion/feedback.mjs performVerifiedWrite | Caller shows exact proposed changes, uses authorized connector, bypasses stale cache for readback, compares exact range/value/version; unknown outcome blocks automatic retry |
| finishOnboarding / celebrate | verified feedback contract and finite SVG/CSS | Existing app celebrates before writes. Move production celebration after actual successful readback; the visual builder deliberately doesn't change this behaviour |
| openAsk / ask / TOOLS | evidence-led answer/permission specimen; ASK-CAPABILITIES.md | Keep existing Claude host capability; send minimum evidence after permission; no fake running skills or silent writes |
| savePrefs | normaliseLayout/moveWidget/reorderWidget | Separate layout namespace; no finance records in localStorage; user-triggered move/resize only |
| period-close/adapters.py | demo-portals/pipeline.py and verify.py | Test corpus only; source hash + row identity + Decimal reconciliation; preserve existing live importer until deliberately upgraded |
| Sheet Metrics and existing snapshot | contracts/kitty-contracts.mjs + components/boundary.mjs | New boundary validates exact strings then display adapter checks scale/range. No silent Sheet migration or duplicated financial authority |

## Single-file bundling

The actual theme integration is executable with `python3 design-system/build-preview.py`. For the new ES-module components, bundle deliberately: import-time sprite URL becomes an inline `#i-*` reference, CSS imports are expanded, and selected PNGs become data URLs. The delivered module files are directly usable in ordinary static web apps; they are not claimed to be drop-in `<script>` replacements for app.js's private IIFE. Use the old app tests as the oracle after each adapted renderer.

## Production gates

Do not merge financial workflow changes based solely on these visual specimens. First validate a synthetic provider destination, keep existing original data/backup, inspect proposed ranges, verify exact write/readback and rehearse timeout/conflict recovery. Never use the real household as the test fixture. Domain adapters require their own fixtures and authoritative expected results before enabling any calculation or “ready” status.
