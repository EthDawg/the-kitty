import Foundation

extension SourceReviewDraft {
  /// Uses the existing adversarially tested CSV parser. Only known typed-table
  /// schemas are routed here; a transaction CSV produces no typed suggestions.
  @MainActor static func suggestedCSV(document: SourceDocument, context: SourceReviewContext, engine: EngineBridge) throws -> [SourceReviewDraft] {
    guard document.mimeType == "text/csv", document.isIntact else { return [] }
    let parsed = try engine.call("KittyImport", method: "parseCSV", input: String(decoding: document.bytes, as: UTF8.self))
    guard let object = try JSONSerialization.jsonObject(with: parsed) as? [String: Any],
      let headers = object["headers"] as? [String], let records = object["records"] as? [[String: Any]]
    else { throw SourceIntakeError.message("The source CSV could not be read.") }
    let payHeaders = ["Pay date", "Person", "Employer", "Gross pay", "Tax withheld", "Super (employer)", "Net pay"]
    let optionalPayHeaders = ["Document ID", "Pay date", "Person", "Employer", "Gross AUD", "PAYG AUD", "Super AUD", "Net AUD", "Period start", "Period end"]
    let isPay = headers == payHeaders || headers == optionalPayHeaders
    let isValuation = headers == ["Month end", "Item ID", "Value"] || headers == ["Date", "Item ID", "Value"]
    guard isPay || isValuation else { return [] }
    guard records.count <= 100 else { throw SourceIntakeError.message("Review up to 100 payslips or valuations together. Split a larger source into shorter periods.") }
    let sourceText = String(decoding: document.bytes, as: UTF8.self)
    var lineStarts = [sourceText.startIndex]
    for index in sourceText.indices where ["\n", "\r", "\r\n"].contains(String(sourceText[index])) { lineStarts.append(sourceText.index(after: index)) }
    return try records.enumerated().map { offset, record in
      guard let values = record["values"] as? [String], values.count == headers.count,
        let line = record["line"] as? Int, lineStarts.indices.contains(line - 1) else { throw SourceIntakeError.message("A source CSV row is incomplete. No row was skipped.") }
      let nextLine = offset + 1 < records.count ? records[offset + 1]["line"] as? Int : nil
      let end = nextLine.flatMap { lineStarts.indices.contains($0 - 1) ? lineStarts[$0 - 1] : nil } ?? sourceText.endIndex
      let quote = String(sourceText[lineStarts[line - 1]..<end]).trimmingCharacters(in: .newlines)
      guard quote.count <= 10_000 else { throw SourceIntakeError.message("A source CSV row is too long to review safely. Check the original export; no rows were skipped.") }
      var draft = SourceReviewDraft(documentID: document.id, kind: isPay ? .payslip : .valuation)
      func value(_ header: String) -> String { headers.firstIndex(of: header).map { values[$0] } ?? "" }
      let mapping: [String: String] = isPay
        ? ["payDate": "Pay date", "person": "Person", "employer": "Employer",
          "grossMinor": headers == payHeaders ? "Gross pay" : "Gross AUD",
          "taxMinor": headers == payHeaders ? "Tax withheld" : "PAYG AUD",
          "superMinor": headers == payHeaders ? "Super (employer)" : "Super AUD",
          "netMinor": headers == payHeaders ? "Net pay" : "Net AUD",
          "periodStart": "Period start", "periodEnd": "Period end"]
        : ["date": headers[0], "itemId": "Item ID", "valueMinor": "Value"]
      for (field, header) in mapping {
        let raw = value(header)
        guard !raw.isEmpty else { continue }
        var input = raw
        if field.hasSuffix("Minor"), let amount = try? SourceMoney.minor(raw) {
          input = SourceMoney.decimal(isValuation ? abs(amount) : amount)
          if isValuation {
            let item = context.items.first { $0.id == value("Item ID") }
            let loan = item?.kind?.lowercased().contains("loan") == true
            draft.setInput("valueKind", amount < 0 || (amount == 0 && loan) ? "liability" : "asset")
          }
        }
        let reference = SourceEvidenceReference(id: "ref-\(field)", fileId: document.id, line: line, quote: quote, basis: isPay ? "current-period" : nil)
        let suggestion = SourceFieldSuggestion(id: "line-\(line)-\(field)", input: input, reference: reference)
        draft.suggestions[field] = [suggestion]
        if field == "person" && !context.people.contains(input) { continue }
        if field == "itemId" && !context.items.contains(where: { $0.id == input }) { continue }
        draft.chooseSuggestion(field, suggestion)
      }
      // These table schemas omit currency and valuation method. Defaults are
      // visible suggestions only; the user must explicitly confirm their meaning.
      draft.setInput("currency", context.currency)
      for field in ["currency", isPay ? "valueBasis" : "valueKind"] {
        draft.setEvidence(field: field, reference: SourceEvidenceReference(id: "ref-\(field)", fileId: document.id, line: line, basis: isPay ? "current-period" : nil))
      }
      if isValuation { draft.messages.append("This CSV does not state a valuation method. Choose statement, appraisal, market value or estimate before confirming it.") }
      draft.messages.append("Source CSV line \(line). Suggestions are unconfirmed; check each value against the original.")
      return draft
    }
  }
}
