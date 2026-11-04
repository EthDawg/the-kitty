# Template setup boundary — 5 November 2026

A read-only check of the [public Davies workbook](https://docs.google.com/spreadsheets/d/1zfiCnqO36a0YmMwC8-J6iGHUGvmLdXmhbL5aPWNlExM/edit) confirms that copying it and clearing transactions is not sufficient to create a clean household. The [bounded cell evidence](template-boundary-evidence.json) contains only fictional template cells and formulas; no live workbook was changed.

`Tax Forecast!B4:C4` contains the literal names Jordan and Mia. Its row 7 formulas test the literal name `Jordan` to choose between `Settings!B11` and `Settings!B12`. Those Settings rows also name the fictional people and define their share of joint income. Replacing only `Kitty.people`, or clearing raw records, leaves these assumptions in place. Broader setup also needs the account, loan, asset, goal, subscription and other household inputs adapted and validated.

`Kitty!A17:B17` contains `public_feed = yes`. The committed `apps-script/Code.js` serves its JSON data only when the first trimmed `public_feed` key has a value that trims/lowercases to `yes`. This is an opt-in switch for the known script, not proof that a copied script has a deployment or that Drive sharing is private.

## Implemented import boundary

The native projection and service reader now follow that exact first-key rule across the full raw grid, including rows above the settings header or after blank rows. The app explains the setting, links to the Kitty tab and requires a refresh before a new save. The service independently checks the current state before new source storage and before new import/close writes. It returns `public_feed_enabled` if the switch is on. Provenance remains readable; existing holds, receipts, cancellation and uncertain outcomes remain recoverable. Publication changes are excluded from historical receipt digests so they do not erase proof of an earlier completed write.

The local demo still supports fictional practice. No production Sheet setting is automatically changed. Turning the known feed off makes no claim about separate Drive permissions, other scripts, previously exported data or concurrent edits outside the service.

## Implemented clean-household setup

The native app now offers a saved setup draft, exact opening-balance review and a versioned AU/AUD one- or two-person household profile. The [generator](../../templates/README.md) replaces fictional configuration, keeps unsupported tax/mortgage/asset sections unavailable and sets the known public feed off. The native client binds the approved settings to durable Drive operation IDs before creation. The [setup service](../../setup-service/README.md) checks owner-only access, exact inputs/formulas, empty raw tables, validation, number formats and recalculated opening balances; uncertain creation is recovered without blindly requesting a second Sheet.

Actual Google recalculation and full verifier readback pass for private fictional one- and two-person workbooks. See [the bounded provider evidence](../../templates/evidence/GOOGLE-ACCEPTANCE.md). Native setup review and draft persistence pass on regular and small-screen simulators. Opening-date enforcement rejects earlier bank rows, including when setup markers are partially deleted; malformed metadata does not become a legacy exemption. Existing supported household imports retain their original data contract.

The private source project's current default branch contained raw-data and HTML generators, but no complete Sheet builder was found. The pinned public formula capture now supplies the generator input; that earlier source gap no longer blocks implementation. This is a deliberately basic new-household profile, not a migration of every optional financial domain.

Native OAuth and hosted setup/import/recovery, a second Google identity, physical-phone use and distribution remain unverified. The connected-provider tests apply generated requests directly; they do not exercise the app's live authorization or the setup service's creation state machine. See [the acceptance document](../ACCEPTANCE.md).
