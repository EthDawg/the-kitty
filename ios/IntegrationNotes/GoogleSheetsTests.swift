import Foundation

private enum CheckFailed: Error { case failed(String) }
private func check(_ value: @autoclosure () -> Bool, _ note: String) throws {
    if !value() { throw CheckFailed.failed(note) }
}

private final class MockGoogle: URLProtocol {
    static var requests: [URLRequest] = []
    static var handler: ((URLRequest) throws -> (Int, Any))!
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            Self.requests.append(request)
            let (status, body) = try Self.handler(request)
            let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: try JSONSerialization.data(withJSONObject: body))
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}

@main
struct GoogleSheetsChecks {
    @MainActor static func main() async throws {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockGoogle.self]
        let api = GoogleSheets(tokenProvider: { "synthetic-token" }, session: URLSession(configuration: config))
        let sheetID = "synthetic_sheet_id_for_tests_123456"

        func reset(_ handler: @escaping (URLRequest) throws -> (Int, Any)) {
            MockGoogle.requests = []
            MockGoogle.handler = handler
        }
        func range(_ name: String, _ values: [[Any]]) -> [String: Any] { ["range": name, "values": values] }
        func preflight(_ values: [[Any]], key: String = "Japan", version: Any = 1) -> [String: Any] {
            ["valueRanges": [range("Goals!B2:C2", values), range("Goals!A2", [[key]]), range("Kitty!A1:B", [["sheet_version", version]])]]
        }
        func readback(_ values: [[Any]], key: String = "Japan") -> [String: Any] {
            ["valueRanges": [range("Goals!B2:C2", values), range("Goals!A2", [[key]])]]
        }

        reset { req in
            try check(req.value(forHTTPHeaderField: "Authorization") == "Bearer synthetic-token", "bearer attached")
            try check(req.url!.absoluteString.contains("mimeType"), "listing filters spreadsheets")
            return (200, ["files": [["id": sheetID, "name": "Kitty demo copy"]]])
        }
        let files = try await api.listAccessibleFiles()
        try check(files.count == 1 && files[0].id == sheetID, "file decode")
        try check(files[0].canEdit == nil, "omitted capability stays unknown, not writable")
        print("PASS app-authorised file list")

