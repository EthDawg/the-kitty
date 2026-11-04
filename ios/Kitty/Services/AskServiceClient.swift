import CryptoKit
import Foundation

enum AskProvider: String, Codable, CaseIterable, Identifiable {
  case claude, openai
  var id: String { rawValue }
  var label: String { self == .claude ? "Claude" : "OpenAI" }
  fileprivate var serviceLabel: String { self == .claude ? "Claude (Anthropic)" : "OpenAI" }
}

enum AskScope: String, Codable, CaseIterable, Identifiable {
  case overview, goals, spending, transaction
  var id: String { rawValue }
  var label: String {
    switch self {
    case .overview: return "Household overview"
    case .goals: return "Savings goals"
    case .spending: return "Spending this month"
    case .transaction: return "Selected transaction"
    }
  }
}

struct AskProviderOption: Decodable, Identifiable {
  let id: AskProvider
  let label: String
}

struct AskCapabilities: Decodable {
  let providers: [AskProviderOption]
  let scopes: [AskScope]
}

enum AskFactKind: String, Codable { case money, date, text, count }

struct AskFact: Codable, Identifiable, Equatable {
  let id: String
  let label: String
  let value: String
  let kind: AskFactKind
  let range: String
  let currency: String?
  let period: String?
}

struct AskEvidence: Decodable, Identifiable {
  let id: String
  let label: String
  let value: String
  let kind: AskFactKind
  let range: String
  let currency: String?
  let period: String?
  let url: URL

  fileprivate var fact: AskFact {
    AskFact(id: id, label: label, value: value, kind: kind, range: range, currency: currency, period: period)
  }
}

struct AskResponse: Decodable {
  let answer: String
  let evidence: [AskEvidence]
  let asOf: String
  let provider: AskProvider
  let limitations: [String]
}

/// An in-memory review, bound to its original request. It deliberately cannot be encoded or edited.
struct AskPreview: Identifiable {
  fileprivate let request: AskRequest
  fileprivate let payload: AskPreviewPayload
  var id: String { payload.previewToken }
  var provider: AskProvider { payload.provider }
  var providerLabel: String { payload.providerLabel }
  var question: String { payload.question }
  var scope: AskScope { payload.scope }
  var asOf: String { payload.asOf }
  var facts: [AskFact] { payload.facts }
  var providerSummary: String { payload.providerSummary }
  var expiresAt: Date { payload.expiresAt }
  var limitations: [String] { payload.limitations }
  var isExpired: Bool { expiresAt <= Date() }
}

struct AskServiceFailure: LocalizedError, Equatable {
  let code: String
  let message: String
  let statusCode: Int?
  var errorDescription: String? { message }
  var requiresNewPreview: Bool {
    ["preview_required", "invalid_preview", "preview_expired", "preview_changed", "facts_changed", "consent_required"].contains(code)
  }

  init(code: String, message: String, statusCode: Int? = nil) {
    self.code = code
    self.message = message
    self.statusCode = statusCode
  }
}

fileprivate struct AskRequest: Encodable {
  let sheetId: String
  let provider: AskProvider
  let question: String
  let scope: AskScope
  let transactionId: String?
}

fileprivate struct AskPreviewPayload: Decodable {
  let provider: AskProvider
  let providerLabel: String
  let question: String
  let scope: AskScope
  let asOf: String
  let facts: [AskFact]
  let providerSummary: String
  let factsHash: String
  let summaryHash: String
  let previewToken: String
  let expiresAt: Date
  let limitations: [String]
}

/// No provider key, Google token or financial response is persisted by this client.
@MainActor
final class AskServiceClient {
  typealias Transport = (URLRequest) async throws -> (Data, HTTPURLResponse)
  private let baseURL: URL?
  private let tokenProvider: () async throws -> String
  private let transport: Transport
  private let now: () -> Date
  private static let responseLimit = 128 * 1024

