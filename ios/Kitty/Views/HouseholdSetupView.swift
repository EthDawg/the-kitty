import SwiftUI

struct HouseholdSetupView: View {
  @EnvironmentObject var store: KittyStore
  @Environment(\.dismiss) private var dismiss
  @FocusState private var focused: String?
  @State private var showReview = false
  @State private var validationMessage: String?
  @State private var confirmDiscard = false

  var body: some View {
    Group {
      if store.setupLoadBlocked {
        ContentUnavailableView {
          Label("Setup needs checking", systemImage: "exclamationmark.shield")
        } description: {
          Text("The saved recovery record could not be read or cleared. It has been preserved so another Sheet is not created by mistake.")
        } actions: {
          Button("Retry local recovery") { store.loadHouseholdSetup() }
            .accessibilityIdentifier("setup.retryRecovery")
        }
      } else if store.setupDraft.isLocked {
        recovery
      } else {
        editor
      }
    }
    .navigationTitle(store.setupDraft.isLocked ? "Your new household" : "Start your household")
    .navigationBarTitleDisplayMode(.inline)
    .interactiveDismissDisabled(store.setupBusy)
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) {
        Button("Done") { dismiss() }.disabled(store.setupBusy)
      }
      ToolbarItemGroup(placement: .keyboard) {
        if focused != nil { Spacer(); Button("Done") { focused = nil }.accessibilityIdentifier("setup.keyboardDone") }
      }
    }
    .sheet(isPresented: $showReview) {
      NavigationStack { HouseholdSetupReviewView().environmentObject(store) }.kittyFeedback()
        .interactiveDismissDisabled(store.setupBusy)
    }
    .onChange(of: store.setupDraft) { _, _ in
      if !store.setupBusy { store.saveHouseholdSetupEdits() }
      if store.setupDraft.isLocked { showReview = false }
    }
    .confirmationDialog("Discard this setup draft?", isPresented: $confirmDiscard, titleVisibility: .visible) {
      Button("Discard draft", role: .destructive) { store.discardHouseholdSetup() }
    } message: { Text("This removes the unsubmitted details from this device. It does not delete any Google Sheet.") }
  }

  private var editor: some View {
    Form {
      Section {
        Text("A fresh Sheet, owned by you").font(.headline)
        Text("Start with your people, accounts and opening balances. Your first import begins after that opening date.")
          .foregroundStyle(KittyTheme.secondary)
        Text("Australia · Australian dollars").font(.caption).foregroundStyle(KittyTheme.secondary)
      }
      Section("Your household") {
        TextField("Household name", text: $store.setupDraft.householdName)
          .focused($focused, equals: "household").accessibilityIdentifier("setup.household")
        TextField("First person's name", text: $store.setupDraft.firstPerson)
          .textContentType(.givenName).focused($focused, equals: "first").accessibilityIdentifier("setup.firstPerson")
        Toggle("Add a second person", isOn: $store.setupDraft.includesSecondPerson)
          .accessibilityIdentifier("setup.secondPersonToggle")
        if store.setupDraft.includesSecondPerson {
          TextField("Second person's name", text: $store.setupDraft.secondPerson)
            .textContentType(.givenName).focused($focused, equals: "second")
        }
      }
      Section {
        DatePicker("Opening balances at", selection: $store.setupDraft.openingDate,
          in: ...HouseholdSetupDraft.defaultOpeningDate(), displayedComponents: .date)
          .environment(\.timeZone, HouseholdSetupDraft.calendar.timeZone)
          .accessibilityIdentifier("setup.openingDate")
        Text("Choose a completed month-end. Use the balances on that date, before the first month you want to import. Earlier history will stay unavailable.")
          .font(.caption).foregroundStyle(KittyTheme.secondary)
      } header: { Text("Where your history starts") }
      Section("Accounts") {
        ForEach($store.setupDraft.accounts) { $account in
          NavigationLink {
            HouseholdSetupAccountView(account: $account, people: store.setupDraft.people)
          } label: {
            VStack(alignment: .leading, spacing: 5) {
              Text(account.name.isEmpty ? "Add account details" : account.name).font(.headline)
              if let minor = try? HouseholdSetupDraft.minor(account.openingAmount, owed: account.isOwed) {
                Text("\(account.type) · \(HouseholdSetupDraft.money(minor: minor))")
                  .font(.subheadline).foregroundStyle(KittyTheme.secondary)
              } else {
                Text("Name, owner and opening balance").font(.subheadline).foregroundStyle(KittyTheme.secondary)
              }
            }
          }.accessibilityIdentifier("setup.account.\(account.id)")
        }
        .onDelete { offsets in
          guard store.setupDraft.accounts.count > offsets.count else { return }
          store.setupDraft.accounts.remove(atOffsets: offsets)
        }
        if store.setupDraft.accounts.count < 20 {
          Button("Add another account", systemImage: "plus") {
            store.setupDraft.accounts.append(HouseholdSetupAccount())
          }
        }
      }
      Section("Optional starting choices") {
        Picker("Emergency fund account", selection: $store.setupDraft.emergencyAccountId) {
          Text("Set up later").tag("")
          ForEach(store.setupDraft.accounts.filter { $0.type != "Credit card" }) { account in
            Text(account.name.isEmpty ? "Unnamed account" : account.name).tag(account.id)
          }
        }
        Toggle("Add a savings goal", isOn: $store.setupDraft.includesGoal)
        if store.setupDraft.includesGoal {
          TextField("Goal name", text: $store.setupDraft.goalName).focused($focused, equals: "goal")
          TextField("Target amount in AUD", text: $store.setupDraft.goalAmount).keyboardType(.decimalPad)
            .focused($focused, equals: "target")
          DatePicker("Target date", selection: $store.setupDraft.goalDate, displayedComponents: .date)
            .environment(\.timeZone, HouseholdSetupDraft.calendar.timeZone)
          Picker("Goal's account", selection: $store.setupDraft.goalAccountId) {
            Text("Choose an account").tag("")
            ForEach(store.setupDraft.accounts.filter { $0.type != "Credit card" }) { account in
              Text(account.name.isEmpty ? "Unnamed account" : account.name).tag(account.id)
            }
          }
        }
      }
      Section {
        Text("This setup starts with cash accounts, activity and an optional goal. Budgets, loans, assets, subscriptions and tax estimates stay unconfigured; no demo amounts are carried over.")
          .font(.subheadline).foregroundStyle(KittyTheme.secondary)
        Button("Review my setup") {
          focused = nil
          do { _ = try store.setupDraft.approvedPayload(); validationMessage = nil; showReview = true }
          catch { validationMessage = error.localizedDescription }
        }.accessibilityIdentifier("setup.review")
        if let validationMessage { Text(validationMessage).foregroundStyle(KittyTheme.warning) }
        Button("Discard draft", role: .destructive) { confirmDiscard = true }
      }
    }.scrollDismissesKeyboard(.interactively).onDisappear { focused = nil }
  }

  private var recovery: some View {
    List {
      Section {
        Label(statusTitle, systemImage: store.setupDraft.lastResult?.status == .verified ? "checkmark.shield" : "clock.arrow.circlepath")
          .font(.headline).fixedSize(horizontal: false, vertical: true)
        Text(statusExplanation).fixedSize(horizontal: false, vertical: true)
        if store.setupBusy { ProgressView("Checking your setup…") }
        if let message = store.setupDraft.lastMessage { Text(message).foregroundStyle(KittyTheme.warning) }
        ForEach(Array((store.setupDraft.lastResult?.issues ?? []).enumerated()), id: \.offset) { _, issue in
          Text(issue.message).foregroundStyle(KittyTheme.warning)
        }
      }
      Section {
        if store.setupDraft.lastResult?.status == .verified {
          Button("Open my household") { Task { await store.openCreatedHousehold() } }
            .accessibilityIdentifier("setup.openCreated")
          Button("Start another household") { store.discardHouseholdSetup() }
            .accessibilityIdentifier("setup.startAnother")
          Text("Your completed Sheet stays in Google Drive. This starts a new, empty setup on this device.")
            .font(.caption).foregroundStyle(KittyTheme.secondary)
        } else if store.setupDraft.lastResult?.status == .cancelled {
          Button("Start a fresh setup") { store.discardHouseholdSetup() }
        } else {
          Button("Check saved setup") { Task { await store.checkHouseholdSetup() } }
            .accessibilityIdentifier("setup.check")
          if store.setupDraft.lastResult == nil || store.setupDraft.lastResult?.canContinue == true {
            Button("Continue approved setup") { Task { await store.resumeHouseholdSetup() } }
          }
          if store.setupDraft.lastResult == nil || store.setupDraft.lastResult?.status == .unknown
            || store.setupDraft.lastResult?.canCancel == true {
            Button("Cancel if creation has not started", role: .destructive) {
              Task { await store.cancelHouseholdSetup() }
            }
          }
        }
      }.disabled(store.setupBusy || store.busy)
    }.accessibilityIdentifier("setup.recovery")
  }

  private var statusTitle: String {
    switch store.setupDraft.lastResult?.status {
    case .verified: return "Your Sheet is ready"
    case .cancelled: return "Setup cancelled"
    case .conflict: return "This setup needs checking"
    case .unknown: return "The outcome is not confirmed yet"
    default: return "Your setup is saved for recovery"
    }
  }
  private var statusExplanation: String {
    switch store.setupDraft.lastResult?.status {
    case .verified: return "The setup service verified the new Sheet and opening balances. Your first month is still awaiting import and reconciliation."
    case .cancelled: return "The service confirmed cancellation before workbook creation. Your existing Sheets were not replaced."
    default: return "Reconnect with the Google account used for this setup. The saved operation will be checked before anything continues; a connection error does not mean a second Sheet should be created."
    }
  }
}

