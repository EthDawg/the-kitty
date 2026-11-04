import SwiftUI

/// Explains the template's optional JSON feed, not Google Drive sharing.
struct ImportPublicationSection: View {
  @EnvironmentObject var store: KittyStore
  var body: some View {
    if let message = store.importPublicationNotice {
      Section {
        Label("Turn off the public data feed", systemImage: "exclamationmark.shield")
          .font(.headline).foregroundStyle(KittyTheme.warning)
          .fixedSize(horizontal: false, vertical: true)
        Text(message).font(.subheadline).fixedSize(horizontal: false, vertical: true)
          .accessibilityIdentifier("importPublicFeedNotice")
        SourceLink(label: "Kitty settings", range: "Kitty!A1:C")
        Button("Refresh after changing the setting") { Task { await store.refresh() } }
          .disabled(store.busy || store.importBusy || store.disconnecting)
        Text("This setting controls the Sheet's optional data feed. Google Drive sharing is managed separately.")
          .font(.caption).foregroundStyle(KittyTheme.secondary)
      }
    }
  }
}
