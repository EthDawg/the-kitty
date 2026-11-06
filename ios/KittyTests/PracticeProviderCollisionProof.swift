import Foundation
import XCTest
@testable import Kitty

/// Two negative provider checks after the completed T0928 private-practice test. This helper cannot
/// write cells, choose a new file ID, or upload arbitrary content. The separate recovery selector is GET/search-only.
@MainActor
enum PracticeProviderCollisionProof {
    typealias Object = [String:Any]
    private enum Failure: Error { case wrongFixture, unexpectedResponse, unprovenCollision, changedSource, noCompletedProbe }
    private static let fileFields = "id,name,mimeType,ownedByMe,trashed,permissions(id,type,role,deleted),appProperties,version,modifiedTime,size,md5Checksum"
    private struct Anchor: Equatable, Codable {
        let run, operation, sheetID, owner, digest, sourceID, sha: String
        let markerID: Int
    }
    private struct Facts: Equatable, Codable {
        let ledgerHash, markerHash, archiveMetadataHash, archivedSHA: String
        let rows: Int
    }
    private struct Record: Codable {
        let anchor: Anchor, facts: Facts
        var markerStatus: Int?, driveStatus: Int?, complete = false
    }
    private static func json(_ obj: Any) throws -> Data { try JSONSerialization.data(withJSONObject:obj,options:[.sortedKeys,.withoutEscapingSlashes]) }
    private static func object(_ data: Data) throws -> Object {
        guard let result = try JSONSerialization.jsonObject(with:data) as? Object else { throw Failure.unexpectedResponse }; return result
    }
    private static func raw(_ api: GoogleSheetTools, host: String, path: String, query: [String:String] = [:],
                            body: Data? = nil, mime: String = "application/json") async throws -> GoogleHTTPResponse {
        // All routes are fixed below; no file metadata, bank text or URL provided by the caller selects an endpoint.
        var u = URLComponents(); u.scheme = "https"; u.host = host; u.path = path
        u.queryItems = query.sorted { $0.key < $1.key }.map { URLQueryItem(name:$0.key,value:$0.value) }
        var request = URLRequest(url:try XCTUnwrap(u.url)); request.httpMethod = body == nil ? "GET" : "POST"
        try api.check(); request.setValue("Bearer " + (try await api.token(api.selected)),forHTTPHeaderField:"Authorization")
        if let body { request.setValue(mime,forHTTPHeaderField:"Content-Type"); request.httpBody = body }
        try api.check(); let response = try await api.http.send(request,maximumBytes:256_000); try api.check(); return response
    }
    private static func driveFile(_ api: GoogleSheetTools, id: String, media: Bool = false) async throws -> Data {
        guard GoogleConnection.validSheetID(id) else { throw Failure.wrongFixture }
        let response = try await raw(api,host:"www.googleapis.com",path:"/drive/v3/files/"+id,query:media ? ["alt":"media"] : ["fields":fileFields])
        guard response.statusCode == 200 else { throw Failure.unexpectedResponse }; return response.data
    }
    private static func ownerOnly(_ f: Object, _ owner: String) -> Bool {
        guard f["ownedByMe"] as? Bool == true, f["trashed"] as? Bool == false, let acl = f["permissions"] as? [Object], acl.count == 1 else { return false }
        return acl[0]["role"] as? String == "owner" && acl[0]["type"] as? String == "user" && acl[0]["id"] as? String == owner && acl[0]["deleted"] as? Bool != true
    }
    private static func fingerprint(_ a: Anchor, _ b: BankBinding, _ source: SourceDocument, api: GoogleSheetTools) async throws -> (Facts,Object) {
        let scope = try b.scope
        let sheet = try object(await driveFile(api,id:a.sheetID))
        guard ownerOnly(sheet,a.owner), sheet["id"] as? String == a.sheetID, sheet["mimeType"] as? String == "application/vnd.google-apps.spreadsheet",
              let tags = sheet["appProperties"] as? [String:String], tags["kittyPractice"] == "davies-v2", tags["kittyPracticeOperation"] == a.operation else { throw Failure.wrongFixture }
        let opts = try await api.values("Kitty!A1:B",render:"UNFORMATTED_VALUE")["values"] as? [[Any]] ?? []
        guard opts.filter({ $0.first as? String == "public_feed" }).count == 1,
              opts.contains(where:{ $0.count == 2 && $0[0] as? String == "public_feed" && ($0[1] as? String)?.lowercased() == "no" }) else { throw Failure.wrongFixture }
        let rows = try await api.values("Entries!A1:T",render:"UNFORMATTED_VALUE")["values"] as? [[Any]] ?? []
        guard rows.count == 1086, let last = rows.last, last.count >= 20, last[0] as? String == "T0928", last[3] as? String == "ACC-CC",
              last[4] as? String == "KITTY PRACTICE RACE " + a.run.uppercased(), PeriodBankAppend.number(last[6]) == -3.17,
              rows.filter({$0.first as? String == "T0928"}).count == 1 else { throw Failure.wrongFixture }
        let meta = try await api.request(query:["ranges":"Entries!A1","fields":"spreadsheetId,sheets(properties(sheetId,title))"])
        guard meta["spreadsheetId"] as? String == a.sheetID, let tabs = meta["sheets"] as? [Object], tabs.count == 1,
              let p = tabs[0]["properties"] as? Object, p["title"] as? String == "Entries", let tab = p["sheetId"] as? Int else { throw Failure.wrongFixture }
        let found = try await api.request(path:"/developerMetadata:search",method:"POST",body:["dataFilters":[["developerMetadataLookup":["metadataId":a.markerID]]]])
        guard let hits = found["matchedDeveloperMetadata"] as? [Object], hits.count == 1, let marker = hits[0]["developerMetadata"] as? Object,
              PeriodBankAppend.number(marker["metadataId"]) == Double(a.markerID), marker["metadataKey"] as? String == "kitty.period.bank.v1",
              marker["metadataValue"] as? String == a.digest, marker["visibility"] as? String == "DOCUMENT", (marker["location"] as? Object)?["sheetId"] as? Int == tab else { throw Failure.wrongFixture }
        let archive = try object(await driveFile(api,id:a.sourceID)), content = try await driveFile(api,id:a.sourceID,media:true)
        guard archive["id"] as? String == a.sourceID, ownerOnly(archive,a.owner), archive["mimeType"] as? String == "text/csv",
              archive["name"] as? String == BankBlob.original.name(b), archive["size"] as? String == String(source.bytes.count),
              let props = archive["appProperties"] as? [String:String], props["kittyBankIntent"] == b.manifestID,
              props["kittyBankKind"] == "original", props["kittyBankDigest"] == a.digest, props["kittyBankScope"] == scope,
              content == source.bytes, SourceDocument.sha256(content) == a.sha else { throw Failure.changedSource }
        return (Facts(ledgerHash:SourceDocument.sha256(try json(rows)),markerHash:SourceDocument.sha256(try json(marker)),
                      archiveMetadataHash:SourceDocument.sha256(try json(archive)),archivedSHA:a.sha,rows:rows.count-1),archive)
    }
    private static func duplicate(_ response: GoogleHTTPResponse, allowed: Set<Int>) throws -> Int {
        guard allowed.contains(response.statusCode), let error = try object(response.data)["error"] as? Object,
              PeriodBankAppend.number(error["code"]) == Double(response.statusCode),
              let explanation = error["message"] as? String else { throw Failure.unprovenCollision }
        // Drive documents 409 for a repeated pre-generated ID; the conflicting request is byte-identical
        // to the verified private file. Sheets can use generic 400, so require the duplicate-ID explanation there.
        if allowed == [409] && response.statusCode == 409 { return 409 }
        let reasons = (error["errors"] as? [Object] ?? []).compactMap { $0["reason"] as? String }
        let words = ([explanation,error["status"] as? String ?? ""] + reasons).joined(separator:" ").lowercased()
        let assignedID = words.contains("already") && words.contains("metadata") && words.contains("id")
        guard assignedID || ["already exist","already_exists","alreadyexists","already in use","already used","already taken","duplicate","must be unique"].contains(where: { words.contains($0) }) else { throw Failure.unprovenCollision }
        return response.statusCode
    }
    static func verify(api: GoogleSheetTools, binding b: BankBinding, original: SourceDocument, run: String,
                       operation: String, readbackOnly: Bool) async throws -> Object {
        let env = ProcessInfo.processInfo.environment
        let expectedCSV = "Date,Description,Card Member,Account #,Amount\r\n31/01/2027,KITTY PRACTICE RACE " + run.uppercased() + ",JORDAN DAVIES,-41007,3.17\r\n"
        guard env["KITTY_PRACTICE_ACCEPTANCE"] == "private-google", env["KITTY_PRACTICE_CONCURRENCY"] == "post-replay", env["KITTY_PRACTICE_RUN"] == run,
              readbackOnly == (env["KITTY_PRACTICE_RACE_READBACK_ONLY"] == "1"), UUID(uuidString:run) != nil, UUID(uuidString:operation) != nil,
              b.valid, b.sheetID == api.selected.sheetID, b.owner == api.selected.permissionID, b.sheetID != GoogleSheetSelection.demoFileID,
              b.account == "ACC-CC", b.rowCount == 1, b.month == "2027-01", b.downloadDay == "2027-01-31", let id = b.receiptMarkerID,
              original.name == "Kitty-2027-01-race-" + run + ".csv", original.mimeType == "text/csv", original.isIntact,
              original.bytes == Data(expectedCSV.utf8), original.id == b.sourceSHA256 else { throw Failure.wrongFixture }
        let anchor = Anchor(run:run,operation:operation,sheetID:b.sheetID,owner:b.owner,digest:b.digest,sourceID:b.sourceID,sha:b.sourceSHA256,markerID:id)
        let (facts,archive) = try await fingerprint(anchor,b,original,api:api)
        let file = FileManager.default.urls(for:.cachesDirectory,in:.userDomainMask)[0].appendingPathComponent("KittyProviderCollision-" + run + ".json")
        let result: Record
        if FileManager.default.fileExists(atPath:file.path) {
            let prior = try JSONDecoder().decode(Record.self,from:Data(contentsOf:file))
            guard prior.anchor == anchor, prior.facts == facts, prior.complete, [400,409].contains(prior.markerStatus ?? 0), prior.driveStatus == 409 else { throw Failure.noCompletedProbe }
            result = prior
        } else {
            guard !readbackOnly else { throw Failure.noCompletedProbe }
            var record = Record(anchor:anchor,facts:facts)
            func persist() throws { try JSONEncoder().encode(record).write(to:file,options:[.atomic,.completeFileProtection]) }
            try persist() // Never silently repeat either probe if this test process loses its result.
            let collision: Object = ["metadataId":id,"metadataKey":"kitty.practice.duplicate-id.v1","metadataValue":run,
                                    "visibility":"DOCUMENT","location":["spreadsheet":true]]
            let body = try json(["requests":[["createDeveloperMetadata":["developerMetadata":collision]]]])
            let rejected = try await raw(api,host:"sheets.googleapis.com",path:"/v4/spreadsheets/"+b.sheetID+":batchUpdate",body:body)
            record.markerStatus = try duplicate(rejected,allowed:[400,409]); try persist()
            let (between,_) = try await fingerprint(anchor,b,original,api:api); guard between == facts else { throw Failure.changedSource }
            // Identical content, name and app properties at the already verified generated ID. No automatic ID allocation or file update.
            let metadata: Object = ["id":b.sourceID,"name":try XCTUnwrap(archive["name"]),"mimeType":"text/csv","appProperties":try XCTUnwrap(archive["appProperties"])]
            let boundary = "kitty-practice-" + run
            var packet = Data("--\(boundary)\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n".utf8); packet.append(try json(metadata))
            packet.append(Data("\r\n--\(boundary)\r\nContent-Type: text/csv\r\n\r\n".utf8)); packet.append(original.bytes); packet.append(Data("\r\n--\(boundary)--\r\n".utf8))
            let refused = try await raw(api,host:"www.googleapis.com",path:"/upload/drive/v3/files",query:["uploadType":"multipart","fields":"id","ignoreDefaultVisibility":"true"],body:packet,mime:"multipart/related; boundary="+boundary)
            record.driveStatus = try duplicate(refused,allowed:[409]); try persist()
            let (after,_) = try await fingerprint(anchor,b,original,api:api); guard after == facts else { throw Failure.changedSource }
            record.complete = true; try persist(); result = record
        }
        return ["run":run,"privatePractice":true,"metadataOriginalLocation":"Entries sheet","metadataDuplicateLocation":"spreadsheet",
                "metadataDuplicateHTTP":result.markerStatus!,"driveUsedGeneratedIDHTTP":result.driveStatus!, "existingMarkerUnchanged":true,
                "originalCSVUnchanged":true,"archiveMetadataAndVersionUnchanged":true,"sourceSHA256":facts.archivedSHA,
                "ledgerRowsUnchanged":facts.rows,"financialRequestsSentByTheseProbes":0,"reusedProtectedProof":readbackOnly]
    }
}
