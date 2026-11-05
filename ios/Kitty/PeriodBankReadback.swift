import Foundation

/// Reads a narrowly scoped observation for the verified append adapter. This boundary only reads Google.
/// The owner that wires dispatch also owns archiving the source, the durable Drive intent and shared hold.
@MainActor
enum PeriodBankReadback {
    static func read(_ batch: PeriodBankAppend, owner: GoogleSheetSelection.Verified, api: GoogleSheetTools) async throws -> PeriodBankAppend.Observation {
        typealias Object = PeriodBankAppend.Object
        guard owner.selection == api.selected, owner.canEdit, batch.sheetID == api.selected.sheetID else {
            throw GoogleSheetTools.Failure(code: "not_granted", message: "Reconnect the selected editable Kitty Sheet before checking the import.")
        }
        // A discarded consent or connection cannot supply the result of a later request.
        try api.check()
        let markerRows = try await api.values("Kitty!A1:B", render: "UNFORMATTED_VALUE")["values"] as? [[Any]] ?? []
        let version = markerRows.filter { $0.first as? String == "sheet_version" }
        guard version.count == 1, version[0].count == 2,
              version[0][1] as? String == "2" || PeriodBankAppend.number(version[0][1]) == 2 else { throw api.invalid }

        let headerResult = try await api.values("Entries!A1:T1", render: "FORMULA")
        let idsResult = try await api.values("Entries!A1:A", render: "FORMULA")
        guard let headers = headerResult["values"] as? [[String]], headers.count == 1,
              let ids = idsResult["values"] as? [[String]], ids.allSatisfy({ $0.count == 1 }) else { throw api.invalid }

        let grid = try await api.request(query: ["ranges": batch.destination,
            "fields": "spreadsheetId,sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)),data(startRow,startColumn,rowData(values(userEnteredValue,userEnteredFormat(numberFormat(type))))))"])
        guard grid["spreadsheetId"] as? String == batch.sheetID, let tabs = grid["sheets"] as? [Object], tabs.count == 1,
              let properties = tabs[0]["properties"] as? Object, properties["title"] as? String == "Entries",
              let tab = properties["sheetId"] as? Int, tab >= 0, let limits = properties["gridProperties"] as? Object,
              let rowCount = limits["rowCount"] as? Int, rowCount >= batch.lastRow,
              let columnCount = limits["columnCount"] as? Int, columnCount >= 21,
              let blocks = tabs[0]["data"] as? [Object], blocks.count == 1,
              blocks[0]["startRow"] as? Int == batch.firstRow - 1,
              (blocks[0]["startColumn"] as? Int ?? 0) == 0 else { throw api.invalid }
        guard blocks[0]["rowData"] == nil || blocks[0]["rowData"] is [Object] else { throw api.invalid }
        let rawRows = blocks[0]["rowData"] as? [Object] ?? []
        let cells: [[Object]] = try rawRows.map { row in
            guard let raw = row["values"] else { return [] }
            guard let cells = raw as? [Object] else { throw api.invalid }
            return cells
        }
        let found = try await api.request(path: "/developerMetadata:search", method: "POST", body: ["dataFilters": [
            ["developerMetadataLookup": ["metadataId": batch.markerID]]]])
        guard found["matchedDeveloperMetadata"] == nil || found["matchedDeveloperMetadata"] is [Object] else { throw api.invalid }
        let matches = found["matchedDeveloperMetadata"] as? [Object] ?? []
        let metadata = try matches.map { hit -> Object in
            guard let attr = hit["developerMetadata"] as? Object, attr["metadataId"] as? Int == batch.markerID else { throw api.invalid }
            return attr
        }
        guard metadata.count <= 1 else { throw api.invalid }
        try api.check()
        return .init(sheetID: batch.sheetID, entriesTabID: tab, headers: headers[0], ids: ids.map { $0[0] },
                     firstRow: batch.firstRow, cells: cells, marker: metadata.first)
    }
}
