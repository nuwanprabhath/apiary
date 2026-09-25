import { describe, it, expect } from 'vitest'
import { parseColor, toHex8, contrastRatio, nudgeForContrast } from '../../src/shared/theme/color'

describe('parseColor', () => {
  it('reads the syntaxes a theme may use', () => {
    expect(toHex8(parseColor('#0f0')!)).toBe('#00ff00ff')
    expect(toHex8(parseColor('#00ff0080')!)).toBe('#00ff0080')
    expect(toHex8(parseColor('rgb(255, 0, 0)')!)).toBe('#ff0000ff')
    expect(toHex8(parseColor('rgba(0,0,255,0.5)')!)).toBe('#0000ff80')
    expect(toHex8(parseColor('hsl(120, 100%, 50%)')!)).toBe('#00ff00ff')
    expect(toHex8(parseColor('  #ABCDEF  ')!)).toBe('#abcdefff')
  })

  it.each(['red', 'url(x)', 'var(--x)', 'expression(alert(1))', 'javascript:x',
    '#12', 'rgb(1,2)', 'rgb(1,2,3); display:none', '', '#ggg', 'rgb(1e999,0,0)',
    'rgb(1,2,3)/*x*/', 'hsl(1,2,3)'])('refuses %j, however colour-like', (bad) => {
    expect(parseColor(bad)).toBeNull()
  })

  it('refuses non-strings', () => {
    expect(parseColor(5 as unknown as string)).toBeNull()
    expect(parseColor(null as unknown as string)).toBeNull()
  })
})

describe('contrast', () => {
  it('computes WCAG ratios', () => {
    expect(contrastRatio(parseColor('#000')!, parseColor('#fff')!)).toBeCloseTo(21, 1)
    expect(contrastRatio(parseColor('#777')!, parseColor('#fff')!)).toBeCloseTo(4.48, 1)
  })

  it('measures a translucent colour as it looks over its background', () => {
    const bg = parseColor('#000')!
    expect(contrastRatio(parseColor('#ffffff00')!, bg)).toBeCloseTo(1, 1)
  })

  it('nudges a colour until it is readable on its background, keeping its hue', () => {
    const bg = parseColor('#000000')!
    const fixed = nudgeForContrast(parseColor('#003300')!, bg, 4.5)
    expect(contrastRatio(fixed, bg)).toBeGreaterThanOrEqual(4.5)
    expect(fixed.g).toBeGreaterThan(fixed.r)
  })

  it('nudges darker on a light background', () => {
    const bg = parseColor('#f4efe4')!
    const fixed = nudgeForContrast(parseColor('#e0d0c0')!, bg, 4.5)
    expect(contrastRatio(fixed, bg)).toBeGreaterThanOrEqual(4.5)
  })
})
