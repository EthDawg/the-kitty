import Foundation

enum HostPolicy {
    static let routes: Set<String> = ["home", "activity", "review", "insights", "goals", "setup"]
    static let preferencePath = "data/users/native-demo/kitty"
    static let maximumExportBytes = 10 * 1024 * 1024

    static func trusted(_ url: URL?, bundleURL: URL, mainFrame: Bool) -> Bool {
        guard mainFrame, let url, url.isFileURL, (url.host ?? "") == (bundleURL.host ?? "") else { return false }
        return url.standardizedFileURL.path == bundleURL.standardizedFileURL.path
    }

    static func route(_ url: URL) -> String? {
        guard url.scheme?.lowercased() == "kitty", url.user == nil, url.password == nil,
              url.port == nil, url.query == nil, url.fragment == nil else { return nil }
        let value = url.host ?? ""
        return routes.contains(value) && (url.path.isEmpty || url.path == "/") ? value : nil
    }

    static func exportName(_ input: String) -> String? {
        guard !input.isEmpty, input.utf8.count <= 180, !input.hasPrefix("."),
              !input.contains("/"), !input.contains("\\"), !input.contains(":"),
              input.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) }) else { return nil }
        return input
    }

    static func reply(_ value: Any = NSNull()) -> [String: Any] { ["ok": true, "value": value] }
    static func failure(_ code: String, _ message: String) -> [String: Any] {
        ["ok": false, "error": ["code": code, "message": message]]
    }
}
