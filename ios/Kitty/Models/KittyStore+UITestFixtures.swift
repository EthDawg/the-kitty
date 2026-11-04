#if DEBUG
import Foundation

/// Debug-only fixtures exercise normal decoding/recovery, with no Google access.
/// They are supplied by the UI test bundle and never included in a Release build.
@MainActor extension KittyStore {
  func installUITestFixtures() {
    let process = ProcessInfo.processInfo
    guard process.arguments.contains("--uitest-fixtures") else { return }
    do {
      if process.arguments.contains("--uitest-setup"),
        let encoded = process.environment["KITTY_UI_SETUP_DRAFT"],
        let bytes = Data(base64Encoded: encoded) {
        try persist(bytes, at: householdSetupURL)
      }
      if let encoded = process.environment["KITTY_UI_HOUSEHOLD_GRIDS"],
        let bytes = Data(base64Encoded: encoded),
        let grids = try JSONSerialization.jsonObject(with: bytes) as? [String: Any],
        let engine {
        let snapshot = try engine.snapshot(grids: grids)
        household = try engine.project(snapshot)
        snapshotData = snapshot
        let cachedHousehold = process.environment["KITTY_UI_CACHED_HOUSEHOLD"] == "1"
        mode = cachedHousehold ? .connected : .demo
        // A fictional cached screen exercises the normal switch-to-demo action.
        // No Sheet ID or Google identity is installed, so refresh cannot contact a provider.
        selectedSheetID = ""
        selectedSheetName = household?.household ?? "Fictional test household"
        sheetCanEdit = false
        isOffline = cachedHousehold
        lastSynced = nil
        draft = ImportDraft()
        proposal = nil
        clearSourceState()
      }
    } catch { self.error = "The local UI fixture could not be loaded: \(error.localizedDescription)" }
  }
}
#endif
