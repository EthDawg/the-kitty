import AuthenticationServices
import Combine
import CryptoKit
import Foundation
import Security
import UIKit

/// Google tokens never enter a Sheet, UserDefaults, source files, analytics or the AI context.
/// This connection grants access to explicitly authorised Drive files, not all of Drive.
@MainActor
final class GoogleConnection: NSObject, ObservableObject,
  ASWebAuthenticationPresentationContextProviding
{
  @Published private(set) var isConnected = false
  @Published private(set) var isAuthorizing = false
  @Published private(set) var pickedSheetIDs: [String] = []
  @Published private(set) var needsCredentialCleanup = false
  let isConfigured: Bool

  struct Configuration {
    let clientID: String
    let callbackScheme: String
    var redirectURI: String { callbackScheme + ":/oauthredirect" }

    static func from(_ bundle: Bundle) -> Configuration? {
      guard let clientID = bundle.object(forInfoDictionaryKey: "GoogleClientID") as? String,
        clientID.hasSuffix(".apps.googleusercontent.com"),
        !clientID.contains("$("), !clientID.contains("YOUR_")
      else { return nil }
      let scheme = clientID.split(separator: ".").reversed().joined(separator: ".")
      let registrations =
        bundle.object(forInfoDictionaryKey: "CFBundleURLTypes") as? [[String: Any]] ?? []
      let registeredSchemes = registrations.flatMap { $0["CFBundleURLSchemes"] as? [String] ?? [] }
      guard registeredSchemes.contains(scheme) else { return nil }
      return Configuration(clientID: clientID, callbackScheme: scheme)
    }
  }

  /// Internal injection for testing cleanup failures without touching real Keychain credentials.
  struct CredentialStore {
    let read: () throws -> Data?
    let write: (Data) throws -> Void
    let delete: () throws -> Void
  }

  enum ConnectionError: LocalizedError {
    case notConfigured, reconnect, alreadyAuthorizing, cancelled, invalidCallback, missingPermission
    case noWindow, randomGeneration
    case keychain(OSStatus)
    case serviceUnavailable, revocationUnconfirmed
    case disconnectIncomplete(localRemovalConfirmed: Bool, remoteRevocationConfirmed: Bool, signOutPersisted: Bool)

    var errorDescription: String? {
      switch self {
      case .notConfigured:
        return
          "Google connection is not available in this build. The app needs its registered Google iOS client before it can connect to your Sheet."
      case .reconnect:
        return "Your Google connection has expired or was removed. Reconnect to continue."
      case .alreadyAuthorizing:
        return "Google sign-in is already open. Finish or cancel that sign-in first."
      case .cancelled: return "Google sign-in was cancelled. Your Sheet has not changed."
      case .invalidCallback:
        return "Google sign-in could not be verified. Please start sign-in again."
      case .missingPermission:
        return
          "The Kitty needs permission to use the Google files you select. Reconnect and allow that permission."
      case .noWindow: return "Open The Kitty on screen before connecting Google."
      case .randomGeneration: return "A secure sign-in could not be started. Please try again."
      case .keychain:
        return
          "Your Google connection could not be stored securely. Unlock this device and try again."
      case .serviceUnavailable:
        return "Google sign-in is temporarily unavailable. Please try again."
      case .revocationUnconfirmed:
        return
          "This device is disconnected. Google could not confirm removal of access; you can remove The Kitty in your Google Account connections."
      case .disconnectIncomplete(let localRemoved, let remoteRevoked, let persisted):
        var parts = [localRemoved || persisted
          ? "This device is disconnected."
          : "Access is stopped for this session, but the device could not persist sign-out."]
        if !localRemoved {
          parts.append("Saved Google credentials could not be removed. Unlock this device and disconnect again.")
          if persisted { parts.append("The saved credentials are blocked from reuse.") }
        }
        parts.append(remoteRevoked
          ? "Google confirmed removal of access."
          : "Google could not confirm removal of access; you can remove The Kitty in your Google Account connections.")
        return parts.joined(separator: " ")
      }
    }
  }

  private struct Tokens: Codable {
    let access: String
    let refresh: String?
    let expiresAt: Date
    let scope: String
  }

  private struct TokenResponse: Decodable {
    let access_token: String
    let refresh_token: String?
    let expires_in: TimeInterval
    let scope: String?
    let token_type: String
  }

  private static let scope = "https://www.googleapis.com/auth/drive.file"
  private let configuration: Configuration?
  private let session: URLSession
  private let keychainService: String
  private let defaults: UserDefaults
  private let credentialStore: CredentialStore?
  private var signOutKey: String { keychainService + ".signed-out" }
  private var cleanupKey: String { keychainService + ".needs-credential-cleanup" }
  private var tokens: Tokens?
  private var authSession: ASWebAuthenticationSession?
  private var anchor: UIWindow?
  private var refreshTask: Task<String, Error>?
  private var generation = UUID()

  init(bundle: Bundle = .main, session: URLSession? = nil, defaults: UserDefaults = .standard,
       credentialStore: CredentialStore? = nil) {
    self.configuration = Configuration.from(bundle)
    self.isConfigured = self.configuration != nil
    self.keychainService = (bundle.bundleIdentifier ?? "app.thekitty.ios") + ".google-oauth"
    self.defaults = defaults
    self.credentialStore = credentialStore
    if let session {
      self.session = session
    } else {
      let config = URLSessionConfiguration.ephemeral
      config.urlCache = nil
      config.requestCachePolicy = .reloadIgnoringLocalCacheData
      config.timeoutIntervalForRequest = 30
      self.session = URLSession(configuration: config)
    }
    super.init()
    needsCredentialCleanup = defaults.bool(forKey: cleanupKey)
    if configuration != nil, !defaults.bool(forKey: signOutKey), !needsCredentialCleanup,
      let data = try? readKeychain(),
      let stored = try? JSONDecoder().decode(Tokens.self, from: data)
    {
      tokens = stored
      isConnected = stored.refresh != nil || stored.expiresAt > Date()
    }
  }

  func authorize(fileIDs: [String] = []) async throws {
    guard let configuration else { throw ConnectionError.notConfigured }
    guard !isAuthorizing else { throw ConnectionError.alreadyAuthorizing }
    guard
      let window = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene })
        .filter({ $0.activationState == .foregroundActive }).flatMap(\.windows).first(
          where: \.isKeyWindow)
    else { throw ConnectionError.noWindow }

    isAuthorizing = true
    anchor = window
    generation = UUID()
    refreshTask?.cancel()
    refreshTask = nil
    let currentGeneration = generation
    defer {
      isAuthorizing = false
      authSession = nil
      anchor = nil
    }
    let verifier = try Self.randomURLSafe(bytes: 32)
    let state = try Self.randomURLSafe(bytes: 32)
    let challenge = Data(SHA256.hash(data: Data(verifier.utf8))).base64URL
    var components = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
    components.queryItems = [
      URLQueryItem(name: "client_id", value: configuration.clientID),
      URLQueryItem(name: "redirect_uri", value: configuration.redirectURI),
      URLQueryItem(name: "response_type", value: "code"),
      URLQueryItem(name: "scope", value: Self.scope),
      URLQueryItem(name: "code_challenge", value: challenge),
      URLQueryItem(name: "code_challenge_method", value: "S256"),
      URLQueryItem(name: "state", value: state),
      URLQueryItem(name: "access_type", value: "offline"),
      URLQueryItem(name: "prompt", value: "consent select_account"),
      URLQueryItem(name: "trigger_onepick", value: "true"),
      URLQueryItem(name: "mimetypes", value: "application/vnd.google-apps.spreadsheet"),
      URLQueryItem(name: "allow_multiple", value: "false"),
    ]

    if !fileIDs.isEmpty {
      components.queryItems?.append(
        URLQueryItem(name: "file_ids", value: fileIDs.joined(separator: ",")))
    }

    let callback: URL = try await withTaskCancellationHandler(
      operation: {
        try await withCheckedThrowingContinuation {
          (continuation: CheckedContinuation<URL, Error>) in
          let authentication = ASWebAuthenticationSession(
            url: components.url!, callbackURLScheme: configuration.callbackScheme
          ) { url, error in
            if let url {
              continuation.resume(returning: url)
            } else if let error = error as? ASWebAuthenticationSessionError,
              error.code == .canceledLogin
            {
              continuation.resume(throwing: ConnectionError.cancelled)
            } else {
              continuation.resume(throwing: ConnectionError.serviceUnavailable)
            }
          }
          authentication.presentationContextProvider = self
          authentication.prefersEphemeralWebBrowserSession = false
          authSession = authentication
          if !authentication.start() {
            continuation.resume(throwing: ConnectionError.serviceUnavailable)
          }
        }
      }, onCancel: { Task { @MainActor [weak self] in self?.authSession?.cancel() } })

    try Task.checkCancellation()
    guard generation == currentGeneration,
      callback.scheme == configuration.callbackScheme, callback.path == "/oauthredirect",
      let parsed = URLComponents(url: callback, resolvingAgainstBaseURL: false)
    else { throw ConnectionError.invalidCallback }
    let query = parsed.queryItems ?? []
    guard query.filter({ $0.name == "state" }).count == 1,
      query.first(where: { $0.name == "state" })?.value == state
    else { throw ConnectionError.invalidCallback }
    if query.contains(where: { $0.name == "error" }) { throw ConnectionError.missingPermission }
    guard query.filter({ $0.name == "code" }).count == 1,
      let code = query.first(where: { $0.name == "code" })?.value, !code.isEmpty
    else { throw ConnectionError.invalidCallback }
    let picks = try Self.selectedSheetIDs(from: query)
    let result = try await requestTokens([
      "client_id": configuration.clientID, "code": code,
      "code_verifier": verifier, "grant_type": "authorization_code",
      "redirect_uri": configuration.redirectURI,
    ])
    guard generation == currentGeneration else { throw CancellationError() }
    guard result.token_type.lowercased() == "bearer",
      result.scope?.split(separator: " ").contains(Substring(Self.scope)) == true
    else { throw ConnectionError.missingPermission }
    let next = Tokens(
      access: result.access_token, refresh: result.refresh_token,
      expiresAt: Date().addingTimeInterval(result.expires_in), scope: result.scope ?? Self.scope)
    try save(next, newlyAuthorized: true)
    pickedSheetIDs = picks
  }

  static func selectedSheetIDs(from query: [URLQueryItem]) throws -> [String] {
    guard query.filter({ $0.name == "picked_file_ids" }).count == 1,
      let raw = query.first(where: { $0.name == "picked_file_ids" })?.value
    else {
      throw ConnectionError.cancelled
    }
    let ids = raw.split(separator: ",").map(String.init)
    guard ids.count == 1,
      ids.allSatisfy({ $0.range(of: "^[A-Za-z0-9_-]{10,200}$", options: .regularExpression) != nil }
      )
    else {
      throw ConnectionError.invalidCallback
    }
    return ids
  }

  func accessToken() async throws -> String {
    guard let configuration else { throw ConnectionError.notConfigured }
    guard !defaults.bool(forKey: signOutKey), !defaults.bool(forKey: cleanupKey) else { throw ConnectionError.reconnect }
    guard let stored = tokens else { throw ConnectionError.reconnect }
    if stored.expiresAt.timeIntervalSinceNow > 90 { return stored.access }
    if let refreshTask { return try await refreshTask.value }
    guard let refresh = stored.refresh else {
      isConnected = false
      throw ConnectionError.reconnect
    }
    let currentGeneration = generation
    let task = Task<String, Error> { [weak self] in
      guard let self else { throw CancellationError() }
      let result = try await self.requestTokens([
        "client_id": configuration.clientID, "refresh_token": refresh,
        "grant_type": "refresh_token",
      ])
      try Task.checkCancellation()
      guard self.generation == currentGeneration else { throw CancellationError() }
      let granted = result.scope ?? stored.scope
      guard result.token_type.lowercased() == "bearer",
        granted.split(separator: " ").contains(Substring(Self.scope))
      else {
        throw ConnectionError.missingPermission
      }
      let next = Tokens(
        access: result.access_token, refresh: result.refresh_token ?? refresh,
        expiresAt: Date().addingTimeInterval(result.expires_in), scope: granted)
      try self.save(next)
      return next.access
    }
    refreshTask = task
    defer { refreshTask = nil }
    do { return try await task.value } catch ConnectionError.reconnect {
      isConnected = false
      throw ConnectionError.reconnect
    }
  }

  /// Always clears local access; failed remote revocation remains a visible, recoverable outcome.
  func disconnect() async throws {
    generation = UUID()
    authSession?.cancel()
    refreshTask?.cancel()
    refreshTask = nil
    var revoke = tokens?.refresh ?? tokens?.access
    // Persist the user's intent before attempting fallible credential cleanup. A subsequent launch
    // must not revive an old Keychain item merely because deletion was unavailable while locked.
    defaults.set(true, forKey: signOutKey)
    needsCredentialCleanup = true
    defaults.set(true, forKey: cleanupKey)
    var signOutPersisted = defaults.synchronize()
    tokens = nil
    isConnected = false
    pickedSheetIDs = []

    var remoteRevocationNeeded = revoke != nil
    var remoteRevocationConfirmed = false
    if revoke == nil, configuration != nil {
      // A cleanup retry may read a tombstoned item solely to revoke it, never to restore access.
      do {
        if let data = try readKeychain() {
          let stored = try JSONDecoder().decode(Tokens.self, from: data)
          revoke = stored.refresh ?? stored.access
          remoteRevocationNeeded = true
        }
      } catch { remoteRevocationNeeded = true }
    }
    var localRemovalConfirmed = true
    do { try deleteKeychain() } catch { localRemovalConfirmed = false }
    needsCredentialCleanup = !localRemovalConfirmed
    defaults.set(needsCredentialCleanup, forKey: cleanupKey)
    signOutPersisted = defaults.synchronize() || signOutPersisted
    if let revoke {
      var request = URLRequest(url: URL(string: "https://oauth2.googleapis.com/revoke")!)
      request.httpMethod = "POST"
      request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
      request.httpBody = Self.form(["token": revoke])
      request.timeoutInterval = 15
      do {
        let (_, response) = try await session.data(for: request)
        remoteRevocationConfirmed = (response as? HTTPURLResponse)?.statusCode == 200
      } catch { remoteRevocationConfirmed = false }
    }
    if !localRemovalConfirmed {
      throw ConnectionError.disconnectIncomplete(localRemovalConfirmed: false,
        remoteRevocationConfirmed: remoteRevocationConfirmed, signOutPersisted: signOutPersisted)
    }
    if remoteRevocationNeeded && !remoteRevocationConfirmed { throw ConnectionError.revocationUnconfirmed }
  }

  func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
    anchor ?? ASPresentationAnchor()
  }

  private func requestTokens(_ fields: [String: String]) async throws -> TokenResponse {
    var request = URLRequest(url: URL(string: "https://oauth2.googleapis.com/token")!)
    request.httpMethod = "POST"
    request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
    request.httpBody = Self.form(fields)
    let (data, response) = try await session.data(for: request)
    guard let http = response as? HTTPURLResponse else { throw ConnectionError.serviceUnavailable }
    guard http.statusCode == 200 else {
      if let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
        payload["error"] as? String == "invalid_grant"
      {
        throw ConnectionError.reconnect
      }
      throw ConnectionError.serviceUnavailable
    }
    let result = try JSONDecoder().decode(TokenResponse.self, from: data)
    guard !result.access_token.isEmpty, result.expires_in > 0 else {
      throw ConnectionError.serviceUnavailable
    }
    return result
  }

  private func save(_ next: Tokens, newlyAuthorized: Bool = false) throws {
    guard newlyAuthorized || (!defaults.bool(forKey: signOutKey) && !defaults.bool(forKey: cleanupKey)) else {
      throw ConnectionError.reconnect
    }
    let data = try JSONEncoder().encode(next)
    if let credentialStore { try credentialStore.write(data) }
    else {
      let query = keychainQuery
      let status = SecItemUpdate(
        query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
      if status == errSecItemNotFound {
        var attributes = query
        attributes[kSecValueData as String] = data
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        let add = SecItemAdd(attributes as CFDictionary, nil)
        guard add == errSecSuccess else { throw ConnectionError.keychain(add) }
      } else if status != errSecSuccess {
        throw ConnectionError.keychain(status)
      }
    }
    if newlyAuthorized {
      defaults.set(false, forKey: signOutKey)
      defaults.set(false, forKey: cleanupKey)
      _ = defaults.synchronize()
      needsCredentialCleanup = false
    }
    tokens = next
    isConnected = true
  }

  private var keychainQuery: [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: keychainService,
      kSecAttrAccount as String: configuration?.clientID ?? "unconfigured",
      kSecAttrSynchronizable as String: false,
    ]
  }

  private func readKeychain() throws -> Data? {
    if let credentialStore { return try credentialStore.read() }
    var query = keychainQuery
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess else { throw ConnectionError.keychain(status) }
    return result as? Data
  }

  private func deleteKeychain() throws {
    if let credentialStore { return try credentialStore.delete() }
    let status = SecItemDelete(keychainQuery as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else {
      throw ConnectionError.keychain(status)
    }
  }

  private static func randomURLSafe(bytes count: Int) throws -> String {
    var bytes = [UInt8](repeating: 0, count: count)
    guard SecRandomCopyBytes(kSecRandomDefault, count, &bytes) == errSecSuccess else {
      throw ConnectionError.randomGeneration
    }
    return Data(bytes).base64URL
  }

  private static func form(_ fields: [String: String]) -> Data {
    let allowed = CharacterSet(
      charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
    return fields.sorted(by: { $0.key < $1.key }).map {
      "\($0.key.addingPercentEncoding(withAllowedCharacters: allowed)!)=\($0.value.addingPercentEncoding(withAllowedCharacters: allowed)!)"
    }.joined(separator: "&").data(using: .utf8)!
  }
}

extension Data {
  fileprivate var base64URL: String {
    base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(
      of: "/", with: "_"
    ).replacingOccurrences(of: "=", with: "")
  }
}
