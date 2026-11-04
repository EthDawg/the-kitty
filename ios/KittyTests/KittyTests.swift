import XCTest

@testable import Kitty

@MainActor
final class KittyTests: XCTestCase {
  private func demoData() throws -> Data {
    let url = try XCTUnwrap(Bundle.main.url(forResource: "demo", withExtension: "json"))
    return try Data(contentsOf: url)
  }

  private func editedDemo(_ edit: (inout [String: Any]) -> Void) throws -> Data {
    var object = try XCTUnwrap(JSONSerialization.jsonObject(with: demoData()) as? [String: Any])
    edit(&object)
    return try JSONSerialization.data(withJSONObject: object)
  }

  func testBundledHouseholdDecodesAndAgreesWithPinnedSheetFigures() throws {
    let household = try EngineBridge().project(demoData())
    XCTAssertEqual(household.household, "The Davies")
    XCTAssertEqual(household.asOf, "2027-01-31")
    XCTAssertEqual(household.currency, "AUD")
    XCTAssertEqual(household.transactions.count, 925)
    XCTAssertEqual(try XCTUnwrap(household.value("networth.cash")), 99_388.43, accuracy: 0.005)
    XCTAssertEqual(
      try XCTUnwrap(household.value("cashflow.income.month")), 15_386.14, accuracy: 0.005)
    XCTAssertFalse(household.reconciliation.isEmpty)
    XCTAssertTrue(
      household.reconciliation.allSatisfy(\.ok),
      "The bundled finance projection must agree with the Sheet oracle.")
    XCTAssertEqual(household.transactions.first?.id, "T0925")
  }

