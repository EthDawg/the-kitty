# Native workflow evidence

Full-resolution originals, captions, workflows, results and hashes are retained in [the inventory](screenshots/inventory.json). All captures contain fictional households only. They do not establish live Google access, provider AI, physical-device acceptance or store approval.

The expanded run, `typed-acceptance-final.xcresult`, passes 90 native tests and all 12 UI journeys on iPhone SE in dark mode with accessibility extra-large text. Its 24 untouched 750×1334 captures have a `typed-se-` prefix. The accessibility follow-up adds 21 originals with an `accessibility-regular-` or `accessibility-se-` prefix. Three later `feed-se-` captures from `public-feed-ui-01.xcresult` brought the inventory to 84; practice import/replay and month-end preview pass again after the publication guard. These captures do not exercise the connected-state warning. Six subsequent Activity captures bring the inventory to 90; the final large-text journey verifies separate title/search geometry and reaches the original transaction identifier. Large-text captures preserve the visible viewport of a scrollable section; the complete assertions and interactions remain in the result bundle.

The follow-up passes five affected small-screen journeys and a bounded control audit; the regular-size audit and account-selection journey also pass. See the [accessibility review](ACCESSIBILITY.md) for the remaining visual findings and limits. Representative current captures show [Ask at large text](screenshots/accessibility-se-ask.png), [wrapped import text](screenshots/accessibility-se-import.png), and [account selection](screenshots/accessibility-se-25-import-account-selected.png). These are not full accessibility acceptance.

- [Current Home](screenshots/typed-se-01-home-cash-and-demo-status.png), [practice receipt](screenshots/typed-se-11-practice-import-verified-local-receipt.png) and [zero-row replay](screenshots/typed-se-12-relaunched-import-adds-zero.png).
- [Mortgage estimate](screenshots/typed-se-13-mortgage-recorded-rate-scenario.png), [original payslip](screenshots/typed-se-19-retained-original-payslip.png) and [pay-date source review](screenshots/typed-se-20-document-field-confirmation.png).
- [Month-end practice status](screenshots/typed-se-22-month-end-missing-evidence.png), [transfer explanation](screenshots/typed-se-23-explicit-transfer-pair-review.png) and [retained decision](screenshots/typed-se-24-retained-transfer-decision.png).

The earlier small-screen run, `native-final-acceptance.xcresult`, passed 52 unit tests and seven UI journeys on iPhone SE in dark mode with accessibility extra-large text. Its 12 captures have an `se-` prefix. The regular-size final Home run also passed; its two captures have a `final-` prefix. The original complete iPhone 17 Pro run remains preserved below.

- [Final Home](screenshots/final-01-home-cash-and-demo-status.png) and [account basis](screenshots/final-02-cash-account-evidence.png).
- [Small-screen Home](screenshots/se-01-home-cash-and-demo-status.png), [practice receipt](screenshots/se-11-practice-import-verified-local-receipt.png) and [relaunch/replay](screenshots/se-12-relaunched-import-adds-zero.png).

| Capture | Workflow and observed outcome |
|---|---|
| [Home](screenshots/01-home-cash-and-demo-status.png) | Exact cash value, dated fictional status, income/spending and navigation are present. |
| [Accounts](screenshots/02-cash-account-evidence.png) | Cash opens its account basis, including the distinction from available-to-spend money. |
| [Transaction](screenshots/03-transaction-original-evidence.png) | Searching Woolworths reaches T0919 and its unchanged original description. |
| [Goal](screenshots/04-goal-plan-and-money-basis.png) | The over-target goal retains its actual saved amount and avoids adding the allocation as a new asset. |
| [Demo edit boundary](screenshots/05-demo-goal-edit-boundary.png) | Demo goal editing cannot claim a Google write. |
| [Exact chart values](screenshots/06-insights-exact-figures.png) | Monthly chart has a text equivalent with exact figures. |
| [Checks](screenshots/07-recorded-reconciliation-checks.png) | Recorded checks have source context; they do not prove a newly imported period is closed. |
| [AI preview](screenshots/08-ai-summary-consent-preview.png) | A dated, bounded summary is visible before any external handoff. No AI request was sent. |
| [Import review](screenshots/09-import-unresolved-source-review.png) | Unfamiliar merchants reach explicit review. |
| [Save held](screenshots/10-import-save-held-until-review.png) | Unresolved review cannot be saved. |
| [Practice receipt](screenshots/11-practice-import-verified-local-receipt.png) | Five approved synthetic rows and their original file were written and read back locally. This is explicitly labelled practice. |
| [Relaunch and repeat](screenshots/12-relaunched-import-adds-zero.png) | The durable local receipt survives a fresh launch; replay offers zero new rows. |

