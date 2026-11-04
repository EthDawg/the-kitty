import Foundation

struct HouseholdSetupAccount: Codable, Identifiable, Equatable {
  var id = "ACC-" + UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(12)
  var name = ""
  var institution = ""
  var type = "Transaction"
  var owner = "Joint"
  var openingAmount = ""
  var isOwed = false
  static let types = ["Transaction", "Savings", "Offset", "Credit card"]
}

struct HouseholdSetupDraft: Codable, Equatable {
  static let maximumMinor: Int64 = 99_999_999_999_999
  var householdName = ""
  var firstPerson = ""
  var secondPerson = ""
  var includesSecondPerson = false
  var openingDate = Self.defaultOpeningDate()
  var accounts = [HouseholdSetupAccount()]
  var emergencyAccountId = ""
  var includesGoal = false
  var goalName = ""
  var goalAmount = ""
  var goalDate = Calendar(identifier: .gregorian).date(byAdding: .month, value: 6, to: Date()) ?? Date()
  var goalAccountId = ""
  var reservation: HouseholdSetupReservation?
  var approvedInput: Data?
  var lastResult: HouseholdSetupResult?
  var lastMessage: String?

  var people: [String] {
    ([firstPerson] + (includesSecondPerson ? [secondPerson] : []))
      .map(Self.cleanName)
  }
  var isLocked: Bool { reservation != nil }
  var isUnresolved: Bool {
    reservation != nil && !["verified", "cancelled"].contains(lastResult?.status.rawValue ?? "reserved")
  }
  var hasContent: Bool {
    reservation != nil || !householdName.isEmpty || !firstPerson.isEmpty
      || accounts.contains { !$0.name.isEmpty || !$0.openingAmount.isEmpty }
  }

  static var calendar: Calendar {
    var value = Calendar(identifier: .gregorian)
    value.timeZone = TimeZone(secondsFromGMT: 0)!
    return value
  }
  static func defaultOpeningDate(now: Date = Date()) -> Date {
    // The AU template calculates dates in Sydney. At the start of a local
    // month, UTC may still be in the previous month; it must not hide the
    // month-end the household has just completed.
    var householdCalendar = calendar
    householdCalendar.timeZone = TimeZone(identifier: "Australia/Sydney")!
    let components = householdCalendar.dateComponents([.year, .month], from: now)
    let first = calendar.date(from: components) ?? now
    return calendar.date(byAdding: .day, value: -1, to: first) ?? now
  }
  static func day(_ date: Date) -> String {
    let f = DateFormatter()
    f.calendar = calendar
    f.locale = Locale(identifier: "en_US_POSIX")
    f.timeZone = calendar.timeZone
    f.dateFormat = "yyyy-MM-dd"
    return f.string(from: date)
  }
  static func isMonthEnd(_ date: Date) -> Bool {
    guard let next = calendar.date(byAdding: .day, value: 1, to: date) else { return false }
    return calendar.component(.day, from: next) == 1
  }
  static func cleanName(_ value: String) -> String {
    value.trimmingCharacters(in: .whitespacesAndNewlines).precomposedStringWithCanonicalMapping
  }

  func approvedPayload(now: Date = Date()) throws -> Data {
    try validate(now: now)
    let rows: [[String: Any]] = try accounts.sorted { $0.id < $1.id }.map { account in
      ["id": account.id, "name": Self.cleanName(account.name),
       "institution": Self.cleanName(account.institution), "type": account.type,
       "owner": Self.cleanName(account.owner),
       "openingMinor": try Self.minor(account.openingAmount, owed: account.isOwed)]
    }
    var goal: Any = NSNull()
    if includesGoal {
      goal = ["name": Self.cleanName(goalName), "targetMinor": try Self.minor(goalAmount),
        "targetDate": Self.day(goalDate), "accountId": goalAccountId]
    }
    return try JSONSerialization.data(withJSONObject: [
      "profile": "au-aud-basic", "sheetVersion": 1, "country": "AU", "currency": "AUD",
      "householdName": Self.cleanName(householdName), "people": people,
      "openingDate": Self.day(openingDate), "accounts": rows, "budgets": [],
      "emergencyAccountId": emergencyAccountId.isEmpty ? NSNull() : emergencyAccountId as Any,
      "goal": goal,
      "capacity": ["transactions": 2000, "payslips": 500, "valuations": 500],
    ], options: [.sortedKeys, .withoutEscapingSlashes])
  }

