import XCTest
import WebKit
@testable import Kitty

final class HostPolicyTests: XCTestCase {
    func testOnlyBundledMainFrameHasNativeAccess() throws {
        let file = URL(fileURLWithPath: "/bundle/kitty-native.html")
        XCTAssertTrue(HostPolicy.trusted(file, bundleURL: file, mainFrame: true))
        XCTAssertFalse(HostPolicy.trusted(file, bundleURL: file, mainFrame: false))
        for value in ["https://example.com/kitty-native.html", "file://remote.example/bundle/kitty-native.html", "file:///bundle/other.html", "about:blank"] {
            XCTAssertFalse(HostPolicy.trusted(URL(string: value), bundleURL: file, mainFrame: true))
        }
    }

    func testDeepLinksAreRoutesNotScriptOrData() throws {
        for route in HostPolicy.routes {
            XCTAssertEqual(HostPolicy.route(try XCTUnwrap(URL(string: "kitty://" + route))), route)
        }
        for value in ["https://goals", "kitty://goals?sheet=secret", "kitty://goals/edit", "kitty://unknown", "kitty://user@goals", "kitty://goals#script"] {
            XCTAssertNil(HostPolicy.route(try XCTUnwrap(URL(string: value))))
        }
    }

    func testExportNamesCannotEscapeTheirTemporaryDirectory() {
        XCTAssertEqual(HostPolicy.exportName("kitty-entries-2027-01-31.csv"), "kitty-entries-2027-01-31.csv")
        for name in ["", "../secret", "/secret", "folder\\file", "name:file", ".hidden", "bad\nname", String(repeating: "a", count: 181)] {
            XCTAssertNil(HostPolicy.exportName(name))
        }
    }
}

@MainActor
final class OfflinePageTests: XCTestCase {
    private func js(_ page: WKWebView, _ body: String) async throws -> Any {
        try await page.callAsyncJavaScript(body, arguments: [:], in: nil, contentWorld: .page) ?? NSNull()
    }

    private func wait(_ page: WKWebView, for expression: String) async throws {
        let end = Date().addingTimeInterval(15)
        while Date() < end {
            if let ready = try? await js(page, "return Boolean(" + expression + ")"), ready as? Bool == true { return }
            try await Task.sleep(for: .milliseconds(100))
        }
        let state = try? await js(page, "return JSON.stringify({visibility:document.visibilityState,toast:document.querySelector('#toast')?.outerHTML,opacity:document.querySelector('#toast') && getComputedStyle(document.querySelector('#toast')).opacity,errors:window.__testErrors})")
        XCTFail("Page did not become ready: " + expression + "; " + String(describing: state))
        throw NSError(domain: "KittyTest", code: 1)
    }

