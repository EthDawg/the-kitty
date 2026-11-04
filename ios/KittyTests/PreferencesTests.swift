import XCTest

@testable import Kitty

private final class InputEditProtocol: URLProtocol {
  enum Reply { case http(Int, Data), failure(URLError.Code) }
  private static let lock = NSLock()
  private static var replies: [Reply] = []
  private static var recorded: [URLRequest] = []
  static func reset(_ replies: [Reply]) {
    lock.lock(); defer { lock.unlock() }
    self.replies = replies; recorded = []
  }
  static var requests: [URLRequest] {
    lock.lock(); defer { lock.unlock() }; return recorded
  }
  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    Self.lock.lock()
    Self.recorded.append(request)
    let reply = Self.replies.isEmpty ? Reply.failure(.badServerResponse) : Self.replies.removeFirst()
    Self.lock.unlock()
    switch reply {
    case .http(let status, let data):
      let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1",
        headerFields: ["Content-Type": "application/json"])!
      client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
      client?.urlProtocol(self, didLoad: data)
      client?.urlProtocolDidFinishLoading(self)
    case .failure(let code): client?.urlProtocol(self, didFailWithError: URLError(code))
    }
  }
  override func stopLoading() {}
}

@MainActor final class PreferencesTests: XCTestCase {
  private let sheetID = "synthetic_input_sheet_123456"
  private let safetyKey = "Emergency fund target (months of essential spending)"

  private func demoObject() throws -> [String: Any] {
    let url = try XCTUnwrap(Bundle.main.url(forResource: "demo", withExtension: "json"))
    return try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
  }
  private func project(_ object: [String: Any]) throws -> Household {
    try EngineBridge().project(JSONSerialization.data(withJSONObject: object))
  }
  private var kitty: [[GoogleCell]] { [[.string("Key"), .string("Value")], [.string("sheet_version"), .number(1)]] }
  private var settings: [[GoogleCell]] {
    [[.string("Settings")], [], [.string("Setting"), .string("Value")], [.string(safetyKey), .number(6)]]
  }
  private func edit(epoch: UUID = UUID()) throws -> SheetInputEdit {
    try SheetInputEdit.prepare(sheetID: sheetID, sheetName: "Synthetic household", epoch: epoch,
      kind: .safetyMonths, recordKey: safetyKey, replacement: .number(9), grid: settings, kitty: kitty)
  }
  private func sheets(tokenProvider: @escaping GoogleSheets.TokenProvider = { "synthetic-token" }) -> GoogleSheets {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [InputEditProtocol.self]
    return GoogleSheets(tokenProvider: tokenProvider, session: URLSession(configuration: configuration))
  }
  private func batch(_ rows: [[[GoogleCell]]]) throws -> InputEditProtocol.Reply {
    let ranges = rows.enumerated().map { GoogleValueRange(range: "fixture\($0.offset)", values: $0.element) }
    struct Response: Encodable { let valueRanges: [GoogleValueRange] }
    return .http(200, try JSONEncoder().encode(Response(valueRanges: ranges)))
  }
  private func before(_ raw: GoogleCell = .number(6), fullGrid: [[GoogleCell]]? = nil) throws -> InputEditProtocol.Reply {
    try batch([[[raw]], [[.string(safetyKey)]], kitty, fullGrid ?? settings])
  }
  private func after(_ raw: GoogleCell = .number(9), fullGrid: [[GoogleCell]]? = nil,
    kittyGrid: [[GoogleCell]]? = nil) throws -> InputEditProtocol.Reply {
    var current = settings; current[3][1] = raw
    return try batch([[[raw]], [[.string(safetyKey)]], kittyGrid ?? kitty, fullGrid ?? current])
  }
  private func isolatedStore(_ directory: URL) throws -> KittyStore {
    let connection = GoogleConnection(bundle: Bundle(for: PreferencesTests.self),
      credentialStore: .init(read: { nil }, write: { _ in }, delete: {}))
    let store = KittyStore(google: connection, setupStorage: directory, inputEditStorage: directory, goalStorage: directory)
    store.household = try project(demoObject())
    store.mode = .connected; store.selectedSheetID = sheetID; store.selectedSheetName = "Synthetic household"
    store.sheetCanEdit = true; store.draft = ImportDraft()
    return store
  }
  private func temporaryDirectory() throws -> URL {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    return directory
  }

