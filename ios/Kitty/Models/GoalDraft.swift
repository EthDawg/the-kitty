import CryptoKit
import Foundation

struct GoalInput: Codable, Equatable {
  let name: String
  let targetMinor: String
  let targetDate: String
  let accountId: String
  let currency: String

  static func amountMinor(_ text: String) throws -> String {
    let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard value.range(of: "^(?:0|[1-9][0-9]*)(?:\\.[0-9]{1,2})?$", options: .regularExpression) != nil else {
      throw KittyError.message("Enter a positive amount using digits and up to two decimal places.")
    }
    let parts = value.split(separator: ".", omittingEmptySubsequences: false)
    let cents = parts.count == 2 ? String(parts[1]).padding(toLength: 2, withPad: "0", startingAt: 0) : "00"
    guard let minor = Int64(String(parts[0]) + cents), minor > 0, minor <= 99_999_999_999_999 else {
      throw KittyError.message("Enter a positive goal amount within the supported range.")
    }
    return String(minor)
  }
  static func day(_ date: Date) -> String { dateFormatter.string(from: date) }
  static var dateFormatter: DateFormatter {
    let f = DateFormatter()
    f.calendar = Calendar(identifier: .gregorian)
    f.locale = Locale(identifier: "en_US_POSIX")
    f.timeZone = TimeZone(secondsFromGMT: 0)
    f.dateFormat = "yyyy-MM-dd"
    f.isLenient = false
    return f
  }
  func validate() throws {
    guard !name.isEmpty, name.count <= 100,
      name == name.trimmingCharacters(in: .whitespacesAndNewlines).precomposedStringWithCanonicalMapping,
      name.rangeOfCharacter(from: .controlCharacters) == nil,
      targetMinor.range(of: "^[1-9][0-9]*$", options: .regularExpression) != nil,
      let amount = Int64(targetMinor), amount <= 99_999_999_999_999,
      let day = Self.dateFormatter.date(from: targetDate), Self.day(day) == targetDate,
      targetDate >= "1900-01-01", targetDate <= "2200-12-31",
      !accountId.isEmpty, accountId.count <= 200,
      ["AUD", "USD", "NZD", "GBP", "EUR", "CAD", "CHF", "SGD", "HKD"].contains(currency)
    else { throw KittyError.message("The saved goal review is incomplete or invalid. Check its name, amount, date and account.") }
  }
  var payload: [String: Any] {
    ["name": name, "targetMinor": targetMinor, "targetDate": targetDate, "accountId": accountId, "currency": currency]
  }
  var amountText: String {
    guard let minor = Int64(targetMinor) else { return "" }
    return "\(minor / 100).\(String(format: "%02lld", minor % 100))"
  }
  func bindingDigest(sheetID: String, version: Int) throws -> String {
    let data = try JSONSerialization.data(withJSONObject: ["goal": payload, "sheetId": sheetID, "schemaVersion": version], options: [.sortedKeys])
    return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
  }
}

struct GoalServiceResult: Codable, Equatable {
  struct Issue: Codable, Equatable { let code: String; let message: String }
  let importId: String
  let proposalDigest: String
  let sheetId: String
  let protocolVersion: Int
  let operation: String
  let status: String
  let goal: GoalInput
  let issues: [Issue]
  let goalRow: Int?
  var terminal: Bool { ["verified", "cancelled"].contains(status) }
  func validate(sheetID: String, receiptID: String? = nil, digest: String? = nil, goal expectedGoal: GoalInput? = nil) throws {
    try goal.validate()
    guard sheetId == sheetID,
      importId.range(of: "^[A-Za-z0-9_-]{10,200}$", options: .regularExpression) != nil,
      proposalDigest.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
      protocolVersion == 3, operation == "goal-create",
      ["proposed", "stale", "unknown", "conflict", "verified", "cancelled"].contains(status),
      receiptID == nil || receiptID == importId,
      digest == nil || digest == proposalDigest,
      expectedGoal == nil || expectedGoal == goal,
      status != "verified" || (goalRow ?? 0) >= 2
    else { throw KittyError.message("The service response does not match this saved goal review. Its outcome remains unverified.") }
  }
}

struct GoalRemoteBinding: Codable, Equatable {
  let id: String
  let proposalDigest: String
  let goal: GoalInput
  let localDraftDigest: String
  var attempted: Bool
  var status: String
  var recoveryOnly: Bool { localDraftDigest.isEmpty }
}

struct GoalDraft: Codable, Equatable {
  var sheetID = ""
  var sheetName = ""
  var schemaVersion = 1
  var approvedGoal: GoalInput?
  var remote: GoalRemoteBinding?
  var lastResult: GoalServiceResult?
  var error: String?
  var isUnresolved: Bool { remote.map { !["verified", "cancelled"].contains($0.status) } ?? false }
  var displayGoal: GoalInput? { remote?.goal ?? approvedGoal }
  var canCommit: Bool { remote.map { !$0.recoveryOnly && !$0.attempted && $0.status == "proposed" } ?? false }

  func validate() throws {
    guard [1, 2].contains(schemaVersion),
      sheetID.range(of: "^[A-Za-z0-9_-]{12,200}$", options: .regularExpression) != nil else {
      throw KittyError.message("The saved goal review has no valid Sheet identity.")
    }
    try approvedGoal?.validate()
    guard approvedGoal != nil || remote != nil, remote != nil || lastResult == nil else {
      throw KittyError.message("The saved goal file has no reviewed goal or has lost its receipt binding.")
    }
    if let remote {
      try remote.goal.validate()
      let expectedDigest = try remote.goal.bindingDigest(sheetID: sheetID, version: schemaVersion)
      guard remote.id.range(of: "^[A-Za-z0-9_-]{10,200}$", options: .regularExpression) != nil,
        remote.proposalDigest.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
        ["proposed", "stale", "unknown", "conflict", "verified", "cancelled"].contains(remote.status),
        remote.recoveryOnly || (approvedGoal == remote.goal && remote.localDraftDigest == expectedDigest) else {
        throw KittyError.message("The saved goal receipt is not bound to its approved fields. Its outcome remains unresolved.")
      }
      if let lastResult {
        try lastResult.validate(sheetID: sheetID, receiptID: remote.id, digest: remote.proposalDigest, goal: remote.goal)
        guard lastResult.status == remote.status else { throw KittyError.message("The saved goal status changed without matching its receipt.") }
      } else if ["verified", "cancelled"].contains(remote.status) {
        throw KittyError.message("The saved goal has no terminal verification result.")
      }
    }
  }
}