    private func capture(_ page: WKWebView, _ name: String) async throws {
        // Keep full-resolution evidence out of entrance-animation/fading-toast frames.
        _ = try await js(page, """
            await Promise.all(document.getAnimations().filter(animation =>
              Number.isFinite(animation.effect?.getComputedTiming().endTime))
              .map(animation => animation.finished.catch(() => {})));
            return true;
            """)
        let image = try await page.takeSnapshot(configuration: nil)
        let attachment = XCTAttachment(image: image)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testAskAnswersFromEntriesAndPreservesTheFollowUpScope() async throws {
        let suite = "KittyAskTests-" + UUID().uuidString
        let preferences = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { preferences.removePersistentDomain(forName: suite) }
        let host = KittyViewController(preferences: preferences, websiteDataStore: .nonPersistent())
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        let window = UIWindow(windowScene: scene)
        window.rootViewController = host
        window.makeKeyAndVisible()
        defer { window.isHidden = true }
        host.loadViewIfNeeded()
        let page = try XCTUnwrap(host.webView)
        try await wait(page, for: "window.KittyNative?.ready && !document.querySelector('#askbtn').hidden")
        try await wait(page, for: "getComputedStyle(document.querySelector('#toast')).opacity === '0' && !document.querySelector('canvas[data-generated-confetti]')")
        _ = try await js(page, "document.querySelector('#askbtn').click(); return true")
        _ = try await js(page, "document.querySelector('[data-ask-example*=subscriptions][data-ask-example*=fund]').click(); return true")
        try await wait(page, for: "document.querySelector('[data-ask-answer]')?.innerText.includes('37.49')")
        let scenario = try await js(page, "return document.querySelector('[data-ask-answer]').innerText") as? String ?? ""
        XCTAssertTrue(scenario.contains("June 2027") && scenario.contains("3,097.16"),scenario)
        XCTAssertFalse(scenario.contains("Anytime Fitness"),"The household marked the gym Keep.")
        try await capture(page, "Ask – subscription choices and emergency savings goal")
        _ = try await js(page, "const input=document.querySelector('[data-ask-input]'); input.value='How much did we spend on groceries last month?'; input.form.requestSubmit(); return true")
        try await wait(page, for: "document.querySelector('[data-ask-answer]')?.innerText.includes('1,429.05')")
        let first = try await js(page, "return document.querySelector('[data-ask-answer]').innerText") as? String ?? ""
        XCTAssertTrue(first.contains("December 2026") && first.contains("Groceries") && first.contains("4 expense entries"), first)
        _ = try await js(page, "document.querySelector('[data-ask-evidence] summary').click(); return true")
        let rows = try await js(page, "return Array.from(document.querySelectorAll('[data-ask-go]'), x=>x.dataset.askGo)") as? [String] ?? []
        XCTAssertEqual(rows.count,4)
        try await capture(page, "Ask – December groceries and four fictional ledger entries")
        _ = try await js(page, "document.querySelector('[data-ask-go]').click(); return true")
        try await wait(page, for: "!document.querySelector('[data-native-ask]') && document.querySelector('#drawer.on').innerText.includes('" + (rows.first?.replacingOccurrences(of: "entry:", with: "") ?? "missing") + "')")
        _ = try await js(page, "document.querySelector('#dclose').click(); document.querySelector('#askbtn').click(); document.querySelector('[data-ask-example*=Compare]').click(); return true")
        try await wait(page, for: "document.querySelector('[data-ask-answer]')?.innerText.includes('November 2026')")
        _ = try await js(page, "document.querySelector('[data-ask-period]').click(); document.querySelector('[data-ask-share]').click(); return true")
        let preview = try await js(page, "return document.querySelector('.ask-preview').textContent") as? String ?? ""
        XCTAssertTrue(preview.contains("December 2026") && preview.contains("1,429.05"),preview)
        XCTAssertFalse(preview.contains("https:") || preview.contains("T0761"))
        XCTAssertNil(host.presentedViewController, "Previewing never sends data.")
        _ = try await js(page, "document.querySelector('[data-ask-system-share]').click(); return true")
        for _ in 0..<30 where host.presentedViewController == nil { try await Task.sleep(for: .milliseconds(100)) }
        XCTAssertTrue(host.presentedViewController is UIActivityViewController)
        host.presentedViewController?.dismiss(animated:false)
        let stale = try await js(page,"return await webkit.messageHandlers.kitty.postMessage({method:'ask.share',params:{text:'fictional',session:'wrong'}})") as? [String:Any]
        XCTAssertEqual(stale?["ok"] as? Bool,false)

        _ = try await js(page, "document.querySelector('#dclose').click(); window.KittyNative.openRoute('review'); return true")
        try await wait(page, for: "document.querySelector('#reviewcard [data-cookie]')")
        _ = try await js(page, "document.querySelector('#reviewcard [data-cookie]').click(); return true")
        try await wait(page, for: "document.querySelector('[data-ask-choose]')")
        _ = try await js(page, "document.querySelector('[data-ask-choose]').click(); return true")
        try await wait(page, for: "document.querySelector('#catpick [data-pickcat]')")
    }

    func testOfflineJourneysAndHostCapabilities() async throws {
        let suite = "KittyTests-" + UUID().uuidString
        let preferences = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { preferences.removePersistentDomain(forName: suite) }
        let host = KittyViewController(preferences: preferences, websiteDataStore: .nonPersistent())
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        let window = UIWindow(windowScene: scene)
        window.rootViewController = host
        window.makeKeyAndVisible()
        defer { window.isHidden = true }
        host.loadViewIfNeeded()
        let page = try XCTUnwrap(host.webView)
        page.configuration.userContentController.addUserScript(WKUserScript(source: """
            window.__testErrors = [];
            addEventListener('securitypolicyviolation', e => {
              if (/worker/.test(e.effectiveDirective) || String(e.blockedURI).startsWith('blob'))
                window.__testErrors.push('Blocked celebration worker: ' + e.effectiveDirective);
            });
            addEventListener('error', e => window.__testErrors.push(String(e.message)));
            addEventListener('unhandledrejection', e => window.__testErrors.push(String(e.reason)));
            """, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        try await wait(page, for: "window.KittyNative?.ready && document.querySelector('#v-home .hero')")
        try await wait(page, for: "getComputedStyle(document.querySelector('#toast')).opacity === '0'")
        let initial = try await js(page, "return document.querySelector('#v-home').innerText") as? String ?? ""
        XCTAssertTrue(initial.contains("99,388"), initial)
        let trust = try await js(page, "return document.querySelector('#trustpill').innerText") as? String ?? ""
        XCTAssertTrue(trust.localizedCaseInsensitiveContains("demo"), trust)
        try await capture(page, "Home — bundled fictional data")

        let capabilities = try await js(page, """
            return {mcp: await window.claude.use('mcp') === null,
                    sample: await window.claude.use('sample') === null,
                    owner: await (await window.claude.use('user')).isOwner(),
                    download: typeof (await window.claude.use('downloads')).save};
            """) as? [String: Any] ?? [:]
        XCTAssertEqual(capabilities["mcp"] as? Bool, true)
        XCTAssertEqual(capabilities["sample"] as? Bool, true)
        XCTAssertEqual(capabilities["owner"] as? Bool, false)
        XCTAssertEqual(capabilities["download"] as? String, "function")

        let pref = try await js(page, """
            const doc = (await window.claude.use('db')).doc('data/users/native-demo/kitty');
            await doc.set({theme:'dark',savedAt:123}); const saved = await doc.get();
            return saved.exists && saved.data().theme === 'dark' && saved.data().savedAt === 123;
            """)
        XCTAssertEqual(pref as? Bool, true)
        let denied = try await js(page, """
            return await window.webkit.messageHandlers.kitty.postMessage({method:'preferences.get',params:{path:'data/users/other/kitty'}});
            """) as? [String: Any] ?? [:]
        XCTAssertEqual(denied["ok"] as? Bool, false)

        _ = try await js(page, "document.querySelector('[data-tab=activity]').click(); return true")
        try await wait(page, for: "document.querySelector('#v-activity.on .erow')")
        try await capture(page, "Activity — bundled entries")
        host.openDeepLink(try XCTUnwrap(URL(string: "kitty://review")))
        try await wait(page, for: "document.querySelector('#v-activity.on #reviewcard .rcard')")
        try await capture(page, "Review — demo decisions only")
        let reviewActions = try await js(page, """
            return document.querySelector('#reviewcard [data-ract="cat"]') !== null &&
              document.querySelector('#reviewcard [data-cookie][aria-label*="past entries"]') !== null &&
              !document.querySelector('#reviewcard').innerText.includes('Open this page in Claude');
            """)
        XCTAssertEqual(reviewActions as? Bool, true, "Offline Review must offer a usable category action.")


        _ = try await js(page, "document.querySelector('[data-tab=insights]').click(); return true")
        try await wait(page, for: "document.querySelector('#v-insights.on .jar circle') && document.querySelector('#nwchart svg path')")
        try await capture(page, "Insights — offline jar and charts")
        _ = try await js(page, "document.querySelector('[data-mv=flow]').click(); return true")
        try await wait(page, for: "document.querySelector('#flowhost svg path')")
        _ = try await js(page, "document.querySelector('[data-tab=goals]').click(); return true")
        try await wait(page, for: "document.querySelector('#v-goals.on .ring svg')")
        try await capture(page, "Goals — shared goal view")
        _ = try await js(page, """
            document.querySelector('#v-goals [data-open="goal:Japan trip, April 2027"]').click();
            return true;
            """)
        try await wait(page, for: "document.querySelector('#drawer.on[aria-modal=true]')")
        _ = try await js(page, "document.querySelector('#dclose').click(); return true")
        try await wait(page, for: "document.querySelector('#drawer[inert][aria-hidden=true]:not([aria-modal])')")

        _ = try await js(page, "document.querySelector('[data-tab=setup]').click(); return true")
        let setup = try await js(page, "return document.querySelector('#v-setup').innerText") as? String ?? ""
        XCTAssertTrue(setup.localizedCaseInsensitiveContains("demo"))
        XCTAssertFalse(setup.contains("Safari"))
        XCTAssertFalse(setup.contains("sheet_version 1"))
        try await wait(page, for: "document.querySelector('[data-icon-choice=cat][aria-pressed]') && document.querySelector('[data-icon-choice=dog][aria-pressed]')")
        let icons = try await js(page, """
            const native = await KittyNative.icon.status();
            return [...document.querySelectorAll('[data-icon-choice]')].every(button =>
                button.disabled === !native.supported &&
                button.getAttribute('aria-pressed') === String((button.dataset.iconChoice !== KITTY_ART.set) === native.alternate));
            """)
        XCTAssertEqual(icons as? Bool, true, "The actual Home Screen setting is shown on this device.")
        let info = try XCTUnwrap(Bundle.main.infoDictionary?["CFBundleIcons"] as? [String: Any])
        XCTAssertNotNil((info["CFBundleAlternateIcons"] as? [String: Any])?["KittyAlternate"])
        let appearance = try await js(page, """
            const root = document.querySelector('#v-setup');
            root.querySelector('[data-theme-pick=dark]').click();
            const changed = document.documentElement.dataset.theme === 'dark' &&
              root.querySelector('[data-theme-pick=dark]').getAttribute('aria-pressed') === 'true';
            root.querySelector('[data-theme-pick=system]').click();
            return changed && !document.documentElement.hasAttribute('data-theme');
            """)
        XCTAssertEqual(appearance as? Bool, true)


        _ = try await js(page, """
            window.KittyNative.openRoute('home');
            const probe = document.createElement('span'); probe.id = 'text-size-probe';
            probe.textContent = 'Readable text'; probe.style.cssText = 'display:inline-block;font-size:16px;white-space:nowrap';
            document.body.append(probe); window.__probeBefore = probe.getBoundingClientRect().height;
            return true;
            """)
        host.traitOverrides.preferredContentSizeCategory = .accessibilityExtraExtraExtraLarge
        NotificationCenter.default.post(name: UIContentSizeCategory.didChangeNotification, object: nil)
        try await wait(page, for: "window.KittyNative.environment.textScale > 2")
        let type = try await js(page, """
            return {before:window.__probeBefore,after:document.querySelector('#text-size-probe').getBoundingClientRect().height,
              overflow:document.documentElement.scrollWidth > innerWidth + 1,
              wide:[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().width && e.getBoundingClientRect().right>innerWidth+1).slice(0,15).map(e=>e.tagName+'.'+e.className),
              top:document.querySelector('header.top').getBoundingClientRect().top};
            """) as? [String: Any] ?? [:]
        XCTAssertGreaterThan(type["after"] as? Double ?? 0, (type["before"] as? Double ?? 0) * 1.5, type.description)
        XCTAssertEqual(type["overflow"] as? Bool, false, type.description)
        try await capture(page, "Home — largest accessibility text")
        for route in ["activity", "review", "insights", "goals", "setup"] {
            _ = try await js(page, """
                window.KittyNative.openRoute('\(route)'); await document.fonts.ready;
                await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                return true;
                """)
            let layout = try await js(page, """
                return JSON.stringify({width:innerWidth,scroll:document.documentElement.scrollWidth,
                  overflow:[...document.querySelectorAll('body *')].filter(e=>e.clientWidth && e.scrollWidth>e.clientWidth+1).slice(0,30).map(e=>({tag:e.tagName,cls:e.className,client:e.clientWidth,scroll:e.scrollWidth,css:getComputedStyle(e).overflowX,text:e.textContent.slice(0,30)})),
                  wide:[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().width && e.getBoundingClientRect().right>innerWidth+1).slice(0,8).map(e=>e.tagName+'.'+e.className+' parent:'+e.parentElement.className+' text:'+e.textContent.slice(0,80))});
                """) as? String ?? ""
            let overflow = try await js(page, "return document.documentElement.scrollWidth > innerWidth + 1")
            XCTAssertEqual(overflow as? Bool, false, route + ": " + layout)
            if route == "insights" { try await capture(page, "Insights — largest accessibility text") }
        }
        _ = try await js(page, "document.querySelector('#text-size-probe').remove(); window.KittyNative.receiveEnvironment({reduceMotion:true}); return true")
        let motion = try await js(page, "return document.documentElement.dataset.kittyReduceMotion === 'true' && !document.documentElement.classList.contains('anim')")
        XCTAssertEqual(motion as? Bool, true)
        host.traitOverrides.preferredContentSizeCategory = .large
        NotificationCenter.default.post(name: UIContentSizeCategory.didChangeNotification, object: nil)

        let offline = try await js(page, """
            await document.fonts.ready;
            return {fonts: [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family),
              remote: performance.getEntriesByType('resource').filter(r => /^https?:/.test(r.name)).length,
              blocked: await fetch('https://example.invalid/kitty-network-probe').then(() => false, () => true),
              qr: (() => {const code=qrcode(0,'M');code.addData('The Kitty fictional demo');code.make();return code.createSvgTag().includes('<svg');})(),
              errors: window.__testErrors,
              gridDisabled: !document.querySelector('.grid-stack')?.gridstack};
            """) as? [String: Any] ?? [:]
        let fonts = offline["fonts"] as? [String] ?? []
        XCTAssertTrue(fonts.contains { $0.contains("Bricolage") }, fonts.description)
        XCTAssertTrue(fonts.contains { $0.contains("DM Sans") }, fonts.description)
        XCTAssertEqual(offline["remote"] as? Int, 0)
        XCTAssertEqual(offline["blocked"] as? Bool, true)
        XCTAssertEqual(offline["qr"] as? Bool, true)
        XCTAssertEqual(offline["errors"] as? [String], [])
        if window.bounds.width < 820 { XCTAssertEqual(offline["gridDisabled"] as? Bool, true) }
    }
}
