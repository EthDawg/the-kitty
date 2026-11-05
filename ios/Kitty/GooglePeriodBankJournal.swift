import Foundation

/// An immutable review, original, one-shot dispatch/cancel decision and terminal receipt, all in the user's Drive.
/// The Sheet's fixed-ID hold serialises Kitty importers. The append's distinct permanent marker fences the actual write.
@MainActor
final class GooglePeriodBankJournal: PeriodBankJournal {
    typealias Object = [String: Any]
    typealias Replan = (SourceDocument, String, String, String) async throws -> PeriodBankAppend
    typealias Observe = (PeriodBankAppend, GoogleSheetSelection.Verified, GoogleSheetTools) async throws -> PeriodBankAppend.Observation

    enum Phase: String { case prepared, dispatched, verified, cancelled, otherPending, needsReview, removed }
    enum Evidence: String { case current, recategorised, changed }
    struct Status {
        let phase: Phase, evidence: Evidence
        let ticket, digest, originalSHA256, account, month, downloadDay: String
        let rowCount: Int
        let removedIDFloor, pendingIDFloor: Int
        let canReleaseForReview, manuallyClosed: Bool
        var canDiscard: Bool { phase == .prepared || phase == .dispatched }
        fileprivate init(_ phase: Phase, _ b: BankBinding, _ evidence: Evidence = .current,
                         canReleaseForReview: Bool = false, manuallyClosed: Bool = false, removedIDFloor: Int = 0) {
            self.phase = phase; self.evidence = evidence
            self.canReleaseForReview = canReleaseForReview; self.manuallyClosed = manuallyClosed
            self.removedIDFloor = phase == .removed ? removedIDFloor : 0
            self.pendingIDFloor = (phase == .prepared || phase == .dispatched) ? b.issuedThrough.map { $0 - b.rowCount } ?? 0 : 0
            let reveal = phase != .otherPending
            ticket = reveal ? b.ticket : ""; digest = reveal ? b.digest : ""; originalSHA256 = reveal ? b.sourceSHA256 : ""
            account = reveal ? b.account : ""; month = reveal ? b.month : ""; downloadDay = reveal ? b.downloadDay : ""; rowCount = reveal ? b.rowCount : 0
        }
    }
    private let api: GoogleSheetTools
    private let store: BankStore
    private let original: SourceDocument
    private let plan: Object
    private let month, downloadDay: String
    private let expectedTicket, replacesTicket: String?
    private let planner: Replan
    private let observation: Observe
    private var binding: BankBinding?

