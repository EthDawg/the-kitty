import CryptoKit
import XCTest

@testable import Kitty

@MainActor
final class AskServiceTests: XCTestCase {
  private let baseURL = URL(string: "https://kitty-service.example/household")!
  private let sheetID = "synthetic_sheet_identity_123456"
  private let referenceDate = Date(timeIntervalSince1970: 1_800_000_000)

  private func digest(_ value: String) -> String {
    SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
  }

  private func previewObject(transaction: Bool = false) -> [String: Any] {
    let question = transaction ? "Explain this purchase." : "Explain our cash."
    let scope = transaction ? "transaction" : "overview"
    let fact: [String: Any] = transaction
      ? ["id": "transaction.amount", "label": "Signed transaction amount", "value": "-4.50",
         "kind": "money", "range": "Transactions!A2:J2", "currency": "AUD"]
      : ["id": "networth.cash", "label": "Cash and offset", "value": "99388.43",
         "kind": "money", "range": "Metrics!A2:H2", "currency": "AUD", "period": "31 Jan 2027"]
    let line = transaction ? "Signed transaction amount: -4.50 AUD" : "Cash and offset: 99388.43 AUD (31 Jan 2027)"
    let summary = "Shared with OpenAI\nQuestion: \(question)\nScope: \(scope)\nData as of 2027-01-31\n\(line)\nOnly this question and these facts are sent. Google credentials, Sheet IDs and source links are not sent. The AI cannot change your Sheet."
    let format = ISO8601DateFormatter()
    format.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return [
      "provider": "openai", "providerLabel": "OpenAI", "question": question, "scope": scope,
      "asOf": "2027-01-31", "facts": [fact], "providerSummary": summary,
      "factsHash": String(repeating: "a", count: 64), "summaryHash": digest(summary),
      "previewToken": "fixture_encoded_payload.fixture_signature",
      "expiresAt": format.string(from: referenceDate.addingTimeInterval(300)),
      "limitations": ["Source statements were not inspected."],
    ]
  }

  private func answerObject(transaction: Bool = false) -> [String: Any] {
    let preview = previewObject(transaction: transaction)
    var evidence = (preview["facts"] as! [[String: Any]])[0]
    evidence["url"] = "https://docs.google.com/spreadsheets/d/\(sheetID)/edit#range="
      + (transaction ? "Transactions!A2%3AJ2" : "Metrics!A2%3AH2")
    return [
      "answer": transaction ? "The recorded amount is -4.50 AUD." : "Recorded cash is 99388.43 AUD.",
      "evidence": [evidence], "asOf": "2027-01-31", "provider": "openai",
      "limitations": ["Source statements were not inspected.", "No records were changed."],
    ]
  }

  private func response(_ object: Any, to request: URLRequest, status: Int = 200,
                        mime: String = "application/json") throws -> (Data, HTTPURLResponse) {
    let response = try XCTUnwrap(HTTPURLResponse(url: XCTUnwrap(request.url), statusCode: status,
      httpVersion: nil, headerFields: ["Content-Type": mime]))
    return (try JSONSerialization.data(withJSONObject: object), response)
  }

