import SwiftUI
import UniformTypeIdentifiers

struct ActivityView: View {
  @EnvironmentObject var store: KittyStore
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  @State private var query = ""
  @State private var filter = "All"
  @State private var exportReview: ActivityExportReview?
  @State private var exportError: String?
  var transactions: [KittyTransaction] {
    (store.household?.transactions ?? []).filter { tx in
      (filter == "All" || (filter == "Needs a category" ? tx.cat == "UNCAT" : tx.flow == filter))
        && (query.isEmpty
          || [tx.merchant, tx.desc, tx.catName, tx.person, tx.date].joined(separator: " ")
            .localizedCaseInsensitiveContains(query))
    }
  }
  var body: some View {
    List {
      Section {
        DataStatusView()
        Picker("Show", selection: $filter) {
          Text("All").tag("All")
          Text("Spending").tag("Expense")
          Text("Income").tag("Income")
          Text("Needs a category").tag("Needs a category")
        }.pickerStyle(.menu)
        if !query.isEmpty {
          // Active native search hides trailing navigation items. Keep export
          // beside the filtered results so the current query remains intact.
          Button { prepareExport() } label: {
            Label("Export these results", systemImage: "square.and.arrow.up")
              .fixedSize(horizontal: false, vertical: true)
          }.disabled(transactions.isEmpty).accessibilityIdentifier("activityExportResults")
        }
      }
      if transactions.isEmpty {
        EmptyState(
          title: "Nothing here just yet",
          message: query.isEmpty
            ? "Import a statement to see your activity."
            : "Try a merchant, category, person or date.", symbol: "magnifyingglass")
      }
      ForEach(transactions) { tx in
        NavigationLink {
          TransactionDetailView(transaction: tx)
        } label: {
          TransactionRow(transaction: tx, currency: store.currency)
        }.listRowBackground(KittyTheme.surface)
      }
      if !transactions.isEmpty {
        Text("\(transactions.count) transactions · Transfers are kept separate from spending.")
          .font(.caption).foregroundStyle(KittyTheme.secondary)
      }
    }.scrollContentBackground(.hidden).kittyBackground().navigationTitle("Activity")
      .navigationBarTitleDisplayMode(dynamicTypeSize.isAccessibilitySize ? .inline : .large)
      .searchable(text: $query, prompt: "Search activity").accessibilityIdentifier(
        "activityList"
      )
      .toolbar {
        ToolbarItem(placement: .topBarTrailing) {
          Button {
            prepareExport()
          } label: {
            Image(systemName: "square.and.arrow.up")
          }
          .disabled(transactions.isEmpty)
          .accessibilityLabel("Export filtered activity")
          .accessibilityHint("Review and save the \(transactions.count) transactions currently shown as CSV.")
          .accessibilityIdentifier("activityExportButton")
        }
        ToolbarItem(placement: .topBarTrailing) {
          Button {
            store.showImport = true
          } label: {
            Image(systemName: "plus")
          }.accessibilityLabel("Import statement")
        }
      }
      .sheet(item: $exportReview) { review in
        ActivityExportView(review: review).kittyFeedback()
      }
      .alert("Export unavailable", isPresented: Binding(
        get: { exportError != nil }, set: { if !$0 { exportError = nil } }
      )) {
        Button("OK", role: .cancel) { exportError = nil }
      } message: {
        Text(exportError ?? "The activity could not be exported.")
      }
  }

  private func prepareExport() {
    // Capture the displayed filter result once. Export review cannot silently switch rows
    // while a search changes or the household refreshes in the background.
    let selected = transactions
    do {
      let accounts = store.household?.accounts ?? []
      let rows = selected.map { tx in
        ActivityCSVExport.Row(
          id: tx.id, date: tx.date, accountID: tx.acct, bankDescription: tx.desc,
          merchant: tx.merchant, amount: tx.amount, categoryName: tx.catName, person: tx.person,
          accountName: accounts.first(where: { $0.id == tx.acct })?.name ?? tx.acct,
          categoryID: tx.cat, flow: tx.flow, note: tx.note, receipt: tx.receipt,
          currency: store.currency)
      }
      exportReview = ActivityExportReview(
        export: try ActivityCSVExport.make(rows: rows), filter: filter, query: query,
        household: store.household?.household ?? "The Kitty", isDemo: store.isDemo)
    } catch {
      exportError = error.localizedDescription
    }
  }
}

