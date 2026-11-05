import XCTest

@MainActor
final class ImportPickerUITests: XCTestCase {
    func testBankPreviewOpensFilesAndCancellationLeavesPreviewEmpty() {
        continueAfterFailure = false
        executionTimeAllowance = 120
        let app = XCUIApplication(bundleIdentifier: "com.ethdawg.kitty")
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_AU"]
        app.launch()
        defer { app.terminate() }

        let setup = app.buttons["Setup"]
        XCTAssertTrue(setup.waitForExistence(timeout: 10))
        setup.tap()
        let openImport = app.buttons["Import a bank file"]
        XCTAssertTrue(openImport.waitForExistence(timeout: 5))
        let page = app.webViews.firstMatch
        for _ in 0..<6 where !openImport.isHittable { page.swipeUp() }
        XCTAssertTrue(openImport.isHittable)
        openImport.tap()
        let choose = app.buttons["Choose from Files"]
        XCTAssertTrue(choose.waitForExistence(timeout: 5))
        choose.tap()

        let navigation = app.navigationBars["FullDocumentManagerViewControllerNavigationBar"]
        // On a cold simulator UIKit can present the sheet before the Files service draws its controls.
        guard navigation.waitForExistence(timeout:45) else {
            let stalled = XCTAttachment(screenshot:app.screenshot())
            stalled.name = "Files presentation before its navigation controls appeared"
            stalled.lifetime = .keepAlways
            add(stalled)
            return XCTFail("The system Files picker did not expose its navigation controls.")
        }
        let cancel = app.buttons.matching(identifier: "Cancel").firstMatch
        if cancel.exists && cancel.isHittable {
            cancel.tap()
        } else {
            let edge = navigation.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0))
                .withOffset(CGVector(dx: 0, dy: -8))
            edge.press(forDuration: 0.15, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.85)))
        }
        XCTAssertTrue(app.staticTexts["No file selected."].waitForExistence(timeout: 6))
        XCTAssertFalse(navigation.exists)
        XCTAssertTrue(app.buttons["Preview import"].exists)
        XCTAssertFalse(app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Confirm import")).firstMatch.exists)
        let state = XCTAttachment(screenshot: app.screenshot())
        state.name = "Fictional bank import after Files cancellation"
        state.lifetime = .keepAlways
        add(state)
    }
}
