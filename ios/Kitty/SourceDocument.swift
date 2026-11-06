import CryptoKit
import Foundation

/// Original bytes and extraction travel together inside the protected import draft.
/// Extracted text is a suggestion; it never replaces the original document.
struct SourceDocument: Codable, Identifiable, Equatable, Sendable {
  enum State: String, Codable, Sendable { case captured, extracted, partial, failed, cancelled }
  let id: String
  let name: String
  let mimeType: String
  let bytes: Data
  let capturedAt: Date
  var state: State = .captured
  var pages: [SourceDocumentPage] = []
  var pageCount: Int = 0
  var messages: [String] = []
  var extractorVersion: String = "kitty-ios-document-1"
  var byteLength: Int { bytes.count }
  var isIntact: Bool { Self.sha256(bytes) == id }

  init(name: String, mimeType: String, bytes: Data, capturedAt: Date = Date()) {
    id = Self.sha256(bytes)
    self.name = name
    self.mimeType = mimeType
    self.bytes = bytes
    self.capturedAt = capturedAt
  }
  static func sha256(_ bytes: Data) -> String {
    SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
  }
  func payload() throws -> [String: Any] {
    guard isIntact else { throw SourceIntakeError.message("The retained original changed. Select it again before saving.") }
    var result: [String: Any] = ["id": id, "sha256": id, "name": name, "mimeType": mimeType,
      "byteLength": byteLength]
    if mimeType == "text/csv" {
      let text = String(decoding: bytes, as: UTF8.self)
      guard Data(text.utf8) == bytes else { throw SourceIntakeError.message("The CSV is not valid UTF-8. Export it again with UTF-8 encoding.") }
      result["text"] = text
    } else { result["bytesBase64"] = bytes.base64EncodedString() }
    return result
  }
}

struct SourceDocumentPage: Codable, Identifiable, Equatable, Sendable {
  enum Method: String, Codable, Sendable { case pdfText = "pdf-text", visionOCR = "vision-ocr", csv, unavailable }
  let number: Int
  let width: Double
  let height: Double
  let rotation: Int
  let method: Method
  let text: String
  let observations: [SourceTextObservation]
  var message: String?
  var id: Int { number }
}

struct SourceTextObservation: Codable, Identifiable, Equatable, Sendable {
  let id: String
  let text: String
  /// Page-normalized coordinates, origin at bottom left. Rotation belongs to the page.
  let bbox: [Double]?
  let confidence: Double?
}

struct SourceEvidenceReference: Codable, Identifiable, Equatable, Sendable {
  let id: String
  let fileId: String
  var page: Int?
  var line: Int?
  var quote: String?
  var basis: String?
  var bbox: [Double]?
  var payload: [String: Any] {
    var result: [String: Any] = ["id": id, "fileId": fileId]
    if let page { result["page"] = page }
    if let line { result["line"] = line }
    if let quote, !quote.isEmpty { result["quote"] = quote }
    if let basis { result["basis"] = basis }
    if let bbox { result["bbox"] = bbox }
    return result
  }
}

enum SourceIntakeError: LocalizedError {
  case message(String)
  var errorDescription: String? { if case .message(let message) = self { return message }; return nil }
}