  func testHomePreferenceUsesExactSheetGoalRatherThanJapanOrFirstRow() throws {
    var raw = try demoObject()
    let initial = try project(raw)
    let desired = try XCTUnwrap(initial.goals.first { !$0.name.contains("Japan") })
    var kitty = try XCTUnwrap(raw["kitty"] as? [[String: Any]])
    for index in kitty.indices {
      if kitty[index]["key"] as? String == "lead_goal" { kitty[index]["value"] = desired.name }
      if kitty[index]["key"] as? String == "greeting_name" { kitty[index]["value"] = "A new greeting" }
    }
    raw["kitty"] = kitty
    let household = try project(raw)
    XCTAssertEqual(household.featuredGoal?.name, desired.name)
    XCTAssertEqual(household.preferences?.greeting, "A new greeting")
    XCTAssertEqual(household.preferences?.lookAheadDays, 35)
    XCTAssertEqual(monthYear("2027-04-30"), "April 2027")
  }

  func testRawPreferenceProjectionPreservesRowsOutsideTableAndRefusesDuplicateKeys() throws {
    let engine = try EngineBridge()
    let grid: [[Any]] = [["greeting_name", "Outside header"], ["Key", "Value"], ["sheet_version", 1], [], ["look_ahead_days", 90]]
    var raw = try demoObject()
    let fragment = try XCTUnwrap(JSONSerialization.jsonObject(with: engine.snapshot(grids: ["kitty": grid])) as? [String: Any])
    raw["kittyPreferenceRows"] = fragment["kittyPreferenceRows"]
    var household = try project(raw)
    XCTAssertEqual(household.preferences?.greeting, "Outside header")
    XCTAssertEqual(household.preferences?.lookAheadDays, 90)
    raw["kittyPreferenceRows"] = [["key": "greeting_name", "value": "First"], ["key": " greeting_name ", "value": "Second"], ["key": "look_ahead_days", "value": "Unknown"]]
    household = try project(raw)
    XCTAssertNil(household.preferences?.greeting)
    XCTAssertNil(household.preferences?.lookAheadDays)
  }

  func testInputReviewKeepsActualSourceRowAndBlankBeforeValue() throws {
    var grid = settings
    grid.insert([], at: 3)
    grid[4] = [.string(safetyKey)]
    let review = try SheetInputEdit.prepare(sheetID: sheetID, sheetName: "Fixture", epoch: UUID(),
      kind: .safetyMonths, recordKey: safetyKey, replacement: .number(12), grid: grid, kitty: kitty)
    XCTAssertEqual(review.range, "Settings!B5")
    XCTAssertEqual(review.before, .empty)
    XCTAssertEqual(review.kind.display(review.before), "Not set")
    let restored = try JSONDecoder().decode(SheetInputEdit.self, from: JSONEncoder().encode(review))
    XCTAssertEqual(restored.id, review.id)
    XCTAssertEqual(restored.replacement, review.replacement)
    XCTAssertTrue(GoogleSheets.equalCells([[restored.before]], [[review.before]]))
  }

  func testMissingDuplicateReorderedAndFormulaInputsCannotProduceWritableReview() throws {
    var duplicate = settings; duplicate.append([.string(" " + safetyKey + " "), .number(8)])
    var reordered = settings; reordered[2] = [.string("Setting"), .string("Note"), .string("Value")]
    var formula = settings; formula[3][1] = .string("=3+3")
    for grid in [Array(settings.dropLast()), duplicate, reordered, formula] {
      XCTAssertThrowsError(try SheetInputEdit.prepare(sheetID: sheetID, sheetName: "Fixture", epoch: UUID(),
        kind: .safetyMonths, recordKey: safetyKey, replacement: .number(9), grid: grid, kitty: kitty))
    }
    for value in ["0", "61", "3.5", "-1"] { XCTAssertThrowsError(try SheetInputKind.safetyMonths.replacement(text: value)) }
    XCTAssertEqual(try SheetInputKind.safetyMonths.replacement(text: "60"), .number(60))
    XCTAssertThrowsError(try SheetInputKind.lookAheadDays.replacement(text: "366"))
    XCTAssertThrowsError(try SheetInputKind.leadGoal.replacement(text: "Invented goal", goalNames: ["Known goal"]))
  }

