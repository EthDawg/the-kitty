import XCTest

@testable import Kitty

final class ActivityCSVExportTests: XCTestCase {
  private func row(id: String = "T0001", date: String = "2027-02-03", amount: Double = -4.50)
    -> ActivityCSVExport.Row
  {
    ActivityCSVExport.Row(
      id: id, date: date, accountID: "ACC-EVD", bankDescription: "Original bank narrative",
      merchant: "Coffee", amount: amount, categoryName: "Groceries", person: "Joint",
      accountName: "Everyday", categoryID: "FOOD", flow: "Expense", note: "Reviewed note",
      receipt: "Yes", currency: "AUD")
  }

  // Independent CSV reader for round-trip checks, including quoted CRLF and escaped quotes.
  private func cells(_ data: Data) throws -> [[String]] {
    let text = try XCTUnwrap(String(data: data, encoding: .utf8))
    let characters = Array(text.hasPrefix("\u{FEFF}") ? String(text.dropFirst()) : text)
    var result: [[String]] = [], record: [String] = [], value = ""
    var quoted = false, index = 0
    while index < characters.count {
      let character = characters[index]
      if character == "\"" {
        if quoted && index + 1 < characters.count && characters[index + 1] == "\"" {
          value.append("\"")
          index += 1
        } else {
          quoted.toggle()
        }
      } else if !quoted && character == "," {
        record.append(value)
        value = ""
      } else if !quoted && (character == "\r\n" || character == "\n" || character == "\r") {
        record.append(value)
        result.append(record)
        record = []
        value = ""
      } else {
        value.append(character)
      }
      index += 1
    }
    XCTAssertFalse(quoted)
    XCTAssertTrue(record.isEmpty)
    XCTAssertTrue(value.isEmpty)
    return result
  }

  func testArtifactColumnsStayFirstAndOnlySelectedRowsExportInTheirExistingOrder() throws {
    let selected = [row(id: "T0003", date: "2027-03-02"), row(id: "T0001", date: "2027-01-31")]
    let export = try ActivityCSVExport.make(rows: selected), parsed = try cells(export.data)
    XCTAssertEqual(Array(parsed[0].prefix(8)), [
      "Txn ID", "Date", "Account", "Bank description", "Merchant", "Amount", "Category", "Person",
    ])
    XCTAssertEqual(parsed[0], ActivityCSVExport.headers)
    XCTAssertEqual(parsed.dropFirst().map { $0[0] }, ["T0003", "T0001"])
    XCTAssertEqual(export.rowCount, 2)
    XCTAssertFalse(String(decoding: export.data, as: UTF8.self).contains("T0002"))
    XCTAssertEqual(export.filename, "kitty-transactions-2027-01-31-to-2027-03-02.csv")
    XCTAssertEqual(export.data, try ActivityCSVExport.make(rows: selected).data)
  }

  func testIdentifiersOriginalDescriptionsAndAnnotationsHaveSeparateStableColumns() throws {
    let parsed = try cells(ActivityCSVExport.make(rows: [row()]).data)
    XCTAssertEqual(parsed[1], [
      "T0001", "2027-02-03", "ACC-EVD", "Original bank narrative", "Coffee", "-4.50",
      "Groceries", "Joint", "Everyday", "FOOD", "Expense", "Reviewed note", "Yes", "AUD",
    ])
  }

  func testCommasQuotesCRLFAndUnicodeRoundTripWithoutChangingSourceText() throws {
    var source = row()
    source.bankDescription = "Tea, \"large\"\r\n第二行 🐱"
    source.merchant = "Café, Melbourne"
    source.person = "Zoë"
    source.note = "First\nsecond\rthird\r\nfourth"
    let export = try ActivityCSVExport.make(rows: [source]), parsed = try cells(export.data)
    XCTAssertEqual(Array(export.data.prefix(3)), [0xEF, 0xBB, 0xBF])
    XCTAssertEqual(parsed.count, 2)
    XCTAssertEqual(parsed[1][3], source.bankDescription)
    XCTAssertEqual(parsed[1][4], source.merchant)
    XCTAssertEqual(parsed[1][7], source.person)
    XCTAssertEqual(parsed[1][11], source.note)
    XCTAssertEqual(export.protectedCellCount, 0)
    XCTAssertTrue(String(decoding: export.data, as: UTF8.self).hasSuffix("\r\n"))
  }

