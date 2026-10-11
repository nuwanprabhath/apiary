import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BUILTIN_THEMES } from '@shared/theme/builtins'
import { themeToCssVars } from '@shared/theme/cssVars'

const SRC = join(import.meta.dirname, '../../../src')

function files(dir: string, ext: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path, ext) : ext.test(name) ? [path] : []
  })
}

const css = files(join(SRC, 'renderer'), /\.css$/).map((f) => ({ f, text: readFileSync(f, 'utf8') }))

/** Every custom property something defines: a stylesheet declaration, a theme, or code that sets one by name. */
const defined = new Set<string>([
  ...css.flatMap(({ text }) => [...text.matchAll(/(?:^|[;{\s])(--[A-Za-z0-9-]+)\s*:/g)].map((m) => m[1])),
  ...BUILTIN_THEMES.flatMap((b) => Object.keys(themeToCssVars(b.spec))),
  ...files(SRC, /\.tsx?$/).flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/['"`](--[A-Za-z0-9-]+)/g)].map((m) => m[1])),
])

// A `var()` naming nothing resolves to its fallback or to nothing: 1.37.0's folder browser used
// `--text-dim` and `--fg`, which no theme or stylesheet defines, so its dimmed text was full colour.
describe('every CSS variable a stylesheet uses is defined', () => {
  const uses = css.flatMap(({ f, text }) => [...text.matchAll(/var\(\s*(--[A-Za-z0-9-]+)/g)].map((m) => ({
    file: f.slice(SRC.length + 1), name: m[1], line: text.slice(0, m.index).split('\n').length,
  })))

  it('finds the stylesheets and their variables', () => {
    expect(uses.length).toBeGreaterThan(200)
  })

  it('names only defined variables', () => {
    const missing = uses.filter((u) => !defined.has(u.name)).map((u) => `src/${u.file}:${String(u.line)} ${u.name}`)
    expect(missing, 'Undefined CSS variables. Use a token from src/renderer/styles/00-tokens.css (for dimmed text, --muted; for body text, --text), or define it there.').toEqual([])
  })
})
