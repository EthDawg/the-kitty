import XCTest

@testable import Kitty

@MainActor final class IdentityTests: XCTestCase {
  func testRefreshCannotReleaseAnotherOperationOrReplaceItsState() async {
    let store = KittyStore()
    store.openDemo()
    store.mode = .connected
    store.selectedSheetID = "synthetic_sheet_inflight_123"
    store.busy = true
    store.error = "Existing operation result"
    await store.refresh()
    XCTAssertTrue(store.busy, "A skipped refresh must not release another operation's gate.")
    XCTAssertEqual(store.error, "Existing operation result")
    XCTAssertEqual(store.selectedSheetID, "synthetic_sheet_inflight_123")
  }

  func testViewOnlyConnectionCannotStartNewImport() async {
    let store = KittyStore()
    store.openDemo()
    store.mode = .connected
    store.selectedSheetID = "synthetic_sheet_readonly_123"
    store.sheetCanEdit = false
    await store.commitImport()
    XCTAssertTrue(store.error?.contains("cannot save new imports") == true)
    XCTAssertFalse(store.importBusy)
    XCTAssertNil(store.draft.remote)
  }

  func testDemoSwitchWaitsForActiveImportVerification() {
    let store = KittyStore()
    store.openDemo()
    store.mode = .connected
    store.selectedSheetID = "synthetic_sheet_busy_123"
    store.importBusy = true
    store.openDemo()
    XCTAssertEqual(store.mode, .connected)
    XCTAssertEqual(store.selectedSheetID, "synthetic_sheet_busy_123")
    XCTAssertNotNil(store.error)
  }

  func testUnavailableAuthenticationPreservesPendingReview() async throws {
    let store = KittyStore()
    store.openDemo()
    guard !store.google.isConfigured else {
      throw XCTSkip("This test requires the unconfigured development build.")
    }
    store.draft.sources = [
      ImportSource(
        id: "test-source", name: "statement.csv", text: "Date,Amount\n2027-01-01,-10.00",
        accountId: "ACC-EVD")
    ]
    await store.connect()
    XCTAssertEqual(
      store.draft.sources.count, 1, "A failed connection must not destroy a pending review.")
    XCTAssertEqual(store.household?.household, "The Davies")
    XCTAssertNotNil(store.error)
  }
}

@MainActor final class PickerCallbackTests: XCTestCase {
  func testPickerRequiresExactlyOneExplicitlySelectedFile() throws {
    XCTAssertEqual(
      try GoogleConnection.selectedSheetIDs(from: [
        URLQueryItem(name: "picked_file_ids", value: "synthetic_sheet_12345")
      ]), ["synthetic_sheet_12345"])
    XCTAssertThrowsError(try GoogleConnection.selectedSheetIDs(from: []))
    XCTAssertThrowsError(
      try GoogleConnection.selectedSheetIDs(from: [
        URLQueryItem(name: "picked_file_ids", value: "a,b")
      ]))
    XCTAssertThrowsError(
      try GoogleConnection.selectedSheetIDs(from: [
        URLQueryItem(name: "picked_file_ids", value: "../../tokens")
      ]))
  }
}
