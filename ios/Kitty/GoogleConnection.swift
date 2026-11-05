import AuthenticationServices
import Combine
import CryptoKit
import Foundation
import Security
import UIKit

/// Google credentials stay in native memory/Keychain. The page receives only connection state and Sheet data.
@MainActor
final class GoogleConnection: NSObject, ObservableObject, ASWebAuthenticationPresentationContextProviding {
    struct Configuration: Equatable {
        let clientID: String
        let callbackScheme: String
        var redirectURI: String { callbackScheme + ":/oauthredirect" }
        var isValid: Bool {
            clientID.range(of: "^[a-z0-9_-]+\\.apps\\.googleusercontent\\.com$", options: .regularExpression) != nil
                && callbackScheme == clientID.split(separator: ".").reversed().joined(separator: ".")
        }

        static func from(_ bundle: Bundle) -> Configuration? {
            guard let clientID = bundle.object(forInfoDictionaryKey: "GoogleClientID") as? String else { return nil }
            let scheme = clientID.split(separator: ".").reversed().joined(separator: ".")
            let config = Configuration(clientID: clientID, callbackScheme: scheme)
            let registrations = bundle.object(forInfoDictionaryKey: "CFBundleURLTypes") as? [[String: Any]] ?? []
            guard config.isValid,
                  registrations.flatMap({ $0["CFBundleURLSchemes"] as? [String] ?? [] }).contains(scheme) else { return nil }
            return config
        }
    }

    struct Selection: Equatable {
        let permissionID: String
        let sheetID: String
        /// Compare the complete selection before publishing a request's result after any suspension.
        let sessionID: UUID
    }

    enum ConnectionError: LocalizedError, Equatable {
        case notConfigured, configurationRejected, reconnect, busy, cancelled, invalidCallback
        case missingPermission, invalidResponse, identityChanged, noWindow, randomGeneration
        case credentialStorage, serviceUnavailable, revocationUnconfirmed
        case disconnectIncomplete(localRemovalConfirmed: Bool, remoteRevocationConfirmed: Bool, signOutPersisted: Bool)

        var errorDescription: String? {
            switch self {
            case .notConfigured: return "Google connection is not available in this build. The app needs its registered Google iOS client."
            case .configurationRejected: return "Google did not accept this app's sign-in configuration."
            case .reconnect: return "Reconnect Google and choose your Sheet to continue."
            case .busy: return "Finish the current Google connection action first."
            case .cancelled: return "Google connection was cancelled. Your Sheet has not changed."
            case .invalidCallback: return "Google sign-in could not be verified. Please start it again."
            case .missingPermission: return "The Kitty needs permission for the Google Sheet you select. Connect again and allow that permission."
            case .invalidResponse: return "Google returned a response that could not be verified."
            case .identityChanged: return "The Google account changed. Connect again before opening a household."
            case .noWindow: return "Open The Kitty on screen before connecting Google."
            case .randomGeneration: return "A secure connection could not be started. Please try again."
            case .credentialStorage: return "Your Google connection could not be stored or removed securely. Unlock this device and try again."
            case .serviceUnavailable: return "Google connection is temporarily unavailable. Please try again."
            case .revocationUnconfirmed: return "This device is disconnected. Google could not confirm removal of access; you can remove The Kitty in your Google Account connections."
            case .disconnectIncomplete(let local, let remote, let persisted):
                var parts = [local || persisted ? "This device is disconnected." : "Access is stopped for this session, but sign-out could not be persisted."]
                if !local {
                    parts.append("Saved Google credentials could not be removed. Unlock this device and disconnect again.")
                    if persisted { parts.append("The saved credentials are blocked from reuse.") }
                }
                parts.append(remote ? "Google confirmed removal of access." : "Google could not confirm removal of access; you can remove The Kitty in your Google Account connections.")
                return parts.joined(separator: " ")
            }
        }
    }

    @Published private(set) var selection: Selection?
    @Published private(set) var isAuthorizing = false
    @Published private(set) var isRestoring = false
    @Published private(set) var isDisconnecting = false
    @Published private(set) var needsCredentialCleanup = false
    var isConnected: Bool { selection != nil }
    var hasSavedGrant: Bool {
        guard signOutStore.exists(), let state = try? signOutStore.read() else { return false }
        return !state.signedOut && !state.needsCleanup
    }
    var isConfigured: Bool { configuration?.isValid == true }