private struct HouseholdSetupAccountView: View {
  @Binding var account: HouseholdSetupAccount
  let people: [String]
  @FocusState private var focused: String?
  var body: some View {
    Form {
      TextField("Account name", text: $account.name).focused($focused, equals: "name")
        .accessibilityIdentifier("setup.accountName")
      TextField("Bank or institution", text: $account.institution).focused($focused, equals: "institution")
        .accessibilityIdentifier("setup.institution")
      Picker("Account type", selection: $account.type) {
        ForEach(HouseholdSetupAccount.types, id: \.self) { Text($0).tag($0) }
      }
      Picker("Owner", selection: $account.owner) {
        Text("Joint").tag("Joint")
        ForEach(Array(Set(people.filter { !$0.isEmpty })).sorted(), id: \.self) { Text($0).tag($0) }
      }
      Section {
        TextField("Amount in AUD", text: $account.openingAmount).keyboardType(.decimalPad)
          .focused($focused, equals: "amount").accessibilityIdentifier("setup.openingAmount")
        Picker("This balance is", selection: $account.isOwed) {
          Text("Money held").tag(false)
          Text("Money owed").tag(true)
        }
        Text("Use the exact balance at the chosen opening month-end. Choose Money owed for a card balance you need to repay. Do not include transactions that happened afterwards.")
          .font(.caption).foregroundStyle(KittyTheme.secondary)
      } header: { Text("Opening balance") }
    }.navigationTitle("Account details").navigationBarTitleDisplayMode(.inline)
      .scrollDismissesKeyboard(.interactively)
      .onChange(of: account.type) { _, type in
        if account.openingAmount.isEmpty { account.isOwed = type == "Credit card" }
      }
      .toolbar { ToolbarItemGroup(placement: .keyboard) { Spacer(); Button("Done") { focused = nil }.accessibilityIdentifier("setup.accountKeyboardDone") } }
  }
}

