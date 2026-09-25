# Floating Panels + Theming Engine (1.21.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Apiary VS Code-style floating rounded panels with grab handles, and a safe theming engine (validated theme specs, fonts, an effects catalogue, three built-in themes, saved themes, and ways back) — everything in the spec except the Claude generator (1.22.0).

**Architecture:** A theme is a `ThemeSpec` JSON value. `validateTheme` (shared, pure) is the only way anything becomes a spec: it parses/clamps/allowlists and fixes contrast. Main owns `themes.json` and broadcasts the active spec; the renderer turns a spec into CSS custom properties (`themeToCssVars`, pure) and effect parameters for its own `ThemeEffects` canvas. No CSS, HTML or URL ever comes from a theme.

**Tech Stack:** Electron 38, React 18, TypeScript strict, Vitest, Playwright, `@fontsource/*` (OFL fonts, bundled by Vite).

**Spec:** `docs/superpowers/specs/2026-09-24-look-and-themes-design.md`

## Global Constraints

- Branch `feature/look-and-themes`; never push it. Version becomes **1.21.0**; CHANGELOG section `## [1.21.0]`.
- No AI attribution in any commit message.
- No literal colours in `styles.css` rules — new colours are tokens in the `:root` block.
- Radius clamp 0–16px; gap clamp 0–12px; effect intensity/speed/density 0–1; at most 3 effects; theme input over 64KB rejected; name ≤ 60 chars.
- Contrast: text ≥ 4.5:1 on its surfaces; muted, borders, accent, status tones ≥ 3:1.
- Overlay opacity caps: scanlines 0.15, vignette 0.35, grain 0.08; glitch never faster than 1 Hz; ≤ 30 fps; DPR capped at 1.5; paused when hidden or blurred > 30 s; still frame under reduced motion or "Animated effects" off.
- UI fonts: `system`, `inter`, `ibm-plex-sans`, `space-grotesk`, `orbitron`, `rajdhani`. Mono fonts: `system-mono`, `jetbrains-mono`, `ibm-plex-mono`, `fira-code`, `vt323`, `share-tech-mono`.
- Effect kinds: `digital-rain`, `perspective-grid`, `starfield`, `noise`, `gradient-drift`, `scanlines`, `crt-vignette`, `neon-glow`, `glitch-flicker`, `paper-grain`.
- Ways back: Settings Reset, View → Reset Theme (native menu), Shift held at launch = original theme for that run.
- `npm test` rebuilds natives for Node, `npm run test:e2e` for Electron — never run both at once.

---

## File structure

| File | Responsibility |
|---|---|
| `src/shared/theme/color.ts` | Parse allowed colour syntaxes, serialise `#rrggbbaa`, luminance, contrast ratio, lightness nudge |
| `src/shared/theme/spec.ts` | `ThemeSpec` types, token/font/effect lists, `DEFAULT_THEME` values |
| `src/shared/theme/validate.ts` | `validateTheme(input): { spec, report }` — the security boundary |
| `src/shared/theme/cssVars.ts` | `themeToCssVars(spec): Record<string,string>` — spec → custom properties |
| `src/shared/theme/builtins.ts` | Matrix, Neon cyberpunk, Paper |
| `src/main/theme/themeStore.ts` | `themes.json`: load (re-validate), atomic save, active id, options |
| `src/renderer/theme/applyTheme.ts` | Set custom properties + font attributes on `<html>`, fire `apiary:themechange` |
| `src/renderer/theme/effects/*.ts` | One pure draw function per canvas effect |
| `src/renderer/theme/ThemeEffects.tsx` | The canvas + overlay host, frame loop, motion/visibility rules |
| `src/renderer/theme/useTheme.ts` | Subscribes to `themeChanged`, applies, exposes state |
| `src/renderer/components/ThemesSection.tsx` | Settings → Themes |
| `src/renderer/fonts.ts` | `@fontsource` imports (latin 400/700) |

---

### Task 1: Colour utilities

**Files:** Create `src/shared/theme/color.ts`; Test `tests/unit/themeColor.test.ts`

