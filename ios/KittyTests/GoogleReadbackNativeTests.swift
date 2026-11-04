import XCTest
@testable import Kitty

@MainActor final class GoogleReadbackNativeTests: XCTestCase {
  func testCleanGoogleHouseholdDecodesWithNoLargestTransactionPeriod() throws {
    let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "opening-household-grids", withExtension: "json"))
    let grids = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
    let engine = try EngineBridge()
    let household = try engine.project(engine.snapshot(grids: grids))
    XCTAssertEqual(household.household, "QA fixture - Solo (fictional)")
    XCTAssertEqual(household.accounts.count, 1)
    XCTAssertEqual(household.accounts.first?.balance, 1234.56)
    XCTAssertEqual(household.transactions.count, 0)
    XCTAssertNil(household.metrics["spending.largest_expense"]?.period)
    XCTAssertNil(household.metrics["cashflow.income.month"]?.num)
    XCTAssertNil(household.planning?.mortgage)
    XCTAssertTrue(household.goals.isEmpty)
  }
}
