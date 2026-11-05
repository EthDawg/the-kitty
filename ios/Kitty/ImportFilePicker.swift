import Foundation
import UIKit
import UniformTypeIdentifiers

/// Originals stay in the device's protected Application Support directory until a confirmed import can archive them.
struct ImportOriginals {
    let root: URL
    init(root: URL = FileManager.default.urls(for:.applicationSupportDirectory, in:.userDomainMask)[0].appendingPathComponent("KittyOriginals")) { self.root = root }
    private func folder(_ scope: String) throws -> URL {
        guard scope == "native-demo" || scope.range(of:"^native-[a-f0-9]{64}$", options:.regularExpression) != nil else {
            throw SourceIntakeError.message("The household changed. Select the file again.")
        }
        return root.appendingPathComponent(scope, isDirectory:true)
    }
    func retain(_ doc: SourceDocument, scope: String) throws {
        guard doc.isIntact else { throw SourceIntakeError.message("The source could not be verified.") }
        var dir = try folder(scope)
        try FileManager.default.createDirectory(at:dir, withIntermediateDirectories:true, attributes:[.protectionKey: FileProtectionType.complete])
        var attrs = URLResourceValues(); attrs.isExcludedFromBackup = true; try dir.setResourceValues(attrs)
        let path = dir.appendingPathComponent(doc.id)
        if FileManager.default.fileExists(atPath:path.path) {
            guard try load(id:doc.id, scope:scope) == doc.bytes else { throw SourceIntakeError.message("The retained file could not be verified.") }
        } else {
            try doc.bytes.write(to:path, options:[.atomic, .completeFileProtection])
            _ = try load(id:doc.id, scope:scope)
        }
    }
    func load(id: String, scope: String) throws -> Data {
        guard id.range(of:"^[0-9a-f]{64}$",options:.regularExpression) != nil else { throw SourceIntakeError.message("Unknown source.") }
        let bytes = try Data(contentsOf:folder(scope).appendingPathComponent(id))
        guard SourceDocument.sha256(bytes) == id else { throw SourceIntakeError.message("The retained source is damaged. Select it again from Files.") }
        return bytes
    }
}

@MainActor
final class ImportFilePicker: NSObject, UIDocumentPickerDelegate, UIAdaptivePresentationControllerDelegate {
    private var reply: (([String:Any]) -> Void)?
    private var check: (() -> Bool)?
    private var scope = ""
    private var generation = UUID()
    private let originals = ImportOriginals()

    func open(on host: UIViewController, scope: String, check: @escaping () -> Bool, reply: @escaping ([String:Any]) -> Void) {
        guard self.reply == nil, host.presentedViewController == nil, check() else {
            reply(HostPolicy.failure("busy","Close the current sheet and try Files again.")); return
        }
        self.reply = reply; self.scope = scope; self.check = check; self.generation = UUID()
        let picker = UIDocumentPickerViewController(forOpeningContentTypes:[.commaSeparatedText, .pdf], asCopy:false)
        picker.allowsMultipleSelection = false; picker.delegate = self
        host.present(picker,animated:true); picker.presentationController?.delegate = self
    }
    func cancel() { finish(HostPolicy.failure("cancelled","No file was added.")) }
    private func finish(_ payload: [String:Any]) { let cb = reply; reply = nil; check = nil; generation = UUID(); cb?(payload) }
    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { cancel() }
    func presentationControllerDidDismiss(_ presentationController: UIPresentationController) { cancel() }
    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard urls.count == 1, let url = urls.first, check?() == true else { cancel(); return }
        let bound = generation, owner = scope
        Task { @MainActor in
            do {
                let captured = try await SourceDocumentCapture.capture(url:url)
                guard bound == generation else { return }
                guard check?() == true else { cancel(); return }
                try originals.retain(captured,scope:owner)
                let source = await SourceDocumentCapture.extract(captured)
                guard bound == generation else { return }
                guard check?() == true else { cancel(); return }
                var preview: [String:Any] = ["id":source.id, "name":source.name, "mimeType":source.mimeType,
                    "byteLength":source.byteLength, "pageCount":source.pageCount,
                    "state":source.state.rawValue,"messages":source.messages]
                if source.mimeType == "text/csv" {
                    guard let csv = String(data:source.bytes,encoding:.utf8) else { throw SourceIntakeError.message("Choose a UTF-8 CSV export.") }
                    preview["text"] = csv
                } else {
                    preview["pdf_text"] = source.pages.map(\.text).joined(separator:"\n")
                    preview["ocr"] = source.pages.contains { $0.method == .visionOCR }
                }
                finish(HostPolicy.reply(preview))
            } catch {
                guard bound == generation else { return }
                finish(HostPolicy.failure("source_unavailable",(error as? SourceIntakeError)?.errorDescription ?? "Could not read this file. Download it in Files and try again."))
            }
        }
    }
}
