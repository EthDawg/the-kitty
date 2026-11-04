import SwiftUI

struct PeriodCloseView: View {
  @EnvironmentObject var store: KittyStore
  @State private var selectedDate = Date()
  @State private var confirmClose = false
  @State private var confirmCancel = false
  private static var dateFormat: DateFormatter {
    let formatter = DateFormatter()
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter
  }
  private var day: String { Self.dateFormat.string(from: selectedDate) }
  private var currentReview: PeriodCloseProposal? {
    guard store.closeProposal?.periodEnd == day else { return nil }
    return store.closeProposal
  }
  var body: some View {
    List {
      Section {
        Label("Close a month with its sources", systemImage: "calendar.badge.checkmark")
          .font(.headline)
        Text("Check every account, payslip and required valuation before advancing the Sheet's as-of date. Saving imports alone leaves the month open.")
          .font(.subheadline).foregroundStyle(KittyTheme.secondary)
        if let asOf = store.household?.asOf { LabeledContent("Sheet currently through", value: niceDate(asOf)) }
        if store.isDemo { Pill(title: "Practice checks · fictional data", symbol: "sparkles") }
      }
      if store.draft.remote != nil {
        Section("Protected receipt") {
          Text("A save is awaiting verification. Resolve its receipt before beginning another review.")
            .font(.subheadline)
          Button("Check saved receipt") { Task { await store.checkImportStatus() } }
            .disabled(store.importBusy).accessibilityIdentifier("closeCheckReceipt")
          if store.draft.remote?.operation == "close", store.draft.remote?.status == "proposed",
            store.draft.remote?.recoveryOnly == false {
            Button("Continue this month-end close") { Task { await store.commitSourceImport(operation: "close") } }
              .disabled(store.importBusy)
          }
          Button("Cancel pending save") { confirmCancel = true }.disabled(store.importBusy)
        }
      } else {
        Section("Review the period") {
          DatePicker("Month ends", selection: $selectedDate, displayedComponents: .date)
            .environment(\.timeZone, TimeZone(secondsFromGMT: 0)!)
            .disabled(store.importLocked).accessibilityIdentifier("closePeriodDate")
          Button {
            Task { await store.preparePeriodClose(periodEnd: day) }
          } label: {
            if store.importEvidenceLoading { ProgressView("Checking saved source evidence…") }
            else { Label("Check this month", systemImage: "checklist") }
          }.disabled(store.importLocked).accessibilityIdentifier("checkMonth")
          Text("These checks use saved originals and receipts. Documents still being reviewed are not accepted evidence yet.")
            .font(.caption).foregroundStyle(KittyTheme.secondary)
        }
      }
      if let review = currentReview {
        Section {
          NavigationLink { PeriodMatchingScreen() } label: {
            Label("Match transfers and salary deposits", systemImage: "arrow.left.arrow.right")
          }.disabled(store.importLocked).accessibilityIdentifier("closeMatching")
          Text("Review split payments, transfer pairs and any specific questions. Every decision stays attached to these records.")
            .font(.caption).foregroundStyle(KittyTheme.secondary)
        }
        Section("Reconciliation") {
          let unresolved = review.checks.filter { !$0.passed }
          Text(unresolved.isEmpty && review.canClose ? "Ready for the final Sheet check" : "\(unresolved.count) checks need attention")
            .font(.headline)
          ForEach(unresolved) { check in checkRow(check) }
          let passed = review.checks.filter(\.passed)
          if !passed.isEmpty {
            DisclosureGroup("\(passed.count) checks passed") {
              ForEach(passed) { check in checkRow(check) }
            }
          }
          ForEach(review.issues.filter { issue in !review.checks.contains { $0.id == issue.id } }) { issue in
            Text(issue.message).font(.caption).foregroundStyle(KittyTheme.warning)
          }
        }.accessibilityIdentifier("monthChecks")
        Section {
          if store.isDemo {
            Text("This is a practice review. Connect your own Sheet to save evidence and close a month.")
              .font(.subheadline).accessibilityIdentifier("closePracticeLimit")
          } else {
            Button { confirmClose = true } label: {
              Label("Close through \(niceDate(review.periodEnd))", systemImage: "checkmark.shield")
            }.disabled(!review.canClose || !store.sheetCanEdit || store.importLocked)
              .accessibilityIdentifier("closeMonth")
            Text("The Sheet's as-of date changes only after these checks pass. The app then reads the Sheet again to verify the completed close.")
              .font(.caption).foregroundStyle(KittyTheme.secondary)
          }
        }
      }
      if let state = store.importState { Section { Text(state).font(.subheadline) } }
    }
    .navigationTitle("Month-end review").navigationBarTitleDisplayMode(.inline)
    .scrollContentBackground(.hidden).background(KittyTheme.background)
    .task {
      if let saved = store.draft.closeReview?.periodEnd, let date = Self.dateFormat.date(from: saved) {
        selectedDate = date
      } else if let current = store.household?.asOf, let date = Self.dateFormat.date(from: current) {
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let first = calendar.date(from: calendar.dateComponents([.year, .month], from: date))!
        selectedDate = calendar.date(byAdding: .day, value: -1,
          to: calendar.date(byAdding: .month, value: 2, to: first)!)!
      }
    }
    .confirmationDialog("Close the month through \(niceDate(day))?", isPresented: $confirmClose, titleVisibility: .visible) {
      Button("Close and verify month") { Task { await store.commitSourceImport(operation: "close") } }
    } message: {
      Text("This advances the Sheet's as-of date after checking the saved source evidence. An uncertain result keeps the same receipt for recovery.")
    }
    .confirmationDialog("Cancel the pending save?", isPresented: $confirmCancel, titleVisibility: .visible) {
      Button("Cancel pending save") { Task { await store.cancelPreparedImport() } }
    } message: { Text("The receipt stays protected unless the service confirms that no write started.") }
  }
  private func exactAmount(_ minor: String) -> String {
    guard let amount = CloseExactMoney.minor(minor) else { return "Not available" }
    return "\(store.currency) \(SourceMoney.decimal(amount))"
  }
  private func checkRow(_ check: PeriodCloseCheck) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      Label(check.passed ? "Checked" : "Needs attention",
        systemImage: check.passed ? "checkmark.circle.fill" : "exclamationmark.circle")
        .font(.caption.bold()).foregroundStyle(check.passed ? KittyTheme.accent : KittyTheme.warning)
      Text(checkMessage(check)).font(.subheadline)
      if let expected = check.expectedMinor, let actual = check.actualMinor {
        Text("Expected \(exactAmount(expected)) · recorded \(exactAmount(actual))")
          .font(.caption).monospacedDigit().foregroundStyle(KittyTheme.secondary)
      }
    }.padding(.vertical, 4)
  }
  private func checkMessage(_ check: PeriodCloseCheck) -> String {
    let known = store.sourceContext.accounts + store.sourceContext.items
    let names = (check.recordIds ?? []).map { id in known.first { $0.id == id }?.name ?? id }.joined(separator: ", ")
    let suffix = names.isEmpty ? "" : " · \(names)"
    if check.code.hasPrefix("close-baseline-") {
      let key = String(check.code.dropFirst("close-baseline-".count))
      let labels = ["projectedBalances": "balances for the selected period", "unresolvedReviews": "items awaiting review",
        "checks": "Sheet check results", "items": "valuation items", "people": "household people"]
      return check.passed ? "Read the \(labels[key] ?? key) from your Sheet." : "Refresh the Sheet to read its \(labels[key] ?? key)."
    }
    switch check.code {
    case "close-period": return check.passed ? "The selected date is a calendar month end." : "Choose the last day of the month."
    case "close-as-of", "close-sequence": return check.passed ? "This is the next month after your Sheet's recorded date." : "Close the next full month after your Sheet's current date."
    case "close-currency": return check.passed ? "The Sheet uses a supported currency." : "Check the currency recorded in your Sheet."
    case "close-account-scope": return check.passed ? "Your account list is available." : "Refresh the Sheet to read its complete account list."
    case "close-check-scope": return check.passed ? "Your Sheet's month-end checks are available." : "The month-end checks are missing. Refresh or repair the Checks tab in your Sheet."
    case "account-definition": return check.passed ? "Account and currency checked\(suffix)." : "Check the account details and currency\(suffix)."
    case "account-opening": return "Check the opening balance and date\(suffix)."
    case "accepted-evidence": return check.passed ? "Saved original documents and receipts are available." : "Save the month's statement balances, payslips and valuations before closing it."
    case "accepted-receipt": return check.passed ? "A saved source receipt was verified." : "A source receipt could not be verified. Refresh the saved evidence."
    case "account-statement": return check.passed ? "Statement covers this month\(suffix)." : "Add a statement covering the whole month, including accounts with no activity\(suffix)."
    case "statement-opening": return check.passed ? "Statement and ledger opening balances match\(suffix)." : "The statement's opening balance differs from the ledger\(suffix)."
    case "statement-movement": return check.passed ? "Opening balance plus this month's transactions equals the statement close\(suffix)." : "The statement does not balance with this month's recorded transactions\(suffix)."
    case "statement-canonical", "balance-projection": return check.passed ? "The expected month-end balance matches\(suffix)." : "Check the month-end balance against the statement and recorded transactions\(suffix)."
    case "valuation-evidence": return check.passed ? "Month-end valuation has its original source\(suffix)." : "Add the month-end valuation and its original source\(suffix)."
    case "payslip-evidence": return check.passed ? "Payslip has its original source\(suffix)." : "Add the original payslip for this record\(suffix)."
    case "transfer-covered": return check.passed ? "Both sides of this transfer are matched\(suffix)." : "Match this transfer to its other account entry\(suffix)."
    case "payslip-salary-covered", "salary-payslip-covered": return check.passed ? "Payslip and salary deposit match\(suffix)." : "Match the payslip and its salary deposits\(suffix)."
    default: return check.message + suffix
    }
  }
}

