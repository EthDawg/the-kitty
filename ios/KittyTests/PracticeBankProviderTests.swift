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
    /// Independent check against the source's signed, two-decimal currency. Older manifests stored dollars.
    private func signedCents(_ raw: Any?, encoding: Any? = nil) -> Int64? {
        guard let v = number(raw), v.isFinite else { return nil }
        if let encoding {
            guard encoding as? String == "integer-cents-v1" else { return nil }
            return Int64(exactly:v)
        }
        let scaled = v * 100, whole = scaled.rounded()
        guard abs(scaled - whole) < 0.000001 else { return nil }
        return Int64(exactly:whole)
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
              try await receiptFiles(api).isEmpty, try await GoogleBankStore(api:api).issuedTransactionNumber() == 0 else { throw Fail.wrongFixture }
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
        let sourceCents: [Int64] = [-1745,625]
        for ((r, expected), minor) in zip(zip(rows.suffix(2),newRows),sourceCents) {
            guard r.count >= 20, r[0] as? String == expected.0, r[1] as? String == "transaction", number(r[2]) == Double(expected.2),
                  r[3] as? String == "ACC-CC", r[4] as? String == expected.1, signedCents(r[6]) == minor,
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
        let expectedPeriod = hash(try json([api.selected.sheetID,api.selected.permissionID,sha,"ACC-CC","2027-01"]))
        guard let receiptTags = matches[0]["appProperties"] as? [String:String], receiptTags["kittyBankTerminal"] == "verified",
              receiptTags["kittyBankPeriod"] == expectedPeriod,
              receiptTags["kittyBankDigest"] == digest, let manifestID = binding["manifestID"] as? String,
              let actionID = binding["actionID"] as? String, receiptTags["kittyBankIntent"] == manifestID,
              Set([sourceID,manifestID,actionID,receiptID]).count == 4 else { throw Fail.archiveMismatch }
        guard let version = number(binding["version"]).flatMap(Int.init(exactly:)), [1,2,3].contains(version) else { throw Fail.archiveMismatch }
        let expectedMarker = number(binding["receiptMarkerID"]).flatMap(Int.init(exactly:))
        guard version == 1 ? expectedMarker == nil : (expectedMarker.map { (1...Int(Int32.max)).contains($0) && $0 != 2017113179 } == true) else { throw Fail.archiveMismatch }
        if version >= 3 {
            let sheetClaim = hash(Data((api.selected.sheetID + "\u{0}" + api.selected.permissionID).utf8))
            guard number(binding["issuedThrough"]) == 927, receiptTags["kittyBankIssuedT"] == "927", receiptTags["kittyBankIssuedSheet"] == sheetClaim,
                  let expectedMarker, receiptTags["kittyBankIssuedMarker"] == String(expectedMarker) else { throw Fail.archiveMismatch }
        }
        var archivedPlan: Object?, amountEncoding: Any?, archiveName: String?
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
                    archivedPlan = plan; amountEncoding = body["amountEncoding"]; archiveName = filename
                    guard amountEncoding as? String == "integer-cents-v1" || (version == 1 && amountEncoding == nil) else { throw Fail.archiveMismatch }
                    for ((r, expected), minor) in zip(zip(values,newRows),sourceCents) {
                        guard r.count == 20, r[0] as? String == expected.0, r[3] as? String == "ACC-CC",
                              r[4] as? String == expected.1, signedCents(r[6],encoding:amountEncoding) == minor else { throw Fail.archiveMismatch }
                    }
                }
            }
        }
        let bytes = try await drive(api,path:"files/" + sourceID,query:["alt":"media"])
        guard bytes.count == 229, hash(bytes) == sha else { throw Fail.archiveMismatch }
        let restored = try PeriodBankAppend.restoredPlan(XCTUnwrap(archivedPlan),amountEncoding:amountEncoding)
        let original = SourceDocument(name:try XCTUnwrap(archiveName),mimeType:"text/csv",bytes:bytes)
        let rebuilt = try PeriodBankAppend(plan:restored,sheetID:api.selected.sheetID,account:"ACC-CC",original:original,originalSHA256:sha).usingMarkerID(expectedMarker,recordsIssuedIDs:version >= 3)
        guard rebuilt.digest == digest, rebuilt.rows.map(\.id) == newRows.map(\.0) else { throw Fail.archiveMismatch }
        let search = try await api.request(path:"/developerMetadata:search",method:"POST",body:["dataFilters":[["developerMetadataLookup":["metadataKey":"kitty.period.bank.v1","metadataValue":digest,"visibility":"DOCUMENT"]]]])
        guard let hits = search["matchedDeveloperMetadata"] as? [Object], hits.count == 1,
              let marker = hits[0]["developerMetadata"] as? Object, number(marker["metadataId"]) == Double(rebuilt.markerID) else { throw Fail.archiveMismatch }
        var issuedCount = 0
        if version >= 3 {
            let issued = try await api.request(path:"/developerMetadata:search",method:"POST",body:["dataFilters":[["developerMetadataLookup":["metadataKey":"kitty.period.bank.issuedT.v1","metadataValue":"927|" + digest,"visibility":"DOCUMENT"]]]])
            guard let issuedHits = issued["matchedDeveloperMetadata"] as? [Object], issuedHits.count == 1,
                  let recorded = issuedHits[0]["developerMetadata"] as? Object,
                  recorded["metadataKey"] as? String == "kitty.period.bank.issuedT.v1", recorded["metadataValue"] as? String == "927|" + digest,
                  recorded["visibility"] as? String == "DOCUMENT", (recorded["location"] as? [String:Bool]) == ["spreadsheet":true],
                  let googleID = number(recorded["metadataId"]).flatMap(Int.init(exactly:)), googleID > 0, googleID != rebuilt.markerID else { throw Fail.archiveMismatch }
            guard try await GoogleBankStore(api:api).issuedTransactionNumber() == 927 else { throw Fail.archiveMismatch }
            issuedCount = issuedHits.count
        }
        let gate = try await api.request(path:"/developerMetadata:search",method:"POST",body:["dataFilters":[["developerMetadataLookup":["metadataId":2017113179,"metadataKey":"kitty.period.bank.hold.v1","visibility":"DOCUMENT"]]]])
        guard gate["matchedDeveloperMetadata"] == nil || (gate["matchedDeveloperMetadata"] as? [Object])?.isEmpty == true else { throw Fail.archiveMismatch }
        // A later download date must find the independently verified receipt for the same account and month.
        let owner = try await GoogleSheetSelection(http:api.http,current:api.current,token:api.token).verify(api.selected)
        let later = try await GooglePeriodBankJournal.recover(owner:owner,api:api,sourceSHA256:sha,account:"ACC-CC",month:"2027-01",downloadDay:"2027-02-01")
        guard later?.phase == .verified, later?.digest == digest, later?.downloadDay == "2027-01-31" else { throw Fail.archiveMismatch }
        let afterLookup = try await readLedger(api)
        guard hash(try json(afterLookup)) == hash(try json(rows)) else { throw Fail.differentLedger }
        try attachment("Independent provider read after Files replay", ["run":run, "privateOwnerOnly":true,"publicFeed":"no","originalEntries":oldCount,"allOriginalRowsIntact":true,
                       "newIDs":newRows.map(\.0),"signedSourceCents":sourceCents,"manifestAmountEncoding":amountEncoding ?? "legacy-decimal","account":"ACC-CC","existingDuplicate":"T0880","duplicateOccurrences":1,
                       "archivedBytes":bytes.count,"archivedSHA256":sha,"verifiedReceipts":1,"laterDownloadDateFoundOriginalReceipt":true,"durableReceiptMarkers":1,"issuedTMarkers":issuedCount,"bindingVersion":version,"sharedHoldReleased":true,"boundPrivateDriveFiles":4,"totalEntries":rows.count-1])
    }
}

