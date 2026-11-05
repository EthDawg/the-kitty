# Import a bank CSV on iPhone

In **Setup**, choose your Kitty v2 Sheet in Google and open it. Choose **Import a bank file**, select the original in Files, check the account and review the signed amounts and duplicates. Confirm names the destination Sheet. Keep the receipt to see how many entries Google returned. Choosing the same source again checks the previous receipt.

The bundled Davies demo supports Files and preview without a Google account. For a live rehearsal, choose the public Davies demo, make a private practice Sheet and open the copy by its unique name. Open that same Sheet on each phone. Kitty checks its owner and changes the practice copy’s inherited public-feed setting to private. **Save a sample CSV** supplies three fictional card transactions: an existing charge, a new debit and a refund.

Confirm requires an editable v2 Sheet in the signed-in owner’s My Drive. Sharing must be limited to named people and the public feed must be off. The canonical public demo always offers preview. A private copy and a shared public template have different Sheet IDs. Google sign-in uses the same file-specific grant as the dashboard.

## What happens on confirmation

The native picker retains the selected bytes in the household’s protected local storage. The phone computes the preview and its signed amounts using the shared period planner and fresh Google data. A one-time review ticket binds the original, Sheet, Google identity, account, dates and complete reviewed plan.

An exclusive hold in Sheets and immutable files in the owner’s Drive coordinate phones. Kitty retrieves the original from Drive, rehashes it and replans under that hold before sending an atomic Sheets batch. The batch writes literal text, numeric amounts and date cells with a unique receipt marker. Kitty rereads the typed cells and receipt before showing success. A later check on another device can recover the same receipt. If the first request never arrived, explicit **Resume verified import** can deliver only the previously approved, fenced batch.

Use **Setup → Check unfinished import** if a phone lost its connection or the original file is no longer in Files. The owner can discard a prepared review or stop an unresolved submission. Google must either return the original saved entries or permanently block that specific delayed batch before Kitty releases the hold. Later edits to a category are identified as edits to a previously verified import. If Google recorded the batch and the underlying entries changed before verification, the owner can **Close for manual review**. That records the discrepancy, preserves the entries and permits other imports.

The planner reserves transaction IDs still referenced in Decisions, including the other entry in a transfer match. An iPhone import also records the highest ID it issued in the selected Sheet, in the same atomic write. If all the entries from a verified import were removed, choosing the same original offers **Reimport removed entries**. That action requires a fresh review, assigns new IDs and links the new receipt to its predecessor.

This path supports ordinary single-account transaction appends. A source that also needs a balance adjustment, transfer repair or another type of write stays in review. Blank signed amounts, an ambiguous literal apostrophe before a spreadsheet formula character and incomplete ledger reads stop confirmation.

## Reproduce the checks

Run `node --test tools/period-bank.test.js tools/period-core.test.js src/core/*.test.js` for the planner, preview and receipt states. Xcode’s `GooglePeriodBankJournalTests` exercises concurrent phones, interrupted responses and stale approvals. The opt-in `ios/scripts/practice_import_acceptance.py` runs the actual system Files path and direct Google readback on a private fictional practice Sheet. It preserves the Sheet ID, source fingerprint and phase results locally when a device disconnects. Use `--resume` with the same output directory to reconcile an interrupted confirmation.
