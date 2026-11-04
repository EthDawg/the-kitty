import Foundation

extension KittyStore {
  func commitSourceImport(operation: String) async {
    guard !busy, !importBusy, !setupBusy, !inputEditBusy, !goalBusy, !disconnecting else { return }
    if draft.remote == nil, inputEditsBlockNewWrites, !isDemo {
      error = "Check the saved Sheet edit in Settings before saving another change."
      return
    }
    if draft.remote == nil, goalWritesBlocked, !isDemo {
      error = "Check the saved goal in Goals before saving another change."
      return
    }
    guard ["ingest", "close"].contains(operation) else { error = "This saved review has an unsupported operation."; return }
    if draft.remote == nil, let message = importPublicationNotice {
      error = message
      return
    }
    guard isDemo || sheetCanEdit || draft.remote != nil else {
      error = "This Google account can view the Sheet but cannot save this review. Your originals are preserved."
      return
    }
    importBusy = true; error = nil
    defer { importBusy = false }
    do {
      if isDemo {
        guard operation == "ingest" else {
          throw KittyError.message("Month-end checks are a preview in the fictional demo. Connect your own Sheet to close a month.")
        }
        try completeSourcePractice()
        return
      }
      guard let endpoint = serviceURL, !selectedSheetID.isEmpty else {
        throw KittyError.message("Secure saving isn't connected in this build. Your originals and field review remain on this device.")
      }
      if draft.remote == nil {
        let oldData = operation == "close" ? closeProposalData : sourceProposalData
        guard let oldData,
          operation == "close" ? closeProposal?.canClose == true : sourceImportCanCommit else {
          throw KittyError.message("Resolve the review questions before saving.")
        }
        let oldCSV = proposalData
        guard await refreshImportEvidence(includeSources: true) else {
          if draft.remote != nil { return }
          throw KittyError.message("The current Sheet and source evidence could not be checked. Your review is preserved.")
        }
        if let message = importPublicationNotice { throw KittyError.message(message) }
        if operation == "close" { try calculatePeriodClose() }
        let freshData = operation == "close" ? closeProposalData : sourceProposalData
        guard let freshData,
          operation == "close" ? closeProposal?.canClose == true : sourceImportCanCommit else {
          throw KittyError.message("The refreshed Sheet needs another review. Check the questions above.")
        }
        guard ImportSource.digest(oldData) == ImportSource.digest(freshData),
          operation == "close" || oldCSV == proposalData else {
          throw KittyError.message("The current Sheet changed this proposal. Review the refreshed results before saving.")
        }
        let wire: [String: Any]
        if operation == "close" {
          guard let close = draft.closeReview else { throw KittyError.message("Review the month before closing it.") }
          wire = close.payload
        } else { wire = try sourceWireProposal() }
        let files = operation == "close" ? [] : try sourceFilesForUpload()
        var saved: [String: Any] = ["protocolVersion": 2, "operation": operation,
          "proposal": wire, "localReview": try JSONSerialization.jsonObject(with: freshData)]
        if operation == "ingest", let proposalData {
          saved["csvReviewResult"] = try JSONSerialization.jsonObject(with: proposalData)
        }
        let savedData = try JSONSerialization.data(withJSONObject: saved, options: [.sortedKeys])
        try saveDraft()
        let localDigest = try draft.contentDigest(sheetID: selectedSheetID)
        let client = ImportServiceClient(baseURL: endpoint, token: try await google.accessToken())
        let receipt = try await client.prepareSources(sheetID: selectedSheetID, operation: operation,
          proposal: wire, files: files, version: household?.sheetVersion ?? 1)
        draft.remote = ImportRemoteBinding(id: receipt.importId, sheetID: selectedSheetID,
          proposalDigest: receipt.proposalDigest, localDraftDigest: localDigest, proposal: savedData,
          attempted: false, status: "proposed", protocolVersion: 2, operation: operation)
        try saveDraft() // This exact identity must survive a termination before any write is attempted.
      }
      guard var binding = draft.remote, binding.protocolVersion == 2, binding.operation == operation,
        try binding.matches(draft: draft, sheetID: selectedSheetID) else {
        throw KittyError.message("The protected receipt no longer matches this review. Check or cancel it before continuing.")
      }
      let client = ImportServiceClient(baseURL: endpoint, token: try await google.accessToken())
      let before = try await client.status(sheetID: selectedSheetID, id: binding.id)
      guard before.proposalDigest == binding.proposalDigest,
        before.protocolVersion == 2, before.operation == operation else {
        throw KittyError.message("The saved receipt changed. Nothing further was submitted.")
      }
      if before.status != "proposed" { try await handleImportResult(before); return }
      binding.attempted = true; binding.status = "unknown"
      draft.remote = binding
      try saveDraft()
      importState = operation == "close" ? "Closing the month and checking the Sheet again…" : "Saving reviewed records and checking their originals…"
      let result = try await client.commit(sheetID: selectedSheetID, id: binding.id)
      try await handleImportResult(result)
    } catch {
      do {
        if let failure = error as? ImportServiceFailure,
          try recoverImportHold(from: failure, sheetID: selectedSheetID) {
          self.error = failure.localizedDescription
          return
        }
      } catch {
        self.error = error.localizedDescription
        importState = "The earlier receipt is protected in memory. Preserve this review before closing the app."
        return
      }
      self.error = error.localizedDescription
      importState = draft.remote == nil ? "Your review is preserved. No save has been confirmed."
        : "Not yet verified. Check this saved receipt before changing the review."
    }
  }
  func completeSourcePractice() throws {
    guard loadDemoImportEvidence(), loadDemoSourceEvidence() else {
      throw KittyError.message("Earlier practice evidence could not be verified. The originals are preserved.")
    }
    prepareImport()
    guard sourceImportCanCommit, let result = sourceProposalData, let checked = sourceProposal else {
      throw KittyError.message("Review the document fields and transaction questions before completing practice.")
    }
    let rows = proposal?.rows.count ?? 0
    let receipt = try DemoSourceReceipt.make(documents: draft.documents, reviews: draft.sourceReviews,
      result: result, csvSources: draft.sources, csvProposal: rows > 0 ? proposalData : nil)
    try saveDraft()
    let url = importStorage.appendingPathComponent("practice-sources-\(receipt.id).json")
    try persistImport(JSONEncoder().encode(receipt), at: url)
    let readback = try JSONDecoder().decode(DemoSourceReceipt.self, from: Data(contentsOf: url))
    _ = try readback.validatedRecords(); _ = try readback.validatedRows()
    guard loadDemoImportEvidence(), loadDemoSourceEvidence() else {
      throw KittyError.message("The receipt was saved but its evidence could not be reloaded. Keep the originals and check again.")
    }
    prepareImport()
    importState = "Practice complete: \(rows + checked.newCount) records and \(checked.evidenceCount) statement evidence items were saved and read back on this device. Your Google Sheet was not changed."
  }
}