**Produces:** `parseColor(s: string): RGBA | null`, `toHex8(c: RGBA): string`, `contrastRatio(a: RGBA, b: RGBA): number`, `nudgeForContrast(fg: RGBA, bg: RGBA, min: number): RGBA`, type `RGBA = { r: number; g: number; b: number; a: number }` (r,g,b 0–255, a 0–1).

- [ ] **Step 1: failing tests**

```ts
import { describe, it, expect } from 'vitest'
import { parseColor, toHex8, contrastRatio, nudgeForContrast } from '../../src/shared/theme/color'

describe('parseColor', () => {
  it('reads the syntaxes a theme may use', () => {
    expect(toHex8(parseColor('#0f0')!)).toBe('#00ff00ff')
    expect(toHex8(parseColor('#00ff0080')!)).toBe('#00ff0080')
    expect(toHex8(parseColor('rgb(255, 0, 0)')!)).toBe('#ff0000ff')
    expect(toHex8(parseColor('rgba(0,0,255,0.5)')!)).toBe('#0000ff80')
    expect(toHex8(parseColor('hsl(120, 100%, 50%)')!)).toBe('#00ff00ff')
  })
  it('refuses everything else, however colour-like', () => {
    for (const bad of ['red', 'url(x)', 'var(--x)', 'expression(alert(1))', 'javascript:x',
      '#12', 'rgb(1,2)', 'rgb(1,2,3); display:none', '', '#ggg', 'rgb(1e999,0,0)']) {
      expect(parseColor(bad)).toBeNull()
    }
  })
})

describe('contrast', () => {
  it('computes WCAG ratios', () => {
    expect(contrastRatio(parseColor('#000')!, parseColor('#fff')!)).toBeCloseTo(21, 1)
    expect(contrastRatio(parseColor('#777')!, parseColor('#fff')!)).toBeCloseTo(4.48, 1)
  })
  it('nudges a colour until it is readable on its background', () => {
    const bg = parseColor('#000000')!
    const fixed = nudgeForContrast(parseColor('#003300')!, bg, 4.5)
    expect(contrastRatio(fixed, bg)).toBeGreaterThanOrEqual(4.5)
    // Keeps its hue: still green.
    expect(fixed.g).toBeGreaterThan(fixed.r)
  })
})
```

- [ ] **Step 2:** `npx vitest run tests/unit/themeColor.test.ts` → FAIL (module missing).
- [ ] **Step 3: implement** — strict regexes per syntax (numbers only, `%` where CSS allows), clamp channels, reject non-finite; HSL→RGB; luminance per WCAG 2.x (`c<=0.03928 ? c/12.92 : ((c+0.055)/1.055)^2.4`); `nudgeForContrast` converts to HSL and steps lightness by 2% toward white when `bg` luminance < 0.5 else toward black, until the ratio passes or lightness hits 0/100 (then returns pure white/black). Alpha is composited over `bg` before measuring.
- [ ] **Step 4:** run → PASS.
- [ ] **Step 5:** commit `feat(theme): colour parsing and contrast`.

### Task 2: Theme spec and validator

**Files:** Create `src/shared/theme/spec.ts`, `src/shared/theme/validate.ts`; Test `tests/unit/themeValidate.test.ts`

**Consumes:** Task 1.
**Produces:**
```ts
export const PALETTE_TOKENS: readonly string[]      // names without "--", e.g. 'bg', 'bg-window', 'text', 'accent', …
export type PaletteToken = typeof PALETTE_TOKENS[number]
export const TERMINAL_COLORS: readonly string[]      // 'foreground','background','cursor','selection','black',…,'brightWhite'
export const UI_FONTS, MONO_FONTS, EFFECT_KINDS       // the Global Constraints lists
export interface EffectSpec { kind: EffectKind; color?: PaletteToken; intensity: number; speed: number; density: number }
export interface ThemeSpec { version: 1; name: string; palette: Partial<Record<PaletteToken,string>>; terminal: Partial<Record<TerminalColor,string>>; shape: { radius: number; gap: number; density: 'compact'|'normal'|'roomy' }; font: { ui: UiFont; mono: MonoFont }; effects: EffectSpec[] }
export const DEFAULT_PALETTE: Record<PaletteToken, string>   // today's :root values
export const DEFAULT_SHAPE = { radius: 8, gap: 6, density: 'normal' }
export interface ThemeReport { droppedColors: number; clamped: number; unknown: number; nudged: number }
export function validateTheme(input: unknown): { spec: ThemeSpec; report: ThemeReport }
export function describeReport(r: ThemeReport): string | null   // "2 colours adjusted for readability, 1 unknown effect ignored"
```

