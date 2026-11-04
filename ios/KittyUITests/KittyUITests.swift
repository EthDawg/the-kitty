import XCTest

final class KittyUITests: XCTestCase {
  private var app: XCUIApplication!

  override func setUpWithError() throws {
    continueAfterFailure = false
    app = XCUIApplication()
    app.launchArguments = ["--uitest-reset", "--demo"]
    app.launch()
    XCTAssertTrue(
      app.buttons["cashCard"].waitForExistence(timeout: 15),
      "The bundled demo should open without sign-in or networking.")
  }

  private func capture(_ name: String) {
    let attachment = XCTAttachment(screenshot: app.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }

  private func reveal(_ element: XCUIElement, limit: Int = 8) {
    for _ in 0..<limit {
      if element.exists && element.isHittable { return }
      app.swipeUp()
    }
  }

  private func openTab(_ name: String) {
    let tab = app.tabBars.buttons[name]
    XCTAssertTrue(tab.exists)
    tab.tap()
  }

  func testHomeCashExplainsItsBasis() {
    XCTAssertTrue(app.staticTexts["$99,388.43"].exists)
    XCTAssertTrue(app.staticTexts["Fictional demo · January 2027"].exists)
    capture("01-home-cash-and-demo-status")
    app.buttons["cashCard"].tap()
    XCTAssertTrue(app.navigationBars["Your accounts"].waitForExistence(timeout: 5))
    XCTAssertTrue(
      app.staticTexts.containing(
        NSPredicate(format: "label CONTAINS %@", "isn’t a promise of what’s available to spend")
      ).firstMatch.exists)
    XCTAssertTrue(app.staticTexts["Everyday joint"].exists)
    capture("02-cash-account-evidence")
  }

  func testActivitySearchReachesOriginalTransactionEvidence() {
    openTab("Activity")
    let search = app.searchFields.firstMatch
    if !search.isHittable { app.swipeDown() }
    XCTAssertTrue(search.waitForExistence(timeout: 5))
    search.tap()
    search.typeText("Woolworths")
    let row = app.descendants(matching: .any)["transactionRow.T0919"].firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 5))
    if app.keyboards.buttons["Search"].exists { app.keyboards.buttons["Search"].tap() }
    row.tap()
    XCTAssertTrue(app.navigationBars["Transaction"].waitForExistence(timeout: 5))
    let evidence = app.staticTexts["From the original record"]
    reveal(evidence)
    XCTAssertTrue(evidence.exists)
    XCTAssertTrue(app.staticTexts["WOOLWORTHS 3021 BRUNSWICK"].exists)
    XCTAssertTrue(app.staticTexts["Transaction T0919"].exists)
    capture("03-transaction-original-evidence")
  }

  func testGoalDetailPreservesOverTargetAmountAndDemoEditBoundary() {
    openTab("Goals")
    let goal = app.descendants(matching: .any)["goalCard.3"].firstMatch
    reveal(goal)
    XCTAssertTrue(goal.exists)
    goal.tap()
    let plan = app.staticTexts["The plan"]
    reveal(plan)
    XCTAssertTrue(plan.exists)
    XCTAssertTrue(
      app.staticTexts.containing(
        NSPredicate(format: "label CONTAINS %@", "isn’t another balance to add")
      ).firstMatch.exists)
    capture("04-goal-plan-and-money-basis")
    let edit = app.buttons["Edit target"]
    reveal(edit)
    XCTAssertTrue(edit.isHittable)
    edit.tap()
    XCTAssertTrue(app.navigationBars["Edit goal"].waitForExistence(timeout: 5))
    let save = app.buttons["Save and verify"]
    reveal(save, limit: 14)
    XCTAssertTrue(save.exists)
    XCTAssertFalse(
      save.isEnabled,
      "A fictional demo must not pretend to save to Google.")
    capture("05-demo-goal-edit-boundary")
  }

  func testInsightsHasExactFiguresAndRecordedChecks() {
    openTab("Insights")
    let exact = app.buttons["Exact monthly figures"]
    reveal(exact)
    XCTAssertTrue(exact.exists)
    exact.tap()
    capture("06-insights-exact-figures")
    let checks = app.buttons["Checks & evidence"]
    reveal(checks, limit: 12)
    XCTAssertTrue(checks.isHittable)
    checks.tap()
    XCTAssertTrue(app.navigationBars["Checks & evidence"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts["Accounts add up to the Cash metric"].exists)
    capture("07-recorded-reconciliation-checks")
  }

  func testAskPreviewsDatedSummaryBeforeAnyExternalHandoff() {
    openTab("Ask")
    let prompt = app.buttons["Explain our cash position."]
    reveal(prompt)
    XCTAssertTrue(prompt.isHittable)
    prompt.tap()
    let review = app.buttons["Review & ask"]
    reveal(review)
    review.tap()
    XCTAssertTrue(app.navigationBars["Review your summary"].waitForExistence(timeout: 5))
    let summary = app.staticTexts.containing(
      NSPredicate(format: "label CONTAINS %@", "The Kitty household summary")
    ).firstMatch
    XCTAssertTrue(summary.exists)
    XCTAssertTrue(summary.label.contains("fictional demo"))
    XCTAssertTrue(summary.label.contains("2027-01-31"))
    XCTAssertTrue(summary.label.contains("99,388.43"))
    XCTAssertTrue(summary.label.contains("not been granted access"))
    capture("08-ai-summary-consent-preview")
    // Deliberately stop before copying or opening another app. This test sends no financial data.
  }

  func testSampleImportShowsUnresolvedCategoriesAndCannotClaimSaved() {
    app.buttons["importStatement"].tap()
    XCTAssertTrue(app.navigationBars["Import a statement"].waitForExistence(timeout: 5))
    let sample = app.buttons["sampleImport"]
    reveal(sample, limit: 14)
    XCTAssertTrue(sample.isHittable)
    sample.tap()
    let count = app.staticTexts["5 new transactions"]
    reveal(count)
    XCTAssertTrue(count.waitForExistence(timeout: 5))
    let unresolved = app.staticTexts["Choose a category for MYSTERY MERCHANT 047."]
    reveal(unresolved)
    XCTAssertTrue(
      unresolved.exists,
      "The unfamiliar merchant must reach a human review instead of silently guessing.")
    capture("09-import-unresolved-source-review")
    let save = app.buttons["saveImport"]
    reveal(save, limit: 14)
    XCTAssertTrue(save.exists)
    XCTAssertFalse(save.isEnabled, "An unresolved proposal must not be committable.")
    XCTAssertFalse(
      app.staticTexts["importState"].exists, "Preparing rows is not a completed import.")
    capture("10-import-save-held-until-review")
  }

  func testPracticeImportSurvivesRelaunchAndCannotBeImportedTwice() {
    app.buttons["importStatement"].tap()
    let sample = app.buttons["sampleImport"]
    reveal(sample, limit: 14)
    sample.tap()
    let unresolved = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "importUncategorised-")).firstMatch
    // The sample has four unfamiliar merchants. Resolve each explicitly; a large-text
    // List virtualises offscreen controls, so absence from the first snapshot is not completion.
    for _ in 0..<4 {
      reveal(unresolved, limit: 14)
      XCTAssertTrue(unresolved.exists)
      XCTAssertTrue(unresolved.isHittable)
      unresolved.tap()
    }
    let acknowledgement = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "importAcknowledge-")).firstMatch
    for _ in 0..<8 {
      if !acknowledgement.exists { break }
      reveal(acknowledgement, limit: 14)
      XCTAssertTrue(acknowledgement.isHittable)
      acknowledgement.tap()
    }
    let save = app.buttons["saveImport"]
    reveal(save, limit: 14)
    XCTAssertTrue(save.isEnabled, "Explicit source review should permit this synthetic practice batch.")
    save.tap()
    app.buttons["Complete practice"].tap()
    let receipt = app.staticTexts["importState"]
    reveal(receipt, limit: 14)
    XCTAssertTrue(receipt.waitForExistence(timeout: 5))
    XCTAssertTrue(receipt.label.contains("5 rows"))
    XCTAssertTrue(receipt.label.contains("Google Sheet was not changed"))
    capture("11-practice-import-verified-local-receipt")
    app.terminate()
    app.launchArguments = ["--demo"]
    app.launch()
    XCTAssertTrue(app.buttons["importStatement"].waitForExistence(timeout: 10))
    app.buttons["importStatement"].tap()
    let noOp = app.staticTexts["importNoOp"]
    reveal(noOp, limit: 14)
    XCTAssertTrue(noOp.waitForExistence(timeout: 5))
    XCTAssertTrue(noOp.label.contains("already recorded"))
    XCTAssertTrue(noOp.label.contains("Nothing to add"))
    reveal(app.buttons["saveImport"], limit: 14)
    XCTAssertFalse(app.buttons["saveImport"].isEnabled)
    capture("12-relaunched-import-adds-zero")
  }
}