private struct ActivityExportReview: Identifiable {
  let id = UUID()
  let export: ActivityCSVExport.Export
  let filter, query, household: String
  let isDemo: Bool
}

private struct ActivityExportView: View {
  @Environment(\.dismiss) private var dismiss
  let review: ActivityExportReview
  @State private var showFileExporter = false
  @State private var notice: String?
  @State private var error: String?

  var body: some View {
    NavigationStack {
      Form {
        Section("This Activity view") {
          Text("\(review.export.rowCount) transactions").font(.headline)
            .accessibilityIdentifier("activityExportCount")
          Text(review.isDemo ? "Fictional practice data · \(review.household)" : review.household)
          LabeledContent("Filter", value: review.filter)
          if !review.query.isEmpty { LabeledContent("Search", value: review.query) }
          Text("The CSV contains exactly these rows in their displayed order, including original descriptions, account and category IDs, people, amounts, flow and notes.")
            .font(.subheadline).foregroundStyle(KittyTheme.secondary)
        }
        Section("Spreadsheet-safe text") {
          Text("Text that could be treated as a spreadsheet formula is protected with a leading apostrophe. Amounts stay numeric.")
            .font(.subheadline)
            .accessibilityIdentifier("activityExportProtectionNotice")
          Text("\(review.export.protectedCellCount) text cells need this protection.")
            .font(.caption).foregroundStyle(KittyTheme.secondary)
          DisclosureGroup("Export format details") {
            Text("Formula-like text, leading control characters and existing leading apostrophes get one added apostrophe ('). The remaining text is unchanged. For raw CSV processing, remove the first apostrophe from exported text cells that begin with it to recover the original value. The CSV uses UTF-8, ISO dates and exact two-decimal amounts; your Sheet is unchanged.")
              .font(.subheadline).foregroundStyle(KittyTheme.secondary)
              .padding(.vertical, 4)
          }.accessibilityIdentifier("activityExportFormatDetails")
        }
        Section {
          Button {
            notice = nil
            error = nil
            showFileExporter = true
          } label: {
            Label("Save CSV", systemImage: "square.and.arrow.down")
              .frame(maxWidth: .infinity, minHeight: 44)
          }
          .buttonStyle(.borderless)
          .accessibilityIdentifier("activityExportSave")
          if let notice {
            Text(notice).foregroundStyle(KittyTheme.positive)
              .accessibilityIdentifier("activityExportResult")
          }
          if let error { Text(error).foregroundStyle(KittyTheme.warning) }
        }
      }
      .scrollContentBackground(.hidden).kittyBackground()
      .navigationTitle("Export activity").navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .confirmationAction) {
          Button("Done") { dismiss() }.accessibilityIdentifier("activityExportDone")
        }
      }
      .fileExporter(
        isPresented: $showFileExporter,
        document: ActivityCSVDocument(data: review.export.data),
        contentType: .commaSeparatedText, defaultFilename: review.export.filename
      ) { result in
        switch result {
        case .success:
          notice = "CSV saved."
          error = nil
        case .failure(let failure):
          let cocoa = failure as NSError
          if cocoa.domain != NSCocoaErrorDomain || cocoa.code != NSUserCancelledError {
            error = "The CSV could not be saved. \(failure.localizedDescription)"
          }
        }
      }
    }
  }
}

/// FileDocument keeps bytes in memory until the user chooses a destination. The system owns
/// export staging/cleanup; this view creates no persistent cache or app-owned temporary file.
private struct ActivityCSVDocument: FileDocument {
  static var readableContentTypes: [UTType] { [.commaSeparatedText] }
  let data: Data

  init(data: Data) { self.data = data }

  init(configuration: ReadConfiguration) throws {
    guard let data = configuration.file.regularFileContents else {
      throw CocoaError(.fileReadCorruptFile)
    }
    self.data = data
  }

  func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
    let wrapper = FileWrapper(regularFileWithContents: data)
    #if os(iOS)
      wrapper.fileAttributes[FileAttributeKey.protectionKey.rawValue] = FileProtectionType.complete.rawValue
    #endif
    return wrapper
  }
}

