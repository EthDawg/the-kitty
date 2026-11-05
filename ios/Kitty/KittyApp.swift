import SwiftUI

@main
struct KittyApp: App {
    @StateObject private var host = KittyHost()

    var body: some Scene {
        WindowGroup {
            KittyPage(controller: host.controller)
                .ignoresSafeArea(.container)
                .onOpenURL { host.controller.openDeepLink($0) }
        }
    }
}

@MainActor
private final class KittyHost: ObservableObject {
    let controller = KittyViewController()
}

private struct KittyPage: UIViewControllerRepresentable {
    let controller: KittyViewController
    func makeUIViewController(context: Context) -> KittyViewController { controller }
    func updateUIViewController(_ controller: KittyViewController, context: Context) {}
}
