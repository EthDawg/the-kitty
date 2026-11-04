import Foundation

struct GoalServiceClient {
  let client: ImportServiceClient
  func prepare(sheetID: String, version: Int, goal: GoalInput) async throws -> GoalServiceResult {
    try goal.validate()
    let data = try await client.request(path: "v1/imports/prepare", body: [
      "protocolVersion": 3, "operation": "goal-create", "sheetId": sheetID,
      "schemaVersion": version, "goal": goal.payload,
    ])
    let result = try JSONDecoder().decode(GoalServiceResult.self, from: data)
    try result.validate(sheetID: sheetID, goal: goal)
    guard result.status == "proposed" else { throw KittyError.message("The goal service did not return a fresh review. No save is confirmed.") }
    return result
  }
  func perform(_ action: String, sheetID: String, receipt: GoalRemoteBinding) async throws -> GoalServiceResult {
    guard ["commit", "status", "cancel"].contains(action),
      receipt.id.range(of: "^[A-Za-z0-9_-]{10,200}$", options: .regularExpression) != nil else {
      throw KittyError.message("The saved goal action is invalid.")
    }
    if action == "commit" {
      guard !receipt.attempted, !receipt.recoveryOnly, receipt.status == "proposed" else {
        throw KittyError.message("Check this goal receipt; a create request cannot be repeated.")
      }
    }
    let data = try await client.request(path: "v1/imports/\(receipt.id)/\(action)", method: action == "status" ? "GET" : "POST", body: action == "status" ? nil : ["sheetId": sheetID, "proposalDigest": receipt.proposalDigest, "approval": action == "commit"], query: action == "status" ? ["sheetId": sheetID] : [:])
    let result = try JSONDecoder().decode(GoalServiceResult.self, from: data)
    try result.validate(sheetID: sheetID, receiptID: receipt.id, digest: receipt.proposalDigest, goal: receipt.goal)
    return result
  }
  func recover(sheetID: String, id: String, digest: String) async throws -> GoalServiceResult {
    guard id.range(of: "^[A-Za-z0-9_-]{10,200}$", options: .regularExpression) != nil,
      digest.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else {
      throw KittyError.message("The shared goal hold has no valid receipt.")
    }
    let data = try await client.request(path: "v1/imports/\(id)/status", method: "GET", query: ["sheetId": sheetID])
    let result = try JSONDecoder().decode(GoalServiceResult.self, from: data)
    try result.validate(sheetID: sheetID, receiptID: id, digest: digest)
    return result
  }
}
