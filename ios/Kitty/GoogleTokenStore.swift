import Foundation
import Security

/// Closures are injectable so tests never read or mutate the device's real Keychain.
struct GoogleTokenStore {
    let read: () throws -> Data?
    let write: (Data) throws -> Void
    let delete: () throws -> Void

    enum Failure: Error { case keychain(OSStatus), persistence }

    static func keychain(clientID: String, service: String) -> GoogleTokenStore {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: clientID,
            kSecAttrSynchronizable as String: false,
        ]
        return GoogleTokenStore(read: {
            var request = query
            request[kSecReturnData as String] = true
            request[kSecMatchLimit as String] = kSecMatchLimitOne
            var value: CFTypeRef?
            let status = SecItemCopyMatching(request as CFDictionary, &value)
            if status == errSecItemNotFound { return nil }
            guard status == errSecSuccess, let data = value as? Data else { throw Failure.keychain(status) }
            return data
        }, write: { data in
            let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
            if status == errSecItemNotFound {
                var attributes = query
                attributes[kSecValueData as String] = data
                attributes[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
                let added = SecItemAdd(attributes as CFDictionary, nil)
                guard added == errSecSuccess else { throw Failure.keychain(added) }
            } else if status != errSecSuccess { throw Failure.keychain(status) }
        }, delete: {
            let status = SecItemDelete(query as CFDictionary)
            guard status == errSecSuccess || status == errSecItemNotFound else { throw Failure.keychain(status) }
        })
    }
}

struct GoogleSignOutState: Codable, Equatable {
    var signedOut = false
    var needsCleanup = false
}

/// This small tombstone contains no tokens, user identity, or financial data.
struct GoogleSignOutStore {
    let read: () throws -> GoogleSignOutState
    let write: (GoogleSignOutState) throws -> Void

    static func preferences(_ defaults: UserDefaults, key: String) -> GoogleSignOutStore {
        GoogleSignOutStore(read: {
            guard let object = defaults.object(forKey: key) else { return GoogleSignOutState() }
            guard let data = object as? Data,
                  let state = try? JSONDecoder().decode(GoogleSignOutState.self, from: data) else {
                throw GoogleTokenStore.Failure.persistence
            }
            return state
        }, write: { state in
            let data = try JSONEncoder().encode(state)
            defaults.set(data, forKey: key)
            guard defaults.synchronize(), defaults.data(forKey: key) == data else {
                throw GoogleTokenStore.Failure.persistence
            }
        })
    }
}
