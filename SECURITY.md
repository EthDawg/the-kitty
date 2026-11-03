# Security and data boundaries

- The page is a single HTML file. It has no server, no database and no telemetry.
- Real money data is never bundled. The published demo bundles a fictional household (`data/snapshot.json`).
  A household publishes its own copy from `python3 build.py --no-snapshot`, which contains no data at all.
- Live reads and the three writes (Kitty-tab settings, a goal's target or date, the safety-net months) go through
  the viewer's own Google Sheets connector on claude.ai, with the viewer's consent, and only to the ranges listed in
  the page's trust drawer. The page holds no credentials and no API keys.
- Ask the Kitty sends the page's numbers to Claude only when the viewer asks a question and only after they allow
  "Use Claude" for the page. Nothing is kept between questions.
- Preferences (name, country, lead goal, colours, theme, the viewer's own sheet ID) live in the browser's local
  storage and, when available, in the viewer's private per-user store for this artifact.
- The bank-export skill never types, reads or stores a password or one-time code; a person or their password
  manager signs in. Bank files are saved as delivered and never edited.

To report a vulnerability, open a GitHub issue marked "security" or email the maintainer named on the repo.
