import Foundation
import XCTest
@testable import Kitty

@MainActor
final class GoogleSheetSelectionTests: XCTestCase {
    private let selected = GoogleConnection.Selection(permissionID: "fixture-user", sheetID: "fictional_existing_sheet_000001", sessionID: UUID())
    private final class Transport: GoogleHTTPTransport {
        var requests: [URLRequest] = []
        var answers: [[String: Any]] = []
        var afterRead: (() -> Void)?
        func send(_ request: URLRequest, maximumBytes: Int) async throws -> GoogleHTTPResponse {
            XCTAssertEqual(request.httpMethod, "GET")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer fictional-test-token")
            XCTAssertLessThanOrEqual(maximumBytes, 512 * 1024)
            requests.append(request)
            guard !answers.isEmpty else { throw GoogleSheetSelection.Failure.unavailable }
            let answer = answers.removeFirst()
            afterRead?()
            return GoogleHTTPResponse(statusCode: 200, data: try JSONSerialization.data(withJSONObject: answer))
        }
    }

    private func fixture() -> Transport {
        let t = Transport()
        t.answers = [
            ["id": selected.sheetID, "name": "Digital Davies test", "mimeType": "application/vnd.google-apps.spreadsheet",
             "trashed": false, "capabilities": ["canEdit": false]],
            ["spreadsheetId": selected.sheetID, "properties":["timeZone":"Australia/Melbourne"], "sheets": ["Kitty", "Accounts", "Entries", "Decisions", "Categories"].map { ["properties": ["title": $0]] }],
            ["range": "Kitty!A1:B1000", "values": [["key","value"],["sheet_version",2]]]
        ]
        return t
    }

    func testExistingViewerSelectionIsVerifiedWithoutUpgradingAccess() async throws {
        let t = fixture()
        let probe = GoogleSheetSelection(http: t, current: { self.selected }, token: { _ in "fictional-test-token" })
        let result = try await probe.verify(selected)
        XCTAssertEqual(result.selection, selected)
        XCTAssertFalse(result.canEdit)
        XCTAssertEqual(result.title, "Digital Davies test")
        XCTAssertEqual(t.requests.map { $0.url?.host }, ["www.googleapis.com", "sheets.googleapis.com", "sheets.googleapis.com"])
        XCTAssertTrue(t.requests.allSatisfy { $0.url!.path.contains(selected.sheetID) })
        XCTAssertNil(result.summary["token"])
    }

    func testWrongFileOrAmbiguousVersionNeverAttestsSelection() async throws {
        for broken in 0..<5 {
            let t = fixture()
            switch broken {
            case 0: t.answers[0]["id"] = "another_sheet"
            case 1: t.answers[1]["spreadsheetId"] = "another_sheet"
            case 2: t.answers[1]["sheets"] = [["properties": ["title":"Kitty"]]]
            case 3: t.answers[2]["values"] = [["sheet_version",1], ["sheet_version",2]]
            default: t.answers[2]["range"] = "Private!A1:B1000"
            }
            let probe = GoogleSheetSelection(http: t, current: { self.selected }, token: { _ in "fictional-test-token" })
            do { _ = try await probe.verify(selected); XCTFail("Incorrect Sheet or version was accepted") }
            catch is GoogleSheetSelection.Failure { }
        }
    }

    func testOldResponseAfterAccountSwitchCannotOpenHousehold() async throws {
        let t = fixture()
        var active: GoogleConnection.Selection? = selected
        t.afterRead = { active = nil }
        let probe = GoogleSheetSelection(http: t, current: { active }, token: { _ in "fictional-test-token" })
        do { _ = try await probe.verify(selected); XCTFail("Stale connection was published") }
        catch GoogleSheetSelection.Failure.changed { }
        XCTAssertEqual(t.requests.count, 1)
    }
}
