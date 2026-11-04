import XCTest

@testable import Kitty

@MainActor final class ImportRecoveryTests: XCTestCase {
  private let mapping = [
    "date": "Date", "description": "Description", "amount": "Amount",
    "dateOrder": "dmy", "sign": "money-in-positive",
  ]
  private let original = "Date,Description,Amount\r\n03/02/2027,NEW SYNTHETIC MERCHANT,-4.50\r\n"

  private func isolatedStore() throws -> (KittyStore, () -> Void) {
    let keys = ["kitty.mode", "kitty.sheet", "kitty.sheetName", "kitty.lastSync"]
    let previous = keys.map { ($0, UserDefaults.standard.object(forKey: $0)) }
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let store = KittyStore()
    store.importStorageOverride = directory
    store.openDemo()
    return (
      store,
      {
        try? FileManager.default.removeItem(at: directory)
        for (key, value) in previous {
          if let value {
            UserDefaults.standard.set(value, forKey: key)
          } else {
            UserDefaults.standard.removeObject(forKey: key)
          }
        }
      }
    )
  }

  private func stage(_ store: KittyStore, text: String? = nil) throws {
    let text = text ?? original
    store.draft.sources = [
      ImportSource(
        id: ImportSource.digest(Data(text.utf8)), name: "synthetic.csv", text: text,
        accountId: "ACC-EVD", mapping: mapping)
    ]
    store.prepareImport()
    let row = try XCTUnwrap(store.proposal?.rows.first)
    store.chooseImportCategory(rowID: row.decisionID, categoryID: "UNCAT")
    XCTAssertEqual(store.proposal?.canCommit, true)
  }

  func testFilePickerPreservesBOMForExactByteProvenance() throws {
    let (store, cleanup) = try isolatedStore()
    defer { cleanup() }
    let bytes = Data(("\u{FEFF}" + original).utf8)
    let url = store.importStorage.appendingPathComponent("bom.csv")
    try bytes.write(to: url)
    store.addFile(url, accountID: "ACC-EVD")
    let source = try XCTUnwrap(store.draft.sources.first)
    XCTAssertEqual(Data(source.text.utf8), bytes)
    XCTAssertEqual(source.id, source.sha256)
    XCTAssertEqual(source.sha256, ImportSource.digest(bytes))
  }

  func testCategoryAcknowledgementCannotSubstituteForClassification() throws {
    let (store, cleanup) = try isolatedStore()
    defer { cleanup() }
    store.draft.sources = [
      ImportSource(
        id: ImportSource.digest(Data(original.utf8)), name: "synthetic.csv", text: original,
        accountId: "ACC-EVD", mapping: mapping)
    ]
    store.prepareImport()
    let issue = try XCTUnwrap(store.proposal?.issues.first { $0.needsCategory })
    store.acknowledgeImport(issue)
    XCTAssertTrue(store.draft.accepted.isEmpty)
    XCTAssertEqual(store.proposal?.canCommit, false)
    store.chooseImportCategory(rowID: try XCTUnwrap(issue.rowIds?.first), categoryID: "UNCAT")
    XCTAssertEqual(store.proposal?.canCommit, true)
  }

  func testPreparedReviewCannotBeEditedOrDiscardedWhenRowsAreUnavailable() throws {
    let (store, cleanup) = try isolatedStore()
    defer { cleanup() }
    try stage(store)
    let sources = store.draft.sources.map(\.id)
    store.draft.remote = ImportRemoteBinding(
      id: "prepared_import_123", sheetID: "demo", proposalDigest: String(repeating: "a", count: 64),
      localDraftDigest: try store.draft.contentDigest(sheetID: "demo"), proposal: Data("{}".utf8),
      attempted: true, status: "unknown")
    store.proposal = nil
    store.editImport { $0.sources.removeAll() }
    store.discardImport()
    XCTAssertEqual(store.draft.sources.map(\.id), sources)
    XCTAssertNotNil(store.draft.remote)
    XCTAssertFalse(store.importCanDiscard)
  }

