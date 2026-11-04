import Foundation
import JavaScriptCore

@MainActor final class EngineBridge {
  private let context: JSContext
  private var scriptError: String?
  init() throws {
    guard let ctx = JSContext() else {
      throw KittyError.message("The calculation engine couldn't start. Please reopen The Kitty.")
    }
    context = ctx
    context.exceptionHandler = { [weak self] _, value in self?.scriptError = value?.toString() }
    for name in ["engine", "bridge", "import"] {
      guard let url = Bundle.main.url(forResource: name, withExtension: "js") else {
        if name == "import" { continue }
        throw KittyError.message("The app is missing its calculation engine.")
      }
      context.evaluateScript(try String(contentsOf: url, encoding: .utf8))
      if let scriptError { throw KittyError.message(scriptError) }
    }
  }
  func call(_ object: String, method: String, input: Any) throws -> Data {
    scriptError = nil
    guard
      let value = context.objectForKeyedSubscript(object)?.invokeMethod(
        method, withArguments: [input])
    else { throw KittyError.message("This operation is unavailable in this build.") }
    if let scriptError { throw KittyError.message(scriptError) }
    guard !value.isUndefined, let object = value.toObject() else {
      throw KittyError.message("The Sheet returned an unreadable result.")
    }
    return try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
  }
  func project(_ data: Data) throws -> Household {
    let raw = try JSONSerialization.jsonObject(with: data)
    return try JSONDecoder().decode(
      Household.self, from: call("NativeKitty", method: "project", input: raw))
  }
  func snapshot(grids: [String: Any]) throws -> Data {
    try call("NativeKitty", method: "fromGrids", input: grids)
  }
}
enum KittyError: LocalizedError {
  case message(String)
  var errorDescription: String? {
    if case .message(let s) = self { return s }
    return nil
  }
}
