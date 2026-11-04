import XCTest

/// Gates control descriptions, traits and hit regions. Retains the platform's
/// visual findings separately; this does not establish full accessibility.
final class KittyAccessibilityTests: XCTestCase {
  func testPrimaryScreenControlsAndVisualDiagnostics() throws {
    let app = XCUIApplication()
    app.launchArguments = ["--uitest-reset", "--demo"]
    app.launch()
    XCTAssertTrue(app.buttons["cashCard"].waitForExistence(timeout: 15))
    for name in ["Home", "Activity", "Insights", "Goals", "Ask"] {
      app.kittyTab(name).tap()
      try audit(app, screen: name)
    }
    app.kittyTab("Home").tap()
    app.buttons["importStatement"].tap()
    XCTAssertTrue(app.navigationBars["Import your records"].waitForExistence(timeout: 5))
    try audit(app, screen: "Import")
  }

  private func audit(_ app: XCUIApplication, screen: String) throws {
    var findings: [[String: String]] = []
    var controlFailures: [String] = []
    try app.performAccessibilityAudit { issue in
      findings.append([
        "type": String(issue.auditType.rawValue),
        "summary": issue.compactDescription,
        "detail": issue.detailedDescription,
        "element": issue.element?.debugDescription ?? "No element supplied",
      ])
      if !issue.auditType.intersection([.hitRegion, .sufficientElementDescription, .trait]).isEmpty {
        controlFailures.append(issue.compactDescription)
      }
      return true
    }
    let data = try JSONSerialization.data(withJSONObject: findings, options: [.prettyPrinted, .sortedKeys])
    let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
    attachment.name = "accessibility-\(screen.lowercased())"
    attachment.lifetime = .keepAlways
    add(attachment)
    let tree = XCTAttachment(string: app.debugDescription)
    tree.name = "accessibility-tree-\(screen.lowercased())"
    tree.lifetime = .keepAlways
    add(tree)
    let screenshot = XCTAttachment(screenshot: app.screenshot())
    screenshot.name = "accessibility-\(screen.lowercased())"
    screenshot.lifetime = .keepAlways
    add(screenshot)
    print("ACCESSIBILITY \(screen): \(findings.count) recorded findings")
    XCTAssertTrue(controlFailures.isEmpty, "\(screen) control audit: \(controlFailures.joined(separator: "; "))")
  }
}
