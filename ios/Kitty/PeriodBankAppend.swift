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
    static let columns = ["Entry ID", "Kind", "Settled at", "Account ID", "Raw text", "Description", "Amount", "Category ID", "Person", "Receipt held", "Note", "Status", "Created at", "Transfer ID", "Transfer account", "Foreign amount", "Foreign currency", "Units", "Unit price", "Source"]
    static let guardKey = "kitty.period.bank.v1"
    let sheetID: String
    let account: String
    let originalSHA256: String
    let firstRow: Int
    let rows: [Row]
    let digest: String
    let markerID: Int
    private let previousID: String?
    private let previousNumber: Int
    var lastRow: Int { firstRow + rows.count - 1 }
    var destination: String { "Entries!A\(firstRow):T\(lastRow)" }

    struct Row {
        let id: String
        fileprivate let cells: [Cell]
    }
    fileprivate enum Cell: Equatable {
        case blank, text(String), number(Double), date(Int)
        var entered: Object {
            switch self {
            case .blank: return [:]
            case .text(let text): return ["stringValue": text]
            case .number(let amount): return ["numberValue": amount]
            case .date(let serial): return ["numberValue": serial]
            }
        }
        func matches(_ cell: Object) -> Bool {
            let actual = cell["userEnteredValue"] as? Object ?? [:]
            if case .blank = self { return actual.isEmpty || (actual.count == 1 && actual["stringValue"] as? String == "") }
            guard actual.count == 1 else { return false }
            switch self {
            case .text(let text): return actual["stringValue"] as? String == text
            case .number(let amount): return PeriodBankAppend.number(actual["numberValue"]) == amount
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
                let number = prior + built.count + 1
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
                        guard let amount = Self.number(item), abs(amount) <= 1_000_000_000_000,
                              (amount * 100).rounded() / 100 == amount else { throw Failure.invalidPlan }
                        return .number(amount)
                    }
                    guard var text = item as? String, text.utf8.count <= 50_000 else { throw Failure.invalidPlan }
                    // After source validation, the planner's USER_ENTERED escape can be removed for typed stringValue.
                    let scalars = text.unicodeScalars
                    if scalars.first == "'", let next = scalars.dropFirst().first, "=+-@'".unicodeScalars.contains(next) { text.removeFirst() }
                    return text.isEmpty ? .blank : .text(text)
                }
                built.append(Row(id: id, cells: cells))
            }
        }
        self.sheetID = sheetID
        self.account = account
        self.originalSHA256 = originalSHA256
        firstRow = last + 1
        previousID = anchor
        previousNumber = prior
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

    /// Only call with .prepared after Drive has archived the original and persisted the reviewed intent.
    /// Supply the result of re-running the shared planner on a fresh complete Sheet, under the shared hold.
    /// The tail alone cannot reveal an edit to an earlier entry, rule or account.
    /// Journal .dispatched durably before sending. Recovery needs only the original reviewed plan and a new read.
    func next(_ seen: Observation, stage: Stage, freshlyPlanned: PeriodBankAppend? = nil) throws -> Next {
        guard seen.sheetID == sheetID, seen.entriesTabID >= 0, seen.firstRow == firstRow,
              seen.headers == Self.columns, seen.ids.first == "Entry ID", seen.ids.allSatisfy({ !$0.isEmpty }),
              Set(seen.ids).count == seen.ids.count, seen.cells.count <= rows.count,
              seen.cells.allSatisfy({ $0.count <= Self.columns.count }) else { throw Failure.staleLedger }
        if let marker = seen.marker {
            let location = marker["location"] as? Object
            guard Self.integer(marker["metadataId"]) == markerID, marker["metadataKey"] as? String == Self.guardKey,
                  marker["metadataValue"] as? String == digest, marker["visibility"] as? String == "DOCUMENT",
                  Self.integer(location?["sheetId"]) == seen.entriesTabID else { throw Failure.ambiguousWrite }
            guard seen.ids.count >= lastRow,
                  Array(seen.ids[(firstRow - 1)..<lastRow]) == rows.map(\.id), seen.cells.count == rows.count else { throw Failure.unverifiedRows }
            for (row, read) in zip(rows, seen.cells) {
                for (position, cell) in row.cells.enumerated() where !cell.matches(position < read.count ? read[position] : [:]) {
                    throw Failure.unverifiedRows
                }
            }
            return .verified
        }
        guard seen.ids.count == firstRow - 1, previousID == (seen.ids.count == 1 ? nil : seen.ids.last),
              (seen.ids.compactMap(Self.transactionNumber).max() ?? 0) == previousNumber,
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
        return result
    }
}
