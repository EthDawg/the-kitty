import XCTest
@testable import Kitty

@MainActor
final class PeriodBankAppendTests: XCTestCase {
    typealias Object = [String: Any]
    let sheetID = "fictional_existing_sheet_000001"
    let source = String(repeating: "a", count: 64)
    let ledger = ["Entry ID", "T0001", "V0001"]
    let selection = GoogleConnection.Selection(permissionID: "fictional", sheetID: "fictional_existing_sheet_000001", sessionID: UUID())

    func fixture(_ description: String = "'=MYSTERY PASTA") -> Object {
        let date = "2027-02-02"
        let row: [Any] = ["T0002", "transaction", date, "ACC-CC", description, "Mystery Pasta", -12.34, "UNCAT", "Joint", "", "", "settled", date, "", "", "", "", "", "", "bank export"]
        return ["schema": "kitty-write-plan/1", "status": "ready", "sheet": ["version": 2, "id": sheetID], "deferred": [],
                "assumes": ["entries_rows": 2, "last_entry_row": 3, "last_entry_id": "V0001", "last_ids": ["T": "T0001"]],
                "preconditions": [["range": "Entries!A3:A4", "expect": [["V0001"], []]]],
                "writes": [["id": "entries-1", "tab": "Entries", "op": "append", "range": "Entries!A4:T4", "rows": 1,
                            "columns": PeriodBankAppend.columns, "values": [row]]]]
    }
    func compile(_ plan: Object) throws -> PeriodBankAppend {
        try .init(plan: plan, sheetID: sheetID, account: "ACC-CC", originalSHA256: source)
    }
    func observation(_ p: PeriodBankAppend, _ ids: [String]? = nil, _ cells: [[Object]] = [], _ marker: Object? = nil) -> PeriodBankAppend.Observation {
        .init(sheetID: sheetID, entriesTabID: 8, headers: PeriodBankAppend.columns, ids: ids ?? ledger,
              firstRow: p.firstRow, cells: cells, marker: marker)
    }
    func requests(_ p: PeriodBankAppend) throws -> [Object] {
        guard case let .batch(requests) = try p.next(observation(p), stage: .prepared, freshlyPlanned: p) else { throw TestError.invalid }
        return requests
    }
    enum TestError: Error { case invalid }
    func receipt(_ p: PeriodBankAppend) throws -> (Object, [Object]) {
        let req = try requests(p)
        let marker = try XCTUnwrap((req[0]["createDeveloperMetadata"] as? Object)?["developerMetadata"] as? Object)
        let row = try XCTUnwrap(((req[2]["updateCells"] as? Object)?["rows"] as? [Object])?.first)
        var cells = try XCTUnwrap(row["values"] as? [Object])
        for formatRequest in req.dropFirst(3) {
            let repeatCell = try XCTUnwrap(formatRequest["repeatCell"] as? Object)
            let column = try XCTUnwrap((repeatCell["range"] as? [String: Int])?["startColumnIndex"])
            cells[column]["userEnteredFormat"] = (repeatCell["cell"] as? Object)?["userEnteredFormat"]
        }
        return (marker, cells)
    }

    func testBankTextIsLiteralWithNumericAmountsAndRealDatesOnlyInsideTheRawLedger() throws {
        let p = try compile(fixture()), req = try requests(p)
        XCTAssertEqual(req.count, 5)
        XCTAssertEqual(p.originalSHA256, source)
        XCTAssertEqual(p.account, "ACC-CC")
        let insert = try XCTUnwrap((req[1]["insertRange"] as? Object)?["range"] as? [String: Int])
        XCTAssertEqual(insert, ["sheetId": 8, "startRowIndex": 3, "endRowIndex": 4, "startColumnIndex": 0, "endColumnIndex": 20])
        let (_, cells) = try receipt(p)
        XCTAssertEqual(cells.count, 20)
        XCTAssertEqual(cells[4]["userEnteredValue"] as? [String: String], ["stringValue": "=MYSTERY PASTA"])
        XCTAssertEqual(cells[6]["userEnteredValue"] as? [String: Double], ["numberValue": -12.34])
        XCTAssertEqual((cells[2]["userEnteredValue"] as? [String: Int])?["numberValue"], GoogleSheetDay.serial("2027-02-02"))
        XCTAssertEqual(cells[12]["userEnteredFormat"] as? [String: [String: String]], ["numberFormat": GoogleSheetDay.numberFormat])
        XCTAssertTrue(cells[9].isEmpty)
        XCTAssertEqual(p.digest, try compile(fixture()).digest)
    }

