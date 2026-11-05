import XCTest
@testable import Kitty

@MainActor
final class GooglePeriodBankJournalTests: XCTestCase {
    typealias Object = [String: Any]
    typealias Journal = GooglePeriodBankJournal
    final class Memory: BankStore {
        var held: BankBinding?, all = [BankBinding](), blobs = [String: Data]()
        var generated = 0, eligibility = true, loseActionResponse = false
        var markers = [Int:Object]()
        var highestIssued = 0, entryFacts = [[Any]]()
        func issuedTransactionNumber() async throws -> Int { highestIssued }
        func currentEntryFacts() async throws -> [[Any]] { entryFacts }
        var beforeFence: (() throws -> Void)?
        var loseFenceResponse = false
        func checkNewWrite(_ owner: GoogleSheetSelection.Verified) async throws {
            guard eligibility else { throw GoogleBankStore.invalid }
        }
        func ids() async throws -> [String] {
            generated += 1
            return (0..<4).map { "fictional_file_\(generated)_\($0)" }
        }
        func gate() async throws -> BankBinding? { held }
        func marker(_ id: Int) async throws -> Object? { markers[id] }
        func fence(_ b: BankBinding, id: Int) async throws -> Object? {
            guard held == b else { throw GoogleBankStore.pending }
            try beforeFence?()
            if let old = markers[id] { return old }
            markers[id] = try GoogleBankStore.tombstone(b,id:id)
            if loseFenceResponse { loseFenceResponse = false; throw URLError(.networkConnectionLost) }
            return markers[id]
        }
        func acquire(_ b: BankBinding) async throws -> BankBinding {
            if let held { return held }
            held = b; all.append(b); return b
        }
        func release(_ b: BankBinding) async throws { if held == b { held = nil } }
        func blob(_ kind: BankBlob, _ b: BankBinding) async throws -> Data? { blobs[kind.id(b)] }
        func create(_ kind: BankBlob, _ b: BankBinding, data: Data) async throws -> (createdHere: Bool, bytes: Data) {
            let id = kind.id(b)
            if let old = blobs[id] { return (false,old) }
            blobs[id] = data
            if kind == .action && loseActionResponse { loseActionResponse = false; return (false,data) }
            return (true,data)
        }
        func finished(digest: String?, scope: String?) async throws -> BankBinding? {
            var cancelled: BankBinding?
            var committed = [(String,BankBinding)]()
            for b in all {
                let s = try b.scope
                guard (digest != nil && b.digest == digest) || (scope != nil && s == scope),
                      let bytes = blobs[b.receiptID], let record = try JSONSerialization.jsonObject(with:bytes) as? Object else { continue }
                if let kind = record["kind"] as? String, ["verified","needs-review"].contains(kind) { committed.append((kind,b)) }
                else { cancelled = b }
            }
            if scope != nil, !committed.isEmpty { return try GoogleBankStore.latest(committed) }
            return committed.first?.1 ?? cancelled
        }
        func manualSource(_ key: String) async throws -> BankBinding? {
            for b in all where b.sourceKey == key {
                if let data = blobs[b.receiptID], let record = try JSONSerialization.jsonObject(with:data) as? Object,
                   record["kind"] as? String == "needs-review" { return b }
            }
            return nil
        }
    }
    struct Offline: GoogleHTTPTransport {
        func send(_ request: URLRequest, maximumBytes: Int) async throws -> GoogleHTTPResponse { throw GoogleBankStore.invalid }
    }
    let selected = GoogleConnection.Selection(permissionID:"fictional_owner",sheetID:"fictional_private_sheet",sessionID:UUID())
    var owner: GoogleSheetSelection.Verified { .init(selection:selected,title:"Fictional",canEdit:true) }
    var api: GoogleSheetTools { .init(http:Offline(),selected:selected,current:{self.selected},token:{_ in "fictional"}) }
    let day = "2027-02-10", month = "2027-02", account = "ACC-CC"
    func sample(_ name: String = "CAFE", cents: Double = 4.50, followingValuation: Bool = false, followingPosting: Bool = false,
                issuedFloor: Int? = nil) throws -> (SourceDocument,Object,PeriodBankAppend) {
        let csv = "Date,Description,Card Member,Account #,Amount\n02/02/2027,\(name),Joint,1234,\(cents)\n"
        let source = SourceDocument(name:"fictional.csv",mimeType:"text/csv",bytes:Data(csv.utf8))
        let settled = "2027-02-02"
        let priorT = followingPosting ? "T0002" : "T0001", nextT = String(format:"T%04d",(issuedFloor ?? (followingPosting ? 2 : 1))+1)
        let row: [Any] = [nextT,"transaction",settled,account,name,name,-cents,"UNCAT","Joint","","","settled",settled,"","","","","","","bank export"]
        let last = followingValuation || followingPosting ? 3 : 2, anchor = followingValuation ? "V0001" : priorT
        var assumptions: Object = ["entries_rows":last-1,"last_entry_row":last,"last_entry_id":anchor,"last_ids":["T":priorT]]
        if let issuedFloor { assumptions["transaction_id_floor"] = issuedFloor }
        let plan: Object = ["schema":"kitty-write-plan/1","status":"ready","sheet":["version":2,"id":selected.sheetID],"deferred":[],
          "assumes":assumptions,
          "preconditions":[["range":"Entries!A\(last):A\(last+1)","expect":[[anchor],[]]]],
          "writes":[["id":"entries-1","tab":"Entries","op":"append","range":"Entries!A\(last+1):T\(last+1)","rows":1,"columns":PeriodBankAppend.columns,"values":[row]]]]
        return (source,plan,try .init(plan:plan,sheetID:selected.sheetID,account:account,original:source,originalSHA256:source.id))
    }
    func service(_ sample: (SourceDocument,Object,PeriodBankAppend), _ store: Memory, expectedTicket: String? = nil,
                 scanAPI: GoogleSheetTools? = nil, replacesTicket: String? = nil, observation: Journal.Observe? = nil) -> Journal {
        Journal(api:scanAPI ?? api,store:store,original:sample.0,plan:sample.1,month:month,downloadDay:day,expectedTicket:expectedTicket,
                replacesTicket:replacesTicket,observe:observation ?? PeriodBankReadback.read,replan:{source,account,month,day in
            XCTAssertEqual(source.bytes,sample.0.bytes); XCTAssertEqual(account,self.account); XCTAssertEqual(month,self.month); XCTAssertEqual(day,self.day)
            return sample.2
        })
    }
    @MainActor final class Sheet {
        let store: Memory?
        init(_ store: Memory? = nil) { self.store = store }
        var baseIDs = ["Entry ID","T0001"], writtenIDs = [String]()
        var marker: Object?, cells = [Object](), applied = 0, deliveries = 0, dirty = false
        func observe(_ batch: PeriodBankAppend, _ owner: GoogleSheetSelection.Verified, _ api: GoogleSheetTools) async throws -> PeriodBankAppend.Observation {
            let found = store == nil ? marker : store?.markers[batch.markerID]
            return .init(sheetID:batch.sheetID,entriesTabID:8,headers:PeriodBankAppend.columns,
                         ids:baseIDs + (dirty ? ["T0009"] : []) + writtenIDs,
                         firstRow:batch.firstRow,cells:found == nil || cells.isEmpty ? [] : [cells],marker:found)
        }
        func apply(_ requests: [Object]) throws {
            deliveries += 1
            // Google rejects the whole atomic batch if its specifically requested metadata ID already exists.
            let m = try XCTUnwrap((requests.first?["createDeveloperMetadata"] as? Object)?["developerMetadata"] as? Object)
            let mid = try XCTUnwrap(m["metadataId"] as? Int)
            if store == nil ? marker != nil : store?.markers[mid] != nil { throw GoogleBankStore.pending }
            let write = try XCTUnwrap(requests.compactMap { $0["updateCells"] as? Object }.first)
            var row = try XCTUnwrap((write["rows"] as? [Object])?.first?["values"] as? [Object])
            for r in requests.compactMap({ $0["repeatCell"] as? Object }) {
                let index = try XCTUnwrap((r["range"] as? [String:Int])?["startColumnIndex"])
                row[index]["userEnteredFormat"] = (r["cell"] as? Object)?["userEnteredFormat"]
            }
            marker = m; store?.markers[mid] = m; cells = row; applied += 1
            writtenIDs.append(try XCTUnwrap((row[0]["userEnteredValue"] as? Object)?["stringValue"] as? String))
            store?.entryFacts.append(row.prefix(7).map { cell in
                let value = cell["userEnteredValue"] as? Object
                return value?["stringValue"] ?? value?["numberValue"] ?? ""
            })
            if let store, let issued = (requests.last?["createDeveloperMetadata"] as? Object)?["developerMetadata"] as? Object,
               issued["metadataKey"] as? String == PeriodBankAppend.issuedKey, let raw = issued["metadataValue"] as? String,
               let first = raw.split(separator:"|").first, let t = Int(first) { store.highestIssued = max(t,store.highestIssued) }
        }
    }
    func packets(_ batch: PeriodBankAppend, sheet: Sheet) async throws -> [Object] {
        let b = sheet.store?.held
        let bound = try batch.usingMarkerID(b?.receiptMarkerID,recordsIssuedIDs:(b?.version ?? 1) >= 3)
        let before = try await sheet.observe(bound,owner,api)
        guard case .batch(let requests) = try bound.next(before,stage:.prepared,freshlyPlanned:batch) else { throw GoogleBankStore.invalid }
        return requests
    }

