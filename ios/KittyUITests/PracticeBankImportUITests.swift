import XCTest

/// A real Files round trip. Physical runs require a separately verified private practice copy.
/// No Google credential, returned document, file bytes or native bridge reply is injected here.
@MainActor
final class PracticeBankImportUITests: XCTestCase {
    private let app = XCUIApplication(bundleIdentifier: "com.ethdawg.kitty")
    private let env = ProcessInfo.processInfo.environment
    private var page: XCUIElement { app.webViews.firstMatch }
    private var navigation: XCUIElement { app.navigationBars["FullDocumentManagerViewControllerNavigationBar"] }
    private var fileBase: String { "Kitty-2027-01-proof-" + (env["KITTY_PRACTICE_RUN"] ?? "") }
    private var fixtureBase: String { "Kitty-2027-01-card-proof" }
    private var privateTitle: String { env["KITTY_PRACTICE_TITLE"] ?? "" }
    private func require(_ mode: String) throws {
        guard env["KITTY_PRACTICE_ACCEPTANCE"] == mode, UUID(uuidString: env["KITTY_PRACTICE_RUN"] ?? "") != nil else {
            throw XCTSkip("Opt-in private practice acceptance only.")
        }
        continueAfterFailure = false
        executionTimeAllowance = 240
    }
    override func tearDownWithError() throws { if app.state != .notRunning { app.terminate() } }

