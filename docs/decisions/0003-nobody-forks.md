# 3. Nobody forks

**Decided 7 November 2026.**

**Context.** The way to start a household was to copy the demo sheet and publish your own page. Data and code both forked, and
neither had a way back. A fix reached nobody. No outside household exists yet, so changing this costs almost nothing now and gets
expensive with the first one.

**Decision.** A household depends on the base and never copies its logic. Updates reach the app, the shared data and the Standard.
They never write a household's originals or tailoring. Derived tabs arrive by rebuilding, and locked years never move. Only shapes
flow back up, never data.

**What it binds.**

- New logic goes in the engine or shared data. A formula in a generated tab is fine, because an update can replace it. A formula whose only home is a household's copy is not.
- A private page is a pin, not a fork: the same build, unedited, rebuilt to update.
- A household's own needs go in tailoring, as `x_` material that carries the person's sentence and an example.
- [`standard/SPEC.md` section 13](../../standard/SPEC.md#13-upgrades) owns the detail.

**The cost.** The base carries the weight of staying compatible. The schema becomes a public API, under the rules in
[`standard/GOVERNANCE.md`](../../standard/GOVERNANCE.md). Until a blank start and a migration exist, the only start is still a copy, and the README says so.
