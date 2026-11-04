import SwiftUI
import UniformTypeIdentifiers

struct SourceIntakeSection: View {
  @EnvironmentObject var store: KittyStore
  @State private var chooseDocument = false
  var body: some View {
    Section {
      Text("Keep the original PDF or CSV, then review each payslip, valuation or statement balance. Scanned PDFs are read on this device.")
        .font(.caption).foregroundStyle(KittyTheme.secondary)
      Button { chooseDocument = true } label: {
        Label("Choose a source document", systemImage: "doc.viewfinder")
          .font(.body).fixedSize(horizontal: false, vertical: true)
          .frame(minHeight: 44, alignment: .leading)
      }.disabled(store.importLocked).accessibilityIdentifier("chooseSourceDocument")
      if store.isDemo {
        Button {
          Task {
            guard let url = Bundle.main.url(forResource: "source-payslip-ytd", withExtension: "pdf") else { return }
            await store.captureSource(url)
            if let doc = store.draft.documents.first(where: { $0.name == url.lastPathComponent }),
              !store.draft.sourceReviews.contains(where: { $0.documentID == doc.id }) {
              store.addSourceReview(documentID: doc.id, kind: .payslip)
            }
          }
        } label: {
          Label("Try a sample payslip", systemImage: "sparkles")
            .font(.body).fixedSize(horizontal: false, vertical: true)
            .frame(minHeight: 44, alignment: .leading)
        }
          .disabled(store.importLocked).accessibilityIdentifier("samplePayslip")
      }
      ForEach(store.draft.documents) { document in
        VStack(alignment: .leading, spacing: 10) {
          Label(document.name, systemImage: "doc.richtext").font(.subheadline.bold())
          Text("Original retained · \(ByteCountFormatter.string(fromByteCount: Int64(document.byteLength), countStyle: .file))")
            .font(.caption).foregroundStyle(KittyTheme.secondary)
          ForEach(document.messages, id: \.self) { Text($0).font(.caption).foregroundStyle(KittyTheme.warning) }
          ForEach(store.draft.sourceReviews.filter { $0.documentID == document.id }) { review in
            NavigationLink { SourceReviewScreen(reviewID: review.id) } label: {
              VStack(alignment: .leading, spacing: 3) {
                Text(review.kind.title).font(.subheadline.weight(.semibold))
                Text(review.problems(context: store.sourceContext, document: document).isEmpty
                  ? "Fields reviewed · ready for duplicate checks" : "Check the fields against the original")
                  .font(.caption).foregroundStyle(KittyTheme.secondary)
              }
            }.buttonStyle(.plain).accessibilityIdentifier("sourceReview-\(review.id)")
          }
          Menu {
            ForEach(SourceRecordKind.allCases) { kind in
              Button(kind.title) { store.addSourceReview(documentID: document.id, kind: kind) }
            }
          } label: { Label("Add a record from this original", systemImage: "plus.circle") }
            .font(.caption).disabled(store.importLocked)
          HStack {
            if document.state != .extracted {
              Button("Read it again") { Task { await store.retrySourceExtraction(document.id) } }
            }
            Spacer()
            Button("Remove", role: .destructive) { store.removeSource(document.id) }
          }.font(.caption).disabled(store.importLocked)
        }.buttonStyle(.borderless).padding(.vertical, 6)
      }
      if let note = store.sourceReviewNotice, !store.draft.documents.isEmpty {
        Text(note).font(.caption).foregroundStyle(KittyTheme.warning)
          .accessibilityIdentifier("sourceReviewNotice")
      }
    } header: {
      Text("Documents and balances").font(.subheadline.weight(.semibold))
        .foregroundStyle(KittyTheme.secondary).fixedSize(horizontal: false, vertical: true)
    }
    .fileImporter(isPresented: $chooseDocument, allowedContentTypes: [.pdf, .commaSeparatedText], allowsMultipleSelection: true) { result in
      switch result {
      case .success(let urls): Task { for url in urls { await store.captureSource(url) } }
      case .failure(let error): store.error = error.localizedDescription
      }
    }
  }
}

struct SourceReviewScreen: View {
  @EnvironmentObject var store: KittyStore
  let reviewID: String
  var body: some View {
    if let review = store.draft.sourceReviews.first(where: { $0.id == reviewID }),
      let document = store.draft.documents.first(where: { $0.id == review.documentID }) {
      SourceReviewView(document: document, draft: Binding(
        get: { store.draft.sourceReviews.first(where: { $0.id == reviewID }) ?? review },
        set: { store.updateSourceReview($0) }), context: store.sourceContext,
        locked: store.importLocked, onChange: {})
    } else {
      ContentUnavailableView("Review unavailable", systemImage: "doc.questionmark",
        description: Text("Return to your originals and choose the record again."))
    }
  }
}

struct SourceSaveSection: View {
  @EnvironmentObject var store: KittyStore
  @State private var confirm = false
  var body: some View {
    Section("Save reviewed records") {
      if let proposal = store.sourceProposal {
        Label("\(proposal.newCount) new records · \(proposal.evidenceCount) statement balances",
          systemImage: "checklist")
        if proposal.alreadyPresent > 0 {
          Text("\(proposal.alreadyPresent) records are already in your Sheet or practice receipts.")
            .font(.caption).foregroundStyle(KittyTheme.secondary)
        }
        ForEach(proposal.issues) { issue in
          VStack(alignment: .leading, spacing: 8) {
            Label(issue.message, systemImage: "exclamationmark.circle").font(.subheadline)
            if issue.severity == "review", issue.evidenceKey != nil {
              Button("I checked this against the original") { store.acknowledgeSourceIssue(issue) }
                .font(.caption).disabled(store.importLocked)
            }
          }
        }
      }
      Text(store.isDemo
        ? "Practice retains the original files and checked records on this device. It does not change Google Sheets."
        : "Originals and the exact reviewed records stay in your Drive. Saving records leaves the month open for reconciliation.")
        .font(.caption).foregroundStyle(KittyTheme.secondary)
      if store.draft.remote == nil {
        Button { confirm = true } label: {
          if store.importBusy { ProgressView("Checking the reviewed records…") }
          else { Label(store.isDemo ? "Complete document practice" : "Save reviewed records", systemImage: "checkmark.shield") }
        }.disabled(store.importLocked || !store.sourceImportCanCommit || store.newSheetWritesNeedRecovery
          || (!store.isDemo && !store.sheetCanEdit))
          .accessibilityIdentifier("saveSourceImport")
      }
    }.confirmationDialog(store.isDemo ? "Complete this document practice?" : "Save these reviewed records?",
      isPresented: $confirm, titleVisibility: .visible) {
      Button(store.isDemo ? "Complete practice" : "Save and verify") { Task { await store.commitImport() } }
    } message: {
      Text("Only the reviewed fields and transaction rows will be saved. Statement balances remain evidence; they do not overwrite calculated balances.")
    }
  }
}
