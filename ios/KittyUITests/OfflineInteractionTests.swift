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

    func testSearchReviewAndCancelledCSVExport() {
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
        XCTAssertTrue(filename.waitForExistence(timeout: 20), "Files must finish loading the export picker.")
        XCTAssertTrue(pickerNavigation.exists, "The native Files navigation must be present.")
        XCTAssertTrue((filename.value as? String)?.hasPrefix("kitty-entries-") == true,
                      "The picker must contain this export's filename.")
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
        XCTAssertTrue(text(containing: "fictional copy, with no Google or AI connection active")
            .waitForExistence(timeout: 4))
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
        XCTAssertTrue(page.waitForExistence(timeout: 10))
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
        XCTAssertTrue(filename.waitForExistence(timeout: 20), "Files must finish loading the export picker.")
        XCTAssertTrue(navigation.exists)
        let pickedLocal = try selectVerifiedLocalExportDestination(navigation: navigation)

        let current = try XCTUnwrap(filename.value as? String)
        XCTAssertTrue(current.hasPrefix("kitty-entries-") && current.count < 200)
        tap(filename)
        filename.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: current.count + 8))
        XCTAssertTrue((filename.value as? String ?? "").isEmpty,
                      "The original name must be completely cleared before entering a unique name.")
        // Files hides and preserves the original CSV extension outside this editable basename.
        let uniqueBasename = "kitty-native-export-" + UUID().uuidString.lowercased()
        let uniqueName = uniqueBasename + ".csv"
        filename.typeText(uniqueBasename)
        XCTAssertEqual(filename.value as? String, uniqueBasename)
        let record = XCTAttachment(string: """
            Simulator-only fictional CSV fixture
            Filename: \(uniqueName)
            Destination: On My iPhone (com.apple.FileProvider.LocalStorage)
            Activity filter: woolworths
            This UI test checks picker completion and the Saved toast.
            Exact CSV byte/content verification requires separate simulator-container readback.
            """)
        record.name = "CSV fixture locator — " + uniqueName
        record.lifetime = .keepAlways
        add(record)
        print("KITTY_UI_EXPORT_FIXTURE: \(uniqueName)")
        capture("CSV — unique local filename before Save")

        // Recheck the actual provider immediately before Save; no cloud or overwrite fallback.
        XCTAssertTrue(isLocalExportRoot(navigation, selectedFromBrowse: pickedLocal))
        let save = navigation.buttons["Save"]
        XCTAssertTrue(save.isEnabled)
        tap(save)
        XCTAssertTrue(text(containing: "Saved the CSV").waitForExistence(timeout: 6),
                      "Only a completed picker save may show this confirmation.")
        XCTAssertFalse(filename.exists)
        XCTAssertFalse(navigation.exists)
        capture("CSV — Saved confirmation for " + uniqueName)
        #else
        throw XCTSkip("This test creates only a fictional fixture in simulator-local Files.")
        #endif
    }

    private func text(containing value: String) -> XCUIElement {
        app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", value)).firstMatch
    }

    private func openHome() {
        XCTAssertTrue(page.waitForExistence(timeout: 15), "The bundled page must open.")
        let cash = app.buttons["Cash and offset, tap for the accounts behind it"]
        // Home is already selected on first launch. The nav exists in the static
        // shell before WebKit has laid it out; this control comes from the model.
        if !cash.waitForExistence(timeout: 8) { tap(app.buttons["Home"]) }
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
        // Only nearby controls, never an unbounded search through all review rows.
        for _ in 0..<3 {
            if canTap(element) { return }
            page.swipeUp()
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
        // iOS 26 opens at the previous location. Its underlying Other("Cancel") is
        // covered by Files' More button, so never tap that stale accessibility node.
        for _ in 0..<2 {
            let cancel = app.buttons.matching(identifier: "Cancel").firstMatch
            if cancel.exists && cancel.isHittable {
                tap(cancel)
                return
            }
            let browse = navigation.buttons["BackButton"]
            guard browse.exists && browse.isHittable && browse.label == "Browse" else { break }
            tap(browse)
        }

        // The observed picker is a sheet with a top edge immediately above its nav bar.
        // Dismiss it with the same downward drag a person can use, without pressing Save.
        XCTAssertTrue(navigation.exists && navigation.isHittable)
        let topEdge = navigation.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0))
            .withOffset(CGVector(dx: 0, dy: -8))
        let lowerScreen = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.85))
        topEdge.press(forDuration: 0.15, thenDragTo: lowerScreen)
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