  convenience init(google: GoogleConnection, bundle: Bundle = .main) {
    let raw = (bundle.object(forInfoDictionaryKey: "KittyServiceURL") as? String)?
      .trimmingCharacters(in: .whitespacesAndNewlines)
    let url = raw.flatMap { $0.isEmpty || $0.contains("$(") ? nil : URL(string: $0) }
    self.init(baseURL: url, tokenProvider: { try await google.accessToken() })
  }

  /// Injection is internal so protocol tests never require a Google account or a live provider.
  init(baseURL: URL?, tokenProvider: @escaping () async throws -> String,
       transport: Transport? = nil, now: @escaping () -> Date = Date.init) {
    self.baseURL = baseURL
    self.tokenProvider = tokenProvider
    self.transport = transport ?? Self.send
    self.now = now
  }

  var isConfigured: Bool { (try? checkedBaseURL()) != nil }

  func capabilities() async throws -> AskCapabilities {
    let value: AskCapabilities = try decode(await request(path: "v1/ask/capabilities", method: "GET"))
    guard value.providers.count <= AskProvider.allCases.count,
      Set(value.providers.map(\.id)).count == value.providers.count,
      value.providers.allSatisfy({ $0.label == $0.id.serviceLabel }),
      Set(value.scopes).count == value.scopes.count
    else { throw Self.invalidResponse() }
    return value
  }

  func preview(sheetID: String, provider: AskProvider, question: String,
               scope: AskScope = .overview, transactionID: String? = nil) async throws -> AskPreview {
    let trimmed = question.trimmingCharacters(in: .whitespacesAndNewlines)
    guard sheetID.range(of: "^[A-Za-z0-9_-]{12,200}$", options: .regularExpression) != nil else {
      throw AskServiceFailure(code: "invalid_sheet", message: "Choose an authorised Kitty Sheet before asking.")
    }
    guard !trimmed.isEmpty, question.utf16.count <= 2000 else {
      throw AskServiceFailure(code: "invalid_question", message: "Ask a question of 2,000 characters or fewer.")
    }
    guard scope == .transaction
      ? (transactionID?.isEmpty == false && (transactionID?.utf16.count ?? 0) <= 100)
      : transactionID == nil
    else {
      throw AskServiceFailure(code: "invalid_transaction", message: "Choose a transaction for this question, or use another scope.")
    }
    let original = AskRequest(sheetId: sheetID, provider: provider, question: trimmed, scope: scope, transactionId: transactionID)
    let payload: AskPreviewPayload = try decode(await request(path: "v1/ask/preview", body: JSONEncoder().encode(original)))
    try validate(payload, for: original)
    return AskPreview(request: original, payload: payload)
  }

  /// Call only after the user has reviewed providerSummary AND limitations and taps the sharing button.
  /// Calling this method is the affirmative consent; editing a question requires a new preview.
  func ask(preview: AskPreview) async throws -> AskResponse {
    guard preview.expiresAt > now() else {
      throw AskServiceFailure(code: "preview_expired", message: "Your sharing preview has expired. Review a fresh summary.")
    }
    struct ApprovedRequest: Encodable {
      struct Consent: Encodable {
        let approved = true
        let provider: AskProvider
        let factsHash: String
        let summaryHash: String
      }
      let sheetId: String
      let provider: AskProvider
      let question: String
      let scope: AskScope
      let transactionId: String?
      let previewToken: String
      let consent: Consent
    }
    let original = preview.request
    let body = ApprovedRequest(sheetId: original.sheetId, provider: original.provider,
      question: original.question, scope: original.scope, transactionId: original.transactionId,
      previewToken: preview.payload.previewToken,
      consent: .init(provider: original.provider, factsHash: preview.payload.factsHash, summaryHash: preview.payload.summaryHash))
    let answer: AskResponse = try decode(await request(path: "v1/ask", body: JSONEncoder().encode(body)))
    guard answer.provider == preview.provider, answer.asOf == preview.asOf,
      !answer.answer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, answer.answer.utf16.count <= 6000,
      answer.evidence.count <= preview.facts.count, Set(answer.evidence.map(\.id)).count == answer.evidence.count,
      Self.validLimitations(answer.limitations),
      answer.evidence.allSatisfy({ evidence in
        preview.facts.contains(evidence.fact) && Self.isSourceURL(evidence.url, sheetID: original.sheetId, range: evidence.range)
      })
    else { throw Self.invalidResponse() }
    return answer
  }

