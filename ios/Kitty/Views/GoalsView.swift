import SwiftUI

struct GoalCard: View {
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  let goal: KittyGoal
  let currency: String
  var body: some View {
    KittyCard {
      HStack(alignment: .top) {
        VStack(alignment: .leading, spacing: 6) {
          Text(goal.name).font(.headline)
          if let date = goal.date {
            Text("Target: \(niceDate(date))").font(.caption).foregroundStyle(KittyTheme.secondary)
          }
        }
        Spacer()
        Image(systemName: goal.name.localizedCaseInsensitiveContains("trip") ? "airplane" : "flag")
          .font(.title2).foregroundStyle(KittyTheme.accent)
      }
      if let target = goal.target, target > 0, let balance = goal.balance {
        ProgressView(value: max(0, min(balance / target, 1))).tint(KittyTheme.accent)
          .accessibilityLabel("Goal progress").accessibilityValue(
            "\(money(balance,currency:currency)) of \(money(target,currency:currency))")
        (dynamicTypeSize.isAccessibilitySize
          ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4))
          : AnyLayout(HStackLayout(alignment: .firstTextBaseline))) {
          Text(money(balance, currency: currency, compact: true)).font(.title2.weight(.semibold))
            .monospacedDigit()
          Text("of \(money(target,currency:currency,compact:true))").font(.subheadline)
            .foregroundStyle(KittyTheme.secondary)
          if !dynamicTypeSize.isAccessibilitySize { Spacer() }
        }
        if balance >= target {
          Label("Target reached", systemImage: "checkmark.circle").font(.caption.weight(.medium))
            .foregroundStyle(KittyTheme.positive)
        }
      } else {
        Text("Set a target to see your progress.").foregroundStyle(KittyTheme.secondary)
      }
    }.accessibilityElement(children: .combine).accessibilityIdentifier("goalCard.\(goal.id)")
  }
}
struct GoalsView: View {
  @EnvironmentObject var store: KittyStore
  @State private var adding = false
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 20) {
        Text("Make room for what matters.").font(.title3).foregroundStyle(KittyTheme.secondary)
        DataStatusView()
        if store.goalWritesBlocked || store.goalDraft.remote != nil {
          KittyCard {
            Text(store.goalLoadBlocked ? "Saved goal review" : "Goal receipt").font(.headline)
            Text(store.goalLoadBlocked ? "A saved review needs local recovery before another goal can be created." : "Check the saved goal's outcome or cancel it before creating another.")
              .font(.subheadline).foregroundStyle(KittyTheme.secondary)
            Button("Open saved review") { adding = true }.accessibilityIdentifier("goals.recovery")
          }
        }
        ForEach(store.household?.goals ?? []) { goal in
          NavigationLink {
            GoalDetailView(goal: goal)
          } label: {
            GoalCard(goal: goal, currency: store.currency)
          }.buttonStyle(.plain)
        }
        if store.household?.goals.isEmpty != false {
          EmptyState(
            title: "What are you saving for?",
            message: store.isDemo ? "Demo goals are fictional. Connect your own Sheet to make a plan." : "Give your next goal a name, target and savings account.", symbol: "flag")
          Button("Add a goal") { adding = true }.buttonStyle(PrimaryButton()).disabled(!store.isDemo && !store.sheetCanEdit)
        }
      }.padding(20).frame(maxWidth: 700)
    }.frame(maxWidth: .infinity).kittyBackground().navigationTitle("Goals").refreshable {
      await store.refresh()
    }
    .toolbar {
      ToolbarItem(placement: .primaryAction) {
        Button { adding = true } label: { Label("Add goal", systemImage: "plus") }
          .disabled(!store.isDemo && !store.sheetCanEdit && !store.goalWritesBlocked)
          .accessibilityIdentifier("goals.add")
      }
    }
    .sheet(isPresented: $adding) { NavigationStack { GoalCreationView() }.kittyFeedback() }
  }
}