    func testAbandonedDispatchFencesLatePacketsAndANewGenerationCanUseSameUnallocatedTNumber() async throws {
        let old = try sample(), store = Memory(), sheet = Sheet(store)
        let j = service(old,store); _ = try await j.reserve(old.2,owner:owner)
        let b = try XCTUnwrap(store.held), oldPacket = try await packets(old.2,sheet:sheet)
        try await j.markDispatched(old.2,owner:owner)
        // The old destination is now stale but the next transaction number is still T0002.
        sheet.baseIDs.append("V0001"); store.blobs[b.sourceID] = nil
        let before = try await Journal.lookup(owner:owner,api:api,store:store,digest:nil,scope:nil,observe:sheet.observe)
        XCTAssertEqual(before?.phase,.dispatched); XCTAssertEqual(before?.canDiscard,true)
        store.loseFenceResponse = true
        do { _ = try await Journal.cancel(owner:owner,api:api,store:store,digest:b.digest,ticket:b.ticket,observe:sheet.observe,allowFence:true); XCTFail("Lost fence response reported success") } catch {}
        XCTAssertEqual(store.held,b); XCTAssertNil(store.blobs[b.receiptID])
        let recovered = try await Journal.lookup(owner:owner,api:api,store:store,digest:nil,scope:nil,observe:sheet.observe)
        XCTAssertEqual(recovered?.phase,.cancelled); XCTAssertNil(store.held)
        XCTAssertThrowsError(try sheet.apply(oldPacket)); XCTAssertEqual(sheet.applied,0)
        let next = try sample("BAKERY",cents:0.07,followingValuation:true), nextJournal = service(next,store)
        XCTAssertEqual(next.2.markerID,old.2.markerID)
        _ = try await nextJournal.reserve(next.2,owner:owner)
        let active = try XCTUnwrap(store.held), authorized = try nextJournal.authorizedBatch(next.2,owner:owner)
        XCTAssertEqual(active.receiptMarkerID,authorized.markerID); XCTAssertNotEqual(authorized.markerID,old.2.markerID)
        try await nextJournal.markDispatched(authorized,owner:owner)
        try sheet.apply(await packets(authorized,sheet:sheet))
        let result = try await Journal.lookup(owner:owner,api:api,store:store,digest:active.digest,scope:nil,observe:sheet.observe)
        XCTAssertEqual(result?.phase,.verified); XCTAssertEqual(sheet.writtenIDs,["T0002"])
        XCTAssertThrowsError(try sheet.apply(oldPacket))
        XCTAssertEqual(store.markers[old.2.markerID]?["metadataKey"] as? String,GoogleBankStore.abandonedKey)
    }

    func testDelayedOriginalWinsDiscardAndHistoricalClassificationEditsRemainVerified() async throws {
        let s = try sample(), store = Memory(), sheet = Sheet(store), j = service(s,store)
        _ = try await j.reserve(s.2,owner:owner); let b = try XCTUnwrap(store.held)
        let original = try await packets(s.2,sheet:sheet); try await j.markDispatched(s.2,owner:owner)
        store.beforeFence = { try sheet.apply(original) }
        let won = try await Journal.cancel(owner:owner,api:api,store:store,digest:b.digest,ticket:b.ticket,observe:sheet.observe,allowFence:true)
        XCTAssertEqual(won.phase,.verified); XCTAssertEqual(sheet.applied,1); XCTAssertNil(store.held)
        sheet.cells[7] = ["userEnteredValue":["stringValue":"GROCERIES"]]
        let edited = try await Journal.lookup(owner:owner,api:api,store:store,digest:b.digest,scope:nil,observe:sheet.observe)
        XCTAssertEqual(edited?.phase,.verified); XCTAssertEqual(edited?.evidence,.recategorised)
        XCTAssertEqual(store.markers[s.2.markerID]?["metadataKey"] as? String,PeriodBankAppend.guardKey)
        sheet.writtenIDs = []; sheet.cells = []; store.entryFacts = []
        let deleted = try await Journal.lookup(owner:owner,api:api,store:store,digest:b.digest,scope:nil,observe:sheet.observe)
        XCTAssertEqual(deleted?.phase,.removed); XCTAssertEqual(deleted?.removedIDFloor,2); XCTAssertEqual(deleted?.canDiscard,false)
        let receipt = try XCTUnwrap(try JSONSerialization.jsonObject(with:XCTUnwrap(store.blobs[b.receiptID])) as? Object)
        XCTAssertEqual(receipt["kind"] as? String,"verified")
    }