  private func validate(_ payload: AskPreviewPayload, for original: AskRequest) throws {
    guard payload.provider == original.provider, payload.providerLabel == original.provider.serviceLabel,
      payload.question == original.question, payload.scope == original.scope, Self.validDay(payload.asOf),
      payload.expiresAt > now(), payload.expiresAt.timeIntervalSince(now()) <= 360,
      !payload.facts.isEmpty, payload.facts.count <= 80, Set(payload.facts.map(\.id)).count == payload.facts.count,
      payload.facts.allSatisfy(Self.validFact), Self.validLimitations(payload.limitations),
      payload.providerSummary.utf8.count <= 40_000,
      payload.factsHash.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
      payload.summaryHash == Self.sha256(payload.providerSummary),
      payload.previewToken.utf8.count < 3000,
      payload.previewToken.range(of: "^[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$", options: .regularExpression) != nil
    else { throw Self.invalidResponse() }
    // The summary is what the user approves, so it must describe these exact structured facts.
    let expected = "Shared with \(payload.providerLabel)\nQuestion: \(original.question)\nScope: \(original.scope.rawValue)\nData as of \(payload.asOf)\n"
      + payload.facts.map { fact in
        fact.label + ": " + fact.value + (fact.currency.map { " " + $0 } ?? "")
          + (fact.period.flatMap { $0.isEmpty ? nil : " (" + $0 + ")" } ?? "")
      }.joined(separator: "\n")
      + "\nOnly this question and these facts are sent. Google credentials, Sheet IDs and source links are not sent. The AI cannot change your Sheet."
    guard payload.providerSummary == expected else { throw Self.invalidResponse() }
  }

  private func checkedBaseURL() throws -> URL {
    guard let baseURL else {
      throw AskServiceFailure(code: "not_configured", message: "Ask inside The Kitty is not connected in this build. You can still copy a summary to your own AI app.")
    }
    guard let parts = URLComponents(url: baseURL, resolvingAgainstBaseURL: false),
      let host = parts.host, !host.isEmpty, parts.user == nil, parts.password == nil,
      parts.query == nil, parts.fragment == nil,
      parts.port == nil || (1...65535).contains(parts.port!)
    else { throw AskServiceFailure(code: "invalid_service_url", message: "The Ask service address needs a valid HTTPS address without credentials or query parameters.") }
    let loopback = ["localhost", "127.0.0.1", "::1", "[::1]"].contains(host.lowercased())
    guard parts.scheme?.lowercased() == "https" || (parts.scheme?.lowercased() == "http" && loopback) else {
      throw AskServiceFailure(code: "insecure_service_url", message: "The Ask service needs HTTPS to protect your Google access and financial summary.")
    }
    return baseURL
  }

  private func request(path: String, method: String = "POST", body: Data? = nil) async throws -> Data {
    let url = try checkedBaseURL().appendingPathComponent(path)
    let token: String
    do { token = try await tokenProvider() }
    catch is CancellationError { throw CancellationError() }
    catch let error as GoogleConnection.ConnectionError { throw error }
    catch { throw AskServiceFailure(code: "google_reconnect", message: "Google access could not be refreshed. Reconnect Google and try again.") }
    guard !token.isEmpty, token.utf8.count <= 8192, token.rangeOfCharacter(from: .whitespacesAndNewlines) == nil else {
      throw AskServiceFailure(code: "google_reconnect", message: "Reconnect Google before asking about this Sheet.")
    }
    try Task.checkCancellation()
    var request = URLRequest(url: url)
    request.httpMethod = method
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
    if let body {
      guard body.count <= 16 * 1024 else { throw AskServiceFailure(code: "request_too_large", message: "This question is too large. Shorten it and review again.") }
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      request.httpBody = body
    }
    request.timeoutInterval = 60
    request.cachePolicy = .reloadIgnoringLocalCacheData
    let data: Data
    let response: HTTPURLResponse
    do { (data, response) = try await transport(request) }
    catch is CancellationError { throw CancellationError() }
    catch let error as AskServiceFailure { throw error }
    catch let error as URLError where error.code == .cancelled { throw CancellationError() }
    catch let error as URLError where error.code == .timedOut {
      throw AskServiceFailure(code: "service_timeout", message: "The Ask request timed out. An answer was not received; your Sheet was not changed.")
    } catch {
      throw AskServiceFailure(code: "service_unavailable", message: "The Ask service could not be reached. Check your connection and try again.")
    }
    try Task.checkCancellation()
    guard response.url == url, data.count <= Self.responseLimit else { throw Self.invalidResponse() }
    guard !(300..<400).contains(response.statusCode) else {
      throw AskServiceFailure(code: "service_redirect", message: "The Ask service redirected this request. Update its configured address before sharing.", statusCode: response.statusCode)
    }
    guard (200..<300).contains(response.statusCode) else { throw Self.failure(data, status: response.statusCode) }
    guard response.mimeType?.lowercased() == "application/json" else { throw Self.invalidResponse() }
    return data
  }

