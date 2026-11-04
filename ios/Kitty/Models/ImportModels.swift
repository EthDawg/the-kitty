import CryptoKit
import Foundation

struct ImportSource: Codable, Identifiable {
  let id: String
  let name: String
  let text: String
  var accountId: String
  var mapping: [String: String]?
  var sha256: String { Self.digest(Data(text.utf8)) }
  static func digest(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
  }
  var payload: [String: Any] {
    var p: [String: Any] = [
      "id": id, "name": name, "text": text, "accountId": accountId, "sha256": sha256,
    ]
    if let mapping {
      var m: [String: Any] = mapping
      m["confirmed"] = true
      p["mapping"] = m
    }
    return p
  }
}

struct ImportSourceReference: Codable, Hashable {
  let fileId: String
  let row: Int
  let line: Int?
  var key: String { "\(fileId):\(row)" }
}
struct ImportRow: Codable, Identifiable {
  let id, date, accountId, description, amountMinor: String
  let merchant: String?
  let categoryId: String?
  let person: String?
  let sourceId: String?
  let sourceRow: Int?
  let sourceRefs: [ImportSourceReference]?
  let originalProposalID: String?
  var decisionID: String { originalProposalID ?? id }
  var amount: Double? { Double(amountMinor).map { $0 / 100 } }
  var displayMerchant: String {
    guard let merchant, !merchant.isEmpty else { return description }
    return merchant
  }
}
struct ImportIssue: Codable, Identifiable {
  let id, code, severity, message, recovery: String
  let rowIds: [String]?
  let fileId: String?
  let reviewKey: String?
  let requiresDecision: Bool?
  var needsCategory: Bool { ["category-needed", "category-ambiguous"].contains(code) }
  var needsDuplicateChoice: Bool { ["existing-overlap", "changed-export"].contains(code) }
}
struct ImportCounts: Codable {
  let source, parsed, pending, invalid, overlap, existing, possibleExisting, proposed, review,
    errors: Int
}
struct ImportExclusion: Codable {
  let fileId: String?
  let sourceRow: Int?
  let rowId: String?
  let reason: String
  let description: String?
}
struct ImportDuplicate: Codable {
  let fileId: String?
  let sourceRow: Int?
  let rowId: String?
  let reason: String
  let existingId: String?
  let sourceRefs: [ImportSourceReference]?
  let candidate: ImportRow?
}
struct ImportProposal: Decodable {
  let rows: [ImportRow]
  let issues: [ImportIssue]
  let canCommit: Bool
  let counts: ImportCounts?
  let excluded: [ImportExclusion]?
  let duplicates: [ImportDuplicate]?
  let files: [ImportParsedFile]?
  var noOpMessage: String? {
    guard rows.isEmpty, issues.isEmpty else { return nil }
    let pending = counts?.pending ?? 0
    let reviewed = excluded?.filter { $0.reason == "reviewed-exclusion" }.count ?? 0
    let existing = counts?.existing ?? 0
    var parts: [String] = []
    if existing > 0 { parts.append("\(existing) already recorded") }
    if pending > 0 {
      parts.append("\(pending) pending transaction\(pending == 1 ? "" : "s") left out")
    }
    if reviewed > 0 { parts.append("\(reviewed) left out by your review") }
    return parts.isEmpty
      ? "No posted transactions to add." : parts.joined(separator: " · ") + ". Nothing to add."
  }
}
struct ImportParsedFile: Decodable {
  let accountId: String?
  let empty: Bool?
}

struct PreparedImportReceipt: Codable {
  let importId: String
  let proposalDigest: String
  let status: String
  var protocolVersion: Int? = nil
  var operation: String? = nil
}
struct ImportRemoteBinding: Codable {
  let id: String
  let sheetID: String
  let proposalDigest: String
  let localDraftDigest: String
  let proposal: Data
  var attempted: Bool
  var status: String
  var protocolVersion: Int? = nil
  var operation: String? = nil
  var recoveryOnly: Bool { localDraftDigest.isEmpty || proposal.isEmpty }

  func matches(draft: ImportDraft, sheetID: String) throws -> Bool {
    let currentDigest = try draft.contentDigest(sheetID: sheetID)
    return !recoveryOnly && self.sheetID == sheetID && localDraftDigest == currentDigest
  }
}
struct ImportDraft: Codable {
  var sources: [ImportSource] = []
  var documents: [SourceDocument] = []
  var sourceReviews: [SourceReviewDraft] = []
  var closeReview: PeriodCloseDraft?
  var categories: [String: String] = [:]
  var accepted: [String] = []
  var duplicateChoices: [String: String] = [:]
  var distinctSourceRows: [String] = []
  var boundSheetID: String?
  var remote: ImportRemoteBinding?
  var remoteImportID: String? { remote?.id }