  func testV2ComputedSubscriptionsCannotBeEdited() throws {
    var version2 = kitty; version2[1][1] = .number(2)
    let grid: [[GoogleCell]] = [SheetInputKind.subscriptionDecision.headers.map(GoogleCell.string),
      [.string("Fictional service"), .string("Merchant"), .string("Joint"), .string("Monthly"), .string("SUBS"), .empty, .string("Keep")]]
    XCTAssertThrowsError(try SheetInputEdit.prepare(sheetID: sheetID, sheetName: "Fixture", epoch: UUID(),
      kind: .subscriptionDecision, recordKey: "Fictional service", replacement: .string("Cancel"), grid: grid, kitty: version2))
    let v1 = try SheetInputEdit.prepare(sheetID: sheetID, sheetName: "Fixture", epoch: UUID(),
      kind: .subscriptionDecision, recordKey: "Fictional service", replacement: .string("Review"), grid: grid, kitty: kitty)
    XCTAssertEqual(v1.range, "Subscriptions!G2")
  }

  func testVerifiedWriteRunsDurableHandoffAfterPreflightBeforePUT() async throws {
    InputEditProtocol.reset([try before(), .http(200, Data("{}".utf8)), try after()])
    var handoff = false
    let receipt = try await sheets().writeAndVerify(spreadsheetID: sheetID, range: "Settings!B4",
      recordKey: safetyKey, expected: [[.number(6)]], replacement: [[.number(9)]], expectedVersion: 1,
      willWrite: {
        XCTAssertEqual(InputEditProtocol.requests.map(\.httpMethod), ["GET"])
        handoff = true
      })
    XCTAssertTrue(handoff)
    XCTAssertEqual(receipt.values, [[.number(9)]])
    XCTAssertEqual(InputEditProtocol.requests.map(\.httpMethod), ["GET", "PUT", "GET"])
    for request in InputEditProtocol.requests where request.httpMethod == "GET" {
      XCTAssertEqual(URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "valueRenderOption" }?.value, "FORMULA")
    }
  }

  func testRacedFormulaCannotMasqueradeAsLiteralDuringReadback() async throws {
    InputEditProtocol.reset([try before(), .http(200, Data("{}".utf8)), try after(.string("=9"))])
    do {
      _ = try await sheets().writeAndVerify(spreadsheetID: sheetID, range: "Settings!B4",
        recordKey: safetyKey, expected: [[.number(6)]], replacement: [[.number(9)]])
      XCTFail("A calculated nine is not a verified literal input of nine.")
    } catch { XCTAssertTrue(error is GoogleSheets.ServiceError) }
    XCTAssertEqual(InputEditProtocol.requests.filter { $0.httpMethod == "PUT" }.count, 1)
  }

  func testReadbackRejectsDuplicateIdentityChangedHeadersAndChangedSchema() async throws {
    var duplicate = settings; duplicate[3][1] = .number(9); duplicate.append([.string(safetyKey), .number(9)])
    var changedHeader = settings; changedHeader[3][1] = .number(9); changedHeader[2][1] = .string("Note")
    var changedVersion = kitty; changedVersion[1][1] = .number(2)
    for reply in [try after(fullGrid: duplicate), try after(fullGrid: changedHeader), try after(kittyGrid: changedVersion)] {
      InputEditProtocol.reset([try before(), .http(200, Data("{}".utf8)), reply])
      do {
        _ = try await sheets().writeAndVerify(spreadsheetID: sheetID, range: "Settings!B4",
          recordKey: safetyKey, expected: [[.number(6)]], replacement: [[.number(9)]])
        XCTFail("A matching target scalar cannot verify a changed Sheet identity or schema.")
      } catch {
        guard case GoogleSheets.ServiceError.writeUncertain = error else { return XCTFail("Expected an unresolved outcome.") }
      }
      XCTAssertEqual(InputEditProtocol.requests.map(\.httpMethod), ["GET", "PUT", "GET"])
    }
  }

  func testTokenRefreshFailureBeforeDispatchCreatesNoIntentOrWrite() async throws {
    let directory = try temporaryDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let store = try isolatedStore(directory)
    var calls = 0
    let client = sheets {
      calls += 1
      if calls == 2 { throw URLError(.notConnectedToInternet) }
      return "synthetic-token"
    }
    InputEditProtocol.reset([try before()])
    do { try await store.saveInputEdit(edit(epoch: store.googleEpoch), client: client); XCTFail("Refresh failed before dispatch.") }
    catch { XCTAssertEqual((error as? URLError)?.code, .notConnectedToInternet) }
    XCTAssertEqual(InputEditProtocol.requests.map(\.httpMethod), ["GET"])
    XCTAssertNil(store.pendingInputEdit)
    XCTAssertFalse(FileManager.default.fileExists(atPath: store.inputEditURL.path))
  }

  func testCapturedGoalHeadersPermitFeaturedGoalReviewAndExistingGoalWrite() async throws {
    // Exact A:G header captured in templates/source/davies-v1.json, Goals row 1.
    let header = ["Goal", "Target amount ($)", "Target date", "Linked account", "Balance now ($)", "Progress", "Months left"]
    let directory = try temporaryDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let store = try isolatedStore(directory)
    let name = try XCTUnwrap(store.household?.goals.first?.name)
    var kittyGrid = kitty; kittyGrid.append([.string("lead_goal"), .string("")])
    let goals: [[GoogleCell]] = [header.map(GoogleCell.string), [.string(name), .number(1000), .number(47000), .string("ACC_FIXTURE")]]
    InputEditProtocol.reset([try batch([kittyGrid, kittyGrid, goals])])
    let review = try await store.prepareInputEdit(kind: .leadGoal, text: name, client: sheets())
    XCTAssertEqual(review.replacement, .string(name))
    XCTAssertEqual(review.range, "Kitty!B3")
    var updated = goals; updated[1][1] = .number(1200)
    InputEditProtocol.reset([try batch([[[.number(1000)]], [[.string(name)]], kitty, goals]),
      .http(200, Data("{}".utf8)), try batch([[[.number(1200)]], [[.string(name)]], kitty, updated])])
    let receipt = try await sheets().writeAndVerify(spreadsheetID: sheetID, range: "Goals!B2",
      recordKey: name, expected: [[.number(1000)]], replacement: [[.number(1200)]])
    XCTAssertEqual(receipt.values, [[.number(1200)]])
  }

  func testChangedBeforeStateRefusesWriteWithoutCreatingIntent() async throws {
    InputEditProtocol.reset([try before(.number(8))])
    var handoff = false
    do {
      _ = try await sheets().writeAndVerify(spreadsheetID: sheetID, range: "Settings!B4",
        recordKey: safetyKey, expected: [[.number(6)]], replacement: [[.number(9)]], willWrite: { handoff = true })
      XCTFail("The before value changed.")
    } catch {}
    XCTAssertFalse(handoff)
    XCTAssertEqual(InputEditProtocol.requests.map(\.httpMethod), ["GET"])
  }

  func testPersistenceFailurePreventsPUTAndLeavesNoFalseUnknownWrite() async throws {
    let directory = try temporaryDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let store = try isolatedStore(directory)
    store.inputEditPersistence = { _, _ in throw CocoaError(.fileWriteOutOfSpace) }
    InputEditProtocol.reset([try before()])
    do { try await store.saveInputEdit(edit(epoch: store.googleEpoch), client: sheets()); XCTFail("Persistence must precede dispatch.") }
    catch {}
    XCTAssertEqual(InputEditProtocol.requests.map(\.httpMethod), ["GET"])
    XCTAssertNil(store.pendingInputEdit)
    XCTAssertFalse(store.inputEditBusy)
  }

  func testLostWriteResponseSurvivesRelaunchAndCheckingNeverResendsPUT() async throws {
    let directory = try temporaryDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let store = try isolatedStore(directory)
    let original = try edit(epoch: store.googleEpoch)
    InputEditProtocol.reset([try before(), .failure(.networkConnectionLost), try after(.number(6))])
    do { try await store.saveInputEdit(original, client: sheets()); XCTFail("Outcome remains unknown.") }
    catch {}
    XCTAssertEqual(store.pendingInputEdit?.id, original.id)
    XCTAssertTrue(FileManager.default.fileExists(atPath: store.inputEditURL.path))
    let restored = try isolatedStore(directory)
    XCTAssertEqual(restored.pendingInputEdit?.id, original.id)
    InputEditProtocol.reset([try batch([settings, kitty])])
    do { try await restored.checkPendingInputEdit(client: sheets()); XCTFail("An old value does not prove that a delayed write cannot finish.") }
    catch {}
    XCTAssertEqual(InputEditProtocol.requests.map(\.httpMethod), ["GET"])
    XCTAssertNotNil(restored.pendingInputEdit)
    var current = settings; current[3][1] = .number(9)
    InputEditProtocol.reset([try batch([current, kitty])])
    try await restored.checkPendingInputEdit(client: sheets())
    XCTAssertEqual(InputEditProtocol.requests.map(\.httpMethod), ["GET"])
    XCTAssertNil(restored.pendingInputEdit)
  }

  func testStaleIdentityAndDemoCannotDispatchAnInputWrite() async throws {
    let directory = try temporaryDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let store = try isolatedStore(directory)
    InputEditProtocol.reset([])
    do { try await store.saveInputEdit(edit(), client: sheets()); XCTFail("Epoch changed.") } catch {}
    store.mode = .demo
    do { _ = try await store.prepareInputEdit(kind: .safetyMonths, text: "9", client: sheets()); XCTFail("Demo is read-only.") } catch {}
    XCTAssertTrue(InputEditProtocol.requests.isEmpty)
  }

  func testArchiveRecoveryRechecksMovedInputRetainsUnknownOutcomeAndNeverWritesGoogle() async throws {
    let directory = try temporaryDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let store = try isolatedStore(directory)
    let original = try edit(epoch: store.googleEpoch)
    try JSONEncoder().encode(original).write(to: store.inputEditURL)
    store.loadPendingInputEdit()
    var moved = settings; moved.insert([], at: 3); moved[4][1] = .number(8)
    InputEditProtocol.reset([try batch([moved, kitty]), try batch([moved, kitty])])
    let observation = try await store.observePendingInputEdit(client: sheets())
    XCTAssertEqual(observation.row, 5)
    XCTAssertEqual(observation.value, .number(8))
    try await store.archivePendingInputEdit(observation: observation, client: sheets())
    XCTAssertNil(store.pendingInputEdit)
    XCTAssertEqual(InputEditProtocol.requests.map(\.httpMethod), ["GET", "GET"])
    let archives = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
      .filter { $0.lastPathComponent.hasPrefix("input-edit-archive-") }
    XCTAssertEqual(archives.count, 1)
    let archive = try JSONDecoder().decode(SheetInputRecoveryArchive.self, from: Data(contentsOf: XCTUnwrap(archives.first)))
    XCTAssertEqual(archive.original, original)
    XCTAssertEqual(archive.original.outcome, .unverified)
    XCTAssertNil(archive.original.verifiedAt)
    XCTAssertEqual(archive.observation.row, 5)
    XCTAssertEqual(archive.observation.value, .number(8))
    XCTAssertFalse(FileManager.default.fileExists(atPath: store.inputEditURL.path))
    XCTAssertNil(try isolatedStore(directory).pendingInputEdit)
  }

  func testArchiveFailureAndChangedObservationBothKeepRecoveryRecord() async throws {
    let directory = try temporaryDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let store = try isolatedStore(directory)
    let original = try edit(epoch: store.googleEpoch)
    try JSONEncoder().encode(original).write(to: store.inputEditURL); store.loadPendingInputEdit()
    InputEditProtocol.reset([try batch([settings, kitty])])
    let observation = try await store.observePendingInputEdit(client: sheets())
    var changed = settings; changed[3][1] = .number(7)
    InputEditProtocol.reset([try batch([changed, kitty])])
    do { try await store.archivePendingInputEdit(observation: observation, client: sheets()); XCTFail("State changed after review.") } catch {}
    XCTAssertEqual(store.pendingInputEdit?.id, original.id)
    store.inputEditPersistence = { _, _ in throw CocoaError(.fileWriteOutOfSpace) }
    InputEditProtocol.reset([try batch([settings, kitty])])
    do { try await store.archivePendingInputEdit(observation: observation, client: sheets()); XCTFail("Archive must precede hold removal.") } catch {}
    XCTAssertEqual(store.pendingInputEdit?.id, original.id)
    XCTAssertTrue(FileManager.default.fileExists(atPath: store.inputEditURL.path))
    XCTAssertEqual(InputEditProtocol.requests.map(\.httpMethod), ["GET"])
    let files = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
    XCTAssertFalse(files.contains { $0.lastPathComponent.hasPrefix("input-edit-archive-") })
  }

  func testCorruptRecoveryCanBeReloadedAfterLocalRecordRepair() throws {
    let directory = try temporaryDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let original = try edit()
    let url = directory.appendingPathComponent("input-edit.json")
    try Data("corrupt".utf8).write(to: url)
    let store = try isolatedStore(directory)
    XCTAssertTrue(store.inputEditLoadBlocked)
    XCTAssertTrue(store.inputEditsBlockNewWrites)
    try JSONEncoder().encode(original).write(to: url)
    store.loadPendingInputEdit()
    XCTAssertFalse(store.inputEditLoadBlocked)
    XCTAssertEqual(store.pendingInputEdit?.id, original.id)
  }
}
