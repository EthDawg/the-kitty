import XCTest
import WebKit
@testable import Kitty

/// Opt in through the test run's environment, on the developer's physical iPhone only.
/// Uses the installed app's existing Picker grant. No copied tokens, substitute data or writes.
@MainActor
final class LiveDeviceTests: XCTestCase {
    func testSelectedDaviesSheetDrivesTheDashboard() async throws {
        #if targetEnvironment(simulator)
        throw XCTSkip("This proof requires the physical iPhone.")
        #else
        guard ProcessInfo.processInfo.environment["KITTY_DEVICE_ACCEPTANCE"] == "davies-read" else {
            throw XCTSkip("Opt-in real device check for the public fictional Sheet.")
        }
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
            let status = try? await js("return document.querySelector('#nativeconnection [role=status]')?.innerText || 'no status'")
            XCTFail("Phone did not satisfy " + expression + "; " + (status as? String ?? "no response"))
            throw NSError(domain: "KittyDeviceProof", code: 1)
        }
        try await wait("window.KittyNative?.ready")
        let configuredID = try await js("return window.KITTY_SHEET")
        XCTAssertEqual(configuredID as? String, GoogleSheetSelection.demoFileID)
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
        #endif
    }
}
