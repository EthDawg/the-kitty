import Foundation

/// The hold lives on the chosen Sheet. The four blobs live in the importing person's private My Drive.
struct BankBinding: Codable, Equatable {
    let version: Int
    let sheetID, owner, account, sourceSHA256, digest, month, downloadDay: String
    let rowCount: Int
    let sourceID, manifestID, actionID, receiptID: String
    // Version 1 derives the fence from the archived plan. New intents pin it before any dispatch.
    var receiptMarkerID: Int? = nil
    var issuedThrough: Int? = nil
    var replacesTicket: String? = nil
    var ticket: String { SourceDocument.sha256(Data((digest + "\u{0}" + manifestID).utf8)) }
    static func sourceKey(sheet: String, owner: String, sha: String) -> String {
        SourceDocument.sha256(Data((sheet + "\u{0}" + owner + "\u{0}" + sha).utf8))
    }
    var sourceKey: String { Self.sourceKey(sheet:sheetID,owner:owner,sha:sourceSHA256) }

    static func hash(_ value: String) -> Bool {
        value.utf8.count == 64 && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
    }
    static func validDateScope(_ month: String, _ day: String) -> Bool {
        month.utf8.count == 7 && GoogleSheetDay.serial(month + "-01") != nil && GoogleSheetDay.serial(day) != nil
    }
    @MainActor var valid: Bool {
        let ids = [sourceID, manifestID, actionID, receiptID]
        let fenceValid = version == 1 ? receiptMarkerID == nil :
            ([2,3].contains(version) && receiptMarkerID.map { (1...Int(Int32.max)).contains($0) && $0 != GoogleBankStore.gateID } == true)
        let allocationValid = version == 3 ? issuedThrough.map { $0 >= rowCount && $0 <= 99_999_999 } == true &&
            replacesTicket.map { Self.hash($0) && $0 != ticket } != false : issuedThrough == nil && replacesTicket == nil
        return fenceValid && allocationValid && GoogleConnection.validSheetID(sheetID) && !owner.isEmpty && owner.utf8.count <= 200 &&
            !account.isEmpty && account.utf8.count <= 160 && Self.hash(digest) && Self.hash(sourceSHA256) &&
            Self.validDateScope(month, downloadDay) && (1...4000).contains(rowCount) &&
            Set(ids).count == 4 && ids.allSatisfy { GoogleConnection.validSheetID($0) && $0.utf8.count <= 100 }
    }
    private static func hashScope(_ parts: [String]) throws -> String {
        SourceDocument.sha256(try JSONSerialization.data(withJSONObject:parts,options:[.withoutEscapingSlashes]))
    }
    // The original approval includes its stated download day. Keep this hash byte-compatible with all private archives.
    static func scope(sheet: String, owner: String, source: String, account: String, month: String, day: String) throws -> String {
        try hashScope([sheet,owner,source,account,month,day])
    }
    var scope: String {
        get throws { try Self.scope(sheet: sheetID, owner: owner, source: sourceSHA256, account: account, month: month, day: downloadDay) }
    }
    // Finding an earlier posting depends on which month of the file was imported, regardless of its download day.
    static func periodScope(sheet: String, owner: String, source: String, account: String, month: String) throws -> String {
        try hashScope([sheet,owner,source,account,month])
    }
    var periodScope: String {
        get throws { try Self.periodScope(sheet:sheetID,owner:owner,source:sourceSHA256,account:account,month:month) }
    }
    func data() throws -> Data {
        let e = JSONEncoder(); e.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return try e.encode(self)
    }
    var object: [String: Any] {
        get throws {
            guard let value = try JSONSerialization.jsonObject(with: data()) as? [String: Any] else { throw GoogleBankStore.invalid }
            return value
        }
    }
}

enum BankBlob: String {
    case original, manifest, action, receipt
    func id(_ b: BankBinding) -> String {
        switch self {
        case .original: return b.sourceID
        case .manifest: return b.manifestID
        case .action: return b.actionID
        case .receipt: return b.receiptID
        }
    }
    var mime: String { self == .original ? "text/csv" : "application/json" }
    var limit: Int { self == .original ? 5 * 1024 * 1024 : (self == .manifest ? 3 * 1024 * 1024 : 8000) }
    func name(_ b: BankBinding) -> String {
        self == .original ? "Kitty bank source \(b.sourceSHA256.prefix(12)).csv" : "Kitty bank \(rawValue) \(b.digest.prefix(12)).json"
    }
}

