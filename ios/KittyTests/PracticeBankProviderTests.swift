import XCTest
import CryptoKit
import CoreFoundation
@testable import Kitty

/// Independent provider reads surrounding the physical Files UI journey. Only the app-created and owner-private
/// fictional practice Sheet passes the gate. Reads use the app's normal existing OAuth session.
@MainActor
final class PracticeBankProviderTests: XCTestCase {
    typealias Object = [String: Any]
    private let sha = "7f88605db65da236d62866612a2c9f2e272bd11a649b1dc1cc5408930779140b"
    private let columns = ["Entry ID", "Kind", "Settled at", "Account ID", "Raw text", "Description", "Amount", "Category ID", "Person", "Receipt held", "Note", "Status", "Created at", "Transfer ID", "Transfer account", "Foreign amount", "Foreign currency", "Units", "Unit price", "Source"]
    private let newRows: [(String, String, Int, Double)] = [("T0926", "KITTY PRACTICE PAPER BOAT", 46416, -17.45), ("T0927", "KITTY PRACTICE KITE REFUND", 46417, 6.25)]
    private var run: String { ProcessInfo.processInfo.environment["KITTY_PRACTICE_RUN"] ?? "" }
    private var baseline: URL { FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("KittyPracticeAcceptance-" + run + ".json") }
    private enum Fail: Error { case optIn, wrongFixture, unexpectedResponse, differentLedger, archiveMismatch }
    private func requirePhysical() throws {
        #if targetEnvironment(simulator)
        throw XCTSkip("Read-only proof on the signed physical app.")
        #else
        guard ProcessInfo.processInfo.environment["KITTY_PRACTICE_ACCEPTANCE"] == "private-google", UUID(uuidString: run) != nil else { throw XCTSkip("Opt in to the private practice acceptance sequence.") }
        continueAfterFailure = false
        executionTimeAllowance = 180
        #endif
    }
    private func hash(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
    private func json(_ value: Any) throws -> Data { try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys,.withoutEscapingSlashes]) }
    private func obj(_ data: Data) throws -> Object {
        guard let o = try JSONSerialization.jsonObject(with: data) as? Object else { throw Fail.unexpectedResponse }; return o
    }
    private func number(_ value: Any?) -> Double? {
        guard let n = value as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() else { return nil }; return n.doubleValue
    }
    private func drive(_ api: GoogleSheetTools, path: String, query: [String: String]) async throws -> Data {
        try api.check()
        var url = URLComponents(); url.scheme = "https"; url.host = "www.googleapis.com"; url.path = "/drive/v3/" + path
        url.queryItems = query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
        var req = URLRequest(url: try XCTUnwrap(url.url)); req.httpMethod = "GET"
        req.setValue("Bearer " + (try await api.token(api.selected)), forHTTPHeaderField: "Authorization")
        try api.check()
        let reply = try await api.http.send(req, maximumBytes: 512_000)
        try api.check(); guard reply.statusCode == 200 else { throw Fail.unexpectedResponse }; return reply.data
    }
    private func privateFile(_ object: Object, _ owner: String) -> Bool {
        guard object["ownedByMe"] as? Bool == true, object["trashed"] as? Bool == false,
              let acl = object["permissions"] as? [Object], acl.count == 1 else { return false }
        return acl[0]["id"] as? String == owner && acl[0]["type"] as? String == "user" && acl[0]["role"] as? String == "owner" && acl[0]["deleted"] as? Bool != true
    }
    private var fields: String { "id,name,mimeType,trashed,ownedByMe,permissions(id,type,role,deleted),appProperties" }
    private func context() async throws -> (GoogleSheetTools, String, String) {
        let google = GoogleConnection(defaults: .standard)
        guard let selection = try await google.restore(), selection.sheetID != GoogleSheetSelection.demoFileID,
              GoogleConnection.validSheetID(selection.sheetID) else { throw Fail.wrongFixture }
        let api = GoogleSheetTools(http: GoogleHTTP(), selected: selection, current: { google.selection }, token: { try await google.accessToken(for: $0) })
        let file = try obj(await drive(api, path: "files/" + selection.sheetID, query: ["fields":fields]))
        guard privateFile(file, selection.permissionID), file["id"] as? String == selection.sheetID,
              file["mimeType"] as? String == "application/vnd.google-apps.spreadsheet",
              let properties = file["appProperties"] as? [String:String], properties["kittyPractice"] == "davies-v2",
              let operation = properties["kittyPracticeOperation"], UUID(uuidString: operation) != nil,
              let title = file["name"] as? String, title == "Davies practice · " + String(operation.prefix(8)) else { throw Fail.wrongFixture }
        let settings = try await api.values("Kitty!A1:B",render:"UNFORMATTED_VALUE")
        guard let values = settings["values"] as? [[Any]] else { throw Fail.wrongFixture }
        let feed = values.filter { ($0.first as? String)?.trimmingCharacters(in:.whitespacesAndNewlines) == "public_feed" }
        guard feed.count == 1, feed[0].count == 2, (feed[0][1] as? String)?.lowercased() == "no" else { throw Fail.wrongFixture }
        return (api, title, operation)
    }
    private func readLedger(_ api: GoogleSheetTools) async throws -> [[Any]] {
        let result = try await api.values("Entries!A1:T", render: "UNFORMATTED_VALUE")
        guard let rows = result["values"] as? [[Any]], let header = rows.first as? [String], header == columns,
              rows.dropFirst().allSatisfy({ $0.count >= 8 && $0.first is String }),
              Set(rows.compactMap { $0.first as? String }).count == rows.count else { throw Fail.differentLedger }
        return rows
    }
    private func assertDuplicate(_ rows: [[Any]]) throws {
        let matching = rows.dropFirst().filter { $0[3] as? String == "ACC-CC" && $0[4] as? String == "MYKI TOP UP" && number($0[2]) == 46389 && number($0[6]) == -60 }
        guard matching.count == 1, matching[0][0] as? String == "T0880" else { throw Fail.differentLedger }
    }
    private func receiptFiles(_ api: GoogleSheetTools) async throws -> [Object] {
        let scope = hash(try json([api.selected.sheetID, api.selected.permissionID, sha, "ACC-CC", "2027-01", "2027-01-31"]))
        let q = "trashed = false and 'me' in owners and appProperties has { key='kittyBankKind' and value='receipt' } and appProperties has { key='kittyBankScope' and value='" + scope + "' }"
        let result = try obj(await drive(api, path: "files", query: ["spaces":"drive","q":q,"pageSize":"2","fields":"incompleteSearch,nextPageToken,files(" + fields + ")"]))
        guard result["incompleteSearch"] as? Bool != true, result["nextPageToken"] == nil, let files = result["files"] as? [Object] else { throw Fail.unexpectedResponse }; return files
    }
    private func attachment(_ name: String, _ o: Object) throws {
        let proof = XCTAttachment(data: try json(o), uniformTypeIdentifier: "public.json"); proof.name = name; proof.lifetime = .keepAlways; add(proof)
    }
    func testCaptureUntouchedPracticeCopyBaseline() async throws {
        try requirePhysical()
        let (api,title,operation) = try await context(), rows = try await readLedger(api)
        try assertDuplicate(rows)
        // Verify the fresh practice fixture, avoiding any record in a household the app did not create for this exercise.
        guard rows.count == 1083, newRows.allSatisfy({ pair in !rows.contains { $0[0] as? String == pair.0 || $0[4] as? String == pair.1 } }),
              try await receiptFiles(api).isEmpty else { throw Fail.wrongFixture }
        let record: Object = ["run":run,"operation":operation,"sheetID":api.selected.sheetID,"owner":api.selected.permissionID,"title":title,
                              "rowCount":rows.count - 1,"ledgerSHA256":hash(try json(rows))]
        try json(record).write(to: baseline, options: [.atomic,.completeFileProtection])
        try attachment("Independent private practice preflight", ["run":run,"title":title,"privateOwnerOnly":true,"publicFeed":"no","entries":rows.count - 1,"originalEntry":"T0880","ledgerSHA256":record["ledgerSHA256"]!,"existingReceipts":0])
        print("KITTY_PRACTICE_TITLE=" + title)
    }
    func testReadAfterImportAndReplayFromSheetsAndDrive() async throws {
        try requirePhysical()
        let (api,title,operation) = try await context(), saved = try obj(Data(contentsOf: baseline))
        guard saved["run"] as? String == run, saved["operation"] as? String == operation, saved["sheetID"] as? String == api.selected.sheetID,
              saved["owner"] as? String == api.selected.permissionID, saved["title"] as? String == title,
              let oldCount = saved["rowCount"] as? Int, let oldHash = saved["ledgerSHA256"] as? String else { throw Fail.wrongFixture }
        let rows = try await readLedger(api)
        guard rows.count == oldCount + 3, hash(try json(Array(rows.prefix(oldCount + 1)))) == oldHash else { throw Fail.differentLedger }
        try assertDuplicate(rows)
        for (r, expected) in zip(rows.suffix(2),newRows) {
            guard r.count >= 20, r[0] as? String == expected.0, r[1] as? String == "transaction", number(r[2]) == Double(expected.2),
                  r[3] as? String == "ACC-CC", r[4] as? String == expected.1, number(r[6]) == expected.3,
                  r[11] as? String == "settled", number(r[12]) == Double(expected.2), r[19] as? String == "bank export" else { throw Fail.differentLedger }
        }
        let matches = try await receiptFiles(api)
        guard matches.count == 1, privateFile(matches[0],api.selected.permissionID), let receiptID = matches[0]["id"] as? String,
              GoogleConnection.validSheetID(receiptID), matches[0]["mimeType"] as? String == "application/json" else { throw Fail.archiveMismatch }
        let receipt = try obj(await drive(api, path: "files/" + receiptID, query: ["alt":"media"]))
        guard receipt["kind"] as? String == "verified", let binding = receipt["binding"] as? Object,
              binding["owner"] as? String == api.selected.permissionID, binding["sheetID"] as? String == api.selected.sheetID,
              binding["account"] as? String == "ACC-CC", binding["sourceSHA256"] as? String == sha, binding["rowCount"] as? Int == 2,
              binding["receiptID"] as? String == receiptID, binding["month"] as? String == "2027-01", binding["downloadDay"] as? String == "2027-01-31",
              let sourceID = binding["sourceID"] as? String, GoogleConnection.validSheetID(sourceID), let digest = binding["digest"] as? String,
              digest.range(of:"^[0-9a-f]{64}$",options:.regularExpression) != nil else { throw Fail.archiveMismatch }
        guard let receiptTags = matches[0]["appProperties"] as? [String:String], receiptTags["kittyBankTerminal"] == "verified",
              receiptTags["kittyBankDigest"] == digest, let manifestID = binding["manifestID"] as? String,
              let actionID = binding["actionID"] as? String, receiptTags["kittyBankIntent"] == manifestID,
              Set([sourceID,manifestID,actionID,receiptID]).count == 4 else { throw Fail.archiveMismatch }
        for (id, kind) in [(sourceID,"original"),(manifestID,"manifest"),(actionID,"action")] {
            guard GoogleConnection.validSheetID(id) else { throw Fail.archiveMismatch }
            let meta = try obj(await drive(api,path:"files/" + id,query:["fields":fields]))
            guard meta["id"] as? String == id, privateFile(meta,api.selected.permissionID),
                  meta["mimeType"] as? String == (kind == "original" ? "text/csv" : "application/json"),
                  let tags = meta["appProperties"] as? [String:String], tags["kittyBankKind"] == kind,
                  tags["kittyBankDigest"] == digest, tags["kittyBankScope"] == receiptTags["kittyBankScope"],
                  tags["kittyBankIntent"] == manifestID else { throw Fail.archiveMismatch }
            if kind != "original" {
                let body = try obj(await drive(api,path:"files/" + id,query:["alt":"media"]))
                guard let association = body["binding"] as? Object, try json(association) == json(binding),
                      body["kind"] as? String == (kind == "manifest" ? "reviewed" : "dispatch") else { throw Fail.archiveMismatch }
                if kind == "manifest" {
                    let filename = (ProcessInfo.processInfo.environment["KITTY_PRACTICE_FILE"] ?? "Kitty-2027-01-proof-" + run) + ".csv"
                    guard body["originalName"] as? String == filename,
                          let plan = body["plan"] as? Object, let writes = plan["writes"] as? [Object], writes.count == 1,
                          writes[0]["tab"] as? String == "Entries", writes[0]["op"] as? String == "append",
                          let values = writes[0]["values"] as? [[Any]], values.count == 2 else { throw Fail.archiveMismatch }
                    for (r, expected) in zip(values,newRows) {
                        guard r.count == 20, r[0] as? String == expected.0, r[3] as? String == "ACC-CC",
                              r[4] as? String == expected.1, number(r[6]) == expected.3 else { throw Fail.archiveMismatch }
                    }
                }
            }
        }
        let bytes = try await drive(api,path:"files/" + sourceID,query:["alt":"media"])
        guard bytes.count == 229, hash(bytes) == sha else { throw Fail.archiveMismatch }
        let search = try await api.request(path:"/developerMetadata:search",method:"POST",body:["dataFilters":[["developerMetadataLookup":["metadataKey":"kitty.period.bank.v1","metadataValue":digest,"visibility":"DOCUMENT"]]]])
        guard (search["matchedDeveloperMetadata"] as? [Object])?.count == 1 else { throw Fail.archiveMismatch }
        let gate = try await api.request(path:"/developerMetadata:search",method:"POST",body:["dataFilters":[["developerMetadataLookup":["metadataId":2017113179,"metadataKey":"kitty.period.bank.hold.v1","visibility":"DOCUMENT"]]]])
        guard gate["matchedDeveloperMetadata"] == nil || (gate["matchedDeveloperMetadata"] as? [Object])?.isEmpty == true else { throw Fail.archiveMismatch }
        try attachment("Independent provider read after Files replay", ["run":run, "privateOwnerOnly":true,"publicFeed":"no","originalEntries":oldCount,"allOriginalRowsIntact":true,
                       "newIDs":newRows.map(\.0),"signedAmounts":newRows.map(\.3),"account":"ACC-CC","existingDuplicate":"T0880","duplicateOccurrences":1,
                       "archivedBytes":bytes.count,"archivedSHA256":sha,"verifiedReceipts":1,"durableSheetMarkers":1,"sharedHoldReleased":true,"boundPrivateDriveFiles":4,"totalEntries":rows.count-1])
    }
}

