# 2. No server

**Decided 5 November 2026, confirming the project's first promise.**

**Context.** A hosted service had appeared behind imports, setup and Ask. It worked, and it broke the promise in the README: no
server, no database, nothing to pay for.

**Decision.** There is no hosted service. Logic that once needed one moves on-device or into the page. A household's data stays in
the household's own account.

**What it binds.**

- `service/`, `import-service/`, `setup-service/` and `ai-service/` never reach `main`.
- Ask on a phone is an explicit handoff to a model the person already uses, with a preview of what is shared.
- The parody portals on Vercel are demo infrastructure holding fiction. They are not a service households rely on.
- No telemetry.

**The cost.** Anything that needs a clock, such as a scheduled import, has to run in the household's own agent or on its own
machine. Code in a page and on a phone is harder to test than a server.
