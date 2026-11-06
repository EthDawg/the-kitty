import Foundation

/// A practice copy is created only from the public Davies template and only in the signed-in user's My Drive.
@MainActor
struct GooglePracticeSheet {
    struct Copy {
        let id: String
        let name: String
        let source: GoogleConnection.Selection
        fileprivate init(id: String, name: String, source: GoogleConnection.Selection) { self.id = id; self.name = name; self.source = source }
    }
    struct Choice {
        private let copy: Copy
        let ticket = UUID()
        init(_ copy: Copy) { self.copy = copy }
        var offer: [String:String] { ["title":copy.name,"ticket":ticket.uuidString] }
        func selected(by response: String?, source: GoogleConnection.Selection?) throws -> Copy {
            guard response == ticket.uuidString, source == copy.source else { throw GoogleSheetSelection.Failure.changed }
            return copy
        }
    }
    let api: GoogleSheetTools
    let preferences: UserDefaults
    private let marker = "davies-v2"

    func findOrCreate() async throws -> Copy {
        let source = api.selected
        guard source.sheetID == GoogleSheetSelection.demoFileID else { throw api.invalid }
        let key = "kitty.practice." + SourceDocument.sha256(Data(source.permissionID.utf8))
        let pending = preferences.string(forKey: key)
        var query = "trashed = false and 'me' in owners and mimeType = 'application/vnd.google-apps.spreadsheet' and appProperties has { key='kittyPractice' and value='davies-v2' }"
        if let pending {
            guard UUID(uuidString: pending) != nil else { throw api.invalid }
            query += " and appProperties has { key='kittyPracticeOperation' and value='" + pending + "' }"
        }
        let search = try await drive("/drive/v3/files", query: ["q": query, "spaces": "drive", "pageSize": "2",
                          "fields": "incompleteSearch,nextPageToken,files(" + GoogleSheetSelection.driveFields + ")"])
        guard search["incompleteSearch"] as? Bool != true, search["nextPageToken"] == nil,
              let matches = search["files"] as? [[String:Any]], matches.count <= 1 else {
            throw GoogleSheetTools.Failure(code:"choose_practice", message:"Choose your private practice Sheet in Google.")
        }
        if let existing = matches.first {
            let found = try verify(existing, operation: pending)
            preferences.removeObject(forKey: key)
            return found
        }
        guard pending == nil else {
            throw GoogleSheetTools.Failure(code:"copy_pending", message:"Google is still checking the previous copy. Try opening it again from Setup.")
        }
        // Workspace file copies do not support a caller-chosen file ID. Record the operation
        // before sending and look for that marker after a lost response instead of copying again.
        let operation = UUID().uuidString
        preferences.set(operation, forKey: key)
        let body: [String:Any] = ["name":"Davies practice · " + String(operation.prefix(8)), "parents":["root"],
                                  "appProperties":["kittyPractice":marker,"kittyPracticeOperation":operation]]
        let file: [String:Any]
        do {
            file = try await drive("/drive/v3/files/" + source.sheetID + "/copy",
                query:["fields":GoogleSheetSelection.driveFields, "ignoreDefaultVisibility":"true"], body:body)
        } catch let failure as GoogleSheetTools.Failure where failure.code == "copy_rejected" {
            preferences.removeObject(forKey:key)
            throw failure
        }
        let made = try verify(file, operation: operation)
        preferences.removeObject(forKey:key)
        return made
    }

    private func verify(_ file: [String:Any], operation: String?) throws -> Copy {
        guard GoogleSheetSelection.ownedPrivateFile(file, permissionID: api.selected.permissionID),
              let access = file["permissions"] as? [[String:Any]],
              access.filter({ $0["deleted"] as? Bool != true }).count == 1,
              let props = file["appProperties"] as? [String:String], props["kittyPractice"] == marker,
              let stamp = props["kittyPracticeOperation"], UUID(uuidString: stamp) != nil,
              operation == nil || stamp == operation, let id = file["id"] as? String,
              let name = file["name"] as? String, !name.isEmpty, name.utf8.count <= 250 else {
            throw GoogleSheetTools.Failure(code:"copy_unverified", message:"Google could not verify an owner-only practice copy. Choose your private v2 Sheet in Setup.")
        }
        return Copy(id:id, name:name, source:api.selected)
    }

