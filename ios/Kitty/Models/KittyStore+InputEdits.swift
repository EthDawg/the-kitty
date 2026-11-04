import Foundation

@MainActor extension KittyStore {
  var inputEditURL: URL { (inputEditStorageOverride ?? storage).appendingPathComponent("input-edit.json") }
  var inputEditsBlockNewWrites: Bool { pendingInputEdit != nil || inputEditLoadBlocked }
  var inputEditVisible: Bool {
    !isDemo && mode == .connected && google.isConnected && pendingInputEdit?.sheetID == selectedSheetID
  }
  var inputEditRestriction: String? {
    if inputEditLoadBlocked { return "The saved input review needs checking before another change can be made." }
    if pendingInputEdit != nil { return "Check the saved input change before making another change." }
    if isDemo { return "The demo is read-only. Connect your Sheet to save your own choices." }
    if mode != .connected || selectedSheetID.isEmpty { return "Connect your Google Sheet before editing its settings." }
    if !sheetCanEdit { return "This Google account has view-only access. Ask the Sheet owner for edit access." }
    if busy || inputEditBusy || importBusy || importEvidenceLoading || setupBusy || goalBusy || disconnecting {
      return "Wait for the current Sheet operation to finish."
    }
    if draft.remote != nil { return "Resolve the pending import receipt before changing Sheet inputs." }
    if setupDraft.isUnresolved || setupLoadBlocked { return "Resolve the pending household setup before changing Sheet inputs." }
    if goalWritesBlocked { return "Resolve the pending goal creation before changing Sheet inputs." }
    return nil
  }

  func loadPendingInputEdit() {
    guard !inputEditBusy, FileManager.default.fileExists(atPath: inputEditURL.path) else { return }
    do {
      let data = try Data(contentsOf: inputEditURL)
      guard data.count <= 32 * 1024 else { throw KittyError.message("The saved input review is too large.") }
      let edit = try JSONDecoder().decode(SheetInputEdit.self, from: data)
      try edit.validate()
      pendingInputEdit = edit
      inputEditLoadBlocked = false
    } catch {
      inputEditLoadBlocked = true
      self.error = "A saved input change could not be read. Its record is preserved; no new input writes will start."
    }
  }

  private func persistInputEdit(_ edit: SheetInputEdit) throws {
    try edit.validate()
    let data = try JSONEncoder().encode(edit)
    if let inputEditPersistence { try inputEditPersistence(data, inputEditURL) }
    else { try persist(data, at: inputEditURL) }
    pendingInputEdit = edit
  }

  /// A known terminal outcome may clear the active record. Unverified outcomes use the separate archive flow.
  private func finishInputEdit(_ edit: SheetInputEdit, outcome: SheetInputEdit.Outcome) throws {
    var completed = edit
    completed.outcome = outcome
    completed.verifiedAt = outcome == .verified ? Date() : nil
    pendingInputEdit = completed
    // If terminal-state persistence fails but removal succeeds, no stale record remains.
    // If both fail, the last durable unverified record remains conservative on relaunch.
    try? persistInputEdit(completed)
    do {
      if FileManager.default.fileExists(atPath: inputEditURL.path) {
        if let inputEditRemoval { try inputEditRemoval(inputEditURL) }
        else { try FileManager.default.removeItem(at: inputEditURL) }
      }
      pendingInputEdit = nil
      inputEditLoadBlocked = false
    } catch {
      throw KittyError.message("The change's outcome is known, but its local recovery record could not be cleared. Check it again before editing another input.")
    }
  }

  func prepareInputEdit(kind: SheetInputKind, text: String, recordKey: String? = nil,
    client: GoogleSheets? = nil) async throws -> SheetInputEdit {
    if let reason = inputEditRestriction { throw KittyError.message(reason) }
    let replacement = try kind.replacement(text: text, goalNames: household?.goals.map(\.name) ?? [])
    guard let key = kind.key ?? recordKey, !key.isEmpty else { throw GoogleSheets.ServiceError.invalidWrite }
    let id = selectedSheetID, epoch = googleEpoch, name = selectedSheetName
    let version = household?.sheetVersion
    busy = true; inputEditBusy = true
    defer { busy = false; inputEditBusy = false }
    let google = client ?? sheets
    let ranges = [kind.readRange, "Kitty!A1:C"] + (kind == .leadGoal ? ["Goals!A1:D"] : [])
    let values = try await google.batchGet(spreadsheetID: id, ranges: ranges, renderFormulas: true)
    guard googleEpoch == epoch, selectedSheetID == id else { throw CancellationError() }
    let goals = kind == .leadGoal ? try inputGoalNames(values[2].rows) : []
    let edit = try SheetInputEdit.prepare(sheetID: id, sheetName: name, epoch: epoch, kind: kind,
      recordKey: key, replacement: replacement, grid: values[0].rows, kitty: values[1].rows, goalNames: goals)
    guard edit.schemaVersion == version else { throw GoogleSheets.ServiceError.unsupportedVersion }
    return edit
  }

