# Floating panels, and themes Claude designs from a sentence

**Status:** approved design, 2026-09-24
**Releases:** 1.21.0 (look refresh + theming engine), 1.22.0 (Claude theme generator)

## Why

Apiary looks sharp-edged next to VS Code: flush rectangles divided by 1px lines. The user wants the
VS Code look — rounded panels floating on the window background, gaps between them, and pill-shaped
grab handles in those gaps. On top of that, a theme feature unlike the usual preset gallery: the user
describes a theme in words ("like the Matrix movie", "a cool cyberpunk theme"), Claude produces it,
and the user previews, refines, saves and resets it. Claude must not be able to break the app.

## Starting point

- Every colour in `src/renderer/styles.css` already resolves through a custom property in the
  `:root` token block, and so do control heights, paddings, radii and focus rings. No rule contains
  a literal colour (the scrollbar-arrow data URIs are the documented exception).
- `TerminalView.tsx` builds the xterm palette from those same tokens (`themeFromTokens`) at mount.
- The main process already knows the user's `claude` binary (`settings.claudeBin`) and strips
  inherited session markers from children (`pty/childEnv.ts`).

## Part 1 — the look refresh (1.21.0)

- **Floating panels.** The sidebar, each editor pane (`session-column`) and the bottom shell panel
  become cards with rounded corners on a slightly darker window background (`--bg-window`), with a
  gap between them. The 1px divider lines between these regions go away; borders inside a panel
  stay.
- **Grab handles in the gaps.** Each gap *is* the resize target for its divider (sidebar↔editor,
  pane↔pane, editor↔shell). A short pill (`--handle-length` × `--handle-thickness`) is drawn centred
  in the gap on hover and stays while dragging. Hit areas never shrink below today's.
- **Softer controls.** Tabs, buttons, inputs, menus, hover cards, the notification toasts and the
  chat composer take their corners from the shape tokens. The active tab gets a rounded top edge
  and the accent as a thin inset line rather than a hard underline.
- **New tokens, nothing literal:** `--bg-window`, `--radius-panel` (default 8px), `--radius-control`
  (default 6px), `--panel-gap` (default 6px), `--handle-length`, `--handle-thickness`,
  `--handle-color`, `--handle-color-active`, `--panel-shadow`, and density tokens that scale the
  existing control heights and paddings (`--density`: 0.9 compact / 1 normal / 1.1 roomy).
- The detached window, the settings dialog and every popover use the same tokens.

## Part 2 — the theming engine (1.21.0)

### The theme spec

A theme is data, never code. `src/shared/theme/spec.ts` defines it:

```ts
interface ThemeSpec {
  version: 1
  name: string                                  // ≤ 60 chars, control chars stripped
  palette: Partial<Record<PaletteToken, string>>      // colour strings only
  terminal: Partial<Record<TerminalColor, string>>    // 16 ANSI + foreground, background, cursor, selection
  shape: { radius: number; gap: number; density: 'compact' | 'normal' | 'roomy' }
  font: { ui: UiFontId; mono: MonoFontId }
  effects: EffectSpec[]                         // at most 3
}
interface EffectSpec {
  kind: EffectKind
  color?: PaletteToken                          // a token *name*, never a raw colour
  intensity: number                             // 0–1
  speed: number                                 // 0–1
  density: number                               // 0–1
}
```

`PaletteToken` is the fixed list of existing colour tokens (surfaces, border, text, muted, accent,
accent-contrast, selected, hover, danger/success/warning/info, status and MR tones, scrollbar,
handle colours). Anything missing falls back to the built-in default.

### Validation — the security boundary

`src/shared/theme/validate.ts`: `validateTheme(input: unknown): { spec: ThemeSpec; report: ThemeReport }`.
It never throws and never returns anything it has not checked.

- **Colours:** accepted only when they match `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()`/`rgba()`
  or `hsl()`/`hsla()` with numeric arguments, and are re-serialised by Apiary as `#rrggbbaa`. Every
  other string (`url(`, `var(`, `expression(`, `javascript:`, keywords, anything else) is dropped
  and the default used.
- **Numbers:** clamped — radius 0–16px, gap 0–12px, effect intensity/speed/density 0–1. Non-numbers
  become the default.
- **Enums:** density, fonts, effect kinds and effect colour token names must be on their lists;
  otherwise default / dropped.
- **Structure:** unknown keys ignored; `__proto__`, `constructor` and `prototype` keys ignored;
  more than 3 effects truncated; input over 64KB rejected outright.
- **Readability:** after the above, `ensureContrast` checks text, muted text, accent ink and borders
  against each surface they sit on (4.5:1 for text, 3:1 for muted, borders, accent and status
  tones) and nudges the failing colour's lightness until it passes. Terminal foreground against
  terminal background likewise.