  private func body(_ request: URLRequest) throws -> [String: Any] {
    try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(request.httpBody)) as? [String: Any])
  }

  @discardableResult
  private func failure(_ code: String, operation: () async throws -> Void,
                       file: StaticString = #filePath, line: UInt = #line) async -> AskServiceFailure? {
    do {
      try await operation()
      XCTFail("Expected a safe refusal with code \(code).", file: file, line: line)
    } catch let error as AskServiceFailure {
      XCTAssertEqual(error.code, code, file: file, line: line)
      return error
    } catch {
      XCTFail("Expected AskServiceFailure, received \(type(of: error)).", file: file, line: line)
    }
    return nil
  }

  func testCapabilitiesUseFreshGoogleAuthorizationAndDoNotInventAnAvailableProvider() async throws {
    var tokens = 0
    var requests: [URLRequest] = []
    let client = AskServiceClient(baseURL: baseURL, tokenProvider: { tokens += 1; return "synthetic-fresh-token" }, transport: { request in
      requests.append(request)
      return try self.response(["providers": [], "scopes": ["overview", "goals", "spending", "transaction"]], to: request)
    })
    let capabilities = try await client.capabilities()
    XCTAssertTrue(client.isConfigured)
    XCTAssertTrue(capabilities.providers.isEmpty, "A configured service is not proof that an AI provider is configured.")
    XCTAssertEqual(tokens, 1)
    XCTAssertEqual(requests.count, 1)
    XCTAssertEqual(requests[0].url?.path, "/household/v1/ask/capabilities")
    XCTAssertEqual(requests[0].httpMethod, "GET")
    XCTAssertNil(requests[0].httpBody)
    XCTAssertEqual(requests[0].value(forHTTPHeaderField: "Authorization"), "Bearer synthetic-fresh-token")
    XCTAssertEqual(requests[0].value(forHTTPHeaderField: "Cache-Control"), "no-store")
  }

  func testPreviewMakesNoAskCallAndApprovalSendsOriginalQuestionAndExactConsentHashes() async throws {
    var tokens = 0
    var requests: [URLRequest] = []
    let fixture = previewObject()
    let client = AskServiceClient(baseURL: baseURL, tokenProvider: {
      tokens += 1
      return "synthetic-token-\(tokens)"
    }, transport: { request in
      requests.append(request)
      return try self.response(request.url?.lastPathComponent == "preview" ? fixture : self.answerObject(), to: request)
    }, now: { self.referenceDate })
    let preview = try await client.preview(sheetID: sheetID, provider: .openai, question: "  Explain our cash.\n")
    XCTAssertEqual(requests.count, 1, "Review must not invoke the paid provider endpoint.")
    XCTAssertEqual(preview.question, "Explain our cash.")
    XCTAssertEqual(preview.providerSummary, fixture["providerSummary"] as? String)
    XCTAssertEqual(preview.limitations, ["Source statements were not inspected."])
    XCTAssertEqual(preview.expiresAt, referenceDate.addingTimeInterval(300))
    let answer = try await client.ask(preview: preview)
    XCTAssertEqual(answer.answer, "Recorded cash is 99388.43 AUD.")
    XCTAssertEqual(answer.evidence.first?.id, "networth.cash")
    XCTAssertEqual(tokens, 2, "Each request must ask GoogleConnection for current access, not reuse a captured token.")
    XCTAssertEqual(requests.count, 2)
    XCTAssertEqual(requests[1].value(forHTTPHeaderField: "Authorization"), "Bearer synthetic-token-2")
    let submitted = try body(requests[1])
    XCTAssertEqual(submitted["sheetId"] as? String, sheetID)
    XCTAssertEqual(submitted["question"] as? String, "Explain our cash.")
    XCTAssertEqual(submitted["provider"] as? String, "openai")
    XCTAssertEqual(submitted["scope"] as? String, "overview")
    XCTAssertEqual(submitted["previewToken"] as? String, fixture["previewToken"] as? String)
    let consent = try XCTUnwrap(submitted["consent"] as? [String: Any])
    XCTAssertEqual(consent["approved"] as? Bool, true)
    XCTAssertEqual(consent["provider"] as? String, "openai")
    XCTAssertEqual(consent["factsHash"] as? String, fixture["factsHash"] as? String)
    XCTAssertEqual(consent["summaryHash"] as? String, fixture["summaryHash"] as? String)
    XCTAssertEqual(Set(submitted.keys), ["sheetId", "provider", "question", "scope", "previewToken", "consent"])
    XCTAssertFalse(String(decoding: try XCTUnwrap(requests[1].httpBody), as: UTF8.self).contains("synthetic-token"))
  }

  func testSelectedTransactionIdentitySurvivesReviewAndApproval() async throws {
    var requests: [URLRequest] = []
    let client = AskServiceClient(baseURL: baseURL, tokenProvider: { "fixture-token" }, transport: { request in
      requests.append(request)
      return try self.response(request.url?.lastPathComponent == "preview" ? self.previewObject(transaction: true) : self.answerObject(transaction: true), to: request)
    }, now: { self.referenceDate })
    let preview = try await client.preview(sheetID: sheetID, provider: .openai, question: "Explain this purchase.", scope: .transaction, transactionID: "T0919")
    let answer = try await client.ask(preview: preview)
    XCTAssertEqual(preview.scope, .transaction)
    XCTAssertTrue(preview.facts.allSatisfy { $0.id.hasPrefix("transaction.") })
    XCTAssertEqual(answer.evidence.first?.range, "Transactions!A2:J2")
    for request in requests {
      XCTAssertEqual(try body(request)["transactionId"] as? String, "T0919")
    }
  }

  func testExpiredPreviewStopsBeforeFetchingAnotherTokenOrSendingAnything() async throws {
    var now = referenceDate
    var tokens = 0
    var calls = 0
    let client = AskServiceClient(baseURL: baseURL, tokenProvider: { tokens += 1; return "fixture-token" }, transport: { request in
      calls += 1
      return try self.response(self.previewObject(), to: request)
    }, now: { now })
    let preview = try await client.preview(sheetID: sheetID, provider: .openai, question: "Explain our cash.")
    now = now.addingTimeInterval(301)
    let error = await failure("preview_expired") { _ = try await client.ask(preview: preview) }
    XCTAssertEqual(error?.requiresNewPreview, true)
    XCTAssertEqual(tokens, 1)
    XCTAssertEqual(calls, 1)
  }

  func testPreviewRejectsProviderMismatchChangedSummaryHashAndImpossibleDate() async {
    var mismatchedProvider = previewObject()
    mismatchedProvider["provider"] = "claude"
    var changedSummary = previewObject()
    changedSummary["providerSummary"] = "Only harmless information is shared."
    changedSummary["summaryHash"] = digest("Only harmless information is shared.")
    var wrongHash = previewObject()
    wrongHash["summaryHash"] = String(repeating: "0", count: 64)
    var impossibleDate = previewObject()
    impossibleDate["asOf"] = "2027-02-30"
    for fixture in [mismatchedProvider, changedSummary, wrongHash, impossibleDate] {
      var calls = 0
      let client = AskServiceClient(baseURL: baseURL, tokenProvider: { "fixture-token" }, transport: { request in
        calls += 1
        return try self.response(fixture, to: request)
      }, now: { self.referenceDate })
      await failure("invalid_response") {
        _ = try await client.preview(sheetID: self.sheetID, provider: .openai, question: "Explain our cash.")
      }
      XCTAssertEqual(calls, 1)
    }
  }

  func testChangedFactsReturnsUsefulNestedErrorWithoutRepeatingOrLeakingDiagnostic() async throws {
    var calls = 0
    let client = AskServiceClient(baseURL: baseURL, tokenProvider: { "fixture-token" }, transport: { request in
      calls += 1
      if calls == 1 { return try self.response(self.previewObject(), to: request) }
      return try self.response(["error": ["code": "facts_changed", "message": "SECRET diagnostic bearer fixture-token"]], to: request, status: 409)
    }, now: { self.referenceDate })
    let preview = try await client.preview(sheetID: sheetID, provider: .openai, question: "Explain our cash.")
    let error = await failure("facts_changed") { _ = try await client.ask(preview: preview) }
    XCTAssertEqual(error?.statusCode, 409)
    XCTAssertEqual(error?.requiresNewPreview, true)
    XCTAssertTrue(error?.localizedDescription.contains("Review a fresh summary") == true)
    XCTAssertFalse(error?.localizedDescription.contains("SECRET") == true)
    XCTAssertEqual(calls, 2, "An approval failure must not automatically retry with different facts or tokens.")
  }

  func testUnsafeServiceConfigurationFailsBeforeAccessingGoogle() async {
    let cases: [(String?, String)] = [
      (nil, "not_configured"),
      ("http://remote.example", "insecure_service_url"),
      ("https://user:secret@remote.example", "invalid_service_url"),
      ("https://remote.example?token=secret", "invalid_service_url"),
      ("https://remote.example#fragment", "invalid_service_url"),
      ("http://localhost.attacker.example", "insecure_service_url"),
    ]
    for (address, expected) in cases {
      var tokens = 0
      var requests = 0
      let client = AskServiceClient(baseURL: address.flatMap(URL.init(string:)), tokenProvider: { tokens += 1; return "private-token" }, transport: { request in
        requests += 1
        return try self.response([:], to: request)
      })
      XCTAssertFalse(client.isConfigured)
      await failure(expected) { _ = try await client.capabilities() }
      XCTAssertEqual(tokens, 0)
      XCTAssertEqual(requests, 0)
    }
    for local in ["http://localhost:8788", "http://127.0.0.1:8788", "http://[::1]:8788"] {
      XCTAssertTrue(AskServiceClient(baseURL: URL(string: local), tokenProvider: { "unused" }).isConfigured)
    }
  }

  func testEvidenceCannotLinkAnotherSheetOrSilentlyChangeAnApprovedFigure() async throws {
    var wrongSheet = answerObject()
    var evidence = wrongSheet["evidence"] as! [[String: Any]]
    evidence[0]["url"] = "https://docs.google.com/spreadsheets/d/some_other_sheet/edit#range=Metrics!A2%3AH2"
    wrongSheet["evidence"] = evidence
    var externalLink = answerObject()
    evidence = externalLink["evidence"] as! [[String: Any]]
    evidence[0]["url"] = "https://outside.example/collect"
    externalLink["evidence"] = evidence
    var changedFigure = answerObject()
    evidence = changedFigure["evidence"] as! [[String: Any]]
    evidence[0]["value"] = "1.00"
    changedFigure["evidence"] = evidence
    for fixture in [wrongSheet, externalLink, changedFigure] {
      let client = AskServiceClient(baseURL: baseURL, tokenProvider: { "fixture-token" }, transport: { request in
        try self.response(request.url?.lastPathComponent == "preview" ? self.previewObject() : fixture, to: request)
      }, now: { self.referenceDate })
      let preview = try await client.preview(sheetID: sheetID, provider: .openai, question: "Explain our cash.")
      await failure("invalid_response") { _ = try await client.ask(preview: preview) }
    }
  }

  func testTransportFailuresAndUnknownNestedErrorsNeverExposePrivateDiagnostics() async {
    let timeout = AskServiceClient(baseURL: baseURL, tokenProvider: { "fixture-token" }, transport: { _ in throw URLError(.timedOut) })
    await failure("service_timeout") { _ = try await timeout.capabilities() }
    let unavailable = AskServiceClient(baseURL: baseURL, tokenProvider: { "fixture-token" }, transport: { _ in
      throw NSError(domain: "SECRET-server-diagnostic", code: 1, userInfo: [NSLocalizedDescriptionKey: "SECRET private request"])
    })
    let error = await failure("service_unavailable") { _ = try await unavailable.capabilities() }
    XCTAssertFalse(error?.localizedDescription.contains("SECRET") == true)
    let unknown = AskServiceClient(baseURL: baseURL, tokenProvider: { "fixture-token" }, transport: { request in
      try self.response(["error": ["code": "SECRET-code", "message": "SECRET key and payload"]], to: request, status: 500)
    })
    let nested = await failure("service_error") { _ = try await unknown.capabilities() }
    XCTAssertFalse(nested?.localizedDescription.contains("SECRET") == true)
  }

  func testRedirectAndOversizedOrHTMLResponsesAreRefused() async {
    var calls = 0
    let redirect = AskServiceClient(baseURL: baseURL, tokenProvider: { "fixture-token" }, transport: { request in
      calls += 1
      return try self.response([:], to: request, status: 302)
    })
    await failure("service_redirect") { _ = try await redirect.capabilities() }
    XCTAssertEqual(calls, 1)
    let large = AskServiceClient(baseURL: baseURL, tokenProvider: { "fixture-token" }, transport: { request in
      try self.response(["unexpected": String(repeating: "x", count: 128 * 1024)], to: request)
    })
    await failure("invalid_response") { _ = try await large.capabilities() }
    let html = AskServiceClient(baseURL: baseURL, tokenProvider: { "fixture-token" }, transport: { request in
      try self.response([:], to: request, mime: "text/html")
    })
    await failure("invalid_response") { _ = try await html.capabilities() }
  }

  func testMissingTransactionOrEmptyQuestionCannotStartARequest() async {
    var calls = 0
    let client = AskServiceClient(baseURL: baseURL, tokenProvider: { calls += 1; return "fixture-token" })
    await failure("invalid_transaction") {
      _ = try await client.preview(sheetID: self.sheetID, provider: .openai, question: "Explain.", scope: .transaction)
    }
    await failure("invalid_transaction") {
      _ = try await client.preview(sheetID: self.sheetID, provider: .openai, question: "Explain.", transactionID: "T1")
    }
    await failure("invalid_question") {
      _ = try await client.preview(sheetID: self.sheetID, provider: .openai, question: " \n")
    }
    XCTAssertEqual(calls, 0)
  }
}
