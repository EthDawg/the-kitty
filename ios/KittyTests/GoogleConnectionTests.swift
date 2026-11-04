import XCTest

@testable import Kitty

private final class GoogleLogoutProtocol: URLProtocol {
  typealias Hold = (@escaping () -> Void) -> Void
  private static let lock = NSLock()
  private static var status = 200
  private static var recorded: [URLRequest] = []
  private static var hold: Hold?
  static func reset(status: Int, hold: Hold? = nil) {
    lock.lock(); defer { lock.unlock() }
    self.status = status
    self.hold = hold
    recorded = []
  }
  static var requests: [URLRequest] {
    lock.lock(); defer { lock.unlock() }
    return recorded
  }
  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    Self.lock.lock()
    Self.recorded.append(request)
    let status = Self.status
    let hold = Self.hold
    Self.lock.unlock()
    let finish = { [self] in
      let response = HTTPURLResponse(url: request.url!, statusCode: status,
        httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
      client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
      client?.urlProtocol(self, didLoad: Data("{}".utf8))
      client?.urlProtocolDidFinishLoading(self)
    }
    if let hold { hold(finish) } else { finish() }
  }
  override func stopLoading() {}
}

/// A manual response gate; no timers, sleeping, or external Google traffic determine the result.
private final class RevocationGate {
  let started = XCTestExpectation(description: "Synthetic Google revocation has started")
  private let lock = NSLock()
  private var completion: (() -> Void)?
  func hold(_ completion: @escaping () -> Void) {
    lock.lock()
    self.completion = completion
    lock.unlock()
    started.fulfill()
  }
  func release() {
    lock.lock()
    let finish = completion
    completion = nil
    lock.unlock()
    finish?()
  }
}

@MainActor
final class GoogleConnectionTests: XCTestCase {
  private enum FixtureError: Error { case credentialStoreLocked }

  private struct Fixture {
    let bundle: Bundle
    let directory: URL
    let suite: String
    let defaults: UserDefaults
    func cleanUp() {
      defaults.removePersistentDomain(forName: suite)
      _ = defaults.synchronize()
      try? FileManager.default.removeItem(at: directory)
    }
  }

  private func fixture() throws -> Fixture {
    let identifier = "app.thekitty.logout-tests." + UUID().uuidString
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(identifier + ".bundle")
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let clientID = "synthetic-ios-client.apps.googleusercontent.com"
    let scheme = clientID.split(separator: ".").reversed().joined(separator: ".")
    let info: [String: Any] = [
      "CFBundleIdentifier": identifier, "CFBundleName": "Logout test fixture",
      "CFBundlePackageType": "BNDL", "GoogleClientID": clientID,
      "CFBundleURLTypes": [["CFBundleURLSchemes": [scheme]]],
    ]
    try PropertyListSerialization.data(fromPropertyList: info, format: .xml, options: 0)
      .write(to: directory.appendingPathComponent("Info.plist"))
    return Fixture(bundle: try XCTUnwrap(Bundle(url: directory)), directory: directory,
      suite: identifier, defaults: try XCTUnwrap(UserDefaults(suiteName: identifier)))
  }

  private func tokenData() throws -> Data {
    try JSONSerialization.data(withJSONObject: [
      "access": "synthetic-access-token", "refresh": "synthetic-refresh-token",
      "expiresAt": Date().addingTimeInterval(3600).timeIntervalSinceReferenceDate,
      "scope": "https://www.googleapis.com/auth/drive.file",
    ])
  }

  private func session(status: Int, gate: RevocationGate? = nil) -> URLSession {
    GoogleLogoutProtocol.reset(status: status, hold: gate.map { gate in { gate.hold($0) } })
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [GoogleLogoutProtocol.self]
    return URLSession(configuration: configuration)
  }

  private let storePreferenceKeys = ["kitty.mode", "kitty.sheet", "kitty.sheetName", "kitty.lastSync"]