  func testPublicFeedFlagPreservesTheScriptFirstMatchingKey() throws {
    let data = try editedDemo { object in
      var kitty = object["kitty"] as! [[String: Any]]
      kitty.removeAll { ($0["key"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) == "public_feed" }
      kitty += [["key": " public_feed ", "value": " YeS "], ["key": "public_feed", "value": "no"]]
      object["kitty"] = kitty
    }
    XCTAssertTrue(try EngineBridge().project(data).publicFeedEnabled)
  }
  func testGridFeedFlagSurvivesRowsOutsideTheSettingsTable() throws {
    let engine = try EngineBridge()
    let grids: [String: Any] = ["kitty": [
      ["Key", "Value"], ["sheet_version", "1"], [], ["public_feed", " YeS "]
    ]]
    let snapshot = try XCTUnwrap(JSONSerialization.jsonObject(with: engine.snapshot(grids: grids)) as? [String: Any])
    XCTAssertEqual(snapshot["publicFeedEnabled"] as? Bool, true)
    let data = try editedDemo { object in
      object["kitty"] = snapshot["kitty"]
      object["publicFeedEnabled"] = snapshot["publicFeedEnabled"]
    }
    XCTAssertTrue(try engine.project(data).publicFeedEnabled)
  }

  func testNativeProjectionPreservesOriginalEvidenceAndGoalOverage() throws {
    let household = try EngineBridge().project(demoData())
    let transaction = try XCTUnwrap(household.transactions.first { $0.id == "T0919" })
    XCTAssertEqual(transaction.desc, "WOOLWORTHS 3021 BRUNSWICK")
    XCTAssertEqual(transaction.merchant, "Woolworths")
    XCTAssertEqual(transaction.amount, -403.95, accuracy: 0.005)
    XCTAssertEqual(transaction.acct, "ACC-CC")
    let goal = try XCTUnwrap(household.goals.first { $0.name == "Japan trip, April 2027" })
    XCTAssertEqual(try XCTUnwrap(goal.balance), 12_090.25, accuracy: 0.005)
    XCTAssertEqual(goal.target, 12_000)
    XCTAssertGreaterThan(
      try XCTUnwrap(goal.balance), try XCTUnwrap(goal.target),
      "A capped visual progress bar must not discard the actual over-target balance.")
  }

  func testUnknownSchemaAndMissingAccountsFailBeforePresentingHousehold() throws {
    let engine = try EngineBridge()
    let unsupported = try editedDemo { object in
      var kitty = object["kitty"] as! [[String: Any]]
      let index = kitty.firstIndex { $0["key"] as? String == "sheet_version" }!
      kitty[index]["value"] = 99
      object["kitty"] = kitty
    }
    XCTAssertThrowsError(try engine.project(unsupported))
    let missing = try editedDemo { $0["accounts"] = [] }
    XCTAssertThrowsError(try engine.project(missing))
    // A refused workbook must not poison a subsequent valid JavaScriptCore projection.
    XCTAssertEqual(try engine.project(demoData()).transactions.count, 925)
  }

  func testMissingMetricRemainsMissingInsteadOfBecomingZero() throws {
    let data = try editedDemo { object in
      var metrics = object["metrics"] as! [[String: Any]]
      let index = metrics.firstIndex { $0["metric_id"] as? String == "networth.cash" }!
      metrics[index]["value"] = NSNull()
      object["metrics"] = metrics
    }
    let household = try EngineBridge().project(data)
    XCTAssertNil(household.value("networth.cash"))
    XCTAssertEqual(money(household.value("networth.cash")), "Not available")
  }

  func testNativeGoogleGridProjectionPreservesNumericDatesAndSignedAmount() throws {
    let engine = try EngineBridge()
    let grids: [String: Any] = [
      "kitty": [
        ["Key", "Value"], ["sheet_version", 1], ["household_name", "Synthetic household"],
        ["currency", "AUD"],
      ],
      "settings": [["Setting", "Value"], ["As-of date", 46_783]],
      "accounts": [
        [
          "Account ID", "Account", "Institution", "Type", "Owner", "Opening balance",
          "Opening date", "Balance at as-of date", "Liquid",
        ], ["A", "Everyday", "Fictional Bank", "transaction", "Joint", 100, 46_783, 95.5, "Yes"],
      ],
      "category_list": [
        ["Category ID", "Category", "Group", "Flow"], ["FOOD", "Food", "Essentials", "Expense"],
      ],
      "transactions": [
        [
          "Txn ID", "Date", "Account ID", "Bank description", "Merchant", "Amount", "Category ID",
          "Person", "Receipt held", "Note",
        ], ["T0001", 46_783, "A", "COFFEE ORIGINAL", "Coffee", -4.5, "FOOD", "Joint", "", ""],
      ],
      "metrics": [
        ["Metric ID", "Metric", "Value", "Unit", "Period"],
        ["networth.cash", "Cash", 95.5, "AUD", "31 Jan 2028"],
      ],
    ]
    let household = try engine.project(engine.snapshot(grids: grids))
    XCTAssertEqual(household.household, "Synthetic household")
    XCTAssertEqual(household.transactions.count, 1)
    XCTAssertEqual(household.transactions[0].amount, -4.5)
    XCTAssertEqual(household.transactions[0].desc, "COFFEE ORIGINAL")
    XCTAssertEqual(household.transactions[0].date, "2028-01-31")
    XCTAssertEqual(household.value("networth.cash"), 95.5)
  }

  private var mapping: [String: Any] {
    [
      "confirmed": true, "date": "Date", "description": "Description", "amount": "Amount",
      "sign": "money-in-positive", "dateOrder": "dmy",
    ]
  }
  private func importFile(
    _ text: String, id: String = "F1", account: String = "A", name: String = "statement.csv",
    map: [String: Any]? = nil
  ) -> [String: Any] {
    ["id": id, "name": name, "text": text, "accountId": account, "mapping": map ?? mapping]
  }
  private func proposal(_ files: [[String: Any]], existing: [[String: Any]] = []) throws -> [String:
    Any]
  {
    let input: [String: Any] = [
      "files": files,
      "accounts": [["id": "A", "name": "Everyday", "owner": "Joint", "currency": "AUD"]],
      "categories": [["id": "FOOD", "name": "Food"], ["id": "UNCAT", "name": "Uncategorised"]],
      "existing": existing, "decisions": ["Coffee": ["categoryId": "FOOD"]],
    ]
    let data = try EngineBridge().call("KittyImport", method: "prepare", input: input)
    return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
  }

  func testJavaScriptCoreImportHandlesBOMAndExactCentsThenRejectsReplay() throws {
    let file = importFile("\u{FEFF}Date,Description,Amount\r\n03/02/2027,Coffee,-0.29\r\n")
    let first = try proposal([file])
    XCTAssertEqual(first["canCommit"] as? Bool, true)
    let rows = try XCTUnwrap(first["rows"] as? [[String: Any]])
    XCTAssertEqual(rows.count, 1)
    XCTAssertEqual(rows[0]["amountMinor"] as? String, "-29")
    XCTAssertEqual(rows[0]["date"] as? String, "2027-02-03")
    let replay = try proposal([file], existing: rows)
    XCTAssertEqual((replay["rows"] as? [Any])?.count, 0)
    XCTAssertEqual((replay["counts"] as? [String: Any])?["existing"] as? Int, 1)
  }

  func testJavaScriptCoreOverlappingFilesPreserveTwoRealIdenticalCharges() throws {
    let one = "Date,Description,Amount\n03/02/2027,Coffee,-4.50"
    let two = one + "\n03/02/2027,Coffee,-4.50"
    let result = try proposal([importFile(one), importFile(two, id: "F2")])
    let rows = try XCTUnwrap(result["rows"] as? [[String: Any]])
    XCTAssertEqual(
      rows.count, 2, "The same-batch overlap must not turn two genuine charges into three.")
    XCTAssertNotEqual(rows[0]["id"] as? String, rows[1]["id"] as? String)
    XCTAssertEqual(
      result["canCommit"] as? Bool, false, "Ambiguous overlap requires review before writing.")
    let codes = (result["issues"] as? [[String: Any]])?.compactMap { $0["code"] as? String } ?? []
    XCTAssertTrue(codes.contains("overlap-review"))
    XCTAssertTrue(codes.contains("repeated-charge"))
  }

  func testJavaScriptCoreImportRefusesInvalidDatesUnknownAccountsAndPDFs() throws {
    let cases = [
      (importFile("Date,Description,Amount\n31/02/2027,Coffee,-4.50"), "date-invalid"),
      (
        importFile("Date,Description,Amount\n03/02/2027,Coffee,-4.50", account: "MISSING"),
        "account-unknown"
      ),
      (importFile("%PDF-1.7", name: "statement.pdf"), "pdf-unsupported"),
    ]
    for (file, code) in cases {
      let result = try proposal([file])
      XCTAssertEqual(result["canCommit"] as? Bool, false)
      let codes = (result["issues"] as? [[String: Any]])?.compactMap { $0["code"] as? String } ?? []
      XCTAssertTrue(codes.contains(code), "Missing actionable refusal for \(code): \(codes)")
    }
  }

  func testDemoSwitchAndAIHandoffDoNotCarryPreviousHouseholdIdentity() throws {
    let defaults = UserDefaults.standard
    let previous = defaults.object(forKey: "kitty.mode")
    defer {
      if let previous {
        defaults.set(previous, forKey: "kitty.mode")
      } else {
        defaults.removeObject(forKey: "kitty.mode")
      }
    }
    let store = KittyStore()
    store.selectedSheetID = "synthetic_previous_household"
    store.selectedSheetName = "Previous private household"
    store.lastSynced = Date()
    store.openDemo()
    XCTAssertTrue(store.isDemo)
    XCTAssertEqual(store.selectedSheetID, "")
    XCTAssertNil(store.lastSynced)
    XCTAssertEqual(store.household?.household, "The Davies")
    let handoff = store.contextForAI(question: "Explain our cash.")
    XCTAssertTrue(handoff.contains("fictional demo"))
    XCTAssertTrue(handoff.contains("2027-01-31"))
    XCTAssertTrue(handoff.contains("99,388.43"))
    XCTAssertFalse(handoff.contains("Previous private household"))
    XCTAssertFalse(handoff.contains("synthetic_previous_household"))
    XCTAssertFalse(
      handoff.contains("WOOLWORTHS 3021 BRUNSWICK"),
      "A totals-only preview must not unexpectedly include transactions.")
    XCTAssertTrue(handoff.contains("not been granted access"))
  }
}
