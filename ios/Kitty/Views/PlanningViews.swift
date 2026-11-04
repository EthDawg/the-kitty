import SwiftUI

struct MortgagePlanningView: View {
  @EnvironmentObject var store: KittyStore
  @State private var rateID = ""
  @State private var extraID = ""

  private var mortgage: KittyMortgage? { store.household?.planning?.mortgage }
  private var rateScenario: KittyRateScenario? {
    let rows = mortgage?.scenarios ?? []
    return rows.first { $0.id == rateID }
      ?? rows.first { $0.change.map { abs($0) < 0.000001 } == true }
      ?? rows.first
  }
  private var extraScenario: KittyExtraRepayment? {
    let rows = mortgage?.extras ?? []
    return rows.first { $0.id == extraID }
      ?? rows.first { $0.extra == 0 }
      ?? rows.first
  }

  var body: some View {
    List {
      Section {
        PlanningIntroduction(
          text: "Explore the mortgage scenarios recorded in your Sheet. Each result is an estimate using the Sheet’s inputs.")
      }
      if let mortgage {
        Section("Recorded loan inputs") {
          PlanningValueRow("Loan balance", money(mortgage.balance, currency: store.currency))
          PlanningValueRow("Offset balance", money(mortgage.offset, currency: store.currency))
          PlanningValueRow("Current interest rate", percentage(mortgage.rate))
          PlanningValueRow("Months remaining", planningNumber(mortgage.monthsLeft))
          PlanningValueRow("Monthly repayment", money(mortgage.repayment, currency: store.currency))
          PlanningValueRow(
            "Average monthly net cash flow · last 3 months",
            money(mortgage.netPm, currency: store.currency))
        }
        rateSection
        extraSection
      } else {
        EmptyState(
          title: "Mortgage scenarios not available",
          message: "Your Sheet has no mortgage inputs or scenarios to show.", symbol: "house")
      }
      Section {
        Text("Selecting a scenario only changes the figures shown here. It does not change your loan or your Sheet.")
          .font(.caption).foregroundStyle(KittyTheme.secondary)
        SourceLink(label: "Mortgage Scenarios tab", range: "'Mortgage Scenarios'!A:H")
      }
    }.scrollContentBackground(.hidden).kittyBackground().navigationTitle("Mortgage scenarios")
      .navigationBarTitleDisplayMode(.inline).accessibilityIdentifier("mortgage.planning")
  }

  private var rateSection: some View {
    Section("Rate scenarios · estimates") {
      if let selected = rateScenario {
        Picker("Interest rate scenario", selection: Binding(
          get: { rateScenario?.id ?? "" }, set: { rateID = $0 }
        )) {
          ForEach(mortgage?.scenarios ?? []) { row in
            Text(percentage(row.rate)).tag(row.id)
              .accessibilityIdentifier("mortgage.rateScenario.\(row.id)")
          }
        }.pickerStyle(.menu).accessibilityIdentifier("mortgage.rateScenario.picker")
        PlanningValueRow("Scenario interest rate", percentage(selected.rate))
        PlanningValueRow(
          "Rate change · percentage points", planningNumber(selected.change.map { $0 * 100 }))
        PlanningValueRow("Monthly repayment", money(selected.repayment, currency: store.currency))
          .accessibilityIdentifier("mortgage.rateScenario.repayment")
        PlanningValueRow("Change per month", money(selected.changePm, currency: store.currency))
        PlanningValueRow("Change per year", money(selected.changePy, currency: store.currency))
        PlanningValueRow("Monthly net cash flow after change", money(selected.netAfter, currency: store.currency))
        PlanningValueRow("Interest over the remaining term", money(selected.interest, currency: store.currency))
        PlanningValueRow("Years to repay at today’s repayment, with offset", planningNumber(selected.years))
      } else {
        Text("Rate scenarios: Not available").foregroundStyle(KittyTheme.secondary)
      }
    }
  }

  private var extraSection: some View {
    Section("Extra repayments · estimates") {
      if let selected = extraScenario {
        Picker("Extra repayment scenario", selection: Binding(
          get: { extraScenario?.id ?? "" }, set: { extraID = $0 }
        )) {
          ForEach(mortgage?.extras ?? []) { row in
            Text(money(row.extra, currency: store.currency)).tag(row.id)
              .accessibilityIdentifier("mortgage.extraScenario.\(row.id)")
          }
        }.pickerStyle(.menu).accessibilityIdentifier("mortgage.extraScenario.picker")
        PlanningValueRow("Extra each month", money(selected.extra, currency: store.currency))
        PlanningValueRow("Total monthly repayment", money(selected.total, currency: store.currency))
          .accessibilityIdentifier("mortgage.extraScenario.repayment")
        PlanningValueRow("Years to repay with offset", planningNumber(selected.years))
        PlanningValueRow("Years saved", planningNumber(selected.saved))
        PlanningValueRow("Interest saved", money(selected.interestSaved, currency: store.currency))
      } else {
        Text("Extra repayment scenarios: Not available").foregroundStyle(KittyTheme.secondary)
      }
    }
  }
}