    static let scope = "https://www.googleapis.com/auth/drive.file"
    typealias AuthorizationHandler = (URL, String) async throws -> URL

    private struct Credential: Codable {
        let version: Int
        let clientID: String
        let permissionID: String
        let sheetID: String
        let access: String
        let refresh: String?
        let expiresAt: Date
        let scope: String
    }
    private struct TokenResponse: Decodable {
        let access_token: String
        let refresh_token: String?
        let expires_in: Double
        let scope: String?
        let token_type: String
    }

    private let configuration: Configuration?
    private let transport: GoogleHTTPTransport
    private let tokenStore: GoogleTokenStore
    private let signOutStore: GoogleSignOutStore
    private let authorizationHandler: AuthorizationHandler?
    private let now: () -> Date
    private var credential: Credential?
    private var generation = UUID()
    private var refreshTask: Task<String, Error>?
    private var refreshTaskID: UUID?
    private var authSession: ASWebAuthenticationSession?
    private var authID: UUID?
    private var authCompletion: ((Result<URL, Error>) -> Void)?
    private var anchor: UIWindow?

    init(configuration: Configuration? = Configuration.from(.main),
         transport: GoogleHTTPTransport = GoogleHTTP(), tokenStore: GoogleTokenStore? = nil,
         signOutStore: GoogleSignOutStore? = nil, defaults: UserDefaults = .standard,
         authorizationHandler: AuthorizationHandler? = nil, now: @escaping () -> Date = Date.init) {
        self.configuration = configuration
        self.transport = transport
        let service = (Bundle.main.bundleIdentifier ?? "com.ethdawg.kitty") + ".google-oauth"
        self.tokenStore = tokenStore ?? .keychain(clientID: configuration?.clientID ?? "unconfigured", service: service)
        self.signOutStore = signOutStore ?? .preferences(defaults, key: service + "." + (configuration?.clientID ?? "unconfigured") + ".sign-out")
        self.authorizationHandler = authorizationHandler
        self.now = now
        super.init()
        // No Keychain reads in init. The host explicitly restores and verifies identity before exposing a household.
    }

    /// Authorization always uses the external native Picker and exactly one explicit Sheet selection.
    @discardableResult
    func authorize(fileID: String? = nil) async throws -> Selection {
        guard let config = configuration, config.isValid else { throw ConnectionError.notConfigured }
        guard !isAuthorizing, !isRestoring, !isDisconnecting else { throw ConnectionError.busy }
        if let fileID, !Self.validSheetID(fileID) { throw ConnectionError.invalidCallback }
        let verifier = try Self.randomURLSafe(bytes: 32)
        let state = try Self.randomURLSafe(bytes: 32)
        let challenge = Self.pkceChallenge(verifier)
        let url = try Self.authorizationURL(configuration: config, state: state, challenge: challenge, fileID: fileID)
        isAuthorizing = true
        let current = beginGeneration()
        defer { isAuthorizing = false }
        // A cancelled account switch must not silently restore the previous account on the next launch.
        needsCredentialCleanup = true
        do { try signOutStore.write(GoogleSignOutState(signedOut: true, needsCleanup: true)) }
        catch { throw ConnectionError.credentialStorage }

        let callback: URL
        if let authorizationHandler { callback = try await authorizationHandler(url, config.callbackScheme) }
        else { callback = try await authenticate(url: url, callbackScheme: config.callbackScheme) }
        try checkGeneration(current)
        let result = try Self.authorizationResult(callback: callback, configuration: config, state: state, expectedSheetID: fileID)
        let response = try await requestTokens([
            "client_id": config.clientID, "code": result.code, "code_verifier": verifier,
            "grant_type": "authorization_code", "redirect_uri": config.redirectURI,
        ])
        try checkGeneration(current)
        try validateToken(response, fallbackScope: nil)
        let permissionID = try await readPermissionID(accessToken: response.access_token)
        try checkGeneration(current)
        let next = Credential(version: 1, clientID: config.clientID, permissionID: permissionID,
            sheetID: result.sheetID, access: response.access_token, refresh: response.refresh_token,
            expiresAt: now().addingTimeInterval(response.expires_in), scope: Self.scope)
        try persist(next, newAuthorization: true)
        let selected = Selection(permissionID: permissionID, sheetID: result.sheetID, sessionID: current)
        selection = selected
        return selected
    }

