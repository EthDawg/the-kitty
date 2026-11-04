import SwiftUI

struct CloseMatchingView: View {
  @Binding var decisions: CloseReviewDecisions
  let transactions: [CloseLedgerChoice]
  let payslips: [ClosePayslipChoice]
  let issues: [SourceImportIssue]
  let currency: String
  let periodEnd: String
  var readOnly = false

  var body: some View {
    List {
      Section {
        Text("Match the recorded evidence for the month through \(niceDate(periodEnd)). Review exact amounts, dates and account names before recording a decision.")
          .font(.subheadline).foregroundStyle(KittyTheme.secondary)
        Text("A matching amount alone does not establish a transfer or a salary payment.")
          .font(.caption).foregroundStyle(KittyTheme.secondary)
      }
      Section("Transfer pairs") {
        NavigationLink {
          CloseTransferEditor(decisions: $decisions, transactions: transactions,
            currency: currency, periodEnd: periodEnd, readOnly: readOnly)
        } label: {
          Label("Review a transfer pair", systemImage: "arrow.left.arrow.right")
        }.disabled(readOnly).accessibilityIdentifier("closeMatch.addTransfer")
        ForEach(decisions.transferPairs) { pair in
          VStack(alignment: .leading, spacing: 8) {
            ForEach(pair.transactionIds, id: \.self) { id in
              if let transaction = transactions.first(where: { $0.id == id }) {
                CloseLedgerSummary(transaction: transaction)
              } else { Text("A selected transaction is no longer available. Recheck this decision.").foregroundStyle(KittyTheme.warning) }
            }
            Text(pair.reason).font(.caption)
            Button("Remove pair", role: .destructive) {
              var next = decisions; next.transferPairs.removeAll { $0.id == pair.id }; decisions = next
            }.disabled(readOnly)
          }.padding(.vertical, 4)
        }
      }
      Section("Salary deposits") {
        NavigationLink {
          CloseSalaryEditor(decisions: $decisions, transactions: transactions,
            payslips: payslips, currency: currency, periodEnd: periodEnd, readOnly: readOnly)
        } label: {
          Label("Review a split or timing difference", systemImage: "doc.text.magnifyingglass")
        }.disabled(readOnly).accessibilityIdentifier("closeMatch.addSalary")
        ForEach(decisions.salaryMatches) { match in
          VStack(alignment: .leading, spacing: 8) {
            ForEach(match.payslipRecordIds, id: \.self) { id in
              if let pay = payslips.first(where: { $0.id == id || $0.aliases.contains(id) }) {
                ClosePayslipSummary(payslip: pay)
              } else { Text("A selected payslip is no longer available. Recheck this decision.").foregroundStyle(KittyTheme.warning) }
            }
            ForEach(match.transactionIds, id: \.self) { id in
              if let transaction = transactions.first(where: { $0.id == id }) {
                CloseLedgerSummary(transaction: transaction)
              } else { Text("A selected deposit is no longer available. Recheck this decision.").foregroundStyle(KittyTheme.warning) }
            }
            if match.allowTiming { Text("Different recorded dates were explicitly reviewed.").font(.caption) }
            Text(match.reason).font(.caption)
            Button("Remove salary match", role: .destructive) {
              var next = decisions; next.salaryMatches.removeAll { $0.id == match.id }; decisions = next
            }.disabled(readOnly)
          }.padding(.vertical, 4)
        }
      }
      Section("Specific review items") {
        let reviewable = issues.filter { $0.severity == "review" && $0.evidenceKey != nil }
        if reviewable.isEmpty {
          Text("No unresolved items currently accept a recorded review decision.").foregroundStyle(KittyTheme.secondary)
        }
        ForEach(reviewable) { issue in
          NavigationLink {
            CloseIssueEditor(decisions: $decisions, issue: issue, transactions: transactions,
              payslips: payslips, readOnly: readOnly)
          } label: {
            Text(issue.message).font(.subheadline)
          }.disabled(readOnly).accessibilityIdentifier("closeMatch.issue.\(issue.id)")
        }
        ForEach(decisions.decisions.keys.sorted(), id: \.self) { id in
          if let decision = decisions.decisions[id] {
            VStack(alignment: .leading, spacing: 6) {
              Text("Recorded review decision").font(.headline)
              Text(decision.reason).font(.subheadline)
              if let current = issues.first(where: { $0.id == id }), !decision.stillMatches(current) {
                Text("The recorded facts changed. Review this item again.").font(.caption).foregroundStyle(KittyTheme.warning)
              }
              Button("Remove decision", role: .destructive) {
                var next = decisions; next.decisions.removeValue(forKey: id); decisions = next
              }.disabled(readOnly)
            }
          }
        }
      }
      Section {
        Text("The close checks run again against these decisions. Missing originals, balance differences and conflicting records still need to be resolved.")
          .font(.caption).foregroundStyle(KittyTheme.secondary)
      }
    }.scrollContentBackground(.hidden).kittyBackground().navigationTitle("Match & review")
      .navigationBarTitleDisplayMode(.inline).accessibilityIdentifier("closeMatch.review")
  }
}