- [ ] **Step 1: failing tests** — each a behaviour statement:

```ts
import { describe, it, expect } from 'vitest'
import { validateTheme, DEFAULT_PALETTE } from '../../src/shared/theme/spec'  // validate re-exported
import { contrastRatio, parseColor } from '../../src/shared/theme/color'

const base = { version: 1, name: 'T', palette: {}, terminal: {}, shape: { radius: 8, gap: 6, density: 'normal' }, font: { ui: 'system', mono: 'system-mono' }, effects: [] }

describe('validateTheme — hostile input changes nothing unsafe', () => {
  it('drops colour values that are not colours', () => {
    const { spec, report } = validateTheme({ ...base, palette: { bg: 'url(https://x/y.png)', text: 'var(--accent)', accent: 'red; display:none', border: 'expression(1)' } })
    expect(spec.palette.bg).toBeUndefined(); expect(spec.palette.text).toBeUndefined()
    expect(spec.palette.accent).toBeUndefined(); expect(spec.palette.border).toBeUndefined()
    expect(report.droppedColors).toBe(4)
  })
  it('ignores unknown and prototype keys', () => {
    const evil = JSON.parse('{"__proto__":{"polluted":1},"palette":{"constructor":"#fff","notAToken":"#fff"}}')
    const { spec } = validateTheme({ ...base, ...evil })
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(Object.keys(spec.palette)).toEqual([])
  })
  it('clamps numbers and refuses unknown fonts and effects', () => {
    const { spec } = validateTheme({ ...base, shape: { radius: 999, gap: -5, density: 'huge' }, font: { ui: 'Comic Sans', mono: 'vt323' },
      effects: [{ kind: 'digital-rain', intensity: 7, speed: -1, density: 0.5, color: 'accent' }, { kind: 'fireworks' }, { kind: 'noise', color: '#fff' }] })
    expect(spec.shape).toEqual({ radius: 16, gap: 0, density: 'normal' })
    expect(spec.font).toEqual({ ui: 'system', mono: 'vt323' })
    expect(spec.effects).toEqual([{ kind: 'digital-rain', intensity: 1, speed: 0, density: 0.5, color: 'accent' }, { kind: 'noise', intensity: 0.5, speed: 0.5, density: 0.5 }])
  })
  it('keeps at most three effects', () => {
    const effects = Array.from({ length: 5 }, () => ({ kind: 'noise', intensity: 0.2, speed: 0.2, density: 0.2 }))
    expect(validateTheme({ ...base, effects }).spec.effects).toHaveLength(3)
  })
  it('rejects oversized input and non-objects outright, returning the default theme', () => {
    expect(validateTheme('x'.repeat(70_000)).spec.palette).toEqual({})
    expect(validateTheme(null).spec.name).toBe('Original')
    expect(validateTheme({ ...base, name: 'y'.repeat(70_000) }).spec.palette).toEqual({})
  })
  it('strips control characters from the name and bounds its length', () => {
    expect(validateTheme({ ...base, name: 'Neon\u0000\u001b[31m' + 'z'.repeat(100) }).spec.name.length).toBeLessThanOrEqual(60)
  })
})

describe('validateTheme — readability', () => {
  it('nudges unreadable text until it passes 4.5:1 on its surfaces', () => {
    const { spec, report } = validateTheme({ ...base, palette: { bg: '#000000', 'bg-panel': '#050505', text: '#0a0a0a' } })
    for (const surface of ['bg', 'bg-panel'] as const) {
      expect(contrastRatio(parseColor(spec.palette.text!)!, parseColor(spec.palette[surface]!)!)).toBeGreaterThanOrEqual(4.5)
    }
    expect(report.nudged).toBeGreaterThan(0)
  })
  it('leaves a readable theme exactly as written', () => {
    const { spec, report } = validateTheme({ ...base, palette: { bg: '#000000', text: '#ffffff' } })
    expect(spec.palette.text).toBe('#ffffffff'); expect(report.nudged).toBe(0)
  })
})
```

- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: implement** — `validate.ts`: size gate `JSON.stringify(input).length > 65536` (wrapped in try) → default; own-property iteration only over the allowlisted names (never `for…in` over input); colours through `parseColor`→`toHex8`; numbers `Number.isFinite` then clamp; name sanitised like `sanitizeTitle`; effects missing numeric fields get 0.5. Contrast pairs (resolved palette = defaults ⊕ spec): text vs `bg`,`bg-panel`,`bg-window`,`control-bg`,`field-bg` (4.5); `muted`,`border`,`accent`,`danger`,`success`,`warning`,`info` vs `bg-panel` (3); `accent-contrast` vs `accent` (4.5); terminal foreground vs terminal background (4.5). A nudged colour is written into `spec.palette` even if the input omitted it only when the *spec's own* colours caused the failure. `DEFAULT_THEME` name is `'Original'`.
- [ ] **Step 4:** run → PASS. Also `npm run typecheck`.
- [ ] **Step 5:** commit `feat(theme): theme spec and the validator that guards it`.

### Task 3: Floating panels and grab handles (look refresh)

**Files:** Modify `src/renderer/styles.css` (token block; `.layout`, `.sidebar`, `.sidebar-rail`, `.sidebar-resizer`, `.content`, `.session-column`, `.column-resizer`/`.row-resizer`, `.bottom-resizer`, `.session-tab-bar`/`.session-tab`, popovers, notifications, composer), `src/renderer/App.tsx` (grid template: gap column width = `var(--panel-gap)`), `src/renderer/components/SessionColumn.tsx` (wrap the session area and the shell area as two cards), `src/renderer/components/PaneDividers.tsx` (handles centred in the gap); Test `tests/e2e/lookAndFeel.spec.ts`.

**Produces tokens:** `--bg-window`, `--radius-panel`, `--radius-control`, `--panel-gap`, `--handle-length: 28px`, `--handle-thickness: 4px`, `--handle-color`, `--handle-color-active`, `--panel-shadow`, `--density: 1`. Existing `--radius` becomes `var(--radius-control)`; `--control-height`/paddings multiply by `--density` via `calc()`.

- [ ] **Step 1: failing e2e** — `tests/e2e/lookAndFeel.spec.ts`:
  - panels float: `.sidebar`, `.session-column .session-card`, `.session-column .shell-card` each have computed `border-top-left-radius` ≥ 6px and are separated from their neighbour by ≥ 4px (compare bounding rects);
  - no divider line: `.sidebar` computed `border-right-width` is `0px`;
  - grab handle: hovering `[data-testid="sidebar-resizer"]` makes its `::after` pill visible (`getComputedStyle(el, '::after').opacity === '1'`), and dragging it by +60px widens the sidebar by ~60px; same pill check for `bottom-resizer` and `column-resizer` (open a split);
  - screenshot to the scratchpad for visual review.