    /// Drive gave this app a grant for a file it created. The native copy receipt binds it
    /// to the current account; a web-view supplied identifier cannot switch the Keychain scope.
    func adoptPractice(_ copy: GooglePracticeSheet.Copy) throws -> Selection {
        guard selection == copy.source, !isAuthorizing, !isRestoring, !isDisconnecting,
              let stored = credential, stored.sheetID == GoogleSheetSelection.demoFileID,
              stored.permissionID == copy.source.permissionID else { throw ConnectionError.reconnect }
        let next = Credential(version:stored.version, clientID:stored.clientID, permissionID:stored.permissionID,
                              sheetID:copy.id, access:stored.access, refresh:stored.refresh, expiresAt:stored.expiresAt, scope:stored.scope)
        let current = beginGeneration()
        try persist(next)
        let picked = Selection(permissionID:next.permissionID, sheetID:copy.id, sessionID:current)
        selection = picked
        return picked
    }

    /// A saved token is not a verified live session until Drive confirms the same native user identity.
    @discardableResult
    func restore() async throws -> Selection? {
        guard let config = configuration, config.isValid else { return nil }
        guard !isAuthorizing, !isRestoring, !isDisconnecting else { throw ConnectionError.busy }
        isRestoring = true
        let current = beginGeneration()
        defer { isRestoring = false }
        let state = try readSignOutState()
        needsCredentialCleanup = state.needsCleanup
        guard !state.signedOut, !state.needsCleanup else { return nil }
        let data: Data?
        do { data = try tokenStore.read() } catch { throw ConnectionError.credentialStorage }
        guard let data else { return nil }
        var stored = try decodeCredential(data, configuration: config)
        do {
            if stored.expiresAt.timeIntervalSince(now()) <= 90 { stored = try await refreshed(stored) }
            try checkGeneration(current)
            let permissionID = try await readPermissionID(accessToken: stored.access)
            try checkGeneration(current)
            guard permissionID == stored.permissionID else { throw ConnectionError.identityChanged }
            try persist(stored)
            let selected = Selection(permissionID: stored.permissionID, sheetID: stored.sheetID, sessionID: current)
            selection = selected
            return selected
        } catch {
            if generation == current { clearRejectedCredential(error) }
            throw error
        }
    }

    /// The native REST caller supplies its captured selection, never a Sheet ID received unchecked from JS.
    func accessToken(for expected: Selection) async throws -> String {
        guard !isAuthorizing, !isRestoring, !isDisconnecting,
              selection == expected, let stored = credential else { throw ConnectionError.reconnect }
        let state = try readSignOutState()
        guard !state.signedOut, !state.needsCleanup else { throw ConnectionError.reconnect }
        if stored.expiresAt.timeIntervalSince(now()) > 90 { return stored.access }
        if let refreshTask {
            let access = try await refreshTask.value
            try checkGeneration(expected.sessionID)
            guard selection == expected else { throw ConnectionError.reconnect }
            return access
        }
        let current = generation
        let taskID = UUID()
        let task = Task<String, Error> { [weak self] in
            guard let self else { throw CancellationError() }
            do {
                let next = try await self.refreshed(stored)
                try self.checkGeneration(current)
                let permissionID = try await self.readPermissionID(accessToken: next.access)
                try self.checkGeneration(current)
                guard permissionID == stored.permissionID, self.selection == expected else {
                    throw ConnectionError.identityChanged
                }
                try self.persist(next)
                return next.access
            } catch {
                if self.generation == current { self.clearRejectedCredential(error) }
                throw error
            }
        }
        refreshTask = task
        refreshTaskID = taskID
        defer {
            if refreshTaskID == taskID { refreshTask = nil; refreshTaskID = nil }
        }
        let access = try await task.value
        try checkGeneration(current)
        guard selection == expected else { throw ConnectionError.reconnect }
        return access
    }