private struct PeriodMatchingScreen: View {
  @EnvironmentObject var store: KittyStore
  @State private var transactions: [CloseLedgerChoice] = []
  @State private var payslips: [ClosePayslipChoice] = []
  @State private var loadError: String?
  var body: some View {
    Group {
      if let loadError {
        ContentUnavailableView("Refresh the month-end review", systemImage: "arrow.clockwise",
          description: Text(loadError))
      } else if let review = store.draft.closeReview {
        CloseMatchingView(decisions: Binding(get: { store.draft.closeReview?.decisions ?? .init() },
          set: { store.updateCloseDecisions($0) }), transactions: transactions, payslips: payslips,
          issues: store.closeProposal?.issues ?? [], currency: store.currency,
          periodEnd: review.periodEnd, readOnly: store.importLocked)
      } else {
        ContentUnavailableView("Choose a month first", systemImage: "calendar",
          description: Text("Return to month-end review and check the period."))
      }
    }.task {
      do {
        guard let baseline = store.sourceBaseline else { throw KittyError.message("The current Sheet evidence is unavailable.") }
        transactions = try CloseLedgerChoice.decode(baseline: baseline)
        payslips = try ClosePayslipChoice.decode(baseline: baseline, evidence: store.acceptedSourceEvidence)
      } catch { loadError = error.localizedDescription }
    }
  }
}
