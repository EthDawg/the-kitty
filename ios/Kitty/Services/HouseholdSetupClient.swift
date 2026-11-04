import CoreFoundation
import CryptoKit
import Foundation

enum HouseholdSetupStatus: String, Codable {
  case prepared, created, unknown, conflict, verified, cancelled
}

enum HouseholdSetupPhase: String, Codable {
  case manifest, create, initialize, verify, complete
}

struct HouseholdSetupIssue: Codable, Equatable {
  let code: String
  let message: String
}

struct HouseholdSetupResult: Codable, Equatable {
  let setupId: String
  let proposalDigest: String
  let ownerPermissionId: String
  let status: HouseholdSetupStatus
  let phase: HouseholdSetupPhase
  let canContinue: Bool
  let canCancel: Bool
  let sheetId: String?
  let issues: [HouseholdSetupIssue]

  /// Apply the same binding checks to a persisted result and a fresh service receipt.
  func validate(reservation: HouseholdSetupReservation) throws {
    guard setupId == reservation.setupId, proposalDigest == reservation.proposalDigest,
      ownerPermissionId == reservation.ownerPermissionId,
      !canContinue || [.prepared, .created].contains(status),
      !canCancel || status == .prepared,
      sheetId == nil || SetupJSON.validID(sheetId!),
      ![.created, .verified].contains(status) || sheetId != nil,
      status != .verified || phase == .complete,
      issues.count <= 100,
      issues.allSatisfy({ !$0.code.isEmpty && $0.code.utf8.count <= 120
        && !$0.message.isEmpty && $0.message.utf8.count <= 2000 })
    else { throw HouseholdSetupFailure.invalidResponse }
  }
}

/// Persist this exact reservation before calling begin. It contains no OAuth credentials.
/// The JSON data is canonical UTF-8, so persistence preserves the reviewed input and summary.
struct HouseholdSetupReservation: Codable, Equatable {
  let setupId: String
  let createIntentId: String
  let initializeIntentId: String
  let proposalDigest: String
  let ownerPermissionId: String
  let sourceSha256: String
  let inputSha256: String
  let normalizedInputData: Data
  let reviewSummaryData: Data

  func validate(expectedSourceSha256: String = HouseholdSetupClient.supportedSourceSha256) throws {
    guard SetupJSON.validID(setupId), SetupJSON.validID(createIntentId),
      SetupJSON.validID(initializeIntentId), Set([setupId, createIntentId, initializeIntentId]).count == 3,
      SetupJSON.validOwner(ownerPermissionId), SetupJSON.validHash(proposalDigest),
      SetupJSON.validHash(sourceSha256), sourceSha256 == expectedSourceSha256,
      SetupJSON.validHash(inputSha256),
      SetupJSON.digest(try SetupJSON.canonical(normalizedInputData)) == inputSha256
    else { throw HouseholdSetupFailure.invalidReservation }
    let input = try SetupJSON.object(normalizedInputData)
    try SetupJSON.validateSummary(SetupJSON.object(reviewSummaryData), input: input)
  }

  /// Validate the separately persisted approval before using it for recovery.
  func validateApprovedInput(_ data: Data) throws {
    guard try SetupJSON.canonical(data) == SetupJSON.canonical(normalizedInputData) else {
      throw HouseholdSetupFailure(code: "setup_review_changed",
        message: "The household settings changed after reservation. Keep this reservation and cancel it before preparing another setup.")
    }
  }
}

struct HouseholdSetupFailure: LocalizedError, Equatable {
  let code: String
  let message: String
  let statusCode: Int?
  var errorDescription: String? { message }

  init(code: String, message: String, statusCode: Int? = nil) {
    self.code = code; self.message = message; self.statusCode = statusCode
  }
  static let invalidReservation = HouseholdSetupFailure(code: "invalid_reservation",
    message: "This setup reservation could not be verified. This step did not request workbook creation; keep the saved reservation for recovery.")
  static let invalidResponse = HouseholdSetupFailure(code: "invalid_response",
    message: "The service response did not match this household setup. Its outcome remains unverified; keep the saved reservation.")
}

