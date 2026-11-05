import Foundation
import XCTest
@testable import Kitty

private func googleFixture(_ status: Int, _ object: [String: Any] = [:]) -> GoogleHTTPResponse {
    GoogleHTTPResponse(statusCode: status, data: try! JSONSerialization.data(withJSONObject: object))
}

private actor GoogleResponseGate {
    let started = XCTestExpectation(description: "Synthetic Google request is waiting")
    private var completion: CheckedContinuation<GoogleHTTPResponse, Never>?
    func wait() async -> GoogleHTTPResponse {
        await withCheckedContinuation { continuation in
            completion = continuation
            started.fulfill()
        }
    }
    func release(_ response: GoogleHTTPResponse) { completion?.resume(returning: response); completion = nil }
}

private actor GoogleFixtureTransport: GoogleHTTPTransport {
    enum Step { case response(GoogleHTTPResponse), hold(GoogleResponseGate) }
    private var steps: [Step]
    private(set) var requests: [URLRequest] = []
    init(_ responses: [GoogleHTTPResponse] = []) { steps = responses.map(Step.response) }
    func append(_ step: Step) { steps.append(step) }
    func send(_ request: URLRequest, maximumBytes: Int) async throws -> GoogleHTTPResponse {
        requests.append(request)
        guard !steps.isEmpty else { throw URLError(.badServerResponse) }
        let step = steps.removeFirst()
        let result: GoogleHTTPResponse
        switch step {
        case .response(let value): result = value
        case .hold(let gate): result = await gate.wait()
        }
        guard result.data.count <= maximumBytes else { throw GoogleHTTP.Failure.responseTooLarge }
        return result
    }
}

/// All credentials and account/Sheet identifiers in these checks are synthetic.
@MainActor
final class GoogleConnectionTests: XCTestCase {
    private let config = GoogleConnection.Configuration(clientID: "synthetic-ios.apps.googleusercontent.com",
        callbackScheme: "com.googleusercontent.apps.synthetic-ios")
    private let sheet = "fictional_household_sheet_12345"
    private let person = "fictional-permission-id"
    private let scope = "https://www.googleapis.com/auth/drive.file"
    private let state = String(repeating: "s", count: 43)

    private final class Vault {
        var data: Data?
        var flags = GoogleSignOutState()
        var reads = 0
        var writes = 0
        var deleteLocked = false
        var writeLocked = false
        var flagsLocked = false
        var store: GoogleTokenStore {
            GoogleTokenStore(read: { self.reads += 1; return self.data }, write: {
                guard !self.writeLocked else { throw URLError(.noPermissionsToReadFile) }
                self.writes += 1; self.data = $0
            }, delete: {
                guard !self.deleteLocked else { throw URLError(.noPermissionsToReadFile) }
                self.data = nil
            })
        }
        var signOut: GoogleSignOutStore {
            GoogleSignOutStore(read: { self.flags }, write: {
                guard !self.flagsLocked else { throw URLError(.cannotCreateFile) }
                self.flags = $0
            })
        }
    }
    private final class Clock { var date = Date(timeIntervalSince1970: 1_800_000_000) }

    private func token(_ access: String = "synthetic-access", refresh: String? = "synthetic-refresh",
                       granted: String? = "https://www.googleapis.com/auth/drive.file", seconds: Int = 3600) -> GoogleHTTPResponse {
        var object: [String: Any] = ["access_token": access, "token_type": "Bearer", "expires_in": seconds]
        object["refresh_token"] = refresh
        object["scope"] = granted
        return googleFixture(200, object)
    }
    private func about(_ id: String = "fictional-permission-id") -> GoogleHTTPResponse {
        googleFixture(200, ["user": ["permissionId": id]])
    }
    private func callback(state: String, id: String? = nil) -> URL {
        var url = URLComponents(string: config.redirectURI)!
        url.queryItems = [URLQueryItem(name: "state", value: state), URLQueryItem(name: "code", value: "synthetic-code"),
            URLQueryItem(name: "scope", value: scope), URLQueryItem(name: "picked_file_ids", value: id ?? sheet)]
        return url.url!
    }
    private func connection(_ http: GoogleFixtureTransport, _ vault: Vault, clock: Clock = Clock(),
                            handler: GoogleConnection.AuthorizationHandler? = nil) -> GoogleConnection {
        GoogleConnection(configuration: config, transport: http, tokenStore: vault.store, signOutStore: vault.signOut,
            authorizationHandler: handler ?? { url, _ in
                let items = URLComponents(url: url, resolvingAgainstBaseURL: false)!.queryItems!
                let state = try XCTUnwrap(items.first(where: { $0.name == "state" })?.value)
                return self.callback(state: state)
            }, now: { clock.date })
    }

