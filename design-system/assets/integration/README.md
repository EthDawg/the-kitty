# Applying the Calm Kitty kit

Asset paths below are relative to `design-system/assets/`. The executable themed-copy builder is `python3 design-system/build-preview.py` from the repository root.

This is a prepared design asset package for the existing vanilla JavaScript application. It has not been published or connected to the household sheet. No sheet data or financial calculation changes are needed.

## Theme

Append `tokens/calm.css` after the existing `src/style.css` content. In the source app's startup code (before first render), opt in with:

```js
document.documentElement.dataset.kittyTheme = 'calm';
```

The CSS is inactive without that attribute, so existing accents remain unchanged. While Calm is active its coherent palette overrides the four original accents; remove the attribute to restore those choices. Keep the existing `data-theme="light"`, `data-theme="dark"` and no-attribute system-theme mechanism. Do not write the theme choice to the Sheet without a separate product decision. For a dedicated Calm edition, set the attribute during startup and hide the old accent chooser; for an optional theme, expose a labelled toggle and restore the prior accent on exit.

The source `src/shell.html` contains `<style>/*STYLE*/</style>` and build.py bundles the styles. For the current single-file publishing workflow concatenate the override into `src/style.css`, then run `python3 build.py`. Do not reference local CSS files from the published Claude artifact. Inspect the built file before publication.

Set the shell theme-colour meta to `#174E4A`. The existing fonts (Bricolage Grotesque and DM Sans) are retained; system fallbacks are supplied. Amounts use tabular lining numerals. No additional font downloads are introduced.

## UI icons

Replace the existing hidden SVG sprite block in `src/shell.html` with `icons/sprite-inline.html`. All 16 existing `i-*` IDs are preserved; calls such as `ico('i-home')` continue to work. Do not append a second sprite with duplicate IDs. The 40 individual SVGs and external `sprite.svg` are included for other platforms; the inline sprite works best in the single-file app.

```html
<button aria-label="Search transactions">
  <svg width="24" height="24" aria-hidden="true"><use href="#i-search"/></svg>
</button>
```

Use 20–24px UI icons within a minimum 44×44px hit area. Use `currentColor`; never bake semantic status into the icon file. Preserve visible navigation labels. Selected navigation needs the existing `aria-selected` state and selection background. If an SVG conveys unique information, add an accessible name; decorative icons alongside text use `aria-hidden="true"`.

The new `i-cat` is a small functional outline symbol. `brand/kitty-mark.svg` and `brand/kitty-app.svg` are editable geometric counterparts to the generated cat identity, not vector traces. Use the full app canvas for app/PWA icons; the operating system supplies its mask. Use the transparent mark on teal or another tested dark surface. Keep at least one ear-width of clear space; never use the face to indicate financial success or failure. A cat is decoration, not evidence that an account is reconciled.

## Components and ledger behaviour

The theme uses existing classes. It adds 44px minimum hit areas for principal controls, stronger input boundaries, persistent amount alignment, quiet row separators, visible keyboard focus and reduced-motion support. Existing layout and render logic remain the application owner's responsibility. Review the denser header at 320px widths after adding hit-area sizing.

Keep transactions readable: description and date on the left, signed amount right-aligned, decimal precision consistent within a list. Do not shorten exact amounts in transaction rows. Charts need text values and legends in addition to colour. Income, expense, transfers, pending and failed states must retain explicit words or signs. Apricot is decorative or a dark-text surface, never small text on white.

Use illustration only in onboarding, first-use empty states and a completed milestone. Do not place it behind ledger text, in error messaging, or on every card. Show success only after the app has reread and confirmed the write. Avoid looping celebrations; honour reduced motion.

## Verification

Run `python3 design-system/assets/integration/validate.py` from any directory. This verifies SVG syntax, the original symbol ID coverage, and the semantic foreground/background contrast pairs in `tokens/colors.json`. See `VALIDATION.md` for measurements and limits.

After applying, run the application's existing `node --test test.js` and `python3 build.py`. Check Home, Activity, Insights, Goals and Setup in light, dark and system appearance; 320px, 390px and desktop widths; keyboard focus; 200% text zoom; reduced motion; empty, stale, loading and error states. Check exact amounts against the unchanged source sheet. This kit's checks do not claim end-to-end app or device acceptance.

## Files

- `icons/`: 40 independent SVGs, external/inline sprites, manifest and a labelled SVG contact sheet.
- `tokens/calm.css`: optional light/dark theme for the existing application.
- `tokens/colors.json`: portable colour tokens extracted from the CSS.
- `brand/`: editable app mark and full-square app icon.
- `integration/build-icons.py`: reproducible icon source.
- `integration/validate.py` and `VALIDATION.md`: static verification.

All UI icon geometry in this package was authored for this task. No third-party icon library is required. The app's existing font licences still apply to its Google Fonts usage.
