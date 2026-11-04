import XCTest
@testable import Kitty

@MainActor final class HouseholdSetupRecoveryTests: XCTestCase {
  private func isolatedStore() throws -> (KittyStore, () -> Void) {
    let previousCleanup = UserDefaults.standard.object(forKey: KittyStore.setupCleanupKey)
    UserDefaults.standard.removeObject(forKey: KittyStore.setupCleanupKey)
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let store = KittyStore(setupStorage: directory)
    return (store, {
      try? FileManager.default.removeItem(at: directory)
      if let previousCleanup { UserDefaults.standard.set(previousCleanup, forKey: KittyStore.setupCleanupKey) }
      else { UserDefaults.standard.removeObject(forKey: KittyStore.setupCleanupKey) }
    })
  }

  private func pending() throws -> HouseholdSetupDraft {
    let input: [String: Any] = ["profile": "au-aud-basic", "sheetVersion": 1, "country": "AU", "currency": "AUD",
      "householdName": "The Fixture", "people": ["Jamie"], "openingDate": "2027-01-31",
      "accounts": [["id": "CASH", "name": "Everyday", "institution": "Fictional Bank",
        "type": "Transaction", "owner": "Jamie", "openingMinor": "12345"]],
      "budgets": [Any](), "emergencyAccountId": NSNull(), "goal": NSNull(),
      "capacity": ["transactions": 2000, "payslips": 500, "valuations": 500]]
    var summary = input.filter { !["profile", "sheetVersion", "country"].contains($0.key) }
    summary["firstImportDate"] = "2027-02-01"
    summary["openingCashMinor"] = "12345"
    summary["unavailableModules"] = ["tax", "mortgage", "whole-household net worth", "assets", "subscriptions", "savings opportunities"]
    summary["initialState"] = "Opening balances only; no imported or closed periods."
    let data = try JSONSerialization.data(withJSONObject: input, options: [.sortedKeys])
    var draft = HouseholdSetupDraft()
    draft.householdName = "The Fixture"
    draft.approvedInput = data
    draft.reservation = HouseholdSetupReservation(setupId: "synthetic_setup_123456",
      createIntentId: "synthetic_create_intent_123456", initializeIntentId: "synthetic_initialize_intent_123456",
      proposalDigest: String(repeating: "a", count: 64), ownerPermissionId: "synthetic_owner_123456",
      sourceSha256: KittyStore.setupSourceHash,
      inputSha256: "37ac7504b4d1dab0e97b3d9b520de7d86dd3c44f3419a6a52ed56de05cbf437b",
      normalizedInputData: data, reviewSummaryData: try JSONSerialization.data(withJSONObject: summary))
    try draft.reservation!.validate()
    return draft
  }

  private func result(_ status: HouseholdSetupStatus, setupId: String = "synthetic_setup_123456") -> HouseholdSetupResult {
    HouseholdSetupResult(setupId: setupId, proposalDigest: String(repeating: "a", count: 64),
      ownerPermissionId: "synthetic_owner_123456", status: status,
      phase: status == .verified ? .complete : .create, canContinue: false, canCancel: false,
      sheetId: status == .verified ? "synthetic_sheet_123456" : nil, issues: [])
  }

  func testPendingSetupSurvivesReloadDisconnectAndDiscardAttempt() throws {
    let (store, cleanup) = try isolatedStore(); defer { cleanup() }
    store.setupDraft = try pending()
    try store.saveHouseholdSetup()
    let original = try Data(contentsOf: store.householdSetupURL)
    store.setupDraft = HouseholdSetupDraft()
    store.loadHouseholdSetup()
    XCTAssertTrue(store.setupDraft.isUnresolved)
    XCTAssertFalse(store.setupLoadBlocked)
    XCTAssertTrue(store.clearHouseholdSetupForDisconnect())
    store.discardHouseholdSetup()
    XCTAssertEqual(try Data(contentsOf: store.householdSetupURL), original)
    XCTAssertNotNil(store.setupDraft.reservation)
  }

  func testCorruptFileIsPreservedAndCannotBeOverwrittenOrDiscarded() throws {
    let (store, cleanup) = try isolatedStore(); defer { cleanup() }
    let original = Data("interrupted recovery file".utf8)
    try original.write(to: store.householdSetupURL)
    store.loadHouseholdSetup()
    XCTAssertTrue(store.setupLoadBlocked)
    XCTAssertThrowsError(try store.saveHouseholdSetup())
    store.discardHouseholdSetup()
    XCTAssertTrue(store.clearHouseholdSetupForDisconnect())
    XCTAssertEqual(try Data(contentsOf: store.householdSetupURL), original)
  }

