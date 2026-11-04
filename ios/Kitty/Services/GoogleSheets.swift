import Foundation

enum GoogleCell: Codable, Equatable {
  case string(String)
  case number(Double)
  case bool(Bool)
  case empty

  init(from decoder: Decoder) throws {
    let container = try decoder.singleValueContainer()
    if container.decodeNil() {
      self = .empty
    } else if let value = try? container.decode(Bool.self) {
      self = .bool(value)
    } else if let value = try? container.decode(Double.self) {
      self = .number(value)
    } else {
      self = .string(try container.decode(String.self))
    }
  }

  func encode(to encoder: Encoder) throws {
    var container = encoder.singleValueContainer()
    switch self {
    case .string(let value): try container.encode(value)
    case .number(let value): try container.encode(value)
    case .bool(let value): try container.encode(value)
    case .empty: try container.encode("")
    }
  }

  var foundationValue: Any {
    switch self {
    case .string(let value): return value
    case .number(let value): return value
    case .bool(let value): return value
    case .empty: return ""
    }
  }

  var displayString: String {
    switch self {
    case .string(let value): return value
    case .number(let value):
      return value.rounded() == value && abs(value) < 9_007_199_254_740_992
        ? String(format: "%.0f", value) : String(value)
    case .bool(let value): return value ? "TRUE" : "FALSE"
    case .empty: return ""
    }
  }
}

struct GoogleSheetFile: Decodable, Identifiable, Hashable {
  let id: String
  let name: String
  let webViewLink: String?
  let modifiedTime: String?
  let canEdit: Bool?
  var url: URL? { URL(string: webViewLink ?? "https://docs.google.com/spreadsheets/d/\(id)/edit") }

  init(id: String, name: String, webViewLink: String?, modifiedTime: String?, canEdit: Bool? = nil) {
    self.id = id
    self.name = name
    self.webViewLink = webViewLink
    self.modifiedTime = modifiedTime
    self.canEdit = canEdit
  }

  private enum CodingKeys: String, CodingKey { case id, name, webViewLink, modifiedTime, capabilities }
  private struct Capabilities: Decodable { let canEdit: Bool? }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    id = try container.decode(String.self, forKey: .id)
    name = try container.decode(String.self, forKey: .name)
    webViewLink = try container.decodeIfPresent(String.self, forKey: .webViewLink)
    modifiedTime = try container.decodeIfPresent(String.self, forKey: .modifiedTime)
    canEdit = try container.decodeIfPresent(Capabilities.self, forKey: .capabilities)?.canEdit
  }
}

struct GoogleSpreadsheet: Decodable {
  struct Properties: Decodable {
    let title: String
    let locale: String?
    let timeZone: String?
  }
  struct Sheet: Decodable {
    struct Properties: Decodable {
      struct Grid: Decodable {
        let rowCount: Int
        let columnCount: Int
      }
      let sheetId: Int
      let title: String
      let gridProperties: Grid?
    }
    let properties: Properties
  }
  let spreadsheetId: String
  let spreadsheetUrl: String?
  let properties: Properties
  let sheets: [Sheet]
}

struct GoogleValueRange: Codable {
  let range: String
  let values: [[GoogleCell]]?
  var rows: [[GoogleCell]] { values ?? [] }
  var foundationRows: [[Any]] { rows.map { $0.map(\.foundationValue) } }
}

struct GoogleWriteReceipt {
  let spreadsheetID: String
  let range: String
  let verifiedAt: Date
  let values: [[GoogleCell]]
  let responseWasLost: Bool
}

/// A small REST client. It deliberately offers no arbitrary append or raw-ledger write operation.
/// Preflight + readback detects conflicts; it does not provide server-side compare-and-swap.
@MainActor
final class GoogleSheets {
  typealias TokenProvider = () async throws -> String
  static let templateID = "1zfiCnqO36a0YmMwC8-J6iGHUGvmLdXmhbL5aPWNlExM"

  enum ServiceError: LocalizedError {
    case invalidIdentifier, invalidResponse, reconnect, permissionDenied, writePermissionDenied, unavailable, rateLimited
    case invalidWrite, conflict, unsupportedVersion, writeUncertain, busy, copyUncertain
    case templateUnavailable

