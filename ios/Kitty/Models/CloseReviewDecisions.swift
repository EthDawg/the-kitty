import Foundation

struct CloseReviewDecisions: Codable, Equatable {
  var decisions: [String: CloseIssueDecision] = [:]
  var salaryMatches: [CloseSalaryMatch] = []
  var transferPairs: [CloseTransferPair] = []
  init() {}
  private enum CodingKeys: String, CodingKey { case decisions, salaryMatches, transferPairs }
  init(from decoder: Decoder) throws {
    let values = try decoder.container(keyedBy: CodingKeys.self)
    decisions = try values.decodeIfPresent([String: CloseIssueDecision].self, forKey: .decisions) ?? [:]
    salaryMatches = try values.decodeIfPresent([CloseSalaryMatch].self, forKey: .salaryMatches) ?? []
    transferPairs = try values.decodeIfPresent([CloseTransferPair].self, forKey: .transferPairs) ?? []
  }
  var payload: [String: Any] {
    ["decisions": decisions.mapValues(\.payload), "salaryMatches": salaryMatches.map(\.payload),
      "transferPairs": transferPairs.map(\.payload)]
  }
}

struct CloseIssueDecision: Codable, Equatable {
  let reason: String
  let recordIds: [String]
  let evidenceKey: String
  var payload: [String: Any] {
    ["action": "acknowledge", "reason": reason, "recordIds": recordIds.sorted(), "evidenceKey": evidenceKey]
  }
  func stillMatches(_ issue: SourceImportIssue) -> Bool {
    issue.severity == "review" && issue.evidenceKey == evidenceKey
      && (issue.recordIds ?? []).sorted() == recordIds.sorted()
  }
}

struct CloseSalaryMatch: Codable, Equatable, Identifiable {
  var id = UUID().uuidString
  let payslipRecordIds: [String]
  let transactionIds: [String]
  let reason: String
  let allowTiming: Bool
  var payload: [String: Any] {
    ["payslipRecordIds": payslipRecordIds.sorted(), "transactionIds": transactionIds.sorted(),
      "reason": reason, "allowTiming": allowTiming]
  }
}

struct CloseTransferPair: Codable, Equatable, Identifiable {
  var id = UUID().uuidString
  let transactionIds: [String]
  let reason: String
  var payload: [String: Any] {
    ["transactionIds": transactionIds.sorted(), "reason": reason]
  }
}

struct CloseLedgerChoice: Identifiable, Equatable {
  let id, date, accountID, accountName, amountMinor, categoryID, person, currency: String
  let description, transferGroup, status: String
  var isSalary: Bool { categoryID == "SALARY" }
  var isTransfer: Bool { ["TRANSFER", "CC-PAY"].contains(categoryID) || !transferGroup.isEmpty }
  var displayAmount: String { CloseExactMoney.display(amountMinor, currency: currency) }

  static func decode(baseline: [String: Any]) throws -> [CloseLedgerChoice] {
    guard let accounts = baseline["accounts"] as? [[String: Any]],
      let rows = baseline["transactions"] as? [[String: Any]],
      let currency = baseline["currency"] as? String else {
      throw KittyError.message("Refresh the current ledger before matching records.")
    }
    var accountMap: [String: [String: Any]] = [:]
    for account in accounts {
      guard let id = account["id"] as? String, !id.isEmpty, accountMap[id] == nil else {
        throw KittyError.message("Account identities are incomplete or repeated. Refresh the Sheet before matching.")
      }
      accountMap[id] = account
    }
    var seen = Set<String>(), choices: [CloseLedgerChoice] = []
    for row in rows {
      guard let id = row["id"] as? String, !id.isEmpty, seen.insert(id).inserted,
        let day = row["date"] as? String, SourceMoney.isDate(day),
        let accountID = row["accountId"] as? String, let account = accountMap[accountID],
        let amount = row["amountMinor"] as? String, CloseExactMoney.minor(amount) != nil,
        let category = row["categoryId"] as? String,
        let status = row["status"] as? String,
        ["posted", "settled", "pending", "cancelled"].contains(status),
        let accountCurrency = account["currency"] as? String, accountCurrency == currency else {
        throw KittyError.message("A ledger record is missing its exact amount, date, account or posting status.")
      }
      guard status == "posted" || status == "settled" else { continue }
      choices.append(CloseLedgerChoice(id: id, date: day, accountID: accountID,
        accountName: account["name"] as? String ?? accountID, amountMinor: amount,
        categoryID: category, person: row["person"] as? String ?? "", currency: currency,
        description: row["description"] as? String ?? row["bankDescription"] as? String ?? "",
        transferGroup: row["transferGroup"] as? String ?? "", status: status))
    }
    return choices.sorted { $0.date == $1.date ? $0.id < $1.id : $0.date > $1.date }
  }
}

