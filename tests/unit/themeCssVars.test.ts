import { describe, it, expect } from 'vitest'
import { themeToCssVars, ALL_THEME_VARS } from '../../src/shared/theme/cssVars'
import { validateTheme } from '../../src/shared/theme/validate'
import { ORIGINAL_THEME } from '../../src/shared/theme/spec'

describe('themeToCssVars', () => {
  it('sets only allowlisted properties, with values Apiary formatted itself', () => {
    const { spec } = validateTheme({
      palette: { accent: '#ff2a6d', bg: 'rgb(13,2,33)' },
      terminal: { brightGreen: '#0f0', background: '#000' },
      shape: { radius: 12, gap: 8, density: 'roomy' },
      effects: [{ kind: 'neon-glow', intensity: 1, speed: 0, density: 0, color: 'accent' }],
    })
    const vars = themeToCssVars(spec)
    for (const [k, v] of Object.entries(vars)) {
      expect(ALL_THEME_VARS).toContain(k)
      expect(v).toMatch(/^#[0-9a-f]{8}$|^\d+px$|^[0-9.]+$/)
    }
    expect(vars['--accent']).toBe('#ff2a6dff')
    expect(vars['--term-bright-green']).toBe('#00ff00ff')
    expect(vars['--radius-panel']).toBe('12px')
    expect(vars['--radius-control']).toBe('9px')
    expect(vars['--density']).toBe('1.1')
    expect(vars['--glow-color']).toBe('#ff2a6dff')
    expect(vars['--glow-size']).toBe('18px')
  })

  it('sets no colour the theme left out, so the stylesheet default shows', () => {
    const vars = themeToCssVars(ORIGINAL_THEME)
    expect(Object.keys(vars).filter((k) => k !== '--radius-panel' && k !== '--radius-control' && k !== '--panel-gap' && k !== '--density')).toEqual([])
  })
})
