// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "AskAppleProbe",
    platforms: [.macOS(.v13)],
    products: [.executable(name: "kitty-ask-apple-probe", targets: ["AskAppleProbe"])],
    targets: [
        .executableTarget(name: "AskAppleProbe", path: "Sources"),
        .testTarget(name: "AskAppleProbeTests", dependencies: ["AskAppleProbe"], path: "Tests")
    ]
)