- [ ] **Step 2:** `npm run test:e2e -- tests/e2e/lookAndFeel.spec.ts` → FAIL.
- [ ] **Step 3: implement.** `body`/`.layout` background `var(--bg-window)`, `.layout { padding: var(--panel-gap); }` and grid gap handled by the resizer tracks; `.sidebar`, `.sidebar-rail`, `.session-card`, `.shell-card` get `background: var(--bg-panel); border-radius: var(--radius-panel); box-shadow: var(--panel-shadow); overflow: hidden;` and lose their outer borders; `.content { gap: var(--panel-gap) }` with PaneDividers positioned in the gap centre (`calc()` against the gap); resizers become transparent tracks the width of the gap with a centred `::after` pill (`opacity: 0` → `1` on `:hover`/`:active`/`[data-dragging]`, colour `--handle-color` / `--handle-color-active`); tab strip: tabs `border-radius: var(--radius-control) var(--radius-control) 0 0`, active tab inset accent line via `box-shadow: inset 0 2px 0 var(--accent)`; popovers/menus/hover cards/notifications/composer use `--radius-panel`. Keep every existing `data-testid` and minimum hit area (≥ 4px track, pill only visual).
- [ ] **Step 4:** run the new spec plus `sidebar*`, `paneLayouts`, `terminal`, `sessionTabs`, `detachTab` specs → PASS. Look at the screenshot.
- [ ] **Step 5:** commit `feat(ui): floating rounded panels with grab handles`.

### Task 4: Applying a theme (tokens, fonts, terminal)

**Files:** Create `src/shared/theme/cssVars.ts`, `src/renderer/theme/applyTheme.ts`, `src/renderer/fonts.ts`; Modify `src/renderer/styles.css` (font stacks per `data-ui-font`/`data-mono-font`), `src/renderer/components/TerminalView.tsx` (re-theme on `apiary:themechange`, full 16-colour palette from `--term-*` tokens), `src/renderer/main.tsx` (import fonts), `package.json` (`@fontsource/*` deps); Test `tests/unit/themeCssVars.test.ts`.

**Produces:** `themeToCssVars(spec: ThemeSpec): Record<string, string>` (keys like `--accent`, `--term-bright-green`, `--radius-panel`, `--panel-gap`, `--density`, `--glow-accent`); `applyTheme(spec: ThemeSpec | null): void` (null = remove every property it ever set, clear font attributes) dispatching `window` event `apiary:themechange`.

- [ ] **Step 1: failing unit test** — output keys are exactly the allowlist (`PALETTE_TOKENS` + `TERMINAL_COLORS` mapped + shape/density/glow keys), every value matches `/^#[0-9a-f]{8}$|^\d+(\.\d+)?px$|^[0-9.]+$/`, and a palette omission yields no key (so the stylesheet default applies).
- [ ] **Step 2:** run → FAIL.  **Step 3:** implement; add `--term-*` defaults to the `:root` block and `themeFromTokens` reads all 16; `TerminalView` listens for `apiary:themechange` and sets `term.options.theme = themeFromTokens()`; install `@fontsource/{inter,ibm-plex-sans,space-grotesk,orbitron,rajdhani,jetbrains-mono,ibm-plex-mono,fira-code,vt323,share-tech-mono}` and import only `latin-400.css`/`latin-700.css` where offered.
- [ ] **Step 4:** unit PASS; typecheck; build.  **Step 5:** commit `feat(theme): apply a theme through tokens, fonts and the terminal palette`.

### Task 5: Effects catalogue

**Files:** Create `src/renderer/theme/effects/{digitalRain,perspectiveGrid,starfield,noise,gradientDrift,scanlines,crtVignette,glitchFlicker,paperGrain}.ts`, `src/renderer/theme/effects/index.ts`, `src/renderer/theme/ThemeEffects.tsx`; Modify `src/renderer/App.tsx` (mount `<ThemeEffects>` once per window), `styles.css` (`.theme-effects-back` z-index below panels, `.theme-effects-front` above, both `pointer-events:none`; `neon-glow` via `--glow-accent` box-shadow token on panels); Test `tests/unit/themeEffects.test.ts`.

**Produces:** `type DrawFn = (ctx: CanvasRenderingContext2D, f: { t: number; w: number; h: number; still: boolean }, p: { intensity: number; speed: number; density: number; color: string }) => void`; `EFFECTS: Record<Exclude<EffectKind,'neon-glow'>, { layer: 'back' | 'front'; draw: DrawFn; maxOpacity: number }>`; `<ThemeEffects effects={EffectSpec[]} animated={boolean} intensity={number} palette={Record<string,string>} />`.