struct TaxPlanningView: View {
  @EnvironmentObject var store: KittyStore
  private let standardMetrics = [
    "tax.refund.prior_year", "tax.refund.corrected.prior_year",
    "tax.refund_at_risk.prior_year", "tax.refund.current_year",
  ]
  private var metricIDs: [String] {
    standardMetrics + (store.household?.metrics.keys.filter {
      $0.hasPrefix("tax.") && !standardMetrics.contains($0)
    }.sorted() ?? [])
  }
  private var taxChecks: [KittyCheck] {
    (store.household?.checks ?? []).filter { $0.type.caseInsensitiveCompare("Tax") == .orderedSame }
  }

  var body: some View {
    List {
      Section {
        PlanningIntroduction(
          text: "These are estimates from your Sheet. Recorded tax checks identify items to review; they do not verify a claim or lodge a return.")
        PlanningValueRow("Current financial year", planningText(store.household?.planning?.financialYear))
      }
      Section("Sheet tax estimates") {
        ForEach(metricIDs, id: \.self) { id in
          let metric = store.household?.metrics[id]
          VStack(alignment: .leading, spacing: 6) {
            PlanningValueRow(metricLabel(metric, id: id), metricValue(metric))
            Text("Period: \(planningText(metric?.period))")
              .font(.caption).foregroundStyle(KittyTheme.secondary)
          }.accessibilityElement(children: .combine).accessibilityIdentifier("tax.metric.\(id)")
        }
      }
      Section("Recorded Tax checks") {
        if taxChecks.isEmpty {
          Text("No Tax checks are recorded in this snapshot.").foregroundStyle(KittyTheme.secondary)
        }
        ForEach(taxChecks) { check in
          VStack(alignment: .leading, spacing: 8) {
            Text(check.name).font(.headline)
            PlanningValueRow("Recorded status", planningText(check.status))
            PlanningValueRow("Items", planningNumber(check.items))
            PlanningValueRow("Amount", money(check.amount, currency: store.currency))
            if !check.why.isEmpty {
              Text("Sheet note: \(check.why)").font(.subheadline)
            }
            Text("Where to look: \(planningText(check.where))")
              .font(.caption).foregroundStyle(KittyTheme.secondary)
          }.padding(.vertical, 4).accessibilityIdentifier("tax.check.\(check.id)")
        }
      }
      Section("Sheet sources") {
        SourceLink(label: "Metrics tab", range: "Metrics!A:H")
        SourceLink(label: "Tax Forecast tab", range: "'Tax Forecast'!A:F")
        SourceLink(label: "Compliance Checks tab", range: "'Compliance Checks'!A:G")
      }
    }.scrollContentBackground(.hidden).kittyBackground().navigationTitle("Tax estimates")
      .navigationBarTitleDisplayMode(.inline).accessibilityIdentifier("tax.planning")
  }

  private func fallbackLabel(_ id: String) -> String {
    switch id {
    case "tax.refund.prior_year": return "Prior-year refund estimate"
    case "tax.refund.corrected.prior_year": return "Prior-year refund if flagged claims are corrected"
    case "tax.refund_at_risk.prior_year": return "Prior-year refund resting on flagged claims"
    case "tax.refund.current_year": return "Current-year refund estimate"
    default: return id
    }
  }

  private func metricLabel(_ metric: KittyMetric?, id: String) -> String {
    guard let label = metric?.label, !label.isEmpty else { return fallbackLabel(id) }
    return label
  }

  private func metricValue(_ metric: KittyMetric?) -> String {
    guard let metric else { return "Not available" }
    if metric.unit.caseInsensitiveCompare("Text") == .orderedSame { return planningText(metric.text) }
    if metric.unit.caseInsensitiveCompare("Percent") == .orderedSame { return percentage(metric.num) }
    if Locale.commonISOCurrencyCodes.contains(metric.unit) {
      return money(metric.num, currency: metric.unit)
    }
    guard metric.num != nil else { return "Not available" }
    return [planningNumber(metric.num), metric.unit].filter { !$0.isEmpty }.joined(separator: " ")
  }
}

struct UpcomingPlanningView: View {
  @EnvironmentObject var store: KittyStore