    var errorDescription: String? {
      switch self {
      case .invalidIdentifier: return "This does not look like a Google Sheet ID."
      case .invalidResponse:
        return "Google returned an unreadable response. Your last saved view is still available."
      case .reconnect: return "Reconnect Google to continue."
      case .permissionDenied:
        return
          "This Google account cannot read the selected Sheet. Choose it again in the Google file picker, or use an account with access."
      case .writePermissionDenied:
        return "Google refused this edit. This account needs edit access to the Sheet and this input cell. Your change was not saved."
      case .unavailable: return "Google Sheets is temporarily unavailable. Please try again."
      case .rateLimited: return "Google Sheets is busy. Wait a moment, then refresh."
      case .invalidWrite:
        return
          "This change is outside the app's allowed input cells. Open the Sheet to make that change."
      case .conflict:
        return "This row changed in the Sheet. Refresh it and review your change again."
      case .unsupportedVersion:
        return "This Sheet version is not supported for editing. Your Sheet has not changed."
      case .writeUncertain:
        return "The change could not be verified. Refresh the Sheet before trying again."
      case .busy: return "A change to this row is still being checked. Please wait."
      case .copyUncertain:
        return
          "Google did not confirm the new copy. Check your Google Drive before creating another copy."
      case .templateUnavailable:
        return
          "Google could not open the Kitty template with the granted file access. No copy was confirmed. The template must first be selected through the app's Google file authorisation flow."
      }
    }
  }

  private let tokenProvider: TokenProvider
  private let session: URLSession
  private var pendingRows = Set<String>()

  init(tokenProvider: @escaping TokenProvider, session: URLSession? = nil) {
    self.tokenProvider = tokenProvider
    if let session {
      self.session = session
    } else {
      let config = URLSessionConfiguration.ephemeral
      config.urlCache = nil
      config.requestCachePolicy = .reloadIgnoringLocalCacheData
      config.timeoutIntervalForRequest = 30
      self.session = URLSession(configuration: config)
    }
  }

  /// drive.file only lists files the app created or the user explicitly authorised for it.
  /// This is not a browser over every Sheet in the user's account.
  func listAccessibleFiles() async throws -> [GoogleSheetFile] {
    struct Page: Decodable {
      let files: [GoogleSheetFile]
      let nextPageToken: String?
    }
    var files: [GoogleSheetFile] = []
    var pageToken: String?
    repeat {
      var query = [
        URLQueryItem(
          name: "q",
          value: "mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false"),
        URLQueryItem(name: "spaces", value: "drive"),
        URLQueryItem(name: "pageSize", value: "100"),
        URLQueryItem(name: "orderBy", value: "modifiedTime desc"),
        URLQueryItem(
          name: "fields", value: "nextPageToken,files(id,name,webViewLink,modifiedTime,capabilities(canEdit))"),
      ]
      if let pageToken { query.append(URLQueryItem(name: "pageToken", value: pageToken)) }
      let data = try await request(
        host: "www.googleapis.com", path: "/drive/v3/files", query: query)
      let page = try decode(Page.self, data)
      files += page.files
      pageToken = page.nextPageToken
    } while pageToken != nil
    return files
  }

  /// Copies fictional demo data and formulas; the caller must say this is a demo copy.
  /// It does not silently clear source data, deploy the bound script, or widen sharing.
  /// A timeout is NOT retried because Drive copy has no idempotency key here.
  func copyTemplate(name: String) async throws -> GoogleSheetFile {
    let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty, trimmed.count <= 200 else { throw ServiceError.invalidWrite }
    let data: Data
    do {
      data = try await request(
        host: "www.googleapis.com", path: "/drive/v3/files/\(Self.templateID)/copy",
        method: "POST",
        query: [URLQueryItem(name: "fields", value: "id,name,webViewLink,modifiedTime,capabilities(canEdit)")],
        body: try JSONSerialization.data(withJSONObject: ["name": trimmed]))
    } catch ServiceError.permissionDenied {
      throw ServiceError.templateUnavailable
    } catch ServiceError.reconnect { throw ServiceError.reconnect } catch ServiceError.rateLimited {
      throw ServiceError.rateLimited
    } catch { throw ServiceError.copyUncertain }
    do { return try decode(GoogleSheetFile.self, data) } catch { throw ServiceError.copyUncertain }
  }