- [ ] **Step 1: failing unit tests** — for every entry: draw 3 frames on a recording stub context (all methods are no-op spies; `globalAlpha` setter records values) without throwing, at w/h 0 and 1920×1080; the maximum `globalAlpha` ever set ≤ `maxOpacity × intensity`; `still: true` draws deterministic output (two calls, same recorded ops); `glitchFlicker` is visible in at most 1 of every 30 frames at speed 1.
- [ ] **Step 2:** FAIL.  **Step 3:** implement draw functions (deterministic seeded PRNG, no allocation per frame beyond small arrays); `ThemeEffects` owns two canvases, runs `requestAnimationFrame` throttled to 30 fps, DPR `min(devicePixelRatio, 1.5)`, stops on `document.hidden` or 30 s after `blur`, draws one still frame when `!animated` or `matchMedia('(prefers-reduced-motion: reduce)').matches`, and draws nothing when `effects` is empty (canvases unmounted).
- [ ] **Step 4:** PASS.  **Step 5:** commit `feat(theme): effects catalogue drawn by Apiary's own canvas`.

### Task 6: Built-in themes

**Files:** Create `src/shared/theme/builtins.ts`; Test `tests/unit/themeBuiltins.test.ts`.

**Produces:** `BUILTIN_THEMES: Array<{ id: 'builtin:matrix' | 'builtin:neon' | 'builtin:paper'; spec: ThemeSpec }>`.

