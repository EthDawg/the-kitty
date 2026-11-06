import Foundation
import XCTest
@testable import Kitty

@MainActor
final class PracticeCopyTests: XCTestCase {
    private final class Drive: GoogleHTTPTransport {
        var copy: [String:Any]?
        var copies = 0
        var id = "private-fictional-practice-id"
        var loseCopyResponse = true
        func send(_ request: URLRequest, maximumBytes: Int) async throws -> GoogleHTTPResponse {
            let path = try XCTUnwrap(request.url?.path)
            if path.hasSuffix("/copy") {
                copies += 1
                XCTAssertTrue(path.contains(GoogleSheetSelection.demoFileID))
                let body = try XCTUnwrap(JSONSerialization.jsonObject(with:try XCTUnwrap(request.httpBody)) as? [String:Any])
                XCTAssertEqual(body["parents"] as? [String], ["root"])
                copy = ["id":id, "mimeType":"application/vnd.google-apps.spreadsheet",
                        "name":body["name"]!, "appProperties":body["appProperties"]!, "ownedByMe":true,"trashed":false,
                        "capabilities":["canEdit":true],"permissions":[["type":"user","role":"owner","id":"practice-owner"]]]
                if loseCopyResponse { throw URLError(.networkConnectionLost) }
                return GoogleHTTPResponse(statusCode:200,data:try JSONSerialization.data(withJSONObject:try XCTUnwrap(copy)))
            }
            XCTAssertEqual(path,"/drive/v3/files")
            let result: [String:Any] = ["files":copy.map { [$0] } ?? [],"incompleteSearch":false]
            return GoogleHTTPResponse(statusCode:200,data:try JSONSerialization.data(withJSONObject:result))
        }
    }
    func testTwoEmptySearchesOfferDistinctNamedCopiesAndRequireTheirOwnChoice() async throws {
        let a = Drive(), b = Drive()
        a.loseCopyResponse = false; b.loseCopyResponse = false; b.id = "another-private-practice-id"
        let source = GoogleConnection.Selection(permissionID:"practice-owner",sheetID:GoogleSheetSelection.demoFileID,sessionID:UUID())
        func offer(_ drive: Drive) async throws -> GooglePracticeSheet.Choice {
            let defaults = try XCTUnwrap(UserDefaults(suiteName:"practice-choice-test-" + UUID().uuidString))
            let api = GoogleSheetTools(http:drive,selected:source,current:{source},token:{_ in "fictional"})
            return GooglePracticeSheet.Choice(try await GooglePracticeSheet(api:api,preferences:defaults).findOrCreate())
        }
        // Both devices saw empty Drive search results before either new copy became visible.
        let first = try await offer(a), second = try await offer(b)
        XCTAssertNotEqual(first.offer["title"],second.offer["title"])
        XCTAssertThrowsError(try first.selected(by:nil,source:source))
        XCTAssertThrowsError(try second.selected(by:first.offer["ticket"],source:source))
        XCTAssertThrowsError(try first.selected(by:first.offer["ticket"],source:nil))
        XCTAssertEqual(try first.selected(by:first.offer["ticket"],source:source).id,a.id)
        XCTAssertEqual(try second.selected(by:second.offer["ticket"],source:source).id,b.id)
    }
    func testLostResponseFindsSamePrivateCopyAndNeverReissuesCopy() async throws {
        let store = try XCTUnwrap(UserDefaults(suiteName:"kitty-practice-test-" + UUID().uuidString))
        let demo = GoogleConnection.Selection(permissionID:"practice-owner",sheetID:GoogleSheetSelection.demoFileID,sessionID:UUID())
        let drive = Drive()
        let api = GoogleSheetTools(http:drive,selected:demo,current:{demo},token:{_ in "fictional"})
        let helper = GooglePracticeSheet(api:api,preferences:store)
        do { _ = try await helper.findOrCreate(); XCTFail("Expected the lost copy response") } catch is URLError {}
        let copy = try await helper.findOrCreate()
        XCTAssertEqual(copy.id,"private-fictional-practice-id"); XCTAssertEqual(copy.source,demo)
        XCTAssertEqual(drive.copies,1)
        drive.copy?["permissions"] = [["type":"anyone","role":"reader"],["type":"user","role":"owner","id":"practice-owner"]]
        do { _ = try await helper.findOrCreate(); XCTFail("Expected broad sharing to block the practice copy") }
        catch let e as GoogleSheetTools.Failure { XCTAssertEqual(e.code,"copy_unverified") }
        XCTAssertEqual(drive.copies,1)
    }
}
