import { parseColor, toHex8, contrastRatio, nudgeForContrast, composite, saturate, type RGBA } from './color'
import {
  PALETTE_TOKENS, TERMINAL_COLORS, UI_FONTS, MONO_FONTS, EFFECT_KINDS, DENSITIES, MATERIALS, LIMITS,
  DEFAULT_PALETTE, DEFAULT_TERMINAL, DEFAULT_MATERIAL, ORIGINAL_THEME,
  type ThemeSpec, type EffectSpec, type MaterialSpec, type PaletteToken, type TerminalColor,
} from './spec'
import { EFFECTS } from './effects'
import { auroraColors } from './effects/aurora'

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

export interface ThemeReport {
  /** Colour values that were not colours. */
  droppedColors: number
  /** Numbers pulled back into range, or missing and defaulted. */
  clamped: number
  /** Unknown fonts, effects, densities or effect colours, and effects over the limit. */
  unknown: number
  /** Colours adjusted for readability. */
  nudged: number
}

const own = (o: unknown, k: string): unknown =>
  typeof o === 'object' && o !== null && Object.prototype.hasOwnProperty.call(o, k)
    ? (o as Record<string, unknown>)[k]
    : undefined

const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === 'string' && (list as readonly string[]).includes(v)

function emptyReport(): ThemeReport {
  return { droppedColors: 0, clamped: 0, unknown: 0, nudged: 0 }
}

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

/** Which colours must be readable on which surfaces, and how readable. */
const PALETTE_CONTRAST: Array<{ fg: PaletteToken; on: PaletteToken[]; min: number }> = [
  { fg: 'text', on: ['bg', 'bg-panel', 'bg-window', 'control-bg', 'field-bg', 'selected'], min: 4.5 },
  { fg: 'muted', on: ['bg-panel', 'bg'], min: 3 },
  { fg: 'accent', on: ['bg-panel', 'bg'], min: 3 },
  { fg: 'border', on: ['bg-panel'], min: 1.3 },
  { fg: 'danger', on: ['bg-panel'], min: 3 },
  { fg: 'success', on: ['bg-panel'], min: 3 },
  { fg: 'warning', on: ['bg-panel'], min: 3 },
  { fg: 'info', on: ['bg-panel'], min: 3 },
  { fg: 'mr-merged', on: ['bg-panel'], min: 3 },
  { fg: 'accent-contrast', on: ['accent'], min: 4.5 },
]

/** What each surface is drawn on, nearest first. */
const UNDERLAYS: Partial<Record<PaletteToken, PaletteToken[]>> = {
  'bg-panel': ['bg'],
  'control-bg': ['bg-panel', 'bg'],
  'field-bg': ['bg-panel', 'bg'],
  'selected': ['bg-panel', 'bg'],
  'accent': ['bg-panel', 'bg'],
}

/**
 * What can be behind a see-through surface: the window colour, and the window with each
 * background effect's colours painted over it at the most opaque that effect ever paints.
 */
function backdrops(spec: ThemeSpec, resolved: (t: PaletteToken) => RGBA): RGBA[] {
  const win = { ...resolved('bg-window'), a: 1 }
  const out = [win]
  for (const e of spec.effects) {
    if (e.kind === 'neon-glow' || EFFECTS[e.kind].layer !== 'back') continue
    const alpha = EFFECTS[e.kind].maxOpacity * e.intensity
    // Glass draws its background saturated (ThemeEffects), so that is what shows through.
    const token = resolved(e.color ?? 'accent')
    const base = spec.material.kind === 'glass' ? saturate(token, spec.material.saturation) : token
    const colours = e.kind === 'aurora' ? auroraColors(toHex8(base)).map((c) => parseColor(c)!) : [base]
    for (const c of colours) out.push(composite({ ...c, a: alpha * c.a }, win))
  }
  return out
}

/**
 * Every opaque colour `token` can end up looking like: itself if it is opaque, otherwise itself
 * over each thing it can sit on — the backdrop for the page-level surfaces, and the panels for the
 * controls inside them.
 */
