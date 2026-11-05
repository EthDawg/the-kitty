import Foundation
import CoreFoundation
import CryptoKit
import JavaScriptCore

/// Binds the ordinary single-account bank CSV preview to the actual v2 Entries layout.
/// The shared period planner owns categorisation, duplicate detection and month logic.
/// An import with related updates, other tabs or deferred work must keep its entire plan.
struct PeriodBankAppend {
    typealias Object = [String: Any]
    enum Failure: String, Error { case unsupportedPlan, invalidPlan, invalidSource, ambiguousSourceText, missingSignedAmount, staleLedger, ambiguousWrite, unverifiedRows }
    enum Stage { case prepared, dispatched }
    enum Next { case batch([Object]), waitingForReadback, verified }
    enum ReceiptState { case absent, current, recategorised, changed, foreign }
    static let manifestAmountEncoding = "integer-cents-v1"
    private static let maxCents: Int64 = 100_000_000_000_000
    static let columns = ["Entry ID", "Kind", "Settled at", "Account ID", "Raw text", "Description", "Amount", "Category ID", "Person", "Receipt held", "Note", "Status", "Created at", "Transfer ID", "Transfer account", "Foreign amount", "Foreign currency", "Units", "Unit price", "Source"]
    static let guardKey = "kitty.period.bank.v1"
    static let issuedKey = "kitty.period.bank.issuedT.v1"
    let sheetID: String
    let account: String
    let originalSHA256: String
    let firstRow: Int
    let lastTransactionNumber: Int
    let rows: [Row]
    let digest: String
    private(set) var markerID: Int
    private var recordsIssuedIDs = false
    private let previousID: String?
    private let highestLedgerTransactionNumber: Int
    var lastRow: Int { firstRow + rows.count - 1 }
    var destination: String { "Entries!A\(firstRow):T\(lastRow)" }

    struct Row {
        let id: String
        fileprivate let cells: [Cell]
        fileprivate let movement: SourceMovement
    }
    fileprivate struct SourceMovement: Hashable {
        let account: String
        let day: Int
        let raw: Data
        let cents: Int64

        var normalized: Self {
            // The period planner uses Python's whitespace set, including the four information separators.
            let text = String(decoding: raw, as: UTF8.self).uppercased()
            let parts = text.unicodeScalars.split { $0.properties.isWhitespace || (0x1c...0x1f).contains($0.value) }
            return Self(account: account, day: day, raw: Data(parts.map(String.init).joined(separator: " ").utf8), cents: cents)
        }
    }
    fileprivate enum Cell: Equatable {
        case blank, text(String), money(Int64), date(Int)
        var entered: Object {
            switch self {
            case .blank: return [:]
            case .text(let text): return ["stringValue": text]
            case .money(let cents): return ["numberValue": Double(cents) / 100]
            case .date(let serial): return ["numberValue": serial]
            }
        }
        func matches(_ cell: Object) -> Bool {
            guard cell["userEnteredValue"] == nil || cell["userEnteredValue"] is Object else { return false }
            let actual = cell["userEnteredValue"] as? Object ?? [:]
            if case .blank = self { return actual.isEmpty || (actual.count == 1 && actual["stringValue"] as? String == "") }
            guard actual.count == 1 else { return false }
            switch self {
            case .text(let text): return (actual["stringValue"] as? String)?.utf8.elementsEqual(text.utf8) == true
            case .money(let cents): return PeriodBankAppend.cents(actual["numberValue"]) == cents
            case .date(let serial):
                let format = cell["userEnteredFormat"] as? Object
                return PeriodBankAppend.number(actual["numberValue"]) == Double(serial) && (format?["numberFormat"] as? Object)?["type"] as? String == "DATE"
            case .blank: return false
            }
        }
    }

