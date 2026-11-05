# Apple model routing probe

The Kitty’s shipping Ask uses the shared JavaScript router to answer recognized questions and offer a choice for ambiguous household summaries. This standalone developer package checks whether Apple’s on-device model can suggest a useful interpretation. It sends three short fictional questions to a fresh local model session and counts proposals, refusals and service failures separately. [Shared router](../../src/kit/ask-routing.js)

On 5 November 2026, the model on an arm64 Mac running macOS 26.5.1 and Xcode’s 26.5 SDK completed **all three requests**. It proposed spending for each one. The permitted views were cash for the first question, net worth for the second, and either view for the ambiguous third question. The probe rejected all three proposals against those choices. **Zero of three were accepted**, with zero model refusals and zero service failures. Four Swift regression tests passed for the adapter’s input bounds, closed output format and failure handling. The shared router’s tests verify the same permitted choices. [Fictional inputs and candidate checks](../ask-routing.test.js)

From the repository root, build and run the four adapter checks on macOS with Xcode installed. The temporary build directory keeps generated files out of the repository.

```sh
swift test --package-path tools/ask-apple-probe --scratch-path /tmp/kitty-ask-apple-probe-build
```

To repeat the actual inference run, use a Mac with macOS 26+, a Foundation Models SDK and an available local Apple model.

```sh
swift run --package-path tools/ask-apple-probe --scratch-path /tmp/kitty-ask-apple-probe-build kitty-ask-apple-probe
```

The `--diagnose` argument runs one plain local generation request to distinguish a model-service error from structured-output refusal. The shared router’s scope tests run with `node --test tools/ask-routing.test.js`.