    func testForeignPermanentMarkerIsNeverModifiedOrCalledCancelled() async throws {
        let s = try sample(), store = Memory(), sheet = Sheet(store), j = service(s,store)
        _ = try await j.reserve(s.2,owner:owner); try await j.markDispatched(s.2,owner:owner)
        let b = try XCTUnwrap(store.held)
        store.markers[s.2.markerID] = ["metadataId":s.2.markerID,"metadataKey":"foreign","metadataValue":"unchanged"]
        let status = try await Journal.cancel(owner:owner,api:api,store:store,digest:b.digest,ticket:b.ticket,observe:sheet.observe,allowFence:true)
        XCTAssertEqual(status.phase,.needsReview); XCTAssertFalse(status.canDiscard); XCTAssertFalse(status.canReleaseForReview)
        let refused = try await Journal.closeForReview(owner:owner,api:api,store:store,digest:b.digest,ticket:b.ticket,observe:sheet.observe)
        XCTAssertFalse(refused.manuallyClosed)
        XCTAssertEqual(store.held,b); XCTAssertNil(store.blobs[b.receiptID]); XCTAssertEqual(store.markers[s.2.markerID]?["metadataValue"] as? String,"unchanged")
    }

    func testPostedButEditedBeforeVerificationCanOnlyBeClosedForManualReviewAndBlocksOnlyThatSource() async throws {
        let s = try sample(), store = Memory(), sheet = Sheet(store), journal = service(s,store)
        _ = try await journal.reserve(s.2,owner:owner)
        let b = try XCTUnwrap(store.held), packet = try await packets(s.2,sheet:sheet)
        try await journal.markDispatched(s.2,owner:owner); try sheet.apply(packet)
        sheet.cells[7] = ["userEnteredValue":["stringValue":"GROCERIES"]]
        let issue = try await Journal.cancel(owner:owner,api:api,store:store,digest:b.digest,ticket:b.ticket,observe:sheet.observe,allowFence:true)
        XCTAssertEqual(issue.phase,.needsReview); XCTAssertTrue(issue.canReleaseForReview); XCTAssertFalse(issue.manuallyClosed)
        XCTAssertEqual(store.held,b); XCTAssertNil(store.blobs[b.receiptID])
        let closed = try await Journal.closeForReview(owner:owner,api:api,store:store,digest:b.digest,ticket:b.ticket,observe:sheet.observe)
        XCTAssertEqual(closed.phase,.needsReview); XCTAssertTrue(closed.manuallyClosed); XCTAssertFalse(closed.canReleaseForReview)
        XCTAssertNil(store.held); XCTAssertEqual(sheet.applied,1); XCTAssertEqual(store.markers[s.2.markerID]?["metadataKey"] as? String,PeriodBankAppend.guardKey)
        let terminal = try XCTUnwrap(try JSONSerialization.jsonObject(with:XCTUnwrap(store.blobs[b.receiptID])) as? Object)
        XCTAssertEqual(terminal["kind"] as? String,"needs-review")
        let replay = try await Journal.lookup(owner:owner,api:api,store:store,digest:nil,scope:try b.scope,observe:sheet.observe)
        XCTAssertEqual(replay?.phase,.needsReview); XCTAssertEqual(replay?.manuallyClosed,true)
        let same = try sample(followingPosting:true)
        do { _ = try await service(same,store).reserve(same.2,owner:owner); XCTFail("Manual receipt allowed a new import of the same source") }
        catch let error as GoogleSheetTools.Failure { XCTAssertEqual(error.code,"import_needs_review") }
        let anotherDay = Journal(api:api,store:store,original:same.0,plan:same.1,month:month,downloadDay:"2027-02-15",
                                 replan:{_,_,_,_ in same.2})
        do { _ = try await anotherDay.reserve(same.2,owner:owner); XCTFail("Changing the export day bypassed manual closure") }
        catch let error as GoogleSheetTools.Failure { XCTAssertEqual(error.code,"import_needs_review") }
        XCTAssertNil(store.held)
        let next = try sample("GARDEN",followingPosting:true)
        _ = try await service(next,store).reserve(next.2,owner:owner)
        XCTAssertEqual(store.held?.digest,next.2.digest)
    }

    func testRESTAbandonmentUsesOnlyCreateAtOriginalPermanentIDAndReadsGoogleWinner() async throws {
        let s = try sample(), m = Memory(), j = service(s,m)
        _ = try await j.reserve(s.2,owner:owner); let b = try XCTUnwrap(m.held)
        let http = HTTP(), rest = GoogleBankStore(api:.init(http:http,selected:selected,current:{self.selected},token:{_ in "fictional"}))
        let held: Object = ["metadataId":GoogleBankStore.gateID,"metadataKey":GoogleBankStore.gateKey,"visibility":"DOCUMENT",
                           "location":["spreadsheet":true],"metadataValue":String(decoding:try b.data(),as:UTF8.self)]
        let genuine: Object = ["metadataId":s.2.markerID,"metadataKey":PeriodBankAppend.guardKey,"metadataValue":b.digest,
                              "visibility":"DOCUMENT","location":["sheetId":8]]
        func matched(_ record: Object) -> Object { ["matchedDeveloperMetadata":[["developerMetadata":record]]] }
        http.replies = [try http.json(matched(held)),try http.json([:]),try http.json([:],code:400),try http.json(matched(genuine))]
        let won = try await rest.fence(b,id:s.2.markerID)
        XCTAssertEqual(won?["metadataKey"] as? String,PeriodBankAppend.guardKey)
        let posts = http.requests.filter { $0.url?.path.hasSuffix(":batchUpdate") == true }
        XCTAssertEqual(posts.count,1)
        let input = try XCTUnwrap(try JSONSerialization.jsonObject(with:XCTUnwrap(posts[0].httpBody)) as? Object)
        let requests = try XCTUnwrap(input["requests"] as? [Object]); XCTAssertEqual(requests.count,1)
        XCTAssertEqual(Set(requests[0].keys),["createDeveloperMetadata"])
        let tombstone = try XCTUnwrap((requests[0]["createDeveloperMetadata"] as? Object)?["developerMetadata"] as? Object)
        XCTAssertEqual(try GoogleBankStore.abandonedOwner(tombstone,id:s.2.markerID),b)
    }

