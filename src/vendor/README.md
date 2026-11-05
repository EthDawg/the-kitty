# Offline dependencies

`manifest.json` pins the browser files, fonts, licenses and notices used by
`python3 build.py --host native`. Every listed file is checked with SHA-256 before
the native page is emitted. The build does not download or install anything.

The JavaScript files are unchanged publisher release files, obtained from the
exact npm archive and integrity value recorded in the manifest. D3 precedes its
Sankey extension. These are classic browser scripts, not ES modules. Confetti and
QR use the publisher's non-minified browser files; no extra minifier is needed.
GridStack's existing CSS is identical to the published 14.0.0 file.

Retain the license files and GridStack notice. The generated native page embeds
their full text in `#kitty-third-party-notices` as inert JSON, alongside the font
licenses. Upstream upgrades require reviewed source/version changes and new
hashes; changing a URL at build time is not an upgrade mechanism.

The artifact host keeps its existing CDN references. Native output inlines the
same pinned versions, with all remote asset loading denied by its CSP. External
text links are not runtime dependencies.