#if targetEnvironment(simulator)
import WebKit

extension PracticeBankProviderTests {
    /// Only this simulator test replaces Google. The preceding UI phase must export and select the original in Apple's Files UI.
    private final class SimulatedSheet: GoogleHTTPTransport {
        var ids: [String]
        var cells = [[Object]](), marker: Object?, batchCount = 0
        let fileID: String, header: [String]
        init(_ fileID: String, _ ids: [String], _ header: [String]) { self.fileID = fileID; self.ids = ids; self.header = header }
        func send(_ request: URLRequest, maximumBytes: Int) async throws -> GoogleHTTPResponse {
            let url = try XCTUnwrap(request.url), path = url.path
            guard url.host == "sheets.googleapis.com", path.hasPrefix("/v4/spreadsheets/" + fileID) else { throw Fail.unexpectedResponse }
            let result: Object
            if path.hasSuffix(":batchUpdate") {
                guard marker == nil else { throw Fail.unexpectedResponse }
                let payload = try XCTUnwrap(try JSONSerialization.jsonObject(with: XCTUnwrap(request.httpBody)) as? Object)
                let requests = try XCTUnwrap(payload["requests"] as? [Object])
                let write = try XCTUnwrap(requests.compactMap { $0["updateCells"] as? Object }.first)
                let range = try XCTUnwrap(write["range"] as? [String:Int]); guard range["startRowIndex"] == ids.count, range["endColumnIndex"] == 20 else { throw Fail.differentLedger }
                let written = try XCTUnwrap(write["rows"] as? [Object]).map { try XCTUnwrap($0["values"] as? [Object]) }
                var typed = written
                for style in requests.compactMap({ $0["repeatCell"] as? Object }) {
                    let col = try XCTUnwrap((style["range"] as? [String:Int])?["startColumnIndex"])
                    for row in typed.indices { typed[row][col]["userEnteredFormat"] = (style["cell"] as? Object)?["userEnteredFormat"] }
                }
                let add = try XCTUnwrap(requests.compactMap { $0["createDeveloperMetadata"] as? Object }.first)
                marker = try XCTUnwrap(add["developerMetadata"] as? Object); cells = typed; batchCount += 1
                ids += try typed.map { try XCTUnwrap(($0[0]["userEnteredValue"] as? Object)?["stringValue"] as? String) }; result = ["spreadsheetId":fileID]
            } else if path.hasSuffix(":search") {
                result = ["matchedDeveloperMetadata":marker.map { [["developerMetadata":$0]] } ?? []]
            } else if path.contains("/values/") {
                let range = String(path.components(separatedBy:"/values/").last ?? "")
                let rows: [[Any]], returned: String
                switch range {
                case "Kitty!A1:B": rows = [["sheet_version",2]]; returned = range + "100"
                case "Entries!A1:T1": rows = [header]; returned = range
                case "Entries!A1:A": rows = ids.map { [$0] }; returned = range + "5000"
                default: throw Fail.unexpectedResponse
                }
                result = ["range":returned,"majorDimension":"ROWS","values":rows]
            } else {
                result = ["spreadsheetId":fileID,"sheets":[["properties":["sheetId":123,"title":"Entries","gridProperties":["rowCount":5000,"columnCount":21]],
                           "data":[["startRow":1083,"rowData":cells.map { ["values":$0] }]]]]]
            }
            return .init(statusCode:200, data:try JSONSerialization.data(withJSONObject:result))
        }
    }
    func testSimulatedCommitAndReplanUsingTheOriginalSelectedInFiles() async throws {
        guard envSim, UUID(uuidString:run) != nil else { throw XCTSkip("Paired isolated simulator Files run only.") }
        let bytes = try ImportOriginals().load(id:sha,scope:"native-demo"), name = (ProcessInfo.processInfo.environment["KITTY_PRACTICE_FILE"] ?? "Kitty-2027-01-proof-" + run) + ".csv"
        XCTAssertEqual(bytes.count,229); XCTAssertEqual(hash(bytes),sha)
        let original = SourceDocument(name:name,mimeType:"text/csv",bytes:bytes)
        let host = KittyViewController(preferences:try XCTUnwrap(UserDefaults(suiteName:"PracticeTest-"+run)), websiteDataStore:.nonPersistent())
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.first as? UIWindowScene), window = UIWindow(windowScene:scene)
        window.rootViewController = host; window.makeKeyAndVisible(); defer { window.isHidden = true }
        host.loadViewIfNeeded(); let page = try XCTUnwrap(host.webView)
        let until = Date().addingTimeInterval(40)
        while Date() < until {
            if (try? await page.evaluateJavaScript("Boolean(window.KittyNative?.ready && window.KittyBank)")) as? Bool == true { break }
            try await Task.sleep(nanoseconds:100_000_000)
        }
        let fileID = "fictional_simulated_sheet_000001", selected = GoogleConnection.Selection(permissionID:"simulated",sheetID:fileID,sessionID:UUID())
        let owner = GoogleSheetSelection.Verified(selection:selected,title:"Simulated fixture",canEdit:true,canImportBankFiles:true)
        let source = try original.payload()
        func plan(_ added: [[Object]] = []) async throws -> Object {
            let body = """
                const keys='entry_id kind settled_at account_id raw_text description amount category_id person receipt_held note status created_at transfer_id transfer_account foreign_amount foreign_currency units unit_price source'.split(' ');
                const extra=added.map(row=>Object.fromEntries(keys.map((key,i)=>{const c=row[i]?.userEnteredValue||{};let v=c.stringValue??c.numberValue??'';if((i===2||i===12)&&typeof v==='number')v=new Date((v-25569)*86400000).toISOString().slice(0,10);return [key,v]})));
                const sheet={...KITTY_SNAPSHOT,entries:KITTY_SNAPSHOT.entries.concat(extra)};
                const result=KittyBank.prepare(sheet,source,{sourceID:source.id,name:source.name,byteLength:source.byteLength,mimeType:source.mimeType,account:'ACC-CC',month:'2027-01',downloadDay:'2027-01-31',sheetID:fileID});
                return {plan:result.plan,summary:result.summary,ids:['Entry ID',...sheet.entries.map(e=>e.entry_id)]};
                """
            let result = try await page.callAsyncJavaScript(body, arguments:["source":source,"fileID":fileID,"added":added], in:nil, contentWorld:.page)
            return try XCTUnwrap(result as? Object)
        }
        let first = try await plan(), proposed = try XCTUnwrap(first["plan"] as? Object), summary = try XCTUnwrap(first["summary"] as? Object)
        XCTAssertEqual(summary["duplicateCount"] as? Int,1); XCTAssertEqual(summary["proposedCount"] as? Int,2)
        let sheet = SimulatedSheet(fileID,try XCTUnwrap(first["ids"] as? [String]),columns), store = GooglePeriodBankJournalTests.Memory()
        let api = GoogleSheetTools(http:sheet,selected:selected,current:{selected},token:{ _ in "simulated" })
        let batch = try PeriodBankAppend(plan:proposed,sheetID:fileID,account:"ACC-CC",original:original,originalSHA256:sha)
        let journal = GooglePeriodBankJournal(api:api,store:store,original:original,plan:proposed,month:"2027-01",downloadDay:"2027-01-31",replan:{ source,account,_,_ in
            let refreshed = try await plan(sheet.cells); return try PeriodBankAppend(plan:try XCTUnwrap(refreshed["plan"] as? Object),sheetID:fileID,account:account,original:source,originalSHA256:source.id)
        })
        let verified = try await PeriodBankWriter.commit(batch,owner:owner,api:api,journal:journal)
        XCTAssertEqual(verified,batch.digest); XCTAssertEqual(sheet.batchCount,1); XCTAssertEqual(Array(sheet.ids.suffix(2)),["T0926","T0927"])
        let binding = try XCTUnwrap(store.all.first); XCTAssertEqual(store.blobs[binding.sourceID],bytes); XCTAssertNil(store.held)
        XCTAssertEqual(try obj(XCTUnwrap(store.blobs[binding.receiptID]))["kind"] as? String,"verified")
        let replay = try await plan(sheet.cells), again = try XCTUnwrap(replay["summary"] as? Object)
        XCTAssertEqual(again["duplicateCount"] as? Int,3); XCTAssertEqual(again["proposedCount"] as? Int,0)
        let second = try await PeriodBankWriter.commit(batch,owner:owner,api:api,journal:journal); XCTAssertEqual(second,verified); XCTAssertEqual(sheet.batchCount,1)
        try attachment("Simulator — Files original, simulated Google save and replay", ["provider":"simulated","sourceSHA256":sha,"firstDuplicates":1,"newIDs":["T0926","T0927"],"replayDuplicates":3,"writeBatches":sheet.batchCount,"privateBlobs":store.blobs.count])
    }
    private var envSim: Bool { ProcessInfo.processInfo.environment["KITTY_PRACTICE_ACCEPTANCE"] == "simulator-files" }
}
#endif
