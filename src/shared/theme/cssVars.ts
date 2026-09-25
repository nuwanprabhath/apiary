import { parseColor, toHex8 } from './color'
import { DEFAULT_PALETTE, PALETTE_TOKENS, TERMINAL_COLORS, type ThemeSpec, type TerminalColor } from './spec'

/**
 * A validated theme as CSS custom properties — the only thing a theme ever does to the page.
 *
 * Every key is drawn from a fixed list and every value is one Apiary formatted itself (a
 * `#rrggbbaa` from the validator, a pixel count, a plain number), so nothing here can carry CSS of
 * the theme's own. A token the theme leaves out produces no property at all, and the stylesheet's
 * own default shows.
 */

export const termVar = (c: TerminalColor): string =>
  `--term-${c.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`)}`

const DENSITY = { compact: '0.9', normal: '1', roomy: '1.1' } as const

export function themeToCssVars(spec: ThemeSpec): Record<string, string> {
  const out: Record<string, string> = {}
  for (const t of PALETTE_TOKENS) {
    const v = spec.palette[t]
    if (v !== undefined) out[`--${t}`] = v
  }
  for (const c of TERMINAL_COLORS) {
    const v = spec.terminal[c]
    if (v !== undefined) out[termVar(c)] = v
  }
  out['--radius-panel'] = `${String(spec.shape.radius)}px`
  // Controls a notch tighter than the panels that hold them, as VS Code draws them.
  out['--radius-control'] = `${String(Math.round(spec.shape.radius * 0.75))}px`
  out['--panel-gap'] = `${String(spec.shape.gap)}px`
  out['--density'] = DENSITY[spec.shape.density]
  // Neon glow is the one effect drawn with CSS rather than the canvas: a glow on the panels' edges.
  const glow = spec.effects.find((e) => e.kind === 'neon-glow')
  if (glow !== undefined) {
    const token = glow.color ?? 'accent'
    out['--glow-color'] = spec.palette[token] ?? DEFAULT_PALETTE[token]
    out['--glow-size'] = `${String(Math.round(4 + glow.intensity * 14))}px`
  }
  if (spec.material.kind === 'glass') Object.assign(out, glassVars(spec))
  return out
}

const white = (alpha: number): string => `rgba(255, 255, 255, ${alpha.toFixed(3)})`

/**
 * Glass as CSS: the backdrop filter's numbers, the rim and sheen the highlight asks for, and a
 * thicker tint for popovers — a menu floats over text, which its blur would turn into noise, so
 * it keeps at least 82% of its colour whatever the panels do.
 */
function glassVars(spec: ThemeSpec): Record<string, string> {
  const { blur, saturation, highlight: h } = spec.material
  const panel = parseColor(spec.palette['bg-panel'] ?? DEFAULT_PALETTE['bg-panel'])!
  return {
    '--glass-blur': `${String(Math.round(blur))}px`,
    '--glass-saturate': saturation.toFixed(2),
    '--glass-rim': [
      `inset 0 1px 0 0 ${white(0.55 * h)}`,
      `inset 0 0 0 1px ${white(0.16 * h)}`,
      `inset 0 -1px 0 0 ${white(0.06 * h)}`,
    ].join(', '),
    '--glass-sheen': `linear-gradient(135deg, ${white(0.14 * h)} 0%, ${white(0)} 36%, ${white(0)} 72%, ${white(0.05 * h)} 100%)`,
    '--bg-popover': toHex8({ ...panel, a: Math.max(panel.a, 0.82) }),
  }
}

/** Every property `themeToCssVars` can ever set — what "remove the theme" has to clear. */
export const ALL_THEME_VARS: readonly string[] = [
  ...PALETTE_TOKENS.map((t) => `--${t}`),
  ...TERMINAL_COLORS.map(termVar),
  '--radius-panel', '--radius-control', '--panel-gap', '--density', '--glow-color', '--glow-size',
  '--glass-blur', '--glass-saturate', '--glass-rim', '--glass-sheen', '--bg-popover',
]