    convenience init(api: GoogleSheetTools, original: SourceDocument, plan: Object, month: String, downloadDay: String,
                     expectedTicket: String? = nil, replacesTicket: String? = nil, replan: @escaping Replan) {
        self.init(api: api, store: GoogleBankStore(api: api), original: original, plan: plan,
                  month: month, downloadDay: downloadDay, expectedTicket:expectedTicket,replacesTicket:replacesTicket,replan: replan)
    }
    init(api: GoogleSheetTools, store: BankStore, original: SourceDocument, plan: Object, month: String,
         downloadDay: String, expectedTicket: String? = nil, replacesTicket: String? = nil,
         observe: @escaping Observe = PeriodBankReadback.read, replan: @escaping Replan) {
        self.api = api; self.store = store; self.original = original; self.plan = plan
        self.month = month; self.downloadDay = downloadDay; self.expectedTicket = expectedTicket; self.replacesTicket = replacesTicket
        self.planner = replan; self.observation = observe
    }
    private static func encode(_ object: Object) throws -> Data {
        guard JSONSerialization.isValidJSONObject(object) else { throw GoogleBankStore.invalid }
        return try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys,.withoutEscapingSlashes])
    }
    private static func record(_ kind: String, _ b: BankBinding) throws -> Data {
        try encode(["kind":kind,"binding":b.object])
    }
    private static func fencedReceipt(_ b: BankBinding, id: Int) throws -> Data {
        try encode(["kind":"cancelled","binding":b.object,"abandonedMarkerID":id])
    }
    private static func manualReceipt(_ b: BankBinding, id: Int, tab: Int) throws -> Data {
        try encode(["kind":"needs-review","binding":b.object,"postedMarkerID":id,"entriesTabID":tab])
    }
    private static func manualTab(_ bytes: Data?, _ b: BankBinding, id: Int) throws -> Int? {
        guard let bytes else { return nil }
        guard let value = try JSONSerialization.jsonObject(with:bytes) as? Object else { throw GoogleBankStore.invalid }
        guard value["kind"] as? String == "needs-review" else { return nil }
        guard let tab = PeriodBankAppend.number(value["entriesTabID"]).flatMap(Int.init(exactly:)), tab >= 0,
              bytes == (try manualReceipt(b,id:id,tab:tab)) else { throw GoogleBankStore.invalid }
        return tab
    }
    private static func posted(_ marker: Object?, _ b: BankBinding, id: Int, tab: Int) -> Bool {
        guard let marker, let location = marker["location"] as? Object else { return false }
        return PeriodBankAppend.number(marker["metadataId"]) == Double(id) && marker["metadataKey"] as? String == PeriodBankAppend.guardKey &&
            marker["metadataValue"] as? String == b.digest && marker["visibility"] as? String == "DOCUMENT" &&
            location["spreadsheet"] == nil && location["dimensionRange"] == nil &&
            (location["locationType"] == nil || location["locationType"] as? String == "SHEET") &&
            PeriodBankAppend.number(location["sheetId"]) == Double(tab)
    }
    private static func checked(_ b: BankBinding, owner: GoogleSheetSelection.Verified, api: GoogleSheetTools) throws {
        try api.check()
        guard b.valid, b.sheetID == api.selected.sheetID, b.owner == api.selected.permissionID,
              owner.selection == api.selected else { throw GoogleBankStore.invalid }
    }
    private func resolved(_ batch: PeriodBankAppend, _ owner: GoogleSheetSelection.Verified) throws -> BankBinding {
        guard let b = binding, batch.digest == b.digest, batch.originalSHA256 == b.sourceSHA256, batch.account == b.account,
              batch.sheetID == b.sheetID, batch.rows.count == b.rowCount else { throw GoogleBankStore.invalid }
        try Self.checked(b, owner: owner, api: api)
        return b
    }
    private static func action(_ b: BankBinding, store: BankStore) async throws -> Phase {
        guard let bytes = try await store.blob(.action,b) else { return .prepared }
        if bytes == (try record("dispatch",b)) { return .dispatched }
        if bytes == (try record("cancel",b)) { return .cancelled }
        throw GoogleBankStore.invalid
    }
    private static func restore(_ b: BankBinding, store: BankStore) async throws -> (SourceDocument, PeriodBankAppend) {
        guard let bytes = try await store.blob(.original,b), SourceDocument.sha256(bytes) == b.sourceSHA256,
              let data = try await store.blob(.manifest,b), let saved = try JSONSerialization.jsonObject(with: data) as? Object,
              saved["kind"] as? String == "reviewed", let value = saved["binding"] as? Object,
              try encode(value) == b.data(), let name = saved["originalName"] as? String, !name.isEmpty, name.utf8.count <= 1024,
              let plan = saved["plan"] as? Object else { throw GoogleBankStore.invalid }
        let source = SourceDocument(name: name, mimeType: "text/csv", bytes: bytes)
        let restored = try PeriodBankAppend.restoredPlan(plan,amountEncoding:saved["amountEncoding"])
        let batch = try PeriodBankAppend(plan: restored, sheetID: b.sheetID, account: b.account, original: source,
                                        originalSHA256: b.sourceSHA256).usingMarkerID(b.receiptMarkerID,recordsIssuedIDs:b.version >= 3)
        guard batch.digest == b.digest, batch.rows.count == b.rowCount,
              b.issuedThrough == nil || batch.lastTransactionNumber == b.issuedThrough else { throw GoogleBankStore.invalid }
        return (source,batch)
    }
    private static func markerID(_ b: BankBinding, store: BankStore) async throws -> Int {
        if let pinned = b.receiptMarkerID { return pinned }
        return try await restore(b,store:store).1.markerID
    }
    func authorizedBatch(_ batch: PeriodBankAppend, owner: GoogleSheetSelection.Verified) throws -> PeriodBankAppend {
        let b = try resolved(batch,owner)
        return try batch.usingMarkerID(b.receiptMarkerID,recordsIssuedIDs:b.version >= 3)
    }
    static func legacyIssuedNumber(digest: String, id: Int, tab: Int, store: BankStore, api: GoogleSheetTools) async throws -> Int {
        let active = try await store.gate()
        let candidate: BankBinding?
        if active?.digest == digest { candidate = active }
        else { candidate = try await store.finished(digest:digest,scope:nil) }
        guard let b = candidate, b.valid, b.digest == digest, b.sheetID == api.selected.sheetID,
              b.owner == api.selected.permissionID, try await action(b,store:store) == .dispatched else { throw GoogleBankStore.invalid }
        if active != b {
            guard let terminal = try await store.blob(.receipt,b) else { throw GoogleBankStore.invalid }
            let verified = try record("verified",b), manual = try manualTab(terminal,b,id:id)
            guard terminal == verified || manual == tab else { throw GoogleBankStore.invalid }
        }
        if b.version >= 3, let last = b.issuedThrough, b.receiptMarkerID == id { return last }
        let (_,batch) = try await restore(b,store:store)
        guard batch.markerID == id else { throw GoogleBankStore.invalid }
        return batch.lastTransactionNumber
    }
    private static func allRemoved(_ old: PeriodBankAppend, store: BankStore) async throws -> Bool {
        let rows = try await store.currentEntryFacts()
        let oldIDs = Set(old.rows.map(\.id))
        var seen = Set<String>()
        for row in rows {
            guard let id = row.first as? String, !id.isEmpty, id == id.trimmingCharacters(in:.whitespacesAndNewlines),
                  seen.insert(id).inserted else { throw GoogleBankStore.invalid }
            if oldIDs.contains(id.uppercased()) { return false }
        }
        return try !old.hasSourceMovement(in:rows)
    }
    private static func approveReplacement(_ previous: BankBinding, ticket: String, batch: PeriodBankAppend,
                                           owner: GoogleSheetSelection.Verified, api: GoogleSheetTools, store: BankStore, observe: Observe) async throws {
        try checked(previous,owner:owner,api:api)
        guard previous.ticket == ticket, previous.digest != batch.digest, previous.sourceSHA256 == batch.originalSHA256,
              previous.account == batch.account, try await action(previous,store:store) == .dispatched,
              try await store.blob(.receipt,previous) == record("verified",previous) else { throw GoogleBankStore.pending }
        let (_,old) = try await restore(previous,store:store)
        let seen = try await observe(old,owner,api)
        guard try old.inspectReceipt(seen,historical:true) == .changed,
              Set(seen.ids).isDisjoint(with:old.rows.map(\.id)), try await allRemoved(old,store:store),
              batch.lastTransactionNumber - batch.rows.count >= old.lastTransactionNumber,
              batch.hasSameSourceRows(as:old) else { throw GoogleBankStore.pending }
    }
    private func availableMarker(for batch: PeriodBankAppend, candidate: BankBinding, owner: GoogleSheetSelection.Verified) async throws -> Int {
        let defaultID = batch.markerID
        guard defaultID != GoogleBankStore.gateID else { throw GoogleBankStore.invalid }
        guard let occupied = try await store.marker(defaultID) else { return defaultID }
        if let old = try GoogleBankStore.abandonedOwner(occupied,id:defaultID) {
            try Self.checked(old,owner:owner,api:api)
            guard try await Self.action(old,store:store) == .dispatched,
                  try await Self.markerID(old,store:store) == defaultID,
                  try await store.blob(.receipt,old) == Self.fencedReceipt(old,id:defaultID) else { throw GoogleBankStore.invalid }
        } else {
            try await checkDeletedPosting(occupied,id:defaultID,batch:batch,owner:owner)
        }
        // Preserve the prior permanent marker. Only this newly generated, vacant ID can authorise the new batch.
        let hex = SourceDocument.sha256(Data(("kitty.period.bank.generation.v1\u{0}" + candidate.ticket).utf8))
        guard let n = Int(hex.prefix(8),radix:16) else { throw GoogleBankStore.invalid }
        let alternative = n & 0x7fff_ffff
        guard alternative > 0, alternative != defaultID, alternative != GoogleBankStore.gateID,
              try await store.marker(alternative) == nil else { throw GoogleBankStore.pending }
        return alternative
    }
    private func checkDeletedPosting(_ marker: Object, id: Int, batch: PeriodBankAppend, owner: GoogleSheetSelection.Verified) async throws {
        let conflict = GoogleSheetTools.Failure(code:"import_marker_conflict",message:"An earlier import used this entry ID. Check Entries and the original receipt before importing.")
        guard marker["metadataKey"] as? String == PeriodBankAppend.guardKey, let digest = marker["metadataValue"] as? String,
              BankBinding.hash(digest), let old = try await store.finished(digest:digest,scope:nil),
              old.digest == digest, old.sourceSHA256 != batch.originalSHA256 else { throw conflict }
        try Self.checked(old,owner:owner,api:api)
        guard try await Self.action(old,store:store) == .dispatched, let terminal = try await store.blob(.receipt,old) else { throw conflict }
        let (_,prior) = try await Self.restore(old,store:store)
        let verified = try Self.record("verified",old), manual = try Self.manualTab(terminal,old,id:id)
        guard prior.markerID == id, terminal == verified || manual != nil else { throw conflict }
        if manual != nil, try await store.manualSource(old.sourceKey) != old { throw conflict }

        let metadata = try await api.request(query:["ranges":"Entries!A1","fields":"spreadsheetId,sheets(properties(sheetId,title))"])
        guard metadata["spreadsheetId"] as? String == batch.sheetID, let tabs = metadata["sheets"] as? [Object], tabs.count == 1,
              let properties = tabs[0]["properties"] as? Object, properties["title"] as? String == "Entries",
              let tab = PeriodBankAppend.number(properties["sheetId"]).flatMap(Int.init(exactly:)), tab >= 0,
              manual == nil || manual == tab, Self.posted(marker,old,id:id,tab:tab) else { throw conflict }

        // Bounded full-height reads reject a truncated range. Check all IDs, including those moved away from the old slot.
        let grids = try await PeriodBankPlanner.freshGrids(ranges:["entries":"Entries!A1:A","decisions":"Decisions!A1:C"],api:api)
        guard let entries = grids["entries"], entries.first as? [String] == ["Entry ID"], let decisions = grids["decisions"] else { throw api.invalid }
        let ids = Set((prior.rows + batch.rows).map(\.id))
        let tidy: (String) -> String = { $0.trimmingCharacters(in:.whitespacesAndNewlines).uppercased() }
        for row in entries.dropFirst() {
            if row.isEmpty { continue }
            guard row.count == 1, let entry = row[0] as? String, !tidy(entry).hasPrefix("#") else { throw api.invalid }
            if ids.contains(tidy(entry)) { throw conflict }
        }
        let header = ["Decision ID","Ref kind","Ref ID"]
        guard decisions.filter({ $0 as? [String] == header }).count == 1 else { throw api.invalid }
        for row in decisions where row.count >= 2 {
            guard let kind = row[1] as? String, !tidy(kind).hasPrefix("#") else { throw api.invalid }
            if tidy(kind) == "ENTRY" {
                guard row.count == 3, let ref = row[2] as? String, !tidy(ref).isEmpty, !tidy(ref).hasPrefix("#") else { throw api.invalid }
                if ids.contains(tidy(ref)) {
                    throw GoogleSheetTools.Failure(code:"import_decision_reference",message:"The Decisions tab still refers to \(tidy(ref)). Restore the original entry or correct that decision’s Ref ID in your Sheet, then refresh the import.")
                }
            }
        }
    }
    private static func persist(_ kind: BankBlob, _ data: Data, _ b: BankBinding, store: BankStore) async throws {
        let saved = try await store.create(kind,b,data:data)
        guard saved.bytes == data else { throw GoogleBankStore.invalid }
    }
    func reserve(_ batch: PeriodBankAppend, owner: GoogleSheetSelection.Verified) async throws -> PeriodBankAppend.Stage {
        try api.check()
        guard owner.selection == api.selected, batch.sheetID == api.selected.sheetID, batch.originalSHA256 == original.id,
              original.isIntact, original.mimeType == "text/csv", !original.name.isEmpty, original.name.utf8.count <= 1024,
              BankBinding.validDateScope(month, downloadDay), replacesTicket.map(BankBinding.hash) != false else { throw GoogleBankStore.invalid }
        let reviewed = try PeriodBankAppend(plan: plan, sheetID: batch.sheetID, account: batch.account, original: original, originalSHA256: batch.originalSHA256)
        guard reviewed.digest == batch.digest, (try Self.encode(plan)).count <= BankBlob.manifest.limit - 8000 else { throw GoogleBankStore.invalid }
        var held = try await store.gate()
        if let expectedTicket, let held, held.ticket != expectedTicket { throw GoogleBankStore.pending }
        if held == nil {
            let fileKey = BankBinding.sourceKey(sheet:batch.sheetID,owner:owner.selection.permissionID,sha:original.id)
            if try await store.manualSource(fileKey) != nil {
                throw GoogleSheetTools.Failure(code:"import_needs_review",message:"This original already reached this Sheet and was closed for manual review. Check the existing entries and receipt.")
            }
            let sourceScope = try BankBinding.scope(sheet:batch.sheetID,owner:owner.selection.permissionID,source:original.id,account:batch.account,month:month,day:downloadDay)
            if let done = try await store.finished(digest:nil,scope:sourceScope) {
                try Self.checked(done, owner: owner, api: api)
                guard done.account == batch.account, done.sourceSHA256 == original.id, done.month == month, done.downloadDay == downloadDay,
                      let terminal = try await store.blob(.receipt,done) else { throw GoogleBankStore.invalid }
                if (try JSONSerialization.jsonObject(with:terminal) as? Object)?["kind"] as? String == "needs-review" {
                    throw GoogleSheetTools.Failure(code:"import_needs_review",message:"This source already reached the Sheet and was closed for manual review. Check its entries and original before making corrections.")
                }
                if terminal == (try Self.record("verified",done)), expectedTicket == nil || expectedTicket == done.ticket {
                    if done.digest == batch.digest {
                        _ = try await Self.restore(done,store:store)
                        binding = done; return .dispatched
                    }
                    guard let replacesTicket else { throw GoogleBankStore.pending }
                    try await Self.approveReplacement(done,ticket:replacesTicket,batch:batch,owner:owner,api:api,store:store,observe:observation)
                } else {
                    let previous = try await Self.reconcile(done,owner:owner,api:api,store:store,observe:observation)
                    guard previous.phase == .cancelled, replacesTicket == nil else { throw GoogleBankStore.invalid }
                }
            } else if replacesTicket != nil { throw GoogleBankStore.pending }
            guard expectedTicket == nil else { throw GoogleBankStore.pending }
            try await store.checkNewWrite(owner)
            let ids = try await store.ids()
            guard ids.count == 4 else { throw GoogleBankStore.invalid }
            var candidate = BankBinding(version: 3, sheetID: batch.sheetID, owner: owner.selection.permissionID,
                                        account: batch.account, sourceSHA256: original.id, digest: batch.digest,
                                        month: month, downloadDay: downloadDay, rowCount: batch.rows.count,
                                        sourceID: ids[0], manifestID: ids[1], actionID: ids[2], receiptID: ids[3])
            candidate.issuedThrough = batch.lastTransactionNumber; candidate.replacesTicket = replacesTicket
            guard batch.lastTransactionNumber - batch.rows.count >= (try await store.issuedTransactionNumber()) else { throw PeriodBankAppend.Failure.staleLedger }
            candidate.receiptMarkerID = try await availableMarker(for:batch,candidate:candidate,owner:owner)
            guard candidate.valid, batch.markerID != GoogleBankStore.gateID else { throw GoogleBankStore.invalid }
            held = try await store.acquire(candidate)
            // A first device can finish and release between our initial receipt search and a delayed hold creation.
            // If it did, cancel only our untouched duplicate hold and verify the receipt it actually wrote.
            if held == candidate, let done = try await store.finished(digest:batch.digest,scope:nil), done != candidate,
               try await store.blob(.receipt,done) == Self.record("verified",done) {
                try Self.checked(done,owner:owner,api:api)
                guard done.sourceSHA256 == original.id, done.account == batch.account, done.month == month,
                      done.downloadDay == downloadDay else { throw GoogleBankStore.invalid }
                let tombstone = try Self.record("cancel",candidate)
                let result = try await store.create(.action,candidate,data:tombstone)
                guard result.bytes == tombstone else { throw GoogleBankStore.pending }
                try await Self.persist(.receipt,Self.record("cancelled",candidate),candidate,store:store)
                try await store.release(candidate)
                _ = try await Self.restore(done,store:store)
                binding = done; return .dispatched
            }
        }
        guard let b = held, b.owner == api.selected.permissionID, b.digest == batch.digest, b.sourceSHA256 == original.id,
              b.account == batch.account, b.month == month, b.downloadDay == downloadDay,
              (b.replacesTicket == replacesTicket || (expectedTicket == b.ticket && replacesTicket == nil)) else { throw GoogleBankStore.pending }
        binding = b
        _ = try resolved(batch,owner)
        switch try await Self.action(b,store:store) {
        case .dispatched:
            _ = try await Self.restore(b,store:store); return .dispatched
        case .prepared:
            try await store.checkNewWrite(owner)
            let manifest = try Self.encode(["kind":"reviewed","binding":b.object,"originalName":original.name,
                                            "amountEncoding":PeriodBankAppend.manifestAmountEncoding,"plan":PeriodBankAppend.planForManifest(plan)])
            guard manifest.count <= BankBlob.manifest.limit else { throw GoogleBankStore.invalid }
            try await Self.persist(.original,original.bytes,b,store:store)
            // On a second device the same original can have a different local name. Rebuild the first accepted manifest.
            if try await store.blob(.manifest,b) == nil { _ = try await store.create(.manifest,b,data:manifest) }
            _ = try await Self.restore(b,store:store)
            return .prepared
        default: throw GoogleBankStore.pending
        }
    }
    func replan(_ batch: PeriodBankAppend, owner: GoogleSheetSelection.Verified) async throws -> PeriodBankAppend {
        let b = try resolved(batch,owner)
        guard try await store.gate() == b, try await Self.action(b,store:store) == .prepared else { throw GoogleBankStore.pending }
        let (archived,_) = try await Self.restore(b,store:store)
        let fresh = try await planner(archived,b.account,b.month,b.downloadDay)
        guard fresh.digest == b.digest else { throw PeriodBankAppend.Failure.staleLedger }
        return fresh
    }
    func markDispatched(_ batch: PeriodBankAppend, owner: GoogleSheetSelection.Verified) async throws {
        let b = try resolved(batch,owner)
        try await store.checkNewWrite(owner)
        guard try await store.gate() == b else { throw GoogleBankStore.pending }
        try await Self.checkIssuance(b,batch:batch,owner:owner,api:api,store:store,observe:observation)
        let bytes = try Self.record("dispatch",b)
        let result = try await store.create(.action,b,data:bytes)
        guard result.createdHere, result.bytes == bytes else { throw GoogleBankStore.pending }
        try api.check()
    }
    private static func checkIssuance(_ b: BankBinding, batch: PeriodBankAppend, owner: GoogleSheetSelection.Verified,
                                      api: GoogleSheetTools, store: BankStore, observe: Observe) async throws {
        guard b.issuedThrough == nil || b.issuedThrough == batch.lastTransactionNumber,
              batch.lastTransactionNumber - batch.rows.count >= (try await store.issuedTransactionNumber()) else { throw PeriodBankAppend.Failure.staleLedger }
        guard try await store.manualSource(b.sourceKey) == nil else { throw GoogleBankStore.pending }
        let head = try await store.finished(digest:nil,scope:b.scope)
        if let wanted = b.replacesTicket {
            guard let head else { throw GoogleBankStore.pending }
            try await approveReplacement(head,ticket:wanted,batch:batch,owner:owner,api:api,store:store,observe:observe)
        } else if let head, head != b {
            // Recheck under the winning hold: a previously queued first confirmation cannot become
            // a second root after another device posted (and the owner subsequently removed) the source.
            guard let bytes = try await store.blob(.receipt,head),
                  (try JSONSerialization.jsonObject(with:bytes) as? Object)?["kind"] as? String == "cancelled" else { throw GoogleBankStore.pending }
        }
    }
    func recordVerified(_ batch: PeriodBankAppend, owner: GoogleSheetSelection.Verified) async throws {
        let b = try resolved(batch,owner)
        guard try await Self.reconcile(b,owner:owner,api:api,store:store,observe:PeriodBankReadback.read,observeIfMissing:true).phase == .verified
        else { throw GoogleBankStore.pending }
    }
    private static func reconcile(_ b: BankBinding, owner: GoogleSheetSelection.Verified, api: GoogleSheetTools,
                                  store: BankStore, observe: Observe, observeIfMissing: Bool = false) async throws -> Status {
        try checked(b,owner:owner,api:api)
        let terminal = try await store.blob(.receipt,b)
        let phase = try await action(b,store:store)
        if phase == .cancelled {
            try await persist(.receipt,record("cancelled",b),b,store:store)
            try await store.release(b)
            return Status(.cancelled,b)
        }
        guard phase == .dispatched else {
            guard terminal == nil else { throw GoogleBankStore.invalid }
            return Status(.prepared,b)
        }
        let id = try await markerID(b,store:store)
        let marker = try await store.marker(id)
        let historical = terminal == (try record("verified",b))
        let abandoned = try fencedReceipt(b,id:id)
        if let tab = try manualTab(terminal,b,id:id) {
            // Before releasing, prove the exact terminal receipt is also discoverable from this original on another device.
            guard posted(marker,b,id:id,tab:tab), try await store.manualSource(b.sourceKey) == b else { return Status(.needsReview,b,.changed) }
            try await store.release(b)
            return Status(.needsReview,b,.changed,manuallyClosed:true)
        }
        guard terminal == nil || historical || terminal == abandoned else { throw GoogleBankStore.invalid }
        if marker?["metadataKey"] as? String == GoogleBankStore.abandonedKey {
            guard let stopped = try? GoogleBankStore.abandonedOwner(marker,id:id), stopped == b, !historical else { return Status(.needsReview,b,.changed) }
            try await persist(.receipt,abandoned,b,store:store)
            try await store.release(b)
            return Status(.cancelled,b)
        }
        if terminal == abandoned { return Status(.needsReview,b,.changed) }
        if let marker, marker["metadataKey"] as? String != PeriodBankAppend.guardKey ||
            marker["metadataValue"] as? String != b.digest || marker["visibility"] as? String != "DOCUMENT" {
            return Status(.needsReview,b,.changed)
        }
        // Status and discard can identify an unoccupied dispatched fence even when the old range is now stale,
        // the grid shrank, or the user no longer has the CSV. Do not present that absence as a successful write.
        if marker == nil && !historical && !observeIfMissing { return Status(.dispatched,b) }
        let (_,batch) = try await restore(b,store:store)
        let seen = try await observe(batch,owner,api)
        switch try batch.inspectReceipt(seen,historical:historical) {
        case .absent: return historical ? Status(.needsReview,b,.changed) : Status(.dispatched,b)
        case .foreign: return Status(.needsReview,b,.changed)
        case .changed:
            // An already verified immutable receipt and its genuine permanent marker fence late packets.
            // Later user edits are visible as a review issue, and don't retain an otherwise completed hold.
            if historical {
                try await store.release(b)
                if Set(seen.ids).isDisjoint(with:batch.rows.map(\.id)), try await allRemoved(batch,store:store) {
                    return Status(.removed,b,.changed,removedIDFloor:batch.lastTransactionNumber)
                }
            }
            return Status(.needsReview,b,.changed,canReleaseForReview:!historical)
        case .recategorised:
            guard historical else { return Status(.needsReview,b,.changed) }
            try await store.release(b)
            return Status(.verified,b,.recategorised)
        case .current:
            if !historical { try await persist(.receipt,record("verified",b),b,store:store) }
            if b.replacesTicket != nil, try await store.gate() == b, try await store.finished(digest:nil,scope:b.scope) != b {
                throw GoogleBankStore.pending // Keep the hold until both devices can discover the authenticated successor.
            }
            try await store.release(b)
            return Status(.verified,b)
        }
    }
    static func status(owner: GoogleSheetSelection.Verified, api: GoogleSheetTools, expectedDigest: String? = nil) async throws -> Status? {
        try await lookup(owner:owner,api:api,store:GoogleBankStore(api:api),digest:expectedDigest,scope:nil,observe:PeriodBankReadback.read)
    }
    static func recover(owner: GoogleSheetSelection.Verified, api: GoogleSheetTools, sourceSHA256: String, account: String,
                        month: String, downloadDay: String) async throws -> Status? {
        guard BankBinding.hash(sourceSHA256), !account.isEmpty, BankBinding.validDateScope(month,downloadDay) else { throw GoogleBankStore.invalid }
        let scope = try BankBinding.scope(sheet:api.selected.sheetID,owner:api.selected.permissionID,source:sourceSHA256,account:account,month:month,day:downloadDay)
        let store = GoogleBankStore(api:api)
        let fileKey = BankBinding.sourceKey(sheet:api.selected.sheetID,owner:api.selected.permissionID,sha:sourceSHA256)
        if let old = try await store.manualSource(fileKey) {
            return try await reconcile(old,owner:owner,api:api,store:store,observe:PeriodBankReadback.read)
        }
        return try await lookup(owner:owner,api:api,store:store,digest:nil,scope:scope,observe:PeriodBankReadback.read)
    }
    /// A fresh human Resume may deliver the *same* immutable atomic batch after an unknown dispatch.
    /// The original and a concurrent retry use the identical permanent metadata ID. Only one can append.
    /// Status/recover never enter this path.
    static func resume(owner: GoogleSheetSelection.Verified, api: GoogleSheetTools, digest: String, ticket: String, replan: @escaping Replan) async throws -> Status {
        try await retry(owner:owner,api:api,store:GoogleBankStore(api:api),digest:digest,ticket:ticket,replan:replan,
                        observe:PeriodBankReadback.read,send:{ requests in
                            _ = try await api.request(path:":batchUpdate",method:"POST",body:["requests":requests])
                        })
    }
    static func retry(owner: GoogleSheetSelection.Verified, api: GoogleSheetTools, store: BankStore, digest: String, ticket: String,
                      replan: Replan, observe: Observe, send: ([Object]) async throws -> Void) async throws -> Status {
        guard BankBinding.hash(digest), BankBinding.hash(ticket), owner.selection == api.selected else { throw GoogleBankStore.invalid }
        guard let b = try await store.gate(), b.digest == digest, b.ticket == ticket, b.owner == api.selected.permissionID else {
            if let done = try await store.finished(digest:digest,scope:nil), done.ticket == ticket {
                return try await reconcile(done,owner:owner,api:api,store:store,observe:observe)
            }
            throw GoogleBankStore.pending
        }
        try checked(b,owner:owner,api:api)
        guard try await action(b,store:store) == .dispatched else { throw GoogleBankStore.pending }
        let status = try await reconcile(b,owner:owner,api:api,store:store,observe:observe)
        guard status.phase == .dispatched else { return status }
        let (archived,batch) = try await restore(b,store:store)
        let first = try await observe(batch,owner,api)
        if case .verified = try batch.next(first,stage:.dispatched) {
            return try await reconcile(b,owner:owner,api:api,store:store,observe:observe)
        }
        try await store.checkNewWrite(owner)
        let refreshed = try await replan(archived,b.account,b.month,b.downloadDay)
        guard refreshed.digest == b.digest, try await store.gate() == b, try await action(b,store:store) == .dispatched else { throw GoogleBankStore.pending }
        try await checkIssuance(b,batch:batch,owner:owner,api:api,store:store,observe:observe)
        let before = try await observe(batch,owner,api)
        switch try batch.next(before,stage:.prepared,freshlyPlanned:refreshed) {
        case .verified: break
        case .waitingForReadback: throw GoogleBankStore.pending
        case .batch(let requests):
            try await store.checkNewWrite(owner)
            try api.check()
            do { try await send(requests) } catch { try api.check() }
        }
        return try await reconcile(b,owner:owner,api:api,store:store,observe:observe,observeIfMissing:true)
    }
    static func lookup(owner: GoogleSheetSelection.Verified, api: GoogleSheetTools, store: BankStore,
                       digest: String?, scope: String?, observe: Observe) async throws -> Status? {
        try api.check()
        guard owner.selection == api.selected, digest.map(BankBinding.hash) != false, scope.map(BankBinding.hash) != false else { throw GoogleBankStore.invalid }
        let active = try await store.gate()
        if let b = active, b.owner == api.selected.permissionID {
            let activeScope = try b.scope
            if (digest == nil || b.digest == digest) && (scope == nil || activeScope == scope) {
                return try await reconcile(b,owner:owner,api:api,store:store,observe:observe)
            }
        }
        if digest != nil || scope != nil, let done = try await store.finished(digest:digest,scope:scope) {
            return try await reconcile(done,owner:owner,api:api,store:store,observe:observe)
        }
        return active.map { Status(.otherPending,$0) }
    }
    static func cancelPrepared(owner: GoogleSheetSelection.Verified, api: GoogleSheetTools, digest: String, ticket: String) async throws -> Status {
        try await cancel(owner:owner,api:api,store:GoogleBankStore(api:api),digest:digest,ticket:ticket,observe:PeriodBankReadback.read)
    }
    static func discard(owner: GoogleSheetSelection.Verified, api: GoogleSheetTools, digest: String, ticket: String) async throws -> Status {
        try await cancel(owner:owner,api:api,store:GoogleBankStore(api:api),digest:digest,ticket:ticket,observe:PeriodBankReadback.read,allowFence:true)
    }
    /// A separate owner decision: a genuine posted marker won, but the approved typed cells cannot be verified.
    /// Persist the unresolved evidence and release only this hold. The source remains blocked from a new import.
    static func releaseForReview(owner: GoogleSheetSelection.Verified, api: GoogleSheetTools, digest: String, ticket: String) async throws -> Status {
        try await closeForReview(owner:owner,api:api,store:GoogleBankStore(api:api),digest:digest,ticket:ticket,observe:PeriodBankReadback.read)
    }
    static func closeForReview(owner: GoogleSheetSelection.Verified, api: GoogleSheetTools, store: BankStore, digest: String,
                               ticket: String, observe: Observe) async throws -> Status {
        guard BankBinding.hash(digest), BankBinding.hash(ticket), owner.selection == api.selected else { throw GoogleBankStore.invalid }
        guard let b = try await store.gate(), b.digest == digest, b.ticket == ticket, b.owner == api.selected.permissionID else {
            if let done = try await store.finished(digest:digest,scope:nil), done.ticket == ticket {
                return try await reconcile(done,owner:owner,api:api,store:store,observe:observe)
            }
            throw GoogleBankStore.pending
        }
        let current = try await reconcile(b,owner:owner,api:api,store:store,observe:observe)
        guard current.canReleaseForReview else { return current }
        let (_,batch) = try await restore(b,store:store)
        let seen = try await observe(batch,owner,api)
        guard try batch.inspectReceipt(seen,historical:false) == .changed,
              posted(try await store.marker(batch.markerID),b,id:batch.markerID,tab:seen.entriesTabID),
              try await store.gate() == b else {
            return try await reconcile(b,owner:owner,api:api,store:store,observe:observe)
        }
        let proposed = try manualReceipt(b,id:batch.markerID,tab:seen.entriesTabID)
        let saved = try await store.create(.receipt,b,data:proposed)
        let verified = try record("verified",b)
        guard saved.bytes == proposed || saved.bytes == verified else { throw GoogleBankStore.invalid }
        return try await reconcile(b,owner:owner,api:api,store:store,observe:observe)
    }
    static func cancel(owner: GoogleSheetSelection.Verified, api: GoogleSheetTools, store: BankStore, digest: String, ticket: String,
                       observe: Observe, allowFence: Bool = false) async throws -> Status {
        guard BankBinding.hash(digest), BankBinding.hash(ticket), owner.selection == api.selected else { throw GoogleBankStore.invalid }
        if let active = try await store.gate(), active.digest == digest, active.ticket == ticket, active.owner == api.selected.permissionID {
            try checked(active,owner:owner,api:api)
            if try await store.blob(.receipt,active) != nil {
                return try await reconcile(active,owner:owner,api:api,store:store,observe:observe)
            }
            let cancel = try record("cancel",active)
            let chosen = try await store.create(.action,active,data:cancel)
            if chosen.bytes != cancel, chosen.bytes != (try record("dispatch",active)) { throw GoogleBankStore.invalid }
            if chosen.bytes != cancel, allowFence, try await store.blob(.receipt,active) == nil {
                let id = try await markerID(active,store:store)
                guard try await store.fence(active,id:id) != nil else { throw GoogleBankStore.pending }
            }
            return try await reconcile(active,owner:owner,api:api,store:store,observe:observe)
        }
        if let done = try await store.finished(digest:digest,scope:nil), done.ticket == ticket {
            return try await reconcile(done,owner:owner,api:api,store:store,observe:observe)
        }
        throw GoogleBankStore.pending
    }
}
