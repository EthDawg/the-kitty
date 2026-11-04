import XCTest

final class HouseholdSetupUITests: XCTestCase {
  private func fixture(_ name: String) throws -> String {
    let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: name, withExtension: "json"))
    return try Data(contentsOf: url).base64EncodedString()
  }
  private func reveal(_ element: XCUIElement, in app: XCUIApplication, limit: Int = 24) {
    for _ in 0..<limit {
      if element.exists && element.isHittable { return }
      let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.74))
      let end = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.42))
      start.press(forDuration: 0.05, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0.1)
    }
  }
  private func capture(_ app: XCUIApplication, _ name: String) {
    let attachment = XCTAttachment(screenshot: app.screenshot())
    attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
  }
  private func revealFully(_ element: XCUIElement, in app: XCUIApplication, bottom: CGFloat? = nil) {
    for _ in 0..<24 {
      if element.exists && element.isHittable
        && element.frame.maxY < (bottom ?? app.frame.maxY - 20) { return }
      let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.76))
      let end = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.56))
      start.press(forDuration: 0.05, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0.1)
    }
  }

  func testHouseholdOpeningReviewAndDraftSurviveRelaunchWithoutCreatingASheet() {
    let app = XCUIApplication()
    app.launchArguments = ["--uitest-reset", "--uitest-setup"]
    app.launch()
    let start = app.buttons["startHousehold"]
    XCTAssertTrue(start.waitForExistence(timeout: 12)); reveal(start, in: app); start.tap()
    let name = app.textFields["setup.household"]
    XCTAssertTrue(app.navigationBars["Start your household"].waitForExistence(timeout: 5))
    reveal(name, in: app); XCTAssertTrue(name.isHittable)
    name.tap(); name.typeText("Taylor test household")
    app.buttons["setup.keyboardDone"].tap()
    let person = app.textFields["setup.firstPerson"]
    reveal(person, in: app); person.tap(); person.typeText("Taylor")
    app.buttons["setup.keyboardDone"].tap()
    let account = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "setup.account.")).firstMatch
    reveal(account, in: app); XCTAssertTrue(account.isHittable); account.tap()
    let accountName = app.textFields["setup.accountName"]
    XCTAssertTrue(accountName.waitForExistence(timeout: 5)); accountName.tap(); accountName.typeText("Everyday")
    app.buttons["setup.accountKeyboardDone"].tap()
    let institution = app.textFields["setup.institution"]
    reveal(institution, in: app); institution.tap(); institution.typeText("Example bank")
    app.buttons["setup.accountKeyboardDone"].tap()
    let opening = app.textFields["setup.openingAmount"]
    reveal(opening, in: app); opening.tap(); opening.typeText("1234.56")
    app.buttons["setup.accountKeyboardDone"].tap()
    capture(app, "27-household-opening-account")
    app.navigationBars.buttons.element(boundBy: 0).tap()
    let review = app.buttons["setup.review"]
    reveal(review, in: app); XCTAssertTrue(review.isHittable); review.tap()
    XCTAssertTrue(app.navigationBars["Review your setup"].waitForExistence(timeout: 5))
    let amount = app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "$1,234.56")).firstMatch
    revealFully(amount, in: app); XCTAssertTrue(amount.isHittable)
    XCTAssertLessThan(amount.frame.maxY, app.frame.maxY - 20)
    XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "Money held")).firstMatch.exists)
    capture(app, "28-reviewed-household-opening-balances")
    // Stop at local review: this journey grants no Google access and creates no Sheet.
    app.terminate(); app.launchArguments = ["--uitest-setup"]; app.launch()
    XCTAssertTrue(start.waitForExistence(timeout: 12)); reveal(start, in: app); start.tap()
    let saved = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "setup.account.")).firstMatch
    revealFully(saved, in: app)
    XCTAssertTrue(saved.label.contains("Everyday"))
    XCTAssertTrue(saved.label.contains("1,234.56"))
    capture(app, "29-resumed-household-draft")
  }

  func testCompletedSetupCanStartAnotherHouseholdWithoutDisconnecting() throws {
    let app = XCUIApplication()
    app.launchArguments = ["--uitest-reset", "--uitest-setup", "--uitest-fixtures"]
    app.launchEnvironment["KITTY_UI_SETUP_DRAFT"] = try fixture("verified-household-setup")
    app.launch()
    let start = app.buttons["startHousehold"]
    XCTAssertTrue(start.waitForExistence(timeout: 12)); reveal(start, in: app); start.tap()
    let another = app.buttons["setup.startAnother"]
    XCTAssertTrue(app.navigationBars["Your new household"].waitForExistence(timeout: 5))
    let open = app.buttons["setup.openCreated"]
    reveal(open, in: app); XCTAssertTrue(open.exists)
    revealFully(another, in: app); XCTAssertTrue(another.isHittable)
    capture(app, "30-completed-setup-next-household")
    another.tap()
    let name = app.textFields["setup.household"]
    XCTAssertTrue(app.navigationBars["Start your household"].waitForExistence(timeout: 5))
    reveal(name, in: app); XCTAssertTrue(name.isHittable)
    XCTAssertEqual(name.value as? String, "Household name")
    XCTAssertFalse(app.buttons["setup.openCreated"].exists)
    capture(app, "31-fresh-setup-after-completion")
    app.terminate()
    app.launchArguments = ["--uitest-setup"]
    app.launchEnvironment = [:]
    app.launch()
    XCTAssertTrue(start.waitForExistence(timeout: 12)); reveal(start, in: app); start.tap()
    XCTAssertTrue(app.navigationBars["Start your household"].waitForExistence(timeout: 5))
    XCTAssertFalse(app.buttons["setup.openCreated"].exists)
  }

  func testUnreadableSetupOffersRetryAndRetainsItsHold() {
    let app = XCUIApplication()
    app.launchArguments = ["--uitest-reset", "--uitest-setup", "--uitest-fixtures"]
    app.launchEnvironment["KITTY_UI_SETUP_DRAFT"] = Data("incomplete recovery record".utf8).base64EncodedString()
    app.launch()
    if app.alerts.firstMatch.waitForExistence(timeout: 5) { app.alerts.buttons["OK"].tap() }
    let start = app.buttons["startHousehold"]
    XCTAssertTrue(start.waitForExistence(timeout: 12)); reveal(start, in: app); start.tap()
    let retry = app.buttons["setup.retryRecovery"]
    XCTAssertTrue(retry.waitForExistence(timeout: 5)); reveal(retry, in: app); retry.tap()
    XCTAssertTrue(app.alerts.firstMatch.waitForExistence(timeout: 5))
    app.alerts.buttons["OK"].tap()
    XCTAssertTrue(retry.exists)
    XCTAssertFalse(app.textFields["setup.household"].exists)
    XCTAssertFalse(app.buttons["setup.startAnother"].exists)
    capture(app, "32-preserved-setup-recovery")
  }

  func testOpeningHouseholdShowsOnlyItsOwnBalancesAndNoDemoActivity() throws {
    let app = XCUIApplication()
    app.launchArguments = ["--uitest-reset", "--uitest-fixtures"]
    app.launchEnvironment["KITTY_UI_HOUSEHOLD_GRIDS"] = try fixture("opening-household-grids")
    app.launch()
    XCTAssertTrue(app.navigationBars["The Kitty"].waitForExistence(timeout: 12))
    XCTAssertTrue(app.staticTexts["QA fixture - Solo (fictional)"].exists)
    XCTAssertFalse(app.staticTexts["The Davies"].exists)
    let amount = app.staticTexts["$1,234.56"]
    let bottomTabs = app.tabBars.firstMatch
    let contentBottom = bottomTabs.exists && bottomTabs.frame.minY > app.frame.midY
      ? bottomTabs.frame.minY - 12 : app.frame.maxY - 24
    revealFully(amount, in: app, bottom: contentBottom); XCTAssertTrue(amount.isHittable)
    XCTAssertLessThan(amount.frame.maxY, contentBottom, "The opening amount must be above the floating tab bar.")
    capture(app, "33-opening-household-home")
    app.kittyTab("Activity").tap()
    XCTAssertTrue(app.staticTexts["Nothing here just yet"].waitForExistence(timeout: 5))
    XCTAssertFalse(app.activityExportButton().isEnabled)
    capture(app, "34-opening-household-empty-activity")
  }
}