    /// Validate the exact selected bytes before a compiled batch can be handed to the journal or writer.
    init(plan: Object, sheetID: String, account: String, original: SourceDocument, originalSHA256: String) throws {
        try Self.validate(original: original, approvedSHA256: originalSHA256)
        guard plan["schema"] as? String == "kitty-write-plan/1", plan["status"] as? String == "ready",
              let sheet = plan["sheet"] as? Object, sheet["id"] as? String == sheetID, !sheetID.isEmpty,
              Self.number(sheet["version"]) == 2, let deferred = plan["deferred"] as? [Any], deferred.isEmpty,
              let writes = plan["writes"] as? [Object], !writes.isEmpty, writes.count <= 8,
              !account.isEmpty else { throw Failure.unsupportedPlan }
        guard let assumptions = plan["assumes"] as? Object, let last = Self.integer(assumptions["last_entry_row"]),
              (1...1_000_000).contains(last), Self.integer(assumptions["entries_rows"]) == last - 1,
              let lastIDs = assumptions["last_ids"] as? Object, let txn = lastIDs["T"] as? String,
              let prior = Self.transactionNumber(txn), prior <= 99_999_999 else { throw Failure.invalidPlan }
        let floor: Int
        if let raw = assumptions["transaction_id_floor"] {
            guard let issued = Self.integer(raw), (prior...99_999_999).contains(issued) else { throw Failure.invalidPlan }
            floor = issued
        } else { floor = prior }
        let anchor = assumptions["last_entry_id"] as? String
        guard last == 1 ? anchor == nil : anchor?.isEmpty == false,
              let predicates = plan["preconditions"] as? [Object], predicates.count == 1 else { throw Failure.invalidPlan }
        let predicate = predicates[0]
        let expected = last == 1 ? [] : [[anchor!], []]
        guard predicate["range"] as? String == (last == 1 ? "Entries!A2" : "Entries!A\(last):A\(last + 1)"),
              let grid = predicate["expect"] as? [[String]], grid == expected else { throw Failure.invalidPlan }

        var built = [Row]()
        for (offset, write) in writes.enumerated() {
            guard write["tab"] as? String == "Entries", write["op"] as? String == "append", write["precondition"] == nil,
                  write["id"] as? String == "entries-\(offset + 1)", write["columns"] as? [String] == Self.columns,
                  let values = write["values"] as? [[Any]], (1...500).contains(values.count), Self.integer(write["rows"]) == values.count else { throw Failure.unsupportedPlan }
            let start = last + 1 + built.count
            guard write["range"] as? String == "Entries!A\(start):T\(start + values.count - 1)" else { throw Failure.invalidPlan }
            for row in values {
                let number = floor + built.count + 1
                guard number <= 99_999_999 else { throw Failure.unsupportedPlan }
                let id = "T" + String(format: "%04d", number)
                guard row.count == Self.columns.count, row[0] as? String == id, row[1] as? String == "transaction",
                      row[3] as? String == account, row[11] as? String == "settled", row[19] as? String == "bank export",
                      let settled = row[2] as? String, row[12] as? String == settled,
                      let category = row[7] as? String, !category.isEmpty,
                      row[15...18].allSatisfy({ $0 as? String == "" }) else { throw Failure.unsupportedPlan }
                let cells = try row.enumerated().map { col, item -> Cell in
                    if col == 2 || col == 12 {
                        guard let serial = GoogleSheetDay.serial(settled) else { throw Failure.invalidPlan }
                        return .date(serial)
                    }
                    if col == 6 {
                        guard let cents = Self.cents(item) else { throw Failure.invalidPlan }
                        return .money(cents)
                    }
                    guard var text = item as? String, text.utf8.count <= 50_000 else { throw Failure.invalidPlan }
                    // After source validation, the planner's USER_ENTERED escape can be removed for typed stringValue.
                    let scalars = text.unicodeScalars
                    if scalars.first == "'", let next = scalars.dropFirst().first, "=+-@'".unicodeScalars.contains(next) { text.removeFirst() }
                    return text.isEmpty ? .blank : .text(text)
                }
                guard case .date(let day) = cells[2], case .money(let cents) = cells[6] else { throw Failure.invalidPlan }
                let raw = cells[4].entered["stringValue"] as? String ?? ""
                let movement = SourceMovement(account: account, day: day, raw: Data(raw.utf8), cents: cents)
                built.append(Row(id: id, cells: cells, movement: movement))
            }
        }
        self.sheetID = sheetID
        self.account = account
        self.originalSHA256 = originalSHA256
        firstRow = last + 1
        previousID = anchor
        highestLedgerTransactionNumber = prior
        lastTransactionNumber = floor + built.count
        rows = built
        // Deliberately exclude timestamps, review prose, and access identity. A second device can recognise this import.
        let canonical: Object = ["sheet": sheetID, "source": originalSHA256, "account": account, "firstRow": last + 1,
                                 "anchor": anchor as Any? ?? NSNull(), "rows": built.map { $0.cells.map(\.entered) }]
        let data = try JSONSerialization.data(withJSONObject: canonical, options: [.sortedKeys, .withoutEscapingSlashes])
        guard data.count <= 1_500_000 else { throw Failure.unsupportedPlan }
        digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        // Competing batches starting from the same transaction sequence intentionally choose the same ID.
        // A collision with any other metadata fails closed. Never allocate a substitute ID after a collision.
        let token = SHA256.hash(data: Data("\(Self.guardKey)\u{0}\(sheetID)\u{0}\(built[0].id)".utf8)).prefix(4)
        markerID = max(1, token.reduce(0) { ($0 << 8) | Int($1) } & 0x7fff_ffff)
    }

