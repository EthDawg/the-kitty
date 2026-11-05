import Foundation
import XCTest
@testable import Kitty

@MainActor
final class GoogleCategoryWriterTests: XCTestCase {
    private final class Sheet: GoogleHTTPTransport {
        var entries = [["Entry ID","Kind","Settled at","Account ID","Raw text","Description","Amount","Category ID"],
                       ["T01","transaction","2026-09-03","A1","FICTIONAL SHOP","Shop","-12","UNCAT"]]
        var audit = [["Decision ID","Ref kind","Ref ID","Decision","Value","By","At","Note"]]
        var puts = 0, posts = 0, losePut = false, losePost = false, acceptPost = true
        func send(_ request: URLRequest, maximumBytes: Int) async throws -> GoogleHTTPResponse {
            let url = try XCTUnwrap(request.url), path = url.path.components(separatedBy:"/values/").last!
            let query = URLComponents(url:url,resolvingAgainstBaseURL:false)?.queryItems ?? []
            var result = [String:Any]()
            if request.httpMethod == "PUT" || request.httpMethod == "POST" {
                let body = try XCTUnwrap(try JSONSerialization.jsonObject(with:try XCTUnwrap(request.httpBody)) as? [String:Any])
                if request.httpMethod == "PUT" {
                    XCTAssertTrue(query.contains(URLQueryItem(name:"valueInputOption",value:"RAW")))
                    let values = try XCTUnwrap(body["values"] as? [[String]])
                    XCTAssertEqual(path,"Entries!H2"); puts += 1; entries[1][7] = values[0][0]
                    if losePut { throw URLError(.networkConnectionLost) }
                } else {
                    XCTAssertTrue(path.hasSuffix(":batchUpdate")); posts += 1
                    let requests = try XCTUnwrap(body["requests"] as? [[String:[String:Any]]])
                    let slot = ["sheetId":304,"startRowIndex":1,"endRowIndex":2,"startColumnIndex":0,"endColumnIndex":8]
                    XCTAssertEqual(requests[0]["insertRange"]?["range"] as? [String:Int],slot)
                    XCTAssertEqual(requests[1]["updateCells"]?["range"] as? [String:Int],slot)
                    let contents = try XCTUnwrap(requests[1]["updateCells"]?["rows"] as? [[String:[[String:[String:String]]]]])
                    let values = try XCTUnwrap(contents.first?["values"]?.compactMap { $0["userEnteredValue"]?["stringValue"] })
                    if acceptPost { audit.append(Array(values.dropLast())) } // Sheets trims empty trailing cells
                    if losePost { throw URLError(.timedOut) }
                }
            } else if !url.path.contains("/values/") {
                result = ["spreadsheetId":"fictional_existing_sheet_000001","sheets":[["properties":["sheetId":304,"title":"Decisions","gridProperties":["rowCount":1200]]]]]
            } else {
                let rows: [[String]], resolved: String
                switch path {
                case "Entries!A1:H": rows = entries; resolved = path + "100"
                case "Entries!A2:H2": rows = [entries[1]]; resolved = path
                case "Categories!A1:A": rows = [["Category ID"],["SHOPPING"],["UNCAT"]]; resolved = path + "100"
                case "Decisions!A1:H": rows = audit; resolved = path + "100"
                case "Decisions!A2:H2": rows = []; resolved = path
                default: throw URLError(.unsupportedURL)
                }
                result = ["range":resolved,"majorDimension":"ROWS","values":rows]
            }
            return .init(statusCode:200,data:try JSONSerialization.data(withJSONObject:result))
        }
    }
    private func fixture() -> (GoogleCategoryWriter,URL,GoogleSheetSelection.Verified,GoogleSheetTools,Sheet) {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let s = GoogleConnection.Selection(permissionID:"fake-user",sheetID:"fictional_existing_sheet_000001",sessionID:UUID())
        let owner = GoogleSheetSelection.Verified(selection:s,title:"Fictional",canEdit:true), net = Sheet()
        let api = GoogleSheetTools(http:net,selected:s,current:{s},token:{ _ in "fixture" })
        return (GoogleCategoryWriter(directory:dir),dir,owner,api,net)
    }
    private func inputs(_ i: GoogleCategoryWriter.Intent, _ id: String) -> ([String:Any],[String:Any]) {
        (["spreadsheetId":id,"range":i.cell,"values":[[i.category]]],["spreadsheetId":id,"range":i.table,"values":[i.decision]])
    }
    func testLostWriteRepliesAndAppRestartStillProduceExactlyOneDecision() async throws {
        let (writer,dir,owner,api,sheet) = fixture(); defer { try? FileManager.default.removeItem(at:dir) }
        let intent = try await writer.prepare(owner,api:api,id:"T01",old:"UNCAT",category:"SHOPPING")
        let (cell,audit) = inputs(intent,owner.selection.sheetID); sheet.losePut = true; sheet.losePost = true
        _ = try await writer.run("update_values",input:cell,owner:owner,api:api)
        let reopened = GoogleCategoryWriter(directory:dir)
        let recovered = try await reopened.prepare(owner,api:api,id:"T01",old:"SHOPPING",category:"SHOPPING")
        XCTAssertEqual(recovered.decision,intent.decision)
        _ = try await reopened.run("update_values",input:cell,owner:owner,api:api)
        _ = try await reopened.run("append_values",input:audit,owner:owner,api:api)
        XCTAssertEqual(sheet.puts,1); XCTAssertEqual(sheet.posts,1); XCTAssertEqual(sheet.audit.count,2)
        XCTAssertNil(try reopened.pending(owner))
        do { _ = try await reopened.prepare(owner,api:api,id:"T01",old:"SHOPPING",category:"SHOPPING"); XCTFail("Duplicate review accepted") } catch {}
    }
    func testUnobservedAppendRemainsPendingAndIsNeverDispatchedTwice() async throws {
        let (writer,dir,owner,api,sheet) = fixture(); defer { try? FileManager.default.removeItem(at:dir) }
        let intent = try await writer.prepare(owner,api:api,id:"T01",old:"UNCAT",category:"SHOPPING")
        let (cell,audit) = inputs(intent,owner.selection.sheetID)
        _ = try await writer.run("update_values",input:cell,owner:owner,api:api)
        sheet.losePost = true; sheet.acceptPost = false
        for _ in 0..<2 {
            do { _ = try await writer.run("append_values",input:audit,owner:owner,api:api); XCTFail("Unknown append reported saved") }
            catch let failure as GoogleSheetTools.Failure { XCTAssertEqual(failure.code,"write_pending") }
        }
        XCTAssertEqual(sheet.posts,1); XCTAssertNotNil(try writer.pending(owner))
    }
    func testMovedEntryWrongPayloadFormulaAndViewerCannotWrite() async throws {
        let (writer,dir,owner,api,sheet) = fixture(); defer { try? FileManager.default.removeItem(at:dir) }
        let viewer = GoogleSheetSelection.Verified(selection:owner.selection,title:"Fictional",canEdit:false)
        do { _ = try await writer.prepare(viewer,api:api,id:"T01",old:"UNCAT",category:"SHOPPING"); XCTFail("Viewer permitted") } catch {}
        sheet.entries[1][7] = "=something"
        do { _ = try await writer.prepare(owner,api:api,id:"T01",old:"=something",category:"SHOPPING"); XCTFail("Formula overwritten") } catch {}
        sheet.entries[1][7] = "UNCAT"
        let intent = try await writer.prepare(owner,api:api,id:"T01",old:"UNCAT",category:"SHOPPING")
        let (cell,audit) = inputs(intent,owner.selection.sheetID)
        do { _ = try await writer.run("update_values",input:audit,owner:owner,api:api); XCTFail("Widened range permitted") } catch {}
        sheet.entries[1][0] = "T02"
        do { _ = try await writer.run("update_values",input:cell,owner:owner,api:api); XCTFail("Different entry changed") } catch {}
        XCTAssertEqual(sheet.puts,0); XCTAssertEqual(sheet.posts,0)
    }
}