    private final class SlotScan: GoogleHTTPTransport {
        let sheetID: String
        var tab = 8, entries = [["Entry ID"],["T0001"]], decisions = [["Decision ID","Ref kind","Ref ID"]]
        var truncate: String?
        init(_ sheetID: String) { self.sheetID = sheetID }
        func send(_ request: URLRequest, maximumBytes: Int) async throws -> GoogleHTTPResponse {
            let result: Object
            if request.httpMethod == "GET" {
                let tabs: [Object] = [["properties":["sheetId":tab,"title":"Entries","gridProperties":["rowCount":200,"columnCount":21]]],
                                      ["properties":["sheetId":12,"title":"Decisions","gridProperties":["rowCount":100,"columnCount":8]]]]
                let query = URLComponents(url:try XCTUnwrap(request.url),resolvingAgainstBaseURL:false)?.queryItems ?? []
                result = ["spreadsheetId":sheetID,"sheets":query.contains(URLQueryItem(name:"ranges",value:"Entries!A1")) ? [tabs[0]] : tabs]
            } else {
                guard request.url?.path.hasSuffix("/values:batchGetByDataFilter") == true else { throw GoogleBankStore.invalid }
                let input = try XCTUnwrap(try JSONSerialization.jsonObject(with:XCTUnwrap(request.httpBody)) as? Object)
                let ranges = try XCTUnwrap(input["dataFilters"] as? [[String:String]])
                XCTAssertEqual(Set(ranges.compactMap { $0["a1Range"] }),["Entries!A1:A200","Decisions!A1:C100"])
                let matches: [Object] = try ranges.map { filter in
                    let a1 = try XCTUnwrap(filter["a1Range"]), ledger = a1.hasPrefix("Entries!")
                    let returned = a1 == truncate ? (ledger ? "Entries!A1:A2" : "Decisions!A1:C2") : a1
                    return ["dataFilters":[filter],"valueRange":["range":returned,"majorDimension":"ROWS","values":ledger ? entries : decisions]]
                }
                result = ["spreadsheetId":sheetID,"valueRanges":matches]
            }
            return .init(statusCode:200,data:try JSONSerialization.data(withJSONObject:result))
        }
    }
    private func scanAPI(_ scan: SlotScan) -> GoogleSheetTools {
        .init(http:scan,selected:selected,current:{self.selected},token:{_ in "synthetic"})
    }
    func testAnotherCSVAfterVerifiedOrManuallyClosedTailDeletionUsesANewFenceAndPreservesTheOldEvidence() async throws {
        for manual in [false,true] {
            let store = Memory(), sheet = Sheet(store), original = try sample(), scan = SlotScan(selected.sheetID)
            let first = service(original,store)
            _ = try await first.reserve(original.2,owner:owner); let old = try XCTUnwrap(store.held)
            let packet = try await packets(original.2,sheet:sheet); try await first.markDispatched(original.2,owner:owner)
            try sheet.apply(packet)
            if manual {
                sheet.cells[7] = ["userEnteredValue":["stringValue":"GROCERIES"]]
                let closed = try await Journal.closeForReview(owner:owner,api:api,store:store,digest:old.digest,ticket:old.ticket,observe:sheet.observe)
                XCTAssertTrue(closed.manuallyClosed)
            } else {
                let confirmed = try await Journal.lookup(owner:owner,api:api,store:store,digest:old.digest,scope:nil,observe:sheet.observe)
                XCTAssertEqual(confirmed?.phase,.verified)
            }
            let oldReceipt = try XCTUnwrap(store.blobs[old.receiptID]), oldMarker = try XCTUnwrap(store.markers[original.2.markerID])
            sheet.writtenIDs.removeAll(); sheet.cells.removeAll(); store.entryFacts = []
            let stale = try sample("NEW CAFE",cents:6.17)
            do { _ = try await service(stale,store).reserve(stale.2,owner:owner); XCTFail("Deleted ID was reissued") } catch {}
            let replacement = try sample("NEW CAFE",cents:6.17,issuedFloor:2), journal = service(replacement,store,scanAPI:scanAPI(scan))
            let initial = try await Journal.lookup(owner:owner,api:api,store:store,digest:old.digest,scope:nil,observe:sheet.observe)
            XCTAssertEqual(initial?.phase,manual ? .needsReview : .removed)
            scan.decisions.append(["D-1","contract","T0002"]) // Only entry-linked Decisions are reapplied to entries.
            _ = try await journal.reserve(replacement.2,owner:owner)
            let next = try XCTUnwrap(store.held), authorized = try journal.authorizedBatch(replacement.2,owner:owner)
            XCTAssertNotEqual(authorized.markerID,original.2.markerID); XCTAssertEqual(next.receiptMarkerID,authorized.markerID)
            try await journal.markDispatched(authorized,owner:owner); try sheet.apply(await packets(authorized,sheet:sheet))
            let verified = try await Journal.lookup(owner:owner,api:api,store:store,digest:next.digest,scope:nil,observe:sheet.observe)
            XCTAssertEqual(verified?.phase,.verified); XCTAssertEqual(sheet.writtenIDs,["T0003"])
            XCTAssertThrowsError(try sheet.apply(packet))
            XCTAssertEqual(store.blobs[old.receiptID],oldReceipt)
            XCTAssertEqual(try JSONSerialization.data(withJSONObject:oldMarker,options:.sortedKeys),
                           try JSONSerialization.data(withJSONObject:XCTUnwrap(store.markers[original.2.markerID]),options:.sortedKeys))
        }
    }

