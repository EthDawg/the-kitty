# Template setup boundary — 5 November 2026

A read-only check of the [public Davies workbook](https://docs.google.com/spreadsheets/d/1zfiCnqO36a0YmMwC8-J6iGHUGvmLdXmhbL5aPWNlExM/edit) confirms that copying it and clearing transactions is not sufficient to create a clean household. The [bounded cell evidence](template-boundary-evidence.json) contains only fictional template cells and formulas; no live workbook was changed.

`Tax Forecast!B4:C4` contains the literal names Jordan and Mia. Its row 7 formulas test the literal name `Jordan` to choose between `Settings!B11` and `Settings!B12`. Those Settings rows also name the fictional people and define their share of joint income. Replacing only `Kitty.people`, or clearing raw records, leaves these assumptions in place. Broader setup also needs the account, loan, asset, goal, subscription and other household inputs adapted and validated.

`Kitty!A17:B17` contains `public_feed = yes`. The committed `apps-script/Code.js` serves its JSON data only when the first trimmed `public_feed` key has a value that trims/lowercases to `yes`. This is an opt-in switch for the known script, not proof that a copied script has a deployment or that Drive sharing is private.

## Implemented import boundary

The native projection and service reader now follow that exact first-key rule across the full raw grid, including rows above the settings header or after blank rows. The app explains the setting, links to the Kitty tab and requires a refresh before a new save. The service independently checks the current state before new source storage and before new import/close writes. It returns `public_feed_enabled` if the switch is on. Provenance remains readable; existing holds, receipts, cancellation and uncertain outcomes remain recoverable. Publication changes are excluded from historical receipt digests so they do not erase proof of an earlier completed write.

The local demo still supports fictional practice. No production Sheet setting is automatically changed. Turning the known feed off makes no claim about separate Drive permissions, other scripts, previously exported data or concurrent edits outside the service.

## Remaining first-run requirement

The current app deliberately offers a **Davies demo copy** and connection to an existing supported Kitty Sheet. It does not offer a blank household wizard. A general setup flow needs a versioned template whose formulas refer to household metadata consistently, a defined treatment for optional accounts/loans/assets and tax sections, and acceptance on a newly owned copy with a second Google identity. The handover identifies a separate private project as the template source. A read-only review of that project’s current default-branch tree found a fictional raw-data generator and HTML page builders, but no complete Sheet/formula builder. This is a bounded source check, not evidence that no earlier or external generator exists. The subsequent [public formula capture](../../templates/README.md) now supplies grid logic, validation and number formats for an adapted generator, so recovering the original builder is no longer a prerequisite. A generator and recalculated clean-workbook acceptance are still missing; the capture is not a complete visual or permission clone.

That is still required work for general household onboarding. Clearing rows or renaming the demo would not satisfy it. Native OAuth and hosted-service setup, live import/recovery, physical-phone use and distribution are also still unverified, as recorded in [the acceptance document](../ACCEPTANCE.md).
