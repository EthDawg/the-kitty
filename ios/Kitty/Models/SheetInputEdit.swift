import Foundation

enum SheetInputKind: String, Codable, CaseIterable {
  case greeting, leadGoal, lookAheadDays, safetyMonths, subscriptionDecision

  var title: String {
    switch self {
    case .greeting: return "Greeting"
    case .leadGoal: return "Featured goal"
    case .lookAheadDays: return "Upcoming days"
    case .safetyMonths: return "Safety target"
    case .subscriptionDecision: return "Subscription decision"
    }
  }
  var sheet: String {
    switch self {
    case .safetyMonths: return "Settings"
    case .subscriptionDecision: return "Subscriptions"
    default: return "Kitty"
    }
  }
  var column: String { self == .subscriptionDecision ? "G" : "B" }
  var key: String? {
    switch self {
    case .greeting: return "greeting_name"
    case .leadGoal: return "lead_goal"
    case .lookAheadDays: return "look_ahead_days"
    case .safetyMonths: return "Emergency fund target (months of essential spending)"
    case .subscriptionDecision: return nil
    }
  }
  var readRange: String { sheet + (self == .subscriptionDecision ? "!A1:Q" : "!A1:C") }
  var headers: [String] {
    switch self {
    case .safetyMonths: return ["Setting", "Value"]
    case .subscriptionDecision: return ["Service", "Merchant", "Owner", "Cadence", "Category ID", "Last used", "Decision"]
    default: return ["Key", "Value"]
    }
  }
  func replacement(text: String, goalNames: [String] = []) throws -> GoogleCell {
    let value = text.trimmingCharacters(in: .whitespacesAndNewlines).precomposedStringWithCanonicalMapping
    switch self {
    case .greeting:
      guard value.count <= 100, !value.hasPrefix("="), value.rangeOfCharacter(from: .controlCharacters) == nil else {
        throw KittyError.message("Use a greeting of up to 100 characters without line breaks or an initial equals sign.")
      }
      return .string(value)
    case .leadGoal:
      guard value.isEmpty || goalNames.contains(value) else {
        throw KittyError.message("Choose a goal that is still recorded in this Sheet.")
      }
      return .string(value)
    case .lookAheadDays, .safetyMonths:
      let maximum = self == .lookAheadDays ? 365 : 60
      guard value.range(of: "^[0-9]{1,3}$", options: .regularExpression) != nil,
        let amount = Int(value), (1...maximum).contains(amount) else {
        throw KittyError.message("Choose a whole number from 1 to \(maximum).")
      }
      return .number(Double(amount))
    case .subscriptionDecision:
      guard ["Keep", "Review", "Cancel"].contains(value) else {
        throw KittyError.message("Choose Keep, Review or Cancel.")
      }
      return .string(value)
    }
  }
  func display(_ cell: GoogleCell) -> String {
    guard !cell.displayString.isEmpty else { return self == .leadGoal ? "Automatic" : "Not set" }
    switch self {
    case .safetyMonths: return cell.displayString + " months"
    case .lookAheadDays: return cell.displayString + " days"
    default: return cell.displayString
    }
  }
}

/// A single reviewed input cell. Its destination is derived from a fixed allowlist.
/// Saving this record precedes the write; recovery only reads and never replays it.
struct SheetInputEdit: Codable, Equatable, Identifiable {
  enum Outcome: String, Codable { case unverified, verified, notWritten }
  let id: UUID
  let sheetID: String
  let sheetName: String
  let schemaVersion: Int
  let connectionEpoch: UUID
  let kind: SheetInputKind
  let recordKey: String
  let row: Int
  let before: GoogleCell
  let replacement: GoogleCell
  let preparedAt: Date
  var outcome: Outcome = .unverified
  var verifiedAt: Date? = nil
  var range: String { "\(kind.sheet)!\(kind.column)\(row)" }

  func validate() throws {
    guard sheetID.range(of: "^[A-Za-z0-9_-]{20,200}$", options: .regularExpression) != nil,
      [1, 2].contains(schemaVersion), (2...1_000_000).contains(row),
      !recordKey.isEmpty, recordKey.count <= 200,
      kind.key == nil || kind.key == recordKey,
      !(kind == .subscriptionDecision && schemaVersion != 1),
      outcome != .verified || verifiedAt != nil,
      before.displayString.count <= 2_000,
      !before.displayString.hasPrefix("=") else {
      throw KittyError.message("This saved input review could not be verified. Keep it for recovery.")
    }
    let allowedGoals = kind == .leadGoal ? [replacement.displayString] : []
    guard try kind.replacement(text: replacement.displayString, goalNames: allowedGoals) == replacement else {
      throw KittyError.message("The saved replacement is outside the supported input values.")
    }
  }

