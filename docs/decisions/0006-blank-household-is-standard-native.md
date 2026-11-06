# 6. A blank household is Standard-native

**Decided 7 November 2026. Not built yet.**

**Context.** The only start today is to copy the Davies sheet, which carries someone else's formulas and contradicts
[decision 3](0003-nobody-forks.md). Meanwhile the page reads the v2 sheet and the Standard has never run in one. A new household
could start on either.

**Decision.** A blank household starts on the Standard from day one, as `sheet_version` 3. It is written empty from
`standard/generated/sheet-tabs.json` and stamped with its version, so it carries no Davies data and can take updates. There is no
template copy.

**What it binds.**

- The public Davies page stays on v2 until a migration exists, and v2 stays the sheet the page reads until then.
- Blank is a state, not an error. The product has to say what is empty, and whether it is empty because the answer is none or because nobody has asked.
- Starting anyone new on v2 would repeat the mistake decision 1 rejected.

**The cost.** The page and the Standard have to meet before this is real, and the README has to keep saying a blank start is coming until it is here.