    private static func validate(original: SourceDocument, approvedSHA256: String) throws {
        guard original.mimeType == "text/csv", (1...SourceDocumentCapture.maximumBytes).contains(original.byteLength),
              original.id == approvedSHA256, original.isIntact, let text = String(data: original.bytes, encoding: .utf8),
              let url = Bundle.main.url(forResource: "import", withExtension: "js"),
              let script = try? String(contentsOf: url, encoding: .utf8), let context = JSContext() else { throw Failure.invalidSource }
        // Only the bundled, pure parser is executable. The source bytes are passed as a string argument.
        context.evaluateScript(script)
        guard context.exception == nil, let core = context.objectForKeyedSubscript("KittyImport") else { throw Failure.invalidSource }
        let valid = core.invokeMethod("validateBankOriginal", withArguments: [text])
        if let error = context.exception {
            switch error.forProperty("code")?.toString() {
            case "ambiguous-bank-text": throw Failure.ambiguousSourceText
            case "amount-missing": throw Failure.missingSignedAmount
            default: throw Failure.invalidSource
            }
        }
        guard valid?.isNumber == true, let sourceRows = valid?.toInt32(), sourceRows > 0 else { throw Failure.invalidSource }
    }

    static func number(_ raw: Any?) -> Double? {
        guard let n = raw as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID(), n.doubleValue.isFinite else { return nil }
        return n.doubleValue
    }

    /// New manifests persist integer cents. A legacy Foundation JSON writer emitted the 17-digit
    /// spelling of a binary Double. NSDecimalNumber.doubleValue can misread even that exact spelling.
    private static func cents(_ raw: Any?) -> Int64? {
        guard let n = raw as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() else { return nil }
        let decimal = n as? NSDecimalNumber
        let value = decimal.flatMap { Double($0.stringValue) } ?? n.doubleValue
        guard value.isFinite, abs(value) <= Double(maxCents) / 100 else { return nil }
        let candidate = Int64((value * 100).rounded(.toNearestOrEven))
        let dollars = Double(candidate) / 100
        guard dollars == value else { return nil } // Subcent values cannot pass by rounding.
        if let decimal, decimal.decimalValue != Decimal(candidate) / 100 {
            let legacySpelling = String(format: "%.17g", dollars)
            guard let legacy = Decimal(string: legacySpelling, locale: Locale(identifier: "en_US_POSIX")),
                  legacy == decimal.decimalValue else { return nil }
        }
        return candidate
    }

    private static func mapAmounts(_ plan: Object, _ transform: (Any) throws -> Any) throws -> Object {
        guard let writes = plan["writes"] as? [Object], !writes.isEmpty else { throw Failure.invalidPlan }
        var mapped = plan
        mapped["writes"] = try writes.map { write -> Object in
            guard write["tab"] as? String == "Entries", write["op"] as? String == "append",
                  write["columns"] as? [String] == columns, let rows = write["values"] as? [[Any]] else { throw Failure.invalidPlan }
            var result = write
            result["values"] = try rows.map { row -> [Any] in
                guard row.count == columns.count else { throw Failure.invalidPlan }
                var cells = row
                cells[6] = try transform(row[6])
                return cells
            }
            return result
        }
        return mapped
    }

    static func planForManifest(_ plan: Object) throws -> Object {
        try mapAmounts(plan) { value in
            guard let minor = cents(value) else { throw Failure.invalidPlan }
            return minor
        }
    }