#if targetEnvironment(simulator)
import WebKit

extension PracticeBankProviderTests {
    /// Only this simulator test replaces Google. The preceding UI phase must export and select the original in Apple's Files UI.
    private final class SimulatedSheet: GoogleHTTPTransport {
        var ids: [String]
        var cells = [[Object]](), marker: Object?, issuedMarker: Object?, batchCount = 0
        let fileID: String, header: [String]
        init(_ fileID: String, _ ids: [String], _ header: [String]) { self.fileID = fileID; self.ids = ids; self.header = header }
        var terminal: (() -> (BankBinding, Data)?)?
        private func drive(_ request: URLRequest, _ url: URL) throws -> GoogleHTTPResponse {
            guard request.httpMethod == "GET" else { throw Fail.unexpectedResponse }
            let args = URLComponents(url:url,resolvingAgainstBaseURL:false)?.queryItems ?? []
            let query: (String) -> String? = { key in args.first { $0.name == key }?.value }
            let claim = SourceDocument.sha256(Data((fileID + "\u{0}simulated").utf8))
            let existing = terminal?()
            func detail(_ b: BankBinding, _ bytes: Data) throws -> Object {
                guard let maxT = b.issuedThrough, let mid = b.receiptMarkerID else { throw Fail.archiveMismatch }
                let tags: [String:String] = ["kittyBankKind":"receipt","kittyBankTerminal":"verified","kittyBankScope":try b.scope,"kittyBankIntent":b.manifestID,
                   "kittyBankDigest":b.digest,"kittyBankIssuedSheet":claim,"kittyBankIssuedT":String(maxT),"kittyBankIssuedMarker":String(mid)]
                return ["id":b.receiptID,"appProperties":tags,"mimeType":"application/json","size":String(bytes.count),"trashed":false,"ownedByMe":true,
                        "owners":[["permissionId":"simulated"]],"permissions":[["id":"simulated","type":"user","role":"owner","deleted":false]]]
            }
            let result: Object
            if url.path == "/drive/v3/files" {
                guard query("q") == "trashed = false and 'me' in owners and appProperties has { key='kittyBankIssuedSheet' and value='" + claim + "' }", query("pageSize") == "1000",query("pageToken") == nil else { throw Fail.unexpectedResponse }
                let records: [Object]
                if let (b,bytes) = existing { records = [try detail(b,bytes)] } else { records = [] }
                result = ["files":records,"incompleteSearch":false]
            } else {
                guard let (b,bytes) = existing, url.path == "/drive/v3/files/" + b.receiptID else { throw Fail.unexpectedResponse }
                if query("alt") == "media" { return .init(statusCode:200,data:bytes) }
                result = try detail(b,bytes)
            }
            return .init(statusCode:200,data:try JSONSerialization.data(withJSONObject:result))
        }
        func send(_ request: URLRequest, maximumBytes: Int) async throws -> GoogleHTTPResponse {
            let url = try XCTUnwrap(request.url), path = url.path
            if url.host == "www.googleapis.com" { return try drive(request,url) }
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
                let adds = requests.compactMap { ($0["createDeveloperMetadata"] as? Object)?["developerMetadata"] as? Object }
                guard adds.count == 2, let receipt = adds.first(where:{ $0["metadataKey"] as? String == "kitty.period.bank.v1" }),
                      let receiptID = receipt["metadataId"] as? Int, let digest = receipt["metadataValue"] as? String,
                      receipt["visibility"] as? String == "DOCUMENT", receipt["location"] as? [String:Int] == ["sheetId":123],
                      var issued = adds.last, issued["metadataKey"] as? String == "kitty.period.bank.issuedT.v1",
                      Set(issued.keys) == ["metadataKey","metadataValue","visibility","location"],
                      issued["visibility"] as? String == "DOCUMENT", issued["location"] as? [String:Bool] == ["spreadsheet":true],
                      let finalID = ((typed.last?.first?["userEnteredValue"] as? Object)?["stringValue"]) as? String,
                      let maxT = Int(finalID.dropFirst()), finalID.first == "T", issued["metadataValue"] as? String == "\(maxT)|" + digest,
                      (requests.last?["createDeveloperMetadata"] as? Object) != nil else { throw Fail.archiveMismatch }
                // Google assigns this ID. A caller-supplied second ID, extra request, wrong scope or unbound digest fails the fake provider.
                guard requests.count == 6 else { throw Fail.unexpectedResponse }
                issued["metadataId"] = receiptID == 50000 ? 50001 : 50000
                marker = receipt; issuedMarker = issued; cells = typed; batchCount += 1
                ids += try typed.map { try XCTUnwrap(($0[0]["userEnteredValue"] as? Object)?["stringValue"] as? String) }; result = ["spreadsheetId":fileID]
            } else if path.hasSuffix(":search") {
                let body = try XCTUnwrap(try JSONSerialization.jsonObject(with:XCTUnwrap(request.httpBody)) as? Object)
                let filters = try XCTUnwrap(body["dataFilters"] as? [Object]).map { try XCTUnwrap($0["developerMetadataLookup"] as? Object) }
                if filters.count == 2 {
                    guard filters.allSatisfy({ Set($0.keys) == ["metadataKey","visibility"] && $0["visibility"] as? String == "DOCUMENT" }),
                          Set(filters.compactMap { $0["metadataKey"] as? String }) == ["kitty.period.bank.v1","kitty.period.bank.issuedT.v1"] else { throw Fail.unexpectedResponse }
                }
                guard (1...2).contains(filters.count) else { throw Fail.unexpectedResponse }
                let matches = [marker,issuedMarker].compactMap{$0}.filter { record in filters.contains { q in
                    for k in ["metadataKey","metadataValue","visibility"] { if let field = q[k] as? String, field != record[k] as? String { return false } }
                    if let id = q["metadataId"] as? Int, id != record["metadataId"] as? Int { return false }
                    if let loc = q["metadataLocation"] as? NSDictionary, !loc.isEqual(to:record["location"] as? Object ?? [:]) { return false }
                    return true
                } }
                result = ["matchedDeveloperMetadata":matches.map { ["developerMetadata":$0] }]
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
                let q = URLComponents(url:url,resolvingAgainstBaseURL:false)?.queryItems ?? []
                let ranges = q.first { $0.name == "ranges" }?.value
                if ranges == "Entries!A1" && q.first(where:{ $0.name == "fields" })?.value == "spreadsheetId,sheets(properties(sheetId,title))" {
                    result = ["spreadsheetId":fileID,"sheets":[["properties":["sheetId":123,"title":"Entries"]]]]
                } else {
                    guard ranges == "Entries!A1084:T1085" else { throw Fail.unexpectedResponse }
                    result = ["spreadsheetId":fileID,"sheets":[["properties":["sheetId":123,"title":"Entries","gridProperties":["rowCount":5000,"columnCount":21]],
                              "data":[["startRow":1083,"rowData":cells.map { ["values":$0] }]]]]]
                }
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
        func plan(_ added: [[Object]] = [], issuedFloor: Int = 0) async throws -> Object {
            let body = """
                const keys='entry_id kind settled_at account_id raw_text description amount category_id person receipt_held note status created_at transfer_id transfer_account foreign_amount foreign_currency units unit_price source'.split(' ');
                const extra=added.map(row=>Object.fromEntries(keys.map((key,i)=>{const c=row[i]?.userEnteredValue||{};let v=c.stringValue??c.numberValue??'';if((i===2||i===12)&&typeof v==='number')v=new Date((v-25569)*86400000).toISOString().slice(0,10);return [key,v]})));
                const sheet={...KITTY_SNAPSHOT,entries:KITTY_SNAPSHOT.entries.concat(extra)};
                const result=KittyBank.prepare(sheet,source,{sourceID:source.id,name:source.name,byteLength:source.byteLength,mimeType:source.mimeType,account:'ACC-CC',month:'2027-01',downloadDay:'2027-01-31',sheetID:fileID,transactionIDFloor:issuedFloor});
                return {plan:result.plan,summary:result.summary,ids:['Entry ID',...sheet.entries.map(e=>e.entry_id)]};
                """
            let result = try await page.callAsyncJavaScript(body, arguments:["source":source,"fileID":fileID,"added":added,"issuedFloor":issuedFloor], in:nil, contentWorld:.page)
            return try XCTUnwrap(result as? Object)
        }
        let first = try await plan(), proposed = try XCTUnwrap(first["plan"] as? Object), summary = try XCTUnwrap(first["summary"] as? Object)
        XCTAssertEqual(summary["duplicateCount"] as? Int,1); XCTAssertEqual(summary["proposedCount"] as? Int,2)
        let sheet = SimulatedSheet(fileID,try XCTUnwrap(first["ids"] as? [String]),columns), store = GooglePeriodBankJournalTests.Memory()
        let api = GoogleSheetTools(http:sheet,selected:selected,current:{selected},token:{ _ in "simulated" })
        sheet.terminal = { guard let b = store.all.last, let bytes = store.blobs[b.receiptID] else { return nil }; return (b,bytes) }
        let rawStore = GoogleBankStore(api:api)
        let previousIssue = try await rawStore.issuedTransactionNumber(); XCTAssertEqual(previousIssue,0)
        let batch = try PeriodBankAppend(plan:proposed,sheetID:fileID,account:"ACC-CC",original:original,originalSHA256:sha)
        let journal = GooglePeriodBankJournal(api:api,store:store,original:original,plan:proposed,month:"2027-01",downloadDay:"2027-01-31",replan:{ source,account,_,_ in
            let floor = try await rawStore.issuedTransactionNumber()
            let refreshed = try await plan(sheet.cells,issuedFloor:floor); return try PeriodBankAppend(plan:try XCTUnwrap(refreshed["plan"] as? Object),sheetID:fileID,account:account,original:source,originalSHA256:source.id)
        })
        let verified = try await PeriodBankWriter.commit(batch,owner:owner,api:api,journal:journal)
        XCTAssertEqual(verified,batch.digest); XCTAssertEqual(sheet.batchCount,1); XCTAssertEqual(Array(sheet.ids.suffix(2)),["T0926","T0927"])
        let binding = try XCTUnwrap(store.all.first); XCTAssertEqual(store.blobs[binding.sourceID],bytes); XCTAssertNil(store.held)
        XCTAssertEqual(try obj(XCTUnwrap(store.blobs[binding.receiptID]))["kind"] as? String,"verified")
        let manifest = try obj(XCTUnwrap(store.blobs[binding.manifestID])), savedPlan = try XCTUnwrap(manifest["plan"] as? Object)
        let encoding = try XCTUnwrap(manifest["amountEncoding"] as? String); XCTAssertEqual(encoding,"integer-cents-v1")
        let savedWrites = try XCTUnwrap(savedPlan["writes"] as? [Object]), values = try XCTUnwrap(savedWrites.first?["values"] as? [[Any]])
        XCTAssertEqual(values.compactMap { $0.count == 20 ? signedCents($0[6],encoding:encoding) : nil },[-1745,625])
        XCTAssertNil(signedCents(-17.45,encoding:encoding)); XCTAssertEqual(signedCents(-17.45),-1745)
        let decoded = try PeriodBankAppend.restoredPlan(savedPlan,amountEncoding:encoding)
        let archived = try PeriodBankAppend(plan:decoded,sheetID:fileID,account:"ACC-CC",original:original,originalSHA256:sha).usingMarkerID(binding.receiptMarkerID,recordsIssuedIDs:binding.version >= 3)
        XCTAssertEqual(archived.digest,batch.digest); XCTAssertEqual(number(sheet.marker?["metadataId"]),Double(archived.markerID))
        XCTAssertEqual(binding.version,3); XCTAssertEqual(sheet.issuedMarker?["metadataValue"] as? String,"927|" + archived.digest)
        let issued = try await rawStore.issuedTransactionNumber(); XCTAssertEqual(issued,927)
        let replay = try await plan(sheet.cells,issuedFloor:issued), again = try XCTUnwrap(replay["summary"] as? Object)
        XCTAssertEqual(again["duplicateCount"] as? Int,3); XCTAssertEqual(again["proposedCount"] as? Int,0)
        let later = try await GooglePeriodBankJournal.recover(owner:owner,api:api,sourceSHA256:original.id,account:"ACC-CC",month:"2027-01",downloadDay:"2027-02-01",store:store)
        XCTAssertEqual(later?.phase,.verified); XCTAssertEqual(later?.digest,verified); XCTAssertEqual(later?.downloadDay,"2027-01-31")
        let second = try await PeriodBankWriter.commit(batch,owner:owner,api:api,journal:journal); XCTAssertEqual(second,verified); XCTAssertEqual(sheet.batchCount,1)
        try attachment("Simulator — Files original, simulated Google save and replay", ["provider":"simulated","sourceSHA256":sha,"firstDuplicates":1,"newIDs":["T0926","T0927"],"replayDuplicates":3,"laterDownloadDateFoundOriginalReceipt":true,"writeBatches":sheet.batchCount,"privateBlobs":store.blobs.count,"issuedTransactionNumber":issued,"rawManifestCents":[-1745,625]])
    }
    private var envSim: Bool { ProcessInfo.processInfo.environment["KITTY_PRACTICE_ACCEPTANCE"] == "simulator-files" }
}
#endif

extension PracticeBankProviderTests {
    private struct RaceTrace: Codable {
        let run, operation, sheet, owner, sourceSHA, digest, priorSHA, priorEnteredSHA, batchSHA: String
        let priorCount: Int
        var gateReplies = [String:Int]()
        var deliveries = 0, successes = 0, droppedSuccess = 0, rejected = 0, quotaReadRetries = 0
        var contested: Bool {
            gateReplies.count == 2 && gateReplies.values.filter { (200..<300).contains($0) }.count == 1 &&
                gateReplies.values.filter { [400,409].contains($0) }.count == 1
        }
    }

