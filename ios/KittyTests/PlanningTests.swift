import XCTest

@testable import Kitty

@MainActor final class PlanningTests: XCTestCase {
  private func demo(_ edit: ((inout [String: Any]) -> Void)? = nil) throws -> Household {
    let url = try XCTUnwrap(Bundle.main.url(forResource: "demo", withExtension: "json"))
    var source = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
    edit?(&source)
    return try EngineBridge().project(JSONSerialization.data(withJSONObject: source))
  }

  func testNativePlanningPreservesSourceValuesAndRecordedPeriods() throws {
    let household = try demo()
    let planning = try XCTUnwrap(household.planning)
    XCTAssertEqual(planning.mortgage?.balance, 591_715.18)
    XCTAssertEqual(planning.mortgage?.scenarios.count, 13)
    XCTAssertEqual(planning.payslips.count, 83)
    XCTAssertEqual(planning.paydays.first?.lastPaid, "2027-01-21")
    XCTAssertEqual(planning.safety.target, 6)
    XCTAssertEqual(planning.rental?.from, "2026-02-01")
    XCTAssertEqual(planning.rental?.to, household.asOf)
    XCTAssertEqual(planning.rental?.net, -26_989.75)
    XCTAssertEqual(planning.financialYear, "FY27")
  }

  func testUnknownScenarioFiguresRemainUnknownInSwift() throws {
    let household = try demo { source in
      var inputs = source["mortgage_inputs"] as! [String: Any]
      inputs["Loan balance ($)"] = NSNull()
      source["mortgage_inputs"] = inputs
      var rows = source["mortgage_extra"] as! [[String: Any]]
      rows[0]["interest_saved"] = NSNull()
      source["mortgage_extra"] = rows
    }
    XCTAssertNil(household.planning?.mortgage?.balance)
    XCTAssertNil(household.planning?.mortgage?.extras.first?.interestSaved)
    XCTAssertEqual(money(household.planning?.mortgage?.balance), "Not available")
    XCTAssertEqual(percentage(nil), "Not available")
  }

  func testAWorkbookWithoutOptionalPlanningDomainsStillLoads() throws {
    let household = try demo { source in
      for key in ["mortgage_inputs", "mortgage", "mortgage_extra", "payslips"] {
        source.removeValue(forKey: key)
      }
    }
    XCTAssertNil(household.planning?.mortgage)
    XCTAssertEqual(household.planning?.payslips.count, 0)
    XCTAssertEqual(household.planning?.paydays.count, 0)
    XCTAssertEqual(household.transactions.count, 925)
  }
}
