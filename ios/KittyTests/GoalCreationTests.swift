import XCTest
@testable import Kitty

@MainActor final class GoalCreationTests: XCTestCase {
  private let sheet = "fictional_goal_sheet_123"
  private let goal = GoalInput(name: "A quieter summer", targetMinor: "123456", targetDate: "2027-06-30", accountId: "ACC-SAVER", currency: "AUD")
  private func receipt(status: String = "proposed", row: Int? = nil) -> GoalServiceResult {
    GoalServiceResult(importId: "manifest_goal_123", proposalDigest: String(repeating: "a", count: 64), sheetId: sheet, protocolVersion: 3, operation: "goal-create", status: status, goal: goal, issues: [], goalRow: row)
  }
  private func binding(attempted: Bool = false) throws -> GoalRemoteBinding {
    let result = receipt()
    return GoalRemoteBinding(id: result.importId, proposalDigest: result.proposalDigest, goal: goal, localDraftDigest: try goal.bindingDigest(sheetID: sheet, version: 1), attempted: attempted, status: result.status)
  }
  private func isolatedStore() throws -> (KittyStore, () -> Void) {
    let keys = ["kitty.mode", "kitty.sheet", "kitty.sheetName", "kitty.lastSync", "kitty.goal.cleanupRequired", "kitty.setup.cleanupRequired"]
    let saved = keys.map { ($0, UserDefaults.standard.object(forKey: $0)) }
    for key in keys { UserDefaults.standard.removeObject(forKey: key) }
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let store = KittyStore(setupStorage: directory, inputEditStorage: directory, goalStorage: directory)
    store.mode = .connected; store.selectedSheetID = sheet; store.selectedSheetName = "Fictional goals"
    return (store, {
      try? FileManager.default.removeItem(at: directory)
      for (key, value) in saved { if let value { UserDefaults.standard.set(value, forKey: key) } else { UserDefaults.standard.removeObject(forKey: key) } }
    })
  }
  func testMoneyUsesExactCentsAndRejectsAmbiguousOrExcessPrecision() throws {
    XCTAssertEqual(try GoalInput.amountMinor("1234.56"), "123456")
    XCTAssertEqual(try GoalInput.amountMinor("0.01"), "1")
    XCTAssertEqual(try GoalInput.amountMinor("12.5"), "1250")
    for value in ["0", "-1", "01", "1,000", "1e3", "1.001", "NaN", "1000000000000"] {
      XCTAssertThrowsError(try GoalInput.amountMinor(value), value)
    }
  }
  func testDraftBindsExactApprovedFieldsAndCannotForgetItsReceipt() throws {
    var draft = GoalDraft(sheetID: sheet, schemaVersion: 1, approvedGoal: goal, remote: try binding(), lastResult: receipt())
    try draft.validate(); XCTAssertTrue(draft.canCommit)
    draft.approvedGoal = GoalInput(name: goal.name, targetMinor: "1", targetDate: goal.targetDate, accountId: goal.accountId, currency: goal.currency)
    XCTAssertThrowsError(try draft.validate())
    draft.approvedGoal = goal; draft.remote = nil
    XCTAssertThrowsError(try draft.validate())
    XCTAssertThrowsError(try GoalDraft(sheetID: sheet).validate())
  }
  func testVerifiedRequiresActualRowAndExactSheetDigestAndGoal() throws {
    XCTAssertThrowsError(try receipt(status: "verified").validate(sheetID: sheet))
    try receipt(status: "verified", row: 2).validate(sheetID: sheet, receiptID: "manifest_goal_123", digest: String(repeating: "a", count: 64), goal: goal)
    XCTAssertThrowsError(try receipt().validate(sheetID: "different_sheet_123"))
    XCTAssertThrowsError(try receipt().validate(sheetID: sheet, digest: String(repeating: "b", count: 64)))
  }
  func testClientSendsProtocolThreeAndRejectsUnboundPrepareResponse() async throws {
    var requests: [URLRequest] = []
    var client = ImportServiceClient(baseURL: URL(string: "https://kitty.example")!, token: "fictional")
    let response = try JSONEncoder().encode(receipt())
    client.transport = { request in
      requests.append(request)
      return (response, HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
    }
    let service = GoalServiceClient(client: client)
    _ = try await service.prepare(sheetID: sheet, version: 1, goal: goal)
    let object = try XCTUnwrap(JSONSerialization.jsonObject(with: requests[0].httpBody!) as? [String: Any])
    XCTAssertEqual(object["protocolVersion"] as? Int, 3); XCTAssertEqual(object["operation"] as? String, "goal-create")
    XCTAssertEqual((object["goal"] as? [String: Any])?["targetMinor"] as? String, "123456")
    do { _ = try await service.prepare(sheetID: "different_sheet_123", version: 1, goal: goal); XCTFail("Wrong Sheet response accepted") } catch {}
  }
  func testClientNeverReplaysAnAttemptedOrRecoveryOnlyCreate() async throws {
    var requests = 0
    var client = ImportServiceClient(baseURL: URL(string: "https://kitty.example")!, token: "fictional")
    let response = try JSONEncoder().encode(receipt())
    client.transport = { request in requests += 1; return (response, HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!) }
    let service = GoalServiceClient(client: client)
    do { _ = try await service.perform("commit", sheetID: sheet, receipt: binding(attempted: true)); XCTFail("Attempt replayed") } catch {}
    var recovery = try binding(); recovery = GoalRemoteBinding(id: recovery.id, proposalDigest: recovery.proposalDigest, goal: goal, localDraftDigest: "", attempted: false, status: "proposed")
    do { _ = try await service.perform("commit", sheetID: sheet, receipt: recovery); XCTFail("Recovery granted approval") } catch {}
    XCTAssertEqual(requests, 0)
    _ = try await service.perform("status", sheetID: sheet, receipt: binding(attempted: true)); XCTAssertEqual(requests, 1)
  }
  func testLostClientResponseDoesNotAutomaticallyRetry() async throws {
    var attempts = 0
    var client = ImportServiceClient(baseURL: URL(string: "https://kitty.example")!, token: "fictional")
    client.transport = { _ in attempts += 1; throw URLError(.timedOut) }
    do { _ = try await GoalServiceClient(client: client).perform("commit", sheetID: sheet, receipt: binding()); XCTFail("Timeout hidden") } catch {}
    XCTAssertEqual(attempts, 1)
  }
  func testDisconnectHidesFieldsAndPreservesUncertainReceipt() throws {
    let (store, cleanup) = try isolatedStore(); defer { cleanup() }
    store.goalDraft = GoalDraft(sheetID: sheet, schemaVersion: 1, approvedGoal: goal, remote: try binding(attempted: true), lastResult: receipt())
    try store.saveGoalDraft(); let before = try Data(contentsOf: store.goalDraftURL)
    XCTAssertTrue(store.clearGoalForDisconnect())
    XCTAssertNil(store.goalDraft.approvedGoal); XCTAssertNil(store.goalDraft.remote)
    XCTAssertTrue(store.goalWritesBlocked); XCTAssertEqual(try Data(contentsOf: store.goalDraftURL), before)
  }
  func testTerminalCleanupFailureBlocksNewWritesAndDoesNotForgetDiskReceipt() throws {
    let (store, cleanup) = try isolatedStore(); defer { cleanup() }
    var remote = try binding(attempted: true); remote.status = "verified"
    store.goalDraft = GoalDraft(sheetID: sheet, schemaVersion: 1, approvedGoal: goal, remote: remote, lastResult: receipt(status: "verified", row: 2))
    try store.saveGoalDraft()
    store.goalRemoval = { _ in throw CocoaError(.fileWriteNoPermission) }
    XCTAssertFalse(store.clearGoalForDisconnect()); XCTAssertTrue(store.goalLoadBlocked)
    XCTAssertTrue(FileManager.default.fileExists(atPath: store.goalDraftURL.path))
    store.goalRemoval = nil; store.loadGoalDraft()
    XCTAssertFalse(store.goalLoadBlocked); XCTAssertFalse(FileManager.default.fileExists(atPath: store.goalDraftURL.path))
  }
  func testSharedGoalRecoveryPreservesStagedImportAndNeverGrantsCommit() throws {
    let (store, cleanup) = try isolatedStore(); defer { cleanup() }
    store.draft.boundSheetID = sheet; store.draft.accepted = ["a staged review"]
    let recovery = ImportRecoveryDescriptor(sheetId: sheet, importId: receipt().importId, proposalDigest: receipt().proposalDigest, protocolVersion: 3, operation: "goal-create", schemaVersion: 1, goal: goal)
    XCTAssertTrue(try store.adoptGoalHold(recovery)); XCTAssertTrue(store.goalDraft.isUnresolved)
    XCTAssertFalse(store.goalDraft.canCommit); XCTAssertNil(store.draft.remote)
    XCTAssertEqual(store.draft.accepted, ["a staged review"])
    let saved = try Data(contentsOf: store.goalDraftURL)
    let other = ImportRecoveryDescriptor(sheetId: sheet, importId: "another_goal_123", proposalDigest: receipt().proposalDigest, protocolVersion: 3, operation: "goal-create", schemaVersion: 1, goal: goal)
    XCTAssertThrowsError(try store.adoptGoalHold(other)); XCTAssertEqual(try Data(contentsOf: store.goalDraftURL), saved)
  }
  func testCorruptOrSignedOutRecoveryDoesNotExposeGoalFields() throws {
    let (store, cleanup) = try isolatedStore(); defer { cleanup() }
    store.goalDraft = GoalDraft(sheetID: sheet, approvedGoal: goal, remote: try binding(), lastResult: receipt())
    try store.saveGoalDraft(); store.loadGoalDraft()
    XCTAssertTrue(store.goalLoadBlocked); XCTAssertNil(store.goalDraft.displayGoal)
    try Data("broken".utf8).write(to: store.goalDraftURL)
    store.loadGoalDraft(); XCTAssertTrue(store.goalWritesBlocked); XCTAssertNil(store.goalDraft.displayGoal)
    store.discardGoalDraft(); XCTAssertEqual(try String(contentsOf: store.goalDraftURL, encoding: .utf8), "broken")
  }
}
