import Foundation

/// Only an opaque, one-use ticket crosses back from the review screen. Bind that ticket to
/// the selected original, the plan the user saw, the current native session and the operation.
@MainActor
final class NativeBankImport {
    typealias Object = [String:Any]
    private enum Action: String { case confirm, resume, recover, stale }
    private struct Review {
        let id, session: UUID
        let selection: GoogleConnection.Selection
        let original: SourceDocument
        let account, month, day, digest: String
        let priorTicket: String?
        let preview: PeriodBankPlanner.Preview
        let action: Action
    }
    private var review: Review?
    private struct Discard {
        let id, session: UUID
        let selection: GoogleConnection.Selection
        let status: GooglePeriodBankJournal.Status
    }
    private var discard: Discard?
    private var manual: Discard?
    private var revision = UUID()
    private var committing = false
    func clear() { review = nil; discard = nil; manual = nil; revision = UUID() }

    private func armDiscard(_ status: GooglePeriodBankJournal.Status, session: UUID,
                            owner: GoogleSheetSelection.Verified) -> String? {
        guard status.canDiscard else { return nil }
        let id = UUID()
        discard = Discard(id:id,session:session,selection:owner.selection,status:status)
        return id.uuidString
    }

    /// Recovery must remain possible with only the selected Sheet, even when the original
    /// file is unavailable locally or a collaborator has changed the ledger since preview.
    func outstanding(session: UUID, owner: GoogleSheetSelection.Verified, api: GoogleSheetTools) async throws -> Object {
        guard !committing, owner.canImportBankFiles, owner.selection == api.selected else { throw api.invalid }
        clear()
        let request = revision
        let status = try await GooglePeriodBankJournal.status(owner:owner,api:api)
        try api.check()
        guard request == revision else { throw Self.stale }
        guard let status else { return ["status":"none","message":"There is no unfinished bank import for this Sheet."] }
        var result: Object = ["status":status.phase.rawValue,"account":status.account,
                              "month":status.month,"rowCount":status.rowCount]
        switch status.phase {
        case .verified: return Self.historicalReceipt(status)
        case .prepared: result["message"] = "This review was saved before its entries were sent. Reopen the file to finish, or discard this attempt."
        case .dispatched: result["message"] = "Google has not returned the saved entries. Reopen the file to resume, or discard this attempt. Kitty checks the result with Google before releasing it."
        case .cancelled: result["message"] = "This unfinished import has been discarded."
        case .needsReview:
            result["message"] = Self.changedMessage
            if status.canReleaseForReview {
                let id = UUID()
                manual = Discard(id:id,session:session,selection:owner.selection,status:status)
                result["manualTicket"] = id.uuidString
                result["message"] = "Google recorded this import, but the entries differ from the approved file. Keep the entries for manual review and close this attempt to allow other imports."
            }
        case .otherPending: result["message"] = "A different account has an unfinished import on this Sheet."
        }
        if let ticket = armDiscard(status,session:session,owner:owner) { result["discardTicket"] = ticket }
        return result
    }

    func closeForReview(ticket: String, session: UUID, owner: GoogleSheetSelection.Verified,
                        api: GoogleSheetTools) async throws -> Object {
        guard !committing, let m = manual, m.id.uuidString == ticket, m.session == session,
              m.selection == owner.selection, m.selection == api.selected, owner.canImportBankFiles else { throw Self.stale }
        clear(); committing = true
        defer { committing = false }
        let s = try await GooglePeriodBankJournal.releaseForReview(owner:owner,api:api,digest:m.status.digest,ticket:m.status.ticket)
        if s.phase == .verified { return Self.historicalReceipt(s) }
        guard s.manuallyClosed else { throw GoogleBankStore.pending }
        return ["status":"needsReview","message":"This import is recorded for manual review. You can import other files."]
    }