  /// Parse decimal input without binary floating-point rounding or a guessed locale.
  static func minor(_ raw: String, owed: Bool = false) throws -> String {
    let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    guard text.range(of: "^[0-9]+(?:\\.[0-9]{1,2})?$", options: .regularExpression) != nil else {
      throw KittyError.message("Enter an amount using numbers and up to two decimal places, without a currency symbol or commas.")
    }
    let parts = text.split(separator: ".", omittingEmptySubsequences: false)
    guard let whole = Int64(parts[0]) else { throw KittyError.message("This amount is too large.") }
    let fraction = parts.count == 2 ? String(parts[1]).padding(toLength: 2, withPad: "0", startingAt: 0) : "00"
    let (scaled, overflow) = whole.multipliedReportingOverflow(by: 100)
    let (cents, additionOverflow) = scaled.addingReportingOverflow(Int64(fraction) ?? 0)
    guard !overflow, !additionOverflow, cents <= maximumMinor else {
      throw KittyError.message("This amount is too large.")
    }
    return (owed && cents > 0 ? "-" : "") + String(cents)
  }

  /// An exact review label even for amounts beyond binary floating-point cent precision.
  static func money(minor: String) -> String {
    let negative = minor.hasPrefix("-")
    let digits = negative ? String(minor.dropFirst()) : minor
    let padded = String(repeating: "0", count: max(0, 3 - digits.count)) + digits
    let whole = String(padded.dropLast(2))
    var groups: [String] = []
    var remaining = whole
    while !remaining.isEmpty {
      groups.insert(String(remaining.suffix(3)), at: 0)
      remaining = String(remaining.dropLast(min(3, remaining.count)))
    }
    return (negative ? "−" : "") + "$" + groups.joined(separator: ",") + "." + padded.suffix(2)
  }

  func validate(now: Date = Date()) throws {
    func name(_ raw: String, label: String, maximum: Int = 100) throws {
      let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !value.isEmpty, value.count <= maximum,
        value.rangeOfCharacter(from: .controlCharacters) == nil else {
        throw KittyError.message("Enter a valid \(label) of up to \(maximum) characters.")
      }
    }
    try name(householdName, label: "household name")
    for person in people {
      try name(person, label: "person's name", maximum: 60)
      guard !person.contains(","), person.lowercased() != "joint" else {
        throw KittyError.message("Use each person's name without commas. Joint is reserved for shared accounts.")
      }
    }
    guard Set(people.map { $0.lowercased() }).count == people.count else {
      throw KittyError.message("Use distinct names for the two people.")
    }
    guard Self.isMonthEnd(openingDate), Self.day(openingDate) <= Self.day(Self.defaultOpeningDate(now: now)) else {
      throw KittyError.message("Choose a completed month-end for the opening balances. Your first import starts the following day.")
    }
    guard !accounts.isEmpty, accounts.count <= 20, Set(accounts.map(\.id)).count == accounts.count else {
      throw KittyError.message("Add between one and twenty accounts with distinct identities.")
    }
    var totalAbsoluteMinor: Int64 = 0
    for account in accounts {
      try name(account.name, label: "account name")
      try name(account.institution, label: "bank or institution")
      guard HouseholdSetupAccount.types.contains(account.type),
        (["Joint"] + people).contains(account.owner) else {
        throw KittyError.message("Choose the type and current owner for \(account.name).")
      }
      let value = try Self.minor(account.openingAmount, owed: account.isOwed)
      totalAbsoluteMinor += abs(Int64(value)!)
      guard totalAbsoluteMinor <= Self.maximumMinor else {
        throw KittyError.message("The combined opening balances exceed this setup's supported range.")
      }
    }
    if !emergencyAccountId.isEmpty {
      guard accounts.contains(where: { $0.id == emergencyAccountId && $0.type != "Credit card" }) else {
        throw KittyError.message("Choose a cash account for the emergency fund, or leave it unset.")
      }
    }
    if includesGoal {
      try name(goalName, label: "goal name")
      guard try Self.minor(goalAmount) != "0", Self.day(goalDate) > Self.day(openingDate),
        accounts.contains(where: { $0.id == goalAccountId && $0.type != "Credit card" }) else {
        throw KittyError.message("Give the goal a positive target, a later target date and a linked cash account.")
      }
    }
  }
}
