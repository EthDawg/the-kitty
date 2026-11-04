import Foundation

struct ImportServiceClient {
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
  func status(sheetID: String, id: String) async throws -> ImportServiceResult {
    try await result(
      path: "v1/imports/\(checkedID(id))/status", method: "GET", query: ["sheetId": sheetID],
      expectedID: id)
  }
  func cancel(sheetID: String, id: String) async throws -> ImportServiceResult {
    try await result(
      path: "v1/imports/\(checkedID(id))/cancel", body: ["sheetId": sheetID], expectedID: id)
  }
  func provenance(sheetID: String) async throws -> [String: Any] {
    let data = try await request(
      path: "v1/imports/provenance", method: "GET", query: ["sheetId": sheetID])
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
    if let body { req.httpBody = try JSONSerialization.data(withJSONObject: body) }
    req.timeoutInterval = 60
    let data: Data
    let response: HTTPURLResponse
    if let transport {
      (data, response) = try await transport(req)
    } else {
      let config = URLSessionConfiguration.ephemeral
      config.urlCache = nil
      let session = URLSession(configuration: config)
      defer { session.finishTasksAndInvalidate() }
      let (received, rawResponse) = try await session.data(for: req)
      guard let http = rawResponse as? HTTPURLResponse else {
        throw KittyError.message("The import service couldn't be reached.")
      }
      data = received
      response = http
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
