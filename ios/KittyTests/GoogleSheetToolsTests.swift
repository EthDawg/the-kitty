import Foundation
import XCTest
@testable import Kitty

@MainActor
final class GoogleSheetToolsTests: XCTestCase {
    private let selection = GoogleConnection.Selection(permissionID: "fictional", sheetID: "fictional_existing_sheet_000001", sessionID: UUID())
    private final class Transport: GoogleHTTPTransport {
        var calls = [URLRequest]()
        var response: [String: Any] = [:]
        var status = 200
        var duringRequest: (() -> Void)?
        func send(_ request: URLRequest, maximumBytes: Int) async throws -> GoogleHTTPResponse {
            calls.append(request); duringRequest?()
            XCTAssertEqual(request.url?.host, "sheets.googleapis.com")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer fixture")
            return GoogleHTTPResponse(statusCode: status, data: try JSONSerialization.data(withJSONObject: response))
        }
    }
    func testSparseRangePreservesRowsAndUsesFreshConnectorEnvelope() async throws {
        let net = Transport()
        let tools = GoogleSheetTools(http: net, selected: selection, current: { self.selection }, token: { _ in "fixture" })
        net.response = ["range": "'Cash Flow'!A1:T1000", "majorDimension": "ROWS", "values": [["month"], [], ["March"]]]
        let result = try await tools.call("get_values", input: ["spreadsheetId": selection.sheetID, "range": "'Cash Flow'!A1:T"])
        XCTAssertEqual((result["payload"] as? [String: Any])?["values"] as? [[String]], [["month"], [], ["March"]])
        XCTAssertNotNil((result["cache"] as? [String: Any])?["storedAt"])
        XCTAssertEqual(net.calls.first?.httpMethod, "GET")
        XCTAssertEqual(net.calls.first?.url?.path, "/v4/spreadsheets/" + selection.sheetID + "/values/'Cash Flow'!A1:T")
        net.response["range"] = "'Cash Flow'!A3:T1000"
        do { _ = try await tools.values("'Cash Flow'!A1:T"); XCTFail("A shifted response silently moved rows") } catch let e as GoogleSheetTools.Failure { XCTAssertEqual(e.code, "invalid_response") }
    }
    func testOtherFilesUnknownTabsColumnsAndUnplannedWritesNeverReachGoogle() async throws {
        let net = Transport()
        let tools = GoogleSheetTools(http: net, selected: selection, current: { self.selection }, token: { _ in "fixture" })
        for (tool, id, range) in [("get_values", "wrong", "Entries!A1:U"), ("get_values", selection.sheetID, "Other!A1:A2"),
                                  ("get_values", selection.sheetID, "Entries!A1:V"), ("get_values", selection.sheetID, "Entries!B3:A1"),
                                  ("get_values", selection.sheetID, "https://example.test"), ("update_values", selection.sheetID, "Entries!H3"),
                                  ("append_values", selection.sheetID, "Decisions!A1:H")] {
            do { _ = try await tools.call(tool, input: ["spreadsheetId": id, "range": range]); XCTFail("Unexpected permission") }
            catch is GoogleSheetTools.Failure {}
        }
        XCTAssertTrue(net.calls.isEmpty)
    }
    func testProviderDenialAndMidflightDisconnectAreNeverSuccessfulReads() async throws {
        let net = Transport(); var active: GoogleConnection.Selection? = selection
        let tools = GoogleSheetTools(http: net, selected: selection, current: { active }, token: { _ in "fixture" })
        for (status, code) in [(401,"needs_reauth"), (403,"not_granted"), (429,"rate_limited"), (503,"server_unavailable")] {
            net.status = status
            do { _ = try await tools.values("Entries!H3"); XCTFail("Provider error ignored") }
            catch let e as GoogleSheetTools.Failure { XCTAssertEqual(e.code, code) }
        }
        net.status = 200; net.duringRequest = { active = nil }
        do { _ = try await tools.values("Entries!H3"); XCTFail("A disconnected request was delivered") }
        catch let e as GoogleSheetTools.Failure { XCTAssertEqual(e.code, "stale_session") }
    }
}