    func testPickerURLHasSingleScopeStatePKCEAndNoClientSecret() throws {
        // RFC 7636 Appendix B known-answer vector, not a mirror of the hash implementation.
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
        let challenge = GoogleConnection.pkceChallenge(verifier)
        XCTAssertEqual(challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
        let url = try GoogleConnection.authorizationURL(configuration: config, state: state, challenge: challenge, fileID: sheet)
        let values = Dictionary(uniqueKeysWithValues: URLComponents(url: url, resolvingAgainstBaseURL: false)!.queryItems!.map { ($0.name, $0.value) })
        XCTAssertEqual(url.scheme, "https"); XCTAssertEqual(url.host, "accounts.google.com")
        XCTAssertEqual(values["redirect_uri"]!, config.redirectURI)
        XCTAssertEqual(values["scope"]!, scope); XCTAssertEqual(values["state"]!, state)
        XCTAssertEqual(values["code_challenge"]!, challenge); XCTAssertEqual(values["code_challenge_method"]!, "S256")
        XCTAssertEqual(values["response_type"]!, "code"); XCTAssertEqual(values["access_type"]!, "offline")
        XCTAssertEqual(values["include_granted_scopes"]!, "false"); XCTAssertEqual(values["trigger_onepick"]!, "true")
        XCTAssertEqual(values["prompt"]!, "consent select_account"); XCTAssertEqual(values["allow_multiple"]!, "false")
        XCTAssertEqual(values["mimetypes"]!, "application/vnd.google-apps.spreadsheet"); XCTAssertEqual(values["file_ids"]!, sheet)
        XCTAssertNil(values["client_secret"] as Any?); XCTAssertNil(values["code_verifier"] as Any?)
        XCTAssertThrowsError(try GoogleConnection.authorizationURL(configuration: config, state: "weak", challenge: challenge))
        XCTAssertThrowsError(try GoogleConnection.authorizationURL(configuration: config, state: state, challenge: "weak"))
        XCTAssertThrowsError(try GoogleConnection.authorizationURL(configuration: config, state: state, challenge: challenge, fileID: "../other"))
    }

    func testConfigurationRequiresPublicIOSShapeAndMatchingRegisteredScheme() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".bundle")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let info: [String: Any] = ["CFBundleIdentifier": "com.example.synthetic", "CFBundlePackageType": "BNDL",
            "GoogleClientID": config.clientID, "CFBundleURLTypes": [["CFBundleURLSchemes": ["kitty", config.callbackScheme]]]]
        try PropertyListSerialization.data(fromPropertyList: info, format: .xml, options: 0)
            .write(to: directory.appendingPathComponent("Info.plist"))
        XCTAssertEqual(GoogleConnection.Configuration.from(try XCTUnwrap(Bundle(url: directory))), config)
        XCTAssertFalse(GoogleConnection.Configuration(clientID: config.clientID, callbackScheme: "kitty").isValid)
        XCTAssertFalse(GoogleConnection.Configuration(clientID: "$(GOOGLE_CLIENT_ID)", callbackScheme: "kitty").isValid)
    }

    func testCallbackRejectsWrongIdentityAmbiguityAndBroaderScopes() throws {
        let valid = callback(state: state)
        XCTAssertEqual(try GoogleConnection.authorizationResult(callback: valid, configuration: config, state: state).sheetID, sheet)
        XCTAssertThrowsError(try GoogleConnection.authorizationResult(callback: valid, configuration: config, state: "different-state"))
        XCTAssertThrowsError(try GoogleConnection.authorizationResult(callback: valid, configuration: config, state: state, expectedSheetID: "other_household_12345"))
        for suffix in ["&state=" + state, "&code=second", "&picked_file_ids=" + sheet, "&scope=" + scope,
                       "&error=access_denied", "#fragment"] {
            let url = try XCTUnwrap(URL(string: valid.absoluteString + suffix))
            XCTAssertThrowsError(try GoogleConnection.authorizationResult(callback: url, configuration: config, state: state), suffix)
        }
        let query = try XCTUnwrap(URLComponents(url: valid, resolvingAgainstBaseURL: false)?.percentEncodedQuery)
        for prefix in ["kitty:/oauthredirect", config.callbackScheme + "://attacker/oauthredirect",
                       config.callbackScheme + "://user:pass@attacker:404/oauthredirect",
                       config.callbackScheme + ":/another", config.callbackScheme + ":/%6Fauthredirect"] {
            let url = try XCTUnwrap(URL(string: prefix + "?" + query))
            XCTAssertThrowsError(try GoogleConnection.authorizationResult(callback: url, configuration: config, state: state), prefix)
        }
        for id in ["", sheet + ",", "," + sheet, sheet + "," + sheet, "../secrets", "short"] {
            XCTAssertThrowsError(try GoogleConnection.authorizationResult(callback: callback(state: state, id: id), configuration: config, state: state))
        }
        var broader = URLComponents(url: valid, resolvingAgainstBaseURL: false)!
        broader.queryItems = broader.queryItems!.filter { $0.name != "scope" } + [URLQueryItem(name: "scope", value: scope + " openid")]
        XCTAssertThrowsError(try GoogleConnection.authorizationResult(callback: broader.url!, configuration: config, state: state))
        let denied = URL(string: config.redirectURI + "?state=" + state + "&error=access_denied")!
        XCTAssertThrowsError(try GoogleConnection.authorizationResult(callback: denied, configuration: config, state: state)) {
            XCTAssertEqual($0 as? GoogleConnection.ConnectionError, .cancelled)
        }
    }

    func testAuthorizationExchangesSameVerifierAndVerifiesAboutBeforeExposingSelection() async throws {
        let vault = Vault()
        let gate = GoogleResponseGate()
        let http = GoogleFixtureTransport([token()]); await http.append(.hold(gate))
        var requestURL: URL?
        let service = connection(http, vault, handler: { url, scheme in
            XCTAssertEqual(scheme, self.config.callbackScheme)
            requestURL = url
            let state = URLComponents(url: url, resolvingAgainstBaseURL: false)!.queryItems!.first { $0.name == "state" }!.value!
            return self.callback(state: state)
        })
        let task = Task { try await service.authorize(fileID: sheet) }
        await fulfillment(of: [gate.started], timeout: 2)
        XCTAssertNil(service.selection); XCTAssertFalse(service.isConnected); XCTAssertEqual(vault.writes, 0)
        await gate.release(about())
        let selection = try await task.value
        XCTAssertEqual(selection.sheetID, sheet); XCTAssertEqual(selection.permissionID, person)
        let access = try await service.accessToken(for: selection)
        XCTAssertEqual(access, "synthetic-access"); XCTAssertEqual(vault.writes, 1); XCTAssertFalse(vault.flags.signedOut)
        let requests = await http.requests
        XCTAssertEqual(requests.map(\.httpMethod), ["POST", "GET"])
        XCTAssertEqual(requests[0].url?.absoluteString, "https://oauth2.googleapis.com/token")
        XCTAssertNil(requests[0].url?.query); XCTAssertNil(requests[0].value(forHTTPHeaderField: "Authorization"))
        let form = Dictionary(uniqueKeysWithValues: URLComponents(string: "https://fixture.invalid/?" + String(decoding: requests[0].httpBody!, as: UTF8.self))!.queryItems!.map { ($0.name, $0.value ?? "") })
        XCTAssertEqual(form["redirect_uri"], config.redirectURI); XCTAssertEqual(form["code"], "synthetic-code")
        XCTAssertNil(form["client_secret"])
        let verifier = try XCTUnwrap(form["code_verifier"])
        XCTAssertEqual(verifier.count, 43)
        let challenge = URLComponents(url: try XCTUnwrap(requestURL), resolvingAgainstBaseURL: false)!.queryItems!.first { $0.name == "code_challenge" }!.value
        XCTAssertEqual(GoogleConnection.pkceChallenge(verifier), challenge)
        XCTAssertEqual(requests[1].url?.path, "/drive/v3/about")
        XCTAssertEqual(URLComponents(url: requests[1].url!, resolvingAgainstBaseURL: false)?.queryItems, [URLQueryItem(name: "fields", value: "user(permissionId)")])
        XCTAssertEqual(requests[1].value(forHTTPHeaderField: "Authorization"), "Bearer synthetic-access")
    }

    func testBroaderTokenIsRefusedBeforeAboutOrStorage() async throws {
        let vault = Vault(), http = GoogleFixtureTransport([token(granted: scope + " openid")])
        let service = connection(http, vault)
        do { _ = try await service.authorize(); XCTFail("Broader grants must be rejected.") }
        catch { XCTAssertEqual(error as? GoogleConnection.ConnectionError, .missingPermission) }
        XCTAssertNil(service.selection); XCTAssertEqual(vault.writes, 0)
        let requests = await http.requests; XCTAssertEqual(requests.count, 1)
    }

    func testRestoreRechecksSameUserAndCreatesFreshGeneration() async throws {
        let vault = Vault(), first = connection(GoogleFixtureTransport([token(), about()]), vault)
        let original = try await first.authorize()
        let http = GoogleFixtureTransport([about()]), reopened = connection(http, vault)
        XCTAssertNil(reopened.selection); XCTAssertEqual(vault.reads, 0, "Constructing the host must not read a credential.")
        let restored = try await reopened.restore()
        XCTAssertEqual(restored?.permissionID, original.permissionID); XCTAssertEqual(restored?.sheetID, original.sheetID)
        XCTAssertNotEqual(restored?.sessionID, original.sessionID)
        do { _ = try await reopened.accessToken(for: original); XCTFail("Stale callers cannot obtain a token.") }
        catch { XCTAssertEqual(error as? GoogleConnection.ConnectionError, .reconnect) }
        let wrongSheet = GoogleConnection.Selection(permissionID: person, sheetID: "unselected_other_sheet", sessionID: restored!.sessionID)
        do { _ = try await reopened.accessToken(for: wrongSheet); XCTFail("Unselected Sheet must be rejected.") }
        catch { XCTAssertEqual(error as? GoogleConnection.ConnectionError, .reconnect) }
        let requests = await http.requests; XCTAssertEqual(requests.map { $0.url!.path }, ["/drive/v3/about"])
    }

    func testDifferentRestoredUserStopsSessionAndBlocksCredentialReuse() async throws {
        let vault = Vault(); _ = try await connection(GoogleFixtureTransport([token(), about()]), vault).authorize()
        let wrong = connection(GoogleFixtureTransport([about("different-fictional-person")]), vault)
        do { _ = try await wrong.restore(); XCTFail("A different user must not see the old Sheet.") }
        catch { XCTAssertEqual(error as? GoogleConnection.ConnectionError, .identityChanged) }
        XCTAssertNil(wrong.selection); XCTAssertTrue(vault.flags.signedOut); XCTAssertTrue(vault.flags.needsCleanup)
        let reads = vault.reads
        let next = connection(GoogleFixtureTransport(), vault)
        let selection = try await next.restore(); XCTAssertNil(selection); XCTAssertEqual(vault.reads, reads)
    }

    func testRefreshIsCoalescedAndPreservesRefreshTokenWhenProviderOmitsIt() async throws {
        let vault = Vault(), clock = Clock(), http = GoogleFixtureTransport([token(), about()])
        let service = connection(http, vault, clock: clock), selected = try await service.authorize()
        clock.date.addTimeInterval(3600)
        let gate = GoogleResponseGate(); await http.append(.hold(gate)); await http.append(.response(about()))
        let first = Task { try await service.accessToken(for: selected) }
        await fulfillment(of: [gate.started], timeout: 2)
        let second = Task { try await service.accessToken(for: selected) }
        await Task.yield()
        await gate.release(token("synthetic-refreshed", refresh: nil, granted: nil))
        let a = try await first.value, b = try await second.value
        XCTAssertEqual(a, "synthetic-refreshed"); XCTAssertEqual(b, a)
        let requests = await http.requests
        XCTAssertEqual(requests.map { $0.url!.path }, ["/token", "/drive/v3/about", "/token", "/drive/v3/about"])
        let stored = try XCTUnwrap(JSONSerialization.jsonObject(with: try XCTUnwrap(vault.data)) as? [String: Any])
        XCTAssertEqual(stored["refresh"] as? String, "synthetic-refresh")
        XCTAssertEqual(stored["permissionID"] as? String, person)
    }

    func testLateRefreshCannotRestoreCredentialsAfterDisconnect() async throws {
        let vault = Vault(), clock = Clock(), http = GoogleFixtureTransport([token(), about()])
        let service = connection(http, vault, clock: clock), selected = try await service.authorize()
        clock.date.addTimeInterval(3600)
        let gate = GoogleResponseGate(); await http.append(.hold(gate)); await http.append(.response(googleFixture(200)))
        let refresh = Task { try await service.accessToken(for: selected) }
        await fulfillment(of: [gate.started], timeout: 2)
        try await service.disconnect()
        await gate.release(token("late-synthetic-token"))
        do { _ = try await refresh.value; XCTFail("Late refresh must not reconnect a signed-out device.") } catch {}
        XCTAssertNil(service.selection); XCTAssertNil(vault.data); XCTAssertTrue(vault.flags.signedOut)
        XCTAssertEqual(vault.writes, 1)
        let requests = await http.requests
        XCTAssertEqual(requests.map { $0.url!.path }, ["/token", "/drive/v3/about", "/token", "/revoke"])
    }

    func testLateAuthorizationCannotPublishAfterDisconnect() async throws {
        let vault = Vault(), http = GoogleFixtureTransport(), gate = GoogleResponseGate()
        await http.append(.hold(gate))
        let service = connection(http, vault), authorization = Task { try await service.authorize() }
        await fulfillment(of: [gate.started], timeout: 2)
        try await service.disconnect()
        await gate.release(token())
        do { _ = try await authorization.value; XCTFail("Late code exchange must not publish a selection.") } catch {}
        XCTAssertNil(service.selection); XCTAssertEqual(vault.writes, 0); XCTAssertFalse(service.isAuthorizing)
        let requests = await http.requests; XCTAssertEqual(requests.map { $0.url!.path }, ["/token"])
    }

    func testLockedKeychainLeavesTombstoneAndCleanupRetryDoesNotRestoreAccess() async throws {
        let vault = Vault(), http = GoogleFixtureTransport([token(), about(), googleFixture(200)])
        let service = connection(http, vault), selected = try await service.authorize()
        vault.deleteLocked = true
        do { try await service.disconnect(); XCTFail("Locked cleanup must remain visible.") }
        catch { XCTAssertEqual(error as? GoogleConnection.ConnectionError,
            .disconnectIncomplete(localRemovalConfirmed: false, remoteRevocationConfirmed: true, signOutPersisted: true)) }
        XCTAssertNil(service.selection); XCTAssertTrue(service.needsCredentialCleanup); XCTAssertNotNil(vault.data)
        let reopened = connection(GoogleFixtureTransport([googleFixture(200)]), vault), reads = vault.reads
        let blocked = try await reopened.restore(); XCTAssertNil(blocked); XCTAssertEqual(vault.reads, reads)
        do { _ = try await reopened.accessToken(for: selected); XCTFail("Tombstone must block old tokens.") } catch {}
        vault.deleteLocked = false
        try await reopened.disconnect()
        XCTAssertNil(vault.data); XCTAssertTrue(vault.flags.signedOut); XCTAssertFalse(vault.flags.needsCleanup)
        XCTAssertEqual(vault.reads, reads + 1, "Cleanup can read solely to revoke/delete the blocked credential.")
    }

    func testFailedRemoteRevocationKeepsDeviceSignedOutAndDiagnosticsPrivate() async throws {
        let vault = Vault(), http = GoogleFixtureTransport([token(), about(), googleFixture(503, ["error": "PRIVATE fixture diagnostic"])])
        let service = connection(http, vault); _ = try await service.authorize()
        do { try await service.disconnect(); XCTFail("Remote revocation was not confirmed.") }
        catch {
            XCTAssertEqual(error as? GoogleConnection.ConnectionError, .revocationUnconfirmed)
            XCTAssertFalse(error.localizedDescription.contains("PRIVATE")); XCTAssertFalse(error.localizedDescription.contains("synthetic-refresh"))
        }
        XCTAssertNil(vault.data); XCTAssertNil(service.selection); XCTAssertTrue(vault.flags.signedOut)
        let requests = await http.requests
        XCTAssertEqual(requests.last?.url?.absoluteString, "https://oauth2.googleapis.com/revoke")
        XCTAssertNil(requests.last?.value(forHTTPHeaderField: "Authorization"))
        XCTAssertEqual(String(decoding: requests.last!.httpBody!, as: UTF8.self), "token=synthetic-refresh")
    }

    func testFailedCredentialAndTombstoneRemovalReportsUnpersistedSignOut() async throws {
        let vault = Vault(), http = GoogleFixtureTransport([token(), about(), googleFixture(503)])
        let service = connection(http, vault); _ = try await service.authorize()
        vault.deleteLocked = true; vault.flagsLocked = true
        do { try await service.disconnect(); XCTFail("All cleanup outcomes must remain explicit.") }
        catch { XCTAssertEqual(error as? GoogleConnection.ConnectionError,
            .disconnectIncomplete(localRemovalConfirmed: false, remoteRevocationConfirmed: false, signOutPersisted: false)) }
        XCTAssertNil(service.selection); XCTAssertTrue(service.needsCredentialCleanup)
    }

    func testUnconfiguredAndFailedStorageNeverPublishHousehold() async throws {
        let vault = Vault(), http = GoogleFixtureTransport()
        let missing = GoogleConnection(configuration: nil, transport: http, tokenStore: vault.store, signOutStore: vault.signOut)
        let restored = try await missing.restore(); XCTAssertNil(restored); XCTAssertEqual(vault.reads, 0)
        do { _ = try await missing.authorize(); XCTFail("Unconfigured builds cannot start sign-in.") }
        catch { XCTAssertEqual(error as? GoogleConnection.ConnectionError, .notConfigured) }
        let noRequests = await http.requests; XCTAssertTrue(noRequests.isEmpty)
        vault.writeLocked = true
        let denied = connection(GoogleFixtureTransport([token(), about()]), vault)
        do { _ = try await denied.authorize(); XCTFail("A failed Keychain write must not confirm a connection.") }
        catch { XCTAssertEqual(error as? GoogleConnection.ConnectionError, .credentialStorage) }
        XCTAssertNil(denied.selection); XCTAssertTrue(vault.flags.signedOut)
    }
}

