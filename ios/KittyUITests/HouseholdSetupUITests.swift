import XCTest

final class HouseholdSetupUITests: XCTestCase {
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
  private func revealFully(_ element: XCUIElement, in app: XCUIApplication) {
    for _ in 0..<24 {
      if element.exists && element.isHittable
        && element.frame.maxY < app.frame.maxY - 20 { return }
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
}
