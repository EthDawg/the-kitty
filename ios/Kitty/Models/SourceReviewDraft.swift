import Foundation

enum SourceRecordKind: String, Codable, CaseIterable, Identifiable, Sendable {
  case statementBalance = "statement_balance", payslip, valuation
  var id: String { rawValue }
  var title: String {
    switch self { case .statementBalance: return "Statement balance"; case .payslip: return "Payslip"; case .valuation: return "Valuation" }
  }
}
struct SourceReviewChoice: Codable, Identifiable, Equatable, Sendable {
  let id: String
  let name: String
  var kind: String? = nil
  var currency: String? = nil
  var ledger: Bool? = nil
}
struct SourceReviewContext: Equatable, Sendable {
  var schemaVersion: Int
  var currency: String
  var people: [String]
  var accounts: [SourceReviewChoice]
  var items: [SourceReviewChoice]
}

enum SourceFieldValue: Codable, Equatable, Sendable {
  case string(String), array([SourceFieldValue]), object([String: SourceFieldValue])
  init(from decoder: Decoder) throws {
    let c = try decoder.singleValueContainer()
    if let value = try? c.decode(String.self) { self = .string(value) }
    else if let value = try? c.decode([SourceFieldValue].self) { self = .array(value) }
    else { self = .object(try c.decode([String: SourceFieldValue].self)) }
  }
  func encode(to encoder: Encoder) throws {
    var c = encoder.singleValueContainer()
    switch self { case .string(let value): try c.encode(value); case .array(let value): try c.encode(value); case .object(let value): try c.encode(value) }
  }
  var foundationValue: Any {
    switch self { case .string(let value): return value; case .array(let value): return value.map(\.foundationValue); case .object(let value): return value.mapValues(\.foundationValue) }
  }
}
struct SourceFieldConfirmation: Codable, Equatable, Sendable {
  let value: SourceFieldValue
  let sourceRefIds: [String]
}
struct SourceReviewAdjustment: Codable, Identifiable, Equatable, Sendable {
  var id = UUID().uuidString
  var label = ""
  var amount = ""
}
struct SourceFieldSpecification: Identifiable, Sendable {
  let id: String
  let title: String
  var optional = false
  var money = false
  var date = false
}
struct SourceFieldSuggestion: Codable, Identifiable, Equatable, Sendable {
  let id: String
  let input: String
  let reference: SourceEvidenceReference
  var polarity: String? = nil
}

/// Editable input is distinct from exact reviewed values. Confirmation captures
/// the value AND its document locator; subsequent edits invalidate it.
struct SourceReviewDraft: Codable, Identifiable, Equatable, Sendable {
  let id: String
  let documentID: String
  var kind: SourceRecordKind
  private(set) var inputs: [String: String] = [:]
  private(set) var balancePolarity: [String: String] = [:]
  var deductions: [SourceReviewAdjustment] = []
  var reimbursements: [SourceReviewAdjustment] = []
  private(set) var confirmations: [String: SourceFieldConfirmation] = [:]
  private(set) var evidence: [String: SourceEvidenceReference] = [:]
  var suggestions: [String: [SourceFieldSuggestion]] = [:]
  var messages: [String] = []
  private(set) var revision = 0

