import Foundation

struct ImportServiceClient {
  static let responseLimit = 16 * 1024 * 1024
  let baseURL: URL
  let token: String
  var transport: ((URLRequest) async throws -> (Data, HTTPURLResponse))?

  func prepare(sheetID: String, proposal: Any, sources: [ImportSource], version: Int) async throws
    -> PreparedImportReceipt
  {
    let data = try await request(
      path: "v1/imports/prepare",
      body: [
        "sheetId": sheetID, "proposal": proposal, "files": sources.map { $0.payload },
        "schemaVersion": version,
      ])
    let receipt = try JSONDecoder().decode(PreparedImportReceipt.self, from: data)
    guard validID(receipt.importId),
      receipt.proposalDigest.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
      receipt.status == "proposed"
    else {
      throw KittyError.message(
        "The import service returned an incomplete review receipt. No save has been confirmed.")
    }
    return receipt
  }
  func commit(sheetID: String, id: String) async throws -> ImportServiceResult {
    try await result(
      path: "v1/imports/\(checkedID(id))/commit", body: ["sheetId": sheetID, "approval": true],
      expectedID: id)
  }
  func prepareSources(sheetID: String, operation: String, proposal: Any,
    files: [[String: Any]], version: Int) async throws -> PreparedImportReceipt
  {
    guard ["ingest", "close"].contains(operation) else {
      throw KittyError.message("This review has an unsupported operation.")
    }
    let data = try await request(path: "v1/imports/prepare", body: [
      "protocolVersion": 2, "operation": operation, "sheetId": sheetID,
      "schemaVersion": version, "files": files, "proposal": proposal,
    ])
    let receipt = try JSONDecoder().decode(PreparedImportReceipt.self, from: data)
    guard validID(receipt.importId), receipt.status == "proposed",
      receipt.protocolVersion == 2, receipt.operation == operation,
      receipt.proposalDigest.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil
    else { throw KittyError.message("The service returned an incomplete document review receipt. No save has been confirmed.") }
    return receipt
  }
  func status(sheetID: String, id: String) async throws -> ImportServiceResult {
    try await result(
      path: "v1/imports/\(checkedID(id))/status", method: "GET", query: ["sheetId": sheetID],
      expectedID: id)
  }
  func cancel(sheetID: String, id: String) async throws -> ImportServiceResult {
    try await result(
      path: "v1/imports/\(checkedID(id))/cancel", body: ["sheetId": sheetID], expectedID: id)
  }
  func provenance(sheetID: String, protocolVersion: Int = 1, periodEnd: String? = nil) async throws -> [String: Any] {
    var query = ["sheetId": sheetID]
    if protocolVersion == 2 { query["protocolVersion"] = "2" }
    if let periodEnd { query["periodEnd"] = periodEnd }
    let data = try await request(
      path: "v1/imports/provenance", method: "GET",
      query: query)
    guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
      object["sheetId"] as? String == sheetID
    else {
      throw KittyError.message(
        "Import evidence did not match the selected Sheet. Refresh before importing.")
    }
    return object
  }
  private func result(
    path: String, method: String = "POST", body: [String: Any]? = nil,
    query: [String: String] = [:], expectedID: String
  ) async throws -> ImportServiceResult {
    let result = try JSONDecoder().decode(
      ImportServiceResult.self,
      from: await request(path: path, method: method, body: body, query: query))
    guard result.importId == expectedID,
      ["proposed", "stale", "unknown", "conflict", "verified", "cancelled"].contains(result.status)
    else {
      throw KittyError.message(
        "The response did not match this import receipt. Its outcome remains unverified.")
    }
    return result
  }
  private func validID(_ id: String) -> Bool {
    id.range(of: "^[A-Za-z0-9_-]{10,200}$", options: .regularExpression) != nil
  }
  private func checkedID(_ id: String) throws -> String {
    guard validID(id) else { throw KittyError.message("The saved import receipt is invalid.") }
    return id
  }
  func request(
    path: String, method: String = "POST", body: [String: Any]? = nil,
    query: [String: String] = [:]
  ) async throws -> Data {
    guard baseURL.scheme == "https", baseURL.host != nil,
      baseURL.user == nil, baseURL.password == nil, baseURL.query == nil, baseURL.fragment == nil,
      !token.isEmpty, token.rangeOfCharacter(from: .newlines) == nil else {
      throw KittyError.message("Reconnect Google or update the secure import service address before saving.")
    }
    guard
      var components = URLComponents(
        url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)
    else {
      throw KittyError.message("The import service address is invalid.")
    }
    if !query.isEmpty {
      components.queryItems = query.sorted { $0.key < $1.key }.map {
        URLQueryItem(name: $0.key, value: $0.value)
      }
    }
    guard let url = components.url else {
      throw KittyError.message("The import service address is invalid.")
    }
    var req = URLRequest(url: url)
    req.httpMethod = method
    req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    if let body {
      let bytes = try JSONSerialization.data(withJSONObject: body)
      guard bytes.count <= 12 * 1024 * 1024 else {
        throw KittyError.message("This review is too large to send together. Use a smaller batch; the original files remain on this device.")
      }
      req.httpBody = bytes
    }
    req.timeoutInterval = 60
    req.cachePolicy = .reloadIgnoringLocalCacheData
    req.setValue("no-store", forHTTPHeaderField: "Cache-Control")
    let data: Data
    let response: HTTPURLResponse
    if let transport {
      (data, response) = try await transport(req)
    } else {
      let config = URLSessionConfiguration.ephemeral
      config.urlCache = nil
      config.httpCookieStorage = nil
      config.httpShouldSetCookies = false
      config.timeoutIntervalForResource = 65
      let session = URLSession(configuration: config)
      defer { session.invalidateAndCancel() }
      let (bytes, rawResponse) = try await session.bytes(for: req, delegate: ImportRedirectPolicy())
      guard let http = rawResponse as? HTTPURLResponse,
        http.expectedContentLength <= Self.responseLimit else {
        throw KittyError.message("The import service couldn't be reached.")
      }
      var received = Data()
      for try await byte in bytes {
        guard received.count < Self.responseLimit else { throw KittyError.message("The Sheet evidence is too large to read safely in one request.") }
        received.append(byte)
      }
      data = received
      response = http
    }
    guard response.url == url, data.count <= Self.responseLimit else {
      throw KittyError.message("The import response came from an unexpected address or exceeded the supported size. Its outcome remains unverified.")
    }
    guard !(300..<400).contains(response.statusCode) else {
      throw KittyError.message("The import service redirected this request. Update its configured address before sending original files.")
    }
    guard (200..<300).contains(response.statusCode) else {
      let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
      let error = object?["error"] as? [String: Any]
      let recovery = (error?["recovery"] as? [String: Any]).flatMap { raw in
        try? JSONDecoder().decode(
          ImportRecoveryDescriptor.self, from: JSONSerialization.data(withJSONObject: raw))
      }
      throw ImportServiceFailure(
        code: error?["code"] as? String ?? "service_error",
        message: error?["message"] as? String
          ?? "The import service couldn't complete this step. Your review is preserved.",
        statusCode: response.statusCode, recovery: recovery)
    }
    return data
  }
}

final class ImportRedirectPolicy: NSObject, URLSessionTaskDelegate {
  func urlSession(_ session: URLSession, task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
    completionHandler: @escaping (URLRequest?) -> Void) {
    completionHandler(nil)
  }
}