  init() {}
  private enum CodingKeys: String, CodingKey {
    case sources, documents, sourceReviews, closeReview, categories, accepted, duplicateChoices, distinctSourceRows, boundSheetID, remote,
      remoteImportID
  }
  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    sources = try c.decodeIfPresent([ImportSource].self, forKey: .sources) ?? []
    documents = try c.decodeIfPresent([SourceDocument].self, forKey: .documents) ?? []
    sourceReviews = try c.decodeIfPresent([SourceReviewDraft].self, forKey: .sourceReviews) ?? []
    closeReview = try c.decodeIfPresent(PeriodCloseDraft.self, forKey: .closeReview)
    categories = try c.decodeIfPresent([String: String].self, forKey: .categories) ?? [:]
    accepted = try c.decodeIfPresent([String].self, forKey: .accepted) ?? []
    duplicateChoices =
      try c.decodeIfPresent([String: String].self, forKey: .duplicateChoices) ?? [:]
    distinctSourceRows = try c.decodeIfPresent([String].self, forKey: .distinctSourceRows) ?? []
    boundSheetID = try c.decodeIfPresent(String.self, forKey: .boundSheetID)
    remote = try c.decodeIfPresent(ImportRemoteBinding.self, forKey: .remote)
    if remote == nil, let legacyID = try c.decodeIfPresent(String.self, forKey: .remoteImportID) {
      // An old receipt stays recoverable; it cannot silently become a new writable draft.
      remote = ImportRemoteBinding(
        id: legacyID, sheetID: boundSheetID ?? "", proposalDigest: "",
        localDraftDigest: "", proposal: Data(), attempted: true, status: "unknown")
    }
  }
  func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(sources, forKey: .sources)
    try c.encode(documents, forKey: .documents)
    try c.encode(sourceReviews, forKey: .sourceReviews)
    try c.encodeIfPresent(closeReview, forKey: .closeReview)
    try c.encode(categories, forKey: .categories)
    try c.encode(accepted, forKey: .accepted)
    try c.encode(duplicateChoices, forKey: .duplicateChoices)
    try c.encode(distinctSourceRows, forKey: .distinctSourceRows)
    try c.encodeIfPresent(boundSheetID, forKey: .boundSheetID)
    try c.encodeIfPresent(remote, forKey: .remote)
  }
  func contentDigest(sheetID: String) throws -> String {
    var content = self
    content.remote = nil
    content.boundSheetID = sheetID
    content.accepted = content.accepted.sorted()
    content.distinctSourceRows = content.distinctSourceRows.sorted()
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    return ImportSource.digest(try encoder.encode(content))
  }
  var decisions: [String: Any] {
    var result: [String: Any] = [:]
    for (id, category) in categories {
      result[id] = ["categoryId": category, "acceptUncategorised": category == "UNCAT"]
    }
    for (id, choice) in duplicateChoices {
      var row = result[id] as? [String: Any] ?? [:]
      row["duplicate"] = choice
      result[id] = row
    }
    result["$review"] = ["acknowledge": accepted]
    result["$sourceRows"] = Dictionary(
      uniqueKeysWithValues: Set(distinctSourceRows).map { ($0, ["duplicate": "distinct"]) })
    return result
  }
  func afterVerifiedReceipt() -> ImportDraft {
    if remote?.recoveryOnly == true || remote?.operation == "close" {
      // A discovered receipt belongs to an earlier import, not these staged files.
      var reopened = self
      reopened.remote = nil
      reopened.accepted = []
      reopened.closeReview = nil
      return reopened
    }
    var cleared = ImportDraft()
    cleared.boundSheetID = boundSheetID
    return cleared
  }
}

struct ImportServiceIssue: Codable {
  let code: String
  let message: String
}
struct ImportServiceResult: Codable {
  let importId: String
  let status: String
  let proposalDigest: String?
  let issues: [ImportServiceIssue]?
  let verificationScope: String?
  var protocolVersion: Int? = nil
  var operation: String? = nil
  var sheetId: String? = nil
  var goal: GoalInput? = nil
}
struct ImportServiceFailure: LocalizedError {
  let code: String
  let message: String
  let statusCode: Int
  var recovery: ImportRecoveryDescriptor? = nil
  var errorDescription: String? { message }
}
struct ImportRecoveryDescriptor: Codable {
  let sheetId: String
  let importId: String
  let proposalDigest: String
  var protocolVersion: Int? = nil
  var operation: String? = nil
  var schemaVersion: Int? = nil
  var goal: GoalInput? = nil

  func isValid(for sheetID: String) -> Bool {
    sheetId == sheetID
      && sheetId.range(of: "^[A-Za-z0-9_-]{12,200}$", options: .regularExpression) != nil
      && importId.range(of: "^[A-Za-z0-9_-]{10,200}$", options: .regularExpression) != nil
      && proposalDigest.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil
  }
}
struct DemoImportReceipt: Codable {
  let id: String
  let createdAt: Date
  let sources: [ImportSource]
  let proposal: Data
  static func make(sources: [ImportSource], proposal: Data) throws -> DemoImportReceipt {
    DemoImportReceipt(
      id: try contentDigest(sources: sources, proposal: proposal), createdAt: Date(),
      sources: sources, proposal: proposal)
  }
  private static func contentDigest(sources: [ImportSource], proposal: Data) throws -> String {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    var bytes = try encoder.encode(sources)
    bytes.append(proposal)
    return ImportSource.digest(bytes)
  }
  func validatedRows() throws -> [[String: Any]] {
    guard id == (try Self.contentDigest(sources: sources, proposal: proposal)),
      sources.allSatisfy({ $0.id == $0.sha256 }),
      let object = try JSONSerialization.jsonObject(with: proposal) as? [String: Any],
      object["canCommit"] as? Bool == true,
      let rows = object["rows"] as? [[String: Any]]
    else {
      throw KittyError.message("A saved practice receipt is incomplete. It has not been replayed.")
    }
    return rows
  }
}
