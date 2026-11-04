import XCTest

@testable import Kitty

@MainActor
final class HouseholdSetupClientTests: XCTestCase {
  private let baseURL = URL(string: "https://kitty-service.example/household")!
  private let setupID = "synthetic_setup_123456"
  private let digest = String(repeating: "a", count: 64)
  // Produced independently by templates/build.mjs for this normalized fixture.
  private let inputDigest = "37ac7504b4d1dab0e97b3d9b520de7d86dd3c44f3419a6a52ed56de05cbf437b"

  private func input() -> [String: Any] {
    ["profile": "au-aud-basic", "sheetVersion": 1, "country": "AU", "currency": "AUD",
     "householdName": "The Fixture", "people": ["Jamie"], "openingDate": "2027-01-31",
     "accounts": [["id": "CASH", "name": "Everyday", "institution": "Fictional Bank",
       "type": "Transaction", "owner": "Jamie", "openingMinor": "12345"]],
     "budgets": [Any](), "emergencyAccountId": NSNull(), "goal": NSNull(),
     "capacity": ["transactions": 2000, "payslips": 500, "valuations": 500]]
  }

  private func reserveObject() -> [String: Any] {
    let input = input()
    var summary = input.filter { !["profile", "sheetVersion", "country"].contains($0.key) }
    summary["firstImportDate"] = "2027-02-01"
    summary["openingCashMinor"] = "12345"
    summary["unavailableModules"] = ["tax", "mortgage", "whole-household net worth", "assets", "subscriptions", "savings opportunities"]
    summary["initialState"] = "Opening balances only; no imported or closed periods. Historical metrics are unavailable until supported by records."
    return ["setupId": setupID, "createIntentId": "synthetic_create_intent_123456",
      "initializeIntentId": "synthetic_initialize_intent_123456", "proposalDigest": digest,
      "ownerPermissionId": "synthetic_owner_123456", "status": "reserved",
      "sourceSha256": HouseholdSetupClient.supportedSourceSha256, "inputSha256": inputDigest,
      "normalizedInput": input, "reviewSummary": summary]
  }

  private func result(status: String = "prepared") -> [String: Any] {
    var result: [String: Any] = ["setupId": setupID, "proposalDigest": digest,
      "ownerPermissionId": "synthetic_owner_123456", "status": status,
      "phase": ["verified", "cancelled"].contains(status) ? "complete" : "manifest",
      "canContinue": ["prepared", "created"].contains(status), "canCancel": status == "prepared",
      "issues": [[String: Any]]()]
    if ["created", "verified"].contains(status) { result["sheetId"] = "synthetic_new_sheet_123456" }
    return result
  }

