import Foundation

extension KittyStore {
  var goalDraftURL: URL { (goalStorageOverride ?? storage).appendingPathComponent("goal-review.json") }
  var goalWritesBlocked: Bool { goalLoadBlocked || goalDraft.isUnresolved }
  var goalReviewVisible: Bool {
    mode == .connected && google.isConnected && !isOffline && household != nil
      && !selectedSheetID.isEmpty && selectedSheetID == goalDraft.sheetID
  }
  private var goalCleanupKey: String { "kitty.goal.cleanupRequired" }

  func saveGoalDraft() throws {
    try goalDraft.validate()
    let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
    let data = try encoder.encode(goalDraft)
    if let goalPersistence { try goalPersistence(data, goalDraftURL) }
    else { try persist(data, at: goalDraftURL) }
  }
  private func removeGoalFile() throws {
    if let goalRemoval { try goalRemoval(goalDraftURL) }
    else if FileManager.default.fileExists(atPath: goalDraftURL.path) { try FileManager.default.removeItem(at: goalDraftURL) }
  }
  func loadGoalDraft() {
    guard !goalBusy else { return }
    goalDraft = GoalDraft(); goalLoadBlocked = false
    do {
      if UserDefaults.standard.bool(forKey: goalCleanupKey) {
        try removeGoalFile(); UserDefaults.standard.removeObject(forKey: goalCleanupKey)
      }
      guard FileManager.default.fileExists(atPath: goalDraftURL.path) else { return }
      let loaded = try JSONDecoder().decode(GoalDraft.self, from: Data(contentsOf: goalDraftURL))
      try loaded.validate()
      // A signed-out screen must not reveal the saved goal's financial fields.
      // Its disk receipt survives. Reconnect, then explicitly retry local recovery.
      guard google.isConnected else {
        goalLoadBlocked = true
        error = "Reconnect Google, then open Goals and retry the saved review. Its recovery record is preserved."
        return
      }
      goalDraft = loaded
    } catch {
      goalLoadBlocked = true
      self.error = "The saved goal review could not be restored. Its recovery file is preserved; retry local recovery before starting another goal."
    }
  }
  @discardableResult func clearGoalForDisconnect() -> Bool {
    let preserve = goalLoadBlocked || goalDraft.isUnresolved
    goalDraft = GoalDraft()
    if preserve { goalLoadBlocked = true; return true }
    UserDefaults.standard.set(true, forKey: goalCleanupKey)
    do {
      try removeGoalFile(); UserDefaults.standard.removeObject(forKey: goalCleanupKey)
      goalLoadBlocked = false; return true
    } catch { goalLoadBlocked = true; return false }
  }
  func discardGoalDraft() {
    guard !goalBusy, !goalLoadBlocked, !goalDraft.isUnresolved else {
      error = "Check or cancel this saved goal before starting another."
      return
    }
    do { try removeGoalFile(); goalDraft = GoalDraft() }
    catch { self.error = "The saved goal review could not be removed. Try again before starting another goal." }
  }

  func prepareNewGoal(_ goal: GoalInput) async {
    guard !busy, !goalBusy, !importBusy, !setupBusy, !inputEditBusy, !disconnecting else { return }
    guard !goalLoadBlocked, goalDraft.remote == nil else { error = "Check the saved goal review first."; return }
    guard !isDemo, mode == .connected, !selectedSheetID.isEmpty, sheetCanEdit else {
      error = "Connect an editable Sheet to save your own goal."; return
    }
    guard !inputEditsBlockNewWrites, !setupLoadBlocked, !setupDraft.isUnresolved, draft.remote == nil else {
      error = "Resolve the saved Sheet edit, setup or import before creating a goal."; return
    }
    guard importPublicationNotice == nil else { error = importPublicationNotice; return }
    guard let endpoint = serviceURL, let household else {
      error = "Goal creation is not configured in this development build. Open the Goals tab in your Sheet to set up a goal."; return
    }
    let id = selectedSheetID, epoch = googleEpoch
    goalBusy = true; error = nil
    defer { goalBusy = false }
    do {
      try goal.validate()
      guard goal.currency == household.currency, goal.targetDate > household.asOf,
        household.accounts.contains(where: { $0.id == goal.accountId && $0.liquid && ["Transaction", "Savings", "Offset"].contains($0.type) }),
        !household.goals.contains(where: { $0.name.trimmingCharacters(in: .whitespacesAndNewlines).localizedCaseInsensitiveCompare(goal.name) == .orderedSame }) else {
        throw KittyError.message("Choose a future target, a liquid savings account and a goal name that is not already in the Sheet.")
      }
      goalDraft = GoalDraft(sheetID: id, sheetName: selectedSheetName, schemaVersion: household.sheetVersion, approvedGoal: goal)
      try saveGoalDraft()
      let client = GoalServiceClient(client: ImportServiceClient(baseURL: endpoint, token: try await google.accessToken()))
      let result = try await client.prepare(sheetID: id, version: household.sheetVersion, goal: goal)
      guard selectedSheetID == id, googleEpoch == epoch else { return }
      goalDraft.remote = GoalRemoteBinding(id: result.importId, proposalDigest: result.proposalDigest, goal: goal, localDraftDigest: try goal.bindingDigest(sheetID: id, version: household.sheetVersion), attempted: false, status: result.status)
      goalDraft.lastResult = result
      do { try saveGoalDraft() } catch { goalLoadBlocked = true; throw error }
    } catch {
      if let failure = error as? ImportServiceFailure, let recovery = failure.recovery,
        failure.code == "sheet_import_pending", failure.statusCode == 409 {
        do { if try adoptGoalHold(recovery) { return } } catch { goalLoadBlocked = true }
      }
      recordGoalFailure(error)
    }
  }
  func commitNewGoal() async { await performGoalAction("commit") }
  func checkGoalStatus() async { await performGoalAction("status") }
  func cancelNewGoal() async { await performGoalAction("cancel") }