private struct CloseTransferEditor: View {
  @Binding var decisions: CloseReviewDecisions
  let transactions: [CloseLedgerChoice]
  let currency, periodEnd: String
  let readOnly: Bool
  @Environment(\.dismiss) private var dismiss
  @State private var selected = Set<String>()
  @State private var reason = ""
  @State private var showAllDates = false
  @State private var search = ""
  private enum Field: Hashable { case search, reason }
  @FocusState private var focusedField: Field?
  private var used: Set<String> { Set(decisions.transferPairs.flatMap(\.transactionIds)) }
  private var selectedRows: [CloseLedgerChoice] { transactions.filter { selected.contains($0.id) } }
  private var candidates: [CloseLedgerChoice] {
    transactions.filter { $0.isTransfer && (showAllDates || $0.date.hasPrefix(String(periodEnd.prefix(7))))
      && (search.isEmpty || [$0.accountName, $0.description, $0.date, $0.person].joined(separator: " ").localizedCaseInsensitiveContains(search)) }
  }
  private var problem: String? {
    guard selected.count == 2, selectedRows.count == 2 else { return "Choose the two actual sides of one transfer." }
    guard selectedRows[0].accountID != selectedRows[1].accountID else { return "The two sides must belong to different accounts." }
    guard selectedRows.allSatisfy({ $0.currency == currency }), selectedRows[0].amountMinor != "0",
      CloseExactMoney.total(selectedRows.map(\.amountMinor)) == "0" else { return "The selected amounts must be exact opposites in the same currency." }
    let groups = Set(selectedRows.map(\.transferGroup).filter { !$0.isEmpty })
    guard groups.count <= 1 else { return "These records already belong to different transfer pairs. Resolve that conflict in the Sheet." }
    guard used.isDisjoint(with: selected) else { return "A selected transaction is already used in another decision." }
    guard validCloseReason(reason) else { return "Explain how the two records establish this transfer (8–2,000 characters)." }
    return nil
  }
  var body: some View {
    List {
      Section {
        Text("Select both records yourself. Check the source dates and accounts as well as the amounts.").font(.subheadline)
        Toggle("Show all recorded dates", isOn: $showAllDates)
          .accessibilityIdentifier("closeTransfer.allDates")
        HStack {
          Image(systemName: "magnifyingglass").foregroundStyle(KittyTheme.secondary)
          TextField("Account, description or date", text: $search)
            .textInputAutocapitalization(.never).autocorrectionDisabled().submitLabel(.search)
            .focused($focusedField, equals: .search).onSubmit { focusedField = nil }
            .accessibilityIdentifier("closeTransfer.search")
        }
      }
      Section("Recorded transfer entries") {
        if candidates.isEmpty { Text("No matching recorded transfer entries in this view.").foregroundStyle(KittyTheme.secondary) }
        ForEach(candidates) { transaction in
          Button {
            if selected.contains(transaction.id) { selected.remove(transaction.id) }
            else if selected.count < 2 { selected.insert(transaction.id) }
          } label: {
            HStack(alignment: .top, spacing: 12) {
              Image(systemName: selected.contains(transaction.id) ? "checkmark.circle.fill" : "circle")
              CloseLedgerSummary(transaction: transaction)
              if used.contains(transaction.id) { Text("Already used").font(.caption) }
            }.foregroundStyle(KittyTheme.ink)
          }.disabled(readOnly || used.contains(transaction.id))
            .accessibilityIdentifier("closeTransfer.select.\(transaction.id)")
            .accessibilityValue(selected.contains(transaction.id) ? "Selected" : "Not selected")
        }
      }
      if !selectedRows.isEmpty {
        Section("Selected pair") {
          ForEach(selectedRows) { CloseLedgerSummary(transaction: $0) }
        }
      }
      Section("Your explanation") {
        TextField("What shows these are the two sides?", text: $reason, axis: .vertical).lineLimit(3...6)
          .focused($focusedField, equals: .reason)
          .disabled(readOnly).accessibilityIdentifier("closeTransfer.reason")
        if let problem { Text(problem).font(.caption).foregroundStyle(KittyTheme.secondary) }
        Button("Record this pair") {
          guard problem == nil else { return }
          var next = decisions
          next.transferPairs.append(CloseTransferPair(transactionIds: selected.sorted(), reason: reason.trimmingCharacters(in: .whitespacesAndNewlines)))
          decisions = next; dismiss()
        }.disabled(readOnly || problem != nil).accessibilityIdentifier("closeTransfer.save")
      }
    }.scrollContentBackground(.hidden).kittyBackground().scrollDismissesKeyboard(.interactively)
      .navigationTitle("Review transfer").navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItemGroup(placement: .keyboard) {
          Spacer()
          Button("Done") { focusedField = nil }.accessibilityIdentifier("closeTransfer.keyboardDone")
        }
      }
  }
}

