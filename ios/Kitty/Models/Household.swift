import Foundation

struct Household: Decodable {
  let household: String
  let asOf: String
  let currency: String
  let sheetVersion: Int
  let accounts: [KittyAccount]
  let transactions: [KittyTransaction]
  let categories: [KittyCategory]
  let goals: [KittyGoal]
  let metrics: [String: KittyMetric]
  let cashflow: [CashMonth]
  let budget: [BudgetCategory]
  let subscriptions: [KittySubscription]
  let checks: [KittyCheck]
  let savings: [SavingIdea]
  let networth: [NetWorthMonth]
  let upcoming: [UpcomingItem]
  let reconciliation: [ReconciliationCheck]
  let people: [String]
  func value(_ id: String) -> Double? { metrics[id]?.num }
}
struct KittyAccount: Decodable, Identifiable {
  let id, name, bank, type, owner: String
  let opening, balance: Double?
  let liquid: Bool
}
struct KittyTransaction: Decodable, Identifiable {
  let id, date, acct, desc, merchant, cat, catName, group, flow, person, receipt, note: String
  let amount: Double
  var symbol: String {
    switch group {
    case "Income": return "arrow.down.left"
    case "Essentials": return "basket"
    case "Housing", "Property": return "house"
    case "Lifestyle": return "cup.and.saucer"
    default: return flow == "Transfer" ? "arrow.left.arrow.right" : "creditcard"
    }
  }
}
struct KittyCategory: Decodable, Identifiable { let id, name, group, flow: String }
struct KittyGoal: Decodable, Identifiable {
  let row: Int
  let name, acct, status: String
  let date: String?
  let target, balance, progress, needPm, savedPm: Double?
  var id: Int { row }
}
struct KittyMetric: Decodable {
  let id, label, unit, period: String
  let num, comp: Double?
  let text: String?
  let comparedWith: String?
}
struct CashMonth: Decodable, Identifiable {
  let month: String
  let income, spending, net: Double?
  var id: String { month }
}
struct BudgetCategory: Decodable, Identifiable {
  let name, status: String
  let monthly, latest, avg3, ytd, used: Double?
  var id: String { name }
}
struct KittySubscription: Decodable, Identifiable {
  let service, merchant, owner, cadence, decision, flag: String
  let latest, annual: Double?
  let lastCharged: String?
  var id: String { service }
}
struct KittyCheck: Decodable, Identifiable {
  let name, type, status, why, `where`: String
  let items, amount: Double?
  var id: String { name }
}
struct SavingIdea: Decodable, Identifiable {
  let title, shows, type, effort, `where`: String
  let amount: Double?
  var id: String { title }
}
struct NetWorthMonth: Decodable, Identifiable {
  let month: String
  let total, cash, property, superValue, shares, vehicle, loans: Double?
  var id: String { month }
  enum CodingKeys: String, CodingKey {
    case month, total, cash, property
    case superValue = "super"
    case shares, vehicle, loans
  }
}
struct UpcomingItem: Decodable, Identifiable {
  let date, kind, title, sub: String
  let amount: Double?
  var id: String { date + kind + title }
}
struct ReconciliationCheck: Decodable, Identifiable {
  let what: String
  let ok: Bool
  let a, b: Double?
  var id: String { what }
}

func money(_ value: Double?, currency: String = "AUD", compact: Bool = false) -> String {
  guard let value, value.isFinite else { return "Not available" }
  return value.formatted(
    .currency(code: currency).locale(Locale(identifier: "en_AU")).precision(
      .fractionLength(compact ? 0 : 2)))
}
func niceDate(_ value: String) -> String {
  let f = DateFormatter()
  f.locale = Locale(identifier: "en_AU")
  f.timeZone = TimeZone(secondsFromGMT: 0)
  f.dateFormat = "yyyy-MM-dd"
  guard let date = f.date(from: String(value.prefix(10))) else { return value }
  f.dateFormat = "d MMM yyyy"
  return f.string(from: date)
}
func monthName(_ value: String) -> String {
  let f = DateFormatter()
  f.locale = Locale(identifier: "en_AU")
  f.timeZone = TimeZone(secondsFromGMT: 0)
  f.dateFormat = "yyyy-MM-dd"
  guard let date = f.date(from: value) else { return value }
  f.dateFormat = "MMM"
  return f.string(from: date)
}