    /// Local identity disappears before any network wait. Cleanup failure never restores signed-out access.
    func disconnect() async throws {
        guard !isDisconnecting else { throw ConnectionError.busy }
        isDisconnecting = true
        defer { isDisconnecting = false }
        var revoke = credential?.refresh ?? credential?.access
        _ = beginGeneration()
        cancelAuthentication()
        needsCredentialCleanup = true
        var persisted = false
        do { try signOutStore.write(GoogleSignOutState(signedOut: true, needsCleanup: true)); persisted = true }
        catch { /* Still attempt both local removal and remote revocation. */ }
        var remoteNeeded = revoke != nil
        if revoke == nil, let config = configuration, config.isValid {
            do {
                if let data = try tokenStore.read() {
                    remoteNeeded = true
                    let stored = try decodeCredential(data, configuration: config)
                    revoke = stored.refresh ?? stored.access
                }
            } catch { remoteNeeded = true }
        }
        var localRemoved = true
        do { try tokenStore.delete() } catch { localRemoved = false }
        needsCredentialCleanup = !localRemoved
        do {
            try signOutStore.write(GoogleSignOutState(signedOut: true, needsCleanup: !localRemoved))
            persisted = true
        } catch { /* The first persisted tombstone remains sufficient when it succeeded. */ }
        var remoteConfirmed = false
        if let revoke {
            do {
                let response = try await transport.send(Self.formRequest(path: "revoke", fields: ["token": revoke]), maximumBytes: 16 * 1024)
                remoteConfirmed = response.statusCode == 200
            } catch { /* A local sign-out is not a claim that Google revoked access. */ }
        }
        if !localRemoved {
            throw ConnectionError.disconnectIncomplete(localRemovalConfirmed: false,
                remoteRevocationConfirmed: remoteConfirmed, signOutPersisted: persisted)
        }
        if remoteNeeded && !remoteConfirmed { throw ConnectionError.revocationUnconfirmed }
    }

    struct AuthorizationResult: Equatable { let code: String; let sheetID: String }

    static func validSheetID(_ id: String) -> Bool {
        id.range(of: "^[A-Za-z0-9_-]{10,200}$", options: .regularExpression) != nil
    }

    static func pkceChallenge(_ verifier: String) -> String {
        base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
    }