    static func restoredPlan(_ plan: Object, amountEncoding: Any?) throws -> Object {
        guard amountEncoding == nil || amountEncoding as? String == manifestAmountEncoding else { throw Failure.invalidPlan }
        return try mapAmounts(plan) { value in
            let minor: Int64
            if amountEncoding == nil {
                guard let legacy = cents(value) else { throw Failure.invalidPlan }
                minor = legacy
            } else {
                guard let n = value as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID(),
                      let integral = Int64(exactly: n.doubleValue), (-maxCents...maxCents).contains(integral),
                      n.decimalValue == Decimal(integral) else { throw Failure.invalidPlan }
                minor = integral
            }
            return Double(minor) / 100
        }
    }

    func usingMarkerID(_ explicit: Int?, recordsIssuedIDs: Bool = false) throws -> Self {
        var copy = self
        if let explicit {
            guard (1...Int(Int32.max)).contains(explicit) else { throw Failure.invalidPlan }
            copy.markerID = explicit
        }
        copy.recordsIssuedIDs = recordsIssuedIDs
        return copy
    }

    func hasSameSourceRows(as old: Self) -> Bool {
        guard sheetID == old.sheetID, account == old.account, originalSHA256 == old.originalSHA256 else { return false }
        return Dictionary(grouping: rows, by: \.movement).mapValues(\.count) ==
            Dictionary(grouping: old.rows, by: \.movement).mapValues(\.count)
    }

    /// Data rows from the complete unformatted Entries A:G range, excluding its header.
    func hasSourceMovement(in current: [[Any]]) throws -> Bool {
        let archived = Set(rows.map { $0.movement.normalized })
        for row in current {
            guard row.count >= 2, let kind = row[1] as? String else { throw Failure.staleLedger }
            if ["trade", "valuation"].contains(kind.lowercased()) { continue }
            guard kind.isEmpty || kind.lowercased() == "transaction", row.count >= 7,
                  let account = row[3] as? String, !account.isEmpty, let raw = row[4] as? String,
                  let day = (row[2] as? String).flatMap(GoogleSheetDay.serial) ?? Self.integer(row[2]),
                  let amount = Self.cents(row[6]) else { throw Failure.staleLedger }
            if archived.contains(SourceMovement(account: account, day: day, raw: Data(raw.utf8), cents: amount).normalized) { return true }
        }
        return false
    }
    private static func integer(_ raw: Any?) -> Int? { number(raw).flatMap(Int.init(exactly:)) }
    private static func transactionNumber(_ id: String) -> Int? {
        guard id.first == "T", !id.dropFirst().isEmpty, id.dropFirst().utf8.allSatisfy({ (48...57).contains($0) }) else { return nil }
        return Int(id.dropFirst())
    }

    /// Observations are collected by the native host from one selected Sheet (`PeriodBankReadback`).
    /// A complete A-column scan catches duplicate IDs anywhere, including a collaborating editor's addition.
    struct Observation {
        let sheetID: String
        let entriesTabID: Int
        let headers: [String]
        let ids: [String]
        let firstRow: Int
        let cells: [[Object]]
        let marker: Object?
    }

    /// Use historical mode only after authenticating the immutable terminal receipt. These edits
    /// describe the household's current classification; they cannot prove an initial append.
    func inspectReceipt(_ seen: Observation, historical: Bool) throws -> ReceiptState {
        guard seen.sheetID == sheetID, seen.entriesTabID >= 0, seen.firstRow == firstRow else { throw Failure.staleLedger }
        guard let marker = seen.marker else { return .absent }
        let location = marker["location"] as? Object
        guard Self.integer(marker["metadataId"]) == markerID, marker["metadataKey"] as? String == Self.guardKey,
              marker["metadataValue"] as? String == digest, marker["visibility"] as? String == "DOCUMENT",
              location?["spreadsheet"] == nil, location?["dimensionRange"] == nil,
              location?["locationType"] == nil || location?["locationType"] as? String == "SHEET",
              Self.integer(location?["sheetId"]) == seen.entriesTabID else { return .foreign }
        guard seen.headers == Self.columns, seen.ids.first == "Entry ID", seen.ids.allSatisfy({ !$0.isEmpty }),
              Set(seen.ids).count == seen.ids.count, seen.ids.count >= lastRow,
              Array(seen.ids[(firstRow - 1)..<lastRow]) == rows.map(\.id), seen.cells.count == rows.count,
              seen.cells.allSatisfy({ $0.count <= Self.columns.count }) else { return .changed }
        var edited = false
        for (row, read) in zip(rows, seen.cells) {
            for (column, expected) in row.cells.enumerated() {
                let actual = column < read.count ? read[column] : [:]
                if expected.matches(actual) { continue }
                guard historical, Self.allowsClassificationEdit(column: column, cell: actual) else { return .changed }
                edited = true
            }
        }
        return edited ? .recategorised : .current
    }