    /// The public template's opt-in is copied too. Only the expressly chosen, app-created
    /// owner-only practice copy may be changed here. Re-read the setting on every return.
    static func disablePracticeFeed(owner: GoogleSheetSelection.Verified, api: GoogleSheetTools) async throws {
        guard owner.selection == api.selected, owner.isPracticeCopy, owner.canEdit,
              owner.selection.sheetID != GoogleSheetSelection.demoFileID else { throw api.invalid }
        func setting() async throws -> (Int,String) {
            let read = try await api.values("Kitty!A1:B", render:"UNFORMATTED_VALUE")
            guard let rows = read["values"] as? [[Any]] else { throw api.invalid }
            let matches = rows.enumerated().filter { $0.element.first as? String == "public_feed" }
            guard matches.count == 1, let only = matches.first, only.element.count == 2,
                  let current = only.element[1] as? String, ["no","yes"].contains(current) else { throw api.invalid }
            return (only.offset,current)
        }
        let (offset,before) = try await setting()
        if before == "no" { return }
        let meta = try await api.request(query:["fields":"spreadsheetId,sheets(properties(sheetId,title))"])
        guard meta["spreadsheetId"] as? String == owner.selection.sheetID, let sheets = meta["sheets"] as? [[String:Any]] else { throw api.invalid }
        let tabs = sheets.compactMap { $0["properties"] as? [String:Any] }.filter { $0["title"] as? String == "Kitty" }
        guard tabs.count == 1, let id = tabs.first?["sheetId"] as? Int else { throw api.invalid }
        let cell = ["sheetId":id,"startRowIndex":offset,"endRowIndex":offset+1,"startColumnIndex":1,"endColumnIndex":2]
        let replace: [String:Any] = ["find":"yes","replacement":"no","matchCase":true,"matchEntireCell":true,
                                     "includeFormulas":false,"range":cell]
        do { _ = try await api.request(path:":batchUpdate",method:"POST",body:["requests":[["findReplace":replace]]]) }
        catch { try api.check() }
        let (afterRow,after) = try await setting()
        guard afterRow == offset, after == "no" else {
            throw GoogleSheetTools.Failure(code:"practice_feed",message:"Google could not verify the practice copy’s private feed setting.")
        }
    }

    private func drive(_ path: String, query: [String:String], body: [String:Any]? = nil) async throws -> [String:Any] {
        try api.check()
        let token = try await api.token(api.selected)
        try api.check()
        var url = URLComponents()
        url.scheme = "https"; url.host = "www.googleapis.com"; url.path = path
        url.queryItems = query.map { URLQueryItem(name:$0.key,value:$0.value) }
        guard let dest = url.url else { throw api.invalid }
        var req = URLRequest(url:dest)
        req.setValue("Bearer " + token, forHTTPHeaderField:"Authorization")
        if let body {
            req.httpMethod = "POST"; req.setValue("application/json", forHTTPHeaderField:"Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject:body)
        }
        let result = try await api.http.send(req, maximumBytes:256_000)
        try api.check()
        guard (200...299).contains(result.statusCode) else {
            let rejected = [400,401,403,404].contains(result.statusCode)
            throw GoogleSheetTools.Failure(code:rejected ? "copy_rejected" : "copy_pending",
                message:rejected ? "Google could not open this practice copy. Check your Drive access." : "Check the practice copy again in Setup.")
        }
        guard let obj = try JSONSerialization.jsonObject(with:result.data) as? [String:Any] else { throw api.invalid }
        return obj
    }
}
