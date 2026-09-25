/**
 * What a theme is: data, never code.
 *
 * Every list here is an allowlist. A theme can only name things that appear in these lists, and
 * every value it gives is checked by `validateTheme` (validate.ts) before anything uses it. The
 * lists are also what the theme generator is told it may choose from, so adding an entry is how a
 * new colour, font or effect becomes available to themes — nothing else is needed.
 */

/** Colour tokens a theme may set — the `--name` custom properties in styles.css, without `--`. */
export const PALETTE_TOKENS = [
  'bg', 'bg-window', 'bg-panel', 'bg-terminal', 'bg-overlay',
  'border', 'text', 'muted',
  'accent', 'accent-contrast',
  'selected', 'hover',
  'danger', 'danger-soft', 'danger-bg', 'success', 'warning', 'info',
  'mr-merged',
  'control-bg', 'field-bg',
  'scrollbar-thumb', 'scrollbar-thumb-hover',
  'handle-color', 'handle-color-active',
] as const
export type PaletteToken = typeof PALETTE_TOKENS[number]

/** The terminal's palette: xterm's own names. */
export const TERMINAL_COLORS = [
  'foreground', 'background', 'cursor', 'selection',
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite',
] as const
export type TerminalColor = typeof TERMINAL_COLORS[number]

export const UI_FONTS = ['system', 'inter', 'ibm-plex-sans', 'space-grotesk', 'orbitron', 'rajdhani'] as const
export type UiFont = typeof UI_FONTS[number]
export const MONO_FONTS = ['system-mono', 'jetbrains-mono', 'ibm-plex-mono', 'fira-code', 'vt323', 'share-tech-mono'] as const
export type MonoFont = typeof MONO_FONTS[number]

export const EFFECT_KINDS = [
  'digital-rain', 'perspective-grid', 'starfield', 'noise', 'gradient-drift', 'aurora',
  'scanlines', 'crt-vignette', 'neon-glow', 'glitch-flicker', 'paper-grain',
] as const
export type EffectKind = typeof EFFECT_KINDS[number]

export const DENSITIES = ['compact', 'normal', 'roomy'] as const
export type Density = typeof DENSITIES[number]

/**
 * What the panels are made of. `solid` is paint; `glass` is a pane the window's background (and
 * its background effects) shows through, blurred — frosted glass, or with `refraction` and
 * `highlight`, the bent edges and bright rim of macOS's liquid glass. Every field is a number
 * Apiary turns into CSS itself; a theme never writes a filter.
 */
export const MATERIALS = ['solid', 'glass'] as const
export type MaterialKind = typeof MATERIALS[number]

export interface MaterialSpec {
  kind: MaterialKind
  /** Backdrop blur in px. Glass keeps at least `LIMITS.glassMinBlur`, so text never sits on a sharp backdrop. */
  blur: number
  /** Backdrop saturation multiplier: 1 is unchanged, liquid glass is about 1.8. */
  saturation: number
  /** 0–1: the bright rim and sheen along a pane's edges. */
  highlight: number
  /** 0–1: how strongly a pane's edges bend what is behind them, like the rim of a lens. */
  refraction: number
}

export interface EffectSpec {
  kind: EffectKind
  /** A palette token *name* to draw with — never a raw colour. Absent means the accent. */
  color?: PaletteToken
  intensity: number
  speed: number
  density: number
}

export interface ThemeSpec {
  version: 1
  name: string
  palette: Partial<Record<PaletteToken, string>>
  terminal: Partial<Record<TerminalColor, string>>
  shape: { radius: number; gap: number; density: Density }
  font: { ui: UiFont; mono: MonoFont }
  effects: EffectSpec[]
  material: MaterialSpec
}

export const LIMITS = {
  radius: { min: 0, max: 16 },
  gap: { min: 0, max: 12 },
  maxEffects: 3,
  blur: { min: 0, max: 40 },
  glassMinBlur: 8,
  saturation: { min: 0.5, max: 2 },
  maxInputChars: 65_536,
  maxNameChars: 60,
} as const

/**
 * The built-in look, as colours the readability check can measure against. These mirror the
 * `:root` block in styles.css; a theme that leaves a token out is measured against, and shown
 * with, this value.
 */
export const DEFAULT_PALETTE: Record<PaletteToken, string> = {
  'bg': '#1b1c1e',
  'bg-window': '#141517',
  'bg-panel': '#212327',
  'bg-terminal': '#151618',
  'bg-overlay': 'rgba(0, 0, 0, 0.55)',
  'border': '#33363b',
  'text': '#e6e6e6',
  'muted': '#9aa0a6',
  'accent': '#d9a441',
  'accent-contrast': '#1b1c1e',
  'selected': '#2f3238',
  'hover': 'rgba(90, 93, 94, 0.31)',
  'danger': '#e0736d',
  'danger-soft': 'rgba(224, 115, 109, 0.18)',
  'danger-bg': '#3a2422',
  'success': '#58c06e',
  'warning': '#e3b341',
  'info': '#6cb6ff',
  'mr-merged': '#b385f5',
  'control-bg': '#2a2d32',
  'field-bg': '#1b1c1e',
  'scrollbar-thumb': 'rgba(121, 121, 121, 0.4)',
  'scrollbar-thumb-hover': 'rgba(100, 100, 100, 0.7)',
  'handle-color': 'rgba(154, 160, 166, 0.45)',
  'handle-color-active': '#d9a441',
}

export const DEFAULT_TERMINAL: Record<TerminalColor, string> = {
  foreground: '#e6e6e6', background: '#151618', cursor: '#e6e6e6', selection: '#2f3238',
  black: '#1b1c1e', red: '#e0736d', green: '#58c06e', yellow: '#e3b341',
  blue: '#6cb6ff', magenta: '#b385f5', cyan: '#56c8d8', white: '#d0d0d0',
  brightBlack: '#6b7075', brightRed: '#ff8f88', brightGreen: '#7ee08f', brightYellow: '#f5cd6a',
  brightBlue: '#94cbff', brightMagenta: '#cda6ff', brightCyan: '#86e1ec', brightWhite: '#ffffff',
}

export const DEFAULT_MATERIAL: MaterialSpec = { kind: 'solid', blur: 0, saturation: 1, highlight: 0, refraction: 0 }

export const DEFAULT_SHAPE: ThemeSpec['shape'] = { radius: 8, gap: 6, density: 'normal' }

/** Apiary's own look. Never stored and never edited — "no theme" means this. */
export const ORIGINAL_THEME: ThemeSpec = {
  version: 1,
  name: 'Original',
  palette: {},
  terminal: {},
  shape: { ...DEFAULT_SHAPE },
  font: { ui: 'system', mono: 'system-mono' },
  effects: [],
  material: { ...DEFAULT_MATERIAL },
}
