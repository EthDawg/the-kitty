import XCTest
@testable import Kitty

final class CloseReviewDecisionTests: XCTestCase {
  func testExtremeMinorStringsCannotOverflowOrTrap() {
    for value in [String(Int64.min), String(Int64.max), "100000000000000", "-100000000000000",
      "01", "-0", "1.00", " 1", "1e2"] {
      XCTAssertNil(CloseExactMoney.minor(value), value)
      XCTAssertEqual(CloseExactMoney.display(value, currency: "AUD"), "Not available", value)
    }
    XCTAssertEqual(CloseExactMoney.minor("99999999999999"), CloseExactMoney.limit)
    XCTAssertEqual(CloseExactMoney.minor("-99999999999999"), -CloseExactMoney.limit)
    XCTAssertEqual(CloseExactMoney.display("-101", currency: "AUD"), "AUD -1.01")
    XCTAssertNil(CloseExactMoney.total(["99999999999999", "1"]))
    XCTAssertNil(CloseExactMoney.total(["-99999999999999", "-1"]))
    XCTAssertEqual(CloseExactMoney.total(["-10001", "10000", "1"]), "0")
  }

  func testPayloadPreservesExactBindingsAndOmitsLocalUIIdentity() throws {
    var review = CloseReviewDecisions()
    review.transferPairs = [CloseTransferPair(transactionIds: ["T2", "T1"], reason: "Checked both bank records.")]
    review.salaryMatches = [CloseSalaryMatch(payslipRecordIds: ["P1"], transactionIds: ["T4", "T3"],
      reason: "This pay was split across two deposits.", allowTiming: true)]
    review.decisions["uncategorised:T5"] = CloseIssueDecision(reason: "This category remains under review.",
      recordIds: ["T5"], evidenceKey: "exact source facts")
    let data = try JSONSerialization.data(withJSONObject: review.payload, options: [.sortedKeys])
    let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    let transfer = try XCTUnwrap((payload["transferPairs"] as? [[String: Any]])?.first)
    XCTAssertEqual(transfer["transactionIds"] as? [String], ["T1", "T2"])
    XCTAssertNil(transfer["id"])
    let salary = try XCTUnwrap((payload["salaryMatches"] as? [[String: Any]])?.first)
    XCTAssertEqual(salary["allowTiming"] as? Bool, true)
    XCTAssertEqual(salary["transactionIds"] as? [String], ["T3", "T4"])
    XCTAssertNil(salary["id"])
    let decisions = try XCTUnwrap(payload["decisions"] as? [String: [String: Any]])
    XCTAssertEqual(decisions["uncategorised:T5"]?["action"] as? String, "acknowledge")
    XCTAssertEqual(decisions["uncategorised:T5"]?["evidenceKey"] as? String, "exact source facts")
    let restored = try JSONDecoder().decode(CloseReviewDecisions.self, from: JSONEncoder().encode(review))
    XCTAssertEqual(restored, review)
    XCTAssertEqual(try JSONDecoder().decode(CloseReviewDecisions.self, from: Data("{}".utf8)), CloseReviewDecisions())
  }

  func testChangedReviewFactsInvalidateRecordedDecision() {
    let decision = CloseIssueDecision(reason: "Checked this exact original.", recordIds: ["T1"], evidenceKey: "old-facts")
    let unchanged = SourceImportIssue(id: "issue", code: "uncategorised", severity: "review", message: "Review", recordIds: ["T1"], evidenceKey: "old-facts")
    let changed = SourceImportIssue(id: "issue", code: "uncategorised", severity: "review", message: "Review", recordIds: ["T1"], evidenceKey: "new-facts")
    let differentRecord = SourceImportIssue(id: "issue", code: "uncategorised", severity: "review", message: "Review", recordIds: ["T2"], evidenceKey: "old-facts")
    XCTAssertTrue(decision.stillMatches(unchanged))
    XCTAssertFalse(decision.stillMatches(changed))
    XCTAssertFalse(decision.stillMatches(differentRecord))
  }

