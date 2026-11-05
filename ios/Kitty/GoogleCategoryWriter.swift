import CryptoKit
import Foundation

/// One explicit choice in Review is one category cell and one audit row. Keep the intention
/// before either request; losing a reply, restarting or tapping twice must never duplicate an append.
@MainActor
final class GoogleCategoryWriter {
    typealias Failure = GoogleSheetTools.Failure
    enum Stage: String, Codable { case prepared, updating, updated, appending }
    struct Intent: Codable, Equatable {
        let entry: String, old: String, category: String, row: Int, identity: String
        let decision: [String], header: Int
        var stage: Stage
        var markerID: Int?
        var cell: String { "Entries!H\(row)" }
        var table: String { "Decisions!A\(header):H" }
        var instructions: [String: Any] {
            ["cell":cell, "table":table, "decision":decision, "entry":entry, "category":category]
        }
    }
    private let directory: URL
    private var busy = false
    init(directory: URL? = nil) {
        self.directory = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("KittyCategoryIntents", isDirectory: true)
    }
    private func conflict(_ text: String) -> Failure { Failure(code:"write_conflict", message:text) }
    private var pendingError: Failure { Failure(code:"write_pending", message:"A category save still needs checking. Recheck it in Setup before making another change.") }
    private func file(_ owner: GoogleSheetSelection.Verified) -> URL { directory.appendingPathComponent(owner.preferenceID + ".json") }
    func discardUnsent(_ owner: GoogleSheetSelection.Verified) throws {
        if try pending(owner)?.stage == .prepared { try FileManager.default.removeItem(at:file(owner)) }
    }
    func disconnect(preferenceID: String) {
        guard preferenceID.range(of:"^native-[0-9a-f]{64}$",options:.regularExpression) != nil else { return }
        let url = directory.appendingPathComponent(preferenceID + ".json")
        // An unsent plan can be forgotten. A dispatched change needs its account-bound protected
        // recovery record, including through revocation; another account cannot read or replay it.
        if let bytes = try? Data(contentsOf:url), let intent = try? JSONDecoder().decode(Intent.self,from:bytes), intent.stage == .prepared {
            try? FileManager.default.removeItem(at:url)
        }
    }
    func pending(_ owner: GoogleSheetSelection.Verified) throws -> Intent? {
        let url = file(owner)
        do { return try JSONDecoder().decode(Intent.self, from: Data(contentsOf: url)) }
        catch let e as NSError where e.domain == NSCocoaErrorDomain && e.code == NSFileReadNoSuchFileError { return nil }
        catch { throw pendingError }
    }
    private func save(_ intent: Intent, for owner: GoogleSheetSelection.Verified) throws {
        do {
            var dir = directory
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            var flags = URLResourceValues(); flags.isExcludedFromBackup = true; try dir.setResourceValues(flags)
            try JSONEncoder().encode(intent).write(to: file(owner), options: [.atomic,.completeFileProtection])
        } catch { throw pendingError }
    }
    private func enter(_ owner: GoogleSheetSelection.Verified, _ api: GoogleSheetTools) throws {
        try api.check()
        guard owner.selection == api.selected, owner.canEdit else { throw Failure(code:"not_granted", message:"This Sheet needs editor access.") }
        guard !busy else { throw Failure(code:"busy", message:"Another category save is still being checked.") }
        busy = true
    }
    private let entryHeader = ["Entry ID","Kind","Settled at","Account ID","Raw text","Description","Amount","Category ID"]
    private let decisionHeader = ["Decision ID","Ref kind","Ref ID","Decision","Value","By","At","Note"]
    private func grid(_ api: GoogleSheetTools, _ range: String) async throws -> [[String]] {
        // FORMULA exposes a formula in a target that a displayed/empty value would conceal.
        let value = try await api.values(range, render:"FORMULA")
        return ((value["values"] as? [[Any]]) ?? []).map { $0.map { String(describing:$0) } }
    }
    private func table(_ rows: [[String]], _ header: [String]) throws -> (header: Int, ids: [String: Int]) {
        let headers = rows.indices.filter { Array(rows[$0].prefix(header.count)) == header }
        guard headers.count == 1 else { throw conflict("The Sheet headers have changed. No new write was sent.") }
        let h = headers[0]; var ids = [String:Int]()
        for i in rows.indices where i > h {
            if rows[i].allSatisfy({ $0.isEmpty }) { continue }
            guard let id = rows[i].first, !id.isEmpty, !id.hasPrefix("="), ids.updateValue(i, forKey:id) == nil else {
                throw conflict("A ledger row has a missing or repeated ID. Check the Sheet before saving.")
            }
        }
        return (h, ids)
    }
    private func padded(_ row: [String], to width: Int) -> [String] { Array((row + Array(repeating:"", count:width)).prefix(width)) }
    private func identity(_ raw: [String]) throws -> String {
        let data = try JSONEncoder().encode(Array(padded(raw, to:7)))
        return SHA256.hash(data:data).map { String(format:"%02x",$0) }.joined()
    }
    private func entry(_ i: Intent, _ api: GoogleSheetTools) async throws -> String {
        let rows = try await grid(api, "Entries!A\(i.row):H\(i.row)")
        guard let row = rows.first, row.first == i.entry, try identity(row) == i.identity else {
            throw conflict("This transaction moved or changed. The app stopped without sending another write.")
        }
        return padded(row, to:8)[7]
    }
    private func decisions(_ api: GoogleSheetTools) async throws -> (rows:[[String]], header:Int, ids:[String:Int]) {
        let rows = try await grid(api,"Decisions!A1:H"), t = try table(rows,decisionHeader)
        // Google's append locates a table. An interior blank row would make its destination ambiguous.
        guard !rows.dropFirst(t.header+1).contains(where: { $0.allSatisfy { $0.isEmpty } }) else {
            throw conflict("There is a gap inside Decisions. Check that tab before appending.")
        }
        return (rows,t.header+1,t.ids)
    }
    func prepare(_ owner: GoogleSheetSelection.Verified, api: GoogleSheetTools, id: String, old: String, category: String) async throws -> Intent {
        try enter(owner,api); defer { busy = false }
        if let prior = try pending(owner) {
            if prior.entry == id, prior.category == category { return prior }
            guard prior.stage == .prepared else { throw pendingError }
            try discardUnsent(owner)
        }
        guard !id.isEmpty, id.utf8.count <= 128, !category.isEmpty, category.utf8.count <= 128, category != "UNCAT" else { throw api.invalid }
        let rows = try await grid(api,"Entries!A1:H"), ledger = try table(rows,entryHeader)
        guard let n = ledger.ids[id] else { throw conflict("This transaction is no longer on the Sheet.") }
        let row = padded(rows[n],to:8)
        guard row[1].lowercased() == "transaction", row[7] == old, !old.hasPrefix("=") else { throw conflict("This category changed. Refresh before choosing again.") }
        let categories = try table(try await grid(api,"Categories!A1:A"), ["Category ID"])
        guard categories.ids[category] != nil else { throw conflict("That category is no longer on the Sheet.") }
        let audit = try await decisions(api)
        guard !audit.rows.dropFirst(audit.header).contains(where:{ r in r.count >= 4 && r[1] == "entry" && r[2] == id && ["categorise","confirm","merge_duplicate","match_transfer","split"].contains(r[3]) }) else {
            throw conflict("This entry was already reviewed. Refresh to see the saved decision.")
        }
        let decisionID = "D-" + UUID().uuidString.lowercased()
        let today = GoogleSheetDay.name(zone:owner.timeZone)
        let intent = Intent(entry:id, old:old, category:category, row:n+1, identity:try identity(row),
                            decision:[decisionID,"entry",id,"categorise",category,"The Kitty on iPhone",today,""],
                            header:audit.header, stage:.prepared)
        try api.check(); try save(intent,for:owner); return intent
    }
    func run(_ tool: String, input: [String:Any], owner: GoogleSheetSelection.Verified, api: GoogleSheetTools) async throws -> [String:Any] {
        try enter(owner,api); defer { busy = false }
        guard input["spreadsheetId"] as? String == owner.selection.sheetID,
              var i = try pending(owner), let rows = input["values"] as? [[String]] else { throw pendingError }
        let range = input["range"] as? String
        var result: [String:Any]
        switch tool {
        case "update_values":
            guard range == i.cell, rows == [[i.category]] else { throw api.invalid }
            do {
                let was = try await entry(i,api)
                if i.stage == .prepared || i.stage == .updating {
                    guard was == i.old || (i.stage == .updating && was == i.category) else { throw conflict("The original category changed before saving.") }
                    if was != i.category {
                        // Only an explicit recheck can repeat this idempotent PUT, after verifying
                        // the same transaction fingerprint and unchanged original category.
                        do { _ = try await api.updateValue(i.cell,to:i.category,beforeSend:{
                            i.stage = .updating; try self.save(i,for:owner)
                        }) } catch { try api.check(); if i.stage == .prepared { throw error } }
                    }
                }
            } catch {
                if i.stage == .prepared { try discardUnsent(owner) }
                throw error
            }
            guard try await entry(i,api) == i.category else { throw pendingError }
            if i.stage != .appending { i.stage = .updated; try save(i,for:owner) }
            result = ["spreadsheetId":api.selected.sheetID, "updatedRange":i.cell, "updatedRows":1, "updatedColumns":1, "updatedCells":1]
        case "append_values":
            guard range == i.table, rows == [i.decision], [.updated,.appending].contains(i.stage) else { throw api.invalid }
            guard try await entry(i,api) == i.category else { throw conflict("The saved category changed before its decision could be verified.") }
            var audit = try await decisions(api)
            guard audit.header == i.header else { throw conflict("The Decisions header moved. The app stopped.") }
            if audit.ids[i.decision[0]] == nil {
                // An older development build didn't use server idempotency. Never replay an
                // already-dispatched legacy append with no guard. Its existing row is still verifiable.
                if i.stage == .appending && i.markerID == nil { throw pendingError }
                // A different device may have reviewed this entry between prepare and append.
                guard !audit.rows.dropFirst(audit.header).contains(where: { $0.count >= 4 && $0[1] == "entry" && $0[2] == i.entry && ["categorise","confirm","merge_duplicate","match_transfer","split"].contains($0[3]) }) else { throw conflict("Another review appeared. Check the Sheet.") }
                let slot = try await api.decisionSlot(i.table,at:audit.rows.count+1)
                guard let sheet = slot["sheetId"] else { throw api.invalid }
                let guardKey = try await api.appendGuard(for:i.decision[0],preferred:i.markerID,sheet:sheet,existing:audit.rows)
                do { _ = try await api.appendDecision(slot,row:i.decision,guardKey:guardKey,beforeSend:{
                    i.markerID = guardKey.id; i.stage = .appending; try self.save(i,for:owner)
                }) } catch { try api.check(); if i.stage != .appending { throw error } }
                audit = try await decisions(api)
            }
            guard let n = audit.ids[i.decision[0]],
                  !(audit.rows.dropFirst(n+1).contains { $0.count >= 4 && $0[1] == "entry" && $0[2] == i.entry && ["categorise","confirm","merge_duplicate","match_transfer","split"].contains($0[3]) }),
                  try await entry(i,api) == i.category else { throw pendingError }
            try await verifyRecord(i.decision,at:n+1,api:api)
            try api.check()
            try FileManager.default.removeItem(at:file(owner))
            result = ["spreadsheetId":api.selected.sheetID, "updates":["spreadsheetId":api.selected.sheetID,
                "updatedRange":"Decisions!A\(n+1):H\(n+1)", "updatedRows":1, "updatedColumns":8, "updatedCells":8]]
        default: throw api.invalid
        }
        return ["payload":result, "cache":["storedAt":Int64(Date().timeIntervalSince1970*1000)]]
    }

    func verifyRecord(_ decision: [String], at row: Int, api: GoogleSheetTools) async throws {
        guard decision.count == 8, row > 1, let serial = GoogleSheetDay.serial(decision[6]) else { throw api.invalid }
        let value = try await api.values("Decisions!A\(row):J\(row)",render:"UNFORMATTED_VALUE")
        guard let rows = value["values"] as? [[Any]], rows.count == 1, let r = rows.first, r.count == 10,
              [0,1,2,3,4,5,7].allSatisfy({ (r[$0] as? String) == decision[$0] }),
              let day = r[6] as? NSNumber, day.doubleValue == Double(serial),
              let latest = r[8] as? NSNumber, CFGetTypeID(latest) == CFBooleanGetTypeID(), latest.boolValue,
              r[9] as? String == decision[2] + "|" + decision[3] else {
            throw Failure(code:"write_pending",message:"The Sheet has not confirmed this decision as Latest with the expected date and Key. Do not submit it again.")
        }
    }
}
