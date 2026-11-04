import SwiftUI

struct HomeView: View {
  @EnvironmentObject var store: KittyStore
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  var body: some View {
    ScrollView {
      if let h = store.household {
        VStack(alignment: .leading, spacing: 24) {
          HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 5) {
              if let greeting = h.preferences?.greeting {
                Text("Hello, \(greeting).").font(.subheadline).foregroundStyle(KittyTheme.secondary)
                  .accessibilityIdentifier("home.greeting")
              }
              Text(h.household).font(.largeTitle.weight(.bold))
              Text("A little clarity for your day.").foregroundStyle(KittyTheme.secondary)
            }
            if !dynamicTypeSize.isAccessibilitySize {
              Spacer()
              Image("Welcome").resizable().scaledToFit().frame(width: 64, height: 72)
                .accessibilityHidden(true)
            }
          }
          DataStatusView()
          Button {
            store.showAccounts = true
          } label: {
            VStack(alignment: .leading, spacing: 18) {
              HStack {
                Text("Cash across your accounts").font(.subheadline.weight(.medium))
                Spacer()
                Image(systemName: "arrow.up.right")
              }
              Text(money(h.value("networth.cash"), currency: h.currency)).font(
                .system(.largeTitle, design: .rounded, weight: .semibold)
              ).monospacedDigit().minimumScaleFactor(0.6).lineLimit(1)
              Text("As of \(niceDate(h.asOf))\(h.accounts.contains(where: { $0.type.lowercased() == "offset" }) ? " · Includes your offset" : "")").font(.caption)
                .foregroundStyle(Color.white.opacity(0.82))
              Divider().overlay(Color.white.opacity(0.25))
              (dynamicTypeSize.isAccessibilitySize
                ? AnyLayout(VStackLayout(alignment: .leading, spacing: 16))
                : AnyLayout(HStackLayout(alignment: .top))) {
                heroFact("Income", h.value("cashflow.income.month"))
                if !dynamicTypeSize.isAccessibilitySize { Spacer() }
                heroFact("Spending", h.value("cashflow.spending.month"))
                if !dynamicTypeSize.isAccessibilitySize { Spacer() }
                heroFact("Left over", h.value("cashflow.net.month"))
              }
              Text(h.metrics["cashflow.net.month"]?.period ?? "Latest month").font(.caption)
                .foregroundStyle(.white.opacity(0.75))
              if ["cashflow.income.month", "cashflow.spending.month", "cashflow.net.month"].allSatisfy({ h.value($0) == nil }) {
                Text("Monthly totals appear after importing and reconciling a period.").font(.caption)
                  .foregroundStyle(.white.opacity(0.85)).accessibilityIdentifier("home.monthlyUnavailable")
              }
            }.padding(24).foregroundStyle(.white).background(
              KittyTheme.hero, in: RoundedRectangle(cornerRadius: 27))
          }.buttonStyle(.plain).accessibilityIdentifier("cashCard")
          HStack(spacing: 12) {
            Button {
              store.showImport = true
            } label: {
              Label("Import a statement", systemImage: "plus.circle").font(.subheadline.bold())
                .frame(maxWidth: .infinity, minHeight: 50).background(
                  KittyTheme.soft, in: RoundedRectangle(cornerRadius: 15))
            }.accessibilityIdentifier("importStatement")
            Button {
              store.selectedTab = 4
            } label: {
              Image(systemName: "bubble.left.and.bubble.right").frame(width: 54, height: 50)
                .background(KittyTheme.surface, in: RoundedRectangle(cornerRadius: 15))
            }.accessibilityLabel("Ask about your money")
          }
          if let goal = h.featuredGoal {
            VStack(alignment: .leading, spacing: 14) {
              HStack {
                SectionTitle(title: "Something to look forward to")
                Spacer()
              }
              NavigationLink {
                GoalDetailView(goal: goal)
              } label: {
                GoalCard(goal: goal, currency: h.currency)
              }.buttonStyle(.plain)
            }
          }
          KittyCard {
            HStack {
              SectionTitle(title: "Worth a look")
              Spacer()
              Image(systemName: "magnifyingglass").foregroundStyle(KittyTheme.accent)
            }
            let count = h.transactions.filter { $0.cat == "UNCAT" }.count
            if count > 0 {
              Button {
                store.openActivity(.uncategorised)
              } label: {
                HStack {
                  Image(systemName: "tag").font(.title3)
                  VStack(alignment: .leading, spacing: 4) {
                    Text("\(count) transactions need a category").font(.subheadline.bold())
                    Text("A few details will make the picture clearer.").font(.caption)
                      .foregroundStyle(KittyTheme.secondary)
                  }
                  Spacer()
                  Image(systemName: "chevron.right").font(.caption)
                }
              }.accessibilityIdentifier("home.reviewCategories")
            } else {
              Text("No uncategorised transactions in this view.").foregroundStyle(
                KittyTheme.secondary)
            }
            NavigationLink {
              ChecksView()
            } label: {
              Label("See the Sheet's checks", systemImage: "checkmark.shield").font(.subheadline)
            }
          }
          VStack(alignment: .leading, spacing: 14) {
            SectionTitle(title: "Recent activity")
            KittyCard {
              if h.transactions.isEmpty {
                Text("No activity has been imported yet.").foregroundStyle(KittyTheme.secondary)
                  .accessibilityIdentifier("home.emptyActivity")
              }
              ForEach(h.transactions.prefix(4)) { tx in
                NavigationLink {
                  TransactionDetailView(transaction: tx)
                } label: {
                  TransactionRow(transaction: tx, currency: h.currency)
                }.buttonStyle(.plain)
                if tx.id != h.transactions.prefix(4).last?.id { Divider() }
              }
              if !h.transactions.isEmpty {
                Button("View all activity") { store.openActivity() }.font(.subheadline.bold()).frame(
                  minHeight: 44)
                  .accessibilityIdentifier("home.allActivity")
              }
            }
          }
          Text("Your Sheet owns the numbers. The Kitty helps you see them.").font(.caption)
            .foregroundStyle(KittyTheme.secondary).frame(maxWidth: .infinity)
            .multilineTextAlignment(.center)
        }.padding(20).frame(maxWidth: 720)
      } else {
        EmptyState(
          title: "Your household is loading", message: "Your Sheet’s figures will appear here.")
      }
    }.frame(maxWidth: .infinity).kittyBackground().navigationTitle("The Kitty")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .topBarTrailing) {
          Button {
            store.showSettings = true
          } label: {
            Image(systemName: "gearshape")
          }.accessibilityLabel("Settings")
        }
      }
      .refreshable { await store.refresh() }
  }
  func heroFact(_ title: String, _ amount: Double?) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(title).font(.caption).foregroundStyle(.white.opacity(0.8))
      Text(money(amount, currency: store.currency, compact: true)).font(.subheadline.bold())
        .monospacedDigit().minimumScaleFactor(0.7).lineLimit(1)
    }
  }
}
struct DataStatusView: View {
  @EnvironmentObject var store: KittyStore
  var body: some View {
    HStack(spacing: 8) {
      Image(
        systemName: store.isDemo ? "sparkles" : store.isOffline ? "wifi.slash" : "checkmark.icloud")
      Text(
        store.isDemo
          ? "Fictional demo · \(store.household.map { monthYear($0.asOf) } ?? "Date not available")"
          : store.isOffline
            ? "Offline · showing your last saved Sheet" : "Connected to your Google Sheet")
      if store.busy { ProgressView().controlSize(.small) }
    }.font(.caption.weight(.medium)).foregroundStyle(
      store.isOffline ? KittyTheme.warning : KittyTheme.secondary
    ).accessibilityIdentifier("dataStatus")
  }
}
struct AccountsView: View {
  @EnvironmentObject var store: KittyStore
  @Environment(\.dismiss) var dismiss
  var body: some View {
    List {
      Section {
        Text(
          "Cash is the total recorded across these accounts. It isn’t a promise of what’s available to spend."
        ).font(.subheadline).foregroundStyle(KittyTheme.secondary)
      }
      ForEach(store.household?.accounts ?? []) { a in
        Section {
          LabeledContent(a.name) {
            Text(money(a.balance, currency: store.currency)).monospacedDigit()
          }
          Text("\(a.bank) · \(a.owner) · \(a.type)").font(.caption).foregroundStyle(
            KittyTheme.secondary)
        }
      }
      Section { SourceLink(label: "Accounts tab", range: "Accounts!A:I") }
    }.navigationTitle("Your accounts").toolbar {
      ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } }
    }
  }
}
struct SourceLink: View {
  @EnvironmentObject var store: KittyStore
  let label: String
  let range: String
  var body: some View {
    if !store.selectedSheetID.isEmpty,
      let url = URL(
        string:
          "https://docs.google.com/spreadsheets/d/\(store.selectedSheetID)/edit#range=\(range.addingPercentEncoding(withAllowedCharacters:.urlQueryAllowed) ?? "")"
      )
    {
      Link(destination: url) {
        Label("Open \(label)", systemImage: "arrow.up.right.square")
          .fixedSize(horizontal: false, vertical: true)
          .frame(minHeight: 44, alignment: .leading).contentShape(Rectangle())
      }
    } else {
      Label("Source: \(label) · fictional demo", systemImage: "tablecells").font(.caption)
        .foregroundStyle(KittyTheme.secondary)
    }
  }
}
