# 5. The tax model is public, on fiction only

**Decided 7 November 2026. It replaces an earlier position that tax stays out of the public repository.**

**Context.** Tax is where a household's record is most valuable, and where real data is most sensitive. Once the Standard had a tax
plane, keeping the model private would have meant a fork at the most important point.

**Decision.** The tax model and engine live in this repository, tested on fictional households only. Real returns stay in a
household's own record and never come here.

**What it binds.**

- Tax tables are dated facts in shared data, and they apply even to a household that pins.
- Every tax test uses an invented household. A real return's shape can arrive as a fictional twin, with no figures from it.
- A lodged return outranks any draft, and a locked year does not move.
- Numbers here are not tax advice, and the page says so.

**The cost.** A model tested only on fiction is only as good as the fiction. Blind households exist for that reason, and they have found plenty.