private struct CloseSalaryEditor: View {
  @Binding var decisions: CloseReviewDecisions
  let transactions: [CloseLedgerChoice]
  let payslips: [ClosePayslipChoice]
  let currency, periodEnd: String
  let readOnly: Bool
  @Environment(\.dismiss) private var dismiss
  @State private var selectedPays = Set<String>()
  @State private var selectedTransactions = Set<String>()
  @State private var reason = ""
  @State private var allowTiming = false
  @State private var showAllDates = false
  @FocusState private var reasonFocused: Bool
  private var usedTransactions: Set<String> { Set(decisions.salaryMatches.flatMap(\.transactionIds)) }
  private var usedPays: Set<String> { Set(decisions.salaryMatches.flatMap(\.payslipRecordIds)) }
  private var selectedPayRows: [ClosePayslipChoice] { payslips.filter { selectedPays.contains($0.id) } }
  private var selectedRows: [CloseLedgerChoice] { transactions.filter { selectedTransactions.contains($0.id) } }
  private var payTotal: String? { CloseExactMoney.total(selectedPayRows.map(\.netMinor)) }
  private var depositTotal: String? { CloseExactMoney.total(selectedRows.map(\.amountMinor)) }
  private var problem: String? {
    guard !selectedPayRows.isEmpty, selectedPayRows.count == selectedPays.count else { return "Choose the source-backed payslip or payslips for this payment." }
    guard selectedPayRows.allSatisfy(\.hasAcceptedEvidence) else { return "Save and verify the original payslip evidence first." }
    let people = Set(selectedPayRows.map(\.person))
    guard people.count == 1, let person = people.first,
      selectedRows.allSatisfy({ $0.person == person || $0.person == "Joint" || $0.person.isEmpty }) else { return "Match one person’s payslips and deposits in each decision." }
    guard let payTotal, let depositTotal, payTotal == depositTotal else { return "Total net pay and selected salary deposits must match exactly." }
    let dates = Set(selectedPayRows.map(\.payDate))
    guard allowTiming || (dates.count == 1 && selectedRows.allSatisfy({ dates.contains($0.date) })) else { return "The dates differ. Check the timing evidence and explicitly confirm it below." }
    guard usedTransactions.isDisjoint(with: selectedTransactions), selectedPayRows.allSatisfy({ usedPays.isDisjoint(with: Set($0.aliases + [$0.id])) }) else { return "A selected record is already used in another salary decision." }
    guard validCloseReason(reason) else { return "Explain the split or timing evidence (8–2,000 characters)." }
    return nil
  }
  var body: some View {
    List {
      Section {
        Text("Choose the payslips and the deposits that belong together. Each record can be used only once.").font(.subheadline)
        Toggle("Show all recorded dates", isOn: $showAllDates)
          .accessibilityIdentifier("closeSalary.allDates")
      }
      Section("Recorded payslips") {
        ForEach(payslips.filter { showAllDates || $0.payDate.hasPrefix(String(periodEnd.prefix(7))) }) { pay in
          let used = !usedPays.isDisjoint(with: Set(pay.aliases + [pay.id]))
          Button {
            if selectedPays.contains(pay.id) { selectedPays.remove(pay.id) } else { selectedPays.insert(pay.id) }
          } label: {
            HStack(alignment: .top, spacing: 12) {
              Image(systemName: selectedPays.contains(pay.id) ? "checkmark.circle.fill" : "circle")
              ClosePayslipSummary(payslip: pay)
              if used { Text("Already used").font(.caption) }
            }.foregroundStyle(KittyTheme.ink)
          }.disabled(readOnly || used || !pay.hasAcceptedEvidence)
            .accessibilityIdentifier("closeSalary.pay.\(pay.id)")
            .accessibilityValue(selectedPays.contains(pay.id) ? "Selected" : "Not selected")
        }
      }
      Section("Recorded salary deposits") {
        ForEach(transactions.filter { $0.isSalary && (showAllDates || $0.date.hasPrefix(String(periodEnd.prefix(7)))) }) { transaction in
          Button {
            if selectedTransactions.contains(transaction.id) { selectedTransactions.remove(transaction.id) }
            else { selectedTransactions.insert(transaction.id) }
          } label: {
            HStack(alignment: .top, spacing: 12) {
              Image(systemName: selectedTransactions.contains(transaction.id) ? "checkmark.circle.fill" : "circle")
              CloseLedgerSummary(transaction: transaction)
              if usedTransactions.contains(transaction.id) { Text("Already used").font(.caption) }
            }.foregroundStyle(KittyTheme.ink)
          }.disabled(readOnly || usedTransactions.contains(transaction.id))
            .accessibilityIdentifier("closeSalary.transaction.\(transaction.id)")
            .accessibilityValue(selectedTransactions.contains(transaction.id) ? "Selected" : "Not selected")
        }
      }
      Section("Check the match") {
        ForEach(selectedPayRows) { ClosePayslipSummary(payslip: $0) }
        ForEach(selectedRows) { CloseLedgerSummary(transaction: $0) }
        LabeledContent("Selected net pay", value: payTotal.map { CloseExactMoney.display($0, currency: currency) } ?? "Not available")
        LabeledContent("Selected deposits", value: depositTotal.map { CloseExactMoney.display($0, currency: currency) } ?? "Not available")
        Toggle("I checked the difference between pay dates and bank posting dates", isOn: $allowTiming)
          .disabled(readOnly).accessibilityIdentifier("closeSalary.allowTiming")
        TextField("Explain the split or timing evidence", text: $reason, axis: .vertical).lineLimit(3...6)
          .focused($reasonFocused).disabled(readOnly).accessibilityIdentifier("closeSalary.reason")
        if let problem { Text(problem).font(.caption).foregroundStyle(KittyTheme.secondary) }
        Button("Record this salary match") {
          guard problem == nil else { return }
          var next = decisions
          next.salaryMatches.append(CloseSalaryMatch(payslipRecordIds: selectedPays.sorted(),
            transactionIds: selectedTransactions.sorted(), reason: reason.trimmingCharacters(in: .whitespacesAndNewlines), allowTiming: allowTiming))
          decisions = next; dismiss()
        }.disabled(readOnly || problem != nil).accessibilityIdentifier("closeSalary.save")
      }
    }.scrollContentBackground(.hidden).kittyBackground().scrollDismissesKeyboard(.interactively)
      .navigationTitle("Match salary").navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItemGroup(placement: .keyboard) {
          Spacer()
          Button("Done") { reasonFocused = false }
        }
      }
  }
}

