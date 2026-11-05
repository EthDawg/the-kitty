import UIKit
import WebKit

/// The page owns the UI and calculations. This host only supplies device capabilities.
@MainActor
final class KittyViewController: UIViewController, WKNavigationDelegate, WKUIDelegate,
                                 UIDocumentPickerDelegate, UIAdaptivePresentationControllerDelegate {
    private(set) var webView: WKWebView!
    private let pageURL: URL?
    private let preferences: UserDefaults
    private let websiteDataStore: WKWebsiteDataStore
    private var pendingRoute: String?
    private var exportReply: ((Any?, String?) -> Void)?
    private var exportDirectory: URL?
    private weak var exportPicker: UIDocumentPickerViewController?
    private static var clearedAbandonedExports = false
    private var pageReady = false

    init(pageURL: URL? = Bundle.main.url(forResource: "kitty-native", withExtension: "html"),
         preferences: UserDefaults = .standard, websiteDataStore: WKWebsiteDataStore? = nil) {
        self.pageURL = pageURL
        self.preferences = preferences
        self.websiteDataStore = websiteDataStore ?? .default()
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("Use init(pageURL:preferences:)") }

    override func viewDidLoad() {
        super.viewDidLoad()
        // Once per process: another scene must not remove an active export.
        if !Self.clearedAbandonedExports {
            Self.clearedAbandonedExports = true
            let temporary = FileManager.default.temporaryDirectory
            for url in (try? FileManager.default.contentsOfDirectory(at: temporary, includingPropertiesForKeys: nil)) ?? []
                where url.lastPathComponent.hasPrefix("KittyExport-") {
                try? FileManager.default.removeItem(at: url)
            }
        }
        guard let pageURL else {
            showFailure("The Kitty page is missing. Please reinstall the app.")
            return
        }
        let configuration = WKWebViewConfiguration()
        configuration.limitsNavigationsToAppBoundDomains = true
        // Web storage is local preferences only; financial demo data is bundled in the page.
        configuration.websiteDataStore = websiteDataStore
        configuration.userContentController.addScriptMessageHandler(
            HostMessages(owner: self), contentWorld: .page, name: "kitty")
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.keyboardDismissMode = .interactive
        webView.scrollView.alwaysBounceVertical = true
        webView.accessibilityIdentifier = "kitty-shared-page"
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
        NotificationCenter.default.addObserver(self, selector: #selector(environmentChanged),
                                               name: UIContentSizeCategory.didChangeNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(environmentChanged),
                                               name: UIAccessibility.reduceMotionStatusDidChangeNotification, object: nil)
        // CSP in the bundle blocks network assets/fetches. A WebKit rule is defense in depth.
        let rules = "[{\"trigger\":{\"url-filter\":\"^https?://\"},\"action\":{\"type\":\"block\"}}]"
        WKContentRuleListStore.default().compileContentRuleList(forIdentifier: "KittyOffline", encodedContentRuleList: rules) { [weak self] list, error in
            guard let self else { return }
            guard let list, error == nil else {
                self.showFailure("The Kitty couldn't prepare its offline page. Close and reopen the app.")
                return
            }
            self.webView.configuration.userContentController.add(list)
            // All resources are inline: no access to sibling files or document directories.
            self.webView.loadFileURL(pageURL, allowingReadAccessTo: pageURL)
        }
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        if isBeingDismissed { finishExport(HostPolicy.failure("cancelled", "Export was cancelled.")) }
    }

    deinit { NotificationCenter.default.removeObserver(self) }

    private func showFailure(_ message: String) {
        let label = UILabel()
        label.text = message
        label.numberOfLines = 0
        label.font = .preferredFont(forTextStyle: .body)
        label.adjustsFontForContentSizeCategory = true
        label.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(label)
        NSLayoutConstraint.activate([
            label.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 24),
            label.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -24),
            label.centerYAnchor.constraint(equalTo: view.centerYAnchor),
        ])
    }

    func openDeepLink(_ url: URL) {
        guard let route = HostPolicy.route(url) else { return }
        pendingRoute = route
        deliverRoute()
    }

    private func deliverRoute() {
        guard pageReady, let route = pendingRoute else { return }
        pendingRoute = nil
        webView.callAsyncJavaScript("window.KittyNative.openRoute(route)", arguments: ["route": route],
                                    in: nil, in: .page, completionHandler: nil)
    }

    @objc private func environmentChanged() {
        guard pageReady else { return }
        let scale = UIFontMetrics(forTextStyle: .body).scaledValue(for: 17, compatibleWith: traitCollection) / 17
        webView.callAsyncJavaScript("window.KittyNative.receiveEnvironment(environment)",
                                    arguments: ["environment": ["textScale": Double(scale),
                                                                 "reduceMotion": UIAccessibility.isReduceMotionEnabled]],
                                    in: nil, in: .page, completionHandler: nil)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        pageReady = true
        environmentChanged()
        deliverRoute()
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        pageReady = false
        let recover = { [weak self] in
            guard let self else { return }
            self.finishExport(HostPolicy.failure("cancelled", "The page restarted. Please export again."))
            if let pageURL = self.pageURL { webView.loadFileURL(pageURL, allowingReadAccessTo: pageURL) }
        }
        if let picker = exportPicker, picker.presentingViewController != nil {
            picker.dismiss(animated: false, completion: recover)
        } else { recover() }
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let pageURL, HostPolicy.trusted(action.request.url, bundleURL: pageURL,
                                           mainFrame: action.targetFrame?.isMainFrame == true) {
            decisionHandler(.allow)
            return
        }
        decisionHandler(.cancel)
        // Only an explicit link tap opens a browser. Scripts/iframes cannot leave the bundle.
        if action.navigationType == .linkActivated, let url = action.request.url,
           ["https", "http", "mailto"].contains(url.scheme?.lowercased() ?? "") {
            UIApplication.shared.open(url)
        }
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? { nil }

    fileprivate func handle(_ message: WKScriptMessage, reply: @escaping (Any?, String?) -> Void) {
        guard let pageURL, HostPolicy.trusted(message.frameInfo.request.url, bundleURL: pageURL,
                                               mainFrame: message.frameInfo.isMainFrame),
              let request = message.body as? [String: Any], let method = request["method"] as? String,
              let params = request["params"] as? [String: Any] else {
            reply(HostPolicy.failure("not_granted", "This page cannot use native capabilities."), nil)
            return
        }
        switch method {
        case "preferences.get", "preferences.set":
            guard params["path"] as? String == HostPolicy.preferencePath else {
                reply(HostPolicy.failure("not_granted", "Only this demo's preferences are available."), nil)
                return
            }
            let key = "kitty.native.demo.preferences"
            if method == "preferences.get" {
                let data = preferences.data(forKey: key)
                let object = data.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]
                reply(HostPolicy.reply(object as Any? ?? NSNull()), nil)
            } else {
                guard let object = params["value"] as? [String: Any], JSONSerialization.isValidJSONObject(object),
                      let data = try? JSONSerialization.data(withJSONObject: object), data.count <= 1024 * 1024 else {
                    reply(HostPolicy.failure("invalid_request", "Preferences are invalid or too large."), nil)
                    return
                }
                preferences.set(data, forKey: key)
                reply(HostPolicy.reply(), nil)
            }
        case "downloads.save": export(params, reply: reply)
        default: reply(HostPolicy.failure("not_available", "This capability is not available in the demo."), nil)
        }
    }

    private func export(_ params: [String: Any], reply: @escaping (Any?, String?) -> Void) {
        guard exportReply == nil, presentedViewController == nil else {
            reply(HostPolicy.failure("busy", "Finish the open file picker first."), nil)
            return
        }
        guard let rawName = params["filename"] as? String, let name = HostPolicy.exportName(rawName),
              let encoded = params["base64"] as? String, encoded.utf8.count <= (HostPolicy.maximumExportBytes + 2) / 3 * 4,
              let data = Data(base64Encoded: encoded), data.count <= HostPolicy.maximumExportBytes else {
            reply(HostPolicy.failure("invalid_request", "The export name or file is invalid; the limit is 10 MB."), nil)
            return
        }
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("KittyExport-" + UUID().uuidString)
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let file = directory.appendingPathComponent(name)
            try data.write(to: file, options: [.atomic, .completeFileProtection])
            exportDirectory = directory
            exportReply = reply
            let picker = UIDocumentPickerViewController(forExporting: [file], asCopy: true)
            exportPicker = picker
            picker.delegate = self
            picker.presentationController?.delegate = self
            present(picker, animated: true) { [weak self, weak picker] in
                picker?.presentationController?.delegate = self
            }
        } catch {
            try? FileManager.default.removeItem(at: directory)
            reply(HostPolicy.failure("export_failed", "The file could not be prepared for export."), nil)
        }
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        finishExport(urls.isEmpty ? HostPolicy.failure("cancelled", "No file was saved.")
                                 : HostPolicy.reply(["status": "saved"]))
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        finishExport(HostPolicy.failure("cancelled", "Export was cancelled."))
    }

    func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
        finishExport(HostPolicy.failure("cancelled", "Export was cancelled."))
    }

    private func finishExport(_ result: [String: Any]) {
        let callback = exportReply
        exportReply = nil
        exportPicker = nil
        if let directory = exportDirectory { try? FileManager.default.removeItem(at: directory) }
        exportDirectory = nil
        callback?(result, nil)
    }
}

/// WKUserContentController retains its handler. This proxy avoids retaining the view controller.
@MainActor
private final class HostMessages: NSObject, WKScriptMessageHandlerWithReply {
    weak var owner: KittyViewController?
    init(owner: KittyViewController) { self.owner = owner }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard let owner else {
            replyHandler(HostPolicy.failure("not_available", "The page was closed."), nil)
            return
        }
        owner.handle(message, reply: replyHandler)
    }
}