/// Only create-if-absent operations, exact reads and a conditional release are exposed to the journal.
@MainActor
protocol BankStore {
    func checkNewWrite(_ owner: GoogleSheetSelection.Verified) async throws
    func ids() async throws -> [String]
    func gate() async throws -> BankBinding?
    func marker(_ id: Int) async throws -> [String:Any]?
    func fence(_ b: BankBinding, id: Int) async throws -> [String:Any]?
    func acquire(_ b: BankBinding) async throws -> BankBinding
    func release(_ b: BankBinding) async throws
    func blob(_ kind: BankBlob, _ b: BankBinding) async throws -> Data?
    func create(_ kind: BankBlob, _ b: BankBinding, data: Data) async throws -> (createdHere: Bool, bytes: Data)
    /// Supply one receipt digest or the day-independent BankBinding.periodScope.
    func finished(digest: String?, scope: String?) async throws -> BankBinding?
    func manualSource(_ key: String) async throws -> BankBinding?
    func issuedTransactionNumber() async throws -> Int
    func currentEntryFacts() async throws -> [[Any]]
}

@MainActor
struct GoogleBankStore: BankStore {
    let api: GoogleSheetTools
    typealias Object = [String: Any]
    static let gateID = 2_017_113_179
    static let gateKey = "kitty.period.bank.hold.v1"
    static let abandonedKey = "kitty.period.bank.abandoned.v1"
    // A digest's authenticated plan is immutable. Keep only its numeric floor in this native session.
    private static var legacySession: UUID?
    private static var legacyIssued = [String:Int]()
    // Older receipts have only the day-specific tag. Cache their authenticated routing hashes for this sign-in.
    private static var routeSession: UUID?
    private static var legacyRoutes = [String:String]()
    private static func issuedSheet(_ sheet: String, _ owner: String) -> String {
        SourceDocument.sha256(Data((sheet + "\u{0}" + owner).utf8))
    }
    nonisolated static var invalid: GoogleSheetTools.Failure { .init(code: "import_evidence", message: "Kitty could not verify this import's original or receipt. Restore the private Drive original and import records if they were removed, then check the import again.") }
    static var pending: GoogleSheetTools.Failure { .init(code: "import_pending", message: "A bank import is awaiting verification. Check its status before confirming another import.") }

    func checkNewWrite(_ owner: GoogleSheetSelection.Verified) async throws {
        try api.check()
        guard owner.canImportBankFiles, owner.selection == api.selected else { throw Self.invalid }
        let check = GoogleSheetSelection(http: api.http, current: api.current, token: api.token)
        let fresh = try await check.verify(api.selected)
        guard fresh.canImportBankFiles else {
            throw GoogleSheetTools.Failure(code: "not_granted", message: "Choose an editable, privately shared household Sheet you own before importing.")
        }
        let values = try await api.values("Kitty!A1:B", render: "UNFORMATTED_VALUE")
        guard let rows = values["values"] as? [[Any]], !rows.isEmpty else { throw Self.invalid }
        try Self.checkFeed(rows)
    }
    static func checkFeed(_ rows: [[Any]]) throws {
        let keys = rows.filter { ($0.first as? String)?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == "public_feed" }
        let value = keys.first.flatMap { $0.count > 1 ? String(describing:$0[1]) : nil } ?? ""
        if keys.count > 1 || !["","no","false","off","0"].contains(value.trimmingCharacters(in:.whitespacesAndNewlines).lowercased()) {
            throw GoogleSheetTools.Failure(code: "public_feed_enabled", message: "Turn off public_feed in the Kitty tab and refresh before importing.")
        }
    }

