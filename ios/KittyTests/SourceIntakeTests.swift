import PDFKit
import XCTest

@testable import Kitty

final class SourceIntakeTests: XCTestCase {
  private var context: SourceReviewContext {
    SourceReviewContext(schemaVersion: 1, currency: "AUD", people: ["Jordan", "Mia", "Joint"],
      accounts: [.init(id: "ACC-EVD", name: "Everyday", kind: "Transaction", currency: "AUD", ledger: true),
        .init(id: "CARD", name: "Card", kind: "Credit card", currency: "AUD", ledger: true)],
      items: [.init(id: "LN-HOME", name: "Home loan", kind: "Loan", currency: "AUD", ledger: false)])
  }
  private func fixture(_ name: String) throws -> SourceDocument {
    let url = try XCTUnwrap(Bundle.main.url(forResource: name, withExtension: "pdf"))
    return SourceDocument(name: name + ".pdf", mimeType: "application/pdf", bytes: try Data(contentsOf: url))
  }
  private func document(_ text: String) -> SourceDocument {
    var result = SourceDocument(name: "synthetic.pdf", mimeType: "application/pdf", bytes: Data("synthetic original".utf8))
    result.pageCount = 1
    result.state = .extracted
    result.pages = [.init(number: 1, width: 595, height: 842, rotation: 0, method: .pdfText, text: text,
      observations: text.components(separatedBy: "\n").enumerated().map { .init(id: "line-\($0.offset)", text: $0.element, bbox: nil, confidence: nil) })]
    return result
  }
  func testExactMoneyAndDatesRejectRoundingAndAmbiguity() throws {
    XCTAssertEqual(try SourceMoney.minor("$1,234.29"), 123429)
    XCTAssertEqual(try SourceMoney.minor("(0.29)"), -29)
    for invalid in ["1.001", "1e3", "1,23.00", "-+4", "NaN", "1000000000000.00"] { XCTAssertThrowsError(try SourceMoney.minor(invalid), invalid) }
    XCTAssertFalse(SourceMoney.isDate("2027-02-29"))
    XCTAssertFalse(SourceMoney.isDate("02/03/2027"))
    XCTAssertTrue(SourceMoney.isDate("2028-02-29"))
  }
  func testTextPDFRetainsBytesAndSuggestsKnownStatementValuesWithoutApproval() async throws {
    let original = try fixture("source-statement-text")
    let extracted = await SourceDocumentCapture.extract(original)
    XCTAssertEqual(extracted.bytes, original.bytes)
    XCTAssertEqual(extracted.id, original.id)
    XCTAssertEqual(extracted.pages.first?.method, .pdfText)
    let draft = SourceReviewDraft.suggested(document: extracted, kind: .statementBalance, context: context)
    XCTAssertEqual(draft.input("openingMinor"), "5335.17")
    XCTAssertEqual(draft.input("closingMinor"), "5971.06")
    XCTAssertEqual(draft.input("periodEnd"), "2027-01-31")
    XCTAssertTrue(draft.confirmations.isEmpty)
    XCTAssertFalse(draft.problems(context: context, document: extracted).isEmpty)
  }
  func testScannedPDFUsesOCRAndRetainsAnUnapprovedOriginal() async throws {
    let original = try fixture("source-statement-scanned")
    XCTAssertTrue(PDFDocument(data: original.bytes)?.string?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true)
    let extracted = await SourceDocumentCapture.extract(original)
    XCTAssertEqual(extracted.bytes, original.bytes)
    XCTAssertTrue(extracted.isIntact)
    XCTAssertEqual(extracted.pages.first?.method, .visionOCR)
    XCTAssertFalse(extracted.pages.first?.observations.isEmpty ?? true)
    let draft = SourceReviewDraft.suggested(document: extracted, kind: .statementBalance, context: context)
    XCTAssertTrue(draft.confirmations.isEmpty)
    XCTAssertFalse(draft.problems(context: context, document: extracted).isEmpty)
  }
  func testYTDDecoysNeverBecomeCurrentPayAndPersonAliasNeedsReview() async throws {
    let extracted = await SourceDocumentCapture.extract(try fixture("source-payslip-ytd"))
    let draft = SourceReviewDraft.suggested(document: extracted, kind: .payslip, context: context)
    XCTAssertEqual(draft.input("grossMinor"), "5250.00")
    XCTAssertEqual(draft.input("taxMinor"), "1250.00")
    XCTAssertEqual(draft.input("netMinor"), "4000.00")
    XCTAssertEqual(draft.input("employer"), "Northwind Logistics", "Employer super is an amount, not another employer name.")
    XCTAssertEqual(draft.input("person"), "", "Jordan Davies must be explicitly mapped to the Sheet's Jordan.")
    XCTAssertTrue(draft.messages.contains { $0.contains("Year-to-date") })
    XCTAssertTrue(draft.confirmations.isEmpty)
  }
  func testLoanValueIsNegativeAndIgnoresLimitAndRepaymentDecoys() async throws {
    let extracted = await SourceDocumentCapture.extract(try fixture("source-valuation-loan"))
    let draft = SourceReviewDraft.suggested(document: extracted, kind: .valuation, context: context)
    XCTAssertEqual(draft.input("valueMinor"), "591715.18")
    XCTAssertEqual(draft.input("valueKind"), "liability")
    XCTAssertEqual(try draft.fields()["valueMinor"], .string("-59171518"))
    XCTAssertFalse(draft.problems(context: context, document: extracted).isEmpty)
  }
  func testBrokenExtractionStillPersistsAndRestoresOriginalBytes() async throws {
    let original = SourceDocument(name: "broken.pdf", mimeType: "application/pdf", bytes: Data("%PDF-1.7\nbroken".utf8))
    let extracted = await SourceDocumentCapture.extract(original)
    XCTAssertEqual(extracted.state, .failed)
    let restored = try JSONDecoder().decode(SourceDocument.self, from: JSONEncoder().encode(extracted))
    XCTAssertEqual(restored.bytes, original.bytes)
    XCTAssertTrue(restored.isIntact)
    XCTAssertFalse(restored.messages.isEmpty)
  }
  func testConfirmationIsExactAndUnrelatedUnfinishedFieldDoesNotEraseIt() throws {
    let source = document("Employer: Northwind Logistics")
    var draft = SourceReviewDraft(documentID: source.id, kind: .payslip)
    draft.setInput("employer", "Northwind Logistics")
    draft.setInput("grossMinor", "unfinished")
    try draft.confirm("employer", document: source, page: 1)
    XCTAssertTrue(draft.isConfirmed("employer"))
    draft.setInput("employer", "Different employer")
    XCTAssertFalse(draft.isConfirmed("employer"))
    XCTAssertTrue(draft.confirmations.isEmpty)
  }
  func testYTDSourceReferenceCannotConfirmCurrentPay() throws {
    let source = document("Gross pay YTD: $31,500.00")
    var draft = SourceReviewDraft(documentID: source.id, kind: .payslip)
    draft.setInput("grossMinor", "31500.00")
    draft.selectEvidence(field: "grossMinor", document: source, page: 1, observation: source.pages[0].observations[0])
    XCTAssertThrowsError(try draft.confirm("grossMinor", document: source, page: 1))
    XCTAssertFalse(draft.isConfirmed("grossMinor"))
  }
  func testConflictingValuesAndUnsignedCardBalanceRemainUnresolved() throws {
    let source = document("Account ID: CARD\nOpening balance: $50.00\nClosing balance: $10.00\nClosing balance: $20.00")
    let draft = SourceReviewDraft.suggested(document: source, kind: .statementBalance, context: context)
    XCTAssertEqual(draft.input("closingMinor"), "")
    XCTAssertEqual(draft.balancePolarity["openingMinor"], "")
    XCTAssertTrue(draft.confirmations.isEmpty)
  }
  func testTypedRecordHasExactTopLevelConfirmationsAndNoClaimOfOCRAccuracy() throws {
    let source = document("Item ID: LN-HOME\nCurrency: AUD\nValuation date: 2027-01-31\nValue kind: liability\nSource method: statement\nObserved value (amount owing): $591,715.18")
    var draft = SourceReviewDraft.suggested(document: source, kind: .valuation, context: context)
    for spec in draft.specifications { try draft.confirm(spec.id, document: source, page: 1) }
    let payload = try draft.recordPayload(document: source, context: context)
    XCTAssertEqual(payload["kind"] as? String, "valuation")
    let fields = try XCTUnwrap(payload["fields"] as? [String: Any])
    XCTAssertEqual(fields["valueMinor"] as? String, "-59171518")
    let confirmations = try XCTUnwrap(payload["confirmedFields"] as? [String: [String: Any]])
    XCTAssertEqual(confirmations["valueMinor"]?["value"] as? String, "-59171518")
    XCTAssertNil(payload["review"])
    XCTAssertNil(payload["verified"])
    let restored = try JSONDecoder().decode(SourceReviewDraft.self, from: JSONEncoder().encode(draft))
    XCTAssertTrue(restored.isConfirmed("valueMinor"))
  }
  func testWrongCurrencyAndLedgerValuationAreBlocked() throws {
    let source = document("Item ID: LN-HOME\nCurrency: AUD\nValuation date: 2027-01-31\nValue kind: liability\nSource method: statement\nObserved value: $591,715.18")
    let draft = SourceReviewDraft.suggested(document: source, kind: .valuation, context: context)
    var changed = context
    changed.schemaVersion = 2
    changed.items = [.init(id: "LN-HOME", name: "Wrong destination", currency: "USD", ledger: true)]
    let issues = draft.problems(context: changed, document: source)
    XCTAssertTrue(issues.contains { $0.contains("currency does not match") })
    XCTAssertTrue(issues.contains { $0.contains("ledger account") })
  }
  func testCSVEnvelopeRetainsExactUTF8BOMAndRejectsInvalidBytes() throws {
    let bytes = Data("\u{FEFF}Date,Item ID,Value\r\n2027-01-31,LN-HOME,-591715.18\r\n".utf8)
    let source = SourceDocument(name: "values.csv", mimeType: "text/csv", bytes: bytes)
    let payload = try source.payload()
    XCTAssertEqual(Data(try XCTUnwrap(payload["text"] as? String).utf8), bytes)
    XCTAssertEqual(payload["sha256"] as? String, SourceDocument.sha256(bytes))
    XCTAssertNil(payload["bytesBase64"])
    let invalid = SourceDocument(name: "invalid.csv", mimeType: "text/csv", bytes: Data([0xff, 0xfe, 0x41]))
    XCTAssertThrowsError(try invalid.payload())
    XCTAssertNotNil(try fixture("source-payslip-ytd").payload()["bytesBase64"])
  }
  @MainActor func testKnownPayslipCSVPreservesRepeatedRowsAndExactQuotedSource() throws {
    let header = "Pay date,Person,Employer,Gross pay,Tax withheld,Super (employer),Net pay"
    let row = "2027-02-01,Jordan,\"Northwind, \"\"Logistics\"\"\",1000.00,200.00,120.00,800.00"
    let source = SourceDocument(name: "payslips.csv", mimeType: "text/csv", bytes: Data(("\u{FEFF}" + header + "\r\n" + row + "\r\n" + row + "\r\n").utf8))
    let drafts = try SourceReviewDraft.suggestedCSV(document: source, context: context, engine: EngineBridge())
    XCTAssertEqual(drafts.count, 2)
    XCTAssertEqual(drafts[0].input("employer"), "Northwind, \"Logistics\"")
    XCTAssertEqual(drafts[0].evidence["employer"]?.quote, row)
    XCTAssertEqual(drafts.map { $0.evidence["grossMinor"]?.line }, [2, 3])
    XCTAssertTrue(drafts.allSatisfy { $0.confirmations.isEmpty })
    var ids: [String] = []
    for var draft in drafts {
      for spec in draft.specifications where !draft.input(spec.id).isEmpty { try draft.confirm(spec.id, document: source, page: 1) }
      let payload = try draft.recordPayload(document: source, context: context)
      ids.append(try XCTUnwrap(payload["recordId"] as? String))
      XCTAssertEqual((payload["extraction"] as? [String: String])?["method"], "csv")
      XCTAssertTrue(draft.problems(context: context, document: source).isEmpty)
    }
    XCTAssertEqual(Set(ids).count, 2, "Identical legitimate source rows retain their separate line identities.")
  }
  @MainActor func testValuationCSVRetainsNegativeLoanAndRequiresMethod() throws {
    let source = SourceDocument(name: "values.csv", mimeType: "text/csv", bytes: Data("Date,Item ID,Value\n2027-01-31,LN-HOME,-591715.18\n".utf8))
    let drafts = try SourceReviewDraft.suggestedCSV(document: source, context: context, engine: EngineBridge())
    let draft = try XCTUnwrap(drafts.first)
    XCTAssertEqual(draft.kind, .valuation)
    XCTAssertEqual(draft.input("valueKind"), "liability")
    XCTAssertEqual(try draft.fields()["valueMinor"], .string("-59171518"))
    XCTAssertEqual(draft.input("sourceMethod"), "")
    XCTAssertFalse(draft.problems(context: context, document: source).isEmpty)
    XCTAssertTrue(draft.confirmations.isEmpty)
  }
  @MainActor func testKnownCSVHandlesMultilineLiteralAndDoesNotMisrouteTransactions() throws {
    let sourceText = "Pay date,Person,Employer,Gross pay,Tax withheld,Super (employer),Net pay\r\n2027-02-01,Jordan,\"Northwind\r\nLogistics\",1000,200,120,800\r\n"
    let source = SourceDocument(name: "payslips.csv", mimeType: "text/csv", bytes: Data(sourceText.utf8))
    let engine = try EngineBridge()
    let draft = try XCTUnwrap(SourceReviewDraft.suggestedCSV(document: source, context: context, engine: engine).first)
    let quote = try XCTUnwrap(draft.evidence["employer"]?.quote)
    XCTAssertTrue(sourceText.contains(quote))
    XCTAssertTrue(quote.contains("Northwind\r\nLogistics"))
    XCTAssertEqual(draft.evidence["employer"]?.line, 2)
    let transactions = SourceDocument(name: "bank.csv", mimeType: "text/csv", bytes: Data("Date,Description,Amount\n2027-01-31,Coffee,-5.00\n".utf8))
    XCTAssertTrue(try SourceReviewDraft.suggestedCSV(document: transactions, context: context, engine: engine).isEmpty)
    let malformed = SourceDocument(name: "payslips.csv", mimeType: "text/csv", bytes: Data("Pay date,Person,Employer,Gross pay,Tax withheld,Super (employer),Net pay\n2027-02-01,Jordan,Missing\n".utf8))
    XCTAssertThrowsError(try SourceReviewDraft.suggestedCSV(document: malformed, context: context, engine: engine))
  }
}