  func testLedgerChoicesRetainSignedCentsAndExcludeUnpostedRows() throws {
    var baseline = fixture()
    var rows = try XCTUnwrap(baseline["transactions"] as? [[String: Any]])
    var pending = rows[0]; pending["id"] = "pending"; pending["status"] = "pending"
    rows.append(pending); baseline["transactions"] = rows
    let choices = try CloseLedgerChoice.decode(baseline: baseline)
    XCTAssertEqual(choices.count, 2)
    XCTAssertEqual(choices.first { $0.id == "T1" }?.displayAmount, "AUD -100.01")
    XCTAssertEqual(choices.first { $0.id == "T2" }?.accountName, "Savings")
    rows[0]["amountMinor"] = String(Int64.min); baseline["transactions"] = rows
    XCTAssertThrowsError(try CloseLedgerChoice.decode(baseline: baseline))
    rows[0]["amountMinor"] = "-10001"; rows[0]["accountId"] = "UNKNOWN"; baseline["transactions"] = rows
    XCTAssertThrowsError(try CloseLedgerChoice.decode(baseline: baseline))
  }

  func testLegacyPayslipUsesAcceptedProposalIDOnlyForMatchingExactRawFacts() throws {
    let baseline = fixture()
    let fields = try XCTUnwrap((baseline["payslips"] as? [[String: Any]])?.first?["fields"] as? [String: Any])
    let receipt: [String: Any] = ["receiptVerified": true, "records": [["kind": "payslip", "recordId": "source-pay", "fields": fields]]]
    let choice = try XCTUnwrap(ClosePayslipChoice.decode(baseline: baseline, evidence: [receipt]).first)
    XCTAssertEqual(choice.id, "source-pay")
    XCTAssertTrue(choice.hasAcceptedEvidence)
    XCTAssertEqual(choice.displayAmount, "AUD 800.00")
    var changed = fields; changed["netMinor"] = "80001"
    let altered: [String: Any] = ["receiptVerified": true, "records": [["kind": "payslip", "recordId": "source-pay", "fields": changed]]]
    let unmatched = try XCTUnwrap(ClosePayslipChoice.decode(baseline: baseline, evidence: [altered]).first)
    XCTAssertFalse(unmatched.hasAcceptedEvidence)
    XCTAssertNotEqual(unmatched.id, "source-pay")
    let unverified: [String: Any] = ["receiptVerified": false, "records": [["kind": "payslip", "recordId": "source-pay", "fields": fields]]]
    XCTAssertFalse(try XCTUnwrap(ClosePayslipChoice.decode(baseline: baseline, evidence: [unverified]).first).hasAcceptedEvidence)
  }

  func testDuplicateRawPayslipIdentityCannotBecomeTwoSelectableEvidenceChoices() throws {
    var baseline = fixture()
    let rows = try XCTUnwrap(baseline["payslips"] as? [[String: Any]])
    baseline["payslips"] = rows + rows
    XCTAssertThrowsError(try ClosePayslipChoice.decode(baseline: baseline))
  }

  private func fixture() -> [String: Any] {
    ["currency": "AUD", "accounts": [
      ["id": "A", "name": "Everyday", "currency": "AUD"],
      ["id": "B", "name": "Savings", "currency": "AUD"],
    ], "transactions": [
      ["id": "T1", "date": "2027-02-10", "accountId": "A", "amountMinor": "-10001", "categoryId": "TRANSFER", "person": "Joint", "status": "posted"],
      ["id": "T2", "date": "2027-02-10", "accountId": "B", "amountMinor": "10001", "categoryId": "TRANSFER", "person": "Joint", "status": "settled"],
    ], "payslips": [["kind": "payslip", "recordId": "", "fields": [
      "payDate": "2027-02-10", "person": "Alex", "employer": "Example", "currency": "AUD",
      "valueBasis": "current-period", "grossMinor": "100000", "taxMinor": "20000", "superMinor": "12000", "netMinor": "80000",
    ]]]]
  }
}
