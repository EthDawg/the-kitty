import XCTest
@testable import Kitty

@MainActor final class AskContextTests: XCTestCase {
  func testSelectedTransactionHandoffDoesNotIncludeUnrelatedHouseholdFacts() {
    let store = KittyStore()
    store.openDemo()
    let context = store.contextForAI(question: "Explain this charge.", scope: .transaction, transactionID: "T0919")
    XCTAssertTrue(context.contains("WOOLWORTHS 3021 BRUNSWICK"))
    XCTAssertTrue(context.contains("403.95"))
    XCTAssertFalse(context.contains("99,388.43"))
    XCTAssertFalse(context.contains("Japan trip"))
    XCTAssertFalse(context.contains("docs.google.com"))
  }
  func testGoalsHandoffPreservesOverageAndWarnsAgainstDoubleCounting() {
    let store = KittyStore()
    store.openDemo()
    let context = store.contextForAI(question: "How are our goals?", scope: .goals)
    XCTAssertTrue(context.contains("Japan trip, April 2027"))
    XCTAssertTrue(context.contains("12,090.25"))
    XCTAssertTrue(context.contains("12,000.00"))
    XCTAssertTrue(context.contains("Do not add them as extra assets"))
    XCTAssertFalse(context.contains("WOOLWORTHS"))
  }
  func testOfflineSummaryDoesNotPretendToBeFresh() {
    let store = KittyStore()
    store.openDemo()
    store.isOffline = true
    let context = store.contextForAI(question: "What changed?")
    XCTAssertTrue(context.contains("freshness has not been verified"))
    XCTAssertTrue(context.contains("2027-01-31"))
    XCTAssertTrue(context.contains("fictional demo"))
  }
}