  func metadata(spreadsheetID: String) async throws -> GoogleSpreadsheet {
    try validateID(spreadsheetID)
    let fields =
      "spreadsheetId,spreadsheetUrl,properties(title,locale,timeZone),sheets(properties(sheetId,title,gridProperties))"
    let data = try await request(
      host: "sheets.googleapis.com", path: "/v4/spreadsheets/\(spreadsheetID)",
      query: [URLQueryItem(name: "fields", value: fields)])
    return try decode(GoogleSpreadsheet.self, data)
  }

  /// File-level edit capability. A protected cell can still refuse an otherwise editable file's write.
  func canEdit(spreadsheetID: String) async throws -> Bool {
    try validateID(spreadsheetID)
    struct File: Decodable {
      struct Capabilities: Decodable { let canEdit: Bool }
      let id: String
      let capabilities: Capabilities
    }
    let data = try await request(host: "www.googleapis.com", path: "/drive/v3/files/\(spreadsheetID)",
      query: [URLQueryItem(name: "fields", value: "id,capabilities(canEdit)")])
    let file = try decode(File.self, data)
    guard file.id == spreadsheetID else { throw ServiceError.invalidResponse }
    return file.capabilities.canEdit
  }

  /// Unformatted values preserve numeric/date serials and avoid locale-dependent parsing.
  func batchGet(spreadsheetID: String, ranges: [String], renderFormulas: Bool = false) async throws -> [GoogleValueRange] {
    try validateID(spreadsheetID)
    guard !ranges.isEmpty, ranges.count <= 100, ranges.allSatisfy({ !$0.isEmpty && $0.count < 300 })
    else { throw ServiceError.invalidResponse }
    var query = ranges.map { URLQueryItem(name: "ranges", value: $0) }
    query += [
      URLQueryItem(name: "valueRenderOption", value: renderFormulas ? "FORMULA" : "UNFORMATTED_VALUE"),
      URLQueryItem(name: "dateTimeRenderOption", value: "SERIAL_NUMBER"),
      URLQueryItem(name: "majorDimension", value: "ROWS"),
    ]
    struct Batch: Decodable { let valueRanges: [GoogleValueRange] }
    let data = try await request(
      host: "sheets.googleapis.com", path: "/v4/spreadsheets/\(spreadsheetID)/values:batchGet",
      query: query)
    let result = try decode(Batch.self, data).valueRanges
    guard result.count == ranges.count else { throw ServiceError.invalidResponse }
    return result
  }

  /// Only a small existing input can be edited. Identity, before-state and final values are checked.
  /// RAW prevents a preference string from being evaluated as a formula. Date inputs must be numeric
  /// Sheet date serials (GoogleSheets.dateSerial) to preserve formula arithmetic and formatting.
  func writeAndVerify(
    spreadsheetID: String, range: String, recordKey: String,
    expected: [[GoogleCell]], replacement: [[GoogleCell]], expectedVersion: Int? = nil,
    willWrite: (() throws -> Void)? = nil
  ) async throws -> GoogleWriteReceipt {
    try validateID(spreadsheetID)
    let target = try allowedTarget(range: range, key: recordKey, replacement: replacement)
    let rowKey = "\(spreadsheetID)/\(target.sheet)/\(target.row)"
    guard !pendingRows.contains(rowKey) else { throw ServiceError.busy }
    pendingRows.insert(rowKey)
    defer { pendingRows.remove(rowKey) }
    let keyRange = "'\(target.sheet)'!A\(target.row)"
    let ranges = [range, keyRange, "Kitty!A1:B", "'\(target.sheet)'!A1:G"]
    let before = try await batchGet(spreadsheetID: spreadsheetID, ranges: ranges, renderFormulas: true)
    let version = try validateInputSnapshot(before, target: target, recordKey: recordKey,
      expected: expected, expectedVersion: expectedVersion.map(String.init))

    let body = try JSONEncoder().encode(GoogleValueRange(range: range, values: replacement))
    // Obtain credentials before recording an intent. A refresh failure cannot have dispatched a PUT.
    let write = try await makeRequest(
      host: "sheets.googleapis.com", path: "/v4/spreadsheets/\(spreadsheetID)/values/\(range)",
      method: "PUT", query: [URLQueryItem(name: "valueInputOption", value: "RAW")], body: body)
    try Task.checkCancellation()
    // No suspension occurs between the durable handoff and URLSession dispatch.
    // Throwing here guarantees that this method has not sent a write request.
    try willWrite?()
    var responseWasLost = false
    do {
      _ = try await performRequest(write)
    } catch ServiceError.writePermissionDenied { throw ServiceError.writePermissionDenied }
      catch ServiceError.permissionDenied { throw ServiceError.permissionDenied } catch ServiceError
      .reconnect
    { throw ServiceError.reconnect } catch { responseWasLost = true }

    let after: [GoogleValueRange]
    do {
      after = try await batchGet(spreadsheetID: spreadsheetID, ranges: ranges, renderFormulas: true)
      _ = try validateInputSnapshot(after, target: target, recordKey: recordKey,
        expected: replacement, expectedVersion: version)
    } catch { throw ServiceError.writeUncertain }
    return GoogleWriteReceipt(
      spreadsheetID: spreadsheetID, range: range, verifiedAt: Date(), values: after[0].rows,
      responseWasLost: responseWasLost)
  }