  func testPersistenceFailureStopsBeforePracticeReceiptAndNeverClaimsSuccess() async throws {
    let (store, cleanup) = try isolatedStore()
    defer { cleanup() }
    try stage(store)
    store.importPersistence = { _, _ in throw CocoaError(.fileWriteOutOfSpace) }
    await store.commitImport()
    XCTAssertNotNil(store.error)
    XCTAssertFalse(store.importState?.contains("Practice complete") ?? false)
    let files = try FileManager.default.contentsOfDirectory(
      at: store.importStorage, includingPropertiesForKeys: nil)
    XCTAssertFalse(files.contains { $0.lastPathComponent.hasPrefix("practice-receipt-") })
    XCTAssertEqual(store.draft.sources.count, 1)
    XCTAssertEqual(store.proposal?.rows.count, 1)
  }

  func testPracticeReceiptRetainsOriginalsAndReplaySurvivesRelaunchAndNewDraft() async throws {
    let (store, cleanup) = try isolatedStore()
    defer { cleanup() }
    try stage(store)
    await store.commitImport()
    XCTAssertNil(store.error)
    XCTAssertTrue(store.importState?.contains("Practice complete") ?? false)
    let files = try FileManager.default.contentsOfDirectory(
      at: store.importStorage, includingPropertiesForKeys: nil)
    let url = try XCTUnwrap(files.first { $0.lastPathComponent.hasPrefix("practice-receipt-") })
    let receipt = try JSONDecoder().decode(DemoImportReceipt.self, from: Data(contentsOf: url))
    XCTAssertEqual(receipt.sources.first?.text, original)
    XCTAssertEqual(try receipt.validatedRows().count, 1)

    let relaunched = KittyStore()
    relaunched.importStorageOverride = store.importStorage
    relaunched.openDemo()
    XCTAssertEqual(relaunched.proposal?.rows.count, 0)
    XCTAssertEqual(relaunched.proposal?.counts?.existing, 1)
    relaunched.discardImport()
    relaunched.draft.sources = receipt.sources
    relaunched.prepareImport()
    XCTAssertEqual(relaunched.proposal?.rows.count, 0)
    XCTAssertEqual(relaunched.proposal?.counts?.existing, 1)
    XCTAssertEqual(relaunched.proposal?.counts?.possibleExisting, 0)
  }

  func testCorruptEarlierReceiptBlocksAnotherPracticeSave() async throws {
    let (store, cleanup) = try isolatedStore()
    defer { cleanup() }
    try stage(store)
    try Data("corrupt".utf8).write(
      to: store.importStorage.appendingPathComponent("practice-receipt-broken.json"))
    await store.commitImport()
    XCTAssertNotNil(store.error)
    XCTAssertFalse(store.importState?.contains("Practice complete") ?? false)
    let receipts = try FileManager.default.contentsOfDirectory(
      at: store.importStorage, includingPropertiesForKeys: nil
    )
    .filter { $0.lastPathComponent.hasPrefix("practice-receipt-") }
    XCTAssertEqual(receipts.count, 1)
  }

  func testPreparedBindingRejectsDifferentSheetSourceAndReviewChoices() throws {
    var draft = ImportDraft()
    draft.sources = [
      ImportSource(id: "source", name: "test.csv", text: original, accountId: "A", mapping: mapping)
    ]
    draft.accepted = ["key-b", "key-a"]
    let remote = ImportRemoteBinding(
      id: "prepared_import_123", sheetID: "sheet_a",
      proposalDigest: String(repeating: "a", count: 64),
      localDraftDigest: try draft.contentDigest(sheetID: "sheet_a"), proposal: Data("{}".utf8),
      attempted: false, status: "proposed")
    draft.remote = remote
    XCTAssertTrue(try remote.matches(draft: draft, sheetID: "sheet_a"))
    draft.accepted.reverse()
    XCTAssertTrue(try remote.matches(draft: draft, sheetID: "sheet_a"))
    XCTAssertFalse(try remote.matches(draft: draft, sheetID: "sheet_b"))
    draft.categories["row"] = "FOOD"
    XCTAssertFalse(try remote.matches(draft: draft, sheetID: "sheet_a"))
    draft.categories = [:]
    draft.sources[0].accountId = "B"
    XCTAssertFalse(try remote.matches(draft: draft, sheetID: "sheet_a"))
  }

