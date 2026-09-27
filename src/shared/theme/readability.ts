import { parseColor, toHex8, contrastRatio, nudgeForContrast, composite, saturate, type RGBA } from './color'
import { DEFAULT_PALETTE, DEFAULT_TERMINAL, type ThemeSpec, type PaletteToken, type TerminalColor } from './spec'
import { EFFECTS } from './effects'
import { auroraColors } from './effects/aurora'

/**
 * `validateTheme`'s readability pass, split out of `validate.ts` (SHARED-8) so the security
 * boundary file — reading untrusted input and deciding what a theme is allowed to contain — stays
 * short enough to review on its own. Everything here runs only on a spec that has already been
 * through the rest of validation; it never sees raw untrusted input.
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

export function emptyReport(): ThemeReport {
  return { droppedColors: 0, clamped: 0, unknown: 0, nudged: 0 }
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
export function ensureReadable(spec: ThemeSpec, report: ThemeReport): void {
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
