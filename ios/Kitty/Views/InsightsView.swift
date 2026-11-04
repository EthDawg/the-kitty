import Charts
import SwiftUI

struct InsightsView: View {
  @EnvironmentObject var store: KittyStore
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  var body: some View {
    ScrollView {
      if let h = store.household {
        VStack(alignment: .leading, spacing: 24) {
          Text("See the shape of your money.").font(.title3).foregroundStyle(KittyTheme.secondary)
          DataStatusView()
          KittyCard {
            SectionTitle(title: "In, out, and what’s left")
            Text("Last six recorded months · \(h.currency)").font(.caption).foregroundStyle(KittyTheme.secondary)
            Chart {
              ForEach(h.cashflow.suffix(6)) { m in
                if let income = m.income {
                  BarMark(x: .value("Month", monthName(m.month)), y: .value("Amount", income))
                    .foregroundStyle(KittyTheme.accent).position(by: .value("Flow", "Income"))
                }
                if let spending = m.spending {
                  BarMark(x: .value("Month", monthName(m.month)), y: .value("Amount", spending))
                    .foregroundStyle(KittyTheme.peach).position(by: .value("Flow", "Spending"))
                }
              }
            }.frame(height: 180).chartLegend(.hidden).accessibilityLabel(
              "Income and spending by month. Exact figures follow.")
            HStack {
              Label("Income", systemImage: "circle.fill").foregroundStyle(KittyTheme.accent)
              Label { Text("Spending").foregroundStyle(KittyTheme.ink) } icon: {
                Image(systemName: "circle.fill").foregroundStyle(KittyTheme.peach)
              }
            }.font(.caption)
            DisclosureGroup("Exact monthly figures") {
              ForEach(h.cashflow.suffix(6)) { m in
                VStack(alignment: .leading, spacing: 5) {
                  Text(niceDate(m.month)).font(.subheadline.bold())
                  Text(
                    "In \(money(m.income,currency:h.currency)) · Out \(money(m.spending,currency:h.currency))"
                  )
                  Text("Left over \(money(m.net,currency:h.currency))")
                }.font(.caption).padding(.vertical, 6).frame(maxWidth: .infinity, alignment: .leading)
              }
            }
            SourceLink(label: "Cash Flow tab", range: "'Cash Flow'!A:T")
          }
          KittyCard {
            SectionTitle(title: "Spending against your plan")
            Text(h.metrics["cashflow.spending.month"]?.period ?? "Latest month").font(.caption)
              .foregroundStyle(KittyTheme.secondary)
            ForEach(
              h.budget.filter { ($0.monthly ?? 0) > 0 }.sorted {
                ($0.latest ?? 0) > ($1.latest ?? 0)
              }.prefix(6)
            ) { b in
              VStack(alignment: .leading, spacing: 8) {
                (dynamicTypeSize.isAccessibilitySize
                  ? AnyLayout(VStackLayout(alignment: .leading, spacing: 5))
                  : AnyLayout(HStackLayout())) {
                  Text(b.name).font(.subheadline)
                  if !dynamicTypeSize.isAccessibilitySize { Spacer() }
                  Text(money(b.latest, currency: h.currency, compact: true)).font(
                    .subheadline.bold()
                  ).monospacedDigit()
                }
                if let latest = b.latest, let budget = b.monthly, budget > 0 {
                  ProgressView(value: min(max(latest / budget, 0), 1)).tint(
                    latest > budget ? KittyTheme.warning : KittyTheme.accent)
                  Text(
                    "\(money(budget,currency:h.currency,compact:true)) monthly budget\(latest>budget ? " · Above plan":"")"
                  ).font(.caption).foregroundStyle(KittyTheme.secondary)
                }
              }.padding(.vertical, 5)
            }
            SourceLink(label: "Budget tab", range: "Budget!A:I")
          }
          KittyCard {
            SectionTitle(title: "Plan with your Sheet")
            NavigationLink {
              MortgagePlanningView()
            } label: {
              Label("Mortgage scenarios", systemImage: "house")
            }.accessibilityIdentifier("insights.mortgage")
            Divider()
            NavigationLink {
              TaxPlanningView()
            } label: {
              Label("Tax estimates & checks", systemImage: "doc.text.magnifyingglass")
            }.accessibilityIdentifier("insights.tax")
            Divider()
            NavigationLink {
              UpcomingPlanningView()
            } label: {
              Label("Upcoming & pay history", systemImage: "calendar")
            }.accessibilityIdentifier("insights.upcoming")
            Divider()
            NavigationLink {
              SafetyPlanningView()
            } label: {
              Label("Safety coverage", systemImage: "lifepreserver")
            }.accessibilityIdentifier("insights.safety")
            Divider()
            NavigationLink {
              RentalPlanningView()
            } label: {
              Label("Rental cash flow", systemImage: "building.2")
            }.accessibilityIdentifier("insights.rental")
          }
          KittyCard {
            SectionTitle(title: "Explore a little further")
            NavigationLink {
              SubscriptionsView()
            } label: {
              Label("Subscriptions & recurring costs", systemImage: "repeat")
            }
            Divider()
            NavigationLink {
              SavingsView()
            } label: {
              Label("Ideas to consider", systemImage: "lightbulb")
            }
            Divider()
            NavigationLink {
              NetWorthView()
            } label: {
              Label("Net worth", systemImage: "chart.line.uptrend.xyaxis")
            }
            Divider()
            NavigationLink {
              ChecksView()
            } label: {
              Label("Checks & evidence", systemImage: "checkmark.shield")
            }
            Divider()
            NavigationLink {
              PeriodCloseView()
            } label: {
              Label("Review month end", systemImage: "calendar.badge.checkmark")
            }.accessibilityIdentifier("insights.monthClose")
          }
        }.padding(20).frame(maxWidth: 720)
      }
    }.frame(maxWidth: .infinity).kittyBackground().navigationTitle("Insights")
  }
}
struct SubscriptionsView: View {
  @EnvironmentObject var store: KittyStore
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  var body: some View {
    List {
      Section {
        Text(
          "Your Sheet’s recurring costs. Estimates depend on the recorded cadence; cancellation is never automatic."
        ).font(.subheadline)
        if store.household?.sheetVersion == 2 {
          Text("This Sheet derives subscriptions from its v2 ledger. Record decisions in the Sheet’s Decisions tab; this calculated view stays read-only.")
            .font(.caption).foregroundStyle(KittyTheme.secondary)
          SourceLink(label: "Decisions tab", range: "Decisions!A:H")
        }
      }
      ForEach(store.household?.subscriptions ?? []) { s in
        VStack(alignment: .leading, spacing: 8) {
          (dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 6))
            : AnyLayout(HStackLayout())) {
            Text(s.service).font(.headline)
            if !dynamicTypeSize.isAccessibilitySize { Spacer() }
            Text(money(s.latest, currency: store.currency)).monospacedDigit()
          }
          Text("\(s.cadence) · \(s.owner)").font(.caption).foregroundStyle(KittyTheme.secondary)
          Text("Recorded decision: \(s.decision.isEmpty ? "None yet":s.decision)").font(.caption)
          if let charged = s.lastCharged {
            Text("Last charged \(niceDate(charged))").font(.caption)
          }
          if store.household?.sheetVersion == 1 {
            NavigationLink("Record a decision") {
              SheetInputEditor(kind: .subscriptionDecision, recordKey: s.service, initialText: s.decision)
            }.accessibilityIdentifier("subscription.decision.\(s.service)")
          }
        }
      }
      SourceLink(label: "Subscriptions tab", range: "Subscriptions!A:Q")
    }.navigationTitle("Recurring costs")
  }
}
struct SavingsView: View {
  @EnvironmentObject var store: KittyStore
  var body: some View {
    List {
      Section {
        Text(
          "These are scenarios from your Sheet, not savings already achieved. Choose what suits your household."
        ).font(.subheadline)
      }
      ForEach(store.household?.savings ?? []) { s in
        VStack(alignment: .leading, spacing: 10) {
          Text(s.title).font(.headline)
          Text(s.shows).font(.subheadline)
          Text(
            "Estimated potential: \(money(s.amount,currency:store.currency))\(s.type=="Recurring" ? " a year":"")"
          ).font(.subheadline).foregroundStyle(KittyTheme.accent)
          Text("Source: \(s.where)").font(.caption).foregroundStyle(KittyTheme.secondary)
        }
      }
    }.navigationTitle("Ideas to consider")
  }
}
struct NetWorthView: View {
  @EnvironmentObject var store: KittyStore
  var body: some View {
    List {
      Section {
        Text(money(store.household?.value("networth.total"), currency: store.currency)).font(
          .largeTitle.bold()
        ).monospacedDigit()
        Text("Recorded assets less liabilities. Valuations may have different effective dates.")
          .font(.subheadline).foregroundStyle(KittyTheme.secondary)
      }
      ForEach((store.household?.networth ?? []).reversed()) { n in
        LabeledContent(niceDate(n.month), value: money(n.total, currency: store.currency))
      }
      SourceLink(label: "Net Worth tab", range: "'Net Worth'!A:I")
    }.navigationTitle("Net worth")
  }
}
struct ChecksView: View {
  @EnvironmentObject var store: KittyStore
  var body: some View {
    List {
      Section("App against Sheet") {
        ForEach(store.household?.reconciliation ?? []) { c in
          VStack(alignment: .leading, spacing: 6) {
            Label(c.what, systemImage: c.ok ? "checkmark.circle" : "exclamationmark.circle")
              .foregroundStyle(c.ok ? KittyTheme.positive : KittyTheme.warning).font(.subheadline)
            if c.a == nil || c.b == nil {
              Text("Not available until both recorded values are present.")
                .font(.caption).foregroundStyle(KittyTheme.secondary)
            }
          }
        }
      }
      Section("Recorded Sheet checks") {
        ForEach(store.household?.checks ?? []) { c in
          VStack(alignment: .leading, spacing: 6) {
            Text(c.name).font(.headline)
            Text("\(c.status) · \(c.items.map { "\(Int($0)) items" } ?? "Count not available")").font(.caption).foregroundStyle(
              KittyTheme.secondary)
            Text("Source: \(c.where)").font(.caption)
          }
        }
      }
      Section {
        Text(
          "These checks describe the recorded data. They do not establish that every statement is present, that a duplicate is an error, or that an expense qualifies for a deduction."
        ).font(.caption)
        SourceLink(label: "Compliance Checks tab", range: "'Compliance Checks'!A:G")
      }
    }.navigationTitle("Checks & evidence")
  }
}