  var body: some View {
    List {
      Section {
        PlanningIntroduction(
          text: "Scheduled dates and amounts are estimates from the Sheet’s cadence and recorded history. They are relative to the snapshot date and can change.")
      }
      Section("Next pay estimates") {
        if store.household?.planning?.paydays.isEmpty != false {
          Text("Next pay estimates: Not available").foregroundStyle(KittyTheme.secondary)
        }
        ForEach(store.household?.planning?.paydays ?? []) { pay in
          NavigationLink {
            PayslipHistoryView(person: pay.person)
          } label: {
            VStack(alignment: .leading, spacing: 6) {
              Text(pay.person).font(.headline)
              Text(planningText(pay.employer)).font(.subheadline)
              Text("Estimated next pay: \(niceDate(pay.next))")
              Text(money(pay.net, currency: store.currency)).font(.headline).monospacedDigit()
              Text("Last recorded pay: \(niceDate(pay.lastPaid))")
                .font(.caption).foregroundStyle(KittyTheme.secondary)
            }.font(.subheadline).padding(.vertical, 4)
          }.accessibilityIdentifier("upcoming.payday.\(pay.id)")
        }
        NavigationLink {
          PayslipHistoryView()
        } label: {
          Label("All recorded payslips", systemImage: "doc.text")
        }.accessibilityIdentifier("upcoming.payslips")
      }
      Section("Upcoming schedule · estimates") {
        if store.household?.upcoming.isEmpty != false {
          Text("No upcoming items in the recorded look-ahead window.").foregroundStyle(KittyTheme.secondary)
        }
        ForEach(store.household?.upcoming ?? []) { item in
          VStack(alignment: .leading, spacing: 7) {
            Label(item.title, systemImage: symbol(item.kind)).font(.headline)
            PlanningValueRow(item.kind == "goal" ? "Target date" : "Estimated date", niceDate(item.date))
            PlanningValueRow("Amount", money(item.amount, currency: store.currency))
            if !item.sub.isEmpty {
              Text(item.sub).font(.caption).foregroundStyle(KittyTheme.secondary)
            }
          }.padding(.vertical, 4).accessibilityIdentifier("upcoming.item.\(item.id)")
        }
      }
      Section("Sheet sources") {
        SourceLink(label: "Subscriptions tab", range: "Subscriptions!A:Q")
        SourceLink(label: "Loans tab", range: "Loans!A:K")
        SourceLink(label: "Payslips tab", range: "Payslips!A:G")
        SourceLink(label: "Goals tab", range: "Goals!A:J")
        SourceLink(label: "Kitty schedule settings", range: "Kitty!A:C")
      }
    }.scrollContentBackground(.hidden).kittyBackground().navigationTitle("Upcoming & pay")
      .navigationBarTitleDisplayMode(.inline).accessibilityIdentifier("upcoming.planning")
  }

  private func symbol(_ kind: String) -> String {
    switch kind {
    case "pay": return "arrow.down.left"
    case "loan": return "house"
    case "goal": return "flag"
    default: return "calendar"
    }
  }
}

struct PayslipHistoryView: View {
  @EnvironmentObject var store: KittyStore
  var person: String? = nil
  private var payslips: [KittyPayslip] {
    (store.household?.planning?.payslips ?? [])
      .filter { person == nil || $0.person == person }
      .sorted { $0.date == $1.date ? $0.id < $1.id : $0.date > $1.date }
  }

  var body: some View {
    List {
      Section {
        PlanningIntroduction(text: "Payslips recorded in your Sheet through the snapshot date, newest first.")
      }
      if payslips.isEmpty {
        EmptyState(
          title: "Payslips not available", message: "No payslips are recorded for this view.", symbol: "doc.text")
      }
      ForEach(payslips) { slip in
        Section {
          Text(slip.person).font(.headline)
          Text(planningText(slip.employer)).font(.subheadline).foregroundStyle(KittyTheme.secondary)
          PlanningValueRow("Gross pay", money(slip.gross, currency: store.currency))
          PlanningValueRow("Tax withheld", money(slip.tax, currency: store.currency))
          PlanningValueRow("Super", money(slip.superAmount, currency: store.currency))
          PlanningValueRow("Net pay", money(slip.net, currency: store.currency))
        } header: {
          Text(niceDate(slip.date))
        }.accessibilityIdentifier("payslips.\(slip.id)")
      }
      Section { SourceLink(label: "Payslips tab", range: "Payslips!A:G") }
    }.scrollContentBackground(.hidden).kittyBackground()
      .navigationTitle(person.map { "\($0)’s payslips" } ?? "Payslip history")
      .navigationBarTitleDisplayMode(.inline).accessibilityIdentifier("payslips.history")
  }
}

