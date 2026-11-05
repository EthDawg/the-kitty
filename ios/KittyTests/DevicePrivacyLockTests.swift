import XCTest
@testable import Kitty

@MainActor
final class DevicePrivacyLockTests: XCTestCase {
    func testLockPersistsAndBothOpeningAndDisablingNeedDeviceAuthentication() async throws {
        let suite = UUID().uuidString, defaults = try XCTUnwrap(UserDefaults(suiteName:suite))
        defer { defaults.removePersistentDomain(forName:suite) }
        var accepted = true, checks = 0
        let verify: () async throws -> Void = { checks += 1; if !accepted { throw NSError(domain:"fixture",code:1) } }
        let lock = DevicePrivacyLock(defaults:defaults,verify:verify)
        try await lock.open(); XCTAssertEqual(checks,0)
        try await lock.setEnabled(true); XCTAssertEqual(checks,1); XCTAssertTrue(lock.permitsLive)
        lock.lock(); XCTAssertFalse(lock.permitsLive)
        let relaunched = DevicePrivacyLock(defaults:defaults,verify:verify)
        XCTAssertTrue(relaunched.enabled); XCTAssertFalse(relaunched.permitsLive)
        accepted = false
        do { try await relaunched.open(); XCTFail("Cancelled unlock opened the Sheet") } catch {}
        do { try await relaunched.setEnabled(false); XCTFail("Cancelled unlock disabled protection") } catch {}
        XCTAssertTrue(relaunched.enabled); XCTAssertFalse(relaunched.permitsLive)
        accepted = true; try await relaunched.open(); XCTAssertTrue(relaunched.permitsLive)
        try await relaunched.setEnabled(false); XCTAssertFalse(relaunched.enabled)
    }
    func testLateAuthenticationAfterBackgroundDoesNotUnlock() async throws {
        let suite = UUID().uuidString, defaults = try XCTUnwrap(UserDefaults(suiteName:suite))
        defer { defaults.removePersistentDomain(forName:suite) }
        let setup = DevicePrivacyLock(defaults:defaults,verify:{}); try await setup.setEnabled(true)
        var lock: DevicePrivacyLock!
        lock = DevicePrivacyLock(defaults:defaults,verify:{ lock.lock() })
        do { try await lock.open(); XCTFail("Stale device proof admitted") }
        catch let e as GoogleSheetTools.Failure { XCTAssertEqual(e.code,"device_locked") }
        XCTAssertFalse(lock.permitsLive)
    }
}
