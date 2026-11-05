import XCTest
import WebKit
@testable import Kitty

/// Opt in through the test run's environment, on the developer's physical iPhone only.
/// Uses the installed app's existing Picker grant. The read run never writes. A separately
/// named opt-in can make precisely one predetermined category choice on the public fixture.
@MainActor
final class LiveDeviceTests: XCTestCase {
    func testSelectedDaviesSheetDrivesTheDashboard() async throws {
        #if targetEnvironment(simulator)
        throw XCTSkip("This proof requires the physical iPhone.")
        #else
        let mode = ProcessInfo.processInfo.environment["KITTY_DEVICE_ACCEPTANCE"]
        guard ["davies-read","davies-category-T0761-DINING","davies-verify-T0761-DINING","davies-repair-G21"].contains(mode ?? "") else {
            throw XCTSkip("Opt-in real device check for the public fictional Sheet.")
        }
        // Keep the foreground test visible during Google reads; never change the device's lock settings.
        let idleWasDisabled = UIApplication.shared.isIdleTimerDisabled
        UIApplication.shared.isIdleTimerDisabled = true
        defer { UIApplication.shared.isIdleTimerDisabled = idleWasDisabled }
        if mode == "davies-repair-G21" { try await repairTheSingleOriginalDate() }
        let host = KittyViewController(websiteDataStore: .nonPersistent())
        let window = UIWindow(windowScene: try XCTUnwrap(UIApplication.shared.connectedScenes.first as? UIWindowScene))
        window.rootViewController = host; window.makeKeyAndVisible()
        defer { window.isHidden = true }
        host.loadViewIfNeeded()
        let page = try XCTUnwrap(host.webView)
        func js(_ code: String) async throws -> Any {
            try await page.callAsyncJavaScript(code, arguments: [:], in: nil, contentWorld: .page) ?? NSNull()
        }
        func wait(_ expression: String, timeout: Double = 20) async throws {
            let end = Date().addingTimeInterval(timeout)
            while Date() < end {
                if (try? await js("return Boolean(" + expression + ")")) as? Bool == true { return }
                try await Task.sleep(for: .milliseconds(200))
            }
            let status = try? await js("return [document.querySelector('#nativeconnection [role=status]')?.innerText,document.querySelector('#toast')?.textContent].join(' · ')")
            XCTFail("Phone did not satisfy " + expression + "; " + (status as? String ?? "no response"))
            throw NSError(domain: "KittyDeviceProof", code: 1)
        }
        try await wait("window.KittyNative?.ready")
        let configuredID = try await js("return window.KITTY_SHEET")
        guard configuredID as? String == GoogleSheetSelection.demoFileID else { XCTFail("Wrong fixture"); return }
        _ = try await js("window.KittyNative.openRoute('setup'); return true")
        try await wait("document.querySelector('#nativelive:not(:disabled)')")
        _ = try await js("document.querySelector('#nativelive').click(); return true")
        try await wait("document.querySelector('#trustpill.live') && !document.querySelector('#nativelive:disabled')", timeout: 100)
        _ = try await js("window.KittyNative.openRoute('home'); return true")
        // Re-read the owning metric independently of the rendered dashboard, through the real REST bridge.
        let record = try await js("""
            const mcp = await window.claude.use('mcp');
            const input = {spreadsheetId:window.KITTY_SHEET, range:'Metrics!A1:H'};
            const {payload} = await mcp.callTool('Google Sheets', 'get_values', input);
            const hdr = payload.values.find(r => r[0] === 'Metric ID');
            const row = payload.values.find(r => r[0] === 'networth.cash');
            const value = window.Engine.num(row[hdr.indexOf('Value')]);
            if (!Number.isFinite(value) || value <= 0) throw Error('Missing source cash metric');
            const source = window.Engine.fmt0(value);
            const end = Date.now() + 5000;
            while (document.querySelector('#heroval')?.textContent !== source && Date.now() < end)
              await new Promise(resolve => setTimeout(resolve, 100));
            return {fixture:'Digital Davies v2', mode:document.querySelector('#trustpill').innerText.trim(),
              hero:document.querySelector('#heroval')?.textContent, source, entries:window.__kittyPerf.entries(),
              review:document.querySelector('#v-home .rtile .t')?.textContent || 'None',
              checkedAt:new Date().toISOString()};
            """) as? [String: Any] ?? [:]
        XCTAssertEqual(record["mode"] as? String, "Live · demo sheet")
        XCTAssertEqual(record["hero"] as? String, record["source"] as? String)
        XCTAssertGreaterThan(record["entries"] as? Int ?? 0, 0)
        let proof = XCTAttachment(data: try JSONSerialization.data(withJSONObject: record, options: .sortedKeys),
                                  uniformTypeIdentifier: "public.json")
        proof.name = "Physical iPhone — fresh Google read"; proof.lifetime = .keepAlways; add(proof)
        let screenshot = XCTAttachment(image: try await page.takeSnapshot(configuration: nil))
        screenshot.name = "Home — live Digital Davies v2"; screenshot.lifetime = .keepAlways; add(screenshot)
        if mode != "davies-read" {
            let state = try await js("""
                const mcp = await window.claude.use('mcp'), f = async range =>
                  (await mcp.callTool('Google Sheets','get_values',{spreadsheetId:window.KITTY_SHEET,range})).payload.values || [];
                const row = (await f('Entries!A762:H762'))[0], decisions = await f('Decisions!A1:H');
                if (row?.[0]!=='T0761' || row[3]!=='ACC-CC' || row[4]!=='SQ *MARKET LANE' || window.Engine.num(row[6])!==-38.5) return 'different';
                const own=decisions.filter(r=>r[1]==='entry'&&r[2]==='T0761'&&r[3]==='categorise');
                if (row[7]==='DINING' && own.length===1 && own[0][4]==='DINING' && own[0][5]==='The Kitty on iPhone') return 'already verified';
                return row[7]==='UNCAT' && own.length===0 ? 'ready' : 'different';
                """) as? String
            guard state == "ready" || state == "already verified" else { XCTFail("Fictional demo no longer matches the single authorised choice; nothing written"); return }
            if mode != "davies-category-T0761-DINING" && state != "already verified" {
                XCTFail("Read-only check did not find the existing decision; no write was attempted"); return
            }
            if state == "ready" {
                _ = try await js("window.KittyNative.openRoute('review'); return true")
                try await wait("document.querySelector('[data-rid=T0761] [data-ract=cat]')")
                _ = try await js("document.querySelector('[data-rid=T0761] [data-ract=cat]').click(); return true")
                try await wait("document.querySelector('#drawer.on [data-pickcat=DINING]')")
                _ = try await js("document.querySelector('#drawer.on [data-pickcat=DINING]').click(); return true")
                try await wait("document.querySelector('#toast')?.textContent.includes('verified in Entries and Decisions')", timeout:150)
            }
            let saved = try await js("""
                const mcp=await window.claude.use('mcp'), get=async range =>
                  (await mcp.callTool('Google Sheets','get_values',{spreadsheetId:window.KITTY_SHEET,range})).payload.values || [];
                const row=(await get('Entries!A762:H762'))[0], all=await get('Decisions!A1:J');
                const hits=all.map((r,i)=>({r,n:i+1})).filter(({r})=>r[1]==='entry'&&r[2]==='T0761'&&r[3]==='categorise');
                if(row[0]!=='T0761'||row[7]!=='DINING'||hits.length!==1||hits[0].r[4]!=='DINING'||hits[0].r[5]!=='The Kitty on iPhone'||String(hits[0].r[8]).toUpperCase()!=='TRUE'||hits[0].r[9]!=='T0761|categorise') throw Error('Missing or ambiguous source readback or invalid Sheet formulas');
                window.KittyNative.openRoute('home');
                return {fixture:'Digital Davies v2',entry:row[0],entryCell:'Entries!H762',category:row[7],decisionID:hits[0].r[0],
                  decisionRow:hits[0].n,latest:hits[0].r[8],key:hits[0].r[9],review:document.querySelector('#v-home .rtile .t')?.textContent,at:new Date().toISOString()};
                """) as? [String:Any] ?? [:]
            XCTAssertEqual(saved["category"] as? String,"DINING")
            let receipt = XCTAttachment(data:try JSONSerialization.data(withJSONObject:saved),uniformTypeIdentifier:"public.json")
            receipt.name = "Physical iPhone — verified category in both Google tabs"; receipt.lifetime = .keepAlways; add(receipt)
            let after = XCTAttachment(image:try await page.takeSnapshot(configuration:nil))
            after.name = "Home — live after category choice"; after.lifetime = .keepAlways; add(after)
        }
        #endif
    }
    #if !targetEnvironment(simulator)
    /// One-time correction of our own initially text-typed audit date. No generic repair command
    /// is exposed to the page. This mode never touches a second row or replays the original save.
    private func repairTheSingleOriginalDate() async throws {
        let google = GoogleConnection(defaults:.standard)
        guard let selection = try await google.restore(), selection.sheetID == GoogleSheetSelection.demoFileID else { throw NSError(domain:"WrongFixture",code:1) }
        let probe = GoogleSheetSelection(http:GoogleHTTP(),current:{google.selection},token:{try await google.accessToken(for:$0)})
        let owner = try await probe.verify(selection); guard owner.canEdit else { throw GoogleSheetSelection.Failure.noAccess }
        let api = GoogleSheetTools(http:GoogleHTTP(),selected:selection,current:{google.selection},token:{try await google.accessToken(for:$0)})
        let decision = ["D-5ef74ed3-e1b7-4c1f-9bb2-049e2853b91a","entry","T0761","categorise","DINING","The Kitty on iPhone","2026-11-05",""]
        let writer = GoogleCategoryWriter()
        if (try? await writer.verifyRecord(decision,at:21,api:api)) != nil { return }
        let source = try await api.values("Entries!A762:H762",render:"UNFORMATTED_VALUE")
        let prior = try await api.values("Decisions!A21:J21",render:"UNFORMATTED_VALUE")
        guard let e = (source["values"] as? [[Any]])?.first, e.count == 8, e[0] as? String == "T0761",
              e[4] as? String == "SQ *MARKET LANE", (e[6] as? NSNumber)?.doubleValue == -38.5, e[7] as? String == "DINING",
              let r = (prior["values"] as? [[Any]])?.first, r.count >= 9,
              (0..<8).allSatisfy({ r[$0] as? String == decision[$0] }), (r[8] as? NSNumber)?.boolValue == false,
              r.count == 9 || r[9] as? String == "", let cell = GoogleSheetDay.cell(decision[6]) else { throw api.invalid }
        let meta = try await api.request(query:["fields":"spreadsheetId,sheets(properties(sheetId,title))"])
        let tabs = (meta["sheets"] as? [[String:Any]])?.compactMap { $0["properties"] as? [String:Any] }.filter { $0["title"] as? String == "Decisions" }
        guard meta["spreadsheetId"] as? String == selection.sheetID, tabs?.count == 1, let id = tabs?.first?["sheetId"] as? Int else { throw api.invalid }
        let slot = ["sheetId":id,"startRowIndex":20,"endRowIndex":21,"startColumnIndex":6,"endColumnIndex":7]
        // No replay after an uncertain reply. The fixed writer's strong, unformatted readback decides.
        do { _ = try await api.request(path:":batchUpdate",method:"POST",body:["requests":[["updateCells":["range":slot,
            "fields":"userEnteredValue,userEnteredFormat.numberFormat","rows":[["values":[cell]]]]]]]) } catch { try api.check() }
        try await writer.verifyRecord(decision,at:21,api:api)
    }
    #endif
}
