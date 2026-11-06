# 4. The sheet holds every number and owns every original

**Decided 7 November 2026. It replaces "the sheet owns every number".**

**Context.** The first promise was that the sheet owns every number. Once derived tabs are rebuilt by updates, that stops being true
of a total: rebuilding it must be safe, or no fix can ever arrive. The promise still has to mean something a household can rely on.

**Decision.** A household's sheet holds every number, so walking away with it still works. It owns every original: what sources said,
what people decided, and who and what exists. Everything else is derived and can be rebuilt.

**What it binds.**

- Tabs fall into three classes: yours, evidence and managed. Only managed tabs are rebuilt freely.
- A hand edit in a managed tab becomes a proposed decision, never a silent overwrite.
- Anything that writes a managed tab first compares the stored hash and stops on a mismatch.
- The page keeps no number of its own. Writes are few, narrow and read back.

**The cost.** Two-way sync with a person typing in the sheet is hard, and it is not built yet. [`standard/EXPERIMENTAL.md`](../../standard/EXPERIMENTAL.md) says so.
