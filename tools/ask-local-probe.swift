// swiftc -parse-as-library ios/Kitty/AskLocalModel.swift tools/ask-local-probe.swift -o /tmp/kitty-ask-probe && /tmp/kitty-ask-probe
// Fictional prompts only. This opt-in probe reports the result from the Mac's actual local model.
import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

@main enum AskLocalProbe {
    static func main() async throws {
        let state = AskLocalModel.availability()
        print("Availability", state["reason"] ?? "unknown")
        guard state["available"] as? Bool == true else { return }
        #if canImport(FoundationModels)
        if CommandLine.arguments.contains("--diagnose"), #available(macOS 26, *) {
            do {
                let reply = try await LanguageModelSession().respond(to: "Reply with the word cash.")
                print("Local generation completed:", !reply.content.isEmpty)
            } catch { print("Local generation error:", errorCodes(error as NSError)) }
            return
        }
        #endif
        // ask-routing.test.js checks that these three fictional inputs reach the inference-only route.
        let cases = [
            ("what funds can our household access right now", ["cash"]),
            ("where do we stand after what we owe", ["netWorth"]),
            ("where do we stand financially", ["cash", "netWorth"])
        ]
        var eligible = 0, declined = 0, unavailable = 0, rejected = 0
        for (mask, allowed) in cases {
            let result = await AskLocalModel.classify(maskedQuestion: mask)
            let outcome: String
            switch result["status"] as? String {
            case "proposed" where allowed.contains(result["kind"] as? String ?? "") && result["coverage"] as? String == "complete":
                eligible += 1; outcome = "ELIGIBLE PROPOSAL"
            case "unsupported":
                declined += 1; outcome = "DECLINED"
            case "unavailable":
                unavailable += 1; outcome = "SERVICE UNAVAILABLE"
            default:
                rejected += 1; outcome = "REJECTED PROPOSAL"
            }
            let json = try JSONSerialization.data(withJSONObject: result, options: .sortedKeys)
            print(outcome, mask, String(decoding: json, as: UTF8.self))
        }
        print("Eligible proposals \(eligible), declined \(declined), service unavailable \(unavailable), rejected proposals \(rejected)")
    }

    private static func errorCodes(_ error: NSError) -> [String] {
        let nested = (error.userInfo[NSMultipleUnderlyingErrorsKey] as? [NSError] ?? []) +
            ((error.userInfo[NSUnderlyingErrorKey] as? NSError).map { [$0] } ?? [])
        return ["\(error.domain)(\(error.code))"] + nested.flatMap(errorCodes)
    }
}
