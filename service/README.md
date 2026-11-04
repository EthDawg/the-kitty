# Kitty service gateway

One app-configured HTTPS base URL serves household setup, bank imports and Ask. The Google Sheet remains the
canonical financial record; original import evidence and durable recovery records remain in the
user's Google Drive. The gateway has no financial database and retains no Google OAuth tokens.

```sh
node service/server.mjs
node --test service/server.test.mjs import-service/core.test.mjs ai-service/ask.test.mjs
docker build -f service/Dockerfile -t kitty-service .
```

Requires Node 22+, with no npm dependencies. The default listener is `127.0.0.1:8787`;
`KITTY_SERVICE_HOST` and `KITTY_SERVICE_PORT` configure it (`PORT` is a fallback).
The container runs as the unprivileged Node user. Configure the app's single service URL at build
time. Consumers should not be asked to host a server or paste an endpoint.

Routes are `/v1/setup/*`, `/v1/imports/*`, `/v1/ask`, `/v1/ask/preview`, `/v1/ask/capabilities`, and `/health`.
Dispatch occurs before reading the body; only the selected handler consumes it. Health confirms
that this process is running, not Google access, AI provider availability or import acceptance.
See the [setup contract](../setup-service/README.md), [import contract](../import-service/README.md) and [Ask contract](../ai-service/README.md).

**Run exactly one process and one replica.** Do not use Node clustering, autoscaling or overlapping
rolling replacements. The import queue is process-local. A shared hold on the Sheet survives
restarts and blocks a second device from replacing an unresolved import, but Drive appProperties
has no compare-and-swap operation; that hold is not a distributed lock. Stop the old process and
its requests before starting its replacement. A multi-instance release needs a durable coordinator
and new acceptance evidence.

For Ask, configure `OPENAI_API_KEY` with `KITTY_OPENAI_MODEL`, and/or `ANTHROPIC_API_KEY` with
`KITTY_CLAUDE_MODEL`. Set `KITTY_AI_PREVIEW_SECRET` to a server-only secret of at least 32 bytes.
Absent provider configuration is reported unavailable. Keep all secrets out of the app, repository,
image and request logs. The two AI providers have independent costs; provider spending limits and
an app-level billing/abuse policy remain deployment requirements. No paid provider call is needed
to run tests, use the importer or obtain an Ask preview.

Deploy behind HTTPS, with Authorization and body logging disabled throughout the proxy/host.
Only the app's short-lived Google bearer is used for the exact selected Sheet; the gateway needs
no extra Google scope beyond the app's `drive.file` access. Browser-origin requests are rejected.
Use one configured Google OAuth application/project across native clients; private Drive app
properties are app-scoped, and cross-account/client visibility still needs live acceptance.
The process-local per-IP limits are basic guards; they are not cross-instance billing controls.

This gateway is implemented and locally tested. It has not been deployed or exercised with app
OAuth or live AI provider calls. The separate [synthetic Sheet primitive test](../import-service/evidence/LIVE-ACCEPTANCE.md)
proves bounded v1 insertion behavior through the connected provider, not hosted end-to-end service
acceptance. No deployment account, domain or paid service was purchased or configured here.
