import Foundation

struct GoogleHTTPResponse {
    let statusCode: Int
    let data: Data
}

protocol GoogleHTTPTransport {
    func send(_ request: URLRequest, maximumBytes: Int) async throws -> GoogleHTTPResponse
}

/// Native-only transport. Redirects, cookies, caching and unbounded response buffering are disabled.
final class GoogleHTTP: GoogleHTTPTransport {
    enum Failure: Error { case invalidRequest, redirected, responseTooLarge, invalidResponse }
    private let configuration: URLSessionConfiguration

    init(configuration: URLSessionConfiguration = .ephemeral) {
        let config = configuration.copy() as! URLSessionConfiguration
        config.urlCache = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.httpCookieStorage = nil
        config.httpShouldSetCookies = false
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 45
        self.configuration = config
    }

    static func accepts(_ request: URLRequest) -> Bool {
        guard let url = request.url, let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              parts.scheme == "https", parts.user == nil, parts.password == nil,
              parts.port == nil, parts.fragment == nil,
              ["oauth2.googleapis.com", "www.googleapis.com", "sheets.googleapis.com"].contains(parts.host ?? ""),
              ["GET", "POST", "PUT"].contains(request.httpMethod ?? "GET"),
              request.httpBodyStream == nil, (request.httpBody?.count ?? 0) <= 16 * 1024 * 1024 else { return false }
        return true
    }

    func send(_ request: URLRequest, maximumBytes: Int) async throws -> GoogleHTTPResponse {
        guard Self.accepts(request), maximumBytes > 0, maximumBytes <= 16 * 1024 * 1024 else {
            throw Failure.invalidRequest
        }
        let operation = Operation(request: request, maximumBytes: maximumBytes, configuration: configuration)
        return try await withTaskCancellationHandler(operation: {
            try await operation.run()
        }, onCancel: { operation.cancel() })
    }

    private final class Operation: NSObject, URLSessionDataDelegate, @unchecked Sendable {
        private let lock = NSLock()
        private let request: URLRequest
        private let maximumBytes: Int
        private let configuration: URLSessionConfiguration
        private var continuation: CheckedContinuation<GoogleHTTPResponse, Error>?
        private var session: URLSession?
        private var task: URLSessionDataTask?
        private var finished = false
        private var cancelled = false
        private var response: HTTPURLResponse?
        private var bytes = Data()

        init(request: URLRequest, maximumBytes: Int, configuration: URLSessionConfiguration) {
            self.request = request
            self.maximumBytes = maximumBytes
            self.configuration = configuration
        }

        func run() async throws -> GoogleHTTPResponse {
            try await withCheckedThrowingContinuation { continuation in
                lock.lock()
                guard !cancelled else {
                    lock.unlock()
                    continuation.resume(throwing: CancellationError())
                    return
                }
                self.continuation = continuation
                let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
                let task = session.dataTask(with: request)
                self.session = session
                self.task = task
                lock.unlock()
                task.resume()
            }
        }

        func cancel() {
            lock.lock()
            cancelled = true
            lock.unlock()
            finish(.failure(CancellationError()))
        }

        private func finish(_ result: Result<GoogleHTTPResponse, Error>) {
            lock.lock()
            guard !finished, let continuation else { lock.unlock(); return }
            finished = true
            self.continuation = nil
            let session = self.session
            self.session = nil
            task = nil
            lock.unlock()
            session?.invalidateAndCancel()
            continuation.resume(with: result)
        }

        func urlSession(_ session: URLSession, task: URLSessionTask,
                        willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                        completionHandler: @escaping (URLRequest?) -> Void) {
            completionHandler(nil)
            finish(.failure(Failure.redirected))
        }

        func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                        completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
            guard let http = response as? HTTPURLResponse, http.url == request.url else {
                completionHandler(.cancel)
                finish(.failure(Failure.invalidResponse))
                return
            }
            guard !(300..<400).contains(http.statusCode) else {
                completionHandler(.cancel)
                finish(.failure(Failure.redirected))
                return
            }
            guard response.expectedContentLength < 0 || response.expectedContentLength <= Int64(maximumBytes) else {
                completionHandler(.cancel)
                finish(.failure(Failure.responseTooLarge))
                return
            }
            lock.lock()
            self.response = http
            let active = !finished && !cancelled
            lock.unlock()
            completionHandler(active ? .allow : .cancel)
        }

        func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
            lock.lock()
            guard !finished else { lock.unlock(); return }
            guard data.count <= maximumBytes - bytes.count else {
                lock.unlock()
                finish(.failure(Failure.responseTooLarge))
                return
            }
            bytes.append(data)
            lock.unlock()
        }

        func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
            if let error { finish(.failure(error)); return }
            lock.lock()
            let response = self.response
            let bytes = self.bytes
            lock.unlock()
            guard let response else { finish(.failure(Failure.invalidResponse)); return }
            finish(.success(GoogleHTTPResponse(statusCode: response.statusCode, data: bytes)))
        }
    }
}