    func testExplicitSameFileReplacementUsesFreshIDsAndTheNextReplayResolvesOnlyItsVerifiedSuccessor() async throws {
        let store = Memory(), sheet = Sheet(store), original = try sample()
        let first = service(original,store,observation:sheet.observe)
        _ = try await first.reserve(original.2,owner:owner)
        let old = try XCTUnwrap(store.held), oldPacket = try await packets(original.2,sheet:sheet)
        try await first.markDispatched(original.2,owner:owner); try sheet.apply(oldPacket)
        let saved = try await Journal.lookup(owner:owner,api:api,store:store,digest:nil,scope:try old.scope,observe:sheet.observe)
        XCTAssertEqual(saved?.phase,.verified); XCTAssertEqual(store.highestIssued,2)
        let oldReceipt = try XCTUnwrap(store.blobs[old.receiptID])
        // Only the old ID disappeared. Recreated movement under another ID must still block a second copy.
        sheet.writtenIDs.removeAll(); sheet.cells.removeAll()
        store.entryFacts[0][0] = "T0099"
        let copied = try await Journal.lookup(owner:owner,api:api,store:store,digest:old.digest,scope:nil,observe:sheet.observe)
        XCTAssertEqual(copied?.phase,.needsReview)
        store.entryFacts = []; sheet.baseIDs.append("T0002")
        let moved = try await Journal.lookup(owner:owner,api:api,store:store,digest:old.digest,scope:nil,observe:sheet.observe)
        XCTAssertEqual(moved?.phase,.needsReview)
        sheet.baseIDs.removeLast()
        let removed = try await Journal.lookup(owner:owner,api:api,store:store,digest:nil,scope:try old.scope,observe:sheet.observe)
        XCTAssertEqual(removed?.phase,.removed); XCTAssertEqual(removed?.removedIDFloor,2)
        let fresh = try sample(issuedFloor:2)
        for wrongTicket in [nil,String(repeating:"f",count:64)] as [String?] {
            do { _ = try await service(fresh,store,replacesTicket:wrongTicket,observation:sheet.observe).reserve(fresh.2,owner:owner); XCTFail("A new explicit approval is required") } catch {}
            XCTAssertNil(store.held)
        }
        let successor = service(fresh,store,replacesTicket:old.ticket,observation:sheet.observe)
        _ = try await successor.reserve(fresh.2,owner:owner)
        let next = try XCTUnwrap(store.held)
        XCTAssertEqual(next.replacesTicket,old.ticket); XCTAssertEqual(next.issuedThrough,3)
        let pending = try await Journal.lookup(owner:owner,api:api,store:store,digest:nil,scope:try old.scope,observe:sheet.observe)
        XCTAssertEqual(pending?.pendingIDFloor,2)
        _ = try await successor.replan(fresh.2,owner:owner)
        let packet = try await packets(fresh.2,sheet:sheet)
        try await successor.markDispatched(fresh.2,owner:owner); try sheet.apply(packet)
        let done = try await Journal.lookup(owner:owner,api:api,store:store,digest:nil,scope:try old.scope,observe:sheet.observe)
        XCTAssertEqual(done?.phase,.verified); XCTAssertEqual(done?.ticket,next.ticket); XCTAssertNil(store.held)
        let replay = try await Journal.lookup(owner:owner,api:api,store:store,digest:nil,scope:try old.scope,observe:sheet.observe)
        XCTAssertEqual(replay?.digest,next.digest); XCTAssertEqual(store.highestIssued,3)
        XCTAssertEqual(sheet.writtenIDs,["T0003"]); XCTAssertThrowsError(try sheet.apply(oldPacket))
        XCTAssertEqual(store.blobs[old.receiptID],oldReceipt); XCTAssertNotNil(store.blobs[next.receiptID])
        XCTAssertNotNil(store.markers[old.receiptMarkerID!]); XCTAssertNotNil(store.markers[next.receiptMarkerID!])
        let fork = BankBinding(version:3,sheetID:next.sheetID,owner:next.owner,account:next.account,
            sourceSHA256:next.sourceSHA256,digest:String(repeating:"9",count:64),month:next.month,downloadDay:next.downloadDay,rowCount:1,
            sourceID:"fictional_fork_original",manifestID:"fictional_fork_manifest",actionID:"fictional_fork_action",receiptID:"fictional_fork_receipt",
            receiptMarkerID:321,issuedThrough:4,replacesTicket:old.ticket)
        XCTAssertThrowsError(try GoogleBankStore.latest([("verified",old),("verified",next),("verified",fork)]))
        XCTAssertThrowsError(try GoogleBankStore.latest([("verified",next)]))
    }

    func testIssuedTIsAuthenticatedFromLegacyArchiveWhenNoWatermarkExists() async throws {
        let old = try sample(), store = Memory(), sheet = Sheet(store)
        let b = BankBinding(version:2,sheetID:selected.sheetID,owner:selected.permissionID,account:account,sourceSHA256:old.0.id,
             digest:old.2.digest,month:month,downloadDay:day,rowCount:1,sourceID:"legacy_fixture_source",manifestID:"legacy_fixture_manifest",
             actionID:"legacy_fixture_action",receiptID:"legacy_fixture_receipt",receiptMarkerID:old.2.markerID)
        func json(_ v: Object) throws -> Data { try JSONSerialization.data(withJSONObject:v,options:[.sortedKeys,.withoutEscapingSlashes]) }
        store.all = [b]; store.blobs[b.sourceID] = old.0.bytes
        store.blobs[b.manifestID] = try json(["kind":"reviewed","binding":b.object,"originalName":old.0.name,
                                             "amountEncoding":PeriodBankAppend.manifestAmountEncoding,"plan":PeriodBankAppend.planForManifest(old.1)])
        store.blobs[b.actionID] = try json(["kind":"dispatch","binding":b.object])
        store.blobs[b.receiptID] = try json(["kind":"verified","binding":b.object])
        store.markers[b.receiptMarkerID!] = ["metadataId":old.2.markerID,"metadataKey":PeriodBankAppend.guardKey,
            "metadataValue":b.digest,"visibility":"DOCUMENT","location":["sheetId":8]]
        let issued = try await Journal.legacyIssuedNumber(digest:b.digest,id:old.2.markerID,tab:8,store:store,api:api)
        XCTAssertEqual(issued,2)
        do { _ = try await Journal.legacyIssuedNumber(digest:b.digest,id:999,tab:8,store:store,api:api); XCTFail("Wrong permanent ID accepted") } catch {}
        let originalReceipt = store.blobs[b.receiptID]
        let removed = try await Journal.lookup(owner:owner,api:api,store:store,digest:nil,scope:try b.scope,observe:sheet.observe)
        XCTAssertEqual(removed?.phase,.removed); XCTAssertEqual(removed?.removedIDFloor,2)
        store.highestIssued = issued
        let fresh = try sample(issuedFloor:issued), j = service(fresh,store,replacesTicket:b.ticket,observation:sheet.observe)
        _ = try await j.reserve(fresh.2,owner:owner); let successor = try XCTUnwrap(store.held)
        let pending = try await Journal.lookup(owner:owner,api:api,store:store,digest:nil,scope:try b.scope,observe:sheet.observe)
        XCTAssertEqual(pending?.pendingIDFloor,2)
        let secondDevice = service(fresh,store,expectedTicket:successor.ticket,observation:sheet.observe)
        _ = try await secondDevice.reserve(fresh.2,owner:owner); try await secondDevice.markDispatched(fresh.2,owner:owner)
        let result = try await Journal.retry(owner:owner,api:api,store:store,digest:successor.digest,ticket:successor.ticket,
            replan:{ _,_,_,_ in try self.sample(issuedFloor:try XCTUnwrap(pending?.pendingIDFloor)).2 },observe:sheet.observe,send:sheet.apply)
        XCTAssertEqual(result.phase,.verified); XCTAssertEqual(result.ticket,successor.ticket); XCTAssertEqual(sheet.writtenIDs,["T0003"])
        XCTAssertEqual(store.blobs[b.receiptID],originalReceipt); XCTAssertEqual(store.highestIssued,3)
        store.blobs[b.sourceID] = nil
        do { _ = try await Journal.legacyIssuedNumber(digest:b.digest,id:old.2.markerID,tab:8,store:store,api:api); XCTFail("Unverifiable legacy allocation accepted") }
        catch let error as GoogleSheetTools.Failure { XCTAssertTrue(error.message.contains("Restore")) }
    }

