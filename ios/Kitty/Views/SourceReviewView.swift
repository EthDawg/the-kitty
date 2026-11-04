import PDFKit
import SwiftUI

struct SourceReviewView: View {
  let document: SourceDocument
  @Binding var draft: SourceReviewDraft
  let context: SourceReviewContext
  var locked = false
  var onChange: () -> Void = {}
  @State private var currentPage = 1
  @State private var preview = false
  @State private var focusedEvidence: SourceEvidenceReference?
  @State private var evidenceField: String?
  @State private var error: String?

  var body: some View {
    Form {
      Section {
        Label(document.name, systemImage: "doc.text").font(.headline)
        Text("Read the original and check each field. Text recognition suggests values; it does not verify them.").font(.subheadline).foregroundStyle(.secondary)
        Button("View original document") { focusedEvidence = nil; preview = true }
          .accessibilityIdentifier("sourceOriginal")
        ForEach(document.messages + draft.messages, id: \.self) { Text($0).font(.caption).foregroundStyle(.secondary) }
      }
      Section(draft.kind.title) {
        ForEach(draft.specifications) { spec in field(spec) }
      }.disabled(locked)
      if draft.kind == .payslip {
        adjustments("Deductions", key: "deductions")
        adjustments("Reimbursements", key: "reimbursements")
        Section {
          Text("Employer super is recorded separately. The bank deposit is matched during reconciliation; this payslip does not create another salary transaction.").font(.caption).foregroundStyle(.secondary)
        }
      }
      Section("Review status") {
        let issues = draft.problems(context: context, document: document)
        if issues.isEmpty {
          Label("Fields checked against the original", systemImage: "checkmark.circle")
          Text("Ready for the import review. Saving still requires the Sheet checks and a verified receipt.").font(.caption).foregroundStyle(.secondary)
        } else {
          Text("\(issues.count) item\(issues.count == 1 ? "" : "s") to resolve").font(.subheadline.weight(.medium))
          ForEach(issues, id: \.self) { Text($0).font(.caption).foregroundStyle(.secondary) }
        }
        if let error { Text(error).font(.caption).foregroundStyle(.red) }
      }
    }
    .buttonStyle(.borderless)
    .scrollContentBackground(.hidden)
    .background(KittyTheme.background)
    .navigationTitle("Review \(draft.kind.title.lowercased())")
    .navigationBarTitleDisplayMode(.inline)
    .sheet(isPresented: $preview) {
      SourceOriginalView(document: document, page: $currentPage, evidence: focusedEvidence)
    }
    .sheet(item: evidenceBinding) { item in
      evidencePicker(item.field)
    }
  }