    private func drive(_ path: String, query: [String: String] = [:], body: Data? = nil,
                       type: String? = nil, limit: Int = 512_000) async throws -> GoogleHTTPResponse {
        try api.check()
        let access = try await api.token(api.selected)
        try api.check()
        var u = URLComponents(); u.scheme = "https"; u.host = "www.googleapis.com"; u.path = path
        u.queryItems = query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
        guard let url = u.url else { throw Self.invalid }
        var request = URLRequest(url: url); request.httpMethod = body == nil ? "GET" : "POST"
        request.httpBody = body; request.setValue("Bearer " + access, forHTTPHeaderField: "Authorization")
        if let type { request.setValue(type, forHTTPHeaderField: "Content-Type") }
        let response = try await api.http.send(request, maximumBytes: limit)
        try api.check()
        switch response.statusCode {
        case 200..<300, 404, 409: return response
        case 401: throw GoogleSheetTools.Failure(code: "needs_reauth", message: "Reconnect Google to check your import.")
        case 403: throw GoogleSheetTools.Failure(code: "not_granted", message: "Google did not grant access to the private source archive.")
        default: throw GoogleSheetTools.Failure(code: "archive_unavailable", message: "Google Drive could not confirm this archive operation. Check the import again.")
        }
    }
    private func json(_ response: GoogleHTTPResponse) throws -> Object {
        guard (200..<300).contains(response.statusCode), let result = try? JSONSerialization.jsonObject(with: response.data) as? Object else { throw Self.invalid }
        return result
    }
    func ids() async throws -> [String] {
        let data = try json(await drive("/drive/v3/files/generateIds", query: ["count":"4","space":"drive","type":"files"]))
        guard let ids = data["ids"] as? [String], ids.count == 4, Set(ids).count == 4,
              ids.allSatisfy({ GoogleConnection.validSheetID($0) && $0.utf8.count <= 100 }) else { throw Self.invalid }
        return ids
    }
    private func value(_ b: BankBinding) throws -> String {
        guard b.valid, b.sheetID == api.selected.sheetID, let encoded = String(data: try b.data(), encoding: .utf8) else { throw Self.invalid }
        return encoded
    }
    func marker(_ id: Int) async throws -> Object? {
        guard (1...Int(Int32.max)).contains(id) else { throw Self.invalid }
        let lookup: Object = ["metadataId":id]
        let found = try await api.request(path: "/developerMetadata:search", method: "POST", body: ["dataFilters":[["developerMetadataLookup":lookup]]])
        guard found["matchedDeveloperMetadata"] == nil || found["matchedDeveloperMetadata"] is [Object] else { throw Self.invalid }
        let rows = found["matchedDeveloperMetadata"] as? [Object] ?? []
        if rows.isEmpty { return nil }
        guard rows.count == 1, let record = rows[0]["developerMetadata"] as? Object, PeriodBankAppend.number(record["metadataId"]) == Double(id) else { throw Self.invalid }
        return record
    }
    func currentEntryFacts() async throws -> [[Any]] {
        let grids = try await PeriodBankPlanner.freshGrids(ranges:["entries":"Entries!A1:G"],api:api)
        guard let rows = grids["entries"], rows.first as? [String] == Array(PeriodBankAppend.columns.prefix(7)) else { throw api.invalid }
        return Array(rows.dropFirst())
    }
    /// Every v3 batch atomically adds its final T and its permanent bank marker. Older genuine markers
    /// have no such companion, so authenticate their archived plan instead of trusting the current tail.
    func issuedTransactionNumber() async throws -> Int {
        let keys = [PeriodBankAppend.guardKey,PeriodBankAppend.issuedKey]
        let filters = keys.map { ["developerMetadataLookup":["metadataKey":$0,"visibility":"DOCUMENT"]] }
        let data = try await api.request(path:"/developerMetadata:search",method:"POST",body:["dataFilters":filters])
        guard data["matchedDeveloperMetadata"] == nil || data["matchedDeveloperMetadata"] is [Object] else { throw Self.invalid }
        let hits = data["matchedDeveloperMetadata"] as? [Object] ?? []
        let privateClaims = try await issuedReceipts()
        if hits.isEmpty {
            guard privateClaims.isEmpty else { throw Self.invalid }
            return 0
        }
        let meta = try await api.request(query:["ranges":"Entries!A1","fields":"spreadsheetId,sheets(properties(sheetId,title))"])
        guard meta["spreadsheetId"] as? String == api.selected.sheetID, let tabs = meta["sheets"] as? [Object], tabs.count == 1,
              let p = tabs[0]["properties"] as? Object, p["title"] as? String == "Entries", let tab = p["sheetId"] as? Int, tab >= 0 else { throw Self.invalid }
        var posted = [String:Int](), issued = [String:Int](), ids = Set<Int>()
        for hit in hits {
            guard let m = hit["developerMetadata"] as? Object, let id = PeriodBankAppend.number(m["metadataId"]).flatMap(Int.init(exactly:)),
                  (1...Int(Int32.max)).contains(id), ids.insert(id).inserted, m["visibility"] as? String == "DOCUMENT",
                  let location = m["location"] as? Object, let value = m["metadataValue"] as? String else { throw Self.invalid }
            switch m["metadataKey"] as? String {
            case PeriodBankAppend.issuedKey:
                let parts = value.split(separator:"|",omittingEmptySubsequences:false)
                guard location["spreadsheet"] as? Bool == true, location["sheetId"] == nil, location["dimensionRange"] == nil,
                      location["locationType"] == nil || location["locationType"] as? String == "SPREADSHEET",
                      parts.count == 2, let n = Int(parts[0]), (1...99_999_999).contains(n), String(n) == parts[0],
                      BankBinding.hash(String(parts[1])), issued.updateValue(n,forKey:String(parts[1])) == nil else { throw Self.invalid }
            case PeriodBankAppend.guardKey:
                guard location["spreadsheet"] == nil, location["dimensionRange"] == nil,
                      location["locationType"] == nil || location["locationType"] as? String == "SHEET",
                      PeriodBankAppend.number(location["sheetId"]) == Double(tab), BankBinding.hash(value),
                      posted.updateValue(id,forKey:value) == nil else { throw Self.invalid }
            default: throw Self.invalid
            }
        }
        guard Set(issued.keys).isSubset(of:Set(posted.keys)) else { throw Self.invalid }
        for (digest,claim) in privateClaims {
            guard posted[digest] == claim.marker, issued[digest] == claim.number else { throw Self.invalid }
        }
        var maximum = 0
        if Self.legacySession != api.selected.sessionID { Self.legacySession = api.selected.sessionID; Self.legacyIssued.removeAll() }
        // All v3 assertions are paired against app-private metadata in one paged projection.
        // Authenticate the maximum itself against its immutable receipt; older bank CSVs stay closed.
        if let winner = privateClaims.max(by:{ $0.value.number < $1.value.number }) {
            let d = winner.key, c = winner.value, key = "\(c.marker)|\(d)"
            if Self.legacyIssued[key] != c.number {
                let b = try await readTerminal(id:c.id,kind:c.kind,key:"kittyBankDigest",filter:d)
                guard b.version >= 3, b.issuedThrough == c.number, b.receiptMarkerID == c.marker else { throw Self.invalid }
                try api.check()
                if Self.legacySession == api.selected.sessionID { Self.legacyIssued[key] = c.number }
            }
            maximum = c.number
        }
        for (digest,id) in posted where privateClaims[digest] == nil {
            let key = "\(id)|\(digest)"
            let number: Int
            if let cached = Self.legacyIssued[key] { number = cached }
            else {
                number = try await GooglePeriodBankJournal.legacyIssuedNumber(digest:digest,id:id,tab:tab,store:self,api:api)
                try api.check()
                if Self.legacySession == api.selected.sessionID { Self.legacyIssued[key] = number }
            }
            if let claimed = issued[digest], claimed != number { throw Self.invalid }
            maximum = max(maximum,number)
        }
        return maximum
    }
    private struct IssuedClaim { let id, kind: String; let number, marker: Int }
    private func issuedReceipts() async throws -> [String:IssuedClaim] {
        let sheetKey = Self.issuedSheet(api.selected.sheetID,api.selected.permissionID)
        let q = "trashed = false and 'me' in owners and appProperties has { key='kittyBankIssuedSheet' and value='\(sheetKey)' }"
        var claims = [String:IssuedClaim](), seen = Set<String>(), page: String?
        repeat {
            var query = ["q":q,"fields":"nextPageToken,incompleteSearch,files(id,appProperties)","spaces":"drive","corpora":"user","pageSize":"1000"]
            if let page { query["pageToken"] = page }
            let result = try json(await drive("/drive/v3/files",query:query,limit:2*1024*1024))
            guard result["incompleteSearch"] as? Bool != true, let records = result["files"] as? [Object] else { throw Self.invalid }
            for r in records {
                guard let id = r["id"] as? String, GoogleConnection.validSheetID(id), let t = r["appProperties"] as? [String:String],
                      t["kittyBankIssuedSheet"] == sheetKey, t["kittyBankKind"] == "receipt",
                      let kind = t["kittyBankTerminal"], ["verified","needs-review"].contains(kind),
                      let d = t["kittyBankDigest"], BankBinding.hash(d), let raw = t["kittyBankIssuedT"], let n = Int(raw),
                      String(n) == raw, (1...99_999_999).contains(n), let m = t["kittyBankIssuedMarker"].flatMap(Int.init),
                      (1...Int(Int32.max)).contains(m), claims[d] == nil else { throw Self.invalid }
                claims[d] = IssuedClaim(id:id,kind:kind,number:n,marker:m)
            }
            page = result["nextPageToken"] as? String
            if let page, !seen.insert(page).inserted || seen.count > 100 { throw Self.invalid }
        } while page != nil
        return claims
    }
    func gate() async throws -> BankBinding? {
        guard let record = try await marker(Self.gateID) else { return nil }
        guard record["metadataKey"] as? String == Self.gateKey,
              record["visibility"] as? String == "DOCUMENT", (record["location"] as? Object)?["spreadsheet"] as? Bool == true,
              let raw = record["metadataValue"] as? String, raw.utf8.count < 4000,
              let b = try? JSONDecoder().decode(BankBinding.self, from: Data(raw.utf8)), try value(b) == raw else { throw Self.invalid }
        return b
    }
    static func tombstone(_ b: BankBinding, id: Int) throws -> Object {
        guard b.valid, (1...Int(Int32.max)).contains(id), id != gateID, b.receiptMarkerID == nil || b.receiptMarkerID == id else { throw invalid }
        return ["metadataId":id,"metadataKey":abandonedKey,"metadataValue":String(decoding:try b.data(),as:UTF8.self),
                "visibility":"DOCUMENT","location":["spreadsheet":true]]
    }
    static func abandonedOwner(_ record: Object?, id: Int) throws -> BankBinding? {
        guard let record, record["metadataKey"] as? String == abandonedKey else { return nil }
        guard PeriodBankAppend.number(record["metadataId"]) == Double(id), record["visibility"] as? String == "DOCUMENT",
              (record["location"] as? Object)?["spreadsheet"] as? Bool == true,
              let raw = record["metadataValue"] as? String, raw.utf8.count < 4000,
              let b = try? JSONDecoder().decode(BankBinding.self,from:Data(raw.utf8)), b.valid,
              (try tombstone(b,id:id))["metadataValue"] as? String == raw else { throw invalid }
        return b
    }
    func fence(_ b: BankBinding, id: Int) async throws -> Object? {
        guard b.owner == api.selected.permissionID, b.sheetID == api.selected.sheetID, try await gate() == b else { throw Self.pending }
        if let existing = try await marker(id) { return existing }
        let stop = try Self.tombstone(b,id:id)
        do { _ = try await api.request(path:":batchUpdate",method:"POST",body:["requests":[["createDeveloperMetadata":["developerMetadata":stop]]]]) }
        catch { try api.check() }
        // Create-only at the *original* permanent ID. A delayed financial batch and the stop cannot both win Google.
        return try await marker(id)
    }
    func acquire(_ b: BankBinding) async throws -> BankBinding {
        let metadata: Object = ["metadataId":Self.gateID, "metadataKey":Self.gateKey,"metadataValue":try value(b),
                                "visibility":"DOCUMENT", "location":["spreadsheet":true]]
        do { _ = try await api.request(path: ":batchUpdate", method: "POST", body: ["requests":[["createDeveloperMetadata":["developerMetadata":metadata]]]]) }
        catch { try api.check() }  // The fixed provider ID arbitrates races. Read the winner even after an ambiguous result.
        guard let held = try await gate() else { throw Self.pending }
        return held
    }
    func release(_ b: BankBinding) async throws {
        guard try await gate() == b else { return }
        let lookup: Object = ["metadataId":Self.gateID,"metadataKey":Self.gateKey,"metadataValue":try value(b),
                              "visibility":"DOCUMENT","metadataLocation":["spreadsheet":true],"locationMatchingStrategy":"EXACT_LOCATION"]
        do { _ = try await api.request(path: ":batchUpdate", method: "POST", body: ["requests":[["deleteDeveloperMetadata":["dataFilter":["developerMetadataLookup":lookup]]]]]) }
        catch { try api.check() }
        if try await gate() == b { throw Self.pending }
    }