    private static func allowsClassificationEdit(column: Int, cell: Object) -> Bool {
        guard [5, 7, 8, 9, 10].contains(column), cell["userEnteredValue"] == nil || cell["userEnteredValue"] is Object else { return false }
        let entered = cell["userEnteredValue"] as? Object ?? [:]
        if entered.isEmpty { return column != 7 }
        guard entered.count == 1, let text = entered["stringValue"] as? String, text.utf8.count <= 50_000 else { return false }
        if column == 7 { return !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        if column == 9 { return ["", "Y", "N"].contains(text) }
        return true // Plain merchant display name, person or note. Raw bank description always remains exact.
    }

    /// Only call with .prepared after Drive has archived the original and persisted the reviewed intent.
    /// Supply the result of re-running the shared planner on a fresh complete Sheet, under the shared hold.
    /// The tail alone cannot reveal an edit to an earlier entry, rule or account.
    /// Journal .dispatched durably before sending. Recovery needs only the original reviewed plan and a new read.
    func next(_ seen: Observation, stage: Stage, freshlyPlanned: PeriodBankAppend? = nil) throws -> Next {
        guard seen.sheetID == sheetID, seen.entriesTabID >= 0, seen.firstRow == firstRow,
              seen.headers == Self.columns, seen.ids.first == "Entry ID", seen.ids.allSatisfy({ !$0.isEmpty }),
              Set(seen.ids).count == seen.ids.count, seen.cells.count <= rows.count,
              seen.cells.allSatisfy({ $0.count <= Self.columns.count }) else { throw Failure.staleLedger }
        if seen.marker != nil {
            switch try inspectReceipt(seen, historical: false) {
            case .current: return .verified
            case .foreign: throw Failure.ambiguousWrite
            default: throw Failure.unverifiedRows
            }
        }
        guard seen.ids.count == firstRow - 1, previousID == (seen.ids.count == 1 ? nil : seen.ids.last),
              (seen.ids.compactMap(Self.transactionNumber).max() ?? 0) == highestLedgerTransactionNumber,
              seen.cells.joined().allSatisfy({ ($0["userEnteredValue"] as? Object ?? [:]).isEmpty }) else { throw Failure.staleLedger }
        if stage == .dispatched { return .waitingForReadback }
        guard freshlyPlanned?.digest == digest else { throw Failure.staleLedger }
        return .batch(batch(tab: seen.entriesTabID))
    }

    private func batch(tab: Int) -> [Object] {
        let slot = ["sheetId": tab, "startRowIndex": firstRow - 1, "endRowIndex": lastRow,
                    "startColumnIndex": 0, "endColumnIndex": Self.columns.count]
        let values: [Object] = rows.map { row in ["values": row.cells.map { cell -> Object in
            cell.entered.isEmpty ? [:] : ["userEnteredValue": cell.entered]
        }] }
        // Insert only the canonical raw columns. A last-second manual entry is displaced intact, never overwritten.
        // The helper formula in U stays fixed; exact IDs and typed cells are checked after the atomic request.
        var result: [Object] = [["createDeveloperMetadata": ["developerMetadata": ["metadataId": markerID, "metadataKey": Self.guardKey,
                                  "metadataValue": digest, "location": ["sheetId": tab], "visibility": "DOCUMENT"]]],
                                ["insertRange": ["range": slot, "shiftDimension": "ROWS"]],
                                ["updateCells": ["range": slot, "rows": values, "fields": "userEnteredValue"]]]
        for column in [2, 12] {
            var dates = slot
            dates["startColumnIndex"] = column
            dates["endColumnIndex"] = column + 1
            result.append(["repeatCell": ["range": dates, "cell": ["userEnteredFormat": ["numberFormat": GoogleSheetDay.numberFormat]],
                                         "fields": "userEnteredFormat.numberFormat"]])
        }
        if recordsIssuedIDs {
            result.append(["createDeveloperMetadata": ["developerMetadata": ["metadataKey": Self.issuedKey,
                "metadataValue": "\(lastTransactionNumber)|\(digest)", "location": ["spreadsheet": true], "visibility": "DOCUMENT"]]])
        }
        return result
    }
}