Raw `.xcresult` bundles and exported attachments remain locally available under `ios/evidence/` and are excluded from Git. The selected originals above are retained with the code.

## Added planning and source review

The inventory also retains the earlier regular-size captures 13–18 from the passing planning journeys and 19–22 from the passing original-document/confirmation/relaunch and month-end preview journeys. The latter month-end layout was subsequently simplified to surface unresolved checks first; its earlier screenshot remains historical evidence. All are full-resolution fictional simulator captures.

## Clean household setup

Six `setup-regular-` / `setup-se-` originals bring the inventory to 96. The fictional account editor, exact opening-balance review and saved draft after relaunch pass on iPhone 17 Pro and iPhone SE with accessibility extra-large text. The final small-screen capture uses `household-ui-se-04.xcresult` and asserts that the review row is fully in the viewport; the earlier passing run asserted reachability but its screenshot did not show the amount. The UI journey stops at local review and performs no Google authorization or workbook creation.

## Household controls, recovery and export

The current regular-size regression passes 165 native unit tests and all 20 UI journeys in `parity-regular-final.xcresult`. Six small-screen setup, recovery, transaction and export journeys pass in `parity-se-recovery-export-03.xcresult`; preference and goal-entry journeys pass in `parity-se-preferences-goals-02.xcresult`. An earlier interrupted small-screen run failed its off-screen Settings assertion and has no completed readable bundle. It is superseded by these passing runs.

Screenshot inspection exposed a truncated account picker in the new-goal form. The final wrapping menu and actual selection pass at regular size in `parity-goal-account-regular-04.xcresult` and at large text size in `parity-goal-account-se-04.xcresult`. The selected current originals use the final targeted captures for these changed views; the earlier originals remain in their local result bundles.

- [Opening household](screenshots/parity-regular-33-opening-household-home.png) and [empty Activity](screenshots/parity-se-34-opening-household-empty-activity.png) load actual sanitized Google readback through Debug-only fixtures. They do not exercise native OAuth.
- [Completed-setup continuation](screenshots/parity-regular-30-completed-setup-next-household.png) and [preserved recovery](screenshots/parity-se-32-preserved-setup-recovery.png) use synthetic local records. Neither is a live service receipt.
- [Filtered export review](screenshots/parity-regular-35-filtered-activity-export-review.png) and [native Files picker](screenshots/parity-se-36-native-csv-destination-picker.png) retain the exact search after cancellation. The picker is cancelled; no destination save is claimed.
- [Preferences](screenshots/parity-se-37-household-preferences.png) and [selected goal account](screenshots/parity-se-41-new-goal-account-selected.png) show the large-text viewport. The fictional demo remains read-only.

These additions retain 59 new originals, bringing the inventory at that stage to 155: 41 current regular-size captures, 17 small-screen captures and one final opening-balance capture. The [final small-screen balance](screenshots/parity-final-se-33-opening-household-home.png) comes from the passing `parity-home-visible-se-05.xcresult`, which asserts the entire amount sits above the floating tab bar. Its earlier scroll position is retained as historical evidence and labelled as partly obscured. No screenshots were cropped, resized or otherwise edited for the inventory.

## Native Files selection and verified export

Twelve additional originals brought the inventory to 167, with every hash checked. Seven regular-size captures come from the two passing journeys in `files-native-regular-final.xcresult`; five small-screen originals come from `files-import-se-03.xcresult` at accessibility extra-large text in dark appearance.

- [Fictional original in Files](screenshots/files-se-42-native-bank-csv-file-picker.png), [column mapping](screenshots/files-regular-43-native-csv-column-mapping.png) and [repeat-file detection](screenshots/files-se-44-native-csv-repeat-file-detected.png) exercise the normal document picker and source review.
- [Five-row review](screenshots/files-se-45-native-file-import-review.png) and [Save held after relaunch](screenshots/files-se-46-native-file-review-after-relaunch.png) show the retained local review. The journey and independent draft readback verify the original and confirmed mapping; a screenshot alone does not.
- [Native save destination](screenshots/files-regular-47-native-csv-save-destination.png) and [saved result](screenshots/files-regular-48-native-csv-saved-result.png) now have a matching [destination CSV and byte verification](NATIVE-FILES.md). The earlier cancellation captures remain valid evidence of that separate path.