    func preview(original: SourceDocument, account: String, month: String, day: String, session: UUID,
                 owner: GoogleSheetSelection.Verified, api: GoogleSheetTools) async throws -> Object {
        guard !committing else { throw GoogleBankStore.pending }
        clear()
        let request = revision
        guard owner.canImportBankFiles, owner.selection == api.selected else { throw api.invalid }
        let preview = try await PeriodBankPlanner.prepare(original:original,account:account,month:month,
                            downloadDay:day,owner:owner,api:api)
        let status = try await GooglePeriodBankJournal.recover(owner:owner,api:api,sourceSHA256:original.id,
                            account:account,month:month,downloadDay:day)
        try api.check()
        guard request == revision else { throw Self.stale }
        var out: Object = ["mode":"preview", "summary":preview.summary]
        let action: Action
        let digest: String
        if let status, status.phase != .cancelled {
            digest = status.digest
            switch status.phase {
            case .verified:
                out["mode"] = "verified"
                out["receipt"] = Self.historicalReceipt(status)
                return out
            case .otherPending:
                out["mode"] = "pending"
                out["message"] = "A different import is awaiting verification. Use Check unfinished import in Setup."
                return out
            case .needsReview:
                out["mode"] = "pending"
                out["message"] = Self.changedMessage
                return out
            case .prepared: action = preview.batch?.digest == digest ? .confirm : .stale
            case .dispatched: action = preview.batch?.digest == digest ? .resume : .recover
            case .cancelled: throw api.invalid
            }
        } else if let batch = preview.batch {
            digest = batch.digest; action = .confirm
        } else { return out }
        let ticket = UUID()
        review = Review(id:ticket,session:session,selection:owner.selection,original:original,
                        account:account,month:month,day:day,digest:digest,priorTicket:status?.phase == .cancelled ? nil : status?.ticket,preview:preview,action:action)
        out["mode"] = action.rawValue; out["ticket"] = ticket.uuidString
        if let status, let discardID = armDiscard(status,session:session,owner:owner) {
            if action == .stale { out["ticket"] = discardID } else { out["discardTicket"] = discardID }
        }
        return out
    }

    func finish(ticket: String, cancel: Bool, session: UUID, owner: GoogleSheetSelection.Verified,
                api: GoogleSheetTools) async throws -> Object {
        guard !committing else { throw Self.stale }
        if cancel {
            guard let d = discard, d.id.uuidString == ticket, d.session == session, d.selection == owner.selection,
                  d.selection == api.selected, owner.canImportBankFiles else { throw Self.stale }
            clear(); committing = true
            defer { committing = false }
            let s = try await GooglePeriodBankJournal.discard(owner:owner,api:api,digest:d.status.digest,ticket:d.status.ticket)
            if s.phase == .verified { return Self.historicalReceipt(s) }
            if s.phase == .needsReview { return ["status":"needsReview","message":Self.changedMessage] }
            guard s.phase == .cancelled else { throw GoogleBankStore.pending }
            return ["status":"cancelled","message":"Unfinished import discarded. Preview your file again to start a new review."]
        }
        guard let r = review, r.id.uuidString == ticket, r.session == session,
              r.selection == owner.selection, r.selection == api.selected, owner.canImportBankFiles,
              r.action != .stale else { throw Self.stale }
        try api.check()
        clear(); committing = true
        defer { committing = false }
        if r.action == .recover {
            guard let s = try await GooglePeriodBankJournal.status(owner:owner,api:api,expectedDigest:r.digest),
                  s.phase == .verified else { throw GoogleBankStore.pending }
            return Self.historicalReceipt(s)
        }
        guard let batch = r.preview.batch, batch.digest == r.digest else { throw Self.stale }
        let replan: GooglePeriodBankJournal.Replan = { original, account, month, day in
                let fresh = try await PeriodBankPlanner.prepare(original:original,account:account,month:month,
                                                                downloadDay:day,owner:owner,api:api)
                guard let checked = fresh.batch else { throw PeriodBankAppend.Failure.staleLedger }
                return checked
        }
        if r.action == .resume {
            guard let prior = r.priorTicket else { throw Self.stale }
            let status = try await GooglePeriodBankJournal.resume(owner:owner,api:api,digest:r.digest,ticket:prior,replan:replan)
            guard status.phase == .verified else { throw GoogleBankStore.pending }
            return Self.historicalReceipt(status)
        }
        let journal = GooglePeriodBankJournal(api:api,original:r.original,plan:r.preview.plan,month:r.month,
            downloadDay:r.day,expectedTicket:r.priorTicket,replan:replan)
        let digest = try await PeriodBankWriter.commit(batch,owner:owner,api:api,journal:journal)
        return Self.receipt(digest,count:batch.rows.count,replay:false)
    }
    private static let changedMessage = "Google’s import record and the current entries differ. Check the original entries in your Sheet before importing this file again."
    private static func historicalReceipt(_ status: GooglePeriodBankJournal.Status) -> Object {
        var result = receipt(status.digest,count:status.rowCount,replay:true)
        if status.evidence == .recategorised {
            result["message"] = "Previously verified. The original bank amounts match. Some review details have since been edited in your Sheet."
            result["reviewEdited"] = true
        }
        return result
    }
    private static func receipt(_ digest: String, count: Int, replay: Bool) -> Object {
        let noun = count == 1 ? "entry" : "entries"
        return ["status":"verified","digest":digest,"replayed":replay,"rowCount":count,
                "message":replay ? "Verified import. Google already has these \(count) \(noun)."
                                 : "Verified import. Google returned the original file and \(count) saved \(noun)."]
    }
    private static var stale: GoogleSheetTools.Failure {
        .init(code:"review_changed",message:"The file, review or Google selection changed. Preview the original again.")
    }
}