  func testCorruptedReservationIsRejectedBeforePublishingRestoredState() throws {
    let (store, cleanup) = try isolatedStore(); defer { cleanup() }
    let draft = try pending()
    for field in ["sourceSha256", "inputSha256", "setupId", "reviewSummaryData"] {
      var json = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(draft)) as? [String: Any])
      var reservation = try XCTUnwrap(json["reservation"] as? [String: Any])
      reservation[field] = field == "reviewSummaryData" ? Data("{}".utf8).base64EncodedString()
        : field == "setupId" ? "short" : String(repeating: "0", count: 64)
      json["reservation"] = reservation
      let bytes = try JSONSerialization.data(withJSONObject: json)
      try bytes.write(to: store.householdSetupURL)
      store.setupDraft = HouseholdSetupDraft(); store.setupLoadBlocked = false
      store.loadHouseholdSetup()
      XCTAssertTrue(store.setupLoadBlocked, field)
      XCTAssertNil(store.setupDraft.reservation, field)
      XCTAssertEqual(try Data(contentsOf: store.householdSetupURL), bytes)
    }
  }

  func testMismatchedResultOrApprovalCannotUnlockSavedSetup() throws {
    let (store, cleanup) = try isolatedStore(); defer { cleanup() }
    for variant in 0...2 {
      var draft = try pending()
      if variant == 0 { draft.lastResult = result(.verified, setupId: "other_setup_123456") }
      if variant == 1 { draft.approvedInput = Data("{}".utf8) }
      if variant == 2 { draft.reservation = nil; draft.lastResult = result(.cancelled) }
      try JSONEncoder().encode(draft).write(to: store.householdSetupURL)
      store.setupDraft = HouseholdSetupDraft(); store.setupLoadBlocked = false
      store.loadHouseholdSetup()
      XCTAssertTrue(store.setupLoadBlocked)
      XCTAssertNil(store.setupDraft.lastResult)
    }
  }

  func testFailedStatusSavePreservesEarlierDurableReservation() throws {
    let (store, cleanup) = try isolatedStore(); defer { cleanup() }
    store.setupDraft = try pending()
    try store.saveHouseholdSetup()
    let earlier = try Data(contentsOf: store.householdSetupURL)
    store.setupDraft.lastResult = result(.unknown)
    store.setupPersistence = { _, _ in throw CocoaError(.fileWriteOutOfSpace) }
    XCTAssertThrowsError(try store.saveHouseholdSetup())
    XCTAssertEqual(try Data(contentsOf: store.householdSetupURL), earlier)
    store.setupPersistence = nil
    store.loadHouseholdSetup()
    XCTAssertNil(store.setupDraft.lastResult)
    XCTAssertTrue(store.setupDraft.isUnresolved)
  }

  func testOnlyUnsubmittedOrConfirmedTerminalSetupsAreRemovedOnDisconnect() throws {
    let (store, cleanup) = try isolatedStore(); defer { cleanup() }
    for status in [nil, HouseholdSetupStatus.verified, .cancelled] as [HouseholdSetupStatus?] {
      store.setupDraft = status == nil ? HouseholdSetupDraft() : try pending()
      if let status { store.setupDraft.lastResult = result(status) }
      try store.saveHouseholdSetup()
      XCTAssertTrue(store.clearHouseholdSetupForDisconnect())
      XCTAssertFalse(FileManager.default.fileExists(atPath: store.householdSetupURL.path))
      XCTAssertNil(store.setupDraft.reservation)
    }
  }

  func testFailedDisconnectCleanupHidesDraftAndRetriesBeforeRestoring() throws {
    let (store, cleanup) = try isolatedStore(); defer { cleanup() }
    store.setupDraft.householdName = "Previous identity's household"
    try store.saveHouseholdSetup()
    store.setupRemoval = { _ in throw CocoaError(.fileWriteNoPermission) }
    XCTAssertFalse(store.clearHouseholdSetupForDisconnect())
    XCTAssertTrue(store.setupDraft.householdName.isEmpty)
    XCTAssertTrue(store.setupLoadBlocked)
    XCTAssertTrue(UserDefaults.standard.bool(forKey: KittyStore.setupCleanupKey))
    XCTAssertTrue(FileManager.default.fileExists(atPath: store.householdSetupURL.path))
    store.loadHouseholdSetup()
    XCTAssertTrue(store.setupDraft.householdName.isEmpty)
    XCTAssertTrue(store.setupLoadBlocked)
    store.setupRemoval = nil
    store.loadHouseholdSetup()
    XCTAssertFalse(store.setupLoadBlocked)
    XCTAssertTrue(store.setupDraft.householdName.isEmpty)
    XCTAssertFalse(FileManager.default.fileExists(atPath: store.householdSetupURL.path))
    XCTAssertFalse(UserDefaults.standard.bool(forKey: KittyStore.setupCleanupKey))
  }

  func testStartingAnotherHouseholdClearsOnlyConfirmedTerminalSetup() throws {
    let (store, cleanup) = try isolatedStore(); defer { cleanup() }
    for status in [HouseholdSetupStatus.verified, .cancelled] {
      store.setupDraft = try pending()
      store.setupDraft.lastResult = result(status)
      try store.saveHouseholdSetup()
      store.discardHouseholdSetup()
      XCTAssertFalse(store.setupDraft.isLocked)
      XCTAssertTrue(store.setupDraft.householdName.isEmpty)
      XCTAssertFalse(FileManager.default.fileExists(atPath: store.householdSetupURL.path))
    }
  }

  func testUnknownOrConflictingSetupCannotBeClearedForAnotherHousehold() throws {
    let (store, cleanup) = try isolatedStore(); defer { cleanup() }
    for status in [HouseholdSetupStatus.unknown, .conflict, .prepared, .created] {
      store.setupDraft = try pending()
      store.setupDraft.lastResult = result(status)
      try store.saveHouseholdSetup()
      let original = try Data(contentsOf: store.householdSetupURL)
      store.discardHouseholdSetup()
      XCTAssertTrue(store.setupDraft.isUnresolved)
      XCTAssertEqual(try Data(contentsOf: store.householdSetupURL), original)
    }
  }
}
