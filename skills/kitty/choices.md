# Choices

Use this when the household has quotes for a decision: a renewal, a phone payout, a plan change, a cancel or keep. The output is rows on Decision Options (sheet version 3). The page draws one card per decision.

1. One row per option. Every number comes from a quote, a bill or the provider's own page, and that document goes in Source.
2. **Upfront** is paid on choosing. **Per month** is the ongoing cost. **Months** is how long that cost runs under this option.
3. The page compares every option over the longest Months. Anything still owed at the end of that horizon goes in **Extra**. For example, the unpaid part of a new 36-month handset after 11 months. Without it, a long contract looks as cheap as a short one.
4. **Waiting has a price.** When paying out later is smaller, count the repayments and service charges paid while waiting, as in "payout falls to $644, but the line costs $171 a month meanwhile".
5. Recommend at most one option, and say why in its Note in one plain sentence.
6. **Decide by** is the date the cheapest option stops being available: a renewal, a port cut-off, a price change.
7. State every assumption in the Note: who pays, what is unconfirmed, what changes the answer.
8. Don't recommend a financial product. Cost the options the household already has.

When the household decides:
- set every row of that Decision ID to `Decided`;
- record the choice on Decisions with the date and who chose.