- The `ThemeReport` counts what was dropped, clamped and nudged, for the UI's one-line summary and
  for the log.

### Applying a theme

- `applyTheme(spec)` in the renderer sets an allowlisted set of custom properties on
  `document.documentElement` via `style.setProperty`, sets `data-ui-font` / `data-mono-font`
  attributes that select font stacks defined in `styles.css`, and hands `effects` to the effects
  layer. No stylesheet is injected, no HTML is rendered, no URL is loaded.
- Terminals re-read the tokens when the theme changes (a `themechange` event), not only at mount.
- The active theme is applied before first paint: main passes it to the renderer through the
  preload (`window.apiary.initialTheme`), so there is no flash of the default.
- Every window receives `themeChanged` and applies it, so windows switch together.

### Fonts

About a dozen, each either bundled (woff2 under `src/renderer/fonts/`, loaded by `@font-face` from
the app's own files) or a safe system stack. UI: system, Inter, IBM Plex Sans, Space Grotesk,
Orbitron, Rajdhani. Mono: system mono, JetBrains Mono, IBM Plex Mono, Fira Code, VT323, Share Tech
Mono. Bundled fonts carry licences compatible with redistribution (all OFL).

### Effects catalogue

One component, `ThemeEffects`, owns a single full-window canvas behind the panels plus a
`pointer-events: none` overlay above them. Each effect is a pure draw function
`(ctx, frame, params, palette) → void` in `src/renderer/theme/effects/`.

- Backgrounds (drawn behind the panels, visible in the gaps and through panel translucency):
  `digital-rain`, `perspective-grid`, `starfield`, `noise`, `gradient-drift`.
- Overlays (above the panels): `scanlines`, `crt-vignette`, `neon-glow` (a glow on the accent and
  panel edges, done with CSS `box-shadow` tokens rather than canvas), `glitch-flicker` (rare,
  subtle, never faster than 1 Hz), `paper-grain`.
- **Budget:** at most 30 fps; paused when the window is hidden or blurred for more than 30s;
  device-pixel-ratio capped at 1.5 for the canvas.
- **Motion:** no animation when the OS asks for reduced motion or the "Animated effects" setting is
  off — a single still frame is drawn instead.
- **Readability:** terminal cells and transcript text always sit on an opaque surface; overlays are
  clamped to a maximum opacity (scanlines 0.15, vignette 0.35, grain 0.08) times the global
  intensity multiplier.

### Built-in example themes (1.21.0)

Three hand-written specs that exercise the engine without Claude, and serve as few-shot examples for
the generator later: **Matrix** (green on black, digital rain, VT323/Share Tech Mono), **Neon
cyberpunk** (magenta/cyan, perspective grid, neon glow, scanlines), **Paper** (light, warm, paper
grain, generous radius). They are ordinary specs and go through `validateTheme` like any other.

### Storage

`src/main/theme/themeStore.ts` owns `<userData>/themes.json`:
`{ version: 1, activeThemeId: string | null, themes: [{ id, name, prompt, createdAt, spec }] }`.
`null` means Apiary's built-in default, which is never stored and cannot be edited. Written
atomically (temp file + rename). Every theme is re-validated on load; one that fails is dropped and
logged. Kept out of `settings.json` on purpose (see "Changing a default reaches nobody").

### Ways back

- **Reset to original** in Settings → Themes.
- **View → Reset Theme** in the native application menu, which no theme can hide or restyle.
- Holding **Shift** while Apiary starts opens that run with the original theme (nothing saved changes).
- A preview that was never kept reverts when Settings closes.

## Part 3 — the Claude generator (1.22.0)

### Running Claude

`src/main/theme/themeGenerator.ts` runs the user's `claude` (same resolution as sessions) as:

`claude -p --output-format json --model <setting, default Sonnet 5> --tools "" <prompt>`

with **no tools** (the exact disabling flags verified against the installed CLI during
implementation, and asserted by a test), cwd a fresh empty temp directory removed afterwards, env
from `childEnv`, a 90-second timeout, stdout capped at 64KB, and killed on cancel. The prompt
carries the theme schema, the allowed fonts and effects with one-line descriptions, the three
built-in themes as examples, and the user's words; for a refinement, also the current spec. The
reply's JSON is extracted (bare, fenced, or embedded in prose), then passed to `validateTheme`.
Only a validated spec crosses to the renderer.

### Flow

- **Generate** from a description → the whole app switches to a *preview*.
- **Refine** with a follow-up ("more green", "less glow") → Claude gets the current spec and the
  request and returns a complete new spec. The last 10 versions are kept; back/forward steps
  through them.
- **Keep** makes the preview the active theme; **Save as…** stores it by name; **Discard** returns
  to what was active before.
- A partly invalid reply is applied as its valid parts, with a one-line note ("2 colours adjusted
  for readability, 1 unknown effect ignored"). An unusable reply (no JSON, timeout, error exit)
  leaves the current theme untouched and shows the error.

### Logging

`theme` scope: generation started/finished with model, duration, outcome, bytes returned and the
report's counts; theme applied / reset (and by which route). **Never** the user's description or
Claude's reply — the log does not hold what the user wrote.

## Settings → Themes (UI)

1. **Current theme** — name, swatches, fonts, active effects; Reset to original, Save as…, Rename,
   Delete.
2. **Describe a theme** (1.22.0) — free text + Generate; spinner and Cancel while running.
3. **Preview bar** (1.22.0) — refine box + Refine, back/forward, Keep / Save as… / Discard, and the
   report line.
4. **My themes** — saved themes (and the built-in examples) as cards with swatches and an effect
   thumbnail; click to apply; rename, delete.
5. **Options** — Animated effects on/off, effect intensity 0–100% (a global multiplier), and
   (1.22.0) the generator model.

## Testing

- **Unit — validator (most tests, it is the boundary):** hostile colour strings (`url()`, `var()`,
  `expression()`, `javascript:`, keywords, CSS injection like `red; display:none`), prototype-pollution
  keys, unknown keys, oversized input, out-of-range numbers, unknown fonts/effects/token names, more
  than 3 effects, non-object input. Contrast: computed WCAG ratios before and after nudging.
- **Unit:** JSON extraction from Claude replies (bare, fenced, prose-wrapped, none), theme store
  (atomic write, re-validation, corrupt file), refine history, each effect's draw function runs on
  a stub context without throwing and respects the reduced-motion still-frame path.
- **Integration — generator** with a stand-in `claude` script: success, timeout, non-zero exit,
  oversized output, cancel; the spawned command line contains the no-tools flags and runs in an
  empty temp dir.
- **E2E:** the floating-panel layout and grab handles (hover shows the pill, dragging the gap
  resizes); applying a built-in theme recolours the app *and* a live terminal and survives a
  relaunch; Reset from Settings and from View → Reset Theme; animated effects off / reduced motion
  → no animation frames; (1.22.0) generate → preview → refine → keep → relaunch; discard and
  close-while-previewing revert; save/rename/delete; a malicious stand-in reply applies only its
  safe parts.
- **Live (opt-in, spends tokens):** real `claude` generates "like the Matrix movie" and "a cool
  cyberpunk theme"; both validate with zero rejections; screenshots saved for review.

## Addendum (2026-09-25) — glass material and grip handles

Requested after review: "frosted glass" produced an opaque theme because the engine had no
transparency beyond translucent chrome; the user wants macOS-style liquid glass to be possible.

- `ThemeSpec.material`: `{ kind: 'solid' | 'glass', blur 0–40 (glass ≥ 8), saturation 0.5–2,
  highlight 0–1, refraction 0–1 }`. Absent means solid (older saved themes stay valid, unreported).
- Glass floors: `bg` 0.3, `bg-panel` 0.2, `bg-terminal`/terminal background 0.55, `control-bg`
  0.06, `field-bg` 0.35; `bg-window` is always opaque. Readability is checked over every backdrop
  colour (window + background effects at their caps) and fixed by thickening panes, not by
  recolouring text, where possible. This replaces "transcript text always sits on an opaque
  surface" for glass themes only.
- Rendering: a `::before` pane per card with `backdrop-filter: blur() saturate() [url(#lens)]`,
  sheen and tint; an `::after` rim; popovers blurred at ≥ 82% tint. The lens is a fixed SVG
  displacement filter; the theme supplies only its strength.
- New background effect `aurora`, new built-in "Liquid Glass"; the generator's schema requires
  `material` and the prompt says when to choose glass.
- Handles: grip dots instead of pills; the hit area extends 3px into each neighbouring panel
  (inside the scrollbar's transparent inset); the resize cursor is held on `body` for the whole
  drag.

## Addendum (2026-09-25, 1.23.0) — glass performance, corners, default

- Measured with `tests/e2e/bench/themePerf.spec.ts`: live `backdrop-filter` panes (blur + SVG
  lens) cost ~800 ms input-to-screen without GPU compositing. Replaced by drawing the back canvas
  blurred (low resolution, scaled up) and saturated; panes are tint + sheen + rim, refraction is a
  lens-edge glow; popovers use a ≥ 94% tint. Without GPU compositing effects run at 15 fps / 1×,
  and hold during divider drags. A worker for effects was measured and rejected.
- All corner radii derive from `--radius-panel`.
- Liquid Glass is the first-run default; an existing choice (including Original) is kept.

## Out of scope

- Claude writing CSS, HTML or code of any kind (ruled out: a sanitiser cannot make that safe).
- Remote fonts, images or any network fetch by a theme.
- Per-window themes.
- Changing layout structure (what panels exist or where) — themes change how things look, not what
  is where.