        reset { req in
            try check(req.url!.path == "/drive/v3/files/\(sheetID)", "capability checks exact selected file")
            let fields = URLComponents(url: req.url!, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "fields" })?.value
            try check(fields == "id,capabilities(canEdit)", "requests only file identity and edit capability")
            return (200, ["id": sheetID, "capabilities": ["canEdit": false]])
        }
        let editable = try await api.canEdit(spreadsheetID: sheetID)
        try check(!editable, "a readable but view-only file is not offered editing")
        print("PASS read-only capability is distinct from read access")

        reset { _ in (200, ["id": "different_sheet_identity_123456", "capabilities": ["canEdit": true]]) }
        do {
            _ = try await api.canEdit(spreadsheetID: sheetID)
            throw CheckFailed.failed("capability from another file accepted")
        } catch GoogleSheets.ServiceError.invalidResponse {}
        print("PASS capability must belong to selected file")

        reset { _ in (200, ["files": [["id": sheetID, "name": "View-only family Sheet", "capabilities": ["canEdit": false]]]]) }
        let viewOnly = try await api.listAccessibleFiles()
        try check(viewOnly[0].canEdit == false, "nested Drive capability decoded")
        print("PASS chooser decodes view-only file")

        reset { _ in throw CheckFailed.failed("raw ledger write made a network request") }
        do {
            _ = try await api.writeAndVerify(spreadsheetID: sheetID, range: "Transactions!A2:J2", recordKey: "T0001", expected: [], replacement: [[.number(1)]])
            throw CheckFailed.failed("raw ledger write was accepted")
        } catch GoogleSheets.ServiceError.invalidWrite {}
        try check(MockGoogle.requests.isEmpty, "raw write refused before networking")
        print("PASS raw ledger / formula destination rejected")

        reset { _ in (200, preflight([[9000, 47000]])) }
        do {
            _ = try await api.writeAndVerify(spreadsheetID: sheetID, range: "Goals!B2:C2", recordKey: "Japan", expected: [[.number(12000), .number(47000)]], replacement: [[.number(13000), .number(47000)]])
            throw CheckFailed.failed("stale goal write was accepted")
        } catch GoogleSheets.ServiceError.conflict {}
        try check(MockGoogle.requests.count == 1 && MockGoogle.requests[0].httpMethod == "GET", "conflict never writes")
        print("PASS stale input blocked before write")

        reset { _ in (200, preflight([[12000, 47000]], version: 99)) }
        do {
            _ = try await api.writeAndVerify(spreadsheetID: sheetID, range: "Goals!B2:C2", recordKey: "Japan", expected: [[.number(12000), .number(47000)]], replacement: [[.number(13000), .number(47000)]])
            throw CheckFailed.failed("unknown version accepted")
        } catch GoogleSheets.ServiceError.unsupportedVersion {}
        try check(MockGoogle.requests.count == 1, "unknown version never writes")
        print("PASS unknown Sheet version blocked")

        reset { req in req.httpMethod == "PUT" ? (403, ["error": ["message": "PRIVATE diagnostic"]]) : (200, preflight([[12000, 47000]])) }
        do {
            _ = try await api.writeAndVerify(spreadsheetID: sheetID, range: "Goals!B2:C2", recordKey: "Japan", expected: [[.number(12000), .number(47000)]], replacement: [[.number(13000), .number(47000)]])
            throw CheckFailed.failed("read-only write accepted")
        } catch GoogleSheets.ServiceError.writePermissionDenied {
            try check(GoogleSheets.ServiceError.writePermissionDenied.localizedDescription.contains("edit access"), "actionable write permission message")
            try check(!GoogleSheets.ServiceError.writePermissionDenied.localizedDescription.contains("PRIVATE"), "diagnostic never reflected")
        }
        try check(MockGoogle.requests.map(\.httpMethod) == ["GET", "PUT"], "a denied write is neither retried nor reported as uncertain")
        print("PASS denied edit preserves precise permission failure")

        var getCount = 0
        reset { req in
            if req.httpMethod == "PUT" {
                try check(req.url!.absoluteString.contains("valueInputOption=RAW"), "values never evaluate formulas")
                return (200, ["updatedCells": 2])
            }
            getCount += 1
            return (200, getCount == 1 ? preflight([[12000, 47000]]) : readback([[13000, 47000]]))
        }
        let receipt = try await api.writeAndVerify(spreadsheetID: sheetID, range: "Goals!B2:C2", recordKey: "Japan", expected: [[.number(12000), .number(47000)]], replacement: [[.number(13000), .number(47000)]])
        try check(receipt.responseWasLost == false && receipt.values[0][0] == .number(13000), "readback verified")
        try check(MockGoogle.requests.map(\.httpMethod) == ["GET", "PUT", "GET"], "preflight-write-readback order")
        print("PASS exact readback required for save")

        getCount = 0
        reset { req in
            if req.httpMethod == "PUT" { throw URLError(.timedOut) }
            getCount += 1
            return (200, getCount == 1 ? preflight([[12000, 47000]]) : readback([[13000, 47000]]))
        }
        let recovered = try await api.writeAndVerify(spreadsheetID: sheetID, range: "Goals!B2:C2", recordKey: "Japan", expected: [[.number(12000), .number(47000)]], replacement: [[.number(13000), .number(47000)]])
        try check(recovered.responseWasLost, "lost response explicitly recorded")
        try check(MockGoogle.requests.filter { $0.httpMethod == "PUT" }.count == 1, "no retry after lost mutation response")
        print("PASS lost response reconciled without retry")

        getCount = 0
        reset { req in
            if req.httpMethod == "PUT" { return (200, ["updatedCells": 2]) }
            getCount += 1
            return (200, getCount == 1 ? preflight([[12000, 47000]]) : readback([[13000, 47000]], key: "Different goal"))
        }
        do {
            _ = try await api.writeAndVerify(spreadsheetID: sheetID, range: "Goals!B2:C2", recordKey: "Japan", expected: [[.number(12000), .number(47000)]], replacement: [[.number(13000), .number(47000)]])
            throw CheckFailed.failed("moved row verified")
        } catch GoogleSheets.ServiceError.conflict {}
        print("PASS moved row fails verification")

        try check(GoogleSheets.equalCells([[.string("x"), .empty]], [[.string("x")]]), "omitted blank equivalence")
        try check(!GoogleSheets.equalCells([[.number(1)]], [[.string("1")]]), "no string-number coercion")
        try check(GoogleSheets.dateSerial(Date(timeIntervalSince1970: 0)) == 25569, "Google epoch")
        print("PASS blank equivalence, strict types, date serial")
        print("12 Google access checks passed. Mock HTTP only; no Google account or live Sheet was used.")
    }
}