struct TransactionRow: View {
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  let transaction: KittyTransaction
  let currency: String
  var body: some View {
    (dynamicTypeSize.isAccessibilitySize
      ? AnyLayout(VStackLayout(alignment: .leading, spacing: 10))
      : AnyLayout(HStackLayout(spacing: 12))) {
      if !dynamicTypeSize.isAccessibilitySize {
        Image(systemName: transaction.symbol).font(.body).foregroundStyle(KittyTheme.accent).frame(
          width: 42, height: 42
        ).background(KittyTheme.soft, in: RoundedRectangle(cornerRadius: 13)).accessibilityHidden(
          true)
      }
      VStack(alignment: .leading, spacing: 5) {
        Text(transaction.merchant).font(.subheadline.weight(.semibold))
          .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 2)
        Text("\(transaction.catName) · \(niceDate(transaction.date))").font(.caption)
          .foregroundStyle(KittyTheme.secondary)
          .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 2)
      }
      if !dynamicTypeSize.isAccessibilitySize { Spacer(minLength: 6) }
      Text(money(transaction.amount, currency: currency)).font(.subheadline.weight(.semibold))
        .monospacedDigit().foregroundStyle(
          transaction.flow == "Income" ? KittyTheme.positive : KittyTheme.ink
        ).lineLimit(1).minimumScaleFactor(0.7)
        .fixedSize(horizontal: !dynamicTypeSize.isAccessibilitySize, vertical: false)
    }.padding(.vertical, 5).accessibilityElement(children: .combine).accessibilityIdentifier(
      "transactionRow.\(transaction.id)")
  }
}
struct TransactionDetailView: View {
  @EnvironmentObject var store: KittyStore
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  let transaction: KittyTransaction
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 22) {
        VStack(spacing: 14) {
          Image(systemName: transaction.symbol).font(.largeTitle).padding(24).background(
            KittyTheme.soft, in: Circle())
          Text(transaction.merchant).font(.title2.bold()).multilineTextAlignment(.center)
          Text(money(transaction.amount, currency: store.currency)).font(
            .system(.largeTitle, design: .rounded, weight: .semibold)
          ).monospacedDigit()
          Text(niceDate(transaction.date)).foregroundStyle(KittyTheme.secondary)
        }.frame(maxWidth: .infinity).padding(.vertical, 16)
        KittyCard {
          detail("Category", value: transaction.catName)
          Divider()
          detail(
            "Account",
            value: store.household?.accounts.first { $0.id == transaction.acct }?.name
              ?? transaction.acct)
          Divider()
          detail("Person", value: transaction.person)
          Divider()
          detail("Movement", value: transaction.flow)
        }
        KittyCard {
          SectionTitle(title: "From the original record")
          Text(transaction.desc).font(.body.monospaced()).textSelection(.enabled)
          Text("Transaction \(transaction.id)").font(.caption).foregroundStyle(KittyTheme.secondary)
          if !transaction.note.isEmpty { Text(transaction.note).font(.subheadline) }
          SourceLink(label: "Transactions tab", range: "Transactions!A:J")
        }.accessibilityIdentifier("transactionEvidence")
        if transaction.cat == "UNCAT" {
          Text("This transaction still needs a category. Its source description is preserved.")
            .font(.subheadline).foregroundStyle(KittyTheme.warning)
        }
        Button {
          store.askTransactionID = transaction.id
          store.askQuestion = "Help me understand this transaction."
          store.selectedTab = 4
        } label: {
          Label("Ask about this transaction", systemImage: "bubble.left.and.bubble.right").frame(
            maxWidth: .infinity, minHeight: 44)
        }
      }.padding(20).frame(maxWidth: 650)
    }.frame(maxWidth: .infinity).kittyBackground().navigationTitle("Transaction")
      .navigationBarTitleDisplayMode(.inline)
  }

  @ViewBuilder private func detail(_ label: String, value: String) -> some View {
    if dynamicTypeSize.isAccessibilitySize {
      VStack(alignment: .leading, spacing: 6) {
        Text(label).font(.subheadline).foregroundStyle(KittyTheme.secondary)
        Text(value).fixedSize(horizontal: false, vertical: true)
      }.frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    } else {
      LabeledContent(label, value: value)
    }
  }
}
