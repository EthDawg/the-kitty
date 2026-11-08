# Vendored dependencies

`build.py` inlines `gridstack-14.0.0.min.css` into the page. It is identical to the
published GridStack 14.0.0 file; `gridstack-14.0.0.LICENSE.txt` is its licence. The
page loads its scripts (d3, d3-sankey, canvas-confetti, qrcode-generator and
GridStack) from the CDN hosts the claude.ai artifact sandbox allows, pinned to exact
versions in `src/shell.html`, and its fonts from Google Fonts. The build does not
download or install anything.
