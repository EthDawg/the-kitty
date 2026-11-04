# Embedded Ask the Kitty

This is a small read-only service for an iOS app, not a chat platform. It uses the caller's own Google
bearer to read the exact selected Kitty Sheet. It sends no Google token, Sheet ID, source link or
unselected transaction list to the model. It has no Sheet-write method, model tools, conversation
database or autonomous action loop. Source strings and the question remain untrusted data.

## Client protocol

1. `GET /v1/ask/capabilities` with `Authorization: Bearer <Google access token>` returns configured
   providers and supported scopes. No configuration is invented; absent provider keys/models mean
   that provider is unavailable.
2. `POST /v1/ask/preview`, JSON:

   ```json
   {"sheetId":"selected-authorised-id","provider":"openai","question":"Explain our cash.","scope":"overview"}
   ```

   The service reads Google and returns `provider`, `providerLabel`, `question`, `scope`, `asOf`,
   `facts`, `providerSummary`, `factsHash`, `summaryHash`, `previewToken`, `expiresAt`, `limitations`.
   **No model call occurs.** Show the exact `providerSummary` and relevant limitations to the user.
3. After explicit approval, `POST /v1/ask` with the same sheet/provider/question/scope:

   ```json
   {
     "sheetId":"selected-authorised-id","provider":"openai","question":"Explain our cash.","scope":"overview",
     "previewToken":"returned-token",
     "consent":{"approved":true,"provider":"openai","factsHash":"returned-facts-hash","summaryHash":"returned-summary-hash"}
   }
   ```

   The service checks the HMAC signature, five-minute expiry, exact request and bearer binding,
   permission for that provider and summary, then **rereads Google**. Changed figures require a
   new preview. An access-token refresh also requires a new preview. This is an intentionally
   bounded consent flow; a signed preview alone never grants Sheet access.
4. Success returns `{answer,evidence,asOf,provider,limitations}`. Evidence includes server-owned
   fact IDs, values, A1 source ranges and Sheet URLs. The app must treat all answer strings as text.
   No returned field can execute a write, navigate an arbitrary link or grant further authority.

Scopes are `overview`, `goals`, `spending` and `transaction`. Transaction scope additionally requires
`transactionId` in both preview and ask. Overview includes headline metrics, their existing
comparisons and up to eight goals. Spending includes up to twelve category totals for the as-of
month, derived in currency minor units, excluding income and transfers. Transaction scope includes
only the selected original description, merchant, signed amount, date and category.

## Server configuration

Use Node 22 or newer. No third-party package is required.

- `OPENAI_API_KEY` + `KITTY_OPENAI_MODEL` enable OpenAI Responses.
- `ANTHROPIC_API_KEY` + `KITTY_CLAUDE_MODEL` enable Claude Messages.
- `KITTY_ANTHROPIC_VERSION` optionally sets the API version; the default is the current documented
  `2026-10-21` version. Configure and verify the chosen model/version's structured-output support.
- `KITTY_AI_PREVIEW_SECRET` is a server-only secret of at least 32 bytes. Without one, a random
  process-local key is generated, so restarts invalidate previews. Multiple instances need the same
  configured secret; never bundle it in iOS or commit it.
- `KITTY_AI_HOST` defaults to `127.0.0.1`; `KITTY_AI_PORT` defaults to `8788`.

```sh
node ai-service/server.mjs
node --test ai-service/ask.test.mjs
```

`createServer()` returns an unstarted Node HTTP server. `createAskHandler()` returns an async
`(request,response) -> handled` function for the combined gateway. The root gateway can route
`/v1/ask*` to this handler; unknown paths return false. Do not chain two handlers that both consume
the same request body. Health routing should remain gateway-owned when combined.

The service uses fixed official provider endpoints, refuses redirects, bounds requests and responses,
sets timeouts and performs no automatic model retry or provider fallback. It never logs bodies,
credentials or provider diagnostics. Deploy behind HTTPS, strip request-body/Authorization logging
from infrastructure, configure provider spending limits and appropriate abuse controls. The included
per-IP limit is process-local; it is not a production-wide billing entitlement or abuse system.

OpenAI requests use `store:false`, no conversation ID and no tools. This does not itself establish a
zero-retention contract. Provider processing/retention terms must be described truthfully in the
released app's privacy disclosures. User consent cannot establish any special provider arrangement.

## Guardrails and evidence limits

The response schema permits only text, approved fact IDs and limitations. The service refuses
unapproved citations/URLs, unsupported numbers, unexpected response fields, incomplete provider
responses and common false claims of performed actions. Arithmetic and financial facts come from
code/Sheet values; the model explains them. These checks reduce errors but cannot prove every
natural-language interpretation correct. Show evidence and uncertainty and provide an in-app way
to report a problematic answer before store release.

This implementation and mock checks do not establish deployment, Google OAuth access, provider
billing/availability, real model quality, privacy acceptance or App Store approval. No live financial
data was sent to an AI provider during this work.

## Official references checked on 4 November 2026

- [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses)
- [OpenAI Responses and storage setting](https://developers.openai.com/api/docs/guides/migrate-to-responses?api-mode=responses)
- [Claude Messages API](https://platform.claude.com/docs/en/api/http/messages)
- [Claude structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
- [Claude API versioning](https://platform.claude.com/docs/en/api/versioning)
- [Google Sheets batchGet](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/batchGet)