private final class BoundedGoogleProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let probe = request.value(forHTTPHeaderField: "X-Fixture")
        let headers: [String: String] = probe == "declared" ? ["Content-Length": "1024"] : [:]
        let response = HTTPURLResponse(url: request.url!, statusCode: probe == "redirect" ? 302 : 200,
            httpVersion: "HTTP/1.1", headerFields: headers)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(repeating: 65, count: 20))
        if probe == "streamed" { client?.urlProtocol(self, didLoad: Data(repeating: 66, count: 20)) }
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

final class GoogleHTTPTests: XCTestCase {
    func testFixedHTTPSHostsAndBoundedResponseHandling() async throws {
        for value in ["http://www.googleapis.com/drive/v3/about", "https://www.googleapis.com.evil.invalid/drive/v3/about",
                      "https://user@www.googleapis.com/drive/v3/about", "https://www.googleapis.com:8443/drive/v3/about",
                      "https://www.googleapis.com/drive/v3/about#fragment"] {
            XCTAssertFalse(GoogleHTTP.accepts(URLRequest(url: URL(string: value)!)))
        }
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [BoundedGoogleProtocol.self]
        let http = GoogleHTTP(configuration: config)
        var request = URLRequest(url: URL(string: "https://www.googleapis.com/drive/v3/about")!)
        let normal = try await http.send(request, maximumBytes: 32)
        XCTAssertEqual(normal.statusCode, 200); XCTAssertEqual(normal.data.count, 20)
        for probe in ["declared", "streamed", "redirect"] {
            request.setValue(probe, forHTTPHeaderField: "X-Fixture")
            do { _ = try await http.send(request, maximumBytes: 32); XCTFail("Unexpected accepted response: " + probe) }
            catch let error as GoogleHTTP.Failure {
                switch (probe, error) {
                case ("redirect", .redirected), ("declared", .responseTooLarge), ("streamed", .responseTooLarge): break
                default: XCTFail("Unexpected rejection for " + probe)
                }
            }
        }
    }
}
