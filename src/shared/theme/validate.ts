import { parseColor, toHex8 } from './color'
import {
  PALETTE_TOKENS, TERMINAL_COLORS, UI_FONTS, MONO_FONTS, EFFECT_KINDS, DENSITIES, MATERIALS, LIMITS,
  DEFAULT_MATERIAL, ORIGINAL_THEME,
  type ThemeSpec, type EffectSpec, type MaterialSpec, type PaletteToken,
} from './spec'
import { ensureReadable, emptyReport, type ThemeReport } from './readability'

export type { ThemeReport } from './readability'

/**
 * The one way anything becomes a theme — the security boundary of the theme feature.
 *
 * Its input is untrusted by construction: a reply from Claude, a hand-edited `themes.json`, a file
 * from a future version. It never throws, and it never returns a value it has not checked:
 *
 * - Only the names on the allowlists in spec.ts are read, as own properties; everything else —
 *   unknown keys, `__proto__`, `constructor` — is never looked at, so it cannot pollute anything.
 * - Colours go through `parseColor` and come out re-serialised by Apiary; anything that is not
 *   unmistakably a colour is dropped and the default shows instead.
 * - Numbers are clamped, enums must match, at most three effects survive.
 * - Finally the result is made readable: a text colour that would not be legible on the surfaces
 *   it sits on is nudged until it is. A theme can look odd; it cannot be unreadable.
 */

const own = (o: unknown, k: string): unknown =>
  typeof o === 'object' && o !== null && Object.prototype.hasOwnProperty.call(o, k)
    ? (o as Record<string, unknown>)[k]
    : undefined

const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === 'string' && (list as readonly string[]).includes(v)

function original(): ThemeSpec {
  return structuredClone(ORIGINAL_THEME)
}

function sanitizeName(v: unknown): string {
  if (typeof v !== 'string') return 'Untitled theme'
  // eslint-disable-next-line no-control-regex
  const clean = v.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, LIMITS.maxNameChars)
  return clean === '' ? 'Untitled theme' : clean
}

function number(v: unknown, lo: number, hi: number, fallback: number, report: ThemeReport): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) { report.clamped += 1; return fallback }
  if (v < lo || v > hi) { report.clamped += 1; return Math.min(hi, Math.max(lo, v)) }
  return v
}

function colors<K extends string>(input: unknown, names: readonly K[], report: ThemeReport): Partial<Record<K, string>> {
  const out: Partial<Record<K, string>> = {}
  for (const name of names) {
    const v = own(input, name)
    if (v === undefined) continue
    const c = typeof v === 'string' ? parseColor(v) : null
    if (c === null) { report.droppedColors += 1; continue }
    out[name] = toHex8(c)
  }
  return out
}

/**
 * How see-through a surface may be. Background effects show through translucent chrome (the
 * sidebar, tab strips, toolbars), which is most of what makes a Matrix or synthwave theme feel like
 * one — but text is read on the transcript and in terminals, so on solid panels those stay solid,
 * and chrome keeps enough body that its own text stays legible.
 *
 * Glass goes further — everything but the window itself may be see-through — because glass always
 * blurs what is behind it (at least `LIMITS.glassMinBlur`), and `ensureReadable` then checks text
 * against every colour that can show through and thickens the pane wherever one would win.
 */
const MIN_ALPHA: Record<MaterialSpec['kind'], Partial<Record<PaletteToken, number>>> = {
  solid: { 'bg-window': 1, 'bg': 1, 'bg-terminal': 1, 'bg-panel': 0.6, 'control-bg': 0.6, 'field-bg': 0.85 },
  glass: { 'bg-window': 1, 'bg': 0.3, 'bg-terminal': 0.55, 'bg-panel': 0.2, 'control-bg': 0.06, 'field-bg': 0.35 },
}
const MIN_TERMINAL_ALPHA: Record<MaterialSpec['kind'], number> = { solid: 1, glass: 0.55 }

function limitAlpha(spec: ThemeSpec, report: ThemeReport): void {
  for (const [token, min] of Object.entries(MIN_ALPHA[spec.material.kind]) as Array<[PaletteToken, number]>) {
    const v = spec.palette[token]
    if (v === undefined) continue
    const c = parseColor(v)!
    if (c.a < min) { spec.palette[token] = toHex8({ ...c, a: min }); report.clamped += 1 }
  }
  const bg = spec.terminal.background
  const min = MIN_TERMINAL_ALPHA[spec.material.kind]
  if (bg !== undefined) {
    const c = parseColor(bg)!
    if (c.a < min) { spec.terminal.background = toHex8({ ...c, a: min }); report.clamped += 1 }
  }
}

