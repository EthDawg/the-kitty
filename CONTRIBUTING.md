# Contributing

- Numbers belong to the sheet. If a change needs a new number, add it to the owning tab (or to Metrics) and read it;
  do not compute it in the page. `test.js` enforces the oracle: transactions must add up to the Cash Flow tab every month.
- Run `node --test test.js` and `python3 build.py` before a pull request. CI runs both plus a repeated-month import
  that must append nothing.
- Keep the page one file: no build step beyond `build.py`, no framework, libraries only from the CDN hosts the
  claude.ai artifact sandbox allows, pinned to exact versions.
- Copy: short sentences, no jargon, money stated as money ("$11k of $12k"), estimates labelled as estimates.
- Bank paths in `src/data-sources.json` carry `documented` and `verified` dates. If you confirm a path on a bank's own
  site, stamp `verified`; if you add one from memory, leave `verified` null.
