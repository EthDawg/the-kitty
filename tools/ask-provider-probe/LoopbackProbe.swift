import Darwin
import Foundation
import Security

/// Standalone transport experiment. All requests originate in this process and use 127.0.0.1.
/// The source contains no provider endpoints, real credentials, household records or app integration.
private struct ProbeFailure: Error, CustomStringConvertible {
    let description: String
    init(_ description: String) { self.description = description }
}

private func require(_ condition: Bool, _ message: String) throws {
    if !condition { throw ProbeFailure(message) }
}

private final class Socket {
    private(set) var fd: Int32
    init(_ fd: Int32) throws {
        guard fd >= 0 else { throw ProbeFailure("Opening the local socket failed (errno \(errno)).") }
        self.fd = fd
        var timeout = timeval(tv_sec: 2, tv_usec: 0)
        let size = socklen_t(MemoryLayout.size(ofValue: timeout))
        guard setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, size) == 0,
              setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &timeout, size) == 0 else {
            Darwin.close(fd)
            throw ProbeFailure("Setting local socket timeouts failed.")
        }
    }
    func close() { if fd >= 0 { Darwin.close(fd); fd = -1 } }
    deinit { close() }
}

private func withAddress<T>(_ address: inout sockaddr_in, _ body: (UnsafeMutablePointer<sockaddr>) -> T) -> T {
    withUnsafeMutablePointer(to: &address) { pointer in
        pointer.withMemoryRebound(to: sockaddr.self, capacity: 1, body)
    }
}

private func sendText(_ text: String, over socket: Socket) throws {
    let data = Array(text.utf8)
    try data.withUnsafeBytes { bytes in
        var sent = 0
        while sent < bytes.count {
            let n = Darwin.send(socket.fd, bytes.baseAddress!.advanced(by: sent), bytes.count - sent, 0)
            guard n > 0 else { throw ProbeFailure("Local write failed.") }
            sent += n
        }
    }
}

private func receiveHeader(over socket: Socket) throws -> String {
    var data = Data(), chunk = [UInt8](repeating: 0, count: 512)
    while data.count < 4096 {
        let n = recv(socket.fd, &chunk, chunk.count, 0)
        guard n > 0 else { throw ProbeFailure("Local request was incomplete.") }
        data.append(contentsOf: chunk.prefix(n))
        if data.range(of: Data("\r\n\r\n".utf8)) != nil {
            guard let text = String(data: data, encoding: .utf8) else { throw ProbeFailure("Invalid local request encoding.") }
            return text
        }
    }
    throw ProbeFailure("Local request exceeded the probe limit.")
}

private struct Attempt {
    let state: String
    let listener: Socket
    let address: sockaddr_in
    var port: UInt16 { UInt16(bigEndian: address.sin_port) }
    var host: String { "127.0.0.1:\(port)" }

    init() throws {
        var random = [UInt8](repeating: 0, count: 32)
        try require(SecRandomCopyBytes(kSecRandomDefault, random.count, &random) == errSecSuccess,
                    "Secure random state generation failed.")
        state = random.map { String(format: "%02x", $0) }.joined()
        listener = try Socket(socket(AF_INET, SOCK_STREAM, IPPROTO_TCP))
        var local = sockaddr_in()
        local.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        local.sin_family = sa_family_t(AF_INET)
        local.sin_port = 0 // The kernel chooses an available port before a browser would open.
        try require(inet_pton(AF_INET, "127.0.0.1", &local.sin_addr) == 1, "Invalid loopback address.")
        let size = socklen_t(MemoryLayout<sockaddr_in>.size)
        let fd = listener.fd
        try require(withAddress(&local) { bind(fd, $0, size) } == 0, "Loopback bind failed (errno \(errno)).")
        try require(listen(fd, 1) == 0, "Loopback listen failed.")
        var bound = sockaddr_in(), actualSize = size
        try require(withAddress(&bound) { getsockname(fd, $0, &actualSize) } == 0,
                    "Could not verify the bound address.")
        try require(bound.sin_port != 0 && bound.sin_addr.s_addr == local.sin_addr.s_addr,
                    "The listener must bind only to IPv4 loopback on an ephemeral port.")
        address = bound
    }

    private func accepts(_ request: String) -> Bool {
        let lines = request.components(separatedBy: "\r\n")
        let first = lines.first?.split(separator: " ") ?? []
        let hosts = lines.filter { $0.lowercased().hasPrefix("host:") }
        guard first.count == 3, first[0] == "GET", first[2] == "HTTP/1.1",
              hosts.count == 1, hosts[0].dropFirst(5).trimmingCharacters(in: .whitespaces) == host,
              let target = URLComponents(string: String(first[1])), target.host == nil, target.scheme == nil,
              target.fragment == nil, target.percentEncodedPath == "/auth/callback" else { return false }
        let fields = target.queryItems ?? []
        guard fields.count <= 8, Set(fields.map(\.name)).count == fields.count else { return false }
        let item = Dictionary(uniqueKeysWithValues: fields.map { ($0.name, $0.value ?? "") })
        return item["state"] == state && item["error"] == nil && item["code"] == "fictional-code"
            && item["client_id"] == "oaiapp_fictional_probe"
    }

    func exercise(target: String, hostHeader: String? = nil, expectSuccess: Bool) throws {
        let client = try Socket(socket(AF_INET, SOCK_STREAM, IPPROTO_TCP))
        var destination = address, peer = sockaddr_in()
        let size = socklen_t(MemoryLayout<sockaddr_in>.size)
        try require(withAddress(&destination) { connect(client.fd, $0, size) } == 0, "Fictional callback could not connect.")
        try sendText("GET \(target) HTTP/1.1\r\nHost: \(hostHeader ?? host)\r\nConnection: close\r\n\r\n", over: client)
        var peerSize = size
        let accepted = try Socket(withAddress(&peer) { accept(listener.fd, $0, &peerSize) })
        try require(peer.sin_addr.s_addr == address.sin_addr.s_addr, "Unexpected non-loopback peer.")
        let success = accepts(try receiveHeader(over: accepted))
        let status = success ? "200 OK" : "400 Bad Request"
        try sendText("HTTP/1.1 \(status)\r\nContent-Length: 0\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n", over: accepted)
        if success { listener.close() }
        let response = try receiveHeader(over: client)
        try require(success == expectSuccess && response.hasPrefix("HTTP/1.1 " + (expectSuccess ? "200" : "400")),
                    "Callback validation produced an unexpected outcome.")
    }
}

@main private enum LoopbackProbe {
    static func main() throws {
        let attempt = try Attempt()
        let path = "/auth/callback?state=\(attempt.state)&code=fictional-code&client_id=oaiapp_fictional_probe"
        try attempt.exercise(target: path.replacingOccurrences(of: attempt.state, with: "wrong"), expectSuccess: false)
        try attempt.exercise(target: path.replacingOccurrences(of: "/auth/callback", with: "/callback"), expectSuccess: false)
        try attempt.exercise(target: path + "&state=" + attempt.state, expectSuccess: false)
        try attempt.exercise(target: path, hostHeader: "localhost:\(attempt.port)", expectSuccess: false)
        try attempt.exercise(target: path.replacingOccurrences(of: "oaiapp_fictional_probe", with: "dynamic_agent_client"), expectSuccess: false)
        try attempt.exercise(target: path, expectSuccess: true)
        try require(attempt.listener.fd == -1, "The accepted callback must close its listener.")
        print("PASS: loopback-only ephemeral listener, five rejected callbacks, one accepted callback, listener closed.")
    }
}