  @MainActor static func prepare(sheetID: String, sheetName: String, epoch: UUID, kind: SheetInputKind,
    recordKey: String, replacement: GoogleCell, grid: [[GoogleCell]], kitty: [[GoogleCell]],
    goalNames: [String] = [], now: Date = Date()) throws -> SheetInputEdit {
    let version = try currentVersion(kitty)
    guard kind != .subscriptionDecision || version == 1 else {
      throw KittyError.message("This Sheet calculates subscriptions from its v2 ledger. Edit its decision records in the Sheet; this view cannot be overwritten.")
    }
    let input = try currentInput(kind: kind, recordKey: recordKey, grid: grid)
    guard try kind.replacement(text: replacement.displayString, goalNames: goalNames) == replacement else {
      throw KittyError.message("Review the input value before saving.")
    }
    guard !GoogleSheets.equalCells([[input.value]], [[replacement]]) else {
      throw KittyError.message("This value is already recorded in your Sheet. Nothing needs saving.")
    }
    let edit = SheetInputEdit(id: UUID(), sheetID: sheetID, sheetName: sheetName,
      schemaVersion: version, connectionEpoch: epoch, kind: kind, recordKey: recordKey,
      row: input.row, before: input.value, replacement: replacement, preparedAt: now)
    try edit.validate()
    return edit
  }

  static func currentVersion(_ kitty: [[GoogleCell]]) throws -> Int {
    let versions = kitty.filter { $0.first?.displayString.trimmingCharacters(in: .whitespacesAndNewlines) == "sheet_version" }
    guard versions.count == 1, versions[0].first?.displayString == "sheet_version",
      versions[0].count > 1, let version = Int(versions[0][1].displayString), [1, 2].contains(version) else {
      throw KittyError.message("This Sheet needs one supported version before an input can be edited.")
    }
    return version
  }

  static func currentInput(kind: SheetInputKind, recordKey: String, grid: [[GoogleCell]],
    allowFormulaObservation: Bool = false) throws
    -> (row: Int, value: GoogleCell) {
    let headers = grid.enumerated().filter { $0.element.first?.displayString == kind.headers[0] }
    guard headers.count == 1,
      kind.headers.enumerated().allSatisfy({ $0.offset < headers[0].element.count && headers[0].element[$0.offset].displayString == $0.element }) else {
      throw KittyError.message("The \(kind.sheet) columns changed. Restore the Kitty template headers before editing.")
    }
    let matches = grid.enumerated().filter {
      $0.element.first?.displayString.trimmingCharacters(in: .whitespacesAndNewlines) == recordKey
    }
    guard matches.count == 1, matches[0].offset > headers[0].offset,
      matches[0].element.first?.displayString == recordKey else {
      throw KittyError.message("The \(kind.sheet) input is missing, repeated or has changed identity. Repair it in the Sheet and refresh.")
    }
    let column = kind == .subscriptionDecision ? 6 : 1
    let before = matches[0].element.count > column ? matches[0].element[column] : .empty
    guard allowFormulaObservation || !before.displayString.hasPrefix("=") else {
      throw KittyError.message("This input contains a formula or formula-like text. Open the Sheet to review it; the app will not replace it.")
    }
    return (matches[0].offset + 1, before)
  }
}

/// A read-only observation for an explicit recovery decision. It is not a successful write receipt.
struct SheetInputObservation: Codable, Equatable, Identifiable {
  let editID: UUID
  let sheetID: String
  let connectionEpoch: UUID
  let schemaVersion: Int
  let row: Int
  let value: GoogleCell
  let observedAt: Date
  var id: UUID { editID }
}

/// Retains the unresolved original intent after the user accepts a freshly checked current state.
/// The original outcome deliberately stays unverified, even if an old request later completes.
struct SheetInputRecoveryArchive: Codable, Equatable {
  let original: SheetInputEdit
  let observation: SheetInputObservation
  let acceptedAt: Date
}