  private func decode<T: Decodable>(_ data: Data) throws -> T {
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .custom { decoder in
      let container = try decoder.singleValueContainer()
      let value = try container.decode(String.self)
      let format = ISO8601DateFormatter()
      format.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
      if let date = format.date(from: value) { return date }
      format.formatOptions = [.withInternetDateTime]
      guard let date = format.date(from: value) else {
        throw DecodingError.dataCorruptedError(in: container, debugDescription: "Invalid timestamp")
      }
      return date
    }
    do { return try decoder.decode(T.self, from: data) }
    catch { throw Self.invalidResponse() }
  }

  private static func validDay(_ value: String) -> Bool {
    guard value.range(of: "^\\d{4}-\\d{2}-\\d{2}$", options: .regularExpression) != nil else { return false }
    let format = DateFormatter()
    format.locale = Locale(identifier: "en_US_POSIX")
    format.calendar = Calendar(identifier: .gregorian)
    format.timeZone = TimeZone(secondsFromGMT: 0)
    format.dateFormat = "yyyy-MM-dd"
    format.isLenient = false
    guard let date = format.date(from: value) else { return false }
    return format.string(from: date) == value
  }

  private static func validFact(_ fact: AskFact) -> Bool {
    !fact.id.isEmpty && fact.id.utf16.count <= 100 && fact.label.utf16.count <= 200
      && fact.value.utf16.count <= 2000 && !fact.range.isEmpty && fact.range.utf16.count <= 160
      && (fact.currency == nil || fact.currency?.range(of: "^[A-Z]{3}$", options: .regularExpression) != nil)
      && (fact.period?.utf16.count ?? 0) <= 100
  }

  private static func validLimitations(_ value: [String]) -> Bool {
    value.count <= 32 && value.allSatisfy { $0.utf16.count <= 500 }
  }

