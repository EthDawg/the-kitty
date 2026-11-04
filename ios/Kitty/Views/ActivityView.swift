import SwiftUI

struct ActivityView: View {
  @EnvironmentObject var store: KittyStore
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  @State private var query = ""
  @State private var filter = "All"
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
            store.showImport = true
          } label: {
            Image(systemName: "plus")
          }.accessibilityLabel("Import statement")
        }
      }
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