    private func properties(_ kind: BankBlob, _ b: BankBinding) throws -> [String: String] {
        ["kittyBankKind":kind.rawValue,"kittyBankDigest":b.digest,"kittyBankScope":try b.scope,"kittyBankIntent":b.manifestID]
    }
    private let fileFields = "id,mimeType,trashed,ownedByMe,owners(permissionId),driveId,permissions(id,type,role,deleted),size,appProperties"
    private func privateFile(_ record: Object, expectedID: String, forRoutingOnly: Bool = false) throws {
        guard record["id"] as? String == expectedID, let trashed = record["trashed"] as? Bool, !trashed || forRoutingOnly, record["ownedByMe"] as? Bool == true,
              record["driveId"] == nil, let owners = record["owners"] as? [Object], owners.count == 1,
              owners[0]["permissionId"] as? String == api.selected.permissionID,
              let acl = record["permissions"] as? [Object], acl.count == 1, acl[0]["type"] as? String == "user",
              acl[0]["role"] as? String == "owner", acl[0]["id"] as? String == api.selected.permissionID,
              acl[0]["deleted"] as? Bool != true else { throw Self.invalid }
    }
    func blob(_ kind: BankBlob, _ b: BankBinding) async throws -> Data? {
        guard b.valid, b.owner == api.selected.permissionID, b.sheetID == api.selected.sheetID else { throw Self.invalid }
        let id = kind.id(b)
        let metadata = try await drive("/drive/v3/files/" + id, query: ["fields":fileFields])
        if metadata.statusCode == 404 { return nil }
        let record = try json(metadata)
        try privateFile(record, expectedID: id)
        guard record["mimeType"] as? String == kind.mime, let size = record["size"] as? String, let n = Int(size),
              (1...kind.limit).contains(n), let tags = record["appProperties"] as? [String:String],
              try properties(kind,b).allSatisfy({ tags[$0.key] == $0.value }) else { throw Self.invalid }
        let media = try await drive("/drive/v3/files/" + id, query: ["alt":"media"], limit: kind.limit)
        guard media.statusCode == 200, media.data.count == n else { throw Self.invalid }
        return media.data
    }
    func create(_ kind: BankBlob, _ b: BankBinding, data: Data) async throws -> (createdHere: Bool, bytes: Data) {
        guard b.valid, b.owner == api.selected.permissionID, b.sheetID == api.selected.sheetID,
              (1...kind.limit).contains(data.count) else { throw Self.invalid }
        if let existing = try await blob(kind,b) { return (false,existing) }
        let id = kind.id(b)
        var tags = try properties(kind,b)
        if kind == .receipt {
            guard let record = try JSONSerialization.jsonObject(with:data) as? Object, let terminal = record["kind"] as? String,
                  ["verified","cancelled","needs-review"].contains(terminal) else { throw Self.invalid }
            tags["kittyBankTerminal"] = terminal
            tags["kittyBankPeriod"] = try b.periodScope
            if terminal == "needs-review" { tags["kittyBankManualSource"] = b.sourceKey }
            if terminal != "cancelled", let n = b.issuedThrough, let id = b.receiptMarkerID {
                tags["kittyBankIssuedSheet"] = Self.issuedSheet(b.sheetID,b.owner)
                tags["kittyBankIssuedT"] = String(n); tags["kittyBankIssuedMarker"] = String(id)
            }
        }
        let meta: Object = ["id":id,"name":kind.name(b),"mimeType":kind.mime,"appProperties":tags]
        let boundary = "kitty-" + UUID().uuidString
        var body = Data("--\(boundary)\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n".utf8)
        body.append(try JSONSerialization.data(withJSONObject: meta))
        body.append(Data("\r\n--\(boundary)\r\nContent-Type: \(kind.mime)\r\n\r\n".utf8)); body.append(data)
        body.append(Data("\r\n--\(boundary)--\r\n".utf8))
        var created = false
        do {
            let response = try await drive("/upload/drive/v3/files", query: ["uploadType":"multipart","ignoreDefaultVisibility":"true","fields":"id"],
                                           body: body, type: "multipart/related; boundary=\(boundary)")
            if (200..<300).contains(response.statusCode) { created = try json(response)["id"] as? String == id }
        } catch { try api.check() }
        // A conflict or lost response can prove the bytes, but can never authorise a second dispatch.
        guard let retained = try await blob(kind,b) else { throw Self.pending }
        return (created,retained)
    }