  init(documentID: String, kind: SourceRecordKind) {
    id = UUID().uuidString
    self.documentID = documentID
    self.kind = kind
    if kind == .statementBalance { inputs["balanceKind"] = "statement-close"; inputs["balanceConvention"] = "money-in-positive" }
    if kind == .payslip { inputs["valueBasis"] = "current-period" }
  }
  func input(_ key: String) -> String { inputs[key] ?? "" }
  mutating func setInput(_ key: String, _ value: String) {
    guard inputs[key] != value else { return }
    inputs[key] = value
    confirmations.removeValue(forKey: key)
    if ["accountId", "itemId", "person", "currency", "valueKind", "valueBasis"].contains(key) { confirmations.removeAll() }
    revision += 1
  }
  mutating func setPolarity(_ key: String, _ value: String) {
    balancePolarity[key] = value
    confirmations.removeValue(forKey: key)
    revision += 1
  }
  mutating func changedAdjustments(_ key: String) {
    confirmations.removeValue(forKey: key)
    revision += 1
  }
  mutating func chooseSuggestion(_ field: String, _ suggestion: SourceFieldSuggestion) {
    setInput(field, suggestion.input)
    evidence[field] = suggestion.reference
    if let polarity = suggestion.polarity { setPolarity(field, polarity) }
    confirmations.removeValue(forKey: field)
    revision += 1
  }
  mutating func selectEvidence(field: String, document: SourceDocument, page: Int, observation: SourceTextObservation? = nil) {
    let lower = observation?.text.lowercased() ?? ""
    let ytd = lower.contains("ytd") || lower.contains("year to date") || lower.contains("year-to-date")
    evidence[field] = SourceEvidenceReference(id: "ref-\(field)", fileId: document.id, page: page,
      quote: observation?.text, basis: kind == .payslip ? (ytd ? "ytd" : "current-period") : nil,
      bbox: observation?.bbox ?? [0, 0, 1, 1])
    confirmations.removeValue(forKey: field)
    revision += 1
  }
  mutating func setEvidence(field: String, reference: SourceEvidenceReference) {
    guard reference.fileId == documentID else { return }
    evidence[field] = reference
    confirmations.removeValue(forKey: field)
    revision += 1
  }
  mutating func confirm(_ field: String, document: SourceDocument, page: Int) throws {
    guard let value = try fieldValue(field) else { throw SourceIntakeError.message("Enter a valid value before confirming it.") }
    if evidence[field] == nil { selectEvidence(field: field, document: document, page: page) }
    guard let ref = evidence[field], ref.fileId == documentID else { throw SourceIntakeError.message("Choose the original source for this field.") }
    let pageValid = ref.page.map { $0 >= 1 && $0 <= max(1, document.pageCount) } ?? false
    let lineValid = document.mimeType == "text/csv" && (ref.line ?? 0) >= 2
    guard pageValid || lineValid else { throw SourceIntakeError.message("Choose the original page or CSV row for this field.") }
    if kind == .payslip && ref.basis == "ytd" { throw SourceIntakeError.message("Use the current pay-period value. A year-to-date total cannot confirm this field.") }
    confirmations[field] = SourceFieldConfirmation(value: value, sourceRefIds: [ref.id])
    revision += 1
  }
  mutating func unconfirm(_ field: String) { confirmations.removeValue(forKey: field); revision += 1 }
  func isConfirmed(_ field: String) -> Bool {
    guard let value = try? fieldValue(field), let confirmation = confirmations[field] else { return false }
    return value == confirmation.value && confirmation.sourceRefIds == evidence[field].map { [$0.id] }
  }
  private func fieldValue(_ field: String) throws -> SourceFieldValue? {
    // Validate one editable field without making another unfinished amount erase
    // its checked indicator. The complete record still passes fields()/problems().
    var isolated = self
    isolated.inputs = inputs.filter { $0.key == field || (field == "valueMinor" && $0.key == "valueKind") }
    isolated.deductions = field == "deductions" ? deductions : []
    isolated.reimbursements = field == "reimbursements" ? reimbursements : []
    return try isolated.fields()[field]
  }

