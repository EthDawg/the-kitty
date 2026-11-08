# Vendored dependencies

`build.py` inlines `gridstack-14.0.0.min.css` into the page. It is identical to the
published GridStack 14.0.0 file; `gridstack-14.0.0.LICENSE.txt` is its licence. The
page loads its scripts (d3, d3-sankey, canvas-confetti, qrcode-generator and
GridStack) from the CDN hosts the claude.ai artifact sandbox allows, pinned to exact
versions in `src/shell.html`. The build does not download or install anything.

The other files here, with `manifest.json` and `brand/fonts/`, are pinned offline
copies of those scripts and the brand fonts. Only the retired native build inlined
them; nothing reads them now.
