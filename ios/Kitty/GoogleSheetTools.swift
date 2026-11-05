import Foundation

/// REST boundary behind the bundled page's Sheets connector. The caller cannot supply a URL,
/// authorization header or account; every response belongs to the same native Picker session.
@MainActor
struct GoogleSheetTools {
    struct Failure: LocalizedError {
        let code: String
        let message: String
        var errorDescription: String? { message }
    }

    let http: GoogleHTTPTransport
    let selected: GoogleConnection.Selection
    let current: () -> GoogleConnection.Selection?
    let token: (GoogleConnection.Selection) async throws -> String

    nonisolated static let lastColumns = ["Settings": 3, "Accounts": 16, "Categories": 8, "Goals": 10, "Subscriptions": 17,
        "Loans": 11, "Assets": 4, "Metrics": 8, "Compliance Checks": 7, "Net Worth": 9, "Cash Flow": 20,
        "Budget": 9, "Savings Finder": 7, "Mortgage Scenarios": 8, "Tax Forecast": 6, "Transactions": 10,
        "Payslips": 7, "Kitty": 3, "Entries": 21, "Balances": 6, "Contracts": 17, "Decisions": 10, "Rules": 10]

    struct Rect {
        let tab: String, firstCol: Int, firstRow: Int, lastCol: Int, lastRow: Int?
        init?(_ a1: String) {
            guard a1.utf8.count <= 100 else { return nil }
            let parts = a1.split(separator: "!", omittingEmptySubsequences: false)
            guard parts.count == 2 else { return nil }
            var title = String(parts[0])
            if title.count >= 2, title.first == "'", title.last == "'" { title = String(title.dropFirst().dropLast()) }
            guard let limit = GoogleSheetTools.lastColumns[title] else { return nil }
            let bounds = parts[1].split(separator: ":", omittingEmptySubsequences: false)
            func cell(_ value: Substring) -> (Int, Int?)? {
                let bytes = Array(value.utf8)
                guard let col = bytes.first, (65...90).contains(col), bytes.count <= 8 else { return nil }
                let digits = bytes.dropFirst()
                if digits.isEmpty { return (Int(col) - 64, nil) }
                guard digits.first != 48, digits.allSatisfy({ (48...57).contains($0) }),
                      let row = Int(String(decoding: digits, as: UTF8.self)) else { return nil }
                return (Int(col) - 64, row)
            }
            guard (1...2).contains(bounds.count), let a = cell(bounds[0]), let b = cell(bounds.last!),
                  let first = a.1, a.0 <= b.0, b.0 <= limit,
                  b.1.map({ $0 >= first }) ?? true else { return nil }
            tab = title; firstCol = a.0; firstRow = first; lastCol = b.0; lastRow = b.1
        }
        func covers(_ returned: Rect) -> Bool {
            tab == returned.tab && firstCol == returned.firstCol && firstRow == returned.firstRow &&
                lastCol == returned.lastCol && (lastRow == nil || lastRow == returned.lastRow)
        }
    }

    func check() throws {
        guard current() == selected else { throw Failure(code: "stale_session", message: "The Google connection changed. Open the Sheet again.") }
    }

    func call(_ tool: String, input: [String: Any]) async throws -> [String: Any] {
        try check()
        guard input["spreadsheetId"] as? String == selected.sheetID else {
            throw Failure(code: "not_granted", message: "Only the selected Sheet is available.")
        }
        let data: [String: Any]
        switch tool {
        case "get_spreadsheet":
            let fields = ["sheets.properties.title", "sheets.properties.gridProperties.rowCount"]
            guard let requested = input["fields"] as? [String], [Set(fields),Set(fields + ["properties.timeZone"])].contains(Set(requested)),
                  requested.count == Set(requested).count else { throw invalid }
            data = try await request(query: ["fields": "spreadsheetId,properties(timeZone),sheets(properties(title,gridProperties(rowCount)))"])
            guard data["spreadsheetId"] as? String == selected.sheetID, data["sheets"] is [[String: Any]] else { throw invalid }
        case "get_values":
            guard let range = input["range"] as? String else { throw invalid }
            data = try await values(range)
        default:
            throw Failure(code: "not_granted", message: "This action requires a verified write plan.")
        }
        return ["payload": data, "cache": ["storedAt": Int64(Date().timeIntervalSince1970 * 1000)]]
    }

