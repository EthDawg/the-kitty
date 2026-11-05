# Bundled brand fonts

These are the original variable TrueType files identified by Google Fonts'
family metadata, pinned to their upstream source commits in
`src/vendor/manifest.json`. Both use SIL Open Font License 1.1; retain each
family's accompanying OFL file.

The native build embeds the files as data URLs. It exposes the same normal-style
weights requested by the artifact: Bricolage Grotesque 500–800 and DM Sans
400–700. Optical sizing remains automatic and width remains normal. It does not
add italic faces or expose extra weight ranges as part of the container work.

No font converter or network connection is required during a build. These files
stay in `brand/`; the generated, ignored native HTML is the app's resource.
