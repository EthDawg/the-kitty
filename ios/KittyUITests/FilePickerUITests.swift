import XCTest

/// Requires prepare_files_fixture.py for the target simulator. This fixture lives
/// outside the app sandbox; all selection and review uses the normal native UI.
final class FilePickerUITests: XCTestCase {
  private var app: XCUIApplication!

  override func setUpWithError() throws {
    continueAfterFailure = false
    app = XCUIApplication()
    app.launchArguments = ["--uitest-reset", "--demo"]
    app.launch()
    XCTAssertTrue(app.buttons["cashCard"].waitForExistence(timeout: 15))
  }

  private func capture(_ name: String) {
    let attachment = XCTAttachment(screenshot: app.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }

  private func reveal(
    _ element: XCUIElement, downward: Bool = false, fully: Bool = false, limit: Int = 24
  ) {
    for _ in 0..<limit {
      if element.exists && element.isHittable {
        let frame = element.frame
        if !fully || (frame.minY > 110 && frame.maxY < app.frame.maxY - 24) { return }
      }
      let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: downward ? 0.42 : 0.72))
      let end = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: downward ? 0.72 : 0.42))
      start.press(forDuration: 0.05, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0.1)
    }
  }

  private func chooseFictionalBankFile(capturePicker: Bool = false) {
    let choose = app.buttons["chooseCSV"]
    reveal(choose, downward: true); XCTAssertTrue(choose.isHittable); choose.tap()
    XCTAssertTrue(app.buttons["Cancel"].waitForExistence(timeout: 8))
    let file = app.cells["fictional-bank, csv"]
    if !file.exists || !file.isHittable {
      app.tabBars.buttons["Browse"].firstMatch.tap()
      if app.staticTexts["On My iPhone"].waitForExistence(timeout: 3) {
        app.staticTexts["On My iPhone"].tap()
      }
      let folder = app.staticTexts["Kitty QA"]
      XCTAssertTrue(folder.waitForExistence(timeout: 5)); folder.tap()
    }
    XCTAssertTrue(file.waitForExistence(timeout: 5))
    if capturePicker { capture("42-native-bank-csv-file-picker") }
    file.tap()
    if app.buttons["Open"].waitForExistence(timeout: 3) { app.buttons["Open"].tap() }
  }

  func testFilteredCSVSaveToNativeFiles() {
    app.tabBars.buttons["Activity"].tap()
    let search = app.searchFields.firstMatch
    XCTAssertTrue(search.waitForExistence(timeout: 5)); search.tap(); search.typeText("Woolworths")
    if app.keyboards.buttons["Search"].exists { app.keyboards.buttons["Search"].tap() }
    let export = app.buttons["activityExportResults"]
    reveal(export); export.tap()
    XCTAssertTrue(app.staticTexts["activityExportCount"].waitForExistence(timeout: 5))
    XCTAssertEqual(app.staticTexts["activityExportCount"].label, "38 transactions")
    let save = app.buttons["activityExportSave"]
    reveal(save); save.tap()
    XCTAssertTrue(app.buttons["Save"].waitForExistence(timeout: 8))
    let filename = "kitty-qa-export-" + UUID().uuidString.lowercased()
    let nameField = app.textFields["DOCPicker.filenameTextField"]
    XCTAssertTrue(nameField.waitForExistence(timeout: 5)); nameField.tap()
    let prior = nameField.value as? String ?? ""
    nameField.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: prior.count))
    nameField.typeText(filename)
    print("FILES_EXPORT_NAME=" + filename)
    capture("47-native-csv-save-destination")
    app.buttons["Save"].tap()
    let result = app.staticTexts["activityExportResult"]
    reveal(result, fully: true)
    XCTAssertTrue(result.waitForExistence(timeout: 8)); XCTAssertEqual(result.label, "CSV saved.")
    capture("48-native-csv-saved-result")
  }

  func testFictionalBankCSVFromNativeFilesPicker() {
    let importButton = app.buttons["importStatement"]
    reveal(importButton); importButton.tap()
    XCTAssertTrue(app.navigationBars["Import your records"].waitForExistence(timeout: 5))
    let account = app.buttons["importAccount"]
    reveal(account); account.tap()
    XCTAssertTrue(app.buttons["Everyday joint"].waitForExistence(timeout: 5))
    app.buttons["Everyday joint"].tap()
    chooseFictionalBankFile(capturePicker: true)
    let original = app.buttons["Remove fictional-bank.csv"]
    reveal(original)
    XCTAssertTrue(original.waitForExistence(timeout: 8))

    let mapping = app.buttons["Check column mapping"]
    reveal(mapping); mapping.tap()
    XCTAssertTrue(app.navigationBars["Column mapping"].waitForExistence(timeout: 5))
    capture("43-native-csv-column-mapping")
    app.buttons["Cancel"].tap()
    XCTAssertTrue(original.waitForExistence(timeout: 5), "Opening mapping must not invoke Remove.")

    chooseFictionalBankFile()
    XCTAssertTrue(app.alerts.firstMatch.waitForExistence(timeout: 5))
    XCTAssertTrue(app.alerts.staticTexts["That original file is already in this review."].exists)
    capture("44-native-csv-repeat-file-detected")
    app.alerts.buttons["OK"].tap()
    XCTAssertEqual(app.buttons.matching(identifier: "Remove fictional-bank.csv").count, 1)

    reveal(mapping); mapping.tap()
    XCTAssertTrue(app.navigationBars["Column mapping"].waitForExistence(timeout: 5))
    let confirm = app.buttons["Confirm mapping"]
    reveal(confirm); XCTAssertTrue(confirm.isEnabled); confirm.tap()
    XCTAssertTrue(app.navigationBars["Import your records"].waitForExistence(timeout: 5))
    XCTAssertTrue(original.exists)
    let count = app.staticTexts["5 new transactions"]
    reveal(count, fully: true); XCTAssertTrue(count.exists)
    capture("45-native-file-import-review")

    app.terminate(); app.launchArguments = ["--demo"]; app.launch()
    XCTAssertTrue(importButton.waitForExistence(timeout: 15)); reveal(importButton); importButton.tap()
    reveal(original); XCTAssertTrue(original.exists)
    reveal(count, fully: true); XCTAssertTrue(count.exists)
    let save = app.buttons["saveImport"]
    reveal(save, fully: true, limit: 40)
    XCTAssertTrue(save.exists)
    XCTAssertFalse(save.isEnabled, "Unresolved source decisions still block a save.")
    capture("46-native-file-review-after-relaunch")
  }
}