    func values(_ a1: String, render: String = "FORMATTED_VALUE") async throws -> [String: Any] {
        guard let rect = Rect(a1), ["FORMATTED_VALUE", "UNFORMATTED_VALUE", "FORMULA"].contains(render) else { throw invalid }
        let data = try await request(path: "/values/" + a1, query: ["valueRenderOption": render, "majorDimension": "ROWS"])
        guard let returned = data["range"] as? String, let output = Rect(returned), rect.covers(output),
              data["majorDimension"] as? String == "ROWS" else { throw invalid }
        if let value = data["values"] {
            guard let rows = value as? [[Any]], rows.count <= (output.lastRow.map { $0 - output.firstRow + 1 } ?? Int.max),
                  rows.allSatisfy({ row in row.count <= rect.lastCol - rect.firstCol + 1 &&
                      row.allSatisfy { $0 is String || $0 is NSNumber } }) else { throw invalid }
        }
        return data
    }

    var invalid: Failure { Failure(code: "invalid_response", message: "Google returned an unexpected Sheet range or layout.") }

    /// Only a verified writer can call these. The bridge does not expose an arbitrary Google URL or range.
    func updateValue(_ range: String, to value: String, beforeSend: (() throws -> Void)? = nil) async throws -> [String: Any] {
        guard let r = Rect(range), r.tab == "Entries", r.firstCol == 8, r.lastCol == 8, r.lastRow == r.firstRow else { throw invalid }
        return try await request(path: "/values/" + range, query: ["valueInputOption":"RAW"], method: "PUT",
                                 body: ["range":range, "majorDimension":"ROWS", "values":[[value]]], beforeSend:beforeSend)
    }

    func decisionSlot(_ range: String, at next: Int) async throws -> [String:Int] {
        guard let r = Rect(range), r.tab == "Decisions", r.firstCol == 1, r.lastCol == 8, r.lastRow == nil,
              next > r.firstRow else { throw invalid }
        let meta = try await request(query:["fields":"spreadsheetId,sheets(properties(sheetId,title,gridProperties(rowCount)))"])
        let tabs = (meta["sheets"] as? [[String:Any]])?.compactMap { $0["properties"] as? [String:Any] }.filter { $0["title"] as? String == "Decisions" }
        guard meta["spreadsheetId"] as? String == selected.sheetID, tabs?.count == 1, let tab = tabs?.first,
              let id = tab["sheetId"] as? Int, let grid = tab["gridProperties"] as? [String:Any],
              let count = grid["rowCount"] as? Int, next <= count else { throw invalid }
        let empty = try await values("Decisions!A\(next):H\(next)",render:"FORMULA")
        guard ((empty["values"] as? [[Any]]) ?? []).joined().allSatisfy({ ($0 as? String) == "" }) else {
            throw Failure(code:"write_conflict", message:"The next decision row changed. Check the Sheet before continuing.")
        }
        return ["sheetId":id,"startRowIndex":next-1,"endRowIndex":next,"startColumnIndex":0,"endColumnIndex":8]
    }

