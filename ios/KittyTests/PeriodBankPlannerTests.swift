import XCTest
@testable import Kitty

@MainActor
final class PeriodBankPlannerTests: XCTestCase {
    private typealias Object = [String: Any]
    private let selected = GoogleConnection.Selection(permissionID: "fictional", sheetID: "private_fictional_planner_sheet", sessionID: UUID())
    private final class Transport: GoogleHTTPTransport {
        let sheetID: String
        var tables: [String: [[Any]]]
        var shorten = false
        var requests: [String] = []
        init(sheetID: String) {
            self.sheetID = sheetID
            tables = [
                "Kitty": [["Key", "Value"], ["sheet_version", 2], ["currency", "AUD"]],
                "Accounts": [["Account ID","Account","Institution","Type","Owner","Opening balance ($)","Opening date","Balance at as-of date ($)","Liquid","Class","Valuation method","Currency","Status","Purpose","Linked account","Note"],
                    ["ACC-CC","Card","Southern Card","Credit card","Joint",0,46022,0,"Yes","Cash","ledger","AUD","active"]],
                "Entries": [PeriodBankAppend.columns, ["T0001","transaction",46404,"ACC-CC","EXISTING","Existing",-7.85,"UNCAT","Joint"]],
                "Categories": [["Category ID","Category","Group","Flow","Monthly budget ($)","Essential","Tax treatment","ATO label"],["UNCAT","Uncategorised","Other","Expense"]],
                "Rules":[["Rule ID","Pattern","Match","Merchant","Category ID","Person","Tax label","Property","Source","Note"]],
                "Decisions":[["Decision ID","Ref kind","Ref ID","Decision","Value","By","At","Note"]],
                "Contracts":[["Contract ID","Kind","Name","Provider","Owner","Account ID","Category ID","Cadence","Amount ($)","Rate","Start date","End date","Next date","Last used","Cover","Status","Note"]],
                "Payslips":[["Pay date","Person","Employer","Gross pay","Tax withheld","Super (employer)","Net pay"]],
                "Assets":[["Item ID"]],"Loans":[["Loan ID"]]
            ]
        }
        func send(_ request: URLRequest, maximumBytes: Int) async throws -> GoogleHTTPResponse {
            let path = request.url?.path ?? ""; requests.append(path)
            let output: [String: Any]
            if request.httpMethod == "GET" {
                let sheets = tables.keys.map { ["properties":["title":$0,"gridProperties":["rowCount":2000,"columnCount":26]]] }
                output = ["spreadsheetId":sheetID,"sheets":sheets]
            } else {
                XCTAssertEqual(path,"/v4/spreadsheets/" + sheetID + "/values:batchGetByDataFilter")
                let body = try XCTUnwrap(try JSONSerialization.jsonObject(with: request.httpBody ?? Data()) as? [String:Any])
                XCTAssertEqual(body["valueRenderOption"] as? String,"UNFORMATTED_VALUE")
                let filters = try XCTUnwrap(body["dataFilters"] as? [[String:String]])
                let responses = try filters.reversed().map { filter -> [String:Any] in
                    let a1 = try XCTUnwrap(filter["a1Range"]), tab = String(a1.split(separator:"!")[0])
                    let returned = shorten && tab == "Entries" ? "Entries!A1:T2" : a1
                    return ["dataFilters":[filter],"valueRange":["range":returned,"majorDimension":"ROWS","values":try XCTUnwrap(tables[tab])]]
                }
                output = ["spreadsheetId":sheetID,"valueRanges":responses]
            }
            return .init(statusCode:200,data:try JSONSerialization.data(withJSONObject:output))
        }
    }
    private func context(_ transport: Transport, editable: Bool = true) -> (GoogleSheetSelection.Verified, GoogleSheetTools) {
        let owner = GoogleSheetSelection.Verified(selection:selected,title:"Practice",canEdit:editable,canImportBankFiles:editable)
        let api = GoogleSheetTools(http:transport, selected:selected, current:{ self.selected }, token:{ _ in "synthetic" })
        return (owner,api)
    }
    private var source: SourceDocument {
        .init(name:"demo-2027-02.csv",mimeType:"text/csv",bytes:Data("\u{feff}Date,Description,Card Member,Account #,Amount\r\n02/02/2027,SHOP 🐱,Joint,1234,12.34\r\n03/02/2027,REFUND,Joint,1234,-1.23\r\n".utf8))
    }
    func testFreshReadRunsBundledCanonicalPlannerAgainstExactOriginalAndSigns() async throws {
        let net = Transport(sheetID:selected.sheetID), (owner,api) = context(net)
        let original = source
        let p = try await PeriodBankPlanner.prepare(original:original,account:"ACC-CC",month:"2027-02",downloadDay:"2027-02-28",owner:owner,api:api)
        XCTAssertEqual(p.summary["sourceID"] as? String, original.id)
        XCTAssertEqual(p.summary["byteLength"] as? Int, original.byteLength)
        let rows = try XCTUnwrap(p.summary["rows"] as? [Object])
        XCTAssertEqual(rows.compactMap { $0["signedAmount"] as? String }, ["-12.34","+1.23"])
        XCTAssertEqual(p.batch?.rows.count,2)
        XCTAssertEqual(p.batch?.destination,"Entries!A3:T4")
        XCTAssertEqual(net.requests.count,2)
    }
    func testSignedSevenCentAndZeroOriginalsRestoreTheReviewedPlannerDigest() async throws {
        let (owner, api) = context(Transport(sheetID: selected.sheetID))
        let document = SourceDocument(name: "small-card.csv", mimeType: "text/csv", bytes: Data("""
            Date,Description,Card Member,Account #,Amount
            02/02/2027,SMALL CHARGE,Joint,1234,0.07
            03/02/2027,SMALL REFUND,Joint,1234,-0.07
            04/02/2027,PRINTED ZERO,Joint,1234,0.00
            """.utf8))
        let preview = try await PeriodBankPlanner.prepare(original: document, account: "ACC-CC", month: "2027-02",
                                                           downloadDay: "2027-02-28", owner: owner, api: api)
        let reviewed = try XCTUnwrap(preview.batch)
        let summaryRows = try XCTUnwrap(preview.summary["rows"] as? [Object])
        XCTAssertEqual(summaryRows.compactMap { $0["signedAmount"] as? String }, ["-0.07", "+0.07", "+0.00"])
        for encoding in [nil, PeriodBankAppend.manifestAmountEncoding] {
            let stored = encoding == nil ? preview.plan : try PeriodBankAppend.planForManifest(preview.plan)
            let bytes = try JSONSerialization.data(withJSONObject: stored)
            let decoded = try XCTUnwrap(JSONSerialization.jsonObject(with: bytes) as? Object)
            let plan = try PeriodBankAppend.restoredPlan(decoded, amountEncoding: encoding)
            let batch = try PeriodBankAppend(plan: plan, sheetID: selected.sheetID, account: "ACC-CC",
                                             original: document, originalSHA256: document.id)
            XCTAssertEqual(batch.digest, reviewed.digest)
            XCTAssertEqual(batch.markerID, reviewed.markerID)
        }
    }

