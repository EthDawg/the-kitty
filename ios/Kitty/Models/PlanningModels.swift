import Foundation

struct KittyPlanning: Decodable {
  let mortgage: KittyMortgage?
  let safety: KittySafety
  let paydays: [KittyPayday]
  let payslips: [KittyPayslip]
  let rental: KittyRental?
  let financialYear: String?
}

struct KittySafety: Decodable {
  let months, target: Double?
}

struct KittyMortgage: Decodable {
  let balance, offset, rate, monthsLeft, repayment, netPm: Double?
  let scenarios: [KittyRateScenario]
  let extras: [KittyExtraRepayment]
}

struct KittyRateScenario: Decodable, Identifiable {
  let id: String
  let change, rate, repayment, changePm, changePy, netAfter, interest, years: Double?
}

struct KittyExtraRepayment: Decodable, Identifiable {
  let id: String
  let extra, total, years, saved, interestSaved: Double?
}

struct KittyPayday: Decodable, Identifiable {
  let person, employer, next, lastPaid: String
  let net: Double?
  let days: Int
  var id: String { person }
}

struct KittyPayslip: Decodable, Identifiable {
  let id, date, person, employer: String
  let gross, tax, superAmount, net: Double?
  enum CodingKeys: String, CodingKey {
    case id, date, person, employer, gross, tax, net
    case superAmount = "super"
  }
}

struct KittyRental: Decodable {
  let from, to: String
  let rent, costs, net: Double
  let byCategory: [KittyRentalCategory]
}

struct KittyRentalCategory: Decodable, Identifiable {
  let id, name: String
  let amount: Double
}

func percentage(_ value: Double?, digits: Int = 2) -> String {
  guard let value, value.isFinite else { return "Not available" }
  return value.formatted(.percent.precision(.fractionLength(digits)))
}