  private func data(_ object: [String: Any]) throws -> Data {
    try JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys])
  }

  private func response(_ object: [String: Any], request: URLRequest, status: Int = 200,
                        url: URL? = nil) throws -> (Data, HTTPURLResponse) {
    (try data(object), HTTPURLResponse(url: url ?? request.url!, statusCode: status,
      httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!)
  }

  private func body(_ request: URLRequest) throws -> [String: Any] {
    try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(request.httpBody)) as? [String: Any])
  }

  @discardableResult private func failure(_ expectedCode: String? = nil,
    operation: () async throws -> Void, file: StaticString = #filePath, line: UInt = #line
  ) async -> Error? {
    do { try await operation(); XCTFail("Expected rejection.", file: file, line: line); return nil }
    catch {
      if let expectedCode {
        XCTAssertEqual((error as? HouseholdSetupFailure)?.code, expectedCode, file: file, line: line)
      }
      return error
    }
  }

  func testReservationReturnsPersistableHandoffAndNeverAutoBeginsOrContinues() async throws {
    var requests: [URLRequest] = []
    var tokens = 0
    let client = HouseholdSetupClient(baseURL: baseURL, tokenProvider: {
      tokens += 1; return "synthetic-token-\(tokens)"
    }, transport: { request in
      requests.append(request)
      return try self.response(request.url!.lastPathComponent == "reserve" ? self.reserveObject()
        : self.result(status: "unknown"), request: request)
    })
    let reservation = try await client.reserve(input: data(input()),
      expectedSourceSha256: HouseholdSetupClient.supportedSourceSha256)
    XCTAssertEqual(requests.count, 1, "Reserving must not dispatch begin, continue or status.")
    XCTAssertEqual(requests[0].url?.path, "/household/v1/setup/reserve")
    XCTAssertEqual(Set(try body(requests[0]).keys), ["input"])
    XCTAssertEqual(reservation.inputSha256, inputDigest)
    let persisted = try JSONEncoder().encode(reservation)
    XCTAssertFalse(String(decoding: persisted, as: UTF8.self).contains("synthetic-token"))
    let restored = try JSONDecoder().decode(HouseholdSetupReservation.self, from: persisted)
    try restored.validate()
    XCTAssertEqual(restored, reservation)
    let outcome = try await client.begin(reservation: restored, approvedInput: data(input()))
    XCTAssertEqual(outcome.status, .unknown)
    XCTAssertFalse(outcome.canContinue)
    XCTAssertFalse(outcome.canCancel)
    XCTAssertEqual(requests.count, 2, "Unknown creation must not create another reservation or retry automatically.")
    XCTAssertEqual(tokens, 2)
    XCTAssertEqual(requests[1].value(forHTTPHeaderField: "Authorization"), "Bearer synthetic-token-2")
    XCTAssertEqual(requests[1].value(forHTTPHeaderField: "Cache-Control"), "no-store")
    let approved = try body(requests[1])
    XCTAssertEqual(Set(approved.keys), ["proposalDigest", "createIntentId", "initializeIntentId", "input", "approval"])
    XCTAssertEqual(approved["proposalDigest"] as? String, digest)
    XCTAssertEqual(approved["createIntentId"] as? String, restored.createIntentId)
    XCTAssertEqual(approved["initializeIntentId"] as? String, restored.initializeIntentId)
    XCTAssertEqual(approved["approval"] as? Bool, true)
  }

  func testChangedApprovedSettingsAreRejectedBeforeTokenOrHTTP() async throws {
    var tokens = 0
    var requests = 0
    let client = HouseholdSetupClient(baseURL: baseURL, tokenProvider: { tokens += 1; return "synthetic-token" },
      transport: { request in requests += 1; return try self.response(self.reserveObject(), request: request) })
    let reservation = try await client.reserve(input: data(input()))
    var changed = input(); changed["householdName"] = "Another household"
    await failure("setup_review_changed") { _ = try await client.begin(reservation: reservation, approvedInput: self.data(changed)) }
    XCTAssertEqual(tokens, 1)
    XCTAssertEqual(requests, 1)
  }

  func testMalformedAndUnexpectedReservationMetadataNeverPermitsBegin() async throws {
    var samples: [[String: Any]] = []
    for missing in ["setupId", "createIntentId", "initializeIntentId", "proposalDigest", "ownerPermissionId", "inputSha256", "normalizedInput", "reviewSummary"] {
      var sample = reserveObject(); sample.removeValue(forKey: missing); samples.append(sample)
    }
    var duplicate = reserveObject(); duplicate["createIntentId"] = setupID; samples.append(duplicate)
    var badID = reserveObject(); badID["setupId"] = "../another/operation"; samples.append(badID)
    var source = reserveObject(); source["sourceSha256"] = String(repeating: "b", count: 64); samples.append(source)
    var hash = reserveObject(); hash["inputSha256"] = String(repeating: "c", count: 64); samples.append(hash)
    var status = reserveObject(); status["status"] = "verified"; samples.append(status)
    for sample in samples {
      var calls = 0
      let client = HouseholdSetupClient(baseURL: baseURL, tokenProvider: { "synthetic-token" }, transport: { request in
        calls += 1; return try self.response(sample, request: request)
      })
      await failure { _ = try await client.reserve(input: self.data(self.input())) }
      XCTAssertEqual(calls, 1)
    }
  }

  func testNormalizationAndDisplayedSummaryCannotChangeReviewedFacts() async throws {
    var normalized = reserveObject()
    var alteredInput = input(); alteredInput["currency"] = "USD"
    normalized["normalizedInput"] = alteredInput
    var summaryCurrency = reserveObject()
    var summary = try XCTUnwrap(summaryCurrency["reviewSummary"] as? [String: Any])
    summary["currency"] = "USD"; summaryCurrency["reviewSummary"] = summary
    var summaryAvailability = reserveObject()
    summary = try XCTUnwrap(summaryAvailability["reviewSummary"] as? [String: Any])
    summary["unavailableModules"] = [String](); summaryAvailability["reviewSummary"] = summary
    var wrongDate = reserveObject()
    summary = try XCTUnwrap(wrongDate["reviewSummary"] as? [String: Any])
    summary["firstImportDate"] = "2027-01-31"; wrongDate["reviewSummary"] = summary
    var wrongTotal = reserveObject()
    summary = try XCTUnwrap(wrongTotal["reviewSummary"] as? [String: Any])
    summary["openingCashMinor"] = "1234500"; wrongTotal["reviewSummary"] = summary
    for sample in [normalized, summaryCurrency, summaryAvailability, wrongDate, wrongTotal] {
      let client = HouseholdSetupClient(baseURL: baseURL, tokenProvider: { "synthetic-token" },
        transport: { request in try self.response(sample, request: request) })
      await failure { _ = try await client.reserve(input: self.data(self.input())) }
    }
  }

  func testCanonicalInputMatchesNodeForUnicodeAndUnescapedSlash() async throws {
    var unicodeInput = input(); unicodeInput["householdName"] = "Finances / café 🐱\u{2028}family"
    var wire = reserveObject(); wire["normalizedInput"] = unicodeInput
    // Independently computed with the pinned Node generator, including its canonical JSON hash.
    wire["inputSha256"] = "a9e8b53172ba404b75a8a3386f1ba5d5ffb61c501454cd1a6ad997e38e898e09"
    var summary = try XCTUnwrap(wire["reviewSummary"] as? [String: Any])
    summary["householdName"] = unicodeInput["householdName"]; wire["reviewSummary"] = summary
    let client = HouseholdSetupClient(baseURL: baseURL, tokenProvider: { "synthetic-token" },
      transport: { request in try self.response(wire, request: request) })
    let reservation = try await client.reserve(input: data(unicodeInput))
    XCTAssertEqual(reservation.inputSha256, wire["inputSha256"] as? String)
    try reservation.validate()
  }

  func testLifecycleRejectsAnotherSetupDigestOrOwnerEvenWhenItClaimsVerified() async throws {
    for field in ["setupId", "proposalDigest", "ownerPermissionId"] {
      var unrelated = result(status: "verified")
      unrelated[field] = field == "proposalDigest" ? String(repeating: "b", count: 64) : "unrelated_identity_123456"
      let client = HouseholdSetupClient(baseURL: baseURL, tokenProvider: { "synthetic-token" }, transport: { request in
        try self.response(request.url!.lastPathComponent == "reserve" ? self.reserveObject() : unrelated, request: request)
      })
      let reservation = try await client.reserve(input: data(input()))
      await failure("invalid_response") { _ = try await client.status(reservation: reservation) }
    }
  }

  func testPersistedTerminalResultsAndApprovedInputMustMatchTheirReservation() async throws {
    let client = HouseholdSetupClient(baseURL: baseURL, tokenProvider: { "synthetic-token" },
      transport: { request in try self.response(self.reserveObject(), request: request) })
    let reservation = try await client.reserve(input: data(input()))
    try reservation.validateApprovedInput(data(input()))
    var changed = input(); changed["householdName"] = "Another household"
    XCTAssertThrowsError(try reservation.validateApprovedInput(data(changed)))

    for status in ["verified", "cancelled"] {
      let valid = try JSONDecoder().decode(HouseholdSetupResult.self, from: data(result(status: status)))
      try valid.validate(reservation: reservation)
      for field in ["setupId", "proposalDigest", "ownerPermissionId"] {
        var unrelated = result(status: status)
        unrelated[field] = field == "proposalDigest" ? String(repeating: "b", count: 64) : "other_saved_identity_123456"
        let persisted = try JSONDecoder().decode(HouseholdSetupResult.self, from: data(unrelated))
        XCTAssertThrowsError(try persisted.validate(reservation: reservation),
          "A restored terminal status cannot authorize opening or discarding another setup.")
      }
    }
    var unsafe = result(status: "verified"); unsafe["canContinue"] = true
    let unsafeResult = try JSONDecoder().decode(HouseholdSetupResult.self, from: data(unsafe))
    XCTAssertThrowsError(try unsafeResult.validate(reservation: reservation))
  }

  func testStatusFlagsAndVerifiedSheetAreStrict() async throws {
    var unknownCanContinue = result(status: "unknown"); unknownCanContinue["canContinue"] = true
    var createdCanCancel = result(status: "created"); createdCanCancel["canCancel"] = true
    var missingSheet = result(status: "verified"); missingSheet.removeValue(forKey: "sheetId")
    var incompleteVerified = result(status: "verified"); incompleteVerified["phase"] = "create"
    var unknownStatus = result(); unknownStatus["status"] = "finished"
    var unknownPhase = result(); unknownPhase["phase"] = "almost_done"
    for result in [unknownCanContinue, createdCanCancel, missingSheet, incompleteVerified, unknownStatus, unknownPhase] {
      let client = HouseholdSetupClient(baseURL: baseURL, tokenProvider: { "synthetic-token" }, transport: { request in
        try self.response(request.url!.lastPathComponent == "reserve" ? self.reserveObject() : result, request: request)
      })
      let reservation = try await client.reserve(input: data(input()))
      await failure("invalid_response") { _ = try await client.status(reservation: reservation) }
    }
  }

  func testStatusAndContinueKeepMinimalBindingsWhileCancellationIncludesTheReservedPlan() async throws {
    var requests: [URLRequest] = []
    let client = HouseholdSetupClient(baseURL: baseURL, tokenProvider: { "synthetic-token" }, transport: { request in
      requests.append(request)
      let path = request.url!.lastPathComponent
      return try self.response(path == "reserve" ? self.reserveObject()
        : self.result(status: path == "cancel" ? "cancelled" : path == "continue" ? "created" : "prepared"), request: request)
    })
    let reservation = try await client.reserve(input: data(input()))
    let prepared = try await client.status(reservation: reservation)
    let created = try await client.continueSetup(reservation: reservation)
    let cancelled = try await client.cancel(reservation: reservation)
    XCTAssertEqual(prepared.status, .prepared)
    XCTAssertEqual(created.status, .created)
    XCTAssertEqual(cancelled.status, .cancelled)
    XCTAssertEqual(requests.count, 4)
    XCTAssertEqual(requests[1].httpMethod, "GET")
    XCTAssertNil(requests[1].httpBody)
    let query = try XCTUnwrap(URLComponents(url: requests[1].url!, resolvingAgainstBaseURL: false)?.queryItems)
    XCTAssertEqual(query, [URLQueryItem(name: "proposalDigest", value: digest)])
    XCTAssertEqual(Set(try body(requests[2]).keys), ["proposalDigest", "approval"])
    let cancellation = try body(requests[3])
    XCTAssertEqual(Set(cancellation.keys), ["proposalDigest", "createIntentId", "initializeIntentId", "ownerPermissionId", "input"])
    XCTAssertEqual(cancellation["createIntentId"] as? String, reservation.createIntentId)
    XCTAssertEqual(cancellation["initializeIntentId"] as? String, reservation.initializeIntentId)
    XCTAssertEqual(cancellation["ownerPermissionId"] as? String, reservation.ownerPermissionId)
    try reservation.validateApprovedInput(data(XCTUnwrap(cancellation["input"] as? [String: Any])))
  }

  func testPreBeginCancellationCanBeRepeatedAfterLostResponseUsingTheSameSavedReservation() async throws {
    var requests: [URLRequest] = []
    var cancellations = 0
    let client = HouseholdSetupClient(baseURL: baseURL, tokenProvider: { "synthetic-token" }, transport: { request in
      requests.append(request)
      if request.url!.lastPathComponent == "reserve" {
        return try self.response(self.reserveObject(), request: request)
      }
      XCTAssertEqual(request.url!.lastPathComponent, "cancel", "Cancellation must never initiate creation.")
      cancellations += 1
      if cancellations == 1 { throw URLError(.networkConnectionLost) }
      return try self.response(self.result(status: "cancelled"), request: request)
    })
    let reservation = try await client.reserve(input: data(input()))
    let persisted = try JSONEncoder().encode(reservation)
    await failure { _ = try await client.cancel(reservation: reservation) }
    XCTAssertEqual(requests.count, 2, "A lost cancellation response must not trigger automatic retry.")
    let restored = try JSONDecoder().decode(HouseholdSetupReservation.self, from: persisted)
    let result = try await client.cancel(reservation: restored)
    XCTAssertEqual(result.status, .cancelled)
    XCTAssertEqual(requests.count, 3)
    XCTAssertEqual(requests[1].url, requests[2].url)
    let first = try body(requests[1]), second = try body(requests[2])
    XCTAssertEqual(try data(first), try data(second), "Explicit recovery must reuse the full original reservation binding.")
    XCTAssertEqual(first["proposalDigest"] as? String, digest)
    XCTAssertEqual(first["ownerPermissionId"] as? String, reservation.ownerPermissionId)
    try restored.validateApprovedInput(data(XCTUnwrap(second["input"] as? [String: Any])))
  }

  func testCorruptedPersistedReservationCannotReachTheService() async throws {
    var calls = 0
    let client = HouseholdSetupClient(baseURL: baseURL, tokenProvider: { "synthetic-token" }, transport: { request in
      calls += 1; return try self.response(self.reserveObject(), request: request)
    })
    let reservation = try await client.reserve(input: data(input()))
    var persisted = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(reservation)) as? [String: Any])
    persisted["inputSha256"] = String(repeating: "0", count: 64)
    let corrupted = try JSONDecoder().decode(HouseholdSetupReservation.self, from: data(persisted))
    await failure("invalid_reservation") { _ = try await client.status(reservation: corrupted) }
    await failure("invalid_reservation") { _ = try await client.cancel(reservation: corrupted) }
    XCTAssertEqual(calls, 1)
  }

  func testInvalidServiceAddressStopsBeforeGoogleAccess() async throws {
    for address in [nil, "http://kitty-service.example", "https://user:pass@kitty-service.example", "https://kitty-service.example?token=bad", "https://kitty-service.example#fragment"] as [String?] {
      var tokens = 0
      let client = HouseholdSetupClient(baseURL: address.flatMap(URL.init(string:)),
        tokenProvider: { tokens += 1; return "synthetic-token" },
        transport: { _ in XCTFail("An invalid endpoint must not be contacted."); throw CancellationError() })
      XCTAssertFalse(client.isConfigured)
      await failure { _ = try await client.reserve(input: self.data(self.input())) }
      XCTAssertEqual(tokens, 0)
    }
  }

  func testSharedTransportRejectsRedirectAndPreservesUsefulServiceFailureWithoutRetry() async throws {
    for status in [307, 503] {
      var calls = 0
      let client = HouseholdSetupClient(baseURL: baseURL, tokenProvider: { "synthetic-token" }, transport: { request in
        calls += 1
        return try self.response(["error": ["code": "setup_outcome_unknown", "message": "Keep the saved setup and check its status."]],
          request: request, status: status)
      })
      let error = await failure { _ = try await client.reserve(input: self.data(self.input())) }
      XCTAssertEqual(calls, 1)
      if status == 503 {
        XCTAssertEqual((error as? HouseholdSetupFailure)?.code, "setup_outcome_unknown")
        XCTAssertEqual((error as? HouseholdSetupFailure)?.statusCode, 503)
        XCTAssertEqual(error?.localizedDescription, "Keep the saved setup and check its status.")
      }
    }
  }
}
