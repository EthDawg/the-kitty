import Foundation

/// The importer host supplies the household-owned Drive archive and cross-device import gate.
/// No default local implementation: a per-phone lock or a Boolean from the web view cannot supply this authority.
@MainActor
protocol PeriodBankJournal {
    /// Acquires or resumes an exclusive shared hold, reads the archived source back, and checks the exact
    /// preview digest, Google identity and sheet against the durable intent before returning its recorded stage.
    func reserve(_ batch: PeriodBankAppend, owner: GoogleSheetSelection.Verified) async throws -> PeriodBankAppend.Stage
    /// The durable intent pins the marker. A fresh generation can coexist with an older cancellation fence.
    func authorizedBatch(_ batch: PeriodBankAppend, owner: GoogleSheetSelection.Verified) throws -> PeriodBankAppend
    /// A fresh canonical v2 read and run of the shared planner, made while the hold is owned.
    func replan(_ batch: PeriodBankAppend, owner: GoogleSheetSelection.Verified) async throws -> PeriodBankAppend
    /// Atomically checks ownership and records dispatch in Drive. Throw on an unknown result.
    func markDispatched(_ batch: PeriodBankAppend, owner: GoogleSheetSelection.Verified) async throws
    /// Idempotently writes and reads back the verified receipt, then releases this intent's hold.
    func recordVerified(_ batch: PeriodBankAppend, owner: GoogleSheetSelection.Verified) async throws
}

extension PeriodBankJournal {
    func authorizedBatch(_ batch: PeriodBankAppend, owner: GoogleSheetSelection.Verified) throws -> PeriodBankAppend { batch }
}

@MainActor
enum PeriodBankWriter {
    /// Returns the verified receipt's digest for the household. A pending or failed operation keeps its hold.
    static func commit(_ reviewed: PeriodBankAppend, owner: GoogleSheetSelection.Verified,
                       api: GoogleSheetTools, journal: PeriodBankJournal) async throws -> String {
        guard owner.canEdit, owner.selection == api.selected, reviewed.sheetID == owner.selection.sheetID else {
            throw GoogleSheetTools.Failure(code: "not_granted", message: "Choose the editable Sheet that you reviewed before importing.")
        }
        try api.check()
        let stage = try await journal.reserve(reviewed, owner: owner)
        try api.check()
        let batch = try journal.authorizedBatch(reviewed,owner:owner)
        let before = try await PeriodBankReadback.read(batch, owner: owner, api: api)
        // A completed first phone can be recovered after a crash, even if the source is now fully duplicated.
        let fresh: PeriodBankAppend?
        if stage == .prepared && before.marker == nil { fresh = try await journal.replan(batch, owner: owner) }
        else { fresh = nil }
        switch try batch.next(before, stage: stage, freshlyPlanned: fresh) {
        case .verified:
            break
        case .waitingForReadback:
            throw pending
        case .batch(let requests):
            try api.check()
            try await journal.markDispatched(batch, owner: owner)
            try api.check()
            do { _ = try await api.request(path: ":batchUpdate", method: "POST", body: ["requests": requests]) }
            catch { try api.check() } // A lost reply can follow a successful atomic commit. Only a fresh read can confirm it.
            let after = try await PeriodBankReadback.read(batch, owner: owner, api: api)
            guard case .verified = try batch.next(after, stage: .dispatched) else { throw pending }
        }
        try api.check()
        try await journal.recordVerified(batch, owner: owner)
        try api.check()
        return reviewed.digest
    }
    private static var pending: GoogleSheetTools.Failure {
        .init(code: "import_pending", message: "The previous import is still being checked. Recheck its receipt before submitting another import.")
    }
}