    func finished(digest: String?, scope: String?) async throws -> BankBinding? {
        let filter = digest ?? scope ?? ""
        guard (digest == nil) != (scope == nil), BankBinding.hash(filter) else { throw Self.invalid }
        if scope != nil { return try await periodHead(filter) }
        return try await findTerminal(key:"kittyBankDigest",filter:filter)
    }
    func manualSource(_ key: String) async throws -> BankBinding? {
        guard BankBinding.hash(key) else { throw Self.invalid }
        return try await findTerminal(key:"kittyBankManualSource",filter:key)
    }
    private func findTerminal(key: String, filter: String) async throws -> BankBinding? {
        let q = "trashed = false and appProperties has { key='kittyBankKind' and value='receipt' } and appProperties has { key='\(key)' and value='\(filter)' }"
        var page: String?, seen = Set<String>(), active = [(String,String)](), cancelled: String?
        repeat {
            var query = ["q":q,"fields":"nextPageToken,incompleteSearch,files(id,appProperties)","spaces":"drive","corpora":"user","pageSize":"100","orderBy":"createdTime desc"]
            if let page { query["pageToken"] = page }
            let result = try json(await drive("/drive/v3/files", query: query))
            guard result["incompleteSearch"] as? Bool != true, let files = result["files"] as? [Object] else { throw Self.invalid }
            for f in files {
                guard let id = f["id"] as? String, let tags = f["appProperties"] as? [String:String] else { throw Self.invalid }
                switch tags["kittyBankTerminal"] {
                case "verified","needs-review": active.append((id,tags["kittyBankTerminal"]!))
                case "cancelled": if cancelled == nil { cancelled = id }
                default: throw Self.invalid
                }
            }
            page = result["nextPageToken"] as? String
            if let page, !seen.insert(page).inserted || seen.count > 100 { throw Self.invalid }
        } while page != nil
        if active.isEmpty {
            guard let cancelled else { return nil }
            return try await readTerminal(id:cancelled,kind:"cancelled",key:key,filter:filter)
        }
        guard active.count == 1 else { throw Self.invalid }
        return try await readTerminal(id:active[0].0,kind:active[0].1,key:key,filter:filter)
    }

