import { describe, it, expect } from 'vitest'
import { validateTheme, describeReport } from '../../src/shared/theme/validate'
import { contrastRatio, parseColor } from '../../src/shared/theme/color'

/**
 * The validator is the theme feature's security boundary: whatever Claude replies, or whatever
 * ends up in themes.json, only what passes here reaches the app. So these tests are mostly about
 * input nobody should send.
 */
const base = {
  version: 1, name: 'T', palette: {}, terminal: {},
  shape: { radius: 8, gap: 6, density: 'normal' }, font: { ui: 'system', mono: 'system-mono' }, effects: [],
}

describe('validateTheme — hostile input changes nothing unsafe', () => {
  it('drops colour values that are not colours', () => {
    const { spec, report } = validateTheme({
      ...base,
      palette: { bg: 'url(https://example.com/x.png)', text: 'var(--accent)', accent: 'red; display:none', border: 'expression(1)' },
    })
    expect(spec.palette).toEqual({})
    expect(report.droppedColors).toBe(4)
  })

  it('never reads unknown or prototype keys', () => {
    const evil = JSON.parse('{"__proto__":{"polluted":1},"palette":{"constructor":"#fff","notAToken":"#fff","__proto__":{"bg":"#fff"}}}') as object
    const { spec } = validateTheme({ ...base, ...evil })
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(Object.keys(spec.palette)).toEqual([])
  })

  it('clamps numbers and refuses unknown fonts, densities and effects', () => {
    const { spec, report } = validateTheme({
      ...base,
      shape: { radius: 999, gap: -5, density: 'huge' },
      font: { ui: 'Comic Sans', mono: 'vt323' },
      effects: [
        { kind: 'digital-rain', intensity: 7, speed: -1, density: 0.5, color: 'accent' },
        { kind: 'fireworks' },
        { kind: 'noise', color: '#fff' },
      ],
    })
    expect(spec.shape).toEqual({ radius: 16, gap: 0, density: 'normal' })
    expect(spec.font).toEqual({ ui: 'system', mono: 'vt323' })
    expect(spec.effects).toEqual([
      { kind: 'digital-rain', intensity: 1, speed: 0, density: 0.5, color: 'accent' },
      { kind: 'noise', intensity: 0.5, speed: 0.5, density: 0.5 },
    ])
    expect(report.clamped).toBe(4)
    expect(report.unknown).toBe(4) // density, ui font, 'fireworks', a raw colour where a token name belongs
  })

  it('treats a number that is not a number as missing', () => {
    const { spec } = validateTheme({ ...base, shape: { radius: 'Infinity', gap: Number.NaN, density: 'compact' } })
    expect(spec.shape).toEqual({ radius: 8, gap: 6, density: 'compact' })
  })

  it('keeps at most three effects', () => {
    const effects = Array.from({ length: 5 }, () => ({ kind: 'noise', intensity: 0.2, speed: 0.2, density: 0.2 }))
    expect(validateTheme({ ...base, effects }).spec.effects).toHaveLength(3)
  })

  it('returns the original theme for oversized input, non-objects and arrays', () => {
    expect(validateTheme({ ...base, name: 'y'.repeat(70_000), palette: { bg: '#000' } }).spec.palette).toEqual({})
    for (const input of [null, undefined, 'x', 42, [], [base]]) {
      expect(validateTheme(input).spec.name).toBe('Original')
    }
  })

  it('survives input that cannot even be serialised', () => {
    const cyclic: Record<string, unknown> = { ...base }
    cyclic.self = cyclic
    expect(validateTheme(cyclic).spec.name).toBe('Original')
  })

  it('strips control characters and terminal escapes from the name, and bounds its length', () => {
    const { spec } = validateTheme({ ...base, name: 'Neon\u0000\u001b[31m city' + 'z'.repeat(100) })
    expect(spec.name.startsWith('Neon city')).toBe(true)
    expect(spec.name.length).toBeLessThanOrEqual(60)
    // eslint-disable-next-line no-control-regex
    expect(spec.name).not.toMatch(/[\u0000-\u001f]/)
  })

  it('re-serialises accepted colours, so every value that reaches CSS is one Apiary wrote', () => {
    const { spec } = validateTheme({ ...base, palette: { accent: 'hsl(330, 100%, 60%)' }, terminal: { green: '#0F0' } })
    expect(spec.palette.accent).toMatch(/^#[0-9a-f]{8}$/)
    expect(spec.terminal.green).toBe('#00ff00ff')
  })
})

describe('validateTheme — readability', () => {
  it('nudges unreadable text until it passes 4.5:1 on every surface it sits on', () => {
    const { spec, report } = validateTheme({ ...base, palette: { bg: '#000000', 'bg-panel': '#050505', text: '#0a0a0a' } })
    for (const surface of ['bg', 'bg-panel'] as const) {
      expect(contrastRatio(parseColor(spec.palette.text!)!, parseColor(spec.palette[surface]!)!)).toBeGreaterThanOrEqual(4.5)
    }
    expect(report.nudged).toBeGreaterThan(0)
  })

  it('fixes a light theme too, by darkening', () => {
    const { spec } = validateTheme({ ...base, palette: { bg: '#ffffff', 'bg-panel': '#fafafa', 'bg-window': '#f0f0f0', 'control-bg': '#ffffff', 'field-bg': '#ffffff', selected: '#e8e8e8', text: '#eeeeee' } })
    expect(contrastRatio(parseColor(spec.palette.text!)!, parseColor('#fafafa')!)).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps the terminal readable', () => {
    const { spec } = validateTheme({ ...base, terminal: { background: '#001100', foreground: '#002200' } })
    expect(contrastRatio(parseColor(spec.terminal.foreground!)!, parseColor('#001100')!)).toBeGreaterThanOrEqual(4.5)
  })

  it('leaves a readable theme exactly as written', () => {
    const { spec, report } = validateTheme({ ...base, palette: { bg: '#000000', 'bg-panel': '#000000', text: '#ffffff' } })
    expect(spec.palette.text).toBe('#ffffffff')
    expect(report.nudged).toBe(0)
  })
})

 describe('validateTheme — what effects may show through', () => {
  it('keeps the transcript and terminal backgrounds solid, and chrome at least 60% opaque', () => {
    const { spec } = validateTheme({ ...base, palette: { bg: '#00000000', 'bg-terminal': '#00000080', 'bg-panel': '#10101010' }, terminal: { background: '#00000000' } })
    expect(spec.palette.bg).toBe('#000000ff')
    expect(spec.palette['bg-terminal']).toBe('#000000ff')
    expect(parseColor(spec.palette['bg-panel']!)!.a).toBeCloseTo(0.6, 2)
    expect(spec.terminal.background).toBe('#000000ff')
  })
})

describe('describeReport', () => {
  it('says what was changed, in one line, or nothing', () => {
    expect(describeReport({ droppedColors: 0, clamped: 0, unknown: 0, nudged: 0 })).toBeNull()
    expect(describeReport({ droppedColors: 1, clamped: 0, unknown: 2, nudged: 2 }))
      .toBe('2 colours adjusted for readability, 1 invalid colour ignored, 2 unknown options ignored')
  })
})
