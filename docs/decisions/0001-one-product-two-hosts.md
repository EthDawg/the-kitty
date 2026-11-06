# 1. One product, two hosts

**Decided 5 November 2026.**

**Context.** A native iPhone app grew beside the page: its own brand, its own copy of the engine, a hosted service and a sheet
version already being left behind. Every feature would have had to be built twice, and the two would have disagreed.

**Decision.** There is one sheet, one app (`src/`), one brand (`brand/`) and two thin hosts: the Claude artifact and the iPhone shell.
The page reaches its host through five injected objects (`mcp`, `sample`, `db`, `user`, `downloads`). The shell supplies the same
five, and adds only what a phone can do and a page cannot: file picking, on-device text reading and a biometric lock.

**What it binds.**

- UI and business rules live in `src/`. The shell renders the shared page and does not redraw it.
- No copy of the engine or the brand under `ios/`. `tools/check_shape.py` enforces it.
- The UI asks for a semantic name, never a file, a symbol or a raw colour.
- A design sprint happens once, after the product works end to end.

**The cost.** A shell has to earn its place on the App Store, and the risk that it reads as a repackaged website is real. It is tested before any App Store work.
