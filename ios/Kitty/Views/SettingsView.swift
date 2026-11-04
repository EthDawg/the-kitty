import SwiftUI

struct SettingsView: View {
  @EnvironmentObject var store: KittyStore
  @ObservedObject var google: GoogleConnection
  @Environment(\.dismiss) var dismiss
  @State private var files: [GoogleSheetFile] = []
  @State private var loading = false
  @State private var message: String?
  @State private var confirmDisconnect = false
  @State private var confirmCopy = false
  var body: some View {
    List {
      Section {
        HStack(spacing: 15) {
          Image("Welcome").resizable().scaledToFit().frame(width: 65, height: 65)
          VStack(alignment: .leading, spacing: 5) {
            Text("The Kitty").font(.title2.bold())
            Text("Your money. Your Sheet.").font(.subheadline).foregroundStyle(KittyTheme.secondary)
          }
        }
      }
      Section("Your Google Sheet") {
        NavigationLink(store.setupDraft.isLocked ? "Resume household setup" : "Start a new household") {
          HouseholdSetupView()
        }.disabled(store.busy || store.importBusy || store.disconnecting)
        if !store.selectedSheetID.isEmpty {
          Text(store.selectedSheetName).font(.headline)
          if !store.sheetCanEdit { Text("View-only access").font(.caption).foregroundStyle(KittyTheme.secondary) }
          SourceLink(label: "your Sheet", range: "A1")
          Button("Refresh now") { Task { await store.refresh() } }
          if let sync = store.lastSynced {
            Text("Last read \(sync.formatted(date:.abbreviated,time:.shortened))").font(.caption)
          }
        }
        if google.isConnected {
          Button("Choose a Google Sheet") { Task { await store.connect() } }
            .disabled(store.busy || store.disconnecting)
          ForEach(files) { file in
            Button {
              Task { await store.select(file) }
            } label: {
              Label(file.name, systemImage: "tablecells")
            }.disabled(store.busy || store.disconnecting)
          }
          Button("Disconnect Google", role: .destructive) { confirmDisconnect = true }
            .disabled(store.disconnecting)
        } else {
          Button {
            Task {
              await store.connect()
              if google.isConnected { await loadFiles() }
            }
          } label: {
            Label("Connect Google", systemImage: "person.crop.circle.badge.checkmark")
          }.disabled(store.busy || store.disconnecting)
          Text(
            "The Kitty requests access only to files you create or explicitly authorise for it. Your bank sign-in stays with your bank."
          ).font(.subheadline).foregroundStyle(KittyTheme.secondary)
        }
        if google.needsCredentialCleanup {
          Button("Retry clearing saved Google access", role: .destructive) {
            Task { await store.disconnect() }
          }.disabled(store.busy || store.importBusy || store.disconnecting)
        }
        Button("Create a Davies demo copy") { confirmCopy = true }
          .disabled(store.busy || store.disconnecting)
        Text("A demo copy belongs to you in Google Drive and contains only fictional data.")
          .font(.caption).foregroundStyle(KittyTheme.secondary)
        if store.disconnecting { ProgressView("Disconnecting Google…") }
        else if loading || store.busy { ProgressView("Connecting…") }
        if let message { Text(message).font(.subheadline).foregroundStyle(KittyTheme.warning) }
      }
      if store.household != nil {
        Section("Your choices") {
          NavigationLink("Household preferences") { KittyPreferencesView() }
            .accessibilityIdentifier("settings.preferences")
        }
      }
      if store.inputEditsBlockNewWrites {
        Section {
          NavigationLink("Check saved input change") { InputEditRecoveryView() }
            .accessibilityIdentifier("settings.inputRecovery")
        }
      }
      Section("Privacy & control") {
        NavigationLink("Privacy policy & your data") { PrivacyView() }
        Link("Help & support", destination: URL(string: "https://github.com/EthDawg/the-kitty/issues")!)
        if store.mode != .demo {
          Button("Explore the fictional demo") {
            store.openDemo()
            dismiss()
          }
        }
        Text("No advertising or behavioural analytics. You choose when a summary leaves the app.")
          .font(.caption).foregroundStyle(KittyTheme.secondary)
      }
      Section {
        Text("The Kitty for iOS · 0.1.0").font(.caption)
        Text(
          "Development build. Live sign-in, private imports and distribution require the configured Google client and service."
        ).font(.caption).foregroundStyle(KittyTheme.secondary)
      }
    }.navigationTitle("Settings").onChange(of: google.pickedSheetIDs) { _, _ in files = [] }.toolbar {
      ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } }
    }
    .confirmationDialog(
      "Disconnect Google?", isPresented: $confirmDisconnect, titleVisibility: .visible
    ) {
      Button("Disconnect Google", role: .destructive) {
        Task {
          await store.disconnect()
          dismiss()
        }
      }
    } message: {
      Text(
        "Your Google Sheet stays in Drive. Saved Sheet data and unsubmitted reviews are removed from this device. An unresolved save keeps its protected files and receipt until you reconnect to the same Sheet and check it."
      )
    }
    .confirmationDialog(
      "Create a fictional demo in your Drive?", isPresented: $confirmCopy, titleVisibility: .visible
    ) {
      Button("Create demo copy") {
        Task {
          loading = true
          defer { loading = false }
          await store.connect(createDemo: true)
        }
      }
    } message: {
      Text(
        "This creates a new Google Sheet containing the fictional Davies household. It will not replace an existing Sheet."
      )
    }
  }
  func loadFiles() async {
    loading = true
    defer { loading = false }
    do {
      files = try await store.sheets.listAccessibleFiles()
      message = files.isEmpty ? "No Sheets are authorised for this app yet." : nil
    } catch { message = error.localizedDescription }
  }
}
struct PrivacyView: View {
  var body: some View {
    List {
      Section("The Kitty · privacy policy") {
        Text("Updated 4 November 2026. The Kitty is a household finance viewer and importer built around the Google Sheet you choose. You do not create a separate Kitty account.")
      }
      Section("Your Sheet stays yours") {
        Text(
          "Your financial records remain in your Google Sheet. The Kitty stores a protected copy on this device so you can view the last read while offline."
        )
      }
      Section("Imports") {
        Text(
          "Files you choose and your pending review are kept in the app’s protected storage. When you approve a live import, the configured service processes those files and writes evidence and a verified receipt to your Google Drive and Sheet. A service error never means an import succeeded."
        )
      }
      Section("AI") {
        Text(
          "AI is optional. You can inspect the exact question and financial context before sharing. For answers inside The Kitty, the service reads the selected Sheet and sends only your approved context to Anthropic or OpenAI. The AI cannot edit your Sheet. Your Google access token and Sheet link are not sent to the AI provider."
        )
        Text("You can also copy a summary to your own Claude or ChatGPT conversation. Each provider processes and retains the shared data under its own terms. The Kitty does not promise zero retention by those services.")
        Link("Anthropic privacy policy", destination: URL(string: "https://www.anthropic.com/legal/privacy")!)
        Link("OpenAI privacy policy", destination: URL(string: "https://openai.com/policies/privacy-policy/")!)
      }
      Section("Leaving") {
        Text(
          "Disconnecting clears the app’s connection and local Sheet data. If a save has an unresolved outcome, its protected review and receipt stay on this device for recovery after you reconnect to the same Sheet. Disconnecting does not delete your Sheet or original records in Drive."
        )
      }
      Section("Retention and deletion") {
        Text("Sheet copies, original import files and pending reviews are stored in protected app storage. Discarding an unsubmitted review removes its local files. Disconnecting removes cached Sheet data; an unresolved save retains its recovery receipt as described above. Removing the app removes its local records.")
        Text("New household setup saves the settings you approve and a recovery record in your Google Drive. Unsubmitted setup details stay on this device. An interrupted creation keeps its protected operation record so it can be checked before another Sheet is created.")
        Text("Your Sheet, imported originals and receipts in Google Drive remain under your control until you delete them in Drive. The import service uses your Google token for the request and does not keep a separate household database. AI providers may retain approved context under their own policies. Removing local data does not delete a conversation you created with another provider.")
      }
      Section("No tracking") {
        Text(
          "This app has no advertising or behavioural analytics. Financial data must not be included in diagnostic logs."
        )
      }
      Section("Help and privacy questions") {
        Link("Contact The Kitty’s developer", destination: URL(string: "https://github.com/EthDawg/the-kitty/issues")!)
        Text("GitHub reports are public. Do not include financial records, credentials or other private details in a report.").font(.caption)
      }
    }.navigationTitle("Privacy policy").navigationBarTitleDisplayMode(.inline)
  }
}
