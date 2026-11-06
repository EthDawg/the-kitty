import Foundation
import JavaScriptCore

/// Fresh, read-only planning for a single retained bank export. The controller owns file selection,
/// private-Sheet permission, consent tickets and journal recovery. This type never sends a write.
@MainActor
enum PeriodBankPlanner {
    typealias Object = [String: Any]

    struct Preview {
        let plan: Object
        let summary: Object
        let batch: PeriodBankAppend?
    }

    static func prepare(original: SourceDocument, account: String, month: String, downloadDay: String,
                        owner: GoogleSheetSelection.Verified, api: GoogleSheetTools, transactionIDFloor: Int = 0) async throws -> Preview {
        guard owner.selection == api.selected, owner.canEdit, owner.canImportBankFiles,
              owner.selection.sheetID != GoogleSheetSelection.demoFileID else {
            throw GoogleSheetTools.Failure(code: "not_granted", message: "Open the selected private, editable v2 Sheet before preparing a bank import.")
        }
        try api.check()
        guard (0...99_999_999).contains(transactionIDFloor) else { throw api.invalid }
        guard original.isIntact, original.mimeType == "text/csv",
              (1...SourceDocumentCapture.maximumBytes).contains(original.byteLength),
              GoogleSheetDay.serial(downloadDay) != nil,
              month.range(of: #"^[0-9]{4}-(0[1-9]|1[0-2])$"#, options: .regularExpression) != nil else {
            throw GoogleSheetTools.Failure(code: "invalid_source", message: "Choose a retained bank CSV, account, month and download date.")
        }
        let file = try original.payload()
        let runtime = try loadRuntime()
        guard let ranges = runtime.core.forProperty("ranges")?.toDictionary() as? [String: String],
              !ranges.isEmpty else { throw api.invalid }
        // Read the grid limits first so a response for only a prefix of an open A1 range cannot pass.
        // Match each fresh table by its returned A1 bounds rather than provider response order.
        let grids = try await freshGrids(ranges: ranges, api: api)
        try api.check()
        let request: Object = ["account": account, "month": month, "downloadDay": downloadDay, "sheetID": api.selected.sheetID,
                               "transactionIDFloor": transactionIDFloor]
        let result = runtime.core.invokeMethod("fromFreshGrids", withArguments: [grids, file, request])
        if let exception = runtime.context.exception {
            throw GoogleSheetTools.Failure(code: "import_plan_invalid", message: String((exception.forProperty("message")?.toString() ?? "Kitty could not read this source and Sheet together.").prefix(800)))
        }
        guard let value = result?.toDictionary() as? Object, let plan = value["plan"] as? Object,
              var summary = value["summary"] as? Object,
              summary["sourceID"] as? String == original.id, summary["name"] as? String == original.name,
              summary["byteLength"] as? Int == original.byteLength, summary["account"] as? String == account,
              summary["month"] as? String == month, summary["downloadDay"] as? String == downloadDay else { throw api.invalid }
        var batch: PeriodBankAppend?
        if plan["status"] as? String == "ready", (plan["writes"] as? [Object])?.isEmpty == false {
            do {
                batch = try PeriodBankAppend(plan: plan, sheetID: api.selected.sheetID, account: account,
                                             original: original, originalSHA256: original.id)
            } catch PeriodBankAppend.Failure.unsupportedPlan {
                summary["restriction"] = "This plan includes changes outside a single bank-account append. Review the complete plan before using the period importer."
            }
        }
        try api.check()
        return Preview(plan: plan, summary: summary, batch: batch)
    }

    private static func loadRuntime() throws -> (context: JSContext, core: JSValue) {
        guard let url = Bundle.main.url(forResource: "kitty-period-bank", withExtension: "js"),
              let script = try? String(contentsOf: url, encoding: .utf8),
              let context = JSContext() else { throw unavailable }
        context.evaluateScript(script, withSourceURL: url)
        guard context.exception == nil, let core = context.objectForKeyedSubscript("KittyBank"),
              core.isObject else { throw unavailable }
        return (context, core)
    }

    static func freshGrids(ranges: [String: String], api: GoogleSheetTools) async throws -> [String: [[Any]]] {
        guard !ranges.isEmpty, ranges.count <= 16 else { throw api.invalid }
        let metadata = try await api.request(query: ["fields": "spreadsheetId,sheets(properties(title,gridProperties(rowCount,columnCount)))"])
        guard metadata["spreadsheetId"] as? String == api.selected.sheetID, let sheets = metadata["sheets"] as? [Object] else { throw api.invalid }
        var limits: [String: (key: String, a1: String, bounds: GoogleSheetTools.Rect)] = [:]
        for (key, a1) in ranges {
            guard let open = GoogleSheetTools.Rect(a1), open.lastRow == nil, open.firstRow == 1, limits[open.tab] == nil else { throw api.invalid }
            let matching = sheets.compactMap { $0["properties"] as? Object }.filter { $0["title"] as? String == open.tab }
            guard matching.count == 1, let grid = matching[0]["gridProperties"] as? Object,
                  let height = grid["rowCount"] as? Int, (1...1_000_000).contains(height),
                  let width = grid["columnCount"] as? Int, width >= open.lastCol else { throw api.invalid }
            let bounded = a1 + String(height)
            guard let rect = GoogleSheetTools.Rect(bounded) else { throw api.invalid }
            limits[open.tab] = (key, bounded, rect)
        }
        let filters = limits.values.map { $0.a1 }.sorted().map { ["a1Range": $0] }
        let response = try await api.request(path: "/values:batchGetByDataFilter", method: "POST", body: [
            "dataFilters": filters, "majorDimension": "ROWS",
            "valueRenderOption": "UNFORMATTED_VALUE", "dateTimeRenderOption": "SERIAL_NUMBER"
        ])
        guard response["spreadsheetId"] as? String == api.selected.sheetID,
              let matched = response["valueRanges"] as? [Object], matched.count == ranges.count else { throw api.invalid }
        var grids: [String: [[Any]]] = [:]
        for hit in matched {
            guard let matching = hit["dataFilters"] as? [Object], matching.count == 1,
                  let requested = matching[0]["a1Range"] as? String, let echoed = GoogleSheetTools.Rect(requested),
                  let expected = limits[echoed.tab], expected.bounds.covers(echoed), grids[expected.key] == nil,
                  let value = hit["valueRange"] as? Object, value["majorDimension"] as? String == "ROWS",
                  let returned = value["range"] as? String, let actual = GoogleSheetTools.Rect(returned),
                  expected.bounds.covers(actual), let last = actual.lastRow else { throw api.invalid }
            let rows = value["values"] ?? [[Any]]()
            guard let rows = rows as? [[Any]], rows.count <= last - actual.firstRow + 1,
                  rows.count <= 100001, rows.allSatisfy({ row in
                      row.count <= actual.lastCol - actual.firstCol + 1 && row.allSatisfy { $0 is String || $0 is NSNumber }
                  }) else { throw api.invalid }
            grids[expected.key] = rows
        }
        try api.check()
        return grids
    }

    private static var unavailable: GoogleSheetTools.Failure {
        .init(code: "planner_unavailable", message: "The shared period planner could not be loaded. Reopen the app before importing.")
    }
}
