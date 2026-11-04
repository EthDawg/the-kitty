import XCTest
@testable import Kitty

final class HouseholdSetupDraftTests: XCTestCase {
  private let now = ISO8601DateFormatter().date(from: "2026-11-05T00:00:00Z")!
  private func draft() -> HouseholdSetupDraft {
    var value = HouseholdSetupDraft()
    value.householdName = " Taylor household "
    value.firstPerson = " Taylor "
    value.openingDate = ISO8601DateFormatter().date(from: "2026-10-31T00:00:00Z")!
    value.accounts = [HouseholdSetupAccount(id: "ACC-B", name: "Card", institution: "Example Bank",
      type: "Credit card", owner: "Taylor", openingAmount: "123.45", isOwed: true),
      HouseholdSetupAccount(id: "ACC-A", name: "Everyday", institution: "Example Bank",
        type: "Transaction", owner: "Joint", openingAmount: "1000.01", isOwed: false)]
    return value
  }

  func testExactMinorUnitsAndReviewLabelsNeverRoundThroughDouble() throws {
    XCTAssertEqual(try HouseholdSetupDraft.minor("0.1"), "10")
    XCTAssertEqual(try HouseholdSetupDraft.minor("000.00", owed: true), "0")
    XCTAssertEqual(try HouseholdSetupDraft.minor("999999999999.99", owed: true), "-99999999999999")
    XCTAssertEqual(HouseholdSetupDraft.money(minor: "-9007199254740991"), "−$90,071,992,547,409.91")
    for invalid in ["1000000000000", "90071992547409.92", "1.001", "1,25", "1,000.00", "1e3", "-12", "$10", ""] {
      XCTAssertThrowsError(try HouseholdSetupDraft.minor(invalid), invalid)
    }
  }

  func testCompletedOpeningMonthUsesTheSheetsAustralianTimezone() throws {
    let beforeMidnight = ISO8601DateFormatter().date(from: "2026-10-31T12:59:00Z")!
    let afterMidnight = ISO8601DateFormatter().date(from: "2026-10-31T13:01:00Z")!
    XCTAssertEqual(HouseholdSetupDraft.day(HouseholdSetupDraft.defaultOpeningDate(now: beforeMidnight)), "2026-09-30")
    XCTAssertEqual(HouseholdSetupDraft.day(HouseholdSetupDraft.defaultOpeningDate(now: afterMidnight)), "2026-10-31")
    XCTAssertNoThrow(try draft().approvedPayload(now: afterMidnight))
  }

  func testEqualAndOppositeLargeBalancesStillRespectAbsoluteAggregateLimit() throws {
    var value = draft()
    value.accounts[0].openingAmount = "500000000000.00"
    value.accounts[1].openingAmount = "500000000000.00"
    XCTAssertThrowsError(try value.approvedPayload(now: now))
  }

  func testApprovedPayloadBindsOwnerDirectionAndOpeningDateWithExplicitDefaults() throws {
    let value = draft()
    let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: value.approvedPayload(now: now)) as? [String: Any])
    XCTAssertEqual(payload["householdName"] as? String, "Taylor household")
    XCTAssertEqual(payload["people"] as? [String], ["Taylor"])
    XCTAssertEqual(payload["openingDate"] as? String, "2026-10-31")
    XCTAssertEqual(payload["currency"] as? String, "AUD")
    let accounts = try XCTUnwrap(payload["accounts"] as? [[String: String]])
    XCTAssertEqual(accounts.map { $0["id"]! }, ["ACC-A", "ACC-B"])
    XCTAssertEqual(accounts.map { $0["openingMinor"]! }, ["100001", "-12345"])
    XCTAssertTrue(payload["goal"] is NSNull)
    XCTAssertTrue(payload["emergencyAccountId"] is NSNull)
    XCTAssertEqual((payload["budgets"] as? [Any])?.count, 0)
    XCTAssertEqual((payload["capacity"] as? [String: Int])?["transactions"], 2000)
  }

  func testAmbiguousPeopleOwnershipAndOpeningPeriodsCannotReachApproval() throws {
    var value = draft()
    value.includesSecondPerson = true; value.secondPerson = "taylor"
    XCTAssertThrowsError(try value.approvedPayload(now: now))
    value.secondPerson = "Morgan"
    value.accounts[0].owner = "Someone else"
    XCTAssertThrowsError(try value.approvedPayload(now: now))
    value.accounts[0].owner = "Morgan"
    value.openingDate = ISO8601DateFormatter().date(from: "2026-10-30T00:00:00Z")!
    XCTAssertThrowsError(try value.approvedPayload(now: now))
    value.openingDate = ISO8601DateFormatter().date(from: "2026-11-30T00:00:00Z")!
    XCTAssertThrowsError(try value.approvedPayload(now: now))
  }

  func testGoalAndEmergencyFundCannotTreatDebtAsSavings() throws {
    var value = draft()
    value.emergencyAccountId = "ACC-B"
    XCTAssertThrowsError(try value.approvedPayload(now: now))
    value.emergencyAccountId = "ACC-A"
    value.includesGoal = true; value.goalName = "Trip"; value.goalAmount = "500"
    value.goalDate = ISO8601DateFormatter().date(from: "2027-05-31T00:00:00Z")!
    value.goalAccountId = "ACC-B"
    XCTAssertThrowsError(try value.approvedPayload(now: now))
    value.goalAccountId = "ACC-A"
    XCTAssertNoThrow(try value.approvedPayload(now: now))
  }

  func testDraftRoundtripPreservesUnsubmittedFinancialChoices() throws {
    let value = draft()
    let data = try JSONEncoder().encode(value)
    let restored = try JSONDecoder().decode(HouseholdSetupDraft.self, from: data)
    XCTAssertEqual(restored, value)
    XCTAssertEqual(try restored.approvedPayload(now: now), try value.approvedPayload(now: now))
    XCTAssertFalse(restored.isLocked)
  }
}