    func testRejectsHeldForeignPartialSparseAndRetargetedPlansAsAWhole() throws {
        var variants: [Object] = []
        for (key, value): (String, Any) in [("status", "hold"), ("sheet", ["id": sheetID, "version": 1]), ("sheet", ["id": "other", "version": 2]),
                                           ("deferred", [["id": "later"]]), ("preconditions", []), ("writes", [])] {
            var d = fixture(); d[key] = value; variants.append(d)
        }
        let write = (fixture()["writes"] as! [Object])[0]
        for (key, value): (String, Any) in [("op", "update"), ("tab", "Contracts"), ("range", "Entries!A3:T3"), ("range", "Entries!A4:U4"), ("columns", ["Entry ID"])] {
            var d = fixture(), w = write; w[key] = value; d["writes"] = [w]; variants.append(d)
        }
        for (column, value): (Int, Any) in [(0, "T0099"), (1, "valuation"), (2, "2027-02-30"), (3, "ACC-OTHER"), (5, NSNull()), (6, true), (6, "-12.34"), (6, -12.344), (19, "manual")] {
            var d = fixture(), w = write, rows = write["values"] as! [[Any]]; rows[0][column] = value; w["values"] = rows; d["writes"] = [w]; variants.append(d)
        }
        for plan in variants { XCTAssertThrowsError(try compile(plan)) }
    }

    func testSameTailGuardContendsAcrossFilesAndLostReplyNeverResends() throws {
        let p = try compile(fixture()), competitor = try compile(fixture("DIFFERENT MERCHANT"))
        XCTAssertEqual(competitor.markerID, p.markerID)
        XCTAssertNotEqual(competitor.digest, p.digest)
        XCTAssertThrowsError(try p.next(observation(p), stage: .prepared))
        XCTAssertThrowsError(try p.next(observation(p), stage: .prepared, freshlyPlanned: competitor))
        guard case .waitingForReadback = try p.next(observation(p), stage: .dispatched) else { return XCTFail("Unconfirmed dispatch was retried") }
        let (marker, cells) = try receipt(p), ids = ledger + ["T0002"]
        guard case .verified = try p.next(observation(p, ids + ["T0003"], [cells], marker), stage: .dispatched) else { return XCTFail("Completed write not recovered") }
        XCTAssertThrowsError(try competitor.next(observation(competitor, ids, [cells], marker), stage: .prepared))
        XCTAssertThrowsError(try p.next(observation(p, ids, [cells], nil), stage: .dispatched))
        XCTAssertThrowsError(try p.next(observation(p, ledger + ["T0002", "T0002"], [cells], marker), stage: .dispatched))
        XCTAssertThrowsError(try p.next(observation(p, ledger, [[[:], ["userEnteredValue": ["formulaValue": "=1"]]]]), stage: .prepared))
    }

    func testAFormulaDisplayedAsTheRightNumberOrTextDateCannotVerify() throws {
        let p = try compile(fixture()), (marker, original) = try receipt(p)
        for (column, replacement): (Int, Object) in [(2, ["userEnteredValue": ["stringValue": "2027-02-02"]]),
                                                        (2, ["userEnteredValue": ["numberValue": GoogleSheetDay.serial("2027-02-02")!]]),
                                                        (6, ["userEnteredValue": ["formulaValue": "=-12.34"], "effectiveValue": ["numberValue": -12.34]]),
                                                        (6, ["userEnteredValue": ["numberValue": -12.33]]),
                                                        (4, ["userEnteredValue": ["formulaValue": "=MYSTERY PASTA"]]),
                                                        (9, ["userEnteredValue": ["boolValue": false]])] {
            var cells = original; cells[column] = replacement
            XCTAssertThrowsError(try p.next(observation(p, ledger + ["T0002"], [cells], marker), stage: .dispatched))
        }
    }

    final class Transport: GoogleHTTPTransport {
        var calls = [URLRequest]()
        var responses = [Object]()
        var loseBatchReply = false
        var onDispatch: (() -> Void)?
        func send(_ request: URLRequest, maximumBytes: Int) async throws -> GoogleHTTPResponse {
            calls.append(request)
            if request.url?.path.hasSuffix(":batchUpdate") == true {
                onDispatch?()
                if loseBatchReply { throw URLError(.timedOut) }
            }
            guard !responses.isEmpty else { throw TestError.invalid }
            return .init(statusCode: 200, data: try JSONSerialization.data(withJSONObject: responses.removeFirst()))
        }
    }
    func replies(_ p: PeriodBankAppend, start: Int, saved: (Object, [Object])? = nil) -> [Object] {
        let ids = ledger + (saved == nil ? [] : ["T0002"])
        var block: Object = ["startRow": start]
        if let saved { block["rowData"] = [["values": saved.1]] }
        return [["range": "Kitty!A1:B50", "majorDimension": "ROWS", "values": [["sheet_version", 2]]],
                ["range": "Entries!A1:T1", "majorDimension": "ROWS", "values": [PeriodBankAppend.columns]],
                ["range": "Entries!A1:A100", "majorDimension": "ROWS", "values": ids.map { [$0] }],
                ["spreadsheetId": sheetID, "sheets": [["properties": ["sheetId": 8, "title": "Entries", "gridProperties": ["rowCount": 100, "columnCount": 21]], "data": [block]]]],
                ["matchedDeveloperMetadata": saved.map { [["developerMetadata": $0.0]] } ?? []]]
    }