    func testIssuedMarkerAndPrivateMaximumUseBoundedReadsAndRejectChangedOrUnpairedIssuance() async throws {
        let memory = Memory(), s = try sample(issuedFloor:2), session = selected
        _ = try await service(s,memory).reserve(s.2,owner:owner); let b = try XCTUnwrap(memory.held), id = try XCTUnwrap(b.receiptMarkerID)
        let http = HTTP(), rest = GoogleBankStore(api:.init(http:http,selected:session,current:{session},token:{_ in "fictional"}))
        let receipt = try JSONSerialization.data(withJSONObject:["kind":"verified","binding":b.object],options:[.sortedKeys,.withoutEscapingSlashes])
        let sheetKey = SourceDocument.sha256(Data((b.sheetID + "\u{0}" + b.owner).utf8))
        let tags = ["kittyBankKind":"receipt","kittyBankDigest":b.digest,"kittyBankScope":try b.scope,"kittyBankIntent":b.manifestID,"kittyBankTerminal":"verified",
                    "kittyBankIssuedSheet":sheetKey,"kittyBankIssuedT":"3","kittyBankIssuedMarker":String(id)]
        let file: Object = ["id":b.receiptID,"mimeType":"application/json","trashed":false,"ownedByMe":true,"owners":[["permissionId":b.owner]],
                            "permissions":[["id":b.owner,"type":"user","role":"owner"]],"size":String(receipt.count),"appProperties":tags]
        let posted: Object = ["metadataId":id,"metadataKey":PeriodBankAppend.guardKey,"metadataValue":b.digest,"visibility":"DOCUMENT","location":["sheetId":8]]
        func stamp(_ n: Int) -> Object { ["metadataId":1234,"metadataKey":PeriodBankAppend.issuedKey,"metadataValue":"\(n)|\(b.digest)","visibility":"DOCUMENT","location":["spreadsheet":true]] }
        func pack(_ markers: [Object]) throws -> [GoogleHTTPResponse] {
            [try http.json(["matchedDeveloperMetadata":markers.map{["developerMetadata":$0]}]),
             try http.json(["files":[["id":b.receiptID,"appProperties":tags]],"incompleteSearch":false]),
             try http.json(["spreadsheetId":b.sheetID,"sheets":[["properties":["sheetId":8,"title":"Entries"]]]])]
        }
        http.replies = try pack([posted,stamp(3)]) + [http.json(file),.init(statusCode:200,data:receipt)]
        let first = try await rest.issuedTransactionNumber(); XCTAssertEqual(first,3); XCTAssertEqual(http.requests.count,5)
        http.replies = try pack([posted,stamp(3)])
        let warm = try await rest.issuedTransactionNumber(); XCTAssertEqual(warm,3); XCTAssertEqual(http.requests.count,8)
        for invalid in [[posted,stamp(2)],[stamp(3)],[posted,stamp(3),stamp(3)]] {
            http.replies = try pack(invalid)
            do { _ = try await rest.issuedTransactionNumber(); XCTFail("Changed or unpaired issuance accepted") } catch {}
        }
        http.replies = [try http.json([:]),try http.json(["files":[],"incompleteSearch":true])]
        do { _ = try await rest.issuedTransactionNumber(); XCTFail("Incomplete metadata search accepted") } catch {}
    }