  private func preserveStorePreferences() -> [String: Any] {
    var saved: [String: Any] = [:]
    for key in storePreferenceKeys {
      saved[key] = UserDefaults.standard.object(forKey: key)
      UserDefaults.standard.removeObject(forKey: key)
    }
    return saved
  }

  private func restoreStorePreferences(_ saved: [String: Any]) {
    for key in storePreferenceKeys {
      UserDefaults.standard.removeObject(forKey: key)
      if let value = saved[key] { UserDefaults.standard.set(value, forKey: key) }
    }
  }

  private func privateStore(fixture: Fixture, gate: RevocationGate, status: Int) throws -> KittyStore {
    var stored: Data? = try tokenData()
    let credentials = GoogleConnection.CredentialStore(read: { stored }, write: { stored = $0 }, delete: { stored = nil })
    let connection = GoogleConnection(bundle: fixture.bundle, session: session(status: status, gate: gate),
      defaults: fixture.defaults, credentialStore: credentials)
    let store = KittyStore(google: connection)
    store.importStorageOverride = fixture.directory
    store.draft = ImportDraft()
    store.importBusy = false
    store.busy = false
    store.household = Household(household: "Synthetic private household", asOf: "2027-01-31",
      currency: "AUD", sheetVersion: 1, accounts: [], transactions: [], categories: [], goals: [],
      metrics: [:], cashflow: [], budget: [], subscriptions: [], checks: [], savings: [],
      networth: [], upcoming: [], reconciliation: [], people: [])
    store.mode = .connected
    store.selectedSheetID = "synthetic_private_sheet_123456"
    store.selectedSheetName = "Synthetic private Sheet"
    store.sheetCanEdit = true
    store.askQuestion = "Synthetic private question"
    store.askTransactionID = "T-private-fixture"
    store.showSettings = true
    store.lastSynced = Date()
    store.error = nil
    return store
  }

  func testPrivateViewIsClearedBeforeDelayedRevocationCompletes() async throws {
    let fixture = try fixture()
    let preferences = preserveStorePreferences()
    defer { fixture.cleanUp(); restoreStorePreferences(preferences) }
    let gate = RevocationGate()
    defer { gate.release() }
    let store = try privateStore(fixture: fixture, gate: gate, status: 200)
    XCTAssertNotNil(store.household)
    let disconnect = Task { await store.disconnect() }
    await fulfillment(of: [gate.started], timeout: 2)

    XCTAssertTrue(store.disconnecting, "The provider response is deliberately still withheld.")
    XCTAssertEqual(store.mode, .welcome)
    XCTAssertNil(store.household)
    XCTAssertEqual(store.selectedSheetID, "")
    XCTAssertEqual(store.selectedSheetName, "")
    XCTAssertFalse(store.sheetCanEdit)
    XCTAssertEqual(store.askQuestion, "")
    XCTAssertNil(store.askTransactionID)
    XCTAssertNil(store.lastSynced)
    XCTAssertFalse(store.showSettings)
    XCTAssertFalse(store.google.isConnected)

    gate.release()
    await disconnect.value
    XCTAssertFalse(store.disconnecting)
    XCTAssertEqual(store.mode, .welcome)
    XCTAssertNil(store.household)
    XCTAssertNil(store.error)
  }