  func testLegacyReceiptIsRecoveryOnlyAndCannotBecomeFreshApproval() throws {
    let data = Data("{\"sources\":[],\"remoteImportID\":\"old_import_receipt\"}".utf8)
    let draft = try JSONDecoder().decode(ImportDraft.self, from: data)
    let remote = try XCTUnwrap(draft.remote)
    XCTAssertTrue(remote.recoveryOnly)
    XCTAssertFalse(try remote.matches(draft: draft, sheetID: "sheet_a"))
  }

  func testPendingOnlyIsNotLabelledAlreadyImported() throws {
    let data = Data(
      """
      {"rows":[],"issues":[],"canCommit":false,"counts":{"source":1,"parsed":0,"pending":1,"invalid":0,"overlap":0,"existing":0,"possibleExisting":0,"proposed":0,"review":0,"errors":0},"excluded":[],"duplicates":[]}
      """.utf8)
    let proposal = try JSONDecoder().decode(ImportProposal.self, from: data)
    XCTAssertTrue(proposal.noOpMessage?.contains("pending") ?? false)
    XCTAssertFalse(proposal.noOpMessage?.contains("already recorded") ?? true)
  }

  func testDuplicateCandidateWithoutClassificationRemainsReviewable() throws {
    let row: [String: Any] = [
      "id": "KI-example", "date": "2027-02-03", "accountId": "A", "description": "Coffee",
      "amountMinor": "-450", "sourceRefs": [["fileId": "source", "row": 2]],
    ]
    let data = try JSONSerialization.data(withJSONObject: [
      "rows": [], "issues": [], "canCommit": false,
      "duplicates": [["rowId": "KI-example", "reason": "possible-existing", "candidate": row]],
    ])
    let proposal = try JSONDecoder().decode(ImportProposal.self, from: data)
    XCTAssertEqual(proposal.duplicates?.first?.candidate?.displayMerchant, "Coffee")
  }

  func testServiceNestedRecoveryMessageIsShownWithoutLosingErrorCode() async throws {
    let client = ImportServiceClient(
      baseURL: URL(string: "https://example.invalid")!, token: "synthetic",
      transport: { request in
        let body = try JSONSerialization.data(withJSONObject: [
          "error": [
            "code": "sheet_import_pending", "message": "Check the original import first.",
            "recovery": [
              "sheetId": "synthetic_sheet_123", "importId": "earlier_import_123",
              "proposalDigest": String(repeating: "b", count: 64),
            ],
          ]
        ])
        return (
          body,
          HTTPURLResponse(url: request.url!, statusCode: 409, httpVersion: nil, headerFields: nil)!
        )
      })
    do {
      _ = try await client.status(sheetID: "sheet_a", id: "prepared_import_123")
      XCTFail("A conflict response cannot be successful.")
    } catch let error as ImportServiceFailure {
      XCTAssertEqual(error.code, "sheet_import_pending")
      XCTAssertEqual(error.localizedDescription, "Check the original import first.")
      XCTAssertEqual(error.recovery?.importId, "earlier_import_123")
      XCTAssertTrue(error.recovery?.isValid(for: "synthetic_sheet_123") == true)
    }
  }