  func saveInputEdit(_ edit: SheetInputEdit, client: GoogleSheets? = nil) async throws {
    if let reason = inputEditRestriction { throw KittyError.message(reason) }
    try edit.validate()
    guard selectedSheetID == edit.sheetID, googleEpoch == edit.connectionEpoch,
      household?.sheetVersion == edit.schemaVersion else {
      throw KittyError.message("Your Sheet connection changed. Review the input again before saving.")
    }
    busy = true; inputEditBusy = true; error = nil
    defer { busy = false; inputEditBusy = false }
    let google = client ?? sheets
    var intentStarted = false
    var mayHaveWritten = false
    do {
      if edit.kind == .leadGoal {
        let names = try inputGoalNames(await google.batchGet(spreadsheetID: edit.sheetID,
          ranges: ["Goals!A1:D"], renderFormulas: true)[0].rows)
        _ = try edit.kind.replacement(text: edit.replacement.displayString, goalNames: names)
      }
      guard googleEpoch == edit.connectionEpoch, selectedSheetID == edit.sheetID else { throw CancellationError() }
      _ = try await google.writeAndVerify(spreadsheetID: edit.sheetID, range: edit.range,
        recordKey: edit.recordKey, expected: [[edit.before]], replacement: [[edit.replacement]],
        expectedVersion: edit.schemaVersion, willWrite: {
          guard self.googleEpoch == edit.connectionEpoch, self.selectedSheetID == edit.sheetID else {
            throw CancellationError()
          }
          intentStarted = true
          try self.persistInputEdit(edit)
          mayHaveWritten = true
        })
    } catch {
      let rejected: Bool
      if let failure = error as? GoogleSheets.ServiceError {
        switch failure {
        case .writePermissionDenied, .permissionDenied, .reconnect: rejected = true
        default: rejected = false
        }
      } else { rejected = false }
      if intentStarted && (!mayHaveWritten || rejected) { try finishInputEdit(edit, outcome: .notWritten) }
      throw error
    }
    guard googleEpoch == edit.connectionEpoch, selectedSheetID == edit.sheetID else { throw CancellationError() }
    try finishInputEdit(edit, outcome: .verified)
    await refreshSnapshot()
    notice = error == nil ? "Your change was saved and checked in the Sheet."
      : "Your change was verified in the Sheet. Refresh again to update the displayed figures."
  }

  /// Read-only reconciliation. It never replays a timed-out PUT or assumes an absent value proves failure.
  func checkPendingInputEdit(client: GoogleSheets? = nil) async throws {
    guard !busy, !inputEditBusy, !importBusy, !importEvidenceLoading, !setupBusy, !goalBusy, !disconnecting,
      !inputEditLoadBlocked, let edit = pendingInputEdit else {
      throw KittyError.message("Wait for the current operation before checking this input change.")
    }
    try edit.validate()
    guard !isDemo, mode == .connected, selectedSheetID == edit.sheetID else {
      throw KittyError.message("Reconnect to the Sheet used for this change, then check its saved review.")
    }
    busy = true; inputEditBusy = true
    defer { busy = false; inputEditBusy = false }
    let epoch = googleEpoch
    if edit.outcome != .unverified {
      try finishInputEdit(edit, outcome: edit.outcome)
      notice = edit.outcome == .verified ? "The verified input change is resolved." : "The rejected input change is cleared. You can review a new change."
      return
    }
    let values = try await (client ?? sheets).batchGet(spreadsheetID: edit.sheetID,
      ranges: [edit.kind.readRange, "Kitty!A1:C"], renderFormulas: true)
    guard googleEpoch == epoch, selectedSheetID == edit.sheetID else { throw CancellationError() }
    let current = try SheetInputEdit.currentInput(kind: edit.kind, recordKey: edit.recordKey, grid: values[0].rows)
    guard try SheetInputEdit.currentVersion(values[1].rows) == edit.schemaVersion,
      current.row == edit.row, GoogleSheets.equalCells([[current.value]], [[edit.replacement]]) else {
      throw KittyError.message("The reviewed value is not confirmed in this row. The recovery record is retained. Open the Sheet to check it; this action never resends the edit.")
    }
    try finishInputEdit(edit, outcome: .verified)
    await refreshSnapshot()
    notice = "The reviewed input value is confirmed in your Sheet."
  }

  /// A fresh read for a deliberate recovery choice. Reordered rows are allowed, ambiguous keys are not.
  func observePendingInputEdit(client: GoogleSheets? = nil) async throws -> SheetInputObservation {
    let edit = try pendingEditForObservation()
    busy = true; inputEditBusy = true
    defer { busy = false; inputEditBusy = false }
    return try await readInputObservation(edit, client: client ?? sheets)
  }

