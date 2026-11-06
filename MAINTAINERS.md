# Maintainers

| GitHub | Role |
|---|---|
| [`@EthDawg`](https://github.com/EthDawg) | Owner |
| [`@mattywhitenz`](https://github.com/mattywhitenz) | Maintainer |

This is a personal repository, so GitHub allows it one owner. A maintainer pushes, merges, manages issues and releases, and counts
as a code owner. Only the owner invites people, changes visibility, or deletes or archives the repository. A move to an organisation
is open for later, if the owner chooses.

Both hold every area today. The areas are named so that `docs/MAP.md` has an owner to point at and work can be split later.

| Area | Covers |
|---|---|
| App | `src/`, `brand/`, `merchants/`, `data/`, `fixtures/`, `apps-script/` |
| Standard | `standard/`, `tax/` |
| Importer | `period-close/`, `src/core/`, `tools/period*` |
| Demo world | `portals/`, `sources/` |
| iOS host | `ios/` |
| Project | `.github/`, `docs/`, `skills/`, `tools/`, and the files at the root |

## How a change lands

- A pull request merges when CI is green and a maintainer has reviewed it. `CODEOWNERS` requests that review.
- The agent or person who wrote a change does not merge it.
- A report is not proof. Read the diff and run `python3 check.py` before calling something done.
- A change to the Standard follows [`standard/GOVERNANCE.md`](standard/GOVERNANCE.md).
- A change to a decision goes through [`docs/decisions/`](docs/decisions/).

## Publishing the page

```bash
python3 check.py
python3 build.py --v2      # dist/kitty-v2.html
```

Publish `dist/kitty-v2.html` from Claude to the URL in `kitty.config.json` with these capabilities: `mcp` (Google Sheets, with
`get_values`, `get_spreadsheet`, `update_values` and `append_values`), `sample`, `user`, `db` and `downloads`. The icon word is `cat`. The
v2 sheet must be shared as anyone with the link, Viewer.

The portals deploy to Vercel by hand. See the deploy notes in [`portals/README.md`](portals/README.md).

Before any push, run the public check with your private list:

```bash
KITTY_PRIVATE_TERMS=/path/outside/the/repo python3 check.py public
```
