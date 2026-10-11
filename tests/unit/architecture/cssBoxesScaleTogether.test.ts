import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const STYLES = join(import.meta.dirname, '../../../src/renderer/styles')

/** A value that follows the density setting: `calc(... * var(--density))` tokens, by name. */
const SCALES = /var\(--(control-height(-sm)?|space-[a-z0-9]+|row-padding-y(-lg)?|dialog-padding|control-padding-x|control-gap)\)/
const FIXED_PX = /^\s*([4-9]|\d{2,})(\.\d+)?px\s*$/

/** Every rule of every stylesheet whose width and height disagree: one follows density, the other is a fixed px. */
function mismatches(): string[] {
  const out: string[] = []
  for (const file of readdirSync(STYLES).filter((f) => f.endsWith('.css'))) {
    const text = readFileSync(join(STYLES, file), 'utf8')
    for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const decl = (prop: string): string | undefined => new RegExp(`(?:^|[;\\s])${prop}\\s*:\\s*([^;]+)`).exec(m[2])?.[1]
      const width = decl('width'), height = decl('height')
      if (width === undefined || height === undefined) continue
      const bad = (SCALES.test(width) && FIXED_PX.test(height)) || (SCALES.test(height) && FIXED_PX.test(width))
      if (bad) out.push(`src/renderer/styles/${file}: ${m[1].trim().split('\n').at(-1)?.trim() ?? ''} { width: ${width.trim()}; height: ${height.trim()} }`)
    }
  }
  return out
}

// The 1.37 token cleanup gave seven square icon buttons a density-scaled height and left their
// width in px, so at a compact or roomy density they were rectangles.
describe('a box sizes both sides the same way', () => {
  it('never pairs a density-scaled width or height with a fixed px on the other side', () => {
    expect(mismatches(), 'Use the same kind of size for both: a square icon button beside controls is var(--control-height-sm) on both sides; a fixed drawn mark is a fixed token (--icon-size-*, --icon-button-size-*, --dot-size-*) on both.').toEqual([])
  })
})
