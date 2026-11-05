import SwiftUI

@main
struct KittyApp: App {
    var body: some Scene {
        WindowGroup {
            // Milestone 1 proves the native build. Milestone 2 supplies the shared page.
            Text("The Kitty")
                .accessibilityIdentifier("native-foundation")
        }
    }
}