    func testReadbackRequiresCurrentEditableSelectionAndExactSheetRange() async throws {
        let p = try compile(fixture()), fake = Transport()
        let api = GoogleSheetTools(http: fake, selected: selection, current: { self.selection }, token: { _ in "fixture" })
        let viewer = GoogleSheetSelection.Verified(selection: selection, title: "Fake", canEdit: false)
        do { _ = try await PeriodBankReadback.read(p, owner: viewer, api: api); XCTFail("Viewer accepted") } catch {}
        XCTAssertTrue(fake.calls.isEmpty)
        let owner = GoogleSheetSelection.Verified(selection: selection, title: "Fake", canEdit: true)
        fake.responses = replies(p, start: 3)
        let observed = try await PeriodBankReadback.read(p, owner: owner, api: api)
        guard case .batch = try p.next(observed, stage: .prepared, freshlyPlanned: p) else { return XCTFail("Expected a fresh plan") }
        XCTAssertEqual(fake.calls.count, 5)
        XCTAssertTrue(fake.calls.allSatisfy { $0.url?.host == "sheets.googleapis.com" && $0.url!.path.contains(sheetID) })
        XCTAssertFalse(fake.calls.contains { $0.url!.path.hasSuffix(":batchUpdate") })
        fake.responses = replies(p, start: 2)
        do { _ = try await PeriodBankReadback.read(p, owner: owner, api: api); XCTFail("Shifted grid accepted") } catch {}
    }
    final class Journal: PeriodBankJournal {
        var stage = PeriodBankAppend.Stage.prepared
        var fresh: PeriodBankAppend
        var archiveVerified = true
        var receipts = [String]()
        init(_ fresh: PeriodBankAppend) { self.fresh = fresh }
        func reserve(_ batch: PeriodBankAppend, owner: GoogleSheetSelection.Verified) async throws -> PeriodBankAppend.Stage {
            guard archiveVerified else { throw TestError.invalid }; return stage
        }
        func replan(_ batch: PeriodBankAppend, owner: GoogleSheetSelection.Verified) async throws -> PeriodBankAppend { fresh }
        func markDispatched(_ batch: PeriodBankAppend, owner: GoogleSheetSelection.Verified) async throws { stage = .dispatched }
        func recordVerified(_ batch: PeriodBankAppend, owner: GoogleSheetSelection.Verified) async throws {
            if !receipts.contains(batch.digest) { receipts.append(batch.digest) }
        }
    }

    func testLostGoogleReplyAndSecondDeviceRecheckProduceOneLiteralBatchAndOneReceipt() async throws {
        let p = try compile(fixture()), fake = Transport(), journal = Journal(p)
        let api = GoogleSheetTools(http: fake, selected: selection, current: { self.selection }, token: { _ in "fixture" })
        let owner = GoogleSheetSelection.Verified(selection: selection, title: "Fake", canEdit: true)
        journal.archiveVerified = false
        do { _ = try await PeriodBankWriter.commit(p, owner: owner, api: api, journal: journal); XCTFail("Missing archive was ignored") } catch {}
        XCTAssertTrue(fake.calls.isEmpty)
        journal.archiveVerified = true
        fake.loseBatchReply = true
        fake.onDispatch = { XCTAssertEqual(journal.stage, .dispatched) }
        let saved = try receipt(p)
        fake.responses = replies(p, start: 3) + replies(p, start: 3, saved: saved)
        let first = try await PeriodBankWriter.commit(p, owner: owner, api: api, journal: journal)
        XCTAssertEqual(first, p.digest)
        fake.responses = replies(p, start: 3, saved: saved)
        let second = try await PeriodBankWriter.commit(p, owner: owner, api: api, journal: journal)
        XCTAssertEqual(second, first)
        XCTAssertEqual(journal.receipts, [p.digest])
        let posts = fake.calls.filter { $0.url!.path.hasSuffix(":batchUpdate") }
        XCTAssertEqual(posts.count, 1)
        let sent = try XCTUnwrap(try JSONSerialization.jsonObject(with: XCTUnwrap(posts.first?.httpBody)) as? Object)
        XCTAssertEqual((sent["requests"] as? [Object])?.count, 5)
    }

    func testUnknownDeliveryKeepsIntentAndRecheckDoesNotIssueAnotherWrite() async throws {
        let p = try compile(fixture()), fake = Transport(), journal = Journal(p)
        let api = GoogleSheetTools(http: fake, selected: selection, current: { self.selection }, token: { _ in "fixture" })
        let owner = GoogleSheetSelection.Verified(selection: selection, title: "Fake", canEdit: true)
        fake.loseBatchReply = true
        fake.responses = replies(p, start: 3) + replies(p, start: 3) + replies(p, start: 3)
        for _ in 0..<2 {
            do { _ = try await PeriodBankWriter.commit(p, owner: owner, api: api, journal: journal); XCTFail("Unknown import reported success") }
            catch let failure as GoogleSheetTools.Failure { XCTAssertEqual(failure.code, "import_pending") }
        }
        XCTAssertEqual(journal.stage, .dispatched)
        XCTAssertTrue(journal.receipts.isEmpty)
        XCTAssertEqual(fake.calls.filter { $0.url!.path.hasSuffix(":batchUpdate") }.count, 1)
    }

}
