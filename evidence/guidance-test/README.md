# Guidance test

Question: once the admin is done, does a tax guidance service connected over MCP change the advice a model gives?

Set-up, 8 November 2026: the fictional couple from `../move-in-test/` (Sam and Ria Calder), with Opus's finished FY26 figures (`../move-in-test/runs/opus-plain/fy26.json`). Five questions, asked twice with `codex exec`: once told to check every answer with the Australian Tax MCP (an independent service at https://ato-mcp.com.au/ that returns published guidance with citations), once told to use no MCP tools or web. Prompts and answers are in `with/` and `without/`, word for word.

| | With the guidance service | Without it |
|---|---|---|
| Advice and reasoning | Same | Same |
| Sources | 5 of 5 answers link an ato.gov.au page | Page titles from memory |
| FY26 work-from-home fixed rate | States 70 cents an hour | Declines to state it |

What it means: on settled rules the model already knew the answer. The guidance service adds current-year figures and a link for every answer, which is what an accountant needs to check the work. It does not decide a treatment or lodge a return. One run each. Not tax advice.