  /// Repeated for preflight and readback: a matching scalar is insufficient if its schema or identity changed.
  private func validateInputSnapshot(_ snapshot: [GoogleValueRange], target: Target,
    recordKey: String, expected: [[GoogleCell]], expectedVersion: String?) throws -> String {
    guard snapshot.count == 4 else { throw ServiceError.invalidResponse }
    let versions = snapshot[2].rows.filter {
      $0.first?.displayString.trimmingCharacters(in: .whitespacesAndNewlines) == "sheet_version"
    }
    guard versions.count == 1, let version = versions[0].dropFirst().first?.displayString,
      versions[0].first?.displayString == "sheet_version",
      version == "1" || version == "1.1" || version == "2"
    else { throw ServiceError.unsupportedVersion }
    if let expectedVersion, expectedVersion != version { throw ServiceError.unsupportedVersion }
    if version == "2" && target.sheet == "Subscriptions" { throw ServiceError.invalidWrite }
    let expectedHeaders: [String]
    switch target.sheet {
    case "Kitty": expectedHeaders = ["Key", "Value"]
    case "Settings": expectedHeaders = ["Setting", "Value"]
    case "Subscriptions": expectedHeaders = ["Service", "Merchant", "Owner", "Cadence", "Category ID", "Last used", "Decision"]
    default: expectedHeaders = ["Goal", "Target amount ($)", "Target date"]
    }
    let headers = snapshot[3].rows.enumerated().filter { $0.element.first?.displayString == expectedHeaders[0] }
    let identities = snapshot[3].rows.enumerated().filter {
      $0.element.first?.displayString.trimmingCharacters(in: .whitespacesAndNewlines) == recordKey
    }
    guard headers.count == 1,
      expectedHeaders.enumerated().allSatisfy({ $0.offset < headers[0].element.count
        && headers[0].element[$0.offset].displayString == $0.element }),
      identities.count == 1, identities[0].offset + 1 == target.row,
      identities[0].offset > headers[0].offset else { throw ServiceError.conflict }
    guard snapshot[1].rows.first?.first?.displayString == recordKey,
      Self.equalCells(snapshot[0].rows, expected)
    else { throw ServiceError.conflict }
    return version
  }

  static func dateSerial(_ date: Date) -> Double {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(secondsFromGMT: 0)!
    return calendar.startOfDay(for: date).timeIntervalSince1970 / 86_400 + 25_569
  }

  private struct Target {
    let sheet: String
    let row: Int
  }