    func testSurvivingDecisionsAndDurableFloorNeverRetargetAPartiallyDeletedImport() async throws {
        let net = Transport(sheetID: selected.sheetID), (owner, api) = context(net), document = source
        func preview(_ floor: Int = 0) async throws -> PeriodBankPlanner.Preview {
            try await PeriodBankPlanner.prepare(original: document, account: "ACC-CC", month: "2027-02", downloadDay: "2027-02-28",
                                                owner: owner, api: api, transactionIDFloor: floor)
        }
        let initial = try await preview(), archived = try XCTUnwrap(initial.batch)
        XCTAssertEqual(archived.rows.map(\.id), ["T0002","T0003"])
        let day = try XCTUnwrap(GoogleSheetDay.serial("2027-02-02"))
        let kept: [Any] = ["T0002","transaction",day,"ACC-CC","SHOP 🐱","Shop",-12.34,"UNCAT","Joint"]
        net.tables["Entries"]?.append(kept)
        net.tables["Decisions"]?.append(["D1","entry","T0003","categorise","GROCERIES"])
        let single = try await preview()
        XCTAssertEqual(single.batch?.rows.map(\.id), ["T0004"])
        XCTAssertEqual(single.summary["duplicateCount"] as? Int, 1)
        net.tables["Decisions"]?.append(["D2","entry","T0001","match_transfer","T0005"])
        let transfer = try await preview()
        XCTAssertEqual(transfer.batch?.rows.map(\.id), ["T0006"])
        let high = try await preview(12), batch = try XCTUnwrap(high.batch)
        XCTAssertEqual(batch.rows.map(\.id), ["T0013"])
        let assumptions = try XCTUnwrap(high.plan["assumes"] as? Object)
        XCTAssertEqual((assumptions["last_ids"] as? [String: String])?["T"], "T0002")
        XCTAssertEqual(assumptions["transaction_id_floor"] as? Int, 12)
        XCTAssertEqual(batch.firstRow, 4)
        XCTAssertFalse(batch.hasSameSourceRows(as: archived))
        let seen = PeriodBankAppend.Observation(sheetID: selected.sheetID, entriesTabID: 8, headers: PeriodBankAppend.columns,
            ids: ["Entry ID","T0001","T0002"], firstRow: batch.firstRow, cells: [], marker: nil)
        let current = try batch.usingMarkerID(nil, recordsIssuedIDs: true)
        guard case .batch(let requests) = try current.next(seen, stage: .prepared, freshlyPlanned: batch) else { return XCTFail("Physical tail and issued floor must be checked independently") }
        let watermark = try XCTUnwrap((requests.last?["createDeveloperMetadata"] as? Object)?["developerMetadata"] as? Object)
        XCTAssertEqual(watermark["metadataKey"] as? String, PeriodBankAppend.issuedKey)
        XCTAssertEqual(watermark["metadataValue"] as? String, "13|" + batch.digest)
        XCTAssertEqual(watermark["location"] as? [String: Bool], ["spreadsheet": true])
        XCTAssertEqual(watermark["visibility"] as? String, "DOCUMENT")
        XCTAssertNil(watermark["metadataId"])
        var renamed = kept; renamed[0] = "T0099"; renamed[4] = " shop \u{1c} 🐱 "
        XCTAssertTrue(try archived.hasSourceMovement(in: [renamed]))
        renamed[6] = 12.34
        XCTAssertFalse(try archived.hasSourceMovement(in: [renamed]))
        XCTAssertThrowsError(try archived.hasSourceMovement(in: [["T0099","transaction"]]))
        _ = net.tables["Entries"]?.popLast()
        let replacement = try await preview(13), whole = try XCTUnwrap(replacement.batch)
        XCTAssertEqual(whole.rows.map(\.id), ["T0014","T0015"])
        XCTAssertTrue(whole.hasSameSourceRows(as: archived))
    }
    func testLeadingSourceApostrophesReachLiteralGoogleCellsAndReplayWithoutNewEntries() async throws {
        let net = Transport(sheetID:selected.sheetID), (owner,api) = context(net)
        let original = SourceDocument(name:"card-2027-02.csv",mimeType:"text/csv",bytes:Data("""
            Date,Description,Card Member,Account #,Amount
            02/02/2027,'PLAIN,Joint,1234,12.34
            03/02/2027,''TWO,Joint,1234,-1.23
            04/02/2027,'\u{301}ACCENT,Joint,1234,4.50
            """.utf8))
        func prepare() async throws -> PeriodBankPlanner.Preview {
            try await PeriodBankPlanner.prepare(original:original,account:"ACC-CC",month:"2027-02",downloadDay:"2027-02-28",owner:owner,api:api)
        }
        let first = try await prepare(), batch = try XCTUnwrap(first.batch)
        let planWrites = try XCTUnwrap(first.plan["writes"] as? [Object])
        let planned = try XCTUnwrap(planWrites.first?["values"] as? [[Any]])
        XCTAssertEqual(planned.compactMap { $0[4] as? String }, ["''PLAIN","'''TWO","''\u{301}ACCENT"])
        let ids = try XCTUnwrap(net.tables["Entries"]).compactMap { $0.first as? String }
        let before = PeriodBankAppend.Observation(sheetID:selected.sheetID,entriesTabID:8,headers:PeriodBankAppend.columns,
                                                  ids:ids,firstRow:batch.firstRow,cells:[],marker:nil)
        guard case .batch(let requests) = try batch.next(before,stage:.prepared,freshlyPlanned:batch) else { return XCTFail("Expected an append") }
        let write = try XCTUnwrap(requests.compactMap { $0["updateCells"] as? Object }.first)
        let typedRows = try XCTUnwrap(write["rows"] as? [Object])
        let originals = ["'PLAIN","''TWO","'\u{301}ACCENT"]
        XCTAssertEqual(typedRows.count,originals.count)
        for (typed,expected) in zip(typedRows,originals) {
            let cells = try XCTUnwrap(typed["values"] as? [Object])
            XCTAssertEqual(cells[4]["userEnteredValue"] as? [String:String],["stringValue":expected])
            // Feed the actual typed payload back as a fresh, unformatted Google values response.
            let saved: [Any] = cells.map { cell in
                let value = cell["userEnteredValue"] as? Object
                return value?["stringValue"] ?? value?["numberValue"] ?? ""
            }
            net.tables["Entries"]?.append(saved)
        }
        let replay = try await prepare()
        XCTAssertNil(replay.batch)
        XCTAssertEqual((replay.plan["writes"] as? [Object])?.count,0)
        XCTAssertEqual(replay.summary["duplicateCount"] as? Int,3)
    }
    func testTruncatedReadAndReadOnlySelectionCannotProduceABatch() async throws {
        let net = Transport(sheetID:selected.sheetID); net.shorten = true
        let (owner,api) = context(net)
        do { _ = try await PeriodBankPlanner.prepare(original:source,account:"ACC-CC",month:"2027-02",downloadDay:"2027-02-28",owner:owner,api:api); XCTFail("Truncated live ledger accepted") }
        catch let error as GoogleSheetTools.Failure { XCTAssertEqual(error.code,"invalid_response") }
        let count = net.requests.count, (readOnly,_) = context(net,editable:false)
        do { _ = try await PeriodBankPlanner.prepare(original:source,account:"ACC-CC",month:"2027-02",downloadDay:"2027-02-28",owner:readOnly,api:api); XCTFail("Viewer received live write preparation") }
        catch let error as GoogleSheetTools.Failure { XCTAssertEqual(error.code,"not_granted") }
        XCTAssertEqual(net.requests.count,count)
    }
}