struct ClosePayslipChoice: Identifiable, Equatable {
  let id, payDate, person, employer, currency, grossMinor, taxMinor, superMinor, netMinor: String
  let aliases: [String]
  let hasAcceptedEvidence: Bool
  var displayAmount: String { CloseExactMoney.display(netMinor, currency: currency) }

  static func decode(baseline: [String: Any], evidence: [[String: Any]] = []) throws -> [ClosePayslipChoice] {
    guard let rows = baseline["payslips"] as? [[String: Any]], let currency = baseline["currency"] as? String else {
      throw KittyError.message("Refresh recorded payslips before matching deposits.")
    }
    let accepted = evidence.filter { $0["receiptVerified"] as? Bool == true }
      .flatMap { $0["records"] as? [[String: Any]] ?? [] }.filter { $0["kind"] as? String == "payslip" }
    let factKeys = ["payDate", "person", "employer", "currency", "valueBasis", "grossMinor", "taxMinor", "superMinor", "netMinor"]
    var seen = Set<String>(), choices: [ClosePayslipChoice] = []
    for row in rows {
      guard let fields = row["fields"] as? [String: Any],
        let day = fields["payDate"] as? String, SourceMoney.isDate(day),
        let person = fields["person"] as? String, !person.isEmpty,
        let employer = fields["employer"] as? String, !employer.isEmpty,
        fields["currency"] as? String == currency, fields["valueBasis"] as? String == "current-period",
        let gross = fields["grossMinor"] as? String, let tax = fields["taxMinor"] as? String,
        let superAmount = fields["superMinor"] as? String, let net = fields["netMinor"] as? String,
        [gross, tax, superAmount, net].allSatisfy({ CloseExactMoney.minor($0) != nil }) else {
        throw KittyError.message("A recorded payslip is missing its exact current-period facts.")
      }
      let key = try JSONSerialization.data(withJSONObject: [day, person, employer], options: [.sortedKeys])
      let identity = ImportSource.digest(key)
      guard seen.insert(identity).inserted else {
        throw KittyError.message("Two recorded payslips share a pay date, person and employer. Resolve that identity before matching deposits.")
      }
      let matching = accepted.filter { source in
        guard let other = source["fields"] as? [String: Any] else { return false }
        return factKeys.allSatisfy { (fields[$0] as? String) == (other[$0] as? String) }
      }
      let sourceIDs = matching.compactMap { $0["recordId"] as? String }.filter { !$0.isEmpty }.sorted()
      let rawIDs = [row["recordId"] as? String, row["sheetRecordId"] as? String].compactMap { $0 }.filter { !$0.isEmpty }
      let id = sourceIDs.first ?? rawIDs.first ?? "unverified-\(identity)"
      choices.append(ClosePayslipChoice(id: id, payDate: day, person: person, employer: employer,
        currency: currency, grossMinor: gross, taxMinor: tax, superMinor: superAmount, netMinor: net,
        aliases: Array(Set(sourceIDs + rawIDs)).sorted(), hasAcceptedEvidence: !sourceIDs.isEmpty))
    }
    return choices.sorted { $0.payDate == $1.payDate ? $0.id < $1.id : $0.payDate > $1.payDate }
  }
}

enum CloseExactMoney {
  static let limit: Int64 = 99_999_999_999_999
  static func minor(_ value: String) -> Int64? {
    guard let amount = Int64(value), String(amount) == value, amount >= -limit, amount <= limit else { return nil }
    return amount
  }
  static func total(_ values: [String]) -> String? {
    var total: Int64 = 0
    for value in values {
      guard let amount = minor(value) else { return nil }
      let sum = total.addingReportingOverflow(amount)
      guard !sum.overflow, sum.partialValue >= -limit, sum.partialValue <= limit else { return nil }
      total = sum.partialValue
    }
    return String(total)
  }
  static func display(_ value: String, currency: String) -> String {
    guard let amount = minor(value) else { return "Not available" }
    return "\(currency) \(SourceMoney.decimal(amount))"
  }
}
