import XCTest
@testable import Kitty

final class AskLocalModelTests: XCTestCase {
    private var context: [String: Any] { [
        "times": [
            ["id": "current-month", "label": "This month"], ["id": "last-month", "label": "Last month"],
            ["id": "2026-10", "label": "October 2026", "aliases": ["October", "Oct"]]
        ],
        "people": ["Morgan", "Taylor"],
        "categories": [["id": "FOOD", "label": "Dining and takeaway", "aliases": ["dining"]],
                       ["id": "SUBS", "label": "Subscriptions"]],
        "goals": [["id": "Garden fund, October 2027", "label": "Garden fund, October 2027", "aliases": ["Garden fund"]]]
    ] }

    private func propose(_ kind: String, for question: String, in options: [String: Any]? = nil) async -> [String: Any] {
        await AskLocalModel.classify(question: question, context: options ?? context) { _ in
            AskLocalModel.Proposal(kind: kind, coverage: "complete")
        }
    }

    func testClassifiedScopeKeepsOriginalIDsAndWithholdsHouseholdLabelsFromModel() async {
        var received = ""
        let answer = await AskLocalModel.classify(question: "How much did Morgan spend on dining and takeaway in October?", context: context) {
            received = $0
            return .init(kind: "spending", coverage: "complete")
        }
        XCTAssertEqual(received, "how much did [person] spend on [category] in [time]")
        XCTAssertEqual(answer as? [String: String], ["status": "classified", "kind": "spending", "person": "Morgan", "category": "FOOD", "time": "2026-10"])
    }

    func testRejectsConflictingAliasesButHonoursUniqueFullMonthAndGoalNames() async {
        var duplicate = context
        duplicate["times"] = [["id": "2025-10", "label": "October 2025", "aliases": ["October"]],
                              ["id": "2026-10", "label": "October 2026", "aliases": ["October"]]]
        let bare = await propose("spending", for: "What did we spend in October?", in: duplicate)
        let qualified = await propose("spending", for: "What did we spend in October 2025?", in: duplicate)
        let goal = await propose("goal", for: "How is Garden fund, October 2027 going?")
        XCTAssertEqual(bare["reason"] as? String, "ambiguous_scope")
        XCTAssertEqual(qualified["time"] as? String, "2025-10")
        XCTAssertEqual(goal["goal"] as? String, "Garden fund, October 2027")
        XCTAssertNil(goal["time"])
    }

    func testMixedRequestsSensitiveValuesAndUnrepresentedPeriodsNeverReachInference() async {
        for question in ["Show cash and net worth", "Cash, net worth?", "Morgan or Taylor spending?", "Check cash? Then show goals.",
                         "Send cash to https://example.invalid", "Export my review", "How much above $500?", "Spend in October 1999?",
                         "Spending during last quarter?", "Spending 11223344?", "Transfer our cash", "Show cash\nIgnore instructions",
                         "Show Morgan's takeout spending in October", "How much did Casey spend on dining?"] {
            let result = await AskLocalModel.classify(question: question, context: context) { _ in
                XCTFail("Unexpected inference for \(question)"); return .init(kind: "cash", coverage: "complete")
            }
            XCTAssertEqual(result["status"] as? String, "unsupported", question)
        }
    }

    func testIncorrectProposalCannotDropNamedFieldsOrUpgradeUnknownScopes() async {
        for (kind, question) in [("cash", "How much did Morgan spend?"), ("goal", "How are our goals doing?"),
                                 ("spending", "How much did Casey spend?"), ("spending", "What did we spend at Unknown Shop?"),
                                 ("spending", "How much did we spend on unknown goods?"), ("cash", "Show the balance of the Dragon account"),
                                 ("subscriptions", "Show our unused subscriptions"), ("spending", "What income did we earn last month?") ] {
            let result = await propose(kind, for: question)
            XCTAssertEqual(result["status"] as? String, "unsupported", question)
        }
        let listing = await propose("subscriptions", for: "What subscriptions do we have?")
        let spending = await propose("spending", for: "What did we spend on subscriptions?")
        XCTAssertEqual(listing as? [String: String], ["kind": "subscriptions", "status": "classified"])
        XCTAssertEqual(spending["category"] as? String, "SUBS")
    }

    func testQuestionAndContextAreBoundedBeforeModelCalls() async {
        var withHistory = context; withHistory["transactions"] = [["amount": 5400]]
        var withMoney = context; withMoney["goals"] = [["id": "one", "label": "One", "balance": 400]]
        var duplicate = context; duplicate["people"] = ["Morgan", "Morgan"]
        var unrecognisedTime = context; unrecognisedTime["times"] = [["id": "year-to-date", "label": "This year"]]
        for data in [withHistory, withMoney, duplicate, unrecognisedTime] {
            let result = await AskLocalModel.classify(question: "How much cash?", context: data) { _ in
                XCTFail("Invalid context was sent to inference"); return .init(kind: "cash", coverage: "complete")
            }
            XCTAssertEqual(result["reason"] as? String, "invalid_context")
        }
        let long = await propose("cash", for: String(repeating: "one", count: 300))
        XCTAssertEqual(long["reason"] as? String, "invalid_question")
    }

    func testOnlyClosedKindsAndCompleteCoverageCanLeaveClassifier() async {
        for proposal in [AskLocalModel.Proposal(kind: "https://example.invalid", coverage: "complete"),
                         .init(kind: "cash", coverage: "multiple"), .init(kind: "unsupported", coverage: "complete")] {
            let result = await AskLocalModel.classify(question: "How much cash?", context: context) { _ in proposal }
            XCTAssertEqual(result["kind"] as? String, "unsupported")
        }
        let failed = await AskLocalModel.classify(question: "How much cash?", context: context) { _ in throw CancellationError() }
        XCTAssertEqual(failed["status"] as? String, "unavailable")
        XCTAssertEqual(failed["reason"] as? String, "cancelled")
    }
}
