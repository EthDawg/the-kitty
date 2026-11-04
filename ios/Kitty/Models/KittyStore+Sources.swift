import Foundation

extension KittyStore {
  var hasImportSources: Bool { !draft.sources.isEmpty || !draft.documents.isEmpty }
  var sourceContext: SourceReviewContext {
    let baseline = sourceBaseline ?? [:]
    func choices(_ key: String) -> [SourceReviewChoice] {
      (baseline[key] as? [[String: Any]] ?? []).compactMap { row in
        guard let id = row["id"] as? String, let name = row["name"] as? String else { return nil }
        return SourceReviewChoice(id: id, name: name, kind: row["kind"] as? String,
          currency: row["currency"] as? String, ledger: row["ledger"] as? Bool)
      }
    }
    return SourceReviewContext(schemaVersion: household?.sheetVersion ?? 1, currency: currency,
      people: baseline["people"] as? [String] ?? household?.people ?? [],
      accounts: choices("accounts"), items: choices("items"))
  }
  var sourceImportCanCommit: Bool {
    guard importPublicationNotice == nil, sourceProposal?.canCommit == true, sourceEvidenceValid,
      emptySourceAccountsNeedingEvidence.isEmpty else { return false }
    return draft.sources.isEmpty || proposal?.canCommit == true || proposal?.noOpMessage != nil
  }
  var emptySourceAccountsNeedingEvidence: [String] {
    let covered = Set(draft.sourceReviews.compactMap { review -> String? in
      guard review.kind == .statementBalance,
        let document = draft.documents.first(where: { $0.id == review.documentID }),
        review.problems(context: sourceContext, document: document).isEmpty else { return nil }
      return review.input("accountId")
    })
    return Array(Set((proposal?.files ?? []).filter { $0.empty == true }
      .compactMap(\.accountId))).filter { !covered.contains($0) }.sorted()
  }
  func clearSourceState() {
    sourceProposal = nil; sourceProposalData = nil; sourceReviewNotice = nil
    closeProposal = nil; closeProposalData = nil; sourceBaseline = nil; sourceBaselineSheetID = nil
    acceptedSourceEvidence = []; acceptedSourceImportIDs = []; demoSourceRecords = []
    sourceEvidenceValid = true
  }
  func acceptSourceEvidence(_ object: [String: Any], sheetID: String) throws {
    guard object["sheetId"] as? String == sheetID,
      let baseline = object["baseline"] as? [String: Any],
      baseline["schemaVersion"] as? Int == household?.sheetVersion,
      baseline["currency"] as? String == currency,
      baseline["accounts"] is [[String: Any]], baseline["items"] is [[String: Any]],
      baseline["people"] is [String], baseline["payslips"] is [[String: Any]],
      baseline["valuations"] is [[String: Any]], baseline["transactions"] is [[String: Any]],
      let evidence = object["evidence"] as? [String: Any],
      let imports = evidence["imports"] as? [[String: Any]],
      let ids = object["evidenceImportIds"] as? [String]
    else { throw KittyError.message("The current Sheet's document evidence is incomplete. Your originals and review are preserved.") }
    sourceBaseline = baseline; sourceBaselineSheetID = sheetID
    if let publicFeedEnabled = object["publicFeedEnabled"] as? Bool {
      household?.publicFeedEnabled = publicFeedEnabled
    }
    acceptedSourceEvidence = imports; acceptedSourceImportIDs = ids
    sourceEvidenceValid = true
  }
  @discardableResult func loadDemoSourceEvidence() -> Bool {
    guard isDemo, let engine, let snapshotData else { return false }
    do {
      let raw = try JSONSerialization.jsonObject(with: snapshotData)
      let data = try engine.call("NativeKitty", method: "demoSourceBaseline", input: raw)
      guard var baseline = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        throw KittyError.message("The practice source data could not be opened.")
      }
      let files = try FileManager.default.contentsOfDirectory(at: importStorage, includingPropertiesForKeys: nil)
        .filter { $0.lastPathComponent.hasPrefix("practice-sources-") && $0.pathExtension == "json" }
      var records: [[String: Any]] = [], imports: [[String: Any]] = []
      var seen = Set<String>()
      for file in files.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) {
        let receipt = try JSONDecoder().decode(DemoSourceReceipt.self, from: Data(contentsOf: file))
        let accepted = try receipt.validatedRecords()
        imports.append(["importId": receipt.id, "proposalDigest": receipt.id, "receiptVerified": true, "records": accepted])
        for record in accepted {
          guard let id = record["recordId"] as? String else { throw KittyError.message("A practice source receipt has no record identity.") }
          if seen.insert(id).inserted { records.append(record) }
        }
      }
      for (kind, key) in [("payslip", "payslips"), ("valuation", "valuations")] {
        baseline[key] = (baseline[key] as? [[String: Any]] ?? [])
          + records.filter { $0["kind"] as? String == kind && $0["disposition"] as? String != "already-present" }
      }
      sourceBaseline = baseline; sourceBaselineSheetID = "demo"
      acceptedSourceEvidence = imports
      acceptedSourceImportIDs = imports.compactMap { $0["importId"] as? String }
      demoSourceRecords = records; sourceEvidenceValid = true
      return true
    } catch {
      sourceEvidenceValid = false
      self.error = "Practice source evidence could not be verified. Its originals remain on this device. \(error.localizedDescription)"
      return false
    }
  }
  func captureSource(_ url: URL) async {
    guard !importLocked else { error = "Check the saved receipt before adding another original."; return }
    importBusy = true; error = nil
    let key = importSheetKey, epoch = googleEpoch
    defer { importBusy = false }
    do {
      let captured = try await SourceDocumentCapture.capture(url: url)
      guard key == importSheetKey, epoch == googleEpoch else { return }
      guard !draft.documents.contains(where: { $0.id == captured.id }) else {
        notice = "That original document is already in this review."; return
      }
      let encodedSize = draft.documents.reduce(0) { $0 + $1.byteLength * 4 / 3 + 4 }
        + draft.sources.reduce(0) { $0 + $1.text.utf8.count }
      guard draft.documents.count + draft.sources.count < 20,
        encodedSize + captured.byteLength * 4 / 3 + 4 < 9 * 1024 * 1024 else {
        throw KittyError.message("Use up to 20 originals in a smaller batch. This review is near its upload limit.")
      }
      draft.documents.append(captured)
      try saveDraft() // Original bytes are durable before PDF extraction or OCR starts.
      importState = "Original retained. Reading the document on this device…"
      let extracted = await SourceDocumentCapture.extract(captured)
      guard key == importSheetKey, epoch == googleEpoch,
        let index = draft.documents.firstIndex(where: { $0.id == captured.id }) else { return }
      draft.documents[index] = extracted
      try saveDraft()
      if extracted.mimeType == "text/csv", let engine {
        draft.sourceReviews.append(contentsOf: try SourceReviewDraft.suggestedCSV(
          document: extracted, context: sourceContext, engine: engine))
      }
      try saveDraft()
      prepareSourceImport()
      importState = "Original retained. Choose what it records and check the fields against the document."
    } catch { self.error = error.localizedDescription }
  }
  func retrySourceExtraction(_ id: String) async {
    guard !importLocked, let original = draft.documents.first(where: { $0.id == id }) else { return }
    importBusy = true
    let key = importSheetKey, epoch = googleEpoch
    defer { importBusy = false }
    let extracted = await SourceDocumentCapture.extract(original)
    guard key == importSheetKey, epoch == googleEpoch,
      let index = draft.documents.firstIndex(where: { $0.id == id }) else { return }
    draft.documents[index] = extracted
    // Existing reviewed field locators remain bound to original bytes, not a replacement OCR result.
    do { try saveDraft(); prepareSourceImport() } catch { self.error = error.localizedDescription }
  }
  func addSourceReview(documentID: String, kind: SourceRecordKind) {
    guard let document = draft.documents.first(where: { $0.id == documentID }) else { return }
    let review = SourceReviewDraft.suggested(document: document, kind: kind, context: sourceContext)
    editImport { $0.sourceReviews.append(review) }
  }
  func updateSourceReview(_ review: SourceReviewDraft) {
    editImport { draft in
      guard let index = draft.sourceReviews.firstIndex(where: { $0.id == review.id }) else { return }
      draft.sourceReviews[index] = review
    }
  }
  func removeSource(_ id: String) {
    editImport {
      $0.documents.removeAll { $0.id == id }
      $0.sourceReviews.removeAll { $0.documentID == id }
    }
  }
  func prepareSourceImport() {
    guard draft.remote == nil else { return }
    sourceProposal = nil; sourceProposalData = nil; sourceReviewNotice = nil
    guard !draft.documents.isEmpty else { return }
    guard sourceEvidenceValid, let engine, let sourceBaseline,
      sourceBaselineSheetID == importSheetKey else {
      sourceReviewNotice = "Refresh your Sheet's document evidence before reviewing these originals."
      return
    }
    do {
      guard draft.documents.allSatisfy({ document in draft.sourceReviews.contains { $0.documentID == document.id } }) else {
        sourceReviewNotice = "Choose what each original records, then check its fields."
        return
      }
      let records = try draft.sourceReviews.map { review -> [String: Any] in
        guard let document = draft.documents.first(where: { $0.id == review.documentID }) else {
          throw KittyError.message("A reviewed record is missing its original. Keep the review and select that original again.")
        }
        return try review.recordPayload(document: document, context: sourceContext)
      }
      let files = try draft.documents.map { try $0.payload() }
      let result = try engine.call("Records", method: "prepare", input: [
        "files": files, "records": records, "baseline": sourceBaseline,
        "review": ["acknowledged": draft.accepted],
      ])
      sourceProposal = try JSONDecoder().decode(SourceImportProposal.self, from: result)
      sourceProposalData = result
      if !emptySourceAccountsNeedingEvidence.isEmpty {
        let names = emptySourceAccountsNeedingEvidence.map { id in sourceContext.accounts.first { $0.id == id }?.name ?? id }
        sourceReviewNotice = "Add reviewed opening and closing statement balances for the empty exports: " + names.joined(separator: ", ") + "."
      }
    } catch { sourceReviewNotice = error.localizedDescription }
  }
  func acknowledgeSourceIssue(_ issue: SourceImportIssue) {
    guard issue.severity == "review", let key = issue.evidenceKey else { return }
    editImport { if !$0.accepted.contains(key) { $0.accepted.append(key) } }
  }
  func sourceWireProposal() throws -> [String: Any] {
    guard let data = sourceProposalData,
      let typed = try JSONSerialization.jsonObject(with: data) as? [String: Any],
      let records = typed["records"] as? [[String: Any]] else {
      throw KittyError.message("Review the document fields before saving.")
    }
    var wire: [String: Any] = ["records": records, "review": ["acknowledged": draft.accepted]]
    if !draft.sources.isEmpty, let proposalData,
      let csv = try JSONSerialization.jsonObject(with: proposalData) as? [String: Any] {
      wire["rows"] = csv["rows"] ?? []
      wire["decisions"] = draft.decisions
      wire["csvReview"] = csv["review"] ?? [:]
    }
    return wire
  }
  func sourceFilesForUpload() throws -> [[String: Any]] {
    var originals: [String: [String: Any]] = [:]
    for document in draft.documents { originals[document.id] = try document.payload() }
    for source in draft.sources {
      guard source.id == source.sha256 else { throw KittyError.message("A bank original changed. Select the original again before saving.") }
      // One original may serve both the transaction parser and a reviewed balance.
      // Retain its transaction mapping without sending the same bytes twice.
      var file = source.payload
      file["mimeType"] = "text/csv"
      file["byteLength"] = source.text.utf8.count
      if let document = originals[source.id], document["mimeType"] as? String != "text/csv" {
        throw KittyError.message("The same original has conflicting source types. Review it before saving.")
      }
      originals[source.id] = file
    }
    // The CSV parser binds overlap decisions to source-reference order. Preserve
    // the same bank-file order used by the on-device preview when sending it.
    var seen = Set<String>()
    let orderedIDs = (draft.sources.map(\.id) + draft.documents.map(\.id)).filter { seen.insert($0).inserted }
    return orderedIDs.compactMap { originals[$0] }
  }
  func restorePreparedProposal(_ remote: ImportRemoteBinding) throws {
    if remote.protocolVersion == 2 {
      guard let saved = try JSONSerialization.jsonObject(with: remote.proposal) as? [String: Any],
        saved["operation"] as? String == remote.operation,
        let local = saved["localReview"] else {
        throw KittyError.message("The saved source review cannot be reopened. Its receipt remains protected.")
      }
      let data = try JSONSerialization.data(withJSONObject: local)
      if remote.operation == "close" {
        closeProposal = try JSONDecoder().decode(PeriodCloseProposal.self, from: data)
        closeProposalData = data
      } else {
        sourceProposal = try JSONDecoder().decode(SourceImportProposal.self, from: data)
        sourceProposalData = data
        if let csv = saved["csvReviewResult"] {
          proposalData = try JSONSerialization.data(withJSONObject: csv)
          proposal = try JSONDecoder().decode(ImportProposal.self, from: proposalData!)
        }
      }
    } else {
      proposalData = remote.proposal
      proposal = try JSONDecoder().decode(ImportProposal.self, from: remote.proposal)
    }
  }
  func preparePeriodClose(periodEnd: String) async {
    guard !importLocked else { error = "Check the pending receipt before starting a month-end review."; return }
    guard SourceMoney.isDate(periodEnd) else { error = "Choose a valid period end."; return }
    if draft.closeReview?.periodEnd != periodEnd { draft.closeReview = PeriodCloseDraft(periodEnd: periodEnd) }
    closeProposal = nil; closeProposalData = nil
    do { try saveDraft() } catch { self.error = error.localizedDescription; return }
    guard await refreshImportEvidence(includeSources: true), draft.remote == nil else { return }
    draft.closeReview?.evidenceImportIds = acceptedSourceImportIDs
    do { try saveDraft(); try calculatePeriodClose() } catch { self.error = error.localizedDescription }
  }
  func calculatePeriodClose() throws {
    guard let review = draft.closeReview, let sourceBaseline, let engine,
      sourceEvidenceValid, sourceBaselineSheetID == importSheetKey else {
      throw KittyError.message("Refresh the Sheet and its saved source evidence before reviewing this month.")
    }
    let data = try engine.call("Close", method: "prepare", input: [
      "periodEnd": review.periodEnd, "baseline": sourceBaseline,
      "evidence": ["imports": acceptedSourceEvidence.filter { item in
        (item["importId"] as? String).map { review.evidenceImportIds.contains($0) } ?? false
      }], "review": review.decisions.payload,
    ])
    closeProposal = try JSONDecoder().decode(PeriodCloseProposal.self, from: data)
    closeProposalData = data
  }
  func updateCloseDecisions(_ decisions: CloseReviewDecisions) {
    guard !importLocked, draft.closeReview != nil else { return }
    draft.closeReview?.decisions = decisions
    do { try saveDraft(); try calculatePeriodClose() } catch {
      closeProposal = nil; closeProposalData = nil
      self.error = error.localizedDescription
    }
  }
}
