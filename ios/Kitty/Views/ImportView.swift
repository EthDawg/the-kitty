import SwiftUI
import UniformTypeIdentifiers

struct ImportView: View {
  @EnvironmentObject var store: KittyStore
  @Environment(\.dismiss) var dismiss
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  @State private var filePicker = false
  @State private var accountID = ""
  @State private var mappingSource: ImportSource?
  @State private var confirmSave = false
  @State private var confirmDiscard = false
  @State private var confirmCancel = false

  var body: some View {
    List {
      introduction
      if store.draft.remote != nil { recovery }
      sources.disabled(store.importLocked)
      SourceIntakeSection()
      if let proposal = store.proposal {
        review(proposal).disabled(store.importLocked)
        if store.draft.remote == nil && store.draft.documents.isEmpty { save(proposal) }
      }
      if !store.draft.documents.isEmpty { SourceSaveSection() }
      if let state = store.importState {
        Section { Text(state).font(.subheadline).accessibilityIdentifier("importState") }
      }
      if store.importCanDiscard && store.hasImportSources {
        Section {
          Button("Discard this local review", role: .destructive) { confirmDiscard = true }
        }
      }
    }
    .navigationTitle("Import your records").navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) {
        Button("Done") {
          do {
            try store.saveDraft()
            dismiss()
          } catch { store.error = error.localizedDescription }
        }
      }
    }
    .task {
      if store.draft.remote != nil {
        await store.checkImportStatus()
      } else if !store.isDemo {
        _ = await store.refreshImportEvidence(includeSources: true)
      }
    }
    .fileImporter(
      isPresented: $filePicker, allowedContentTypes: [.commaSeparatedText, .plainText],
      allowsMultipleSelection: true
    ) { result in
      switch result {
      case .success(let urls): for url in urls { store.addFile(url, accountID: accountID) }
      case .failure(let error): store.error = error.localizedDescription
      }
    }
    .sheet(item: $mappingSource) { source in NavigationStack { MappingView(source: source) } }
    .confirmationDialog(
      store.isDemo ? "Complete this practice import?" : "Save these reviewed rows?",
      isPresented: $confirmSave, titleVisibility: .visible
    ) {
      Button(store.isDemo ? "Complete practice" : "Save and verify") {
        Task { await store.commitImport() }
      }
    } message: {
      Text(
        "Only this reviewed proposal will be submitted. An uncertain outcome keeps the same receipt for checking."
      )
    }
    .confirmationDialog(
      "Discard this local review?", isPresented: $confirmDiscard, titleVisibility: .visible
    ) {
      Button("Discard review", role: .destructive) { store.discardImport() }
    } message: {
      Text(
        "This removes staged files and choices from this device. It does not delete Sheet records or completed receipts."
      )
    }
    .confirmationDialog(
      "Cancel the pending save?", isPresented: $confirmCancel, titleVisibility: .visible
    ) {
      Button("Cancel pending save") { Task { await store.cancelPreparedImport() } }
    } message: {
      Text(
        "The service must confirm that no write started. If it cannot, the receipt stays protected. Your originals stay available."
      )
    }
  }
  private var introduction: some View {
    Section {
      VStack(alignment: .leading, spacing: 10) {
        Text(
          "Add bank CSVs, payslips, valuations or statement balances. Check the original evidence before saving."
        )
        .font(.subheadline).foregroundStyle(KittyTheme.secondary)
      }.padding(.vertical, 8)
      if store.isDemo { Pill(title: "Practice with fictional data", symbol: "sparkles") }
      if store.importEvidenceLoading {
        ProgressView("Checking the current Sheet and earlier imports…")
      }
      if let note = store.importEvidenceNotice {
        Text(note).font(.caption).foregroundStyle(KittyTheme.warning)
      }
    }
  }
  private var recovery: some View {
    Section("Saved import") {
      Label("This review is protected while its outcome is checked.", systemImage: "lock.shield")
      Text(
        "Your original files and exact reviewed proposal are retained. Check this receipt to continue, even if the transactions already appear in your Sheet."
      )
      .font(.caption).foregroundStyle(KittyTheme.secondary)
      Button {
        Task { await store.checkImportStatus() }
      } label: {
        Label("Check saved receipt", systemImage: "arrow.clockwise")
      }.disabled(store.importBusy).accessibilityIdentifier("checkImportReceipt")
      if store.draft.remote?.status == "proposed", store.draft.remote?.recoveryOnly == false {
        Button("Continue this reviewed save") { Task { await store.commitImport() } }.disabled(
          store.importBusy)
      }
      Button("Cancel pending save and review again") { confirmCancel = true }.disabled(
        store.importBusy)
      if store.importBusy { ProgressView("Checking with your Sheet…") }
    }
  }
  private var sources: some View {
    Section {
      Menu {
        Picker("Account", selection: $accountID) {
          Text("Choose an account").tag("")
          ForEach(store.household?.accounts ?? []) { Text($0.name).tag($0.id) }
        }
      } label: {
        VStack(alignment: .leading, spacing: 6) {
          Text("Account").font(.caption).foregroundStyle(KittyTheme.secondary)
          HStack(alignment: .firstTextBaseline) {
            Text(selectedAccountName).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 8)
            Image(systemName: "chevron.up.chevron.down").font(.caption)
          }
        }.frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
          .contentShape(Rectangle())
      }.accessibilityLabel("Account").accessibilityValue(selectedAccountName)
        .accessibilityIdentifier("importAccount")
      Button {
        filePicker = true
      } label: {
        Label("Choose CSV files", systemImage: "doc.badge.plus")
          .font(.body).fixedSize(horizontal: false, vertical: true)
          .frame(minHeight: 44, alignment: .leading)
      }
      .disabled(accountID.isEmpty || store.importBusy).accessibilityIdentifier("chooseCSV")
      if store.isDemo {
        Button {
          store.sampleImport()
        } label: {
          Label("Try a sample statement", systemImage: "sparkles")
            .font(.body).fixedSize(horizontal: false, vertical: true)
            .frame(minHeight: 44, alignment: .leading)
        }
        .accessibilityIdentifier("sampleImport")
      }
      ForEach(store.draft.sources) { source in
        VStack(alignment: .leading, spacing: 8) {
          Label(source.name, systemImage: "doc.text").font(.subheadline.bold())
          Text(
            store.household?.accounts.first { $0.id == source.accountId }?.name ?? source.accountId
          )
          .font(.caption).foregroundStyle(KittyTheme.secondary)
          HStack {
            Button("Check column mapping") { mappingSource = source }.font(.caption)
            Spacer()
            Button(role: .destructive) {
              store.editImport { $0.sources.removeAll { $0.id == source.id } }
            } label: {
              Image(systemName: "xmark.circle")
            }.accessibilityLabel("Remove \(source.name)")
          }
        }
      }
    } header: {
      Text("1 · Choose your statement").font(.subheadline.weight(.semibold))
        .foregroundStyle(KittyTheme.secondary).fixedSize(horizontal: false, vertical: true)
    }
  }
  private var selectedAccountName: String {
    store.household?.accounts.first(where: { $0.id == accountID })?.name ?? "Choose an account"
  }
  private func review(_ proposal: ImportProposal) -> some View {
    Section("2 · Review what we found") {
      Label("\(proposal.rows.count) new transactions", systemImage: "list.bullet.rectangle")
      if let counts = proposal.counts {
        if counts.existing > 0, proposal.noOpMessage == nil { Text("\(counts.existing) already recorded").font(.caption) }
        if counts.pending > 0 {
          Text("\(counts.pending) pending transaction\(counts.pending == 1 ? "" : "s") left out")
            .font(.caption)
        }
      }
      if let message = proposal.noOpMessage {
        Text(message).font(.subheadline).accessibilityIdentifier("importNoOp")
      }
      ForEach(proposal.issues) { issue in issueView(issue, proposal: proposal) }
      ForEach(proposal.rows) { row in rowView(row, proposal: proposal) }
    }
  }
  private func issueView(_ issue: ImportIssue, proposal: ImportProposal) -> some View {
    VStack(alignment: .leading, spacing: 10) {
      Label(
        issue.message,
        systemImage: issue.severity == "error" ? "exclamationmark.octagon" : "questionmark.circle"
      )
      .font(.subheadline.weight(.semibold))
      Text(issue.recovery).font(.caption).foregroundStyle(KittyTheme.secondary)
      if issue.needsCategory {
        ForEach(issue.rowIds ?? [], id: \.self) { id in
          Button("Leave this transaction uncategorised for later") {
            store.chooseImportCategory(
              rowID: candidate(id, proposal: proposal)?.decisionID ?? id, categoryID: "UNCAT")
          }
          .font(.caption).buttonStyle(.bordered)
          .accessibilityIdentifier("importUncategorised-\(id)")
        }
      } else if issue.needsDuplicateChoice {
        ForEach(issue.rowIds ?? [], id: \.self) { id in
          if let row = candidate(id, proposal: proposal) {
            Text(
              "\(niceDate(row.date)) · \(row.description) · \(money(row.amount, currency: store.currency))"
            )
            .font(.caption).monospacedDigit()
          }
          Button("Already recorded — leave this out") {
            store.chooseImportDuplicate(rowID: id, keep: false)
          }
          .font(.caption).buttonStyle(.bordered)
          Button("Separate real charge — include it") {
            store.chooseImportDuplicate(rowID: id, keep: true)
          }
          .font(.caption).buttonStyle(.bordered)
        }
      } else if issue.severity == "review", issue.requiresDecision != true {
        Button(acknowledgementTitle(issue.code)) { store.acknowledgeImport(issue) }
          .font(.caption).buttonStyle(.bordered)
          .accessibilityIdentifier("importAcknowledge-\(issue.code)-\(issue.id)")
        if issue.code == "overlap-review", let id = issue.rowIds?.first,
          let row = candidate(id, proposal: proposal)
        {
          ForEach(Array((row.sourceRefs ?? []).dropFirst()), id: \.key) { ref in
            Button("Keep row \(ref.row) from \(sourceName(ref.fileId)) as a separate charge") {
              store.keepDistinctSource(ref)
            }
            .font(.caption).buttonStyle(.bordered)
          }
        }
      }
    }.padding(.vertical, 6)
  }
  private func candidate(_ id: String, proposal: ImportProposal) -> ImportRow? {
    proposal.rows.first { $0.id == id } ?? proposal.duplicates?.first { $0.rowId == id }?.candidate
  }
  private func sourceName(_ id: String) -> String {
    store.draft.sources.first { $0.id == id }?.name ?? "the other export"
  }
  private func acknowledgementTitle(_ code: String) -> String {
    switch code {
    case "overlap-review": return "These exports overlap — count this once"
    case "repeated-charge": return "I checked: these repeated charges are real"
    case "distinct-source": return "This source row is a separate real charge"
    case "refund-review": return "The chosen category is right for this refund"
    case "transfer-review": return "Keep this as a transfer; pairing still needs checking"
    case "balance-partial", "balance-order":
      return "I checked the statement; keep this limitation visible"
    default: return "I reviewed this evidence and accept the stated limitation"
    }
  }
  private func rowView(_ row: ImportRow, proposal: ImportProposal) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      (dynamicTypeSize.isAccessibilitySize
        ? AnyLayout(VStackLayout(alignment: .leading, spacing: 6))
        : AnyLayout(HStackLayout(alignment: .firstTextBaseline))) {
        Text(row.displayMerchant).font(.subheadline.bold())
          .fixedSize(horizontal: false, vertical: true)
        if !dynamicTypeSize.isAccessibilitySize { Spacer() }
        Text(money(row.amount, currency: store.currency)).font(.subheadline.bold())
          .monospacedDigit().lineLimit(1).minimumScaleFactor(0.7)
      }
      Text("\(niceDate(row.date)) · \(row.description)").font(.caption).foregroundStyle(
        KittyTheme.secondary)
      Picker(
        "Category",
        selection: Binding(
          get: {
            store.draft.categories[row.decisionID]
              ?? (row.categoryId == "UNCAT" ? "" : row.categoryId ?? "")
          },
          set: { store.chooseImportCategory(rowID: row.decisionID, categoryID: $0) }
        )
      ) {
        Text("Choose a category").tag("")
        ForEach(store.household?.categories ?? []) { Text($0.name).tag($0.id) }
      }.font(.caption)
        .accessibilityIdentifier("importCategory-\(row.decisionID)")
    }.padding(.vertical, 5)
  }
  private func save(_ proposal: ImportProposal) -> some View {
    Section("3 · Save and verify") {
      Text(
        store.isDemo
          ? "This practice saves the original files and a checked receipt on this device. It won’t change a Google Sheet."
          : "Originals and a receipt stay in your Google Drive. Completion confirms the saved input rows, not a whole-month reconciliation."
      )
      .font(.caption).foregroundStyle(KittyTheme.secondary)
      Button {
        confirmSave = true
      } label: {
        if store.importBusy {
          ProgressView("Checking your import…")
        } else {
          Label(
            proposal.noOpMessage != nil ? "Nothing to add" : store.isDemo ? "Complete practice import" : "Save to my Sheet",
            systemImage: "checkmark.shield")
        }
      }.disabled(!proposal.canCommit || store.importBusy || store.importEvidenceLoading || (!store.isDemo && !store.sheetCanEdit))
        .opacity(proposal.canCommit ? 1 : 0.5)
        .accessibilityIdentifier("saveImport")
      if !store.isDemo && !store.sheetCanEdit {
        Text("This account has view-only access. Ask the Sheet owner for edit access before saving; your review stays on this device.")
          .font(.caption).foregroundStyle(KittyTheme.secondary)
      }
      if !proposal.canCommit && !proposal.rows.isEmpty {
        Text("Resolve the questions above before saving.").font(.caption).foregroundStyle(
          KittyTheme.warning)
      }
    }
  }
}

