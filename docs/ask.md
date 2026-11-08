# Ask the Kitty

On the page, Ask is Claude. Tap the sparkle at the top; it shows only where the page can use Claude, and the first question asks you to allow “Use Claude” for the page. Claude answers from the numbers on the page through the read-only tools in [app.js](../src/app.js) (`TOOLS`), names what it looked at, and keeps nothing between questions. It neither refreshes the Sheet silently nor writes to it.

## The model-free skills

The read-only skills live in [ask-skills.js](../src/kit/ask-skills.js), the paraphrase router in [ask-routing.js](../src/kit/ask-routing.js), and a drawer over both in [ask-panel.js](../src/kit/ask-panel.js); arithmetic uses [the shared engine](../src/engine.js). Each answer names its household view, source and period. In the demo “last month” means the month before the Sheet’s as-of date.

| Try it with the bundled Davies household | What to look for |
| --- | --- |
| How much did we spend on groceries last month? | December 2026, $1,429.05, four entries. Open one, or compare with the month before without typing the category again. |
| December grocery receipts | Four ledger entries total $1,429.05. None is marked receipt held: opening an entry shows its record, not a missing receipt image. |
| What changed in our spending this month? | Two dated totals and the biggest category change. Open either period to see the supporting expenses. In an unfinished month, compare equivalent days. |
| Could our unused subscriptions help fund Emergency fund? | Dropbox Plus and YouTube Premium average $37.49/month. The gym is marked Keep. There is $3,097.16 left; the estimated funding month remains June 2027 even if the savings go into the goal. The original 31 December 2026 target is shown separately. |
| If we cancelled all unused subscriptions, how much sooner could we reach our Emergency fund? | Including the gym marked Keep models $102.44/month. The estimate changes from June to May, one month sooner. No subscription or goal changes. |
| When will the Japan trip be funded? | The Sheet already shows $12,090.25 against a $12,000 target. |
| What bills are due next? | Scheduled bills with dates. Paydays are a separate kind of event; refunded charges are not forecast as recurring income. |

Queries with a missing or ambiguous dimension never broaden silently to the whole household. Simple questions, person selection, comparisons and the savings scenario work without a model. Fully recognised paraphrases run immediately. For a bounded question such as “Where do we stand financially?”, the panel puts cash and net worth side by side with their definitions; each opens its underlying calculation immediately. An unfamiliar question gets a clarification, and a guess cannot produce a number. Answers are in memory for the current view only.

The page’s Ask button does not open this panel; it asks Claude. The skills stay because they are checked against the Sheet’s own rows: an open-ended model should earn its place by matching these receipt-backed answers on real questions.

**Verification:** `node --test tools/ask-skills.test.js tools/ask-routing.test.js` checks the skills against independently summed source rows and contract records, including refunds, scope, partially elapsed months, and refusal cases, and the router against safe and unsafe paraphrases.

The public Davies schedule now shows the investment loan on 28 February and the home loan on 1 February. The [fictional Sheet formula and rollback](v2-loan-next-date.md) explain the source correction and when the next due date is unknown.
