import XCTest

@testable import Kitty

@MainActor final class SourceStoreTests: XCTestCase {
  private func isolated() throws -> (KittyStore, () -> Void) {
    let keys = ["kitty.mode", "kitty.sheet", "kitty.sheetName", "kitty.lastSync"]
    let previous = keys.map { ($0, UserDefaults.standard.object(forKey: $0)) }
    let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let store = KittyStore(); store.importStorageOverride = folder; store.openDemo()
    return (store, {
      try? FileManager.default.removeItem(at: folder)
      for (key, value) in previous {
        if let value { UserDefaults.standard.set(value, forKey: key) }
        else { UserDefaults.standard.removeObject(forKey: key) }
      }
    })
  }
  private func payslip(_ store: KittyStore) async throws -> SourceDocument {
    let url = try XCTUnwrap(Bundle.main.url(forResource: "source-payslip-ytd", withExtension: "pdf"))
    await store.captureSource(url)
    XCTAssertNil(store.error)
    let document = try XCTUnwrap(store.draft.documents.first)
    var review = SourceReviewDraft.suggested(document: document, kind: .payslip, context: store.sourceContext)
    review.setInput("person", "Jordan")
    for spec in review.specifications where !review.input(spec.id).isEmpty {
      try review.confirm(spec.id, document: document, page: 1)
    }
    let problems = review.problems(context: store.sourceContext, document: document)
    if !problems.isEmpty { print("Source review preparation problems: \(problems)") }
    XCTAssertTrue(problems.isEmpty, problems.joined(separator: " "))
    store.editImport { $0.sourceReviews.append(review) }
    return document
  }
  func testOriginalIsPersistedBeforeExtractionAndSurvivesRelaunch() async throws {
    let (store, cleanup) = try isolated(); defer { cleanup() }
    var firstState: SourceDocument.State?
    store.importPersistence = { data, url in
      if firstState == nil { firstState = try JSONDecoder().decode(ImportDraft.self, from: data).documents.first?.state }
      try data.write(to: url, options: .atomic)
    }
    let document = try await payslip(store)
    XCTAssertEqual(firstState, .captured)
    let reopened = KittyStore(); reopened.importStorageOverride = store.importStorage; reopened.openDemo()
    XCTAssertEqual(reopened.draft.documents.first?.bytes, document.bytes)
    XCTAssertEqual(reopened.sourceProposal?.newCount, 1)
    XCTAssertTrue(reopened.sourceImportCanCommit)
  }
  func testCapturePersistenceFailureStopsBeforeExtractionAndReceipt() async throws {
    let (store, cleanup) = try isolated(); defer { cleanup() }
    store.importPersistence = { _, _ in throw CocoaError(.fileWriteOutOfSpace) }
    let url = try XCTUnwrap(Bundle.main.url(forResource: "source-payslip-ytd", withExtension: "pdf"))
    await store.captureSource(url)
    XCTAssertNotNil(store.error)
    XCTAssertEqual(store.draft.documents.first?.state, .captured)
    XCTAssertTrue(store.draft.documents.first?.pages.isEmpty == true)
    XCTAssertFalse(FileManager.default.fileExists(atPath: store.draftURL.path))
    XCTAssertFalse(store.importBusy)
  }
  func testDocumentPracticeRetainsOriginalsAndDoesNotReinsertOnReplay() async throws {
    let (store, cleanup) = try isolated(); defer { cleanup() }
    let original = try await payslip(store)
    XCTAssertEqual(store.sourceProposal?.newCount, 1)
    await store.commitImport()
    XCTAssertNil(store.error)
    XCTAssertTrue(store.importState?.contains("Practice complete") == true)
    XCTAssertEqual(store.sourceProposal?.newCount, 0)
    XCTAssertEqual(store.sourceProposal?.alreadyPresent, 1)
    let files = try FileManager.default.contentsOfDirectory(at: store.importStorage, includingPropertiesForKeys: nil)
    let path = try XCTUnwrap(files.first { $0.lastPathComponent.hasPrefix("practice-sources-") })
    let receipt = try JSONDecoder().decode(DemoSourceReceipt.self, from: Data(contentsOf: path))
    XCTAssertEqual(receipt.documents.first?.bytes, original.bytes)
    XCTAssertEqual(try receipt.validatedRecords().count, 1)
    let reopened = KittyStore(); reopened.importStorageOverride = store.importStorage; reopened.openDemo()
    XCTAssertEqual(reopened.sourceProposal?.newCount, 0)
    XCTAssertEqual(reopened.sourceProposal?.alreadyPresent, 1)
  }
  func testConfirmedFieldEditInvalidatesProposalAndSavedBinding() async throws {
    let (store, cleanup) = try isolated(); defer { cleanup() }
    _ = try await payslip(store)
    let binding = ImportRemoteBinding(id: "source_import_123", sheetID: "demo",
      proposalDigest: String(repeating: "a", count: 64), localDraftDigest: try store.draft.contentDigest(sheetID: "demo"),
      proposal: Data("{}".utf8), attempted: false, status: "proposed", protocolVersion: 2, operation: "ingest")
    XCTAssertTrue(try binding.matches(draft: store.draft, sheetID: "demo"))
    var edited = store.draft.sourceReviews[0]
    edited.setInput("netMinor", "4000.01")
    store.updateSourceReview(edited)
    XCTAssertFalse(store.sourceImportCanCommit)
    XCTAssertFalse(try binding.matches(draft: store.draft, sheetID: "demo"))
  }
  func testCloseCannotAcceptAnIntakeVerificationAsAClosedMonth() async throws {
    let (store, cleanup) = try isolated(); defer { cleanup() }
    store.selectedSheetID = "synthetic_sheet_123"
    store.draft.boundSheetID = store.selectedSheetID
    store.draft.remote = ImportRemoteBinding(id: "close_import_123", sheetID: store.selectedSheetID,
      proposalDigest: String(repeating: "a", count: 64), localDraftDigest: "digest", proposal: Data(),
      attempted: true, status: "unknown", protocolVersion: 2, operation: "close")
    let result = ImportServiceResult(importId: "close_import_123", status: "verified",
      proposalDigest: String(repeating: "a", count: 64), issues: [], verificationScope: "verified_intake",
      protocolVersion: 2, operation: "close")
    do { try await store.handleImportResult(result); XCTFail("An intake receipt cannot prove month-end close.") }
    catch { XCTAssertTrue(error.localizedDescription.contains("not verified")) }
    XCTAssertNotNil(store.draft.remote)
    XCTAssertFalse(store.importState?.contains("Month closed") == true)
  }
  func testMonthPracticeReportsMissingEvidenceAndDoesNotAdvanceAsOf() async throws {
    let (store, cleanup) = try isolated(); defer { cleanup() }
    let asOf = store.household?.asOf
    await store.preparePeriodClose(periodEnd: "2027-02-28")
    XCTAssertEqual(store.closeProposal?.canClose, false)
    XCTAssertFalse(store.closeProposal?.issues.isEmpty ?? true)
    await store.commitSourceImport(operation: "close")
    XCTAssertNotNil(store.error)
    XCTAssertEqual(store.household?.asOf, asOf)
    XCTAssertNil(store.draft.remote)
  }
  func testLegacyDraftDefaultsAndCloseReceiptPreserveStagedOriginals() throws {
    let legacy = try JSONDecoder().decode(ImportDraft.self, from: Data("{\"sources\":[]}".utf8))
    XCTAssertTrue(legacy.documents.isEmpty)
    XCTAssertTrue(legacy.sourceReviews.isEmpty)
    var draft = ImportDraft()
    draft.documents = [SourceDocument(name: "original.pdf", mimeType: "application/pdf", bytes: Data("%PDF-original".utf8))]
    draft.closeReview = PeriodCloseDraft(periodEnd: "2027-02-28")
    draft.remote = ImportRemoteBinding(id: "close_import_123", sheetID: "sheet", proposalDigest: "digest",
      localDraftDigest: "local", proposal: Data("{}".utf8), attempted: true, status: "verified", protocolVersion: 2, operation: "close")
    let after = draft.afterVerifiedReceipt()
    XCTAssertEqual(after.documents.first?.id, draft.documents.first?.id)
    XCTAssertNil(after.closeReview)
    XCTAssertNil(after.remote)
  }
  func testOneCSVCanProvideTransactionAndBalanceEvidenceWithoutDuplicateUpload() throws {
    let (store, cleanup) = try isolated(); defer { cleanup() }
    let text = "\u{FEFF}Date,Description,Amount\r\n01/02/2027,Coffee,-0.29\r\n"
    let bytes = Data(text.utf8)
    let document = SourceDocument(name: "original.csv", mimeType: "text/csv", bytes: bytes)
    store.draft.documents = [document]
    store.draft.sources = [ImportSource(id: document.id, name: "original.csv", text: text,
      accountId: "ACC-EVD", mapping: ["amount": "Amount"])]
    let files = try store.sourceFilesForUpload()
    XCTAssertEqual(files.count, 1)
    XCTAssertEqual(files.first?["text"] as? String, text)
    XCTAssertEqual(files.first?["accountId"] as? String, "ACC-EVD")
    XCTAssertEqual(files.first?["byteLength"] as? Int, bytes.count)
    XCTAssertNil(files.first?["bytesBase64"])
  }
  func testCombinedPracticeWritesOneReceiptAndReplaysNeitherKindTwice() async throws {
    let (store, cleanup) = try isolated(); defer { cleanup() }
    _ = try await payslip(store)
    let text = "Date,Description,Amount\n2027-02-03,SYNTHETIC UNIQUE PURCHASE,-0.29\n"
    store.draft.sources = [ImportSource(id: ImportSource.digest(Data(text.utf8)), name: "bank.csv",
      text: text, accountId: "ACC-EVD", mapping: ["date": "Date", "description": "Description",
        "amount": "Amount", "dateOrder": "ymd", "sign": "money-in-positive"])]
    store.prepareImport()
    let row = try XCTUnwrap(store.proposal?.rows.first)
    store.chooseImportCategory(rowID: row.decisionID, categoryID: "UNCAT")
    XCTAssertTrue(store.sourceImportCanCommit)
    await store.commitImport()
    XCTAssertNil(store.error)
    let files = try FileManager.default.contentsOfDirectory(at: store.importStorage, includingPropertiesForKeys: nil)
      .filter { $0.lastPathComponent.hasPrefix("practice-sources-") }
    XCTAssertEqual(files.count, 1)
    let receipt = try JSONDecoder().decode(DemoSourceReceipt.self, from: Data(contentsOf: files[0]))
    XCTAssertEqual(try receipt.validatedRows().count, 1)
    XCTAssertEqual(try receipt.validatedRecords().count, 1)
    let reopened = KittyStore(); reopened.importStorageOverride = store.importStorage; reopened.openDemo()
    XCTAssertEqual(reopened.proposal?.rows.count, 0)
    XCTAssertEqual(reopened.sourceProposal?.newCount, 0)
  }
  func testEmptyBankExportNeedsThatAccountsReviewedStatementEvenWithPayslip() async throws {
    let (store, cleanup) = try isolated(); defer { cleanup() }
    _ = try await payslip(store)
    let text = "Date,Description,Amount\r\n"
    store.draft.sources = [ImportSource(id: ImportSource.digest(Data(text.utf8)), name: "empty.csv",
      text: text, accountId: "ACC-OFF", mapping: ["date": "Date", "description": "Description",
        "amount": "Amount", "dateOrder": "ymd", "sign": "money-in-positive"])]
    store.prepareImport()
    XCTAssertTrue(store.proposal?.issues.isEmpty == true)
    XCTAssertEqual(store.proposal?.rows.count, 0)
    XCTAssertEqual(store.sourceProposal?.newCount, 1)
    XCTAssertEqual(store.emptySourceAccountsNeedingEvidence, ["ACC-OFF"])
    XCTAssertFalse(store.sourceImportCanCommit)
  }
  func testCombinedUploadPreservesApprovedOverlapReview() async throws {
    let (store, cleanup) = try isolated(); defer { cleanup() }
    _ = try await payslip(store)
    let header = "Date,Description,Amount\n"
    let repeated = "2027-02-03,SYNTHETIC OVERLAP PURCHASE,-0.29\n"
    let texts = [header + repeated, header + repeated + "2027-02-04,SYNTHETIC OTHER PURCHASE,-1.00\n"]
    store.draft.sources = texts.enumerated().map { index, text in
      ImportSource(id: ImportSource.digest(Data(text.utf8)), name: "bank-\(index).csv", text: text,
        accountId: "ACC-EVD", mapping: ["date": "Date", "description": "Description",
          "amount": "Amount", "dateOrder": "ymd", "sign": "money-in-positive"])
    }.sorted { $0.id > $1.id }
    store.prepareImport()
    for row in try XCTUnwrap(store.proposal).rows {
      store.chooseImportCategory(rowID: row.decisionID, categoryID: "UNCAT")
    }
    XCTAssertTrue(try XCTUnwrap(store.proposal).issues.contains { $0.code == "overlap-review" })
    for issue in try XCTUnwrap(store.proposal).issues { store.acknowledgeImport(issue) }
    XCTAssertTrue(store.sourceImportCanCommit)
    let files = try store.sourceFilesForUpload().filter { $0["accountId"] != nil }
    let household = try XCTUnwrap(store.household)
    let result = try XCTUnwrap(store.engine).call("KittyImport", method: "prepare", input: [
      "files": files, "decisions": store.draft.decisions,
      "existing": try XCTUnwrap(store.sourceBaseline?["transactions"]), "currency": household.currency,
      "accounts": household.accounts.map { ["id": $0.id, "name": $0.name, "owner": $0.owner, "currency": household.currency] },
      "categories": household.categories.map { ["id": $0.id, "name": $0.name, "flow": $0.flow] },
    ])
    let rerun = try JSONDecoder().decode(ImportProposal.self, from: result)
    if !rerun.canCommit { print("Upload review issues: \(rerun.issues.map(\.message))") }
    XCTAssertTrue(rerun.canCommit, "The same originals must retain the user's overlap decision on the service rerun.")
    XCTAssertEqual(rerun.rows.count, store.proposal?.rows.count)
    XCTAssertEqual(files.compactMap { $0["id"] as? String }, store.draft.sources.map(\.id))
  }
  func testImportTransportRejectsRedirectResponseAndUnexpectedAddress() async throws {
    for status in [200, 307] {
      let client = ImportServiceClient(baseURL: URL(string: "https://example.invalid")!, token: "synthetic",
        transport: { request in
          let destination = status == 200 ? URL(string: "https://other.invalid/endpoint")! : request.url!
          return (Data("{}".utf8), HTTPURLResponse(url: destination, statusCode: status, httpVersion: nil, headerFields: nil)!)
        })
      do { _ = try await client.status(sheetID: "synthetic_sheet_123", id: "synthetic_import_123"); XCTFail("A redirected result must not be trusted.") }
      catch { XCTAssertTrue(error.localizedDescription.contains(status == 307 ? "redirected" : "unexpected")) }
    }
  }
  func testImportRedirectDelegateNeverForwardsOriginalsOrBearer() async throws {
    let url = URL(string: "https://example.invalid/original")!
    let redirected = URLRequest(url: URL(string: "https://other.invalid/receive")!)
    let session = URLSession(configuration: .ephemeral)
    defer { session.invalidateAndCancel() }
    var allowed: URLRequest? = redirected
    ImportRedirectPolicy().urlSession(session, task: session.dataTask(with: url),
      willPerformHTTPRedirection: HTTPURLResponse(url: url, statusCode: 307, httpVersion: nil, headerFields: nil)!,
      newRequest: redirected) { allowed = $0 }
    XCTAssertNil(allowed)
  }
}
