import Foundation

struct SourceImportIssue: Codable, Identifiable {
  let id: String
  let code: String
  let severity: String
  let message: String
  let recordIds: [String]?
  let evidenceKey: String?
}

struct SourceImportProposal: Decodable {
  let canCommit: Bool
  let counts: [String: Int]
  let issues: [SourceImportIssue]
  var newCount: Int { counts["new"] ?? 0 }
  var evidenceCount: Int { counts["evidence"] ?? 0 }
  var alreadyPresent: Int { counts["alreadyPresent"] ?? 0 }
}

struct PeriodCloseDraft: Codable, Equatable {
  var periodEnd: String
  var evidenceImportIds: [String] = []
  var acknowledged: [String] = []
  var decisions = CloseReviewDecisions()
  init(periodEnd: String, evidenceImportIds: [String] = [], acknowledged: [String] = [], decisions: CloseReviewDecisions = .init()) {
    self.periodEnd = periodEnd; self.evidenceImportIds = evidenceImportIds
    self.acknowledged = acknowledged; self.decisions = decisions
  }
  private enum CodingKeys: String, CodingKey { case periodEnd, evidenceImportIds, acknowledged, decisions }
  init(from decoder: Decoder) throws {
    let values = try decoder.container(keyedBy: CodingKeys.self)
    periodEnd = try values.decode(String.self, forKey: .periodEnd)
    evidenceImportIds = try values.decodeIfPresent([String].self, forKey: .evidenceImportIds) ?? []
    acknowledged = try values.decodeIfPresent([String].self, forKey: .acknowledged) ?? []
    decisions = try values.decodeIfPresent(CloseReviewDecisions.self, forKey: .decisions) ?? .init()
  }
  var payload: [String: Any] {
    ["periodEnd": periodEnd, "evidenceImportIds": evidenceImportIds.sorted(),
      "review": decisions.payload]
  }
}

struct PeriodCloseCheck: Codable, Identifiable {
  let id: String
  let code: String
  let status: String
  let message: String
  let recordIds: [String]?
  let expectedMinor: String?
  let actualMinor: String?
  var passed: Bool { status == "pass" }
}

struct PeriodCloseProposal: Decodable {
  let periodEnd: String
  let expectedAsOf: String?
  let targetAsOf: String
  let postCloseRequired: Bool
  let checks: [PeriodCloseCheck]
  let issues: [SourceImportIssue]
  let canClose: Bool
}

/// A local rehearsal receipt. It never substitutes for a Google or month-close receipt.
struct DemoSourceReceipt: Codable {
  let id: String
  let createdAt: Date
  let documents: [SourceDocument]
  let reviews: [SourceReviewDraft]
  let result: Data
  let csvSources: [ImportSource]
  let csvProposal: Data?
  static func make(documents: [SourceDocument], reviews: [SourceReviewDraft], result: Data,
    csvSources: [ImportSource] = [], csvProposal: Data? = nil) throws -> Self {
    Self(id: try digest(documents: documents, reviews: reviews, result: result, csvSources: csvSources, csvProposal: csvProposal),
      createdAt: Date(), documents: documents, reviews: reviews, result: result,
      csvSources: csvSources, csvProposal: csvProposal)
  }
  private static func digest(documents: [SourceDocument], reviews: [SourceReviewDraft], result: Data,
    csvSources: [ImportSource], csvProposal: Data?) throws -> String {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    var bytes = try encoder.encode(documents)
    bytes.append(try encoder.encode(reviews))
    bytes.append(result)
    bytes.append(try encoder.encode(csvSources))
    if let csvProposal { bytes.append(csvProposal) }
    return ImportSource.digest(bytes)
  }
  func validatedRecords() throws -> [[String: Any]] {
    guard id == (try Self.digest(documents: documents, reviews: reviews, result: result, csvSources: csvSources, csvProposal: csvProposal)),
      documents.allSatisfy(\.isIntact),
      let object = try JSONSerialization.jsonObject(with: result) as? [String: Any],
      object["canCommit"] as? Bool == true,
      let records = object["records"] as? [[String: Any]]
    else { throw KittyError.message("A saved document practice receipt could not be verified. Its original files are preserved.") }
    return records
  }
  func validatedRows() throws -> [[String: Any]] {
    _ = try validatedRecords()
    guard let csvProposal else { return [] }
    return try DemoImportReceipt.make(sources: csvSources, proposal: csvProposal).validatedRows()
  }
}
