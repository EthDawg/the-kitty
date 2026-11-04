import SwiftUI

struct SheetWriteRecoverySection: View {
  @EnvironmentObject var store: KittyStore
  var body: some View {
    if store.newSheetWritesNeedRecovery {
      Section("A saved change needs checking") {
        Text("Your files and review stay on this device while the earlier change is resolved. Existing receipts can still be checked.")
          .font(.subheadline).foregroundStyle(KittyTheme.secondary)
        if store.inputEditsBlockNewWrites {
          NavigationLink("Check saved input change") { InputEditRecoveryView() }
        }
        if store.goalWritesBlocked {
          Button("Check saved goal") {
            store.showImport = false
            store.selectedTab = 3
          }
        }
      }.accessibilityIdentifier("sheetWriteRecovery")
    }
  }
}