private struct CloseIssueEditor: View {
  @Binding var decisions: CloseReviewDecisions
  let issue: SourceImportIssue
  let transactions: [CloseLedgerChoice]
  let payslips: [ClosePayslipChoice]
  let readOnly: Bool
  @Environment(\.dismiss) private var dismiss
  @State private var reason = ""
  @FocusState private var reasonFocused: Bool
  var body: some View {
    Form {
      Section("The recorded issue") {
        Text(issue.message).font(.subheadline)
        ForEach(transactions.filter { (issue.recordIds ?? []).contains($0.id) }) { transaction in
          CloseLedgerSummary(transaction: transaction)
        }
        ForEach(payslips.filter { !Set($0.aliases + [$0.id]).isDisjoint(with: Set(issue.recordIds ?? [])) }) { pay in
          ClosePayslipSummary(payslip: pay)
        }
      }
      Section("Your review") {
        TextField("Why is this specific item deliberate?", text: $reason, axis: .vertical).lineLimit(3...8)
          .focused($reasonFocused).disabled(readOnly).accessibilityIdentifier("closeIssue.reason")
        Text("This decision applies to the exact facts shown. Changed records need another review.")
          .font(.caption).foregroundStyle(KittyTheme.secondary)
        Button("Record this decision") {
          guard issue.severity == "review", let evidenceKey = issue.evidenceKey, validCloseReason(reason) else { return }
          var next = decisions
          next.decisions[issue.id] = CloseIssueDecision(reason: reason.trimmingCharacters(in: .whitespacesAndNewlines),
            recordIds: issue.recordIds ?? [], evidenceKey: evidenceKey)
          decisions = next; dismiss()
        }.disabled(readOnly || !validCloseReason(reason) || issue.evidenceKey == nil)
          .accessibilityIdentifier("closeIssue.save")
      }
    }.scrollContentBackground(.hidden).kittyBackground().scrollDismissesKeyboard(.interactively)
      .navigationTitle("Review item").navigationBarTitleDisplayMode(.inline)
      .onAppear { reason = decisions.decisions[issue.id]?.reason ?? "" }
      .toolbar {
        ToolbarItemGroup(placement: .keyboard) {
          Spacer()
          Button("Done") { reasonFocused = false }
        }
      }
  }
}

