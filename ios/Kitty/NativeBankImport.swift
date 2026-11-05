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
    private var revision = UUID()
    private var committing = false
    func clear() { review = nil; revision = UUID() }

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
                out["receipt"] = Self.receipt(digest, count:status.rowCount, replay:true)
                return out
            case .otherPending:
                out["mode"] = "pending"
                out["message"] = "A different bank import is awaiting verification. Reopen its original file to finish it first."
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
        return out
    }

    func finish(ticket: String, cancel: Bool, session: UUID, owner: GoogleSheetSelection.Verified,
                api: GoogleSheetTools) async throws -> Object {
        guard !committing, let r = review, r.id.uuidString == ticket, r.session == session,
              r.selection == owner.selection, r.selection == api.selected, owner.canImportBankFiles,
              cancel == (r.action == .stale) else { throw Self.stale }
        try api.check()
        clear(); committing = true
        defer { committing = false }
        if cancel {
            guard let prior = r.priorTicket else { throw Self.stale }
            let status = try await GooglePeriodBankJournal.cancelPrepared(owner:owner,api:api,digest:r.digest,ticket:prior)
            if status.phase == .verified { return Self.receipt(r.digest,count:status.rowCount,replay:true) }
            guard status.phase == .cancelled else { throw GoogleBankStore.pending }
            return ["status":"cancelled","message":"Outdated review discarded. Preview the file again."]
        }
        if r.action == .recover {
            guard let s = try await GooglePeriodBankJournal.status(owner:owner,api:api,expectedDigest:r.digest),
                  s.phase == .verified else { throw GoogleBankStore.pending }
            return Self.receipt(r.digest,count:s.rowCount,replay:true)
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
            return Self.receipt(r.digest,count:status.rowCount,replay:true)
        }
        let journal = GooglePeriodBankJournal(api:api,original:r.original,plan:r.preview.plan,month:r.month,
            downloadDay:r.day,expectedTicket:r.priorTicket,replan:replan)
        let digest = try await PeriodBankWriter.commit(batch,owner:owner,api:api,journal:journal)
        return Self.receipt(digest,count:batch.rows.count,replay:false)
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
