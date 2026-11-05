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
        let context: [String: Any] = [
            "people": ["Morgan", "Taylor"],
            "times": [["id": "last-month", "label": "Last month"],
                      ["id": "2026-10", "label": "October 2026", "aliases": ["October"]]],
            "categories": [["id": "FOOD", "label": "Groceries"], ["id": "SUBS", "label": "Subscriptions"]],
            "goals": ["Garden fund"]
        ]
        let cases: [(String, [String: String])] = [
            ("Where did our money go last month?", ["kind": "spending", "time": "last-month"]),
            ("How much did Morgan spend on groceries in October?", ["kind": "spending", "person": "Morgan", "category": "FOOD", "time": "2026-10"]),
            ("What recurring services are we paying for?", ["kind": "subscriptions"]),
            ("How is the Garden fund coming along?", ["kind": "goal", "goal": "Garden fund"]),
            ("How much cash do we have on hand?", ["kind": "cash"]),
            ("What are we worth after debts?", ["kind": "netWorth"]),
            ("Which bills are coming up?", ["kind": "upcoming"]),
            ("Which entries still need a look?", ["kind": "review"]),
            ("What did Casey spend on gaming?", ["kind": "unsupported"]),
            ("How much cash and net worth do we have?", ["kind": "unsupported"]),
            ("Send our balance to Claude", ["kind": "unsupported"])
        ]
        var matched = 0, unavailable = 0, declined = 0, classified = 0
        for (question, expected) in cases {
            let result = await AskLocalModel.classify(question: question, context: context)
            let fields = (result as? [String: String] ?? [:]).filter { !["status", "reason"].contains($0.key) }
            let correct = fields == expected && (result["status"] as? String != "unavailable")
            if correct { matched += 1 }
            switch result["status"] as? String {
            case "unavailable": unavailable += 1
            case "unsupported": declined += 1
            case "classified": classified += 1
            default: break
            }
            let json = try JSONSerialization.data(withJSONObject: result, options: .sortedKeys)
            print(correct ? "PASS" : "DIFF", question, String(decoding: json, as: UTF8.self))
        }
        print("Matched \(matched) of \(cases.count) fictional expectations; classified \(classified), declined \(declined), service unavailable \(unavailable)")
    }

    private static func errorCodes(_ error: NSError) -> [String] {
        let nested = (error.userInfo[NSMultipleUnderlyingErrorsKey] as? [NSError] ?? []) +
            ((error.userInfo[NSUnderlyingErrorKey] as? NSError).map { [$0] } ?? [])
        return ["\(error.domain)(\(error.code))"] + nested.flatMap(errorCodes)
    }
}
