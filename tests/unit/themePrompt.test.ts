import { describe, it, expect } from 'vitest'
import { THEME_JSON_SCHEMA, buildThemePrompt, extractThemeJson, MAX_REQUEST_CHARS } from '../../src/shared/theme/prompt'
import { PALETTE_TOKENS, EFFECT_KINDS, UI_FONTS, MONO_FONTS } from '../../src/shared/theme/spec'
import { BUILTIN_THEMES } from '../../src/shared/theme/builtins'

describe('THEME_JSON_SCHEMA', () => {
  it('offers Claude exactly the names the validator accepts', () => {
    const s = THEME_JSON_SCHEMA
    expect(Object.keys(s.properties.palette.properties)).toEqual([...PALETTE_TOKENS])
    expect(s.properties.effects.items.properties.kind.enum).toEqual([...EFFECT_KINDS])
    expect(s.properties.font.properties.ui.enum).toEqual([...UI_FONTS])
    expect(s.properties.font.properties.mono.enum).toEqual([...MONO_FONTS])
  })
})

describe('buildThemePrompt', () => {
  it('carries the request, the rules and the built-in examples', () => {
    const p = buildThemePrompt({ request: 'like the Matrix movie', current: null })
    expect(p).toContain('Theme requested:\nlike the Matrix movie')
    expect(p).toContain('digital-rain')
    expect(p).toContain('"name":"Neon cyberpunk"')
  })

  it('includes the current theme for a refinement', () => {
    const p = buildThemePrompt({ request: 'more green', current: BUILTIN_THEMES[1].spec })
    expect(p).toContain('Adjustment requested:\nmore green')
    expect(p).toContain('The current theme')
  })

  it('clips an overlong request', () => {
    const p = buildThemePrompt({ request: 'x'.repeat(10_000), current: null })
    expect(p.endsWith('x'.repeat(MAX_REQUEST_CHARS))).toBe(true)
    expect(p).not.toContain('x'.repeat(MAX_REQUEST_CHARS + 1))
  })
})

describe('extractThemeJson', () => {
  const env = (o: object): string => JSON.stringify({ type: 'result', is_error: false, ...o })
  it('reads structured output first', () => {
    expect(extractThemeJson(env({ structured_output: { name: 'A' }, result: '{"name":"B"}' }))).toEqual({ name: 'A' })
  })
  it('falls back to the result, bare, fenced or inside prose', () => {
    expect(extractThemeJson(env({ result: '{"name":"Bare"}' }))).toEqual({ name: 'Bare' })
    expect(extractThemeJson(env({ result: 'Here:\n```json\n{"name":"Fenced"}\n```' }))).toEqual({ name: 'Fenced' })
    expect(extractThemeJson(env({ result: 'Sure! {"name":"In {prose}","x":{"y":1}} hope that helps' }))).toEqual({ name: 'In {prose}', x: { y: 1 } })
  })
  it('is null for anything without a theme in it', () => {
    for (const out of ['', 'not json', '[]', env({ result: 'no json here' }), env({ is_error: true, result: '{"name":"x"}' }), env({ result: 42 })]) {
      expect(extractThemeJson(out)).toBeNull()
    }
  })
})