    /// Both gate creations reach the provider before either client learns the result. Only the real,
    /// exactly reviewed bank batch loses a response, after Google acknowledges its atomic success.
    @MainActor private final class RaceWire {
        var trace: RaceTrace
        let record: URL, scope: String, original: Data
        private var atGate = Set<String>()
        var allowBankBatch = false
        init(_ trace: RaceTrace, record: URL, scope: String, original: Data) {
            self.trace = trace; self.record = record; self.scope = scope; self.original = original
        }
        func save() throws {
            try JSONEncoder().encode(trace).write(to:record,options:[.atomic,.completeFileProtection])
        }
        func rejection() throws { trace.rejected += 1; try save() }
        private func read(_ request: URLRequest, _ http: GoogleHTTPTransport, _ limit: Int) async throws -> GoogleHTTPResponse {
            let response = try await http.send(request,maximumBytes:limit)
            guard response.statusCode == 429 else { return response }
            // The two-client proof also independently reads the entire fixture twice. Pace only quota-limited reads.
            trace.quotaReadRetries += 1; try save()
            try await Task.sleep(for:.seconds(62))
            return try await http.send(request,maximumBytes:limit)
        }
        private func barrier(_ ready: () -> Bool) async throws {
            let clock = ContinuousClock(), deadline = clock.now.advanced(by:.seconds(90))
            while !ready() {
                guard clock.now < deadline else { throw Fail.unexpectedResponse }
                try await Task.sleep(for:.milliseconds(100))
            }
        }
        private func checkBinding(_ b: BankBinding) throws {
            guard b.valid, b.sheetID == trace.sheet, b.owner == trace.owner, b.account == "ACC-CC",
                  b.sourceSHA256 == trace.sourceSHA, b.digest == trace.digest, b.month == "2027-01",
                  b.downloadDay == "2027-01-31", b.rowCount == 1, try b.scope == scope else { throw Fail.wrongFixture }
        }
        private func binding(_ raw: String?) throws {
            guard let raw else { throw Fail.unexpectedResponse }
            try checkBinding(JSONDecoder().decode(BankBinding.self,from:Data(raw.utf8)))
        }
        private func checkUpload(_ request: URLRequest) throws {
            guard let url = request.url, let items = URLComponents(url:url,resolvingAgainstBaseURL:false)?.queryItems,
                  items.contains(URLQueryItem(name:"uploadType",value:"multipart")), items.contains(URLQueryItem(name:"ignoreDefaultVisibility",value:"true")),
                  let body = request.httpBody, body.count < 3_500_000,
                  let type = request.value(forHTTPHeaderField:"Content-Type"), let boundary = type.components(separatedBy:"boundary=").last,
                  !boundary.isEmpty, let start = body.range(of:Data("\r\n\r\n".utf8)),
                  let end = body.range(of:Data(("\r\n--" + boundary + "\r\n").utf8),in:start.upperBound..<body.endIndex),
                  let meta = try JSONSerialization.jsonObject(with:body[start.upperBound..<end.lowerBound]) as? Object,
                  let tags = meta["appProperties"] as? [String:String], tags["kittyBankScope"] == scope, tags["kittyBankDigest"] == trace.digest,
                  let kind = tags["kittyBankKind"].flatMap(BankBlob.init(rawValue:)), let id = meta["id"] as? String,
                  GoogleConnection.validSheetID(id), allowBankBatch || kind == .receipt, let intent = tags["kittyBankIntent"], GoogleConnection.validSheetID(intent),
                  meta["mimeType"] as? String == kind.mime,
                  let content = body.range(of:Data("\r\n\r\n".utf8),in:end.upperBound..<body.endIndex),
                  let tail = body.range(of:Data(("\r\n--" + boundary + "--\r\n").utf8),in:content.upperBound..<body.endIndex),
                  tail.upperBound == body.endIndex else { throw Fail.wrongFixture }
            let payload = body.subdata(in:content.upperBound..<tail.lowerBound)
            if kind == .original {
                guard payload == original else { throw Fail.wrongFixture }
            } else {
                guard let value = try JSONSerialization.jsonObject(with:payload) as? Object, let raw = value["binding"] as? Object else { throw Fail.wrongFixture }
                let b = try JSONDecoder().decode(BankBinding.self,from:JSONSerialization.data(withJSONObject:raw))
                try checkBinding(b)
                let expected: [BankBlob:String] = [.manifest:"reviewed",.action:"dispatch",.receipt:"verified"]
                guard b.manifestID == intent, kind.id(b) == id, value["kind"] as? String == expected[kind] else { throw Fail.wrongFixture }
            }
        }
        func forward(_ request: URLRequest, limit: Int, client: String, http: GoogleHTTPTransport) async throws -> GoogleHTTPResponse {
            guard let url = request.url else { throw Fail.wrongFixture }
            let base = "/v4/spreadsheets/" + trace.sheet, method = request.httpMethod ?? "GET"
            if url.host == "www.googleapis.com" {
                if method == "POST" && url.path == "/upload/drive/v3/files" {
                    try checkUpload(request); return try await http.send(request,maximumBytes:limit)
                }
                guard method == "GET", url.path == "/drive/v3/files" || url.path.hasPrefix("/drive/v3/files/") else { throw Fail.wrongFixture }
                return try await read(request,http,limit)
            }
            guard url.host == "sheets.googleapis.com", url.path == base || url.path.hasPrefix(base + "/") || url.path == base + ":batchUpdate" else { throw Fail.wrongFixture }
            if method == "GET" || (method == "POST" && [base + "/values:batchGetByDataFilter",base + "/developerMetadata:search"].contains(url.path)) {
                return try await read(request,http,limit)
            }
            guard method == "POST", url.path == base + ":batchUpdate", let body = request.httpBody,
                  let o = try JSONSerialization.jsonObject(with:body) as? Object, let requests = o["requests"] as? [Object] else { throw Fail.wrongFixture }
            let canonical = try JSONSerialization.data(withJSONObject:o,options:[.sortedKeys,.withoutEscapingSlashes])
            if SourceDocument.sha256(canonical) == trace.batchSHA {
                guard allowBankBatch, trace.contested else { throw Fail.wrongFixture }
                trace.deliveries += 1; try save()
                let response = try await http.send(request,maximumBytes:limit)
                if (200..<300).contains(response.statusCode) {
                    trace.successes += 1; try save()
                    guard trace.successes == 1, trace.droppedSuccess == 0, let result = try JSONSerialization.jsonObject(with:response.data) as? Object,
                          result["spreadsheetId"] as? String == trace.sheet, (result["replies"] as? [Object])?.count == requests.count else { throw Fail.differentLedger }
                    trace.droppedSuccess = 1; try save()
                    throw URLError(.networkConnectionLost)
                }
                return response
            }
            guard requests.count == 1 else { throw Fail.wrongFixture }
            if let c = requests[0]["createDeveloperMetadata"] as? Object, let m = c["developerMetadata"] as? Object,
               m["metadataId"] as? Int == GoogleBankStore.gateID, m["metadataKey"] as? String == GoogleBankStore.gateKey,
               m["visibility"] as? String == "DOCUMENT", (m["location"] as? Object)?["spreadsheet"] as? Bool == true {
                try binding(m["metadataValue"] as? String)
                guard allowBankBatch, !trace.contested, atGate.insert(client).inserted else { throw Fail.wrongFixture }
                try await barrier { self.atGate.count == 2 }
                let response = try await http.send(request,maximumBytes:limit)
                trace.gateReplies[client] = response.statusCode; try save()
                try await barrier { self.trace.gateReplies.count == 2 }
                guard trace.contested else { throw Fail.unexpectedResponse }
                return response
            }
            guard let d = requests[0]["deleteDeveloperMetadata"] as? Object, let f = d["dataFilter"] as? Object,
                  let m = f["developerMetadataLookup"] as? Object, m["metadataId"] as? Int == GoogleBankStore.gateID,
                  m["metadataKey"] as? String == GoogleBankStore.gateKey, m["locationMatchingStrategy"] as? String == "EXACT_LOCATION",
                  m["visibility"] as? String == "DOCUMENT", (m["metadataLocation"] as? Object)?["spreadsheet"] as? Bool == true else { throw Fail.wrongFixture }
            try binding(m["metadataValue"] as? String)
            return try await http.send(request,maximumBytes:limit)
        }
    }
    private struct RaceTransport: GoogleHTTPTransport {
        let client: String, wire: RaceWire, http: GoogleHTTPTransport
        func send(_ request: URLRequest, maximumBytes: Int) async throws -> GoogleHTTPResponse {
            do { return try await wire.forward(request,limit:maximumBytes,client:client,http:http) }
            catch let error as Fail { try await wire.rejection(); throw error }
        }
    }
    private func raceAPI(_ api: GoogleSheetTools, _ name: String, _ wire: RaceWire) -> GoogleSheetTools {
        .init(http:RaceTransport(client:name,wire:wire,http:api.http),selected:api.selected,current:api.current,token:api.token)
    }
    private func racePriorEnteredHash(_ api: GoogleSheetTools, count: Int) async throws -> String {
        let grid = try await api.request(query:["ranges":"Entries!A1:U\(count)",
            "fields":"spreadsheetId,sheets(properties(title),data(startRow,startColumn,rowData(values(userEnteredValue))))"])
        guard grid["spreadsheetId"] as? String == api.selected.sheetID, let tabs = grid["sheets"] as? [Object], tabs.count == 1,
              (tabs[0]["properties"] as? Object)?["title"] as? String == "Entries", let blocks = tabs[0]["data"] as? [Object],
              blocks.count == 1, (blocks[0]["startRow"] as? Int ?? 0) == 0, (blocks[0]["startColumn"] as? Int ?? 0) == 0,
              let rows = blocks[0]["rowData"] as? [Object], rows.count == count else { throw Fail.differentLedger }
        let entered = try rows.map { row -> [Object] in
            guard let cells = row["values"] as? [Object], (1...21).contains(cells.count),
                  (cells[0]["userEnteredValue"] as? Object)?["stringValue"] is String else { throw Fail.differentLedger }
            return (0..<21).map { i in i < cells.count ? (cells[i]["userEnteredValue"] as? Object ?? [:]) : [:] }
        }
        return hash(try json(entered))
    }
    private func raceReplan(_ owner: GoogleSheetSelection.Verified, _ api: GoogleSheetTools) -> GooglePeriodBankJournal.Replan {
        { source,account,month,day in
            let preview = try await PeriodBankPlanner.prepare(original:source,account:account,month:month,downloadDay:day,owner:owner,api:api)
            guard let batch = preview.batch else { throw PeriodBankAppend.Failure.staleLedger }
            return batch
        }
    }
    private func raceCommit(_ preview: PeriodBankPlanner.Preview, _ original: SourceDocument, _ owner: GoogleSheetSelection.Verified,
                            _ api: GoogleSheetTools, _ ticket: String?) async throws -> String? {
        let batch = try XCTUnwrap(preview.batch)
        let journal = GooglePeriodBankJournal(api:api,original:original,plan:preview.plan,month:"2027-01",downloadDay:"2027-01-31",
                                              expectedTicket:ticket,replan:raceReplan(owner,api))
        do { return try await PeriodBankWriter.commit(batch,owner:owner,api:api,journal:journal) }
        catch let error as GoogleSheetTools.Failure where error.code == "import_pending" { return nil }
        catch PeriodBankAppend.Failure.staleLedger { return nil } // The winning device can move the slot between the loser's reads.
        catch PeriodBankAppend.Failure.unverifiedRows { return nil } // A new marker can precede a coherent row read. Both clients must verify it below.
    }
    func testConcurrentNativeBankImportRecoversLostGoogleSuccess() async throws {
        try await proveRace(readbackOnly:false)
    }
    func testReadBackExistingConcurrentNativeBankImport() async throws {
        try await proveRace(readbackOnly:true)
    }
    private func proveRace(readbackOnly: Bool) async throws {
        try requirePhysical()
        let env = ProcessInfo.processInfo.environment
        guard env["KITTY_PRACTICE_CONCURRENCY"] == "post-replay",
              readbackOnly ? env["KITTY_PRACTICE_RACE_READBACK_ONLY"] == "1" : env["KITTY_PRACTICE_RACE_READBACK_ONLY"] == nil
        else { throw XCTSkip("Run only the explicitly requested phase following all six private practice checks.") }
        executionTimeAllowance = 480
        let (one,title,operation) = try await context(), (two,titleB,operationB) = try await context()
        let saved = try obj(Data(contentsOf:baseline)), selection = one.selected
        guard title == titleB, operation == operationB, selection.permissionID == two.selected.permissionID, selection.sheetID == two.selected.sheetID,
              selection.sessionID != two.selected.sessionID, saved["run"] as? String == run, saved["operation"] as? String == operation,
              saved["title"] as? String == title, saved["sheetID"] as? String == selection.sheetID, saved["owner"] as? String == selection.permissionID,
              saved["rowCount"] as? Int == 1082, let oldHash = saved["ledgerSHA256"] as? String else { throw Fail.wrongFixture }
        let oa = try await GoogleSheetSelection(http:one.http,current:one.current,token:one.token).verify(selection)
        let ob = try await GoogleSheetSelection(http:two.http,current:two.current,token:two.token).verify(two.selected)
        let previous = try await receiptFiles(one)
        guard oa.canImportBankFiles, oa.isPracticeCopy, ob.canImportBankFiles, ob.isPracticeCopy,
              previous.count == 1, privateFile(previous[0],selection.permissionID),
              (previous[0]["appProperties"] as? [String:String])?["kittyBankTerminal"] == "verified",
              let previousID = previous[0]["id"] as? String, GoogleConnection.validSheetID(previousID) else { throw Fail.wrongFixture }
        let oldReceipt = try obj(await drive(one,path:"files/" + previousID,query:["alt":"media"]))
        guard oldReceipt["kind"] as? String == "verified", let old = oldReceipt["binding"] as? Object,
              old["sourceSHA256"] as? String == sha, old["sheetID"] as? String == selection.sheetID,
              old["owner"] as? String == selection.permissionID, old["rowCount"] as? Int == 2 else { throw Fail.wrongFixture }
        let before = try await readLedger(one), priorCount = 1085 // Header, untouched baseline, and both six-phase entries.
        guard [priorCount,priorCount+1].contains(before.count), hash(try json(Array(before.prefix(1083)))) == oldHash,
              try json(before) == json(await readLedger(two)) else { throw Fail.differentLedger }
        try assertDuplicate(before)
        for (row,expected) in zip(before[1083..<1085],newRows) {
            guard row.count >= 20, row[0] as? String == expected.0, row[4] as? String == expected.1, number(row[2]) == Double(expected.2),
                  row[3] as? String == "ACC-CC", number(row[6]) == expected.3, row[19] as? String == "bank export" else { throw Fail.differentLedger }
        }
        let raw = "KITTY PRACTICE RACE " + run.uppercased()
        let bytes = Data("Date,Description,Card Member,Account #,Amount\r\n31/01/2027,\(raw),JORDAN DAVIES,-41007,3.17\r\n".utf8)
        let original = SourceDocument(name:"Kitty-2027-01-race-" + run + ".csv",mimeType:"text/csv",bytes:bytes)
        let priorHash = hash(try json(Array(before.prefix(priorCount)))), priorEntered = try await racePriorEnteredHash(one,count:priorCount)
        let record = baseline.deletingLastPathComponent().appendingPathComponent("KittyPracticeRace-" + run + ".json")
        let scope = try BankBinding.scope(sheet:selection.sheetID,owner:selection.permissionID,source:original.id,account:"ACC-CC",month:"2027-01",day:"2027-01-31")
        func preview(_ o: GoogleSheetSelection.Verified, _ api: GoogleSheetTools) async throws -> PeriodBankPlanner.Preview {
            try await PeriodBankPlanner.prepare(original:original,account:"ACC-CC",month:"2027-01",downloadDay:"2027-01-31",owner:o,api:api)
        }
        let a = try await preview(oa,one), b = try await preview(ob,two)
        var trace: RaceTrace?
        let resumingTrace = FileManager.default.fileExists(atPath:record.path)
        if resumingTrace {
            let t = try JSONDecoder().decode(RaceTrace.self,from:Data(contentsOf:record))
            guard t.run == run, t.operation == operation, t.sheet == selection.sheetID, t.owner == selection.permissionID,
                  t.sourceSHA == original.id, t.priorCount == priorCount, t.priorSHA == priorHash, t.priorEnteredSHA == priorEntered else { throw Fail.wrongFixture }
            trace = t
        }
        if readbackOnly {
            guard before.count == priorCount+1, trace?.contested == true, trace?.droppedSuccess == 1 else { throw Fail.differentLedger }
        }
        if before.count == priorCount {
            guard !before.contains(where:{ $0.first as? String == "T0928" || ($0.count > 4 && $0[4] as? String == raw) }),
                  let p = a.batch, let q = b.batch, p.digest == q.digest, try json(a.plan) == json(b.plan),
                  p.rows.map(\.id) == ["T0928"], p.firstRow == priorCount+1,
                  a.summary["duplicateCount"] as? Int == 0, b.summary["duplicateCount"] as? Int == 0 else { throw Fail.differentLedger }
            let issuedBatch = try p.usingMarkerID(p.markerID,recordsIssuedIDs:true)
            let observation = try await PeriodBankReadback.read(issuedBatch,owner:oa,api:one)
            guard case .batch(let requests) = try issuedBatch.next(observation,stage:.prepared,freshlyPlanned:q),
                  let issued = (requests.last?["createDeveloperMetadata"] as? Object)?["developerMetadata"] as? Object,
                  issued["metadataKey"] as? String == PeriodBankAppend.issuedKey, issued["metadataValue"] as? String == "928|" + p.digest,
                  issued["visibility"] as? String == "DOCUMENT", (issued["location"] as? Object)?["spreadsheet"] as? Bool == true,
                  let write = requests.compactMap({$0["updateCells"] as? Object}).first, let row = (write["rows"] as? [Object])?.first,
                  let cells = row["values"] as? [Object], cells.count == 20,
                  (cells[4]["userEnteredValue"] as? [String:String]) == ["stringValue":raw],
                  number((cells[6]["userEnteredValue"] as? Object)?["numberValue"]) == -3.17 else { throw Fail.differentLedger }
            let payloadHash = hash(try json(["requests":requests]))
            if let t = trace {
                guard t.digest == p.digest, t.batchSHA == payloadHash else { throw Fail.differentLedger }
            } else {
                trace = RaceTrace(run:run,operation:operation,sheet:selection.sheetID,owner:selection.permissionID,sourceSHA:original.id,
                                  digest:p.digest,priorSHA:priorHash,priorEnteredSHA:priorEntered,batchSHA:payloadHash,priorCount:priorCount)
            }
        } else {
            guard trace?.droppedSuccess == 1, a.batch == nil, b.batch == nil,
                  a.summary["duplicateCount"] as? Int == 1, b.summary["duplicateCount"] as? Int == 1 else { throw Fail.differentLedger }
        }
        let wire = RaceWire(try XCTUnwrap(trace),record:record,scope:scope,original:bytes)
        try wire.save()
        wire.allowBankBatch = !readbackOnly && before.count == priorCount
        let apiA = raceAPI(one,"A",wire), apiB = raceAPI(two,"B",wire), digest = wire.trace.digest
        if before.count == priorCount {
            let hold = try await GoogleBankStore(api:apiA).gate()
            if let hold {
                guard wire.trace.contested, hold.digest == digest, hold.sourceSHA256 == original.id, try hold.scope == scope else { throw Fail.wrongFixture }
            }
            let pending = try await GooglePeriodBankJournal.status(owner:oa,api:apiA,expectedDigest:digest)
            if let pending, pending.phase == .dispatched {
                guard pending.digest == digest, wire.trace.contested else { throw Fail.wrongFixture }
                _ = try await GooglePeriodBankJournal.resume(owner:oa,api:apiA,digest:digest,ticket:pending.ticket,replan:raceReplan(oa,apiA))
            } else {
                guard pending == nil || pending?.phase == .prepared else { throw Fail.wrongFixture }
                async let clientA = raceCommit(a,original,oa,apiA,pending?.ticket)
                async let clientB = raceCommit(b,original,ob,apiB,pending?.ticket)
                for result in try await [clientA,clientB] { if let result, result != digest { throw Fail.archiveMismatch } }
            }
        }
        guard wire.trace.contested, wire.trace.successes == 1, wire.trace.droppedSuccess == 1, wire.trace.rejected == 0,
              wire.trace.deliveries >= 1, resumingTrace || wire.trace.deliveries == 1 else { throw Fail.unexpectedResponse }
        wire.allowBankBatch = false
        let financialRequestsAfterRace = wire.trace.deliveries
        var verifiedBinding: BankBinding?
        for (owner,api) in [(oa,apiA),(ob,apiB)] {
            var status: GooglePeriodBankJournal.Status?
            for wait in [0,1,2,4,8] {
                if wait > 0 { try await Task.sleep(for:.seconds(wait)) }
                status = try await GooglePeriodBankJournal.recover(owner:owner,api:api,sourceSHA256:original.id,account:"ACC-CC",month:"2027-01",downloadDay:"2027-01-31")
                if status != nil && status?.phase != .dispatched { break }
            }
            guard status?.phase == .verified, status?.digest == digest, status?.rowCount == 1 else { throw Fail.archiveMismatch }
            let store = GoogleBankStore(api:api)
            guard let binding = try await store.finished(digest:digest,scope:nil), try binding.scope == scope,
                  let archived = try await store.blob(.original,binding), archived == bytes, hash(archived) == original.id,
                  let manifest = try await store.blob(.manifest,binding),
                  try await store.gate() == nil else { throw Fail.archiveMismatch }
            if let prior = verifiedBinding, prior != binding { throw Fail.archiveMismatch }
            verifiedBinding = binding
            let archivedReview = try obj(manifest)
            guard let encodedPlan = archivedReview["plan"] as? Object else { throw Fail.archiveMismatch }
            let approved = try PeriodBankAppend.restoredPlan(encodedPlan,amountEncoding:archivedReview["amountEncoding"])
            let batch = try PeriodBankAppend(plan:approved,sheetID:selection.sheetID,account:"ACC-CC",original:original,
                                            originalSHA256:original.id).usingMarkerID(binding.receiptMarkerID,recordsIssuedIDs:binding.version >= 3)
            let read = try await PeriodBankReadback.read(batch,owner:owner,api:api)
            guard batch.digest == digest, case .verified = try batch.next(read,stage:.dispatched) else { throw Fail.archiveMismatch }
            guard binding.issuedThrough == 928, try await store.issuedTransactionNumber() == 928 else { throw Fail.archiveMismatch }
            let rows = try await readLedger(api)
            guard rows.count == priorCount+1, hash(try json(Array(rows.prefix(priorCount)))) == priorHash,
                  try await racePriorEnteredHash(api,count:priorCount) == priorEntered, let r = rows.last,
                  r[0] as? String == "T0928", r[3] as? String == "ACC-CC", r[4] as? String == raw,
                  number(r[2]) == Double(GoogleSheetDay.serial("2027-01-31")!), number(r[6]) == -3.17,
                  rows.filter({ $0.count > 4 && $0[4] as? String == raw }).count == 1 else { throw Fail.differentLedger }
            let replay = try await preview(owner,api)
            guard replay.batch == nil, replay.summary["duplicateCount"] as? Int == 1,
                  replay.summary["proposedCount"] as? Int == 0, (replay.plan["writes"] as? [Object])?.isEmpty == true else { throw Fail.differentLedger }
        }
        guard wire.trace.deliveries == financialRequestsAfterRace else { throw Fail.differentLedger }
        try attachment("Private Google duplicate-ID premises",try await PracticeProviderCollisionProof.verify(api:one,binding:XCTUnwrap(verifiedBinding),
                      original:original,run:run,operation:operation,readbackOnly:readbackOnly))
        try attachment("Private Google race and deliberately lost success",["run":run,"twoIndependentSessions":true,
            "confirmedGateReplies":wire.trace.gateReplies,"bankRequests":wire.trace.deliveries,"successfulResponsesDropped":wire.trace.droppedSuccess,
            "successfulGoogleBankBatches":wire.trace.successes,"refusedOutOfScopeRequests":wire.trace.rejected,"quotaLimitedReadsRetried":wire.trace.quotaReadRetries,
            "originalSHA256":original.id,"archiveBytes":bytes.count,"verifiedDigest":digest,"priorRowsUnchanged":priorCount-1,"priorEnteredCellsAndFormulasMatch":true,
            "newIDs":["T0928"],"signedAmount":-3.17,"replayWrites":0,"replayFinancialRequests":0,"verifiedBySessions":2,"readbackOnlyInvocation":readbackOnly])
    }
}