  private func performGoalAction(_ action: String) async {
    guard !busy, !goalBusy, !importBusy, !setupBusy, !inputEditBusy, !disconnecting,
      !goalLoadBlocked, let receipt = goalDraft.remote else { return }
    guard let endpoint = serviceURL else { error = "The Kitty service is unavailable in this build. This goal receipt is preserved for checking later."; return }
    if action == "commit" {
      guard goalDraft.canCommit, selectedSheetID == goalDraft.sheetID, mode == .connected, sheetCanEdit,
        !inputEditsBlockNewWrites, !setupLoadBlocked, !setupDraft.isUnresolved, draft.remote == nil,
        importPublicationNotice == nil else {
        error = importPublicationNotice ?? "Resolve the pending Sheet operation before saving this goal. Its receipt can still be checked or cancelled."; return
      }
    }
    goalBusy = true; error = nil
    defer { goalBusy = false }
    let epoch = googleEpoch
    do {
      try goalDraft.validate()
      guard google.isConnected else {
        throw KittyError.message("Reconnect Google in Settings and select the original Sheet before checking this goal. Its recovery record is preserved.")
      }
      guard googleEpoch == epoch else { return }
      let client = GoalServiceClient(client: ImportServiceClient(baseURL: endpoint, token: try await google.accessToken()))
      if action == "commit" {
        // Persist uncertainty BEFORE dispatch. Send the prior unattempted binding
        // once; no path can resubmit it after a process or connection failure.
        goalDraft.remote?.attempted = true
        try saveGoalDraft()
      }
      let result = try await client.perform(action, sheetID: goalDraft.sheetID, receipt: receipt)
      guard googleEpoch == epoch else { return }
      goalDraft.remote?.status = result.status
      goalDraft.lastResult = result; goalDraft.error = nil
      do { try saveGoalDraft() } catch { goalLoadBlocked = true; throw error }
      if result.status == "verified" {
        notice = "Goal saved and verified in your Sheet."
        if selectedSheetID == goalDraft.sheetID { await refreshSnapshot() }
      } else if result.status == "cancelled" { notice = "Goal creation cancelled. No goal was added by this receipt." }
    } catch { recordGoalFailure(error) }
  }
  private func recordGoalFailure(_ failure: Error) {
    goalDraft.error = failure.localizedDescription
    error = failure.localizedDescription
    if !goalDraft.sheetID.isEmpty {
      do { try saveGoalDraft() }
      catch { goalLoadBlocked = true; self.error = "The goal's latest status could not be saved. Its earlier recovery file is preserved; retry local recovery." }
    }
  }

  @discardableResult func adoptGoalHold(_ recovery: ImportRecoveryDescriptor) throws -> Bool {
    guard recovery.protocolVersion == 3, recovery.operation == "goal-create",
      recovery.isValid(for: selectedSheetID), let goal = recovery.goal,
      let version = recovery.schemaVersion, [1, 2].contains(version) else { return false }
    try goal.validate()
    guard !goalLoadBlocked, goalDraft.remote == nil || (goalDraft.remote?.id == recovery.importId && goalDraft.remote?.proposalDigest == recovery.proposalDigest) else {
      throw KittyError.message("A different saved goal receipt needs checking before this shared hold can be opened.")
    }
    var updated = goalDraft
    if updated.sheetID != selectedSheetID {
      updated = GoalDraft(sheetID: selectedSheetID, sheetName: selectedSheetName, schemaVersion: version)
    }
    updated.remote = GoalRemoteBinding(id: recovery.importId, proposalDigest: recovery.proposalDigest, goal: goal, localDraftDigest: "", attempted: true, status: "unknown")
    updated.lastResult = nil
    updated.error = "An earlier goal is awaiting verification. Open its saved review in Goals; any staged import files are preserved."
    goalDraft = updated
    try saveGoalDraft()
    error = updated.error
    return true
  }
  func moveGoalReceiptFromImport(_ result: ImportServiceResult, binding: ImportRemoteBinding) async throws {
    guard binding.recoveryOnly, let digest = result.proposalDigest, let goal = result.goal,
      result.protocolVersion == 3, result.operation == "goal-create",
      result.sheetId == selectedSheetID, let version = household?.sheetVersion else {
      throw KittyError.message("This receipt is for a goal. Open Goals to recover it; no transaction import has been confirmed.")
    }
    let recovery = ImportRecoveryDescriptor(sheetId: selectedSheetID, importId: result.importId, proposalDigest: digest, protocolVersion: 3, operation: "goal-create", schemaVersion: version, goal: goal)
    guard try adoptGoalHold(recovery) else { throw KittyError.message("The goal recovery receipt could not be adopted.") }
    // The owning client verifies goal-specific fields before this transfer can
    // remove an old generic import hold. Never accept generic 'verified'.
    guard let endpoint = serviceURL, let receipt = goalDraft.remote else { return }
    let client = GoalServiceClient(client: ImportServiceClient(baseURL: endpoint, token: try await google.accessToken()))
    let checked = try await client.perform("status", sheetID: selectedSheetID, receipt: receipt)
    goalDraft.remote?.status = checked.status; goalDraft.lastResult = checked
    try saveGoalDraft()
    draft.remote = nil; try saveDraft()
  }
}