    /// Read the owner's app-private receipt index. New records route by hash. Before that index existed,
    /// authenticate the small terminal JSON once per session to learn its period. Names and listing order
    /// are never evidence that the source is new. No historical CSV or manifest is opened for discovery.
    private func periodHead(_ period: String) async throws -> BankBinding? {
        if Self.routeSession != api.selected.sessionID {
            Self.routeSession = api.selected.sessionID; Self.legacyRoutes.removeAll()
        }
        let sheet = Self.issuedSheet(api.selected.sheetID,api.selected.permissionID)
        let q = "'me' in owners and appProperties has { key='kittyBankKind' and value='receipt' }"
        var page: String?, pages = Set<String>(), ids = Set<String>(), active = [(String,BankBinding)](), cancelled: BankBinding?
        repeat {
            var query = ["q":q,"fields":"nextPageToken,incompleteSearch,files(id,trashed,appProperties)",
                         "spaces":"drive","corpora":"user","pageSize":"1000","orderBy":"createdTime desc"]
            if let page { query["pageToken"] = page }
            let data = try json(await drive("/drive/v3/files",query:query,limit:2*1024*1024))
            guard data["incompleteSearch"] as? Bool != true, let files = data["files"] as? [Object] else { throw Self.invalid }
            for file in files {
                guard let id = file["id"] as? String, GoogleConnection.validSheetID(id), ids.insert(id).inserted,
                      let trashed = file["trashed"] as? Bool, let tags = file["appProperties"] as? [String:String],
                      tags["kittyBankKind"] == "receipt" else { throw Self.invalid }
                if let claim = tags["kittyBankIssuedSheet"] {
                    guard BankBinding.hash(claim), claim == sheet || tags["kittyBankPeriod"] != period else { throw Self.invalid }
                    if claim != sheet { continue }
                }
                guard let kind = tags["kittyBankTerminal"], ["verified","needs-review","cancelled"].contains(kind),
                      let digest = tags["kittyBankDigest"], BankBinding.hash(digest), let approval = tags["kittyBankScope"],
                      BankBinding.hash(approval), let intent = tags["kittyBankIntent"], GoogleConnection.validSheetID(intent) else { throw Self.invalid }
                let cacheKey = [id,digest,approval,intent,kind].joined(separator:"|")
                let indexed = tags["kittyBankPeriod"]
                if let indexed { guard BankBinding.hash(indexed) else { throw Self.invalid } }
                if trashed && kind == "cancelled" { continue }
                if let route = indexed ?? Self.legacyRoutes[cacheKey], route != period { continue }
                let b = try await readTerminal(id:id,kind:kind,key:"kittyBankDigest",filter:digest,forRoutingOnly:true,listedTags:tags,listedTrashed:trashed)
                let actualPeriod = try b.periodScope
                if indexed == nil, Self.routeSession == api.selected.sessionID { Self.legacyRoutes[cacheKey] = actualPeriod }
                guard actualPeriod == period else { continue }
                guard !trashed, b.sheetID == api.selected.sheetID, b.owner == api.selected.permissionID else { throw Self.invalid }
                if kind == "cancelled" {
                    if cancelled == nil { cancelled = b }
                } else { active.append((kind,b)) }
            }
            guard data["nextPageToken"] == nil || data["nextPageToken"] is String else { throw Self.invalid }
            page = data["nextPageToken"] as? String
            if let page, page.isEmpty || !pages.insert(page).inserted || pages.count > 100 { throw Self.invalid }
        } while page != nil
        return try Self.latest(active) ?? cancelled
    }

