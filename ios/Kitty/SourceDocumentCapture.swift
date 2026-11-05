import Foundation
import PDFKit
import UIKit
import Vision

enum SourceDocumentCapture {
  static let maximumBytes = 5 * 1024 * 1024
  static let maximumPages = 20
  static let maximumOCRPages = 8
  static let maximumTextCharacters = 200_000

  /// Persist this captured result before starting extraction, so a relaunch cannot
  /// lose a document while OCR is running. Only unreadable/oversized intake throws.
  static func capture(url: URL) async throws -> SourceDocument {
    try await Task.detached(priority: .userInitiated) {
      let access = url.startAccessingSecurityScopedResource()
      defer { if access { url.stopAccessingSecurityScopedResource() } }
      let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
      guard size <= maximumBytes else { throw SourceIntakeError.message("Choose a source smaller than 5 MB. Export a shorter period if needed.") }
      let bytes = try Data(contentsOf: url)
      guard !bytes.isEmpty, bytes.count <= maximumBytes else { throw SourceIntakeError.message("Choose a non-empty source smaller than 5 MB.") }
      let type = url.pathExtension.lowercased()
      if type == "pdf" {
        guard bytes.prefix(1024).range(of: Data("%PDF-".utf8)) != nil else { throw SourceIntakeError.message("This file does not contain a PDF document.") }
        return SourceDocument(name: url.lastPathComponent, mimeType: "application/pdf", bytes: bytes)
      }
      if type == "csv", String(data: bytes, encoding: .utf8) != nil {
        return SourceDocument(name: url.lastPathComponent, mimeType: "text/csv", bytes: bytes)
      }
      throw SourceIntakeError.message("Choose an original PDF or UTF-8 CSV. This source type is not supported yet.")
    }.value
  }

  /// All extraction failures return the original bytes and an actionable state.
  /// PDF text and OCR stay on this device; neither creates an approved record.
  static func extract(_ captured: SourceDocument) async -> SourceDocument {
    let worker = Task.detached(priority: .userInitiated) { extractSynchronously(captured) }
    return await withTaskCancellationHandler(operation: { await worker.value }, onCancel: { worker.cancel() })
  }

  private static func extractSynchronously(_ captured: SourceDocument) -> SourceDocument {
    var result = captured
    result.pages = []
    result.messages = []
    guard captured.isIntact else { result.state = .failed; result.messages = ["The retained original could not be verified. Select it again."]; return result }
    if captured.mimeType == "text/csv" {
      let text = String(decoding: captured.bytes, as: UTF8.self)
      result.pageCount = 1
      result.pages = [SourceDocumentPage(number: 1, width: 0, height: 0, rotation: 0, method: .csv,
        text: String(text.prefix(maximumTextCharacters)), observations: [], message: "CSV values need a confirmed column mapping.")]
      result.state = text.count > maximumTextCharacters ? .partial : .extracted
      return result
    }
    guard let pdf = PDFDocument(data: captured.bytes) else { result.state = .failed; result.messages = ["The PDF could not be opened. Its original bytes are still retained; choose another export or retry."]; return result }
    result.pageCount = pdf.pageCount
    guard !pdf.isLocked else { result.state = .failed; result.messages = ["This PDF is password-protected. Export an unlocked copy to review it. The original is retained."]; return result }
    guard pdf.pageCount > 0 else { result.state = .failed; result.messages = ["This PDF has no readable pages. The original is retained."]; return result }
    var ocrPages = 0
    var characters = 0
    let started = Date()
    for index in 0..<min(pdf.pageCount, maximumPages) {
      if Task.isCancelled { result.state = .cancelled; result.messages.append("Text extraction was cancelled. The original and completed pages are retained."); return result }
      if Date().timeIntervalSince(started) > 45 {
        result.messages.append("Extraction stopped at its time limit. Review the retained pages or use a shorter document.")
        break
      }
      guard let page = pdf.page(at: index) else { continue }
      let bounds = page.bounds(for: .cropBox)
      let number = index + 1
      let text = page.string ?? ""
      if text.trimmingCharacters(in: .whitespacesAndNewlines).count >= 8 {
        let limited = String(text.prefix(max(0, maximumTextCharacters - characters)))
        let observations = textObservations(page: page, text: limited, bounds: bounds, pageNumber: number)
        result.pages.append(SourceDocumentPage(number: number, width: bounds.width, height: bounds.height, rotation: page.rotation, method: .pdfText, text: limited, observations: observations))
        characters += limited.count
      } else if ocrPages < maximumOCRPages, characters < maximumTextCharacters {
        ocrPages += 1
        do {
          let observations = try recognize(page: page, pageNumber: number)
          let ocrText = String(observations.map(\.text).joined(separator: "\n").prefix(maximumTextCharacters - characters))
          result.pages.append(SourceDocumentPage(number: number, width: bounds.width, height: bounds.height, rotation: page.rotation, method: .visionOCR, text: ocrText, observations: observations,
            message: observations.isEmpty ? "No text was recognised. You can read the original and enter the fields manually." : "Read the original before confirming any recognised amount."))
          characters += ocrText.count
        } catch {
          result.pages.append(SourceDocumentPage(number: number, width: bounds.width, height: bounds.height, rotation: page.rotation, method: .unavailable, text: "", observations: [], message: "Text recognition could not finish. Read the original or retry extraction."))
        }
      } else {
        result.pages.append(SourceDocumentPage(number: number, width: bounds.width, height: bounds.height, rotation: page.rotation, method: .unavailable, text: "", observations: [], message: "The scan limit was reached. Read this page in the original or choose a shorter document."))
      }
      if characters >= maximumTextCharacters { result.messages.append("The extracted text limit was reached; the original remains complete."); break }
    }
    if pdf.pageCount > maximumPages { result.messages.append("Only the first \(maximumPages) pages were extracted. The complete original is retained for viewing.") }
    let incomplete = result.pages.count < pdf.pageCount || result.pages.contains { $0.method == .unavailable || $0.text.isEmpty } || !result.messages.isEmpty
    result.state = incomplete ? .partial : .extracted
    if ocrPages > 0 { result.messages.append("Some pages used on-device text recognition. Confirm their dates, signs and amounts against the original.") }
    return result
  }