  func testDisconnectRemovesCompletedOriginalsButRetainsUnknownReceipt() async throws {
    let fixture = try fixture()
    let preferences = preserveStorePreferences()
    defer { fixture.cleanUp(); restoreStorePreferences(preferences) }
    let gate = RevocationGate()
    defer { gate.release() }
    let store = try privateStore(fixture: fixture, gate: gate, status: 200)
    var files: [String: URL] = [:]
    defer { for url in files.values { try? FileManager.default.removeItem(at: url) } }
    for status in ["verified", "cancelled", "unknown"] {
      var draft = ImportDraft()
      draft.boundSheetID = store.selectedSheetID
      draft.documents = [SourceDocument(name: "fictional.pdf", mimeType: "application/pdf", bytes: Data("%PDF-synthetic".utf8))]
      draft.remote = ImportRemoteBinding(id: "synthetic_import_123", sheetID: store.selectedSheetID,
        proposalDigest: String(repeating: "a", count: 64), localDraftDigest: "local", proposal: Data("{}".utf8),
        attempted: true, status: status, protocolVersion: 2, operation: "ingest")
      let url = store.storage.appendingPathComponent("import-receipt-test-\(UUID().uuidString).json")
      files[status] = url
      try JSONEncoder().encode(draft).write(to: url)
    }
    let task = Task { await store.disconnect() }
    await fulfillment(of: [gate.started], timeout: 2)
    XCTAssertFalse(FileManager.default.fileExists(atPath: files["verified"]!.path))
    XCTAssertFalse(FileManager.default.fileExists(atPath: files["cancelled"]!.path))
    XCTAssertTrue(FileManager.default.fileExists(atPath: files["unknown"]!.path))
    XCTAssertNil(store.sourceBaseline)
    XCTAssertTrue(store.draft.documents.isEmpty)
    gate.release()
    await task.value
  }

  func testDemoChosenDuringDelayedRevokeSurvivesItsFailureCompletion() async throws {
    let fixture = try fixture()
    let preferences = preserveStorePreferences()
    defer { fixture.cleanUp(); restoreStorePreferences(preferences) }
    let gate = RevocationGate()
    defer { gate.release() }
    let store = try privateStore(fixture: fixture, gate: gate, status: 503)
    let disconnect = Task { await store.disconnect() }
    await fulfillment(of: [gate.started], timeout: 2)
    store.openDemo()
    XCTAssertTrue(store.disconnecting)
    XCTAssertTrue(store.isDemo)
    XCTAssertEqual(store.household?.household, "The Davies")

    gate.release()
    await disconnect.value
    XCTAssertFalse(store.disconnecting)
    XCTAssertTrue(store.isDemo, "A stale disconnect completion must not replace the newly chosen demo.")
    XCTAssertEqual(store.household?.household, "The Davies")
    XCTAssertEqual(store.selectedSheetID, "")
    XCTAssertNil(store.error, "An old identity's revoke result must not overwrite the new view's state.")
    XCTAssertEqual(UserDefaults.standard.string(forKey: "kitty.mode"), "demo")
  }

  func testReconnectAndSelectionCannotStartWhileRevocationIsPending() async throws {
    let fixture = try fixture()
    let preferences = preserveStorePreferences()
    defer { fixture.cleanUp(); restoreStorePreferences(preferences) }
    let gate = RevocationGate()
    defer { gate.release() }
    let store = try privateStore(fixture: fixture, gate: gate, status: 200)
    let disconnect = Task { await store.disconnect() }
    await fulfillment(of: [gate.started], timeout: 2)
    XCTAssertTrue(store.disconnecting)
    store.error = "Keep the current view state while disconnecting."

    await store.connect()
    await store.select(GoogleSheetFile(id: "synthetic_other_sheet_123456", name: "Other fixture",
      webViewLink: nil, modifiedTime: nil))
    XCTAssertTrue(store.disconnecting)
    XCTAssertFalse(store.busy)
    XCTAssertFalse(store.google.isAuthorizing)
    XCTAssertEqual(store.mode, .welcome)
    XCTAssertEqual(store.selectedSheetID, "")
    XCTAssertEqual(store.error, "Keep the current view state while disconnecting.",
      "A blocked connect/select must return before resetting state or attempting Google access.")
    XCTAssertEqual(GoogleLogoutProtocol.requests.map { $0.url?.path }, ["/revoke"])

    gate.release()
    await disconnect.value
    XCTAssertFalse(store.disconnecting)
    XCTAssertFalse(store.google.isConnected)
  }

