import { describe, it, expect } from 'vitest'
import { validateTheme } from '../../src/shared/theme/validate'
import { themeToCssVars, ALL_THEME_VARS } from '../../src/shared/theme/cssVars'
import { THEME_JSON_SCHEMA, buildThemePrompt } from '../../src/shared/theme/prompt'
import { auroraColors } from '../../src/shared/theme/effects/aurora'
import { parseColor, contrastRatio, composite } from '../../src/shared/theme/color'

/**
 * Glass: see-through panels over the window and its background effects. It loosens how
 * transparent a surface may be, so the readability guarantee has to hold over whatever can show
 * through — and the material's numbers are as untrusted as any other part of a theme.
 */
const base = {
  version: 1, name: 'T', palette: {}, terminal: {},
  shape: { radius: 8, gap: 6, density: 'normal' }, font: { ui: 'system', mono: 'system-mono' }, effects: [],
}
const glass = { kind: 'glass', blur: 20, saturation: 1.6, highlight: 0.8, refraction: 0.5 }
const alpha = (hex: string | undefined): number => parseColor(hex!)!.a

describe('material — validated like everything else', () => {
  it('is solid when a theme says nothing, without reporting anything (themes saved before glass existed)', () => {
    const { spec, report } = validateTheme(base)
    expect(spec.material).toEqual({ kind: 'solid', blur: 0, saturation: 1, highlight: 0, refraction: 0 })
    expect(report).toEqual({ droppedColors: 0, clamped: 0, unknown: 0, nudged: 0 })
  })

  it('keeps a glass material as given when it is in range', () => {
    expect(validateTheme({ ...base, material: glass }).spec.material).toEqual(glass)
  })

  it('never lets glass go unblurred, and clamps the rest', () => {
    const { spec, report } = validateTheme({ ...base, material: { kind: 'glass', blur: 0, saturation: 9, highlight: -1, refraction: 7 } })
    expect(spec.material).toEqual({ kind: 'glass', blur: 8, saturation: 2, highlight: 0, refraction: 1 })
    expect(report.clamped).toBe(4)
  })

  it('refuses unknown kinds and non-numbers', () => {
    const odd = validateTheme({ ...base, material: { kind: 'liquid; backdrop-filter:url(x)' } })
    expect(odd.spec.material.kind).toBe('solid')
    expect(odd.report.unknown).toBe(1)
    const strings = validateTheme({ ...base, material: { kind: 'glass', blur: '20px', saturation: 'url(#x)', highlight: null, refraction: NaN } })
    expect(strings.spec.material).toEqual({ kind: 'glass', blur: 16, saturation: 1.4, highlight: 0.5, refraction: 0 })
  })

  it('ignores prototype keys inside the material', () => {
    const input = JSON.parse('{"kind":"glass","blur":20,"__proto__":{"polluted":true}}') as unknown
    validateTheme({ ...base, material: input })
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
})

describe('transparency — what glass allows and solid does not', () => {
  const see = { bg: '#10162a4d', 'bg-panel': '#1a203833', 'bg-terminal': '#0a0e1e66', 'bg-window': '#0b102680' }

  it('solid keeps the page and terminal opaque', () => {
    const { spec } = validateTheme({ ...base, palette: see, terminal: { background: '#0a0e1e66' } })
    expect(alpha(spec.palette.bg)).toBe(1)
    expect(alpha(spec.palette['bg-terminal'])).toBe(1)
    expect(alpha(spec.terminal.background)).toBe(1)
  })

  it('glass lets them through, but never the window itself', () => {
    const { spec } = validateTheme({ ...base, palette: see, terminal: { background: '#0a0e1e66' }, material: glass })
    expect(alpha(spec.palette.bg)).toBeLessThan(1)
    expect(alpha(spec.palette['bg-panel'])).toBeLessThan(1)
    expect(alpha(spec.palette['bg-terminal'])).toBeLessThan(1)
    expect(alpha(spec.palette['bg-window'])).toBe(1)
  })
})

describe('readability through glass', () => {
  it('thickens a pane until its text reads over the brightest thing behind it', () => {
    const input = {
      ...base,
      palette: { 'bg-window': '#0b1026ff', 'bg-panel': '#1a203833', bg: '#10162a4d', text: '#ffffffff' },
      effects: [{ kind: 'aurora', color: 'text', intensity: 1, speed: 0.3, density: 0.5 }],
      material: glass,
    }
    const { spec, report } = validateTheme(input)
    expect(report.nudged).toBeGreaterThan(0)
    // The text stayed white: the pane moved, not the text.
    expect(spec.palette.text).toBe('#ffffffff')
    const panel = parseColor(spec.palette['bg-panel']!)!
    expect(panel.a).toBeGreaterThan(0.2)
    // Over the window washed with the brightest aurora colour, white text still reads.
    const win = parseColor('#0b1026ff')!
    const text = parseColor(spec.palette.text!)!
    for (const c of auroraColors('#ffffffff')) {
      const behind = composite({ ...parseColor(c)!, a: 0.85 }, win)
      expect(contrastRatio(text, composite(panel, behind))).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('does not paint a light wash solid to fix what is under it', () => {
    const { spec } = validateTheme({
      ...base,
      palette: { 'bg-window': '#0b1026ff', 'bg-panel': '#1a203840', bg: '#10162a50', text: '#ffffffff', 'control-bg': '#ffffff1f' },
      effects: [{ kind: 'aurora', color: 'accent', intensity: 0.9, speed: 0.3, density: 0.5 }],
      material: glass,
    })
    expect(alpha(spec.palette['control-bg'])).toBeLessThan(0.5)
    expect(spec.palette.text).toBe('#ffffffff')
  })

  it('keeps light frosted glass see-through, deepening borderline colours instead (a real Claude reply)', () => {
    const palette = {
      'bg-window': '#e9edf4ff', 'bg': '#f4f6fa80', 'bg-panel': '#ffffff73', 'border': '#ffffff8a',
      'text': '#1c2333ff', 'muted': '#5c6579ff', 'accent': '#5b7fdbff', 'accent-contrast': '#f7f9fdff',
      'selected': '#5b7fdb2e', 'control-bg': '#ffffff4d', 'field-bg': '#ffffff59',
      'success': '#2f9e6aff', 'warning': '#c98a1eff', 'danger': '#d9564cff', 'info': '#3f8fd6ff', 'mr-merged': '#8a6fd6ff',
    }
    const { spec } = validateTheme({
      ...base, palette,
      effects: [
        { kind: 'aurora', color: 'accent', intensity: 0.5, speed: 0.25, density: 0.5 },
        { kind: 'gradient-drift', color: 'info', intensity: 0.35, speed: 0.2, density: 0.4 },
      ],
      material: { kind: 'glass', blur: 26, saturation: 1.4, highlight: 0.5, refraction: 0 },
    })
    expect(spec.palette.bg).toBe(palette.bg)
    expect(spec.palette['bg-panel']).toBe(palette['bg-panel'])
    expect(spec.palette.text).toBe(palette.text)
    // Warning was exactly borderline on white: it deepens so it reads over the tinted glass too.
    expect(contrastRatio(parseColor(spec.palette.warning!)!, parseColor('#ffffffff')!)).toBeGreaterThan(3.2)
  })

  it('keeps terminal text readable on a see-through terminal', () => {
    const { spec } = validateTheme({
      ...base,
      palette: { 'bg-window': '#0b1026ff', 'bg-panel': '#1a203840' },
      terminal: { foreground: '#ffffffff', background: '#ffffff26' },
      effects: [{ kind: 'aurora', color: 'accent', intensity: 1, speed: 0.3, density: 0.5 }],
      material: glass,
    })
    const bg = parseColor(spec.terminal.background!)!
    const fg = parseColor(spec.terminal.foreground!)!
    const card = composite(parseColor(spec.palette['bg-panel']!)!, parseColor('#0b1026ff')!)
    expect(contrastRatio(fg, composite(bg, card))).toBeGreaterThanOrEqual(4.5)
  })
})

describe('glass as CSS', () => {
  it('sets the filter numbers, rim, sheen and a thicker popover tint — all formatted by Apiary', () => {
    const { spec } = validateTheme({ ...base, palette: { 'bg-panel': '#1a203866' }, material: glass })
    const vars = themeToCssVars(spec)
    expect(vars['--glass-blur']).toBe('20px')
    expect(vars['--glass-saturate']).toBe('1.60')
    expect(vars['--glass-rim']).toMatch(/^inset 0 1px 0 0 rgba\(255, 255, 255, [\d.]+\)/)
    expect(vars['--glass-sheen']).toMatch(/^linear-gradient\(135deg, rgba/)
    expect(alpha(vars['--bg-popover'])).toBeGreaterThanOrEqual(0.81)
    for (const k of Object.keys(vars)) expect(ALL_THEME_VARS).toContain(k)
  })

  it('sets none of it for a solid theme', () => {
    const vars = themeToCssVars(validateTheme(base).spec)
    expect(Object.keys(vars).filter((k) => k.startsWith('--glass') || k === '--bg-popover')).toEqual([])
  })
})

describe('aurora and the generator', () => {
  it('aurora paints four opaque colours round the wheel from its own', () => {
    const colors = auroraColors('#7cc4ffff')
    expect(colors).toHaveLength(4)
    expect(colors[0]).toBe('#7cc4ffff')
    expect(new Set(colors).size).toBe(4)
  })

  it('asks Claude for a material, with the same limits the validator enforces', () => {
    const material = THEME_JSON_SCHEMA.properties.material
    expect(THEME_JSON_SCHEMA.required).toContain('material')
    expect(material.properties.kind.enum).toEqual(['solid', 'glass'])
    expect(material.properties.blur.maximum).toBe(40)
    const prompt = buildThemePrompt({ request: 'macOS liquid glass', current: null })
    expect(prompt).toContain('liquid glass')
    expect(prompt).toContain('"kind":"glass"')
  })
})