  /// Ends the app's hold only after a second read matches the explicit review and a protected archive exists.
  /// This never sends or cancels a Google write and never marks the original request as verified.
  func archivePendingInputEdit(observation: SheetInputObservation, client: GoogleSheets? = nil) async throws {
    let edit = try pendingEditForObservation()
    guard observation.editID == edit.id, observation.sheetID == edit.sheetID,
      observation.connectionEpoch == googleEpoch, observation.schemaVersion == edit.schemaVersion else {
      throw KittyError.message("The connection or saved change changed. Review the current Sheet value again.")
    }
    busy = true; inputEditBusy = true
    defer { busy = false; inputEditBusy = false }
    let current = try await readInputObservation(edit, client: client ?? sheets)
    guard current.row == observation.row, current.schemaVersion == observation.schemaVersion,
      GoogleSheets.equalCells([[current.value]], [[observation.value]]) else {
      throw KittyError.message("The current input changed after your review. Read it again before ending recovery.")
    }
    let archive = SheetInputRecoveryArchive(original: edit, observation: current, acceptedAt: Date())
    let data = try JSONEncoder().encode(archive)
    let archiveURL = inputEditURL.deletingLastPathComponent()
      .appendingPathComponent("input-edit-archive-\(edit.id.uuidString)-\(UUID().uuidString).json")
    do {
      if let inputEditPersistence { try inputEditPersistence(data, archiveURL) }
      else { try persist(data, at: archiveURL) }
      guard try Data(contentsOf: archiveURL) == data else {
        throw KittyError.message("The recovery archive could not be checked.")
      }
    } catch {
      throw KittyError.message("The unresolved change could not be archived safely. Its active recovery record is retained.")
    }
    do {
      if FileManager.default.fileExists(atPath: inputEditURL.path) {
        if let inputEditRemoval { try inputEditRemoval(inputEditURL) }
        else { try FileManager.default.removeItem(at: inputEditURL) }
      }
    } catch {
      throw KittyError.message("The unresolved change is archived, but its active recovery record could not be cleared. Check recovery again before editing.")
    }
    pendingInputEdit = nil
    inputEditLoadBlocked = false
    await refreshSnapshot()
    notice = "The current Sheet value was accepted. The original edit remains unverified in the saved recovery archive."
  }

  private func pendingEditForObservation() throws -> SheetInputEdit {
    guard !busy, !inputEditBusy, !importBusy, !importEvidenceLoading, !setupBusy, !goalBusy, !disconnecting,
      !inputEditLoadBlocked, let edit = pendingInputEdit, edit.outcome == .unverified else {
      throw KittyError.message("Wait for the current operation, then check the saved change.")
    }
    try edit.validate()
    guard !isDemo, mode == .connected, selectedSheetID == edit.sheetID else {
      throw KittyError.message("Reconnect to the Sheet used for this change before reviewing its current value.")
    }
    return edit
  }

  private func readInputObservation(_ edit: SheetInputEdit, client: GoogleSheets) async throws -> SheetInputObservation {
    let epoch = googleEpoch
    let values = try await client.batchGet(spreadsheetID: edit.sheetID,
      ranges: [edit.kind.readRange, "Kitty!A1:C"], renderFormulas: true)
    guard googleEpoch == epoch, selectedSheetID == edit.sheetID, pendingInputEdit?.id == edit.id else {
      throw CancellationError()
    }
    let version = try SheetInputEdit.currentVersion(values[1].rows)
    guard version == edit.schemaVersion else {
      throw KittyError.message("The Sheet version changed. Restore its supported input layout before resolving this edit.")
    }
    let current = try SheetInputEdit.currentInput(kind: edit.kind, recordKey: edit.recordKey,
      grid: values[0].rows, allowFormulaObservation: true)
    guard current.value.displayString.count <= 2_000 else {
      throw KittyError.message("The current value is too large to review here. Check this input in the Sheet.")
    }
    return SheetInputObservation(editID: edit.id, sheetID: edit.sheetID, connectionEpoch: epoch,
      schemaVersion: version, row: current.row, value: current.value, observedAt: Date())
  }

  private func inputGoalNames(_ rows: [[GoogleCell]]) throws -> [String] {
    let headers = rows.enumerated().filter { $0.element.first?.displayString == "Goal" }
    let expected = ["Goal", "Target amount ($)", "Target date", "Linked account"]
    guard headers.count == 1, expected.enumerated().allSatisfy({ $0.offset < headers[0].element.count
      && headers[0].element[$0.offset].displayString == $0.element }) else {
      throw KittyError.message("The Goals columns changed. Refresh and repair the Sheet before choosing a featured goal.")
    }
    let names = rows.dropFirst(headers[0].offset + 1).compactMap { row -> String? in
      let name = row.first?.displayString ?? ""
      return name.isEmpty ? nil : name
    }
    guard Set(names).count == names.count else { throw KittyError.message("Goal names must be unique before one can be featured.") }
    return names
  }
}