  private func assertNoAccess(_ connection: GoogleConnection,
                              file: StaticString = #filePath, line: UInt = #line) async {
    XCTAssertFalse(connection.isConnected, file: file, line: line)
    XCTAssertTrue(connection.pickedSheetIDs.isEmpty, file: file, line: line)
    do {
      _ = try await connection.accessToken()
      XCTFail("A signed-out connection returned an access token.", file: file, line: line)
    } catch GoogleConnection.ConnectionError.reconnect {
    } catch {
      XCTFail("Expected reconnect, received \(type(of: error)).", file: file, line: line)
    }
  }

  func testLockedKeychainStillClearsRuntimeRevokesAndPreventsRestoration() async throws {
    let fixture = try fixture()
    defer { fixture.cleanUp() }
    let retainedCredentials = try tokenData()
    var reads = 0
    let credentials = GoogleConnection.CredentialStore(read: { reads += 1; return retainedCredentials },
      write: { _ in XCTFail("Logout must not write a new credential.") },
      delete: { throw FixtureError.credentialStoreLocked })
    let connection = GoogleConnection(bundle: fixture.bundle, session: session(status: 200),
      defaults: fixture.defaults, credentialStore: credentials)
    XCTAssertTrue(connection.isConnected)
    do {
      try await connection.disconnect()
      XCTFail("Failed credential deletion must remain visible.")
    } catch GoogleConnection.ConnectionError.disconnectIncomplete(let local, let remote, let persisted) {
      XCTAssertFalse(local)
      XCTAssertTrue(remote, "Revocation must still be attempted after local deletion fails.")
      XCTAssertTrue(persisted)
    }
    await assertNoAccess(connection)
    XCTAssertTrue(connection.needsCredentialCleanup)
    XCTAssertEqual(GoogleLogoutProtocol.requests.count, 1)
    XCTAssertEqual(GoogleLogoutProtocol.requests[0].url?.absoluteString, "https://oauth2.googleapis.com/revoke")
    XCTAssertEqual(GoogleLogoutProtocol.requests[0].httpMethod, "POST")
    XCTAssertNil(GoogleLogoutProtocol.requests[0].value(forHTTPHeaderField: "Authorization"))

    let reloadedDefaults = try XCTUnwrap(UserDefaults(suiteName: fixture.suite))
    let relaunched = GoogleConnection(bundle: fixture.bundle, session: session(status: 200),
      defaults: reloadedDefaults, credentialStore: credentials)
    await assertNoAccess(relaunched)
    XCTAssertTrue(relaunched.needsCredentialCleanup, "The retry action must remain available after relaunch.")
    XCTAssertEqual(reads, 1, "A tombstoned credential must not even be read for automatic restoration.")
    XCTAssertTrue(GoogleLogoutProtocol.requests.isEmpty)
  }

  func testRemoteRevocationFailureDoesNotUndoLocalSignOut() async throws {
    let fixture = try fixture()
    defer { fixture.cleanUp() }
    var stored: Data? = try tokenData()
    let credentials = GoogleConnection.CredentialStore(read: { stored }, write: { stored = $0 }, delete: { stored = nil })
    let connection = GoogleConnection(bundle: fixture.bundle, session: session(status: 503),
      defaults: fixture.defaults, credentialStore: credentials)
    do {
      try await connection.disconnect()
      XCTFail("An unconfirmed Google revocation must be reported.")
    } catch GoogleConnection.ConnectionError.revocationUnconfirmed {}
    await assertNoAccess(connection)
    XCTAssertFalse(connection.needsCredentialCleanup, "A remote revoke failure must not invent failed local deletion.")
    XCTAssertNil(stored)
    XCTAssertEqual(GoogleLogoutProtocol.requests.count, 1, "Revocation is not silently retried.")
    let relaunched = GoogleConnection(bundle: fixture.bundle, session: session(status: 200),
      defaults: try XCTUnwrap(UserDefaults(suiteName: fixture.suite)), credentialStore: credentials)
    await assertNoAccess(relaunched)
    XCTAssertFalse(relaunched.needsCredentialCleanup)
  }

