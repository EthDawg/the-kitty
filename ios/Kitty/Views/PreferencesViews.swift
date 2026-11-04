import SwiftUI

struct KittyPreferencesView: View {
  @EnvironmentObject var store: KittyStore
  var body: some View {
    List {
      Section {
        Text("These choices live in your Sheet and can be shared with other Kitty views.")
        if let reason = store.inputEditRestriction { Text(reason).font(.caption).foregroundStyle(KittyTheme.secondary) }
      }
      Section("Your preferences") {
        NavigationLink {
          SheetInputEditor(kind: .greeting, initialText: store.household?.preferences?.greeting ?? "")
        } label: { preferenceRow("Greeting", value: store.household?.preferences?.greeting ?? "Household name") }
          .accessibilityIdentifier("preferences.greeting")
        NavigationLink {
          SheetInputEditor(kind: .leadGoal, initialText: store.household?.preferences?.leadGoal ?? "")
        } label: { preferenceRow("Featured goal", value: store.household?.preferences?.leadGoal ?? "Automatic") }
          .accessibilityIdentifier("preferences.leadGoal")
        NavigationLink {
          SheetInputEditor(kind: .lookAheadDays,
            initialText: store.household?.preferences?.lookAheadDays.map { String($0) } ?? "")
        } label: { preferenceRow("Upcoming days", value: store.household?.preferences?.lookAheadDays.map { "\($0) days" } ?? "Not set · view uses 35 days") }
          .accessibilityIdentifier("preferences.lookAheadDays")
      }
      Section { SourceLink(label: "Kitty preferences", range: "Kitty!A:C") }
    }.navigationTitle("Household preferences").navigationBarTitleDisplayMode(.inline)
  }
  private func preferenceRow(_ title: String, value: String) -> some View {
    VStack(alignment: .leading, spacing: 5) {
      Text(title)
      Text(value).font(.subheadline).foregroundStyle(KittyTheme.secondary)
    }.accessibilityElement(children: .combine)
  }
}

struct SheetInputEditor: View {
  @EnvironmentObject var store: KittyStore
  @Environment(\.dismiss) private var dismiss
  @FocusState private var focused: Bool
  let kind: SheetInputKind
  let recordKey: String?
  @State private var text: String
  @State private var review: SheetInputEdit?
  @State private var message: String?

  init(kind: SheetInputKind, recordKey: String? = nil, initialText: String) {
    self.kind = kind; self.recordKey = recordKey; _text = State(initialValue: initialText)
  }

  var body: some View {
    Form {
      if store.inputEditsBlockNewWrites {
        InputEditRecoverySection()
      } else {
        Section(kind == .subscriptionDecision ? (recordKey ?? kind.title) : kind.title) {
          input.disabled(store.inputEditBusy || store.isDemo || !store.sheetCanEdit)
          Text(explanation).font(.caption).foregroundStyle(KittyTheme.secondary)
        }
        if let reason = store.inputEditRestriction {
          Section { Text(reason).foregroundStyle(KittyTheme.secondary) }
        }
        if let review {
          Section("Review your change") {
            reviewValue("Currently in the Sheet", review.kind.display(review.before))
            reviewValue("Your new value", review.kind.display(review.replacement))
            Text("Saving changes this input in \(review.sheetName). The Sheet recalculates its related figures.")
              .font(.caption).foregroundStyle(KittyTheme.secondary)
            SourceLink(label: "the input being changed", range: review.range)
            Button("Save and verify") {
              focused = false
              Task {
                do { try await store.saveInputEdit(review); dismiss() }
                catch {
                  message = error.localizedDescription
                  if !store.inputEditsBlockNewWrites { self.review = nil }
                }
              }
            }.disabled(store.inputEditRestriction != nil).accessibilityIdentifier("inputEdit.save")
          }.accessibilityIdentifier("inputEdit.review")
        } else {
          Section {
            Button("Review change") {
              focused = false; message = nil
              Task {
                do { review = try await store.prepareInputEdit(kind: kind, text: text, recordKey: recordKey) }
                catch { message = error.localizedDescription }
              }
            }.disabled(store.inputEditRestriction != nil).accessibilityIdentifier("inputEdit.prepare")
          }
        }
      }
      if store.inputEditBusy { Section { ProgressView("Checking your Sheet…") } }
      if let message { Section { Text(message).foregroundStyle(KittyTheme.warning) } }
    }.navigationTitle(kind.title).navigationBarTitleDisplayMode(.inline)
      .interactiveDismissDisabled(store.inputEditBusy)
      .onChange(of: text) { _, _ in review = nil; message = nil }
      .toolbar {
        ToolbarItemGroup(placement: .keyboard) {
          if focused { Spacer(); Button("Done") { focused = false } }
        }
      }
  }

