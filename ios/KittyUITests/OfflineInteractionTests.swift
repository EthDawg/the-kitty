import XCTest

/// Touch-only acceptance of the bundled fictional household. No JS or live account hooks.
@MainActor
final class OfflineInteractionTests: XCTestCase {
    private let app = XCUIApplication(bundleIdentifier: "com.ethdawg.kitty")
    private var page: XCUIElement { app.webViews.firstMatch }

    override func tearDownWithError() throws {
        if (testRun?.failureCount ?? 0) > 0, app.state == .runningForeground { capture("Failure — last visible state") }
        app.terminate()
    }

    func testTapAskAndOpenAGroceryReceipt() {
        continueAfterFailure = false
        executionTimeAllowance = 90
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_AU"]
        app.launch()
        XCTAssertTrue(page.waitForExistence(timeout: 15))
        // The web-view container can exist while WebKit opens the local bundle.
        let ask = app.buttons["Ask the Kitty"]
        XCTAssertTrue(ask.waitForExistence(timeout:45), "The app must finish opening and expose Ask.")
        tap(ask)
        tap(app.buttons["Groceries last month"])
        XCTAssertTrue(text(containing: "$1,429.05 spent").waitForExistence(timeout: 5))
        let receipts = page.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "See the entries")).firstMatch
        tap(receipts)
        let woolworths = app.buttons.matching(NSPredicate(format: "label CONTAINS %@ AND label CONTAINS %@", "24 Dec", "Woolworths")).firstMatch
        tap(woolworths)
        XCTAssertTrue(text(containing: "T0866").waitForExistence(timeout: 5), "The tap opens the actual December 24 ledger entry.")
    }

    func testOfflinePhoneNavigation() {
        continueAfterFailure = false
        executionTimeAllowance = 120
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_AU"]
        app.launch()
        openHome()
        capture("Phone Home — fictional cash and goals")
        page.swipeUp()
        XCTAssertTrue(app.buttons["Activity"].isHittable, "Tabs stay reachable while scrolling.")

        tap(app.buttons["Activity"])
        XCTAssertTrue(app.buttons["Search transactions"].waitForExistence(timeout: 5))
        capture("Phone Activity — bundled transactions")
        tap(app.buttons["Insights"])
        XCTAssertTrue(text(containing: "Where did the money go?").waitForExistence(timeout: 5))
        capture("Phone Insights — shared charts")
        tap(app.buttons["Goals"])
        XCTAssertTrue(text(containing: "Ways to get there faster").waitForExistence(timeout: 5))
        capture("Phone Goals — shared savings view")

        tap(app.buttons["Setup"])
        let review = app.buttons["Open Review"]
        revealByScrollingDown(review)
        tap(review)
        XCTAssertTrue(text(containing: "the demo sheet is never written").waitForExistence(timeout: 5))
        capture("Phone Review — fictional decisions")
        tap(app.buttons["Home"])
        XCTAssertTrue(app.buttons["Cash and offset, tap for the accounts behind it"].waitForExistence(timeout: 5))
    }

    func testSearchAndCancelCSVExportReturnsToKitty() {
        continueAfterFailure = false
        executionTimeAllowance = 120
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_AU"]
        app.launch()

        openHome()

        // The trust drawer identifies these numbers without relying on the time-based greeting.
        tap(app.buttons.matching(identifier: "Where the numbers come from").firstMatch)
        XCTAssertTrue(text(containing: "bundled snapshot of the fictional Davies household")
            .waitForExistence(timeout: 4))
        tap(app.buttons["Close"])

        tap(app.buttons["Activity"])
        tap(app.buttons["Search transactions"])
        let search = searchField("Search entries")
        tap(search)
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 3),
                      "Search must be usable with the on-screen keyboard.")
        search.typeText("woolworths")
        XCTAssertTrue(text(containing: "transactions for “woolworths”")
            .waitForExistence(timeout: 5), "Activity must apply the merchant query.")
        XCTAssertEqual(search.value as? String, "woolworths")
        XCTAssertFalse(text(containing: "Nothing matches. Try a merchant").exists,
                       "The fictional snapshot includes Woolworths entries.")
        dismissKeyboard()
        capture("Activity — fictional merchant filter, keyboard dismissed")

        // A real UIDocumentPicker is opened. We deliberately cancel rather than assume
        // an iCloud/On My iPhone location exists or claim that presenting it saved a file.
        let csv = app.buttons["CSV"]
        revealByScrollingDown(csv)
        tap(csv)
        let filename = app.textFields["DOCPicker.filenameTextField"]
        let pickerNavigation = app.navigationBars["FullDocumentManagerViewControllerNavigationBar"]
        XCTAssertTrue(pickerNavigation.waitForExistence(timeout: 45), "The native Files picker must open.")
        XCTAssertTrue(pickerNavigation.buttons["Save"].waitForExistence(timeout: 8), "Files must offer to save the export.")
        if filename.exists {
            XCTAssertTrue((filename.value as? String)?.hasPrefix("kitty-entries-") == true)
        }
        capture("CSV — system export picker before cancellation")
        cancelExportPicker(navigation: pickerNavigation)
        waitUntil("The export picker must dismiss.", timeout: 4) {
            !filename.exists && !pickerNavigation.exists
        }
        let incorrectSuccess = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == true"),
            object: text(containing: "Saved the CSV"))
        incorrectSuccess.isInverted = true
        XCTAssertEqual(XCTWaiter.wait(for: [incorrectSuccess], timeout: 2), .completed,
                       "Cancelling export must never claim the CSV was saved.")
        XCTAssertFalse(text(containing: "Couldn't save the file here").exists,
                       "An intentional cancellation is not an export failure.")
        capture("CSV — cancelled, no saved confirmation")

        tap(app.buttons["Setup"])
        XCTAssertTrue(app.buttons["Choose your Sheet"].waitForExistence(timeout:8),
                      "Cancelling Files must return control to Kitty’s Setup page.")
    }

    func testReviewCategoryIsKeptForThisDemoVisit() {
        continueAfterFailure = false
        executionTimeAllowance = 120
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_AU"]
        app.launch()
        openHome()
        tap(app.buttons["Setup"])
        let review = app.buttons["Open Review"]
        revealByScrollingDown(review)
        tap(review)
        XCTAssertTrue(text(containing: "the demo sheet is never written")
            .waitForExistence(timeout: 4))
        let categorise = app.buttons.matching(
            NSPredicate(format: "label BEGINSWITH %@", "Categorise")).firstMatch
        revealByScrollingDown(categorise)
        tap(categorise)
        let categories = searchField("Filter categories")
        tap(categories)
        categories.typeText("Groceries")
        XCTAssertTrue(text(containing: "Kept on screen for this visit; the sheet is not written here.")
            .waitForExistence(timeout: 3))
        tap(app.buttons.matching(
            NSPredicate(format: "label BEGINSWITH %@", "Groceries")).firstMatch)
        XCTAssertTrue(text(containing: "Groceries · kept for this visit (demo)")
            .waitForExistence(timeout: 4), "The result must be labelled as a demo-only judgment.")
        capture("Review — category kept for this demo visit")
    }

    func testSavesUniqueFictionalCSVToSimulatorLocalFiles() throws {
        #if targetEnvironment(simulator)
        continueAfterFailure = false
        executionTimeAllowance = 120
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_AU"]
        app.launch()
        openHome()
        tap(app.buttons["Activity"])
        tap(app.buttons["Search transactions"])
        let search = searchField("Search entries")
        tap(search)
        search.typeText("woolworths")
        XCTAssertTrue(text(containing: "transactions for “woolworths”")
            .waitForExistence(timeout: 5))
        dismissKeyboard()
        let csv = app.buttons["CSV"]
        revealByScrollingDown(csv)
        tap(csv)

        let filename = app.textFields["DOCPicker.filenameTextField"]
        let navigation = app.navigationBars["FullDocumentManagerViewControllerNavigationBar"]
        XCTAssertTrue(navigation.waitForExistence(timeout: 45), "The native Files picker must open.")
        let pickedLocal = try selectVerifiedLocalExportDestination(navigation: navigation)
        let emptyRoot = app.descendants(matching: .any).matching(identifier: "On My iPhone is Empty").firstMatch
        let fixtureName: String
        if emptyRoot.exists {
            // iOS 26.2 sometimes offers Save in a verified empty root with no filename editor.
            // The default name cannot collide here. CI reads the actual file and verifies its bytes.
            fixtureName = "kitty-entries-2027-01-31.csv"
        } else {
            XCTAssertTrue(filename.waitForExistence(timeout: 8),
                          "A nonempty destination needs the filename editor to avoid an overwrite.")
            let current = try XCTUnwrap(filename.value as? String)
            XCTAssertTrue(current.hasPrefix("kitty-entries-") && current.count < 200)
            tap(filename)
            filename.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: current.count + 8))
            XCTAssertEqual(filename.value as? String, "")
            let basename = "kitty-native-export-" + UUID().uuidString.lowercased()
            filename.typeText(basename)
            XCTAssertEqual(filename.value as? String, basename)
            fixtureName = basename + ".csv"
        }
        let record = XCTAttachment(string: """
            Simulator-only fictional CSV fixture
            Filename: \(fixtureName)
            Destination: On My iPhone (com.apple.FileProvider.LocalStorage)
            Activity filter: woolworths
            This UI test checks picker completion and the Saved toast.
            Exact CSV byte/content verification requires separate simulator-container readback.
            """)
        record.name = "CSV fixture locator — " + fixtureName
        record.lifetime = .keepAlways
        add(record)
        print("KITTY_UI_EXPORT_FIXTURE: \(fixtureName)")
        capture("CSV — verified local destination before Save")

        // Recheck the actual provider immediately before Save; no cloud or overwrite fallback.
        XCTAssertTrue(isLocalExportRoot(navigation, selectedFromBrowse: pickedLocal))
        if fixtureName == "kitty-entries-2027-01-31.csv" { XCTAssertTrue(emptyRoot.exists) }
        let save = navigation.buttons["Save"]
        XCTAssertTrue(save.isEnabled)
        tap(save)
        XCTAssertTrue(text(containing: "Saved the CSV").waitForExistence(timeout: 6),
                      "Only a completed picker save may show this confirmation.")
        XCTAssertFalse(filename.exists)
        XCTAssertFalse(navigation.exists)
        capture("CSV — Saved confirmation for " + fixtureName)
        #else
        throw XCTSkip("This test creates only a fictional fixture in simulator-local Files.")
        #endif
    }

    private func text(containing value: String) -> XCUIElement {
        app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", value)).firstMatch
    }

    private func openHome() {
        XCTAssertTrue(page.waitForExistence(timeout: 15), "The bundled page must open.")
        let home = app.buttons["Home"]
        XCTAssertTrue(home.waitForExistence(timeout:45), "WebKit must load Kitty’s tabs.")
        let cash = app.buttons["Cash and offset, tap for the accounts behind it"]
        // Home is already selected on first launch. The nav exists in the static
        // shell before WebKit has laid it out; this control comes from the model.
        if !cash.waitForExistence(timeout: 8) { tap(home) }
        XCTAssertTrue(cash.waitForExistence(timeout: 12), "Home must finish rendering.")
    }

    private func canTap(_ element: XCUIElement) -> Bool {
        guard element.exists else { return false }
        let frame = element.frame
        // XCTest can raise an issue, rather than return false from isHittable,
        // for a WebKit accessibility node that has not received a screen frame.
        guard !frame.isEmpty, !frame.isInfinite, frame.intersects(app.frame) else { return false }
        return element.isHittable
    }

    private func searchField(_ label: String) -> XCUIElement {
        // WebKit exposes type=search as a search field or text field across OS releases.
        let search = app.searchFields[label]
        if search.waitForExistence(timeout: 2) { return search }
        let text = app.textFields[label]
        XCTAssertTrue(text.waitForExistence(timeout: 3), "Missing input: \(label)")
        return text
    }

    private func tap(_ element: XCUIElement, file: StaticString = #filePath, line: UInt = #line) {
        // Reading label on a missing node throws before the wait can observe the next AX tree.
        waitUntil("The requested control must become visible and tappable.", timeout: 8,
                  file: file, line: line) { self.canTap(element) }
        element.tap()
    }

    private func revealByScrollingDown(_ element: XCUIElement) {
        // A full flick can jump over a button on a short phone. Move part of a screen at a time.
        let top = page.coordinate(withNormalizedOffset: CGVector(dx:0.5, dy:0.35))
        let bottom = page.coordinate(withNormalizedOffset: CGVector(dx:0.5, dy:0.72))
        for _ in 0..<10 {
            if canTap(element) { return }
            if element.exists, !element.frame.isEmpty, element.frame.midY < page.frame.midY {
                top.press(forDuration:0.05, thenDragTo:bottom, withVelocity:.slow, thenHoldForDuration:0.15)
            } else {
                bottom.press(forDuration:0.05, thenDragTo:top, withVelocity:.slow, thenHoldForDuration:0.15)
            }
        }
    }

    private func dismissKeyboard() {
        guard app.keyboards.firstMatch.exists else { return }
        let done = app.buttons.matching(identifier: "Done").firstMatch
        if done.exists && done.isHittable {
            done.tap()
        } else {
            // The native scroll view explicitly supports interactive keyboard dismissal.
            page.swipeDown()
        }
        waitUntil("The keyboard must dismiss before export.", timeout: 3) {
            !self.app.keyboards.firstMatch.exists
        }
    }

    private func cancelExportPicker(navigation: XCUIElement) {
        XCTAssertTrue(navigation.waitForExistence(timeout: 8))
        // In a folder the navigation title opens an actions menu. Go back to Browse
        // for its Cancel button, or pull down on the sheet edge above the title.
        for _ in 0..<6 {
            let cancel = navigation.buttons["Cancel"]
            if canTap(cancel) { cancel.tap(); return }
            let back = navigation.buttons["BackButton"]
            guard canTap(back) else { break }
            back.tap()
        }
        let topEdge = navigation.coordinate(withNormalizedOffset: CGVector(dx:0.5, dy:0)).withOffset(CGVector(dx:0, dy:-5))
        let lowerScreen = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.85))
        topEdge.press(forDuration:0.05, thenDragTo:lowerScreen)
    }

    private var localExportRoot: XCUIElement {
        app.otherElements[
            "DOC.browsingRoot Source: com.apple.FileProvider.LocalStorage, Title: On My iPhone"]
    }

    private func isLocalExportRoot(_ navigation: XCUIElement, selectedFromBrowse: Bool) -> Bool {
        guard navigation.staticTexts["On My iPhone"].exists else { return false }
        if localExportRoot.exists || selectedFromBrowse { return true }
        // On a fresh simulator, Files can expose its empty state before the
        // browsingRoot accessibility container. A nested folder is not enough.
        let back = navigation.buttons["BackButton"]
        return back.exists && back.label == "Browse" &&
            app.descendants(matching: .any).matching(identifier: "On My iPhone is Empty").firstMatch.exists
    }

    private func selectVerifiedLocalExportDestination(navigation: XCUIElement) throws -> Bool {
        if isLocalExportRoot(navigation, selectedFromBrowse: false) { return false }
        // Never tap "On My iPhone" in the navigation title. Only select a
        // location from Browse; still require the destination title after the tap.
        let browse = navigation.buttons["BackButton"]
        if browse.exists && browse.label == "Browse" { tap(browse) }
        let browseTitle = navigation.staticTexts["Browse"]
        guard browseTitle.waitForExistence(timeout: 3) else {
            if isLocalExportRoot(navigation, selectedFromBrowse: false) { return false }
            capture("CSV save skipped — no Browse location selector")
            throw XCTSkip("Files did not expose a verifiable local destination; no file was saved.")
        }
        let local = app.staticTexts.matching(identifier: "On My iPhone").firstMatch
        guard local.waitForExistence(timeout: 3) else {
            capture("CSV save skipped — no local Files provider")
            throw XCTSkip("This simulator has no On My iPhone provider; no file was saved.")
        }
        tap(local)
        waitUntil("Files must enter the selected On My iPhone location.", timeout: 5) {
            self.isLocalExportRoot(navigation, selectedFromBrowse: true) && !browseTitle.exists
        }
        return true
    }

    private func waitUntil(_ message: String, timeout: TimeInterval,
                           file: StaticString = #filePath, line: UInt = #line,
                           condition: @escaping () -> Bool) {
        let expectation = XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in condition() }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: timeout), .completed,
                       message, file: file, line: line)
    }

    private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
