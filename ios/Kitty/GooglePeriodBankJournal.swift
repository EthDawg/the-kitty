import Foundation

/// An immutable review, original, one-shot dispatch/cancel decision and terminal receipt, all in the user's Drive.
/// The Sheet's fixed-ID hold serialises Kitty importers. The append's distinct permanent marker fences the actual write.
@MainActor
final class GooglePeriodBankJournal: PeriodBankJournal {
    typealias Object = [String: Any]
    typealias Replan = (SourceDocument, String, String, String) async throws -> PeriodBankAppend
    typealias Observe = (PeriodBankAppend, GoogleSheetSelection.Verified, GoogleSheetTools) async throws -> PeriodBankAppend.Observation

    enum Phase: String { case prepared, dispatched, verified, cancelled, otherPending }
    struct Status {
        var phase: Phase
        let ticket, digest, originalSHA256, account, month, downloadDay: String
        let rowCount: Int
        fileprivate init(_ phase: Phase, _ b: BankBinding) {
            self.phase = phase
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
    private let expectedTicket: String?
    private let planner: Replan
    private var binding: BankBinding?

    convenience init(api: GoogleSheetTools, original: SourceDocument, plan: Object, month: String, downloadDay: String,
                     expectedTicket: String? = nil, replan: @escaping Replan) {
        self.init(api: api, store: GoogleBankStore(api: api), original: original, plan: plan,
                  month: month, downloadDay: downloadDay, expectedTicket:expectedTicket, replan: replan)
    }
    init(api: GoogleSheetTools, store: BankStore, original: SourceDocument, plan: Object, month: String,
         downloadDay: String, expectedTicket: String? = nil, replan: @escaping Replan) {
        self.api = api; self.store = store; self.original = original; self.plan = plan
        self.month = month; self.downloadDay = downloadDay; self.expectedTicket = expectedTicket; self.planner = replan
    }
    private static func encode(_ object: Object) throws -> Data {
        guard JSONSerialization.isValidJSONObject(object) else { throw GoogleBankStore.invalid }
        return try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys,.withoutEscapingSlashes])
    }
    private static func record(_ kind: String, _ b: BankBinding) throws -> Data {
        try encode(["kind":kind,"binding":b.object])
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
        let batch = try PeriodBankAppend(plan: plan, sheetID: b.sheetID, account: b.account, original: source, originalSHA256: b.sourceSHA256)
        guard batch.digest == b.digest, batch.rows.count == b.rowCount else { throw GoogleBankStore.invalid }
        return (source,batch)
    }
    private static func persist(_ kind: BankBlob, _ data: Data, _ b: BankBinding, store: BankStore) async throws {
        let saved = try await store.create(kind,b,data:data)
        guard saved.bytes == data else { throw GoogleBankStore.invalid }
    }
    func reserve(_ batch: PeriodBankAppend, owner: GoogleSheetSelection.Verified) async throws -> PeriodBankAppend.Stage {
        try api.check()
        guard owner.selection == api.selected, batch.sheetID == api.selected.sheetID, batch.originalSHA256 == original.id,
              original.isIntact, original.mimeType == "text/csv", !original.name.isEmpty, original.name.utf8.count <= 1024,
              BankBinding.validDateScope(month, downloadDay) else { throw GoogleBankStore.invalid }
        let reviewed = try PeriodBankAppend(plan: plan, sheetID: batch.sheetID, account: batch.account, original: original, originalSHA256: batch.originalSHA256)
        guard reviewed.digest == batch.digest, (try Self.encode(plan)).count <= BankBlob.manifest.limit - 8000 else { throw GoogleBankStore.invalid }
        var held = try await store.gate()
        if let expectedTicket, let held, held.ticket != expectedTicket { throw GoogleBankStore.pending }
        if held == nil {
            if let done = try await store.finished(digest: batch.digest, scope: nil) {
                try Self.checked(done, owner: owner, api: api)
                guard done.account == batch.account, done.sourceSHA256 == original.id, done.month == month, done.downloadDay == downloadDay,
                      let terminal = try await store.blob(.receipt,done) else { throw GoogleBankStore.invalid }
                if terminal == (try Self.record("verified",done)), expectedTicket == nil || expectedTicket == done.ticket {
                    _ = try await Self.restore(done,store:store)
                    binding = done; return .dispatched
                }
                guard terminal == (try Self.record("cancelled",done)), try await Self.action(done,store:store) == .cancelled
                else { throw GoogleBankStore.invalid }
            }
            guard expectedTicket == nil else { throw GoogleBankStore.pending }
            try await store.checkNewWrite(owner)
            let ids = try await store.ids()
            guard ids.count == 4 else { throw GoogleBankStore.invalid }
            let candidate = BankBinding(version: 1, sheetID: batch.sheetID, owner: owner.selection.permissionID,
                                        account: batch.account, sourceSHA256: original.id, digest: batch.digest,
                                        month: month, downloadDay: downloadDay, rowCount: batch.rows.count,
                                        sourceID: ids[0], manifestID: ids[1], actionID: ids[2], receiptID: ids[3])
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
              b.account == batch.account, b.month == month, b.downloadDay == downloadDay else { throw GoogleBankStore.pending }
        binding = b
        _ = try resolved(batch,owner)
        switch try await Self.action(b,store:store) {
        case .dispatched:
            _ = try await Self.restore(b,store:store); return .dispatched
        case .prepared:
            try await store.checkNewWrite(owner)
            let manifest = try Self.encode(["kind":"reviewed","binding":b.object,"originalName":original.name,"plan":plan])
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
        let bytes = try Self.record("dispatch",b)
        let result = try await store.create(.action,b,data:bytes)
        guard result.createdHere, result.bytes == bytes else { throw GoogleBankStore.pending }
        try api.check()
    }
    func recordVerified(_ batch: PeriodBankAppend, owner: GoogleSheetSelection.Verified) async throws {
        let b = try resolved(batch,owner)
        guard try await Self.reconcile(b,owner:owner,api:api,store:store,observe:PeriodBankReadback.read).phase == .verified
        else { throw GoogleBankStore.pending }
    }
    private static func reconcile(_ b: BankBinding, owner: GoogleSheetSelection.Verified, api: GoogleSheetTools,
                                  store: BankStore, observe: Observe) async throws -> Status {
        try checked(b,owner:owner,api:api)
        let phase = try await action(b,store:store)
        if phase == .cancelled {
            try await persist(.receipt,record("cancelled",b),b,store:store)
            try await store.release(b)
            return Status(.cancelled,b)
        }
        guard phase == .dispatched else { return Status(.prepared,b) }
        let (_,batch) = try await restore(b,store:store)
        let seen = try await observe(batch,owner,api)
        guard case .verified = try batch.next(seen,stage:.dispatched) else { return Status(.dispatched,b) }
        try await persist(.receipt,record("verified",b),b,store:store)
        try await store.release(b)
        return Status(.verified,b)
    }
    static func status(owner: GoogleSheetSelection.Verified, api: GoogleSheetTools, expectedDigest: String? = nil) async throws -> Status? {
        try await lookup(owner:owner,api:api,store:GoogleBankStore(api:api),digest:expectedDigest,scope:nil,observe:PeriodBankReadback.read)
    }
    static func recover(owner: GoogleSheetSelection.Verified, api: GoogleSheetTools, sourceSHA256: String, account: String,
                        month: String, downloadDay: String) async throws -> Status? {
        guard BankBinding.hash(sourceSHA256), !account.isEmpty, BankBinding.validDateScope(month,downloadDay) else { throw GoogleBankStore.invalid }
        let scope = try BankBinding.scope(sheet:api.selected.sheetID,owner:api.selected.permissionID,source:sourceSHA256,account:account,month:month,day:downloadDay)
        return try await lookup(owner:owner,api:api,store:GoogleBankStore(api:api),digest:nil,scope:scope,observe:PeriodBankReadback.read)
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
        let (archived,batch) = try await restore(b,store:store)
        let first = try await observe(batch,owner,api)
        if case .verified = try batch.next(first,stage:.dispatched) {
            return try await reconcile(b,owner:owner,api:api,store:store,observe:observe)
        }
        try await store.checkNewWrite(owner)
        let refreshed = try await replan(archived,b.account,b.month,b.downloadDay)
        guard refreshed.digest == b.digest, try await store.gate() == b, try await action(b,store:store) == .dispatched else { throw GoogleBankStore.pending }
        let before = try await observe(batch,owner,api)
        switch try batch.next(before,stage:.prepared,freshlyPlanned:refreshed) {
        case .verified: break
        case .waitingForReadback: throw GoogleBankStore.pending
        case .batch(let requests):
            try await store.checkNewWrite(owner)
            try api.check()
            do { try await send(requests) } catch { try api.check() }
        }
        return try await reconcile(b,owner:owner,api:api,store:store,observe:observe)
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
    static func cancel(owner: GoogleSheetSelection.Verified, api: GoogleSheetTools, store: BankStore, digest: String, ticket: String,
                       observe: Observe) async throws -> Status {
        guard BankBinding.hash(digest), BankBinding.hash(ticket), owner.selection == api.selected else { throw GoogleBankStore.invalid }
        if let active = try await store.gate(), active.digest == digest, active.ticket == ticket, active.owner == api.selected.permissionID {
            try checked(active,owner:owner,api:api)
            let cancel = try record("cancel",active)
            let chosen = try await store.create(.action,active,data:cancel)
            if chosen.bytes != cancel, chosen.bytes != (try record("dispatch",active)) { throw GoogleBankStore.invalid }
            return try await reconcile(active,owner:owner,api:api,store:store,observe:observe)
        }
        if let done = try await store.finished(digest:digest,scope:nil), done.ticket == ticket {
            return try await reconcile(done,owner:owner,api:api,store:store,observe:observe)
        }
        throw GoogleBankStore.pending
    }
}
