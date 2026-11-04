import Foundation

extension SourceReviewDraft {
  /// Conservative label matches suggest values, never confirmations. Repeated,
  /// conflicting amounts and YTD-only figures remain unresolved in the form.
  static func suggested(document: SourceDocument, kind: SourceRecordKind, context: SourceReviewContext) -> SourceReviewDraft {
    var draft = SourceReviewDraft(documentID: document.id, kind: kind)
    let labels: [String: [String]]
    switch kind {
    case .statementBalance:
      labels = ["accountId": ["account id", "account"], "currency": ["currency"], "periodStart": ["period start", "statement starts"], "periodEnd": ["period end", "statement ends"], "openingMinor": ["opening balance"], "closingMinor": ["closing balance", "statement balance"]]
    case .payslip:
      labels = ["payDate": ["pay date", "payment date"], "person": ["person", "employee"], "employer": ["employer"], "currency": ["currency"], "grossMinor": ["gross pay", "gross this pay"], "taxMinor": ["tax withheld", "payg", "tax this pay"], "superMinor": ["employer super", "super employer", "superannuation employer"], "netMinor": ["net pay", "net this pay"], "periodStart": ["period start", "pay period starts"], "periodEnd": ["period end", "pay period ends"]]
    case .valuation:
      labels = ["date": ["valuation date", "observation date", "statement date"], "itemId": ["item id", "account id", "asset id"], "currency": ["currency"], "valueMinor": ["observed value", "estimated value", "market value", "closing balance", "amount owing"], "sourceMethod": ["valuation method", "source method"], "valueKind": ["value kind"]]
    }
    for page in document.pages {
      let lines: [SourceTextObservation] = page.observations.isEmpty
        ? page.text.components(separatedBy: .newlines).enumerated().map { .init(id: "p\(page.number)-l\($0.offset + 1)", text: $0.element, bbox: nil, confidence: nil) }
        : page.observations
      for line in lines {
        let lower = line.text.lowercased()
        let ytd = lower.contains("ytd") || lower.contains("year to date") || lower.contains("year-to-date")
        for (field, aliases) in labels {
          let spec = draft.specifications.first { $0.id == field }
          // A text field must match the complete label. In particular,
          // "Employer super" is an amount, never another employer name.
          let label = lower.split(separator: ":", maxSplits: 1).first.map(String.init)?.trimmingCharacters(in: .whitespacesAndNewlines)
          let matchesLabel = spec?.money == true || spec?.date == true
            ? aliases.contains { lower.hasPrefix($0 + ":") || lower.hasPrefix($0 + " (") || lower.hasPrefix($0 + " ") }
            : lower.contains(":") && aliases.contains { $0 == label }
          guard matchesLabel else { continue }
          if kind == .payslip && ytd {
            draft.messages.append("Year-to-date figures are present. Confirm the current pay-period amounts, not those totals.")
            continue
          }
          let reference = SourceEvidenceReference(id: "ref-\(field)", fileId: document.id, page: page.number, quote: line.text,
            basis: kind == .payslip ? "current-period" : nil, bbox: line.bbox)
          var value: String?
          var polarity: String?
          if spec?.money == true {
            let money = matches(in: line.text, pattern: "(?<![0-9])[-+]?\\$?(?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)\\.[0-9]{2}(?![0-9])")
            if money.count == 1, let minor = try? SourceMoney.minor(money[0]) {
              value = SourceMoney.decimal(abs(minor))
              if kind == .statementBalance { polarity = minor < 0 || lower.contains("owing") ? "owing" : "held" }
              if kind == .valuation && (minor < 0 || lower.contains("owing")) { draft.setInput("valueKind", "liability") }
            } else if money.count > 1 { draft.messages.append("More than one amount appears beside \(spec?.title.lowercased() ?? field). Choose the right value from the original.") }
          } else if spec?.date == true {
            let dates = matches(in: line.text, pattern: "[0-9]{4}-[0-9]{2}-[0-9]{2}")
            if dates.count == 1, SourceMoney.isDate(dates[0]) { value = dates[0] }
          } else if let colon = line.text.firstIndex(of: ":") {
            value = String(line.text[line.text.index(after: colon)...]).trimmingCharacters(in: .whitespacesAndNewlines)
            if field == "currency" { value = value?.uppercased() }
            if ["valueKind", "sourceMethod"].contains(field) { value = value?.lowercased() }
          }
          guard let value, !value.isEmpty else { continue }
          let suggestion = SourceFieldSuggestion(id: "\(line.id)-\(field)", input: value, reference: reference, polarity: polarity)
          draft.suggestions[field, default: []].append(suggestion)
        }
      }
    }
    for (field, values) in draft.suggestions {
      let distinct = Set(values.map(\.input))
      if distinct.count == 1, let suggestion = values.first {
        if field == "person" && !context.people.contains(suggestion.input) { continue }
        if field == "accountId" && !context.accounts.contains(where: { $0.id == suggestion.input }) { continue }
        if field == "itemId" && !context.items.contains(where: { $0.id == suggestion.input }) { continue }
        draft.chooseSuggestion(field, suggestion)
      } else if distinct.count > 1 { draft.messages.append("The document contains different values for \(draft.specifications.first { $0.id == field }?.title.lowercased() ?? field). Choose and check one.") }
    }
    if kind == .statementBalance,
      let account = context.accounts.first(where: { $0.id == draft.input("accountId") }),
      ["credit", "loan", "liability"].contains(where: { account.kind?.lowercased().contains($0) == true }) {
      for field in ["openingMinor", "closingMinor"] where draft.balancePolarity[field] == "held" {
        let quote = draft.evidence[field]?.quote?.lowercased() ?? ""
        if !["credit balance", "held", "overpayment"].contains(where: quote.contains) {
          draft.setPolarity(field, "")
          draft.messages.append("Confirm whether each card or loan balance is money owing or a credit balance.")
        }
      }
    }
    draft.messages = Array(Set(draft.messages)).sorted()
    return draft
  }
  private static func matches(in text: String, pattern: String) -> [String] {
    guard let regex = try? NSRegularExpression(pattern: pattern) else { return [] }
    let ns = text as NSString
    return regex.matches(in: text, range: NSRange(location: 0, length: ns.length)).map { ns.substring(with: $0.range) }
  }
}