  @ViewBuilder private var input: some View {
    switch kind {
    case .greeting:
      TextField("Name or greeting", text: $text).focused($focused)
        .accessibilityIdentifier("inputEdit.greeting")
    case .leadGoal:
      Picker("Featured goal", selection: $text) {
        Text("Automatic").tag("")
        if !text.isEmpty && store.household?.goals.contains(where: { $0.name == text }) != true {
          Text("No longer recorded: \(text)").tag(text)
        }
        ForEach(store.household?.goals ?? []) { goal in Text(goal.name).tag(goal.name) }
      }.accessibilityIdentifier("inputEdit.leadGoal")
    case .lookAheadDays, .safetyMonths:
      TextField(kind == .safetyMonths ? "Whole months" : "Whole days", text: $text)
        .keyboardType(.numberPad).focused($focused).accessibilityIdentifier("inputEdit.number")
    case .subscriptionDecision:
      Picker("Decision", selection: $text) {
        if !["Keep", "Review", "Cancel"].contains(text) { Text(text.isEmpty ? "Choose a decision" : text).tag(text) }
        ForEach(["Keep", "Review", "Cancel"], id: \.self) { Text($0).tag($0) }
      }.accessibilityIdentifier("inputEdit.decision")
    }
  }
  private var explanation: String {
    switch kind {
    case .greeting: return "Shown above your household name. Leave blank to use the household name without a separate greeting."
    case .leadGoal: return "Choose the goal shown on Home. Automatic uses the first goal that is not reached, then the first recorded goal."
    case .lookAheadDays: return "Choose 1 to 365 days for the Upcoming view. Dates remain estimates from your Sheet."
    case .safetyMonths: return "Choose 1 to 60 whole months of essential spending. This sets a target; it does not change account balances or create a coverage estimate."
    case .subscriptionDecision: return "Keep, Review or Cancel records your decision in the Sheet. It does not contact the provider, cancel a subscription or stop a payment."
    }
  }
  private func reviewValue(_ label: String, _ value: String) -> some View {
    VStack(alignment: .leading, spacing: 5) {
      Text(label).font(.caption).foregroundStyle(KittyTheme.secondary)
      Text(value).fixedSize(horizontal: false, vertical: true)
    }.accessibilityElement(children: .combine)
  }
}

struct InputEditRecoveryView: View {
  @EnvironmentObject var store: KittyStore
  var body: some View {
    List { InputEditRecoverySection() }
      .navigationTitle("Saved input change").navigationBarTitleDisplayMode(.inline)
  }
}

struct InputEditRecoverySection: View {
  @EnvironmentObject var store: KittyStore
  @State private var message: String?
  @State private var observation: SheetInputObservation?
  @State private var confirmingArchive = false
  private var unavailable: Bool {
    store.busy || store.inputEditBusy || store.importBusy || store.importEvidenceLoading
      || store.setupBusy || store.goalBusy || store.disconnecting
  }
  var body: some View {
    Section("Saved input change") {
      if store.inputEditLoadBlocked {
        Text("The saved review could not be verified. Its record is preserved. Check your Sheet before making another change.")
        Button("Retry local recovery") {
          store.loadPendingInputEdit()
          message = store.inputEditLoadBlocked ? "The saved review still needs repair. It has not been discarded." : nil
        }.disabled(unavailable).accessibilityIdentifier("inputEdit.retryLocal")
      } else if let edit = store.pendingInputEdit {
        Text("This change keeps its recovery record until the outcome is checked. Checking never sends the edit again.")
        if store.inputEditVisible {
          Text(edit.kind.title).font(.headline)
          Text("Reviewed value: \(edit.kind.display(edit.replacement))")
          SourceLink(label: "the reviewed input", range: edit.range)
          Button("Check saved change") {
            message = nil; observation = nil
            Task {
              do { try await store.checkPendingInputEdit() }
              catch { message = error.localizedDescription }
            }
          }.disabled(unavailable)
            .accessibilityIdentifier("inputEdit.check")
          if edit.outcome == .unverified {
            Button("Review current Sheet value") {
              message = nil; observation = nil
              Task {
                do { observation = try await store.observePendingInputEdit() }
                catch { message = error.localizedDescription }
              }
            }.disabled(unavailable).accessibilityIdentifier("inputEdit.observe")
            if let observation, observation.editID == edit.id {
              Text("Current Sheet value: \(edit.kind.display(observation.value))")
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("inputEdit.currentObservation")
              SourceLink(label: "the current input", range: "\(edit.kind.sheet)!\(edit.kind.column)\(observation.row)")
              Text("You can keep this value and archive the unresolved edit. Its original outcome will remain unverified.")
                .font(.caption).foregroundStyle(KittyTheme.secondary)
              Button("Keep current Sheet value") { confirmingArchive = true }
                .disabled(unavailable).accessibilityIdentifier("inputEdit.archive")
            }
          }
        } else {
          Text("Reconnect to the Sheet used for this change to view and check its saved review.")
        }
      } else {
        Text("There is no unresolved input change.")
      }
      if store.inputEditBusy { ProgressView("Checking the saved change…") }
      if let message { Text(message).foregroundStyle(KittyTheme.warning) }
    }.accessibilityIdentifier("inputEdit.recovery")
      .onChange(of: store.googleEpoch) { _, _ in
        observation = nil; confirmingArchive = false; message = nil
      }
      .alert("Keep the current Sheet value?", isPresented: $confirmingArchive) {
        Button("Keep current value") {
          guard let observation else { return }
          Task {
            do {
              try await store.archivePendingInputEdit(observation: observation)
              self.observation = nil; message = nil
            } catch { self.observation = nil; message = error.localizedDescription }
          }
        }.accessibilityIdentifier("inputEdit.confirmArchive")
        Button("Cancel", role: .cancel) {}
      } message: {
        Text("This ends the app's hold and saves an unresolved record. It sends no edit and cannot cancel a delayed request, which may still change the Sheet. Check the Sheet again before making further changes.")
      }
  }
}