    /// A scope has one verified original followed by zero or more separately approved replacements.
    /// Listing order and file dates cannot decide which one is authoritative. Gaps and forks stay unresolved.
    static func latest(_ records: [(String,BankBinding)]) throws -> BankBinding? {
        if records.isEmpty { return nil }
        let roots = records.filter { $0.1.replacesTicket == nil }
        if roots.count > 1 {
            throw GoogleSheetTools.Failure(code:"import_needs_review",message:"There are separate bank receipts for this file, account and month. Check the receipts and Entries before making corrections.")
        }
        guard roots.count == 1, Set(records.map { $0.1.ticket }).count == records.count else { throw invalid }
        var current = roots[0], visited = Set([current.1.ticket]), children = [String:(String,BankBinding)]()
        let scope = try current.1.periodScope
        for child in records where child.1.replacesTicket != nil {
            guard child.1.valid, try child.1.periodScope == scope, let parent = child.1.replacesTicket,
                  children.updateValue(child,forKey:parent) == nil else { throw invalid }
        }
        while let child = children[current.1.ticket] {
            guard current.0 == "verified", child.1.digest != current.1.digest, visited.insert(child.1.ticket).inserted else { throw invalid }
            if let prior = current.1.issuedThrough {
                guard let end = child.1.issuedThrough, end-child.1.rowCount >= prior else { throw invalid }
            }
            current = child
        }
        guard visited.count == records.count else { throw invalid }
        return current.1
    }
    private func readTerminal(id: String, kind: String, key: String, filter: String, forRoutingOnly: Bool = false,
                              listedTags: [String:String]? = nil, listedTrashed: Bool? = nil) async throws -> BankBinding {
        guard GoogleConnection.validSheetID(id) else { throw Self.invalid }
        let metadata = try json(await drive("/drive/v3/files/" + id, query: ["fields":fileFields]))
        try privateFile(metadata,expectedID:id,forRoutingOnly:forRoutingOnly)
        guard let tags = metadata["appProperties"] as? [String:String], listedTags == nil || tags == listedTags,
              listedTrashed == nil || metadata["trashed"] as? Bool == listedTrashed,
              metadata["mimeType"] as? String == BankBlob.receipt.mime, let rawSize = metadata["size"] as? String,
              let size = Int(rawSize), (1...BankBlob.receipt.limit).contains(size) else { throw Self.invalid }
        let response = try await drive("/drive/v3/files/" + id, query: ["alt":"media"], limit: BankBlob.receipt.limit)
        guard response.statusCode == 200, let record = try JSONSerialization.jsonObject(with: response.data) as? Object,
              record["kind"] as? String == kind, let binding = record["binding"] as? Object else { throw Self.invalid }
        let b = try JSONDecoder().decode(BankBinding.self, from: JSONSerialization.data(withJSONObject: binding))
        let expected: String
        switch key {
        case "kittyBankDigest": expected = b.digest
        case "kittyBankManualSource":
            guard record["kind"] as? String == "needs-review" else { throw Self.invalid }
            expected = b.sourceKey
        default: throw Self.invalid
        }
        if let period = tags["kittyBankPeriod"], try b.periodScope != period { throw Self.invalid }
        guard b.valid, b.receiptID == id, b.owner == api.selected.permissionID, (b.sheetID == api.selected.sheetID || forRoutingOnly),
              expected == filter, size == response.data.count,
              tags["kittyBankTerminal"] == kind, try properties(.receipt,b).allSatisfy({ tags[$0.key] == $0.value }) else { throw Self.invalid }
        if b.version >= 3, kind != "cancelled" {
            guard let n = b.issuedThrough, let marker = b.receiptMarkerID, tags["kittyBankIssuedT"] == String(n),
                  tags["kittyBankIssuedMarker"] == String(marker), tags["kittyBankIssuedSheet"] == Self.issuedSheet(b.sheetID,b.owner) else { throw Self.invalid }
        }
        return b
    }
}