  private static func textObservations(page: PDFPage, text: String, bounds: CGRect, pageNumber: Int) -> [SourceTextObservation] {
    let ns = text as NSString
    var observations: [SourceTextObservation] = []
    var offset = 0
    for line in text.components(separatedBy: .newlines) {
      let count = (line as NSString).length
      let cleaned = line.trimmingCharacters(in: .whitespacesAndNewlines)
      if !cleaned.isEmpty {
        let range = NSRange(location: min(offset, ns.length), length: min(count, max(0, ns.length - offset)))
        let box = page.selection(for: range)?.bounds(for: page)
        let normalized = box.flatMap { normalizedBox($0, page: bounds) }
        observations.append(SourceTextObservation(id: "p\(pageNumber)-l\(observations.count + 1)", text: cleaned, bbox: normalized, confidence: nil))
      }
      offset += count + 1
    }
    return observations
  }
  private static func normalizedBox(_ box: CGRect, page: CGRect) -> [Double]? {
    guard page.width > 0, page.height > 0, !box.isNull, !box.isInfinite else { return nil }
    let clipped = box.intersection(page)
    guard !clipped.isNull else { return nil }
    return [(clipped.minX-page.minX)/page.width, (clipped.minY-page.minY)/page.height, clipped.width/page.width, clipped.height/page.height]
  }
  private static func recognize(page: PDFPage, pageNumber: Int) throws -> [SourceTextObservation] {
    let bounds = page.bounds(for: .cropBox)
    guard bounds.width > 0, bounds.height > 0 else { return [] }
    let ratio = min(2, 1600 / max(bounds.width, bounds.height))
    let size = CGSize(width: bounds.width * ratio, height: bounds.height * ratio)
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    format.opaque = true
    let image = UIGraphicsImageRenderer(size: size, format: format).image { renderer in
      UIColor.white.setFill()
      renderer.fill(CGRect(origin: .zero, size: size))
      renderer.cgContext.translateBy(x: 0, y: size.height)
      renderer.cgContext.scaleBy(x: ratio, y: -ratio)
      renderer.cgContext.translateBy(x: -bounds.minX, y: -bounds.minY)
      page.draw(with: .cropBox, to: renderer.cgContext)
    }
    guard let cgImage = image.cgImage else { return [] }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    let languages = (try? request.supportedRecognitionLanguages()) ?? []
    let preferred = ["en-AU", "en-US"].filter { languages.contains($0) }
    if !preferred.isEmpty { request.recognitionLanguages = preferred }
    request.usesLanguageCorrection = false
    let deadline = DispatchWorkItem { request.cancel() }
    DispatchQueue.global(qos: .userInitiated).asyncAfter(deadline: .now() + 8, execute: deadline)
    defer { deadline.cancel() }
    try VNImageRequestHandler(cgImage: cgImage, options: [:]).perform([request])
    let ordered = (request.results ?? []).sorted {
      if abs($0.boundingBox.midY-$1.boundingBox.midY) > 0.015 { return $0.boundingBox.midY > $1.boundingBox.midY }
      return $0.boundingBox.minX < $1.boundingBox.minX
    }
    return ordered.enumerated().compactMap { index, observation in
      guard let candidate = observation.topCandidates(1).first else { return nil }
      let box = observation.boundingBox
      return SourceTextObservation(id: "p\(pageNumber)-o\(index + 1)", text: candidate.string,
        bbox: [box.minX,box.minY,box.width,box.height], confidence: Double(candidate.confidence))
    }
  }
}