    static func authorizationURL(configuration: Configuration, state: String, challenge: String,
                                 fileID: String? = nil) throws -> URL {
        guard configuration.isValid,
              state.range(of: "^[A-Za-z0-9_-]{43,128}$", options: .regularExpression) != nil,
              challenge.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil,
              fileID.map(validSheetID) ?? true else { throw ConnectionError.invalidCallback }
        var url = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
        url.queryItems = [
            URLQueryItem(name: "client_id", value: configuration.clientID),
            URLQueryItem(name: "redirect_uri", value: configuration.redirectURI),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "scope", value: scope),
            URLQueryItem(name: "state", value: state),
            URLQueryItem(name: "code_challenge", value: challenge),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
            URLQueryItem(name: "access_type", value: "offline"),
            URLQueryItem(name: "prompt", value: "consent select_account"),
            URLQueryItem(name: "include_granted_scopes", value: "false"),
            URLQueryItem(name: "trigger_onepick", value: "true"),
            URLQueryItem(name: "mimetypes", value: "application/vnd.google-apps.spreadsheet"),
            URLQueryItem(name: "allow_multiple", value: "false"),
        ]
        if let fileID { url.queryItems?.append(URLQueryItem(name: "file_ids", value: fileID)) }
        guard let result = url.url else { throw ConnectionError.invalidCallback }
        return result
    }

    static func authorizationResult(callback: URL, configuration: Configuration, state: String,
                                    expectedSheetID: String? = nil) throws -> AuthorizationResult {
        guard configuration.isValid, callback.absoluteString.utf8.count <= 16 * 1024,
              let parts = URLComponents(url: callback, resolvingAgainstBaseURL: false),
              parts.scheme == configuration.callbackScheme, parts.host == nil,
              parts.user == nil, parts.password == nil, parts.port == nil, parts.fragment == nil,
              parts.percentEncodedPath == "/oauthredirect" else { throw ConnectionError.invalidCallback }
        let items = parts.queryItems ?? []
        guard items.count <= 20, Set(items.map(\.name)).count == items.count,
              items.allSatisfy({ !$0.name.isEmpty && $0.name.utf8.count <= 100 && ($0.value?.utf8.count ?? 0) <= 8192 }),
              items.first(where: { $0.name == "state" })?.value == state else { throw ConnectionError.invalidCallback }
        let values = Dictionary(uniqueKeysWithValues: items.map { ($0.name, $0.value ?? "") })
        if let error = values["error"] {
            guard values["code"] == nil, values["picked_file_ids"] == nil else { throw ConnectionError.invalidCallback }
            if error == "access_denied" { throw ConnectionError.cancelled }
            if ["invalid_client", "redirect_uri_mismatch", "unauthorized_client"].contains(error) { throw ConnectionError.configurationRejected }
            throw ConnectionError.serviceUnavailable
        }
        guard let code = values["code"], !code.isEmpty, code.utf8.count <= 4096,
              !code.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains),
              values["scope"] == scope,
              let raw = values["picked_file_ids"] else { throw ConnectionError.invalidCallback }
        let ids = raw.split(separator: ",", omittingEmptySubsequences: false).map(String.init)
        guard ids.count == 1, validSheetID(ids[0]),
              expectedSheetID.map({ $0 == ids[0] }) ?? true else { throw ConnectionError.invalidCallback }
        return AuthorizationResult(code: code, sheetID: ids[0])
    }

    private func beginGeneration() -> UUID {
        generation = UUID()
        refreshTask?.cancel()
        refreshTask = nil
        refreshTaskID = nil
        credential = nil
        selection = nil
        return generation
    }

    private func checkGeneration(_ expected: UUID) throws {
        try Task.checkCancellation()
        guard generation == expected else { throw ConnectionError.cancelled }
    }

    private func readSignOutState() throws -> GoogleSignOutState {
        do { return try signOutStore.read() } catch { throw ConnectionError.credentialStorage }
    }

    private func decodeCredential(_ data: Data, configuration: Configuration) throws -> Credential {
        guard data.count <= 32 * 1024, let stored = try? JSONDecoder().decode(Credential.self, from: data),
              stored.version == 1, stored.clientID == configuration.clientID,
              Self.validPermissionID(stored.permissionID), Self.validSheetID(stored.sheetID),
              stored.scope == Self.scope, !stored.access.isEmpty, stored.access.utf8.count <= 4096,
              stored.refresh.map({ !$0.isEmpty && $0.utf8.count <= 8192 }) ?? true,
              stored.expiresAt.timeIntervalSince1970.isFinite else { throw ConnectionError.reconnect }
        return stored
    }

    private func persist(_ next: Credential, newAuthorization: Bool = false) throws {
        if !newAuthorization {
            let state = try readSignOutState()
            guard !state.signedOut, !state.needsCleanup else { throw ConnectionError.reconnect }
        }
        do {
            try tokenStore.write(JSONEncoder().encode(next))
            if newAuthorization { try signOutStore.write(GoogleSignOutState()) }
        } catch { throw ConnectionError.credentialStorage }
        credential = next
        if newAuthorization { needsCredentialCleanup = false }
    }

    private func clearRejectedCredential(_ error: Error) {
        guard let failure = error as? ConnectionError, failure == .reconnect || failure == .identityChanged || failure == .missingPermission else { return }
        credential = nil
        selection = nil
        needsCredentialCleanup = true
        try? signOutStore.write(GoogleSignOutState(signedOut: true, needsCleanup: true))
    }

    private func refreshed(_ stored: Credential) async throws -> Credential {
        guard let refresh = stored.refresh else { throw ConnectionError.reconnect }
        let response = try await requestTokens([
            "client_id": stored.clientID, "refresh_token": refresh, "grant_type": "refresh_token",
        ])
        try validateToken(response, fallbackScope: stored.scope)
        return Credential(version: 1, clientID: stored.clientID, permissionID: stored.permissionID,
            sheetID: stored.sheetID, access: response.access_token, refresh: response.refresh_token ?? refresh,
            expiresAt: now().addingTimeInterval(response.expires_in), scope: Self.scope)
    }

    private func requestTokens(_ fields: [String: String]) async throws -> TokenResponse {
        let response = try await transport.send(Self.formRequest(path: "token", fields: fields), maximumBytes: 32 * 1024)
        guard response.statusCode == 200 else {
            let payload = (try? JSONSerialization.jsonObject(with: response.data)) as? [String: Any]
            if payload?["error"] as? String == "invalid_grant" { throw ConnectionError.reconnect }
            if ["invalid_client", "unauthorized_client"].contains(payload?["error"] as? String ?? "") { throw ConnectionError.configurationRejected }
            throw ConnectionError.serviceUnavailable
        }
        guard let result = try? JSONDecoder().decode(TokenResponse.self, from: response.data) else { throw ConnectionError.invalidResponse }
        return result
    }

    private func validateToken(_ token: TokenResponse, fallbackScope: String?) throws {
        guard token.token_type.lowercased() == "bearer", (token.scope ?? fallbackScope) == Self.scope else { throw ConnectionError.missingPermission }
        guard !token.access_token.isEmpty, token.access_token.utf8.count <= 4096,
              token.refresh_token.map({ !$0.isEmpty && $0.utf8.count <= 8192 }) ?? true,
              token.expires_in.isFinite, token.expires_in > 0, token.expires_in <= 7 * 86400 else { throw ConnectionError.invalidResponse }
    }

    private static func validPermissionID(_ id: String) -> Bool {
        !id.isEmpty && id.utf8.count <= 200 && id.rangeOfCharacter(from: .whitespacesAndNewlines) == nil
            && !id.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains)
    }

    private func readPermissionID(accessToken: String) async throws -> String {
        var parts = URLComponents(string: "https://www.googleapis.com/drive/v3/about")!
        parts.queryItems = [URLQueryItem(name: "fields", value: "user(permissionId)")]
        var request = URLRequest(url: parts.url!)
        request.setValue("Bearer " + accessToken, forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let response = try await transport.send(request, maximumBytes: 16 * 1024)
        if response.statusCode == 401 { throw ConnectionError.reconnect }
        if response.statusCode == 403 { throw ConnectionError.missingPermission }
        guard response.statusCode == 200 else { throw ConnectionError.serviceUnavailable }
        struct About: Decodable { struct User: Decodable { let permissionId: String }; let user: User }
        guard let about = try? JSONDecoder().decode(About.self, from: response.data), Self.validPermissionID(about.user.permissionId) else { throw ConnectionError.invalidResponse }
        return about.user.permissionId
    }

    private static func formRequest(path: String, fields: [String: String]) -> URLRequest {
        precondition(path == "token" || path == "revoke")
        let allowed = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
        let form = fields.sorted(by: { $0.key < $1.key }).map {
            $0.key.addingPercentEncoding(withAllowedCharacters: allowed)! + "=" + $0.value.addingPercentEncoding(withAllowedCharacters: allowed)!
        }.joined(separator: "&")
        var request = URLRequest(url: URL(string: "https://oauth2.googleapis.com/" + path)!)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = Data(form.utf8)
        request.timeoutInterval = path == "revoke" ? 15 : 30
        return request
    }

    private static func randomURLSafe(bytes count: Int) throws -> String {
        var bytes = [UInt8](repeating: 0, count: count)
        guard SecRandomCopyBytes(kSecRandomDefault, count, &bytes) == errSecSuccess else { throw ConnectionError.randomGeneration }
        return base64URL(Data(bytes))
    }
    private static func base64URL(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        anchor ?? ASPresentationAnchor()
    }

    private func authenticate(url: URL, callbackScheme: String) async throws -> URL {
        guard let window = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene })
            .filter({ $0.activationState == .foregroundActive }).flatMap(\.windows).first(where: \.isKeyWindow) else { throw ConnectionError.noWindow }
        anchor = window
        let id = UUID()
        return try await withTaskCancellationHandler(operation: {
            try Task.checkCancellation()
            return try await withCheckedThrowingContinuation { continuation in
                authID = id
                authCompletion = { continuation.resume(with: $0) }
                let session = ASWebAuthenticationSession(url: url, callbackURLScheme: callbackScheme) { [weak self] callback, error in
                    Task { @MainActor in
                        guard let self else { return }
                        if let callback { self.finishAuthentication(id: id, result: .success(callback)) }
                        else if (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin {
                            self.finishAuthentication(id: id, result: .failure(ConnectionError.cancelled))
                        } else { self.finishAuthentication(id: id, result: .failure(ConnectionError.serviceUnavailable)) }
                    }
                }
                session.presentationContextProvider = self
                session.prefersEphemeralWebBrowserSession = false
                authSession = session
                if !session.start() { finishAuthentication(id: id, result: .failure(ConnectionError.serviceUnavailable)) }
            }
        }, onCancel: { Task { @MainActor [weak self] in self?.cancelAuthentication(id: id) } })
    }

    private func finishAuthentication(id: UUID, result: Result<URL, Error>) {
        guard authID == id, let completion = authCompletion else { return }
        authCompletion = nil
        authID = nil
        authSession = nil
        anchor = nil
        completion(result)
    }

    private func cancelAuthentication(id: UUID? = nil) {
        guard let current = authID, id == nil || current == id else { return }
        authSession?.cancel()
        finishAuthentication(id: current, result: .failure(ConnectionError.cancelled))
    }
}