  func testBothFailuresReportBothOutcomesWithoutCredentialDiagnostics() async throws {
    let fixture = try fixture()
    defer { fixture.cleanUp() }
    let retainedCredentials = try tokenData()
    let credentials = GoogleConnection.CredentialStore(read: { retainedCredentials }, write: { _ in },
      delete: { throw NSError(domain: "PRIVATE-Keychain-diagnostic", code: -1) })
    let connection = GoogleConnection(bundle: fixture.bundle, session: session(status: 503),
      defaults: fixture.defaults, credentialStore: credentials)
    do {
      try await connection.disconnect()
      XCTFail("Both failures must remain visible.")
    } catch let error as GoogleConnection.ConnectionError {
      guard case .disconnectIncomplete(let local, let remote, let persisted) = error else {
        return XCTFail("Expected separate local and remote cleanup outcomes.")
      }
      XCTAssertFalse(local)
      XCTAssertFalse(remote)
      XCTAssertTrue(persisted)
      XCTAssertTrue(error.localizedDescription.contains("blocked from reuse"))
      XCTAssertTrue(error.localizedDescription.contains("Google could not confirm"))
      XCTAssertFalse(error.localizedDescription.contains("PRIVATE"))
      XCTAssertFalse(error.localizedDescription.contains("synthetic-refresh-token"))
    }
    await assertNoAccess(connection)
    XCTAssertEqual(GoogleLogoutProtocol.requests.count, 1)
  }

  func testTombstonedCleanupCanBeRetriedAfterUnlockWithoutRestoringAccess() async throws {
    let fixture = try fixture()
    defer { fixture.cleanUp() }
    var stored: Data? = try tokenData()
    var locked = true
    var reads = 0
    let credentials = GoogleConnection.CredentialStore(read: { reads += 1; return stored },
      write: { stored = $0 }, delete: {
        if locked { throw FixtureError.credentialStoreLocked }
        stored = nil
      })
    let connection = GoogleConnection(bundle: fixture.bundle, session: session(status: 503),
      defaults: fixture.defaults, credentialStore: credentials)
    do { try await connection.disconnect() } catch GoogleConnection.ConnectionError.disconnectIncomplete {}
    XCTAssertTrue(connection.needsCredentialCleanup)
    let retry = GoogleConnection(bundle: fixture.bundle, session: session(status: 200),
      defaults: try XCTUnwrap(UserDefaults(suiteName: fixture.suite)), credentialStore: credentials)
    await assertNoAccess(retry)
    XCTAssertTrue(retry.needsCredentialCleanup)
    XCTAssertEqual(reads, 1)
    locked = false
    try await retry.disconnect()
    await assertNoAccess(retry)
    XCTAssertFalse(retry.needsCredentialCleanup, "A successful retry must remove the outstanding cleanup action.")
    XCTAssertNil(stored)
    XCTAssertEqual(reads, 2, "A cleanup retry may read an old token solely to revoke and delete it.")
    XCTAssertEqual(GoogleLogoutProtocol.requests.count, 1)
    let afterRetry = GoogleConnection(bundle: fixture.bundle, session: session(status: 200),
      defaults: try XCTUnwrap(UserDefaults(suiteName: fixture.suite)), credentialStore: credentials)
    await assertNoAccess(afterRetry)
    XCTAssertFalse(afterRetry.needsCredentialCleanup, "Successful cleanup must remain cleared after another relaunch.")
  }

  func testAlreadySignedOutDoesNotInventARemoteRevocation() async throws {
    let fixture = try fixture()
    defer { fixture.cleanUp() }
    let credentials = GoogleConnection.CredentialStore(read: { nil }, write: { _ in }, delete: {})
    let connection = GoogleConnection(bundle: fixture.bundle, session: session(status: 200),
      defaults: fixture.defaults, credentialStore: credentials)
    try await connection.disconnect()
    await assertNoAccess(connection)
    XCTAssertFalse(connection.needsCredentialCleanup)
    XCTAssertTrue(GoogleLogoutProtocol.requests.isEmpty)
  }
}