  func testFormulaAndControlPrefixesAreProtectedReversibly() throws {
    let originals = [
      "=SUM(1,2)", "+1+1", "-2+3", "@SUM(1,2)", "  =1+1", "\t=1+1", "\r\n=1+1",
      "\u{FEFF}=1+1", "\u{200B}=1+1", "\u{00A0}@formula", "'original apostrophe",
      "＝1+1", "＋1", "－1", "＠formula", "\tordinary text", "\n",
    ]
    for original in originals {
      var source = row()
      source.bankDescription = original
      let export = try ActivityCSVExport.make(rows: [source]), parsed = try cells(export.data)
      XCTAssertEqual(export.protectedCellCount, 1, original)
      XCTAssertEqual(parsed[1][3], "'" + original)
      XCTAssertEqual(String(parsed[1][3].dropFirst()), original)
    }
  }

  func testEveryTextColumnIsProtectedAndNegativeMoneyRemainsNumeric() throws {
    var source = row()
    source.id = "=id"
    source.accountID = "@account"
    source.bankDescription = "+description"
    source.merchant = "-merchant"
    source.categoryName = "=category"
    source.person = "@person"
    source.accountName = "+account name"
    source.categoryID = "-category ID"
    source.flow = "=flow"
    source.note = "@note"
    source.receipt = "+receipt"
    source.currency = "-currency"
    let export = try ActivityCSVExport.make(rows: [source]), parsed = try cells(export.data)
    XCTAssertEqual(export.protectedCellCount, 12)
    for index in parsed[1].indices where index != 1 && index != 5 {
      XCTAssertTrue(parsed[1][index].hasPrefix("'"), "Column \(index)")
    }
    XCTAssertEqual(parsed[1][1], "2027-02-03")
    XCTAssertEqual(parsed[1][5], "-4.50")
    XCTAssertTrue(String(decoding: export.data, as: UTF8.self).contains(",-4.50,"))
  }

  func testExactDecimalMoneyIsLocaleIndependentAndKeepsZeroes() throws {
    for (amount, expected) in [
      (0.0, "0.00"), (-0.0, "0.00"), (0.01, "0.01"), (-0.01, "-0.01"),
      (0.29, "0.29"), (0.1 + 0.2, "0.30"), (1234.5, "1234.50"),
      (999_999_999_999.99, "999999999999.99"), (-999_999_999_999.99, "-999999999999.99"),
    ] {
      XCTAssertEqual(try cells(ActivityCSVExport.make(rows: [row(amount: amount)]).data)[1][5], expected)
    }
  }

  func testUnavailableOutOfRangeAndFractionalCentAmountsFailWithoutPartialExport() {
    for amount in [Double.nan, .infinity, -.infinity, 1_000_000_000_000, 1.234, -1.235, 0.001, Double.leastNonzeroMagnitude] {
      XCTAssertThrowsError(try ActivityCSVExport.make(rows: [row(), row(amount: amount)])) { error in
        XCTAssertEqual(error as? ActivityCSVExport.ExportError, .invalidAmount(row: 2))
      }
    }
  }

  func testInvalidAndAmbiguousDatesFailWhileLeapDateStaysISO() throws {
    for date in ["03/02/2027", "2027-2-03", "2027-02-29", "2027-13-01", "2027-01-32", "2027-02-03T10:00:00Z", "=TODAY()", "0000-01-01"] {
      XCTAssertThrowsError(try ActivityCSVExport.make(rows: [row(date: date)])) { error in
        XCTAssertEqual(error as? ActivityCSVExport.ExportError, .invalidDate(row: 1))
      }
    }
    XCTAssertEqual(try cells(ActivityCSVExport.make(rows: [row(date: "2028-02-29")]).data)[1][1], "2028-02-29")
  }

  func testEmptySelectionCannotProduceAHeaderOnlyExport() {
    XCTAssertThrowsError(try ActivityCSVExport.make(rows: [])) { error in
      XCTAssertEqual(error as? ActivityCSVExport.ExportError, .noRows)
    }
  }
}
