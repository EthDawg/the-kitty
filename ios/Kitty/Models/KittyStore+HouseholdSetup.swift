import Foundation

@MainActor extension KittyStore {
  static let setupSourceHash = "41743ff2a6bcbc21fc112656a4a3af71d9d2d233aa23657e801b3112ad4268ab"
  static let setupCleanupKey = "kitty.setupCleanupPending"

  var householdSetupURL: URL {
    (setupStorageOverride ?? storage).appendingPathComponent(
      ProcessInfo.processInfo.arguments.contains("--uitest-setup") ? "household-setup-practice.json" : "household-setup.json")
  }

  func loadHouseholdSetup() {
    guard !setupBusy else { return }
    if UserDefaults.standard.bool(forKey: Self.setupCleanupKey) {
      // A failed sign-out cleanup must never restore another identity's draft.
      _ = removeFinishedHouseholdSetup()
      return
    }
    guard FileManager.default.fileExists(atPath: householdSetupURL.path) else { return }
    do {
      let restored = try JSONDecoder().decode(HouseholdSetupDraft.self, from: Data(contentsOf: householdSetupURL))
      if let reservation = restored.reservation {
        try reservation.validate(expectedSourceSha256: Self.setupSourceHash)
        guard let approved = restored.approvedInput else {
          throw KittyError.message("The saved setup has an incomplete recovery record.")
        }
        try reservation.validateApprovedInput(approved)
        try restored.lastResult?.validate(reservation: reservation)
      } else if restored.lastResult != nil {
        throw KittyError.message("The saved setup result has no matching operation identity.")
      }
      setupDraft = restored
      setupLoadBlocked = false
    } catch {
      setupLoadBlocked = true
      self.error = "The saved household setup could not be read. Its files are preserved. Check the existing Google Sheet before starting another setup."
    }
  }

  func saveHouseholdSetup() throws {
    guard !setupLoadBlocked else { throw KittyError.message("The existing setup recovery record must be resolved first.") }
    let data = try JSONEncoder().encode(setupDraft)
    if let setupPersistence { try setupPersistence(data, householdSetupURL) }
    else { try persist(data, at: householdSetupURL) }
  }

  func saveHouseholdSetupEdits() {
    guard !setupLoadBlocked else { return }
    do { try saveHouseholdSetup() } catch { self.error = "Your setup could not be saved on this device. Free some space before creating the Sheet." }
  }

  func discardHouseholdSetup() {
    guard !setupBusy, !setupDraft.isUnresolved, !setupLoadBlocked else {
      error = "Check the pending setup first. Starting again could lose its recovery record."
      return
    }
    do {
      if FileManager.default.fileExists(atPath: householdSetupURL.path) {
        try FileManager.default.removeItem(at: householdSetupURL)
      }
      setupDraft = HouseholdSetupDraft()
    } catch { self.error = "The saved setup could not be removed. It has been preserved." }
  }

  /// An unresolved creation remains recoverable, but its financial fields are not
  /// shown by the recovery screen until the service verifies the Google identity.
  func clearHouseholdSetupForDisconnect() -> Bool {
    if setupLoadBlocked || setupDraft.isUnresolved { return true }
    return removeFinishedHouseholdSetup()
  }

  private func removeFinishedHouseholdSetup() -> Bool {
    // Hide financial fields even if the filesystem cannot complete the removal.
    setupDraft = HouseholdSetupDraft()
    UserDefaults.standard.set(true, forKey: Self.setupCleanupKey)
    do {
      if FileManager.default.fileExists(atPath: householdSetupURL.path) {
        if let setupRemoval { try setupRemoval(householdSetupURL) }
        else { try FileManager.default.removeItem(at: householdSetupURL) }
      }
      UserDefaults.standard.removeObject(forKey: Self.setupCleanupKey)
      setupLoadBlocked = false
      return true
    } catch { setupLoadBlocked = true; return false }
  }