function looks(token: PaletteToken, resolved: (t: PaletteToken) => RGBA, behind: RGBA[]): RGBA[] {
  const c = resolved(token)
  if (token === 'bg-window') return [behind[0]]
  if (c.a >= 1) return [c]
  const under = token === 'bg' ? behind
    : token === 'bg-panel' ? [...behind, ...looks('bg', resolved, behind)]
      : [...looks('bg-panel', resolved, behind), ...looks('bg', resolved, behind)]
  const seen = new Set<string>()
  return under.map((u) => composite(c, u)).filter((v) => {
    const k = toHex8(v)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/**
 * Fixes readability in place. Only a pair the theme itself touched is checked — a theme that
 * sets nothing is the original, which is readable by design, and nudging a default the theme
 * never mentioned would be changing something nobody asked about.
 *
 * On a see-through surface a colour is readable only if it is readable over everything that can
 * show through. The text is first fitted to the usual case (the surface over the window colour);
 * then any surface that still lets something unreadable through is made more opaque, step by
 * step; and only a surface that is fully opaque and still fails moves the text again.
 */
function ensureReadable(spec: ThemeSpec, report: ThemeReport): void {
  const resolved = (t: PaletteToken): RGBA => parseColor(spec.palette[t] ?? DEFAULT_PALETTE[t])!
  const behind = backdrops(spec, resolved)
  const typical = [behind[0]]
  const fails = (color: RGBA, surface: PaletteToken, min: number, under: RGBA[]): boolean =>
    looks(surface, resolved, under).some((bg) => contrastRatio(color, bg) < min)
  for (const { fg, on, min } of PALETTE_CONTRAST) {
    const touched = spec.palette[fg] !== undefined || on.some((s) => spec.palette[s] !== undefined)
    if (!touched) continue
    let color = resolved(fg)
    let changed = false
    // Two passes: a nudge for one surface can undo another when surfaces differ a lot.
    for (let pass = 0; pass < 2; pass += 1) {
      for (const surface of on) {
        for (const bg of looks(surface, resolved, typical)) {
          if (contrastRatio(color, bg) < min) { color = nudgeForContrast(color, bg, min); changed = true }
        }
      }
    }
    // Then over everything that can show through, keeping a nudge only when it leaves fewer
    // failures than before — so a colour fitted exactly to the usual backdrop gets the headroom
    // glass needs, without see-sawing between a dark backdrop and a light one.
    const failures = (c: RGBA): number =>
      on.reduce((n, surface) => n + looks(surface, resolved, behind).filter((bg) => contrastRatio(c, bg) < min).length, 0)
    for (const surface of on) {
      for (const bg of looks(surface, resolved, behind)) {
        if (contrastRatio(color, bg) >= min) continue
        const moved = nudgeForContrast(color, bg, min)
        if (failures(moved) < failures(color)) { color = moved; changed = true }
      }
    }
    if (changed) { spec.palette[fg] = toHex8(color); report.nudged += 1 }
    for (const surface of on) {
      if (!fails(color, surface, min, behind)) continue
      // Thicken the surface itself only when its own colour contrasts with the text — a white
      // wash over dark glass fails because of what is under it, and more white only makes it
      // worse. Otherwise thicken what it sits on: the panel, then the page.
      const own = resolved(surface)
      const order: PaletteToken[] = contrastRatio(color, { ...own, a: 1 }) >= min ? [surface] : []
      order.push(...UNDERLAYS[surface] ?? [])
      // Together, a step at a time: a control can sit on a panel or straight on the page, and
      // thickening one of them all the way first would make it opaque for nothing.
      const layers = order.filter((l) => spec.palette[l] !== undefined && resolved(l).a < 1)
      if (layers.length > 0) report.nudged += 1
      while (fails(color, surface, min, behind) && layers.some((l) => resolved(l).a < 1)) {
        for (const l of layers) {
          const c = resolved(l)
          spec.palette[l] = toHex8({ ...c, a: Math.min(1, c.a + 0.05) })
        }
      }
      if (fails(color, surface, min, behind)) {
        for (const bg of looks(surface, resolved, behind)) {
          if (contrastRatio(color, bg) < min) color = nudgeForContrast(color, bg, min)
        }
        spec.palette[fg] = toHex8(color)
        report.nudged += 1
      }
    }
  }
  const term = (t: TerminalColor): RGBA => parseColor(spec.terminal[t] ?? DEFAULT_TERMINAL[t])!
  if (spec.terminal.foreground !== undefined || spec.terminal.background !== undefined) {
    let fg = term('foreground')
    let bg = term('background')
    // A see-through terminal sits in the shell card, over the window: it gets the same treatment
    // as any other pane — fitted to the usual case, then thickened (itself if its own colour
    // contrasts with the text, else the panel under it), and the text moved only as a last resort.
    const shows = (): RGBA[] => (bg.a >= 1 ? [bg] : looks('bg-panel', resolved, behind).map((u) => composite(bg, u)))
    const failing = (): boolean => shows().some((b) => contrastRatio(fg, b) < 4.5)
    const usual = shows()[0]
    if (contrastRatio(fg, usual) < 4.5) { fg = nudgeForContrast(fg, usual, 4.5); spec.terminal.foreground = toHex8(fg); report.nudged += 1 }
    if (failing()) {
      report.nudged += 1
      if (contrastRatio(fg, { ...bg, a: 1 }) >= 4.5) {
        while (bg.a < 1 && failing()) bg = { ...bg, a: Math.min(1, bg.a + 0.05) }
        spec.terminal.background = toHex8(bg)
      }
      while (failing() && spec.palette['bg-panel'] !== undefined && resolved('bg-panel').a < 1) {
        const p = resolved('bg-panel')
        spec.palette['bg-panel'] = toHex8({ ...p, a: Math.min(1, p.a + 0.05) })
      }
      for (const b of shows()) if (contrastRatio(fg, b) < 4.5) fg = nudgeForContrast(fg, b, 4.5)
      spec.terminal.foreground = toHex8(fg)
    }
  }
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