function material(input: unknown, report: ThemeReport): MaterialSpec {
  if (input === undefined) return { ...DEFAULT_MATERIAL }
  const kind = own(input, 'kind')
  if (kind !== undefined && !isOneOf(MATERIALS, kind)) report.unknown += 1
  if (kind !== 'glass') return { ...DEFAULT_MATERIAL }
  let blur = number(own(input, 'blur') ?? 16, LIMITS.blur.min, LIMITS.blur.max, 16, report)
  if (blur < LIMITS.glassMinBlur) { blur = LIMITS.glassMinBlur; report.clamped += 1 }
  return {
    kind: 'glass',
    blur,
    saturation: number(own(input, 'saturation') ?? 1.4, LIMITS.saturation.min, LIMITS.saturation.max, 1.4, report),
    highlight: number(own(input, 'highlight') ?? 0.5, 0, 1, 0.5, report),
    refraction: number(own(input, 'refraction') ?? 0, 0, 1, 0, report),
  }
}

function effects(input: unknown, report: ThemeReport): EffectSpec[] {
  if (!Array.isArray(input)) return []
  const out: EffectSpec[] = []
  for (const e of input as unknown[]) {
    const kind = own(e, 'kind')
    if (!isOneOf(EFFECT_KINDS, kind)) { report.unknown += 1; continue }
    if (out.length >= LIMITS.maxEffects) { report.unknown += 1; continue }
    const effect: EffectSpec = {
      kind,
      intensity: number(own(e, 'intensity') ?? 0.5, 0, 1, 0.5, report),
      speed: number(own(e, 'speed') ?? 0.5, 0, 1, 0.5, report),
      density: number(own(e, 'density') ?? 0.5, 0, 1, 0.5, report),
    }
    const color = own(e, 'color')
    if (isOneOf(PALETTE_TOKENS, color)) effect.color = color
    else if (color !== undefined) report.unknown += 1
    out.push(effect)
  }
  return out
}

export function validateTheme(input: unknown): { spec: ThemeSpec; report: ThemeReport } {
  const report = emptyReport()
  let size = Infinity
  try { size = JSON.stringify(input)?.length ?? Infinity } catch { /* cyclic or exotic: refused */ }
  if (typeof input !== 'object' || input === null || Array.isArray(input) || size > LIMITS.maxInputChars) {
    return { spec: original(), report }
  }
  const shape = own(input, 'shape')
  const font = own(input, 'font')
  const density = own(shape, 'density')
  const ui = own(font, 'ui')
  const mono = own(font, 'mono')
  if (density !== undefined && !isOneOf(DENSITIES, density)) report.unknown += 1
  if (ui !== undefined && !isOneOf(UI_FONTS, ui)) report.unknown += 1
  if (mono !== undefined && !isOneOf(MONO_FONTS, mono)) report.unknown += 1
  const spec: ThemeSpec = {
    version: 1,
    name: sanitizeName(own(input, 'name')),
    palette: colors(own(input, 'palette'), PALETTE_TOKENS, report),
    terminal: colors(own(input, 'terminal'), TERMINAL_COLORS, report),
    shape: {
      radius: number(own(shape, 'radius') ?? ORIGINAL_THEME.shape.radius, LIMITS.radius.min, LIMITS.radius.max, ORIGINAL_THEME.shape.radius, report),
      gap: number(own(shape, 'gap') ?? ORIGINAL_THEME.shape.gap, LIMITS.gap.min, LIMITS.gap.max, ORIGINAL_THEME.shape.gap, report),
      density: isOneOf(DENSITIES, density) ? density : 'normal',
    },
    font: {
      ui: isOneOf(UI_FONTS, ui) ? ui : 'system',
      mono: isOneOf(MONO_FONTS, mono) ? mono : 'system-mono',
    },
    effects: effects(own(input, 'effects'), report),
    material: material(own(input, 'material'), report),
  }
  limitAlpha(spec, report)
  ensureReadable(spec, report)
  return { spec, report }
}

/** The one line the Themes screen shows about what validation changed, or null for nothing. */
export function describeReport(r: ThemeReport): string | null {
  const parts: string[] = []
  const n = (count: number, one: string, many: string): string => `${String(count)} ${count === 1 ? one : many}`
  if (r.nudged > 0) parts.push(`${n(r.nudged, 'colour', 'colours')} adjusted for readability`)
  if (r.droppedColors > 0) parts.push(`${n(r.droppedColors, 'invalid colour', 'invalid colours')} ignored`)
  if (r.unknown > 0) parts.push(`${n(r.unknown, 'unknown option', 'unknown options')} ignored`)
  if (r.clamped > 0) parts.push(`${n(r.clamped, 'value', 'values')} brought into range`)
  return parts.length === 0 ? null : parts.join(', ')
}
