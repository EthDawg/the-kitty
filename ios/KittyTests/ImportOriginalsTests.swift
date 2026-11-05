import XCTest
import PDFKit
import WebKit
@testable import Kitty

final class ImportOriginalsTests: XCTestCase {
    @MainActor
    func testBundledCSVPreviewUsesActiveLedgerAccountsAndShowsBothSignedSourceRows() async throws {
        let original = SourceDocument(name: "fictional-card.csv", mimeType: "text/csv", bytes: Data("""
            Date,Description,Card Member,Account #,Amount
            31/01/2027,FICTIONAL CAFE,Jordan,1234,8.50
            04/02/2027,FICTIONAL REFUND,Jordan,1234,-3.25
            """.utf8))
        let source = await SourceDocumentCapture.extract(original)
        XCTAssertEqual(source.state, .extracted)
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        let page = WKWebView(frame: .zero, configuration: config)
        let url = try XCTUnwrap(Bundle.main.url(forResource: "kitty-native", withExtension: "html"))
        page.loadFileURL(url, allowingReadAccessTo: url)
        let deadline = Date().addingTimeInterval(10)
        var ready = false
        while !ready && Date() < deadline {
            ready = (try? await page.evaluateJavaScript("window.KittyNative?.ready === true && typeof window.KittyIntake?.open === 'function'")) as? Bool == true
            if !ready { try await Task.sleep(for: .milliseconds(100)) }
        }
        guard ready else { return XCTFail("The bundled app did not finish loading its offline Sheet and intake panel.") }
        let file: [String: Any] = ["id": source.id, "name": source.name, "mimeType": source.mimeType,
                                   "byteLength": source.byteLength, "text": try XCTUnwrap(String(data: source.bytes, encoding: .utf8)),
                                   "pageCount": source.pageCount, "state": source.state.rawValue, "messages": source.messages]
        let result = try await page.callAsyncJavaScript("""
            const drawer = document.querySelector('#drawer');
            KittyIntake.open({sheet:KITTY_SNAPSHOT, current:()=>true, pick:async()=>file,
                drawer:html=>{drawer.innerHTML=html;}});
            const get=id=>drawer.querySelector('#'+id), accounts=get('ifaccount'), month=get('ifmonth');
            const date=get('ifdate'), preview=get('ifprepare'), result=get('ifresult');
            async function waitFor(check, action) {
                const end=Date.now()+5000;
                while (!check()) {
                    if (Date.now() >= end) throw Error(action+' timed out. '+drawer.textContent);
                    await new Promise(resolve=>setTimeout(resolve,25));
                }
            }
            function change(control,value) {
                control.value=value;
                control.dispatchEvent(new Event('change',{bubbles:true}));
            }
            get('ifpick').click();
            await waitFor(()=>!preview.disabled && get('ifname').textContent.includes(file.name),'Selecting the original');
            change(accounts,'ACC-CC');
            change(date,'2027-02-05');
            async function review(period) {
                change(month,period);
                const cleared=result.childElementCount===0;
                preview.click();
                await waitFor(()=>!preview.disabled && result.querySelector('h3'),'Rendering '+period);
                const outside=result.querySelector('ul[aria-label="Outside the selected month"]');
                return {cleared, period:month.value, description:result.textContent,
                    proposed:[...result.querySelectorAll('ol > li')].map(r=>r.textContent),
                    outside:[...(outside?.children||[])].map(r=>r.textContent),
                    outsideVisible:outside?.closest('details')?.open===true,
                    confirm:[...drawer.querySelectorAll('button')].some(b=>b.textContent.includes('Confirm import'))};
            }
            return {accounts:[...accounts.options].map(o=>o.value).filter(Boolean), monthType:month.type,
                    dateType:date.type, january:await review('2027-01'), february:await review('2027-02')};
            """, arguments: ["file": file], in: nil, contentWorld: .page) as? [String: Any]
        let accounts = try XCTUnwrap(result?["accounts"] as? [String])
        XCTAssertEqual(Set(accounts), ["ACC-EVD", "ACC-OFF", "ACC-SAV", "ACC-HOL", "ACC-CC", "ACC-RNT"])
        XCTAssertEqual(result?["monthType"] as? String, "month")
        XCTAssertEqual(result?["dateType"] as? String, "date")
        let cafe = "-8.50 AUD · 2027-01-31 · FICTIONAL CAFE", refund = "+3.25 AUD · 2027-02-04 · FICTIONAL REFUND"
        for (key, month, proposed, excluded, selectedLine, outsideLine) in [
            ("january", "2027-01", cafe, refund, 2, 3), ("february", "2027-02", refund, cafe, 3, 2)
        ] {
            let view = try XCTUnwrap(result?[key] as? [String: Any])
            XCTAssertEqual(view["period"] as? String, month)
            XCTAssertEqual(view["cleared"] as? Bool, true, "Changing the month must invalidate the earlier review.")
            XCTAssertEqual(view["confirm"] as? Bool, false, "Offline review must not offer a Sheet write.")
            XCTAssertEqual(view["outsideVisible"] as? Bool, true)
            let rows = try XCTUnwrap(view["proposed"] as? [String])
            XCTAssertEqual(rows.count, 1)
            XCTAssertTrue(rows.first?.hasPrefix(proposed + " · ") == true)
            XCTAssertTrue(rows.first?.hasSuffix("source row \(selectedLine)") == true)
            XCTAssertEqual(view["outside"] as? [String], [excluded + " · source row \(outsideLine)"])
            let description = try XCTUnwrap(view["description"] as? String)
            for fact in ["2 source rows · 1 proposed · 0 already in this Sheet · 1 outside the selected month",
                         "downloaded 2027-02-05", source.name, source.id, "\(source.byteLength) bytes",
                         "This is a preview. No Sheet rows were written."] {
                XCTAssertTrue(description.contains(fact), "Missing \(month) preview fact: \(fact)")
            }
        }
    }

    func testRetainedOriginalIsVerifiedPerHouseholdAndNeverReplacedByExtraction() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at:root) }
        let store = ImportOriginals(root:root), bytes = Data("Date,Description,Amount\n05/11/2026,Coffee,-4.50\n".utf8)
        let a = "native-" + String(repeating:"a",count:64), b = "native-" + String(repeating:"b",count:64)
        let original = SourceDocument(name:"Fictional bank.csv",mimeType:"text/csv",bytes:bytes)
        try store.retain(original,scope:a)
        let parsed = await SourceDocumentCapture.extract(original)
        XCTAssertEqual(parsed.pages.first?.text,String(data:bytes,encoding:.utf8))
        XCTAssertEqual(try store.load(id:original.id,scope:a),bytes)
        XCTAssertThrowsError(try store.load(id:original.id,scope:b))
        XCTAssertThrowsError(try store.load(id:"../escape",scope:a))
        let file = root.appendingPathComponent(a).appendingPathComponent(original.id)
        try Data("changed".utf8).write(to:file)
        XCTAssertThrowsError(try store.load(id:original.id,scope:a))
        XCTAssertThrowsError(try store.retain(original,scope:a))
    }
}
