import XCTest
@testable import AskAppleProbe

final class AskLocalModelTests: XCTestCase {
    func testProposalCarriesOnlyClosedKindAndCoverage() async {
        let mask = "how much did [person] spend on [category] in [time]"
        var received = ""
        let answer = await AskLocalModel.classify(maskedQuestion: mask) { text in
            received = text
            return .init(kind: "spending", coverage: "complete")
        }
        XCTAssertEqual(received, mask)
        XCTAssertEqual(answer as? [String: String], ["status": "proposed", "kind": "spending", "coverage": "complete"])
    }

    func testMalformedTransportNeverReachesTheModel() async {
        for mask in ["", " show cash", "show  cash", "cash\nnow", "[unknown]", "cash [goal", "cash €900",
                     "https://example.invalid", String(repeating: "a", count: 601),
                     Array(repeating: "word", count: 101).joined(separator: " ")] {
            let answer = await AskLocalModel.classify(maskedQuestion: mask) { _ in
                XCTFail("Malformed input reached inference"); return .init(kind: "cash", coverage: "complete")
            }
            XCTAssertEqual(answer["status"] as? String, "unsupported")
            XCTAssertEqual(answer["reason"] as? String, "invalid_mask")
        }
    }

    func testUnrecognisedKindsOrIncompleteCoverageCannotProduceAProposal() async {
        for proposal in [AskLocalModel.Proposal(kind: "https://example.invalid", coverage: "complete"),
                         .init(kind: "cash", coverage: "unknown"), .init(kind: "unsupported", coverage: "complete")] {
            let answer = await AskLocalModel.classify(maskedQuestion: "how much cash") { _ in proposal }
            XCTAssertEqual(answer["kind"] as? String, "unsupported")
            XCTAssertEqual(answer["coverage"] as? String, "unsupported")
        }
    }

    func testCancelledAndFailedInferenceHaveUnavailabilityStatus() async {
        let cancelled = await AskLocalModel.classify(maskedQuestion: "how much cash") { _ in throw CancellationError() }
        XCTAssertEqual(cancelled["status"] as? String, "unavailable")
        XCTAssertEqual(cancelled["reason"] as? String, "cancelled")
        let failed = await AskLocalModel.classify(maskedQuestion: "how much cash") { _ in throw NSError(domain: "fixture", code: 1) }
        XCTAssertEqual(failed["status"] as? String, "unavailable")
        XCTAssertEqual(failed["reason"] as? String, "inference_unavailable")
    }
}
