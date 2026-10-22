import { describe, it, expect } from 'vitest'
import { renderApp } from './renderApp'

/**
 * Code reads as typed. A theme's code font can be Fira Code or JetBrains Mono, whose programming
 * ligatures (OpenType `calt`) draw `===` as one joined glyph that reads as "≡", and `!=` as "≠":
 * not what Claude wrote. The terminal never drew them (xterm turns ligatures off); the chat did.
 */
describe('code fonts', () => {
  it.each(['fira-code', 'jetbrains-mono'])('draw no programming ligatures in %s', async (font) => {
    await renderApp()
    document.documentElement.dataset.monoFont = font
    const code = document.createElement('code')
    code.textContent = 'a === b'
    document.body.append(code)
    expect(getComputedStyle(code).fontVariantLigatures).toBe('no-contextual')
    code.remove()
  })
})