/// Shares the import client's HTTPS, redirect refusal, response bounds and ephemeral transport.
/// Calls never retry a create or initialization request, persist state, or start a follow-up action.
@MainActor
final class HouseholdSetupClient {
  nonisolated static let supportedSourceSha256 = "41743ff2a6bcbc21fc112656a4a3af71d9d2d233aa23657e801b3112ad4268ab"
  typealias Transport = (URLRequest) async throws -> (Data, HTTPURLResponse)
  private let baseURL: URL?
  private let tokenProvider: () async throws -> String
  private let transport: Transport?
  private let expectedSourceSha256: String

  convenience init(google: GoogleConnection, baseURL: URL? = nil, bundle: Bundle = .main) {
    let configured = (bundle.object(forInfoDictionaryKey: "KittyServiceURL") as? String)?
      .trimmingCharacters(in: .whitespacesAndNewlines)
    let url = configured.flatMap { $0.isEmpty || $0.contains("$(") ? nil : URL(string: $0) }
    self.init(baseURL: baseURL ?? url, tokenProvider: { try await google.accessToken() })
  }

  init(baseURL: URL?, tokenProvider: @escaping () async throws -> String,
       transport: Transport? = nil, expectedSourceSha256: String = supportedSourceSha256) {
    self.baseURL = baseURL; self.tokenProvider = tokenProvider; self.transport = transport
    self.expectedSourceSha256 = expectedSourceSha256
  }

  var isConfigured: Bool { (try? checkedBaseURL()) != nil }

  /// Input must already contain the native review's explicit normalized defaults and nulls.
  func reserve(input: Data, expectedSourceSha256: String? = nil,
               expectedReviewSummary: Data? = nil) async throws -> HouseholdSetupReservation {
    guard expectedSourceSha256 == nil || expectedSourceSha256 == self.expectedSourceSha256 else {
      throw HouseholdSetupFailure.invalidReservation
    }
    let original = try SetupJSON.object(input)
    let canonicalInput = try SetupJSON.canonical(original)
    let response = try SetupJSON.object(await request(path: "v1/setup/reserve", body: ["input": original]))
    guard response["status"] as? String == "reserved",
      let setupId = response["setupId"] as? String,
      let createIntentId = response["createIntentId"] as? String,
      let initializeIntentId = response["initializeIntentId"] as? String,
      let proposalDigest = response["proposalDigest"] as? String,
      let ownerPermissionId = response["ownerPermissionId"] as? String,
      let sourceSha256 = response["sourceSha256"] as? String,
      let inputSha256 = response["inputSha256"] as? String,
      let normalized = response["normalizedInput"] as? [String: Any],
      let summary = response["reviewSummary"] as? [String: Any]
    else { throw HouseholdSetupFailure.invalidResponse }
    let normalizedData = try SetupJSON.canonical(normalized)
    let summaryData = try SetupJSON.canonical(summary)
    let expectedSummary = try expectedReviewSummary.map { try SetupJSON.canonical($0) }
    guard normalizedData == canonicalInput, inputSha256 == SetupJSON.digest(canonicalInput),
      expectedSummary == nil || summaryData == expectedSummary
    else {
      throw HouseholdSetupFailure(code: "setup_review_changed",
        message: "The service changed the reviewed household settings. No creation was started; review the setup again.")
    }
    let reservation = HouseholdSetupReservation(setupId: setupId, createIntentId: createIntentId,
      initializeIntentId: initializeIntentId, proposalDigest: proposalDigest,
      ownerPermissionId: ownerPermissionId, sourceSha256: sourceSha256, inputSha256: inputSha256,
      normalizedInputData: normalizedData, reviewSummaryData: summaryData)
    try reservation.validate(expectedSourceSha256: self.expectedSourceSha256)
    return reservation
  }

  /// The caller must durably save the reservation before this explicit approval call.
  func begin(reservation: HouseholdSetupReservation, approvedInput: Data) async throws -> HouseholdSetupResult {
    try reservation.validate(expectedSourceSha256: expectedSourceSha256)
    try reservation.validateApprovedInput(approvedInput)
    let input = try SetupJSON.object(approvedInput)
    return try await lifecycle(reservation, action: "begin", body: [
      "proposalDigest": reservation.proposalDigest, "createIntentId": reservation.createIntentId,
      "initializeIntentId": reservation.initializeIntentId, "input": input, "approval": true,
    ])
  }

  func continueSetup(reservation: HouseholdSetupReservation) async throws -> HouseholdSetupResult {
    try await lifecycle(reservation, action: "continue",
      body: ["proposalDigest": reservation.proposalDigest, "approval": true])
  }

