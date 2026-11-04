import XCTest
@testable import Kitty

@MainActor final class WriteCoordinationTests: XCTestCase {
  private func isolated() throws -> (KittyStore, () -> Void) {
    let keys = ["kitty.mode", "kitty.sheet", "kitty.sheetName", "kitty.lastSync"]
    let saved = keys.map { ($0, UserDefaults.standard.object(forKey: $0)) }
    let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let store = KittyStore(setupStorage: folder, inputEditStorage: folder, goalStorage: folder)
    store.importStorageOverride = folder
    store.openDemo()
    return (store, {
      try? FileManager.default.removeItem(at: folder)
      for (key, value) in saved {
        if let value { UserDefaults.standard.set(value, forKey: key) }
        else { UserDefaults.standard.removeObject(forKey: key) }
      }
    })
  }

  func testActiveInputOrGoalSavePreventsConnectionAndOtherWriteChanges() async throws {
    for kind in ["input", "goal"] {
      let (store, cleanup) = try isolated(); defer { cleanup() }
      store.mode = .connected
      store.selectedSheetID = "synthetic_sheet_inflight_123"
      store.sheetCanEdit = true
      let epoch = store.googleEpoch
      let goal = try XCTUnwrap(store.household?.goals.first)
      store.inputEditBusy = kind == "input"
      store.goalBusy = kind == "goal"
      await store.connect()
      await store.select(GoogleSheetFile(id: "synthetic_other_sheet_123", name: "Other", webViewLink: nil, modifiedTime: nil))
      await store.disconnect()
      store.openDemo()
      store.showWelcome()
      await store.refresh()
      await store.commitImport()
      await store.commitSourceImport(operation: "close")
      await store.createHousehold()
      do {
        try await store.updateGoal(goal, target: 100, date: "2027-12-31")
        XCTFail("An active \(kind) write must hold other Sheet updates.")
      } catch { }
      XCTAssertEqual(store.mode, .connected)
      XCTAssertEqual(store.selectedSheetID, "synthetic_sheet_inflight_123")
      XCTAssertEqual(store.googleEpoch, epoch)
      XCTAssertNil(store.draft.remote)
      XCTAssertNil(store.setupDraft.reservation)
      XCTAssertEqual(store.inputEditBusy, kind == "input")
      XCTAssertEqual(store.goalBusy, kind == "goal")
    }
  }

  func testUnreadableRecoveryHoldsNewWritesAndPreservesStagedFiles() async throws {
    for kind in ["input", "goal"] {
      let (store, cleanup) = try isolated(); defer { cleanup() }
      store.sampleImport()
      let originals = store.draft.sources.map(\.sha256)
      XCTAssertFalse(originals.isEmpty)
      store.mode = .connected
      store.selectedSheetID = "synthetic_sheet_recovery_123"
      store.sheetCanEdit = true
      store.inputEditLoadBlocked = kind == "input"
      store.goalLoadBlocked = kind == "goal"
      XCTAssertTrue(store.newSheetWritesNeedRecovery)
      await store.commitImport()
      XCTAssertTrue(store.error?.contains("Check the saved") == true)
      await store.commitSourceImport(operation: "ingest")
      XCTAssertTrue(store.error?.contains("Check the saved") == true)
      await store.createHousehold()
      XCTAssertTrue(store.error?.contains("Check the saved") == true)
      let goal = try XCTUnwrap(store.household?.goals.first)
      do {
        try await store.updateGoal(goal, target: 100, date: "2027-12-31")
        XCTFail("Unreadable \(kind) recovery must prevent a new goal edit.")
      } catch { }
      XCTAssertEqual(store.draft.sources.map(\.sha256), originals)
      XCTAssertNil(store.draft.remote)
      XCTAssertNil(store.setupDraft.reservation)
      XCTAssertFalse(store.importBusy)
      XCTAssertFalse(store.setupBusy)
    }
  }
}