    func testGenerationRefusesAnyRemainingArchivedIDOrEntryDecisionAndRequiresAuthenticCompleteEvidence() async throws {
        let store = Memory(), basic = try sample(), scan = SlotScan(selected.sheetID)
        let text = String(decoding:basic.0.bytes,as:UTF8.self) + "03/02/2027,SECOND,Joint,1234,2.50\n"
        let source = SourceDocument(name:"two.csv",mimeType:"text/csv",bytes:Data(text.utf8))
        var plan = basic.1, w = try XCTUnwrap((plan["writes"] as? [Object])?.first)
        let row = try XCTUnwrap((w["values"] as? [[Any]])?.first); var second = row
        second[0] = "T0003"; second[2] = "2027-02-03"; second[4] = "SECOND"; second[5] = "SECOND"; second[6] = -2.50; second[12] = second[2]
        w["range"] = "Entries!A3:T4"; w["rows"] = 2; w["values"] = [row,second]; plan["writes"] = [w]
        let batch = try PeriodBankAppend(plan:plan,sheetID:selected.sheetID,account:account,original:source,originalSHA256:source.id)
        let oldJournal = service((source,plan,batch),store)
        _ = try await oldJournal.reserve(batch,owner:owner); let old = try XCTUnwrap(store.held)
        try await oldJournal.markDispatched(batch,owner:owner)
        store.markers[batch.markerID] = ["metadataId":batch.markerID,"metadataKey":PeriodBankAppend.guardKey,"metadataValue":old.digest,
                                         "visibility":"DOCUMENT","location":["sheetId":8]]
        let receipt = try JSONSerialization.data(withJSONObject:["kind":"verified","binding":old.object],options:[.sortedKeys,.withoutEscapingSlashes])
        store.blobs[old.receiptID] = receipt
        store.held = nil
        let next = try sample("NEW CAFE"), nextJournal = service(next,store,scanAPI:scanAPI(scan))
        func refused(_ code: String? = nil) async throws {
            do { _ = try await nextJournal.reserve(next.2,owner:owner); XCTFail("Unproved slot reuse was allowed") }
            catch { if let code { XCTAssertEqual((error as? GoogleSheetTools.Failure)?.code,code) } }
            XCTAssertNil(store.held); XCTAssertEqual(store.blobs[old.receiptID],receipt)
        }
        // T0002 is no longer at its old address, but moved T0003 still belongs to this very same archived batch.
        scan.entries += [[],["V0001"],["T0003"]]; try await refused("import_marker_conflict")
        scan.entries = [["Entry ID"],["T0001"]]
        scan.decisions += [[],["D-2","entry","T0003"]]; try await refused("import_decision_reference")
        scan.decisions = [["Decision ID","Ref kind","Ref ID"]]
        scan.truncate = "Decisions!A1:C100"; try await refused("invalid_response")
        scan.truncate = nil; scan.tab = 19; try await refused("import_marker_conflict")
        scan.tab = 8; store.blobs[old.sourceID] = Data("changed".utf8); try await refused()
        // The original stamp covers both T0002 and T0003, even though its slot marker is at the first ID only.
        store.blobs[old.sourceID] = source.bytes; store.highestIssued = batch.lastTransactionNumber
        let partialTail = try sample("NEW CAFE",followingPosting:true)
        do { _ = try await service(partialTail,store).reserve(partialTail.2,owner:owner); XCTFail("A vacant T0003 marker bypassed its issued ID") }
        catch let error as PeriodBankAppend.Failure { XCTAssertEqual(error,.staleLedger) }
        let above = try sample("NEW CAFE",followingPosting:true,issuedFloor:3)
        _ = try await service(above,store).reserve(above.2,owner:owner); XCTAssertEqual(above.2.rows.map(\.id),["T0004"])
    }
    func testTwoDevicesRecoverDispatchGapAndDelayedFirstBatchCannotDuplicate() async throws {
        let sample = try sample(), journalStore = Memory(), sheet = Sheet()
        let a = service(sample,journalStore), b = service(sample,journalStore)
        _ = try await a.reserve(sample.2,owner:owner); _ = try await b.reserve(sample.2,owner:owner)
        let hold = try XCTUnwrap(journalStore.held)
        XCTAssertEqual(journalStore.generated,1); XCTAssertEqual(journalStore.blobs[hold.sourceID],sample.0.bytes)
        _ = try await a.replan(sample.2,owner:owner)
        journalStore.loseActionResponse = true
        do { try await a.markDispatched(sample.2,owner:owner); XCTFail("An unknown claim must not dispatch") } catch {}
        do { try await b.markDispatched(sample.2,owner:owner); XCTFail("A second observer must not dispatch") } catch {}
        let read = try await Journal.lookup(owner:owner,api:api,store:journalStore,digest:nil,scope:try hold.scope,observe:sheet.observe)
        XCTAssertEqual(read?.phase,.dispatched); XCTAssertEqual(sheet.deliveries,0)
        let originalRead = try await sheet.observe(sample.2,owner,api)
        guard case .batch(let originalDelivery) = try sample.2.next(originalRead,stage:.prepared,freshlyPlanned:sample.2) else { return XCTFail() }
        let recovered = try await Journal.retry(owner:owner,api:api,store:journalStore,digest:hold.digest,ticket:hold.ticket,
            replan:{source,_,_,_ in XCTAssertEqual(source.id,hold.sourceSHA256);return sample.2},observe:sheet.observe,send:{ requests in
                // The delayed first request reaches Google while the explicit retry is in transit.
                try sheet.apply(originalDelivery); try sheet.apply(requests)
            })
        XCTAssertEqual(recovered.phase,.verified); XCTAssertEqual(sheet.applied,1); XCTAssertEqual(sheet.deliveries,2); XCTAssertNil(journalStore.held)
        let historical = try await Journal.lookup(owner:owner,api:api,store:journalStore,digest:nil,scope:try hold.scope,observe:sheet.observe)
        XCTAssertEqual(historical?.phase,.verified); XCTAssertEqual(sheet.deliveries,2)
        journalStore.blobs[hold.sourceID] = Data("tampered".utf8)
        do { _ = try await Journal.lookup(owner:owner,api:api,store:journalStore,digest:hold.digest,scope:nil,observe:sheet.observe); XCTFail("Changed archive accepted") } catch {}
    }

    func testPreDispatchCancellationPersistsAndCannotClearANewerHold() async throws {
        let old = try sample(), next = try sample("BAKERY",cents:12.00), store = Memory(), sheet = Sheet()
        let j = service(old,store); _ = try await j.reserve(old.2,owner:owner)
        let first = try XCTUnwrap(store.held)
        do { _ = try await service(next,store).reserve(next.2,owner:owner); XCTFail("A competing source was admitted") } catch {}
        let other = try await Journal.lookup(owner:owner,api:api,store:store,digest:next.2.digest,scope:nil,observe:sheet.observe)
        XCTAssertEqual(other?.phase,.otherPending); XCTAssertEqual(other?.account,"")
        let cancelled = try await Journal.cancel(owner:owner,api:api,store:store,digest:old.2.digest,ticket:first.ticket,observe:sheet.observe)
        XCTAssertEqual(cancelled.phase,.cancelled); XCTAssertNil(store.held)
        _ = try await service(next,store).reserve(next.2,owner:owner)
        let newer = try XCTUnwrap(store.held)
        do { try await j.markDispatched(old.2,owner:owner); XCTFail("Cancelled review dispatched") } catch {}
        let recovered = try await Journal.lookup(owner:owner,api:api,store:store,digest:first.digest,scope:nil,observe:sheet.observe)
        XCTAssertEqual(recovered?.phase,.cancelled); XCTAssertEqual(store.held,newer)
        XCTAssertEqual(sheet.applied,0)
    }

    func testStaleTargetPrivacyChangeAndTamperedManifestBlockDelivery() async throws {
        let s = try sample(), store = Memory(), sheet = Sheet(), j = service(s,store)
        _ = try await j.reserve(s.2,owner:owner)
        let b = try XCTUnwrap(store.held)
        store.eligibility = false
        do { try await j.markDispatched(s.2,owner:owner); XCTFail("A public Sheet could dispatch") } catch {}
        XCTAssertNil(store.blobs[b.actionID]); store.eligibility = true
        try await j.markDispatched(s.2,owner:owner)
        sheet.dirty = true
        do {
            _ = try await Journal.retry(owner:owner,api:api,store:store,digest:b.digest,ticket:b.ticket,replan:{_,_,_,_ in s.2},observe:sheet.observe,send:sheet.apply)
            XCTFail("A changed ledger slot was overwritten")
        } catch {}
        XCTAssertEqual(sheet.applied,0); XCTAssertEqual(store.held,b)
        sheet.dirty = false; store.blobs[b.manifestID] = Data("{}".utf8)
        let pending = try await Journal.lookup(owner:owner,api:api,store:store,digest:b.digest,scope:nil,observe:sheet.observe)
        XCTAssertEqual(pending?.phase,.dispatched); XCTAssertEqual(pending?.canDiscard,true)
        do {
            _ = try await Journal.retry(owner:owner,api:api,store:store,digest:b.digest,ticket:b.ticket,replan:{_,_,_,_ in s.2},observe:sheet.observe,send:sheet.apply)
            XCTFail("A damaged intent was delivered")
        } catch {}
        XCTAssertNil(store.blobs[b.receiptID]); XCTAssertEqual(store.held,b)
    }