- [ ] **Step 1: failing test** — each builtin passes `validateTheme` with a report of all zeros and an identical spec (they are the generator's future examples, so they must be exemplary).
- [ ] **Step 2:** FAIL.  **Step 3:** write the three specs — Matrix (bg ~#020a04, text #b6ffb9, accent #22ff5a, vt323/share-tech-mono, digital-rain back + scanlines front, radius 4); Neon cyberpunk (bg #0d0221, accent #ff2a6d, info #05d9e8, orbitron/jetbrains-mono, perspective-grid + neon-glow + scanlines, radius 10); Paper (light: bg #f4efe4, text #2b2620, accent #b5542d, ibm-plex-sans/ibm-plex-mono, paper-grain, radius 12, roomy). Full terminal palettes.
- [ ] **Step 4:** PASS.  **Step 5:** commit `feat(theme): Matrix, Neon cyberpunk and Paper built-in themes`.

### Task 7: Theme store, IPC, and the ways back

**Files:** Create `src/main/theme/themeStore.ts`; Modify `src/shared/api.ts`, `src/preload/index.ts`, `src/main/ipc.ts`, `src/main/index.ts` (Shift-at-launch, store construction, initial theme), `src/main/menu.ts` (View → Reset Theme); Test `tests/integration/themeStore.test.ts`.

**Produces:**
```ts
interface SavedTheme { id: string; name: string; prompt: string | null; createdAt: number; spec: ThemeSpec }
interface ThemeState { activeId: string | null; active: ThemeSpec | null; saved: SavedTheme[]; builtins: { id: string; spec: ThemeSpec }[]; options: { animated: boolean; intensity: number }; safeMode: boolean }
// window.apiary
themeState(): Promise<ThemeState>
themeApply(id: string | null): Promise<void>                // builtin:*, a saved id, or null = original
themeSave(name: string, spec: unknown): Promise<SavedTheme>  // validated in main
themeRename(id: string, name: string): Promise<void>
themeDelete(id: string): Promise<void>
themeSetOptions(o: Partial<{ animated: boolean; intensity: number }>): Promise<void>
onThemeChanged(cb: (s: ThemeState) => void): () => void
initialTheme: ThemeState                                   // sendSync from preload, before first paint
```
Store file `<userData>/themes.json` `{ version: 1, activeThemeId, themes, options }`, written temp+rename; load re-validates every theme (drop + `log.warn('theme','dropped invalid saved theme')`), unknown active id → null. Safe mode (`Shift` held at `app.whenReady` via `globalShortcut`-free check: `process.env.APIARY_SAFE_THEME === '1'` for tests, and on macOS/Linux reading modifier state is not available in main — use a renderer-side check instead: preload reads `ipcRenderer.sendSync` and the renderer checks `event.shiftKey` is impossible before input; **decision:** safe mode = env `APIARY_SAFE_THEME=1` *or* holding Shift detected by the first window's `before-input-event` within 1.5 s of launch, which re-applies original for the run). View → Reset Theme calls `store.setActive(null)` and broadcasts.

- [ ] **Step 1: failing integration tests** — save→load round trip; a hand-corrupted file (invalid JSON) loads as empty without throwing and is not overwritten until a change; an invalid saved theme is dropped and valid ones kept; a hostile saved spec is re-validated on load (e.g. `url()` colour gone); delete of the active theme resets active to null; atomic write leaves no temp file.
- [ ] **Step 2:** FAIL.  **Step 3:** implement store + IPC + preload + menu + broadcast `themeChanged` to all windows; `useTheme` hook applies `initialTheme` synchronously in `main.tsx` before `createRoot().render`.
- [ ] **Step 4:** PASS; typecheck.  **Step 5:** commit `feat(theme): saved themes, broadcast to every window, with a reset no theme can hide`.

### Task 8: Settings → Themes

**Files:** Create `src/renderer/components/ThemesSection.tsx`; Modify `src/renderer/components/SettingsDialog.tsx` (section `{ id: 'themes', label: 'Themes' }`), `styles.css`; Test `tests/e2e/themes.spec.ts`.

UI (1.21.0 scope): Current theme (name, swatches, fonts, effect names, Reset to original, Save as…, Rename, Delete where applicable); Themes grid (Original + builtins + saved, each a card with swatches and effect label, click applies, active marked, rename/delete for saved); Options (Animated effects checkbox, Effect intensity range 0–100). Test ids: `theme-card`, `theme-card-active`, `theme-reset`, `theme-save-as`, `theme-save-name`, `theme-rename`, `theme-delete`, `theme-animated`, `theme-intensity`.

- [ ] **Step 1: failing e2e** —
  - applying Matrix recolours the app (`--accent` on `<html>` changes; a shell terminal's xterm background changes) and survives `relaunchApiary`;
  - Reset to original restores; View → Reset Theme (invoke the menu item via `app.evaluate` `Menu.getApplicationMenu().getMenuItemById('reset-theme').click()`) restores;
  - Save as "My matrix" from Matrix → card appears; rename; delete;
  - a second window switches with the first;
  - `APIARY_SAFE_THEME=1` launch shows Original while the saved active theme is untouched;
  - animated off → the effects canvas records no new frames over 1 s (expose `data-frames` counter on the canvas);
  - a hostile `themes.json` written before launch (colour `url(...)`, effect `fireworks`) is applied only as its safe parts.
- [ ] **Step 2:** FAIL.  **Step 3:** implement.  **Step 4:** PASS + screenshots of each builtin for review.  **Step 5:** commit `feat(theme): Settings → Themes`.

### Task 9: Release prep

- [ ] `npm version 1.21.0 --no-git-tag-version`; CHANGELOG `## [1.21.0]` (Added: floating panels; themes engine with three built-ins, saved themes, effects; ways back); CLAUDE.md section "Themes" (the validator is the boundary; never inject CSS; tokens only; effects rules).
- [ ] Full verification: `npm run typecheck`, `npm test`, then `npm run test:e2e`; review screenshots.
- [ ] Commit `chore: 1.21.0`; ledger updated; stop and ask before merge/tag/release.

---

## Self-review

- Spec coverage: Part 1 → Task 3; spec/validation → 1–2; applying/fonts/terminal → 4; effects → 5; builtins → 6; storage/broadcast/first paint/ways back → 7; Settings UI (1.21.0 subset) → 8; logging (theme applied/reset route, dropped saved themes) → 7; generator, refine, describe box, model option → deferred to the 1.22.0 plan by design.
- Safe-mode Shift detection is decided in Task 7 (env var for tests + first-window `before-input-event` Shift within 1.5 s).
- Names consistent: `validateTheme`, `themeToCssVars`, `applyTheme`, `ThemeEffects`, `ThemeState`, `BUILTIN_THEMES`, `apiary:themechange`.