  func createHousehold() async {
    guard !busy, !setupBusy, !importBusy, !disconnecting, !setupLoadBlocked else { return }
    guard draft.remote == nil else { error = "Resolve the pending import before creating another household."; return }
    if setupDraft.reservation != nil { await resumeHouseholdSetup(); return }
    guard serviceURL != nil else {
      error = "New household setup is not configured in this development build. Your draft stays on this device."
      return
    }
    do {
      let approved = try setupDraft.approvedPayload()
      setupDraft.approvedInput = approved
      try saveHouseholdSetup()
      setupBusy = true; busy = true; error = nil
      defer { setupBusy = false; busy = false }
      googleEpoch = UUID(); let epoch = googleEpoch
      if !google.isConnected {
        try await google.authorize(selectSheet: false)
        guard googleEpoch == epoch else { return }
        _ = clearGoogleData(removeLocalFiles: false)
      }
      let client = HouseholdSetupClient(google: google, baseURL: serviceURL)
      let reservation = try await client.reserve(input: approved, expectedSourceSha256: Self.setupSourceHash)
      guard googleEpoch == epoch else { return }
      setupDraft.reservation = reservation
      setupDraft.lastMessage = nil
      // Reserve allocates IDs only. This durable save must precede every begin.
      try saveHouseholdSetup()
      let result = try await client.begin(reservation: reservation, approvedInput: approved)
      guard googleEpoch == epoch else { return }
      try recordHouseholdSetupResult(result)
    } catch { recordHouseholdSetupFailure(error) }
  }

  func resumeHouseholdSetup() async {
    await performHouseholdSetupAction("continue")
  }
  func checkHouseholdSetup() async {
    await performHouseholdSetupAction("status")
  }
  func cancelHouseholdSetup() async {
    await performHouseholdSetupAction("cancel")
  }

  private func performHouseholdSetupAction(_ action: String) async {
    guard !busy, !setupBusy, !importBusy, !disconnecting, !setupLoadBlocked,
      let reservation = setupDraft.reservation, let approved = setupDraft.approvedInput else { return }
    guard serviceURL != nil else { error = "Reconnect to the configured Kitty service to check this setup. Its recovery record is preserved."; return }
    setupBusy = true; busy = true; error = nil
    defer { setupBusy = false; busy = false }
    googleEpoch = UUID(); let epoch = googleEpoch
    do {
      try saveHouseholdSetup()
      if !google.isConnected {
        try await google.authorize(selectSheet: false)
        guard googleEpoch == epoch else { return }
        _ = clearGoogleData(removeLocalFiles: false)
      }
      let client = HouseholdSetupClient(google: google, baseURL: serviceURL)
      let result: HouseholdSetupResult
      if action == "status" { result = try await client.status(reservation: reservation) }
      else if action == "cancel" { result = try await client.cancel(reservation: reservation) }
      else if setupDraft.lastResult?.canContinue == true {
        result = try await client.continueSetup(reservation: reservation)
      } else if setupDraft.lastResult == nil {
        // Reuse the exact manifest and intent IDs when the app stopped before begin
        // returned. The writer's one-shot intents decide whether anything may run.
        result = try await client.begin(reservation: reservation, approvedInput: approved)
      } else { throw KittyError.message("Check this setup's outcome before continuing. No new Sheet has been requested.") }
      guard googleEpoch == epoch else { return }
      try recordHouseholdSetupResult(result)
    } catch { recordHouseholdSetupFailure(error) }
  }

  private func recordHouseholdSetupResult(_ result: HouseholdSetupResult) throws {
    setupDraft.lastResult = result
    setupDraft.lastMessage = nil
    try saveHouseholdSetup()
  }

  private func recordHouseholdSetupFailure(_ failure: Error) {
    setupDraft.lastMessage = failure.localizedDescription
    do { try saveHouseholdSetup() } catch {
      self.error = "The latest setup status could not be saved. The earlier recovery record is preserved; check it before continuing."
      return
    }
    error = failure.localizedDescription
  }

  func openCreatedHousehold() async {
    guard !busy, !setupBusy, !importBusy, !disconnecting,
      setupDraft.lastResult?.status.rawValue == "verified",
      let id = setupDraft.lastResult?.sheetId else { return }
    setupBusy = true; busy = true
    let epoch = googleEpoch
    do {
      let metadata = try await sheets.metadata(spreadsheetID: id)
      guard googleEpoch == epoch else { setupBusy = false; busy = false; return }
      setupBusy = false; busy = false
      await select(GoogleSheetFile(id: id, name: metadata.properties.title,
        webViewLink: metadata.spreadsheetUrl, modifiedTime: nil))
      if selectedSheetID == id, mode == .connected { showHouseholdSetup = false; showSettings = false }
    } catch { setupBusy = false; busy = false; self.error = error.localizedDescription }
  }
}