    func testCancelledTicketCannotCancelANewApprovalWithTheVerySameFinancialDigest() async throws {
        let s = try sample(), store = Memory(), sheet = Sheet()
        _ = try await service(s,store).reserve(s.2,owner:owner)
        let old = try XCTUnwrap(store.held)
        _ = try await Journal.cancel(owner:owner,api:api,store:store,digest:old.digest,ticket:old.ticket,observe:sheet.observe)
        do { _ = try await service(s,store,expectedTicket:old.ticket).reserve(s.2,owner:owner); XCTFail("Late Confirm started a new hold") } catch {}
        XCTAssertNil(store.held); XCTAssertEqual(store.generated,1)
        _ = try await service(s,store).reserve(s.2,owner:owner)
        let newest = try XCTUnwrap(store.held)
        XCTAssertNotEqual(old.ticket,newest.ticket); XCTAssertEqual(old.digest,newest.digest)
        let late = try await Journal.cancel(owner:owner,api:api,store:store,digest:old.digest,ticket:old.ticket,observe:sheet.observe)
        XCTAssertEqual(late.phase,.cancelled); XCTAssertEqual(store.held,newest); XCTAssertNil(store.blobs[newest.actionID])
    }

    func testPublicFeedRejectsAmbiguousDuplicatesAndNonstandardTruthyFlags() {
        for rows: [[Any]] in [[["public_feed","yes"]],[["public_feed",true]],[[" Public_Feed "," ENABLED "]],
                              [["public_feed",1]],[["public_feed","no"],[" public_feed ","yes"]]] {
            XCTAssertThrowsError(try GoogleBankStore.checkFeed(rows))
        }
        for rows: [[Any]] in [[],[["public_feed"," NO "],[ "another_setting","yes"]],[["public_feed",false]],[["public_feed",""]]] {
            XCTAssertNoThrow(try GoogleBankStore.checkFeed(rows))
        }
    }

    final class HTTP: GoogleHTTPTransport {
        var replies = [GoogleHTTPResponse](), requests = [URLRequest]()
        func send(_ request: URLRequest, maximumBytes: Int) async throws -> GoogleHTTPResponse {
            requests.append(request)
            guard !replies.isEmpty else { throw GoogleBankStore.invalid }
            return replies.removeFirst()
        }
        func json(_ object: Object, code: Int = 200) throws -> GoogleHTTPResponse {
            .init(statusCode:code,data:try JSONSerialization.data(withJSONObject:object))
        }
    }
    func testKnownDriveIDConflictReadsOriginalBytesAndRefusesChangedSharingBeforeMedia() async throws {
        let transport = HTTP(), s = try sample(), memory = Memory()
        _ = try await service(s,memory).reserve(s.2,owner:owner)
        let b = try XCTUnwrap(memory.held)
        let api = GoogleSheetTools(http:transport,selected:selected,current:{self.selected},token:{_ in "fictional"})
        let rest = GoogleBankStore(api:api)
        let tags = ["kittyBankKind":"original","kittyBankDigest":b.digest,"kittyBankScope":try b.scope,"kittyBankIntent":b.manifestID]
        let ownerACL = ["type":"user","role":"owner","id":selected.permissionID]
        let meta: Object = ["id":b.sourceID,"mimeType":"text/csv","trashed":false,"ownedByMe":true,
            "owners":[["permissionId":selected.permissionID]],"permissions":[ownerACL],"size":String(s.0.byteLength),"appProperties":tags]
        transport.replies = [try transport.json([:],code:404),try transport.json([:],code:409),try transport.json(meta),.init(statusCode:200,data:s.0.bytes)]
        let saved = try await rest.create(.original,b,data:s.0.bytes)
        XCTAssertFalse(saved.createdHere); XCTAssertEqual(saved.bytes,s.0.bytes)
        XCTAssertEqual(transport.requests.map(\.httpMethod),["GET","POST","GET","GET"])
        let upload = try XCTUnwrap(transport.requests[1].url)
        XCTAssertEqual(upload.host,"www.googleapis.com"); XCTAssertEqual(upload.path,"/upload/drive/v3/files")
        XCTAssertTrue(upload.query?.contains("ignoreDefaultVisibility=true") == true)
        XCTAssertTrue(String(decoding:try XCTUnwrap(transport.requests[1].httpBody),as:UTF8.self).contains(b.sourceID))
        var shared = meta; shared["permissions"] = [ownerACL,["type":"anyone","role":"reader","id":"public"]]
        transport.replies = [try transport.json(shared)]
        do { _ = try await rest.blob(.original,b); XCTFail("A public archive was accepted") } catch {}
        XCTAssertEqual(transport.requests.count,5,"Reject the ACL before reading any media")
    }

    func testFixedSheetGateCollisionAndExactConditionalReleaseNeverReplaceAnotherHolder() async throws {
        let transport = HTTP(), s = try sample(), memory = Memory()
        _ = try await service(s,memory).reserve(s.2,owner:owner)
        let b = try XCTUnwrap(memory.held), raw = String(decoding:try b.data(),as:UTF8.self)
        let rest = GoogleBankStore(api:.init(http:transport,selected:selected,current:{self.selected},token:{_ in "fictional"}))
        let gate: Object = ["metadataId":GoogleBankStore.gateID,"metadataKey":GoogleBankStore.gateKey,"metadataValue":raw,
                           "visibility":"DOCUMENT","location":["spreadsheet":true]]
        let held: Object = ["matchedDeveloperMetadata":[["developerMetadata":gate]]]
        transport.replies = [try transport.json([:],code:400),try transport.json(held)]
        let recovered = try await rest.acquire(b)
        XCTAssertEqual(recovered,b)
        transport.replies = [try transport.json(held),try transport.json(["replies":[[:]]]),try transport.json([:])]
        try await rest.release(b)
        let remove = try XCTUnwrap(try JSONSerialization.jsonObject(with:XCTUnwrap(transport.requests[3].httpBody)) as? Object)
        let request = try XCTUnwrap((remove["requests"] as? [Object])?.first?["deleteDeveloperMetadata"] as? Object)
        let filter = try XCTUnwrap((request["dataFilter"] as? Object)?["developerMetadataLookup"] as? Object)
        XCTAssertEqual(filter["metadataValue"] as? String,raw); XCTAssertEqual(filter["metadataId"] as? Int,GoogleBankStore.gateID)
        var foreign = gate; foreign["metadataKey"] = "unrelated"
        transport.replies = [try transport.json(["matchedDeveloperMetadata":[["developerMetadata":foreign]]])]
        do { _ = try await rest.gate(); XCTFail("Arbitrary fixed-slot metadata accepted") } catch {}
        XCTAssertEqual(transport.requests.count,6)
    }
}