private struct CloseLedgerSummary: View {
  let transaction: CloseLedgerChoice
  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(transaction.accountName).font(.headline)
      Text(transaction.displayAmount).font(.body.weight(.semibold)).monospacedDigit()
      Text("\(niceDate(transaction.date)) · \(transaction.person.isEmpty ? "Person not recorded" : transaction.person)").font(.caption)
      if !transaction.description.isEmpty { Text(transaction.description).font(.caption).foregroundStyle(KittyTheme.secondary) }
      Text("Recorded transaction \(transaction.id)").font(.caption2).foregroundStyle(KittyTheme.secondary)
    }.accessibilityElement(children: .combine)
  }
}

private struct ClosePayslipSummary: View {
  let payslip: ClosePayslipChoice
  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(payslip.person).font(.headline)
      Text(payslip.employer).font(.subheadline)
      Text("Net \(payslip.displayAmount) · \(niceDate(payslip.payDate))").font(.subheadline).monospacedDigit()
      Text(payslip.hasAcceptedEvidence ? "Accepted original matches these recorded facts." : "Original evidence needs to be saved and verified before matching.")
        .font(.caption).foregroundStyle(payslip.hasAcceptedEvidence ? KittyTheme.secondary : KittyTheme.warning)
    }.accessibilityElement(children: .combine)
  }
}

private func validCloseReason(_ reason: String) -> Bool {
  let trimmed = reason.trimmingCharacters(in: .whitespacesAndNewlines)
  return trimmed.count >= 8 && trimmed.count <= 2000
}
