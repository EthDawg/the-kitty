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
        "Payslips": 7, "Kitty": 3, "Entries": 21, "Balances": 6, "Contracts": 17, "Decisions": 8, "Rules": 10]

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
            guard let requested = input["fields"] as? [String], Set(requested) == Set(fields),
                  requested.count == fields.count else { throw invalid }
            data = try await request(query: ["fields": "spreadsheetId,sheets(properties(title,gridProperties(rowCount)))"])
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

    func request(path: String = "", query: [String: String] = [:], method: String = "GET", body: [String: Any]? = nil) async throws -> [String: Any] {
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