  private static func isSourceURL(_ url: URL, sheetID: String, range: String) -> Bool {
    guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return false }
    return parts.scheme == "https" && parts.host == "docs.google.com" && parts.port == nil
      && parts.user == nil && parts.password == nil && parts.query == nil
      && parts.path == "/spreadsheets/d/\(sheetID)/edit"
      && parts.percentEncodedFragment?.removingPercentEncoding == "range=\(range)"
  }

  private static func sha256(_ value: String) -> String {
    SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
  }

  private static func invalidResponse() -> AskServiceFailure {
    AskServiceFailure(code: "invalid_response", message: "The Ask response could not be verified. Review a fresh summary before trying again.")
  }

  private static func failure(_ data: Data, status: Int) -> AskServiceFailure {
    struct Envelope: Decodable { struct Detail: Decodable { let code: String }; let error: Detail }
    let code = (try? JSONDecoder().decode(Envelope.self, from: data))?.error.code ?? "service_error"
    let messages: [String: String] = [
      "unauthorized": "Connect Google before asking about your Sheet.",
      "google_reconnect": "Your Google connection needs to be renewed. Reconnect and try again.",
      "sheet_permission": "This Google account cannot read the selected Sheet. Choose it again with Google.",
      "provider_unavailable": "This AI provider is not configured. You can still copy a summary to your own AI app.",
      "not_configured": "Ask inside The Kitty is not connected in this build.",
      "preview_required": "Review the sharing summary before asking.",
      "invalid_preview": "The sharing preview could not be verified. Review a fresh summary.",
      "preview_expired": "Your sharing preview has expired. Review a fresh summary.",
      "preview_changed": "The Google account, question, provider or scope changed. Review a fresh summary.",
      "facts_changed": "The Sheet changed since you reviewed it. Review a fresh summary before sharing.",
      "consent_required": "Review and approve this provider and summary before sharing.",
      "rate_limited": "Please wait a moment before asking again.",
      "google_unavailable": "Your Sheet could not be read. Nothing has been sent to AI. Try again shortly.",
      "google_invalid": "Google returned an unreadable Sheet. Refresh it before asking again.",
      "schema_mismatch": "Required Sheet columns have moved or changed. Restore the Kitty layout before asking.",
      "unsupported_schema": "This Sheet has an unknown or missing version. Choose a supported Kitty Sheet.",
      "invalid_asof": "The Sheet needs a valid as-of date before asking.",
      "invalid_snapshot": "The Sheet does not have a complete set of facts for this question. Refresh and review it.",
      "facts_missing": "No facts are available for this question. Update the Sheet first.",
      "invalid_fact": "A required figure is missing or outside the supported range. Check the Sheet.",
      "invalid_currency": "The Sheet needs a supported currency code.",
      "duplicate_metric": "A headline metric is repeated in the Sheet. Resolve it before asking.",
      "duplicate_transaction": "The Sheet has repeated transaction IDs. Resolve them before asking.",
      "transaction_missing": "That transaction is no longer in this Sheet. Refresh and choose it again.",
      "unknown_category": "A transaction has an unknown category. Resolve it before asking for spending totals.",
      "invalid_amount": "A transaction amount cannot be read safely. Check it in the Sheet.",
      "sheet_too_large": "This Sheet is too large for the selected question. Choose a narrower scope.",
      "snapshot_too_large": "Too many facts would be shared. Choose a narrower question scope.",
      "ai_unavailable": "The chosen AI provider is temporarily unavailable. No answer was received.",
      "answer_unverified": "The AI response could not be verified against the approved facts. Try a narrower question.",
    ]
    if let message = messages[code] { return AskServiceFailure(code: code, message: message, statusCode: status) }
    let fallback = status == 401 ? "Reconnect Google before asking again."
      : status == 429 ? "Please wait a moment before asking again."
      : "The Ask service could not complete this request. No answer was received."
    // Never reflect a server diagnostic, an unknown error code, a credential or an HTML response.
    return AskServiceFailure(code: "service_error", message: fallback, statusCode: status)
  }

  private static func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    let config = URLSessionConfiguration.ephemeral
    config.urlCache = nil
    config.httpCookieStorage = nil
    config.httpShouldSetCookies = false
    config.requestCachePolicy = .reloadIgnoringLocalCacheData
    config.timeoutIntervalForResource = 65
    let session = URLSession(configuration: config)
    defer { session.invalidateAndCancel() }
    let (bytes, raw) = try await session.bytes(for: request, delegate: AskRedirectPolicy())
    guard let response = raw as? HTTPURLResponse,
      response.expectedContentLength <= responseLimit
    else { throw invalidResponse() }
    var data = Data()
    for try await byte in bytes {
      guard data.count < responseLimit else { throw invalidResponse() }
      data.append(byte)
    }
    return (data, response)
  }
}

private final class AskRedirectPolicy: NSObject, URLSessionTaskDelegate {
  func urlSession(_ session: URLSession, task: URLSessionTask,
                  willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                  completionHandler: @escaping (URLRequest?) -> Void) {
    // Bearer credentials and consent never follow a redirected endpoint.
    completionHandler(nil)
  }
}