  var specifications: [SourceFieldSpecification] {
    switch kind {
    case .statementBalance:
      return [.init(id: "accountId", title: "Sheet account"), .init(id: "currency", title: "Statement currency"),
        .init(id: "periodStart", title: "Period starts", date: true), .init(id: "periodEnd", title: "Period ends", date: true),
        .init(id: "openingMinor", title: "Opening balance", money: true), .init(id: "closingMinor", title: "Closing balance", money: true),
        .init(id: "balanceKind", title: "This is the statement closing balance"), .init(id: "balanceConvention", title: "Positive means held; negative means owing")]
    case .payslip:
      return [.init(id: "payDate", title: "Pay date", date: true), .init(id: "person", title: "Person in your Sheet"),
        .init(id: "employer", title: "Employer"), .init(id: "currency", title: "Payslip currency"),
        .init(id: "valueBasis", title: "These are current pay-period amounts"),
        .init(id: "grossMinor", title: "Gross pay", money: true), .init(id: "taxMinor", title: "Tax withheld", money: true),
        .init(id: "superMinor", title: "Employer super", money: true), .init(id: "netMinor", title: "Net pay", money: true),
        .init(id: "periodStart", title: "Pay period starts", optional: true, date: true), .init(id: "periodEnd", title: "Pay period ends", optional: true, date: true)]
    case .valuation:
      return [.init(id: "date", title: "Value observed on", date: true), .init(id: "itemId", title: "Item or account in your Sheet"),
        .init(id: "currency", title: "Valuation currency"), .init(id: "valueKind", title: "Value means"),
        .init(id: "valueMinor", title: "Observed value", money: true), .init(id: "sourceMethod", title: "How this value was obtained")]
    }
  }
  func fields() throws -> [String: SourceFieldValue] {
    guard deductions.count <= 20, reimbursements.count <= 20 else { throw SourceIntakeError.message("Review up to 20 deductions and 20 reimbursements per payslip.") }
    var fields: [String: SourceFieldValue] = [:]
    for spec in specifications {
      let raw = input(spec.id).trimmingCharacters(in: .whitespacesAndNewlines)
      if raw.isEmpty { continue }
      if spec.money {
        var minor = try SourceMoney.minor(raw)
        if kind == .statementBalance {
          guard minor >= 0, let polarity = balancePolarity[spec.id], ["held", "owing"].contains(polarity) else { throw SourceIntakeError.message("Enter the displayed balance as a positive amount and choose held or owing.") }
          if polarity == "owing" { minor = -minor }
        } else if kind == .valuation {
          guard minor >= 0, ["asset", "liability"].contains(input("valueKind")) else { throw SourceIntakeError.message("Enter a positive displayed value and choose asset value or amount owing.") }
          if input("valueKind") == "liability" { minor = -minor }
        } else if minor < 0 { throw SourceIntakeError.message("Payslip amounts must be non-negative. A correction needs a separate reviewed adjustment.") }
        fields[spec.id] = .string(String(minor))
      } else if spec.date {
        guard SourceMoney.isDate(raw) else { throw SourceIntakeError.message("Use a real date in YYYY-MM-DD format for \(spec.title.lowercased()).") }
        fields[spec.id] = .string(raw)
      } else { fields[spec.id] = .string(raw) }
    }
    for (key, adjustments) in [("deductions", deductions), ("reimbursements", reimbursements)] where !adjustments.isEmpty {
      fields[key] = .array(try adjustments.map {
        guard !$0.label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw SourceIntakeError.message("Give each payslip adjustment its source label.") }
        let minor = try SourceMoney.minor($0.amount)
        guard minor >= 0 else { throw SourceIntakeError.message("Use positive deduction and reimbursement amounts.") }
        return .object(["label": .string($0.label), "amountMinor": .string(String(minor))])
      })
    }
    return fields
  }
  func problems(context: SourceReviewContext, document: SourceDocument) -> [String] {
    var problems: [String] = []
    if !document.isIntact || document.id != documentID { problems.append("The original document does not match this review.") }
    for spec in specifications where !spec.optional && input(spec.id).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { problems.append("Enter \(spec.title.lowercased()).") }
    do {
      let values = try fields()
      for key in values.keys where !isConfirmed(key) { problems.append("Check \(specifications.first { $0.id == key }?.title.lowercased() ?? key) against the original.") }
      if !["AUD", "USD", "NZD", "GBP", "EUR", "CAD", "CHF", "SGD", "HKD"].contains(input("currency")) || input("currency") != context.currency { problems.append("Choose the supported currency of this Sheet; conversion is not available.") }
      if kind == .statementBalance && !context.accounts.contains(where: { $0.id == input("accountId") }) { problems.append("Choose an account from this Sheet.") }
      if kind == .statementBalance, let account = context.accounts.first(where: { $0.id == input("accountId") }), let currency = account.currency, currency != input("currency") { problems.append("The statement currency does not match this account.") }
      if kind == .payslip && !context.people.contains(input("person")) { problems.append("Choose a person from this Sheet.") }
      if kind == .valuation && !context.items.contains(where: { $0.id == input("itemId") }) { problems.append("Choose an existing item or valuation account.") }
      if kind == .valuation {
        if !["statement", "appraisal", "market", "estimate"].contains(input("sourceMethod")) { problems.append("Choose the source method for this valuation.") }
        if let item = context.items.first(where: { $0.id == input("itemId") }) {
          if let currency = item.currency, currency != input("currency") { problems.append("The valuation currency does not match this item.") }
          if context.schemaVersion == 2 && item.ledger == true { problems.append("A ledger account needs transaction reconciliation, not a replacement valuation.") }
          if item.kind?.lowercased().contains("loan") == true && input("valueKind") != "liability" { problems.append("Check the loan's sign: an amount owing is a liability, not an asset value.") }
        }
      }
      if kind == .payslip && input("valueBasis") != "current-period" { problems.append("Confirm current pay-period amounts separately from YTD totals.") }
      if kind == .statementBalance && (input("balanceKind") != "statement-close" || input("balanceConvention") != "money-in-positive") { problems.append("Confirm the statement-close balance and its signed ledger convention.") }
      if !input("periodStart").isEmpty, !input("periodEnd").isEmpty, input("periodStart") > input("periodEnd") { problems.append("The period end must be on or after its start.") }
      if kind == .payslip {
        let required = ["grossMinor", "taxMinor", "netMinor"]
        if required.allSatisfy({ values[$0] != nil }) {
          let gross = try SourceMoney.minor(input("grossMinor")), tax = try SourceMoney.minor(input("taxMinor")), net = try SourceMoney.minor(input("netMinor"))
          let deductions = try self.deductions.reduce(Int64(0)) { $0 + (try SourceMoney.minor($1.amount)) }
          let reimbursements = try self.reimbursements.reduce(Int64(0)) { $0 + (try SourceMoney.minor($1.amount)) }
          if gross-tax-deductions+reimbursements != net { problems.append("Gross less tax and deductions plus reimbursements does not match net pay. Check the current-period fields and any documented adjustments.") }
        }
      }
    } catch { problems.append(error.localizedDescription) }
    return Array(Set(problems)).sorted()
  }
  func recordPayload(document: SourceDocument, context: SourceReviewContext) throws -> [String: Any] {
    let issues = problems(context: context, document: document)
    guard issues.isEmpty else { throw SourceIntakeError.message(issues.joined(separator: " ")) }
    let values = try fields()
    let identityKeys: [String]
    switch kind { case .payslip: identityKeys = ["payDate", "person", "employer"]; case .valuation: identityKeys = ["date", "itemId"]; case .statementBalance: identityKeys = ["accountId", "periodStart", "periodEnd"] }
    let csvLines = Set(evidence.values.compactMap(\.line)).sorted()
    let identity: [String: Any] = ["fileId": documentID, "kind": kind.rawValue, "identity": identityKeys.map { input($0) }, "sourceLines": csvLines]
    let recordID = "SR-" + SourceDocument.sha256(try JSONSerialization.data(withJSONObject: identity, options: [.sortedKeys]))
    let confirmed = Dictionary(uniqueKeysWithValues: values.keys.compactMap { key -> (String, [String: Any])? in
      guard let c = confirmations[key] else { return nil }; return (key, ["value": c.value.foundationValue, "sourceRefIds": c.sourceRefIds])
    })
    let refs = values.keys.compactMap { evidence[$0] }.sorted { $0.id < $1.id }
    let methods = Set(refs.compactMap { ref in document.pages.first { $0.number == ref.page }?.method.rawValue })
    let candidateMethod = document.mimeType == "text/csv" ? "csv" : methods.count == 1 ? methods.first! : "manual"
    let method = ["pdf-text", "vision-ocr", "csv"].contains(candidateMethod) ? candidateMethod : "manual"
    return ["kind": kind.rawValue, "recordId": recordID, "fields": values.mapValues(\.foundationValue),
      "sourceRefs": refs.map(\.payload), "extraction": ["method": method, "version": document.extractorVersion],
      "confirmedFields": confirmed]
  }
}

