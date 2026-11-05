import Foundation
import XCTest
@testable import Kitty

@MainActor
final class GoogleCategoryWriterTests: XCTestCase {
    private final class Sheet: GoogleHTTPTransport {
        var entries = [["Entry ID","Kind","Settled at","Account ID","Raw text","Description","Amount","Category ID"],
                       ["T01","transaction","2026-09-03","A1","FICTIONAL SHOP","Shop","-12","UNCAT"]]
        var audit = [["Decision ID","Ref kind","Ref ID","Decision","Value","By","At","Note"]]
        var dateValue: Any = "", brokenHelpers = false, wrongDateType = false
        var guards = [Int:[String:Any]](), attempts = [(Int,[String:Any],[String])]()
        var puts = 0, posts = 0, losePut = false, acceptPut = true, losePost = false, acceptPost = true
        @discardableResult func deliver(_ attempt: Int) -> Bool {
            let (id,metadata,row) = attempts[attempt]
            guard guards[id] == nil else { return false } // Google rejects the entire batch for a duplicate metadata ID.
            guards[id] = metadata; audit.append(Array(row.dropLast())); return true
        }
        func send(_ request: URLRequest, maximumBytes: Int) async throws -> GoogleHTTPResponse {
            let url = try XCTUnwrap(request.url), path = url.path.components(separatedBy:"/values/").last!
            let query = URLComponents(url:url,resolvingAgainstBaseURL:false)?.queryItems ?? []
            var result = [String:Any]()
            if request.httpMethod == "PUT" || request.httpMethod == "POST" {
                let body = try XCTUnwrap(try JSONSerialization.jsonObject(with:try XCTUnwrap(request.httpBody)) as? [String:Any])
                if path.hasSuffix("/developerMetadata:search") {
                    result = ["matchedDeveloperMetadata":guards.values.map { ["developerMetadata":$0] }]
                } else if request.httpMethod == "PUT" {
                    XCTAssertTrue(query.contains(URLQueryItem(name:"valueInputOption",value:"RAW")))
                    let values = try XCTUnwrap(body["values"] as? [[String]])
                    XCTAssertEqual(path,"Entries!H2"); puts += 1; if acceptPut { entries[1][7] = values[0][0] }
                    if losePut { throw URLError(.networkConnectionLost) }
                } else {
                    XCTAssertTrue(path.hasSuffix(":batchUpdate")); posts += 1
                    let requests = try XCTUnwrap(body["requests"] as? [[String:[String:Any]]])
                    let slot = ["sheetId":304,"startRowIndex":1,"endRowIndex":2,"startColumnIndex":0,"endColumnIndex":8]
                    XCTAssertEqual(requests[0]["insertRange"]?["range"] as? [String:Int],slot)
                    XCTAssertEqual(requests[1]["updateCells"]?["range"] as? [String:Int],slot)
                    let contents = try XCTUnwrap(requests[1]["updateCells"]?["rows"] as? [[String:[[String:[String:Any]]]]])
                    let cells = try XCTUnwrap(contents.first?["values"])
                    XCTAssertNotNil(cells[6]["userEnteredValue"]?["numberValue"] as? Int)
                    XCTAssertEqual(requests[2]["repeatCell"]?["fields"] as? String,"userEnteredFormat.numberFormat")
                    dateValue = try XCTUnwrap(cells[6]["userEnteredValue"]?["numberValue"])
                    let values = cells.enumerated().map { n,c in n == 6 ? String(describing:dateValue) : (c["userEnteredValue"]?["stringValue"] as? String ?? "") }
                    let marker = try XCTUnwrap(requests[3]["createDeveloperMetadata"]?["developerMetadata"] as? [String:Any])
                    let mid = try XCTUnwrap(marker["metadataId"] as? Int)
                    XCTAssertEqual(marker["visibility"] as? String,"PROJECT")
                    attempts.append((mid,marker,values))
                    if acceptPost { _ = deliver(attempts.count-1) }
                    if losePost { throw URLError(.timedOut) }
                }
            } else if path == "Decisions!A2:J2" {
                var r: [Any] = audit[1].map { $0 }; while r.count < 8 { r.append("") }
                r[6] = wrongDateType ? String(describing:dateValue) : dateValue
                r += [!brokenHelpers,brokenHelpers ? "" : "T01|categorise"]
                result = ["range":path,"majorDimension":"ROWS","values":[r]]
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
    func testExplicitRecheckAfterAnUnobservedAppendAllowsProgressAndALateRequestCannotDuplicateIt() async throws {
        let (writer,dir,owner,api,sheet) = fixture(); defer { try? FileManager.default.removeItem(at:dir) }
        let intent = try await writer.prepare(owner,api:api,id:"T01",old:"UNCAT",category:"SHOPPING")
        let (cell,audit) = inputs(intent,owner.selection.sheetID)
        _ = try await writer.run("update_values",input:cell,owner:owner,api:api)
        sheet.losePost = true; sheet.acceptPost = false
        do { _ = try await writer.run("append_values",input:audit,owner:owner,api:api); XCTFail("Unknown append reported saved") }
        catch let failure as GoogleSheetTools.Failure { XCTAssertEqual(failure.code,"write_pending") }
        XCTAssertNotNil(try writer.pending(owner)); sheet.acceptPost = true
        _ = try await writer.run("append_values",input:audit,owner:owner,api:api)
        XCTAssertEqual(sheet.posts,2); XCTAssertEqual(sheet.attempts[0].0,sheet.attempts[1].0)
        XCTAssertFalse(sheet.deliver(0)); XCTAssertEqual(sheet.audit.count,2); XCTAssertNil(try writer.pending(owner))
    }
    func testCancelledBeforeDispatchClearsUnsentIntentAndDroppedPutRecovers() async throws {
        let (writer,dir,owner,api,sheet) = fixture(); defer { try? FileManager.default.removeItem(at:dir) }
        let intent = try await writer.prepare(owner,api:api,id:"T01",old:"UNCAT",category:"SHOPPING")
        let (cell,_) = inputs(intent,owner.selection.sheetID)
        var active: GoogleConnection.Selection? = owner.selection, tokens = 0
        let stopped = GoogleSheetTools(http:sheet,selected:owner.selection,current:{active},token:{ _ in
            tokens += 1; if tokens == 2 { active = nil }; return "fixture"
        })
        do { _ = try await writer.run("update_values",input:cell,owner:owner,api:stopped); XCTFail("Stale session wrote") } catch {}
        XCTAssertEqual(sheet.puts,0); XCTAssertNil(try writer.pending(owner))
        let second = try await writer.prepare(owner,api:api,id:"T01",old:"UNCAT",category:"SHOPPING")
        let (retry,_) = inputs(second,owner.selection.sheetID)
        sheet.acceptPut = false; sheet.losePut = true
        do { _ = try await writer.run("update_values",input:retry,owner:owner,api:api); XCTFail("Unobserved value reported as saved") } catch {}
        sheet.acceptPut = true
        _ = try await writer.run("update_values",input:retry,owner:owner,api:api)
        XCTAssertEqual(sheet.entries[1][7],"SHOPPING"); XCTAssertEqual(sheet.puts,2)
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
        XCTAssertNil(try writer.pending(owner))
    }
    func testNumericDateAndSheetCalculatedHelpersAreRequiredBeforeClearingAnIntent() async throws {
        let (writer,dir,owner,api,sheet) = fixture(); defer { try? FileManager.default.removeItem(at:dir) }
        XCTAssertEqual(GoogleSheetDay.serial("2026-11-05"),46331)
        XCTAssertNil(GoogleSheetDay.serial("2026-02-30"))
        let instant = try XCTUnwrap(ISO8601DateFormatter().date(from:"2026-11-04T16:30:00Z"))
        XCTAssertEqual(GoogleSheetDay.name(at:instant,zone:try XCTUnwrap(TimeZone(identifier:"Australia/Melbourne"))),"2026-11-05")
        let intent = try await writer.prepare(owner,api:api,id:"T01",old:"UNCAT",category:"SHOPPING")
        let (cell,audit) = inputs(intent,owner.selection.sheetID)
        _ = try await writer.run("update_values",input:cell,owner:owner,api:api)
        for broken in 0..<2 {
            sheet.wrongDateType = broken == 0; sheet.brokenHelpers = broken == 1
            do { _ = try await writer.run("append_values",input:audit,owner:owner,api:api); XCTFail("Unusable date or formula reported as saved") }
            catch let e as GoogleSheetTools.Failure { XCTAssertEqual(e.code,"write_pending") }
            XCTAssertNotNil(try writer.pending(owner))
        }
        sheet.brokenHelpers = false
        _ = try await writer.run("append_values",input:audit,owner:owner,api:api)
        XCTAssertEqual(sheet.posts,1); XCTAssertNil(try writer.pending(owner))
    }
}