  private func allowedTarget(range: String, key: String, replacement: [[GoogleCell]]) throws
    -> Target
  {
    let pattern =
      "^'?(Goals|Kitty|Settings|Subscriptions)'?!([A-Z]+)([0-9]+)(?::([A-Z]+)([0-9]+))?$"
    guard let regex = try? NSRegularExpression(pattern: pattern),
      let match = regex.firstMatch(in: range, range: NSRange(range.startIndex..., in: range))
    else { throw ServiceError.invalidWrite }
    func capture(_ index: Int) -> String? {
      guard let span = Range(match.range(at: index), in: range) else { return nil }
      return String(range[span])
    }
    guard let sheet = capture(1), let startColumn = capture(2), let rowText = capture(3),
      let row = Int(rowText), row >= 2,
      capture(5) == nil || capture(5) == rowText, replacement.count == 1, !key.isEmpty
    else { throw ServiceError.invalidWrite }
    let endColumn = capture(4) ?? startColumn
    let values = replacement[0]
    let valid: Bool
    switch sheet {
    case "Goals":
      valid =
        ((startColumn == "B" && endColumn == "B" && values.count == 1)
          || (startColumn == "C" && endColumn == "C" && values.count == 1)
          || (startColumn == "B" && endColumn == "C" && values.count == 2))
        && values.allSatisfy {
          if case .number(let n) = $0 { return n.isFinite && n >= 0 && n < 9_007_199_254_740_992 }
          return false
        }
    case "Kitty":
      let allowed = [
        "greeting_name", "country", "lead_goal", "accent", "onboarded_at", "look_ahead_days",
        "theme",
      ]
      valid =
        startColumn == "B" && endColumn == "B" && values.count == 1 && allowed.contains(key)
        && values[0].displayString.count <= 200
    case "Settings":
      valid =
        startColumn == "B" && endColumn == "B" && values.count == 1
        && key == "Emergency fund target (months of essential spending)"
        && {
          if case .number(let n) = values[0] { return n.isFinite && n >= 1 && n <= 60 }
          return false
        }()
    case "Subscriptions":
      valid =
        startColumn == "G" && endColumn == "G" && values.count == 1
        && ["Keep", "Review", "Cancel"].contains(values[0].displayString)
    default: valid = false
    }
    guard valid else { throw ServiceError.invalidWrite }
    return Target(sheet: sheet, row: row)
  }

  /// Sheets omits trailing blanks. Normalise only absent/empty cells; never coerce strings to numbers.
  static func equalCells(_ lhs: [[GoogleCell]], _ rhs: [[GoogleCell]]) -> Bool {
    let height = max(lhs.count, rhs.count)
    for row in 0..<height {
      let left = row < lhs.count ? lhs[row] : []
      let right = row < rhs.count ? rhs[row] : []
      for col in 0..<max(left.count, right.count) {
        let a = col < left.count ? left[col] : .empty
        let b = col < right.count ? right[col] : .empty
        if a == b { continue }
        if a.displayString.isEmpty && b.displayString.isEmpty { continue }
        return false
      }
    }
    return true
  }

  private func validateID(_ id: String) throws {
    guard id.range(of: "^[A-Za-z0-9_-]{20,200}$", options: .regularExpression) != nil else {
      throw ServiceError.invalidIdentifier
    }
  }

  private func decode<T: Decodable>(_ type: T.Type, _ data: Data) throws -> T {
    do { return try JSONDecoder().decode(type, from: data) } catch {
      throw ServiceError.invalidResponse
    }
  }

  private func request(
    host: String, path: String, method: String = "GET", query: [URLQueryItem] = [],
    body: Data? = nil
  ) async throws -> Data {
    let request = try await makeRequest(host: host, path: path, method: method, query: query, body: body)
    return try await performRequest(request)
  }

  private func makeRequest(host: String, path: String, method: String,
    query: [URLQueryItem], body: Data?) async throws -> URLRequest {
    var components = URLComponents()
    components.scheme = "https"
    components.host = host
    components.path = path
    components.queryItems = query.isEmpty ? nil : query
    guard let url = components.url else { throw ServiceError.invalidResponse }
    var request = URLRequest(url: url)
    request.httpMethod = method
    request.httpBody = body
    request.setValue("Bearer \(try await tokenProvider())", forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
    if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
    return request
  }

  private func performRequest(_ request: URLRequest) async throws -> Data {
    let (data, response) = try await session.data(for: request)
    guard let http = response as? HTTPURLResponse else { throw ServiceError.invalidResponse }
    switch http.statusCode {
    case 200..<300: return data
    case 401: throw ServiceError.reconnect
    case 403 where request.httpMethod == "PUT": throw ServiceError.writePermissionDenied
    case 403, 404: throw ServiceError.permissionDenied
    case 429: throw ServiceError.rateLimited
    default: throw ServiceError.unavailable
    }
  }
}