The small-screen mapping capture shows its introductory viewport; the journey scrolls through the remaining form before confirming. Every capture remains fictional simulator evidence, with no live Google write or physical-phone acceptance.

## Home shortcut destinations

Seven more untouched originals bring the current inventory to 174. The [historical defect capture](screenshots/navigation-before-49-home-review-opens-old-transaction.png) shows T0919 after Home's category-review prompt was tapped. It was captured directly from the simulator after the diagnostic logged `HOME_REVIEW_DESTINATION=Transaction`. That diagnostic then failed while inspecting a missing search field; it is not counted as passing acceptance.

The final journey passes in `home-activity-route-regular-final.xcresult` and `home-activity-route-se-01.xcresult`. It first confirms that ordinary tab switching retains the Woolworths search, then checks both Home shortcuts after transaction drill-through.

- [Requested category review](screenshots/navigation-regular-50-home-opens-category-review.png) shows the three uncategorised transactions with the old search cleared.
- [Exact review count at large text](screenshots/navigation-se-51-home-review-has-three-records.png) confirms three records and the requested filter.
- [View all activity](screenshots/navigation-se-52-home-all-activity-includes-every-record.png) restores all 925 fictional records after another detail view.

The small-screen Activity capture preserves the selected filter and the beginning of its first record; its amount is below the floating tab bar and requires scrolling. The separate export-review capture shows the full count. These are navigation checks with fictional data, not categorisation writes or full accessibility acceptance.

## iPad actions and rotation

Thirty additional originals bring the inventory to 204: 24 iPad captures, five regular iPhone captures and one large-text iPhone SE menu. All hashes match their untouched PNGs. Landscape originals retain their original EXIF orientation; the inventory records both stored dimensions and display dimensions. No image has been rotated, cropped or resized in the retained files.

The app declares iPad and landscape support. Testing an isolated iPad mini (A17 Pro), iOS 26.5, exposed an unresponsive generated Activity toolbar: tapping More did not reveal either action. XCTest and direct UI control reproduced the same behavior. The [historical capture](screenshots/ipad-before-activity-actions.png) records the unchanged empty Activity state after the tap; it is not a passing result. An explicit native menu repairs the action path.

- [Current iPad menu](screenshots/ipad-58-activity-actions-menu.png), [regular iPhone menu](screenshots/rotation-regular-58-activity-actions-menu.png) and [large-text menu](screenshots/tablet-menu-se-58-activity-actions-menu.png) expose labelled Import and Export commands. Native text wraps at the accessibility size; both actions remain reachable.
- [Clean household](screenshots/ipad-33-opening-household-home.png) retains its exact $1,234.56 opening balance. [Empty Activity](screenshots/ipad-34-opening-household-empty-activity.png) disables Export in the open menu.
- [Home category review](screenshots/ipad-50-home-opens-category-review.png) shows all three requested records; separate reviews verify [three filtered records](screenshots/ipad-51-home-review-has-three-records.png) and [all 925 records](screenshots/ipad-52-home-all-activity-includes-every-record.png).
- [Native Files](screenshots/ipad-42-native-bank-csv-file-picker.png), [mapping](screenshots/ipad-43-native-csv-column-mapping.png), [duplicate original](screenshots/ipad-44-native-csv-repeat-file-detected.png) and [five-row review after rotation](screenshots/ipad-57-landscape-native-file-review.png) exercise the tablet's real picker. [Relaunch](screenshots/ipad-46-native-file-review-after-relaunch.png) preserves unresolved decisions and blocks Save. The [saved export verification](NATIVE-FILES.md#ipad-follow-up) independently establishes the destination bytes.
- [Landscape Activity review](screenshots/ipad-53-landscape-filtered-activity-review.png) retains the exact 38-row Woolworths result. [Original evidence](screenshots/ipad-54-landscape-original-transaction.png) remains reachable after rotating the detail. The same checks pass on [iPhone](screenshots/rotation-regular-53-landscape-filtered-activity-review.png).
- [Landscape goal fields](screenshots/ipad-55-landscape-goal-fields-retained.png) retain the entered name, amount and account. The journey rechecks all three after returning to portrait. The [regular iPhone portrait capture](screenshots/rotation-regular-56-portrait-goal-fields-after-rotation.png) shows the fields and disabled demo review together.
- [Exact monthly values](screenshots/ipad-06-insights-exact-figures.png) show all six months after disclosure, including the complete January figures. [Ask preview](screenshots/ipad-08-ai-summary-consent-preview.png) remains a dated sharing review; no provider request was sent.