  private func field(_ spec: SourceFieldSpecification) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      fieldEditor(spec)
      if spec.money && draft.kind == .statementBalance {
        Picker("This balance is", selection: Binding(
          get: { draft.balancePolarity[spec.id] ?? "" },
          set: { draft.setPolarity(spec.id, $0); changed() })) {
          Text("Choose held or owing").tag("")
          Text("Money held / credit").tag("held")
          Text("Money owing").tag("owing")
        }.font(.caption)
      }
      if spec.id == "valueMinor" {
        Text("Use the observed value, not the original purchase price or a replacement target.").font(.caption).foregroundStyle(.secondary)
      }
      if spec.date { Text("YYYY-MM-DD\(spec.optional ? " · optional" : "")").font(.caption2).foregroundStyle(.secondary) }
      if let candidates = draft.suggestions[spec.id], candidates.count > 1 {
        Menu("Choose a suggested value") {
          ForEach(candidates) { candidate in
            Button("\(candidate.input) · page \(candidate.reference.page ?? 1)") { draft.chooseSuggestion(spec.id, candidate); changed() }
          }
        }.font(.caption)
      }
      if !draft.input(spec.id).isEmpty { confirmation(spec.id) }
    }.padding(.vertical, 6)
  }
  @ViewBuilder private func fieldEditor(_ spec: SourceFieldSpecification) -> some View {
    let binding = Binding(get: { draft.input(spec.id) }, set: { draft.setInput(spec.id, $0); changed() })
    switch spec.id {
    case "accountId": choice(spec.title, binding: binding, values: context.accounts).accessibilityIdentifier("sourceField-\(spec.id)")
    case "itemId": choice(spec.title, binding: binding, values: context.items).accessibilityIdentifier("sourceField-\(spec.id)")
    case "person":
      Picker(spec.title, selection: binding) { Text("Choose").tag(""); ForEach(context.people, id: \.self) { Text($0).tag($0) } }
        .accessibilityIdentifier("sourceField-\(spec.id)")
    case "currency":
      Picker(spec.title, selection: binding) { Text("Choose").tag(""); Text(context.currency).tag(context.currency) }
        .accessibilityIdentifier("sourceField-\(spec.id)")
    case "valueKind":
      Picker(spec.title, selection: binding) { Text("Choose").tag(""); Text("Asset value").tag("asset"); Text("Amount owing").tag("liability") }
        .accessibilityIdentifier("sourceField-\(spec.id)")
    case "sourceMethod":
      Picker(spec.title, selection: binding) {
        Text("Choose").tag(""); Text("Statement").tag("statement"); Text("Appraisal").tag("appraisal"); Text("Market value").tag("market"); Text("Estimate").tag("estimate")
      }.accessibilityIdentifier("sourceField-\(spec.id)")
    case "valueBasis":
      Text("Current pay period, excluding year-to-date totals").font(.subheadline.weight(.medium))
        .accessibilityIdentifier("sourceField-\(spec.id)")
    case "balanceKind":
      Text("Statement closing balance, excluding available balance and minimum payment").font(.subheadline.weight(.medium))
        .accessibilityIdentifier("sourceField-\(spec.id)")
    case "balanceConvention":
      Text("Money held becomes positive; money owing becomes negative in your Sheet").font(.subheadline.weight(.medium))
        .accessibilityIdentifier("sourceField-\(spec.id)")
    default:
      VStack(alignment: .leading, spacing: 4) {
        Text(spec.title).font(.subheadline.weight(.medium))
        TextField("Enter \(spec.title.lowercased())", text: binding)
          .keyboardType(spec.money || spec.date ? .numbersAndPunctuation : .default)
          .textInputAutocapitalization(.never).autocorrectionDisabled()
          .accessibilityLabel(spec.title).accessibilityIdentifier("sourceField-\(spec.id)")
      }
    }
  }
  private func choice(_ title: String, binding: Binding<String>, values: [SourceReviewChoice]) -> some View {
    Picker(title, selection: binding) { Text("Choose").tag(""); ForEach(values) { Text($0.name).tag($0.id) } }
  }
  private func confirmation(_ key: String) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      if let ref = draft.evidence[key], let quote = ref.quote {
        Text("\(ref.line.map { "CSV line \($0)" } ?? "Page \(ref.page ?? 1)"): “\(quote)”").font(.caption).foregroundStyle(.secondary).lineLimit(3)
      }
      ViewThatFits(in: .horizontal) {
        HStack {
          originalButton(key).fixedSize(horizontal: true, vertical: false)
          evidenceButton(key).fixedSize(horizontal: true, vertical: false)
        }
        VStack(alignment: .leading, spacing: 8) {
          originalButton(key)
          evidenceButton(key)
        }
      }
      Button {
        if draft.isConfirmed(key) { draft.unconfirm(key); changed(); return }
        do { try draft.confirm(key, document: document, page: currentPage); changed() }
        catch { self.error = error.localizedDescription }
      } label: {
        Label(draft.isConfirmed(key) ? "Checked · tap to reopen" : "I checked this field", systemImage: draft.isConfirmed(key) ? "checkmark.circle.fill" : "circle")
          .font(.caption.weight(.semibold))
          .frame(minHeight: 44, alignment: .leading).contentShape(Rectangle())
      }.buttonStyle(.borderless).accessibilityIdentifier("sourceConfirm-\(key)")
    }
  }
  private func adjustments(_ title: String, key: String) -> some View {
    Section(title) {
      let values = key == "deductions" ? draft.deductions : draft.reimbursements
      ForEach(Array(values.enumerated()), id: \.element.id) { index, _ in
        VStack(alignment: .leading, spacing: 8) {
          VStack(alignment: .leading, spacing: 4) {
            Text("Label on the payslip").font(.subheadline.weight(.medium))
            TextField("Enter adjustment label", text: adjustmentBinding(key, index: index, amount: false))
              .accessibilityLabel("Label on the payslip").accessibilityIdentifier("sourceField-\(key)-\(index)-label")
          }
          VStack(alignment: .leading, spacing: 4) {
            Text("Amount").font(.subheadline.weight(.medium))
            TextField("Enter amount", text: adjustmentBinding(key, index: index, amount: true)).keyboardType(.decimalPad)
              .accessibilityLabel("Amount").accessibilityIdentifier("sourceField-\(key)-\(index)-amount")
          }
          Button("Remove adjustment", role: .destructive) { mutateAdjustments(key) { $0.remove(at: index) } }.font(.caption)
        }
      }
      if values.count < 20 { Button("Add \(key == "deductions" ? "deduction" : "reimbursement")") { mutateAdjustments(key) { $0.append(SourceReviewAdjustment()) } } }
      if !values.isEmpty { confirmation(key) }
    }.disabled(locked)
  }
  private func originalButton(_ key: String) -> some View {
    Button {
      focusedEvidence = draft.evidence[key]
      currentPage = focusedEvidence?.page ?? currentPage
      preview = true
    } label: {
      Text("Check original").frame(minHeight: 44, alignment: .leading).contentShape(Rectangle())
    }.font(.caption).buttonStyle(.borderless)
  }
  private func evidenceButton(_ key: String) -> some View {
    Button { evidenceField = key } label: {
      Text("Choose evidence").frame(minHeight: 44, alignment: .leading).contentShape(Rectangle())
    }.font(.caption).buttonStyle(.borderless)
  }
  private func adjustmentBinding(_ key: String, index: Int, amount: Bool) -> Binding<String> {
    Binding(get: {
      let values = key == "deductions" ? draft.deductions : draft.reimbursements
      guard values.indices.contains(index) else { return "" }
      return amount ? values[index].amount : values[index].label
    }, set: { value in mutateAdjustments(key) { if $0.indices.contains(index) { if amount { $0[index].amount = value } else { $0[index].label = value } } } })
  }
  private func mutateAdjustments(_ key: String, change: (inout [SourceReviewAdjustment]) -> Void) {
    if key == "deductions" { change(&draft.deductions) } else { change(&draft.reimbursements) }
    draft.changedAdjustments(key)
    changed()
  }
  private func changed() { error = nil; onChange() }
  private struct EvidenceField: Identifiable { let field: String; var id: String { field } }
  private var evidenceBinding: Binding<EvidenceField?> {
    Binding(get: { evidenceField.map { EvidenceField(field: $0) } }, set: { evidenceField = $0?.field })
  }
  private func evidencePicker(_ field: String) -> some View {
    NavigationStack {
      List {
        Section {
          Stepper("Original page \(currentPage)", value: $currentPage, in: 1...max(1, document.pageCount))
          Button("Use this page for visual review") {
            draft.selectEvidence(field: field, document: document, page: currentPage)
            evidenceField = nil; changed()
          }
          Text("Use the page itself when text recognition is incomplete. Do not select a YTD amount for current pay.").font(.caption).foregroundStyle(.secondary)
        }
        if let page = document.pages.first(where: { $0.number == currentPage }) {
          Section("Text on this page") {
            ForEach(page.observations) { observation in
              Button {
                draft.selectEvidence(field: field, document: document, page: currentPage, observation: observation)
                evidenceField = nil; changed()
              } label: { Text(observation.text).font(.subheadline).foregroundStyle(.primary) }
            }
          }
        }
      }.buttonStyle(.borderless).scrollContentBackground(.hidden).background(KittyTheme.background)
        .navigationTitle("Choose source evidence").toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { evidenceField = nil } } }
    }
  }
}

