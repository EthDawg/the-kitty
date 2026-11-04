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
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 20) {
        Text("Make room for what matters.").font(.title3).foregroundStyle(KittyTheme.secondary)
        DataStatusView()
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
            message: "Add a goal in your Sheet, then refresh to bring it here.", symbol: "flag")
        }
      }.padding(20).frame(maxWidth: 700)
    }.frame(maxWidth: .infinity).kittyBackground().navigationTitle("Goals").refreshable {
      await store.refresh()
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
        NavigationStack { GoalEditor(goal: currentGoal) }
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
