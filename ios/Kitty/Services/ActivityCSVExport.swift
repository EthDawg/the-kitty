import Foundation

/// A local export of an already-selected Activity snapshot. It performs no file or network I/O.
enum ActivityCSVExport {
  struct Row {
    var id, date, accountID, bankDescription, merchant: String
    var amount: Double
    var categoryName, person, accountName, categoryID, flow, note, receipt, currency: String
  }

  struct Export {
    let data: Data
    let rowCount: Int
    let protectedCellCount: Int
    let filename: String
  }

  enum ExportError: LocalizedError, Equatable {
    case noRows
    case invalidDate(row: Int)
    case invalidAmount(row: Int)

    var errorDescription: String? {
      switch self {
      case .noRows:
        return "There are no transactions in this view to export."
      case .invalidDate(let row):
        return "Transaction \(row) has an invalid date. Refresh or correct the Sheet before exporting."
      case .invalidAmount(let row):
        return "Transaction \(row) has an unavailable amount or a value that cannot be exported as exact cents. Refresh or correct the Sheet before exporting."
      }
    }
  }

  // Keep the artifact's first eight columns in the same order; append its missing identifiers/context.
  static let headers = [
    "Txn ID", "Date", "Account", "Bank description", "Merchant", "Amount", "Category", "Person",
    "Account name", "Category ID", "Flow", "Note", "Receipt held", "Currency",
  ]

  static func make(rows: [Row]) throws -> Export {
    guard !rows.isEmpty else { throw ExportError.noRows }
    var lines = [headers.map(quoted).joined(separator: ",")]
    var protectedCells = 0
    func text(_ value: String) -> String {
      let protect = needsProtection(value)
      if protect { protectedCells += 1 }
      return quoted(protect ? "'" + value : value)
    }

    for (index, row) in rows.enumerated() {
      guard isISODate(row.date) else { throw ExportError.invalidDate(row: index + 1) }
      let amount = try decimalAmount(row.amount, row: index + 1)
      lines.append(
        [
          text(row.id), text(row.date), text(row.accountID), text(row.bankDescription),
          text(row.merchant), amount, text(row.categoryName), text(row.person),
          text(row.accountName), text(row.categoryID), text(row.flow), text(row.note),
          text(row.receipt), text(row.currency),
        ].joined(separator: ","))
    }

    let dates = rows.map(\.date)
    let first = dates.min()!, last = dates.max()!
    let period = first == last ? first : "\(first)-to-\(last)"
    // UTF-8 BOM helps spreadsheet apps retain Unicode. CRLF is the CSV record delimiter;
    // original embedded newlines stay inside quoted cells without normalization.
    let data = Data(("\u{FEFF}" + lines.joined(separator: "\r\n") + "\r\n").utf8)
    return Export(
      data: data, rowCount: rows.count, protectedCellCount: protectedCells,
      filename: "kitty-transactions-\(period).csv")
  }

  private static func quoted(_ value: String) -> String {
    "\"" + value.replacingOccurrences(of: "\"", with: "\"\"") + "\""
  }

  /// Protect every textual column, including identifiers and annotations. Existing leading
  /// apostrophes are protected too, so removing one added apostrophe is unambiguous/reversible.
  private static func needsProtection(_ value: String) -> Bool {
    let dangerous = CharacterSet(charactersIn: "=+-@'＝＋－＠")
    var leadingControl = false
    for scalar in value.unicodeScalars {
      let control = CharacterSet.controlCharacters.contains(scalar)
        || scalar.properties.generalCategory == .format
      if control || CharacterSet.whitespacesAndNewlines.contains(scalar) {
        leadingControl = leadingControl || control
        continue
      }
      return leadingControl || dangerous.contains(scalar)
    }
    return leadingControl
  }

  private static func decimalAmount(_ value: Double, row: Int) throws -> String {
    guard value.isFinite else { throw ExportError.invalidAmount(row: row) }
    let rounded = (value * 100).rounded(.toNearestOrAwayFromZero)
    guard rounded.isFinite, abs(rounded) <= 99_999_999_999_999 else {
      throw ExportError.invalidAmount(row: row)
    }
    guard rounded != 0 || value == 0 else { throw ExportError.invalidAmount(row: row) }
    let recovered = rounded / 100
    // Accept representation noise from a two-decimal Sheet number; never round a genuine
    // fractional cent or print using locale-dependent floating-point formatting.
    guard abs(value - recovered) <= max(value.ulp, recovered.ulp) * 2 else {
      throw ExportError.invalidAmount(row: row)
    }
    let minor = Int64(rounded), magnitude = abs(minor)
    let fraction = magnitude % 100
    return "\(minor < 0 ? "-" : "")\(magnitude / 100).\(fraction < 10 ? "0" : "")\(fraction)"
  }

  private static func isISODate(_ value: String) -> Bool {
    let bytes = Array(value.utf8)
    guard bytes.count == 10, bytes[4] == 45, bytes[7] == 45,
      bytes.enumerated().allSatisfy({ $0.offset == 4 || $0.offset == 7 || (48...57).contains($0.element) }),
      let year = Int(value.prefix(4)), let month = Int(value.dropFirst(5).prefix(2)),
      let day = Int(value.suffix(2)), year > 0
    else { return false }
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(secondsFromGMT: 0)!
    let parts = DateComponents(year: year, month: month, day: day)
    guard let date = calendar.date(from: parts) else { return false }
    let actual = calendar.dateComponents([.year, .month, .day], from: date)
    return actual.year == year && actual.month == month && actual.day == day
  }
}