struct SourceOriginalView: View {
  let document: SourceDocument
  @Binding var page: Int
  var evidence: SourceEvidenceReference?
  @Environment(\.dismiss) private var dismiss
  var body: some View {
    NavigationStack {
      VStack(spacing: 0) {
        if document.mimeType == "application/pdf" {
          SourcePDFPreview(bytes: document.bytes, documentID: document.id, page: page, evidence: evidence)
        } else {
          ScrollView { Text(String(decoding: document.bytes, as: UTF8.self)).font(.system(.caption, design: .monospaced)).textSelection(.enabled).padding() }
        }
        Stepper("Page \(page) of \(max(1, document.pageCount))", value: $page, in: 1...max(1, document.pageCount)).padding()
      }.background(KittyTheme.background).navigationTitle("Original source").navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
    }
  }
}

private struct SourcePDFPreview: UIViewRepresentable {
  let bytes: Data
  let documentID: String
  let page: Int
  let evidence: SourceEvidenceReference?
  final class Coordinator {
    var documentID: String?
    var page: Int?
    var reference: SourceEvidenceReference?
    var annotation: PDFAnnotation?
    weak var annotatedPage: PDFPage?
  }
  func makeCoordinator() -> Coordinator { Coordinator() }
  func makeUIView(context: Context) -> PDFView {
    let view = PDFView(); view.autoScales = true; view.displayMode = .singlePageContinuous; view.backgroundColor = UIColor(KittyTheme.background); return view
  }
  func updateUIView(_ view: PDFView, context: Context) {
    let coordinator = context.coordinator
    if coordinator.documentID != documentID { view.document = PDFDocument(data: bytes); coordinator.documentID = documentID; coordinator.page = nil }
    guard let target = view.document?.page(at: max(0, page - 1)) else { return }
    if coordinator.page != page { view.go(to: target); coordinator.page = page }
    if coordinator.reference != evidence {
      if let annotation = coordinator.annotation { coordinator.annotatedPage?.removeAnnotation(annotation) }
      coordinator.annotation = nil; coordinator.reference = evidence
      if let evidence, evidence.page == page, let bbox = evidence.bbox, bbox.count == 4, bbox != [0, 0, 1, 1] {
        let box = target.bounds(for: .cropBox)
        let bounds = CGRect(x: box.minX + bbox[0]*box.width, y: box.minY + bbox[1]*box.height, width: bbox[2]*box.width, height: bbox[3]*box.height)
        let annotation = PDFAnnotation(bounds: bounds, forType: .highlight, withProperties: nil)
        annotation.color = .systemYellow.withAlphaComponent(0.35)
        target.addAnnotation(annotation); coordinator.annotation = annotation; coordinator.annotatedPage = target
      }
    }
  }
}
