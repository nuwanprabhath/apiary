# Themes

Built-in and generated themes recolour the app and live terminals; Liquid Glass is the default for
a new install, "original" the pre-glass look the test suite uses.

## Sub-features

- Theme cards (`[data-testid="theme-card"][data-theme-id="builtin:matrix"]`, `data-active`).
- Reset (`theme-reset`), safe mode (`theme-safe-mode`), View → Reset Theme (menu id `reset-theme`).
- Effects with a back layer (`theme-effects-back`).
- All windows switch together.

## How to get to it (user POV)

Settings → Themes.

## Driving it with launchApiary

```ts
const h = await launchApiary({ realDefaultTheme: true }) // or omit for "original"
// open settings as in settings.md, then:
await h.page.getByTestId('settings-nav-themes').click()
await h.page.locator('[data-testid="theme-card"][data-theme-id="builtin:matrix"]').click()
await expect.poll(() => h.page.evaluate(() =>
  getComputedStyle(document.documentElement).getPropertyValue('--accent').trim())).toBe('#22ff5aff')
```

Proof: CSS custom properties on `:root`, a screenshot, and the theme kept after `relaunchApiary(h)`.

## Gotchas

- The harness defaults to the original theme (`APIARY_DEFAULT_THEME=original`); pass
  `realDefaultTheme: true` for what users see first.
- Liquid Glass looks different off-screen than on a real desktop wallpaper; judge glass by
  tokens, not by the screenshot alone.