private struct HouseholdSetupReviewView: View {
  @EnvironmentObject var store: KittyStore
  @Environment(\.dismiss) private var dismiss
  var body: some View {
    List {
      Section("A new Sheet in your Google Drive") {
        Text(HouseholdSetupDraft.cleanName(store.setupDraft.householdName)).font(.headline)
        Text(store.setupDraft.people.joined(separator: " · "))
        Text("Australia · AUD")
        Text("Opening balances: \(HouseholdSetupDraft.day(store.setupDraft.openingDate))")
      }
      Section("Your opening balances") {
        ForEach(store.setupDraft.accounts) { account in
          VStack(alignment: .leading, spacing: 6) {
            Text(HouseholdSetupDraft.cleanName(account.name)).font(.headline)
            Text("\(HouseholdSetupDraft.cleanName(account.institution)) · \(account.type) · \(account.owner)")
              .foregroundStyle(KittyTheme.secondary)
            if let value = try? HouseholdSetupDraft.minor(account.openingAmount, owed: account.isOwed) {
              Text(HouseholdSetupDraft.money(minor: value)).monospacedDigit()
              Text(account.isOwed ? "Money owed" : "Money held").font(.caption)
            }
          }.accessibilityElement(children: .combine)
        }
      }
      if !store.setupDraft.emergencyAccountId.isEmpty {
        Section("Emergency fund") {
          Text(store.setupDraft.accounts.first { $0.id == store.setupDraft.emergencyAccountId }?.name ?? "")
        }
      }
      if store.setupDraft.includesGoal {
        Section("Your goal") {
          Text(store.setupDraft.goalName).font(.headline)
          if let minor = try? HouseholdSetupDraft.minor(store.setupDraft.goalAmount) {
            Text("\(HouseholdSetupDraft.money(minor: minor)) by \(HouseholdSetupDraft.day(store.setupDraft.goalDate))")
          }
          Text(store.setupDraft.accounts.first { $0.id == store.setupDraft.goalAccountId }?.name ?? "")
        }
      }
      Section {
        Text("Creating sends these reviewed settings to The Kitty service and saves the new Sheet and recovery record in your Google Drive. Existing Sheets are not replaced. No transactions, tax estimates or mortgage figures are invented.")
          .font(.subheadline).foregroundStyle(KittyTheme.secondary)
        Button("Create my household Sheet") { Task { await store.createHousehold() } }
          .disabled(store.setupBusy || store.busy).accessibilityIdentifier("setup.create")
        if store.setupBusy { ProgressView("Creating and checking…") }
        if store.serviceURL == nil {
          Text("Live creation is not configured in this development build. This review stays on your device.")
            .font(.caption).foregroundStyle(KittyTheme.secondary)
        }
      }
    }.navigationTitle("Review your setup").navigationBarTitleDisplayMode(.inline)
      .toolbar { ToolbarItem(placement: .topBarLeading) { Button("Back") { dismiss() }.disabled(store.setupBusy) } }
  }
}