struct SafetyPlanningView: View {
  @EnvironmentObject var store: KittyStore

  var body: some View {
    List {
      Section {
        PlanningIntroduction(text: "Your Sheet’s recorded coverage of essential spending, alongside its target.")
      }
      Section("Safety coverage") {
        PlanningValueRow("Months covered", planningNumber(store.household?.planning?.safety.months))
          .accessibilityIdentifier("safety.months")
        PlanningValueRow("Target · months", planningNumber(store.household?.planning?.safety.target))
          .accessibilityIdentifier("safety.target")
        Text("Coverage comes from Metrics. The target comes from Settings or the target comparison recorded in Metrics.")
          .font(.caption).foregroundStyle(KittyTheme.secondary)
      }
      Section("Sheet sources") {
        SourceLink(label: "Metrics tab", range: "Metrics!A:H")
        SourceLink(label: "Settings tab", range: "Settings!A:C")
      }
    }.scrollContentBackground(.hidden).kittyBackground().navigationTitle("Safety coverage")
      .navigationBarTitleDisplayMode(.inline).accessibilityIdentifier("safety.planning")
  }
}

struct RentalPlanningView: View {
  @EnvironmentObject var store: KittyStore

  var body: some View {
    List {
      Section {
        PlanningIntroduction(text: "Recorded cash flow across the Sheet’s rental income and cost categories.")
      }
      if let rental = store.household?.planning?.rental {
        Section("Recorded period") {
          PlanningValueRow("From", niceDate(rental.from))
            .accessibilityIdentifier("rental.from")
          PlanningValueRow("Through", niceDate(rental.to))
            .accessibilityIdentifier("rental.to")
        }
        Section("Recorded cash flow") {
          PlanningValueRow("Rent received", money(rental.rent, currency: store.currency))
          PlanningValueRow("Rental costs", money(rental.costs, currency: store.currency))
          PlanningValueRow("Net cash flow", money(rental.net, currency: store.currency))
            .accessibilityIdentifier("rental.net")
        }
        Section("Recorded costs by category") {
          if rental.byCategory.isEmpty {
            Text("No rental costs are recorded in this period.").foregroundStyle(KittyTheme.secondary)
          }
          ForEach(rental.byCategory) { category in
            PlanningValueRow(category.name, money(category.amount, currency: store.currency))
              .accessibilityIdentifier("rental.category.\(category.id)")
          }
        }
        Section {
          Text("These totals combine recorded rental categories for the dates shown. They depend on the transactions and categorisation present in your Sheet.")
            .font(.caption).foregroundStyle(KittyTheme.secondary)
        }
      } else {
        EmptyState(
          title: "Rental cash flow not available",
          message: "Your Sheet has no recorded rental activity or rental asset to show.", symbol: "house")
      }
      Section {
        SourceLink(label: "Transactions tab", range: "Transactions!A:J")
        SourceLink(label: "Categories tab", range: "Categories!A:H")
      }
    }.scrollContentBackground(.hidden).kittyBackground().navigationTitle("Rental cash flow")
      .navigationBarTitleDisplayMode(.inline).accessibilityIdentifier("rental.planning")
  }
}

private struct PlanningIntroduction: View {
  @EnvironmentObject var store: KittyStore
  let text: String
  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      DataStatusView()
      Text(text).font(.subheadline)
      Text("Snapshot: \(store.household.map { niceDate($0.asOf) } ?? "Not available") · \(store.currency)")
        .font(.caption).foregroundStyle(KittyTheme.secondary)
    }.padding(.vertical, 4)
  }
}

private struct PlanningValueRow: View {
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  let title: String
  let value: String
  init(_ title: String, _ value: String) { self.title = title; self.value = value }
  var body: some View {
    (dynamicTypeSize.isAccessibilitySize
      ? AnyLayout(VStackLayout(alignment: .leading, spacing: 5))
      : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 16))) {
      Text(title).font(.subheadline).foregroundStyle(KittyTheme.secondary)
      if !dynamicTypeSize.isAccessibilitySize { Spacer(minLength: 8) }
      Text(value).font(.body.weight(.medium)).monospacedDigit()
        .multilineTextAlignment(dynamicTypeSize.isAccessibilitySize ? .leading : .trailing)
        .fixedSize(horizontal: false, vertical: true)
    }.accessibilityElement(children: .combine)
  }
}

private func planningNumber(_ value: Double?) -> String {
  guard let value, value.isFinite else { return "Not available" }
  return value.formatted(.number.precision(.fractionLength(0...2)))
}

private func planningText(_ value: String?) -> String {
  guard let value, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return "Not available" }
  return value
}