  func status(reservation: HouseholdSetupReservation) async throws -> HouseholdSetupResult {
    try await lifecycle(reservation, action: "status", method: "GET",
      query: ["proposalDigest": reservation.proposalDigest])
  }

  func cancel(reservation: HouseholdSetupReservation) async throws -> HouseholdSetupResult {
    try reservation.validate(expectedSourceSha256: expectedSourceSha256)
    // Before a manifest exists, the writer must rebuild the exact reserved plan to
    // prove these intent IDs belong to its digest. IDs alone are not that proof.
    let input = try SetupJSON.object(reservation.normalizedInputData)
    return try await lifecycle(reservation, action: "cancel", body: [
      "proposalDigest": reservation.proposalDigest, "createIntentId": reservation.createIntentId,
      "initializeIntentId": reservation.initializeIntentId, "ownerPermissionId": reservation.ownerPermissionId,
      "input": input,
    ])
  }

  private func lifecycle(_ reservation: HouseholdSetupReservation, action: String,
                         method: String = "POST", body: [String: Any]? = nil,
                         query: [String: String] = [:]) async throws -> HouseholdSetupResult {
    try reservation.validate(expectedSourceSha256: expectedSourceSha256)
    let data = try await request(path: "v1/setup/\(reservation.setupId)/\(action)",
      method: method, body: body, query: query)
    let result: HouseholdSetupResult
    do { result = try JSONDecoder().decode(HouseholdSetupResult.self, from: data) }
    catch { throw HouseholdSetupFailure.invalidResponse }
    try result.validate(reservation: reservation)
    return result
  }

  private func checkedBaseURL() throws -> URL {
    guard let baseURL else {
      throw HouseholdSetupFailure(code: "not_configured",
        message: "Household creation is not connected in this build. Your setup stays on this device.")
    }
    guard let parts = URLComponents(url: baseURL, resolvingAgainstBaseURL: false),
      parts.scheme == "https", parts.host?.isEmpty == false,
      parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil,
      parts.port == nil || (1...65535).contains(parts.port!)
    else { throw HouseholdSetupFailure(code: "invalid_service_url",
      message: "Household creation needs a valid HTTPS service address without credentials or query parameters.") }
    return baseURL
  }

  private func request(path: String, method: String = "POST", body: [String: Any]? = nil,
                       query: [String: String] = [:]) async throws -> Data {
    let url = try checkedBaseURL()
    try Task.checkCancellation()
    let token = try await tokenProvider()
    guard !token.isEmpty, token.utf8.count <= 8192,
      token.rangeOfCharacter(from: .whitespacesAndNewlines) == nil else {
      throw HouseholdSetupFailure(code: "google_reconnect", message: "Reconnect Google before continuing this household setup.")
    }
    try Task.checkCancellation()
    do {
      let client = ImportServiceClient(baseURL: url, token: token, transport: transport)
      let data = try await client.request(path: path, method: method, body: body, query: query)
      guard data.count <= SetupJSON.limit else { throw HouseholdSetupFailure.invalidResponse }
      return data
    } catch let error as ImportServiceFailure {
      throw HouseholdSetupFailure(code: String(error.code.prefix(120)),
        message: String(error.message.prefix(2000)), statusCode: error.statusCode)
    }
  }
}