    struct AppendGuard { let id: Int, retire: [[String:Any]] }
    private static let guardKey = "kitty.review.v1"
    func appendGuard(for decision: String, preferred: Int?, sheet: Int, existing: [[String]]) async throws -> AppendGuard {
        let id = preferred ?? Int.random(in:1...Int(Int32.max))
        let search = try await request(path:"/developerMetadata:search",method:"POST",body:["dataFilters":[
            ["developerMetadataLookup":["metadataId":id]],
            ["developerMetadataLookup":["metadataKey":Self.guardKey,"visibility":"PROJECT","metadataLocation":["sheetId":sheet]]]
        ]])
        let matches = (search["matchedDeveloperMetadata"] as? [[String:Any]]) ?? []
        let records = matches.compactMap { $0["developerMetadata"] as? [String:Any] }
        guard records.count == matches.count else { throw invalid }
        let used = Set(records.compactMap { $0["metadataId"] as? Int }); var next = id
        if let owner = records.first(where:{ $0["metadataId"] as? Int == id }) {
            if owner["metadataKey"] as? String == Self.guardKey && (owner["metadataValue"] as? String)?.split(separator:"|").first.map(String.init) == decision {
                throw Failure(code:"write_pending",message:"Google already received this save. Check its decision row before submitting anything else.")
            }
            repeat { next = Int.random(in:1...Int(Int32.max)) } while used.contains(next)
        }
        // Only retire our own guards when the matching durable decision is present and at least
        // two days old, well beyond Google's request lifetime. Avoid an ever-growing metadata log.
        let cutoff = Int(Date().timeIntervalSince1970 / 86400) + 25569 - 2
        let archived = Set(existing.compactMap { r -> String? in
            guard r.count >= 7, r[0].hasPrefix("D-"), r[1] == "entry", r[3] == "categorise", r[5] == "The Kitty on iPhone",
                  let day = Int(r[6]), day < cutoff else { return nil }; return r[0]
        })
        let retire: [[String:Any]] = records.compactMap { r in
            guard r["metadataKey"] as? String == Self.guardKey, r["visibility"] as? String == "PROJECT",
                  let loc = r["location"] as? [String:Any], loc["sheetId"] as? Int == sheet,
                  let value = r["metadataValue"] as? String, let mid = r["metadataId"] as? Int else { return nil }
            let parts = value.split(separator:"|"); guard parts.count == 2, parts[0] != Substring(decision), archived.contains(String(parts[0])),
                  let sentDay = Int(parts[1]), sentDay + 25569 < cutoff else { return nil }
            return ["deleteDeveloperMetadata":["dataFilter":["developerMetadataLookup":["metadataId":mid,"metadataKey":Self.guardKey,"metadataValue":value,"visibility":"PROJECT"]]]]
        }
        return AppendGuard(id:next,retire:Array(retire.prefix(20)))
    }
    func appendDecision(_ slot: [String:Int], row: [String], guardKey: AppendGuard, beforeSend: (() throws -> Void)? = nil) async throws -> [String: Any] {
        guard row.count == 8, slot["startColumnIndex"] == 0, slot["endColumnIndex"] == 8,
              let n = slot["startRowIndex"], n > 0, slot["endRowIndex"] == n+1 else { throw invalid }
        // values.append infers a table and can land after helper columns. Insert only A:H at the
        // verified address, then fill that slot in the same atomic Google request. A concurrent
        // writer's just-added row is shifted, never overwritten; I onward do not move.
        guard let dayCell = GoogleSheetDay.cell(row[6]) else { throw invalid }
        var cells: [[String:Any]] = row.map { ["userEnteredValue":["stringValue":$0]] }
        cells[6] = dayCell
        var daySlot = slot; daySlot["startColumnIndex"] = 6; daySlot["endColumnIndex"] = 7
        guard let sheet = slot["sheetId"] else { throw invalid }
        let requests: [[String:Any]] = [
            ["insertRange":["range":slot,"shiftDimension":"ROWS"]],
            ["updateCells":["range":slot,"fields":"userEnteredValue","rows":[["values":cells]]]],
            ["repeatCell":["range":daySlot,"fields":"userEnteredFormat.numberFormat","cell":["userEnteredFormat":["numberFormat":GoogleSheetDay.numberFormat]]]],
            ["createDeveloperMetadata":["developerMetadata":["metadataId":guardKey.id,"metadataKey":Self.guardKey,
                "metadataValue":row[0] + "|" + String(Int(Date().timeIntervalSince1970 / 86400)),"location":["sheetId":sheet],"visibility":"PROJECT"]]]
        ] + guardKey.retire
        return try await request(path:":batchUpdate",method:"POST",body:["requests":requests],beforeSend:beforeSend)
    }

    func request(path: String = "", query: [String: String] = [:], method: String = "GET", body: [String: Any]? = nil, beforeSend: (() throws -> Void)? = nil) async throws -> [String: Any] {
        try check()
        let access = try await token(selected)
        try check()
        var parts = URLComponents(); parts.scheme = "https"; parts.host = "sheets.googleapis.com"
        parts.path = "/v4/spreadsheets/" + selected.sheetID + path
        parts.queryItems = query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
        guard let url = parts.url else { throw invalid }
        var request = URLRequest(url: url); request.httpMethod = method
        request.setValue("Bearer " + access, forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        try check(); try beforeSend?()
        let response = try await http.send(request, maximumBytes: 12 * 1024 * 1024)
        try check()
        switch response.statusCode {
        case 200..<300:
            guard let obj = try? JSONSerialization.jsonObject(with: response.data) as? [String: Any] else { throw invalid }
            return obj
        case 401: throw Failure(code: "needs_reauth", message: "Reconnect Google in Setup.")
        case 403, 404: throw Failure(code: "not_granted", message: "Google did not grant access to this Sheet or range.")
        case 429: throw Failure(code: "rate_limited", message: "Google is pacing requests. Try again shortly.")
        case 500...599: throw Failure(code: "server_unavailable", message: "Google Sheets is temporarily unavailable.")
        default: throw Failure(code: "tool_error", message: "Google Sheets did not accept this request.")
        }
    }
}