struct GoalCreationView: View {
  @EnvironmentObject var store: KittyStore
  @Environment(\.dismiss) private var dismiss
  @State private var name = ""
  @State private var target = ""
  @State private var date = Date()
  @State private var accountID = ""
  @State private var localError: String?
  @FocusState private var inputFocused: Bool
  private var accounts: [KittyAccount] {
    (store.household?.accounts ?? []).filter { $0.liquid && ["Transaction", "Savings", "Offset"].contains($0.type) }
  }
  private var selectedAccountName: String {
    accounts.first { $0.id == accountID }?.name ?? "Choose an account"
  }
  var body: some View {
    Form {
      if store.goalLoadBlocked {
        Section("Saved review needs recovery") {
          Text("The earlier recovery file is preserved. Reconnect Google if needed, then retry reading it. A new goal cannot be submitted while its outcome is unknown.")
          Button("Retry local recovery") { store.loadGoalDraft() }
          Button("Open connection settings") { dismiss(); store.showSettings = true }
        }
      } else if let remote = store.goalDraft.remote {
        if store.goalReviewVisible { review(remote) }
        else {
          Section("Saved goal recovery") {
            Text("This review belongs to its original Sheet. Select that Sheet and refresh to see the approved goal. Its receipt can still be checked or safely cancelled after reconnecting Google.")
            if ["verified", "cancelled"].contains(remote.status) {
              Button("Finish saved review") { store.discardGoalDraft(); restoreForm(clear: true) }.disabled(store.goalBusy)
            } else {
              Button("Check saved goal") { Task { await store.checkGoalStatus() } }.disabled(store.goalBusy)
              Button("Cancel if not started") { Task { await store.cancelNewGoal() } }.disabled(store.goalBusy)
            }
            Button("Open connection settings") { dismiss(); store.showSettings = true }
          }
        }
      } else {
        Section("What are you saving for?") {
          TextField("Goal name", text: $name).focused($inputFocused).accessibilityIdentifier("goal.name")
          TextField("Target amount (\(store.currency))", text: $target).keyboardType(.decimalPad).focused($inputFocused).accessibilityIdentifier("goal.target")
          DatePicker("Target date", selection: $date, displayedComponents: .date)
            .environment(\.timeZone, TimeZone(secondsFromGMT: 0)!).accessibilityIdentifier("goal.date")
          VStack(alignment: .leading, spacing: 8) {
            Text("Money sits in")
            Menu {
              ForEach(accounts) { account in
                Button(account.name) { accountID = account.id }
              }
            } label: {
              HStack(alignment: .top, spacing: 12) {
                Text(selectedAccountName).fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
                Image(systemName: "chevron.up.chevron.down").font(.caption).accessibilityHidden(true)
              }.frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            }
            .accessibilityLabel("Goal account").accessibilityValue(selectedAccountName)
            .accessibilityIdentifier("goal.account")
          }
        }
        Section {
          Text("Progress comes from the linked account. Creating a goal adds a plan, not another balance or a transfer.")
          Text("The Kitty checks the current Sheet and prepares a saved review before you confirm the new row.")
            .font(.subheadline).foregroundStyle(KittyTheme.secondary)
          if store.isDemo {
            Text("Demo goals are fictional and read-only. Connect your Sheet to save your own goals.")
              .foregroundStyle(KittyTheme.secondary)
          }
          if let message = store.importPublicationNotice { Text(message).foregroundStyle(.orange) }
          if store.serviceURL == nil && !store.isDemo {
            Text("Native goal creation is not configured in this development build. You can set up a goal in the Sheet, then refresh here.").font(.subheadline)
          }
          SourceLink(label: "Goals tab", range: "Goals!A1:J")
          Button {
            Task {
              localError = nil
              do {
                let goal = GoalInput(name: name.trimmingCharacters(in: .whitespacesAndNewlines).precomposedStringWithCanonicalMapping,
                  targetMinor: try GoalInput.amountMinor(target), targetDate: GoalInput.day(date), accountId: accountID, currency: store.currency)
                try goal.validate()
                await store.prepareNewGoal(goal)
              } catch { localError = error.localizedDescription }
            }
          } label: { if store.goalBusy { ProgressView() } else { Text("Review goal") } }
            .disabled(store.goalBusy || store.serviceURL == nil || store.isDemo || !store.sheetCanEdit || store.importPublicationNotice != nil)
            .accessibilityIdentifier("goal.review")
        }
      }
      if let message = localError ?? store.goalDraft.error ?? store.error {
        Section { Text(message).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true) }
      }
    }.scrollDismissesKeyboard(.interactively).navigationTitle(store.goalDraft.remote == nil ? "Add goal" : "Saved goal review")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() }.disabled(store.goalBusy) }
        ToolbarItemGroup(placement: .keyboard) { Spacer(); Button("Done") { inputFocused = false }.accessibilityIdentifier("goal.keyboardDone") }
      }
      .interactiveDismissDisabled(store.goalBusy)
      .onAppear { restoreForm() }
  }
  @ViewBuilder private func review(_ remote: GoalRemoteBinding) -> some View {
    Section("Approved goal") {
      LabeledContent("Name", value: remote.goal.name)
      LabeledContent("Target", value: "\(remote.goal.currency) \(remote.goal.amountText)")
      LabeledContent("By", value: niceDate(remote.goal.targetDate))
      LabeledContent("Account", value: accounts.first { $0.id == remote.goal.accountId }?.name ?? remote.goal.accountId)
      Text(store.goalDraft.sheetName.isEmpty ? "Saved to the originally selected Sheet." : "Sheet: \(store.goalDraft.sheetName)")
        .font(.caption).foregroundStyle(KittyTheme.secondary)
    }
    Section {
      if remote.status == "verified" {
        Label("Goal saved and verified", systemImage: "checkmark.circle").foregroundStyle(KittyTheme.positive)
        Text("The new goal, its formulas and linked balance were checked in your Sheet.")
        Button("Add another goal") { store.discardGoalDraft(); restoreForm(clear: true) }
          .accessibilityIdentifier("goal.another")
      } else if remote.status == "cancelled" {
        Text("Creation cancelled. This receipt added no goal.")
        Button("Start a fresh review") { store.discardGoalDraft(); restoreForm() }
      } else {
        Text(remote.attempted || remote.recoveryOnly ? "This create request will not be repeated. Check the saved receipt to find out whether the goal was written." : "Your review is saved. Confirm to add this goal and verify the result.")
          .font(.subheadline)
        ForEach(Array((store.goalDraft.lastResult?.issues ?? []).enumerated()), id: \.offset) { _, issue in
          Text(issue.message).font(.subheadline).foregroundStyle(.orange)
        }
        if store.goalDraft.canCommit {
          Button("Add goal and verify") { Task { await store.commitNewGoal() } }
            .disabled(store.goalBusy).accessibilityIdentifier("goal.commit")
        }
        Button("Check saved goal") { Task { await store.checkGoalStatus() } }
          .disabled(store.goalBusy).accessibilityIdentifier("goal.check")
        Button("Cancel if not started") { Task { await store.cancelNewGoal() } }
          .disabled(store.goalBusy).accessibilityIdentifier("goal.cancel")
        if store.goalBusy { ProgressView() }
      }
      if store.selectedSheetID == store.goalDraft.sheetID { SourceLink(label: "Goals tab", range: "Goals!A1:J") }
    }
  }
  private func restoreForm(clear: Bool = false) {
    if !clear, store.goalReviewVisible, let goal = store.goalDraft.approvedGoal {
      name = goal.name; target = goal.amountText; accountID = goal.accountId
      date = GoalInput.dateFormatter.date(from: goal.targetDate) ?? Date()
    } else {
      name = ""; target = ""; accountID = accounts.count == 1 ? accounts[0].id : ""
      var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone(secondsFromGMT: 0)!
      let anchor = GoalInput.dateFormatter.date(from: store.household?.asOf ?? "") ?? Date()
      date = calendar.date(byAdding: .year, value: 1, to: anchor) ?? anchor
    }
  }
}
struct GoalDetailView: View {
  @EnvironmentObject var store: KittyStore
  let goal: KittyGoal
  @State private var editing = false
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 24) {
        Image("GoalCat").resizable().scaledToFit().frame(height: 170).frame(maxWidth: .infinity)
          .accessibilityHidden(true)
        GoalCard(goal: currentGoal, currency: store.currency)
        KittyCard {
          SectionTitle(title: "The plan")
          Text(
            "Progress comes from your linked account. It isn’t another balance to add to your total."
          ).font(.subheadline).foregroundStyle(KittyTheme.secondary)
          LabeledContent(
            "Saved per month", value: money(currentGoal.savedPm, currency: store.currency))
          Text("Average over the last three months.").font(.caption).foregroundStyle(
            KittyTheme.secondary)
          LabeledContent(
            "Needed per month", value: money(currentGoal.needPm, currency: store.currency))
          SourceLink(label: "Goals tab", range: "Goals!A\(currentGoal.row):J\(currentGoal.row)")
        }
        Button("Edit target") { editing = true }.buttonStyle(PrimaryButton())
          .disabled(!store.isDemo && !store.sheetCanEdit)
        if !store.isDemo && !store.sheetCanEdit {
          Text("You have view-only access. The Sheet owner can grant edit access if you want to change this goal.")
            .font(.caption).foregroundStyle(KittyTheme.secondary)
        }
      }.padding(20).frame(maxWidth: 650)
    }.frame(maxWidth: .infinity).kittyBackground().navigationTitle(goal.name)
      .navigationBarTitleDisplayMode(.inline).sheet(isPresented: $editing) {
        NavigationStack { GoalEditor(goal: currentGoal) }.kittyFeedback()
      }
  }
  var currentGoal: KittyGoal { store.household?.goals.first { $0.name == goal.name } ?? goal }
}
struct GoalEditor: View {
  @EnvironmentObject var store: KittyStore
  @Environment(\.dismiss) var dismiss
  let goal: KittyGoal
  @State var target = ""
  @State var date = Date()
  @State var saving = false
  @State var error: String?
  var body: some View {
    Form {
      Section("Your target") {
        TextField("Amount", text: $target).keyboardType(.decimalPad)
        DatePicker("Target date", selection: $date, displayedComponents: .date)
      }
      Section {
        Text(
          "The Kitty checks the existing goal before saving, then rereads the Sheet to confirm the change."
        ).font(.subheadline)
        if store.isDemo {
          Text(
            "Demo goals are fictional and read-only. Connect your Sheet to save your own targets."
          ).foregroundStyle(KittyTheme.secondary)
        }
      }
      if let error { Section { Text(error).foregroundStyle(.red) } }
      Section {
        Button {
          Task {
            saving = true
            defer { saving = false }
            do {
              guard let amount = Double(target.replacingOccurrences(of: ",", with: "")) else {
                throw KittyError.message("Enter a valid amount.")
              }
              let f = DateFormatter()
              f.dateFormat = "yyyy-MM-dd"
              f.locale = Locale(identifier: "en_US_POSIX")
              try await store.updateGoal(goal, target: amount, date: f.string(from: date))
              dismiss()
            } catch { self.error = error.localizedDescription }
          }
        } label: {
          if saving { ProgressView() } else { Text("Save and verify") }
        }.disabled(saving || store.isDemo || !store.sheetCanEdit)
      }
    }.navigationTitle("Edit goal").toolbar {
      ToolbarItem(placement: .cancellationAction) {
        Button("Cancel") { dismiss() }.disabled(saving)
      }
    }.interactiveDismissDisabled(saving).onAppear {
      target = String(format: "%.2f", goal.target ?? 0)
      let f = DateFormatter()
      f.dateFormat = "yyyy-MM-dd"
      date = f.date(from: goal.date ?? "") ?? Date()
    }
  }
}