struct MappingView: View {
  @EnvironmentObject var store: KittyStore
  @Environment(\.dismiss) var dismiss
  let source: ImportSource
  @State private var headers: [String] = []
  @State private var sample: [[String]] = []
  @State private var dateColumn = ""
  @State private var descriptionColumn = ""
  @State private var amountColumn = ""
  @State private var debitColumn = ""
  @State private var creditColumn = ""
  @State private var statusColumn = ""
  @State private var balanceColumn = ""
  @State private var providerColumn = ""
  @State private var accountColumn = ""
  @State private var mappedAccountID = ""
  @State private var order = ""
  @State private var sign = ""
  @State private var separate = false
  @State private var error: String?
  private var knownStatusHeader: String? {
    headers.first { ["status", "transaction status", "posting status"].contains($0.lowercased()) }
  }
  private var mappingIncomplete: Bool {
    dateColumn.isEmpty || descriptionColumn.isEmpty || order.isEmpty || sign.isEmpty
      || (separate ? debitColumn.isEmpty || creditColumn.isEmpty : amountColumn.isEmpty)
      || (knownStatusHeader != nil && statusColumn.isEmpty)
  }
  var body: some View {
    Form {
      Section {
        Text(source.name).font(.headline)
        Text(
          "Confirm what the columns mean. Pending rows stay out; original descriptions and transaction IDs stay attached to the evidence."
        ).font(.subheadline)
      }
      Section("Transaction columns") {
        Picker("Sheet account", selection: $mappedAccountID) {
          ForEach(store.household?.accounts ?? []) { Text($0.name).tag($0.id) }
        }
        column("Date", selection: $dateColumn)
        column("Bank description", selection: $descriptionColumn)
        Toggle("Separate debit and credit columns", isOn: $separate)
        if separate {
          column("Debit", selection: $debitColumn)
          column("Credit", selection: $creditColumn)
        } else {
          column("Amount", selection: $amountColumn)
        }
      }
      Section("Evidence columns, when supplied") {
        column("Posting status", selection: $statusColumn, optional: true)
        if knownStatusHeader != nil && statusColumn.isEmpty {
          Text(
            "This export includes posting status. Select it so pending transactions aren't imported as settled."
          ).font(.caption).foregroundStyle(KittyTheme.warning)
        }
        column("Running balance", selection: $balanceColumn, optional: true)
        column("Provider transaction ID", selection: $providerColumn, optional: true)
        column("Account number", selection: $accountColumn, optional: true)
      }
      Section("Confirm the conventions") {
        Picker("Date order", selection: $order) {
          Text("Choose").tag("")
          Text("Day / month / year").tag("dmy")
          Text("Month / day / year").tag("mdy")
          Text("ISO: year-month-day").tag("ymd")
        }
        Picker(separate ? "Debit values" : "Positive amounts mean", selection: $sign) {
          Text("Choose").tag("")
          Text(separate ? "Positive numbers" : "Money coming in").tag("money-in-positive")
          Text(separate ? "Negative numbers" : "Charges / money going out").tag("charges-positive")
        }
      }
      if !sample.isEmpty {
        Section("Check against your original") {
          ForEach(Array(sample.enumerated()), id: \.offset) { _, values in
            VStack(alignment: .leading, spacing: 4) {
              Text(value(descriptionColumn, in: values)).font(.subheadline.weight(.medium))
              Text("Date: \(value(dateColumn, in: values))").font(.caption)
              Text(
                separate
                  ? "Debit: \(value(debitColumn, in: values)) · Credit: \(value(creditColumn, in: values))"
                  : "Amount: \(value(amountColumn, in: values))"
              ).font(.caption)
              if !statusColumn.isEmpty {
                Text("Status: \(value(statusColumn, in: values))").font(.caption)
              }
            }
          }
        }
      }
      if let error { Text(error).foregroundStyle(.red) }
      Section {
        Button("Confirm mapping", action: confirm).disabled(mappingIncomplete || store.importLocked)
      }
    }.navigationTitle("Column mapping").navigationBarTitleDisplayMode(.inline)
      .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
      .onAppear(perform: load)
  }
  private func confirm() {
    var mapping = ["date": dateColumn, "description": descriptionColumn, "dateOrder": order]
    if separate {
      mapping["debit"] = debitColumn
      mapping["credit"] = creditColumn
      mapping["debitSign"] = sign == "charges-positive" ? "negative" : "positive"
    } else {
      mapping["amount"] = amountColumn
      mapping["sign"] = sign
    }
    for (key, value) in [
      ("status", statusColumn), ("balance", balanceColumn), ("providerId", providerColumn),
      ("account", accountColumn),
    ] where !value.isEmpty { mapping[key] = value }
    store.editImport { draft in
      if let index = draft.sources.firstIndex(where: { $0.id == source.id }) {
        draft.sources[index].mapping = mapping
        draft.sources[index].accountId = mappedAccountID
      }
    }
    if store.error == nil { dismiss() }
  }
  private func load() {
    do {
      guard let engine = store.engine,
        let parsed = try JSONSerialization.jsonObject(
          with: engine.call("KittyImport", method: "parseCSV", input: source.text))
          as? [String: Any]
      else { return }
      headers = parsed["headers"] as? [String] ?? []
      mappedAccountID = source.accountId
      sample = Array((parsed["records"] as? [[String: Any]] ?? []).prefix(3)).compactMap {
        $0["values"] as? [String]
      }
      var suggested = source.mapping ?? [:]
      if suggested.isEmpty,
        let detected = try? JSONSerialization.jsonObject(
          with: engine.call("KittyImport", method: "detectFormat", input: headers))
          as? [String: Any]
      {
        suggested = detected.compactMapValues { $0 as? String }
      }
      func guess(_ key: String, _ names: [String]) -> String {
        suggested[key] ?? headers.first { names.contains($0.lowercased()) } ?? ""
      }
      dateColumn = guess("date", ["date", "transaction date", "posted date"])
      descriptionColumn = guess("description", ["description", "narrative", "bank description"])
      amountColumn = guess("amount", ["amount"])
      debitColumn = guess("debit", ["debit", "debit amount"])
      creditColumn = guess("credit", ["credit", "credit amount"])
      separate =
        suggested["debit"] != nil
        || (amountColumn.isEmpty && !debitColumn.isEmpty && !creditColumn.isEmpty)
      statusColumn = guess("status", ["status", "posting status", "transaction status"])
      balanceColumn = guess("balance", ["balance", "running balance"])
      providerColumn = guess(
        "providerId", ["transaction id", "transaction_id", "provider transaction id"])
      accountColumn = guess("account", ["bank account", "account #", "account number"])
      order = suggested["dateOrder"] ?? ""
      sign =
        suggested["sign"]
        ?? (suggested["debitSign"] == "positive"
          ? "money-in-positive" : suggested["debitSign"] == "negative" ? "charges-positive" : "")
    } catch { self.error = error.localizedDescription }
  }
  private func value(_ column: String, in row: [String]) -> String {
    guard let index = headers.firstIndex(of: column), row.indices.contains(index) else {
      return "Choose a column"
    }
    return row[index].isEmpty ? "—" : row[index]
  }
  private func column(_ title: String, selection: Binding<String>, optional: Bool = false)
    -> some View
  {
    Picker(title, selection: selection) {
      Text(optional ? "Not supplied" : "Choose a column").tag("")
      ForEach(headers, id: \.self) { Text($0).tag($0) }
    }
  }
}