    private func text(_ phrase: String) -> XCUIElement {
        page.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", phrase)).firstMatch
    }
    private func button(_ prefix: String) -> XCUIElement {
        page.buttons.matching(NSPredicate(format: "label BEGINSWITH[c] %@", prefix)).firstMatch
    }
    private func tap(_ item: XCUIElement, timeout: TimeInterval = 12, scroll: Bool = false,
                     file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(item.waitForExistence(timeout: timeout), "Required control is missing.", file: file, line: line)
        if scroll { for _ in 0..<8 where !item.isHittable { page.swipeUp() } }
        XCTAssertTrue(item.isHittable, "Required control must be reachable by touch.", file: file, line: line)
        item.tap()
    }
    private func setup() {
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_AU"]
        app.launch()
        tap(app.buttons["Setup"])
    }
    private func openRestoredPractice() throws {
        guard !privateTitle.isEmpty, privateTitle.localizedCaseInsensitiveContains("practice") else {
            throw XCTSkip("The independent Google baseline must supply the exact private copy title.")
        }
        setup()
        let open = button("Open live Sheet")
        if open.waitForExistence(timeout: 5) { tap(open, scroll: true) }
        XCTAssertTrue(text(privateTitle).waitForExistence(timeout: 45), "Kitty must display the exact verified private Sheet.")
    }
    private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }
    private func localRoot(destination: Bool) {
        XCTAssertTrue(navigation.waitForExistence(timeout: 15), "The system Files picker must open.")
        let browseTitle = navigation.staticTexts["Browse"]
        let root = navigation.staticTexts["On My iPhone"]
        let identified = app.descendants(matching:.any).matching(identifier:"DOC.browsingRoot Source: com.apple.FileProvider.LocalStorage, Title: On My iPhone").firstMatch
        if root.exists && identified.exists { return }
        if !destination {
            let browse = app.tabBars.buttons["Browse"]
            if browse.exists && browse.isHittable { browse.tap() }
        }
        // A blank location can display a title before the provider has finished enumerating. Re-enter through Browse.
        for _ in 0..<5 where !browseTitle.exists {
            let back = navigation.buttons["BackButton"]
            if back.exists && back.isHittable { back.tap() } else { break }
        }
        if browseTitle.waitForExistence(timeout: 5) {
            let local = app.descendants(matching:.any).matching(identifier:"com.apple.FileProvider.LocalStorage").firstMatch
            let name = app.descendants(matching:.any).matching(NSPredicate(format:"label == %@", "On My iPhone")).firstMatch
            if local.exists && local.isHittable { tap(local) } else { tap(name) }
        }
        XCTAssertTrue(root.waitForExistence(timeout: 15), "Files must enter the named, on-device location.")
    }
    private func saveSample() {
        tap(button("Save a sample CSV"), scroll: true)
        localRoot(destination: true)
        let name = app.textFields["DOCPicker.filenameTextField"]
        XCTAssertTrue(name.waitForExistence(timeout: 8), "Need an editable filename to avoid replacing existing files.")
        let old = name.value as? String ?? ""
        XCTAssertTrue(old.hasPrefix(fixtureBase), "Expected the canonical fictional sample, not another export.")
        tap(name); name.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: old.count + 8))
        XCTAssertEqual(name.value as? String, "")
        name.typeText(fileBase); XCTAssertEqual(name.value as? String, fileBase)
        tap(navigation.buttons["Save"])
        let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: navigation)
        XCTAssertEqual(XCTWaiter.wait(for: [gone], timeout: 12), .completed)
    }
    func testCreatePrivatePracticeAndSaveSampleThroughFiles() throws {
        #if targetEnvironment(simulator)
        throw XCTSkip("Physical account opt-in only.")
        #else
        try require("private-google")
        setup()
        let make = button("Make a private practice Sheet")
        let active = page.staticTexts.matching(NSPredicate(format: "label MATCHES[c] %@", ".*Connected to Davies practice · [A-Fa-f0-9]{8}.*")).firstMatch
        if !active.exists {
            let open = button("Open live Sheet")
            if open.waitForExistence(timeout: 5) { tap(open, scroll: true) }
        }
        if !active.waitForExistence(timeout: 8) {
            tap(make, timeout: 40, scroll: true)
            let exact = page.buttons.matching(NSPredicate(format: "label MATCHES %@", "Open Davies practice · [A-Fa-f0-9]{8}")).firstMatch
            tap(exact, timeout: 70, scroll: true)
        }
        XCTAssertTrue(active.waitForExistence(timeout: 70), "The live setup must identify the verified app-owned practice Sheet.")
        saveSample()
        #endif
    }
    private func openPickerAndSelect(_ base: String) {
        tap(button("Import a bank file"), scroll: true)
        tap(app.buttons["Choose from Files"])
        localRoot(destination: false)
        let item = app.descendants(matching: .cell).matching(NSPredicate(format: "label BEGINSWITH[c] %@", base)).firstMatch
        let named = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@ OR label == %@", base, base + ".csv")).firstMatch
        if item.waitForExistence(timeout: 14) && item.isHittable { item.tap() }
        else if named.exists && named.isHittable { named.tap() }
        else {
            let search = app.searchFields.firstMatch
            tap(search, timeout: 15); search.typeText(base)
            let submit = app.keyboards.buttons["Search"]; if submit.exists { tap(submit) }
            if item.waitForExistence(timeout: 6) { tap(item) } else { tap(named) }
        }
        XCTAssertTrue(text(base).waitForExistence(timeout: 15), "The selected filename must return from the real picker.")
        XCTAssertTrue(text("229 bytes").exists)
        let identified = page.descendants(matching: .any).matching(identifier: "ifaccount").firstMatch
        let popup = page.popUpButtons.firstMatch
        if identified.exists && identified.isHittable { tap(identified) }
        else if popup.exists { tap(popup) }
        else { tap(page.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH[c] %@", "Sheet account")).firstMatch) }
        let card = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Rewards credit card")).firstMatch
        if card.waitForExistence(timeout: 2) && card.isHittable { tap(card) }
        else {
            let wheel = app.pickerWheels.firstMatch
            XCTAssertTrue(wheel.waitForExistence(timeout: 3)); wheel.adjust(toPickerWheelValue: "Rewards credit card")
            let done = app.buttons["Done"]; if done.exists { tap(done) }
        }
        tap(button("Preview import"), scroll: true)
    }
    private func assertFirstPreview() {
        XCTAssertTrue(text("Review proposed changes").waitForExistence(timeout: 12))
        XCTAssertTrue(text("KITTY PRACTICE PAPER BOAT").exists)
        XCTAssertTrue(text("KITTY PRACTICE KITE REFUND").exists)
        XCTAssertTrue(text("17.45").exists && text("6.25").exists)
    }
    func testConfirmOriginalFromFilesOnPrivateCopy() throws {
        #if targetEnvironment(simulator)
        throw XCTSkip("Physical account opt-in only.")
        #else
        try require("private-google"); try openRestoredPractice()
        openPickerAndSelect(fileBase); assertFirstPreview()
        let verifiedTarget = page.buttons["Confirm import to " + privateTitle]
        XCTAssertTrue(verifiedTarget.exists, "Only the preflight-verified private practice Sheet may be confirmed.")
        XCTAssertTrue(text("2 proposed · 1 already in this Sheet").exists)
        capture("Private practice — signed card charge and refund in preview")
        tap(verifiedTarget, scroll: true)
        XCTAssertTrue(text("Verified import").waitForExistence(timeout: 100), "An explicit verified receipt must complete before replay.")
        capture("Private practice — verified import receipt")
        #endif
    }
    func testReplayOriginalFromFilesOnPrivateCopy() throws {
        #if targetEnvironment(simulator)
        throw XCTSkip("Physical account opt-in only.")
        #else
        try require("private-google"); try openRestoredPractice()
        openPickerAndSelect(fileBase)
        XCTAssertTrue(text("Verified import").waitForExistence(timeout: 70), "Kitty must recognise the existing receipt after selecting the identical file.")
        XCTAssertTrue(text("Google already has these 2 entries").exists)
        XCTAssertTrue(text("3 already in this Sheet at preview").exists)
        XCTAssertFalse(button("Confirm import").exists)
        capture("Private practice — same original has no new rows")
        #endif
    }
    func testSimulatorFilesPreviewForSameSignedOriginal() throws {
        #if targetEnvironment(simulator)
        try require("simulator-files")
        setup(); saveSample(); openPickerAndSelect(fileBase); assertFirstPreview()
        XCTAssertFalse(button("Confirm import").exists, "The offline demo remains a preview.")
        capture("Simulator — real Files selection and original two-row preview")
        #else
        throw XCTSkip("Simulator's isolated local Files provider only.")
        #endif
    }
}