  func testStatusRecoveryUsesExactSheetAndReceiptWithoutProposalRows() async throws {
    let client = ImportServiceClient(
      baseURL: URL(string: "https://example.invalid")!, token: "synthetic",
      transport: { request in
        XCTAssertEqual(request.httpMethod, "GET")
        XCTAssertEqual(request.url?.path, "/v1/imports/prepared_import_123/status")
        XCTAssertEqual(
          URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems?.first?
            .value, "sheet_a")
        let body = Data(
          "{\"importId\":\"prepared_import_123\",\"status\":\"verified\",\"proposalDigest\":\"\(String(repeating: "a", count: 64))\"}"
            .utf8)
        return (
          body,
          HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
        )
      })
    let result = try await client.status(sheetID: "sheet_a", id: "prepared_import_123")
    XCTAssertEqual(result.status, "verified")
  }

  private func heldImport(sheet: String = "synthetic_sheet_123", id: String = "earlier_import_123")
    -> ImportServiceFailure
  {
    ImportServiceFailure(
      code: "sheet_import_pending", message: "Check the earlier import first.", statusCode: 409,
      recovery: ImportRecoveryDescriptor(
        sheetId: sheet, importId: id, proposalDigest: String(repeating: "b", count: 64)))
  }

  func testDiscoveredHoldIsDurableRecoveryOnlyAndPreservesUnrelatedStagedFiles() throws {
    let (store, cleanup) = try isolatedStore()
    defer { cleanup() }
    store.mode = .connected
    store.selectedSheetID = "synthetic_sheet_123"
    try stage(store)
    let originalSources = store.draft.sources.map(\.id)
    XCTAssertTrue(try store.recoverImportHold(from: heldImport(), sheetID: store.selectedSheetID))
    XCTAssertTrue(store.draft.remote?.recoveryOnly == true)
    XCTAssertNil(store.proposal)
    XCTAssertFalse(
      try XCTUnwrap(store.draft.remote).matches(draft: store.draft, sheetID: store.selectedSheetID))
    let saved = try JSONDecoder().decode(ImportDraft.self, from: Data(contentsOf: store.draftURL))
    XCTAssertEqual(saved.remote?.id, "earlier_import_123")
    XCTAssertEqual(saved.sources.map(\.id), originalSources)
    let reopened = saved.afterVerifiedReceipt()
    XCTAssertNil(reopened.remote)
    XCTAssertEqual(
      reopened.sources.map(\.id), originalSources,
      "Checking an earlier receipt must not discard this new review.")
  }

  func testHoldForAnotherSheetCannotFreezeCurrentReview() throws {
    let (store, cleanup) = try isolatedStore()
    defer { cleanup() }
    store.mode = .connected
    store.selectedSheetID = "synthetic_sheet_123"
    XCTAssertFalse(
      try store.recoverImportHold(
        from: heldImport(sheet: "other_sheet_123"), sheetID: store.selectedSheetID))
    XCTAssertNil(store.draft.remote)
  }

  func testDiscoveredHoldCannotOverwriteAnExistingReceipt() throws {
    let (store, cleanup) = try isolatedStore()
    defer { cleanup() }
    store.mode = .connected
    store.selectedSheetID = "synthetic_sheet_123"
    XCTAssertTrue(try store.recoverImportHold(from: heldImport(), sheetID: store.selectedSheetID))
    XCTAssertFalse(
      try store.recoverImportHold(
        from: heldImport(id: "different_import_123"), sheetID: store.selectedSheetID))
    XCTAssertEqual(store.draft.remote?.id, "earlier_import_123")
  }

  func testFailedRecoveryPersistenceDoesNotLoseOrUnfreezeTheReceipt() throws {
    let (store, cleanup) = try isolatedStore()
    defer { cleanup() }
    store.mode = .connected
    store.selectedSheetID = "synthetic_sheet_123"
    store.importPersistence = { _, _ in throw CocoaError(.fileWriteOutOfSpace) }
    XCTAssertThrowsError(
      try store.recoverImportHold(from: heldImport(), sheetID: store.selectedSheetID))
    XCTAssertEqual(store.draft.remote?.id, "earlier_import_123")
    XCTAssertFalse(store.importCanDiscard)
  }
}