enum SourceMoney {
  static func minor(_ text: String) throws -> Int64 {
    var value = text.trimmingCharacters(in: .whitespacesAndNewlines)
    var negative = false
    if value.hasPrefix("("), value.hasSuffix(")") { negative = true; value = String(value.dropFirst().dropLast()) }
    value = value.replacingOccurrences(of: "$", with: "")
    if value.hasPrefix("-") { guard !negative else { throw SourceIntakeError.message("The amount has two signs.") }; negative = true; value.removeFirst() }
    else if value.hasPrefix("+") { guard !negative else { throw SourceIntakeError.message("The amount has two signs.") }; value.removeFirst() }
    guard value.range(of: "^(?:[0-9]+|[0-9]{1,3}(?:,[0-9]{3})+)(?:\\.[0-9]{1,2})?$", options: .regularExpression) != nil else { throw SourceIntakeError.message("Use a complete amount with up to two decimal places.") }
    let parts = value.replacingOccurrences(of: ",", with: "").split(separator: ".", omittingEmptySubsequences: false)
    guard let whole = Int64(parts[0]), whole <= 999_999_999_999 else { throw SourceIntakeError.message("The amount exceeds the supported exact-currency range.") }
    let fraction = parts.count == 2 ? String(parts[1]).padding(toLength: 2, withPad: "0", startingAt: 0) : "00"
    let minor = whole*100 + (Int64(fraction) ?? 0)
    return negative ? -minor : minor
  }
  static func decimal(_ minor: Int64) -> String {
    let magnitude = abs(minor)
    return (minor < 0 ? "-" : "") + String(magnitude/100) + "." + String(format: "%02lld", magnitude%100)
  }
  static func isDate(_ value: String) -> Bool {
    guard value.range(of: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$", options: .regularExpression) != nil else { return false }
    let formatter = DateFormatter(); formatter.calendar = Calendar(identifier: .gregorian); formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.timeZone = TimeZone(secondsFromGMT: 0); formatter.dateFormat = "yyyy-MM-dd"; formatter.isLenient = false
    guard let date = formatter.date(from: value), formatter.string(from: date) == value else { return false }
    return value >= "1900-01-01" && value <= "2200-12-31"
  }
}
