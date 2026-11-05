import Foundation
import CryptoKit

/// Establishes what Google actually returned after Picker consent. No ledger rows or credentials
/// are persisted by this probe, and a selected file never by itself establishes write authority.
@MainActor
struct GoogleSheetSelection {
    // This development milestone is explicitly limited to the public fictional household.
    static let demoFileID = "16BNQv2jTt9G3Yfbkj1NwgaAxDjBibCth40wdNXWf3aA"
    struct Verified {
        let selection: GoogleConnection.Selection
        let title: String
        let canEdit: Bool
        var summary: [String: Any] {
            ["sheetID": selection.sheetID, "title": title, "sheetVersion": 2, "canEdit": canEdit]
        }
        var preferenceID: String {
            let bytes = Data((selection.permissionID + "\u{0}" + selection.sheetID).utf8)
            return "native-" + SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
        }
        var descriptor: [String: Any] {
            summary.merging(["session": selection.sessionID.uuidString, "preferenceID": preferenceID]) { _, next in next }
        }
    }

    enum Failure: LocalizedError {
        case wrongFile, wrongVersion, noAccess, unavailable, changed, quota
        var errorDescription: String? {
            switch self {
            case .wrongFile: return "Choose a Google Sheet that uses The Kitty v2 template."
            case .wrongVersion: return "This Sheet is missing The Kitty v2 ledger or its version marker. Nothing was changed."
            case .noAccess: return "Google did not allow this read. Check the selected Sheet and the app’s Google API access."
            case .unavailable: return "The selected Sheet could not be verified. The bundled demo is still available."
            case .changed: return "The selected Google connection changed. Choose the Sheet again."
            case .quota: return "Google is pacing reads. Try again in a moment."
            }
        }
    }

    let http: GoogleHTTPTransport
    let current: () -> GoogleConnection.Selection?
    let token: (GoogleConnection.Selection) async throws -> String

    func verify(_ selection: GoogleConnection.Selection) async throws -> Verified {
        guard GoogleConnection.validSheetID(selection.sheetID) else { throw Failure.wrongFile }
        let file = try await read(selection, host: "www.googleapis.com", path: "/drive/v3/files/" + selection.sheetID,
                                  query: ["fields": "id,name,mimeType,trashed,capabilities(canEdit)", "supportsAllDrives": "true"])
        guard file["id"] as? String == selection.sheetID,
              file["mimeType"] as? String == "application/vnd.google-apps.spreadsheet",
              file["trashed"] as? Bool == false,
              let name = file["name"] as? String, !name.isEmpty,
              let capabilities = file["capabilities"] as? [String: Any],
              let canEdit = capabilities["canEdit"] as? Bool else { throw Failure.wrongFile }

        let base = "/v4/spreadsheets/" + selection.sheetID
        let metadata = try await read(selection, host: "sheets.googleapis.com", path: base,
                                      query: ["fields": "spreadsheetId,sheets(properties(title))"])
        guard metadata["spreadsheetId"] as? String == selection.sheetID,
              let sheets = metadata["sheets"] as? [[String: Any]] else { throw Failure.wrongFile }
        let titles = sheets.compactMap { ($0["properties"] as? [String: Any])?["title"] as? String }
        guard Set(["Kitty", "Accounts", "Entries", "Decisions", "Categories"]).isSubset(of: Set(titles))
        else { throw Failure.wrongVersion }

        let version = try await read(selection, host: "sheets.googleapis.com", path: base + "/values/Kitty!A1:B",
                                     query: ["majorDimension": "ROWS", "valueRenderOption": "UNFORMATTED_VALUE"])
        guard let range = version["range"] as? String,
              range.range(of: #"^(?:Kitty|'Kitty')!A1:B[1-9][0-9]*$"#, options: .regularExpression) != nil,
              let values = version["values"] as? [[Any]] else { throw Failure.wrongVersion }
        let rows = values.filter { $0.first as? String == "sheet_version" }
        guard rows.count == 1, rows[0].count == 2,
              String(describing: rows[0][1]) == "2" else { throw Failure.wrongVersion }
        guard current() == selection else { throw Failure.changed }
        return Verified(selection: selection, title: String(name.prefix(250)), canEdit: canEdit)
    }

    #if DEBUG
    /// A single development receipt for the public fictional fixture only. It contains
    /// no title, account identity, token or financial values. It is never backed up.
    static func recordDemoCheck(_ verified: Verified, pageURL: URL) {
        let digest = { (data: Data) in SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
        let idHash = digest(Data(verified.selection.sheetID.utf8))
        guard idHash == "1a16e89f2bef2519162bdac3f4ecc24bab108569c20d2a1005896d14670a6fce",
              let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first,
              let page = try? Data(contentsOf: pageURL) else { return }
        let evidence: [String: Any] = ["fixture": "Digital Davies v2", "checkedAt": ISO8601DateFormatter().string(from: Date()),
            "sheetIDSHA256": idHash, "version": 2, "canEdit": verified.canEdit, "nativePageSHA256": digest(page)]
        do {
            var directory = appSupport.appendingPathComponent("KittyQA", isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            var flags = URLResourceValues(); flags.isExcludedFromBackup = true; try directory.setResourceValues(flags)
            let data = try JSONSerialization.data(withJSONObject: evidence, options: [.sortedKeys])
            try data.write(to: directory.appendingPathComponent("demo-picker.json"), options: [.atomic, .completeFileProtection])
        } catch { /* Optional test evidence must not change the provider result. */ }
    }
    #endif

    private func read(_ selection: GoogleConnection.Selection, host: String, path: String,
                      query: [String: String]) async throws -> [String: Any] {
        guard current() == selection else { throw Failure.changed }
        var url = URLComponents(); url.scheme = "https"; url.host = host; url.path = path
        url.queryItems = query.sorted(by: { $0.key < $1.key }).map { URLQueryItem(name: $0.key, value: $0.value) }
        guard let target = url.url else { throw Failure.wrongFile }
        let access = try await token(selection)
        guard current() == selection else { throw Failure.changed }
        var request = URLRequest(url: target)
        request.setValue("Bearer " + access, forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let result = try await http.send(request, maximumBytes: 512 * 1024)
        guard current() == selection else { throw Failure.changed }
        switch result.statusCode {
        case 200:
            guard let json = try? JSONSerialization.jsonObject(with: result.data) as? [String: Any] else { throw Failure.unavailable }
            return json
        case 401, 403, 404: throw Failure.noAccess
        case 429: throw Failure.quota
        default: throw Failure.unavailable
        }
    }
}
