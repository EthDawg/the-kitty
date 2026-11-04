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

  private func revealPrecisely(_ element: XCUIElement, limit: Int = 24) {
    for _ in 0..<limit {
      if element.exists && element.isHittable { return }
      // Small controlled drags avoid flinging past a field's confirmation at
      // accessibility sizes, where a single field can be taller than a screen.
      let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.72))
      let end = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.43))
      start.press(forDuration: 0.05, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0.1)
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
    let title = app.navigationBars["Activity"].staticTexts["Activity"].firstMatch
    XCTAssertTrue(title.exists)
    XCTAssertFalse(title.frame.intersects(search.frame), "The Activity title must not cover search at large text sizes.")
    capture("26-activity-title-and-search")
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
    let identifier = app.staticTexts["Transaction T0919"]
    revealPrecisely(identifier)
    XCTAssertTrue(identifier.isHittable)
    capture("03-transaction-original-evidence")
  }

  func testFilteredActivityExportKeepsItsReviewWhenFilesPickerIsCancelled() {
    openTab("Activity")
    let search = app.searchFields.firstMatch
    if !search.isHittable { app.swipeDown() }
    XCTAssertTrue(search.waitForExistence(timeout: 5))
    search.tap(); search.typeText("Woolworths")
    if app.keyboards.buttons["Search"].exists { app.keyboards.buttons["Search"].tap() }
    let export = app.buttons["activityExportResults"]
    revealPrecisely(export); XCTAssertTrue(export.isHittable)
    XCTAssertTrue(export.isEnabled); export.tap()
    let count = app.staticTexts["activityExportCount"]
    XCTAssertTrue(count.waitForExistence(timeout: 5))
    XCTAssertEqual(count.label, "38 transactions")
    XCTAssertTrue(app.staticTexts["Woolworths"].exists)
    capture("35-filtered-activity-export-review")
    let save = app.buttons["activityExportSave"]
    revealPrecisely(save); XCTAssertTrue(save.isHittable); save.tap()
    XCTAssertTrue(app.buttons["Save"].waitForExistence(timeout: 8))
    capture("36-native-csv-destination-picker")
    // The iOS 26 destination picker has a Back button inside a folder, not
    // Cancel. Dismiss its sheet using the normal interactive gesture.
    let pickerTop = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.09))
    let pickerBottom = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.85))
    pickerTop.press(forDuration: 0.1, thenDragTo: pickerBottom)
    XCTAssertTrue(app.navigationBars["Export activity"].waitForExistence(timeout: 5))
    XCTAssertFalse(app.staticTexts["activityExportResult"].exists)
    app.buttons["activityExportDone"].tap()
    XCTAssertTrue(search.waitForExistence(timeout: 5))
    XCTAssertEqual(search.value as? String, "Woolworths")
  }

  func testHouseholdPreferencesExposeReadOnlyDemoInputs() {
    app.buttons["Settings"].tap()
    XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 5))
    let preferences = app.buttons["settings.preferences"]
    revealPrecisely(preferences); XCTAssertTrue(preferences.isHittable); preferences.tap()
    XCTAssertTrue(app.navigationBars["Household preferences"].waitForExistence(timeout: 5))
    let greeting = app.buttons["preferences.greeting"]
    revealPrecisely(greeting); XCTAssertTrue(greeting.isHittable)
    capture("37-household-preferences")
    greeting.tap()
    XCTAssertTrue(app.navigationBars["Greeting"].waitForExistence(timeout: 5))
    XCTAssertFalse(app.textFields["inputEdit.greeting"].isEnabled)
    let review = app.buttons["inputEdit.prepare"]
    revealPrecisely(review)
    XCTAssertTrue(review.exists); XCTAssertFalse(review.isEnabled)
    capture("38-demo-preference-edit-boundary")
  }

  func testNewGoalFormSupportsAmountEntryWithoutPretendingToSaveDemoData() {
    openTab("Goals")
    app.buttons["goals.add"].tap()
    let name = app.textFields["goal.name"]
    XCTAssertTrue(name.waitForExistence(timeout: 5)); name.tap(); name.typeText("A weekend away")
    app.buttons["goal.keyboardDone"].tap()
    let target = app.textFields["goal.target"]
    revealPrecisely(target); target.tap(); target.typeText("1234.56")
    app.buttons["goal.keyboardDone"].tap()
    XCTAssertEqual(target.value as? String, "1234.56")
    capture("39-new-goal-form")
    let account = app.buttons["goal.account"]
    revealPrecisely(account); XCTAssertTrue(account.isHittable); account.tap()
    XCTAssertTrue(app.buttons["Everyday joint"].waitForExistence(timeout: 5))
    app.buttons["Everyday joint"].tap()
    XCTAssertEqual(account.value as? String, "Everyday joint")
    capture("41-new-goal-account-selected")
    let review = app.buttons["goal.review"]
    revealPrecisely(review)
    XCTAssertTrue(review.exists); XCTAssertFalse(review.isEnabled)
    XCTAssertTrue(app.staticTexts["Demo goals are fictional and read-only. Connect your Sheet to save your own goals."].exists)
    capture("40-demo-goal-creation-boundary")
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

  func testMortgageScenariosUseRecordedSheetOptions() {
    openTab("Insights")
    let loan = app.buttons["insights.mortgage"]
    reveal(loan, limit: 18)
    loan.tap()
    XCTAssertTrue(app.navigationBars["Mortgage scenarios"].waitForExistence(timeout: 5))
    let rates = app.descendants(matching: .any)["mortgage.rateScenario.picker"].firstMatch
    reveal(rates, limit: 18)
    XCTAssertTrue(rates.isHittable)
    rates.tap()
    XCTAssertTrue(app.buttons["6.29%"].waitForExistence(timeout: 5))
    app.buttons["6.29%"].tap()
    let repayment = app.descendants(matching: .any)["mortgage.rateScenario.repayment"].firstMatch
    reveal(repayment)
    XCTAssertTrue(repayment.label.contains("3,991.91"))
    capture("13-mortgage-recorded-rate-scenario")
    let extras = app.descendants(matching: .any)["mortgage.extraScenario.picker"].firstMatch
    reveal(extras, limit: 18)
    extras.tap()
    XCTAssertTrue(app.buttons["$500.00"].waitForExistence(timeout: 5))
    app.buttons["$500.00"].tap()
    let total = app.descendants(matching: .any)["mortgage.extraScenario.repayment"].firstMatch
    reveal(total)
    XCTAssertTrue(total.label.contains("4,312.88"))
    capture("14-mortgage-recorded-extra-repayment")
  }

  func testPlanningViewsKeepDatesSourcesAndExactFigures() {
    openTab("Insights")
    let tax = app.buttons["insights.tax"]
    reveal(tax, limit: 18)
    tax.tap()
    XCTAssertTrue(app.navigationBars["Tax estimates"].waitForExistence(timeout: 5))
    let refund = app.descendants(matching: .any)["tax.metric.tax.refund.prior_year"].firstMatch
    reveal(refund)
    XCTAssertTrue(refund.label.contains("12,038.94"))
    XCTAssertTrue(refund.label.contains("FY26"))
    capture("15-tax-estimates-and-period")
    app.navigationBars.buttons.element(boundBy: 0).tap()

    let upcoming = app.buttons["insights.upcoming"]
    reveal(upcoming, limit: 18)
    upcoming.tap()
    XCTAssertTrue(app.navigationBars["Upcoming & pay"].waitForExistence(timeout: 5))
    let slips = app.buttons["upcoming.payslips"]
    reveal(slips)
    slips.tap()
    XCTAssertTrue(app.navigationBars["Payslip history"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts["Northwind Logistics"].exists)
    capture("16-recorded-payslip-evidence")
    app.navigationBars.buttons.element(boundBy: 0).tap()
    app.navigationBars.buttons.element(boundBy: 0).tap()

    let safety = app.buttons["insights.safety"]
    reveal(safety, limit: 18)
    safety.tap()
    let months = app.descendants(matching: .any)["safety.months"].firstMatch
    reveal(months)
    XCTAssertTrue(months.label.contains("3.66"))
    capture("17-safety-recorded-months")
    app.navigationBars.buttons.element(boundBy: 0).tap()

    let rental = app.buttons["insights.rental"]
    reveal(rental, limit: 18)
    rental.tap()
    let net = app.descendants(matching: .any)["rental.net"].firstMatch
    reveal(net, limit: 18)
    XCTAssertTrue(net.label.contains("26,989.75"))
    capture("18-rental-recorded-cash-flow")
  }

  func testImportAccountSelectionEnablesFileChoice() {
    app.buttons["importStatement"].tap()
    XCTAssertTrue(app.navigationBars["Import your records"].waitForExistence(timeout: 5))
    let account = app.buttons["importAccount"]
    revealPrecisely(account)
    XCTAssertEqual(account.value as? String, "Choose an account")
    let chooseCSV = app.buttons["chooseCSV"]
    revealPrecisely(chooseCSV)
    XCTAssertFalse(chooseCSV.isEnabled)
    // The selected account is part of every staged CSV's source identity.
    if !account.isHittable { app.swipeDown() }
    account.tap()
    let everyday = app.buttons["Everyday joint"].firstMatch
    XCTAssertTrue(everyday.waitForExistence(timeout: 5))
    everyday.tap()
    XCTAssertEqual(account.value as? String, "Everyday joint")
    revealPrecisely(chooseCSV)
    XCTAssertTrue(chooseCSV.isEnabled)
    capture("25-import-account-selected")
  }

  func testSampleImportShowsUnresolvedCategoriesAndCannotClaimSaved() {
    app.buttons["importStatement"].tap()
    XCTAssertTrue(app.navigationBars["Import your records"].waitForExistence(timeout: 5))
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

  func testDocumentOriginalAndCheckedFieldSurviveRelaunch() {
    app.buttons["importStatement"].tap()
    let sample = app.buttons["samplePayslip"]
    reveal(sample, limit: 16)
    sample.tap()
    let source = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "sourceReview-")).firstMatch
    reveal(source, limit: 16)
    XCTAssertTrue(source.waitForExistence(timeout: 10))
    source.tap()
    XCTAssertTrue(app.navigationBars["Review payslip"].waitForExistence(timeout: 5))
    let original = app.buttons["sourceOriginal"]
    original.tap()
    XCTAssertTrue(app.navigationBars["Original source"].waitForExistence(timeout: 5))
    capture("19-retained-original-payslip")
    app.buttons["Done"].tap()
    let confirm = app.buttons["sourceConfirm-payDate"]
    revealPrecisely(confirm)
    XCTAssertTrue(confirm.isHittable)
    confirm.tap()
    XCTAssertTrue(confirm.label.contains("Checked"))
    capture("20-document-field-confirmation")
    app.terminate()
    app.launchArguments = ["--demo"]
    app.launch()
    XCTAssertTrue(app.buttons["importStatement"].waitForExistence(timeout: 10))
    app.buttons["importStatement"].tap()
    reveal(source, limit: 16)
    source.tap()
    revealPrecisely(confirm)
    XCTAssertTrue(confirm.label.contains("Checked"))
    let person = app.descendants(matching: .any)["sourceField-person"].firstMatch
    revealPrecisely(person)
    XCTAssertTrue(person.label.contains("Choose"), "A full name on the source must not silently select a household person.")
    capture("21-reopened-document-review")
  }

  func testMonthClosePracticeShowsMissingEvidenceWithoutClaimingCompletion() {
    openTab("Insights")
    let link = app.buttons["insights.monthClose"]
    reveal(link, limit: 24)
    link.tap()
    XCTAssertTrue(app.navigationBars["Month-end review"].waitForExistence(timeout: 5))
    let check = app.buttons["checkMonth"]
    reveal(check, limit: 12)
    check.tap()
    let unresolved = app.staticTexts["Needs attention"].firstMatch
    reveal(unresolved, limit: 24)
    XCTAssertTrue(unresolved.exists)
    capture("22-month-end-missing-evidence")
    let limitation = app.staticTexts["closePracticeLimit"]
    reveal(limitation, limit: 30)
    XCTAssertTrue(limitation.exists)
    XCTAssertFalse(app.buttons["closeMonth"].exists)
  }
  func testTransferReviewRequiresTwoRecordedSidesAndAnExplanation() {
    openTab("Insights")
    let link = app.buttons["insights.monthClose"]
    reveal(link, limit: 24); link.tap()
    let check = app.buttons["checkMonth"]
    reveal(check, limit: 12); check.tap()
    let matching = app.buttons["closeMatching"]
    reveal(matching, limit: 16); matching.tap()
    XCTAssertTrue(app.navigationBars["Match & review"].waitForExistence(timeout: 5))
    let addTransfer = app.buttons["closeMatch.addTransfer"]
    revealPrecisely(addTransfer); addTransfer.tap()
    XCTAssertTrue(app.navigationBars["Review transfer"].waitForExistence(timeout: 5))
    let allDates = app.switches["closeTransfer.allDates"]
    revealPrecisely(allDates)
    allDates.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
    XCTAssertEqual(allDates.value as? String, "1")
    let search = app.textFields["closeTransfer.search"]
    revealPrecisely(search)
    search.tap(); search.typeText("2027-01-02")
    if app.keyboards.buttons["Search"].exists { app.keyboards.buttons["Search"].tap() }
    XCTAssertEqual(allDates.value as? String, "1", "Searching must preserve the chosen date range.")
    let outgoing = app.buttons["closeTransfer.select.T0881"]
    let incoming = app.buttons["closeTransfer.select.T0883"]
    revealPrecisely(outgoing); outgoing.tap()
    revealPrecisely(incoming); incoming.tap()
    let reason = app.descendants(matching: .any)["closeTransfer.reason"].firstMatch
    revealPrecisely(reason)
    let save = app.buttons["closeTransfer.save"]
    revealPrecisely(save)
    XCTAssertFalse(save.isEnabled, "Two opposite amounts alone cannot approve a transfer.")
    reason.tap(); reason.typeText("Checked the two original account entries for this transfer.")
    app.buttons["closeTransfer.keyboardDone"].tap()
    XCTAssertFalse(app.keyboards.firstMatch.exists)
    revealPrecisely(save)
    XCTAssertTrue(save.isEnabled)
    capture("23-explicit-transfer-pair-review")
    save.tap()
    XCTAssertTrue(app.navigationBars["Match & review"].waitForExistence(timeout: 5))
    let recorded = app.buttons["Remove pair"]
    revealPrecisely(recorded)
    XCTAssertTrue(recorded.exists)
    capture("24-retained-transfer-decision")
  }
}