`ipad-workflows-04.xcresult` passes seven baseline journeys. The import, Insights and rotation journeys also pass individually in `ipad-acceptance-final.xcresult`; despite its name, that earlier candidate fails two toolbar journeys. Its selected screenshots come only from passing cases. `ipad-toolbar-final.xcresult` then passes all five affected journeys in 141.661 seconds. Together these runs cover 12 distinct tablet journeys, not one full-suite run of the final binary. The final menu also passes six regular iPhone journeys in 232.109 seconds and two large-text iPhone SE journeys in 104.906 seconds.

Earlier harness attempts assumed an iPhone tab bar and always-visible search. The tests now use the tablet's native top tabs, collapsed search and Files sidebar. Early app-scoped landscape captures were clipped; the retained landscape originals use full-screen capture. The mapping and portrait import views are scrollable: each inventory entry identifies its visible viewport. The current checks do not cover tablet window resizing, hardware keyboards, VoiceOver, live provider behavior or physical-device use.

## Household switch navigation

A fictional cached-household probe selected [Taylor cabin fund](screenshots/household-switch-before-59-previous-household-goal.png), opened the Davies demo through the normal Settings action, and returned to Goals. The earlier build then opened [Emergency fund](screenshots/household-switch-before-60-goals-after-household-switch.png) automatically: both goals use row 2 as their local identity. It showed the new household's values, but carried over a navigation selection that belonged to the previous household.

The TabView now has an identity scoped to household mode and Sheet ID. Changing households recreates its navigation stacks; refreshing the same household retains that identity. The [repaired regular iPhone capture](screenshots/household-switch-regular-60-goals-after-household-switch.png) shows the new household's goal list instead of an unselected detail.

`household-navigation-probe-01.xcresult` is diagnostic evidence. It completed after checking the initial selected goal and successful demo switch, but did not yet assert the required destination. It is not counted as passing regression acceptance. The final journey requires the Goals root, excludes both the old detail and the automatically opened Emergency fund detail, and verifies that the new goal list exists.

The fixture hook is Debug-only, contains fictional data and supplies no Sheet ID or Google identity. Its connected/offline presentation exercises the production switch-to-demo action without contacting a provider. These captures do not establish a second Google account, live Sheet switching, provider access, a complete accessibility audit or physical-device acceptance.

The repair passes in `household-navigation-regular-01.xcresult` alongside 21 native identity, disconnect, write-lock and AI-context tests, plus all four focused UI journeys (104.292 seconds of UI execution). `household-navigation-se-01.xcresult` passes household switching and the ordinary/Home shortcut journey at accessibility extra-large text in 107.942 seconds. `household-navigation-ipad-01.xcresult` passes the household switch in 21.208 seconds. The regular run also retains the entered goal fields through rotation.

The [large-text result](screenshots/household-switch-se-60-goals-after-household-switch.png) shows the Goals heading and first card's upper viewport; further details require scrolling. The [iPad result](screenshots/household-switch-ipad-60-goals-after-household-switch.png) shows the complete three-goal list. These five additional originals bring the inventory to 209, with all file hashes verified.

## Exact financial labels at the review checkpoint

Four additional untouched originals bring the inventory to **213**, with every SHA-256 rechecked. They come from the final exact-values journey on regular iPhone and maximum-text iPhone SE. The journey verifies exact accessible Home totals, January values, budget spending/targets and above-plan status, then opens the recorded checks.

- [Regular budget capture](screenshots/money-regular-61-accessible-budget-values.png) shows the complete January figures and first three budget rows. Visible budget amounts remain compact; the accessible labels preserve cents, as recorded in [the label evidence](accessibility-money-values.json).
- [Regular monthly disclosure](screenshots/money-regular-06-insights-exact-figures.png) shows August–December values and the January heading. January values continue below the tab bar and are visible in the budget capture above.
- [Maximum-text monthly disclosure](screenshots/money-max-se-06-insights-exact-figures.png) shows December and the January heading. January values require further scrolling; the test verifies their exact accessibility text.
- [Maximum-text budget viewport](screenshots/money-max-se-61-accessible-budget-values.png) shows investment interest and the start of travel. The entire travel row does not fit in that viewport; its full accessible label, including exact budget and Above plan, is asserted by the test.

These are fictional simulator captures. They do not establish actual VoiceOver speech, a complete visual accessibility pass or live financial writes. The [accessibility review](ACCESSIBILITY.md#review-checkpoint-exact-financial-labels) retains the unresolved findings and exact test scope.
