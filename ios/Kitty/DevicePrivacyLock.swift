import Foundation
import LocalAuthentication

/// System authentication stays native. The page can request a change, never assert a successful unlock.
@MainActor
final class DevicePrivacyLock {
    typealias Failure = GoogleSheetTools.Failure
    private let defaults: UserDefaults
    private let verify: (() async throws -> Void)?
    private let key = "kitty.native.privacy.protect-live-sheet"
    private var generation = UUID(), admitted = false, checking = false
    private var context: LAContext?
    var enabled: Bool { defaults.bool(forKey:key) }
    var permitsLive: Bool { !enabled || admitted }
    init(defaults: UserDefaults, verify: (() async throws -> Void)? = nil) { self.defaults = defaults; self.verify = verify }

    func lock() { generation = UUID(); admitted = false; context?.invalidate() }
    func open() async throws { if enabled && !admitted { try await authenticate(); admitted = true } }
    func setEnabled(_ on: Bool) async throws {
        guard on != enabled else { return }
        try await authenticate()
        defaults.set(on,forKey:key); admitted = on
    }
    private func authenticate() async throws {
        guard !checking else { throw Failure(code:"busy",message:"Finish the device unlock first.") }
        let turn = generation; checking = true
        defer { checking = false; context = nil }
        if let verify { try await verify() }
        else {
            let policy = LAPolicy.deviceOwnerAuthentication, ctx = LAContext(); context = ctx
            var error: NSError?
            guard ctx.canEvaluatePolicy(policy,error:&error) else {
                throw Failure(code:"device_locked",message:"Set up a device passcode or biometrics to protect your live Sheet.")
            }
            do {
                guard try await ctx.evaluatePolicy(policy,localizedReason:"Unlock your live Sheet or change its privacy setting.") else {
                    throw Failure(code:"device_locked",message:"The live Sheet is still locked.")
                }
            } catch { throw Failure(code:"device_locked",message:"Device unlock was not completed. Your live Sheet is still protected.") }
        }
        guard turn == generation else { throw Failure(code:"device_locked",message:"Open your live Sheet again to unlock it.") }
    }
}
