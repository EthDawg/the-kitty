# Ask the Kitty on iPhone

Tap the sparkle on Home, type a question, or try a suggested one. Each answer names its household view, source and period. In the demo “last month” means the month before the Sheet’s as-of date. In live mode, Ask uses the selected Sheet model that populated Home and Activity. It neither refreshes the Sheet silently nor writes to it.

| Try it with the bundled Davies household | What to look for |
| --- | --- |
| How much did we spend on groceries last month? | December 2026, $1,429.05, four entries. Open one, or compare with the month before without typing the category again. |
| What changed in our spending this month? | Two dated totals and the biggest category change. Open either period to see the supporting expenses. In an unfinished month, compare equivalent days. |
| Could our unused subscriptions help fund Emergency fund? | Dropbox Plus and YouTube Premium average $37.49/month. The gym is marked Keep. There is $3,097.16 left; the estimated funding month remains June 2027 even if the savings go into the goal. The original 31 December 2026 target is shown separately. |
| When will the Japan trip be funded? | The Sheet already shows $12,090.25 against a $12,000 target. |
| What bills are due next? | Scheduled bills with dates. Paydays are a separate kind of event; refunded charges are not forecast as recurring income. |
| In Review: check past entries | Reads earlier categorised entries with the same normalised description on the same account. Shows evidence or says there is none. The category picker is a separate action. A guess cannot create a rule. |

The read-only skills live in [ask-skills.js](../src/kit/ask-skills.js); arithmetic uses [the shared engine](../src/engine.js). Queries with a missing or ambiguous dimension never broaden silently to the whole household. Simple questions, person selection, comparisons and the savings scenario work without AI. For other phrasing, [Apple Foundation Models](https://developer.apple.com/foundation-models-framework/) can classify a masked question on a supported device. The model gets no ledger, tools or numbers from the Sheet, and cannot write or generate the answer. A recognised interpretation requires a tap; uncertainty leads to clarification. Answers are in memory for the current view only.

For a deeper conversation, preview the **Share this answer** text first, then choose a destination in the system share sheet. No provider URL contains the question, figures, or Sheet identifier. No Google permission transfers. In the Davies demo, the clarification screen also offers its actual [Claude artifact](https://claude.ai/artifact/QH2gsDP8sHZmgMVKBtkwxn), which runs its own Ask and does not inherit the native question. A private household does not get that demo as its answer.

There is no Claude/ChatGPT subscription sign-in in this build. The [ChatGPT feasibility probe](../tools/ask-provider-probe/README.md) separates a tested local OAuth callback from unproven consent and live inference. The [Apple model probe](../tools/ask-local-probe.swift) can be run on an eligible Mac without a provider key. An open-ended external model should earn its place by outperforming these receipt-backed answers on real questions.

**Verification:** `node --test tools/ask-skills.test.js` checks against independently summed source rows and contract records, including refunds, scope, partially elapsed months, and refusal cases. Run `OfflinePageTests/testAskAnswersFromEntriesAndPreservesTheFollowUpScope` for the iOS interaction, source and share-preview checks. Its two full-resolution fictional screenshots are attached to the Xcode test result; no household records are committed as evidence.