/// The supported setup profile uses exact integers, strings, arrays, objects and null.
/// This implements the generator's sorted-key JSON encoding, including UTF-16 key ordering.
private enum SetupJSON {
  static let limit = 256 * 1024
  static func validID(_ value: String) -> Bool {
    value.range(of: "^[A-Za-z0-9_-]{10,200}$", options: .regularExpression) != nil
  }
  static func validOwner(_ value: String) -> Bool {
    value.range(of: "^[A-Za-z0-9_-]{1,200}$", options: .regularExpression) != nil
  }
  static func validHash(_ value: String) -> Bool {
    value.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil
  }
  static func digest(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
  }
  static func object(_ data: Data) throws -> [String: Any] {
    guard data.count <= limit, let value = try? JSONSerialization.jsonObject(with: data),
      let object = value as? [String: Any] else { throw HouseholdSetupFailure.invalidResponse }
    return object
  }
  static func canonical(_ data: Data) throws -> Data { try canonical(object(data)) }
  static func canonical(_ value: Any) throws -> Data {
    let result = Data(try encode(value, depth: 0).utf8)
    guard result.count <= limit else { throw HouseholdSetupFailure.invalidResponse }
    return result
  }
  private static func encode(_ value: Any, depth: Int) throws -> String {
    guard depth <= 20 else { throw HouseholdSetupFailure.invalidResponse }
    if value is NSNull { return "null" }
    if let value = value as? String { return quote(value) }
    if let value = value as? NSNumber {
      if CFGetTypeID(value) == CFBooleanGetTypeID() { return value.boolValue ? "true" : "false" }
      let number = value.doubleValue
      guard number.isFinite, number.rounded() == number,
        number >= -9_007_199_254_740_991, number <= 9_007_199_254_740_991
      else { throw HouseholdSetupFailure.invalidResponse }
      return String(value.int64Value)
    }
    if let value = value as? [Any] {
      return "[" + (try value.map { try encode($0, depth: depth + 1) }).joined(separator: ",") + "]"
    }
    if let value = value as? [String: Any] {
      let keys = value.keys.sorted { $0.utf16.lexicographicallyPrecedes($1.utf16) }
      return "{" + (try keys.map { quote($0) + ":" + (try encode(value[$0]!, depth: depth + 1)) }).joined(separator: ",") + "}"
    }
    throw HouseholdSetupFailure.invalidResponse
  }
  private static func quote(_ value: String) -> String {
    var result = "\""
    for scalar in value.unicodeScalars {
      switch scalar.value {
      case 0x22: result += "\\\""
      case 0x5c: result += "\\\\"
      case 0x08: result += "\\b"
      case 0x09: result += "\\t"
      case 0x0a: result += "\\n"
      case 0x0c: result += "\\f"
      case 0x0d: result += "\\r"
      case 0...0x1f: result += String(format: "\\u%04x", scalar.value)
      default: result.unicodeScalars.append(scalar)
      }
    }
    return result + "\""
  }
  static func validateSummary(_ summary: [String: Any], input: [String: Any]) throws {
    let shared = ["householdName", "people", "currency", "openingDate", "accounts", "budgets", "emergencyAccountId", "goal", "capacity"]
    for key in shared {
      guard let left = summary[key], let right = input[key],
        try canonical(left) == canonical(right) else { throw HouseholdSetupFailure.invalidResponse }
    }
    let format = DateFormatter()
    format.calendar = Calendar(identifier: .gregorian)
    format.locale = Locale(identifier: "en_US_POSIX")
    format.timeZone = TimeZone(secondsFromGMT: 0)
    format.dateFormat = "yyyy-MM-dd"
    format.isLenient = false
    guard let openingDate = input["openingDate"] as? String,
      let anchor = format.date(from: openingDate), format.string(from: anchor) == openingDate,
      let firstImportDate = summary["firstImportDate"] as? String,
      firstImportDate == format.string(from: anchor.addingTimeInterval(86400)),
      let openingCash = summary["openingCashMinor"] as? String,
      openingCash.range(of: "^(0|-?[1-9][0-9]{0,13})$", options: .regularExpression) != nil,
      let unavailable = summary["unavailableModules"] as? [String],
      Set(unavailable) == Set(["tax", "mortgage", "whole-household net worth", "assets", "subscriptions", "savings opportunities"]),
      unavailable.count == 6, let initialState = summary["initialState"] as? String,
      !initialState.isEmpty, initialState.utf8.count <= 2000
    else { throw HouseholdSetupFailure.invalidResponse }
    guard let accounts = input["accounts"] as? [[String: Any]], !accounts.isEmpty else {
      throw HouseholdSetupFailure.invalidResponse
    }
    var total: Int64 = 0
    for account in accounts {
      guard let raw = account["openingMinor"] as? String,
        raw.range(of: "^(0|-?[1-9][0-9]{0,13})$", options: .regularExpression) != nil,
        let amount = Int64(raw) else { throw HouseholdSetupFailure.invalidResponse }
      let sum = total.addingReportingOverflow(amount)
      guard !sum.overflow else { throw HouseholdSetupFailure.invalidResponse }
      total = sum.partialValue
    }
    guard String(total) == openingCash else { throw HouseholdSetupFailure.invalidResponse }
  }
}
