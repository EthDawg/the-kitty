import XCTest
import PDFKit
import WebKit
@testable import Kitty

final class ImportOriginalsTests: XCTestCase {
    @MainActor
    func testBundledCSVPreviewUsesActiveLedgerAccountsAndShowsBothSignedSourceRows() async throws {
        let source = SourceDocument(name: "fictional-card.csv", mimeType: "text/csv", bytes: Data("""
            Date,Description,Card Member,Account #,Amount
            31/01/2027,FICTIONAL CAFE,Jordan,1234,8.50
            04/02/2027,FICTIONAL REFUND,Jordan,1234,-3.25
            """.utf8))
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        let page = WKWebView(frame: .zero, configuration: config)
        let url = try XCTUnwrap(Bundle.main.url(forResource: "kitty-native", withExtension: "html"))
        page.loadFileURL(url, allowingReadAccessTo: url)
        let deadline = Date().addingTimeInterval(10)
        var ready = false
        while !ready && Date() < deadline {
            ready = (try? await page.evaluateJavaScript("typeof window.KittyIntake?.open === 'function'")) as? Bool == true
            if !ready { try await Task.sleep(for: .milliseconds(100)) }
        }
        XCTAssertTrue(ready)
        let file: [String: Any] = ["id": source.id, "name": source.name, "mimeType": source.mimeType,
                                   "byteLength": source.byteLength, "text": String(decoding: source.bytes, as: UTF8.self)]
        let result = try await page.callAsyncJavaScript("""
            const drawer = document.querySelector('#drawer');
            KittyIntake.open({sheet:KITTY_SNAPSHOT, current:()=>true, pick:async()=>file,
                drawer:html=>{drawer.innerHTML=html;}});
            document.querySelector('#ifpick').click();
            await new Promise(done=>setTimeout(done,0));
            const accounts=document.querySelector('#ifaccount');
            accounts.value='ACC-CC';
            document.querySelector('#ifprepare').click();
            return {accounts:[...accounts.options].map(o=>o.value).filter(Boolean),
                    period:!!document.querySelector('#ifmonth') || !!document.querySelector('#ifdate'),
                    preview:document.querySelector('#ifresult').textContent,
                    confirm:[...drawer.querySelectorAll('button')].some(b=>b.textContent.includes('Confirm import'))};
            """, arguments: ["file": file], in: nil, contentWorld: .page) as? [String: Any]
        let accounts = try XCTUnwrap(result?["accounts"] as? [String])
        XCTAssertEqual(Set(accounts), ["ACC-EVD", "ACC-OFF", "ACC-SAV", "ACC-HOL", "ACC-CC", "ACC-RNT"])
        XCTAssertEqual(result?["period"] as? Bool, false, "The whole-file preview must not offer an unapplied month filter.")
        XCTAssertEqual(result?["confirm"] as? Bool, false)
        let preview = try XCTUnwrap(result?["preview"] as? String)
        for fact in ["2 source rows", "2 proposed", "2027-01-31", "FICTIONAL CAFE", "-8.50", "2027-02-04", "FICTIONAL REFUND", "3.25"] {
            XCTAssertTrue(preview.contains(fact), "Missing preview fact: " + fact)
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
